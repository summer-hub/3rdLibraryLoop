# Brain —— 自然语言任务拆解引擎

## 职责

Brain 是 AI Loop 系统的"大脑"层，负责将自然语言任务描述拆解为 Orchestrator 可执行的结构化任务 JSON。

### 架构位置

```
自然语言任务 → Brain（拆解）→ Orchestrator（编排）→ FlexRunner（执行）
```

### 工作流程

1. **ANALYZING** — LLM 分析任务意图、技术栈、约束条件
2. **PLANNING** — LLM 将任务拆解为多个步骤，生成依赖关系图
3. **VALIDATING** — 校验拆解结果的完整性和合理性
4. **COMPLETED** — 产出 Orchestrator.loadTask() 可直接消费的任务 JSON

## 组合模式架构

Brain 采用**组合模式**（Composition Pattern），将职责分散到 4 个策略模块中：

```
                    ┌──────────────┐
                    │   Brain.js   │  编排层
                    │  (570 lines) │  状态管理、流程协调、校验、组装
                    └──────┬───────┘
                           │ 组合（持有实例）
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
  ┌────────────────┐ ┌──────────────┐ ┌──────────────┐
  │AnalysisStrateg.│ │Decomposition.│ │PlanPersisten.│
  │  (350 lines)   │ │  (450 lines) │ │  (200 lines) │
  │ analyzeTask    │ │ decomposeTask│ │ persistPlan  │
  │ analyzeWithCtx │ │ decomposeWCtx│ │ loadPlan     │
  │ normalize      │ │ normalize    │ │ listPlans    │
  └───────┬────────┘ └───────┬──────┘ └──────────────┘
          │                  │
          └────────┬─────────┘
                   ▼
          ┌────────────────┐
          │ SkillExecutor  │  CLI 执行引擎
          │  (200 lines)   │  健康检查、Session、轮询、结果读取
          └────────────────┘
```

- Brain 在 constructor 中创建 4 个模块实例并注入依赖（llm、storage、skillExecutor）
- Brain 的 `planTask` / `replanTask` / `planAndExecute` 方法仅负责**流程编排**和**组装**
- 具体策略逻辑（CLI vs LLM 选择、prompt 构建、结果解析）由各策略模块承担
- SkillExecutor 被 AnalysisStrategies 和 DecompositionStrategies 共享

## 目录结构

```
Server/Brain/
├── AGENTS.md                  # 本文档
├── Brain.js                   # 编排层（状态管理、流程协调、校验、组装）
├── SkillExecutor.js           # CLI SKILL 执行引擎（健康检查、Session、轮询、结果读取）
├── AnalysisStrategies.js      # 任务分析策略（CLI 优先 + LLM fallback）
├── DecompositionStrategies.js # 任务拆解策略（CLI 优先 + LLM fallback）
├── PlanPersistence.js         # 拆解计划持久化与历史加载
└── index.js                   # 模块统一导出
```

### 模块职责

| 模块 | 行数 | 职责 |
|------|------|------|
| Brain.js | ~570 | 编排层：状态管理、planTask/replanTask/planAndExecute 流程协调、_validatePlan、组装 BrainPlan |
| SkillExecutor.js | ~200 | CLI 健康检查、Session 创建/轮询、结果文件读取、惰性加载 CLIController |
| AnalysisStrategies.js | ~350 | analyzeTask / analyzeTaskWithContext（CLI 优先 + LLM fallback）+ normalizeAnalysis |
| DecompositionStrategies.js | ~450 | decomposeTask / decomposeTaskWithContext（CLI 优先 + LLM fallback）+ normalizeSteps |
| PlanPersistence.js | ~200 | persistPlan（多轮独立保存+快照）、loadPlan（planId/taskId/loopCount）、loadPlanHistory、listPlans |

## 接口

### Brain 类

```js
const brain = new Brain({
  llm: new LLMClient(),      // 可选，注入自定义 LLM
  storage: createStorage(),   // 可选，存储门面
  sseHub: sseHubInstance,     // 可选，SSE 推送
  skillDirectory: '...'       // 可选，SKILL 目录
});
```

### 核心方法

| 方法 | 说明 |
|------|------|
| `planTask(taskDescription, options?)` | 拆解任务，返回 BrainPlan |
| `replanTask(taskDescription, options)` | 重规划任务（基于上轮审核失败，复用 taskId） |
| `planAndExecute(taskDescription, orchController, options?)` | 拆解并直接执行 |
| `getPlans()` | 获取所有计划（内存） |
| `getPlan(planId)` | 获取指定计划（内存） |
| `loadPlan(planId, options?)` | 从文件系统加载计划（支持 taskId/loopCount 快速路径） |
| `loadPlanHistory(taskId)` | 加载某个 Task 下所有轮次计划（按轮次排序） |
| `listPlans()` | 列出所有历史计划（去重） |

### BrainPlan 结构

```js
{
  planId: 'plan_xxx',
  taskId: 'task_xxx',
  taskDescription: '原始自然语言描述',
  analysis: { intent, domain, keywords, constraints, techStack, complexity, estimatedSteps },
  taskDef: {
    taskId, taskDir, skillDirectory,
    steps: [{ stepId, taskDescription, dependId, nextStepId, failStepId, maxRetries }]
  },
  validation: { valid, issues },
  createdAt: '2026-07-31T...',
  status: 'completed'
}
```

## 依赖

| 依赖 | 来源 | 用途 |
|------|------|------|
| LLMClient | Agent/SkillSelector/llm/llmClient.js | LLM fallback（CLI 不可用时降级） |
| createStorage | DbUse/index.js | 持久化拆解计划（PlanPersistence 使用） |
| nowCST | library/cstTime.js | 时间格式化 |
| SkillExecutor | ./SkillExecutor.js | CLI SKILL 执行引擎 |
| AnalysisStrategies | ./AnalysisStrategies.js | 任务分析策略 |
| DecompositionStrategies | ./DecompositionStrategies.js | 任务拆解策略 |
| PlanPersistence | ./PlanPersistence.js | 持久化与历史加载 |
| CLIController | CLI/index.js（惰性加载） | opencode CLI 调用（SkillExecutor 内部） |

## SSE 事件

| 事件 | 触发时机 | 数据 |
|------|----------|------|
| `brain:plan:start` | 开始拆解 | `{ planId, taskId, taskDescription }` |
| `brain:analyze:done` | 分析完成 | `{ planId, analysis }` |
| `brain:plan:done` | 步骤拆解完成 | `{ planId, stepCount, steps }` |
| `brain:validate:done` | 校验完成 | `{ planId, validation }` |
| `brain:plan:complete` | 拆解全部完成 | `{ planId, taskDef }` |
| `brain:plan:error` | 拆解失败 | `{ planId, error }` |
