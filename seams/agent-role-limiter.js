/**
 * seams/agent-role-limiter.js — 角色级并发限流（第三级限流）契约
 *
 * Provider：`plugins/agent/core`（`setup` 内 `ctx.provide('agent-role-limiter', RoleLimiter)`）。
 * Consumer：`plugins/engines/orchestrator`（`lib/fallbacks.js` 的 `role-limiter` 名、
 *           `Orchestrator.js` 的 `getRoleLimiterStats()` / `setRoleLimit()` 两个**同步**导出）。
 *
 * 服务形状：**类**（`factory: false`）—— 能力面全是实例方法/取值器，消费者 `new` 后使用。
 * 注册单例会直接毁掉这个接缝存在的理由：`RoleLimiter` 的每个实例持有**自己的**配额账本
 * （每角色的 `active` 计数、FIFO 等待队列、采样器），而既有语义是"每个 Orchestrator
 * 各自一份字典，`new RoleLimiter({limits})` 就是它的配额"。共享实例会让两个
 * Orchestrator 的配额互相挤占 —— 那是把"配比保护"变成"配比串味"。
 *
 * 为什么它独立成一条接缝（而不是塞进 `engine-orchestrator`）：`Limiter` 是**并发正确性**
 * 的基础设施，它的失败模式（死锁、饿死）与编排语义无关；而且 Orchestrator 里有两个
 * **同步**入口要用它（模块级 `getRoleLimiterStats()` / `setRoleLimit()`），同步取用
 * 意味着它必须能在"不 await 任何东西"的前提下解析到 —— 独立接缝让这条要求可以单独
 * 落到 `resolveFallbackSync` 上，混进编排引擎契约就不存在这种区分了。
 *
 * 实例成员清单从真实实现（`plugins/agent/core/Runtime/RoleLimiter.js`）推导。模块级的
 * `DEFAULT_ROLE_TIMEOUT_MS` / `resolveRoleLimits` 是**模块导出**，不是实例能力面，
 * 因此不进 `methods`/`properties`（消费方要用它们就 import 提供方，那属于内部形状）。
 * 而 `DEFAULT_ROLE_LIMITS` 这张冻结常量表走 `constants` 通道（见下）。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3）。
 */

