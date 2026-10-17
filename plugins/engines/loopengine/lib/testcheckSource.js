/**
 * testcheckSource —— 本插件解析「engine-testcheck 提供方类」的唯一入口
 *
 * 为什么需要这一层：迁移前 `LoopEngine` 有**两条**对 TestCheck 的依赖，本次一起换掉：
 *
 *   ① `_getTestCheck()`：`new TestCheck({ storage, sseHub, skillDirectory })`（运行时自建）
 *      —— 插件不得静态 import `Server/TestCheck/`（架构守卫 R2），改成解析**类**再 new；
 *   ② `CheckStatus.ERROR` / `CheckStatus.IDLE` 三处 `===` 比较（F-22 的核心判据）
 *      —— 这是一张**模块级 `Object.freeze` 常量表**，不是实例能力面。它必须与提供方
 *      持有的那张是**同一个对象**，否则 `checkResult.status === CheckStatus.ERROR`
 *      永远为 false，F-22 的"审核出错 ≠ 审核不通过"整条语义静默失效。
 *
 * ── 常量表怎么跨插件交付：走**类静态属性**通道，不进 methods/properties ────────────
 * `CheckStatus` 是共享字面量表，写进契约的 `methods`/`properties` 会变成"实例上必须有
 * 这个成员"的假声明（`seams/engine-testcheck.js` 原本就写着这条判据）。因此：
 *
 *   - 提供方（`plugins/engines/testcheck/index.js`）把同一份冻结对象挂到类上：
 *         TestCheck.CheckStatus = CheckStatus;   // 同一对象，不是副本
 *   - 契约（`seams/engine-testcheck.js`）在 `constants` 字段声明它：
 *         constants: ['CheckStatus']
 *     语义：提供方注册的**类**上必须有这些**冻结常量表**属性，供消费者在**不 import
 *     提供方模块**的前提下读取状态字面量；
 *   - 消费者（本文件的 `requireFrozenConstants`）读取并**校验**：缺失 / 不是对象 /
 *     不是冻结常量表 → fail closed 并点名，**绝不**静默退回字符串字面量
 *     （退回字面量等于把"两张对象不同一"这个真实故障伪装成正常，那正是 F-22 失效的样子）；
 *   - `test/m9-contract-conformance` 对每个声明了 `constants` 的提供方断言
 *     「存在 + 是对象 + Object.isFrozen」，把这条交付通道变成可执行判定。
 *
 * ── 解析顺序（与 task book 逐档一致）──────────────────────────────────────────
 *     1. 构造入参显式注入的类（`new LoopEngine({ testCheckClass })`，测试/嵌入式）；
 *     2. **有活跃插件宿主**：走 `engine-testcheck` 接缝（`resolveSeamProvider`）；
 *     3. **无宿主**：用 `Server/LoopEngine/LoopEngine.js` 门面在 import 期登记的内置兜底
 *        （返回 `Server/TestCheck/index.js` 的 `TestCheck` 类——它与插件里的类是**同一对象**，
 *        因此静态属性必然在）；
 *     4. 三档都没有 → fail closed，文案点名缺哪条接缝 / 哪个登记函数。
 *
 * 注意第 1 档解析的是**类**而不是实例：`deps.testCheck`（现成实例）与常量表无关——
 * m3 的 F-22 用例注入的就是一个纯对象桩，它身上没有 `CheckStatus`。常量表必须来自
 * "谁的类"，而不是"谁的实例"。
 */

import { resolveSeamProvider } from '../../../../core/hostBridge.js';

/** 无宿主兜底：`() => TestCheckClass | Promise<TestCheckClass>`；由 Server 侧门面登记 */
let _fallbackLoader = null;

/**
 * 登记无宿主兜底（幂等取先登记的那一个，重复登记不覆盖）。
 *
 * 登记加载器而不是类：与 brain/testcheck 的同名文件同形状（门面在 import 期登记，
 * 重复 import 不覆盖已登记的实现）。
 *
 * @param {() => (Function | Promise<Function>)} loader - 返回内置 TestCheck 类的加载器
 */
