/**
 * index-manager.js — 索引管理器
 *
 * 职责：
 *   1. 增量添加/删除单个文档（解析 → 拆段 → 写 DB → 失效缓存）。
 *   2. 批量添加（事务写入）。
 *   3. 全量清空（用于 rebuildIndex）。
 *
 * 写入流程使用持久化 DB（openWriteDb），写入后失效只读缓存。
 */

import fs from 'node:fs';
import { splitMarkdown, resolveDocTitle } from '../parser/markdown-splitter.js';
import { buildSearchText } from './search-text-builder.js';

export default class IndexManager {
  /**
   * @param {import('../db/sqlite-backend.js').default} backend
   * @param {import('../tokenizer/tokenizer.js').default} tokenizer
   * @param {string} dbPath
   */
  constructor(backend, tokenizer, dbPath) {
    this.backend = backend;
    this.tokenizer = tokenizer;
    this.dbPath = dbPath;
  }

  /**
   * 增量添加单个文档。
   * @param {import('../types.js').DocumentInput} doc
   * @param {number} catalogId
   * @returns {Promise<void>}
   */
  async addDocument(doc, catalogId) {
    const db = await this.backend.openWriteDb(this.dbPath);

    // 先删除旧索引
    await this.deleteDocumentInternal(db, doc.documentId);

    // 解析 Markdown → segments
    const docTitle = doc.title || resolveDocTitle(doc.content, undefined, doc.documentId);
    const sources = splitMarkdown(doc.content, { documentId: doc.documentId, docTitle });

    const now = Date.now();
    db.exec('BEGIN');
    try {
      // 写入 documents 表
      const insertDoc = db.prepare(
        'INSERT INTO documents(document_id, catalog_id, doc_title, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      insertDoc.bind([
        doc.documentId,
        catalogId,
        docTitle,
        JSON.stringify(doc.metadata || {}),
        now,
        now,
      ]);
      insertDoc.step();
      insertDoc.finalize();

      const docRowId = db.selectValue('SELECT last_insert_rowid()');

      // 写入 segments 表（触发器自动同步 FTS）
      const insertSeg = db.prepare(
        'INSERT INTO segments(doc_id, section_title, lead_text, search_text, excerpt_truncated) VALUES (?, ?, ?, ?, ?)'
      );

      for (const source of sources) {
        const searchText = await buildSearchText(source, this.tokenizer);
        insertSeg.bind([
          docRowId,
          source.sectionTitle,
          source.leadText,
          searchText,
          source.excerptTruncated ? 1 : 0,
        ]);
        insertSeg.step();
        insertSeg.reset();
      }
      insertSeg.finalize();

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    this.backend.invalidateReadCache();
  }

  /**
   * 批量添加文档（外层事务）。
   * @param {Array<import('../types.js').DocumentInput & {catalogId:number}>} docs
   * @returns {Promise<void>}
   */
  async addDocuments(docs) {
    const db = await this.backend.openWriteDb(this.dbPath);
    db.exec('BEGIN');
    try {
      for (const doc of docs) {
        await this.addDocumentInternal(db, doc);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    this.backend.invalidateReadCache();
  }

  /**
   * 内部添加（复用已开启的事务）。
   * @param {any} db
   * @param {import('../types.js').DocumentInput & {catalogId:number}} doc
   */
  async addDocumentInternal(db, doc) {
    await this.deleteDocumentInternal(db, doc.documentId);

    const docTitle = doc.title || resolveDocTitle(doc.content, undefined, doc.documentId);
    const sources = splitMarkdown(doc.content, { documentId: doc.documentId, docTitle });
    const now = Date.now();

    const insertDoc = db.prepare(
      'INSERT INTO documents(document_id, catalog_id, doc_title, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertDoc.bind([
      doc.documentId,
      doc.catalogId,
      docTitle,
      JSON.stringify(doc.metadata || {}),
      now,
      now,
    ]);
    insertDoc.step();
    insertDoc.finalize();

    const docRowId = db.selectValue('SELECT last_insert_rowid()');

    const insertSeg = db.prepare(
      'INSERT INTO segments(doc_id, section_title, lead_text, search_text, excerpt_truncated) VALUES (?, ?, ?, ?, ?)'
    );

    for (const source of sources) {
      const searchText = await buildSearchText(source, this.tokenizer);
      insertSeg.bind([
        docRowId,
        source.sectionTitle,
        source.leadText,
        searchText,
        source.excerptTruncated ? 1 : 0,
      ]);
      insertSeg.step();
      insertSeg.reset();
    }
    insertSeg.finalize();
  }

  /**
   * 删除文档（级联删除 segments + FTS）。
   * @param {string} documentId
   * @returns {Promise<void>}
   */
  async deleteDocument(documentId) {
    const db = await this.backend.openWriteDb(this.dbPath);
    await this.deleteDocumentInternal(db, documentId);
    this.backend.invalidateReadCache();
  }

  /**
   * 内部删除（复用事务）。
   * @param {any} db
   * @param {string} documentId
   */
  async deleteDocumentInternal(db, documentId) {
    const stmt = db.prepare('DELETE FROM documents WHERE document_id = ?');
    stmt.bind([documentId]);
    stmt.step();
    stmt.finalize();
  }

  /**
   * 清空所有索引（用于全量重建）。
   * @returns {Promise<void>}
   */
  async clearAll() {
    const db = await this.backend.openWriteDb(this.dbPath);
    db.exec('DELETE FROM segments');
    db.exec('DELETE FROM documents');
    this.backend.invalidateReadCache();
  }

  /**
   * 获取统计信息（文档数、段数）。
   * @returns {Promise<{documentCount:number, segmentCount:number}>}
   */
  async getStats() {
    const db = await this.backend.openReadDb(this.dbPath);
    const documentCount = db.selectValue('SELECT COUNT(*) FROM documents') || 0;
    const segmentCount = db.selectValue('SELECT COUNT(*) FROM segments') || 0;
    return { documentCount, segmentCount };
  }
}
