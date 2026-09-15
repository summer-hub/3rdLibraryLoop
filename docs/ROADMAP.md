# ROADMAP —— 修复计划与架构演进路线

> 本文档定义 3rdLibraryLoop 的**修复基线（Phase 1）**与**三阶段架构演进（Phase 2~4）**。
> 所有结论均基于源码直读，标注 `file:line` 证据，可直接复核。
>
> 仓库约定：**唯一远端** `https://gitcode.com/summor/3rdLibraryLoop.git`（fetch + push），
> 不允许出现其他 remote、不允许 `insteadOf` 地址重写。

---

## 0. 仓库与分支基线

### 0.1 远端约定

```bash
# 唯一合法远端（已确认 fetch/push 均为该地址）
git remote set-url origin https://gitcode.com/summor/3rdLibraryLoop.git
git remote -v   # 应只输出 origin 两行，且 URL 一致
```

禁止：新增第二 remote、`git config url.<x>.insteadOf` 重写、把 `cli/package.json` 的
`homepage/repository/bugs` 指向其它命名空间（当前仍指向旧的 `lalhanOrz`，见 F-19）。

### 0.2 分支模型（⚠️ 已被取代 —— 见 §0.3，保留以记录原始意图）

| 分支 | 基线 | 内容 | 说明 |
|---|---|---|---|
| `main` | — | Phase 1 修复 | 唯一主干，修复期直接提交 |
| `feat/multi-agent-monolith` | `main` | Phase 2 | 多 Agent 架构，**仍为单体** |
| `feat/multi-agent-concurrency` | `feat/multi-agent-monolith` | Phase 3 | + 高并发能力 |
| `feat/multi-agent-distributed` | `feat/multi-agent-concurrency` | Phase 4 | + 企业级分布式微服务 |

**堆叠式（stacked）**：后一分支包含前一分支全部能力，符合"逐层累加"的目标语义。

**开工前规则**：每个 Phase 启动时，先把上一级分支合入本级，确保基于最新硬化基线开发：

```bash
git checkout feat/multi-agent-concurrency
git merge main feat/multi-agent-monolith   # 拉齐前置成果
```

**合并方向**：只允许 `下游 → 上游`（Phase 4 → 3 → 2 → main）单向合入修复；
反方向只允许 cherry-pick 缺陷修复，不允许整体回灌，避免架构回退。

### 0.3 实际执行方式：main 单线（取代 §0.2 的堆叠分支）

**结论先说**：M1~M7 全部落在 `main` 一条线上，**没有使用 §0.2 的堆叠分支模型**。
远端 `feat/multi-agent-monolith` / `-concurrency` / `-distributed` 三个分支仍停在
`79bab0b`（本轮开工前的提交），**从未被使用，也不再需要**。此处如实说明成因，
而不是把规划写成既成事实。

**为什么没有按分支开发**：

1. 本轮开工时用户明确要求"全部改动留在本地工作区，不做任何 git 提交、不推送远端"，
   因此不具备切换/合并分支的前提；
2. 后来用户授权提交推送时，能力已经是**在同一条时间线上逐层累加**完成的
   （Phase 2 的多 Agent、Phase 3 的高并发、Phase 4 的分布式各自新增独立目录，
   并在少量共享文件上加接入点）。此时再补出堆叠分支属于**事后重建历史**。

**为什么"按目录拆分支"也不可行**（实测，不是推测）：

```bash
# Orchestrator.js 对 Phase 3 模块是**静态** import，且在模块顶层实例化：
#   import { AbortTree } from '../library/AbortTree.js';
#   import { RoleLimiter } from '../Agent/Runtime/RoleLimiter.js';
#   const globalRoleLimiter = new RoleLimiter();
# 因此"monolith 分支 = main 去掉 Phase 3/4 目录"会让模块直接加载失败：
$ node -e "import('./Server/Orchestrator/Orchestrator.js')"   # 删掉上述两文件后
ERR_MODULE_NOT_FOUND
```

也就是说，**真正的堆叠分支必须逐分支回退共享文件里的后续阶段改动**，
而不是删除目录。那会得到 3 份分叉的 `Orchestrator.js` / `FlexRunner.js` / `AgentRuntime.js`——
对于一次连续演进而言，这是长期分支税（后续每个缺陷修复都要挑 4 次），
收益低于成本，因此不做。

**替代方案：如何按阶段回溯**（本文件与提交共同承担 §0.2 原本的作用）

| 想要的效果 | 现在怎么做 |
|---|---|
| 只看 Phase 1 修复（M2/M3） | `git show deb9ad5` / `npm run test:m2`、`test:m3` |
| 只看 Phase 2 多 Agent | `git show 8051367` / `npm run test:m5` |
| 只看 Phase 3 高并发 | `git show af059e8` / `npm run test:m6` |
| 只看 Phase 4 分布式 | `git show e497ad1` / `npm run test:m7` |
| 只看工程纪律/CI | `git show bf69e5a` |
| 按能力定位代码 | `Server/Agent/`（协作）、`Server/Distributed/`（分布式）、<br>`Server/library/{AbortTree,SessionWaiter,LatencyRecorder}.js`、`deploy/` |
| 隔离开关（默认关闭，行为与 Phase 1 一致） | `MULTI_AGENT_ENABLED` / `MAX_SESSIONS_PER_ROLE` / `DISTRIBUTED_ENABLED` |

**保留的隔离手段（与分支无关，仍然有效）**：

1. **目录边界**：Phase 2/3/4 的新增能力各自落在独立目录，对 `Orchestrator`、`FlexRunner`
   的改动保持"**加接口、不改语义**"；
2. **能力开关默认关闭**：未显式开启时行为与 Phase 1 完全一致——这是"不回归"的机器判定
   （8 个套件 847 条断言在关闭态全绿）；
3. **测试按阶段分目录**：`test/m5-phase2/`、`test/m6-phase3/`、`test/m7-phase4/`
   与 `test/m1..m4` 平行，互不干扰；
4. **提交按阶段切分**：见上表；共享文件的多阶段接入点集中在其所属阶段的提交里
   （无法在不重写文件的前提下按阶段拆开，已在对应提交信息中注明）。

**若将来确实需要并行开发多个阶段**：应从 `main` 重新开分支（而不是复活
`79bab0b` 上的旧分支），并按 §0.2 的合并方向单向合入。

---

## 1. Phase 1 —— 修复计划（main）

### 判定标准

| 严重级 | 含义 |
|---|---|
| **P0** | 会造成数据丢失、资源泄漏、安全暴露或进程不可恢复 |
| **P1** | 高并发下会劣化或死锁，但当前单任务可用 |
| **P2** | 正确性 / 一致性缺陷，低概率触发 |
| **P3** | 工程纪律，不影响运行但影响可维护性与可信度 |

每个条目给 **动作 → 验收**，验收必须可复现。

---

### P0 —— 阻断级（必须最先完成）

#### F-01 移除生产热路径中的调试埋点
- **证据**：`Server/Orchestrator/Orchestrator.js:682, 744, 756, 767, 775` —— 5 处硬编码
  `fetch('http://127.0.0.1:7594/ingest/461ba96d-…')`，含硬编码 session UUID，
  位于 `_executeNode` / `_activateNextStep` 热路径，错误被 `.catch(()=>{})` 吞掉。
- **动作**：删除 5 处 `#region agent log` 代码块（含注释标记）。
- **验收**：`git grep -n 7594` 与 `git grep -n "ingest/461ba96d"` 均无输出。

#### F-02 关闭对外暴露面（最高优先安全项）
- **证据**：
  - `Web/server.js:119` `server.listen(PORT, …)` **未指定 host** → 绑全网卡；
    而 `Server/Routes/server.js:149` 绑 `127.0.0.1`，"仅回环"的设计意图被前端代理解除。
  - `Web/server.js:79-82` 把 `/api/*`、`/stream*` 无反代转发，全程无认证。
  - `Web/ext/issue/router.cjs:42` 管理密码默认 `admin123`，`!==` 明文比较且无限流（:372, :526, :607）。
  - `Server/Routes/router/Router.js:147` 对所有响应设 `Access-Control-Allow-Origin: *`。
- **动作**：
  1. `Web/server.js` 默认 `127.0.0.1`，提供 `--host` 显式放开；
  2. 引入本地访问令牌（启动时生成写入 `Server/.env` / 数据目录，前端经 header 携带），
     或至少对代理层加 `Host`/`Origin` 白名单校验；
  3. 移除 `admin123` 兜底：未配置 `ISSUE_ADMIN_PASSWORD` 时**拒绝启动**该扩展的管理接口；
     密码比较改 `crypto.timingSafeEqual`，并加失败计数限流；
  4. CORS 改为按需同源，而非无条件 `*`。
- **验收**：`curl http://<局域网IP>:8080/api/health` 失败（已实测：非回环 + 无令牌 → 进程 exit 1）；
  未配置 `ISSUE_ADMIN_PASSWORD` 时管理接口返回 503；
  精确禁止项：`git grep -nE "ADMIN_PASSWORD\s*=.*\|\|"` 与 `git grep -nE "!==\s*ADMIN_PASSWORD"` 均无输出
  （注意：不能直接 grep 字符串 `admin123`，修复说明注释中会提及该词）。

#### F-03 会话生命周期回收（消除线性泄漏）
- **证据**：`deleteSession`（`Server/CLI/opencode/index.js:152`）在整个生产代码**无调用方**
  （仅 `Server/CLI/test.js:233` 注释里）；`FlexRunner.invokeSkill` 的 catch 返回 `false`，
  既不 abort 也不 delete（`FlexRunner.js:851-854`）；`executeStart` catch 同样吞掉（:564-566）。
- **动作**：`FlexRunner.executeStart` 增加 `finally`：
  - 失败 / 超时 / 异常路径无条件 `abortSession(sessionId)`；
  - 成功路径在产物（result/summary/meta）持久化完成后 `deleteSession(sessionId)`；
  - `abort` 与 `startSession` 完成之间的竞态窗口：记录 `#sessionId` 后立即复查 `#aborted`
    并补 abort（当前只在 `invokeSkill` 前检查，见 :525）。
- **验收**：跑一个 6 步任务后，`curl <opencode>/session` 返回的会话数回落到基线；
  人为注入 90 分钟超时，服务端无残留会话。

#### F-04 优雅停机
- **证据**：`Server/Routes/server.js:173-183` 的 `shutdown` 只 `sseHub.destroy()` +
  `server.close()` + `storage.close()` 即 `process.exit(0)`：
  不 abort 在途编排、不 abort 远端会话、不等待 `_persistChain`（`Orchestrator.js:1280`）落盘。
