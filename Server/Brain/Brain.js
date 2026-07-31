/**
 * Brain —— 自然语言任务拆解引擎
 *
 * 职责：
 *   - 接收一段自然语言的高层任务描述
 *   - 通过 AI SKILL 调用 LLM，将任务拆解为多个可执行的步骤
 *   - 产出 Orchestrator.loadTask() 可直接消费的任务 JSON
 *   - 支持拆解结果的持久化、历史查询、直接提交编排器执行
 *
 * 架构角色：
 *   自然语言任务 → Brain（拆解）→ Orchestrator（编排）→ FlexRunner（执行）
 *
 * 设计原则：
 *   - 高内聚：所有任务拆解逻辑集中于此，不感知 HTTP 层
 *   - 低耦合：依赖注入 LLMClient / SkillSelector / Storage / OrchestratorController
 *   - 可扩展：拆解策略通过 Skill 调用实现，新增拆解能力只需新增 Skill
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

import { LLMClient } from '../Agent/SkillSelector/llm/llmClient.js';
import { nowCST } from '../library/cstTime.js';
import { createStorage } from '../DbUse/index.js';

// 加载 Server/.env（本文件在 Brain/ 下，上两级目录为 Server/）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * Brain 拆解状态常量
 */
export const BrainStatus = Object.freeze({
    IDLE: 'idle',
    ANALYZING: 'analyzing',
    PLANNING: 'planning',
    VALIDATING: 'validating',
    COMPLETED: 'completed',
    FAILED: 'failed'
});

/**
 * Brain —— 任务拆解引擎
 */
export class Brain {
    /**
     * @param {object} [deps] - 依赖注入
     * @param {LLMClient} [deps.llm]            - LLM 客户端（复用 SkillSelector 的 LLMClient）
     * @param {object}   [deps.storage]         - 存储门面（createStorage() 返回值）
     * @param {object}   [deps.sseHub]          - SseHub 实例（可选，用于推送拆解进度）
     * @param {string}   [deps.skillDirectory]  - SKILL 目录路径（用于拆解时上下文）
     */
    constructor(deps = {}) {
        this.llm = deps.llm || new LLMClient();
        this.storage = deps.storage || createStorage();
        this.sseHub = deps.sseHub || null;
        this.skillDirectory = deps.skillDirectory ||
            path.resolve(__dirname, '..', 'Skills');

        /** @type {Map<string, BrainPlan>} key = planId */
        this._plans = new Map();

        /** 当前状态 */
        this._status = BrainStatus.IDLE;
    }

    // ─── 属性访问 ──────────────────────────────────────────────────────

    get status() {
        return this._status;
    }

    /**
     * 获取所有已拆解的计划
     * @returns {BrainPlan[]}
     */
    getPlans() {
        return Array.from(this._plans.values());
    }

    /**
     * 获取指定计划
     * @param {string} planId
     * @returns {BrainPlan|undefined}
     */
    getPlan(planId) {
        return this._plans.get(planId);
    }

    // ─── SSE 推送辅助 ──────────────────────────────────────────────────

    /**
     * 推送拆解进度事件
     * @param {string} channel   - SSE 频道（通常为 planId）
     * @param {string} eventType - 事件类型
     * @param {object} data      - 事件数据
     */
    _emit(channel, eventType, data) {
        if (this.sseHub) {
            this.sseHub.emit(channel, eventType, data);
        }
    }

    // ─── 核心方法 ──────────────────────────────────────────────────────

