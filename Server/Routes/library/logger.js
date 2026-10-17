/**
 * Server/Routes/library/logger.js — 转发门面（实现已迁入 `plugins/util/logger/`）
 *
 * 为什么留这一层：`Server/Routes/sse/SseHub.js`、`Server/FlexRunner/FlexRunner.js`、
 * `Server/Agent/SkillSelector/core/Agent.js` 等消费者都按这个路径 import，插件化不该
 * 顺手改掉它们的 import；而架构守卫只禁止「插件 → Server」方向，「Server → plugins」
 * 是允许的（与 `Server/CLI/opencode/index.js`、`Server/DbUse/*.js` 同一形状）。
 *
 * **关键约束：必须用 `export ... from` 转发，不能重新实现。** 转发让门面与插件实现
 * 成为**同一个模块实例**（ESM 缓存按解析后的 URL 键控），因此只有一份 `_stream`
 * 模块级状态、一套按天轮转、一套保留期清理。一旦这里"抄一份"实现，立刻变回两个
 * WriteStream 追加同一个 `db/log/app-YYYY-MM-DD.log`——这正是本次技术债要消除的东西
 * （守卫见 `test/m8-plugin-kernel/f50-util-copies.test.mjs`：默认导出 `===` 断言）。
 *
 * 导出面与迁移前**逐名一致**：`createLogger`（命名导出）+ `default`（同一函数）。
 */

export * from '../../../plugins/util/logger/logger.js';
export { default } from '../../../plugins/util/logger/logger.js';
