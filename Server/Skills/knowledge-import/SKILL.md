---
name: knowledge-import
description: 将积累的知识经验导入到知识库和SKILL系统中，实现系统的自我迭代。调用MCP知识库工具新增知识条目，并定位关联的SKILL进行优化修改；问题案例类经验路由到 rn-library-issue-generalizer 泛化为检视规则入库（BadCase/rn）。当需要将某条已沉淀的经验知识正式导入到MCP知识库和SKILL体系时使用此技能。
license: Apache-2.0
compatibility: 需要MCP Gateway运行中（kb_add_document 工具 + kb-server 下游工具），需要文件读写权限到Server/Skills目录和经验文档路径。通过opencode CLI调用执行。
metadata:
  author: LoopEngine
  version: "1.1.0"
  category: meta-skill
  invoked-by: KnowledgeImportController.importKnowledge
  consumed-by: 系统自我迭代流程
---

# 知识导入技能

本技能用于将积累的知识经验正式导入到知识库系统和SKILL体系中，实现系统的自我迭代能力。它会读取经验文档，分析其内容类型，分别导入到知识库（MCP）和关联的SKILL（优化修改）。

> ⚠️ **核心原则**：
> 1. 导入前必须充分理解经验内容，知识类经验导入知识库，SKILL类经验优化对应SKILL。两类导入不可混淆，不可遗漏。
> 2. **SKILL修改必须审慎**：仅当经验内容**显式提及**某SKILL的执行流程问题时才进行修改。禁止基于主题相关性或语义推断来修改SKILL——主题相关不等于流程缺陷。
> 3. **知识库内容必须结构化整理**：禁止原封不动传入原始经验文档，必须按"问题现象/解决方案/结果"格式重新整合后导入。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `knowledgeId` | string | ✅ | 知识条目ID（kn_xxx），通过知识系统查询获取 |
| `docPath` | string | ✅ | 经验文档（.md）的绝对路径 |
| `skillDir` | string | ❌ | 关联的SKILL目录路径（知识条目中记录，可能为null） |
| `taskDescription` | string | ❌ | 来源任务描述（用于辅助内容分类） |
| `workDir` | string | ✅ | 工作目录（由调用方指定） |
| `resultFilePath` | string | ✅ | 结果文件输出路径（由调用方指定） |

---

## 输入依赖

- **前置 SKILL**：无。可独立调用。
- **输入文件**：经验文档（docPath 指向的 .md 文件）。
- **下游依赖**：MCP Gateway（提供 `kb_add_document` 和 `kb-server_*` 知识库工具）。

---

## 工作流程概览

```
Phase 1: 读取并分析经验文档
    ↓
Phase 2: 内容分类（知识类 / SKILL类 / 问题案例类）
    ↓
Phase 3: 知识类导入 → 调用 MCP 知识库
    ↓
Phase 4: SKILL类导入 → 定位并优化对应 SKILL
    ↓
Phase 4.5: 问题案例类导入 → 调用 rn-library-issue-generalizer 泛化入库
    ↓
Phase 5: 输出导入结果
```

---

## Phase 1：读取并分析经验文档

### 1.1 读取经验文档

读取 `docPath` 指向的 .md 文件完整内容。

> ⚠️ 文件不存在时，在结果文件中记录错误状态，标记为 `失败`。

### 1.2 提取经验结构

分析经验文档的 Markdown 结构，提取以下要素：

| 要素 | 说明 | 示例 |
|------|------|------|
| 标题 | 文档主标题 | "搜索 ohpm 仓库 Lottie 动画库的经验沉淀" |
| 关键发现 | 具体技术发现、API行为、平台差异 | API端点、参数说明、返回格式 |
| 踩坑记录 | 遇到的具体问题及解决方案 | 限流问题、搜索语法陷阱 |
| 可复用建议 | 面向未来同类任务的推荐策略 | 搜索策略推荐、注意事项 |

### 1.3 提取元信息

从任务参数中获取辅助信息：
- `taskDescription` — 原始任务描述，用于理解经验产生的上下文
- `skillDir` — 知识条目中记录的关联SKILL目录（可能为null，表示经验产生时未匹配到SKILL）

---

## Phase 2：内容分类

### 2.1 分类标准

将经验文档中的内容分为三类：

