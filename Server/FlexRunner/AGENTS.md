# FlexRunner —— 通用执行引擎

本目录封装任务执行的核心驱动逻辑：接收一个具体事项，将其拆解为多个步骤，对每个步骤进行 Skill 匹配 → 执行 → 检查 → 持久化的完整闭环，并支持暂停 / 继续 / 终止等流程控制。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  index.js                                            │
│  统一导出 FlexRunner / ControlType / StepStatus               │
├──────────────────────────────────────────────────────────────┤
│  核心类  FlexRunner.js                                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ initContext     初始化任务上下文（工作目录/依赖注入）   │  │
│  │ matchSkill      语义拆解 + 模糊召回 + LLM 重排序        │  │
│  │ invokeSkill     opencode 创建 Session → 发送 prompt     │  │
│  │                 → 轮询等待完成                          │  │
│  │ checkResult     读取 result .md 判断 成功/失败          │  │
│  │ persistKnowledge 读取 Summary .md 持久化经验            │  │
│  │ controlExecution pause / resume / abort 流程控制        │  │
│  │ getSessionContent 读取归档会话内容                      │  │
│  │ getLiveMessages  实时查看当前对话消息                   │  │
│  │ injectPrompt    注入上下文（不触发 AI 回复）            │  │
│  │ sendAndWaitMessage  发送消息并同步等待回复              │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  外部依赖（惰性加载，支持注入 mock）                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │ CLI/CLIController │  │ Agent/           │  │ DbUse/     │ │
│  │ (opencode)        │  │ SkillSelector    │  │ createStorage│ │
│  │ 执行 Skill        │  │ 语义匹配 Skill   │  │ 步骤持久化 │ │
│  └──────────────────┘  └──────────────────┘  └────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  公共依赖                                                    │
│  library/cstTime — 北京时间格式化                            │
│  dotenv — 可选，生产环境加载 .env                            │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
Server/FlexRunner/
├── AGENTS.md          # 本文档
├── FlexRunner.js      # FlexRunner 核心类（含 ControlType / StepStatus 常量）
└── index.js           # 模块统一导出
```

## 文件说明

### FlexRunner.js — 核心执行类

对外默认导出 `FlexRunner`，具名导出 `ControlType` / `StepStatus`。

#### 常量

**ControlType** — 执行控制类型（`Object.freeze`）：

| 值 | 说明 |
|------|------|
| `PAUSE` | 暂停执行 |
| `RESUME` | 继续执行 |
| `ABORT` | 终止执行 |

**StepStatus** — 步骤状态（`Object.freeze`）：

| 值 | 说明 |
|------|------|
| `PENDING` | 待执行 |
| `RUNNING` | 执行中 |
| `COMPLETED` | 已完成 |
| `ERROR` | 执行失败 |
| `SKIPPED` | 已跳过（含终止） |

**其他常量：**

| 常量 | 默认值 | 说明 |
|------|------|------|
| `DEFAULT_MAX_RETRIES` | `3` | 默认最大重试次数 |
| `POLL_INTERVAL_MS` | `5000` | 轮询间隔（ms） |
| `POLL_TIMEOUT_MS` | `5400000` | 单步轮询超时 90 分钟（仓库级检视 SKILL 单步可达 20-30 分钟） |

#### 构造

```js
new FlexRunner(config?)
```

支持两种使用方式：
1. **无参构造** + 后续调用 `initContext()`
2. **构造时传入 config**，自动完成初始化（延迟到 `initContext` 处理异步逻辑）

#### 核心方法

**`initContext(params)` — 初始化任务上下文**

解析入参，设置任务 ID、工作目录、SKILL 目录等，并懒初始化内部依赖。支持依赖注入便于测试。

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `taskId` | `string` | ✅ | 任务 ID |
| `stepId` | `number` | ✅ | 当前步骤 ID（正整数） |
| `taskDir` | `string` | | 工作目录（默认 `cwd/tasks/{taskId}`） |
| `skillDirectory` | `string` | | SKILL 目录路径 |
| `specifiedSkill` | `string` | | 指定 SKILL（name 或目录名）；非空时跳过自动匹配直接使用 |
| `taskDescription` | `string` | | 任务描述 |
| `inputReport` | `string` | | 输入报告路径 |
| `maxRetries` | `number` | | 最大重试次数（默认 3） |
| `dependId` | `number` | | 依赖步骤 ID（0 = 无依赖） |
| `nextStepId` | `number` | | 下一步骤 ID（0 = 无下一步） |
| `failStepId` | `number` | | 失败跳转步骤 ID（0 = 失败即终止） |
| `bigLoopIndex` | `number` | | 大循环索引（默认 0，由 LoopEngine 传递） |
| `cli` | `CLIController` | | 注入自定义 CLI 控制器（测试用） |
| `skillSelector` | `Agent` | | 注入自定义 Skill 选择器 |
| `storage` | `Storage` | | 注入自定义存储层 |
| `pollIntervalMs` | `number` | | 轮询间隔 ms（默认 5000） |

**`executeStart()` — 驱动单次执行流程**

本方法为**单次执行**，不内部循环。外部执行机构根据返回值决定是否再次调用进行重试。

流程（5 步）：

1. `matchSkill` → 匹配最佳 Skill（传入 `specifiedSkill` 时跳过，直接解析指定 SKILL）
2. `invokeSkill` → 通过 opencode 执行 Skill，生成 result `.md`（同时下发可选的 meta `.json` 指标文件路径约定）
3. `checkResult` → 读取 result `.md`，判断成功/失败；成功后收割 meta `.json` 为 `metrics`（通用键值对，后端不解释语义）
4. （后台异步、fire-and-forget）`_summarizeAndPersist` → `_summarizeExperience` 向同一 Session 追加经验总结 prompt 生成 Summary `.md`，再由 `persistKnowledge` 读取并持久化经验；不阻塞 `executeStart` 返回
5. 返回 `{ resultPath, success, nextStepId, metrics }`

**结构化指标（metrics）契约**：初始 prompt 中下发 `stepId{X}_loop{L}_meta_{N}.json` 路径；SKILL 若约定了结构化结论指标（如 code-check 的 `mergeLevel`、仓库检查的 `score`），由 AI 以 JSON 对象写入。后端 `_harvestMetrics` 校验后**原样**透传（`executeStart` 返回值 → Orchestrator `StepNode.metrics` → SSE/progress/持久化 JSON），新增领域字段后端零改动。

**文件命名**（按大循环轮次 `bigLoopIndex` + 步骤内重试次数 `loopCount` 区分）：
- 结果文件: `stepId{stepId}_loop{bigLoopIndex}_result_{loopCount}.md`
- 摘要文件: `stepId{stepId}_loop{bigLoopIndex}_Summary_{loopCount}.md`
- 指标文件: `stepId{stepId}_loop{bigLoopIndex}_meta_{loopCount}.json`（可选）

**返回值：**

```js
{
  resultPath: string,   // 结果文件路径
  success: boolean,     // 是否成功
  nextStepId: number,   // 成功→nextStepId；失败→failStepId（0 = 失败即终止）
  metrics: object|null  // 本次执行收割的结构化指标（无则 null）
}
```

> 控制信号（pause/resume/abort）在步骤边界检查，非实时中断。

**`canRetry()` — 判断是否还能重试**

供外部执行机构在调用 `executeStart()` 前检查。返回 `false` 表示已达最大重试次数或已终止。

**`matchSkill(taskDescription, skillDirectory)` — 匹配最佳 Skill**

基于语义拆解与重排序机制匹配最佳 Skill。当 `initContext` 传入 `specifiedSkill`（SKILL 的 name 或目录名）时，`executeStart` 会**跳过本方法**，改用 `_resolveSpecifiedSkill` 直接解析指定 SKILL（目录名精确匹配优先，其次扫描 frontmatter `name` 字段），解析失败降级为无 SKILL 模式。

委托 SkillSelector Agent（ReAct 模式）：LLM 拆解任务 → 模糊匹配召回 topK 候选 → LLM 评分排序 → 选出最佳。返回 SKILL 目录绝对路径。

**`invokeSkill(taskDescription, skillDir, reportPath?, filePaths?)` — 执行 Skill**

流程：① 健康检查 → ② 构建 prompt（含历史执行文档）→ ③ 创建 opencode Session → ④ 轮询等待完成。返回 `boolean`。

第 N 次执行时，自动收集本次大循环内之前重试的 `result .md` **路径**（不读取内容）传入 prompt，由 AI 自行读取参考，避免重复踩坑。

**`checkResult(resultFilePath)` — 判断执行结果**

读取 result `.md`，按优先级匹配执行状态：① `## 执行状态` 标题下的独立行；② `## 执行状态: 成功` 内联写法；③ 文件末尾 10 行内的 `状态: 成功` 行。状态值归一化：`成功` → `true`，`失败` → `false`；已知中间态（`部分通过` / `源库构建问题` / `环境不可用` / `设备不可用`）**视为成功**（产物已完成，记 warn）；其他未知状态值、文件不存在或无法解析 → `false`。

