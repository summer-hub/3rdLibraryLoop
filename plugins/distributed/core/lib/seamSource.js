/**
 * plugins/distributed/core/lib/seamSource.js —— 分布式能力的**唯一解析入口**（三条解析链）
 *
 * 为什么需要这一层：`plugins/distributed/core` 把四条接缝（`distributed-lease` / `-queue` /
 * `-tokens` / `-observer`）注册给宿主，但**本插件自己不消费它们**——真正要消费的是别处的装配
 * （未来的编排/服务装配插件、`Server/**` 门面链上的调用方）。插件之间不得互相 import（R2），
 * 所以"拿到一个可用的分布式能力"这件事必须有一个**唯一的解析入口**，否则每个消费者都会
 * 抄一份"先问宿主、再兜底"的顺序，两份顺序迟早不一致（`plugins/agent/core/lib/llmClient.js`
 * 与 `plugins/engines/brain/lib/llmSource.js` 都踩过这个坑，结论一致：顺序只写一份）。
 *
 * 解析顺序（宿主优先，与 `llm` / `app-logger` 同形）：
 *
 *   1. **宿主接缝** —— `resolveSeamProvider(name)`（`core/hostBridge.js`）：有活跃宿主且宿主
 *      注册了该接缝，就用宿主给的提供方。这是"换提供方不改消费者"成立的地方：
 *      部署把 `distributed-lease` 换成自家实现后，这里立刻拿到新的；
 *   2. **门面登记的无宿主兜底** —— `Server/Distributed/**` 门面在 import 期调用
 *      `setDistributedFallbacks({...})`，登记的是**加载器**（`() => Promise<类>`），
 *      保持"用到才解析"的时机。无宿主的默认部署形态（m7 f39/f40/f41 就是这种）靠这一档，
 *      行为与迁移前逐字节等价（同一批模块实例）；
 *   3. **都没有 → fail closed**，文案点名缺哪条接缝、怎么补、以及显式注入的写法。
 *
 * 为什么第 3 档必须抛而不是返回 undefined：`new undefined()` 会在调用点以毫无信息量的方式
 * 炸掉，而"宿主在、但没启用 distributed/core"是最常见的配置错误——必须一句话说清。
 *
 * 为什么门面兜底是"表"而不是四个 `setXxxFallback` 函数：四条接缝的提供方住在**同一个插件**
 * 里（`ctx.provide` 四连），登记也就同一批；四份几乎相同的函数只会让"漏登记一条"变成
 * 低级却难查的缺陷。这里用 `{ seam: loader }` 表 + 逐条登记，漏了哪条由下面的文案点名。
 */

import { resolveSeamProvider } from '../../../../core/hostBridge.js';

/**
 * 本插件提供的四条接缝名（与 `plugins/distributed/core/index.js` 的 `setup` 一一对应）。
 * `Object.freeze` + 数组（不是 Set）：契约/测试要能按顺序打印，且不允许运行期增删。
 */
export const DISTRIBUTED_SEAMS = Object.freeze([
    'distributed-lease',
    'distributed-queue',
    'distributed-tokens',
    'distributed-observer',
]);

/** 无宿主兜底：`seam → () => provider | Promise<provider>`；由 Server 侧门面登记 */
const _fallbacks = new Map();

/**
 * 登记一条无宿主兜底（幂等：先登记先赢，重复登记不覆盖）。
 *
 * 取「先登记先赢」而不是「后登记覆盖」：多个门面都会登记（`Server/Distributed/*.js` 每一个
 * 都在 import 期登记整张表），正常部署下它们指向**同一批模块实例**，重复登记无副作用；
 * 若允许覆盖，热替换时会出现"最后被 import 的门面决定实现"这种不可诊断的时序依赖。
 *
 * @param {string} seam - 接缝名（必须是 `DISTRIBUTED_SEAMS` 之一）
 * @param {() => (Function | object | Promise<Function|object>)} loader - 返回提供方的加载器
 * @throws {TypeError} seam 未知或 loader 不是函数时
 */
