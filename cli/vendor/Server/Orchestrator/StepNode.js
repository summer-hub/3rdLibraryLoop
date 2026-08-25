/**
 * StepNode —— 编排器中的步骤节点模型
 *
 * 封装单个 FlexRunner 步骤的元信息与运行时状态，
 * 供 Orchestrator 进行拓扑分析、依赖调度、进度追踪。
 *
 * 高内聚：所有与单个步骤相关的状态和查询方法集中在此类。
 * 低耦合：不直接依赖 FlexRunner 实例，只持有配置和运行时结果。
 */

import { nowCST } from '../library/cstTime.js';

// ─── 步骤状态常量 ────────────────────────────────────────────────────────────

/** 编排器层面步骤状态（与 FlexRunner.StepStatus 对齐，额外增加编排层语义） */
export const NodeStatus = Object.freeze({
    PENDING: 'pending',       // 等待执行（未满足依赖条件）
    READY: 'ready',           // 依赖已满足，可执行
    RUNNING: 'running',       // 正在执行
    COMPLETED: 'completed',   // 执行成功
    FAILED: 'failed',         // 执行失败（已用完重试）
    SKIPPED: 'skipped',       // 被跳过（如前置失败导致无法执行）
    BLOCKED: 'blocked'        // 被阻塞（循环检测或死锁）
});

/**
 * @typedef {object} StepConfig
 * @property {number|string} stepId        - 步骤 ID（唯一标识）
 * @property {string}        taskDescription - 任务描述
 * @property {number|string|Array<number|string>} [dependId=0] - 依赖步骤 ID，支持单值或数组（fan-in 聚合）
 * @property {number|string} [nextStepId=0]- 成功后下一步骤 ID（0 = 无后续，结束）
 * @property {number|string} [failStepId=0]- 失败后指向步骤 ID（0 = 失败即终止）
 * @property {number}        [maxRetries=3]- 最大重试次数
 * @property {string}        [skillDirectory] - SKILL 目录路径
 * @property {string}        [skillPath]     - 固定 SKILL 目录路径（跳过 SkillSelector 匹配，绝对/相对路径均可）
 * @property {string}        [taskDir]     - 工作目录
 * @property {string}        [inputReport] - 输入报告路径
 * @property {string}        [taskDescription] - 任务描述
 */

/**
 * 归一化 dependId 为字符串前置 ID 数组。
 * - 单值（number/string）→ 非 0 时包装为 [id]，0/null/-1 → []
 * - 数组 → 过滤掉 0/空/-1，逐项转字符串
 * 其中 -1 是"修复步骤哨兵"：表示该步骤仅由 failStepId 触发，不是真实依赖 ID，
 * 因此不进入 _dependIds（避免 fan-in 聚合误判），同时真实依赖为 0 时仍保留 -1 原值（见构造/updateConfig）。
 * @param {number|string|Array<number|string>|null|undefined} value
 * @returns {string[]}
 */
function normalizeDependIds(value) {
    if (Array.isArray(value)) {
        return value
            .map(v => String(v))
            .filter(v => v !== '0' && v !== '' && v !== '-1');
    }
    if (value == null) return [];
    const s = String(value);
    return s === '0' || s === '' || s === '-1' ? [] : [s];
}

/** 原始 dependId 中是否含 -1 哨兵（单值或数组任一项） */
function hasSentinel(value) {
    if (Array.isArray(value)) {
        return value.some(v => String(v) === '-1');
    }
    return String(value ?? '') === '-1';
}

/**
 * @typedef {object} ExecutionRecord
 * @property {number}        attempt       - 第几次执行（从 1 开始）
 * @property {string}        startTime     - 开始时间
 * @property {string}        [endTime]     - 结束时间
 * @property {boolean}       success       - 是否成功
 * @property {string}        resultPath    - 结果文件路径
 * @property {string}        [sessionId]   - 会话 ID
 * @property {string}        [error]       - 错误信息
 */

