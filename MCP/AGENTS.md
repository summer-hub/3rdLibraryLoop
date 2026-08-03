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

## 编码规范

- **ESM 模块**：统一使用 `import/export`，文件扩展名 `.js`
- **类风格**：每个模块一个 `class`，`export default` 导出
- **JSDoc 类型**：使用 `@typedef` + `@param` + `@returns` 注解类型
- **日志**：通过 `createLogger(tag)` 创建带标签日志，输出到 stderr
- **错误隔离**：单个下游/脚本失败不影响其他工具
- **中文注释**：模块顶部块注释说明职责与设计原则
