/**
 * doctor.js —— 环境自检（3rdloop doctor）
 *
 * 复用 check-env.mjs 的检测维度（轻量版，不耦合启动流程）：
 *   1. Node.js 版本（>=22）
 *   2. CLI_TYPE 配置有效性（无效值视为配置错误）
 *   3. AI CLI 可执行文件（按 CLI_TYPE 检测 opencode / deveco）
 *   4. .env 配置（项目 Server/.env 或用户 ~/.3lib/.env）
 *   5. Skill 目录可访问
 *   6. 数据目录可写
 *   7. serve 服务端口连通性（非致命：未运行时 run/orch/step/workflow 会自动拉起）
 *
 * 退出码：全部通过 = 0；存在致命问题 = 1。
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
 * 执行环境自检。
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.skillDir
 * @param {string} opts.dataDir
 * @returns {Promise<{ ok: boolean, checks: Array<{name: string, passed: boolean, detail?: string}> }>}
 */
export async function runDoctor(opts = {}) {
    const checks = [];
    const { projectRoot, skillDir, dataDir } = opts;

    // 1. Node.js 版本
    const nodeMajor = Number(process.version.match(/^v(\d+)/)?.[1] || 0);
    checks.push({
        name: 'Node.js >= 22',
        passed: nodeMajor >= 22,
        detail: process.version,
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
    });

    // 4. .env 配置（项目 Server/.env 或用户 ~/.3lib/.env）
    const envPaths = [
        path.join(projectRoot, 'Server', '.env'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.3lib', '.env'),
    ];
    const foundEnv = envPaths.find(p => fs.existsSync(p));
    let envOk = false;
    let envDetail = '';
    if (foundEnv) {
        const content = fs.readFileSync(foundEnv, 'utf8');
        const required = ['DASHSCOPE_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
        const missing = required.filter(k => !new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, 'm').test(content));
        envOk = missing.length === 0;
        envDetail = missing.length
            ? `缺少: ${missing.join(', ')} (${foundEnv})`
            : `配置完整 (${foundEnv})`;
    } else {
        envDetail = '未找到 .env（项目 Server/.env 或 ~/.3lib/.env）';
    }
    checks.push({ name: 'LLM 环境变量', passed: envOk, detail: envDetail });

    // 5. Skill 目录可访问
    const skillOk = skillDir && fs.existsSync(skillDir);
    checks.push({
        name: 'SKILL 目录',
        passed: !!skillOk,
        detail: skillOk ? skillDir : 'SKILL 目录不存在',
    });

    // 6. 数据目录可写
    let dataOk = false;
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        dataOk = true;
    } catch { /* 不可写 */ }
    checks.push({ name: '数据目录', passed: dataOk, detail: dataDir });

    // 7. serve 服务端口连通性（未运行不算失败：执行命令时会自动拉起；
    //    端口有响应但异常则视为失败，提示清理残留进程）
    const serve = await probeServe(`http://${cliCfg.host}:${cliCfg.port}`);
    checks.push({
        name: `${cliType} serve 服务`,
        passed: serve.state !== 'error',
        detail: serve.detail,
    });

    // 汇总
    const ok = checks.every(c => c.passed);

    // 打印
    if (!opts.quiet) {
        process.stderr.write(`\n${C.bold}3rdloop doctor 环境自检${C.reset}${C.gray}（AI CLI: ${cliType}）${C.reset}\n`);
        for (const c of checks) {
            const icon = c.passed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
            process.stderr.write(`  ${icon} ${c.name}`);
            if (c.detail) process.stderr.write(`  ${C.gray}${c.detail}${C.reset}`);
            process.stderr.write('\n');
        }
    }

    return { ok, checks };
}
