/**
 * fuzzyMatcher.js — 模糊匹配工具（分词器 + BM25 + 召回编排）
 *
 * 合并自原 tokenizer.js / bm25.js / fuzzyMatcher.js 三文件，因三者强耦合
 * （BM25 依赖分词器、编排依赖 BM25），且同属纯计算无外部 IO，合并为单文件
 * 降低阅读跳转与维护成本。
 *
 * 职责：
 *   1. 分词器：把文本切成小写 token 数组（英文停用词过滤 + 中文虚词切分）
 *   2. BM25：纯 JS BM25 打分算法（k1=1.5, b=0.75），无 SQLite 依赖
 *   3. 编排：根据 TaskAnalysis 在 SkillMeta[] 中召回 topK 候选（BM25 + legacy fallback）
 *
 * 设计原则：
 *   - 高内聚：分词 / BM25 / 编排集中于此
 *   - 低耦合：只依赖 JS 内置类型，不依赖 LLM/fs/Agent
 *   - 可替换：通过工厂函数 createFuzzyMatcher 暴露，便于注入真实算法
 *   - 纯函数：分词与 BM25 相同输入永远相同输出，无副作用，易单测
 */

// ════════════════════════════════════════════════════════════════════════
// 第 1 段：分词器（原 tokenizer.js）
// ════════════════════════════════════════════════════════════════════════

import { isActionWord, isDomainWord, ACTION_WORD_WEIGHT } from '../utils/actionWords.js';

// ─── 英文停用词（参考 engine.py 的 _STOPWORDS）─────────────────────────────────
const STOPWORDS = new Set([
  // engine.py 的停用词
  'the', 'for', 'with', 'and', 'not', 'are', 'but', 'you', 'all',
  'any', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has',
  'have', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old',
  'see', 'them', 'then', 'this', 'will', 'your', 'from', 'that',
  'make', 'error', 'warning', 'failed', 'file', 'line', 'into',
  'such', 'than', 'were', 'when', 'what', 'been', 'some',
  // 追加通用停用词
  'of', 'to', 'in', 'is', 'it', 'on', 'or', 'an', 'as', 'by', 'at',
  'be', 'no', 'so', 'if', 'we', 'they', 'there', 'here', 'about',
]);

// 最小 token 长度（参考 engine.py：长度 ≥ 2 的英文 token 才保留）
const MIN_TOKEN_LENGTH = 2;

// 中文单字虚词/停用词（用于切分黏连的中文 chunk）
// 如 "的鸿蒙化" → 切成 "鸿蒙化"（去掉虚词"的"）
const CN_STOPCHARS = new Set([
  '的', '了', '是', '在', '和', '与', '或', '及', '等', '把', '被',
  '将', '对', '向', '为', '以', '于', '由', '从', '到', '给', '让',
  '使', '这', '那', '其', '之', '而', '也', '都', '就', '还', '又',
  '已', '能', '可', '会', '要', '应', '需', '该', '此', '个', '们',
]);

/**
 * 分词：把文本切成小写 token 数组
 *
 * 策略：
 *   1. 英文：提取 [a-zA-Z_][a-zA-Z0-9_]{1,}（长度≥2），去停用词
 *   2. 中文：按非字母数字字符分隔，保留长度≥2 的中文片段（如"鸿蒙"、"移植"）
 *   3. 标点/空格作为分隔符
 *
 * @param {string} text - 原始文本
 * @param {object} [opts]
 * @param {boolean} [opts.removeStopwords=true] - 是否移除英文停用词
 * @returns {string[]} token 数组（小写）
 *
 * @example
 *   tokenize("分析 libcurl 的鸿蒙化") → ["libcurl", "鸿蒙化"]
 *   tokenize("C++ code check") → ["code", "check"]
 */
