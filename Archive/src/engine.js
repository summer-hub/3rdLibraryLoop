/**
 * engine.js — DocSearchEngine 核心门面
 *
 * 统一编排存储层、索引层、搜索层、词典分词层和安全层，
 * 对外提供 search / addDocument / removeDocument / rebuildIndex / getStatus 等接口。
 *
 * 设计原则：
 *   - 高内聚：所有文档检索相关逻辑集中于此门面。
 *   - 低耦合：各子模块通过构造注入，可独立替换/测试。
 *   - 写入串行：通过文件锁保证写入安全；查询无锁。
 */

import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CATALOGS, INDEX_VERSION, DEFAULT_DATA_DIR, GIT_WARN_BYTES } from './constants.js';
import { resolveRuntimePaths } from './utils/paths.js';
import PathSafety, { PathSafetyError } from './utils/path-safety.js';
import { acquireLock } from './utils/lock.js';
import SqliteBackend from './db/sqlite-backend.js';
import DirectoryDocStore from './store/dir-store.js';
import Lexicon from './tokenizer/lexicon.js';
import Tokenizer from './tokenizer/tokenizer.js';
import IndexManager from './index/index-manager.js';
import IndexState from './index/index-state.js';
import SearchEngine from './search/search-engine.js';
import QueryRewriter from './search/query-rewriter.js';

export default class DocSearchEngine {
  constructor() {
    /** @type {import('./types.js').EngineOptions|null} */
    this.options = null;
    this.paths = null;
    /** @type {import('./store/doc-store.js').default|null} */
    this.store = null;
    this.backend = null;
    this.indexManager = null;
    this.searchEngine = null;
    this.tokenizer = null;
    this.lexicon = null;
    this.indexState = null;
    this.pathSafety = null;
    this.rewriter = new QueryRewriter();
    /** @type {Map<string, import('./types.js').CatalogConfig>} */
    this.catalogMap = new Map();
    /** @type {Map<number, string>} */
    this.idToCatalogMap = new Map();
    this.initialized = false;
  }

  /**
   * 初始化引擎。
   * @param {import('./types.js').EngineOptions} options
   * @returns {Promise<void>}
   */
  async init(options = {}) {
    this.options = options;

    // 1. 数据目录（未指定时使用内置默认路径 Archive/data）
    const dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.pathSafety = new PathSafety(dataDir);
    await fs.promises.mkdir(dataDir, { recursive: true });
    await this.pathSafety.assertDataDirSafe();

    this.paths = resolveRuntimePaths(dataDir);
    await fs.promises.mkdir(this.paths.docsDir, { recursive: true });
    await fs.promises.mkdir(this.paths.indexDir, { recursive: true });

    // 2. 目录映射
    this.catalogMap = new Map();
    for (const cat of (options.catalogs || DEFAULT_CATALOGS)) {
      this.catalogMap.set(cat.id, cat);
    }
    this.idToCatalogMap = new Map();
    let i = 0;
    for (const [id] of this.catalogMap) {
      this.idToCatalogMap.set(i, id);
      i++;
    }

    // 3. 词典（未指定 lexiconDir 时使用内置默认词典）
    const builtinLexiconDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      'data'
    );
    const lexiconDir = options.lexiconDir || builtinLexiconDir;
    this.lexicon = new Lexicon(lexiconDir);
    this.tokenizer = new Tokenizer(lexiconDir, this.lexicon);
    await this.tokenizer.init();

    // 4. DB
    const dbPath = options.dbPath || this.paths.dbPath;
    this.backend = new SqliteBackend();
    await this.backend.init();
    await this.backend.openWriteDb(dbPath);

    // 5. 存储
    this.store = new DirectoryDocStore(this.paths.docsDir);

    // 6. 索引 + 搜索
    this.indexManager = new IndexManager(this.backend, this.tokenizer, dbPath);
    this.indexState = new IndexState(dbPath, this.paths.metaPath, this.lexicon);
    this.searchEngine = new SearchEngine(
      this.backend,
      this.tokenizer,
      this.lexicon,
      dbPath,
      this.catalogMap,
      (cat) => this.catalogToId(cat),
      (id) => this.idToCatalog(id),
      this.rewriter
    );

