/**
 * Server/Agent/Messaging/MessageBus.js —— 转发门面（实现已迁入 `plugins/agent/core/Messaging/`）
 *
 * 为什么留这一层：`test/m5-phase2/f33-agent-foundation.test.mjs` 与 `Supervisor` 都按这个
 * 历史路径 import；插件化不该顺手改掉。
 *
 * **必须 `export ... from` 转发，不能重新实现**：`MessageBus` 持有每实例的消息日志
 * （`DEFAULT_MAX_LOG_SIZE` 上限）与待决请求表，两份实现会让「发出去的消息」与
 * 「等消息的实例」落在不同的日志上。转发保证全仓库只有一份类。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出（含本模块对
 * `MessageIntent` / `BROADCAST` / `SUPERVISOR_ID` 的再导出），外加迁移前就有的 `default`。
 */

export * from '../../../plugins/agent/core/Messaging/MessageBus.js';
export { default } from '../../../plugins/agent/core/Messaging/MessageBus.js';
