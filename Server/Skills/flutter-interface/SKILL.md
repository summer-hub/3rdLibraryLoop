---
name: flutter-interface
description: 分析 Flutter 三方库的对外接口能力，使用 flutter-extract-interfaces.cjs 脚本自动提取 Dart 源码中的类/枚举/mixin/extension/函数/变量公开接口，生成结构化的接口规格说明文档。当需要理解 Flutter 三方库 API、生成接口规格文档、进行覆盖率分析前置提取时使用。支持 Git 仓库克隆、monorepo 多子包、export 链追踪。
license: MIT
compatibility: 需要 Node.js 运行环境（执行 .cjs 脚本），需要 git（克隆远程仓库时）
metadata:
  version: "1.0.0"
  category: interface-analysis
  language-support: "Dart/Flutter（完整支持，基于正则解析引擎）"
  script-powered: "flutter-extract-interfaces.cjs + flutter-render-spec-doc.cjs"
  git-support: "支持 git clone 从远程仓库克隆代码，支持 Sparse Checkout 稀疏检出"
---

# Flutter Interface Analyzer

本技能用于**分析 Flutter 三方库的对外接口能力**，自动生成标准化的接口规格说明文档。核心接口提取由 `flutter-extract-interfaces.cjs` 脚本完成，AI 负责审查补充和文档整合。

> ⚠️ **核心原则：只分析对外公开导出的接口，不关注内部实现细节。接口提取由脚本自动完成，AI 不手动逐文件读取源码提取接口。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `input` | string | ✅ | Git 仓库 URL 或本地库源码目录路径 |
| `outputDir` | string | ✅ | 输出目录绝对路径 |
| `repoName` | string | ❌ | 仓库名称（从 URL 解析或用户提供） |

---

## 输入依赖

无前置 SKILL。可作为独立任务调用。

---

## 工作流程概览

```
Phase 1: 输入解析与代码获取（Git Clone / 本地路径）
    ↓
Phase 2: 脚本自动提取接口（核心 — flutter-extract-interfaces.cjs）
    ↓
Phase 3: 脚本渲染接口文档（flutter-render-spec-doc.cjs）
    ↓
Phase 4: AI 审查与补充（README 概述、注意事项等脚本无法提取的内容）
    ↓
Phase 5: 最终文档输出
```

---

## Phase 1：输入解析与代码获取

### 1.1 判断输入类型

| 输入形式 | 判断依据 | 处理方式 |
|----------|----------|----------|
| Git 仓库 URL | 以 `http://`、`https://` 开头，含 `.git` 或 `/tree/` | 执行 Git Clone（步骤 1.2） |
| 本地路径 | 以 `/` 或 `~` 开头，目录存在 | 直接使用，跳到 Phase 2 |

### 1.2 Git Clone（仅远程仓库输入）

从 URL 解析仓库地址、分支、子路径，执行克隆：

- **无子路径**：完整克隆 `git clone <baseUrl> <outputDir>/source`
- **有子路径**：稀疏检出（Sparse Checkout），只下载指定文件夹

> **仓库迁移探测（按序尝试，避免浪费轮次）**：Gitee `openharmony-tpc` 组织下的 Flutter 仓库已大规模迁移到 GitCode。克隆 404 时按以下顺序快速探测，**不要**盲目尝试随机组织名：
> 1. `https://gitcode.com/CPF-Flutter/{原仓库名}`（鸿蒙化 Flutter 仓库主要迁移目的地，仓库名可能带 `fluttertpc_` 前缀）
> 2. `https://gitcode.com/openharmony-tpc/{原仓库名}`
> 3. GitCode 站内搜索仓库名（一次搜索定位实际组织）
>
> 找到迁移仓库后，在报告中标注原地址 → 实际地址的映射关系。

> 详细的 URL 解析规则和克隆命令参见 [Git Clone 指南](references/GIT_CLONE_GUIDE.md)

### 1.3 确定分析路径

克隆完成后确定 `analysisRoot`：
- 完整克隆（无子路径）：`analysisRoot = <outputDir>/source`
- 稀疏检出（有子路径）：`analysisRoot = <outputDir>/source/<subpath>`
- 本地路径输入：`analysisRoot = 用户提供的路径`

> 后续所有分析基于 `analysisRoot` 目录进行。

