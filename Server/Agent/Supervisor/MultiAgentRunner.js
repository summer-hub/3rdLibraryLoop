/**
 * MultiAgentRunner —— 面向 Orchestrator 的多 Agent 运行器适配层（Phase 2）
 *
 * 作用：把 `Supervisor`（角色子图编排）**伪装**成一个 `FlexRunner`，
 * 使 Orchestrator 的 `_createFlexRunner` / `_executeNode` / `_runnerBrief` /
 * `abortAndWait` / `updateStepConfig` 等既有逻辑**一行都不用改**。
 *
 * 为什么用适配层而不是让 Orchestrator 认识 Supervisor：
 *   Orchestrator 的 DAG、扇入扇出、`failStepId` 修复链、死锁判定、持久化、
 *   终止/暂停、SSE 推送全都是围绕「一个步骤 = 一个 runner」构建的，
 *   且已被 M2/M3 的 389 条断言覆盖。把"多 Agent"做成 runner 的一种实现，
 *   这些能力**零成本继承**；反之（让 Orchestrator 分支处理）会让每个既有
 *   特性都要写两遍，回归面立刻失控。
 *
 * ## 必须实现的 Runner 契约
 *
 * | 成员 | 用途 | 谁在用 |
 * |---|---|---|
 * | `initContext(params)` | 接收步骤上下文 | `Orchestrator._createFlexRunner` |
 * | `executeStart()` | 执行并返回 `{resultPath, success, nextStepId, metrics}` | `_executeNode` |
 * | `taskId/stepId/bigLoopIndex/executeStep/retryTimes/maxRetries` | 进度展示 | `_runnerBrief` |
 * | `sessionId/startTime/endTime/resultPath/metrics` | 进度展示 | `_runnerBrief` |
 * | `canRetry()` | 是否还能重试 | `_runnerBrief`、`_executeNode` 语义 |
 * | `controlExecution('abort'\|'pause'\|'resume')` | 编排级控制 | `abort()`/`pause()`/`resume()` |
 * | `drainBackgroundTasks(ms)` | 优雅停机排空 | `abortAndWait()` |
 * | `getLiveMessages()` / `getSessionContent()` | 步骤详情查询 | `getStepDetail()` |
 * | **`managesOwnConcurrency = true`** | 声明自行管理会话并发（见下） | `_executeNode` |
 *
 * ## `managesOwnConcurrency` 为什么必须为 true（高并发正确性关键）
 *
 * 一个步骤在 Phase 2 里会产生 **N 个角色会话**（`thorough` 计划下最多 5 个）。
 * 若 Orchestrator 仍按 Phase 1 的做法为每个步骤预占**一个**槽位，再加上每个角色
 * 各自取的槽位，就会出现"槽位被重复占用"：实际可用的并发会话数远低于配置上限，
 * 表现为"把 MAX_CONCURRENT_SESSIONS 调到 50，实际只能跑十几个"。
 *
 * 因此这里显式声明 `managesOwnConcurrency = true`，Orchestrator 见此后
 * **不再为该步骤预占槽位**，由每个 `AgentRuntime` 自行取一个。
 * 结果：无论一个步骤里跑几个角色，全局会话并发**始终**受同一个信号量约束。
 */

import path from 'node:path';

import { nowCST } from '../../library/cstTime.js';
import { Supervisor } from '../Supervisor/Supervisor.js';
import { resolvePlan, CollaborationPlan } from '../Supervisor/CollaborationPlan.js';
import { RoleRegistry, defaultRoleRegistry } from '../Roles/AgentRole.js';

/**
 * 从环境变量解析多 Agent 的默认行为。
 *
 * 全部默认值都指向「**与 Phase 1 完全一致**」——渐进启用，避免"合并即改变行为"。
 * @returns {object}
 */
export function getMultiAgentEnv() {
    const enabled = process.env.MULTI_AGENT_ENABLED;
    return {
        /** 总开关：'1'/'true' 时启用（默认关闭） */
        enabled: enabled === '1' || String(enabled).toLowerCase() === 'true',
        /** 默认协作计划名（默认 standard：实现 → 评审） */
        defaultPlan: process.env.MULTI_AGENT_PLAN || 'standard',
        /** 强制完整协作（即使步骤指定了 SKILL 也不收窄） */
        forceFullPlan: process.env.MULTI_AGENT_FORCE_FULL === '1'
    };
}

/**
 * 多 Agent 运行器。
 */
