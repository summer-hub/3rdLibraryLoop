/**
 * Server/DbUse/stores/SessionStore.js — 转发门面（实现已迁入 `plugins/storage/core/stores/`）
 *
 * 纯转发、零逻辑：仍是同一个类对象（组合 jsonl + json 适配器，含去重与卡死判定）。
 * 导出面不变（只有 default）。
 */

export { default } from '../../../plugins/storage/core/stores/SessionStore.js';
