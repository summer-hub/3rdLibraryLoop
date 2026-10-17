/**
 * Server/DbUse/StorageManager.js — 转发门面（实现已迁入插件 `plugins/storage/core/`）
 *
 * 纯转发、零逻辑：`StorageManager` 的构造签名、`static _ADAPTERS` 注册表、
 * `get/json/jsonl/sqlite/file/closeAll` 全部仍是同一份实现（同一个类对象），
 * 现有消费者与测试（含直接读 `_ADAPTERS` 的代码）都不受影响。
 */

export { default } from '../../plugins/storage/core/StorageManager.js';
