/**
 * Server/Agent/SkillSelector/scanner/skillScanner.js —— 转发门面（实现已迁入 `plugins/agent/core/SkillSelector/scanner/`）
 *
 * 为什么留这一层：`SkillSelector/index.js` 门面与 `__tests__/test-pure-logic.js`
 * （`test/run-all.mjs` 直接运行的子进程入口，按 `../scanner/skillScanner.js` 取
 * `parseFrontmatter` / `scanSkills`）都按这个路径 import。
 *
 * **必须 `export ... from` 转发，不能重新实现**：frontmatter 解析（块标量 `>` / `|`、
 * 空行分段、字段折叠）有一串边界行为被 `test-pure-logic.js` 逐条冻结，两份实现会让
 * "扫描结果对不上用例"变成需要两份并行维护的回归面。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`。
 */

export * from '../../../../plugins/agent/core/SkillSelector/scanner/skillScanner.js';
export { default } from '../../../../plugins/agent/core/SkillSelector/scanner/skillScanner.js';
