/**
 * web.js —— Web 前端服务库（由 3rdloop serve 内嵌启动）
 *
 * 架构（方案 A + D 组合）：
 *   - 核心前端资产随**核心包**发布（`<核心树根>/Web/public`），由 core-paths.js 四级解析派生：
 *     安装态=核心包、vendor 态=cli/vendor、开发态=仓库根；CLI 本身**不含**前端副本
 *   - 二级目录功能（tag/issue/prcheck 等）以"扩展"形式按需启用，不进 npm 包：
 *     * 开发态：自动挂载仓库 Web/ext/ 下全部扩展
 *     * 发布态：仅挂载 ~/.3lib/3rdloop/web-ext/ 下用户安装的扩展
 *     * 任意环境可用 --ext-root 追加自定义扩展根目录
 *   - --web-root 可整目录替换核心前端（跑自定义/实验版前端）
 *
 * 路由优先级：
 *   1. GET /api/ext-registry            扩展注册表（本地响应）
 *   2. /<mount> 与 /<mount>/...         扩展页面 / API / 静态资源
 *   3. /api/* 与 /stream*               反向代理到后端 Server（SSE 透传）
 *   4. 其余                             核心前端静态文件
 *
 * 本模块不再提供独立 CLI 命令（原 `3rdloop web` 已合并到 `3rdloop serve`，
 * Web 前端随 serve 默认启动）。对外导出供 serve.js 组合使用：
 *   startWebServer()                           一站式：解析资产/加载扩展/监听端口
 *   resolveUserExtRoot()                       用户扩展根目录解析
 *   webExtInstall / webExtList / webExtRemove  扩展管理子命令
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    loadExtensions,
    initExtRouter,
    readJsonBody,
    createResShim,
    installExtension,
    removeExtension,
} from './web-ext.js';
import { EXIT } from './exit-codes.js';
import { CORE_PACKAGE, resolveCoreRootsOrNull } from './core-paths.js';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ─── MIME ─────────────────────────────────────────────────────────
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm':  'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.cjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt':  'text/plain; charset=utf-8',
    '.csv':  'text/csv; charset=utf-8',
    '.md':   'text/markdown; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.map':  'application/json; charset=utf-8',
    '.woff':  'font/woff',
    '.woff2': 'font/woff2',
    '.ttf':   'font/ttf',
};

// ═══════════════════════════════════════════════════════════════════
// 目录解析
// ═══════════════════════════════════════════════════════════════════

/**
 * 用户扩展根目录（3LIB_WEB_EXT_ROOT > ~/.3lib/3rdloop/web-ext）。
 * @param {string} user3libHome - 用户 3lib 主目录（~/.3lib）
 */
export function resolveUserExtRoot(user3libHome) {
    return process.env['3LIB_WEB_EXT_ROOT']
        ? path.resolve(process.env['3LIB_WEB_EXT_ROOT'])
        : path.join(user3libHome, '3rdloop', 'web-ext');
}

/**
 * 核心前端资产目录。
 * 优先级：`--web-root` > `3LIB_WEB_ROOT` > 核心树 `Web/public`（core-paths.js 四级解析派生，
 * 覆盖安装态=核心包 / vendor 态=prepack 副本 / 开发态=仓库根）> 抛错。
 *
 * @param {string} [flagValue] - --web-root 的值
 * @returns {string} 前端资产绝对目录
 * @throws {Error} 三级来源全部落空时，错误信息列出每级的实测结果与可照抄的修法
 */
export function resolveWebRoot(flagValue) {
    if (flagValue) {
        const dir = path.resolve(flagValue);
        if (!fs.existsSync(dir)) throw new Error(`--web-root 目录不存在: ${dir}`);
        return dir;
    }
    if (process.env['3LIB_WEB_ROOT']) {
        const dir = path.resolve(process.env['3LIB_WEB_ROOT']);
        if (!fs.existsSync(dir)) throw new Error(`3LIB_WEB_ROOT 目录不存在: ${dir}`);
        return dir;
    }

    // 核心树（安装态=核心包、vendor 态=prepack 副本、开发态=仓库根），webRoot = <coreRoot>/Web/public
    const coreRoots = resolveCoreRootsOrNull();
    if (coreRoots && fs.existsSync(coreRoots.webRoot)) return coreRoots.webRoot;

    throw _webRootError(coreRoots);
}

