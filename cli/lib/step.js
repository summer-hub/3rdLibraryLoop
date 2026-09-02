/**
 * step.js —— 单步执行（FlexRunner 直连）命令实现
 *
 * 命令：
 *   step run "<任务描述>"   阻塞执行单个步骤（initContext → executeStart 循环）
 *   step status <taskId>   查询单步状态/产物/会话（磁盘直读）
 *   step result <taskId>   读取该步 result.md 内容（磁盘直读）
 *
 * 与 run（大循环 LoopEngine）的区别：
 *   - 不经 Brain 拆解 / Orchestrator 编排 / TestCheck 审核
 *   - 自定 taskId / stepId / maxRetries，产物落 taskDir
 *   - 写精简 loop.json（isSingleExecution:true），使 3rdloop list/progress/result 可见
 */

import path from 'node:path';
import fs from 'node:fs';
import { EXIT } from './exit-codes.js';

/** 单步任务产物前缀（与 FlexRunner.executeStart 命名一致） */
const RESULT_FILE_PREFIX = (stepId, loop) => `stepId${stepId}_loop${loop}_result_`;
/** 步骤执行记录文件名（与 TaskExecutionStore._key 命名一致） */
const STEP_STATE_FILE = (stepId, loop) => `stepid_${stepId}_loop${loop}.json`;

/**
 * 3rdloop step 命令二段分发。
 * @returns {Promise<number>}
 */
export async function cmdStep({ flags, rest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u }) {
    // 基于 flags.rest 分发：全局 flags（如 --data-dir）已被 parseGlobalFlags 消费，
    // flags.rest 是"未知 flag + 值 + 位置参数"混合，取第一个位置参数作为子命令。
    const fRest = flags.rest || [];
    const sub = fRest[0];
    const subRest = fRest.slice(1);
    switch (sub) {
        case 'run':
            return cmdStepRun({ flags, rest: subRest, projectRoot, dataDir, skillDir, jsonMode, quiet, verbose, out, u });
        case 'status':
        case 'result':
            return cmdStepQuery(sub, { flags, rest: subRest, dataDir, jsonMode, quiet, out, u, verbose });
        default:
            process.stderr.write(`缺少或未知的 step 子命令: ${sub || '(空)'}\n`);
            process.stderr.write('用法: 3rdloop step run|status|result ...\n');
            return EXIT.ERROR;
    }
}

/**
 * 阻塞执行单个步骤。
 *
 * 参数：
 *   3rdloop step run "<任务描述>" [--task-id <id>] [--step-id N] [--input-report <path>]
 *                      [--max-retries N] [--loop N] [--task-dir <path>]
 *                      [--specified-skill <SKILL name|目录名>]   <!-- 固定执行指定 SKILL，跳过 SkillSelector 匹配 -->
 */
