/**
 * plugins/engines/loopengine/index.js —— `engine-loop` 接缝提供方：大循环协调引擎
 *
 * 实现层原样来自 `Server/LoopEngine/`（2 个文件 / 1375 行，业务逻辑逐行不变），另加：
 *
 *   lib/storageSource.js    解析 createStorage：宿主 storage 接缝 → 门面登记兜底 → fail closed
 *                           （**同步**：storage 在 LoopEngine 上是惰性同步 getter，
 *                            理由见该文件头 —— Server/Routes 里有一条同步读它的路径）
 *   lib/cliSource.js        解析 CLI 协作方：门面登记的 CLIController → 宿主 ai-cli 接缝 → fail closed
 *   lib/testcheckSource.js  解析 engine-testcheck 的提供方**类** + 校验契约 `constants`
 *                           声明的 CheckStatus 冻结常量表（缺失即点名，不退回字符串字面量）
 *
 * `nowCST()` 不在此列：它是无状态纯函数，已归一到内核 `core/cstTime.js`（全仓库唯一
 * 一份，本插件直接 `../../../core/cstTime.js`；R2 允许插件引用 `core/`）。
 *
 * ── 本片的核心：状态常量表怎么跨插件交付 ─────────────────────────────────────
 * `CheckStatus` / `BrainStatus` 是**模块级 `Object.freeze` 常量表**，不是实例能力面
 * （写进接缝的 `methods`/`properties` 会变成"实例上必须有这个成员"的假声明）。因此走
 * **类静态属性**通道，三档一起改：
 *
 *   提供方（本插件用到的那个）：`plugins/engines/testcheck/index.js` 里
 *       `TestCheck.CheckStatus = CheckStatus;`          // 同一对象，不是克隆
 *       `plugins/engines/brain/index.js` 里
 *       `Brain.BrainStatus = BrainStatus;`              // 同一对象，不是克隆
 *   契约：`seams/engine-testcheck.js` 写 `constants: ['CheckStatus']`
 *         `seams/engine-brain.js`     写 `constants: ['BrainStatus']`
 *         ——语义是「提供方注册的**类**上必须有这些**冻结常量表**属性，供消费者在
 *         **不 import 提供方模块**的前提下读状态字面量」；
 *   消费者：本插件的 `lib/testcheckSource.js` 的 `requireFrozenConstants()` 读取并
 *         校验（存在 + 是对象 + `Object.isFrozen`），缺一档就 fail closed 并点名；
 *         `test/m9-contract-conformance` 对每个声明了 `constants` 的提供方断言同一组条件。
 *
 * 本插件自己的契约 `seams/engine-loop.js` 写 `constants: []`：LoopEngine 只**消费**
 * 别人的常量表（三处 `checkResult.status === CheckStatus.ERROR/IDLE`），不额外提供任何
 * 一张表给别的插件读（`LoopStatus` 是给自己的门面/前端读的，没有跨插件消费者）。
 *
 * ── setup 注册形状 ────────────────────────────────────────────────────────────
 * `ctx.provide('engine-loop', LoopEngine)` —— 注册**类**而不是工厂/单例：消费者的既有
 * 形状是 `new LoopEngine({ brainController, orchestratorController, storage, testCheck })`
 * （`Server/Routes/controllers/LoopEngineController.js` 的 `_createEngine()`、
 * `cli/lib/runner.js` 的 `createLoopEngine()`、m3 的 F-22/F-24 套件）。
 * 注册单例会把"每个大循环一份 `_loops` / `_abortStates` / `_checkStatus`"焊死成一个
 * 共享实例——两条并发大循环会互相改写进度与终止标志。契约见 `seams/engine-loop.js`。
 *
 * 形状与 `plugins/engines/{brain,testcheck,orchestrator}`（同类样板）一致：实现体具名
 * 再导出透出，`default` 留给 `definePlugin`，供 `Server/LoopEngine/**` 门面逐名转发
 * （门面转发的是**同一批模块实例**，所以全仓库只有一份 LoopEngine 类与一张 LoopStatus）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import { ABORTED_ERROR, LoopEngine, LoopStatus } from './LoopEngine.js';

// 供 Server 侧门面与插件内消费者逐名转发（default 留给 definePlugin）。
// 导出面与迁移前的 Server/LoopEngine/{LoopEngine,index}.js 逐名一致：
// 具名 LoopEngine / LoopStatus / ABORTED_ERROR + default。
export { LoopEngine, LoopStatus, ABORTED_ERROR };

// 三条解析链的登记/取用入口：门面在 import 期用 setXxxFallback 登记内置实现，
// 探针与测试用 resolveXxx 直接验文案（也是"无宿主 fail closed"的唯一出口）。
export { resetCliFallback, resolveCli, setCliFallback } from './lib/cliSource.js';
export { resetStorageFallback, resolveCreateStorage, setStorageFallback } from './lib/storageSource.js';
export { resetTestCheckFallback, resolveTestCheckClass, setTestCheckFallback } from './lib/testcheckSource.js';

export default definePlugin({
    name: 'engines/loopengine',
    version: '1.0.0',
    seam: 'engine-loop',
    // 不声明 dependencies：setup 不 inject 任何服务；storage / cli / engine-testcheck
    // 三条协作方都由 lib/*Source.js 在**首次使用时**按"宿主接缝 → 门面登记兜底"解析，
    // 因此不需要拓扑顺序保证，也不会因为某个 profile 没启用 storage/core 或
    // engines/testcheck 而让宿主起不来（topoSort 对"声明了依赖但依赖未启用"是硬报错）。
    dependencies: [],
    setup(ctx) {
        // 无常驻资源可回收：`_loops` / `_abortStates` 都随实例走，storage 的 JSON 适配器
        // 随 storage 门面走，TestCheck 实例随 LoopEngine 实例走，故 setup 无需返回 dispose。
        ctx.provide('engine-loop', LoopEngine);
    },
});
