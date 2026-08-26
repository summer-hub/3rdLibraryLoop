/**
 * DecompositionStrategies —— 任务拆解策略（CLI 优先 + LLM fallback）
 *
 * 职责：
 *   - 通过 CLI 执行 task-decomposition SKILL（opencode 路径）
 *   - CLI 不可用时降级为直接 LLM 调用
 *   - 支持首轮拆解和重规划场景的上下文拆解
 *   - 规范化步骤数据
 *
 * 设计原则：
 *   - 持有 llm + skillExecutor 引用，不持有 Brain 的业务状态
 *   - 所有方法接收纯参数，返回规范化的步骤数组
 */

import path from 'node:path';
import fs from 'node:fs';

/** 默认拆解指令（SKILL 不存在时的兜底） */
const DEFAULT_DECOMPOSITION_PROMPT = `请按照以下原则拆解任务：

1. 识别任务的主要阶段（分析、执行、验证、总结）
2. 每个阶段拆解为独立的步骤
3. 步骤间设置合理的依赖关系
4. 为关键步骤设置失败回退路径
5. 每个步骤的描述需包含：做什么、怎么做、预期输出
6. 当存在"生成/新增代码"步骤与"编译/执行验证"步骤时，验证步骤的 failStepId 应指向一个独立的"修复代码"步骤（而非生成步骤），修复成功后再通过 nextStepId 回到验证步骤重试，形成"生成→验证→修复→重验证"闭环`;

export class DecompositionStrategies {
    /**
     * @param {object} deps
     * @param {object} deps.llm            - LLMClient 实例
     * @param {object} deps.skillExecutor  - SkillExecutor 实例
     */
    constructor({ llm, skillExecutor }) {
        this.llm = llm;
        this.skillExecutor = skillExecutor;
    }

    // ─── 步骤摘要格式化（重规划共用） ────────────────────────────────

    /**
     * 格式化上一轮步骤执行摘要，供重规划 prompt 注入。
     *
     * 将 completedSteps / failedSteps / pendingSteps 格式化为可读文本，
     * 使 LLM 在重拆解时能识别已完成工作并复用，仅针对未完成部分生成新步骤。
     *
     * @param {object} context - 重规划上下文
     * @returns {string} 格式化后的步骤摘要文本
     * @private
     */
    _formatPrevStepsSummary(context) {
        const { completedSteps = [], failedSteps = [], pendingSteps = [] } = context;

        const parts = [];

        if (completedSteps.length > 0) {
            parts.push(`### 已完成的步骤（${completedSteps.length} 个，产物已生成，无需重新执行）`);
            parts.push(completedSteps.map(s =>
                `  - 步骤${s.stepId}: ${s.taskDescription.slice(0, 120)}` +
                (s.resultPath ? `\n    产物: ${s.resultPath}` : '')
            ).join('\n'));
        }

        if (failedSteps.length > 0) {
            parts.push(`### 失败的步骤（${failedSteps.length} 个，需重点修复）`);
            parts.push(failedSteps.map(s =>
                `  - 步骤${s.stepId}: ${s.taskDescription.slice(0, 120)}` +
                (s.error ? `\n    失败原因: ${s.error}` : '') +
                (s.resultPath ? `\n    部分产物: ${s.resultPath}` : '')
            ).join('\n'));
        }

        if (pendingSteps.length > 0) {
            parts.push(`### 未执行的步骤（${pendingSteps.length} 个）`);
            parts.push(pendingSteps.map(s =>
                `  - 步骤${s.stepId}: ${s.taskDescription.slice(0, 120)}`
            ).join('\n'));
        }

        return parts.length > 0 ? parts.join('\n') : '（无步骤执行信息）';
    }

    // ─── 首轮拆解 ──────────────────────────────────────────────────────

