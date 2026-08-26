---
name: task-decomposition
description: 将自然语言任务描述拆解为多个可独立执行的步骤，生成包含依赖关系的步骤图与步骤级验收标准。当需要将一个复杂的高层任务分解为 Orchestrator 可执行的结构化步骤列表时使用此技能。适用于 AI Loop 系统中 Brain 模块的任务拆解阶段，支持首轮拆解与重规划场景。关键词：步骤拆解、依赖图、验收标准、task-planning。
license: Apache-2.0
compatibility: 由 Brain 模块通过 opencode CLI 调用（SkillExecutor），或降级为直接 LLM 调用。需要写入权限到任务工作目录，输出纯 JSON 格式拆解结果。
metadata:
  author: LoopEngine
  version: "2.3.0"
  category: task-planning
  language: natural-language
  invoked-by: DecompositionStrategies._decomposeViaCLI / _decomposeWithContextViaCLI
  consumed-by: DecompositionStrategies.normalizeSteps → Brain.taskDef → Orchestrator.loadTask（步骤的 specifiedSkill 透传至 FlexRunner）
  upstream: task-analysis（提供 intent/domain/techStack/estimatedSteps/acceptanceCriteria）
  downstream: Orchestrator（调度步骤图，步骤经 specifiedSkill 显式绑定执行 SKILL）、TestCheck（消费任务级验收标准）、acceptance-check（消费步骤级产物）
---

# 任务拆解技能

本技能通过 LLM 将自然语言任务描述拆解为多个可独立执行的步骤，生成包含依赖关系的步骤图与步骤级验收标准，供 Orchestrator 编排器调度执行。

> ⚠️ **核心原则：每个步骤只做一件可独立完成、可验证的事，步骤描述包含足够技术细节。输出必须为纯 JSON。** 步骤描述面向任务本身（做什么/预期输出）；当步骤职责与可用 SKILL 匹配时，通过 `specifiedSkill` 字段显式绑定（不在描述文本中写推荐语），技术细节由 SKILL 承载。拆解是设计活动而非研究活动：拆解输入只消费 prompt 注入的任务描述、分析结果与验收标准。

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
- `## 任务分析结果` — task-analysis SKILL 输出（intent/domain/keywords/constraints/techStack/complexity/estimatedSteps）
- `## 验收标准` — 任务级验收标准列表（`[ac1] (type) criterion → 验证: verification`）
- 重规划时额外注入：`## 重规划上下文` / `## 上一轮审核摘要` / `## 未满足的验收标准` / `## 改进建议` / `## 重拆解要求`

> 可用执行 SKILL 列表**不通过 prompt 注入**：由本 SKILL 的脚本在拆解时实时扫描获取（见 Phase 1.5），保证 SKILL 注册表的单一事实源在 SKILL 内的脚本，系统侧不硬编码。

> 完整调用链路与消费方式参见 [集成上下文说明](references/INTEGRATION_CONTEXT.md)

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskDescription` | string | ✅ | 自然语言任务描述（由调用方通过 prompt 注入） |
| `analysis` | object | ✅ | task-analysis SKILL 输出（intent/domain/keywords/constraints/techStack/complexity/estimatedSteps/acceptanceCriteria） |
| `resultFilePath` | string | ✅ | 拆解结果 JSON 输出路径（由调用方指定） |
| `context` | object | ❌ | 重规划上下文（仅重规划时提供，含 failedCriteria、improvementSuggestions、prevCheckSummary、loopCount 等） |
| `skillDirectory` | string | ❌ | SKILL 根目录路径（覆盖可用 SKILL 扫描脚本的默认根目录，调用方通过 `## SKILL 目录` 注入） |

---

## 输入依赖

- **前置 SKILL**：`task-analysis`（提供任务分析结果，含 intent/domain/techStack/estimatedSteps/acceptanceCriteria）
- **输入文件**：无（任务描述与分析结果通过 prompt 注入）
- **下游 SKILL**：各执行类 SKILL（步骤通过 `specifiedSkill` 字段显式绑定，未绑定的步骤由 SkillSelector 运行时按 taskDescription 自动匹配）

---

## 工作流程概览