- **动作**：新增 `OrchestratorController.abortAll()` 与 `FlexRunner.abortAll()`：
  1. 停止接受新请求（`server.close()`）；
  2. 遍历 `_orchestrators` 逐个 `abort()`，等待在途 runner 进入终态；
  3. 等待所有 `_persistChain` resolve；
  4. 远端会话全部 abort；
  5. 设兜底超时（如 30s）后强制退出。
- **验收**：任务运行中 Ctrl+C，重启后 `orchestration.json` 为流畅终止态（非截断 JSON），
  且 opencode 侧无残留运行会话。

#### F-05 依赖锁定与可复现构建
- **证据**：`.gitignore` 排除 `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`；
  根目录 `node_modules` 缺失，仓库当前状态**不可直接运行**。
- **动作**：`npm install` 生成 `package-lock.json` 并从 `.gitignore` 移除 lockfile 条目；
  提交 lockfile；README 补"首次运行必须 `npm install`"。
- **验收**：全新 clone + `npm install` + `node check-env.mjs` 可跑通。

---

### P1 —— 并发正确性（决定高并发下"变慢"还是"死锁"）

#### F-06 端到端超时与取消传播
- **证据**：全库 grep `AbortSignal|AbortController|keepAlive|dispatcher|setGlobalDispatcher`
  **0 命中**；`new OpenAI({apiKey, baseURL})`（`llmClient.js:60`）未传 timeout；
  `Semaphore.acquire()`（`Orchestrator.js:103-110`）无超时；
  `checkSessionStatus` 调用点（`FlexRunner.js:1698`）无超时。
  若该请求僵死，`executeStart` 永不返回 → `finally` 不执行 → **槽位永久泄漏**，
  累计到上限后整个进程所有新任务永久饿死。
- **动作**：
  1. `createOpencodeClient` / `new OpenAI` 显式设置 timeout 与 maxRetries；
  2. `Semaphore.acquire(timeoutMs)` 支持超时抛出，并保证超时后不重复释放；
  3. 引入请求级 `AbortController`，由 `FlexRunner.#aborted` 驱动，使 abort 能打断在途 HTTP。
- **验收**：注入一个永不返回的 mock session，任务在 `pollTimeout + margin` 内失败，
  信号量 `active` 归零（`GET /api/stats/session/concurrency` 可验）。
- ⚠️ 严重程度部分取决于 `@opencode-ai/sdk` 内部默认值（本次未能验证，`node_modules` 缺失），
  因此本项**必须**以显式配置消除不确定性。

#### F-07 信号量覆盖全部会话创建路径
- **证据**：`_summarizeAndPersist` 是 fire-and-forget（`FlexRunner.js:557`），在
  `executeStart` 返回、槽位**已释放**之后才执行 `sendAndWaitMessage`，可持续数分钟且不计入限流
  → 真实并发会话可达 `MAX_CONCURRENT_SESSIONS` 的 **2 倍**。
- **动作**：经验总结路径纳入同一信号量，或为其设独立的小额专用信号量；
  确保"任何在 opencode 上创建会话的路径都被计数"。
- **验收**：并发压测下 `/api/stats/session/concurrency` 的 `active` 永不超过 `limit`
  （含总结阶段），并在压测日志中可观测。

#### F-08 信号量隔离与公平
- **证据**：`globalSessionSemaphore`（`Orchestrator.js:126-128`）为进程级 FIFO，无按任务配额。
  单任务 fan-out 50 可独占全部槽位，其余任务排队至饿死；槽位持有上限 90 分钟。
- **动作**：两级限流 —— 全局上限 + 每 taskId 配额（如 ≤8）；支持按优先级插队；
  记录排队时长并暴露 `queueWaitP95`。
- **验收**：两个并发任务（各 fan-out 20）交错推进，无一任务被完全饿死。

#### F-09 SSE 背压与内存上限
- **证据**：`SseHub.emit` 忽略 `res.write()` 返回值且无 `drain`/水位上限
  （`SseHub.js:159, 227, 248`；全库 grep `drain|writableLength` 0 命中）；
  每帧为全量 progress 快照。慢客户端 → socket 写缓冲无界堆积。
- **动作**：
  1. 检查 `write()` 返回值，注册 `drain`，设每连接字节水位（如 1MB），超限断开或丢帧；
  2. `progress` 事件合并节流（如 200ms 窗口只推最后一帧），或改为增量 delta；
  3. `res.on('error')` 显式监听（当前只有 `close`，见 `SseHub.js:126`），避免未监听 error 事件导致进程崩溃。
- **验收**：人为挂起 1 个 EventSource 客户端，进程 RSS 增长有界（不随事件数线性增长）。

#### F-10 SSE 连接身份与失败路径修正
- **证据**：
  - `StreamController.js:30` `userId = req.query.userId || 'anonymous'`，而前端
    `EventSource('/stream/tasks/<id>')` **不传 userId**（`Web/public/js/loop.js:874` 等 4 处）
    → 全部连接共享 `anonymous`，`maxPerUser=10` 实际变成**全进程 10 连接上限**；
  - 被拒路径错误：`res.stream()` 已发 200 头（无法再返回 429），且
    `emit(taskId,'error',…)` 广播给该频道**其它**订阅者，被拒连接根本未注册
    → 客户端"连上即断且无错误事件" → EventSource 自动重连 → **重连风暴**；
  - `_userCounts` 双递减：`_cleanZombies`（:261-276）与心跳失败分支（:248-253）
    先 `_removeConnection` 再 `res.end()`，随后 `close` 监听器再次调用 `_removeConnection`。
- **动作**：
  1. userId 由服务端派生（连接级随机 ID 或会话票据），不信任 query；
  2. **在 `res.stream()` 之前**完成准入判定，超限直接返回 429 + `Retry-After`；
  3. `_removeConnection` 幂等化（以 `subscribers.delete()` 的返回值为准再调整计数）。
- **验收**：并发 20 个 SSE 连接全部建立成功（不再是 10）；第 N+1 个收到 429；
  连接建立/断开 100 次后 `GET /stream/stats` 的 `totalConnections` 与 `totalUsers` 归零。

#### F-11 持久化写放大消除
- **证据**：`_emitStepStatus`（`Orchestrator.js:1133-1151`）每次状态变更都 fire-and-forget
  调 `_persistState()`，而它写**两份**含全部步骤 + history 的完整 JSON（:1272-1274）。
  N 步 → ~2N 次变更 → ~4N 次全量写，字节量 O(N²)；`_persistChain` 只串行不去重。
- **动作**：脏标记 + 防抖合并（如 300ms 内多次变更只落一次）；或改增量追加
  （JSONL 记录变更事件，定期快照）。
- **验收**：10 步任务的文件写入次数由 ~40 降到 ≤10（可加临时计数或看 IO 统计）。

#### F-12 内存注册表淘汰
- **证据**：
  - `OrchestratorController._orchestrators`：仅 `disposeOrchestrator(...,{removeInstance:true})`
    时移除；大循环路径调用时**不带** `removeInstance`（`LoopEngineController.js:241`），
    且 `restoreFromDisk`（`OrchestratorController.js:835-884`）启动时把**所有**历史任务载入内存
    → 随任务数单调增长。讽刺的是 `progress()`（:485-487）明确注释要避免这件事。
  - `Brain._plans`  只 `set`（`Brain.js:239, 471`）从不 `delete`。
  - `FlexRunnerController._runners` 仅显式接口删除（:1208），完成时不淘汰；
    `_taskLogs`（:34）是只赋值不读的死字段。
  - `LoopEngineController._engines` 的 restore 路径（:360-365, :663-670）`set` 后无 `_running` promise，
    因此没有 `finally` 清理。
- **动作**：统一引入 LRU + TTL 的注册表（保留终态任务 N 条 / T 天，其余仅从磁盘读）；
  `restoreFromDisk` 只恢复非终态任务；清理死字段。
- **验收**：创建 200 个已完成任务后进程 RSS 稳定，`_orchestrators.size` 有界。

> 说明：`LoopEngine._loops` / `_abortStates` 虽从不 delete，但 LoopEngine 是**每任务一个实例**
> （`LoopEngineController.js:181` `_createEngine()`），随实例一同回收，**不是泄漏**——已核实，勿误改。

#### F-13 HTTP 层加固
- **证据**：`Router._readJsonBody`（`Router.js:189-200`）`data += chunk` 无大小上限、
  无 `Content-Length` 校验；`Server/Routes/server.js:132-149` 未设
  `maxConnections` / `headersTimeout` / `requestTimeout`。
- **动作**：body 上限（如 2MB，超限 413）+ `server.timeout` / `headersTimeout` /
  `keepAliveTimeout` / `maxConnections` 显式配置；JSON 解析失败返回 400 而非 500。
- **验收**：`curl -X POST -d @10MB.json` 返回 413 且进程内存无异常增长。

---

### P2 —— 正确性与一致性

