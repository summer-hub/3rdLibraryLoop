---
name: rn-library-interface-analyzer
description: RN 三方库双仓库接口分析，下载鸿蒙化仓库与上游原库，使用脚本自动提取上游原库的对外接口规格（JS/TS API + TurboModule Spec），生成结构化接口规格说明文档，并对照鸿蒙 RN 三方库使用文档标注差异接口的文档覆盖情况。当需要对 RN 三方库进行接口分析、生成 API 规格文档、或启动 RN 仓库检视流程时使用。作为 RN 仓库检视流程的第一阶段。
license: Apache-2.0
compatibility: 需要访问 Git 仓库、需要 git 命令（≥ 2.25.0 支持 Sparse Checkout）、需要 Node.js ≥ 14 和 npm（运行接口提取脚本）、需要网络访问
metadata:
  version: "1.0.0"
---

# RNLibraryInterfaceAnalyzer

RN 三方库**双仓库接口分析** SKILL，负责下载鸿蒙化仓库与上游原库，以**脚本驱动**方式提取对外公开接口规格，生成结构化接口规格说明文档。

> ⚠️ **核心定位与原则**：
> 1. **上游原库接口为权威基准**：鸿蒙化库的接口默认与原库一致，因此以原库导出接口为主体
> 2. **鸿蒙化仓库仅补充标注差异**：仅记录鸿蒙化版本新增、缺失或签名变更的接口
> 3. 本 SKILL 是 RN 仓库检视流程的**第一阶段**，输出供后续稳定性检视、一致性检视等 SKILL 使用
> 4. **只分析对外公开导出的接口**，不关注内部实现细节
> 5. **差异接口需标注文档覆盖情况**：对照鸿蒙 RN 三方库使用文档标注差异接口的覆盖情况
> 6. **所有文件必须存放在 outputDir 下**：禁止将文件写入系统临时目录或其他外部路径
> 7. **接口提取使用脚本自动化**：通过 `rn-extract-interfaces.cjs` 和 `rn-render-spec-doc.cjs` 脚本完成接口提取和文档渲染，AI 负责差异标注和原生模块补充分析

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `upstreamRepoUrl` | ✅ | 上游原社区仓库地址（支持 Git URL / 本地路径 / npm 包名） |
| `ohosRepoUrl` | ✅ | 鸿蒙化仓库地址（支持 Git URL / 本地路径） |
| `outputDir` | ✅ | 输出目录绝对路径，存放检视报告和源码 |
| `libraryName` | ✅ | 仓库名称（用于报告标识） |
| `rndocUrl` | ❌ | 鸿蒙 RN 三方库使用文档地址。若未提供，则使用鸿蒙化仓库根目录 `README.md` |

> 💡 分支和子路径从 URL 中自动解析，无需单独指定。详细 URL 格式参见 [URL 格式解析规则](references/URL_PARSING_RULES.md)

**派生变量**：
- `skillDir`：本 SKILL 所在目录
- `mcpScriptsDir`：分析脚本所在目录 = `{{skillDir}}/../../../MCP/scripts`（即 `3rdLibraryLoop/MCP/scripts`）

---

## 输入依赖

无前置 SKILL。可作为独立任务调用。

---

## 脚本依赖

接口提取与文档渲染脚本统一存放在 MCP 脚本目录，**本 SKILL 目录内不保存脚本副本**：

```
3rdLibraryLoop/MCP/scripts/rn-extract-interfaces.cjs
3rdLibraryLoop/MCP/scripts/rn-render-spec-doc.cjs
```

**调用方式**：通过 `node` 命令行直接执行，使用 `{{skillDir}}/../../../MCP/scripts/` 相对路径定位脚本。

---

## 目录结构约定

> ⚠️ **所有新增文件**都必须存放在 `{outputDir}` 内。

```
{outputDir}/
├── 接口规格说明.md          # 最终输出报告（脚本生成基础 + AI 补充差异）
├── interface-spec.json      # 脚本生成的接口规格 JSON（中间产物）
├── clone-info.json          # 双仓库克隆元信息
├── source/
│   ├── RN/                  # 上游原库源码
│   └── ohos/                # 鸿蒙化仓库源码
└── tmp/
    └── rndoc/               # 使用文档参考（仅当 rndocUrl 为 Git URL 时）
```

---

## 工作流程概览

```
Phase 1: 双仓库获取（Git 克隆 / 本地链接 / npm 解包）
    ↓
Phase 2: 接口提取（脚本驱动 — rn-extract-interfaces.cjs）
    ↓
Phase 3: 鸿蒙化仓库差异标注（AI 对比 + 文档覆盖查询）
    ↓
Phase 4: 文档生成（脚本渲染 + AI 补充差异章节）
    ↓
Phase 5: 最终输出
```

