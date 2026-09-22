/**
 * SessionWaiter —— 会话完成等待器：事件驱动为主、轮询为兜底（Phase 3）
 *
 * ## 要解决的问题（Phase 1/2 的真实缺陷）
 *
 * FlexRunner 的 `_pollSession` 循环是：
 * ```js
 * while (Date.now() < deadline) {
 *     await this._sleep(this.#pollIntervalMs);   // ← 先睡 5 秒
 *     const { status } = await cli.checkSessionStatus(sessionId);
 *     if (status === 'completed') return true;
 * }
 * ```
 * 三个可量化的代价：
 *   1. **最短感知延迟 = 一个轮询间隔**。即使会话在 200ms 内就完成了，
 *      也要再等满 5 秒才发现——"单步完成感知延迟 ~5s"就是这么来的。
 *   2. **空转开销**：500 并发会话 → 每秒 100 次状态查询（N/interval），
 *      全部打在同一个 opencode 进程上；这些请求本身在争抢它的处理能力。
 *   3. **超时判定粗糙**：轮询粒度决定了"卡住"的发现时间同样是分钟级。
 *
 * ## 本模块的做法
 *
 *   1. **先查后睡**（立即生效，零风险）：把 `sleep → check` 改成 `check → sleep`。
 *      对"已经完成"的会话，感知延迟从"一个间隔"降到"一次 RTT"。
 *      对长时间会话的总等待没有影响（总时长由会话本身决定）。
 *   2. **事件驱动**：若注入了 `subscribe`（opencode 的事件流），则在事件到达时
 *      **立刻**判定完成，不再等待轮询间隔。感知延迟从 ~5000ms 降到事件延迟（实测 mock 下 < 50ms）。
 *   3. **安全轮询兜底**：事件可能因为网络抖动/服务重启而丢。因此事件模式下
 *      **仍然保留一个间隔更大的兜底轮询**（默认 30s）。没有这层兜底，
 *      "事件丢一次 = 步骤永久挂住到超时"，这是把可靠性押在外部流的完整性上。
 *
 * ## 为什么不做"事件专用"实现
 *
 * 真实 opencode 事件流在本环境不可用（需要活的服务）。因此本模块把事件源设计为
 * **可注入**的：生产注入真实订阅，测试注入 mock。这样"事件驱动真的更快"这件事
 * 可以被**断言**（用 mock 测量延迟），而不是只能靠"读代码相信它更快"。
 * 未注入 `subscribe` 时行为退化为纯轮询（但已是"先查后睡"版本）。
 *
 * @example
 * const waiter = new SessionWaiter({ poll: (sid) => cli.checkSessionStatus(sid) });
 * const r = await waiter.wait(sessionId, { isAborted: () => this.#aborted });
 * // r = { completed: true, mode: 'poll', waitedMs: 12, polls: 1, events: 0 }
 */

/** 默认轮询间隔（与 FlexRunner 的 POLL_INTERVAL_MS 一致） */
export const DEFAULT_POLL_INTERVAL_MS = 5000;

/** 事件模式下的兜底轮询间隔（远大于普通轮询：事件是主路径，轮询只防丢失） */
export const DEFAULT_SAFETY_POLL_MS = 30000;

/** 判定"完成"的状态值 */
const COMPLETED_STATUSES = new Set(['completed', 'done', 'finished', 'closed']);

export class SessionWaiter {
    /**
     * @param {object} opts
     * @param {(sessionId: string) => Promise<{status: string}>} opts.poll - 状态查询（必填）
     * @param {(sessionId: string, onEvent: (evt: object) => void) => (() => void)} [opts.subscribe]
     *        事件订阅；返回值应为**退订函数**
     * @param {number} [opts.pollIntervalMs]
     * @param {number} [opts.safetyPollMs]     - 事件模式下的兜底轮询间隔
     * @param {number} [opts.timeoutMs=0]      - 0 = 不超时（由调用方自行控制）
     * @param {(evt: object) => boolean} [opts.isCompletionEvent]
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        if (typeof opts.poll !== 'function') {
            throw new Error('SessionWaiter: poll 必须是函数');
        }
        this._poll = opts.poll;
        this._subscribe = typeof opts.subscribe === 'function' ? opts.subscribe : null;
        this._pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && opts.pollIntervalMs > 0
            ? opts.pollIntervalMs
            : DEFAULT_POLL_INTERVAL_MS;
        this._safetyPollMs = Number.isFinite(opts.safetyPollMs) && opts.safetyPollMs > 0
            ? opts.safetyPollMs
            : DEFAULT_SAFETY_POLL_MS;
        this._timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 0;
        this._isCompletionEvent = typeof opts.isCompletionEvent === 'function'
            ? opts.isCompletionEvent
            : SessionWaiter.defaultIsCompletionEvent;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;

        this._stats = { waits: 0, polls: 0, events: 0, eventWins: 0, pollWins: 0, timeouts: 0, aborted: 0 };
    }

    /**
     * 默认的"完成事件"判定。
     *
     * 兼容多种事件形状（不同版本/不同 SDK 的事件字段名不同）：
     * `{type:'session.idle'}` / `{status:'completed'}` / `{event:'done'}`。
     * 刻意宽松：漏判一个完成事件会导致步骤一直等到兜底轮询才结束，
     * 而误判（把非完成事件当完成）会由随后的结果文件校验兜住。
     *
     * @param {object} evt
     * @returns {boolean}
     */
    static defaultIsCompletionEvent(evt) {
        if (!evt || typeof evt !== 'object') return false;
        const v = String(evt.type || evt.event || evt.status || '').toLowerCase();
        if (!v) return false;
        return COMPLETED_STATUSES.has(v)
            || v.endsWith('.idle')
            || v.endsWith(':idle')
            || v.includes('session.completed')
            || v.includes('session.idle');
    }

