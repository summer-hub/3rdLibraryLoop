/**
 * index.js — Archive 对外统一导出入口
 *
 * 仅导出对外有价值的公共接口，外部导入本文件即可使用全部功能。
 *
 * 使用示例：
 *
 *   import { DocSearchEngine, DEFAULT_CATALOGS } from './Archive/index.js';
 *
 *   const engine = new DocSearchEngine();
 *   await engine.init();  // 默认使用 Archive/data 目录
 *
 *   await engine.addDocument({
 *     documentId: 'guides/intro',
 *     catalog: 'guides',
 *     content: '# 入门指南\n这是一篇入门文档。',
 *   });
 *
 *   const results = await engine.search({ query: '入门', limit: 5 });
 *
 *   const status = await engine.getStatus();
 *   if (status.dbSizeWarning) console.warn('数据库接近 git 提交大小阈值');
 *
 *   await engine.close();  // 自动 checkpoint 合并 WAL
 */

// ── 核心引擎（主要入口） ──
export { default as DocSearchEngine } from './src/engine.js';

// ── 常量（外部可能需要引用的配置项） ──
export {
  DEFAULT_DATA_DIR,
  DEFAULT_CATALOGS,
  INDEX_VERSION,
  GIT_WARN_BYTES,
} from './src/constants.js';

// ── 错误类型（外部需要 catch 判断） ──
export { PathSafetyError } from './src/utils/path-safety.js';

// ── Markdown 解析（独立使用场景：拆分文档/提取标题） ──
export { splitMarkdown, resolveDocTitle } from './src/parser/markdown-splitter.js';

