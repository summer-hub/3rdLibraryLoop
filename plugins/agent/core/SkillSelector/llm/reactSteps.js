/**
 * reactSteps.js — ReAct 两个推理步骤的封装
 *
 * 职责：
 *   - Reason #1 analyzeTask：调用 LLM 拆解任务，产出 TaskAnalysis（喂给模糊匹配）
 *   - Reason #2 rankSkills ：调用 LLM 对 top5 候选 SKILL 评分排序，产出 RankResult
 *
 * 设计原则：
 *   - 高内聚：两个推理步骤的 prompt 构建 + JSON 解析集中于此
 *   - 低耦合：只依赖 llmClient + prompts，不依赖 Agent 编排
 *   - 纯函数式：每个步骤都是 (llm, input) -> output，无副作用
 */

import { TASK_ANALYSIS_PROMPT, SKILL_RANKING_PROMPT, renderTemplate } from './prompts.js';

/**
 * Reason #1：任务拆解
 * @param {object} llm - LLMClient 实例（需提供 chatJSON）
 * @param {string} task - 具体事项
 * @returns {Promise<object>} TaskAnalysis: { intent, keywords[], constraints[], techStack[], whenToUse }
 */
export async function analyzeTask(llm, task) {
  if (!task) throw new Error('analyzeTask: task 不能为空');

  const prompt = renderTemplate(TASK_ANALYSIS_PROMPT, { TASK: task });
  const result = await llm.chatJSON(prompt);

  // 归整数组字段，避免 LLM 漏字段或返回非数组
  return {
    intent: typeof result.intent === 'string' ? result.intent : '',
    keywords: _toArray(result.keywords),
    constraints: _toArray(result.constraints),
    techStack: _toArray(result.techStack),
    whenToUse: typeof result.whenToUse === 'string' ? result.whenToUse : '',
  };
}

/**
 * Reason #2：SKILL 排序
 * @param {object} llm - LLMClient 实例
 * @param {string} task - 具体事项
 * @param {object} analysis - analyzeTask 产出的 TaskAnalysis
 * @param {Array} candidates - 模糊匹配召回的候选 [{ skill, score }] 或 SkillMeta[]
 * @returns {Promise<object>} RankResult: { bestId, ranked: [{ id, score, reason }] }
 */
export async function rankSkills(llm, task, analysis, candidates) {
  if (!candidates || candidates.length === 0) {
    throw new Error('rankSkills: 候选 SKILL 列表为空');
  }

  // 统一候选项结构为 { skill: SkillMeta, score }
  const normalized = candidates.map((c, i) => {
    const skill = c.skill || c;
    return {
      skill,
      score: typeof c.score === 'number' ? c.score : 0,
      index: i,
    };
  });

  // 把候选项渲染成 LLM 可读的简表（不传整个 SKILL.md，避免 token 爆炸）
  const candidatesText = normalized
    .map(({ skill, index }) => {
      const fields = [
        `id: ${skill.dirName}`,
        `name: ${skill.name || ''}`,
        `description: ${skill.description || ''}`,
        `useWhen: ${skill.useWhen || '(无)'}`,
        `category: ${skill.category || ''}`,
        `language: ${skill.language || ''}`,
      ].filter(Boolean);
      return `[#${index}] ${fields.join(' | ')}`;
    })
    .join('\n');

  const analysisText = JSON.stringify(analysis, null, 2);
  const prompt = renderTemplate(SKILL_RANKING_PROMPT, {
    TASK: task,
    ANALYSIS: analysisText,
    WHEN_TO_USE: analysis?.whenToUse || '（未拆解出触发场景）',
    CANDIDATES: candidatesText,
  });

  const result = await llm.chatJSON(prompt);

  // 归整 ranked（对象数组，不能用 _toArray —— 那是给字符串数组用的）
  // 对 LLM 可能用到的字段名做容错：ranked / results / list / rankings
  const rawRanked = result.ranked || result.results || result.list || result.rankings;
  const ranked = Array.isArray(rawRanked)
    ? rawRanked
        .filter((r) => r && typeof r === 'object')
        .map((r) => {
          // 解析 dimensions 分项分（容错：缺失或字段不全时为空对象）
          const rawDims = (r.dimensions && typeof r.dimensions === 'object') ? r.dimensions : {};
          const dimensions = {
            intent: _numOr0(rawDims.intent),
            techStack: _numOr0(rawDims.techStack),
            constraint: _numOr0(rawDims.constraint),
            keyword: _numOr0(rawDims.keyword),
          };

          // score 容错：缺失时用 dimensions 之和回填，保证总有分
          let score = typeof r.score === 'number' ? r.score
            : (dimensions.intent + dimensions.techStack + dimensions.constraint + dimensions.keyword);
          if (typeof score !== 'number') score = 0;

          return {
            id: typeof r.id === 'string'
              ? r.id
              : (typeof r.id === 'number' ? String(r.id)
                : (typeof r.dirName === 'string' ? r.dirName : '')),
            score,
            dimensions,
            reason: typeof r.reason === 'string' ? r.reason : '',
          };
        })
        .filter((r) => r.id)
    : [];

  // bestId 也做字段名容错：bestId / best / best_id / id
  const bestId = result.bestId || result.best || result.best_id || result.id
    || (ranked[0] && ranked[0].id);
  return { bestId, ranked };
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────
/** 把字符串/数组规整为字符串数组（仅用于 keywords/constraints/techStack） */
function _toArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v == null) return [];
  return [String(v)];
}

/** 把可能缺失/非数的值规整为 number（缺失或非数返回 0） */
function _numOr0(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export default { analyzeTask, rankSkills };
