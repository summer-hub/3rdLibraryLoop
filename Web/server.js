import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
const PORT = portIdx !== -1 ? Number(args[portIdx + 1]) : 8080;
const BACKEND = backendIdx !== -1 ? args[backendIdx + 1] : 'http://127.0.0.1:3000';

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
    });

    proxyReq.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            status: 'error',
            message: `后端不可达: ${err.message}`,
            backend: backendUrl
        }));
    });

    req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // ─── 反向代理 /api/* 和 /stream/* 到后端 ─────────────────────────
    if (pathname.startsWith('/api/') || pathname.startsWith('/stream')) {
        proxyToBackend(req, res, BACKEND);
        return;
    }

    // ─── 静态文件托管 ─────────────────────────────────────────────────
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    // 防止路径穿越
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
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

server.listen(PORT, () => {
    console.log(`[Web] 静态服务已启动: http://localhost:${PORT}`);
    console.log(`[Web] 反向代理 /api/* → ${BACKEND}`);
    console.log(`[Web] 浏览器访问 http://localhost:${PORT} 即可使用`);
});
