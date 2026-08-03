# MCP Gateway Server

> 统一 MCP Gateway — 聚合下游 MCP Server 工具 + 可扩展脚本执行，实现"系统内只需一个 MCP"的诉求。

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **bash**（执行 `.sh` 脚本）
- **python3**（执行 `.py` 脚本）

### 安装依赖

```bash
cd /Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP
npm install
```

### 启动

```bash
# 在 MCP 目录下启动（使用默认 config.json）
cd /Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP
node src/index.js

# 或指定配置文件
node src/index.js --config /path/to/config.json

# 或通过 npm script
npm start
```

启动后 Gateway 通过 **stdio** 与 AI 客户端通信，等待 JSON-RPC 消息。日志输出到 **stderr**（不影响 stdio 数据流）。

### 验证启动

```bash
# 发送 MCP initialize + tools/list 请求测试
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | node src/index.js
```

应返回所有聚合工具列表（脚本工具 + 内置管理工具 + 下游工具）。

---

## 目录结构

```
MCP/
├── src/
│   ├── index.js                    # 入口：加载配置 + 启动 Gateway
│   ├── types.js                    # JSDoc 类型定义
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
├── scripts/                        # 可扩展脚本目录（放入即自动注册为工具）
│   ├── git操作.sh                   # bash 脚本示例
│   ├── flutter.py                  # python 脚本示例
│   └── echo.js                     # node 脚本示例
├── config.json                     # Gateway 配置文件
├── package.json
├── AGENTS.md                       # 架构设计文档
└── README.md                       # 本文档
```

---

## 配置说明

`config.json` 完整示例：

```json
{
  "downstreamServers": {
    "fetch": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"],
      "env": {},
      "enabled": false
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<YOUR_TOKEN>"
      },
      "enabled": false
    },
    "kb-server": {
      "type": "remote",
      "enabled": true,
      "url": "https://mcp.huaness.tech/mcp",
      "headers": {
        "Authorization": "Bearer test-secret"
      }
    },
    "gitcode": {
      "type": "remote",
      "enabled": true,
      "url": "https://api.gitcode.com/mcp-server/v1/mcp",
      "headers": {
        "Authorization": "Bearer <你的GITCODE个人访问令牌>"
      }
    }
  },
  "scriptsDir": "./scripts",
  "scripts": {
    "enabled": true,
    "hotReload": true,
    "timeout": 30000,
    "allowedExtensions": [".sh", ".py", ".js"]
  },
  "gateway": {
    "name": "mcp-gateway",
    "version": "1.0.0",
    "transport": "stdio"
  }
}
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `downstreamServers` | `Object` | `{}` | 下游 MCP Server 配置，key 为 Server 名称（用作工具前缀） |
| `downstreamServers.<name>.type` | `'stdio'` \| `'remote'` | `'stdio'` | 传输类型：stdio=本地子进程，remote=远程 HTTP |
| **stdio 类型** | | | |
| `downstreamServers.<name>.command` | `string` | — | 启动命令（如 `npx`、`node`） |
| `downstreamServers.<name>.args` | `string[]` | — | 命令参数 |
| `downstreamServers.<name>.env` | `Object` | `{}` | 环境变量 |
| **remote 类型** | | | |
| `downstreamServers.<name>.url` | `string` | — | 远程 MCP Server URL（如 `https://example.com/mcp`） |
| `downstreamServers.<name>.headers` | `Object` | `{}` | 自定义 HTTP 请求头（如 `Authorization`） |
| **通用** | | | |
| `downstreamServers.<name>.enabled` | `boolean` | `true` | 是否启用，设为 `false` 则跳过 |
| `scriptsDir` | `string` | `./scripts` | 脚本目录路径（相对于 config.json 所在目录） |
| `scripts.enabled` | `boolean` | `true` | 是否启用脚本工具 |
| `scripts.hotReload` | `boolean` | `true` | 是否监听脚本目录变化，自动增删工具 |
| `scripts.timeout` | `number` | `30000` | 脚本执行超时（毫秒） |
| `scripts.allowedExtensions` | `string[]` | `[".sh",".py",".js"]` | 允许的脚本扩展名 |
| `gateway.name` | `string` | `mcp-gateway` | Gateway Server 名称 |
| `gateway.version` | `string` | `1.0.0` | Gateway 版本号 |
| `gateway.transport` | `string` | `stdio` | 传输方式（当前仅支持 stdio） |

---

## 脚本开发指南

### 支持的脚本类型

| 扩展名 | 解释器 | 说明 |
|--------|--------|------|
| `.sh` | `bash` | Shell 脚本 |
| `.py` | `python3` | Python 脚本 |
| `.js` | `node` | JavaScript 脚本 |
| `.ts` | `npx tsx` | TypeScript 脚本（需在 `allowedExtensions` 中添加） |
| `.mjs` | `node` | ES Module 脚本 |

