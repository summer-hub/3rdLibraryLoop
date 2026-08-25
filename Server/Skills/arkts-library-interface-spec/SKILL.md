---
name: arkts-library-interface-spec
description: 扫描提取鸿蒙ArkTs原生库源码中对外公开的方法级接口与接口签名，解析 Index.ets 导出链，生成接口规格文档，涵盖导出类、方法和函数。只分析对外公开导出项，输出完整接口签名（含参数、返回值、JSDoc）。当需要对鸿蒙原生库进行方法级接口规格提取、接口签名清单生成、Index.ets 导出链分析时调用。
license: Apache-2.0
compatibility: 适用于鸿蒙原生库工程（含 library 模块和 Index.ets 入口文件）。需要 git 命令行工具（用于克隆源码）和 Node.js（运行提取脚本）。
metadata:
  version: "1.0.0"
  category: harmonyos-development
  language: ArkTS/ETS
  useWhen: 从鸿蒙原生库源码提取方法级接口规格时
---

# 鸿蒙ArkTs原生库方法级接口规格提取

通过源码静态分析提取鸿蒙原生库所有对外公开导出的方法级接口，自动生成标准化的接口规格说明文档。

> ⚠️ **核心原则：只分析对外公开导出的接口，不关注内部实现细节。所有输出内容必须来自实际源码，禁止推断或捏造任何接口、参数、类型或功能描述。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `outputDir` | string | ✅ | 工作目录（仓库源码克隆/复用位置，也是所有产物的输出根目录） |
| `reportPath` | string | ✅ | 报告输出路径（必须位于 `outputDir` 下，禁止指向 `repoDir` 内部，避免污染源码） |
| `repoUrl` | string | ✅ | 仓库 Git 地址 |

**派生变量**：
- `repoName`：从 `repoUrl` 提取仓库名（取 URL 最后一段，去掉 `.git`）
- `repoDir`：仓库源码目录 = `outputDir/repoName`
- `mcpScriptsDir`：MCP 脚本目录 = `3rdLibraryLoop/MCP/scripts`（相对于 workspace 根目录）

---

## 输入依赖

- **前置 SKILL**：无
- **输入文件**：无（通过 `repoUrl` 克隆源码）
- **下游消费者**：`ArkTsLibraryDemoCoverageSkill`（`parse-spec.cjs` 解析本 Skill 生成的报告）、`ArkTsLibraryDemoScenarioSkill`、`ArkTsLibraryXTSDocSkill`

---

## 工作流程

### 步骤 0：准备仓库源码（复用或克隆）

**目标：** 确保 `repoDir`（`outputDir/repoName`）下存在仓库源码。优先复用工作目录下已存在的同名仓库，避免重复克隆。

1. **提取仓库名**：从 `repoUrl` 末尾取仓库名，去掉 `.git` 后缀，确定 `repoDir = outputDir/repoName`

2. **扫描工作目录**：用 `list_dir` 列出 `outputDir` 下所有条目，判定是否为可复用的仓库源码（满足其一即可）：
   - 目录名与 `repoName` 一致；或
   - 目录内含 `.git` 子目录；或
   - 目录内含 `library/Index.ets` 或 `library/src/main/ets/Index.ets`

3. **条件克隆**：若不存在可用仓库：
   ```bash
   git clone --depth=1 {{repoUrl}} {{outputDir}}/{{repoName}}
   ```
   失败时去掉 `--depth=1` 改为完整克隆。克隆后用 `list_dir` 确认 `repoDir/library` 存在。

> ⚠️ 若所有克隆方式均失败，在报告中说明原因并标注 `状态: 失败`，终止后续步骤。
> ⚠️ 克隆目标为 `outputDir/repoName`（仓库名目录），**不要**克隆到 `outputDir/source`。

---

### 步骤 1：运行脚本生成接口规格文档

> ⚠️ **本步骤严格使用本地脚本实现，禁止 AI 手工解析源码。** `render-spec-doc.cjs` 一条命令完成全部工作：TypeScript Compiler API 语义分析 → Index.ets 导出链追踪 → Native `.so` 检测 → 接口成员提取 → JSDoc 提取 → Markdown 文档渲染。无中间 JSON 文件。
>
> ⚠️ **输出路径约束**：`--output` 必须指向 `outputDir` 下的路径（如 `outputDir/interface-spec.md`），**禁止**写入 `repoDir`（clone 代码目录）内部，避免污染源码目录。

```bash
node "{{mcpScriptsDir}}/render-spec-doc.cjs" --libroot "{{repoDir}}" --output "{{reportPath}}"
```

脚本自动输出包含基本信息、接口统计、按类/接口分节（方法/属性/字段/枚举值/函数/变量/类型别名/事件方法汇总）、源文件列表的完整 Markdown 报告。

**验证**：确认脚本退出码为 0、报告文件已生成。若脚本报错（如无法定位 Index.ets），检查 `repoDir` 路径是否正确、仓库是否含 `library/Index.ets` 或 `library/src/main/ets/Index.ets`。
