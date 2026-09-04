/**
 * orch.js —— 编排层命令（Orchestrator 多步骤依赖）
 *
 * 命令：
 *   orch run    <task-def.json>          加载任务定义 + 启动编排，阻塞到终态
 *   orch load   <task-def.json>          仅加载任务定义，落盘 orchestration.json 后返回
 *   orch start  <taskId>                 从磁盘恢复 LOADED 状态并启动，阻塞到终态
 *   orch progress <taskId> [--loop N]    查询编排进度（磁盘直读 orchestration.json）
 *   orch abort|pause|resume <taskId>     控制编排（尽力而为）
 *   orch tasks                           列出编排任务（仅统计有 orchestration.json 的任务）
 *
 * 与 3rdloop step 的区别：
 *   - step 是单步 FlexRunner 直连，不经 Orchestrator
 *   - orch 走多步骤依赖编排（loadTask → start），对应 HTTP /api/orchestrator/load|start
 */

import fs from 'node:fs';
import { EXIT } from './exit-codes.js';

/**
 * 3rdloop orch 命令二段分发。
 * @returns {Promise<number>}
 */
export async function cmdOrch({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }) {
    const fRest = flags.rest || [];
    const sub = fRest[0];
    const subRest = fRest.slice(1);
    switch (sub) {
        case 'run':
            return cmdOrchRun({ flags, rest: subRest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });
        case 'load':
            return cmdOrchLoad({ flags, rest: subRest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });
        case 'start':
            return cmdOrchStart({ flags, rest: subRest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });
        case 'progress':
            return cmdOrchProgress({ flags, rest: subRest, dataDir, jsonMode, out, u });
        case 'abort':
        case 'pause':
        case 'resume':
            return cmdOrchControl(sub, { flags, rest: subRest, projectRoot, dataDir, skillDir, jsonMode, out, u });
        case 'tasks':
            return cmdOrchTasks({ flags, rest: subRest, dataDir, jsonMode, out, u });
        default:
            process.stderr.write(`缺少或未知的 orch 子命令: ${sub || '(空)'}\n`);
            process.stderr.write('用法: 3rdloop orch run|load|start|progress|abort|pause|resume|tasks ...\n');
            return EXIT.ERROR;
    }
}

// ─── 位置参数提取 ──────────────────────────────────────────────────────────

/** orch 子命令专用 flags（带值），从参数中剔除以提取位置参数。 */
const ORCH_FLAG_NAMES = ['task-id', 'loop', 'task-dir', 'max-retries', 'input-report'];

/**
 * 从参数数组提取位置参数（task-def 文件 / taskId）。
 * 结构与 step.js 的 _positionalArgs 对齐。
 */
function _positionalArgs(args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const name = arg.slice(2);
            if (ORCH_FLAG_NAMES.includes(name)) i++; // 跳过该 flag 的值
            continue;
        }
        out.push(arg);
    }
    return out;
}

function _parseIntFlag(flags, name, def) {
    const idx = flags.rest.indexOf(`--${name}`);
    const raw = idx !== -1 ? flags.rest[idx + 1] : undefined;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : def;
}

function _stringFlag(flags, name) {
    const idx = flags.rest.indexOf(`--${name}`);
    return idx !== -1 ? flags.rest[idx + 1] : undefined;
}

/** 惰性加载 runner（避免未用到时启动完整引擎）。 */
function _runner() {
    return import('./runner.js');
}

/** 惰性加载 queries。 */
function _queries() {
    return import('./queries.js');
}

/** 读取并校验 task-def JSON 文件。 */
function _readTaskDef(file) {
    if (!file) {
        throw new Error('缺少任务定义文件。用法: 3rdloop orch load <task-def.json>');
    }
    if (!fs.existsSync(file)) {
        throw new Error(`任务定义文件不存在: ${file}`);
    }
    let taskDef;
    try {
        taskDef = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`任务定义文件解析失败: ${file}, ${err.message}`);
    }
    if (!taskDef.taskId) {
        throw new Error('task-def 中缺少 taskId');
    }
    if (!Array.isArray(taskDef.steps) || taskDef.steps.length === 0) {
        throw new Error('task-def 中 steps 为必填项且不能为空');
    }
    return taskDef;
}

// ─── run / load ─────────────────────────────────────────────────────────────

