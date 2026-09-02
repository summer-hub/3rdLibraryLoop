/**
 * OrchestratorController —— 编排器 HTTP 接口控制器
 *
 * 职责：封装 Orchestrator 的 HTTP 接口，供前端进行任务编排和进度查看。
 * 不感知 HTTP 层细节，只接收 RequestContext / ResponseContext。
 *
 * 管理多个 Orchestrator 实例（按 taskId 区分），支持：
 *   - 加载任务定义
 *   - 启动 / 暂停 / 恢复 / 终止编排
 *   - 查询编排进度
 *   - 查询步骤执行细节（实时消息 / 会话内容）
 *   - 修改未执行步骤的配置
 *
 * 与 FlexRunnerController 的区别：
 *   - FlexRunnerController 管理单个步骤的执行
 *   - OrchestratorController 管理多步骤的编排调度
 */

import path from 'node:path';
import fs from 'node:fs';
import { Orchestrator, OrchestratorStatus } from '../../Orchestrator/Orchestrator.js';
import { StorageManager } from '../../DbUse/index.js';

/**
 * OrchestratorController
 */
class OrchestratorController {
    /**
     * @param {object} [deps] - 共享依赖
     * @param {object} [deps.sseHub]   - SseHub 实例
     * @param {object} [deps.storage]  - 存储门面
     * @param {function} [deps.flexRunnerFactory] - FlexRunner 工厂（测试用）
     * @param {string} [deps.skillDirectory] - 默认 SKILL 根目录（taskDef 未指定 skillDirectory 时兜底）
     */
    constructor(deps = {}) {
        this.sseHub = deps.sseHub || null;
        this.storage = deps.storage || null;
        this.flexRunnerFactory = deps.flexRunnerFactory || null;
        this.skillDirectory = deps.skillDirectory || '';

        /** @type {Map<string, Orchestrator>} key = taskId */
        this._orchestrators = new Map();
    }

    // ─── 辅助方法 ──────────────────────────────────────────────────────

    /**
     * 获取任务注册表（懒初始化）。
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
     * 注册任务摘要到注册表。
     * @param {object} entry
     * @returns {Promise<void>}
     * @private
     */
    async _registerTask(entry) {
        const registry = this._getRegistry();
        if (!registry) return;
        try {
            await registry.upsert(entry);
        } catch (err) {
            console.warn(`[OrchestratorController] 注册任务摘要失败: ${err.message}`);
        }
    }

    /**
     * 任务终态时回写注册表：status + 结构化指标。
     *
     * metrics 来自步骤的 meta .json 旁车文件（通用键值对，如 mergeLevel / score），
     * 存入 task_registry.metadata JSON 列，后端不解释键语义。
     * 多步骤时合并各步骤 metrics（后完成的覆盖同名字段）。
     *
     * @param {string} taskId
     * @param {Orchestrator} orch - 已到终态的编排器实例
     * @returns {Promise<void>}
     * @private
     */
    async _patchRegistryFinalState(taskId, orch) {
        const registry = this._getRegistry();
        if (!registry) return;

        const progress = orch.getProgress();

        // 合并各步骤 metrics（通用键值对，后写覆盖同名）
        let metrics = null;
        for (const s of (progress.steps || [])) {
            if (s.metrics && typeof s.metrics === 'object') {
                metrics = { ...(metrics || {}), ...s.metrics };
            }
        }

        const patch = { status: progress.status || 'completed' };
        if (metrics) {
            // 与已有 metadata 合并（保留 load 时写入的其他摘要字段，如 stepCount）
            const existing = await registry.get(taskId);
            const existingMeta = existing && existing.metadata && typeof existing.metadata === 'object'
                ? existing.metadata
                : {};
            patch.metadata = { ...existingMeta, ...metrics };
        }

        await registry.patch(taskId, patch);
    }

    /**
     * 获取已有实例，不存在则报错。
     */
    _getOrchestrator(taskId) {
        const orch = this._orchestrators.get(taskId);
        if (!orch) {
            throw new Error(`未找到编排任务: taskId=${taskId}，请先加载任务`);
        }
        return orch;
    }

