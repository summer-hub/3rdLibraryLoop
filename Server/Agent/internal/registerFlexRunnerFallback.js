/**
 * Server/Agent/internal/registerFlexRunnerFallback.js —— 装配层登记：默认会话适配器 = FlexRunner
 *
 * 为什么需要这个文件：`plugins/agent/core/Runtime/AgentRuntime.js` 的
 * `_resolveAdapterFactory()` 默认要用 `Server/FlexRunner` 的 `FlexRunner` 作为会话适配器
 * （迁移前那行是 `await import('../../FlexRunner/FlexRunner.js')`）。插件不得引用 `Server/`
 * （架构守卫 R2），于是这条协作方只能由**装配层**登记进来（与 `llm` 兜底、
 * `plugins/engines/brain/lib/cliSource.js` 的 `CLIController` 兜底同一形状：
 * 「无宿主时用什么」是装配层的事，不是能力层的事）。
 *
 * 为什么单独一个文件而不是在每处门面里各写两行：
 *   - 加载器只有一份定义（DRY），改路径只改这里；
 *   - 登记点有**好几处门面**（见下），分散写会让"哪些文件会登记"变成需要全文搜索才知道的
 *     隐形契约。这里集中，门面里只留一行副作用 import。
 *
 * 为什么登记**加载器**而不是类：保持迁移前的时机——`@opencode-ai/sdk` / `openai` 不该进
 * 「只想 new 一个 RoleLimiter / Supervisor」的模块图。这个加载器是 async、零静态代价。
 *
 * 为什么登记点是这几处（缺一处就会出现"宿主在、但没有任何门面被 import 过"的空档）：
 *   - `Server/Agent/Runtime/RoleLimiter.js`：**`Server/Orchestrator/Orchestrator.js` 静态
 *     import 它**，因此任何跑起编排的进程（应用入口与 m5/m6 套件）都必然走过这里；
 *   - `Server/Agent/Runtime/AgentRuntime.js` / `Server/Agent/Supervisor/Supervisor.js` /
 *     `Server/Agent/Supervisor/MultiAgentRunner.js`：直接 import 深层路径的调用方
 *     （`test/m5-phase2/f35`、`test/m6-phase3/f37/f38/f42`）走的是这几条；
 *   - `Server/Agent/index.js`：目录级 barrel，给了"一次登记"的便捷入口。
 * 全部登记都是幂等 `??=`，重复 import 无副作用（ESM 模块缓存保证本文件只求值一次）。
 *
 * `Server/Agent/AGENTS.md` 里"Server 侧门面登记无宿主协作方"的既有约定即指本文件这种角色。
 */

import { setRunnerFactoryFallback } from '../../../plugins/agent/core/lib/runnerFactorySource.js';

setRunnerFactoryFallback(async () => (await import('../../FlexRunner/FlexRunner.js')).FlexRunner);
