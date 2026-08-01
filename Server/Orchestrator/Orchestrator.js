/**
 * Orchestrator —— FlexRunner 任务编排器
 *
 * 接收一段规定好任务的 JSON（taskId + 多个 step），按照依赖关系编排执行：
 *   - 无依赖的步骤并行执行
 *   - 成功 → nextStepId，失败 → failStepId
 *   - 将前一步的结果报告路径传递给后续步骤
 *   - 循环检测：防止 nextStepId/failStepId 指向链形成无限循环
 *   - 死锁检测：所有步骤在等待但无人可执行时终止
 *   - 实时进度推送：通过 SseHub 向前端广播状态变更
 *   - 未执行步骤支持配置修改
 *
 * 设计原则：
 *   - 高内聚：编排逻辑集中在 Orchestrator，步骤状态在 StepNode，FlexRunner 负责执行
 *   - 低耦合：通过构造注入 SseHub / FlexRunner 工厂 / 存储，不硬编码依赖
 *   - 单一职责：Orchestrator 只管调度和状态流转，不关心 Skill 匹配和 CLI 细节
 *
 * 依赖注入：
 *   - sseHub:   SseHub 实例，用于实时推送进度
 *   - storage:  createStorage() 返回的存储门面
 *   - flexRunnerFactory: 可选，自定义 FlexRunner 创建逻辑（测试注入 mock）
 *
 * @example
 * import { Orchestrator } from './Orchestrator/Orchestrator.js';
 *
 * const orch = new Orchestrator({ sseHub, storage });
 * await orch.loadTask({
 *   taskId: 'task-001',
 *   taskDir: '/workspace/tasks/task-001',
 *   steps: [
 *     { stepId: 1, taskDescription: '分析代码', nextStepId: 2, maxRetries: 3 },
 *     { stepId: 2, dependId: 1, taskDescription: '生成报告', nextStepId: 0, maxRetries: 3 }
 *   ]
 * });
 * const result = await orch.start();
 */

import path from 'node:path';

import { FlexRunner } from '../FlexRunner/FlexRunner.js';
import { StepNode, NodeStatus } from './StepNode.js';
import { nowCST } from '../library/cstTime.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 编排器状态 */
export const OrchestratorStatus = Object.freeze({
    IDLE: 'idle',           // 未加载任务
    LOADED: 'loaded',       // 已加载，未启动
    RUNNING: 'running',     // 正在执行
    COMPLETED: 'completed', // 全部成功完成
    FAILED: 'failed',       // 有步骤失败且无法继续
    ABORTED: 'aborted',     // 被手动终止
    DEADLOCKED: 'deadlocked' // 死锁
});

/** SSE 事件类型 */
const SSE_EVENT = Object.freeze({
    TASK_START: 'orch:task:start',
    STEP_STATUS: 'orch:step:status',
    STEP_DETAIL: 'orch:step:detail',
    TASK_PROGRESS: 'orch:task:progress',
    TASK_COMPLETE: 'orch:task:complete',
    TASK_ERROR: 'orch:task:error',
    TASK_ABORTED: 'orch:task:aborted'
});

/** 全局执行次数上限（防止极端循环场景） */
const GLOBAL_EXEC_LIMIT = 200;

// ─── Orchestrator 类 ─────────────────────────────────────────────────────────

