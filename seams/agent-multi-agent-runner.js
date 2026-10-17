/**
 * seams/agent-multi-agent-runner.js — 多 Agent 运行器（FlexRunner 适配层）契约
 *
 * Provider：`plugins/agent/core`（`setup` 内 `ctx.provide('agent-multi-agent-runner', MultiAgentRunner)`）。
 * Consumer：`plugins/engines/orchestrator`（`lib/fallbacks.js` 的 `multi-agent-runner` 名；
 *           调用形状是 `multiAgentRunnerFactory: async () => new MultiAgentRunner({...})`，
 *           以及 `test/m5-phase2/f35`、`test/m6-phase3/f37/f38/f42` 的
 *           `new MultiAgentRunner({ enabled: true, plan: 'single' })`）。
 *
 * 服务形状：**类**（`factory: false`）—— 一次步骤执行的全部上下文（`taskId` / `stepId` /
 * `_stepConfig` / `_collabPlan` / `_supervisor` / `_abortController`）都是**每实例状态**，
 * 而且方法序列是**有状态协议**：必须先 `initContext()` 才能 `executeStart()`，`initContext`
 * 只能成功一次式地收下一份步骤配置。注册单例等于让第 2 个步骤复用第 1 个步骤的
 * `stepId` 与取消控制器 —— 直接错乱。注册工厂则会强迫调用方多包一层
 * `new (inject(...))()`，而既有调用点全是 `new`。
 *
 * 为什么这条接缝描述的是"**Runner 契约**"而不是"多 Agent 能力"：`MultiAgentRunner` 的存在
 * 意义就是**伪装成 `FlexRunner`**，让 Orchestrator 的 `_createFlexRunner` / `_executeNode` /
 * `_runnerBrief` / `abortAndWait` / `updateStepConfig` 一行都不用改。因此它的成员面就是
 * Orchestrator 读的那一份（见下 `methods` / `properties`），多 Agent 的语义（角色子图、
 * 计划、修订轮次、协作拓扑）藏在 `executeStart()` 内部与那两个扩展查询方法里。
 *
 * 实例成员清单从真实实现（`plugins/agent/core/Supervisor/MultiAgentRunner.js`）推导。
 * `__supervisor` / `_primaryRuntime` / `_emit` / `_log` / `_ensureInitialized` 是私有实现，
 * 不进契约；`getAgentTopology` / `getCollaborationSummary` / `getReplayLog` 是**扩展**查询
 * （前端的 Agent 拓扑图、持久化摘要、回放），它们是公开的，因此进契约。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3）。
 */

