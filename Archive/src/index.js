/**
 * index.js — 对外导出入口
 *
 * 导出核心类 DocSearchEngine 和相关类型/常量，
 * 供外部 SDK / 库形式调用。
 *
 * 使用示例：
 *   import { DocSearchEngine } from './Archive/src/index.js';
 *
 *   const engine = new DocSearchEngine();
 *   await engine.init({ dataDir: '/data/my-docs' });
 *   await engine.addDocument({ documentId: 'guides/intro', catalog: 'guides', content: '# 入门' });
 *   const results = await engine.search({ query: '入门', limit: 5 });
 *   await engine.close();
 */

export { default as DocSearchEngine } from './engine.js';
export { default } from './engine.js';

export { DEFAULT_CATALOGS, INDEX_VERSION } from './constants.js';

export { PathSafetyError } from './utils/path-safety.js';
