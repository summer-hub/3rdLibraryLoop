/**
 * fts-search.js — FTS5 查询执行 + Rerank 重排序
 *
 * 职责：
 *   1. 执行 FTS5 MATCH 查询，获取 BM25 排序结果。
 *   2. 多层 boost 调整：
 *      - 目录权重（catalogBoost）
 *      - 标题匹配 boost（精确/前缀/全分词包含）
 *      - API 符号匹配 boost（Manager API 强提升）
 *   3. 同文档多段去重（只保留最佳段）。
 *   4. AND/OR 回退策略。
 *
 * 查询使用只读内存 DB（反序列化），高性能无磁盘 I/O。
 */

import { RERANK_POOL_FACTOR } from '../constants.js';
import {
  buildFtsOrMatch,
  buildFtsAndMatch,
} from './query-normalizer.js';
import { extractSnippet } from './snippet.js';
import { matchApiSymbol } from '../parser/api-identifiers.js';
import { isManagerApi } from '../parser/api-suffixes.js';
import {
  computeCatalogBoosts,
  getTailCatalogIds,
} from './catalog-routing.js';

/**
 * @typedef {import('../types.js').SearchResult} SearchResult
 */

/**
 * FTS5 查询基础 SQL（全局）。
 */
const FTS_SEARCH_SQL = `
SELECT
  d.document_id,
  d.doc_title,
  s.section_title,
  s.lead_text,
  s.excerpt_truncated,
  d.catalog_id,
  s.id AS segment_id,
  bm25(segments_fts) AS bm25
FROM segments_fts
JOIN segments s ON s.id = segments_fts.rowid
JOIN documents d ON d.id = s.doc_id
WHERE segments_fts MATCH ?
ORDER BY bm25(segments_fts)
LIMIT ?;
`;

/**
 * FTS5 查询基础 SQL（目录限定）。
 */
const FTS_SEARCH_CATALOG_SQL = `
SELECT
  d.document_id,
  d.doc_title,
  s.section_title,
  s.lead_text,
  s.excerpt_truncated,
  d.catalog_id,
  s.id AS segment_id,
  bm25(segments_fts) AS bm25
FROM segments_fts
JOIN segments s ON s.id = segments_fts.rowid
JOIN documents d ON d.id = s.doc_id
WHERE segments_fts MATCH ? AND d.catalog_id = ?
ORDER BY bm25(segments_fts)
LIMIT ?;
`;

export default class FtsSearch {
  /**
   * @param {import('../db/sqlite-backend.js').default} backend
   * @param {string} dbPath
   * @param {Map<string, any>} catalogMap
   * @param {function(string):number} catalogToId
   * @param {function(number):string} idToCatalog
   */
  constructor(backend, dbPath, catalogMap, catalogToId, idToCatalog) {
    this.backend = backend;
    this.dbPath = dbPath;
    this.catalogMap = catalogMap;
    this.catalogToId = catalogToId;
    this.idToCatalog = idToCatalog;
  }

  /**
   * 执行搜索（含 AND/OR 回退 + Rerank + 去重）。
   * @param {{rawQuery:string, tokens:string[], preferAnd:boolean, ftsMatch:string|null}} prepared
   * @param {{catalog?:string, limit?:number, includeSnippet?:boolean, snippetMaxChars?:number}} query
   * @param {string[]} [apiSymbols] 当前段 API 符号（可选，用于 boost）
   * @returns {Promise<SearchResult[]>}
   */
  async search(prepared, query) {
    if (!prepared.tokens || prepared.tokens.length === 0) return [];

    const limit = query.limit || 10;
    const poolSize = limit * RERANK_POOL_FACTOR;
    const catalogId = query.catalog ? this.catalogToId(query.catalog) : undefined;

    // AND/OR 回退策略
    let rows = [];
    if (prepared.preferAnd) {
      const andMatch = buildFtsAndMatch(prepared.tokens);
      const andRows = await this.runMatch(andMatch, catalogId, poolSize);
      if (andRows.length >= limit) {
        rows = andRows;
      } else {
        // 不足 limit，用 OR 补全
        const orMatch = buildFtsOrMatch(prepared.tokens);
        const orRows = await this.runMatch(orMatch, catalogId, poolSize);
        rows = mergeAndDedupe(andRows, orRows, poolSize);
      }
    } else {
      const match = prepared.ftsMatch || buildFtsOrMatch(prepared.tokens);
      rows = await this.runMatch(match, catalogId, poolSize);
    }

    // Rerank
    const reranked = this.rerank(rows, prepared);

    // 同文档去重
    const deduped = pickBestSegmentForDocument(reranked);

    // 截取 limit
    const topResults = deduped.slice(0, limit);

    // 转换为 SearchResult
    const includeSnippet = query.includeSnippet !== false;
    const snippetMaxChars = query.snippetMaxChars || 200;

    return topResults.map((row) => ({
      documentId: row.document_id,
      title: row.doc_title,
      sectionTitle: row.section_title || row.doc_title,
      snippet: includeSnippet
        ? extractSnippet(row.lead_text || '', prepared.rawQuery, snippetMaxChars)
        : '',
      score: row.effectiveScore,
      rawScore: row.bm25,
      catalog: this.idToCatalog(row.catalog_id),
    }));
  }

