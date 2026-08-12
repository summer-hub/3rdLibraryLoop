---
name: task-decomposition
description: 将自然语言任务描述拆解为多个可独立执行的步骤，生成包含依赖关系的步骤图与步骤级验收标准。当需要将一个复杂的高层任务分解为 Orchestrator 可执行的结构化步骤列表时使用此技能。适用于 AI Loop 系统中 Brain 模块的任务拆解阶段，支持首轮拆解与重规划场景。关键词：步骤拆解、依赖图、验收标准、task-planning。
license: Apache-2.0
compatibility: 由 Brain 模块通过 opencode CLI 调用（SkillExecutor），或降级为直接 LLM 调用。需要写入权限到任务工作目录，输出纯 JSON 格式拆解结果。
metadata:
  author: LoopEngine
  version: "2.0.0"
  category: task-planning
  language: natural-language
  invoked-by: DecompositionStrategies._decomposeViaCLI / _decomposeWithContextViaCLI
  consumed-by: DecompositionStrategies.normalizeSteps → Brain.taskDef → Orchestrator.loadTask
  upstream: TaskAnalysisSkill（提供 intent/domain/techStack/estimatedSteps/acceptanceCriteria）
  downstream: Orchestrator（调度步骤图）、TestCheck（消费任务级验收标准）、AcceptanceCheckSkill（消费步骤级产物）
---

# 任务拆解技能

本技能通过 LLM 将自然语言任务描述拆解为多个可独立执行的步骤，生成包含依赖关系的步骤图与步骤级验收标准，供 Orchestrator 编排器调度执行。

> ⚠️ **核心原则：每个步骤只做一件可独立完成、可验证的事，步骤描述包含足够技术细节。输出必须为纯 JSON。** 拆解层与 SKILL 层解耦，步骤描述面向任务本身，不绑定具体 SKILL。

---

## 调用方式

本 SKILL 由 Brain 模块的 `DecompositionStrategies` 调用，通过 `SkillExecutor.invokeSkill` 执行：

- **首轮拆解**：`DecompositionStrategies._decomposeViaCLI(taskDescription, analysis, skillDir, userCriteria, execCtx)`
- **重规划拆解**：`DecompositionStrategies._decomposeWithContextViaCLI(taskDescription, analysis, skillDir, userCriteria, context, execCtx)`

调用方构建以下 prompt 段落传入：
- `## SKILL 目录` — 本 SKILL 目录路径（opencode 读取 SKILL.md 执行）
- `## 工作目录` — 任务工作目录
- `## 结果文件输出路径` — JSON 输出路径（`brain_decomposition_loop{N}.json`）
- `## 任务描述` — 自然语言任务描述
- `## 任务分析结果` — TaskAnalysisSkill 输出（intent/domain/keywords/constraints/techStack/complexity/estimatedSteps）
- `## 验收标准` — 任务级验收标准列表（`[ac1] (type) criterion → 验证: verification`）
- 重规划时额外注入：`## 重规划上下文` / `## 上一轮审核摘要` / `## 未满足的验收标准` / `## 改进建议` / `## 重拆解要求`

> 完整调用链路与消费方式参见 [集成上下文说明](references/INTEGRATION_CONTEXT.md)

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskDescription` | string | ✅ | 自然语言任务描述（由调用方通过 prompt 注入） |
| `analysis` | object | ✅ | TaskAnalysisSkill 输出（intent/domain/keywords/constraints/techStack/complexity/estimatedSteps/acceptanceCriteria） |
| `resultFilePath` | string | ✅ | 拆解结果 JSON 输出路径（由调用方指定） |
| `context` | object | ❌ | 重规划上下文（仅重规划时提供，含 failedCriteria、improvementSuggestions、prevCheckSummary、loopCount 等） |
| `skillDirectory` | string | ❌ | SKILL 目录路径（用于参考已有 SKILL 列表，调用方通过 `## SKILL 目录` 注入） |

---

## 输入依赖

- **前置 SKILL**：`TaskAnalysisSkill`（提供任务分析结果，含 intent/domain/techStack/estimatedSteps/acceptanceCriteria）
- **输入文件**：无（任务描述与分析结果通过 prompt 注入）
- **下游 SKILL**：各执行类 SKILL（由 Orchestrator 按步骤的 taskDescription 匹配调度）

---

## 工作流程概览

```
Phase 1: 任务理解与分析结果解析
    ↓
Phase 2: 步骤设计与依赖图构建
    ↓
Phase 3: 步骤级验收标准生成
    ↓
Phase 4: 结果输出（纯 JSON 写入 resultFilePath）
```

