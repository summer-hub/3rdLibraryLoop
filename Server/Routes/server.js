import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Router } from './router/Router.js';
import { registerRoutes } from './routes/index.js';
import { CLIController } from '../CLI/cli.js';
import SseHub from './sse/SseHub.js';
import FlexRunnerController from './controllers/FlexRunnerController.js';
import OrchestratorController from './controllers/OrchestratorController.js';
import BrainController from './controllers/BrainController.js';
import LoopEngineController from './controllers/LoopEngineController.js';
import { TestCheck } from '../TestCheck/index.js';
import { createStorage } from '../DbUse/index.js';
import { KnowledgeManager } from '../Knowledge/index.js';
import KnowledgeImportController from './controllers/KnowledgeImportController.js';

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
 *   node server.js --port 3000 --type deveco-code
 *   （也可用环境变量指定默认 CLI：CLI_TYPE=deveco-code node server.js --port 3000）
 */

/**
 * 创建并启动 HTTP 服务
 * @param {object} [options]
 * @param {number} [options.port=3000]          - 监听端口
 * @param {string} [options.cliType]            - CLI 类型，缺省时取环境变量 CLI_TYPE，仍未设置则 'deveco-code'
 * @param {object} [options.cliOptions={}]      - CLI 适配器配置
 * @param {CLIController} [options.cli]         - 已存在的 CLI 实例（优先于 cliType/cliOptions）
 * @returns {Promise<http.Server>}
 */
export async function createServer(options = {}) {
    const {
        port = 3000,
        cliType = process.env.CLI_TYPE || 'deveco-code',
        cliOptions = {},
        cli = null
    } = options;

    // ─── 组装共享依赖（单例，所有 Controller 复用）────────────────────
    const cliInstance = cli || new CLIController(cliType, cliOptions);
    const sseHub = new SseHub();
    const storage = createStorage();

    // OrchestratorController 同样有状态（管理多个编排器实例），需单例
    // skillDirectory：默认 SKILL 根目录，taskDef 未指定时兜底（供 specifiedSkill 解析 / 自动匹配）
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const skillDirectory = path.resolve(__dirname, '..', 'Skills');
    const orchestratorController = new OrchestratorController({
        sseHub,
        storage,
        flexRunnerFactory: null,
        skillDirectory
    });

    // FlexRunnerController 是有状态的（管理多个 FlexRunner 实例），需单例。
    // 注入 orchestratorController 使其能查找编排器创建的 FlexRunner 实例。
    // 注入 storage 使其在没有活跃 runner 时能直接读取 session 归档。
    const flexRunnerController = new FlexRunnerController({ orchestratorController, storage });

    // BrainController 管理 Brain 拆解实例（需单例，复用 LLM 连接）
    const brainController = new BrainController({
        sseHub,
        storage,
        orchestratorController,
        skillDirectory
    });

    // TestCheck 准出审核引擎（需单例，复用 LLM 连接和 SkillSelector）
    const testCheck = new TestCheck({
        sseHub,
        storage,
        skillDirectory
    });

    // LoopEngineController 管理大循环实例（需单例，依赖 Brain + Orchestrator + TestCheck）
    const loopEngineController = new LoopEngineController({
        sseHub,
        storage,
        brainController,
        orchestratorController,
        testCheck,
        skillDirectory
    });

    // KnowledgeManager 知识沉淀管理器（需单例，知识导入复用）
    const knowledgeManager = new KnowledgeManager();
    await knowledgeManager.init();

    // KnowledgeImportController 知识导入控制器（需单例，复用 CLI + KnowledgeManager）
    const knowledgeImportController = new KnowledgeImportController({
        cli: cliInstance,
        storage,
        skillDirectory,
        knowledgeManager,
        sseHub
    });

    const dependencies = {
        cli: cliInstance,
        sseHub,
        storage,
        flexRunnerController,
        orchestratorController,
        brainController,
        testCheck,
        loopEngineController,
        knowledgeManager,
        knowledgeImportController,
        skillDirectory
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
        server.listen(port, '127.0.0.1', async () => {
            console.log(`[Server] 服务已启动: http://127.0.0.1:${port}`);
            console.log(`[Server] 已注册路由:`);
            for (const route of router.routes) {
                console.log(`  ${route.method.padEnd(6)} ${route.path}`);
            }

            // ─── 从磁盘恢复持久化的编排任务 ────────────────────────────
            try {
                const { restored, failed } = await orchestratorController.restoreFromDisk();
                if (restored.length > 0) {
                    console.log(`[Server] 已恢复 ${restored.length} 个编排任务: ${restored.join(', ')}`);
                }
                if (failed.length > 0) {
                    console.warn(`[Server] ${failed.length} 个编排任务恢复失败: ${failed.join(', ')}`);
                }
            } catch (err) {
                console.warn(`[Server] 恢复编排任务异常: ${err.message}`);
            }

            resolve(server);
        });

        // ─── 优雅关闭：释放 SSE 连接 + 存储连接 ──────────────────────────
        const shutdown = () => {
            console.log('[Server] 正在关闭...');
            sseHub.destroy();
            server.close(() => {
                if (storage && typeof storage.close === 'function') {
                    storage.close().finally(() => process.exit(0));
                } else {
                    process.exit(0);
                }
            });
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
}

// ─── 直接运行入口 ──────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const portIdx = args.indexOf('--port');
    const typeIdx = args.indexOf('--type');
    const port = portIdx !== -1 ? Number(args[portIdx + 1]) : 3000;
    const cliType = typeIdx !== -1 ? args[typeIdx + 1] : (process.env.CLI_TYPE || 'deveco-code');

    createServer({ port, cliType }).catch(err => {
        console.error('[Server] 启动失败:', err);
        process.exit(1);
    });
}

export default createServer;