/** 加载任务定义 + 启动编排，阻塞到终态（推荐入口）。 */
async function cmdOrchRun({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }) {
    const positional = _positionalArgs(rest);
    const taskDefFile = positional[0];
    let taskDef;
    try {
        taskDef = _readTaskDef(taskDefFile);
    } catch (err) {
        if (jsonMode) out({ ok: false, error: err.message });
        else process.stderr.write(`${err.message}\n`);
        return EXIT.ERROR;
    }

    if (!quiet && !jsonMode) {
        u.logProgress(`${u.C.cyan}编排任务已提交: ${u.C.reset}${u.C.bold}${taskDef.taskId}${u.C.reset}`);
        u.logProgress(`  任务定义: ${taskDefFile}`);
        u.logProgress(`  步骤数: ${taskDef.steps.length}`);
        if (taskDef.steps.length <= 8) {
            for (const s of taskDef.steps) {
                u.logProgress(`    step ${s.stepId}: ${String(s.taskDescription || '').slice(0, 60)}${s.dependId ? ` [依赖 ${s.dependId}]` : ''}`);
            }
        }
    }

    const r = await _runner();
    const ctx = r.createRunContext({ projectRoot, dataDir, skillDir, verbose });

    // 挂载 AI CLI serve 生命周期
    const oc = await _ensureCliServe(ctx, u, jsonMode, out);
    if (!oc) return EXIT.ERROR;

    // 信号处理
    let interrupted = false;
    const exitHandler = async (sig) => {
        if (interrupted) return;
        interrupted = true;
        try { await r.orchControl(ctx, taskDef.taskId, 'abort'); } catch { /* 忽略 */ }
        await oc.stop();
        process.stderr.write(`\n已中止（${sig}）\n`);
        process.exit(sig === 'SIGINT' ? EXIT.SIGINT : EXIT.SIGTERM);
    };
    process.once('SIGINT', () => exitHandler('SIGINT'));
    process.once('SIGTERM', () => exitHandler('SIGTERM'));

    const started = Date.now();
    try {
        // load + start（阻塞）
        await r.orchLoad(ctx, taskDef);
        const result = await _startAndRender(ctx, r, taskDef.taskId, { jsonMode, quiet, verbose, out, u, started, dataDir });
        return result.passed ? EXIT.OK : EXIT.TASK_FAILED;
    } catch (err) {
        await oc.stop();
        if (jsonMode) out({ ok: false, error: err.message, taskId: taskDef.taskId });
        else process.stderr.write(`\n编排失败: ${err.message}\n`);
        return EXIT.ERROR;
    }
}

/** 仅加载任务定义，落盘 orchestration.json 后返回。 */
async function cmdOrchLoad({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }) {
    const positional = _positionalArgs(rest);
    const taskDefFile = positional[0];
    let taskDef;
    try {
        taskDef = _readTaskDef(taskDefFile);
    } catch (err) {
        if (jsonMode) out({ ok: false, error: err.message });
        else process.stderr.write(`${err.message}\n`);
        return EXIT.ERROR;
    }

    const r = await _runner();
    const ctx = r.createRunContext({ projectRoot, dataDir, skillDir, verbose });
    try {
        const res = await r.orchLoad(ctx, taskDef);
        if (!quiet) {
            u.logProgress(`编排任务已加载: ${taskDef.taskId}（步骤 ${taskDef.steps.length}）`);
        }
        if (jsonMode) {
            out({ ok: true, taskId: taskDef.taskId, status: 'loaded', stepCount: taskDef.steps.length });
        } else {
            process.stdout.write(`${taskDef.taskId}\n`);
        }
        return EXIT.OK;
    } catch (err) {
        if (jsonMode) out({ ok: false, error: err.message });
        else process.stderr.write(`加载失败: ${err.message}\n`);
        return EXIT.ERROR;
    }
}

// ─── start（从磁盘恢复） ───────────────────────────────────────────────────

