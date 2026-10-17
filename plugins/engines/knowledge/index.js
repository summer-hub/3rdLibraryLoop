/**
 * plugins/engines/knowledge/index.js —— `engine-knowledge` 接缝提供方：知识沉淀引擎
 *
 * 实现层原样来自 `Server/Knowledge/`（KnowledgeManager / KnowledgeImporter 两个文件，
 * 逻辑逐行不变），外加 `lib/` 下两份依赖的插件内副本 + 一个 createStorage 解析器：
 *
 *   lib/AtomicJsonFile.js  ← plugins/storage/core/lib/AtomicJsonFile.js（副本 #3，实现体逐字节同源）
 *   lib/McpToolGuide.js    ← Server/library/McpToolGuide.js（零 Server 依赖，故随插件走）
 *   lib/storageSource.js   解析 createStorage：宿主的 `storage` 接缝优先，无宿主用门面登记的内置实现
 *
 * `nowCST()` 不在此列：它是无状态纯函数，已归一到内核 `core/cstTime.js`
 * （全仓库唯一一份，本插件直接 `../../../core/cstTime.js`；R2 允许插件引用 `core/`）。
 *
 * 为什么这两份仍是「副本」而不是接缝或跨插件 import：架构守卫 R2（`scripts/arch-guard.mjs`）
 * 只允许插件引用 `node:` / npm 包 / `core/` / `seams/` / 自身插件目录。两份工具都很小、
 * 取舍各不相同，逐条理由写在各副本的文件头（与 `test/m8-plugin-kernel/f50-util-copies.test.mjs`
 * 里"按状态作用域选守卫强度"的判据一致）。
 *
 * setup 注册一个服务：
 *
 *   ctx.provide('engine-knowledge', KnowledgeManager)
 *       注册**类**而不是工厂/单例：消费者的既有形状就是 `new KnowledgeManager()` +
 *       `await init()`（`Server/composition/buildApp.js`、`Server/FlexRunner/FlexRunner.js`、
 *       `KnowledgeImportController`、`cli/lib/runner.js`、两条 M3 用例都这么用）。
 *       注册工厂反而要求消费方多包一层，且单例化会把"每个 FlexRunner 各自 new 一个、
 *       共享同一把 knowledge 串行锁"这个既有语义焊死。契约见 `seams/engine-knowledge.js`。
 *
 * 本文件是引擎簇（knowledge / 后续 brain / orchestrator / flexrunner / testcheck / loopengine）
 * 里第一个插件，形状刻意与 `plugins/storage/core`、`plugins/stats/core` 对齐：
 * 实现体经 `export *` / 具名再导出透出，`default` 留给 `definePlugin`，供 `Server/Knowledge/**`
 * 门面逐名转发（门面转发的是**同一批模块实例**，所以全仓库只有一份 `withSerializedLock` 锁）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import KnowledgeManager from './KnowledgeManager.js';

// 供 Server 侧门面与插件内消费者逐名转发（default 留给 definePlugin）
export { KnowledgeManager };
export * from './KnowledgeImporter.js';

export default definePlugin({
    name: 'engines/knowledge',
    version: '1.0.0',
    seam: 'engine-knowledge',
    // 不声明 dependencies：setup 不 inject 任何服务；createStorage 由
    // lib/storageSource.js 在**首次 init 时**按"宿主的 storage 接缝 → 门面兜底"解析，
    // 因此不需要拓扑顺序保证，也不会因为某个 profile 没启用 storage/core 而让宿主起不来
    // （topoSort 对"声明了依赖但依赖未启用"是硬报错）。
    dependencies: [],
    setup(ctx) {
        // 无常驻资源可回收：KnowledgeManager 的 JSON 适配器随实例走，串行锁由
        // lib/AtomicJsonFile.js 的模块级 Map 管理（进程内一份），故 setup 无需返回值。
        ctx.provide('engine-knowledge', KnowledgeManager);
    },
});
