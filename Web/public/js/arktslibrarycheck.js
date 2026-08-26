/* ════════════════════════════════════════════════════════════════════
 * arktslibrarycheck.js — ArkTS 仓库检视模块（前端编排）
 *
 * 设计理念（与 flutterlibrarycheck.js / rnlibrarycheck.js 一致）：后端不感知
 * 定制化，前端直接调用通用 Orchestrator API 完成固定编排。
 *
 * 编排流程（参考 AIweb ArktsLibraryCheck：源码下载 + 接口分析先行 + 4 维检视并发）：
 *   步骤 1  arkts-library-source-clone                 — 源码下载（克隆到 source/ 固定路径）
 *   步骤 2  arkts-library-interface-spec               — 接口规格分析（复用已克隆源码）
 *   步骤 3~6 stability / memoryLeak /                  — 4 个检视维度并发执行
 *            documentation / testCoverage                （dependId=2 fan-out）
 *
 * 每个检视 SKILL 输出 0-100 评分：
 *   - 首选：SKILL 按约定写 meta .json（stepId{X}_loop{L}_meta_{N}.json），
 *     后端收割为 step.metrics（如 { stabilityScore: 85 }），随 progress / SSE 推送，
 *     终态后合并入注册表 metadata（历史列表直接回填，参考 prcheck 的 mergeLevel 机制）
 *   - 兜底：读取检视报告文本，正则解析 `**综合评分：XX/100**`
 *
 * ArkTS 与 RN / Flutter 的关键差异：
 *   - 单仓库入参：repoUrl（ArkTS 原生库仓库本身即鸿蒙化库，无上游对照）
 *   - 源码下载独立环节：arkts-library-source-clone 克隆到 {outputDir}/source/ 固定路径
 *     （interface-spec 本身含克隆逻辑，但本编排由前置步骤统一下载源码后传入 repoDir 复用）
 *   - 4 维检视（无一致性/编码质量维度，本地无对应 SKILL）
 *   - 权重与 AIweb ArktsLibraryCheck 一致：稳定性 25% / 内存泄露 25% / 文档质量 15% / 用例覆盖 35%
 *
 * 前端编排时序：
 *   1. 构造 6 步 taskDef（specifiedSkill 固定指定 SKILL，跳过自动匹配）
 *   2. POST /api/orchestrator/load  — 加载任务定义
 *   3. POST /api/orchestrator/start — 启动编排（步骤 3~6 依赖步骤 2 自动并发）
 *   4. GET  /stream/tasks/:taskId   — SSE 实时监控（orch:step:status 含 metrics）
 *   5. GET  /api/orchestrator/progress?taskId= — 轮询进度（SSE 补充）
 *   6. GET  /api/flexrunner/steps?taskId= — 解析报告文件（懒加载）
 *   7. GET  /api/flexrunner/file?path= — 读取报告 / 评分兜底解析
 *   8. POST /api/orchestrator/abort — 取消任务
 *
 * 依赖：utils.js（apiFetch / createPagination / escapeHtml / toast / $）
 *       codecheck.css（cc-* 通用卡片样式）+ arktslibrarycheck.css（akt-* 扩展样式）
 *       md-reader.js（MarkdownReader）、loop.js（showSessionModal）
 * ════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── 编排配置：6 个 SKILL 步骤（stepId 固定，历史恢复依赖此顺序）───────── */
var _AKT_STEP_DEFS = [
    { stepId: 1, key: 'sourceclone',   skill: 'arkts-library-source-clone',                num: '①', name: '源码下载',     desc: '克隆仓库到 source/ 固定路径',               report: null,                  scoreKey: null },
    { stepId: 2, key: 'interface',     skill: 'arkts-library-interface-spec',              num: '②', name: '接口分析',     desc: 'Index.ets 导出链解析 + 接口规格提取',        report: '接口规格说明.md',      scoreKey: null },
    { stepId: 3, key: 'stability',     skill: 'arkts-library-stability-check',             num: '③', name: '稳定性检视',   desc: '异常处理、资源释放、并发安全',              report: '稳定性检视报告.md',    scoreKey: 'stabilityScore' },
    { stepId: 4, key: 'memoryleak',    skill: 'arkts-library-memory-leak-check',           num: '④', name: '内存泄露检视', desc: '生命周期、NAPI 引用、事件订阅',            report: '内存泄露检视报告.md',  scoreKey: 'memoryLeakScore' },
    { stepId: 5, key: 'documentation', skill: 'arkts-library-documentation-quality-check', num: '⑤', name: '文档质量检视', desc: '完整性、准确性、鸿蒙化专项',              report: '文档质量检视报告.md',  scoreKey: 'documentationScore' },
    { stepId: 6, key: 'testcoverage',  skill: 'arkts-library-test-coverage-check',         num: '⑥', name: '用例覆盖度检视', desc: '接口覆盖率、测试质量',                  report: '用例覆盖度检视报告.md', scoreKey: 'testCoverageScore' },
];

/* 评分权重（与 AIweb ArktsLibraryCheck 综合评分口径一致，权重和 = 1） */
var _AKT_WEIGHTS = { stability: 0.25, memoryleak: 0.25, documentation: 0.15, testcoverage: 0.35 };

/* 用例覆盖度检视的附属脚本报告（MCP 脚本产物） */
var _AKT_EXTRA_REPORTS = {
    testcoverage: [
        { key: 'xtscoverage',  report: 'xts-coverage-report.md',  label: 'XTS覆盖率' },
        { key: 'democoverage', report: 'demo-coverage-report.md', label: 'Demo覆盖率' },
    ],
};

/* ── 状态 ────────────────────────────────────────────────────────────── */
var _aktCounter = 0;
var _aktTasks = {};   // idx -> { taskId, repoName, repoUrl,
                      //          sse, timer, pollTimer, startTime, startedAt, finishedAt,
                      //          scores: { stability, memoryleak, documentation, testcoverage, overall },
                      //          stepStatus: { sourceclone: 'pending', ... },
                      //          reportPaths: { interface: '/abs/接口规格说明.md', ... }, filesResolved }
var _aktPager = null;
var _aktInited = false;

