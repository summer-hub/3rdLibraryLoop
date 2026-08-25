# 上游 API 重构适配检查清单

本文档提供从上游 API 变更到鸿蒙侧适配的完整检查清单。适用于 callback→Promise、模块名变更、新增/删除方法等场景。

## 一、callback → Promise 迁移检查清单

当上游从 callback 模式迁移到 Promise 模式时，需要修改以下所有层级：

### 1. C++ 方法注册宏变更

| 旧模式（callback） | 新模式（Promise） |
|---------------------|-------------------|
| `ARK_METHOD_METADATA(name, argc)` | `ARK_ASYNC_METHOD_METADATA(name, argc)` |

- `argc` = 不含 callback/Promise 的业务参数数量
- Promise 是返回值，不计入 argc
- callback 是传入参数，在旧模式中计入 argc

```cpp
// 旧（callback）
methodMap_ = {
    ARK_METHOD_METADATA(multiGet, 2),  // keys + callback = 2
};

// 新（Promise）
methodMap_ = {
    ARK_ASYNC_METHOD_METADATA(getValues, 2),  // dbName + keys = 2 (Promise 不计入)
};
```

### 2. ArkTS TurboModule 实现重写

| 旧模式（callback） | 新模式（Promise） |
|---------------------|-------------------|
| `methodName(params, callback)` | `async methodName(params): Promise<ReturnType>` |
| 通过 `callback(error, result)` 返回 | 通过 `return result` 或 `throw new Error()` 返回 |
| 错误通过 callback 参数传递 | 错误通过 Promise reject / throw 传递 |

### 3. 数据格式变更

检查方法参数和返回值的类型是否变化：

| 旧格式 | 新格式 | 变更说明 |
|--------|--------|----------|
| `[string, string][]` | `{ key: string; value: string \| null }[]` | 从元组数组改为对象数组 |
| `[error, result]` 元组 | `Promise<result>` | 从回调元组改为 Promise |
| error 对象 | throw Error / Promise.reject | 错误处理方式变更 |

### 4. 不再需要的工具类

Promise 模式下以下工具类通常不再需要：

- **手动锁类**（如 `AsyncLocker`）：Promise 天然支持 `await` 串行化
- **错误工具类**（如 `AsyncStorageErrorUtil`）：错误通过 throw 传递

### 5. legacy_* 方法

如果上游保留了 legacy 兼容 API，需在 TurboModule 中实现，复用新方法逻辑但使用默认参数（如默认 dbName）。

---

## 二、TurboModule 模块名变更检查清单

当上游 TurboModule 模块名变更时（如 `RNCAsyncStorage` → `RNAsyncStorage`）：

### 1. 确认新旧名称

```bash
# 从上游 spec 文件读取模块名
grep "TurboModuleRegistry.get" src/native-module/Native*.ts
```

### 2. 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `harmony/*/src/main/ets/*Package.ets` | `createTurboModule` 和 `hasTurboModule` 中的 name 匹配 |
| `harmony/*/src/main/cpp/*Package.h` | `createTurboModule` 中的 name 匹配 |
| C++ TurboModule 头文件 | 文件名和类名（`RNCXxx.h` → `RNXxx.h`） |
| C++ TurboModule 实现 | 文件名和类名（`RNCXxx.cpp` → `RNXxx.cpp`） |
| C++ Package include | `#include "RNCXxx.h"` → `#include "RNXxx.h"` |

### 3. 需要删除的旧文件

- 旧的 TurboModule spec 文件（`.ts`）
- 旧的 C++ 头文件（`.h`）
- 旧的 C++ 实现文件（`.cpp`）

### 4. CMakeLists.txt

如果 CMakeLists.txt 使用 `file(GLOB ...)` 自动收集源文件，不需要手动修改。如果使用显式列表，需更新文件名。

---

## 三、多数据库（dbName）支持检查清单

当上游新增多数据库支持时（每个 AsyncStorage 实例可绑定独立数据库）：

### 1. ReactDatabaseSupplier 变更

| 旧模式 | 新模式 |
|--------|--------|
| 单一 `rdbStore` 属性 | `Map<string, RdbStore>` 缓存 |
| `initialRdbStore(context)` | `initialRdbStore(context, dbName)` |
| `ensureDatabase(context)` | `ensureDatabase(context, dbName)` |
| `deleteRdbStore(context)` | `deleteRdbStore(context, dbName)` |
| 无 | `getRdbStore(dbName)` 新方法 |

### 2. TurboModule 方法变更

所有方法新增 `dbName` 参数，通过 `dbName` 获取对应的 `RdbStore` 实例。

---

## 四、codegen-lib-harmony 使用方法

### 调用方式

`codegen-lib-harmony` 命令需要通过 `@react-native-oh/react-native-harmony-cli` 包调用。由于 `react-native` CLI 注册机制的限制，可能需要直接 require 调用：

```javascript
const mod = require('./node_modules/@react-native-oh/react-native-harmony-cli/dist/commands/codegen-lib-harmony');
const cmd = mod.commandCodegenLibHarmony;
const rawArgs = {
  npmPackageName: '@react-native-ohos/xxx',
  tmSpecPaths: ['./src'],
  cppOutputPath: 'harmony/xxx/src/main/cpp',
  etsOutputPath: 'harmony/xxx/src/main/ets',
  generateType: 'all',
  noSafetyCheck: true
};
cmd.func([], {}, rawArgs);
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `npmPackageName` | 库的 npm 包名 |
| `tmSpecPaths` | TurboModule spec 文件路径数组 |
| `cppOutputPath` | C++ 输出目录 |
| `etsOutputPath` | ETS 输出目录 |
| `generateType` | `all`/`turbo-module`/`fabric` |
| `noSafetyCheck` | 跳过安全检查（允许删除已有文件） |

### ⚠️ codegen 会清空输出目录

`codegen-lib-harmony` 会**删除** `cppOutputPath` 和 `etsOutputPath` 目录下的所有文件，包括手写的实现文件。

**必须在 codegen 前 git commit 或备份手写文件**。codegen 后从 git 恢复手写文件，然后手动创建 codegen 未生成的 TurboModule spec 文件。

### codegen 不生成 TurboModule spec

codegen-lib 生成的是 Package 基类和 Fabric 组件 stub，**不生成** TurboModule 的 `.h`/`.cpp`/`.ts` 文件。这些需要根据上游 `src/native-module/Native*.ts` 的接口定义手动创建。

### 前置依赖

运行 codegen-lib 需要安装：
- `@react-native-oh/react-native-harmony-cli`
- `@react-native-community/cli`

```bash
npm install --save-dev @react-native-oh/react-native-harmony-cli@0.84.2 @react-native-community/cli@20.1.0 --legacy-peer-deps
```
