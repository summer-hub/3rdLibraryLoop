/**
 * Server/Agent/SkillSelector/matcher/fuzzyMatcher.js —— 转发门面（实现已迁入 `plugins/agent/core/SkillSelector/matcher/`）
 *
 * 为什么留这一层：`SkillSelector/index.js` 门面与 `__tests__/test-pure-logic.js`
 * （`test/run-all.mjs` 直接运行的子进程入口，按 `../matcher/fuzzyMatcher.js` 取
 * `tokenize` / `BM25` / `fuzzyMatch`）都按这个路径 import。
 *
 * **必须 `export ... from` 转发，不能重新实现**：BM25 的打分口径与"动作/领域/原文"
 * 三路融合权重共同决定命中判定（`hit` / `topScore`），两份实现会让召回结果静默分叉——
 * 这类分歧在用例里表现为"阈值边缘偶发不命中"，极难定位。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

export * from '../../../../plugins/agent/core/SkillSelector/matcher/fuzzyMatcher.js';
export { default } from '../../../../plugins/agent/core/SkillSelector/matcher/fuzzyMatcher.js';
