/**
 * doctor.js —— 环境自检（3rdloop doctor）+ 引擎前置预检（precheckEnv）
 *
 * 检查维度（doctor 与预检共用 collectChecks）：
 *   1. Node.js 版本（>=22）
 *   2. CLI_TYPE 配置有效性（无效值视为配置错误）
 *   3. AI CLI 可执行文件（按 CLI_TYPE 检测 opencode / deveco）
 *   4. LLM 凭据（生效环境 DASHSCOPE_API_KEY；LLM_BASE_URL/LLM_MODEL 引擎有内置默认值，不强制）
 *   5. Skill 目录可访问
 *   6. 数据目录可写
 *   7. serve 服务端口连通性（非致命：未运行时 run/orch/step/workflow 会自动拉起；
 *      端口有响应但异常视为失败）
 *
 * 每项检查含 fix 字段：不通过时的修复提示（含 3rdloop config set 命令），
 * doctor 与预检失败时均打印，用户照抄即可配置。
 *
 * precheckEnv：run/submit/step run/orch run|start/工作流正式执行前调用，
 * 任一项不通过直接退出码 1（避免跑到一半才因环境问题失败、误报为任务失败退出码 2）。
 *
 * 退出码：doctor 全部通过 = 0；存在致命问题 = 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { C } from './ui.js';
import { resolveCliType } from './config.js';
import { resolveCliServeConfig } from './opencode.js';

/**
 * 检查命令是否在 PATH 中。
 */
function which(cmd) {
    try {
        const tool = process.platform === 'win32' ? 'where' : 'which';
        const out = execSync(`${tool} ${cmd}`, { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 });
        return out.trim().split('\n')[0] || null;
    } catch {
        return null;
    }
}

/**
 * 探测 serve 服务 HTTP /health（2s 超时）。
 * @param {string} baseUrl
 * @returns {Promise<{ state: 'running'|'down'|'error', detail: string }>}
 *   running = 服务正常；down = 未运行（执行命令时会自动拉起，非致命）；
 *   error = 端口有响应但异常（可能是残留的坏进程，视为致命）
 */
async function probeServe(baseUrl) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok
            ? { state: 'running', detail: `运行中 (${baseUrl})` }
            : { state: 'error', detail: `响应异常 HTTP ${res.status} (${baseUrl})，可能是残留的异常进程` };
    } catch {
        return { state: 'down', detail: `未运行 (${baseUrl})——执行 run/orch/step/workflow 时会自动拉起` };
    }
}

/**
 * 收集全部检查项（doctor 与 precheckEnv 共用）。
 * 每项：{ name, passed, detail, fix }——fix 为不通过时的修复提示。
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.skillDir
 * @param {string} opts.dataDir
 * @returns {Promise<Array<{name: string, passed: boolean, detail?: string, fix?: string}>>}
 */
async function collectChecks({ projectRoot, skillDir, dataDir }) {
    const checks = [];

    // 1. Node.js 版本
    const nodeMajor = Number(process.version.match(/^v(\d+)/)?.[1] || 0);
    checks.push({
        name: 'Node.js >= 22',
        passed: nodeMajor >= 22,
        detail: process.version,
        fix: '请升级 Node.js 至 v22+ 后重试（https://nodejs.org）',
    });

    // 2. CLI_TYPE 配置有效性（解析回退发生在 resolveCliType，这里负责显式报告）
    const rawCliType = String(process.env.CLI_TYPE ?? '').trim();
    const cliType = resolveCliType();
    const cliCfg = resolveCliServeConfig(cliType);
    if (!rawCliType) {
        checks.push({
            name: 'CLI_TYPE 配置',
            passed: true,
            detail: '未设置（默认 deveco-code；如需 opencode 可 3rdloop config set CLI_TYPE opencode）',
        });
    } else if (rawCliType === cliType) {
        checks.push({ name: 'CLI_TYPE 配置', passed: true, detail: rawCliType });
    } else {
        checks.push({
            name: 'CLI_TYPE 配置',
            passed: false,
            detail: `"${rawCliType}" 无效，可选值: opencode | deveco-code（当前回退 ${cliType}）`,
            fix: '3rdloop config set CLI_TYPE opencode（可选: opencode | deveco-code），或 3rdloop config unset CLI_TYPE 恢复默认',
        });
    }

    // 3. AI CLI 可执行文件（按 CLI_TYPE 检测对应二进制）
    const cliBin = which(cliCfg.bin);
    const installHint = cliType === 'deveco-code'
        ? '未找到，请 npm i -g @deveco/deveco-code（首次需 deveco auth login）'
        : '未找到，请 npm i -g opencode-ai';
    checks.push({
        name: `${cliType} CLI`,
        passed: !!cliBin,
        detail: cliBin || installHint,
        fix: cliType === 'deveco-code'
            ? 'npm i -g @deveco/deveco-code（安装后首次使用需 deveco auth login）'
            : 'npm i -g opencode-ai',
    });

    // 4. LLM 凭据（生效环境检测：loadEnvChain 已注入 系统环境变量 > ~/.3lib/.env > 项目 Server/.env，
    //    任一层配置即生效。仅强制 DASHSCOPE_API_KEY——LLM_BASE_URL/LLM_MODEL 引擎有内置默认值）
    const apiKey = String(process.env.DASHSCOPE_API_KEY ?? '').trim();
    checks.push({
        name: 'LLM 凭据（DASHSCOPE_API_KEY）',
        passed: !!apiKey,
        detail: apiKey
            ? '已配置（系统环境变量 / ~/.3lib/.env / 项目 Server/.env 任一层）'
            : '未配置（系统环境变量 / ~/.3lib/.env / 项目 Server/.env 均未设置，LLM 调用将失败）',
        fix: '3rdloop config set DASHSCOPE_API_KEY <sk-xxxxxxxx>（从 https://bailian.console.aliyun.com/ 获取）',
    });

    // 5. Skill 目录可访问
    const skillOk = skillDir && fs.existsSync(skillDir);
    checks.push({
        name: 'SKILL 目录',
        passed: !!skillOk,
        detail: skillOk ? skillDir : `SKILL 目录不存在: ${skillDir}`,
        fix: '3rdloop config set 3LIB_SKILL_DIR <SKILL 目录>；发布包缺 SKILL 请重装: npm i -g @ohos-cpf/3rdloop',
    });

    // 6. 数据目录可写
    let dataOk = false;
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        dataOk = true;
    } catch { /* 不可写 */ }
    checks.push({
        name: '数据目录',
        passed: dataOk,
        detail: dataOk ? dataDir : `不可写: ${dataDir}`,
        fix: '3rdloop config set 3LIB_DATA_DIR <可写目录>，或运行时加 --data-dir <p>',
    });

    // 7. serve 服务端口连通性（未运行不算失败：执行命令时会自动拉起；
    //    端口有响应但异常则视为失败，提示清理残留进程）
    const serve = await probeServe(`http://${cliCfg.host}:${cliCfg.port}`);
    checks.push({
        name: `${cliType} serve 服务`,
        passed: serve.state !== 'error',
        detail: serve.detail,
        fix: `端口 ${cliCfg.port} 被异常进程占用，请清理后重试（lsof -i :${cliCfg.port} 定位 / 任务管理器结束进程）`,
    });

    return checks;
}

