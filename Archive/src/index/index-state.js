/**
 * index-state.js — 索引状态管理
 *
 * 判断索引是否就绪、是否需要重建（版本变更、词典指纹变更等），
 * 并持久化索引元数据到 meta.json。
 */

import fs from 'node:fs';
import { INDEX_VERSION } from '../constants.js';

/**
 * @typedef {Object} IndexMeta
 * @property {string} indexVersion
 * @property {string} termsHash
 * @property {string} synonymsHash
 * @property {number} segmentCount
 * @property {number} builtAt
 */

/** @typedef {'no-index'|'engine-upgraded'|'terms-changed'|'synonyms-changed'} RebuildReason */

export default class IndexState {
  /**
   * @param {string} dbPath
   * @param {string} metaPath
   * @param {import('../tokenizer/lexicon.js').default} lexicon
   */
  constructor(dbPath, metaPath, lexicon) {
    this.dbPath = dbPath;
    this.metaPath = metaPath;
    this.lexicon = lexicon;
  }

  /**
   * 索引是否就绪（DB 文件存在且有段数据）。
   * @returns {Promise<boolean>}
   */
  async isReady() {
    if (!fs.existsSync(this.dbPath)) return false;
    const meta = await this.readMeta();
    if (!meta || meta.segmentCount === 0) return false;
    return true;
  }

  /**
   * 判断是否需要重建及原因。
   * @returns {Promise<RebuildReason|null>}
   */
  async needsRebuild() {
    const meta = await this.readMeta();
    if (!meta || meta.segmentCount === 0) return 'no-index';
    if (meta.indexVersion !== INDEX_VERSION) return 'engine-upgraded';
    if (meta.termsHash !== this.lexicon.getTermsHash()) return 'terms-changed';
    if (meta.synonymsHash !== this.lexicon.getSynonymsHash()) return 'synonyms-changed';
    return null;
  }

  /**
   * 读取元数据。
   * @returns {Promise<IndexMeta|null>}
   */
  async readMeta() {
    try {
      const raw = await fs.promises.readFile(this.metaPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * 写入元数据。
   * @param {IndexMeta} meta
   * @returns {Promise<void>}
   */
  async writeMeta(meta) {
    await fs.promises.writeFile(this.metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  /**
   * 更新构建完成后的元数据。
   * @param {number} segmentCount
   * @returns {Promise<void>}
   */
  async markBuilt(segmentCount) {
    await this.writeMeta({
      indexVersion: INDEX_VERSION,
      termsHash: this.lexicon.getTermsHash(),
      synonymsHash: this.lexicon.getSynonymsHash(),
      segmentCount,
      builtAt: Date.now(),
    });
  }
}
