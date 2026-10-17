/**
 * Server/Agent/Messaging/AgentMessage.js —— 转发门面（实现已迁入 `plugins/agent/core/Messaging/`）
 *
 * 为什么留这一层：`test/m5-phase2/f33-agent-foundation.test.mjs` 与 `Roles` / `Runtime` /
 * `Supervisor` 都按这个历史路径 import；插件化不该顺手改掉。
 *
 * **必须 `export ... from` 转发，不能重新实现**：门面与插件实现是同一个模块实例，
 * 因此 `MessageIntent` 这张冻结常量表在门面与插件两侧是**同一份对象**（消费者用
 * `===` 比较意图字面量，两份副本会让比较静默失效）。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

export * from '../../../plugins/agent/core/Messaging/AgentMessage.js';
export { default } from '../../../plugins/agent/core/Messaging/AgentMessage.js';
