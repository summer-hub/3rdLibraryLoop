---
name: skill-generator
description: 按照Agent Skills规范生成高质量的SKILL，自动调用MCP脚本与鸿蒙知识库补充能力，生成渐进式披露结构（SKILL.md+references+assets+scripts）。当需要创建新SKILL、规范化已有SKILL、或为某个重复性任务封装可复用技能时使用。
license: Apache-2.0
compatibility: 需要MCP Gateway运行中（脚本工具+知识库工具），需要文件写入权限到Server/Skills目录
metadata:
  author: LoopEngine
  version: "1.0.0"
  category: meta-skill
---

# Skill Generator — SKILL 生成器

本技能用于**按规范生成新SKILL**。它不是一个简单的模板填充器，而是一个结构化生成流程：
理解需求 → 检索MCP能力 → 查询知识库 → 编写SKILL.md → 拆分references。

> ⚠️ **核心原则：生成的每个SKILL必须同时满足规范合规、渐进式披露、MCP能力复用三条底线。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skillName` | string | ✅ | SKILL名称（kebab-case，如 `arkts-api-audit`） |
| `skillPurpose` | string | ✅ | SKILL要解决什么问题（自然语言描述） |
| `outputDir` | string | ✅ | 输出目录绝对路径（通常为 `Server/Skills/{skillName}`） |
| `domainContext` | string | ❌ | 领域上下文（如"鸿蒙ArkTS三方库"），用于知识库检索 |
| `existingSkillPath` | string | ❌ | 已有SKILL路径（规范化场景），不提供则全新生成 |

---

## 输入依赖

无前置SKILL。可作为独立任务调用。

---

## 工作流程概览

```
Phase 1: 需求理解与规范校验
    ↓
Phase 2: MCP能力检索（脚本工具 + 知识库）
    ↓
Phase 3: 鸿蒙知识库查询（当通用知识不够具体时）
    ↓
Phase 4: SKILL结构设计与SKILL.md编写
    ↓
Phase 5: references/assets/scripts 拆分（渐进式披露）
    ↓
Phase 6: 规范合规性自检
    ↓