| 编号 | 问题（证据） | 动作 | 验收 |
|---|---|---|---|
| **F-14** | `StatsService.incrementSessionCount` 无锁 RMW + `fs.writeFile` 直接截断（`StatsService.js:86-98`），每次 `startSession` 调用 → 丢更新、并发下可写出损坏 JSON；同仓库的 `JsonAdapter` 却用了 tmp+rename（:49-57），标准不一致 | 复用 `JsonAdapter` 原子写 + 进程内串行队列；损坏时从备份恢复 | 并发 100 次调用后 `sessionCount` 精确 +100 |
| **F-15** | `KnowledgeManager` 的 `index.json` 同类 RMW 竞态（:196-205），并行 FlexRunner 下丢更新 | 同上，统一走原子写 + 串行化 | 并行登记 50 条经验，`index.json` 条目数一致 |
| **F-16** | `TaskStepStore._nextSeq` 为 `SELECT MAX(seq)+1` 再 upsert（:113-119），同任务并行步骤得到重复 seq | 改为事务内计算，或用 `seq` 唯一约束 + 重试；或直接以 `(task_id, seq)` 唯一索引冲突重算 | 并行 20 步创建后 `seq` 无重复 |
| **F-17** | 每 FlexRunner 各自 `createStorage()` → N 个连接打同一 `store.db`，且 `SqliteAdapter` 未设 `busy_timeout`（:56-61）；冲突错误被 `_persistStep` catch 静默吞掉（`FlexRunner.js:1292-1294`） | 全局单例 Storage/连接；设 `busy_timeout`；`_persistStep` 失败必须 warn（当前是 warning 级，确认不静默） | 50 并发写库无 `SQLITE_BUSY`，无静默丢失 |
| **F-18** | `_execPathTrace` 只声明与 clear、从不读取（`Orchestrator.js:194, 344, 1347`），而 `Server/Orchestrator/AGENTS.md` 宣称实现了「每个 (taskId,stepId) 只执行一次」的循环检测；`SqliteAdapter._stmtCache` 宣称"预编译语句缓存"但从未写入（:39, 147） | 二选一：**实现**该检测（用 trace 做 gate）或**删除文档宣传**；`_stmtCache` 同理 | `git grep` 后文档与实现一致；新增测试覆盖循环检测 |
| **F-19** | 文档/元数据漂移：轮询间隔文档 3000 / 实际 5000（`FlexRunner.js:123`）；`_pollSession` 超时文档 10 分钟 / 实际 90 分钟（:126）；信号量默认值同文件注释写 5 / 常量写 50（`Orchestrator.js:73, 627`）；README 称用内置 `node:sqlite`、实际用 `better-sqlite3`；`cli/package.json` 的 `homepage/repository/bugs` 仍指向旧命名空间 `lalhanOrz` | 逐处校正；建立"文档-常量"对照表；`cli/package.json` 元数据指向 `summor` | 人工复核 + 在 CI 中加入常量/文档比对（可选） |
| **F-20** | 元数据/文档漂移：`cli/package.json` 的 `homepage`/`repository`/`bugs`（第 8/11/14 行）仍指向旧命名空间 `lalhanOrz`，且该元数据已随 npm 包 `@ohos-cpf/3rdloop@0.0.11` 发布——用户从 npm 点"仓库"会跳到旧地址。另有轮询间隔、`_pollSession` 超时、信号量默认值、README 的 `node:sqlite` 与实现的 `better-sqlite3` 等多处文档/实现不一致（与 F-18/F-19 合并处理） | 元数据统一指向 `summor`；建立"文档-常量"对照表并逐处校正 | `npm view @ohos-cpf/3rdloop repository.url` 指向 `summor/3rdLibraryLoop`；漂移清单逐条复核 |
| **F-21** | LLM 侧无准入控制与全局熔断：`_withRetry` 的 529 降级用**函数内局部变量** `currentModel`（`llmClient.js:139`），熔断是 per-call 的 → N 路并发各自独立重试 10 次，**放大而非收敛**；未设 `response_format: {type:'json_object'}`（:76-86）；`chatJSON` 解析失败不重试（:110-119），一次坏 JSON 吃掉一整轮大循环 | 进程级共享熔断器（半开/全开状态机）；加令牌桶限流；启用 `response_format`；JSON 解析失败计入瞬态并重试（有上限） | 模拟全站 429，验证并发 N 路只产生 O(1) 级重试而非 O(N) |
| **F-22** | `checkStatus=ERROR` 与"审核未通过"混同：`TestCheck.js:296-302` 让 `passed=false`，`LoopEngine` 只读 `passed`（`LoopEngine.js:431-434`）→ 一次选型失败也吃掉一整轮；且轮次错误会带 `previousCheckResult=null` 进入 replan，prompt 仍断言"上一轮准出未通过"（`AnalysisStrategies.js:332`），诱导编造失败分析 | 三态化 `checkStatus`（PASSED / REJECTED / ERROR），ERROR 不消耗轮次、走重试；replan prompt 按是否有真实失败列表分支 | 注入 selector 失败，验证不消耗 `maxLoops` |
| **F-23** | 无计划去重/振荡检测：无代码比较 `brain_loopN` 与 `brain_loopN+1`，相同计划会烧完全部轮次 | 计划指纹（步骤图哈希）+ 重复即提前终止并报 `OSCILLATION` | 构造恒定计划，第 2 轮即终止而非跑满 3 轮 |
| **F-24** | 状态机死路：`ABORTING` 可进入但重启后**永不退出**（`LoopEngine.js:541-547` 置位；唯一 `ABORTING→ABORTED` 在 `startLoop` 尾部 :476-478，恢复上下文不会执行）；`restoreLoop` 保留 `planning/executing/checking` 并强制 `aborted:false`（:962-1005）→ 崩溃后循环永远显示"运行中" | 恢复时把非终态统一投影为 `INTERRUPTED` 并可续跑或标记失败；补齐 `ABORTING` 的收敛路径 | 构造 ABORTING 快照后重启，状态收敛到终态 |
| **F-25** | 知识闭环未闭合：知识只被**写**（`FlexRunner.persistKnowledge`，:908-936），全库检索 `listExperiences/getExperience` **只被 HTTP 路由调用**，Brain/TestCheck/FlexRunner 从不把知识注入 prompt；检索亦无打分排序（`KnowledgeManager.js:299-312` 仅 `taskId` 相等 + `includes`） | 在 Brain 拆解与 TestCheck 审核前做知识检索注入（带打分与条数上限），并把命中记录写入 plan 快照以便追溯 | 第二次同类任务的 prompt 中出现上轮经验；A/B 对比准出轮次下降 |
| **F-26** | 跨进程协作仅靠启发式：`owner.json` + `process.kill(pid,0)`（`OrchestratorController.js:783-814`）在 pid 复用、异机共享数据目录时误判 | Phase 1 至少加 `startedAt` + 心跳时间戳双重校验；正式方案见 Phase 4 的租约机制 | 模拟 pid 复用场景不误判 |

---

### P3 —— 工程纪律

| 编号 | 动作 | 验收 |
|---|---|---|
| **F-27** | 补测试入口：为 `Server/` 加 `test` script（当前根 `package.json` 无 scripts，`Server/package.json` 仅 `test:selector`）。**利用已有注入点**：`Orchestrator` 支持 `flexRunnerFactory`（`Orchestrator.js:152, 873-875`），可不启动 LLM 做纯调度单测 | `npm test` 可跑；Orchestrator DAG 用例覆盖 fan-out / fan-in / failStepId 修复链 / 死锁检测 / GLOBAL_EXEC_LIMIT |
| **F-28** | 把 `Server/Orchestrator/repro_deadlock.js`、`repro_regression.js` 升级为断言式回归测试（现为 68 + 50 行脚本） | 两个 repro 变成 `test/` 下带断言的用例，接入 `npm test` |
| **F-29** | CI：接入 GitCode 流水线（或 `.github/workflows` 备用），至少跑 `node --check` 全量语法 + `npm test` + `git grep` 禁止项（7594 埋点、`ADMIN_PASSWORD = ... \|\|`）+ 所有 `package.json` 可 JSON.parse | PR 必过；故意引入调试埋点或弱口令兜底能被拦住 |
| **F-30** | Lint/格式化：引入 ESLint 或 Biome，先 `warn` 后 `error` 渐进收紧 | `npm run lint` 无 error |
| **F-31** | 测试覆盖率基线：当前测试 ~600 行 / 源码 83k 行（≈0.7%），先把 Orchestrator / SseHub / DbUse 三个模块拉到有实质覆盖 | 核心模块行覆盖 ≥60%（仅这三模块） |
| **F-32** | 跨平台换行符与文本属性缺失：`core.autocrlf=true` 且**无 `.gitattributes`**（已实测确认）。仓库同时服务 Windows 主开发与 macOS/Linux 用户（见 `cli/AGENTS.md` 的 `macos-bash-replace-build-ps1`、`macos-bsd-diff-q-illegal-option` 经验条目），会导致整文件换行符抖动、diff 噪音、shell 脚本被 CRLF 破坏 | 新增 `.gitattributes`：`* text=auto eol=lf`，对 `*.sh`/`*.mjs`/`*.cjs` 强制 `eol=lf`，二进制类型标 `binary`；可选 `git add --renormalize .` 一次性对齐 | `git status` 在跨平台 checkout 后无换行符抖动；`.sh` 脚本不出现 `\r`；新增文件均按规则归一 |

---

### Phase 1 执行顺序与里程碑

```
M1（阻断）  F-01  F-02  F-03  F-04  F-05          → 可安全演示、无泄漏、可复现构建
M2（并发）  F-06  F-07  F-08  F-09  F-10  F-11  F-12  F-13  → 高并发下"变慢但活着"
M3（正确）  F-14 … F-26                            → 语义与一致性正确
M4（纪律）  F-27 … F-32                            → 可回归、可 CI 守护
M5（Phase 2）多 Agent 单体架构                      → 一步 = 一组有角色的 Agent 协作
M6（Phase 3）多 Agent + 高并发                      → 500 并发会话不死锁、不泄漏、延迟可预测
M7（Phase 4）多 Agent + 高并发 + 企业级分布式         → 可水平扩展、多租户、可审计
```

**当前状态（全部通过验收，7 个里程碑 / 8 个套件 / 847 条断言）**

| 里程碑 | 状态 | 断言 | 记录位置 |
|---|---|---|---|
| M1 | ✅ | 65 | 本文 §1 M1 完成记录 |
| M2 | ✅ | 165 | 本文 §1 M2 完成记录 |
| M3 | ✅ | 160 | 本文 §1 M3 完成记录 |
| M4 | ✅ | 64 | 本文 §1 M4 完成记录 |
| M5（Phase 2） | ✅ | 166 | 本文 §2 Phase 2 完成记录 |
| M6（Phase 3） | ✅ | 102 | 本文 §3 Phase 3 完成记录 |
| M7（Phase 4） | ✅ | 182 | 本文 §4 Phase 4 完成记录 |
| 引擎单元测试 | ✅ | — | `npm run test:unit` |

> **提交说明**：M1~M7 全部提交在 `main` 一条线上（未使用 §0.2 的堆叠分支，
> 原因与替代方案见 §0.3）。本轮共 6 个提交，按阶段切分，可逐段回溯：
>
> | 提交 | 阶段 | 对应套件 |
> |---|---|---|
> | `bf69e5a` | M4 工程纪律与 CI 门禁（F-27~F-32） | `test/m4` |
> | `deb9ad5` | Phase 1 收尾：M2 并发正确性 + M3 正确性 | `test/m2`、`test/m3` |
> | `8051367` | Phase 2 多 Agent 单体架构（M5） | `test/m5-phase2` |
> | `af059e8` | Phase 3 多 Agent + 高并发（M6） | `test/m6-phase3` |
> | `e497ad1` | Phase 4 企业级分布式微服务（M7） | `test/m7-phase4` |
> | `2770879` | 本文档的完成记录 | — |
>
> M1 的 5 个修复提交在更早的 `6aa1059`…`48bea61`（本轮开工前已在本地，随本次一并推送）。
> 每一条完成记录都给出「文件 + 可复现命令 + 实测数值」，commit 只是附加的定位手段。

---

### M1 完成记录（2026-09-04）

| 编号 | 提交 | 验收证据 |
|---|---|---|
| F-01 | `6aa1059` | 纯删除 17 行；`git grep 7594 / #region agent log` 无输出 |
| F-02 | `493dacf` | 访问控制 23 项 + CORS 9 项全通过；非回环无令牌 → exit 1 |
| F-03 | `e574397` | 会话回收 14 项通过（含归档失败保护、幂等、不重复 abort） |
| F-04 | `132557a` | 停机 19 项通过（含真实 Server 端到端序列与退出码） |
| F-05 | `e5cf54f` | 两个 lockfile 入库；`npm install` 9+47 包成功；引擎可真实启动 |
| 测试固化 | — | `npm run test:m1`：8 项套件 / 65 条断言 / 222 文件语法检查，全绿 |

