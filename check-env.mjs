#!/usr/bin/env node

/**
 * 3rdLibraryLoop 环境检测脚本
 *
 * 检测内容：
 *   1. Server/.env 文件是否存在及必要环境变量配置（DASHSCOPE_API_KEY、CLI_TYPE 等）
 *   2. Node.js 是否已安装（≥ 22）
 *   3. CLI 工具是否已安装（按 CLI_TYPE 检测 opencode 或 deveco）
 *   4. devecocli 是否已安装
 *   5. CLI 模型配置读取（按 CLI_TYPE 读 opencode / deveco 配置，跨平台兼容）
 *   6. 项目依赖是否已安装（缺失自动安装）
 *
 * 用法:
 *   node check-env.mjs           # 仅检测，通过返回 exit 0，失败返回 exit 1
 *   node check-env.mjs --silent   # 静默模式，仅输出最终结果
 *
 * 退出码:
 *   0 — 全部检测通过
 *   1 — 存在致命问题
 *
 * 也可被 start-services.mjs 导入调用: import { runChecks, resolveCliType } from './check-env.mjs'
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─── 路径常量 ──────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = __dirname; // 脚本位于 3rdLibraryLoop/ 下

const ENV_FILE = path.join(PROJECT_ROOT, 'Server', '.env');
const ENV_EXAMPLE = path.join(PROJECT_ROOT, 'Server', '.env.example');

// ─── 静默模式 ──────────────────────────────────────────────────────────────
const SILENT = process.argv.includes('--silent');

// ─── ANSI 颜色（仅交互式终端启用）─────────────────────────────────────────
const isTTY = process.stdout.isTTY && !SILENT;
const C = isTTY ? {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bgGreen: '\x1b[42m',
    bgRed: '\x1b[41m',
    bgYellow: '\x1b[43m',
} : {
    reset: '', bold: '', red: '', green: '', yellow: '', blue: '',
    cyan: '', gray: '', bgGreen: '', bgRed: '', bgYellow: '',
};

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function banner(text) {
    if (SILENT) return;
    const line = '─'.repeat(Math.max(text.length * 2, 50));
    console.log(`\n${C.cyan}${C.bold}┌${line}┐${C.reset}`);
    const pad = ' '.repeat(Math.floor((line.length - text.length * 2) / 2));
    console.log(`${C.cyan}${C.bold}│${pad}${text}${pad}│${C.reset}`);
    console.log(`${C.cyan}${C.bold}└${line}┘${C.reset}\n`);
}

function ok(msg) {
    if (SILENT) return;
    console.log(`  ${C.green}✓${C.reset} ${msg}`);
}

function warn(msg) {
    if (SILENT) return;
    console.log(`  ${C.yellow}⚠${C.reset} ${msg}`);
}

function fail(msg) {
    if (SILENT) return;
    console.log(`  ${C.red}✗${C.reset} ${msg}`);
}

function info(msg) {
    if (SILENT) return;
    console.log(`  ${C.blue}ℹ${C.reset} ${msg}`);
}

function hint(msg) {
    if (SILENT) return;
    console.log(`  ${C.gray}${msg}${C.reset}`);
}

/** 尝试获取命令路径（不抛异常） */
function which(cmd) {
    try {
        const tool = process.platform === 'win32' ? 'where' : 'which';
        const result = execSync(`${tool} ${cmd}`, {
            stdio: 'pipe',
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();
        return result.split('\n')[0].trim() || null;
    } catch {
        return null;
    }
}

/** 获取命令版本号 */
function getVersion(cmd) {
    try {
        const result = execSync(`${cmd} --version`, {
            stdio: 'pipe',
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();
        return result.split('\n')[0];
    } catch {
        return null;
    }
}

// opencode / deveco 配置文件候选路径（跨平台兼容，同时支持 .json 和 .jsonc）
// deveco-code 与 opencode 使用相同的配置 schema，仅目录不同
function getCliConfigPaths(cliType) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (cliType === 'deveco-code') {
        const configDir = process.platform === 'win32' && process.env.APPDATA
            ? path.join(process.env.APPDATA, 'deveco')
            : path.join(home, '.config', 'deveco');
        // deveco 按以下顺序加载配置
        return [
            path.join(configDir, 'config.json'),
            path.join(configDir, 'deveco.json'),
            path.join(configDir, 'deveco.jsonc'),
        ];
    }
    const configDir = process.env.XDG_CONFIG_HOME
        || (process.platform === 'win32' && process.env.APPDATA
            ? path.join(process.env.APPDATA, 'opencode')
            : null)
        || path.join(home, '.config', 'opencode');

    // opencode 可能使用 opencode.json 或 opencode.jsonc
    return [
        path.join(configDir, 'opencode.json'),
        path.join(configDir, 'opencode.jsonc'),
    ];
}

/**
 * 解析当前生效的 CLI 类型
 *
 * 优先级（与 Server/CLI/cli.js 保持一致）：
 *   shell 环境变量 CLI_TYPE > Server/.env 的 CLI_TYPE > 'opencode'
 *
 * @returns {'opencode'|'deveco-code'}
 */
export function resolveCliType() {
    const fromShell = (process.env.CLI_TYPE || '').trim();
    if (fromShell === 'opencode' || fromShell === 'deveco-code') return fromShell;
    try {
        const content = fs.readFileSync(ENV_FILE, 'utf-8');
        const m = content.match(/^\s*CLI_TYPE\s*=\s*(opencode|deveco-code)\s*$/m);
        if (m) return m[1];
    } catch { /* .env 不存在或不可读，回退默认 */ }
    return 'opencode';
}

/**
 * 解析 CLI serve 服务应监听的端口
 *
 * 优先级（与 Server/CLI 适配器保持一致）：
 *   shell 环境变量 OPENCODE_PORT/DEVECO_PORT > Server/.env 同名变量 > 默认值
 *   默认值：opencode 与 deveco-code 统一为 4096（单后端架构，同一时间只运行一个；
 *   两者需同时运行时通过 DEVECO_PORT 指定不同端口）
 *
 * @param {'opencode'|'deveco-code'} [cliType] - 未传时自动调用 resolveCliType()
 * @returns {string}
 */
export function resolveCliServePort(cliType) {
    const type = cliType || resolveCliType();
    const envVar = type === 'deveco-code' ? 'DEVECO_PORT' : 'OPENCODE_PORT';
    const defaultPort = '4096';

    const fromShell = (process.env[envVar] || '').trim();
    if (/^\d+$/.test(fromShell)) return fromShell;
    try {
        const content = fs.readFileSync(ENV_FILE, 'utf-8');
        const m = content.match(new RegExp(`^\\s*${envVar}\\s*=\\s*(\\d+)\\s*$`, 'm'));
        if (m) return m[1];
    } catch { /* .env 不存在或不可读 */ }
    return defaultPort;
}

/** 去掉 JSONC 中的注释和尾逗号，返回纯 JSON 字符串 */
function stripJsonComments(text) {
    let result = '';
    let i = 0;
    let inString = false;
    let stringChar = '';

    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];

        // 字符串内部
        if (inString) {
            result += ch;
            if (ch === '\\' && next) {
                result += next;
                i += 2;
                continue;
            }
            if (ch === stringChar) {
                inString = false;
            }
            i++;
            continue;
        }

        // 单行注释 //
        if (ch === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            continue;
        }

        // 多行注释 /* */
        if (ch === '/' && next === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
            continue;
        }

        // 字符串开始
        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            result += ch;
            i++;
            continue;
        }

        result += ch;
        i++;
    }

    // 移除尾逗号 (JSONC 允许 {,} [,] )
    return result.replace(/,(\s*[}\]])/g, '$1');
}

