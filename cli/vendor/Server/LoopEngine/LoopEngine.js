/**
 * LoopEngine —— 大循环协调引擎（Loop Engineering）
 *
 * 职责：
 *   - 协调 Brain → Orchestrator → FlexRunner → TestCheck 的完整闭环
 *   - Orchestrator 执行完成后，调用 TestCheck 进行准出审核
 *   - 审核未通过时，调用 Brain.replanTask() 重新生成目标，进入下一轮循环
 *   - 循环终止条件：准出通过 OR 达到最大循环次数
 *   - 全流程状态持久化，支持中断恢复
 *   - 通过 SSE 实时推送大循环进度
 *
 * 架构角色（Loop Engineering 大循环）：
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │                     LoopEngine                              │
 *   │                                                              │
 *   │   ┌─────────┐    ┌──────────────┐    ┌──────────┐          │
 *   │   │  Brain  │───→│ Orchestrator │───→│ TestCheck│          │
 *   │   │ 拆解/重规│    │   编排执行    │    │ 准出审核  │          │
 *   │   └────▲────┘    └──────────────┘    └────┬─────┘          │
 *   │        │                                  │                 │
 *   │        └────────── 未通过 ────────────────┘                 │
 *   │                                                          │
 *   │   循环终止：准出通过 OR maxLoops                          │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * 设计原则：
 *   - 高内聚：大循环协调逻辑集中于此，不感知各子模块的内部实现
 *   - 低耦合：通过依赖注入 Brain / OrchestratorController / TestCheck
 *   - 单一职责：LoopEngine 只管循环驱动和状态流转，不关心拆解/编排/审核细节
 *   - 可恢复：循环状态持久化，服务重启后可恢复循环上下文
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Brain, BrainStatus } from '../Brain/index.js';
import { TestCheck, CheckStatus } from '../TestCheck/index.js';
import { nowCST } from '../library/cstTime.js';
import { createStorage } from '../DbUse/index.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** LoopEngine 循环状态 */
export const LoopStatus = Object.freeze({
    IDLE: 'idle',               // 未启动
    PLANNING: 'planning',       // Brain 拆解/重规划中
    EXECUTING: 'executing',     // Orchestrator 执行中
    CHECKING: 'checking',       // TestCheck 准出审核中
    PASSED: 'passed',           // 准出通过，循环结束
    FAILED: 'failed',           // 达到最大循环次数仍未通过
    ABORTED: 'aborted',         // 被手动终止
    ERROR: 'error'              // 循环过程出错
});

/** SSE 事件类型 */
const SSE_EVENT = Object.freeze({
    LOOP_START: 'loop:start',
    LOOP_ROUND_START: 'loop:round:start',
    LOOP_PLANNING: 'loop:planning',
    LOOP_EXECUTING: 'loop:executing',
    LOOP_CHECKING: 'loop:checking',
    LOOP_ROUND_END: 'loop:round:end',
    LOOP_COMPLETE: 'loop:complete',
    LOOP_ERROR: 'loop:error',
    LOOP_ABORTED: 'loop:aborted'
});

/** 默认最大循环次数 */
const DEFAULT_MAX_LOOPS = 3;

// ─── LoopEngine 类 ───────────────────────────────────────────────────────────

/**
 * LoopEngine —— 大循环协调引擎
 */
