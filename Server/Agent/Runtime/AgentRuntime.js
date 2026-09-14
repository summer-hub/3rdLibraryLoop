/**
 * AgentRuntime —— 单角色执行器（Phase 2）
 *
 * 定位：
 *   Phase 1 的 `FlexRunner` 同时承担了「会话生命周期管理」与「步骤执行」两件事。
 *   Phase 2 需要把「一步 = 一个会话」升级为「一步 = 一组有角色的会话」，
 *   于是把**角色化执行**抽到本类，而 `FlexRunner` **原样保留**为
 *   「单角色（无角色）会话执行器」——即本类的默认 `sessionAdapter`（兼容层）。
 *
 *   这样做而不是把 FlexRunner 改造成多角色，有三个具体理由：
 *     1. **Phase 1 的 389 条断言全部基于 FlexRunner 的现有语义**，改造它等于
 *        同时改行为与改测试，回归风险无法收敛；
 *     2. FlexRunner 里大量逻辑（SKILL 匹配、result.md 解析、meta.json 收割、
 *        经验总结)对**每个角色都是需要的**——重写一遍只会得到两个会各自漂移的实现；
 *     3. 「兼容层」是可删除的：Phase 2 稳定后若要让 FlexRunner 退场，
 *        只需换掉 `runnerFactory`，本类与上层零改动。
 *
 *   因此本类的职责被刻意收窄为四件事：
 *     1. **并发准入**：为本次角色会话取得一个 Session 槽位（有超时，绝不无限等待）；
 *     2. **上下文组装**：把「角色指令 + 黑板现状 + 驳回原因 + 产物清单 + 输出契约」
 *        合成为该角色的 prompt（见 `AgentRole.buildSystemPrompt`）；
 *     3. **SKILL 准入**：按角色的 `skillPolicy` 计算可用 SKILL 名单并下传，
 *        越权 SKILL 一律降级为无 SKILL 模式（见 FlexRunner 的 `skillAllowList`）；
 *     4. **结果归一**：把 sessionAdapter 的返回值统一成协作层可消费的形状
 *        （成功/失败、产物路径、结构化结论、SKILL 名、错误原因）。
 *
 * ## 并发模型（与 Phase 1 的 F-07 完全一致，只是按角色展开）
 *
 * ```
 * Orchestrator._executeNode
 *   └─ MultiAgentRunner.executeStart           ← managesOwnConcurrency = true
 *        └─ Supervisor.run                     （角色子图驱动）
 *             ├─ AgentRuntime(planner).run()   ← 取槽位 → executeStart → 释放
 *             ├─ AgentRuntime(coder).run()     ← 取槽位 → executeStart → 释放
 *             └─ AgentRuntime(reviewer).run()  ← 取槽位 → executeStart → 释放
 * ```
 *   - 每个角色会话各占一个槽位，**总并发会话数仍然 ≤ 全局上限**，不会因为
 *     "一步里跑 3 个角色"就变成 3 倍超发；
 *   - 经验总结（FlexRunner 的后台任务）复用同一 session，FlexRunner 会**自行再取
 *     一个槽位**（F-07），因此它也被计入上限；
 *   - 因此 `MultiAgentRunner` 声明 `managesOwnConcurrency = true`，
 *     让 Orchestrator **不再为该步骤预占槽位**——否则「一步一个槽位」+
 *     「每个角色一个槽位」会导致槽位被重复占用，实际可用并发腰斩。
 *
 * ## 失败语义（为什么"失败"要分这么多类）
 *
 * 角色失败的原因决定了 Supervisor 该怎么反应，混成一个 `false` 会让协作层
 * 只能"重试"，而重试对其中大多数原因是无效的：
 *
 * | `failureKind` | 含义 | 协作层的合理反应 |
 * |---|---|---|
 * | `null` | 成功 | 继续 |
 * | `slot_timeout` | 没等到并发槽位（系统过载） | **不消耗重做轮次**，稍后重试 |
 * | `session_error` | 会话创建/轮询/解析失败 | 可重试 1 次 |
 * | `role_failed` | 角色自己判定失败（`## 执行状态: 失败`） | 进入重做或终止 |
 * | `skill_blocked` | 计划的 SKILL 越出角色能力边界 | **不重试**，这是计划缺陷 |
 * | `timeout` | 超过角色 `timeoutMs` | 终止或降级 |
 *
 * @example
 * const rt = new AgentRuntime({ role, taskId: 't1', sessionSemaphore: sem });
 * const res = await rt.run({
 *   stepId: 1, round: 0, taskDescription: '检查 libcurl 鸿蒙化可行性',
 *   context: { feedback: '上一轮缺少错误分支分析' }
 * });
 * if (res.success) console.log(res.resultPath);
 */

