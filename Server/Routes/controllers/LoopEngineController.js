/**
 * LoopEngineController —— 大循环协调引擎 HTTP 接口控制器
 *
 * 职责：封装 LoopEngine 的 HTTP 接口，供前端启动大循环、查询进度、终止循环。
 * 不感知 HTTP 层细节，只接收 RequestContext / ResponseContext。
 *
 * 管理多个 LoopEngine 实例（按 taskId 区分），支持：
 *   - 启动大循环（Brain → Orchestrator → TestCheck 完整闭环）
 *   - 查询循环进度
 *   - 终止大循环
 *   - 恢复循环状态
 *
 * 架构位置：
 *   HTTP 请求 → LoopEngineController → LoopEngine → { Brain, Orchestrator, TestCheck }
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { LoopEngine, LoopStatus } from '../../LoopEngine/index.js';

/**
 * LoopEngineController
 */
class LoopEngineController {
    /**
     * @param {object} [deps] - 共享依赖
     * @param {object}   [deps.sseHub]                - SseHub 实例
     * @param {object}   [deps.storage]               - 存储门面
     * @param {object}   [deps.brainController]       - BrainController 实例（必须）
     * @param {object}   [deps.orchestratorController]- OrchestratorController 实例（必须）
     * @param {object}   [deps.testCheck]             - TestCheck 实例（可选）
     * @param {string}   [deps.skillDirectory]        - SKILL 目录路径
     */
    constructor(deps = {}) {
        this.sseHub = deps.sseHub || null;
        this.storage = deps.storage || null;
        this.brainController = deps.brainController || null;
        this.orchestratorController = deps.orchestratorController || null;
        this.testCheck = deps.testCheck || null;
        this.skillDirectory = deps.skillDirectory || null;

        /** @type {Map<string, LoopEngine>} key = taskId */
        this._engines = new Map();

        /** @type {Map<string, Promise>} key = taskId，跟踪正在运行的循环 */
        this._running = new Map();
    }

    // ─── 辅助方法 ──────────────────────────────────────────────────────

    /**
     * 获取已有实例，不存在则报错。
     * @param {string} taskId
     * @returns {LoopEngine}
     */
    _getEngine(taskId) {
        const engine = this._engines.get(taskId);
        if (!engine) {
            throw new Error(`未找到大循环任务: taskId=${taskId}，请先启动循环`);
        }
        return engine;
    }

    /**
     * 创建新的 LoopEngine 实例。
     * @returns {LoopEngine}
     */
    _createEngine() {
        return new LoopEngine({
            sseHub: this.sseHub,
            storage: this.storage,
            brainController: this.brainController,
            orchestratorController: this.orchestratorController,
            testCheck: this.testCheck,
            skillDirectory: this.skillDirectory
        });
    }

    /**
     * 获取存储门面。优先用注入的 storage，否则从 LoopEngine 创建。
     * @returns {object}
     * @private
     */
    _getStorage() {
        if (this.storage) return this.storage;
        // fallback：创建一个临时 LoopEngine 仅为获取 storage
        const tmp = this._createEngine();
        this.storage = tmp.storage;
        return this.storage;
    }

    // ─── HTTP Handlers ─────────────────────────────────────────────────