    /**
     * 创建新的 Orchestrator 实例。
     */
    _createOrchestrator() {
        return new Orchestrator({
            sseHub: this.sseHub,
            storage: this.storage,
            flexRunnerFactory: this.flexRunnerFactory
        });
    }

    /**
     * 释放指定任务编排器持有的重型引用，并（可选）从内存移除编排器实例。
     *
     * 调用 `orch.dispose()` 置空各步骤节点的 `_runner`，使 FlexRunner / CLIController /
     * SkillSelector Agent / LLMClient / Storage 可被 GC 回收。保留磁盘持久化与
     * Orchestrator 的轻量元信息（getProgress / getStepInfo 仍可用）。
     *
     * @param {string} taskId - 任务 ID
     * @param {object} [opts]
     * @param {boolean} [opts.removeInstance=false] - 是否同时从内存 Map 移除编排器实例
     * @returns {boolean} 是否找到并处理了该任务
     */
    disposeOrchestrator(taskId, opts = {}) {
        const { removeInstance = false } = opts;
        const orch = this._orchestrators.get(taskId);
        if (!orch) return false;

        try {
            orch.dispose();
        } catch (err) {
            console.warn(`[OrchestratorController] dispose 失败: taskId=${taskId}, error=${err.message}`);
        }

        if (removeInstance) {
            this._orchestrators.delete(taskId);
        }
        return true;
    }

    // ─── 供 FlexRunnerController 跨域查询 ──────────────────────────────

    /**
     * 获取编排器中某步骤关联的 FlexRunner 实例。
     *
     * 编排执行时，Orchestrator 在步骤节点上创建 FlexRunner 并挂载到 node._runner。
     * 此方法供 FlexRunnerController 查找由编排器创建（而非通过 /api/flexrunner/init 注册）的实例，
     * 使前端的对话/控制/文件操作能正确路由到编排执行中的实例。
     *
     * @param {string} taskId
     * @param {string|number} stepId
     * @returns {object|null} FlexRunner 实例（可能为 null 表示步骤未执行或已结束且实例未存活）
     */
    getStepRunner(taskId, stepId) {
        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch {
            return null;
        }
        const node = orch.getNode(stepId);
        if (!node) return null;
        return node._runner || null;
    }

    /**
     * 获取编排器中某步骤的元信息（即使 FlexRunner 实例已不可用）。
     *
     * 用于步骤执行结束后，前端仍能查询到步骤的最终状态、sessionId、resultPath 等。
     *
     * @param {string} taskId
     * @param {string|number} stepId
     * @returns {object|null} 步骤的 JSON 快照
     */
    getStepInfo(taskId, stepId) {
        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch {
            return null;
        }
        const node = orch.getNode(stepId);
        if (!node) return null;
        return node.toJSON();
    }

    /**
     * 按大循环轮次从磁盘读取历史步骤的元信息。
     *
     * 当用户查看历史轮次的编排详情时，内存中只有最新轮次的编排器实例，
     * 历史轮次的编排状态持久化在 orchestration_loop{N}.json 中。
     * 此方法从磁盘读取对应轮次的编排快照，提取指定 stepId 的步骤信息（含 sessionId）。
     *
     * @param {string} taskId
     * @param {string|number} stepId
     * @param {number} loop - 大循环轮次（0-based）
     * @returns {Promise<object|null>} 步骤的 JSON 快照
     */
    async getStepInfoByLoop(taskId, stepId, loop) {
        if (!this.storage) return null;
        try {
            const state = await this.storage.json('task').read(`${taskId}/orchestration_loop${loop}`);
            if (!state || !Array.isArray(state.steps)) return null;
            const sid = String(stepId);
            return state.steps.find(s => String(s.stepId) === sid) || null;
        } catch (err) {
            console.warn(`[OrchestratorController] 读取轮次步骤信息失败: taskId=${taskId}, loop=${loop}, stepId=${stepId}, ${err.message}`);
            return null;
        }
    }

    /**
     * 获取编排器中某任务的所有步骤元信息列表。
     *
     * @param {string} taskId
     * @returns {object[]} 步骤 JSON 快照数组（空数组表示任务不存在或无步骤）
     */
    getTaskSteps(taskId) {
        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch {
            return [];
        }
        const progress = orch.getProgress();
        return progress.steps || [];
    }