// ─── 检测项定义 ────────────────────────────────────────────────────────────

const checks = [];

/**
 * 检测 1：Server/.env 文件及必要环境变量
 */
function checkEnvFile() {
    const result = { name: 'Server/.env 环境配置', passed: false, errors: [] };

    if (!fs.existsSync(ENV_FILE)) {
        fail(`文件不存在: ${ENV_FILE}`);
        if (fs.existsSync(ENV_EXAMPLE)) {
            hint(`可从模板复制: cp Server/.env.example Server/.env`);
        }
        result.errors.push(`文件不存在: ${ENV_FILE}`);
        checks.push(result);
        return;
    }

    ok(`找到 .env 文件: ${ENV_FILE}`);
    const content = fs.readFileSync(ENV_FILE, 'utf-8');

    // 必要环境变量列表
    const requiredVars = [
        'DASHSCOPE_API_KEY',
        'LLM_BASE_URL',
        'LLM_MODEL',
    ];

    let allValid = true;

    for (const varName of requiredVars) {
        const regex = new RegExp(`^\\s*${varName}\\s*=\\s*(.+)$`, 'm');
        const match = content.match(regex);

        if (!match) {
            fail(`缺少必要环境变量: ${varName}`);
            allValid = false;
            continue;
        }

        const value = match[1].trim();

        // 检查是否是占位符值
        if (value === 'your_api_key_here' || value === '') {
            fail(`${varName} 未设置有效值 (当前: "${value}")`);
            allValid = false;
            continue;
        }

        ok(`${varName} = ${value.length > 20 ? value.substring(0, 8) + '...' + value.slice(-4) : value}`);
    }

    // DASHSCOPE_API_KEY 专项检查
    const apiKeyMatch = content.match(/^\s*DASHSCOPE_API_KEY\s*=\s*(.+)$/m);
    if (apiKeyMatch) {
        const apiKey = apiKeyMatch[1].trim();
        if (apiKey && apiKey !== 'your_api_key_here') {
            if (!apiKey.startsWith('sk-')) {
                warn(`DASHSCOPE_API_KEY 格式可能不正确（通常以 "sk-" 开头）`);
            }
        }
    }

    // 检查可选变量（仅提示，不影响通过）
    const optionalVars = ['LLM_TEMPERATURE', 'LLM_MAX_TOKENS', 'FALLBACK_MODEL'];
    for (const varName of optionalVars) {
        const regex = new RegExp(`^\\s*${varName}\\s*=\\s*(.+)$`, 'm');
        if (content.match(regex)) {
            const val = content.match(regex)[1].trim();
            info(`可选变量 ${varName} = ${val}`);
        } else {
            hint(`可选变量 ${varName} 未设置（将使用默认值）`);
        }
    }

    // CLI_TYPE 专项校验（默认 CLI 后端类型，直接决定启动哪个 serve 服务）
    const cliTypeMatch = content.match(/^\s*CLI_TYPE\s*=\s*(.+)$/m);
    if (cliTypeMatch) {
        const val = cliTypeMatch[1].trim();
        if (val === 'opencode' || val === 'deveco-code') {
            ok(`CLI_TYPE = ${val}（默认 CLI 后端）`);
        } else {
            warn(`CLI_TYPE = "${val}" 无效，可选值: opencode | deveco-code，将回退为 opencode`);
            hint(`修正 Server/.env 中的 CLI_TYPE 后重试`);
        }
    } else {
        hint(`CLI_TYPE 未设置（默认 opencode；如需切换 DevEco Code 可设置 CLI_TYPE=deveco-code）`);
    }

    result.passed = allValid;
    checks.push(result);
}

