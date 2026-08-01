/**
 * paths.js — 路径管理工具
 *
 * 集中计算 docs / .index / lock / meta 等运行时子路径，
 * 保证全模块路径拼接一致。
 */

import path from 'node:path';

/**
 * 计算运行时各子目录/文件路径。
 * @param {string} dataDir 数据根目录
 * @returns {{
 *   dataDir: string,
 *   docsDir: string,
 *   indexDir: string,
 *   dbPath: string,
 *   metaPath: string,
 *   lockPath: string,
 *   termsPath: string,
 *   synonymsPath: string,
 *   stopwordsPath: string,
 * }}
 */
export function resolveRuntimePaths(dataDir) {
  const docsDir = path.join(dataDir, 'docs');
  const indexDir = path.join(dataDir, '.index');
  return {
    dataDir,
    docsDir,
    indexDir,
    dbPath: path.join(indexDir, 'search.db'),
    metaPath: path.join(indexDir, 'meta.json'),
    lockPath: path.join(indexDir, 'write.lock'),
    termsPath: path.join(indexDir, 'terms.txt'),
    synonymsPath: path.join(indexDir, 'synonyms.json'),
    stopwordsPath: path.join(indexDir, 'stopwords.txt'),
  };
}
