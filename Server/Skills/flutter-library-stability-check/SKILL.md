---
name: flutter-library-stability-check
description: 对 Flutter 三方库的鸿蒙化代码进行稳定性检视，聚焦鸿蒙化新增的 ArkTS/ETS 代码，分析异常处理、资源释放、并发安全、调用链完整性等稳定性维度，生成严苛评分报告（0-100分）。仅对鸿蒙化新增代码评分，原库上游问题列入风险提示但不纳入评分。作为 Flutter 仓库检视流程的第二阶段，依赖 library-interface-analyzer 的输出。
license: Apache-2.0
compatibility: 需要访问 Git 仓库、分析 ohos 目录源码、识别代码来源（Copyright/git blame）
metadata:
  author: CPPAgent
  version: "3.0"
---

# FlutterLibraryStabilityCheckSkill

对 Flutter 三方库的**鸿蒙化实现代码**进行稳定性检视，评估库在异常情况下的处理能力、资源管理安全性、跨语言调用可靠性等关键稳定性指标。

> ⚠️ **核心定位**：本 SKILL **仅对鸿蒙化新增代码评分**，原库上游代码问题列入"上游风险提示"但不纳入评分。检视范围通过**智能扫描 + 代码来源识别**双重判定。
> 
> **代码来源识别维度**：
> - **Copyright 声明**：`"Huawei Device Co., Ltd."` / `"OpenHarmony"` → 鸿蒙化新增；`"The Kraken authors"` / 其他 → 原库上游
> - **文件类型特征**：`.ets`（ArkTS/ETS）、`module.json5`（鸿蒙模块配置）
> - **API 调用特征**：`@ohos.*`、`napi_*`、`import from '@ohios'`、`geoLocationManager` 等
> - **平台标识特征**：目录名包含 `ohos`、`harmony`、`openharmony` 等
> - **配置文件特征**：`oh-package.json5`、`build-profile.json5`
> 
> ⚠️ **架构适配**：部分 Flutter 三方库使用 **dart:ffi + MethodChannel** 而非 NAPI 桥接。此类项目中：
> - Phase 3（NAPI 层分析）标记为 N/A，不扣分
> - 评分以 ArkTS/ETS 鸿蒙化代码质量为主
> - C++ 原库代码（即使为 OHOS 编译）列为上游风险提示

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `repoUrl` | ✅ | Git 仓库地址，支持分支参数 `?branch=xxx` |
| `outputDir` | ✅ | 输出目录绝对路径，存放检视报告 |
| `interfaceDocPath` | ✅ | 接口规格说明文档路径（由 library-interface-analyzer 生成） |
| `repoName` | ✅ | 仓库名称（用于报告标识） |

---

## 输入依赖

本 SKILL 是 Flutter 仓库检视流程的**第二阶段**，依赖：

- **前置 SKILL**: `library-interface-analyzer`
- **输入文件**: `接口规格说明.md`（位于 outputDir）
- **仓库源码**: 已克隆到 `{outputDir}/source/`，通过智能扫描定位鸿蒙化代码

---

## 工作流程

### Phase 1：鸿蒙代码智能定位与范围识别

**通过多维度特征扫描**，智能识别鸿蒙化代码，而非依赖固定目录名称。

#### 1.1 扫描策略（优先级递减）

| 扫描维度 | 特征模式 | 权重 | 说明 |
|----------|----------|------|------|
| **文件类型** | `*.ets` 文件 | ⭐⭐⭐ 高 | ArkTS/ETS 文件是鸿蒙化的最强特征 |
| **配置文件** | `module.json5`、`oh-package.json5` | ⭐⭐⭐ 高 | 鸿蒙特有的模块配置文件 |
| **API 调用** | `@ohos.*`、`napi_*`、`import from '@ohos'` | ⭐⭐ 中 | 鸿蒙 API 特征 |
| **目录标识** | 目录名包含 `ohos`、`harmony`、`openharmony` | ⭐ 低 | 辅助参考，可能使用其他名称 |
| **C++ NAPI** | `napi_create_reference`、`napi_value` 等 | ⭐⭐ 中 | Native 层鸿蒙绑定特征 |

#### 1.2 扫描执行流程

