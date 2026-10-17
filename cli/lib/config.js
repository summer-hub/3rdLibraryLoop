/**
 * config.js —— CLI 环境装配
 *
 * 职责：
 *   - 定位项目根（3LIB_ROOT env > git 仓库根 > cwd 上溯）
 *   - 加载 .env 链：环境变量 > ~/.3lib/.env（用户级） > 项目根 Server/.env（仓库内）
 *   - 定位数据目录（--data-dir > 3LIB_DATA_DIR > ~/.3lib/3rdloop/db）
 *   - 生成 clinic 安全唯一 taskId（随机位 8）
 *   - SKILL 目录优先级链（--skill-dir > 3LIB_SKILL_DIR > vendor/Skills）
 *   - 解析 AI CLI 类型（CLI_TYPE：opencode | deveco-code，默认 deveco-code）
 *
 * 数据目录策略：
 *   用户级统一 ~/.3lib/3rdloop/db（跨平台，由 getUser3libHome 解析），
 *   不与执行目录耦合（默认不再落在执行目录上级），也不随 npm 卸载包而清空。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// cli/ 目录的绝对路径（本文件在 cli/lib/ 下）
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// vendor 目录（核心引擎副本所在，发布时存在；开发期可能是软链/直接引用仓库）
const VENDOR_DIR = path.join(CLI_ROOT, 'vendor');

/**
 * 解析命令行全局选项的统一入口。
 * 所有子命令共用 --json/-v/--quiet/--data-dir/--project/--skill-dir。
 *
 * @param {string[]} argv - 传入命令（不含子命令名）的剩余参数
 * @returns {{ json: boolean, verbose: boolean, quiet: boolean, dataDir: string, projectName: string, skillDir: string, rest: string[] }}
 */
export function parseGlobalFlags(argv) {
    const opts = {
        json: false,
        verbose: false,
        quiet: false,
        dataDir: '',
        projectName: '',
        skillDir: '',
        rest: [],
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        switch (arg) {
            case '--json':
                opts.json = true;
                break;
            case '-v':
            case '--verbose':
                opts.verbose = true;
                break;
            case '--quiet':
                opts.quiet = true;
                break;
            case '--data-dir':
                opts.dataDir = argv[++i] || '';
                break;
            case '--project':
                opts.projectName = argv[++i] || '';
                break;
            case '--skill-dir':
                opts.skillDir = argv[++i] || '';
                break;
            default:
                // 非 flags 参数统一归入 rest
                if (arg.startsWith('--')) {
                    // 未知 flag：忽略但保留以便子命令自行校验
                    opts.rest.push(arg);
                } else {
                    opts.rest.push(arg);
                }
        }
    }
    return opts;
}

/**
 * 解析时长字符串为毫秒。
 * 支持：'30s' / '2m' / '1h' / '90'（默认为秒）；纯数字视为分钟。
 *
 * @param {string} value
 * @returns {number} 毫秒
 */