export function setTestCheckFallback(loader) {
    if (typeof loader !== 'function') {
        throw new TypeError('setTestCheckFallback(loader)：loader 必须是函数');
    }
    _fallbackLoader ??= loader;
}

/** 清空兜底登记（仅测试/热替换用；正常部署不应调用）。 */
export function resetTestCheckFallback() {
    _fallbackLoader = null;
}

/**
 * 解析 `engine-testcheck` 的提供方**类**。
 *
 * @param {Function|null} [explicit=null] - 显式注入的类（`deps.testCheckClass`）
 * @returns {Promise<Function>} 具备 `runCheck` 的提供方类（`new` 出来的实例还要有 `CheckStatus` 表，见下）
 * @throws {Error} 三档都解析不到时
 */
export async function resolveTestCheckClass(explicit = null) {
    if (typeof explicit === 'function') return explicit;

    const fromHost = resolveSeamProvider('engine-testcheck');
    if (typeof fromHost === 'function') return fromHost;

    if (typeof _fallbackLoader === 'function') {
        const impl = await _fallbackLoader();
        if (typeof impl === 'function') return impl;
    }

    throw new Error(
        "engines/loopengine：无法解析 engine-testcheck 的提供方类 —— 既没有活跃插件宿主的 " +
            "'engine-testcheck' 接缝，也没有登记无宿主兜底。请三选一：加载提供 engine-testcheck " +
            '接缝的插件（plugins/engines/testcheck），或从门面 Server/LoopEngine/index.js 导入' +
            '（它会在 import 期登记内置实现），或显式注入 new LoopEngine({ testCheckClass })'
    );
}

/**
 * 读取并校验契约 `constants` 声明的**冻结常量表**（提供方类上的静态属性）。
 *
 * 三档都必须过：存在 → 是对象 → `Object.isFrozen`。缺一档就抛错点名，
 * **不退回字符串字面量**：退回字面量会让"两张对象不同一"这类真实故障静默通过，
 * 而 F-22（审核出错 ≠ 审核不通过）正是靠这三次 `===` 比较成立的。
 *
 * @param {Function|object} providerClass - 提供方类（接缝注册的那个）
 * @param {string[]} names - 契约 `constants` 字段声明的名字
 * @param {string} seamName - 接缝名（报错文案里点名）
 * @returns {Object<string, object>} name → 冻结常量表
 * @throws {Error} 缺失 / 不是对象 / 未冻结
 */
export function requireFrozenConstants(providerClass, names, seamName) {
    const tables = {};
    const absent = [];
    const malformed = [];

    for (const name of names) {
        const table = providerClass === null || providerClass === undefined ? undefined : providerClass[name];
        if (table === null || table === undefined) {
            absent.push(name);
        } else if (typeof table !== 'object' || !Object.isFrozen(table)) {
            malformed.push(`${name}（实际 ${typeof table} / Object.isFrozen=${Object.isFrozen(table)}）`);
        } else {
            tables[name] = table;
        }
    }

    if (absent.length > 0) {
        throw new Error(
            `engines/loopengine：${seamName} 的提供方类缺少 ${absent.join(', ')} 常量表 —— ` +
                '契约声明的 constants 未实现。提供方必须把**同一份**冻结常量表挂到类上' +
                `（plugins/engines/${seamName.replace(/^engine-/, '')}/index.js 里的静态属性赋值，` +
                '不得 structuredClone/重建，否则消费者的 === 比较会全部失效）。' +
                '请三选一：加载该提供方插件，或从门面 Server/LoopEngine/index.js 导入（它转发同一个类），' +
                '或显式注入 new LoopEngine({ testCheckClass })'
        );
    }
    if (malformed.length > 0) {
        throw new Error(
            `engines/loopengine：${seamName} 的提供方类上的常量表不是冻结常量表 —— ${malformed.join(', ')}。` +
                'constants 声明的是 Object.freeze 的常量字面量表；提供方必须原样挂同一份冻结对象，' +
                '不得重建/克隆，否则消费者读到的字面量与提供方的不同一'
        );
    }
    return tables;
}
