/**
 * llmClient.js — LLM 客户端封装（百炼 / DashScope OpenAI 兼容模式）
 *
 * 职责：
 *   - 封装对 glm-5.2（经百炼兼容端点）的调用
 *   - 统一强制 JSON 输出，并对返回做容错解析（剥离 code fence / try-catch）
 *   - 从环境变量读取配置（DASHSCOPE_API_KEY / LLM_BASE_URL / LLM_MODEL）
 *   - 429/529/网络抖动 错误恢复：指数退避 + 抖动重试，连续 529 切换备用模型
 *
 * 错误恢复策略：
 *   - 429 限流 / 529 过载 / 网络抖动 → 指数退避 + 抖动，最多 10 次重试
 *   - 退避公式：min(500 × 2^attempt, 32000) + random(0~25%) 毫秒
 *   - 连续 3 次 529 → 切换 FALLBACK_MODEL（若配置）
 *   - 服务器返回 Retry-After header 时优先使用该值
 *
 * F-21 增强（本文件的核心变化）：
 *   初版的问题不是"没有重试"，而是**重试是每个调用各自为政的**：
 *     - 529 降级用的 `currentModel` 是 `_withRetry` 的**局部变量**，
 *       等价于"每个调用自带一个熔断器"；N 路并发遇到供应商过载时，
 *       会各自独立重试 10 次 → 把过载从"短暂抖动"放大成"重试风暴"。
 *     - 没有并发上限/QPS 限制：一次大 fan-out 会瞬间打出 N×2 个 LLM 请求。
 *     - `chatJSON` 解析失败直接抛错、不重试 → 一次坏 JSON 吃掉一整轮大循环。
 *     - 未启用 `response_format: json_object`，模型自由发挥导致解析失败率偏高。
 *   现在：
 *     1. **进程级共享熔断器**（closed / open / half-open 三态）：连续瞬态失败达阈值
 *        即全局快速失败，过冷却期后半开放行探测——并发调用共享同一状态，
 *        因此重试次数从 O(N) 收敛到 O(1)（探测）。
 *     2. **进程级准入**：并发上限（默认 8）+ 可选 QPS 令牌桶，超出的调用排队而非
 *        直接打向供应商；且**在取到槽位后才消耗重试预算**。
 *     3. `chatJSON` 启用 `response_format: json_object`，并在供应商不支持时
 *        **自动降级**（记住该选择，避免每次都白撞一次 400）。
 *     4. JSON 解析失败计入可重试（有上限），不再是"一次失败吃掉一轮"。
 *
 * 设计原则：
 *   - 高内聚：所有 LLM 调用、JSON 容错、错误恢复集中于此
 *   - 低耦合：不依赖 Agent / skillScanner / fuzzyMatcher，只暴露 chat / chatJSON
 *   - 可测试：构造函数允许注入自定义 client（mock openai 实例）；
 *     熔断器与限流器可从模块导入并单独单测
 */

import { OpenAI } from 'openai';

// ─── 错误恢复常量 ────────────────────────────────────────────────────────────
const MAX_RETRIES = 10;            // 最大重试次数
const BASE_DELAY_MS = 500;          // 基础退避延迟（毫秒）
const MAX_CONSECUTIVE_529 = 3;     // 连续 529 次数阈值，达到后切换备用模型

// ─── F-21 新增：熔断 / 准入 / JSON 容错 配置 ─────────────────────────────────
const DEFAULT_CIRCUIT_FAIL_THRESHOLD = 5;      // 连续瞬态失败达此值即熔断
const DEFAULT_CIRCUIT_OPEN_MS = 30000;         // 熔断持续时长
const DEFAULT_CIRCUIT_HALF_OPEN_MAX = 1;       // 半开态允许的探测并发数
const DEFAULT_MAX_CONCURRENCY = 8;             // 进程级 LLM 并发上限
const DEFAULT_MAX_QPS = 0;                     // 令牌桶速率（0=不限）
const DEFAULT_JSON_PARSE_RETRIES = 2;          // JSON 解析失败的重试次数

