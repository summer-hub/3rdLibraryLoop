/**
 * Server/Agent/SkillSelector/index.js —— 转发门面（实现已迁入 `plugins/agent/core/SkillSelector/`）
 *
 * 为什么留这一层：`Server/TestCheck/TestCheck.js` 与 `Server/FlexRunner/FlexRunner.js` 在
 * 无宿主时用它登记 `skill-selector` 的无宿主兜底
 * （`async () => (await import('../Agent/SkillSelector/index.js')).Agent`），
 * `test/run-all.mjs` 里的 `__tests__/run-sample.js` 也按这个路径取 `Agent`。
 *
 * **必须 `export ... from` 转发，不能重新实现**：门面导出的 `Agent` 与插件实现、与
 * `inject('agent-skill-selector')` 拿到的类是**同一个**——这是「接缝优先于门面兜底」
 * 可以被机器断言（`inject(...) === facade.Agent`）的前提。
 *
 * 逐名列出而不是 `export *`：插件侧这一层还导出 LLM 解析入口
 * （`resolveLlmClient` / `setLlmFallback` / `resetLlmFallback` / `hasLlmFallback`），
 * 而本 barrel 迁移前只有 8 个名字。保持逐名一致，解析入口请直接从
 * `./llm/llmClient.js` 取（那里也支持）。
 *
 * ⚠️ 与插件的唯一差异：`LLMClient` 由 `./llm/llmClient.js`（dashscope 的转发门面）提供，
 * 不在插件导出面里——那个类属于另一条插件（`plugins/llm/dashscope`，`llm` 接缝的提供方），
 * 插件之间不得互相 import（R2）。本文件同时**顺带**求值了那条门面，因此 import 本文件
 * 就会登记 `llm` 的无宿主兜底加载器。
 */

export { Agent } from '../../../plugins/agent/core/SkillSelector/core/Agent.js';

export {
    scanSkills,
    parseFrontmatter,
} from '../../../plugins/agent/core/SkillSelector/scanner/skillScanner.js';

export {
    fuzzyMatch,
    createFuzzyMatcher,
} from '../../../plugins/agent/core/SkillSelector/matcher/fuzzyMatcher.js';

export { analyzeTask, rankSkills } from '../../../plugins/agent/core/SkillSelector/llm/reactSteps.js';

// LLMClient 的归属是 `llm` 接缝的提供方（plugins/llm/dashscope）；这条 import 同时完成
// 「无宿主时登记 llm 兜底」，见本目录 llm/llmClient.js 与 ../../index.js。
export { LLMClient } from './llm/llmClient.js';
