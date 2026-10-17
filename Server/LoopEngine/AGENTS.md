# LoopEngine — 大循环协调引擎（门面层）

> ⚠️ **实现已整体迁入插件 `plugins/engines/loopengine/`**（`LoopEngine.js` 1 个实现实体
> 1364 行原样搬走，业务逻辑逐行不变；无状态依赖 `nowCST` 归一到内核 `core/cstTime.js`，
> 三条协作方改为解析器）。本目录**全部是转发门面**，零业务逻辑；`Server/**` 侧消费者与
> 既有测试按老路径 import，插件化不该顺手改掉它们。这是「引擎插件化」的第五片、也是
> **最后一片**（前四片是 `Server/Knowledge/`、`Server/Brain/`、`Server/TestCheck/`、
> `Server/Orchestrator/`；形状照抄它们）。做完之后 6 个引擎全部在 `plugins/` 下。

## 职责（迁移前后不变）

LoopEngine 是 Loop Engineering 模式的顶层协调器，负责驱动完整的闭环：

```
Brain（拆解/重规划） → Orchestrator（编排执行） → TestCheck（准出审核）
    ▲                                                        │
    └────────────── 审核未通过 → 重新生成目标 ────────────────┘
```

**循环终止条件**：准出通过 **OR** 达到最大循环次数（默认 3 次）。

---

## 架构位置

```
┌─────────────────────────────────────────────────────────────┐
│                      LoopEngine                             │
│                                                             │
│   ┌─────────┐    ┌──────────────┐    ┌──────────┐         │
│   │  Brain  │───→│ Orchestrator │───→│ TestCheck│         │
│   │ 拆解/重规│    │   编排执行    │    │ 准出审核  │         │
│   └────▲────┘    └──────────────┘    └────┬─────┘         │
│        │                                  │                │
│        └────────── 未通过 ────────────────┘                │
│                                                             │
│   循环终止：准出通过 OR maxLoops                            │
└─────────────────────────────────────────────────────────────┘
```

LoopEngine 是唯一感知"大循环"概念的模块。Brain、Orchestrator、TestCheck 各自独立工作，
LoopEngine 负责编排它们的调用顺序和循环逻辑。

---

## 模块结构

```
plugins/engines/loopengine/           # ← 实现实体 + 插件入口
├── plugin.json                       # 清单：name=engines/loopengine, seam=engine-loop, dependencies=[]
├── index.js                          # definePlugin 入口：ctx.provide('engine-loop', LoopEngine)
├── LoopEngine.js                     # 大循环核心类，原样迁入（仅 import / 接线 / 常量读取变了）
└── lib/                              # 解析器（插件不得引用 Server/，也不得跨插件 import）
    ├── storageSource.js              # createStorage 解析：宿主 storage 接缝 → 门面登记兜底 → fail closed（**同步**）
    ├── cliSource.js                  # CLI 协作方解析：门面登记的 CLIController → 宿主 ai-cli 接缝 → fail closed
    └── testcheckSource.js            # engine-testcheck 的提供方**类**解析 + 契约 constants 校验（fail closed）

Server/LoopEngine/                    # ← 门面层：路径与导出面与迁移前逐名一致
├── index.js                          # 纯转发 LoopEngine / LoopStatus / ABORTED_ERROR / default
├── LoopEngine.js                     # 转发同四项 + **登记 engine-testcheck / create-storage / cli-controller 三条兜底**
└── AGENTS.md                         # 本文档
```

契约：`seams/engine-loop.js`（`factory: false` + 7 项 `methods` + `properties: []` +
`constants: []` + `invariants` / `notes`）。
profile：`profiles/{default,mock-llm}.json` 各一条
`"engines/loopengine": { "enabled": true, "options": {} }`。
`dependencies` 保持空数组：setup 不 inject 任何服务，三条协作方都在**首次使用时**解析，
不需要拓扑顺序保证（`topoSort` 对"声明了依赖但依赖未启用"是硬报错）。

### 门面不改对象身份

门面文件都是 `export … from` 转发，**不是重新实现**：

```js
import { LoopEngine, LoopStatus, ABORTED_ERROR, default as L2 } from './LoopEngine/index.js';
L2 === LoopEngine;                                                              // true
// 且与插件里的类/常量对象 ===
(await import('../../plugins/engines/loopengine/LoopEngine.js')).LoopEngine === LoopEngine;   // true
```

