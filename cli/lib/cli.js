/**
 * cli.js —— 子命令分发与命令实现
 *
 * 命令：
 *   run [desc]    提交并阻塞到终态（默认行为）
 *   submit [desc] 提交，返回 taskId 后退出
 *   wait <taskId> 等待到终态
 *   progress <taskId>  查询进度（--json）
 *   abort <taskId> 中止
 *   list          列出任务
 *   result <taskId> 读取最终结果
 *   step run|status|result  单步执行（FlexRunner 直连）
 *   doctor        环境自检
 *   version       版本
 *
 * 输出契约：
 *   - 进度/日志 → stderr
 *   - --json 的结构化数据 → stdout（供脚本消费）
 *   - 最终结果 → stdout（非 --json 时为文本）
 *
 * 退出码：见 exit-codes.js。
 */

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import {
    parseGlobalFlags,
    detectProjectRoot,
    getProjectName,
    getUser3libHome,
    loadEnvChain,
    resolveDataDir,
    resolveSkillDir,
    generateTaskId,
    getCliVersion,
} from './config.js';
import { EXIT, TERMINAL_LOOP_STATES } from './exit-codes.js';
import { closeAllRunContexts } from './lifecycle.js';
import { CORE_PACKAGE, describeCoreSource } from './core-paths.js';

// 惰性加载（避免未用到时启动完整引擎）
let _ui, _queries, _runner;
function ui() { return _ui ||= import('./ui.js'); }
function queries() { return _queries ||= import('./queries.js'); }
function runner() { return _runner ||= import('./runner.js'); }

/**
 * CLI 入口（由 bin/3rdloop.mjs 调用）。
 * @param {string[]} argv
 * @returns {Promise<number>} 退出码
 */
export async function runCli(argv) {
    const [cmd, ...rest] = argv;
    const flags = parseGlobalFlags(rest);
    const u = await ui();

    // ── 环境装配（所有命令共用）─────────────────────────────────────
    const projectRoot = detectProjectRoot();
    const user3libHome = getUser3libHome();
    // 抑制 dotenv v17 的日志输出（包含 vendor 内部 dotenv.config 的打印）
    process.env.DOTENV_CONFIG_QUIET = 'true';
    // 关键：加载 .env 链必须在任何核心引擎 import 之前，
    // 使 Server 内部 dotenv.config() 变成静默 no-op（不覆盖已有 env）。
    await loadEnvChain(projectRoot, user3libHome);

    // ── stdout 保护（必须在任何核心引擎 import 之前）──────────────
    // Server 内部 logger.js/StatsService.js 会向 stdout 输出日志或统计信息，
    // 在 CLI 下会污染 --json 结构。这里统一重定向到 stderr，并关闭文件持久化。
    _redirectStdoutLogs();

    const projectName = getProjectName(projectRoot, flags.projectName);
    const dataDir = resolveDataDir({ dataDirFlag: flags.dataDir, user3libHome });
    const skillDir = resolveSkillDir({ skillDirFlag: flags.skillDir, projectRoot });

    // 统计服务写用户数据目录（而非 vendor/Server 相对路径的 cli/db）
    process.env.WEB_STATS_ROOT = path.join(dataDir, 'web');
    // 关闭 Server logger 的文件持久化（避免它按相对路径写 cli/db/log）
    process.env.LOG_FILE_ENABLED = 'false';

    // ── 命令日志落盘（C1）────────────────────────────────────────
    // 用户级统一日志：~/.3lib/logs/3rdloop-<date>.log；仅命令调用（脱敏）落盘。

    // 输出开关
    const jsonMode = flags.json;
    const quiet = flags.quiet;
    const verbose = flags.verbose;

    _logInvocation({ cmd, user3libHome, dataDir, json: jsonMode });

    /**
     * 输出 JSON（仅 stdout）。
     * @param {object} data
     */
    const out = (data) => {
        if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    };

    // ── 命令分发 ────────────────────────────────────────────────────
    switch (cmd) {
        case undefined:
        case '--help':
        case '-h':
        case 'help': {
            printHelp();
            return EXIT.OK;
        }

        case 'version':
            return cmdVersion(jsonMode);

        case 'doctor':
            return cmdDoctor({ projectRoot, skillDir, dataDir, user3libHome, quiet, rest });

        case 'run':
            return cmdRun({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });

        case 'submit':
            return cmdSubmit({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, out, u });

        case 'workflows':
            return cmdWorkflows({ jsonMode, out });

        case 'wait':
            return cmdWait({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, out, u });

        case 'progress':
            return cmdProgress({ flags, rest, projectRoot, dataDir, jsonMode, out, u });

        case 'abort':
            return cmdAbort({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, out, u });

        case 'list':
            return cmdList({ flags, rest, dataDir, jsonMode, out, u });

        case 'result':
            return cmdResult({ flags, rest, dataDir, jsonMode, quiet, out, u });

        case 'step':
            return cmdStep({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });

        case 'orch':
            return cmdOrch({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });

        case 'config':
            return cmdConfig({ flags, rest, projectRoot, user3libHome, jsonMode, out });

        case 'plugin':
            return cmdPlugin({ flags, rest, jsonMode, out });

        case 'mcp':
            return cmdMcpImpl({ rest, user3libHome, jsonMode });

        case 'knowledge':
            return cmdKnowledgeImpl({ rest, user3libHome, dataDir, jsonMode });

        case 'serve':
            return cmdServe({ flags, rest, jsonMode, dataDir, user3libHome });

        case 'update':
            return cmdUpdate({ flags, rest, jsonMode, out });

        default:
            process.stderr.write(`未知命令: ${cmd}\n`);
            if (cmd === 'web') {
                process.stderr.write('提示: "3rdloop web" 已合并到 "3rdloop serve"（Web 前端随 serve 默认启动，扩展管理用 3rdloop serve install-ext/list-ext/remove-ext）\n');
            }
            printHelp();
            return EXIT.ERROR;
    }
}