---

## Phase 1：双仓库获取

### 1.1 解析 URL 参数

对每个仓库 URL，按 [URL 格式解析规则](references/URL_PARSING_RULES.md) 提取仓库基础 URL、分支/commit、子路径。

### 1.2 检查环境

```bash
git --version    # 确认 Git ≥ 2.25.0
node --version   # 确认 Node.js ≥ 14
npm --version    # 确认 npm 可用（接口提取脚本依赖）
```

### 1.3 获取上游原库

根据输入类型分别处理（Git URL 克隆 / 本地路径 / npm 包名），克隆命令参见 [URL 格式解析规则](references/URL_PARSING_RULES.md) 中的"克隆命令参考"。

### 1.4 获取鸿蒙化仓库

同上游获取流程（不支持 npm 包名）。克隆到 `{outputDir}/source/ohos`。

### 1.5 验证获取结果

- `{outputDir}/source/ohos/` 包含鸿蒙化源码文件
- `{outputDir}/source/RN/` 包含上游原库源码文件

### 1.6 记录获取信息

将克隆元信息写入 `{outputDir}/clone-info.json`，包含 ohos、upstream、rndoc 三部分的 baseUrl、branch、commit、subpath、inputType 等字段。

### 1.7 确定分析路径

- 鸿蒙化仓库：`ohosAnalysisRoot = {outputDir}/source/ohos` （有子路径时追加）
- 上游原库：`upstreamAnalysisRoot = {outputDir}/source/RN` （有子路径时追加）

### 1.8 获取失败处理

参见 [URL 格式解析规则](references/URL_PARSING_RULES.md) 中的"获取失败处理"表。

---

## Phase 2：接口提取（脚本驱动）

> ⚠️ **这是本 SKILL 的核心工作**，使用脚本自动提取接口，替代人工逐文件分析。

### 2.1 分析库的 README

读取 `upstreamAnalysisRoot` 下的 README.md，提取库的名称、功能描述、主要特性、支持的平台。此信息用于最终报告的概述章节。

### 2.2 运行接口提取脚本

在 `ohosAnalysisRoot` 目录上运行 `rn-extract-interfaces.cjs` 脚本：

```bash
node "{{skillDir}}/../../../MCP/scripts/rn-extract-interfaces.cjs" \
  --repoDir "{ohosAnalysisRoot}" \
  --output "{outputDir}/interface-spec.json"
```

> 💡 脚本会自动完成以下工作：
> - 从 `ohosAnalysisRoot` 的 `package.json` 推断上游库名和版本
> - 通过 `npm pack` 拉取上游 npm 源码（index.js / index.d.ts）
> - 从鸿蒙化仓库本地提取 TurboModule Spec（`Native*.ts`）
> - 解析 JS 层导出（CommonJS / ES Module / Side-effect）
> - 解析类型定义（index.d.ts 中的 class / interface）
> - 输出结构化 JSON 接口规格

> ⚠️ 如需指定上游版本，添加 `--version "x.x.x"` 参数。版本推断逻辑详见 [脚本使用指南](references/SCRIPT_USAGE_GUIDE.md)。

### 2.3 验证提取结果

读取 `{outputDir}/interface-spec.json`，确认：
- `interfaces` 数组非空
- `summary` 字段包含合理的接口统计
- `upstream` 字段记录了拉取的包名和版本

### 2.4 原生模块补充分析（按需）

> 脚本仅提取 JS/TS 层和 TurboModule Spec。旧式原生模块需 AI 手动补充。

如果库包含 iOS（`RCT_EXPORT_MODULE`）或 Android（`ReactPackage`）原生模块代码，AI 手动提取：

**iOS 原生模块**（主体）：
- 模块名（`RCT_EXPORT_MODULE()` 宏）
- 导出方法（`RCT_EXPORT_METHOD` / `RCT_REMAP_METHOD`）
- 导出常量、事件支持

**Android 原生模块**（补充差异）：
- 仅列出与 iOS 差异的方法、常量、事件

> 💡 如果库仅使用 JS/TS 层和 TurboModule（新架构），可跳过此步骤。

### 2.5 提取失败处理

| 问题 | 解决方案 |
|------|----------|
| `npm pack` 失败 | 检查网络、确认包名。脚本会自动降级到 `latest` |
| `index.d.ts` 未找到 | 脚本会跳过类型定义提取，仅从 JS 层导出 |
| 导出模式为 `unknown` | 检查 `package.json` 的 `main`/`module` 字段 |
| Node.js 未安装 | 提示用户安装 Node.js ≥ 14 |

