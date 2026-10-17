/**
 * seams/sse-hub.js — SSE 事件总线契约（能力接缝）
 *
 * Provider：`plugins/http`（现 Server/Routes/sse/SseHub.js）。
 * Consumer：各 Controller（Orchestrator/FlexRunner/LoopEngine/Brain）、
 *           Distributed/Notify（跨实例扇出时经同一接口）。
 *
 * 提供方注册的服务是**类**：
 *     ctx.provide('sse-hub', SseHub);
 * 消费者自行决定单例（server.js 现状）或按租户分实例。
 */

export const SSE_HUB_SEAM = Object.freeze({
    name: 'sse-hub',
    version: 1,
    factory: false,
    description: 'SSE 实时推送中心：按 taskId 频道订阅/推送，背压有界',
    /** 实例必须实现的方法（与现有 SseHub 对齐） */
    methods: Object.freeze([
        'canSubscribe',
        'subscribe',
        'emit',
        'close',
        'subscriberCount',
        'getStats',
        'destroy',
    ]),
});

export default SSE_HUB_SEAM;
