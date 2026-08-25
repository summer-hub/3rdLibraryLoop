---
name: flutter-library-memory-leak-check
description: 对 Flutter 三方库的**鸿蒙化代码**进行内存泄露检视，聚焦 ohos 目录下的 ArkTS/ETS 和 C++ 代码，分析资源管理不当、循环引用、未释放对象等潜在内存泄露问题，生成严苛评分报告（0-100分）。作为 Flutter 仓库检视流程的第五阶段，依赖编码质量检视结果。
license: Apache-2.0
compatibility: 需要访问 Git 仓库、分析 ohos 目录下的 ETS/C++ 源码
metadata:
  version: "1.0.0"
---

# FlutterLibraryMemoryLeakCheckSkill

对 Flutter 三方库的**鸿蒙化实现代码**进行内存泄露检视，评估库在内存管理方面的安全性，识别潜在的内存泄露风险。

> ⚠️ **核心定位**：本 SKILL **仅检视鸿蒙化代码**，不检视 Flutter Dart 层或非鸿蒙化部分的代码。检视范围包括：
> - 鸿蒙平台特有的 ArkTS/ETS 代码（常见目录：`ohos/ets/`、`harmony/ets/`、`src/ohos/` 等）
> - 鸿蒙 Native C++ 代码（常见目录：`ohos/src/`、`ohos/cpp/`、`native/` 等）
> - 鸿蒙平台特有的 API 资源管理（如 GattClientDevice、NAPI 引用、@ohos 模块等）
>
> **重要**：目录名称不固定，需通过源码扫描识别鸿蒙化代码特征

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `repoUrl` | ✅ | Git 仓库地址，支持分支 `?branch=xxx` |
| `outputDir` | ✅ | 输出目录绝对路径，存放检视报告 |
| `interfaceDocPath` | ✅ | 接口规格说明文档路径 |
| `repoName` | ✅ | 仓库名称（用于报告标识） |

---

## 输入依赖

本 SKILL 是 Flutter 仓库检视流程的**第五阶段**，依赖：

- **前置 SKILL**: `flutter-library-code-quality-check`
- **输入文件**: `接口规格说明.md`、`编码质量检视报告.md`
- **仓库源码**: 已克隆到 `{outputDir}/source/`，重点分析 `ohos/` 目录

---

## 工作流程

### Phase 0：鸿蒙代码定位与范围识别

首先扫描源码，**通过代码特征识别鸿蒙化实现**，而非仅依赖目录名称。

#### 0.1 鸿蒙代码特征识别

扫描源码文件，识别以下鸿蒙化特征：

**ArkTS/ETS 代码特征**：
```typescript
// 特征 1：@ohos 模块导入
import ble from '@ohos.bluetooth';
import connection from '@ohos.bluetooth.connection';
import geoLocationManager from '@ohos.geoLocationManager';
import { GattClientDevice } from '@ohos.bluetooth.ble';

// 特征 2：鸿蒙特有的 API 调用
ble.createGattClientDevice();
ble.startBLEScan();
connection.pairDevice();
geoLocationManager.on('locationChange');

// 特征 3：FlutterPlugin 鸦蒙实现
class XxxPlugin implements FlutterPlugin {
  onAttachedToEngine(binding: FlutterPluginBinding): void { ... }
  onDetachedFromEngine(binding: FlutterPluginBinding): void { ... }
}

// 特征 4：.ets 文件扩展名
*.ets  // ArkTS 文件
```

**C++ Native 代码特征**：
```cpp
// 特征 1：NAPI 相关头文件
#include <napi/native_api.h>
#include <napi/js_native_api.h>
#include <napi/js_native_api_types.h>

// 特征 2：NAPI 函数调用
napi_create_reference(env, value, 1, &ref);
napi_delete_reference(env, ref);
napi_open_handle_scope(env, &scope);
napi_close_handle_scope(env, scope);
napi_get_value_string_utf8(env, value, buf, bufsize, &len);

// 特征 3：鸿蒙特有的 Native API
OH_NativeXxx();
HarmonyOS_NativeXxx();
```

