# Flutter 鸿蒙化代码内存泄露检视清单

本文档列出 Flutter 三方库鸿蒙化代码内存泄露检视的详细检查项，供检视人员参考。

> ⚠️ **核心定位**：本清单**仅检视鸿蒙化代码**，不检视 Flutter Dart 层或非鸿蒙化部分的代码。
>
> **重要**：目录名称不固定，需通过源码扫描识别鸿蒙化代码特征（如 `@ohos` 导入、NAPI 函数等），而非仅依赖目录名称。

---

## 1. Plugin 生命周期资源管理

### 1.1 FlutterPlugin 生命周期绑定

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| `onAttachedToEngine` | 资源初始化是否完整 | 高 | 缺失 -5 |
| `onDetachedFromEngine` | 是否释放**所有**资源 | **致命** | 未释放 -20 |
| `setMethodCallHandler(null)` | 是否取消 MethodChannel handler | 高 | 未取消 -10 |
| Map 数据清理 | `mConnectedDevices`、`mMtu` 等是否清空 | 高 | 未清空 -12 |
| 释放顺序 | 先取消监听再清空数据 | 中 | 错误 -8 |

**正确示例**：

```typescript
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
  
  // 5. 释放 GattClientDevice 等资源
  for (const device of this.mConnectedDevices.values()) {
    device.close();
  }
}
```

### 1.2 Ability 生命周期绑定

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| `onAttachedToAbility` | Ability 附加时资源注册 | 高 | 未处理 -8 |
| `onDetachedFromAbility` | Ability 分离时资源释放 | **致命** | 未释放 -15 |
| 配置变更处理 | 屏幕旋转等配置变更时的资源处理 | 中 | 未处理 -10 |

**关键检查**：
- 在 `onAttachedToAbility` 注册的监听器，必须在 `onDetachedFromAbility` 取消
- Ability 级监听器不应依赖 `onDetachedFromEngine` 释放

---

## 2. 鸿蒙 API 事件订阅管理

### 2.1 @ohos 模块事件订阅

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| `on/off` 对称性 | 每个 `on()` 是否有对应 `off()` | **致命** | 无对应 -20 |
| 回调参数匹配 | `off()` 是否传入正确的回调函数 | 高 | 错误 -12 |
| 多次注册风险 | 同一事件是否可能被多次注册监听 | 高 | 存在风险 -15 |
| 订阅状态追踪 | 是否有标志位追踪订阅状态 | 中 | 无追踪 -8 |

**致命问题示例**：

```typescript
// ❌ 致命：每次调用都注册新监听器，无对应取消
async setNotifyValue(remoteId: string, characteristic: ble.BLECharacteristic): Promise<void> {
  const gatt = this.mConnectedDevices.get(remoteId);
  gatt.on('BLECharacteristicChange', (data) => {
    this.onCharacteristicReceived(remoteId, data);
  });
  // ⚠️ 每次调用都注册新监听器，断开连接时未取消！
}

// ✅ 正确实现：使用 Map 保存回调引用
private characteristicCallbacks: Map<string, Function> = new Map();

async setNotifyValue(remoteId: string, characteristic: ble.BLECharacteristic): Promise<void> {
  const gatt = this.mConnectedDevices.get(remoteId);
  
  // 先取消旧的监听器
  const oldCallback = this.characteristicCallbacks.get(remoteId);
  if (oldCallback) {
    gatt.off('BLECharacteristicChange', oldCallback);
  }
  
  // 注册新的监听器并保存引用
  const newCallback = (data) => this.onCharacteristicReceived(remoteId, data);
  gatt.on('BLECharacteristicChange', newCallback);
  this.characteristicCallbacks.set(remoteId, newCallback);
}
```