class LoopEngine {
    /**
     * @param {object} deps - 依赖注入
     * @param {object}   deps.brainController          - BrainController 实例（必须）
     * @param {object}   deps.orchestratorController   - OrchestratorController 实例（必须）
     * @param {TestCheck} [deps.testCheck]             - TestCheck 实例（可选，自动创建）
     * @param {object}   [deps.storage]                - 存储门面
     * @param {object}   [deps.sseHub]                 - SseHub 实例
     * @param {string}   [deps.skillDirectory]         - SKILL 目录路径
     */
    constructor(deps = {}) {
        if (!deps.brainController) {
            throw new Error('LoopEngine: brainController 为必填依赖');
        }
        if (!deps.orchestratorController) {
            throw new Error('LoopEngine: orchestratorController 为必填依赖');
        }

        this.brainController = deps.brainController;
        this.orchestratorController = deps.orchestratorController;
        this.storage = deps.storage || createStorage();
        this.sseHub = deps.sseHub || null;
        this.skillDirectory = deps.skillDirectory || null;

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        this.skillDirectory = deps.skillDirectory ||
            path.resolve(__dirname, '..', 'Skills');

        // TestCheck 实例（懒初始化）
        this._testCheck = deps.testCheck || null;

        /** @type {Map<string, LoopContext>} key = taskId */
        this._loops = new Map();
    }

    // ─── 属性访问 ──────────────────────────────────────────────────────

    /**
     * 获取 TestCheck 实例（懒初始化）。
     * @returns {TestCheck}
     * @private
     */
    _getTestCheck() {
        if (!this._testCheck) {
            this._testCheck = new TestCheck({
                storage: this.storage,
                sseHub: this.sseHub,
                skillDirectory: this.skillDirectory
            });
        }
        return this._testCheck;
    }

    /**
     * 获取循环上下文。
     * @param {string} taskId
     * @returns {LoopContext|undefined}
     */
    getLoop(taskId) {
        return this._loops.get(taskId);
    }

    /**
     * 获取所有循环。
     * @returns {LoopContext[]}
     */
    getLoops() {
        return Array.from(this._loops.values());
    }

    // ─── SSE 推送 ──────────────────────────────────────────────────────

    /**
     * 推送循环进度事件。
     * @param {string} channel
     * @param {string} eventType
     * @param {object} data
     * @private
     */
    _emit(channel, eventType, data) {
        if (this.sseHub) {
            this.sseHub.emit(channel, eventType, data);
        }
    }

    // ─── 核心方法 ──────────────────────────────────────────────────────

