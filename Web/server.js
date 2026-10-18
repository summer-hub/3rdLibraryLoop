#!/usr/bin/env node
/**
 * Web/server.js —— **兼容入口**（本文件不再自带实现）
 *
 * 历史：这里曾有一份独立的"静态托管 + /api 反代 + 令牌门禁"实现（约 190 行），与
 * `cli/lib/web.js` 的 `startWebServer`（`3rdloop serve` 用的那份）**逐段重复**：
 * 限绑回环、非回环必须带令牌、`?token=` 换 Cookie 并 302、`/api` 与 `/stream` 反代……
 * 两份实现的漂移风险是真实的——任一侧改了门禁或反代语义，另一侧不会跟着变，而
 * `test/m1/f02` 恰好同时测它们。现在**只有一份实现**，本文件只做参数映射与启停：
 *
 *   node Web/server.js [--port 8080] [--backend http://127.0.0.1:3000] [--host <addr>] [--no-ext]
 *
 * 语义与 `3rdloop serve` 完全一致：
 *   - 默认只监听 127.0.0.1（回环）；
 *   - `--host` 非回环必须配 `3LIB_ACCESS_TOKEN`，否则**拒绝启动并 exit 1**
 *     （该服务无反代鉴权兜底：对外可达等于交出引擎 API 与实时事件流）；
 *   - `?token=<令牌>` 一次性换取 HttpOnly Cookie 并 302 剥离地址栏里的令牌；
 *   - 扩展（`<核心树>/Web/ext`）自动发现，`--no-ext` 全关。
 */
import os from 'node:os';
import path from 'node:path';
import { resolveUserExtRoot, startWebServer } from '../cli/lib/web.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = '') => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? (argv[i + 1] ?? fallback) : fallback;
};

const port = Number(flag('port', '8080')) || 8080;
const backend = flag('backend', 'http://127.0.0.1:3000');
const host = flag('host', '');
const noExt = argv.includes('--no-ext');

const user3libHome = path.join(os.homedir(), '.3lib');
const dataDir = process.env['3LIB_DATA_DIR'] || path.join(user3libHome, '3rdloop', 'db');

try {
    const server = await startWebServer({
        port,
        backend,
        host,
        noExt,
        userExtRoot: resolveUserExtRoot(user3libHome),
        dataDir,
        tag: 'Web/server.js',
    });
    // 常驻服务：自己管理生命周期（startWebServer 刻意不注册信号处理）
    const stop = () => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.stdout.write(
        `[Web/server.js] 前端已启动: http://${host || '127.0.0.1'}:${port}（/api、/stream 反代 → ${backend}）\n`
    );
} catch (err) {
    process.stderr.write(`[Web/server.js] ${err?.message ?? err}\n`);
    process.exit(1);
}
