/**
 * llmClient.js — LLM 客户端封装（百炼 / DashScope OpenAI 兼容模式）
 *
 * 职责：
 *   - 封装对 glm-5.2（经百炼兼容端点）的调用
 *   - 统一强制 JSON 输出，并对返回做容错解析（剥离 code fence / try-catch）
 *   - 从环境变量读取配置（DASHSCOPE_API_KEY / LLM_BASE_URL / LLM_MODEL）
 *   - 429/529/网络抖动 错误恢复：指数退避 + 抖动重试，连续 529 切换备用模型
 *
 * 错误恢复策略（参考 learn-claude-code s11_error_recovery）：
 *   - 429 限流 / 529 过载 / 网络抖动 → 指数退避 + 抖动，最多 10 次重试
 *   - 退避公式：min(500 × 2^attempt, 32000) + random(0~25%) 毫秒
 *   - 连续 3 次 529 → 切换 FALLBACK_MODEL（若配置）
 *   - 服务器返回 Retry-After header 时优先使用该值
 *
 * 设计原则：
 *   - 高内聚：所有 LLM 调用、JSON 容错、错误恢复集中于此
 *   - 低耦合：不依赖 Agent / skillScanner / fuzzyMatcher，只暴露 chat / chatJSON
 *   - 可测试：构造函数允许注入自定义 client（mock openai 实例）
 */

import { OpenAI } from 'openai';

// ─── 错误恢复常量（参考 code.py 第 53-58 行）──────────────────────────────────
const MAX_RETRIES = 10;            // 最大重试次数
const BASE_DELAY_MS = 500;          // 基础退避延迟（毫秒）
const MAX_CONSECUTIVE_529 = 3;     // 连续 529 次数阈值，达到后切换备用模型

/**
 * LLM 客户端
 */
export class LLMClient {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]         - 百炼 API Key，默认读 process.env.DASHSCOPE_API_KEY
   * @param {string} [options.baseURL]        - 兼容端点，默认读 process.env.LLM_BASE_URL
   * @param {string} [options.model]          - 模型名，默认读 process.env.LLM_MODEL 或 'glm-5.2'
   * @param {number} [options.temperature]    - 默认读 process.env.LLM_TEMPERATURE 或 0.2
   * @param {number} [options.maxTokens]      - 默认读 process.env.LLM_MAX_TOKENS 或 2048
   * @param {string} [options.fallbackModel]  - 备用模型名，默认读 process.env.FALLBACK_MODEL
   * @param {OpenAI}  [options.client]        - 注入自定义 openai 实例（用于测试）
   */
  constructor(options = {}) {
    const apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY || '';
    const baseURL = options.baseURL || process.env.LLM_BASE_URL
      || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

    if (!apiKey) {
      console.warn('[LLMClient] 未配置 DASHSCOPE_API_KEY，LLM 调用将失败');
    }

    this.model = options.model || process.env.LLM_MODEL || 'glm-5.2';
    this.fallbackModel = options.fallbackModel || process.env.FALLBACK_MODEL || '';
    this.temperature = options.temperature ?? _envFloat('LLM_TEMPERATURE', 0.2);
    this.maxTokens = options.maxTokens ?? _envInt('LLM_MAX_TOKENS', 2048);
    // GLM 系列默认开启思考模式（会显著增加延迟）；这两个 ReAct 步骤无需深度思考，默认关闭
    this.enableThinking = options.enableThinking ?? _envBool('LLM_ENABLE_THINKING', false);

    // 允许注入 mock client 做单测；否则按真实配置 new 一个
    this.client = options.client || new OpenAI({ apiKey, baseURL });
  }

  /**
   * 发起一次 chat 调用，返回纯文本内容
   * 内部通过 _withRetry 包裹，自动处理 429/529/网络抖动的指数退避重试
   * @param {string} prompt - 用户 prompt
   * @param {object} [overrides] - { model, temperature, maxTokens }
   * @returns {Promise<string>}
   */
  async chat(prompt, overrides = {}) {
    const temperature = overrides.temperature ?? this.temperature;
    const maxTokens = overrides.maxTokens ?? this.maxTokens;

    // 将实际 API 调用封装为函数，交给 _withRetry 包裹
    const callApi = async (currentModel) => {
      const reqParams = {
        model: overrides.model || currentModel,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
      };
      // GLM 系列思考模式开关（enable_thinking 非标准参数，作为顶层参数透传）
      const enableThinking = overrides.enableThinking ?? this.enableThinking;
      if (enableThinking !== undefined) {
        reqParams.enable_thinking = enableThinking;
      }
      const resp = await this.client.chat.completions.create(reqParams);

      // OpenAI 兼容格式：choices[0].message.content
      const content = resp?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('LLMClient: 模型返回内容为空');
      }
      return content;
    };

    return this._withRetry(callApi);
  }

  /**
   * 发起一次 chat 调用并解析为 JSON 对象
   * 强制要求 JSON 输出，并做容错：
   *   - 剥离 ```json / ``` 代码围栏
   *   - 截取首个 { 到末尾 } 的子串
   *   - 失败时抛出明确错误
   * @param {string} prompt
   * @param {object} [overrides]
   * @returns {Promise<object>}
   */
  async chatJSON(prompt, overrides = {}) {
    const raw = await this.chat(prompt, overrides);
    const cleaned = _extractJSON(raw);
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      const preview = raw.length > 300 ? raw.slice(0, 300) + '...' : raw;
      throw new Error(`LLMClient: JSON 解析失败（${err.message}）。原始内容：${preview}`);
    }
  }

  // ─── 错误恢复：指数退避重试（参考 code.py 的 with_retry）──────────────────────

  /**
   * 包裹一个 LLM 调用函数，遇到 429/529/网络抖动时自动重试
   *
   * 策略：
   *   - 429 限流：指数退避 + 抖动重试
   *   - 529 过载：指数退避 + 抖动重试，连续 MAX_CONSECUTIVE_529 次后切换备用模型
   *   - 网络抖动：指数退避 + 抖动重试
   *   - 非瞬态错误：直接抛出，不重试
   *   - 服务器返回 Retry-After header 时优先使用该值
   *
   * @param {(model: string) => Promise<string>} fn - 接收当前模型名，返回 LLM 响应文本
   * @returns {Promise<string>}
   * @private
   */
  async _withRetry(fn) {
    let consecutive529 = 0;
    let currentModel = this.model;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await fn(currentModel);
        consecutive529 = 0; // 成功则重置 529 计数
        return result;
      } catch (err) {
        const errorInfo = isTransientError(err);

        // 非瞬态错误（如 400/401/403），直接抛出，不重试
        if (!errorInfo) {
          throw err;
        }

        // 529 过载：累加计数，达到阈值则切换备用模型
        if (errorInfo.is529) {
          consecutive529++;
          if (consecutive529 >= MAX_CONSECUTIVE_529 && this.fallbackModel) {
            currentModel = this.fallbackModel;
            consecutive529 = 0;
            console.warn(`[LLMClient] 连续 ${MAX_CONSECUTIVE_529} 次 529 过载，切换到备用模型 ${currentModel}`);
          }
        }

        // 指数退避 + 抖动；服务器 Retry-After header 优先
        const retryAfterMs = _parseRetryAfterMs(err);
        const delayMs = retryDelay(attempt, retryAfterMs);
        console.warn(
          `[LLMClient] ${errorInfo.type} 错误，第 ${attempt + 1}/${MAX_RETRIES} 次重试，` +
          `等待 ${(delayMs / 1000).toFixed(1)}s`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(`LLMClient: 重试 ${MAX_RETRIES} 次后仍失败`);
  }
}