    /**
     * 拆解任务 — 通过 CLI 执行 task-decomposition SKILL 将任务拆解为多个步骤
     *
     * 调用路径：Brain → 构建 prompt → opencode CLI → task-decomposition SKILL → 结果文件
     *
     * 每个步骤的 acceptanceCriteria 是从任务级验收标准中拆分出来的子标准，
     * 确保所有步骤的验收标准合并后能覆盖任务级验收标准。
     *
     * CLI 不可用时降级为直接 LLM 调用（fallback）。
     *
     * @param {string} taskDescription
     * @param {object} analysis - analyzeTask 的返回值
     * @param {string} skillDir - SKILL 目录路径
     * @param {string} [userCriteria] - 用户提供的验收标准
     * @param {object} [execCtx] - CLI 执行上下文 { taskId, taskDir, loopCount }
     * @returns {Promise<{steps: Array, sessionId: string|null}>} steps 为步骤数组，sessionId 为 opencode 会话 ID（LLM fallback 时为 null）
     */
    async decomposeTask(taskDescription, analysis, skillDir, userCriteria = '', execCtx = {}) {
        const { taskId, taskDir, loopCount = 0 } = execCtx;

        // ── 尝试通过 CLI 执行 task-decomposition SKILL ──
        if (taskId && taskDir) {
            try {
                return await this._decomposeViaCLI(taskDescription, analysis, skillDir, userCriteria, {
                    taskId, taskDir, loopCount
                });
            } catch (err) {
                console.warn(`[Brain] CLI 执行 task-decomposition SKILL 失败，降级为 LLM 直接调用: ${err.message}`);
            }
        }

        // ── Fallback：直接 LLM 调用（无 sessionId） ──
        const steps = await this._decomposeViaLLM(taskDescription, analysis, skillDir, userCriteria);
        return { steps, sessionId: null };
    }

    /**
     * 通过 CLI 执行 task-decomposition SKILL。
     *
     * @param {string} taskDescription
     * @param {object} analysis
     * @param {string} skillDir
     * @param {string} userCriteria
     * @param {object} ctx - { taskId, taskDir, loopCount }
     * @returns {Promise<Array>}
     * @private
     */
    async _decomposeViaCLI(taskDescription, analysis, skillDir, userCriteria, ctx) {
        const { taskId, taskDir, loopCount } = ctx;
        const decompSkillDir = path.join(skillDir, 'task-decomposition');
        const resultFilePath = path.join(taskDir, `brain_decomposition_loop${loopCount}.json`);

        // 格式化任务级验收标准
        const taskCriteriaText = (analysis.acceptanceCriteria || [])
            .map(c => `  - [${c.id}] (${c.type}) ${c.criterion} → 验证: ${c.verification}`)
            .join('\n');

        const contextSections = [
            `## 任务描述\n${taskDescription}`,
            `## 任务分析\n- 意图: ${analysis.intent}\n- 领域: ${analysis.domain}\n- 关键词: ${(analysis.keywords || []).join(', ')}\n- 约束: ${(analysis.constraints || []).join(', ')}\n- 技术栈: ${(analysis.techStack || []).join(', ')}\n- 预估步骤数: ${analysis.estimatedSteps}`,
            `## 任务级验收标准\n${taskCriteriaText || '（未提供）'}`,
            userCriteria.trim()
                ? `## 用户提供的验收标准\n${userCriteria.trim()}`
                : null,
            `## 拆解要求\n请按照 SKILL 中的拆解原则执行，确保：\n1. 每个步骤只做一件独立可验证的事\n2. 步骤间通过 dependId/nextStepId/failStepId 构成有向图\n3. 必须有入口步骤（dependId=0）和终止步骤（nextStepId=0）\n4. 每个步骤必须有明确的验收标准\n5. 所有步骤的验收标准合并后应覆盖任务级验收标准\n6. 职责与可用 SKILL 匹配的步骤设置 specifiedSkill 字段（可用列表按 SKILL.md 指令运行 SKILL 内脚本获取，值必须来自该列表）`
        ].filter(Boolean);

        const title = `brain|task=${taskId}|decompose|loop=${loopCount}`;
        const { success, json, sessionId } = await this.skillExecutor.invokeSkill(
            decompSkillDir, taskDir, resultFilePath, title, contextSections
        );

        if (!success || !json || !json.steps) {
            throw new Error('task-decomposition SKILL 执行失败或结果中未包含有效步骤');
        }

        return { steps: this.normalizeSteps(json.steps), sessionId: sessionId || null };
    }