/**
 * 检测 2：Node.js
 */
function checkNodejs() {
    const result = { name: 'Node.js 运行时', passed: false, errors: [] };
    const nodePath = which('node');

    if (!nodePath) {
        fail('Node.js 未安装');
        console.log();
        hint(`${C.bold}请安装 Node.js ≥ 22${C.reset}`);
        hint(`下载链接: https://nodejs.org/`);
        hint(`安装命令（macOS Homebrew）: ${C.cyan}brew install node@22${C.reset}`);
        hint(`安装命令（Windows winget）: ${C.cyan}winget install OpenJS.NodeJS.LTS${C.reset}`);
        hint(`安装命令（Linux nvm）:        ${C.cyan}nvm install 22 && nvm use 22${C.reset}`);
        result.errors.push('Node.js 未安装');
        checks.push(result);
        return;
    }

    const version = getVersion('node');
    ok(`Node.js 已安装: ${version}`);
    hint(`路径: ${nodePath}`);

    // 版本检查 ≥ 22
    const versionMatch = version.match(/v(\d+)/);
    if (versionMatch) {
        const major = parseInt(versionMatch[1], 10);
        if (major < 22) {
            warn(`Node.js 版本 ${major} 偏低，建议升级到 ≥ 22（需内置 node:sqlite 模块）`);
            hint(`升级链接: https://nodejs.org/`);
            result.passed = false;
            result.errors.push(`Node.js 版本 ${major} < 22`);
        } else {
            ok(`Node.js 版本 ≥ 22，满足要求`);
            result.passed = true;
        }
    } else {
        result.passed = true;
    }

    // 检查 npm
    const npmPath = which('npm');
    if (npmPath) {
        const npmVersion = getVersion('npm');
        ok(`npm 已安装: ${npmVersion}`);
    } else {
        warn('npm 未找到（通常随 Node.js 一起安装）');
    }

    checks.push(result);
}

