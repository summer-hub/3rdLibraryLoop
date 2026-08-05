---
name: task-analysis
description: 分析自然语言任务描述，提取核心意图、领域、关键词、约束条件、技术栈，并生成结构化验收标准。当需要将一个高层任务描述拆解为意图分析与验收标准生成时使用此技能。适用于 AI Loop 系统中 Brain 模块的任务分析阶段，支持首轮分析与重规划场景。
license: Apache-2.0
compatibility: 由 Brain 模块通过 opencode CLI 调用（SkillExecutor），或降级为直接 LLM 调用。需要写入权限到任务工作目录，输出纯 JSON 格式分析结果。
metadata:
  author: LoopEngine
  version: "2.0.0"
  category: task-planning
  language: natural-language
  invoked-by: AnalysisStrategies._analyzeViaCLI / _analyzeWithContextViaCLI
  consumed-by: AnalysisStrategies.normalizeAnalysis → DecompositionStrategies → Brain.taskDef
---

# 任务分析技能

本技能通过 LLM 分析自然语言任务描述，提取任务的关键信息并生成结构化验收标准，为后续的任务拆解提供基础。

> ⚠️ **核心原则：分析结果必须包含可验证的验收标准，每条标准具体且可执行。输出必须为纯 JSON。**

---

## 调用方式

本 SKILL 由 Brain 模块的 `AnalysisStrategies` 调用，通过 `SkillExecutor.invokeSkill` 执行：

- **首轮分析**：`AnalysisStrategies._analyzeViaCLI(taskDescription, userCriteria, ctx)`
- **重规划分析**：`AnalysisStrategies._analyzeWithContextViaCLI(taskDescription, userCriteria, context, ctx)`

调用方会构建以下 prompt 段落传入：
- `## SKILL 目录` — 本 SKILL 目录路径（opencode 读取 SKILL.md 执行）
- `## 工作目录` — 任务工作目录
- `## 结果文件输出路径` — JSON 输出路径（`brain_analysis_loop{N}.json`）
- `## 任务描述` — 自然语言任务描述
- `## 用户提供的验收标准` 或 `## 验收标准`（未提供时自动生成）
- 重规划时额外注入：`## 重规划上下文` / `## 上一轮审核摘要` / `## 未满足的验收标准` / `## 改进建议` / `## 重分析要求`

> 完整调用链路与消费方式参见 [调用链路说明](references/INTEGRATION_CONTEXT.md)

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskDescription` | string | ✅ | 自然语言任务描述（由调用方通过 prompt 注入） |
| `acceptanceCriteria` | string | ❌ | 用户提供的验收标准（自然语言），未提供时自动生成 |
| `workDir` | string | ✅ | 任务工作目录（由调用方指定） |
| `resultFilePath` | string | ✅ | 分析结果 JSON 输出路径（由调用方指定） |
| `context` | object | ❌ | 重规划上下文（仅重规划时提供，含 failedCriteria、improvementSuggestions、prevCheckSummary、loopCount 等） |

---

## 输入依赖

- **前置 SKILL**：无。作为任务拆解流程的第一步执行。
- **输入文件**：无（任务描述通过 prompt 注入）。
- **下游 SKILL**：`TaskDecompositionSkill`（消费本 SKILL 的输出进行步骤拆解）。

---

## 工作流程概览

```
Phase 1: 任务理解与上下文解析
    ↓
Phase 2: 关键信息提取（intent/domain/keywords/constraints/techStack/complexity/estimatedSteps）
    ↓
Phase 3: 验收标准生成（3-8 条，含 type 分类与 verification）
    ↓
Phase 4: 结果输出（纯 JSON 写入 resultFilePath）
```

---

## Phase 1：任务理解与上下文解析

### 1.1 解析任务描述

读取 `## 任务描述` 段落，理解任务的核心目标和预期产出。提取：
- **核心目标**：任务要达成什么
- **预期产出**：最终交付什么（代码、文档、报告等）
- **领域线索**：技术领域、平台、语言等

### 1.2 处理用户验收标准

读取 `## 用户提供的验收标准` 段落（如果存在）：
- 将用户自然语言标准作为基础
- 细化补充为结构化的验收标准（补全 type、verification 字段）
- 确保每条标准具体、可验证

如果段落为 `## 验收标准`（未提供用户标准），则根据任务描述自动生成。

### 1.3 处理重规划上下文（如果提供）

如果 prompt 中包含 `## 重规划上下文` 段落，进入重规划模式：
- 读取 `## 未满足的验收标准` — 上一轮未通过的标准及其失败原因
- 读取 `## 改进建议` — 上一轮的改进方向
- 读取 `## 上一轮审核摘要` — 审核总结
- **保持原始任务目标不变**，仅调整策略和标准
- 分析失败原因，生成 `failureAnalysis` 字段
- 制定调整策略，生成 `adjustmentStrategy` 字段

