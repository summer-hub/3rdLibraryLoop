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
import { createHash } from 'node:crypto';

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
    ABORTING: 'aborting',       // 终止已请求，等待各阶段轮询退出（过渡态）
    PASSED: 'passed',           // 准出通过，循环结束
    FAILED: 'failed',           // 达到最大循环次数仍未通过
    ABORTED: 'aborted',         // 被手动终止
    INTERRUPTED: 'interrupted', // F-24：进程重启导致执行中断（只有执行体能推进的状态被迫收敛）
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
    LOOP_ABORTING: 'loop:aborting',
    LOOP_ABORTED: 'loop:aborted'
});

/** 默认最大循环次数 */
const DEFAULT_MAX_LOOPS = 3;

/**
 * F-22：准出审核自身出错（status=error，如选型失败/SKILL 执行失败/报告读不到）时的
 * 最大尝试次数。审核"没跑起来"与审核"判定不通过"是两件完全不同的事：
 *   - 判定不通过 → 应进入下一轮重规划（消耗轮次）
 *   - 审核出错   → 重试；仍失败则终止并如实报告，**不应消耗轮次**，
 *                  更不能被当作"准出审核未通过"去驱动一次编造失败原因的重规划。
 * 可由环境变量 LOOP_CHECK_MAX_ATTEMPTS 覆盖（≥1）。
 */
const DEFAULT_CHECK_MAX_ATTEMPTS = 2;

/**
 * F-24：恢复时需要被投影为 interrupted 的"进行中"状态集合。
 * 这些状态的推进只可能由循环执行体完成，重启后执行体已不存在。
 */
const RESTORABLE_ACTIVE_STATES = new Set([
    LoopStatus.PLANNING,
    LoopStatus.EXECUTING,
    LoopStatus.CHECKING,
]);

/**
 * ABORTED_ERROR —— 大循环终止专用错误。
 *
 * 由各阶段（Brain 拆解 / Orchestrator 等待 / TestCheck 审核）检测到终止请求后抛出，
 * startLoop 的 catch 分支识别本错误后立即跳出循环（不再进入后续阶段），
 * 区别于普通的轮次执行异常（后者会继续下一轮）。
 */