    /**
     * Fallback：直接通过 LLM 拆解任务。
     *
     * @param {string} taskDescription
     * @param {object} analysis
     * @param {string} skillDir
     * @param {string} userCriteria
     * @returns {Promise<Array>}
     * @private
     */
    async _decomposeViaLLM(taskDescription, analysis, skillDir, userCriteria) {
        const skillPath = path.join(skillDir, 'task-decomposition', 'SKILL.md');

        // 尝试读取 SKILL.md，获取拆解指令
        let skillInstructions = '';
        try {
            skillInstructions = fs.readFileSync(skillPath, 'utf-8');
        } catch {
            // SKILL 不存在时使用内置默认指令
            skillInstructions = DEFAULT_DECOMPOSITION_PROMPT;
        }

        // 格式化任务级验收标准供 LLM 参考
        const taskCriteriaText = (analysis.acceptanceCriteria || [])
            .map(c => `  - [${c.id}] (${c.type}) ${c.criterion} → 验证: ${c.verification}`)
            .join('\n');

        // 可用 SKILL 列表不在系统侧注入：由 SKILL.md 指令（Phase 1.5）运行
        // SKILL 内的 scripts/list-available-skills.cjs 实时获取，保持单一事实源在 SKILL 内。
        // LLM fallback 路径无法执行脚本，specifiedSkill 按字段说明可选输出。

        const prompt = `你是一个任务拆解专家。请将以下自然语言任务拆解为多个可独立执行的步骤。

## 任务描述
${taskDescription}

## 任务分析
- 意图: ${analysis.intent}
- 领域: ${analysis.domain}
- 关键词: ${analysis.keywords.join(', ')}
- 约束: ${analysis.constraints.join(', ')}
- 技术栈: ${analysis.techStack.join(', ')}
- 预估步骤数: ${analysis.estimatedSteps}

## 任务级验收标准
${taskCriteriaText || '（未提供）'}

## 拆解指令
${skillInstructions}

## 输出要求
请以 JSON 格式返回，包含以下结构：
{
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "该步骤的具体任务描述（需要足够详细，能被 Skill 匹配器理解）",
      "specifiedSkill": "rnoh-lib-version-diff",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac1_1",
          "criterion": "该步骤的验收标准描述",
          "type": "output|quality|performance|compliance",
          "verification": "如何验证该标准是否满足",
          "taskACIds": ["ac1"]
        }
      ]
    }
  ]
}

### 字段说明
- stepId: 步骤 ID，从 1 开始的正整数
- taskDescription: 该步骤的具体任务描述，必须详细且可执行
- specifiedSkill: 可选。步骤职责与某个可用 SKILL 匹配时设置（值为该 SKILL 的 name 或目录名），执行层将直接使用该 SKILL；无法确认可用 SKILL 列表时不设置该字段。禁止在 taskDescription 中写"推荐使用 X SKILL 执行"推荐文本
- dependId: 依赖的步骤 ID，0 表示无依赖（入口步骤）
- nextStepId: 成功后执行的下一步 ID，0 表示结束
- failStepId: 失败后跳转的步骤 ID，0 表示失败即终止
- maxRetries: 最大重试次数，默认 3
- acceptanceCriteria: 该步骤的验收标准数组
  - id: 标准唯一 ID，格式为 ac{stepId}_{序号}
  - criterion: 具体标准描述
  - type: 标准类型（output=产物检查, quality=质量要求, performance=性能指标, compliance=合规性）
  - verification: 验证方式（如检查文件、执行命令、内容审查等）
  - taskACIds: 该步骤标准关联的任务级标准 ID 列表

### 拆解原则
1. 每个步骤只做一件独立可验证的事
2. 步骤间通过 dependId/nextStepId/failStepId 构成有向图
3. 必须有且仅有一个入口步骤（dependId=0）
4. 步骤描述要包含足够的技术细节，便于 Skill 匹配
5. 考虑失败后的回退路径（failStepId）
6. **每个步骤必须有明确的验收标准**，标准需具体、可验证
7. 所有步骤的验收标准合并后应覆盖任务级验收标准
8. 验收标准中的 verification 要描述可执行的验证方式
9. 当存在"生成/新增代码"步骤与"编译/执行验证"步骤时，验证步骤的 failStepId 必须指向一个独立的"修复代码"步骤（而非生成步骤），修复步骤成功后再通过 nextStepId 指回验证步骤重试，严禁让验证失败直接回退到生成步骤

注意：只返回 JSON，不要包含其他文字。`;

        const result = await this.llm.chatJSON(prompt, { maxTokens: 8192 });

        if (!result.steps || !Array.isArray(result.steps) || result.steps.length === 0) {
            throw new Error('LLM 拆解结果中未包含有效步骤');
        }

        return this.normalizeSteps(result.steps);
    }

