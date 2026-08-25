/* ════════════════════════════════════════════════════════════════════
 * codecheck.js — PR 代码检视模块（前端编排）
 *
 * 设计理念：后端不感知定制化。前端直接调用通用 Orchestrator API
 *   完成固定编排：构造单步骤 taskDef → load → start → SSE 监控 → 读取结果
 *
 * 编排流程：
 *   1. 前端构造 taskDef（单步骤，skillDirectory 指向 code-check SKILL）
 *   2. POST /api/orchestrator/load  — 加载任务定义
 *   3. POST /api/orchestrator/start — 启动编排
 *   4. GET  /stream/tasks/:taskId   — SSE 实时监控
 *   5. GET  /api/orchestrator/progress?taskId= — 轮询进度（SSE 补充）
 *   6. GET  /api/flexrunner/steps?taskId= — 获取结果文件列表
 *   7. GET  /api/flexrunner/file?path= — 读取检视报告
 *   8. POST /api/orchestrator/abort — 取消任务
 *
 * 依赖：utils.js（apiFetch / API / createPagination / escapeHtml / toast / $）
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── SKILL 名称映射（前端固定编排配置）───────────────────────────────── */
var _CC_SKILL_MAP = {
    arkts: 'arkts-code-check',
    flutter: 'flutter-code-check',
    rn: 'rn-code-check',
};

var _CC_SKILL_INFO = {
    'arkts-code-check': {
        name: 'ArkTS PR 代码检视',
        desc: '自动化检视 ArkTS 三方库 Pull Request，包括获取 PR 差异、深度分析代码变更、生成结构化检视报告',
    },
    'flutter-code-check': {
        name: 'Flutter PR 代码检视',
        desc: '自动化检视 Flutter 三方库 Pull Request，聚焦鸿蒙端适配代码质量',
    },
    'rn-code-check': {
        name: 'React Native PR 代码检视',
        desc: '自动化检视 React Native 三方库 Pull Request，聚焦鸿蒙端适配代码质量',
    },
};

/* ── 状态 ────────────────────────────────────────────────────────────── */
var _ccCounter = 0;
var _ccTasks = {};  // idx -> { taskId, prUrl, libraryType, sse, timer, startTime, ... }
var _ccPager = null;
var _ccInited = false;

/* ── 阶段标签（映射 Orchestrator 状态到检视阶段）────────────────────── */
var _CC_STAGE_LABELS = {
    pending:    '等待中',
    ready:      '就绪',
    running:    '检视中…',
    completed:  '检视完成 ✓',
    failed:     '检视失败',
    aborted:    '已停止',
    error:      '错误',
    idle:       '空闲',
    loaded:     '已加载',
    deadlocked: '死锁',
};

/* ── PR 地址解析 ─────────────────────────────────────────────────────── */

/**
 * 从 PR URL 解析出 owner、repo、prNumber。
 *
 * 支持格式：
 *   https://gitee.com/openharmony-tpc/community/pulls/123
 *   https://gitcode.com/owner/repo/pulls/123
 *   https://github.com/owner/repo/pull/123
 *
 * @param {string} prUrl
 * @returns {{owner:string, repo:string, prNumber:string, label:string}}
 */
function _ccParsePrUrl(prUrl) {
    var fallback = { owner: 'unknown', repo: 'unknown', prNumber: '0', label: 'unknown_unknown_0' };
    if (!prUrl) return fallback;

    try {
        var url = new URL(prUrl);
        var parts = url.pathname.split('/').filter(Boolean);
        // 典型: /owner/repo/pulls/123 或 /owner/repo/pull/123
        var pullIdx = -1;
        for (var i = 0; i < parts.length; i++) {
            if (/^pulls?$/.test(parts[i])) { pullIdx = i; break; }
        }
        if (pullIdx >= 2) {
            var owner = parts[0];
            var repo = parts[1];
            var prNumber = parts[pullIdx + 1] || '0';
            return {
                owner: owner,
                repo: repo,
                prNumber: prNumber,
                label: owner + '_' + repo + '_' + prNumber,
            };
        }
        // 回退：用 pathname 中的段拼接
        if (parts.length >= 2) {
            return {
                owner: parts[0],
                repo: parts[1],
                prNumber: parts[parts.length - 1] || '0',
                label: parts.slice(0, 3).join('_'),
            };
        }
    } catch (e) { /* 非法 URL */ }
    return fallback;
}

/**
 * 从 taskId 解析出显示名称。
 * taskId 格式: codecheck_{owner}_{repo}_{prNum}_{timestamp}
 * → 显示: {owner}/{repo} #{prNum}
 */
function _ccTaskIdToLabel(taskId) {
    if (!taskId) return '—';
    // 去掉 codecheck_ 前缀
    var rest = taskId.replace(/^codecheck_/, '');
    var parts = rest.split('_');
    if (parts.length >= 4) {
        // owner_repo_prNum_timestamp → owner/repo #prNum
        return parts[0] + '/' + parts[1] + ' #' + parts[2];
    }
    // 格式不匹配，截断显示
    return rest.length > 40 ? rest.substring(0, 40) + '…' : rest;
}

/**
 * 从 taskId 解析出 owner_repo_prNum 标识。
 */
