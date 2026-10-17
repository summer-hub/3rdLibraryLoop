/**
 * Agent.js — SKILL 选择器 ReAct Agent（对外导出）
 *
 * 设计模式：ReAct（Reason + Act）
 *   - Reason #1：LLM 拆解任务 → 生成模糊匹配输入（keywords/intent/techStack）
 *   - Act     ：调用模糊匹配工具，召回 top5 候选 SKILL
 *   - Reason #2：LLM 对 top5 评分排序 → 选出最佳 SKILL
 *
 * 对外导出 Agent 类，核心方法：
 *   async selectSkill(task, skillDirectory) -> SkillSelection
 *
 * 使用示例：
 *   import { Agent } from './Agent/SkillSelector/index.js';
 *   const agent = new Agent();
 *   const result = await agent.selectSkill('分析 libcurl 的鸿蒙化可行性', 'D:/code/AIWeb/Server/Skills');
 *   console.log(result.best.name);
 */

import { resolveLlmClient } from '../llm/llmClient.js';
import { scanSkills } from '../scanner/skillScanner.js';
import { createFuzzyMatcher } from '../matcher/fuzzyMatcher.js';
import { analyzeTask, rankSkills } from '../llm/reactSteps.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('SkillSelector');

// 迁移前的模块顶层 `await loadServerEnv()` 已删除：加载 `Server/.env` 是**装配层**的职责
// （`Server/composition/envBootstrap.js`，由 buildApp / cli/lib/config.js 调用），插件不得
// 反向读 `Server/` 的文件（R2）。环境变量在插件被真正调用前早已由装配层就绪。

const DEFAULT_TOP_K = 5;
const DEFAULT_HIT_THRESHOLD = 60;

// 多路召回融合权重（默认：动作 0.4 / 领域 0.4 / 原文 0.2）
const DEFAULT_WEIGHTS = { action: 0.4, domain: 0.4, raw: 0.2 };

export class Agent {
  /**
   * @param {object} [options]
   * @param {object} [options.llm]         - 注入自定义 LLM 客户端（用于测试）；不给则首次 selectSkill 时按解析链取
   * @param {Function} [options.matcher]   - 注入自定义模糊匹配实现
   * @param {number} [options.topK]        - 召回候选数量，默认 5 或读 SELECTOR_TOP_K
   * @param {number} [options.hitThreshold] - 命中阈值，默认 60 或读 SELECTOR_HIT_THRESHOLD
   */
  constructor(options = {}) {
    /**
     * LLM 客户端：**构造期不解析**（迁移前是 `createLlmFromHost(LLMClient)`，构造即实例化）。
     *
     * 改成懒解析是本片刻意的语义收紧，而不是顺手改动：LLM 的三档解析链
     * （显式注入 → 宿主 llm 接缝 → 门面登记兜底 → fail closed，见 `llm/llmClient.js`）
     * 里有两档要 `await`，而构造函数不能异步。把解析推到首次 `selectSkill()` 换来两条
     * 明确性质：① `new Agent()` 在任何装配形态下都不抛（构造不依赖协作方存在）；
     * ② 解析不到时报错发生在**第一次真正使用**，文案点名缺哪条来源（fail closed 而不是
     * 静默自建一份）。这与 `plugins/engines/brain` 的 `_ensureWired()` 是同一处置。
     */
    this.llm = options.llm || null;
    this.matcher = createFuzzyMatcher(options.matcher);
    this.topK = options.topK ?? _envInt('SELECTOR_TOP_K', DEFAULT_TOP_K);
    this.hitThreshold = options.hitThreshold ?? _envInt('SELECTOR_HIT_THRESHOLD', DEFAULT_HIT_THRESHOLD);
    this.weights = {
      action: options.weights?.action ?? _envFloat('SELECTOR_WEIGHT_ACTION', DEFAULT_WEIGHTS.action),
      domain: options.weights?.domain ?? _envFloat('SELECTOR_WEIGHT_DOMAIN', DEFAULT_WEIGHTS.domain),
      raw: options.weights?.raw ?? _envFloat('SELECTOR_WEIGHT_RAW', DEFAULT_WEIGHTS.raw),
    };
  }

  /**
   * 取（或在首次使用时解析）LLM 客户端。
   *
   * 顺序：① 构造注入的实例 → ② 宿主 `llm` 接缝 → ③ 门面登记的无宿主兜底 → ④ fail closed。
   * 解析成功后缓存在 `this.llm` 上，后续调用不再问宿主。
   *
   * @returns {Promise<object>}
   * @throws {Error} 三档都解析不到时（文案见 `llm/llmClient.js`）
   */
  async _ensureLlm() {
    if (this.llm) return this.llm;
    this.llm = await resolveLlmClient();
    return this.llm;
  }