    /**
     * 启动大循环 — 从自然语言任务描述开始，执行完整的拆解→编排→审核闭环。
     *
     * 流程：
     *   1. Brain.planTask() 拆解任务
     *   2. Orchestrator 加载并执行
     *   3. TestCheck.runCheck() 准出审核
     *   4. 未通过 → Brain.replanTask() 重新生成目标 → 回到步骤 2
     *   5. 循环终止：准出通过 OR 达到最大循环次数
     *
     * @param {object} params
     * @param {string} params.taskDescription    - 自然语言任务描述（必填）
     * @param {string} [params.taskId]          - 指定 taskId
     * @param {string} [params.taskDir]         - 指定工作目录
     * @param {string} [params.skillDirectory]  - 覆盖 SKILL 目录
     * @param {string} [params.acceptanceCriteria] - 用户提供的验收标准
     * @param {number} [params.maxLoops]        - 最大循环次数（默认 3）
     * @returns {Promise<LoopResult>}
     */
    async startLoop(params = {}) {
        const { taskDescription } = params;

        if (!taskDescription || typeof taskDescription !== 'string') {
            throw new Error('LoopEngine.startLoop: taskDescription 不能为空');
        }

        const maxLoops = typeof params.maxLoops === 'number' && params.maxLoops > 0
            ? params.maxLoops
            : DEFAULT_MAX_LOOPS;

        // 生成 taskId（如果未指定）
        const taskId = params.taskId || _generateTaskId();
        const skillDir = params.skillDirectory || this.skillDirectory;

        // 解析 taskDir：与 JSON 状态文件（storage.json('task')）保持同一目录 db/task/{taskId}
        const taskDir = params.taskDir ||
            path.resolve(this.storage.manager.rootDir, 'task', taskId);

        const channel = taskId;
        const startTime = nowCST();

        /** @type {LoopContext} */
        const ctx = {
            taskId,
            taskDescription,
            userAcceptanceCriteria: params.acceptanceCriteria || '',
            taskDir,
            skillDirectory: skillDir,
            maxLoops,
            currentLoop: 0,
            status: LoopStatus.IDLE,
            startTime,
            endTime: null,
            rounds: [],
            error: null,
            aborted: false
        };

        this._loops.set(taskId, ctx);

        // 立即持久化 loop.json，确保大循环启动后任务即可在列表中可见
        // 防止系统重启时因 loop.json 未写入导致任务丢失
        await this._persistLoopState(ctx);

        this._emit(channel, SSE_EVENT.LOOP_START, {
            taskId, maxLoops, taskDescription: taskDescription.slice(0, 200), startTime
        });

        try {
            // ─── 大循环主体 ───
            while (ctx.currentLoop < ctx.maxLoops && !ctx.aborted) {
                const loopNum = ctx.currentLoop;

                this._log('info', `═══ 大循环第 ${loopNum + 1}/${ctx.maxLoops} 轮开始 ═══`);
                this._emit(channel, SSE_EVENT.LOOP_ROUND_START, {
                    taskId, loop: loopNum, total: ctx.maxLoops
                });

                /** @type {RoundResult} */
                const round = {
                    loop: loopNum,
                    startTime: nowCST(),
                    endTime: null,
                    planningResult: null,
                    orchestratorResult: null,
                    checkResult: null,
                    passed: false,
                    error: null
                };

                // 立即将 round 加入 ctx.rounds，使前端轮询能实时看到各阶段进度
                ctx.rounds.push(round);

                try {
                    // ── 阶段 1：Brain 拆解 / 重规划 ──
                    ctx.status = LoopStatus.PLANNING;
                    await this._persistLoopState(ctx);
                    this._emit(channel, SSE_EVENT.LOOP_PLANNING, {
                        taskId, loop: loopNum, isReplan: loopNum > 0
                    });

                    const planningResult = await this._runBrain(ctx, params);
                    round.planningResult = planningResult;

                    // ── 阶段 2：Orchestrator 编排执行 ──
                    ctx.status = LoopStatus.EXECUTING;
                    await this._persistLoopState(ctx);
                    this._emit(channel, SSE_EVENT.LOOP_EXECUTING, {
                        taskId, loop: loopNum
                    });

                    const orchestratorResult = await this._runOrchestrator(ctx, planningResult);
                    round.orchestratorResult = orchestratorResult;

                    // ── 阶段 3：TestCheck 准出审核 ──
                    ctx.status = LoopStatus.CHECKING;
                    await this._persistLoopState(ctx);
                    this._emit(channel, SSE_EVENT.LOOP_CHECKING, {
                        taskId, loop: loopNum
                    });

                    const checkResult = await this._runTestCheck(ctx, orchestratorResult);
                    round.checkResult = checkResult;
                    round.passed = checkResult.passed;

                    // ── 判断是否准出通过 ──
                    if (checkResult.passed) {
                        this._log('info', `✅ 第 ${loopNum + 1} 轮准出审核通过，大循环结束`);
                        ctx.status = LoopStatus.PASSED;
                        round.endTime = nowCST();
                        break;
                    }

                    // ── 准出未通过，准备下一轮 ──
                    this._log('warn', `⚠  第 ${loopNum + 1} 轮准出审核未通过，将进入下一轮`);

                } catch (err) {
                    round.error = err.message;
                    this._log('error', `第 ${loopNum + 1} 轮执行异常: ${err.message}`);
                    // 单轮异常不中断整个大循环，继续下一轮（除非是 abort）
                    if (ctx.aborted) {
                        round.endTime = nowCST();
                        break;
                    }
                }

                round.endTime = nowCST();
                ctx.currentLoop++;

                this._emit(channel, SSE_EVENT.LOOP_ROUND_END, {
                    taskId, loop: loopNum, passed: round.passed
                });

                // 持久化循环状态
                await this._persistLoopState(ctx);
            }

            // ─── 循环结束，判定最终状态 ───
            if (ctx.aborted) {
                ctx.status = LoopStatus.ABORTED;
                this._emit(channel, SSE_EVENT.LOOP_ABORTED, { taskId });
            } else {
                const lastRound = ctx.rounds[ctx.rounds.length - 1];
                if (lastRound && lastRound.passed) {
                    ctx.status = LoopStatus.PASSED;
                } else {
                    ctx.status = LoopStatus.FAILED;
                    ctx.error = `达到最大循环次数 ${ctx.maxLoops}，准出审核仍未通过`;
                }
            }

        } catch (err) {
            ctx.status = LoopStatus.ERROR;
            ctx.error = err.message;
            this._emit(channel, SSE_EVENT.LOOP_ERROR, { taskId, error: err.message });
            this._log('error', `大循环异常: ${err.message}`);
        }

        ctx.endTime = nowCST();

        // 持久化最终状态
        await this._persistLoopState(ctx);

        this._emit(channel, SSE_EVENT.LOOP_COMPLETE, {
            taskId,
            status: ctx.status,
            totalRounds: ctx.rounds.length,
            passed: ctx.status === LoopStatus.PASSED
        });

        this._log('info', `═══ 大循环结束: status=${ctx.status}, rounds=${ctx.rounds.length} ═══`);

        return this._buildLoopResult(ctx);
    }