```bash
# Step 1: 扫描 ArkTS/ETS 文件（最高优先级）
find {sourceDir} -name "*.ets" -type f

# Step 2: 扫描鸿蒙配置文件
find {sourceDir} -name "module.json5" -o -name "oh-package.json5" -type f

# Step 3: 扫描 NAPI 相关 C++ 文件
grep -r "napi_" --include="*.cpp" --include="*.h" {sourceDir}

# Step 4: 扫描 @ohos API 导入
grep -r "import.*@ohos" --include="*.ets" --include="*.ts" {sourceDir}
```

#### 1.3 代码定位结果分类

根据扫描结果，将代码分为以下类别：

```
检视范围判定：
├── 鸿蒙核心代码（必检视）
│   ├── *.ets 文件                 # ArkTS/ETS 实现 ✅ 检视
│   │   ├── plugin*.ets           # Plugin 实现
│   │   ├── entry*.ets            # Ability 入口
│   │   └── *.ets                 # 其他 ETS 文件
│   ├── module.json5              # 模块配置 ✅ 检视
│   ├── napi_*.cpp / *.cpp        # Native NAPI 绑定 ✅ 检视
│   └── oh-package.json5          # 依赖配置 ⚠️ 辅助参考
├── 非鸿蒙代码（不检视）
│   ├── android/                  # Android 实现 ❌ 不检视
│   ├── ios/                      # iOS 实现 ❌ 不检视
│   ├── lib/                      # Flutter Dart 层 ❌ 不检视
│   └── 未包含鸿蒙特征的代码      ❌ 不检视
├── 疑似鸿蒙代码（需验证）
│   ├── 目录名含 harmony/ohos 但无 .ets 文件  ⚠️ 进一步检查
│   └── 含部分 napi 调用但无完整结构  ⚠️ 进一步检查
```

#### 1.4 判定规则

| 扫描结果 | 判定 | 评分 | 后续操作 |
|----------|------|------|----------|
| 发现 `.ets` 文件 | ✅ 存在鸿蒙化 | 正常评分 | 进入 Phase 1.5 代码来源分类 |
| 发现 `module.json5` + NAPI 代码 | ✅ 存在鸿蒙化 | 正常评分 | 进入 Phase 1.5 代码来源分类 |
| 仅发现目录名含 `ohos` 但无代码文件 | ⚠️ 疑似未完成 | 0-30 分 | 报告标注"鸿蒙化代码疑似缺失" |
| 未发现任何鸿蒙特征 | ❌ 未实现鸿蒙化 | 0 分 | 报告标注"未发现鸿蒙化实现代码" |
| 无法访问源码目录 | ❌ 无法检视 | 0 分 | 报告标注"源码目录不可访问" |

**重要说明**：
- **不以固定目录名否定**：即使没有 `ohos/` 目录，只要发现 `.ets` 文件或鸿蒙 API 调用，即判定为存在鸿蒙化
- **不以目录名肯定**：仅有 `ohos/` 目录名但无实际代码文件，不认定为鸿蒙化完成
- **优先代码特征**：文件类型和 API 调用特征优先级高于目录名称

### Phase 1.5：代码来源分类（评分范围划定）

**关键步骤**：区分鸿蒙化新增代码与原库上游代码，确保评分仅针对鸿蒙化开发者的工作。

#### 1.5.1 分类策略

通过以下方法识别每个扫描发现的文件的代码来源：

| 识别方法 | 优先级 | 说明 |
|----------|--------|------|
| **Copyright 声明** | ⭐⭐⭐ 最高 | 检查文件头部 Copyright 声明，区分鸿蒙化新增 vs 原库上游 |
| **Git blame 历史** | ⭐⭐ 中 | 查看文件修改历史，鸿蒙化分支新增的文件为鸿蒙化代码 |
| **文件位置特征** | ⭐ 低辅助 | `ohos/` 目录下的 `.ets` 文件通常是鸿蒙化新增；`bridge/` 下的 C++ 通常为原库 |

#### 1.5.2 分类执行流程

```bash
# Step 1: 检查 Copyright 声明（最可靠）
# 鸿蒙化代码特征：Copyright 中包含 "Huawei Device Co., Ltd." 或 "OpenHarmony"
grep -r "Copyright.*Huawei Device" --include="*.ets" --include="*.ts" --include="*.cpp" --include="*.h" {sourceDir}

# Step 2: 检查原库代码 Copyright
# 原库代码特征：Copyright 中包含原始项目名（如 "The Kraken authors"），不含华为/OpenHarmony
grep -r "Copyright" --include="*.ets" --include="*.ts" --include="*.cpp" --include="*.h" {sourceDir}

# Step 3: 检查 git blame（辅助验证）
# 查看文件最近修改是否为鸿蒙化分支新增
git log --oneline -- {sourceDir}/ohos/
git log --oneline -- {sourceDir}/bridge/
```