**M1 额外产出**：`test/m1/` 验收套件（把一次性验证固化为可复现回归），
根 `package.json` 新增 `test:m1` 脚本。这提前覆盖了 F-27 的一部分。

---

### M2 完成记录

> 提交 `deb9ad5`（M2/M3 的共享文件改动见该提交信息末尾的粒度说明）。

| 编号 | 核心改动 | 验收 |
|---|---|---|
| **F-06** | `CLI/opencode/index.js` 通过 SDK 的 `fetch` 钩子注入请求级超时与取消（SDK 默认 `req.timeout=false`，即**主动关闭超时**，这是根因）；`Semaphore.acquire` 支持超时；`FlexRunner` 建立 AbortController 并在 abort 时中断在途 HTTP | 信号量超时/取消 21 项中相关用例 |
| **F-07** | `FlexRunner` 注入共享信号量，经验总结调用 `sendAndWaitMessage` 前**自行再取一个槽位**（该路径发生在步骤槽位释放之后，原实现使真实并发可达上限 2 倍） | 取不到槽位时优雅跳过、步骤结果不受影响 |
| **F-08** | `Semaphore` 升级为「全局上限 + 单任务配额 + 获取超时 + 租约式释放」；扫描式派发避免队头阻塞 | A/B/C/D/E 组：上限不突破、配额生效、A 满额不阻塞 B、超时无泄漏、重复释放不漂移 |
| **F-09** | `SseHub` 背压保护：检查 `write()` 返回值、`drain` 恢复、可合并事件（全量快照）只留最新、有界队列超限即断开慢客户端、注册 `res.on('error')`、持续背压超时断开 | A–D/H/J 共 20 项 |
| **F-10** | 连接身份不再退化为共享 `'anonymous'`（原实现使"单用户上限 10"变成**全进程 10 连接硬上限**，实测第 11 个连接被拒）；新增 `canSubscribe` 使准入可在**写响应头之前**完成并返回真正的 429；`_removeConnection` 幂等（修重复递减 + `close()` 计数泄漏） | E/F/G/I 共 13 项；真实服务 12/12 并发 SSE 连接成功 |
| **F-11** | `Orchestrator` 持久化写放大消除：防抖合并 + 强制刷盘 + 落盘统计（实测写次数显著下降） | 30 项 |
| **F-12** | 新增 `Server/library/BoundedRegistry.js`；`_orchestrators` / `Brain._plans` / `_runners` 改为有界 + LRU/TTL 淘汰（RUNNING 态拒绝淘汰）；删除死字段 `_taskLogs` | 52 项 |
| **F-13** | HTTP 加固：body 上限（超限 413 且带 `BODY_TOO_LARGE`，`Content-Length` 声明超限时提前拒绝）、JSON 解析失败返回 400（原为 500）、`maxConnections`/`headersTimeout`/`keepAliveTimeout` 显式配置，且 **`requestTimeout=0`（显式关闭）以不切断 SSE 长连接**、非法/非正数环境变量回退默认（不允许"无上限"） | 29 项（含真实路由端到端） |

**M2 期间发现并修复的两个"只在 Windows 出现、但会静默丢数据"的问题**：
1. **`fs.rename` 覆盖被占用文件会以 EPERM/EBUSY 失败**。在"并发写 + 并发读同一 JSON"
   的测试中稳定复现，导致偶发丢更新。已新增 `renameWithRetry`（退避重试），
   并同步修掉既有 `JsonAdapter.write` 的同一缺陷（它此前只用裸 `rename`）。
2. 修好前，`StatsService` 的并发 +1 在真实负载下无法精确收敛到预期值——
   这正是"原子写"必须配"重试"才能在生产 OS 上成立的证据。

**M2 验收总计**：`npm run test:m2` → 5 个套件 / **165 条断言** / 全绿。
运行入口已并入 `npm test`（顶层聚合运行器 `test/run-all.mjs`，同时交付 F-27 的测试入口）。

---

### M3 完成记录（全部 13 项）

| 编号 | 核心改动 | 验收 |
|---|---|---|
| **F-14 / F-15** | 新增 `Server/library/AtomicJsonFile.js`（原子写 + 按路径串行化的 read-modify-write）；`StatsService`、`KnowledgeManager` 改为使用它，并新增 `withSerializedLock` 覆盖"跨多文件"的临界区（详情+索引一致性） | 17 项：100 次并发 +1 精确收敛、损坏降级自愈、并发读写不损坏、多实例共享锁、并发增删后无悬空索引 |
| **F-16** | `TaskStepStore.create` 的 seq 分配改为**同一同步事务**内完成（先前是 `SELECT MAX+1` → `INSERT` 两步且有 await 间隙） | 13 项：并发 30 条 seq 无重复、幂等保留原 seq、多任务独立、状态流转正常 |
| **F-17** | `SqliteAdapter` 补 `busy_timeout`（默认 5s，`SQLITE_BUSY_TIMEOUT_MS`）；`Orchestrator` 向 FlexRunner **注入共享 storage**（此前每步各建一套 Storage + SQLite 连接）；`KnowledgeManager` 改为进程级 promise 单例 | 15 项，含**三进程并发写同一 DB** 450 条零 `SQLITE_BUSY` |
| **F-18** | 新增加载期静态环检测 `_detectCycles()`（取代从未生效的 `_execPathTrace`）；`SqliteAdapter._stmtCache` 真正启用 | 16 项：环识别（含自环/dependId 环）、线性链不误报、缓存复用与 `close()` 清空 |
| **F-19 / F-20** | 8 个文档/元数据文件逐条对照代码校正；`cli/package.json` 仓库地址由旧命名空间 `lalhanOrz` 改为 `summor`；`Tools/libraryTestScan` 的 `REPO_OWNER` 同步（否则会按需下载**过期**脚本） | 每条断言附 `file:line` 证据；JSON.parse + CRLF 逐字节复核 |
| **F-21** | 新增进程级共享 `CircuitBreaker`（三态）+ `LlmRateLimiter`（并发上限/QPS）；`chatJSON` 启用 `response_format`（不支持时**自动降级并记住**）且解析失败可重试 | 29 项，关键指标：**20 路并发撞 529 只产生 10 次 API 调用**（不收敛时为 200 次） |
| **F-22** | `TestCheck` 的三态语义落地：审核**故障**（`status=error`）会重试、**不消耗轮次**，终态为 `error` 且明确说明"不代表任务产物未通过验收"；replan 不再接收空的审核结论（避免编造失败分析） | 含在 31 项中：`brainCalls=1`（不空耗轮次）、真实不通过仍走满 maxLoops 后 FAILED |
| **F-23** | 新增计划指纹与**振荡检测**：重规划产出与之前完全相同的步骤图时提前止损（`LOOP_DETECT_OSCILLATION=0` 可关闭） | 同上：第 2 轮即停、原因明确、"不再谎报达到最大循环次数" |
| **F-24** | 新增 `INTERRUPTED` 终态；恢复时把 `planning/executing/checking` 投影为 `interrupted`（原实现会永远显示"运行中"），`aborting` 归一为 `aborted` | 同上：投影全分支 + `restoreLoop` 端到端 |
| **F-25** | **知识闭环真正闭合**：新增 `KnowledgeManager.searchExperiences()`（词法打分 + CJK 二元组 + SKILL 加权），并接入 FlexRunner 的步骤 prompt（此前经验**只写不读**，检索仅 HTTP 路由在用） | 23 项：端到端验证**经验正文确实出现在发给 CLI 的 prompt 中**；条数/字符预算受控；检索故障优雅降级 |
| **F-26** | 属主判定引入**心跳时间戳**：`owner.json` 增加 `startedAt`/`heartbeatAt`，运行期定时刷新；判定要求「pid 存活 **且** 心跳新鲜」，从而抵御 **pid 复用**导致的任务永久幽灵化 | 16 项：核心断言为「pid 存活但心跳超期 → 判死并清理」；旧版格式向后兼容；心跳定时器不残留 |

**M3 验收总计**：`npm run test:m3` → 7 个套件 / **160 条断言** / 全绿。

**M3 期间发现的三个非平凡问题**：
1. **`fs.rename` 在 Windows 上覆盖被占用文件会失败（EPERM/EBUSY）**——"原子写"必须配重试才在生产 OS 上成立（F-14）。
2. **`busy_timeout` 对「deferred 事务锁升级冲突」无效**——`SELECT` 后 `INSERT` 的场景必须用 `BEGIN IMMEDIATE`，
   否则跨进程并发写会**随机丢记录**（实测三进程各写 150 条，deferred 下只落 311/433/444 条，改 IMMEDIATE 后稳定 450 条）。
3. **opencode SDK 默认 `req.timeout = false`**——即 SDK 主动关闭请求超时（F-06 的根因）。

**再次修正我的评估错误（记录以便追溯）**：本轮委托校对时，对方核出我先前**6 处判断有误**
（FlexRunner 的 `POLL_TIMEOUT_MS` 文档本就正确、LoopEngine 的轮询等待描述正确、
CLI/AGENTS.md 无漂移、DbUse 的语句缓存已随 F-18 变为真实、README 无可改 URL、
`.env.example` 的 `SELECTOR_TOP_K` 正确）。这些项已按"代码是唯一事实源"的原则**未作改动**。
另有 6 处**代码侧**不一致由对方报告、我随后修正（如 `SkillExecutor` 注释 10→30 分钟、
`config-cmd.js` 仍宣传已移除的"分差"规则、`libraryTestScan` 的 `REPO_OWNER` 指向旧仓库）。
**M1 期间修正的一处评估错误**：原 F-20 声称三个文件存在「编码损坏（乱码）」，
经字节级复核为**控制台解码假象**，文件本身均为合法 UTF-8。已在 `1b10001` 更正。
教训：终端显示不能作为编码结论的证据。

**M1 期间发现的新问题**（已记入后续里程碑）：
- `cli/lib/serve.js` 的信号处理器原先直接 `process.exit`，使 Server 的清理逻辑
  从未执行——已随 F-04 一并修复；此类「宿主抢先退出」问题在 Phase 2 引入更多
  进程边界时必须复查。
- `initContext` 会**无条件**构造 SkillSelector（其 `core/Agent.js` 顶层 import
  `dotenv`），使 FlexRunner 无法在「完全无依赖」环境下做纯 mock 测试，
  与 FlexRunner 自身「dotenv 可选」的注释不一致。建议改为惰性构造（归入 F-17/F-27）。

---

### M4 完成记录（全部 6 项）

> 提交 `bf69e5a`（`test:m1..m4` 当时写的就是这四个脚本名，M5~M7 的入口在各自阶段补入）。

