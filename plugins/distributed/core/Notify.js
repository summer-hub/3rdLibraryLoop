/**
 * Notify —— 跨实例事件扇出（notify-svc，Phase 4）
 *
 * ## 问题：SSE 连接是"有状态"的，而任务可能不在本实例上跑
 *
 * Phase 1/2 的 `SseHub` 是进程内的：前端连到实例 A，事件由实例 A 的
 * `Orchestrator` 产生——单实例下没问题。多实例后：任务被实例 B 执行，
 * 而前端连在实例 A 上，于是**前端看不到任何进度**（只能靠轮询兜底，延迟又回到秒级）。
 *
 * ## 做法：一次发布 → 各实例本地扇出
 *
 * ```
 * 实例 B（执行者）──publish("orch:step:status")──► 事件总线（Redis Pub/Sub / MQ）
 *                                                     │
 *                          ┌──────────────────────────┼──────────────────────────┐
 *                          ▼                          ▼                          ▼
 *                     实例 A                      实例 B                      实例 C
 *                  （本地 SSE 订阅者）        （本地 SSE 订阅者）        （本地 SSE 订阅者）
 * ```
 * 每个实例只负责**自己进程内**的 SSE 连接，跨实例通过总线转发。
 * 这比"把 SSE 连接集中到一个实例"要好：后者会让 notify 成为单点与瓶颈，
 * 而 SSE 连接本身是长连接、迁移成本极高。
 *
 * ## 重复投递的处理
 *
 * 总线是 at-least-once，因此同一事件可能到达两次。方案：**每个实例维护自己的
 * 已见事件 id 集合**（有界 + TTL）：
 *   - 不能只在"发布方"去重——那管不到投递侧；
 *   - 也不能用全局去重表——每个实例都需要处理一次（扇出是**故意**的重复）。
 * 所以去重的作用域是"实例 × 事件"，这正是本地集合的语义。
 *
 * ## 回环抑制
 *
 * 实例 B 发布的事件会被总线投回实例 B。若不抑制，本地订阅者会**收到两遍**
 * （一次来自本地直发、一次来自总线回环）。因此事件带 `originInstance` 标记，
 * 各实例跳过自己发出的事件。这是一个很容易漏掉、后果又很直观（消息重复）的点。
 */

import { randomUUID } from 'node:crypto';

import { nowCST } from '../../../core/cstTime.js';

/** 默认已见事件保留时长 */
export const DEFAULT_SEEN_TTL_MS = 5 * 60 * 1000;

/** 默认已见事件容量 */
export const DEFAULT_SEEN_CAPACITY = 20000;

/**
 * 内存事件总线后端（进程内参考实现）。
 *
 * 多实例场景请替换为 Redis Pub/Sub（`PUBLISH` / `SUBSCRIBE`）或 MQ 的 broadcast topic。
 */
export class MemoryPubSubBackend {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._subs = new Map();
        this.published = 0;
    }

    async publish(channel, envelope) {
        this.published++;
        const subs = this._subs.get(channel);
        if (!subs) return 0;
        let n = 0;
        // 注意：`_subs` 的值是 Map<handler, instanceId>，直接 `[...subs]` 得到的是
        // `[handler, instanceId]` 二元组（不是 handler），调用会抛 TypeError 并被下面的
        // catch 吞掉 → 静默投递 0 条。必须取 `.keys()`。
        for (const fn of [...subs.keys()]) {
            try { await fn(envelope); n++; } catch { /* 单个订阅者异常不影响其他订阅者 */ }
        }
        return n;
    }

    /**
     * @param {string} channel
     * @param {Function} handler
     * @param {object} [meta]
     * @param {string} [meta.instanceId] - 该订阅者所属实例（供 broadcastExcept 排除来源实例）
     */
    async subscribe(channel, handler, meta = {}) {
        if (!this._subs.has(channel)) this._subs.set(channel, new Map());
        this._subs.get(channel).set(handler, meta.instanceId || null);
        return () => this._subs.get(channel)?.delete(handler);
    }

    /**
     * 把消息投递给**除来源实例以外**的订阅者。
     *
     * 真实 Redis Pub/Sub 会把消息投回发布者，因此接收侧的 `originInstance` 判定
     * **必须保留**（见 `NotifyFanout._onEnvelope`）。这里额外做一层排除的意义在于：
     *   1. `remote` 这个投递计数才等于"扇出了几个**其他**实例"，否则会把发布者自己
     *      也算进去，让"跨实例扇出是否生效"这个指标失去意义；
     *   2. 省掉一次无用的本地回调。
     *
     * @param {string} channel
     * @param {object} envelope
     * @returns {Promise<number>} 实际投递的订阅者数
     */
    async broadcastExcept(channel, envelope) {
        const subs = this._subs.get(channel);
        if (!subs) return 0;
        let n = 0;
        for (const [fn, instanceId] of [...subs]) {
            if (instanceId && instanceId === envelope.originInstance) continue;
            try { await fn(envelope); n++; } catch { /* 单个订阅者异常不影响其他订阅者 */ }
        }
        return n;
    }

    /** @returns {number} 订阅者数量（测试用） */
    subscriberCount(channel) {
        return this._subs.get(channel)?.size || 0;
    }

    reset() {
        this._subs.clear();
        this.published = 0;
    }
}

/**
 * 跨实例通知门面。
 */