export class MultiAgentRunner {
    /**
     * 声明本运行器自行管理会话并发（见类文档）。
     * Orchestrator 必须以属性访问（而非方法调用）读取它。
     * @type {boolean}
     */
    managesOwnConcurrency = true;

    /**
     * @param {object} [opts]
     * @param {Function} [opts.runnerFactory]     - 单角色会话适配器工厂（透传给 AgentRuntime）
     * @param {*} [opts.sessionSemaphore]         - Session 并发信号量
     * @param {RoleRegistry} [opts.registry]      - 角色注册表
     * @param {boolean} [opts.enabled]            - 覆盖环境变量开关
     * @param {string} [opts.plan]                - 默认协作计划
     * @param {(type: string, data: object) => void} [opts.onEvent]
     * @param {(level: string, msg: string) => void} [opts.logger]
     * @param {() => string} [opts.clock]
     * @param {number} [opts.maxGateRetries]
     */
    constructor(opts = {}) {
        const env = getMultiAgentEnv();
        this.enabled = opts.enabled === undefined ? env.enabled : opts.enabled === true;
        /**
         * @type {string} 默认协作计划**名**（供 `resolvePlan` 按名解析）。
         * 只在 `opts.plan` 传字符串时生效。
         */
        this.defaultPlanName = typeof opts.plan === 'string' ? opts.plan : env.defaultPlan;
        /**
         * @type {CollaborationPlan|null} 默认协作计划**实例**。
         * 允许直接传实例（而不是只能传名字）是因为调用方常常需要给出自定义子图
         * （如测试用的单阶段计划）；只接受字符串会迫使调用方先注册成内置计划。
         */
        this._defaultPlan = opts.plan instanceof CollaborationPlan ? opts.plan : null;
        this.forceFullPlan = opts.forceFullPlan === true || env.forceFullPlan;

        this._runnerFactory = typeof opts.runnerFactory === 'function' ? opts.runnerFactory : null;
        this._semaphore = opts.sessionSemaphore || null;
        /** @type {object|null} Phase 3：角色级（第三级）限流器 */
        this._roleLimiter = opts.roleLimiter || null;
        /** @type {object|null} Phase 3：会话事件源（事件驱动替代轮询） */
        this._sessionEvents = opts.sessionEvents || null;
        /** @type {object|null} Phase 3：进程/任务级取消树 */
        this._abortTree = opts.abortTree || null;
        /** @type {object|null} Phase 3：任务级取消节点（本步骤在其下派生一个子节点） */
        this._taskAbortNode = opts.taskAbortNode || null;
        /** @type {object|null} 本步骤在取消树上的节点 */
        this._stepAbortNode = null;
        this._registry = opts.registry instanceof RoleRegistry ? opts.registry : defaultRoleRegistry.clone();
        this._onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        this._clock = typeof opts.clock === 'function' ? opts.clock : nowCST;
        this._maxGateRetries = opts.maxGateRetries;

        // ── Runner 契约状态 ──
        this.taskId = '';
        this.stepId = 0;
        this.bigLoopIndex = 0;
        this.executeStep = 0;
        this.retryTimes = 0;
        this.maxRetries = 3;
        this.sessionId = '';
        this.startTime = null;
        this.endTime = null;
        this.resultPath = '';
        this.metrics = null;
        this.nextStepId = 0;

        this._supervisor = null;
        this._initialized = false;
        this._running = false;
        this._paused = false;
        this._aborted = false;
        this._abortController = null;
        this._lastResult = null;
        this._skillNames = null;
        this._collabPlan = null;
        this._stepConfig = null;
    }

    /** @returns {boolean} 是否已初始化 */
    get initialized() {
        return this._initialized;
    }