    // ─── HTTP Handlers ─────────────────────────────────────────────────

    /**
     * POST /api/orchestrator/load
     * 加载任务定义 JSON，创建编排器实例
     *
     * Body: {
     *   taskId, taskDir, skillDirectory,
     *   steps: [{ stepId, taskDescription, dependId, nextStepId, failStepId, maxRetries, ... }]
     * }
     */
    async load(req, res) {
        const body = req.body || {};
        const { taskId } = body;

        if (!taskId) {
            return res.error(400, 'taskId 为必填项');
        }
        if (!Array.isArray(body.steps) || body.steps.length === 0) {
            return res.error(400, 'steps 为必填项且不能为空');
        }

        try {
            // 若已存在同 taskId 的实例，先终止旧的
            const existing = this._orchestrators.get(taskId);
            if (existing && existing.status === OrchestratorStatus.RUNNING) {
                await existing.abort();
            }

            const orch = this._createOrchestrator();
            // taskDef 未指定 skillDirectory 时，用服务端默认 SKILL 根目录兜底
            // （保证 specifiedSkill / SkillSelector 自动匹配有根目录可解析）
            if (!body.skillDirectory && this.skillDirectory) {
                body.skillDirectory = this.skillDirectory;
            }
            await orch.loadTask(body);

            this._orchestrators.set(taskId, orch);

            // 注册任务摘要到注册表（SQLite），供历史列表分页查询
            const firstStep = body.steps[0] || {};
            this._registerTask({
                taskId,
                taskType: 'orchestrator',
                status: 'loaded',
                title: (firstStep.taskDescription || body.title || '').slice(0, 200),
                description: body.title || firstStep.taskDescription || '',
                createdAt: new Date().toISOString(),
                metadata: { stepCount: body.steps.length }
            });

            res.json({
                status: 'ok',
                message: `编排任务已加载: taskId=${taskId}`,
                orchestrator: orch.getProgress()
            });
        } catch (err) {
            res.error(400, err.message);
        }
    }

    /**
     * POST /api/orchestrator/start
     * 启动编排执行
     *
     * Body: { taskId }
     */
    async start(req, res) {
        const body = req.body || {};
        const { taskId } = body;

        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch (err) {
            return res.error(404, err.message);
        }

        if (orch.status !== OrchestratorStatus.LOADED) {
            return res.error(409, `当前状态为 ${orch.status}，需先加载任务`);
        }

        // 异步启动，不阻塞 HTTP 响应
        orch.start()
            .catch(err => {
                console.error(`[OrchestratorController] taskId=${taskId} 执行异常:`, err.message);
            })
            .finally(() => {
                // 终态回写注册表：status + 结构化指标（metrics 存入通用 metadata 列，后端不解释键）
                // 使历史列表一次 SQL 即可拿到真实状态与等级，前端无需逐任务调 progress
                this._patchRegistryFinalState(taskId, orch).catch(err => {
                    console.warn(`[OrchestratorController] 注册表终态回写失败: taskId=${taskId}, ${err.message}`);
                });
            });

        res.json({
            status: 'ok',
            message: `编排任务已启动: taskId=${taskId}`,
            progress: orch.getProgress()
        });
    }

    /**
     * POST /api/orchestrator/pause
     * 暂停编排执行
     *
     * Body: { taskId }
     */
    async pause(req, res) {
        const body = req.body || {};
        const { taskId } = body;

        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch (err) {
            return res.error(404, err.message);
        }

        const ok = await orch.pause();
        res.json({
            status: ok ? 'ok' : 'error',
            message: ok ? '编排已暂停' : '暂停失败（可能未在运行中）',
            progress: orch.getProgress()
        });
    }

    /**
     * POST /api/orchestrator/resume
     * 恢复编排执行
     *
     * Body: { taskId }
     */
    async resume(req, res) {
        const body = req.body || {};
        const { taskId } = body;

        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch (err) {
            return res.error(404, err.message);
        }

        const ok = await orch.resume();
        res.json({
            status: ok ? 'ok' : 'error',
            message: ok ? '编排已恢复' : '恢复失败（可能未在运行中）',
            progress: orch.getProgress()
        });
    }

