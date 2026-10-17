/**
 * Server/Agent/SkillSelector/utils/actionWords.js —— 转发门面（实现已迁入 `plugins/agent/core/SkillSelector/utils/`）
 *
 * 为什么留这一层：`matcher/fuzzyMatcher.js` 的同族门面与 `__tests__/test-pure-logic.js`
 * 都按这个历史路径取动作词表。保持路径可用是插件化的硬约束。
 *
 * **必须 `export ... from` 转发，不能重新实现**：`ACTION_WORDS` / `DOMAIN_WORDS` 与
 * `ACTION_WORD_WEIGHT` 共同决定"动作类型否决"这一档命中判定，两份词表会让
 * `isActionWord()` 在门面侧与插件侧给出不同答案。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

export * from '../../../../plugins/agent/core/SkillSelector/utils/actionWords.js';
export { default } from '../../../../plugins/agent/core/SkillSelector/utils/actionWords.js';
