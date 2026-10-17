/**
 * ⊕ 插件内实现实体：业务逻辑逐行来自迁移前的 `Server/Orchestrator/Orchestrator.js`，
 *   后者现在只是转发门面（导出同一批对象，`===`）。
 *
 * 本文件相对迁移前只有 5 处改动，全部是"接线"，没有一处是逻辑：
 *   1. `FlexRunner`：`../FlexRunner/FlexRunner.js` → `./FlexRunner.js`
 *      （同片内部组件——二者生命周期绑定，见 index.js 头注释为何不拆两个插件）；
 *   2. `StepNode` → `./StepNode.js`；`AbortTree` → `./lib/AbortTree.js`（插件内副本）；
 *   3. `nowCST` → 内核 `core/cstTime.js`（无状态纯函数，全仓库唯一一份；
 *      走内核 barrel 而非 `core/cstTime.js` 的原因见 index.js 头注释）；
 *   4. `RoleLimiter`：静态 import → 同步兜底 `resolveFallbackSync('role-limiter')`
 *      （`Server/Agent/Runtime/` 未插件化，无接缝可走；"进程级单例"语义不变）；
 *   5. `MultiAgentRunner` 动态 import → `await resolveFallback('multi-agent-runner')`
 *      （原实现本来就是惰性 import，兜底加载器保持了同一时机）。
 *
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
import { hostname } from 'node:os';

import { nowCST } from '../../../core/cstTime.js';
import { FlexRunner } from './FlexRunner.js';
import { StepNode, NodeStatus } from './StepNode.js';
import { AbortTree } from './lib/AbortTree.js';
import { resolveFallback, resolveFallbackSync } from './lib/fallbacks.js';

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
    TASK_ABORTED: 'orch:task:aborted',
    // ── Phase 2：多 Agent 协作事件（未启用多 Agent 时不会产生）──
    /** 步骤的角色子图拓扑（谁参与、什么计划） */
    AGENT_TOPOLOGY: 'orch:agent:topology',
    /** 派发任务给某角色 */
    AGENT_ASSIGN: 'orch:agent:assign',
    /** 角色收到协作消息（回放的可视化入口） */
    AGENT_MESSAGE: 'orch:agent:message',
    /** 协作消息投递失败（异常可见，绝不静默） */
    AGENT_MESSAGE_FAILED: 'orch:agent:message_failed',
    /** 某角色执行完成 */
    AGENT_RESULT: 'orch:agent:result',
    /** 评审结论（含驳回理由） */
    AGENT_REVIEW: 'orch:agent:review',
    /** 步骤级协作摘要（角色数/修订次数/失败归因） */
    AGENT_SUMMARY: 'orch:agent:summary'
});

/** 全局执行次数上限（防止极端循环场景） */
const GLOBAL_EXEC_LIMIT = 200;

/** 默认全局 Session 并发上限（可通过环境变量 MAX_CONCURRENT_SESSIONS 覆盖） */
const DEFAULT_MAX_CONCURRENT_SESSIONS = 50;

/** 默认单任务 Session 并发上限（可通过 MAX_SESSIONS_PER_TASK 覆盖；0=不限制） */
const DEFAULT_MAX_SESSIONS_PER_TASK = 8;

/** 默认等待并发槽位的超时（ms），可通过 SEMAPHORE_ACQUIRE_TIMEOUT_MS 覆盖；0=无限等待 */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * F-26：属主心跳间隔（ms），可由 OWNER_HEARTBEAT_MS 覆盖。
 * 与 OrchestratorController 的 OWNER_STALE_MS 配合：心跳间隔必须显著小于过期阈值，
 * 否则正常运行的属主会被误判为已死。
 */
const DEFAULT_OWNER_HEARTBEAT_MS = 30000;

/**
 * 默认持久化合并窗口（ms），可通过 PERSIST_DEBOUNCE_MS 覆盖；0=关闭合并（每次都立即写）。
 *
 * 取值依据：步骤状态变更（_emitStepStatus）在 fan-out 场景下同一 tick 内会连发多次，
 * 300ms 足以把它们并成一次写，又短于前端 SSE 刷新感知（进度事件本身不经此路径）。
 */
const DEFAULT_PERSIST_DEBOUNCE_MS = 300;

/**
 * 解析持久化合并窗口。
 *
 * 优先级：显式传入（deps.persistDebounceMs） > 环境变量 PERSIST_DEBOUNCE_MS > 默认值。
 * 显式传入与合法环境变量均以"是否为有限非负数"判定，非法值回退默认值（不抛错，
 * 避免一个笔误的环境变量让整个编排起不来）。
 *
 * @param {number|string|undefined} override - 构造参数覆盖值
 * @returns {number} 合并窗口（ms），0 表示关闭合并
 */
function resolvePersistDebounceMs(override) {
    const pick = (v) => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
    };
    return pick(override) ?? pick(process.env.PERSIST_DEBOUNCE_MS) ?? DEFAULT_PERSIST_DEBOUNCE_MS;
}

// ─── 全局 Session 并发信号量 ─────────────────────────────────────────────────

/**
 * SessionSemaphore — 带「全局上限 + 单任务配额 + 获取超时」的异步信号量。
 *
 * 进程级单例（跨所有编排任务共享），限制同时活跃的 opencode Session 数
 * （即正在执行的 FlexRunner.executeStart 以及复用同一 session 的经验总结）。
 *
 * 相比初版（纯 FIFO + 无超时 + 无配额）的三处强化：
 *   1. **获取超时**（F-06）：acquire 支持 timeoutMs。没有超时的话，任何僵死的
 *      请求会永久占用槽位，累计到上限后整个进程的所有新任务永久饿死。
 *   2. **单任务配额**（F-08）：避免单个 fan-out 50 的仓库检视任务独占全部槽位、
 *      把其他任务饿死（无隔离时"全局上限"实际退化为"先到先得独占"）。
 *   3. **租约式释放**（防错配）：acquire 返回带 release() 的租约，调用方无需
 *      记住 key，也不会出现"释放次数与获取次数不匹配"导致的计数漂移。
 *
 * 排队策略：按等待顺序扫描，跳过会违反配额的等待者（避免队头阻塞），
 * 因此不是严格 FIFO——这是为了隔离性做的有意取舍。
 */
class Semaphore {
    /**
     * @param {object} [opts]
     * @param {number} [opts.limit]        - 全局并发上限（≥1）
     * @param {number} [opts.perTaskLimit] - 单任务并发上限（0=不限制）
     */
    constructor({ limit, perTaskLimit } = {}) {
        this._limit = Math.max(1, Number(limit) || DEFAULT_MAX_CONCURRENT_SESSIONS);
        this._perTaskLimit = Number.isFinite(Number(perTaskLimit))
            ? Math.max(0, Number(perTaskLimit))
            : DEFAULT_MAX_SESSIONS_PER_TASK;
        this._active = 0;
        /** @type {Array<{resolve: Function, settled: boolean, timer: any, key: string|null, enqueuedAt: number}>} */
        this._queue = [];
        /** @type {Map<string, number>} 单任务活跃数 */
        this._activeByKey = new Map();
        /** 累计统计（可观测性） */
        this._totalAcquired = 0;
        this._totalTimedOut = 0;
        this._waitedMsTotal = 0;
    }

    get limit() { return this._limit; }
    get active() { return this._active; }
    get waiting() { return this._queue.filter((w) => !w.settled).length; }
    get perTaskLimit() { return this._perTaskLimit; }

    /** 某任务的活跃会话数 */
    activeForKey(key) {
        if (key == null) return 0;
        return this._activeByKey.get(String(key)) ?? 0;
    }

    /**
     * 尝试把槽位派发给队列中可启动的等待者。
     * 同一 tick 内同步完成，因此不存在超发窗口。
     * @private
     */
    _dispatch() {
        for (let i = 0; i < this._queue.length; i++) {
            const w = this._queue[i];
            if (w.settled) {
                this._queue.splice(i, 1);
                i--;
                continue;
            }
            if (this._active >= this._limit) return;
            if (w.key != null && this._perTaskLimit > 0
                && this.activeForKey(w.key) >= this._perTaskLimit) {
                continue; // 该任务配额已满：跳过它，不让它阻塞后面的等待者
            }
            this._queue.splice(i, 1);
            i--;
            this._active++;
            if (w.key != null) {
                const k = String(w.key);
                this._activeByKey.set(k, (this._activeByKey.get(k) ?? 0) + 1);
            }
            if (w.timer) clearTimeout(w.timer);
            w.settled = true;
            this._waitedMsTotal += Date.now() - w.enqueuedAt;
            this._totalAcquired++;
            w.resolve(true);
        }
    }

