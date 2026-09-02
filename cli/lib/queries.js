/**
 * queries.js —— 任务状态查询（磁盘直读）
 *
 * 与 runner.js 的区分：
 *   runner.js  负责"执行"（提交/运行/中止）
 *   queries.js 负责"只读查询"（progress/list/result），不实例化完整引擎，
 *              直接从磁盘读 db/task/{taskId}/ 下的状态文件。
 *
 * 好处：
 *   - 查询命令（progress/list/result）不依赖 opencode / LLM / 内存实例，
 *     即使引擎未运行也能查询历史任务。
 *   - 与 LoopEngineController.list() 的数据来源一致（loop.json 优先，其次 orchestration.json）。
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 计算 taskRoot 目录绝对路径。
 * @param {string} dataDir - 数据目录（~/.3lib/3rdloop/db）
 * @returns {string}
 */
export function taskDir(dataDir) {
    return path.join(dataDir, 'task');
}

/**
 * 读取单个任务快照（loop.json 优先，其次 orchestration.json）。
 * @returns {object|null}
 */
export function readTaskState(dataDir, taskId) {
    if (!taskId) return null;
    const taskPath = path.join(taskDir(dataDir), taskId);
    if (!fs.existsSync(taskPath)) return null;

    const candidates = ['loop.json', 'orchestration.json'];
    for (const file of candidates) {
        const full = path.join(taskPath, file);
        if (fs.existsSync(full)) {
            try {
                const data = JSON.parse(fs.readFileSync(full, 'utf8'));
                if (data) return data;
            } catch { /* 尝试下一个文件 */ }
        }
    }
    return null;
}

/**
 * 列出所有任务快照（按 startTime 降序）。
 *
 * @param {object} opts
 * @param {string} [opts.status]     - 按状态过滤
 * @param {number} [opts.limit]      - 数量上限
 * @param {string} [opts.olderThan]  - 只保留早于该时长的任务（如 '7d'）
 * @returns {object[]}
 */
export function listTasks(dataDir, opts = {}) {
    const tdir = taskDir(dataDir);
    if (!fs.existsSync(tdir)) return [];

    const entries = fs.readdirSync(tdir, { withFileTypes: true });
    const tasks = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!/^task_/.test(entry.name) && !/^[a-zA-Z0-9_-]{6,}/.test(entry.name)) {
            // 仅接受像 taskId 的目录名，避免混入杂项目录
        }
        const state = readTaskState(dataDir, entry.name);
        if (!state) continue;

        if (opts.status) {
            const want = String(opts.status).toLowerCase();
            // 兼容别名：running / active → 任一进行中状态（引擎任务级状态是
            // planning/executing/checking，没有 running；running 是步骤/会话级词）
            if (want === 'running' || want === 'active') {
                if (!['planning', 'executing', 'checking'].includes(state.status)) continue;
            } else if (state.status !== want) {
                continue;
            }
        }

        const item = {
            taskId: state.taskId || entry.name,
            status: state.status || 'idle',
            currentLoop: state.currentLoop ?? state.loopCount ?? 0,
            maxLoops: state.maxLoops ?? 3,
            startTime: state.startTime || null,
            endTime: state.endTime || null,
            passed: state.status === 'passed',
            error: state.error || null,
            isSingleExecution: !!state.isSingleExecution,
        };

        if (opts.olderThan) {
            const cutoff = _parseOlderThan(opts.olderThan);
            const startMs = _toMs(item.startTime);
            if (startMs >= cutoff) continue; // 不是"早于"则跳过
        }

        tasks.push(item);
        if (opts.limit && tasks.length >= opts.limit) break;
    }

    tasks.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
    return tasks;
}

/**
 * 读取编排任务状态（磁盘直读 orchestration.json / orchestration_loop{N}.json）。
 *
 * 与 readTaskState 的区别：
 *   - readTaskState 面向大循环任务快照（loop.json 优先）
 *   - readOrchestrationState 面向纯编排任务（3rdloop orch load/start 产物），
 *     可指定轮次读取历史快照
 *
 * @param {string} dataDir - 数据目录
 * @param {string} taskId  - 任务 ID
 * @param {number|string} [loop] - 可选，指定读取 orchestration_loop{N}.json（不传读最新）
 * @returns {object|null} 状态对象（不存在/损坏返回 null）
 */