---

## Phase 1：任务理解与分析结果解析

### 1.1 解析任务描述

读取 `## 任务描述` 段落，理解任务的核心目标和预期产出。结合 `analysis.estimatedSteps` 作为步骤数量参考。

### 1.2 解析任务分析结果

读取 `## 任务分析结果` 段落，提取关键信息用于步骤设计：

| 字段 | 用途 |
|------|------|
| `intent` | 确保所有步骤围绕核心意图 |
| `domain` | 辅助判断任务所属领域，指导步骤设计 |
| `techStack` | 每个步骤的技术栈要与任务描述一致，便于后续匹配 |
| `estimatedSteps` | 步骤数量参考基准 |
| `acceptanceCriteria` | 步骤级验收标准需覆盖任务级标准 |

### 1.3 处理重规划上下文（如果提供）

如果 prompt 中包含 `## 重规划上下文` 段落，进入重规划模式：
- 读取 `## 未满足的验收标准` — 上一轮失败的标准及原因
- 读取 `## 改进建议` — 上一轮的改进方向
- 读取 `## 上一轮审核摘要` — 审核总结
- **保持原始任务目标不变**，调整步骤设计与验收标准
- 针对失败点强化步骤描述或新增验证步骤

> 详细处理流程参见 [重规划上下文处理指南](references/REPLAN_CONTEXT_GUIDE.md)

### 1.4 关键参数提取与锚定

在解析任务描述后，**必须**提取以下关键参数，并在后续步骤描述与验收标准中**逐字引用**原始值，不得改写、缩写或臆造：

| 参数类别 | 提取规则 | 示例 |
|----------|----------|------|
| 版本号 | 所有 `\d+\.\d+` 格式的数字 | `0.82`, `0.84` |
| 分支名 | `br_` 前缀的标识符 | `br_rnoh0.82` |
| 仓库 URL | `https://` 开头的完整 URL | `https://gitcode.com/CPF-RN/rntpc_react-native-pager-view/tree/br_rnoh0.82` |
| 库名 | 任务描述中的三方库名称 | `rntpc_react-native-pager-view` |

提取的参数写入输出 JSON 的 `keyParameters` 字段（结构见 Phase 4.2）。生成步骤描述时，涉及上述参数的位置必须从 `keyParameters` 中取值，不得从记忆中重新生成。

> ⚠️ **高频错误案例**：任务描述中源分支为 `br_rnoh0.82`（版本 `0.82`），但 LLM 在步骤描述中臆造为 `br_rnoh0.72`（版本 `0.72`）。这类版本号/分支名篡改会导致后续所有步骤执行完全错误，且现有结构校验无法发现。`keyParameters` 字段 + `validate-param-consistency.cjs` 脚本用于强制拦截此类错误。

---

## Phase 2：步骤设计与依赖图构建

### 2.1 步骤粒度原则

步骤颗粒度决定 Orchestrator 的调度粒度与每步的执行聚焦度。遵循以下**通用拆分规则**，同时保持任务编排层与 SKILL 层的解耦（步骤描述只面向任务本身，不绑定具体 SKILL）：

#### 通用拆分规则

1. **单一职责**：每个步骤只做"一件事"——一个可独立验证的产出或动作。若一个步骤蕴含多个独立产出（如"既分析源码又修改代码"），拆分为多个步骤。
2. **可验证**：每个步骤必须有可检查的产物或可执行命令来判定成败。无法验证的步骤需拆分，或补充明确验收标准。
3. **预估步数对齐**：步骤总数应与 `analysis.estimatedSteps` 对齐（作为参考基准，允许结合任务实际合理增减）。当任务命中领域模板时，以模板固化的步骤数为准（如 RN 三方库框架升级适配固定 6 步），不因 `estimatedSteps` 偏差而拆细或合并。
4. **过粗/过细判定**：
   - **过粗信号**：步骤描述含"同时/以及/并且"连接多个不相关任务，或蕴含多个独立产物 → 应拆分。
   - **过细信号**：步骤描述只有原子操作（如 `git clone`、`cd 目录`、`ls 查看文件`）→ 应合并为一个"获取源码并分析结构"步骤。

#### few-shot 示例

