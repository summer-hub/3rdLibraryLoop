/**
 * web.js —— 3rdloop web 命令：启动 Web 前端服务
 *
 * 架构（方案 A + D 组合）：
 *   - 核心前端资产：仓库 Web/public（开发态）/ cli/web（发布态，prepack 复制）
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
 * 用法：
 *   3rdloop web [--port 8080] [--backend http://127.0.0.1:3000]
 *               [--web-root <dir>] [--ext-root <dir>]... [--open]
 *   3rdloop web install-ext <dir>    安装扩展到 ~/.3lib/3rdloop/web-ext/
 *   3rdloop web list-ext             列出可用扩展（含来源与挂载点）
 *   3rdloop web remove-ext <name>    移除已安装扩展
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 8080;
const DEFAULT_BACKEND = 'http://127.0.0.1:3000';

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
// 命令入口（由 cli.js 分发）
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {object} opts
 * @param {object} opts.flags - parseGlobalFlags 结果
 * @param {string[]} opts.rest - 剩余参数（含子命令位置参数与 web 专属 flags）
 * @param {string} opts.user3libHome - 用户 3lib 主目录（~/.3lib）
 * @param {string} opts.dataDir - CLI 数据目录
 * @param {boolean} opts.jsonMode
 * @param {Function} opts.out - --json 输出函数
 * @returns {Promise<number>} 退出码
 */
export async function cmdWeb({ flags, user3libHome, dataDir, jsonMode, out }) {
    // 注意：使用 flags.rest（全局 flags 如 --json/--data-dir 已被 parseGlobalFlags 消费）
    let argv;
    try {
        argv = _parseWebArgs(flags.rest);
    } catch (err) {
        process.stderr.write(`${err.message}\n`);
        _printWebHelp();
        return EXIT.ERROR;
    }
    const userExtRoot = process.env['3LIB_WEB_EXT_ROOT']
        ? path.resolve(process.env['3LIB_WEB_EXT_ROOT'])
        : path.join(user3libHome, '3rdloop', 'web-ext');

    if (argv.help) {
        _printWebHelp();
        return EXIT.OK;
    }

    const positional = argv.positionals;

    // ── 子命令分发 ──
    if (positional[0] === 'install-ext') {
        return _cmdInstallExt(positional[1], { userExtRoot, jsonMode, out });
    }
    if (positional[0] === 'list-ext') {
        return _cmdListExt({ userExtRoot, jsonMode, out });
    }
    if (positional[0] === 'remove-ext') {
        return _cmdRemoveExt(positional[1], { userExtRoot, jsonMode, out });
    }
    if (positional[0] !== undefined) {
        process.stderr.write(`未知子命令: ${positional[0]}\n`);
        _printWebHelp();
        return EXIT.ERROR;
    }

    // ── 启动 Web 服务 ──
    return _startServer({ argv, userExtRoot, dataDir });
}

// ═══════════════════════════════════════════════════════════════════
// 参数解析
// ═══════════════════════════════════════════════════════════════════

/**
 * 解析 web 命令专属参数。
 * parseGlobalFlags 已消费全局 flags（--json/--data-dir 等），这里处理剩余部分。
 * 非法参数直接 throw，由 cmdWeb 统一捕获打印帮助。
 */
function _parseWebArgs(rest) {
    const opts = {
        port: DEFAULT_PORT,
        backend: DEFAULT_BACKEND,
        webRoot: '',
        extRoots: [],
        extNames: [],
        noExt: false,
        open: false,
        help: false,
        positionals: [],
    };

    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];

        if (arg === '--port') {
            const raw = rest[++i];
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n <= 0 || n > 65535) {
                throw new Error(`非法端口: "${raw}"`);
            }
            opts.port = n;
        } else if (arg === '--backend') {
            const raw = rest[++i];
            if (!raw || !/^https?:\/\//.test(raw)) {
                throw new Error(`非法后端地址: "${raw}"（须为 http(s):// 开头）`);
            }
            opts.backend = raw.replace(/\/+$/, '');
        } else if (arg === '--web-root') {
            opts.webRoot = rest[++i] || '';
        } else if (arg === '--ext-root') {
            const raw = rest[++i];
            if (raw) opts.extRoots.push(raw);
        } else if (arg === '--no-ext') {
            opts.noExt = true;
        } else if (arg === '--ext') {
            // 白名单：逗号分隔 + 可重复指定（--ext tag --ext issue 等效 --ext tag,issue）
            const raw = rest[++i];
            if (raw) {
                for (const n of raw.split(',')) {
                    const t = n.trim();
                    if (t) opts.extNames.push(t);
                }
            }
        } else if (arg === '--open') {
            opts.open = true;
        } else if (arg === '--help' || arg === '-h') {
            opts.help = true;
        } else if (arg.startsWith('--')) {
            throw new Error(`未知选项: ${arg}（查看帮助: 3rdloop web --help）`);
        } else {
            opts.positionals.push(arg);
        }
    }
    return opts;
}

