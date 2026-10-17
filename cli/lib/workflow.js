/**
 * workflow.js —— 工作流执行器
 *
 * 职责：
 *   - 解析工作流 params schema（cli/workflows/*.js 声明）对应的 CLI flags
 *   - 必填校验 / 未知 flag 校验 / --help 参数说明
 *   - 调用工作流 buildTaskDef(params) 构造具参 taskDef
 *   - 复用 runner.js 的 orchLoad / orchStart 链路执行编排，沿用 orch.js 的
 *     信号处理、进度渲染与退出码约定（passed=0 / failed=2 / TIMEOUT=3 / SIGINT=130 / SIGTERM=143）
 *   - --print-taskdef dry-run：只构造并打印/落盘 taskDef，不触碰引擎
 *   - afterRun 钩子：工作流声明对象上可选的 async 函数，编排结束后执行
 *     （成功/失败均调用；入参 { params, taskDef, result, dataDir, cwd }；抛错只记录不改退出码）
 *
 * 产品形态与责任边界：
 *   - 本期只提供机制（注册/分发/taskDef 构造/编排执行），不预置业务工作流
 *   - 具体工作流（如 pr push）由后续其他项目开发者按 cli/workflows/*.js 约定注册
 */

import fs from 'node:fs';
import path from 'node:path';
import { EXIT } from './exit-codes.js';
import { closeAllRunContexts } from './lifecycle.js';

/**
 * 3rdloop run <workflow> 命令实现（由 cli.js 在工作流命中时转发）。
 * @param {object} ctx
 * @param {object} ctx.wf            - 工作流声明对象（含 name/params/buildTaskDef）
 * @param {string[]} ctx.wfWords     - 位置参数（已消费掉工作流名的剩余部分）
 * @param {object} ctx.flags         - parseGlobalFlags 返回
 * @param {object} ctx.env           - { projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }
 * @returns {Promise<number>} 退出码
 */