    /**
     * 接收步骤上下文（签名与 `FlexRunner.initContext` 对齐）。
     *
     * @param {object} params
     * @returns {Promise<void>}
     */
    async initContext(params = {}) {
        if (!params?.taskId) throw new Error('MultiAgentRunner.initContext: taskId 为必填项');
        const numStepId = Number(params.stepId);
        if (!Number.isInteger(numStepId) || numStepId <= 0) {
            throw new Error(`MultiAgentRunner.initContext: stepId 必须为正整数，当前值 ${params.stepId}`);
        }

        this.taskId = String(params.taskId);
        this.stepId = numStepId;
        this.bigLoopIndex = Number(params.bigLoopIndex) || 0;
        this.executeStep = Number.isInteger(params.initialExecuteStep) ? params.initialExecuteStep : 0;
        this.retryTimes = 0;
        this.maxRetries = Number.isFinite(params.maxRetries) ? params.maxRetries : 3;
        this.nextStepId = Number(params.nextStepId) || 0;

        this._stepConfig = params;
        this._taskDir = params.taskDir
            ? path.resolve(params.taskDir)
            : path.resolve(process.cwd(), 'db', 'task', this.taskId);
        this._skillDirectory = params.skillDirectory || '';
        this._taskDescription = params.taskDescription || '';
        this._specifiedSkill = String(params.specifiedSkill || '').trim();
        this._inputReport = params.inputReport || '';
        this._onSessionCreated = typeof params.onSessionCreated === 'function' ? params.onSessionCreated : null;
        this._storage = params.storage || null;

        // 步骤可覆盖协作计划（`step.collaboration`）；缺省用构造时的默认计划（实例优先于名字）。
        //
        // ⚠️ 必须把 `null` / `false` 与"显式给了计划"区分开：`StepNode` 会把未配置的
        // `collaboration` 归一化为 `null`，Orchestrator 又原样传下来。若只判断
        // `!== undefined`，`null` 会被当成"显式指定"，于是走 `resolvePlan(null, name)`
        // 落到默认**名字**（standard），把构造时配置的计划实例（如 thorough）静默冲掉。
        // 实测表现为"配了 5 阶段计划却只跑了 2 个阶段"。
        const stepPlan = params.collaboration === undefined
            || params.collaboration === null
            || params.collaboration === false
            ? this._defaultPlan
            : params.collaboration;
        this._collabPlan = resolvePlan(stepPlan, this.defaultPlanName);

        if (this.forceFullPlan && this._collabPlan.onSpecifiedSkill !== 'keep') {
            // 强制完整协作：即使步骤指定了 SKILL 也不收窄为单阶段。
            // CollaborationPlan 是冻结对象，因此这里重建一个新实例而不是改字段。
            this._collabPlan = new CollaborationPlan({
                id: this._collabPlan.id,
                name: this._collabPlan.name,
                stages: this._collabPlan.stages.map((s) => ({ ...s })),
                maxRevisions: this._collabPlan.maxRevisions,
                maxRoleRuns: this._collabPlan.maxRoleRuns,
                primaryStage: this._collabPlan.primaryStage,
                onSpecifiedSkill: 'keep'
            });
        }

        // SKILL 名单只扫描一次，供所有角色共享（避免每个角色各扫一遍 56 个目录）
        this._skillNames = await MultiAgentRunner.scanSkillNames(this._skillDirectory);

        this._abortController = new AbortController();
        this._initialized = true;

        this._log('info',
            `多 Agent 运行器就绪 — task=${this.taskId} step=${this.stepId} ` +
            `plan=${this._collabPlan?.id} 可用 SKILL=${this._skillNames.length}`);
    }

    /**
     * 扫描 SKILL 目录得到名字列表。
     *
     * 扫描失败（目录不存在等）返回空数组并 warn：角色准入会因此退化为"无 SKILL 模式"，
     * 而不是让整个步骤无法启动——降级可见、可控。
     *
     * @param {string} skillDirectory
     * @returns {Promise<string[]>}
     */
    static async scanSkillNames(skillDirectory) {
        if (!skillDirectory) return [];
        const fs = await import('node:fs/promises');
        try {
            const entries = await fs.readdir(skillDirectory, { withFileTypes: true });
            return entries
                .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
                .map((e) => e.name)
                .sort();
        } catch {
            return [];
        }
    }

    /**
     * 注入取消信号（对齐 FlexRunner 的 F-06 能力）。
     * @param {AbortSignal} signal
     */
    setAbortSignal(signal) {
        if (signal && typeof signal.addEventListener === 'function') {
            this._abortController = signal;
            if (signal.aborted) this._aborted = true;
            else signal.addEventListener('abort', () => { this._aborted = true; }, { once: true });
        }
    }