/**
 * 检测 3：CLI 工具（按 CLI_TYPE 检测 opencode 或 deveco）
 */
function checkCliTool() {
    const cliType = resolveCliType();
    const result = { name: `CLI 工具 (${cliType})`, passed: false, errors: [] };

    if (cliType === 'deveco-code') {
        // ── deveco-code 模式：检测 deveco 命令 ──
        const devecoPath = which('deveco');
        if (!devecoPath) {
            fail('deveco 未安装（当前 CLI_TYPE=deveco-code，后端将连接 deveco serve）');
            console.log();
            hint(`${C.bold}请安装 DevEco Code${C.reset}`);
            hint(`安装命令: ${C.cyan}npm install -g @deveco/deveco-code${C.reset}`);
            hint(`安装后首次启动需登录: ${C.cyan}deveco auth login${C.reset}`);
            hint(`项目地址: ${C.cyan}https://gitcode.com/openharmony-sig/deveco-code${C.reset}`);
            result.errors.push('deveco 未安装');
            checks.push(result);
            return;
        }
        const version = getVersion('deveco');
        ok(`deveco 已安装: ${version}`);
        hint(`路径: ${devecoPath}`);
        hint(`启动命令（由 start-services.mjs 自动执行）: ${C.cyan}deveco serve --port ${resolveCliServePort('deveco-code')}${C.reset}`);
        result.passed = true;
        checks.push(result);
        return;
    }

    // ── opencode 模式（默认）：检测 opencode 命令 ──
    const opencodePath = which('opencode');

    if (!opencodePath) {
        fail('opencode 未安装');
        console.log();
        hint(`${C.bold}请安装 opencode${C.reset}`);
        hint(`安装命令: ${C.cyan}npm i -g opencode-ai${C.reset}`);
        hint(`下载链接: ${C.cyan}https://opencode.ai/zh/download${C.reset}`);
        result.errors.push('opencode 未安装');
        checks.push(result);
        return;
    }

    const version = getVersion('opencode');
    ok(`opencode 已安装: ${version}`);
    hint(`路径: ${opencodePath}`);
    result.passed = true;
    checks.push(result);
}

/**
 * 检测 4：devecocli
 */
function checkDevecocli() {
    const result = { name: 'devecocli', passed: false, errors: [] };
    const devecocliPath = which('devecocli');

    if (!devecocliPath) {
        fail('devecocli 未安装');
        console.log();
        hint(`${C.bold}请安装 devecocli${C.reset}`);
        hint(`安装命令: ${C.cyan}npm install -g @deveco/deveco-cli@latest${C.reset}`);
        hint(`安装后执行: ${C.cyan}devecocli init --agent opencode${C.reset}`);
        hint(`快速开始: ${C.cyan}https://gitcode.com/openharmony-sig/deveco-cli#快速开始${C.reset}`);
        result.errors.push('devecocli 未安装');
        checks.push(result);
        return;
    }

    const version = getVersion('devecocli');
    ok(`devecocli 已安装: ${version}`);
    hint(`路径: ${devecocliPath}`);
    result.passed = true;
    checks.push(result);
}

