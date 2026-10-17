/**
 * seams/skill-source.js — SKILL 来源契约（能力接缝）
 *
 * Provider：`plugins/skills/directory`（现 Server/Agent/SkillSelector/scanner/）。
 *           未来可插 npm 包来源（skill 作为依赖分发）或远程仓库来源。
 * Consumer：SkillSelector（selectSkill 前先 scan 拿候选集）、Brain/TestCheck 的
 *           skillDirectory 兜底解析。
 *
 * 提供方注册的服务是**扫描函数**：
 *     ctx.provide('skill-source', (skillDirectory) => scanSkills(skillDirectory));
 *
 * 返回值 SkillMeta[]（与现有 scanSkills 输出一致）：
 *   { dirName, name, category, language, useWhen, searchableText, path }
 */

export const SKILL_SOURCE_SEAM = Object.freeze({
    name: 'skill-source',
    version: 1,
    factory: true,
    description: 'SKILL 来源：扫描技能目录得到 SkillMeta[]（frontmatter 解析 + 可检索文本构造）',
    factoryOptions: Object.freeze(['skillDirectory']),
    /**
     * 工厂**按位置**收参：注册的扫描函数签名是 `(skillDirectory) => SkillMeta[]`，
     * 不是一个 options 对象。其余工厂接缝都是 `(options)` 形状（默认
     * `factorySignature: 'options-object'`），所以这里必须显式声明，否则
     * `test/m9-contract-conformance/` 会用对象去调用它、把签名不符当成实现错误。
     */
    factorySignature: 'positional',
    /** SkillMeta 必填字段（消费者依赖） */
    metaFields: Object.freeze(['dirName', 'name', 'searchableText']),
});

export default SKILL_SOURCE_SEAM;
