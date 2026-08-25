# Orchestrator —— FlexRunner 任务编排器

接收一段规定好任务的 JSON（taskId + 多个 step），按照依赖关系编排执行多个 FlexRunner 实例。支持并行执行、成功/失败链跳转、循环检测、实时进度推送和未执行步骤配置修改。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  index.js                                            │
│  统一导出 Orchestrator / OrchestratorStatus / StepNode       │
├──────────────────────────────────────────────────────────────┤
│  编排核心  Orchestrator.js                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ loadTask       加载任务 JSON，构建步骤节点，验证引用     │  │
│  │ start          启动编排，主调度循环                      │  │
│  │ _scheduleLoop  收集 READY 步骤 → 并行执行 → 激活后续    │  │
│  │ _executeNode   单步执行（含重试），循环检测             │  │
│  │ _activateNext  成功→nextStepId / 失败→failStepId       │  │
│  │ abort/pause/resume  编排级控制                          │  │
│  │ updateStepConfig     修改未执行步骤配置                 │  │
│  │ getProgress / getStepDetail  进度与细节查询             │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  步骤模型  StepNode.js                                       │
│  封装单个步骤的元信息 + 运行时状态 + 历史执行记录             │
├──────────────────────────────────────────────────────────────┤
│  外部依赖（注入）                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ SseHub       │  │ FlexRunner   │  │ Storage (可选)   │   │
│  │ 实时进度推送  │  │ 步骤执行引擎  │  │ 持久化（可选）   │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  HTTP 层（Routes）                                           │
│  OrchestratorController + routes/orchestrator.js             │
│  挂载点: /api/orchestrator/*                                 │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
Server/Orchestrator/
├── AGENTS.md           # 本文档
├── Orchestrator.js     # 编排器核心类
├── StepNode.js         # 步骤节点模型
└── index.js            # 模块统一导出

Server/Routes/
├── controllers/OrchestratorController.js  # HTTP 控制器
└── routes/orchestrator.js                 # 路由注册
```

## 任务 JSON 格式

```json
{
  "taskId": "task-001",
  "taskDir": "/workspace/tasks/task-001",
  "skillDirectory": "/path/to/Skills",
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "分析代码结构",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "specifiedSkill": "cpp-porting-analysis"
    },
    {
      "stepId": 2,
      "dependId": 1,
      "taskDescription": "生成报告",
      "nextStepId": 3,
      "failStepId": 4,
      "maxRetries": 3
    },
    {
      "stepId": 3,
      "dependId": 2,
      "taskDescription": "验证结果",
      "nextStepId": 0,
      "maxRetries": 3
    },
    {
      "stepId": 4,
      "taskDescription": "错误修复",
      "dependId": 0,
      "nextStepId": 2,
      "maxRetries": 3
    }
  ]
}
```

- `dependId=0`：无前置依赖（入口步骤），可并行启动
- `nextStepId=0`：成功后无后续，编排结束
- `failStepId=0`：失败后终止链，不跳转
- `specifiedSkill`：可选，指定 SKILL（name 或目录名）；非空时该步骤跳过 SkillSelector 自动匹配，直接使用指定 SKILL（省去 2 次 LLM 调用，且避免选错）；解析失败降级为无 SKILL 模式

## 编排逻辑

### 执行流程

1. **loadTask**：解析 JSON → 构建 StepNode → 验证引用完整性 → 识别入口步骤
2. **start**：入口步骤标记 READY → 进入调度循环
3. **_scheduleLoop**：每轮收集所有 READY 步骤 → `Promise.all` 并行执行
4. **_executeNode**：
   - 循环检测（同一步骤不重复执行）
   - 创建 FlexRunner → 重试循环直到成功或用尽 maxRetries
   - 成功 → 标记 COMPLETED → 激活 nextStepId
   - 失败 → 标记 FAILED → 激活 failStepId（若非 0）
5. 报告传递：前置步骤的 `resultPath` 自动赋值给后续步骤的 `inputReport`

### 循环检测

- 每个 (taskId, stepId) 组合在执行路径中只允许出现一次
- 若 nextStepId/failStepId 指向已执行过的步骤，标记为 BLOCKED
- 全局执行次数上限 200 次作为兜底保护

### 死锁检测

- 调度循环中若无 READY 步骤也无 RUNNING 步骤 → 结束
- 结束后检查：全部 COMPLETED → COMPLETED，否则 → DEADLOCKED 或 FAILED

## SSE 事件

编排器通过 SseHub（channel = taskId）实时推送以下事件：

| 事件类型 | 触发时机 | 数据 |
|----------|----------|------|
| `orch:task:start` | 编排启动 | getProgress() |
| `orch:step:status` | 步骤状态变更 | { stepId, status, retryCount, ... } |
| `orch:step:detail` | 单次执行完成 | { stepId, attempt, success, resultPath, ... } |
| `orch:task:progress` | 步骤状态变更后 | getProgress() |
| `orch:task:complete` | 编排结束 | { status, progress } |
| `orch:task:error` | 编排异常 | { error, progress } |
| `orch:task:aborted` | 编排被终止 | getProgress() |

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/orchestrator/load` | 加载任务定义 |
| POST | `/api/orchestrator/start` | 启动编排（异步） |
| POST | `/api/orchestrator/pause` | 暂停编排 |
| POST | `/api/orchestrator/resume` | 恢复编排 |
| POST | `/api/orchestrator/abort` | 终止编排 |
| GET | `/api/orchestrator/progress?taskId=` | 查询进度 |
| GET | `/api/orchestrator/step-detail?taskId=&stepId=&detailType=` | 查询步骤细节 |
| POST | `/api/orchestrator/update-step` | 修改未执行步骤配置 |
| GET | `/api/orchestrator/tasks` | 列出所有编排任务 |
| DELETE | `/api/orchestrator/task?taskId=` | 移除编排任务 |

## 设计要点

### 高内聚低耦合

- **Orchestrator**：只管调度和状态流转，不关心 Skill 匹配和 CLI 细节
- **StepNode**：只管单个步骤的状态和配置，不关心执行引擎
- **FlexRunner**：只管单步执行，由 Orchestrator 编排
- **SseHub / Storage**：通过构造注入，可替换或省略

### 依赖注入

- `sseHub`：可选，无则不推送 SSE 事件
- `storage`：可选，预留持久化扩展
- `flexRunnerFactory`：可选，测试时注入 mock FlexRunner

### 优化点

1. **并行执行**：无依赖的步骤通过 `Promise.all` 并行执行
2. **循环检测**：执行路径追踪，防止无限循环
3. **全局执行上限**：兜底保护，防止极端场景
4. **报告自动传递**：前置 resultPath 自动赋值给后续 inputReport
5. **配置可修改**：未执行步骤支持动态修改依赖关系
6. **实时进度**：SSE 推送，前端无需轮询