export function tokenize(text, opts = {}) {
  if (!text) return [];
  const removeStopwords = opts.removeStopwords ?? true;

  const lower = String(text).toLowerCase();

  // 1. 提取英文 token（字母/下划线/数字，≥2 字符）
  const englishTokens = lower.match(/[a-z_][a-z0-9_]{1,}/g) || [];

  // 2. 提取中文 token（连续的中文字符，≥2 字符，按词组）
  // 先提取连续中文 chunk，再用单字虚词进一步切分
  // 例："的鸿蒙化" → 去掉虚词"的" → "鸿蒙化"
  const rawChineseChunks = lower.match(/[\u4e00-\u9fa5]+/g) || [];
  const chineseChunks = [];
  for (const chunk of rawChineseChunks) {
    // 用单字虚词作为分隔，把黏连的 chunk 拆成实词
    // 保留长度≥2 的片段（单字虚词本身丢弃）
    const parts = chunk.split('').reduce((acc, ch) => {
      if (CN_STOPCHARS.has(ch)) {
        // 虚词作为分隔符，开始新片段
        acc.push('');
      } else {
        if (acc.length === 0) acc.push('');
        acc[acc.length - 1] += ch;
      }
      return acc;
    }, []);
    for (const p of parts) {
      if (p && p.length >= MIN_TOKEN_LENGTH) {
        chineseChunks.push(p);
      }
    }
  }

  // 3. 合并，去停用词
  const tokens = [];
  for (const t of englishTokens) {
    if (t.length < MIN_TOKEN_LENGTH) continue;
    if (removeStopwords && STOPWORDS.has(t)) continue;
    tokens.push(t);
  }
  for (const c of chineseChunks) {
    if (c.length < MIN_TOKEN_LENGTH) continue;
    tokens.push(c);
  }

  return tokens;
}

/**
 * 规整字符串/数组为小写字符串数组（用于 keywords/techStack 等 LLM 输出）
 * @param {string|Array<string>|null|undefined} v
 * @returns {string[]}
 */
export function normalizeList(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  }
  return String(v)
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter(Boolean);
}

// ════════════════════════════════════════════════════════════════════════
// 第 2 段：BM25（原 bm25.js）
// ════════════════════════════════════════════════════════════════════════

// 默认 BM25 参数
const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

/**
 * BM25 打分器（对一批文档预先建立索引，可对多次查询复用）
 *
 * 用法：
 *   const bm25 = new BM25(docs);        // docs: string[] | string[][]
 *   const scores = bm25.scores(query);  // query: string | string[]
 *
 * BM25 公式：
 *   score(q, d) = Σ_t∈q  idf(t) · [ tf(t,d) · (k1+1) ] / [ tf(t,d) + k1·(1 − b + b·|d|/avgdl) ]
 *   idf(t) = ln( (N − df(t) + 0.5) / (df(t) + 0.5) + 1 )   （+1 平滑，保证非负）
 *
 * 参数（参考标准实现）：
 *   k1 = 1.5  — 词频饱和控制
 *   b  = 0.75 — 文档长度归一化强度
 */
export class BM25 {
  /**
   * @param {Array<string|Array<string>>} documents - 文档数组，每项是文本（会自动分词）或 token 数组
   * @param {object} [opts]
   * @param {number} [opts.k1=1.5]
   * @param {number} [opts.b=0.75]
   */
  constructor(documents, opts = {}) {
    this.k1 = opts.k1 ?? DEFAULT_K1;
    this.b = opts.b ?? DEFAULT_B;

    // 统一转成 token 数组
    this.docs = (documents || []).map((d) =>
      Array.isArray(d) ? d : tokenize(d)
    );

    this.N = this.docs.length;
    this.avgdl = this._avgDocLength();

    // df: 每个 term 出现在多少篇文档中
    this.df = new Map();
    for (const tokens of this.docs) {
      const seen = new Set(tokens);
      for (const t of seen) {
        this.df.set(t, (this.df.get(t) || 0) + 1);
      }
    }
  }

  /**
   * 计算单个查询对所有文档的 BM25 分数
   * @param {string|Array<string>} query - 查询文本或 token 数组
   * @returns {number[]} 每个文档的分数，顺序与构造时 documents 一致
   */
  scores(query) {
    const qTokens = Array.isArray(query) ? query : tokenize(query);
    if (this.N === 0 || qTokens.length === 0) {
      return new Array(this.N).fill(0);
    }

    // 预计算 query 中每个 term 的 idf
    const idfMap = new Map();
    for (const t of new Set(qTokens)) {
      idfMap.set(t, this._idf(t));
    }

    return this.docs.map((docTokens) => {
      let score = 0;
      // doc term frequency
      const tfMap = this._tf(docTokens);
      const dl = docTokens.length;

      for (const t of qTokens) {
        const tf = tfMap.get(t);
        if (!tf) continue;
        const idf = idfMap.get(t) || 0;
        const denom = tf + this.k1 * (1 - this.b + (this.b * dl) / (this.avgdl || 1));
        score += (idf * (tf * (this.k1 + 1))) / (denom || 1);
      }
      return score;
    });
  }

