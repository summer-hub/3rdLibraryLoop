/**
 * hash.js — SHA256 文本哈希工具
 *
 * 用于词典指纹计算（判断是否需要重建索引）。
 */

import { createHash } from 'node:crypto';

/**
 * 计算文本的 SHA256 指纹（十六进制字符串）。
 * @param {string} text
 * @returns {string} 64 位十六进制哈希
 */
export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}