**常见鸿蒙化目录（仅供参考，不作为唯一判定依据）**：
```
常见目录名称：
├── ohos/                          # 最常见
├── harmony/                       # 部分库使用
├── harmonyos/                     # 部分库使用
├── src/ohos/                      # 嵌入式结构
├── platform/ohos/                 # 平台分离结构
├── native/                        # Native 实现（需检查 NAPI 特征）
├── ets/                           # 独立 ETS 目录
```

#### 0.2 扫描流程

```
扫描流程：
├── Step 1：扫描所有 .ets 文件
│   ├── 查找 @ohos 模块导入
│   ├── 查找鸿蒙 API 调用（ble.createGattClientDevice 等）\│   ├── 查找 FlutterPlugin 实现类
│   └── 记录鸿蒙化代码文件路径
├── Step 2：扫描所有 .cpp/.h 文件
│   ├── 查找 NAPI 头文件引用
│   ├── 查找 napi_xxx 函数调用
│   ├── 记录鸿蒙 Native 代码文件路径
├── Step 3：综合判定
│   ├── 若发现鸿蒙代码特征 → 进入 Phase 1 深度分析
│   ├── 若未发现任何鸿蒙代码特征 → **报告评分 0 分**，标注"未实现鸿蒙化"
```

**判定规则**：
- **优先通过代码特征识别**，而非仅依赖目录名称
- 若扫描到 `@ohos` 模块导入或 NAPI 函数调用 → **确认鸿蒙化实现**，进入 Phase 1
- 若存在 `.ets` 文件且包含鸿蒙 API 调用 → **确认鸿蒙化实现**，进入 Phase 1
- 若扫描整个源码均未发现鸿蒙代码特征 → **报告评分 0 分**，标注"未实现鸿蒙化"
- **注意**：即使没有 ohos 目录，但源码中存在鸿蒙化实现（如在 src/ 或其他目录），仍需检视

---

### Phase 1：Plugin 生命周期资源管理检查

#### 1.1 FlutterPlugin 生命周期绑定（致命项，20分）

Flutter Plugin 在鸿蒙平台必须正确绑定生命周期事件。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| `onAttachedToEngine` | 资源初始化是否完整 | 初始化不完整扣 5 分 |
| `onDetachedFromEngine` | 是否释放**所有**资源 | **未释放扣 20 分（致命）** |
| `setMethodCallHandler(null)` | 是否取消 MethodChannel handler | 未取消扣 10 分 |
| Map 数据清理 | `mConnectedDevices`、`mMtu` 等是否清空 | 未清空扣 12 分 |
| 释放顺序 | 是否按正确顺序释放（先取消监听再清数据） | 顺序错误扣 8 分 |

**代码示例**：

```typescript
// ❌ 致命错误：onDetachedFromEngine 未释放所有资源
onDetachedFromEngine(binding: FlutterPluginBinding): void {
  if (this.channel != null) {
    this.channel.setMethodCallHandler(null)  // 仅取消 handler
  }
  // 缺失：mConnectedDevices、mMtu、mScanFilters 等未清空
  // 缺失：ble.stopBLEScan() 未调用
}

// ✅ 正确实现
onDetachedFromEngine(binding: FlutterPluginBinding): void {
  // 1. 取消所有事件监听
  connection.off("bondStateChange", this.bondStateCallback);
  ble.off("BLEDeviceFind", this.scanCallback);
  
  // 2. 停止进行中的操作
  ble.stopBLEScan();
  
  // 3. 清空 Map 数据
  this.mConnectedDevices.clear();
  this.mMtu.clear();
  this.mScanFilters.clear();
  
  // 4. 取消 MethodChannel handler
  if (this.channel != null) {
    this.channel.setMethodCallHandler(null);
  }
  
  // 5. 释放其他资源
  for (const device of this.mConnectedDevices.values()) {
    device.close();  // 释放 GattClientDevice
  }
}
```

#### 1.2 Ability 生命周期绑定（严苛项，15分）

