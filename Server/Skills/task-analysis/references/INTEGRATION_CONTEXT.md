# 集成上下文说明

> task-analysis SKILL 在 AI Loop 系统中的完整调用链路与消费方式。理解本文件有助于编写更贴合实际执行的 SKILL 指令。

---

## 1. 调用链路

```
LoopEngine.startLoop()
  └─ _runBrain()
       ├─ 首轮 (loop=0):  Brain.planTask()
       │     └─ AnalysisStrategies.analyzeTask()
       │           ├─ _analyzeViaCLI()        ← 主路径（opencode CLI 执行本 SKILL）
       │           └─ _analyzeViaLLM()        ← 降级路径（直接 LLM 调用，不经过 SKILL）
       │
       └─ 后续轮 (loop>0): Brain.replanTask()
             └─ AnalysisStrategies.analyzeTaskWithContext()
                   ├─ _analyzeWithContextViaCLI()  ← 重规划路径（CLI 执行本 SKILL）
                   └─ _analyzeWithContextViaLLM()  ← 降级路径
```

---

## 2. SkillExecutor 调用机制

`SkillExecutor.invokeSkill(skillDir, workDir, resultFilePath, title, contextSections)` 的工作流程：

1. `cli.checkHealth()` — 检查 opencode 服务可用性
2. `fs.mkdirSync(workDir, {recursive:true})` — 确保工作目录存在
3. `buildSkillPrompt()` — 构建 prompt（SKILL 目录 + 工作目录 + 结果路径 + 上下文段落）
4. `cli.startSession(title, prompt)` — 创建 opencode Session
5. `pollSession()` — 每 5s 轮询，超时 30 分钟
6. `readSkillResult(resultFilePath)` — 读取 JSON 结果文件

opencode 收到 prompt 后会读取 SKILL.md 并按指令执行。

---

## 3. Prompt 注入的上下文段落

### 3.1 首轮分析

调用方（`_analyzeViaCLI`）注入：
- `## SKILL 目录` — `{skillDir}/task-analysis`
- `## 工作目录` — `{taskDir}`
- `## 结果文件输出路径` — `{taskDir}/brain_analysis_loop{N}.json`
- `## 任务描述` — `{taskDescription}`
- `## 用户提供的验收标准`（如有）或 `## 验收标准`（自动生成提示）

### 3.2 重规划分析

调用方（`_analyzeWithContextViaCLI`）在首轮基础上额外注入：
- `## 重规划上下文` — "当前是第 N 轮重规划"
- `## 上一轮审核摘要` — `prevCheckSummary`
- `## 上一轮编排状态` — `prevOrchStatus`
- `## 未满足的验收标准` — failedCriteria 列表（含 id/criterion/reason）
- `## 改进建议` — improvementSuggestions 列表
- `## 重分析要求` — 6 条固定指令

---

## 4. 结果消费链路

### 4.1 JSON 读取与容错

`SkillExecutor.readSkillResult(resultFilePath)`：
- 读取文件内容
- 用 `indexOf('{')` / `lastIndexOf('}')` 提取 JSON（容忍 markdown 包裹）
- `JSON.parse` 解析
- 返回 `{ success, json, raw }`

### 4.2 规范化

`AnalysisStrategies.normalizeAnalysis(json)` 对字段兜底：

| 字段 | 兜底值 |
|------|--------|
| `intent` | `''` |
| `domain` | `'general'` |
| `keywords` | `[]` |
| `constraints` | `[]` |
| `techStack` | `[]` |
| `complexity` | `'medium'` |
| `estimatedSteps` | `3` |
| `acceptanceCriteria[].id` | `ac{idx+1}` |
| `acceptanceCriteria[].type` | `'output'` |
| `acceptanceCriteria[].verification` | `''` |
| `failureAnalysis` | `''` |
| `adjustmentStrategy` | `''` |

> 空描述的 acceptanceCriteria 条目会被 `.filter(c => c.criterion)` 过滤。

### 4.3 下游消费 — DecompositionStrategies

`DecompositionStrategies` 将分析结果格式化后传给 `task-decomposition` SKILL：
- `acceptanceCriteria` → 格式化为 `[ac1] (type) criterion → 验证: verification` 列表
- `intent/domain/keywords/constraints/techStack/complexity/estimatedSteps` → 写入拆解 prompt

### 4.4 最终组装 — Brain

`Brain.planTask` / `replanTask` 将 `acceptanceCriteria` 写入 `taskDef`：
```js
taskDef = {
    taskId, taskDir, skillDirectory,
    acceptanceCriteria: analysis.acceptanceCriteria || [],
    loopCount: 0,
    steps: rawSteps.map(...)
};
```

重规划时额外记录：
```js
taskDef.replanInfo = {
    loopCount,
    previousCheckId,
    failedCriteriaCount,
    improvementSuggestions
};
```

### 4.5 准出审核 — TestCheck

`taskDef.acceptanceCriteria` 最终传给 `acceptance-check` SKILL / `TestCheck`，用于每轮执行后的准出审核。审核结果决定是否进入下一轮重规划。

---

## 5. 循环终止条件

| 条件 | 结果 |
|------|------|
| `checkResult.passed === true` | `LoopStatus.PASSED`，结束 |
| `currentLoop >= maxLoops`（默认 3） | `LoopStatus.FAILED` |
| `ctx.aborted` | `LoopStatus.ABORTED` |

---

## 6. 目录命名约定

- **物理目录名**：`task-analysis`（Brain 硬编码拼接 `path.join(skillDir, 'task-analysis')`）
- **frontmatter name**：`task-analysis`（SkillSelector 体系下的逻辑标识）
- 两者一致 — Brain 用物理目录名定位，frontmatter name 作为逻辑标识

> ⚠️ 重命名物理目录需要同步修改 Brain 中 `AnalysisStrategies.js` 的 `path.join(skillDir, 'task-analysis')`。

---

## 7. 结果文件命名

- 首轮：`brain_analysis_loop0.json`
- 第 1 轮重规划：`brain_analysis_loop1.json`
- 第 N 轮重规划：`brain_analysis_loop{N}.json`

文件路径由调用方通过 prompt 注入，SKILL 只需写入指定路径。

---

## 8. 持久化

`Brain.planTask` / `replanTask` 末尾调用 `PlanPersistence.persistPlan(plan)`：
- 完整 `analysis` 对象写入 `brain.json` 快照
- `loadPlanHistory(taskId)` 可按轮次加载历史分析结果