class Orchestrator {
    /**
     * @param {object} deps - 依赖注入
     * @param {object} [deps.sseHub]      - SseHub 实例（可选，无则不推送）
     * @param {object} [deps.storage]     - 存储门面（可选，无则不持久化）
     * @param {function} [deps.flexRunnerFactory] - FlexRunner 工厂函数（可选，测试用）
     */
    constructor(deps = {}) {
        this.sseHub = deps.sseHub || null;
        this.storage = deps.storage || null;
        this.flexRunnerFactory = deps.flexRunnerFactory || null;

        // ── 任务元信息 ──
        /** @type {string} */
        this._taskId = '';
        /** @type {string} */
        this._taskDir = '';
        /** @type {string} */
        this._skillDirectory = '';
        /** @type {number} 大循环索引（0=首轮），用于区分各轮产物文件 */
        this._loopCount = 0;
        /** @type {OrchestratorStatus} */
        this._status = OrchestratorStatus.IDLE;
        /** @type {string|null} */
        this._startTime = null;
        /** @type {string|null} */
        this._endTime = null;

        // ── 步骤管理 ──
        /** @type {Map<string, StepNode>} key = stepId */
        this._nodes = new Map();
        /** @type {string[]} 步骤执行顺序（拓扑排序后的入口步骤） */
        this._entryStepIds = [];

        // ── 运行时 ──
        /** @type {string|null} 当前正在执行的 stepId（单步串行时）；并行时为 null */
        this._currentStepId = null;
        /** @type {number} 全局执行计数 */
        this._globalExecCount = 0;
        /** @type {boolean} 是否被手动终止 */
        this._aborted = false;
        /** @type {string|null} 失败原因 */
        this._error = null;
        /** @type {Set<string>} 已参与过的执行路径节点（用于循环检测） */
        this._execPathTrace = new Set();

        // ── 持久化串行化 ──
        // _persistState 可能被并发调用（如步骤状态变更回调中 fire-and-forget 触发）。
        // 多个 writeFile 同时操作同一文件会导致截断/拼接竞态，产生损坏的 JSON。
        // 用 Promise 链串行化所有持久化写入，后一次等待前一次完成后再执行。
        /** @type {Promise<void>} */
        this._persistChain = Promise.resolve();
    }

    // ─── 只读 getter ───────────────────────────────────────────────────

    /** @returns {string} */
    get taskId() { return this._taskId; }
    /** @returns {OrchestratorStatus} */
    get status() { return this._status; }
    /** @returns {string|null} */
    get startTime() { return this._startTime; }
    /** @returns {string|null} */
    get endTime() { return this._endTime; }
    /** @returns {StepNode[]} */
    get nodes() { return Array.from(this._nodes.values()); }

    /**
     * 获取步骤节点。
     * @param {string|number} stepId
     * @returns {StepNode|undefined}
     */
    getNode(stepId) {
        return this._nodes.get(String(stepId));
    }

    // ─── 任务加载 ──────────────────────────────────────────────────────

    /**
     * 加载任务定义 JSON。
     *
     * 任务 JSON 格式：
     *   {
     *     taskId: 'task-001',
     *     taskDir: '/workspace/tasks/task-001',
     *     skillDirectory: '/path/to/Skills',
     *     steps: [
     *       {
     *         stepId: 1,
     *         taskDescription: '...',
     *         dependId: 0,       // 0 = 无依赖（入口步骤）
     *         nextStepId: 2,     // 成功后指向
     *         failStepId: 3,     // 失败后指向（0 = 失败即终止）
     *         maxRetries: 5,
     *         skillDirectory: '...',  // 可选，覆盖全局
     *         taskDir: '...',         // 可选，覆盖全局
     *         inputReport: '...'      // 可选，初始输入报告
     *       },
     *       ...
     *     ]
     *   }
     *
     * @param {object} taskDef - 任务定义
     * @returns {Promise<void>}
     */
    async loadTask(taskDef) {
        if (!taskDef || !taskDef.taskId) {
            throw new Error('Orchestrator.loadTask: taskId 为必填项');
        }
        if (!Array.isArray(taskDef.steps) || taskDef.steps.length === 0) {
            throw new Error('Orchestrator.loadTask: steps 为必填项且不能为空');
        }

        this._taskId = String(taskDef.taskId);
        // taskDir 默认为 db/task/{taskId}（与 storage.json('task') 同目录）
        const _rootDir = this.storage?.manager?.rootDir;
        this._taskDir = taskDef.taskDir ||
            (_rootDir
                ? path.resolve(_rootDir, 'task', this._taskId)
                : path.resolve(process.cwd(), 'db', 'task', this._taskId));
        this._skillDirectory = taskDef.skillDirectory || '';
        // 大循环索引（0=首轮），从 taskDef 读取，用于区分各轮产物文件
        this._loopCount = Number(taskDef.loopCount) || 0;
        this._nodes.clear();
        this._entryStepIds = [];

        // 构建步骤节点
        for (const stepDef of taskDef.steps) {
            const node = new StepNode({
                ...stepDef,
                skillDirectory: stepDef.skillDirectory || this._skillDirectory,
                taskDir: stepDef.taskDir || this._taskDir
            });
            if (this._nodes.has(node.stepId)) {
                throw new Error(`Orchestrator.loadTask: stepId "${node.stepId}" 重复`);
            }
            this._nodes.set(node.stepId, node);
        }

        // 验证依赖引用完整性
        this._validateReferences();

        // 识别入口步骤（dependId 为 0 或指向不存在的步骤）
        for (const node of this._nodes.values()) {
            if (node.dependId === '0' || !this._nodes.has(node.dependId)) {
                this._entryStepIds.push(node.stepId);
            }
        }

        if (this._entryStepIds.length === 0) {
            throw new Error('Orchestrator.loadTask: 未找到入口步骤（dependId=0 的步骤）');
        }

        this._status = OrchestratorStatus.LOADED;
        this._error = null;
        this._aborted = false;
        this._globalExecCount = 0;
        this._execPathTrace.clear();

        this._log('info', `任务已加载: taskId=${this._taskId}, 步骤数=${this._nodes.size}, 入口步骤=${this._entryStepIds.join(',')}`);

        // 持久化初始状态
        await this._persistState();
    }