/** 前端资产三级全落空时的错误（逐级实测 + 可照抄修法）。 */
function _webRootError(coreRoots) {
    const coreDetail = coreRoots
        ? `第 ${coreRoots.level} 级「${coreRoots.label}」已命中核心树 ${coreRoots.coreRoot}，` +
          `但其下没有 Web/public: ${coreRoots.webRoot}`
        : `核心树四级解析失败（3LIB_CORE_DIR / 已安装核心包 / cli/vendor / 仓库根 全部落空）`;
    return new Error(
        '未找到 Web 前端资产目录。已依次尝试三级来源：\n' +
        '  1. --web-root —— 未指定\n' +
        '  2. 环境变量 3LIB_WEB_ROOT —— 未设置\n' +
        `  3. 核心树 Web/public（<核心树根>/Web/public）—— ${coreDetail}\n` +
        '修复（任选其一，照抄即可）：\n' +
        `  npm i ${CORE_PACKAGE}          # 双包发布态：安装核心包（自带 Web/public）\n` +
        '  3rdloop serve --web-root <dir>           # 指定任意前端资产目录\n' +
        '  3LIB_WEB_ROOT=<dir> 3rdloop serve        # 或用环境变量指定'
    );
}

/**
 * 扩展根目录列表（优先级从高到低，同名扩展先注册者生效）。
 * 顺序：--ext-root（可多个）> 3LIB_WEB_EXT_ROOT > 仓库 Web/ext（开发态）> 用户扩展目录。
 */
export function resolveExtRoots(extRootFlags, userExtRoot) {
    const roots = [];
    const push = (p) => {
        const r = path.resolve(p);
        if (fs.existsSync(r) && !roots.includes(r)) roots.push(r);
    };

    for (const f of extRootFlags) push(f);
    if (process.env['3LIB_WEB_EXT_ROOT']) push(process.env['3LIB_WEB_EXT_ROOT']);

    const repoExt = path.resolve(CLI_ROOT, '..', 'Web', 'ext');
    if (fs.existsSync(repoExt)) push(repoExt);

    if (fs.existsSync(userExtRoot)) push(userExtRoot);
    return roots;
}

// ═══════════════════════════════════════════════════════════════════
// 服务启动（由 3rdloop serve 调用）
// ═══════════════════════════════════════════════════════════════════

/**
 * 应用扩展开关过滤：
 *   --no-ext   → 全部禁用（纯后端操作模式：仅核心工作台 + loop + knowledge）
 *   --ext 名称集 → 白名单，仅挂载指定扩展（未发现的名字打 warning）
 * --no-ext 优先于 --ext（同时给出时白名单被忽略）。
 *
 * @param {Array<object>} extensions - loadExtensions 发现的全部扩展
 * @param {object} opts - { noExt, extNames }
 * @param {(msg: string) => void} warn
 * @returns {Array<object>} 过滤后的扩展列表
 */
export function applyExtFilter(extensions, { noExt, extNames }, warn) {
    if (noExt) return [];
    if (!extNames || extNames.length === 0) return extensions;

    const known = extensions.map((e) => e.name);
    for (const name of extNames) {
        if (!known.includes(name)) {
            warn(`[web-ext] --ext 指定的扩展 "${name}" 未发现（可用: ${known.join(', ') || '无'}）`);
        }
    }
    return extensions.filter((e) => extNames.includes(e.name));
}