    /**
     * 终止大循环。
     * @param {string} taskId
     * @returns {Promise<boolean>}
     */
    async abortLoop(taskId) {
        const ctx = this._loops.get(taskId);
        if (!ctx) {
            return false;
        }

        ctx.aborted = true;

        // 终止 Orchestrator
        try {
            const orch = this.orchestratorController._getOrchestrator(taskId);
            if (orch) {
                await orch.abort();
            }
        } catch {
            // Orchestrator 可能不存在或已结束
        }

        this._log('warn', `⏹  大循环已终止: taskId=${taskId}`);
        return true;
    }

    /**
     * 获取循环进度。
     * @param {string} taskId
     * @returns {object|null}
     */
    getProgress(taskId) {
        const ctx = this._loops.get(taskId);
        if (!ctx) return null;

        return {
            taskId: ctx.taskId,
            status: ctx.status,
            currentLoop: ctx.currentLoop,
            maxLoops: ctx.maxLoops,
            startTime: ctx.startTime,
            endTime: ctx.endTime,
            error: ctx.error,
            rounds: ctx.rounds.map(r => {
                const plan = r.planningResult?.plan;
                const analysis = plan?.analysis || {};
                const taskDef = r.planningResult?.taskDef || plan?.taskDef || {};
                return {
                    loop: r.loop,
                    passed: r.passed,
                    startTime: r.startTime,
                    endTime: r.endTime,
                    error: r.error,
                    // ── Brain 拆解摘要 ──
                    planningPlanId: plan?.planId || null,
                    planningIsReplan: r.planningResult?.isReplan ?? false,
                    planningStepCount: taskDef.steps?.length ?? 0,
                    planningIntent: analysis.intent || null,
                    planningDomain: analysis.domain || null,
                    planningComplexity: analysis.complexity || null,
                    planningFailureAnalysis: analysis.failureAnalysis || null,
                    planningAdjustmentStrategy: analysis.adjustmentStrategy || null,
                    // ── Orchestrator 编排摘要 ──
                    orchestratorStatus: r.orchestratorResult?.status || null,
                    // ── TestCheck 审核摘要 ──
                    checkSummary: r.checkResult ? r.checkResult.summary : null,
                    checkPassed: r.checkResult ? r.checkResult.passed : null,
                    checkStatus: r.checkResult ? r.checkResult.status : null,
                    checkId: r.checkResult ? r.checkResult.checkId : null,
                    checkSessionId: r.checkResult ? r.checkResult.sessionId || null : null
                };
            })
        };
    }

    // ─── 内部：各阶段执行 ──────────────────────────────────────────────

