/**
 * Server/DbUse/MessageArchive.js — 转发门面（实现已迁入插件 `plugins/storage/core/`）
 *
 * 纯转发、零逻辑。AI CLI 适配器的 `new MessageArchive()` 与 `this.archive.*`
 * 调用一个都不用改；本片**不**把 CLI 侧接到插件的 `message-archive` 接缝上
 * （那是下一片改动），所以这里也不经过 hostBridge。
 */

export { default } from '../../plugins/storage/core/MessageArchive.js';
