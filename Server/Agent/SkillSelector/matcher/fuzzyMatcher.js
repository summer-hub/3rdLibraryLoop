/**
 * fuzzyMatcher.js — 模糊匹配工具（单路 BM25 + legacy fallback）
 *
 * 职责：
 *   根据 Reason #1 产出的 TaskAnalysis（keywords/intent/techStack），
 *   在 SkillMeta[] 候选池中召回最匹配的 topK 个 SKILL。
 *
 * 匹配策略：
 *   - Phase A：单路 BM25 打分（原始 keywords + intent tokens 查询）
 *   - legacy fallback：BM25 全零分时回退到子串匹配，保证不返回空
 *
 * 设计原则：
 *   - 高内聚：编排逻辑集中于此，BM25/分词各为独立子模块
 *   - 低耦合：只依赖子模块，不依赖 LLM/fs/Agent
 *   - 可替换：通过工厂函数 createFuzzyMatcher 暴露，便于注入真实算法
 *   - 接口零变更：保持 (analysis, skills, options) => Promise<Array> 签名
 */

import { BM25 } from './bm25.js';
import { tokenize, normalizeList } from './tokenizer.js';

/**
 * 默认模糊匹配器
 * @param {object} analysis - Reason #1 产出的任务拆解
 * @param {Array} skills - 候选 SkillMeta[]
 * @param {object} [options]
 * @param {number} [options.topK=5] - 召回数量
 * @returns {Promise<Array>} 排序后的候选 SKILL（含 score），长度 ≤ topK
 */
export async function fuzzyMatch(analysis, skills, options = {}) {
  const topK = options.topK ?? 5;
  if (!skills || skills.length === 0) return [];

  // ─── 准备数据 ──────────────────────────────────────────────────────────────
  const keywords = normalizeList(analysis?.keywords);
  const intentTokens = tokenize(analysis?.intent || '');

  // 把每个 SKILL 的 searchableText 分词，作为 BM25 的文档集
  const docs = skills.map((s) => tokenize(s.searchableText || ''));

  // ─── Phase A：单路 BM25 打分 ──────────────────────────────────────────────────
  const query = [...keywords, ...intentTokens];
  const bm25 = new BM25(docs);
  const scores = bm25.scores(query);

  // 检查 BM25 是否全零（无任何 token 重叠）→ 回退到 legacy 子串匹配
  const hasAnyScore = scores.some((s) => s > 0);
  let candidates;
  if (!hasAnyScore) {
    candidates = _legacySubstringMatch(analysis, skills).slice(0, topK);
  } else {
    candidates = skills
      .map((skill, i) => ({ skill, score: scores[i] || 0 }))
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

export default { fuzzyMatch, createFuzzyMatcher };
