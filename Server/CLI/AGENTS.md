# CLI —— AI 编程助手统一控制层

本目录封装 AI 编程助手 CLI（opencode / deveco-code）的对接能力，对外暴露一致的 Session 管理接口。上层（Routes / Agent / Web）只需面向 `CLIController` 编程，无需关心底层适配器差异。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  控制层  cli.js                                              │
│  CLIController：统一门面，按 type 委派给对应适配器            │
├──────────────────────────────────────────────────────────────┤
│  适配器层（实现在插件里，本目录只剩门面）                     │
│  ┌───────────────────────────┐  ┌────────────────────────────┐│
│  │ plugins/cli/opencode      │  │ plugins/cli/deveco-code    ││
│  │ OpenCodeCLI               │←─│ DevEcoCodeCLI（继承前者）   ││
│  │ @opencode-ai/sdk / HTTP   │  │ 同一 HTTP API，覆盖连接配置 ││
│  │ provide: ai-cli,ai-cli-impl│  │ provide: ai-cli            ││
│  └───────────────────────────┘  └────────────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│  快捷导出（纯转发）                                          │
│  opencode.js / deveco-code.js — 单独导出适配器类             │
├──────────────────────────────────────────────────────────────┤
│  公共依赖                                                    │
│  message-archive 接缝（storage/core） — 消息归档 + 卡死检测   │
│  library/StatsService  — Session 调用计数（留在 Server 侧）   │
│  plugins/cli/opencode/lib/logger — 插件内实现副本；cstTime 已归一进 core/   │
└──────────────────────────────────────────────────────────────┘
```

**适配器是从哪来的（接缝解析）：** `CLIController` 构造时先问
`core/hostBridge.js`（`Server/composition/hostBridge.js` 是转发门面）的 `resolveAiCliFactory(type)`：

1. 宿主注册了 `ai-cli@cli/<type>` → 用该插件注册的工厂（正常路径）；
2. 否则宿主注册了裸名 `ai-cli`，**且它的提供方插件名恰好是 `cli/<type>`**（用
   `host.listServices()` 读 provider 判定）→ 用该工厂；
3. 否则（含**无宿主**的默认部署形态、以及"提供方身份与 type 不符"）→ 回落
   `legacyCreate()`，即改造前的 `new OpenCodeCLI/DevEcoCodeCLI(options)`，行为逐字节等价。

> **为什么第 2 档必须核对提供方身份**：`getType()` 一直返回入参 type，而它被
> `cli/lib/opencode.js` 的 `CliServeManager` 用来决定拉起哪个 serve、哪个端口。
> 若允许"裸名随便顶替"，只装 `cli/opencode` 却构造 `new CLIController('deveco-code')`
> 就会得到 `getType()==='deveco-code'` 但实现是 OpenCodeCLI（存档 `meta.cliType` 写
> `opencode`）的**说谎适配器**。要引入全新 CLI（如 cli/claude-code），把类型名写进
> `cli.js` 的 `SUPPORTED_TYPES` 并让插件名与该类型对应即可。

非法 `type` 在解析**之前**就抛错（文案与改造前逐字一致），所以宿主模式下也不会被
裸名 `ai-cli` 兜住而悄悄放行。

## 目录结构

```
Server/CLI/
├── AGENTS.md            # 本文档
├── cli.js               # CLIController 统一控制类（默认导出）+ 接缝解析 + 遗留兜底
├── opencode.js          # OpenCodeCLI 快捷导出（纯转发）
├── opencode/
│   └── index.js         # 纯转发门面 → plugins/cli/opencode
├── deveco-code.js       # DevEcoCodeCLI 快捷导出（纯转发）
├── deveco-code/
│   └── index.js         # 纯转发门面 → plugins/cli/deveco-code（含无宿主时的基类绑定）
└── test.js              # 接口调用集成测试（连接真实 CLI 服务）

plugins/cli/
├── opencode/
│   ├── plugin.json      # seam: ai-cli，dependencies: [storage/core]
│   ├── index.js         # definePlugin：provide ai-cli（工厂）+ ai-cli-impl（基类）
│   ├── adapter.js       # OpenCodeCLI 实现体（原 Server/CLI/opencode/index.js 迁入）
│   └── lib/logger.js             # 实现副本（cstTime 已归一进 core/）
└── deveco-code/
    ├── plugin.json      # seam: ai-cli，dependencies: [cli/opencode]
    └── index.js         # definePlugin：provide ai-cli（工厂）；基类迟到绑定
