/**
 * core — 插件内核（零业务依赖）
 *
 * 本目录是 3rdLibraryLoop 插件化改造的"操作系统内核"，参考 DeepSeek Harness /
 * Cordis 的「一切皆插件」理念实现，**不含任何业务代码**：
 *
 *   definePlugin.js   插件定义 + plugin.json 清单校验
 *   Context.js        服务注册/消费（provide/inject）+ 类型化事件（on/emit）+ 可逆回收
 *   PluginLoader.js   目录扫描 + 依赖拓扑排序 + 动态加载
 *   Profile.js        profile/bundle 配置组合（env > profile > 插件默认）
 *   PluginHost.js     生命周期编排（load/dispose/list/inject/emit）
 *   cstTime.js        `nowCST()` 北京时间格式化原语（无状态纯函数，插件与 Server 共用一份）
 *   hostBridge.js     「当前活跃宿主」的进程级状态（作用域宿主 > 默认宿主 > 无宿主）：
 *                     只读宿主状态 + 解析接缝提供方，零业务依赖，所以插件也能引用它
 *                     （`Server/composition/hostBridge.js` 只是转发门面）
 *
 * 用法（最小示例）：
 *   import { createDefaultHost } from './core/index.js';
 *   const host = createDefaultHost();
 *   await host.load();                       // 按 profiles/default.json 装配
 *   const cli = host.inject('ai-cli');       // 消费能力接缝
 *   await host.dispose();                    // 逆序回收
 *
 * 能力契约（接缝名与服务形状）见 `../seams/`——消费者只依赖契约，不依赖提供方。
 */

export { definePlugin, validateManifest } from './definePlugin.js';
export { PluginContext, EventMode } from './Context.js';
export { scanPluginRoots, topoSort, loadPluginEntry } from './PluginLoader.js';
export {
    loadProfile,
    resolveProfileDir,
    listProfiles,
    resolvePluginState,
    mergePluginRoots,
    PROFILE_ENV,
    DISABLE_ENV,
    ROOTS_ENV,
    DEFAULT_PROFILE,
    USER_PROFILES_DIR,
} from './Profile.js';
export { PluginHost, createDefaultHost, BUILTIN_PLUGINS_DIR, BUILTIN_PROFILES_DIR, USER_PLUGINS_DIR } from './PluginHost.js';
export { nowCST } from './cstTime.js';
export {
    setActiveHost,
    clearActiveHost,
    getActiveHost,
    hasActiveHost,
    runInHostScope,
    resolveSeamProvider,
    createLlmFromHost,
    resolveLlmClass,
    createStorageFromHost,
    resolveStorageFactory,
    resolveMessageArchiveFactory,
    resolveStats,
    resolveAiCliFactory,
} from './hostBridge.js';
