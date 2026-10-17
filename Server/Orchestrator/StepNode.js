/**
 * Server/Orchestrator/StepNode.js —— 转发门面（实现已迁入 `plugins/engines/orchestrator/`）
 *
 * 纯转发，**零登记**：`StepNode` 唯一的协作者是内核里的 `nowCST()`（无状态纯函数），
 * 没有需要兜底的宿主依赖。导出面与迁移前逐名一致（`StepNode` + `NodeStatus` + `default`），
 * 且就是插件里那两个绑定（`===`）。
 */

export { StepNode, NodeStatus } from '../../plugins/engines/orchestrator/StepNode.js';
export { default } from '../../plugins/engines/orchestrator/StepNode.js';