    // ─── 重规划拆解 ────────────────────────────────────────────────────

    /**
     * 重规划场景下的任务拆解 — 通过 CLI 执行 task-decomposition SKILL（带重规划上下文）
     *
     * 调用路径：Brain → 构建 prompt（含失败信息）→ opencode CLI → task-decomposition SKILL → 结果文件
     *
     * CLI 不可用时降级为直接 LLM 调用（fallback）。
     *
     * @param {string} taskDescription
     * @param {object} analysis - analyzeTaskWithContext 的返回值
     * @param {string} skillDir - SKILL 目录路径
     * @param {string} userCriteria
     * @param {object} context - 重规划上下文 { failedCriteria, improvementSuggestions, prevCheckSummary, loopCount }
     * @param {object} [execCtx] - CLI 执行上下文 { taskId, taskDir, skillDir }
     * @returns {Promise<{steps: Array, sessionId: string|null}>}
     */
    async decomposeTaskWithContext(taskDescription, analysis, skillDir, userCriteria, context, execCtx = {}) {
        const { taskId, taskDir } = execCtx;
        const { loopCount } = context;

        // ── 尝试通过 CLI 执行 task-decomposition SKILL（带重规划上下文）──
        if (taskId && taskDir) {
            try {
                return await this._decomposeWithContextViaCLI(
                    taskDescription, analysis, skillDir, userCriteria, context, { taskId, taskDir, loopCount }
                );
            } catch (err) {
                console.warn(`[Brain] CLI 执行 task-decomposition SKILL（重规划）失败，降级为 LLM 直接调用: ${err.message}`);
            }
        }

        // ── Fallback：直接 LLM 调用（无 sessionId） ──
        const steps = await this._decomposeWithContextViaLLM(taskDescription, analysis, skillDir, userCriteria, context);
        return { steps, sessionId: null };
    }

    /**
     * 通过 CLI 执行 task-decomposition SKILL（重规划上下文）。
     *
     * @param {string} taskDescription
     * @param {object} analysis
     * @param {string} skillDir
     * @param {string} userCriteria
     * @param {object} context
     * @param {object} ctx - { taskId, taskDir, loopCount }
     * @returns {Promise<Array>}
     * @private
     */
    async _decomposeWithContextViaCLI(taskDescription, analysis, skillDir, userCriteria, context, ctx) {
        const { taskId, taskDir, loopCount } = ctx;
        const { failedCriteria, improvementSuggestions, prevCheckSummary } = context;
        const decompSkillDir = path.join(skillDir, 'task-decomposition');
        const resultFilePath = path.join(taskDir, `brain_decomposition_loop${loopCount}.json`);

        const taskCriteriaText = (analysis.acceptanceCriteria || [])
            .map(c => `  - [${c.id}] (${c.type}) ${c.criterion} → 验证: ${c.verification}`)
            .join('\n');

        const failedText = failedCriteria.length > 0
            ? failedCriteria.map(c => `  - [${c.id || c.criterionId}] ${c.criterion || c.criterionText || ''}`).join('\n')
            : '（无）';

        const suggestionText = improvementSuggestions.length > 0
            ? improvementSuggestions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
            : '（无）';

        // 格式化上一轮步骤执行摘要（已完成步骤 + 失败步骤 + 产物路径）
        const prevStepsText = this._formatPrevStepsSummary(context);

        const contextSections = [
            `## 原始任务描述\n${taskDescription}`,
            `## 任务分析\n- 意图: ${analysis.intent}\n- 领域: ${analysis.domain}\n- 预估步骤数: ${analysis.estimatedSteps}\n- 失败分析: ${analysis.failureAnalysis || '无'}\n- 调整策略: ${analysis.adjustmentStrategy || '无'}`,
            `## 任务级验收标准\n${taskCriteriaText || '（未提供）'}`,
            userCriteria.trim()
                ? `## 用户提供的验收标准\n${userCriteria.trim()}`
                : null,
            `## 上一轮失败信息\n### 审核摘要\n${prevCheckSummary || '（无）'}\n### 未满足的验收标准\n${failedText}\n### 改进建议\n${suggestionText}`,
            `## 上一轮步骤执行详情\n${prevStepsText}`,
            `## 重拆解要求\n当前是第 ${loopCount} 轮重规划，请基于上一轮失败信息和已完成步骤重新拆解任务：\n1. 已完成的步骤无需重新执行，它们的产物已生成并可用\n2. 针对失败的步骤和未满足的验收标准，调整步骤描述或新增步骤\n3. 增加或强化验证步骤\n4. 考虑改进建议中的方向，新增必要的步骤\n5. 保持步骤间的依赖关系合理\n6. 新步骤 ID 从 1 开始重新编号，但在步骤描述中注明引用了上一轮哪个步骤的产物（如"基于上一轮步骤3的产物…"）\n7. 职责与可用 SKILL 匹配的步骤设置 specifiedSkill 字段（可用列表按 SKILL.md 指令运行 SKILL 内脚本获取，值必须来自该列表）`
        ].filter(Boolean);

        const title = `brain|task=${taskId}|decompose|replan|loop=${loopCount}`;
        const { success, json, sessionId } = await this.skillExecutor.invokeSkill(
            decompSkillDir, taskDir, resultFilePath, title, contextSections
        );

        if (!success || !json || !json.steps) {
            throw new Error('task-decomposition SKILL（重规划）执行失败或结果中未包含有效步骤');
        }

        return { steps: this.normalizeSteps(json.steps), sessionId: sessionId || null };
    }