class ABORTED_ERROR extends Error {
    /**
     * @param {string} [message]
     */
    constructor(message = '大循环已终止') {
        super(message);
        this.name = 'AbortError';
    }
}

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

        /**
         * AbortState —— 大循环终止状态（由 abortLoop 驱动，各阶段轮询检查）。
         *
         * 场景：setAbortFlag 置位后，正在运行的 Brain/TestCheck SKILL 轮询
         * 需要在下一个轮询周期感知并退出；同时记录活跃 sessionId 供 abortLoop
         * 远程中止 opencode session（否则 session 会在后台继续跑到自然完成）。
         */
        this._abortStates = new Map();

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
     * F-23：计算步骤图指纹（用于检测"重规划产出与之前完全相同的计划"）。
     *
     * 只纳入决定执行行为的字段；忽略描述里的空白差异与步骤顺序
     * （按 stepId 排序后再拼接，避免同一张图因序列化顺序不同被判为不同）。
     *
     * @param {object} taskDef
     * @returns {string}
     * @private
     */
    _fingerprintTaskDef(taskDef) {
        const steps = Array.isArray(taskDef?.steps) ? taskDef.steps : [];
        const normalized = steps
            .map((s) => [
                String(s.stepId ?? ''),
                String(s.dependId ?? 0),
                String(s.nextStepId ?? 0),
                String(s.failStepId ?? 0),
                String(s.specifiedSkill || ''),
                String(s.taskDescription || '').replace(/\s+/g, ' ').trim(),
            ].join('\u0001'))
            .sort();
        return createHash('sha256').update(normalized.join('\u0002')).digest('hex').slice(0, 16);
    }

    /**
     * F-23：检查本轮计划是否与之前某轮重复。
     *
     * @param {LoopContext} ctx
     * @param {number} loopNum - 当前轮次
     * @param {{taskDef: object}} planningResult
     * @returns {{fingerprint: string, matchedLoop: number}|null}
     * @private
     */
    _checkOscillation(ctx, loopNum, planningResult) {
        // 首轮没有"上一轮"，且允许通过环境变量关闭该检测
        if (process.env.LOOP_DETECT_OSCILLATION === '0') return null;

        const fingerprint = this._fingerprintTaskDef(planningResult?.taskDef);
        if (!Array.isArray(ctx.planFingerprints)) ctx.planFingerprints = [];

        const matched = ctx.planFingerprints.find((p) => p.fingerprint === fingerprint);
        // 无论是否重复都要登记本轮，供后续轮次比较
        ctx.planFingerprints.push({ loop: loopNum, fingerprint });

        // 首轮（loopNum === 0）即使指纹与历史相同也无历史可比；只有 loopNum > 0 且命中才算振荡
        if (loopNum > 0 && matched) {
            return { fingerprint, matchedLoop: matched.loop };
        }
        return null;
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
     * F-22：准出审核自身的最大尝试次数（≥1）。
     * @returns {number}
     * @private
     */
    _checkMaxAttempts() {
        const n = parseInt(process.env.LOOP_CHECK_MAX_ATTEMPTS ?? '', 10);
        return Number.isFinite(n) && n >= 1 ? n : DEFAULT_CHECK_MAX_ATTEMPTS;
    }

    /**
     * F-24：把持久化里读到的状态投影为「恢复后可自洽」的状态。
     *
     * - planning / executing / checking → interrupted（执行体已不存在，无法推进）
     * - aborting → aborted（无法继续"等待中止完成"）
     * - 其余终态（passed/failed/aborted/error/interrupted）原样保留
     * - 未知/空值 → idle
     *
     * @param {string|undefined} status
     * @returns {string}
     * @private
     */
    _projectRestoredStatus(status) {
        if (!status) return LoopStatus.IDLE;
        if (status === LoopStatus.ABORTING) return LoopStatus.ABORTED;
        if (RESTORABLE_ACTIVE_STATES.has(status)) return LoopStatus.INTERRUPTED;
        const known = Object.values(LoopStatus);
        return known.includes(status) ? status : LoopStatus.IDLE;
    }

    /**
     * 获取所有循环。
     * @returns {LoopContext[]}
     */
    getLoops() {
        return Array.from(this._loops.values());
    }

    // ─── 终止状态管理 ──────────────────────────────────────────────────

    /**
     * 获取（或惰性创建）任务的 AbortState。
     * @param {string} taskId
     * @returns {{ aborted: boolean, sessionId: string|null }}
     * @private
     */
    _getAbortState(taskId) {
        let st = this._abortStates.get(taskId);
        if (!st) {
            st = { aborted: false, sessionId: null };
            this._abortStates.set(taskId, st);
        }
        return st;
    }

    /**
     * 判断任务是否已被请求终止。
     * @param {string} taskId
     * @returns {boolean}
     */
    isAborted(taskId) {
        const st = this._abortStates.get(taskId);
        return Boolean(st && st.aborted);
    }

    /**
     * 登记当前阶段正在运行的 opencode sessionId（Brain 拆解 / TestCheck 审核）。
     *
     * 供 abortLoop 远程中止 session；sessionId 更新时若已请求终止则立即中止新 session。
     *
     * @param {string} taskId
     * @param {string|null} sessionId - null 表示清除
     * @private
     */
    _trackSession(taskId, sessionId) {
        const st = this._getAbortState(taskId);

        // 终止已请求：新登记的 session 直接远程中止，防止 Brain/审核
        // 轮询间隙里新建的 session 继续在后台运行
        if (st.aborted && sessionId) {
            this._abortSessions([sessionId]);
        }

        if (sessionId) {
            st.pendingSessionId = sessionId;   // 尚未被消费的 session
            delete st.abortedSessionIds?.[sessionId];
        } else {
            st.pendingSessionId = null;
        }
    }

    /**
     * 消费未中止的 pending session（轮询线程检测到终止时调用，返回应立即远程中止的 sessionId）。
     * @param {string} taskId
     * @returns {string|null}
     * @private
     */
    _consumePendingSession(taskId) {
        const st = this._abortStates.get(taskId);
        if (!st || !st.pendingSessionId) return null;
        const sid = st.pendingSessionId;
        st.pendingSessionId = null;
        return sid;
    }

    /**
     * 远程中止 opencode sessions（尽力而为，失败仅记日志）。
     * @param {string[]} sessionIds
     * @returns {Promise<void>}
     * @private
     */
    async _abortSessions(sessionIds) {
        if (!sessionIds || sessionIds.length === 0) return;

        let cli = null;
        try {
            const mod = await import('../CLI/cli.js');
            cli = new mod.CLIController();
        } catch (err) {
            this._log('warn', `_abortSessions: 加载 CLIController 失败: ${err.message}`);
            return;
        }

        for (const sid of sessionIds) {
            if (!sid) continue;
            try {
                await cli.abortSession(sid);
                this._log('info', `_abortSessions: 已远程中止 session ${sid}`);
            } catch (err) {
                // session 可能已自然结束，中止失败不阻断终止流程
                this._log('warn', `_abortSessions: 中止 session ${sid} 失败: ${err.message}`);
            }
        }
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

        // 重置终止状态（同 taskId 重新启动场景）
        const abortState = this._getAbortState(taskId);
        abortState.aborted = false;
        abortState.pendingSessionId = null;

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

                    // ── 终止检查点：Brain 拆解期间收到终止请求 → 不进入编排阶段 ──
                    // （Brain 内部的 SKILL 轮询会因 abort 提前退出并抛 ABORTED 错误，
                    //  此检查兜底处理 Brain 自然完成但终止已请求的场景）
                    if (this.isAborted(taskId)) {
                        ctx.aborted = true;
                        throw new ABORTED_ERROR('Brain 拆解完成前收到终止请求');
                    }

                    // ── F-23：计划振荡检测 ──
                    // 若本轮重规划产出的步骤图与**之前某轮完全相同**，那么再跑一遍
                    // 几乎必然得到同样的失败结果——继续消耗剩余轮次毫无意义。
                    // 原实现没有任何计划比较，相同计划会一路烧到 maxLoops。
                    const oscillation = this._checkOscillation(ctx, loopNum, planningResult);
                    if (oscillation) {
                        round.planFingerprint = oscillation.fingerprint;
                        round.oscillatedWith = oscillation.matchedLoop;
                        ctx.oscillated = true;
                        ctx.status = LoopStatus.ERROR; // 复用 F-22 的 ERROR 分支，避免被改写为"达到最大循环次数"
                        ctx.error =
                            `计划振荡：第 ${loopNum + 1} 轮重规划产出的步骤图与第 ` +
                            `${oscillation.matchedLoop + 1} 轮完全相同（指纹 ${oscillation.fingerprint}），` +
                            `不再重复执行以免空耗轮次。通常需要人工介入：` +
                            `检查验收标准是否可达、或补充失败信息以让重规划产生实质变化。`;
                        round.endTime = nowCST();
                        ctx.currentLoop++;
                        this._log('error', ctx.error);
                        this._emit(channel, SSE_EVENT.LOOP_ERROR, {
                            taskId, loop: loopNum, error: ctx.error
                        });
                        await this._persistLoopState(ctx);
                        break;
                    }

                    // ── 阶段 2：Orchestrator 编排执行 ──
                    ctx.status = LoopStatus.EXECUTING;
                    await this._persistLoopState(ctx);
                    this._emit(channel, SSE_EVENT.LOOP_EXECUTING, {
                        taskId, loop: loopNum
                    });

                    const orchestratorResult = await this._runOrchestrator(ctx, planningResult);
                    round.orchestratorResult = orchestratorResult;

                    // ── 终止检查点：编排期间收到终止请求（waitFor 检测到后提前返回）→ 不进入审核阶段 ──
                    if (this.isAborted(taskId)) {
                        ctx.aborted = true;
                        throw new ABORTED_ERROR('编排执行终止，跳过准出审核');
                    }

                    // ── 阶段 3：TestCheck 准出审核 ──
                    ctx.status = LoopStatus.CHECKING;
                    await this._persistLoopState(ctx);
                    this._emit(channel, SSE_EVENT.LOOP_CHECKING, {
                        taskId, loop: loopNum
                    });

                    // F-22：审核"出错"与审核"判定不通过"必须分开处理。
                    // 出错（status=error）时先重试审核本身；重试仍失败则标记本轮
                    // checkErrored，既不消耗轮次去重规划，也不谎报"准出未通过"。
                    const maxCheckAttempts = this._checkMaxAttempts();
                    let checkResult = null;
                    for (let attempt = 1; attempt <= maxCheckAttempts; attempt++) {
                        checkResult = await this._runTestCheck(ctx, orchestratorResult);
                        const checkErrored = checkResult.status === CheckStatus.ERROR;
                        if (!checkErrored) break;

                        this._log('warn',
                            `第 ${loopNum + 1} 轮准出审核出错（第 ${attempt}/${maxCheckAttempts} 次）: ` +
                            `${checkResult.error || '未知原因'}`);
                        // 终止请求时不重试（没必要再打一次 SKILL）
                        if (this.isAborted(taskId) || attempt === maxCheckAttempts) break;
                    }

                    round.checkResult = checkResult;
                    round.passed = checkResult.passed;
                    round.checkErrored = checkResult.status === CheckStatus.ERROR;

                    // ── 审核自身出错且重试仍失败：终止并如实报告 ──
                    if (round.checkErrored) {
                        ctx.status = LoopStatus.ERROR;
                        ctx.error = `准出审核未能完成（已尝试 ${maxCheckAttempts} 次）：` +
                            `${checkResult.error || '未知原因'}。这是审核环节故障，` +
                            `不代表任务产物未通过验收。`;
                        round.endTime = nowCST();
                        ctx.currentLoop++;
                        this._log('error', ctx.error);
                        this._emit(channel, SSE_EVENT.LOOP_ERROR, {
                            taskId, loop: loopNum, error: ctx.error
                        });
                        await this._persistLoopState(ctx);
                        break;
                    }

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
                    // 终止请求识别：ABORTED_ERROR（引擎检查点）或 SkillAbortedError
                    // （Brain/TestCheck 的 SKILL 轮询检测到 abortSignal 抛出）。
                    // 两者都必须跳出循环，不能当作普通轮次异常进入下一轮重规划。
                    if (err instanceof ABORTED_ERROR || err?.name === 'SkillAbortedError' || this.isAborted(taskId)) {
                        // 终止请求：同步 ctx.aborted 标志，直接跳出循环
                        ctx.aborted = true;
                        this._log('warn', `第 ${loopNum + 1} 轮被终止: ${err.message}`);
                        round.endTime = nowCST();
                        break;
                    }
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
            } else if (ctx.status === LoopStatus.ERROR) {
                // F-22：审核环节故障已在上面设置 ERROR，保留其准确原因，不再覆盖为
                // "准出审核仍未通过"（那会让人误以为产物被判定不合格）。
                this._log('warn', `大循环以 ERROR 结束: ${ctx.error}`);
            } else {
                const lastRound = ctx.rounds[ctx.rounds.length - 1];
                if (lastRound && lastRound.passed) {
                    ctx.status = LoopStatus.PASSED;
                } else if (lastRound && lastRound.checkErrored) {
                    // 兜底：本轮审核出错（异常路径进入），同样不谎报"未通过"
                    ctx.status = LoopStatus.ERROR;
                    ctx.error = ctx.error || '准出审核未完成（审核环节故障），无法判定是否准出';
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
     *
     * 终止语义（同步返回，异步生效）：
     *   1. 置位终止标志（isAborted 立即为 true，供各阶段轮询检查点退出）
     *   2. 终止 Orchestrator（通知运行中的 FlexRunner abortSession）
     *   3. 远程中止 Brain / TestCheck 正在运行的 opencode session（尽力而为）
     *
     * 各阶段的 SKILL 轮询（FlexRunner._pollSession / SkillExecutor.pollSession /
     * TestCheck._pollSession）在下一个轮询周期检测到标志后抛出终止并退出。
     *
     * @param {string} taskId
     * @returns {Promise<boolean>} 是否找到了运行中的循环（true = 终止请求已受理）
     */
    async abortLoop(taskId) {
        const ctx = this._loops.get(taskId);
        if (!ctx) {
            return false;
        }

        // 1. 置位终止标志（各阶段轮询检查点据此退出）
        ctx.aborted = true;
        const abortState = this._getAbortState(taskId);
        abortState.aborted = true;

        // 1b. 进入"中止中"过渡态：前端据此显示「任务中止中」，终止按钮置灰。
        //     各阶段轮询周期（秒级）检测到标志后退出，startLoop 收尾时置为终态 ABORTED。
        //     仅在仍处于活跃阶段时切换（已 PASSED/FAILED 的循环不回退状态）。
        const ACTIVE_STATES = [LoopStatus.PLANNING, LoopStatus.EXECUTING, LoopStatus.CHECKING];
        if (ACTIVE_STATES.includes(ctx.status)) {
            ctx.status = LoopStatus.ABORTING;
            this._emit(taskId, SSE_EVENT.LOOP_ABORTING, { taskId });
            // 立即落盘，防止重启后过渡态丢失（恢复流程会把 aborting 视为活跃态）
            await this._persistLoopState(ctx).catch(() => {});
        }

        // 2. 终止 Orchestrator（运行中的步骤由 FlexRunner abortSession 远程中止）
        try {
            const orch = this.orchestratorController._getOrchestrator(taskId);
            if (orch) {
                await orch.abort();
            }
        } catch {
            // Orchestrator 可能不存在或已结束
        }

        // 3. 远程中止 Brain / TestCheck 阶段正在运行的 opencode session
        //    （否则 session 会在 opencode serve 后台继续跑到自然完成）
        const pendingSession = this._consumePendingSession(taskId);
        if (pendingSession) {
            await this._abortSessions([pendingSession]);
        }

        this._log('warn', `⏹  大循环终止已请求: taskId=${taskId}`);
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
                    checkSessionId: r.checkResult ? r.checkResult.sessionId || null : null,
                    // F-22：审核环节是否故障（供恢复/展示时区分"未通过"与"没能审核"）
                    checkErrored: r.checkErrored === true ? true : null,
                    // F-23：计划指纹与振荡来源（供排障与历史查询）
                    planFingerprint: r.planFingerprint || null,
                    oscillatedWith: typeof r.oscillatedWith === 'number' ? r.oscillatedWith : null
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

        // 入口终止检查：拆解开始前已请求终止 → 不启动 Brain 的 opencode session
        if (this.isAborted(ctx.taskId)) {
            throw new ABORTED_ERROR('Brain 拆解前已请求终止');
        }

        if (ctx.currentLoop === 0) {
            // ── 首轮：初始拆解 ──
            this._log('info', `Brain 初始拆解: taskId=${ctx.taskId}`);

            const plan = await brain.planTask(ctx.taskDescription, {
                taskId: ctx.taskId,
                taskDir: ctx.taskDir,
                skillDirectory: ctx.skillDirectory,
                acceptanceCriteria: ctx.userAcceptanceCriteria,
                // 终止信号回调：Brain 内部 SKILL 轮询定期检查，置 true 时抛终止退出
                isAborted: () => this.isAborted(ctx.taskId),
                // Session 创建回调：登记到 AbortState 供 abortLoop 远程中止
                onSessionCreated: (sessionId) => this._trackSession(ctx.taskId, sessionId)
            });

            // 拆解期间收到终止请求（Session 已被远程中止，Brain 自然失败/退出）
            if (this.isAborted(ctx.taskId)) {
                throw new ABORTED_ERROR('Brain 拆解被终止');
            }

            this._trackSession(ctx.taskId, null);

            return { plan, taskDef: plan.taskDef, isReplan: false };

        } else {
            // ── 后续轮：重规划 ──
            const lastRound = ctx.rounds[ctx.rounds.length - 1];
            const lastOrchResult = lastRound ? lastRound.orchestratorResult : null;
            // F-22：只有"真实的判定不通过"才作为 replan 的失败依据。
            // 审核出错时 checkResult 里没有 failedCriteria，若照常传给 Brain，
            // replan prompt 会断言"上一轮准出审核未通过"并诱导模型编造失败原因。
            const lastCheckResult = (lastRound && lastRound.checkResult && !lastRound.checkErrored)
                ? lastRound.checkResult
                : null;
            if (lastRound && lastRound.checkErrored) {
                this._log('warn',
                    'Brain 重规划: 上一轮审核出错（无真实失败清单），不向其传递审核结论');
            }

            this._log('info', `Brain 重规划: taskId=${ctx.taskId}, loop=${ctx.currentLoop}`);

            const plan = await brain.replanTask(ctx.taskDescription, {
                taskId: ctx.taskId,
                taskDir: ctx.taskDir,
                skillDirectory: ctx.skillDirectory,
                acceptanceCriteria: ctx.userAcceptanceCriteria,
                previousCheckResult: lastCheckResult,
                previousOrchestratorResult: lastOrchResult,
                loopCount: ctx.currentLoop,
                // 终止信号回调：重规划轮同样接入终止检查
                isAborted: () => this.isAborted(ctx.taskId),
                onSessionCreated: (sessionId) => this._trackSession(ctx.taskId, sessionId)
            });

            // 拆解期间收到终止请求（Session 已被远程中止，Brain 自然失败/退出）
            if (this.isAborted(ctx.taskId)) {
                throw new ABORTED_ERROR('Brain 重规划被终止');
            }

            this._trackSession(ctx.taskId, null);

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

        // 入口终止检查：Brain 完成后终止请求已到位 → 不加载编排（否则会完整跑一轮新编排）
        if (this.isAborted(ctx.taskId)) {
            throw new ABORTED_ERROR('编排执行前已请求终止');
        }

        // ── 加载任务 ──
        const loadReq = { body: taskDef };
        const loadRes = this._createMockResponse();
        await orchController.load(loadReq, loadRes);

        if (loadRes._status >= 400) {
            throw new Error(`Orchestrator 加载失败: ${loadRes._data?.error || loadRes._data?.message}`);
        }

        // 加载后终止检查：终止请求在 load 过程中到达 → 不启动编排
        if (this.isAborted(ctx.taskId)) {
            throw new ABORTED_ERROR('编排启动前已请求终止');
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

        // 等待超时：编排仍在后台跑。绝不能把它当成"已完成"再去做准出审核
        //（那等于审核一个半成品，并让真实编排继续消耗并发额度）。
        if (result.timedOut) {
            throw new Error(
                `编排等待超时：taskId=${ctx.taskId} 在 120 分钟内未进入终态` +
                `（当前 status=${result.status}）。编排仍在后台运行，本轮按失败处理。`
            );
        }

        return result;
    }

    /**
     * 等待 Orchestrator 执行完成。
     *
     * 轮询编排状态，直到进入终态（COMPLETED / FAILED / ABORTED / DEADLOCKED）。
     *
     * ⚠️ 超时**不能静默**：原实现在 deadline 到点后直接返回当时的进度，而调用方
     * （`startLoop`）从不检查返回的 `status`，于是"编排还在跑"会被当成"已跑完"，
     * 继续走准出审核甚至重规划——审核的是一个半成品，且真实编排仍在后台消耗配额。
     * 现在超时会显式记录 `timedOut: true` 并让 `_runOrchestrator` 抛错（由大循环按
     * "本轮失败"处理），语义与 `POLL_TIMEOUT_MS` 一致。
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

        let timedOut = false;
        while (Date.now() < deadline) {
            const ctx = this._loops.get(taskId);
            if (ctx && ctx.aborted) {
                break;
            }

            const status = orch.status;
            // 终态判断（先判后睡：已完成时不再多等一个轮询周期）
            if (status === 'completed' || status === 'failed' ||
                status === 'aborted' || status === 'deadlocked') {
                break;
            }

            await this._sleep(POLL_MS);
        }

        // 循环退出后确认是否真的到了终态：没到就是超时（或中止请求）
        const finalStatus = orch.status;
        const reachedTerminal = finalStatus === 'completed' || finalStatus === 'failed'
            || finalStatus === 'aborted' || finalStatus === 'deadlocked';
        const ctxAborted = Boolean(this._loops.get(taskId)?.aborted);
        if (!reachedTerminal && !ctxAborted) {
            timedOut = true;
            this._log('error',
                `等待编排超时（${TIMEOUT_MS}ms 上限，当前 status=${finalStatus}）：` +
                `taskId=${taskId}。编排仍在后台运行，本轮按失败处理（不再对它做准出审核）。`);
        }

        const progress = orch.getProgress();
        this._log('info', `Orchestrator 执行结束: status=${progress.status}${timedOut ? '（等待超时）' : ''}`);

        return {
            status: progress.status,
            taskId: progress.taskId,
            stats: progress.stats,
            steps: progress.steps,
            error: progress.error,
            startTime: progress.startTime,
            endTime: progress.endTime,
            timedOut
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

        // 入口终止检查：编排结束后终止请求已到位 → 不启动审核 session
        if (this.isAborted(ctx.taskId)) {
            throw new ABORTED_ERROR('准出审核前已请求终止');
        }

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
            skillDirectory: ctx.skillDirectory,
            // 终止信号回调：审核 SKILL 轮询定期检查，置 true 时抛终止退出
            isAborted: () => this.isAborted(ctx.taskId),
            // Session 创建回调：登记到 AbortState 供 abortLoop 远程中止
            onSessionCreated: (sessionId) => this._trackSession(ctx.taskId, sessionId)
        });

        // 审核期间收到终止请求（session 已被远程中止）
        if (this.isAborted(ctx.taskId)) {
            this._trackSession(ctx.taskId, null);
            throw new ABORTED_ERROR('准出审核被终止');
        }

        this._trackSession(ctx.taskId, null);

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
                // F-24：恢复时把"进行中"状态一律投影为终态 INTERRUPTED。
                //
                // 原因：重启后循环执行体已不复存在（计划中的 execution body 不在内存里），
                // 而 planning/executing/checking 都是**只有执行体才能推进**的状态。
                // 原实现原样保留这些状态，于是崩溃后该任务会永远显示"运行中"：
                // 既不会有人推进它，前端也无法判断它其实已经中断。
                // aborting（中止中的过渡态）同理——无法继续"等待中止完成"，直接归一为 aborted。
                status: this._projectRestoredStatus(state.status),
                startTime: state.startTime || null,
                endTime: state.endTime || null,
                error: state.error || null,
                aborted: state.status === LoopStatus.ABORTING,
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
                    // F-22：恢复"本轮审核是故障"这一事实（不随 checkResult 一起丢失）
                    checkErrored: r.checkErrored === true,
                    // F-23：恢复计划指纹，使重启后的振荡检测仍然有效
                    planFingerprint: r.planFingerprint || null,
                    oscillatedWith: typeof r.oscillatedWith === 'number' ? r.oscillatedWith : null,
                    passed: r.passed || false,
                    error: r.error || null
                })) : []
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
            // ── F-23：从历史轮次重建计划指纹，使重启后的振荡检测仍然有效 ──
            ctx.planFingerprints = ctx.rounds
                .filter((r) => r.planFingerprint)
                .map((r) => ({ loop: r.loop, fingerprint: r.planFingerprint }));

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
                improvementSuggestions: r.checkResult?.improvementSuggestions || [],
                // F-22：区分"审核判定不通过"与"审核环节故障"
                checkErrored: r.checkErrored === true,
                // F-23：计划指纹与振荡来源轮次（供调用方/前端排障）
                planFingerprint: r.planFingerprint || null,
                oscillatedWith: typeof r.oscillatedWith === 'number' ? r.oscillatedWith : null
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

export { LoopEngine, ABORTED_ERROR };
export default LoopEngine;
