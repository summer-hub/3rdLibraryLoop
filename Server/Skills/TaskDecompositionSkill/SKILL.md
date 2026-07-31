---
name: task-decomposition
description: 将自然语言任务描述拆解为多个可独立执行的步骤，生成包含依赖关系的步骤图。当需要将一个复杂的高层任务分解为 Orchestrator 可执行的结构化步骤列表时使用此技能。
metadata:
  author: lalhan
  version: "1.0.0"
  category: task-planning
  language: natural-language
compatibility: 适用于任意需要多步骤执行的 AI Loop 任务，要求输入为自然语言任务描述。
---

# 任务拆解技能

本技能通过 LLM 将自然语言任务描述拆解为多个可独立执行的步骤，生成包含依赖关系的步骤图，供 Orchestrator 编排器调度执行。

> ⚠️ **核心原则：每个步骤必须能被一个已有的 SKILL 独立完成，步骤描述必须包含足够的技术细节。**

---

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskDescription` | string | 是 | 自然语言任务描述 |
| `acceptanceCriteria` | string | 否 | 用户提供的验收标准（自然语言），未提供时由 LLM 自动生成 |
| `analysis` | object | 否 | 任务分析结果（intent, domain, keywords, constraints, techStack, acceptanceCriteria） |
| `skillDirectory` | string | 否 | SKILL 目录路径（用于参考已有 SKILL 列表） |

---

## 输出产物

JSON 格式的步骤列表，每个步骤包含验收标准：

```json
{
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "步骤的具体描述",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac1_1",
          "criterion": "该步骤的验收标准描述",
          "type": "output",
          "verification": "验证方式描述",
          "taskACIds": ["ac1"]
        }
      ]
    }
  ]
}
```

### acceptanceCriteria 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 标准唯一 ID，格式 `ac{stepId}_{序号}` |
| `criterion` | string | 具体标准描述，必须可验证 |
| `type` | string | `output`（产物检查）/ `quality`（质量要求）/ `performance`（性能指标）/ `compliance`（合规性） |
| `verification` | string | 验证方式：如检查文件是否存在、执行命令、内容审查等 |
| `taskACIds` | string[] | 该步骤标准关联的任务级标准 ID 列表 |

---

## 拆解原则

### 1. 步骤粒度

- 每个步骤应能被**一个 SKILL 独立完成**
- 步骤描述需包含：**做什么、怎么做、预期输出**
- 避免步骤过粗（一个步骤包含多个不相关任务）或过细（一个 SKILL 的能力被拆成多个步骤）

### 2. 依赖关系图

步骤间通过三个字段构成有向图：

```
dependId   → 当前步骤依赖哪个步骤（0 = 入口步骤，无前置依赖）
nextStepId → 成功后执行哪个步骤（0 = 终止，任务完成）
failStepId → 失败后跳转到哪个步骤（0 = 失败即终止）
```

**图结构示例：**

```
步骤1 (入口)
  ├─ 成功 → 步骤2
  └─ 失败 → 步骤3 (回退/修复)

步骤2
  ├─ 成功 → 步骤4 (终止)
  └─ 失败 → 步骤3

步骤3 (修复步骤)
  ├─ 成功 → 步骤2 (重试)
  └─ 失败 → 步骤4 (终止)

步骤4 (终止，nextStepId=0)
```

### 3. 并行执行

- 如果多个步骤的 `dependId` 指向同一个步骤，且它们的 `nextStepId` 不同
- Orchestrator 会在前置步骤成功后**并行执行**这些步骤
- 适用于：同时进行代码质量检查 + 文档质量检查等独立任务

### 4. 失败回退

- 关键步骤应设置 `failStepId`，指向修复/回退步骤
- 修复步骤成功后应重新指向原始步骤（形成有限重试循环）
- `maxRetries` 控制单个步骤的最大重试次数

### 5. 步骤描述规范

**好的描述：**
```
对 libcurl 源码进行鸿蒙化可行性分析：git clone 源码仓库，扫描源码结构、依赖、平台相关代码及构建系统，输出标准化分析报告（analysis-report.md）
```

**差的描述：**
```
分析代码
```

描述应包含：
- 具体操作（git clone、扫描、编译、测试等）
- 操作对象（库名、文件路径等）
- 预期输出（报告文件名、状态标记等）

### 6. 验收标准生成规范

每个步骤**必须**包含 `acceptanceCriteria` 数组，标准需遵循以下原则：

**原则：**
- **具体可验证**：每条标准必须能通过检查文件、执行命令或人工审查来判定是否满足
- **覆盖任务级标准**：所有步骤的验收标准合并后应覆盖任务级验收标准
- **与步骤产出对齐**：验收标准应与该步骤的 taskDescription 中的预期输出直接对应
- **追溯性**：通过 `taskACIds` 标明该步骤标准对应哪个任务级标准

**好的验收标准：**
```json
{
  "id": "ac1_1",
  "criterion": "分析报告文件 analysis-report.md 已生成且非空",
  "type": "output",
  "verification": "检查 ${taskDir}/analysis-report.md 文件是否存在且文件大小 > 0",
  "taskACIds": ["ac1"]
}
```

**差的验收标准：**
```json
{
  "criterion": "分析完成"
}
```

**type 类型选择指南：**
- `output`：检查具体文件/产物是否存在、格式是否正确
- `quality`：代码质量、文档质量等定性要求
- `performance`：编译时间、内存占用等定量指标
- `compliance`：是否符合编码规范、安全要求等

---

## 常见任务拆解模板

### 模板 1：库移植分析

```
步骤1: 源码分析（CPPAnalysisSkill / FlutterCodeCheck）
  → 成功: 步骤2
  → 失败: 终止

步骤2: 接口分析（HarmonyLibraryInterface / LibraryInterface）
  → 成功: 步骤3
  → 失败: 步骤4

步骤3: 编译验证（CPPCompileSkill）
  → 成功: 步骤5 (终止)
  → 失败: 步骤4

步骤4: 问题修复（CPPPortingSkill）
  → 成功: 步骤3 (重试编译)
  → 失败: 步骤5 (终止)

步骤5: 生成报告（终止）
```

### 模板 2：代码质量检查

```
步骤1: 代码质量检查（XxxLibraryCodeQualityCheckSkill）
  → 成功: 步骤2
  → 失败: 步骤3

步骤2: 文档质量检查（XxxLibraryDocumentationQualityCheckSkill）
  → 成功: 步骤4 (终止)
  → 失败: 步骤3

步骤3: 问题修复（LibraryDocFixSkill）
  → 成功: 步骤1 (重试)
  → 失败: 步骤4 (终止)

步骤4: 终止
```

### 模板 3：PR 代码检视

```
步骤1: 获取 PR 信息并克隆仓库
  → 成功: 步骤2
  → 失败: 终止

步骤2: 分析变更文件
  → 成功: 步骤3
  → 失败: 终止

步骤3: 生成检视报告
  → 成功: 终止
  → 失败: 终止
```

---

## 校验规则

拆解完成后，Brain 会对结果进行以下校验：

1. **stepId 唯一性** — 不允许重复的步骤 ID
2. **入口步骤存在** — 至少有一个 `dependId=0` 的步骤
3. **终止步骤存在** — 至少有一个 `nextStepId=0` 的步骤
4. **引用有效性** — `dependId`/`nextStepId`/`failStepId` 引用的 stepId 必须存在
5. **描述非空** — 每个步骤的 `taskDescription` 不能为空字符串
