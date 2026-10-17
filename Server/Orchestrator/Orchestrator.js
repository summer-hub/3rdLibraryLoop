/**
 * Server/Orchestrator/Orchestrator.js —— 转发门面（实现已迁入 `plugins/engines/orchestrator/`）
 *
 * 为什么留这一层：`Server/**` 侧消费者与既有测试都按老路径 import 这个文件
 * （`Server/Routes/controllers/OrchestratorController.js`、`cli/lib/runner.js` 经 buildApp、
 * 以及 m1/m2/m3/m4/m5/m6 的八套件），插件化不该顺手改掉它们的 import。
 * 架构守卫只禁止「插件 → Server」方向，「Server → 插件」是允许的
 * （与 `Server/Brain/Brain.js`、`Server/TestCheck/TestCheck.js` 同一形状）。
 *
 * 导出面前后逐名一致：`Orchestrator` / `OrchestratorStatus` / `SSE_EVENT` / `Semaphore` /
 * `StepNode` / `NodeStatus` / `getSessionSemaphoreStats` / `getRoleLimiterStats` /
 * `setRoleLimit` + `default`，且**就是插件里的那几个绑定**（`===`），不存在第二份实现
 * ——否则 `OrchestratorStatus` / `NodeStatus` 的常量比较会分属两个对象，全部失效。
 *
 * ── 本文件不只是转发：它登记两条无宿主兜底 ─────────────────────────────────
 * 这两个协作方**尚未插件化**，因此没有接缝可走，只能由装配层（`Server/`）在 import 期
 * 把「无宿主时用哪份实现」告诉插件（见 `plugins/engines/orchestrator/lib/fallbacks.js`）：
 *
 *   1. `role-limiter`：迁移前是模块级 `const globalRoleLimiter = new RoleLimiter()`
 *      （import 即构造）。插件内不得静态 import `Server/Agent/Runtime/`（R2），
 *      而 `getRoleLimiterStats()` / `setRoleLimit()` 是**同步**导出，所以这里登记的是
 *      **同步加载器** `() => RoleLimiter`（插件用 `resolveFallbackSync()` 取）；
 *      加载时机与迁移前一致（本文件被 import 时 `RoleLimiter.js` 就已加载）。
 *
 *   2. `multi-agent-runner`：迁移前是 `await import('../Agent/Supervisor/MultiAgentRunner.js')`
 *      的**惰性**动态 import（未启用多 Agent 时完全不加载）。这里登记成惰性加载器，
 *      时机与迁移前逐字等价（同样只在真正要造多 Agent 运行器时才 import）。
 *
 * 同时保留迁移前那条 `import '../FlexRunner/...'` 的**模块图**：Orchestrator 与
 * FlexRunner 原本就是同一片（静态 import + 内部 `new`），这里以副作用 import 维持
 * 同一顺序，使 `Server/FlexRunner/FlexRunner.js` 的 5 条兜底登记在任何
 * 「只 import 了 Orchestrator 门面」的部署形态下也已就位。
 */

import { RoleLimiter } from '../Agent/Runtime/RoleLimiter.js';
// 副作用 import：保留迁移前 Orchestrator → FlexRunner 的静态依赖边，
// 使 FlexRunner 门面登记的无宿主兜底在任何"只 import Orchestrator"的路径上也就位。
import '../FlexRunner/FlexRunner.js';
import { registerFallback } from '../../plugins/engines/orchestrator/lib/fallbacks.js';

// 幂等（先登记者优先）：重复 import 不会覆盖已登记的实现
registerFallback('role-limiter', () => RoleLimiter);
registerFallback(
    'multi-agent-runner',
    async () => (await import('../Agent/Supervisor/MultiAgentRunner.js')).MultiAgentRunner
);

export {
    Orchestrator,
    OrchestratorStatus,
    SSE_EVENT,
    Semaphore,
    StepNode,
    NodeStatus,
    getSessionSemaphoreStats,
    getRoleLimiterStats,
    setRoleLimit,
} from '../../plugins/engines/orchestrator/Orchestrator.js';
export { default } from '../../plugins/engines/orchestrator/Orchestrator.js';
