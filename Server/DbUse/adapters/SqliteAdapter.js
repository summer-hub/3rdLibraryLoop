/**
 * Server/DbUse/adapters/SqliteAdapter.js — 转发门面（实现已迁入 `plugins/storage/core/adapters/`）
 *
 * 纯转发、零逻辑：仍是同一个类对象（含 F-17 busy_timeout、F-18 预编译语句缓存），
 * 导出面不变（只有 default）。test/m3 的 f16/f17/f18 按本路径 import。
 */

export { default } from '../../../plugins/storage/core/adapters/SqliteAdapter.js';
