/**
 * path-safety.js — 路径安全防护
 *
 * 职责：
 *   1. 验证数据目录可访问且为目录。
 *   2. 防止 documentId 路径穿越（禁止 .. 和绝对路径）。
 *   3. 校验文件在沙箱内、非常规符号链接。
 *
 * 与存储层配合，确保所有文件操作限制在 dataRoot 之内。
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 路径安全异常。
 */
export class PathSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

export default class PathSafety {
  /**
   * @param {string} dataRoot 数据根目录
   */
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
  }

  /**
   * 确保数据目录存在且为目录。
   * @returns {Promise<void>}
   */
  async assertDataDirSafe() {
    const realRoot = fs.realpathSync(this.dataRoot);
    const stat = await fs.promises.stat(realRoot);
    if (!stat.isDirectory()) {
      throw new PathSafetyError('Data directory is not a directory.');
    }
  }

  /**
   * 确保目标路径位于数据目录内，返回规范化后的绝对路径。
   * @param {string} target 相对 dataRoot 的路径
   * @param {string} label  诊断标签
   * @returns {string}
   */
  assertPathInside(target, label) {
    const realTarget = path.resolve(this.dataRoot, target);
    if (
      realTarget !== this.dataRoot &&
      !realTarget.startsWith(this.dataRoot + path.sep)
    ) {
      throw new PathSafetyError(`${label} resolves outside data directory.`);
    }
    return realTarget;
  }

  /**
   * 校验文件存在且为常规文件（非符号链接越界）。
   * 不存在时静默通过（交由调用方处理 ENOENT）。
   * @param {string} filePath
   */
  assertRegularFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        throw new PathSafetyError('Path must be a regular file.');
      }
      const realPath = fs.realpathSync(filePath);
      this.assertPathInside(realPath, 'file');
    } catch (error) {
      if (error instanceof PathSafetyError) throw error;
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
  }

  /**
   * 校验 documentId 合法性（防路径穿越）。
   * @param {string} documentId
   * @returns {string} 规范化后的 documentId
   */
  validateDocumentId(documentId) {
    const normalized = documentId.replace(/\\/g, '/');
    if (normalized.split('/').includes('..')) {
      throw new PathSafetyError('Invalid document ID: path traversal detected.');
    }
    if (normalized.startsWith('/')) {
      throw new PathSafetyError('Invalid document ID: absolute path not allowed.');
    }
    return normalized;
  }
}
