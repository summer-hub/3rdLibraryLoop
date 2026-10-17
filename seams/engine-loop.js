/**
 * seams/engine-loop.js — 大循环协调引擎契约（能力接缝）
 *
 * Provider：`plugins/engines/loopengine`（`setup` 内 `ctx.provide('engine-loop', LoopEngine)`）。
 * Consumer：`Server/LoopEngine/**` 门面（`Server/Routes/controllers/LoopEngineController.js`
 *           的 `_createEngine()`、`cli/lib/runner.js` 的 `createLoopEngine()`、m3 的
 *           F-22/F-24 套件）——调用形状一直是
 *           `new LoopEngine({ brainController, orchestratorController, storage, testCheck })`
 *           之后调 `startLoop()` / `abortLoop()` / `getProgress()` / `restoreLoop()`，
 *           故注册**类**而不是工厂/单例。有宿主时消费者也可 `host.inject('engine-loop')`
 *           取到同一个类。
 *
 * 服务形状：**类**（`factory: false`）——提供方的能力面全是**实例方法**，消费者自己
 * `new` 出来再用。注册工厂会强迫消费方多包一层 `new (inject(...))()`；注册单例则会
 * 焊死一个既有语义：每个大循环各自持有一份 `_loops`（循环上下文）、`_abortStates`
 * （终止标志 + 待中止 session）与 `_testCheck`（审核实例）——共享实例会让两条并发
 * 大循环互相改写进度、终止标志与审核状态。
 *
 * 实例方法清单从真实实现（`plugins/engines/loopengine/LoopEngine.js`）推导，逐条对齐
 * **公开** API，不含私有 `_xxx`：消费者不该 poke 实现的内部状态
 * （`_storage` / `_testCheck` / `_testCheckClass` / `_checkStatus` / `_loops` /
 * `_abortStates` / `_getTestCheck` / `_ensureTestCheckClass` / `_runBrain` /
 * `_runOrchestrator` / `_waitForOrchestrator` / `_runTestCheck` / `_persistLoopState` /
 * `_abortSessions` / `_trackSession` / `_consumePendingSession` / `_getAbortState` /
 * `_projectRestoredStatus` / `_checkMaxAttempts` / `_fingerprintTaskDef` /
 * `_checkOscillation` / `_buildLoopResult` / `_createMockResponse` / `_sleep` / `_emit` /
 * `_log` 都不在契约里）。
 *
 * ⚠️ 同一模块里的 `LoopStatus` / `ABORTED_ERROR`（以及私有的 `SSE_EVENT`）**不是**本接缝
 *    的一部分：`LoopStatus` 是共享常量表（`Object.freeze`），`ABORTED_ERROR` 是终止
 *    专用错误类，二者与 `LoopEngine` 一同从门面与插件入口转发（`===` 同一批绑定），
 *    但写进 `methods`/`properties` 会变成"实例上必须有这个成员"的假声明。
 *    前端/Controller 拿 `LoopStatus` 做 `=== ` 比较，因此插件入口与门面必须导出同一份对象
 *    （同一性由门面保证，不由契约保证）。
 *
 * ── 为什么本契约的 `constants` 是空数组 ───────────────────────────────────────
 * 本引擎是常量表的**消费者**而不是提供方：它从 `engine-testcheck` 的提供方类上读
 * `CheckStatus`（三处 `checkResult.status === CheckStatus.ERROR/IDLE`，F-22 的核心判据），
 * 自己并不额外提供任何一张供别的插件读的表。`LoopStatus` 只服务于自己的门面/前端，
 * 没有跨插件消费者，按 YAGNI 不进 `constants`。
 *
 * 归属声明：`plugins/engines/loopengine/plugin.json` 与入口 `definePlugin` 都写
 * `seam: 'engine-loop'`。形状与引擎簇前四片（knowledge / brain / testcheck /
 * orchestrator；同一模板）刻意对齐。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3 要求契约只碰契约）。
 */