/**
 * 应用扩展开关过滤：
 *   --no-ext   → 全部禁用（纯后端操作模式：仅核心工作台 + loop + knowledge）
 *   --ext 名称集 → 白名单，仅挂载指定扩展（未发现的名字打 warning）
 * --no-ext 优先于 --ext（同时给出时白名单被忽略）。
 *
 * @param {Array<object>} extensions - loadExtensions 发现的全部扩展
 * @param {object} argv - _parseWebArgs 结果
 * @param {(msg: string) => void} warn
 * @returns {Array<object>} 过滤后的扩展列表
 */
function _applyExtFilter(extensions, argv, warn) {
    if (argv.noExt) return [];
    if (argv.extNames.length === 0) return extensions;

    const known = extensions.map((e) => e.name);
    for (const name of argv.extNames) {
        if (!known.includes(name)) {
            warn(`[web-ext] --ext 指定的扩展 "${name}" 未发现（可用: ${known.join(', ') || '无'}）`);
        }
    }
    return extensions.filter((e) => argv.extNames.includes(e.name));
}

// ═══════════════════════════════════════════════════════════════════
// 目录解析
// ═══════════════════════════════════════════════════════════════════

/**
 * 核心前端资产目录。
 * 优先级：--web-root > 3LIB_WEB_ROOT > 仓库 Web/public（开发态）> cli/web（发布态内置）
 */
function _resolveWebRoot(flagValue) {
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
    // 开发态：cli 上一级的 Web/public（源码，始终优先于构建副本）
    const repoWeb = path.resolve(CLI_ROOT, '..', 'Web', 'public');
    if (fs.existsSync(repoWeb)) return repoWeb;
    // 发布态：prepack 复制的内置前端
    const bundled = path.join(CLI_ROOT, 'web');
    if (fs.existsSync(bundled)) return bundled;

    throw new Error(
        '未找到前端资产目录：期望仓库 Web/public 或 cli/web。' +
        '发布包缺资产请重新安装；本地开发请在仓库内运行，或用 --web-root 指定。'
    );
}

/**
 * 扩展根目录列表（优先级从高到低，同名扩展先注册者生效）。
 * 顺序：--ext-root（可多个）> 3LIB_WEB_EXT_ROOT > 仓库 Web/ext（开发态）> 用户扩展目录。
 */
function _resolveExtRoots(extRootFlags, userExtRoot) {
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
// 服务启动
// ═══════════════════════════════════════════════════════════════════

async function _startServer({ argv, userExtRoot, dataDir }) {
    const warn = (msg) => process.stderr.write(`${msg}\n`);

    let webRoot;
    try {
        webRoot = _resolveWebRoot(argv.webRoot);
    } catch (err) {
        process.stderr.write(`[3rdloop web] ${err.message}\n`);
        return EXIT.ERROR;
    }

    // 加载扩展 → 应用 --no-ext / --ext 开关 → 初始化路由
    const extRoots = _resolveExtRoots(argv.extRoots, userExtRoot);
    const discovered = loadExtensions(extRoots, warn).extensions;
    const extensions = _applyExtFilter(discovered, argv, warn);
    for (const ext of extensions) {
        ext.router = initExtRouter(ext, { cliRoot: CLI_ROOT, dataDir, logger: warn });
    }
    const mounted = extensions.filter((e) => e.page || e.router);

    const server = http.createServer((req, res) => {
        _handleRequest(req, res, { webRoot, extensions, backend: argv.backend })
            .catch((err) => {
                process.stderr.write(`[3rdloop web] 请求处理异常: ${err.message}\n`);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                }
                if (!res.writableEnded) {
                    res.end(JSON.stringify({ success: false, message: 'internal error' }));
                }
            });
    });

    return await new Promise((resolve) => {
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                process.stderr.write(`[3rdloop web] 端口 ${argv.port} 已被占用（可用 --port 指定其他端口）\n`);
            } else {
                process.stderr.write(`[3rdloop web] 服务启动失败: ${err.message}\n`);
            }
            resolve(EXIT.ERROR);
        });

        server.listen(argv.port, () => {
            process.stderr.write(`[3rdloop web] 前端服务已启动: http://localhost:${argv.port}\n`);
            process.stderr.write(`[3rdloop web] 前端资产: ${webRoot}\n`);
            process.stderr.write(`[3rdloop web] 后端代理: ${argv.backend}（/api/*、/stream*）\n`);
            if (argv.noExt) {
                process.stderr.write('[3rdloop web] 扩展挂载已禁用（--no-ext）：仅核心工作台 + loop + knowledge\n');
            } else if (argv.extNames.length > 0) {
                if (mounted.length > 0) {
                    const desc = mounted.map((e) => `${e.mount}（${e.title}）`).join('、');
                    process.stderr.write(`[3rdloop web] 白名单挂载扩展 ${mounted.length}/${discovered.length} 个: ${desc}\n`);
                } else {
                    process.stderr.write(`[3rdloop web] 白名单未匹配到任何扩展（发现 ${discovered.length} 个，--ext: ${argv.extNames.join(', ')}）\n`);
                }
            } else if (mounted.length > 0) {
                const desc = mounted.map((e) => `${e.mount}（${e.title}）`).join('、');
                process.stderr.write(`[3rdloop web] 已挂载扩展 ${mounted.length} 个: ${desc}\n`);
            } else {
                process.stderr.write(
                    '[3rdloop web] 未挂载扩展（tag/issue/prcheck 等二级功能可用 "3rdloop web install-ext <dir>" 启用）\n'
                );
            }

            if (argv.open) _openBrowser(`http://localhost:${argv.port}`);
        });

        // 退出码与 CLI 约定对齐：130 SIGINT / 143 SIGTERM
        const shutdown = (code) => {
            process.stderr.write('\n[3rdloop web] 正在关闭…\n');
            server.close(() => process.exit(code));
            // 兜底：close 回调被长连接阻塞时强制退出
            setTimeout(() => process.exit(code), 1500).unref();
        };
        process.on('SIGINT', () => shutdown(130));
        process.on('SIGTERM', () => shutdown(143));
        // cmdWeb 的 Promise 不 resolve：服务常驻，退出走信号处理
    });
}