    /**
     * 验证 nextStepId / failStepId / dependId 的引用完整性。
     * 不要求所有引用都存在（failStepId=0 表示失败即终止），
     * 但非零引用必须指向已定义的步骤。
     * @private
     */
    _validateReferences() {
        for (const node of this._nodes.values()) {
            // nextStepId 非 0 时必须存在
            if (node.nextStepId !== '0' && !this._nodes.has(node.nextStepId)) {
                throw new Error(
                    `Orchestrator.loadTask: 步骤 ${node.stepId} 的 nextStepId "${node.nextStepId}" 不存在`
                );
            }
            // failStepId 非 0 时必须存在
            if (node.failStepId !== '0' && !this._nodes.has(node.failStepId)) {
                throw new Error(
                    `Orchestrator.loadTask: 步骤 ${node.stepId} 的 failStepId "${node.failStepId}" 不存在`
                );
            }
            // dependId 非 0 时必须存在
            if (node.dependId !== '0' && !this._nodes.has(node.dependId)) {
                this._log('warn', `步骤 ${node.stepId} 的 dependId "${node.dependId}" 不存在，视为入口步骤`);
            }
        }
    }

    // ─── 执行控制 ──────────────────────────────────────────────────────

    /**
     * start — 启动编排执行。
     *
     * 从入口步骤开始，按依赖关系和 nextStepId/failStepId 链驱动执行。
     * 无依赖的步骤并行执行；有依赖的步骤等待前置完成后触发。
     *
     * @returns {Promise<{status: OrchestratorStatus, summary: object}>}
     */
    async start() {
        if (this._status !== OrchestratorStatus.LOADED) {
            throw new Error(`Orchestrator.start: 当前状态为 ${this._status}，需先 loadTask`);
        }

        this._status = OrchestratorStatus.RUNNING;
        this._startTime = nowCST();
        this._emit(SSE_EVENT.TASK_START, this.getProgress());
        await this._persistState();

        this._log('info', `── 编排执行开始 ──`);

        try {
            // 初始就绪：将所有入口步骤标记为 ready
            for (const stepId of this._entryStepIds) {
                const node = this._nodes.get(stepId);
                if (node && node.status === NodeStatus.PENDING) {
                    node.markReady();
                    this._emitStepStatus(node);
                }
            }

            // 主调度循环
            await this._scheduleLoop();

        } catch (err) {
            this._error = err.message;
            this._status = OrchestratorStatus.FAILED;
            this._log('error', `编排执行异常: ${err.message}`);
            this._emit(SSE_EVENT.TASK_ERROR, { error: err.message, progress: this.getProgress() });
        }

        this._endTime = nowCST();

        // 判定最终状态
        if (this._aborted) {
            this._status = OrchestratorStatus.ABORTED;
            this._emit(SSE_EVENT.TASK_ABORTED, this.getProgress());
        } else if (this._status === OrchestratorStatus.RUNNING) {
            // 检查是否全部成功完成
            const allCompleted = Array.from(this._nodes.values()).every(n => n.isCompleted);
            if (allCompleted) {
                this._status = OrchestratorStatus.COMPLETED;
            } else {
                // 检查是否死锁
                const hasRunning = Array.from(this._nodes.values()).some(n => n.isRunning);
                const hasReady = Array.from(this._nodes.values()).some(n => n.status === NodeStatus.READY);
                if (!hasRunning && !hasReady) {
                    this._status = OrchestratorStatus.DEADLOCKED;
                    this._error = '所有步骤已停止，但存在未完成的步骤（可能死锁或失败链终止）';
                } else {
                    this._status = OrchestratorStatus.FAILED;
                }
            }
            this._emit(SSE_EVENT.TASK_COMPLETE, {
                status: this._status,
                progress: this.getProgress()
            });
        }

        this._log('info', `── 编排执行结束: status=${this._status} ──`);
        await this._persistState();
        return { status: this._status, summary: this.getProgress() };
    }