```

## 文件说明

### cli.js — CLIController 统一控制类

对外默认导出 `CLIController`，具名导出 `OpenCodeCLI`、`DevEcoCodeCLI`。通过 `type` 参数在构造时选定适配器，此后所有方法委派给该适配器实例。

**构造：**

```js
new CLIController(type, options)
```

| 参数 | 说明 |
|------|------|
| `type` | `'opencode'` 或 `'deveco-code'`，**缺省时取环境变量 `CLI_TYPE`，仍未设置则 `'deveco-code'`**；不支持的值抛异常 |
| `options` | 透传给适配器（见下） |

**默认 CLI 全局指定（Server/.env）：**

env 的加载**不在本文件**（`cli.js` 自身没有隐式副作用），由三处之一保证：
① 装配点 `buildApp()`（首行 `await loadServerEnv()`）；
② CLI 侧 `cli/lib/config.js#loadEnvChain()`（系统变量 > `~/.3lib/.env` > 项目 `Server/.env`，
   跑完后调用 `markServerEnvLoaded()` 让 Server 侧 `loadServerEnv()` 变成 no-op，避免重复读）；
③ 直连入口自己显式调用（如 `Server/CLI/test.js` 顶部 `await loadServerEnv();`）。

`loadServerEnv()` 在 `Server/composition/envBootstrap.js`，**幂等**，dotenv 是可选依赖
（未安装时跳过）。在其中配置：

```bash
# Server/.env
CLI_TYPE=deveco-code          # 默认 CLI 类型（opencode | deveco-code）
# OPENCODE_HOST=localhost     # 可选：opencode 连接配置
# OPENCODE_PORT=4096
# DEVECO_HOST=localhost       # 可选：deveco-code 连接配置
# DEVECO_PORT=4096
```

也可用 shell 环境变量或命令行参数覆盖（优先级从高到低）：

```bash
node Server/Routes/server.js --port 3000 --type deveco-code   # 命令行参数
CLI_TYPE=deveco-code node Server/Routes/server.js --port 3000 # shell 环境变量
```

**优先级：** 显式 `type` 参数 > `--type` 命令行参数 > shell 环境变量 `CLI_TYPE` > `Server/.env` 的 `CLI_TYPE` > `'deveco-code'`（兜底默认）

**启动脚本联动（start-services.mjs / check-env.mjs）：**

- `start-services.mjs` 启动时通过 `check-env.mjs` 的 `resolveCliType()` / `resolveCliServePort()` 读取同一配置：
  - Server 后端以 `--type <CLI_TYPE>` 启动（不再硬编码 opencode，避免覆盖 .env）
  - CLI serve 服务按类型启动，显式 `--port <CLI_SERVE_PORT>`（与适配器同源解析，杜绝端口漂移）
- `check-env.mjs` 按 CLI_TYPE 动态检测：CLI 工具安装（opencode / deveco 命令）、模型配置文件（`~/.config/opencode/` 或 `~/.config/deveco/`，schema 相同）
- 若 `CLI_TYPE` 写了无效值，环境检测给出警告并回退 deveco-code

> dotenv 默认不覆盖已存在的环境变量，因此 shell export 天然优先于 .env。内部模块（SkillExecutor / TestCheck / KnowledgeImporter / FlexRunner / LoopEngine）均以无参 `new CLIController()` 构造，自动跟随以上默认类型。两个适配器默认端口统一为 4096（单后端架构，同一时间只运行一个 serve，切换类型无需改端口配置）；需 opencode 与 deveco serve 并存时，通过 `DEVECO_PORT` 给其一指定其他端口。serve 服务由 start-services.mjs 自动拉起（端口校验：进程在但端口不对时会自动以正确端口重启）。

**opencode 选项：** `host` / `port` / `baseUrl` / `archive`（默认端口 4096，环境变量 `OPENCODE_HOST` / `OPENCODE_PORT`）

**deveco-code 选项：** `host` / `port` / `baseUrl` / `archive`（默认端口 4096，与 opencode 一致；环境变量 `DEVECO_HOST` / `DEVECO_PORT`）

**统一接口方法：**

