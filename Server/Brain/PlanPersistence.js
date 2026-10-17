/**
 * Server/Brain/PlanPersistence.js —— 转发门面（实现已迁入 `plugins/engines/brain/`）
 *
 * 导出面前后逐名一致：具名 `PlanPersistence` + `default`，都是插件里那两个**同一个绑定**。
 * 无兜底登记：存储门面由 Brain 构造期注入（Brain 自己才做 storage 解析）。
 */

export { PlanPersistence } from '../../plugins/engines/brain/PlanPersistence.js';
export { default } from '../../plugins/engines/brain/PlanPersistence.js';