    /**
     * 等待会话完成。
     *
     * 解析顺序（**先查后睡**）：先立刻查一次状态 → 若已注入事件源则同时订阅 →
     * 然后 `Promise.race([完成事件, 兜底轮询, 超时, 中止])`。
     *
     * @param {string} sessionId
     * @param {object} [opts]
     * @param {() => boolean} [opts.isAborted]  - 外部中止判据（如 FlexRunner.#aborted）
     * @param {AbortSignal} [opts.signal]       - 取消信号
     * @param {number} [opts.timeoutMs]         - 覆盖构造时的超时
     * @returns {Promise<{completed: boolean, mode: 'poll'|'event', waitedMs: number,
     *   polls: number, events: number, reason: string}>}
     */
    async wait(sessionId, opts = {}) {
        if (!sessionId) {
            return { completed: false, mode: 'poll', waitedMs: 0, polls: 0, events: 0, reason: 'no-session' };
        }
        const t0 = Date.now();
        this._stats.waits++;
        const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
            ? opts.timeoutMs
            : this._timeoutMs;

        const isAborted = () => {
            if (typeof opts.isAborted === 'function' && opts.isAborted()) return true;
            return !!(opts.signal && opts.signal.aborted);
        };

        let polls = 0;
        let events = 0;
        let mode = this._subscribe ? 'event' : 'poll';

        // ── 收尾：**所有**路径都必须执行全部清理（退订 + 清定时器） ──
        // 用统一的清理列表而不是逐个变量判空：只要有一条返回路径漏了退订，
        // 事件源就会把监听器累积到进程级对象上（Node 超过 10 个还会告警），
        // 而这类泄漏在压测里表现为"跑得越久越慢"。
        /** @type {(() => void)[]} */
        const cleanups = [];
        const runCleanups = () => {
            while (cleanups.length) {
                const fn = cleanups.pop();
                try { fn(); } catch { /* 清理失败不应影响结果 */ }
            }
        };

        try {
            // ① 先查一次（关键：去掉"先睡一个间隔"的盲区）
            const first = await this._safeCheck(sessionId);
            polls++;
            this._stats.polls++;
            if (this._isCompletedStatus(first)) {
                this._stats.pollWins++;
                return { completed: true, mode: 'poll', waitedMs: Date.now() - t0, polls, events, reason: 'already-completed' };
            }
            if (isAborted()) {
                this._stats.aborted++;
                return { completed: false, mode, waitedMs: Date.now() - t0, polls, events, reason: 'aborted' };
            }

            // ② 事件源（可用时）
            let eventPromise = null;
            if (this._subscribe) {
                eventPromise = new Promise((resolve) => {
                    try {
                        const off = this._subscribe(sessionId, (evt) => {
                            events++;
                            this._stats.events++;
                            if (this._isCompletionEvent(evt)) resolve({ via: 'event' });
                        });
                        if (typeof off === 'function') cleanups.push(off);
                    } catch (err) {
                        this._log('warn', `会话事件订阅失败，退化为轮询：${err.message}`);
                        resolve({ via: 'no-subscribe' });
                    }
                });
            }

            // ③ 轮询（事件模式下用更大的兜底间隔）
            const interval = this._subscribe ? this._safetyPollMs : this._pollIntervalMs;

            // 停止开关：`wait()` 一旦返回（超时/事件/中止任一），轮询循环必须尽快退出。
            // 原实现没有这个开关——`Promise.race` 不会停掉落败者，于是超时返回后
            // 轮询循环仍会每 interval 打一次 `checkSessionStatus`（默认 5s，永久），
            // 并钉住 SessionWaiter → FlexRunner → CLIController 整条对象图，
            // `runner.dispose()` 也释放不掉。所有退出路径共用 finally 里的 cleanups。
            const stopToken = { stopped: false };
            cleanups.push(() => { stopToken.stopped = true; });

            const pollPromise = this._pollLoop(
                sessionId, interval, () => stopToken.stopped || isAborted(),
                () => { polls++; this._stats.polls++; }
            );

            // ④ 中止监听（立刻返回，不必等下一次轮询）
            let abortPromise = null;
            if (typeof opts.isAborted === 'function' || opts.signal) {
                abortPromise = new Promise((resolve) => {
                    if (isAborted()) { resolve({ via: 'aborted' }); return; }
                    const timer = setInterval(() => {
                        if (isAborted()) resolve({ via: 'aborted' });
                    }, 20);
                    cleanups.push(() => clearInterval(timer));
                });
            }

            const racers = [pollPromise];
            if (eventPromise) racers.push(eventPromise);
            if (abortPromise) racers.push(abortPromise);

            let timeoutId = null;
            if (timeoutMs > 0) {
                racers.push(new Promise((resolve) => {
                    timeoutId = setTimeout(() => resolve({ via: 'timeout' }), timeoutMs);
                }));
                cleanups.push(() => { if (timeoutId) clearTimeout(timeoutId); });
            }

            const winner = await Promise.race(racers);
            const waitedMs = Date.now() - t0;

            if (winner?.via === 'event') {
                this._stats.eventWins++;
                return { completed: true, mode: 'event', waitedMs, polls, events, reason: 'event' };
            }
            if (winner?.via === 'poll') {
                this._stats.pollWins++;
                return { completed: true, mode: 'poll', waitedMs, polls, events, reason: winner.reason || 'poll' };
            }
            if (winner?.via === 'no-subscribe') {
                // 订阅失败：本次已退化为轮询。
                //
                // ⚠️ 这里**不能**直接 `await pollPromise`（原实现）：
                //   1. 那会绕开 `Promise.race` 里的超时，timeoutMs 形同失效 ——
                //      会话永不完成时 `wait()` 永不返回，全局/每任务槽位被永久占用
                //      （正是 F-06 要防的"僵死会话饿死整进程"）；
                //   2. 返回值硬编码 `completed: true`，把"轮询因中止而退出"
                //      误报成"已完成"，调用方会去读一个并不存在的产物。
                // 因此把轮询重新放回"超时 + 中止"的约束之下，并按实际原因归因。
                const guards = [pollPromise];
                if (timeoutMs > 0) {
                    guards.push(new Promise((resolve) => {
                        const t = setTimeout(() => resolve({ via: 'timeout' }), timeoutMs);
                        cleanups.push(() => clearTimeout(t));
                    }));
                }
                if (abortPromise) guards.push(abortPromise);

                const r = await Promise.race(guards);
                if (r?.via === 'poll') {
                    this._stats.pollWins++;
                    return {
                        completed: true, mode: 'poll', waitedMs: Date.now() - t0,
                        polls, events, reason: r.reason || 'poll-completed'
                    };
                }
                if (r?.via === 'aborted') {
                    this._stats.aborted++;
                    return { completed: false, mode, waitedMs: Date.now() - t0, polls, events, reason: 'aborted' };
                }
                this._stats.timeouts++;
                return { completed: false, mode, waitedMs: Date.now() - t0, polls, events, reason: 'timeout' };
            }
            if (winner?.via === 'timeout') {
                this._stats.timeouts++;
                return { completed: false, mode, waitedMs, polls, events, reason: 'timeout' };
            }
            this._stats.aborted++;
            return { completed: false, mode, waitedMs, polls, events, reason: 'aborted' };
        } finally {
            runCleanups();
        }
    }