**`persistKnowledge(summaryFilePath)` — 持久化经验**

读取 Summary `.md` 内容，记录到 TaskStepStore 步骤记录。静默失败：持久化失败不影响主流程。

**`controlExecution(type)` — 流程控制**

| 类型 | 行为 |
|------|------|
| `pause` | 设置暂停标志，步骤边界处阻塞等待 |
| `resume` | 清除暂停标志，继续执行 |
| `abort` | 设置终止标志，尝试中止活跃 Session，记录终止状态 |

**`setAbortSignal(signal)` — 注入外部取消源（Phase 2/3 取消闭环）**

`AgentRuntime` 会把「运行器级信号 ∪ 取消树信号」合并后下发（见 `AgentRuntime._runWithAdapter`）。
收到信号后转调 `controlExecution('abort')`（幂等：已终止则不再重复执行），因此
**取消能中断在途 HTTP**，并且此后 `executeStart()` 会直接拒绝——不会出现"取消之后又建了一个新会话"。
注入时信号已中止则立即生效。

**`getSessionContent()` — 获取会话归档内容**

从 `db/Session/` 读取 `<sessionId>.jsonl`（消息流）和 `<sessionId>.meta.json`（元信息），返回合并 JSON 文本 `{ meta, messages }`。

**`getLiveMessages()` — 实时查看当前对话**

