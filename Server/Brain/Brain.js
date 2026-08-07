/**
 * Brain —— 自然语言任务拆解引擎（编排层）
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
 *
 * 模块拆分：
 *   - SkillExecutor          — CLI SKILL 执行引擎（健康检查、Session、轮询、结果读取）
 *   - AnalysisStrategies     — 任务分析策略（CLI 优先 + LLM fallback）
 *   - DecompositionStrategies — 任务拆解策略（CLI 优先 + LLM fallback）
 *   - PlanPersistence        — 拆解计划持久化与历史加载
 *   - Brain.js（本文件）      — 编排层：状态管理、流程协调、校验、组装
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { LLMClient } from '../Agent/SkillSelector/llm/llmClient.js';
import { nowCST } from '../library/cstTime.js';
import { createStorage } from '../DbUse/index.js';
import { SkillExecutor } from './SkillExecutor.js';
import { AnalysisStrategies } from './AnalysisStrategies.js';
import { DecompositionStrategies } from './DecompositionStrategies.js';
import { PlanPersistence } from './PlanPersistence.js';

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

export class Brain {
    /**
     * @param {object} [deps] - 依赖注入
     * @param {LLMClient} [deps.llm]            - LLM 客户端（保留作为 fallback，CLI 不可用时降级使用）
     * @param {object}   [deps.storage]         - 存储门面（createStorage() 返回值）
     * @param {object}   [deps.sseHub]          - SseHub 实例（可选，用于推送拆解进度）
     * @param {string}   [deps.skillDirectory]  - SKILL 目录路径（用于拆解时上下文）
     * @param {object}   [deps.cli]             - CLIController 实例（可选，不传则惰性加载）
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

        // ── 组合策略模块 ──
        this._skillExecutor = new SkillExecutor({ cli: deps.cli });
        this._analysis = new AnalysisStrategies({
            llm: this.llm,
            skillExecutor: this._skillExecutor
        });
        this._decomposition = new DecompositionStrategies({
            llm: this.llm,
            skillExecutor: this._skillExecutor
        });
        this._persistence = new PlanPersistence({ storage: this.storage });
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
            path.resolve(this.storage.manager.rootDir, 'task', taskId);
        const userCriteria = options.acceptanceCriteria || '';

        // 确保任务工作目录存在（opencode promptAsync 会 realPath 检查目录）
        fs.mkdirSync(taskDir, { recursive: true });

        this._status = BrainStatus.ANALYZING;
        this._emit(planId, 'brain:plan:start', { planId, taskId, taskDescription });

        try {
            // ─── 步骤 1：分析任务意图 + 提取/生成验收标准 ───
            const analysis = await this._analysis.analyzeTask(taskDescription, userCriteria, {
                taskId, taskDir, skillDir, loopCount: 0
            });
            this._emit(planId, 'brain:analyze:done', { planId, analysis });

            // ─── 步骤 2：拆解为步骤（含步骤级验收标准） ───
            this._status = BrainStatus.PLANNING;
            const rawSteps = await this._decomposition.decomposeTask(
                taskDescription, analysis, skillDir, userCriteria,
                { taskId, taskDir, loopCount: 0 }
            );
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
                // 大循环索引（首轮=0），传递给 Orchestrator/FlexRunner 用于区分各轮产物文件
                loopCount: 0,
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
            await this._persistence.persistPlan(plan);

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

    /**
     * 重规划任务 — 基于上一轮准出审核失败的建议，重新生成任务目标。
     *
     * 在 LoopEngine 大循环中，当 TestCheck 审核未通过时调用此方法。
     * 复用同一 taskId，生成新的拆解计划，计划中融入上轮失败的具体原因。
     *
     * 与 planTask 的区别：
     *   - 复用 taskId（不生成新 taskId）
     *   - LLM prompt 中包含上轮审核失败信息和改进建议
     *   - 步骤拆解针对失败点进行调整，而非从零开始
     *
     * @param {string} taskDescription         - 原始任务描述
     * @param {object} options
     * @param {string} options.taskId          - 复用的 taskId（必填）
     * @param {string} [options.taskDir]       - 工作目录
     * @param {string} [options.skillDirectory]- 覆盖 SKILL 目录
     * @param {string} [options.acceptanceCriteria] - 用户提供的验收标准
     * @param {object} [options.previousCheckResult] - 上轮 TestCheck 结果
     * @param {object} [options.previousOrchestratorResult] - 上轮 Orchestrator 结果
     * @param {number} [options.loopCount]     - 当前循环轮次
     * @returns {Promise<BrainPlan>}
     */
    async replanTask(taskDescription, options = {}) {
        if (!taskDescription || typeof taskDescription !== 'string') {
            throw new Error('Brain.replanTask: taskDescription 不能为空');
        }
        if (!options.taskId) {
            throw new Error('Brain.replanTask: taskId 为必填参数（重规划需复用 taskId）');
        }

        const taskId = options.taskId;
        const planId = _generatePlanId();
        const skillDir = options.skillDirectory || this.skillDirectory;
        const taskDir = options.taskDir ||
            path.resolve(this.storage.manager.rootDir, 'task', taskId);
        const userCriteria = options.acceptanceCriteria || '';
        const loopCount = options.loopCount || 1;

        // 确保任务工作目录存在（opencode promptAsync 会 realPath 检查目录）
        fs.mkdirSync(taskDir, { recursive: true });

        // 提取上轮审核失败信息
        const prevCheck = options.previousCheckResult || {};
        const prevOrch = options.previousOrchestratorResult || {};

        const failedCriteria = Array.isArray(prevCheck.criteriaResults)
            ? prevCheck.criteriaResults.filter(c => !c.satisfied)
            : [];
        const satisfiedCriteria = Array.isArray(prevCheck.criteriaResults)
            ? prevCheck.criteriaResults.filter(c => c.satisfied)
            : [];
        const improvementSuggestions = Array.isArray(prevCheck.improvementSuggestions)
            ? prevCheck.improvementSuggestions
            : [];

        // ── 提取上一轮步骤执行详情（已完成步骤 + 失败步骤 + 产物路径）──
        // 从 previousOrchestratorResult.steps 中提取各步骤的执行状态和产物，
        // 传入下游 AnalysisStrategies / DecompositionStrategies，使重规划能复用已完成工作
        const prevSteps = Array.isArray(prevOrch.steps) ? prevOrch.steps : [];
        const completedSteps = prevSteps
            .filter(s => s.status === 'completed')
            .map(s => ({
                stepId: s.stepId,
                taskDescription: s.taskDescription || '',
                resultPath: s.resultPath || '',
                sessionId: s.sessionId || ''
            }));
        const failedSteps = prevSteps
            .filter(s => s.status === 'failed')
            .map(s => ({
                stepId: s.stepId,
                taskDescription: s.taskDescription || '',
                resultPath: s.resultPath || '',
                error: s.error || '',
                sessionId: s.sessionId || ''
            }));
        const pendingSteps = prevSteps
            .filter(s => s.status === 'pending' || s.status === 'ready' || s.status === 'blocked')
            .map(s => ({
                stepId: s.stepId,
                taskDescription: s.taskDescription || ''
            }));

        this._status = BrainStatus.ANALYZING;
        this._emit(taskId, 'brain:replan:start', {
            planId, taskId, loopCount,
            failedCount: failedCriteria.length,
            completedStepCount: completedSteps.length
        });

        try {
            // ─── 步骤 1：重新分析任务（融入失败上下文 + 已完成步骤信息） ───
            const analysis = await this._analysis.analyzeTaskWithContext(
                taskDescription, userCriteria, {
                    failedCriteria,
                    improvementSuggestions,
                    prevCheckSummary: prevCheck.summary || '',
                    prevOrchStatus: prevOrch.status || '',
                    loopCount,
                    completedSteps,
                    failedSteps,
                    pendingSteps,
                    satisfiedCriteria
                },
                { taskId, taskDir, skillDir }
            );
            this._emit(taskId, 'brain:replan:analyze:done', { planId, analysis });

            // ─── 步骤 2：重新拆解（基于失败信息 + 已完成步骤调整步骤） ───
            this._status = BrainStatus.PLANNING;
            const rawSteps = await this._decomposition.decomposeTaskWithContext(
                taskDescription, analysis, skillDir, userCriteria, {
                    failedCriteria,
                    improvementSuggestions,
                    prevCheckSummary: prevCheck.summary || '',
                    loopCount,
                    completedSteps,
                    failedSteps,
                    pendingSteps,
                    satisfiedCriteria
                },
                { taskId, taskDir, skillDir }
            );
            this._emit(taskId, 'brain:replan:decompose:done', {
                planId,
                stepCount: rawSteps.length,
                steps: rawSteps.map(s => ({
                    stepId: s.stepId,
                    taskDescription: s.taskDescription
                }))
            });

            // ─── 步骤 3：校验 ───
            this._status = BrainStatus.VALIDATING;
            const validation = this._validatePlan(rawSteps);
            if (!validation.valid) {
                throw new Error(`重规划校验失败: ${validation.issues.join('; ')}`);
            }

            // ─── 组装任务 JSON ───
            const taskDef = {
                taskId,
                taskDir,
                skillDirectory: skillDir,
                acceptanceCriteria: analysis.acceptanceCriteria || [],
                // 大循环索引，传递给 Orchestrator/FlexRunner 用于区分各轮产物文件
                loopCount,
                steps: rawSteps.map(s => ({
                    stepId: s.stepId,
                    taskDescription: s.taskDescription,
                    dependId: s.dependId ?? 0,
                    nextStepId: s.nextStepId ?? 0,
                    failStepId: s.failStepId ?? 0,
                    maxRetries: s.maxRetries ?? 3,
                    acceptanceCriteria: s.acceptanceCriteria || []
                })),
                replanInfo: {
                    loopCount,
                    previousCheckId: prevCheck.checkId || null,
                    failedCriteriaCount: failedCriteria.length,
                    improvementSuggestions
                }
            };

            // ─── 构建 BrainPlan ───
            const plan = {
                planId,
                taskId,
                taskDescription,
                userAcceptanceCriteria: userCriteria,
                analysis,
                taskDef,
                validation,
                createdAt: nowCST(),
                status: BrainStatus.COMPLETED,
                isReplan: true,
                loopCount
            };

            // 持久化（覆盖同一 taskId 的 brain.json）
            await this._persistence.persistPlan(plan);

            this._plans.set(planId, plan);
            this._status = BrainStatus.COMPLETED;
            this._emit(taskId, 'brain:replan:complete', { planId, taskId, loopCount });

            return plan;

        } catch (err) {
            this._status = BrainStatus.FAILED;
            this._emit(taskId, 'brain:replan:error', { planId, taskId, error: err.message });
            throw err;
        }
    }

    // ─── 持久化与历史 ──────────────────────────────────────────────────

    /**
     * 从文件系统加载历史计划。
     *
     * 支持三种加载方式：
     *   - 按 planId 遍历查找（回退路径，兼容旧调用）
     *   - 按 taskId 加载最新计划（options.taskId，读取 brain.json 快照）
     *   - 按 taskId + loopCount 加载指定轮次计划（options.taskId + options.loopCount）
     *
     * @param {string} planId
     * @param {object} [options]
     * @param {string} [options.taskId]     - 直接按 taskId 加载，避免遍历
     * @param {number} [options.loopCount]  - 指定轮次（0=首轮, 1+=重规划轮）
     * @returns {Promise<BrainPlan|null>}
     */
    async loadPlan(planId, options = {}) {
        return await this._persistence.loadPlan(planId, options, this._plans);
    }

    /**
     * 加载某个 Task 下所有轮次的拆解计划（按轮次排序）。
     *
     * @param {string} taskId
     * @returns {Promise<Array<BrainPlan>>}
     */
    async loadPlanHistory(taskId) {
        return await this._persistence.loadPlanHistory(taskId);
    }

    /**
     * 列出所有历史计划。
     *
     * @returns {Promise<Array>}
     */
    async listPlans() {
        return await this._persistence.listPlans(this._plans);
    }

    // ─── 校验 ──────────────────────────────────────────────────────────

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
        // 统一转字符串，与 getStepDependencyIds 返回的字符串依赖 ID 对齐，
        // 避免 Set.has 严格相等（===）因 "1" !== 1 而误判链式依赖不存在
        const ids = steps.map(s => String(s.stepId));
        const uniqueIds = new Set(ids);
        if (ids.length !== uniqueIds.size) {
            issues.push('存在重复的 stepId');
        }

        // 检查入口步骤（dependId 为 0 / 空数组 / 无前置）
        const entrySteps = steps.filter(s => !hasStepDependencies(s.dependId));
        if (entrySteps.length === 0) {
            issues.push('缺少入口步骤（dependId=0）');
        } else if (entrySteps.length > 1) {
            // 多入口是允许的（并行执行），但需提示
            // 不算错误
        }

        // 检查依赖引用的有效性
        for (const step of steps) {
            // dependId 支持单值或数组（fan-in 聚合）
            for (const depId of getStepDependencyIds(step.dependId)) {
                if (!uniqueIds.has(depId)) {
                    issues.push(`步骤 ${step.stepId} 的 dependId=${depId} 不存在`);
                }
            }
            if (step.nextStepId && step.nextStepId !== 0 &&
                !uniqueIds.has(String(step.nextStepId))) {
                issues.push(`步骤 ${step.stepId} 的 nextStepId=${step.nextStepId} 不存在`);
            }
            if (step.failStepId && step.failStepId !== 0 &&
                !uniqueIds.has(String(step.failStepId))) {
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

    // ─── 辅助方法 ──────────────────────────────────────────────────────

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

/**
 * 判断步骤是否无前置依赖（入口步骤）。
 * 支持 dependId 单值或数组。
 * @param {number|number[]|string|string[]|null|undefined} dependId
 * @returns {boolean}
 */
function hasStepDependencies(dependId) {
    return getStepDependencyIds(dependId).length > 0;
}

/**
 * 提取步骤的全部前置依赖 ID 数组。
 * 支持 dependId 单值或数组（fan-in 聚合）。
 * @param {number|number[]|string|string[]|null|undefined} dependId
 * @returns {string[]}
 */
function getStepDependencyIds(dependId) {
    if (Array.isArray(dependId)) {
        return dependId
            .map(v => String(v))
            .filter(v => v !== '0' && v !== '');
    }
    if (dependId == null) return [];
    const s = String(dependId);
    return s === '0' || s === '' ? [] : [s];
}

export default Brain;
