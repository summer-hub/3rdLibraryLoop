# MCP 能力检索指南

> 本文档说明如何检索 MCP Gateway 中可复用的脚本工具和下游工具。

---

## 1. MCP Gateway 架构概览

MCP Gateway 位于 `3rdLibraryLoop/MCP/`，聚合三类工具：

| 工具来源 | 命名前缀 | 注册方式 |
|----------|----------|----------|
| 脚本工具 | `script_` | 扫描 `MCP/scripts/` 目录，解析 `@tool` 注释 |
| 下游工具 | `{serverName}_` | 连接下游 MCP Server，拉取工具列表 |
| 内置工具 | `gateway_` | Gateway 自带管理工具 |

---

## 2. 检索工具列表

### 2.1 调用 gateway_list_tools

调用 MCP 工具 `gateway_list_tools` 获取所有已注册工具的完整列表。

返回的工具对象包含：
```json
{
  "name": "script_git操作",
  "description": "[via scripts] 执行 Git 操作",
  "inputSchema": { ... }
}
```

### 2.2 分类筛选

根据工具名前缀分类：

- **脚本工具**：名称以 `script_` 开头 → 对应 `MCP/scripts/` 下的脚本
- **知识库工具**：名称以 `kb-server_` 开头 → 鸿蒙知识库
- **GitCode工具**：名称以 `gitcode_` 开头 → GitCode 平台操作
- **内置工具**：名称以 `gateway_` 开头 → Gateway 管理功能

---

## 3. 脚本工具详情

### 3.1 脚本头部注释约定

脚本前20行必须包含 `@tool` 注释：

```javascript
#!/usr/bin/env node
/**
 * @tool {工具名}                        // 必填，工具名（中文可用）
 * @description {描述}                    // 给AI的工具说明
 * @param {参数名}: {类型} - {说明}       // 参数定义
 */
```

> ⚠️ **脚本必须跨平台**：使用 Node.js（`.cjs`）或 Python（`.py`），禁止 Bash（`.sh`），确保 Windows/macOS 均可运行。

### 3.2 参数传递方式

Gateway 将参数序列化为 **JSON 字符串**，作为脚本**第一个命令行参数**传入：

- node: `process.argv[2]` → `JSON.parse()` 解析
- python: `sys.argv[1]` → `json.loads()` 解析

### 3.3 现有脚本工具

| 工具名 | 脚本文件 | 能力 | 参数 |
|--------|----------|------|------|
| `script_rn_scan_exports` | `rn-scan-exports.cjs` | 扫描RN三方库导出接口/TurboModule Spec | `dir`, `compare`, `dir1`, `dir2` |
| `script_rn_extract_interfaces` | `rn-extract-interfaces.cjs` | 提取RN三方库接口信息 | `dir` |
| `script_render_spec_doc` | `render-spec-doc.cjs` | 渲染接口规格文档 | `spec`, `output` |

### 3.4 创建新脚本

若SKILL需要新的脚本能力：

1. 在SKILL的 `scripts/` 目录创建脚本（**必须跨平台**：Node.js `.cjs` 或 Python `.py`，禁止 `.sh`）
2. 添加 `@tool` 头部注释
3. 若需全局复用，复制到 `MCP/scripts/` 目录
4. Gateway 热加载会自动注册（`hotReload: true`）

---

## 4. 下游工具详情

### 4.1 kb-server（鸿蒙知识库）

- **URL**: `https://mcp.huaness.tech/mcp`
- **认证**: `Bearer test-secret`
- **工具前缀**: `kb-server_`
- **用途**: 鸿蒙/OpenHarmony/ArkTS 领域知识检索

### 4.2 gitcode（GitCode MCP）

- **URL**: `https://api.gitcode.com/mcp-server/v1/mcp`
- **工具前缀**: `gitcode_`
- **用途**: 仓库操作、PR管理、代码搜索

---

## 5. 在SKILL中引用MCP工具

在SKILL.md的对应Phase中，按以下方式引用：

```markdown
### 获取仓库信息

调用 MCP 工具 `gitcode_获取仓库信息`，传入 `owner` 和 `repo` 参数。

### 查询鸿蒙知识

调用 MCP 工具 `kb-server_知识检索`，传入关键词查询。
```

引用要点：
- 使用完整工具名（含前缀）
- 说明调用参数
- 说明返回数据的用途