#### 1.5.3 分类结果

```
代码来源分类：
├── 鸿蒙化新增代码（✅ 纳入评分）
│   ├── *.ets 文件（Copyright: Huawei/OpenHarmony）  ✅ 评分
│   ├── module.json5 / oh-package.json5              ✅ 评分
│   ├── build_ohos.ps1 / CMakeLists.ohos.txt         ✅ 评分
│   ├── napi_*.cpp（鸿蒙化新增的 NAPI 绑定）          ✅ 评分
│   └── EntryAbility.ets / Index.ets                 ✅ 评分
├── 原库上游代码（⚠️ 不纳入评分，列入风险提示）
│   ├── bridge/*.cpp / *.h（原库 C++ 桥接）           ⚠️ 风险提示
│   ├── foundation/*.cc / *.h（原库基础设施）          ⚠️ 风险提示
│   ├── kraken/lib/*.dart（Flutter Dart 层）          ⚠️ 风险提示
│   └── 其他原库代码（无华为/OpenHarmony Copyright）   ⚠️ 风险提示
├── 需验证来源的代码
│   ├── 无 Copyright 声明的文件                       ⚠️ 需通过 git blame 验证
│   └── Copyright 不明确的文件                        ⚠️ 需进一步分析
```

#### 1.5.4 分类判定规则

| 分类条件 | 判定 | 评分影响 | 报告处理 |
|----------|------|----------|----------|
| Copyright 包含 "Huawei Device Co., Ltd." / "OpenHarmony" | 鸿蒙化新增 | ✅ 纳入评分 | 列入"检视范围" |
| Copyright 不含华为/OpenHarmony（含原项目名） | 原库上游 | ❌ 不纳入评分 | 列入"上游风险提示" |
| 无 Copyright 声明 + 在 `ohos/` 目录 + `.ets` 文件 | 推定为鸿蒙化 | ✅ 纳入评分 | 列入"检视范围"，标注"推定" |
| 无 Copyright 声明 + 不在 `ohos/` 目录 + `.cpp` 文件 | 推定为原库 | ❌ 不纳入评分 | 列入"上游风险提示"，标注"推定" |
| 无 Copyright + git blame 显示鸿蒙化分支新增 | 鸿蒙化新增 | ✅ 纳入评分 | 列入"检视范围" |

#### 1.5.5 架构类型判定

同时判定项目的 Native 桥接架构类型，影响后续分析范围：

| 架构特征 | 架构类型 | Phase 3 处理 | 评分调整 |
|----------|----------|-------------|----------|
| 发现 `napi_*` 调用在鸿蒙化新增 C++ 文件中 | NAPI 架构 | 正常分析 | Phase 3 正常评分 |
| 发现 `napi_*` 调用但仅在原库 C++ 文件中 | 原库含 NAPI + 鸿蒙化无新增 NAPI | Phase 3 N/A（原库 NAPI 不评分） | Phase 3 标记全部通过 |
| 无任何 `napi_*` 调用（使用 dart:ffi / MethodChannel） | FFI 架构 | Phase 3 N/A | Phase 3 标记全部通过 |
| 仅发现 CMakeLists.ohos.txt（编译配置） | 编译适配型 | Phase 3 N/A | Phase 3 标记全部通过 |

**关键原则**：
- **原库 C++ 代码即使为 OHOS 编译，也不纳入评分** — 鸿蒙化开发者仅添加编译配置，未修改源码
- **仅鸿蒙化新增的 NAPI C++ 文件纳入 Phase 3 评分**
- **dart:ffi / MethodChannel 架构项目中，Native 层稳定性由原库保证，不属于鸿蒙化检视范围**

---

### Phase 2：ArkTS 层稳定性分析（仅鸿蒙化代码）

> ⚠️ **评分范围**：Phase 2 仅分析**鸿蒙化新增的 ArkTS/ETS 代码**（Phase 1.5 分类结果中标记为"纳入评分"的文件）。原库代码中的异常处理问题不扣分。

#### 2.1 NAPI 引用管理 / FFI 资源管理（致命项，20分）

NAPI 引用是鸿蒙 Native 层最核心的资源，错误管理会导致内存泄漏或崩溃。

> ⚠️ **架构适配**：若项目使用 **dart:ffi + MethodChannel** 而非 NAPI（Phase 1.5 判定），ArkTS 层无直接 NAPI/FFI 资源管理，此维度全部标记为通过（20/20），不扣分。