### 脚本头部注释约定

脚本**前 20 行**中必须包含 `@tool` 注释，Gateway 据此自动提取工具元数据：

```
# @tool <工具名>                        — 必填，工具名（中文可用）
# @description <描述>                    — 给 AI 的工具说明
# @param <参数名>: <类型> - <说明>        — 参数定义（类型: string/number/boolean）
```

> `.sh` / `.py` / `.js` 均使用 `#` 注释，格式完全统一。

### 参数传递

Gateway 将 AI 传入的参数序列化为 **JSON 字符串**，作为脚本的**第一个命令行参数**传入：

**bash 脚本：**
```bash
#!/bin/bash
# @tool git操作
# @description 执行 Git 操作
# @param action: string - 操作类型 (status|log|branch|diff)

ARGS_JSON="$1"
action=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('action',''))" "$ARGS_JSON")

case "$action" in
    status) git status --short ;;
    log)    git log --oneline -10 ;;
esac
```

**python 脚本：**
```python
#!/usr/bin/env python3
# @tool flutter
# @description Flutter 开发辅助工具
# @param action: string - 操作类型 (doctor|clean|version)

import sys, json, subprocess

args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
action = args.get("action", "doctor")

subprocess.run(["flutter", action])
```

**javascript 脚本：**
```javascript
#!/usr/bin/env node
/**
 * @tool echo
 * @description 回显工具
 * @param message: string - 要回显的消息
 */

const args = JSON.parse(process.argv[2] || '{}');
console.log(`Echo: ${args.message}`);
```

### 执行规则

- **退出码 0**：返回 stdout（trim 后）
- **退出码非 0**：返回 stdout + stderr + 退出码（便于 AI 排查错误）
- **超时**：超过 `scripts.timeout`（默认 30s）自动 SIGTERM 终止
- **热加载**：`scripts.hotReload: true` 时，新增/删除脚本自动注册/注销工具，并通知 AI 客户端刷新

---

## 对外导出的工具

### 工具命名规范

| 来源 | 前缀 | 示例 | 说明 |
|------|------|------|------|
| 本地脚本 | `script_` | `script_git操作` | 本地 spawn 执行 |
| 下游 MCP Server | `{serverName}_` | `fetch_url` | 转发到对应下游 Server |
| Gateway 内置 | `gateway_` | `gateway_health` | Gateway 管理工具 |

### 内置管理工具

| 工具名 | 参数 | 功能 |
|--------|------|------|
| `gateway_list_tools` | 无 | 列出所有聚合工具及其来源 |
| `gateway_list_servers` | 无 | 列出下游 Server 连接状态 |
| `gateway_reload_scripts` | 无 | 重新扫描脚本目录，更新工具列表 |
| `gateway_health` | 无 | 健康检查（各组件状态 + uptime） |

### 下游 Server 工具

启用 `config.json` 中的下游 Server 后，Gateway 会自动连接并聚合其工具。工具名格式为 `{serverName}_{originalToolName}`。

支持两种下游 Server 类型：

| 类型 | `type` | 说明 | 示例 |
|------|--------|------|------|
| 本地 stdio | `"stdio"` | spawn 子进程，stdin/stdout 通信 | fetch、github |
| 远程 HTTP | `"remote"` | Streamable HTTP 连接远程 URL | kb-server |

例如启用 `kb-server` (remote) 后，会导出以下工具：

| 工具名 | 功能 |
|--------|------|
| `kb-server_search_knowledge` | 全文搜索知识库 |
| `kb-server_create_entry` | 创建知识库条目 |
| `kb-server_update_entry` | 更新知识库条目 |
| `kb-server_delete_entry` | 删除知识库条目 |
| `kb-server_get_entry` | 获取条目完整内容 |
| `kb-server_list_categories` | 列出所有分类 |
| `kb-server_export_kb` | 导出知识库 |
| `kb-server_list_query_logs` | 查看查询日志 |

调用时 Gateway 自动转发到下游 Server，对 AI 透明。

---

## Agent 接入指南

### 方式 A：Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "node",
      "args": [
        "/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP/src/index.js",
        "--config",
        "/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP/config.json"
      ]
    }
  }
}
```

重启 Claude Desktop 即可自动连接。

### 方式 B：VS Code（Copilot Chat / MCP 扩展）

在项目 `.vscode/mcp.json` 中：

```json
{
  "servers": {
    "mcp-gateway": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP/src/index.js",
        "--config",
        "/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP/config.json"
      ]
    }
  }
}
```

### 方式 C：代码接入（自定义 Agent）

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 1. 建立连接
const transport = new StdioClientTransport({
    command: 'node',
    args: [
        '/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP/src/index.js',
        '--config',
        '/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/MCP/config.json'
    ]
});

const client = new Client(
    { name: 'my-agent', version: '1.0.0' },
    { capabilities: {} }
);

await client.connect(transport);

// 2. 获取工具列表
const { tools } = await client.listTools();
console.log('可用工具:', tools.map(t => t.name));

// 3. 调用脚本工具
const result = await client.callTool({
    name: 'script_echo',
    arguments: { message: 'Hello from Agent!' }
});
console.log(result.content[0].text);

// 4. 调用内置管理工具
const health = await client.callTool({
    name: 'gateway_health',
    arguments: {}
});
console.log(health.content[0].text);

// 5. 断开
await client.close();
```

