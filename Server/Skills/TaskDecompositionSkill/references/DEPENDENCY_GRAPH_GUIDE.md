# 依赖图设计指南

> 如何设计高质量的步骤依赖图。依赖图是 TaskDecompositionSkill 的核心产出，直接决定 Orchestrator 的调度行为。

---

## 1. 图字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| `dependId` | number | 当前步骤依赖哪个步骤（0 = 入口步骤，无前置依赖；-1 = 修复步骤哨兵，仅由 failStepId 触发） |
| `nextStepId` | number | 成功后执行哪个步骤（0 = 终止，任务完成） |
| `failStepId` | number | 失败后跳转到哪个步骤（0 = 失败即终止） |
| `maxRetries` | number | 单个步骤的最大重试次数（默认 3） |

---

## 2. 基本图结构

### 2.1 线性流程

```
步骤1 (入口, dependId=0)
  → 成功 → 步骤2 (dependId=1)
  → 失败 → 终止 (failStepId=0)

步骤2
  → 成功 → 步骤3 (dependId=2)
  → 失败 → 终止

步骤3 (终止, nextStepId=0)
```

### 2.2 带失败回退的流程

```
步骤1 (入口)
  ├─ 成功 → 步骤2
  └─ 失败 → 步骤3 (回退/修复, dependId=-1)

步骤2
  ├─ 成功 → 步骤4 (终止)
  └─ 失败 → 步骤3

步骤3 (修复步骤, dependId=-1)
  ├─ 成功 → 步骤2 (重试)
  └─ 失败 → 步骤4 (终止)

步骤4 (终止, nextStepId=0)
```

> ⚠️ **修复步骤 `dependId` 必须设为 `-1`（强制约定）**：被某步骤 `failStepId` 指向的修复步骤（如上例步骤 3），其 `dependId` **必须设为 `-1`**——表示"仅由 failStepId 触发、无入口身份、无并行依赖"。**不能设为 0 或空**：0 或空会被 Orchestrator 与校验脚本误判为"入口步骤"，导致修复步骤与任务真实入口一步骤并行启动、提前误执行。修复成功后通过 `nextStepId` 指回触发它的步骤（如上例 `步骤3.nextStepId=2`），配合 `maxRetries` 形成有限重试循环。
>
> `dependId=-1` 语义上等价于"无成功依赖"，但显式标记了修复身份，区别于普通入口步骤的 `dependId=0`。Brain 生成侧 `sanitizeFixChainDependId` 会自动将修复步骤的 dependId 规范化为 `-1`，LLM 原始输出无需手工设置此字段。

### 2.3 并行执行流程

```
步骤1 (入口)
  ├─ 成功 → 步骤2 和 步骤3 同时执行
  └─ 失败 → 终止

步骤2 (dependId=1) ──┐
                      ├─ 都成功 → 步骤4 (终止)
步骤3 (dependId=1) ──┘

步骤4 (终止, nextStepId=0)
```

> 并行条件：多个步骤的 `dependId` 指向同一个步骤，Orchestrator 会在前置步骤成功后并行执行。

---

## 3. 常见任务拆解模板

> 常见任务拆解模板已拆分至 [常见任务拆解模板](TASK_DECOMPOSITION_TEMPLATES.md)

---

## 4. maxRetries 设置指南

所有步骤统一使用 `maxRetries = 3`，保证执行稳定性与重试兜底的一致性。

---

## 5. 图结构校验规则

拆解完成后，Brain 会对结果进行以下校验：

| # | 校验项 | 规则 |
|---|--------|------|
| 1 | stepId 唯一性 | 不允许重复的步骤 ID |
| 2 | 入口步骤存在 | 至少有一个 `dependId=0` 的步骤（`dependId=-1` 的修复步骤不计入入口） |
| 3 | 终止步骤存在 | 至少有一个 `nextStepId=0` 的步骤 |
| 4 | 引用有效性 | `dependId`/`nextStepId`/`failStepId` 引用的 stepId 必须存在（0 与 -1 除外，-1 为修复步骤哨兵） |
| 5 | 描述非空 | 每个步骤的 `taskDescription` 不能为空字符串 |

### 死锁校验规则（`validate-step-graph.cjs`，强制）

除上述字段级校验外，拆解输出**必须**通过 `node scripts/validate-step-graph.cjs <resultFile>` 的死锁校验，检测项：

| # | 校验项 | 规则 | 反例 |
|---|--------|------|------|
| 1 | 成功链环（nextStepId） | `nextStepId` 边不能成环 | `step4→step5→step4` |
| 2 | 失败链环（failStepId） | `failStepId` 边不能成环；自身回退 `failStepId==自己` 配合 `maxRetries` 合法 | `A 失败→B`、`B 失败→A` |
| 3 | 依赖环（dependId） | `dependId` 边不能成环 | `A 依赖 B`、`B 依赖 A` |
| 4 | 可达性 | 所有步骤必须从入口沿 `nextStepId` 链可达 | 孤立步骤（无任何 nextStepId 指向它） |
| 5 | 成功链终止 | 至少一个步骤 `nextStepId=0` | 所有 nextStepId 均非 0 |

任一项不通过则脚本非零退出，**必须修正步骤图后重新校验直至全部通过**。

---

## 6. 反模式

### 6.1 死循环

**失败链死循环：**
```
步骤1 → 失败 → 步骤2
步骤2 → 失败 → 步骤1   ← 无限循环！
```

**成功链死循环（toggle 死锁）：**
```
步骤4 → 成功 → 步骤5
步骤5 → 成功 → 步骤4   ← 成功后永远无法结束，死锁！
```

**修复**：确保 failStepId / nextStepId 链最终能到达终止步骤，配合 maxRetries 限制。

> **强制校验**：以上死锁由 `node scripts/validate-step-graph.cjs <resultFile>` 强制检测，检测到环/孤立步骤/无终止时脚本非零退出，必须修正后重新校验直至通过。

### 6.2 孤立步骤

```
步骤1 → 成功 → 步骤3
步骤2 (dependId=0, 但没有任何步骤指向它)  ← 永远不会被执行
```

**修复**：确保每个步骤要么是入口，要么被某个步骤的 nextStepId/failStepId 引用。

### 6.3 步骤过细

```
步骤1: git clone
步骤2: cd 进入目录
步骤3: ls 查看文件
步骤4: cat README
```

**修复**：合并为一个"获取源码并分析结构"步骤。