**示例 1（过细，错误）：**
```
将"获取源码并分析结构"拆成 4 个原子步骤
  ✗ 步骤: git clone
    步骤: cd 进入目录
    步骤: ls 查看文件
    步骤: cat README
改正 → 合并为一步: "获取 libcurl 源码并扫描其结构、依赖与构建系统，输出分析报告"
```

**示例 2（过粗，错误）：**
```
一步含多个独立产出
  ✗ 步骤: "分析源码、编译验证并生成最终报告"
改正 → 拆为三阶段:
  步骤1: 分析源码结构，输出分析报告
  步骤2: 鸿蒙化编译验证，输出编译结果
  步骤3: 汇总生成最终报告
```

**示例 3（合理，正确）：**
```
任务: 检视三方库代码质量（estimatedSteps=4）
  ✓ 步骤1: 克隆仓库并准备环境 (dependId=0)
    步骤2: 代码质量检视 (dependId=1)
    步骤3: 文档质量检视 (dependId=1，与步骤2并行)
    步骤4: 汇总检视结果生成报告 (dependId=[2,3], nextStepId=0)
```

#### 领域模板优先匹配

当任务描述的 `domain` 或 `keywords` 命中已知领域模板时（如 `harmonyos-porting` + `framework-upgrade` 命中「RN 三方库框架升级适配」模板），**优先使用模板的步骤图骨架**，结合当前任务的版本号/分支名/验收标准进行适配，而非从零设计步骤。领域模板已沉淀了该类任务的最佳实践步骤划分、AC 覆盖模式和参数提取规则。

> 通用颗粒度拆分规则与更多常见任务拆解模板（含 RN 三方库框架升级适配 6 步模板）参见 [常见任务拆解模板](references/TASK_DECOMPOSITION_TEMPLATES.md)

### 2.2 依赖图字段

步骤间通过三个字段构成有向图：

```
dependId   → 当前步骤依赖的步骤，支持 number 或 number[]（0 或空数组 = 入口步骤，无前置依赖）
              · dependId: 2       单依赖（等价于 [2]）
              · dependId: [2,3,4] fan-in 聚合，需 2/3/4 全部完成才执行本步骤
nextStepId → 成功后执行哪个步骤（0 = 终止，任务完成）
failStepId → 失败后跳转到哪个步骤（0 = 失败即终止）
```

> ⚠️ **修复链歧义约束**：若某步骤 A 的 `failStepId=B`（B 是 A 的修复步骤），建议 **B 的 `dependId` 不要再次指向 A**。B 的唯一进入条件是 A 失败（由 failStepId 边传递）；若 B 的 dependId 又声明 A，会形成失败链与依赖链的重叠边。Orchestrator 已能正确处理（A 成功时跳过 failStepId 目标、A 失败时跳过依赖聚合直接进入 B），但保持步骤图语义清晰仍是最佳实践：修复步骤的 dependId 只声明"修复所需、且非本修复目标"的其它已完成前置。

### 2.3 图结构设计要点

- **入口步骤**：至少有一个 `dependId=0`（或 `dependId: []`）的步骤
- **终止步骤**：至少有一个 `nextStepId=0` 的步骤
- **并行执行（fan-out）**：多个步骤的 `dependId` 指向同一步骤 → Orchestrator 并行执行
- **聚合执行（fan-in）**：某步骤需等待多个并行步骤全部完成再执行，用 `dependId: [a, b, c]` → 仅当 a/b/c 全部 COMPLETED 后本步骤才被激活
- **失败回退**：关键步骤设 `failStepId` 指向修复步骤，修复成功后重新指向原始步骤（有限重试循环）
- **禁止死循环**：failStepId 回退链必须是有限的，配合 `maxRetries` 控制

> 依赖图设计模式与示例参见 [依赖图设计指南](references/DEPENDENCY_GRAPH_GUIDE.md)

### 2.4 步骤描述规范

**好的描述：**
```
对 libcurl 源码进行鸿蒙化可行性分析：git clone 源码仓库，扫描源码结构、依赖、平台相关代码及构建系统，输出标准化分析报告（analysis-report.md）
```

**差的描述：**
```
分析代码
```

描述必须包含：具体操作（git clone/扫描/编译/测试）、操作对象（库名/文件路径）、预期输出（报告文件名/状态标记）。

#### RN 三方库框架升级适配的推荐 SKILL 标注

当任务命中「RN 三方库框架升级适配」领域模板时，每个步骤的 `taskDescription` 末尾应追加一句推荐执行 SKILL 的提示，格式为`推荐使用 {SKILL目录名} SKILL 执行。`。无对应专用 SKILL 的步骤（如克隆仓库、设备部署等通用操作）无需追加。已知映射：

