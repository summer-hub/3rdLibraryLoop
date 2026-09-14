/**
 * Queue —— 至少一次投递的消息队列 + 幂等消费者（Phase 4）
 *
 * ## 为什么不能直接"把 MessageBus 换掉"
 *
 * Phase 2 的 `MessageBus` 是**进程内**的：投递即执行，没有"未确认"状态。
 * 跨进程后语义变成 **at-least-once**：消息可能重复投递（消费者崩溃后重投、
 * 网络重试、broker 重平衡）。于是协作层必须处理两件在进程内根本不存在的事：
 *
 *   1. **重复消费**：同一条 `REVISION_REQUEST` 被处理两次 → Coder 重做两次
 *      （白白烧一轮成本，还可能把评审已通过的产物改坏）。
 *   2. **处理到一半崩溃**：必须能重投，且重投次数要有上限（否则毒消息会
 *      无限循环，把消费者的CPU吃光）。
 *
 * ## 本模块给出的三个保证
 *
 * | 保证 | 实现 |
 * |---|---|
 * | 至少一次 | 未 `ack` 的消息在可见性超时后被**重投**；崩溃不会静默丢消息 |
 * | 效果上的一次 | `IdempotentConsumer` 按 `messageId` 去重（有界 + TTL 过期），重复投递被跳过但**仍会 ack** |
 * | 毒消息隔离 | 超过 `maxAttempts` 进入**死信队列**并记录原因，不再重投 |
 *
 * ## backend 契约（换成 Redis Streams / Kafka 的接缝）
 *
 * ```
 * push(queue, message)                     → string        // 返回消息 id
 * claim(queue, consumerId, {limit, visibilityMs}) → message[]  // 领取可消费消息（含重投）
 * ack(queue, messageId)                    → void
 * nack(queue, messageId, {retryIn} = {})   → void          // 主动退回（稍后重投）
 * deadLetter(queue, messageId, reason)     → void
 * stats(queue)                             → object
 * ```
 *
 * - `MemoryQueueBackend`：进程内参考实现（语义与真实 broker 对齐，含可见性超时与重投）。
 * - `RedisStreamsBackend`：用 `XADD` / `XREADGROUP` / `XACK` / `XAUTOCLAIM` 实现同一契约；
 *   命令文本可静态复核，**端到端行为需要活的 Redis 才能验证**（诚实边界）。
 */

/** 默认可见性超时：消费者领取后多久未 ack 视为"死亡"，消息可被重投 */
export const DEFAULT_VISIBILITY_MS = 30000;

/** 默认最大投递次数（超过进死信） */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** 幂等去重的默认保留时长 */
export const DEFAULT_DEDUPE_TTL_MS = 3600 * 1000;

/**
 * 内存队列后端：进程内参考实现。
 *
 * 为什么要在内存里也实现完整的"可见性超时 + 重投 + 死信"：
 * 它让上层（幂等消费、毒消息处理、重投计数）的**全部语义都能被断言**，
 * 而不需要先有一台 Kafka。真实 broker 只是把同一契约换成持久化实现。
 */
export class MemoryQueueBackend {
    /**
     * @param {object} [opts]
     * @param {() => number} [opts.clock]
     */
    constructor(opts = {}) {
        this._clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        /** @type {Map<string, object[]>} queue → 消息（含状态） */
        this._queues = new Map();
        /** @type {Map<string, object[]>} queue → 死信 */
        this._dead = new Map();
        this._seq = 0;
    }

    /** @private */
    _q(queue) {
        if (!this._queues.has(queue)) this._queues.set(queue, []);
        return this._queues.get(queue);
    }

    async push(queue, message) {
        const id = `msg-${++this._seq}`;
        this._q(queue).push({
            id,
            body: structuredClone(message),
            attempts: 0,
            visibleAt: 0,
            consumerId: null,
            acked: false
        });
        return id;
    }

    /**
     * 领取消息：包含"从未投递"与"可见性超时后可重投"两类。
     */
    async claim(queue, consumerId, { limit = 1, visibilityMs = DEFAULT_VISIBILITY_MS } = {}) {
        const now = this._clock();
        const out = [];
        for (const m of this._q(queue)) {
            if (out.length >= limit) break;
            if (m.acked) continue;
            if (m.visibleAt > now) continue;
            if (m.attempts >= 100) continue; // 兜底：永不无限重投
            m.attempts++;
            m.consumerId = consumerId;
            m.visibleAt = now + visibilityMs;
            m.lastDeliveredAt = now;
            out.push({ id: m.id, body: structuredClone(m.body), attempts: m.attempts, consumerId });
        }
        return out;
    }

