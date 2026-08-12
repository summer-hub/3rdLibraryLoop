/**
 * actionWords.js — 动作类型词与领域/产出物词分离管理
 *
 * 设计原则：
 *   - ACTION_WORDS 只保留真正的"动作/意图"词（动词类），决定匹配哪个动作型 SKILL
 *     （如"准出审核/验收测试"→ AcceptanceCheckSkill）。
 *   - DOMAIN_WORDS 是"领域/产出物特征词"（语义上不是动作，如"接口规格/覆盖率/XTS"），
 *     由领域通道用于召回时匹配 SKILL 的 useWhen / searchableText，不参与动作加权。
 *   - 历史教训：曾把"接口规格/接口签名/方法签名/方法级接口/导出链"等语义非动作词
 *     混入 ACTION_WORDS，靠 BM25 加权拉分，属于"该场景未命中后逐条打补丁"的治标方式，
 *     反而稀释了真正的动作信号。现改为动作/领域双通道各自独立承载。
 *
 * 该词表与 llm/prompts.js 的 TASK_ANALYSIS_PROMPT 保持一致，
 * 确保 LLM 产出的关键词能被 isActionWord / isDomainWord 识别。
 */
export const ACTION_WORDS = [
  '准出审核', '验收测试', '验收检查', '验收', '审核',
  '可行性分析', '可行性', '分析',
  '代码生成', '生成',
  '文档生成', '编写',
  '迁移移植', '移植', '迁移',
  '扫描检视', '检视', '扫描', '检查',
  '聚合汇总', '汇总', '聚合',
  '执行检视', '执行',
  '代码修复', '修复', '纠错', '修正', '调试',
];

// 领域/产出物特征词（非动作，不参与动作加权，供领域通道匹配用）
export const DOMAIN_WORDS = [
  '接口规格', '接口签名', '方法签名', '方法级接口', '导出链',
  '覆盖率', '覆盖', 'xts', 'demo',
  '鸿蒙', '鸿蒙化', 'arkts', 'typescript',
  '报告', '文档', '代码', '测试',
];

// 动作词权重（BM25 打分时放大倍数）
export const ACTION_WORD_WEIGHT = 3;

/**
 * 判断一个 token 是否为动作词（子串包含匹配，容忍"验收测试/验收检查"等变体）
 * @param {string} token - 小写待判 token
 * @returns {boolean}
 */
export function isActionWord(token) {
  if (!token) return false;
  return ACTION_WORDS.some((w) => token.includes(w));
}

/**
 * 判断一个 token 是否为领域/产出物特征词（子串包含匹配）
 * @param {string} token - 小写待判 token
 * @returns {boolean}
 */
export function isDomainWord(token) {
  if (!token) return false;
  return DOMAIN_WORDS.some((w) => token.includes(w));
}

export default { ACTION_WORDS, DOMAIN_WORDS, ACTION_WORD_WEIGHT, isActionWord, isDomainWord };