Activity/Ability 生命周期资源必须正确绑定。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| `onAttachedToAbility` | Ability 附加时资源注册 | 未处理扣 8 分 |
| `onDetachedFromAbility` | Ability 分离时资源释放 | **未释放扣 15 分** |
| 配置变更处理 | 屏幕旋转等配置变更时的资源处理 | 未处理扣 10 分 |

**关键检查**：
- 在 `onAttachedToAbility` 注册的监听器，必须在 `onDetachedFromAbility` 取消
- Ability 级监听器（如 `bondStateChange`）不应依赖 `onDetachedFromEngine` 释放

---

### Phase 2：事件监听器管理检查

#### 2.1 鸿蒙 API 事件订阅（致命项，25分）

鸿蒙系统 API（@ohos 模块）的事件订阅必须严格管理。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| `on/off` 对称性 | 每个 `on()` 是否有对应 `off()` | **无对应 off 扣 20 分（致命）** |
| 回调参数匹配 | `off()` 是否传入正确的回调函数 | 参数错误扣 12 分 |
| 多次注册风险 | 同一事件是否可能被多次注册监听 | 存在风险扣 15 分 |
| 订阅状态追踪 | 是否有标志位追踪订阅状态 | 无追踪扣 8 分 |

**致命问题示例**：

```typescript
// ❌ 致命：每次调用都注册新监听器，无对应取消
async setNotifyValue(remoteId: string, characteristic: ble.BLECharacteristic): Promise<void> {
  const gatt = this.mConnectedDevices.get(remoteId);
  gatt.on('BLECharacteristicChange', (data) => {
    this.onCharacteristicReceived(remoteId, data);
  });
  // ⚠️ 每次调用注册新监听器，断开连接时未取消！
}

// ✅ 正确实现
private characteristicCallbacks: Map<string, Function> = new Map();

async setNotifyValue(remoteId: string, characteristic: ble.BLECharacteristic): Promise<void> {
  const gatt = this.mConnectedDevices.get(remoteId);
  
  // 先取消旧的监听器
  const oldCallback = this.characteristicCallbacks.get(remoteId);
  if (oldCallback) {
    gatt.off('BLECharacteristicChange', oldCallback);
  }
  
  // 注册新的监听器并保存
  const newCallback = (data) => this.onCharacteristicReceived(remoteId, data);
  gatt.on('BLECharacteristicChange', newCallback);
  this.characteristicCallbacks.set(remoteId, newCallback);
}
```

#### 2.2 特殊系统资源释放（严苛项，20分）

鸿蒙平台特有资源必须显式释放。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| GattClientDevice.close | BLE Gatt 客户端是否调用 close() | **未调用扣 20 分（致命）** |
| 扫描状态清理 | `ble.stopBLEScan()` 是否在适当时机调用 | 未调用扣 15 分 |
| 地理位置监听 | `geoLocationManager.off()` 是否取消 | 未取消扣 15 分 |
| 网络状态监听 | `connection.on/off` 是否对称 | 不对称扣 12 分 |

**致命泄漏场景**：

```typescript
// ❌ 致命：GattClientDevice 创建后未释放
async scanCallback(device: ble.ScanResult): void {
  // 在扫描回调中创建 GattClientDevice 获取设备名称
  const gattClient = ble.createGattClientDevice(device.getMac());
  const deviceName = await gattClient.getDeviceName();
  // ⚠️ gattClient 未调用 close()，每次扫描都泄漏！
}

// ❌ 致命：服务查询创建的 GattClientDevice 未释放
async getServices(remoteId: string): Promise<ble.GattService[]> {
  const gattClient = ble.createGattClientDevice(remoteId);
  const services = await gattClient.getServices();
  // ⚠️ 返回结果但未释放 gattClient
  return services;
}

// ✅ 正确实现
async getServices(remoteId: string): Promise<ble.GattService[]> {
  const gattClient = ble.createGattClientDevice(remoteId);
  try {
    const services = await gattClient.getServices();
    return services;
  } finally {
    gattClient.close();  // 必须释放
  }
}
```

---

### Phase 3：ArkTS 内存管理检查

#### 3.1 闭包循环引用（致命项，20分）

