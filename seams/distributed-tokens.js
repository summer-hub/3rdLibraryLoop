/**
 * seams/distributed-tokens.js — 跨实例并发令牌（全局信号量）契约
 *
 * Provider：`plugins/distributed/core`（`setup` 内 `ctx.provide('distributed-tokens', DistributedSemaphore)`）。
 * Consumer：会话开立路径（`POST /sessions` 的全局并发上限）与任何"多实例下不得把并发上限放大 N 倍"
 *           的装配。
 *
 * 服务形状：**类**（`factory: false`）。
 *
 * 为什么注册类而不是工厂：`DistributedSemaphore` 持有**每实例状态** —— `ownerId`
 * （`pid@host#随机段`，令牌归属与过期回收的前提）、`_seq` 与一个时延采样器。
 * 注册单例会让所有装配共用一个 `ownerId`，于是"谁持有的令牌"退化成"这个进程持有的令牌"，
 * 逐个调用方的归还与回收语义直接失效。
 *
 * 与 `distributed-lease` 的分工（两者都被部署清单的 `DISTRIBUTED_*` 开关控制，但语义不同）：
 *   - 租约 = **互斥**（同一资源同时只有一个持有者），靠 fencing token 挡住僵死写入；
 *   - 令牌 = **限流**（最多 N 个并发持有者），靠 TTL 让崩溃的持有者自动释放。
 * 把两者合成一条契约会让"要互斥还是要限流"变成同一个 API 的两个模式参数——那是把两套失效
 * 模式焊在一起，排障时必须同时理解两种语义。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3）。
 */

export const DISTRIBUTED_TOKENS_SEAM = Object.freeze({
    name: 'distributed-tokens',
    version: 1,
    factory: false,
    description:
        '跨实例并发令牌：用 Redis 原子操作 + TTL 实现全局并发上限，让"最多 N 个会话"在多实例下'
        + '仍然是 N；解决的是"进程内信号量在多实例下被放大 N 倍"',
    /**
     * 构造入参：**全部可选**（`new DistributedSemaphore({})` 必须成功：`limit` 缺省 0 = 不限流、
     * 令牌 TTL 15 分钟、等待超时 15 分钟、命名空间 `3lib:sess`）。具体键：
     *   - `backend`：`{acquireToken, releaseToken, count, listTokens, reclaimExpired?}`；
     *   - `limit`：默认上限（0 = 不限制）；`tokenTtlMs` / `acquireTimeoutMs` / `retryMs`；
     *   - `namespace`：Redis 键前缀；`clock` / `logger`。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法 */
    methods: Object.freeze([
        'acquire', // async ({dimension?, limit?, timeoutMs?, tokenTtlMs?}?) => {ok, waitedMs, tokenId, release()}
        'count', // async (dimension?) => number（当前占用的令牌数，供配额/告警观测）
        'listTokens', // async (dimension?) => 令牌明细（谁占着、何时到期）
        'getStats', // () => {limit, tokenTtlMs, acquired, timedOut, released, expiredReclaimed, ownerId}
    ]),
    /**
     * 产物上的属性：`limit`（当前上限，0 = 不限流）与 `backend`（部署侧报告后端类型）。
     * 它们是普通数据属性而非方法——排障时读 `semaphore.limit`，写 `semaphore.limit()` 会拿到函数对象。
     */
    properties: Object.freeze(['backend', 'limit']),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'zero-limit-means-unlimited-and-touches-no-backend',
        'acquire-returns-a-release-closure-and-release-is-idempotent',
        'timeout-returns-ok:false-with-a-noop-release',
        'token-ttl-makes-crashed-holders-reclaimable-automatically',
        'owner-id-is-unique-per-instance-so-token-ownership-is-attributable',
        'construction-never-throws-even-with-empty-options',
    ]),
    notes: Object.freeze({
        borrowing:
            '令牌是**借了必须还**的资源：取到的 `release()` 必须在业务路径的 finally 里调用，'
            + '否则该令牌要等 TTL 到期才回收——期间上限被无谓占满（历史上"开满后永久 429"就是'
            + '这一类 bug，有 m7 f41 F 组守护）。',
        dimensions:
            '`dimension` 是**同一后端内的独立配额**（如 `task:t1` / `role:coder`）。缺省即全局配额。'
            + '维度只影响键，不改变"上限 + TTL"的语义。',
        backends:
            '进程内参考实现 `MemoryTokenBackend` 与真实后端命令构造 `RedisTokenBackend`'
            + '（Lua 脚本保证"计数 + 写入 + 过期"原子）。真实后端的客户端（`ioredis`）是启动期'
            + '动态 import 的可选依赖：装不上就让服务启动失败，绝不静默退回内存语义。',
        siblings:
            '同一插件（`plugins/distributed/core`）同时提供 `distributed-lease`（主能力）、'
            + '`distributed-queue` 与 `distributed-observer`。',
    }),
});

export default DISTRIBUTED_TOKENS_SEAM;
