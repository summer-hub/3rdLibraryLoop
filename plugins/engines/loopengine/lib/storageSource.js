/**
 * storageSource —— 本插件解析 `createStorage` 的唯一入口（接缝优先，门面兜底）
 *
 * 为什么需要这一层：迁移前 `LoopEngine` 的构造函数里直接
 * `this.storage = deps.storage || createStorage()`（静态 import
 * `../DbUse/index.js`）。插件不得引用 `Server/`（架构守卫 R2），这条运行时自建
 * 必须换成解析器。解析顺序（与 brain/testcheck 的 storageSource 逐档对齐）：
 *
 *     1. 构造入参显式注入（`new LoopEngine({ storage })`，测试/嵌入式）—— 在 LoopEngine 里判断；
 *     2. **有活跃插件宿主**：走 `storage` 接缝（`core/hostBridge.js` 的 `resolveSeamProvider`，
 *        R2 允许插件引用 `core/`）。作用域宿主（`runInHostScope`）优先于默认宿主；
 *     3. **无宿主**：用 `Server/LoopEngine/LoopEngine.js` 门面在 import 期登记的内置兜底
 *        （`() => createStorage`）—— 拿到的仍是同一份内置实现；
 *     4. 三档都没有 → fail closed，错误信息点名缺哪条接缝 / 哪个登记函数。
 *
 * ── 为什么本文件的解析是**同步**的（brain / testcheck 同名文件是 async）──────────
 * 这两处差异都不是风格问题，而是被既有调用形状逼出来的：
 *   ① 迁移前 `createStorage()` 就在**构造函数里同步执行**，`this.storage` 是构造后
 *     立刻可用的普通字段。`Server/Routes/controllers/LoopEngineController.js` 的
 *     兜底路径（`_getStorage()`：`const tmp = this._createEngine(); this.storage =
 *      tmp.storage`）正是**同步**读它——那条路径在 `Server/**` 里，本次迁移的边界
 *      不允许改。改成 async 解析就必须把 `storage` 从字段变成"首次使用才填"，
 *      那条兜底会静默拿到 null。
 *   ② 于是 `storage` 在 LoopEngine 上是**惰性 getter**（`_storage` 为 null 时同步解析），
 *      构造期不解析、不抛（m9 会用 `new LoopEngine({...})` 真构造一次提供方），
 *      首次读取才 fail closed 并点名——与 brain/testcheck 的"首次使用解析"同一语义，
 *      只是那一步是同步的。
 * 因此门面登记的是**同步加载器** `() => createStorage`（静态 import，与迁移前的模块图
 * 完全一致），本文件用 `resolveCreateStorage()` 同步取用；异步加载器会被明确拒绝而
 * 不是悄悄返回 undefined。
 */

import { resolveSeamProvider } from '../../../../core/hostBridge.js';

/** 无宿主兜底：`() => createStorage`（同步加载器）；由 Server 侧门面登记 */
let _fallbackLoader = null;

/**
 * 登记无宿主兜底（幂等取先登记的那一个，重复登记不覆盖）。
 *
 * 取「先登记先赢」而不是「后登记覆盖」：门面在 import 期登记，宿主的接缝在第 2 步
 * 已经优先命中；这里若允许覆盖，宿主 dispose 之后仍指向一个已释放的宿主上下文，
 * 会把"无宿主"退化成"报错"——与 brain/testcheck/orchestrator 的裁决一致。
 *
 * @param {() => Function} loader - 返回内置 `createStorage` 的**同步**加载器
 */
export function setStorageFallback(loader) {
    if (typeof loader !== 'function') {
        throw new TypeError('setStorageFallback(loader)：loader 必须是函数');
    }
    _fallbackLoader ??= loader;
}

/** 清空兜底登记（仅测试/热替换用；正常部署不应调用）。 */
export function resetStorageFallback() {
    _fallbackLoader = null;
}

/**
 * 解析 `createStorage` 工厂（**同步**，理由见文件头）。
 *
 * @returns {Function} `createStorage`（同步工厂，与迁移前同一个签名）
 * @throws {Error} 三档都解析不到时；或兜底加载器是异步的（不能同步取用）
 */
export function resolveCreateStorage() {
    const fromHost = resolveSeamProvider('storage');
    if (typeof fromHost === 'function') return fromHost;

    if (typeof _fallbackLoader === 'function') {
        const impl = _fallbackLoader();
        if (typeof impl === 'function') return impl;
        if (impl !== null && typeof impl === 'object' && typeof impl.then === 'function') {
            // 异步加载器不能同步取用。挂一个空 catch，避免"抛错 + 未处理的 rejection"双报。
            impl.catch(() => {});
            throw new Error(
                "engines/loopengine：兜底 'create-storage' 的加载器是异步的，无法同步取用。" +
                    'LoopEngine 的 storage 是同步惰性取值器（理由见 lib/storageSource.js 文件头），' +
                    "要求同步加载器，例如 setStorageFallback(() => createStorage)"
            );
        }
    }

    throw new Error(
        "engines/loopengine：无法解析 createStorage —— 既没有活跃插件宿主的 'storage' 接缝，" +
            '也没有登记无宿主兜底。请三选一：加载提供 storage 接缝的插件（plugins/storage/core），' +
            '或从门面 Server/LoopEngine/index.js 导入（它会在 import 期登记内置实现），' +
            '或显式注入 new LoopEngine({ storage })'
    );
}
