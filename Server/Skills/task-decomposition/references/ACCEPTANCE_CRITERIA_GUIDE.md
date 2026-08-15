# 验收标准编写指南

> 如何生成高质量、可验证的步骤级验收标准。步骤级验收标准是 task-decomposition SKILL 的核心产出之一，直接影响 AcceptanceCheckSkill 的准出评估准确性。

---

## 1. 核心原则

> **每条标准必须能通过检查文件、执行命令或人工审查来判定 pass/fail。**

- ❌ `"分析完成"` — 无法判定"完成"的定义
- ❌ `"代码质量好"` — "好"是主观的
- ✅ `"分析报告文件 analysis-report.md 已生成且非空（≥1KB）"` — 可检查文件大小
- ✅ `"编译无 error 级别错误"` — 可执行编译命令检查

---

## 2. type 分类

| type | 说明 | 验证方式 | 示例 |
|------|------|----------|------|
| `output` | 产物检查 — 文件/内容是否存在、是否完整 | 检查文件存在性、大小、格式 | "分析报告文件已生成且可解析" |
| `quality` | 质量要求 — 产物质量是否达标 | 内容审查、规则匹配 | "报告覆盖所有关键维度" |
| `performance` | 性能指标 — 定量指标 | 执行命令获取数值 | "扫描覆盖率 ≥ 80%" |
| `compliance` | 合规性 — 是否符合规范 | 规范比对、lint 检查 | "代码符合 ArkTS 编码规范" |

---

## 3. ID 命名规则

步骤级验收标准的 ID 格式为 `ac{stepId}_{序号}`：

| 步骤 | 序号 | ID |
|------|------|----|
| 步骤1 | 第1条 | `ac1_1` |
| 步骤1 | 第2条 | `ac1_2` |
| 步骤2 | 第1条 | `ac2_1` |
| 步骤3 | 第3条 | `ac3_3` |

---

## 4. taskACIds 追溯字段

`taskACIds` 建立步骤级标准 → 任务级标准的追溯关系：

```json
{
  "id": "ac1_1",
  "criterion": "分析报告文件 analysis-report.md 已生成且非空",
  "type": "output",
  "verification": "检查 ${taskDir}/analysis-report.md 文件是否存在且文件大小 > 0",
  "taskACIds": ["ac1"]
}
```

**设计意图**：合并所有步骤的 `taskACIds` 后，应覆盖所有任务级 AC 的 ID。

### 覆盖校验

```
任务级 AC: ac1, ac2, ac3, ac4

步骤1 AC.taskACIds: ["ac1", "ac2"]     → 覆盖 ac1, ac2
步骤2 AC.taskACIds: ["ac2", "ac3"]     → 覆盖 ac2, ac3
步骤3 AC.taskACIds: ["ac3", "ac4"]     → 覆盖 ac3, ac4

合并覆盖: ac1, ac2, ac3, ac4 ✅ 全覆盖
```

> 允许一条步骤级 AC 关联多个任务级 AC（如上例 ac2_1 同时关联 ac2 和 ac3）。
> 也允许多条步骤级 AC 关联同一个任务级 AC（不同步骤从不同角度验证同一任务级标准）。

---

## 5. 每条标准必含字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 格式 `ac{stepId}_{序号}` |
| `criterion` | ✅ | 具体标准描述，非空，可验证 |
| `type` | ✅ | `output`/`quality`/`performance`/`compliance` |
| `verification` | ✅ | 验证方式（具体到可执行命令或检查方法） |
| `taskACIds` | ✅ | 关联的任务级标准 ID 列表（如 `["ac1"]`） |

---

## 6. 编写模式

### 6.1 产物检查模式

```
criterion: "{文件名} 已生成且 {条件}"
type: "output"
verification: "检查 {路径} 文件存在，且 {验证条件}"
taskACIds: ["ac1"]
```

### 6.2 覆盖率模式

```
criterion: "{指标} ≥ {阈值}"
type: "performance"
verification: "执行 {命令}，解析输出获取 {指标}，判断 ≥ {阈值}"
taskACIds: ["ac3"]
```

### 6.3 规范合规模式

```
criterion: "{产物} 符合 {规范名}"
type: "compliance"
verification: "运行 {lint/check工具}，检查 {规则} 错误数为 0"
taskACIds: ["ac2"]
```

### 6.4 内容完整性模式

```
criterion: "{产物} 包含 {必要内容列表}"
type: "quality"
verification: "读取 {产物}，逐项检查 {内容项} 均存在且非空"
taskACIds: ["ac1", "ac4"]
```

---

## 7. 好的验收标准示例

```json
{
  "id": "ac1_1",
  "criterion": "分析报告文件 analysis-report.md 已生成且非空",
  "type": "output",
  "verification": "检查 ${taskDir}/analysis-report.md 文件是否存在且文件大小 > 0",
  "taskACIds": ["ac1"]
}
```

```json
{
  "id": "ac2_1",
  "criterion": "编译无 error 级别错误，warning 数量 ≤ 10",
  "type": "compliance",
  "verification": "执行编译命令，检查 stderr 中无 'error' 关键字，统计 'warning' 出现次数 ≤ 10",
  "taskACIds": ["ac2", "ac3"]
}
```

---

## 8. 差的验收标准示例

```json
{
  "id": "ac1_1",
  "criterion": "分析完成"
}
```

**问题**：无法验证、缺少 type/verification/taskACIds 字段。

```json
{
  "criterion": "代码质量好",
  "type": "quality",
  "verification": "人工检查"
}
```

**问题**：标准模糊、验证方式不可自动化、缺少 id 和 taskACIds。

---

## 9. 数量建议

- 每个步骤通常 1-3 条验收标准
- 关键步骤可增加到 3-5 条
- 简单步骤（如报告生成）1 条即可
- 总数不宜过多，避免审核成本过高