export const AGENT_MULTI_AGENT_RUNNER_SEAM = Object.freeze({
    name: 'agent-multi-agent-runner',
    version: 1,
    factory: false,
    description:
        '面向 Orchestrator 的多 Agent 运行器适配层：把一个步骤展开成"角色子图"（按协作计划' +
        '依次/并行跑角色会话 + 评审门 + 修订轮次），对外暴露 FlexRunner 形状',
    /**
     * 构造入参：**全部可选**，因此声明为空数组（`new MultiAgentRunner({})` 必须成功，
     * 默认 `enabled=false`、`defaultPlanName` 读 `MULTI_AGENT_PLAN`）。具体键：
     *   - `enabled`：覆盖 `MULTI_AGENT_ENABLED`（默认关闭，渐进启用）
     *   - `plan`：默认协作计划（**名字或 `CollaborationPlan` 实例**，实例优先）
     *   - `forceFullPlan`：即使步骤指定了 SKILL 也不收窄计划
     *   - `registry`：`RoleRegistry`（默认 `defaultRoleRegistry.clone()`）
     *   - `runnerFactory` / `sessionSemaphore` / `roleLimiter` / `sessionEvents` /
     *     `abortTree` / `taskAbortNode`：协作方（全部透传给 `Supervisor`/`AgentRuntime`）
     *   - `onEvent` / `logger` / `clock` / `maxGateRetries`：诊断与时钟
     * 这些都是"调用方配置 + 协作方注入"，不属于跨提供方契约；m9 用 `new MultiAgentRunner({})`
     * 真构造一次。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法（`scanSkillNames` 是静态方法，从类本身上取） */
    methods: Object.freeze([
        'initContext', // async ({taskId, stepId, ...}) => void（stepId 必须为正整数；缺 taskId/stepId 即抛）
        'scanSkillNames', // static async (skillDirectory) => string[]（扫描失败返回 []，降级为"无 SKILL 模式"）
        'setAbortSignal', // (AbortSignal) => void（外部取消源**转发**到内部 AbortController）
        'executeStart', // async () => { resultPath, success, nextStepId, metrics }（与 FlexRunner 返回值同构）
        'canRetry', // () => boolean（已终止或已达 maxRetries 时为 false）
        'controlExecution', // async ('abort'|'pause'|'resume') => boolean（pause/resume 只在阶段边界生效）
        'abortInFlight', // () => boolean（中止在途 HTTP）
        'drainBackgroundTasks', // async (timeoutMs?) => { drained, runtimes }
        'getLiveMessages', // async () => Array（步骤详情"live"视图，按主阶段会话返回）
        'getSessionContent', // async () => string（步骤详情"session"视图）
        'getAgentTopology', // () => object|null（前端 Agent 拓扑图）
        'getCollaborationSummary', // () => object|null（持久化 / SSE 用的协作摘要）
        'getReplayLog', // (limit?) => object[]（协作回放日志）
        'getStats', // () => object（含 cancel-tree 节点状态与 Supervisor 统计）
    ]),
    /**
     * 产物上的属性：Orchestrator 的 `_runnerBrief` 直读这些做进度展示，
     * `_executeNode` 直读 `managesOwnConcurrency` 决定"是否为该步骤预占槽位"。
     *
     * `managesOwnConcurrency` 必须在**声明式**位置（属性而非方法）：Orchestrator 以属性
     * 访问读取它，写成方法会让它读到函数对象（真值）从而"看起来一直开着"——语义恰好
     * 正确但原因错误，属于容易在重构中失守的巧合。
     */
    properties: Object.freeze([
        'managesOwnConcurrency', // true（本运行器自行管理会话并发，见 notes.concurrency）
        'initialized', // 取值器：initContext() 成功后为 true
        'taskId',
        'stepId',
        'bigLoopIndex',
        'executeStep',
        'retryTimes',
        'maxRetries',
        'sessionId',
        'startTime',
        'endTime',
        'resultPath',
        'metrics',
        'nextStepId',
    ]),
    /**
     * 本接缝**不声明** `constants`：类上没有状态常量表。
     *
     * 迁移前 `Supervisor` 导出的 `DEFAULT_MAX_GATE_RETRIES` 是模块级 number，
     * `CollaborationPlan` 的 `BUILTIN_PLANS` 属于另一条关注面（步骤内计划表，不是运行器
     * 状态机），且运行器的运行期状态本来就通过 `getStats()` 读取而不是常量表比较。
     * 为凑字段而挂常量属于编造契约，故留空（m9 在这里贡献 0 条断言）。
     */
    invariants: Object.freeze([
        'construct-never-throws-even-without-any-collaborator',
        'execute-before-init-throws-with-actionable-message',
        'manages-own-concurrency-declared-as-property',
        'execute-start-returns-flexrunner-shaped-exit',
        'step-abort-node-disposed-on-every-path-including-throw',
        'external-abort-signal-forwarded-to-internal-controller',
        'next-step-id-is-fail-step-on-failure',
        'collaboration-plan-instance-passed-through-without-narrowing-null',
    ]),
    notes: Object.freeze({
        concurrency:
            '`managesOwnConcurrency = true` 是**高并发正确性的关键**：一个步骤在 Phase 2 里会'
            + '产生 N 个角色会话（`thorough` 计划下最多 5 个）。若 Orchestrator 仍按 Phase 1 '
            + '的做法为每个步骤预占一个槽位，再加上每个角色各自取的槽位，就会出现"槽位被重复'
            + '占用"——表现为"把 MAX_CONCURRENT_SESSIONS 调到 50，实际只能跑十几个"。'
            + '声明之后 Orchestrator 不再为该步骤预占槽位，由每个 AgentRuntime 自行取一个，'
            + '全局会话并发始终受同一个信号量约束。',
        plan:
            '`initContext()` 必须把 `null` / `false` 与"显式给了计划"区分开：`StepNode` 会把'
            + '未配置的 `collaboration` 归一化为 `null`，Orchestrator 又原样传下来。若只判断'
            + '`!== undefined`，`null` 会被当成"显式指定"，于是走 `resolvePlan(null, name)` '
            + '落到默认**名字**，把构造时配置的计划实例（如 `thorough`）静默冲掉 —— '
            + '实测表现为"配了 5 阶段计划却只跑了 2 个阶段"。',
        cancel:
            '`setAbortSignal()` 保存的是 **AbortSignal**（`_externalAbortSignal`），并**转发**'
            + '到内部的 `_abortController`（AbortController）。早先直接把 `_abortController` '
            + '赋成 signal，于是 `.signal` 为 undefined、`.abort()` 是静默 no-op，'
            + '`abortInFlight()` 形同虚设。',
        failure:
            '`supervisor.init()` 与 `supervisor.run()` 必须处在同一个 try 内：`init()` 抛错'
            + '（计划引用了未注册角色、taskDir 创建失败等）时 finally 才不会漏掉 —— '
            + '否则取消树留下永久孤儿节点、`_running` 卡在 true。孤儿数正是判断会话泄漏的'
            + '核心指标，代码自己制造孤儿会让这个指标失去意义。',
        degradation:
            'SKILL 扫描失败（目录不存在）返回空数组并降级为"无 SKILL 模式"，而不是让整个'
            + '步骤无法启动 —— 降级可见、可控。',
        siblings:
            '同一插件（`plugins/agent/core`）同时提供 `agent-skill-selector`（主能力，'
            + '写在 `plugin.json` 的 `seam` 字段）与 `agent-role-limiter`。',
    }),
});

export default AGENT_MULTI_AGENT_RUNNER_SEAM;