> 详细处理流程参见 [重规划上下文处理指南](references/REPLAN_CONTEXT_GUIDE.md)

---

## Phase 2：关键信息提取

提取以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `intent` | string | 任务核心意图（一句话概括，≤100 字符） |
| `domain` | string | 任务领域（kebab-case，如 `harmonyos-porting`、`code-quality`、`documentation`、`bug-fix`、`feature`、`refactoring`） |
| `keywords` | string[] | 关键词列表（用于后续 SKILL 匹配，≥1 个） |
| `constraints` | string[] | 约束条件列表 |
| `techStack` | string[] | 技术栈列表（≥1 个） |
| `complexity` | string | 复杂度：`low`（1-3步/单模块）/ `medium`（4-7步/2-3模块）/ `high`（8+步/跨系统） |
| `estimatedSteps` | number | 预估步骤数（≥1，供 TaskDecompositionSkill 参考） |

### 提取要点

- `keywords` 要包含技术名词、动作词、领域词，直接影响后续 SKILL 匹配准确性
- `techStack` 要完整列出所有涉及的技术栈，便于步骤拆解时匹配专用 SKILL
- `estimatedSteps` 应与 `complexity` 对应，重规划时可根据失败原因调整

> 完整字段规范参见 [输出 Schema](references/ANALYSIS_SCHEMA.md)

---

## Phase 3：验收标准生成

### 3.1 生成原则

- **具体可验证**：每条标准必须能通过检查文件、执行命令或人工审查来判定 pass/fail
- **覆盖关键产出**：至少 1 条 `output` 类型 + 至少 1 条 `quality`/`compliance` 类型
- **数量合理**：3-8 条
- **避免模糊**：禁止"分析完成""代码质量好"等不可验证描述

### 3.2 type 分类

| type | 说明 | 验证方式 |
|------|------|----------|
| `output` | 产物检查 — 文件/内容是否存在、是否完整 | 检查文件存在性、大小、格式 |
| `quality` | 质量要求 — 产物质量是否达标 | 内容审查、规则匹配 |
| `performance` | 性能指标 — 定量指标 | 执行命令获取数值 |
| `compliance` | 合规性 — 是否符合规范 | 规范比对、lint 检查 |

### 3.3 每条标准必含字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 从 `ac1` 开始递增（ac1, ac2, ac3...） |
| `criterion` | ✅ | 具体标准描述，非空 |
| `type` | ✅ | `output`/`quality`/`performance`/`compliance` |
| `verification` | ✅ | 验证方式描述（具体到可执行命令或检查方法） |

### 3.4 重规划时的额外处理

- 针对未满足标准调整验证方式（更明确）
- 补充新标准覆盖上轮遗漏维度
- 必须生成 `failureAnalysis` 和 `adjustmentStrategy` 字段

> 编写指南与示例参见 [验收标准编写指南](references/ACCEPTANCE_CRITERIA_GUIDE.md)

---

## Phase 4：结果输出

### 4.1 输出文件

将分析结果以 **纯 JSON** 格式写入 `## 结果文件输出路径` 指定的路径。

### 4.2 JSON 结构（首轮）

```json
{
  "intent": "任务核心意图",
  "domain": "任务领域",
  "keywords": ["关键词1", "关键词2"],
  "constraints": ["约束条件1"],
  "techStack": ["技术栈1"],
  "complexity": "low|medium|high",
  "estimatedSteps": 3,
  "acceptanceCriteria": [
    {
      "id": "ac1",
      "criterion": "具体标准描述",
      "type": "output|quality|performance|compliance",
      "verification": "验证方式"
    }
  ]
}
```

### 4.3 重规划时额外字段

```json
{
  "failureAnalysis": "上一轮失败原因分析",
  "adjustmentStrategy": "本轮调整策略"
}
```

### 4.4 输出规范

- ✅ 纯 JSON（无 markdown 代码块标记，无注释，无前后缀文字）
- ✅ 合法可解析格式
- ✅ 验收标准 `id` 从 `ac1` 递增
- ✅ 所有字符串字段非空

> 完整输出示例参见 [输出示例](assets/OUTPUT_EXAMPLES.md)

---

## 自检

输出完成后，可运行校验脚本验证 JSON 合规性：

```bash
bash scripts/validate-analysis-output.sh <resultFile>
```

---

## 注意事项

1. **不要修改任务目标** — `intent` 在重规划时保持不变，仅调整策略和标准
2. **验收标准必须可验证** — 避免模糊描述，verification 要具体到可执行
3. **关键词要准确** — 直接影响后续 SKILL 匹配的准确性
4. **技术栈要完整** — 列出所有涉及的技术栈，便于步骤拆解时匹配专用 SKILL
5. **重规划时保持目标一致** — 调整的是 `acceptanceCriteria`/`estimatedSteps`/`failureAnalysis`/`adjustmentStrategy`，不是 `intent`
6. **输出纯 JSON** — 下游有容错机制但应输出纯 JSON，不依赖容错