import path from 'node:path';

import { nowCST } from '../../library/cstTime.js';
import { AgentRole } from '../Roles/AgentRole.js';
import { MessageIntent } from '../Messaging/AgentMessage.js';

/** 默认会话槽位等待超时（ms）。与 Orchestrator 的 `DEFAULT_ACQUIRE_TIMEOUT_MS` 保持一致。 */
export const DEFAULT_SLOT_TIMEOUT_MS = 15 * 60 * 1000;
/** 读取 result 文本时的默认字符上限（避免把整份长报告塞进内存与日志） */
export const DEFAULT_RESULT_READ_LIMIT = 20000;

/**
 * 各角色的**结构化结论契约**（写入 Phase 1 既有的 meta.json 旁车文件）。
 *
 * 复用 meta.json 而不是新造解析规则的理由：FlexRunner 已有完整链路
 * （prompt 中下发路径 → `_harvestMetrics` 校验 → 原样透传到 Orchestrator/SSE/持久化），
 * 新造一套会让"评审结论"和"步骤指标"走两条路，前端要写两套读取逻辑。
 *
 * 关键设计：评审/验证结论**必须是机器可判定的**（`approved: boolean`）。
 * 如果只让评审者输出自然语言，Supervisor 就只能靠关键词猜"这是通过还是不通过"——
 * 那是把协作的正确性押在文本匹配上，无法测试也无法解释。
 */
export const ROLE_META_CONTRACTS = Object.freeze({
    reviewer: {
        schema: '{"approved": true|false, "reasons": ["必须修改的具体项"], "suggestions": ["建议项（不作为驳回理由）"]}',
        required: ['approved'],
        description: '评审结论：approved=false 时必须给出可行动的 reasons'
    },
    verifier: {
        schema: '{"verdict": "通过|不通过|无法验证", "evidence": ["执行的命令与原始输出片段"]}',
        required: ['verdict'],
        description: '验证结论：verdict 必须是三个值之一，evidence 必须含实际命令'
    },
    planner: {
        schema: '{"subtasks": [{"goal": "做什么", "output": "产出文件", "verify": "如何验证"}], "risks": ["前置条件"]}',
        required: ['subtasks'],
        description: '计划：子任务必须是有序数组，每项含 goal/output/verify'
    },
    retriever: {
        schema: '{"findings": [{"fact": "结论", "source": "文件路径或规则编号"}], "hits": 0}',
        required: ['findings'],
        description: '检索结果：每条 fact 必须有 source；无命中时 findings 为空数组且 hits=0'
    },
    coder: {
        schema: '{"artifacts": ["产出文件相对路径"], "summary": "一句话说明完成了什么"}',
        required: ['artifacts'],
        description: '执行结果：artifacts 必须是实际落盘的文件路径'
    }
});

/**
 * 单个角色的执行器实例。
 *
 * **一个实例只执行一次 `run()`**（与 FlexRunner 的 `executeStart` 语义对齐）：
 * 复用实例会让 sessionId/resultPath 等状态互相覆盖，产生极难定位的错乱。
 * 需要多次执行就创建多个实例——实例本身很轻（只持有引用）。
 */
