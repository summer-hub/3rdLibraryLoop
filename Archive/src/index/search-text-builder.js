/**
 * search-text-builder.js — 搜索文本组装
 *
 * 为每个 segment 按字符预算组装 search_text。
 * 标题和 API 符号占比较高，确保精确匹配优先。
 *
 * 段级与文档级有不同的预算（见 constants.js）。
 */

import {
  BUDGET_TITLE,
  BUDGET_API_SYMBOLS,
  BUDGET_HEADINGS,
  BUDGET_BODY,
  SECTION_BUDGET_TITLE,
  SECTION_BUDGET_API_SYMBOLS,
  SECTION_BUDGET_HEADINGS,
  SECTION_BUDGET_BODY,
} from '../constants.js';

/**
 * 为 segment 构建 search_text。
 * @param {import('../parser/markdown-splitter.js').DocumentIndexSource} source
 * @param {import('../tokenizer/tokenizer.js').default} tokenizer
 * @returns {Promise<string>}
 */
export async function buildSearchText(source, tokenizer) {
  const isSection = Boolean(source.sectionTitle);

  const budgets = isSection
    ? {
        title: SECTION_BUDGET_TITLE,
        api: SECTION_BUDGET_API_SYMBOLS,
        headings: SECTION_BUDGET_HEADINGS,
        body: SECTION_BUDGET_BODY,
      }
    : {
        title: BUDGET_TITLE,
        api: BUDGET_API_SYMBOLS,
        headings: BUDGET_HEADINGS,
        body: BUDGET_BODY,
      };

  const titleText = (source.titleTokens || []).join(' ');
  const apiText = (source.apiSymbols || []).join(' ');

  const parts = await Promise.all([
    tokenizeAndCap(titleText, tokenizer, budgets.title),
    capApiSymbols(source.apiSymbols || [], budgets.api),
    tokenizeAndCap(source.headingsText, tokenizer, budgets.headings),
    tokenizeAndCap(source.bodySample, tokenizer, budgets.body),
  ]);

  return parts.filter(Boolean).join(' ');
}

/**
 * 分词后截断到指定字符数。
 * @param {string} text
 * @param {import('../tokenizer/tokenizer.js').default} tokenizer
 * @param {number} maxChars
 * @returns {Promise<string>}
 */
async function tokenizeAndCap(text, tokenizer, maxChars) {
  if (!text) return '';
  const tokens = await tokenizer.tokenizeForIndex(text);
  return capTokens(tokens, maxChars);
}

/**
 * API 符号直接拼接截断（不分词，保留完整性）。
 * @param {string[]} symbols
 * @param {number} maxChars
 * @returns {string}
 */
function capApiSymbols(symbols, maxChars) {
  if (!symbols || symbols.length === 0) return '';
  /** @type {string[]} */
  const out = [];
  let total = 0;
  for (const sym of symbols) {
    if (total + sym.length + 1 > maxChars) break;
    out.push(sym);
    total += sym.length + 1;
  }
  return out.join(' ');
}

/**
 * token 数组截断到指定字符数。
 * @param {string[]} tokens
 * @param {number} maxChars
 * @returns {string}
 */
function capTokens(tokens, maxChars) {
  if (!tokens || tokens.length === 0) return '';
  /** @type {string[]} */
  const out = [];
  let total = 0;
  for (const token of tokens) {
    if (total + token.length + 1 > maxChars) break;
    out.push(token);
    total += token.length + 1;
  }
  return out.join(' ');
}
