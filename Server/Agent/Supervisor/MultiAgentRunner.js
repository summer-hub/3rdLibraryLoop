/**
 * Server/Agent/Supervisor/MultiAgentRunner.js —— 转发门面（实现已迁入 `plugins/agent/core/Supervisor/`）
 *
 * 为什么留这一层：`test/m5-phase2/f35`、`test/m6-phase3/f37`、`f38`、`f42` 都按这个
 * 历史路径 import；`Server/Orchestrator/Orchestrator.js` 也在 import 期用它登记
 * `multi-agent-runner` 的无宿主兜底（`registerFallback`）。
 *
 * **必须 `export ... from` 转发，不能重新实现**：`MultiAgentRunner` 每个实例持有一整次
 * 步骤执行的上下文（`taskId/stepId/_stepConfig/_collabPlan/_supervisor/_abortController`）。
 * 门面与插件是同一模块实例，所以消费者 `inject('agent-multi-agent-runner')` 拿到的类与
 * 门面导出的类 `===`——这是「接缝优先于门面兜底」可以被机器断言的前提。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

export * from '../../../plugins/agent/core/Supervisor/MultiAgentRunner.js';
export { default } from '../../../plugins/agent/core/Supervisor/MultiAgentRunner.js';

// 装配层登记：默认会话适配器 = FlexRunner（`AgentRuntime._resolveAdapterFactory` 用）。
// 本门面是 `test/m5-phase2/f35`、`test/m6-phase3/f37/f38/f42` 与
// `Server/Orchestrator` 的 `multi-agent-runner` 兜底加载器所指向的必经文件。
import '../internal/registerFlexRunnerFallback.js';
