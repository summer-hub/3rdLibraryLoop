/**
 * plugins/distributed/core/index.js —— 企业级分布式能力（`Server/Distributed/` 的实现体）
 *
 * 实现层原样来自 `Server/Distributed/`（10 个文件 / 约 3800 行，业务逻辑逐行不变），另加：
 *
 *   lib/LatencyRecorder.js ← `Server/library/LatencyRecorder.js`（副本 #3，说明头 + 逐字节同源）
 *   index.js               ← `Server/Distributed/index.js` 的 `getDistributedEnv()`（无状态纯函数，
 *                            随实现体一起搬进来，再由门面转发）
 *
 * 两处 import 改写（除此之外实现体一字未动，便于逐行对照）：
 *   ① `../library/cstTime.js`        → `../../../core/cstTime.js`
 *      （`nowCST` 是无状态纯函数，已归一进内核；R2 允许插件引用 `core/`，见 m8 f50 A 组）
 *   ② `../library/LatencyRecorder.js` → `./lib/LatencyRecorder.js`
 *      （有每实例状态 → 插件内副本 + 说明头，见该文件头部）
 *
 * 本文件**不** import `bootstrap.js`：它是进程入口（含 `isMain` 的 CLI 块与 `node:http`），
 * 一旦被插件入口连带加载，就会把"启动一个服务"的副作用拖进每一次 `host.load()`。
 * 门面 `Server/Distributed/bootstrap.js` 单独转发它，`Server/Distributed/index.js` 的导出面
 * 与迁移前**完全一致**（迁移前它也不导出 `createRuntime`）。
 *
 * ── setup 注册四条接缝（全部注册**类**，`factory: false`）──────────────────────────
 *
 *   ctx.provide('distributed-lease',    LeaseStore)      ← 主能力，写在 plugin.json 的 seam 字段
 *   ctx.provide('distributed-queue',    MessageQueue)
 *   ctx.provide('distributed-tokens',   DistributedSemaphore)
 *   ctx.provide('distributed-observer', Tracer)
 *
 * ## 为什么是这四条，而不是每模块一条（10 条），也不是一条
 *
 * 立接缝的判据是「**有消费者需要替换这个能力**」，不是「代码里有个类」。按真实消费者逐个看：
 *
 *   | 模块 | 真实消费者 | 判据 |
 *   |---|---|---|
 *   | `Lease` | 任务执行路径（`POST /tasks` 取租约 + 心跳续租）、运维接管扫描 | **立** —— 后端可换（memory/PG），且 fencing token 是跨实例互斥的唯一保证 |
 *   | `Queue` | notify 扇出、`notify-svc` 跨实例投递 | **立** —— 后端可换（memory/Redis Streams），至少一次语义是部署契约 |
 *   | `Semaphore` | `POST /sessions` 的全局并发上限 | **立** —— 后端可换（memory/Redis 原子令牌），`DISTRIBUTED_TOKEN` 是它自己的开关 |
 *   | `Trace` | 服务宿主的统一中间件（每个请求一棵跨度树）、跨服务 traceparent 传播 | **立** —— 唯一有"跨服务传播语义"的能力面，换 OTel SDK 是真实需求 |
 *   | `Tenant` / `Governance` | 只有同插件内的 `ServiceHost`（鉴权/审计/配额）与本包的 `bootstrap` | **不立** —— 消费者与提供方在**同一个文件图**里，立接缝只会多一条加载失败路径 |
 *   | `Notify` | 只有本包的 `bootstrap`（`_deps.notify`） | **不立** —— 同上；它的可替换点是构造入参 `backend`，不是外部能力面 |
 *   | `ServiceHost` | 只有本包的 `bootstrap`（`createRuntime` 内部 `new ServiceHost(...)`） | **不立** —— 见下 |
 *   | `IdempotentConsumer` | `MessageQueue` 内部（`this.consumer`） | **不立** —— 它随 `MessageQueue` 一起被替换，是后者的内部件 |
 *
 * 为什么 `ServiceHost` 不立接缝（它看起来最像"被外部装配调用"的那个）：
 *   它**不是**一个消费者可替换的能力，而是**装配产物**——`createRuntime()` 才是装配入口，
 *   而它的唯一外部消费者就是进程入口 `bootstrap.js`（`node Server/Distributed/bootstrap.js`
 *   与部署清单里的 command）。同时 `new ServiceHost({})` 按设计**必须抛错**
 *   （`definition` 必填，边界声明不能凭空猜），把它注册成"类"接缝会立刻变成一条
 *   "契约要求可构造、实现要求必填参数"的自相矛盾契约（m9 会按契约真构造一次）。
 *   要让部署替换服务宿主，正确的切法是另立一条 **工厂** 接缝（`createRuntime` 形状），
 *   而不是把 `ServiceHost` 类型抛出去——那是下一片的事，且需要 m9 的 `factoryOptions` 取值表
 *   支持一个可控的服务定义，本次不做。
 *
 * ## 为什么四条都注册**类**而不是工厂/单例
 *
 * 消费方的既有调用形状全是 `new Xxx(opts)`，且每个实例持有**每实例状态**：
 *   - `LeaseStore`：`_maxFence`（见到的最大 fencing token，只增不减）+ 统计，进程级单例会焊死
 *     "每个装配一份租约账本"这个语义；
 *   - `MessageQueue`：`consumer`（幂等去重表）+ 投递统计；
 *   - `DistributedSemaphore`：`ownerId`（每实例唯一，令牌归属与回收的前提）+ 时延采样器；
 *   - `Tracer`：`_stack`（当前跨度栈）+ 采样统计。
 * 注册工厂会强迫四个消费者各多包一层 `new (inject(...))()`；注册单例则把这些状态变成共享体。
 * 后端注入点（`new LeaseStore({ backend })` 等）本来就是构造入参，契约里以 `properties.backend`
 * 暴露（`bootstrap` 的 `/health` 正是读 `leases.backend.constructor.name` 来报告后端类型）。
 *
 * 形状与 `plugins/agent/core`、`plugins/engines/*` 一致：实现体具名导出供 `Server/Distributed/**`
 * 门面逐名转发（门面转发的是**同一批模块实例**，所以全仓库只有一份 `LeaseStore` / `Tracer` …）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
// setup 里要 `provide` 的是**类本身**，而 `export ... from` 只建立再导出、不建立本地绑定，
// 因此这四个类必须既 import（供 setup 使用）又 export（供门面逐名转发）。
import { LeaseStore } from './Lease.js';
import { MessageQueue } from './Queue.js';
import { DistributedSemaphore } from './Semaphore.js';
import { Tracer } from './Trace.js';

// ─── 实现体（供 Server/Distributed/** 门面逐名转发；default 留给 definePlugin）──────
export {
    LeaseStore,
    MemoryLeaseBackend,
    PostgresLeaseBackend,
    DEFAULT_LEASE_TTL_MS,
    DEFAULT_HEARTBEAT_MS,
} from './Lease.js';

export {
    MessageQueue,
    IdempotentConsumer,
    MemoryQueueBackend,
    RedisStreamsBackend,
    DEFAULT_VISIBILITY_MS,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_DEDUPE_TTL_MS,
} from './Queue.js';

export {
    DistributedSemaphore,
    MemoryTokenBackend,
    RedisTokenBackend,
    DEFAULT_TOKEN_TTL_MS,
} from './Semaphore.js';

export {
    Tracer,
    Span,
    InMemoryExporter,
    parseTraceparent,
    formatTraceparent,
    newTraceId,
    newSpanId,
    TRACE_FLAG_SAMPLED,
} from './Trace.js';

export {
    TenantRegistry,
    TenantScope,
    MemoryQuotaBackend,
    BUILTIN_RBAC,
    DEFAULT_QUOTA,
    runWithTenant,
    currentTenant,
    requireTenant,
} from './Tenant.js';

export { CostMeter, AuditLog, DEFAULT_PRICING } from './Governance.js';

export { NotifyFanout, MemoryPubSubBackend, DEFAULT_SEEN_TTL_MS } from './Notify.js';

export {
    ServiceHost,
    SERVICE_DEFINITIONS,
    SERVICES,
    validateServiceBoundaries,
    matchRoute,
} from './ServiceHost.js';

/**
 * 分布式能力的总开关（原 `Server/Distributed/index.js` 的实现，随实现体搬入）。
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
        instanceId: process.env.POD_NAME || process.env.HOSTNAME || `local-${process.pid}`,
    };
}

export default definePlugin({
    name: 'distributed/core',
    version: '1.0.0',
    // 清单只能写一条接缝：取主能力（跨实例互斥 / 租约 + fencing）。
    // 另三条由同一 setup 注册，见文件头与 seams/distributed-*.js 的 notes。
    seam: 'distributed-lease',
    // 不声明 dependencies：setup 不 inject 任何服务。四条接缝的提供方全部是本包实现体，
    // 依赖图里只有 `node:` 内置与可选的 `pg` / `ioredis`（由 bootstrap.js 在**启动时**
    // 动态 import，装不上就启动失败，不会拖累 host.load()）。
    dependencies: [],
    setup(ctx) {
        // 无常驻资源可回收：四个类的定时器/连接都不在构造期建立（心跳由 bootstrap 的服务
        // handler 按需起停，后端客户端由部署决定），故 setup 无需返回 dispose。
        ctx.provide('distributed-lease', LeaseStore);
        ctx.provide('distributed-queue', MessageQueue);
        ctx.provide('distributed-tokens', DistributedSemaphore);
        ctx.provide('distributed-observer', Tracer);
    },
});
