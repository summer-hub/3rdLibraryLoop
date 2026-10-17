/**
 * Server/DbUse/stores/TaskRegistryStore.js — 转发门面（实现已迁入 `plugins/storage/core/stores/`）
 *
 * 纯转发、零逻辑：仍是同一个类对象（SQLite task_registry，供历史列表分页）。
 * 导出面不变（只有 default）。
 */

export { default } from '../../../plugins/storage/core/stores/TaskRegistryStore.js';
