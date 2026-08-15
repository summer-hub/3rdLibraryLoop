# 验收标准编写指南

> 如何生成高质量、可验证的验收标准。验收标准是 task-analysis SKILL 的核心产出，直接影响后续 TestCheck 准出审核的准确性。

---

## 1. 核心原则

> **每条标准必须能通过检查文件、执行命令或人工审查来判定 pass/fail。**

- ❌ `"分析完成"` — 无法判定"完成"的定义
- ❌ `"代码质量好"` — "好"是主观的
- ✅ `"分析报告文件已生成且非空（≥1KB）"` — 可检查文件大小
- ✅ `"扫描覆盖率 ≥ 80%"` — 可执行命令获取数值

---

## 2. type 分类

| type | 说明 | 验证方式 | 示例 |
|------|------|----------|------|
| `output` | 产物检查 — 文件/内容是否存在、是否完整 | 检查文件存在性、大小、格式 | "分析报告 JSON 文件已生成且可解析" |
| `quality` | 质量要求 — 产物质量是否达标 | 内容审查、规则匹配 | "报告覆盖所有关键维度（intent/domain/keywords）" |
| `performance` | 性能指标 — 定量指标 | 执行命令获取数值 | "扫描覆盖率 ≥ 80%" |
| `compliance` | 合规性 — 是否符合规范 | 规范比对、lint 检查 | "代码符合 ArkTS 编码规范（无 arkts-no-any 错误）" |

---

## 3. 数量与覆盖

- **数量**：通常 3-8 条
- **覆盖维度**：
  - 至少 1 条 `output` 类型（确保有产物）
  - 至少 1 条 `quality` 或 `compliance` 类型（确保质量）
  - 高性能要求任务加 `performance` 类型
- **不宜过多**：超过 8 条会稀释重点，增加审核成本
- **不宜过少**：少于 3 条可能遗漏关键维度

---

## 4. verification 字段编写

`verification` 描述**如何验证**该标准是否满足，应包含具体的验证方法：

### 好的 verification

```
"检查 {workDir}/analysis-report.json 文件是否存在且 JSON.parse 成功"
```

```
"执行 hosauri lint，检查 arkts-no-any-unknown 错误数为 0"
```

```
"读取报告 JSON，确认 acceptanceCriteria 数组长度 ≥ 3"
```

### 差的 verification

```
"人工检查"          — 太模糊，无法自动化
"确保质量"          — 同义反复
"检查是否完成"      — 没说怎么检查
```

---

## 5. 编写模式

### 5.1 产物检查模式

```
criterion: "{文件名} 已生成且 {条件}"
type: "output"
verification: "检查 {路径} 文件存在，且 {验证条件}"
```

### 5.2 覆盖率模式

```
criterion: "{指标} ≥ {阈值}"
type: "performance"
verification: "执行 {命令}，解析输出获取 {指标}，判断 ≥ {阈值}"
```

### 5.3 规范合规模式

```
criterion: "{产物} 符合 {规范名}"
type: "compliance"
verification: "运行 {lint/check工具}，检查 {规则} 错误数为 0"
```

### 5.4 内容完整性模式

```
criterion: "{产物} 包含 {必要内容列表}"
type: "quality"
verification: "读取 {产物}，逐项检查 {内容项} 均存在且非空"
```

---

## 6. 反模式

### 6.1 模糊标准

❌ `"任务完成"` → ✅ `"{具体产物} 已生成且通过 {具体检查}"`

### 6.2 不可验证的主观判断

❌ `"代码可读性好"` → ✅ `"代码通过 eslint 检查，复杂度 < 15"`

### 6.3 标准之间重叠

❌ 同时有 `"报告已生成"` 和 `"报告文件存在"` → 合并为一条

### 6.4 标准过严导致无法通过

- 不要把实现细节写进验收标准（如"必须使用某某算法"）
- 验收标准应关注 **结果**，不是 **过程**

### 6.5 标准过松导致形同虚设

- `"有输出文件"` 太松 → 补充 `"{文件} 非空且包含 {必要字段}"`

---

## 7. 重规划场景的特殊处理

重规划时，验收标准生成需要额外考虑：

### 7.1 调整已有标准

针对未满足的标准：
- 如果是 **验证方式不明确** → 重写 verification 使其更具体
- 如果是 **标准过严** → 适当降低阈值或拆分为多条
- 如果是 **标准过松** → 提高要求或补充条件

### 7.2 补充新标准

根据失败原因，补充覆盖上轮遗漏维度的标准。

### 7.3 保持目标一致

- **不修改任务目标** — 调整的是标准和策略
- 已通过的标准可保留（下游会重新审核全部标准）
- `failureAnalysis` 和 `adjustmentStrategy` 字段必须非空

---

## 8. 示例：完整验收标准集

以"鸿蒙 ArkTS 三方库内存泄漏检测"任务为例：

```json
[
  {
    "id": "ac1",
    "criterion": "内存泄漏分析报告 JSON 文件已生成且可解析",
    "type": "output",
    "verification": "检查 {workDir}/leak-analysis.json 存在，JSON.parse 成功"
  },
  {
    "id": "ac2",
    "criterion": "报告包含 intent、domain、keywords、techStack 字段且均非空",
    "type": "quality",
    "verification": "读取 JSON，逐字段检查存在性和非空"
  },
  {
    "id": "ac3",
    "criterion": "扫描覆盖目标库所有源文件（覆盖率 100%）",
    "type": "performance",
    "verification": "对比源文件列表与扫描结果，确认无遗漏"
  },
  {
    "id": "ac4",
    "criterion": "每个疑似泄漏点包含位置、类型、严重等级信息",
    "type": "quality",
    "verification": "读取报告中 leakPoints 数组，每条含 file/line/level 字段"
  },
  {
    "id": "ac5",
    "criterion": "分析结果符合 JSON 输出规范（纯 JSON、字段完整）",
    "type": "compliance",
    "verification": "运行 validate-output.sh 校验脚本，检查通过"
  }
]
```
