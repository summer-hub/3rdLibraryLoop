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
 *   8. MCP Gateway 装配（警告级）
 *   9. 核心引擎：解析到的核心树来源与包版本（双包发布态 = @ohos-cpf/3rdloop_core）
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
import { CORE_PACKAGE, describeCoreSource } from './core-paths.js';

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
 * 每项：{ name, passed, detail, fix, warning? }——fix 为不通过时的修复提示；
 * warning: true 的项仅 doctor 展示提示，不参与 precheckEnv 阻断（MCP 等增强能力缺失不阻断核心引擎）。
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.skillDir
 * @param {string} opts.dataDir
 * @param {string} [opts.user3libHome] - ~/.3lib（MCP 装配检查用；缺省按 ~ 推导）
 * @returns {Promise<Array<{name: string, passed: boolean, detail?: string, fix?: string, warning?: boolean}>>}
 */
async function collectChecks({ projectRoot, skillDir, dataDir, user3libHome = '' }) {
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

    // 8. MCP Gateway 装配（警告级：不阻断核心引擎，仅影响 kb 工具/脚本工具/知识库检索）
    //    AI CLI 全局配置中 mcp-gateway 已注册且指向存在的入口脚本 → 通过
    const mcpCheck = await checkMcpRegistration(cliType);
    checks.push({ warning: true, ...mcpCheck });

    // 9. 核心引擎（双包发布态来自 @ohos-cpf/3rdloop_core，四级解析见 core-paths.js）
    //    这一项同时把**解析到的核心包版本**打进 doctor 输出：CLI 与核心包版本不匹配时便于排障。
    const core = describeCoreSource();
    checks.push({
        name: `核心引擎（${CORE_PACKAGE}）`,
        passed: core.level !== 0,
        detail: core.level === 0
            ? '未定位到核心树（3LIB_CORE_DIR / 已安装核心包 / cli/vendor / 仓库根 四级全部落空）'
            : `${core.mode}｜v${core.version ?? '未知（核心树内无 package.json）'}｜${core.root}`,
        fix: `npm i ${CORE_PACKAGE}（双包发布态），或重装 CLI：npm i -g @ohos-cpf/3rdloop@latest`,
    });

    return checks;
}

/**
 * 检查 MCP Gateway 是否已装配（AI CLI 全局配置注册 + 入口脚本存在）。
 * 宽容实现：不 import lib/mcp.js 的完整装配（避免 doctor 依赖装配状态本身），
 * 仅读配置文件判断。
 */
async function checkMcpRegistration(cliType) {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || '';
    const configRoot = process.env['XDG_CONFIG_HOME'] || path.join(home, '.config');
    const files = [
        path.join(configRoot, 'opencode', 'opencode.json'),
        path.join(configRoot, 'deveco', 'deveco.jsonc'),
    ];
    const details = [];
    let anyRegistered = false;
    for (const file of files) {
        const label = path.basename(path.dirname(file));
        if (!fs.existsSync(file)) {
            details.push(`${label}: 未注册`);
            continue;
        }
        try {
            const raw = fs.readFileSync(file, 'utf8');
            const json = JSON.parse(_stripJsoncComments(raw));
            const entry = json?.mcp?.['mcp-gateway'];
            if (!entry) {
                details.push(`${label}: 未注册`);
                continue;
            }
            // 入口脚本存在性（command 数组第 2 个元素）
            const entryPath = Array.isArray(entry.command) ? entry.command[1] : null;
            if (entryPath && fs.existsSync(entryPath)) {
                details.push(`${label}: 已注册`);
                anyRegistered = true;
            } else {
                details.push(`${label}: 已注册但入口脚本不存在（${entryPath || '未配置'}）`);
            }
        } catch {
            details.push(`${label}: 配置解析失败`);
        }
    }
    return {
        name: 'MCP Gateway 装配',
        passed: anyRegistered,
        detail: details.join('；'),
        fix: '3rdloop doctor（自动装配）或 3rdloop mcp install（kb 检索/脚本工具/知识库检索需要）',
    };
}

