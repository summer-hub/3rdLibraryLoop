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
     * 获取任务注册表（懒初始化）。
     * 用于历史任务列表的高性能分页查询（SQLite），避免逐个扫描 JSON 文件。
     * @returns {import('../../DbUse/stores/TaskRegistryStore.js').default|null}
     * @private
     */
    _getRegistry() {
        if (!this.storage) return null;
        try {
            return this.storage.taskRegistryStore();
        } catch {
            return null;
        }
    }

    /**
     * 注册任务摘要到注册表（幂等 upsert）。
     * @param {object} entry - { taskId, taskType, status, title, description, createdAt, metadata }
     * @returns {Promise<void>}
     * @private
     */
    async _registerTask(entry) {
        const registry = this._getRegistry();
        if (!registry) return;
        try {
            await registry.upsert(entry);
        } catch (err) {
            console.warn(`[LoopEngineController] 注册任务摘要失败: taskId=${entry.taskId}, error=${err.message}`);
        }
    }

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

            // 幂等保护：同一 taskId 若已有循环在运行中，直接返回，避免并发/重复启动
            const running = this._running.get(taskId);
            if (running) {
                return res.json({
                    status: 'ok',
                    message: `大循环已在运行中: taskId=${taskId}`,
                    taskId,
                    maxLoops,
                    progress: this._engines.has(taskId) ? this._engines.get(taskId).getProgress(taskId) : null
                });
            }

            // 若已存在同 taskId 的循环，先终止旧的（仅针对已结束/空闲的旧实例）
            if (this._engines.has(taskId)) {
                const oldEngine = this._engines.get(taskId);
                await oldEngine.abortLoop(taskId).catch(() => {});
            }

            const engine = this._createEngine();
            this._engines.set(taskId, engine);

            // 注册任务摘要到注册表（SQLite），供历史列表分页查询
            this._registerTask({
                taskId,
                taskType: 'loop',
                status: 'running',
                title: taskDescription.slice(0, 200),
                description: taskDescription,
                createdAt: new Date().toISOString(),
                metadata: { maxLoops, currentLoop: 0 }
            });

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
            }).finally(async () => {
                // 循环结束后清理运行标记，允许同一 taskId 后续重新启动
                this._running.delete(taskId);

                // 更新注册表中的任务状态为终态
                const engine = this._engines.get(taskId);
                if (engine) {
                    const ctx = engine.getLoop(taskId);
                    if (ctx) {
                        const terminalStates = [
                            LoopStatus.PASSED, LoopStatus.FAILED,
                            LoopStatus.ABORTED, LoopStatus.ABORTING, LoopStatus.ERROR
                        ];
                        if (terminalStates.includes(ctx.status)) {
                            await this._registerTask({
                                taskId,
                                taskType: 'loop',
                                status: ctx.status,
                                title: (ctx.taskDescription || '').slice(0, 200),
                                description: ctx.taskDescription || '',
                                createdAt: ctx.startTime || new Date().toISOString(),
                                metadata: {
                                    maxLoops: ctx.maxLoops,
                                    currentLoop: ctx.currentLoop,
                                    totalRounds: ctx.rounds.length,
                                    passed: ctx.status === LoopStatus.PASSED
                                }
                            });
                        }
                    }
                }

                // 释放该任务对应的 Orchestrator 重型引用（FlexRunner/LLM/CLI 等），防止内存泄露。
                // 保留 Orchestrator 轻量元信息与磁盘持久化，前端历史查看不受影响。
                if (this.orchestratorController) {
                    try {
                        this.orchestratorController.disposeOrchestrator(taskId);
                    } catch (err) {
                        console.warn(`[LoopEngineController] 释放 Orchestrator 失败: taskId=${taskId}, error=${err.message}`);
                    }
                }

                // 从内存移除已进入终态的大循环实例（PASSED/FAILED/ABORTED/ERROR）。
                // 历史列表由注册表提供，不依赖内存 _engines。
                if (engine) {
                    const terminalStates = [
                        LoopStatus.PASSED, LoopStatus.FAILED,
                        LoopStatus.ABORTED, LoopStatus.ABORTING, LoopStatus.ERROR
                    ];
                    const ctx = engine.getLoop(taskId);
                    if (ctx && terminalStates.includes(ctx.status)) {
                        this._engines.delete(taskId);
                    }
                }
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

            // ── 1b. 单次执行任务：检查 OrchestratorController 中是否有活跃编排 ──
            // 单次执行任务由 FlexRunnerController.startSingle 创建，编排器在 OrchestratorController 中。
            // 执行期间内存中没有 LoopEngine 实例，但 Orchestrator 正在运行。
            // 此时需要从 Orchestrator 实时获取进度，而非从磁盘 loop.json（可能已过时）。
            if (this.orchestratorController) {
                let orch;
                try {
                    orch = this.orchestratorController._getOrchestrator(taskId);
                } catch { /* 不存在，继续 */ }

                if (orch) {
                    const orchProgress = orch.getProgress();
                    // 判断是否为单次执行（步骤数为 1 且 loopCount === 0）
                    const isSingle = orchProgress &&
                        Array.isArray(orchProgress.steps) && orchProgress.steps.length === 1;

                    if (isSingle) {
                        // 构造兼容 LoopEngine.getProgress 的响应格式
                        const loopProgress = {
                            taskId,
                            status: orchProgress.status === 'running' ? 'executing'
                                : (orchProgress.status === 'aborting' ? 'aborting'
                                : (orchProgress.status === 'completed' ? 'passed'
                                : (orchProgress.status === 'aborted' ? 'aborted'
                                : (orchProgress.status === 'failed' ? 'failed' : orchProgress.status)))),
                            currentLoop: 1,
                            maxLoops: 1,
                            startTime: orchProgress.startTime,
                            endTime: orchProgress.endTime,
                            error: orchProgress.error,
                            isSingleExecution: true,
                            rounds: [{
                                loop: 0,
                                passed: orchProgress.status === 'completed',
                                startTime: orchProgress.startTime,
                                endTime: orchProgress.endTime,
                                error: orchProgress.error,
                                planningPlanId: null,
                                planningIsReplan: false,
                                planningStepCount: 1,
                                planningIntent: null,
                                planningDomain: null,
                                planningComplexity: null,
                                planningFailureAnalysis: null,
                                planningAdjustmentStrategy: null,
                                orchestratorStatus: orchProgress.status,
                                checkSummary: null,
                                checkPassed: null,
                                checkStatus: null,
                                checkId: null,
                                checkSessionId: null
                            }]
                        };
                        return res.json({ status: 'ok', progress: loopProgress });
                    }
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
     * 列出所有大循环任务（分页，注册表优先）。
     *
     * 数据来源：
     *   1. SQLite 注册表（db/TaskRegistry/registry.db）— 高性能分页，优先使用
     *   2. 内存中活跃的 LoopEngine 实例 — 合并运行中任务（覆盖注册表状态）
     *   3. 持久化扫描 JSON 文件 — 兜底（注册表不存在时使用）
     *
     * Query 参数：
     *   page     - 页码，从 1 开始（默认 1）
     *   pageSize - 每页条数（默认 20，最大 100）
     *   status   - 可选，按状态过滤
     *
     * 响应格式：
     *   { status, tasks: [...], total, page, pageSize, totalPages }
     */
    async list(req, res) {
        const query = req.query || {};
        const page = Math.max(1, parseInt(query.page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
        const statusFilter = query.status || null;

        // ── 优先方案：从注册表分页查询 ──
        const registry = this._getRegistry();
        if (registry) {
            try {
                // 从注册表获取分页数据
                const result = await registry.listPage({
                    page,
                    pageSize,
                    status: statusFilter,
                    taskType: 'loop'
                });

                // 合并内存中活跃任务的状态（覆盖注册表中的"running"状态为最新值）
                const mergedTasks = result.tasks.map(t => {
                    const memEngine = this._engines.get(t.task_id);
                    if (memEngine) {
                        const ctx = memEngine.getLoop(t.task_id);
                        if (ctx) {
                            return {
                                ...t,
                                taskId: t.task_id,
                                status: ctx.status,
                                currentLoop: ctx.currentLoop,
                                maxLoops: ctx.maxLoops,
                                startTime: ctx.startTime,
                                endTime: ctx.endTime,
                                taskDescription: t.description
                            };
                        }
                    }
                    return {
                        ...t,
                        taskId: t.task_id,
                        currentLoop: t.metadata?.currentLoop ?? 0,
                        maxLoops: t.metadata?.maxLoops ?? 3,
                        startTime: t.created_at,
                        taskDescription: t.description
                    };
                });

                // 如果第一页，还要把活跃但不在注册表中的任务加进去（如刚启动注册表写入延迟）
                if (page === 1) {
                    const existingIds = new Set(result.tasks.map(t => t.task_id));
                    for (const engine of this._engines.values()) {
                        for (const ctx of engine.getLoops()) {
                            if (!existingIds.has(ctx.taskId)) {
                                mergedTasks.unshift({
                                    task_id: ctx.taskId,
                                    task_type: 'loop',
                                    status: ctx.status,
                                    title: (ctx.taskDescription || '').slice(0, 200),
                                    description: ctx.taskDescription || '',
                                    created_at: ctx.startTime || new Date().toISOString(),
                                    updated_at: null,
                                    metadata: { currentLoop: ctx.currentLoop, maxLoops: ctx.maxLoops },
                                    taskId: ctx.taskId,
                                    currentLoop: ctx.currentLoop,
                                    maxLoops: ctx.maxLoops,
                                    startTime: ctx.startTime,
                                    endTime: ctx.endTime,
                                    taskDescription: ctx.taskDescription || ''
                                });
                            }
                        }
                    }
                }

                return res.json({
                    status: 'ok',
                    tasks: mergedTasks,
                    loops: mergedTasks,          // 向后兼容：前端 loop.js 期望 d.loops
                    total: result.total,
                    page: result.page,
                    pageSize: result.pageSize,
                    totalPages: result.totalPages
                });
            } catch (err) {
                console.warn('[LoopEngineController] 注册表查询失败，降级到磁盘扫描:', err.message);
                // 降级到磁盘扫描
            }
        }

        // ── 降级方案：内存 + 磁盘扫描（向后兼容） ──
        try {
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
                        passed: ctx.status === LoopStatus.PASSED,
                        isSingleExecution: false,
                        taskDescription: ctx.taskDescription || ''
                    });
                }
            }

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
                        if (statusFilter && data.status !== statusFilter) continue;

                        summaries.push({
                            taskId: data.taskId,
                            status: data.status || LoopStatus.IDLE,
                            currentLoop: data.currentLoop || 0,
                            maxLoops: data.maxLoops || 3,
                            startTime: data.startTime || null,
                            endTime: data.endTime || null,
                            passed: data.status === LoopStatus.PASSED,
                            isSingleExecution: data.isSingleExecution || false,
                            taskDescription: data.taskDescription || ''
                        });
                    } catch {
                        try {
                            const orchFile = join(taskRoot, entry.name, 'orchestration.json');
                            const orchRaw = await fs.readFile(orchFile, 'utf8');
                            const orchData = JSON.parse(orchRaw);
                            if (!orchData || !orchData.taskId) continue;
                            if (memTaskIds.has(orchData.taskId)) continue;
                            if (statusFilter && orchData.status !== statusFilter) continue;

                            summaries.push({
                                taskId: orchData.taskId,
                                status: orchData.status || LoopStatus.IDLE,
                                currentLoop: orchData.loopCount || 0,
                                maxLoops: 3,
                                startTime: orchData.startTime || null,
                                endTime: orchData.endTime || null,
                                passed: orchData.status === 'passed',
                                isSingleExecution: false,
                                taskDescription: ''
                            });
                        } catch { /* skip */ }
                    }
                }
            } catch (err) {
                console.warn('[LoopEngineController] 扫描持久化任务失败:', err.message);
            }

            summaries.sort((a, b) => {
                const ta = a.startTime || '';
                const tb = b.startTime || '';
                return tb.localeCompare(ta);
            });

            // 降级方案也做分页
            const total = summaries.length;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const offset = (page - 1) * pageSize;
            const paged = summaries.slice(offset, offset + pageSize);

            return res.json({
                status: 'ok',
                tasks: paged,
                loops: paged,                   // 向后兼容：前端 loop.js 期望 d.loops
                total,
                page,
                pageSize,
                totalPages
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
                // ── 单次执行任务：委托 OrchestratorController 终止 ──
                // 单次执行任务由 FlexRunnerController.startSingle 创建，
                // 编排器实例在 OrchestratorController 中管理，不在 LoopEngine 中。
                if (this.orchestratorController) {
                    let orch;
                    try {
                        orch = this.orchestratorController._getOrchestrator(taskId);
                    } catch {
                        return res.error(404, `未找到大循环任务: taskId=${taskId}`);
                    }
                    const ok = await orch.abort();
                    res.json({
                        status: ok ? 'ok' : 'error',
                        message: ok
                            ? '终止请求已发出，正在终止运行中的会话...'
                            : '终止失败（可能已结束）',
                        taskId
                    });
                    return;
                }
                return res.error(404, `未找到大循环任务: taskId=${taskId}`);
            }

            const ok = await engine.abortLoop(taskId);

            // 注意：不在此处 disposeOrchestrator —— 终止是异步生效的：
            // Orchestrator._scheduleLoop / FlexRunner 轮询需要继续运行才能感知终止标志
            // 并完成收尾（markFinished + persistState + 远程 abortSession）。
            // Orchestrator 的重型引用由 startLoop 的 finally 收尾统一释放。

            // 响应只表示"终止请求已受理"，真正的终态以 getProgress / SSE loop:aborted 为准
            res.json({
                status: ok ? 'ok' : 'error',
                message: ok ? '终止请求已发出，正在终止运行中的会话...' : '终止失败（可能已结束）',
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
     * GET /api/loopengine/check-session?taskId=xxx&loop=N
     * 获取指定轮次 TestCheck 准出审核的 session 对话归档。
     *
     * Query: { taskId, loop }
     *
     * 数据来源优先级：
     *   1. 内存中运行中的 LoopEngine（round.checkResult.sessionId）
     *   2. 持久化的 loop.json（round.checkSessionId）
     *   3. 持久化的 testcheck_loopN.json（result.sessionId）
     *
     * 获取 sessionId 后通过 SessionStore 读取归档消息。
     */
    async checkSession(req, res) {
        const taskId = req.query?.taskId;
        const loop = req.query?.loop != null ? Number(req.query.loop) : 0;

        if (!taskId) {
            return res.error(400, 'taskId 为必填项');
        }

        try {
            let sessionId = null;

            // ── 1. 优先从内存获取 ──
            const engine = this._engines.get(taskId);
            if (engine) {
                const ctx = engine.getLoop(taskId);
                if (ctx && ctx.rounds[loop]) {
                    sessionId = ctx.rounds[loop].checkResult?.sessionId || null;
                }
            }

            // ── 2. 从持久化 loop.json 获取 ──
            if (!sessionId) {
                const storage = this._getStorage();
                const json = storage.json('task');
                const state = await json.read(`${taskId}/loop`);
                if (state && Array.isArray(state.rounds) && state.rounds[loop]) {
                    sessionId = state.rounds[loop].checkSessionId || null;
                }
            }

            // ── 3. 从 testcheck_loopN.json 获取 ──
            if (!sessionId) {
                const storage = this._getStorage();
                const json = storage.json('task');
                const checkResult = await json.read(`${taskId}/testcheck_loop${loop}`);
                if (checkResult && checkResult.sessionId) {
                    sessionId = checkResult.sessionId;
                }
            }

            if (!sessionId) {
                return res.error(404, `未找到第 ${loop + 1} 轮审核的 sessionId`);
            }

            // ── 通过 SessionStore 读取归档消息 ──
            const storage = this._getStorage();
            const sessionStore = storage.sessionStore();

            const [meta, messages] = await Promise.all([
                sessionStore.readMeta(sessionId).catch(() => null),
                sessionStore.readMessages(sessionId).catch(() => [])
            ]);

            res.json({
                status: 'ok',
                sessionId,
                meta,
                messages
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
                ctx.status === LoopStatus.CHECKING ||
                ctx.status === LoopStatus.ABORTING
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
