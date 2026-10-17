/**
 * serve.js —— 3rdloop serve：一条命令同时启动 Server HTTP 后端 + Web 前端
 *
 * 定位：serve 与 Web 前端绑定启动（原独立 `3rdloop web` 命令已合并至此）：
 *   - 后端：复用 Server/Routes/server.js 的 createServer（默认 3000，不新增任何 daemon/调度逻辑）
 *   - 前端：进程内启动 Web 服务（lib/web.js：静态托管 + /api 反代 + 扩展挂载，默认 8080）
 *
 * 行为：
 *   - 默认同时启动后端与 Web 前端（--port / 3LIB_SERVER_PORT、--web-port / 3LIB_WEB_PORT）
 *   - 复用 CLI 的环境装配（cli.js 已统一执行 .env 链 + stdout 保护），与 run/submit 等命令一致
 *   - 扩展管理子命令：install-ext / list-ext / remove-ext（不启动服务）
 *   - 端口冲突 / 启动失败给出明确错误，不静默
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
    startWebServer,
    resolveUserExtRoot,
    webExtInstall,
    webExtList,
    webExtRemove,
} from './web.js';
import { resolveCoreRoots } from './core-paths.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = path.resolve(moduleDir, '..');

// ─── 核心树路径解析（与 runner.js 同一实现：core-paths.js 四级解析）────────────────
/** 动态导入 Server/Routes/server.js（核心树由 3LIB_CORE_DIR > 已安装核心包 > vendor > 仓库根 解析）。 */
async function _importServerModule() {
    const serverRoot = resolveCoreRoots(CLI_ROOT).serverRoot;
    const url = new URL(`file://${path.join(serverRoot, 'Routes', 'server.js').replace(/\\/g, '/')}`);
    return import(url.href);
}

/**
 * 解析 serve 专用参数（不依赖 cli.js 的 parseGlobalFlags，全局 flags 已被其消费）。
 * Web 前端随 serve 默认启动，原 -w/--web 仅作兼容接受（不再有独立语义）。
 * @returns {{ port?: number, webPort?: number, webRoot: string, extRoots: string[], extNames: string[], noExt: boolean, open: boolean, positionals: string[] }}
 */
function _parseServeArgs(rest = []) {
    const args = { webRoot: '', extRoots: [], extNames: [], noExt: false, open: false, positionals: [] };
    const parsePort = (raw, name) => {
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0 || n > 65535) {
            throw new Error(`非法端口: "${raw}"（${name}）`);
        }
        return n;
    };
    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];

        if (arg === '-w' || arg === '--web') {
            // 兼容旧参数：Web 前端现已默认启动，提示后忽略
            process.stderr.write('[3rdloop serve] 提示: -w/--web 已无需指定，Web 前端随 serve 默认启动\n');
        } else if (arg === '--port') {
            args.port = parsePort(rest[++i], '--port');
        } else if (arg === '--web-port') {
            args.webPort = parsePort(rest[++i], '--web-port');
        } else if (arg === '--web-root') {
            args.webRoot = rest[++i] || '';
        } else if (arg === '--ext-root') {
            const raw = rest[++i];
            if (raw) args.extRoots.push(raw);
        } else if (arg === '--ext') {
            // 白名单：逗号分隔 + 可重复指定（--ext tag --ext issue 等效 --ext tag,issue）
            const raw = rest[++i];
            if (raw) {
                for (const n of raw.split(',')) {
                    const t = n.trim();
                    if (t) args.extNames.push(t);
                }
            }
        } else if (arg === '--no-ext') {
            args.noExt = true;
        } else if (arg === '--open') {
            args.open = true;
        } else if (arg.startsWith('--')) {
            throw new Error(`未知选项: ${arg}（查看帮助: 3rdloop serve --help）`);
        } else {
            args.positionals.push(arg);
        }
    }
    return args;
}

/** --json 模式的 stdout 输出函数（非 json 模式为 no-op）。 */
function _jsonOut(jsonMode) {
    return (data) => {
        if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    };
}