/**
 * 执行环境自检（3rdloop doctor 命令实现）。
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.skillDir
 * @param {string} opts.dataDir
 * @param {boolean} [opts.quiet] - 静默模式（不打印表格，仅返回结果）
 * @returns {Promise<{ ok: boolean, checks: Array<{name: string, passed: boolean, detail?: string, fix?: string}> }>}
 */
export async function runDoctor(opts = {}) {
    const checks = await collectChecks(opts);

    // 汇总
    const ok = checks.every(c => c.passed);

    // 打印（失败项附加修复提示）
    if (!opts.quiet) {
        process.stderr.write(`\n${C.bold}3rdloop doctor 环境自检${C.reset}${C.gray}（AI CLI: ${resolveCliType()}）${C.reset}\n`);
        for (const c of checks) {
            const icon = c.passed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
            process.stderr.write(`  ${icon} ${c.name}`);
            if (c.detail) process.stderr.write(`  ${C.gray}${c.detail}${C.reset}`);
            process.stderr.write('\n');
            if (!c.passed && c.fix) {
                process.stderr.write(`      ${C.cyan}修复: ${c.fix}${C.reset}\n`);
            }
        }
    }

    return { ok, checks };
}

/**
 * 引擎前置预检（run/submit/step run/orch run|start/工作流正式执行前调用）。
 *
 * 与 doctor 同一检查集，语义差异：
 *   - serve 未运行不算失败（执行命令时会自动拉起；端口异常仍算失败）
 *   - 轻量：仅文件/PATH/端口探测，不拉起任何进程、不触引擎
 *
 * @param {object} opts - { projectRoot, skillDir, dataDir }（与 runDoctor 相同）
 * @returns {Promise<{ ok: boolean, failures: Array<{name: string, detail?: string, fix?: string}> }>}
 */
export async function precheckEnv(opts = {}) {
    const checks = await collectChecks(opts);
    const failures = checks
        .filter(c => !c.passed)
        .map(({ name, detail, fix }) => ({ name, detail, fix }));
    return { ok: failures.length === 0, failures };
}

/**
 * 预检失败信息打印（stderr，供 cli/workflow/step/orch 共用；--json 模式下调用方自行 out()）。
 * @param {Array<{name: string, detail?: string, fix?: string}>} failures
 */
export function reportPrecheckFailures(failures) {
    process.stderr.write(`\n环境预检未通过（${failures.length} 项），已阻止任务执行:\n`);
    for (const f of failures) {
        process.stderr.write(`  ${C.red}✗${C.reset} ${f.name}${f.detail ? `  ${C.gray}${f.detail}${C.reset}` : ''}\n`);
        if (f.fix) {
            process.stderr.write(`      ${C.cyan}修复: ${f.fix}${C.reset}\n`);
        }
    }
    process.stderr.write('完整环境自检: 3rdloop doctor\n');
}
