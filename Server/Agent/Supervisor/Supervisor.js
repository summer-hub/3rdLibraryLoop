/**
 * Supervisor —— 步骤内的多 Agent 编排者（Phase 2）
 *
 * 定位（与 Orchestrator 的分工必须说清楚，否则会写出两套调度器）：
 *
 * | 层级 | 负责 | 不负责 |
 * |---|---|---|
 * | `Orchestrator` | **步骤之间**的 DAG（依赖/扇入扇出/成功失败链/死锁/终止） | 步骤内部发生了什么 |
 * | `Supervisor` | **一个步骤内部**的角色子图（谁先做、谁评审、驳回回哪、几次上限） | 跨步骤依赖与全局并发上限 |
 *
 *   Supervisor **不重写调度器**：它只在一个 `StepNode` 的生命周期内工作，
 *   对外暴露与 `FlexRunner.executeStart()` 等价的返回值
 *   （`{success, resultPath, metrics}`），所以 Orchestrator 可以完全无感地
 *   把"单 runner"替换成"角色子图"（见 `MultiAgentRunner`）。
 *
 * ## 总线承载什么、不承载什么（重要设计取舍）
 *
 * **承载**：协作协议本身——`TASK_ASSIGN` / `PROGRESS` / `REQUEST_REVIEW` /
 * `REVIEW_RESULT` / `REVISION_REQUEST` / `ARTIFACT_PUBLISHED` / `FINAL_REPORT`，
 * 全部经 `MessageBus` 投递并进入回放日志。因此「谁跟谁说了什么」100% 可重建。
 *
 * **不承载**：执行调度本身。角色会话的实际执行由 Supervisor 通过 `AgentRuntime`
 * **直接 await 驱动**，而不是"往总线丢一条消息然后等 handler 干活"。
 * 理由（两条都是会立刻踩到的坑）：
 *   1. handler 的返回值是 fire-and-forget 语义；要用它传回执行结果，
 *      就得在总线上再造一套 await/超时/异常传播机制；
 *   2. `MessageBus.request()` 的超时语义与角色的执行超时**重叠**，
 *      两者同时生效时无法判断"是总线没送到、还是角色跑太久"，失败归因会变模糊。
 *
 * Phase 4 换成真实 MQ 时，这份消息序列可直接作为事件流对外发布；
 * 届时只需替换 `MessageBus`，Supervisor 的控制流不变。
 *
 * ## 评审门与修订环（Phase 2 的验收核心）
 *
 * ```
 * retrieve ─→ plan ─→ code ─→ review ─→ verify
 *                       ↑         │
 *                       └── 驳回 ──┘   （revisions[code] < maxRevisions）
 * ```
 *   - 只有声明了 `reviews` 的阶段有**否决权**；
 *   - 驳回必须携带**可行动理由**（`reasons`），逐条注入被驳回阶段的 prompt；
 *   - 修订次数有硬上限（`plan.maxRevisions`），超限即整步失败；
 *   - 另有 `plan.maxRoleRuns` 兜底：任何未预料到的循环都在这里被截断。
 */

import path from 'node:path';
import fs from 'node:fs/promises';

import { nowCST } from '../../library/cstTime.js';
import { AgentRuntime, ROLE_META_CONTRACTS } from '../Runtime/AgentRuntime.js';
import { defaultRoleRegistry, RoleRegistry } from '../Roles/AgentRole.js';
import { MessageBus } from '../Messaging/MessageBus.js';
import { MessageIntent, BROADCAST, SUPERVISOR_ID } from '../Messaging/AgentMessage.js';
import { Blackboard } from '../Blackboard/Blackboard.js';
import { CollaborationPlan, resolvePlan } from './CollaborationPlan.js';

/** 结论不可解析时，允许重新执行该「评审门」阶段的次数（不消耗修订次数） */
export const DEFAULT_MAX_GATE_RETRIES = 1;

/** 收集到 prompt 里的单个上游产物字符上限 */
const UPSTREAM_ARTIFACT_CHARS = 4000;

/**
 * 步骤内的角色子图编排者。
 *
 * **一个实例只服务一个步骤的一次执行**（`run()` 末尾会关闭总线）。
 * 需要再执行一次请新建实例——复用会让回放日志混入上一次协作的消息，
 * 使"从日志重建本次协作"这一承诺失效。
 */