```
Phase 1: 任务理解与分析结果解析
    ↓
Phase 2: 从产物逆向推导步骤图并构建依赖关系
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
| 版本号 | 所有 `\d+(\.\d+){1,3}` 格式的数字（支持 2-4 段式） | `0.82`, `0.84`, `7.88.0` |
| 分支名 | `br_` 前缀的标识符 | `br_rnoh0.82` |
| 仓库 URL | `https://` 开头的完整 URL | `https://gitcode.com/CPF-RN/rntpc_react-native-pager-view/tree/br_rnoh0.82` |
| 库名 | 任务描述中的三方库名称 | `rntpc_react-native-pager-view` |

提取的参数写入输出 JSON 的 `keyParameters` 字段（结构见 Phase 4.2）。生成步骤描述时，涉及上述参数的位置必须从 `keyParameters` 中取值，不得从记忆中重新生成。

> ⚠️ **高频错误案例**：任务描述中源分支为 `br_rnoh0.82`（版本 `0.82`），但 LLM 在步骤描述中臆造为 `br_rnoh0.72`（版本 `0.72`）。这类版本号/分支名篡改会导致后续所有步骤执行完全错误，且现有结构校验无法发现。`keyParameters` 字段 + `validate-param-consistency.cjs` 脚本用于强制拦截此类错误。

### 1.5 获取可用 SKILL 列表

步骤与执行 SKILL 的绑定依赖**实时扫描**的可用 SKILL 列表（单一事实源：SKILL 根目录下各 SKILL.md 的 frontmatter，由本 SKILL 内的脚本提供，系统侧不硬编码、不预置）。**拆解时必须先运行以下脚本获取列表**：

```bash
node {SKILL目录}/scripts/list-available-skills.cjs --format compact
```

> `compact` 格式每 SKILL 一行（description 压缩为单行并截断 60 字符），输出体积小、可直接内联读取，足以完成步骤与 SKILL 的匹配；仅当某 SKILL 的职责边界无法从截断描述判断时，再运行 `--format list` 查看完整描述。

脚本行为：
- 扫描 SKILL 根目录（默认脚本所在目录的上上级，即 Skills 根目录）下所有含 SKILL.md 的一级子目录
- 读取各 SKILL.md frontmatter 的 `name` / `description`，按 `- name（目录名）: description` 每行一个输出
- **黑名单过滤**：命中 `scripts/skill-blacklist.json`（默认排除编排层/元技能：task-analysis、task-decomposition、acceptance-check、skill-generator、knowledge-import——它们由 Brain/LoopEngine 按固定链路调用，不应被步骤引用）、`--exclude` 参数或环境变量 `SKILL_BLACKLIST` 的 SKILL 会被跳过

> **`specifiedSkill` 的合法取值只能来自该脚本实时返回的列表**，由 `validate-specified-skills.cjs` 强制校验（校验脚本同样实时扫描，不读取任何缓存或预置清单）。

---

## Phase 2：从产物逆向推导步骤图并构建依赖关系

### 2.0 拆解认知方法论：从产物逆向推导步骤图

拆解的正确起点是**任务级验收标准定义的最终交付物**，而非对问题域的研究。步骤图的推导路径：

```
最终交付物（任务级 AC 定义的报告/代码/测试结果）
    ↓ 逆向拆解：产出它需要哪些前置产物？
中间产物层（分析记录 / 编译产物 / 测试结果 / 变更清单…）
    ↓ 每个产物节点 = 一个步骤
外部输入层（源码仓库 / 环境 / Issue 信息…）
```

产物依赖树的构建不依赖问题域知识细节，拆解输入完全来自 prompt 注入的文本，无需检索补充。

#### 原则 1：产物逆向分解

从任务级 AC 提取最终产物，逆向回答"产出它需要什么前置产物"，逐层下探直到外部输入。**每个产物节点对应一个步骤，产物依赖关系天然构成步骤图**，步骤数自然与 `estimatedSteps` 对齐。

以 bug 根因分析任务为例（AC 要求产出含五个章节的根因分析报告）：

```
浅拷贝源码 → Issue事实与调用链 → NAPI层行为事实 → 连接认证流程事实 → 根因结论+调试方法 → 根因分析报告
   步骤1          步骤2               步骤3               步骤4                步骤5             步骤6
```

#### 原则 2：信息时序分层

步骤描述中的技术断言（文件路径、函数名、行为结论）只能来源于 prompt 已注入的信息：任务描述、任务分析结果、验收标准、重规划上下文。拆解期未经验证的结论不得写成事实，应降级为探索目标。

写完每步自检：**"这个技术断言的出处是 prompt 的哪一段？"** 找不到出处即改写为探索目标。

#### 原则 3：探索型步骤容纳不确定性

