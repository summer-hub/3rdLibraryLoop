# 重规划上下文处理指南

> 重规划场景下如何处理上一轮失败信息，调整步骤设计与验收标准。重规划由 LoopEngine 触发：当 TestCheck 准出审核未通过时，进入下一轮循环，调用 `decomposeTaskWithContext`。

---

## 1. 重规划触发条件

```
LoopEngine 大循环:
  Round 0: Brain.planTask → Orchestrator → TestCheck
    ├─ passed=true  → PASSED, 结束
    └─ passed=false → currentLoop++ → Round 1
  Round 1: Brain.replanTask → Orchestrator → TestCheck
    ├─ passed=true  → PASSED, 结束
    └─ passed=false → currentLoop++ → Round 2
  ... 直到 currentLoop >= maxLoops (默认3) → FAILED
```

---

## 2. 重规划上下文字段

重规划时，调用方通过 contextSections 注入以下信息：

| 上下文段落 | 内容 | 来源 |
|------------|------|------|
| `## 重规划上下文` | "当前是第 N 轮重规划" | loopCount |
| `## 上一轮审核摘要` | 审核结果总结 | prevCheckSummary |
| `## 未满足的验收标准` | 失败标准列表（id + criterion + reason） | failedCriteria |
| `## 改进建议` | 上轮建议列表 | improvementSuggestions |
| `## 重拆解要求` | 固定指令 | 固定文本 |

### failedCriteria 结构

每条未满足标准包含：
```
- [ac1] 标准描述 → 原因: 失败原因/证据
```

---

## 3. 重拆解要求

1. **保持原始任务目标不变** — 不修改任务的核心意图
2. **针对未满足的标准，调整相关步骤** — 使步骤描述更明确，或新增验证步骤
3. **增加验证步骤** — 强化对失败点的验证
4. **考虑改进建议** — 新增必要的步骤
5. **保持依赖关系合理** — 步骤间依赖关系需逻辑自洽
6. **步骤 ID 重新编号** — 从 1 开始重新编号

---

## 4. 失败原因分析框架

分析失败原因时，区分以下类别：

### 4.1 步骤设计问题

| 原因 | 表现 | 调整 |
|------|------|------|
| 步骤过粗 | 一个步骤包含多个任务，部分未完成 | 拆分为多个步骤 |
| 步骤过细 | 步骤间耦合过紧，难以独立执行 | 合并相关步骤 |
| 步骤遗漏 | 某些必要操作未包含 | 新增步骤 |
| 依赖错误 | 步骤执行顺序不合理 | 调整 dependId/nextStepId |

### 4.2 验收标准问题

| 原因 | 表现 | 调整 |
|------|------|------|
| 标准模糊 | verification 不明确 | 重写为具体可执行验证 |
| 标准遗漏 | 关键维度未覆盖 | 补充新标准 |
| 标准过严 | 正常也达不到 | 调整阈值 |
| taskACIds 未覆盖 | 步骤级 AC 未覆盖所有任务级 AC | 补充关联 |

### 4.3 执行问题

| 原因 | 表现 | 调整 |
|------|------|------|
| SKILL 匹配失败 | 步骤描述无法匹配到执行 SKILL | 调整 taskDescription 措辞 |
| 环境问题 | 执行环境不具备 | 记录为约束条件 |
| 重试不足 | maxRetries 低于 3 | 统一为 3 |

---

## 5. 重规划调整策略示例

### 场景：上轮 ac2（编译验证）未通过

```
failureAnalysis:
  "上一轮 ac2 编译验证未通过：
   - 失败原因：编译步骤缺少依赖安装前置步骤
   - 根因：首轮步骤1直接编译，未安装鸿蒙 NDK"

adjustmentStrategy:
  "1. 新增步骤0：安装鸿蒙 NDK 和构建依赖
   2. 原步骤1 dependId 改为指向新步骤
   3. 编译步骤 maxRetries 统一为 3
   4. ac2_1 verification 补充具体编译命令"
```

### 调整后的步骤图

```
步骤1 (新增): 安装鸿蒙 NDK 和构建依赖 (dependId=0)
  → 成功 → 步骤2    → 失败 → 终止

步骤2 (原步骤1): 源码分析 (dependId=1)
  → 成功 → 步骤3    → 失败 → 终止

步骤3: 编译验证 (dependId=2, maxRetries=3)
  → 成功 → 步骤5    → 失败 → 步骤4

步骤4: 问题修复 (dependId=3)
  → 成功 → 步骤3(重试)  → 失败 → 步骤5

步骤5: 生成报告 (终止, nextStepId=0)
```

---

## 6. 保持目标一致的原则

| 可调整 | 不可调整 |
|--------|----------|
| 步骤数量与设计 | 任务的核心意图 |
| 步骤的 taskDescription | 任务的预期产出类型 |
| dependId/nextStepId/failStepId | — |
| maxRetries | — |
| 步骤级 acceptanceCriteria | — |
| 步骤 ID 重新编号 | — |

> 如果认为任务目标本身需要修改，说明任务描述有误，应在拆解结果中标注并建议用户重新提交任务。

---

## 7. 重规划结果文件

结果文件路径与首轮相同模式，按 loopCount 区分：
- 首轮：`brain_decomposition_loop0.json`
- 第1轮重规划：`brain_decomposition_loop1.json`
