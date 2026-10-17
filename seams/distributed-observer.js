/**
 * seams/distributed-observer.js — 分布式链路追踪（W3C traceparent）契约
 *
 * Provider：`plugins/distributed/core`（`setup` 内 `ctx.provide('distributed-observer', Tracer)`）。
 * Consumer：服务宿主的统一中间件（每个请求一棵跨度树，响应头回写 traceparent）、
 *           任何要"跨服务/跨实例把一条链路拼起来"的装配。
 *
 * 服务形状：**类**（`factory: false`）。
 *
 * 为什么注册类而不是工厂/单例：`Tracer` 持有**每实例状态** —— `_stack`（当前跨度栈，父子关系
 * 靠它推导）与采样统计。注册单例会让两个服务共用一座栈，`startSpan` 会认错父跨度，
 * 父子树变成一锅粥（`currentSpan` 也就失去意义）。
 *
 * 为什么 `Trace` 立接缝、而 `Tenant` / `Governance` / `Notify` 不立
 *（这是本片最容易被质疑的一条，故写明判据）：
 *   - **可替换性**：链路追踪是整个仓库里唯一有**跨服务传播语义**的能力面（`traceparent` 是
 *     W3C 标准的线格式）。真实部署里"换成一个 OTel SDK / 换成厂商 APM"是常规需求，
 *     而 `Trace` 的 `startSpan/inject/extract/withSpan` 正好是那种适配器形状；
 *   - **消费者独立于提供方**：服务宿主中间件只依赖"开始/结束/传播"三件事，不依赖
 *     `InMemoryExporter` 的存储细节；
 *   - 反观 `Tenant`（隔离/RBAC/配额）与 `Governance`（计量/哈希链审计）：它们的消费者是
 *     **同一个文件图里**的 `ServiceHost` 与 `bootstrap`，替换它们等于换掉本层的装配方式，
 *     不是"换一个提供方"。立成外部契约只会多一条加载失败路径与一份需要同步维护的成员清单。
 *
 * 因此本接缝只声明 `Tracer` 一个类；`Span` / `InMemoryExporter` / `parseTraceparent` /
 * `formatTraceparent` / `newTraceId` / `newSpanId` / `TRACE_FLAG_SAMPLED` 是**模块导出**，
 * 消费者要用它们就 import 提供方（那是内部形状，不进契约）。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3）。
 */

export const DISTRIBUTED_OBSERVER_SEAM = Object.freeze({
    name: 'distributed-observer',
    version: 1,
    factory: false,
    description:
        '链路追踪（W3C traceparent 父子跨度树 + 采样 + 跨服务传播）：让"为什么这样规划"'
        + '能沿一条 trace 回答，而不是在一堆扁平日志里猜',
    /**
     * 构造入参：**全部可选**（`new Tracer({})` 必须成功：`service='unknown'`、`sampleRate=1`、
     * 导出到内存）。具体键：
     *   - `service`：服务名（进 span 的 `service` 属性）；
     *   - `sampleRate`：0~1，越界会被夹到区间内；
     *   - `exporter`：`{export(span), tree(traceId), ...}`（缺省 `InMemoryExporter`）；
     *   - `idFactory`：`(kind: 'trace'|'span') => string`，供测试注入确定性 id。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法 */
    methods: Object.freeze([
        'startSpan', // ({name, attributes?, traceparent?, traceId?, parentSpanId?, sampled?, service?}) => Span
        'endSpan', // (span, err?) => Span（从栈中弹出并导出采样保留的 span）
        'withSpan', // async (opts, fn) => T（自动结束 + 异常时标记 error 后重抛）
        'inject', // (span?) => traceparent 头 | null（缺省用当前活跃跨度）
        'extract', // (header) => {traceId, parentId, sampled} | null
        'getStats', // () => {service, sampleRate, active, started, ended, sampledIn, sampledOut, errors}
    ]),
    /**
     * 产物上的属性：`currentSpan` 是**取值器**（实现里是 getter，调用方写 `tracer.currentSpan`，
     * 写成 `currentSpan()` 就会拿到 null）；`exporter` / `service` / `sampleRate` 是普通数据属性，
     * 运维与测试要直读（`tracer.exporter.tree(traceId)` 是最常用的排障入口）。
     */
    properties: Object.freeze(['currentSpan', 'exporter', 'service', 'sampleRate']),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'upstream-traceparent-wins-over-local-ids-and-carries-the-sampling-decision',
        'nested-span-inherits-the-active-span-trace-id-and-parent-span-id',
        'sample-rate-is-clamped-to-0..1-and-never-throws',
        'end-span-pops-from-the-stack-and-exports-only-sampled-spans',
        'inject-returns-null-when-there-is-no-active-span',
        'construction-never-throws-even-with-empty-options',
    ]),
    notes: Object.freeze({
        scope:
            '`_stack` 是**进程级单栈**，定位是"进程内轻量 tracer"：HTTP 路径一律显式传 `span` /'
            + '`traceparent`（`ServiceHost` 的中间件就是这么做的），不要指望它在跨请求并发下'
            + '给出"当前请求的跨度"。要真正的请求级隔离请用 AsyncLocalStorage 自行包裹。',
        sampling:
            '采样决定**沿 traceparent 传播**：上游决定不采，下游就只透传 id 不导出。'
            + '这让"整条链要么全采要么全不采"成为可依赖的性质，排障时不会出现半条链路。',
        siblings:
            '同一插件（`plugins/distributed/core`）同时提供 `distributed-lease`（主能力）、'
            + '`distributed-queue` 与 `distributed-tokens`。',
    }),
});

export default DISTRIBUTED_OBSERVER_SEAM;
