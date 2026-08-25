# 分析示例

本文档包含两部分：**Dart 导出语法速查**，以及**基于脚本的分析示例**。

---

## 附录：Dart 导出语法速查

### Dart / Flutter

```dart
// 库声明
library my_package;

// 导出其他文件
export 'src/my_class.dart';
export 'src/utils.dart' show usefulFunction;    // 只导出指定名称
export 'src/internal.dart' hide internalHelper;  // 导出除指定名称外的所有
export 'package:other_lib/api.dart';              // 跨包导出

// 直接在文件中定义的导出
class ClassName { ... }
enum EnumName { value1, value2 }
mixin MixinName { ... }
extension StringExtension on String { ... }
typedef Callback = void Function(int);

// 顶层函数和变量
ReturnType functionName(ParamType param) { ... }
const int MAX_VALUE = 100;
final String defaultName = 'unknown';
```

### 私有成员（脚本自动过滤）

```dart
// 以下成员以 _ 开头，被视为私有，脚本自动排除
class _InternalClass { ... }
void _privateFunction() { ... }
String _privateField;
```

---

## 示例 1: 分析 Flutter 三方库（脚本驱动）

### 库结构

```
advertising_id/
├── pubspec.yaml
├── README.md
└── lib/
    ├── advertising_id.dart      ← 入口文件
    └── src/
        └── advertising_id.dart
```

### pubspec.yaml
```yaml
name: advertising_id
description: A Flutter plugin for accessing advertising ID.
version: 1.0.0
```

### lib/advertising_id.dart
```dart
/// 获取广告标识符的 Flutter 插件
library advertising_id;

export 'src/advertising_id.dart';
```

### lib/src/advertising_id.dart
```dart
/// 广告标识符工具类
class AdvertisingId {
  /// 获取广告标识符
  static Future<String?> getAdvertisingId() async {
    // implementation
    return null;
  }

  /// 检查广告追踪是否受限
  static Future<bool> isLimitAdTrackingEnabled() async {
    return false;
  }
}
```

### 执行步骤

#### Phase 2: 运行提取脚本

```bash
node scripts/flutter-extract-interfaces.cjs \
  --repoDir /path/to/advertising_id \
  --output /tmp/analysis/advertising_id/interface-spec.json
```

脚本输出：
```
库源码目录: /path/to/advertising_id
解析完成: 2 个接口
  库名: advertising_id
  入口文件: ./lib/advertising_id.dart
  源文件数: 2
  类级: 1 | 方法: 2 | 属性: 0 | 字段: 0 | 常量: 0
  输出: /tmp/analysis/advertising_id/interface-spec.json
```

#### 生成的 interface-spec.json（摘要）

```json
{
  "libraryName": "advertising_id",
  "entryFile": "./lib/advertising_id.dart",
  "summary": {
    "S": 1,
    "N": 2,
    "methods": 2
  },
  "sources": [
    "./lib/advertising_id.dart",
    "./lib/src/advertising_id.dart"
  ],
  "interfaces": [
    {
      "className": "AdvertisingId",
      "memberName": "getAdvertisingId",
      "fullName": "AdvertisingId.getAdvertisingId",
      "kind": "method",
      "isStatic": true,
      "signature": "static Future<String?> getAdvertisingId()",
      "params": [],
      "returnType": "Future<String?>",
      "description": "获取广告标识符",
      "source": "./lib/src/advertising_id.dart",
      "startLine": 5
    },
    {
      "className": "AdvertisingId",
      "memberName": "isLimitAdTrackingEnabled",
      "fullName": "AdvertisingId.isLimitAdTrackingEnabled",
      "kind": "method",
      "isStatic": true,
      "signature": "static Future<bool> isLimitAdTrackingEnabled()",
      "params": [],
      "returnType": "Future<bool>",
      "description": "检查广告追踪是否受限",
      "source": "./lib/src/advertising_id.dart",
      "startLine": 10
    }
  ]
}
```

#### Phase 3: 运行渲染脚本

```bash
node scripts/flutter-render-spec-doc.cjs \
  --spec /tmp/analysis/advertising_id/interface-spec.json \
  --output /tmp/analysis/advertising_id/接口规格说明.md
```

#### Phase 4: AI 补充

AI 从 README 提取概述，补充到文档开头，并添加注意事项。

### 最终文档