    /**
     * 执行 Brain 阶段 — 首轮拆解或后续轮重规划。
     *
     * 首轮（loop=0）：调用 Brain.planTask() 进行初始拆解
     * 后续轮（loop>0）：调用 Brain.replanTask() 基于上轮审核结果重新生成目标
     *
     * @param {LoopContext} ctx
     * @param {object} originalParams - 原始启动参数
     * @returns {Promise<{plan: object, taskDef: object, isReplan: boolean}>}
     * @private
     */
    async _runBrain(ctx, originalParams) {
        const brain = this.brainController._getBrain();

        if (ctx.currentLoop === 0) {
            // ── 首轮：初始拆解 ──
            this._log('info', `Brain 初始拆解: taskId=${ctx.taskId}`);

            const plan = await brain.planTask(ctx.taskDescription, {
                taskId: ctx.taskId,
                taskDir: ctx.taskDir,
                skillDirectory: ctx.skillDirectory,
                acceptanceCriteria: ctx.userAcceptanceCriteria
            });

            return { plan, taskDef: plan.taskDef, isReplan: false };

        } else {
            // ── 后续轮：重规划 ──
            const lastRound = ctx.rounds[ctx.rounds.length - 1];
            const lastCheckResult = lastRound ? lastRound.checkResult : null;
            const lastOrchResult = lastRound ? lastRound.orchestratorResult : null;

            this._log('info', `Brain 重规划: taskId=${ctx.taskId}, loop=${ctx.currentLoop}`);

            const plan = await brain.replanTask(ctx.taskDescription, {
                taskId: ctx.taskId,
                taskDir: ctx.taskDir,
                skillDirectory: ctx.skillDirectory,
                acceptanceCriteria: ctx.userAcceptanceCriteria,
                previousCheckResult: lastCheckResult,
                previousOrchestratorResult: lastOrchResult,
                loopCount: ctx.currentLoop
            });

            return { plan, taskDef: plan.taskDef, isReplan: true };
        }
    }

    /**
     * 执行 Orchestrator 阶段 — 加载任务并等待执行完成。
     *
     * 通过 BrainController 的 _invokeController 模式调用 OrchestratorController：
     *   1. load — 加载任务定义
     *   2. start — 启动编排
     *   3. 等待编排完成（轮询状态）
     *
     * @param {LoopContext} ctx
     * @param {object} planningResult - Brain 阶段返回的 { plan, taskDef }
     * @returns {Promise<object>} Orchestrator 执行结果摘要
     * @private
     */
    async _runOrchestrator(ctx, planningResult) {
        const { taskDef } = planningResult;
        const orchController = this.orchestratorController;

        // ── 加载任务 ──
        const loadReq = { body: taskDef };
        const loadRes = this._createMockResponse();
        await orchController.load(loadReq, loadRes);

        if (loadRes._status >= 400) {
            throw new Error(`Orchestrator 加载失败: ${loadRes._data?.error || loadRes._data?.message}`);
        }

        // ── 启动编排 ──
        const startReq = { body: { taskId: ctx.taskId } };
        const startRes = this._createMockResponse();
        await orchController.start(startReq, startRes);

        if (startRes._status >= 400) {
            throw new Error(`Orchestrator 启动失败: ${startRes._data?.error || startRes._data?.message}`);
        }

        // ── 等待编排完成 ──
        const orch = orchController._getOrchestrator(ctx.taskId);
        if (!orch) {
            throw new Error(`Orchestrator 实例未找到: taskId=${ctx.taskId}`);
        }

        // Orchestrator.start() 是异步执行的（Controller 中 fire-and-forget）
        // 需要轮询等待编排状态变为终态
        const result = await this._waitForOrchestrator(ctx.taskId, orch);

        return result;
    }