/**
 * 检测 5：CLI 模型配置（按 CLI_TYPE 读 opencode / deveco 配置，schema 相同）
 */
function checkCliConfig() {
    const cliType = resolveCliType();
    const result = { name: `${cliType} 模型配置`, passed: false, errors: [] };
    const candidatePaths = getCliConfigPaths(cliType);

    console.log();
    info(`查找 ${cliType} 配置文件...`);
    for (const p of candidatePaths) {
        hint(`  候选: ${p}`);
    }

    let foundPath = null;
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            foundPath = p;
            break;
        }
    }

    if (!foundPath) {
        warn(`${cliType} 配置文件未找到`);
        hint(`可能原因: ${cliType === 'deveco-code' ? 'deveco' : 'opencode'} 从未运行过，或配置文件在其他位置`);
        hint(`可运行一次 ${C.cyan}${cliType === 'deveco-code' ? 'deveco' : 'opencode'}${C.reset} 以生成默认配置`);
        // 配置文件不存在不算致命错误，标记为警告
        result.passed = true;
        result.errors.push('配置文件未找到（非致命）');
    } else {
        _parseCliConfig(foundPath, result);
    }

    checks.push(result);
}

/** 解析 CLI 配置文件并显示模型信息（opencode / deveco schema 相同） */
function _parseCliConfig(configPath, result) {
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const cleanJson = stripJsonComments(raw);
        const config = JSON.parse(cleanJson);

        ok(`配置文件: ${configPath}`);
        console.log();

        // 显示 provider 信息
        // opencode / deveco 配置结构: provider 是对象，key 为 provider 标识
        //   { "myprovider": { name, npm, options: { apiKey, baseURL }, models: { modelId: { name, ... } } } }
        if (config.provider) {
            console.log(`  ${C.bold}── Providers ──${C.reset}`);
            // 统一处理: provider 可能是对象 { key: {...} } 或数组 [{...}]
            const providerEntries = Array.isArray(config.provider)
                ? config.provider.map((p, i) => [String(i), p])
                : Object.entries(config.provider);

            for (const [providerKey, p] of providerEntries) {
                if (typeof p === 'string') {
                    console.log(`    • ${p}`);
                    continue;
                }
                const displayName = p.name || providerKey || 'unknown';
                const npmPkg = p.npm || '';
                const options = p.options || {};
                const baseURL = options.baseURL || options.baseUrl || options.api_base || p.baseURL || p.baseUrl || '';
                const apiKey = options.apiKey || options.api_key || p.apiKey || p.api_key || '';
                const models = p.models || p.model || {};

                console.log(`    ${C.cyan}• ${displayName}${C.reset} ${C.gray}(${providerKey})${C.reset}`);
                if (npmPkg) hint(`      npm: ${npmPkg}`);
                if (baseURL) hint(`      baseURL: ${baseURL}`);
                if (apiKey) hint(`      apiKey: ${apiKey.substring(0, 6)}...${apiKey.slice(-4)}`);

                // models 可能是对象 { modelId: { name, reasoningEffort, ... } } 或数组
                if (Array.isArray(models)) {
                    for (const m of models) {
                        if (typeof m === 'string') {
                            console.log(`      ${C.green}model:${C.reset} ${m}`);
                        } else {
                            const modelId = m.name || m.id || m.model || 'unknown';
                            const label = m.label || m.reasoningEffort || '';
                            console.log(`      ${C.green}model:${C.reset} ${modelId}${label ? ` ${C.gray}(${label})${C.reset}` : ''}`);
                        }
                    }
                } else if (typeof models === 'object' && models !== null) {
                    for (const [modelId, modelInfo] of Object.entries(models)) {
                        if (typeof modelInfo === 'string') {
                            console.log(`      ${C.green}model:${C.reset} ${modelId} ${C.gray}→ ${modelInfo}${C.reset}`);
                        } else if (typeof modelInfo === 'object' && modelInfo !== null) {
                            const modelName = modelInfo.name || modelId;
                            const extra = [];
                            if (modelInfo.reasoningEffort) extra.push(`reasoning: ${modelInfo.reasoningEffort}`);
                            if (modelInfo.label) extra.push(modelInfo.label);
                            console.log(`      ${C.green}model:${C.reset} ${modelId} ${C.gray}→ ${modelName}${extra.length ? ` (${extra.join(', ')})` : ''}${C.reset}`);
                        }
                    }
                } else if (typeof models === 'string') {
                    console.log(`      ${C.green}model:${C.reset} ${models}`);
                }
            }
            console.log();
        }

        // 显示默认模型
        if (config.model) {
            if (typeof config.model === 'string') {
                console.log(`  ${C.bold}── 默认模型 ──${C.reset}`);
                console.log(`    ${C.green}${config.model}${C.reset}`);
            } else if (typeof config.model === 'object') {
                console.log(`  ${C.bold}── 默认模型 ──${C.reset}`);
                // opencode 格式: { chat: "...", edit: "...", ... }
                for (const [key, val] of Object.entries(config.model)) {
                    if (typeof val === 'string') {
                        console.log(`    ${key}: ${C.green}${val}${C.reset}`);
                    } else if (typeof val === 'object' && val !== null) {
                        const modelId = val.model || val.name || val.id || JSON.stringify(val);
                        const provider = val.provider || '';
                        console.log(`    ${key}: ${C.green}${modelId}${C.reset}${provider ? ` (${provider})` : ''}`);
                    }
                }
            }
            console.log();
        }

        // 显示 agent 配置（如果有）
        if (config.agent) {
            console.log(`  ${C.bold}── Agent 配置 ──${C.reset}`);
            const agents = Array.isArray(config.agent) ? config.agent : [config.agent];
            for (const a of agents) {
                if (typeof a === 'object' && a !== null) {
                    const name = a.name || a.id || 'unknown';
                    const model = a.model || '';
                    console.log(`    • ${name}${model ? ` → ${C.green}${model}${C.reset}` : ''}`);
                }
            }
            console.log();
        }

        result.passed = true;
    } catch (err) {
        fail(`解析配置文件失败: ${err.message}`);
        hint(`文件: ${configPath}`);
        result.passed = true; // 解析失败非致命
        result.errors.push(`解析失败: ${err.message}`);
    }
}