    /**
     * POST /api/orchestrator/abort
     * 终止编排执行
     *
     * Body: { taskId }
     */
    async abort(req, res) {
        const body = req.body || {};
        const { taskId } = body;

        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch (err) {
            return res.error(404, err.message);
        }

        const ok = await orch.abort();
        res.json({
            status: ok ? 'ok' : 'error',
            message: ok ? '编排已终止' : '终止失败（可能未在运行中）',
            progress: orch.getProgress()
        });
    }

    /**
     * GET /api/orchestrator/progress?taskId=xxx[&loop=N]
     * 查询编排进度（全部步骤状态汇总）
     *
     * - 不传 loop：返回最新编排状态（内存实例或 orchestration.json 快照）
     * - 传 loop=N：返回第 N 轮编排状态（从 orchestration_loopN.json 读取）
     *
     * 如果内存中没有该任务实例，尝试从磁盘恢复。
     */
    async progress(req, res) {
        const { taskId } = req.query;
        if (!taskId) return res.error(400, 'taskId 为必填项');

        // ── 指定轮次：从磁盘读取 orchestration_loop{N}.json ──
        const loopParam = req.query.loop;
        if (loopParam != null && loopParam !== '') {
            const loopNum = Number(loopParam);
            if (this.storage) {
                try {
                    const state = await this.storage.json('task').read(`${taskId}/orchestration_loop${loopNum}`);
                    if (state) {
                        return res.json({ status: 'ok', progress: state });
                    }
                    return res.error(404, `未找到第 ${loopNum} 轮编排状态: taskId=${taskId}`);
                } catch (err) {
                    console.warn(`[OrchestratorController] 读取轮次编排状态失败: loop=${loopNum}, ${err.message}`);
                    return res.error(404, `未找到第 ${loopNum} 轮编排状态: taskId=${taskId}`);
                }
            }
            return res.error(404, `未找到第 ${loopNum} 轮编排状态: taskId=${taskId}`);
        }

        // ── 默认：返回最新编排状态 ──
        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch (_) {
            // 内存中不存在，尝试从磁盘恢复（只读响应，不写入内存 Map——
            // 避免前端翻阅大量历史任务时 Orchestrator 实例无限驻留内存）。
            // queryOnly：任务可能是另一进程（如 CLI）正在执行的编排，RUNNING 状态
            // 原样返回，不做"重启中断→FAILED"标记，避免前端误报"检视失败"。
            if (this.storage) {
                try {
                    const state = await this.storage.json('task').read(`${taskId}/orchestration`);
                    if (state) {
                        orch = this._createOrchestrator();
                        await orch.restoreState(state, { queryOnly: true });
                    }
                } catch (err) {
                    console.warn(`[OrchestratorController] 恢复失败: ${err.message}`);
                }
            }
            if (!orch) {
                return res.error(404, `未找到编排任务: taskId=${taskId}`);
            }
        }

        res.json({
            status: 'ok',
            progress: orch.getProgress()
        });
    }

    /**
     * GET /api/orchestrator/step-detail?taskId=xxx&stepId=yyy&detailType=live
     * 查询单个步骤的执行细节
     *
     * Query:
     *   taskId     - 任务 ID
     *   stepId     - 步骤 ID
     *   detailType - 'live' | 'session' | 'status'（默认 live）
     */
    async stepDetail(req, res) {
        const { taskId } = req.query;
        const stepId = req.query.stepId;
        const detailType = req.query.detailType || 'live';

        if (!taskId || !stepId) {
            return res.error(400, 'taskId 和 stepId 为必填项');
        }

        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch (err) {
            return res.error(404, err.message);
        }

        try {
            const detail = await orch.getStepDetail(stepId, detailType);
            res.json({ status: 'ok', detail });
        } catch (err) {
            res.error(404, err.message);
        }
    }