### 2.2 特殊系统资源释放

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| GattClientDevice.close | BLE Gatt 客户端是否调用 close() | **致命** | 未调用 -20 |
| 扫描状态清理 | `ble.stopBLEScan()` 是否在适当时机调用 | 高 | 未调用 -15 |
| 地理位置监听 | `geoLocationManager.off()` 是否取消 | 高 | 未取消 -15 |
| 网络状态监听 | `connection.on/off` 是否对称 | 高 | 不对称 -12 |

**致命泄漏场景**：

```typescript
// ❌ 致命：GattClientDevice 创建后未释放
async scanCallback(device: ble.ScanResult): void {
  const gattClient = ble.createGattClientDevice(device.getMac());
  const deviceName = await gattClient.getDeviceName();
  // ⚠️ gattClient 未调用 close()，每次扫描都泄漏！
}

// ❌ 致命：服务查询创建的 GattClientDevice 未释放
async getServices(remoteId: string): Promise<ble.GattService[]> {
  const gattClient = ble.createGattClientDevice(remoteId);
  const services = await gattClient.getServices();
  return services;  // ⚠️ gattClient 未释放
}

// ✅ 正确实现：使用 try-finally 确保释放
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

## 3. ArkTS 内存管理

### 3.1 闭包循环引用

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| this 捕获 | 箭头函数是否捕获 `this` 引用 | 高 | 捕获且未释放 -15 |
| 闭包保留 | 闭包是否保留外部变量引用 | 高 | 保留且无法释放 -12 |
| 匿名函数累积 | 是否反复创建匿名函数作为回调 | 中 | 累积风险 -10 |

**循环引用检测**：

```typescript
// ❌ 风险：箭头函数捕获 this，形成循环引用
class MyPlugin {
  private gatt: ble.GattClientDevice;
  
  connect(): void {
    this.gatt.on('BLEConnectionStateChange', (state) => {
      this.onConnectionStateChanged(state);  // this 被捕获
    });
    // 循环链：this.gatt → 回调 → this → this.gatt
  }
}

// ✅ 正确实现：在构造函数中预创建回调
class MyPlugin {
  private gatt: ble.GattClientDevice;
  private connectionCallback: Function;
  
