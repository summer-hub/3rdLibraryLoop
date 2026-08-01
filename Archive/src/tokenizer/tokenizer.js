/**
 * tokenizer.js — jieba-wasm 分词器
 *
 * 职责：
 *   - 索引时使用搜索引擎模式（cutForSearch，更细粒度，高召回）。
 *   - 查询时使用精确模式（cut，高准确率）。
 *   - 合并装饰器（@ + Component → @Component）。
 *   - 去停用词、保留大小写变体。
 *
 * WASM 模块懒加载 + 单例缓存；若 jieba-wasm 未安装，
 * 回退到基于正则的简易分词（中英文按词切分），保证可用性。
 */

import path from 'node:path';

export default class Tokenizer {
  /**
   * @param {string} lexiconDir 词典目录
   * @param {import('../tokenizer/lexicon.js').default} lexicon 词典管理器
   * @param {string[]} [customTerms=[]] 自定义术语
   */
  constructor(lexiconDir, lexicon, customTerms = []) {
    this.lexiconDir = lexiconDir;
    this.lexicon = lexicon;
    this.customTerms = customTerms;
    /** @type {any|null} */
    this.jieba = null;
    this.initPromise = null;
  }

  /**
   * 初始化 jieba-wasm（懒加载单例）。
   * @returns {Promise<void>}
   */
  async init() {
    await this.getJieba();
  }

  /**
   * 获取 jieba 实例（带并发安全）。
   * @returns {Promise<any>}
   */
  async getJieba() {
    if (this.jieba) return this.jieba;
    if (!this.initPromise) {
      this.initPromise = this.createJieba().then((j) => {
        this.jieba = j;
        return j;
      });
    }
    return this.initPromise;
  }

  /**
   * 创建 jieba 实例，加载领域词典。
   * 失败时回退到简易分词。
   * @returns {Promise<any>}
   */
  async createJieba() {
    try {
      const mod = await import('jieba-wasm');
      const { cut, cut_for_search, with_dict } = mod;

      // 加载领域词典
      const terms = this.lexicon.readTerms();
      const allTerms = [...terms, ...this.customTerms];
      if (allTerms.length > 0 && typeof with_dict === 'function') {
        with_dict(allTerms.join('\n'));
      }

      return {
        cut: (text, hmm) => cut(text, hmm),
        cutForSearch: (text, hmm) => cut_for_search(text, hmm),
      };
    } catch {
      // 回退：简易分词
      return {
        cut: (text) => simpleTokenize(text),
        cutForSearch: (text) => simpleTokenize(text),
      };
    }
  }

  /**
   * 索引时分词（搜索引擎模式，细粒度）。
   * @param {string} text
   * @returns {Promise<string[]>}
   */
  async tokenizeForIndex(text) {
    const jieba = await this.getJieba();
    return this.normalize(jieba.cutForSearch(text, true));
  }

  /**
   * 查询时分词（精确模式）。
   * @param {string} text
   * @returns {Promise<string[]>}
   */
  async tokenizeForQuery(text) {
    const jieba = await this.getJieba();
    return this.normalize(jieba.cut(text, true));
  }

  /**
   * 添加自定义术语（影响 jieba 分词）。
   * @param {string[]} words
   */
  addTerms(words) {
    this.customTerms.push(...words);
    // 重置 jieba 以便下次重新加载词典
    this.jieba = null;
    this.initPromise = null;
  }

  /**
   * 规范化 token：合并装饰器、去停用词、保留大小写变体。
   * @param {string[]} tokens
   * @returns {string[]}
   */
  normalize(tokens) {
    const stops = this.lexicon.readStopWords();
    /** @type {string[]} */
    const out = [];
    for (const raw of this.mergeDecorators(tokens)) {
      const token = raw.trim();
      if (!token || stops.has(token)) continue;
      out.push(token.toLowerCase());
      // 保留原始大小写（FTS5 对大小写敏感）
      if (/[A-Z]/.test(token)) out.push(token);
    }
    return out;
  }

  /**
   * 合并 "@" + "Component" → "@Component"。
   * @param {string[]} tokens
   * @returns {string[]}
   */
  mergeDecorators(tokens) {
    /** @type {string[]} */
    const merged = [];
    for (let i = 0; i < tokens.length; i++) {
      const current = tokens[i]?.trim();
      const next = tokens[i + 1]?.trim();
      if (current === '@' && next && /^[A-Z][a-zA-Z0-9]*$/.test(next)) {
        merged.push(`@${next}`);
        i++;
      } else if (current) {
        merged.push(current);
      }
    }
    return merged;
  }
}

/**
 * 简易分词回退方案（jieba-wasm 不可用时使用）。
 * 中文按字符切分，英文/数字按词切分。
 * @param {string} text
 * @returns {string[]}
 */
function simpleTokenize(text) {
  if (!text) return [];
  // 匹配：英文词、数字、中文字符
  const matches = text.match(/[a-zA-Z_][a-zA-Z0-9_]*|\d+|[\u4e00-\u9fa5]/g);
  return matches || [];
}