export class Supervisor {
    /**
     * @param {object} opts
     * @param {string} opts.taskId                      - 任务 ID（必填）
     * @param {string} opts.taskDir                     - 任务目录（黑板根）
     * @param {string} [opts.skillDirectory]            - SKILL 根目录（用于角色准入名单）
     * @param {CollaborationPlan|object|string} [opts.plan] - 协作计划（默认 standard）
     * @param {RoleRegistry} [opts.registry]            - 角色注册表（默认内置 5 角色）
     * @param {MessageBus} [opts.bus]                   - 协作总线（默认新建）
     * @param {Blackboard} [opts.blackboard]            - 共享黑板（默认新建）
     * @param {*} [opts.sessionSemaphore]               - Session 并发信号量
     * @param {Function} [opts.runnerFactory]           - 会话适配器工厂（透传给 AgentRuntime）
     * @param {(type: string, data: object) => void} [opts.onEvent] - 事件回调（SSE）
     * @param {(level: string, msg: string) => void} [opts.logger]
     * @param {string[]} [opts.knownSkillNames]         - 已知 SKILL 名单（避免每角色重复扫盘）
     * @param {number} [opts.maxGateRetries]
     * @param {number} [opts.pollIntervalMs]
     * @param {string} [opts.mcpConfigPath]
     * @param {boolean} [opts.keepSessions]
     * @param {() => string} [opts.clock]
     */
    constructor(opts = {}) {
        if (!opts.taskId) throw new Error('Supervisor: taskId 为必填项');
        this.taskId = String(opts.taskId);
        this.taskDir = path.resolve(opts.taskDir || path.resolve(process.cwd(), 'db', 'task', this.taskId));
        this.skillDirectory = opts.skillDirectory || '';

        this.registry = opts.registry instanceof RoleRegistry ? opts.registry : defaultRoleRegistry.clone();
        this.plan = Supervisor._coercePlan(opts.plan);
        this.bus = opts.bus instanceof MessageBus ? opts.bus : new MessageBus({ clock: opts.clock });
        this.blackboard = opts.blackboard instanceof Blackboard
            ? opts.blackboard
            : new Blackboard({ taskId: this.taskId, taskDir: this.taskDir });

        this._semaphore = opts.sessionSemaphore || null;
        /** @type {object|null} Phase 3：角色级（第三级）限流器 */
        this._roleLimiter = opts.roleLimiter || null;
        /** @type {object|null} Phase 3：会话事件源（事件驱动替代轮询） */
        this._sessionEvents = opts.sessionEvents || null;
        /** @type {object|null} Phase 3：取消树（task → step → role → HTTP） */
        this._abortTree = opts.abortTree || null;
        /** @type {object|null} Phase 3：本步骤在取消树上的节点（每个角色会话再派生一层子节点） */
        this._stepAbortNode = opts.abortNode || null;
        this._runnerFactory = typeof opts.runnerFactory === 'function' ? opts.runnerFactory : null;
        this._onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        this._knownSkillNames = Array.isArray(opts.knownSkillNames) ? [...opts.knownSkillNames] : null;
        this.maxGateRetries = Number.isInteger(opts.maxGateRetries) && opts.maxGateRetries >= 0
            ? opts.maxGateRetries
            : DEFAULT_MAX_GATE_RETRIES;
        this._pollIntervalMs = opts.pollIntervalMs;
        this._mcpConfigPath = opts.mcpConfigPath;
        this._keepSessions = opts.keepSessions === true;
        this._clock = typeof opts.clock === 'function' ? opts.clock : nowCST;

        /** @type {AgentRuntime[]} 本次运行创建的运行时（供中止/排空） */
        this._runtimes = [];
        /** @type {object[]} 阶段执行记录（审计与 SSE 的数据源） */
        this._stageRuns = [];
        this._initialized = false;
        this._closed = false;
        this._aborted = false;
        this._lastRun = null;
        /**
         * @type {CollaborationPlan|null} 本次实际执行的计划。
         * 与 `this.plan`（配置的计划）不同：指定 SKILL 时会**收窄**为单阶段计划，
         * 前端要展示的是"实际发生了什么"，因此 `getTopology()` 优先用这个。
         */
        this._effectivePlan = null;
    }

    /**
     * 计划入参归一化：CollaborationPlan 实例 / 内置计划名 / 对象定义。
     * @param {*} plan
     * @returns {CollaborationPlan}
     * @private
     */
    static _coercePlan(plan) {
        if (plan instanceof CollaborationPlan) return plan;
        return resolvePlan(plan, 'standard');
    }

    /** @returns {boolean} 是否已初始化 */
    get initialized() {
        return this._initialized;
    }

    /**
     * 初始化黑板与总线订阅。
     *
     * **总线订阅在这里完成**（而不是在 `run()` 里）：每个角色都必须有一个订阅者，
     * 否则发往该角色的消息会全部落进 `undelivered`——协作日志看起来"有消息"，
     * 但"谁收到了"永远是 0，这类问题在产品里极难发现。
     *
     * @returns {Promise<{loaded: number}>}
     */
    async init() {
        const bb = await this.blackboard.init();

        // 为**全部**已注册角色建立订阅（不只是计划内的）：
        // 收窄到计划内会让"计划外的角色收到消息"这一情况静默变成 undelivered，
        // 而它恰恰是需要被看见的异常（说明计划与角色注册表不一致）。
        for (const role of this.registry.list()) {
            this.bus.register(role.id, (msg) => this._onRoleMessage(role.id, msg),
                role.subscribesIntents.length ? { intents: role.subscribesIntents } : {});
        }

        // 计划引用的角色必须存在——缺角色时在这里失败，而不是跑到一半才发现
        for (const roleId of this.plan.roleIds()) {
            if (!this.registry.has(roleId)) {
                throw new Error(
                    `Supervisor.init: 计划 ${this.plan.id} 引用了未注册的角色 "${roleId}"；` +
                    `已注册：${this.registry.ids().join('、')}`
                );
            }
        }

        this._initialized = true;
        return { loaded: bb.loaded };
    }

