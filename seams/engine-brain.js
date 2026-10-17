/**
 * seams/engine-brain.js — 自然语言任务拆解引擎契约（能力接缝）
 *
 * Provider：`plugins/engines/brain`（`setup` 内 `ctx.provide('engine-brain', Brain)`）。
 * Consumer：`Server/Brain/**` 门面（`Server/Routes/controllers/BrainController.js`、
 *           `Server/LoopEngine/LoopEngine.js`、`Server/composition/buildApp.js`、
 *           `cli/lib/runner.js`）——它们的调用形状一直是 `new Brain({ sseHub, storage })`
 *           之后调 `planTask()` / `replanTask()`，故注册**类**而不是工厂/单例。
 *           有宿主时消费者也可 `host.inject('engine-brain')` 取到同一个类。
 *
 * 服务形状：**类**（`factory: false`）——提供方的能力面全是**实例方法**，消费者自己
 * `new` 出来再用。注册工厂会强迫消费方多包一层 `new (inject(...))()`；注册单例则会
 * 焊死一个既有语义：每个 `BrainController` 各自 `new` 一个 Brain 并持有自己的内存计划
 * 缓存（`BoundedRegistry`，默认 200 条 / `BRAIN_MAX_PLANS`），共享实例会让两个控制器的
 * 缓存上限互相挤占。
 *
 * 实例方法清单从真实实现（`plugins/engines/brain/Brain.js`）推导，逐条对齐公开 API，
 * 不含私有 `_xxx`：消费者不该 poke 实现的内部状态（`_plans` / `_persistence` /
 * `_analysis` / `_decomposition` / `_status` 都不在契约里）。
 *
 * ⚠️ 旁边的 `SkillExecutor` / `AnalysisStrategies` / `DecompositionStrategies` /
 *    `PlanPersistence` **不是**本接缝的一部分：它们是 Brain 内部的组合件，由 Brain 在
 *    构造期自己装配（`SkillExecutor` 只被两个策略共享）。把它们塞进契约等于把实现细节
 *    写进消费者契约（YAGNI）。
 *
 * 归属声明：`plugins/engines/brain/plugin.json` 与入口 `definePlugin` 都写
 * `seam: 'engine-brain'`。形状与引擎簇第一片 `engine-knowledge` 刻意对齐。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3 要求契约只碰契约）。
 */

