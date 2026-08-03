/**
 * AnalysisStrategies —— 任务分析策略（CLI 优先 + LLM fallback）
 *
 * 职责：
 *   - 通过 CLI 执行 TaskAnalysisSkill（opencode 路径）
 *   - CLI 不可用时降级为直接 LLM 调用
 *   - 支持首轮分析和重规划场景的上下文分析
 *   - 规范化分析结果
 *
 * 设计原则：
 *   - 持有 llm + skillExecutor 引用，不持有 Brain 的业务状态
 *   - 所有方法接收纯参数，返回规范化的分析对象
 */

import path from 'node:path';
import fs from 'node:fs';

export class AnalysisStrategies {
    /**
     * @param {object} deps
     * @param {object} deps.llm            - LLMClient 实例
     * @param {object} deps.skillExecutor  - SkillExecutor 实例
     */
    constructor({ llm, skillExecutor }) {
        this.llm = llm;
        this.skillExecutor = skillExecutor;
    }

    // ─── 首轮分析 ──────────────────────────────────────────────────────

    /**
     * 分析任务意图 — 通过 CLI 执行 TaskAnalysisSkill 提取任务关键信息 + 生成验收标准
     *
     * 调用路径：Brain → 构建 prompt → opencode CLI → TaskAnalysisSkill → 结果文件
     *
     * 如果用户提供了验收标准，SKILL 会基于用户标准进行细化和补充；
     * 如果用户未提供，SKILL 会根据任务描述自动生成合理的验收标准。
     *
     * CLI 不可用时降级为直接 LLM 调用（fallback）。
     *
     * @param {string} taskDescription
     * @param {string} [userCriteria] - 用户提供的验收标准（自然语言）
     * @param {object} [execCtx] - CLI 执行上下文
     * @param {string} [execCtx.taskId]    - 任务 ID（用于构建结果文件路径）
     * @param {string} [execCtx.taskDir]   - 工作目录（Session cwd）
     * @param {string} [execCtx.skillDir]  - SKILL 根目录
     * @param {number} [execCtx.loopCount] - 循环轮次（默认 0）
     * @returns {Promise<object>} { intent, domain, keywords, constraints, techStack, acceptanceCriteria }
     */
    async analyzeTask(taskDescription, userCriteria = '', execCtx = {}) {
        const { taskId, taskDir, skillDir, loopCount = 0 } = execCtx;

        // ── 尝试通过 CLI 执行 TaskAnalysisSkill ──
        if (taskId && taskDir && skillDir) {
            try {
                return await this._analyzeViaCLI(taskDescription, userCriteria, {
                    taskId, taskDir, skillDir, loopCount
                });
            } catch (err) {
                console.warn(`[Brain] CLI 执行 TaskAnalysisSkill 失败，降级为 LLM 直接调用: ${err.message}`);
            }
        }

        // ── Fallback：直接 LLM 调用 ──
        return await this._analyzeViaLLM(taskDescription, userCriteria);
    }

    /**
     * 通过 CLI 执行 TaskAnalysisSkill。
     *
     * @param {string} taskDescription
     * @param {string} userCriteria
     * @param {object} ctx - { taskId, taskDir, skillDir, loopCount }
     * @returns {Promise<object>}
     * @private
     */
    async _analyzeViaCLI(taskDescription, userCriteria, ctx) {
        const { taskId, taskDir, skillDir, loopCount } = ctx;
        const analysisSkillDir = path.join(skillDir, 'TaskAnalysisSkill');
        const resultFilePath = path.join(taskDir, `brain_analysis_loop${loopCount}.json`);

        // 构建上下文段落
        const contextSections = [
            `## 任务描述\n${taskDescription}`,
            userCriteria.trim()
                ? `## 用户提供的验收标准\n${userCriteria.trim()}`
                : `## 验收标准\n用户未提供验收标准，请根据任务描述自动生成合理的验收标准，确保每条标准具体、可验证。`
        ];

        const title = `brain|task=${taskId}|analyze|loop=${loopCount}`;
        const { success, json } = await this.skillExecutor.invokeSkill(
            analysisSkillDir, taskDir, resultFilePath, title, contextSections
        );

        if (!success || !json) {
            throw new Error('TaskAnalysisSkill 执行失败或结果解析为空');
        }

        return this.normalizeAnalysis(json);
    }