    /**
     * 主调度循环。
     *
     * 每轮：
     *   1. 收集所有 READY 状态的步骤
     *   2. 并行执行（无依赖或依赖已完成）
     *   3. 等待执行完成
     *   4. 根据成功/失败更新后续步骤的就绪状态
     *   5. 循环检测
     *   6. 若无 READY 也无 RUNNING → 结束
     *
     * @private
     */
    async _scheduleLoop() {
        while (!this._aborted) {
            // 全局执行次数保护
            if (this._globalExecCount >= GLOBAL_EXEC_LIMIT) {
                this._error = `全局执行次数已达上限 ${GLOBAL_EXEC_LIMIT}，可能存在无限循环`;
                this._log('error', this._error);
                return;
            }

            // 收集可执行步骤（READY 状态）
            const readyNodes = Array.from(this._nodes.values())
                .filter(n => n.status === NodeStatus.READY);

            if (readyNodes.length === 0) {
                // 检查是否有正在执行的步骤
                const runningNodes = Array.from(this._nodes.values())
                    .filter(n => n.isRunning);
                if (runningNodes.length === 0) {
                    // 无可执行也无运行中 → 调度结束
                    this._log('info', '调度循环结束：无可执行步骤');
                    return;
                }
                // 等待运行中的步骤完成（不应发生，因为 _executeStep 是同步等待的）
                await this._sleep(1000);
                continue;
            }

            // 并行执行所有就绪步骤
            this._log('info', `本轮执行 ${readyNodes.length} 个步骤: ${readyNodes.map(n => n.stepId).join(', ')}`);

            const promises = readyNodes.map(node => this._executeNode(node));
            await Promise.all(promises);

            // 执行完成后，处理后续步骤的就绪状态
            // （已在 _executeNode 内部处理）
        }
    }

