# 脚本使用参考

本文档详细说明 `flutter-extract-interfaces.cjs` 和 `flutter-render-spec-doc.cjs` 两个脚本的参数、输出格式和故障排查。

---

## flutter-extract-interfaces.cjs

### 功能

从 Flutter 三方库源码目录提取接口规格。基于 Dart 正则解析，提取类/枚举/mixin/extension/函数/变量的公开接口，输出 JSON。

### 脚本核心策略

1. `pubspec.yaml` → 包名 → `lib/<package>.dart` 入口定位
2. export 链递归追踪（`src/` 相对路径 + `package:` 跨包路径）
3. export hide/show 过滤
4. 预处理移除字符串/注释（保留行号），大括号块匹配提取类体
5. 正则解析类/枚举/mixin/extension 成员 + 顶层函数/变量/typedef
6. `///` 文档注释提取
7. `_` 前缀私有成员过滤
8. monorepo 多子包支持

### 用法

```bash
# CLI 模式
node flutter-extract-interfaces.cjs --repoDir <库源码目录> --output <interface-spec.json>

# 不指定 output 则输出 JSON 到 stdout
node flutter-extract-interfaces.cjs --repoDir /path/to/flutter_lib
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--repoDir` | string | ✅ | 库源码根目录路径（包含 `lib/` 子目录和 `pubspec.yaml`） |
| `--output` | string | ❌ | 输出 JSON 文件路径（不指定则输出到 stdout） |

> `--libroot` 是 `--repoDir` 的别名，两者等价。

### 库源码目录结构约定

```
/path/to/lib/
├── <package>.dart          ← 入口文件
├── src/                     ← 库源码
└── constants.dart
```

**monorepo（如 flutter_inappwebview）**：

```
/path/to/flutter_inappwebview/
├── flutter_inappwebview/        ← 主包
│   ├── lib/
│   └── pubspec.yaml
└── flutter_inappwebview_platform_interface/
    └── lib/
```

脚本自动检测 monorepo 结构并定位主包。

### 输出 JSON 结构

```json
{
  "libraryName": "包名",
  "entryFile": "./lib/xxx.dart",
  "nativeDPath": null,
  "extractedAt": "2026-08-15T12:00:00.000Z",
  "summary": {
    "S": 10,           // 类/接口/枚举总数
    "N": 50,            // 方法/属性/字段总数
    "M": 0,
    "methods": 30,
    "properties": 10,
    "fields": 5,
    "constants": 5
  },
  "sources": [
    "./lib/xxx.dart",
    "./lib/src/yyy.dart"
  ],
  "interfaces": [
    {
      "className": "ClassName",
      "memberName": "methodName",
      "fullName": "ClassName.methodName",
      "kind": "method",
      "isStatic": false,
      "isReadonly": false,
      "isOptional": false,
      "isEvent": false,
      "type": "class",
      "signature": "ReturnType methodName(params)",
      "params": [
        {
          "name": "paramName",
          "type": "String",
          "optional": false,
          "description": "-"
        }
      ],
      "returnType": "void",
      "description": "/// 文档注释内容",
      "source": "./lib/src/xxx.dart",
      "startLine": 42
    }
  ]
}
```

### 接口 kind 分类

| kind | 说明 | 对应 Dart 语法 |
|------|------|----------------|
| `method` | 类方法 | `ReturnType methodName(params) { }` |
| `property` | getter 属性 | `ReturnType get name` |
| `field` | 类字段 | `final Type field` 或 `Type field` |
| `constant` | 常量 | `const Type name` |
| `constructor` | 构造函数 | `ClassName(params)` 或 `factory ClassName.name(params)` |
| `enumValue` | 枚举值 | `enum Name { value1, value2 }` |
| `function` | 顶层函数 | `ReturnType functionName(params)` |
| `variable` | 顶层变量 | `var name = value` |
| `type` | 类型别名 | `typedef Name = Type` |

### 接口 type 分类（声明类型）

| type | 说明 |
|------|------|
| `class` | 普通类 |
| `abstract_class` | 抽象类 |
| `mixin` | mixin 声明 |
| `mixin_class` | mixin class（Dart 3） |
| `enum` | 枚举 |
| `extension` | 扩展 |
| `function` | 顶层函数 |
| `variable` | 顶层变量 |
| `typedef` | 类型别名 |

