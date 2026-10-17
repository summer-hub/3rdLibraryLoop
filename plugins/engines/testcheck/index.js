/**
 * plugins/engines/testcheck/index.js —— `engine-testcheck` 接缝提供方：任务准出审核引擎
 *
 * 实现层原样来自 `Server/TestCheck/`（2 个文件 787 行，业务逻辑逐行不变），另加：
 *
 *   lib/storageSource.js      解析 createStorage：宿主 storage 接缝 → 门面登记兜底 → fail closed
 *   lib/llmSource.js          解析 LLM 客户端：宿主 llm 接缝 → 门面登记兜底 → fail closed
 *   lib/cliSource.js          解析 CLI 协作方：门面登记的 CLIController → 宿主 ai-cli 接缝 → fail closed
 *   lib/skillSelectorSource.js 解析 SkillSelector Agent：显式注入 → 门面登记兜底 → fail closed
 *                              （**没有接缝档**：SkillSelector 尚未插件化，见该文件头）
 *
 * `nowCST()` 不在此列：它是 16 行**无状态纯函数**，已归一到内核 `core/cstTime.js`
 * （全仓库唯一一份，本插件直接 `../../../core/cstTime.js`）。R2 允许插件引用 `core/`，
 * 所以「内核提供原语」比立接缝（插件目录 + 清单 + 拓扑依赖 + 每次调用经 ctx.inject）
 * 或继续复制都便宜。
 *
 * setup 注册一个服务：
 *
 *   ctx.provide('engine-testcheck', TestCheck)
 *       注册**类**而不是工厂/单例：消费者的既有形状就是
 *       `new TestCheck({ sseHub, storage, skillDirectory, cli })`
 *       （`Server/composition/buildApp.js`、`Server/LoopEngine/LoopEngine.js`、m3/m9 用例）。
 *       单例化会焊死"每个 LoopEngine 各自 new 一个、各自持 status 状态机"这个既有语义；
 *       注册工厂则要求消费方多包一层。契约见 `seams/engine-testcheck.js`。
 *
 * 形状与 `plugins/engines/brain`（同类样板）一致：实现体具名再导出透出，
 * `default` 留给 `definePlugin`，供 `Server/TestCheck/**` 门面逐名转发（门面转发的是
 * **同一批模块实例**，所以全仓库只有一份 TestCheck 类）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import { CheckStatus, TestCheck } from './TestCheck.js';

// 供 Server 侧门面与插件内消费者逐名转发（default 留给 definePlugin）
export { TestCheck, CheckStatus };

// 契约 `seams/engine-testcheck.js` 的 `constants: ['CheckStatus']`：把**同一份**冻结常量表
// 挂到类上，供消费者**不 import 本插件模块**也能读到状态字面量——例如
// `plugins/engines/loopengine` 的三处 `checkResult.status === CheckStatus.ERROR/IDLE`
// （F-22「审核出错 ≠ 审核不通过」的核心判据）只经接缝/门面拿到 `TestCheck` 类，
// 再 `TestCheck.CheckStatus` 取表。
// 赋值只是把本文件里本来就具名导出的那个对象挂上去：**不是副本、不是 structuredClone、
// 不是重建**（换一份对象会让那三处 `===` 全部失效、F-22 静默退化），且 `CheckStatus`
// 自身 `Object.freeze`，挂上去之后仍不可改写（m9 会断言 `Object.isFrozen`）。
TestCheck.CheckStatus = CheckStatus;

export default definePlugin({
    name: 'engines/testcheck',
    version: '1.0.0',
    seam: 'engine-testcheck',
    // 不声明 dependencies：setup 不 inject 任何服务；llm / storage / cli / skillSelector
    // 四条协作方都由 lib/*Source.js 在**首次使用时**按"宿主接缝 → 门面登记兜底"解析，
    // 因此不需要拓扑顺序保证，也不会因为某个 profile 没启用 storage/core 或 cli/* 而让
    // 宿主起不来（topoSort 对"声明了依赖但依赖未启用"是硬报错）。
    dependencies: [],
    setup(ctx) {
        // 无常驻资源可回收：storage 的 JSON 适配器随实例走，LLM/CLI/SkillSelector
        // 客户端按解析链惰性构造，故 setup 无需返回 dispose。
        ctx.provide('engine-testcheck', TestCheck);
    },
});
