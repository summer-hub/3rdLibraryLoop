/**
 * seams/engine-testcheck.js — 任务准出审核引擎契约（能力接缝）
 *
 * Provider：`plugins/engines/testcheck`（`setup` 内 `ctx.provide('engine-testcheck', TestCheck)`）。
 * Consumer：`Server/TestCheck/**` 门面（`Server/composition/buildApp.js`、
 *           `Server/LoopEngine/LoopEngine.js`、m3/m5 套件）——它们的调用形状一直是
 *           `new TestCheck({ sseHub, storage, skillDirectory, cli })` 之后调
 *           `runCheck()` / `loadCheckResult()` / `listCheckResults()`，故注册**类**
 *           而不是工厂/单例。有宿主时消费者也可 `host.inject('engine-testcheck')` 取到同一个类。
 *
 * 服务形状：**类**（`factory: false`）——提供方的能力面全是**实例方法**，消费者自己
 * `new` 出来再用。注册工厂会强迫消费方多包一层 `new (inject(...))()`；注册单例则会
 * 焊死一个既有语义：每个 LoopEngine 各自 `new` 一个 TestCheck 并持有自己的
 * `status` 状态机（idle → matching → executing → evaluating → passed/failed/error），
 * 共享实例会让两条并发大循环互相改写审核状态。
 *
 * 实例方法清单从真实实现（`plugins/engines/testcheck/TestCheck.js`）推导，逐条对齐
 * **公开** API，不含私有 `_xxx`：消费者不该 poke 实现的内部状态
 * （`_status` / `_ensureWired` / `_getCli` / `_getSkillSelector` / `_matchSkill` /
 * `_invokeSkill` / `_pollSession` / `_evaluateAcceptance` / `_llmEvaluate` /
 * `_persistCheckResult` / `_buildCheckTaskDescription` / `_buildPrompt` / `_emit` /
 * `_sleep` / `_log` 都不在契约里）。
 *
 * ⚠️ 旁边的 `CheckStatus` **不是**实例能力面：它是审核状态常量表（`Object.freeze`），
 *    写进 `methods`/`properties` 会变成"实例上必须有这个成员"的假声明。它走的是**另一条
 *    契约字段** —— `constants: ['CheckStatus']`：提供方必须把**同一份**冻结对象挂到
 *    注册的那个**类**上（`TestCheck.CheckStatus = CheckStatus`），供消费者在不 import
 *    本插件模块的前提下读状态字面量。`Server/LoopEngine/LoopEngine.js`（现为
 *    `plugins/engines/loopengine`）拿它做 `=== ` 比较，因此"同一份对象"是硬要求：
 *    类上的静态属性由 m9 断言「存在 + 是对象 + `Object.isFrozen`」，而**同一性**由
 *    "赋值而不是克隆" +
 *    门面/插件入口导出同一批绑定来保证。
 *
 * 归属声明：`plugins/engines/testcheck/plugin.json` 与入口 `definePlugin` 都写
 * `seam: 'engine-testcheck'`。形状与引擎簇前三片（knowledge / brain；同一模板）刻意对齐。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3 要求契约只碰契约）。
 */