    /**
     * 执行单个步骤节点（含重试逻辑）。
     *
     * 流程：
     *   1. 创建 FlexRunner 实例并 initContext
     *   2. 调用 executeStart，失败时按 maxRetries 重试
     *   3. 成功 → 标记 COMPLETED，激活 nextStepId
     *   4. 失败（重试耗尽）→ 标记 FAILED，激活 failStepId（若有）
     *   5. 循环检测：如果后续步骤已在执行路径中，标记 BLOCKED
     *
     * @param {StepNode} node
     * @private
     */
    async _executeNode(node) {
        this._globalExecCount++;
        this._currentStepId = node.stepId;

        // 循环检测：如果该步骤已在执行路径中出现过，标记为阻塞
        const pathKey = `${this._taskId}:${node.stepId}`;
        if (this._execPathTrace.has(pathKey)) {
            node.markBlocked(`循环检测：步骤 ${node.stepId} 已在执行路径中出现过`);
            this._log('warn', `循环检测触发: stepId=${node.stepId}`);
            this._emitStepStatus(node);
            return;
        }
        this._execPathTrace.add(pathKey);

        // 获取前置步骤的结果报告路径（传递给当前步骤）
        const inputReport = this._resolveInputReport(node);

        // 标记为执行中（仅设置状态供 SSE 推送，retryCount 在循环内递增）
        node.status = NodeStatus.RUNNING;
        this._emitStepStatus(node);

        let success = false;
        let resultPath = '';
        let sessionId = '';
        let errorMsg = null;

        try {
            // 创建并初始化 FlexRunner
            const runner = await this._createFlexRunner(node, inputReport);
            node._runner = runner;

            // 重试循环：每次迭代调用 markRunning() 递增 retryCount
            while (node.canRetry && !this._aborted) {
                node.markRunning();

                this._log('info', `执行步骤 ${node.stepId}（第 ${node.retryCount} 次）`);

                const result = await runner.executeStart();
                resultPath = result.resultPath;
                success = result.success;

                // 推送执行细节
                this._emit(SSE_EVENT.STEP_DETAIL, {
                    stepId: node.stepId,
                    attempt: node.retryCount,
                    success,
                    resultPath,
                    sessionId: runner.sessionId,
                    runner: this._runnerBrief(runner)
                });

                if (success) break;

                // 失败但还能重试 → 继续
                if (!success && node.canRetry) {
                    this._log('warn', `步骤 ${node.stepId} 第 ${node.retryCount} 次失败，将重试`);
                    continue;
                }
                // 失败且不可重试 → 退出循环
                break;
            }

            sessionId = runner.sessionId;
        } catch (err) {
            errorMsg = err.message;
            this._log('error', `步骤 ${node.stepId} 执行异常: ${err.message}`);
        }

        // 标记完成状态
        node.markFinished({ success, resultPath, sessionId, error: errorMsg });
        this._emitStepStatus(node);

        // 激活后续步骤
        if (success) {
            this._activateNextStep(node, node.nextStepId);
        } else {
            if (node.failStepId !== '0') {
                this._activateNextStep(node, node.failStepId);
            } else {
                this._log('warn', `步骤 ${node.stepId} 失败且无 failStepId，链终止`);
            }
        }

        this._currentStepId = null;
    }

    /**
     * 激活后续步骤（标记为 READY）。
     *
     * @param {StepNode} fromNode    - 触发方步骤
     * @param {string} nextStepId    - 下一步骤 ID
     * @private
     */
    _activateNextStep(fromNode, nextStepId) {
        if (nextStepId === '0' || !this._nodes.has(nextStepId)) {
            return;
        }

        const nextNode = this._nodes.get(nextStepId);
        if (!nextNode || !nextNode.isPending) {
            // 已执行或运行中，不重复激活
            return;
        }

        nextNode.markReady();
        // 传递前置步骤的结果报告路径
        if (fromNode.resultPath) {
            nextNode.inputReport = fromNode.resultPath;
        }
        this._emitStepStatus(nextNode);
        this._log('info', `步骤 ${fromNode.stepId} → 激活步骤 ${nextStepId}`);
    }

    /**
     * 解析步骤的输入报告路径。
     *
     * 优先使用节点自身的 inputReport（可能已被前置步骤传递），
     * 否则为空。
     *
     * @param {StepNode} node
     * @returns {string}
     * @private
     */
    _resolveInputReport(node) {
        return node.inputReport || '';
    }

    /**
     * 创建 FlexRunner 实例并初始化。
     *
     * @param {StepNode} node
     * @param {string} inputReport
     * @returns {Promise<FlexRunner>}
     * @private
     */
    async _createFlexRunner(node, inputReport) {
        // 支持注入工厂（测试用）
        if (this.flexRunnerFactory) {
            return this.flexRunnerFactory(node, inputReport);
        }

        const runner = new FlexRunner();
        await runner.initContext({
            taskId: this._taskId,
            stepId: Number(node.stepId) || 0,
            dependId: Number(node.dependId) || 0,
            nextStepId: Number(node.nextStepId) || 0,
            taskDescription: node.taskDescription,
            skillDirectory: node.skillDirectory,
            taskDir: node.taskDir,
            inputReport,
            maxRetries: node.maxRetries,
            // 大循环索引，传递给 FlexRunner 用于区分各轮产物文件
            bigLoopIndex: this._loopCount
        });
        return runner;
    }

    // ─── 控制操作 ──────────────────────────────────────────────────────

