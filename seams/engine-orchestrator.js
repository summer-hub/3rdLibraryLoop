/**
 * seams/engine-orchestrator.js — 任务编排引擎契约（能力接缝）
 *
 * Provider：`plugins/engines/orchestrator`（`setup` 内
 *           `ctx.provide('engine-orchestrator', Orchestrator)`）。
 * Consumer：`Server/Orchestrator/**` 门面（`Server/Routes/controllers/OrchestratorController.js`、
 *           `Server/LoopEngine/LoopEngine.js`、`cli/lib/runner.js` 经 buildApp、m1~m6 套件）
 *           ——调用形状一直是 `new Orchestrator({ sseHub, storage })` 之后调
 *           `loadTask()` / `start()` / `getProgress()` / `abort()`，故注册**类**
 *           而不是工厂/单例。有宿主时消费者也可 `host.inject('engine-orchestrator')` 取到同一个类。
 *
 * 服务形状：**类**（`factory: false`）——提供方的能力面全是**实例方法**，消费者自己
 * `new` 出来再用。注册工厂会强迫消费方多包一层 `new (inject(...))()`；注册单例则会
 * 焊死一个既有语义：每个编排任务各自 `new` 一个 Orchestrator 并持有自己的
 * `_nodes` / `_status` 状态机，共享实例会让两条并发编排互相改写进度。
 *
 * 实例方法清单从真实实现（`plugins/engines/orchestrator/Orchestrator.js`）推导，逐条对齐
 * **公开** API，不含私有 `_xxx`：消费者不该 poke 实现的内部状态
 * （`_detectCycles` / `_validateReferences` / `_scheduleLoop` / `_executeNode` /
 * `_activateNextStep` / `_createFlexRunner` / `_createMultiAgentRunner` /
 * `_roleLimiterInstance` / `_persistStepDb` / `_emit` / `_log` 等都不在契约里）。
 *
 * ⚠️ 与本片同时迁走的 `FlexRunner` **不进入本契约**：它与 Orchestrator 是一个内部
 *    组合件（迁移前 `Orchestrator.js` 就静态 import 它、并在 `_createFlexRunner()` 里
 *    自己 `new FlexRunner()` 后驱动完整生命周期），与 Brain 把 `SkillExecutor` 作为
 *    内部组件的处置同理。`Server/FlexRunner/**` 门面仍然可用（导出同一批对象，
 *    既有消费者与 m1/m2/m3/m5/m6 套件一条都不改），但它**不是接缝的一部分**：
 *    没有第三方会替换它，把它写进 `methods` 只会诱使外部绕过 Orchestrator
 *    直接驱动步骤执行。
 *
 * ⚠️ 同一模块里导出的 `OrchestratorStatus` / `NodeStatus` / `SSE_EVENT` / `Semaphore` /
 *    `ControlType` / `StepStatus` 都**不是**本接缝的一部分：它们是共享常量表
 *    （`Object.freeze`）与通用并发原语，与类一同从门面与插件入口转发，但写进
 *    `methods`/`properties` 会变成"实例上必须有这个成员"的假声明。
 *    `Server/Orchestrator/**` 的消费者拿 `OrchestratorStatus` 做 `=== ` 比较，
 *    因此插件入口与门面必须导出同一份对象（同一性由门面保证，不由契约保证）。
 *
 * 归属声明：`plugins/engines/orchestrator/plugin.json` 与入口 `definePlugin` 都写
 * `seam: 'engine-orchestrator'`。形状与引擎簇前三片（knowledge / brain / testcheck；
 * 同一模板）刻意对齐。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3 要求契约只碰契约）。
 */