    /**
     * 角色侧的消息处理。
     *
     * 这是「角色的收件箱」：本实现只做**记录、计数与事件上报**（表示角色已被通知），
     * 实际执行由 Supervisor 直接驱动（见类文档的取舍说明）。
     * 保留这个 hook 的价值在于：Phase 3/4 若要让角色真正处理入站消息
     * （例如响应 `QUERY`），只需替换此方法的实现。
     *
     * @param {string} roleId
     * @param {object} msg
     * @private
     */
    _onRoleMessage(roleId, msg) {
        this._emit('orch:agent:message', {
            role: roleId,
            from: msg.from,
            intent: msg.intent,
            messageId: msg.id,
            correlationId: msg.correlationId,
            stepId: msg.stepId
        });
        this._log('debug', `角色 ${roleId} 收到 ${msg.brief()}`);
    }

    /**
     * 执行一个步骤的角色子图。
     *
     * @param {object} input
     * @param {number} input.stepId                  - 编排步骤 id（必填）
     * @param {string} input.taskDescription         - 步骤任务描述（必填）
     * @param {number} [input.bigLoopIndex=0]
     * @param {string} [input.specifiedSkill]        - 步骤指定的 SKILL
     * @param {string} [input.inputReport]           - 前置步骤报告路径
     * @param {AbortSignal} [input.signal]
     * @param {(sessionId: string) => void} [input.onSessionCreated]
     * @param {CollaborationPlan} [input.plan]       - 覆盖本次使用的计划
     * @returns {Promise<object>} 与 `FlexRunner.executeStart()` 兼容的结果 +
     *   `{stageRuns, revisions, roleRuns, failureKind, error, topology}`
     */
    async run(input = {}) {
        if (this._closed) {
            throw new Error('Supervisor.run: 本实例已使用过（一个 Supervisor 只服务一次步骤执行）');
        }
        if (!this._initialized) await this.init();

        const {
            stepId, taskDescription, bigLoopIndex = 0,
            specifiedSkill, inputReport, signal, onSessionCreated
        } = input;

        if (!Number.isInteger(Number(stepId)) || Number(stepId) <= 0) {
            throw new Error('Supervisor.run: stepId 必须为正整数');
        }
        if (typeof taskDescription !== 'string' || taskDescription.trim() === '') {
            throw new Error('Supervisor.run: taskDescription 不能为空');
        }

        this._stageRuns = [];
        this._runtimes = [];
        this._aborted = false;
        const startedAt = this._clock();
        const t0 = Date.now();

        const basePlan = input.plan instanceof CollaborationPlan ? input.plan : this.plan;

        // ── 指定 SKILL 的策略（见 CollaborationPlan.onSpecifiedSkill） ──
        const { effectivePlan, skillRedirect } = this._applySpecifiedSkillPolicy(basePlan, specifiedSkill);
        this._effectivePlan = effectivePlan;

        this._log('info',
            `Supervisor 启动 — stepId=${stepId} plan=${effectivePlan.id} ` +
            `roles=[${effectivePlan.roleIds().join(',')}]` +
            (skillRedirect ? `（因指定 SKILL 收窄：${skillRedirect.reason}）` : ''));

        this._emit('orch:agent:topology', {
            stepId: Number(stepId),
            taskId: this.taskId,
            plan: effectivePlan.brief(),
            skillRedirect,
            agents: effectivePlan.roleIds().map((id) => this.registry.get(id)?.brief()).filter(Boolean)
        });

        // ── 主循环：线性推进 + 评审门回跳 ──
        const revisions = {};
        const gateRetries = {};
        const feedback = {};
        let stageIndex = 0;
        let roleRuns = 0;
        let failure = null;
        let primaryResultPath = '';
        let primarySessionId = '';
        let stepMetrics = null;

        while (stageIndex < effectivePlan.stages.length) {
            const stage = effectivePlan.stages[stageIndex];
            const role = this.registry.get(stage.role);
            if (!role) {
                failure = { failureKind: 'plan_error', error: `计划引用了未注册角色 ${stage.role}` };
                break;
            }

            if (this._aborted || signal?.aborted) {
                failure = { failureKind: 'aborted', error: '协作已终止' };
                break;
            }

            // 全局兜底：任何未预期的循环都在这里被截断
            if (roleRuns >= effectivePlan.maxRoleRuns) {
                failure = {
                    failureKind: 'role_run_limit',
                    error: `单步骤角色会话数达到上限 ${effectivePlan.maxRoleRuns}（修订环未收敛）`
                };
                break;
            }

            const round = revisions[stage.id] || 0;
            const attempt = this._stageRuns.filter((r) => r.stageId === stage.id && !r.note).length;

            this._emit('orch:agent:assign', {
                stepId: Number(stepId), stageId: stage.id, role: stage.role,
                round, attempt, assign: stage.assign
            });

            await this._notify({
                from: SUPERVISOR_ID, to: stage.role, intent: MessageIntent.TASK_ASSIGN,
                stepId: Number(stepId), round,
                payload: {
                    stageId: stage.id,
                    attempt,
                    reviews: stage.reviews || null,
                    produces: stage.produces || null,
                    assign: stage.assign
                }
            });

            const runResult = await this._runStage({
                stage, role, stepId: Number(stepId), taskDescription, bigLoopIndex,
                specifiedSkill: stage.id === effectivePlan.primaryStage ? specifiedSkill : undefined,
                inputReport, signal, onSessionCreated, round, attempt,
                feedback: feedback[stage.id] || null, plan: effectivePlan
            });
            roleRuns++;

            const record = {
                stageId: stage.id, role: stage.role, round, attempt,
                success: runResult.success === true,
                failureKind: runResult.failureKind || null,
                resultPath: runResult.resultPath || '',
                sessionId: runResult.sessionId || '',
                skillName: runResult.skillName || '',
                metrics: runResult.metrics || null,
                durationMs: runResult.durationMs ?? null,
                error: runResult.error || null,
                note: null,
                settledAt: this._clock()
            };
            this._stageRuns.push(record);
            this._emit('orch:agent:result', { stepId: Number(stepId), ...record });

            if (stage.id === effectivePlan.primaryStage && record.success) {
                primaryResultPath = record.resultPath;
                primarySessionId = record.sessionId;
                stepMetrics = record.metrics;
            }

            // ── 失败处理 ──
            if (!record.success) {
                // 槽位超时是**系统过载**而非角色能力问题：不消耗修订次数，直接判定本步失败，
                // 由 Orchestrator 的失败链决定是否重试（避免在过载时继续加压）。
                if (runResult.failureKind === 'slot_timeout' || runResult.failureKind === 'aborted') {
                    failure = { failureKind: runResult.failureKind, error: runResult.error };
                    break;
                }
                if (stage.optional) {
                    this._log('warn', `阶段 ${stage.id}（可选）失败，跳过：${runResult.error}`);
                    await this._notify({
                        from: stage.role, to: SUPERVISOR_ID, intent: MessageIntent.FINAL_REPORT,
                        stepId: Number(stepId), round,
                        payload: { stageId: stage.id, ok: false, optional: true, error: runResult.error }
                    });
                    stageIndex++;
                    continue;
                }
                failure = { failureKind: runResult.failureKind || 'role_failed', error: runResult.error };
                break;
            }

            // ── 写黑板 + 广播产物 ──
            if (stage.produces) {
                await this._publishStageArtifact({ stage, role, record, stepId: Number(stepId), round });
            }

            // ── 评审门判定 ──
            if (stage.reviews) {
                // 显式发出「请求评审」：评审的**起因**是被评审阶段产出了产物，
                // 因此这条消息的 from 是被评审阶段的角色，而不是编排者。
                // （编排者代角色发布消息——与下面 ARTIFACT_PUBLISHED 的 from 约定一致。）
                // 缺了这条，回放日志里就只有"编排者给评审者派活"，
                // 看不出"谁请求谁评审"，`REQUEST_REVIEW` 这个意图也就从未被真正使用。
                const reviewedStage = effectivePlan.stage(stage.reviews);
                if (reviewedStage) {
                    const produced = this.blackboard.getEntry(`artifact:${stage.reviews}`);
                    await this._notify({
                        from: reviewedStage.role, to: stage.role,
                        intent: MessageIntent.REQUEST_REVIEW,
                        stepId: Number(stepId), round,
                        payload: {
                            stageId: stage.reviews,
                            reviewerStageId: stage.id,
                            resultPath: produced?.value?.resultPath || '',
                            attempt
                        },
                        artifacts: produced?.value?.resultPath ? [produced.value.resultPath] : []
                    });
                }

                const verdict = this._parseVerdict(stage, role, runResult);
                this._emit('orch:agent:review', {
                    stepId: Number(stepId), stageId: stage.id, target: stage.reviews,
                    parsed: verdict.parsed, approved: verdict.approved,
                    reasons: verdict.reasons, raw: verdict.raw
                });

                // 结论不可解析：先原地重跑一次评审阶段（**不消耗修订次数**），仍不行则显式失败。
                // 刻意不把"不可解析"当成"通过"（那会让评审门形同虚设），
                // 也不直接当成"驳回"（那会白白消耗一次修订额度）。
                if (!verdict.parsed) {
                    const tries = gateRetries[stage.id] || 0;
                    if (tries < this.maxGateRetries) {
                        gateRetries[stage.id] = tries + 1;
                        this._log('warn',
                            `评审门 ${stage.id} 的结论不可解析（缺少 ${verdict.missing.join('、') || '必需字段'}），` +
                            `原地重跑该评审阶段（第 ${tries + 1}/${this.maxGateRetries} 次）`);
                        this._stageRuns.push({
                            stageId: stage.id, role: stage.role, round, attempt,
                            success: true, failureKind: 'verdict_unparsable',
                            resultPath: runResult.resultPath, sessionId: runResult.sessionId || '',
                            metrics: null, error: null, note: 'gate_retry', settledAt: this._clock()
                        });
                        feedback[stage.id] = [
                            '**上一轮你的结构化结论文件缺失或字段不完整**，本次必须写出合法 JSON。',
                            `缺少字段：${verdict.missing.join('、') || '见输出契约'}。`
                        ].join('\n');
                        // stageIndex 不变 → 原地重跑；attempt 计数已通过上面的记录推进，
                        // 因此不会覆盖上一轮的产物文件。
                        continue;
                    }
                    failure = {
                        failureKind: 'verdict_unparsable',
                        error: `评审门 ${stage.id} 连续 ${this.maxGateRetries + 1} 次未产出可解析结论`
                    };
                    break;
                }

                if (verdict.approved === false) {
                    const targetIdx = effectivePlan.stages.findIndex((s) => s.id === stage.reviews);
                    const targetRoleId = effectivePlan.stages[targetIdx].role;
                    const usedRevisions = revisions[stage.reviews] || 0;

                    await this._notify({
                        from: stage.role, to: targetRoleId,
                        intent: MessageIntent.REVISION_REQUEST,
                        stepId: Number(stepId), round,
                        payload: {
                            stageId: stage.reviews,
                            reasons: verdict.reasons,
                            revision: usedRevisions + 1,
                            maxRevisions: effectivePlan.maxRevisions
                        }
                    });

                    if (usedRevisions < effectivePlan.maxRevisions) {
                        revisions[stage.reviews] = usedRevisions + 1;
                        feedback[stage.reviews] = verdict.reasons.length
                            ? verdict.reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')
                            : '（评审者未给出具体理由，请自行复核全部验收项）';
                        this._log('info',
                            `评审门 ${stage.id} 驳回，回到阶段 ${stage.reviews} ` +
                            `（第 ${usedRevisions + 1}/${effectivePlan.maxRevisions} 次修订）`);
                        stageIndex = targetIdx;
                        continue;
                    }

                    failure = {
                        failureKind: 'review_rejected',
                        error: `评审在第 ${usedRevisions} 次修订后仍未通过（上限 ${effectivePlan.maxRevisions}）：` +
                            (verdict.reasons.join('；') || '评审者未给出具体理由')
                    };
                    break;
                }
            }

            // ── required 阶段的结论校验 ──
            if (stage.required) {
                const v = this._parseVerdict(stage, role, runResult);
                if (!v.parsed) {
                    failure = {
                        failureKind: 'verdict_unparsable',
                        error: `必需阶段 ${stage.id} 未产出可解析结论（缺少 ${v.missing.join('、') || '必需字段'}）`
                    };
                    break;
                }
                if (v.ok !== true) {
                    failure = {
                        failureKind: 'verify_failed',
                        error: `必需阶段 ${stage.id} 结论为「${String(v.raw)}」：` +
                            (v.reasons.join('；') || '无附加说明')
                    };
                    break;
                }
            }

            stageIndex++;
        }

        // ── 收尾 ──
        if (!failure && stageIndex >= effectivePlan.stages.length) {
            const primaryOk = this._stageRuns.some(
                (r) => r.stageId === effectivePlan.primaryStage && r.success && !r.note
            );
            if (!primaryOk) {
                failure = {
                    failureKind: 'primary_missing',
                    error: `主阶段 ${effectivePlan.primaryStage} 未成功产出步骤交付物`
                };
            }
        }

        const success = !failure;

        await this._notify({
            from: SUPERVISOR_ID, to: BROADCAST, intent: MessageIntent.FINAL_REPORT,
            stepId: Number(stepId),
            payload: {
                ok: success,
                primaryStage: effectivePlan.primaryStage,
                resultPath: primaryResultPath,
                roleRuns,
                revisions,
                failureKind: failure?.failureKind || null
            }
        });

        // 黑板落盘（协作结论必须持久化，否则进程重启后协作过程无法审计）
        await this.blackboard.flush().catch((err) =>
            this._log('warn', `黑板刷盘失败（忽略）：${err.message}`));

        const result = {
            // 与 FlexRunner.executeStart() 兼容的字段
            success,
            resultPath: primaryResultPath,
            metrics: stepMetrics,
            // 协作层附加字段
            sessionId: primarySessionId,
            plan: effectivePlan.id,
            /** 计划的结构化摘要（前端渲染角色子图用；与 `plan` 的字符串 id 互补） */
            planBrief: effectivePlan.brief(),
            skillRedirect,
            stageRuns: this._stageRuns.map((r) => ({ ...r })),
            roleRuns,
            revisions: { ...revisions },
            failureKind: failure?.failureKind || null,
            error: failure?.error || null,
            startedAt,
            endedAt: this._clock(),
            durationMs: Date.now() - t0,
            topology: this.bus.deriveTopology({ agents: this.registry.ids() })
        };

        this._lastRun = result;
        this._log(success ? 'info' : 'warn',
            `Supervisor 结束 — stepId=${stepId} success=${success} roleRuns=${roleRuns} ` +
            `duration=${result.durationMs}ms` + (failure ? ` 原因：${failure.error}` : ''));

        // 协作完成后关闭总线：释放 pending 请求、排空在途 handler。
        // 本实例随之作废（见类文档）。
        //
        // Phase 3：被取消时把上限压到 500ms。理由是"取消场景要的是**快**，不是**优雅**"：
        // 协作已经作废，等待 5 秒只为让一个同步 handler 跑完毫无收益，
        // 却会让每一步的收尾时间叠加（实测把 abortAndWait 拖到超过其等待窗口，
        // 表现为取消树上残留"看起来像泄漏"的步骤节点）。
        await this.bus.close({ timeoutMs: this._aborted ? 500 : 5000 }).catch(() => {});
        this._closed = true;

        return result;
    }