export function setDistributedFallback(seam, loader) {
    if (!DISTRIBUTED_SEAMS.includes(seam)) {
        throw new TypeError(
            `setDistributedFallback(seam, loader)：未知接缝 ${JSON.stringify(seam)}；` +
            `可选值为 ${DISTRIBUTED_SEAMS.join('、')}`
        );
    }
    if (typeof loader !== 'function') {
        throw new TypeError(`setDistributedFallback('${seam}', loader)：loader 必须是函数`);
    }
    if (!_fallbacks.has(seam)) _fallbacks.set(seam, loader);
}

/**
 * 成批登记（门面侧的便捷入口；逐条转调 `setDistributedFallback`，语义完全相同）。
 * @param {Record<string, () => (Function | object | Promise<Function|object>)} table
 */
export function setDistributedFallbacks(table) {
    for (const [seam, loader] of Object.entries(table ?? {})) {
        setDistributedFallback(seam, loader);
    }
}

/** 清空兜底登记（仅测试/热替换用；正常部署不应调用）。 */
export function resetDistributedFallbacks() {
    _fallbacks.clear();
}

/** @param {string} seam @returns {boolean} 是否已登记该接缝的无宿主兜底（不触发加载） */
export function hasDistributedFallback(seam) {
    return _fallbacks.has(seam);
}

/**
 * 构造缺兜底时的错误（文案点名接缝、缺哪一档、三条补法）。
 * @param {string} seam
 * @returns {Error}
 */
function _missingProvider(seam) {
    return new Error(
        `plugins/distributed/core（${seam}）：无法解析分布式能力 —— ` +
            '既没有活跃插件宿主提供的该接缝（没有宿主，或宿主没有启用 plugins/distributed/core），' +
            '也没有登记无宿主兜底。请三选一：' +
            '① 在 profile 里启用 "distributed/core": { "enabled": true }（它会 provide 四条接缝），' +
            '② 从门面 Server/Distributed/** 任一文件导入（它在 import 期登记内置实现），' +
            '③ 由调用方显式注入提供方（例如 new LeaseStore({ backend })）'
    );
}

/**
 * 解析一条分布式能力的提供方（宿主优先 → 门面兜底 → fail closed）。
 *
 * 返回的是提供方**本体**（类/对象），不是实例：四条接缝的注册形状都是"类"，
 * 调用方按 `new (await resolveDistributedProvider('distributed-lease'))(opts)` 使用——
 * 这一层不替消费者决定构造入参（`backend` / `limit` / `sampleRate` 都是装配知识）。
 *
 * @param {string} seam - 接缝名（必须是 `DISTRIBUTED_SEAMS` 之一）
 * @returns {Promise<Function|object>} 提供方本体
 * @throws {TypeError} seam 未知时
 * @throws {Error} 两档都解析不到时（文案见 `_missingProvider`）
 */
export async function resolveDistributedProvider(seam) {
    if (!DISTRIBUTED_SEAMS.includes(seam)) {
        throw new TypeError(
            `resolveDistributedProvider(seam)：未知接缝 ${JSON.stringify(seam)}；` +
            `可选值为 ${DISTRIBUTED_SEAMS.join('、')}`
        );
    }

    const fromHost = resolveSeamProvider(seam);
    if (fromHost !== null && fromHost !== undefined) return fromHost;

    const loader = _fallbacks.get(seam);
    if (typeof loader === 'function') {
        const provider = await loader();
        if (provider !== null && provider !== undefined) return provider;
        throw new Error(
            `plugins/distributed/core（${seam}）：已登记的兜底加载器返回了空值（null/undefined）—— ` +
            '加载器必须返回提供方本体（类或对象）；请检查 Server/Distributed/internal/registerDistributedFallback.js'
        );
    }

    throw _missingProvider(seam);
}

export default resolveDistributedProvider;