Phase 7: 最终输出
```

---

## Phase 1：需求理解与规范校验

### 1.1 解析SKILL名称

验证 `skillName` 是否满足 [Agent Skills规范](https://agentskills.io/specification)：

| 规则 | 校验 |
|------|------|
| 长度 | 1-64 字符 |
| 字符集 | 仅小写字母 `a-z`、数字 `0-9`、连字符 `-` |
| 首尾 | 不能以 `-` 开头或结尾 |
| 连续 | 不能有连续 `--` |
| 目录匹配 | name 必须等于父目录名 |

> 名称不合规时，**必须先修正再继续**，不允许跳过。

### 1.2 理解SKILL目标

从 `skillPurpose` 提取：
- **核心任务**：SKILL做什么
- **触发场景**：什么时候用（写入 description 的"when to use"部分）
- **输入产出**：接收什么、输出什么
- **领域关键词**：用于Phase 2/3的检索词

### 1.3 读取已有SKILL（规范化场景）

如果提供了 `existingSkillPath`，读取现有 `SKILL.md`，分析：
- frontmatter 是否合规
- body 是否过长（>500行需拆分）
- 是否缺少 references/scripts 辅助文件
- 渐进式披露是否到位

> 规范化场景下，Phase 4 的工作变为"重构"而非"从零编写"。

---

## Phase 2：MCP能力检索

> **目标：检查MCP Gateway中是否有可复用的脚本工具或下游工具，避免SKILL中重复造轮子。**

### 2.1 检索脚本工具

MCP Gateway 的 `scripts/` 目录下每个脚本都自动注册为工具（前缀 `script_`）。
调用 `gateway_list_tools` 工具获取完整工具列表，筛选 `source: script` 的工具。

**现有脚本工具示例**：
| 工具名 | 脚本 | 能力 |
|--------|------|------|
| `script_rn_scan_exports` | rn-scan-exports.cjs | 扫描RN三方库导出接口/TurboModule Spec |
| `script_rn_extract_interfaces` | rn-extract-interfaces.cjs | 提取RN三方库接口信息 |

### 2.2 检索下游MCP工具

MCP Gateway 聚合了下游 Server（工具名前缀为 `{serverName}_`）：

| 前缀 | 来源 | 典型工具 |
|------|------|----------|
| `kb-server_` | 鸿蒙知识库 | 知识检索、文档查询 |
| `gitcode_` | GitCode MCP | 仓库操作、PR管理、代码搜索 |

### 2.3 匹配与引用

将SKILL需求与检索到的工具匹配：

- **匹配到脚本工具** → 在SKILL的对应Phase中引用 `script_{工具名}`，说明调用方式和参数
- **匹配到下游工具** → 在SKILL中引用 `{serverName}_{工具名}`，说明用途
- **未匹配到** → 记录为"能力缺口"，考虑在 Phase 5 中创建新脚本补充

> 详细检索方法参见 [MCP能力检索指南](references/MCP_TOOL_DISCOVERY.md)

---

## Phase 3：鸿蒙知识库查询

> **触发条件：当 `domainContext` 涉及鸿蒙/OpenHarmony/ArkTS，且大模型通用知识不够贴合具体场景时。**

### 3.1 构建检索查询

从 Phase 1.2 提取的领域关键词 + `domainContext` 组合检索词。

示例：
- domainContext = "鸿蒙ArkTS三方库内存泄漏检测"
- 检索词 = `["ArkTS 内存泄漏", "OpenHarmony 内存检测", "ArkTS 生命周期泄漏"]`

### 3.2 调用知识库工具

调用 `kb-server_` 前缀的知识检索工具（具体工具名通过 Phase 2.2 获取）。

**调用要点**：
- 一次查询一个关键词，避免长查询导致召回率下降
- 对返回结果提取：知识点、最佳实践、注意事项、代码示例
- 若返回结果不相关，调整关键词重试（最多3轮）

### 3.3 知识融合

将知识库返回的内容与SKILL设计融合：
- **检查清单** → 补充到 references 的检查项中
- **代码示例** → 补充到 assets 的模板中
- **注意事项** → 补充到 SKILL.md body 的对应Phase中（简洁引用，不照搬全文）

> 知识库查询的详细操作参见 [知识库查询指南](references/KB_QUERY_GUIDE.md)

---

## Phase 4：SKILL结构设计与SKILL.md编写

### 4.1 目录结构设计

按照规范设计目录：

```
{skillName}/
├── SKILL.md              # 必需：元数据 + 指令
├── references/           # 可选：详细参考文档
│   ├── REFERENCE.md      # 技术参考
│   └── {domain}.md       # 领域特定文档
├── assets/               # 可选：模板、资源
│   └── {template}.md     # 输出模板
└── scripts/              # 可选：可执行脚本
    └── {helper}.cjs      # 辅助脚本（Node.js，跨平台）
```

> ⚠️ **脚本语言要求：必须使用跨平台脚本语言（Node.js `.cjs` 或 Python `.py`），禁止使用 Bash `.sh`**，确保在 Windows 和 macOS 上均可直接运行。

### 4.2 编写 frontmatter

```yaml
---
name: {skillName}
description: {做什么}. Use when {什么时候用}. {关键词}.
license: Apache-2.0
compatibility: {环境要求}
metadata:
  author: {作者}
  version: "1.0.0"
---
```

**description 编写要点**：
- ≤1024 字符
- 必须包含"做什么"+"什么时候用"
- 包含领域关键词，便于Agent匹配

### 4.3 编写 body

**body 结构模板**：

```markdown
# {Skill标题}

{一句话定位}

> ⚠️ **核心原则：{本SKILL的关键约束}**

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| ... | ✅ | ... |

---

## 输入依赖

- 前置SKILL: {或"无"}
- 输入文件: {或"无"}

---

## 工作流程概览

Phase 1 → Phase 2 → ... → Phase N

---

## Phase 1：{阶段名}

### 1.1 {步骤}
{详细指令，引用references时用相对路径链接}