    /**
     * Fallback：直接通过 LLM 拆解任务（重规划上下文）。
     *
     * @param {string} taskDescription
     * @param {object} analysis
     * @param {string} skillDir
     * @param {string} userCriteria
     * @param {object} context
     * @returns {Promise<Array>}
     * @private
     */
    async _decomposeWithContextViaLLM(taskDescription, analysis, skillDir, userCriteria, context) {
        const { failedCriteria, improvementSuggestions, prevCheckSummary, loopCount } = context;

        let skillInstructions = '';
        try {
            const skillPath = path.join(skillDir, 'task-decomposition', 'SKILL.md');
            skillInstructions = fs.readFileSync(skillPath, 'utf-8');
        } catch {
            skillInstructions = DEFAULT_DECOMPOSITION_PROMPT;
        }

        const taskCriteriaText = (analysis.acceptanceCriteria || [])
            .map(c => `  - [${c.id}] (${c.type}) ${c.criterion} → 验证: ${c.verification}`)
            .join('\n');

        const failedText = failedCriteria.length > 0
            ? failedCriteria.map(c => `  - [${c.id || c.criterionId}] ${c.criterion || c.criterionText || ''}`).join('\n')
            : '（无）';

        const suggestionText = improvementSuggestions.length > 0
            ? improvementSuggestions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
            : '（无）';

        // 格式化上一轮步骤执行摘要（已完成步骤 + 失败步骤 + 产物路径）
        const prevStepsText = this._formatPrevStepsSummary(context);

        // 可用 SKILL 列表不在系统侧注入：由 SKILL.md 指令（Phase 1.5）运行
        // SKILL 内的 scripts/list-available-skills.cjs 实时获取，保持单一事实源在 SKILL 内。

        const prompt = `你是一个任务拆解专家。当前是第 ${loopCount} 轮重规划，上一轮执行后准出审核未通过，请基于失败信息和已完成步骤重新拆解任务。

## 原始任务描述
${taskDescription}

## 任务分析
- 意图: ${analysis.intent}
- 领域: ${analysis.domain}
- 预估步骤数: ${analysis.estimatedSteps}
- 失败分析: ${analysis.failureAnalysis || '无'}
- 调整策略: ${analysis.adjustmentStrategy || '无'}

## 任务级验收标准
${taskCriteriaText || '（未提供）'}

## 上一轮失败信息
### 审核摘要
${prevCheckSummary || '（无）'}

### 上一轮步骤执行详情
${prevStepsText}

### 未满足的验收标准
${failedText}

### 改进建议
${suggestionText}

## 拆解指令
${skillInstructions}

## 重拆解要求
1. 已完成的步骤无需重新执行，它们的产物已生成并可用
2. 针对失败的步骤和未满足的验收标准，调整步骤描述或新增步骤
3. 增加或强化验证步骤
4. 考虑改进建议中的方向，新增必要的步骤
5. 保持步骤间的依赖关系合理
6. 新步骤 ID 从 1 开始重新编号，但在步骤描述中注明引用了上一轮哪个步骤的产物（如"基于上一轮步骤3的产物…"）
7. 若上一轮存在"编译/执行验证失败"且失败归因于本次生成的代码，应新增一个独立的"修复代码"步骤，并让验证步骤的 failStepId 指向它（而非生成步骤），修复成功后再通过 nextStepId 指回验证步骤重试
8. 职责与可用 SKILL 匹配的步骤设置 specifiedSkill 字段（值为该 SKILL 的 name 或目录名）；无法确认可用 SKILL 列表时不设置该字段。禁止在 taskDescription 中写"推荐使用 X SKILL 执行"推荐文本

## 输出要求
请以 JSON 格式返回：
{
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "该步骤的具体任务描述",
      "specifiedSkill": "rnoh-lib-version-diff",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac1_1",
          "criterion": "该步骤的验收标准",
          "type": "output|quality|performance|compliance",
          "verification": "验证方式",
          "taskACIds": ["ac1"]
        }
      ]
    }
  ]
}

字段说明：specifiedSkill 为可选字段，步骤职责与某个可用 SKILL 匹配时设置（值为该 SKILL 的 name 或目录名），执行层将直接使用该 SKILL 跳过自动匹配；未匹配时不设置。

注意：只返回 JSON，不要包含其他文字。`;

        const result = await this.llm.chatJSON(prompt, { maxTokens: 8192 });

        if (!result.steps || !Array.isArray(result.steps) || result.steps.length === 0) {
            throw new Error('LLM 重拆解结果中未包含有效步骤');
        }

        return this.normalizeSteps(result.steps);
    }