  /**
   * 选择最适合的 SKILL（ReAct 主流程）
   * @param {string} task             - 具体事项
   * @param {string} skillDirectory  - SKILL 筛选目录绝对路径
   * @returns {Promise<import('../types.js').SkillSelection>}
   */
  async selectSkill(task, skillDirectory) {
    if (!task) throw new Error('Agent.selectSkill: task 不能为空');

    if (!skillDirectory) throw new Error('Agent.selectSkill: skillDirectory 不能为空');

    const llm = await this._ensureLlm();

    log.debug('selectSkill 入参', { task, skillDirectory });

    const trace = [];

    // ─── 步骤 0：扫描 SKILL 目录，构建候选池 ───
    const skills = await scanSkills(skillDirectory);
    if (skills.length === 0) {
      throw new Error(`Agent.selectSkill: SKILL 目录 ${skillDirectory} 下未找到任何有效 SKILL`);
    }
    trace.push({ step: 'scan', output: { totalSkills: skills.length } });

    // ─── Reason #1：LLM 拆解任务 ───
    const analysis = await analyzeTask(llm, task);
    trace.push({ step: 'reason-1:analyzeTask', input: { task }, output: analysis });

    // ─── Act：调用模糊匹配工具，召回 topK（双通道多路融合） ───
    const matched = await this.matcher(analysis, skills, { topK: this.topK, task, weights: this.weights });
    if (matched.length === 0) {
      throw new Error('Agent.selectSkill: 模糊匹配未召回任何 SKILL');
    }
    // trace 留痕：记录每路分数（动作/领域/原文），便于定位偶发未命中
    trace.push({
      step: 'act:fuzzyMatch',
      output: {
        topK: matched.length,
        weights: this.weights,
        scores: matched.map((m) => m.score),
        routes: matched.map((m) => m.routes || null),
      },
    });

    // ─── Reason #2：LLM 对候选评分排序 ───
    const rankResult = await rankSkills(llm, task, analysis, matched);
    trace.push({ step: 'reason-2:rankSkills', output: rankResult });

    // ─── 组装返回：把 ranked 的 id 映射回完整 SkillMeta ───
    const skillMap = new Map(skills.map((s) => [s.dirName, s]));
    // fuzzyMatch 已产出的 score 作为回退
    const matchScoreMap = new Map(matched.map((m) => [m.skill.dirName, m.score]));

    let ranked = rankResult.ranked.map((r) => {
      const skill = skillMap.get(r.id) || matched.find((m) => m.skill.dirName === r.id)?.skill;
      if (!skill) return null;
      return {
        skill,
        score: r.score,
        // 携带 LLM 的分维度分数（容错：rankSkills 已保证 dimensions 为对象）
        dimensions: r.dimensions || {},
        reason: r.reason || `模糊匹配原始分：${matchScoreMap.get(r.id) ?? 0}`,
      };
    }).filter(Boolean);

    // 兜底：若 LLM 排序结果为空（模型未按格式返回），用模糊匹配原始召回结果填充
    if (ranked.length === 0) {
      ranked = matched.map((m) => ({
        skill: m.skill,
        score: m.score,
        dimensions: {},
        reason: `模糊匹配原始分：${m.score}`,
      }));
      trace[trace.length - 1] = {
        ...trace[trace.length - 1],
        note: 'rankSkills 返回为空，已用模糊匹配结果兜底',
      };
    }

    // 稳定降序排序：topScore 判定依赖 ranked[0]，不能信任 LLM 的返回顺序（偶现不严格降序）
    ranked = ranked.sort((a, b) => b.score - a.score);

    // ─── 命中阈值判定：top1 分数 >= 阈值即命中 ───
    // ranked 已按 score 降序，ranked[0] 是最高分候选
    const topScore = ranked.length > 0 ? ranked[0].score : 0;
    const secondScore = ranked.length > 1 ? ranked[1].score : 0;
    // top1-top2 分差仅作参考信息保留，不参与命中判定：
    // 高分 top1（>=阈值）已明确是最佳选择，即使 top2 分数接近也不应判为"不确定"
    const scoreGap = topScore - secondScore;
    const hit = topScore >= this.hitThreshold;

    // 确定 best：命中时取最高分 SKILL，未命中时为 null（调用方据此走兜底流程）
    let best = null;
    if (hit) {
      // 命中：优先用 LLM 的 bestId，否则取 ranked[0]
      if (rankResult.bestId) {
        best = skillMap.get(rankResult.bestId) || (ranked[0] && ranked[0].skill);
      }
      if (!best && ranked.length > 0) {
        best = ranked[0].skill;
      }
      if (!best) {
        throw new Error('Agent.selectSkill: 命中但无法确定最佳 SKILL');
      }
    }
    // 未命中时 best 保持 null，skillPath 也为 null

    const result = {
      best,
      // SKILL 绝对目录（命中时为 best.skillPath，未命中为 null）
      skillPath: best ? best.skillPath : null,
      // 检索是否命中阈值
      hit,
      // top1 分数（便于调用方了解置信度，未召回为 0）
      topScore,
      // top1-top2 分差（仅参考信息，不参与命中判定）
      scoreGap,
      ranked,
      analysis,
      trace,
    };

    log.debug('selectSkill 输出', {
      hit: result.hit,
      topScore: result.topScore,
      best: result.best ? result.best.dirName : null,
      skillPath: result.skillPath,
      rankedCount: result.ranked.length,
    });

    return result;
  }
}

function _envInt(key, def) {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function _envFloat(key, def) {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export default Agent;
