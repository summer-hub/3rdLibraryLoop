/**
 * RoleLimiter —— 第三级限流：角色级并发上限（Phase 3）
 *
 * Phase 1 已有**全局**（`MAX_CONCURRENT_SESSIONS`）与**任务级**
 * （`MAX_SESSIONS_PER_TASK`）两级限流。Phase 3 引入多 Agent 后暴露了第三类饿死：
 *
 *   > 5 个 Coder 会话（每个都可能跑 90 分钟）与 1 个 Reviewer 争抢同一批槽位。
 *   > 全局上限 50 时这不成问题；但当事务并发上去、或单任务配额收到 8 时，
 *   > **最贵的角色会把廉价角色挤出去**——评审者拿不到槽位，实现产物堆在那里没人审，
 *   > 整条链的完成时间被拉到最慢角色的串行时间。
 *
 * 因此角色级限流解决的问题**不是"总量"，而是"配比"**：给最贵的角色设上限，
 * 让廉价但关键的角色（评审/验证）始终有槽位可用。
 *
 * ## 与全局限流的关系（三层如何叠加）
 *
 * ```
 * 全局 MAX_CONCURRENT_SESSIONS        ── 保护外部单进程（opencode）不被压垮
 *   └ 任务级 MAX_SESSIONS_PER_TASK    ── 防止单任务独占全部槽位（隔离）
 *        └ 角色级 MAX_SESSIONS_PER_ROLE ── 防止贵角色挤死关键角色（配比）
 * ```
 *
 * ## 获取顺序（无死锁的关键）
 *
 * AgentRuntime 的获取顺序固定为 **角色槽位 → 全局槽位**，释放顺序相反。
 * 所有参与者遵守**同一顺序**，因此不可能出现"我持 A 等 B、你持 B 等 A"的循环等待。
 * 这条约束是刻意的设计决定，而不是实现细节——顺序一旦不统一，Phase 3 的
 * 高并发压测必然出现偶发挂死（且极难复现）。`test/m6-phase3` 有专门的饱和用例守护它。
 *
 * 为什么是"角色先、全局后"而不是反过来：如果把全局槽位先拿到手里再等角色槽位，
 * 会出现"**持有全局槽位空等**"——全局是最稀缺的资源，让它被空占是纯粹的浪费。
 *
 * ## 配置
 *
 * | 环境变量 | 含义 | 默认 |
 * |---|---|---|
 * | `MAX_SESSIONS_PER_ROLE` | 未单独指定的角色统一上限 | `0`（不限制） |
 * | `ROLE_LIMIT_<ROLE>` | 单个角色上限，如 `ROLE_LIMIT_CODER=8` | — |
 * | `ROLE_SLOT_ACQUIRE_TIMEOUT_MS` | 角色槽位等待超时 | 15 分钟 |
 */

import { LatencyRecorder } from '../lib/LatencyRecorder.js';

/** 默认角色槽位等待超时（与 Session 槽位一致） */
export const DEFAULT_ROLE_TIMEOUT_MS = 15 * 60 * 1000;

/** 内置角色的**建议**默认上限（0 = 不限制）。刻意保守：不设限时行为与 Phase 2 一致。 */
export const DEFAULT_ROLE_LIMITS = Object.freeze({
    planner: 0,
    retriever: 0,
    coder: 0,
    reviewer: 0,
    verifier: 0
});

/**
 * 从环境变量解析角色上限配置。
 *
 * 约定与 `Orchestrator` 的其它开关一致：**非法值回退默认**（而不是"无上限"）。
 * "配置写错导致限流失效"比"配置写错导致限流收紧"危险得多。
 *
 * @param {object} [overrides] - 代码内覆盖（优先级最高）
 * @returns {{limits: object, defaultLimit: number, timeoutMs: number}}
 */