async function cmdStepRun({ flags, rest, dataDir, skillDir, jsonMode, quiet, verbose, out, u, projectRoot }) {
    const positional = _positionalArgs(rest);
    const description = positional[0];
    if (!description) {
        process.stderr.write('缺少任务描述。用法: 3rdloop step run "生成 xxx 的 demo 场景"\n');
        return EXIT.ERROR;
    }

    const taskId = _stringFlag(flags, 'task-id') || '';
    const stepId = _parseIntFlag(flags, 'step-id', 1);
    if (!taskId) {
        process.stderr.write('缺少 --task-id。用法: 3rdloop step run "<描述>" --task-id <id>\n');
        return EXIT.ERROR;
    }
    if (!Number.isInteger(stepId) || stepId <= 0) {
        process.stderr.write(`--step-id 必须为正整数: ${stepId}\n`);
        return EXIT.ERROR;
    }

    const inputReport = _stringFlag(flags, 'input-report');
    if (inputReport && !fs.existsSync(inputReport)) {
        process.stderr.write(`--input-report 文件不存在: ${inputReport}\n`);
        return EXIT.ERROR;
    }

    const maxRetries = _parseIntFlag(flags, 'max-retries', 3);
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
        process.stderr.write(`--max-retries 必须为非负整数: ${maxRetries}\n`);
        return EXIT.ERROR;
    }
    const loop = _parseIntFlag(flags, 'loop', 0);
    if (!Number.isInteger(loop) || loop < 0) {
        process.stderr.write(`--loop 必须为非负整数: ${loop}\n`);
        return EXIT.ERROR;
    }

    let taskDir = _stringFlag(flags, 'task-dir');
    if (taskDir) taskDir = path.resolve(dataDir, taskDir); // 相对路径基于 dataDir
    else taskDir = path.join(dataDir, 'task', taskId);      // 默认与 run 一致

    const specifiedSkill = _stringFlag(flags, 'specified-skill');

    // 挂载 opencode 生命周期（复用 runner 语义）
    const r = await _runner();
    const ctx = r.createRunContext({ projectRoot, dataDir, skillDir, cliType: 'opencode', verbose });
    const { OpencodeManager } = await import('./opencode.js');
    const oc = new OpencodeManager({ projectRoot });
    const ocHealth = await oc.ensureRunning();
    if (!ocHealth.ok) {
        if (jsonMode) out({ ok: false, error: ocHealth.message, taskId });
        else process.stderr.write(`\n错误: ${ocHealth.message}\n`);
        await oc.stop();
        return EXIT.ERROR;
    }
    if (ocHealth.spawned) process.stderr.write(`${ocHealth.message}\n`);

    // 信号处理：Ctrl+C → abortStandaloneStep（而非 engine.abortLoop）
    let interrupted = false;
    const exitHandler = async (sig) => {
        if (interrupted) return;
        interrupted = true;
        try { await r.abortStandaloneStep(ctx, taskId, stepId); } catch { /* 忽略 */ }
        await oc.stop();
        process.stderr.write(`\n已中止（${sig}）\n`);
        process.exit(sig === 'SIGINT' ? EXIT.SIGINT : EXIT.SIGTERM);
    };
    process.once('SIGINT', () => exitHandler('SIGINT'));
    process.once('SIGTERM', () => exitHandler('SIGTERM'));

    if (!quiet && !jsonMode) {
        u.logProgress(`${u.C.cyan}单步任务已提交: ${u.C.reset}${u.C.bold}${taskId}${u.C.reset}`);
        u.logProgress(`  描述: ${description.slice(0, 120)}`);
        u.logProgress(`  stepId: ${stepId}  loop: ${loop}  maxRetries: ${maxRetries}`);
    }

    try {
        const result = await r.runStandaloneStep(ctx, {
            taskId,
            stepId,
            taskDescription: description,
            skillDirectory: skillDir,
            specifiedSkill,
            taskDir,
            inputReport: inputReport || '',
            maxRetries,
            bigLoopIndex: loop,
        });

        if (jsonMode) {
            out({
                ok: result.success,
                taskId,
                stepId: result.stepId,
                status: result.success ? 'passed' : 'failed',
                success: result.success,
                resultPath: result.resultPath,
                nextStepId: result.nextStepId,
                error: result.error,
                executeStep: result.executeStep,
            });
        } else {
            if (result.success) {
                u.logProgress(`\n${u.C.green}步骤执行成功${u.C.reset}`);
            } else {
                u.logProgress(`\n${u.C.red}步骤执行失败${u.C.reset}`);
            }
            if (result.resultPath) u.logProgress(`  产物: ${result.resultPath}`);
            if (result.nextStepId) u.logProgress(`  下一步: stepId=${result.nextStepId}`);
            if (result.error) u.logProgress(`  错误: ${result.error}`);
        }
        return result.success ? EXIT.OK : EXIT.TASK_FAILED;
    } catch (err) {
        await oc.stop();
        if (jsonMode) out({ ok: false, error: err.message, taskId });
        else process.stderr.write(`\n单步执行失败: ${err.message}\n`);
        return EXIT.ERROR;
    }
}

/**
 * status / result 查询（共用磁盘直读）。
 */