  /**
   * 计算单个查询对单个文档的 BM25 分数
   * @param {string|Array<string>} query
   * @param {number} docIndex - 文档索引
   * @returns {number}
   */
  score(query, docIndex) {
    return this.scores(query)[docIndex] || 0;
  }

  // ─── 内部工具 ──────────────────────────────────────────────────────────────
  _avgDocLength() {
    if (this.N === 0) return 0;
    let total = 0;
    for (const t of this.docs) total += t.length;
    return total / this.N;
  }

  /** 逆文档频率（带 +1 平滑，保证非负） */
  _idf(term) {
    const df = this.df.get(term) || 0;
    return Math.log((this.N - df + 0.5) / (df + 0.5) + 1);
  }

  /** 文档词频 */
  _tf(tokens) {
    const m = new Map();
    for (const t of tokens) {
      m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }
}

/**
 * 一次性函数：对 documents 用 query 计算 BM25 分数（内部会建索引）
 * @param {string|Array<string>} query
 * @param {Array<string|Array<string>>} documents
 * @param {object} [opts]
 * @returns {number[]}
 */
export function bm25Scores(query, documents, opts = {}) {
  return new BM25(documents, opts).scores(query);
}

// ════════════════════════════════════════════════════════════════════════
// 第 3 段：模糊匹配编排（原 fuzzyMatcher.js）
// ════════════════════════════════════════════════════════════════════════

/**
 * 默认模糊匹配器
 *
 * 匹配策略（双通道 + 多路召回融合）：
 *   - 路 A（动作通道）：仅用 keywords + intent 中的「动作类 token」做 BM25 打分，
 *     动作词加权只对真动作词生效（避免领域词混入动作词表稀释信号）。
 *   - 路 B（领域通道）：用 keywords 中的「领域/产出物特征词」+ whenToUse 分词
 *     做 BM25 打分，直接匹配文档侧已索引的 useWhen 与 searchableText 中的领域词。
 *   - 路 C（原文兜底路）：用原始任务描述 task 全文分词做 BM25 打分，覆盖
 *     keywords 提取偏差导致的语义漂移。
 *   - 融合：score = wA·bm25A + wB·bm25B + wC·bm25C（归一化后加权），
 *     name 精确匹配 bonus 保留在所有路。
 *   - legacy fallback：融合后全零分时回退到子串匹配，保证不返回空。
 *
 * @param {object} analysis - Reason #1 产出的任务拆解
 * @param {Array} skills - 候选 SkillMeta[]
 * @param {object} [options]
 * @param {number} [options.topK=5] - 召回数量
 * @param {string} [options.task] - 原始任务描述（原文兜底路用）
 * @param {object} [options.weights] - 融合权重 { action, domain, raw }
 * @returns {Promise<Array>} 排序后的候选 SKILL（含 score / routes），长度 ≤ topK
 */
export async function fuzzyMatch(analysis, skills, options = {}) {
  const topK = options.topK ?? 5;
  if (!skills || skills.length === 0) return [];

  const weights = {
    action: options.weights?.action ?? 0.4,
    domain: options.weights?.domain ?? 0.4,
    raw: options.weights?.raw ?? 0.2,
  };

  // ─── 准备数据 ──────────────────────────────────────────────────────────────
  const keywords = normalizeList(analysis?.keywords);
  const intentTokens = tokenize(analysis?.intent || '');
  const whenToUseTokens = tokenize(analysis?.whenToUse || '');
  const taskTokens = tokenize(options?.task || '');

  // 把每个 SKILL 的 searchableText 分词，作为 BM25 的文档集
  const docs = skills.map((s) => tokenize(s.searchableText || ''));

  // ─── 路 A：动作通道 ──────────────────────────────────────────────────────────
  // 仅保留动作类 token（keywords 中动作为主的词 + intent 中动作词），动作词加权。
  const actionKeywords = keywords.filter((kw) => isActionWord(kw));
  const actionIntentTokens = intentTokens.filter((t) => isActionWord(t));
  const queryA = [];
  const rawQueryATokens = actionKeywords.length + actionIntentTokens.length;
  for (const kw of actionKeywords) {
    queryA.push(kw);
    for (let i = 0; i < ACTION_WORD_WEIGHT - 1; i++) queryA.push(kw);
  }
  for (const t of actionIntentTokens) {
    queryA.push(t);
    for (let i = 0; i < ACTION_WORD_WEIGHT - 1; i++) queryA.push(t);
  }

  // ─── 路 B：领域通道 ──────────────────────────────────────────────────────────
  // 领域/产出物特征词（keywords 中领域词 + whenToUse 分词）做查询，匹配文档侧领域词/useWhen。
  const domainKeywords = keywords.filter((kw) => isDomainWord(kw));
  const queryB = [...domainKeywords, ...whenToUseTokens];

  // ─── 路 C：原文兜底通道 ──────────────────────────────────────────────────────
  const queryC = taskTokens;

  const bm25 = new BM25(docs);
  const rawA = bm25.scores(queryA);
  const rawB = bm25.scores(queryB);
  const rawC = bm25.scores(queryC);

  // 分数归一化：raw / max(3, 单路实际参与 token 数)
  // 分母用各路的原始 token 数（非展开后），避免动作词展开/多路叠加导致分母虚高
  const countA = Math.max(3, rawQueryATokens);
  const countB = Math.max(3, queryB.length);
  const countC = Math.max(3, queryC.length);
  const normA = rawA.map((s) => s / countA);
  const normB = rawB.map((s) => s / countB);
  const normC = rawC.map((s) => s / countC);

  // 融合
  const fused = normA.map((_, i) => weights.action * normA[i] + weights.domain * normB[i] + weights.raw * normC[i]);

  // 检查融合后是否全零（无任何 token 重叠）→ 回退到 legacy 子串匹配
  const hasAnyScore = fused.some((s) => s > 0);
  let candidates;
  if (!hasAnyScore) {
    candidates = _legacySubstringMatch(analysis, skills).slice(0, topK);
  } else {
    candidates = skills
      .map((skill, i) => {
        let score = fused[i] || 0;
        // name 精确匹配 bonus：query keywords 中任一词与 skill.name 精确匹配时 ×1.15
        const skillName = (skill.name || '').toLowerCase();
        const hasNameMatch = keywords.some((kw) => kw && skillName === kw);
        if (hasNameMatch && score > 0) {
          score = score * 1.15;
        }
        return {
          skill,
          score,
          // 每路归一化分数留痕，便于定位偶发未命中
          routes: { action: normA[i] || 0, domain: normB[i] || 0, raw: normC[i] || 0 },
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  return candidates;
}

// ─── Legacy fallback：子串匹配（BM25 全零分时启用）──────────────────────────────
/**
 * 旧版子串匹配逻辑（作为 fallback）
 * 保留原 fuzzyMatch 桩实现的策略，保证 BM25 无重叠时不返回空
 */
function _legacySubstringMatch(analysis, skills) {
  const keywords = normalizeList(analysis?.keywords);
  const techStack = normalizeList(analysis?.techStack);
  const intentWords = _legacyTokenize(analysis?.intent);

  const scored = skills.map((skill) => {
    const text = skill.searchableText || '';
    let score = 0;

    for (const t of techStack) {
      if (t && text.includes(t)) score += 10;
    }
    for (const kw of keywords) {
      if (kw && text.includes(kw)) score += 6;
    }
    for (const w of intentWords) {
      if (w && w.length > 1 && text.includes(w)) score += 2;
    }
    const name = (skill.name || '').toLowerCase();
    for (const kw of keywords) {
      if (kw && name === kw) score += 4;
    }

    return { skill, score, reasons: ['legacy fallback'] };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** legacy 分词（保留原逻辑，不做停用词过滤） */
function _legacyTokenize(s) {
  if (!s) return [];
  return String(s)
    .toLowerCase()
    .split(/[\s,，。、;；:：.()（）\-_/]+/)
    .filter((w) => w.length > 0);
}

// ─── 工厂：创建可替换的模糊匹配器 ──────────────────────────────────────────────
/**
 * @param {(analysis, skills, options) => Promise<Array>} impl
 * @returns {(analysis, skills, options) => Promise<Array>}
 */
export function createFuzzyMatcher(impl) {
  if (typeof impl === 'function') return impl;
  return fuzzyMatch;
}

export default { tokenize, normalizeList, BM25, bm25Scores, fuzzyMatch, createFuzzyMatcher };