function _ccTaskIdToLabelRaw(taskId) {
    if (!taskId) return '';
    var rest = taskId.replace(/^codecheck_/, '');
    var parts = rest.split('_');
    if (parts.length >= 4) {
        return parts[0] + '_' + parts[1] + '_' + parts[2];
    }
    return rest;
}

/* ── 辅助函数 ────────────────────────────────────────────────────────── */

function _ccEsc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _ccGuardSubmit(btn, loadingText, normalText) {
    if (!btn || btn.disabled) return false;
    btn.disabled = true;
    btn.textContent = loadingText;
    btn._ccNormalText = normalText;
    return true;
}

function _ccGuardSubmitRestore(btn) {
    if (!btn) return;
    var normalText = btn._ccNormalText || '提交';
    setTimeout(function () {
        if (btn.disabled) { btn.disabled = false; btn.textContent = normalText; }
    }, 5000);
}

function _ccGuardSubmitReset(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = btn._ccNormalText || '提交';
}

function _ccFormatTime(isoString) {
    if (!isoString) return '';
    try {
        return new Date(isoString).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    } catch (e) { return isoString; }
}

/* ── 面板初始化（懒加载，由 Nav.register 触发）───────────────────────── */
function initCodeCheckPanel() {
    if (_ccInited) return;
    _ccInited = true;

    // 渲染 SKILL 介绍
    _renderSkillIntro();

    // 加载历史任务
    _loadCodeCheckHistory();

    // 绑定提交按钮
    var btn = $('cc-submit-btn');
    if (btn) btn.addEventListener('click', doCodeCheck);

    // 绑定库类型切换 → 更新 SKILL 介绍
    var libSelect = $('cc-lib-type');
    if (libSelect) libSelect.addEventListener('change', _renderSkillIntro);

    // 绑定回车提交
    var urlInput = $('cc-pr-url');
    if (urlInput) {
        urlInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doCodeCheck();
        });
    }

    // 绑定高级选项折叠
    var advToggle = $('cc-advanced-toggle');
    if (advToggle) {
        advToggle.addEventListener('click', function () {
            var section = $('cc-advanced-section');
            if (section) {
                section.classList.toggle('show');
                advToggle.classList.toggle('open');
            }
        });
    }
}

/* ── SKILL 介绍（静态渲染，无需后端接口）────────────────────────────── */
function _renderSkillIntro() {
    var container = $('cc-skill-intro');
    if (!container) return;

    var libType = $('cc-lib-type') ? $('cc-lib-type').value : 'arkts';
    var skillName = _CC_SKILL_MAP[libType] || _CC_SKILL_MAP.arkts;
    var info = _CC_SKILL_INFO[skillName] || { name: skillName, desc: '' };

    var typeColors = {
        arkts: { bg: 'rgba(0,113,227,0.12)', color: 'var(--blue)', border: 'rgba(0,113,227,0.3)' },
        flutter: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
        rn: { bg: 'rgba(97,218,251,0.12)', color: '#61dafb', border: 'rgba(97,218,251,0.3)' },
    };
    var cc = typeColors[libType] || typeColors.arkts;

    container.innerHTML =
        '<div class="cc-skill-header">' +
            '<span class="cc-skill-icon">🛠️</span>' +
            '<span class="cc-skill-title">代码检视 SKILL</span>' +
        '</div>' +
        '<div class="cc-skill-grid">' +
            '<div class="cc-skill-card">' +
                '<div class="cc-skill-card-header">' +
                    '<div style="display:flex;align-items:center;gap:8px;flex:1">' +
                        '<span class="cc-skill-badge" style="background:' + cc.bg + ';color:' + cc.color + ';border:1px solid ' + cc.border + '">' +
                            _ccEsc(libType.toUpperCase()) +
                        '</span>' +
                        '<span class="cc-skill-name">' + _ccEsc(info.name) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="cc-skill-card-desc">' + _ccEsc(info.desc) + '</div>' +
            '</div>' +
        '</div>';
}

