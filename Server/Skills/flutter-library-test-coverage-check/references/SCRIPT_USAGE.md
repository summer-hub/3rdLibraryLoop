# 脚本使用指南

> 本文档详细说明本 SKILL 使用的三个 Node.js 共享脚本（位于 `MCP/scripts/`，通过相对路径引用，不保存副本）的用法、参数、输出格式及工作原理。

---

## 脚本概览

| 脚本 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `flutter-extract-interfaces.cjs` | 从 Flutter 库源码提取 Dart 公开接口规格 | 库源码目录 | `interface-spec.json` |
| `flutter-analyze-xts-coverage.cjs` | 分析测试用例覆盖率（test/ 目录） | 库源码目录 + 可选 spec | XTS 覆盖率报告 `.md` |
| `flutter-analyze-demo-coverage.cjs` | 分析 Demo 覆盖率（example/lib 目录） | 库源码目录 + 可选 spec | Demo 覆盖率报告 `.md` |

> 三个脚本位于仓库的 `MCP/scripts/` 目录下（本 SKILL 通过相对路径 `{{skillDir}}/../../../MCP/scripts/` 引用，**不保存脚本副本**），使用 Node.js 运行。`flutter-analyze-xts-coverage.cjs` 和 `flutter-analyze-demo-coverage.cjs` 依赖同目录的 `flutter-extract-interfaces.cjs`（通过 `require`），三者已共存于 `MCP/scripts/`，直接引用即可。
>
> `{{skillDir}}` = 本 SKILL 的 SKILL.md 所在目录（任务 prompt 中“SKILL 目录”下发的绝对路径）。

---

## 1. flutter-extract-interfaces.cjs

### 功能

从 Flutter 三方库源码目录提取完整的 Dart 公开接口规格，包括：
- 公开类（class / abstract class / mixin class）
- 公开枚举（enum，含 Dart 3 增强枚举）
- 公开 Mixin
- 公开 Extension
- 顶层函数、常量、变量、typedef
- 每个类的方法、属性（getter）、构造函数、字段

### 核心策略

1. **pubspec.yaml 解析** → 包名 → `lib/<package>.dart` 入口定位
2. **export 链递归追踪**（`src/` 相对路径 + `package:` 跨包路径）
3. **export hide/show 过滤**
4. **预处理**：移除字符串/注释（保留行号），大括号块匹配提取类体
5. **正则解析**：类/枚举/mixin/extension 成员 + 顶层函数/变量/typedef
6. **`///` 文档注释提取**
7. **`_` 前缀私有成员过滤**
8. **monorepo 多子包支持**（如 flutter_inappwebview）

### 用法

```bash
# 方式一：CLI 参数模式
node "{{skillDir}}/../../../MCP/scripts/flutter-extract-interfaces.cjs" --repoDir <库源码目录> --output <interface-spec.json>

# 方式二：不指定 output，JSON 输出到 stdout
node "{{skillDir}}/../../../MCP/scripts/flutter-extract-interfaces.cjs" --repoDir <库源码目录>

# 方式三：MCP Gateway 模式（JSON 字符串作为第一个参数）
node "{{skillDir}}/../../../MCP/scripts/flutter-extract-interfaces.cjs" '{"libroot":"/path/to/lib","output":"spec.json"}'
```

### 参数

| 参数 | 别名 | 必填 | 说明 |
|------|------|------|------|
| `--repoDir` | `--libroot` | ✅ | 库源码根目录路径（包含 `lib/` 子目录和 `pubspec.yaml`） |
| `--output` | - | ❌ | 输出 JSON 文件路径，不指定则输出到 stdout |

### 库源码目录结构约定

```
# 标准结构
/path/to/lib/
├── <package>.dart          ← 入口文件
├── src/                     ← 库源码
└── constants.dart

# monorepo（如 flutter_inappwebview）
/path/to/flutter_inappwebview/
├── flutter_inappwebview/        ← 主包
│   ├── lib/
│   └── pubspec.yaml
└── flutter_inappwebview_platform_interface/
    └── lib/
```

### 输出格式（interface-spec.json）