    /**
     * 获取一个槽位。
     *
     * @param {object} [opts]
     * @param {number} [opts.timeoutMs=0] - 等待超时（ms）；0 表示无限等待
     * @param {string|null} [opts.key]    - 归属键（通常为 taskId），用于单任务配额
     * @returns {Promise<{ok: boolean, waitedMs: number, reason?: string, release: () => void}>}
     */
    async acquire({ timeoutMs = 0, key = null } = {}) {
        const t0 = Date.now();
        const lease = {
            released: false,
            release: () => {
                if (lease.released) return;
                lease.released = true;
                this._active = Math.max(0, this._active - 1);
                if (key != null) {
                    const k = String(key);
                    const n = (this._activeByKey.get(k) ?? 1) - 1;
                    if (n <= 0) this._activeByKey.delete(k); else this._activeByKey.set(k, n);
                }
                this._dispatch();
            },
        };

        if (this._active < this._limit
            && (key == null || this._perTaskLimit === 0 || this.activeForKey(key) < this._perTaskLimit)) {
            this._active++;
            if (key != null) {
                const k = String(key);
                this._activeByKey.set(k, (this._activeByKey.get(k) ?? 0) + 1);
            }
            this._totalAcquired++;
            return { ok: true, waitedMs: 0, release: lease.release };
        }

        let timer = null;
        const waiter = { resolve: null, settled: false, timer: null, key, enqueuedAt: t0 };
        const ok = await new Promise((resolve) => {
            waiter.resolve = resolve;
            this._queue.push(waiter);
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    if (waiter.settled) return;
                    waiter.settled = true;
                    const i = this._queue.indexOf(waiter);
                    if (i !== -1) this._queue.splice(i, 1);
                    this._totalTimedOut++;
                    resolve(false);
                }, timeoutMs);
                waiter.timer = timer;
            }
        });
        if (timer) clearTimeout(timer);

        const waitedMs = Date.now() - t0;
        if (!ok) {
            return { ok: false, waitedMs, reason: 'timeout', release: () => {} };
        }
        return { ok: true, waitedMs, release: lease.release };
    }

    /** 并发占用快照（供 HTTP 统计接口 / 前端展示） */
    stats() {
        const perTask = {};
        for (const [k, v] of this._activeByKey) perTask[k] = v;
        return {
            active: this._active,
            limit: this._limit,
            perTaskLimit: this._perTaskLimit,
            waiting: this.waiting,
            utilization: this._limit > 0 ? Math.round((this._active / this._limit) * 100) : 0,
            totalAcquired: this._totalAcquired,
            totalTimedOut: this._totalTimedOut,
            avgWaitedMs: this._totalAcquired > 0
                ? Math.round(this._waitedMsTotal / this._totalAcquired)
                : 0,
            perTask,
        };
    }

    /** 兼容旧 API：无租约地释放一个全局槽位（不推荐，仅用于遗留调用点） */
    release() {
        this._active = Math.max(0, this._active - 1);
        this._dispatch();
    }
}

/** 进程级全局 Session 并发信号量（所有 Orchestrator 实例共享） */
const globalSessionSemaphore = new Semaphore({
    limit: Number(process.env.MAX_CONCURRENT_SESSIONS) || DEFAULT_MAX_CONCURRENT_SESSIONS,
    perTaskLimit: process.env.MAX_SESSIONS_PER_TASK != null && process.env.MAX_SESSIONS_PER_TASK !== ''
        ? Number(process.env.MAX_SESSIONS_PER_TASK)
        : DEFAULT_MAX_SESSIONS_PER_TASK,
});

/**
 * 查询全局 Session 并发占用快照（供 HTTP 统计接口 / 前端顶栏展示）。
 * @returns {{active: number, limit: number, waiting: number, utilization: number,
 *            perTaskLimit: number, perTask: object, totalTimedOut: number, avgWaitedMs: number}}
 */
export function getSessionSemaphoreStats() {
    return globalSessionSemaphore.stats();
}

/**
 * 进程级共享的角色级限流器（Phase 3，第三级限流）。
 *
 * 上限来源：`MAX_SESSIONS_PER_ROLE`（统一默认）与 `ROLE_LIMIT_<ROLE>`（单角色）。
 * **全部默认 0 = 不限制**，即未配置时行为与 Phase 2 完全一致——与
 * `MULTI_AGENT_ENABLED` 一样遵循"合并代码不改变默认行为"的原则。
 *
 * 迁移前这里是模块级的 `new RoleLimiter()`（import 即构造）。插件内不能静态 import
 * `Server/Agent/Runtime/RoleLimiter.js`（架构守卫 R2），而下面两个导出是**同步**的
 * 模块级函数，所以改成「首次使用时同步构造」：
 *   - 单例语义不变（`_globalRoleLimiter` 仍是每进程一份）；
 *   - `RoleLimiter` 的构造只读环境变量（`MAX_SESSIONS_PER_ROLE` / `ROLE_LIMIT_<ROLE>`），
 *     不触外部资源，延迟构造没有副作用；
 *   - 无宿主且门面未被 import 时，`getRoleLimiterStats()` / `setRoleLimit()` 会抛
 *     点名 `'role-limiter'` 的错误，而不是悄悄返回一个"没有登记任何上限"的空限流器。
 *
 * @type {object|null}
 */
let _globalRoleLimiter = null;

/**
 * 取进程级角色限流器单例（首次调用时构造）。
 * @returns {object}
 * @throws {Error} 兜底 `'role-limiter'` 既未登记也无活跃宿主接缝时
 * @private
 */
function _roleLimiterSingleton() {
    if (!_globalRoleLimiter) {
        const RoleLimiter = resolveFallbackSync('role-limiter');
        _globalRoleLimiter = new RoleLimiter();
    }
    return _globalRoleLimiter;
}

/**
 * 进程级角色限流统计（经 `GET /api/stats/agents` 暴露）。
 * @returns {object}
 */
export function getRoleLimiterStats() {
    return _roleLimiterSingleton().getStats();
}

/**
 * 运行期调整某角色的并发上限（运维手段：发现某角色饿死其它角色时可即时放宽/收紧）。
 * @param {string} roleId
 * @param {number} limit - 0 = 不限制
 * @returns {number} 生效后的上限
 */
export function setRoleLimit(roleId, limit) {
    return _roleLimiterSingleton().setLimit(roleId, limit);
}

// ─── Orchestrator 类 ─────────────────────────────────────────────────────────