    /**
     * abort — 终止编排执行。
     *
     * 标记终止标志，正在执行的步骤会在步骤边界检测后退出。
     *
     * @returns {Promise<boolean>}
     */
    async abort() {
        if (this._status !== OrchestratorStatus.RUNNING) {
            this._log('warn', `abort: 当前状态为 ${this._status}，无需终止`);
            return false;
        }

        this._aborted = true;
        this._log('warn', '⏹  编排执行已被终止');

        // 终止当前运行中的步骤
        for (const node of this._nodes.values()) {
            if (node.isRunning && node._runner) {
                try {
                    await node._runner.controlExecution('abort');
                } catch (err) {
                    this._log('warn', `终止步骤 ${node.stepId} 失败: ${err.message}`);
                }
                node.markFinished({ success: false, resultPath: '', error: '已终止' });
                this._emitStepStatus(node);
            }
        }

        return true;
    }

    /**
     * pause — 暂停编排执行。
     *
     * 暂停所有运行中的步骤（在步骤边界生效）。
     *
     * @returns {Promise<boolean>}
     */
    async pause() {
        if (this._status !== OrchestratorStatus.RUNNING) return false;

        for (const node of this._nodes.values()) {
            if (node.isRunning && node._runner) {
                try {
                    await node._runner.controlExecution('pause');
                } catch (err) {
                    this._log('warn', `暂停步骤 ${node.stepId} 失败: ${err.message}`);
                }
            }
        }
        this._log('info', '⏸  编排执行已暂停');
        return true;
    }

    /**
     * resume — 恢复编排执行。
     *
     * @returns {Promise<boolean>}
     */
    async resume() {
        if (this._status !== OrchestratorStatus.RUNNING) return false;

        for (const node of this._nodes.values()) {
            if (node.isRunning && node._runner) {
                try {
                    await node._runner.controlExecution('resume');
                } catch (err) {
                    this._log('warn', `恢复步骤 ${node.stepId} 失败: ${err.message}`);
                }
            }
        }
        this._log('info', '▶  编排执行已恢复');
        return true;
    }

    /**
     * updateStepConfig — 修改未执行步骤的配置。
     *
     * 仅 PENDING / READY 状态的步骤允许修改。
     * 已执行或运行中的步骤拒绝修改。
     *
     * @param {string|number} stepId
     * @param {object} patch - 要修改的字段
     * @returns {boolean} 是否修改成功
     */
    updateStepConfig(stepId, patch) {
        const node = this.getNode(stepId);
        if (!node) {
            throw new Error(`updateStepConfig: 步骤 "${stepId}" 不存在`);
        }

        const ok = node.updateConfig(patch);
        if (ok) {
            this._log('info', `步骤 ${stepId} 配置已修改`);
            this._emitStepStatus(node);
        } else {
            this._log('warn', `步骤 ${stepId} 当前状态为 ${node.status}，不允许修改配置`);
        }
        return ok;
    }

    /**
     * getStepDetail — 获取步骤的执行细节。
     *
     * 通过 FlexRunner 的接口获取实时执行信息：
     *   - liveMessages: 当前会话的实时对话消息
     *   - sessionContent: 会话归档内容
     *   - runner: FlexRunner 实例状态
     *
     * @param {string|number} stepId
     * @param {string} [detailType='live'] - 'live' | 'session' | 'status'
     * @returns {Promise<object>}
     */
    async getStepDetail(stepId, detailType = 'live') {
        const node = this.getNode(stepId);
        if (!node) {
            throw new Error(`getStepDetail: 步骤 "${stepId}" 不存在`);
        }

        const result = {
            stepId: node.stepId,
            status: node.status,
            retryCount: node.retryCount,
            history: node.history
        };

        // 通过关联的 FlexRunner 实例获取实时数据
        if (node._runner && detailType === 'live') {
            try {
                result.liveMessages = await node._runner.getLiveMessages();
            } catch (err) {
                result.liveMessages = [];
                result.liveError = err.message;
            }
        } else if (node._runner && detailType === 'session') {
            try {
                result.sessionContent = await node._runner.getSessionContent();
            } catch (err) {
                result.sessionError = err.message;
            }
        } else if (node._runner && detailType === 'status') {
            result.runner = this._runnerBrief(node._runner);
        }

        return result;
    }