    // ─── 规范化 ────────────────────────────────────────────────────────

    /**
     * 规范化步骤数据。
     *
     * @param {Array} steps - LLM 或 SKILL 返回的原始步骤数组
     * @returns {Array}
     */
    normalizeSteps(steps) {
        if (!Array.isArray(steps) || steps.length === 0) {
            throw new Error('步骤列表为空');
        }
        // 先归一化，再做修复步骤 dependId 哨兵规范化（sanitizeFixChainDependId → -1）
        const normalized = steps.map((s, idx) => ({
            stepId: typeof s.stepId === 'number' ? s.stepId : idx + 1,
            taskDescription: s.taskDescription || '',
            // specifiedSkill 透传：拆解时绑定的执行 SKILL（name 或目录名），空串表示未绑定
            specifiedSkill: typeof s.specifiedSkill === 'string' ? s.specifiedSkill.trim() : '',
            dependId: normalizeStepDependId(s.dependId),
            nextStepId: s.nextStepId ?? 0,
            failStepId: s.failStepId ?? 0,
            maxRetries: s.maxRetries ?? 3,
            acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
                ? s.acceptanceCriteria.map((c, ci) => ({
                    id: c.id || `ac${idx + 1}_${ci + 1}`,
                    criterion: c.criterion || '',
                    type: c.type || 'output',
                    verification: c.verification || '',
                    taskACIds: Array.isArray(c.taskACIds) ? c.taskACIds : []
                })).filter(c => c.criterion)
                : []
        }));
        return sanitizeFixChainDependId(normalized);
    }
}

/**
 * 归一化步骤的 dependId：支持 number | number[]（fan-in 聚合）。
 * - 数组 → 过滤 0/空后保留（-1 哨兵穿透保留）
 * - 单值 → 0/null 时返回 0；-1 哨兵原样返回（允许穿透，由 sanitizeFixChainDependId 统一设置）
 * @param {number|number[]|null|undefined} value
 * @returns {number|number[]}
 */
function normalizeStepDependId(value) {
    if (Array.isArray(value)) {
        const filtered = value
            .map(v => Number(v))
            .filter(v => Number.isFinite(v) && v !== 0);
        return filtered.length === 0 ? 0 : filtered;
    }
    const n = Number(value);
    return Number.isFinite(n) && n !== 0 ? n : 0;
}