class StepNode {
    /**
     * @param {StepConfig} config
     */
    constructor(config) {
        if (!config || config.stepId == null) {
            throw new Error('StepNode: stepId 为必填项');
        }

        // ── 元信息（可修改，仅 PENDING 状态时允许） ──
        this.stepId = String(config.stepId);
        this.taskDescription = config.taskDescription || '';
        // dependId 支持 number | number[]：内部统一归一化为字符串前置 ID 数组（_dependIds）。
        // 对外暴露 dependId 便于兼容——单依赖时为其第一个元素，多依赖时为数组。
        // 修复步骤哨兵 -1 不算真实依赖：_dependIds 为空，但 dependId 保留 -1 原值作为图数据自解释标记。
        this._dependIds = normalizeDependIds(config.dependId);
        this.dependId = hasSentinel(config.dependId)
            ? '-1'
            : (this._dependIds.length === 1 ? this._dependIds[0] : this._dependIds);
        this.nextStepId = config.nextStepId != null ? String(config.nextStepId) : '0';
        this.failStepId = config.failStepId != null ? String(config.failStepId) : '0';
        this.maxRetries = typeof config.maxRetries === 'number' ? config.maxRetries : 3;
        this.skillDirectory = config.skillDirectory || '';
        this.skillPath = config.skillPath || '';
        this.taskDir = config.taskDir || '';
        this.inputReport = config.inputReport || '';

        // ── 运行时状态 ──
        /** @type {string} */
        this.status = NodeStatus.PENDING;
        /** @type {number} 当前重试次数（0 = 尚未执行） */
        this.retryCount = 0;
        /** @type {string|null} 当前开始时间 */
        this.startTime = null;
        /** @type {string|null} 当前结束时间 */
        this.endTime = null;
        /** @type {string} 最新结果报告路径 */
        this.resultPath = '';
        /** @type {string} 最新会话 ID */
        this.sessionId = '';
        /** @type {ExecutionRecord[]} 历史执行记录 */
        this.history = [];
        /** @type {string|null} 失败原因 */
        this.error = null;
        /** @type {FlexRunner|null} 关联的 FlexRunner 实例（运行时注入） */
        this._runner = null;
    }

    // ─── 状态查询 ──────────────────────────────────────────────────────

    /**
     * 归一化后的前置依赖步骤 ID 数组。
     * 调度层统一使用此数组判断 fan-in 聚合条件（所有依赖完成才激活）。
     * @returns {string[]}
     */
    get dependencies() {
        return this._dependIds;
    }

    /** 是否有前置依赖（非入口步骤） */
    get hasDependencies() {
        return this._dependIds.length > 0;
    }

    /** 是否尚未执行 */
    get isPending() {
        return this.status === NodeStatus.PENDING || this.status === NodeStatus.READY;
    }

    /** 是否正在执行 */
    get isRunning() {
        return this.status === NodeStatus.RUNNING;
    }

    /** 是否已结束（成功 / 失败 / 跳过 / 阻塞） */
    get isFinished() {
        return (
            this.status === NodeStatus.COMPLETED ||
            this.status === NodeStatus.FAILED ||
            this.status === NodeStatus.SKIPPED ||
            this.status === NodeStatus.BLOCKED
        );
    }

    /** 是否成功 */
    get isCompleted() {
        return this.status === NodeStatus.COMPLETED;
    }

    /** 是否还能重试 */
    get canRetry() {
        return this.retryCount < this.maxRetries && !this.isFinished;
    }

    // ─── 状态变更 ──────────────────────────────────────────────────────

    /** 标记为就绪（依赖已满足）。
     *  允许从 PENDING（初始）/ COMPLETED（成功）/ FAILED（失败）重新进入 READY，
     *  以支持 failStepId 修复步骤被重复执行（不清空历史结果，由 markRunning/markFinished 自然更新）。 */
    markReady() {
        if (this.status === NodeStatus.PENDING ||
            this.status === NodeStatus.COMPLETED ||
            this.status === NodeStatus.FAILED) {
            this.status = NodeStatus.READY;
        }
    }

