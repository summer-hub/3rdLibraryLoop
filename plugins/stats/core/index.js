/**
 * plugins/stats/core/index.js — `stats` 服务提供方：统计计数
 *
 * 实现层原样来自 `Server/library/StatsService.js`（整体迁入，逻辑逐行不变），
 * 外加一份小工具副本 `lib/AtomicJsonFile.js`——插件不允许引用 `Server/`、
 * 也不允许跨插件 import（见 scripts/arch-guard.mjs 的 R2），因此统计需要的那份
 * 原子写工具在自己的插件目录里有一份。
 *
 * setup 注册一个服务：
 *
 *   ctx.provide('stats', StatsService)
 *       注册**类**而不是工厂/单例：消费者（`Server/CLI/cli.js` 经
 *       `hostBridge.resolveStats()`、`Server/Routes/controllers/StatsController.js`
 *       经门面）用的就是类上的静态方法（`StatsService.incrementSessionCount()`），
 *       类本身就是调用形状，无需再包一层。
 *
 * 数据落盘位置与迁移前一致（`WEB_STATS_ROOT` 优先，否则仓库上一级的 `db/web`），
 * 见 lib/StatsService.js 的路径注释。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import { StatsService } from './lib/StatsService.js';

// 供门面逐名转发（与 plugins/storage/core 的做法一致）；default 留给 definePlugin。
export * from './lib/StatsService.js';

export default definePlugin({
    name: 'stats/core',
    version: '1.0.0',
    seam: 'stats',
    setup(ctx) {
        // 无常驻资源可回收：统计的读改写都在 lib/StatsService.js 内即用即弃，
        // 串行链由 AtomicJsonFile 的模块级 Map 管理（不需要 disposer）。
        ctx.provide('stats', StatsService);
    },
});