export const ENGINE_BRAIN_SEAM = Object.freeze({
    name: 'engine-brain',
    version: 1,
    /** 提供方注册的是类（能力面是实例方法），不是工厂函数 */
    factory: false,
    description:
        '自然语言任务拆解引擎：把任务描述经 AI SKILL / LLM 拆解为 Orchestrator 可执行的步骤图，' +
        '并持久化为 <数据目录>/task/<taskId>/brain_loop{n}.json + brain.json',
    /**
     * 构造入参：**全部可选**，因此声明为空数组。提供方必须容忍空对象构造
     * （`new Brain({})` 在无宿主、无门面登记时会构造成功，但**首次使用**解析不到
     * storage/llm 时 fail closed 并点名缺哪个来源）：
     *   - `llm`：LLM 客户端（不传则按 lib/llmSource.js 的解析链取）
     *   - `storage`：存储门面（不传则按 lib/storageSource.js 的解析链取）
     *   - `cli`：CLI 协作方（不传则按 lib/cliSource.js 的解析链惰性取）
     *   - `sseHub`：SSE 推送中心（可选，注入后才有 brain:* 事件）
     *   - `skillDirectory`：SKILL 目录（默认 <树根>/Server/Skills）
     *   - `maxPlans`：内存计划缓存上限（默认 200 / `BRAIN_MAX_PLANS`）
     * 前四项是"测试/嵌入式"通道，不属于跨提供方契约，故不进 `options`；
     * 这也是 m9 能用 `new Brain({})` 真构造一次的原因。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法（全部是 async，除三个同步查询方法） */
    methods: Object.freeze([
        'planTask', // async (taskDescription, options?) => BrainPlan（ANALYZING → PLANNING → VALIDATING → COMPLETED）
        'replanTask', // async (taskDescription, { taskId, previousCheckResult, ... }) => BrainPlan（复用 taskId）
        'planAndExecute', // async (taskDescription, orchestratorController, options?) => { plan, loadResult }
        'getPlans', // () => BrainPlan[]（内存缓存快照，不含磁盘历史）
        'getPlan', // (planId) => BrainPlan|undefined（仅内存；历史走 loadPlan）
        'getRegistryStats', // () => { size, max, ttlMs, evicted, skipped, protected }
        'loadPlan', // async (planId, { taskId?, loopCount? }?) => BrainPlan|null（内存 → 磁盘）
        'loadPlanHistory', // async (taskId) => BrainPlan[]（按 loopCount 升序）
        'listPlans', // async () => BrainPlan[]（磁盘去重 + 内存合并，按 createdAt 倒序）
    ]),
    /**
     * 产物上的属性：只有 `status`（只读 getter，返回 `BrainStatus` 常量之一）。
     * 其余状态（`_plans` / `_persistence` …）都是内部形状，消费者不得依赖。
     */
    properties: Object.freeze(['status']),
    /**
     * 提供方注册的**类**上必须挂的**冻结常量表**（静态属性通道）。
     *
     * 语义：`constants` 里每一项都是"消费者的读法"——`Brain.BrainStatus`（不 import 本插件
     * 模块，直接经接缝/门面拿到的类上读）。`BrainStatus` 是模块级 `Object.freeze` 常量表，
     * **不是实例能力面**：写进 `methods`/`properties` 会变成"实例上必须有这个成员"的假声明。
     *
     * 提供方义务（`plugins/engines/brain/index.js`）：把**同一份**冻结对象挂到类上
     * （`Brain.BrainStatus = BrainStatus`），不得 `structuredClone` / 不得重建——换一份对象
     * 会让消费者的 `===` 比较全部失效。守卫：`test/m9-contract-conformance` 对本字段声明的
     * 每一项断言「存在 + 是对象 + `Object.isFrozen`」，缺失即报红并点名。
     */
    constants: Object.freeze(['BrainStatus']),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'plan-id-unique-and-persisted-before-return',
        'replan-reuses-task-id',
        'validation-rejects-broken-step-graph',
        'memory-cache-bounded-and-losslessly-reloadable',
        'abort-signal-propagates-and-wins-over-timeout',
        'collaborators-resolved-per-documented-chain',
    ]),
    /** 消费者真正依赖的语义（逐条对齐现有实现） */
    notes: Object.freeze({
        construction:
            '构造只做依赖登记与内存缓存初始化，不发网络请求；llm/storage 的解析推迟到首次使用的 ' +
            '_ensureWired()（显式注入 → 活跃宿主接缝 → Server 侧门面登记的内置兜底 → fail closed）。' +
            '三档都没有时抛错点名缺哪个来源，而不是静默自建一份。',
        cli: 'CLI 协作方在第一次真正调用 SKILL 时惰性解析（lib/cliSource.js）：显式注入 → 门面登记的 ' +
            'CLIController → 宿主 ai-cli 接缝 → fail closed；前两档都是 CLIController 门面（保留 ' +
            'type 闭集校验与 Session 调用计数），第三档是适配器本体。',
        sse: '注入 sseHub 后按 planId（首轮）或 taskId（重规划）推送 brain:plan:* / brain:replan:* 事件；' +
            '未注入时所有推送静默跳过（不影响拆解结果）。',
        persistence:
            '<数据目录>/task/<taskId>/{brain_loop{n}.json, brain.json}，数据目录由 storage 门面决定；' +
            'brain.json 是最新快照，brain_loop{n}.json 保留每轮历史。持久化失败只告警、不中断拆解。',
        degradation:
            'CLI 不可用（健康检查失败 / SKILL 执行失败）时降级为直接 LLM 调用（fallback），' +
            '但 SKILL_ABORTED_ERROR（终止信号）**绝不降级**——降级会绕过终止语义继续消耗 LLM 调用。',
        stepGraph:
            'dependId 支持单值或数组（fan-in）；-1 是"仅由 failStepId 触发的纯修复步骤"哨兵。' +
            '校验要求 stepId 唯一、依赖引用存在、有入口步骤（排除修复步骤后回退）、有终止步骤（nextStepId=0）。',
    }),
});

export default ENGINE_BRAIN_SEAM;
