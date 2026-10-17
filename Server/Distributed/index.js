/**
 * Server/Distributed —— 企业级分布式能力（Phase 4）· **转发门面**
 *
 * 实现已整体迁入插件 `plugins/distributed/core/`（10 文件 / 约 3800 行，逐行不变）。
 * 本文件只 `export *` + `export { default }` 转发，保证既有 import 路径与导出面**零改动**，
 * 且门面与插件是同一批模块实例（`===`）。新增导出请只改 `plugins/distributed/core/index.js`。
 *
 * ## 这一层解决的是什么（保留原文档，指向实现体）
 *
 * Phase 1~3 把单进程做到了"高并发不失控"。Phase 4 要解决的是单进程**根本无法解决**的
 * 三类问题：
 *
 * | 问题 | 单进程为什么解决不了 | 模块 |
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
 * ## 插件侧登记的接缝（消费者按需 `ctx.inject`）
 *
 * | 接缝 | 提供方注册的东西 | 契约 |
 * |---|---|---|
 * | `distributed-lease`（主能力，`plugin.json` 的 `seam`） | `LeaseStore` 类 | `seams/distributed-lease.js` |
 * | `distributed-queue` | `MessageQueue` 类 | `seams/distributed-queue.js` |
 * | `distributed-tokens` | `DistributedSemaphore` 类 | `seams/distributed-tokens.js` |
 * | `distributed-observer` | `Tracer` 类 | `seams/distributed-observer.js` |
 *
 * `Tenant` / `Governance` / `Notify` / `ServiceHost` / `IdempotentConsumer` 不立接缝：
 * 它们的消费者与提供方在**同一个文件图**里（`bootstrap` / `ServiceHost` 的内部协作），
 * 立成外部契约只会多一条加载失败路径。判据与逐条理由见
 * `plugins/distributed/core/index.js` 的文件头表格。
 *
 * ## 进程入口仍然在这里
 *
 * `node Server/Distributed/bootstrap.js` 是 `deploy/` 三份清单（compose / k8s / helm）里的
 * 启动命令，所以 `bootstrap.js` 保留在同一路径上做转发（含 m7 f41 需要的源码不变量镜像）。
 */

// 副作用 import：登记四条接缝的**无宿主兜底**（见 internal/registerDistributedFallback.js）。
// 登记在每个门面而不是只在 barrel：消费者可能只 import 深层路径（m7 直接 import Lease.js），
// 只登记一处会出现"宿主在、但没有任何 barrel 被 import 过"的空槽。
import './internal/registerDistributedFallback.js';

export * from '../../plugins/distributed/core/index.js';
export { default } from '../../plugins/distributed/core/index.js';
