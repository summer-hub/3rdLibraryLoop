# 任务分析输出 Schema

> 分析结果 JSON 的完整字段规范。SKILL 执行后必须将结果写入 `resultFilePath`，格式为纯 JSON。

---

## 1. 完整 JSON 结构

### 1.1 首轮分析输出

```json
{
  "intent": "任务的核心意图（一句话概括）",
  "domain": "任务所属领域",
  "keywords": ["关键词1", "关键词2"],
  "constraints": ["约束条件1", "约束条件2"],
  "techStack": ["技术栈1", "技术栈2"],
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

### 1.2 重规划分析输出（额外字段）

首轮所有字段 **plus**：

```json
{
  "failureAnalysis": "对上一轮失败原因的分析总结",
  "adjustmentStrategy": "本轮的调整策略说明"
}
```

---

## 2. 字段规范

### 2.1 `intent`

| 属性 | 值 |
|------|-----|
| 类型 | string |
| 必填 | ✅ |
| 约束 | 非空，一句话（≤100 字符推荐） |

任务的核心意图概括。示例：
- ✅ `"将 Java 三方库 X 移植到鸿蒙 ArkTS，保持核心 API 兼容"`
- ❌ `"完成任务"` （过于模糊）

### 2.2 `domain`

| 属性 | 值 |
|------|-----|
| 类型 | string |
| 必填 | ✅ |
| 约束 | 非空，使用 kebab-case |

任务所属领域。常见值：

| domain 值 | 适用场景 |
|-----------|----------|
| `harmonyos-porting` | 鸿蒙/ArkTS 移植 |
| `code-quality` | 代码质量检视 |
| `documentation` | 文档编写/检视 |
| `testing` | 测试覆盖/测试用例 |
| `bug-fix` | 缺陷修复 |
| `feature` | 新功能开发 |
| `refactoring` | 代码重构 |
| `general` | 通用/未分类 |

> 也可使用自定义值，但应保持 kebab-case 格式。

### 2.3 `keywords`

| 属性 | 值 |
|------|-----|
| 类型 | string[] |
| 必填 | ✅ |
| 约束 | ≥1 个元素，每个非空 |

关键词列表，用于后续 SKILL 匹配。应包含：
- 技术名词（如 `ArkTS`、`grpc`、`protobuf`）
- 动作词（如 `porting`、`audit`、`refactor`）
- 领域词（如 `memory-leak`、`nfc`）

### 2.4 `constraints`

| 属性 | 值 |
|------|-----|
| 类型 | string[] |
| 必填 | ✅ |
| 约束 | 可为空数组 |

约束条件列表。如：
- `"必须兼容 ArkTS 编译规则（arkts-no-any-unknown 等）"`
- `"不能修改公共 API 签名"`
- `"输出文件为纯 JSON"`

### 2.5 `techStack`

| 属性 | 值 |
|------|-----|
| 类型 | string[] |
| 必填 | ✅ |
| 约束 | ≥1 个元素 |

涉及的技术栈。如 `["ArkTS", "OpenHarmony", "grpc"]`。

### 2.6 `complexity`

| 属性 | 值 |
|------|-----|
| 类型 | string |
| 必填 | ✅ |
| 枚举 | `low` / `medium` / `high` |

复杂度评估标准：

| 值 | 步骤数 | 跨模块 | 风险 |
|----|--------|--------|------|
| `low` | 1-3 | 单模块 | 低 |
| `medium` | 4-7 | 2-3 模块 | 中 |
| `high` | 8+ | 多模块/跨系统 | 高 |

### 2.7 `estimatedSteps`

| 属性 | 值 |
|------|-----|
| 类型 | number |
| 必填 | ✅ |
| 约束 | ≥1 的整数 |

预估步骤数，用于 task-decomposition SKILL 参考。应与 complexity 对应。

### 2.8 `acceptanceCriteria`

| 属性 | 值 |
|------|-----|
| 类型 | object[] |
| 必填 | ✅ |
| 约束 | 3-8 条，每条含 id/criterion/type/verification |

每条验收标准的字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 从 `ac1` 开始递增 |
| `criterion` | string | ✅ | 具体的标准描述，非空 |
| `type` | string | ✅ | `output`/`quality`/`performance`/`compliance` |
| `verification` | string | ✅ | 验证方式描述 |

> type 分类与编写指南详见 [验收标准编写指南](../references/ACCEPTANCE_CRITERIA_GUIDE.md)

### 2.9 `failureAnalysis`（仅重规划）

| 属性 | 值 |
|------|-----|
| 类型 | string |
| 必填 | 重规划时 ✅ |
| 约束 | 非空（重规划场景） |

对上一轮失败原因的分析总结。应：
- 逐条分析未满足标准的失败原因
- 区分"标准未满足"与"执行失败"
- 指出根因（如环境问题、代码缺陷、标准过严等）

### 2.10 `adjustmentStrategy`（仅重规划）

| 属性 | 值 |
|------|-----|
| 类型 | string |
| 必填 | 重规划时 ✅ |
| 约束 | 非空（重规划场景） |

本轮的调整策略说明。应：
- 说明对验收标准做了哪些调整
- 说明对预期执行路径的调整方向
- 与改进建议对应

---

## 3. 输出文件规范

### 3.1 格式要求

- 文件必须为 **纯 JSON**（不含 markdown 代码块标记 ```` ```json ``` ``）
- 不含任何非 JSON 内容（无注释、无前后缀文字）
- JSON 必须是合法的可解析格式
- 验收标准的 `id` 从 `ac1` 开始递增

### 3.2 容错机制

下游 `SkillExecutor.readSkillResult` 会尝试从容错提取：
- 从首个 `{` 到末个 `}` 之间的内容
- 即使被 markdown 代码块包裹也能解析

**但仍应输出纯 JSON**，不要依赖容错机制。

### 3.3 字段兜底

下游 `normalizeAnalysis` 会对缺失字段兜底：

| 字段 | 兜底值 |
|------|--------|
| `intent` | `''` |
| `domain` | `'general'` |
| `keywords` | `[]` |
| `constraints` | `[]` |
| `techStack` | `[]` |
| `complexity` | `'medium'` |
| `estimatedSteps` | `3` |
| `acceptanceCriteria` | `[]`（空描述条目被过滤） |
| `failureAnalysis` | `''` |
| `adjustmentStrategy` | `''` |

> 兜底仅是安全网，SKILL 应尽量输出完整字段，避免依赖兜底。
