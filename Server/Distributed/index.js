/**
 * Server/Distributed —— 企业级分布式能力（Phase 4）
 *
 * ## 这一层解决的是什么
 *
 * Phase 1~3 把单进程做到了"高并发不失控"。Phase 4 要解决的是单进程**根本无法解决**的
 * 三类问题：
 *
 * | 问题 | 单进程为什么解决不了 | 本层模块 |
 * |---|---|---|
 * | 任务被两个实例同时执行 | 没有跨进程的互斥原语 | `Lease`（租约 + 心跳 + **fencing**） |
 * | 全局并发上限在多实例下被放大 N 倍 | 信号量是进程内的 | `Semaphore`（Redis 原子令牌 + TTL） |
 * | 消息至少一次、消费者可能崩溃 | 进程内投递没有"未确认"状态 | `Queue`（重投 + 幂等消费 + 死信） |
 * | SSE 连接在实例 A，任务在实例 B | 事件总线是进程内的 | `Notify`（跨实例扇出 + 回环抑制） |
 * | "为什么这样规划"无法回答 | 日志是扁平的 | `Trace`（W3C traceparent 父子跨度树） |
 * | 租户之间互相可见 | 没有租户维度 | `Tenant`（结构性隔离 + RBAC + 配额） |
 * | 成本与合规完全缺失 | 没有计量与留痕 | `Governance`（token 计量 + 哈希链审计） |
 * | 服务边界靠纪律维持 | 没有边界定义 | `ServiceHost`（声明式边界 + 统一中间件） |
 *
 * ## 全部模块的共同设计约定
 *
 * 1. **可注入后端**：每个分布式原语都有一个进程内参考实现 + 一个真实后端
 *    （Redis / PostgreSQL / Redis Streams）的**命令构造**。前者让全部语义可被断言，
 *    后者让换真实基础设施只需替换一个对象。
 * 2. **诚实标注"需要真实基础设施才能验证的部分"**：本仓库内的测试验证的是
 *    语义、命令文本与参数；`kill -9` 级别的真实接管、Redis 消费组重平衡、
 *    PostgreSQL 隔离级别的影响，都必须在真实环境验证——这一点在每个模块的
 *    文档里都写明了，不做"跑通了 mock 就宣称分布式可用"的表述。
 * 3. **默认关闭**：`DISTRIBUTED_ENABLED` 未开启时行为与 Phase 3 完全一致。
 */

export {
    LeaseStore,
    MemoryLeaseBackend,
    PostgresLeaseBackend,
    DEFAULT_LEASE_TTL_MS,
    DEFAULT_HEARTBEAT_MS
} from './Lease.js';

export {
    MessageQueue,
    IdempotentConsumer,
    MemoryQueueBackend,
    RedisStreamsBackend,
    DEFAULT_VISIBILITY_MS,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_DEDUPE_TTL_MS
} from './Queue.js';

export {
    DistributedSemaphore,
    MemoryTokenBackend,
    RedisTokenBackend,
    DEFAULT_TOKEN_TTL_MS
} from './Semaphore.js';

export {
    Tracer,
    Span,
    InMemoryExporter,
    parseTraceparent,
    formatTraceparent,
    newTraceId,
    newSpanId,
    TRACE_FLAG_SAMPLED
} from './Trace.js';

export {
    TenantRegistry,
    TenantScope,
    MemoryQuotaBackend,
    BUILTIN_RBAC,
    DEFAULT_QUOTA,
    runWithTenant,
    currentTenant,
    requireTenant
} from './Tenant.js';

export { CostMeter, AuditLog, DEFAULT_PRICING } from './Governance.js';

export { NotifyFanout, MemoryPubSubBackend, DEFAULT_SEEN_TTL_MS } from './Notify.js';

export {
    ServiceHost,
    SERVICE_DEFINITIONS,
    SERVICES,
    validateServiceBoundaries,
    matchRoute
} from './ServiceHost.js';

/**
 * 分布式能力的总开关。
 *
 * 与 `MULTI_AGENT_ENABLED` / `MAX_SESSIONS_PER_ROLE` 一致：**默认关闭**，
 * 未开启时行为与 Phase 3 完全一致。理由：合并代码不应顺带改变生产行为，
 * 且现有 7 个套件（665 条断言）在关闭态必须持续全绿。
 *
 * @returns {object}
 */
export function getDistributedEnv() {
    const enabled = process.env.DISTRIBUTED_ENABLED;
    return {
        enabled: enabled === '1' || String(enabled).toLowerCase() === 'true',
        /** 消息队列后端：memory | redis-streams */
        queueBackend: process.env.DISTRIBUTED_QUEUE || 'memory',
        /** 租约后端：memory | postgres */
        leaseBackend: process.env.DISTRIBUTED_LEASE || 'memory',
        /** 令牌后端：memory | redis */
        tokenBackend: process.env.DISTRIBUTED_TOKEN || 'memory',
        /** 采样率 */
        sampleRate: Number(process.env.TRACE_SAMPLE_RATE ?? 1),
        /** 实例标识（HPA 场景由 K8s 注入 POD_NAME） */
        instanceId: process.env.POD_NAME || process.env.HOSTNAME || `local-${process.pid}`
    };
}