拆解时"不知道 X 的具体行为"是正常且预期的。正确姿势是用**结构**容纳不确定性，由执行步骤去消解：

- **分析范围**：从任务描述给出的代码位置/库名取值（如 "ohos_ssh 库的 ArkTS 层与 NAPI C++ 层"）
- **问题清单**：该步骤要回答的问题（如 "凭据如何校验与保存？失败返回路径有哪些？回调错误码语义是什么？"）
- **产物结构**：记录文件必须包含的字段（如 "含调用链、错误码定义、回调回传机制三部分"）

对应地，探索型步骤的验收标准只描述产物结构（文件存在、非空、含哪些章节），不预设结论内容。

### 2.1 步骤粒度原则

步骤颗粒度决定 Orchestrator 的调度粒度与每步的执行聚焦度。遵循以下**通用拆分规则**，同时保持任务编排层与 SKILL 层的解耦（步骤描述只面向任务本身，不绑定具体 SKILL）：

#### 拆解数量基本原则：以最少充分步骤完成任务

步骤不是越多越好。拆解数量由**任务复杂度**决定，能以最少步骤覆盖全部任务级验收标准即为合适——每多一步都是 Orchestrator 的一次调度开销、上下文切换成本和潜在失败点。

**1. 复杂度分级定基准**（结合 `analysis.complexity` 与产物依赖树规模判断）：

| 复杂度 | 特征 | 步骤数基准 |
|--------|------|-----------|
| 简单 | 单一最终产物，无中间产物或仅一层（如信息问答、单点修复、小范围代码检视） | 1-3 步 |
| 中等 | 2-3 个独立中间产物，线性依赖链（如分析→修改→验证） | 3-5 步 |
| 复杂 | 多中间产物、并行分支或修复回路、跨层跨模块（如框架升级适配） | 5-8 步 |

超过 8 步通常意味着任务本身应拆分为多个任务，或存在过度拆解。

**2. 最少充分判定**：目标步骤数 = 覆盖全部任务级 AC 所需的最少独立产物数。每增加一步前自检：
- "这步的产物被哪个下游步骤或任务级 AC 消费？" —— 无消费者则并入相邻步骤
- "并入相邻步骤后，验收标准是否仍可独立验证？" —— 仍可验证则合并

**3. 凑数反模式**：
- ❌ 为对齐 `estimatedSteps` 而拆细——它是参考基准而非目标值
- ❌ 无独立产物的流程性步骤（如单独的"确认环境"、"整理思路"、"校验报告格式"）
- ❌ 为低概率失败预设修复步骤——按需用 `failStepId` 指回自身配合 `maxRetries` 重试即可

#### 通用拆分规则

1. **单一职责**：每个步骤只做"一件事"——一个可独立验证的产出或动作。若一个步骤蕴含多个独立产出（如"既分析源码又修改代码"），拆分为多个步骤。
2. **可验证**：每个步骤必须有可检查的产物或可执行命令来判定成败。无法验证的步骤需拆分，或补充明确验收标准。
3. **预估步数对齐**：步骤总数以 `analysis.estimatedSteps` 为参考基准（视为上限多于视为目标），实际取"覆盖全部任务级 AC 的最少独立产物数"，向下偏差是正常的。当任务命中领域模板时，以模板固化的步骤数为准（如 RN 三方库框架升级适配固定 6 步），不因 `estimatedSteps` 偏差而拆细或合并。
4. **过粗/过细判定**：
   - **过粗信号**：步骤描述含"同时/以及/并且"连接多个不相关任务，或蕴含多个独立产物 → 应拆分。
   - **过细信号**：步骤描述只有原子操作（如 `git clone`、`cd 目录`、`ls 查看文件`）→ 应合并为一个"获取源码并分析结构"步骤。

#### few-shot 示例

> 4 个正反例（过细/过粗/凑数式/合理）参见 [常见任务拆解模板](references/TASK_DECOMPOSITION_TEMPLATES.md) 的「颗粒度 few-shot 示例」章节。核心记忆点：
>
> - 原子操作（git clone / cd / ls）合并为一步
> - 一步含多个独立产出必须拆分
> - 简单任务单一产物时 1 步即可，estimatedSteps 是参考而非目标

#### 领域模板优先匹配

当任务描述的 `domain` 或 `keywords` 命中已知领域模板时（如 `harmonyos-porting` + `framework-upgrade` 命中「RN 三方库框架升级适配」模板），**优先使用模板的步骤图骨架**，结合当前任务的版本号/分支名/验收标准进行适配，而非从零设计步骤。领域模板已沉淀了该类任务的最佳实践步骤划分、AC 覆盖模式和参数提取规则。