// ─── 版本 ─────────────────────────────────────────────────────────

function cmdVersion(jsonMode) {
    const v = getCliVersion();
    // 双包发布态：把解析到的核心包版本一并输出（与 CLI 版本不匹配时一眼可见排障线索）
    const core = describeCoreSource();
    if (jsonMode) {
        process.stdout.write(JSON.stringify({
            name: '@ohos-cpf/3rdloop',
            version: v,
            node: process.version,
            core: {
                name: CORE_PACKAGE,
                version: core.version,
                found: core.level !== 0,
                source: core.mode,
                root: core.root,
            },
        }, null, 2) + '\n');
    } else {
        const coreText = core.level === 0
            ? `${CORE_PACKAGE} 未解析`
            : `${CORE_PACKAGE} v${core.version ?? '未知'}（${core.mode}）`;
        process.stdout.write(`@ohos-cpf/3rdloop v${v} (node ${process.version})｜核心: ${coreText}\n`);
    }
    return EXIT.OK;
}

// ─── doctor ───────────────────────────────────────────────────────

async function cmdDoctor({ projectRoot, skillDir, dataDir, user3libHome, quiet, rest = [] }) {
    const { runDoctor } = await import('./doctor.js');
    const fix = !rest.includes('--no-fix');
    const { ok } = await runDoctor({ projectRoot, skillDir, dataDir, user3libHome, quiet, fix });
    return ok ? EXIT.OK : EXIT.ERROR;
}

/**
 * 环境预检 + 失败报告（run/submit 等引擎命令共用）。
 * 通过返回 true；失败打印各项修复提示（--json 时输出结构化结果）并返回 false。
 */
async function _precheckOrReport({ projectRoot, dataDir, skillDir, jsonMode, out }) {
    const { precheckEnv, reportPrecheckFailures } = await import('./doctor.js');
    const pre = await precheckEnv({ projectRoot, dataDir, skillDir });
    if (pre.ok) return true;
    if (jsonMode) out({ ok: false, error: '环境预检未通过', failures: pre.failures });
    else reportPrecheckFailures(pre.failures);
    return false;
}

// ─── workflows（列出已注册工作流） ────────────────────────────────

async function cmdWorkflows({ jsonMode, out }) {
    const { loadWorkflows, listWorkflows } = await import('./workflows.js');
    const { workflows, warnings } = await loadWorkflows();
    for (const w of warnings) process.stderr.write(`${w}\n`);

    const items = listWorkflows(workflows);
    if (jsonMode) {
        out({ total: items.length, workflows: items });
        return EXIT.OK;
    }
    if (items.length === 0) {
        process.stdout.write('（暂无已注册工作流，新增方式见 cli/README.md「工作流机制」章节）\n');
        return EXIT.OK;
    }
    process.stdout.write(`共 ${items.length} 个工作流：\n`);
    for (const it of items) {
        const params = it.params.map(p => '--' + p.flag).join(' ');
        process.stdout.write(`  ${it.name.padEnd(20)} ${it.description || ''}\n`);
        if (params) process.stdout.write(`     用法: 3rdloop run ${it.name} ${params}\n`);
    }
    return EXIT.OK;
}

// ─── config（配置 .env 配置项）────────────────────────────────────

async function cmdConfig({ flags, rest, projectRoot, user3libHome, jsonMode, out }) {
    const { cmdConfigImpl } = await import('./config-cmd.js');
    return cmdConfigImpl({ projectRoot, user3libHome, jsonMode, out, rest });
}