export class AgentRuntime {
    /**
     * @param {object} opts
     * @param {AgentRole|object} opts.role              - 角色定义（必填）
     * @param {string} opts.taskId                      - 任务 ID（必填）
     * @param {string} [opts.taskDir]                   - 任务目录
     * @param {string} [opts.skillDirectory]            - SKILL 根目录
     * @param {*} [opts.sessionSemaphore]               - Session 并发信号量（可选；缺省不限流）
     * @param {Function} [opts.runnerFactory]           - 会话适配器工厂（默认 `() => new FlexRunner()`）
     * @param {(level: string, msg: string) => void} [opts.logger]
     * @param {number} [opts.pollIntervalMs]
     * @param {string} [opts.mcpConfigPath]
     * @param {boolean} [opts.keepSessions]
     * @param {() => string} [opts.clock]
     */
    constructor(opts = {}) {
        if (!opts.taskId) throw new Error('AgentRuntime: taskId 为必填项');
        if (!opts.role) throw new Error('AgentRuntime: role 为必填项');

        /** @type {AgentRole} */
        this.role = opts.role instanceof AgentRole ? opts.role : AgentRole.fromJSON(opts.role);
        this.taskId = String(opts.taskId);
        this.taskDir = opts.taskDir ? path.resolve(opts.taskDir) : '';
        this.skillDirectory = opts.skillDirectory || '';
        this._semaphore = opts.sessionSemaphore || null;
        /**
         * @type {RoleLimiter|null} Phase 3：角色级（第三级）限流器。
         * 解决的是"**配比**"而不是"总量"：贵角色（如 coder，单次可达 90 分钟）
         * 会把廉价但关键的角色（reviewer/verifier）挤出槽位，
         * 表现为"实现产物堆着没人评审"。
         */
        this._roleLimiter = opts.roleLimiter || null;
        /**
         * @type {object|null} Phase 3：会话事件源（事件驱动替代轮询）。
         * 透传给会话适配器；未提供时由适配器自行轮询。
         */
        this._sessionEvents = opts.sessionEvents || null;
        /**
         * @type {AbortNode|AbortSignal|null} Phase 3：本角色会话所属的取消节点/信号。
         * 优先级：显式传入的 signal > 取消树节点 > 无。
         */
        this._abortNode = opts.abortNode || null;
        this._runnerFactory = typeof opts.runnerFactory === 'function' ? opts.runnerFactory : null;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        this._pollIntervalMs = opts.pollIntervalMs;
        this._mcpConfigPath = opts.mcpConfigPath;
        this._keepSessions = opts.keepSessions === true;
        this._clock = typeof opts.clock === 'function' ? opts.clock : nowCST;

        /** @type {*} 当前会话适配器（FlexRunner） */
        this._adapter = null;

        /** @type {object|null} 上次 `run()` 的结果 */
        this._lastResult = null;

        this._stats = { runs: 0, slotWaits: 0, slotTimeouts: 0, slotWaitedMs: 0 };
    }

    /** @returns {string} 角色 id */
    get roleId() {
        return this.role.id;
    }

    /** @returns {string} 当前会话 id（未创建时为空串） */
    get sessionId() {
        return this._adapter?.sessionId || '';
    }

    /** @returns {string} 本次实际使用的 SKILL 名（空串 = 无 SKILL 模式） */
    get usedSkillName() {
        return this._adapter?.usedSkillName || '';
    }

    /** @returns {object|null} 上次执行结果 */
    get lastResult() {
        return this._lastResult;
    }

