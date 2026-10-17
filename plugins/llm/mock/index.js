/**
 * plugins/llm/mock/index.js — `llm` 接缝提供方：确定性、零网络的测试替身
 *
 * 用途：提供方切换实验（profiles/mock-llm.json 用 `llm/mock` 顶替 `llm/dashscope`），
 * 让"换提供方不改消费者"真的能被跑一遍，且不消耗额度、不触网。
 *
 * 确定性契约：
 *   - chat(prompt)     → 缺省回显 prompt 首行（前缀 `[mock] `），可由 config.chatReply 固定；
 *   - chatJSON(prompt) → 缺省 `{ ok: true, echoes: <prompt 前 40 字> }`，可由 config.chatJSONReply 固定。
 * 相同输入永远得到相同输出；不打网络、不读环境变量、除 `node:` 外不 import 任何包。
 */

import { definePlugin } from '../../../core/definePlugin.js';

/** chat 的缺省回显：prompt 首行（去首尾空白） */
function _firstLine(prompt) {
    const text = String(prompt ?? '');
    const line = text.split(/\r?\n/, 1)[0] ?? '';
    return line.trim();
}

/** 把 config 作为默认值、显式入参作为覆盖（undefined 不覆盖） */
function _merge(defaults, options) {
    const out = { ...defaults };
    for (const [key, value] of Object.entries(options ?? {})) {
        if (value !== undefined) out[key] = value;
    }
    return out;
}

export class MockLLMClient {
    constructor(options = {}) {
        this.config = { ...options };
    }

    async chat(prompt) {
        if (typeof this.config.chatReply === 'string') return this.config.chatReply;
        return `[mock] ${_firstLine(prompt)}`;
    }

    async chatJSON(prompt) {
        const fixed = this.config.chatJSONReply;
        if (fixed && typeof fixed === 'object' && !Array.isArray(fixed)) return structuredClone(fixed);
        return { ok: true, echoes: String(prompt ?? '').slice(0, 40) };
    }
}

export default definePlugin({
    name: 'llm/mock',
    version: '1.0.0',
    seam: 'llm',
    /** 默认配置全部留空：缺省行为即"从 prompt 派生"的确定性返回值 */
    config: {
        chatReply: undefined,
        chatJSONReply: undefined,
    },
    setup(ctx) {
        const defaults = ctx.config ?? {};

        class ConfiguredMockLLMClient extends MockLLMClient {
            constructor(options = {}) {
                super(_merge(defaults, options));
            }
        }

        ctx.provide('llm', ConfiguredMockLLMClient);
    },
});
