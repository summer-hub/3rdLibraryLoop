/**
 * plugins/agent/core/SkillSelector/llm/llmClient.js —— LLM 客户端的唯一解析入口（三档 + fail closed）
 *
 * 迁移前本文件是 `Server/Agent/SkillSelector/llm/llmClient.js`，内容只有两行
 * `export * from '<仓库根>/plugins/llm/dashscope/index.js'`（纯转发门面）。实现搬进
 * `plugins/agent/core/` 之后**不能**再那样写：架构守卫 R2 禁止跨插件 import，而
 * `plugins/llm/dashscope` 是另一条插件（`llm` 接缝的提供方）。于是本文件从"转发门面"
 * 变成"解析器"，形状与 `plugins/engines/brain/lib/llmSource.js` 逐档对齐：
 *
 *     1. **调用点显式注入** —— `new Agent({ llm })`，由 `core/Agent.js` 在构造期判断，
 *        永远最优先，本文件不参与（本文件只负责第 2~4 档）；
 *     2. **活跃宿主 `llm` 接缝** —— `createLlmFromHost(fallback)` 内部先问
 *        `resolveSeamProvider('llm')`（`core/hostBridge.js`），命中就直接用宿主提供的类
 *        （`plugins/llm/dashscope` 注册的是 `ConfiguredLLMClient`，已合并 profile 配置）；
 *     3. **门面登记的无宿主兜底** —— `Server/Agent/**` 门面在 import 期调用
 *        `setLlmFallback(() => LLMClient)` 登记加载器。登记**加载器**而不是类，是为了在
 *        无宿主时仍保持迁移前「第一次真正要用 LLM 才加载实现」的时机（不把 `openai`
 *        拖进"只想 new 一个 Agent"的模块图）；
 *     4. **三档都没有 → fail closed**，错误文案点名缺哪条来源、在哪登记、以及显式注入写法。
 *
 * 为什么第 2 档在 `createLlmFromHost` **里面**而不是外面：那是既有内核原语的语义
 * （`core/hostBridge.js`），照抄一次等于把"宿主优先于兜底"这条顺序复制成两份实现。因此
 * 只要拿到兜底类就交给 `createLlmFromHost`，顺序天然一致；只有兜底缺失（门面没被 import
 * 过）时才自己问宿主 —— 与 `brain/lib/llmSource.js` 第 3 档的原因完全相同。
 *
 * `nowCST` 那类无状态纯函数不在此列：已归一到内核 `core/cstTime.js`，本插件直接
 * `../../../../../core/cstTime.js` 引用（R2 允许插件引用 `core/`）。
 *
 * 导出面（消费者按此使用；**不再有 `LLMClient` 类**——类的归属是 `llm` 接缝的提供方）：
 *   setLlmFallback / resetLlmFallback / hasLlmFallback / resolveLlmClient
 */

import { createLlmFromHost, resolveSeamProvider } from '../../../../../core/hostBridge.js';

/** 无宿主兜底：`() => (LLMClient | Promise<LLMClient>)`；由 Server 侧门面登记 */
let _fallbackLoader = null;

/**
 * 登记无宿主兜底（幂等取**先登记**的那一个，重复登记不覆盖）。
 *
 * 取「先登记先赢」而不是「后登记覆盖」：门面在 import 期登记，宿主的接缝在第 2 档已经
 * 优先命中；这里若允许覆盖，宿主 dispose 之后仍指向一个已释放的宿主上下文，会把
 * 「无宿主」退化成「报错」。
 *
 * @param {() => (Function | Promise<Function>)} loader - 返回内置 LLM 客户端类/实例的加载器
 * @throws {TypeError} loader 不是函数时
 */
export function setLlmFallback(loader) {
    if (typeof loader !== 'function') {
        throw new TypeError('setLlmFallback(loader)：loader 必须是函数');
    }
    _fallbackLoader ??= loader;
}

/** 清空兜底登记（仅测试/热替换用；正常部署不应调用）。 */
export function resetLlmFallback() {
    _fallbackLoader = null;
}

/** @returns {boolean} 是否已登记无宿主兜底（不触发加载） */
export function hasLlmFallback() {
    return typeof _fallbackLoader === 'function';
}

/**
 * 解析一个可直接使用的 LLM 客户端实例。
 *
 * 无宿主时与迁移前的 `createLlmFromHost(LLMClient)` **同语义、同时机**：同一个类、
 * 同样无参 `new`、同样在第一次真正需要 LLM 时才加载。
 *
 * @returns {Promise<object>} LLM 客户端（具备 `chatJSON(prompt, options)`）
 * @throws {Error} 既无活跃宿主的 `llm` 接缝，也无已登记的无宿主兜底时
 */
export async function resolveLlmClient() {
    const fallback = typeof _fallbackLoader === 'function' ? await _fallbackLoader() : null;
    if (typeof fallback === 'function') {
        // 桥内部顺序就是「宿主 llm 接缝 → 兜底类」，与迁移前 createLlmFromHost(LLMClient) 等价
        return createLlmFromHost(fallback);
    }

    // 门面没被 import 过，但有活跃宿主：直接取接缝提供方（同一容忍策略：类就 new，实例原样用）
    const provider = resolveSeamProvider('llm');
    if (provider !== null && provider !== undefined) {
        return typeof provider === 'function' ? new provider() : provider;
    }

    throw new Error(
        "plugins/agent/core（agent-skill-selector）：无法解析 LLM 客户端 —— " +
            "既没有活跃插件宿主的 'llm' 接缝，也没有登记无宿主兜底。请三选一：" +
            '加载提供 llm 接缝的插件（plugins/llm/*，profile 里默认是 llm/dashscope），' +
            '或从门面 Server/Agent/SkillSelector/llm/llmClient.js 导入（它会在 import 期登记内置实现），' +
            '或显式注入 new Agent({ llm })'
    );
}

export default resolveLlmClient;