export const ENGINE_ORCHESTRATOR_SEAM = Object.freeze({
    name: 'engine-orchestrator',
    version: 1,
    /** 提供方注册的是类（能力面是实例方法），不是工厂函数 */
    factory: false,
    description:
        '任务编排引擎：按 taskId + 多个 step 的依赖图调度执行（并行 fan-out / nextStepId 成功链 / ' +
        'failStepId 修复链 / 静态环检测 / 死锁与失败归因），每个步骤交给同片的内部组件 FlexRunner ' +
        '跑一次「匹配 SKILL → 执行 → 检查结果 → 沉淀经验」，并经 SseHub 推送 orch:* 实时进度',
    /**
     * 构造入参：**全部可选**，因此声明为空数组。提供方必须容忍空对象构造
     * （`new Orchestrator({})` 在 m9 无宿主上下文里会真构造一次，必须构造成功；
     * 协作方在**首次使用**时才按解析链 fail closed）：
     *   - `sseHub`：SSE 推送（可选，无则所有 orch:* 事件静默跳过）
     *   - `storage`：存储门面（可选，无则不持久化编排状态与步骤记录）
     *   - `flexRunnerFactory` / `multiAgentRunnerFactory`：运行器工厂（测试/嵌入用）
     *   - `sessionSemaphore`：Session 并发信号量（默认进程级全局单例）
     *   - `abortTree` / `roleLimiter` / `sessionEvents` / `roleRegistry`：Phase 2/3 可注入
     *   - `multiAgentEnabled`：多 Agent 开关（默认读 `MULTI_AGENT_ENABLED`）
     * 这些是"测试/嵌入式"通道，不属于跨提供方契约，故不进 `options`；
     * 这也是 m9 能用 `new Orchestrator({})` 真构造一次的原因。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法（`start` / 控制类 / 查询类是 async） */
    methods: Object.freeze([
        'loadTask', // async (taskDef) => void（建节点、校验引用、静态环检测、标记入口 READY）
        'start', // async () => void（跑完整个调度循环，结束态在 getProgress().status）
        'pause', // async () => boolean
        'resume', // async () => boolean
        'abort', // async () => boolean（LOADED 也受理：防止 start 前的终止被吞掉）
        'abortAndWait', // async ({timeoutMs, pollMs}) => {ok, ...}（终止并等待在途步骤收敛）
        'flushPersistence', // async () => void（把合并窗口里的写刷盘）
        'dispose', // () => void（释放各步骤的 FlexRunner 及其内嵌重型依赖引用）
        'getProgress', // () => object（供 SSE/HTTP/前端；含 status/steps/cycles/stats）
        'getNode', // (stepId) => StepNode|undefined
        'getStepDetail', // async (stepId, detailType) => object
        'restoreState', // async (state, opts) => void（进程重启后从持久化恢复）
        'updateStepConfig', // (stepId, patch) => boolean（仅未执行步骤）
        'getMultiAgentStats', // () => object（Phase 2 协作统计）
        'getAgentTopology', // (stepId) => object|null（角色子图拓扑）
        'getConcurrencyStats', // () => object（三级限流 + 取消树 + 队列水位）
        'getPersistableState', // () => object
        'getPersistStats', // () => object
    ]),
    /**
     * 产物上的属性：消费者直读的取值器（m1/f04、m4/f27-f28、LoopEngine 与
     * OrchestratorController 都按 `status === OrchestratorStatus.RUNNING` 比较）。
     * 其余字段（`sseHub` / `storage` / `abortTree` / `roleLimiter` / `sessionEvents`）
     * 都是**注入登记**，消费者不得依赖它们的形态。
     */
    properties: Object.freeze(['status', 'taskId', 'nodes']),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'constructed-with-empty-deps',
        'progress-status-is-one-of-orchestrator-status',
        'step-executes-at-most-once-on-success-path',
        'fail-chain-may-reenter-completed-step',
        'terminal-state-is-completed-failed-aborted-or-deadlocked',
        'collaborators-resolved-per-documented-chain',
        'abort-is-idempotent-and-wins-over-scheduling',
    ]),
    /** 消费者真正依赖的语义（逐条对齐现有实现） */
    notes: Object.freeze({
        construction:
            '构造只做依赖登记与开关解析（不发网络请求、不做存储 IO、不解析任何协作方）：' +
            '`new Orchestrator({})` 必须成功。协作方解析发生在首次使用：显式注入 → 活跃宿主接缝 → ' +
            'Server 侧门面登记的内置兜底 → fail closed（点名缺哪个来源）。' +
            '构造期不抛是刻意的：m9 会用 `new Orchestrator({})` 真构造一次提供方。',
        statuses:
            '`status` 取值域就是 `OrchestratorStatus`（idle/loaded/running/completed/failed/aborted/' +
            'deadlocked）。迁移前的缺陷已修：失败链终止报 `failed`（点名失败步骤），只有"无 FAILED ' +
            '但仍有 PENDING"才报 `deadlocked` —— 旧实现把两者一律报 deadlocked，会误导运维。',
        scheduling:
            '流水线调度：任一节点完成即刻级联启动其后继（Promise.race），总耗时趋近 DAG 关键路径；' +
            '全局执行上限 200 + 每步 maxRetries 是运行时兜底，加载期另有静态环检测' +
            '（`nextStepId ∪ failStepId ∪ dependId` 求强连通分量）——环**不报错**（修复链天然成环），' +
            '只 warn 并写进 `getProgress().cycles`。',
        concurrency:
            '三级限流：全局 Session 信号量（`MAX_CONCURRENT_SESSIONS`，默认 50，**进程级单例**）→ ' +
            '单任务配额（`MAX_SESSIONS_PER_TASK`，默认 8）→ 角色级（`MAX_SESSIONS_PER_ROLE`，默认 0=不限制）。' +
            '获取顺序固定为「角色槽位 → 全局槽位」，释放顺序相反——顺序不统一必然偶发挂死。',
        abort:
            '`abort()` 置标志 + 取消树级联（task → step → role → 在途 HTTP），并通知各 FlexRunner 的 ' +
            '`controlExecution("abort")`；实现在步骤边界检查，因此是"步骤原子完成或完全不执行"，' +
            '不是实时中断。`abortAndWait()` 额外等待在途步骤收敛。',
        sse: '注入 sseHub 后按 taskId 频道推送 orch:{task:start,task:progress,step:status,step:detail,' +
            'task:complete,task:error,task:aborted}；未注入时所有推送静默跳过（不影响编排结果）。',
        persistence:
            '<数据目录>/task/<taskId>/orchestration_loop{n}.json + 步骤记录（storage 门面决定数据目录）；' +
            '写入按窗口合并（`PERSIST_DEBOUNCE_MS`，默认 300ms），持久化失败只告警、不中断编排。' +
            '属主心跳（`OWNER_HEARTBEAT_MS`，默认 30s）配合 Controller 的 `OWNER_STALE_MS` 判定幽灵任务。',
        collaborators:
            '7 个协作方按首次使用解析（`plugins/engines/orchestrator/lib/fallbacks.js`）：' +
            'storage / engine-knowledge / app-logger / ai-cli 走宿主接缝；' +
            'role-limiter / multi-agent-runner / create-storage / knowledge-manager / ' +
            'cli-controller / skill-selector / mcp-tool-guide 由 `Server/Orchestrator/**` 与 ' +
            '`Server/FlexRunner/**` 门面在 import 期登记内置实现。' +
            '`cli` 的次序是**门面在接缝之前**（照抄 Brain 的裁决：门面独有的 type 闭集校验与 ' +
            'Session 调用计数，`ai-cli` 适配器不做）。',
        flexRunner:
            'FlexRunner 由本插件一并提供（同片内部组件，不单独成插件，不在此契约内）：' +
            'Orchestrator 在 `_createFlexRunner()` 里自己 new 并驱动它，' +
            '`Server/FlexRunner/**` 门面继续导出同一批对象（`===`），既有消费者零改动。',
    }),
});

export default ENGINE_ORCHESTRATOR_SEAM;