| 检查项 | 问题描述 | 扣分规则 | 适用条件 |
|--------|----------|----------|----------|
| `napi_ref` 创建 | 是否为需要长期持有的对象创建 `napi_ref` | 缺失扣 5 分 | 仅 NAPI 架构 |
| `napi_ref` 释放 | 是否在 dispose/destroy 时调用 `napi_delete_reference` | **未释放扣 20 分（致命）** | 仅 NAPI 架构 |
| 引用计数平衡 | `napi_create_reference` 和 `napi_delete_reference` 数量是否匹配 | 不平衡扣 15 分 | 仅 NAPI 架构 |
| 引用有效性检查 | 使用前是否检查 ref 是否有效 | 未检查扣 5 分 | 仅 NAPI 架构 |
| MethodChannel 引用清理 | 是否在 onDetachedFromEngine 清空所有引用 | 未清空扣 5 分 | 仅 FFI 架构 |
| 静态注册表清理 | 是否在 destroy 时从静态 Map/注册表删除 | 未删除扣 5 分 | 仅 FFI 架构 |

**代码示例**：

```typescript
// ❌ 致命错误：NAPI 引用未释放
export class MyPlugin {
  private napiRef: napi_ref | null = null;
  
  constructor() {
    napi_create_reference(env, value, 1, &this.napiRef); // 创建引用
    // 缺少释放逻辑！
  }
  
  // 没有 onDestroy 或 dispose 方法释放 napi_ref
}

// ✅ 正确实现
export class MyPlugin {
  private napiRef: napi_ref | null = null;
  
  constructor() {
    napi_create_reference(env, value, 1, &this.napiRef);
  }
  
  onDestroy(): void {
    if (this.napiRef !== null) {
      napi_delete_reference(env, this.napiRef); // 必须释放
      this.napiRef = null;
    }
  }
}
```

#### 2.2 异常处理完整性（严苛项，25分）

ArkTS 异常处理必须覆盖所有可能失败的调用路径。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| API 调用异常 | 所有 @ohos 模块 API 调用是否有 try-catch | **关键路径无异常处理扣 10 分** |
| 参数验证 | 方法入口是否验证参数类型和边界 | 缺失扣 5 分 |
| 空值防护 | 是否处理 null/undefined 情况 | 缺失扣 5 分 |
| 异步异常 | Promise 链是否有 `.catch()` 或 try-catch | 缺失扣 8 分 |
| 异常传播 | Native 异常是否正确传播到 Flutter 层 | 不传播扣 7 分 |

**关键路径定义**：
- Flutter MethodChannel 调用的处理函数
- Native 返回结果到 Flutter 的回调函数
- 涉及系统资源（文件、网络、数据库）的操作

**代码示例**：

```typescript
// ❌ 严重缺陷：关键路径无异常处理
export class BluetoothPlugin {
  async connect(deviceId: string): Promise<void> {
    // 直接调用 @ohos.bluetooth API，无异常捕获
    await bluetooth.connect(deviceId); // 可能抛出 PermissionError、DeviceNotFoundError
    return; // 异常未传播到 Flutter 层
  }
}

// ✅ 正确实现
export class BluetoothPlugin {
  async connect(deviceId: string): Promise<void> {
    try {
      if (!deviceId || deviceId.length === 0) {
        throw new Error('Invalid deviceId'); // 参数验证
      }
      await bluetooth.connect(deviceId);
    } catch (e) {
      // 异常传播到 Flutter 层
      throw new Error(`Bluetooth connect failed: ${e.message}`);
    }
  }
}
```

#### 2.3 资源释放与生命周期绑定（严苛项，20分）

鸿蒙 Ability 生命周期与资源释放必须严格绑定。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Ability 生命周期 | 是否在 `onDestroy` 释放所有资源 | **未绑定扣 15 分** |
| StreamController 关闭 | 是否在销毁时关闭所有 Stream | 未关闭扣 10 分 |
| Timer 取消 | 是否取消所有未完成的 Timer | 未取消扣 5 分 |
| 事件订阅取消 | 是否取消所有 `@ohos` 事件订阅 | **未取消扣 12 分** |
| 监听器注销 | 是否注销所有注册的监听器 | 未注销扣 8 分 |

**关键事件订阅检查**：

