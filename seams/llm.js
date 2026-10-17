/**
 * seams/llm.js — 大语言模型提供方契约（能力接缝）
 *
 * Provider：`plugins/llm/dashscope`（百炼 OpenAI 兼容）、`plugins/llm/mock`（测试），
 *           未来可插 OpenAI / Anthropic / Ollama / vLLM……
 * Consumer：SkillSelector（任务分析/排序）、Brain、TestCheck。
 *
 * 提供方注册的服务是**类**（消费者自行决定单例或每调用一实例）：
 *     ctx.provide('llm', LLMClient);
 *
 * 契约要点：
 *   - `chat(prompt, opts)` 返回纯文本；`chatJSON(prompt, opts)` 返回解析后的对象；
 *   - 容错（重试/退避/熔断/JSON 剥离）是**提供方职责**，消费者只发请求；
 *   - 配置（endpoint/model/apiKey/fallbackModel）经插件 options 注入，
 *     缺省值从现有环境变量反推（DASHSCOPE_API_KEY / LLM_BASE_URL / LLM_MODEL）。
 */

export const LLM_SEAM = Object.freeze({
    name: 'llm',
    version: 1,
    factory: false,
    description: '大语言模型提供方：chat / chatJSON，容错与降级由提供方负责',
    /** 工厂/构造入参 */
    options: Object.freeze([
        'apiKey',
        'baseUrl',
        'model',
        'temperature',
        'maxTokens',
        'enableThinking',
        'fallbackModel',
        'requestTimeoutMs',
    ]),
    /** 提供方实例必须实现的方法 */
    methods: Object.freeze(['chat', 'chatJSON']),
    /** chatJSON 的参数约定（opts.maxTokens 等与 chat 一致） */
    jsonContract: Object.freeze({
        note: 'chatJSON 必须返回解析后的对象；解析失败按提供方策略重试或抛错',
    }),
});

export default LLM_SEAM;