ArkTS 箭头函数闭包可能导致 `this` 循环引用。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| this 捕获 | 箭头函数是否捕获 `this` 引用 | 捕获且未释放扣 15 分 |
| 闭包保留 | 闭包是否保留外部变量引用 | 保留且无法释放扣 12 分 |
| 匿名函数累积 | 是否反复创建匿名函数作为回调 | 累积风险扣 10 分 |

**循环引用检测**：

```typescript
// ❌ 风险：箭头函数捕获 this，形成循环引用
class MyPlugin {
  private gatt: ble.GattClientDevice;
  
  connect(): void {
    // 箭头函数捕获 this，this.gatt 持有回调，回调持有 this
    this.gatt.on('BLEConnectionStateChange', (state) => {
      this.onConnectionStateChanged(state);  // this 被捕获
    });
  }
}

// ✅ 正确实现：使用普通函数或弱引用
class MyPlugin {
  private gatt: ble.GattClientDevice;
  private connectionCallback: Function;
  
  constructor() {
    // 在构造函数中预创建回调
    this.connectionCallback = (state: ble.ProfileConnectionState) => {
      this.onConnectionStateChanged(state);
    };
  }
  
  connect(): void {
    this.gatt.on('BLEConnectionStateChange', this.connectionCallback);
  }
  
  disconnect(): void {
    this.gatt.off('BLEConnectionStateChange', this.connectionCallback);
    this.connectionCallback = null;  // 清除引用
  }
}
```

#### 3.2 Map/Set 数据清理（严苛项，15分）

持久化的 Map/Set 数据必须提供清理机制。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Map.clear() | 是否在适当时机调用 clear() | 未清理扣 12 分 |
| Map.delete() | 单项数据是否正确删除 | 删除不完整扣 8 分 |
| 静态 Map 风险 | 静态 Map 是否无限累积 | **累积风险扣 15 分** |
| 缓存上限 | 是否设置缓存大小上限 | 无上限扣 10 分 |

**Map 清理检查**：

```typescript
// ❌ 问题：Map 数据未在适当时机清理
private mScanFilters: Map<string, Object> = new Map();

async startScan(filters: Object): void {
  this.mScanFilters.set('current', filters);
  ble.startBLEScan(filters);
}

async stopScan(): void {
  ble.stopBLEScan();
  // ⚠️ mScanFilters 未清理！
}

// ✅ 正确实现
async stopScan(): void {
  ble.stopBLEScan();
  this.mScanFilters.clear();  // 清理扫描过滤器
}
```

#### 3.3 静态变量与全局状态（严苛项，10分）

静态变量和全局状态可能导致内存无法释放。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| static 可变集合 | 静态 List/Map 是否无限增长 | 增长风险扣 10 分 |
| 全局缓存清理 | 是否提供全局缓存清理方法 | 无清理扣 8 分 |
| 单例资源释放 | 单例模式是否正确释放资源 | 未释放扣 10 分 |

---

### Phase 4：C++ Native 内存检查

#### 4.1 NAPI 引用管理（致命项，25分）

NAPI 引用是鸿蒙 Native 层最核心的资源，错误管理会导致内存泄漏或崩溃。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| `napi_ref` 创建 | 是否为需要长期持有的对象创建 `napi_ref` | 缺失扣 5 分 |
| `napi_ref` 释放 | 是否在 dispose/destroy 时调用 `napi_delete_reference` | **未释放扣 25 分（致命）** |
| 引用计数平衡 | `napi_create_reference` 和 `napi_delete_reference` 数量是否匹配 | 不平衡扣 18 分 |
| Handle Scope 清理 | 是否正确关闭 `napi_handle_scope` | **未关闭扣 20 分（致命）** |

**C++ NAPI 管理示例**：

