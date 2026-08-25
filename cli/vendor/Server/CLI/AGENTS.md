# CLI —— AI 编程助手统一控制层

本目录封装两类 AI 编程助手 CLI（opencode / copilot）的对接能力，对外暴露一致的 Session 管理接口。上层（Routes / Agent / Web）只需面向 `CLIController` 编程，无需关心底层适配器差异。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  控制层  cli.js                                              │
│  CLIController：统一门面，按 type 动态委派给对应适配器        │
├──────────────────────────────────────────────────────────────┤
│  适配器层                                                    │
│  ┌─────────────────────┐    ┌─────────────────────┐         │
│  │ opencode/index.js   │    │ copilot/index.js    │         │
│  │ OpenCodeCLI         │    │ CopilotCLI          │         │
│  │ @opencode-ai/sdk    │    │ @github/copilot-sdk │         │
│  │ HTTP API            │    │ SDK 直连            │         │
│  └─────────────────────┘    └─────────────────────┘         │
├──────────────────────────────────────────────────────────────┤
│  快捷导出                                                    │
│  opencode.js / copilot.js — 单独导出适配器类                 │
├──────────────────────────────────────────────────────────────┤
│  公共依赖                                                    │
│  DbUse/MessageArchive  — 消息归档 + 卡死检测                 │
│  library/StatsService  — Session 调用计数                    │
│  library/cstTime       — 北京时间格式化                      │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
Server/CLI/
├── AGENTS.md            # 本文档
├── cli.js               # CLIController 统一控制类（默认导出）
├── opencode.js          # OpenCodeCLI 快捷导出
├── copilot.js           # CopilotCLI 快捷导出
├── opencode/
│   └── index.js         # OpenCodeCLI 适配器（@opencode-ai/sdk）
├── copilot/
│   └── index.js         # CopilotCLI 适配器（@github/copilot-sdk）
└── test.js              # 接口调用集成测试（连接真实 opencode 服务）
```

## 文件说明

### cli.js — CLIController 统一控制类

对外默认导出 `CLIController`，具名导出 `OpenCodeCLI` / `CopilotCLI`。通过 `type` 参数在构造时选定适配器，此后所有方法委派给该适配器实例。

**构造：**

```js
new CLIController(type, options)
```

| 参数 | 说明 |
|------|------|
| `type` | `'opencode'` \| `'copilot'`，不支持的值抛异常 |
| `options` | 透传给对应适配器（见下） |

**opencode 选项：** `host` / `port` / `baseUrl` / `archive`
**copilot 选项：** `gitHubToken` / `cliPath` / `cliUrl` / `sendTimeout` / `archive`

**统一接口方法：**

| 方法 | 返回 | 说明 |
|------|------|------|
| `checkHealth()` | `{ status, message }` | 探测底层服务连通性 |
| `listSessions()` | `Array<object>` | 列出所有 Session |
| `getSession(sessionId)` | `object` | 获取指定 Session 详情 |
| `startSession(title, prompt?)` | `{ sessionId, action, message }` | 创建 Session，可选附带初始 prompt |
| `sendMessage(sessionId, message)` | `{ success, response? }` | 向 Session 发送消息（异步 fire-and-forget，不等 AI 回复） |
| `sendAndWaitMessage(sessionId, message)` | `{ success, response, content }` | 发送消息并**同步等待 AI 回复完成**后返回内容 |
| `injectPrompt(sessionId, message)` | `{ success }` | 向 Session 注入上下文（**不触发 AI 响应**，仅 opencode 支持） |
| `checkSessionStatus(sessionId)` | `{ status, lastMessage?, stalled?, stallDurationMs?, hasNewMessage? }` | 查询状态 + 卡死检测 |
| `getSessionMessages(sessionId)` | `Array<object>` | 拉取远端消息历史（同时归档） |
| `getLiveMessages(sessionId)` | `Array<{id?,role,content,finish?,timestamp?}>` | 实时查看当前对话消息（运行中安全调用，不写入存档） |
| `getArchivedMessages(sessionId)` | `Array<object>` | 读取本地归档消息（不请求远端） |
| `exportSession(sessionId, opts?)` | `object` \| `string` | 导出完整对话（合并远端+本地，支持 `json`/`markdown` 格式） |
| `getArchiveMeta(sessionId)` | `object` | 读取本地存档元信息 |
| `listArchivedSessions()` | `Array<object>` | 列出所有本地已归档 Session |
| `abortSession(sessionId)` | `object` | 终止正在运行的任务 |
| `deleteSession(sessionId)` | `object` | 删除 Session |
| `getType()` | `'opencode'` \| `'copilot'` | 返回当前 CLI 类型 |
| `getAdapter()` | `OpenCodeCLI` \| `CopilotCLI` | 返回底层适配器实例 |

> `startSession` 内部会异步调用 `StatsService.incrementSessionCount()` 记录调用次数，统计失败不影响主流程。

### opencode/index.js — OpenCodeCLI 适配器

基于 `@opencode-ai/sdk`，通过 HTTP API 与运行中的 opencode 服务（默认 `localhost:4096`）通信。

**连接配置：** `host`（默认 `localhost`）/ `port`（默认 `4096`）/ `baseUrl`（优先级高于 host/port），也支持环境变量 `OPENCODE_HOST` / `OPENCODE_PORT`。

**关键设计：**

1. **轻量健康检查** — `checkHealth()` 仅调用 `session.list()` 验证连通性，不拉取全量消息。
2. **状态查询快路径** — `checkSessionStatus()` 先查 `session.status()`：`busy`/`retry` 直接返回 `running` 且不拉消息；仅 `idle` 时才拉最后 1 条消息判断 `completed`/`error`。
3. **消息归档策略** — `sendMessage` 不在本地归档用户消息，统一由 `getSessionMessages` 从远端全量拉取后归档，用 opencode 消息 `id` 去重，避免重复。状态检查时只做卡死检测，不归档消息（防止 `limit=1` 只拿到 assistant 回复导致 user/assistant 顺序错乱）。
4. **状态映射** — opencode 原始状态 `{type: "busy"|"retry"|"idle"}` 映射为统一状态：`busy`/`retry` → `running`，`idle` → `idle`，其他 → `unknown`。完成判定：`info.finish === 'stop'` 且含 text part → `completed`。
5. **初始 prompt** — `startSession` 传入 prompt 时用 `promptAsync` 异步发送（await 发送完成但不等回复），立即返回 sessionId 供上层轮询。
6. **同步等待回复（sendAndWaitMessage）** — 使用 `session.prompt()`（同步版本，URL `/session/{id}/message`），发送消息后阻塞等待 AI 生成完整回复，返回 `{ info: AssistantMessage, parts: Part[] }`。与 `sendMessage`（`promptAsync` fire-and-forget）互补：简单问答场景可直接拿到结果，复杂长任务仍用 `sendMessage` + 轮询。
7. **上下文注入（injectPrompt）** — 利用 opencode SDK `noReply: true` 能力，将文本作为 UserMessage 注入对话历史但不触发 AI 响应。适用于对话过程中动态补充上下文、规则、指令。Copilot SDK 不支持此能力（`sendAndWait` 始终触发回复），调用会抛出 not-supported 错误。
6. **实时消息查看** — `getLiveMessages` 从远端拉取全量消息并用 `_toArchiveMessage` 转为精简格式返回，**不写入本地存档**，适用于对话进行中查看「目前聊了什么」，不影响后续归档去重。
7. **对话导出** — `exportSession` 流程：① 远端拉全量消息 → ② `archive.appendMessages` 增量归档（去重补档，运行中也能持久化已有消息）→ ③ 读本地归档按 `seq` 排序 → ④ 按 `format` 返回。`json` 返回 `{ sessionId, meta, messages }`，`markdown` 调用 `_toMarkdown` 渲染为带元信息头的对话文档。

**内部方法：**
- `_init()` — 构造时创建 SDK client
- `_mapSessionStatus(rawStatus)` — opencode 状态 → 统一状态
- `_msgDedupeKey(msg)` — 生成去重键（优先用消息 id）
- `_toArchiveMessage(msg)` — opencode 原始消息 → 精简归档格式
- `_toMarkdown(meta, messages)` — 对话消息渲染为 Markdown

### copilot/index.js — CopilotCLI 适配器

基于 `@github/copilot-sdk`，通过 `CopilotClient` 单例与 GitHub Copilot 交互。懒加载连接，按需创建/管理 Session。

**连接配置：**
- `cliUrl` — 连接已有外部 Copilot 服务（host:port），优先级最高
- 否则用 `cliPath` + `gitHubToken`（PAT），或不传 token 时 `useLoggedInUser = true`（使用已登录用户凭据）
- `sendTimeout` — 每条消息发送超时（默认 20 分钟）

**关键设计：**

1. **Client 懒加载** — `_getClient()` 首次调用时创建 `CopilotClient` 并 `start()`，后续复用。
2. **内存 Session 记录** — `sessions: Map<sessionId, SessionRecord>` 维护标题、消息、状态、createdAt 及底层 `CopilotSession` 引用。`listSessions` 融合 SDK 持久化列表与内存状态。
3. **消息归档策略** — 与 OpenCodeCLI 不同，CopilotCLI 在 `sendMessage` 中即时归档用户消息和 assistant 响应（fire-and-forget），用本地 `timestamp:content.length` 作为去重键。归档前先 `recordCheck`（此时 meta.lastMessageId 尚未更新 → `hasNewMessage=true` → 刷新 `lastResponseAt`），再 `appendMessage` 更新 lastMessageId。
4. **初始 prompt** — `startSession` 传入 prompt 时以 fire-and-forget 方式后台调用 `sendMessage`，立即返回 sessionId。`record.status` 由 `sendMessage` 内部同步更新（`running` → `completed` / `error`），上层通过 `checkSessionStatus` 轮询内存状态。
5. **abort** — 调用底层 `session.abort()` 中断任务，Session 仍可继续使用。
6. **delete** — 先尝试 SDK 删除（失败忽略），再从内存移除；**保留本地存档文件**用于事后审计。
7. **实时消息查看** — `getLiveMessages` 直接返回内存 `record.messages` 的副本（浅拷贝去引用），运行中也能完整读取，不写入本地存档，不影响后续归档去重。
8. **对话导出** — `exportSession` 流程：① 内存消息 `archive.appendMessages` 增量归档（去重）→ ② 读本地归档按 `seq` 排序 → ③ 按 `format` 返回。`json` 返回 `{ sessionId, meta, messages }`，`markdown` 调用 `_toMarkdown` 渲染。

**内部方法：**
- `_getClient()` — 懒加载并启动 CopilotClient 单例
- `_toMarkdown(meta, messages)` — 对话消息渲染为 Markdown

**SessionRecord 结构：**

```js
{
  id, title,
  messages: [{ role, content, timestamp }],
  status: 'idle'|'running'|'completed'|'error'|'aborted',
  createdAt,
  session  // CopilotSession 实例
}
```

### opencode.js / copilot.js — 快捷导出

单行 re-export，方便单独引用某个适配器类：

```js
import OpenCodeCLI from './CLI/opencode.js';
import CopilotCLI from './CLI/copilot.js';
```

### test.js — 集成测试

连接真实运行的 opencode 服务（`localhost:4096`），按真实使用流程依次调用 `CLIController` 全部接口：

```
checkHealth → listSessions → startSession(prompt) →
checkSessionStatus(轮询等待) → sendMessage → getLiveMessages(运行中实时查看) →
checkSessionStatus → getSessionMessages → getSession →
getArchivedMessages → getArchiveMeta → exportSession(json) → exportSession(markdown) →
listArchivedSessions → abortSession →
Copilot checkHealth 探测 → 不支持类型异常测试
```

> `deleteSession` 测试默认注释（避免清理测试 Session）。Copilot 适配器因需 GitHub 凭据，仅做 `checkHealth` 健康探测。

## 两种适配器对比

| 维度 | OpenCodeCLI | CopilotCLI |
|------|-------------|------------|
| 通信方式 | HTTP API（`@opencode-ai/sdk`） | SDK 直连（`@github/copilot-sdk`） |
| Session 存储 | 远端 opencode 服务管理 | SDK 持久化 + 内存 Map |
| 消息来源 | 远端拉取（`session.messages`） | 内存记录（`sendAndWait` 返回） |
| 消息归档时机 | `getSessionMessages` 全量拉取时统一归档 | `sendMessage` 时即时归档 |
| 去重键 | opencode 消息 `id`（全局唯一） | `role:timestamp:content.length` |
| 初始 prompt 执行 | `await promptAsync`（发送完成即返回） | fire-and-forget `sendMessage` |
| 状态判定 | `session.status()` + 最后消息 `finish` | 内存 `record.status` |
| 卡死检测快路径 | 有（`busy`/`retry` 不拉消息） | 无（直接读内存状态） |
| abort | 远端 `session.abort()` | 内存 `session.abort()` |
| delete | 远端 `session.delete()` | SDK 删除 + 内存移除 |
| getLiveMessages 数据源 | 远端拉取 → `_toArchiveMessage` 转精简格式 | 内存 `record.messages` 副本 |
| exportSession 合并源 | 远端全量 + 本地归档 | 内存 + 本地归档 |
| Markdown 渲染 | `_toMarkdown(meta, messages)` | `_toMarkdown(meta, messages)`（实现一致） |

## 公共依赖

- **`DbUse/MessageArchive`** — 消息归档与卡死检测。两个适配器均默认自建实例（`new MessageArchive()`），也支持通过 `options.archive` 注入共享实例。归档文件写入 `db/Session/<sessionId>.jsonl`（消息流）和 `.meta.json`（元信息）。
- **`library/StatsService`** — `CLIController.startSession` 调用 `StatsService.incrementSessionCount()` 累计 Session 调用次数，写入 `db/web/visit-stats.json`。
- **`library/cstTime`** — `nowCST()` 将 epoch 毫秒格式化为北京时间字符串（`+08:00` 偏移），用于消息时间戳和存档元信息。

## 卡死检测机制

两个适配器均通过 `archive.recordCheck(sessionId, { lastMessageId, status })` 实现卡死检测（底层为 `SessionStore`）：

1. 每次状态检查时传入当前最后一条消息的去重键 `lastMessageId`
2. 若与上次相同（`hasNewMessage=false`），则保持 `lastResponseAt` 不变
3. 若 `status` 为 `running` 且距 `lastResponseAt` 超过阈值（默认 5 分钟），返回 `stalled: true`
4. 适配器将状态映射为 `'stalled'` 返回给上层，上层可据此触发 abort 或告警

## 扩展指南

**新增 CLI 适配器：**

1. 在 `Server/CLI/<name>/index.js` 实现适配器类，提供与 `OpenCodeCLI` / `CopilotCLI` 相同的方法集
2. 在 `cli.js` 的 `CLIController` 构造函数 `switch` 中注册新 `type`
3. 更新本文档的对比表

**共享 MessageArchive 实例：**

多个适配器需共享同一份本地归档时，构造时传入同一实例：

```js
const archive = new MessageArchive();
const oc = new CLIController('opencode', { archive });
const cp = new CLIController('copilot', { archive });
```