/* ── 历史任务加载 ────────────────────────────────────────────────────── */
async function _loadCodeCheckHistory() {
    try {
        var r = await apiFetch('GET', '/api/orchestrator/tasks?page=1&pageSize=100');
        if (!r.data || r.data.status !== 'ok') return;

        var allTasks = r.data.tasks || [];
        // 过滤出 codecheck_ 前缀的任务
        var ccTasks = allTasks.filter(function (t) {
            var tid = t.taskId || t.task_id || '';
            return tid.startsWith('codecheck_');
        });

        // 按创建时间降序
        ccTasks.sort(function (a, b) {
            var ta = new Date(a.createdAt || a.created_at || a.startTime || 0).getTime();
            var tb = new Date(b.createdAt || b.created_at || b.startTime || 0).getTime();
            return tb - ta;
        });

        var listEl = $('cc-tasks-list');
        if (listEl) listEl.innerHTML = '';

        var emptyEl = $('cc-tasks-empty');
        if (emptyEl) emptyEl.style.display = ccTasks.length > 0 ? 'none' : '';

        var countEl = $('cc-task-count');
        if (countEl) countEl.textContent = ccTasks.length + ' 个任务';

        // 升序遍历（insertBefore 前插反转顺序）
        ccTasks.reverse();
        for (var i = 0; i < ccTasks.length; i++) {
            var t = ccTasks[i];
            var tid = t.taskId || t.task_id;
            var status = t.status || (t.progress && t.progress.status) || 'idle';
            var startTime = t.startTime || t.created_at || t.createdAt;
            var endTime = t.endTime || (t.progress && t.progress.endTime);

            // 从 description（body.title）中解析 prUrl 和 libraryType
            // 格式: PR检视|{libraryType}|{prUrl}
            var desc = t.description || t.title || '';
            var prUrl = '';
            var libType = 'arkts';
            if (desc.indexOf('PR检视|') === 0) {
                var segs = desc.split('|');
                if (segs.length >= 3) {
                    libType = segs[1] || 'arkts';
                    prUrl = segs[2] || '';
                }
            } else if (desc) {
                // 兼容旧格式：description 直接是 prUrl
                prUrl = desc;
            }

            // 从 taskId 解析显示名称
            var displayLabel = _ccTaskIdToLabel(tid);

            var idx = ++_ccCounter;
            _ccTasks[idx] = {
                taskId: tid,
                prUrl: prUrl,
                libraryType: libType,
                sse: null,
                timer: null,
                startTime: startTime ? new Date(startTime).getTime() : Date.now(),
                startedAt: startTime || null,
                finishedAt: endTime || null,
                resultPath: null,
            };

            _createCCCard(idx, displayLabel, prUrl, libType, startTime, true);
            _updateCCStage(idx, status, { startedAt: startTime, finishedAt: endTime });

            // 注册表 status 可能未更新（后端 fire-and-forget 无 finally 回调），
            // 额外调用 progress 接口拿真实状态
            _refreshTaskStatus(idx, status);
        }
    } catch (e) {
        console.error('[CodeCheck] 加载历史任务失败:', e.message);
    }
}

/* ── 刷新单个历史任务的真实状态 ──────────────────────────────────────── */
async function _refreshTaskStatus(idx, fallbackStatus) {
    var task = _ccTasks[idx];
    if (!task) return;

    try {
        var r = await apiFetch('GET', '/api/orchestrator/progress?taskId=' + encodeURIComponent(task.taskId), null, 10000);
        if (!r.data || r.data.status !== 'ok') {
            // progress 接口不可用（可能编排器已从内存移除且磁盘文件也找不到）
            // 按注册表的 fallback status 处理
            _handleTaskStage(idx, fallbackStatus);
            return;
        }

        var progress = r.data.progress;
        if (!progress) {
            _handleTaskStage(idx, fallbackStatus);
            return;
        }

        var stage = progress.status;
        var startedAt = progress.startTime;
        var finishedAt = progress.endTime;
        var resultPath = null;

        // 提取步骤级信息
        if (progress.steps && progress.steps.length > 0) {
            var step = progress.steps[0];
            if (step.resultPath) resultPath = step.resultPath;
            if (step.startTime) startedAt = step.startTime;
            if (step.endTime) finishedAt = step.endTime;
        }

        _updateCCStage(idx, stage, { startedAt: startedAt, finishedAt: finishedAt, resultPath: resultPath });
        _handleTaskStage(idx, stage);
    } catch (e) {
        // 静默失败，按 fallback status 处理
        _handleTaskStage(idx, fallbackStatus);
    }
}

/* ── 根据阶段决定后续操作（重连 SSE / 读取结果）─────────────────────── */
function _handleTaskStage(idx, stage) {
    var activeStages = ['running', 'pending', 'ready', 'loaded', 'idle'];
    if (activeStages.indexOf(stage) >= 0) {
        _connectCCSSE(idx);
        _startProgressPoll(idx);
    } else {
        _finishCCSSE(idx);
        _loadCCResultFiles(idx);
    }
}