对象身份必须保持，否则 `LoopStatus` 与 `CheckStatus` 的常量会比较分属两个对象，
`checkResult.status === CheckStatus.ERROR`（F-22 的核心判据）会全部静默失效。

---

## 三条解析链（本次迁移唯一需要"接线"的地方）

迁移前 `LoopEngine.js` 有 **4 条静态 import + 2 处运行时自建**。静态 import 在插件里非法
（R2 禁止插件引用 `Server/`），运行时自建会"无宿主时炸在深处"，因此各换成解析链：

| 协作方 | 解析顺序（高 → 低） | 登记点 | fail closed 文案点名 |
|--------|---------------------|--------|----------------------|
| `storage` | ① `new LoopEngine({ storage })` → ② 宿主 `storage` 接缝 → ③ 门面登记的**同步** `() => createStorage` → ④ 抛错 | `Server/LoopEngine/LoopEngine.js` | `'storage' 接缝` / `Server/LoopEngine/index.js` / `new LoopEngine({ storage })` |
| `engine-testcheck`（类） | ① `new LoopEngine({ testCheckClass })` → ② 宿主 `engine-testcheck` 接缝 → ③ 门面登记的 `() => TestCheck`（**插件入口**的绑定）→ ④ 抛错 | 同上 | `'engine-testcheck' 接缝` / `Server/LoopEngine/index.js` / `new LoopEngine({ testCheckClass })` |
| `cli` | ① 门面登记的惰性 `CLIController` → ② 宿主 `ai-cli` 接缝（`resolveAiCliFactory(type)`）→ ③ 抛错 | 同上 | `'ai-cli' 接缝` / `Server/LoopEngine/index.js` / 改调用点显式传入 CLI 协作方 |

四个要点：

- **`Brain` / `BrainStatus` 那条 import 直接删了**：迁移前的
  `import { Brain, BrainStatus } from '../Brain/index.js'` 是**死 import**（全文件除该行外
  对两个符号零引用），插件里没有任何 resolver 读它，因此门面也**没有**登记 `engine-brain`
  兜底——凭空登记一条没人读的兜底是死代码。
- **`storage` 的解析是同步的**（与 brain / testcheck 的 async 不同）：迁移前
  `createStorage()` 就在**构造函数里同步执行**，而 `Server/Routes/controllers/LoopEngineController.js`
  的 `_getStorage()` 兜底路径在构造后**同步**读 `engine.storage`（`tmp.storage`）——那条路径
  不在本次迁移边界内。所以 `storage` 变成**惰性同步 getter**：构造期不解析、不抛（m9 会用
  `new LoopEngine({...})` 真构造一次），首次读取才 fail closed；门面登记的加载器必须同步。
- **`engine-testcheck` 的兜底取的是插件入口的绑定**（`plugins/engines/testcheck/index.js`）：
  契约 `constants: ['CheckStatus']` 声明的冻结常量表是**插件入口**挂到类上的（见下），
  实现文件 `TestCheck.js` 单独被 import 时没有那次赋值。两者是**同一个类对象**（`===`）。
  另有一条副作用 import 指向 `../TestCheck/index.js`，保留迁移前的模块图（让 testcheck
  自己的四条无宿主兜底也就位）。
- **`cli` 排在接缝之前**（照抄 Brain 的裁决）：`ai-cli` 接缝提供方是**适配器工厂**，而本
  引擎的既有协作方是 `CLIController` **门面**——门面独有的 type 闭集校验与 `startSession`
  的 `stats` 旁路计数适配器都不做。`CLIController` 自己再走 `resolveAiCliFactory(type)`，
  所以**有宿主时第 1 档照样用宿主接缝**，只是外面套了门面。

---

## 状态常量表跨插件交付（本片核心，`constants` 通道）

`CheckStatus` / `BrainStatus` 是**模块级 `Object.freeze` 常量表**，不是实例能力面
（写进接缝的 `methods`/`properties` 会变成"实例上必须有这个成员"的假声明）。
它们走**类静态属性**通道，三档一起改：