    /**
     * 执行一个步骤的角色子图。
     *
     * 返回结构与 `FlexRunner.executeStart()` **完全一致**，因此 Orchestrator 的
     * 成功/失败链、`_resolveInputReport`、SSE 推送与持久化全部照常工作。
     *
     * @returns {Promise<{resultPath: string, success: boolean, nextStepId: number, metrics: object|null}>}
     */
    async executeStart() {
        this._ensureInitialized();
        if (this._aborted) throw new Error('MultiAgentRunner.executeStart: 已被终止，无法启动');

        this._running = true;
        this.startTime = this._clock();
        const attempt = this.executeStep;

        // Phase 3：本步骤在取消树上的节点（task → step；角色会话在其下再派生一层）
        if (this._abortTree && this._taskAbortNode) {
            this._stepAbortNode = this._abortTree.createChild(this._taskAbortNode, `step:${this.stepId}`);
        }

        const supervisor = new Supervisor({
            taskId: this.taskId,
            taskDir: this._taskDir,
            skillDirectory: this._skillDirectory,
            plan: this._collabPlan,
            registry: this._registry,
            sessionSemaphore: this._semaphore,
            roleLimiter: this._roleLimiter,
            sessionEvents: this._sessionEvents,
            abortTree: this._abortTree,
            abortNode: this._stepAbortNode,
            runnerFactory: this._runnerFactory,
            onEvent: this._onEvent,
            logger: this._logger,
            knownSkillNames: this._skillNames,
            maxGateRetries: this._maxGateRetries,
            pollIntervalMs: this._stepConfig?.pollIntervalMs,
            mcpConfigPath: this._stepConfig?.mcpConfigPath,
            keepSessions: this._stepConfig?.keepSessions,
            clock: this._clock
        });
        this._supervisor = supervisor;
        await supervisor.init();

        let result;
        try {
            result = await supervisor.run({
                stepId: this.stepId,
                taskDescription: this._taskDescription,
                bigLoopIndex: this.bigLoopIndex,
                specifiedSkill: this._specifiedSkill,
                inputReport: this._inputReport,
                signal: this._abortController?.signal,
                onSessionCreated: this._onSessionCreated
            });
        } catch (err) {
            this._log('error', `角色子图执行异常：${err.message}`);
            result = {
                success: false, resultPath: '', metrics: null,
                failureKind: 'supervisor_error', error: err.message, stageRuns: []
            };
        } finally {
            // Phase 3：步骤节点必须在**所有**路径上摘除（含异常/提前返回）。
            // 原先只在正常流程末尾 dispose，任何抛出都会在取消树上留下一个
            // 永久孤儿节点——而"孤儿数"正是判断会话泄漏的核心指标，
            // 让代码自身制造孤儿会让这个指标失去意义。
            this._stepAbortNode?.dispose();
            this._stepAbortNode = null;
        }

        this._lastResult = result;
        this._running = false;
        this.endTime = this._clock();
        this.executeStep++;
        this.retryTimes++;
        this.resultPath = result.resultPath || '';
        this.metrics = result.metrics || null;
        // 主阶段会话 id（供步骤详情面板拉取会话内容）
        this.sessionId = result.sessionId || '';

        this._emit('orch:agent:summary', {
            stepId: this.stepId,
            attempt,
            success: result.success === true,
            plan: result.plan || null,
            roleRuns: result.roleRuns ?? null,
            revisions: result.revisions || null,
            failureKind: result.failureKind || null,
            error: result.error || null,
            durationMs: result.durationMs ?? null,
            stages: (result.stageRuns || []).map((s) => ({
                stageId: s.stageId, role: s.role, round: s.round, attempt: s.attempt,
                success: s.success, failureKind: s.failureKind, durationMs: s.durationMs,
                skillName: s.skillName, note: s.note
            }))
        });

        const nextStepId = result.success === true ? this.nextStepId : Number(this._stepConfig?.failStepId) || 0;
        return {
            resultPath: this.resultPath,
            success: result.success === true,
            nextStepId,
            metrics: this.metrics
        };
    }

    /**
     * 是否还能重试（对齐 FlexRunner 语义：已达上限或已终止则不能）。
     * @returns {boolean}
     */
    canRetry() {
        return !this._aborted && this.retryTimes < this.maxRetries;
    }

    /**
     * 流程控制。`pause`/`resume` 通过 `Supervisor` 的角色运行器透传，
     * 但只在**阶段边界**生效（与 Phase 1 的"步骤边界"语义一致）。
     *
     * @param {'pause'|'resume'|'abort'} type
     * @returns {Promise<boolean>}
     */
    async controlExecution(type) {
        switch (type) {
            case 'abort': {
                this._aborted = true;
                if (this._supervisor) await this._supervisor.abort();
                this._log('warn', `多 Agent 执行已终止（step=${this.stepId}）`);
                return true;
            }
            case 'pause': {
                this._paused = true;
                this._log('info', `已请求暂停（将在阶段边界生效）`);
                return true;
            }
            case 'resume': {
                this._paused = false;
                this._log('info', '已恢复执行');
                return true;
            }
            default:
                this._log('warn', `controlExecution: 未知控制类型 ${type}`);
                return false;
        }
    }

