/**
 * bm25.js — 纯 JS BM25 实现（无 SQLite/FTS5 依赖）
 *
 * 职责：
 *   给定 query tokens 和一组 document（每个 doc 是 token 数组），
 *   按标准 BM25 公式计算每个 doc 的相关性分数。
 *
 * 设计原则：
 *   - 高内聚：只做 BM25 打分，不涉及 SKILL 业务、不依赖 fs/LLM
 *   - 纯函数：相同输入永远相同输出，无副作用，易单测
 *   - 零依赖：仅用 JS 内置类型，参考 engine.py 的 FTS5 BM25 思路
 *
 * BM25 公式：
 *   score(q, d) = Σ_t∈q  idf(t) · [ tf(t,d) · (k1+1) ] / [ tf(t,d) + k1·(1 − b + b·|d|/avgdl) ]
 *   idf(t) = ln( (N − df(t) + 0.5) / (df(t) + 0.5) + 1 )   （+1 平滑，保证非负）
 *
 * 参数（参考标准实现）：
 *   k1 = 1.5  — 词频饱和控制
 *   b  = 0.75 — 文档长度归一化强度
 */

import { tokenize } from './tokenizer.js';

// 默认 BM25 参数
const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

/**
 * BM25 打分器（对一批文档预先建立索引，可对多次查询复用）
 *
 * 用法：
 *   const bm25 = new BM25(docs);        // docs: string[] | string[][]
 *   const scores = bm25.scores(query);  // query: string | string[]
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

export default { BM25, bm25Scores };
