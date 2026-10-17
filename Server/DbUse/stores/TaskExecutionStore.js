/**
 * Server/DbUse/stores/TaskExecutionStore.js — 转发门面（实现已迁入 `plugins/storage/core/stores/`）
 *
 * 纯转发、零逻辑：仍是同一个类对象（JSON 文件，按 taskId/stepId 落盘执行记录；
 * `nowCST` 已归一进内核 `core/cstTime.js`（全仓库唯一实现，插件直连）。
 * 导出面不变（只有 default）。
 */

export { default } from '../../../plugins/storage/core/stores/TaskExecutionStore.js';
