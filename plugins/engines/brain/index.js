/**
 * plugins/engines/brain/index.js —— `engine-brain` 接缝提供方：自然语言任务拆解引擎
 *
 * 实现层原样来自 `Server/Brain/`（6 个文件 1966 行，业务逻辑逐行不变），另加：
 *
 *   lib/BoundedRegistry.js ← Server/library/BoundedRegistry.js（零依赖容器，副本 #2）
 *   lib/storageSource.js   解析 createStorage：宿主 storage 接缝 → 门面登记兜底 → fail closed
 *   lib/llmSource.js       解析 LLM 客户端：宿主 llm 接缝 → 门面登记兜底 → fail closed
 *   lib/cliSource.js       解析 CLI 协作方：门面登记的 CLIController → 宿主 ai-cli 接缝 → fail closed
 *
 * `nowCST()` 不在此列：它是无状态纯函数，已归一到内核 `core/cstTime.js`
 * （全仓库唯一一份，本插件直接 `../../../core/cstTime.js`；R2 允许插件引用 `core/`）。
 *
 * 为什么 BoundedRegistry 仍是「副本」而不是接缝或跨插件 import：架构守卫 R2
 * （`scripts/arch-guard.mjs`）只允许插件引用 `node:` / npm 包 / `core/` / `seams/` /
 * 自身插件目录。它很小、且没有"可替换的提供方"语义，理由写在副本的文件头（判据与
 * `test/m8-plugin-kernel/f50-util-copies.test.mjs` 的"按状态作用域选守卫强度"一致）。
 *
 * setup 注册一个服务：
 *
 *   ctx.provide('engine-brain', Brain)
 *       注册**类**而不是工厂/单例：消费者的既有形状就是 `new Brain({ sseHub, storage })`
 *       （`Server/Routes/controllers/BrainController.js`、`Server/LoopEngine/LoopEngine.js`、
 *       `cli/lib/runner.js` 经 buildApp 拿 controller、以及 m2/m3/m9 用例）。
 *       单例化会焊死"每个 BrainController 各自 new 一个、各自持内存计划缓存"这个既有语义，
 *       注册工厂则要求消费方多包一层。契约见 `seams/engine-brain.js`。
 *
 * 形状与 `plugins/engines/knowledge`（引擎簇第一片）一致：实现体具名再导出透出，
 * `default` 留给 `definePlugin`，供 `Server/Brain/**` 门面逐名转发（门面转发的是
 * **同一批模块实例**，所以全仓库只有一份 Brain 类）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import { Brain, BrainStatus } from './Brain.js';
import { SkillExecutor } from './SkillExecutor.js';

// 供 Server 侧门面与插件内消费者逐名转发（default 留给 definePlugin）
export { Brain, BrainStatus, SkillExecutor };

// 契约 `seams/engine-brain.js` 的 `constants: ['BrainStatus']`：把**同一份**冻结常量表挂到
// 类上，供消费者**不 import 本插件模块**也能读到状态字面量——例如
// `plugins/engines/loopengine` 只经接缝/门面拿到 `Brain` 类，再 `Brain.BrainStatus` 取表。
// 赋值只是把本文件里本来就具名导出的那个对象挂上去：**不是副本、不是 structuredClone、
// 不是重建**（换一份对象会让消费者的 `===` 比较全部失效），且 `BrainStatus` 自身
// `Object.freeze`，挂上去之后仍不可改写（m9 会断言 `Object.isFrozen`）。
Brain.BrainStatus = BrainStatus;

export default definePlugin({
    name: 'engines/brain',
    version: '1.0.0',
    seam: 'engine-brain',
    // 不声明 dependencies：setup 不 inject 任何服务；storage / llm / cli 三条协作方都由
    // lib/*Source.js 在**首次使用时**按"宿主接缝 → 门面登记兜底"解析，因此不需要拓扑
    // 顺序保证，也不会因为某个 profile 没启用 storage/core 或 cli/* 而让宿主起不来
    // （topoSort 对"声明了依赖但依赖未启用"是硬报错）。
    dependencies: [],
    setup(ctx) {
        // 无常驻资源可回收：Brain 的 JSON 适配器随实例走，计划缓存是每实例的
        // BoundedRegistry，CLI/LLM 客户端按解析链惰性构造，故 setup 无需返回值。
        ctx.provide('engine-brain', Brain);
    },
});
