# Orchestrator —— FlexRunner 任务编排器（门面层）

> ⚠️ **实现已整体迁入插件 `plugins/engines/orchestrator/`**（`Orchestrator.js` /
> `StepNode.js` / `FlexRunner.js` 三个实现实体原样搬走，业务逻辑逐行不变；
> 无状态依赖 `nowCST` 归一到内核 `core/index.js`，两条 Agent 侧协作方改为兜底解析器）。
> 本目录**全部是转发门面**，零业务逻辑；`Server/**` 侧消费者与既有测试按老路径 import，
> 插件化不该顺手改掉它们。这是「引擎插件化」的第四片（前三片是 `Server/Knowledge/`、
> `Server/Brain/`、`Server/TestCheck/`，形状照抄它们）。
>
> **`FlexRunner` 与本模块进的是同一个插件**：迁移前 `Orchestrator.js` 就静态 import 它、
> 并在 `_createFlexRunner()` 里自己 `new FlexRunner()` 后驱动完整生命周期——二者是一个
> 内部组合件（与 Brain 的 `SkillExecutor` 同理）。拆成两个插件只能靠接缝互取，等于给
> 内部实现造公开契约；互相 import 又被架构守卫 R2 禁止。
>
> 契约：`seams/engine-orchestrator.js`（`factory: false` + 18 项 `methods` +
> `properties: ['status','taskId','nodes']` + `invariants` / `notes`）。
> `FlexRunner` **不进契约**（同片内部组件），但 `Server/FlexRunner/**` 门面仍可用。
> profile：`profiles/{default,mock-llm}.json` 各一条
> `"engines/orchestrator": { "enabled": true, "options": {} }`。