    /**
     * 执行单个阶段。
     * @param {object} p
     * @returns {Promise<object>}
     * @private
     */
    async _runStage(p) {
        const { stage, role, stepId, taskDescription, bigLoopIndex, specifiedSkill, inputReport,
            signal, onSessionCreated, round, attempt, feedback, plan } = p;

        const runtime = new AgentRuntime({
            role,
            taskId: this.taskId,
            taskDir: this.taskDir,
            skillDirectory: this.skillDirectory,
            sessionSemaphore: this._semaphore,
            roleLimiter: this._roleLimiter,
            sessionEvents: this._sessionEvents,
            runnerFactory: this._runnerFactory,
            logger: this._logger,
            pollIntervalMs: this._pollIntervalMs,
            mcpConfigPath: this._mcpConfigPath,
            keepSessions: this._keepSessions,
            clock: this._clock
        });
        if (this._knownSkillNames) runtime.withKnownSkills(this._knownSkillNames);

        // Phase 3：取消树——每个角色会话派生一个子节点（step → role）。
        // 有了它，"终止任务"能逐层到达每个角色会话直至其 HTTP 请求；
        // 且**取消后新派生的节点立即是取消态**，不会出现"abort 之后又起了新会话"。
        /** @type {AbortNode|null} */
        let roleAbortNode = null;
        if (this._stepAbortNode && this._abortTree) {
            roleAbortNode = this._abortTree.createChild(
                this._stepAbortNode, `role:step${stepId}/${stage.id}`);
            runtime._abortNode = roleAbortNode;
            if (roleAbortNode.aborted) {
                // 已被取消：不启动会话，直接给出可归因结果
                roleAbortNode.dispose();
                return {
                    ok: false, success: false, failureKind: 'aborted',
                    error: `协作已取消（${roleAbortNode.reason || '未说明'}）`,
                    resultPath: '', sessionId: '', metrics: null
                };
            }
        }
        this._runtimes.push(runtime);

        // 上游产物：既要"让角色看到"，也要控制体积（否则 prompt 会被上游长报告淹没）
        const artifactsText = await this._collectUpstreamArtifacts(stage);
        const snapshot = this.blackboard.snapshotForPrompt({
            excludeKeys: stage.produces ? [stage.produces] : []
        });

        const roleDesc = [
            stage.assign || `完成步骤 ${stepId} 的「${stage.id}」阶段工作。`,
            `本次协作计划：${plan.name}（当前阶段 ${stage.id}）。`,
            round > 0 ? `这是第 ${round} 次修订，请针对驳回理由逐条修改。` : ''
        ].filter(Boolean).join('\n');

        const res = await runtime.run({
            stepId,
            taskDescription,
            round,
            bigLoopIndex,
            attempt,
            specifiedSkill,
            inputReport,
            signal,
            timeoutMs: stage.timeoutMs || undefined,
            onSessionCreated,
            context: {
                role: roleDesc,
                blackboard: snapshot.text,
                artifacts: artifactsText,
                feedback
            }
        });

        // Phase 3：角色会话结束 → 从取消树摘除。
        // 不摘除会让长任务在根节点下累积成千上万个已取消的子节点
        // （`AbortTree.getStats().orphans` 会把这种情况直接暴露出来）。
        roleAbortNode?.dispose();

        // 记录本次阶段运行到黑板（即使阶段失败也留痕，便于事后审计"当时到底发生了什么"）
        await this.blackboard.writeArtifact(
            path.posix.join('runs', `step${stepId}-${stage.id}-round${round}-attempt${attempt}.json`),
            JSON.stringify({
                stageId: stage.id, role: stage.role, round, attempt,
                success: res.success, failureKind: res.failureKind || null,
                resultPath: res.resultPath || '', sessionId: res.sessionId || '',
                skillName: res.skillName || '', metrics: res.metrics || null,
                error: res.error || null, at: this._clock()
            }, null, 2)
        ).catch((err) => this._log('warn', `写入阶段记录失败（忽略）：${err.message}`));

        return res;
    }