/* ── 提交代码检视（前端编排：构造 taskDef → load → start）───────────── */
async function doCodeCheck() {
    var prUrl = $('cc-pr-url').value.trim();
    var libType = $('cc-lib-type').value;
    var skillDir = $('cc-skill-dir') ? $('cc-skill-dir').value.trim() : '';

    if (!prUrl) { _showCCErr('PR 地址不能为空'); return; }

    var btn = $('cc-submit-btn');
    if (!_ccGuardSubmit(btn, '提交中…', '▶ 开始检视')) return;
    $('cc-error').style.display = 'none';

    try {
        // ── 1. 解析 PR 地址，生成 taskId ──
        var prInfo = _ccParsePrUrl(prUrl);
        var ts = Date.now().toString(36);
        var taskId = 'codecheck_' + prInfo.label + '_' + ts;

        // ── 2. 确定 SKILL ──
        // 按库类型指定对应 SKILL（arkts-code-check / flutter-code-check / rn-code-check），
        // 后端 FlexRunner 收到 specifiedSkill 后跳过自动匹配，直接解析使用该 SKILL
        var skillName = _CC_SKILL_MAP[libType] || _CC_SKILL_MAP.arkts;

        // ── 3. 构造任务描述 ──
        var taskDescription = [
            '请对以下 PR 进行代码检视。',
            '',
            'PR 地址: ' + prUrl,
        ].join('\n');

        // ── 4. 构造 taskDef（单步骤固定编排）──
        // body.title 编码 prUrl 和 libraryType，供历史恢复解析
        // 格式: PR检视|{libraryType}|{prUrl}
        // skillDirectory：用户自定义 SKILL 根目录（可选），留空由后端使用默认 Server/Skills
        // specifiedSkill：按库类型固定指定对应 SKILL，跳过 SkillSelector 自动匹配
        var taskDef = {
            taskId: taskId,
            title: 'PR检视|' + libType + '|' + prUrl,
            skillDirectory: skillDir || '',
            loopCount: 0,
            steps: [{
                stepId: 1,
                taskDescription: taskDescription,
                dependId: 0,
                nextStepId: 0,
                failStepId: 0,
                maxRetries: 3,
                skillDirectory: skillDir || '',
                specifiedSkill: skillName,
                inputReport: '',
            }]
        };

        // ── 5. POST /api/orchestrator/load ──
        var loadR = await apiFetch('POST', '/api/orchestrator/load', taskDef);
        if (loadR.status >= 400 || !loadR.data || loadR.data.status !== 'ok') {
            _showCCErr((loadR.data && (loadR.data.error || loadR.data.message)) || ('HTTP ' + loadR.status));
            _ccGuardSubmitReset(btn);
            return;
        }

        // ── 6. POST /api/orchestrator/start ──
        var startR = await apiFetch('POST', '/api/orchestrator/start', { taskId: taskId });
        if (startR.status >= 400 || !startR.data || startR.data.status !== 'ok') {
            _showCCErr((startR.data && (startR.data.error || startR.data.message)) || ('HTTP ' + startR.status));
            _ccGuardSubmitReset(btn);
            return;
        }

        // ── 7. 创建任务卡片 + 连接 SSE ──
        var idx = ++_ccCounter;
        var displayLabel = prInfo.owner + '/' + prInfo.repo + ' #' + prInfo.prNumber;
        _ccTasks[idx] = {
            taskId: taskId,
            prUrl: prUrl,
            libraryType: libType,
            sse: null,
            timer: null,
            pollTimer: null,
            startTime: Date.now(),
            startedAt: null,
            finishedAt: null,
            resultPath: null,
        };

        _createCCCard(idx, displayLabel, prUrl, libType, new Date().toISOString());
        _connectCCSSE(idx);
        _startProgressPoll(idx);

        _ccGuardSubmitRestore(btn);
        toast('success', '检视任务已启动: ' + displayLabel);

    } catch (e) {
        _showCCErr(e.message);
        _ccGuardSubmitReset(btn);
    }
}

/* ── 进度轮询（SSE 的补充，确保状态同步）────────────────────────────── */
function _startProgressPoll(idx) {
    var task = _ccTasks[idx];
    if (!task || task.pollTimer) return;

    task.pollTimer = setInterval(async function () {
        try {
            var r = await apiFetch('GET', '/api/orchestrator/progress?taskId=' + encodeURIComponent(task.taskId), null, 10000);
            if (!r.data || r.data.status !== 'ok') return;

            var progress = r.data.progress;
            if (!progress) return;

            // 更新阶段
            var stage = progress.status;
            _updateCCStage(idx, stage, {
                startedAt: progress.startTime,
                finishedAt: progress.endTime,
            });

            // 检查步骤状态
            if (progress.steps && progress.steps.length > 0) {
                var step = progress.steps[0];
                if (step.status) {
                    _updateCCStage(idx, step.status, {
                        startedAt: step.startTime,
                        finishedAt: step.endTime,
                        resultPath: step.resultPath,
                    });
                }
                // 结构化指标到达即更新等级徽章（后端收割落库，无需读报告）
                if (step.metrics && step.metrics.mergeLevel) {
                    _updateMergeLevelBadge(idx, String(step.metrics.mergeLevel).toUpperCase(), null);
                }
            }

            // 终态：停止轮询
            if (['completed', 'failed', 'aborted', 'deadlocked'].indexOf(stage) >= 0) {
                _stopProgressPoll(idx);
                _finishCCSSE(idx);
                _loadCCResultFiles(idx);
            }
        } catch (e) { /* 静默失败 */ }
    }, 3000);
}

function _stopProgressPoll(idx) {
    var task = _ccTasks[idx];
    if (task && task.pollTimer) {
        clearInterval(task.pollTimer);
        task.pollTimer = null;
    }
}

/* ── 合入等级提取 ────────────────────────────────────────────────────── */

/**
 * 从步骤 metrics（后端收割的结构化指标）或报告文本中提取合入等级。
 * 优先级：metrics.mergeLevel（后端落库，页面关闭不丢失）> 报告正则（存量旧任务回退）。
 *
 * @param {object|null} metrics - 步骤结构化指标（progress.steps[0].metrics）
 * @param {string|null} [reportContent] - 检视报告文本（回退解析用）
 * @returns {string|null} PASS / CONDITIONAL / NEED_FIX / REJECT，提取不到返回 null
 */