export function parseDurationMs(value) {
    const str = String(value || '').trim().toLowerCase();
    if (!str) return 0;

    const match = str.match(/^(\d+(?:\.\d+)?)(s|m|h|ms)?$/);
    if (!match) {
        throw new Error(`无法解析时长: "${value}"（支持 30s / 2m / 1h）`);
    }
    const num = parseFloat(match[1]);
    const unit = match[2] || 'm';
    const unitMs = { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
    return Math.round(num * unitMs);
}

/**
 * 定位项目根。
 *
 * 优先级：
 *   1. 环境变量 3LIB_ROOT（显式指定）
 *   2. 从 cwd 向上找到含 package.json 且含 Server/ 的目录（仓库根）
 *   3. 从 cwd 向上找到第一个含 .git 的目录
 *   4. cwd 本身
 *
 * 对 "嵌入式复用 Server/" 的意义：核心引擎在仓库 Server/ 下，找到仓库根
 * 即可正确引用 vendor/Server 或直接引用源码 Server/。
 *
 * @returns {string}
 */
export function detectProjectRoot() {
    if (process.env['3LIB_ROOT'] && fs.existsSync(process.env['3LIB_ROOT'])) {
        return path.resolve(process.env['3LIB_ROOT']);
    }

    let dir = process.cwd();
    while (true) {
        // 判定：存在 package.json 且存在 Server/ 目录
        if (fs.existsSync(path.join(dir, 'Server')) && fs.existsSync(path.join(dir, 'package.json'))) {
            return dir;
        }
        // 判定：存在 .git
        if (fs.existsSync(path.join(dir, '.git'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return process.cwd();
}

/**
 * 生成项目名（默认取 git 仓库根目录名，可用 --project 覆盖）。
 * @param {string} root 项目根路径
 * @returns {string}
 */
export function getProjectName(root, override = '') {
    if (override) return override;
    return path.basename(root) || 'default';
}

/**
 * 加载 .env 链。
 *
 * 优先级（后者不覆盖前者，dotenv.config 默认不覆盖已存在 env）：
 *   1. 已存在的系统环境变量（最高）
 *   2. ~/.3lib/.env（用户级，跨项目）
 *   3. 项目根 Server/.env（仓库内）
 *
 * 这样实现 A3/D1：谁配了 .env 用谁的，key 不进包。
 *
 * 与 Server 侧加载器的关系：本函数跑完（三层链的机会已经用掉）后调
 * `Server/composition/envBootstrap.js` 的 `markServerEnvLoaded()`，让 Server 侧的
 * `loadServerEnv()` 立即返回 false——同一份 `Server/.env` 不会被第二个加载器再读一次，
 * 三层优先级也不会被"后加载者"改变。
 *
 * @param {string} projectRoot - 项目根路径
 * @param {string} user3libHome - 用户 3lib 主目录（~/.3lib）
 */
export async function loadEnvChain(projectRoot, user3libHome) {
    const dotenv = await _loadDotenv();
    if (!dotenv) return;

    const candidates = [
        path.join(user3libHome, '.env'),
        path.join(projectRoot, 'Server', '.env'),
        path.join(projectRoot, '.env'),
    ];

    for (const envPath of candidates) {
        try {
            if (fs.existsSync(envPath)) {
                dotenv.config({ path: envPath, quiet: true });
            }
        } catch {
            // 单个 .env 损坏不影响整体
        }
    }

    await _markServerEnvLoaded();
}

/**
 * 本 CLI 对应的 Server 引擎根目录（发布态 vendor 优先，开发期回退仓库 Server/）。
 * 与 `cli/lib/runner.js` 的 `resolveVendorServer()` 同序，但**不抛错**——
 * env 标记是尽力而为的接线，缺引擎副本时不应让 CLI 启动失败。
 *
 * @returns {string}
 */
function _resolveServerRoot() {
    const vendorServer = path.join(VENDOR_DIR, 'Server');
    if (fs.existsSync(vendorServer)) return vendorServer;
    return path.resolve(CLI_ROOT, '..', 'Server');
}

/**
 * 登记「env 已按三层优先级加载完毕」（方向 cli → Server，Server 不反向依赖 cli）。
 *
 * `envBootstrap.js` 与被 `buildApp` 装配的是**同一个模块实例**（同一绝对路径 →
 * 同一 module cache 槽），因此这里的标记对 `loadServerEnv()` 可见。
 * 没有 Server 副本的部署形态（极端裁剪）静默跳过。
 */
async function _markServerEnvLoaded() {
    try {
        const file = path.join(_resolveServerRoot(), 'composition', 'envBootstrap.js');
        const mod = await import(pathToFileURL(file).href);
        mod.markServerEnvLoaded?.();
    } catch {
        // 引擎副本不存在 / 加载失败：让 Server 侧按原逻辑自行加载，不影响 CLI
    }
}

let _dotenvPromise = null;
function _loadDotenv() {
    if (_dotenvPromise) return _dotenvPromise;
    _dotenvPromise = (async () => {
        try {
            const mod = await import('dotenv');
            return mod.default;
        } catch {
            return null;
        }
    })();
    return _dotenvPromise;
}

/**
 * 计算用户级 3lib 主目录。
 * 提供 3LIB_HOME 覆盖，默认 ~/.3lib。
 * @returns {string}
 */
export function getUser3libHome() {
    if (process.env['3LIB_HOME']) return process.env['3LIB_HOME'];
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, '.3lib');
}

/** 支持的 AI CLI 类型 */
const CLI_TYPES = ['opencode', 'deveco-code'];
/** 默认 CLI 类型（本项目面向 HarmonyOS 三方库场景，默认 DevEco Code） */
const DEFAULT_CLI_TYPE = 'deveco-code';
let _warnedInvalidCliType = false;

/**
 * 解析当前生效的 AI CLI 类型（opencode | deveco-code）。
 *
 * 优先级：显式参数 > 环境变量 CLI_TYPE（含 loadEnvChain 注入的
 * 系统环境变量 > ~/.3lib/.env > 项目 Server/.env 链）> 'deveco-code'（默认）。
 * 与 Server/CLI/cli.js、check-env.mjs 的 resolveCliType 语义保持一致。
 *
 * CLI_TYPE 配了无效值时不崩溃：回退默认值并在 stderr 告警一次
 * （doctor 会将其作为失败项显式报告）。
 *
 * @param {string} [override] - 显式类型（优先级最高）
 * @returns {'opencode'|'deveco-code'}
 */
export function resolveCliType(override) {
    const raw = String(override ?? process.env.CLI_TYPE ?? '').trim();
    if (CLI_TYPES.includes(raw)) return raw;
    if (raw && !_warnedInvalidCliType) {
        _warnedInvalidCliType = true;
        process.stderr.write(
            `[3rdloop] 警告: CLI_TYPE="${raw}" 无效（可选值: ${CLI_TYPES.join(' | ')}），已回退 ${DEFAULT_CLI_TYPE}\n`
        );
    }
    return DEFAULT_CLI_TYPE;
}

/**
 * 确定数据目录。
 *
 * 优先级：
 *   1. --data-dir 显式参数
 *   2. 环境变量 3LIB_DATA_DIR
 *   3. <用户 3lib 主目录>/3rdloop/db（默认，跨平台统一，如 Windows:
 *      C:\Users\<用户>\.3lib\3rdloop\db，macOS/Linux: ~/.3lib/3rdloop/db）
 *
 * 设计说明：默认不随执行目录变化（避免在 D:\tmp 执行时误落 D:\db），
 * 也不放在 npm 包目录内（避免全局重装/卸载时数据被清空）；各命令通过注入的
 * dataDir 自动跟随，任务写入 <dataDir>/task/{taskId}/。
 * 如需团队共享或其他自定义位置，可用 --data-dir 或 3LIB_DATA_DIR 覆盖。
 *
 * @returns {string} 数据根目录绝对路径
 */
export function resolveDataDir({ dataDirFlag, user3libHome }) {
    let rootDir;
    if (dataDirFlag) {
        rootDir = path.resolve(dataDirFlag);
    } else if (process.env['3LIB_DATA_DIR']) {
        rootDir = path.resolve(process.env['3LIB_DATA_DIR']);
    } else {
        // 用户级统一位置（跨平台由 getUser3libHome 解析）
        rootDir = path.join(user3libHome, '3rdloop', 'db');
    }
    fs.mkdirSync(rootDir, { recursive: true });
    return rootDir;
}

/**
 * 确定 SKILL 目录。
 *
 * 优先级：
 *   1. --skill-dir 显式参数
 *   2. 环境变量 3LIB_SKILL_DIR
 *   3. vendor/Skills（发布包内）
 *   4. 仓库内 Server/Skills（开发期）
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function resolveSkillDir({ skillDirFlag, projectRoot, cliRoot = CLI_ROOT }) {
    if (skillDirFlag) return path.resolve(skillDirFlag);
    if (process.env['3LIB_SKILL_DIR']) return path.resolve(process.env['3LIB_SKILL_DIR']);

    const vendorSkills = path.join(vendorDir(), 'Server', 'Skills');
    if (fs.existsSync(vendorSkills)) {
        return vendorSkills;
    }

    const repoSkills = path.join(projectRoot, 'Server', 'Skills');
    if (fs.existsSync(repoSkills)) {
        return repoSkills;
    }
    return path.join(cliRoot, 'vendor', 'Server', 'Skills');
}

/**
 * 返回 vendor 目录绝对路径。
 * @returns {string}
 */
export function vendorDir(cliRoot = CLI_ROOT) {
    return VENDOR_DIR;
}

/**
 * 生成 taskId。
 *
 * 格式：task_<ts36><rand8>
 * 随机位 8（~1e10 空间），避免并发提交碰撞（对照 Server 原始 rand4）。
 * 可选前缀：--project 或环境变量 3LIB_TASK_PREFIX（团队审计用）。
 *
 * @returns {string}
 */
export function generateTaskId() {
    const ts = Date.now().toString(36);
    let rand = '';
    // 用 crypto 安全随机，避免 Math.random 精度 53bit 导致 rand8 可预测性
    try {
        const bytes = crypto.randomBytes(6);
        rand = bytes.toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
    } catch {
        rand = Math.random().toString(36).substring(2, 10);
    }
    if (rand.length < 8) {
        rand = (rand + Math.random().toString(36).substring(2, 10)).slice(0, 8);
    }
    const prefix = process.env['3LIB_TASK_PREFIX'] || '';
    return `${prefix}task_${ts}${rand}`;
}

/**
 * 读取项目 version（来自 package.json 或 vendor/VERSION）。
 * @returns {string}
 */
export function getCliVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

/**
 * 检查 Node 版本 >= 22。
 * @returns {boolean}
 */
export function checkNodeVersion() {
    const major = Number(process.version.match(/^v(\d+)/)?.[1] || 0);
    return major >= 22;
}