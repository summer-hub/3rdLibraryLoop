/**
 * storageSource —— 本插件解析 `createStorage` 的唯一入口（接缝优先，门面兜底）
 *
 * 形状与 `plugins/engines/knowledge/lib/storageSource.js` 完全一致（那是本簇的样板）。
 * 为什么需要这一层：迁移前 `Brain` 直接 `import { createStorage } from '../DbUse/index.js'`。
 * 迁到插件后这条相对路径不再合法——架构守卫 R2 禁止插件引用 `Server/`。解析顺序：
 *
 *     1. 调用方显式注入（`new Brain({ storage })`，测试/嵌入式）——在 Brain 里判断；
 *     2. **有活跃插件宿主**：走 `storage` 接缝（`core/hostBridge.js` 的 `resolveSeamProvider`，
 *        R2 允许插件引用 `core/`）。作用域宿主（`runInHostScope`）优先于默认宿主；
 *     3. **无宿主**：用 `Server/Brain/Brain.js` 门面在 import 期登记的内置兜底
 *        （`async () => (await import('../DbUse/index.js')).createStorage`）——登记的是
 *        **惰性加载器**而不是函数本身，所以无宿主时仍然保持迁移前的"第一次使用才加载
 *        存储实现"的时机，且拿到的仍是同一份内置实现；
 *     4. 三档都没有 → fail closed，错误信息点名缺哪条接缝 / 哪个登记函数。
 *
 * 为什么兜底由门面登记、而不是本插件自己 import 存储实现：插件不能跨插件 import（R2），
 * 兜底本质上是"宿主缺席时的旧路径"，属于装配层的事（与 knowledge 那片同源）。
 */

import { resolveSeamProvider } from '../../../../core/hostBridge.js';

/** 无宿主兜底：`() => createStorage | Promise<createStorage>`；由 Server 侧门面登记 */
let _fallbackLoader = null;

/**
 * 登记无宿主兜底（幂等取先登记的那一个，重复登记不覆盖）。
 *
 * 取「先登记先赢」而不是「后登记覆盖」：门面在 import 期登记，宿主的接缝在第 2 步
 * 已经优先命中；这里若允许覆盖，宿主 dispose 之后仍指向一个已释放的宿主上下文，
 * 会把"无宿主"退化成"报错"。
 *
 * @param {() => (Function | Promise<Function>)} loader - 返回内置 createStorage 的加载器
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
 * 解析 `createStorage` 工厂。
 *
 * @returns {Promise<Function>} `createStorage`（同步工厂，与迁移前同一个签名）
 * @throws {Error} 既没有活跃宿主的 `storage` 接缝，也没有登记兜底时
 */
export async function resolveCreateStorage() {
    const fromHost = resolveSeamProvider('storage');
    if (typeof fromHost === 'function') return fromHost;

    if (typeof _fallbackLoader === 'function') {
        const impl = await _fallbackLoader();
        if (typeof impl === 'function') return impl;
    }

    throw new Error(
        "engines/brain：无法解析 createStorage —— 既没有活跃插件宿主的 'storage' 接缝，" +
            '也没有登记无宿主兜底。请二选一：加载提供 storage 接缝的插件（plugins/storage/core），' +
            '或从门面 Server/Brain/Brain.js 导入（它会在 import 期登记内置实现），' +
            '或显式注入 new Brain({ storage })'
    );
}
