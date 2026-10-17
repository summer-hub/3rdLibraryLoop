/**
 * Server/Brain/DecompositionStrategies.js —— 转发门面（实现已迁入 `plugins/engines/brain/`）
 *
 * 导出面前后逐名一致：具名 `DecompositionStrategies` + `default`，都是插件里那两个
 * **同一个绑定**。无兜底登记：协作者 llm / skillExecutor 一律由 Brain 注入。
 */

export { DecompositionStrategies } from '../../plugins/engines/brain/DecompositionStrategies.js';
export { default } from '../../plugins/engines/brain/DecompositionStrategies.js';