> 通用颗粒度拆分规则与更多常见任务拆解模板（含 RN 三方库框架升级适配 6 步模板）参见 [常见任务拆解模板](references/TASK_DECOMPOSITION_TEMPLATES.md)。**匹配模板时先读该文件顶部的「模板索引」表**，命中后仅按起始行小范围读取对应模板段落，禁止通读全文。

### 2.2 依赖图字段

步骤间通过三个字段构成有向图：

```
dependId   → 当前步骤依赖的步骤，支持 number 或 number[]（0 或空数组 = 入口步骤，无前置依赖；
              -1 = 修复步骤哨兵，表示"仅由 failStepId 触发、无入口身份、无并行依赖"）
              · dependId: 2       单依赖（等价于 [2]）
              · dependId: [2,3,4] fan-in 聚合，需 2/3/4 全部完成才执行本步骤
              · dependId: -1      修复步骤（唯一进入条件是触发它的步骤失败），不能当作入口步骤
nextStepId → 成功后执行哪个步骤（0 = 终止，任务完成）
failStepId → 失败后跳转到哪个步骤（0 = 失败即终止）
```

> ⚠️ **修复步骤 dependId 必须设为 -1 哨兵**：被某步骤 `failStepId=B` 指向的修复步骤 B，其 `dependId` **必须设为 `-1`**，不能设为 0 或空。0 或空会被 Orchestrator / 校验脚本误判为"入口步骤"，导致 B 与任务入口一步骤并行启动、提前误执行。`dependId=-1` 明确表达"仅由 failStepId 触发、无入口身份、无并行依赖"。修复成功后通常用 B 的 `nextStepId` 指回触发它的步骤，配合 `maxRetries` 形成有限重试循环。（Brain 生成侧 `sanitizeFixChainDependId` 会自动将修复步骤的 dependId 规范化为 `-1`，LLM 原始输出无需手工设置此字段。）

### 2.3 图结构设计要点

- **入口步骤**：至少有一个 `dependId=0`（或 `dependId: []`）的步骤；`dependId=-1` 的修复步骤不计入入口
- **终止步骤**：至少有一个 `nextStepId=0` 的步骤
- **并行执行（fan-out）**：多个步骤的 `dependId` 指向同一步骤 → Orchestrator 并行执行
- **聚合执行（fan-in）**：某步骤需等待多个并行步骤全部完成再执行，用 `dependId: [a, b, c]` → 仅当 a/b/c 全部 COMPLETED 后本步骤才被激活
- **失败回退**：关键步骤设 `failStepId` 指向修复步骤（修复步骤 `dependId=-1`），修复成功后通过 `nextStepId` 重新指向原始步骤（有限重试循环）
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

#### 研究式 vs 设计式描述（高频反模式）

拆解阶段最易犯的错误是"研究式描述"：把需要执行期核实的行为预先写成事实（往往来自拆解时的检索或记忆）。一旦与实际代码不符，步骤描述本身就会误导执行者。

**研究式（错误，预写了未验证结论）：**
```
分析 SSH2Napi::SetUser 对空密码参数的校验与直接返回失败的行为，及其导致凭据未保存的影响
```

**设计式（正确，范围来自任务描述、目标来自验收标准）：**
```
分析 ohos_ssh 库 NAPI 层的凭据处理与客户端启动异步流程，识别全部失败返回路径与回调错误码
语义，输出 napi-layer-analysis.md（含调用链、错误码定义、回调回传机制三部分）
```

判断标准：描述中的路径/函数名/行为断言必须能在任务描述或分析结果中找到出处；找不到出处的，改写为"识别/梳理/确认"类探索目标。

#### 步骤的 SKILL 匹配与 specifiedSkill 标注

拆解时参考 Phase 1.5 获取的**可用 SKILL 列表**：当某步骤的职责与某个可用 SKILL 匹配（该 SKILL 的 description 覆盖此步骤的目标产出）时，在该步骤 JSON 中设置 `specifiedSkill` 字段，值为该 SKILL 的 `name` 或目录名。执行层（FlexRunner）收到 `specifiedSkill` 后将跳过自动匹配直接使用该 SKILL——因此**该字段是步骤与执行 SKILL 的唯一绑定方式，不要在 `taskDescription` 中追加"推荐使用 X SKILL 执行"之类的推荐文本**（旧模式已废止，由 `validate-specified-skills.cjs` 拦截）。