```typescript
// ❌ 致命：事件订阅未取消
export class LocationPlugin {
  private locationCallback: (result: Location) => void;
  
  startListening(): void {
    geoLocationManager.on('locationChange', this.locationCallback);
    // 缺少 off 调用！
  }
  
  onDestroy(): void {
    // 没有 geoLocationManager.off() 调用
  }
}

// ✅ 正确实现
export class LocationPlugin {
  private locationCallback: (result: Location) => void;
  private isListening: boolean = false;
  
  startListening(): void {
    geoLocationManager.on('locationChange', this.locationCallback);
    this.isListening = true;
  }
  
  stopListening(): void {
    if (this.isListening) {
      geoLocationManager.off('locationChange', this.locationCallback);
      this.isListening = false;
    }
  }
  
  onDestroy(): void {
    this.stopListening(); // 必须取消订阅
  }
}
```

#### 2.4 并发安全与状态管理（严苛项，15分）

鸿蒙主线程与 Worker 线程的并发安全。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 全局状态保护 | 共享状态是否有锁机制或原子操作 | 无保护扣 10 分 |
| 线程安全 | Worker 线程访问主线程资源是否安全 | 不安全扣 8 分 |
| 状态一致性 | 多实例场景状态是否正确隔离 | 不隔离扣 7 分 |
| 初始化顺序 | 是否确保初始化完成后再使用 | 未确保扣 5 分 |

---

### Phase 3：C++ Native 层稳定性分析（仅鸿蒙化新增 C++ 代码）

> ⚠️ **评分范围**：Phase 3 仅分析**鸿蒙化新增的 NAPI C++ 代码**（Phase 1.5 分类结果中标记为"纳入评分"的 napi_*.cpp 等文件）。原库 C++ 代码（即使为 OHOS 编译）不纳入评分，列入"上游风险提示"。

#### 3.0 架构适配判定

根据 Phase 1.5 架构类型判定结果：

| 架构类型 | Phase 3 处理 | 评分 |
|----------|-------------|------|
| NAPI 架构 + 鸿蒙化新增 NAPI 文件 | 正常分析 Phase 3.1-3.3 | 正常评分 |
| 原库含 NAPI + 鸿蒙化无新增 NAPI | Phase 3 全部标记 N/A（通过） | 20/20 + 15/15 + 10/10 |
| FFI 架构（无 napi_* 调用） | Phase 3 全部标记 N/A（通过） | 20/20 + 15/15 + 10/10 |
| 编译适配型（仅 CMakeLists.ohos.txt） | Phase 3 全部标记 N/A（通过） | 20/20 + 15/15 + 10/10 |

#### 3.1 NAPI Handle 管理（致命项，20分）

> 仅适用于 NAPI 架构且鸿蒙化新增了 NAPI C++ 文件的项目。

NAPI handle 是 Native 层的核心资源。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Handle Scope | 是否在函数结束时清理 `napi_handle_scope` | **未清理扣 15 分** |
| Handle 有效性 | 是否在异步操作中保持 handle 有效 | 失效扣 10 分 |
| 引用释放 | `napi_ref` 是否在析构时释放 | **未释放扣 20 分** |
| 异常传播 | Native 异常是否转换为 ArkTS 异常 | 不转换扣 8 分 |

**C++ 代码示例**：

```cpp
// ❌ 致命：Handle Scope 未清理
static napi_value GetDeviceInfo(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  
  // ... 业务逻辑 ...
  
  // 缺少 napi_close_handle_scope！
  return result;
}

// ✅ 正确实现
static napi_value GetDeviceInfo(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  
  napi_value result;
  // ... 业务逻辑 ...
  
  napi_close_handle_scope(env, scope); // 必须清理
  return result;
}
```

#### 3.2 内存管理（严苛项，15分）

Native 层内存管理必须防止泄漏和双重释放。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 内存分配释放 | malloc/new 是否有对应的 free/delete | **不匹配扣 15 分** |
| 异常路径释放 | 异常发生时是否释放已分配内存 | 未释放扣 12 分 |
| 智能指针使用 | 是否使用 RAII 管理资源 | 未使用扣 8 分 |
| Buffer 管理 | ArrayBuffer 是否正确传递所有权 | 错误传递扣 10 分 |

#### 3.3 跨语言调用安全（严苛项，10分）

Native 到 ArkTS 的调用安全。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 回调有效性 | ArkTS 回调函数是否在调用前验证 | 未验证扣 7 分 |
| 参数类型转换 | Native 类型转换为 ArkTS 类型是否安全 | 不安全扣 8 分 |
| 环境有效性 | napi_env 在异步调用中是否有效 | 失效扣 10 分 |
| 错误传播 | Native 错误是否传播到 ArkTS 层 | 不传播扣 6 分 |

