/* ════════════════════════════════════════════════════════════════════
 * flutterlibrarycheck.js — Flutter 仓库检视模块（前端编排）
 *
 * 设计理念（与 codecheck.js 一致）：后端不感知定制化，前端直接调用
 * 通用 Orchestrator API 完成固定编排。
 *
 * 编排流程（参考 AIweb FlutterLibraryCheck：接口分析先行 + 5 维检视并发）：
 *   步骤 1  flutter-interface                            — 克隆仓库 + 接口规格分析
 *   步骤 2~6 stability / consistency / memoryLeak /      — 5 个检视维度并发执行
 *            documentation / testCoverage                  （dependId=1 fan-out）
 *
 * 每个检视 SKILL 输出 0-100 评分：
 *   - 首选：SKILL 按约定写 meta .json（stepId{X}_loop{L}_meta_{N}.json），
 *     后端收割为 step.metrics（如 { stabilityScore: 85 }），随 progress / SSE 推送，
 *     终态后合并入注册表 metadata（历史列表直接回填，参考 prcheck 的 mergeLevel 机制）
 *   - 兜底：读取检视报告文本，正则解析 `**综合评分：XX/100**`
 *
 * 前端编排时序：
 *   1. 构造 6 步 taskDef（specifiedSkill 固定指定 SKILL，跳过自动匹配）
 *   2. POST /api/orchestrator/load  — 加载任务定义
 *   3. POST /api/orchestrator/start — 启动编排（步骤 2~6 依赖步骤 1 自动并发）
 *   4. GET  /stream/tasks/:taskId   — SSE 实时监控（orch:step:status 含 metrics）
 *   5. GET  /api/orchestrator/progress?taskId= — 轮询进度（SSE 补充）
 *   6. GET  /api/flexrunner/steps?taskId= — 解析报告文件（懒加载）
 *   7. GET  /api/flexrunner/file?path= — 读取报告 / 评分兜底解析
 *   8. POST /api/orchestrator/abort — 取消任务
 *
 * 依赖：utils.js（apiFetch / createPagination / escapeHtml / toast / $）
 *       codecheck.css（cc-* 通用卡片样式）+ flutterlibrarycheck.css（flc-* 扩展样式）
 *       md-reader.js（MarkdownReader）、loop.js（showSessionModal）
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── 编排配置：6 个 SKILL 步骤（stepId 固定，历史恢复依赖此顺序）───────── */
var _FLC_STEP_DEFS = [
    { stepId: 1, key: 'interface',     skill: 'flutter-interface',                          num: '①', name: '接口分析',     desc: '克隆仓库并提取公开接口规格',           report: '接口规格说明.md',    scoreKey: null },
    { stepId: 2, key: 'stability',     skill: 'flutter-library-stability-check',            num: '②', name: '稳定性检视',   desc: '异常处理、资源释放、并发安全',         report: '稳定性检视报告.md',  scoreKey: 'stabilityScore' },
    { stepId: 3, key: 'consistency',   skill: 'flutter-library-consistency-check',          num: '③', name: '一致性检视',   desc: 'API 契约、平台实现一致性',             report: '一致性检视报告.md',  scoreKey: 'consistencyScore' },
    { stepId: 4, key: 'memoryleak',    skill: 'flutter-library-memory-leak-check',          num: '④', name: '内存泄露检视', desc: '生命周期、资源释放、Stream 管理',      report: '内存泄露检视报告.md', scoreKey: 'memoryLeakScore' },
    { stepId: 5, key: 'documentation', skill: 'flutter-library-documentation-quality-check', num: '⑤', name: '文档质量检视', desc: '鸿蒙化文档完整性、准确性、易读性',     report: '文档质量检视报告.md', scoreKey: 'documentationScore' },
    { stepId: 6, key: 'testcoverage',  skill: 'flutter-library-test-coverage-check',        num: '⑥', name: '用例覆盖度检视', desc: '测试覆盖率、Demo 覆盖率',           report: '用例覆盖度检视报告.md', scoreKey: 'testCoverageScore' },
];

/* 评分权重（与 AIweb FlutterLibraryCheck 综合评分口径一致，权重和 = 1） */
var _FLC_WEIGHTS = { stability: 0.20, consistency: 0.20, memoryleak: 0.20, documentation: 0.15, testcoverage: 0.25 };

/* 用例覆盖度检视的附属脚本报告 */
var _FLC_EXTRA_REPORTS = {
    testcoverage: [
        { key: 'democoverage', report: '02-Demo覆盖率报告.md', label: 'Demo覆盖率' },
        { key: 'xtscoverage',  report: '03-XTS覆盖率报告.md',  label: 'XTS覆盖率' },
    ],
};

/* ── 状态 ────────────────────────────────────────────────────────────── */
var _flcCounter = 0;
var _flcTasks = {};   // idx -> { taskId, repoUrl, repoName, sse, timer, pollTimer, startTime, startedAt, finishedAt,
                       //          scores: { stability, consistency, memoryleak, documentation, testcoverage, overall },
                       //          stepStatus: { interface: 'pending', ... },
                       //          reportPaths: { interface: '/abs/接口规格说明.md', ... }, filesResolved }
var _flcPager = null;
var _flcInited = false;

/* ── 阶段标签（映射 Orchestrator 状态）──────────────────────────────── */
var _FLC_STAGE_LABELS = {
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

var _FLC_STEP_STATUS_LABELS = {
    pending:   '等待中…',
    ready:     '就绪…',
    running:   '正在检视…',
    completed: '已完成 ✓',
    failed:    '失败 ✗',
    skipped:   '已跳过',
    blocked:   '已阻塞',
};

/* ════════════════════════════════════════════════════════════════════
 * 工具函数
 * ════════════════════════════════════════════════════════════════════ */

function _flcEsc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _flcFormatTime(isoString) {
    if (!isoString) return '';
    try {
        return new Date(isoString).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    } catch (e) { return isoString; }
}

/**
 * 从仓库地址解析仓库名（支持 .git 后缀 / tree 子路径 / ?branch= 查询参数 / 本地路径）。
 */
function _flcParseRepoInfo(repoUrl) {
    var info = { repoName: 'repo', branch: '', url: repoUrl || '' };
    if (!repoUrl) return info;
    try {
        var u = new URL(repoUrl);
        var parts = u.pathname.split('/').filter(Boolean);
        var repoSeg = '';
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === 'tree' || parts[i] === 'blob' || parts[i] === 'pulls' || parts[i] === 'pull' || parts[i] === 'issues') break;
            repoSeg = parts[i];
        }
        if (repoSeg) info.repoName = decodeURIComponent(repoSeg.replace(/\.git$/, ''));
        info.branch = u.searchParams.get('branch') || '';
    } catch (e) {
        // 本地路径输入
        var segs = String(repoUrl).replace(/[\/\\]+$/, '').split(/[\/\\]/);
        if (segs.length && segs[segs.length - 1]) {
            info.repoName = segs[segs.length - 1].replace(/\.git$/, '');
        }
    }
    return info;
}

/** taskId（fluttercheck_{repoName}_{ts36}）→ 仓库名 */
function _flcTaskIdToRepoName(taskId) {
    if (!taskId) return '—';
    var rest = taskId.replace(/^fluttercheck_/, '');
    var parts = rest.split('_');
    if (parts.length >= 2) {
        parts.pop(); // 去掉末尾时间戳段
        return parts.join('_');
    }
    return rest.length > 40 ? rest.substring(0, 40) + '…' : rest;
}

