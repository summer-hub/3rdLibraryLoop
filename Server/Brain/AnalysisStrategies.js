/**
 * Server/Brain/AnalysisStrategies.js —— 转发门面（实现已迁入 `plugins/engines/brain/`）
 *
 * 导出面前后逐名一致：具名 `AnalysisStrategies` + `default`，都是插件里那两个**同一个绑定**。
 * 无兜底登记：本类是 Brain 的内部组合件（协作者 llm / skillExecutor 一律由 Brain 注入），
 * 不自行解析任何协作方。
 */

export { AnalysisStrategies } from '../../plugins/engines/brain/AnalysisStrategies.js';
export { default } from '../../plugins/engines/brain/AnalysisStrategies.js';
