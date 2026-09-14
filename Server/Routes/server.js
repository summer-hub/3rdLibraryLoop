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
 * HTTP 服务默认参数（F-13），均可经环境变量覆盖。
 *
 * 原实现没有设置任何一项，全部走 Node 默认值：
 *   - `requestTimeout` 默认 **300s**：SSE 长连接（/api/stream/*）在 5 分钟后被
 *     强制断开；
 *   - `headersTimeout` 默认 60s，与 keepAliveTimeout（默认 5s）关系不明确，
 *     慢客户端可能占用连接读头；
 *   - `maxConnections` 无上限，连接数完全由对端决定。
 */
const HTTP_LIMITS = Object.freeze({
    /** 并发连接上限：本服务仅监听回环，512 足以容纳浏览器多标签 + SSE + 本地 CLI 调用 */
    maxConnections: Number(process.env.MAX_CONNECTIONS) || 512,
    /**
     * 读头部超时：60s。给慢链路留下足够余量，同时避免连接长期停在"只连不请求"状态。
     * 与 Node 官方建议一致，取值需明显大于 keepAliveTimeout，避免 keep-alive 复用时
     * 服务端先关闭连接导致客户端收到 ECONNRESET。
     */
    headersTimeout: Number(process.env.HEADERS_TIMEOUT_MS) || 60_000,
    /** keep-alive 空闲超时：10s，高于 Node 默认 5s，减少前端轮询的连接重建开销 */
    keepAliveTimeout: Number(process.env.KEEP_ALIVE_TIMEOUT_MS) || 10_000,
    /**
     * 单个请求的整体超时：**0（关闭）**，这是有意为之、不可随意调大调小。
     *
     * 业务里存在合法且长命的请求：SSE 订阅（/api/stream/*，靠 30s 心跳保活，
     * 会话可能持续数小时）、以及"加载任务后同步等待编排步骤"类请求。Node 的
     * `requestTimeout` 计的是**整个请求**（从连上到响应结束）的时长，与"连接空闲"
     * 无关，因此任何非 0 取值都会在某条合法长请求上触发 408/连接中断——默认的 300s
     * 正是"SSE 5 分钟必断"的根因。
     *
     * 换个角度说：把 requestTimeout 设成一个"比最长合法请求还大"的值并不可靠——
     * SSE 的合法时长没有上界。真正需要防的是"连接闲置/慢速读头"，这已由
     * headersTimeout + keepAliveTimeout + 连接数上限覆盖；单个请求的耗时兜底属于
     * 业务层（Semaphore 获取超时、POLL_TIMEOUT_MS 轮询超时）职责。
     *
     * 如需外部兜底，可用 REQUEST_TIMEOUT_MS 显式启用（例如反向代理部署下的 30 分钟），
     * 但必须同步确认它大于所有 SSE 会话的最长预期时长。
     */
    requestTimeout: Number(process.env.REQUEST_TIMEOUT_MS) || 0,
});

/**
 * 创建并启动 HTTP 服务
 * @param {object} [options]
 * @param {number} [options.port=3000]          - 监听端口
 * @param {string} [options.cliType]            - CLI 类型，缺省时取环境变量 CLI_TYPE，仍未设置则 'deveco-code'
 * @param {object} [options.cliOptions={}]      - CLI 适配器配置
 * @param {CLIController} [options.cli]         - 已存在的 CLI 实例（优先于 cliType/cliOptions）
 * @param {number} [options.maxConnections]     - 并发连接上限（默认 512 / MAX_CONNECTIONS）
 * @param {number} [options.headersTimeout]     - 读头超时 ms（默认 60000 / HEADERS_TIMEOUT_MS）
 * @param {number} [options.keepAliveTimeout]   - keep-alive 空闲超时 ms（默认 10000 / KEEP_ALIVE_TIMEOUT_MS）
 * @param {number} [options.requestTimeout]     - 整请求超时 ms（默认 0=关闭 / REQUEST_TIMEOUT_MS）
 * @returns {Promise<http.Server>}
 */