  /**
   * 执行一次 FTS MATCH 查询。
   * @param {string} matchExpr FTS MATCH 表达式
   * @param {number|undefined} catalogId 目录限定
   * @param {number} limit
   * @returns {Promise<any[]>}
   */
  async runMatch(matchExpr, catalogId, limit) {
    if (!matchExpr) return [];
    const db = await this.backend.openReadDb(this.dbPath);

    let stmt;
    if (catalogId !== undefined) {
      stmt = db.prepare(FTS_SEARCH_CATALOG_SQL);
      stmt.bind([matchExpr, catalogId, limit]);
    } else {
      stmt = db.prepare(FTS_SEARCH_SQL);
      stmt.bind([matchExpr, limit]);
    }

    /** @type {any[]} */
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.get());
    }
    stmt.finalize();
    return rows;
  }

  /**
   * Rerank：多层 boost 调整 effectiveScore。
   * @param {any[]} rows
   * @param {{rawQuery:string, tokens:string[]}} prepared
   * @returns {any[]}
   */
  rerank(rows, prepared) {
    const boosts = computeCatalogBoosts(
      prepared.rawQuery,
      prepared.tokens,
      this.catalogMap,
      this.catalogToId
    );
    const tailIds = getTailCatalogIds(this.catalogMap, this.catalogToId);

    for (const row of rows) {
      const catalogBoost = boosts.get(row.catalog_id) ?? 1.0;
      const tailPenalty = tailIds.has(row.catalog_id) ? 1.2 : 1.0;

      // baseScore: BM25 除以目录 boost（boost 越大分数越小 = 更靠前）
      const baseScore = (row.bm25 || 0) / catalogBoost * tailPenalty;

      // titleBoost
      const titleLower = (row.section_title || row.doc_title || '').toLowerCase();
      let titleMultiplier = 1.0;
      const queryLower = prepared.rawQuery.toLowerCase();
      if (titleLower === queryLower) {
        titleMultiplier = 4.0;
      } else if (titleLower.startsWith(queryLower.slice(0, 6)) && queryLower.length >= 6) {
        titleMultiplier = 1.8;
      } else {
        // 标题包含所有分词
        const allInTitle = prepared.tokens.every((t) => titleLower.includes(t.toLowerCase()));
        if (allInTitle) titleMultiplier = 1.35;
      }

      // apiSymbolBoost: 判断标题是否含 Manager API
      let apiMultiplier = 1.0;
      if (isManagerApi(row.section_title || '')) {
        apiMultiplier = 3.5;
        if (this.idToCatalog(row.catalog_id) === 'references') {
          apiMultiplier *= 1.4;
        }
      } else {
        // 检查 token 是否匹配 API 符号
        const symbols = [row.section_title, row.doc_title].filter(Boolean);
        const anyMatch = prepared.tokens.some((t) => matchApiSymbol(t, symbols));
        if (anyMatch) apiMultiplier = 1.5;
      }

      row.effectiveScore = baseScore / (titleMultiplier * apiMultiplier);
      row.rawScore = row.bm25;
    }

    // 按 effectiveScore 升序（越小越相关）
    rows.sort((a, b) => a.effectiveScore - b.effectiveScore);
    return rows;
  }
}

/**
 * AND + OR 结果合并去重。
 * @param {any[]} andRows
 * @param {any[]} orRows
 * @param {number} limit
 * @returns {any[]}
 */
function mergeAndDedupe(andRows, orRows, limit) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {any[]} */
  const result = [];
  for (const row of andRows) {
    const key = `${row.document_id}:${row.segment_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
  }
  for (const row of orRows) {
    const key = `${row.document_id}:${row.segment_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(row);
    }
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * 同文档多段去重：只保留最佳段。
 * @param {any[]} rows 已按 effectiveScore 排序
 * @returns {any[]}
 */
function pickBestSegmentForDocument(rows) {
  /** @type {Map<string, any>} */
  const bestByDoc = new Map();
  /** @type {any[]} */
  const ordered = [];

  for (const row of rows) {
    const docId = row.document_id;
    if (!bestByDoc.has(docId)) {
      bestByDoc.set(docId, row);
      ordered.push(row);
    }
    // 已有该文档的段，跳过（保留第一个 = 最佳）
  }

  return ordered;
}
