# 系统 API 检索指南（SYSTEM_API_LOOKUP）

> 编写 XTS 测试代码时，查证 HarmonyOS 系统 API（`@kit.*` / `@ohos.*` / `@hms.*`）的权威途径。
> 通过 MCP 工具 `script_deveco_docs` 调用，语料为 HarmonyOS 官方 API 参考文档（本地离线）。

---

## 1. 检索工具 `script_deveco_docs`

> 由 MCP Gateway 的 `MCP/scripts/deveco_docs.js` 脚本提供，封装 `devecocli docs`，**内置降噪排序与小节精确定位**。opencode 通过 MCP 协议自动发现并主动调用，无需手动执行 shell 命令。

### 1.1 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | `search`（检索）\| `read`（读取文档） |
| `keywords` | string | search 必填 | 检索关键词，多个用空格分隔（如 `"ImageFit"`、`"AudioRenderer createAudioRenderer"`） |
| `catalog` | string | 否 | 文档类别，默认 `harmonyos-references`（API 参考） |
| `limit` | number | 否 | 返回条数上限，默认 10 |
| `documentId` | string | read 必填 | 文档 ID（来自 search 结果的 `documentId` 字段） |
| `section` | string | read 可选 | 按小节名精确定位（如 `ImageFit`），返回该小节而非全文 |

### 1.2 调用示例

> 工具实际名称以 MCP 工具列表为准（opencode 中可能带 server 前缀，实际为 `mcp-gateway_script_deveco_docs`）。下述以无前缀名 `script_deveco_docs` 说明。

```
工具: script_deveco_docs
参数: { "action": "search", "keywords": "ImageFit", "catalog": "harmonyos-references", "limit": 8 }

工具: script_deveco_docs
参数: { "action": "read", "documentId": "API参考/.../ts-appendix-enums", "section": "ImageFit" }
```

### 1.3 返回结构

**search** 返回 `{ tool, action, query, total, results: [{ title, documentId, sectionTitle, snippet }] }`，结果已按标题相关性从高到低排序（命中 title > 命中 sectionTitle > 内容匹配）。

**read** 返回 `{ tool, action, documentId, section, contentLength, content }`；提供 `section` 时 `content` 仅含该小节（如单个枚举定义），否则为全文（截断保护 20000 字符）。

### 1.4 环境依赖

- `devecocli` 需已全局安装（`npm install -g @deveco/deveco-cli`）
- 脚本自动定位 `@deveco/deveco-cli/dist/cli.js` 并用 node 直接运行，规避 Windows 下 `.cmd` 的中文编码问题（documentId 含中文时也可正常 read）
- 可用 `DEVECO_CLI_PATH` 环境变量显式指定 cli.js 路径
- 若 MCP Gateway 已启动（`hotReload: true`），脚本放入 `MCP/scripts/` 后自动注册，无需重启

---

## 2. 常用系统 API 速查

XTS 测试代码中高频出现的系统 API 依赖及其典型 import 路径（以 `script_deveco_docs` 检索结果为准，下表为常见形态）：

| 系统 API | 典型 import | 用途 | 检索关键词 |
|---------|------------|------|-----------|
| `hilog` | `import { hilog } from '@kit.PerformanceAnalysisKit'` | 日志输出 | `hilog` |
| `abilityDelegatorRegistry` | `import { abilityDelegatorRegistry } from '@kit.TestKit'` | 获取测试上下文 | `abilityDelegatorRegistry` |
| `common.UIAbilityContext` | `import { common } from '@kit.AbilityKit'` | 应用上下文 | `UIAbilityContext` |
| `common.Context` | `import { common } from '@kit.AbilityKit'` | 通用上下文 | `common Context` |
| `ImageFit` | ArkUI 组件属性枚举 | 图片填充效果 | `ImageFit` |
| `hypium`（describe/it/expect） | `import { describe, it, expect } from '@ohos/hypium'` | 测试框架 | **不在系统语料，不检索** |

> ⚠️ **检索边界**：`hypium`/`@ohos.hypium`（测试框架）与**被测试库自身 API** 不在 HarmonyOS 系统 API 语料中，`script_deveco_docs` 会返回"未找到相关文档"。这类 API 直接按接口规格文档/库源码编写，不要检索。

---

## 3. 降噪策略

`devecocli docs search` 原生返回含噪声（如搜 `ImageFit` 会命中 `ImageParticleParameters`、`RichEditorImageSpanStyleResult` 等含 "Image" 的无关文档）。`script_deveco_docs` 已内置以下降噪手段：

1. **相关性排序**：命中结果 `title` 的排在 `sectionTitle` 命中之前，多关键词全命中优先
2. **取第一条**：排序后第一条通常即目标；若首条 `title`/`sectionTitle` 与目标不符，逐条检查 `sectionTitle` 匹配项
3. **`--catalog harmonyos-references`**：限定在 API 参考语料内检索（默认），排除 FAQ/指南/最佳实践等非签名文档
4. **多关键词组合**：用"模块名 + 接口名"（如 `AudioRenderer createAudioRenderer`）可显著提升精确度

---

## 4. 大文档精确定位

- 聚合文档（`Enums`、`Types`、`公共定义` 等）可达数十 KB（如 `ts-appendix-enums` 47 KB）
- **read 必须带 `section=<目标名>`**：脚本会从文档中定位 `#### <section>` 小节并只返回该小节（如 `ImageFit` 枚举定义约 2 KB），避免浪费 token
- 若 `section` 未命中（返回 `section: null`），再考虑全文读取或换关键词

---

## 5. 常见问题

| 问题 | 原因 | 处理 |
|------|------|------|
| `search` 返回空 | API 不是系统 API（hypium、库自身 API）、或关键词不准确 | 按接口规格文档/库源码编写，不检索 |
| `read` 提示 Document not found | documentId 被截断或路径不完整 | 从最新 `search` 结果的 `documentId` 完整复制 |
| `search` 结果第一条不相关 | 关键词过泛 | 用"模块名 + 接口名"多关键词重试 |
| 工具不可用（tools 列表无 `script_deveco_docs`） | MCP Gateway 未重启 | 重启 opencode / 检查 `MCP/scripts/` 脚本存在且带 `@tool` 注释 |