```markdown
# advertising_id 接口规格说明书

> 本文档由 `flutter-extract-interfaces.cjs` 自动生成，基于 Dart 正则解析引擎。

## 基本信息

| 属性 | 值 |
|------|----|
| 库名 | `advertising_id` |
| 入口文件 | `./lib/advertising_id.dart` |
| 源文件数 | 2 |

## 三方库概述

A Flutter plugin for accessing advertising ID. 提供获取设备广告标识符和检查广告追踪限制状态的能力。

## 接口统计

| 统计项 | 数量 |
|--------|------|
| 类/接口/枚举总数 (S) | 1 |
| 方法/属性/字段总数 (N) | 2 |
| 方法数 | 2 |

## 1. AdvertisingId

> 类型: 类 (class)

### 方法

| # | 方法名 | 事件 | 静态 | 参数 | 返回类型 | 说明 |
|---|--------|------|------|------|----------|------|
| 1 | `getAdvertisingId` | 否 | 是 |  | `Future<String?>` | 获取广告标识符 |
| 2 | `isLimitAdTrackingEnabled` | 否 | 是 |  | `Future<bool>` | 检查广告追踪是否受限 |

## 源文件列表

| # | 文件路径 |
|---|----------|
| 1 | `./lib/advertising_id.dart` |
| 2 | `./lib/src/advertising_id.dart` |

## 注意事项

- 广告标识符的可用性取决于用户隐私设置和平台支持
- iOS 上受 ATT（App Tracking Transparency）框架影响
- 返回 null 表示标识符不可用
```

---

## 示例 2: 分析 monorepo 库（flutter_inappwebview）

### 库结构

```
flutter_inappwebview/
├── flutter_inappwebview/                    ← 主包
│   ├── pubspec.yaml
│   └── lib/
│       ├── flutter_inappwebview.dart
│       └── src/
├── flutter_inappwebview_platform_interface/ ← 子包
│   ├── pubspec.yaml
│   └── lib/
└── flutter_inappwebview_android/
    └── lib/
```

### 执行命令

```bash
# 脚本自动检测 monorepo 主包
node scripts/flutter-extract-interfaces.cjs \
  --repoDir /path/to/flutter_inappwebview \
  --output /tmp/analysis/inappwebview/interface-spec.json
```

脚本自动完成：
1. 检测 monorepo 结构，定位主包 `flutter_inappwebview/`
2. 从入口文件追踪 `export 'package:flutter_inappwebview_platform_interface/...'` 跨包导出
3. 递归收集主包和 `flutter_inappwebview_platform_interface` 子包的所有源文件
4. 排除 `_android`/`_ios` 等平台辅助包

### 一步到位模式

```bash
# 直接从源码提取并渲染文档（不保留 JSON 中间件）
node scripts/flutter-render-spec-doc.cjs \
  --libroot /path/to/flutter_inappwebview \
  --output /tmp/analysis/inappwebview/接口规格说明.md
```

---

## 示例 3: 从 Git 仓库克隆并分析

### 输入

```
https://gitcode.com/openharmony-sig/flutter_inappwebview/tree/br_v6.1.5_ohos_dev
```

### Phase 1: 解析 URL 并克隆

- 仓库地址：`https://gitcode.com/openharmony-sig/flutter_inappwebview.git`
- 分支：`br_v6.1.5_ohos_dev`
- 子路径：无

```bash
git clone https://gitcode.com/openharmony-sig/flutter_inappwebview.git /tmp/analysis/inappwebview/source
cd /tmp/analysis/inappwebview/source
git checkout br_v6.1.5_ohos_dev
```

`analysisRoot = /tmp/analysis/inappwebview/source`

### Phase 2: 提取接口

```bash
node scripts/flutter-extract-interfaces.cjs \
  --repoDir /tmp/analysis/inappwebview/source \
  --output /tmp/analysis/inappwebview/interface-spec.json
```

### Phase 3: 渲染文档

```bash
node scripts/flutter-render-spec-doc.cjs \
  --spec /tmp/analysis/inappwebview/interface-spec.json \
  --output /tmp/analysis/inappwebview/接口规格说明.md
```

### Phase 4: AI 补充

读取 README.md 补充概述和注意事项。

---

## 最佳实践总结

### 1. 脚本优先

- 接口提取由 `flutter-extract-interfaces.cjs` 自动完成
- AI 只负责审查补充和文档整合，不手动逐文件读取源码
- 保留 `interface-spec.json` 中间件供下游覆盖率分析复用

### 2. 两步法优于一步法

- 先提取 JSON（`flutter-extract-interfaces.cjs`），再渲染文档（`flutter-render-spec-doc.cjs`）
- JSON 中间件可复用于 Demo 覆盖率分析、XTS 测试覆盖率分析
- 一步法（`--libroot` 直接渲染）适合快速预览，不适合正式分析

### 3. monorepo 处理

- 脚本自动检测 monorepo 结构，无需手动指定主包
- 若自动检测定位错误，直接传入主包路径：`--repoDir /path/to/monorepo/main_package`

### 4. AI 补充内容

脚本无法提取以下内容，需 AI 补充：
- README 中的功能概述和使用场景
- 注意事项、使用限制、兼容性说明
- 缺少 `///` 文档注释的接口的功能描述（根据方法名推断，标注"待确认"）
