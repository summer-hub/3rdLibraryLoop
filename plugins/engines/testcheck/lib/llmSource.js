/**
 * llmSource —— 本插件解析 LLM 客户端的唯一入口（接缝优先，门面兜底）
 *
 * 为什么需要这一层：迁移前 `TestCheck` 直接
 * `import { LLMClient } from '../Agent/SkillSelector/llm/llmClient.js'` +
 * `createLlmFromHost(LLMClient)`。那条相对路径在插件里非法（R2 禁止插件引用 `Server/`），
 * 而 `Server/Agent/SkillSelector/llm/llmClient.js` 现在是 `plugins/llm/dashscope` 的转发门面。
 * 插件又不得跨插件 import，因此解析顺序为：
 *
 *     1. 调用方显式注入（`new TestCheck({ llm })`）—— 在 TestCheck 里判断，永远最优先；
 *     2. `Server/TestCheck/TestCheck.js` 门面在 import 期登记的内置兜底（登记**加载器**，
 *        返回 LLMClient 类）；有宿主时 `createLlmFromHost(fallback)` 会先取 `llm` 接缝，
 *        无宿主时才用这个类——与迁移前的 `createLlmFromHost(LLMClient)` **同语义、同时机**
 *        （同一个类、同样无参 new）；
 *     3. 有宿主但门面没被 import 过：直接取 `llm` 接缝的提供方并实例化（同样的
 *        "类 or 实例"容忍策略）；
 *     4. 三档都没有 → fail closed，错误信息点名缺哪条接缝 / 哪个登记函数。
 *
 * 为什么不在这里再复制一份 LLMClient：它有真实三方依赖（openai SDK）、连接与限流状态、
 * 熔断器，属于 `llm` 接缝的提供方（`plugins/llm/dashscope`）的事。插件只需要"拿到一个
 * `chatJSON()` 可用的对象"，兜底类由装配层（Server 侧门面）登记才是正确归属。
 */

import { createLlmFromHost, resolveSeamProvider } from '../../../../core/hostBridge.js';

/** 无宿主兜底：`() => LLMClient | Promise<LLMClient>`；由 Server 侧门面登记 */
let _fallbackLoader = null;

/**
 * 登记无宿主兜底（幂等取先登记的那一个，重复登记不覆盖）。
 *
 * @param {() => (Function | Promise<Function>)} loader - 返回内置 LLM 客户端类的加载器
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

/**
 * 解析一个可直接使用的 LLM 客户端实例。
 *
 * @returns {Promise<object>} LLM 客户端（具备 `chatJSON(prompt, options)`）
 * @throws {Error} 既没有活跃宿主的 `llm` 接缝，也没有登记兜底时
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
        "engines/testcheck：无法解析 LLM 客户端 —— 既没有活跃插件宿主的 'llm' 接缝，" +
            '也没有登记无宿主兜底。请二选一：加载提供 llm 接缝的插件（plugins/llm/*），' +
            '或从门面 Server/TestCheck/TestCheck.js 导入（它会在 import 期登记内置实现），' +
            '或显式注入 new TestCheck({ llm })'
    );
}