    /**
     * 收集上游阶段的产物正文，拼成给当前角色的上下文。
     *
     * 预算控制：每个上游产物最多 `UPSTREAM_ARTIFACT_CHARS`，超出即截断并**显式标注**。
     * 静默截断比不截断更危险——模型会把截断后的文本当成完整产物，
     * 进而得出"内容缺失"的错误结论。
     *
     * @param {object} stage
     * @returns {Promise<string>}
     * @private
     */
    async _collectUpstreamArtifacts(stage) {
        /** @type {string[]} */
        const blocks = [];

        // 1) 被本阶段评审的目标产物正文（评审者必须看到实物，而不是只看路径）
        if (stage.reviews) {
            const entry = this.blackboard.getEntry(`artifact:${stage.reviews}`);
            const resultPath = entry?.value?.resultPath;
            if (resultPath) {
                const text = await Supervisor._readFileBounded(resultPath, UPSTREAM_ARTIFACT_CHARS);
                if (text) {
                    blocks.push(`### 待评审产物（阶段 ${stage.reviews}，文件 ${resultPath}）\n${text}`);
                } else {
                    blocks.push(
                        `### 待评审产物（阶段 ${stage.reviews}）\n` +
                        `⚠️ 黑板上记录的结果文件 ${resultPath} **不存在或无法读取**。` +
                        `这本身就是一个必须驳回的问题（声称完成但产物缺失）。`
                    );
                }
            }
        }

        // 2) 声明消费的黑板条目
        for (const key of stage.consumes) {
            const entry = this.blackboard.getEntry(key);
            if (!entry) continue;
            blocks.push(`### 黑板条目「${key}」（作者 ${entry.author}）\n${Blackboard._renderValue(entry.value)}`);
        }

        if (blocks.length === 0) return '';
        return `以下为你需要参照的上游产出（已按体积裁剪，标注「已截断」的表示原文更长）：\n\n${blocks.join('\n\n')}`;
    }