详细问题排查参见 [脚本使用指南](references/SCRIPT_USAGE_GUIDE.md)。

---

## Phase 3：鸿蒙化仓库差异标注

> ⚠️ 鸿蒙化库的接口默认与原库一致，此阶段仅**补充标注差异**。

### 3.1 扫描鸿蒙化仓库结构

快速扫描 `ohosAnalysisRoot` 识别入口文件（`Index.ets`、`index.ts`）、`oh-package.json5`、鸿蒙特有文件。

### 3.2 标注差异接口

基于 Phase 2 提取的接口清单（`interface-spec.json`），对比鸿蒙化版本：

- ❌ **缺失接口**：原库有但鸿蒙化版本未实现的接口
- 🆕 **新增接口**：鸿蒙化版本特有的接口
- ⚠️ **签名变更**：参数类型、返回值类型有调整的接口

> 💡 差异标注应简洁，每个差异项一行说明即可。

### 3.3 查询使用文档标注情况

为每个差异接口补充"文档是否标注"信息。详细的文档来源确定、文件定位、判定规则参见 [文档标注查询指南](references/DOC_ANNOTATION_GUIDE.md)。

**核心流程**：
1. 确定文档来源（`rndocUrl` > 鸿蒙化仓库 README.md）
2. 定位文档文件
3. 通读文档，定位 "HarmonyOS Support" 列表格
4. 逐项核对标注（名称归一化匹配 → 判定规则）

> 💡 文档来源为 Git URL 时，克隆到 `{outputDir}/tmp/rndoc`。

---

## Phase 4：文档生成（脚本驱动）

### 4.1 运行文档渲染脚本

使用 `rn-render-spec-doc.cjs` 从 `interface-spec.json` 生成基础接口规格文档：

```bash
node "{{skillDir}}/../../../MCP/scripts/rn-render-spec-doc.cjs" \
  --spec "{outputDir}/interface-spec.json" \
  --output "{outputDir}/接口规格说明.md"
```

> 💡 脚本自动生成：基本信息、接口统计、按层级分布、按类分组的接口详情、源文件列表。

> ⚠️ 脚本依赖 `rn-extract-interfaces.cjs`（通过相对路径 `require`），两个脚本同位于 `MCP/scripts/` 目录。详见 [脚本使用指南](references/SCRIPT_USAGE_GUIDE.md)。

### 4.2 AI 补充差异章节

在脚本生成的文档末尾，AI 补充以下章节（基于 Phase 3 的差异分析结果）：

- **原生模块导出接口**（如有，来自 Phase 2.4）
- **鸿蒙化接口差异**：
  - 缺失接口 ❌ 表格（接口名、原库位置、文档是否标注、说明）
  - 新增接口 🆕 表格（接口名、鸿蒙化位置、文档是否标注、说明）
  - 签名变更 ⚠️ 表格（接口名、原库签名、鸿蒙化签名、文档是否标注、变更说明）

### 4.3 完善概述章节

在文档开头补充概述信息：
- 上游原库地址
- 鸿蒙化仓库地址
- 库功能描述（来自 Phase 2.1 的 README 分析）

> 💡 最终文档结构参见 [报告模板](assets/REPORT_TEMPLATE.md)。

---

## Phase 5：最终输出

确认输出目录包含所有文件：

```
{outputDir}/
├── 接口规格说明.md          # ✅ 最终报告（脚本生成 + AI 补充）
├── interface-spec.json      # ✅ 接口规格 JSON（中间产物，供后续 SKILL 使用）
├── clone-info.json          # ✅ 克隆元信息
├── source/ohos/             # ✅ 鸿蒙化仓库源码
├── source/RN/               # ✅ 上游原库源码
└── tmp/rndoc/               # 使用文档参考（如有）
```

---

## 输出产物

| 文件 | 路径 | 说明 |
|------|------|------|
| 接口规格说明.md | `{outputDir}/接口规格说明.md` | 以上游原库为基准的接口规格文档（脚本生成 + AI 补充差异） |
| interface-spec.json | `{outputDir}/interface-spec.json` | 脚本生成的结构化接口规格 JSON |
| clone-info.json | `{outputDir}/clone-info.json` | 双仓库及文档克隆元信息 |
| source/ohos/ | `{outputDir}/source/ohos/` | 鸿蒙化仓库源码 |
| source/RN/ | `{outputDir}/source/RN/` | 上游原库源码 |

---

## 评分

本阶段不产出评分，仅产出接口规格说明文档，供后续检视 SKILL 参考。
