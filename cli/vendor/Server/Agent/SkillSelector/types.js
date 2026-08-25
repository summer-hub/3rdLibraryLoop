/**
 * types.js — SkillSelector 模块的类型契约（JSDoc 参考，不参与运行时）
 *
 * 本文件仅用于集中声明数据结构，便于 IDE 提示与维护者阅读。
 * JS 中没有运行时类型，这里用 JSDoc @typedef 描述。
 */

/**
 * @typedef {Object} SkillMeta
 * @property {string} dirName        - SKILL 目录名（唯一标识，如 'CPPAnalysisSkill'）
 * @property {string} skillPath      - 该 SKILL 目录绝对路径
 * @property {string} skillMdPath    - SKILL.md 绝对路径
 * @property {string} name           - frontmatter.name
 * @property {string} description    - frontmatter.description（匹配核心字段）
 * @property {string} license         - frontmatter.license
 * @property {string} compatibility  - frontmatter.compatibility
 * @property {string} version         - metadata.version
 * @property {string} author          - metadata.author
 * @property {string} category        - metadata.category
 * @property {string} language        - metadata.language 或 metadata['language-support']
 * @property {string} searchableText  - name+description+category+language 拼成的小写串
 * @property {number} bodyLength       - SKILL.md 正文长度（frontmatter 之后）
 * @property {boolean} hasReferences  - 是否有 references/ 子目录
 * @property {boolean} hasScripts      - 是否有 scripts/ 子目录
 */

/**
 * @typedef {Object} TaskAnalysis
 * @property {string} intent        - 任务意图一句话
 * @property {string[]} keywords    - 匹配关键词
 * @property {string[]} constraints - 任务约束
 * @property {string[]} techStack   - 技术栈/语言
 */

/**
 * @typedef {Object} SkillDimensions
 * @property {number} intent     - 意图契合度分（满分 40）
 * @property {number} techStack  - 技术栈匹配分（满分 30）
 * @property {number} constraint - 约束满足度分（满分 20）
 * @property {number} keyword    - 关键词命中分（满分 10）
 */

/**
 * @typedef {Object} RankedSkill
 * @property {string} id         - SKILL 的 dirName
 * @property {number} score      - 0-100 总分（= dimensions 各项之和）
 * @property {SkillDimensions} dimensions - 分维度分数（容错：缺失时为空对象）
 * @property {string} reason     - 一句话理由
 */

/**
 * @typedef {Object} SkillSelection
 * @property {SkillMeta|null} best          - 最佳 SKILL（未命中阈值/分差过小时为 null）
 * @property {string|null} skillPath        - best 的绝对目录路径（未命中为 null）
 * @property {boolean} hit                   - 检索是否命中（top1>=阈值 且 top1-top2 分差>=10）
 * @property {number} topScore               - top1 分数（未召回为 0）
 * @property {number} scoreGap               - top1-top2 分差（<10 时判定不确定，hit=false）
 * @property {Array<{skill: SkillMeta, score: number, dimensions: SkillDimensions, reason: string}>} ranked - 排序结果
 * @property {TaskAnalysis} analysis        - 任务拆解
 * @property {Array<object>} trace          - ReAct 每步留痕
 */

export {};
