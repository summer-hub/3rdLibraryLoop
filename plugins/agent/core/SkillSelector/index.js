/**
 * plugins/agent/core/SkillSelector/index.js —— SkillSelector 模块统一导出（插件实现侧）
 *
 * 外部使用（经 `agent-skill-selector` 接缝或 `Server/Agent/SkillSelector/index.js` 门面）：
 *   const agent = new Agent();
 *   const result = await agent.selectSkill(task, skillDirectory);
 *
 * 与迁移前的差别只有一行：`LLMClient` 不再从这里导出。那个类属于另一条插件
 * （`plugins/llm/dashscope`，`llm` 接缝的提供方），插件之间不得互相 import（R2），
 * 所以本文件导出的是**解析入口**（`resolveLlmClient` 等），类由宿主接缝或门面兜底提供。
 * `Server/Agent/SkillSelector/index.js` 门面继续按原名导出 `LLMClient`，既有 import 不变。
 */

export { Agent } from './core/Agent.js';
export { resolveLlmClient, setLlmFallback, resetLlmFallback, hasLlmFallback } from './llm/llmClient.js';
export { scanSkills, parseFrontmatter } from './scanner/skillScanner.js';
export { fuzzyMatch, createFuzzyMatcher } from './matcher/fuzzyMatcher.js';
export { analyzeTask, rankSkills } from './llm/reactSteps.js';