function _envNum(key, def) {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * CircuitBreaker —— 进程级共享熔断器（三态状态机）。
 *
 * 状态：
 *   closed    —— 正常放行
 *   open      —— 全局快速失败，直到冷却期结束
 *   half-open —— 放行至多 halfOpenMax 个探测请求；任一成功即回到 closed，
 *                任一失败立即回到 open（并重置冷却计时）
 *
 * 为什么必须"进程级共享"：并发调用若各自维护状态，过载时 N 路会同时
 * 判定"我要重试"，把供应商从过载推向彻底不可用。共享状态使重试从 O(N)
 * 收敛为"失败阈值 + 半开探测"的 O(1) 量级。
 */
export class CircuitBreaker {
  /**
   * @param {object} [opts]
   * @param {number} [opts.failureThreshold] - 连续瞬态失败阈值
   * @param {number} [opts.openMs]           - 熔断持续时长（ms）
   * @param {number} [opts.halfOpenMax]      - 半开态允许的探测并发数
   */
  constructor(opts = {}) {
    this.failureThreshold = opts.failureThreshold ?? DEFAULT_CIRCUIT_FAIL_THRESHOLD;
    this.openMs = opts.openMs ?? DEFAULT_CIRCUIT_OPEN_MS;
    this.halfOpenMax = opts.halfOpenMax ?? DEFAULT_CIRCUIT_HALF_OPEN_MAX;
    this._failures = 0;
    this._openedAt = 0;
    this._halfOpenInFlight = 0;
    this._state = 'closed';
    /** 累计统计（可观测性/测试） */
    this.totalOpened = 0;
    this.totalShortCircuited = 0;
  }

  get state() { return this._state; }
  get failures() { return this._failures; }

  /** 计算状态（把冷却到期自动转为 half-open） */
  _refresh() {
    if (this._state === 'open' && Date.now() - this._openedAt >= this.openMs) {
      this._state = 'half-open';
      this._halfOpenInFlight = 0;
    }
    return this._state;
  }

  /**
   * 询问是否可放行本次调用。
   * @returns {{ok: boolean, state: string, retryAfterMs?: number}}
   */
  canAttempt() {
    const state = this._refresh();
    if (state === 'closed') return { ok: true, state };
    if (state === 'open') {
      this.totalShortCircuited++;
      return {
        ok: false,
        state,
        retryAfterMs: Math.max(0, this.openMs - (Date.now() - this._openedAt)),
      };
    }
    // half-open：只放行有限探测
    if (this._halfOpenInFlight < this.halfOpenMax) {
      this._halfOpenInFlight++;
      return { ok: true, state };
    }
    this.totalShortCircuited++;
    return { ok: false, state, retryAfterMs: 200 };
  }

  /** 记录成功：立即回到 closed */
  recordSuccess() {
    this._failures = 0;
    if (this._state !== 'closed') {
      console.info(`[CircuitBreaker] 探测成功，恢复 closed（原状态 ${this._state}）`);
    }
    this._state = 'closed';
    this._halfOpenInFlight = 0;
  }

  /** 记录瞬态失败：达阈值即熔断；半开态失败立即重新熔断 */
  recordFailure() {
    this._failures++;
    if (this._state === 'half-open') {
      this._trip('半开探测失败');
      return true;
    }
    if (this._failures >= this.failureThreshold) {
      this._trip(`连续瞬态失败 ${this._failures} 次达阈值 ${this.failureThreshold}`);
      return true;
    }
    return false;
  }

  _trip(reason) {
    this._state = 'open';
    this._openedAt = Date.now();
    this._halfOpenInFlight = 0;
    this.totalOpened++;
    console.warn(
      `[CircuitBreaker] 熔断开路（${reason}），${this.openMs}ms 内快速失败`
    );
  }

  /** 仅供测试：强制复位 */
  reset() {
    this._state = 'closed';
    this._failures = 0;
    this._openedAt = 0;
    this._halfOpenInFlight = 0;
    this.totalOpened = 0;
    this.totalShortCircuited = 0;
  }
}

/**
 * LlmRateLimiter —— 进程级 LLM 准入（并发上限 + 可选 QPS 令牌桶）。
 *
 * 目的不是"省额度"，而是避免一次 fan-out 把 N 个 LLM 请求同时打向供应商，
 * 那是产生 429/529 的直接原因。超出的调用**排队等待**而不是立刻失败。
 */
export class LlmRateLimiter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxConcurrency] - 并发上限（≥1）
   * @param {number} [opts.maxQps]         - 每秒放行上限（0=不限）
   */
  constructor(opts = {}) {
    this.maxConcurrency = Math.max(1, opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
    this.maxQps = Math.max(0, opts.maxQps ?? DEFAULT_MAX_QPS);
    this._active = 0;
    this._queue = [];
    this._lastTokenAt = 0;
    this.peakActive = 0;
    this.totalWaitedMs = 0;
    this.totalAcquired = 0;
  }

  get active() { return this._active; }
  get waiting() { return this._queue.length; }

  /** 令牌桶节流：按 QPS 间隔放行（maxQps=0 时跳过） */
  async _throttle() {
    if (this.maxQps <= 0) return;
    const interval = 1000 / this.maxQps;
    const now = Date.now();
    const earliest = this._lastTokenAt + interval;
    if (now < earliest) {
      await new Promise((r) => setTimeout(r, earliest - now));
    }
    this._lastTokenAt = Date.now();
  }

  _dispatch() {
    for (let i = 0; i < this._queue.length; i++) {
      if (this._active >= this.maxConcurrency) return;
      const w = this._queue.splice(i, 1)[0];
      i--;
      this._active++;
      this.peakActive = Math.max(this.peakActive, this._active);
      w.resolve();
    }
  }

  /**
   * 取得一个调用许可。
   * @returns {Promise<() => void>} 释放函数（幂等）
   */
  async acquire() {
    const t0 = Date.now();
    if (this._active >= this.maxConcurrency) {
      await new Promise((resolve) => this._queue.push({ resolve }));
    } else {
      this._active++;
      this.peakActive = Math.max(this.peakActive, this._active);
    }
    await this._throttle();
    this.totalWaitedMs += Date.now() - t0;
    this.totalAcquired++;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._active = Math.max(0, this._active - 1);
      this._dispatch();
    };
  }

  /** 仅供测试：复位统计 */
  resetStats() {
    this.peakActive = 0;
    this.totalWaitedMs = 0;
    this.totalAcquired = 0;
  }
}