    /**
     * 执行一次角色会话。
     *
     * @param {object} input
     * @param {number} input.stepId                    - 所属编排步骤（必填）
     * @param {string} input.taskDescription           - 交给本角色的任务描述（必填）
     * @param {number} [input.round=0]                 - 协作轮次
     * @param {number} [input.bigLoopIndex=0]          - 大循环索引
     * @param {number} [input.attempt=0]               - 本角色内的重试序号（影响产物文件名）
     * @param {string} [input.specifiedSkill]          - 指定 SKILL（会按角色策略准入）
     * @param {string} [input.inputReport]             - 输入报告路径
     * @param {object} [input.context]                 - 角色上下文
     * @param {string} [input.context.blackboard]      - 黑板摘要（`Blackboard.snapshotForPrompt().text`）
     * @param {string} [input.context.artifacts]       - 需关注的产物（已格式化的文本）
     * @param {string} [input.context.feedback]        - 上一轮驳回原因
     * @param {string} [input.context.role]            - 本次职责描述
     * @param {string} [input.context.outputContract]  - 覆盖默认输出契约
     * @param {(sessionId: string) => void} [input.onSessionCreated]
     * @param {AbortSignal} [input.signal]             - 取消信号（透传给会话适配器）
     * @param {number} [input.slotTimeoutMs]           - 槽位等待超时
     * @param {number} [input.timeoutMs]               - 覆盖角色 `timeoutMs`
     * @returns {Promise<object>} 归一化结果（见类文档的 failureKind 表）
     */
    async run(input = {}) {
        const {
            stepId, taskDescription, round = 0, bigLoopIndex = 0, attempt = 0,
            specifiedSkill, inputReport, context = {}, onSessionCreated, signal
        } = input;

        if (!Number.isInteger(Number(stepId)) || Number(stepId) <= 0) {
            throw new Error(`AgentRuntime(${this.roleId}).run: stepId 必须为正整数`);
        }
        if (typeof taskDescription !== 'string' || taskDescription.trim() === '') {
            throw new Error(`AgentRuntime(${this.roleId}).run: taskDescription 不能为空`);
        }

        const startedAt = this._clock();
        const t0 = Date.now();
        this._stats.runs++;
        this._stepId = Number(stepId);

        // ── 1. SKILL 准入：计算本角色可用名单 ──
        // 由角色策略计算，而不是信任调用方传入——否则"角色越权"变成调用方的责任，
        // 而调用方（Supervisor）本来就可能因为计划本身有问题而传错。
        const skillAllowList = this._computeSkillAllowList();

        // 指定了 SKILL 但越出角色边界 → 不创建会话，直接判定 skill_blocked。
        // 这一步刻意在**取槽位之前**：明知会失败的会话不应该占用并发资源。
        if (specifiedSkill && skillAllowList && !skillAllowList.includes(String(specifiedSkill).trim())) {
            return this._fail(startedAt, 'skill_blocked',
                `指定的 SKILL "${specifiedSkill}" 不在角色 ${this.roleId} 的可用范围内`, { suggestNoRetry: true });
        }

        // ── 2. 组装角色上下文与 prompt ──
        const outputContract = context.outputContract || this._buildOutputContract();
        const rolePrompt = this.role.buildSystemPrompt({
            role: context.role,
            blackboard: context.blackboard,
            artifacts: context.artifacts,
            feedback: context.feedback,
            round,
            outputContract
        });

        // ── 3. 并发准入（**三级**：角色 → 全局）──
        // 顺序固定为「角色槽位 → 全局槽位」，释放顺序相反。所有参与者遵守**同一顺序**，
        // 因此不可能出现循环等待（"我持 A 等 B、你持 B 等 A"）。
        // 反过来（先全球后角色）会让全局——最稀缺的资源——被"空等角色槽位"占用，
        // 是纯粹的浪费。test/m6-phase3 有饱和用例专门守护这个顺序。
        return this._runWithSlots(input, startedAt, t0, {
            stepId, taskDescription, round, bigLoopIndex, attempt,
            specifiedSkill, skillAllowList, inputReport, rolePrompt,
            onSessionCreated, signal
        });
    }