/**
 * 从报告文本解析 0-100 评分（兜底，同 AIweb _parseFlutterLibraryScore 正则）。
 */
function _flcParseScoreFromReport(content) {
    if (!content) return null;
    var m = content.match(/\*?\*?综合评分[：:\s]*(\d{1,3})\s*\/\s*100/i);
    if (!m) m = content.match(/(?:【总体评分】|\*?\*?评分)[：:\s]*(\d{1,3})\s*\/\s*100/i);
    if (!m) m = content.match(/得分[：:\s]*(\d{1,3})/i);
    if (!m) return null;
    var v = parseInt(m[1], 10);
    if (!isFinite(v)) return null;
    return Math.max(0, Math.min(100, v));
}

/**
 * 从步骤 metrics 提取评分。优先维度专用键（历史列表合并无同名冲突），
 * 兼容通用 score 键。
 */
function _flcExtractStepScore(stepDef, metrics) {
    if (!stepDef.scoreKey || !metrics || typeof metrics !== 'object') return null;
    var v = metrics[stepDef.scoreKey];
    if (v == null) v = metrics.score;
    v = Number(v);
    if (!isFinite(v)) return null;
    return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * 综合评分：5 个维度评分齐全时按权重计算（口径同 AIweb），否则返回 null。
 */
function _flcComputeOverall(scores) {
    var dims = ['stability', 'consistency', 'memoryleak', 'documentation', 'testcoverage'];
    for (var i = 0; i < dims.length; i++) {
        if (scores[dims[i]] == null) return null;
    }
    return Math.round(
        scores.stability * _FLC_WEIGHTS.stability +
        scores.consistency * _FLC_WEIGHTS.consistency +
        scores.memoryleak * _FLC_WEIGHTS.memoryleak +
        scores.documentation * _FLC_WEIGHTS.documentation +
        scores.testcoverage * _FLC_WEIGHTS.testcoverage
    );
}

function _flcGuardSubmit(btn, loadingText, normalText) {
    if (!btn || btn.disabled) return false;
    btn.disabled = true;
    btn.textContent = loadingText;
    btn._flcNormalText = normalText;
    return true;
}

function _flcGuardSubmitRestore(btn) {
    if (!btn) return;
    var normalText = btn._flcNormalText || '提交';
    setTimeout(function () {
        if (btn.disabled) { btn.disabled = false; btn.textContent = normalText; }
    }, 5000);
}

function _flcGuardSubmitReset(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = btn._flcNormalText || '提交';
}

function _flcShowErr(msg) {
    var el = $('flc-error');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = '错误：' + msg;
}

/* ════════════════════════════════════════════════════════════════════
 * 面板初始化（懒加载，由 Nav.register 触发）
 * ════════════════════════════════════════════════════════════════════ */

function initFlutterLibraryCheckPanel() {
    if (_flcInited) return;
    _flcInited = true;

    _flcRenderSkillIntro();

    // 历史任务
    _flcInitHistoryPager().then(function (pg) { if (pg) pg.load(1); });

    // 提交按钮
    var btn = $('flc-submit-btn');
    if (btn) btn.addEventListener('click', doFlutterLibraryCheck);

    // 回车提交
    var urlInput = $('flc-repo-url');
    if (urlInput) {
        urlInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doFlutterLibraryCheck();
        });
    }

    // 高级选项折叠
    var advToggle = $('flc-advanced-toggle');
    if (advToggle) {
        advToggle.addEventListener('click', function () {
            var section = $('flc-advanced-section');
            if (section) {
                section.classList.toggle('show');
                advToggle.classList.toggle('open');
            }
        });
    }
}

/* ── SKILL 流程介绍（静态渲染）─────────────────────────────────────── */

function _flcRenderSkillIntro() {
    var container = $('flc-skill-intro');
    if (!container) return;

    var stepsHtml = _FLC_STEP_DEFS.map(function (s, i) {
        var weight = s.scoreKey ? ' · 权重 ' + Math.round(_FLC_WEIGHTS[s.key] * 100) + '%' : ' · 前置步骤';
        var arrow = i < _FLC_STEP_DEFS.length - 1 && i === 0 ? '<span class="flc-flow-arrow">→</span>' : '';
        return '<div class="flc-flow-step">' +
            '<span class="flc-flow-num">' + s.num + '</span>' +
            '<div class="flc-flow-info"><div class="flc-flow-name">' + _flcEsc(s.name) + '</div>' +
            '<div class="flc-flow-desc">' + _flcEsc(s.desc) + weight + '</div></div>' +
            arrow + '</div>';
    }).join('');

    container.innerHTML =
        '<div class="cc-skill-header">' +
            '<span class="cc-skill-icon">🦋</span>' +
            '<span class="cc-skill-title">Flutter 仓库检视 — 6 步 SKILL 编排</span>' +
        '</div>' +
        '<div class="cc-skill-card">' +
            '<div class="cc-skill-card-header">' +
                '<div style="display:flex;align-items:center;gap:8px;flex:1">' +
                    '<span class="cc-skill-badge" style="background:rgba(59,130,246,0.12);color:#3b82f6;border:1px solid rgba(59,130,246,0.3)">FLUTTER</span>' +
                    '<span class="cc-skill-name">接口分析 + 5 维并发检视（0-100 严苛评分）</span>' +
                '</div>' +
            '</div>' +
            '<div class="cc-skill-card-desc">' +
                '先克隆仓库并提取接口规格（flutter-interface），随后稳定性 / 一致性 / 内存泄露 / 文档质量 / 用例覆盖度 5 个检视 SKILL 并发执行，' +
                '每个维度独立输出 0-100 评分与检视报告，综合评分 = 稳定性×20% + 一致性×20% + 内存泄露×20% + 文档质量×15% + 用例覆盖度×25%。' +
            '</div>' +
            '<div class="flc-flow">' + stepsHtml + '</div>' +
        '</div>';
}

/* ════════════════════════════════════════════════════════════════════
 * 提交检视（前端编排：构造 taskDef → load → start）
 * ════════════════════════════════════════════════════════════════════ */