1. **提供方挂静态属性**（只加赋值，同一对象、不克隆）：
   - `plugins/engines/brain/index.js`：`Brain.BrainStatus = BrainStatus;`
   - `plugins/engines/testcheck/index.js`：`TestCheck.CheckStatus = CheckStatus;`
2. **契约加 `constants` 字段**：`seams/engine-brain.js` 写 `constants: ['BrainStatus']`，
   `seams/engine-testcheck.js` 写 `constants: ['CheckStatus']`，语义是「提供方注册的**类**上
   必须有这些**冻结常量表**属性，供消费者在不 import 提供方模块的前提下读取状态字面量」。
   本引擎自己的契约是 `constants: []`（它只**消费**别人的表）。
3. **消费者校验后使用**：`plugins/engines/loopengine/lib/testcheckSource.js` 的
   `requireFrozenConstants()` 逐条校验「存在 + 是对象 + `Object.isFrozen`」，缺一档即
   fail closed 并点名，**绝不退回字符串字面量**（退回字面量会让"两张对象不同一"这类真实
   故障静默通过——那正是 F-22 失效的样子）。三处在
   `plugins/engines/loopengine/LoopEngine.js`：两处
   `checkResult.status === this._checkStatus.ERROR`（F-22 重试判定 / `round.checkErrored`）
   与一处 `r.checkStatus || this._checkStatus.IDLE`（恢复旧版 `loop.json`）。
4. **`m9` 增加常量校验**：`test/m9-contract-conformance` 对每个声明了 `constants` 的提供方
   断言同一组条件（存在 / 是对象 / `Object.isFrozen`），缺失即红并点名；负向用临时
   `delete` 证明过它真的会红。

---

## 核心 API

### `LoopEngine`

#### `startLoop(params) → Promise<LoopResult>`

