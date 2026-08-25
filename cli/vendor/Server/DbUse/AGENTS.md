# DbUse —— 统一持久化存储模块

本目录提供项目所有持久化存储能力的统一入口，采用「入口层 → Store 层 → Manager → Adapter 层」的四层架构，实现高内聚低耦合、业务逻辑与存储格式解耦。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  index.js                                            │
│  对外统一导出：createStorage() 工厂 + 各 Store/Adapter 类     │
├──────────────────────────────────────────────────────────────┤
│  Store 层  stores/                                           │
│  业务语义：SessionStore / TaskStepStore                      │
│  只依赖适配器接口，不感知存储格式                             │
├──────────────────────────────────────────────────────────────┤
│  Manager   StorageManager.js                                 │
│  工厂/注册表：统一根目录、按 (type,subDir) 复用适配器实例     │
├──────────────────────────────────────────────────────────────┤
│  Adapter 层 adapters/                                        │
│  存储格式实现：Json / Jsonl / Sqlite / File (+ Base)         │
│  互不依赖，新增格式只需加子类                                │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
Server/DbUse/
├── index.js                 # 入口：createStorage() 门面工厂 + 全量导出
├── StorageManager.js        # 存储管理器：根目录解析 + 适配器实例缓存
├── MessageArchive.js        # 兼容门面（代理 SessionStore，供旧 CLI 使用）
├── test.js                  # 功能验证测试（临时目录，自动清理）
├── adapters/                # 存储格式适配器
│   ├── BaseAdapter.js       # 抽象基类：根目录/工具方法/接口契约
│   ├── FileAdapter.js       # 原始文件读写（文本/二进制）
│   ├── JsonAdapter.js       # JSON 文档存储（整文件读写）
│   ├── JsonlAdapter.js      # JSONL 流式追加（append-only 消息流）
│   └── SqliteAdapter.js     # SQLite 存储（better-sqlite3，查询/事务）
└── stores/                  # 业务语义 Store
    ├── SessionStore.js      # Session 对话存档 + 卡死检测
    └── TaskStepStore.js     # 任务步骤 CRUD + 状态流转 + 统计