/**
 * 检测 6：项目依赖是否已安装（逐包检查，缺失自动安装）
 */
function checkDependencies() {
    const result = { name: '项目依赖', passed: false, errors: [] };

    // 需要检查的目录列表: [目录名, package.json 所在路径]
    const depDirs = [];
    const rootPkg = path.join(PROJECT_ROOT, 'package.json');
    if (fs.existsSync(rootPkg)) depDirs.push(['根目录', PROJECT_ROOT]);
    const serverPkg = path.join(PROJECT_ROOT, 'Server', 'package.json');
    if (fs.existsSync(serverPkg)) depDirs.push(['Server', path.join(PROJECT_ROOT, 'Server')]);
    const mcpPkg = path.join(PROJECT_ROOT, 'MCP', 'package.json');
    if (fs.existsSync(mcpPkg)) depDirs.push(['MCP', path.join(PROJECT_ROOT, 'MCP')]);

    for (const [label, dir] of depDirs) {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const deps = pkgJson.dependencies || {};
        const depNames = Object.keys(deps);

        if (depNames.length === 0) {
            ok(`${label}: 无 dependencies 声明`);
            continue;
        }

        // 逐个检查每个依赖包是否实际安装
        const missing = [];
        for (const dep of depNames) {
            const depPath = path.join(dir, 'node_modules', dep);
            if (!fs.existsSync(depPath)) {
                missing.push(dep);
            }
        }

        if (missing.length === 0) {
            ok(`${label}: ${depNames.length} 个依赖均已安装`);
        } else {
            warn(`${label}: 缺失 ${missing.length} 个依赖: ${missing.join(', ')}`);
            hint(`正在自动安装: ${C.cyan}cd ${label === '根目录' ? '' : 'Server'} && npm install${C.reset}`);
            try {
                execSync('npm install', { cwd: dir, stdio: 'pipe', timeout: 120000 });
                ok(`${label}: 依赖安装完成`);

                // 安装后再次验证缺失的包
                const stillMissing = missing.filter(dep =>
                    !fs.existsSync(path.join(dir, 'node_modules', dep))
                );
                if (stillMissing.length > 0) {
                    result.errors.push(`${label}: 安装后仍缺失: ${stillMissing.join(', ')}`);
                    fail(`${label}: 安装后仍缺失 ${stillMissing.length} 个依赖`);
                }
            } catch (err) {
                result.errors.push(`${label}: npm install 失败: ${err.message}`);
                fail(`${label}: npm install 失败`);
                hint(err.stderr ? err.stderr.toString().slice(0, 200) : err.message);
            }
        }
    }

    result.passed = result.errors.length === 0;
    checks.push(result);
}

