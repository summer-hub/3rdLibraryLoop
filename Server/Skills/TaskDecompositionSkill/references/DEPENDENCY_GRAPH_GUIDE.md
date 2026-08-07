# 依赖图设计指南

> 如何设计高质量的步骤依赖图。依赖图是 TaskDecompositionSkill 的核心产出，直接决定 Orchestrator 的调度行为。

---

## 1. 图字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| `dependId` | number | 当前步骤依赖哪个步骤（0 = 入口步骤，无前置依赖） |
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
  └─ 失败 → 步骤3 (回退/修复)

步骤2
  ├─ 成功 → 步骤4 (终止)
  └─ 失败 → 步骤3

步骤3 (修复步骤)
  ├─ 成功 → 步骤2 (重试)
  └─ 失败 → 步骤4 (终止)

步骤4 (终止, nextStepId=0)
```

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

### 模板 1：库移植分析

```
步骤1: 源码分析（CPPAnalysisSkill / FlutterCodeCheck）
  → 成功: 步骤2    → 失败: 终止(failStepId=0)

步骤2: 接口分析（HarmonyLibraryInterface / LibraryInterface）
  → 成功: 步骤3    → 失败: 步骤4

步骤3: 编译验证（CPPCompileSkill）
  → 成功: 步骤5(终止)  → 失败: 步骤4

步骤4: 问题修复（CPPPortingSkill）
  → 成功: 步骤3(重试编译)  → 失败: 步骤5(终止)

步骤5: 生成报告（终止, nextStepId=0）
```

### 模板 2：代码质量检查

```
步骤1: 代码质量检查（XxxLibraryCodeQualityCheckSkill）
  → 成功: 步骤2    → 失败: 步骤3

步骤2: 文档质量检查（XxxLibraryDocumentationQualityCheckSkill）
  → 成功: 步骤4(终止)  → 失败: 步骤3

步骤3: 问题修复（LibraryDocFixSkill）
  → 成功: 步骤1(重试)  → 失败: 步骤4(终止)

步骤4: 终止(nextStepId=0)
```

### 模板 3：PR 代码检视

```
步骤1: 获取 PR 信息并克隆仓库
  → 成功: 步骤2    → 失败: 终止

步骤2: 分析变更文件
  → 成功: 步骤3    → 失败: 终止

步骤3: 生成检视报告
  → 成功: 终止(nextStepId=0)  → 失败: 终止(failStepId=0)
```

### 模板 4：并行检查

```
步骤1: 准备环境
  → 成功: 步骤2 + 步骤3 (并行)  → 失败: 终止

步骤2: 代码质量检查 (dependId=1)
  → 成功: 步骤4  → 失败: 步骤5

步骤3: 安全扫描 (dependId=1)
  → 成功: 步骤4  → 失败: 步骤5

步骤4: 汇总报告 (dependId=2,3)
  → 成功: 终止  → 失败: 终止

步骤5: 修复 (dependId=2 或 3)
  → 成功: 步骤2 或 步骤3 (重试)  → 失败: 步骤4(终止)
```

---

## 4. maxRetries 设置指南

所有步骤统一使用 `maxRetries = 3`，保证执行稳定性与重试兜底的一致性。

---

## 5. 图结构校验规则

拆解完成后，Brain 会对结果进行以下校验：

| # | 校验项 | 规则 |
|---|--------|------|
| 1 | stepId 唯一性 | 不允许重复的步骤 ID |
| 2 | 入口步骤存在 | 至少有一个 `dependId=0` 的步骤 |
| 3 | 终止步骤存在 | 至少有一个 `nextStepId=0` 的步骤 |
| 4 | 引用有效性 | `dependId`/`nextStepId`/`failStepId` 引用的 stepId 必须存在（0 除外） |
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