export function readOrchestrationState(dataDir, taskId, loop) {
    if (!taskId) return null;
    const taskPath = path.join(taskDir(dataDir), taskId);
    if (!fs.existsSync(taskPath)) return null;

    const candidates = [];
    if (loop != null && loop !== '') {
        candidates.push(`orchestration_loop${loop}.json`);
    }
    candidates.push('orchestration.json');

    for (const file of candidates) {
        const full = path.join(taskPath, file);
        if (fs.existsSync(full)) {
            try {
                const data = JSON.parse(fs.readFileSync(full, 'utf8'));
                if (data) return data;
            } catch { /* 尝试下一个文件 */ }
        }
    }
    return null;
}

/**
 * 列出所有编排任务（扫描 db/task 下各目录的 orchestration.json）。
 *
 * 供 3rdloop orch tasks 使用：只统计存在 orchestration.json 的目录，
 * 不掺入仅有大循环 loop.json 的任务。
 *
 * @param {string} dataDir - 数据目录
 * @returns {object[]} 按 startTime 降序
 */
export function listOrchestrationTasks(dataDir) {
    const tdir = taskDir(dataDir);
    if (!fs.existsSync(tdir)) return [];

    const entries = fs.readdirSync(tdir, { withFileTypes: true });
    const tasks = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const orchFile = path.join(tdir, entry.name, 'orchestration.json');
        if (!fs.existsSync(orchFile)) continue;
        const state = readOrchestrationState(dataDir, entry.name);
        if (!state) continue;

        const stats = state.stats || {};
        tasks.push({
            taskId: state.taskId || entry.name,
            status: state.status || 'idle',
            loopCount: state.loopCount ?? 0,
            startTime: state.startTime || null,
            endTime: state.endTime || null,
            error: state.error || null,
            stepCount: Array.isArray(state.steps) ? state.steps.length : stats.total || 0,
            stepCompleted: stats.completed || 0,
            stepFailed: stats.failed || 0,
        });
    }

    tasks.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
    return tasks;
}

/**
 * 读取任务最终结果。
 *
 * @param {object} dataDir - 数据目录
 * @param {string} taskId  - 任务 ID
 * @param {object} [opts]
 * @param {boolean} [opts.raw]  - true 时返回原始 loop.json（含全部轮次详情）
 * @returns {object|null}
 */
export function readTaskResult(dataDir, taskId, opts = {}) {
    const state = readTaskState(dataDir, taskId);
    if (!state) return null;

    if (opts.raw) return state;

    // 精简结果：最终状态 + 各轮审核摘要 + 产物路径
    const rounds = (state.rounds || []).map(r => ({
        loop: r.loop,
        passed: r.passed,
        checkPassed: r.checkPassed != null ? r.checkPassed : null,
        checkSummary: r.checkSummary || null,
        orchestratorStatus: r.orchestratorStatus || null,
        error: r.error || null,
    }));

    return {
        taskId: state.taskId,
        status: state.status,
        passed: state.status === 'passed',
        currentLoop: state.currentLoop,
        maxLoops: state.maxLoops,
        startTime: state.startTime,
        endTime: state.endTime,
        error: state.error,
        rounds,
        taskDir: state.taskDir,
    };
}

/**
 * 读取步骤级详情（可选增强，用于 -v/result 深挖）。
 * @returns {object[]}
 */
export function readTaskSteps(dataDir, taskId, loop = 0) {
    const taskPath = path.join(taskDir(dataDir), taskId);
    const files = [
        `orchestration_loop${loop}.json`,
        'orchestration.json',
    ];
    for (const file of files) {
        const full = path.join(taskPath, file);
        if (fs.existsSync(full)) {
            try {
                const data = JSON.parse(fs.readFileSync(full, 'utf8'));
                if (Array.isArray(data.steps)) return data.steps;
            } catch { /* 继续 */ }
        }
    }
    return [];
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────

/** 解析 --older-than 为毫秒时间戳截止线（如 '7d' / '24h'）。 */
function _parseOlderThan(value) {
    const match = String(value).trim().toLowerCase().match(/^(\d+)(d|h|m|s)?$/);
    const num = match ? parseFloat(match[1]) : 0;
    const unit = match?.[2] || 'd';
    const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
    return Date.now() - num * unitMs;
}

/** 将 CST 字符串或时间戳转为 ms。 */
function _toMs(value) {
    if (!value) return 0;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
}