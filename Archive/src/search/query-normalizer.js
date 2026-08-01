/**
 * query-normalizer.js — 查询预处理
 *
 * 对用户输入的原始查询进行规范化：
 *   - 合并多余空白、截断超长查询。
 *   - 识别特殊查询模式（API 短语拆分、单个 API 符号）。
 *   - 与 jieba 分词 + 同义词扩展协同产出 FTS token。
 */

import { QUERY_MAX_RAW_CHARS, QUERY_MAX_FTS_TOKENS, QUERY_AND_MAX_TOKENS } from '../constants.js';

/**
 * @typedef {Object} PreparedQuery
 * @property {string} rawQuery         原始查询
 * @property {string} expandedQuery    同义词扩展后的查询
 * @property {string[]} tokens         FTS token 列表
 * @property {boolean} preferAnd       是否优先 AND 匹配
 * @property {string|null} ftsMatch    预构建的 FTS MATCH 表达式
 */

/**
 * 规范化搜索输入：合并空格 + 截断。
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSearchInput(raw) {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX_RAW_CHARS);
}

/**
 * 判断是否为单个 API 模块符号（如 @ohos.camera）。
 * @param {string} query
 * @returns {boolean}
 */
function isSingleApiSymbol(query) {
  return /^@[a-z]+\.[a-z][a-zA-Z0-9.]*$/i.test(query.trim());
}

/**
 * 检测 API 短语拆分场景（如 "camera manager"）。
 * @param {string} query
 * @returns {{left:string, right:string}|null}
 */
function detectSplitApiPhrase(query) {
  const parts = query.trim().split(/\s+/);
  if (parts.length === 2) {
    // 形如 "camera manager" → left=camera, right=manager
    if (/^[a-z]/i.test(parts[0]) && /^[a-z]/i.test(parts[1])) {
      return { left: parts[0], right: parts[1] };
    }
  }
  return null;
}

/**
 * 预处理查询，产出 PreparedQuery。
 *
 * @param {string} rawQuery       用户原始查询
 * @param {import('../tokenizer/tokenizer.js').default} tokenizer
 * @param {import('../tokenizer/lexicon.js').default} lexicon
 * @param {{expandSynonyms?:boolean, synonymExpandLimit?:number, preferAnd?:boolean}} [options]
 * @returns {Promise<PreparedQuery>}
 */
export async function prepareQuery(rawQuery, tokenizer, lexicon, options = {}) {
  const normalized = normalizeSearchInput(rawQuery);
  if (!normalized) {
    return { rawQuery: '', expandedQuery: '', tokens: [], preferAnd: false, ftsMatch: null };
  }

  const expandSynonyms = options.expandSynonyms !== false;
  const synonymLimit = options.synonymExpandLimit || 8;

  // 同义词扩展
  const expandedQuery = expandSynonyms
    ? lexicon.expandSynonyms(normalized, synonymLimit)
    : normalized;

  // jieba 分词（查询模式）
  let tokens = await tokenizer.tokenizeForQuery(expandedQuery);

  // 特殊查询模式处理
  let ftsMatch = null;

  if (isSingleApiSymbol(normalized)) {
    // 单个 API 符号：OR 匹配变体
    const variants = await tokenizer.tokenizeForQuery(normalized);
    tokens = dedupe([...tokens, ...variants]).slice(0, QUERY_MAX_FTS_TOKENS);
    ftsMatch = buildFtsOrMatch(tokens);
  } else {
    const split = detectSplitApiPhrase(normalized);
    if (split) {
      const leftTokens = await tokenizer.tokenizeForQuery(split.left);
      const rightTokens = await tokenizer.tokenizeForQuery(split.right);
      ftsMatch = buildSplitApiAndMatch(leftTokens, rightTokens);
    }
  }

  // 限制 token 数量
  tokens = tokens.slice(0, QUERY_MAX_FTS_TOKENS);

  // 策略选择：2-4 个 token → preferAnd
  let preferAnd = options.preferAnd;
  if (preferAnd === undefined) {
    preferAnd = tokens.length >= 2 && tokens.length <= QUERY_AND_MAX_TOKENS;
  }

  return { rawQuery: normalized, expandedQuery, tokens, preferAnd, ftsMatch };
}

/**
 * 去重。
 * @param {string[]} arr
 * @returns {string[]}
 */
function dedupe(arr) {
  return [...new Set(arr)];
}

/**
 * FTS5 token 转义（防注入）。
 * @param {string} token
 * @returns {string}
 */
export function escapeFtsToken(token) {
  return `"${token.replace(/"/g, '""')}"`;
}

/**
 * 构建 OR 匹配表达式。
 * @param {string[]} tokens
 * @returns {string}
 */
export function buildFtsOrMatch(tokens) {
  const filtered = tokens.filter(Boolean);
  if (filtered.length === 0) return '';
  return filtered.map(escapeFtsToken).join(' OR ');
}

/**
 * 构建 AND 匹配表达式。
 * @param {string[]} tokens
 * @returns {string}
 */
export function buildFtsAndMatch(tokens) {
  const filtered = tokens.filter(Boolean);
  if (filtered.length === 0) return '';
  return filtered.map(escapeFtsToken).join(' AND ');
}

/**
 * 构建拆分 API 的 AND 匹配。
 * @param {string[]} left
 * @param {string[]} right
 * @returns {string}
 */
function buildSplitApiAndMatch(left, right) {
  return `(${buildFtsOrMatch(left)}) AND (${buildFtsOrMatch(right)})`;
}