// ─── plugin（插件管理）────────────────────────────────────────────

/**
 * 3rdloop plugin 命令二段分发（转发到 lib/plugin-cmd.js）。
 *
 * 与 update 同样的坑：传 `flags.rest` 而不是原始 rest。全局 flag（`--json` 等）已被
 * parseGlobalFlags 认领，拿原始 argv 会让 `plugin list --json` 的子命令解析把
 * `--json` 当成未知开关而拒绝。
 */
async function cmdPlugin({ flags, rest, jsonMode, out }) {
    const { cmdPluginImpl } = await import('./plugin-cmd.js');
    return cmdPluginImpl({ rest: flags?.rest ?? rest, jsonMode, out });
}

// ─── mcp（MCP Gateway 装配）────────────────────────────────────────

/**
 * 3rdloop mcp 命令二段分发（转发到 lib/mcp.js）。
 */
async function cmdMcpImpl({ rest, user3libHome, jsonMode }) {
    const { cmdMcp } = await import('./mcp.js');
    return cmdMcp({ rest, user3libHome, jsonMode });
}

// ─── knowledge（知识打包回收）──────────────────────────────────────

/**
 * 3rdloop knowledge 命令二段分发（转发到 lib/knowledge.js）。
 */
async function cmdKnowledgeImpl({ rest, user3libHome, dataDir, jsonMode }) {
    const { cmdKnowledge } = await import('./knowledge.js');
    return cmdKnowledge({ rest, user3libHome, dataDir, jsonMode });
}

// ─── update（自更新）─────────────────────────────────────────────

async function cmdUpdate({ flags, rest, jsonMode, out }) {
    const { cmdUpdateImpl } = await import('./update.js');
    // 传 `flags.rest` 而不是原始 rest：全局 flag（--json/--verbose/--quiet/--data-dir 等及其取值）
    // 已被 parseGlobalFlags 消费，不该再让子命令把它们判成"未知参数"。`flags.rest` 恰好是
    // "全局解析没有认领的剩余参数"，正是子命令该看的东西。
    const result = await cmdUpdateImpl({ jsonMode, rest: flags?.rest ?? rest });
    if (jsonMode) {
        // cmdUpdateImpl 内部已输出 --json 结构化结果到 stdout
        return result.ok ? EXIT.OK : EXIT.ERROR;
    }
    return result.ok ? EXIT.OK : EXIT.ERROR;
}

// ─── serve（同时启动 Server HTTP 后端 + Web 前端）─────────────────

async function cmdServe({ flags, rest, jsonMode, dataDir, user3libHome }) {
    const { cmdServe: impl } = await import('./serve.js');
    return impl({ rest: flags.rest, jsonMode, dataDir, user3libHome });
}

// ─── run / submit ──────────────────────────────────────────────────

async function cmdRun({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }) {
    return submitAndRunImpl({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u, waitForCompletion: true });
}

async function cmdSubmit({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, out, u }) {
    return submitAndRunImpl({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose: false, out, u, waitForCompletion: false });
}

/**
 * 提交（并可选等待）任务。
 */
