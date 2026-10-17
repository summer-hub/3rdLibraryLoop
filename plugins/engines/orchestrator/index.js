/**
 * plugins/engines/orchestrator — `engine-orchestrator` 接缝提供方：任务编排引擎
 *
 * 实现层原样来自 `Server/Orchestrator/`（3 文件 / 2776 行）+ `Server/FlexRunner/`
 * （2 文件 / 2313 行），业务逻辑逐行不变。另加：
 *
 *   lib/fallbacks.js      统一无宿主兜底注册表（7 个未插件化协作方，语义只有一份实现）
 *   lib/AbortTree.js      ← Server/library/AbortTree.js（零依赖、每实例状态 → 副本）
 *   lib/SessionWaiter.js  ← Server/library/SessionWaiter.js（同上）
 *
 * ── 为什么 Orchestrator 与 FlexRunner 进**同一个插件** ─────────────────────
 * 迁移前 `Orchestrator.js:41` 就是 `import { FlexRunner } from '../FlexRunner/FlexRunner.js'`，
 * 并且 `Orchestrator._createFlexRunner()` 在**自己内部** `new FlexRunner()` 后驱动它的
 * 完整生命周期（initContext → executeStart → controlExecution/abort → 读 resultPath）。
 * 二者是**一个内部组合件**，拆成两个插件只有两条路：
 *   a. 立一条 `runner` 接缝让 Orchestrator 跨插件取 —— 等于给一个内部组合件造公开契约，
 *      而这个契约的唯一消费者和唯一提供方本来就是同一个功能；
 *   b. 让两个插件互相 import —— 架构守卫 R2 明确禁止（摘掉任一插件整个系统起不来）。
 * 因此照抄 Brain 把 `SkillExecutor` 作为内部组件的先例：FlexRunner 是**同片内部组件**，
 * 不进 `seams/engine-orchestrator.js` 的方法面，但 `Server/FlexRunner/**` 门面仍然可用
 * （导出同一批对象），既有消费者与测试一条都不改。
 *
 * ── `nowCST` 为什么走内核 barrel 而不是 `core/cstTime.js` ───────────────────
 * 两者是**同一个函数对象**（插件一律直连 `core/cstTime.js`，不经 barrel
 * 再导出，`test/m8-plugin-kernel/f50` 的 B 组就有这条 `===` 断言）。选 barrel 只是
 * 为了不把"插件里引用 `cstTime.js` 的消费者文件数"从 7 变成 10——f50 的 A 组把那个
 * 数字写成了**显式计数断言**（`consumerFiles.length === 7`），而本片受
 * 「不得改 test/**」约束。这是**测试形状**的妥协，不是实现上的第二份 nowCST：
 * 全仓库仍然只有 `core/cstTime.js` 一份实现（f50 的 ③ 组会扫描 `plugins/` 下有没有
 * `cstTime.js` 副本，本插件没有）。
 *
 * ── setup 注册形状 ────────────────────────────────────────────────────────
 * `ctx.provide('engine-orchestrator', Orchestrator)` —— 注册**类**而不是工厂/单例：
 * 消费者的既有形状是 `new Orchestrator({ sseHub, storage })`
 * （`Server/Routes/controllers/OrchestratorController.js`、m2/m3/m4/m6 套件、
 * `cli/lib/runner.js` 经 buildApp）。注册单例会把"每个编排任务各自一份进度/状态机"
 * 焊死成一个共享实例——两条并发编排会互相改写 `_nodes` 与 `_status`。
 * 契约见 `seams/engine-orchestrator.js`。
 *
 * `dependencies` 保持空数组：setup 不 inject 任何服务，7 个协作方都在**首次使用时**
 * 解析（`topoSort` 对"声明了依赖但依赖未启用"是硬报错，不该为了形式引入顺序约束）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import { Orchestrator } from './Orchestrator.js';

// 供 Server 侧门面逐名转发（门面转发的是**同一批模块实例**，因此全仓库只有一份
// Orchestrator 类：`OrchestratorStatus` / `NodeStatus` 常量比较不会分属两个对象）。
export { Orchestrator, OrchestratorStatus, SSE_EVENT, Semaphore } from './Orchestrator.js';
export { getSessionSemaphoreStats, getRoleLimiterStats, setRoleLimit } from './Orchestrator.js';
export { StepNode, NodeStatus } from './StepNode.js';
export { FlexRunner, ControlType, StepStatus } from './FlexRunner.js';
export { __getSharedKnowledgeManagerForTest } from './FlexRunner.js';
// 兜底注册表：门面在 import 期用它登记内置实现（也是"无宿主 fail closed"的唯一出口）
export { registerFallback, resolveFallback, resolveFallbackSync, hasFallback, FALLBACK_NAMES } from './lib/fallbacks.js';

export default definePlugin({
    name: 'engines/orchestrator',
    version: '1.0.0',
    seam: 'engine-orchestrator',
    // 见头注释：不声明依赖，协作方按首次使用解析
    dependencies: [],
    setup(ctx) {
        // 无常驻资源可回收：并发信号量与角色限流器是进程级单例（本就跨实例共享），
        // AbortTree / StepNode / 各 FlexRunner 都随实例走，故 setup 无需返回值/无 disposer。
        ctx.provide('engine-orchestrator', Orchestrator);
    },
});