    /**
     * 拆解任务 — 将自然语言任务描述转换为 Orchestrator 可执行的任务 JSON
     *
     * 流程：
     *   1. ANALYZING  — LLM 分析任务意图、技术栈、约束条件
     *   2. PLANNING   — LLM 将任务拆解为多个步骤，生成步骤间的依赖关系
     *   3. VALIDATING — 校验拆解结果的完整性和合理性
     *
     * @param {string} taskDescription    - 自然语言任务描述
     * @param {object} [options]
     * @param {string} [options.taskId]   - 指定 taskId（不传则自动生成）
     * @param {string} [options.taskDir]  - 指定工作目录
     * @param {string} [options.skillDirectory] - 覆盖默认 SKILL 目录
     * @param {string} [options.planId]   - 指定 planId（不传则自动生成）
     * @param {string} [options.acceptanceCriteria] - 用户提供的验收标准（自然语言，可选）
     * @returns {Promise<BrainPlan>}
     */
    async planTask(taskDescription, options = {}) {
        if (!taskDescription || typeof taskDescription !== 'string') {
            throw new Error('Brain.planTask: taskDescription 不能为空');
        }

        const planId = options.planId || _generatePlanId();
        const taskId = options.taskId || _generateTaskId();
        const skillDir = options.skillDirectory || this.skillDirectory;
        const taskDir = options.taskDir ||
            path.resolve(this.storage.manager.rootDir, '..', 'task', taskId);
        const userCriteria = options.acceptanceCriteria || '';

        this._status = BrainStatus.ANALYZING;
        this._emit(planId, 'brain:plan:start', { planId, taskId, taskDescription });

        try {
            // ─── 步骤 1：分析任务意图 + 提取/生成验收标准 ───
            const analysis = await this._analyzeTask(taskDescription, userCriteria);
            this._emit(planId, 'brain:analyze:done', { planId, analysis });

            // ─── 步骤 2：拆解为步骤（含步骤级验收标准） ───
            this._status = BrainStatus.PLANNING;
            const rawSteps = await this._decomposeTask(taskDescription, analysis, skillDir, userCriteria);
            this._emit(planId, 'brain:plan:done', {
                planId,
                stepCount: rawSteps.length,
                steps: rawSteps.map(s => ({ stepId: s.stepId, taskDescription: s.taskDescription }))
            });

            // ─── 步骤 3：校验拆解结果 ───
            this._status = BrainStatus.VALIDATING;
            const validation = this._validatePlan(rawSteps);
            if (!validation.valid) {
                throw new Error(`拆解结果校验失败: ${validation.issues.join('; ')}`);
            }
            this._emit(planId, 'brain:validate:done', { planId, validation });

            // ─── 组装最终任务 JSON ───
            const taskDef = {
                taskId,
                taskDir,
                skillDirectory: skillDir,
                acceptanceCriteria: analysis.acceptanceCriteria || [],
                steps: rawSteps.map(s => ({
                    stepId: s.stepId,
                    taskDescription: s.taskDescription,
                    dependId: s.dependId ?? 0,
                    nextStepId: s.nextStepId ?? 0,
                    failStepId: s.failStepId ?? 0,
                    maxRetries: s.maxRetries ?? 3,
                    acceptanceCriteria: s.acceptanceCriteria || []
                }))
            };

            // ─── 构建 BrainPlan 对象 ───
            const plan = {
                planId,
                taskId,
                taskDescription,
                userAcceptanceCriteria: userCriteria || '',
                analysis,
                taskDef,
                validation,
                createdAt: nowCST(),
                status: BrainStatus.COMPLETED
            };

            // 持久化
            await this._persistPlan(plan);

            this._plans.set(planId, plan);
            this._status = BrainStatus.COMPLETED;
            this._emit(planId, 'brain:plan:complete', { planId, taskDef });

            return plan;

        } catch (err) {
            this._status = BrainStatus.FAILED;
            this._emit(planId, 'brain:plan:error', { planId, error: err.message });
            throw err;
        }
    }

    /**
     * 拆解并执行 — 拆解任务后直接交给 OrchestratorController 执行
     *
     * @param {string} taskDescription    - 自然语言任务描述
     * @param {object} orchestratorController - OrchestratorController 实例
     * @param {object} [options]          - 同 planTask 的 options
     * @returns {Promise<{plan: BrainPlan, orchestratorProgress: object}>}
     */
    async planAndExecute(taskDescription, orchestratorController, options = {}) {
        const plan = await this.planTask(taskDescription, options);

        // 调用 OrchestratorController.load 加载任务
        const mockReq = { body: plan.taskDef };
        const loadResult = await this._invokeController(
            orchestratorController, 'load', mockReq
        );

        // 启动编排
        const startReq = { body: { taskId: plan.taskDef.taskId } };
        await this._invokeController(
            orchestratorController, 'start', startReq
        );

        return {
            plan,
            loadResult
        };
    }

    // ─── 内部：LLM 拆解步骤 ────────────────────────────────────────────

