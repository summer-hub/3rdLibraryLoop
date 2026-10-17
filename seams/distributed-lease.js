/**
 * seams/distributed-lease.js — 跨实例互斥租约（含 fencing）契约
 *
 * Provider：`plugins/distributed/core`（`setup` 内 `ctx.provide('distributed-lease', LeaseStore)`；
 *           本接缝是该插件的主能力，`plugin.json` 的 `seam` 字段写的就是它）。
 * Consumer：任务执行路径（`POST /tasks` 取租约 + 心跳续租 + `GET /leases` 运维接管扫描）与
 *           任何需要"同一任务不被两个实例同时执行"的装配。
 *
 * 服务形状：**类**（`factory: false`）—— 能力面全是实例方法，消费者 `new LeaseStore(opts)` 后使用。
 *
 * 为什么注册类而不是工厂：`LeaseStore` 持有**每实例状态** —— `_maxFence`（每个资源"已见最大
 * fencing token"，只增不减，是 `assertFence` 能挡住僵死写入者的前提）与一组计数器。
 * 注册单例会让两个装配共享同一份围栏账本（一个装配的接管会否认掉另一个装配的合法写入）；
 * 注册工厂则要每个消费者多包一层 `new (inject(...))()`，而既有调用形状就是 `new LeaseStore(...)`。
 *
 * 为什么后端注入点不在 `factoryOptions` 里：`backend` 是**构造入参**（`new LeaseStore({ backend })`），
 * 不是工厂参数。因此它走 `properties.backend` 通道：部署侧读
 * `runtime.deps.leases.backend.constructor.name` 就能报告"这个实例跑的是 memory 还是 postgres"
 * （`bootstrap.js` 的 `/health` 正是这么做的），而替换后端只需换一个对象。
 *
 * 实例成员清单从真实实现（`plugins/distributed/core/Lease.js`）推导。模块级的
 * `DEFAULT_LEASE_TTL_MS` / `DEFAULT_HEARTBEAT_MS` 是**模块导出**、不是实例能力面（而且是 number），
 * 因此不进 `methods` / `properties` / `constants`。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3）。
 */

export const DISTRIBUTED_LEASE_SEAM = Object.freeze({
    name: 'distributed-lease',
    version: 1,
    factory: false,
    description:
        '跨实例互斥的租约（含心跳续租与 fencing token）：保证同一资源不会被两个实例同时写入；'
        + '解决的是"任务被接管后旧持有者仍在写"这一类单进程无法表达的问题',
    /**
     * 构造入参：**全部可选**，因此声明为空数组（`new LeaseStore({})` 必须成功——只按环境变量/
     * 内置默认值工作，`ttlMs` 缺省用 30s、`backend` 缺省用内存后端）。
     * 具体键（都属"调用方配置"，不是跨提供方契约）：
     *   - `backend`：`{get,setIfAbsent,compareAndSet,delete,list}` 或 `{acquireAtomic,renewAtomic,releaseAtomic}`；
     *   - `ttlMs`：默认租约时长；`clock`：测试注入时钟；`logger`：`(level, msg) => void`。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法 */
    methods: Object.freeze([
        'acquire', // async ({resource, owner, ttlMs?}) => {ok, reason?, lease?, takeover?}
        'renew', // async ({resource, owner, fencingToken, ttlMs?}) => {ok, reason?, lease?}
        'release', // async ({resource, owner, fencingToken}) => boolean
        'peek', // async (resource) => lease | null（含 expired 标记）
        'assertFence', // async (resource, token) => true；token 过期抛 code='ESTALE_FENCE'
        'list', // async (prefix?) => lease[]（含 expired 标记，按 resource 排序）
        'listExpired', // async () => lease[]（"哪个实例死了、哪些任务待接管"）
        'maximumFence', // (resource) => number（已见最大 token，用于核对单调性）
        'getStats', // () => {active, maxFence, acquireOk, acquireBusy, takenOver, ...}
    ]),
    /**
     * 产物上的属性：部署侧靠它们回答"这个实例跑的是哪个后端、TTL 多长"。
     *
     * 为什么是 `properties` 而不是方法：实现里就是普通数据属性（`this.backend` / `this.ttlMs`），
     * 调用方写 `leaseStore.backend`；写成 `backend()` 会让早已这么读的消费者拿到一个对象。
     */
    properties: Object.freeze(['backend', 'ttlMs']),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'fencing-token-is-monotonic-per-resource-and-never-decreases',
        'takeover-increments-both-token-and-revision-so-two-concurrent-takeovers-cannot-both-win',
        'renew-fails-after-expiry-and-refuses-owner-change-or-token-mismatch',
        'release-requires-both-owner-and-token-to-match',
        'assert-fence-rejects-stale-token-with-code-ESTALE_FENCE',
        'busy-is-a-normal-answer-not-an-error',
        'construction-never-throws-even-with-empty-options',
        'memory-backend-is-the-default-and-real-backend-is-injected-not-detected',
    ]),
    notes: Object.freeze({
        fencing:
            '"检查租约是否过期"挡不住僵死写入者——检查与写入之间总有时间窗口。真正的保护是'
            + '写入前 `assertFence(resource, token)`：token 单调递增，旧持有者的写入被**必然**拒绝。'
            + '因此消费者不该只调 `acquire`，写业务数据前必须过一次 `assertFence`。',
        heartbeat:
            '心跳不是本类的事：`renew()` 只提供原语，起停定时器由装配方负责（`bootstrap.js` 的'
            + '`startHeartbeat` 用 TTL/3 的间隔续租，续租失败即停表并告警）。消费者若自己起心跳，'
            + '务必在失去所有权时**停止**续租——"以为还持有"是僵死写入者的教科书场景。',
        backends:
            '进程内参考实现 `MemoryLeaseBackend`（可断言全部语义）与真实后端命令构造'
            + '`PostgresLeaseBackend`（迁移脚本见 `deploy/migrations/001_leases.sql`）。'
            + '真实后端的客户端（`pg`）是**启动期动态 import** 的可选依赖：装不上就让服务启动失败，'
            + '绝不静默退回内存语义（那等于"以为在跑分布式、实际是单实例语义"）。',
        scope:
            '本仓库内的测试验证的是语义、命令文本与参数；`kill -9` 级别的真实接管、PostgreSQL'
            + '隔离级别的影响必须在真实环境验证，不做"跑通 mock 就宣称分布式可用"的表述。',
        siblings:
            '同一插件（`plugins/distributed/core`）同时提供 `distributed-queue`（至少一次投递）、'
            + '`distributed-tokens`（全局并发令牌）与 `distributed-observer`（链路追踪）。'
            + '`Semaphore` / `Notify` / `Tenant` / `Governance` / `ServiceHost` **不立接缝**：'
            + '它们的消费者与提供方在同一个文件图里（装配层内部协作），立成外部契约只会多一条'
            + '加载失败路径。逐条判据见 `plugins/distributed/core/index.js` 的文件头表格。',
    }),
});

export default DISTRIBUTED_LEASE_SEAM;
