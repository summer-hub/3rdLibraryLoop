/**
 * ui.js —— 进度渲染与输出契约
 *
 * 设计（进度与输出打印，已确认决策）：
 *   - stdout 只放 `--json` 或最终结果（脚本可解析）
 *   - stderr 放进度日志 / 诊断信息（不影响 stdout 管道）
 *   - TTY 感知：非 TTY（CI）= 纯行式时间戳追加；TTY = 行式阶段日志 + 静止期单行刷新
 *   - verbosity 三级：--quiet / 默认 / -v
 *
 * 增量 diff 渲染：
 *   从 loop.json 快照计算"相对上次快照的变化"，仅打印变化项，避免刷屏。
 */

const isTTY = process.stdout.isTTY;

// ANSI 颜色（仅 TTY 启用，非 TTY 输出纯文本）
export const C = isTTY ? {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
} : {
    reset: '', bold: '', dim: '', red: '', green: '',
    yellow: '', blue: '', magenta: '', cyan: '', gray: '',
};

/**
 * 输出到 stderr（进度/日志通道）。
 * @param {string} message
 */
export function logProgress(message) {
    process.stderr.write(message + '\n');
}

/**
 * 带时间戳的进度行（非 TTY 模式）。
 * @param {string} message
 * @param {boolean} [verbose]
 */
export function logLine(message, verbose = false) {
    if (verbose && !process.env.LOOP_SHOW_TIMESTAMP) return;
    const ts = new Date().toISOString().slice(11, 19);
    process.stderr.write(`${C.gray}[${ts}]${C.reset} ${message}\n`);
}

/**
 * 状态图标 / 文案映射。
 */
const STATUS_LABEL = {
    idle: '待启动',
    planning: '拆解中',
    executing: '执行中',
    checking: '审核中',
    passed: '通过 ✓',
    failed: '失败 ✗',
    aborted: '已中止 ⏹',
    error: '出错 ✗',
};

/**
 * 渲染循环级进度一行（非 TTY 行式）。
 * @param {object} p - loop.json 快照
 */
export function renderLoopLine(p) {
    const roundInfo = p.rounds && p.rounds.length
        ? `${p.rounds.length}/${p.maxLoops}` : `0/${p.maxLoops}`;
    const label = STATUS_LABEL[p.status] || p.status;
    const color = p.status === 'passed' ? C.green
        : (p.status === 'failed' || p.status === 'error' || p.status === 'aborted') ? C.red
        : C.cyan;
    logLine(`${color}循环 ${roundInfo} 状态=${label}${C.reset}`, true);
}

/**
 * 计算两个循环快照的增量（返回需要打印的变化行描述）。
 *
 * @param {object|null} prev - 上次快照（无则 null）
 * @param {object} cur        - 当前快照
 * @param {object} [opts]
 * @param {boolean} [opts.verbose]
 * @returns {string[]} 变化行列表
 */
export function diffLoop(prev, cur, opts = {}) {
    const lines = [];

    if (!prev) {
        // 首次快照：纯描述状态
        const label = STATUS_LABEL[cur.status] || cur.status;
        lines.push(`任务状态: ${label}`);
        return lines;
    }

    // 状态变化
    if (prev.status !== cur.status) {
        const from = STATUS_LABEL[prev.status] || prev.status;
        const to = STATUS_LABEL[cur.status] || cur.status;
        lines.push(`阶段变化: ${from} → ${to}`);
    }

    // 轮次推进
    const prevRounds = prev.rounds?.length || 0;
    const curRounds = cur.rounds?.length || 0;
    if (curRounds > prevRounds) {
        lines.push(`轮次推进: ${curRounds}/${cur.maxLoops}`);
    }

    // 轮内状态细化（当前轮）
    if (cur.status === 'passed' || cur.status === 'failed') {
        const lastRound = cur.rounds?.[cur.rounds.length - 1];
        if (lastRound) {
            const check = lastRound.checkPassed != null
                ? (lastRound.checkPassed ? '准出通过' : '准出未通过')
                : '';
            const orchStatus = lastRound.orchestratorStatus || '';
            lines.push(`终态判定: ${lastRound.error ? '出错: ' + lastRound.error : check || orchStatus || STATUS_LABEL[cur.status]}`);
        }
    }

    return lines;
}