/** 从磁盘恢复 LOADED 状态并启动编排，阻塞到终态。 */
async function cmdOrchStart({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }) {
    const positional = _positionalArgs(rest);
    const taskId = positional[0];
    if (!taskId) {
        if (jsonMode) out({ ok: false, error: '缺少 taskId。用法: 3rdloop orch start <taskId>' });
        else process.stderr.write('缺少 taskId。用法: 3rdloop orch start <taskId>\n');
        return EXIT.ERROR;
    }

    const r = await _runner();
    const ctx = r.createRunContext({ projectRoot, dataDir, skillDir, verbose });
    const oc = await _ensureCliServe(ctx, u, jsonMode, out);
    if (!oc) return EXIT.ERROR;

    let interrupted = false;
    const exitHandler = async (sig) => {
        if (interrupted) return;
        interrupted = true;
        try { await r.orchControl(ctx, taskId, 'abort'); } catch { /* 忽略 */ }
        await oc.stop();
        process.stderr.write(`\n已中止（${sig}）\n`);
        process.exit(sig === 'SIGINT' ? EXIT.SIGINT : EXIT.SIGTERM);
    };
    process.once('SIGINT', () => exitHandler('SIGINT'));
    process.once('SIGTERM', () => exitHandler('SIGTERM'));

    const started = Date.now();
    try {
        const result = await _startAndRender(ctx, r, taskId, { jsonMode, quiet, verbose, out, u, started, dataDir });
        return result.passed ? EXIT.OK : EXIT.TASK_FAILED;
    } catch (err) {
        await oc.stop();
        if (jsonMode) out({ ok: false, error: err.message, taskId });
        else process.stderr.write(`\n编排启动失败: ${err.message}\n`);
        return EXIT.ERROR;
    }
}

/** 调用 orchStart 并渲染进度（run / start 共用）。 */
async function _startAndRender(ctx, r, taskId, { jsonMode, quiet, verbose, out, u, started, dataDir }) {
    const q = await _queries();
    let prev = null;
    let finished = false;

    // 后台轮询编排磁盘快照（每次步骤状态变化 Orchestrator 都会 _persistState），
    // diff 渲染中间进度。只有非 --json 模式才打印，避免污染 stdout。
    // 首帧只记录不打印（prev=null 时不输出），避免启动失败（如状态非 LOADED）
    // 时打印误导性的概览行；最终变化由 orchStart 返回后一次性补齐。
    const poll = (async () => {
        if (jsonMode) return;
        while (!finished) {
            const state = q.readOrchestrationState(dataDir, taskId);
            if (state && prev) {
                const lines = u.diffOrchestration(prev, state, { verbose });
                for (const line of lines) u.logProgress(line);
            }
            if (state) prev = state;
            await new Promise(res => setTimeout(res, 3000));
        }
    })();

    try {
        const result = await r.orchStart(ctx, taskId);
        finished = true;
        await poll;

        // 补齐首帧到终态的变化行
        if (!jsonMode) {
            const lines = u.diffOrchestration(prev, result.progress, { verbose });
            for (const line of lines) u.logProgress(line);
        }

        const elapsedSec = ((Date.now() - started) / 1000).toFixed(0);

        if (jsonMode) {
            out({
                ok: result.passed,
                taskId,
                status: result.status,
                passed: result.passed,
                stats: result.progress.stats || null,
                steps: result.progress.steps || [],
                error: result.error,
                resultPaths: result.resultPaths || [],
                elapsedSec: Number(elapsedSec),
            });
        } else {
            u.logProgress(`\n${result.passed ? u.C.green : u.C.red}编排完成: ${u.C.reset}${result.status}`);
            u.logProgress(`  耗时: ${elapsedSec}s`);
            const stats = result.progress.stats || {};
            u.logProgress(`  步骤: 完成 ${stats.completed || 0} / 失败 ${stats.failed || 0}`);
            if (result.error) u.logProgress(`  错误: ${result.error}`);
            for (const item of result.resultPaths || []) {
                u.logProgress(`  产物 ${item.stepId}: ${item.resultPath}`);
            }
        }
        return result;
    } catch (err) {
        finished = true;
        throw err;
    }
}

// ─── progress ───────────────────────────────────────────────────────────────

