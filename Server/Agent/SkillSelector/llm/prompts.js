/**
 * prompts.js — ReAct 各推理步骤的 Prompt 模板
 *
 * 设计原则：
 *   - 只存放纯文本模板与占位符替换逻辑，不含任何业务编排
 *   - 所有 LLM 调用统一要求 JSON 输出，便于程序解析
 */

// ─── Reason #1：任务拆解 Prompt ──────────────────────────────────────────────
// 输入：具体任务（task）。输出：keywords / intent / constraints / techStack
const TASK_ANALYSIS_PROMPT = `你是一个任务分析助手。请分析下面的"具体事项"，拆解出用于后续 SKILL 模糊匹配的关键信息。

具体事项：
"""
{{TASK}}
"""

请严格输出如下 JSON（不要输出任何额外文字、不要用 markdown 代码围栏）：
{
  "intent": "用一句话概括这个任务想达成的目标",
  "keywords": ["与任务最相关的关键词，小写，5-10 个，用于模糊匹配 SKILL 的 name/description"],
  "constraints": ["任务约束或前置条件，如语言、平台、输出形式等"],
  "techStack": ["涉及的技术栈或语言，如 C++、ArkTS、Flutter、React Native 等"]
}`;

// ─── Reason #2：SKILL 排序 Prompt ─────────────────────────────────────────────
// 输入：具体任务 + 任务拆解 + top5 候选 SKILL。输出：ranked 排序列表 + bestId
// 采用规则化评分：4 个维度（意图40/技术栈30/约束20/关键词10）+ 硬否决规则
// 解决"语言不匹配仍给高分"的不稳定问题
const SKILL_RANKING_PROMPT = `你是一个严格的 SKILL 评分专家。下面给出一个具体事项、它的任务拆解，以及若干候选 SKILL。请按下方评分规则对每个候选打分并排序。

【具体事项】
{{TASK}}

【任务拆解】
{{ANALYSIS}}

【候选 SKILL 列表】
{{CANDIDATES}}

═══════════════════════════════════════════
评分规则（总分 100，分 4 个维度）
═══════════════════════════════════════════

维度一｜意图契合度（满分 40）
  - 40 分：SKILL 的核心动作与任务动作完全一致（如任务"汇总报告"，SKILL 正是"聚合多份报告"）
  - 25-35 分：动作相关但不完全一致（如同为分析类，但偏编译验证而非可行性）
  - 10-20 分：仅输出物相似但动作不同（如任务"汇总检视结果"，SKILL 是"执行检视"——都产出报告，但动作不同）
  - 0-5 分：SKILL 功能与任务意图无关

维度二｜技术栈匹配（满分 30）
  - 30 分：SKILL 的 language 与任务 techStack 完全一致（如任务 C++、SKILL C/C++）
  - 15-25 分：技术栈同属一大类但不完全一致（如 C 与 C++、ArkTS 与 TS）
  - 0-5 分：技术栈不匹配（如任务要 Go、SKILL 是 C/C++；任务要 Java、SKILL 是 Flutter）

维度三｜约束满足度（满分 20）
  - 20 分：输出形式、前置条件等约束全部满足
  - 10-15 分：部分约束满足
  - 0-5 分：约束基本不满足

维度四｜关键词命中（满分 10）
  - 10 分：任务关键词大量命中 name/description
  - 5 分：部分命中
  - 0 分：几乎不命中

═══════════════════════════════════════════
硬性否决规则（必须严格执行，不得通融）
═══════════════════════════════════════════
1. 技术栈/语言不匹配 → 维度二计 0-5 分，且【总分上限 50】
   （例：任务要 Go 开源库迁移，SKILL 的 language 是 C/C++ → 总分不得 > 50）
2. SKILL 功能阶段与任务意图不同 → 维度一上限 15 分
   （例：任务要"可行性分析"，SKILL 是"执行移植动作"）
3. SKILL 与任务完全无关 → 总分上限 10
4. 严禁仅因"意图看起来契合"就给高分；语言不匹配是硬伤，必须压低总分
5. 动作类型不一致 → 维度一（意图）上限 15 分，且【总分上限 45】
   判定方式：对比任务的"核心动作动词"与 SKILL 的"核心动作动词"
   - 任务动作是"汇总/聚合/合并/整理已有结果/文件" → SKILL 动作也必须是"汇总/聚合"类
   - 任务动作是"汇总已有结果"，SKILL 动作是"执行检视/扫描/分析源码" → 动作类型不一致，触发本规则
   - 关键判据：任务的输入是已有产物（JSON/MD/报告文件），SKILL 的输入是源码/仓库 → 输入类型不同即动作类型不同
   （例：任务"汇总 compliance-review.json 和 logic-review.json 生成总报告"，SKILL 是"对源码进行编码质量检视" → 总分不得 > 45）

请严格输出如下 JSON（不要输出任何额外文字、不要用 markdown 代码围栏）：
{
  "bestId": "最佳 SKILL 的 id（即候选列表中的 dirName；若全部低分也填分数最高的）",
  "ranked": [
    {
      "id": "SKILL 的 dirName",
      "score": 0,
      "dimensions": { "intent": 0, "techStack": 0, "constraint": 0, "keyword": 0 },
      "reason": "一句话说明各维度得分依据，须点明是否触发硬否决"
    }
  ]
}

要求：
- ranked 数组按 score 从高到低排序，且必须包含全部候选 SKILL
- score 必须等于 dimensions 各项之和
- dimensions 四个 key 必须齐全（intent/techStack/constraint/keyword）
- 若候选 SKILL 的 language 与任务 techStack 不匹配，务必触发硬否决规则 1
- 若任务输入是已有产物（JSON/MD/报告）而 SKILL 输入是源码/仓库，务必触发硬否决规则 5`;

/**
 * 简单模板替换：把 {{KEY}} 替换为 params[KEY]
 * @param {string} template
 * @param {Record<string, string>} params
 * @returns {string}
 */
export function renderTemplate(template, params) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : ''
  );
}

export { TASK_ANALYSIS_PROMPT, SKILL_RANKING_PROMPT };
export default { TASK_ANALYSIS_PROMPT, SKILL_RANKING_PROMPT, renderTemplate };