| 类别 | 判断标准 | 导入目标 |
|------|----------|----------|
| **知识类** | 通用的技术发现、API行为、平台差异、最佳实践、踩坑记录等可被检索复用的知识 | MCP 知识库 |
| **SKILL类** | 经验内容**显式提及**某SKILL的执行流程存在缺陷、遗漏或可优化（如"XX步骤应增加YY检查"、"SKILL缺少ZZ步骤"） | 对应 SKILL 文件 |
| **问题案例类** | 经验内容包含**具体库的具体问题**：问题现象 + 根因 + 修复方式（含修复 PR/commit 链接），且问题模式可能复现于其他库 | `rn-library-issue-generalizer` 泛化入库（BadCase/rn） |

> ⚠️ **问题案例类判断标准**（需同时满足）：
> 1. **具体库**：明确提及某个三方库名称（如 react-native-webview）
> 2. **具体问题**：描述了可复现的问题现象（非泛泛的最佳实践）
> 3. **有修复证据**：包含修复 PR/commit 链接，或文档中有明确的错误代码→正确代码对照
>
> **路由规则**：命中问题案例类的内容**不进 MCP 知识库**，改由 `rn-library-issue-generalizer` SKILL 泛化为机制层规则写入 `BadCase/rn/`（draft 状态，人工审核后激活）。泛化调用参数：`issueList` = `[{"description": "问题现象", "prUrl": "修复PR链接"}]`，`knowledgeDir` = `BadCase/rn` 绝对路径。
> 一条经验可同时含多类内容：案例部分走泛化，其余走知识类/SKILL类原有路径。

> ⚠️ **SKILL类判断门槛**：内容必须同时满足两个条件才算SKILL类：
> 1. **显式指向**：经验中明确提及了SKILL名称、步骤名、或具体流程环节（不是仅提及相关技术领域）
> 2. **流程缺陷**：内容指出该流程环节存在具体问题（遗漏、错误、可改进），而非仅仅是领域知识
>
> **反面示例**（以下不算SKILL类）：
> - "Hypium与arkXtest完全独立" — 这是技术知识，未指出任何SKILL的流程问题
> - "版本标注需同时关注两套体系" — 这是技术建议，未指出SKILL步骤缺陷
> - "devecocli docs search中文关键词不稳定" — 这是工具踩坑，不是SKILL流程问题

### 2.2 分类方法

逐段分析经验文档内容，判断每段属于知识类还是SKILL类：

- **"关键发现"段落** → 通常为知识类（记录技术事实）
- **"踩坑记录"段落** → 兼具两类：
  - 技术层面的坑（API限制、平台行为）→ 知识类
  - 执行流程层面的坑（**仅当显式指出**"SKILL的XX步骤遗漏了YY"）→ SKILL类
- **"可复用建议"段落** → 兼具两类：
  - 技术策略建议 → 知识类
  - 流程改进建议（**仅当显式表述**"SKILL应增加xxx步骤"）→ SKILL类

> ⚠️ **默认归属**：当一段内容难以明确判断为SKILL类时，默认归为知识类。宁可多导入知识库，不可误修改SKILL。

### 2.3 确定SKILL关联

如果经验文档中**确实包含SKILL类内容**（通过2.1的严格判断），需要确定关联的SKILL：

1. **优先使用参数中的 `skillDir`** — 知识条目记录的关联SKILL目录
2. **若无 skillDir** — 从经验内容中寻找**显式提及**的SKILL名称或步骤：
   - 经验内容直接提到某SKILL的name → 使用该SKILL
   - 经验内容直接提到某SKILL的具体步骤名 → 查找包含该步骤的SKILL
   - **禁止仅凭主题关键词重叠来推断关联**（如经验提到"测试"就关联所有测试类SKILL）

> ⚠️ **无显式证据时**：如果经验内容未显式提及任何SKILL名称或步骤名，即使主题与某些SKILL相关，也**不进行SKILL修改**，所有内容归为知识类导入知识库。

> 详细SKILL定位方法参见 [SKILL定位指南](references/SKILL_LOCATOR_GUIDE.md)

---

## Phase 3：知识类导入 → 调用 MCP 知识库

### 3.0 MCP 工具可用性检查

在导入前，先确认 MCP Gateway 和 `kb_add_document` 工具可用：

1. 调用 `gateway_health` 检查 Gateway 运行状态
2. 调用 `gateway_list_tools` 确认 `kb_add_document` 在工具列表中

> ⚠️ 若 `kb_add_document` 不可用（MCP Gateway 未配置或未启动），知识类导入标记为跳过，在结果文件中记录原因。SKILL类导入（如有）继续执行。需提醒用户配置 MCP Gateway 后重新执行。

### 3.1 构建知识库文档（内容结构化整理）