| 编号 | 核心改动 | 验收 |
|---|---|---|
| **F-27** | 根 `package.json` 补齐 `test` / `test:m1..m4` / `test:unit` / `lint` / `coverage` / `ci` / `verify`；新增顶层聚合运行器 `test/run-all.mjs`（支持按套件名过滤、跨套件汇总断言数、失败即以非 0 退出） | `npm test` → 5 个顶层套件全绿；单纯跑 `npm test` 即可替代此前"手工跑脚本"的流程 |
| **F-28** | 引入 **Biome 2.5.13** 并新增 `biome.json`：只把**正确性类**规则提升为 error（`noDuplicateObjectKeys` / `noDuplicateCase` / `noFallthroughSwitchClause` / `noPrototypeBuiltins` / `noAsyncPromiseExecutor` / `noUnreachable` / `noConstAssign` / `noSelfAssign` / `noVoidTypeReturn` / `useIterableCallbackReturn`），风格类规则全部显式关闭并**在 `docs/LINT.md` 记录数量与理由** | `npm run lint` → **0 error / 279 warning / 205 文件**；`docs/LINT.md` 逐条列出被抑制规则的当前计数（`noInnerDeclarations` 489、`useArrowFunction` 277、`useOptionalChain` 157、`noAssignInExpressions` 69 …），把"技术债"变成可收敛的指标 |
| **F-29** | 新增 `scripts/ci.mjs` 统一 CI 入口（lint 门禁只看 error；随后跑全部测试套件）；新增 `.github/workflows/ci.yml` | `npm run ci` → lint exit 0 + 5 套件全绿，**74.6s** 完成 |
| **F-30** | 新增 `scripts/coverage.mjs`：基于 `NODE_V8_COVERAGE` 的字节覆盖率聚合（无第三方依赖） | 见下方"覆盖率基线" |
| **F-31** | 新增 `.gitattributes` 固化 `* text=auto eol=lf`，消除"同一文件在不同 OS 检出后整文件 diff"的噪声源 | 经验证：加入后**未**产生任何整文件 diff（说明仓库存量本就以 LF 入库，`core.autocrlf=true` 只影响工作区） |
| **F-32** | 8 个 `Server/Skills/**/scripts/*.sh` 由 CRLF 改为 LF（shebang 行尾 `\r` 会让 macOS/Linux 直接 `bad interpreter`）；JSON 元数据与 Markdown 一并复核 | 转换后 `node --check` 与文件头字节级复核通过；`git diff --stat` 无异常膨胀 |

**M4 验收总计**：`npm run test:m4` → 2 个套件 / **64 条断言** / 全绿。

#### 覆盖率基线（F-30，可复现）

```
# 采集 + 聚合
npm run coverage
# 期望输出（连跑 3 轮稳定）
已加载（被测到）: 64 | 从未加载: 8 | 已加载文件字节覆盖率: 61.7%
```

**可复现性验证（3 次连跑，同一命令同一机器）**：

| 轮次 | 覆盖率 | 字节数 | 已加载 / 未加载文件 |
|---|---|---|---|
| 1 | 61.7% | 467490 / 758216 | 64 / 8 |
| 2 | 61.7% | 467726 / 758216 | 64 / 8 |
| 3 | 61.7% | 467726 / 758216 | 64 / 8 |

- **百分比 3 轮完全一致**，因此 61.7% 可作为稳定基线。
- 第 2、3 轮**字节数完全相同**；第 1 轮相差 236 字节（0.03%），来源于
  异步/定时分支（如停机超时路径）的载荷差异。已在聚合器中用
  「**脚本内 last-wins + 跨脚本/跨进程取 max**」消除此前 36.5% ↔ 50.9% 的**大幅**抖动
  （V8 区间是嵌套的，必须取最内层区间；跨进程必须取并集而非覆盖）。
- `Server/FlexRunner/FlexRunner.js` 覆盖率最低（5.0%），因为它的主体逻辑需要真实
  opencode 会话；这是**已知且刻意**的——该模块的验证依靠 M1 的
  `FlexRunner.__` 注入式单测而非覆盖率。
- 覆盖率**不作为门禁**（`npm run ci` 不因覆盖率失败），原因同上：桩测覆盖率不衡量真实质量。

**M4 期间修正的自身缺陷（记录以便追溯）**：
1. 覆盖率工具第一版对嵌套区间取"最外层"，导致几乎所有文件报 100%（**假高**）；改为最内层/后写覆盖后正常。
2. 第二版跨进程合并用 last-wins，导致同一套件两次运行得到 36.5% 与 50.9%（**不可复现**）；改为取并集后稳定。
3. `__tests__` 目录被当成"源文件"统计，因为目录排除写成了"路径+分隔符"模式，对目录型路径不生效；已改为按目录名集合排除。
4. **`spawn EINVAL`**：Windows 上直接 spawn `biome.cmd` 会失败，已统一改为
   `node node_modules/@biomejs/biome/bin/biome`，`scripts/ci.mjs` 同步修正。
5. 工具链自检用例最初写在临时目录，而该目录不在 `biome.json` 的 `files.includes` 内，
   导致"故意写坏代码应被 lint 拦下"的探针**不会被扫描**（假绿）；已改为在
   `Server/.m4-lint-probe.js` 落盘并在 `finally` 中清理。
6. Biome 配置里两个键放错分组（`useIterableCallbackReturn` 属 `suspicious`）、
   一个键在 2.5 中已不存在（`noVar`）；ignore 目录需写 `!dir` 而非 `!dir/**`（Biome ≥2.2）。

---

## 2. Phase 2 —— `feat/multi-agent-monolith`：多 Agent 架构（仍为单体）

### 目标

把「**一步 = 一个 opencode 会话**」升级为「**一步 = 一组有角色的 Agent 协作**」，
但**保持单进程单进程部署**——不引入网络边界，先把多 Agent 的协作语义做对。

### 核心设计

| 抽象 | 说明 | 与现状的关系 |
|---|---|---|
| `AgentRole` | 角色定义（Planner / Coder / Reviewer / Verifier / Retriever），含 system prompt、工具集、可用 SKILL 子集 | 复用 `Server/Skills/` 作为能力来源，避免另起一套 |
| `AgentRuntime` | 承载一次角色执行（原 `FlexRunner` 的泛化），负责 session 生命周期、超时、取消 | 从 `FlexRunner` 抽取，**保留** `FlexRunner` 作为单角色兼容层 |
| `AgentMessage` | 结构化消息（`from`/`to`/`intent`/`payload`/`artifacts`/`correlationId`） | 替代当前靠 `result.md` 文件 + `inputReport` 路径传递 |
| `MessageBus` | 进程内 `EventEmitter` 总线，支持点对点与广播、请求-响应（带 `correlationId`） | 新增，为 Phase 3/4 换成真实 MQ 预留同一接口 |
| `Blackboard` | 共享工作区（任务级 artifact 目录 + 索引），所有 Agent 读写同一黑板 | 复用现有 `db/task/{taskId}/` 目录布局 |
| `Supervisor` | 编排者：把 `StepNode` 展开为「角色子图」，按 `AgentMessage` 驱动 | 复用 `Orchestrator` 的 DAG 语义，不重写调度器 |

### 关键重构点

1. **不推翻 Orchestrator**：DAG、fan-in/fan-out、`failStepId` 修复链、死锁检测全部保留；
   只把 `_executeNode` 内部的"单 runner"替换为"角色子图执行"。
2. **消息替代文件**：`_resolveInputReport` 的路径传递改为 artifact 引用 + 消息载荷，
   文件仅作为 artifact 落盘形式（便于审计），不再是**唯一**通信手段。
3. **保留可注入性**：`flexRunnerFactory` → `agentRuntimeFactory`，确保 F-27 的纯调度单测继续可用。
4. **前端可视化**：`Web/public/js/loop.js` 的步骤图扩展为可下钻的 Agent 拓扑（谁跟谁说了什么）。

### 验收

- 同一任务可被 Planner → Coder → Reviewer 三角色接力，Reviewer 否决时触发 Coder 重做（有界）；
- Agent 间通信 100% 可从 `MessageBus` 的回放日志重建；
- 单体部署，进程数与 Phase 1 相同；
- 现有 4 个前端面板（arkts/rn/flutter/codecheck）功能不回归。

---

### Phase 2 完成记录（M5）

> 提交 `8051367`。下文以「文件 + 可复现命令 + 实测数值」为证据。

#### 交付物

| 分层 | 新增文件 | 职责 |
|---|---|---|
| 角色 | `Server/Agent/Roles/AgentRole.js` | 5 个内置角色（planner/retriever/coder/reviewer/verifier）+ **SKILL 能力边界**（模式策略）+ prompt 组装 |
| 消息 | `Server/Agent/Messaging/AgentMessage.js`<br>`Server/Agent/Messaging/MessageBus.js` | 不可变结构化消息（10 种 intent、确定性 id、correlationId 配对）<br>进程内总线（点对点/广播/请求-响应/超时/回放日志/排空/有界） |
| 黑板 | `Server/Agent/Blackboard/Blackboard.js` | 任务级共享工作区：条目版本化 + 产物 + **路径边界校验** + 原子落盘 |
| 运行时 | `Server/Agent/Runtime/AgentRuntime.js` | 单角色执行器（会话槽位准入、SKILL 准入、角色 prompt、失败五分类） |
| 编排 | `Server/Agent/Supervisor/Supervisor.js`<br>`Server/Agent/Supervisor/CollaborationPlan.js`<br>`Server/Agent/Supervisor/MultiAgentRunner.js` | 步骤内角色子图（含**评审门与修订环**）<br>4 个内置计划（thorough/standard/verify-only/single）<br>面向 Orchestrator 的 Runner 契约适配层 |
| 入口 | `Server/Agent/index.js` | 模块统一导出 |

#### 对既有代码的改动（全部为**加法**，"加接口不改语义"）

| 文件 | 改动 | 缺省行为 |
|---|---|---|
| `Server/FlexRunner/FlexRunner.js` | 新增 `roleId` / `rolePrompt` / `skillAllowList` / `initialExecuteStep` 四个可选入参；产物命名抽出 `#artifactPath()` | **不传时 prompt 与产物名逐字节不变**（有断言守护） |
| `Server/Orchestrator/Orchestrator.js` | `multiAgentRunnerFactory` / `multiAgentEnabled` / `roleRegistry` 注入；`_createMultiAgentRunner()`；`_executeNode` 支持 `managesOwnConcurrency`；新增 7 个 `orch:agent:*` SSE 事件；`getAgentTopology()` / `getMultiAgentStats()`；步骤结束时快照协作结论 | `MULTI_AGENT_ENABLED` 未设为 `1` 时**完全走 Phase 1 路径** |
| `Server/Orchestrator/StepNode.js` | 新增 `multiAgent`（null/true/false 三态）与 `collaboration` 字段及 `updateStep` 支持 | 三态缺省 `null` = 跟随全局开关 |
| `Web/public/index.html` `js/loop.js` `css/loop.css` | 详情面板新增「🤖 Agent 协作」页签：角色子图 / 角色时间线 / 评审结论 / 消息拓扑 / 协作摘要 | 无协作数据时显示引导文案（不报错、不留空白） |
| `Server/Routes/**` | 新增 `GET /api/orchestrator/agent-topology` | 独立端点，**步骤结束、runner 被回收后仍可查** |

