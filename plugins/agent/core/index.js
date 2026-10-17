/**
 * plugins/agent/core/index.js —— Agent 能力与多 Agent 协作（`Server/Agent/` 的实现体）
 *
 * 实现层原样来自 `Server/Agent/`（20 个文件 / 5834 行，业务逻辑逐行不变），另加：
 *
 *   lib/AtomicJsonFile.js  ← plugins/storage/core/lib/AtomicJsonFile.js（副本 #4，字节同源）
 *   lib/LatencyRecorder.js ← Server/library/LatencyRecorder.js（副本，字节同源）
 *   lib/logger.js          app-logger 接缝的消费者壳（零实现零状态，缺接线降级 noop）
 *   SkillSelector/llm/llmClient.js
 *                          从「dashscope 的转发门面」改成 LLM 类**三档解析器**
 *                          （注入 → 宿主 llm 接缝 → 门面登记兜底 → fail closed）
 *
 * `nowCST()` 不在此列：它是无状态纯函数，已归一到内核 `core/cstTime.js`（全仓库唯一一份，
 * 本插件直接 `../../../core/cstTime.js`；R2 允许插件引用 `core/`）。
 *
 * ── setup 注册三条接缝（全部注册**类**，`factory: false`）────────────────────────
 *
 *   ctx.provide('agent-skill-selector', Agent)
 *   ctx.provide('agent-role-limiter', RoleLimiter)
 *   ctx.provide('agent-multi-agent-runner', MultiAgentRunner)
 *
 * 为什么一个插件注册三条：`Server/Agent/` 本来就是一个内聚包（`SkillSelector` 是**被角色
 * 调用的能力**，其余五个目录是**角色协作的基础设施**）。三条接缝对应三处真实的跨插件
 * 消费点，各自有独立的消费者与独立的契约：
 *   - `agent-skill-selector`       ← `plugins/engines/testcheck`（审核 SKILL 匹配）+ `plugins/engines/orchestrator/FlexRunner`
 *   - `agent-role-limiter`         ← `plugins/engines/orchestrator`（第三级限流，含两个同步导出）
 *   - `agent-multi-agent-runner`   ← `plugins/engines/orchestrator`（步骤内角色子图 runner）
 * 拆成三个插件是另一种切法，但那会把 `Runtime/` ← `Roles/` ← `Messaging/` ← `Blackboard/`
 * 这条内部依赖变成三条插件间依赖，而插件之间恰恰**不得互相引用**（R2）—— 三个插件只能
 * 通过接缝互相看见，等于把内部 20 个文件的协作拆成需要三次进程内查找的外部契约。
 * 所以这里按「一个内聚实现包 + 一个清单」落地；`plugin.json` 的 `seam` 字段只能写一条
 * （取主能力 `agent-skill-selector`），另两条在契约 `notes` 里互相说明。
 *
 * 为什么注册**类**而不是工厂/单例：三者消费方的既有调用形状都是 `new Xxx(opts)`
 * （`Server/Orchestrator/Orchestrator.js` 的 `new RoleLimiter(...)`、
 * `FlexRunner`/`Orchestrator` 的 `multiAgentRunnerFactory: async () => new MultiAgentRunner(...)`、
 * `TestCheck` 的 `new Agent()`），且各自持有**每实例状态**：RoleLimiter 有每角色的
 * 在途计数与等待队列（进程级单例会焊死"每个 Orchestrator 各自一份配额"这个既有语义），
 * MultiAgentRunner 有 `taskId/stepId/_supervisor/_abortController` 等一次执行的全部上下文，
 * Agent 有 `topK/hitThreshold/weights` 的每实例覆盖。注册工厂会强迫消费方多包一层
 * `new (inject(...))()`；注册单例则直接把上述状态变成共享体。契约见 `seams/agent-*.js`。
 *
 * 形状与 `plugins/engines/{brain,knowledge,testcheck,orchestrator}` 一致：实现体具名导出
 * 供 `Server/Agent/**` 门面逐名转发（门面转发的是**同一批模块实例**，所以全仓库只有一份
 * Agent / RoleLimiter / MultiAgentRunner 类）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
// setup 里要 `provide` 的是**类本身**，而 `export ... from` 只建立再导出、不建立本地绑定，
// 因此这三个类必须既 import（供 setup 使用）又 export（供门面逐名转发）。
import { DEFAULT_ROLE_LIMITS, RoleLimiter } from './Runtime/RoleLimiter.js';
import { MultiAgentRunner } from './Supervisor/MultiAgentRunner.js';
import { Agent } from './SkillSelector/core/Agent.js';

// ─── 实现体（供 Server/Agent/** 门面逐名转发；default 留给 definePlugin）──────────
export {
    AgentRole,
    RoleRegistry,
    RoleKind,
    BUILTIN_ROLES,
    defaultRoleRegistry,
    matchSkillPattern,
} from './Roles/AgentRole.js';

export {
    AgentMessage,
    MessageIntent,
    ALL_INTENTS,
    BROADCAST,
    SUPERVISOR_ID,
    isPureData,
} from './Messaging/AgentMessage.js';

export {
    MessageBus,
    MessageBusTimeoutError,
    DEFAULT_MAX_LOG_SIZE,
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_MAX_PENDING,
} from './Messaging/MessageBus.js';

export {
    Blackboard,
    BLACKBOARD_FILE,
    BOARD_SUBDIR,
    DEFAULT_KEY_HISTORY,
    DEFAULT_MAX_ENTRIES,
    DEFAULT_FLUSH_DEBOUNCE_MS,
} from './Blackboard/Blackboard.js';

export {
    AgentRuntime,
    ROLE_META_CONTRACTS,
    DEFAULT_SLOT_TIMEOUT_MS,
    DEFAULT_RESULT_READ_LIMIT,
} from './Runtime/AgentRuntime.js';

export {
    RoleLimiter,
    DEFAULT_ROLE_TIMEOUT_MS,
    DEFAULT_ROLE_LIMITS,
    resolveRoleLimits,
} from './Runtime/RoleLimiter.js';

export {
    CollaborationPlan,
    BUILTIN_PLANS,
    PLANNING_KINDS,
    resolvePlan,
    getBuiltinPlan,
    DEFAULT_MAX_REVISIONS,
    DEFAULT_MAX_ROLE_RUNS,
} from './Supervisor/CollaborationPlan.js';

export { Supervisor, DEFAULT_MAX_GATE_RETRIES } from './Supervisor/Supervisor.js';

export { MultiAgentRunner, getMultiAgentEnv } from './Supervisor/MultiAgentRunner.js';

export { Agent } from './SkillSelector/core/Agent.js';

// 契约 `seams/agent-role-limiter.js` 的 `constants: ['DEFAULT_ROLE_LIMITS']`：把**同一份**
// 冻结常量表挂到类上，供消费者**不 import 本插件模块**也能读到建议上限——例如
// `plugins/engines/orchestrator` 只经接缝/门面拿到 `RoleLimiter` 类，再
// `RoleLimiter.DEFAULT_ROLE_LIMITS` 取表。赋值只是把本文件里本来就具名导出的那个对象挂上去：
// **不是副本、不是 structuredClone、不是重建**（换一份对象会让消费者的 `===` 比较全部失效），
// 且该对象自身 `Object.freeze`，挂上去之后仍不可改写（m9 会断言 `Object.isFrozen`）。
RoleLimiter.DEFAULT_ROLE_LIMITS = DEFAULT_ROLE_LIMITS;

export default definePlugin({
    name: 'agent/core',
    version: '1.0.0',
    // 清单只能写一条接缝：取主能力（SKILL 选择）。另两条由同一 setup 注册，见文件头。
    seam: 'agent-skill-selector',
    // 不声明 dependencies：setup 不 inject 任何服务。三条协作方（llm / app-logger /
    // 显式注入）都由 lib/*.js 在**首次使用时**按「宿主接缝 → 门面登记兜底」解析，因此
    // 不需要拓扑顺序保证，也不会因为某个 profile 没启用 llm/* 或 util/logger 而让宿主
    // 起不来（topoSort 对"声明了依赖但依赖未启用"是硬报错）。
    dependencies: [],
    setup(ctx) {
        // 无常驻资源可回收：RoleLimiter 的采样器随实例走，MultiAgentRunner 的取消树/会话
        // 由调用方注入并自行回收，Agent 的 LLM 客户端按解析链惰性构造，故 setup 无需返回值。
        ctx.provide('agent-skill-selector', Agent);
        ctx.provide('agent-role-limiter', RoleLimiter);
        ctx.provide('agent-multi-agent-runner', MultiAgentRunner);
    },
});