| 步骤职责 | 推荐 SKILL | SKILL 说明 |
|----------|----------|----------|
| 版本差异分析 | `rnoh-lib-version-diff` | 版本分析与差异生成 |
| 代码适配与编译验证 | `rnoh-lib-code-adapt` | 代码适配与编译验证 |
| 测试对齐与补全 | `rnoh-lib-test-align` | 测试对齐与补全 |
| 功能测试总结 | `rnoh-lib-func-test` | 功能测试验证指引 |

#### 有推荐 SKILL 时步骤描述精简规则

> ⚠️ **核心原则：有推荐 SKILL 的步骤，`taskDescription` 只需描述任务目标与关键参数（版本号/分支名/库名），技术执行细节由 SKILL 承载，不需要在步骤描述中重复。**

当某步骤有对应的推荐 SKILL 时，`taskDescription` 应遵循以下精简模式：

1. **一句话描述任务目标** — 做什么、预期产出是什么
2. **保留关键参数锚定** — 版本号、分支名、库名等 `keyParameters` 中的值必须出现（参数一致性校验要求）
3. **末尾追加 SKILL 推荐** — `推荐使用 {SKILL目录名} SKILL 执行。`
4. **不重复 SKILL 内的技术细节** — 如脚本名、编译步骤、适配层级、具体命令等，这些由 SKILL 自身描述

**精简前（冗长，错误）：**
```
执行 detect-upstream-version.js 脚本识别鸿蒙化基线版本号与 npm 上游最新版本号，判定升级类型 A/B/C；
如为类型 A 使用 generate-diff.js 对比上游社区仓库两个版本标签（注意 --repo 必须是上游社区仓库 URL，
不是鸿蒙化仓库 URL）；如为类型 B 跳过 diff 生成，聚焦 RNOH 0.82→0.84 框架 API 变更对比；
执行 git ls-remote --heads 检查 br_rnoh0.84 分支是否存在，如无则标注需从 0.82 基线升级；
输出版本分析报告，包含 currentVersion、upstreamVersion、diffItems、风险等级字段。
推荐使用 rnoh-lib-version-diff SKILL 执行。
```

**精简后（正确）：**
```
对 rntpc_react-native-netinfo 进行版本差异分析，对比 br_rnoh0.82 基线版本与 0.84 目标版本的差异，
检查 br_rnoh0.84 分支是否存在，输出版本分析报告。推荐使用 rnoh-lib-version-diff SKILL 执行。
```

> 无推荐 SKILL 的步骤（如克隆仓库、设备部署等通用操作）仍需在 `taskDescription` 中写明具体操作步骤，因为这些操作没有 SKILL 承载细节。

---

## Phase 3：步骤级验收标准生成

### 3.1 生成原则

每个步骤**必须**包含 `acceptanceCriteria` 数组：
- **具体可验证**：每条标准能通过检查文件、执行命令或人工审查判定
- **覆盖任务级标准**：所有步骤的验收标准合并后应覆盖 `analysis.acceptanceCriteria`
- **与步骤产出对齐**：验收标准与该步骤的 taskDescription 预期输出对应
- **追溯性**：通过 `taskACIds` 标明该步骤标准对应哪个任务级标准

### 3.2 每条标准必含字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 格式 `ac{stepId}_{序号}`，如 `ac1_1`、`ac2_3` |
| `criterion` | ✅ | 具体标准描述，非空，可验证 |
| `type` | ✅ | `output`/`quality`/`performance`/`compliance` |
| `verification` | ✅ | 验证方式（具体到可执行命令或检查方法） |
| `taskACIds` | ✅ | 关联的任务级标准 ID 列表（如 `["ac1"]`） |

> 编写指南与示例参见 [验收标准编写指南](references/ACCEPTANCE_CRITERIA_GUIDE.md)

---

## Phase 4：结果输出

### 4.1 输出文件

将拆解结果以 **纯 JSON** 格式写入 `## 结果文件输出路径` 指定的路径。

### 4.2 JSON 结构