/**
 * 3rdloop serve 命令实现：同时启动 Server HTTP 后端 + Web 前端。
 * @param {object} opts
 * @param {string[]} opts.rest - flags.rest（含 serve 专用参数与扩展管理子命令）
 * @param {boolean} opts.jsonMode
 * @param {string} [opts.dataDir] - CLI 解析后的数据目录（--data-dir / 3LIB_DATA_DIR / 默认）
 * @param {string} [opts.user3libHome] - 用户 3lib 主目录（~/.3lib，扩展根解析用）
 * @returns {Promise<number>} 退出码（serve 为长驻命令，仅 --help/子命令/启动失败正常返回）
 */
export async function cmdServe({ rest = [], jsonMode = false, dataDir = '', user3libHome = '' }) {
    // --help / -h：打印用法
    if (rest.includes('--help') || rest.includes('-h')) {
        _printServeHelp();
        return 0;
    }

    let args;
    try {
        args = _parseServeArgs(rest);
    } catch (err) {
        process.stderr.write(`${err.message}\n`);
        _printServeHelp();
        return 1;
    }

    const userExtRoot = resolveUserExtRoot(user3libHome);

    // ── 扩展管理子命令（不启动服务） ──
    const [sub, subArg] = args.positionals;
    if (sub === 'install-ext') {
        return webExtInstall(subArg, { userExtRoot, jsonMode, out: _jsonOut(jsonMode) });
    }
    if (sub === 'list-ext') {
        return webExtList({ userExtRoot, jsonMode, out: _jsonOut(jsonMode) });
    }
    if (sub === 'remove-ext') {
        return webExtRemove(subArg, { userExtRoot, jsonMode, out: _jsonOut(jsonMode) });
    }
    if (sub !== undefined) {
        process.stderr.write(`未知子命令: ${sub}\n`);
        _printServeHelp();
        return 1;
    }

    const serverPort = args.port ?? _envInt('3LIB_SERVER_PORT', 3000);
    const webPort = args.webPort ?? _envInt('3LIB_WEB_PORT', 8080);

    if (serverPort === webPort) {
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

    // ── 优雅退出 ──
    // 必须在 createServer 之前注册：Server 内部也注册了 SIGINT/SIGTERM 处理器
    // （退出码 0），先注册者先执行，保证 CLI 约定的 130/143 退出码语义。
    let webServer = null;
    let backendServer = null;
    let shuttingDown = false;
    const onSignal = async (sig) => {
        if (shuttingDown) return;
        shuttingDown = true;
        const exitCode = sig === 'SIGINT' ? 130 : 143;
        try {
            // 立即停止 Web 服务并断开存量连接（含 SSE 反代长连接）
            webServer?.close();
            webServer?.closeAllConnections?.();
        } catch { /* 尽力而为 */ }
        // F-04：先让后端优雅收尾（中止在途编排、归档并回收远端会话、状态落盘），
        // 再按 CLI 约定退出。此前直接 process.exit 会让后端清理逻辑完全没有机会执行。
        try {
            if (typeof backendServer?.gracefulShutdown === 'function') {
                await backendServer.gracefulShutdown({ timeoutMs: 30000 });
            }
        } catch { /* 尽力而为 */ }
        process.exit(exitCode);
    };
    process.once('SIGINT', () => { onSignal('SIGINT'); });
    process.once('SIGTERM', () => { onSignal('SIGTERM'); });

    // json 模式下静默 Web 启动横幅（stdout 只放结构化启动信息）
    const log = jsonMode ? () => {} : (msg) => process.stderr.write(`${msg}\n`);

    try {
        // 1) Web 前端先监听（后端反代指向本进程后端端口；
        //    Web 端口冲突时在后端启动前快速失败）
        webServer = await startWebServer({
            port: webPort,
            backend: `http://127.0.0.1:${serverPort}`,
            webRootFlag: args.webRoot,
            extRootFlags: args.extRoots,
            userExtRoot,
            noExt: args.noExt,
            extNames: args.extNames,
            dataDir,
            open: args.open,
            log,
            tag: '3rdloop serve',
        });

        // 2) Server HTTP 后端
        // cliType 由环境决定（shell > .env > 默认 deveco-code），与 CLI 嵌入式一致；
        // dataDir 已通过 3LIB_DATA_DIR env 注入（见上），Server 内部所有默认
        // createStorage() 均落到用户数据目录；skillDir 沿用包内 vendor 默认
        // （npm 更新自动获得新 SKILL，不与 CLI 的 3LIB_SKILL_DIR 联动）
        // 保留引用：F-04 停机时需调用其 gracefulShutdown 完成编排收尾
        backendServer = await serverModule.createServer({ port: serverPort });

        if (jsonMode) {
            process.stdout.write(JSON.stringify({
                ok: true,
                type: 'server',
                pid: process.pid,
                backend: { port: serverPort, url: `http://127.0.0.1:${serverPort}` },
                web: { port: webPort, url: `http://localhost:${webPort}` },
            }, null, 2) + '\n');
        } else {
            process.stderr.write(`[3rdloop serve] Server 后端已启动: http://127.0.0.1:${serverPort}\n`);
            process.stderr.write(`[3rdloop serve] 通过 Ctrl+C 停止\n`);
        }

        // 长驻：保持进程存活直到收到信号
        await new Promise(() => {});
        return 0;
    } catch (err) {
        try {
            webServer?.close();
            webServer?.closeAllConnections?.();
        } catch { /* 尽力而为 */ }
        const reason = err?.code === 'EADDRINUSE'
            ? `端口 ${err.port ?? '?'} 已被占用，可用 --port / --web-port 指定其他端口`
            : err.message;
        process.stderr.write(`3rdloop serve 启动失败: ${reason}\n`);
        return 1;
    }
}

/** 读取正整数环境变量（非法/缺席返回默认值）。 */
function _envInt(name, def) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

function _printServeHelp() {
    process.stdout.write(`3rdloop serve —— 同时启动 Server HTTP 后端 + Web 前端

用法:
  3rdloop serve [选项]                     启动后端（默认 3000）+ Web 前端（默认 8080）
  3rdloop serve install-ext <dir>          安装扩展到 ~/.3lib/3rdloop/web-ext/
  3rdloop serve list-ext                   列出可用扩展（含来源与挂载点）
  3rdloop serve remove-ext <name>          移除已安装扩展

选项:
  --port <N>          后端端口（默认 3000，可用 3LIB_SERVER_PORT 覆盖）
  --web-port <N>      Web 前端端口（默认 8080，可用 3LIB_WEB_PORT 覆盖）
  --web-root <dir>    核心前端资产目录覆盖（默认: 仓库 Web/public，发布包为内置 cli/web）
  --ext-root <dir>    追加扩展根目录（可多次指定；目录下每个子目录是一个扩展）
  --ext <name,...>    白名单：仅挂载指定扩展（逗号分隔，可重复指定；未发现的名字打警告）
  --no-ext            禁用全部扩展（纯核心工作台模式；优先于 --ext）
  --open              启动后自动打开浏览器
  --json              输出结构化启动信息到 stdout（进度/日志走 stderr）
  -h, --help          本帮助

说明:
  Web 前端随 serve 默认启动（原 "3rdloop web" 命令已合并到 serve）：
  静态托管核心工作台 + /api/*、/stream* 反代到后端 + 扩展挂载。
  CLI 的 run/submit/wait 等命令保持嵌入式模式，不经此后端。
  退出: Ctrl+C / SIGTERM 优雅停止（退出码 130/143）。

环境变量:
  3LIB_SERVER_PORT    后端端口（等效 --port）
  3LIB_WEB_PORT       Web 前端端口（等效 --web-port）
  3LIB_WEB_ROOT       核心前端资产目录（等效 --web-root）
  3LIB_WEB_EXT_ROOT   用户扩展根目录（默认 ~/.3lib/3rdloop/web-ext）
`);
}

export default cmdServe;