async function submitAndRunImpl({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u, waitForCompletion }) {
    // ── 工作流识别（固定编排）：3rdloop run <workflow> [--flags] ────────
    // 命中已注册工作流 → 转发 cmdWorkflow()；未命中 → 保持原"任务描述"语义
    const { loadWorkflows, resolveWorkflow } = await import('./workflows.js');
    const { workflows, warnings } = await loadWorkflows();
    for (const w of warnings) process.stderr.write(`${w}\n`);
    const matched = resolveWorkflow(workflows, flags.rest);
    if (matched.wf) {
        const { cmdWorkflow } = await import('./workflow.js');
        return cmdWorkflow({
            wf: matched.wf,
            wfWords: flags.rest.slice(matched.matchWords),
            flags,
            env: { projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u },
        });
    }

    const description = rest[0];
    if (!description) {
        process.stderr.write('缺少任务描述。用法: 3rdloop run "生成 xxx 的 demo 场景"\n');
        return EXIT.ERROR;
    }

    // ── 环境预检（引擎执行前快速失败：凭据/目录类问题直接退出码 1，
    //    避免跑到一半才失败、被误报为任务失败退出码 2）──────────────────
    const preOk = await _precheckOrReport({ projectRoot, dataDir, skillDir, jsonMode, out });
    if (!preOk) return EXIT.ERROR;

    // skill-dir 可能来自全局 flags 已在外部解析
    const r = await runner();
    const taskId = generateTaskId();
    const ctx = r.createRunContext({
        projectRoot,
        dataDir,
        skillDir,
        verbose,
    });

    // 挂载 AI CLI serve 生命周期（类型由 CLI_TYPE 决定：opencode | deveco-code）
    const { CliServeManager } = await import('./opencode.js');
    const oc = new CliServeManager({ projectRoot, cliType: ctx.cliType });
    const ocHealth = await oc.ensureRunning();
    if (!ocHealth.ok) {
        if (jsonMode) {
            process.stdout.write(JSON.stringify({ ok: false, error: ocHealth.message, taskId }, null, 2) + '\n');
        }
        process.stderr.write(`\n错误: ${ocHealth.message}\n`);
        process.stderr.write(`请先启动 ${oc.cliType} serve（项目上一级目录: ${oc.bin} serve）后重试。\n`);
        await oc.stop();
        return EXIT.ERROR;
    }
    if (ocHealth.spawned) {
        process.stderr.write(`${ocHealth.message}\n`);
    }

    // 信号处理：优雅退出（先 abortLoop 再杀子进程）
    let interrupted = false;
    const exitHandler = async (sig) => {
        if (interrupted) return;
        interrupted = true;
        try {
            await r.abortTask(ctx, taskId);
        } catch { /* 忽略 */ }
        await oc.stop();
        process.stderr.write(`\n已中止（${sig}）\n`);
        try { await closeAllRunContexts(); } catch { /* 清理失败不改变退出码 */ }
        process.exit(sig === 'SIGINT' ? EXIT.SIGINT : EXIT.SIGTERM);
    };
    process.once('SIGINT', () => exitHandler('SIGINT'));
    process.once('SIGTERM', () => exitHandler('SIGTERM'));

    try {
        // 清理旧实例（中断恢复语义 v1：归档旧 loop.json）
        await r.archiveTaskIfExists(ctx, taskId);

        const startTs = Date.now();

        if (waitForCompletion) {
            // 阻塞式运行 + 进度渲染
            if (!quiet && !jsonMode) {
                u.logProgress(`${u.C.cyan}任务已提交: ${u.C.reset}${u.C.bold}${taskId}${u.C.reset}`);
                u.logProgress(`  描述: ${description.slice(0, 120)}`);
            }

            const result = await r.submitAndRun({
                ctx,
                taskDescription: description,
                taskId,
                maxLoops: _parseIntFlag(flags, 'max-loops', 3),
                acceptanceCriteria: _stringFlag(flags, 'acceptance-criteria') || undefined,
            });

            const elapsedSec = ((Date.now() - startTs) / 1000).toFixed(0);

            // 输出最终结果
            const finalState = r.readTaskProgress ? await r.readTaskProgress(ctx, taskId) : null;
            if (jsonMode) {
                process.stdout.write(JSON.stringify({
                    ok: result.passed,
                    taskId,
                    status: result.status,
                    passed: result.passed,
                    totalRounds: result.totalRounds,
                    finalCheckResult: result.finalCheckResult || null,
                    elapsedSec: Number(elapsedSec),
                }, null, 2) + '\n');
            } else {
                u.logProgress(`\n${result.passed ? u.C.green : u.C.red}任务完成: ${u.C.reset}${result.status}`);
                u.logProgress(`  耗时: ${elapsedSec}s 轮次: ${result.totalRounds}`);
                if (result.error) u.logProgress(`  错误: ${result.error}`);
                if (result.finalCheckResult?.summary) {
                    u.logProgress(`  审核摘要: ${result.finalCheckResult.summary}`);
                }
            }
            return result.passed ? EXIT.OK : EXIT.TASK_FAILED;
        } else {
            // submit：仅返回 taskId（不等待），进程内任务在后台跑（不可跨进程存活——文档已说明 v1 限制）
            const engine = ctx.createLoopEngine();
            // 后台启动 loop（不 await）
            engine.startLoop({
                taskDescription: description,
                taskId,
                maxLoops: _parseIntFlag(flags, 'max-loops', 3),
                acceptanceCriteria: _stringFlag(flags, 'acceptance-criteria') || undefined,
            }).then(() => {
                process.exitCode = EXIT.OK;
            }).catch(err => {
                process.stderr.write(`\n任务异常: ${err.message}\n`);
                process.exitCode = EXIT.TASK_FAILED;
            }).finally(async () => {
                await oc.stop();
            });

            // 同步返回 taskId 后进程可能退出——v1 语义是 submit 后需 run/wait 续跑
            if (jsonMode) {
                process.stdout.write(JSON.stringify({ ok: true, taskId, status: 'submitted' }, null, 2) + '\n');
            } else {
                process.stdout.write(`${taskId}\n`);
            }
            // 关键：CLI 进程不能退出，否则任务被中断。等待 completion。
            process.stderr.write(`\n提示: 任务 ${taskId} 当前进程内运行。若要跨进程运行，请保持此进程存活，或改用 3rdloop run（提交+等待）。\n`);
            // 保持进程存活直到任务完成
            await new Promise(() => {});
            return EXIT.OK;
        }
    } catch (err) {
        await oc.stop();
        if (jsonMode) {
            process.stdout.write(JSON.stringify({ ok: false, error: err.message, taskId }, null, 2) + '\n');
        } else {
            process.stderr.write(`\n任务执行失败: ${err.message}\n`);
        }
        return EXIT.TASK_FAILED;
    }
}