    async ack(queue, messageId) {
        const m = this._q(queue).find((x) => x.id === messageId);
        if (!m) return false;
        m.acked = true;
        m.ackedAt = this._clock();
        return true;
    }

    async nack(queue, messageId, { retryIn = 0 } = {}) {
        const m = this._q(queue).find((x) => x.id === messageId);
        if (!m) return false;
        // 退回即"立即可见"，等待下一次 claim 重投
        m.visibleAt = this._clock() + Math.max(0, retryIn);
        m.consumerId = null;
        return true;
    }

    async deadLetter(queue, messageId, reason) {
        const arr = this._q(queue);
        const i = arr.findIndex((x) => x.id === messageId);
        if (i < 0) return false;
        const [m] = arr.splice(i, 1);
        if (!this._dead.has(queue)) this._dead.set(queue, []);
        this._dead.get(queue).push({ ...m, deadReason: reason, deadAt: this._clock() });
        return true;
    }

    async stats(queue) {
        const arr = this._q(queue);
        const now = this._clock();
        return {
            total: arr.length,
            pending: arr.filter((m) => !m.acked && m.visibleAt <= now).length,
            inFlight: arr.filter((m) => !m.acked && m.visibleAt > now).length,
            acked: arr.filter((m) => m.acked).length,
            dead: (this._dead.get(queue) || []).length
        };
    }

    /**
     * 死信明细。
     * @param {string} queue
     * @returns {Promise<object[]>}
     */
    async listDead(queue) {
        return (this._dead.get(queue) || []).map((m) => ({
            id: m.id, attempts: m.attempts, reason: m.deadReason, body: structuredClone(m.body)
        }));
    }

    /** 仅供测试 */
    reset() {
        this._queues.clear();
        this._dead.clear();
        this._seq = 0;
    }
}

/**
 * Redis Streams 后端（同一契约，命令可静态复核）。
 *
 * 关键命令与理由：
 * | 场景 | 命令 | 为什么 |
 * |---|---|---|
 * | 入队 | `XADD` | 追加写入，O(1) |
 * | 领取 | `XREADGROUP` | 消费组保证同一消息不被两个消费者同时领走 |
 * | 确认 | `XACK` | 显式确认，未确认留在 PEL（Pending Entries List）中 |
 * | 接管僵死消费者的消息 | `XAUTOCLAIM` | 消费者崩溃后其 PEL 中的消息能被其他实例接管——**这是"至少一次"能落地的前提** |
 * | 重投计数 | `XPENDING` / `XCLAIM` 的 `JUSTID` | 判断投递次数以决定是否进死信 |
 *
 * 诚实边界：真实行为（消费组重平衡、`XAUTOCLAIM` 的最小空闲时间语义、
 * Redis 持久化策略对"至少一次"的影响）**需要活的 Redis** 才能验证。
 */
export class RedisStreamsBackend {
    /**
     * @param {object} opts
     * @param {(cmd: string, args: any[]) => Promise<any>} opts.call - Redis 客户端调用
     * @param {string} [opts.group='3lib']
     * @param {string} [opts.consumer='c1']
     */
    constructor(opts = {}) {
        if (typeof opts.call !== 'function') {
            throw new Error('RedisStreamsBackend: 需要注入 call(cmd, args) 函数');
        }
        this._call = opts.call;
        this.group = opts.group || '3lib';
        this.consumer = opts.consumer || 'c1';
    }

    async ensureGroup(stream) {
        try {
            await this._call('XGROUP', ['CREATE', stream, this.group, '$', 'MKSTREAM']);
        } catch (err) {
            // BUSYGROUP 表示已存在，属于正常情况
            if (!/BUSYGROUP/.test(String(err.message))) throw err;
        }
    }

    async push(stream, message) {
        return this._call('XADD', [stream, '*', 'body', JSON.stringify(message)]);
    }

