# TestCheck —— 任务准出审核引擎

在 Orchestrator 所有步骤执行完成后，对最终产物进行验收审核。通过 Agent 选择合适的 SKILL 执行准出检查，对照 Brain 生成的任务级验收标准判断是否满足准出条件。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  index.js                                            │
│  统一导出 TestCheck / CheckStatus                            │
├──────────────────────────────────────────────────────────────┤
│  核心类  TestCheck.js                                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ runCheck       执行完整准出审核流程                     │  │
│  │ _matchSkill    基于"准出审核"语义匹配审核 Skill          │  │
│  │ _invokeSkill   通过 CLI 执行审核 Skill，生成审核报告     │  │
│  │ _evaluateAcceptance  LLM 评估审核报告，逐条判断验收标准  │  │
│  │ _persistCheckResult   审核结果持久化                     │  │
│  │ loadCheckResult / listCheckResults  历史审核查询         │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  外部依赖（惰性加载，支持注入 mock）                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐          │
│  │ LLMClient    │  │ Agent/       │  │ CLI/        │          │
│  │ 评估验收标准  │  │ SkillSelector│  │ CLIController│          │
│  │              │  │ 匹配审核 Skill│  │ 执行审核     │          │
│  └──────────────┘  └──────────────┘  └────────────┘          │
├──────────────────────────────────────────────────────────────┤
│  持久化                                                      │
│  db/task/{taskId}/testcheck_loop{n}.json                     │
├──────────────────────────────────────────────────────────────┤
│  大循环位置（Loop Engineering）                               │
│  Brain → Orchestrator → FlexRunner → TestCheck               │
│                                          │                    │
│                               未通过 ──→ 回到 Brain 重规划    │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
Server/TestCheck/
├── AGENTS.md          # 本文档
├── TestCheck.js       # 准出审核核心类
└── index.js           # 模块统一导出
```

## 核心方法

### `runCheck(params)` — 执行准出审核

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| taskId | string | ✅ | 任务 ID |
| taskDir | string | ❌ | 工作目录（默认基于 taskId 推导） |
| taskDescription | string | ❌ | 原始任务描述 |
| acceptanceCriteria | Array | ❌ | 任务级验收标准（Brain 生成） |
| orchestratorResult | object | ❌ | Orchestrator 执行结果摘要 |
| loopCount | number | ❌ | 当前大循环次数（默认 0） |
| skillDirectory | string | ❌ | 覆盖 SKILL 目录 |

返回 `CheckResult` 对象：

```js
{
  checkId, taskId, loopCount,
  taskDescription, acceptanceCriteria, orchestratorResult,
  startTime, endTime,
  status,        // 'passed' | 'failed' | 'error'
  passed,        // boolean
  matchedSkillDir,
  checkReportPath,
  sessionId,
  criteriaResults: [
    { id, criterion, satisfied, evidence, note }
  ],
  summary,
  improvementSuggestions,
  error
}
```

## 审核流程

1. **MATCHING** — 基于"准出审核"语义，通过 SkillSelector 匹配最佳审核 Skill
2. **EXECUTING** — 通过 CLIController 执行审核 Skill，生成审核报告文件
3. **EVALUATING** — LLM 读取审核报告，逐条判断验收标准是否满足
4. **持久化** — 审核结果写入 `db/task/{taskId}/testcheck_loop{n}.json`

## 持久化文件布局

```
db/task/{taskId}/
├── brain.json                  ← Brain 拆解计划
├── orchestration.json          ← Orchestrator 编排状态
├── testcheck_loop0.json        ← 第 0 次循环准出审核
├── testcheck_loop1.json        ← 第 1 次循环准出审核
├── stepid_1.json               ← 步骤执行记录
└── ...
```

## 与 LoopEngine 的关系

TestCheck 是 LoopEngine 大循环的准出判断环节：

- `passed=true` → LoopEngine 结束循环，任务完成
- `passed=false` → LoopEngine 调用 Brain.replanTask() 重新生成目标，进入下一轮循环
- `status=error` → LoopEngine 根据策略决定是否重试或终止

TestCheck 不感知 LoopEngine 的存在，只负责执行审核并返回结果。
