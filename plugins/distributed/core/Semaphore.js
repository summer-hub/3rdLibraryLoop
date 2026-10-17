/**
 * DistributedSemaphore —— 跨实例并发令牌（Phase 4）
 *
 * ## 为什么进程内信号量在多实例下失效
 *
 * Phase 1 的 `Semaphore` 是进程级的：`MAX_CONCURRENT_SESSIONS=50` 表示**每个实例** 50 个。
 * 3 个实例并跑就是 150 个并发会话砸向同一个 opencode 进程与同一个 LLM 配额——
 * 而上限的初衷正是"保护外部单进程"。这不是"多一点"，而是**保护完全失效**。
 *
 * ## 三层限流的分布式化映射
 *
 * | 层级 | 进程内（Phase 1/3） | 分布式（Phase 4） |
 * |---|---|---|
 * | 全局 | `Semaphore` | **本模块**（Redis 原子令牌） |
 * | 任务级 | `Semaphore` 的 `perTaskLimit` | 本模块（`{taskId}` 维度） |
 * | 角色级 | `RoleLimiter` | 本模块（`{role}` 维度） |
 *
 * ## 令牌必须带租约（否则实例崩溃会永久漏令牌）
 *
 * 纯计数器的致命问题：实例 A 拿到令牌后 `kill -9`，递减操作永远不会执行，
 * 令牌**永久缺失**——跑够 50 次崩溃后，整个集群再也拿不到任何令牌。
 * 因此这里的每个令牌都带 TTL，前端在 ZSET / 有序集合里按过期时间索引，
 * 过期令牌会被自动回收（"崩溃的实例自动让出份额"）。
 *
 * ## 原子性：为什么必须用 Lua
 *
 * "读当前数 → 判断是否小于上限 → 递增"这三步如果分开发命令，并发下必然超发。
 * Redis 的 Lua 脚本整体原子执行，把三步压成一次操作。命令文本可静态复核；
 * **端到端行为需要活的 Redis**（本仓库内的测试用内存后端验证同一套语义）。
 */

import { randomBytes } from 'node:crypto';

import { LatencyRecorder } from './lib/LatencyRecorder.js';
import { nowCST } from '../../../core/cstTime.js';

/** 默认令牌 TTL：没有它，崩溃的实例会永久漏掉令牌 */
export const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;

/** 默认等待超时 */
export const DEFAULT_ACQUIRE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 内存后端：进程内参考实现（语义与 Redis 版本一致）。
 *
 * 用"按 key 串行化"模拟 Lua 的原子性。真实实现里这一步由 Redis 单线程保证。
 */
export class MemoryTokenBackend {
    constructor({ clock } = {}) {
        this._clock = typeof clock === 'function' ? clock : Date.now;
        /** @type {Map<string, Map<string, number>>} key → (tokenId → 过期时刻) */
        this._tokens = new Map();
        /** @type {Map<string, Promise<void>>} */
        this._chains = new Map();
    }

    /** @private */
    async _serial(key, fn) {
        const prev = this._chains.get(key) ?? Promise.resolve();
        const chain = prev.then(fn, fn);
        const registered = chain.catch(() => {});
        this._chains.set(key, registered);
        try {
            return await chain;
        } finally {
            if (this._chains.get(key) === registered) this._chains.delete(key);
        }
    }

    /** @private */
    _live(key) {
        const now = this._clock();
        const m = this._tokens.get(key) || new Map();
        for (const [id, exp] of [...m]) {
            if (exp <= now) m.delete(id);   // 过期令牌自动回收
        }
        this._tokens.set(key, m);
        return m;
    }

    /**
     * 原子获取：清理过期 → 判断是否满 → 记录令牌。
     * @returns {Promise<{ok: boolean, count: number}>}
     */
    async acquireToken(key, tokenId, { limit, ttlMs }) {
        return this._serial(key, async () => {
            const m = this._live(key);
            if (limit > 0 && m.size >= limit) return { ok: false, count: m.size };
            m.set(tokenId, this._clock() + ttlMs);
            return { ok: true, count: m.size };
        });
    }

    async releaseToken(key, tokenId) {
        return this._serial(key, async () => {
            const m = this._live(key);
            return m.delete(tokenId);
        });
    }

    async count(key) {
        return this._live(key).size;
    }

