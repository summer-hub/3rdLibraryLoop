# 集成上下文说明

> task-decomposition SKILL 在 AI Loop 系统中的完整调用链路与消费方式。理解本文件有助于编写更贴合实际执行的 SKILL 指令。

---

## 1. 调用链路

```
LoopEngine.startLoop()
  └─ _runBrain()
       ├─ 首轮 (loop=0):  Brain.planTask()
       │     ├─ AnalysisStrategies.analyzeTask()          ← 上游：task-analysis
       │     └─ DecompositionStrategies.decomposeTask()   ← 本 SKILL
       │           ├─ _decomposeViaCLI()                   ← 主路径（opencode CLI 执行本 SKILL）
       │           └─ _decomposeViaLLM()                   ← 降级路径（直接 LLM 调用，读 SKILL.md 作为指令）
       │
       └─ 后续轮 (loop>0): Brain.replanTask()
             └─ DecompositionStrategies.decomposeTaskWithContext()
                   ├─ _decomposeWithContextViaCLI()        ← 重规划路径（CLI 执行本 SKILL）
                   └── _decomposeWithContextViaLLM()       ← 降级路径
```

---

## 2. SkillExecutor 调用机制

`SkillExecutor.invokeSkill(skillDir, workDir, resultFilePath, title, contextSections)` 的工作流程：

1. `cli.checkHealth()` — 检查 opencode 服务可用性
2. `fs.mkdirSync(workDir, {recursive:true})` — 确保工作目录存在（关键：opencode `realPath` 会静默失败）
3. `buildSkillPrompt()` — 构建 prompt（SKILL 目录 + 工作目录 + 结果路径 + 上下文段落）
4. `cli.startSession(title, prompt)` — 创建 opencode Session
5. `pollSession()` — 每 5s 轮询，超时 30 分钟
6. `readSkillResult(resultFilePath)` — 读取 JSON 结果文件

opencode 收到 prompt 后会读取 SKILL.md 并按指令执行。

---

## 3. Prompt 注入的上下文段落

### 3.1 首轮拆解

调用方（`_decomposeViaCLI`）注入：
- `## SKILL 目录` — `{skillDir}/task-decomposition`
- `## 工作目录` — `{taskDir}`
- `## 结果文件输出路径` — `{taskDir}/brain_decomposition_loop{N}.json`
- `## 任务描述` — `{taskDescription}`
- `## 任务分析结果` — task-analysis SKILL 输出（格式化的 intent/domain/keywords/constraints/techStack/complexity/estimatedSteps）
- `## 验收标准` — 任务级验收标准列表（`[ac1] (type) criterion → 验证: verification`）

> 可用执行 SKILL 列表**不注入**：由本 SKILL 的 `scripts/list-available-skills.cjs` 在拆解时实时扫描获取（黑名单过滤），系统侧（Brain）不硬编码任何 SKILL 清单。

### 3.2 重规划拆解

调用方（`_decomposeWithContextViaCLI`）在首轮基础上额外注入：
- `## 重规划上下文` — "当前是第 N 轮重规划"
- `## 上一轮审核摘要` — `prevCheckSummary`
- `## 未满足的验收标准` — failedCriteria 列表（含 id/criterion/reason）
- `## 改进建议` — improvementSuggestions 列表
- `## 重拆解要求` — 固定指令

---

## 4. 结果消费链路

### 4.1 JSON 读取与容错

`SkillExecutor.readSkillResult(resultFilePath)`：
- 读取文件内容
- 用 `indexOf('{')` / `lastIndexOf('}')` 提取 JSON（容忍 markdown 包裹）
- `JSON.parse` 解析
- 返回 `{ success, json, raw }`

> 即使被 markdown 代码块包裹也能解析，但 SKILL 应输出纯 JSON，不依赖容错。

### 4.2 规范化

`DecompositionStrategies.normalizeSteps(rawSteps)` 对字段兜底：

| 字段 | 兜底值 |
|------|--------|
| `stepId` | 保持原值 |
| `taskDescription` | `''` |
| `dependId` | `0` |
| `nextStepId` | `0` |
| `failStepId` | `0` |
| `maxRetries` | `3` |
| `acceptanceCriteria` | `[]` |

### 4.3 下游消费 — Brain

`Brain.planTask` / `replanTask` 将步骤组装为 `taskDef`：

```js
taskDef = {
    taskId, taskDir, skillDirectory,
    acceptanceCriteria: analysis.acceptanceCriteria || [],  // 任务级 AC
    loopCount: 0,
    steps: rawSteps.map(s => ({
        stepId: s.stepId,
        taskDescription: s.taskDescription,
        specifiedSkill: s.specifiedSkill || '',             // 步骤绑定的执行 SKILL（可选）
        dependId: s.dependId ?? 0,
        nextStepId: s.nextStepId ?? 0,
        failStepId: s.failStepId ?? 0,
        maxRetries: s.maxRetries ?? 3,
        acceptanceCriteria: s.acceptanceCriteria || []
    }))
};
```