class Orchestrator {
    /**
     * @param {object} deps - 依赖注入
     * @param {object} [deps.sseHub]      - SseHub 实例（可选，无则不推送）
     * @param {object} [deps.storage]     - 存储门面（可选，无则不持久化）
     * @param {function} [deps.flexRunnerFactory] - FlexRunner 工厂函数（可选，测试用）
     * @param {object} [deps.sessionSemaphore] - Session 并发信号量（可选，默认进程级全局单例）
     * @param {function} [deps.multiAgentRunnerFactory] - 多 Agent 运行器工厂（Phase 2，可选）
     * @param {boolean} [deps.multiAgentEnabled] - 是否启用多 Agent（默认读环境变量 MULTI_AGENT_ENABLED）
     * @param {object} [deps.roleRegistry] - 角色注册表（Phase 2，可选）
     */
    constructor(deps = {}) {
        this.sseHub = deps.sseHub || null;
        this.storage = deps.storage || null;
        this.flexRunnerFactory = deps.flexRunnerFactory || null;
        // 全局 Session 并发限制（进程级共享；测试可注入自定义信号量）
        this.sessionSemaphore = deps.sessionSemaphore || globalSessionSemaphore;

        // ── Phase 2：多 Agent 协作（默认关闭 → 行为与 Phase 1 完全一致）──
        /**
         * @type {function|null} 多 Agent 运行器工厂。
         * 签名 `(node, inputReport, ctx) => Promise<Runner>`；
         * 未注入时使用内置的 `MultiAgentRunner`（惰性加载，避免未启用时引入依赖）。
         */
        this.multiAgentRunnerFactory = deps.multiAgentRunnerFactory || null;
        /**
         * @type {boolean} 是否启用多 Agent。
         * 默认读 `MULTI_AGENT_ENABLED`（需显式为 '1' 或 'true'）。
         * 采用"默认关闭"是刻意的：合并代码不应顺带改变生产行为；
         * 启用是显式决策，且现有 5 个测试套件（389 条断言）在关闭态必须全绿。
         */
        this.multiAgentEnabled = deps.multiAgentEnabled === undefined
            ? (process.env.MULTI_AGENT_ENABLED === '1' || String(process.env.MULTI_AGENT_ENABLED).toLowerCase() === 'true')
            : deps.multiAgentEnabled === true;
        /** @type {object|null} 角色注册表（Phase 2） */
        this.roleRegistry = deps.roleRegistry || null;
        /** @type {object} 多 Agent 相关统计 */
        this._multiAgentStats = { steps: 0, roleRuns: 0, revisions: 0, failures: {} };

        // ── Phase 3：高并发能力 ──
        /**
         * @type {AbortTree} 取消树（task → step → role → HTTP 请求）。
         *
         * 与 Phase 1 的"平铺式取消"相比，树的关键增益是**取消后新派生的节点立即为取消态**：
         * 平铺实现里 `abort()` 只遍历当时正在运行的节点，此后被激活的步骤仍会照常启动
         * （Phase 1 靠编排层的 `_aborted` 标志兜底，但角色会话层没有等价保护）。
         */
        this.abortTree = deps.abortTree || new AbortTree();
        /** @type {AbortNode|null} 任务级取消节点（步骤级节点挂在它下面） */
        this._taskAbortNode = null;
        /**
         * @type {object|null} Phase 3：角色级限流器（第三级限流）。
         * 未注入时由 `_createMultiAgentRunner` 使用进程级共享实例。
         */
        this.roleLimiter = deps.roleLimiter || null;
        /** @type {object|null} Phase 3：会话事件源（事件驱动替代轮询） */
        this.sessionEvents = deps.sessionEvents || null;

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
        /**
         * @type {string[][]} 任务定义中检测到的**环**（F-18）。
         *
         * 背景澄清：项目文档曾把"重复步骤 → 阻塞"归因于一个 `_execPathTrace` 字段，
         * 而该字段只被声明与 clear、从未被读取（死代码）。但**并非**"该语义未生效"——
         * 真正实施它的是 `_activateNextStep()` 的守卫：已 COMPLETED 的节点不会被
         * `nextStepId` 再次激活（只有 failStepId 修复链与 FAILED 未耗尽重试两条
         * 显式路径允许重复执行）。因此这里不是"补上缺失的检测"，而是补上一项
         * **语义正确且原本确实缺失**的能力：加载期识别任务定义中的环。
         *
         * 环本身合法（failStepId 修复链就是环），但需要显式暴露出来，因为
         *   - 环会让任务在 GLOBAL_EXEC_LIMIT 内反复执行，耗时远超预期；
         *   - 无意的环（nextStepId 写错指回前面步骤）是常见的 taskDef 编排错误。
         * 运行时兜底仍由 GLOBAL_EXEC_LIMIT(200) 与每节点 maxRetries 负责。
         */
        this._cycles = [];
        /** @type {Set<string>} 修复步骤集合：被其它步骤 failStepId 指向的 stepId。
         *  这些节点语义上"仅由某步骤失败时经 failStepId 进入"，不应被 dependId fan-out 并行激活。 */
        this._fixStepIds = new Set();
        /** @type {Map<string, Promise<void>>} 在途执行追踪：key = stepId，value = _executeNode 的 Promise。
         *  流水线式调度：步骤完成的尾部级联立即启动新就绪节点，
         *  _scheduleLoop 通过 Promise.race 感知任意节点完成，无需等整批结束。 */
        this._inFlight = new Map();

        // ── 持久化串行化 + 写合并 ──
        // _persistState 可能被并发调用（如步骤状态变更回调中 fire-and-forget 触发）。
        // 多个 writeFile 同时操作同一文件会导致截断/拼接竞态，产生损坏的 JSON。
        // 用 Promise 链串行化所有持久化写入，后一次等待前一次完成后再执行。
        /** @type {Promise<void>} */
        this._persistChain = Promise.resolve();

        /** @type {any} F-26：属主心跳定时器（unref，不阻止进程退出） */
        this._ownerHeartbeatTimer = null;
        // 写合并（F-11）：_emitStepStatus 每次步骤状态变更都会触发持久化，而每次
        // 持久化要写两份含全部步骤完整 history 的 JSON（orchestration_loop{N}.json +
        // orchestration.json）。N 步任务下即为 ~4N 次"全量文件"写、总字节 O(N²)。
        // 窗口内合并为一次写入，且写入时才取最新快照（见 _persistStateNow）。
        /** @type {number} 合并窗口（ms），0 = 关闭合并（每次都立即写） */
        this._persistDebounceMs = resolvePersistDebounceMs(deps.persistDebounceMs);
        /** @type {NodeJS.Timeout|null} 待触发的合并定时器 */
        this._persistTimer = null;
        /** @type {boolean} 是否处于一个合并窗口内（窗口内后续请求被吸收） */
        this._persistPending = false;
        /** @type {number} 实际落盘次数（可观测/可测试） */
        this._persistWrites = 0;
        /** @type {number} 被合并掉的持久化请求数（可观测/可测试） */
        this._persistCoalesced = 0;
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
        // F-18：加载期静态环检测（取代从未生效的 _execPathTrace）
        this._detectCycles();

        this._log('info', `任务已加载: taskId=${this._taskId}, 步骤数=${this._nodes.size}, 入口步骤=${this._entryStepIds.join(',')}`);

        // 持久化初始状态（关键跃迁：任务定义落盘后才能被其他进程/重启发现，强制立即写）
        await this._persistState({ force: true });
    }

