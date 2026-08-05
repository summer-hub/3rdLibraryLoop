# 重规划上下文处理指南

> 重规划场景下如何处理上一轮失败信息，调整验收标准与策略。重规划由 LoopEngine 触发：当 TestCheck 准出审核未通过时，进入下一轮循环，调用 `analyzeTaskWithContext`。

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
| `## 上一轮编排状态` | Orchestrator 执行状态 | prevOrchStatus |
| `## 未满足的验收标准` | 失败标准列表（id + criterion + reason） | failedCriteria |
| `## 改进建议` | 上轮建议列表 | improvementSuggestions |
| `## 重分析要求` | 6 条指令 | 固定文本 |

### failedCriteria 结构

每条未满足标准包含：
```
- [ac1] 标准描述 → 原因: 失败原因/证据
```

---

## 3. 重分析要求（6 条指令）

1. **保持原始任务目标不变** — 不修改 intent
2. **针对未满足的标准，分析失败原因** — 写入 failureAnalysis
3. **调整验收标准的验证方式，使其更明确** — 改进 verification
4. **如有必要，补充新的验收标准** — 覆盖遗漏维度
5. **考虑改进建议中的方向** — 融入 adjustmentStrategy
6. **生成 failureAnalysis 和 adjustmentStrategy 字段** — 必填

---

## 4. 失败原因分析框架

分析失败原因时，区分以下类别：

### 4.1 标准问题（标准本身不合理）

| 原因 | 表现 | 调整 |
|------|------|------|
| 标准过严 | 阈值过高，正常也达不到 | 降低阈值 |
| 标准模糊 | verification 不明确 | 重写为具体可执行验证 |
| 标准遗漏 | 关键维度未覆盖 | 补充新标准 |
| 标准重叠 | 多条标准检查同一件事 | 合并 |

### 4.2 执行问题（标准合理但执行未达标）

| 原因 | 表现 | 调整 |
|------|------|------|
| 步骤遗漏 | 某些必要步骤未执行 | 调整 estimatedSteps，提示拆解 |
| 技术栈不匹配 | 步骤用了错误工具 | 调整 techStack/keywords |
| 环境问题 | 执行环境不具备 | 记录为约束条件 |

### 4.3 分析框架

```
failureAnalysis:
  "上一轮共 N 条标准未通过：
   - ac2 失败原因：验证方式不明确，未指定具体检查命令 → 标准问题
   - ac3 失败原因：扫描未覆盖 utils/ 目录 → 执行问题（步骤遗漏）
   根因：首轮 estimatedSteps=3 过低，未包含 utils 目录扫描步骤"
```

---

## 5. 调整策略编写

`adjustmentStrategy` 应说明具体的调整动作：

```
adjustmentStrategy:
  "1. ac2 重写 verification 为具体命令
   2. ac3 保持标准不变，将 estimatedSteps 从 3 调整为 5
   3. 新增 ac6：覆盖 utils/ 目录扫描
   4. keywords 补充 'utils-scan'"
```

---

## 6. 保持目标一致的原则

| 可调整 | 不可调整 |
|--------|----------|
| acceptanceCriteria 的 verification | intent（任务意图） |
| acceptanceCriteria 的数量 | 任务的核心目标 |
| estimatedSteps | 任务的预期产出类型 |
| keywords（可补充） | — |
| constraints（可补充） | — |

> 如果认为任务目标本身需要修改，说明任务描述有误，应在 failureAnalysis 中标注并建议用户重新提交任务。

---

## 7. 重规划结果文件

结果文件路径与首轮相同模式，按 loopCount 区分：
- 首轮：`brain_analysis_loop0.json`
- 第1轮重规划：`brain_analysis_loop1.json`
- 第2轮重规划：`brain_analysis_loop2.json`

下游 Brain.replanTask 会读取后：
1. `normalizeAnalysis` 规范化
2. 传入 `DecompositionStrategies` 重新拆解步骤
3. `taskDef` 额外记录 `replanInfo`（loopCount、failedCriteriaCount、improvementSuggestions）