```json
{
  "keyParameters": {
    "versionNumbers": ["0.82", "0.84"],
    "branchNames": ["br_rnoh0.82"],
    "repoUrls": ["https://gitcode.com/CPF-RN/rntpc_react-native-pager-view/tree/br_rnoh0.82"],
    "libraryNames": ["rntpc_react-native-pager-view"]
  },
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

> `keyParameters` 为必填字段，由 Phase 1.4 从任务描述中提取。步骤描述中出现的所有版本号、分支名必须与 `keyParameters` 中的值一致，由 `validate-param-consistency.cjs` 强制校验。

> 完整输出示例参见 [输出示例](assets/OUTPUT_EXAMPLES.md)

**fan-in 聚合示例**（并行步骤 2/3/4 聚合到步骤 5）：

```json
{
  "steps": [
    { "stepId": 1, "taskDescription": "分析任务并产出输入", "dependId": 0, "nextStepId": 2, "failStepId": 0, "maxRetries": 3 },
    { "stepId": 2, "taskDescription": "并行检视：代码质量", "dependId": 1, "nextStepId": 5, "failStepId": 0, "maxRetries": 3 },
    { "stepId": 3, "taskDescription": "并行检视：稳定性", "dependId": 1, "nextStepId": 5, "failStepId": 0, "maxRetries": 3 },
    { "stepId": 4, "taskDescription": "并行检视：文档质量", "dependId": 1, "nextStepId": 5, "failStepId": 0, "maxRetries": 3 },
    { "stepId": 5, "taskDescription": "聚合三路检视结果并汇总报告", "dependId": [2, 3, 4], "nextStepId": 0, "failStepId": 0, "maxRetries": 3 }
  ]
}
```

- 步骤 5 的 `dependId: [2, 3, 4]` 表示需等待步骤 2/3/4 **全部 COMPLETED** 后才执行（fan-in 聚合）。
- 步骤 2/3/4 均 `dependId: 1`，由 Orchestrator 并行执行（fan-out）。

### 4.3 输出规范

- ✅ 纯 JSON（无 markdown 代码块标记，无注释，无前后缀文字）
- ✅ 合法可解析格式
- ✅ `keyParameters` 字段存在且 `versionNumbers`/`branchNames` 至少各含 1 项（当任务描述包含版本号/分支名时）
- ✅ `stepId` 从 1 递增，唯一
- ✅ `acceptanceCriteria[].id` 格式为 `ac{stepId}_{序号}`
- ✅ 所有字符串字段非空
- ✅ 步骤描述中出现的版本号/分支名与 `keyParameters` 一致（由 `validate-param-consistency.cjs` 强制校验）
- ✅ 重规划时 `stepId` 从 1 重新编号

---

## 重规划时的额外要求

当提供了 `context`（重规划场景）时，拆解需额外考虑：

1. **针对未满足的标准** — 调整相关步骤的任务描述，使其更明确
2. **增加验证步骤** — 强化对失败点的验证
3. **考虑改进建议** — 新增必要的步骤
4. **保持依赖关系合理** — 步骤间依赖关系需逻辑自洽
5. **步骤 ID 重新编号** — 从 1 开始重新编号

> 详细流程参见 [重规划上下文处理指南](references/REPLAN_CONTEXT_GUIDE.md)

---

## 自检

输出完成后，**必须**运行以下三套校验脚本，全部通过后方可提交：

```bash
# 1. 字段/引用/验收标准合规性校验
bash scripts/validate-decomposition-output.sh <resultFile>

# 2. 死锁/循环检测（必须通过，否则重拆解）
node scripts/validate-step-graph.cjs <resultFile>