### 接入流程

```
┌──────────────┐   stdio    ┌───────────────┐   spawn    ┌──────────────┐
│  AI Agent    │◄──────────►│  MCP Gateway   │◄──────────►│  下游 Server  │
│  (Client)    │            │  (Server)      │            │  (fetch等)   │
└──────────────┘            └───────────────┘            └──────────────┘
                                   │
                                   │ spawn
                                   ▼
                            ┌──────────────┐
                            │  scripts/    │
                            │  .sh .py .js │
                            └──────────────┘
```

1. Agent 通过 stdio 连接 Gateway → 获取 `tools/list`
2. Agent 调用工具 → Gateway 自动路由：
   - `script_*` → 本地执行脚本（spawn）
   - `{server}_*` → 转发到下游 MCP Server
   - `gateway_*` → 内置管理功能
3. Gateway 返回 `CallToolResult` 给 Agent

---

## 技术架构

### 架构总览

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
│  Server (stdio) + Client (stdio)                             │
└──────────────────────────────────────────────────────────────┘
```

### 模块职责边界

| 模块 | 职责 | 不做什么 |
|------|------|----------|
| `Gateway` | 编排：连接下游 → 加载脚本 → 注册工具 → 调度调用 | 不直接操作 stdio 细节 |
| `ToolRegistry` | 工具注册/查询/冲突检测 | 不执行工具、不感知 MCP 协议 |
| `MCPClientPool` | 下游 Client 连接/列表/转发/断开 | 不注册工具、不执行脚本 |
| `ScriptRegistry` | 扫描目录/解析注释/文件监听 | 不执行脚本、不注册 MCP 工具 |
| `ScriptExecutor` | spawn 执行脚本/超时控制/输出捕获 | 不感知工具注册表和 MCP 协议 |
| `ConfigLoader` | 读取 JSON/校验/规范化 | 不创建 Gateway 实例 |
| `logger` | stderr 日志输出 | 不写文件、不写 stdout |

### 技术栈

- **运行时**: Node.js ≥ 18, ESM (`"type": "module"`)
- **MCP SDK**: `@modelcontextprotocol/sdk` (底层 `Server` 类 + `setRequestHandler`)
- **文件监听**: `chokidar` v4
- **传输方式**: stdio（JSON-RPC over stdin/stdout）

> **设计说明**: 使用底层 `Server` 类 + `setRequestHandler(ListToolsRequestSchema/CallToolRequestSchema)` 而非高层 `McpServer.registerTool()`，因为后者要求 Zod schema，而下游 MCP Server 返回的是原始 JSON Schema，直接转发更高效。

---

## 日志与调试

所有日志输出到 **stderr**（MCP stdio 协议要求 stdout 只传 JSON-RPC 数据）：

```bash
# 启动并查看日志
node src/index.js 2>/tmp/mcp-gateway.log

# 查看日志
cat /tmp/mcp-gateway.log
```

日志格式：
```
2026-08-03T08:05:27.898Z [Gateway] INFO Gateway 已启动 (stdio) {"tools":7,"downstream":[],"scripts":3}
2026-08-03T08:05:27.899Z [Main] INFO [mcp-gateway] Gateway 已就绪，等待 AI 客户端连接 (stdio)
```

---

## 常见问题

### Q: 启用下游 Server 后工具不出现？

检查 `config.json` 中对应 Server 的 `enabled` 字段是否为 `true`，以及 `command`/`args`/`env` 配置是否正确。用 `gateway_list_servers` 工具查看连接状态。

### Q: 脚本没有被发现？

1. 确认脚本在 `scriptsDir` 配置的目录中
2. 确认脚本扩展名在 `allowedExtensions` 中
3. 确认脚本前 20 行包含 `# @tool <名称>` 注释
4. 用 `gateway_reload_scripts` 工具重新扫描

### Q: 脚本执行超时？

在 `config.json` 中调大 `scripts.timeout`（默认 30000ms = 30秒）。

### Q: 如何添加新的脚本工具？

直接将脚本文件放入 `scripts/` 目录，添加 `@tool` / `@description` / `@param` 注释头。如果启用了 `hotReload`，Gateway 会自动发现并注册，无需重启。