    /**
     * 三级槽位获取 + 执行 + 释放（从 `run()` 抽出，避免层层嵌套缩进）。
     *
     * @param {object} input - 原始入参（仅用于读取 slotTimeoutMs）
     * @param {string} startedAt
     * @param {number} t0
     * @param {object} p - 执行参数
     * @returns {Promise<object>}
     * @private
     */
    async _runWithSlots(input, startedAt, t0, p) {
        const { stepId, taskDescription, round, bigLoopIndex, attempt,
            specifiedSkill, skillAllowList, inputReport, rolePrompt, onSessionCreated, signal } = p;

        // 已取消 → 不取槽位、不建会话，直接返回可归因结果。
        // 两个理由：① 明知会被立即取消的会话不该占用稀缺的并发槽位；
        // ② 否则每个"取消后才轮到"的角色会话都要等它自己的超时/轮询周期，
        //    让一次取消的收尾时间与剩余角色数成正比（实测会把 abortAndWait 拖超时）。
        if (signal?.aborted || this._abortNode?.aborted) {
            return this._fail(startedAt, 'aborted',
                `协作已取消（${this._abortNode?.reason || '信号已中止'}），未创建会话`);
        }

        // ① 角色槽位
        let roleLease = null;
        if (this._roleLimiter && this._roleLimiter.limitOf(this.roleId) > 0) {
            roleLease = await this._roleLimiter.acquire(this.roleId, { timeoutMs: input.slotTimeoutMs });
            if (!roleLease.ok) {
                return this._fail(startedAt, 'slot_timeout',
                    `等待角色 ${this.roleId} 的并发槽位超时（${roleLease.waitedMs}ms，` +
                    `active=${this._roleLimiter.activeTotal}）`, { slotWaitedMs: roleLease.waitedMs });
            }
        }

        // ② 全局槽位（在 finally 中与角色槽位一起按相反顺序释放）
        let sem;
        try {
            sem = await this._acquireSlot(input.slotTimeoutMs, stepId);
        } catch (err) {
            roleLease?.release();
            throw err;
        }
        if (!sem.ok) {
            roleLease?.release();
            this._stats.slotTimeouts++;
            return this._fail(startedAt, 'slot_timeout',
                `等待 Session 并发槽位超时（${sem.waitedMs}ms）`,
                { slotWaitedMs: sem.waitedMs, roleWaitedMs: roleLease?.waitedMs ?? 0 });
        }

        let result;
        try {
            result = await this._runWithAdapter({
                stepId, taskDescription, round, bigLoopIndex, attempt,
                specifiedSkill, skillAllowList, inputReport, rolePrompt, onSessionCreated, signal,
                timeoutMs: input.timeoutMs
            });
        } finally {
            // 释放顺序与获取顺序**相反**（全局先放、角色后放）
            sem.release();
            roleLease?.release();
        }

        const endedAt = this._clock();
        const base = {
            role: this.roleId,
            roleKind: this.role.kind,
            stepId: Number(stepId),
            round,
            startedAt,
            endedAt,
            durationMs: Date.now() - t0,
            slotWaitedMs: sem.waitedMs,
            roleWaitedMs: roleLease?.waitedMs ?? 0,
            sessionId: this.sessionId
        };

        this._lastResult = { ...base, ...result };
        if (this._lastResult.ok && this._lastResult.success) {
            this._log('info',
                `角色 ${this.roleId} 完成 — stepId=${stepId} round=${round} ` +
                `skill=${this._lastResult.skillName || '(无)'} duration=${base.durationMs}ms`);
        }
        return this._lastResult;
    }

    /**
     * 计算本角色的 SKILL 准入名单。
     *
     * 需要**实际扫描** SKILL 目录才能判断越权：角色的策略是模式（`arkts-*`），
     * 而准入校验需要具体名字。扫描失败时返回 `null`（不限制）并 warn——
     * 宁可放宽（Phase 1 行为）也不要因为一个 IO 失败让所有角色无法执行。
     *
     * @returns {Promise<string[]>} 同步返回（已缓存）；首次调用为同步扫描结果
     * @private
     */
    _computeSkillAllowList() {
        if (this.role.skillPolicy.mode === 'inherit') return null;
        if (this.role.skillPolicy.mode === 'none') return [];

        // 优先使用调用方显式注入的名单（Supervisor 会一次性扫描后复用，避免每个角色都扫盘）
        if (Array.isArray(this._skillAllowListOverride)) return this._skillAllowListOverride;
        if (Array.isArray(this._knownSkillNames)) {
            return this._knownSkillNames.filter((n) => this.role.matchesSkill(n));
        }
        // 没有已知名单时返回 []（等价于"不使用 SKILL"）而不是 null（不限制）：
        // 在"角色边界"与"能力可用性"之间，前者是正确性、后者是性能，取正确性。
        this._log('warn',
            `角色 ${this.roleId} 需要 SKILL 准入名单但未注入已知 SKILL 列表，` +
            `本次将以无 SKILL 模式执行（请通过 options.knownSkillNames 注入）`);
        return [];
    }

    /**
     * 注入已知 SKILL 名单（供准入校验）。Supervisor 扫描一次后共享给所有角色。
     * @param {string[]} names
     * @returns {this}
     */
    withKnownSkills(names) {
        this._knownSkillNames = Array.isArray(names) ? [...names] : null;
        return this;
    }

    /**
     * 直接覆盖准入名单（测试用）。
     * @param {string[]|null} list
     * @returns {this}
     */
    withSkillAllowList(list) {
        this._skillAllowListOverride = Array.isArray(list) ? [...list] : null;
        return this;
    }