# 3. 关键参数一致性校验（版本号/分支名篡改检测）
node scripts/validate-param-consistency.cjs <resultFile>
```

### 参数一致性校验规则（强制）

`validate-param-consistency.cjs` 会检测以下**参数篡改**，任一项不通过则脚本以非零码退出：

1. **`keyParameters` 缺失** — 输出 JSON 未包含 `keyParameters` 字段，或 `versionNumbers`/`branchNames` 子字段为空（当任务描述中含版本号/分支名时）
2. **步骤描述中的版本号不在 `keyParameters` 中** — 如步骤描述出现 `0.72` 但 `keyParameters.versionNumbers` 中无此值，判定为版本号臆造
3. **步骤描述中的分支名不在 `keyParameters` 中** — 如步骤描述出现 `br_rnoh0.72` 但 `keyParameters.branchNames` 中无此值，判定为分支名臆造
4. **`keyParameters` 中声明的参数在步骤中完全未引用** — 如 `keyParameters.versionNumbers` 含 `0.82` 但所有步骤描述中均未出现，判定为参数声明但未使用

> ⚠️ **强制要求**：若脚本 exit 非 0（检测到参数篡改），**必须对照原始任务描述修正 `keyParameters` 及相关步骤描述后重新生成 JSON，并重新运行校验，直至全部通过**。

### 死锁校验规则（强制）

`validate-step-graph.cjs` 会检测以下**死锁/循环**，任一项不通过则脚本以非零码退出：

1. **成功链环（nextStepId 成环）** — 如 `step4.nextStepId→step5`、`step5.nextStepId→step4`，成功后永远无法结束
2. **失败链环（failStepId 成环）** — 如 `A 失败→B`、`B 失败→A`，修复链无限回退（自身回退 `failStepId==自己` 配合 `maxRetries` 视为合法，不报错）
3. **依赖环（dependId 成环）** — 步骤互相依赖，拓扑无法启动
4. **不可达/孤立步骤** — 从入口沿 `nextStepId` 链无法到达的步骤，永远不会被执行
5. **成功链无终止** — 所有步骤 `nextStepId` 均非 0，无法结束

> ⚠️ **强制要求**：若脚本 exit 非 0（检测到上述任一问题），**必须修正步骤图的 `nextStepId`/`failStepId`/`dependId` 后重新生成 JSON，并重新运行校验，直至脚本全部通过**。不得提交含死锁的步骤图。

### 死锁反馈与自动重生成

若死锁校验未通过，执行以下**反馈驱动重生成循环**，将死锁链路径交给大模型自身推理修正：

1. **提取死锁反馈** — 读取 `validate-step-graph.cjs` 输出中的死锁链路径（如 `成功链环: 4 → 5 → 4`），将其作为"死锁反馈"写入当前工作上下文。
2. **判定类型与根因** — 逐条判定死锁类型（成功链环 / 失败链环 / 依赖环 / 孤立步骤 / 无终止），并定位根因字段（`nextStepId` / `failStepId` / `dependId`）。
3. **带着死锁反馈重新生成 JSON** — 依据任务目标重新设计步骤图，确保打破死锁的同时，步骤图仍能达成任务预期效果。重新生成而非在原 JSON 上局部修补。
4. **重新校验** — 重新运行 `node scripts/validate-step-graph.cjs <resultFile>`。
5. **循环 2-4** — 直至脚本全部 PASS；最多尝试 3 次，仍失败则报错并附最后一次死锁反馈。

死锁反馈必须保留在每一步骤的思考中，例如：
`已在上一轮检测到死锁: 成功链环 4 → 5 → 4，本次生成已将该环改写为 4 → 5 → 6(终止)`。

> 修正完全依靠大模型自身推理能力，不规定机械拆环手法，以确保步骤图仍能达成任务预期效果。

---

## 注意事项

1. **每个步骤只做一件独立可验证的事** — 任务编排层与 SKILL 层解耦，步骤描述面向任务本身（做什么/怎么做/预期输出），不绑定具体 SKILL；SkillSelector 在运行时负责将步骤匹配到执行 SKILL
2. **验收标准必须可验证** — 避免模糊描述，verification 要具体到可执行
3. **依赖图不能有死循环** — failStepId 回退链必须有限，配合 maxRetries 控制；成功链/失败链/依赖环均会死锁。最终以 `node scripts/validate-step-graph.cjs <resultFile>` 校验结果为准，检测到死锁必须重拆解直至通过
4. **步骤级 AC 的 taskACIds 要覆盖任务级 AC** — 合并所有步骤的 taskACIds 应覆盖所有任务级标准 ID
5. **重规划时保持目标一致** — 调整的是步骤设计与验收标准，不是任务目标
6. **输出纯 JSON** — 下游有容错机制但应输出纯 JSON，不依赖容错
7. **步骤级 AC 实际由 AcceptanceCheckSkill 消费** — Orchestrator 仅消费图字段调度，步骤级 AC 通过产物文件传递给 AcceptanceCheckSkill 评估
8. **关键参数逐字保真** — 版本号、分支名、仓库 URL、库名等关键参数必须从任务描述中原样提取到 `keyParameters`，步骤描述中引用时必须与 `keyParameters` 一致。LLM 生成时易将版本号臆造为相似但错误的值（如 `0.82`→`0.72`），由 `validate-param-consistency.cjs` 强制拦截
9. **RN 三方库升级步骤描述追加推荐 SKILL** — 当任务命中「RN 三方库框架升级适配」领域模板时，每个步骤的 `taskDescription` 末尾追加`推荐使用 {SKILL目录名} SKILL 执行。`，帮助 SkillSelector 更精准匹配执行 SKILL（详见 Phase 2.4）