---

### Phase 4：调用链完整性分析

#### 4.1 跨层级调用链追踪

追踪关键功能的完整调用链，检查异常传播路径：

```
调用链结构：
Flutter (Dart)                    鸿蒙 (ArkTS/ETS)                Native (C++)
│                                 │                              │
├─ MethodChannel.call()           │                              │
│  └─ "methodName"                │                              │
│                                 │                              │
                                 ├─ Plugin.handleMethodCall()    │
                                 │  ├─ try-catch ✅              │
                                 │  └─ invokeNative()            │
                                 │                                │
                                 │                               ├─ NativeImpl::execute()
                                 │                               │  ├─ napi_handle_scope ✅
                                 │                               │  └─ return result
                                 │                               │
                                 ├─ callback(result)             │
                                 │  ├─ 异常检查 ✅               │
                                 │  └─ return to Flutter         │
```

#### 4.2 异常传播链检查

| 检查层级 | 检查项 | 扣分规则 |
|----------|--------|----------|
| Native → ArkTS | C++ 异常是否转换为 napi_throw | 不转换扣 10 分 |
| ArkTS → Flutter | ArkTS 异常是否转换为 PlatformException | 不转换扣 10 分 |
| 完整链路 | 异常是否能从底层传播到顶层 | **断裂扣 15 分** |

---

### Phase 5：生成报告

输出文件：
- `{outputDir}/稳定性检视报告.md` — 详细检视报告，含严苛评分

#### 严苛评分计算规则

采用**严苛扣分制**，从 100 分开始扣减：

```
初始分数：100 分

⚠️ 核心规则：仅对鸿蒙化新增代码扣分！原库上游代码问题列入"上游风险提示"但不纳入评分。

扣分类型：
├── 致命问题：-20 分（最多扣 60 分，超过直接评 0 分）
│   ├── NAPI 引用未释放（仅鸿蒙化新增 NAPI 代码）
│   ├── Handle Scope 未清理（仅鸿蒙化新增 NAPI 代码）
│   ├── 关键路径无异常处理（仅鸿蒙化 ArkTS 代码）
│   ├── 事件订阅未取消（仅鸿蒙化 ArkTS 代码）
│   └── 异常传播链断裂（仅鸿蒙化代码层面的断裂）
├── 严重问题：-15 分
│   ├── 资源释放不完整（仅鸿蒙化代码）
│   ├── 全局状态无保护（仅鸿蒙化代码）
│   ├── 内存分配释放不匹配（仅鸿蒙化新增 C++ 代码）
├── 中等问题：-10 分
│   ├── 部分异常处理缺失（仅鸿蒙化代码）
│   ├── 参数验证不完整（仅鸿蒙化代码）
│   ├── 回调有效性未验证（仅鸿蒙化新增 C++ 代码）
├── 轻微问题：-5 分
│   ├── 代码风格不规范（仅鸿蒙化代码）
│   ├── 注释不完整（仅鸿蒙化代码）
│   ├── 日志记录缺失（仅鸿蒙化代码）

原库上游问题处理（不扣分）：
├── 原库 C++ Release 模式安全检查缺失 → 列入"上游风险提示"，不扣分
├── 原库 C++ 裸指针/FIXME → 列入"上游风险提示"，不扣分
├── 原库 C++ 线程安全缺陷 → 列入"上游风险提示"，不扣分
├── Dart FFI force unwrap → 列入"上游风险提示"，不扣分
├── 其他原库代码质量问题 → 列入"上游风险提示"，不扣分

架构适配规则：
├── 无 NAPI 架构（使用 dart:ffi / MethodChannel） → Phase 3 全部标记 N/A（通过），不扣分
├── 原库含 NAPI 但鸿蒙化未新增 NAPI → Phase 3 全部标记 N/A（通过），不扣分
├── 仅编译适配型（无新增 C++ 源码） → Phase 3 全部标记 N/A（通过），不扣分

特殊规则：
├── 不存在 ohos 目录 → 0 分
├── ohos 目录无代码文件 → 0 分
├── 致命问题 ≥ 3 个（仅鸿蒙化代码） → 0 分
├── 致命问题 ≥ 2 个 + 严重问题 ≥ 2 个（仅鸿蒙化代码） → 0 分

最低分数：0 分
```