export const ENGINE_LOOP_SEAM = Object.freeze({
    name: 'engine-loop',
    version: 1,
    /** 提供方注册的是类（能力面是实例方法），不是工厂函数 */
    factory: false,
    description:
        '大循环协调引擎（Loop Engineering）：编排 Brain 拆解/重规划 → Orchestrator 编排执行 → ' +
        'TestCheck 准出审核的完整闭环，审核未通过则重规划进入下一轮，直到准出通过或达到 maxLoops；' +
        '全流程状态持久化为 <数据目录>/task/<taskId>/loop.json，支持中断恢复，并经 SseHub 推送 loop:* 实时进度',
    /**
     * 构造入参：**两个必填 + 其余全部可选**。
     *
     * 为什么这里不是空数组（与 brain/testcheck/orchestrator 不同）：`brainController` 与
     * `orchestratorController` 是迁移前就**必填**的依赖（缺任一个构造即抛
     * `'LoopEngine: brainController 为必填依赖'`），本契约必须如实声明，否则 m9 无法按契约
     * 真构造一次提供方（`new LoopEngine({})` 必然失败，那不是"契约与实现不一致"）。
     *
     *   - `brainController`（必填）：BrainController 实例，实现只调它的 `_getBrain()`
     *   - `orchestratorController`（必填）：OrchestratorController 实例，实现只调它的
     *     `load()` / `start()` / `_getOrchestrator(taskId)`
     *   - `storage`：存储门面（不传则走 lib/storageSource.js 的**同步**解析链）
     *   - `testCheck`：TestCheck **实例**（不传则按解析链取提供方类再 new）
     *   - `testCheckClass`：engine-testcheck 的提供方**类**（不传则走 lib/testcheckSource.js）
     *   - `sseHub`：SSE 推送中心（可选，注入后才有 loop:* 事件）
     *   - `skillDirectory`：SKILL 目录（默认 <树根>/Server/Skills）
     * 末四项是"测试/嵌入式"通道，不属于跨提供方契约，故不进 `options`。
     */
    options: Object.freeze(['brainController', 'orchestratorController']),
    /** 提供方类必须实现的实例方法（`startLoop` / `abortLoop` / `restoreLoop` 是 async） */
    methods: Object.freeze([
        'startLoop', // async ({taskDescription, taskId?, taskDir?, skillDirectory?, acceptanceCriteria?, maxLoops?}) => LoopResult
        'abortLoop', // async (taskId) => boolean（同步置标志、异步生效；未找到循环返回 false）
        'getProgress', // (taskId) => object|null（status/currentLoop/maxLoops/rounds/…）
        'getLoop', // (taskId) => LoopContext|undefined（内存上下文，含 rounds 完整对象）
        'getLoops', // () => LoopContext[]（内存快照）
        'isAborted', // (taskId) => boolean（各阶段轮询检查点据此退出）
        'restoreLoop', // async (taskId) => LoopContext|null（读 loop.json；进行中状态投影为 interrupted）
    ]),
    /**
     * 产物上的属性：**空数组**。
     *
     * 消费者直读的只有 `LoopStatus` 常量表（模块级导出，不是实例成员）与上面 4 个查询
     * 方法；`brainController` / `orchestratorController` / `sseHub` / `skillDirectory`
     * 都是**注入登记**，消费者不得依赖它们的形态。
     *
     * ⚠️ `storage` 是**惰性同步 getter**（`deps.storage` → 宿主 storage 接缝 → 门面登记的
     *    同步兜底 → fail closed），`Server/Routes/controllers/LoopEngineController.js` 的
     *    `_getStorage()` 兜底路径会同步读它。它**故意不写进 `properties`**：读取该 getter
     *    会触发解析链并在无宿主时抛错，而契约成员核对（m9）是"读一下产物上有没有这个
     *    成员"，把一条会抛错的取值器声明成契约属性会把判定变成"能不能解析到 storage"。
     *    它是**装配层的旁路通道**，不是跨提供方的能力面。
     */
    properties: Object.freeze([]),
    /**
     * 本引擎**不额外提供**常量表（只消费 `engine-testcheck` 的 `CheckStatus`）。
     *
     * 字段语义（与 `engine-brain` / `engine-testcheck` 的同名字段一致）：提供方注册的
     * **类**上必须有这些**冻结常量表**属性，供消费者在不 import 提供方模块的前提下读取
     * 状态字面量。缺失即 fail closed 并点名，不退回字符串字面量。
     */
    constants: Object.freeze([]),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'constructed-requires-brain-and-orchestrator-controllers',
        'loop-status-is-one-of-loop-status',
        'check-errored-distinct-from-check-failed',
        'abort-wins-over-stage-transitions',
        'restored-active-states-project-to-interrupted',
        'identical-replan-fingerprint-stops-remaining-rounds',
        'loop-state-persisted-before-return',
        'collaborators-resolved-per-documented-chain',
    ]),
    /** 消费者真正依赖的语义（逐条对齐现有实现） */
    notes: Object.freeze({
        construction:
            '构造只做依赖登记与默认 SKILL 目录推导，**不发网络请求、不做存储 IO、不解析任何协作方**；' +
            '`brainController` / `orchestratorController` 缺失即抛（迁移前就是必填）。' +
            '`storage` 是惰性同步 getter，`testCheck` 类在首次使用（startLoop / restoreLoop）时解析：' +
            '显式注入 → 活跃宿主接缝 → Server 侧门面登记的内置兜底 → fail closed。',
        constants:
            '三处状态比较 `checkResult.status === CheckStatus.ERROR`（F-22 重试判定与终止判定）与' +
            ' `r.checkStatus || CheckStatus.IDLE`（恢复旧版 loop.json）用的是**提供方类上的那张**' +
            '冻结常量表（契约 `constants` 通道），不是本引擎自己的字面量副本。' +
            '提供方类缺 `CheckStatus` 时 fail closed 并点名，**绝不**退回字符串字面量——' +
            '退回字面量会让"两张对象不同一"这类真实故障静默通过。',
        statuses:
            '`LoopStatus` = idle/planning/executing/checking/aborting/passed/failed/aborted/' +
            'interrupted/error。`aborting` 是过渡态（终止已受理、等待各阶段轮询退出）；' +
            '`interrupted` 只出现在恢复路径（F-24：planning/executing/checking 这些只有执行体能' +
            '推进的状态，重启后一律投影为 interrupted，`aborting` 投影为 aborted，未知值归 idle）。',
        checkSemantics:
            'F-22：审核"没跑起来"（`status=error`）与审核"判定不通过"（`status=failed`）严格分开——' +
            '出错先按 `LOOP_CHECK_MAX_ATTEMPTS`（默认 2）重试审核本身，仍失败则终态 ERROR 并如实说明' +
            '是审核环节故障，**不消耗轮次**、**不谎报"准出未通过"**，也不把没有失败清单的结论传给重规划。',
        oscillation:
            'F-23：每轮把步骤图指纹（stepId/dependId/nextStepId/failStepId/specifiedSkill/描述，' +
            '归一空白并按 stepId 排序后 sha256 前 16 位）与历史轮次比较；命中即判定计划振荡，' +
            '终止剩余轮次并给出可操作原因（`LOOP_DETECT_OSCILLATION=0` 可关闭）。',
        abort:
            '`abortLoop()` 置标志（`isAborted` 立即为 true）+ 终止 Orchestrator + 远程中止 Brain/' +
            'TestCheck 阶段正在运行的 opencode session（经 `resolveCli()` 取 CLI 协作方，尽力而为、' +
            '失败只告警）。各阶段在轮询周期里检查标志并抛终止错；`ABORTED_ERROR` 与下游的' +
            '`SkillAbortedError` 都会被识别为"跳出循环"而不是"进入下一轮"。',
        sse: '注入 sseHub 后按 taskId 频道推送 loop:{start,round:start,planning,executing,checking,' +
            'round:end,complete,error,aborting,aborted}；未注入时所有推送静默跳过（不影响循环结果）。',
        persistence:
            '<数据目录>/task/<taskId>/loop.json（每轮前后与终态各落一次；启动即落一次，保证重启后' +
            '任务可见）。skillDirectory 默认值与迁移前是同一个绝对路径；持久化失败只告警、不中断循环。',
        orchestratorWait:
            'Orchestrator.start() 是 fire-and-forget，本引擎轮询 `orch.status` 等终态（先判后睡，' +
            '已完成时不再多等一个 5s 周期）。120 分钟仍未到终态时**不静默**：带 `timedOut: true` ' +
            '返回并让 `_runOrchestrator` 抛错、本轮按失败处理——绝不把"还在跑的编排"当已完成再去做准出审核。',
        collaborators:
            '三条协作方按首次使用解析：`storage` 走 lib/storageSource.js（**同步**，因为 ' +
            '`Server/Routes` 有一条构造后同步读 `engine.storage` 的路径）；`cli` 走 lib/cliSource.js' +
            '（门面 CLIController → 宿主 ai-cli 接缝）；`engine-testcheck` 走 lib/testcheckSource.js' +
            '（含 `constants` 校验）。三者都由 `Server/LoopEngine/LoopEngine.js` 门面在 import 期登记兜底。',
    }),
});

export default ENGINE_LOOP_SEAM;