// ─── wait ─────────────────────────────────────────────────────────

async function cmdWait({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, out, u }) {
    const taskId = rest[0];
    if (!taskId) {
        process.stderr.write('缺少 taskId。用法: 3rdloop wait <taskId>\n');
        return EXIT.ERROR;
    }

    const timeoutMs = await _durationFlagAsync(flags, 'timeout');

    // 磁盘查询任务是否存在
    const q = await queries();
    const initState = q.readTaskState(dataDir, taskId);
    if (!initState) {
        if (jsonMode) out({ ok: false, error: '任务不存在', taskId });
        else process.stderr.write(`任务不存在: ${taskId}\n`);
        return EXIT.ERROR;
    }

    // 已终态立即返回
    if (TERMINAL_LOOP_STATES.includes(initState.status)) {
        if (jsonMode) out({ ok: initState.status === 'passed', taskId, status: initState.status, passed: initState.status === 'passed' });
        else u.logProgress(`任务已处于终态: ${initState.status}`);
        return initState.status === 'passed' ? EXIT.OK : EXIT.TASK_FAILED;
    }

    // 需要引擎实例来等待（wait 时任务可能在另一个进程/磁盘中，需要恢复续跑）
    const r = await runner();
    const ctx = r.createRunContext({ projectRoot, dataDir, skillDir, verbose: false });
    const started = Date.now();

    process.stderr.write(`等待任务 ${taskId} 到终态...\n`);

    while (true) {
        const state = q.readTaskState(dataDir, taskId);

        // 超时判定
        if (timeoutMs && Date.now() - started >= timeoutMs) {
            if (jsonMode) out({ ok: false, timeout: true, taskId, message: '等待超时，任务可能仍在运行' });
            else process.stderr.write(`等待超时（${Math.round(timeoutMs / 1000)}s），任务可能仍在运行，可用 "3rdloop wait ${taskId} --timeout 0" 继续等待\n`);
            return EXIT.TIMEOUT;
        }

        if (state && TERMINAL_LOOP_STATES.includes(state.status)) {
            if (jsonMode) {
                out({ ok: state.status === 'passed', taskId, status: state.status, passed: state.status === 'passed' });
            } else {
                u.logProgress(`\n任务结束: ${state.status}`);
                const finalSummary = u.finalSummary(state);
                process.stdout.write(finalSummary + '\n');
            }
            return state.status === 'passed' ? EXIT.OK : EXIT.TASK_FAILED;
        }

        // 等待后重查
        await new Promise(res => setTimeout(res, 3000));
    }
}

// ─── progress ─────────────────────────────────────────────────────

async function cmdProgress({ flags, rest, projectRoot, dataDir, jsonMode, out, u }) {
    const taskId = rest[0];
    const watch = rest.includes('--watch') || rest.includes('-w');
    if (!taskId) {
        process.stderr.write('缺少 taskId。用法: 3rdloop progress <taskId> [--watch]\n');
        return EXIT.ERROR;
    }

    const q = await queries();
    let prev = null;

    const render = (state, last) => {
        if (jsonMode) {
            out(state);
            return;
        }
        const changes = u.diffLoop(prev, state);
        for (const line of changes) u.logProgress(line);
    };

    if (watch) {
        // 持续轮询直到终态
        const until = await _durationFlagAsync(flags, 'until') || 0;
        const started = Date.now();
        while (true) {
            const state = q.readTaskState(dataDir, taskId);
            if (state) {
                render(state, prev);
                prev = state;
                if (TERMINAL_LOOP_STATES.includes(state.status)) {
                    u.logProgress(`\n任务终态: ${state.status}`);
                    break;
                }
            } else {
                u.logProgress(`(任务 ${taskId} 尚无快照)`);
            }
            if (until && Date.now() - started >= until) break;
            await new Promise(res => setTimeout(res, 3000));
        }
        return EXIT.OK;
    }

    // 单次查询
    const state = q.readTaskState(dataDir, taskId);
    if (!state) {
        if (jsonMode) out({ ok: false, error: '任务不存在', taskId });
        else process.stderr.write(`任务不存在: ${taskId}\n`);
        return EXIT.ERROR;
    }
    render(state, null);
    return EXIT.OK;
}

