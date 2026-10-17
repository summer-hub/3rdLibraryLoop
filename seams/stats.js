/**
 * seams/stats.js — 统计计数契约（能力接缝）
 *
 * Provider：`plugins/stats/core`（`setup` 内 `ctx.provide('stats', StatsService)`）。
 * Consumer：`Server/CLI/cli.js`（经 `hostBridge.resolveStats()` 取提供方，
 *           无宿主时回落到门面 `Server/library/StatsService.js` 的同一实现）。
 *
 * 服务形状：**类**（不是工厂、不是实例）——消费者的调用形状一直是
 *   `StatsService.incrementSessionCount()` 这类静态方法；注册类既满足它，
 *   也让"换一个统计提供方"只需要实现同名静态方法。故 `factory: false` + `methods`。
 *
 * 归属声明：`plugins/stats/core/plugin.json` 与入口 `definePlugin` 都写
 *   `seam: 'stats'`（约定是"只写**主**接缝"；本插件只提供这一条）。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3 要求契约只碰契约）。
 */

export const STATS_SEAM = Object.freeze({
    name: 'stats',
    version: 1,
    /** 提供方注册的是类（静态方法即能力面），不是工厂函数 */
    factory: false,
    description: '统计计数：访问次数 / Session 调用次数，落盘为单个 JSON 文件',
    /** 提供方必须提供的静态方法（逐条对齐 lib/StatsService.js） */
    methods: Object.freeze([
        'incrementVisitCount', // async () => number（+1 后的访问总数）
        'incrementSessionCount', // async () => number（+1 后的 Session 总数；失败降级为 0，不抛）
        'getVisitCount', // async () => number
        'getSessionCount', // async () => number
        'getAllStats', // async () => { visitCount, sessionCount, createdAt, updatedAt }
    ]),
    /** 消费者真正依赖的语义 */
    notes: Object.freeze({
        statics: '能力面是类上的静态方法，不需要实例化；提供方可以是任意带同名静态方法的类',
        concurrency:
            '并发安全由实现自行保证（原子写 tmp+rename + 按文件串行化读改写）；' +
            'incrementSessionCount 吞掉异常并返回 0，不把统计故障传导给业务流程',
        storageLocation: 'WEB_STATS_ROOT 优先，否则为仓库上一级的 db/web/visit-stats.json',
    }),
});

export default STATS_SEAM;