---

## flutter-render-spec-doc.cjs

### 功能

将接口规格 JSON 渲染为 Markdown 格式的接口规格说明书文档。

### 用法

```bash
# 方式一：读 JSON 中间件（推荐，可复用 JSON）
node flutter-render-spec-doc.cjs --spec <interface-spec.json> --output <spec.md>

# 方式二：直接从源码提取并渲染（一步到位）
node flutter-render-spec-doc.cjs --libroot <库源码目录> --output <spec.md>
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--spec` | string | 二选一 | 已有的 `interface-spec.json` 路径 |
| `--libroot` | string | 二选一 | 库源码根目录路径（直接从源码提取） |
| `--output` | string | ❌ | 输出 Markdown 文件路径（不指定则输出到 stdout） |

> `--repoDir` 是 `--libroot` 的别名，两者等价。

### 生成的文档结构

```
# [库名] 接口规格说明书

## 基本信息（库名、入口文件、生成时间、源文件数）
## 接口统计（类数、方法数、属性数等）
## 1. [类名]（每个类/枚举/mixin 一个章节）
  ### 构造函数（表格）
  ### 方法（表格：方法名、事件、静态、参数、返回类型、说明）
  ### 属性（表格）
  ### 字段（表格）
  ### 常量（表格）
  ### 枚举值（表格）
  ### 函数（表格）
  ### 变量/常量（表格）
  ### 类型别名（表格）
  ### 事件方法汇总（表格）
## 2. [下一个类名]
  ...
## 源文件列表
```

---

## 模块化调用（编程方式）

两个脚本也可作为 Node.js 模块 `require` 使用：

```javascript
// 提取接口
const { generateSpec } = require('./flutter-extract-interfaces.cjs');
const spec = generateSpec('/path/to/flutter_lib');
// spec 是 JSON 对象，可直接使用或写入文件

// 渲染文档需要通过 CLI 调用
// 或自行实现渲染逻辑
```

---

## 故障排查

### 提取结果为空（interfaces 数组为空）

| 可能原因 | 排查方法 | 解决方案 |
|----------|----------|----------|
| 入口文件未找到 | 检查 `lib/<package>.dart` 是否存在 | 确认 `pubspec.yaml` 的 `name` 字段与入口文件名匹配 |
| 源文件无 export | 检查入口文件是否使用 `export` 语句导出 | 脚本同时收集 `lib/` 下所有 `.dart` 文件作为 fallback |
| 所有成员都是私有 | 检查成员是否以 `_` 开头 | 私有成员被自动过滤，属于正常行为 |
| 目录结构异常 | 检查 `analysisRoot` 是否正确 | 确认路径指向包含 `lib/` 的目录 |

### monorepo 主包定位错误

脚本自动检测 monorepo 主包，优先级：
1. 与根目录名完全匹配的子目录
2. 去掉 `fluttertpc_` 前缀后匹配的子目录
3. 排除 `platform_interface`/`_android`/`_ios` 等辅助包后按名称排序的第一个

如果定位错误，可手动指定主包路径直接传入：
```bash
node flutter-extract-interfaces.cjs --repoDir /path/to/monorepo/main_package
```

### export 链追踪不完整

脚本递归追踪 `export` 语句，但以下情况可能遗漏：
- 动态 export（条件 export）
- 通过 `part`/`part of` 拆分的文件（已支持但可能有边缘情况）

排查方法：检查输出 JSON 的 `sources` 数组，确认关键源文件是否被包含。

### 文档注释未提取

脚本提取 `///` 格式的文档注释。以下格式不被提取：
- `//` 单行注释（非文档注释）
- `/* */` 块注释（非文档注释）
- `/** */` JSDoc 风格（仅提取紧邻声明上方的 `*` 行）

---

## 性能说明

- 脚本基于正则解析，不依赖 Dart SDK 或 analyzer，适合 CI/CD 环境
- 大型库（如 `flutter_inappwebview`，数百个源文件）提取时间通常 < 5 秒
- 内存占用与源文件总大小成正比，无特殊内存优化需求