    /**
     * POST /api/orchestrator/update-step
     * 修改未执行步骤的配置
     *
     * Body: {
     *   taskId, stepId,
     *   taskDescription?, dependId?, nextStepId?, failStepId?,
     *   maxRetries?, skillDirectory?, taskDir?, inputReport?
     * }
     */
    async updateStep(req, res) {
        const body = req.body || {};
        const { taskId, stepId } = body;

        if (!taskId || stepId == null) {
            return res.error(400, 'taskId 和 stepId 为必填项');
        }

        let orch;
        try {
            orch = this._getOrchestrator(taskId);
        } catch (err) {
            return res.error(404, err.message);
        }

        // 提取可修改字段（排除 taskId/stepId）
        const patch = { ...body };
        delete patch.taskId;
        delete patch.stepId;

        try {
            const ok = orch.updateStepConfig(stepId, patch);
            res.json({
                status: ok ? 'ok' : 'error',
                message: ok
                    ? `步骤 ${stepId} 配置已修改`
                    : `步骤 ${stepId} 当前状态不允许修改配置`,
                progress: orch.getProgress()
            });
        } catch (err) {
            res.error(400, err.message);
        }
    }

    /**
     * GET /api/orchestrator/tasks
     * 列出所有编排任务（合并内存实例 + 磁盘持久化记录）
     *
     * Query:
     *   page          - 页码（默认 1）
     *   pageSize      - 每页条数（默认 20，最大 100）
     *   taskIdPrefix  - 可选，按 taskId 前缀过滤（如 'fluttercheck_' / 'codecheck_'），
     *                   供各功能面板历史列表独立分页，避免混合任务挤占页容量
     */
    async tasks(req, res) {
        const query = req.query || {};
        const page = Math.max(1, parseInt(query.page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
        const taskIdPrefix = query.taskIdPrefix || null;

        // ── 优先方案：从注册表分页查询 ──
        const registry = this._getRegistry();
        if (registry) {
            try {
                const result = await registry.listPage({
                    page,
                    pageSize,
                    taskType: 'orchestrator',
                    taskIdPrefix
                });

                // 合并内存中活跃任务的状态
                const mergedTasks = result.tasks.map(t => {
                    const orch = this._orchestrators.get(t.task_id);
                    if (orch) {
                        const progress = orch.getProgress();
                        return { ...t, taskId: t.task_id, status: progress.status || t.status };
                    }
                    return { ...t, taskId: t.task_id };
                });

                // 第一页补充「活跃但尚未落库」的任务：
                // 仅当任务处于非终态（active: idle/loaded/running）且不在注册表全量 ID 集合中时
                // 才补全。此前用「不在本页 existingIds 中」判断会误把 OFFSET 之外的其他页历史
                // 终态任务（restoreFromDisk 常驻内存）补进首页，导致跨页重复 + 最早任务置顶。
                if (page === 1) {
                    const registryIds = new Set(
                        await registry.listIds({ taskType: 'orchestrator', taskIdPrefix })
                    );
                    const activeStatuses = ['idle', 'loaded', 'running'];
                    for (const [taskId, orch] of this._orchestrators) {
                        if (taskIdPrefix && !taskId.startsWith(taskIdPrefix)) continue;
                        const progress = orch.getProgress();
                        if (!activeStatuses.includes(progress.status)) continue;
                        if (registryIds.has(taskId)) continue;
                        mergedTasks.unshift({
                            task_id: taskId,
                            task_type: 'orchestrator',
                            status: progress.status || 'loaded',
                            title: (progress.taskDescription || '').slice(0, 200),
                            description: progress.taskDescription || '',
                            created_at: progress.startTime || new Date().toISOString(),
                            metadata: null,
                            taskId
                        });
                    }
                }

                return res.json({
                    status: 'ok',
                    tasks: mergedTasks,
                    total: result.total,
                    page: result.page,
                    pageSize: result.pageSize,
                    totalPages: result.totalPages
                });
            } catch (err) {
                console.warn('[OrchestratorController] 注册表查询失败，降级到磁盘扫描:', err.message);
            }
        }

        // ── 降级方案：内存 + 磁盘扫描 ──
        const list = [];
        const seenTaskIds = new Set();

        for (const orch of this._orchestrators.values()) {
            list.push(orch.getProgress());
            seenTaskIds.add(orch.taskId);
        }

        if (this.storage) {
            const persistedIds = this._listPersistedTaskIds();
            for (const taskId of persistedIds) {
                if (seenTaskIds.has(taskId)) continue;
                try {
                    const state = await this.storage.json('task').read(`${taskId}/orchestration`);
                    if (state) {
                        list.push(state);
                        seenTaskIds.add(taskId);
                    }
                } catch (err) {
                    console.warn(`[OrchestratorController] 读取任务状态失败: taskId=${taskId}, error=${err.message}`);
                }
            }
        }

        // 降级也做分页
        list.sort((a, b) => ((b.startTime || '') > (a.startTime || '') ? 1 : -1));
        const total = list.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const offset = (page - 1) * pageSize;
        const paged = list.slice(offset, offset + pageSize);

        res.json({
            status: 'ok',
            tasks: paged,
            total,
            page,
            pageSize,
            totalPages
        });
    }

    /**
     * DELETE /api/orchestrator/task?taskId=xxx
     * 移除一个编排任务实例（同时删除持久化文件）
     */
    async removeTask(req, res) {
        const { taskId } = req.query;
        const orch = this._orchestrators.get(taskId);

        // 如果正在运行，先终止
        if (orch && orch.status === OrchestratorStatus.RUNNING) {
            await orch.abort();
        }

        // 先释放重型引用，再从内存移除
        const existed = this.disposeOrchestrator(taskId, { removeInstance: true });

        // 同时删除持久化文件
        let diskRemoved = false;
        if (this.storage) {
            try {
                diskRemoved = await this.storage.json('task').delete(`${taskId}/orchestration`);
            } catch (err) {
                console.warn(`[OrchestratorController] 删除持久化文件失败: ${err.message}`);
            }
        }

        res.json({
            status: 'ok',
            removed: existed || diskRemoved,
            message: (existed || diskRemoved) ? '编排任务已移除' : '任务不存在'
        });
    }

    // ─── 持久化恢复 ──────────────────────────────────────────────────

    /**
     * 扫描 db/task/ 目录，列出有 orchestration.json 的 taskId 列表。
     * @returns {string[]}
     * @private
     */
    _listPersistedTaskIds() {
        if (!this.storage) return [];
        try {
            const rootDir = this.storage.manager.rootDir;
            const taskDir = path.join(rootDir, 'task');
            if (!fs.existsSync(taskDir)) return [];
            const entries = fs.readdirSync(taskDir, { withFileTypes: true });
            const ids = [];
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const orchFile = path.join(taskDir, entry.name, 'orchestration.json');
                    if (fs.existsSync(orchFile)) {
                        ids.push(entry.name);
                    }
                }
            }
            return ids;
        } catch (err) {
            console.warn('[OrchestratorController] _listPersistedTaskIds 失败:', err.message);
            return [];
        }
    }