    /**
     * POST /api/loopengine/start
     * 启动大循环 — 从自然语言任务描述开始，执行完整的拆解→编排→审核闭环。
     *
     * Body: {
     *   taskDescription: string,       // 必填，自然语言任务描述
     *   taskId?: string,               // 可选，指定 taskId
     *   taskDir?: string,              // 可选，指定工作目录
     *   skillDirectory?: string,       // 可选，覆盖 SKILL 目录
     *   acceptanceCriteria?: string,   // 可选，用户提供的验收标准
     *   maxLoops?: number              // 可选，最大循环次数（默认 3）
     * }
     *
     * 响应：异步启动，立即返回 taskId 和初始状态。
     * 前端通过 SSE 或 GET /progress 轮询进度。
     */
    async start(req, res) {
        const body = req.body || {};
        const { taskDescription } = body;

        if (!taskDescription) {
            return res.error(400, 'taskDescription 为必填项');
        }
        if (!this.brainController) {
            return res.error(500, 'brainController 未初始化');
        }
        if (!this.orchestratorController) {
            return res.error(500, 'orchestratorController 未初始化');
        }

        const maxLoops = typeof body.maxLoops === 'number' && body.maxLoops > 0
            ? body.maxLoops
            : 3;

        try {
            // 生成 taskId（如果未指定）
            const taskId = body.taskId || `task_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;

            // 若已存在同 taskId 的循环，先终止旧的
            if (this._engines.has(taskId)) {
                const oldEngine = this._engines.get(taskId);
                await oldEngine.abortLoop(taskId).catch(() => {});
            }

            const engine = this._createEngine();
            this._engines.set(taskId, engine);

            // 异步启动大循环，不阻塞 HTTP 响应
            const loopPromise = engine.startLoop({
                taskDescription,
                taskId,
                taskDir: body.taskDir,
                skillDirectory: body.skillDirectory,
                acceptanceCriteria: body.acceptanceCriteria,
                maxLoops
            }).catch(err => {
                console.error(`[LoopEngineController] taskId=${taskId} 大循环异常:`, err.message);
            });

            this._running.set(taskId, loopPromise);

            res.json({
                status: 'ok',
                message: `大循环已启动: taskId=${taskId}`,
                taskId,
                maxLoops,
                progress: engine.getProgress(taskId)
            });

        } catch (err) {
            res.error(400, err.message);
        }
    }

    /**
     * GET /api/loopengine/progress
     * 查询大循环进度。
     *
     * Query: { taskId }
     */
    async progress(req, res) {
        const taskId = req.query?.taskId || req.body?.taskId;

        if (!taskId) {
            return res.error(400, 'taskId 为必填项');
        }

        try {
            // ── 1. 优先从内存获取（运行中的任务） ──
            let engine = this._engines.get(taskId);

            if (engine) {
                const progress = engine.getProgress(taskId);
                if (progress) {
                    return res.json({ status: 'ok', progress });
                }
            }

            // ── 2. 内存没有，从持久化恢复 ──
            if (!engine) {
                engine = this._createEngine();
                const ctx = await engine.restoreLoop(taskId);
                if (ctx) {
                    this._engines.set(taskId, engine);
                    return res.json({ status: 'ok', progress: engine.getProgress(taskId) });
                }
            }

            return res.error(404, `未找到大循环任务: taskId=${taskId}`);
        } catch (err) {
            res.error(400, err.message);
        }
    }

    /**
     * GET /api/loopengine/list
     * 列出所有大循环任务。
     *
     * 数据来源：
     *   1. 内存中活跃的 LoopEngine 实例（运行中 / 刚结束）
     *   2. 持久化存储 db/task/{taskId}/loop.json（历史任务，服务重启后恢复）
     *
     * 合并去重：同一 taskId 内存优先。
     */
    async list(req, res) {
        try {
            // ── 1. 收集内存中的任务 ──
            const memTaskIds = new Set();
            const summaries = [];

            for (const engine of this._engines.values()) {
                for (const ctx of engine.getLoops()) {
                    memTaskIds.add(ctx.taskId);
                    summaries.push({
                        taskId: ctx.taskId,
                        status: ctx.status,
                        currentLoop: ctx.currentLoop,
                        maxLoops: ctx.maxLoops,
                        startTime: ctx.startTime,
                        endTime: ctx.endTime,
                        passed: ctx.status === LoopStatus.PASSED
                    });
                }
            }

            // ── 2. 从持久化存储扫描历史任务 ──
            // loop.json 存储在 db/task/{taskId}/loop.json（子目录中），
            // 直接用 fs 递归扫描 task 目录下的子目录
            try {
                const storage = this._getStorage();
                const taskRoot = join(storage.manager.rootDir, 'task');

                const entries = await fs.readdir(taskRoot, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const loopFile = join(taskRoot, entry.name, 'loop.json');
                    try {
                        const raw = await fs.readFile(loopFile, 'utf8');
                        const data = JSON.parse(raw);
                        if (!data || !data.taskId) continue;
                        if (memTaskIds.has(data.taskId)) continue;

                        summaries.push({
                            taskId: data.taskId,
                            status: data.status || LoopStatus.IDLE,
                            currentLoop: data.currentLoop || 0,
                            maxLoops: data.maxLoops || 3,
                            startTime: data.startTime || null,
                            endTime: data.endTime || null,
                            passed: data.status === LoopStatus.PASSED
                        });
                    } catch { /* 单个文件读取失败跳过 */ }
                }
            } catch (err) {
                // 持久化扫描失败不阻塞，仅记日志
                console.warn('[LoopEngineController] 扫描持久化任务失败:', err.message);
            }

            // ── 3. 按开始时间倒序排列 ──
            summaries.sort((a, b) => {
                const ta = a.startTime || '';
                const tb = b.startTime || '';
                return tb.localeCompare(ta);
            });

            res.json({
                status: 'ok',
                total: summaries.length,
                loops: summaries
            });
        } catch (err) {
            res.error(500, `列举大循环任务失败: ${err.message}`);
        }
    }

    /**
     * POST /api/loopengine/abort
     * 终止大循环。
     *
     * Body: { taskId }
     */
    async abort(req, res) {
        const body = req.body || {};
        const { taskId } = body;

        if (!taskId) {
            return res.error(400, 'taskId 为必填项');
        }

        try {
            const engine = this._engines.get(taskId);
            if (!engine) {
                return res.error(404, `未找到大循环任务: taskId=${taskId}`);
            }

            const ok = await engine.abortLoop(taskId);
            res.json({
                status: ok ? 'ok' : 'error',
                message: ok ? '大循环已终止' : '终止失败（可能已结束）',
                taskId
            });
        } catch (err) {
            res.error(400, err.message);
        }
    }

    /**
     * POST /api/loopengine/restore
     * 从持久化文件恢复大循环状态。
     *
     * Body: { taskId }
     */
    async restore(req, res) {
        const body = req.body || {};
        const { taskId } = body;

        if (!taskId) {
            return res.error(400, 'taskId 为必填项');
        }

        try {
            // 如果已有运行中的实例，直接返回
            if (this._engines.has(taskId)) {
                return res.json({
                    status: 'ok',
                    message: '大循环已在运行中',
                    taskId,
                    progress: this._engines.get(taskId).getProgress(taskId)
                });
            }

            const engine = this._createEngine();
            const ctx = await engine.restoreLoop(taskId);

            if (!ctx) {
                return res.error(404, `未找到持久化的大循环状态: taskId=${taskId}`);
            }

            this._engines.set(taskId, engine);
            res.json({
                status: 'ok',
                message: '大循环状态已恢复',
                taskId,
                progress: engine.getProgress(taskId)
            });
        } catch (err) {
            res.error(400, err.message);
        }
    }

    /**
     * GET /api/loopengine/status
     * 获取 LoopEngineController 当前状态。
     */
    async status(req, res) {
        const activeLoops = Array.from(this._engines.values()).map(engine => {
            const loops = engine.getLoops();
            return loops.filter(ctx =>
                ctx.status === LoopStatus.PLANNING ||
                ctx.status === LoopStatus.EXECUTING ||
                ctx.status === LoopStatus.CHECKING
            ).map(ctx => ({
                taskId: ctx.taskId,
                status: ctx.status,
                currentLoop: ctx.currentLoop,
                maxLoops: ctx.maxLoops
            }));
        }).flat();

        res.json({
            status: 'ok',
            totalEngines: this._engines.size,
            activeLoops,
            runningPromises: this._running.size
        });
    }
}

export default LoopEngineController;
