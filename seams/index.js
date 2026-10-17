/**
 * seams — 能力契约（接缝）汇总
 *
 * 每个 seam 文件定义一个能力接缝的契约：服务名、提供方注册形状、必须实现的方法。
 * 契约是**消费者与提供方之间的唯一耦合点**——替换提供方（如 opencode → 其他
 * AI CLI、DashScope → 其他模型）不需要改任何消费者代码。
 *
 * 接缝清单（按接缝名字母序；新增接缝请插到对应位置，磁盘文件名 = 接缝名）：
 *   agent-multi-agent-runner  多 Agent 运行器（步骤内角色子图 + FlexRunner 形状；Agent 簇的第三条）
 *   agent-role-limiter        角色级并发限流（第三级限流；Agent 簇的第二条）
 *   agent-skill-selector      SKILL 语义匹配（ReAct 选 SKILL；Agent 簇的第一条）
 *   ai-cli           AI 编程助手 CLI 提供方（opencode / deveco-code / ...）
 *   app-logger       应用日志器工厂（唯一持有 db/log 写入流）
 *   distributed-lease    跨实例互斥租约（含 fencing token；distributed 簇的主能力）
 *   distributed-observer 链路追踪（W3C traceparent 父子跨度树；distributed 簇的观测面）
 *   distributed-queue    至少一次投递消息队列（幂等消费 + 死信；distributed 簇的第三条）
 *   distributed-tokens   跨实例并发令牌（Redis 原子令牌 + TTL；distributed 簇的第四条）
 *   engine-brain     自然语言任务拆解引擎（拆解/重规划/计划历史；引擎簇的第二条接缝）
 *   engine-knowledge 知识沉淀引擎（经验登记/检索；引擎簇的第一条接缝）
 *   engine-loop      大循环协调引擎（Brain→Orchestrator→TestCheck 闭环；引擎簇的第五条接缝）
 *   engine-orchestrator 任务编排引擎（依赖图调度/三级限流/取消树；引擎簇的第四条接缝）
 *   engine-testcheck 任务准出审核引擎（审核 SKILL 匹配/执行 + 验收标准逐条判定）
 *   http-router      HTTP 路由挂载（经类型化事件 http:mount）
 *   llm              大语言模型提供方（DashScope / mock / ...）
 *   message-archive  会话消息归档（追加/读取/元信息/停滞判定）
 *   skill-source     SKILL 来源（目录 / npm 包 / 远程）
 *   sse-hub          SSE 实时推送中心
 *   stats            统计计数（访问次数 / Session 调用次数）
 *   storage          持久化存储门面工厂（createStorage；json/jsonl/sqlite/file 适配器随 core 提供）
 *
 * ── 哪种形状是当前标准（v2）──────────────────────────────────────────────────
 * 历史上三种形状混用（`factory` 有的写有的不写、方法清单时而叫 `methods` 时而叫
 * `facadeMethods`），谁也不敢确定该信哪个字段。从本版起，**新写或重写契约一律按 v2**：
 *
 *   | 提供方注册的东西 | 必须声明的字段                                              |
 *   | ---------------- | ----------------------------------------------------------- |
 *   | 工厂函数         | `factory: true` + `factoryOptions: [...]` + `facadeMethods` |
 *   | 类 / 对象        | `factory: false` + `methods`（实例方法；纯静态类写静态方法名） |
 *   | （任意形状补充）  | `properties: [...]`：产物上消费者直读的属性/取值器           |
 *
 * 两个字段名的语义分工（这就是 storage 与 ai-cli 的差别，不是笔误）：
 *   - `facadeMethods`：工厂**产物本身就是一个门面对象**时的成员键（storage 的
 *     `createStorage()` 返回 `{manager, sessionStore, ..., close}`，键既含方法也含属性）；
 *   - `methods`：产物是**某类实例**时的成员函数（ai-cli 的适配器、llm 的客户端、
 *     sse-hub 的实例）。它就是 v1 的老名字，**继续有效**，不是废弃字段。
 *
 * 兼容性承诺（机器可检验）：`test/m9-contract-conformance/` 一律读取
 * `methods` ∪ `facadeMethods` ∪ `properties` 的并集来核对真提供方，因此
 * **旧形状（只有 `methods`）仍被兼容读取**，不会因为没迁到 v2 就被漏检。
 *
 * 其余约定：
 *   - `factorySignature: 'positional'`：工厂按位置接收 `factoryOptions` 里的键
 *     （默认 `'options-object'`，即收到一个 options 对象）。仅在提供方签名确实是
 *     位置参数时声明（现为 `skill-source`：`(skillDirectory) => SkillMeta[]`）；
 *   - `facade`：**门面自有**方法（不属于提供方契约），见 `ai-cli` 的 `getType`——
 *     它一直被误当成适配器方法，实际只存在于 `CLIController`；
 *   - 契约是纯常量 + JSDoc，零 import（架构守卫 R3）。
 */