/**
 * 一站式启动 Web 前端服务：解析前端资产 → 加载扩展 → 创建服务 → 监听端口。
 * 由 3rdloop serve 内嵌调用（后端反代地址指向同进程的 Server 后端）。
 *
 * @param {object} opts
 * @param {number} opts.port - 监听端口（必填）
 * @param {string} opts.backend - 后端 Server 地址（必填，如 http://127.0.0.1:3000）
 * @param {string} [opts.host] - 监听地址（默认 127.0.0.1；也可用环境变量 3LIB_WEB_HOST）。
 *   非回环地址会对外暴露全部 API 与 SSE，因此必须同时配置访问令牌（否则拒绝启动）。
 * @param {string} [opts.accessToken] - 访问令牌（默认取环境变量 3LIB_ACCESS_TOKEN）
 * @param {string} [opts.webRootFlag] - --web-root 覆盖
 * @param {string[]} [opts.extRootFlags] - --ext-root 追加扩展根目录
 * @param {string} [opts.userExtRoot] - 用户扩展根目录（resolveUserExtRoot 结果）
 * @param {boolean} [opts.noExt] - 禁用全部扩展
 * @param {string[]} [opts.extNames] - 白名单扩展名
 * @param {string} [opts.dataDir] - CLI 数据目录（扩展数据落 <dataDir>/web-ext/<name>）
 * @param {boolean} [opts.open] - 启动后自动打开浏览器
 * @param {(msg: string) => void} [opts.log] - 日志函数（默认 stderr；--json 模式传 no-op）
 * @param {string} [opts.tag] - 日志前缀标签
 * @returns {Promise<import('node:http').Server>} 已监听的 http.Server（不注册信号处理，生命周期由调用方管理）
 * @throws 前端资产缺失 / 端口被占用（EADDRINUSE）等启动错误
 */
export async function startWebServer({
    port,
    backend,
    host = '',
    accessToken = '',
    webRootFlag = '',
    extRootFlags = [],
    userExtRoot = '',
    noExt = false,
    extNames = [],
    dataDir = '',
    open = false,
    log = (msg) => process.stderr.write(`${msg}\n`),
    tag = '3rdloop serve',
}) {
    const webRoot = resolveWebRoot(webRootFlag);

    // 加载扩展 → 应用 --no-ext / --ext 开关 → 初始化路由
    const extRoots = resolveExtRoots(extRootFlags, userExtRoot);
    const discovered = loadExtensions(extRoots, log).extensions;
    const extensions = applyExtFilter(discovered, { noExt, extNames }, log);
    for (const ext of extensions) {
        ext.router = initExtRouter(ext, { cliRoot: CLI_ROOT, dataDir, logger: log });
    }
    const mounted = extensions.filter((e) => e.page || e.router);

    // ─── F-02: 监听地址与访问令牌 ───────────────────────────────────────
    // 默认仅回环。非回环（对外可达）必须显式提供令牌，否则拒绝启动——
    // 本服务会无反代 /api/* 与 /stream*，暴露即等于交出引擎 API 与实时事件流。
    const bindHost = String(host || process.env['3LIB_WEB_HOST'] || '127.0.0.1').trim();
    const token = String(accessToken || process.env['3LIB_ACCESS_TOKEN'] || '').trim();
    if (!isLoopbackHost(bindHost) && !token) {
        throw new Error(
            `拒绝启动：host=${bindHost} 会对外暴露全部 API 与 SSE，但未配置访问令牌。` +
            `请省略 --host（默认仅监听 127.0.0.1），或设置环境变量 3LIB_ACCESS_TOKEN 后重试。`
        );
    }

    const server = http.createServer((req, res) => {
        _handleRequest(req, res, { webRoot, extensions, backend, accessToken: token })
            .catch((err) => {
                log(`[${tag}] 请求处理异常: ${err.message}`);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                }
                if (!res.writableEnded) {
                    res.end(JSON.stringify({ success: false, message: 'internal error' }));
                }
            });
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, bindHost, () => resolve());
    });

    const shownHost = isLoopbackHost(bindHost) ? 'localhost' : bindHost;
    log(`[${tag}] Web 前端已启动: http://${shownHost}:${port} （监听 ${bindHost}）`);
    log(`[${tag}] 前端资产: ${webRoot}`);
    log(`[${tag}] 后端代理: ${backend}（/api/*、/stream*）`);
    log(`[${tag}] 访问控制: ${token ? '已启用令牌门禁（3LIB_ACCESS_TOKEN）' : '未启用（仅回环地址可达）'}`);
    if (noExt) {
        log(`[${tag}] 扩展挂载已禁用（--no-ext）：仅核心工作台 + loop + knowledge`);
    } else if (extNames.length > 0) {
        if (mounted.length > 0) {
            const desc = mounted.map((e) => `${e.mount}（${e.title}）`).join('、');
            log(`[${tag}] 白名单挂载扩展 ${mounted.length}/${discovered.length} 个: ${desc}`);
        } else {
            log(`[${tag}] 白名单未匹配到任何扩展（发现 ${discovered.length} 个，--ext: ${extNames.join(', ')}）`);
        }
    } else if (mounted.length > 0) {
        const desc = mounted.map((e) => `${e.mount}（${e.title}）`).join('、');
        log(`[${tag}] 已挂载扩展 ${mounted.length} 个: ${desc}`);
    } else {
        log(`[${tag}] 未挂载扩展（tag/issue/prcheck 等二级功能可用 "3rdloop serve install-ext <dir>" 启用）`);
    }

    if (open) _openBrowser(`http://${shownHost}:${port}`);
    return server;
}

