/**
 * Server/Knowledge/index.js —— 统一导出（**转发门面**，实现已迁入 `plugins/engines/knowledge/`）
 *
 * 知识沉淀系统 —— 将 FlexRunner 执行过程中沉淀的有效经验文档路径
 * 持久化到 db/Knowledge/ 目录，实现跨任务、跨轮次的经验复用。
 *
 * 实现实体：`plugins/engines/knowledge/`（`KnowledgeManager` / `KnowledgeImporter` 两个文件原样迁入），
 * 插件入口 `index.js` 用 `definePlugin` 注册 `engine-knowledge` 接缝（契约 `seams/engine-knowledge.js`）。
 * 本目录三个文件都是纯转发门面：导出面与迁移前逐名一致（含 default），且解析到**同一批模块实例**。
 *
 * 对外接口：
 *   - KnowledgeManager: 知识管理器（经验增加/删除/更新/查询/相关性检索）
 *   - KnowledgeImporter: 知识导入执行引擎（通过 CLI + knowledge-import SKILL 执行导入）
 *
 * 使用示例（与迁移前完全一致）：
 *   import { KnowledgeManager } from './Knowledge/index.js';
 *
 *   const km = new KnowledgeManager();
 *   await km.init();
 *
 *   // 添加经验
 *   await km.addExperience({ docPath: '/path/to/Summary.md', taskId: 'task-001', stepId: 1 });
 *
 *   // 查询所有经验
 *   const list = await km.listExperiences();
 */

export { default as KnowledgeManager } from './KnowledgeManager.js';
export { default as KnowledgeImporter } from './KnowledgeImporter.js';
export { default } from './KnowledgeManager.js';