/**
 * 计算两个编排快照的增量（返回需要打印的变化行描述）。
 *
 * 面向 orchestration.json（Orchestrator.getProgress() 产物）：
 *   - 首快照：输出整体概览
 *   - 步骤状态变化：输出发生变化的步骤行
 *
 * @param {object|null} prev - 上次快照（无则 null）
 * @param {object} cur        - 当前快照
 * @param {object} [opts]
 * @param {boolean} [opts.verbose]
 * @returns {string[]} 变化行列表
 */
export function diffOrchestration(prev, cur, opts = {}) {
    const lines = [];

    if (!prev) {
        // 首次快照：整体概览
        const stats = cur.stats || {};
        lines.push(`编排任务: ${cur.taskId}  状态: ${_orchStatusLabel(cur.status)}`);
        if (Array.isArray(cur.steps) && cur.steps.length) {
            lines.push(`步骤: ${cur.steps.length} 个（完成 ${stats.completed || 0} / 失败 ${stats.failed || 0} / 进行 ${stats.running || 0}）`);
        }
        return lines;
    }

    // 编排状态变化
    if (prev.status !== cur.status) {
        lines.push(`编排状态: ${_orchStatusLabel(prev.status)} → ${_orchStatusLabel(cur.status)}`);
    }

    // 步骤状态变化
    const prevSteps = new Map((prev.steps || []).map(s => [String(s.stepId), s.status]));
    for (const step of cur.steps || []) {
        const sid = String(step.stepId);
        const prevStatus = prevSteps.get(sid);
        if (prevStatus !== step.status) {
            const icon = step.status === 'completed' ? '✓' : (step.status === 'failed' ? '✗' : '▶');
            const statusText = _orchNodeStatusLabel(step.status);
            let line = `步骤 ${sid} ${icon} ${statusText}`;
            if (opts.verbose && step.taskDescription) {
                line += `  ${step.taskDescription.slice(0, 60)}`;
            }
            if (step.status === 'failed' && step.error) line += `  (${step.error.slice(0, 80)})`;
            if (step.resultPath && (step.status === 'completed')) line += `  产物: ${step.resultPath}`;
            lines.push(line);
        }
    }

    return lines;
}

/** OrchestratorStatus 的中文标签。 */
function _orchStatusLabel(status) {
    const map = {
        idle: '待加载', loaded: '已加载', running: '运行中',
        completed: '完成', failed: '失败', aborted: '已中止', deadlocked: '死锁',
    };
    return map[status] || status;
}

/** NodeStatus 的中文标签。 */
function _orchNodeStatusLabel(status) {
    const map = {
        pending: '等待中', ready: '就绪', running: '执行中',
        completed: '完成', failed: '失败', skipped: '跳过', blocked: '阻塞',
    };
    return map[status] || status;
}

/**
 * 从结果文件 / 内存任务快照提取最终可读摘要。
 * @param {object} progress - loop.json 快照
 * @returns {string}
 */
export function finalSummary(progress) {
    const parts = [];
    parts.push(`任务: ${progress.taskId}`);
    parts.push(`状态: ${STATUS_LABEL[progress.status] || progress.status}`);
    if (progress.currentLoop != null && progress.maxLoops != null) {
        parts.push(`轮次: ${progress.currentLoop}/${progress.maxLoops}`);
    }
    if (progress.error) parts.push(`错误: ${progress.error}`);

    const rounds = progress.rounds || [];
    const lastPassed = rounds.find(r => r.checkPassed);
    const last = rounds[rounds.length - 1];
    if (lastPassed) {
        parts.push(`准出通过: 第 ${lastPassed.loop + 1} 轮`);
        if (lastPassed.checkSummary) parts.push(`审核摘要: ${lastPassed.checkSummary}`);
    } else if (last && last.checkSummary) {
        parts.push(`最后审核: ${last.checkSummary}`);
    }
    if (progress.taskDir) parts.push(`产物目录: ${progress.taskDir}`);
    return parts.join('\n');
}