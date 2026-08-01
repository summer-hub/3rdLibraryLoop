/**
 * query-rewriter.js — 查询重写器
 *
 * 封装同义词扩展的动态注册能力：
 *   - 运行时注册自定义同义词组。
 *   - 与 Lexicon 的文件词典合并，不影响磁盘词典。
 *
 * 通过内存同义词组叠加到 Lexicon 的 getSynonymMap() 之上，
 * 避免频繁修改磁盘文件。
 */

export default class QueryRewriter {
  constructor() {
    /** @type {string[][]} */
    this.customGroups = [];
  }

  /**
   * 注册自定义同义词组。
   * @param {string[]} words
   */
  addSynonyms(words) {
    if (Array.isArray(words) && words.length >= 2) {
      this.customGroups.push([...words]);
    }
  }

  /**
   * 将自定义同义词组合并进 Lexicon 的同义词映射。
   * @param {import('../tokenizer/lexicon.js').default} lexicon
   * @returns {Map<string, Set<string>>}
   */
  mergeWithLexicon(lexicon) {
    const map = new Map(lexicon.getSynonymMap());
    for (const group of this.customGroups) {
      for (const word of group) {
        const key = word.toLowerCase();
        if (!map.has(key)) map.set(key, new Set());
        for (const other of group) {
          if (other !== word) map.get(key).add(other);
        }
      }
    }
    return map;
  }

  /**
   * 扩展查询（使用合并后的同义词映射）。
   * @param {string} query
   * @param {import('../tokenizer/lexicon.js').default} lexicon
   * @param {number} [maxParts=8]
   * @returns {string}
   */
  expand(query, lexicon, maxParts = 8) {
    const map = this.mergeWithLexicon(lexicon);
    const parts = query.split(/\s+/).filter(Boolean);
    /** @type {Set<string>} */
    const expanded = new Set();

    for (let i = 0; i < parts.length && expanded.size < maxParts; i++) {
      expanded.add(parts[i]);
      const syns = map.get(parts[i].toLowerCase());
      if (syns) {
        for (const s of syns) {
          if (expanded.size >= maxParts) break;
          expanded.add(s);
        }
      }
    }
    return [...expanded].join(' ');
  }
}