/** 进程级共享实例（所有 LLMClient 共用同一熔断与准入状态） */
const globalBreaker = new CircuitBreaker({
  failureThreshold: _envNum('LLM_CIRCUIT_FAIL_THRESHOLD', DEFAULT_CIRCUIT_FAIL_THRESHOLD),
  openMs: _envNum('LLM_CIRCUIT_OPEN_MS', DEFAULT_CIRCUIT_OPEN_MS),
});

const globalRateLimiter = new LlmRateLimiter({
  maxConcurrency: _envNum('LLM_MAX_CONCURRENCY', DEFAULT_MAX_CONCURRENCY),
  maxQps: _envNum('LLM_MAX_QPS', DEFAULT_MAX_QPS),
});

/** 供应商是否拒绝 response_format（首次 400 后置位，避免每次都白撞） */
let _jsonResponseFormatSupported = true;

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
   * @param {CircuitBreaker} [options.breaker]     - 注入熔断器（默认进程级共享）
   * @param {LlmRateLimiter} [options.rateLimiter] - 注入准入限流器（默认进程级共享）
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
    this.jsonParseRetries = options.jsonParseRetries
      ?? _envInt('LLM_JSON_PARSE_RETRIES', DEFAULT_JSON_PARSE_RETRIES);

    // F-21：熔断与准入默认进程级共享；测试可注入独立实例
    this.breaker = options.breaker || globalBreaker;
    this.rateLimiter = options.rateLimiter || globalRateLimiter;

    // 允许注入 mock client 做单测；否则按真实配置 new 一个
    this.client = options.client || new OpenAI({ apiKey, baseURL });
  }

  /**
   * 发起一次 chat 调用，返回纯文本内容。
   *
   * 调用链：进程级准入（并发/QPS） → 熔断器门禁 → 重试（退避+抖动）
   *
   * @param {string} prompt - 用户 prompt
   * @param {object} [overrides] - { model, temperature, maxTokens, responseFormat }
   * @returns {Promise<string>}
   */
  async chat(prompt, overrides = {}) {
    const release = await this.rateLimiter.acquire();
    try {
      return await this._withRetry((currentModel) => this._callOnce(prompt, overrides, currentModel));
    } finally {
      release();
    }
  }

  /**
   * 发起一次 chat 调用并解析为 JSON 对象。
   *
   * F-21：
   *   - 启用 `response_format: {type:'json_object'}`（供应商不支持时自动降级）；
   *   - 解析失败**计入可重试**（有上限），不再"一次坏 JSON 吃掉一整轮大循环"。
   *
   * @param {string} prompt
   * @param {object} [overrides]
   * @returns {Promise<object>}
   */
  async chatJSON(prompt, overrides = {}) {
    const maxAttempts = Math.max(1, this.jsonParseRetries + 1);
    let lastErr = null;
    let raw = '';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // 第二次起追加"必须是纯 JSON"的强调，提高纠正成功率
      const effectivePrompt = attempt === 0
        ? prompt
        : `${prompt}\n\n【重要】上一次返回的内容无法解析为 JSON。请只输出一个合法的 JSON 对象，不要包含任何解释文字、Markdown 代码围栏或注释。`;

      raw = await this.chat(effectivePrompt, { ...overrides, responseFormat: true });

      const cleaned = _extractJSON(raw);
      try {
        return JSON.parse(cleaned);
      } catch (err) {
        lastErr = err;
        const preview = raw.length > 300 ? raw.slice(0, 300) + '...' : raw;
        console.warn(
          `[LLMClient] JSON 解析失败（第 ${attempt + 1}/${maxAttempts} 次）: ${err.message}；` +
          `原始内容：${preview}`
        );
      }
    }

    throw new Error(
      `LLMClient: JSON 解析失败（已重试 ${maxAttempts} 次）：${lastErr?.message}。` +
      `原始内容：${raw.length > 300 ? raw.slice(0, 300) + '...' : raw}`
    );
  }

  /**
   * 单次 API 调用（不含重试/准入，由 chat/_withRetry 负责）。
   * @private
   */
  async _callOnce(prompt, overrides, currentModel) {
    const temperature = overrides.temperature ?? this.temperature;
    const maxTokens = overrides.maxTokens ?? this.maxTokens;
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
    // F-21：强制 JSON 输出（供应商不支持时已降级，见 _jsonResponseFormatSupported）
    if (overrides.responseFormat && _jsonResponseFormatSupported) {
      reqParams.response_format = { type: 'json_object' };
    }

    let resp;
    try {
      resp = await this.client.chat.completions.create(reqParams);
    } catch (err) {
      // 供应商不支持 response_format → 记住并去掉后重试一次（不消耗重试预算）
      if (reqParams.response_format && _looksLikeUnsupportedResponseFormat(err)) {
        console.warn('[LLMClient] 供应商不支持 response_format，后续调用不再携带该参数');
        _jsonResponseFormatSupported = false;
        delete reqParams.response_format;
        resp = await this.client.chat.completions.create(reqParams);
      } else {
        throw err;
      }
    }

    // OpenAI 兼容格式：choices[0].message.content
    const content = resp?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('LLMClient: 模型返回内容为空');
    }
    return content;
  }

  // ─── 错误恢复：熔断门禁 + 指数退避重试 ─────────────────────────────────────

  /**
   * 包裹一个 LLM 调用函数，遇到 429/529/网络抖动时自动重试。
   *
   * 策略：
   *   - 每次尝试前过**进程级熔断器**：熔断开路时快速失败（不再打向供应商）
   *   - 429 限流：指数退避 + 抖动重试
   *   - 529 过载：指数退避 + 抖动重试，连续 MAX_CONSECUTIVE_529 次后切换备用模型
   *   - 网络抖动：指数退避 + 抖动重试
   *   - 非瞬态错误：直接抛出，不重试（也不计入熔断失败计数）
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
      // ── F-21：熔断门禁 ──
      const gate = this.breaker.canAttempt();
      if (!gate.ok) {
        const waitMs = Math.min(gate.retryAfterMs ?? 1000, 5000);
        if (attempt === 0 && gate.state === 'open') {
          // 首个尝试就撞上熔断：等待冷却（有上界），给一次机会，避免直接失败
          console.warn(
            `[LLMClient] 熔断器 ${gate.state}，等待 ${waitMs}ms 后重试（快速失败降温中）`
          );
          await new Promise((r) => setTimeout(r, waitMs));
          const retryGate = this.breaker.canAttempt();
          if (!retryGate.ok) {
            throw new Error(
              `LLMClient: 熔断器处于 ${retryGate.state} 状态，快速失败（供应商过载保护）`
            );
          }
        } else {
          throw new Error(
            `LLMClient: 熔断器处于 ${gate.state} 状态，快速失败（供应商过载保护）`
          );
        }
      }

      try {
        const result = await fn(currentModel);
        this.breaker.recordSuccess();
        consecutive529 = 0; // 成功则重置 529 计数
        return result;
      } catch (err) {
        const errorInfo = isTransientError(err);

        // 非瞬态错误（如 400/401/403），直接抛出，不重试、不计入熔断
        if (!errorInfo) {
          this.breaker.recordSuccess(); // 非瞬态说明链路是通的，不应累计熔断失败
          throw err;
        }

        // 计入熔断失败；返回 true 表示已熔断
        const tripped = this.breaker.recordFailure();

        // 529 过载：累加计数，达到阈值则切换备用模型
        if (errorInfo.is529) {
          consecutive529++;
          if (consecutive529 >= MAX_CONSECUTIVE_529 && this.fallbackModel) {
            currentModel = this.fallbackModel;
            consecutive529 = 0;
            console.warn(`[LLMClient] 连续 ${MAX_CONSECUTIVE_529} 次 529 过载，切换到备用模型 ${currentModel}`);
          }
        }

        // 熔断已开路：不必再退避重试（继续重试也无意义，只会加剧过载）
        if (tripped) {
          throw new Error(
            `LLMClient: 瞬态失败达阈值已熔断（最后错误：${errorInfo.type}），后续调用将快速失败 ` +
            `${this.breaker.openMs}ms`
          );
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

// ─── 错误恢复工具函数 ──────────────────────────────────────────────────────

/**
 * 计算指数退避延迟（含抖动）
 *
 * 公式：base = min(500 × 2^attempt, 32000)
 *       delay = base + random(0 ~ base × 0.25)
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
 * 识别方式：
 *   - openai SDK 的错误对象有 status 属性
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
 * 判断错误是否属于"供应商不支持 response_format"（F-21）。
 * 只对 400 且错误文本提到 response_format / json_object 的情况认定，
 * 避免把其它 400 误判为不支持而静默降级。
 * @param {Error} err
 * @returns {boolean}
 */
function _looksLikeUnsupportedResponseFormat(err) {
  const status = err?.status;
  const msg = String(err?.message || '').toLowerCase();
  const mentioned = msg.includes('response_format') || msg.includes('json_object')
    || msg.includes('response format');
  return mentioned && (status === 400 || status === 422 || status === undefined);
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

/** 仅供测试：暴露进程级共享实例 */
export const _globalBreaker = globalBreaker;
export const _globalRateLimiter = globalRateLimiter;

export default LLMClient;