    /** 标记为执行中 */
    markRunning() {
        this.status = NodeStatus.RUNNING;
        this.retryCount++;
        this.startTime = nowCST();
        this.endTime = null;
        this.error = null;
    }

    /**
     * 标记执行完成
     * @param {{success: boolean, resultPath: string, sessionId?: string, error?: string}} result
     */
    markFinished(result) {
        this.endTime = nowCST();
        this.resultPath = result.resultPath || '';
        this.sessionId = result.sessionId || '';
        this.error = result.error || null;

        this.history.push({
            attempt: this.retryCount,
            startTime: this.startTime,
            endTime: this.endTime,
            success: result.success,
            resultPath: this.resultPath,
            sessionId: this.sessionId,
            error: this.error
        });

        this.status = result.success ? NodeStatus.COMPLETED : NodeStatus.FAILED;
    }

    /** 标记为跳过 */
    markSkipped(reason) {
        this.status = NodeStatus.SKIPPED;
        this.error = reason;
    }

    /** 标记为阻塞 */
    markBlocked(reason) {
        this.status = NodeStatus.BLOCKED;
        this.error = reason;
    }

    /**
     * 释放关联的 FlexRunner 实例及其重型引用（CLIController / SkillSelector / LLMClient / Storage）。
     *
     * 编排结束后调用，使 FlexRunner 及其内嵌依赖可被 GC 回收。
     * 仅置空 `_runner`，保留 `sessionId` / `resultPath` / `history` 等序列化元信息，
     * 前端仍可通过 `toJSON()` 与本地归档查看历史。
     */
    releaseRunner() {
        this._runner = null;
    }

    // ─── 配置修改 ──────────────────────────────────────────────────────

    /**
     * 修改步骤配置（仅 PENDING 状态允许）。
     *
     * @param {Partial<StepConfig>} patch - 要修改的字段
     * @returns {boolean} 是否修改成功
     */
    updateConfig(patch) {
        if (!this.isPending) {
            return false;
        }
        if (!patch || typeof patch !== 'object') return false;

        if (patch.taskDescription !== undefined) this.taskDescription = patch.taskDescription;
        if (patch.dependId !== undefined) {
            this._dependIds = normalizeDependIds(patch.dependId);
            this.dependId = hasSentinel(patch.dependId)
                ? '-1'
                : (this._dependIds.length === 1 ? this._dependIds[0] : this._dependIds);
        }
        if (patch.nextStepId !== undefined) this.nextStepId = String(patch.nextStepId);
        if (patch.failStepId !== undefined) this.failStepId = String(patch.failStepId);
        if (patch.maxRetries !== undefined) this.maxRetries = Number(patch.maxRetries);
        if (patch.skillDirectory !== undefined) this.skillDirectory = patch.skillDirectory;
        if (patch.skillPath !== undefined) this.skillPath = patch.skillPath;
        if (patch.taskDir !== undefined) this.taskDir = patch.taskDir;
        if (patch.inputReport !== undefined) this.inputReport = patch.inputReport;

        return true;
    }

    // ─── 序列化 ────────────────────────────────────────────────────────

    /**
     * 序列化为 JSON（供前端展示和持久化）。
     * @returns {object}
     */
    toJSON() {
        return {
            stepId: this.stepId,
            taskDescription: this.taskDescription,
            dependId: this.dependId,
            nextStepId: this.nextStepId,
            failStepId: this.failStepId,
            maxRetries: this.maxRetries,
            skillDirectory: this.skillDirectory,
            skillPath: this.skillPath,
            taskDir: this.taskDir,
            inputReport: this.inputReport,
            status: this.status,
            retryCount: this.retryCount,
            startTime: this.startTime,
            endTime: this.endTime,
            resultPath: this.resultPath,
            sessionId: this.sessionId,
            error: this.error,
            canRetry: this.canRetry,
            history: this.history
        };
    }
}

export { StepNode };
export default StepNode;
