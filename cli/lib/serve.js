/**
 * serve.js —— 3rdloop serve 启动 Server HTTP 后端
 *
 * 定位：为前端展示启动现成 Server 后端（复用 Server/Routes/server.js 的
 * createServer，不新增任何 daemon/调度逻辑）。CLI 其余命令仍为嵌入式，不受影响。
 *
 * 行为：
 *   - 默认仅启动 HTTP 后端（--port / 3LIB_SERVER_PORT / 3000）
 *   - -w/--web 可选：再拉起 Web/server.js 静态前端（反向代理 /api/* 到后端）
 *   - 复用 CLI 的环境装配（cli.js 已统一执行 .env 链 + stdout 保护），
 *     与 run/submit 等命令保持一致；json 模式下本模块自行纯化 stdout
 *   - 端口冲突 / 启动失败给出明确错误，不静默
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = path.resolve(moduleDir, '..');

// ─── vendor/Server 路径解析（与 runner.js 保持一致）────────────────
let _serverModuleRoot = null;
function resolveVendorServer(cliRoot) {
    if (_serverModuleRoot) return _serverModuleRoot;

    const vendorServer = path.join(cliRoot, 'vendor', 'Server');
    if (fs.existsSync(vendorServer)) {
        _serverModuleRoot = vendorServer;
        return vendorServer;
    }
    const repoServer = path.resolve(cliRoot, '..', 'Server');
    if (fs.existsSync(repoServer)) {
        _serverModuleRoot = repoServer;
        return repoServer;
    }
    throw new Error(
        `无法定位核心引擎目录：期望 cli/vendor/Server 或仓库 Server/。` +
        `请先运行 npm run prepack（或 clone 仓库到 cli/ 的上一级）`
    );
}

/** 动态导入 Server/Routes/server.js（一手段：vendor 优先、开发期回退仓库源码）。 */
async function _importServerModule() {
    const serverRoot = resolveVendorServer(CLI_ROOT);
    const url = new URL(`file://${path.join(serverRoot, 'Routes', 'server.js').replace(/\\/g, '/')}`);
    return import(url.href);
}

/** Web 静态前端目录（开发期仓库 Web/；发布期 vendor/Web 预留）。 */
function resolveWebDir() {
    const candidates = [
        path.resolve(CLI_ROOT, '..', 'Web'),
        path.join(CLI_ROOT, 'vendor', 'Web'),
    ];
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'public'))) {
            return dir;
        }
    }
    return null;
}

/**
 * 解析 flags.rest 中 serve 专用参数（不依赖 cli.js 的 parseGlobalFlags，
 * 因为 -w/--web 会被它归入 rest）。
 * @returns {{ web: boolean, port?: number, webPort?: number }}
 */
function _parseServeArgs(rest = []) {
    const args = { web: false };
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === '-w' || arg === '--web') args.web = true;
        else if (arg === '--port' || arg === '--web-port') {
            const key = arg === '--port' ? 'port' : 'webPort';
            const n = parseInt(rest[i + 1], 10);
            if (Number.isFinite(n) && n > 0) args[key] = n;
            i++; // 跳过值
        }
    }
    return args;
}

/**
 * 3rdloop serve 命令实现。
 * @param {object} opts
 * @param {string[]} opts.rest - flags.rest（含 serve 专用参数）
 * @param {boolean} opts.jsonMode
 * @param {string} [opts.dataDir] - CLI 解析后的数据目录（--data-dir / 3LIB_DATA_DIR / 默认）
 * @returns {Promise<number>} 退出码（serve 为长驻命令，仅 --help/启动失败正常返回）
 */
