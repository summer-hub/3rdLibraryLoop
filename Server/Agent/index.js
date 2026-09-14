/**
 * Server/Agent —— Agent 能力与多 Agent 协作（Phase 2）
 *
 * 本目录同时容纳两类东西，边界必须说清楚：
 *
 * ```
 * Server/Agent/
 * ├── SkillSelector/        （Phase 0/1）SKILL 语义匹配 Agent —— 单点能力
 * ├── Roles/                （Phase 2）角色定义与注册表
 * ├── Messaging/            （Phase 2）结构化消息 + 进程内协作总线
 * ├── Blackboard/           （Phase 2）任务级共享工作区
 * ├── Runtime/              （Phase 2）单角色执行器
 * └── Supervisor/           （Phase 2）步骤内角色子图编排 + 面向 Orchestrator 的适配层
 * ```
 *
 * `SkillSelector` 是**被角色调用的能力**（"选哪个 SKILL"），
 * 其余五个是**角色协作的基础设施**（"谁做什么、怎么沟通、产物在哪、谁编排"）。
 * 因此本文件只做转发，不承担逻辑。
 */

export {
    AgentRole,
    RoleRegistry,
    RoleKind,
    BUILTIN_ROLES,
    defaultRoleRegistry,
    matchSkillPattern
} from './Roles/AgentRole.js';

export {
    AgentMessage,
    MessageIntent,
    ALL_INTENTS,
    BROADCAST,
    SUPERVISOR_ID,
    isPureData
} from './Messaging/AgentMessage.js';

export { MessageBus, MessageBusTimeoutError, DEFAULT_MAX_LOG_SIZE } from './Messaging/MessageBus.js';

export { Blackboard, BLACKBOARD_FILE, BOARD_SUBDIR } from './Blackboard/Blackboard.js';

export { AgentRuntime, ROLE_META_CONTRACTS, DEFAULT_SLOT_TIMEOUT_MS } from './Runtime/AgentRuntime.js';

export {
    CollaborationPlan,
    BUILTIN_PLANS,
    resolvePlan,
    getBuiltinPlan,
    DEFAULT_MAX_REVISIONS,
    DEFAULT_MAX_ROLE_RUNS
} from './Supervisor/CollaborationPlan.js';

export { Supervisor, DEFAULT_MAX_GATE_RETRIES } from './Supervisor/Supervisor.js';

export { MultiAgentRunner, getMultiAgentEnv } from './Supervisor/MultiAgentRunner.js';