> 详细步骤参见 [参考文档](references/REFERENCE.md)

---

## Phase N：{最终阶段}
{输出产物说明}
```

**body 长度约束**：
- 推荐 < 500 行
- 推荐 < 5000 tokens
- 超过时**必须**将详细内容拆分到 references/

> 完整编写规范参见 [SKILL编写规范](references/SKILL_SPEC.md)

---

## Phase 5：渐进式披露拆分

> **目标：确保SKILL.md保持精炼，详细内容按需加载。**

### 5.1 拆分原则

| 内容类型 | 放置位置 | 加载时机 |
|----------|----------|----------|
| 核心流程步骤 | SKILL.md body | SKILL激活时 |
| 详细检查清单 | references/ | 按需读取 |
| 完整代码模板 | assets/ | 按需读取 |
| 可执行辅助逻辑 | scripts/ | 按需执行 |
| 领域知识参考 | references/ | 按需读取 |

### 5.2 文件引用规范

- 使用**相对路径**（从SKILL根目录起）
- 保持**一层深度**：`references/REF.md` ✅，`references/a/b/REF.md` ❌
- 引用格式：`参见 [参考文档](references/REFERENCE.md)`

### 5.3 补充脚本（能力缺口填补）

如果 Phase 2.3 识别到能力缺口，在此创建新脚本：

**脚本语言必须跨平台**（Windows/macOS/Linux 均可运行）：
- ✅ **Node.js（`.cjs`）**：首选，与项目 MCP scripts 惯例一致
- ✅ **Python（`.py`）**：次选，需 Python 3 环境
- ❌ **Bash（`.sh`）**：禁止，Windows 无原生支持

脚本头部注释约定：
```javascript
#!/usr/bin/env node
/**
 * @tool {工具名}
 * @description {描述}
 * @param {参数名}: {类型} - {说明}
 */
```

脚本放入 SKILL 的 `scripts/` 目录，并在 SKILL.md 中说明调用方式。
若脚本需要注册到 MCP Gateway，复制到 `MCP/scripts/` 目录。

---

## Phase 6：规范合规性自检

生成完成后，执行合规性检查：

### 6.1 frontmatter 检查

| 检查项 | 规则 |
|--------|------|
| `name` | ✅ 合规字符集、长度、匹配目录名 |
| `description` | ✅ ≤1024字符、含"做什么"+"何时用" |
| `license` | ✅ 存在 |
| `metadata` | ✅ 含 author、version |

### 6.2 结构检查

| 检查项 | 规则 |
|--------|------|
| SKILL.md 存在 | ✅ |
| body < 500行 | ✅（超过则拆分） |
| references 一层深度 | ✅ |
| 文件引用用相对路径 | ✅ |

### 6.3 内容检查

| 检查项 | 规则 |
|--------|------|
| 有任务参数表 | ✅ |
| 有工作流程概览 | ✅ |
| MCP工具引用正确 | ✅（工具名前缀正确） |
| 知识库内容已融合 | ✅（如适用） |

> 完整检查清单参见 [合规检查清单](references/COMPLIANCE_CHECKLIST.md)

可运行校验脚本进行自动化检查（跨平台，仅需 Node.js）：

```bash
node {outputDir}/scripts/validate-skill.cjs {outputDir}
```

---

## Phase 7：最终输出

确认输出目录包含所有文件：

```
{outputDir}/
├── SKILL.md                    # ✅ 主文件
├── references/                 # ✅ 参考文档（至少1个）
│   ├── SKILL_SPEC.md
│   ├── MCP_TOOL_DISCOVERY.md
│   ├── KB_QUERY_GUIDE.md
│   └── COMPLIANCE_CHECKLIST.md
├── assets/                     # ✅ 模板资源
│   └── SKILL_TEMPLATE.md
└── scripts/                    # ✅ 校验脚本（Node.js，跨平台）
    └── validate-skill.cjs
```

输出完成确认信息，包含：
- 生成的文件列表
- frontmatter 摘要（name、description）
- 引用的MCP工具列表
- 融合的知识库要点
