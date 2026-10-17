/**
 * seams/distributed-queue.js — 至少一次投递消息队列契约
 *
 * Provider：`plugins/distributed/core`（`setup` 内 `ctx.provide('distributed-queue', MessageQueue)`）。
 * Consumer：跨实例事件扇出（`notify-svc` 的投递路径）与任何"生产者在实例 A、消费者在实例 B"
 *           的装配。
 *
 * 服务形状：**类**（`factory: false`）—— 既有调用形状就是 `new MessageQueue(opts)`。
 *
 * 为什么注册类而不是工厂：`MessageQueue` 持有**每实例状态** —— `consumer`
 * （`IdempotentConsumer` 的去重表，容量/ TTL 随实例）与一组投递计数器。
 * 幂等去重表是"至少一次投递"能被压成"效果上一次"的关键：共享一份会让两个消费者的去重
 * 互相吞掉对方的消息（各自认为"别人处理过了"），那是静默丢消息。
 *
 * backend 走 `properties.backend`（构造入参，不是工厂参数）：部署侧读
 * `queue.backend.constructor.name` 报告 memory / redis-streams，替换后端只换一个对象。
 *
 * `IdempotentConsumer` **不单独立接缝**：它随 `MessageQueue` 一起被替换，是后者的内部件
 * （`this.consumer`）。它的 `has/mark/runOnce` 只在 `consume()` 的循环里被调用，
 * 没有独立消费者；单独立一条只会制造"消费者必须自己保证两者匹配"的假自由度。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3）。
 */

export const DISTRIBUTED_QUEUE_SEAM = Object.freeze({
    name: 'distributed-queue',
    version: 1,
    factory: false,
    description:
        '至少一次投递的消息队列门面：可见性超时 + 失败重投 + 幂等去重 + 毒消息死信；'
        + '解决的是"消费者可能崩溃，进程内投递没有未确认状态"',
    /**
     * 构造入参：**全部可选**（`new MessageQueue({})` 必须成功：后端缺省内存实现，
     * 可见性 30s、最大投递 5 次、去重 TTL 1 小时）。具体键：
     *   - `backend`：`{push, claim, ack, nack, deadLetter, listDead?, stats?}`；
     *   - `visibilityMs` / `maxAttempts` / `dedupeTtlMs`：投递语义旋钮；
     *   - `clock`：测试注入时钟；`logger`：`(level, msg) => void`。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法 */
    methods: Object.freeze([
        'publish', // async (queue, body) => messageId
        'consume', // async (queue, handler, {limit?, retryInMs?}?) => {consumed, executed, duplicates, failed, deadLettered}
        'listDead', // async (queue) => 死信明细（后端不支持时返回空数组，不抛错）
        'stats', // async (queue) => {queue, ...backendStats, consumer, ...counters}
    ]),
    /**
     * 产物上的属性：`backend` 供部署侧报告后端类型；`consumer` 供运维查去重表容量；
     * 两个数值旋钮供排障时确认"这个实例到底用的是哪套投递语义"。
     */
    properties: Object.freeze(['backend', 'visibilityMs', 'maxAttempts', 'consumer']),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'delivery-is-at-least-once-never-at-most-once',
        'handler-failure-nacks-the-message-back-for-redelivery',
        'duplicate-delivery-is-acked-not-requeued',
        'message-exceeding-max-attempts-goes-to-dead-letter-and-is-not-redelivered',
        'claimed-message-is-invisible-to-other-consumers-until-visibility-timeout',
        'construction-never-throws-even-with-empty-options',
        'stats-never-throws-when-backend-does-not-support-it',
    ]),
    notes: Object.freeze({
        exactlyOnce:
            '本接缝**不**承诺 exactly-once，也不该被这样使用：去重表是内存结构 + TTL，'
            + '"消息 id 复用且时间跨度超过 TTL"时会退化为至少一次。因此业务侧的关键写入仍应'
            + '有自己的幂等键。把这一点写明比宣称 exactly-once 更诚实。',
        backends:
            '进程内参考实现 `MemoryQueueBackend` 与真实后端命令构造 `RedisStreamsBackend`'
            + '（消费组 + XCLAIM 语义）。真实后端的客户端（`ioredis`）是**启动期动态 import**'
            + '的可选依赖：装不上就让服务启动失败，绝不静默退回内存语义。',
        deadLetter:
            '毒消息（超过 `maxAttempts` 次投递仍失败）进死信而**不再重投**——否则一条坏消息会'
            + '把整个队列拖成无限循环。死信明细用 `listDead(queue)` 读，供人工处置。',
        siblings:
            '同一插件（`plugins/distributed/core`）同时提供 `distributed-lease`（主能力）、'
            + '`distributed-tokens` 与 `distributed-observer`。',
    }),
});

export default DISTRIBUTED_QUEUE_SEAM;