// ═══════════════════════════════════════════════════════════════════
// 请求路由
// ═══════════════════════════════════════════════════════════════════

// ─── F-02: 访问控制辅助 ────────────────────────────────────────────────────

const TOKEN_COOKIE = '3lib_token';

/** 判断 host 是否为本机回环地址 */
export function isLoopbackHost(host) {
    const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

/** 定长安全比较（避免时序侧信道；长度不同或无值直接 false） */
function _safeEqual(a, b) {
    const ba = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
}

/** 从 Authorization / X-Auth-Token / Cookie / query 中提取访问令牌 */
function _extractToken(req, url) {
    const auth = String(req.headers.authorization || '');
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    const hdr = req.headers['x-auth-token'];
    if (hdr) return String(hdr).trim();
    for (const part of String(req.headers.cookie || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === TOKEN_COOKIE) {
            return decodeURIComponent(part.slice(idx + 1).trim());
        }
    }
    return url.searchParams.get('token') || '';
}

/**
 * 令牌门禁。未配置令牌时放行（此时只可能监听回环地址，见 startWebServer 校验）。
 * 支持 `?token=` 一次性换取 HttpOnly Cookie 并 302 剥离 URL 中的令牌。
 * @returns {boolean} 是否放行
 */
function _enforceAuth(req, res, url, accessToken) {
    if (!accessToken) return true;

    const fromQuery = url.searchParams.get('token');
    if (fromQuery && _safeEqual(fromQuery, accessToken)) {
        const clean = new URL(url);
        clean.searchParams.delete('token');
        res.writeHead(302, {
            'Set-Cookie': `${TOKEN_COOKIE}=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
            'Location': clean.pathname + (clean.search || ''),
        });
        res.end();
        return false;
    }

    if (_safeEqual(_extractToken(req, url), accessToken)) return true;

    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
        success: false,
        message: '未授权：缺少或错误的访问令牌（请以 http://<host>:<port>/?token=<3LIB_ACCESS_TOKEN> 打开一次完成授权）',
    }));
    return false;
}

async function _handleRequest(req, res, { webRoot, extensions, backend, accessToken = '' }) {
    const url = new URL(req.url, `http://localhost`);
    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        pathname = url.pathname;
    }
    const lower = pathname.toLowerCase();

    // 0. 访问门禁（配置了令牌时生效，必须先于所有路由）
    if (!_enforceAuth(req, res, url, accessToken)) return;

    // 1. 扩展注册表（本地响应，前端导航用）
    if (lower === '/api/ext-registry') {
        _sendJson(res, 200, {
            success: true,
            data: extensions
                .filter((e) => e.page || e.router)
                .map(({ name, title, description, mount, order }) => ({ name, title, description, mount, order })),
        });
        return;
    }

    // 2. 扩展挂载点（页面 / API / 静态资源）
    for (const ext of extensions) {
        if (lower === ext.mount || lower.startsWith(ext.mount + '/')) {
            const subpath = pathname.slice(ext.mount.length) || '/';
            await _handleExtRequest(ext, req, res, subpath, url);
            return;
        }
    }

    // 3. 后端反向代理（SSE 透传）
    if (lower.startsWith('/api/') || lower.startsWith('/stream')) {
        _proxyToBackend(req, res, backend);
        return;
    }

    // 4. 核心前端路由别名（与 Web/server.js 行为对齐）
    if (lower === '/knowledge' || lower.startsWith('/knowledge/')) {
        res.writeHead(302, { Location: '/#knowledge' });
        res.end();
        return;
    }
    if (lower === '/loop.html') {
        res.writeHead(302, { Location: '/#p-loop' });
        res.end();
        return;
    }

    // 5. 核心前端静态文件
    _serveStatic(webRoot, pathname, res);
}

/** 扩展请求：子路径根 → 页面；其次 API 路由；最后 public/ 静态 */
async function _handleExtRequest(ext, req, res, subpath, url) {
    const method = (req.method || 'GET').toUpperCase();

    // 子路径根 → 扩展页面
    if (subpath === '/' || subpath === '') {
        if (ext.page && (method === 'GET' || method === 'HEAD')) {
            _serveFile(ext.page, res);
        } else if (ext.page) {
            _sendJson(res, 405, { success: false, message: 'method not allowed' });
        } else {
            _sendJson(res, 404, { success: false, message: 'extension has no page' });
        }
        return;
    }

    // API 路由分发
    if (ext.router) {
        const route = ext.router.match(method, subpath);
        if (route) {
            let body = {};
            if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
                const result = await readJsonBody(req);
                if (!result.ok) {
                    _sendJson(res, 413, { success: false, message: `request body error: ${result.error}` });
                    return;
                }
                body = result.body;
            }

            const reqShim = {
                method,
                url: subpath,
                headers: req.headers,
                params: route.params,
                query: Object.fromEntries(url.searchParams),
                body,
            };
            const resShim = createResShim(res);
            try {
                await route.handler(reqShim, resShim);
            } catch (err) {
                process.stderr.write(`[web-ext] ${ext.name} ${method} ${subpath} 处理失败: ${err.message}\n`);
                if (!res.headersSent) {
                    resShim.status(500).json({ success: false, message: `扩展处理失败: ${err.message}` });
                } else if (!res.writableEnded) {
                    res.end();
                }
            }
            return;
        }
    }

    // 静态资源（ext/public/ 下）
    _serveStatic(path.join(ext.dir, 'public'), subpath, res);
}

// ═══════════════════════════════════════════════════════════════════
// 静态文件 / 代理 / 工具
// ═══════════════════════════════════════════════════════════════════

/** 静态文件托管（默认页 index.html，含路径穿越防护） */
function _serveStatic(root, pathname, res) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(root, rel);

    // 路径穿越防护
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        _sendJson(res, 403, { success: false, message: 'forbidden' });
        return;
    }
    _serveFile(filePath, res);
}