export { AGENT_MULTI_AGENT_RUNNER_SEAM } from './agent-multi-agent-runner.js';
export { AGENT_ROLE_LIMITER_SEAM } from './agent-role-limiter.js';
export { AGENT_SKILL_SELECTOR_SEAM } from './agent-skill-selector.js';
export { AI_CLI_SEAM } from './ai-cli.js';
export { APP_LOGGER_SEAM } from './app-logger.js';
export { DISTRIBUTED_LEASE_SEAM } from './distributed-lease.js';
export { DISTRIBUTED_OBSERVER_SEAM } from './distributed-observer.js';
export { DISTRIBUTED_QUEUE_SEAM } from './distributed-queue.js';
export { DISTRIBUTED_TOKENS_SEAM } from './distributed-tokens.js';
export { ENGINE_BRAIN_SEAM } from './engine-brain.js';
export { ENGINE_KNOWLEDGE_SEAM } from './engine-knowledge.js';
export { ENGINE_LOOP_SEAM } from './engine-loop.js';
export { ENGINE_ORCHESTRATOR_SEAM } from './engine-orchestrator.js';
export { ENGINE_TESTCHECK_SEAM } from './engine-testcheck.js';
export { HTTP_ROUTER_SEAM } from './http-router.js';
export { LLM_SEAM } from './llm.js';
export { MESSAGE_ARCHIVE_SEAM } from './message-archive.js';
export { SKILL_SOURCE_SEAM } from './skill-source.js';
export { SSE_HUB_SEAM } from './sse-hub.js';
export { STATS_SEAM } from './stats.js';
export { STORAGE_SEAM } from './storage.js';

import { AGENT_MULTI_AGENT_RUNNER_SEAM } from './agent-multi-agent-runner.js';
import { AGENT_ROLE_LIMITER_SEAM } from './agent-role-limiter.js';
import { AGENT_SKILL_SELECTOR_SEAM } from './agent-skill-selector.js';
import { AI_CLI_SEAM } from './ai-cli.js';
import { APP_LOGGER_SEAM } from './app-logger.js';
import { DISTRIBUTED_LEASE_SEAM } from './distributed-lease.js';
import { DISTRIBUTED_OBSERVER_SEAM } from './distributed-observer.js';
import { DISTRIBUTED_QUEUE_SEAM } from './distributed-queue.js';
import { DISTRIBUTED_TOKENS_SEAM } from './distributed-tokens.js';
import { ENGINE_BRAIN_SEAM } from './engine-brain.js';
import { ENGINE_KNOWLEDGE_SEAM } from './engine-knowledge.js';
import { ENGINE_LOOP_SEAM } from './engine-loop.js';
import { ENGINE_ORCHESTRATOR_SEAM } from './engine-orchestrator.js';
import { ENGINE_TESTCHECK_SEAM } from './engine-testcheck.js';
import { HTTP_ROUTER_SEAM } from './http-router.js';
import { LLM_SEAM } from './llm.js';
import { MESSAGE_ARCHIVE_SEAM } from './message-archive.js';
import { SKILL_SOURCE_SEAM } from './skill-source.js';
import { SSE_HUB_SEAM } from './sse-hub.js';
import { STATS_SEAM } from './stats.js';
import { STORAGE_SEAM } from './storage.js';

/** 接缝名 → 契约 的速查表（供插件声明 seam、供测试校验完整性） */
export const SEAMS = Object.freeze({
    'agent-multi-agent-runner': AGENT_MULTI_AGENT_RUNNER_SEAM,
    'agent-role-limiter': AGENT_ROLE_LIMITER_SEAM,
    'agent-skill-selector': AGENT_SKILL_SELECTOR_SEAM,
    'ai-cli': AI_CLI_SEAM,
    'app-logger': APP_LOGGER_SEAM,
    'distributed-lease': DISTRIBUTED_LEASE_SEAM,
    'distributed-observer': DISTRIBUTED_OBSERVER_SEAM,
    'distributed-queue': DISTRIBUTED_QUEUE_SEAM,
    'distributed-tokens': DISTRIBUTED_TOKENS_SEAM,
    'engine-brain': ENGINE_BRAIN_SEAM,
    'engine-knowledge': ENGINE_KNOWLEDGE_SEAM,
    'engine-loop': ENGINE_LOOP_SEAM,
    'engine-orchestrator': ENGINE_ORCHESTRATOR_SEAM,
    'engine-testcheck': ENGINE_TESTCHECK_SEAM,
    'http-router': HTTP_ROUTER_SEAM,
    llm: LLM_SEAM,
    'message-archive': MESSAGE_ARCHIVE_SEAM,
    'skill-source': SKILL_SOURCE_SEAM,
    'sse-hub': SSE_HUB_SEAM,
    stats: STATS_SEAM,
    storage: STORAGE_SEAM,
});

/** 全部接缝名 */
export const SEAM_NAMES = Object.freeze(Object.keys(SEAMS));