    // ─── 进度查询 ──────────────────────────────────────────────────────

    /**
     * getProgress — 获取编排进度概览。
     *
     * 返回所有步骤的状态汇总，供前端展示：
     *   - 总步骤数
     *   - 各状态的数量统计
     *   - 各步骤的详情
     *
     * @returns {object}
     */
    getProgress() {
        const steps = Array.from(this._nodes.values()).map(n => n.toJSON());
        const stats = {
            total: steps.length,
            pending: 0,
            ready: 0,
            running: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            blocked: 0
        };
        for (const s of steps) {
            if (stats[s.status] !== undefined) stats[s.status]++;
        }

        return {
            taskId: this._taskId,
            loopCount: this._loopCount,
            status: this._status,
            startTime: this._startTime,
            endTime: this._endTime,
            error: this._error,
            currentStepId: this._currentStepId,
            globalExecCount: this._globalExecCount,
            stats,
            steps
        };
    }

    // ─── 内部工具 ──────────────────────────────────────────────────────

    /**
     * 提取 FlexRunner 的简要状态信息。
     * @param {FlexRunner} runner
     * @returns {object}
     * @private
     */
    _runnerBrief(runner) {
        if (!runner) return null;
        return {
            taskId: runner.taskId,
            stepId: runner.stepId,
            bigLoopIndex: runner.bigLoopIndex,
            executeStep: runner.executeStep,
            retryTimes: runner.retryTimes,
            maxRetries: runner.maxRetries,
            sessionId: runner.sessionId,
            startTime: runner.startTime,
            endTime: runner.endTime,
            resultPath: runner.resultPath,
            canRetry: runner.canRetry()
        };
    }

    /**
     * 推送步骤状态变更事件。
     * @param {StepNode} node
     * @private
     */
    _emitStepStatus(node) {
        this._emit(SSE_EVENT.STEP_STATUS, {
            stepId: node.stepId,
            status: node.status,
            retryCount: node.retryCount,
            startTime: node.startTime,
            endTime: node.endTime,
            resultPath: node.resultPath,
            error: node.error
        });
        // 同时推送整体进度
        this._emit(SSE_EVENT.TASK_PROGRESS, this.getProgress());
        // 持久化状态变更
        this._persistState().catch(err => {
            this._log('warn', `持久化状态失败: ${err.message}`);
        });
    }

    // ─── 持久化 ──────────────────────────────────────────────────────

    /**
     * 获取可序列化的编排状态快照。
     * @returns {object}
     */
    getPersistableState() {
        return {
            taskId: this._taskId,
            taskDir: this._taskDir,
            skillDirectory: this._skillDirectory,
            loopCount: this._loopCount,
            status: this._status,
            startTime: this._startTime,
            endTime: this._endTime,
            error: this._error,
            currentStepId: this._currentStepId,
            globalExecCount: this._globalExecCount,
            entryStepIds: [...this._entryStepIds],
            steps: Array.from(this._nodes.values()).map(n => n.toJSON()),
            persistedAt: nowCST()
        };
    }

    /**
     * 持久化当前编排状态到 db/task/{taskId}/orchestration_loop{L}.json
     * 同时写入最新快照 db/task/{taskId}/orchestration.json（兼容恢复逻辑）
     * @private
     */
    async _persistState() {
        if (!this.storage || !this._taskId) return;
        // 串行化：将本次写入追加到 _persistChain 末尾，确保同一时刻只有一个 writeFile 在执行。
        // 防止并发写入同一文件时因 O_TRUNC 截断产生损坏的 JSON。
        const run = async () => {
            try {
                const state = this.getPersistableState();
                const json = this.storage.json('task');
                // 按大循环轮次独立保存（保留历史）
                await json.write(`${this._taskId}/orchestration_loop${this._loopCount}`, state);
                // 同时写入最新快照（兼容已有 load/restore 逻辑）
                await json.write(`${this._taskId}/orchestration`, state);
            } catch (err) {
                this._log('warn', `_persistState 失败: ${err.message}`);
            }
        };
        // 错误吞掉，避免一条失败链阻断后续写入
        this._persistChain = this._persistChain.then(run, run);
        // 对外仍 await，使调用方（如 loadTask/start/restoreState 中的 await）能感知完成
        await this._persistChain;
    }