// ─── abort ────────────────────────────────────────────────────────

async function cmdAbort({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, out, u }) {
    const taskId = rest[0];
    if (!taskId) {
        process.stderr.write('缺少 taskId。用法: 3rdloop abort <taskId>\n');
        return EXIT.ERROR;
    }

    const r = await runner();
    const ctx = r.createRunContext({ projectRoot, dataDir, skillDir, verbose: false });
    const ok = await r.abortTask(ctx, taskId);
    if (jsonMode) {
        out({ ok, taskId });
    } else {
        if (ok) process.stderr.write(`已请求中止任务 ${taskId}\n`);
        else process.stderr.write(`任务 ${taskId} 未找到或已结束，无需中止\n`);
    }
    return ok ? EXIT.OK : EXIT.ERROR;
}

// ─── list ─────────────────────────────────────────────────────────

async function cmdList({ flags, rest, dataDir, jsonMode, out, u }) {
    const q = await queries();
    const status = _stringFlag(flags, 'status');
    const limit = _parseIntFlag(flags, 'limit', 0) || 0;
    const olderThan = _stringFlag(flags, 'older-than');

    const tasks = q.listTasks(dataDir, { status, limit: limit || undefined, olderThan: olderThan || undefined });

    if (jsonMode) {
        out({ total: tasks.length, tasks });
        return EXIT.OK;
    }

    if (tasks.length === 0) {
        process.stdout.write('（暂无任务）\n');
        return EXIT.OK;
    }

    // 文本表格
    process.stdout.write(`共 ${tasks.length} 个任务：\n`);
    for (const t of tasks) {
        const icon = t.passed ? u.C.green + '✓' + u.C.reset
            : (t.status === 'running' || ['planning', 'executing', 'checking'].includes(t.status)) ? u.C.cyan + '▶' + u.C.reset
            : u.C.red + '✗' + u.C.reset;
        process.stdout.write(`  ${icon} ${t.taskId.padEnd(40)} ${(t.status || '').padEnd(10)} ${t.startTime || ''}\n`);
    }
    return EXIT.OK;
}

// ─── result ───────────────────────────────────────────────────────

async function cmdResult({ flags, rest, dataDir, jsonMode, quiet, out, u }) {
    const taskId = rest[0];
    if (!taskId) {
        process.stderr.write('缺少 taskId。用法: 3rdloop result <taskId>\n');
        return EXIT.ERROR;
    }

    const q = await queries();
    const raw = rest.includes('--raw');
    const result = q.readTaskResult(dataDir, taskId, { raw });

    if (!result) {
        if (jsonMode) out({ ok: false, error: '任务不存在', taskId });
        else process.stderr.write(`任务不存在: ${taskId}\n`);
        return EXIT.ERROR;
    }

    if (jsonMode) {
        out(result);
        return EXIT.OK;
    }

    // 文本输出
    const lines = [];
    lines.push(`任务: ${result.taskId}`);
    lines.push(`状态: ${result.status}`);
    if (result.error) lines.push(`错误: ${result.error}`);
    if (result.rounds?.length) {
        lines.push(`轮次: ${result.rounds.length}`);
        for (const r of result.rounds) {
            const check = r.checkPassed != null ? (r.checkPassed ? '✓ 通过' : '✗ 未过') : '-';
            lines.push(`  第 ${r.loop + 1} 轮: 编排=${r.orchestratorStatus || '-'} 审核=${check}`);
        }
    }
    if (result.taskDir) lines.push(`产物目录: ${result.taskDir}`);
    process.stdout.write(lines.join('\n') + '\n');
    return EXIT.OK;
}

// ─── step（单步执行）─────────────────────────────────────────────

/**
 * 3rdloop step 命令二段分发（转发到 lib/step.js）。
 */
async function cmdStep({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }) {
    const { cmdStep: impl } = await import('./step.js');
    return impl({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });
}

// ─── orch（编排）─────────────────────────────────────────────────

/**
 * 3rdloop orch 命令二段分发（转发到 lib/orch.js）。
 */
async function cmdOrch({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }) {
    const { cmdOrch: impl } = await import('./orch.js');
    return impl({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });
}

// ─── 帮助 ─────────────────────────────────────────────────────────

