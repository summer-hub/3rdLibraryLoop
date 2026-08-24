# SKILL 编写规范

> 基于 [Agent Skills Specification](https://agentskills.io/specification)

---

## 1. 目录结构

```
skill-name/
├── SKILL.md          # 必需：YAML frontmatter + Markdown 指令
├── scripts/          # 可选：可执行代码
├── references/       # 可选：详细参考文档
├── assets/           # 可选：模板、静态资源
└── ...               # 其他文件
```

---

## 2. SKILL.md 格式

### 2.1 Frontmatter（YAML）

| 字段 | 必填 | 约束 |
|------|------|------|
| `name` | ✅ | ≤64字符，仅 `a-z`/`0-9`/`-`，不能首尾 `-`，不能连续 `--`，**必须等于父目录名** |
| `description` | ✅ | ≤1024字符，描述"做什么"+"何时用"，含关键词 |
| `license` | ❌ | 许可证名称或引用文件 |
| `compatibility` | ❌ | ≤500字符，环境要求 |
| `metadata` | ❌ | key-value map，推荐含 `author`、`version` |
| `allowed-tools` | ❌ | 空格分隔的预批准工具列表（实验性） |

#### name 校验规则

```
有效: pdf-processing, data-analysis, code-review, arkts-api-audit
无效: PDF-Processing（大写）, -pdf（连字符开头）, pdf--processing（连续连字符）
```

#### description 编写

**好的示例**：
```yaml
description: 对ArkTS鸿蒙化库核心代码进行编码质量检视，依据华为ArkTS规范评分。当需要对鸿蒙化ArkTS库进行编码质量检视时使用。支持命名规范、格式规范、ArkTS约束等维度。
```

**差的示例**：
```yaml
description: 帮助检视代码。
```

### 2.2 Body（Markdown）

**推荐结构**：
1. 标题 + 一句话定位
2. 核心原则提示（`> ⚠️`）
3. 任务参数表
4. 输入依赖
5. 工作流程概览（Phase 1 → N）
6. 各 Phase 详细步骤
7. 输出产物说明

**长度约束**：
- 推荐 < 500 行
- 推荐 < 5000 tokens
- 超过时必须拆分到 references/

---

## 3. 渐进式披露

Agent 按需加载SKILL内容，分三层：

| 层级 | 内容 | 加载时机 | Token量 |
|------|------|----------|---------|
| L1 | name + description | 启动时加载所有SKILL元数据 | ~100 tokens |
| L2 | SKILL.md body | SKILL被激活时加载 | < 5000 tokens |
| L3 | references/assets/scripts | 任务需要时按需读取 | 按需 |

**设计要点**：
- L1 要精准：description 决定SKILL是否被选中
- L2 要完整：body 包含完整可执行的流程
- L3 要聚焦：每个reference文件专注一个主题

---

## 4. 文件引用

- 使用**相对路径**（从SKILL根目录起）
- 保持**一层深度**：`references/REF.md` ✅
- 避免深层嵌套：`references/a/b/c.md` ❌
- 引用格式：`参见 [参考文档](references/REFERENCE.md)`

---

## 5. scripts/ 目录

脚本要求：
- 自包含或清晰声明依赖
- 包含有用的错误信息
- 优雅处理边界情况
- **必须跨平台**（Windows/macOS/Linux 均可运行）：支持 Node.js（`.cjs`/`.js`）或 Python（`.py`），**禁止 Bash（`.sh`）**
- 脚本内路径操作使用 `path` 模块（Node.js）或 `os.path`/`pathlib`（Python），禁止硬编码 `/` 或 `\` 分隔符拼接

若脚本需注册到 MCP Gateway：
1. 添加头部注释（`@tool`、`@description`、`@param`）
2. 复制到 `MCP/scripts/` 目录
3. Gateway 自动发现并注册为 `script_{工具名}` 工具

---

## 6. 验证

使用规范校验：
```bash
# 项目内校验脚本（跨平台，仅需 Node.js）
node scripts/validate-skill.cjs /path/to/skill

# 或使用官方工具
npx skills-ref validate /path/to/skill
```