export async function cmdWorkflow({ wf, wfWords, flags, env }) {
    const { rest } = flags;
    const { jsonMode, quiet, verbose, out, u, dataDir } = env;

    // ── 工作流自有参数解析（从 flags.rest 中提取）─────────────────────
    const paramSpecs = Array.isArray(wf.params) ? wf.params : [];
    const flagNames = new Set(paramSpecs.map(p => p.flag));

    // --help：打印该工作流参数说明（退出码 0）
    if (rest.includes('--help') || rest.includes('-h')) {
        _printWorkflowHelp(wf, paramSpecs);
        return EXIT.OK;
    }

    // 收集值型 flag：--flag <value>
    const params = {};
    const usedFlags = new Set();
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (!arg.startsWith('--')) continue;
        const name = arg.slice(2);
        if (!flagNames.has(name)) continue;
        const value = rest[i + 1];
        if (value === undefined) {
            process.stderr.write(`缺少参数值: --${name}\n`);
            return EXIT.ERROR;
        }
        params[name] = value;
        usedFlags.add(name);
        i++; // 跳过值
    }

    // ── 必填校验 ──────────────────────────────────────────────────────
    const missing = paramSpecs.filter(p => p.required && (params[p.flag] == null || params[p.flag] === ''));
    if (missing.length > 0) {
        process.stderr.write(`工作流 "${wf.name}" 缺少必填参数:\n`);
        for (const p of missing) {
            process.stderr.write(`  --${p.flag}` + (p.describe ? `  ${p.describe}` : '') + '\n');
        }
        process.stderr.write('\n用法: 3rdloop run ' + wf.name + ' ' + paramSpecs.map(p => '--' + p.flag).join(' ') + '\n');
        return EXIT.ERROR;
    }

    // ── 未知 flag 校验（只报告工作流 schema 之外的 --flag，非 flag 的裸词忽略）──
    const unknownFlags = [];
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (!arg.startsWith('--')) continue;
        const name = arg.slice(2);
        if (flagNames.has(name)) continue;
        if (['print-taskdef'].includes(name)) continue; // 框架级 flag
        unknownFlags.push(name);
    }
    if (unknownFlags.length > 0) {
        process.stderr.write(`工作流 "${wf.name}" 不认识的参数: ${unknownFlags.map(f => '--' + f).join(', ')}\n`);
        return EXIT.ERROR;
    }

    // ── 构造 taskDef ────────────────────────────────────────────────
    let taskDef;
    try {
        taskDef = await wf.buildTaskDef(params, { dataDir, cwd: process.cwd() });
    } catch (err) {
        process.stderr.write(`工作流 "${wf.name}" 构造 taskDef 失败: ${err.message}\n`);
        return EXIT.ERROR;
    }
    if (!taskDef || typeof taskDef !== 'object') {
        process.stderr.write(`工作流 "${wf.name}" 的 buildTaskDef 未返回有效 taskDef 对象\n`);
        return EXIT.ERROR;
    }
    if (!Array.isArray(taskDef.steps) || taskDef.steps.length === 0) {
        process.stderr.write(`工作流 "${wf.name}" 的 taskDef 缺少非空 steps 数组\n`);
        return EXIT.ERROR;
    }

    // ── taskId 缺省补全 ─────────────────────────────────────────────
    // runner.orchLoad / Orchestrator.loadTask 均要求 taskId 必填；
    // 工作流若未显式指定则由 CLI 生成稳定唯一 taskId（generateTaskId），
    // taskDir 缺省由 Orchestrator.loadTask 落到 <data-dir>/task/<taskId>。
    if (!taskDef.taskId) {
        const cfg = await _config();
        taskDef.taskId = cfg.generateTaskId() + '_wf';
        if (jsonMode) { /* 生成值在最终 JSON 中体现 */ }
    }

    // ── dry-run：仅打印/落盘 taskDef，不触碰引擎 ────────────────────
    if (rest.includes('--print-taskdef')) {
        const taskId = taskDef.taskId || 'task_wf_dry';
        const printTarget = path.join(dataDir, 'task', taskId);
        fs.mkdirSync(printTarget, { recursive: true });
        const dryPath = path.join(printTarget, 'task-def.dry.json');
        fs.writeFileSync(dryPath, JSON.stringify(taskDef, null, 2), 'utf8');
        if (jsonMode) {
            out({ ok: true, dryRun: true, taskId, taskDef, dryPath });
        } else {
            process.stdout.write(`--print-taskdef [dry-run] 工作流: ${wf.name}\n`);
            process.stdout.write(`  taskId: ${taskId}\n`);
            process.stdout.write(`  步骤数: ${taskDef.steps.length}\n`);
            process.stdout.write(`  taskDef 预览:\n`);
            process.stdout.write(JSON.stringify(taskDef, null, 2) + '\n');
            process.stdout.write(`  已落盘: ${dryPath}\n`);
        }
        return EXIT.OK;
    }

    // ── 环境预检（正式执行前快速失败；dry-run 已在上方返回，不预检） ──
    {
        const { precheckEnv, reportPrecheckFailures } = await import('./doctor.js');
        const pre = await precheckEnv({ projectRoot: env.projectRoot, dataDir, skillDir: env.skillDir });
        if (!pre.ok) {
            if (jsonMode) out({ ok: false, error: '环境预检未通过', failures: pre.failures });
            else reportPrecheckFailures(pre.failures);
            return EXIT.ERROR;
        }
    }

    // ── 正式执行：复用 orch 链路 ────────────────────────────────────
    // taskId 缺省由 runner 生成（generateTaskId），workflow 可覆盖
    const r = await _runner();
    const ctx = r.createRunContext({
        projectRoot: env.projectRoot,
        dataDir,
        skillDir: env.skillDir,
        verbose,
    });

    // 挂载 AI CLI serve 生命周期（类型由 CLI_TYPE 决定）
    const oc = await _ensureCliServe(ctx, jsonMode, out);
    if (!oc) return EXIT.ERROR;

    // 信号处理：优雅中止（orchControl abort → kill 子进程）
    let interrupted = false;
    const exitHandler = async (sig) => {
        if (interrupted) return;
        interrupted = true;
        try {
            const taskId = taskDef.taskId;
            if (taskId) await r.orchControl(ctx, taskId, 'abort');
        } catch { /* 忽略 */ }
        await oc.stop();
        process.stderr.write(`\n已中止（${sig}）\n`);
        try { await closeAllRunContexts(); } catch { /* 清理失败不改变退出码 */ }
        process.exit(sig === 'SIGINT' ? EXIT.SIGINT : EXIT.SIGTERM);
    };
    process.once('SIGINT', () => exitHandler('SIGINT'));
    process.once('SIGTERM', () => exitHandler('SIGTERM'));

    const started = Date.now();
    try {
        if (!quiet && !jsonMode) {
            u.logProgress(`${u.C.cyan}工作流已提交: ${u.C.reset}${u.C.bold}${wf.name}${u.C.reset}`);
            u.logProgress(`  任务定义步骤数: ${taskDef.steps.length}`);
        }

        // load + start（阻塞执行到终态）
        await r.orchLoad(ctx, taskDef);
        const result = await _startAndRender(ctx, r, taskDef.taskId, { jsonMode, quiet, verbose, out, u, started });

        // ── afterRun 钩子：工作流声明的后置动作（如报告复制）────────
        // 成功/失败均执行（由工作流自身决定是否动作）；抛错只记录，不改变退出码。
        if (typeof wf.afterRun === 'function') {
            try {
                await wf.afterRun({
                    params,
                    taskDef,
                    result,
                    dataDir,
                    cwd: process.cwd(),
                });
            } catch (hookErr) {
                process.stderr.write(`[workflow] afterRun 钩子执行失败（忽略）: ${hookErr.message}\n`);
            }
        }

        if (jsonMode) {
            out({
                ok: result.passed,
                workflow: wf.name,
                taskId: taskDef.taskId,
                status: result.status,
                passed: result.passed,
                resultPaths: result.resultPaths || [],
                error: result.error || null,
                elapsedSec: result.progress ? Math.round(((Date.now() - started) / 1000)) : null,
            });
        }
        return result.passed ? EXIT.OK : EXIT.TASK_FAILED;
    } catch (err) {
        await oc.stop();
        if (jsonMode) out({ ok: false, error: err.message, taskId: taskDef.taskId });
        else process.stderr.write(`\n工作流执行失败: ${err.message}\n`);
        return EXIT.ERROR;
    }
}