async function doFlutterLibraryCheck() {
    var repoUrl = $('flc-repo-url').value.trim();
    var skillDir = $('flc-skill-dir') ? $('flc-skill-dir').value.trim() : '';

    if (!repoUrl) { _flcShowErr('仓库地址不能为空'); return; }

    var btn = $('flc-submit-btn');
    if (!_flcGuardSubmit(btn, '提交中…', '▶ 开始检视')) return;
    $('flc-error').style.display = 'none';

    try {
        // ── 1. 解析仓库信息，生成 taskId ──
        var repoInfo = _flcParseRepoInfo(repoUrl);
        var safeName = repoInfo.repoName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'repo';
        var ts = Date.now().toString(36);
        var taskId = 'fluttercheck_' + safeName + '_' + ts;

        // ── 2. 构造 6 步 taskDef ──
        // 步骤 1：接口分析（克隆仓库 + 接口规格说明.md）
        // 步骤 2~6：5 个检视维度，dependId=1 fan-out 并发（编排器自动并行执行）
        // specifiedSkill 固定指定 SKILL，跳过 SkillSelector 自动匹配
        // body.title 编码 repoUrl，供历史恢复解析（格式: Flutter仓库检视|{repoUrl}）
        var interfaceDesc = [
            '请使用 flutter-interface SKILL 分析 Flutter 三方库「' + repoInfo.repoName + '」的对外接口能力，克隆仓库并生成接口规格说明文档。',
            '',
            '任务参数：',
            '- input（Git 仓库地址）: ' + repoUrl,
            '- repoName: ' + repoInfo.repoName,
            '- outputDir: 即当前工作目录（见下方"工作目录"，绝对路径），所有输出文件放在该目录根下',
        ].join('\n');

        var steps = [{
            stepId: 1,
            taskDescription: interfaceDesc,
            dependId: 0,
            nextStepId: 0,
            failStepId: 0,
            maxRetries: 3,
            skillDirectory: skillDir || '',
            specifiedSkill: 'flutter-interface',
            inputReport: '',
        }];

        // 5 个检视步骤（并发）：依赖步骤 1 已克隆的 source/ 和 接口规格说明.md
        for (var i = 1; i < _FLC_STEP_DEFS.length; i++) {
            var def = _FLC_STEP_DEFS[i];
            var desc = [
                '请使用 ' + def.skill + ' SKILL 对 Flutter 三方库「' + repoInfo.repoName + '」进行' + def.name + '，生成检视报告。',
                '',
                '任务参数：',
                '- repoUrl: ' + repoUrl,
                '- repoName: ' + repoInfo.repoName,
                '- outputDir: 即当前工作目录（见下方"工作目录"，绝对路径）',
                '- interfaceDocPath: {outputDir}/接口规格说明.md（前置接口分析步骤已生成）',
                '- 仓库源码已由前置步骤克隆在 {outputDir}/source/ 目录下，直接分析即可，请勿重新克隆',
                '- 输入报告路径为前置步骤的执行结果记录，仅供参考；接口规格文档以 interfaceDocPath 为准',
            ].join('\n');

            steps.push({
                stepId: def.stepId,
                taskDescription: desc,
                dependId: 1,
                nextStepId: 0,
                failStepId: 0,
                maxRetries: 3,
                skillDirectory: skillDir || '',
                specifiedSkill: def.skill,
                inputReport: '',
            });
        }

        var taskDef = {
            taskId: taskId,
            title: 'Flutter仓库检视|' + repoUrl,
            skillDirectory: skillDir || '',
            loopCount: 0,
            steps: steps,
        };

        // ── 3. POST /api/orchestrator/load ──
        var loadR = await apiFetch('POST', '/api/orchestrator/load', taskDef);
        if (loadR.status >= 400 || !loadR.data || loadR.data.status !== 'ok') {
            _flcShowErr((loadR.data && (loadR.data.error || loadR.data.message)) || ('HTTP ' + loadR.status));
            _flcGuardSubmitReset(btn);
            return;
        }

        // ── 4. POST /api/orchestrator/start ──
        var startR = await apiFetch('POST', '/api/orchestrator/start', { taskId: taskId });
        if (startR.status >= 400 || !startR.data || startR.data.status !== 'ok') {
            _flcShowErr((startR.data && (startR.data.error || startR.data.message)) || ('HTTP ' + startR.status));
            _flcGuardSubmitReset(btn);
            return;
        }

        // ── 5. 创建任务卡片 + SSE + 轮询 ──
        var idx = ++_flcCounter;
        _flcTasks[idx] = _flcNewTaskState(taskId, repoUrl, repoInfo.repoName);

        _flcCreateCard(idx, new Date().toISOString(), false);
        _flcConnectSSE(idx);
        _flcStartProgressPoll(idx);

        _flcGuardSubmitRestore(btn);
        toast('success', '检视任务已启动: ' + repoInfo.repoName);

    } catch (e) {
        _flcShowErr(e.message);
        _flcGuardSubmitReset(btn);
    }
}

function _flcNewTaskState(taskId, repoUrl, repoName) {
    return {
        taskId: taskId,
        repoUrl: repoUrl,
        repoName: repoName,
        sse: null,
        timer: null,
        pollTimer: null,
        startTime: Date.now(),
        startedAt: null,
        finishedAt: null,
        filesResolved: false,
        _lastResolveAt: 0,
        _resolving: false,
        _progressLoaded: false,
        _terminalDone: false,
        mdFileCount: 0,    // taskDir 下的 .md 文件数（驱动"下载全部报告"按钮）
        reportPaths: {},   // 各维度专属报告文件（如 稳定性检视报告.md）
        resultPaths: {},   // 各步骤 result .md 兜底路径（部分 SKILL 会把报告合入 result 文件）
        scores: { stability: null, consistency: null, memoryleak: null, documentation: null, testcoverage: null, overall: null },
        scoreReasons: {},  // 各维度评分判定依据（来自 meta .json 的 scoreReason，悬浮提示展示）
        stepStatus: {},
    };
}

/* ════════════════════════════════════════════════════════════════════
 * 任务卡片渲染
 * ════════════════════════════════════════════════════════════════════ */