| 方法 | 返回 | 说明 |
|------|------|------|
| `checkHealth()` | `{ status, message }` | 探测底层服务连通性 |
| `listSessions()` | `Array<object>` | 列出所有 Session |
| `getSession(sessionId)` | `object` | 获取指定 Session 详情 |
| `startSession(title, prompt?)` | `{ sessionId, action, message }` | 创建 Session，可选附带初始 prompt |
| `sendMessage(sessionId, message)` | `{ success, response? }` | 向 Session 发送消息（异步 fire-and-forget，不等 AI 回复） |
| `sendAndWaitMessage(sessionId, message)` | `{ success, response, content }` | 发送消息并**同步等待 AI 回复完成**后返回内容 |
| `injectPrompt(sessionId, message)` | `{ success }` | 向 Session 注入上下文（**不触发 AI 响应**） |
| `checkSessionStatus(sessionId)` | `{ status, lastMessage?, stalled?, stallDurationMs?, hasNewMessage? }` | 查询状态 + 卡死检测 |
| `getSessionMessages(sessionId)` | `Array<object>` | 拉取远端消息历史（同时归档） |
| `getLiveMessages(sessionId)` | `Array<{id?,role,content,finish?,timestamp?}>` | 实时查看当前对话消息（运行中安全调用，不写入存档） |
| `getArchivedMessages(sessionId)` | `Array<object>` | 读取本地归档消息（不请求远端） |
| `exportSession(sessionId, opts?)` | `object` \| `string` | 导出完整对话（合并远端+本地，支持 `json`/`markdown` 格式） |
| `getArchiveMeta(sessionId)` | `object` | 读取本地存档元信息 |
| `listArchivedSessions()` | `Array<object>` | 列出所有本地已归档 Session |
| `abortSession(sessionId)` | `object` | 终止正在运行的任务 |
| `deleteSession(sessionId)` | `object` | 删除 Session |
| `getType()` | `'opencode'` \| `'deveco-code'` | 返回当前 CLI 类型 |
| `getAdapter()` | `OpenCodeCLI` \| `DevEcoCodeCLI` | 返回底层适配器实例 |
| `setAbortSignal(signal)` | `void` | 注入外部取消源（`AbortSignal`），使 abort 能立即中断在途 HTTP 请求；适配器不支持时静默降级 |
| `abortInFlight(reason?)` | `void` | 立即取消所有在途请求（幂等）；适配器不支持时静默降级 |

> `startSession` 内部会异步调用统计提供方的 `incrementSessionCount()` 记录调用次数，统计失败不影响
> 主流程。提供方的**优先级链**（高 → 低）：① 构造期 `options.stats`（装配层显式注入——有插件宿主时
> `buildApp` 把 `host.inject('stats')` 经 `cliOptions.stats` 递进来）→ ② `resolveStats()`（当前活跃
> 宿主的 `stats` 接缝提供方，无宿主时 `null`）→ ③ 内置 `StatsService`（无宿主时的等价路径）。

### plugins/cli/opencode — OpenCodeCLI 适配器（`Server/CLI/opencode/index.js` 是纯转发门面）

基于 `@opencode-ai/sdk`，通过 HTTP API 与运行中的 opencode 服务（默认 `localhost:4096`）通信。

**连接配置：** `host`（默认 `localhost`）/ `port`（默认 `4096`）/ `baseUrl`（优先级高于 host/port），也支持环境变量 `OPENCODE_HOST` / `OPENCODE_PORT`。

**关键设计：**