```json
{
  "libraryName": "flutter_blue_plus",
  "entryFile": "./lib/flutter_blue_plus.dart",
  "extractedAt": "2024-01-01T00:00:00.000Z",
  "summary": {
    "S": 5,              // 类/接口总数
    "N": 42,             // 接口成员总数
    "M": 0,
    "methods": 20,       // 方法数
    "properties": 8,     // 属性数
    "fields": 10,        // 字段数
    "constants": 4       // 常量数
  },
  "sources": ["./lib/...", "./lib/src/..."],
  "interfaces": [
    {
      "className": "FlutterBluePlus",
      "memberName": "startScan",
      "fullName": "FlutterBluePlus.startScan",
      "kind": "method",          // method|property|field|constant|constructor|enumValue|function|type|variable
      "isStatic": false,
      "isReadonly": false,
      "isEvent": false,
      "type": "class",
      "signature": "Future<void> startScan({Duration timeout})",
      "params": [{"name":"timeout","type":"Duration","optional":true,"description":"-"}],
      "returnType": "Future<void>",
      "description": "开始扫描蓝牙设备",
      "source": "./lib/src/flutter_blue_plus.dart",
      "startLine": 42
    }
  ]
}
```

### 接口类型说明

| kind | 说明 | 是否计入覆盖率 |
|------|------|----------------|
| `method` | 实例/静态方法 | ✅ 计入 |
| `property` | getter 属性 | ✅ 计入 |
| `field` | 实例字段（如 Widget 参数） | ✅ 计入 |
| `function` | 顶层函数 | ✅ 计入 |
| `constant` | const/final 常量 | ❌ 不计入（只读值无业务逻辑） |
| `enumValue` | 枚举值 | ❌ 不计入（枚举常量） |
| `constructor` | 构造函数 | ❌ 不计入（实例化入口） |
| `type` | typedef 类型别名 | ✅ 计入 |
| `variable` | 顶层变量 | ✅ 计入 |

---

## 2. flutter-analyze-xts-coverage.cjs

### 功能

分析 **测试用例** 对 Flutter 库 Dart 公开接口的覆盖程度。扫描以下目录的 `.dart` 测试文件：
- `<libroot>/test/`
- `<libroot>/example/test/`
- `<libroot>/example/integration_test/`

### 用法

```bash
# 方式一：先提取接口，再分析覆盖率（推荐，避免重复提取）
node "{{skillDir}}/../../../MCP/scripts/flutter-extract-interfaces.cjs" --repoDir <库源码目录> --output <outputDir>/interface-spec.json
node "{{skillDir}}/../../../MCP/scripts/flutter-analyze-xts-coverage.cjs" --spec <outputDir>/interface-spec.json --libroot <库源码目录> --output <outputDir>/03-XTS覆盖率报告.md

# 方式二：直接从源码提取接口并分析（一步到位）
node "{{skillDir}}/../../../MCP/scripts/flutter-analyze-xts-coverage.cjs" --libroot <库源码目录> --output <outputDir>/03-XTS覆盖率报告.md
```

### 参数

| 参数 | 别名 | 必填 | 说明 |
|------|------|------|------|
| `--libroot` | `--repoDir` | ✅* | 库根目录路径 |
| `--spec` | - | ❌ | 已有的 `interface-spec.json` 路径（与 libroot 二选一或配合使用） |
| `--output` | - | ❌ | 输出 Markdown 报告路径，默认 `03-xxx-XTS覆盖率报告.md` |
| `--title` | - | ❌ | 报告标题 |
| `--lib` | - | ❌ | 库名覆盖（默认从 pubspec.yaml 读取） |
| `--src` | - | ❌ | 测试源码目录覆盖（默认自动定位） |

> *`--libroot` 和 `--spec` 至少提供一个。如果只提供 `--spec`，`--libroot` 从 spec 文件目录推断。

### 输出报告结构

报告包含以下章节：
1. **基本信息**：库名、源文件数、生成时间
2. **覆盖率总览**：方法级覆盖率百分比 + 进度条
3. **按接口类型统计**：method/property/field/function 等类型的覆盖率
4. **类级覆盖率**：每个类的覆盖数/未覆盖数/覆盖率
5. **未覆盖接口详情**：按类分组的未覆盖接口列表（含签名、参数、说明）
6. **已覆盖接口详情**：按类分组的已覆盖接口列表（含覆盖文件）
7. **文件覆盖详情**：每个测试文件覆盖的接口列表

### 覆盖率匹配引擎说明

脚本使用多层正则匹配策略：