function _flcCreateCard(idx, createdAt, isHistory) {
    var task = _flcTasks[idx];
    var emptyEl = $('flc-tasks-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    var countEl = $('flc-task-count');
    if (countEl) countEl.textContent = Object.keys(_flcTasks).length + ' 个任务';

    var timeLabel = createdAt ? _flcFormatTime(createdAt) : '';

    var card = document.createElement('div');
    card.className = 'cc-task-card running';
    card.id = 'flc-card-' + idx;
    card.innerHTML =
        '<div class="cc-card-header" onclick="toggleFLCCard(' + idx + ')">' +
            '<span class="cc-chevron">▶</span>' +
            '<span class="cc-run-dot"></span>' +
            '<span class="cc-lib">' + _flcEsc(task.repoName) + '</span>' +
            '<span class="cc-type-badge" style="background:rgba(59,130,246,0.12);color:#3b82f6">Flutter</span>' +
            '<span class="cc-spacer"></span>' +
            '<span class="cc-time" id="flc-' + idx + '-time">' + _flcEsc(timeLabel) + '</span>' +
            '<span class="cc-merge-badge" id="flc-' + idx + '-overall-badge" style="display:none"></span>' +
            '<span class="cc-stage-badge s-pending" id="flc-' + idx + '-badge">等待中</span>' +
            '<button class="cc-stop-btn" id="flc-' + idx + '-stop" onclick="event.stopPropagation();stopFLCTask(' + idx + ')" title="取消检视">■ 取消</button>' +
            '<span class="cc-elapsed" id="flc-' + idx + '-elapsed" style="display:none">0s</span>' +
        '</div>' +
        '<div class="cc-card-body" id="flc-' + idx + '-body"' + (isHistory ? ' style="display:none"' : '') + '>' +
            '<div class="cc-meta" title="' + _flcEsc(task.repoUrl) + '">' +
                '<span class="cc-meta-label">仓库：</span>' +
                '<span class="cc-meta-value">' + _flcEsc(task.repoUrl) + '</span>' +
            '</div>' +
            '<div class="flc-score-panel" id="flc-' + idx + '-score-panel" style="display:none">' +
                '<div class="flc-score-panel-title">📊 检视评分概览</div>' +
                '<div class="flc-score-overall-row">' +
                    '<span class="flc-score-label">综合评分</span>' +
                    '<span class="flc-score-value" id="flc-' + idx + '-overall-score" style="display:none">--</span>' +
                    '<span class="flc-score-weights">稳定性 20% · 一致性 20% · 内存泄露 20% · 文档质量 15% · 用例覆盖 25%</span>' +
                '</div>' +
                '<div class="flc-score-grid">' +
                    '<div class="flc-score-item"><span class="flc-score-item-label">稳定性</span><span class="flc-score-item-value" id="flc-' + idx + '-dim-stability">--</span></div>' +
                    '<div class="flc-score-item"><span class="flc-score-item-label">一致性</span><span class="flc-score-item-value" id="flc-' + idx + '-dim-consistency">--</span></div>' +
                    '<div class="flc-score-item"><span class="flc-score-item-label">内存泄露</span><span class="flc-score-item-value" id="flc-' + idx + '-dim-memoryleak">--</span></div>' +
                    '<div class="flc-score-item"><span class="flc-score-item-label">文档质量</span><span class="flc-score-item-value" id="flc-' + idx + '-dim-documentation">--</span></div>' +
                    '<div class="flc-score-item"><span class="flc-score-item-label">用例覆盖</span><span class="flc-score-item-value" id="flc-' + idx + '-dim-testcoverage">--</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="flc-steps-panel">' +
                '<div class="flc-steps-title-row">' +
                    '<div class="flc-steps-title">🔍 检视流程进度</div>' +
                    '<button class="flc-archive-btn" id="flc-' + idx + '-archive-btn" onclick="event.stopPropagation();downloadFLCArchive(' + idx + ')" style="display:none" title="打包下载任务目录下的全部 .md 报告文件（ZIP）">📦 下载全部报告</button>' +
                '</div>' +
                '<div class="flc-steps-list">' +
                    _FLC_STEP_DEFS.map(function (def) { return _flcStepRowHtml(idx, def); }).join('') +
                '</div>' +
            '</div>' +
        '</div>';

    var list = $('flc-tasks-list');
    list.insertBefore(card, list.firstChild);

    // 非历史（新提交）任务默认展开
    if (!isHistory) {
        card.classList.add('open');
    }

    // 历史已完成任务：显示固定时长；进行中任务：启动计时器
    if (isHistory && task.finishedAt && task.startedAt) {
        _flcRenderElapsed(idx);
    } else {
        task.timer = setInterval(function () {
            var s = Math.floor((Date.now() - _flcTasks[idx].startTime) / 1000);
            var el = document.getElementById('flc-' + idx + '-elapsed');
            if (el) el.textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        }, 1000);
    }
}

function _flcStepRowHtml(idx, def) {
    return '<div class="flc-step-row" id="flc-' + idx + '-row-' + def.key + '">' +
        '<div class="flc-step-icon" id="flc-' + idx + '-icon-' + def.key + '">' + def.num + '</div>' +
        '<div class="flc-step-info">' +
            '<div class="flc-step-name">' + _flcEsc(def.name) +
                (def.scoreKey ? ' <span class="flc-step-weight">权重 ' + Math.round(_FLC_WEIGHTS[def.key] * 100) + '%</span>' : '') +
            '</div>' +
            '<div class="flc-step-desc" id="flc-' + idx + '-' + def.key + '-txt">等待中…</div>' +
        '</div>' +
        '<div class="flc-step-actions">' +
            '<span class="flc-step-score" id="flc-' + idx + '-score-' + def.key + '" style="display:none">--</span>' +
            '<button class="cc-preview-btn" id="flc-' + idx + '-view-' + def.key + '" onclick="event.stopPropagation();viewFLCReport(' + idx + ', \'' + def.key + '\')" style="display:none">↗ 预览</button>' +
            '<button class="cc-download-btn" id="flc-' + idx + '-download-' + def.key + '" onclick="event.stopPropagation();downloadFLCReport(' + idx + ', \'' + def.key + '\')" style="display:none">↓ 下载</button>' +
            '<button class="flc-session-btn" id="flc-' + idx + '-session-' + def.key + '" onclick="event.stopPropagation();viewFLCSession(' + idx + ', ' + def.stepId + ', \'' + def.key + '\')" style="display:none">💬</button>' +
        '</div>' +
    '</div>';
}

/* ── 卡片折叠（展开时懒加载报告文件与评分兜底）──────────────────────── */

function toggleFLCCard(idx) {
    var card = document.getElementById('flc-card-' + idx);
    var body = document.getElementById('flc-' + idx + '-body');
    if (!card || !body) return;
    var isOpen = card.classList.toggle('open');
    body.style.display = isOpen ? '' : 'none';
    if (isOpen) {
        var task = _flcTasks[idx];
        if (!task) return;
        if (!task.filesResolved) _flcResolveFiles(idx);
        // 历史终态任务（无 SSE/轮询）：展开时加载一次进度，恢复步骤状态与 metrics 评分
        if (!task.pollTimer && !task.sse) _flcLoadProgressOnce(idx);
        _flcFallbackScores(idx);
    }
}

/**
 * 一次性加载编排进度（历史终态任务展开时调用）：
 * 从磁盘恢复的 orchestration.json 中读取各步骤状态与 metrics 评分。
 */
function _flcLoadProgressOnce(idx) {
    var task = _flcTasks[idx];
    if (!task || task._progressLoaded) return;
    task._progressLoaded = true;

    apiFetch('GET', '/api/orchestrator/progress?taskId=' + encodeURIComponent(task.taskId), null, 15000)
        .then(function (r) {
            if (!r.data || r.data.status !== 'ok' || !r.data.progress) return;
            var progress = r.data.progress;
            _flcUpdateStage(idx, progress.status, progress);
            if (progress.steps) {
                for (var i = 0; i < progress.steps.length; i++) {
                    _flcHandleStepStatus(idx, progress.steps[i]);
                }
            }
            _flcRenderElapsed(idx);
        })
        .catch(function () {
            // 失败允许重试（下次展开时再加载）
            if (_flcTasks[idx]) _flcTasks[idx]._progressLoaded = false;
        });
}

/* ════════════════════════════════════════════════════════════════════
 * SSE 连接（监听 Orchestrator 事件）
 * ════════════════════════════════════════════════════════════════════ */

function _flcConnectSSE(idx) {
    var task = _flcTasks[idx];
    if (!task) return;

    if (task.sse && (task.sse.readyState === EventSource.OPEN || task.sse.readyState === EventSource.CONNECTING)) {
        return;
    }
    if (task.sse) { var old = task.sse; task.sse = null; old.close(); }

    var sse = new EventSource('/stream/tasks/' + encodeURIComponent(task.taskId));
    task.sse = sse;
    var sseDone = false;

    // 步骤状态变更（含 metrics 评分回填）
    sse.addEventListener('orch:step:status', function (e) {
        var data; try { data = JSON.parse(e.data); } catch (err) { data = {}; }
        _flcHandleStepStatus(idx, data);
    });

    sse.addEventListener('orch:task:start', function () {
        _flcUpdateStage(idx, 'running');
    });

    sse.addEventListener('orch:task:complete', function (e) {
        sseDone = true;
        var data; try { data = JSON.parse(e.data); } catch (err) { data = {}; }
        var status = data.status || 'completed';
        _flcUpdateStage(idx, status);
        _flcOnTerminal(idx, status);
    });

    sse.addEventListener('orch:task:error', function () {
        _flcUpdateStage(idx, 'failed');
    });

    sse.addEventListener('orch:task:aborted', function () {
        sseDone = true;
        _flcUpdateStage(idx, 'aborted');
        _flcOnTerminal(idx, 'aborted');
    });

    sse.onerror = function () {
        if (sseDone) { sse.close(); return; }
        // 轮询作为兜底，SSE 断开不额外重连
    };
}

/**
 * 处理步骤状态事件 / progress 中的步骤快照。
 * @param {number} idx
 * @param {object} step - { stepId, status, metrics, startTime, endTime, resultPath, ... }
 */
function _flcHandleStepStatus(idx, step) {
    if (!step || step.stepId == null) return;
    var task = _flcTasks[idx];
    if (!task) return;

    var def = null;
    for (var i = 0; i < _FLC_STEP_DEFS.length; i++) {
        if (String(_FLC_STEP_DEFS[i].stepId) === String(step.stepId)) { def = _FLC_STEP_DEFS[i]; break; }
    }
    if (!def) return;

    if (step.startTime) task.startedAt = step.startTime;

    _flcUpdateStepRow(idx, def, step.status || 'pending');

    // 评分回填：步骤完成时从 metrics 提取（meta .json 已由后端收割）
    if (step.status === 'completed') {
        var score = _flcExtractStepScore(def, step.metrics);
        var reason = (step.metrics && typeof step.metrics.scoreReason === 'string')
            ? step.metrics.scoreReason : null;
        if (score != null) {
            _flcSetStepScore(idx, def, score, reason);
        } else if (reason) {
            task.scoreReasons[def.key] = reason;
        }
        // 步骤完成即尝试解析报告文件（显示预览/下载按钮）
        _flcResolveFiles(idx);
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 进度轮询（SSE 补充）
 * ════════════════════════════════════════════════════════════════════ */

function _flcStartProgressPoll(idx) {
    var task = _flcTasks[idx];
    if (!task || task.pollTimer) return;

    task.pollTimer = setInterval(async function () {
        try {
            var r = await apiFetch('GET', '/api/orchestrator/progress?taskId=' + encodeURIComponent(task.taskId), null, 10000);
            if (!r.data || r.data.status !== 'ok') return;

            var progress = r.data.progress;
            if (!progress) return;

            _flcUpdateStage(idx, progress.status, progress);

            if (progress.steps && progress.steps.length > 0) {
                for (var i = 0; i < progress.steps.length; i++) {
                    _flcHandleStepStatus(idx, progress.steps[i]);
                }
            }

            if (['completed', 'failed', 'aborted', 'deadlocked'].indexOf(progress.status) >= 0) {
                _flcOnTerminal(idx, progress.status);
            }
        } catch (e) { /* 静默失败 */ }
    }, 3000);
}

function _flcStopProgressPoll(idx) {
    var task = _flcTasks[idx];
    if (task && task.pollTimer) {
        clearInterval(task.pollTimer);
        task.pollTimer = null;
    }
}

/* ════════════════════════════════════════════════════════════════════
 * UI 更新
 * ════════════════════════════════════════════════════════════════════ */

function _flcUpdateStage(idx, stage, progress) {
    var task = _flcTasks[idx];
    if (!task) return;
    if (progress) {
        if (progress.startTime) task.startedAt = progress.startTime;
        if (progress.endTime) task.finishedAt = progress.endTime;
    }

    var badge = document.getElementById('flc-' + idx + '-badge');
    if (badge) {
        badge.className = 'cc-stage-badge s-' + stage;
        badge.textContent = _FLC_STAGE_LABELS[stage] || stage;
    }
}

function _flcUpdateStepRow(idx, def, status) {
    var task = _flcTasks[idx];
    if (!task) return;
    task.stepStatus[def.key] = status;

    var icon = document.getElementById('flc-' + idx + '-icon-' + def.key);
    var txt = document.getElementById('flc-' + idx + '-' + def.key + '-txt');
    var row = document.getElementById('flc-' + idx + '-row-' + def.key);
    var sessionBtn = document.getElementById('flc-' + idx + '-session-' + def.key);

    if (row) row.className = 'flc-step-row ' + status;

    if (icon) {
        if (status === 'running') {
            icon.className = 'flc-step-icon running';
            icon.textContent = '🔄';
        } else if (status === 'completed') {
            icon.className = 'flc-step-icon completed';
            icon.textContent = '✓';
        } else if (status === 'failed') {
            icon.className = 'flc-step-icon failed';
            icon.textContent = '✗';
        } else if (status === 'skipped' || status === 'blocked') {
            icon.className = 'flc-step-icon skipped';
            icon.textContent = '⊘';
        } else {
            icon.className = 'flc-step-icon';
            icon.textContent = def.num;
        }
    }
    if (txt) txt.textContent = _FLC_STEP_STATUS_LABELS[status] || status;

    // 对话按钮：已执行（含失败）即可查看会话
    if (sessionBtn && ['completed', 'failed'].indexOf(status) >= 0) {
        sessionBtn.style.display = 'inline-flex';
    }
}

/**
 * 设置步骤评分：更新步骤徽章、评分概览面板、综合评分。
 * @param {number} idx
 * @param {object} def - 步骤定义
 * @param {number} score - 0-100 评分
 * @param {string|null} [reason] - 评分判定依据（meta .json 的 scoreReason）
 */
function _flcSetStepScore(idx, def, score, reason) {
    var task = _flcTasks[idx];
    if (!task || score == null || !def.scoreKey) return;

    // 评分依据先落缓存（已有评分不覆盖，但依据允许补充）
    if (reason && !task.scoreReasons[def.key]) task.scoreReasons[def.key] = reason;

    // 已有评分不覆盖（避免轮询旧值覆盖新值）
    if (task.scores[def.key] != null) { _flcRenderScorePanel(idx); return; }
    task.scores[def.key] = score;

    // 步骤行评分徽章
    var scoreEl = document.getElementById('flc-' + idx + '-score-' + def.key);
    if (scoreEl) {
        scoreEl.style.display = 'inline-flex';
        scoreEl.textContent = score + '分';
        _flcApplyScoreStyle(scoreEl, score);
        if (task.scoreReasons[def.key]) {
            scoreEl.title = '评分依据：' + task.scoreReasons[def.key];
            scoreEl.style.cursor = 'help';
        }
    }

    // 评分概览面板
    _flcRenderScorePanel(idx);
}

/** 评分概览面板渲染（维度评分 + 综合评分 + 头部总分徽章） */
function _flcRenderScorePanel(idx) {
    var task = _flcTasks[idx];
    if (!task) return;

    var hasAny = false;
    for (var k in _FLC_WEIGHTS) { if (task.scores[k] != null) { hasAny = true; break; } }

    var panel = document.getElementById('flc-' + idx + '-score-panel');
    if (panel && hasAny) panel.style.display = 'block';

    var dims = ['stability', 'consistency', 'memoryleak', 'documentation', 'testcoverage'];
    for (var i = 0; i < dims.length; i++) {
        var key = dims[i];
        var el = document.getElementById('flc-' + idx + '-dim-' + key);
        if (!el) continue;
        if (task.scores[key] != null) {
            el.style.display = 'inline-flex';
            el.textContent = task.scores[key] + '分';
            _flcApplyScoreStyle(el, task.scores[key]);
        }
        // 评分依据悬浮提示（区分"很差"与"一票否决"等严苛规则判定）
        if (task.scoreReasons[key]) {
            el.title = task.scoreReasons[key];
            el.style.cursor = 'help';
        }
    }

    // 综合评分（5 维齐全才计算）
    if (task.scores.overall == null) {
        task.scores.overall = _flcComputeOverall(task.scores);
    }
    if (task.scores.overall != null) {
        var overallEl = document.getElementById('flc-' + idx + '-overall-score');
        if (overallEl) {
            overallEl.style.display = 'inline-flex';
            overallEl.textContent = task.scores.overall + '分';
            _flcApplyScoreStyle(overallEl, task.scores.overall, true);
        }
        var badge = document.getElementById('flc-' + idx + '-overall-badge');
        if (badge) {
            badge.style.display = 'inline-flex';
            badge.textContent = '综合 ' + task.scores.overall + '分';
            badge.style.color = task.scores.overall >= 80 ? 'var(--green)' : task.scores.overall >= 60 ? 'var(--orange)' : 'var(--red)';
            badge.style.background = task.scores.overall >= 80 ? 'rgba(52,199,89,0.15)' : task.scores.overall >= 60 ? 'rgba(255,149,0,0.15)' : 'rgba(255,59,48,0.15)';
        }
    }
}

/** 评分样式：≥80 绿 / ≥60 橙 / <60 红 */
function _flcApplyScoreStyle(el, score, isLarge) {
    if (!el) return;
    if (score >= 80) {
        el.style.color = 'var(--green)';
        el.style.background = 'rgba(52,199,89,0.12)';
        el.style.border = isLarge ? '1px solid rgba(52,199,89,0.3)' : 'none';
    } else if (score >= 60) {
        el.style.color = 'var(--orange)';
        el.style.background = 'rgba(255,149,0,0.12)';
        el.style.border = isLarge ? '1px solid rgba(255,149,0,0.3)' : 'none';
    } else {
        el.style.color = 'var(--red)';
        el.style.background = 'rgba(255,59,48,0.12)';
        el.style.border = isLarge ? '1px solid rgba(255,59,48,0.3)' : 'none';
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 报告文件解析（懒加载：/api/flexrunner/steps 扫描 taskDir 下的 .md）
 * ════════════════════════════════════════════════════════════════════ */

async function _flcResolveFiles(idx) {
    var task = _flcTasks[idx];
    if (!task) return;

    // 全部专属报告已找到 → 幂等返回
    var allFound = true;
    for (var a = 0; a < _FLC_STEP_DEFS.length; a++) {
        if (!task.reportPaths[_FLC_STEP_DEFS[a].key]) { allFound = false; break; }
    }
    if (allFound) { task.filesResolved = true; _flcShowReportButtons(idx); return; }

    // 节流：进行中任务最多每 15s 解析一次（报告随步骤完成渐进生成）
    var now = Date.now();
    if (task._resolving) return;
    if (task._lastResolveAt && now - task._lastResolveAt < 15000) {
        _flcShowReportButtons(idx);
        return;
    }
    task._lastResolveAt = now;
    task._resolving = true;

    try {
        var r = await apiFetch('GET', '/api/flexrunner/steps?taskId=' + encodeURIComponent(task.taskId), null, 15000);
        if (!r.data || r.data.status !== 'ok') return;

        var files = r.data.files || [];
        var found = false;

        // .md 文件计数（steps 接口只返回 .md），驱动"下载全部报告"按钮
        if (files.length > 0) {
            task.mdFileCount = files.length;
        }

        for (var i = 0; i < files.length; i++) {
            var f = files[i];

            // 步骤 result .md 兜底路径（部分 SKILL 会把完整报告写入 result 文件）
            // 文件命名: stepId{N}_loop{L}_result_{R}.md，取重试号最大的最新一次
            var resMatch = (f.filename || '').match(/^stepId(\d+)_loop\d+_result_(\d+)\.md$/);
            if (resMatch) {
                var resDef = _flcDefByStepId(resMatch[1]);
                if (resDef) {
                    var retry = Number(resMatch[2]) || 0;
                    var prev = task.resultPaths[resDef.key];
                    if (!prev || retry >= (task._resultRetry || {})[resDef.key]) {
                        task.resultPaths[resDef.key] = f.path;
                        task._resultRetry = task._resultRetry || {};
                        task._resultRetry[resDef.key] = retry;
                        found = true;
                    }
                }
            }

            // 主报告映射（专属报告文件，优先于 result 兜底）
            for (var j = 0; j < _FLC_STEP_DEFS.length; j++) {
                var def = _FLC_STEP_DEFS[j];
                if (f.filename === def.report && !task.reportPaths[def.key]) {
                    task.reportPaths[def.key] = f.path;
                    found = true;
                }
            }
            // 附属脚本报告（用例覆盖度的 Demo/XTS 覆盖率）
            for (var key in _FLC_EXTRA_REPORTS) {
                var extras = _FLC_EXTRA_REPORTS[key];
                for (var m = 0; m < extras.length; m++) {
                    if (f.filename === extras[m].report && !task.reportPaths[extras[m].key]) {
                        task.reportPaths[extras[m].key] = f.path;
                        found = true;
                    }
                }
            }
        }

        if (found) _flcShowReportButtons(idx);
    } catch (e) { /* 静默失败 */ } finally {
        task._resolving = false;
    }
}

/** stepId（字符串）→ 步骤定义 */
function _flcDefByStepId(stepId) {
    for (var i = 0; i < _FLC_STEP_DEFS.length; i++) {
        if (String(_FLC_STEP_DEFS[i].stepId) === String(stepId)) return _FLC_STEP_DEFS[i];
    }
    return null;
}

/** 已完成且报告可用的步骤显示预览/下载按钮（专属报告或 result 兜底均可）；同步更新"下载全部报告"按钮 */
function _flcShowReportButtons(idx) {
    var task = _flcTasks[idx];
    if (!task) return;

    for (var i = 0; i < _FLC_STEP_DEFS.length; i++) {
        var def = _FLC_STEP_DEFS[i];
        if (task.reportPaths[def.key] || task.resultPaths[def.key]) {
            var viewBtn = document.getElementById('flc-' + idx + '-view-' + def.key);
            var dlBtn = document.getElementById('flc-' + idx + '-download-' + def.key);
            if (viewBtn) viewBtn.style.display = 'inline-flex';
            if (dlBtn) dlBtn.style.display = 'inline-flex';
        }
    }

    _flcUpdateArchiveButton(idx);
}

/** 更新"下载全部报告"按钮（有 .md 产物时显示，带文件数） */
function _flcUpdateArchiveButton(idx) {
    var task = _flcTasks[idx];
    if (!task) return;
    var btn = document.getElementById('flc-' + idx + '-archive-btn');
    if (!btn) return;
    var count = task.mdFileCount || 0;
    if (count > 0) {
        btn.style.display = 'inline-flex';
        btn.textContent = '📦 下载全部报告 (' + count + ')';
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 评分兜底：读取报告文本解析综合评分（SKILL 未写 meta .json 时）
 * ════════════════════════════════════════════════════════════════════ */

async function _flcFallbackScores(idx) {
    var task = _flcTasks[idx];
    if (!task) return;

    // 兜底只针对已完成的检视步骤且尚无评分的维度
    for (var i = 0; i < _FLC_STEP_DEFS.length; i++) {
        var def = _FLC_STEP_DEFS[i];
        if (!def.scoreKey) continue;
        if (task.scores[def.key] != null) continue;
        if (task.stepStatus[def.key] && task.stepStatus[def.key] !== 'completed') continue;

        // 需要报告文件路径；未解析过先触发解析（专属报告或 result .md 均可）
        if (!_flcGetReportPath(idx, def.key)) {
            await _flcResolveFiles(idx);
        }
        var path = _flcGetReportPath(idx, def.key);
        if (!path) continue;

        try {
            var r = await apiFetch('GET', '/api/flexrunner/file?path=' + encodeURIComponent(path), null, 15000);
            if (r.data && r.data.status === 'ok' && r.data.content) {
                var score = _flcParseScoreFromReport(r.data.content);
                if (score != null) _flcSetStepScore(idx, def, score);
            }
        } catch (e) { /* 静默失败 */ }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 终态处理
 * ════════════════════════════════════════════════════════════════════ */

function _flcOnTerminal(idx, status) {
    var task = _flcTasks[idx];
    if (!task || task._terminalDone) return;
    task._terminalDone = true;

    _flcStopProgressPoll(idx);
    _flcFinishSSE(idx);
    _flcResolveFiles(idx).then(function () {
        _flcFallbackScores(idx);
    });
}

function _flcFinishSSE(idx) {
    var task = _flcTasks[idx];
    if (!task) return;
    if (task.sse) { try { task.sse.close(); } catch (e) {} task.sse = null; }
    if (task.timer) { clearInterval(task.timer); task.timer = null; }

    _flcRenderElapsed(idx);

    var card = document.getElementById('flc-card-' + idx);
    if (card) {
        card.classList.remove('running');
        var badge = document.getElementById('flc-' + idx + '-badge');
        if (badge) {
            if (badge.classList.contains('s-completed')) card.classList.add('cc-done');
            else if (badge.classList.contains('s-failed') || badge.classList.contains('s-error') || badge.classList.contains('s-deadlocked')) card.classList.add('cc-failed');
            else if (badge.classList.contains('s-aborted')) card.classList.add('cc-cancelled');
        }
        var stopBtn = document.getElementById('flc-' + idx + '-stop');
        if (stopBtn) stopBtn.style.display = 'none';
    }
}

/** 已完成任务：用 startedAt/finishedAt 计算固定时长 */
function _flcRenderElapsed(idx) {
    var task = _flcTasks[idx];
    if (!task) return;
    var elapsedEl = document.getElementById('flc-' + idx + '-elapsed');
    if (!elapsedEl) return;

    var durationMs = 0;
    if (task.finishedAt && task.startedAt) {
        durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
    } else if (task.startedAt) {
        durationMs = Date.now() - new Date(task.startedAt).getTime();
    } else {
        durationMs = Date.now() - task.startTime;
    }
    if (durationMs < 0) durationMs = 0;
    var sec = Math.floor(durationMs / 1000);
    elapsedEl.textContent = sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    elapsedEl.style.display = 'inline';

    var timeEl = document.getElementById('flc-' + idx + '-time');
    if (timeEl && task.startedAt) timeEl.textContent = _flcFormatTime(task.startedAt);
}

/* ════════════════════════════════════════════════════════════════════
 * 停止检视
 * ════════════════════════════════════════════════════════════════════ */

async function stopFLCTask(idx) {
    var task = _flcTasks[idx];
    if (!task) return;
    var btn = document.getElementById('flc-' + idx + '-stop');
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
    _flcUpdateStage(idx, 'aborted');
    _flcOnTerminal(idx, 'aborted');
}

/* ════════════════════════════════════════════════════════════════════
 * 报告预览 / 下载
 * ════════════════════════════════════════════════════════════════════ */

/** stepKey 支持主维度键 + 附属报告键（democoverage / xtscoverage）；优先专属报告，回退步骤 result .md */
function _flcGetReportPath(idx, stepKey) {
    var task = _flcTasks[idx];
    if (!task) return null;
    return task.reportPaths[stepKey] || task.resultPaths[stepKey] || null;
}

function _flcGetReportTitle(idx, stepKey) {
    var task = _flcTasks[idx];
    if (!task) return '检视报告';
    for (var i = 0; i < _FLC_STEP_DEFS.length; i++) {
        if (_FLC_STEP_DEFS[i].key === stepKey) {
            return _FLC_STEP_DEFS[i].name + ' - ' + task.repoName;
        }
    }
    for (var k in _FLC_EXTRA_REPORTS) {
        var extras = _FLC_EXTRA_REPORTS[k];
        for (var m = 0; m < extras.length; m++) {
            if (extras[m].key === stepKey) return extras[m].label + ' - ' + task.repoName;
        }
    }
    return '检视报告 - ' + task.repoName;
}

async function viewFLCReport(idx, stepKey) {
    var task = _flcTasks[idx];
    if (!task) return;
    if (!task.reportPaths[stepKey]) await _flcResolveFiles(idx);

    var path = _flcGetReportPath(idx, stepKey);
    if (!path) { toast('warn', '报告尚未生成'); return; }

    try {
        var r = await apiFetch('GET', '/api/flexrunner/file?path=' + encodeURIComponent(path), null, 20000);
        if (!r.data || r.data.status !== 'ok') { toast('error', '读取报告失败'); return; }

        var title = _flcGetReportTitle(idx, stepKey);
        if (typeof MarkdownReader !== 'undefined' && MarkdownReader.open) {
            MarkdownReader.open(title, r.data.content);
        } else if (typeof showModal === 'function') {
            showModal(title, r.data.content);
        } else {
            var w = window.open('', '_blank');
            if (w) {
                w.document.write('<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;padding:20px;">' +
                    _flcEsc(r.data.content) + '</pre>');
                w.document.title = title;
            }
        }
    } catch (e) {
        toast('error', '预览失败: ' + e.message);
    }
}

async function downloadFLCReport(idx, stepKey) {
    var task = _flcTasks[idx];
    if (!task) return;
    if (!task.reportPaths[stepKey]) await _flcResolveFiles(idx);

    var path = _flcGetReportPath(idx, stepKey);
    if (!path) { toast('warn', '报告尚未生成'); return; }

    var filename = path.split(/[/\\]/).pop();
    try {
        var r = await fetch('/api/flexrunner/file?path=' + encodeURIComponent(path));
        if (!r.ok) { toast('error', '下载失败: HTTP ' + r.status); return; }
        var blob = await r.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        toast('error', '下载失败: ' + e.message);
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 打包下载全部报告（任务目录下全部 .md → ZIP）
 * ════════════════════════════════════════════════════════════════════ */

async function downloadFLCArchive(idx) {
    var task = _flcTasks[idx];
    if (!task) return;

    var btn = document.getElementById('flc-' + idx + '-archive-btn');
    var restoreBtn = function () {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📦 下载全部报告' + (task.mdFileCount ? ' (' + task.mdFileCount + ')' : '');
        }
    };
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 打包中…'; }

    try {
        var res = await fetch('/api/flexrunner/archive?taskId=' + encodeURIComponent(task.taskId));
        if (!res.ok) {
            var body = null;
            try { body = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
            toast('warn', (body && (body.error || body.message)) || ('下载失败: HTTP ' + res.status));
            return;
        }

        var blob = await res.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = task.taskId + '.zip';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
        toast('success', '已打包下载 ' + (task.mdFileCount || '') + ' 个报告文件');
    } catch (e) {
        toast('error', '下载失败: ' + e.message);
    } finally {
        restoreBtn();
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 查看步骤对话（每步一个 opencode Session）
 * ════════════════════════════════════════════════════════════════════ */

async function viewFLCSession(idx, stepId, stepKey) {
    var task = _flcTasks[idx];
    if (!task) return;

    var btn = document.getElementById('flc-' + idx + '-session-' + stepKey);
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    try {
        var url = '/api/flexrunner/session?taskId=' + encodeURIComponent(task.taskId) + '&stepId=' + encodeURIComponent(stepId);
        var r = await apiFetch('GET', url, null, 15000);
        if (btn) { btn.disabled = false; btn.textContent = '💬'; }

        if (!r.data || r.data.status !== 'ok') {
            toast('info', '暂无对话记录');
            return;
        }

        var messages = r.data.messages || [];
        if (messages.length === 0) {
            toast('info', '暂无对话消息');
            return;
        }

        var title = '对话记录 - ' + task.repoName + ' 步骤' + stepId;
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
                    html += '<div style="margin-bottom:16px;border-left:3px solid #ccc;padding-left:12px"><b style="color:' +
                        (role === 'user' ? '#0066cc' : role === 'assistant' ? '#009933' : '#999') + '">' + _flcEsc(role) +
                        '</b><pre style="white-space:pre-wrap;margin-top:4px">' + _flcEsc(content) + '</pre></div>';
                });
                w.document.write(html);
                w.document.title = title;
            }
        }
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = '💬'; }
        toast('error', '获取对话失败: ' + e.message);
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 历史任务（分页，/api/orchestrator/tasks 过滤 fluttercheck_ 前缀）
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 渲染一页历史任务卡片。
 * 数据全部来自列表响应（参考 prcheck：零逐任务请求）：
 *   - status：终态由后端在任务结束时回写注册表
 *   - metadata：各步骤 meta .json 收割合并（stabilityScore / consistencyScore / ...）
 * 仅活跃状态（running/pending/ready/loaded/idle）的任务才连接 SSE + 轮询。
 */
function _flcRenderHistoryPage(tasks, isFirstPage) {
    // 过滤出 fluttercheck_ 前缀的任务
    var flcTasks = tasks.filter(function (t) {
        var tid = t.taskId || t.task_id || '';
        return tid.startsWith('fluttercheck_');
    });

    var emptyEl = $('flc-tasks-empty');
    // 分页器会清空列表容器 innerHTML，空提示元素可能被移除，需要时重建
    if (!emptyEl) {
        var listEl = $('flc-tasks-list');
        if (listEl) {
            emptyEl = document.createElement('div');
            emptyEl.id = 'flc-tasks-empty';
            emptyEl.className = 'cc-empty-hint';
            emptyEl.textContent = '暂无检视任务，提交仓库地址后将在此显示';
            listEl.appendChild(emptyEl);
        }
    }
    if (emptyEl) emptyEl.style.display = flcTasks.length > 0 ? 'none' : '';

    // 计数按过滤后的渲染卡片数显示（注册表 total 含其他类型任务）
    var countEl2 = $('flc-task-count');
    if (countEl2) countEl2.textContent = Object.keys(_flcTasks).length + ' 个任务';

    // 后端按 created_at 降序返回（最新在前）；卡片用 insertBefore 前插，
    // 反转遍历：最旧的先渲染、被前插到下面 → 最新的最终在最上面
    flcTasks.reverse();
    for (var i = 0; i < flcTasks.length; i++) {
        var t = flcTasks[i];
        var tid = t.taskId || t.task_id;
        var status = t.status || 'idle';
        var startTime = t.created_at || t.createdAt || t.startTime;
        var endTime = t.endTime || (t.progress && t.progress.endTime);

        // 从 description（body.title）解析 repoUrl
        // 格式: Flutter仓库检视|{repoUrl}
        var desc = t.description || t.title || '';
        var repoUrl = '';
        if (desc.indexOf('Flutter仓库检视|') === 0) {
            repoUrl = desc.substring('Flutter仓库检视|'.length);
        } else if (desc) {
            repoUrl = desc;
        }

        var repoName = _flcTaskIdToRepoName(tid);

        var idx = ++_flcCounter;
        _flcTasks[idx] = _flcNewTaskState(tid, repoUrl, repoName);
        _flcTasks[idx].startTime = startTime ? new Date(startTime).getTime() : Date.now();
        _flcTasks[idx].startedAt = startTime || null;
        _flcTasks[idx].finishedAt = endTime || null;

        _flcCreateCard(idx, startTime, true);
        _flcUpdateStage(idx, status);

        // 终态任务：从注册表 metadata 回填各维度评分（参考 prcheck 的 mergeLevel 回填）
        var meta = (t.metadata && typeof t.metadata === 'object') ? t.metadata : null;
        if (meta) {
            var keyMap = {
                stabilityScore: 'stability',
                consistencyScore: 'consistency',
                memoryLeakScore: 'memoryleak',
                documentationScore: 'documentation',
                testCoverageScore: 'testcoverage',
            };
            for (var scoreKey in keyMap) {
                var dimKey = keyMap[scoreKey];
                var v = Number(meta[scoreKey]);
                if (isFinite(v)) {
                    var def = null;
                    for (var d = 0; d < _FLC_STEP_DEFS.length; d++) {
                        if (_FLC_STEP_DEFS[d].key === dimKey) { def = _FLC_STEP_DEFS[d]; break; }
                    }
                    if (def) {
                        _flcSetStepScore(idx, def, Math.max(0, Math.min(100, Math.round(v))));
                    }
                }
            }
        }

        // 活跃任务才连接 SSE + 轮询；终态任务折叠展示
        var activeStages = ['running', 'pending', 'ready', 'loaded', 'idle'];
        if (activeStages.indexOf(status) >= 0) {
            _flcConnectSSE(idx);
            _flcStartProgressPoll(idx);
        } else {
            _flcFinishSSE(idx);
        }
    }
}

function _flcInitHistoryPager() {
    if (_flcPager) return Promise.resolve(_flcPager);
    _flcPager = createPagination({
        // taskIdPrefix 前缀过滤：只分页查询 fluttercheck_ 任务（后端 SQL 过滤，
        // 避免与 codecheck 等其他编排任务混页）
        apiPath: '/api/orchestrator/tasks?taskIdPrefix=fluttercheck_',
        listContainerId: 'flc-tasks-list',
        emptyId: 'flc-tasks-empty',
        countId: 'flc-task-count',
        pagerId: 'flc-tasks-pager',
        renderPage: _flcRenderHistoryPage,
        pageSize: 20,
    });
    return Promise.resolve(_flcPager);
}

/* ── 注册面板初始化 ──────────────────────────────────────────────────── */
if (typeof Nav !== 'undefined' && Nav.register) {
    Nav.register('p-flutterlibrarycheck', initFlutterLibraryCheckPanel);
}
