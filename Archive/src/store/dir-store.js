/**
 * dir-store.js — 目录存储方案
 *
 * 将文档以 .md 文件形式存放在 docs/{catalog}/{path}.md。
 * 优势：写入快、调试方便、可 git 管理。
 *
 * 路径穿越防护：documentId 中禁止 .. 和绝对路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import DocStore from './doc-store.js';
import { PathSafetyError } from '../utils/path-safety.js';

export default class DirectoryDocStore extends DocStore {
  /**
   * @param {string} docsDir 文档根目录
   */
  constructor(docsDir) {
    super();
    this.docsDir = docsDir;
  }

  /**
   * 写入文档（自动创建父目录）。
   * @param {string} documentId
   * @param {string} content
   * @returns {Promise<void>}
   */
  async write(documentId, content) {
    const filePath = this.resolvePath(documentId);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }

  /**
   * 读取文档。不存在时返回 null。
   * @param {string} documentId
   * @returns {Promise<string|null>}
   */
  async read(documentId) {
    const filePath = this.resolvePath(documentId);
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * 删除文档（不存在时静默）。
   * @param {string} documentId
   * @returns {Promise<void>}
   */
  async delete(documentId) {
    const filePath = this.resolvePath(documentId);
    await fs.promises.rm(filePath, { force: true });
  }

  /**
   * 列出所有文档 ID（递归遍历）。
   * @returns {Promise<string[]>}
   */
  async list() {
    /** @type {string[]} */
    const results = [];

    const walk = async (dir, prefix) => {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, `${prefix}${entry.name}/`);
        } else if (entry.name.endsWith('.md')) {
          results.push(`${prefix}${entry.name.replace(/\.md$/, '')}`);
        }
      }
    };

    await walk(this.docsDir, '');
    return results;
  }

  /**
   * 将 documentId 解析为文件路径（含路径穿越防护）。
   * @param {string} documentId
   * @returns {string}
   */
  resolvePath(documentId) {
    const normalized = documentId.replace(/\\/g, '/');
    if (normalized.split('/').includes('..')) {
      throw new PathSafetyError('Invalid document ID: path traversal detected.');
    }
    return path.join(this.docsDir, `${normalized}.md`);
  }
}