**禁止原封不动传入原始经验文档**。必须将知识类内容按以下结构重新整理：

```
## {经验条目标题}

### 问题现象
{描述遇到的具体问题、困惑或错误表现}

### 解决方案
{描述如何解决该问题，包括具体方法、命令、配置等}

### 结果
{描述解决后的效果、验证方式或可复用的结论}
```

**整理规则**：
- 将原始文档中的"关键发现""踩坑记录""可复用建议"拆解为独立的经验条目
- 每个条目聚焦一个问题，按"问题现象 → 解决方案 → 结果"三段式重组
- 去除与问题无直接关联的背景描述，保留可复用的核心信息
- 多个独立问题拆分为多个条目，用 `---` 分隔

**文档ID生成规则**：
```
experiences/{知识总结}
```
其中 `{知识总结}` 是对该条知识内容的简明概括，用于生成可读的文档文件名。

**生成要求**：
- 从经验内容中提炼核心主题，生成简短的描述性名称
- 使用中划线（`-`）分隔词语，如 `react-native-track-player-upstream-diff`
- **禁止使用知识条目ID（`kn_xxx`）作为文档名**
- 多个条目拆分时，每个条目独立生成各自的文档ID
- 文档ID中禁止包含空格、特殊字符（仅允许字母、数字、中划线、斜杠）

**目录(catalog)选择**：
- 默认使用 `best-practices` 目录
- 若经验涉及FAQ类问题 → 使用 `faqs` 目录
- 若经验涉及API参考 → 使用 `references` 目录

### 3.2 调用 kb_add_document 工具

调用 MCP 工具 `kb_add_document` 将**结构化整理后**的文档添加到本地知识库引擎：

```
工具名: kb_add_document
参数:
  documentId: "experiences/{知识总结}"
  catalog: "best-practices"
  title: "{概括性的经验标题（非原始文档标题）}"
  content: "{按问题现象/解决方案/结果结构整理后的Markdown}"
```

### 3.3 导入验证

导入完成后，调用 `kb_search` 验证文档是否成功入库：

```
工具: kb_search
参数:
  query: "{经验文档中的关键词}"
  catalog: "best-practices"
  limit: 3
```

如果返回结果中包含刚导入的文档，则确认导入成功。

### 3.4 调用 kb-server 知识库（如可用）

如果 MCP Gateway 连接了远程 `kb-server`，同时调用其文档创建工具将知识同步到远程知识库：

```
工具名: kb-server_create_entry （或通过 gateway_list_tools 确认实际工具名）
参数:
  title: "{经验文档标题}"
  content: "{知识类内容}"
  tags: ["经验沉淀", "{相关技术领域}"]
  source: "knowledge-import"
```

> ⚠️ 远程知识库工具名需先通过 `gateway_list_tools` 确认，不同配置可能不同。若远程工具不可用或测试阶段只读，仅使用本地 `kb_add_document` 即可。

> MCP工具调用方式参见 [MCP工具调用指南](references/MCP_TOOL_USAGE.md)

---

## Phase 4：SKILL类导入 → 定位并优化 SKILL

### 4.1 读取目标SKILL

根据 Phase 2.3 确定的SKILL目录，读取其 `SKILL.md` 文件：

1. 读取 frontmatter（name, description, version 等）
2. 读取 body 内容（工作流程、各Phase步骤）
3. 检查是否存在 `references/` 目录及其内容

### 4.2 分析优化点

将SKILL类经验内容与现有SKILL body对比，确定需要优化的具体位置：

| 优化类型 | 说明 | 修改方式 |
|----------|------|----------|
| **步骤补充** | SKILL缺少某个执行步骤 | 在对应Phase中新增步骤说明 |
| **检查项新增** | SKILL应增加某项检查 | 在对应Phase的检查环节新增检查项 |
| **注意事项更新** | 发现新的注意事项 | 在对应Phase中添加 `> ⚠️` 提示 |
| **参数补充** | SKILL缺少某参数说明 | 在任务参数表中新增参数行 |
| **流程优化** | 现有步骤执行顺序或方式可改进 | 修改对应Phase的步骤描述 |

### 4.3 执行SKILL优化

直接修改目标SKILL的文件：

1. **修改 SKILL.md body** — 在对应Phase中插入优化内容
2. **更新 frontmatter version** — 版本号递增（如 1.0.0 → 1.1.0）
3. **必要时新增 references 文件** — 若优化内容较详细，拆分到 references/
4. **必要时新增 assets 模板** — 若优化引入新的输出模板