    /**
     * 从磁盘恢复所有持久化的编排任务到内存。
     *
     * 服务重启时调用。对每个 db/task/{taskId}/orchestration.json：
     *   - 创建 Orchestrator 实例并 restoreState
     *   - RUNNING 状态会被标记为 FAILED（执行中断）
     *   - 其他状态原样恢复
     *   - 恢复后回写注册表：进程死亡导致 start().finally() 中的终态回写未执行，
     *     registry 停留在 loaded/running 的记录修正为恢复后的终态（含 metrics、
     *     interrupted 标记）；未入库的老任务补录摘要。
     *
     * @returns {Promise<{restored: string[], failed: string[]}>}
     */
    async restoreFromDisk() {
        const restored = [];
        const failed = [];

        if (!this.storage) {
            console.warn('[OrchestratorController] storage 未注入，跳过恢复');
            return { restored, failed };
        }

        const persistedIds = this._listPersistedTaskIds();
        console.log(`[OrchestratorController] 发现 ${persistedIds.length} 个持久化编排任务`);

        for (const taskId of persistedIds) {
            try {
                const state = await this.storage.json('task').read(`${taskId}/orchestration`);
                if (!state) {
                    console.warn(`[OrchestratorController] orchestration.json 为空: taskId=${taskId}`);
                    failed.push(taskId);
                    continue;
                }

                const wasRunning = state.status === 'running';
                const orch = this._createOrchestrator();
                await orch.restoreState(state);
                this._orchestrators.set(taskId, orch);
                restored.push(taskId);

                // 恢复后修正注册表（非终态 → 终态；未入库 → 补录）
                await this._patchRegistryAfterRestore(taskId, orch, state, { wasRunning });
            } catch (err) {
                // JSON 损坏、字段缺失等情况下标记为 failed，不中断其他任务的恢复
                const isJsonError = err instanceof SyntaxError;
                console.error(
                    `[OrchestratorController] 恢复失败: taskId=${taskId}, ` +
                    `type=${isJsonError ? 'JSON损坏' : '其他错误'}, error=${err.message}`
                );
                failed.push(taskId);
            }
        }

        return { restored, failed };
    }

