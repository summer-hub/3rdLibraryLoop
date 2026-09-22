# LoopEngine — 大循环协调引擎

## 概述

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

LoopEngine 是唯一感知"大循环"概念的模块。Brain、Orchestrator、TestCheck 各自独立工作，LoopEngine 负责编排它们的调用顺序和循环逻辑。

---

## 模块结构

```
Server/LoopEngine/
├── LoopEngine.js    ← 核心实现
├── index.js         ← 模块入口
└── AGENTS.md        ← 本文档
```

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

终止大循环。

#### `getProgress(taskId) → object | null`

获取循环进度。

#### `restoreLoop(taskId) → Promise<LoopContext | null>`

从持久化文件恢复大循环状态。

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
- **Orchestrator 轮询等待**：Orchestrator.start() 是 fire-and-forget 模式，LoopEngine 通过轮询 `orch.status` 等待终态。
  **超时不是静默的**：120 分钟仍未到终态时 `_waitForOrchestrator` 会带 `timedOut: true` 返回，
  `_runOrchestrator` 随即抛错、本轮按失败处理——绝不把"还在跑的编排"当成已完成再去做准出审核。
  轮询采用"先判后睡"，已完成时不再多等一个 5s 周期。

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
| `testCheck` | TestCheck | ❌ | 准出审核引擎（默认自动创建） |
| `storage` | Storage | ❌ | 存储门面（默认自动创建） |
| `sseHub` | SseHub | ❌ | SSE 推送 |

### 调用的内部方法

LoopEngine 需要访问 Controller 的内部方法：

- `brainController._getBrain()` → 获取 Brain 实例，调用 `planTask()` / `replanTask()`
- `orchestratorController._getOrchestrator(taskId)` → 获取 Orchestrator 实例，调用 `abort()`
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
