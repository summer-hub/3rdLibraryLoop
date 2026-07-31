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

## 目录结构

```
Server/Brain/
├── AGENTS.md      # 本文档
├── Brain.js       # Brain 核心类（含 BrainStatus 常量）
└── index.js       # 模块统一导出
```

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
| `planAndExecute(taskDescription, orchController, options?)` | 拆解并直接执行 |
| `getPlans()` | 获取所有计划 |
| `getPlan(planId)` | 获取指定计划 |
| `loadPlan(planId)` | 从文件系统加载计划 |
| `listPlans()` | 列出所有历史计划 |

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
| LLMClient | Agent/SkillSelector/llm/llmClient.js | 调用 LLM 进行任务分析 |
| createStorage | DbUse/index.js | 持久化拆解计划 |
| nowCST | library/cstTime.js | 时间格式化 |
| TaskDecompositionSkill | Skills/TaskDecompositionSkill/ | 拆解指令 SKILL |

## SSE 事件

| 事件 | 触发时机 | 数据 |
|------|----------|------|
| `brain:plan:start` | 开始拆解 | `{ planId, taskId, taskDescription }` |
| `brain:analyze:done` | 分析完成 | `{ planId, analysis }` |
| `brain:plan:done` | 步骤拆解完成 | `{ planId, stepCount, steps }` |
| `brain:validate:done` | 校验完成 | `{ planId, validation }` |
| `brain:plan:complete` | 拆解全部完成 | `{ planId, taskDef }` |
| `brain:plan:error` | 拆解失败 | `{ planId, error }` |