export async function createServer(options = {}) {
    const {
        port = 3000,
        cliType = process.env.CLI_TYPE || 'deveco-code',
        cliOptions = {},
        cli = null,
        maxConnections = HTTP_LIMITS.maxConnections,
        headersTimeout = HTTP_LIMITS.headersTimeout,
        keepAliveTimeout = HTTP_LIMITS.keepAliveTimeout,
        requestTimeout = HTTP_LIMITS.requestTimeout
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

    // ─── 连接/超时加固（F-13）─────────────────────────────────────────
    // 逐项设置而非用 server.setTimeout() 统一覆盖：后者的语义（socket 空闲超时）
    // 会把 SSE 长连接一并算进去，等于换个方式把流式接口打死。
    server.maxConnections = maxConnections;
    server.headersTimeout = headersTimeout;
    server.keepAliveTimeout = keepAliveTimeout;
    // 0 = 不限制（见 HTTP_LIMITS.requestTimeout 的说明：SSE 合法时长无上界）
    server.requestTimeout = requestTimeout;

    // 连接数达到上限时 Node 会丢弃新连接并触发 dropRequest，静默丢弃会让前端
    // 只看到"请求没反应"，这里至少留下日志线索。
    server.on('dropRequest', (_req, _res) => {
        console.warn(`[Server] 连接数已达上限（maxConnections=${maxConnections}），请求被丢弃`);
    });

    console.log(
        `[Server] HTTP 加固: maxConnections=${server.maxConnections}, ` +
        `headersTimeout=${server.headersTimeout}ms, keepAliveTimeout=${server.keepAliveTimeout}ms, ` +
        `requestTimeout=${server.requestTimeout || '0(关闭)'}`
    );
    // 暴露实际生效的取值，便于运维核对/自动化测试断言
    server.httpLimits = { maxConnections, headersTimeout, keepAliveTimeout, requestTimeout };

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

        // ─── 优雅关闭（F-04）─────────────────────────────────────────────
        // 原实现只 destroy SSE + close storage 就 process.exit(0)，导致：
        //   - 在途编排被硬杀，远端 opencode 会话成为孤儿（无人 abort/回收）
        //   - 最后一次编排状态写入（_persistChain 在途）被丢弃
        // 现按「停收新请求 → 中止在途编排并等收尾 → 落盘 → 关存储」顺序收口，
        // 并有硬超时兜底，避免个别卡死步骤无限拖住停机。
        let shuttingDown = false;
        const gracefulShutdown = async ({ timeoutMs = 30000, exitCode = null } = {}) => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log('[Server] 正在关闭...');

            const hardTimer = setTimeout(() => {
                console.error(`[Server] 优雅关闭超时（${timeoutMs}ms），强制退出`);
                process.exit(exitCode ?? 0);
            }, timeoutMs);
            hardTimer.unref?.();

            try {
                // 1) 断开全部 SSE 长连接（否则 server.close() 会一直等到连接自然结束）
                sseHub.destroy();

                // 2) 停止接受新连接
                await new Promise((resolve) => {
                    server.close(() => resolve());
                    server.closeIdleConnections?.();
                });

                // 3) 中止在途编排并等待收尾（含远端会话中断、归档与回收）
                const budget = Math.max(1000, timeoutMs - 3000);
                const result = await orchestratorController.shutdown({ timeoutMs: budget });
                if (result.active > 0) {
                    console.log(
                        `[Server] 编排收尾完成: 活跃 ${result.active}/${result.total}，` +
                        `超时未收尾 ${result.timedOut} 个`
                    );
                }
            } catch (err) {
                console.error(`[Server] 关闭过程异常: ${err.message}`);
            } finally {
                try {
                    if (storage && typeof storage.close === 'function') {
                        await storage.close();
                    }
                } catch (err) {
                    console.error(`[Server] 关闭存储连接失败: ${err.message}`);
                }
                clearTimeout(hardTimer);
                console.log('[Server] 已关闭');
                if (exitCode != null) process.exit(exitCode);
            }
        };

        // 暴露给宿主（如 cli/lib/serve.js）：由其信号处理器调用后再以 130/143 退出，
        // 保证「CLI 的退出码约定」与「Server 的优雅收尾」两者兼得。
        server.gracefulShutdown = gracefulShutdown;

        const onSignal = () => { gracefulShutdown().catch(() => process.exit(0)); };
        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);
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