    /**
     * 有界读取文件（不存在或失败返回空串）。
     * @param {string} filePath
     * @param {number} maxChars
     * @returns {Promise<string>}
     * @private
     */
    static async _readFileBounded(filePath, maxChars) {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            if (raw.length <= maxChars) return raw;
            return `${raw.slice(0, maxChars)}\n\n…（原文共 ${raw.length} 字符，已截断）`;
        } catch {
            return '';
        }
    }

    /**
     * 把阶段产物写入黑板并广播。
     * @param {object} p
     * @private
     */
    async _publishStageArtifact({ stage, role, record, stepId, round }) {
        try {
            await this.blackboard.put({
                key: stage.produces,
                author: role.id,
                role: role.kind,
                stepId,
                round,
                artifacts: record.resultPath ? [record.resultPath] : [],
                value: {
                    stageId: stage.id,
                    sessionId: record.sessionId || '',
                    skillName: record.skillName || '',
                    resultPath: record.resultPath || '',
                    conclusion: record.metrics || null
                }
            });

            // 阶段产物另存一份按阶段 id 索引的引用，供"被评审阶段/下游阶段"精确取用
            await this.blackboard.put({
                key: `artifact:${stage.id}`,
                author: role.id,
                role: role.kind,
                stepId,
                round,
                artifacts: record.resultPath ? [record.resultPath] : [],
                value: { resultPath: record.resultPath || '', sessionId: record.sessionId || '' }
            });
        } catch (err) {
            this._log('warn', `写黑板失败（不影响执行）：${err.message}`);
        }

        await this._notify({
            from: role.id, to: BROADCAST, intent: MessageIntent.ARTIFACT_PUBLISHED,
            stepId, round,
            payload: { stageId: stage.id, key: stage.produces, resultPath: record.resultPath || '' },
            artifacts: record.resultPath ? [record.resultPath] : []
        });
    }

    /**
     * 解析阶段的结构化结论（来自 meta.json，见 `ROLE_META_CONTRACTS`）。
     *
     * 返回值刻意是**三态**而不是布尔："通过 / 不通过 / 不可解析"必须分开，
     * 否则"评审者没写结论文件"会被当成"通过"（危险）或"不通过"（浪费修订额度）。
     *
     * @param {object} stage
     * @param {object} role
     * @param {object} runResult
     * @returns {{parsed: boolean, approved: boolean|null, ok: boolean|null, raw: *, reasons: string[], missing: string[]}}
     * @private
     */
    _parseVerdict(stage, role, runResult) {
        const metrics = runResult.metrics;
        const contract = ROLE_META_CONTRACTS[role.kind] || ROLE_META_CONTRACTS[role.id];

        const reject = (missing) => ({
            parsed: false, approved: null, ok: null, raw: null, reasons: [], missing
        });

        if (!metrics || typeof metrics !== 'object') {
            return reject(contract?.required || ['<结构化结论文件>']);
        }
        if (!contract) {
            // 无结构化契约的角色不参与门禁判定（视为通过）
            return { parsed: true, approved: true, ok: true, raw: metrics, reasons: [], missing: [] };
        }

        const missing = contract.required.filter((k) => metrics[k] === undefined || metrics[k] === null);
        if (missing.length > 0) return reject(missing);

        const toReasons = (arr) => (Array.isArray(arr)
            ? arr.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim())
            : []);

        if (role.kind === 'reviewer') {
            const approved = metrics.approved === true || metrics.approved === 'true';
            return {
                parsed: true, approved, ok: approved, raw: metrics.approved,
                reasons: toReasons(metrics.reasons), missing: []
            };
        }

        if (role.kind === 'verifier') {
            const raw = metrics.verdict;
            const ok = raw === '通过' || raw === 'pass' || raw === true;
            return {
                parsed: true, approved: ok, ok, raw,
                reasons: toReasons(metrics.evidence), missing: []
            };
        }

        return { parsed: true, approved: true, ok: true, raw: metrics, reasons: [], missing: [] };
    }

    /**
     * 指定 SKILL 的策略处理。
     *
     * 默认 `collapse`：步骤显式指定了 SKILL 时，把计划收窄为**能使用该 SKILL 的那一个阶段**。
     * 理由：`specifiedSkill` 的语义是「本步骤就用这个 SKILL 干」（Phase 1 靠它省两次
     * LLM 调用并避免选错）；如果仍跑完整子图，一个指定了 SKILL 的步骤会额外产生
     * 3~4 个会话（规划/评审/验证），成本与耗时成倍上升，而收益不明确。
     * 需要保留完整协作时，把 `step.collaboration.onSpecifiedSkill` 设为 `'keep'`。
     *
     * 若该 SKILL 不属于任何阶段角色的能力范围，则**不收窄**——让 AgentRuntime 报
     * `skill_blocked` 给出可行动的归因，而不是静默丢掉指定。
     *
     * @param {CollaborationPlan} plan
     * @param {string} [specifiedSkill]
     * @returns {{effectivePlan: CollaborationPlan, skillRedirect: object|null}}
     * @private
     */
    _applySpecifiedSkillPolicy(plan, specifiedSkill) {
        if (!specifiedSkill || typeof specifiedSkill !== 'string' || !specifiedSkill.trim()) {
            return { effectivePlan: plan, skillRedirect: null };
        }
        if (plan.onSpecifiedSkill === 'keep' || !plan.allowSpecifiedSkillRedirect) {
            return { effectivePlan: plan, skillRedirect: null };
        }

        const skill = specifiedSkill.trim();
        const target = plan.stages.find((s) => this.registry.get(s.role)?.matchesSkill(skill));
        if (!target) {
            this._log('warn',
                `指定 SKILL "${skill}" 不属于计划 ${plan.id} 中任何角色的能力范围，保持完整协作计划`);
            return { effectivePlan: plan, skillRedirect: null };
        }

        return {
            effectivePlan: plan.collapseTo(target.id, `指定 SKILL ${skill}`),
            skillRedirect: {
                skill,
                from: plan.id,
                toStage: target.id,
                role: target.role,
                reason: `指定 SKILL "${skill}" 只能由角色 ${target.role} 使用，收窄为单阶段执行`
            }
        };
    }

    /**
     * 发送一条协作消息（失败不阻断执行，但一定会上报事件）。
     *
     * 为什么不抛错：协作消息是**协议记录 + 通知**，实际执行已由 AgentRuntime 完成。
     * 为了"记日志失败"把整个步骤判失败，会把可观测性问题降级成可用性问题。
     *
     * @param {object} input - `AgentMessage.create` 入参
     * @returns {Promise<object|null>}
     * @private
     */
    async _notify(input) {
        try {
            const r = await this.bus.send(input);
            return r.message;
        } catch (err) {
            this._log('warn', `协作消息投递失败（不影响执行）：${err.message}`);
            this._emit('orch:agent:message_failed', {
                from: input?.from, to: input?.to, intent: input?.intent, error: err.message
            });
            return null;
        }
    }

    /**
     * 请求-响应式协作（供 Phase 3/4 的交互式场景使用）。
     *
     * @param {object} input
     * @param {object} opts
     * @returns {Promise<object>} 应答消息
     * @throws {Error} 超时（`MessageBusTimeoutError`）
     */
    async ask(input, opts = {}) {
        return this.bus.request(input, opts);
    }

    /**
     * 中止协作：标记并中止所有在途角色会话。
     * @returns {Promise<number>} 已请求中止的运行时数量
     */
    async abort() {
        this._aborted = true;
        let n = 0;
        for (const rt of this._runtimes) {
            if (await rt.abort()) n++;
        }
        // 唤醒所有等待应答的请求，避免它们挂到超时
        await this.bus.close({ timeoutMs: 1000 }).catch(() => {});
        return n;
    }

    /**
     * 排空所有角色会话的在途后台任务（经验总结等）。
     * @param {object} [opts]
     * @returns {Promise<{drained: boolean, runtimes: number}>}
     */
    async drain(opts = {}) {
        const busResult = await this.bus.drain({ timeoutMs: opts.timeoutMs ?? 5000 });
        let drained = busResult.drained;
        for (const rt of this._runtimes) {
            const r = await rt.drain(opts);
            if (r?.drained === false) drained = false;
        }
        return { drained, runtimes: this._runtimes.length };
    }

    /**
     * 当前协作拓扑（前端「Agent 拓扑图」的数据源）。
     * @returns {object}
     */
    getTopology() {
        const plan = this._effectivePlan || this.plan;
        return {
            taskId: this.taskId,
            plan: plan.brief(),
            agents: this.listRoles(),
            topology: this.bus.deriveTopology({ agents: this.registry.ids() }),
            stageRuns: this._stageRuns.map((r) => ({ ...r }))
        };
    }

    /** @returns {object[]} 本注册表中各角色的摘要 */
    listRoles() {
        return this.registry.list().map((r) => r.brief());
    }

    /**
     * 本次运行创建的角色运行时列表。
     *
     * 公开出来是为了让 `MultiAgentRunner` 能取到"某个角色会话的适配器"以支持
     * live/session 详情查询，而不必穿透到私有字段（那会让内部重构随时破坏上层）。
     *
     * @returns {AgentRuntime[]}
     */
    getRuntimes() {
        return [...this._runtimes];
    }

    /**
     * 协作回放日志（可直接 JSON 化 / 交给前端）。
     * @param {number} [limit]
     * @returns {object[]}
     */
    getReplayLog(limit) {
        return this.bus.getReplayLog({ limit });
    }

    /**
     * 统计快照。
     * @returns {object}
     */
    getStats() {
        return {
            taskId: this.taskId,
            plan: this.plan.id,
            stageRuns: this._stageRuns.length,
            runtimes: this._runtimes.length,
            bus: this.bus.getStats(),
            blackboard: this.blackboard.getStats(),
            runtimesDetail: this._runtimes.map((rt) => rt.getStats())
        };
    }

    /**
     * @param {string} type
     * @param {object} data
     * @private
     */
    _emit(type, data) {
        if (this._onEvent) {
            try { this._onEvent(type, data); } catch { /* 事件回调异常不外溢 */ }
        }
    }

    /**
     * @param {string} level
     * @param {string} msg
     * @private
     */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[Supervisor|${this.taskId}] ${msg}`);
    }
}

export { CollaborationPlan, resolvePlan };
export default Supervisor;