    /**
     * 分析任务意图 — LLM 提取任务的关键信息 + 生成任务级验收标准
     *
     * 如果用户提供了验收标准，LLM 会基于用户标准进行细化和补充；
     * 如果用户未提供，LLM 会根据任务描述自动生成合理的验收标准。
     *
     * @param {string} taskDescription
     * @param {string} [userCriteria] - 用户提供的验收标准（自然语言）
     * @returns {Promise<object>} { intent, domain, keywords, constraints, techStack, acceptanceCriteria }
     */
    async _analyzeTask(taskDescription, userCriteria = '') {
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
                : []
        };
    }

    /**
     * 拆解任务 — LLM 将任务拆解为多个步骤，并为每个步骤生成验收标准
     *
     * 调用路径：Brain → 构建 Skill 指向 prompt → LLM → 解析 JSON
     *
     * 每个步骤的 acceptanceCriteria 是从任务级验收标准中拆分出来的子标准，
     * 确保所有步骤的验收标准合并后能覆盖任务级验收标准。
     *
     * @param {string} taskDescription
     * @param {object} analysis - _analyzeTask 的返回值
     * @param {string} skillDir - SKILL 目录路径
     * @param {string} [userCriteria] - 用户提供的验收标准
     * @returns {Promise<Array>} 步骤数组
     */
    async _decomposeTask(taskDescription, analysis, skillDir, userCriteria = '') {
        const skillPath = path.join(skillDir, 'TaskDecompositionSkill', 'SKILL.md');

        // 尝试读取 SKILL.md，获取拆解指令
        let skillInstructions = '';
        try {
            skillInstructions = fs.readFileSync(skillPath, 'utf-8');
        } catch {
            // SKILL 不存在时使用内置默认指令
            skillInstructions = this._getDefaultDecompositionPrompt();
        }

        // 格式化任务级验收标准供 LLM 参考
        const taskCriteriaText = (analysis.acceptanceCriteria || [])
            .map(c => `  - [${c.id}] (${c.type}) ${c.criterion} → 验证: ${c.verification}`)
            .join('\n');

        const prompt = `你是一个任务拆解专家。请将以下自然语言任务拆解为多个可独立执行的步骤。

## 任务描述
${taskDescription}

## 任务分析
- 意图: ${analysis.intent}
- 领域: ${analysis.domain}
- 关键词: ${analysis.keywords.join(', ')}
- 约束: ${analysis.constraints.join(', ')}
- 技术栈: ${analysis.techStack.join(', ')}
- 复杂度: ${analysis.complexity}
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
1. 每个步骤应该能被一个 SKILL 独立完成
2. 步骤间通过 dependId/nextStepId/failStepId 构成有向图
3. 必须有且仅有一个入口步骤（dependId=0）
4. 步骤描述要包含足够的技术细节，便于 Skill 匹配
5. 考虑失败后的回退路径（failStepId）
6. **每个步骤必须有明确的验收标准**，标准需具体、可验证
7. 所有步骤的验收标准合并后应覆盖任务级验收标准
8. 验收标准中的 verification 要描述可执行的验证方式

注意：只返回 JSON，不要包含其他文字。`;

        const result = await this.llm.chatJSON(prompt, { maxTokens: 8192 });

        if (!result.steps || !Array.isArray(result.steps) || result.steps.length === 0) {
            throw new Error('LLM 拆解结果中未包含有效步骤');
        }

        // 规范化步骤数据
        return result.steps.map((s, idx) => ({
            stepId: typeof s.stepId === 'number' ? s.stepId : idx + 1,
            taskDescription: s.taskDescription || '',
            dependId: s.dependId ?? 0,
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
    }

    /**
     * 校验拆解结果的完整性和合理性
     * @param {Array} steps
     * @returns {{valid: boolean, issues: string[]}}
     */
    _validatePlan(steps) {
        const issues = [];

        if (steps.length === 0) {
            issues.push('步骤列表为空');
            return { valid: false, issues };
        }

        // 检查 stepId 唯一性
        const ids = steps.map(s => s.stepId);
        const uniqueIds = new Set(ids);
        if (ids.length !== uniqueIds.size) {
            issues.push('存在重复的 stepId');
        }

        // 检查入口步骤
        const entrySteps = steps.filter(s => !s.dependId || s.dependId === 0);
        if (entrySteps.length === 0) {
            issues.push('缺少入口步骤（dependId=0）');
        } else if (entrySteps.length > 1) {
            // 多入口是允许的（并行执行），但需提示
            // 不算错误
        }

        // 检查依赖引用的有效性
        for (const step of steps) {
            if (step.dependId && step.dependId !== 0 &&
                !uniqueIds.has(step.dependId)) {
                issues.push(`步骤 ${step.stepId} 的 dependId=${step.dependId} 不存在`);
            }
            if (step.nextStepId && step.nextStepId !== 0 &&
                !uniqueIds.has(step.nextStepId)) {
                issues.push(`步骤 ${step.stepId} 的 nextStepId=${step.nextStepId} 不存在`);
            }
            if (step.failStepId && step.failStepId !== 0 &&
                !uniqueIds.has(step.failStepId)) {
                issues.push(`步骤 ${step.stepId} 的 failStepId=${step.failStepId} 不存在`);
            }
        }

        // 检查是否有终止步骤（nextStepId=0）
        const terminalSteps = steps.filter(s => !s.nextStepId || s.nextStepId === 0);
        if (terminalSteps.length === 0) {
            issues.push('缺少终止步骤（nextStepId=0），可能导致无限循环');
        }

        // 检查任务描述不为空
        for (const step of steps) {
            if (!step.taskDescription || step.taskDescription.trim() === '') {
                issues.push(`步骤 ${step.stepId} 的 taskDescription 为空`);
            }
        }

        return {
            valid: issues.filter(i => !i.includes('多入口')).length === 0,
            issues
        };
    }

    // ─── 内部：持久化 ──────────────────────────────────────────────────

    /**
     * 持久化拆解计划到文件系统。
     *
     * 文件路径：db/task/{taskId}/brain.json
     *
     * 与 TaskExecutionStore 的目录结构保持一致：
     *   db/task/{taskId}/
     *     ├── brain.json              ← Brain 拆解计划（本方法写入）
     *     ├── stepid_1.json           ← 步骤执行记录（Orchestrator 执行时写入）
     *     ├── stepid_2.json
     *     └── ...
     *
     * @param {BrainPlan} plan
     */
    async _persistPlan(plan) {
        try {
            const json = this.storage.json('task');
            await json.write(`${plan.taskId}/brain`, plan);
        } catch (err) {
            console.warn(`[Brain] 持久化计划失败: ${err.message}`);
        }
    }

    /**
     * 从文件系统加载历史计划。
     *
     * 查找路径：db/task/{taskId}/brain.json
     *
     * 支持两种入参：
     *   - 传 planId：遍历 db/task/ 下所有 brain.json 查找匹配的 planId
     *   - 传 taskId（通过 options.taskId）：直接读取 db/task/{taskId}/brain.json
     *
     * @param {string} planId
     * @param {object} [options]
     * @param {string} [options.taskId] - 直接按 taskId 加载，避免遍历
     * @returns {Promise<BrainPlan|null>}
     */
    async loadPlan(planId, options = {}) {
        // 先从内存查找
        const cached = this._plans.get(planId);
        if (cached) return cached;

        try {
            const json = this.storage.json('task');

            // 快速路径：直接按 taskId 读取
            if (options.taskId) {
                const plan = await json.read(`${options.taskId}/brain`);
                if (plan) {
                    this._plans.set(plan.planId, plan);
                }
                return plan;
            }

            // 回退路径：遍历 db/task/ 子目录查找匹配 planId 的 brain.json
            const entries = await json.list();
            for (const entry of entries) {
                if (entry.key.endsWith('/brain') && entry.data?.planId === planId) {
                    this._plans.set(planId, entry.data);
                    return entry.data;
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * 列出所有历史计划。
     *
     * 遍历 db/task/ 下所有子目录的 brain.json 文件。
     *
     * @returns {Promise<Array>}
     */
    async listPlans() {
        try {
            const json = this.storage.json('task');
            const entries = await json.list();
            const plans = entries
                .filter(e => e.key.endsWith('/brain') && e.data)
                .map(e => e.data);
            // 合并内存中的计划（可能尚未落盘）
            for (const [id, plan] of this._plans) {
                if (!plans.find(p => p.planId === id)) {
                    plans.push(plan);
                }
            }
            return plans.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            );
        } catch {
            return this.getPlans();
        }
    }

    // ─── 内部：辅助方法 ────────────────────────────────────────────────

    /**
     * 获取默认拆解指令（SKILL 不存在时的兜底）
     * @returns {string}
     */
    _getDefaultDecompositionPrompt() {
        return `请按照以下原则拆解任务：

1. 识别任务的主要阶段（分析、执行、验证、总结）
2. 每个阶段拆解为独立的步骤
3. 步骤间设置合理的依赖关系
4. 为关键步骤设置失败回退路径
5. 每个步骤的描述需包含：做什么、怎么做、预期输出`;
    }

    /**
     * 调用 Controller 方法（模拟 HTTP 上下文）
     * @param {object} controller
     * @param {string} method
     * @param {object} req - 模拟的 RequestContext
     * @returns {Promise<object>}
     */
    async _invokeController(controller, method, req) {
        const res = {
            _data: null,
            _status: 200,
            json(data, status = 200) {
                this._data = data;
                this._status = status;
            },
            error(status, message) {
                this._data = { status: 'error', message };
                this._status = status;
            }
        };
        await controller[method].call(controller, req, res);
        return res._data;
    }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/**
 * 生成 planId
 * @returns {string}
 */
function _generatePlanId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `plan_${ts}_${rand}`;
}

/**
 * 生成 taskId
 * @returns {string}
 */
function _generateTaskId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 6);
    return `task_${ts}${rand}`;
}

export default Brain;
