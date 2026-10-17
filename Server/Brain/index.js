/**
 * Server/Brain/index.js —— 统一导出（**转发门面**，实现已迁入 `plugins/engines/brain/`）
 *
 * Brain 模块统一导出。实现实体：`plugins/engines/brain/`（6 个文件原样迁入，业务逻辑
 * 逐行不变），插件入口 `index.js` 用 `definePlugin` 注册 `engine-brain` 接缝
 * （契约 `seams/engine-brain.js`）。本目录六个文件都是纯转发门面：导出面与迁移前逐名
 * 一致（含 default），且解析到**同一批模块实例**。
 *
 * 外部使用（与迁移前完全一致）：
 *   import { Brain, BrainStatus } from './Brain/index.js';
 *   const brain = new Brain({ sseHub, storage });
 *   const plan = await brain.planTask('对 libcurl 进行鸿蒙化分析');
 */

export { Brain, BrainStatus } from './Brain.js';
export { default } from './Brain.js';