---

## 输出格式规范

报告必须严格遵循以下格式，确保 `_parseFlutterLibraryScore` 函数能正确解析：

```markdown
# ${repoName} 稳定性检视报告

## 📊 稳定性评分

**综合评分：78/100**

> 评分说明：采用严苛扣分制，从 100 分开始扣减，最低 0 分。**仅对鸿蒙化新增代码扣分**，原库上游问题列入"上游风险提示"但不纳入评分。

| 维度 | 检查项数 | 通过数 | 失败数 | 扣分 | 得分 |
|------|----------|--------|--------|------|------|
| NAPI引用管理 | 4 | 3 | 1 | -20 | 20/20 |
| 异常处理 | 5 | 3 | 2 | -15 | 10/25 |
| 资源释放 | 5 | 4 | 1 | -12 | 8/20 |
| 并发安全 | 4 | 3 | 1 | -5 | 10/15 |
| Native Handle | 4 | 2 | 2 | -20 | 0/20 |
| 内存管理 | 4 | 3 | 1 | -8 | 7/15 |
| 调用链完整性 | 3 | 2 | 1 | -10 | 0/10 |

**扣分明细**：
- NAPI 引用未释放（致命）：-20 分
- Handle Scope 未清理（致命）：-20 分
- 部分异常处理缺失（中等）：-10 分
- 参数验证不完整（中等）：-10 分
- 事件订阅未取消（严重）：-15 分

---

## 🔍 检视范围

### 鸿蒙代码定位结果

**扫描策略**：通过文件类型 + API 特征 + 配置文件智能识别，而非依赖固定目录名

| 扫描维度 | 发现文件数 | 检视状态 |
|----------|------------|----------|
| `.ets` 文件 | 12 | ✅ 已检视（核心） |
| `module.json5` | 1 | ✅ 已检视 |
| NAPI C++ 文件 | 8 | ✅ 已检视 |
| `@ohos` API 导入 | 5 处 | ✅ 已检视 |
| 非鸿蒙目录（android/ios/lib） | - | ⚠️ 不检视 |

### 代码来源分类

**关键区分**：通过 Copyright 声明识别代码来源，仅对鸿蒙化新增代码评分：

| 代码类别 | Copyright | 文件范围 | 检视状态 |
|----------|-----------|----------|----------|
| **鸿蒙化新增代码** | "Huawei Device Co., Ltd." / "OpenHarmony" | `.ets` Plugin 文件、module.json5 等 | ✅ **纳入评分** |
| **原库上游代码** | 原项目作者（不含华为/OpenHarmony） | bridge/*.cpp、foundation/*.cc 等 | ⚠️ **不纳入评分**，列入上游风险提示 |
| **Flutter Dart 层** | 原库代码 | kraken/lib/*.dart 等 | ❌ 不检视 |

**实际检视文件列表（鸿蒙化代码）**：
- `{sourceDir}/xxx/plugin.ets` ✅ 鸿蒙化新增
- `{sourceDir}/yyy/entry.ets` ✅ 鸿蒙化新增
- `{sourceDir}/zzz/napi_binding.cpp` ✅ 鸿蒙化新增 NAPI（仅 NAPI 架构项目）

**上游风险提示文件（原库代码，不纳入评分）**：
- `{sourceDir}/bridge/kraken_bridge.cc` ⚠️ 原库 C++ 桥接

---

## ⚠️ 上游风险提示（原库代码，不纳入评分）

> 以下问题存在于原库代码中，鸿蒙化开发者未修改这些源码。问题属上游继承，此处仅作为风险提示列出，**不纳入综合评分**。

| 风险 | 文件位置 | 说明 | 建议优先级 |
|------|----------|------|------------|
| C++ Release 模式 nullptr 崩溃 | `bridge/kraken_bridge.cc:150` | ... | P0（建议本地 patch） |
| C++ 线程安全缺陷 | `bridge/dart_methods.cc:16` | ... | P2 |

---

## 🔍 详细检视结果

### 1. NAPI 引用管理分析

> 若项目使用 dart:ffi + MethodChannel 架构，此维度标记为 N/A（全部通过），不扣分。

#### 1.1 致命问题

| 问题 | 文件位置 | 代码片段 | 扣分 |
|------|----------|----------|------|
| NAPI 引用未释放 | `{鸿蒙化新增的ets/cpp文件路径}:45` | `napi_create_reference(env, value, 1, &ref)` 缺少释放 | -20 |

**问题描述**：在 `MyPlugin` 类中创建了 `napi_ref`，但 `onDestroy` 方法中未调用 `napi_delete_reference`，会导致内存泄漏。

**修复建议**：
```typescript
// 在 onDestroy 中添加：
if (this.napiRef !== null) {
  napi_delete_reference(env, this.napiRef);
  this.napiRef = null;
}
```

---

### 2. 异常处理分析

#### 2.1 中等问题

| 问题 | 文件位置 | 影响范围 | 扣分 |
|------|----------|----------|------|
| 关键路径无异常处理 | `{鸿蒙化新增ets文件路径}:23` | connect 方法直接调用 API | -10 |

---

### 3. 资源释放分析

...

---

### 4. Native 层分析

> 若项目使用 dart:ffi + MethodChannel 架构或原库含 NAPI 但鸿蒙化未新增 NAPI，此维度标记为 N/A（全部通过），不扣分。

...

---

### 5. 调用链完整性分析

**关键功能调用链**：`connect(deviceId)`（仅追踪鸿蒙化代码层面的调用链）

```
Flutter → MethodChannel → ArkTS → Native → 回调
         ✅ 有异常处理    ❌ 无异常检查  ❌ Handle 未清理
