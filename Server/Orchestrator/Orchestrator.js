/**
 * Orchestrator —— FlexRunner 任务编排器
 *
 * 接收一段规定好任务的 JSON（taskId + 多个 step），按照依赖关系编排执行：
 *   - 无依赖的步骤并行执行
 *   - 成功 → nextStepId，失败 → failStepId（未达 maxRetries 时跳到修复步骤）
 *   - 将前一步的结果报告路径传递给后续步骤
 *   - 全局执行上限 GLOBAL_EXEC_LIMIT 兜底，防止链路形成无限循环
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

/** 默认全局 Session 并发上限（可通过环境变量 MAX_CONCURRENT_SESSIONS 覆盖） */
const DEFAULT_MAX_CONCURRENT_SESSIONS = 50;

// ─── 全局 Session 并发信号量 ─────────────────────────────────────────────────

/**
 * Semaphore — 异步信号量（FIFO 排队）。
 *
 * 进程级单例（跨所有编排任务共享）：并行步骤 fan-out / 多任务同时提交时，
 * 活跃的 opencode Session（即正在执行的 FlexRunner executeStart）总数
 * 不超过上限，防止 AI 会话数无节制叠加（5 维并发 × N 个仓库）。
 */
class Semaphore {
    /**
     * @param {number} limit - 并发上限（≥1）
     */
    constructor(limit = DEFAULT_MAX_CONCURRENT_SESSIONS) {
        this._limit = Math.max(1, Number(limit) || DEFAULT_MAX_CONCURRENT_SESSIONS);
        this._active = 0;
        /** @type {Array<() => void>} */
        this._queue = [];
    }

    get limit() { return this._limit; }
    get active() { return this._active; }
    get waiting() { return this._queue.length; }

    /**
     * 获取一个槽位；上限已满时排队等待。
     * @returns {Promise<void>}
     */
    async acquire() {
        if (this._active < this._limit) {
            this._active++;
            return;
        }
        await new Promise(resolve => this._queue.push(resolve));
        // 被唤醒时槽位已由 release 直接转移给本等待者，_active 不再递增
    }

    /**
     * 释放槽位；有等待者时直接转移（保证 FIFO 且不超发）。
     */
    release() {
        const next = this._queue.shift();
        if (next) {
            next();
        } else {
            this._active = Math.max(0, this._active - 1);
        }
    }
}

/** 进程级全局 Session 并发信号量（所有 Orchestrator 实例共享） */
const globalSessionSemaphore = new Semaphore(
    Number(process.env.MAX_CONCURRENT_SESSIONS) || DEFAULT_MAX_CONCURRENT_SESSIONS
);

/**
 * 查询全局 Session 并发占用快照（供 HTTP 统计接口 / 前端顶栏展示）。
 * @returns {{active: number, limit: number, waiting: number, utilization: number}}
 */
export function getSessionSemaphoreStats() {
    return {
        active: globalSessionSemaphore.active,
        limit: globalSessionSemaphore.limit,
        waiting: globalSessionSemaphore.waiting,
        utilization: globalSessionSemaphore.limit > 0
            ? Math.round((globalSessionSemaphore.active / globalSessionSemaphore.limit) * 100)
            : 0
    };
}

// ─── Orchestrator 类 ─────────────────────────────────────────────────────────