无匹配 SKILL 的步骤（如克隆仓库、设备部署等通用操作）不设置 `specifiedSkill`，`taskDescription` 仍需写明具体操作步骤。

#### 设置 specifiedSkill 时步骤描述精简规则

> ⚠️ **核心原则：设置了 `specifiedSkill` 的步骤，`taskDescription` 只需描述任务目标与关键参数（版本号/分支名/库名），技术执行细节由 SKILL 承载，不需要在步骤描述中重复。**

当某步骤绑定了 `specifiedSkill` 时，`taskDescription` 应遵循以下精简模式：

1. **一句话描述任务目标** — 做什么、预期产出是什么
2. **保留关键参数锚定** — 版本号、分支名、库名等 `keyParameters` 中的值必须出现（参数一致性校验要求）
3. **设置 `specifiedSkill` 字段** — 值必须来自可用 SKILL 列表，不在描述文本中出现任何推荐语
4. **不重复 SKILL 内的技术细节** — 如脚本名、编译步骤、适配层级、具体命令等，这些由 SKILL 自身描述

**精简前（错误：技术细节冗长 + 旧式推荐文本）：**
```
执行 detect-upstream-version.js 脚本识别鸿蒙化基线版本号与 npm 上游最新版本号，判定升级类型 A/B/C；
如为类型 A 使用 generate-diff.js 对比上游社区仓库两个版本标签（注意 --repo 必须是上游社区仓库 URL，
不是鸿蒙化仓库 URL）；如为类型 B 跳过 diff 生成，聚焦 RNOH 0.82→0.84 框架 API 变更对比；
执行 git ls-remote --heads 检查 br_rnoh0.84 分支是否存在，如无则标注需从 0.82 基线升级；
输出版本分析报告，包含 currentVersion、upstreamVersion、diffItems、风险等级字段。
推荐使用 rnoh-lib-version-diff SKILL 执行。
```

**精简后（正确：specifiedSkill 显式绑定）：**
```
taskDescription: 对 rntpc_react-native-netinfo 进行版本差异分析，对比 br_rnoh0.82 基线版本与 0.84 目标版本的差异，
                检查 br_rnoh0.84 分支是否存在，输出版本分析报告。
specifiedSkill: rnoh-lib-version-diff
```

> 未绑定 `specifiedSkill` 的步骤（如克隆仓库、设备部署等通用操作）仍需在 `taskDescription` 中写明具体操作步骤，因为这些操作没有 SKILL 承载细节。

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
      "specifiedSkill": "rnoh-lib-version-diff",
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

> `specifiedSkill` 为可选字段，由 Phase 2.4 的 SKILL 匹配产生：步骤职责与某个可用 SKILL 匹配时设置（值为该 SKILL 的 name 或目录名），未匹配时不设置或留空。值必须来自 Phase 1.5 的可用 SKILL 列表，由 `validate-specified-skills.cjs` 强制校验。

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
- ✅ `specifiedSkill`（可选）值必须来自可用 SKILL 列表（由 `validate-specified-skills.cjs` 强制校验）

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

> ⚠️ **效率纪律（硬性）**：校验规则以下文「参数一致性校验规则」「specifiedSkill 校验规则」「死锁校验规则」三节的文字规则为准，**禁止通读 scripts/ 下校验脚本源码**——脚本仅用于执行，规则语义已完整沉淀于本文件。仅当某项校验失败且下文规则无法定位原因时，才 grep 对应脚本的规则段落定位实现细节。

输出完成后，**必须**运行以下三套校验脚本，全部通过后方可提交：

```bash
# 1. 字段/引用/验收标准合规性校验
node scripts/validate-decomposition-output.cjs <resultFile>

# 2. 死锁/循环检测（必须通过，否则重拆解）
node scripts/validate-step-graph.cjs <resultFile>

# 3. 关键参数一致性校验（版本号/分支名篡改检测）
node scripts/validate-param-consistency.cjs <resultFile>

# 4. specifiedSkill 校验（引用的 SKILL 必须在可用列表中，且无旧式推荐文本）
node scripts/validate-specified-skills.cjs <resultFile>
```

> 四个脚本均为 Node.js（`.cjs`）实现，跨平台（Windows/macOS/Linux）可直接运行，仅需 Node.js 环境。

### 参数一致性校验规则（强制）

`validate-param-consistency.cjs` 会检测以下**参数篡改**，任一项不通过则脚本以非零码退出：