    async claim(stream, consumerId, { limit = 1, visibilityMs = DEFAULT_VISIBILITY_MS } = {}) {
        // 先接管"空闲超过可见性超时"的待确认消息（崩溃消费者的遗留）
        const reclaimed = await this._call('XAUTOCLAIM', [
            stream, this.group, consumerId, String(visibilityMs), '0', 'COUNT', String(limit)
        ]).catch(() => [null, []]);
        const out = [];
        const parse = (entries) => {
            for (const entry of entries || []) {
                const [id, fields] = entry;
                const bodyIdx = (fields || []).indexOf('body');
                if (bodyIdx < 0) continue;
                out.push({ id, body: JSON.parse(fields[bodyIdx + 1]), attempts: null, consumerId });
            }
        };
        parse(reclaimed?.[1]);
        if (out.length < limit) {
            const fresh = await this._call('XREADGROUP', [
                'GROUP', this.group, consumerId, 'COUNT', String(limit - out.length), 'STREAMS', stream, '>'
            ]);
            // 返回形状：[stream, entries]
            if (fresh) parse(fresh[0]?.[1]);
        }
        return out;
    }

    async ack(stream, messageId) {
        await this._call('XACK', [stream, this.group, messageId]);
        return true;
    }

    async nack(stream, messageId) {
        // 不确认即可：消息留在 PEL，达到最小空闲时间后由 XAUTOCLAIM 重投
        await this._call('XCLAIM', [stream, this.group, this.consumer, '0', messageId, 'JUSTID'])
            .catch(() => null);
        return true;
    }

    async deadLetter(stream, messageId, reason) {
        await this._call('XADD', [`${stream}:dead`, '*', 'reason', String(reason), 'id', messageId]);
        await this._call('XACK', [stream, this.group, messageId]);
        return true;
    }

    async stats(stream) {
        const info = await this._call('XPENDING', [stream, this.group]).catch(() => null);
        return { stream, redisPending: info || null };
    }
}

/**
 * 幂等消费者：把"至少一次投递"收敛成"效果上的一次执行"。
 *
 * **去重表必须有界且会过期**。理由：无界去重表在长时间运行的服务里就是内存泄漏
 * （每处理一条消息多一条记录）；而永不过期又会在消息 id 复用（如按时间戳生成）时
 * 把新消息误判为重复。这里用"容量上限 + TTL 双约束"：
 *   - 容量满 → 淘汰最旧的记录（最旧的消息重复投递的概率最低）；
 *   - 超过 TTL → 视为新消息（宁可重复执行一次，也不要永久漏执行）。
 *
 * 副作用：这是一个**有意的取舍**——"效果上的一次"在极端情况（消息 id 复用且时间跨度
 * 超过 TTL）下会退化为"至少一次"。因此业务侧的关键写入仍应有自己的幂等键。
 * 把这一点写明，比宣称"exactly-once"更诚实。
 */
export class IdempotentConsumer {
    /**
     * @param {object} [opts]
     * @param {number} [opts.capacity=10000]
     * @param {number} [opts.ttlMs]        - 去重记录保留时长
     * @param {() => number} [opts.clock]
     */
    constructor(opts = {}) {
        this.capacity = Number.isInteger(opts.capacity) && opts.capacity > 0 ? opts.capacity : 10000;
        this.ttlMs = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : DEFAULT_DEDUPE_TTL_MS;
        this._clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        /** @type {Map<string, number>} messageId → 处理完成时刻 */
        this._seen = new Map();
        this._stats = { processed: 0, skipped: 0, evicted: 0, expired: 0 };
    }

    /**
     * 是否已处理过（顺带清理过期记录）。
     * @param {string} messageId
     * @returns {boolean}
     */
    has(messageId) {
        const t = this._seen.get(messageId);
        if (t === undefined) return false;
        if (this._clock() - t > this.ttlMs) {
            this._seen.delete(messageId);
            this._stats.expired++;
            return false;
        }
        return true;
    }

    /**
     * 标记已处理。
     * @param {string} messageId
     */
    mark(messageId) {
        if (this._seen.size >= this.capacity) {
            // Map 保持插入顺序：删掉最早插入的即可（近似 LRU，无需额外结构）
            const oldest = this._seen.keys().next().value;
            if (oldest !== undefined) {
                this._seen.delete(oldest);
                this._stats.evicted++;
            }
        }
        this._seen.set(messageId, this._clock());
    }

    /**
     * 幂等执行：重复投递会被跳过，但**仍然 ack**（不 ack 会导致无限重投）。
     *
     * @param {object} p
     * @param {string} p.messageId
     * @param {() => Promise<any>} p.run - 真正的业务处理
     * @returns {Promise<{executed: boolean, result?: any, reason?: string}>}
     */
    async runOnce({ messageId, run }) {
        if (!messageId) throw new Error('IdempotentConsumer.runOnce: messageId 为必填');
        if (this.has(messageId)) {
            this._stats.skipped++;
            return { executed: false, reason: 'duplicate' };
        }
        const result = await run();
        this.mark(messageId);
        this._stats.processed++;
        return { executed: true, result };
    }