/**
 * 修复步骤 dependId 哨兵规范化（-1）。
 *
 * 背景：某步骤 A 的 failStepId=B（B 是 A 的修复步骤）时，B 的真实进入条件是"A 失败"
 * （由 failStepId 边传递），B 不应有"成功依赖边"或"入口身份"。
 * 但 LLM 生成的 B.dependId 可能取四类值，均产生歧义：
 *   1. dependId=0 / 空          → 被 Orchestrator 误判为入口步骤，提前并行执行
 *   2. dependId 指向 A（修复目标）→ 失败链与依赖链重叠
 *   3. dependId 指向并行步骤 C   → 与源步骤同轮 fan-out 误激活（Orchestrator._activateDependents 已兜底）
 *   4. dependId 指向真实前置     → 语义尚可，但依赖边冗余（修复步骤只经 failStepId 进入）
 *
 * 规范规则：仅当被 failStepId 指向的节点是"纯修复步骤"时，其 dependId 规范化为 -1 哨兵
 * （表示"仅由 failStepId 触发、无入口身份、无并行依赖"）。判定"纯修复步骤"：
 *   1. dependId 未给出任何真实前置（0 / 空 / 仅指向修复目标 / 无效引用），且有
 *   2. 没有被任何其它步骤的 dependId 引用（不承担"产物提供者"角色，即不是普通入口/锚点）。
 *
 * 例外（保留原值，fan-out 风险交由 Orchestrator._fixStepIds 兜底）：
 *   - 修复步骤已有真实 dependId——不强行置 -1，避免破坏其真实前置语义。
 *   - "重试锚点回退"：链首入口步骤恰被某步骤 failStepId 指向（如 A.failStepId=链首，
 *     A 失败跳回链首重跑全链），且该步骤被其它步骤 dependId 引用——它是真正的入口，
 *     置 -1 会使其失去入口身份，必须保留 dependId=0/真实依赖。
 *
 * @param {Array<{stepId:number, dependId:number|number[], failStepId:number}>} steps - 归一化后的步骤
 * @returns {Array} 修正后的步骤数组（在副本上修改，不污染入参）
 */
function sanitizeFixChainDependId(steps) {
    // 收集修复步骤 -> 触发它的源步骤（即"修复目标"）id
    const fixTargetOf = new Map(); // 修复步骤 id -> 源步骤 id 列表
    for (const step of steps) {
        const fail = Number(step.failStepId);
        if (Number.isFinite(fail) && fail !== 0 && fail !== Number(step.stepId)) {
            if (!fixTargetOf.has(fail)) fixTargetOf.set(fail, []);
            if (!fixTargetOf.get(fail).includes(Number(step.stepId))) {
                fixTargetOf.get(fail).push(Number(step.stepId));
            }
        }
    }

    // 所有 stepId 集合
    const idSet = new Set(steps.map(s => Number(s.stepId)));
    // 被其它步骤 dependId 引用的 stepId 集合（真实"产物提供者"角色）
    const depReferenced = new Set();
    for (const step of steps) {
        const dependIds = Array.isArray(step.dependId) ? step.dependId : [step.dependId];
        for (const d of dependIds) {
            const n = Number(d);
            if (Number.isFinite(n) && n !== 0 && n !== -1) depReferenced.add(n);
        }
    }

    return steps.map(step => {
        const targets = fixTargetOf.get(Number(step.stepId)) || [];
        if (targets.length === 0) return step; // 非修复步骤，保留原 dependId

        if (Number(step.dependId) === -1) return step; // 已是哨兵，幂等

        const sid = Number(step.stepId);
        // 是否已有"非修复目标"的真实前置依赖（指向修复目标 A 的 dependId 不算真实依赖，
        // 那是失败链与依赖链的重叠边，应剔除后置 -1）
        const dependIds = Array.isArray(step.dependId) ? step.dependId : [step.dependId];
        const hasRealDeps = dependIds.some(d => {
            const n = Number(d);
            return Number.isFinite(n) && n !== 0 && n !== -1 && idSet.has(n) && !targets.includes(n);
        });
        // 是否承担"产物提供者"角色（被其它步骤 dependId 引用 → 真入口/锚点，非纯修复步骤）
        const isDepSource = depReferenced.has(sid);

        if (hasRealDeps || isDepSource) return step;

        // 纯修复步骤：dependId 统一规范化为 -1 哨兵
        return { ...step, dependId: -1 };
    });
}

export default DecompositionStrategies;
