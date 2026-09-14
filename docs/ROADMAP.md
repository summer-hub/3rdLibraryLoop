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

### 0.2 分支模型

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
M4（纪律）  F-27 … F-31                            → 可回归、可 CI 守护
```

每个 M 结束打 tag：`v0.1.0-m1` … `v0.1.0-m4`。

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

---

## 7. 修订记录

| 日期 | 修订 | 说明 |
|---|---|---|
| 2026-09-04 | 初版 | 修复计划 P0/P1/P2/P3 + 三阶段架构演进 |
| 2026-09-04 | 补充 F-32 | 推送验证时实测发现 `core.autocrlf=true` 且无 `.gitattributes` |
| 2026-09-04 | **修正 F-20** | **原 F-20 声称 `Server/package.json`、`cli/package.json`、`.gitignore` 存在"编码损坏（乱码）"。经字节级复核，四个文件**均为合法 UTF-8、中文内容正确**，先前观察到的乱码是 PowerShell 控制台按遗留代码页解码 UTF-8 字节的**显示假象**。F-20 已改写为真实的元数据漂移问题（`cli/package.json` 仓库地址仍指向旧命名空间 `lalhanOrz`）。教训：控制台输出的编码结论必须用字节级/工具级复核，不能直接采信。 |