export const AGENT_ROLE_LIMITER_SEAM = Object.freeze({
    name: 'agent-role-limiter',
    version: 1,
    factory: false,
    description:
        '角色级并发上限（第三级限流）：给最贵的角色设上限，让廉价但关键的角色（评审/验证）' +
        '始终有槽位可用；解决的是"配比"而不是"总量"问题',
    /**
     * 构造入参：**全部可选**，因此声明为空数组（`new RoleLimiter({})` 必须成功，
     * 只按环境变量取默认值）。具体键：
     *   - `limits`：`{roleId: limit}`，0 = 不限制（优先级高于环境变量）
     *   - `defaultLimit`：未列出的角色统一上限（0 = 不限制）
     *   - `timeoutMs`：槽位等待超时（默认 15 分钟或读 `ROLE_SLOT_ACQUIRE_TIMEOUT_MS`）
     *   - `logger`：`(level, msg) => void` 诊断通道（可选）
     * 四项都是"调用方配置"，不属于跨提供方契约；m9 用 `new RoleLimiter({})` 真构造一次。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法 */
    methods: Object.freeze([
        'limitOf', // (roleId) => number（当前上限；0 = 不限制）
        'setLimit', // (roleId, limit) => number（运行期可调；放宽后立刻派发排队者）
        'acquire', // async (roleId, { timeoutMs? }?) => { ok, waitedMs, timedOut, limit, release() }
        'getStats', // () => { defaultLimit, timeoutMs, activeTotal, waitingTotal, maxActiveTotal, perRole, queueWaitP95Ms, ... }
    ]),
    /**
     * 产物上的取值器：跨角色在途总数与等待总数。
     *
     * 为什么它们是 `properties` 而不是 `methods`：实现里就是 getter
     * （`get activeTotal()` / `get waitingTotal()`），调用方写 `limiter.activeTotal`；
     * 写成 `activeTotal()` 会与真实实现不符（并让早已这么写的消费者拿到一个函数对象）。
     */
    properties: Object.freeze(['activeTotal', 'waitingTotal']),
    /**
     * 提供方**类**上必须挂的**冻结常量表**（静态属性通道）。
     *
     * 语义：`RoleLimiter.DEFAULT_ROLE_LIMITS` 是"内置角色的建议默认上限"（`planner`/
     * `retriever`/`coder`/`reviewer`/`verifier` 全为 0 = 不限制）。消费者（例如
     * `plugins/engines/orchestrator` 想在 `setRoleLimit()` 里校验角色名）不必 import
     * 提供方模块就能读到它 —— R2 禁止插件互相引用，只能从**注册的那个类**上取。
     *
     * 提供方义务（`plugins/agent/core/index.js`）：把**同一份**冻结对象挂到类上
     * （`RoleLimiter.DEFAULT_ROLE_LIMITS = DEFAULT_ROLE_LIMITS`），不得 `structuredClone`
     * / 不得重建 —— 换一份对象会让消费者的 `===` 比较全部失效。守卫：
     * `test/m9-contract-conformance` 对本字段声明的每一项断言「存在 + 是对象 +
     * `Object.isFrozen`」，缺失即报红并点名。
     *
     * 不把 `DEFAULT_ROLE_TIMEOUT_MS` 列进来：它是 number，不是常量**表**，且消费者
     * 只需要在读超时语义时看一眼，没有"必须同一份对象"的诉求。
     */
    constants: Object.freeze(['DEFAULT_ROLE_LIMITS']),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'zero-limit-means-unlimited-and-behaves-like-no-limiter',
        'acquire-order-is-role-slot-then-global-slot-to-avoid-deadlock',
        'waiters-are-served-fifo',
        'release-is-idempotent-and-counts-never-drift',
        'limit-change-takes-effect-immediately-and-dispatches-waiters',
        'timeout-returns-ok:false-with-a-noop-release',
        'construction-never-throws-even-with-empty-options',
        'illegal-env-value-falls-back-to-default-not-to-unlimited',
    ]),
    notes: Object.freeze({
        layers:
            '三层叠加：全局 `MAX_CONCURRENT_SESSIONS`（保护外部单进程）→ 任务级 '
            + '`MAX_SESSIONS_PER_TASK`（隔离）→ 角色级 `MAX_SESSIONS_PER_ROLE`（配比）。'
            + '本接缝只管第三层。',
        ordering:
            '获取顺序固定为 **角色槽位 → 全局槽位**，释放顺序相反。所有参与者遵守同一顺序，'
            + '因此不可能出现循环等待。这条是刻意的设计决定，不是实现细节：顺序一旦不统一，'
            + '高并发压测必然出现偶发挂死且极难复现（`test/m6-phase3/f37` 有饱和用例守护）。',
        config:
            '`MAX_SESSIONS_PER_ROLE`（未单独指定时的统一上限，默认 0）、'
            + '`ROLE_LIMIT_<ROLE>`（单角色上限）、`ROLE_SLOT_ACQUIRE_TIMEOUT_MS`（默认 15 分钟）。'
            + '与 `Orchestrator` 的其它开关一致：**非法值回退默认**（而不是"无上限"）—— '
            + '"配置写错导致限流失效"比"配置写错导致限流收紧"危险得多。',
        metrics:
            '实例上的 `waitRecorder` / `holdRecorder` 是两个有界延迟采样器（P95/P99），'
            + '它们输出在 `getStats()` 里，本身不是契约成员（消费者不该直接 poke 采样器）。',
        siblings:
            '同一插件（`plugins/agent/core`）同时提供 `agent-skill-selector`（主能力，'
            + '写在 `plugin.json` 的 `seam` 字段）与 `agent-multi-agent-runner`。',
    }),
});

export default AGENT_ROLE_LIMITER_SEAM;