    /**
     * 服务重启恢复后，回写任务注册表。
     *
     * 仅修正"非终态"记录（running/loaded）——进程死亡导致 start().finally() 中
     * 的 _patchRegistryFinalState 未执行，这些记录停留在启动时的状态。
     * 已是终态（completed/failed/aborted/passed/...）的真实历史不覆盖。
     *
     * @param {string} taskId
     * @param {Orchestrator} orch - 恢复后的编排器实例（RUNNING 已转 FAILED）
     * @param {object} state - orchestration.json 原始快照（含 steps[].taskDescription/metrics）
     * @param {object} [opts]
     * @param {boolean} [opts.wasRunning] - 崩溃前是否处于 running 状态
     * @returns {Promise<void>}
     * @private
     */
    async _patchRegistryAfterRestore(taskId, orch, state, opts = {}) {
        const registry = this._getRegistry();
        if (!registry) return;

        try {
            const existing = await registry.get(taskId);
            // 终态记录是真实历史，不覆盖
            if (existing && !['running', 'loaded'].includes(existing.status)) return;

            const progress = orch.getProgress();

            // 合并各步骤 metrics（与 _patchRegistryFinalState 相同语义：后完成覆盖同名）
            let metrics = null;
            for (const s of (progress.steps || [])) {
                if (s.metrics && typeof s.metrics === 'object') {
                    metrics = { ...(metrics || {}), ...s.metrics };
                }
            }

            const existingMeta = existing?.metadata && typeof existing.metadata === 'object'
                ? existing.metadata
                : {};
            const metadata = { ...existingMeta, ...(metrics || {}) };
            if (opts.wasRunning) {
                metadata.interrupted = true;
                metadata.interruptedReason = '服务重启导致执行中断';
            }

            const status = progress.status || 'failed';
            const firstStep = (state.steps || [])[0] || {};

            if (!existing) {
                // 老任务未入库（TaskRegistryStore 上线前创建）：补录摘要，保留原始创建时间
                await registry.upsert({
                    taskId,
                    taskType: 'orchestrator',
                    status,
                    title: (firstStep.taskDescription || taskId).slice(0, 200),
                    description: firstStep.taskDescription || '',
                    createdAt: state.startTime || new Date().toISOString(),
                    metadata
                });
            } else {
                await registry.patch(taskId, { status, metadata });
            }
            console.log(
                `[OrchestratorController] 注册表已修正: taskId=${taskId}, ` +
                `${existing ? existing.status : '(未入库)'} → ${status}`
            );
        } catch (err) {
            console.warn(`[OrchestratorController] 恢复后回写注册表失败: taskId=${taskId}, ${err.message}`);
        }
    }

    /**
     * GET /api/orchestrator/step-history?taskId=xxx
     * 查询任务的步骤执行历史（SQLite，db/TaskStep/store.db）。
     *
     * 数据来源为 TaskStepStore，每次执行尝试（attempt）一条记录：
     * 含状态流转（running/completed/error）、起止时间、耗时、sessionId、
     * resultPath、metrics 等。服务重启后依然完整可查。
     */
    async stepHistory(req, res) {
        const { taskId } = req.query;
        if (!taskId) {
            return res.error(400, 'taskId 为必填项');
        }
        if (!this.storage) {
            return res.error(500, 'storage 未初始化');
        }

        try {
            const store = this.storage.taskStepStore();
            const steps = await store.listByTask(taskId);
            res.json({
                status: 'ok',
                taskId,
                total: steps.length,
                steps
            });
        } catch (err) {
            res.error(500, `查询步骤历史失败: ${err.message}`);
        }
    }
}

export default OrchestratorController;