/* ── 阶段标签（映射 Orchestrator 状态）──────────────────────────────── */
var _AKT_STAGE_LABELS = {
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

var _AKT_STEP_STATUS_LABELS = {
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

function _aktEsc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _aktFormatTime(isoString) {
    if (!isoString) return '';
    try {
        return new Date(isoString).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    } catch (e) { return isoString; }
}

/**
 * 解析仓库地址 → { repoName, branch, url }。
 * 支持 https://gitcode.com/org/repo、/tree/{branch}、#branch=xxx、?branch=xxx 及本地路径。
 */
function _aktParseRepoInfo(repoUrl) {
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
        // 本地路径 / #branch=xxx 扩展格式
        var raw = String(repoUrl);
        var hashIdx = raw.indexOf('#');
        if (hashIdx >= 0) {
            var hash = raw.substring(hashIdx + 1);
            raw = raw.substring(0, hashIdx);
            var bm = hash.match(/branch=([^&]+)/);
            if (bm) info.branch = decodeURIComponent(bm[1]);
        }
        var segs = raw.replace(/[\/\\]+$/, '').split(/[\/\\]/);
        if (segs.length && segs[segs.length - 1]) {
            info.repoName = segs[segs.length - 1].replace(/\.git$/, '') || info.repoName;
        }
    }
    return info;
}

/** taskId（arktscheck_{repoName}_{ts36}）→ 仓库名 */
function _aktTaskIdToRepoName(taskId) {
    if (!taskId) return '—';
    var rest = taskId.replace(/^arktscheck_/, '');
    var parts = rest.split('_');
    if (parts.length >= 2) {
        parts.pop(); // 去掉末尾时间戳段
        return parts.join('_');
    }
    return rest.length > 40 ? rest.substring(0, 40) + '…' : rest;
}

/**
 * 从报告文本解析 0-100 评分（兜底，同 AIweb _parseArktsLibraryScore 正则）。
 */
function _aktParseScoreFromReport(content) {
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
function _aktExtractStepScore(stepDef, metrics) {
    if (!stepDef.scoreKey || !metrics || typeof metrics !== 'object') return null;
    var v = metrics[stepDef.scoreKey];
    if (v == null) v = metrics.score;
    v = Number(v);
    if (!isFinite(v)) return null;
    return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * 综合评分：4 个维度评分齐全时按权重计算（口径同 AIweb ArktsLibraryCheck），否则返回 null。
 */
function _aktComputeOverall(scores) {
    var dims = ['stability', 'memoryleak', 'documentation', 'testcoverage'];
    for (var i = 0; i < dims.length; i++) {
        if (scores[dims[i]] == null) return null;
    }
    return Math.round(
        scores.stability * _AKT_WEIGHTS.stability +
        scores.memoryleak * _AKT_WEIGHTS.memoryleak +
        scores.documentation * _AKT_WEIGHTS.documentation +
        scores.testcoverage * _AKT_WEIGHTS.testcoverage
    );
}

function _aktGuardSubmit(btn, loadingText, normalText) {
    if (!btn || btn.disabled) return false;
    btn.disabled = true;
    btn.textContent = loadingText;
    btn._aktNormalText = normalText;
    return true;
}

function _aktGuardSubmitRestore(btn) {
    if (!btn) return;
    var normalText = btn._aktNormalText || '提交';
    setTimeout(function () {
        if (btn.disabled) { btn.disabled = false; btn.textContent = normalText; }
    }, 5000);
}

function _aktGuardSubmitReset(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = btn._aktNormalText || '提交';
}

function _aktShowErr(msg) {
    var el = $('akt-error');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = '错误：' + msg;
}

/* ════════════════════════════════════════════════════════════════════
 * 面板初始化（懒加载，由 Nav.register 触发）
 * ════════════════════════════════════════════════════════════════════ */

function initArktsLibraryCheckPanel() {
    if (_aktInited) return;
    _aktInited = true;

    // 历史任务
    _aktInitHistoryPager().then(function (pg) { if (pg) pg.load(1); });

    // 提交按钮
    var btn = $('akt-submit-btn');
    if (btn) btn.addEventListener('click', doArktsLibraryCheck);

    // 回车提交
    var urlInput = $('akt-repo-url');
    if (urlInput) {
        urlInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') doArktsLibraryCheck();
        });
    }

    // 高级选项折叠
    var advToggle = $('akt-advanced-toggle');
    if (advToggle) {
        advToggle.addEventListener('click', function () {
            var section = $('akt-advanced-section');
            if (section) {
                section.classList.toggle('show');
                advToggle.classList.toggle('open');
            }
        });
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 提交检视（前端编排：构造 taskDef → load → start）
 * ════════════════════════════════════════════════════════════════════ */

async function doArktsLibraryCheck() {
    var repoUrl = $('akt-repo-url').value.trim();
    var skillDir = $('akt-skill-dir') ? $('akt-skill-dir').value.trim() : '';

    if (!repoUrl) { _aktShowErr('仓库地址不能为空'); return; }

    var btn = $('akt-submit-btn');
    if (!_aktGuardSubmit(btn, '提交中…', '▶ 开始检视')) return;
    $('akt-error').style.display = 'none';

    try {
        // ── 1. 解析仓库信息，生成 taskId ──
        var repoInfo = _aktParseRepoInfo(repoUrl);
        var safeName = repoInfo.repoName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'repo';
        var ts = Date.now().toString(36);
        var taskId = 'arktscheck_' + safeName + '_' + ts;

        // ── 2. 构造 6 步 taskDef ──
        // 步骤 1：源码下载（克隆到 {outputDir}/source/ 固定路径）
        // 步骤 2：接口分析（复用已克隆源码，生成 接口规格说明.md）
        // 步骤 3~6：4 个检视维度，dependId=2 fan-out 并发（编排器自动并行执行）
        // specifiedSkill 固定指定 SKILL，跳过 SkillSelector 自动匹配
        // body.title 编码仓库信息，供历史恢复解析（格式: ArkTS仓库检视|{repoName}|{repoUrl}）
        var cloneDesc = [
            '请使用 arkts-library-source-clone SKILL 下载 ArkTS 三方库「' + repoInfo.repoName + '」的仓库源码。',
            '',
            '任务参数：',
            '- repoUrl: ' + repoUrl,
            '- repoName: ' + repoInfo.repoName,
            '- outputDir: 即当前工作目录（见下方"工作目录"，绝对路径），源码克隆到该目录下的 source/ 固定路径',
        ].join('\n');

        var interfaceDesc = [
            '请使用 arkts-library-interface-spec SKILL 对 ArkTS 三方库「' + repoInfo.repoName + '」进行接口规格提取，生成接口规格说明文档。',
            '',
            '任务参数：',
            '- repoUrl: ' + repoUrl,
            '- repoName: ' + repoInfo.repoName,
            '- repoDir（仓库源码目录，已由前置步骤克隆）: {outputDir}/source（见下方"工作目录"，绝对路径拼接），直接复用，请勿重新克隆',
            '- reportPath: {outputDir}/接口规格说明.md（接口规格说明文档输出路径）',
            '- outputDir: 即当前工作目录（见下方"工作目录"，绝对路径）',
        ].join('\n');

        var steps = [{
            stepId: 1,
            taskDescription: cloneDesc,
            dependId: 0,
            nextStepId: 0,
            failStepId: 0,
            maxRetries: 3,
            skillDirectory: skillDir || '',
            specifiedSkill: 'arkts-library-source-clone',
            inputReport: '',
        }, {
            stepId: 2,
            taskDescription: interfaceDesc,
            dependId: 1,
            nextStepId: 0,
            failStepId: 0,
            maxRetries: 3,
            skillDirectory: skillDir || '',
            specifiedSkill: 'arkts-library-interface-spec',
            inputReport: '',
        }];

        // 4 个检视步骤（并发）：依赖步骤 1 已克隆的 source/ 和 步骤 2 生成的 接口规格说明.md
        for (var i = 2; i < _AKT_STEP_DEFS.length; i++) {
            var def = _AKT_STEP_DEFS[i];
            var desc = [
                '请使用 ' + def.skill + ' SKILL 对 ArkTS 三方库「' + repoInfo.repoName + '」进行' + def.name + '，生成检视报告。',
                '',
                '任务参数：',
                '- repoUrl: ' + repoUrl,
                '- repoName: ' + repoInfo.repoName,
                '- outputDir: 即当前工作目录（见下方"工作目录"，绝对路径）',
                '- interfaceDocPath: {outputDir}/接口规格说明.md（前置接口分析步骤已生成）',
                '- 仓库源码已由前置步骤克隆在 {outputDir}/source/ 目录下，直接分析即可，请勿重新克隆',
                '- 输入报告路径为前置步骤的执行结果记录，仅供参考；接口规格文档以 interfaceDocPath 为准',
            ];

            // 维度专属参数
            if (def.key === 'memoryleak') {
                desc.push('- 编码质量检视报告.md 为可选参考输入，若不存在则跳过该参考，独立完成检视');
            }
            if (def.key === 'testcoverage') {
                desc.push('- 文档质量检视报告.md 为可选参考输入（并发执行时可能尚未生成），若不存在则跳过该参考，独立完成检视');
                desc.push('- 可调用 MCP 脚本 script_arkts_analyze_demo_coverage / script_arkts_analyze_xts_coverage 计算 DEMO 与 XTS 接口覆盖率（输出 demo-coverage-report.md / xts-coverage-report.md）');
            }

            steps.push({
                stepId: def.stepId,
                taskDescription: desc.join('\n'),
                dependId: 2,
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
            title: 'ArkTS仓库检视|' + repoInfo.repoName + '|' + repoUrl,
            skillDirectory: skillDir || '',
            loopCount: 0,
            steps: steps,
        };

        // ── 3. POST /api/orchestrator/load ──
        var loadR = await apiFetch('POST', '/api/orchestrator/load', taskDef);
        if (loadR.status >= 400 || !loadR.data || loadR.data.status !== 'ok') {
            _aktShowErr((loadR.data && (loadR.data.error || loadR.data.message)) || ('HTTP ' + loadR.status));
            _aktGuardSubmitReset(btn);
            return;
        }

        // ── 4. POST /api/orchestrator/start ──
        var startR = await apiFetch('POST', '/api/orchestrator/start', { taskId: taskId });
        if (startR.status >= 400 || !startR.data || startR.data.status !== 'ok') {
            _aktShowErr((startR.data && (startR.data.error || startR.data.message)) || ('HTTP ' + startR.status));
            _aktGuardSubmitReset(btn);
            return;
        }

        // ── 5. 创建任务卡片 + SSE + 轮询 ──
        var idx = ++_aktCounter;
        _aktTasks[idx] = _aktNewTaskState(taskId, repoInfo.repoName, repoUrl);

        _aktCreateCard(idx, new Date().toISOString(), false);
        _aktConnectSSE(idx);
        _aktStartProgressPoll(idx);

        _aktGuardSubmitRestore(btn);
        toast('success', '检视任务已启动: ' + repoInfo.repoName);

    } catch (e) {
        _aktShowErr(e.message);
        _aktGuardSubmitReset(btn);
    }
}

function _aktNewTaskState(taskId, repoName, repoUrl) {
    return {
        taskId: taskId,
        repoName: repoName,
        repoUrl: repoUrl,
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
        scores: { stability: null, memoryleak: null, documentation: null, testcoverage: null, overall: null },
        scoreReasons: {},  // 各维度评分判定依据（来自 meta .json 的 scoreReason，悬浮提示展示）
        stepStatus: {},
    };
}

/* ════════════════════════════════════════════════════════════════════
 * 任务卡片渲染
 * ════════════════════════════════════════════════════════════════════ */

function _aktCreateCard(idx, createdAt, isHistory) {
    var task = _aktTasks[idx];
    var emptyEl = $('akt-tasks-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    var countEl = $('akt-task-count');
    if (countEl) countEl.textContent = Object.keys(_aktTasks).length + ' 个任务';

    var timeLabel = createdAt ? _aktFormatTime(createdAt) : '';

    var card = document.createElement('div');
    card.className = 'cc-task-card running';
    card.id = 'akt-card-' + idx;
    card.innerHTML =
        '<div class="cc-card-header" onclick="toggleAktCard(' + idx + ')">' +
            '<span class="cc-chevron">▶</span>' +
            '<span class="cc-run-dot"></span>' +
            '<span class="cc-lib">' + _aktEsc(task.repoName) + '</span>' +
            '<span class="cc-type-badge" style="background:rgba(0,113,227,0.12);color:var(--blue)">ArkTS</span>' +
            '<span class="cc-spacer"></span>' +
            '<span class="cc-time" id="akt-' + idx + '-time">' + _aktEsc(timeLabel) + '</span>' +
            '<span class="cc-merge-badge" id="akt-' + idx + '-overall-badge" style="display:none"></span>' +
            '<span class="cc-stage-badge s-pending" id="akt-' + idx + '-badge">等待中</span>' +
            '<button class="cc-stop-btn" id="akt-' + idx + '-stop" onclick="event.stopPropagation();stopAktTask(' + idx + ')" title="取消检视">■ 取消</button>' +
            '<span class="cc-elapsed" id="akt-' + idx + '-elapsed" style="display:none">0s</span>' +
        '</div>' +
        '<div class="cc-card-body" id="akt-' + idx + '-body"' + (isHistory ? ' style="display:none"' : '') + '>' +
            '<div class="cc-meta" title="' + _aktEsc(task.repoUrl) + '">' +
                '<span class="cc-meta-label">仓库地址：</span>' +
                '<span class="cc-meta-value">' + _aktEsc(task.repoUrl) + '</span>' +
            '</div>' +
            '<div class="akt-score-panel" id="akt-' + idx + '-score-panel" style="display:none">' +
                '<div class="akt-score-panel-title">📊 检视评分概览</div>' +
                '<div class="akt-score-overall-row">' +
                    '<span class="akt-score-label">综合评分</span>' +
                    '<span class="akt-score-value" id="akt-' + idx + '-overall-score" style="display:none">--</span>' +
                    '<span class="akt-score-weights">稳定性 25% · 内存泄露 25% · 文档质量 15% · 用例覆盖 35%</span>' +
                '</div>' +
                '<div class="akt-score-grid">' +
                    '<div class="akt-score-item"><span class="akt-score-item-label">稳定性</span><span class="akt-score-item-value" id="akt-' + idx + '-dim-stability">--</span></div>' +
                    '<div class="akt-score-item"><span class="akt-score-item-label">内存泄露</span><span class="akt-score-item-value" id="akt-' + idx + '-dim-memoryleak">--</span></div>' +
                    '<div class="akt-score-item"><span class="akt-score-item-label">文档质量</span><span class="akt-score-item-value" id="akt-' + idx + '-dim-documentation">--</span></div>' +
                    '<div class="akt-score-item"><span class="akt-score-item-label">用例覆盖</span><span class="akt-score-item-value" id="akt-' + idx + '-dim-testcoverage">--</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="akt-steps-panel">' +
                '<div class="akt-steps-title-row">' +
                    '<div class="akt-steps-title">🔍 检视流程进度</div>' +
                    '<button class="akt-archive-btn" id="akt-' + idx + '-archive-btn" onclick="event.stopPropagation();downloadAktArchive(' + idx + ')" style="display:none" title="打包下载任务目录下的全部 .md 报告文件（ZIP）">📦 下载全部报告</button>' +
                '</div>' +
                '<div class="akt-steps-list">' +
                    _AKT_STEP_DEFS.map(function (def) { return _aktStepRowHtml(idx, def); }).join('') +
                '</div>' +
            '</div>' +
        '</div>';

    var list = $('akt-tasks-list');
    list.insertBefore(card, list.firstChild);

    // 非历史（新提交）任务默认展开
    if (!isHistory) {
        card.classList.add('open');
    }

    // 历史已完成任务：显示固定时长；进行中任务：启动计时器
    if (isHistory && task.finishedAt && task.startedAt) {
        _aktRenderElapsed(idx);
    } else {
        task.timer = setInterval(function () {
            var s = Math.floor((Date.now() - _aktTasks[idx].startTime) / 1000);
            var el = document.getElementById('akt-' + idx + '-elapsed');
            if (el) el.textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        }, 1000);
    }
}

function _aktStepRowHtml(idx, def) {
    return '<div class="akt-step-row" id="akt-' + idx + '-row-' + def.key + '">' +
        '<div class="akt-step-icon" id="akt-' + idx + '-icon-' + def.key + '">' + def.num + '</div>' +
        '<div class="akt-step-info">' +
            '<div class="akt-step-name">' + _aktEsc(def.name) +
                (def.scoreKey ? ' <span class="akt-step-weight">权重 ' + Math.round(_AKT_WEIGHTS[def.key] * 100) + '%</span>' : '') +
            '</div>' +
            '<div class="akt-step-desc" id="akt-' + idx + '-' + def.key + '-txt">等待中…</div>' +
        '</div>' +
        '<div class="akt-step-actions">' +
            '<span class="akt-step-score" id="akt-' + idx + '-score-' + def.key + '" style="display:none">--</span>' +
            '<button class="cc-preview-btn" id="akt-' + idx + '-view-' + def.key + '" onclick="event.stopPropagation();viewAktReport(' + idx + ', \'' + def.key + '\')" style="display:none">↗ 预览</button>' +
            '<button class="cc-download-btn" id="akt-' + idx + '-download-' + def.key + '" onclick="event.stopPropagation();downloadAktReport(' + idx + ', \'' + def.key + '\')" style="display:none">↓ 下载</button>' +
            '<button class="akt-session-btn" id="akt-' + idx + '-session-' + def.key + '" onclick="event.stopPropagation();viewAktSession(' + idx + ', ' + def.stepId + ', \'' + def.key + '\')" style="display:none">💬</button>' +
        '</div>' +
    '</div>';
}

/* ── 卡片折叠（展开时懒加载报告文件与评分兜底）──────────────────────── */

function toggleAktCard(idx) {
    var card = document.getElementById('akt-card-' + idx);
    var body = document.getElementById('akt-' + idx + '-body');
    if (!card || !body) return;
    var isOpen = card.classList.toggle('open');
    body.style.display = isOpen ? '' : 'none';
    if (isOpen) {
        var task = _aktTasks[idx];
        if (!task) return;
        if (!task.filesResolved) _aktResolveFiles(idx);
        // 历史终态任务（无 SSE/轮询）：展开时加载一次进度，恢复步骤状态与 metrics 评分
        if (!task.pollTimer && !task.sse) _aktLoadProgressOnce(idx);
        _aktFallbackScores(idx);
    }
}

/**
 * 一次性加载编排进度（历史终态任务展开时调用）：
 * 从磁盘恢复的 orchestration.json 中读取各步骤状态与 metrics 评分。
 */
function _aktLoadProgressOnce(idx) {
    var task = _aktTasks[idx];
    if (!task || task._progressLoaded) return;
    task._progressLoaded = true;

    apiFetch('GET', '/api/orchestrator/progress?taskId=' + encodeURIComponent(task.taskId), null, 15000)
        .then(function (r) {
            if (!r.data || r.data.status !== 'ok' || !r.data.progress) return;
            var progress = r.data.progress;
            _aktUpdateStage(idx, progress.status, progress);
            if (progress.steps) {
                for (var i = 0; i < progress.steps.length; i++) {
                    _aktHandleStepStatus(idx, progress.steps[i]);
                }
            }
            _aktRenderElapsed(idx);
        })
        .catch(function () {
            // 失败允许重试（下次展开时再加载）
            if (_aktTasks[idx]) _aktTasks[idx]._progressLoaded = false;
        });
}

/* ════════════════════════════════════════════════════════════════════
 * SSE 连接（监听 Orchestrator 事件）
 * ════════════════════════════════════════════════════════════════════ */

function _aktConnectSSE(idx) {
    var task = _aktTasks[idx];
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
        _aktHandleStepStatus(idx, data);
    });

    sse.addEventListener('orch:task:start', function () {
        _aktUpdateStage(idx, 'running');
    });

    sse.addEventListener('orch:task:complete', function (e) {
        sseDone = true;
        var data; try { data = JSON.parse(e.data); } catch (err) { data = {}; }
        var status = data.status || 'completed';
        _aktUpdateStage(idx, status);
        _aktOnTerminal(idx, status);
    });

    sse.addEventListener('orch:task:error', function () {
        _aktUpdateStage(idx, 'failed');
    });

    sse.addEventListener('orch:task:aborted', function () {
        sseDone = true;
        _aktUpdateStage(idx, 'aborted');
        _aktOnTerminal(idx, 'aborted');
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
function _aktHandleStepStatus(idx, step) {
    if (!step || step.stepId == null) return;
    var task = _aktTasks[idx];
    if (!task) return;

    var def = null;
    for (var i = 0; i < _AKT_STEP_DEFS.length; i++) {
        if (String(_AKT_STEP_DEFS[i].stepId) === String(step.stepId)) { def = _AKT_STEP_DEFS[i]; break; }
    }
    if (!def) return;

    if (step.startTime) task.startedAt = step.startTime;

    _aktUpdateStepRow(idx, def, step.status || 'pending');

    // 评分回填：步骤完成时从 metrics 提取（meta .json 已由后端收割）
    if (step.status === 'completed') {
        var score = _aktExtractStepScore(def, step.metrics);
        var reason = (step.metrics && typeof step.metrics.scoreReason === 'string')
            ? step.metrics.scoreReason : null;
        if (score != null) {
            _aktSetStepScore(idx, def, score, reason);
        } else if (reason) {
            task.scoreReasons[def.key] = reason;
        }
        // 步骤完成即尝试解析报告文件（显示预览/下载按钮）
        _aktResolveFiles(idx);
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 进度轮询（SSE 补充）
 * ════════════════════════════════════════════════════════════════════ */

function _aktStartProgressPoll(idx) {
    var task = _aktTasks[idx];
    if (!task || task.pollTimer) return;

    task.pollTimer = setInterval(async function () {
        try {
            var r = await apiFetch('GET', '/api/orchestrator/progress?taskId=' + encodeURIComponent(task.taskId), null, 10000);
            if (!r.data || r.data.status !== 'ok') return;

            var progress = r.data.progress;
            if (!progress) return;

            _aktUpdateStage(idx, progress.status, progress);

            if (progress.steps && progress.steps.length > 0) {
                for (var i = 0; i < progress.steps.length; i++) {
                    _aktHandleStepStatus(idx, progress.steps[i]);
                }
            }

            if (['completed', 'failed', 'aborted', 'deadlocked'].indexOf(progress.status) >= 0) {
                _aktOnTerminal(idx, progress.status);
            }
        } catch (e) { /* 静默失败 */ }
    }, 3000);
}

function _aktStopProgressPoll(idx) {
    var task = _aktTasks[idx];
    if (task && task.pollTimer) {
        clearInterval(task.pollTimer);
        task.pollTimer = null;
    }
}

/* ════════════════════════════════════════════════════════════════════
 * UI 更新
 * ════════════════════════════════════════════════════════════════════ */

function _aktUpdateStage(idx, stage, progress) {
    var task = _aktTasks[idx];
    if (!task) return;
    if (progress) {
        if (progress.startTime) task.startedAt = progress.startTime;
        if (progress.endTime) task.finishedAt = progress.endTime;
    }

    var badge = document.getElementById('akt-' + idx + '-badge');
    if (badge) {
        badge.className = 'cc-stage-badge s-' + stage;
        badge.textContent = _AKT_STAGE_LABELS[stage] || stage;
    }
}

function _aktUpdateStepRow(idx, def, status) {
    var task = _aktTasks[idx];
    if (!task) return;
    task.stepStatus[def.key] = status;

    var icon = document.getElementById('akt-' + idx + '-icon-' + def.key);
    var txt = document.getElementById('akt-' + idx + '-' + def.key + '-txt');
    var row = document.getElementById('akt-' + idx + '-row-' + def.key);
    var sessionBtn = document.getElementById('akt-' + idx + '-session-' + def.key);

    if (row) row.className = 'akt-step-row ' + status;

    if (icon) {
        if (status === 'running') {
            icon.className = 'akt-step-icon running';
            icon.textContent = '🔄';
        } else if (status === 'completed') {
            icon.className = 'akt-step-icon completed';
            icon.textContent = '✓';
        } else if (status === 'failed') {
            icon.className = 'akt-step-icon failed';
            icon.textContent = '✗';
        } else if (status === 'skipped' || status === 'blocked') {
            icon.className = 'akt-step-icon skipped';
            icon.textContent = '⊘';
        } else {
            icon.className = 'akt-step-icon';
            icon.textContent = def.num;
        }
    }
    if (txt) txt.textContent = _AKT_STEP_STATUS_LABELS[status] || status;

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
function _aktSetStepScore(idx, def, score, reason) {
    var task = _aktTasks[idx];
    if (!task || score == null || !def.scoreKey) return;

    // 评分依据先落缓存（已有评分不覆盖，但依据允许补充）
    if (reason && !task.scoreReasons[def.key]) task.scoreReasons[def.key] = reason;

    // 已有评分不覆盖（避免轮询旧值覆盖新值；0 是合法评分，必须用 != null 判断）
    if (task.scores[def.key] != null) { _aktRenderScorePanel(idx); return; }
    task.scores[def.key] = score;

    // 步骤行评分徽章
    var scoreEl = document.getElementById('akt-' + idx + '-score-' + def.key);
    if (scoreEl) {
        scoreEl.style.display = 'inline-flex';
        scoreEl.textContent = score + '分';
        _aktApplyScoreStyle(scoreEl, score);
        if (task.scoreReasons[def.key]) {
            scoreEl.title = '评分依据：' + task.scoreReasons[def.key];
            scoreEl.style.cursor = 'help';
        }
    }

    // 评分概览面板
    _aktRenderScorePanel(idx);
}

/** 评分概览面板渲染（维度评分 + 综合评分 + 头部总分徽章） */
function _aktRenderScorePanel(idx) {
    var task = _aktTasks[idx];
    if (!task) return;

    var hasAny = false;
    for (var k in _AKT_WEIGHTS) { if (task.scores[k] != null) { hasAny = true; break; } }

    var panel = document.getElementById('akt-' + idx + '-score-panel');
    if (panel && hasAny) panel.style.display = 'block';

    var dims = ['stability', 'memoryleak', 'documentation', 'testcoverage'];
    for (var i = 0; i < dims.length; i++) {
        var key = dims[i];
        var el = document.getElementById('akt-' + idx + '-dim-' + key);
        if (!el) continue;
        if (task.scores[key] != null) {
            el.style.display = 'inline-flex';
            el.textContent = task.scores[key] + '分';
            _aktApplyScoreStyle(el, task.scores[key]);
        }
        // 评分依据悬浮提示（区分"很差"与"一票否决"等严苛规则判定）
        if (task.scoreReasons[key]) {
            el.title = '评分依据：' + task.scoreReasons[key];
            el.style.cursor = 'help';
        }
    }

    // 综合评分（4 维齐全才计算）
    if (task.scores.overall == null) {
        task.scores.overall = _aktComputeOverall(task.scores);
    }
    if (task.scores.overall != null) {
        var overallEl = document.getElementById('akt-' + idx + '-overall-score');
        if (overallEl) {
            overallEl.style.display = 'inline-flex';
            overallEl.textContent = task.scores.overall + '分';
            _aktApplyScoreStyle(overallEl, task.scores.overall, true);
        }
        var badge = document.getElementById('akt-' + idx + '-overall-badge');
        if (badge) {
            badge.style.display = 'inline-flex';
            badge.textContent = '综合 ' + task.scores.overall + '分';
            badge.style.color = task.scores.overall >= 80 ? 'var(--green)' : task.scores.overall >= 60 ? 'var(--orange)' : 'var(--red)';
            badge.style.background = task.scores.overall >= 80 ? 'rgba(52,199,89,0.15)' : task.scores.overall >= 60 ? 'rgba(255,149,0,0.15)' : 'rgba(255,59,48,0.15)';
        }
    }
}

/** 评分样式：≥80 绿 / ≥60 橙 / <60 红 */
function _aktApplyScoreStyle(el, score, isLarge) {
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

async function _aktResolveFiles(idx) {
    var task = _aktTasks[idx];
    if (!task) return;

    // 全部专属报告已找到 → 幂等返回（sourceclone 无专属报告，跳过判定）
    var allFound = true;
    for (var a = 0; a < _AKT_STEP_DEFS.length; a++) {
        if (!_AKT_STEP_DEFS[a].report) continue;
        if (!task.reportPaths[_AKT_STEP_DEFS[a].key]) { allFound = false; break; }
    }
    if (allFound) { task.filesResolved = true; _aktShowReportButtons(idx); return; }

    // 节流：进行中任务最多每 15s 解析一次（报告随步骤完成渐进生成）
    var now = Date.now();
    if (task._resolving) return;
    if (task._lastResolveAt && now - task._lastResolveAt < 15000) {
        _aktShowReportButtons(idx);
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
                var resDef = _aktDefByStepId(resMatch[1]);
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

            // 主报告映射（专属报告文件，优先于 result 兜底；sourceclone 等无专属报告的步骤跳过）
            for (var j = 0; j < _AKT_STEP_DEFS.length; j++) {
                var def = _AKT_STEP_DEFS[j];
                if (!def.report) continue;
                if (f.filename === def.report && !task.reportPaths[def.key]) {
                    task.reportPaths[def.key] = f.path;
                    found = true;
                }
            }
            // 附属脚本报告（用例覆盖度的 XTS/Demo 覆盖率脚本报告）
            for (var key in _AKT_EXTRA_REPORTS) {
                var extras = _AKT_EXTRA_REPORTS[key];
                for (var m = 0; m < extras.length; m++) {
                    if (f.filename === extras[m].report && !task.reportPaths[extras[m].key]) {
                        task.reportPaths[extras[m].key] = f.path;
                        found = true;
                    }
                }
            }
        }

        if (found) _aktShowReportButtons(idx);
    } catch (e) { /* 静默失败 */ } finally {
        task._resolving = false;
    }
}

/** stepId（字符串）→ 步骤定义 */
function _aktDefByStepId(stepId) {
    for (var i = 0; i < _AKT_STEP_DEFS.length; i++) {
        if (String(_AKT_STEP_DEFS[i].stepId) === String(stepId)) return _AKT_STEP_DEFS[i];
    }
    return null;
}

/** 已完成且报告可用的步骤显示预览/下载按钮（专属报告或 result 兜底均可）；同步更新"下载全部报告"按钮 */
function _aktShowReportButtons(idx) {
    var task = _aktTasks[idx];
    if (!task) return;

    for (var i = 0; i < _AKT_STEP_DEFS.length; i++) {
        var def = _AKT_STEP_DEFS[i];
        if (task.reportPaths[def.key] || task.resultPaths[def.key]) {
            var viewBtn = document.getElementById('akt-' + idx + '-view-' + def.key);
            var dlBtn = document.getElementById('akt-' + idx + '-download-' + def.key);
            if (viewBtn) viewBtn.style.display = 'inline-flex';
            if (dlBtn) dlBtn.style.display = 'inline-flex';
        }
    }

    _aktUpdateArchiveButton(idx);
}

/** 更新"下载全部报告"按钮（有 .md 产物时显示，带文件数） */
function _aktUpdateArchiveButton(idx) {
    var task = _aktTasks[idx];
    if (!task) return;
    var btn = document.getElementById('akt-' + idx + '-archive-btn');
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

async function _aktFallbackScores(idx) {
    var task = _aktTasks[idx];
    if (!task) return;

    // 兜底只针对已完成的检视步骤且尚无评分的维度
    for (var i = 0; i < _AKT_STEP_DEFS.length; i++) {
        var def = _AKT_STEP_DEFS[i];
        if (!def.scoreKey) continue;
        if (task.scores[def.key] != null) continue;
        if (task.stepStatus[def.key] && task.stepStatus[def.key] !== 'completed') continue;

        // 需要报告文件路径；未解析过先触发解析（专属报告或 result .md 均可）
        if (!_aktGetReportPath(idx, def.key)) {
            await _aktResolveFiles(idx);
        }
        var path = _aktGetReportPath(idx, def.key);
        if (!path) continue;

        try {
            var r = await apiFetch('GET', '/api/flexrunner/file?path=' + encodeURIComponent(path), null, 15000);
            if (r.data && r.data.status === 'ok' && r.data.content) {
                var score = _aktParseScoreFromReport(r.data.content);
                if (score != null) _aktSetStepScore(idx, def, score);
            }
        } catch (e) { /* 静默失败 */ }
    }
}

/* ════════════════════════════════════════════════════════════════════
 * 终态处理
 * ════════════════════════════════════════════════════════════════════ */

function _aktOnTerminal(idx, status) {
    var task = _aktTasks[idx];
    if (!task || task._terminalDone) return;
    task._terminalDone = true;

    _aktStopProgressPoll(idx);
    _aktFinishSSE(idx);
    _aktResolveFiles(idx).then(function () {
        _aktFallbackScores(idx);
    });
}

function _aktFinishSSE(idx) {
    var task = _aktTasks[idx];
    if (!task) return;
    if (task.sse) { try { task.sse.close(); } catch (e) {} task.sse = null; }
    if (task.timer) { clearInterval(task.timer); task.timer = null; }

    _aktRenderElapsed(idx);

    var card = document.getElementById('akt-card-' + idx);
    if (card) {
        card.classList.remove('running');
        var badge = document.getElementById('akt-' + idx + '-badge');
        if (badge) {
            if (badge.classList.contains('s-completed')) card.classList.add('cc-done');
            else if (badge.classList.contains('s-failed') || badge.classList.contains('s-error') || badge.classList.contains('s-deadlocked')) card.classList.add('cc-failed');
            else if (badge.classList.contains('s-aborted')) card.classList.add('cc-cancelled');
        }
        var stopBtn = document.getElementById('akt-' + idx + '-stop');
        if (stopBtn) stopBtn.style.display = 'none';
    }
}

/** 已完成任务：用 startedAt/finishedAt 计算固定时长 */
function _aktRenderElapsed(idx) {
    var task = _aktTasks[idx];
    if (!task) return;
    var elapsedEl = document.getElementById('akt-' + idx + '-elapsed');
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

    var timeEl = document.getElementById('akt-' + idx + '-time');
    if (timeEl && task.startedAt) timeEl.textContent = _aktFormatTime(task.startedAt);
}

/* ════════════════════════════════════════════════════════════════════
 * 停止检视
 * ════════════════════════════════════════════════════════════════════ */

async function stopAktTask(idx) {
    var task = _aktTasks[idx];
    if (!task) return;
    var btn = document.getElementById('akt-' + idx + '-stop');
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
    _aktUpdateStage(idx, 'aborted');
    _aktOnTerminal(idx, 'aborted');
}

/* ════════════════════════════════════════════════════════════════════
 * 报告预览 / 下载
 * ════════════════════════════════════════════════════════════════════ */

/** stepKey 支持主维度键 + 附属报告键（xtscoverage / democoverage）；优先专属报告，回退步骤 result .md */
function _aktGetReportPath(idx, stepKey) {
    var task = _aktTasks[idx];
    if (!task) return null;
    return task.reportPaths[stepKey] || task.resultPaths[stepKey] || null;
}

function _aktGetReportTitle(idx, stepKey) {
    var task = _aktTasks[idx];
    if (!task) return '检视报告';
    for (var i = 0; i < _AKT_STEP_DEFS.length; i++) {
        if (_AKT_STEP_DEFS[i].key === stepKey) {
            return _AKT_STEP_DEFS[i].name + ' - ' + task.repoName;
        }
    }
    for (var k in _AKT_EXTRA_REPORTS) {
        var extras = _AKT_EXTRA_REPORTS[k];
        for (var m = 0; m < extras.length; m++) {
            if (extras[m].key === stepKey) return extras[m].label + ' - ' + task.repoName;
        }
    }
    return '检视报告 - ' + task.repoName;
}

async function viewAktReport(idx, stepKey) {
    var task = _aktTasks[idx];
    if (!task) return;
    if (!task.reportPaths[stepKey]) await _aktResolveFiles(idx);

    var path = _aktGetReportPath(idx, stepKey);
    if (!path) { toast('warn', '报告尚未生成'); return; }

    try {
        var r = await apiFetch('GET', '/api/flexrunner/file?path=' + encodeURIComponent(path), null, 20000);
        if (!r.data || r.data.status !== 'ok') { toast('error', '读取报告失败'); return; }

        var title = _aktGetReportTitle(idx, stepKey);
        if (typeof MarkdownReader !== 'undefined' && MarkdownReader.open) {
            MarkdownReader.open(title, r.data.content);
        } else if (typeof showModal === 'function') {
            showModal(title, r.data.content);
        } else {
            var w = window.open('', '_blank');
            if (w) {
                w.document.write('<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;padding:20px;">' +
                    _aktEsc(r.data.content) + '</pre>');
                w.document.title = title;
            }
        }
    } catch (e) {
        toast('error', '预览失败: ' + e.message);
    }
}

async function downloadAktReport(idx, stepKey) {
    var task = _aktTasks[idx];
    if (!task) return;
    if (!task.reportPaths[stepKey]) await _aktResolveFiles(idx);

    var path = _aktGetReportPath(idx, stepKey);
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

async function downloadAktArchive(idx) {
    var task = _aktTasks[idx];
    if (!task) return;

    var btn = document.getElementById('akt-' + idx + '-archive-btn');
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

async function viewAktSession(idx, stepId, stepKey) {
    var task = _aktTasks[idx];
    if (!task) return;

    var btn = document.getElementById('akt-' + idx + '-session-' + stepKey);
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
                        (role === 'user' ? '#0066cc' : role === 'assistant' ? '#00772e' : '#767676') + '">' + _aktEsc(role) +
                        '</b><pre style="white-space:pre-wrap;margin-top:4px">' + _aktEsc(content) + '</pre></div>';
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
 * 历史任务（分页，/api/orchestrator/tasks 过滤 arktscheck_ 前缀）
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 渲染一页历史任务卡片。
 * 数据全部来自列表响应（参考 prcheck：零逐任务请求）：
 *   - status：终态由后端在任务结束时回写注册表
 *   - metadata：各步骤 meta .json 收割合并（stabilityScore / memoryLeakScore / ...）
 * 仅活跃状态（running/pending/ready/loaded/idle）的任务才连接 SSE + 轮询。
 */
function _aktRenderHistoryPage(tasks, isFirstPage) {
    // 过滤出 arktscheck_ 前缀的任务
    var aktTasks = tasks.filter(function (t) {
        var tid = t.taskId || t.task_id || '';
        return tid.startsWith('arktscheck_');
    });

    var emptyEl = $('akt-tasks-empty');
    // 分页器会清空列表容器 innerHTML，空提示元素可能被移除，需要时重建
    if (!emptyEl) {
        var listEl = $('akt-tasks-list');
        if (listEl) {
            emptyEl = document.createElement('div');
            emptyEl.id = 'akt-tasks-empty';
            emptyEl.className = 'cc-empty-hint';
            emptyEl.textContent = '暂无检视任务，提交仓库地址后将在此显示';
            listEl.appendChild(emptyEl);
        }
    }
    if (emptyEl) emptyEl.style.display = aktTasks.length > 0 ? 'none' : '';

    // 计数按过滤后的渲染卡片数显示（注册表 total 含其他类型任务）
    var countEl2 = $('akt-task-count');
    if (countEl2) countEl2.textContent = Object.keys(_aktTasks).length + ' 个任务';

    // 后端按 created_at 降序返回（最新在前）；卡片用 insertBefore 前插，
    // 反转遍历：最旧的先渲染、被前插到下面 → 最新的最终在最上面
    aktTasks.reverse();
    for (var i = 0; i < aktTasks.length; i++) {
        var t = aktTasks[i];
        var tid = t.taskId || t.task_id;
        var status = t.status || 'idle';
        var startTime = t.created_at || t.createdAt || t.startTime;
        var endTime = t.endTime || (t.progress && t.progress.endTime);

        // 从 description（body.title）解析仓库信息
        // 格式: ArkTS仓库检视|{repoName}|{repoUrl}
        var desc = t.description || t.title || '';
        var repoName = '', repoUrl = '';
        if (desc.indexOf('ArkTS仓库检视|') === 0) {
            var segs = desc.substring('ArkTS仓库检视|'.length).split('|');
            repoName = segs[0] || '';
            repoUrl = segs[1] || '';
        } else if (desc) {
            repoName = desc;
        }
        if (!repoName) repoName = _aktTaskIdToRepoName(tid);

        var idx = ++_aktCounter;
        _aktTasks[idx] = _aktNewTaskState(tid, repoName, repoUrl);
        _aktTasks[idx].startTime = startTime ? new Date(startTime).getTime() : Date.now();
        _aktTasks[idx].startedAt = startTime || null;
        _aktTasks[idx].finishedAt = endTime || null;

        _aktCreateCard(idx, startTime, true);
        _aktUpdateStage(idx, status);

        // 终态任务：从注册表 metadata 回填各维度评分（参考 prcheck 的 mergeLevel 回填）
        var meta = (t.metadata && typeof t.metadata === 'object') ? t.metadata : null;
        if (meta) {
            var keyMap = {
                stabilityScore: 'stability',
                memoryLeakScore: 'memoryleak',
                documentationScore: 'documentation',
                testCoverageScore: 'testcoverage',
            };
            for (var scoreKey in keyMap) {
                var dimKey = keyMap[scoreKey];
                var v = Number(meta[scoreKey]);
                if (isFinite(v)) {
                    var def = null;
                    for (var d = 0; d < _AKT_STEP_DEFS.length; d++) {
                        if (_AKT_STEP_DEFS[d].key === dimKey) { def = _AKT_STEP_DEFS[d]; break; }
                    }
                    if (def) {
                        _aktSetStepScore(idx, def, Math.max(0, Math.min(100, Math.round(v))));
                    }
                }
            }
        }

        // 活跃任务才连接 SSE + 轮询；终态任务折叠展示
        var activeStages = ['running', 'pending', 'ready', 'loaded', 'idle'];
        if (activeStages.indexOf(status) >= 0) {
            _aktConnectSSE(idx);
            _aktStartProgressPoll(idx);
        } else {
            _aktFinishSSE(idx);
        }
    }
}

function _aktInitHistoryPager() {
    if (_aktPager) return Promise.resolve(_aktPager);
    _aktPager = createPagination({
        // taskIdPrefix 前缀过滤：只分页查询 arktscheck_ 任务（后端 SQL 过滤，
        // 避免与 codecheck / fluttercheck / rncheck 等其他编排任务混页）
        apiPath: '/api/orchestrator/tasks?taskIdPrefix=arktscheck_',
        listContainerId: 'akt-tasks-list',
        emptyId: 'akt-tasks-empty',
        countId: 'akt-task-count',
        pagerId: 'akt-tasks-pager',
        renderPage: _aktRenderHistoryPage,
        pageSize: 20,
    });
    return Promise.resolve(_aktPager);
}

/* ── 注册面板初始化 ──────────────────────────────────────────────────── */
if (typeof Nav !== 'undefined' && Nav.register) {
    Nav.register('p-arktslibrarycheck', initArktsLibraryCheckPanel);
}