/**
 * 执行所有检测，返回是否全部通过
 * @returns {boolean} true = 全部通过，false = 存在致命问题
 */
export function runChecks() {
    const cliType = resolveCliType();
    banner('🔁 3rdLibraryLoop 环境检测');
    console.log(`  ${C.gray}检测时间: ${new Date().toLocaleString()}${C.reset}`);
    console.log(`  ${C.gray}项目路径: ${PROJECT_ROOT}${C.reset}`);
    console.log(`  ${C.gray}操作系统: ${process.platform} ${process.arch}${C.reset}`);
    console.log(`  ${C.gray}默认 CLI 后端: ${C.bold}${cliType}${C.reset}${cliType === 'deveco-code' ? C.gray + '（Server/.env CLI_TYPE）' + C.reset : ''}`);
    console.log();

    // ── 1. .env 配置 ──
    console.log(`${C.bold}  [1/6] 检测 Server/.env 环境配置${C.reset}`);
    console.log();
    checkEnvFile();

    // ── 2. Node.js ──
    console.log(`\n${C.bold}  [2/6] 检测 Node.js${C.reset}`);
    console.log();
    checkNodejs();

    // ── 3. CLI 工具（按 CLI_TYPE） ──
    console.log(`\n${C.bold}  [3/6] 检测 CLI 工具 (${cliType})${C.reset}`);
    console.log();
    checkCliTool();

    // ── 4. devecocli ──
    console.log(`\n${C.bold}  [4/6] 检测 devecocli${C.reset}`);
    console.log();
    checkDevecocli();

    // ── 5. CLI 模型配置（按 CLI_TYPE） ──
    console.log(`\n${C.bold}  [5/6] 读取 ${cliType} 模型配置${C.reset}`);
    checkCliConfig();

    // ── 6. 项目依赖 ──
    console.log(`\n${C.bold}  [6/6] 检测项目依赖${C.reset}`);
    console.log();
    checkDependencies();

    // ── 汇总 ──
    banner('📋 检测结果汇总');

    let hasFatal = false;

    for (const c of checks) {
        const isFatal = c.errors.some(e => !e.includes('非致命'));
        const icon = c.passed
            ? (c.errors.length > 0 ? `${C.yellow}⚠` : `${C.green}✓`)
            : `${C.red}✗`;
        console.log(`  ${icon}${C.reset} ${c.name}`);
        if (!c.passed && isFatal) {
            hasFatal = true;
        }
    }

    console.log();
    return !hasFatal;
}

// 直接运行时执行检测（通过 process.argv[1] 判断是否为入口模块）
const isMain = process.argv[1] === __filename;
if (isMain) {
    const allPassed = runChecks();

    if (!allPassed) {
        console.log(`  ${C.bgRed}${C.bold} 环境检测未通过，请修复上述问题后重试 ${C.reset}\n`);
        process.exit(1);
    }

    console.log(`  ${C.bgGreen}${C.bold} 环境检测全部通过 ${C.reset}\n`);
    console.log(`  ${C.gray}可运行启动脚本: node start-services.mjs${C.reset}\n`);
    process.exit(0);
}