1. **轻量健康检查** — `checkHealth()` 仅调用 `session.list()` 验证连通性，不拉取全量消息。
2. **状态查询快路径** — `checkSessionStatus()` 先查 `session.status()`：`busy`/`retry` 直接返回 `running` 且不拉消息；仅 `idle` 时才拉最后 1 条消息判断 `completed`/`error`。
3. **消息归档策略** — `sendMessage` 不在本地归档用户消息，统一由 `getSessionMessages` 从远端全量拉取后归档，用 opencode 消息 `id` 去重，避免重复。状态检查时只做卡死检测，不归档消息（防止 `limit=1` 只拿到 assistant 回复导致 user/assistant 顺序错乱）。
4. **状态映射** — opencode 原始状态 `{type: "busy"|"retry"|"idle"}` 映射为统一状态：`busy`/`retry` → `running`，`idle` → `idle`，其他 → `unknown`。完成判定：`info.finish === 'stop'` 且含 text part → `completed`。
5. **初始 prompt** — `startSession` 传入 prompt 时用 `promptAsync` 异步发送（await 发送完成但不等回复），立即返回 sessionId 供上层轮询。
6. **同步等待回复（sendAndWaitMessage）** — 使用 `session.prompt()`（同步版本，URL `/session/{id}/message`），发送消息后阻塞等待 AI 生成完整回复，返回 `{ info: AssistantMessage, parts: Part[] }`。与 `sendMessage`（`promptAsync` fire-and-forget）互补：简单问答场景可直接拿到结果，复杂长任务仍用 `sendMessage` + 轮询。
7. **上下文注入（injectPrompt）** — 利用 opencode SDK `noReply: true` 能力，将文本作为 UserMessage 注入对话历史但不触发 AI 响应。适用于对话过程中动态补充上下文、规则、指令。
8. **实时消息查看** — `getLiveMessages` 从远端拉取全量消息并用 `_toArchiveMessage` 转为精简格式返回，**不写入本地存档**，适用于对话进行中查看「目前聊了什么」，不影响后续归档去重。
9. **对话导出** — `exportSession` 流程：① 远端拉全量消息 → ② `archive.appendMessages` 增量归档（去重补档，运行中也能持久化已有消息）→ ③ 读本地归档按 `seq` 排序 → ④ 按 `format` 返回。`json` 返回 `{ sessionId, meta, messages }`，`markdown` 调用 `_toMarkdown` 渲染为带元信息头的对话文档。

**内部方法：**
- `_init()` — 构造时创建 SDK client
- `_mapSessionStatus(rawStatus)` — opencode 状态 → 统一状态
- `_msgDedupeKey(msg)` — 生成去重键（优先用消息 id）
- `_toArchiveMessage(msg)` — opencode 原始消息 → 精简归档格式
- `_toMarkdown(meta, messages)` — 对话消息渲染为 Markdown

### plugins/cli/deveco-code — DevEcoCodeCLI 适配器（`Server/CLI/deveco-code/index.js` 是纯转发门面）

