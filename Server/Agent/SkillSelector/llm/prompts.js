/**
 * prompts.js — ReAct 各推理步骤的 Prompt 模板
 *
 * 设计原则：
 *   - 只存放纯文本模板与占位符替换逻辑，不含任何业务编排
 *   - 所有 LLM 调用统一要求 JSON 输出，便于程序解析
 */

// ─── Reason #1：任务拆解 Prompt ──────────────────────────────────────────────
// 输入：具体任务（task）。输出：keywords / intent / constraints / techStack / whenToUse
const TASK_ANALYSIS_PROMPT = `你是一个任务分析助手。请分析下面的"具体事项"，拆解出用于后续 SKILL 模糊匹配的关键信息。

具体事项：
"""
{{TASK}}
"""

【关键词提取规则】
1. keywords 必须包含至少一个"动作类型/阶段"词，如：准出审核、验收测试、验收检查、可行性分析、代码生成、代码修复、文档生成、迁移移植、扫描检视、接口规格、聚合汇总、执行检视。这类词决定匹配哪个 SKILL，不可丢失。
2. 当任务描述很长时，优先保留开头的动作意图词，不要被后续技术细节（库列表、API 名、文件路径）淹没。
3. keywords 须兼顾"动作类词"与"技术名词"两类，共 5-10 个，全部小写。
4. intent 必须以动词开头并点明动作类型（如"准出审核""验收""汇总报告"），不要只描述技术目标。
5. 必须保留任务中决定"产出物类型 / SKILL 归属"的领域短语，不能只保留泛化动作词或技术名词。这类词如：接口规格、接口签名、方法签名、方法级接口、导出链、覆盖率、XTS、Demo 等。它们代表任务的真实交付物，是区分高度相似 SKILL 的关键。若任务包含此类短语，务必原样写入 keywords。

【whenToUse 提取规则】
5. whenToUse 必须直接识别并提取任务描述中的"触发场景/前置条件"表述，格式与候选 SKILL 的 useWhen（"use when..."、"当...时调用"）保持一致，便于逐词/逐句语义比对。
   - 优先从任务原文中定位触发语境词，如"当...时"、"use when"、"对...进行"、"针对..."、"输入是..."等，把其后跟随的场景/对象原样提取为一句话。
   - 若任务没有显式触发语境词，则依据任务的输入类型归纳触发场景（是"已有产物/JSON/MD/报告"、"源码/仓库"、"待检视的代码差异"，还是其它）。
   - 只描述"什么输入/什么场景下触发本任务"，不要在此重复技术细节、库列表或输出形式。
   - 例：任务含"对 PR 的差异做代码检视" → whenToUse="对代码差异进行检视"
   - 例：任务含"获取仓库源码并分析目录结构" → whenToUse="分析仓库源码目录结构"
6. 若任务明确属于某类专属触发场景（如 PR 检视），whenToUse 必须原样体现该场景特征词（如"PR"）；不得引入任务中不存在的场景特征，避免与 SKILL 的 useWhen 误判为一致。

【techStack 提取规则】
7. techStack 提取禁止主观猜测仓库语言。当任务描述包含 gitcode/gitee 等仓库 URL 时，不得仅凭库名联想其语言（如 opencsv 联想成 Java）；若任务未明确说明语言，techStack 只填任务中明确出现的语言/技术名词，必要时留空，交由后续执行阶段通过 gitcode 仓库语言 API 确认。

【示例】
输入："对 libcurl 鸿蒙化产物进行准出审核，对照验收标准判断是否满足..."
正确输出：{"intent":"准出审核 libcurl 鸿蒙化产物是否满足验收标准","keywords":["准出审核","验收测试","验收检查","libcurl","鸿蒙化","arkts"],"whenToUse":"对任务执行产物做准出验收审核"}
错误输出（丢失动作词）：{"intent":"分析 libcurl 鸿蒙化结果","keywords":["libcurl","鸿蒙化","arkts","harmonyos"]}

输入："XTS 测试执行失败，根据失败报告修复已生成的测试代码使其通过编译执行..."
正确输出：{"intent":"修复已生成的 XTS 测试代码使其通过编译执行","keywords":["代码修复","修复","测试","xts","test.ets","编译","执行"],"whenToUse":"修复已有测试代码产物使其通过编译执行"}
错误输出（误判为生成）：{"intent":"生成 XTS 测试代码","keywords":["代码生成","测试","xts","test.ets"]}

输入："克隆 FastBle 源仓库，解析所有 ArkTS/TypeScript 源文件提取对外公开的方法级接口（导出类名、方法名、参数列表、返回值类型、访问修饰符），输出方法级接口规格文档（api-spec.md）"
正确输出：{"intent":"扫描源码提取方法级接口规格并输出文档","keywords":["接口规格","接口签名","方法签名","方法级接口","扫描","文档生成","arkts","typescript","fastble"],"whenToUse":"从源码提取方法级接口规格时"}
错误输出（丢失领域词）：{"intent":"扫描源码并输出文档","keywords":["扫描检视","文档生成","arkts","typescript","fastble"]}

请严格输出如下 JSON（不要输出任何额外文字、不要用 markdown 代码围栏）：
{
  "intent": "以动词开头，一句话概括任务目标，须点明动作类型",
  "keywords": ["5-10个关键词，小写，必须含至少1个动作类型词"],
  "constraints": ["任务约束或前置条件，如语言、平台、输出形式等"],
  "techStack": ["涉及的技术栈或语言，如 C++、ArkTS、Flutter、React Native 等；仅填任务中明确出现的语言，禁止凭仓库 URL 指向的库名猜测语言，仓库语言由执行阶段调用 gitcode API 确认"],
  "whenToUse": "直接提取任务中的触发场景/前置条件表述（如\"对代码差异进行检视\"），格式对齐 SKILL 的 useWhen"
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

【任务触发场景（whenToUse）】
{{WHEN_TO_USE}}

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
1. useWhen 触发场景冲突 → 【总分上限 10】
   判定方式：对比"任务 whenToUse"与候选 SKILL 的 "useWhen"（该技能何时该调用）是否语义一致
   - 若候选 SKILL 声明了 useWhen，且任务的 whenToUse 与该 useWhen 描述的触发场景冲突，则判死
   - 关键判据：任务的输入/触发场景与 SKILL 的前置输入类型不同
   （例A：任务 whenToUse="分析仓库源码目录结构"，SKILL useWhen="对 Pull Request 的代码差异进行检视" → 任务无 PR 意图但 SKILL 仅用于 PR → 冲突，总分不得 > 10）
   （例B：任务 whenToUse="对代码差异进行检视"，SKILL useWhen 含 PR → 一致，不触发本规则）
   - 若候选 SKILL 的 useWhen 为空（未声明），则不触发本规则，按其它规则评分
2. 技术栈/语言不匹配 → 维度二计 0-5 分，且【总分上限 50】
   （例：任务要 Go 开源库迁移，SKILL 的 language 是 C/C++ → 总分不得 > 50）
   - **判定依据仅以任务拆解的 techStack（ANALYSIS 中的 techStack 字段）为准**。只有当 techStack 明确给出了某语言，且与该 SKILL 的 language 明确冲突时，才触发本硬否决。
   - **techStack 为空 / 未明确语言时，禁止凭任务原文中的库名或常识推断语言**（如见到 "opencsv" 就臆断为 Java）。此时视为语言未指明，不触发语言硬否决，按其它维度正常评分。
   - 不得把 SKILL 的 language 反向当作任务语言来推断匹配与否。
3. SKILL 功能阶段与任务意图不同 → 维度一上限 15 分
   （例：任务要"可行性分析"，SKILL 是"执行移植动作"）
4. 严禁仅因"意图看起来契合"就给高分；当任务 techStack 明确指明语言且与 SKILL 语言冲突时，语言不匹配是硬伤，必须压低总分
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
- 若候选 SKILL 声明了 useWhen 且与任务 whenToUse 触发场景冲突，务必先触发硬否决规则 1
- 若候选 SKILL 的 language 与任务 techStack 不匹配，务必触发硬否决规则 2；但若任务 techStack 为空/未明确，不得凭库名推断语言，不触发规则 2
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