> ⚠️ SKILL修改必须保持渐进式披露原则：body < 500行，详细内容拆分到 references/。
> ⚠️ **禁止添加变更记录**：修改SKILL文件时，不得在SKILL.md末尾添加"变更记录"章节。版本递增仅体现在 frontmatter 的 version 字段中。

> SKILL优化规范参见 [SKILL优化规范](references/SKILL_OPTIMIZATION_GUIDE.md)

---

## Phase 4.5：问题案例类导入 → 调用泛化 SKILL

> Phase 2 判定存在**问题案例类**内容时执行本阶段（无则跳过）。

### 4.5.1 构造泛化输入

从经验文档中提取案例信息，构造 `issueList`：

```json
[{"description": "【库名】问题现象简述", "prUrl": "https://gitcode.com/owner/repo/pull/123"}]
```

- `description`：保留库名 + 问题现象（泛化器需要现象层信息做根因分析）
- `prUrl`：修复 PR 链接；缺失时仍可传入（泛化器降级为仅描述分析）

### 4.5.2 调用 rn-library-issue-generalizer

以子任务方式调用泛化 SKILL，参数：

| 参数 | 值 |
|------|-----|
| `issueList` | 4.5.1 构造的 JSON 数组 |
| `knowledgeDir` | `BadCase/rn` 绝对路径。探测顺序：① `~/.3lib/3rdloop/BadCase/rn`（npm 安装态用户副本，`3rdloop mcp install` 生成）② `{{skillDir}}/../../../BadCase/rn`（仓库开发态） |

### 4.5.3 记录泛化产出

泛化完成后，从 `BadCase/rn/generalization-log.md` 最新一节读取产出清单（新建规则/挂载案例/修订项），写入结果文件的"问题案例类导入"章节。**不做人工审核动作**（draft → active 由人工完成）。

---

## Phase 5：输出导入结果

### 5.1 写入结果文件

将导入结果写入 `resultFilePath` 指定的文件，格式如下：

```markdown
# 知识导入结果

## 执行状态
成功

## 导入摘要

### 知识类导入
- 文档ID: experiences/{知识总结}
- 目录: best-practices
- 状态: 已导入
- 工具: kb_add_document

### SKILL类导入
- 目标SKILL: {skillName}
- SKILL目录: {skillDir}
- 版本: {oldVersion} → {newVersion}
- 优化项:
  1. {优化项1描述}
  2. {优化项2描述}
- 状态: 已优化

### 问题案例类导入
- 泛化SKILL: rn-library-issue-generalizer
- 知识库目录: BadCase/rn
- 输入案例: {description + prUrl 摘要}
- 产出: 新建规则 {R-XX 列表} / 挂载案例 {KI-XXX → R-XX}（draft 状态，待人工审核）
- 状态: 已泛化入库

## 详细变更记录

### 知识库变更
{导入的知识库文档摘要}

### SKILL变更
{SKILL修改的具体内容diff描述}
```

### 5.2 结果文件要求

- 必须包含 `## 执行状态` 字段（值为 `成功` 或 `失败`）
- 失败时在 `## 失败原因` 中记录详细错误信息
- 成功时在 `## 导入摘要` 和 `## 详细变更记录` 中记录完整导入信息

---

## 异常处理

| 异常场景 | 处理方式 |
|----------|----------|
| 经验文档不存在 | 结果标记 `失败`，记录路径错误 |
| MCP Gateway 不可用 | 知识类导入标记跳过，SKILL类导入继续 |
| kb_add_document 不在工具列表中 | 知识类导入标记跳过，提醒用户配置 MCP Gateway 后重新执行 |
| kb_add_document 调用失败 | 记录错误，尝试 kb-server 远程工具作为 fallback |
| 无关联SKILL且无法定位 | SKILL类内容降级为知识类，全部导入知识库 |
| 经验未显式提及任何SKILL | 不进行SKILL修改，所有内容归为知识类导入知识库 |
| 问题案例无修复 PR 链接 | 仍可路由泛化（generalizer 支持仅描述分析），结果中标注"材料不足，泛化质量降级" |
| generalizer 调用失败 | 案例原文降级为知识类导入 MCP 知识库，结果中记录失败原因 |
| SKILL文件修改失败 | 记录错误，知识类导入结果仍保留 |
| 无SKILL类内容 | 跳过 Phase 4，仅执行知识类导入 |
| 无知识类内容 | 跳过 Phase 3，仅执行SKILL类导入 |