```cpp
// ❌ 致命：NAPI 引用未释放
class NativePlugin {
private:
  napi_ref callbackRef;
  
public:
  void registerCallback(napi_env env, napi_value callback) {
    napi_create_reference(env, callback, 1, &this->callbackRef);
    // 缺少释放逻辑！
  }
  
  // 没有 destroy 方法释放 napi_ref
};

// ✅ 正确实现
class NativePlugin {
private:
  napi_ref callbackRef = nullptr;
  
public:
  void registerCallback(napi_env env, napi_value callback) {
    if (this->callbackRef) {
      napi_delete_reference(env, this->callbackRef);
    }
    napi_create_reference(env, callback, 1, &this->callbackRef);
  }
  
  void destroy(napi_env env) {
    if (this->callbackRef) {
      napi_delete_reference(env, this->callbackRef);  // 必须释放
      this->callbackRef = nullptr;
    }
  }
};
```

#### 4.2 Native 内存分配释放（致命项，20分）

C++ 内存分配必须有对应释放。

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| malloc/free 匹配 | 每个 `malloc` 是否有对应 `free` | **不匹配扣 20 分（致命）** |
| new/delete 匹配 | 每个 `new` 是否有对应 `delete` | **不匹配扣 20 分（致命）** |
| 异常路径释放 | 异常发生时是否释放已分配内存 | 未释放扣 15 分 |
| RAII 模式 | 是否优先使用智能指针 | 未使用扣 10 分 |

**RAII 推荐模式**：

```cpp
// ✅ 使用智能指针自动管理
#include <memory>

void processData() {
  std::unique_ptr<Buffer> buffer = std::make_unique<Buffer>(1024);
  // 自动释放，无需手动 delete
  
  // 或使用 std::shared_ptr 处理共享所有权
  std::shared_ptr<Resource> resource = std::make_shared<Resource>();
}

// ✅ RAII wrapper 模式
class BufferGuard {
private:
  void* buf;
public:
  BufferGuard(size_t size) : buf(malloc(size)) {}
  ~BufferGuard() { 
    if (buf) free(buf);  // 自动释放
  }
};
```

---

### Phase 5：严苛评分计算

采用**严苛扣分制**，从 100 分开始扣减：

```
初始分数：100 分

扣分类型：
├── 致命问题：-20 分（最多扣 60 分，超过直接评 0 分）
│   ├── GattClientDevice 未释放
│   ├── NAPI 引用未释放
│   ├── Handle Scope 未关闭
│   ├── malloc/free 不匹配
│   ├── new/delete 不匹配
│   ├── 事件订阅无对应取消
│   └── onDetachedFromEngine 未释放资源
├── 严重问题：-15 分
│   ├── 闭包循环引用风险
│   ├── Map 数据未清理
│   ├── 静态集合累积风险
│   ├── Ability 生命周期未绑定
├── 中等问题：-10 分
│   ├── 订阅状态未追踪
│   ├── 回调参数匹配错误
│   ├── 缓存无上限
│   ├── 单例资源释放不完整
├── 轻微问题：-5 分
│   ├── 释放顺序不当
│   ├── 初始化不完整

特殊规则（直接 0 分）：
├── 未发现鸿蒙代码特征 → 0 分
├── 致命问题 ≥ 3 个 → 0 分
├── 致命问题 ≥ 2 个 + 严重问题 ≥ 3 个 → 0 分
├── 累计扣分超过 60 分 → 0 分

最低分数：0 分
```

---

## 输出文件（必须遵守）

检视完成后**必须**生成以下文件：

| 文件 | 说明 |
|------|------|
| `{outputDir}/内存泄露检视报告.md` | 详细检视报告，含严苛评分（**独立文件，禁止只写入 result 执行结果文件**） |

> ⚠️ **输出文件自检**：写入结果文件前，先确认 `{outputDir}/内存泄露检视报告.md` 已存在且内容完整。若报告内容仅在草稿中，必须先将其保存为上述独立文件。

---

## 输出格式规范

报告必须严格遵循以下格式，确保 `_parseFlutterLibraryScore` 函数能正确解析：

