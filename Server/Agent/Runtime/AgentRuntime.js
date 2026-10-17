/**
 * Server/Agent/Runtime/AgentRuntime.js —— 转发门面（实现已迁入 `plugins/agent/core/Runtime/`）
 *
 * 为什么留这一层：`test/m6-phase3/f42-cancel-paths.test.mjs` 与 `Supervisor` 都按这个
 * 历史路径 import；插件化不该顺手改掉。
 *
 * **必须 `export ... from` 转发，不能重新实现**：`AgentRuntime` 负责「角色槽位 → 全局槽位」
 * 的获取顺序（顺序不统一就会死锁，见 `Runtime/RoleLimiter.js` 文件头），两份实现会让
 * 同一进程里出现两套槽位账本。转发保证全仓库只有一份类。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出（含对 `MessageIntent` 的再导出），
 * 外加迁移前就有的 `default`。
 */

export * from '../../../plugins/agent/core/Runtime/AgentRuntime.js';
export { default } from '../../../plugins/agent/core/Runtime/AgentRuntime.js';

// 装配层登记：默认会话适配器 = FlexRunner（迁移前本模块 `_resolveAdapterFactory()` 里那行
// `await import('../../FlexRunner/FlexRunner.js')`）。插件不得引用 `Server/`，所以由门面登记。
import '../internal/registerFlexRunnerFallback.js';