    /**
     * 轮询循环（先睡后查；首查已在上层完成）。
     * @param {string} sessionId
     * @param {number} interval
     * @param {() => boolean} isAborted
     * @param {() => void} countPoll
     * @returns {Promise<{via: string, reason?: string}>}
     * @private
     */
    async _pollLoop(sessionId, interval, isAborted, countPoll) {
        while (true) {
            await sleep(interval);
            if (isAborted()) return { via: 'aborted' };
            const res = await this._safeCheck(sessionId);
            countPoll();
            if (this._isCompletedStatus(res)) return { via: 'poll', reason: 'poll-completed' };
        }
    }

    /**
     * 状态查询（异常不外抛：查询失败应继续等，而不是把步骤判失败）。
     * @param {string} sessionId
     * @returns {Promise<{status: string}|null>}
     * @private
     */
    async _safeCheck(sessionId) {
        try {
            return await this._poll(sessionId);
        } catch (err) {
            this._log('warn', `会话状态查询失败（继续等待）：${err.message}`);
            return null;
        }
    }

    /**
     * @param {{status?: string}|null} res
     * @returns {boolean}
     * @private
     */
    _isCompletedStatus(res) {
        const status = res && typeof res.status === 'string' ? res.status.toLowerCase() : '';
        return COMPLETED_STATUSES.has(status);
    }

    /**
     * 统计快照（含"事件 vs 轮询"的胜出次数，用于验证事件驱动真的生效）。
     * @returns {object}
     */
    getStats() {
        return {
            ...this._stats,
            pollIntervalMs: this._pollIntervalMs,
            safetyPollMs: this._safetyPollMs,
            eventModeEnabled: !!this._subscribe
        };
    }

    /**
     * @param {string} level
     * @param {string} msg
     * @private
     */
    _log(level, msg) {
        if (this._logger) this._logger(level, msg);
    }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default SessionWaiter;
