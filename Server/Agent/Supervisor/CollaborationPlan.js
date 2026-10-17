/**
 * Server/Agent/Supervisor/CollaborationPlan.js —— 转发门面（实现已迁入 `plugins/agent/core/Supervisor/`）
 *
 * 为什么留这一层：`test/m5-phase2/f34`、`f35`、`test/m6-phase3/f38`、`f42` 都按这个
 * 历史路径 import；插件化不该顺手改掉。
 *
 * **必须 `export ... from` 转发，不能重新实现**：`BUILTIN_PLANS` 是冻结的计划表，
 * `resolvePlan()` 的结果要与 `MultiAgentRunner` 里 `instanceof CollaborationPlan` 的
 * 判断对得上——两份 `CollaborationPlan` 类会让那个判断静默变 false（`initContext` 会
 * 把手传进来的计划实例当成"不是计划"）。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

export * from '../../../plugins/agent/core/Supervisor/CollaborationPlan.js';
export { default } from '../../../plugins/agent/core/Supervisor/CollaborationPlan.js';