function _ccExtractMergeLevel(metrics, reportContent) {
    // ── 优先：结构化指标（SKILL 写入 meta .json，后端收割落库） ──
    if (metrics && typeof metrics === 'object' && metrics.mergeLevel) {
        var level = String(metrics.mergeLevel).toUpperCase();
        if (/^(PASS|CONDITIONAL|NEED_FIX|REJECT)$/.test(level)) return level;
    }
    // ── 回退：报告文本正则（存量旧任务，无 meta 文件） ──
    if (reportContent) {
        // 匹配多种格式：
        //   合入建议：PASS
        //   ## 合入建议\n### **NEED_FIX**
        //   合入建议\nNEED_FIX
        var mergeMatch = reportContent.match(/合入建议[^A-Z]*(PASS|CONDITIONAL|NEED_FIX|REJECT)/i);
        if (mergeMatch) return mergeMatch[1].toUpperCase();
    }
    return null;
}

/* ── 加载结果文件 ────────────────────────────────────────────────────── */
async function _loadCCResultFiles(idx) {
    var task = _ccTasks[idx];
    if (!task) return;

    // ── 优先：从 progress 接口读结构化指标（后端收割落库，不依赖报告文本） ──
    try {
        var pg = await apiFetch('GET', '/api/orchestrator/progress?taskId=' + encodeURIComponent(task.taskId), null, 10000);
        var step0 = pg && pg.data && pg.data.progress && pg.data.progress.steps && pg.data.progress.steps[0];
        if (step0 && step0.metrics) {
            task.metrics = step0.metrics;
            var mLevel = _ccExtractMergeLevel(step0.metrics, null);
            if (mLevel) {
                _updateMergeLevelBadge(idx, mLevel, null);
                var dl0 = document.getElementById('cc-' + idx + '-dl-wrap');
                if (dl0 && task.resultPath) dl0.style.display = 'flex';
            }
        }
    } catch (e) { /* 静默失败，走报告回退 */ }

    try {
        var r = await apiFetch('GET', '/api/flexrunner/steps?taskId=' + encodeURIComponent(task.taskId));
        if (!r.data || r.data.status !== 'ok') return;

        var files = r.data.files || [];
        if (files.length === 0) return;

        // 选择预览/下载目标文件：
        //   1. 优先 check-report.md — SKILL 生成的结构化检视报告（用户真正要看的内容）
        //   2. 回退 result .md — 框架生成的执行状态文件（check-report 缺失/旧任务时兜底）
        var reportFile = null;
        var resultFile = null;
        for (var i = files.length - 1; i >= 0; i--) {
            var fname = files[i].filename || '';
            if (!reportFile && fname === 'check-report.md') {
                reportFile = files[i];
            }
            if (!resultFile && fname.indexOf('result') >= 0) {
                resultFile = files[i];
            }
        }
        var targetFile = reportFile || resultFile;

        if (targetFile) {
            task.resultPath = targetFile.path;
            // 显示下载/预览按钮
            var dlWrap = document.getElementById('cc-' + idx + '-dl-wrap');
            if (dlWrap) dlWrap.style.display = 'flex';

            // 已从 metrics 拿到等级则不再读报告文本（省流量）
            if (task.metrics && task.metrics.mergeLevel) return;

            // 回退：读取报告内容提取合入建议（存量旧任务）
            var fileR = await apiFetch('GET', '/api/flexrunner/file?path=' + encodeURIComponent(targetFile.path));
            if (fileR.data && fileR.data.status === 'ok' && fileR.data.content) {
                var level = _ccExtractMergeLevel(null, fileR.data.content);
                if (level) {
                    _updateMergeLevelBadge(idx, level, null);
                }
            }
        }
    } catch (e) { /* 静默失败 */ }
}

