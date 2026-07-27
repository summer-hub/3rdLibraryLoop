/**
 * tokenizer.js — 统一分词器
 *
 * 职责：
 *   把文本切成小写 token 数组，供 BM25 / fuzzyMatcher 共享。
 *
 * 设计参考：
 *   - engine.py 的 kb_index._extract_tokens：正则提取 [a-zA-Z_][a-zA-Z0-9_]{2,}，去停用词
 *   - 中文场景特化：对中文按"字"或"词组"切分，因为 BM25 依赖空格分词
 *
 * 设计原则：
 *   - 高内聚：所有分词逻辑集中于此
 *   - 纯函数：相同输入永远相同输出
 *   - 低耦合：不依赖 SKILL/LLM/fs
 */

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

export default { tokenize, normalizeList };