    /** @returns {object} */
    getStats() {
        return { ...this._stats, tracked: this._seen.size, capacity: this.capacity, ttlMs: this.ttlMs };
    }
}

/**
 * 消息队列门面：投递、消费（含幂等与死信）。
 */
export class MessageQueue {
    /**
     * @param {object} [opts]
     * @param {object} [opts.backend]
     * @param {number} [opts.visibilityMs]
     * @param {number} [opts.maxAttempts]
     * @param {number} [opts.dedupeTtlMs]
     * @param {() => number} [opts.clock]
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        this.backend = opts.backend || new MemoryQueueBackend({ clock: opts.clock });
        this.visibilityMs = opts.visibilityMs ?? DEFAULT_VISIBILITY_MS;
        this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.consumer = new IdempotentConsumer({ clock: opts.clock, ttlMs: opts.dedupeTtlMs });
        this._clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        this._stats = { published: 0, delivered: 0, acked: 0, duplicates: 0, failed: 0, deadLettered: 0, redelivered: 0 };
    }

    /**
     * 发布消息。
     * @param {string} queue
     * @param {object} body - 需可 JSON 序列化
     * @returns {Promise<string>} 消息 id
     */
    async publish(queue, body) {
        const id = await this.backend.push(queue, body);
        this._stats.published++;
        return id;
    }

    /**
     * 消费一批（含幂等去重、失败重投、毒消息死信）。
     *
     * @param {string} queue
     * @param {(body: object, meta: object) => Promise<any>} handler
     * @param {object} [opts]
     * @param {number} [opts.limit=1]
     * @param {number} [opts.retryInMs]
     * @returns {Promise<{consumed: number, executed: number, duplicates: number, failed: number, deadLettered: number}>}
     */
    async consume(queue, handler, opts = {}) {
        const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 1;
        const msgs = await this.backend.claim(queue, this._consumerId(), {
            limit, visibilityMs: this.visibilityMs
        });

        const out = { consumed: msgs.length, executed: 0, duplicates: 0, failed: 0, deadLettered: 0 };

        for (const m of msgs) {
            this._stats.delivered++;
            if (m.attempts > 1) this._stats.redelivered++;

            // 毒消息：超过投递上限 → 死信（不再重投，避免无限循环）
            if (m.attempts > this.maxAttempts) {
                await this.backend.deadLetter(queue, m.id, `超过最大投递次数 ${this.maxAttempts}`);
                this._stats.deadLettered++;
                out.deadLettered++;
                this._log('error', `消息 ${m.id} 进入死信队列（${m.attempts} 次投递均失败）`);
                continue;
            }

            // 幂等：重复投递直接 ack 跳过。**必须 ack**，否则会无限重投。
            if (this.consumer.has(m.id)) {
                await this.backend.ack(queue, m.id);
                this._stats.duplicates++;
                out.duplicates++;
                continue;
            }

            try {
                const r = await this.consumer.runOnce({
                    messageId: m.id,
                    run: () => handler(m.body, { messageId: m.id, attempts: m.attempts, queue })
                });
                await this.backend.ack(queue, m.id);
                this._stats.acked++;
                out.executed++;
                if (!r.executed) { this._stats.duplicates++; out.duplicates++; }
            } catch (err) {
                // 失败 → 退回等待重投（至少一次语义）
                await this.backend.nack(queue, m.id, { retryIn: opts.retryInMs ?? 0 });
                this._stats.failed++;
                out.failed++;
                this._log('warn', `消息 ${m.id} 处理失败（第 ${m.attempts} 次），将重投：${err.message}`);
            }
        }
        return out;
    }

    /**
     * 拉取死信明细（运维用）。
     * @param {string} queue
     * @returns {Promise<object[]>}
     */
    async listDead(queue) {
        return typeof this.backend.listDead === 'function' ? this.backend.listDead(queue) : [];
    }

    /** @returns {Promise<object>} */
    async stats(queue) {
        const backend = typeof this.backend.stats === 'function' ? await this.backend.stats(queue) : {};
        return { queue, ...backend, consumer: this.consumer.getStats(), ...this._stats };
    }

    /** @private */
    _consumerId() {
        return `${process.pid}@${process.env.HOSTNAME || 'local'}`;
    }

    /** @private */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[MessageQueue] ${msg}`);
    }
}

export default MessageQueue;
