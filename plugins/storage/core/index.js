/**
 * plugins/storage/core/index.js — `storage` 接缝提供方：持久化存储内核
 *
 * 实现层原样来自 `Server/DbUse/`（12 个文件整体迁入，行为逐字节不变），
 * 外加一份小工具的实现副本（`lib/AtomicJsonFile.js`）——
 * 插件不允许伸手进 `Server/`（见 scripts/arch-guard.mjs 的 R2），
 * 因此这个被适配器/Store 依赖的带状态工具有了自己的插件内副本，
 * `Server/library/` 侧改为转发门面，全仓库仍只有一份实现。
 *
 * 时间格式化 `nowCST()` **不在这里**：它是无状态纯函数，已归一到内核
 * `core/cstTime.js`（全仓库唯一一份，Store 直接 `../../../../core/cstTime.js`），
 * R2 本来就在允许清单里，无需插件内副本。
 *
 * setup 注册两个服务（形状照抄 `plugins/llm/dashscope/index.js`）：
 *
 *   ctx.provide('storage', createStorage)
 *       注册**工厂**而非类/单例：存储门面天然是"按数据目录、按卡死阈值各建一套"
 *       （`createStorage({ rootDir })`），单例化会把"谁用哪个根目录"重新焊死。
 *       工厂产物（manager / 各 Store / 适配器直取 / close）见 seams/storage.js。
 *
 *   ctx.provide('message-archive', (options) => new MessageArchive(options))
 *       同样注册**工厂**：AI CLI 适配器既有用法是 `options.archive ?? new MessageArchive()`，
 *       即"每次构造一个归档实例"，注册工厂比注册类更贴合该调用形状（无需消费者多包一层
 *       `new (inject('message-archive'))()`）。契约见 seams/message-archive.js。
 *       这条接缝正是下一步 AI CLI 插件化的解耦点：CLI 插件只依赖"归档"这一能力，
 *       不认识 StorageManager / 适配器 / 目录布局。
 *
 * 实现层的全部既有名字经 `export *` 透出，供 `Server/DbUse/**` 的门面逐名转发
 * （Server 侧 16 处 import 与既有测试的路径一个都不变）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import MessageArchive from './MessageArchive.js';
import { createStorage } from './createStorage.js';

export * from './createStorage.js';

export default definePlugin({
    name: 'storage/core',
    version: '1.0.0',
    seam: 'storage',
    setup(ctx) {
        // 服务回收由 ctx.provide 自动登记的 disposer 负责（见 core/Context.js），
        // 故 setup 无需返回值：本插件不持有进程级资源（连接都在各 createStorage 门面内部）。
        ctx.provide('storage', createStorage);
        ctx.provide('message-archive', (options) => new MessageArchive(options));
    },
});
