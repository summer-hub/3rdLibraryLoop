/**
 * Server/Agent/index.js —— 转发门面（实现已迁入 `plugins/agent/core/index.js`）
 *
 * 为什么留这一层：`Server/Agent/**` 的既有 import 路径遍布全仓（`Server/TestCheck`、
 * `Server/Brain`、`Server/FlexRunner`、`Server/Orchestrator`、`Server/Routes` 以及
 * `test/m5-phase2`、`test/m6-phase3` 等）。插件化不该顺手改掉这些 import；
 * 而架构守卫 R2 只禁止「插件 → Server」方向，「Server → plugins」是允许的
 * （与 `Server/Brain/index.js`、`Server/TestCheck/TestCheck.js` 同一形状）。
 *
 * **关键约束：全部用 `export ... from` 转发，不重新实现、也不 `export *`。**
 *   - 转发让门面与插件实现成为**同一个模块实例**（ESM 按解析后的 URL 缓存），所以全仓库
 *     只有一份 `RoleRegistry` / `MessageBus` / `Blackboard` / `Supervisor` /
 *     `MultiAgentRunner` 类，"两个模块实例各存一份状态"这类裂缝不可能出现；
 *   - 不用 `export *`：插件根的导出面比本 barrel 宽（还含 `RoleLimiter`、`Agent` 以及
 *     `DEFAULT_*` 一批常量，供深层门面逐名转发）。`export *` 会把这些一并放大到本文件，
 *     导出面就从"迁移前那 31 个名字"变成"插件根的全部名字"，属于无意的契约扩张。
 *     这里逐名列出，与迁移前的 31 个导出**逐名一致**。
 *
 * 迁移前本文件没有 `default`（目录级 barrel），因此这里也不制造一个：插件根的 `default`
 * 是 `definePlugin(...)` 的产物（插件清单定义），不是 Agent 能力。
 *
 * 同时在本文件（**必经门面**之一）登记两件事，供无宿主形态下深层消费者使用：
 *   - `llm` 兜底：`setLlmFallback(() => LLMClient)`（与
 *     `SkillSelector/llm/llmClient.js` 的同名登记同形，先登记先赢、幂等）；
 *   - `app-logger` 兜底：`setLoggerImpl((options) => createLogger(options.tag))`。
 * 两处都是幂等操作，与其它门面重复登记无副作用（都指向同一个模块实例）。
 */

import { setLlmFallback } from '../../plugins/agent/core/SkillSelector/llm/llmClient.js';
import { setLoggerImpl } from '../../plugins/agent/core/lib/logger.js';
import { LLMClient } from './SkillSelector/llm/llmClient.js';
import createLogger from '../Routes/library/logger.js';
// 第三个装配层登记：默认会话适配器 = FlexRunner（见 internal/ 的同名文件）
import './internal/registerFlexRunnerFallback.js';

setLlmFallback(() => LLMClient);
setLoggerImpl((options) => createLogger(options.tag));

export {
    AgentRole,
    RoleRegistry,
    RoleKind,
    BUILTIN_ROLES,
    defaultRoleRegistry,
    matchSkillPattern,
} from '../../plugins/agent/core/Roles/AgentRole.js';

export {
    AgentMessage,
    MessageIntent,
    ALL_INTENTS,
    BROADCAST,
    SUPERVISOR_ID,
    isPureData,
} from '../../plugins/agent/core/Messaging/AgentMessage.js';

export {
    MessageBus,
    MessageBusTimeoutError,
    DEFAULT_MAX_LOG_SIZE,
} from '../../plugins/agent/core/Messaging/MessageBus.js';

export {
    Blackboard,
    BLACKBOARD_FILE,
    BOARD_SUBDIR,
} from '../../plugins/agent/core/Blackboard/Blackboard.js';

export {
    AgentRuntime,
    ROLE_META_CONTRACTS,
    DEFAULT_SLOT_TIMEOUT_MS,
} from '../../plugins/agent/core/Runtime/AgentRuntime.js';

export {
    CollaborationPlan,
    BUILTIN_PLANS,
    resolvePlan,
    getBuiltinPlan,
    DEFAULT_MAX_REVISIONS,
    DEFAULT_MAX_ROLE_RUNS,
} from '../../plugins/agent/core/Supervisor/CollaborationPlan.js';

export { Supervisor, DEFAULT_MAX_GATE_RETRIES } from '../../plugins/agent/core/Supervisor/Supervisor.js';

export { MultiAgentRunner, getMultiAgentEnv } from '../../plugins/agent/core/Supervisor/MultiAgentRunner.js';
