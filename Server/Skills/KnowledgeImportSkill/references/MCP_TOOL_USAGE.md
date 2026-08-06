# MCP 工具调用指南

> 知识导入过程中如何调用 MCP Gateway 提供的知识库工具。

---

## 0. MCP Gateway 可用性验证（前置步骤）

在执行任何知识库操作前，**必须先验证 MCP Gateway 和所需工具可用**：

### 0.1 健康检查

```
工具: gateway_health
参数: 无
```

检查返回的 `totalTools` > 0 且 `downstream` 中各 Server 状态为 `connected`。

### 0.2 工具列表确认

```
工具: gateway_list_tools
参数: 无
```

在返回的工具列表中确认以下工具存在：
- `kb_add_document`（builtin）— 知识库写入
- `kb_search`（builtin）— 知识库搜索验证
- `kb-server_*`（downstream，可选）— 远程知识库

> ⚠️ **若 `kb_add_document` 不在工具列表中**：
> - 知识类导入标记为跳过
> - 在结果文件中记录"MCP Gateway 未配置或 kb_add_document 工具未注册"
> - 提醒用户检查 `~/.config/opencode/opencode.json` 中是否配置了 `mcp-gateway`
> - SKILL类导入（如有）继续执行

### 0.3 MCP Gateway 配置方法

若 MCP Gateway 未配置，需在 `~/.config/opencode/opencode.json` 的 `mcp` 节点中添加：

```json
"mcp-gateway": {
  "command": [
    "node",
    "/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP/src/index.js",
    "--config",
    "/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP/config.json"
  ],
  "enabled": true,
  "type": "local"
}
```

配置后需**重启 opencode** 才能让 AI 会话发现并调用 MCP 工具。

---

## 1. 可用工具概览

知识导入过程中会用到以下 MCP 工具：

| 工具名 | 来源 | 用途 |
|--------|------|------|
| `kb_add_document` | builtin (KBToolProvider) | 向本地知识库引擎添加文档 |
| `kb_search` | builtin (KBToolProvider) | 搜索本地知识库（验证导入效果） |
| `kb-server_*` | downstream (远程知识库) | 远程知识库的增删查工具 |
| `gateway_list_tools` | builtin (Gateway) | 列出所有工具（确认工具名） |
| `gateway_health` | builtin (Gateway) | 健康检查（Gateway 状态） |

---

## 2. 工具调用方式

opencode CLI 执行 SKILL 时，AI 已通过 MCP 协议获取所有工具定义。
SKILL 指令中只需说明**调用哪个工具、传什么参数**，AI 会自动完成调用。

### 2.1 调用 kb_add_document

```
工具: kb_add_document
参数:
  documentId (string, 必填): 文档唯一标识，如 "experiences/kn_xxx"
  catalog (string, 必填): 所属目录，如 "best-practices"
  title (string, 选填): 文档标题
  content (string, 必填): 文档 Markdown 原文（必须结构化整理，非原始文档）
```

> ⚠️ content 参数必须按"问题现象/解决方案/结果"结构整理，禁止传入原始经验文档。

### 2.2 调用 kb_search（导入验证）

```
工具: kb_search
参数:
  query (string, 必填): 搜索关键词
  catalog (string, 选填): 限定目录，如 "best-practices"
  limit (number, 选填): 返回数量上限，默认 10
```

### 2.3 调用 kb-server 远程工具

先通过 `gateway_list_tools` 确认远程知识库的实际工具名（前缀为 `kb-server_`），然后调用：

```
工具: kb-server_create_entry （实际名称以 gateway_list_tools 返回为准）
参数:
  title: 经验文档标题
  content: 知识类内容
  tags: ["经验沉淀", "相关技术领域"]
  source: "knowledge-import"
```

> ⚠️ 远程知识库工具可能不支持 create 操作（测试阶段可能只读）。调用失败时记录警告，不影响整体导入流程。

---

## 3. 目录(catalog)说明

本地知识库引擎支持以下目录：

| 目录ID | 用途 | 适用场景 |
|--------|------|----------|
| `guides` | 指南文档 | 操作指南、使用教程 |
| `references` | 参考文档 | API参考、技术规格 |
| `best-practices` | 最佳实践 | 经验总结、最佳实践、踩坑记录 |
| `faqs` | 常见问题 | FAQ、疑难解答 |
| `releases` | 发布说明 | 版本发布、变更记录 |
| `roadmap` | 路线图 | 规划、路线图 |

知识导入默认使用 `best-practices`，因为经验沉淀本质是最佳实践。

---

## 4. 知识库内容结构化格式

导入知识库的 content 必须按以下结构整理，禁止传入原始经验文档：

```markdown
# {经验标题}

## {条目1标题}

### 问题现象
{描述遇到的具体问题、困惑或错误表现}

### 解决方案
{描述如何解决该问题，包括具体方法、命令、配置等}

### 结果
{描述解决后的效果、验证方式或可复用的结论}

---

## {条目2标题}

### 问题现象
...
```

**整理规则**：
- 将原始文档中的"关键发现""踩坑记录""可复用建议"拆解为独立条目
- 每个条目聚焦一个问题，按"问题现象 → 解决方案 → 结果"三段式重组
- 去除与问题无直接关联的背景描述，保留可复用的核心信息
- 多个独立问题用 `---` 分隔
