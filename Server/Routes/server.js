import http from 'node:http';
import { Router } from './router/Router.js';
import { registerRoutes } from './routes/index.js';
import { CLIController } from '../CLI/cli.js';
import SseHub from './sse/SseHub.js';

/**
 * Server —— HTTP 服务入口
 *
 * 架构分层：
 *   Router（路由匹配） → routes/index.js（路由注册） → controllers/*（业务逻辑）
 *
 * 职责：
 *  - 创建并启动 HTTP 服务（仅绑定 127.0.0.1，同机回环）
 *  - 组装共享依赖（CLIController 等单例）
 *  - 将请求委派给 Router
 *
 * 用法：
 *   import { createServer } from './Server/Routes/server.js';
 *   const server = await createServer({ port: 3000 });
 *
 * 或直接运行：
 *   node server.js --port 3000 --type opencode
 */

/**
 * 创建并启动 HTTP 服务
 * @param {object} [options]
 * @param {number} [options.port=3000]          - 监听端口
 * @param {string} [options.cliType='opencode'] - CLI 类型
 * @param {object} [options.cliOptions={}]      - CLI 适配器配置
 * @param {CLIController} [options.cli]         - 已存在的 CLI 实例（优先于 cliType/cliOptions）
 * @returns {Promise<http.Server>}
 */
export async function createServer(options = {}) {
    const {
        port = 3000,
        cliType = 'opencode',
        cliOptions = {},
        cli = null
    } = options;

    // ─── 组装共享依赖（单例，所有 Controller 复用）────────────────────
    const cliInstance = cli || new CLIController(cliType, cliOptions);
    const sseHub = new SseHub();

    const dependencies = {
        cli: cliInstance,
        sseHub
        // taskStepStore: ...,   // 未来：TaskStepStore 单例
    };

    // ─── 初始化路由器并注册路由 ────────────────────────────────────────
    const router = new Router();
    registerRoutes(router, dependencies);

    // ─── 创建 HTTP 服务 ───────────────────────────────────────────────
    const server = http.createServer(async (req, res) => {
        try {
            const matched = await router.handle(req, res);
            if (!matched) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Not Found', path: req.url }));
            }
        } catch (err) {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: `内部错误: ${err.message}` }));
            }
        }
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            console.log(`[Server] 服务已启动: http://127.0.0.1:${port}`);
            console.log(`[Server] 已注册路由:`);
            for (const route of router.routes) {
                console.log(`  ${route.method.padEnd(6)} ${route.path}`);
            }
            resolve(server);
        });

        // ─── 优雅关闭：释放 SSE 连接 ────────────────────────────────────
        const shutdown = () => {
            console.log('[Server] 正在关闭...');
            sseHub.destroy();
            server.close(() => process.exit(0));
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
}

// ─── 直接运行入口 ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const portIdx = args.indexOf('--port');
    const typeIdx = args.indexOf('--type');
    const port = portIdx !== -1 ? Number(args[portIdx + 1]) : 3000;
    const cliType = typeIdx !== -1 ? args[typeIdx + 1] : 'opencode';

    createServer({ port, cliType }).catch(err => {
        console.error('[Server] 启动失败:', err);
        process.exit(1);
    });
}

export default createServer;