    async listTokens(key) {
        const now = this._clock();
        return [...this._live(key)].map(([id, exp]) => ({ id, expiresAt: exp, ttlLeftMs: exp - now }));
    }
}

/**
 * Redis 后端（Lua 原子令牌，命令可静态复核）。
 *
 * 数据结构：`ZSET`，score = 令牌过期时间戳（ms）。
 * 用 ZSET 而不是计数器 + TTL 的原因：需要**逐个令牌**的过期时间，
 * 且要能一条命令回收所有过期项（`ZREMRANGEBYSCORE`），计数器做不到。
 */
export class RedisTokenBackend {
    /**
     * @param {object} opts
     * @param {(script: string, keys: string[], args: (string|number)[]) => Promise<any>} opts.evalScript
     */
    constructor(opts = {}) {
        if (typeof opts.evalScript !== 'function') {
            throw new Error('RedisTokenBackend: 需要注入 evalScript(script, keys, args) 函数');
        }
        this._eval = opts.evalScript;
    }

    /**
     * 原子获取令牌的 Lua 脚本。
     *
     * 逐步说明（每步都是必需的）：
     *   1. `ZREMRANGEBYSCORE` 回收过期令牌——**没有这一步，崩溃的实例会永久漏令牌**；
     *   2. `ZCARD` 取当前令牌数；
     *   3. 未满则 `ZADD` 写入（score = 过期时刻），返回成功；
     *   4. 已满则返回失败与当前数量（调用方可据此做退避/告警）。
     *
     * @returns {string}
     */
    static acquireScript() {
        return `
local key   = KEYS[1]
local now   = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local token = ARGV[3]
local ttl   = tonumber(ARGV[4])

redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local count = redis.call('ZCARD', key)
if limit > 0 and count >= limit then
  return {0, count}
end
redis.call('ZADD', key, now + ttl, token)
return {1, count + 1}
`.trim();
    }

    /** 释放令牌（`ZREM`，幂等）。 */
    static releaseScript() {
        return `
redis.call('ZREM', KEYS[1], ARGV[1])
return redis.call('ZCARD', KEYS[1])
`.trim();
    }

    async acquireToken(key, tokenId, { limit, ttlMs }) {
        const r = await this._eval(RedisTokenBackend.acquireScript(), [key], [Date.now(), limit, tokenId, ttlMs]);
        return { ok: Number(r[0]) === 1, count: Number(r[1]) };
    }

    async releaseToken(key, tokenId) {
        await this._eval(RedisTokenBackend.releaseScript(), [key], [tokenId]);
        return true;
    }

    async count(key) {
        return Number(await this._eval('return redis.call(\'ZCARD\', KEYS[1])', [key], []));
    }

    async listTokens(key) {
        const r = await this._eval('return redis.call(\'ZRANGE\', KEYS[1], 0, -1, \'WITHSCORES\')', [key], []);
        const out = [];
        for (let i = 0; i < (r || []).length; i += 2) {
            out.push({ id: r[i], expiresAt: Number(r[i + 1]), ttlLeftMs: Number(r[i + 1]) - Date.now() });
        }
        return out;
    }
}

/**
 * 分布式信号量门面。
 */