// ─── 错误恢复工具函数（参考 code.py 的 retry_delay / is_transient）──────────────

/**
 * 计算指数退避延迟（含抖动）
 *
 * 公式（参考 code.py 第 178-182 行）：
 *   base = min(500 × 2^attempt, 32000)
 *   delay = base + random(0 ~ base × 0.25)
 *
 * 服务器返回 Retry-After 时优先使用该值。
 *
 * @param {number} attempt - 当前重试次数（0 起算）
 * @param {number|null} [retryAfterMs] - 服务器 Retry-After header 转换的毫秒数
 * @returns {number} 延迟毫秒数
 */
export function retryDelay(attempt, retryAfterMs = null) {
  if (retryAfterMs) return retryAfterMs; // 服务器 Retry-After 优先
  const base = Math.min(BASE_DELAY_MS * (2 ** attempt), 32000);
  const jitter = Math.random() * base * 0.25;
  return base + jitter;
}

/**
 * 判断错误是否为瞬态错误（429/529/网络抖动）
 *
 * 识别方式（参考 code.py 第 194-221 行）：
 *   - openai SDK 的错误对象有 status 属性（见 node_modules/openai/error.js）
 *   - 429 → RateLimitError，error.status === 429
 *   - 529 → InternalServerError（status >= 500），error.status === 529
 *   - 网络抖动 → APIConnectionError / APIConnectionTimeoutError
 *
 * @param {Error} err
 * @returns {{type: string, is529: boolean}|null} 瞬态错误信息，非瞬态返回 null
 */
export function isTransientError(err) {
  const status = err?.status;
  const name = (err?.constructor?.name || '').toLowerCase();
  const msg = (err?.message || '').toLowerCase();

  // 429 限流
  if (status === 429 || name.includes('ratelimit') || msg.includes('429')) {
    return { type: '429', is529: false };
  }

  // 529 过载
  if (
    status === 529 ||
    name.includes('overloaded') ||
    msg.includes('529') ||
    msg.includes('overloaded')
  ) {
    return { type: '529', is529: true };
  }

  // 网络抖动（连接错误、超时）
  if (
    name.includes('connection') ||
    name.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout')
  ) {
    return { type: 'network', is529: false };
  }

  return null; // 非瞬态错误
}

/**
 * 从错误对象的 headers 中解析 Retry-After 值（转毫秒）
 * @param {Error} err
 * @returns {number|null}
 * @private
 */
function _parseRetryAfterMs(err) {
  const headers = err?.headers || err?.response?.headers;
  if (!headers) return null;

  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  if (!retryAfter) return null;

  // Retry-After 可能是秒数（如 "120"）或 HTTP 日期
  const seconds = parseInt(retryAfter, 10);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────

/** 从 LLM 返回文本中提取 JSON 串（剥离 code fence、截取首尾大括号） */
function _extractJSON(raw) {
  let s = raw.trim();

  // 剥离 ```json ... ``` 或 ``` ... ``` 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 截取首个 { 到最后一个 }（容错 LLM 在 JSON 前后加了说明文字）
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  return s;
}

function _envFloat(key, def) {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function _envInt(key, def) {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function _envBool(key, def) {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export default LLMClient;
