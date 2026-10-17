/**
 * Server/Agent/Roles/AgentRole.js —— 转发门面（实现已迁入 `plugins/agent/core/Roles/`）
 *
 * 为什么留这一层：`test/m5-phase2` / `test/m6-phase3` / `Server/Orchestrator` 都按这个
 * 历史路径 import；插件化不该顺手改掉。
 *
 * **必须 `export ... from` 转发，不能重新实现**：本模块导出 `defaultRoleRegistry`
 * ——一个**模块级单例**（`new RoleRegistry(BUILTIN_ROLES.map(...))`）。两份实现会得到两个
 * 注册表实例：一边注册的角色另一边看不见，`Supervisor` 与 `MultiAgentRunner` 会各自
 * 拿到不同的角色快照。转发保证全仓库只有一份。
 * 同理 `RoleKind` 是冻结常量表，消费者用 `===` 比较，必须是同一份对象。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`（= `AgentRole`）。
 */

export * from '../../../plugins/agent/core/Roles/AgentRole.js';
export { default } from '../../../plugins/agent/core/Roles/AgentRole.js';