    /**
     * F-18：加载期静态环检测。
     *
     * 边集合 = nextStepId ∪ failStepId ∪ dependId（仅保留指向已定义步骤的边）。
     * 用迭代式 DFS 找出所有环（Tarjan 风格的强连通分量思路）：任一 SCC 大小 > 1，
     * 或节点存在自环，即为一个环。
     *
     * 语义取舍：**环不报错**。failStepId 修复链（A 失败→B 修复→回 A 重试）天然成环，
     * 报错会误伤正确用法。这里只做"显式暴露"：warn 日志 + 写入 progress，
     * 让编排者能立刻发现"任务定义里有个环，可能不是有意的"。
     *
     * 运行时兜底不变：GLOBAL_EXEC_LIMIT(200) + 每节点 maxRetries。
     *
     * @private
     */
    _detectCycles() {
        this._cycles = [];
        const nodes = [...this._nodes.values()];
        /** 邻接表：stepId → 后继 stepId[] */
        const adj = new Map();
        for (const n of nodes) adj.set(n.stepId, []);
        for (const n of nodes) {
            // nextStepId / failStepId 本身就是"执行顺序"边：n → target
            for (const target of [n.nextStepId, n.failStepId]) {
                if (target !== '0' && this._nodes.has(target)) adj.get(n.stepId).push(target);
            }
            // dependId 的方向必须反过来：语义是"n 依赖 dep"，因此执行方向是 dep → n。
            // 若误当作 n → dep，会与 nextStepId 组合出**假环**——
            // 例如线性链 1→2→3（2.dependId=1、3.dependId=2）会被误判成环。
            for (const dep of n.dependencies) {
                if (this._nodes.has(dep)) adj.get(dep).push(n.stepId);
            }
        }

        // Tarjan 强连通分量（迭代实现，避免深图递归爆栈）
        const index = new Map();
        const low = new Map();
        const onStack = new Set();
        const stack = [];
        let counter = 0;

        for (const startNode of nodes) {
            if (index.has(startNode.stepId)) continue;

            /** @type {Array<{id: string, edgeIdx: number}>} */
            const callStack = [{ id: startNode.stepId, edgeIdx: 0 }];
            index.set(startNode.stepId, counter);
            low.set(startNode.stepId, counter);
            counter++;
            stack.push(startNode.stepId);
            onStack.add(startNode.stepId);

            while (callStack.length > 0) {
                const frame = callStack[callStack.length - 1];
                const edges = adj.get(frame.id) ?? [];

                if (frame.edgeIdx < edges.length) {
                    const next = edges[frame.edgeIdx];
                    frame.edgeIdx++;
                    if (!index.has(next)) {
                        index.set(next, counter);
                        low.set(next, counter);
                        counter++;
                        stack.push(next);
                        onStack.add(next);
                        callStack.push({ id: next, edgeIdx: 0 });
                    } else if (onStack.has(next)) {
                        low.set(frame.id, Math.min(low.get(frame.id), index.get(next)));
                    }
                } else {
                    callStack.pop();
                    if (callStack.length > 0) {
                        const parent = callStack[callStack.length - 1];
                        low.set(parent.id, Math.min(low.get(parent.id), low.get(frame.id)));
                    }
                    if (low.get(frame.id) === index.get(frame.id)) {
                        const scc = [];
                        let popped;
                        do {
                            popped = stack.pop();
                            onStack.delete(popped);
                            scc.push(popped);
                        } while (popped !== frame.id);
                        // SCC 大小 > 1 → 环；自环（大小为 1 且自指）也计入
                        if (scc.length > 1) {
                            this._cycles.push(scc.sort((a, b) => Number(a) - Number(b)));
                        } else if ((adj.get(scc[0]) ?? []).includes(scc[0])) {
                            this._cycles.push(scc);
                        }
                    }
                }
            }
        }

        if (this._cycles.length > 0) {
            const desc = this._cycles.map((c) => `[${c.join(' → ')}]`).join('、');
            this._log('warn',
                `检测到 ${this._cycles.length} 个环: ${desc}。` +
                `环本身合法（failStepId 修复链即为此形态），但会导致步骤反复执行；` +
                `若并非有意，请检查 nextStepId / failStepId 是否指回前序步骤。` +
                `运行时由全局执行上限 ${GLOBAL_EXEC_LIMIT} 与各步骤 maxRetries 兜底。`);
        }
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

        // 启动前终止检查：load 与 start 之间的窗口期内收到 abort → 不执行任何步骤
        if (this._aborted) {
            this._status = OrchestratorStatus.ABORTED;
            this._endTime = nowCST();
            this._log('warn', 'start: 任务在启动前已被终止，不执行任何步骤');
            this._emit(SSE_EVENT.TASK_ABORTED, this.getProgress());
            // 关键跃迁（任务终态）：必须立即落盘，不能被合并窗口延迟
            await this._persistState({ force: true });
            return { status: this._status, summary: this.getProgress() };
        }

        this._status = OrchestratorStatus.RUNNING;
        this._startTime = nowCST();
        // Phase 3：建立任务级取消节点（步骤级节点在其下派生）。
        // 在 emit/persist 之前建立，保证"一启动即可被级联取消"。
        this._taskAbortNode = this.abortTree.createRoot(`task:${this._taskId}`);
        this._emit(SSE_EVENT.TASK_START, this.getProgress());
        // 关键跃迁（编排启动）：立即落盘，使 running 状态与 owner.json 一起可见
        await this._persistState({ force: true });
        // 写入属主标记（pid/hostname）：标识本编排由当前进程执行。
        // 服务重启时 restoreFromDisk 据此判定 running 任务的归属——
        // 属主进程仍存活（如 3rdloop run 嵌入式 CLI）则跳过，不误标 FAILED。
        await this._writeOwnerFile();
        // F-26：启动属主心跳，使归属判定同时具备「pid 存活」与「心跳新鲜」两个证据
        this._startOwnerHeartbeat();

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
                // 既未全部成功，也无 running/ready：分两种情况，语义完全不同。
                //
                // 旧实现把两者一律标为 DEADLOCKED 并给出"可能死锁或失败链终止"的
                // 含糊原因，导致"某步失败且无 failStepId、链正常终止"这种**常见且
                // 合理**的结局被报成"死锁"——运维看到"死锁"会去排查调度器缺陷，
                // 实际只是产物没通过。这里拆开：
                //   - 存在 FAILED 步骤 → FAILED（失败链终止），原因点明是哪些步骤失败；
                //   - 不存在 FAILED 但仍有 PENDING 步骤 → 才是真死锁（前置永远无法满足）。
                const hasRunning = Array.from(this._nodes.values()).some(n => n.isRunning);
                const hasReady = Array.from(this._nodes.values()).some(n => n.status === NodeStatus.READY);
                if (hasRunning || hasReady) {
                    this._status = OrchestratorStatus.FAILED;
                } else {
                    const failedNodes = Array.from(this._nodes.values())
                        .filter(n => n.status === NodeStatus.FAILED);
                    const pendingNodes = Array.from(this._nodes.values())
                        .filter(n => n.status === NodeStatus.PENDING);

                    if (failedNodes.length > 0) {
                        this._status = OrchestratorStatus.FAILED;
                        const desc = failedNodes
                            .map(n => `step${n.stepId}（${n.error || '未达成功条件'}）`)
                            .join('、');
                        this._error = `失败链终止：${desc}。` +
                            (pendingNodes.length > 0
                                ? ` 另有 ${pendingNodes.length} 个后续步骤因前置失败而未能执行。`
                                : '');
                    } else {
                        this._status = OrchestratorStatus.DEADLOCKED;
                        this._error = `死锁：${pendingNodes.length} 个步骤仍为 pending，` +
                            `但其前置依赖无法满足（无失败步骤可归因，请检查依赖图是否存在不可达前置）。`;
                    }
                }
            }
            this._emit(SSE_EVENT.TASK_COMPLETE, {
                status: this._status,
                progress: this.getProgress()
            });
        }

        this._log('info', `── 编排执行结束: status=${this._status} ──`);
        // 关键跃迁（任务终态）：立即落盘，确保服务重启时读到的是真实终态而非中间态
        await this._persistState({ force: true });
        // 已到终态，属主标记失效，清理（先持久化终态再清理，崩溃窗口内重启仍可正确判定）
        await this._deleteOwnerFile();
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
        // Phase 3：释放取消树的根节点。
        // 不释放会让 `getStats().orphans` 恒 ≥ 1（根节点在任务结束后必然是
        // "已取消但未摘除"），使这个本该回答"有没有泄漏"的指标失去分辨力——
        // **一个永远不为零的泄漏指标等于没有指标**。
        this._taskAbortNode?.dispose();
        this._taskAbortNode = null;
        this._disposed = true;
    }

    /**
     * 主调度循环（流水线式事件驱动）。
     *
     * 与旧的"轮次式"（每轮收集一批 READY → Promise.all → 等整批完成）不同：
     * 任一在途步骤完成时，其尾部级联已把新就绪的后续步骤投入执行（见 _executeNode 尾部 / _kick），
     * 因此这里只需：
     *   1. 首轮把全部 READY 节点 _kick
     *   2. Promise.race 任意在途完成即重新扫描（此时尾部队列已注入新节点）
     *   3. 无在途也无 READY → 调度结束
     *
     * 效果：步骤完成即刻启动依赖它的下一步骤（如步骤4 完成 → 步骤6 立即启动），
     * 不再被同批次慢步骤（如步骤5）拖累；总耗时趋近 DAG 关键路径而非批次累计。
     * fan-in 聚合、execPath 循环检测、GLOBAL_EXEC_LIMIT、abort 语义均不变。
     *
     * @private
     */
    async _scheduleLoop() {
        let limitReported = false;
        while (!this._aborted) {
            // ── 全局执行次数保护 ──
            //
            // ⚠️ 这里修掉了一个**在高并发下才会暴露的严重缺陷**（Phase 3 压测发现）：
            // 早先的实现是「达到上限 → 记错误 → 直接 return」，即**放弃所有在途步骤的等待**。
            // 触发链路：任务的就绪步骤数 > GLOBAL_EXEC_LIMIT(200) 时，第一轮就把
            // 200 个步骤 kick 出去（`_globalExecCount` 同步自增到 200），
            // 某个步骤完成后回到循环顶部 → 命中上限 → **立即返回**。
            // 实测（260 个步骤、200 个在途会话）：`start()` 返回时
            // `completed=1 / running=199 / ready=60`，编排报告"已结束"，
            // 而 **199 个会话仍在运行** —— 上层据此 dispose/持久化并认为可以停机，
            // 真实部署下就是"编排显示完成，实际有近 200 个会话继续烧 token"。
            //
            // 正确的语义是：**停止启动新步骤，但必须把在途步骤等完**。
            // 这样 GLOBAL_EXEC_LIMIT 仍然是"总执行次数上限"（防环能力不变），
            // 而"编排结束"重新成为可信信号。
            if (this._globalExecCount >= GLOBAL_EXEC_LIMIT) {
                if (!limitReported) {
                    limitReported = true;
                    this._error = `全局执行次数已达上限 ${GLOBAL_EXEC_LIMIT}，不再启动新步骤（等待在途步骤收尾）`;
                    this._log('error', this._error);
                }
                if (this._inFlight.size === 0) {
                    this._log('info', '调度循环结束：已达全局执行上限且在途步骤全部收尾');
                    return;
                }
                await Promise.race(this._inFlight.values());
                continue;
            }

            // 启动所有就绪节点
            for (const node of this._nodes.values()) {
                if (node.status === NodeStatus.READY) {
                    this._kick(node);
                }
            }

            // 无可执行也无在途 → 调度结束
            if (this._inFlight.size === 0) {
                this._log('info', '调度循环结束：无可执行步骤');
                return;
            }

            // 等待任意在途完成（其尾部级联会把新 READY 节点立刻变为在途），
            // 完成后再回到循环顶部重新扫描。
            await Promise.race(this._inFlight.values());
        }
    }

    /**
     * 启动一个就绪步骤（幂等，防重入）。
     *
     * - 仅当节点状态为 READY 且未超 GLOBAL_EXEC_LIMIT 时才真正执行；
     * - 执行 Promise 记入 _inFlight（stepId → Promise），完成后移除；
     * - _scheduleLoop 与 _executeNode 尾部级联均通过此方法启动节点，
     *   READY → RUNNING 状态转换保证同一节点不会被重复启动。
     *
     * @param {StepNode} node
     * @private
     */
    _kick(node) {
        const stepId = node.stepId;
        // 幂等：仅启动 READY 节点；RUNNING/PENDING/终态节点不重复入队
        if (node.status !== NodeStatus.READY) return;
        // 全局执行上限兜底（含尾部级联触发的启动）
        if (this._globalExecCount >= GLOBAL_EXEC_LIMIT) return;
        if (this._inFlight.has(stepId)) return;

        const promise = this._executeNode(node);
        this._inFlight.set(stepId, promise);
        promise.finally(() => {
            this._inFlight.delete(stepId);
        }).catch(err => {
            this._log('error', `步骤 ${stepId} 调度异常: ${err.message}`);
        });
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
        // 调度前终止检查：终止已请求 → 不创建 FlexRunner、不启动 session，直接跳过
        if (this._aborted) {
            node.markSkipped('编排已终止');
            this._emitStepStatus(node);
            return;
        }

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

            // Runner 创建期间收到终止请求 → 不执行（session 将不会被创建）
            if (this._aborted) {
                throw new Error('步骤被终止（Runner 初始化期间收到终止请求）');
            }

            // 单次执行（不再原地重试）。
            // 失败后由 _activateNextStep 跳转 failStepId（未达 maxRetries），
            // 或终止流程（已达 maxRetries）。每次调用 markRunning() 递增 retryCount，
            // 用于累计该步骤的总运行次数（maxRetries 上限判定）。
            node.markRunning();

            this._log('info', `执行步骤 ${node.stepId}（第 ${node.retryCount} 次）`);

            // 步骤开始：实时落 SQLite（db/TaskStep/store.db）。
            // running 记录先行写入，进程崩溃/重启时 db 中保留崩溃前真实状态。
            await this._persistStepDb(node);

            // ── Session 并发准入（全局上限 + 单任务配额 + 获取超时）──
            // F-06/F-08：等待槽位必须有超时——否则任何僵死会话会永久占用槽位，
            // 累计到上限后整个进程的所有新任务永久饿死；同时按 taskId 限配额，
            // 避免单个大 fan-out 任务独占全部槽位把其他任务饿死。
            //
            // Phase 2：多 Agent 运行器声明 `managesOwnConcurrency = true` 时，
            // **跳过**这里的预占——因为它会在一个步骤内创建 N 个角色会话，
            // 每个角色各自取槽位。若此处仍预占一个，就会出现"槽位被重复占用"：
            // 全局上限 50 的配置实际只能跑十几个会话（见 MultiAgentRunner 文档）。
            const delegatesConcurrency = runner.managesOwnConcurrency === true;
            let sem;
            if (delegatesConcurrency) {
                sem = { ok: true, waitedMs: 0, release() {} };
                this._log('debug',
                    `步骤 ${node.stepId} 的运行器自行管理会话并发（多 Agent），跳过编排层槽位预占`);
            } else {
                const acquireTimeoutMs = Number(process.env.SEMAPHORE_ACQUIRE_TIMEOUT_MS);
                sem = await this.sessionSemaphore.acquire({
                    timeoutMs: Number.isFinite(acquireTimeoutMs) && acquireTimeoutMs >= 0
                        ? acquireTimeoutMs
                        : DEFAULT_ACQUIRE_TIMEOUT_MS,
                    key: this._taskId,
                });
            }
            const semWaited = sem.waitedMs;
            if (!sem.ok) {
                this._log('error',
                    `步骤 ${node.stepId} 等待并发槽位超时（${semWaited}ms，` +
                    `active=${this.sessionSemaphore.active}/${this.sessionSemaphore.limit}，` +
                    `本任务占用=${this.sessionSemaphore.activeForKey?.(this._taskId) ?? '?'}）`);
                throw new Error(`等待并发槽位超时（${semWaited}ms）`);
            }
            if (semWaited > 100) {
                this._log('info', `步骤 ${node.stepId} 等待并发槽位 ${semWaited}ms（active=${this.sessionSemaphore.active}/${this.sessionSemaphore.limit}）`);
            }

            // 等待槽位期间收到终止请求 → 不启动 executeStart（session 将不会被创建）
            if (this._aborted) {
                sem.release();
                this._log('warn', `步骤 ${node.stepId} 在等待并发槽位时被终止，跳过执行`);
                throw new Error('步骤被终止（等待并发槽位期间收到终止请求）');
            }

            // 说明（F-07）：经验总结（fire-and-forget）复用同一 session 调
            // sendAndWaitMessage，且发生在 executeStart 返回、槽位释放之后。
            // 为把它计入并发上限，FlexRunner 持有同一信号量并**自行再取一个槽位**
            // （见 _summarizeExperience），因此总并发 = 执行中步骤 + 在途总结，
            // 两者共用同一上限，不会出现"上限翻倍"的超发。
            let result;
            try {
                result = await runner.executeStart();
            } finally {
                sem.release();
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

        // ── Phase 2/3：先把协作结论**取回来**，再决定步骤的失败原因 ──
        // 顺序很关键：多 Agent 运行器以「返回 success:false」表达失败（而不是抛异常），
        // 因此 `errorMsg` 在异常路径之外是 null。若不从协作摘要里回填，
        // `node.error` 会一直是 null —— 表现为"步骤失败了但看不到任何原因"，
        // 直接违背 F-27 确立的"失败必须可归因"原则（实测：挂起会话被超时回收后
        // 步骤 error 为空，只能靠翻协作面板才知道是角色超时）。
        const runnerRef = node._runner;
        let collab = null;
        if (runnerRef && typeof runnerRef.getCollaborationSummary === 'function') {
            try {
                collab = runnerRef.getCollaborationSummary();
            } catch (err) {
                this._log('warn', `采集协作摘要失败（不影响流程）: ${err.message}`);
            }
        }
        if (!success && !errorMsg && collab?.error) {
            errorMsg = `[协作失败 ${collab.failureKind || '未知'}] ${collab.error}`;
        }

        // 标记完成状态
        node.markFinished({ success, resultPath, sessionId, error: errorMsg, metrics });

        // 协作结论快照到节点上：运行器实例会在编排结束后被 dispose
        // （`node._runner = null`），若只留在运行器上，用户事后点开步骤详情就什么都看不到。
        if (collab) {
            try {
                node.collaborationSummary = collab;
                node.agentTopology = {
                    plan: collab.plan || null,
                    topology: collab.topology || null,
                    stageRuns: collab.stageRuns || []
                };
                const s = this._multiAgentStats;
                s.steps++;
                s.roleRuns += collab.roleRuns || 0;
                s.revisions += Object.values(collab.revisions || {}).reduce((a, b) => a + b, 0);
                if (collab.failureKind) s.failures[collab.failureKind] = (s.failures[collab.failureKind] || 0) + 1;
            } catch (err) {
                this._log('warn', `记录协作摘要失败（不影响流程）: ${err.message}`);
            }
        }

        this._emitStepStatus(node);

        // 步骤终态：实时落 SQLite（completed/error + 输出/metrics/耗时）
        await this._persistStepDb(node);

        // 已被终止：整条链终止，不再激活后续步骤（nextStepId / failStepId 均不流转）
        if (this._aborted) {
            this._currentStepId = null;
            return;
        }

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

        // 级联启动：本步骤完成激活的新就绪节点应立即投入执行（流水线式），
        // 无需等 _scheduleLoop 下一轮扫描（同一批次中其他慢步骤可能仍在运行）。
        // 步骤4 完成 → 步骤6 即刻启动，不再被步骤5 拖累。
        // 幂等由 _kick 的 READY→RUNNING 转换保证；abort 分支在尾部级联前已 return。
        for (const candid of this._nodes.values()) {
            if (candid.status === NodeStatus.READY) {
                this._kick(candid);
            }
        }

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

        // nextStepId 成功路径：激活待执行节点（PENDING/READY），
        // 或重试修复链中已 FAILED 但未用尽 maxRetries 的节点
        // （如 failStepId 跳回修复后成功后，再次走 nextStepId 到原失败节点）。
        if (!allowCompleted && !nextNode.isPending) {
            const canReenterFromFailed =
                nextNode.status === NodeStatus.FAILED &&
                nextNode.retryCount < nextNode.maxRetries;
            if (!canReenterFromFailed) {
                // 已执行或运行中（且非失败可重试），不重复激活
                return;
            }
        }

        // failStepId 修复路径：允许重复执行已 completed/failed 节点，
        // 但跳过正在运行/已就绪（避免重复入队）
        if (allowCompleted && (nextNode.isRunning || nextNode.status === NodeStatus.READY)) {
            return;
        }

        // 聚合条件：目标节点的所有前置依赖必须已完成（fan-in）
        if (forceDependCheck && !this._allDependenciesCompleted(nextNode)) {
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
        // ── Phase 2：多 Agent 运行器分派（**优先级高于注入的 flexRunnerFactory**）──
        // 顺序必须如此：多 Agent 是"把步骤展开为角色子图"的**运行器实现选择**，
        // 而 flexRunnerFactory 是"给我一个单角色运行器"的注入点。
        // 若先看 flexRunnerFactory 就会短路掉分派：明明开了多 Agent，
        // 却因为测试/上层注入了工厂而静默退回单角色（实测踩到过，见 C3/C6 用例）。
        // 判定顺序（步骤级配置优先于全局开关）：
        //   1. node.multiAgent === false → 强制单角色（即使全局已启用）
        //   2. node.multiAgent === true  → 强制多 Agent
        //   3. 否则跟随 this.multiAgentEnabled（默认关闭）
        const wantMultiAgent = node.multiAgent === null
            ? this.multiAgentEnabled
            : node.multiAgent;

        if (wantMultiAgent) {
            const runner = await this._createMultiAgentRunner(node, inputReport);
            if (runner) return runner;
            // 多 Agent 创建失败（如未安装依赖 / 计划名写错）时不静默跳过，
            // 而是记录后回退单角色，保证"任务能跑完"优先于"必须用多 Agent"。
            this._log('warn', `步骤 ${node.stepId} 多 Agent 运行器创建失败，回退单角色模式`);
        }

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
            // F-07：共享进程级信号量，使经验总结的会话占用也计入并发上限
            sessionSemaphore: this.sessionSemaphore,
            // F-17：注入共享存储门面。不注入时每个 FlexRunner 都会自行
            // createStorage() → 各自的 StorageManager → 各自一个指向同一个
            // store.db 的 SQLite 连接；并发 50 步就是 50 个连接，写竞争被显著放大。
            storage: this.storage,
            // Session 创建后实时同步到 StepNode 并推送 SSE，保证运行中前端能拿到 sessionId
            onSessionCreated: (sessionId) => {
                node.sessionId = sessionId || '';
                this._emitStepStatus(node);
            }
        });
        return runner;
    }

    /**
     * 创建并初始化多 Agent 运行器（Phase 2）。
     *
     * @param {StepNode} node
     * @param {string} inputReport
     * @returns {Promise<object|null>} 运行器；无法创建时返回 null（调用方回退单角色）
     * @private
     */
    async _createMultiAgentRunner(node, inputReport) {
        const onEvent = (type, data) => this._emit(type, data);

        try {
            let runner;
            if (this.multiAgentRunnerFactory) {
                runner = await this.multiAgentRunnerFactory(node, inputReport, {
                    sessionSemaphore: this.sessionSemaphore,
                    storage: this.storage,
                    onEvent,
                    taskId: this._taskId,
                    // Phase 3
                    roleLimiter: this._roleLimiterInstance(),
                    sessionEvents: this.sessionEvents,
                    abortTree: this.abortTree,
                    taskAbortNode: this._taskAbortNode
                });
            } else {
                // 惰性加载：未启用多 Agent 时完全不加载该模块（及其依赖）。
                // 迁移前是 `await import('../Agent/Supervisor/MultiAgentRunner.js')`；
                // 插件不得引用 Server/（R2），改走兜底加载器——它同样是惰性的，
                // 因此"未启用多 Agent 就不加载 MultiAgentRunner"的时机完全不变。
                const MultiAgentRunner = await resolveFallback('multi-agent-runner');
                runner = new MultiAgentRunner({
                    sessionSemaphore: this.sessionSemaphore,
                    onEvent,
                    // Phase 3：三级限流 / 事件驱动 / 取消树
                    roleLimiter: this._roleLimiterInstance(),
                    sessionEvents: this.sessionEvents,
                    abortTree: this.abortTree,
                    taskAbortNode: this._taskAbortNode,
                    ...(this.roleRegistry ? { registry: this.roleRegistry } : {})
                });
            }
            if (!runner) return null;

            await runner.initContext({
                taskId: this._taskId,
                stepId: Number(node.stepId) || 0,
                dependId: Number(node.dependencies[0]) || 0,
                nextStepId: Number(node.nextStepId) || 0,
                failStepId: Number(node.failStepId) || 0,
                taskDescription: node.taskDescription,
                skillDirectory: node.skillDirectory,
                specifiedSkill: node.specifiedSkill,
                taskDir: node.taskDir,
                inputReport,
                maxRetries: node.maxRetries,
                bigLoopIndex: this._loopCount,
                // Phase 2：步骤级协作计划覆盖
                collaboration: node.collaboration,
                // F-07/F-17：信号量与共享存储门面按同一约定注入
                sessionSemaphore: this.sessionSemaphore,
                storage: this.storage,
                onSessionCreated: (sessionId) => {
                    // 多 Agent 时 node.sessionId 记录**主阶段**会话，
                    // 与 Phase 1 的"该步骤的会话"语义保持可类比（前端无需改判空逻辑）
                    node.sessionId = sessionId || '';
                    this._emitStepStatus(node);
                }
            });

            // 运行器上的协作元信息挂到节点，供 getProgress / 持久化 / 前端拓扑图读取
            node._agentRunner = runner;
            return runner;
        } catch (err) {
            this._log('error', `创建多 Agent 运行器失败: ${err.message}`);
            return null;
        }
    }

    /**
     * 取角色级限流器实例（进程级共享单例）。
     *
     * 为什么必须**跨编排器共享**：角色级限流的目的正是"防止贵角色挤死关键角色"，
     * 而"挤死"是**进程级**现象——若每个编排器各持一个限流器，
     * 10 个任务就是 10 倍的角色并发，限流形同虚设。
     *
     * @returns {RoleLimiter}
     * @private
     */
    _roleLimiterInstance() {
        if (!this.roleLimiter) {
            this.roleLimiter = _roleLimiterSingleton();
        }
        return this.roleLimiter;
    }

    // ─── 控制操作 ──────────────────────────────────────────────────────

    /**
     * abort — 终止编排执行。
     *
     * 标记终止标志，正在执行的步骤会在步骤边界检测后退出。
     * LOADED 状态（已加载未启动）同样受理终止：防止 start 前的终止请求
     * 被吞掉导致随后 start() 照常执行整个编排。
     *
     * @returns {Promise<boolean>}
     */
    async abort() {
        if (this._status !== OrchestratorStatus.RUNNING &&
            this._status !== OrchestratorStatus.LOADED) {
            this._log('warn', `abort: 当前状态为 ${this._status}，无需终止`);
            return false;
        }

        this._aborted = true;
        this._log('warn', '⏹  编排执行已被终止');

        // Phase 3：先做**级联取消**（取消树），再做平铺通知。
        // 顺序刻意的：级联取消是同步的、且会让**此后新派生**的节点立即为取消态；
        // 平铺通知（controlExecution）依赖 runner 自身实现且只覆盖"当前正在运行"的节点。
        // 两者并存而不是替换，是因为 FlexRunner 仍以 #aborted 标志为权威判据，
        // 移除它会改变 Phase 1 的既有语义（M1 的 008 条断言依赖它）。
        if (this._taskAbortNode) {
            const cancelled = this.abortTree.abort('编排被终止');
            this._log('info', `取消树级联取消 ${cancelled} 个节点`);
        }

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
     * flushPersistence — 先冲刷待写入的合并窗口，再等待在途持久化写入链落盘（F-04 优雅停机用）。
     *
     * 两件事：
     *   1. force 写一次（F-11）：合并窗口内可能还挂着一个未触发的定时器，
     *      若直接退出进程，最后一次状态（如步骤终态）会丢；
     *   2. 等待 _persistChain 排空：_persistState 对外是 fire-and-forget 的 Promise 链，
     *      调用后并不保证已落盘。
     *
     * @returns {Promise<void>}
     */
    async flushPersistence() {
        try {
            // 收口待触发的合并窗口并落盘最新状态（F-11）；窗口已收口时幂等无副作用
            await this.flushPersistWindow();
        } catch {
            // 错误已在 _persistStateNow 中吞掉并记日志
        }
        try {
            await this._persistChain;
        } catch {
            // _persistChain 内部错误已在 _persistStateNow 中吞掉并记日志，此处仅保证等待完成
        }
    }

    /**
     * abortAndWait — 终止编排并等待真正停下来（F-04 优雅停机用）。
     *
     * 与 abort() 的区别：abort() 只是置位并通知在途 runner；本方法进一步：
     *   1. 等到编排进入终态（status 不再是 running）；
     *   2. 等到所有在途步骤（_inFlight）清空——否则 start() 可能已写出终态，
     *      而步骤执行体仍在退出途中；
     *   3. 排空各步骤 runner 的后台任务（经验总结 + 远端会话归档回收）；
     *   4. 等待持久化链落盘。
     *
     * 所有等待受 timeoutMs 约束，超时即返回；由上层（server.js）用硬超时兜底，
     * 避免停机被单个卡死步骤无限拖住。
     *
     * @param {object} [opts]
     * @param {number} [opts.timeoutMs=60000] - 最长等待时间
     * @param {number} [opts.pollMs=100]      - 状态轮询间隔
     * @returns {Promise<{status: string, inFlight: number, drained: number, pending: number}>}
     */
    async abortAndWait({ timeoutMs = 60000, pollMs = 100 } = {}) {
        const deadline = Date.now() + Math.max(0, timeoutMs);

        if (this._status === OrchestratorStatus.LOADED) {
            // 已加载未启动：直接标记终止，避免停机窗口内被 start() 拉起
            this._aborted = true;
            this._status = OrchestratorStatus.ABORTED;
            this._endTime = nowCST();
            this._emit(SSE_EVENT.TASK_ABORTED, this.getProgress());
            // 关键跃迁（任务终态）：立即落盘，不被合并窗口延迟
            await this._persistState({ force: true });
            await this._deleteOwnerFile();
        } else {
            if (this._status === OrchestratorStatus.RUNNING) {
                await this.abort();
            }
            // 等待在途步骤清空。
            //
            // ⚠️ 这里刻意**不**以"状态是否 RUNNING"为前置条件——这是修掉的一个真实缺陷：
            // 早先的分支是 `else if (this._status === RUNNING) { abort(); while (...status===RUNNING || inFlight>0) ... }`，
            // 于是当调用方已经先调过 `abort()`（状态已是 aborted）再调 `abortAndWait()` 时，
            // **整个等待循环被跳过**：方法会立刻返回，而 `inFlight` 仍 > 0。
            // 表现为"调用方以为所有步骤都收尾了，实际上还有会话在退出途中"
            // ——正是 `abortAndWait` 存在的意义被抹掉的场景（实测 inFlight=1 却 0ms 返回）。
            while (Date.now() < deadline
                && (this._status === OrchestratorStatus.RUNNING || this._inFlight.size > 0)) {
                await new Promise((resolve) => setTimeout(resolve, pollMs));
            }
        }

        // 排空各步骤 runner 的后台任务（经验总结 + 会话回收）
        const runners = [];
        for (const node of this._nodes.values()) {
            const runner = node._runner;
            if (runner && typeof runner.drainBackgroundTasks === 'function') {
                runners.push(runner);
            }
        }
        const drains = await Promise.allSettled(
            runners.map((r) => r.drainBackgroundTasks(Math.max(0, deadline - Date.now())))
        );
        let pending = 0;
        for (const d of drains) {
            if (d.status === 'fulfilled' && d.value) pending += d.value.pending || 0;
        }

        await this.flushPersistence();
        return {
            status: this._status,
            inFlight: this._inFlight.size,
            drained: runners.length - pending,
            pending
        };
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
            // 终止已请求但仍未收尾（RUNNING + _aborted）→ 投影为 aborting，
            // 供前端展示「任务中止中」过渡态（不改变内部状态机，收尾时仍按 ABORTED 判定）
            status: (this._aborted && this._status === OrchestratorStatus.RUNNING)
                ? 'aborting'
                : this._status,
            startTime: this._startTime,
            endTime: this._endTime,
            error: this._error,
            currentStepId: this._currentStepId,
            globalExecCount: this._globalExecCount,
            // F-18：把检测到的环暴露给前端/调用方，便于发现"非有意的环"
            cycles: this._cycles,
            stats,
            steps
        };
    }

    // ─── 内部工具 ──────────────────────────────────────────────────────

    /**
     * 取某步骤的多 Agent 协作拓扑（Phase 2，前端「Agent 协作」面板的数据源）。
     *
     * 数据来自 `_executeNode` 在步骤结束时**快照到节点上**的协作结论
     * （见那里的说明：运行器实例会被 dispose，必须把结论复制出来）。
     * 因此本方法对**任何状态**的步骤都可用，包括早已完成的历史步骤。
     *
     * @param {string|number} stepId
     * @returns {{available: boolean, reason?: string, stepId?: string, status?: string,
     *   plan?: object|null, topology?: object|null, stageRuns?: object[], collaboration?: object|null}}
     */
    getAgentTopology(stepId) {
        const node = this.getNode(stepId);
        if (!node) {
            return { available: false, reason: `步骤 "${stepId}" 不存在` };
        }
        const summary = node.collaborationSummary || null;
        if (!summary) {
            return {
                available: false,
                stepId: node.stepId,
                status: node.status,
                reason: '该步骤未启用多 Agent 协作（或尚未执行完成）'
            };
        }
        return {
            available: true,
            stepId: node.stepId,
            status: node.status,
            plan: summary.plan || null,
            topology: summary.topology || null,
            stageRuns: summary.stageRuns || [],
            collaboration: summary
        };
    }

    /**
     * 多 Agent 协作的累计统计（跨步骤）。
     * @returns {object}
     */
    getMultiAgentStats() {
        return {
            enabled: this.multiAgentEnabled,
            ...this._multiAgentStats,
            failures: { ...this._multiAgentStats.failures },
            perStep: [...this._nodes.values()]
                .filter((n) => n.collaborationSummary)
                .map((n) => ({
                    stepId: n.stepId,
                    status: n.status,
                    plan: n.collaborationSummary.plan,
                    roleRuns: n.collaborationSummary.roleRuns,
                    revisions: n.collaborationSummary.revisions,
                    failureKind: n.collaborationSummary.failureKind
                }))
        };
    }

    /**
     * Phase 3：并发与取消的可观测快照。
     *
     * 四个指标各自回答一个具体问题（这也是它们被选中的原因）：
     * | 指标 | 回答的问题 |
     * |---|---|
     * | `abortTree.orphans` | 有没有"已取消但没从树上摘掉"的会话（泄漏信号） |
     * | `roleLimiter.queueWaitP95Ms` | 角色级限流是否过紧（等待 P95 是否已经到了分钟级） |
     * | `roleLimiter.slotHoldP95Ms` | 贵角色是否在霸占槽位 |
     * | `session.active/limit/waiting` | 全局是否已饱和（waiting 持续 > 0 即为饱和） |
     *
     * @returns {object}
     */
    getConcurrencyStats() {
        const limiter = this._roleLimiterInstance();
        return {
            taskId: this._taskId,
            status: this._status,
            session: typeof this.sessionSemaphore?.stats === 'function' ? this.sessionSemaphore.stats() : null,
            roles: limiter.getStats(),
            abort: this.abortTree.getStats(),
            multiAgent: this.getMultiAgentStats()
        };
    }

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
            // F-18：环信息随状态落盘，重启恢复后仍可查
            cycles: this._cycles,
            steps: Array.from(this._nodes.values()).map(n => n.toJSON()),
            persistedAt: nowCST()
        };
    }

    /**
     * 持久化当前编排状态到 db/task/{taskId}/orchestration_loop{L}.json
     * 同时写入最新快照 db/task/{taskId}/orchestration.json（兼容恢复逻辑）
     *
     * 合并语义（F-11）：
     *   - 默认进入合并窗口（默认 300ms，PERSIST_DEBOUNCE_MS 可调，0 = 立即写），
     *     采用**尾部合并**：窗口内多次调用只落盘一次，且落盘时取最新的内存状态
     *     （快照在 _persistStateNow 的写入闭包内实时取，不在调用时刻捕获）；
     *   - force=true（关键跃迁：任务终态、编排启动/加载、优雅停机）绕过窗口立即写，
     *     并 await 落盘完成，确保不会被后续合并"吃掉"。
     *
     * @param {object} [opts]
     * @param {boolean} [opts.force=false] - 强制立即写入（不合并），并等待写完成
     * @returns {Promise<void>}
     * @private
     */
    async _persistState({ force = false } = {}) {
        if (!this.storage || !this._taskId) return;

        // 立即写：force（关键跃迁）或合并已关闭。
        // 立即写会顺带收口当前窗口（本次写的已是最新状态，窗口再写一次纯属浪费），
        // 因此一次 force 恰好产生一次落盘。
        if (force || this._persistDebounceMs <= 0) {
            this._cancelPersistWindow();
            this._chainPersist();
            return this._persistChain;
        }

        // 已有待落盘的窗口：本次请求被吸收（这就是"写合并"）
        if (this._persistPending) {
            this._persistCoalesced++;
            return this._persistChain;
        }

        // 开启一个合并窗口：只排定时器、**不**立刻落盘。
        // 尾部合并（trailing debounce）：窗口结束时统一写一次，取的是当时的最新状态，
        // 因此 N 次连发最多产生 1 次写（若窗口内发生 force，则被 force 那一次取代）。
        this._persistPending = true;
        this._schedulePersist();
        return this._persistChain;
    }

    /**
     * 把一次落盘追加到串行化写链末尾。
     *
     * 串行化（而非并发写）是必须的：多个 writeFile 同时操作同一文件会因 O_TRUNC
     * 截断产生损坏的 JSON。错误吞掉，避免一条失败链阻断后续写入。
     * @private
     */
    _chainPersist() {
        this._persistChain = this._persistChain.then(
            () => this._persistStateNow(),
            () => this._persistStateNow()
        );
    }

    /**
     * 收口当前合并窗口并落盘一次（窗口的"尾部写"）。
     *
     * 幂等：窗口已收口（_persistPending 为 false）时直接返回，不会重复写。
     *
     * @returns {Promise<void>}
     * @private
     */
    async flushPersistWindow() {
        if (!this.storage || !this._taskId) return;
        if (this._persistTimer !== null) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
        }
        if (!this._persistPending) return;
        this._persistPending = false;
        this._chainPersist();
        await this._persistChain;
    }

    /**
     * 安排一次窗口结束后的合并写入。timer.unref() 保证它不阻止进程退出
     * （长时间空闲的编排不应因为一个待写定时器而让进程无法自然结束）。
     * @private
     */
    _schedulePersist() {
        this._persistTimer = setTimeout(() => {
            this._persistTimer = null;
            this.flushPersistWindow().catch((err) => {
                this._log('warn', `持久化状态失败: ${err.message}`);
            });
        }, this._persistDebounceMs);
        this._persistTimer.unref?.();
    }

    /**
     * 收口当前合并窗口：取消待触发的定时器并清空窗口标记（不落盘）。
     *
     * 必须与 _schedulePersist 成对使用——只清定时器不清标记，会让定时器回调
     * 误判"窗口仍有效"从而再排一次窗口（形成每 debounceMs 写一次的定时循环）。
     * @private
     */
    _cancelPersistWindow() {
        if (this._persistTimer !== null) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
        }
        this._persistPending = false;
    }

    /**
     * 真正执行一次落盘（内部已串行化，调用方无需重复排队）。
     *
     * 快照在写入时刻取（而非调用时刻捕获），因此合并窗口内的多次状态变更
     * 最终落盘的一定是最后一次的状态。
     * @private
     */
    async _persistStateNow() {
        try {
            const state = this.getPersistableState();
            const json = this.storage.json('task');
            // 按大循环轮次独立保存（保留历史）
            await json.write(`${this._taskId}/orchestration_loop${this._loopCount}`, state);
            // 同时写入最新快照（兼容已有 load/restore 逻辑）
            await json.write(`${this._taskId}/orchestration`, state);
            this._persistWrites++;
        } catch (err) {
            this._log('warn', `_persistState 失败: ${err.message}`);
        }
    }

    /**
     * 持久化合并统计（F-11 可观测性）。
     *
     * `writes` 为实际落盘次数（每次落盘含 loop 快照 + 最新快照两份文件），
     * `coalesced` 为被合并窗口吸收掉的持久化请求数。调优/回归测试据此判断
     * 写入放大是否被真正消除。
     *
     * @returns {{writes: number, coalesced: number, debounceMs: number, pending: boolean}}
     */
    getPersistStats() {
        return {
            writes: this._persistWrites,
            coalesced: this._persistCoalesced,
            debounceMs: this._persistDebounceMs,
            pending: this._persistPending,
        };
    }

    /**
     * 写入属主标记文件（db/task/{taskId}/owner.json）。
     *
     * 记录执行本编排的进程 pid 与 hostname。服务重启时
     * OrchestratorController.restoreFromDisk 据此判定 running 状态任务的归属：
     * 属主进程仍存活（如 3rdloop run 嵌入式 CLI 在独立进程执行）则跳过恢复，
     * 不标记 FAILED、不写 SQLite 中断记录、不回写注册表。
     * 静默失败，不影响编排主流程。
     * @private
     */
    async _writeOwnerFile() {
        if (!this.storage || !this._taskId) return;
        try {
            await this.storage.json('task').write(`${this._taskId}/owner`, {
                pid: process.pid,
                hostname: hostname(),
                // F-26：除 pid/hostname 外，额外记录启动时间与心跳时间戳。
                // 仅凭 `process.kill(pid, 0)` 判断"属主是否存活"存在 **pid 复用**风险：
                // 属主进程早已死亡，其 pid 恰好被系统分配给一个无关进程，
                // 于是该任务会被误判为"仍在执行"而永久不被恢复。
                // 心跳时间戳使判定不再只依赖 pid：超期未更新即视为属主已死。
                startedAt: this._startTime || new Date().toISOString(),
                heartbeatAt: new Date().toISOString(),
                wroteAt: new Date().toISOString()
            });
        } catch { /* 静默失败 */ }
    }

    /**
     * F-26：启动属主心跳（定时刷新 owner.json 的 heartbeatAt）。
     *
     * 心跳让"属主是否仍在执行"有了**时间维度**的证据，而不是只能依赖 pid 存活探测
     * （后者会被 pid 复用欺骗）。心跳是 unref 的，不会阻止进程退出。
     * @private
     */
    _startOwnerHeartbeat() {
        if (this._ownerHeartbeatTimer) return;
        const intervalMs = Number(process.env.OWNER_HEARTBEAT_MS) > 0
            ? Number(process.env.OWNER_HEARTBEAT_MS)
            : DEFAULT_OWNER_HEARTBEAT_MS;
        this._ownerHeartbeatTimer = setInterval(() => {
            this._writeOwnerFile().catch(() => {});
        }, intervalMs);
        this._ownerHeartbeatTimer.unref?.();
    }

    /** @private */
    _stopOwnerHeartbeat() {
        if (this._ownerHeartbeatTimer) {
            clearInterval(this._ownerHeartbeatTimer);
            this._ownerHeartbeatTimer = null;
        }
    }

    /**
     * 删除属主标记文件（编排到终态时调用）。
     * @private
     */
    async _deleteOwnerFile() {
        this._stopOwnerHeartbeat();
        if (!this.storage || !this._taskId) return;
        try {
            await this.storage.json('task').delete(`${this._taskId}/owner`);
        } catch { /* 静默失败 */ }
    }

    /**
     * 从持久化文件恢复编排状态。
     *
     * 恢复后编排器处于对应状态：
     *   - RUNNING → 标记为 FAILED（执行中断，无法自动恢复运行时上下文）
     *   - LOADED/COMPLETED/FAILED/ABORTED/DEADLOCKED → 原样恢复
     *
     * @param {object} state - getPersistableState() 返回的对象
     * @param {object} [opts]
     * @param {boolean} [opts.queryOnly=false] - 只读查询模式：RUNNING 状态原样保留（不标记
     *   FAILED、不写 SQLite）。仅用于「查询另一进程正在执行的任务」的场景——此时任务并未
     *   中断，标记 FAILED 会让前端误报"检视失败"。真正的中断恢复（服务重启 restoreFromDisk）
     *   不要传此选项，保持 RUNNING→FAILED 语义。
     * @returns {Promise<void>}
     */
    async restoreState(state, opts = {}) {
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

        // F-18：重新计算环（不信任持久化里的旧值——步骤图可能已在磁盘上被改动）
        this._detectCycles();

        // RUNNING 状态在重启后无法恢复执行上下文，标记为 FAILED。
        // 例外：queryOnly 只读查询（如 Web 进程查询 CLI 进程正在执行的任务）——
        // 任务并未中断，原样保留 running 状态，也不写 SQLite。
        if (state.status === OrchestratorStatus.RUNNING) {
            if (opts.queryOnly) {
                this._status = OrchestratorStatus.RUNNING;
            } else {
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

export { Orchestrator, SSE_EVENT, Semaphore };
export { default as StepNode } from './StepNode.js';
export { NodeStatus } from './StepNode.js';
export default Orchestrator;
