/**
 * Knowledge 模块统一导出
 *
 * 知识沉淀系统 —— 将 FlexRunner 执行过程中沉淀的有效经验文档路径
 * 持久化到 db/Knowledge/ 目录，实现跨任务、跨轮次的经验复用。
 *
 * 存储复用 DbUse 的 JsonAdapter（通过 createStorage().json('Knowledge')），
 * 不引入额外的 Store 层，保持高内聚低耦合。
 *
 * 对外接口：
 *   - KnowledgeManager: 知识管理器（经验增加/删除/更新/查询）
 *   - KnowledgeImporter: 知识导入执行引擎（通过 CLI + KnowledgeImportSkill 执行导入）
 *
 * 使用示例：
 *   import { KnowledgeManager } from './Knowledge/index.js';
 *
 *   const km = new KnowledgeManager();
 *   await km.init();
 *
 *   // 添加经验
 *   await km.addExperience({
 *     docPath: '/path/to/Summary.md',
 *     taskId: 'task-001',
 *     stepId: 1
 *   });
 *
 *   // 查询所有经验
 *   const list = await km.listExperiences();
 */

export { default as KnowledgeManager } from './KnowledgeManager.js';
export { default as KnowledgeImporter } from './KnowledgeImporter.js';
export { default } from './KnowledgeManager.js';
