/**
 * snippet.js — 搜索结果摘要提取
 *
 * 以查询词命中位置为中心，截取内容片段作为摘要。
 * 在词边界截断，前后加省略号标记。
 */

import { SNIPPET_MAX_CHARS, SNIPPET_CONTEXT_CHARS } from '../constants.js';

/**
 * 提取摘要。
 * @param {string} content  原始内容
 * @param {string} query    查询词（用于定位中心）
 * @param {number} [maxLen] 摘要最大字符数
 * @param {number} [contextChars] 命中位置前的上下文字符数
 * @returns {string}
 */
export function extractSnippet(
  content,
  query,
  maxLen = SNIPPET_MAX_CHARS,
  contextChars = SNIPPET_CONTEXT_CHARS
) {
  if (!content) return '';
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;

  // 找到查询词在内容中的位置
  const tokens = query.split(/\s+/).filter(Boolean);
  let bestIndex = -1;
  const lowerContent = normalized.toLowerCase();
  for (const token of tokens) {
    const idx = lowerContent.indexOf(token.toLowerCase());
    if (idx >= 0) {
      bestIndex = idx;
      break;
    }
  }

  // 没命中则从头截取
  const start = bestIndex >= 0 ? Math.max(0, bestIndex - contextChars) : 0;
  let end = Math.min(normalized.length, start + maxLen);

  // 在窗口内找词边界截断
  const lastBreak = findLastWordBoundary(normalized.slice(start, end), maxLen - 25);
  if (lastBreak >= 0) end = start + lastBreak;

  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalized.length ? '...' : '';
  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
}

/**
 * 在文本中找最后一个词边界位置（空格或标点）。
 * @param {string} text
 * @param {number} minPos 最小位置
 * @returns {number}
 */
function findLastWordBoundary(text, minPos) {
  for (let i = text.length - 1; i >= minPos; i--) {
    if (/\s|[，。；,.;!?、]/.test(text[i])) return i;
  }
  return -1;
}