  constructor() {
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

### 3.2 Map/Set 数据清理

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| Map.clear() | 是否在适当时机调用 clear() | 高 | 未清理 -12 |
| Map.delete() | 单项数据是否正确删除 | 中 | 删除不完整 -8 |
| 静态 Map 风险 | 静态 Map 是否无限累积 | **致命** | 累积风险 -15 |
| 缓存上限 | 是否设置缓存大小上限 | 中 | 无上限 -10 |

**Map 清理检查**：

```typescript
// ❌ 问题：Map 数据未在适当时机清理
private mScanFilters: Map<string, Object> = new Map();

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

### 3.3 静态变量与全局状态

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| static 可变集合 | 静态 List/Map 是否无限增长 | 高 | 增长风险 -10 |
| 全局缓存清理 | 是否提供全局缓存清理方法 | 中 | 无清理 -8 |
| 单例资源释放 | 单例模式是否正确释放资源 | 高 | 未释放 -10 |

---

## 4. C++ Native 内存管理

### 4.1 NAPI 引用管理

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| `napi_ref` 创建 | 是否为需要长期持有的对象创建 `napi_ref` | 中 | 缺失 -5 |
| `napi_ref` 释放 | 是否在 dispose/destroy 时调用 `napi_delete_reference` | **致命** | 未释放 -25 |
| 引用计数平衡 | `napi_create_reference` 和 `napi_delete_reference` 数量是否匹配 | 高 | 不平衡 -18 |
| Handle Scope 清理 | 是否正确关闭 `napi_handle_scope` | **致命** | 未关闭 -20 |

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
      napi_delete_reference(env, this->callbackRef);
      this->callbackRef = nullptr;
    }
  }
};
```

### 4.2 Native 内存分配释放

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| malloc/free 匹配 | 每个 `malloc` 是否有对应 `free` | **致命** | 不匹配 -20 |
| new/delete 匹配 | 每个 `new` 是否有对应 `delete` | **致命** | 不匹配 -20 |
| 异常路径释放 | 异常发生时是否释放已分配内存 | 高 | 未释放 -15 |
| RAII 模式 | 是否优先使用智能指针 | 中 | 未使用 -10 |

**RAII 推荐模式**：

```cpp
// ✅ 使用智能指针自动管理
#include <memory>

void processData() {
  std::unique_ptr<Buffer> buffer = std::make_unique<Buffer>(1024);
  // 自动释放，无需手动 delete
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

## 5. 评分规则汇总

### 致命问题（-20 分，最多扣 60 分）

| 问题类型 | 扣分 | 直接 0 分条件 |
|----------|------|---------------|
| GattClientDevice 未释放 | -20 | ≥ 3 个致命问题 |
| NAPI 引用未释放 | -25 | ≥ 2 个致命 + ≥ 3 个严重 |
| Handle Scope 未关闭 | -20 | 累计扣分 > 60 |
| malloc/free 不匹配 | -20 | |
| new/delete 不匹配 | -20 | |
| 事件订阅无对应取消 | -20 | |
| onDetachedFromEngine 未释放资源 | -20 | |
| 静态 Map 无限累积 | -15 | |

### 严重问题（-15 分）

| 问题类型 | 扣分 |
|----------|------|
| 闭包循环引用风险 | -15 |
| Map 数据未清理 | -12 |
| 静态集合累积风险 | -15 |
| Ability 生命周期未绑定 | -15 |
| onDetachedFromAbility 缺失 | -15 |

### 中等问题（-10 分）

| 问题类型 | 扣分 |
|----------|------|
| 订阅状态未追踪 | -8 |
| 回调参数匹配错误 | -12 |
| 缓存无上限 | -10 |
| 单例资源释放不完整 | -10 |
| 多次注册风险 | -15 |

### 轻微问题（-5 分）

| 问题类型 | 扣分 |
|----------|------|
| 释放顺序不当 | -8 |
| 初始化不完整 | -5 |
| 配置变更未处理 | -10 |

---

## 6. 鸿蒙代码识别与检视范围

### 6.1 鸿蒙代码特征识别

**优先通过代码特征识别**，而非仅依赖目录名称。

**ArkTS/ETS 代码特征**：
- `@ohos` 模块导入（如 `import ble from '@ohos.bluetooth'`）
- 鸿蒙 API 调用（如 `ble.createGattClientDevice()`、`connection.pairDevice()`）
- FlutterPlugin 鸳蒙实现类
- `.ets` 文件扩展名

**C++ Native 代码特征**：
- NAPI 头文件引用（`#include <napi/native_api.h>`）
- NAPI 函数调用（`napi_create_reference`、`napi_delete_reference` 等）
- 鸿蒙 Native API（`OH_NativeXxx` 等）

### 6.2 常见鸿蒙化目录（仅供参考）

```
常见目录名称（不作为唯一判定依据）：
├── ohos/                          # 最常见
├── harmony/                       # 部分库使用
├── harmonyos/                     # 部分库使用
├── src/ohos/                      # 嵌入式结构
├── platform/ohos/                 # 平台分离结构
├── native/                        # Native 实现（需检查 NAPI 特征）
├── ets/                           # 独立 ETS 目录
├── android/                       # Android 实现 ❌ 不检视
├── ios/                           # iOS 实现 ❌ 不检视
├── lib/                           # Flutter Dart 层 ❌ 不检视
```

### 6.3 判定规则

- **优先通过代码特征识别**，而非仅依赖目录名称
- 若扫描到 `@ohos` 模块导入或 NAPI 函数调用 → **确认鸿蒙化实现**
- 若存在 `.ets` 文件且包含鸿蒙 API 调用 → **确认鸿蒙化实现**
- 若扫描整个源码均未发现鸿蒙代码特征 → **报告评分 0 分**，标注"未实现鸿蒙化"
- **注意**：即使没有 ohos 目录，但源码中存在鸿蒙化实现，仍需检视