```markdown
# ${repoName} 内存泄露检视报告

## 📊 内存泄露检视评分

**综合评分：78/100**

> 评分说明：采用严苛扣分制，从 100 分开始扣减，最低 0 分

| 维度 | 满分 | 得分 | 扣分详情 |
|------|------|------|----------|
| Plugin 生命周期绑定 | 20 | 15 | onDetachedFromEngine 资源清理不完整 -5 |
| Ability 生命周期绑定 | 15 | 10 | onDetachedFromAbility 缺失 -5 |
| 鸿蒙 API 事件订阅 | 25 | 5 | BLECharacteristicChange 监听器未取消 -20 |
| 特殊系统资源释放 | 20 | 0 | GattClientDevice 未释放 -20 |
| 闭包循环引用 | 20 | 15 | 箭头函数捕获 this -5 |
| Map/Set 数据清理 | 15 | 10 | mScanFilters 未清理 -5 |
| 静态变量与全局状态 | 10 | 8 | 无全局缓存清理方法 -2 |
| NAPI 引用管理 | 25 | 25 | 无 NAPI 实现 |
| Native 内存分配释放 | 20 | 20 | 无 C++ 实现 |
| **总计** | **100** | **78** | 累计扣分 22 分 |

**扣分明细**：
- BLECharacteristicChange 监听器未取消（致命）：-20 分
- GattClientDevice 未释放（致命）：-20 分
- onDetachedFromEngine 资源清理不完整（中等）：-5 分
- ...

---

## 🔍 详细检视结果

### 1. Plugin 生命周期资源管理检查

#### 1.1 FlutterPlugin 生命周期绑定

| 检查项 | 规范要求 | 实际情况 | 状态 |
|--------|----------|----------|------|
| onAttachedToEngine | 初始化所有资源 | MethodChannel 初始化完整 | ✅ 通过 |
| onDetachedFromEngine | 释放所有资源 | 仅取消 handler，Map 未清理 | ❌ 失败 |
| setMethodCallHandler(null) | 取消 MethodChannel handler | 已取消 | ✅ 通过 |

**问题详情**：

| 问题类型 | 文件位置 | 行号 | 严重度 | 说明 |
|----------|----------|------|--------|------|
| **资源未清理** | FlutterBluePlusOhosPlugin.ets | 87-97 | **致命** | onDetachedFromEngine 未清理 mConnectedDevices、mMtu 等 Map 数据 |

**代码示例 - 问题代码**：
...

### 2. 事件监听器管理检查
...

### 3. ArkTS 内存管理检查
...

### 4. C++ Native 内存检查
...

---

## 📋 改进建议

### 高优先级（致命问题）

1. **释放 GattClientDevice**
   - 问题：scanCallback 中创建的 GattClientDevice 未调用 close()
   - 建议：使用 try-finally 确保 GattClientDevice.close() 被调用

2. **取消 BLECharacteristicChange 监听**
   - 问题：每次 setNotifyValue 都注册新监听器，断开时未取消
   - 建议：使用 Map 保存回调引用，在 disconnect 时取消

### 中优先级

...

### 低优先级

...
```

---

## 检视清单

详细检查项参见 [references/CHECKLIST.md](references/CHECKLIST.md)

---

## 输出要求

1. 报告必须以 `## 📊 内存泄露检视评分` 开头，包含评分表格
2. 评分格式必须是：`**综合评分：XX/100**`
3. 评分必须是 0-100 的整数
4. 仅检视 ohos/ 目录下的 ETS/C++ 代码，不检视 Flutter Dart 层
5. 详细列出每项扣分（文件位置、行号、扣分值）
6. 给出具体改进建议，按优先级排序
7. 使用中文撰写内容

### 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将最终评分以下述 JSON 对象写入该路径：

```json
{
  "memoryLeakScore": 85,
  "scoreReason": "致命问题1处-20，资源未释放2处-16等（一句话判定依据，≤50字；触发一票否决时必须注明）"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `memoryLeakScore` | number | 内存泄露检视评分（0-100 整数，与报告中 `**综合评分：XX/100**` 的数值一致） |
| `scoreReason` | string | 评分判定依据摘要（可选，前端悬浮提示展示；0 分时强烈建议写明触发规则） |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取评分，无需解析报告文本）。若 prompt 未下发该路径则跳过本节。