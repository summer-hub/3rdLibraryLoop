/**
 * search-engine.js — 搜索调度层
 *
 * 编排查询预处理 → FTS5 检索 → Rerank → 摘要提取的完整管道。
 * 作为 IndexManager/Engine 与底层 FtsSearch 之间的中间层，
 * 隔离查询逻辑与索引写入逻辑。
 */

import { prepareQuery } from './query-normalizer.js';
import FtsSearch from './fts-search.js';

export default class SearchEngine {
  /**
   * @param {import('../db/sqlite-backend.js').default} backend
   * @param {import('../tokenizer/tokenizer.js').default} tokenizer
   * @param {import('../tokenizer/lexicon.js').default} lexicon
   * @param {string} dbPath
   * @param {Map<string, any>} catalogMap
   * @param {function(string):number} catalogToId
   * @param {function(number):string} idToCatalog
   * @param {import('./query-rewriter.js').default} [rewriter]
   */
  constructor(backend, tokenizer, lexicon, dbPath, catalogMap, catalogToId, idToCatalog, rewriter) {
    this.backend = backend;
    this.tokenizer = tokenizer;
    this.lexicon = lexicon;
    this.dbPath = dbPath;
    this.catalogMap = catalogMap;
    this.catalogToId = catalogToId;
    this.idToCatalog = idToCatalog;
    this.rewriter = rewriter || null;

    this.fts = new FtsSearch(backend, dbPath, catalogMap, catalogToId, idToCatalog);
  }

  /**
   * 执行搜索。
   * @param {import('../types.js').SearchQuery} query
   * @param {import('../types.js').SearchOptions} [options]
   * @returns {Promise<import('../types.js').SearchResult[]>}
   */
  async search(query, options = {}) {
    if (!query.query || !query.query.trim()) return [];

    // 如果有自定义重写器，先扩展同义词
    let effectiveQuery = query.query;
    if (this.rewriter && options.expandSynonyms !== false) {
      effectiveQuery = this.rewriter.expand(
        query.query,
        this.lexicon,
        options.synonymExpandLimit
      );
    }

    // 查询预处理
    const prepared = await prepareQuery(
      effectiveQuery,
      this.tokenizer,
      this.lexicon,
      {
        expandSynonyms: options.expandSynonyms,
        synonymExpandLimit: options.synonymExpandLimit,
        preferAnd: options.preferAnd,
      }
    );

    if (!prepared.tokens || prepared.tokens.length === 0) return [];

    // FTS5 检索 + Rerank
    return this.fts.search(prepared, query);
  }
}
