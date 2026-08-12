/**
 * actionWords.js — 动作类型/阶段词集中管理
 *
 * 这些词决定匹配哪个 SKILL（如"准出审核/验收测试"→ AcceptanceCheckSkill）。
 * BM25 打分时此类词权重放大 ACTION_WORD_WEIGHT 倍，避免被技术词（覆盖率/xts/demo）
 * 淹没而把真正匹配动作的 SKILL 挤出 TopK。
 *
 * 该词表与 llm/prompts.js 的 TASK_ANALYSIS_PROMPT 动作词示例保持一致，
 * 确保 LLM 产出的关键词能被 isActionWord 识别。
 */
export const ACTION_WORDS = [
  '准出审核', '验收测试', '验收检查', '验收', '审核',
  '可行性分析', '可行性', '分析',
  '代码生成', '代码', '生成',
  '文档生成', '文档', '编写',
  '迁移移植', '移植', '迁移', '鸿蒙化',
  '扫描检视', '检视', '扫描', '检查',
  '聚合汇总', '汇总', '聚合', '报告',
  '测试', '覆盖率', '覆盖',
  '执行检视', '执行',
  '代码修复', '修复', '纠错', '修正', '调试',
  '接口规格', '接口签名', '方法签名', '方法级接口', '导出链',
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

export default { ACTION_WORDS, ACTION_WORD_WEIGHT, isActionWord };