    /**
     * 生成角色的输出契约文本：默认契约 + 结构化 meta 契约（若有）。
     * @returns {string}
     * @private
     */
    _buildOutputContract() {
        const base = this.role.defaultOutputContract();
        const meta = ROLE_META_CONTRACTS[this.role.kind] || ROLE_META_CONTRACTS[this.role.id];
        if (!meta) return base;

        return [
            base,
            '',
            `### 结构化结论（必须写入 prompt 中给出的「结构化指标文件输出路径」）`,
            `本次角色有机器可解析的结论要求，请把结论以 JSON 对象写入该路径：`,
            '```json',
            meta.schema,
            '```',
            `说明：${meta.description}`,
            `必需字段：${meta.required.join('、')}。`,
            '该文件缺失或字段缺失会被上游视为**结论不可解析**，进而要求你重做——',
            '因此写自然语言的总结**不能替代**这个 JSON 文件。'
        ].join('\n');
    }

    /**
     * 取得一个 Session 并发槽位。
     *
     * 未注入信号量时返回一个**空租约**（不限流，Phase 1 行为）。
     * 超时必须存在：没有超时时任何一个僵死角色会永久占住槽位，
     * 累计到上限后整个进程的所有任务一起饿死（F-06 的结论，此处按角色沿用）。
     *
     * @param {number} [timeoutMs]
     * @param {number} stepId
     * @returns {Promise<{ok: boolean, waitedMs: number, release: () => void}>}
     * @private
     */
    async _acquireSlot(timeoutMs, stepId) {
        if (!this._semaphore) {
            return { ok: true, waitedMs: 0, release() {} };
        }
        const envTimeout = Number(process.env.SEMAPHORE_ACQUIRE_TIMEOUT_MS);
        const effective = Number.isFinite(timeoutMs) && timeoutMs >= 0
            ? timeoutMs
            : (Number.isFinite(envTimeout) && envTimeout >= 0 ? envTimeout : DEFAULT_SLOT_TIMEOUT_MS);

        this._stats.slotWaits++;
        const sem = await this._semaphore.acquire({ timeoutMs: effective, key: this.taskId });
        this._stats.slotWaitedMs += sem.waitedMs || 0;

        if (sem.ok && sem.waitedMs > 100) {
            this._log('info',
                `角色 ${this.roleId} 步骤 ${stepId} 等待槽位 ${sem.waitedMs}ms` +
                `（active=${this._semaphore.active}/${this._semaphore.limit}）`);
        }
        return sem;
    }

