/**
 * Server/Agent/Supervisor/Supervisor.js —— 转发门面（实现已迁入 `plugins/agent/core/Supervisor/`）
 *
 * 为什么留这一层：`test/m5-phase2/f34-supervisor-review-loop.test.mjs` 与 `MultiAgentRunner`
 * 都按这个历史路径 import；插件化不该顺手改掉。
 *
 * **必须 `export ... from` 转发，不能重新实现**：`Supervisor` 是步骤内角色子图的编排者，
 * 一次执行的全部上下文（`_runtimes` / `_bus` / `_board` / 取消节点）都在实例上。
 * 两份实现会让 `MultiAgentRunner` 造出来的 Supervisor 与门面导出的类不是同一个，
 * `instanceof` 与后续 `getTopology()` 等能力立刻错位。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出（含对 `CollaborationPlan` /
 * `resolvePlan` 的再导出），外加迁移前就有的 `default`。
 */

export * from '../../../plugins/agent/core/Supervisor/Supervisor.js';
export { default } from '../../../plugins/agent/core/Supervisor/Supervisor.js';

// 装配层登记：默认会话适配器 = FlexRunner（`AgentRuntime._resolveAdapterFactory` 用）。
import '../internal/registerFlexRunnerFallback.js';