#### 验收（`npm run test:m5` → 3 个套件 / **166 条断言** / 全绿）

| 套件 | 覆盖 | 断言 |
|---|---|---|
| `f33-agent-foundation.test.mjs` | 消息不可变与 9 类非法输入拒绝；总线的配对/超时/异常隔离/有界/排空/覆盖注册；黑板的版本化/8 类越界路径/30 路并发无丢更新/重载；角色的 SKILL 边界与通信契约；计划的引用完整性（自审、悬空 reviews、重复 id 均被拒） | 58 |
| `f34-supervisor-review-loop.test.mjs` | **评审门与修订环**（含"评审者 prompt 里确实出现了执行者产物正文"）、有界性、结论三态、**回放日志重建协作**、越权 SKILL 不建会话、指定 SKILL 收窄、`maxRoleRuns` 兜底 | 58 |
| `f35-runner-contract-concurrency.test.mjs` | FlexRunner 角色化扩展（含"无角色时 prompt 逐字不变"）；Runner 契约齐备性；Orchestrator 分派优先级；**并发不变式**；协作快照与 HTTP 端点；4 个前端面板不回归 | 50 |

#### 关键实测数值

| 指标 | 实测值 |
|---|---|
| 修订环有界性（始终驳回） | `maxRevisions=2` 时实现阶段恰好执行 **3 次**（1 + 2），随后归因 `review_rejected`，且**不再执行验证阶段** |
| 协作可重建性 | 由回放日志重建的角色序列与执行记录**完全一致**（`[coder,reviewer,coder,reviewer]`） |
| 角色隔离 | 越权 SKILL 在**创建会话之前**被拦截（`sessions=0`），归因 `skill_blocked` |
| 成本可控 | 指定 SKILL 时计划收窄为单阶段：**1 个会话 vs 完整计划 5 个**（5 倍差异，且收窄决策被显式记录） |
| 并发不变式 | 4 个并行步骤 × 5 个角色 = **20 个会话**，全局上限 3 → 实测并发峰值 **恰好 3**，槽位获取次数 **= 20**（不多占不少占），租约全部释放 |
| 全量回归 | `npm run ci`：lint **0 error / 288 warning / 218 文件**；6 个套件 **563 条断言**全绿，76.1s |

#### Phase 2 期间发现并修复的 5 个问题（含 2 个是"设计错、测试抓到"）

1. **`ManagesOwnConcurrency` 与槽位重复占用**：多 Agent 下一步会产生 N 个角色会话。
   若 Orchestrator 仍按 Phase 1 为每步预占一个槽位，加上每个角色各取一个，
   就会出现"槽位被重复占用、可用并发远低于配置上限"。修法：运行器显式声明
   `managesOwnConcurrency = true`，Orchestrator 见此后跳过预占。
   **实测证据**：上限 3 时峰值恰为 3、获取次数恰等于会话数 20。
2. **多 Agent 分派被注入的 `flexRunnerFactory` 短路**：`_createFlexRunner` 原先
   先看工厂再看多 Agent 开关，"开了多 Agent 却因注入了工厂而静默退回单角色"。
   已把分派判定提到工厂之前（用例 C3/C6 复现并守护）。
3. **`collaboration: null` 静默冲掉默认计划**：`StepNode` 把未配置的
   `collaboration` 归一化为 `null`，而 `null !== undefined` 使
   `resolvePlan(null, 'standard')` 落到默认**名字**，把构造时配置的
   `thorough` 计划实例覆盖掉。**症状**：配了 5 阶段计划却只跑了 2 个阶段。
4. **`getCollaborationSummary()` 返回的 `plan` 是字符串而非结构**：前端拿不到
   `stages`，角色子图画不出来（用例 F2 复现）。
5. **`deriveTopology` 把广播展开成 N 条假边**：5 个角色时一条
   `ARTIFACT_PUBLISHED` 就产生 4 条并不存在的"定向交互"，把"谁跟谁真有来往"
   淹没在噪声里。已改为广播单独统计（`broadcasts`），不进 `edges`。
6. **协议缺"请求评审"这一环**：原先只有"编排者给评审者派活"，
   `REQUEST_REVIEW` 意图从未被真正使用，拓扑图上没有 `coder→reviewer` 边。
   已补上（由**被评审阶段的角色**发出，因为评审的起因是它产出了产物）。

> 教训（与 M1/M3 一致的同一类问题）：**"配置生效了"必须由断言证明**。
> 上面 3、4、5 三条都属于"代码看起来对、行为却不是配置所描述的那样"，
> 全部由"断言实际行为而非实现细节"的用例抓到。

---

## 3. Phase 3 —— `feat/multi-agent-concurrency`：+ 高并发

### 目标

在 Phase 2 的多 Agent 拓扑上，做到「**500 并发步骤不死锁、不泄漏、性能可预测**」。

### 核心设计

| 能力 | 做法 |
|---|---|
| **三级限流** | 全局 / 任务级 / 角色级信号量（角色级用于限制"最贵的角色"，如同时最多 N 个 Coder） |
| **取消树** | `AbortController` 树：任务 → 步骤 → Agent → HTTP 请求，逐层传播；父取消则子全取消 |
| **背压** | SSE 改增量 delta + 水位上限 + 丢帧策略；MessageBus 队列水位告警 |
| **事件驱动** | 用 opencode 的事件流（`/event`）替代 3~5s 轮询，消除 N×0.2 req/s 的空转与延迟 |
| **资源池** | opencode SDK client 池化（共享 keep-alive / 全局连接上限）；session 复用与配额 |
| **背压式队列** | 调度从"就绪即启动"改为"有界队列 + 准入控制"，避免 fan-out 瞬间打爆外部单进程 |
| **可观测** | `queueWaitP95` / `slotHoldP95` / `orphanSessions` / `sseBufferBytes` / `activeAgents` |

### 压测方案（关键）

**不需要真实 LLM 即可压测**：`Orchestrator` 的 `flexRunnerFactory` 注入点允许注入
"mock AgentRuntime"（可配置延迟分布 / 失败率 / 挂起率）。因此：

- 场景 A：200 并发步骤，正常延迟 → 验证吞吐与 `active ≤ limit`；
- 场景 B：10% 随机失败 + 修复链 → 验证不放大、不饿死；
- 场景 C：注入 5% 永久挂起 session → 验证**超时回收 + 不死锁**（Phase 1 的 F-06 验收项）；
- 场景 D：慢 SSE 客户端 → 验证内存有界（F-09）。

### 验收

- 500 并发步骤无死锁；`orphanSessions == 0`；RSS 有界；
- 单任务不能饿死其他任务（隔离验收）；
- 事件驱动替代轮询后，单步完成感知延迟从 ~5s 降到 <1s。

---

### Phase 3 完成记录（M6）

> 提交 `af059e8`。

#### 交付物（新增 4 个模块，全部零依赖）

| 模块 | 职责 | 关键设计 |
|---|---|---|
| `Server/library/LatencyRecorder.js` | 有界延迟采样与分位数 | **环形缓冲**（默认 2048 样本）——压测 500 并发时无界数组会直接吃光内存；分位数用最邻近秩，无近似算法 |
| `Server/library/AbortTree.js` | 可级联取消树（task → step → role → HTTP） | **向下传播、不向上传播、取消后新派生即死、幂等、无监听器泄漏、孤儿可观测** |
| `Server/library/SessionWaiter.js` | 会话完成等待：事件驱动为主 + 轮询兜底 | 先查后睡、事件到达即返回、**保留兜底轮询**（不把可靠性押在外部事件流的完整性上） |
| `Server/Agent/Runtime/RoleLimiter.js` | 第三级限流：角色级并发上限 | 解决"**配比**"而非"总量"；P95 排队/持有指标；运行期可调 |

#### 三级限流与获取顺序（无死锁的关键）

```
全局 MAX_CONCURRENT_SESSIONS        ── 保护外部单进程（opencode）不被压垮
  └ 任务级 MAX_SESSIONS_PER_TASK    ── 防止单任务独占全部槽位（隔离）
       └ 角色级 MAX_SESSIONS_PER_ROLE ── 防止贵角色挤死关键角色（配比）
```

AgentRuntime 的获取顺序固定为 **角色槽位 → 全局槽位**，释放顺序相反，**所有参与者遵守同一顺序**，
因此不可能出现循环等待。为什么是"角色先、全局后"：反过来会让最稀缺的全局槽位被"空等角色槽位"占用。
`test/m6-phase3/f37` 有饱和用例（全局 3 + coder 2 + 24 个会话）与极端用例（全局 1 + 角色 1）
专门守护这条不变式。

配置（**全部默认 0 = 不限制**，即未配置时行为与 Phase 2 完全一致）：

| 环境变量 | 含义 |
|---|---|
| `MAX_SESSIONS_PER_ROLE` | 未单独指定的角色统一上限 |
| `ROLE_LIMIT_<ROLE>` | 单角色上限，如 `ROLE_LIMIT_CODER=8` |
| `ROLE_SLOT_ACQUIRE_TIMEOUT_MS` | 角色槽位等待超时（默认 15 分钟） |

#### 会话等待：从轮询到事件驱动

| 维度 | Phase 1/2（`sleep → check`） | Phase 3（`check → sleep` + 事件） |
|---|---|---|
| 已完成会话的感知延迟 | **≥ 一个轮询间隔（默认 5s）** | 一次 RTT（实测 **0ms**） |
| 事件到达时的延迟 | 不受影响，仍需等满间隔 | 事件到达即返回（mock 实测 **32ms**） |
| 状态查询次数 | N / 5s（500 会话 → 100 req/s） | 事件模式下降为 N / 30s |
| 事件丢失 | — | 兜底轮询仍能完成（实测 **47ms** 内收敛） |
| 中止响应 | 受轮询间隔约束 | **62ms**（独立中止监听） |

> 诚实边界：真实 opencode 事件流在本环境不可用（需要活的服务），因此事件源设计为**可注入**，
> "事件驱动真的更快"由 mock 测量断言，而不是只靠读代码相信。

#### 验收（`npm run test:m6` → 3 个套件 / **102 条断言** / 全绿）

