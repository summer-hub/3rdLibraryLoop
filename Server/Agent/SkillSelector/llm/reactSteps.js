/**
 * Server/Agent/SkillSelector/llm/reactSteps.js —— 转发门面（实现已迁入 `plugins/agent/core/SkillSelector/llm/`）
 *
 * 为什么留这一层：`SkillSelector/index.js` 门面与迁移前的消费者都按这个路径取
 * `analyzeTask` / `rankSkills`。保持路径可用是插件化的硬约束。
 *
 * **必须 `export ... from` 转发，不能重新实现**：`reactSteps` 是 ReAct 两个推理步骤的
 * 唯一实现（prompt 渲染 + LLM 调用 + 结果归一）。两份实现会让 `Agent.selectSkill` 的
 * trace 与真实推理步骤对不上。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

export * from '../../../../plugins/agent/core/SkillSelector/llm/reactSteps.js';
export { default } from '../../../../plugins/agent/core/SkillSelector/llm/reactSteps.js';
