# MCP —— MCP Gateway Server

统一 MCP Gateway，聚合下游 MCP Server 工具 + 可扩展脚本执行，实现"系统内只需一个 MCP"的诉求。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  src/index.js                                         │
│  加载配置、创建 Gateway、注册优雅退出、启动 stdio Server      │
├──────────────────────────────────────────────────────────────┤
│  核心层  gateway/Gateway.js                                   │
│  工具聚合 + 调度核心，协调各子模块                             │
├──────────────────────────────────────────────────────────────┤
│  子模块层（高内聚低耦合，各司其职）                            │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐         │
│  │ ToolRegistry │ │ MCPClientPool│ │ScriptRegistry │         │
│  │ 统一工具注册表│ │ 下游连接池   │ │ 脚本自动发现  │         │
│  └─────────────┘ └──────────────┘ └───────────────┘         │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐         │
│  │ScriptExecutor│ │ ConfigLoader │ │   logger      │         │
│  │ 脚本执行     │ │ 配置加载校验 │ │   日志工具    │         │
│  └─────────────┘ └──────────────┘ └───────────────┘         │
├──────────────────────────────────────────────────────────────┤
│  MCP SDK 层  @modelcontextprotocol/sdk                       │
│  McpServer (stdio) + Client (stdio)                          │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
MCP/
├── src/
│   ├── index.js                    # 入口：加载配置 + 启动 Gateway
│   ├── types.js                    # JSDoc 类型定义（共享类型）
│   ├── config/
│   │   └── ConfigLoader.js         # 配置加载与校验
│   ├── gateway/
│   │   └── Gateway.js              # Gateway 核心类（工具聚合 + 调度）
│   ├── client/
│   │   └── MCPClientPool.js        # 下游 MCP Client 连接池
│   ├── registry/
│   │   ├── ToolRegistry.js         # 统一工具注册表
│   │   └── ScriptRegistry.js       # 脚本注册表 + 自动发现
│   ├── executor/
│   │   └── ScriptExecutor.js       # 脚本执行器 (spawn)
│   └── library/
│       └── logger.js               # 轻量日志工具
├── scripts/                        # 可扩展脚本目录（放入即自动注册）
│   ├── git操作.sh
│   ├── flutter.py
│   └── echo.js
├── config.json                     # Gateway 配置文件
├── package.json
└── AGENTS.md                       # 本文档
```

## 核心设计

### 工具命名规范

| 来源 | 前缀 | 示例 | 说明 |
|------|------|------|------|
| 下游 MCP Server | `{serverName}_` | `fetch_url` | 转发到对应下游 Server |
| 本地脚本 | `script_` | `script_git操作` | 本地 spawn 执行 |
| Gateway 内置 | `gateway_` | `gateway_health` | Gateway 管理工具 |

### 内置管理工具

| 工具名 | 功能 |
|--------|------|
| `gateway_list_tools` | 列出所有聚合工具及其来源 |
| `gateway_list_servers` | 列出下游 Server 连接状态 |
| `gateway_reload_scripts` | 重新扫描脚本目录 |
| `gateway_health` | 健康检查（各组件状态 + uptime） |

### 模块职责边界

| 模块 | 职责 | 不做什么 |
|------|------|---------|
| `Gateway` | 编排各子模块、注册工具、调度调用 | 不直接操作文件系统/子进程 |
| `MCPClientPool` | 下游连接管理、工具拉取、调用转发 | 不注册工具、不感知脚本 |
| `ScriptRegistry` | 脚本发现、元数据解析、热加载监听 | 不执行脚本 |
| `ScriptExecutor` | 脚本执行（spawn）、超时控制 | 不注册工具、不感知 MCP |
| `ToolRegistry` | 工具增删查、冲突检测 | 不执行调用、不感知 MCP |
| `ConfigLoader` | 配置加载、校验、路径解析 | 不依赖业务模块 |

### 脚本头部注释约定

```bash
#!/bin/bash
# @tool git操作              # 必填，工具名（中文可用）
# @description 执行 Git 操作  # 工具描述
# @param action: string - 操作类型 (status|log)  # 参数定义
```

参数以 JSON 字符串形式作为脚本第一个参数传入：
```bash
ARGS_JSON="$1"  # '{"action":"status","repo":"."}'
```

## 使用方式

### 启动

```bash
cd MCP
node src/index.js                    # 使用默认 config.json
node src/index.js --config /path     # 指定配置文件
```

### AI 客户端配置

#### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "gateway": {
      "command": "node",
      "args": ["/path/to/MCP/src/index.js", "--config", "/path/to/MCP/config.json"]
    }
  }
}
```

#### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "gateway": {
      "command": "node",
      "args": ["/path/to/MCP/src/index.js"]
    }
  }
}
```

### 添加自定义脚本

1. 在 `scripts/` 目录创建脚本（.sh / .py / .js）
2. 头部添加 `@tool` 注释声明工具名
3. 热加载自动生效，无需重启 Gateway

### 添加下游 MCP Server

在 `config.json` 的 `downstreamServers` 中添加配置：

```json
{
  "downstreamServers": {
    "myserver": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "enabled": true
    }
  }
}
```

## 与 3rdLibraryLoop Server 集成

### opencode 自动发现

opencode 全局配置 `opencode.jsonc` 已配置 MCP Gateway（local 模式），opencode 启动时自动 spawn Gateway 进程，并通过 MCP 协议 `tools/list` 发现全部工具。AI 本身已知每个工具的精确名称、描述和参数 schema，无需 Server 侧重复维护工具清单。

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "mcp": {
    "mcp-gateway": {
      "type": "local",
      "command": ["node", "D:/code/3rdLibraryLoop/MCP/src/index.js", "--config", "D:/code/3rdLibraryLoop/MCP/config.json"],
      "enabled": true
    }
  }
}
```

### Server 侧工具引导（McpToolGuide）

Server 通过 `Server/library/McpToolGuide.js` 从 `MCP/config.json` 读取下游 Server 名称 + 扫描 `MCP/scripts/` 解析 `@tool` 注释，动态生成引导性 prompt 段落，提醒 AI 主动使用 MCP 工具。

- **折中方式**：prompt 只写引导性文字（"你有 kb-server 知识库搜索、gitcode 仓库操作等工具可用"），不列具体工具名和参数。工具发现交给 opencode MCP 协议。
- **数据驱动**：新增/删除下游 Server 只改 `config.json`，新增/删除脚本只改 `scripts/` 目录，prompt 自动更新，无需改代码。
- **不缓存**：每次构建 prompt 都重新读取 `config.json` + 扫描 `scripts/`，确保新增工具即时被发现。读取开销很小。
- **静默失败**：配置文件不存在或读取异常时返回空字符串，不影响主流程。

集成点：FlexRunner `_buildPrompt()` 末尾调用 `mcpToolGuide.buildToolGuide()`，非空时追加到 prompt。

### 时序注意事项

| 新增类型 | McpToolGuide 发现 | Gateway 发现 | opencode AI 可调用 |
|---------|------------------|-------------|-------------------|
| 新脚本 | 即时（下次 buildToolGuide） | 即时（chokidar 热加载） | 需 opencode 重新 tools/list |
| 新下游 Server | 即时（下次 buildToolGuide） | 需重启 Gateway | 需重启 opencode |

新增脚本无风险；新增下游 Server 需重启 opencode 才能让 AI 真正调用。

### kb-server search_knowledge 返回结构（已验证）

```json
{
  "query": "ArkTS",
  "category": null,
  "total": 3,
  "results": [
    {
      "id": "msc1tmugast1uzqv",
      "title": "条目标题",
      "snippet": "正文摘要片段",
      "category": "patterns/arkts",
      "score": 12.19
    }
  ]
}
```

AI 可根据 `score` 字段（BM25 相关性分数）自行判断相关性，决定是否采用检索到的经验。

## 编码规范

- **ESM 模块**：统一使用 `import/export`，文件扩展名 `.js`
- **类风格**：每个模块一个 `class`，`export default` 导出
- **JSDoc 类型**：使用 `@typedef` + `@param` + `@returns` 注解类型
- **日志**：通过 `createLogger(tag)` 创建带标签日志，输出到 stderr
- **错误隔离**：单个下游/脚本失败不影响其他工具
- **中文注释**：模块顶部块注释说明职责与设计原则