| 套件 | 覆盖 | 断言 |
|---|---|---|
| `f36-waiter-and-metrics` | 分位数定义与长尾可见性、先查后睡、事件驱动延迟、丢事件兜底、超时/中止、**无监听器泄漏** | 24 |
| `f37-abort-tree-and-role-limits` | 取消传播语义（含"取消后新派生即死"）、孤儿可观测与摘除、角色限流（FIFO/超时/幂等/运行期调整）、**饱和下无死锁**、端到端级联取消真的到达角色会话 | 45 |
| `f38-load-scenarios` | 压测四场景 + 可观测性 | 33 |

#### 压测实测数值（不需要真实 LLM）

| 场景 | 实测结果 |
|---|---|
| A｜100 步 × 5 角色 = **500 个并发角色会话** | 全部完成；会话并发峰值 **40 = 上限**（既不死锁也不串行）；槽位全释放；取消树孤儿 **0**；耗时 **595ms**；RSS **101MB** |
| B｜260 步（超 `GLOBAL_EXEC_LIMIT`） | 执行 **200** 步后截断，**残留 running = 0**，60 步保持 ready 并给出可归因原因 |
| C｜10% 随机失败 + 修复链 | 收敛到终态；会话数未放大成重试风暴；失败路径槽位不泄漏 |
| D｜reviewer **永久挂起**（阶段超时 400ms） | 6 个挂起会话全部被超时回收；整批 **822ms** 结束；归因 `[协作失败 timeout]`；槽位/孤儿均归零 |
| E｜慢 SSE 客户端（200 帧打进不 drain 的连接） | 只写入 **1** 帧后即断开，`droppedConnections=1` 可见；不影响新连接 |
| F｜可观测性 | `queueWaitP95=80ms`、`slotHoldP95=19ms`、角色 `limit=2/peak=2`、`orphans=0`、`waiting=0` 均可直接读出 |

#### Phase 3 期间发现并修复的 6 个缺陷（**其中第 1 条是高并发下的严重缺陷**）

1. **`GLOBAL_EXEC_LIMIT` 命中时直接 `return`，抛下全部在途步骤**（压测发现）。
   触发链路：就绪步骤数 > 200 时第一轮就把 200 个步骤 kick 出去，某步完成后回到循环顶部命中上限 → **立即返回**。
   **实测（260 步 / 200 个在途会话）：`start()` 返回时 `completed=1 / running=199 / ready=60`** ——
   编排报告"已结束"，而 **199 个会话仍在运行**；上层据此 dispose 并认为可以停机。
   修法：**停止启动新步骤，但必须把在途步骤等完**（`GLOBAL_EXEC_LIMIT` 仍然限制总执行次数，防环能力不变）。
   修复后：`completed=200 / running=0 / ready=60`。
2. **`abortAndWait()` 在"已经是 aborted"时完全不等待**：原实现的等待循环只在
   `status === RUNNING` 分支里，于是调用方先 `abort()` 再 `abortAndWait()` 时整个等待被跳过
   （实测 `inFlight=1` 却 **0ms** 返回）。修法：等待以 `_inFlight` 为准，与状态解耦。
3. **取消信号被"运行器级信号"屏蔽**：`p.signal || this._abortNode?.signal` 使取消树的信号在
   运行器已有自身 AbortController 时被丢弃——表现为"编排层报告已取消，角色会话仍在跑"。
   修法：用 `AbortSignal.any` **取并集**。
4. **取消树级联计数恒为 1**：同时存在"父注册子回调"与"父遍历 children"两条传播路径，
   子节点被回调提前置为已取消，随后的遍历对每个子节点都返回 0。节点确实全被取消，但
   **计数错**会让可观测面板低报取消规模。修法：**只保留单一传播路径**。
5. **多 Agent 失败时步骤 `error` 为空**：运行器以"返回 `success:false`"表达失败（而非抛异常），
   于是 `node.error` 一直是 null，直接违背 F-27 的"失败必须可归因"。修法：从协作摘要回填原因
   （实测归因变为 `[协作失败 timeout] 角色 review…`）。
6. **取消树根节点永远无法摘除 + 步骤节点 dispose 不在 `finally`**：
   根节点无父，`dispose()` 的 `if (this.parent)` 使它无法从登记表移除，
   `orphans` 恒 ≥ 1 —— **一个永远不为零的泄漏指标等于没有指标**；
   且 dispose 只在正常流程末尾，任何抛出都会留下永久孤儿。两处均已修正。

**Phase 3 未完成 / 明确留给 Phase 4 的项**（避免把规划当成已完成）：

- **SSE 增量 delta 协议**：M2 已实现背压 + 全量快照合并（F-09/F-10），Phase 3 补充了水位与丢弃统计；
  但"序列号 + 客户端增量应用 + 失步重同步"的完整 delta 协议**未实现**——它需要配套的前端状态机，
  当前 ROI 不如先把会话侧（真正的成本与风险所在）做对。
- **client 池化**：opencode SDK 的 keep-alive 复用尚未接入（需要活的服务才能验证连接数下降）。
- **`orphanSessions == 0` 的口径**：当前以取消树孤儿数为代理指标（步骤/角色节点全部摘除），
  真实远端会话的孤儿数需要 Phase 4 的会话登记表才能直接统计。

---

## 4. Phase 4 —— `feat/multi-agent-distributed`：+ 企业级分布式微服务

### 目标

从"单进程高并发"演进为**可多实例水平扩展、可多租户、可审计**的企业级形态。

### 服务拆分

| 服务 | 职责 | 从现有模块迁移 |
|---|---|---|
| `gateway-svc` | 认证、鉴权、租户路由、配额、审计入口 | `Server/Routes/*` + `Web/server.js` 代理 |
| `orchestrator-svc` | 任务生命周期、DAG 调度、状态机 | `LoopEngine` + `Brain` + `Orchestrator` |
| `agent-runtime-svc` | Agent 执行、session 管理、SKILL 加载 | `FlexRunner` + `CLI` + `Agent/SkillSelector` |
| `artifact-svc` | 产物存储与检索（对象存储 + 元数据） | `DbUse/FileAdapter` + `db/task/*` |
| `knowledge-svc` | 经验/规则知识库、检索与去重 | `Knowledge` + `Archive` + `BadCase` |
| `notify-svc` | SSE / WebSocket 推送（跨实例扇出） | `SseHub` + `StreamController` |

### 基础设施替换

| 现状 | 演进 |
|---|---|
| 进程内 `Map` 注册表 | **PostgreSQL**（任务/步骤/租约）+ 乐观锁 |
| 进程内信号量 | **Redis** 分布式令牌（Redlock / Lua 原子令牌桶） |
| 本地 `db/task/` 文件 | **对象存储**（S3/OSS/MinIO）+ 元数据表 |
| `owner.json` + pid 探测 | **租约（lease）+ 心跳**，过期自动接管；幂等 step 执行 + Saga 补偿 |
| 进程内 `EventEmitter` | **消息队列**（Redis Streams / Kafka），at-least-once + 幂等消费 |
| 手工日志 | **OpenTelemetry** 链路（任务→步骤→Agent→LLM 调用）+ Prometheus 指标 + 告警 |

### 企业级能力

- **多租户**：租户隔离（数据/配额/密钥），OAuth2 / JWT + RBAC；
- **成本治理**：LLM token 计量与配额（当前**完全缺失**，`llmClient` 甚至丢弃响应里的 tokens/cost）、按租户计费与熔断；
- **合规审计**：所有 LLM 调用与 Agent 决策留痕，可回溯"为什么这样规划"（当前 SkillSelector 的 `trace` 被调用方丢弃）；
- **发布**：K8s + HPA + Helm；灰度与回滚；幂等迁移脚本；
- **SLA**：任务成功率、P95 端到端时延、单任务成本上限。

### 验收

- 水平扩展：3 实例并跑，任务不被重复执行（幂等 + 租约验收）；
- 任一实例 `kill -9`，在途任务在租约过期后被其他实例接管并正确收尾；
- 跨实例 SSE 推送正确（notify-svc 扇出）；
- 全链路 trace 能从任务 ID 下钻到具体 LLM 调用。

---

### Phase 4 完成记录（M7）

> 提交 `e497ad1`。

#### 交付物（新增 `Server/Distributed/`，8 个模块 + 1 个启动入口）

| 模块 | 解决的**单进程无法解决**的问题 | 关键机制 |
|---|---|---|
| `Lease.js` | 任务被两个实例同时执行 | 租约 + 心跳 + **fencing token**（单调递增，写入前校验） |
| `Semaphore.js` | 全局并发上限在多实例下被放大 N 倍 | Redis 原子令牌（Lua）+ **令牌 TTL**（崩溃实例自动让出份额） |
| `Queue.js` | 消息至少一次、消费者可能崩溃 | 重投 + 幂等消费 + 死信队列 |
| `Notify.js` | SSE 连接在实例 A、任务在实例 B | 跨实例扇出 + **回环抑制** + 实例级去重 |
| `Trace.js` | "为什么这样规划"无法回答 | W3C `traceparent` 父子跨度树 + 头部采样 |
| `Tenant.js` | 租户之间互相可见 | **结构性隔离**（键命名空间）+ RBAC + 配额 |
| `Governance.js` | 成本与合规完全缺失 | token 计量（按用途下钻）+ 预算熔断 + **哈希链审计** |
| `ServiceHost.js` | 服务边界靠纪律维持 | 声明式边界 + 统一中间件（链路/租户/鉴权/审计） |
| `bootstrap.js` | — | 服务启动入口（可 `--list` 自检） |

#### 部署产物

`deploy/docker-compose.yml`（6 服务 + PG/Redis/MinIO）、`deploy/k8s/all-in-one.yaml`
（Namespace/ConfigMap/6 Deployment/Service/HPA/Ingress/PDB）、`deploy/helm/3rdlibloop/`
（Chart + values + 5 个模板）、`deploy/Dockerfile`（非 root + 健康检查）、
`deploy/migrations/001_leases.sql`（幂等迁移 + 审计不可删除约束）。

#### 验收（`npm run test:m7` → 3 个套件 / **182 条断言** / 全绿）

| 套件 | 覆盖 | 断言 |
|---|---|---|
| `f39-lease-queue-semaphore` | 租约语义、**fencing 挡住僵死写入者**、3 实例不重复执行、崩溃接管、跨实例令牌上限、TTL 回收崩溃实例的令牌、至少一次 + 幂等 + 死信、真实后端命令静态复核 | 62 |
| `f40-trace-tenant-governance` | traceparent 解析/生成/续接/采样、span 树 4 层下钻、键命名空间隔离、RBAC、配额（含"被拒不计数"）、成本计量与预算熔断、**审计哈希链篡改必被发现**、跨实例扇出 | 60 |
| `f41-service-host-and-deploy` | 服务边界自洽（状态所有权唯一）、统一中间件（400/403/404/traceparent/审计）、跨服务同一棵 trace、真实 HTTP 端到端、**部署产物与代码三方一致** | 60 |