export async function cmdServe({ rest = [], jsonMode = false, dataDir = '' }) {
    // --help / -h：打印用法
    if (rest.includes('--help') || rest.includes('-h')) {
        _printServeHelp();
        return 0;
    }

    const args = _parseServeArgs(rest);
    const serverPort = args.port ?? _envInt('3LIB_SERVER_PORT', 3000);
    const webPort = args.webPort ?? _envInt('3LIB_WEB_PORT', 8080);

    if (args.web && serverPort === webPort) {
        process.stderr.write(`3rdloop serve: 后端端口与 Web 端口相同 (${serverPort})，请用 --web-port 指定不同端口\n`);
        return 1;
    }

    // ── 数据目录对齐 CLI（A3）：与 run/submit 共用同一 dataDir ──────
    // 通过 env 注入而非逐层传参：Server 内部所有自建 createStorage()
    // 都经 StorageManager 默认根目录解析，env 一处生效（含 FlexRunner /
    // KnowledgeManager / MessageArchive 等惰性自建实例）。
    // 必须在 import Server 模块前设置（覆盖部分模块加载期构造的实例）。
    if (dataDir) {
        process.env['3LIB_DATA_DIR'] = dataDir;
    }

    const serverModule = await _importServerModule();

    // json 模式下纯化 stdout：Server 内部 console.log/info 重定向到 stderr
    let restoreStdout = null;
    if (jsonMode) {
        restoreStdout = _redirectStdoutLogs();
    }

    let webChild = null;

    // 优雅退出：清理 Web 子进程（Windows taskkill 树）后退出
    const cleanup = () => {
        if (webChild && webChild.pid != null) {
            try {
                if (process.platform === 'win32') {
                    execSync(`taskkill /pid ${webChild.pid} /T /F`, { stdio: 'ignore' });
                } else {
                    webChild.kill('SIGTERM');
                }
            } catch { /* 进程可能已退出 */ }
            webChild = null;
        }
    };
    let shuttingDown = false;
    const onSignal = (sig) => {
        if (shuttingDown) return;
        shuttingDown = true;
        cleanup();
        process.exit(sig === 'SIGINT' ? 130 : 143);
    };
    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));

    try {
        // cliType 由环境决定（shell > .env > 默认 deveco-code），与 CLI 嵌入式一致；
        // dataDir 已通过 3LIB_DATA_DIR env 注入（见上），Server 内部所有默认
        // createStorage() 均落到用户数据目录；skillDir 沿用包内 vendor 默认
        // （npm 更新自动获得新 SKILL，不与 CLI 的 3LIB_SKILL_DIR 联动）
        const server = await serverModule.createServer({ port: serverPort });

        if (jsonMode) {
            process.stdout.write(JSON.stringify({
                ok: true,
                type: 'server',
                pid: process.pid,
                port: serverPort,
                url: `http://127.0.0.1:${serverPort}`,
                web: args.web ? { port: webPort, url: `http://localhost:${webPort}` } : null,
            }, null, 2) + '\n');
        } else {
            process.stderr.write(`[3rdloop serve] Server HTTP 后端已启动: http://127.0.0.1:${serverPort}\n`);
            process.stderr.write(`[3rdloop serve] 通过 Ctrl+C 停止\n`);
        }

        // ── 可选启动 Web 前端（默认不拉起，保持聚焦后端） ──
        if (args.web) {
            await _startWebFrontend(webPort, serverPort, jsonMode, (child) => { webChild = child; });
        }

        // 长驻：保持进程存活直到收到信号
        await new Promise(() => {});
        return 0;
    } catch (err) {
        process.stderr.write(`3rdloop serve 启动失败: ${err.message}\n`);
        return 1;
    } finally {
        restoreStdout?.();
    }
}

/** 启动 Web 静态前端（反向代理 /api/* → 后端）。 */
async function _startWebFrontend(webPort, serverPort, jsonMode, onChild) {
    try {
        if (await _isPortOpen(webPort)) {
            process.stderr.write(`[3rdloop serve] Web 端口 ${webPort} 已被占用，跳过拉起前端（可直接访问该地址）\n`);
            return;
        }
    } catch { /* 探测失败不阻断 */ }

    const webDir = resolveWebDir();
    if (!webDir) {
        process.stderr.write('[3rdloop serve] 未找到 Web/ 前端目录，跳过拉起前端\n');
        return;
    }

    const child = spawn(process.execPath, [
        path.join(webDir, 'server.js'),
        '--port', String(webPort),
        '--backend', `http://127.0.0.1:${serverPort}`,
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: false,
    });
    child.stdout?.on('data', (d) => process.stderr.write(`[web] ${d}`));
    child.stderr?.on('data', (d) => process.stderr.write(`[web] ${d}`));
    child.on('error', (err) => {
        process.stderr.write(`[3rdloop serve] 拉起 Web 前端失败: ${err.message}\n`);
    });
    onChild(child);
    if (!jsonMode) {
        process.stderr.write(`[3rdloop serve] Web 前端已启动: http://localhost:${webPort}\n`);
    }
}

/** 读取正整数环境变量（非法/缺席返回默认值）。 */
function _envInt(name, def) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

/** 探测端口是否有响应（尽力而为，不阻断）。 */
function _isPortOpen(port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal })
            .then(() => resolve(true))
            .catch(() => resolve(false))
            .finally(() => clearTimeout(timer));
    });
}

/** json 模式下把 Server 内部 console.log/info 重定向到 stderr，返回恢复函数。 */
function _redirectStdoutLogs() {
    const safeStringify = (a) => {
        try { return JSON.stringify(a); } catch { return String(a); }
    };
    const toStderr = (args) => {
        process.stderr.write(args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ') + '\n');
    };
    const origLog = console.log;
    const origInfo = console.info;
    console.log = (...args) => toStderr(args);
    console.info = (...args) => toStderr(args);
    return () => {
        console.log = origLog;
        console.info = origInfo;
    };
}

function _printServeHelp() {
    process.stdout.write(`3rdloop serve —— 启动 Server HTTP 后端（供前端展示）

用法:
  3rdloop serve [--port N] [-w|--web] [--web-port N]

选项:
  --port N        后端端口（默认 3000，可用 3LIB_SERVER_PORT 覆盖）
  -w, --web       同时拉起 Web 前端（默认 8080，可用 --web-port / 3LIB_WEB_PORT 覆盖）
  --web-port N    Web 前端端口
  --json          输出结构化启动信息到 stdout（进度/日志走 stderr）
  -h, --help      本帮助

说明:
  默认只启动 Server HTTP 后端（http://127.0.0.1:3000），供 Web 前端 / 脚本反向代理调用。
  CLI 的 run/submit/wait 等命令保持嵌入式模式，不经此后端。
  退出: Ctrl+C / SIGTERM 优雅停止（Windows 下会清理 Web 子进程树）。
`);
}

export default cmdServe;