    /**
     * 等待 Orchestrator 执行完成。
     *
     * 轮询编排状态，直到进入终态（COMPLETED / FAILED / ABORTED / DEADLOCKED）。
     *
     * @param {string} taskId
     * @param {object} orch - Orchestrator 实例
     * @returns {Promise<object>} 编排结果摘要
     * @private
     */
    async _waitForOrchestrator(taskId, orch) {
        const POLL_MS = 5000;
        const TIMEOUT_MS = 120 * 60 * 1000; // 120 分钟超时
        const deadline = Date.now() + TIMEOUT_MS;

        while (Date.now() < deadline) {
            const ctx = this._loops.get(taskId);
            if (ctx && ctx.aborted) {
                break;
            }

            await this._sleep(POLL_MS);

            const status = orch.status;
            // 终态判断
            if (status === 'completed' || status === 'failed' ||
                status === 'aborted' || status === 'deadlocked') {
                break;
            }
        }

        const progress = orch.getProgress();
        this._log('info', `Orchestrator 执行结束: status=${progress.status}`);

        return {
            status: progress.status,
            taskId: progress.taskId,
            stats: progress.stats,
            steps: progress.steps,
            error: progress.error,
            startTime: progress.startTime,
            endTime: progress.endTime
        };
    }

    /**
     * 执行 TestCheck 阶段 — 准出审核。
     *
     * @param {LoopContext} ctx
     * @param {object} orchestratorResult - Orchestrator 执行结果
     * @returns {Promise<object>} CheckResult
     * @private
     */
    async _runTestCheck(ctx, orchestratorResult) {
        const testCheck = this._getTestCheck();

        // 从 Brain plan 中提取验收标准
        const lastPlan = ctx.rounds.length > 0
            ? ctx.rounds[ctx.rounds.length - 1].planningResult?.plan
            : null;

        // 优先使用当前轮的 plan，否则从 Brain 加载
        let acceptanceCriteria = [];
        if (lastPlan && lastPlan.analysis && lastPlan.analysis.acceptanceCriteria) {
            acceptanceCriteria = lastPlan.analysis.acceptanceCriteria;
        } else {
            // 从持久化加载 brain.json
            try {
                const brain = this.brainController._getBrain();
                const plan = await brain.loadPlan('', { taskId: ctx.taskId });
                if (plan && plan.analysis && plan.analysis.acceptanceCriteria) {
                    acceptanceCriteria = plan.analysis.acceptanceCriteria;
                }
            } catch {
                // 加载失败使用空标准
            }
        }

        const result = await testCheck.runCheck({
            taskId: ctx.taskId,
            taskDir: ctx.taskDir,
            taskDescription: ctx.taskDescription,
            acceptanceCriteria,
            orchestratorResult,
            loopCount: ctx.currentLoop,
            skillDirectory: ctx.skillDirectory
        });

        return result;
    }

    // ─── 内部：持久化 ──────────────────────────────────────────────────