| 匹配策略 | 适用场景 | 示例 |
|----------|----------|------|
| 静态方法匹配 | `ClassName.methodName(` | `FlutterBluePlus.setLogLevel(` |
| 构造函数匹配 | `ClassName(` 或 `ClassName.named(` | `BluetoothDevice.fromId(` |
| 枚举值匹配 | `ClassName.valueName` | `BluetoothState.on` |
| 实例变量追踪 | `varName.methodName(` | `device.connect(` |
| 链式调用匹配 | `ClassName().methodName(` | `Guid().toMac()` |
| 字段直接引用 | `\bfieldName\b` | `isConnected` |
| 命名参数兜底 | `propertyName:` | `timeout: Duration(...)` |
| aliased import 兜底 | `alias.ClassName.methodName(` | `fb.FlutterBluePlus.startScan(` |

---

## 3. flutter-analyze-demo-coverage.cjs

### 功能

分析 **Demo 示例** 对 Flutter 库 Dart 公开接口的覆盖程度。扫描 `example/lib/` 目录的 `.dart` 文件。

### 用法

```bash
# 方式一：使用已有 spec
node "{{skillDir}}/../../../MCP/scripts/flutter-analyze-demo-coverage.cjs" --spec <outputDir>/interface-spec.json --libroot <库源码目录> --output <outputDir>/02-Demo覆盖率报告.md

# 方式二：直接从源码提取
node "{{skillDir}}/../../../MCP/scripts/flutter-analyze-demo-coverage.cjs" --libroot <库源码目录> --output <outputDir>/02-Demo覆盖率报告.md
```

### 参数

与 `flutter-analyze-xts-coverage.cjs` 相同，区别在于：
- Demo 源码目录默认取 `<libroot>/example/lib`（而非 test/）
- 输出文件名默认 `02-xxx-Demo覆盖率报告.md`

### Demo 源码目录定位策略

脚本按以下优先级查找 Demo 目录：
1. `<mainPkgDir>/example/lib`
2. `<mainPkgDir>/examples/lib`
3. `<mainPkgDir>/demo/lib`
4. `<libRoot>/example/lib`

---

## 推荐工作流

```
Step 1: 提取接口规格
    node "{{skillDir}}/../../../MCP/scripts/flutter-extract-interfaces.cjs" \
        --repoDir {outputDir}/source \
        --output {outputDir}/interface-spec.json

Step 2: 分析 XTS 测试覆盖率
    node "{{skillDir}}/../../../MCP/scripts/flutter-analyze-xts-coverage.cjs" \
        --spec {outputDir}/interface-spec.json \
        --libroot {outputDir}/source \
        --output {outputDir}/03-XTS覆盖率报告.md

Step 3: 分析 Demo 覆盖率
    node "{{skillDir}}/../../../MCP/scripts/flutter-analyze-demo-coverage.cjs" \
        --spec {outputDir}/interface-spec.json \
        --libroot {outputDir}/source \
        --output {outputDir}/02-Demo覆盖率报告.md

Step 4: 读取三份报告，结合评分规则生成最终检视报告
```

> **效率提示**：Step 1 提取的 `interface-spec.json` 可被 Step 2 和 Step 3 共享，避免重复提取接口。若不关心中间 JSON，Step 2/3 也可直接使用 `--libroot` 参数一步到位。

---

## 常见问题

### Q: 脚本报错 "无法定位入口文件"

**原因**：`lib/` 目录下没有 `<packageName>.dart` 入口文件。

**解决**：检查 `pubspec.yaml` 中的 `name` 字段，确保 `lib/{name}.dart` 存在。脚本也支持 `lib/main.dart` 和 `lib/index.dart` 作为 fallback。

### Q: 覆盖率偏低，但实际有测试

**原因**：正则匹配可能遗漏某些调用模式。

**解决**：
1. 检查测试文件是否 `import 'package:xxx/...'` 导入了被测库
2. 检查实例变量是否通过类型注解声明（脚本依赖类型注解追踪实例变量）
3. 检查是否有 aliased import（`import ... as alias`）

### Q: monorepo 库的子包接口未提取

**原因**：脚本默认只提取主包的 export 链可达文件。

**解决**：确保子包通过 `export 'package:sub_pkg/...'` 被主包导出。脚本支持跨包 export 追踪。

### Q: 排除的接口类型（constant/enumValue/constructor）

脚本在计算覆盖率时排除以下类型：
- **constant**：`const`/`final` 常量，只读值无业务逻辑
- **enumValue**：枚举常量
- **constructor**：实例化入口，Demo/测试中常通过间接方式获得对象

这些类型在报告中仍会列出（标注"不计入覆盖率"），但不参与覆盖率百分比计算。