/**
 * 编排启动 + 进度渲染（run / start 共用，语义与 orch.js 的 _startAndRender 一致）。
 */
async function _startAndRender(ctx, r, taskId, { jsonMode, quiet, verbose, out, u, started }) {
    const q = await _queries();
    let prev = null;
    let finished = false;

    const poll = (async () => {
        if (jsonMode) return;
        while (!finished) {
            const state = q.readOrchestrationState(ctx.dataDir, taskId);
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

        if (!jsonMode) {
            const lines = u.diffOrchestration(prev, result.progress, { verbose });
            for (const line of lines) u.logProgress(line);

            const elapsedSec = ((Date.now() - started) / 1000).toFixed(0);
            u.logProgress(`\n${result.passed ? u.C.green : u.C.red}工作流完成: ${u.C.reset}${result.status}`);
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

/**
 * 打印工作流参数说明。
 */
function _printWorkflowHelp(wf, paramSpecs) {
    process.stdout.write(`工作流: ${wf.name}\n`);
    if (wf.description) process.stdout.write(`  描述: ${wf.description}\n`);
    process.stdout.write(`用法: 3rdloop run ${wf.name}`);
    if (paramSpecs.length) process.stdout.write(' ' + paramSpecs.map(p => `--${p.flag} <值>` + (p.required ? '(必填)' : '')).join(' '));
    process.stdout.write('\n');
    if (paramSpecs.length) {
        process.stdout.write('\n参数:\n');
        for (const p of paramSpecs) {
            process.stdout.write(`  --${p.flag}` + (p.required ? '  [必填]' : '') + (p.describe ? `  ${p.describe}` : '') + '\n');
        }
    }
}

/** 惰性加载 runner（与 cli.js 同步策略）。 */
function _runner() {
    return import('./runner.js');
}

/** 惰性加载 config（taskId 生成等）。 */
function _config() {
    return import('./config.js');
}

/** 惰性加载 queries。 */
function _queries() {
    return import('./queries.js');
}

/** 确保 AI CLI serve 运行（正式执行需要；dry-run 不需要）。 */
async function _ensureCliServe(ctx, jsonMode, out) {
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