/* ── 创建检视任务卡片 ────────────────────────────────────────────────── */
function _createCCCard(idx, displayLabel, prUrl, libType, createdAt, isHistory) {
    var emptyEl = $('cc-tasks-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    var countEl = $('cc-task-count');
    if (countEl) countEl.textContent = Object.keys(_ccTasks).length + ' 个任务';

    var typeLabel = {
        arkts: 'ArkTS', flutter: 'Flutter', rn: 'React Native'
    }[libType] || libType;

    var typeBadgeStyle = {
        arkts: 'background:rgba(0,113,227,0.12);color:var(--blue)',
        flutter: 'background:rgba(59,130,246,0.12);color:#3b82f6',
        rn: 'background:rgba(97,218,251,0.12);color:#61dafb',
    }[libType] || 'background:rgba(0,113,227,0.12);color:var(--blue)';

    var timeLabel = createdAt ? _ccFormatTime(createdAt) : '';

    var card = document.createElement('div');
    card.className = 'cc-task-card running';
    card.id = 'cc-card-' + idx;
    card.innerHTML =
        '<div class="cc-card-header" onclick="toggleCCCard(' + idx + ')">' +
            '<span class="cc-chevron">▶</span>' +
            '<span class="cc-run-dot"></span>' +
            '<span class="cc-lib">' + _ccEsc(displayLabel) + '</span>' +
            '<span class="cc-type-badge" style="' + typeBadgeStyle + '">' + _ccEsc(typeLabel) + '</span>' +
            '<span class="cc-spacer"></span>' +
            '<span class="cc-time" id="cc-' + idx + '-time">' + _ccEsc(timeLabel) + '</span>' +
            '<span class="cc-merge-badge" id="cc-' + idx + '-merge-badge" style="display:none"></span>' +
            '<span class="cc-stage-badge s-pending" id="cc-' + idx + '-badge">等待中</span>' +
            '<button class="cc-stop-btn" id="cc-' + idx + '-stop" onclick="event.stopPropagation();stopCCTask(' + idx + ')" title="取消检视">■ 取消</button>' +
            '<span class="cc-elapsed" id="cc-' + idx + '-elapsed" style="display:none">0s</span>' +
        '</div>' +
        '<div class="cc-card-body" id="cc-' + idx + '-body">' +
            '<div class="cc-meta" title="' + _ccEsc(prUrl) + '">' +
                '<span class="cc-meta-label">PR：</span>' +
                '<span class="cc-meta-value">' + _ccEsc(prUrl) + '</span>' +
            '</div>' +
            '<div class="cc-pipeline">' +
                '<div style="display:flex;align-items:center;gap:14px">' +
                    '<div class="cc-pipe-icon" id="cc-' + idx + '-icon">🔍</div>' +
                    '<div style="flex:1">' +
                        '<div class="cc-pipe-title">PR 代码检视</div>' +
                        '<div class="cc-pipe-stage" id="cc-' + idx + '-stage-txt">等待中…</div>' +
                    '</div>' +
                    '<div class="cc-dl-wrap" id="cc-' + idx + '-dl-wrap" style="display:none;flex-direction:column;gap:6px;align-items:flex-end">' +
                        '<button onclick="downloadCCReport(' + idx + ')" class="cc-download-btn">↓ 下载检视报告</button>' +
                        '<button onclick="viewCCReport(' + idx + ')" class="cc-preview-btn">↗ 在线预览</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="cc-actions">' +
                '<button onclick="viewCCSession(' + idx + ')" class="cc-session-btn" id="cc-' + idx + '-session-btn">💬 查看对话</button>' +
            '</div>' +
        '</div>';

    var list = $('cc-tasks-list');
    list.insertBefore(card, list.firstChild);

    // 卡片默认折叠
    var body = document.getElementById('cc-' + idx + '-body');
    if (body) body.style.display = 'none';

    // 已完成的历史任务：显示固定时长
    var task = _ccTasks[idx];
    if (isHistory && task.finishedAt && task.startedAt) {
        var durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
        var durationSec = Math.floor(Math.max(0, durationMs) / 1000);
        var elapsedEl = document.getElementById('cc-' + idx + '-elapsed');
        if (elapsedEl) {
            elapsedEl.textContent = durationSec < 60 ? durationSec + 's' : Math.floor(durationSec / 60) + 'm ' + (durationSec % 60) + 's';
            elapsedEl.style.display = 'inline';
        }
    } else {
        // 进行中的任务：启动定时器
        _ccTasks[idx].timer = setInterval(function () {
            var s = Math.floor((Date.now() - _ccTasks[idx].startTime) / 1000);
            var el = document.getElementById('cc-' + idx + '-elapsed');
            if (el) el.textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        }, 1000);
    }
}

/* ── 卡片折叠 ────────────────────────────────────────────────────────── */
function toggleCCCard(idx) {
    var card = document.getElementById('cc-card-' + idx);
    var body = document.getElementById('cc-' + idx + '-body');
    if (!card || !body) return;
    var isOpen = card.classList.toggle('open');
    body.style.display = isOpen ? '' : 'none';
}

/* ── SSE 连接（监听 Orchestrator 事件）───────────────────────────────── */
function _connectCCSSE(idx) {
    var task = _ccTasks[idx];
    if (!task) return;

    if (task.sse && (task.sse.readyState === EventSource.OPEN || task.sse.readyState === EventSource.CONNECTING)) {
        return;
    }
    if (task.sse) { var old = task.sse; task.sse = null; old.close(); }

    var sse = new EventSource('/stream/tasks/' + encodeURIComponent(task.taskId));
    task.sse = sse;
    var sseDone = false;

    // 编排步骤状态变更
    sse.addEventListener('orch:step:status', function (e) {
        var data; try { data = JSON.parse(e.data); } catch (err) { data = {}; }
        if (data.status) {
            _updateCCStage(idx, data.status, {
                startedAt: data.startTime,
                finishedAt: data.endTime,
                resultPath: data.resultPath,
            });
        }
        // 结构化指标随步骤状态事件推送（markFinished 后）
        if (data.metrics && data.metrics.mergeLevel) {
            _updateMergeLevelBadge(idx, String(data.metrics.mergeLevel).toUpperCase(), null);
        }
    });

    // 编排整体进度
    sse.addEventListener('orch:task:progress', function (e) {
        // 仅用于状态同步，不显示日志
    });

    // 编排启动
    sse.addEventListener('orch:task:start', function (e) {
        _updateCCStage(idx, 'running', {});
    });

    // 编排完成
    sse.addEventListener('orch:task:complete', function (e) {
        sseDone = true;
        var data; try { data = JSON.parse(e.data); } catch (err) { data = {}; }
        if (data.status) {
            _updateCCStage(idx, data.status, {});
        } else {
            _updateCCStage(idx, 'completed', {});
        }
        _stopProgressPoll(idx);
        _finishCCSSE(idx);
        _loadCCResultFiles(idx);
    });

    // 编排错误
    sse.addEventListener('orch:task:error', function (e) {
        _updateCCStage(idx, 'failed', {});
    });

    // 编排终止
    sse.addEventListener('orch:task:aborted', function (e) {
        sseDone = true;
        _updateCCStage(idx, 'aborted', {});
        _stopProgressPoll(idx);
        _finishCCSSE(idx);
    });

    // 连接建立
    sse.addEventListener('connected', function (e) {
        // 仅维持连接，不显示日志
    });

    sse.onerror = function () {
        if (sseDone) { sse.close(); return; }
    };
}

/* ── 阶段 UI 更新 ────────────────────────────────────────────────────── */
function _updateCCStage(idx, stage, extra) {
    extra = extra || {};
    var task = _ccTasks[idx];
    if (task) {
        if (extra.startedAt) task.startedAt = extra.startedAt;
        if (extra.finishedAt) task.finishedAt = extra.finishedAt;
        if (extra.resultPath) task.resultPath = extra.resultPath;
    }

    var badge = document.getElementById('cc-' + idx + '-badge');
    if (badge) {
        badge.className = 'cc-stage-badge s-' + stage;
        badge.textContent = _CC_STAGE_LABELS[stage] || stage;
    }

    var stageTxt = document.getElementById('cc-' + idx + '-stage-txt');
    if (stageTxt) stageTxt.textContent = _CC_STAGE_LABELS[stage] || stage;

    var icon = document.getElementById('cc-' + idx + '-icon');
    if (icon) {
        if (stage === 'completed') {
            icon.style.borderColor = 'var(--green)';
            icon.style.background = 'rgba(52,199,89,0.1)';
            icon.textContent = '✅';
        } else if (stage === 'failed' || stage === 'error' || stage === 'deadlocked') {
            icon.style.borderColor = 'var(--red)';
            icon.style.background = 'rgba(255,59,48,0.1)';
            icon.textContent = '❌';
        } else if (stage === 'aborted') {
            icon.style.borderColor = 'var(--gray)';
            icon.style.background = 'rgba(142,142,147,0.1)';
            icon.textContent = '⏹';
        } else if (stage === 'running') {
            icon.style.borderColor = 'var(--blue)';
            icon.style.background = 'rgba(0,113,227,0.1)';
            icon.textContent = '🔍';
        }
    }

    // 完成时显示下载按钮
    if (stage === 'completed') {
        var dlWrap = document.getElementById('cc-' + idx + '-dl-wrap');
        if (dlWrap && task && task.resultPath) {
            dlWrap.style.display = 'flex';
        }
    }
}

/* ── 合入建议分级徽章 ────────────────────────────────────────────────── */
function _updateMergeLevelBadge(idx, mergeLevel, resultUrl) {
    var mergeBadge = document.getElementById('cc-' + idx + '-merge-badge');
    if (!mergeBadge) return;

    var levelConfig = {
        PASS:        { label: '建议合入',   color: 'var(--green)',  icon: '✅', bg: 'rgba(52,199,89,0.15)' },
        CONDITIONAL: { label: '条件合入',   color: 'var(--orange)', icon: '⚠️', bg: 'rgba(255,149,0,0.15)' },
        NEED_FIX:    { label: '修改后合入', color: 'var(--orange)', icon: '🔧', bg: 'rgba(255,149,0,0.15)' },
        REJECT:      { label: '不允许合入', color: 'var(--red)',    icon: '❌', bg: 'rgba(255,59,48,0.15)' },
    };

    var config = levelConfig[mergeLevel] || { label: mergeLevel, color: 'var(--text3)', icon: '❓', bg: 'rgba(142,142,147,0.15)' };

    mergeBadge.style.display = 'inline-flex';
    mergeBadge.style.background = config.bg;
    mergeBadge.style.color = config.color;
    mergeBadge.innerHTML = config.icon + ' ' + _ccEsc(config.label);
}

/* ── 完成 SSE 连接后的收尾 ───────────────────────────────────────────── */
function _finishCCSSE(idx) {
    var task = _ccTasks[idx];
    if (!task) return;
    if (task.sse) { try { task.sse.close(); } catch (e) {} task.sse = null; }
    if (task.timer) { clearInterval(task.timer); task.timer = null; }

    var timeEl = document.getElementById('cc-' + idx + '-time');
    if (timeEl && task.startedAt) timeEl.textContent = _ccFormatTime(task.startedAt);

    var elapsedEl = document.getElementById('cc-' + idx + '-elapsed');
    if (elapsedEl) {
        if (task.startedAt && task.finishedAt) {
            var durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
            var durationSec = Math.floor(durationMs / 1000);
            elapsedEl.textContent = durationSec < 60 ? durationSec + 's' : Math.floor(durationSec / 60) + 'm ' + (durationSec % 60) + 's';
        } else if (task.startedAt) {
            var ms = Date.now() - new Date(task.startedAt).getTime();
            var sec = Math.floor(ms / 1000);
            elapsedEl.textContent = sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
        }
        elapsedEl.style.display = 'inline';
    }

    var card = document.getElementById('cc-card-' + idx);
    if (card) {
        card.classList.remove('running');
        var badge = document.getElementById('cc-' + idx + '-badge');
        if (badge) {
            if (badge.classList.contains('s-completed')) card.classList.add('cc-done');
            else if (badge.classList.contains('s-failed') || badge.classList.contains('s-error')) card.classList.add('cc-failed');
            else if (badge.classList.contains('s-aborted')) card.classList.add('cc-cancelled');
        }
        var stopBtn = document.getElementById('cc-' + idx + '-stop');
        if (stopBtn) stopBtn.style.display = 'none';
    }
}

/* ── 停止检视 ────────────────────────────────────────────────────────── */
async function stopCCTask(idx) {
    var task = _ccTasks[idx];
    if (!task) return;
    var btn = document.getElementById('cc-' + idx + '-stop');
    if (btn) { btn.disabled = true; btn.textContent = '取消中…'; }

    try {
        var r = await apiFetch('POST', '/api/orchestrator/abort', { taskId: task.taskId });
        if (r.status >= 400) {
            toast('error', '取消失败：' + ((r.data && r.data.error) || r.status));
            if (btn) { btn.disabled = false; btn.textContent = '■ 取消'; }
            return;
        }
    } catch (e) {
        toast('error', '取消请求异常：' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '■ 取消'; }
        return;
    }

    toast('warn', '检视任务已取消');
    _updateCCStage(idx, 'aborted', {});
    _stopProgressPoll(idx);
    _finishCCSSE(idx);
}

/* ── 报告下载 ────────────────────────────────────────────────────────── */
async function downloadCCReport(idx) {
    var task = _ccTasks[idx];
    if (!task || !task.resultPath) { toast('warn', '检视报告尚未生成'); return; }

    try {
        var r = await fetch('/api/flexrunner/file?path=' + encodeURIComponent(task.resultPath));
        if (!r.ok) { toast('error', '下载失败: HTTP ' + r.status); return; }
        var blob = await r.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'check-report.md';
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        toast('error', '下载失败: ' + e.message);
    }
}

/* ── 报告预览 ────────────────────────────────────────────────────────── */
async function viewCCReport(idx) {
    var task = _ccTasks[idx];
    if (!task || !task.resultPath) { toast('warn', '检视报告尚未生成'); return; }

    try {
        var r = await apiFetch('GET', '/api/flexrunner/file?path=' + encodeURIComponent(task.resultPath));
        if (!r.data || r.data.status !== 'ok') { toast('error', '读取报告失败'); return; }

        var title = '检视报告 - ' + task.taskId;
        if (typeof MarkdownReader !== 'undefined' && MarkdownReader.open) {
            // 使用 Markdown 阅读器渲染检视报告（支持表格/代码块/分级标题等）
            MarkdownReader.open(title, r.data.content);
        } else if (typeof showModal === 'function') {
            showModal(title, r.data.content);
        } else {
            var w = window.open('', '_blank');
            if (w) {
                w.document.write('<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;padding:20px;">' +
                    _ccEsc(r.data.content) + '</pre>');
                w.document.title = title;
            }
        }
    } catch (e) {
        toast('error', '预览失败: ' + e.message);
    }
}

/* ── 查看对话历史 ────────────────────────────────────────────────────── */
async function viewCCSession(idx) {
    var task = _ccTasks[idx];
    if (!task) return;

    var btn = document.getElementById('cc-' + idx + '-session-btn');
    if (btn) { btn.disabled = true; btn.textContent = '加载中…'; }

    try {
        var url = '/api/flexrunner/session?taskId=' + encodeURIComponent(task.taskId) + '&stepId=1';
        var r = await apiFetch('GET', url, null, 15000);
        if (btn) { btn.disabled = false; btn.textContent = '💬 查看对话'; }

        if (!r.data || r.data.status !== 'ok') {
            toast('error', '获取对话失败');
            return;
        }

        var messages = r.data.messages || [];
        if (messages.length === 0) {
            toast('info', '暂无对话消息');
            return;
        }

        var title = '对话记录 - ' + task.taskId;
        if (typeof showSessionModal === 'function') {
            showSessionModal(title, messages);
        } else {
            var w = window.open('', '_blank');
            if (w) {
                var html = '<style>body{font-family:monospace;font-size:13px;padding:20px;max-width:900px;margin:0 auto}</style>';
                messages.forEach(function (m) {
                    var role = m.role || (m.info && m.info.role) || 'unknown';
                    var content = m.content != null ? m.content : ((m.parts && m.parts[0] && m.parts[0].text) || '');
                    if (!content || content.trim() === '') return;
                    html += '<div style="margin-bottom:16px;border-left:3px solid #ccc;padding-left:12px"><b style="color:';
                    html += role === 'user' ? '#0066cc' : role === 'assistant' ? '#009933' : '#999';
                    html += '">' + _ccEsc(role) + '</b><pre style="white-space:pre-wrap;margin-top:4px">' + _ccEsc(content) + '</pre></div>';
                });
                w.document.write(html);
                w.document.title = title;
            }
        }
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = '💬 查看对话'; }
        toast('error', '获取对话失败: ' + e.message);
    }
}

/* ── 错误提示 ────────────────────────────────────────────────────────── */
function _showCCErr(msg) {
    var el = $('cc-error');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = '错误：' + msg;
}

/* ── 注册面板初始化 ──────────────────────────────────────────────────── */
if (typeof Nav !== 'undefined' && Nav.register) {
    Nav.register('p-codecheck', initCodeCheckPanel);
}