    this._dbPath = dbPath;
    this.initialized = true;
  }

  // ─── 查询 ──────────────────────────────────────────────────────

  /**
   * 搜索文档。
   * @param {import('./types.js').SearchQuery} query
   * @param {import('./types.js').SearchOptions} [options]
   * @returns {Promise<import('./types.js').SearchResult[]>}
   */
  async search(query, options) {
    this.assertReady();
    return this.searchEngine.search(query, options);
  }

  /**
   * 获取文档全文。
   * @param {string} documentId
   * @returns {Promise<string|null>}
   */
  async getDocument(documentId) {
    this.assertReady();
    this.pathSafety.validateDocumentId(documentId);
    return this.store.read(documentId);
  }

  /**
   * 获取文档完整记录（含元数据）。
   * @param {string} documentId
   * @returns {Promise<import('./types.js').DocumentRecord|null>}
   */
  async getDocumentRecord(documentId) {
    this.assertReady();
    this.pathSafety.validateDocumentId(documentId);

    const content = await this.store.read(documentId);
    if (content === null) return null;

    const db = await this.backend.openReadDb(this._dbPath);
    const stmt = db.prepare(
      'SELECT document_id, catalog_id, doc_title, metadata, created_at, updated_at FROM documents WHERE document_id = ?'
    );
    stmt.bind([documentId]);
    let row = null;
    if (stmt.step()) row = stmt.get();
    stmt.finalize();

    if (!row) {
      // 文件存在但无索引记录
      return {
        documentId,
        title: documentId,
        catalog: this.inferCatalogFromId(documentId),
        content,
        segmentCount: 0,
        metadata: {},
        createdAt: 0,
        updatedAt: 0,
      };
    }

    const segStmt = db.prepare('SELECT COUNT(*) AS cnt FROM segments WHERE doc_id = (SELECT id FROM documents WHERE document_id = ?)');
    segStmt.bind([documentId]);
    segStmt.step();
    const segCount = segStmt.get().cnt || 0;
    segStmt.finalize();

    return {
      documentId: row.document_id,
      title: row.doc_title,
      catalog: this.idToCatalog(row.catalog_id),
      content,
      segmentCount: segCount,
      metadata: safeParseJson(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─── 写入 ──────────────────────────────────────────────────────

  /**
   * 检查文档是否已存在于索引中。
   * @param {string} documentId
   * @returns {Promise<boolean>}
   */
  async hasDocument(documentId) {
    this.assertReady();
    this.pathSafety.validateDocumentId(documentId);
    const db = await this.backend.openReadDb(this._dbPath);
    const count = db.selectValue(
      'SELECT COUNT(*) AS cnt FROM documents WHERE document_id = ?',
      documentId
    );
    return count > 0;
  }

  /**
   * 添加或更新文档。
   * @param {import('./types.js').DocumentInput} doc
   * @returns {Promise<void>}
   */
  async addDocument(doc) {
    this.assertReady();
    this.pathSafety.validateDocumentId(doc.documentId);
    const catalogId = this.catalogToId(doc.catalog);

    const release = await acquireLock(this.paths.lockPath);
    try {
      await this.store.write(doc.documentId, doc.content);
      await this.indexManager.addDocument(doc, catalogId);
      await this.updateMetaAfterWrite();
    } finally {
      await release();
    }
  }

  /**
   * 批量添加文档。
   * @param {import('./types.js').DocumentInput[]} docs
   * @returns {Promise<void>}
   */
  async addDocuments(docs) {
    this.assertReady();
    for (const doc of docs) {
      this.pathSafety.validateDocumentId(doc.documentId);
    }

    const release = await acquireLock(this.paths.lockPath);
    try {
      for (const doc of docs) {
        await this.store.write(doc.documentId, doc.content);
      }
      const docsWithCatalogId = docs.map((doc) => ({
        ...doc,
        catalogId: this.catalogToId(doc.catalog),
      }));
      await this.indexManager.addDocuments(docsWithCatalogId);
      await this.updateMetaAfterWrite();
    } finally {
      await release();
    }
  }

  /**
   * 删除文档。
   * @param {string} documentId
   * @returns {Promise<void>}
   */
  async removeDocument(documentId) {
    this.assertReady();
    this.pathSafety.validateDocumentId(documentId);

    const release = await acquireLock(this.paths.lockPath);
    try {
      await this.store.delete(documentId);
      await this.indexManager.deleteDocument(documentId);
      await this.updateMetaAfterWrite();
    } finally {
      await release();
    }
  }

  // ─── 索引管理 ──────────────────────────────────────────────────

  /**
   * 全量重建索引。
   * @returns {Promise<void>}
   */
  async rebuildIndex() {
    this.assertReady();
    const release = await acquireLock(this.paths.lockPath);
    try {
      const documentIds = await this.store.list();
      await this.indexManager.clearAll();

      /** @type {Array<import('./types.js').DocumentInput & {catalogId:number}>} */
      const docs = [];
      for (const id of documentIds) {
        const content = await this.store.read(id);
        if (content) {
          const catalog = this.inferCatalogFromId(id);
          docs.push({
            documentId: id,
            catalog,
            catalogId: this.catalogToId(catalog),
            content,
          });
        }
      }
      await this.indexManager.addDocuments(docs);

      const stats = await this.indexManager.getStats();
      await this.indexState.markBuilt(stats.segmentCount);

      // 重建后自动 VACUUM 回收碎片空间
      await this.backend.vacuum();
    } finally {
      await release();
    }
  }

  /**
   * 压缩数据库（VACUUM），回收删除/更新产生的碎片空间。
   * 建议在批量删除文档后手动调用。
   * @returns {Promise<void>}
   */
  async vacuum() {
    this.assertReady();
    const release = await acquireLock(this.paths.lockPath);
    try {
      await this.backend.vacuum();
    } finally {
      await release();
    }
  }

  /**
   * 将 WAL 日志合并回主库文件（checkpoint）。
   * 确保 git 提交的 .db 文件包含所有最新写入。
   * @returns {Promise<void>}
   */
  async checkpoint() {
    this.assertReady();
    await this.backend.checkpoint();
  }

  /**
   * 获取引擎状态。
   * @returns {Promise<import('./types.js').EngineStatus>}
   */
  async getStatus() {
    if (!this.initialized) {
      return {
        ready: false,
        documentCount: 0,
        segmentCount: 0,
        dbSizeBytes: 0,
        indexVersion: INDEX_VERSION,
        lastBuiltAt: null,
        isWriting: false,
        dbSizeWarning: false,
      };
    }

    const stats = await this.indexManager.getStats();
    let dbSizeBytes = 0;
    try {
      const stat = await fs.promises.stat(this._dbPath);
      dbSizeBytes = stat.size;
    } catch {
      // DB 文件可能尚未创建
    }

    const meta = await this.indexState.readMeta();

    return {
      ready: true,
      documentCount: stats.documentCount,
      segmentCount: stats.segmentCount,
      dbSizeBytes,
      indexVersion: INDEX_VERSION,
      lastBuiltAt: meta?.builtAt ?? null,
      isWriting: false,
      dbSizeWarning: dbSizeBytes >= GIT_WARN_BYTES,
    };
  }

  // ─── 高级接口 ──────────────────────────────────────────────────

  /**
   * 原始 SQL 查询（高级用户直接查 FTS5）。
   * @param {string} sql
   * @param {...unknown} params
   * @returns {Promise<any[]>}
   */
  async rawQuery(sql, ...params) {
    this.assertReady();
    const db = await this.backend.openReadDb(this._dbPath);
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    /** @type {any[]} */
    const rows = [];
    while (stmt.step()) rows.push(stmt.get());
    stmt.finalize();
    return rows;
  }

  /**
   * 注册自定义同义词组。
   * @param {string[]} words
   */
  addSynonyms(words) {
    this.rewriter.addSynonyms(words);
  }

  /**
   * 添加自定义词典词条（影响 jieba 分词）。
   * @param {string[]} words
   */
  addTerms(words) {
    this.tokenizer.addTerms(words);
  }

  /**
   * 关闭引擎，释放资源。
   * @returns {Promise<void>}
   */
  async close() {
    if (this.backend) await this.backend.close();
    this.initialized = false;
  }

  // ─── 内部辅助 ──────────────────────────────────────────────────

  /**
   * catalog id → 数字 ID。
   * @param {string} catalog
   * @returns {number}
   * @private
   */
  catalogToId(catalog) {
    let idx = 0;
    for (const [id] of this.catalogMap) {
      if (id === catalog) return idx;
      idx++;
    }
    throw new Error(`Unknown catalog: ${catalog}`);
  }

  /**
   * 数字 ID → catalog id。
   * @param {number} id
   * @returns {string}
   * @private
   */
  idToCatalog(id) {
    return this.idToCatalogMap.get(id) || 'unknown';
  }

  /**
   * 从 documentId 推断 catalog。
   * @param {string} documentId
   * @returns {string}
   * @private
   */
  inferCatalogFromId(documentId) {
    const firstSeg = documentId.split('/')[0];
    if (this.catalogMap.has(firstSeg)) return firstSeg;
    return this.catalogMap.keys().next().value;
  }

  /**
   * 写入后更新元数据。
   * @returns {Promise<void>}
   * @private
   */
  async updateMetaAfterWrite() {
    const stats = await this.indexManager.getStats();
    await this.indexState.markBuilt(stats.segmentCount);
  }

  /**
   * 断言引擎已初始化。
   * @private
   */
  assertReady() {
    if (!this.initialized) {
      throw new Error('Engine not initialized. Call init() first.');
    }
  }
}

/**
 * 安全解析 JSON。
 * @param {string} raw
 * @returns {Record<string, string>}
 */
function safeParseJson(raw) {
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}
