/**
 * Server/Agent/Runtime/RoleLimiter.js —— 转发门面（实现已迁入 `plugins/agent/core/Runtime/`）
 *
 * 为什么留这一层：`Server/Orchestrator/Orchestrator.js`（静态 `import` + 两个同步导出
 * `getRoleLimiterStats()` / `setRoleLimit()`）、`test/m6-phase3/f37`、`f38`、`f42` 都按这个
 * 历史路径 import；插件化不该顺手改掉。
 *
 * **必须 `export ... from` 转发，不能重新实现**：`RoleLimiter` 持有每角色的在途计数与
 * FIFO 等待队列。两份实现 = 两套配额账本，「按角色限流」立刻失真，而且 `acquire()` 的
 * 「角色槽位 → 全局槽位」固定获取顺序会被破坏（死锁风险的来源）。
 * 转发保证全仓库只有一份类，也保证 `RoleLimiter.DEFAULT_ROLE_LIMITS` 与插件侧挂的是
 * **同一份冻结常量表**（`seams/agent-role-limiter.js` 的 `constants` 通道）。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

// 装配层登记：默认会话适配器 = FlexRunner（`AgentRuntime._resolveAdapterFactory` 用）。
// 选在这里是因为 `Server/Orchestrator/Orchestrator.js` **静态 import 本门面**，因此任何跑起
// 编排的进程都必然走过它 —— 这是"无论消费者从哪条路径进来都登记过"的最短保证。
import '../internal/registerFlexRunnerFallback.js';

export * from '../../../plugins/agent/core/Runtime/RoleLimiter.js';
export { default } from '../../../plugins/agent/core/Runtime/RoleLimiter.js';