export class DistributedSemaphore {
    /**
     * @param {object} opts
     * @param {objet} [opts.backend]
     * @param {number} [opts.limit=0]              - 0 = 不限制
     * @param {number} [opts.tokenTtlMs]
     * @param {number} [opts.acquireTimeoutMs]
     * @param {string} [opts.namespace='3lib:sess']
     * @param {() => number} [opts.clock]
     * @param {number} [opts.retryMs=50]           - 等待重试间隔
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        this.backend = opts.backend || new MemoryTokenBackend({ clock: opts.clock });
        this.limit = Number.isInteger(opts.limit) && opts.limit >= 0 ? opts.limit : 0;
        this.tokenTtlMs = opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
        this.acquireTimeoutMs = opts.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
        this.namespace = opts.namespace || '3lib:sess';
        this.retryMs = Number.isFinite(opts.retryMs) && opts.retryMs > 0 ? opts.retryMs : 50;
        this._clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        this._seq = 0;
        /**
         * @type {string} 持有者标识。
         *
         * **必须跨实例唯一**，因此除了 pid/hostname 还带一段随机值。
         * 这里踩过一个真实的坑：token id 由 `ownerId + 序号 + 时间戳` 组成，
         * 而 pid 相同（同一进程内多个实例）、hostname 相同、时间戳精确到毫秒时，
         * 三个实例会生成**完全相同的 tokenId**——ZSET/Map 是集合语义，
         * 于是三个令牌被折叠成**一个**，`ZCARD` 显示 1 而不是 3。
         * 后果是"全局上限被静默放宽"：限流器以为还有额度，实际并发已经超了。
         * 加上随机后缀后，跨实例/跨重启的碰撞概率可忽略。
         */
        this.ownerId = opts.ownerId || `${process.pid}@${process.env.HOSTNAME || 'local'}#${randomBytes(4).toString('hex')}`;
        this.waitRecorder = new LatencyRecorder({ name: 'distributed_token_wait_ms' });
        this._stats = { acquired: 0, timedOut: 0, released: 0, expiredReclaimed: 0, ownerId: this.ownerId };
    }

    /** @private */
    _key(dimension) {
        return dimension ? `${this.namespace}:${dimension}` : this.namespace;
    }

    /**
     * 获取令牌（带超时与重试）。
     *
     * @param {object} [p]
     * @param {string} [p.dimension] - 维度（如 `task:t1` 或 `role:coder`）；缺省为全局
     * @param {number} [p.limit]     - 覆盖默认上限
     * @param {number} [p.timeoutMs]
     * @param {number} [p.tokenTtlMs]
     * @returns {Promise<{ok: boolean, waitedMs: number, tokenId: string|null, release: () => Promise<boolean>}>}
     */
    async acquire(p = {}) {
        const key = this._key(p.dimension);
        const limit = Number.isInteger(p.limit) ? p.limit : this.limit;
        const ttlMs = p.tokenTtlMs ?? this.tokenTtlMs;
        const timeoutMs = p.timeoutMs ?? this.acquireTimeoutMs;
        const deadline = this._clock() + timeoutMs;
        const t0 = this._clock();

        // 不限流：不占用任何分布式资源（避免为"关闭的开关"付网络成本）
        if (limit <= 0) {
            this._stats.acquired++;
            return { ok: true, waitedMs: 0, tokenId: null, release: async () => true };
        }

        const tokenId = `${this.ownerId}#${++this._seq}#${Date.now().toString(36)}#${randomBytes(3).toString('hex')}`;

        for (;;) {
            const r = await this.backend.acquireToken(key, tokenId, { limit, ttlMs });
            if (r.ok) {
                const waitedMs = this._clock() - t0;
                this.waitRecorder.record(waitedMs);
                this._stats.acquired++;
                let released = false;
                return {
                    ok: true,
                    waitedMs,
                    tokenId,
                    release: async () => {
                        if (released) return false;   // 幂等
                        released = true;
                        await this.backend.releaseToken(key, tokenId);
                        this._stats.released++;
                        return true;
                    }
                };
            }
            if (this._clock() >= deadline) {
                this._stats.timedOut++;
                this._log('warn',
                    `分布式令牌等待超时（${timeoutMs}ms，key=${key}，当前占用=${r.count}/${limit}）`);
                return { ok: false, waitedMs: this._clock() - t0, tokenId: null, release: async () => false };
            }
            await sleep(this.retryMs);
        }
    }

    /**
     * 当前占用数（跨实例）。
     * @param {string} [dimension]
     * @returns {Promise<number>}
     */
    async count(dimension) {
        return this.backend.count(this._key(dimension));
    }

    /**
     * 令牌明细（含剩余 TTL）——用于**验证"崩溃实例的令牌会被回收"**。
     * @param {string} [dimension]
     * @returns {Promise<object[]>}
     */
    async listTokens(dimension) {
        return this.backend.listTokens(this._key(dimension));
    }

    /** @returns {object} */
    getStats() {
        return {
            limit: this.limit,
            tokenTtlMs: this.tokenTtlMs,
            ...this._stats,
            queueWaitP95Ms: this.waitRecorder.percentile(0.95),
            startedAt: nowCST()
        };
    }

    /** @private */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[DistributedSemaphore] ${msg}`);
    }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export default DistributedSemaphore;