委托 CLI 的 `getLiveMessages`，从远端拉取当前已有消息。运行中安全调用，不写入本地存档，不影响后续归档去重。

**`injectPrompt(message)` — 注入上下文**

利用 CLI 的 `injectPrompt` 能力，将文本注入对话历史但**不触发 AI 回复**。适用于对话过程中动态补充规则、指令。

**`sendAndWaitMessage(message)` — 发送并等待回复**

发送消息后阻塞等待 AI 生成完整回复，返回 `{ success, response, content }`。与 fire-and-forget 发送互补，适用于简单问答场景。

#### 只读 getter

| 属性 | 类型 | 说明 |
|------|------|------|
| `taskId` | `string` | 任务 ID |
| `taskDir` | `string` | 工作目录 |
| `maxRetries` | `number` | 最大重试次数 |
| `retryTimes` | `number` | 已循环次数 |
| `startTime` / `endTime` | `string\|null` | 执行时间 |
| `inputReport` | `string` | 输入报告路径 |
| `skillDirectory` | `string` | SKILL 目录路径 |
| `taskDescription` | `string` | 任务描述 |
| `stepId` | `number` | 当前步骤 ID |
| `dependId` | `number` | 依赖步骤 ID |
| `nextStepId` | `number` | 下一步骤 ID |
| `failStepId` | `number` | 失败跳转步骤 ID |
| `bigLoopIndex` | `number` | 大循环索引（0 = 首轮） |
| `metrics` | `object\|null` | 本次执行收割的结构化指标 |
| `executeStep` | `number` | 当前已执行步骤序号 |
| `resultPath` | `string` | 最新结果文件路径 |
| `sessionId` | `string` | 会话 ID |
| `initialized` | `boolean` | 是否已初始化 |

#### 内部方法

| 方法 | 说明 |
|------|------|
| `_ensureInitialized()` | 检查是否已调用 `initContext` |
| `_persistStep(patch)` | 增量持久化步骤记录到 `db/TaskStep/`，静默失败 |
| `_buildPrompt(...)` | 构建 opencode prompt（任务描述 + SKILL 目录 + 文件路径 + 历史文档路径） |
| `_collectHistoryDocs(loopCount)` | 收集本大循环内 `retry < loopCount` 的 `result .md` **路径**（不读内容）作为上下文 |
| `_pollSession(sessionId)` | 轮询 Session 状态直到完成或超时（90 分钟） |
| `_waitIfPaused()` | 暂停时阻塞等待，直到 resume 或 abort |
| `_sleep(ms)` | Promise 版 sleep |
| `_log(level, message)` | 统一日志输出（带 CST 时间戳和 taskId 前缀） |

### index.js — 模块统一导出

```js
export { FlexRunner, ControlType, StepStatus } from './FlexRunner.js';
export { default } from './FlexRunner.js';
```

## 关键设计

### 1. 依赖惰性加载 + 注入

`CLIController` / `SkillSelectorAgent` / `createStorage` 三个依赖均为惰性 `import`（仅在未注入时才动态加载），使得测试中可通过 `initContext` 注入 mock 而无需加载 `@opencode-ai/sdk`、`openai` 等重依赖。

### 2. 单次执行 + 外部循环

