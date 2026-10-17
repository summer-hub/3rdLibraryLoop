/**
 * Server/DbUse/adapters/JsonAdapter.js — 转发门面（实现已迁入 `plugins/storage/core/adapters/`）
 *
 * 纯转发、零逻辑：仍是同一个类对象；`renameWithRetry`（原子写重试）也已改为引用
 * 插件内副本 `plugins/storage/core/lib/AtomicJsonFile.js`，全仓库只有一份实现。
 * 导出面不变（只有 default），test/m3 的 f14/f15/f25 按本路径 import。
 */

export { default } from '../../../plugins/storage/core/adapters/JsonAdapter.js';