function printHelp() {
    process.stdout.write(`
@ohos-cpf/3rdloop —— 3rdLibraryLoop 三方库自动化检视 CLI

用法:
  3rdloop run <任务描述>                提交并阻塞到终态
  3rdloop submit <任务描述>             提交，返回 taskId 后后台运行
  3rdloop wait <taskId> [--timeout 30m] 等待任务到终态
  3rdloop progress <taskId> [--watch]   查询进度（--watch 持续轮询到终态）
  3rdloop abort <taskId>                中止任务
  3rdloop list [--status <st>] [--limit N] [--older-than 7d]   列出任务
  3rdloop result <taskId> [--raw]       读取最终结果
  3rdloop step run "<描述>" [--task-id <id>] [--step-id N] [--input-report <p>]
         [--max-retries N] [--loop N] [--task-dir <p>]
     单步执行（FlexRunner 直连，不经拆解/编排/审核）
  3rdloop step status <taskId> [--step-id N]  查询单步状态/产物
  3rdloop step result <taskId> [--step-id N]  读取该步 result.md
  3rdloop orch run <task-def.json>            加载任务定义 + 启动编排，阻塞到终态
  3rdloop orch load <task-def.json>           仅加载任务定义（落盘 orchestration.json）
  3rdloop orch start <taskId>                 从磁盘恢复 LOADED 状态并启动编排，阻塞到终态
  3rdloop orch progress <taskId> [--loop N]   查询编排进度
  3rdloop orch abort|pause|resume <taskId>    终止/暂停/恢复编排
  3rdloop orch tasks                          列出编排任务
  3rdloop workflows                     列出已注册的固定编排工作流
  3rdloop run <工作流名> [--flag <值> ...]     以固定编排执行工作流（阻塞到终态）
  3rdloop config list|get|set|unset ...  配置 .env 配置项（默认读写 ~/.3lib/.env）
  3rdloop plugin list|info|enable|disable|check|path|add|remove   插件管理（详见下方「plugin 子命令」）
           开关写入用户级 overlay（~/.3lib/3rdloop/profiles/），重启 3rdloop serve 后生效
  3rdloop mcp install [--cli opencode|deveco|all]  装配 MCP Gateway（注册到 AI CLI +
          种子复制知识库数据/BadCase 到 ~/.3lib/3rdloop/，npm 安装态必需）
  3rdloop mcp uninstall|status            移除注册 / 查看装配状态
  3rdloop knowledge export [--note <text>]
          打包本地知识沉淀 JSON（db/Knowledge）为 zip 发给维护者回收
  3rdloop knowledge import <zip> [--dry-run]  维护者解包收到的知识包到收件箱
  3rdloop serve [--port N] [--web-port N]  启动 Server 后端 + Web 前端（同时启动）
         [--web-root <dir>] [--ext-root <dir>] [--ext <name,...>] [--no-ext] [--open]
  3rdloop serve install-ext <dir>                安装扩展（tag/issue/prcheck 等二级功能）
  3rdloop serve list-ext | remove-ext <name>     扩展管理
  3rdloop update [--check] [--yes] [--registry <url>]  自更新到 npm 最新版
  3rdloop doctor [--no-fix]             环境自检（默认自动装配 MCP Gateway；--no-fix 仅诊断）
  3rdloop version                       版本信息

工作流机制:
  固定编排 = 预置 taskDef 定义，支持 CLI flags 参数化后复用 orch 链路执行。
  - 已注册工作流用 "3rdloop workflows" 查看；参数说明用 "3rdloop run <工作流名> --help"
  - 新增工作流：在 cli/workflows/ 下新增一个 .js/.mjs 文件（默认导出
    { name, description, params, buildTaskDef }），自动注册，零改动分发代码
  - 工作机制详见 cli/README.md「工作流机制」章节

工作流专用选项:
  --print-taskdef  仅构造并打印/落盘 taskDef（dry-run，不触碰引擎），适合调试新工作流

config 子命令:
  3rdloop config list                 列出全部配置项及当前生效值
  3rdloop config get <KEY>            查看某项当前生效值
  3rdloop config set <KEY> <VALUE>    设置某项（文件: ~/.3lib/.env，密钥不回显）
  3rdloop config unset <KEY>          删除用户级 .env 中的某项（恢复默认）
  优先级: 系统环境变量 > ~/.3lib/.env > 默认值

plugin 子命令（插件管理，写用户级 overlay，不改包内 profiles/）:
  3rdloop plugin list [--json]        列出全部条目（含 profile 提到但未安装的）
  3rdloop plugin info <name>          单个插件全字段 + 禁用后果
  3rdloop plugin enable <name>        启用插件
  3rdloop plugin disable <name> [--force]  禁用插件（被启用中的插件依赖时默认拒绝）
  3rdloop plugin check                静态一致性检查（required 被禁/依赖被禁/接缝冲突）
  3rdloop plugin path                 overlay 路径与当前 profile 名
  3rdloop plugin add <dir>            安装插件目录到 ~/.3lib/plugins/<name>/
  3rdloop plugin remove <name>        卸载用户级插件（内置插件拒绝）
  开关写入 ~/.3lib/3rdloop/profiles/<profile>.json，重启 3rdloop serve 后生效

update 专用选项:
  --check          仅检查是否有新版本，不执行更新
  --yes, -y        跳过交互确认直接更新
  --registry <url> 覆盖 npm registry（默认尊重用户 npm 镜像配置）
  注意: 数据目录 ~/.3lib/3rdloop/db 与 SKILL 配置不受更新影响

全局选项:
  --json          结构化输出到 stdout（进度/日志走 stderr）
  -v, --verbose   详细模式
  --quiet         仅输出最终结果
  --data-dir <p>  数据目录覆盖（默认 ~/.3lib/3rdloop/db）
  --project <n>   项目名覆盖（默认 git 仓库根名）
  --skill-dir <p>  SKILL 目录覆盖
  -h, --help      帮助

step run 专用选项:
  --task-id <id>   任务 ID（必填，step 不自动生成）
  --step-id <N>    步骤编号（默认 1）
  --input-report <p>  输入报告/上下文文件路径
  --max-retries <N>  最多重试次数（默认 3）
  --loop <N>         大循环轮次编号（默认 0）
  --task-dir <p>     产物目录（默认 <data-dir>/task/<taskId>）
  --specified-skill <SKILL name|目录名>  固定执行指定 SKILL（跳过 SkillSelector 匹配）

orch 专有说明:
  task-def.json 格式（与 Orchestrator.loadTask 对齐）:
    { "taskId": "task_xxx", "taskDir": "", "skillDirectory": "",
      "loopCount": 0,
      "steps": [ { "stepId": 1, "taskDescription": "...",
                   "dependId": 0, "nextStepId": 2, "failStepId": 0, "maxRetries": 3,
                   "specifiedSkill": "arkts-library-xts-code" } ] }
  steps[].specifiedSkill 可选：固定执行指定 SKILL（name 或目录名，跳过 SkillSelector 匹配）
  orch progress 可选 --loop <N> 读取历史轮次 orchestration_loop{N}.json

退出码:
  0    通过/成功
  1    错误（参数/环境/任务不存在）
  2    任务执行失败
  3    wait 超时
  130  Ctrl+C
  143  SIGTERM
`);
}

