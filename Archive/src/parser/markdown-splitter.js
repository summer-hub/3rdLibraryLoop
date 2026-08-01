/**
 * markdown-splitter.js — Markdown 文档拆分为索引段
 *
 * 流程：
 *   1. 按行扫描 Markdown，识别 H1-H6 标题与代码块边界。
 *   2. 按 H4 heading 将文档拆分为多个 segment。
 *   3. 对每个段生成 DocumentIndexSource：
 *      sectionTitle / leadText / apiSymbols / headingsText /
 *      titleTokens / bodySample / excerptTruncated。
 *   4. 限制单文档最大段数（MAX_SECTIONS_PER_DOC），超出截断。
 *
 * 不依赖 unified/remark 等重型 AST 库，使用轻量正则 + 行扫描，
 * 既满足拆段需求，又减少依赖体积。
 */

import {
  MAX_SECTIONS_PER_DOC,
  LEAD_TEXT_CHARS,
  BUDGET_BODY,
  SECTION_BUDGET_BODY,
} from '../constants.js';
import { normalizeHeading, isFilenameLike } from './heading-normalize.js';
import { extractApiSymbols } from './api-identifiers.js';

/** H4 标题行正则 */
const H4_RE = /^####\s+(.*)$/;
/** 任意标题行正则（捕获层级与文本） */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** 代码块围栏正则 */
const FENCE_RE = /^(```|~~~)/;

/**
 * @typedef {Object} DocumentIndexSource
 * @property {string} sectionTitle
 * @property {string} leadText
 * @property {string[]} apiSymbols
 * @property {string} headingsText
 * @property {string[]} titleTokens
 * @property {string} bodySample
 * @property {boolean} excerptTruncated
 */

/**
 * 解析文档标题（优先级：传入 > H1 > 文件名兜底）。
 * @param {string} markdown
 * @param {string} [explicitTitle]
 * @param {string} [documentId]
 * @returns {string}
 */
export function resolveDocTitle(markdown, explicitTitle, documentId) {
  if (explicitTitle && !isFilenameLike(explicitTitle)) return explicitTitle;

  for (const line of markdown.split('\n')) {
    const m = line.match(/^#\s+(.*)$/);
    if (m) {
      const title = normalizeHeading(m[1]);
      if (title && !isFilenameLike(title)) return title;
    }
  }

  // 兜底：取 documentId 最后一段
  if (documentId) {
    const last = documentId.split('/').pop() || documentId;
    return last.replace(/[-_]/g, ' ');
  }
  return 'Untitled';
}

/**
 * 将 Markdown 拆分为索引段列表。
 * @param {string} markdown
 * @param {{documentId:string, docTitle:string}} ctx
 * @returns {DocumentIndexSource[]}
 */
export function splitMarkdown(markdown, ctx) {
  const lines = markdown.split('\n');

  /** @type {Array<{title:string, level:number, lines:string[]}>} */
  const sections = [];
  /** @type {{title:string, level:number, lines:string[]}|null} */
  let current = { title: '', level: 0, lines: [] };

  let inFence = false;

  for (const line of lines) {
    // 代码块边界切换
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      current.lines.push(line);
      continue;
    }

    // 代码块内不识别标题
    if (!inFence) {
      const h4 = line.match(H4_RE);
      if (h4) {
        // 结束当前段
        if (current.lines.length > 0 || current.title) {
          sections.push(current);
        }
        current = {
          title: normalizeHeading(h4[1]),
          level: 4,
          lines: [],
        };
        continue;
      }
    }

    current.lines.push(line);
  }
  // 尾段
  if (current.lines.length > 0 || current.title) {
    sections.push(current);
  }

  // 限制段数
  const limited = sections.slice(0, MAX_SECTIONS_PER_DOC);
  const truncated = sections.length > MAX_SECTIONS_PER_DOC;

  /** @type {DocumentIndexSource[]} */
  const sources = limited.map((section, idx) => {
    const body = section.lines.join('\n');
    const isSection = Boolean(section.title);

    // 提取段内所有子标题
    const headings = [];
    /** @type {string[]} */
    const codeBlocks = [];
    let inCode = false;
    /** @type {string[]} */
    let codeBuf = [];

    for (const line of section.lines) {
      if (FENCE_RE.test(line.trim())) {
        if (inCode) {
          codeBlocks.push(codeBuf.join('\n'));
          codeBuf = [];
        }
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }
      const h = line.match(HEADING_RE);
      if (h) {
        headings.push(normalizeHeading(h[2]));
      }
    }

    const leadText = truncateAtWordBoundary(body.replace(/\s+/g, ' ').trim(), LEAD_TEXT_CHARS);
    const apiSymbols = extractApiSymbols(body, codeBlocks);
    const headingsText = headings.filter(Boolean).join(' ');
    const titleTokens = [ctx.docTitle, section.title].filter(Boolean);
    const bodySample = buildBodySample(body, isSection);

    return {
      sectionTitle: section.title || (idx === 0 ? ctx.docTitle : ''),
      leadText,
      apiSymbols,
      headingsText,
      titleTokens,
      bodySample,
      excerptTruncated: truncated && idx === limited.length - 1,
    };
  });

  // 保证至少有一段
  if (sources.length === 0) {
    sources.push({
      sectionTitle: ctx.docTitle,
      leadText: '',
      apiSymbols: [],
      headingsText: '',
      titleTokens: [ctx.docTitle],
      bodySample: '',
      excerptTruncated: false,
    });
  }

  return sources;
}

/**
 * 在词边界处截断文本。
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncateAtWordBoundary(text, maxLen) {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.5) return slice.slice(0, lastSpace);
  return slice;
}

/**
 * 构建正文样本（head + tail）。
 * 段级与文档级有不同的预算。
 * @param {string} body
 * @param {boolean} isSection
 * @returns {string}
 */
function buildBodySample(body, isSection) {
  const budget = isSection ? SECTION_BUDGET_BODY : BUDGET_BODY;
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= budget) return normalized;

  const headLen = Math.floor(budget * 0.7);
  const tailLen = budget - headLen;
  return normalized.slice(0, headLen) + ' ' + normalized.slice(-tailLen);
}