    /**
     * Fallback：直接通过 LLM 分析任务。
     *
     * @param {string} taskDescription
     * @param {string} userCriteria
     * @returns {Promise<object>}
     * @private
     */
    async _analyzeViaLLM(taskDescription, userCriteria) {
        const criteriaSection = userCriteria.trim()
            ? `\n## 用户提供的验收标准\n${userCriteria.trim()}\n\n请基于以上用户标准进行细化、补充和结构化，确保验收标准具体、可验证。`
            : `\n## 验收标准\n用户未提供验收标准，请根据任务描述自动生成合理的验收标准，确保每条标准具体、可验证。`;

        const prompt = `你是一个任务分析助手。请分析以下任务描述，提取关键信息并生成验收标准。

## 任务描述
${taskDescription}
${criteriaSection}

## 输出要求
请以 JSON 格式返回，包含以下字段：
{
  "intent": "任务的核心意图（一句话概括）",
  "domain": "任务所属领域（如 harmonyos-porting、code-quality、documentation 等）",
  "keywords": ["关键词1", "关键词2", "..."],
  "constraints": ["约束条件1", "约束条件2", "..."],
  "techStack": ["涉及的技术栈1", "..."],
  "complexity": "low|medium|high",
  "estimatedSteps": 3,
  "acceptanceCriteria": [
    {
      "id": "ac1",
      "criterion": "具体的验收标准描述",
      "type": "output|quality|performance|compliance",
      "verification": "如何验证该标准是否满足（如检查文件是否存在、内容是否符合格式等）"
    }
  ]
}

### 验收标准说明
- 每条标准必须**具体且可验证**，避免模糊描述
- type 分类：output（产物检查）、quality（质量要求）、performance（性能指标）、compliance（合规性）
- verification 描述验证方式：如检查文件、执行命令、人工审查等
- 验收标准数量通常 3-8 条，覆盖任务的关键产出和质量要求

注意：只返回 JSON，不要包含其他文字。`;

        const result = await this.llm.chatJSON(prompt, { maxTokens: 2048 });
        return this.normalizeAnalysis(result);
    }

    // ─── 重规划分析 ────────────────────────────────────────────────────

    /**
     * 带上下文重新分析任务 — 在重规划时调用，融入上轮审核失败信息。
     *
     * 通过 CLI 执行 TaskAnalysisSkill，将失败上下文作为 context 传入。
     * CLI 不可用时降级为直接 LLM 调用（fallback）。
     *
     * @param {string} taskDescription
     * @param {string} userCriteria
     * @param {object} context - 重规划上下文
     * @param {Array}  context.failedCriteria - 上轮未满足的验收标准
     * @param {Array}  context.improvementSuggestions - 上轮改进建议
     * @param {string} context.prevCheckSummary - 上轮审核摘要
     * @param {string} context.prevOrchStatus - 上轮编排状态
     * @param {number} context.loopCount - 当前循环轮次
     * @param {object} [execCtx] - CLI 执行上下文 { taskId, taskDir, skillDir }
     * @returns {Promise<object>}
     */
    async analyzeTaskWithContext(taskDescription, userCriteria, context, execCtx = {}) {
        const { taskId, taskDir, skillDir } = execCtx;

        // ── 尝试通过 CLI 执行 TaskAnalysisSkill（带重规划上下文） ──
        if (taskId && taskDir && skillDir) {
            try {
                return await this._analyzeWithContextViaCLI(
                    taskDescription, userCriteria, context, { taskId, taskDir, skillDir }
                );
            } catch (err) {
                console.warn(`[Brain] CLI 执行 TaskAnalysisSkill（重规划）失败，降级为 LLM 直接调用: ${err.message}`);
            }
        }

        // ── Fallback：直接 LLM 调用 ──
        return await this._analyzeWithContextViaLLM(taskDescription, userCriteria, context);
    }

    /**
     * 通过 CLI 执行 TaskAnalysisSkill（重规划模式）。
     *
     * @param {string} taskDescription
     * @param {string} userCriteria
     * @param {object} context - 重规划上下文
     * @param {object} ctx - { taskId, taskDir, skillDir }
     * @returns {Promise<object>}
     * @private
     */
    async _analyzeWithContextViaCLI(taskDescription, userCriteria, context, ctx) {
        const { taskId, taskDir, skillDir } = ctx;
        const { failedCriteria, improvementSuggestions, prevCheckSummary, prevOrchStatus, loopCount } = context;
        const analysisSkillDir = path.join(skillDir, 'TaskAnalysisSkill');
        const resultFilePath = path.join(taskDir, `brain_analysis_loop${loopCount}.json`);

        const failedText = failedCriteria.length > 0
            ? failedCriteria.map(c => `  - [${c.id || c.criterionId}] ${c.criterion || c.criterionText || ''} → 原因: ${c.reason || c.evidence || '未满足'}`).join('\n')
            : '（无具体未满足标准信息）';

        const suggestionText = improvementSuggestions.length > 0
            ? improvementSuggestions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
            : '（无具体改进建议）';

        const contextSections = [
            `## 任务描述\n${taskDescription}`,
            userCriteria.trim()
                ? `## 用户提供的验收标准\n${userCriteria.trim()}`
                : `## 验收标准\n请根据任务描述自动生成合理的验收标准。`,
            `## 重规划上下文\n当前是第 ${loopCount} 轮重规划，上一轮执行后准出审核未通过。`,
            `## 上一轮审核摘要\n${prevCheckSummary || '（无摘要）'}`,
            `## 上一轮编排状态\n${prevOrchStatus || 'unknown'}`,
            `## 未满足的验收标准\n${failedText}`,
            `## 改进建议\n${suggestionText}`,
            `## 重分析要求\n1. 保持原始任务目标不变\n2. 针对未满足的标准，分析失败原因\n3. 调整验收标准的验证方式，使其更明确\n4. 如有必要，补充新的验收标准\n5. 考虑改进建议中的方向\n6. 生成 failureAnalysis 和 adjustmentStrategy 字段`
        ];

        const title = `brain|task=${taskId}|reanalyze|loop=${loopCount}`;
        const { success, json } = await this.skillExecutor.invokeSkill(
            analysisSkillDir, taskDir, resultFilePath, title, contextSections
        );

        if (!success || !json) {
            throw new Error('TaskAnalysisSkill（重规划）执行失败或结果解析为空');
        }

        return this.normalizeAnalysis(json);
    }