function _serveFile(filePath, res) {
    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            _sendJson(res, 404, { success: false, message: 'not found' });
            return;
        }
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size });
        fs.createReadStream(filePath).pipe(res);
    });
}

function _sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

/**
 * 反向代理到后端 Server（复用 Web/server.js 语义：SSE 透传、连接清理）。
 */
function _proxyToBackend(req, res, backendUrl) {
    const target = new URL(req.url, backendUrl);
    const proxyReq = http.request(target, {
        method: req.method,
        headers: { ...req.headers, host: target.host },
    }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        // 上游（后端）关闭时通知下游，避免连接悬挂
        proxyRes.on('close', () => { if (!res.writableEnded) res.end(); });
    });

    proxyReq.on('error', (err) => {
        _sendJson(res, 502, {
            status: 'error',
            message: `后端不可达: ${err.message}`,
            backend: backendUrl,
        });
    });

    // 浏览器断开（含 EventSource.close、页面关闭/刷新）时销毁上游连接，
    // 使后端能感知连接关闭并正确清理，防止连接泄漏
    res.on('close', () => { if (!proxyReq.destroyed) proxyReq.destroy(); });
    req.on('aborted', () => { if (!proxyReq.destroyed) proxyReq.destroy(); });

    req.pipe(proxyReq);
}