    /**
     * 通过会话适配器执行一次会话。
     *
     * 适配器（默认 FlexRunner）的契约：
     *   `initContext({...})` → `executeStart()` → `{resultPath, success, nextStepId, metrics}`
     *   可选：`setAbortSignal(signal)` / `drainBackgroundTasks()`
     *
     * @param {object} p
     * @returns {Promise<object>} 归一化结果
     * @private
     */
    async _runWithAdapter(p) {
        const Adapter = await this._resolveAdapterFactory();

        let adapter;
        try {
            adapter = await Adapter();
        } catch (err) {
            return { ok: false, failureKind: 'session_error', success: false, error: `创建会话适配器失败: ${err.message}` };
        }
        this._adapter = adapter;

        try {
            await adapter.initContext({
                taskId: this.taskId,
                stepId: Number(p.stepId),
                taskDir: this.taskDir || undefined,
                skillDirectory: this.skillDirectory,
                specifiedSkill: p.specifiedSkill,
                taskDescription: p.taskDescription,
                inputReport: p.inputReport,
                bigLoopIndex: p.bigLoopIndex,
                // Phase 2：本角色内的第几次尝试，决定产物文件名的 loopCount 段。
                // 必须传下去——否则同一角色的多次重做会覆盖同一份结果文件，
                // "Reviewer 对比改前/改后"这一协作语义就无从成立。
                initialExecuteStep: p.attempt,
                // Phase 2 角色化参数（缺省时 FlexRunner 行为与 Phase 1 一致）
                roleId: this.roleId,
                rolePrompt: p.rolePrompt,
                skillAllowList: p.skillAllowList,
                // F-07 语义按角色沿用：经验总结复用同一 session，自行再取一个槽位
                sessionSemaphore: this._semaphore,
                keepSessions: this._keepSessions,
                pollIntervalMs: this._pollIntervalMs,
                mcpConfigPath: this._mcpConfigPath,
                // Phase 3：事件驱动替代轮询（未提供时适配器自行轮询）
                sessionEvents: this._sessionEvents,
                onSessionCreated: p.onSessionCreated
            });

            // Phase 3：取消信号 —— **两路取并集**，而不是"有谁用谁"。
            //
            // 这里踩过一个真实的坑：早先写成 `p.signal || this._abortNode?.signal`，
            // 于是"运行器级信号"（MultiAgentRunner 自己的 AbortController）
            // 存在时就把取消树的信号**屏蔽掉了**。后果是：
            // `Orchestrator.abort()` 的级联取消走的是取消树，而会话拿到的却是
            // 那个没人取消的信号 —— 表现为"编排层报告已取消，角色会话仍在跑"。
            // 用 AbortSignal.any 合并后，任一来源取消都会真正中断会话。
            const signals = [p.signal, this._abortNode?.signal].filter((s) => s && typeof s === 'object');
            let abortSignal = null;
            if (signals.length === 1) {
                abortSignal = signals[0];
            } else if (signals.length > 1) {
                abortSignal = typeof AbortSignal.any === 'function'
                    ? AbortSignal.any(signals)
                    // AbortSignal.any 需要 Node ≥20；不可用时优先用取消树信号
                    // （它才是级联取消的载体，比运行器级信号更精确）
                    : (this._abortNode?.signal || signals[0]);
            }

            if (abortSignal && typeof adapter.setAbortSignal === 'function') {
                adapter.setAbortSignal(abortSignal);
            } else if (this._abortNode && typeof adapter.setAbortSignal !== 'function') {
                this._log('debug', `角色 ${this.roleId} 的会话适配器不支持取消信号，降级为轮询式终止检查`);
            }
        } catch (err) {
            return { ok: false, failureKind: 'session_error', success: false, error: `初始化会话上下文失败: ${err.message}` };
        }

        let raw;
        try {
            raw = await this._withTimeout(adapter.executeStart(), p.timeoutMs, () => {
                // 超时后必须真正中止会话，否则远端会继续跑完并消耗额度
                adapter.controlExecution?.('abort')?.catch?.(() => {});
            });
        } catch (err) {
            if (err?.code === 'AGENT_ROLE_TIMEOUT') {
                return {
                    ok: false, failureKind: 'timeout', success: false,
                    sessionId: this.sessionId, error: err.message
                };
            }
            return {
                ok: false, failureKind: 'session_error', success: false,
                sessionId: this.sessionId, error: `会话执行异常: ${err.message}`
            };
        }

        const success = raw?.success === true;
        return {
            ok: true,
            success,
            failureKind: success ? null : 'role_failed',
            resultPath: raw?.resultPath || '',
            sessionId: this.sessionId,
            skillName: this.usedSkillName,
            metrics: raw?.metrics || null,
            // 角色自己判定失败时也带出错误位置，便于 Supervisor 归因
            error: success ? null : (adapter.resultPath ? `角色判定失败：${adapter.resultPath}` : '角色未产出结果文件')
        };
    }

    /**
     * 解析会话适配器工厂。
     *
     * 默认惰性加载 FlexRunner：注入 mock 的测试路径**不会**加载
     * `@opencode-ai/sdk` / `openai` 等重依赖（与 FlexRunner 自身的惰性加载一致）。
     *
     * @returns {Promise<() => Promise<*>>}
     * @private
     */
    async _resolveAdapterFactory() {
        if (this._runnerFactory) return this._runnerFactory;
        const mod = await import('../../FlexRunner/FlexRunner.js');
        this._runnerFactory = async () => {
            const runner = new mod.FlexRunner();
            return runner;
        };
        return this._runnerFactory;
    }