接收一段规定好任务的 JSON（taskId + 多个 step），按照依赖关系编排执行多个 FlexRunner 实例。支持并行执行、成功/失败链跳转、循环检测、实时进度推送和未执行步骤配置修改。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  index.js                                            │
│  统一导出 Orchestrator / OrchestratorStatus / StepNode       │
├──────────────────────────────────────────────────────────────┤
│  编排核心  Orchestrator.js                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ loadTask       加载任务 JSON，构建步骤节点，验证引用     │  │
│  │ start          启动编排，主调度循环                      │  │
│  │ _scheduleLoop  流水线调度（Promise.race 感知任意完成）   │  │
│  │ _executeNode   单步执行（含并发准入与失败链跳转）        │  │
│  │ _detectCycles  加载期静态环检测（next/fail/depend）     │  │
│  │ _activateNext  成功→nextStepId / 失败→failStepId       │  │
│  │ abort/pause/resume  编排级控制                          │  │
│  │ updateStepConfig     修改未执行步骤配置                 │  │
│  │ getProgress / getStepDetail  进度与细节查询             │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  步骤模型  StepNode.js                                       │
│  封装单个步骤的元信息 + 运行时状态 + 历史执行记录             │
├──────────────────────────────────────────────────────────────┤
│  外部依赖（注入）                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ SseHub       │  │ FlexRunner   │  │ Storage (可选)   │   │
│  │ 实时进度推送  │  │ 步骤执行引擎  │  │ 持久化（可选）   │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  HTTP 层（Routes）                                           │
│  OrchestratorController + routes/orchestrator.js             │
│  挂载点: /api/orchestrator/*                                 │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
plugins/engines/orchestrator/         # ← 实现实体 + 插件入口
├── plugin.json                       # 清单：name=engines/orchestrator, seam=engine-orchestrator, dependencies=[]
├── index.js                          # definePlugin 入口：ctx.provide('engine-orchestrator', Orchestrator)
├── Orchestrator.js                   # 编排器核心类，原样迁入（仅 import / 接线变了）
├── StepNode.js                       # 步骤节点模型，原样迁入
├── FlexRunner.js                     # ← Server/FlexRunner/FlexRunner.js（同片内部组件，不单独成插件）
└── lib/                              # 插件内副本 / 兜底注册表（插件不得引用 Server/，也不得跨插件 import）
    ├── fallbacks.js                  # 7 个未插件化协作方的统一无宿主兜底注册表
    ├── AbortTree.js                  # ← Server/library/AbortTree.js（零依赖、每实例状态 → 副本）
    └── SessionWaiter.js              # ← Server/library/SessionWaiter.js（同上）

Server/Orchestrator/                  # ← 门面层：路径与导出面与迁移前逐名一致
├── AGENTS.md                         # 本文档
├── index.js                          # 纯转发（含 OrchestratorStatus / StepNode / NodeStatus / default）
├── Orchestrator.js                   # 转发 + **登记 role-limiter / multi-agent-runner 两条兜底**
└── StepNode.js                       # 纯转发（零登记：StepNode 只依赖内核 nowCST）

Server/FlexRunner/                    # ← 门面层（同一插件）
├── FlexRunner.js                     # 转发 + **登记 cli-controller / skill-selector / create-storage /
│                                     #   knowledge-manager / mcp-tool-guide 五条兜底**
└── index.js                          # 纯转发

Server/Routes/
├── controllers/OrchestratorController.js  # HTTP 控制器
└── routes/orchestrator.js                 # 路由注册
```

### 门面不改对象身份

门面文件都是 `export … from` 转发，**不是重新实现**：

```js
import { Orchestrator, OrchestratorStatus } from './Orchestrator/index.js';
// 与插件里的类/常量对象 ===（同一批模块实例）
(await import('../../plugins/engines/orchestrator/Orchestrator.js')).Orchestrator === Orchestrator;  // true
(await import('../../plugins/engines/orchestrator/Orchestrator.js')).OrchestratorStatus === OrchestratorStatus; // true
```

对象身份必须保持，否则 `OrchestratorStatus.RUNNING` 常量会分属两个对象，
`LoopEngine` / `OrchestratorController` 里 `status === OrchestratorStatus.RUNNING` 的比较全部失效。

### 七条解析链（本次迁移唯一需要"接线"的地方）

迁移前本片有 **5 条静态 import + 6 处运行时自建/动态 import**。静态 import 在插件里非法
（R2 禁止插件引用 `Server/`），运行时自建会"无宿主时炸在深处"，因此各换成解析链。
**顺序统一为**：① 构造/方法入参显式注入 → ② 有接缝的走宿主接缝（`storage` / `app-logger` /
`engine-knowledge` / `ai-cli`）→ ③ 门面在 import 期登记的内置兜底 → ④ 抛错（点名 name + 三条修法）。

| 协作方 | 原写法 | 解析顺序（高 → 低） | 登记点 |
|--------|--------|----------------------|--------|
| `cli-controller` | `await import('../CLI/cli.js')` → `new CLIController()` | ① 注入 `cli` → ② 门面 `CLIController` → ③ `ai-cli` 接缝（适配器工厂）→ ④ 抛错 | `Server/FlexRunner/FlexRunner.js` |
| `skill-selector` | `await import('../Agent/SkillSelector/index.js')` → `new Agent()` | ① 注入 `skillSelector` → ② 门面 `Agent` → ③ 抛错（无接缝档） | 同上 |
| `create-storage` | `await import('../DbUse/index.js')` → `createStorage()` | ① 注入 `storage` → ② 宿主 `storage` 接缝 → ③ 门面 `createStorage` → ④ 抛错 | 同上 |
| `knowledge-manager` | `await import('../Knowledge/index.js')` → `new KnowledgeManager()` | ① 注入 `knowledgeManager` → ② 宿主 `engine-knowledge` 接缝 → ③ 门面 `KnowledgeManager` → ④ 抛错 | 同上 |
| `mcp-tool-guide` | `await import('../library/McpToolGuide.js')` → `new McpToolGuide()` | ① 门面 `McpToolGuide` → ② 抛错（无接缝档；**不复制**：其默认 config 路径由 `import.meta.url` 推导，复制＝改行为） | 同上 |
| `role-limiter` | 静态 `import { RoleLimiter }` + 模块级 `new` | ① 注入 `roleLimiter` → ② 门面 `RoleLimiter`（**同步**加载器，`resolveFallbackSync`）→ ③ 抛错 | `Server/Orchestrator/Orchestrator.js` |
| `multi-agent-runner` | `await import('../Agent/Supervisor/MultiAgentRunner.js')` | ① 注入 `multiAgentRunnerFactory` → ② 门面 `MultiAgentRunner`（惰性加载器）→ ③ 抛错 | 同上 |

四个要点：

- **登记的是加载器不是实现**：无宿主时仍保持"第一次真正用到才 import"的时机，也不会把
  `@opencode-ai/sdk` / `better-sqlite3` / SkillSelector 的 5499 行拖进"只想 new 一个
  Orchestrator"的模块图。唯一例外是 `role-limiter`：`getRoleLimiterStats()` /
  `setRoleLimit()` 是**同步**导出，因此那个加载器必须同步（`() => RoleLimiter`）。
- **`cli` 的门面排在接缝之前**（与 `storage` 相反，是有意的）：`ai-cli` 接缝提供方是
  **适配器工厂**，而 FlexRunner 的既有协作方是 `CLIController` **门面**——门面独有的
  type 闭集校验与 `startSession` 的 `stats` 旁路计数，适配器都不做。
- **`mcp-tool-guide` 故意走门面兜底而不是复制**：`Server/library/McpToolGuide.js` 已是全仓库
  唯一实现（`plugins/engines/knowledge/lib/` 那份是 knowledge 插件自己的、带改动的副本），
  再复制一份会产生**没有守卫覆盖**的第 3 份静默分叉。
- **构造期不解析**：`new Orchestrator({})` 必须成功（m9 会真构造一次），协作方留到
  **首次使用**时 fail closed。

### 与迁移前的一处行为差异（有意为之）

**删除 `await loadServerEnv()`**：迁移前 `FlexRunner.js` 模块顶层有这行（import 即改进程环境
变量）。env 现在是入口职责（`Server/composition/buildApp.js` 首行、`cli/lib/config.js` 的
`loadEnvChain()`），插件作为能力实现不再有环境副作用——与 Brain 的处置完全同源。

### 副本债务

| 副本 | 现状 | 备注 |
|------|------|------|
| `lib/AbortTree.js` | 全仓库第 2 份（`Server/library/AbortTree.js` + 本插件），实现体逐字节相同 | 每实例状态、零 import；**暂无字节守卫**（f50 的 F 组只覆盖 `BoundedRegistry`） |
| `lib/SessionWaiter.js` | 同上（含 `DEFAULT_SAFETY_POLL_MS` 常量） | 同上 |
| ~~`cstTime.js`~~ | **已收口**：全仓库只有 `core/cstTime.js` 一份 | 本插件走内核 barrel `core/index.js` 取同一个 `nowCST`（理由见插件 `index.js` 头注释：f50 的 A 组把"插件里引用 `cstTime.js` 的消费者文件数"写成了 `=== 7` 的计数断言） |

## 任务 JSON 格式

```json
{
  "taskId": "task-001",
  "taskDir": "/workspace/tasks/task-001",
  "skillDirectory": "/path/to/Skills",
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "分析代码结构",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "specifiedSkill": "cpp-porting-analysis"
    },
    {
      "stepId": 2,
      "dependId": 1,
      "taskDescription": "生成报告",
      "nextStepId": 3,
      "failStepId": 4,
      "maxRetries": 3
    },
    {
      "stepId": 3,
      "dependId": 2,
      "taskDescription": "验证结果",
      "nextStepId": 0,
      "maxRetries": 3
    },
    {
      "stepId": 4,
      "taskDescription": "错误修复",
      "dependId": 0,
      "nextStepId": 2,
      "maxRetries": 3
    }
  ]
}
```

- `dependId=0`：无前置依赖（入口步骤），可并行启动
- `nextStepId=0`：成功后无后续，编排结束
- `failStepId=0`：失败后终止链，不跳转
- `specifiedSkill`：可选，指定 SKILL（name 或目录名）；非空时该步骤跳过 SkillSelector 自动匹配，直接使用指定 SKILL（省去 2 次 LLM 调用，且避免选错）；解析失败降级为无 SKILL 模式

## 编排逻辑

### 执行流程

1. **loadTask**：解析 JSON → 构建 StepNode → 验证引用完整性 → 识别入口步骤
2. **start**：入口步骤标记 READY → 进入调度循环
3. **_scheduleLoop**：**流水线式**调度——首轮把全部 READY 节点投入执行，
   之后 `Promise.race` 感知任意节点完成并重新扫描；节点完成时其尾部级联已
   立即启动新就绪的后继节点，**不再等整批结束**（总耗时趋近 DAG 关键路径）
4. **_executeNode**：
   - 创建 FlexRunner → 单次执行
   - 成功 → 标记 COMPLETED → 激活 nextStepId
   - 失败 → 未达 maxRetries 则激活 failStepId（修复链），达上限则终止链
5. 报告传递：前置步骤的 `resultPath` 自动赋值给后续步骤的 `inputReport`

### 循环检测（F-18 更正）

> ⚠️ 本节此前把"重复步骤 → BLOCKED"归因于 `_execPathTrace` Set。该字段**确实只被
> 声明与 clear、从未被读取**（死代码），但**不能说"该检测从未生效"**——实施这一语义的
> 真实机制在 `_activateNextStep()`：
> ```js
> if (!allowCompleted && !nextNode.isPending) {
>     const canReenterFromFailed = nextNode.status === FAILED && nextNode.retryCount < nextNode.maxRetries;
>     if (!canReenterFromFailed) return;   // 已 COMPLETED 的节点不会被 nextStepId 再次激活
> }
> ```
> 也就是说"每一步在成功路径上只执行一次"是**成立的**（实测：`1 → 2 → 1` 双方均成功时
> `globalExecCount === 2` 即收敛）。**允许重复执行**的只有两条显式路径：
> `failStepId` 修复链（`allowCompleted: true`）与 FAILED 且未用尽 `maxRetries` 的节点。
> 这也正是为什么不能照原文档字面实现"一律只执行一次"——那会破坏修复链。

- **加载期静态环检测**（`_detectCycles()`，新增）：对 `nextStepId ∪ failStepId ∪ dependId`
  求强连通分量；任一 SCC 大小 > 1 或存在自环即记为一个环。
  - `dependId` 的边方向是 **dep → 本节点**（语义是"我依赖 dep"，执行方向相反）。
    方向写反会与 `nextStepId` 组合出**假环**（线性链会被误判成环）。
  - **环不报错**（修复链天然成环），只 warn 并把 `cycles` 写入 `getProgress()` 与
    `getPersistableState()`，便于发现"nextStepId 写错指回前序步骤"这类编排错误。
- **运行时兜底**：全局执行次数上限 `GLOBAL_EXEC_LIMIT=200` + 每步骤 `maxRetries`。
  （实测：双方均失败且 `failStepId` 互指的 ping-pong 环恰好在上限 200 次处有界停止。）

### 死锁检测（F-27 细化）

调度循环中若无 READY 步骤也无 RUNNING 步骤 → 结束。随后按**可归因性**区分两类终局：

| 终局 | 条件 | 说明 |
|------|------|------|
| `COMPLETED` | 全部步骤 COMPLETED | 正常结束 |
| `FAILED` | 存在 FAILED 步骤 | **失败链终止**（如某步失败且 `failStepId=0`）。原因会指名失败步骤，并说明有多少后续步骤因前置失败而未执行 |
| `DEADLOCKED` | 无 FAILED，但仍有 PENDING | 真死锁：pending 步骤的前置永远无法满足，且无失败步骤可归因 |

> 旧实现把 `FAILED`/`DEADLOCKED` 两种情况一律报为 `DEADLOCKED`，并给出含糊原因
> "可能死锁或失败链终止"。这会让"某步失败、链正常终止"这一**常见且合理**的结局
> 被显示成"死锁"，误导运维去排查调度器缺陷。现已拆开并给出可操作的原因。

## SSE 事件

编排器通过 SseHub（channel = taskId）实时推送以下事件：

| 事件类型 | 触发时机 | 数据 |
|----------|----------|------|
| `orch:task:start` | 编排启动 | getProgress() |
| `orch:step:status` | 步骤状态变更 | { stepId, status, retryCount, ... } |
| `orch:step:detail` | 单次执行完成 | { stepId, attempt, success, resultPath, ... } |
| `orch:task:progress` | 步骤状态变更后 | getProgress() |
| `orch:task:complete` | 编排结束 | { status, progress } |
| `orch:task:error` | 编排异常 | { error, progress } |
| `orch:task:aborted` | 编排被终止 | getProgress() |

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/orchestrator/load` | 加载任务定义 |
| POST | `/api/orchestrator/start` | 启动编排（异步） |
| POST | `/api/orchestrator/pause` | 暂停编排 |
| POST | `/api/orchestrator/resume` | 恢复编排 |
| POST | `/api/orchestrator/abort` | 终止编排 |
| GET | `/api/orchestrator/progress?taskId=` | 查询进度 |
| GET | `/api/orchestrator/step-detail?taskId=&stepId=&detailType=` | 查询步骤细节 |
| POST | `/api/orchestrator/update-step` | 修改未执行步骤配置 |
| GET | `/api/orchestrator/tasks` | 列出所有编排任务 |
| DELETE | `/api/orchestrator/task?taskId=` | 移除编排任务 |

## 设计要点

### 高内聚低耦合

- **Orchestrator**：只管调度和状态流转，不关心 Skill 匹配和 CLI 细节
- **StepNode**：只管单个步骤的状态和配置，不关心执行引擎
- **FlexRunner**：只管单步执行，由 Orchestrator 编排
- **SseHub / Storage**：通过构造注入，可替换或省略

### 依赖注入

- `sseHub`：可选，无则不推送 SSE 事件
- `storage`：可选，预留持久化扩展
- `flexRunnerFactory`：可选，测试时注入 mock FlexRunner
- `sessionSemaphore`：可选，Session 并发信号量（默认进程级全局单例，见下）

### 全局 Session 并发限制（F-06 / F-07 / F-08 更新）

- **进程级信号量**（`Semaphore` 类，模块级单例 `globalSessionSemaphore`）：跨所有编排任务共享
- 覆盖范围：不仅 `executeStart()`，**经验总结复用同一 session 的调用**
  （`sendAndWaitMessage`，发生在步骤槽位释放之后）也会自行再取一个槽位——
  否则真实并发会话数可达上限的 2 倍
- 上限配置：
  - 全局：`MAX_CONCURRENT_SESSIONS`，默认 50
  - **单任务配额**：`MAX_SESSIONS_PER_TASK`，默认 8（防止单个大 fan-out 任务独占全部槽位饿死其他任务）
  - **获取超时**：`SEMAPHORE_ACQUIRE_TIMEOUT_MS`，默认 15 分钟（0 = 无限等待）
    ——没有超时的话，任何僵死会话会永久占用槽位，累计到上限后所有新任务永久饿死
- 排队策略：按等待顺序扫描派发，**跳过会违反任务配额的等待者**（避免队头阻塞），
  因此不是严格 FIFO——这是为隔离性做的有意取舍
- 释放采用**租约式**：`acquire()` 返回带 `release()` 的租约，调用方无需记住 key，
  也避免了"释放次数与获取次数不匹配"导致的计数漂移（`release()` 幂等）
- 状态查询：`getSessionSemaphoreStats()` 返回
  `{ active, limit, perTaskLimit, waiting, utilization, totalAcquired, totalTimedOut, avgWaitedMs, perTask }`，
  经 `GET /api/stats/session/concurrency` 暴露，前端顶栏「🔀 并发」pill 轮询展示

### 优化点

1. **流水线调度**：任一节点完成即刻级联启动其后继（`Promise.race`），不等整批
2. **静态环检测**：加载期识别任务定义中的环并暴露（见上）
3. **全局执行上限**：`GLOBAL_EXEC_LIMIT=200` 兜底，防止极端场景
4. **报告自动传递**：前置 resultPath 自动赋值给后续 inputReport
5. **配置可修改**：未执行步骤支持动态修改依赖关系
6. **实时进度**：SSE 推送（含背压保护与可合并事件），前端无需轮询
