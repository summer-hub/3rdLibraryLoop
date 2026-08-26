# 脚本使用指南

本文档说明 `rn-extract-interfaces.cjs` 和 `rn-render-spec-doc.cjs` 两个脚本的使用方法。

> 📌 两个脚本统一存放于 `3rdLibraryLoop/MCP/scripts/` 目录（SKILL 目录内不保存副本）。下文命令中的 `{mcpScriptsDir}` 指该目录，可从 SKILL 目录通过 `../../../MCP/scripts` 相对定位。

## 脚本概览

| 脚本 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `rn-extract-interfaces.cjs` | 从 RN 三方库鸿蒙化仓库提取接口规格 | 库根目录路径 | JSON 接口规格文件 |
| `rn-render-spec-doc.cjs` | 将接口规格渲染为 Markdown 文档 | JSON 规格文件或库根目录 | Markdown 文档 |

## rn-extract-interfaces.cjs

### 功能

从 React Native 三方库的鸿蒙化仓库提取接口规格，自动完成以下工作：

1. **拉取上游 npm 源码**：通过 `npm pack` 下载上游原库的已发布包（index.js / index.d.ts）
2. **提取 TurboModule Spec**：从鸿蒙化仓库本地扫描 `Native*.ts` 文件，提取 TurboModule 接口定义
3. **解析 JS 层导出**：自动检测导出模式（CommonJS / ES Module / Side-effect），提取类、接口、函数、变量等导出
4. **解析类型定义**：从上游 `index.d.ts` 提取类和接口的方法签名

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `libroot` (或 `repoDir`) | string | ✅ | 库根目录路径（鸿蒙化仓库目录，包含 package.json） |
| `output` | string | ❌ | 输出 JSON 文件路径（不指定则输出到 stdout） |
| `version` | string | ❌ | 上游 npm 版本号（如 "2.2.0"，不指定则自动从 dependencies/README 推断） |

### CLI 调用方式

```bash
node "{mcpScriptsDir}/rn-extract-interfaces.cjs" \
  --repoDir "{ohosAnalysisRoot}" \
  --output "{outputDir}/interface-spec.json" \
  --version "2.2.0"
```

### 版本推断逻辑

脚本按以下优先级自动推断上游版本号：

1. 用户通过 `--version` 显式指定
2. `package.json` 的 `dependencies` 中与库名匹配的依赖版本
3. `README.md` 中的版本声明（如 `[react-native-xxx@2.2.0]`）
4. 从鸿蒙化仓库自身版本号推断（去除 `-beta`/`-rc` 后缀）
5. 降级到 `npm latest`

### 输出 JSON 结构

```json
{
  "libraryName": "react-native-xxx",
  "libraryAlias": "xxx",
  "entryFile": "upstream:react-native-xxx@2.2.0/index.js",
  "exportStyle": "commonjs | es-module | side-effect | unknown",
  "upstream": { "pkgName": "react-native-xxx", "version": "2.2.0", "isUpstream": true },
  "extractedAt": "2026-08-15T...",
  "summary": { "S": 3, "N": 15, "M": 0, "methods": 10, "properties": 0, "fields": 0 },
  "sources": ["upstream:.../index.js", "upstream:.../index.d.ts"],
  "interfaces": [
    {
      "className": "ModuleName",
      "memberName": "methodName",
      "fullName": "ModuleName.methodName",
      "kind": "method | function | type | variable",
      "isStatic": false,
      "isReadonly": false,
      "isOptional": false,
      "isEvent": false,
      "type": "turbo-module | es-export | commonjs-export | type-decl",
      "layer": "turbo | js",
      "signature": "methodName(param: type): returnType",
      "params": [{ "name": "param", "type": "type", "optional": false, "description": "-" }],
      "returnType": "returnType",
      "description": "方法描述",
      "source": "upstream:.../index.js:42",
      "startLine": 42
    }
  ]
}
```

### 接口类型说明

| type 值 | 说明 | 来源 |
|---------|------|------|
| `turbo-module` | TurboModule Spec 方法 | 鸿蒙化仓库 `Native*.ts` |
| `es-export` | ES Module 导出 | 上游 `index.js`/`index.ts` |
| `commonjs-export` | CommonJS 导出 | 上游 `index.js` |
| `side-effect` | 全局补丁 | 上游 `index.js` |
| `type-decl` | 类型声明 | 上游 `index.d.ts` |

## rn-render-spec-doc.cjs

### 功能

将接口规格数据渲染为 Markdown 格式的接口规格说明书文档。支持两种输入方式：

1. **从 JSON 中间件渲染**：读取 `rn-extract-interfaces.cjs` 生成的 JSON 文件
2. **直接从源码提取并渲染**：一步到位（内部调用 `generateRNSpec`）

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `spec` | string | ⚠️ | 已有的 interface-spec.json 路径（与 libroot 二选一） |
| `libroot` (或 `repoDir`) | string | ⚠️ | 库根目录路径（直接从源码提取，与 spec 二选一） |
| `output` | string | ❌ | 输出 Markdown 文件路径（不指定则输出到 stdout） |
| `version` | string | ❌ | 上游 npm 版本号（仅 libroot 模式有效） |

### CLI 调用方式

**方式一：从 JSON 中间件渲染（推荐）**

```bash
node "{mcpScriptsDir}/rn-render-spec-doc.cjs" \
  --spec "{outputDir}/interface-spec.json" \
  --output "{outputDir}/接口规格说明.md"
```

**方式二：直接从源码提取并渲染（一步到位）**

```bash
node "{mcpScriptsDir}/rn-render-spec-doc.cjs" \
  --libroot "{ohosAnalysisRoot}" \
  --output "{outputDir}/接口规格说明.md" \
  --version "2.2.0"
```

### 生成文档结构

脚本生成的 Markdown 文档包含以下章节：

1. **基本信息**：库名、导入别名、入口文件、导出模式、生成时间、源文件数
2. **接口统计**：类/接口/模块总数、方法/属性/字段数量
3. **按层级分布**：TurboModule 层 vs JS 层接口数量
4. **按类分组的接口详情**：每个类/模块下分方法、函数、属性、字段、变量、类型别名、事件方法
5. **源文件列表**：所有分析的源文件路径

### 依赖关系

```
rn-render-spec-doc.cjs
    └── require('./rn-extract-interfaces.cjs')  (loadSpec / generateRNSpec)
```

> ⚠️ 两个脚本同位于 `MCP/scripts/` 目录。`rn-render-spec-doc.cjs` 通过相对路径 `require('./rn-extract-interfaces.cjs')` 依赖提取脚本。

## 环境要求

- Node.js ≥ 14
- npm（用于 `npm pack` 拉取上游源码）
- 网络访问（npm registry）
- 可选：TypeScript（用于 AST 级别的类型解析，脚本会自动尝试加载）

## 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `npm pack` 失败 | 网络问题或包名错误 | 检查网络连接，确认包名正确 |
| 上游版本不存在 | 版本号错误 | 脚本会自动降级到 `latest`，或通过 `--version` 指定正确版本 |
| `index.d.ts` 未找到 | 上游包未包含类型声明 | 脚本会跳过类型定义提取，仅从 JS 层导出提取 |
| TurboModule Spec 未找到 | 鸿蒙化仓库无 `Native*.ts` 文件 | 脚本会跳过 TurboModule 提取，仅从 JS 层导出提取 |
| 导出模式为 `unknown` | 入口文件无法识别导出模式 | 检查 `package.json` 的 `main`/`module`/`source` 字段是否正确 |
