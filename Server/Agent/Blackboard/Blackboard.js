/**
 * Server/Agent/Blackboard/Blackboard.js —— 转发门面（实现已迁入 `plugins/agent/core/Blackboard/`）
 *
 * 为什么留这一层：`test/m5-phase2/f33-agent-foundation.test.mjs` 与 `Supervisor` 都按这个
 * 历史路径 import；插件化不该顺手改掉。架构守卫 R2 只禁止「插件 → Server」，本方向合法。
 *
 * **必须 `export ... from` 转发，不能重新实现**：门面与插件实现是同一个模块实例，
 * 因此 `Blackboard` 类、`BLACKBOARD_FILE` / `BOARD_SUBDIR` 常量与插件实现 `===` 同一对象。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出（含本模块内部的再导出），
 * 外加迁移前就有的 `default`（= `Blackboard`）。
 */

export * from '../../../plugins/agent/core/Blackboard/Blackboard.js';
export { default } from '../../../plugins/agent/core/Blackboard/Blackboard.js';