#### 关键实测数值

| 指标 | 实测值 |
|---|---|
| 3 实例竞争 30 个任务 | **重复执行 0 个**，覆盖 30/30，负载分布到多个实例 |
| 崩溃接管 | 未过期时拒绝抢占（无脑裂）；过期后接管成功且 token 更大；旧持有者写入被拒（`ESTALE_FENCE`） |
| 跨实例令牌 | 上限 3 时第 4 个请求被拒（waited 156ms）；**崩溃实例的令牌在 TTL 后自动回收**（count 3 → 0） |
| 消息语义 | 反复失败的消息在第 3 次尝试后进入死信并记录原因；单条失败不影响同批其他消息 |
| 跨服务 trace | gateway → orchestrator 的跨度落在**同一棵树**，父子关系正确，从 taskId 可下钻到服务级调用 |
| 跨实例 SSE | 发布到 i2 → i1/i3 各收到 1 次；发布者本地直发 1 次；回环抑制与重复投递去重均生效 |
| 审计完整性 | 修改任意一条记录 → `verify()` 在**精确的 seq** 处报错；删除/重排 → `prevHash 不连续` |
| 部署一致性 | 6 服务的端口在 **代码 / k8s / helm / Chart 注解**四处逐一对齐（自动校验） |

#### Phase 4 期间发现并修复的 4 个缺陷

1. **分布式令牌 id 跨实例碰撞 → 全局上限被静默放宽**（最严重）。
   token id 由 `pid + hostname + 序号 + 毫秒时间戳` 组成；同进程多实例、hostname 相同、
   同一毫秒时，三个实例生成**完全相同的 id**。ZSET/Map 是集合语义，**三个令牌被折叠成一个**
   （`ZCARD` 返回 1 而不是 3）——限流器以为还有额度，实际并发已超。
   修法：id 加随机后缀（跨实例/跨重启碰撞概率可忽略）+ 断言守护。
   这类"只在真实多实例下暴露、且表现为**放宽限制**而非报错"的缺陷，正是必须做压测的理由。
2. **成本熔断器统计恒为 0**：`spentUsd` 的过滤条件里含 `Date.parse(r.at) >= 熔断器创建时刻`，
   于是"在已有花费之后才创建熔断器"时统计为 0 —— 一个在超支后才建立的熔断器认为当前没花钱，
   完全失去拦截作用。修法：只按滚动窗口统计，不看"我是什么时候开始看的"。
3. **`remote` 投递计数把发布者自己算进去**：跨实例扇出的 `broadcastExcept` 实际投递给了所有订阅者，
   由接收侧抑制回环。导致"扇出了几个实例"这个指标多算 1，失去意义。
   修法：订阅时登记实例 id，发布侧真正排除来源实例（**同时保留接收侧的判定**，
   因为真实 Redis Pub/Sub 仍会把消息投回发布者）。
4. **集群中运行单实例语义且无人知晓**：`bootstrap.js` 现在会在检测到 `POD_NAME`/
   `KUBERNETES_SERVICE_HOST` 而租约/令牌/队列仍是内存后端时**显式告警**——
   这是最危险的状态（任务可能被重复执行，而日志里没有任何异常迹象）。

#### 诚实边界（明确"需要真实基础设施才能验证"的部分）

本仓库内的测试验证的是**语义、命令文本与参数、部署产物一致性**；以下必须在真实环境验证，
代码中已逐处标注，未做"跑通 mock 即宣称分布式可用"的表述：

| 项 | 为什么本机无法验证 |
|---|---|
| PostgreSQL 租约的端到端行为 | 需要活的 PG：`ON CONFLICT ... WHERE` 的实际并发语义、隔离级别对 `RETURNING` 的影响 |
| Redis 令牌 Lua | 需要活的 Redis：脚本原子性、`ZREMRANGEBYSCORE` 在大 key 下的性能 |
| Redis Streams 至少一次 | 需要活的 Redis：消费组重平衡、`XAUTOCLAIM` 的最小空闲时间语义、AOF 策略 |
| `kill -9` 级真实接管 | 需要真实多进程/多 Pod 编排（本层用假时钟 + 独立实例对象验证了同一套语义） |
| K8s / Helm 实际部署 | 需要集群与镜像仓库（本层校验了模板结构与跨文件一致性） |
| 对象存储（MinIO/S3） | 需要真实服务端 |

**未实现（明确不在本轮范围）**：
- 服务间真实 HTTP 调用链（`ServiceHost` 已提供宿主与中间件，但 `orchestrator` 尚未真正调用
  `agent-runtime-svc` 的会话接口——那需要把 Phase 1~3 的 `Orchestrator`/`FlexRunner` 拆成
  独立进程，属于**代码迁移**而非新能力）；
- OAuth2/JWT 的令牌签发与校验（当前 `POST /auth/token` 只返回该身份的权限集合，
  真实令牌需要接 IdP）；
- 迁移脚本只提供 `001_leases.sql`（含任务/步骤/幂等/审计表），尚无版本化迁移执行器；
- 灰度发布的**流量切分**（Ingress 注解已就位，但未接服务网格/Flagger）。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| Phase 1 的 F-02 加认证可能打断现有前端/CLI 调用 | 分两步：先限绑定 + 白名单，再加令牌；令牌兼容期支持"仅回环免令牌" |
| F-03 主动 `deleteSession` 会丢失事后审计用的 opencode 会话 | 先确认 `db/Session/*.jsonl` 归档完整（已有归档机制），再删远端会话；保留可配置开关 |
| F-11 防抖落盘可能丢失崩溃前最后状态 | 防抖窗口 300ms + 关键状态（步骤终态/任务终态）强制立即落盘，不参与合并 |
| Phase 2 消息化改动面大 | 保留 `FlexRunner` 兼容层与 `inputReport` 路径语义，新旧并存一个版本，按 SKILL 灰度切换 |
| Phase 3/4 引入外部依赖（Redis/PG/MQ/K8s）提高本地开发门槛 | 提供 `docker-compose` 一键起本地依赖；保留 Phase 2 的单进程模式作为"lite"运行档 |
| 分支堆叠导致合并冲突 | 每个 Phase 启动时先合上级；修复类改动统一 cherry-pick 而非整体回灌 |

---

## 6. 附：立即可复现的核验命令

```bash
# 远端唯一性与地址
git remote -v
git config --get-regexp insteadOf        # 期望无输出

# M1 已完成的验收项（修复后应满足）
git grep -n "7594" -- Server cli Web MCP Archive Tools   # F-01，期望无输出
git grep -nE "ADMIN_PASSWORD\s*=.*\|\|"                  # F-02，期望无输出
git grep -nE "!==\s*ADMIN_PASSWORD"                      # F-02，期望无输出
git grep -n "deleteSession" -- Server/FlexRunner         # F-03，期望出现在 _finalizeSession
git grep -n "gracefulShutdown" -- Server cli             # F-04，期望出现在 server.js / serve.js

# 未实现即宣称项（F-18）
git grep -n "_execPathTrace"             # 当前：仅声明与 clear，无读取
git grep -n "_stmtCache"                 # 当前：仅声明与 clear，无写入

# 并发上限可观测入口
curl -s http://127.0.0.1:3000/api/stats/session/concurrency

# 测试入口现状（F-27：期望 Server 也出现 test 脚本）
git grep -n '"test"' -- cli/package.json Server/package.json package.json
```

**7 个里程碑的一键复现（当前全部通过）**：

```bash
npm run ci                 # lint（0 error 门禁）+ 全部套件；期望 8/8 通过
npm run test:m1            # 65 条断言
npm run test:m2            # 165 条断言
npm run test:m3            # 160 条断言
npm run test:m4            # 64 条断言
npm run test:m5            # Phase 2：多 Agent 单体（166 条）
npm run test:m6            # Phase 3：多 Agent + 高并发（102 条）
npm run test:m7            # Phase 4：企业级分布式（182 条）
```

**Phase 3/4 关键证据的单独复现**：

```bash
# 500 个并发角色会话、并发峰值不超上限、无孤儿（场景 A）
node test/m6-phase3/f38-load-scenarios.test.mjs

# 3 实例竞争 30 个任务、重复执行 0 个；崩溃后接管且旧持有者写入被拒
node test/m7-phase4/f39-lease-queue-semaphore.test.mjs

# 部署产物与代码的端口/服务名四方一致性
node test/m7-phase4/f41-service-host-and-deploy.test.mjs

# 服务表自检（含边界校验）
node Server/Distributed/bootstrap.js --list
```

---

## 7. 修订记录

| 日期 | 修订 | 说明 |
|---|---|---|
| 2026-09-04 | 初版 | 修复计划 P0/P1/P2/P3 + 三阶段架构演进 |
| 2026-09-04 | 补充 F-32 | 推送验证时实测发现 `core.autocrlf=true` 且无 `.gitattributes` |
| 2026-09-04 | **修正 F-20** | **原 F-20 声称 `Server/package.json`、`cli/package.json`、`.gitignore` 存在"编码损坏（乱码）"。经字节级复核，四个文件**均为合法 UTF-8、中文内容正确**，先前观察到的乱码是 PowerShell 控制台按遗留代码页解码 UTF-8 字节的**显示假象**。F-20 已改写为真实的元数据漂移问题（`cli/package.json` 仓库地址仍指向旧命名空间 `lalhanOrz`）。教训：控制台输出的编码结论必须用字节级/工具级复核，不能直接采信。 |
| 2026-09-05 | 补齐 M4~M7 完成记录 | 新增 M4 / Phase 2（M5）/ Phase 3（M6）/ Phase 4（M7）四段完成记录：交付物、对既有代码的加法改动、断言分布、可复现实测数值，以及每阶段发现并修复的缺陷（含 M6 的 `GLOBAL_EXEC_LIMIT` 抛下 199 个在途步骤、M7 的分布式令牌 id 碰撞导致全局上限被静默放宽）。 |
| 2026-09-05 | **§0.2 分支模型被取代** | 记录实际执行方式为 `main` 单线（M1~M7 共 13 个提交），并如实说明未使用堆叠分支的成因；附实测证据说明"按目录拆分支"不可行（`Orchestrator.js` 静态 import `AbortTree`/`RoleLimiter`，删目录即 `ERR_MODULE_NOT_FOUND`），以及替代的分阶段回溯方式（提交 + 测试目录 + 开关）。 |
| 2026-09-05 | Phase 4 的诚实边界 | 明确列出**必须真实基础设施才能验证**的项（PostgreSQL `ON CONFLICT` 并发语义、Redis Lua 原子性、`kill -9` 级接管、K8s/Helm 实际部署、对象存储）与**未实现**项（服务间真实 HTTP 调用链、OAuth2/JWT 签发、版本化迁移执行器、灰度流量切分），避免把"跑通 mock"表述为"分布式可用"。 |