    /**
     * 给 promise 加超时（`timeoutMs` 为 falsy 时不加）。
     * @template T
     * @param {Promise<T>} promise
     * @param {number} [timeoutMs]
     * @param {() => void} [onTimeout]
     * @returns {Promise<T>}
     * @private
     */
    async _withTimeout(promise, timeoutMs, onTimeout) {
        const effective = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.role.timeoutMs;
        if (!Number.isFinite(effective) || effective <= 0) return promise;

        let timer = null;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        try { onTimeout?.(); } catch { /* 超时回调自身异常不外溢 */ }
                        const err = new Error(`角色 ${this.roleId} 执行超时（${effective}ms）`);
                        err.code = 'AGENT_ROLE_TIMEOUT';
                        reject(err);
                    }, effective);
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * 构造失败结果（统一形状）。
     * @param {string} startedAt
     * @param {string} failureKind
     * @param {string} error
     * @param {object} [extra]
     * @returns {object}
     * @private
     */
    _fail(startedAt, failureKind, error, extra = {}) {
        this._log('warn', `角色 ${this.roleId} 失败（${failureKind}）：${error}`);
        this._lastResult = {
            ok: false,
            success: false,
            role: this.roleId,
            roleKind: this.role.kind,
            failureKind,
            error,
            resultPath: '',
            sessionId: this.sessionId,
            skillName: this.usedSkillName,
            metrics: null,
            startedAt,
            endedAt: this._clock(),
            ...extra
        };
        return this._lastResult;
    }

    /**
     * 读取结果产物正文（有界）。
     *
     * 协作层需要正文来构造"下一步该知道什么"的上下文，但整份报告可能上千行。
     * 因此**默认截断**并在返回值里带上 `truncated` 标记——静默截断会让 LLM
     * 以为"这就是全部"，从而基于不完整信息做判断。
     *
     * @param {object} [opts]
     * @param {string} [opts.resultPath] - 缺省用上次结果
     * @param {number} [opts.maxChars]
     * @returns {Promise<{text: string, chars: number, truncated: boolean, missing: boolean}>}
     */
    async readResultText(opts = {}) {
        const relOrAbs = opts.resultPath || this._lastResult?.resultPath;
        if (!relOrAbs) return { text: '', chars: 0, truncated: false, missing: true };
        const maxChars = Number.isInteger(opts.maxChars) && opts.maxChars > 0
            ? opts.maxChars
            : DEFAULT_RESULT_READ_LIMIT;

        const fs = await import('node:fs/promises');
        let raw;
        try {
            raw = await fs.readFile(relOrAbs, 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT') return { text: '', chars: 0, truncated: false, missing: true };
            throw err;
        }
        const truncated = raw.length > maxChars;
        const text = truncated ? `${raw.slice(0, maxChars)}\n\n…（正文共 ${raw.length} 字符，已截断）` : raw;
        return { text, chars: raw.length, truncated, missing: false };
    }

    /**
     * 请求中止本次会话（协作层收到取消信号时调用）。
     * @returns {Promise<boolean>}
     */
    async abort() {
        if (!this._adapter) return false;
        try {
            await this._adapter.controlExecution?.('abort');
            return true;
        } catch (err) {
            this._log('warn', `角色 ${this.roleId} 中止失败：${err.message}`);
            return false;
        }
    }

    /**
     * 排空本角色会话的在途后台任务（经验总结等），供 Supervisor 停机时调用。
     * @param {object} [opts]
     * @returns {Promise<object>}
     */
    async drain(opts = {}) {
        if (typeof this._adapter?.drainBackgroundTasks !== 'function') {
            return { drained: true, skipped: true };
        }
        return this._adapter.drainBackgroundTasks(opts);
    }

    /**
     * 统计快照。
     * @returns {object}
     */
    getStats() {
        return {
            roleId: this.roleId,
            roleKind: this.role.kind,
            ...this._stats,
            avgSlotWaitedMs: this._stats.slotWaits ? Math.round(this._stats.slotWaitedMs / this._stats.slotWaits) : 0,
            sessionId: this.sessionId,
            usedSkillName: this.usedSkillName
        };
    }

    /**
     * 摘要（SSE / 前端拓扑图）。
     * @returns {object}
     */
    brief() {
        return {
            role: this.roleId,
            roleKind: this.role.kind,
            displayName: this.role.displayName,
            sessionId: this.sessionId,
            usedSkillName: this.usedSkillName,
            success: this._lastResult?.success ?? null,
            failureKind: this._lastResult?.failureKind ?? null,
            durationMs: this._lastResult?.durationMs ?? null
        };
    }

    /**
     * @param {string} level
     * @param {string} msg
     * @private
     */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[step${this._stepId ?? ''}|${this.roleId}] ${msg}`);
    }
}

export { MessageIntent };
export default AgentRuntime;
