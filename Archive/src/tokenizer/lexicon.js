/**
 * lexicon.js — 词典文件管理
 *
 * 读取领域术语词典、同义词表、停用词表；
 * 支持同义词扩展与词典指纹计算（用于判断是否需要重建索引）。
 *
 * 词典文件位置由 lexiconDir 指定，支持自定义覆盖内置默认词典。
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256Text } from '../utils/hash.js';

export default class Lexicon {
  /**
   * @param {string} lexiconDir 词典目录
   */
  constructor(lexiconDir) {
    this.lexiconDir = lexiconDir;
    /** @type {Map<string, Set<string>>|null} */
    this.synonymMap = null;
    /** @type {Set<string>|null} */
    this.stopWords = null;
    this.termsHash = null;
    this.synonymsHash = null;
  }

  /**
   * 读取术语词典（一行一个）。
   * 文件不存在时返回空数组。
   * @returns {string[]}
   */
  readTerms() {
    try {
      const content = fs.readFileSync(path.join(this.lexiconDir, 'terms.txt'), 'utf-8');
      return content.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * 读取同义词表（JSON 数组）。
   * @returns {string[][]}
   */
  readSynonyms() {
    try {
      const content = fs.readFileSync(path.join(this.lexiconDir, 'synonyms.json'), 'utf-8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * 读取停用词表。
   * @returns {Set<string>}
   */
  readStopWords() {
    if (this.stopWords) return this.stopWords;
    try {
      const content = fs.readFileSync(path.join(this.lexiconDir, 'stopwords.txt'), 'utf-8');
      this.stopWords = new Set(content.split('\n').map((l) => l.trim()).filter(Boolean));
    } catch {
      this.stopWords = new Set();
    }
    return this.stopWords;
  }

  /**
   * 构建同义词映射（双向）。
   * @returns {Map<string, Set<string>>}
   */
  getSynonymMap() {
    if (this.synonymMap) return this.synonymMap;

    this.synonymMap = new Map();
    const groups = this.readSynonyms();
    for (const group of groups) {
      if (!Array.isArray(group) || group.length < 2) continue;
      for (const word of group) {
        const key = word.toLowerCase();
        if (!this.synonymMap.has(key)) {
          this.synonymMap.set(key, new Set());
        }
        for (const other of group) {
          if (other !== word) this.synonymMap.get(key).add(other);
        }
      }
    }
    return this.synonymMap;
  }

  /**
   * 同义词扩展：将查询中的词扩展为同义词集合。
   * @param {string} query 原始查询（空格分隔）
   * @param {number} [maxParts=8] 最大扩展词条数
   * @returns {string} 扩展后的查询（空格分隔）
   */
  expandSynonyms(query, maxParts = 8) {
    const map = this.getSynonymMap();
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

  /**
   * 术语词典指纹（SHA256）。
   * @returns {string}
   */
  getTermsHash() {
    if (!this.termsHash) {
      try {
        const content = fs.readFileSync(path.join(this.lexiconDir, 'terms.txt'), 'utf-8');
        this.termsHash = sha256Text(content);
      } catch {
        this.termsHash = 'empty';
      }
    }
    return this.termsHash;
  }

  /**
   * 同义词表指纹（SHA256）。
   * @returns {string}
   */
  getSynonymsHash() {
    if (!this.synonymsHash) {
      try {
        const content = fs.readFileSync(path.join(this.lexiconDir, 'synonyms.json'), 'utf-8');
        this.synonymsHash = sha256Text(content);
      } catch {
        this.synonymsHash = 'empty';
      }
    }
    return this.synonymsHash;
  }
}