class Orchestrator {
    /**
     * @param {object} deps - 依赖注入
     * @param {object} [deps.sseHub]      - SseHub 实例（可选，无则不推送）
     * @param {object} [deps.storage]     - 存储门面（可选，无则不持久化）
     * @param {function} [deps.flexRunnerFactory] - FlexRunner 工厂函数（可选，测试用）
     * @param {object} [deps.sessionSemaphore] - Session 并发信号量（可选，默认进程级全局单例）
     */
    constructor(deps = {}) {
        this.sseHub = deps.sseHub || null;
        this.storage = deps.storage || null;
        this.flexRunnerFactory = deps.flexRunnerFactory || null;
        // 全局 Session 并发限制（进程级共享；测试可注入自定义信号量）
        this.sessionSemaphore = deps.sessionSemaphore || globalSessionSemaphore;

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
        /** @type {Set<string>} 修复步骤集合：被其它步骤 failStepId 指向的 stepId。
         *  这些节点语义上"仅由某步骤失败时经 failStepId 进入"，不应被 dependId fan-out 并行激活。 */
        this._fixStepIds = new Set();

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
     *         maxRetries: 3,
     *         skillDirectory: '...',  // 可选，覆盖全局
     *         specifiedSkill: '...',  // 可选，指定 SKILL（name 或目录名），跳过自动匹配
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

        // 识别修复步骤集合：被其它步骤 failStepId 指向的 node。
        // 这些 node 语义上"仅在某源步骤失败时经 failStepId 进入"，不应通过 dependId
        // 的 fan-out 并行激活（否则会与源步骤落入同一并行轮次，造成误执行/误阻塞）。
        this._fixStepIds.clear();
        for (const node of this._nodes.values()) {
            const fail = String(node.failStepId);
            if (fail !== '0' && this._nodes.has(fail)) {
                this._fixStepIds.add(fail);
            }
        }

        // 识别入口步骤（无任何前置依赖，或全部前置指向不存在的步骤）。
        // 修复步骤（被某步骤 failStepId 指向的 node，见 _fixStepIds）默认不作为入口：
        // 即使其 dependId 为 0/空/-1，也只应经 failStepId 触发，不能与真入口并行启动。
        // 例外：重试锚点式回退（A.failStepId=B，B 恰为整条链的首个入口步骤，A 失败跳回 B 重跑全链）。
        // 此时若排除修复步骤后找不到任何入口，则回退为不排除（保证这类图可启动）。
        const collectEntries = (excludeFixSteps) => {
            const ids = [];
            for (const node of this._nodes.values()) {
                if (excludeFixSteps && this._fixStepIds.has(node.stepId)) continue;
                // 归一化后的前置依赖数组为空 → 入口步骤
                const deps = node.dependencies;
                const hasValidDep = deps.some(d => this._nodes.has(d));
                if (deps.length === 0 || !hasValidDep) {
                    ids.push(node.stepId);
                }
            }
            return ids;
        };
        this._entryStepIds = collectEntries(true);
        if (this._entryStepIds.length === 0) {
            // 排除修复步骤后无任何入口：可能是"重试锚点回退"（如 A.failStepId=B，B 为链首入口）。
            // 回退为不排除修复步骤，让链首入口正常启动。
            this._entryStepIds = collectEntries(false);
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
            // dependId（单值或数组）中每个非 0 引用必须存在。
            // 注意：-1 是"修复步骤哨兵"而非真实依赖 ID，StepNode 归一化时已从
            // node.dependencies 排除，此处显式跳过以防御历史状态/手写任务中的 -1。
            for (const depId of node.dependencies) {
                if (depId === '-1') continue;
                if (!this._nodes.has(depId)) {
                    this._log('warn', `步骤 ${node.stepId} 的 dependId "${depId}" 不存在，视为入口步骤`);
                }
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
     * 释放编排器持有的重型引用（各个步骤的 FlexRunner 及其内嵌依赖）。
     *
     * 编排结束后由上层（OrchestratorController）调用，遍历所有节点置空 `_runner`，
     * 使 FlexRunner / CLIController / SkillSelector Agent / LLMClient / Storage 可被 GC 回收。
     *
     * 仅释放内存引用，保留：
     *   - StepNode 元信息（status / sessionId / resultPath / history），供 toJSON 历史查询
     *   - 磁盘持久化文件（orchestration.json / loop.json / result .md）
     *
     * 调用后 getProgress / getStepInfo 仍可用；依赖 `_runner` 的 live/session 实时查询
     * 将失效（前端走本地归档回退路径）。
     */
    dispose() {
        if (this._disposed) return;
        for (const node of this._nodes.values()) {
            node.releaseRunner();
        }
        this._disposed = true;
        this._log('info', '── 编排器已释放重型引用 ──');
    }

    /**
     * 主调度循环。
     *
     * 每轮：
     *   1. 收集所有 READY 状态的步骤
     *   2. 并行执行（无依赖或依赖已完成）
     *   3. 等待执行完成
     *   4. 根据成功/失败更新后续步骤的就绪状态
     *   5. 全局执行上限 GLOBAL_EXEC_LIMIT 兜底
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
     * 执行单个步骤节点（单次执行，不再原地重试）。
     *
     * 流程：
     *   1. 创建 FlexRunner 实例并 initContext
     *   2. 调用 executeStart 单次执行
     *   3. 成功 → 标记 COMPLETED，激活 nextStepId
     *   4. 失败 → 已达 maxRetries 则终止流程；否则激活 failStepId（允许重复执行修复步骤）
     *   5. 无 failStepId → 链终止
     *
     * @param {StepNode} node
     * @private
     */
    async _executeNode(node) {
        this._globalExecCount++;
        this._currentStepId = node.stepId;

        // 获取前置步骤的结果报告路径（传递给当前步骤）
        const inputReport = this._resolveInputReport(node);

        // 标记为执行中（仅设置状态供 SSE 推送，retryCount 在 markRunning 中递增）
        node.status = NodeStatus.RUNNING;
        this._emitStepStatus(node);

        let success = false;
        let resultPath = '';
        let sessionId = '';
        let errorMsg = null;
        let metrics = null;

        try {
            // 创建并初始化 FlexRunner
            const runner = await this._createFlexRunner(node, inputReport);
            node._runner = runner;

            // 单次执行（不再原地重试）。
            // 失败后由 _activateNextStep 跳转 failStepId（未达 maxRetries），
            // 或终止流程（已达 maxRetries）。每次调用 markRunning() 递增 retryCount，
            // 用于累计该步骤的总运行次数（maxRetries 上限判定）。
            node.markRunning();

            this._log('info', `执行步骤 ${node.stepId}（第 ${node.retryCount} 次）`);

            // 步骤开始：实时落 SQLite（db/TaskStep/store.db）。
            // running 记录先行写入，进程崩溃/重启时 db 中保留崩溃前真实状态。
            await this._persistStepDb(node);

            // ── 全局 Session 并发限制 ──
            // 进程级信号量：并行 fan-out 步骤 / 多任务同时提交时，
            // 活跃 opencode Session 总数不超过 MAX_CONCURRENT_SESSIONS（默认 5）
            const semWaitStart = Date.now();
            await this.sessionSemaphore.acquire();
            const semWaited = Date.now() - semWaitStart;
            if (semWaited > 100) {
                this._log('info', `步骤 ${node.stepId} 等待并发槽位 ${semWaited}ms（active=${this.sessionSemaphore.active}/${this.sessionSemaphore.limit}）`);
            }

            let result;
            try {
                result = await runner.executeStart();
            } finally {
                this.sessionSemaphore.release();
            }
            resultPath = result.resultPath;
            success = result.success;
            metrics = result.metrics || null;

            // 推送执行细节
            this._emit(SSE_EVENT.STEP_DETAIL, {
                stepId: node.stepId,
                attempt: node.retryCount,
                success,
                resultPath,
                sessionId: runner.sessionId,
                runner: this._runnerBrief(runner)
            });

            sessionId = runner.sessionId;
        } catch (err) {
            errorMsg = err.message;
            this._log('error', `步骤 ${node.stepId} 执行异常: ${err.message}`);
        }

        // 标记完成状态
        node.markFinished({ success, resultPath, sessionId, error: errorMsg, metrics });
        this._emitStepStatus(node);

        // 步骤终态：实时落 SQLite（completed/error + 输出/metrics/耗时）
        await this._persistStepDb(node);

        // 已被终止：整条链终止，不再激活后续步骤（nextStepId / failStepId 均不流转）
        if (this._aborted) {
            this._currentStepId = null;
            return;
        }

        // #region agent log
        fetch('http://127.0.0.1:7594/ingest/461ba96d-dcca-4412-802c-154cfd42eb29',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0305de'},body:JSON.stringify({sessionId:'0305de',runId:'debug',location:'Orchestrator.js:468',message:'_executeNode finished',data:{node:node.stepId,success,retryCount:node.retryCount,maxRetries:node.maxRetries,nextStepId:node.nextStepId,failStepId:node.failStepId,status:node.status},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        if (success) {
            // 成功 → 走 nextStepId
            this._activateNextStep(node, node.nextStepId);
        } else {
            // 失败 → 已达本步骤自己的 maxRetries 上限则终止整个流程
            if (node.retryCount >= node.maxRetries) {
                this._log('warn',
                    `步骤 ${node.stepId} 失败且达到 maxRetries=${node.maxRetries}，终止流程`);
            } else if (node.failStepId !== '0') {
                // 未达上限 → 立即跳 failStepId（允许重复执行已 completed/failed 修复步骤）。
                // forceDependCheck:false 跳过目标步骤的 fan-in 依赖聚合检查——failStepId 是显式
                // 失败跳转，不应被 dependId 聚合条件阻塞（修复目标失败即应进入修复步骤）。
                this._activateNextStep(node, node.failStepId, { allowCompleted: true, forceDependCheck: false });
            } else {
                this._log('warn', `步骤 ${node.stepId} 失败且无 failStepId，链终止`);
            }
        }

        // 本步骤完成，可能满足 fan-out/fan-in 依赖条件：扫描所有依赖它的后续步骤尝试激活
        this._activateDependents(node);

        this._currentStepId = null;
    }

    /**
     * 激活后续步骤（标记为 READY），聚合感知。
     *
     * 成功/失败链语义（nextStepId/failStepId 单出边）保持不变，但激活前需满足
     * 目标步骤自身的 fan-in 聚合条件：其所有前置依赖（node.dependencies）都须已 COMPLETED。
     * 单依赖时行为与旧版完全一致；多依赖时需全部前置完成才真正 READY。
     *
     * @param {StepNode} fromNode    - 触发方步骤
     * @param {string} nextStepId    - 下一步骤 ID
     * @param {object} [opts]
     * @param {boolean} [opts.allowCompleted=false] - failStepId 修复路径允许重复执行已完成/失败节点
     * @param {boolean} [opts.forceDependCheck=true] - 是否检查目标节点的聚合条件（默认检查）
     * @private
     */
    _activateNextStep(fromNode, nextStepId, { allowCompleted = false, forceDependCheck = true } = {}) {
        if (nextStepId === '0' || !this._nodes.has(nextStepId)) {
            return;
        }

        const nextNode = this._nodes.get(nextStepId);
        if (!nextNode) {
            return;
        }

        // #region agent log
        fetch('http://127.0.0.1:7594/ingest/461ba96d-dcca-4412-802c-154cfd42eb29',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0305de'},body:JSON.stringify({sessionId:'0305de',runId:'debug',location:'Orchestrator.js:504',message:'_activateNextStep entry',data:{from:fromNode.stepId,next:nextStepId,allowCompleted,forceDependCheck,nextStatus:nextNode.status,nextIsPending:nextNode.isPending},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        // nextStepId 成功路径：激活待执行节点（PENDING/READY），
        // 或重试修复链中已 FAILED 但未用尽 maxRetries 的节点
        // （如 failStepId 跳回修复后成功后，再次走 nextStepId 到原失败节点）。
        if (!allowCompleted && !nextNode.isPending) {
            const canReenterFromFailed =
                nextNode.status === NodeStatus.FAILED &&
                nextNode.retryCount < nextNode.maxRetries;
            if (!canReenterFromFailed) {
                // #region agent log
                fetch('http://127.0.0.1:7594/ingest/461ba96d-dcca-4412-802c-154cfd42eb29',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0305de'},body:JSON.stringify({sessionId:'0305de',runId:'post-fix',location:'Orchestrator.js:515',message:'BLOCKED: not pending and cannot reenter from failed',data:{from:fromNode.stepId,next:nextStepId,nextStatus:nextNode.status,nextIsPending:nextNode.isPending,retryCount:nextNode.retryCount,maxRetries:nextNode.maxRetries},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
                // 已执行或运行中（且非失败可重试），不重复激活
                return;
            }
        }

        // failStepId 修复路径：允许重复执行已 completed/failed 节点，
        // 但跳过正在运行/已就绪（避免重复入队）
        if (allowCompleted && (nextNode.isRunning || nextNode.status === NodeStatus.READY)) {
            // #region agent log
            fetch('http://127.0.0.1:7594/ingest/461ba96d-dcca-4412-802c-154cfd42eb29',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0305de'},body:JSON.stringify({sessionId:'0305de',runId:'debug',location:'Orchestrator.js:522',message:'H3 BLOCKED: allowCompleted target running/ready',data:{from:fromNode.stepId,next:nextStepId,nextStatus:nextNode.status},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            return;
        }

        // 聚合条件：目标节点的所有前置依赖必须已完成（fan-in）
        if (forceDependCheck && !this._allDependenciesCompleted(nextNode)) {
            // #region agent log
            fetch('http://127.0.0.1:7594/ingest/461ba96d-dcca-4412-802c-154cfd42eb29',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0305de'},body:JSON.stringify({sessionId:'0305de',runId:'debug',location:'Orchestrator.js:527',message:'H2 BLOCKED: deps not all completed',data:{from:fromNode.stepId,next:nextStepId,deps:nextNode.dependencies},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            this._log('info',
                `步骤 ${fromNode.stepId} → 步骤 ${nextStepId} 尚有未完成的前置依赖，等待聚合`);
            return;
        }

        // 不清空历史结果；运行时状态由 markRunning/markFinished 自然更新
        nextNode.markReady();
        // 传递触发方步骤的结果报告路径（fan-in 聚合时取最后一个触发的前置）
        if (fromNode.resultPath) {
            nextNode.inputReport = fromNode.resultPath;
        }
        this._emitStepStatus(nextNode);
        this._log('info', `步骤 ${fromNode.stepId} → 激活步骤 ${nextStepId}`);
    }

    /**
     * 当前步骤完成后，扫描所有以它为前置依赖的后续步骤，尝试激活满足条件的步骤。
     *
     * 同时覆盖两种场景：
     *   - fan-out 并行：多个步骤 dependId 指向当前步骤，全部激活（由 _scheduleLoop 并行执行）
     *   - fan-in 聚合：目标步骤 dependId 为数组，仅当它所有前置都 COMPLETED 才激活
     * 与 _activateNextStep（沿 nextStepId/failStepId 链）互补；重复激活由 isPending/markReady 幂等拦截。
     *
     * @param {StepNode} fromNode - 刚完成的步骤
     * @private
     */
    _activateDependents(fromNode) {
        for (const node of this._nodes.values()) {
            if (node === fromNode) continue;
            // 仅当目标步骤依赖当前步骤，且仍处于待执行状态时才尝试激活
            if (!node.dependencies.includes(fromNode.stepId)) continue;
            if (!node.isPending) continue;
            // 关键修复：当前步骤成功时，跳过"以当前步骤为 failStepId 目标"的修复链节点。
            // 即若 fromNode.failStepId == node.stepId，则 node 只在 fromNode 失败时才进入；
            // _activateDependents 不应在 fromNode 成功时把它当"成功依赖边"激活。
            // 失败路径由 _executeNode 用 allowCompleted:true 走 failStepId 激活，无需在此重复。
            if (fromNode.isCompleted && String(fromNode.failStepId) === String(node.stepId)) {
                continue;
            }
            // 修复步骤兜底：node 是被某步骤 failStepId 指向的修复步骤（存入 _fixStepIds），
            // 且当前 fromNode 不是它的触发失败源（fromNode.failStepId !== node.stepId）。
            // 此时 node 的 dependId 若指向 fromNode（如修复步骤误设与验证步骤并行的 dependId），
            // 会被当作 fan-out 并行激活，导致与源步骤同轮并行、误执行或阻塞后续链。
            // 修复步骤只应经真正的 failStepId 触发，故此处跳过 fan-out 激活。
            if (this._fixStepIds.has(node.stepId) &&
                String(fromNode.failStepId) !== String(node.stepId)) {
                continue;
            }
            if (this._allDependenciesCompleted(node)) {
                this._activateNextStep(fromNode, node.stepId, { forceDependCheck: false });
            }
        }
    }

    /**
     * 检查步骤的所有前置依赖是否全部完成（fan-in 聚合成就条件）。
     *
     * 无依赖（入口）或依赖全部 COMPLETED 时返回 true。
     *
     * @param {StepNode} node
     * @returns {boolean}
     * @private
     */
    _allDependenciesCompleted(node) {
        const deps = node.dependencies;
        if (deps.length === 0) return true;
        return deps.every(depId => {
            const depNode = this._nodes.get(depId);
            return depNode && depNode.isCompleted;
        });
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
            // dependId 支持数组：FlexRunner 端仅作为回退锚点语义，数组时取第一个依赖
            dependId: Number(node.dependencies[0]) || 0,
            nextStepId: Number(node.nextStepId) || 0,
            failStepId: Number(node.failStepId) || 0,
            taskDescription: node.taskDescription,
            skillDirectory: node.skillDirectory,
            specifiedSkill: node.specifiedSkill,
            taskDir: node.taskDir,
            inputReport,
            maxRetries: node.maxRetries,
            // 大循环索引，传递给 FlexRunner 用于区分各轮产物文件
            bigLoopIndex: this._loopCount,
            // Session 创建后实时同步到 StepNode 并推送 SSE，保证运行中前端能拿到 sessionId
            onSessionCreated: (sessionId) => {
                node.sessionId = sessionId || '';
                this._emitStepStatus(node);
            }
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

        // 终止当前运行中的步骤。
        // 注意：这里只通知 FlexRunner 终止（设置 #aborted + abortSession），
        // 不再直接调用 node.markFinished —— 由 _executeNode 统一负责 markFinished，
        // 避免 abort 与重试循环各自写入导致同一 attempt 重复记录。
        for (const node of this._nodes.values()) {
            if (node.isRunning && node._runner) {
                try {
                    await node._runner.controlExecution('abort');
                } catch (err) {
                    this._log('warn', `终止步骤 ${node.stepId} 失败: ${err.message}`);
                }
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
            metrics: runner.metrics,
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
            sessionId: node.sessionId,
            error: node.error,
            metrics: node.metrics
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
     * 将单个步骤的执行状态实时写入 SQLite（TaskStepStore，db/TaskStep/store.db）。
     *
     * 记录粒度：每次执行尝试（attempt）一条记录，id = `{taskId}::L{loop}::S{stepId}::A{attempt}`。
     *  - markRunning 后调用 → upsert running 记录（崩溃时 db 保留"执行中"真实状态）
     *  - markFinished 后调用 → update 为终态（completed/error，自动维护 finished_at/duration_ms）
     *
     * 与 JSON 持久化（orchestration.json / stepid_*.json）互为双写：
     * SQLite 是崩溃安全（WAL）的结构化历史，服务重启后可直接查询；
     * 静默失败，不影响编排主流程。
     *
     * @param {StepNode} node
     * @returns {Promise<void>}
     * @private
     */
    async _persistStepDb(node) {
        if (!this.storage || !this._taskId) return;
        try {
            const store = this.storage.taskStepStore();
            const attempt = Math.max(1, node.retryCount);
            const id = `${this._taskId}::L${this._loopCount}::S${node.stepId}::A${attempt}`;

            const meta = {
                taskType: 'orchestrator',
                loopCount: this._loopCount,
                stepId: node.stepId,
                attempt,
                retryCount: node.retryCount,
                maxRetries: node.maxRetries,
                dependId: node.dependId,
                nextStepId: node.nextStepId,
                failStepId: node.failStepId,
                inputReport: node.inputReport || null,
                specifiedSkill: node.specifiedSkill || null,
                sessionId: node.sessionId || null,
                resultPath: node.resultPath || null,
                metrics: node.metrics || null
            };

            // NodeStatus → TaskStepStore status 映射
            const status = node.status === NodeStatus.COMPLETED ? 'completed'
                : node.status === NodeStatus.FAILED ? 'error'
                : node.status === NodeStatus.RUNNING ? 'running'
                : node.status === NodeStatus.SKIPPED ? 'skipped'
                : node.status === NodeStatus.BLOCKED ? 'skipped'
                : 'pending';

            const finished = node.status === NodeStatus.COMPLETED || node.status === NodeStatus.FAILED;
            const output = finished ? {
                resultPath: node.resultPath,
                sessionId: node.sessionId,
                metrics: node.metrics,
                history: node.history
            } : null;

            const existing = await store.get(id);
            if (existing) {
                await store.update(id, { status, output, error: node.error, meta });
            } else {
                await store.create({
                    id,
                    taskId: this._taskId,
                    name: (node.taskDescription || '').slice(0, 200),
                    type: 'cli',
                    status,
                    startedAt: node.startTime || undefined,
                    input: {
                        taskDescription: node.taskDescription,
                        taskDir: node.taskDir,
                        skillDirectory: node.skillDirectory
                    },
                    output,
                    error: node.error,
                    meta
                });
            }
        } catch (err) {
            this._log('warn', `_persistStepDb 失败: step=${node.stepId}, ${err.message}`);
        }
    }

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
                    specifiedSkill: s.specifiedSkill,
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
                node.metrics = s.metrics || null;
                if (Array.isArray(s.history)) {
                    node.history = s.history;
                }
                this._nodes.set(node.stepId, node);
            }
        }

        // 重建修复步骤集合（_activateDependents 的 fan-out 兜底依赖此集合）
        this._fixStepIds.clear();
        for (const node of this._nodes.values()) {
            const fail = String(node.failStepId);
            if (fail !== '0' && this._nodes.has(fail)) {
                this._fixStepIds.add(fail);
            }
        }
        // 防御：老持久化状态的 entryStepIds 可能误含修复步骤，恢复时过滤掉
        this._entryStepIds = (this._entryStepIds || []).filter(id => !this._fixStepIds.has(String(id)));

        // RUNNING 状态在重启后无法恢复执行上下文，标记为 FAILED
        if (state.status === OrchestratorStatus.RUNNING) {
            this._status = OrchestratorStatus.FAILED;
            this._error = '服务重启导致执行中断';
            this._endTime = nowCST();
            // 将运行中的步骤标记为失败（内存态）
            const interruptedNodes = [];
            for (const node of this._nodes.values()) {
                if (node.isRunning) {
                    node.markFinished({ success: false, resultPath: '', error: '服务重启中断' });
                    interruptedNodes.push(node);
                }
            }
            // 注意：不再调用 _persistState() 覆盖 orchestration.json / orchestration_loop{N}.json，
            // 保留崩溃前的真实快照（running 状态、currentStepId 等）供历史追溯。
            // 中断事实改记 SQLite（TaskStepStore）—— running 记录更新为 error 是真实发生的执行结果；
            // 注册表终态由上层 restoreFromDisk 回写。
            for (const node of interruptedNodes) {
                await this._persistStepDb(node);
            }
        } else {
            this._status = state.status || OrchestratorStatus.LOADED;
        }
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