---

## Phase 2：脚本自动提取接口

> ⚠️ **这是本 SKILL 的核心优化点：接口提取由脚本自动完成，AI 不手动逐文件读取源码。**

### 2.1 运行提取脚本

使用 `scripts/flutter-extract-interfaces.cjs` 从 Dart 源码自动提取全部公开接口：

```bash
node scripts/flutter-extract-interfaces.cjs --repoDir <analysisRoot> --output <outputDir>/interface-spec.json
```

**脚本自动完成的工作**：
1. 解析 `pubspec.yaml` 获取包名，定位 `lib/<package>.dart` 入口文件
2. 递归追踪 export 链（`export 'src/xxx.dart'`、`package:xxx/yyy.dart`），收集所有可达源文件
3. 支持 monorepo 多子包（如 `flutter_inappwebview` 含多个子包）
4. 预处理源码：移除字符串/注释（保留行号），保留 `///` 文档注释
5. 正则解析提取：类（含 abstract/mixin class）、枚举（含 Dart 3 增强枚举）、mixin、extension 的成员（方法/属性/字段/构造函数/常量）+ 顶层函数/变量/typedef
6. 过滤私有成员（`_` 前缀）、export hide/show 过滤
7. 提取 `///` 文档注释作为功能描述
8. 输出结构化 JSON（`interface-spec.json`）

> ⚠️ **monorepo 主包定位（重要）**：脚本对仓库根执行时，可能误把 `example` 子包（如 `packages/xxx_example`）识别为多子包一并提取，导致结果混入示例代码。**monorepo 仓库（含 `packages/` 目录）应把 `--repoDir` 指向主包目录**（如 `source/packages/flutter_blue_plus`），而不是仓库根目录。判断依据：`packages/` 下有多个子包时，选取含 `lib/<包名>.dart` 且 `pubspec.yaml` 与仓库名对应的主包。

**输出 JSON 结构**：
```json
{
  "libraryName": "包名",
  "entryFile": "./lib/xxx.dart",
  "extractedAt": "ISO时间戳",
  "summary": { "S": 类数, "N": 接口总数, "methods": N, "properties": N, "fields": N, "constants": N },
  "sources": ["./lib/xxx.dart", ...],
  "interfaces": [
    {
      "className": "ClassName",
      "memberName": "methodName",
      "fullName": "ClassName.methodName",
      "kind": "method|property|field|constant|constructor|enumValue|function|variable|type",
      "isStatic": false,
      "signature": "ReturnType methodName(params)",
      "params": [{ "name": "param", "type": "String", "optional": false }],
      "returnType": "void",
      "description": "/// 文档注释内容",
      "source": "./lib/src/xxx.dart",
      "startLine": 42
    }
  ]
}
```

> 脚本的详细参数说明、输出字段含义、常见问题排查参见 [脚本使用参考](references/SCRIPT_REFERENCE.md)

### 2.2 验证提取结果

检查脚本输出的 JSON：
- 确认 `libraryName` 正确（来自 `pubspec.yaml` 的 `name` 字段）
- 确认 `sources` 列表非空（至少包含入口文件）
- 确认 `interfaces` 数组非空（至少有 1 个接口）
- 若 `interfaces` 为空，检查入口文件是否正确定位（参见 [脚本使用参考](references/SCRIPT_REFERENCE.md) 的故障排查章节）

---

## Phase 3：脚本渲染接口文档

### 3.1 运行渲染脚本

使用 `scripts/flutter-render-spec-doc.cjs` 将 JSON 渲染为 Markdown 文档：

```bash
node scripts/flutter-render-spec-doc.cjs --spec <outputDir>/interface-spec.json --output <outputDir>/接口规格说明.md
```

**也可以一步到位**（跳过 Phase 2 的 JSON 输出，直接从源码生成文档）：

```bash
node scripts/flutter-render-spec-doc.cjs --libroot <analysisRoot> --output <outputDir>/接口规格说明.md
```

> 推荐使用两步方式（先提取 JSON 再渲染），JSON 中间件可复用于下游覆盖率分析。

### 3.2 渲染脚本生成的文档结构

