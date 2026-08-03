---
name: task-analysis
description: 分析自然语言任务描述，提取核心意图、领域、关键词、约束条件、技术栈，并生成结构化验收标准。当需要将一个高层任务描述拆解为意图分析与验收标准生成时使用此技能。适用于 AI Loop 系统中 Brain 模块的任务分析阶段。
license: Apache-2.0
compatibility: 需要访问任务工作目录（用于读取上下文文件），输出 JSON 格式分析结果。
metadata:
  author: LoopEngine
  version: "1.0.0"
  category: task-planning
  language: natural-language
---

# 任务分析技能

本技能通过 LLM 分析自然语言任务描述，提取任务的关键信息并生成结构化验收标准，为后续的任务拆解提供基础。

> ⚠️ **核心原则：分析结果必须包含可验证的验收标准，每条标准具体且可执行。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskDescription` | string | ✅ | 自然语言任务描述 |
| `acceptanceCriteria` | string | ❌ | 用户提供的验收标准（自然语言），未提供时由 LLM 自动生成 |
| `workDir` | string | ❌ | 任务工作目录（用于读取上下文文件） |
| `resultFilePath` | string | ✅ | 分析结果 JSON 输出路径 |
| `context` | object | ❌ | 重规划上下文（仅重规划时提供，含 failedCriteria、improvementSuggestions 等） |

---

## 输入依赖

无前置 SKILL。作为任务拆解流程的第一步执行。

---

## 工作流程概览

```
Phase 1: 任务理解 → Phase 2: 信息提取 → Phase 3: 验收标准生成 → Phase 4: 结果输出
```

---

## Phase 1：任务理解

### 1.1 解析任务描述

读取任务描述文本，理解任务的核心目标和预期产出。

### 1.2 处理用户验收标准（如果提供）

如果用户提供了验收标准（`acceptanceCriteria`），需要：
- 理解用户期望
- 将用户标准作为基础，进行细化和补充
- 确保每条标准具体、可验证

如果用户未提供验收标准，根据任务描述自动生成合理的验收标准。

### 1.3 处理重规划上下文（如果提供）

如果提供了 `context`（重规划场景），需要额外处理：
- 读取 `context.failedCriteria` — 上一轮未满足的验收标准
- 读取 `context.improvementSuggestions` — 上一轮改进建议
- 读取 `context.prevCheckSummary` — 上一轮审核摘要
- 读取 `context.loopCount` — 当前循环轮次
- 保持原始任务目标不变，针对未满足标准分析失败原因
- 调整验收标准的验证方式，使其更明确
- 如有必要，补充新的验收标准
- 考虑改进建议中的方向

---

## Phase 2：信息提取

提取以下关键信息：

| 字段 | 说明 |
|------|------|
| `intent` | 任务的核心意图（一句话概括） |
| `domain` | 任务所属领域（如 harmonyos-porting、code-quality、documentation 等） |
| `keywords` | 关键词列表（用于 SKILL 匹配） |
| `constraints` | 约束条件列表 |
| `techStack` | 涉及的技术栈列表 |
| `complexity` | 复杂度评估：`low` / `medium` / `high` |
| `estimatedSteps` | 预估步骤数 |

---

## Phase 3：验收标准生成

### 3.1 标准生成原则

- **具体可验证**：每条标准必须能通过检查文件、执行命令或人工审查来判定
- **覆盖关键产出**：验收标准应覆盖任务的核心产出和质量要求
- **数量合理**：通常 3-8 条，不宜过多或过少
- **类型明确**：每条标准标注 type 分类

### 3.2 type 分类

| type | 说明 | 示例 |
|------|------|------|
| `output` | 产物检查 — 检查文件/内容是否存在、是否完整 | "分析报告文件已生成且非空" |
| `quality` | 质量要求 — 检查产物质量是否达标 | "报告覆盖所有关键维度" |
| `performance` | 性能指标 — 检查定量指标 | "扫描覆盖率 ≥ 80%" |
| `compliance` | 合规性 — 检查是否符合规范 | "代码符合编码规范" |

### 3.3 重规划时的标准调整

重规划场景下，验收标准生成需要额外考虑：
- 针对未满足的标准，调整验证方式使其更明确
- 补充新的验收标准以覆盖上轮遗漏的维度
- 生成 `failureAnalysis` — 对上一轮失败原因的分析总结
- 生成 `adjustmentStrategy` — 本轮的调整策略说明

---

## Phase 4：结果输出

### 4.1 输出文件格式

将分析结果以 JSON 格式写入 `resultFilePath` 指定的路径。

### 4.2 JSON 结构

```json
{
  "intent": "任务的核心意图（一句话概括）",
  "domain": "任务所属领域",
  "keywords": ["关键词1", "关键词2"],
  "constraints": ["约束条件1", "约束条件2"],
  "techStack": ["技术栈1"],
  "complexity": "low|medium|high",
  "estimatedSteps": 3,
  "acceptanceCriteria": [
    {
      "id": "ac1",
      "criterion": "具体的验收标准描述",
      "type": "output|quality|performance|compliance",
      "verification": "如何验证该标准是否满足"
    }
  ]
}
```

### 4.3 重规划时的额外字段

重规划场景下，JSON 额外包含：

```json
{
  "failureAnalysis": "对上一轮失败原因的分析总结",
  "adjustmentStrategy": "本轮的调整策略说明"
}
```

### 4.4 输出规范

- 结果文件必须为**纯 JSON**（不含 markdown 代码块标记，不含任何非 JSON 内容）
- JSON 必须是合法的可解析格式
- 验收标准的 `id` 从 `ac1` 开始递增
- 所有字符串字段不能为空

---

## 注意事项

1. **不要修改任务目标** — 分析阶段保持原始任务目标不变，仅提取信息和生成标准
2. **验收标准必须可验证** — 避免模糊描述如"分析完成"
3. **关键词要准确** — 关键词直接影响后续 SKILL 匹配的准确性
4. **技术栈要完整** — 列出所有涉及的技术栈，便于步骤拆解时匹配专用 SKILL
5. **重规划时保持目标一致** — 调整的是策略和标准，不是任务目标本身