1. **`keyParameters` 缺失** — 输出 JSON 未包含 `keyParameters` 字段，或 `versionNumbers`/`branchNames` 子字段为空（当任务描述中含版本号/分支名时）
2. **步骤描述中的版本号不在 `keyParameters` 中** — 如步骤描述出现 `0.72` 但 `keyParameters.versionNumbers` 中无此值，判定为版本号臆造
3. **步骤描述中的分支名不在 `keyParameters` 中** — 如步骤描述出现 `br_rnoh0.72` 但 `keyParameters.branchNames` 中无此值，判定为分支名臆造
4. **`keyParameters` 中声明的参数在步骤中完全未引用** — 如 `keyParameters.versionNumbers` 含 `0.82` 但所有步骤描述中均未出现，判定为参数声明但未使用

> ⚠️ **强制要求**：若脚本 exit 非 0（检测到参数篡改），**必须对照原始任务描述修正 `keyParameters` 及相关步骤描述后重新生成 JSON，并重新运行校验，直至全部通过**。

### specifiedSkill 校验规则（强制）

`validate-specified-skills.cjs` 会实时扫描 SKILL 根目录（黑名单过滤后）作为合法集合，检测以下问题，任一项不通过则脚本以非零码退出：

1. **specifiedSkill 不在可用列表中** — 步骤引用了不存在的 SKILL（含黑名单中的编排层/元技能），判定为臆造引用。修正方式：运行 `node scripts/list-available-skills.cjs` 查看实时列表，对照修正
2. **旧式推荐文本残留** — `taskDescription` 中出现"推荐使用 X SKILL 执行"字样（旧模式已废止）。修正方式：删除该句，改为在步骤 JSON 中设置 `specifiedSkill` 字段

> ⚠️ **强制要求**：若脚本 exit 非 0，**必须修正 `specifiedSkill` 引用或移除旧式推荐文本后重新生成 JSON，并重新运行校验，直至全部通过**。

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

1. **每个步骤只做一件独立可验证的事** — 步骤描述面向任务本身（做什么/预期输出）；职责与可用 SKILL 匹配的步骤通过 `specifiedSkill` 字段显式绑定（跳过自动匹配），其余步骤由 SkillSelector 在运行时按 taskDescription 自动匹配
2. **验收标准必须可验证** — 避免模糊描述，verification 要具体到可执行
3. **依赖图不能有死循环** — failStepId 回退链必须有限，配合 maxRetries 控制；成功链/失败链/依赖环均会死锁。最终以 `node scripts/validate-step-graph.cjs <resultFile>` 校验结果为准，检测到死锁必须重拆解直至通过
4. **步骤级 AC 的 taskACIds 要覆盖任务级 AC** — 合并所有步骤的 taskACIds 应覆盖所有任务级标准 ID
5. **重规划时保持目标一致** — 调整的是步骤设计与验收标准，不是任务目标
6. **输出纯 JSON** — 下游有容错机制但应输出纯 JSON，不依赖容错
7. **步骤级 AC 实际由 acceptance-check SKILL 消费** — Orchestrator 仅消费图字段调度，步骤级 AC 通过产物文件传递给 acceptance-check SKILL 评估
8. **关键参数逐字保真** — 版本号、分支名、仓库 URL、库名等关键参数必须从任务描述中原样提取到 `keyParameters`，步骤描述中引用时必须与 `keyParameters` 一致。LLM 生成时易将版本号臆造为相似但错误的值（如 `0.82`→`0.72`），由 `validate-param-consistency.cjs` 强制拦截
9. **步骤与执行 SKILL 通过 specifiedSkill 字段绑定** — 职责与可用 SKILL 匹配的步骤设置 `specifiedSkill`（值必须来自 Phase 1.5 实时扫描的可用 SKILL 列表），执行层 FlexRunner 将跳过自动匹配直接使用该 SKILL；
10. **拆解是设计不是研究** — 拆解输入只来自 prompt 注入文本，不通过克隆仓库、读源码、拉 Issue 等检索补充；步骤描述只写有 prompt 出处的断言，其余表达为探索目标（见 Phase 2.0 三原则）
11. **最少充分步骤** — 步骤数由任务复杂度决定（简单 1-3 步 / 中等 3-5 步 / 复杂 5-8 步），以覆盖全部任务级 AC 的最少独立产物数为目标，禁止凑数式拆解（见 Phase 2.1 拆解数量基本原则）