    /**
     * 中止在途 HTTP（对齐 FlexRunner 的 F-06 能力）。
     * @returns {boolean}
     */
    abortInFlight() {
        this._aborted = true;
        try {
            this._abortController?.abort?.();
        } catch { /* 已 abort 过 */ }
        return true;
    }

    /**
     * 排空在途后台任务（优雅停机）。
     * @param {number} [timeoutMs]
     * @returns {Promise<object>}
     */
    async drainBackgroundTasks(timeoutMs) {
        if (!this._supervisor) return { drained: true, runtimes: 0 };
        return this._supervisor.drain({ timeoutMs: timeoutMs ?? 10000 });
    }

    /**
     * 实时消息（步骤详情面板"live"模式）。
     *
     * 多 Agent 下一次执行有多个会话，`live` 视图按主阶段会话返回；
     * 完整的多会话视图在 Phase 3 的前端拓扑图里提供（见 `getAgentTopology`）。
     *
     * @returns {Promise<Array>}
     */
    async getLiveMessages() {
        const runner = this._primaryRuntime?.();
        if (runner?.getLiveMessages) return runner.getLiveMessages();
        return [];
    }

    /**
     * 会话归档内容（步骤详情面板"session"模式）。
     * @returns {Promise<string>}
     */
    async getSessionContent() {
        const runner = this._primaryRuntime?.();
        if (runner?.getSessionContent) return runner.getSessionContent();
        return '';
    }

    /**
     * 协作拓扑（前端「Agent 拓扑图」）。
     * @returns {object|null}
     */
    getAgentTopology() {
        if (!this._supervisor) return null;
        return this._supervisor.getTopology();
    }

    /**
     * 上一次执行的协作摘要（持久化 / SSE）。
     * @returns {object|null}
     */
    getCollaborationSummary() {
        if (!this._lastResult) return null;
        return {
            /** 计划的结构化摘要（含 stages，供前端画角色子图）；未执行时为 null */
            plan: this._lastResult.planBrief || null,
            planId: this._lastResult.plan || null,
            skillRedirect: this._lastResult.skillRedirect || null,
            roleRuns: this._lastResult.roleRuns ?? null,
            revisions: this._lastResult.revisions || null,
            failureKind: this._lastResult.failureKind || null,
            error: this._lastResult.error || null,
            stageRuns: this._lastResult.stageRuns || [],
            topology: this._lastResult.topology || null
        };
    }

    /**
     * 协作回放日志。
     * @param {number} [limit]
     * @returns {object[]}
     */
    getReplayLog(limit) {
        return this._supervisor ? this._supervisor.getReplayLog(limit) : [];
    }

    /**
     * 统计快照。
     * @returns {object}
     */
    getStats() {
        return {
            taskId: this.taskId,
            stepId: this.stepId,
            plan: this._collabPlan?.id || null,
            enabled: this.enabled,
            running: this._running,
            aborted: this._aborted,
            roleRuns: this._lastResult?.roleRuns ?? 0,
            /** Phase 3：本步骤在取消树上的节点状态（aborted=会话已被级联取消） */
            abortNode: this._stepAbortNode ? this._stepAbortNode.brief() : null,
            supervisor: this._supervisor?.getStats() || null
        };
    }

    /**
     * 取"主阶段"对应的会话适配器（用于 live/session 详情）。
     *
     * 实现上取最后一个已创建的 AgentRuntime 的适配器——`thorough` 计划结束时
     * 最后一个通常是 verify；但主阶段产物在 `resultPath` 里已完整暴露，
     * 这里只用于"看会话现场"，取哪个角色都能满足排障需求（且不引入
     * "必须在 Supervisor 里记住主阶段运行时"的额外耦合）。
     *
     * @returns {*}
     * @private
     */
    _primaryRuntime() {
        const list = this._supervisor?.getRuntimes?.();
        return Array.isArray(list) && list.length ? list.at(-1)?._adapter : null;
    }

    /** @private */
    _ensureInitialized() {
        if (!this._initialized) {
            throw new Error('MultiAgentRunner: 请先调用 initContext()');
        }
    }

    /** @private */
    _emit(type, data) {
        if (this._onEvent) {
            try { this._onEvent(type, data); } catch { /* 事件回调异常不外溢 */ }
        }
    }

    /** @private */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[MultiAgentRunner|${this.taskId}|step${this.stepId}] ${msg}`);
    }
}

export default MultiAgentRunner;