async function cmdStepQuery(sub, { flags, rest: subRest, dataDir, jsonMode, quiet, out, u, verbose }) {
    const positional = _positionalArgs(subRest);
    const taskId = positional[0];
    if (!taskId) {
        process.stderr.write(`缺少 taskId。用法: 3rdloop step ${sub} <taskId> [--step-id N]\n`);
        return EXIT.ERROR;
    }

    const stepId = _parseIntFlag(flags, 'step-id', 1);
    const loop = _parseIntFlag(flags, 'loop', 0);
    const taskPath = path.join(dataDir, 'task', taskId);
    if (!fs.existsSync(taskPath)) {
        if (jsonMode) out({ ok: false, error: '任务不存在', taskId });
        else process.stderr.write(`任务不存在: ${taskId}\n`);
        return EXIT.ERROR;
    }

    const stepState = _readJson(path.join(taskPath, STEP_STATE_FILE(stepId, loop)));

    if (sub === 'result') {
        // 读取最终 result.md（按 executeStep 优先，兜底扫描自小到大最大的 retry 文件）
        const resultFile = _findResultFile(taskPath, stepId, loop);
        if (!resultFile) {
            if (jsonMode) out({ ok: false, error: '该步骤尚无产物文件', taskId, stepId, loop });
            else process.stderr.write(`该步骤尚无产物文件: ${taskId} (stepId=${stepId} loop=${loop})\n`);
            return EXIT.ERROR;
        }
        const content = fs.readFileSync(resultFile, 'utf8');
        if (jsonMode) {
            out({
                ok: true,
                taskId,
                stepId,
                loop,
                resultPath: resultFile,
                content,
                stepState,
            });
        } else if (quiet) {
            process.stdout.write(content + '\n');
        } else {
            u.logProgress(`任务 ${taskId} step${stepId} 结果:`);
            process.stdout.write(content + '\n');
        }
        return EXIT.OK;
    }

    // status：状态 + 产物文件清单 + 步骤记录
    const files = fs.readdirSync(taskPath).filter(f => f.startsWith(RESULT_FILE_PREFIX(stepId, loop)));
    const info = {
        taskId,
        stepId,
        loop,
        resultFiles: files.map(f => ({ name: f, path: path.join(taskPath, f) })),
        stepState,
    };
    if (jsonMode) {
        out({ ok: true, ...info });
    } else {
        process.stdout.write(`任务: ${taskId}\n`);
        process.stdout.write(`步骤: stepId=${stepId} loop=${loop}\n`);
        if (stepState) {
            if (stepState.status) process.stdout.write(`状态: ${stepState.status}\n`);
            if (stepState.matchedSkillDir) process.stdout.write(`匹配技能: ${stepState.matchedSkillDir}\n`);
            if (stepState.sessionId) process.stdout.write(`会话: ${stepState.sessionId}\n`);
            if (stepState.executeStep != null) process.stdout.write(`执行次数: ${stepState.executeStep}\n`);
            if (stepState.endTime) process.stdout.write(`结束时间: ${stepState.endTime}\n`);
        } else {
            process.stdout.write('步骤记录: 无\n');
        }
        if (files.length) {
            process.stdout.write(`产物文件 (${files.length}):\n`);
            for (const f of files) process.stdout.write(`  ${f}\n`);
        } else {
            process.stdout.write('产物文件: 无\n');
        }
    }
    return EXIT.OK;
}

// ─── 磁盘直读工具 ─────────────────────────────────────────────────────────

/** 读取 JSON 文件（不存在/损坏返回 null）。 */
function _readJson(file) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* 损坏 */ }
    return null;
}

/** 查找该步骤最新产物 result.md（优先 stepState.executeStep，兜底 max retry）。 */
function _findResultFile(taskPath, stepId, loop) {
    const prefix = RESULT_FILE_PREFIX(stepId, loop);
    const files = fs.readdirSync(taskPath).filter(f => f.startsWith(prefix) && f.endsWith('.md'));
    if (!files.length) return null;

    // 提取 retry 号排序（避免字典序），取最大
    const parseRetry = (f) => {
        const m = f.slice(prefix.length).match(/^(\d+)\.md$/);
        return m ? parseInt(m[1], 10) : -1;
    };
    files.sort((a, b) => parseRetry(a) - parseRetry(b));
    return path.join(taskPath, files[files.length - 1]);
}

// ─── 小工具 ───────────────────────────────────────────────────────────────

/** 惰性加载 runner（与 cli.js 同步策略）。 */
function _runner() {
    return import('./runner.js');
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

/** step 子命令专用 flags（带值）。用于从参数列表剔除 flag 与值，提取位置参数。 */
const STEP_FLAG_NAMES = ['task-id', 'step-id', 'input-report', 'max-retries', 'loop', 'task-dir', 'specified-skill'];

/**
 * 从参数数组提取位置参数（描述 / taskId）。
 *
 * 说明：parseGlobalFlags 会把未知 flag 与其值原样保留在 flags.rest，
 * 因此 rest 是"flag + 值 + 位置参数"混合，不能直接取 rest[0]。
 * 这里跳过已知 step flags 及其值，只返回真正的位置参数。
 *
 * @param {string[]} args
 * @returns {string[]}
 */
function _positionalArgs(args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const name = arg.slice(2);
            if (STEP_FLAG_NAMES.includes(name)) i++; // 跳过该 flag 的值
            continue;
        }
        out.push(arg);
    }
    return out;
}