> `specifiedSkill` 由拆解时匹配可用 SKILL 列表产生（Phase 1.5 实时扫描 + Phase 2.4 绑定规则），经 `normalizeSteps` 透传（非字符串归一为空串），空串表示未绑定、由 SkillSelector 运行时自动匹配。

重规划时额外记录：
```js
taskDef.replanInfo = {
    loopCount,
    previousCheckId,
    failedCriteriaCount,
    improvementSuggestions
};
```

### 4.4 下游消费 — Orchestrator

`Orchestrator.loadTask(taskDef)` 构建 `StepNode` 图：

- **只消费图字段**：`stepId`、`taskDescription`、`dependId`、`nextStepId`、`failStepId`、`maxRetries`、`specifiedSkill`（透传给 FlexRunner）
- **不消费 `acceptanceCriteria`**：StepNode 构造函数未声明 acceptanceCriteria 实例属性，通过 `...stepDef` 展开后被丢弃
- **调度逻辑**：
  - 入口步骤 = `dependId === '0'` 或 dependId 指向不存在节点
  - 流水线调度 = 首轮启动全部 READY 节点，之后 `Promise.race` 感知任意完成并级联启动后继
    （节点完成即刻启动依赖它的下一步，不等整批结束；总耗时趋近 DAG 关键路径）
  - 成功 → 激活 `nextStepId`；失败（未达 `maxRetries`）→ 激活 `failStepId`（修复链）
  - 环检测 = 加载期静态检测（`_detectCycles()`，对 nextStepId ∪ failStepId ∪ dependId 求强连通分量）；
    环**不报错**（failStepId 修复链天然成环），仅 warn 并通过 `getProgress().cycles` 暴露
    —— 注意：`dependId` 的边方向是「被依赖者 → 依赖者」，写反会造出假环
  - 重复执行控制 = `_activateNextStep()` 守卫：已 COMPLETED 的节点不会被 `nextStepId`
    再次激活；允许重复的只有 failStepId 修复链与 FAILED 未耗尽 `maxRetries` 的节点
    （旧文档把这条语义归因于 `_execPathTrace`，但该字段是死代码）
  - 全局上限 = `GLOBAL_EXEC_LIMIT = 200`（运行时兜底）

`specifiedSkill` 的执行链路：StepNode → `Orchestrator._createFlexRunner` → `FlexRunner.initContext({ specifiedSkill })` → `executeStart` 中 `_resolveSpecifiedSkill` 直接解析该 SKILL（目录名精确匹配优先，其次 frontmatter name 匹配），跳过 SkillSelector 自动匹配；解析失败降级为无 SKILL 模式。

### 4.5 下游消费 — TestCheck / acceptance-check

```
LoopEngine._runTestCheck()
  └─ TestCheck.runCheck({ acceptanceCriteria: 任务级AC, orchestratorResult, ... })
       └─ SkillSelector 匹配 acceptance-check
            └─ 读取 stepId{N}_result_{loop}.md 产物（FlexRunner 写入）
            └─ 按 stepId 分组形成产物清单
            └─ LLM 评估每条任务级 AC → criteriaResults[{id, satisfied, evidence}]
```

**步骤级 AC 的实际消费路径**：
- 步骤级 `acceptanceCriteria` 不被 Orchestrator 程序化读取
- 步骤执行时 FlexRunner 生成 `stepId{N}_result_{loop}.md` 产物文件
- acceptance-check SKILL 收集这些产物后，参考步骤级 AC 做准出评估
- `taskACIds` 追溯字段目前仅作为 SKILL 指令中的文档性约束，无代码程序化读取

---

## 5. 两层验收标准体系

| 层级 | 来源 | ID 格式 | 消费者 |
|------|------|---------|--------|
| **任务级** `acceptanceCriteria[]` | task-analysis SKILL 输出 → Brain 写入 taskDef | `ac1, ac2...` | TestCheck（准出审核） |
| **步骤级** `acceptanceCriteria[]` | task-decomposition SKILL 每步生成 | `ac{stepId}_{n}` 如 `ac1_1` | acceptance-check（产物收集时按 stepId 分组） |

设计意图：合并所有步骤 AC 的 `taskACIds` 后应覆盖所有任务级 AC ID。

---

## 6. 结果文件命名

- 首轮：`brain_decomposition_loop0.json`
- 第1轮重规划：`brain_decomposition_loop1.json`
- 第N轮：`brain_decomposition_loop{N}.json`
