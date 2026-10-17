/**
 * Server/DbUse/adapters/BaseAdapter.js — 转发门面（实现已迁入 `plugins/storage/core/adapters/`）
 *
 * 纯转发、零逻辑：仍是同一个类对象——自定义适配器 `extends BaseAdapter` 与
 * `instanceof` 判断全部照旧。导出面不变（只有 default）。
 */

export { default } from '../../../plugins/storage/core/adapters/BaseAdapter.js';