```

## 存储布局

所有数据默认写入 workspace 根下 `db/` 目录（自动创建）：

```
db/
├── Session/                 # Session 对话存档
│   ├── <sid>.jsonl          #   消息流（append-only）
│   └── <sid>.meta.json      #   元信息
├── TaskStep/                # 任务步骤存档
│   └── store.db             #   SQLite 数据库
└── Artifacts/               # 任务产物文件（原始文件）
```

子域名称常量定义于 `index.js` 的 `SubDirs`：
- `SubDirs.SESSION` = `'Session'`
- `SubDirs.TASK_STEP` = `'TaskStep'`
- `SubDirs.ARTIFACTS` = `'Artifacts'`

## 文件说明

### index.js — 入口层

对外统一出口，核心是 `createStorage(options)` 工厂函数，组合各 Store 并共享同一 `StorageManager`。

**导出：**
- `createStorage(options)` — 创建存储门面
- `StorageManager` / `SessionStore` / `TaskStepStore` / `MessageArchive` — 类直接导出
- `BaseAdapter` / `JsonAdapter` / `JsonlAdapter` / `SqliteAdapter` / `FileAdapter` — 适配器导出
- `SubDirs` — 子域名称常量（`Object.freeze`）

**`createStorage(options)` 返回的门面对象：**

| 方法 | 说明 |
|------|------|
| `manager` | 底层 `StorageManager` 实例 |
| `sessionStore()` | 懒初始化的 `SessionStore`（jsonl + json，subDir=Session） |
| `taskStepStore()` | 懒初始化的 `TaskStepStore`（sqlite，subDir=TaskStep） |
| `messageArchive()` | 懒初始化的 `MessageArchive`（兼容门面，代理 SessionStore） |
| `json(subDir)` / `jsonl(subDir)` / `sqlite(subDir)` | 直接取适配器（供自定义 Store） |
| `file(subDir?)` | 取 FileAdapter（默认 subDir=Artifacts） |
| `close()` | 关闭所有适配器（释放 DB 连接等） |

**options 参数：**
- `rootDir` — 存储根目录绝对路径（默认 workspace 根 `/db`）
- `stallThresholdMs` — Session 卡死判定阈值（默认 5 分钟）

**使用示例：**
```js
import { createStorage } from './DbUse/index.js';
const storage = createStorage();
const sessionStore = storage.sessionStore();
const taskStepStore = storage.taskStepStore();
// ... 使用 ...
await storage.close();
```

### StorageManager.js — 存储管理器

集中管理存储根目录与适配器实例缓存，对上层 Store 屏蔽适配器构造细节。

**核心职责：**
1. 解析存储根目录 `db/`（本文件上溯 3 层到 workspace 根）
2. 按子域 `(type, subDir)` 创建并缓存适配器实例，**同一组合复用同一实例**
3. 工厂方法 `get(type, subDir, adapterOpts)` 统一构造
4. `closeAll()` 统一生命周期管理

**适配器注册表 `_ADAPTERS`：**
```js
{ json: JsonAdapter, jsonl: JsonlAdapter, sqlite: SqliteAdapter, file: FileAdapter }
```

**便捷方法：** `json(subDir)` / `jsonl(subDir)` / `sqlite(subDir)` / `file(subDir)`

**缓存键：** `${type}:${subDir}`，未命中时构造新实例并缓存。

**扩展方式：**
- 新增存储格式：实现 `BaseAdapter` 子类 → 注册到 `_ADAPTERS` → Manager 自动可用
- 新增业务存储：实现 Store，依赖 `manager.get()` 获取适配器，不感知格式

### MessageArchive.js — 兼容门面

⚠️ 现为 `SessionStore` 的薄代理，保留原构造签名与方法，使现有 CLI 适配器（OpenCodeCLI / CopilotCLI）的 `new MessageArchive()` 与 `this.archive.*` 调用无需改动即可工作。

实际逻辑已迁入 `stores/SessionStore.js`，存储细节下沉到 `adapters/` 层。**新代码请直接使用 `StorageManager` + `SessionStore`**（见 `index.js` 导出）。

**代理的方法：** `readMeta` / `writeMeta` / `patchMeta` / `appendMessage` / `appendMessages` / `readMessages` / `readLastMessage` / `listSessions` / `recordCheck` / `deleteSession`

## adapters/ — 存储格式适配器

### BaseAdapter.js — 抽象基类

所有适配器的基类，提供：
- 统一根目录解析（相对路径 → 绝对路径）
- `ensureDir()` 幂等且并发安全的目录确保
- `path(...segments)` / `pathSync(...segments)` 路径拼接工具
- 接口契约：`read/write/delete/list` 默认抛 `NotImplementedError`，子类按需覆盖
- `type` 属性返回适配器类型标识

**构造参数：** `baseDir`（工作根目录，绝对路径）/ `subDir`（子目录名）

### FileAdapter.js — 原始文件读写

用途：任务产物落盘、二进制内容、非结构化文本。**不做 JSON 序列化，原样读写。**

| 方法 | 说明 |
|------|------|
| `write(key, content, opts)` | 写入文件（覆盖），`opts.binary` 控制编码 |
| `read(key, opts)` / `readFile(key, opts)` | 读取，不存在返回 `null` |
| `createFile(key, content, opts)` | 原子创建（`O_EXCL`），已存在返回 `false` |
| `appendFile(key, content, opts)` | 追加内容 |
| `exists(key)` | 是否存在 |
| `stat(key)` | 文件信息，不存在返回 `null` |
| `delete(key)` | 删除，不存在返回 `false` |
| `list(pattern)` | 列举文件名（前缀过滤） |

`key` 即相对 `rootDir` 的文件路径，可含子目录与扩展名。

### JsonAdapter.js — JSON 文档存储

用途：结构化小型文档（meta、配置、快照），整文件读写。一个 key 对应一个 `<key>.json`。

- `read(key)` → 反序列化 JSON，不存在返回 `null`
- `write(key, data)` → 序列化写入（`JSON.stringify(data, null, 2)`）
- `delete(key)` / `list()`

**不适用：** 高频追加的消息流（用 `JsonlAdapter`）、大量记录（用 `SqliteAdapter`）。

### JsonlAdapter.js — JSONL 流式追加

用途：append-only 消息流、事件日志等高频追加场景。一个 key 对应一个 `<key>.jsonl`，每行一条 JSON。

| 方法 | 说明 |
|------|------|
| `append(key, record)` | 追加一条记录（`O(1)`） |
| `appendBatch(key, records)` | 批量追加 |
| `read(key)` | 读取全部记录（按行序，跳过损坏行） |
| `readLast(key)` | 读取最后一条 |
| `delete(key)` / `list()` | — |

**优势：** 追加写入 `O(1)`、天然增量、单文件损坏只影响该 key。

### SqliteAdapter.js — SQLite 存储

用途：结构化、需要查询/索引/事务的大量记录存储（如任务步骤）。基于 `better-sqlite3`（同步 API，通过 async 包装保持接口一致）。

**特性：**
- 懒加载数据库连接，首次操作时打开
- WAL 模式 + `synchronous = NORMAL` 性能优化
- 预编译 statement 缓存

| 方法 | 说明 |
|------|------|
| `exec(sql, params?)` | 执行 DDL/DML |
| `all(sql, params?)` | 查询返回所有匹配行 |
| `get(sql, params?)` | 查询返回首行 |
| `upsert(table, row)` | INSERT OR REPLACE（要求表有主键/唯一约束） |
| `transaction(fn)` | 事务中执行多个同步写操作 |
| `close()` | 关闭连接 |

⚠️ **通用 `read/write/list` 抛错**，SQLite 表结构由具体 Store 定义。默认 db 文件名 `store.db`。

**依赖：** `better-sqlite3`（未安装时给出清晰提示：`npm install better-sqlite3`）

## stores/ — 业务语义 Store

### SessionStore.js — Session 对话存档

组合 `JsonlAdapter`（消息流）+ `JsonAdapter`（元信息），subDir 均为 `Session`。

**元信息 meta 结构：**
```js
{
  sessionId, title, cliType, createdAt,
  status,          // 'idle' / 'running' / 'stalled' / 自定义
  lastMessageId,   // 最近消息的去重 ID
  lastResponseAt,  // 最近 assistant 响应时间
  lastCheckAt,     // 最近轮询检查时间
  archivedCount    // 已归档消息数
}
```

**方法：**

| 方法 | 说明 |
|------|------|
| `readMeta(sessionId)` | 读取元信息，不存在返回默认值 |
| `writeMeta(sessionId, meta)` | 整体写入 |
| `patchMeta(sessionId, patch)` | 合并更新 |
| `appendMessage(sessionId, message, opts)` | 追加消息（带去重），返回 `{appended, seq, message}` |
| `appendMessages(sessionId, messages)` | 批量追加，返回 `{appended, skipped}` |
| `readMessages(sessionId)` | 读取全部已归档消息 |
| `readLastMessage(sessionId)` | 读取最后一条 |
| `listSessions()` | 列出所有会话（按 createdAt 降序） |
| `recordCheck(sessionId, current)` | 轮询检查 + 卡死判定 |
| `deleteSession(sessionId)` | 删除会话（jsonl + meta） |

**去重机制：** `opts.dedupeKey`（或 `message.id`）与 `meta.lastMessageId` 相同则跳过。

**卡死检测：** `recordCheck` 计算自 `lastResponseAt` 起的停滞时长 `stallDurationMs`，当 `status === 'running'` 且超过 `stallThresholdMs`（默认 5 分钟）时 `stalled=true`、`status='stalled'`。

返回结构：
```js
{ status, stallDurationMs, stalled, hasNewMessage, meta }
```

### TaskStepStore.js — 任务步骤存储

基于 `SqliteAdapter`，subDir 为 `TaskStep`。表 `task_steps`，索引 `task_id` / `(task_id, seq)` / `status`。

**表结构（核心字段）：**
- `id` (TEXT PK) — 步骤唯一 ID（`randomUUID` 自动生成）
- `task_id` (TEXT NOT NULL) — 所属任务 ID
- `seq` (INTEGER NOT NULL) — 步骤序号（同任务内递增）
- `name` / `type` — 步骤名称/类型（如 `cli`/`db`/`file`/`custom`）
- `status` (TEXT) — `pending` / `running` / `completed` / `error` / `skipped`
- `input` / `output` / `meta` — JSON 字符串字段
- `error` — 错误信息
- `started_at` / `finished_at` / `duration_ms` — 时间戳与耗时
- `created_at` / `updated_at` — 创建/更新时间

**方法：**

| 方法 | 说明 |
|------|------|
| `create(step)` | 创建步骤，自动生成 `id` 和 `seq`，初始 `status='pending'` |
| `get(id)` | 按 ID 获取，返回业务对象或 `null` |
| `listByTask(taskId)` | 列出任务所有步骤（按 seq 升序） |
| `listByStatus(status)` | 按状态查询（按 created_at 升序） |
| `update(id, patch)` | 更新状态/输出/错误/meta，自动维护时间戳与耗时 |
| `delete(id)` | 删除步骤 |
| `deleteByTask(taskId)` | 删除任务所有步骤 |
| `stats(taskId)` | 统计各状态数量，返回 `{total, pending, running, completed, error, skipped}` |

**状态流转自动化：**
- → `running`：自动设置 `started_at`
- → `completed`/`error`/`skipped`：自动设置 `finished_at`，并基于 `started_at` 计算 `duration_ms`

**字段映射：** 数据库 snake_case ↔ 业务对象 camelCase（`_rowToObj` 自动转换，JSON 字段自动解包）。

## 扩展指南

### 新增业务存储

1. 在 `stores/` 下新建 `XxxStore.js`，构造时接收所需适配器
2. 通过 `manager.get(type, subDir)` 取适配器（或由 `createStorage` 注入）
3. 业务逻辑只依赖适配器接口，不感知存储格式
4. 在 `index.js` 的 `createStorage()` 中挂载懒初始化访问器并导出

### 新增存储格式

1. 在 `adapters/` 下继承 `BaseAdapter`，实现 `read/write/delete/list` 等
2. 注册到 `StorageManager._ADAPTERS`（静态 getter）
3. Manager 自动可用 `manager.get('newtype', subDir)`

## 测试

```bash
node Server/DbUse/test.js
```

测试写入临时目录 `db_test_tmp/`，结束自动清理，不污染真实 `db/`。

**验证项：**
1. `StorageManager` 实例缓存（同 `type+subDir` 返回同一实例）
2. `SessionStore` 消息归档 + 去重 + 卡死检测
3. `TaskStepStore` CRUD + 状态流转 + 统计
4. `MessageArchive` 代理兼容性
5. `FileAdapter` 原始文件写入/读取（含 `createFile` 原子性、`appendFile`）
6. `StorageManager.closeAll()`

## 依赖

- `better-sqlite3` — SQLite 原生绑定（`SqliteAdapter` 使用，未安装时给出安装提示）
- Node.js 内置：`node:fs` / `node:path` / `node:url` / `node:crypto`
