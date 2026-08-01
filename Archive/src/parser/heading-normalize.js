/**
 * heading-normalize.js — Markdown 标题规范化
 *
 * 统一不同 Markdown 变体下的标题文本：
 *   - 去掉前导/尾随空白与 Markdown 标记符 (#, *)
 *   - 合并连续空白
 *   - 去掉行内代码标记（`code` → code）
 *   - 折叠链接文本（[text](url) → text）
 *
 * 不依赖 AST 解析器，纯文本处理，作为 splitter 的辅助。
 */

/**
 * 规范化标题文本。
 * @param {string} raw
 * @returns {string}
 */
export function normalizeHeading(raw) {
  if (!raw) return '';
  return raw
    .replace(/^#+\s*/, '') // 去掉前导 #
    .replace(/[*_~]+/g, '') // 去掉强调标记
    .replace(/`([^`]*)`/g, '$1') // 行内代码去标记
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接取文本
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 判断标题是否像文件名（不应作为文档标题）。
 * 例如 "getting-started"、"api/camera"。
 * @param {string} title
 * @returns {boolean}
 */
export function isFilenameLike(title) {
  if (!title) return true;
  // 全小写、含连字符或斜杠、无中文 → 疑似文件名
  if (/^[a-z0-9\-_/.]+$/.test(title) && !title.includes(' ')) return true;
  return false;
}