```

**异常传播断裂点**：鸿蒙化代码层面的异常传播断裂点标注（原库代码层面的问题列为上游风险提示）。

---

## 💡 改进建议

### 优先级 P0（致命问题，必须修复）

1. **NAPI 引用释放**：在所有 Plugin 的 onDestroy 方法中添加 napi_delete_reference 调用
2. **Handle Scope 清理**：在所有 Native 函数结尾添加 napi_close_handle_scope
3. **关键路径异常处理**：所有 MethodChannel 处理函数必须包裹 try-catch

### 优先级 P1（严重问题，强烈建议修复）

...

---

**检视时间**：${new Date().toLocaleString('zh-CN')}
```

---

## 检视清单

详细检查项参见 [references/CHECKLIST.md](references/CHECKLIST.md)

---

## 输出要求

1. **评分格式**：必须包含 `**综合评分：XX/100**`（粗体标记，中文冒号），确保 `_parseFlutterLibraryScore` 能解析
2. **评分范围**：0-100 整数，严苛扣分制。**仅对鸿蒙化新增代码扣分**
3. **代码来源分类**：必须包含"代码来源分类"章节，区分鸿蒙化新增 vs 原库上游代码
4. **上游风险提示**：必须包含"上游风险提示"章节，列出原库代码问题但不纳入评分
5. **检视范围**：通过智能扫描 + 代码来源识别鸿蒙化代码，明确标注检视文件路径、代码来源和非检视范围
6. **扣分明细**：必须列出每个扣分项的具体原因和修复建议，**标注问题所属代码来源**
7. **架构适配**：若项目不使用 NAPI（使用 dart:ffi / MethodChannel），必须在报告中明确标注 Phase 3 为 N/A
8. **调用链分析**：必须包含至少 3 个关键功能的调用链图
9. **修复建议**：按优先级（P0/P1/P2）分类，包含示例代码
10. **语言**：使用中文撰写报告内容

---

## 特殊情况处理

| 情况 | 处理方式 | 评分 |
|------|----------|------|
| 未发现 `.ets` 文件和鸿蒙 API 特征 | 报告标注"未发现鸿蒙化实现代码" | 0 分 |
| 仅发现目录名含 `ohos` 但无代码文件 | 报告标注"鸿蒙化代码疑似缺失" | 0-30 分 |
| 发现鸿蒙代码文件但解析失败 | 报告标注"鸿蒙代码解析失败"并说明原因 | 0 分 |
| 致命问题 ≥ 3 个（仅鸿蒙化代码） | 报告标注"存在严重稳定性风险，建议重构" | 0 分 |
| 扫描到 `.ets` 文件但不在 `ohos/` 目录 | 正常检视，报告标注实际路径 | 正常评分 |
| 项目不使用 NAPI（使用 dart:ffi / MethodChannel） | Phase 3 标记 N/A（全部通过），评分以 ArkTS 层为主 | 正常评分 |
| 发现 C++ NAPI 代码但为原库上游代码 | 不纳入评分，列入"上游风险提示" | Phase 3 不扣分 |
| C++ 仅为 OHOS 编译配置（CMakeLists.ohos.txt）无新增源码 | Phase 3 标记 N/A（全部通过） | Phase 3 不扣分 |