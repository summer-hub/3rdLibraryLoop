/**
 * Server/FlexRunner/index.js —— 统一导出（**转发门面**，实现已迁入
 * `plugins/engines/orchestrator/`）
 *
 * 外部使用（与迁移前逐名一致）：
 *   import { FlexRunner } from './FlexRunner/index.js';
 *   const runner = new FlexRunner();
 *   await runner.initContext({ taskId: 'task-001', ... });
 *   const ok = await runner.executeStart();
 *
 * 纯转发：导出面与迁移前逐名一致（含 `ControlType` / `StepStatus` / `default`），
 * 且解析到**同一批模块实例**（`===` 插件里的那几个绑定）。
 *
 * 五条无宿主兜底（`cli-controller` / `skill-selector` / `create-storage` /
 * `knowledge-manager` / `mcp-tool-guide`）的登记在 `./FlexRunner.js`，理由同
 * `Server/Orchestrator/index.js`：既有代码两种 import 写法都有
 * （`from './FlexRunner/index.js'` 与 `from '../FlexRunner/FlexRunner.js'`），
 * 登记点选在两条路径都必经的文件上。
 */

export {
    FlexRunner,
    ControlType,
    StepStatus,
    __getSharedKnowledgeManagerForTest,
} from './FlexRunner.js';
export { default } from './FlexRunner.js';