启动大循环。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskDescription` | string | ✅ | 自然语言任务描述 |
| `taskId` | string | ❌ | 指定 taskId（默认自动生成） |
| `taskDir` | string | ❌ | 指定工作目录 |
| `skillDirectory` | string | ❌ | 覆盖 SKILL 目录 |
| `acceptanceCriteria` | string | ❌ | 用户提供的验收标准 |
| `maxLoops` | number | ❌ | 最大循环次数（默认 3） |

**返回**：`LoopResult`

```typescript
interface LoopResult {
    taskId: string;
    status: LoopStatus;       // idle | planning | executing | checking | aborting | passed | failed | aborted | interrupted | error
    passed: boolean;          // 是否准出通过
    totalRounds: number;      // 实际执行轮数
    currentLoop: number;      // 当前轮次
    maxLoops: number;
    startTime: string;
    endTime: string;
    error: string | null;
    rounds: RoundResult[];
    finalCheckResult: CheckResult | null;
}
```

#### `abortLoop(taskId) → Promise<boolean>`

终止大循环（同步受理、异步生效）。

#### `getProgress(taskId) → object | null`

获取循环进度。

#### `restoreLoop(taskId) → Promise<LoopContext | null>`

从持久化文件恢复大循环状态。

#### `getLoop(taskId)` / `getLoops()` / `isAborted(taskId)`

内存上下文快照与终止标志查询（各阶段轮询检查点用后者）。

---

## 循环状态（LoopStatus）

| 状态 | 说明 |
|------|------|
| `IDLE` | 未启动 |
| `PLANNING` | Brain 拆解/重规划中 |
| `EXECUTING` | Orchestrator 执行中 |
| `CHECKING` | TestCheck 准出审核中 |
| `ABORTING` | 终止已请求，等待各阶段轮询退出（过渡态） |
| `PASSED` | 准出通过，循环结束 |
| `FAILED` | 达到最大循环次数仍未通过 |
| `ABORTED` | 被手动终止 |
| `INTERRUPTED` | 进程重启导致执行中断（F-24：恢复时把 planning/executing/checking 投影为终态） |
| `ERROR` | 循环过程出错 |

---

## 大循环流程详解

### 首轮（loop=0）

1. **Brain.planTask()** — 初始拆解任务，生成 plan + taskDef
2. **Orchestrator.loadTask() + start()** — 加载并执行编排
3. **TestCheck.runCheck()** — 准出审核
4. 通过 → 结束；未通过 → 进入下一轮

### 后续轮（loop>0）

1. **Brain.replanTask()** — 基于上轮审核失败建议重新生成目标
2. **Orchestrator.loadTask() + start()** — 重新加载并执行编排
3. **TestCheck.runCheck()** — 准出审核
4. 通过 → 结束；未通过 → 进入下一轮

### 关键设计决策

- **同一 taskId 下多次调用 Brain**：LoopEngine 在循环中复用 taskId，每轮 Brain 生成新的 plan 但 taskId 不变，确保产物归属于同一任务
- **单轮异常不中断大循环**：某轮执行异常会记录到 round.error，继续下一轮（除非主动 abort）
- **F-22：审核"没跑起来" ≠ 审核"判定不通过"**：`status=error` 先按
  `LOOP_CHECK_MAX_ATTEMPTS`（默认 2）重试审核本身；仍失败则终态 ERROR 并如实说明是审核
  环节故障，**不消耗轮次**、**不谎报"准出未通过"**，也不把没有失败清单的结论传给重规划。
- **F-23：计划振荡检测**：每轮给步骤图算指纹（归一空白 + 按 stepId 排序后 sha256 前 16 位），
  与历史轮次命中即终止剩余轮次并给出可操作原因（`LOOP_DETECT_OSCILLATION=0` 可关闭）。
- **Orchestrator 轮询等待**：Orchestrator.start() 是 fire-and-forget 模式，LoopEngine 通过轮询 `orch.status` 等待终态。
  **超时不是静默的**：120 分钟仍未到终态时 `_waitForOrchestrator` 会带 `timedOut: true` 返回，
  `_runOrchestrator` 随即抛错、本轮按失败处理——绝不把"还在跑的编排"当成已完成再去做准出审核。
  轮询采用"先判后睡"，已完成时不再多等一个 5s 周期。
- **F-24：恢复时的状态投影**：`planning/executing/checking` 是只有执行体能推进的状态，
  重启后一律投影为 `interrupted`；`aborting` 投影为 `aborted`；未知值归 `idle`。

---

## 持久化文件布局

```
db/task/{taskId}/
├── brain.json              ← Brain 拆解计划（每轮覆盖）
├── orchestration.json      ← Orchestrator 编排状态（每轮覆盖）
├── loop.json               ← LoopEngine 大循环状态（本模块写入）
├── testcheck_loop0.json    ← 第0轮审核结果
├── testcheck_loop1.json    ← 第1轮审核结果
├── stepid_1.json           ← 步骤1执行状态
├── stepid_2.json           ← 步骤2执行状态
└── ...
```

`loop.json` 结构：

```json
{
    "taskId": "task_xxx",
    "taskDescription": "...",
    "maxLoops": 3,
    "currentLoop": 2,
    "status": "passed",
    "startTime": "2026-07-27T15:12:08.774+08:00",
    "endTime": "2026-07-27T15:45:23.123+08:00",
    "rounds": [
        {
            "loop": 0,
            "passed": false,
            "planningPlanId": "plan_xxx",
            "orchestratorStatus": "completed",
            "checkPassed": false,
            "checkSummary": "2/5 标准未满足",
            "checkId": "check_xxx"
        },
        {
            "loop": 1,
            "passed": true,
            "planningPlanId": "plan_yyy",
            "orchestratorStatus": "completed",
            "checkPassed": true,
            "checkSummary": "全部标准满足",
            "checkId": "check_zzz"
        }
    ],
    "persistedAt": "2026-07-27T15:45:23.200+08:00"
}
```

---

## 依赖关系

### 输入依赖

| 依赖 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `brainController` | BrainController | ✅ | Brain 控制器实例 |
| `orchestratorController` | OrchestratorController | ✅ | Orchestrator 控制器实例 |
| `testCheck` | TestCheck | ❌ | 准出审核引擎实例（不传则按解析链取提供方类再 new） |
| `testCheckClass` | Function | ❌ | engine-testcheck 的提供方**类**（测试/嵌入用） |
| `storage` | Storage | ❌ | 存储门面（不传则按 `lib/storageSource.js` 的解析链**同步**惰性解析） |
| `sseHub` | SseHub | ❌ | SSE 推送 |
| `skillDirectory` | string | ❌ | SKILL 目录（默认 `<树根>/Server/Skills`，与迁移前同一个绝对路径） |

### 调用的内部方法

LoopEngine 需要访问 Controller 的内部方法：

- `brainController._getBrain()` → 获取 Brain 实例，调用 `planTask()` / `replanTask()` / `loadPlan()`
- `orchestratorController._getOrchestrator(taskId)` → 获取 Orchestrator 实例，调用 `abort()` / `getProgress()`
- `orchestratorController.load()` / `.start()` → 加载和启动编排

这些 `_` 前缀方法在 Controller 内部使用，LoopEngine 作为协调器有权访问。

---

## SSE 事件

| 事件 | 触发时机 |
|------|---------|
| `loop:start` | 大循环启动 |
| `loop:round:start` | 每轮开始 |
| `loop:planning` | Brain 阶段开始 |
| `loop:executing` | Orchestrator 阶段开始 |
| `loop:checking` | TestCheck 阶段开始 |
| `loop:round:end` | 每轮结束 |
| `loop:complete` | 大循环完成 |
| `loop:error` | 大循环异常 |
| `loop:aborting` | 终止请求已受理（`ABORTING` 过渡态） |
| `loop:aborted` | 大循环被终止 |

未注入 `sseHub` 时所有推送静默跳过，不影响循环结果。

---

## 验证

```bash
node test/m3/run-all.mjs                        # 8 套件 / 160 条断言（F-22/F-24 覆盖本引擎语义）
node test/m5-phase2/run-all.mjs                 # 3 套件 / 166 条断言
node test/m6-phase3/run-all.mjs                 # 4 套件 / 131 条断言
node test/m7-phase4/run-all.mjs                 # 3 套件 / 207 条断言
node test/m8-plugin-kernel/run-all.mjs          # 272 条（插件内核）
node test/m9-contract-conformance/run-all.mjs   # 210 条（新增 engine-loop 接缝 + constants 常量校验）
node scripts/arch-guard.mjs                     # R1/R2/R3（60 个插件文件 / 12 个插件）
node cli/scripts/verify-deps.mjs                # 依赖声明核对
npx --no-install biome lint --reporter=summary  # 0 error
```

---

## 收尾：引擎簇插件化完成后仍需收口的结构性问题

6 个引擎已全部在 `plugins/` 下，但下面这些仍是**未走接缝 / 仍留在 Server 侧**的地方：

1. **`Server/Agent/SkillSelector/`（5499 行 / 18 文件）仍未插件化**——`engine-testcheck` 与
   `engine-orchestrator` 只能靠"门面登记兜底"，没有 `agent-skill-selector` 接缝可走
   （一个没有提供方的契约是死契约，所以故意没立）。同理 `MultiAgentRunner`、`RoleLimiter`、
   `McpToolGuide` 都还只有兜底没有接缝。
2. **`buildApp` 仍未从接缝取引擎**：`Server/composition/buildApp.js` 直接
   `new Brain / new TestCheck / new Orchestrator / new LoopEngineController`。引擎类本身已经
   可经 `host.inject('engine-*')` 取到（同一对象），但装配层仍在用"门面 + profile 决定插件
   在不在"的隐式关系——真正解耦需要装配层改成从 `inject` 取类，并让 profile 缺插件时
   fail closed 而不是静默回落内置实现。
3. **本引擎与 `LoopEngineController` 仍 poke Controller 的私有方法**
   （`_getBrain()` / `_getOrchestrator()`）：那是"协调器有权访问"的历史约定，不是契约。
   收口方向是给 Controller 加显式访问器（或让引擎持有 `brain`/`orchestrator` 实例而非 Controller）。
4. **日志未走 `app-logger` 接缝**：`LoopEngine._log()` 仍直接 `console.info/warn/error`
   （Brain、TestCheck、Orchestrator 同源）——`app-logger` 接缝已存在（`plugins/util/logger`），
   但引擎簇的日志仍不经它，因此 CLI 模式与 HTTP 模式的日志落点/格式不统一。
5. **`nowCST` 已收口到内核**（不再有副本），但 `Server/library/**` 里仍有若干零依赖工具
   （`BoundedRegistry` / `AbortTree` / `SessionWaiter` / `AtomicJsonFile`）以"插件内副本 +
   字节守卫"的方式共存——那是**有意的**取舍（按状态作用域选守卫强度），不是待办遗漏。