    /**
     * Fallback：直接通过 LLM 分析任务（重规划模式）。
     *
     * @param {string} taskDescription
     * @param {string} userCriteria
     * @param {object} context
     * @returns {Promise<object>}
     * @private
     */
    async _analyzeWithContextViaLLM(taskDescription, userCriteria, context) {
        const { failedCriteria, improvementSuggestions, prevCheckSummary, prevOrchStatus, loopCount } = context;

        const failedText = failedCriteria.length > 0
            ? failedCriteria.map(c => `  - [${c.id || c.criterionId}] ${c.criterion || c.criterionText || ''} → 原因: ${c.reason || c.evidence || '未满足'}`).join('\n')
            : '（无具体未满足标准信息）';

        const suggestionText = improvementSuggestions.length > 0
            ? improvementSuggestions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
            : '（无具体改进建议）';

        const criteriaSection = userCriteria.trim()
            ? `\n## 用户提供的验收标准\n${userCriteria.trim()}\n\n请基于以上用户标准进行细化、补充和结构化。`
            : `\n## 验收标准\n请根据任务描述自动生成合理的验收标准。`;

        const prompt = `你是一个任务分析助手。当前是第 ${loopCount} 轮重规划，上一轮执行后准出审核未通过，需要重新分析任务并调整策略。

## 原始任务描述
${taskDescription}
${criteriaSection}

## 上一轮审核失败信息

### 审核摘要
${prevCheckSummary || '（无摘要）'}

### 上一轮编排状态
${prevOrchStatus || 'unknown'}

### 未满足的验收标准
${failedText}

### 改进建议
${suggestionText}

## 重分析要求
1. 保持原始任务目标不变
2. 针对未满足的标准，分析失败原因
3. 调整验收标准的验证方式，使其更明确
4. 如有必要，补充新的验收标准
5. 考虑改进建议中的方向

## 输出要求
请以 JSON 格式返回，包含以下字段：
{
  "intent": "任务的核心意图（一句话概括）",
  "domain": "任务所属领域",
  "keywords": ["关键词1", "..."],
  "constraints": ["约束条件1", "..."],
  "techStack": ["技术栈1", "..."],
  "complexity": "low|medium|high",
  "estimatedSteps": 3,
  "acceptanceCriteria": [
    {
      "id": "ac1",
      "criterion": "具体的验收标准描述",
      "type": "output|quality|performance|compliance",
      "verification": "如何验证该标准是否满足"
    }
  ],
  "failureAnalysis": "对上一轮失败原因的分析总结",
  "adjustmentStrategy": "本轮的调整策略说明"
}

注意：只返回 JSON，不要包含其他文字。`;

        const result = await this.llm.chatJSON(prompt, { maxTokens: 2048 });
        return this.normalizeAnalysis(result);
    }

    // ─── 规范化 ────────────────────────────────────────────────────────

    /**
     * 规范化分析结果。
     *
     * @param {object} result - LLM 或 SKILL 返回的原始分析结果
     * @returns {object}
     */
    normalizeAnalysis(result) {
        return {
            intent: result.intent || '',
            domain: result.domain || 'general',
            keywords: Array.isArray(result.keywords) ? result.keywords : [],
            constraints: Array.isArray(result.constraints) ? result.constraints : [],
            techStack: Array.isArray(result.techStack) ? result.techStack : [],
            complexity: result.complexity || 'medium',
            estimatedSteps: result.estimatedSteps || 3,
            acceptanceCriteria: Array.isArray(result.acceptanceCriteria)
                ? result.acceptanceCriteria.map((c, idx) => ({
                    id: c.id || `ac${idx + 1}`,
                    criterion: c.criterion || '',
                    type: c.type || 'output',
                    verification: c.verification || ''
                })).filter(c => c.criterion)
                : [],
            failureAnalysis: result.failureAnalysis || '',
            adjustmentStrategy: result.adjustmentStrategy || ''
        };
    }
}

export default AnalysisStrategies;
