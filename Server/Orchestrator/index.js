/**
 * Server/Orchestrator/index.js —— 统一导出（**转发门面**，实现已迁入
 * `plugins/engines/orchestrator/`）
 *
 * 外部使用（与迁移前逐名一致）：
 *   import { Orchestrator } from './Orchestrator/index.js';
 *   const orch = new Orchestrator({ sseHub, storage });
 *   await orch.loadTask(taskDef);
 *   await orch.start();
 *
 * 本文件是纯转发：导出面与迁移前逐名一致（含 `OrchestratorStatus` / `StepNode` /
 * `NodeStatus` / `default`），且解析到**同一批模块实例**（`===` 插件里的那几个绑定）。
 *
 * 四条无宿主兜底（`role-limiter` / `multi-agent-runner` / `cli-controller` /
 * `skill-selector` / `create-storage` / `knowledge-manager` / `mcp-tool-guide`）的登记
 * 在 `./Orchestrator.js` 与 `../FlexRunner/FlexRunner.js` —— 因为"import 门面"在既有
 * 代码里两种写法都有（`from './Orchestrator/index.js'` 与 `from '../Orchestrator/
 * Orchestrator.js'`，后者是 m2/m3/m4/m6 套件的写法），登记点必须选在**两条路径都
 * 必经**的那个文件上（与 `Server/TestCheck/TestCheck.js` 同一取舍）。
 */

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
} from './Orchestrator.js';
export { default } from './Orchestrator.js';