export const ENGINE_TESTCHECK_SEAM = Object.freeze({
    name: 'engine-testcheck',
    version: 1,
    /** 提供方注册的是类（能力面是实例方法），不是工厂函数 */
    factory: false,
    description:
        '任务准出审核引擎：匹配审核 SKILL → 经 CLI 执行审核 → 由 LLM 对照任务级验收标准逐条判定，' +
        '并持久化为 <数据目录>/task/<taskId>/testcheck_loop{n}.json',
    /**
     * 构造入参：**全部可选**，因此声明为空数组。提供方必须容忍空对象构造
     * （`new TestCheck({})` 在 m9 无宿主上下文里会真构造一次，必须构造成功；
     * 首次使用解析不到 llm/storage 时才 fail closed 并点名缺哪个来源）：
     *   - `llm`：LLM 客户端（不传则按 lib/llmSource.js 的解析链取）
     *   - `storage`：存储门面（不传则按 lib/storageSource.js 的解析链取）
     *   - `cli`：CLI 协作方（不传则按 lib/cliSource.js 的解析链惰性取）
     *   - `skillSelector`：审核 Skill 匹配器（不传则按 lib/skillSelectorSource.js 的解析链惰性取）
     *   - `sseHub`：SSE 推送中心（可选，注入后才有 testcheck:* 事件）
     *   - `skillDirectory`：SKILL 目录（默认 <树根>/Server/Skills）
     * 前四项是"测试/嵌入式"通道，不属于跨提供方契约，故不进 `options`；
     * 这也是 m9 能用 `new TestCheck({})` 真构造一次的原因。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法（全部是 async） */
    methods: Object.freeze([
        'runCheck', // async ({taskId, taskDir?, taskDescription?, acceptanceCriteria?, orchestratorResult?, loopCount?, skillDirectory?, isAborted?, onSessionCreated?}) => CheckResult
        'loadCheckResult', // async (taskId, loopCount) => CheckResult|null（读 <数据目录>/task/<taskId>/testcheck_loop{n}）
        'listCheckResults', // async (taskId) => CheckResult[]（按 loopCount 升序；读不到即空数组）
    ]),
    /**
     * 产物上的属性：只有 `status`（只读 getter，返回 `CheckStatus` 常量之一）。
     * 其余字段（`llm` / `storage` / `cli` / `skillSelector` / `sseHub`）都是**注入登记**，
     * 消费者不得依赖它们的形态（未接线时是 null，首次使用后才被解析链填上）。
     */
    properties: Object.freeze(['status']),
    /**
     * 提供方注册的**类**上必须挂的**冻结常量表**（静态属性通道）。
     *
     * 语义：`constants` 里每一项都是"消费者的读法"——`TestCheck.CheckStatus`（不 import
     * 本插件模块，直接经接缝/门面拿到的类上读）。`CheckStatus` 是模块级 `Object.freeze`
     * 常量表，**不是实例能力面**：写进 `methods`/`properties` 会变成"实例上必须有这个成员"
     * 的假声明。
     *
     * 为什么需要这条通道：`plugins/engines/loopengine` 拿它做三处 `===` 比较
     * （`checkResult.status === CheckStatus.ERROR` 两处 + `r.checkStatus || CheckStatus.IDLE`），
     * 这是 F-22「审核出错 ≠ 审核判定不通过」的核心判据。消费者**不能** import 本插件的
     * `TestCheck.js`（R2 禁止插件互相引用），而实例桩上也没有这张表（m3 注入的就是纯对象桩），
     * 所以只能从"提供方类"上取；一旦取到的不是**同一份**冻结对象，那三处比较全部静默失效。
     *
     * 提供方义务（`plugins/engines/testcheck/index.js`）：把**同一份**冻结对象挂到类上
     * （`TestCheck.CheckStatus = CheckStatus`），不得 `structuredClone` / 不得重建。
     * 消费者义务（`plugins/engines/loopengine/lib/testcheckSource.js`）：读取时校验
     * 「存在 + 是对象 + `Object.isFrozen`」，缺一档即 fail closed 并点名，**不退回字符串字面量**。
     * 守卫：`test/m9-contract-conformance` 对本字段声明的每一项断言同一组条件，缺失即报红。
     */
    constants: Object.freeze(['CheckStatus']),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'check-result-persisted-before-return',
        'run-check-never-throws-after-wiring',
        'check-result-covers-every-acceptance-criterion',
        'abort-signal-propagates-and-wins-over-timeout',
        'collaborators-resolved-per-documented-chain',
    ]),
    /** 消费者真正依赖的语义（逐条对齐现有实现） */
    notes: Object.freeze({
        construction:
            '构造只做依赖登记与默认 SKILL 目录推导，不发网络请求、不做存储 IO；llm/storage 的解析推迟到 ' +
            '首次使用（runCheck / loadCheckResult / listCheckResults 的 _ensureWired()）：' +
            '显式注入 → 活跃宿主接缝 → Server 侧门面登记的内置兜底 → fail closed。' +
            '构造期不抛是刻意的：m9 会用 new TestCheck({}) 真构造一次提供方。',
        runCheck:
            'runCheck 是"永不抛"的方法（接线之后）：taskId 缺失与 llm/storage 解析失败在 try 之外抛出，' +
            '其余任何环节的异常都落成 { status: "error", error: <message> } 并照常持久化——' +
            'LoopEngine 依赖这个形状区分"审核未通过"（failed）与"审核没跑起来"（error）。',
        evaluation:
            '审核报告里出现 `## 准出结论` + `通过|未通过` 时先算一份快速结论作为 fallback，' +
            '随后仍调用 LLM 做逐条评估；LLM 失败才回落到快速结论。两条路径都必须覆盖全部验收标准。',
        sse: '注入 sseHub 后按 taskId 频道推送 testcheck:{start,match,execute,evaluate,result,error}；' +
            '未注入时所有推送静默跳过（不影响审核结果）。',
        persistence:
            '<数据目录>/task/<taskId>/{testcheck_loop{n}.json, testcheck_loop{n}_result.md, testcheck_loop{n}_Summary.md}，' +
            '数据目录由 storage 门面决定；持久化失败只告警、不中断审核。',
        collaborators:
            'CLI 在第一次 _invokeSkill 时解析（显式注入 → 门面登记的 CLIController → 宿主 ai-cli 接缝），' +
            '前两档都是 CLIController 门面（保留 type 闭集校验与 Session 调用计数）；' +
            'SkillSelector 在第一次 _matchSkill 时解析（显式注入 → 门面登记的 Agent），' +
            '**没有接缝档**——SkillSelector 尚未插件化，见 Server/TestCheck/AGENTS.md 的待办。',
        abort:
            'isAborted 回调在 Session 创建后与每个轮询周期检查；置位时远程 abortSession 并抛终止错，' +
            'onSessionCreated 用于把 sessionId 交给上层（abortLoop 据此远程中止）。',
    }),
});

export default ENGINE_TESTCHECK_SEAM;