    /**
     * 从持久化文件恢复编排状态。
     *
     * 恢复后编排器处于对应状态：
     *   - RUNNING → 标记为 FAILED（执行中断，无法自动恢复运行时上下文）
   *   - LOADED/COMPLETED/FAILED/ABORTED/DEADLOCKED → 原样恢复
     *
     * @param {object} state - getPersistableState() 返回的对象
     * @returns {Promise<void>}
     */
    async restoreState(state) {
        if (!state || !state.taskId) {
            throw new Error('Orchestrator.restoreState: state.taskId 为必填项');
        }

        this._taskId = String(state.taskId);
        this._taskDir = state.taskDir || '';
        this._skillDirectory = state.skillDirectory || '';
        this._loopCount = Number(state.loopCount) || 0;
        this._startTime = state.startTime || null;
        this._endTime = state.endTime || null;
        this._error = state.error || null;
        this._currentStepId = state.currentStepId || null;
        this._globalExecCount = state.globalExecCount || 0;
        this._entryStepIds = Array.isArray(state.entryStepIds) ? [...state.entryStepIds] : [];
        this._execPathTrace.clear();
        this._aborted = false;

        // 重建步骤节点
        this._nodes.clear();
        if (Array.isArray(state.steps)) {
            for (const s of state.steps) {
                const node = new StepNode({
                    stepId: s.stepId,
                    taskDescription: s.taskDescription,
                    dependId: s.dependId,
                    nextStepId: s.nextStepId,
                    failStepId: s.failStepId,
                    maxRetries: s.maxRetries,
                    skillDirectory: s.skillDirectory,
                    taskDir: s.taskDir,
                    inputReport: s.inputReport
                });
                // 恢复运行时状态
                node.status = s.status || NodeStatus.PENDING;
                node.retryCount = s.retryCount || 0;
                node.startTime = s.startTime || null;
                node.endTime = s.endTime || null;
                node.resultPath = s.resultPath || '';
                node.sessionId = s.sessionId || '';
                node.error = s.error || null;
                if (Array.isArray(s.history)) {
                    node.history = s.history;
                }
                this._nodes.set(node.stepId, node);
            }
        }

        // RUNNING 状态在重启后无法恢复执行上下文，标记为 FAILED
        if (state.status === OrchestratorStatus.RUNNING) {
            this._status = OrchestratorStatus.FAILED;
            this._error = '服务重启导致执行中断';
            this._endTime = nowCST();
            // 将运行中的步骤标记为失败
            for (const node of this._nodes.values()) {
                if (node.isRunning) {
                    node.markFinished({ success: false, resultPath: '', error: '服务重启中断' });
                }
            }
            await this._persistState();
        } else {
            this._status = state.status || OrchestratorStatus.LOADED;
        }

        this._log('info', `状态已恢复: taskId=${this._taskId}, status=${this._status}, 步骤数=${this._nodes.size}`);
    }

    /**
     * 通过 SseHub 推送事件（若可用）。
     * @param {string} eventType
     * @param {object} data
     * @private
     */
    _emit(eventType, data) {
        if (this.sseHub && typeof this.sseHub.emit === 'function') {
            this.sseHub.emit(this._taskId, eventType, data);
        }
    }

    /**
     * Promise 版 sleep。
     * @param {number} ms
     * @returns {Promise<void>}
     * @private
     */
    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 统一日志输出。
     * @param {'info'|'warn'|'error'} level
     * @param {string} message
     * @private
     */
    _log(level, message) {
        const prefix = `[Orchestrator:${this._taskId || 'idle'}]`;
        const ts = nowCST();
        switch (level) {
            case 'error':
                console.error(`${ts} ${prefix} ❌ ${message}`);
                break;
            case 'warn':
                console.warn(`${ts} ${prefix} ⚠  ${message}`);
                break;
            default:
                console.info(`${ts} ${prefix} ℹ  ${message}`);
        }
    }
}

export { Orchestrator, SSE_EVENT };
export { default as StepNode } from './StepNode.js';
export { NodeStatus } from './StepNode.js';
export default Orchestrator;