/** 查询编排进度（磁盘直读 orchestration.json）。 */
async function cmdOrchProgress({ flags, rest, dataDir, jsonMode, out, u }) {
    const positional = _positionalArgs(rest);
    const taskId = positional[0];
    if (!taskId) {
        if (jsonMode) out({ ok: false, error: '缺少 taskId。用法: 3rdloop orch progress <taskId> [--loop N]' });
        else process.stderr.write('缺少 taskId。用法: 3rdloop orch progress <taskId> [--loop N]\n');
        return EXIT.ERROR;
    }

    const loop = _parseIntFlag(flags, 'loop', undefined);
    const q = await _queries();
    const state = q.readOrchestrationState(dataDir, taskId, loop);

    if (!state) {
        if (jsonMode) out({ ok: false, error: '编排任务不存在', taskId, loop: loop ?? null });
        else process.stderr.write(`编排任务不存在: ${taskId}${loop != null ? ` (loop=${loop})` : ''}\n`);
        return EXIT.ERROR;
    }

    const lines = u.diffOrchestration(null, state, { verbose: false });
    if (jsonMode) {
        // 结构化输出：保持与 HTTP GET /orchestrator/progress 一致形态
        out({ ok: true, taskId, status: state.status, loop: loop ?? null, progress: state });
        return EXIT.OK;
    }
    for (const line of lines) u.logProgress(line);
    // 追加步骤明细
    const steps = state.steps || [];
    for (const s of steps) {
        const icon = s.status === 'completed' ? '✓' : (s.status === 'failed' ? '✗' : (s.status === 'running' ? '▶' : '·'));
        u.logProgress(`  ${icon} step ${String(s.stepId).padEnd(4)} ${(s.status || '').padEnd(10)} ${String(s.taskDescription || '').slice(0, 50)}`);
    }
    return EXIT.OK;
}

// ─── 控制 ───────────────────────────────────────────────────────────────────

/** 终止 / 暂停 / 恢复编排（尽力而为，跨进程无法中断另一进程运行中的任务）。 */
async function cmdOrchControl(action, { flags, rest, projectRoot, dataDir, skillDir, jsonMode, out, u }) {
    const positional = _positionalArgs(rest);
    const taskId = positional[0];
    if (!taskId) {
        if (jsonMode) out({ ok: false, error: `缺少 taskId。用法: 3rdloop orch ${action} <taskId>` });
        else process.stderr.write(`缺少 taskId。用法: 3rdloop orch ${action} <taskId>\n`);
        return EXIT.ERROR;
    }

    const r = await _runner();
    const ctx = r.createRunContext({ projectRoot, dataDir, skillDir, verbose: false });
    const result = await r.orchControl(ctx, taskId, action);

    if (jsonMode) {
        out({ ok: result.ok, taskId, action, status: result.status, error: result.error });
    } else {
        if (result.ok) {
            process.stderr.write(`编排已${action === 'abort' ? '终止' : (action === 'pause' ? '暂停' : '恢复')}: ${taskId}\n`);
        } else {
            process.stderr.write(`${result.error || `操作 ${action} 未生效（可能未在运行中）: ${taskId}`}\n`);
        }
    }
    return result.ok ? EXIT.OK : EXIT.ERROR;
}

// ─── tasks ──────────────────────────────────────────────────────────────────

/** 列出编排任务。 */
async function cmdOrchTasks({ flags, rest, dataDir, jsonMode, out, u }) {
    const q = await _queries();
    const tasks = q.listOrchestrationTasks(dataDir);

    if (jsonMode) {
        out({ total: tasks.length, tasks });
        return EXIT.OK;
    }

    if (tasks.length === 0) {
        process.stdout.write('（暂无编排任务）\n');
        return EXIT.OK;
    }

    process.stdout.write(`共 ${tasks.length} 个编排任务：\n`);
    for (const t of tasks) {
        const icon = t.status === 'completed' ? u.C.green + '✓' + u.C.reset
            : (t.status === 'running') ? u.C.cyan + '▶' + u.C.reset
            : u.C.red + '✗' + u.C.reset;
        const stepInfo = `步骤 ${t.stepCompleted}/${t.stepCount}`;
        process.stdout.write(`  ${icon} ${t.taskId.padEnd(40)} ${(t.status || '').padEnd(10)} ${stepInfo.padEnd(12)} ${t.startTime || ''}\n`);
    }
    return EXIT.OK;
}

// ─── 工具 ──────────────────────────────────────────────────────────────────

/** 确保 AI CLI serve 运行（run/start 需要执行环境；load/progress 不需要）。 */
async function _ensureCliServe(ctx, u, jsonMode, out) {
    const { CliServeManager } = await import('./opencode.js');
    const oc = new CliServeManager({ projectRoot: ctx.projectRoot, cliType: ctx.cliType });
    const ocHealth = await oc.ensureRunning();
    if (!ocHealth.ok) {
        if (jsonMode) out({ ok: false, error: ocHealth.message });
        process.stderr.write(`\n错误: ${ocHealth.message}\n`);
        process.stderr.write(`请先启动 ${oc.cliType} serve（项目上一级目录: ${oc.bin} serve）后重试。\n`);
        await oc.stop();
        return null;
    }
    if (ocHealth.spawned) process.stderr.write(`${ocHealth.message}\n`);
    return oc;
}