// ═══════════════════════════════════════════════════════════════════
// 请求路由
// ═══════════════════════════════════════════════════════════════════

async function _handleRequest(req, res, { webRoot, extensions, backend }) {
    const url = new URL(req.url, `http://localhost`);
    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        pathname = url.pathname;
    }
    const lower = pathname.toLowerCase();

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
// 子命令：install-ext / list-ext / remove-ext
// ═══════════════════════════════════════════════════════════════════

function _cmdInstallExt(srcDir, { userExtRoot, jsonMode, out }) {
    if (!srcDir) {
        process.stderr.write('用法: 3rdloop web install-ext <扩展目录>\n');
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

function _cmdListExt({ userExtRoot, jsonMode, out }) {
    const warn = (msg) => process.stderr.write(`${msg}\n`);
    const extRoots = _resolveExtRoots([], userExtRoot);
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
        process.stdout.write('仓库内置扩展源: <仓库>/Web/ext/，如 3rdloop web install-ext Web/ext/tag\n');
        return EXIT.OK;
    }

    process.stdout.write(`可用扩展（${items.length} 个）:\n`);
    for (const it of items) {
        process.stdout.write(`  ${it.name.padEnd(10)} ${it.mount.padEnd(12)} ${it.title}\n`);
        process.stdout.write(`  ${' '.repeat(10)} 来源: ${it.source}\n`);
    }
    return EXIT.OK;
}

function _cmdRemoveExt(name, { userExtRoot, jsonMode, out }) {
    if (!name) {
        process.stderr.write('用法: 3rdloop web remove-ext <扩展名>\n');
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

// ═══════════════════════════════════════════════════════════════════
// 帮助
// ═══════════════════════════════════════════════════════════════════

function _printWebHelp() {
    process.stdout.write(`
3rdloop web —— 启动 Web 前端服务（静态托管 + /api 反代 + 扩展挂载）

用法:
  3rdloop web [选项]                     启动前端服务
  3rdloop web install-ext <dir>          安装扩展到 ~/.3lib/3rdloop/web-ext/
  3rdloop web list-ext                   列出可用扩展（含来源与挂载点）
  3rdloop web remove-ext <name>          移除已安装扩展

选项:
  --port <N>          监听端口（默认 8080）
  --backend <url>     后端 Server 地址（默认 http://127.0.0.1:3000，/api/* 与 /stream* 反代）
  --web-root <dir>    核心前端资产目录覆盖（默认: 仓库 Web/public，发布包为内置 cli/web）
  --ext-root <dir>    追加扩展根目录（可多次指定；目录下每个子目录是一个扩展）
  --ext <name,...>    白名单：仅挂载指定扩展（逗号分隔，可重复指定；未发现的名字打警告）
  --no-ext            禁用全部扩展（纯后端操作模式；优先于 --ext）
  --open              启动后自动打开浏览器
  -h, --help          本帮助

两种典型模式:
  本地全功能（仓库开发态）:
      node cli/bin/3rdloop.mjs web
      = 核心前端（Web/public：PR/仓库检视 + loop + knowledge）+ 全部扩展（Web/ext：tag/issue/prcheck）
  纯后端操作（经 3rdloop，不受已安装扩展影响）:
      3rdloop web --no-ext
      = 仅核心工作台，导航栏不出现 tag/issue/prcheck 等二级功能入口

扩展机制:
  - 扩展 = 自包含目录（manifest.json + router.cjs + public/），提供 /tag、
    /issue、/prcheck 等二级目录功能，不随 npm 包分发
  - 加载来源优先级: --ext-root > 3LIB_WEB_EXT_ROOT > 仓库 Web/ext（开发态）> ~/.3lib/3rdloop/web-ext
  - 扩展数据目录: <数据目录>/web-ext/<name>（跟随 --data-dir）
  - 启用示例: 3rdloop web install-ext Web/ext/tag && 3rdloop web
  - 前端导航栏通过 /api/ext-registry 自动渲染已挂载扩展入口

环境变量:
  3LIB_WEB_ROOT         核心前端资产目录（等效 --web-root）
  3LIB_WEB_EXT_ROOT     用户扩展根目录（默认 ~/.3lib/3rdloop/web-ext）
`);
}
