/**
 * Server/library/StatsService.js — 转发门面（实现已迁入 `plugins/stats/core/lib/`）
 *
 * 为什么搬：统计不是"服务端 HTTP 能力"，而是可被插件宿主提供/替换的普通服务；
 * 留在 Server 侧被 `Server/CLI/cli.js` 直接调用会让门面不纯（CLI 门面反向依赖
 * Server 的内部实现）。实现落进插件后，Server 侧只剩这一层转发。
 *
 * 为什么门面直接指向 `plugins/stats/core/lib/` 而不是插件入口 `index.js`：
 * 入口的 default 是 `definePlugin(...)`（插件定义），而这里的 default 必须是
 * `StatsService`；逐名转发得从实现文件取，否则 default 会串味。
 *
 * 导出面与迁移前逐名一致：`StatsService`（具名，类，静态方法）+ `STATS_FILE_PATH`
 * + `default`（=== `StatsService`）。消费者路径不变：
 *   - `Server/CLI/cli.js`（经 `resolveStats() ?? StatsService`）
 *   - `Server/Routes/controllers/StatsController.js`
 *   - `test/m3/f14-f15-atomic-json.test.mjs`
 */

export * from '../../plugins/stats/core/lib/StatsService.js';
export { default } from '../../plugins/stats/core/lib/StatsService.js';
