/**
 * Server/library/AtomicJsonFile.js — 转发门面（实现已迁入 `plugins/storage/core/lib/`）
 *
 * 为什么要搬：持久化插件（`plugins/storage/core`）不允许伸手进 `Server/`（arch-guard R2），
 * 而 JsonAdapter 需要 `renameWithRetry`。于是实现落到插件内副本、Server 侧改为转发——
 * 全仓库仍只有**一份**实现，`_chains`（按路径串行化的 promise 链）也只有一份，
 * 不会出现"两个模块实例各自排队、锁形同虚设"的隐患。
 *
 * 导出面与迁移前逐名一致：renameWithRetry / writeJsonAtomic / readJson / updateJson /
 * withSerializedLock / _resetChains / default。消费者（StatsService、KnowledgeManager、
 * Blackboard）路径不变。
 */

export * from '../../plugins/storage/core/lib/AtomicJsonFile.js';
export { default } from '../../plugins/storage/core/lib/AtomicJsonFile.js';
