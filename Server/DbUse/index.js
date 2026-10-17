/**
 * Server/DbUse/index.js — 统一持久化存储入口（**门面**，实现已迁入插件）
 *
 * 实现实体：`plugins/storage/core/createStorage.js`（+ 同目录的 StorageManager / adapters / stores）。
 * 为什么留这一层：`Server/**` 里 16 处消费者与既有测试都按 `Server/DbUse/index.js` 这个路径
 * import，插件化不该顺手改掉它们的 import；而架构守卫只禁止「插件 → Server」方向，
 * 「Server → plugins」是允许的（与 `Server/Agent/SkillSelector/llm/llmClient.js` 同一形状）。
 *
 * 本文件不是纯转发：`createStorage` 多了一层**宿主桥**（见 Server/composition/hostBridge.js）——
 * 有活跃插件宿主且宿主注册了 `storage` 接缝 → 用宿主提供的工厂；否则回落到内置实现。
 * 无宿主（默认部署形态）时与迁移前逐字节等价：同一个实现、同样的 options、同样同步返回。
 *
 * 导出面与迁移前逐名一致（含 default 那个「门面对象」），一个都没少。
 */

import { createStorageFromHost } from '../composition/hostBridge.js';
import {
    createStorage as _createStorageBuiltin,
    MessageArchive,
    SessionStore,
    StorageManager,
    SubDirs,
    TaskStepStore,
} from '../../plugins/storage/core/createStorage.js';

export {
    StorageManager,
    SessionStore,
    TaskStepStore,
    TaskExecutionStore,
    TaskRegistryStore,
    MessageArchive,
    BaseAdapter,
    JsonAdapter,
    JsonlAdapter,
    SqliteAdapter,
    FileAdapter,
    SubDirs,
} from '../../plugins/storage/core/createStorage.js';

/**
 * 创建统一的存储门面，组合各 Store 并共享同一 StorageManager。
 *
 * 有宿主 → 宿主 `storage` 接缝的工厂；无宿主 → 内置实现（行为与迁移前一致）。
 *
 * @param {object} [options]
 * @param {string} [options.rootDir] - 存储根目录绝对路径（默认 <仓库父目录>/db）
 * @param {number} [options.stallThresholdMs] - Session 卡死判定阈值
 * @returns {object} 存储门面（manager / 各 Store 访问器 / 适配器直取 / close）
 */
export function createStorage(options = {}) {
    return createStorageFromHost(options, _createStorageBuiltin);
}

export default { createStorage, StorageManager, SessionStore, TaskStepStore, MessageArchive, SubDirs };
