/**
 * Server/DbUse/stores/TaskStepStore.js — 转发门面（实现已迁入 `plugins/storage/core/stores/`）
 *
 * 纯转发、零逻辑：仍是同一个类对象（SQLite task_steps，含 F-16 seq 竞态修复）。
 * 导出面不变（只有 default）。test/m3 的 f16/f17 按本路径 import。
 */

export { default } from '../../../plugins/storage/core/stores/TaskStepStore.js';
