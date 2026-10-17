/**
 * plugins/llm/dashscope/index.js — `llm` 接缝提供方：百炼 / DashScope（OpenAI 兼容模式）
 *
 * 契约见 `seams/llm.js`：setup 内 `ctx.provide('llm', <类>)` 注册的是**类**，
 * 消费者自行决定单例还是每调用一实例（`new (host.inject('llm'))(opts)`）。
 *
 * 配置优先级（高 → 低）：
 *   1. `new ConfiguredLLMClient(perCallOptions)` 的显式入参
 *   2. 本插件 `ctx.config`（definePlugin 默认 config ← profile plugins.<name>.options 覆盖）
 *   3. 既有环境变量（DASHSCOPE_API_KEY / LLM_BASE_URL / LLM_MODEL / FALLBACK_MODEL / LLM_TEMPERATURE …）
 * 不引入新的必填环境变量：config 全部项缺省为 undefined，未配置时行为与迁移前等价。
 *
 * 容错（重试/退避/熔断/准入/JSON 剥离）全在同目录 llmClient.js；本文件只做配置合并与接缝注册，
 * 进程级共享熔断器/限流器仍是那个模块里的模块级单例，语义不变。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import { LLMClient } from './llmClient.js';

export * from './llmClient.js';

/** 接缝选项名 → 实现构造参数名（契约写 baseUrl，openai SDK 写 baseURL） */
const OPTION_ALIASES = Object.freeze({ baseUrl: 'baseURL' });

/** 接缝选项名归一（`baseUrl` → 实现的 `baseURL`）；显式入参与 ctx.config 都要过一遍 */
function _normalizeOptions(options) {
    const out = { ...options };
    for (const [from, to] of Object.entries(OPTION_ALIASES)) {
        if (out[to] === undefined && out[from] !== undefined) out[to] = out[from];
    }
    return out;
}

/**
 * 把插件配置作为默认值并入构造入参：显式入参优先，未指定的项保持 undefined，
 * 好让实现体继续回落到原有的环境变量读取逻辑。
 */
function _withConfigDefaults(config, options) {
    const out = _normalizeOptions(options);
    for (const [key, value] of Object.entries(config ?? {})) {
        if (value === undefined || value === null) continue;
        const target = OPTION_ALIASES[key] ?? key;
        if (out[target] === undefined) out[target] = value;
    }
    return out;
}

export default definePlugin({
    name: 'llm/dashscope',
    version: '1.0.0',
    seam: 'llm',
    /**
     * 默认配置：所有项留空（undefined）= 沿用实现体原有的环境变量读取方式。
     * 键名逐一列出，既说明 profile options 可覆盖哪些项，也让 ctx.config 的形状可预期
     * （与 seams/llm.js 的 options 清单一一对应）。
     */
    config: {
        apiKey: undefined,
        baseUrl: undefined,
        model: undefined,
        temperature: undefined,
        maxTokens: undefined,
        enableThinking: undefined,
        fallbackModel: undefined,
        requestTimeoutMs: undefined,
    },
    setup(ctx) {
        const defaults = ctx.config ?? {};

        /** 该提供方的 LLM 客户端：显式入参 > ctx.config > 环境变量 */
        class ConfiguredLLMClient extends LLMClient {
            constructor(options = {}) {
                super(_withConfigDefaults(defaults, options));
            }
        }

        // 注册的是**类**（接缝契约），消费者自行 new；服务回收由 ctx.provide
        // 自动登记的 disposer 负责（见 core/Context.js provide），故 setup 无需返回值。
        ctx.provide('llm', ConfiguredLLMClient);
    },
});