/** 剥离 JSONC 注释（// 行注释与 /* 块注释）。 */
function _stripJsoncComments(raw) {
    return raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
}

/**
 * 执行环境自检（3rdloop doctor 命令实现）。
 *
 * 默认自动修复（fix=true）：MCP Gateway 未装配时自动执行装配（等价 3rdloop mcp install，
 * 幂等可重跑）；--no-fix 仅诊断不修改任何文件。
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.skillDir
 * @param {string} opts.dataDir
 * @param {string} [opts.user3libHome] - ~/.3lib（自动装配目标）
 * @param {boolean} [opts.quiet] - 静默模式（不打印表格，仅返回结果）
 * @param {boolean} [opts.fix] - 自动修复开关（默认 true）
 * @returns {Promise<{ ok: boolean, checks: Array<{name: string, passed: boolean, detail?: string, fix?: string}> }>}
 */
export async function runDoctor(opts = {}) {
    const { fix = true } = opts;
    let checks = await collectChecks(opts);

    // ── 自动修复：MCP Gateway 未装配 → 自动执行装配并复查 ──
    if (fix) {
        const mcpIdx = checks.findIndex(c => c.name === 'MCP Gateway 装配' && !c.passed);
        if (mcpIdx !== -1) {
            if (!opts.quiet) {
                process.stderr.write(`\n${C.yellow}检测到 MCP Gateway 未装配，正在自动装配（3rdloop mcp install）...${C.reset}\n`);
            }
            try {
                const { mcpInstall } = await import('./mcp.js');
                const code = await mcpInstall({ user3libHome: opts.user3libHome || '', rest: [], jsonMode: false });
                if (code === 0) {
                    const recheck = await checkMcpRegistration();
                    checks[mcpIdx] = { warning: true, ...recheck };
                } else {
                    checks[mcpIdx].detail += '；自动装配失败，请手动执行 3rdloop mcp install 查看报错';
                }
            } catch (err) {
                checks[mcpIdx].detail += `；自动装配异常: ${err.message}`;
            }
        }
    }

    // 汇总：warning 项不参与通过判定（提示性）
    const ok = checks.every(c => c.passed || c.warning);

    // 打印（失败项附加修复提示；警告项用 ⚠ 标记）
    if (!opts.quiet) {
        process.stderr.write(`\n${C.bold}3rdloop doctor 环境自检${C.reset}${C.gray}（AI CLI: ${resolveCliType()}）${C.reset}\n`);
        for (const c of checks) {
            const icon = c.passed
                ? `${C.green}✓${C.reset}`
                : (c.warning ? `${C.yellow}⚠${C.reset}` : `${C.red}✗${C.reset}`);
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
 *   - 轻量：仅文件/PATH/端口探测，不拉起任何进程、不触引擎、**不改任何文件**
 *     （MCP 装配等修复动作只在 3rdloop doctor 中执行，任务命令保持无副作用）
 *   - MCP 未装配为警告级：不阻断，仅 stderr 提示一行
 *
 * @param {object} opts - { projectRoot, skillDir, dataDir }（与 runDoctor 相同）
 * @returns {Promise<{ ok: boolean, failures: Array<{name: string, detail?: string, fix?: string}> }>}
 */
export async function precheckEnv(opts = {}) {
    const checks = await collectChecks(opts);
    const failures = checks
        .filter(c => !c.passed && !c.warning)
        .map(({ name, detail, fix }) => ({ name, detail, fix }));

    // 警告级提示（不阻断）：MCP 未装配时提醒一次
    const mcpWarn = checks.find(c => c.name === 'MCP Gateway 装配' && !c.passed);
    if (mcpWarn) {
        process.stderr.write(`提示: MCP Gateway 未装配（kb 检索/脚本工具不可用），运行 ${C.cyan}3rdloop doctor${C.reset} 可自动装配\n`);
    }

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