export class NotifyFanout {
    /**
     * @param {object} opts
     * @param {string} opts.instanceId      - 本实例标识（用于回环抑制）
     * @param {object} opts.backend         - 事件总线后端
     * @param {(channel: string, eventType: string, data: object) => void} [opts.localSink]
     *        本实例的本地投递函数（通常是 `SseHub.emit` 的绑定）
     * @param {() => number} [opts.clock]
     * @param {number} [opts.seenCapacity]
     * @param {number} [opts.seenTtlMs]
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        if (!opts.instanceId) throw new Error('NotifyFanout: instanceId 为必填');
        if (!opts.backend) throw new Error('NotifyFanout: 需要 backend');
        this.instanceId = opts.instanceId;
        this.backend = opts.backend;
        this.localSink = typeof opts.localSink === 'function' ? opts.localSink : null;
        this._clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        this.seenCapacity = opts.seenCapacity ?? DEFAULT_SEEN_CAPACITY;
        this.seenTtlMs = opts.seenTtlMs ?? DEFAULT_SEEN_TTL_MS;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;

        /** @type {Map<string, number>} eventId → 首次见到时刻 */
        this._seen = new Map();
        /** @type {Map<string, () => void>} */
        this._unsubs = new Map();
        this._stats = { published: 0, deliveredLocal: 0, deliveredRemote: 0, duplicates: 0, loopbackSuppressed: 0, errors: 0 };
    }

    /**
     * 订阅一个频道（把该频道的事件投递到本地 SSE 订阅者）。
     *
     * @param {string} channel - 逻辑频道，如 taskId 或 `tenant:{id}`
     * @returns {Promise<() => void>} 退订函数
     */
    async subscribeChannel(channel) {
        if (this._unsubs.has(channel)) return this._unsubs.get(channel);
        const off = await this.backend.subscribe(channel, (envelope) => this._onEnvelope(envelope),
            { instanceId: this.instanceId });
        const wrapper = () => {
            off && off();
            this._unsubs.delete(channel);
        };
        this._unsubs.set(channel, wrapper);
        return wrapper;
    }

    /**
     * 发布事件（先本地投递，再广播到其他实例）。
     *
     * **本地直发**而不是"发到总线再等回来"：省一次网络往返，且本实例的
     * 订阅者延迟最低（前端就挂在本实例上）。回环由 originInstance 抑制。
     *
     * @param {object} p
     * @param {string} p.channel
     * @param {string} p.eventType
     * @param {object} p.data
     * @param {string} [p.tenantId]
     * @param {string} [p.traceparent]
     * @returns {Promise<{eventId: string, local: number, remote: number}>}
     */
    async publish({ channel, eventType, data, tenantId, traceparent }) {
        const envelope = {
            eventId: randomUUID(),
            channel,
            eventType,
            data,
            tenantId: tenantId || null,
            traceparent: traceparent || null,
            originInstance: this.instanceId,
            at: nowCST(),
            publishedAt: this._clock()
        };

        let local = 0;
        if (this.localSink) {
            try {
                this.localSink(channel, eventType, data);
                local = 1;
                this._stats.deliveredLocal++;
            } catch (err) {
                this._stats.errors++;
                this._log('warn', `本地投递失败：${err.message}`);
            }
        }

        let remote = 0;
        try {
            remote = typeof this.backend.broadcastExcept === 'function'
                ? await this.backend.broadcastExcept(channel, envelope)
                : await this.backend.publish(channel, envelope);
        } catch (err) {
            // 广播失败不能影响本地投递（本地订阅者已经收到事件了）
            this._stats.errors++;
            this._log('warn', `跨实例广播失败（本地已投递）：${err.message}`);
        }

        this._stats.published++;
        return { eventId: envelope.eventId, local, remote };
    }

    /**
     * 收到总线事件。
     * @param {object} envelope
     * @private
     */
    _onEnvelope(envelope) {
        // 回环抑制：自己发的已在 publish 时本地直发过
        if (envelope.originInstance === this.instanceId) {
            this._stats.loopbackSuppressed++;
            return;
        }
        // 实例 × 事件 去重（at-least-once 的必然要求）
        if (this._isDuplicate(envelope.eventId)) {
            this._stats.duplicates++;
            return;
        }
        if (this.localSink) {
            try {
                this.localSink(envelope.channel, envelope.eventType, envelope.data);
                this._stats.deliveredRemote++;
            } catch (err) {
                this._stats.errors++;
                this._log('warn', `跨实例事件本地投递失败：${err.message}`);
            }
        }
    }

    /**
     * 是否重复事件（顺带清理过期记录）。
     * @param {string} eventId
     * @returns {boolean}
     * @private
     */
    _isDuplicate(eventId) {
        const t = this._seen.get(eventId);
        const now = this._clock();
        if (t !== undefined && now - t <= this.seenTtlMs) return true;
        if (this._seen.size >= this.seenCapacity) {
            const oldest = this._seen.keys().next().value;
            if (oldest !== undefined) this._seen.delete(oldest);
        }
        this._seen.set(eventId, now);
        return false;
    }

    /**
     * 退订全部频道。
     * @returns {Promise<void>}
     */
    async close() {
        for (const off of this._unsubs.values()) {
            try { off(); } catch { /* 忽略 */ }
        }
        this._unsubs.clear();
    }

    /** @returns {object} */
    getStats() {
        return {
            instanceId: this.instanceId,
            channels: this._unsubs.size,
            seen: this._seen.size,
            ...this._stats
        };
    }

    /** @private */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[Notify|${this.instanceId}] ${msg}`);
    }
}

export default NotifyFanout;