`executeStart()` 为单次执行，不内部循环。外部执行机构通过 `canRetry()` 判断是否继续重试，根据返回的 `nextStepId` 决定流转方向：
- **成功** → `nextStepId`（前进到下一步骤）
- **失败** → `failStepId`（跳转修复步骤；`failStepId = 0` 时即终止，不再重试）

### 3. 历史文档累积

第 N 次执行时，`_collectHistoryDocs` 自动收集**同一大循环轮次内** `retry 0 ~ N-1` 的 `result .md` **路径**（只传路径，由 AI 自行读取），拼入 prompt 作为上下文，使 AI 能参考之前的执行结果和失败原因，避免重复踩坑。上一轮大循环的历史不在收集范围内。

### 4. 步骤边界控制

暂停 / 终止信号在 `executeStart` 内部的步骤边界（matchSkill 前、invokeSkill 前、checkResult 前）检查，而非实时中断。这保证每个步骤原子完成或完全不执行，避免中间状态。

### 5. 静默失败策略

`_persistStep` 和 `persistKnowledge` 采用静默失败策略：持久化异常仅记录 warn 日志，不中断主流程。执行结果以 result `.md` 文件为准。

## 依赖关系

| 依赖 | 来源 | 用途 |
|------|------|------|
| `CLIController` | `../CLI/cli.js` | opencode Session 管理（执行 Skill） |
| `SkillSelectorAgent` | `../Agent/SkillSelector/index.js` | 语义匹配最佳 Skill |
| `createStorage` | `../DbUse/index.js` | TaskStepStore 步骤持久化 + SessionStore 归档读取 |
| `nowCST` | `../library/cstTime.js` | 北京时间格式化 |
| `dotenv` | npm（可选） | 生产环境加载 `.env` |

## 使用示例

```js
import { FlexRunner } from './FlexRunner/index.js';

// 方式一：无参构造 + initContext
const runner = new FlexRunner();
await runner.initContext({
    taskId: 'task-001',
    stepId: 1,
    taskDir: '/workspace/tasks/task-001',
    skillDirectory: '/workspace/Server/Skills',
    taskDescription: '分析 libcurl 的鸿蒙化可行性',
    maxRetries: 3,
    dependId: 0,
    nextStepId: 2
});

// 循环执行直到成功或超过重试次数
while (runner.canRetry()) {
    const { resultPath, success, nextStepId } = await runner.executeStart();
    if (success) {
        console.log('✅ 执行成功:', resultPath);
        break;
    }
    console.log('❌ 执行失败，准备重试…');
}

// 获取会话内容
const sessionContent = await runner.getSessionContent();

// 流程控制
await runner.controlExecution('pause');   // 暂停
await runner.controlExecution('resume');  // 继续
await runner.controlExecution('abort');   // 终止
```

```js
// 方式二：构造时传入配置
const runner = new FlexRunner({
    taskId: 'task-002',
    stepId: 1,
    skillDirectory: '/workspace/Server/Skills',
    taskDescription: '检查 SQLite 鸿蒙兼容性'
});
await runner.initContext(runner._pendingConfig);
const ok = await runner.executeStart();
```

```js
// 测试场景：注入 mock 依赖
const runner = new FlexRunner();
await runner.initContext({
    taskId: 'test',
    stepId: 1,
    taskDescription: 'test',
    skillDirectory: '/skills',
    cli: mockCli,              // 注入 mock CLI
    skillSelector: mockSelector, // 注入 mock SkillSelector
    storage: mockStorage       // 注入 mock Storage
});
```

## 存储产物

执行过程中产生的文件：

```
db/
├── TaskStep/
│   └── store.db                    # SQLite 步骤记录（状态/时间/路径/经验）
└── Session/
    ├── <sessionId>.jsonl           # opencode 对话消息流
    └── <sessionId>.meta.json       # 会话元信息

{taskDir}/                              # 默认 = <数据目录>/task/{taskId}
├── stepId{stepId}_loop{bigLoopIndex}_result_0.md    # 本轮大循环第 1 次执行结果
├── stepId{stepId}_loop{bigLoopIndex}_Summary_0.md   # 本轮大循环第 1 次执行摘要
├── stepId{stepId}_loop{bigLoopIndex}_meta_0.json    # 本轮大循环第 1 次执行结构化指标（可选）
├── stepId{stepId}_loop{bigLoopIndex}_result_1.md    # 本轮大循环第 2 次执行结果（重试）
├── stepId{stepId}_loop{bigLoopIndex}_Summary_1.md   # 本轮大循环第 2 次执行摘要
└── ...
```

> result `.md` 必须包含 `## 执行状态` 字段（值为 `成功` 或 `失败`），供 `checkResult` 解析。