    /**
     * 持久化大循环状态到 db/task/{taskId}/loop.json。
     *
     * 文件布局：
     *   db/task/{taskId}/
     *     ├── brain.json                    ← Brain 拆解计划（最新快照）
     *     ├── brain_loop0.json               ← 各轮 Brain 计划（独立保留）
     *     ├── brain_loop1.json
     *     ├── orchestration.json             ← Orchestrator 编排状态（最新快照）
     *     ├── orchestration_loop0.json       ← 各轮编排状态（独立保留）
     *     ├── orchestration_loop1.json
     *     ├── stepid_1_loop0.json            ← 各轮步骤执行记录（独立保留）
     *     ├── stepid_1_loop1.json
     *     ├── stepId1_loop0_result_0.md      ← 各轮步骤结果文件（独立保留）
     *     ├── stepId1_loop1_result_0.md
     *     ├── loop.json                      ← LoopEngine 大循环状态（本方法写入）
     *     ├── testcheck_loop0.json           ← 各轮审核结果
     *     └── ...
     *
     * @param {LoopContext} ctx
     * @private
     */
    async _persistLoopState(ctx) {
        try {
            const json = this.storage.json('task');
            const state = {
                taskId: ctx.taskId,
                taskDescription: ctx.taskDescription,
                userAcceptanceCriteria: ctx.userAcceptanceCriteria,
                taskDir: ctx.taskDir,
                skillDirectory: ctx.skillDirectory,
                maxLoops: ctx.maxLoops,
                currentLoop: ctx.currentLoop,
                status: ctx.status,
                startTime: ctx.startTime,
                endTime: ctx.endTime,
                error: ctx.error,
                aborted: ctx.aborted,
                rounds: ctx.rounds.map(r => {
                    const plan = r.planningResult?.plan;
                    const analysis = plan?.analysis || {};
                    const taskDef = r.planningResult?.taskDef || plan?.taskDef || {};
                    return {
                        loop: r.loop,
                        startTime: r.startTime,
                        endTime: r.endTime,
                        passed: r.passed,
                        error: r.error,
                        // ── Brain 拆解摘要 ──
                        planningPlanId: plan?.planId || null,
                        planningIsReplan: r.planningResult?.isReplan ?? false,
                        planningLoopCount: plan?.loopCount ?? r.loop,
                        planningStepCount: taskDef.steps?.length ?? 0,
                        planningIntent: analysis.intent || null,
                        planningDomain: analysis.domain || null,
                        planningComplexity: analysis.complexity || null,
                        planningFailureAnalysis: analysis.failureAnalysis || null,
                        planningAdjustmentStrategy: analysis.adjustmentStrategy || null,
                        planningReplanInfo: taskDef.replanInfo || null,
                        // ── Orchestrator 编排摘要 ──
                        orchestratorStatus: r.orchestratorResult?.status || null,
                        // ── TestCheck 审核摘要 ──
                        checkPassed: r.checkResult?.passed ?? null,
                        checkStatus: r.checkResult?.status || null,
                        checkSummary: r.checkResult?.summary || null,
                        checkId: r.checkResult?.checkId || null,
                        checkSessionId: r.checkResult?.sessionId || null
                    };
                }),
                persistedAt: nowCST()
            };
            await json.write(`${ctx.taskId}/loop`, state);
        } catch (err) {
            this._log('warn', `持久化大循环状态失败: ${err.message}`);
        }
    }

    /**
     * 从持久化文件恢复大循环状态。
     *
     * @param {string} taskId
     * @returns {Promise<LoopContext|null>}
     */
    async restoreLoop(taskId) {
        try {
            const json = this.storage.json('task');
            const state = await json.read(`${taskId}/loop`);
            if (!state) return null;

            /** @type {LoopContext} */
            const ctx = {
                taskId: state.taskId,
                taskDescription: state.taskDescription || '',
                userAcceptanceCriteria: state.userAcceptanceCriteria || '',
                taskDir: state.taskDir || '',
                skillDirectory: state.skillDirectory || '',
                maxLoops: state.maxLoops || DEFAULT_MAX_LOOPS,
                currentLoop: state.currentLoop || 0,
                status: state.status || LoopStatus.IDLE,
                startTime: state.startTime || null,
                endTime: state.endTime || null,
                rounds: Array.isArray(state.rounds) ? state.rounds.map(r => ({
                    loop: r.loop,
                    startTime: r.startTime,
                    endTime: r.endTime,
                    // 从持久化的摘要字段恢复 planningResult（运行时完整对象不可恢复，
                    // 但恢复关键元数据供 getProgress 展示）
                    planningResult: r.planningPlanId ? {
                        plan: {
                            planId: r.planningPlanId,
                            isReplan: r.planningIsReplan ?? false,
                            loopCount: r.planningLoopCount ?? r.loop,
                            analysis: {
                                intent: r.planningIntent || '',
                                domain: r.planningDomain || '',
                                complexity: r.planningComplexity || '',
                                failureAnalysis: r.planningFailureAnalysis || '',
                                adjustmentStrategy: r.planningAdjustmentStrategy || ''
                            },
                            taskDef: { replanInfo: r.planningReplanInfo || null }
                        },
                        taskDef: null,
                        isReplan: r.planningIsReplan ?? false
                    } : null,
                    orchestratorResult: r.orchestratorStatus ? { status: r.orchestratorStatus } : null,
                    checkResult: r.checkId ? {
                        checkId: r.checkId,
                        passed: r.checkPassed ?? false,
                        status: r.checkStatus || CheckStatus.IDLE,
                        summary: r.checkSummary || '',
                        sessionId: r.checkSessionId || ''
                    } : null,
                    passed: r.passed || false,
                    error: r.error || null
                })) : [],
                error: state.error || null,
                aborted: false
            };

            this._loops.set(taskId, ctx);

            // ── 补充加载：旧版 loop.json 缺少 checkSessionId，
            //    从 testcheck_loopN.json 中补全各轮 checkResult.sessionId ──
            for (const round of ctx.rounds) {
                if (round.checkResult && !round.checkResult.sessionId) {
                    try {
                        const checkData = await json.read(`${taskId}/testcheck_loop${round.loop}`);
                        if (checkData && checkData.sessionId) {
                            round.checkResult.sessionId = checkData.sessionId;
                        }
                    } catch {
                        // testcheck_loopN.json 可能不存在（审核未执行），跳过
                    }
                }
            }

            this._log('info', `大循环状态已恢复: taskId=${taskId}, status=${ctx.status}`);
            return ctx;
        } catch {
            return null;
        }
    }

