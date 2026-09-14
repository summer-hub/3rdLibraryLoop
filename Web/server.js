import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Web 静态服务 + 反向代理
 *
 * 同机部署：用户只需访问此服务（默认 8080 端口）。
 *   - 静态页面由本服务托管
 *   - /api/* 反向代理到后端 Server（默认 http://127.0.0.1:3000，回环通信）
 *
 * 用法: node server.js [--port 8080] [--backend http://127.0.0.1:3000]
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 参数解析 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const backendIdx = args.indexOf('--backend');
const hostIdx = args.indexOf('--host');
const PORT = portIdx !== -1 ? Number(args[portIdx + 1]) : 8080;
const BACKEND = backendIdx !== -1 ? args[backendIdx + 1] : 'http://127.0.0.1:3000';
// F-02: 默认仅监听回环地址。对外暴露（--host 非回环）必须显式提供访问令牌，
// 否则全部 REST API 与 SSE 推送将对局域网/公网无鉴权开放。
const HOST = hostIdx !== -1 ? args[hostIdx + 1] : (process.env['3LIB_WEB_HOST'] || '127.0.0.1');
const ACCESS_TOKEN = String(process.env['3LIB_ACCESS_TOKEN'] || '').trim();
const TOKEN_COOKIE = '3lib_token';

// ─── MIME 类型 ─────────────────────────────────────────────────────────────
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.ico':  'image/x-icon'
};

// ─── F-02: 访问控制 ────────────────────────────────────────────────────────

/** 判断 host 是否为本机回环地址 */
function isLoopbackHost(host) {
    const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

/** 定长安全比较（避免时序侧信道；长度不同直接返回 false） */
function safeEqual(a, b) {
    const ba = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
}

/** 从 Authorization / X-Auth-Token / Cookie / query 中提取访问令牌 */
function extractToken(req, url) {
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
 * 令牌门禁。未配置令牌时直接放行（此时只可能监听回环地址，见启动前校验）。
 * 支持 `?token=` 一次性换取 HttpOnly Cookie 并 302 剥离 URL 中的令牌，
 * 使浏览器端可直接用 `http://host:8080/?token=xxx` 完成授权且令牌不留在地址栏。
 * @returns {boolean} 是否放行
 */
function enforceAuth(req, res, url) {
    if (!ACCESS_TOKEN) return true;

    const fromQuery = url.searchParams.get('token');
    if (fromQuery && safeEqual(fromQuery, ACCESS_TOKEN)) {
        const clean = new URL(url);
        clean.searchParams.delete('token');
        res.writeHead(302, {
            'Set-Cookie': `${TOKEN_COOKIE}=${encodeURIComponent(ACCESS_TOKEN)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
            'Location': clean.pathname + (clean.search || '')
        });
        res.end();
        return false;
    }

    if (safeEqual(extractToken(req, url), ACCESS_TOKEN)) return true;

    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
        success: false,
        message: '未授权：缺少或错误的访问令牌（请在环境变量 3LIB_ACCESS_TOKEN 中配置，并以 ?token= 打开一次页面完成授权）'
    }));
    return false;
}

/**
 * 反向代理：把 req 转发到后端，把响应回传给客户端。
 * 用于 /api/* 路径，实现同机回环通信。
 */
function proxyToBackend(req, res, backendUrl) {

    const target = new URL(req.url, backendUrl);
    const proxyReq = http.request(target, {
        method: req.method,
        headers: { ...req.headers, host: target.host }
    }, proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        // 上游（后端）关闭时，通知下游（浏览器），避免连接悬挂
        proxyRes.on('close', () => { if (!res.writableEnded) res.end(); });
    });

    proxyReq.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            status: 'error',
            message: `后端不可达: ${err.message}`,
            backend: backendUrl
        }));
    });

    // 浏览器断开（含 EventSource.close、页面关闭/刷新）时销毁上游连接，
    // 使后端 SseHub 能感知到连接关闭并正确清理连接计数，防止连接泄漏
    res.on('close', () => {
        if (!proxyReq.destroyed) proxyReq.destroy();
    });
    req.on('aborted', () => {
        if (!proxyReq.destroyed) proxyReq.destroy();
    });

    req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // ─── 访问门禁（配置了 3LIB_ACCESS_TOKEN 时生效）───────────────────
    // 必须置于所有路由之前：静态资源、扩展页面、/api/*、/stream* 全部受保护。
    if (!enforceAuth(req, res, url)) return;

    // ─── 反向代理 /api/* 和 /stream/* 到后端 ─────────────────────────
    if (pathname.startsWith('/api/') || pathname.startsWith('/stream')) {
        proxyToBackend(req, res, BACKEND);
        return;
    }

    // ─── 知识管理（独立视图，重定向到 knowledge 视图） ─────────────────
    if (pathname === '/knowledge' || pathname.startsWith('/knowledge/')) {
        res.writeHead(302, { 'Location': '/#knowledge' });
        res.end();
        return;
    }

    // ─── 旧版 loop.html 重定向到统一页面 ──────────────────────────────
    if (pathname === '/loop.html') {
        res.writeHead(302, { 'Location': '/#p-loop' });
        res.end();
        return;
    }

    // ─── 静态文件托管（默认页 index.html） ────────────────────────────
    const publicDir = path.join(__dirname, 'public');
    const filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
    // 防止路径穿越：按目录边界校验（前缀比较会被 public-evil 之类的同前缀目录绕过）
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

// ─── F-02: 对外暴露必须显式授权 ────────────────────────────────────────────
// 非回环地址意味着局域网/公网可达；而本服务会无反代 /api/* 与 /stream*，
// 一旦暴露且无令牌，等于把整套引擎 API 与实时事件流交给任何人操作。
if (!isLoopbackHost(HOST) && !ACCESS_TOKEN) {
    console.error(`[Web] 拒绝启动：--host ${HOST} 会对外暴露全部 API 与 SSE，但未配置访问令牌。`);
    console.error('[Web] 请二选一：');
    console.error('[Web]   1) 省略 --host（默认仅监听 127.0.0.1，仅供本机访问）；');
    console.error('[Web]   2) 设置环境变量 3LIB_ACCESS_TOKEN 后重试，并用 http://<host>:' + PORT + '/?token=<令牌> 完成授权。');
    process.exit(1);
}

server.listen(PORT, HOST, () => {
    const shown = isLoopbackHost(HOST) ? 'localhost' : HOST;
    console.log(`[Web] 静态服务已启动: http://${shown}:${PORT} （监听 ${HOST}）`);
    console.log(`[Web] 反向代理 /api/* → ${BACKEND}`);
    console.log(`[Web] 访问控制: ${ACCESS_TOKEN ? '已启用令牌门禁（3LIB_ACCESS_TOKEN）' : '未启用（仅回环地址可达）'}`);
    console.log(`[Web] 浏览器访问 http://${shown}:${PORT} 即可使用`);
    console.log('[Web] 提示: 本服务为纯静态托管，无 tag/issue/prcheck 扩展；全功能请用 node cli/bin/3rdloop.mjs web');
});