export function resolveRoleLimits(overrides = {}) {
    const rawDefault = Number(process.env.MAX_SESSIONS_PER_ROLE);
    const defaultLimit = Number.isInteger(rawDefault) && rawDefault >= 0
        ? rawDefault
        : 0;

    const limits = { ...DEFAULT_ROLE_LIMITS };
    for (const role of Object.keys(DEFAULT_ROLE_LIMITS)) {
        const raw = Number(process.env[`ROLE_LIMIT_${role.toUpperCase()}`]);
        if (Number.isInteger(raw) && raw >= 0) limits[role] = raw;
    }
    for (const [role, v] of Object.entries(overrides || {})) {
        if (Number.isInteger(v) && v >= 0) limits[role] = v;
    }

    const rawTimeout = Number(process.env.ROLE_SLOT_ACQUIRE_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout >= 0 ? rawTimeout : DEFAULT_ROLE_TIMEOUT_MS;

    return { limits, defaultLimit, timeoutMs };
}

/**
 * 角色级并发限流器。
 */
export class RoleLimiter {
    /**
     * @param {object} [opts]
     * @param {object} [opts.limits]        - `{roleId: limit}`；0 = 不限制
     * @param {number} [opts.defaultLimit]  - 未列出的角色统一上限（0 = 不限制）
     * @param {number} [opts.timeoutMs]     - 默认等待超时
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        const env = resolveRoleLimits(opts.limits);
        /** @type {Map<string, object>} */
        this._roles = new Map();
        this._defaultLimit = Number.isInteger(opts.defaultLimit) && opts.defaultLimit >= 0
            ? opts.defaultLimit
            : env.defaultLimit;
        this._timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0
            ? opts.timeoutMs
            : env.timeoutMs;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;

        /** 角色槽位等待时长（P95 是"角色限流是否过紧"的判据） */
        this.waitRecorder = new LatencyRecorder({ name: 'role_slot_wait_ms' });
        /** 角色槽位持有时长（P95 是"贵角色是否霸占槽位"的判据） */
        this.holdRecorder = new LatencyRecorder({ name: 'role_slot_hold_ms' });

        this._stats = { acquired: 0, timedOut: 0, maxActiveTotal: 0 };

        for (const [role, limit] of Object.entries(env.limits)) {
            if (limit > 0) this._ensure(role).limit = limit;
        }
    }

    /**
     * 取得（或创建）某角色的状态。
     * @param {string} roleId
     * @returns {object}
     * @private
     */
    _ensure(roleId) {
        const key = String(roleId || 'unknown');
        let st = this._roles.get(key);
        if (!st) {
            st = {
                roleId: key,
                limit: this._defaultLimit,
                active: 0,
                waiting: [],
                totalAcquired: 0,
                totalTimedOut: 0,
                totalWaitedMs: 0,
                peakActive: 0
            };
            this._roles.set(key, st);
        }
        return st;
    }

    /**
     * 某角色的当前上限（0 = 不限制）。
     * @param {string} roleId
     * @returns {number}
     */
    limitOf(roleId) {
        return this._ensure(roleId).limit;
    }

    /**
     * 设置某角色的上限（运行期可调；已持槽位不受影响，只影响后续准入）。
     *
     * @param {string} roleId
     * @param {number} limit - 0 = 不限制
     * @returns {number} 生效后的上限
     */
    setLimit(roleId, limit) {
        const st = this._ensure(roleId);
        st.limit = Number.isInteger(limit) && limit >= 0 ? limit : 0;
        // 放宽上限后立刻尝试派发排队者（否则要等下一次 release 才生效）
        this._dispatch(st);
        return st.limit;
    }

    /**
     * 取得一个角色槽位。
     *
     * @param {string} roleId
     * @param {object} [opts]
     * @param {number} [opts.timeoutMs]
     * @returns {Promise<{ok: boolean, waitedMs: number, timedOut: boolean, limit: number, release: () => void}>}
     */
    async acquire(roleId, opts = {}) {
        const st = this._ensure(roleId);
        const t0 = Date.now();
        const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0
            ? opts.timeoutMs
            : this._timeoutMs;

        // 不限流：返回空租约（与 Phase 2 行为完全一致）
        if (st.limit <= 0) {
            return this._lease(st, 0, false);
        }

        if (st.active < st.limit) {
            st.active++;
            st.peakActive = Math.max(st.peakActive, st.active);
            this._stats.acquired++;
            st.totalAcquired++;
            this._trackTotal(st);
            return this._lease(st, 0, false);
        }

        // 排队（FIFO）并等待
        const granted = await new Promise((resolve) => {
            const waiter = {
                resolve,
                timer: setTimeout(() => {
                    const i = st.waiting.indexOf(waiter);
                    if (i >= 0) st.waiting.splice(i, 1);
                    resolve('timeout');
                }, timeoutMs),
                queuedAt: Date.now()
            };
            st.waiting.push(waiter);
            // 不 unref：等待超时必须能真正触发
        });

        const waitedMs = Date.now() - t0;
        st.totalWaitedMs += waitedMs;
        this.waitRecorder.record(waitedMs);

        if (granted === 'timeout') {
            st.totalTimedOut++;
            this._stats.timedOut++;
            this._log('warn',
                `角色 ${st.roleId} 等待槽位超时（${waitedMs}ms，active=${st.active}/${st.limit}，waiting=${st.waiting.length}）`);
            return { ok: false, waitedMs, timedOut: true, limit: st.limit, release() {} };
        }

        return this._lease(st, waitedMs, false);
    }

    /**
     * 构造租约（幂等释放）。
     * @param {object} st
     * @param {number} waitedMs
     * @param {boolean} counted - 是否已在 acquire 中计入 active
     * @returns {object}
     * @private
     */
    _lease(st, waitedMs, counted) {
        const heldAt = Date.now();
        let released = false;
        return {
            ok: true,
            waitedMs,
            timedOut: false,
            limit: st.limit,
            release: () => {
                if (released) return false; // 幂等：重复释放不会让计数漂移
                released = true;
                st.active = Math.max(0, st.active - 1);
                this.holdRecorder.record(Date.now() - heldAt);
                this._dispatch(st);
                return true;
            }
        };
    }

    /**
     * 派发排队者（FIFO）。
     * @param {object} st
     * @private
     */
    _dispatch(st) {
        while (st.waiting.length > 0 && (st.limit <= 0 || st.active < st.limit)) {
            const waiter = st.waiting.shift();
            clearTimeout(waiter.timer);
            st.active++;
            st.peakActive = Math.max(st.peakActive, st.active);
            st.totalAcquired++;
            this._stats.acquired++;
            this._trackTotal(st);
            waiter.resolve('granted');
        }
    }

    /**
     * 记录"全角色在途总量"的峰值（用于核对不超过全局上限）。
     * @param {object} st
     * @private
     */
    _trackTotal() {
        const total = [...this._roles.values()].reduce((a, s) => a + s.active, 0);
        this._stats.maxActiveTotal = Math.max(this._stats.maxActiveTotal, total);
    }

    /**
     * 当前在途总数（跨角色）。
     * @returns {number}
     */
    get activeTotal() {
        return [...this._roles.values()].reduce((a, s) => a + s.active, 0);
    }

    /**
     * 等待中的总数（跨角色）。
     * @returns {number}
     */
    get waitingTotal() {
        return [...this._roles.values()].reduce((a, s) => a + s.waiting.length, 0);
    }

    /**
     * 统计快照。
     * @returns {object}
     */
    getStats() {
        const perRole = {};
        for (const [role, st] of this._roles) {
            perRole[role] = {
                limit: st.limit,
                active: st.active,
                waiting: st.waiting.length,
                peakActive: st.peakActive,
                totalAcquired: st.totalAcquired,
                totalTimedOut: st.totalTimedOut,
                avgWaitedMs: st.totalAcquired ? Math.round(st.totalWaitedMs / st.totalAcquired) : 0
            };
        }
        return {
            defaultLimit: this._defaultLimit,
            timeoutMs: this._timeoutMs,
            activeTotal: this.activeTotal,
            waitingTotal: this.waitingTotal,
            maxActiveTotal: this._stats.maxActiveTotal,
            ...this._stats,
            perRole,
            /** 等待 P95：判断"角色限流是否过紧"的关键指标 */
            queueWaitP95Ms: this.waitRecorder.percentile(0.95),
            queueWaitP99Ms: this.waitRecorder.percentile(0.99),
            /** 持有 P95：判断"贵角色是否霸占槽位" */
            slotHoldP95Ms: this.holdRecorder.percentile(0.95),
            waitSamples: this.waitRecorder.stats(),
            holdSamples: this.holdRecorder.stats()
        };
    }

    /**
     * @param {string} level
     * @param {string} msg
     * @private
     */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[RoleLimiter] ${msg}`);
    }
}

export default RoleLimiter;