对接华为开源的 DevEco Code（[gitcode.com/openharmony-sig/deveco-code](https://gitcode.com/openharmony-sig/deveco-code)，npm 包 `@deveco/deveco-code`），面向 HarmonyOS 开发场景的 AI Agent 工具。

DevEco Code 基于开源项目 OpenCode 扩展开发，其 headless 服务（`deveco serve`）保留与 opencode 完全一致的 HTTP API（`/session`、`/session/{id}/message`、`/session/{id}/prompt_async`、`/session/status` 等）。因此 **DevEcoCodeCLI 直接继承 OpenCodeCLI**，复用其全部 Session 管理 / 归档 / 卡死检测逻辑，仅覆盖：

1. **连接配置** — 环境变量 `DEVECO_HOST` / `DEVECO_PORT`，默认端口 `4096`（与 opencode 一致；两者需同时运行时通过 `DEVECO_PORT` 指定不同端口）
2. **身份标识** — 存档 `meta.cliType` 写为 `'deveco-code'`（导出 Markdown 时可见），日志器名 `DevEcoCodeCLI`
3. **健康检查文案** — `checkHealth()` 返回 `DevEco Code CLI is healthy`

OpenCodeCLI 侧为支持继承抽取了两个可覆盖字段：`this.cliType`（写入存档 meta）与 `this._loggerName`（日志器名称）。

**服务启动方式：**

```bash
deveco serve                  # 默认监听 4096
# 注意：4096 被占用且未指定 --port 时会随机分配端口；
# 与 opencode 并存等场景需显式指定：deveco serve --port 4097
```

### opencode.js / deveco-code.js — 快捷导出

单行 re-export，方便单独引用适配器类：

```js
import OpenCodeCLI from './CLI/opencode.js';
import DevEcoCodeCLI from './CLI/deveco-code.js';
```

### test.js — 集成测试

默认连接真实运行的 deveco serve（`localhost:4096`，跟随 CLI_TYPE 默认值），按真实使用流程依次调用 `CLIController` 全部接口。可通过环境变量切换目标 CLI（如 opencode）：

```bash
CLI_TYPE=opencode node Server/CLI/test.js
# 环境变量：CLI_TYPE（opencode | deveco-code）/ CLI_HOST / CLI_PORT
```

流程：

```
checkHealth → listSessions → startSession(prompt) →
checkSessionStatus(轮询等待) → sendMessage → getLiveMessages(运行中实时查看) →
checkSessionStatus → getSessionMessages → getSession →
getArchivedMessages → getArchiveMeta → exportSession(json) → exportSession(markdown) →
listArchivedSessions → abortSession →
不支持类型异常测试
```

> `deleteSession` 测试默认注释（避免清理测试 Session）。

## 公共依赖

- **`message-archive` 接缝**（提供方 `plugins/storage/core`）— 消息归档与卡死检测。
  适配器按三级优先级取归档（构造函数内实现）：
  ① `options.archive`（显式传入，永远最优先）→ ② 类静态 `defaultArchiveFactory`
  （由插件 setup 挂成 `message-archive` 接缝工厂；无宿主时由本目录的
  `opencode/index.js` / `deveco-code/index.js` 门面在 import 期挂成"接缝工厂 → 内置
  `MessageArchive`"）→ ③ 都没有则抛错（fail closed）。
  这条静态钩子是为兼容 `new OpenCodeCLI()`（`opencode.js` 快捷导出）这类历史用法才存在的。
  归档文件写入 `db/Session/<sessionId>.jsonl`（消息流）和 `.meta.json`（元信息）。
- **统计提供方（`stats` 接缝 / 内置 `library/StatsService`）** — `CLIController.startSession` 调用
  提供方的 `incrementSessionCount()` 累计 Session 调用次数，默认写入 `db/web/visit-stats.json`。
  取值优先级链见上文「统一接口方法」后的说明：**显式 `options.stats`（装配层注入）> 活跃宿主的
  `stats` 接缝 > 内置 `StatsService`**。内置实现刻意留在 Server 侧门面：它是服务端统计，不属于
  AI CLI 适配能力，所以**不**塞进 `ai-cli` 插件的工厂选项（`CLIController` 会把 `options.stats`
  摘出来，不转发给适配器）。
- **`core/cstTime.js`**（`Server/library/cstTime.js` 是转发门面）— `nowCST()` 将 epoch 毫秒格式化为北京时间字符串（`+08:00` 偏移），用于消息时间戳和存档元信息。全仓库**只有这一份实现**：插件直接 `import '../../../core/cstTime.js'`（R2 允许插件引用 `core/`），不再有副本。

## 卡死检测机制

适配器通过 `archive.recordCheck(sessionId, { lastMessageId, status })` 实现卡死检测（底层为 `SessionStore`）：

1. 每次状态检查时传入当前最后一条消息的去重键 `lastMessageId`
2. 若与上次相同（`hasNewMessage=false`），则保持 `lastResponseAt` 不变
3. 若 `status` 为 `running` 且距 `lastResponseAt` 超过阈值（默认 5 分钟），返回 `stalled: true`
4. 适配器将状态映射为 `'stalled'` 返回给上层，上层可据此触发 abort 或告警

## 扩展指南

**新增 CLI 适配器（插件化之后）：**

1. 新建 `plugins/cli/<name>/`：`plugin.json`（`seam: "ai-cli"` + `dependencies`）与
   `index.js`（`definePlugin`，`setup` 里 `ctx.provide('ai-cli', (options) => new XxxCLI({...}))`），
   适配器方法集对齐 `seams/ai-cli.js`
2. `dependencies` 里必须有**归档来源**（`storage/core`，或继承同族插件时带上它）；
   `setup` 里 `ctx.inject('message-archive')` 取不到就在启动期 fail closed。
   同时把接缝工厂挂到适配器类的静态钩子上（`XxxCLI.defaultArchiveFactory = archiveFactory`），
   让"不走插件工厂、直接 `new XxxCLI()`"的用法也能拿到归档
3. 若新类型要能被 `CLIController` 选中：把类型名加进 `Server/CLI/cli.js` 的
   `SUPPORTED_TYPES`（闭集，非法值仍按原文案抛错），**并让插件名与类型对应**
   （`cli/<type>`——裸名 `ai-cli` 只有在提供方就是该类型插件时才会被采用），
   最后在 profile 里启用该插件
4. **本目录的 `switch` 已经不存在**，不需要再改 `cli.js` 的适配器构造分支；
   顶替某个现有类型 = 用另一个插件占据**同一个插件名**（`cli/<type>`）并提供 `ai-cli`
5. 更新本文档

**共享 MessageArchive 实例：**

多个控制器需共享同一份本地归档时，构造时传入同一实例：

```js
const archive = new MessageArchive();
const oc = new CLIController('opencode', { archive });
```