function _openBrowser(url) {
    try {
        const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'cmd'
            : 'xdg-open';
        const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
        spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {});
    } catch { /* 打开失败不影响服务 */ }
}

// ═══════════════════════════════════════════════════════════════════
// 扩展管理子命令（由 3rdloop serve install-ext/list-ext/remove-ext 分发）
// ═══════════════════════════════════════════════════════════════════

export function webExtInstall(srcDir, { userExtRoot, jsonMode, out }) {
    if (!srcDir) {
        process.stderr.write('用法: 3rdloop serve install-ext <扩展目录>\n');
        return EXIT.ERROR;
    }
    try {
        const { name, title, dest } = installExtension(srcDir, userExtRoot);
        if (jsonMode) {
            out({ success: true, name, title, installedTo: dest });
        } else {
            process.stdout.write(`已安装扩展 "${name}"（${title}）→ ${dest}\n`);
        }
        return EXIT.OK;
    } catch (err) {
        process.stderr.write(`安装失败: ${err.message}\n`);
        return EXIT.ERROR;
    }
}

export function webExtList({ userExtRoot, jsonMode, out }) {
    const warn = (msg) => process.stderr.write(`${msg}\n`);
    const extRoots = resolveExtRoots([], userExtRoot);
    const { extensions } = loadExtensions(extRoots, warn);

    const items = extensions.map((e) => ({
        name: e.name,
        title: e.title,
        mount: e.mount,
        order: e.order,
        source: e.dir,
        hasApi: !!e.server,
        hasPage: !!e.page,
    }));

    if (jsonMode) {
        out({ total: items.length, extensions: items });
        return EXIT.OK;
    }

    if (items.length === 0) {
        process.stdout.write('暂无可用扩展。\n');
        process.stdout.write(`扩展目录（可手动放置或用 install-ext 安装）: ${userExtRoot}\n`);
        process.stdout.write('仓库内置扩展源: <仓库>/Web/ext/，如 3rdloop serve install-ext Web/ext/tag\n');
        return EXIT.OK;
    }

    process.stdout.write(`可用扩展（${items.length} 个）:\n`);
    for (const it of items) {
        process.stdout.write(`  ${it.name.padEnd(10)} ${it.mount.padEnd(12)} ${it.title}\n`);
        process.stdout.write(`  ${' '.repeat(10)} 来源: ${it.source}\n`);
    }
    return EXIT.OK;
}

export function webExtRemove(name, { userExtRoot, jsonMode, out }) {
    if (!name) {
        process.stderr.write('用法: 3rdloop serve remove-ext <扩展名>\n');
        return EXIT.ERROR;
    }
    try {
        const removed = removeExtension(name, userExtRoot);
        if (jsonMode) {
            out({ success: true, name, removedFrom: removed });
        } else {
            process.stdout.write(`已移除扩展 "${name}"（${removed}）\n`);
        }
        return EXIT.OK;
    } catch (err) {
        process.stderr.write(`移除失败: ${err.message}\n`);
        return EXIT.ERROR;
    }
}
