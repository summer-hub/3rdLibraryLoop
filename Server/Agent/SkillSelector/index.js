/**
 * index.js — SkillSelector 模块统一导出
 *
 * 外部使用：
 *   import { Agent } from './Agent/SkillSelector/index.js';
 *   const agent = new Agent();
 *   const result = await agent.selectSkill(task, skillDirectory);
 */

export { Agent } from './core/Agent.js';
export { LLMClient } from './llm/llmClient.js';
export { scanSkills, parseFrontmatter } from './scanner/skillScanner.js';
export { fuzzyMatch, createFuzzyMatcher } from './matcher/fuzzyMatcher.js';
export { analyzeTask, rankSkills } from './llm/reactSteps.js';