// ─── 小工具 ───────────────────────────────────────────────────────

/**
 * 命令调用日志落盘（C1）。
 * 用户级统一日志：~/.3lib/logs/3rdloop-<date>.log。
 * 不做敏感信息记录（仅命令名，不含描述/凭据）。
 */
function _logInvocation({ cmd, user3libHome, dataDir, json }) {
    try {
        const logsDir = path.join(user3libHome, 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const date = new Date().toISOString().slice(0, 10);
        const line = `[${new Date().toISOString()}] cmd=${cmd || 'help'} dataDir=${dataDir} json=${!!json}\n`;
        fs.appendFileSync(path.join(logsDir, `3rdloop-${date}.log`), line);
    } catch { /* 日志失败不影响主流程 */ }
}

/**
 * 将 Server 内部可能打到 stdout 的 console 输出重定向到 stderr。
 *
 * Server 的 logger.js（info 用 console.log）与 StatsService.js（console.info）
 * 在 CLI 下需要保持 stdout 纯净（仅 --json 结构化数据）；
 * debug 噪音级别日志在 CLI 下也不需要，直接丢弃。
 */
function _redirectStdoutLogs() {
    const safeStringify = (a) => {
        try {
            return JSON.stringify(a);
        } catch {
            return String(a);
        }
    };
    console.log = (...args) => {
        process.stderr.write(args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ') + '\n');
    };
    console.info = (...args) => {
        process.stderr.write(args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ') + '\n');
    };
    console.debug = () => {}; // 丢弃 debug（噪音）
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

function _durationFlag(flags, name) {
    const idx = flags.rest.indexOf(`--${name}`);
    const raw = idx !== -1 ? flags.rest[idx + 1] : undefined;
    if (!raw) return 0;
    // 从 config 中获取 parseDurationMs（避免顶层 import 循环）
    return 0;
}

/**
 * 解析 --timeout 等时长标志。
 * @param {object} flags - parseGlobalFlags 返回
 * @param {string} name
 * @returns {number} 毫秒（0 = 无限制）
 */
async function _durationFlagAsync(flags, name) {
    const idx = flags.rest.indexOf(`--${name}`);
    const raw = idx !== -1 ? flags.rest[idx + 1] : undefined;
    if (!raw) return 0;
    const cfg = await import('./config.js');
    return cfg.parseDurationMs(raw);
}

export default runCli;