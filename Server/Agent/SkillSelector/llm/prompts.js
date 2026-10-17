/**
 * Server/Agent/SkillSelector/llm/prompts.js —— 转发门面（实现已迁入 `plugins/agent/core/SkillSelector/llm/`）
 *
 * 为什么留这一层：`SkillSelector/llm/reactSteps.js` 门面对应插件实现 import 这个路径的
 * 同族模块；`__tests__/test-pure-logic.js`（`test/run-all.mjs` 直接运行的子进程入口）
 * 也按 `../llm/prompts.js` 取 `renderTemplate`。保持路径可用是插件化的硬约束。
 *
 * **必须 `export ... from` 转发，不能重新实现**：模板是冻结的字符串常量，两份副本会让
 * "改了 prompt 但没生效"变成静默问题。转发保证全仓库只有一份模板表。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

export * from '../../../../plugins/agent/core/SkillSelector/llm/prompts.js';
export { default } from '../../../../plugins/agent/core/SkillSelector/llm/prompts.js';