脚本自动生成以下章节：
- **基本信息**：库名、入口文件、生成时间、源文件数
- **接口统计**：类/接口/枚举总数、方法/属性/字段/常量数量
- **按类分组的接口详情**：每个类/枚举/mixin/extension一个章节，含构造函数、方法、属性、字段、常量、枚举值、函数、变量、类型别名、事件方法汇总等子表格
- **源文件列表**：所有被分析的源文件路径

---

## Phase 4：AI 审查与补充

> 脚本已自动完成接口提取和文档渲染，AI 在此阶段负责补充脚本无法提取的内容。

### 4.1 读取 README 补充概述

读取库的 `README.md`，提取：
- 库的功能描述和主要特性
- 适用场景和使用限制

将概述信息补充到文档开头（脚本生成的"基本信息"表格之后）。

### 4.2 补充注意事项

从 README 和代码注释中提取：
- 使用限制和兼容性说明
- 已知问题和注意事项
- 平台支持情况（特别是鸿蒙 `ohos` 平台适配状态）

### 4.3 审查接口完整性

对比脚本输出的接口列表与 README 中提到的 API：
- 确认主要 API 均已被脚本提取
- 若发现遗漏（如脚本正则无法覆盖的特殊语法），手动补充到文档中

### 4.4 人工可读性优化

- 为缺少 `///` 文档注释的接口补充功能描述（根据方法名推断，标注"待确认"）
- 合并或调整表格顺序，提升可读性

> 文档输出格式模板参见 [文档模板](references/TEMPLATE.md)

---

## Phase 5：最终文档输出

### 5.1 合并最终文档

将脚本生成的接口规格文档（Phase 3）与 AI 补充内容（Phase 4）合并为最终文档。

最终文档结构：
```markdown
# [库名] 接口规格说明书

## 基本信息          ← 脚本生成
## 三方库概述        ← AI 从 README 补充
## 接口统计          ← 脚本生成
## [类名] 接口详情   ← 脚本生成（每个类一个章节）
  ### 构造函数
  ### 方法
  ### 属性
  ### 字段
  ### 常量
  ### 枚举值
  ...
## 源文件列表        ← 脚本生成
## 注意事项          ← AI 补充
```

### 5.2 保存文档

将最终文档保存为：`<outputDir>/接口规格说明.md`

**禁止**将文档放置在 source 目录或其他子目录，必须放在输出目录根目录。

### 5.3 保留中间件

保留 `<outputDir>/interface-spec.json` 中间件，可供下游覆盖率分析（Demo 覆盖率、XTS 测试覆盖率）复用。

---

## 工具支持

### 核心脚本

| 脚本 | 用途 | 调用方式 |
|------|------|----------|
| `scripts/flutter-extract-interfaces.cjs` | 从 Dart 源码提取接口规格 JSON | `node scripts/flutter-extract-interfaces.cjs --repoDir <路径> --output <json路径>` |
| `scripts/flutter-render-spec-doc.cjs` | 将 JSON 渲染为 Markdown 文档 | `node scripts/flutter-render-spec-doc.cjs --spec <json路径> --output <md路径>` |

> 脚本详细参数、输出格式、故障排查参见 [脚本使用参考](references/SCRIPT_REFERENCE.md)

---

## 分析示例

详细的分析示例（含脚本输出演示）请参考 [分析示例](references/EXAMPLES.md)。

---

## 注意事项

1. **脚本优先**：接口提取由 `flutter-extract-interfaces.cjs` 自动完成，AI 不手动逐文件读取源码提取接口
2. **只分析公开接口**：脚本自动过滤 `_` 前缀私有成员和 export hide/show，确保只输出对外公开的接口
3. **忠实于源码**：所有接口信息来自脚本解析实际源码，不允许推断或捏造；`description` 字段为空时使用 `-` 表示
4. **monorepo 支持**：脚本自动检测 monorepo 结构（如 `flutter_inappwebview` 含多个子包），无需手动指定主包
5. **export 链追踪**：脚本递归追踪 `export` 语句，支持 `src/` 相对路径和 `package:` 跨包路径，支持 hide/show 过滤
6. **JSON 中间件复用**：`interface-spec.json` 可供下游覆盖率分析脚本复用，避免重复解析源码
7. **文档输出位置**：最终文档必须保存在 `<outputDir>/接口规格说明.md`，不得放在 source 目录内