    // ─── 内部工具 ──────────────────────────────────────────────────────

    /**
     * 构建最终的 LoopResult 返回值。
     * @param {LoopContext} ctx
     * @returns {LoopResult}
     * @private
     */
    _buildLoopResult(ctx) {
        const lastPassedRound = ctx.rounds.find(r => r.passed);

        return {
            taskId: ctx.taskId,
            status: ctx.status,
            passed: ctx.status === LoopStatus.PASSED,
            totalRounds: ctx.rounds.length,
            currentLoop: ctx.currentLoop,
            maxLoops: ctx.maxLoops,
            startTime: ctx.startTime,
            endTime: ctx.endTime,
            error: ctx.error,
            rounds: ctx.rounds.map(r => ({
                loop: r.loop,
                passed: r.passed,
                startTime: r.startTime,
                endTime: r.endTime,
                error: r.error,
                planId: r.planningResult?.plan?.planId || null,
                orchestratorStatus: r.orchestratorResult?.status || null,
                checkPassed: r.checkResult?.passed ?? null,
                checkSummary: r.checkResult?.summary || null,
                improvementSuggestions: r.checkResult?.improvementSuggestions || []
            })),
            finalCheckResult: lastPassedRound
                ? lastPassedRound.checkResult
                : (ctx.rounds[ctx.rounds.length - 1]?.checkResult || null)
        };
    }

    /**
     * 创建模拟的 ResponseContext（用于调用 Controller 方法）。
     * @returns {object}
     * @private
     */
    _createMockResponse() {
        return {
            _data: null,
            _status: 200,
            json(data, status = 200) {
                this._data = data;
                this._status = status;
            },
            error(status, message) {
                this._data = { error: message };
                this._status = status;
            }
        };
    }

    /**
     * Promise 版 sleep。
     * @param {number} ms
     * @returns {Promise<void>}
     * @private
     */
    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 统一日志输出。
     * @param {'info'|'warn'|'error'} level
     * @param {string} message
     * @private
     */
    _log(level, message) {
        const prefix = '[LoopEngine]';
        const ts = nowCST();
        switch (level) {
            case 'error':
                console.error(`${ts} ${prefix} ❌ ${message}`);
                break;
            case 'warn':
                console.warn(`${ts} ${prefix} ⚠  ${message}`);
                break;
            default:
                console.info(`${ts} ${prefix} ℹ  ${message}`);
        }
    }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/**
 * 生成 taskId。
 * @returns {string}
 */
function _generateTaskId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 6);
    return `task_${ts}${rand}`;
}

export { LoopEngine };
export default LoopEngine;
