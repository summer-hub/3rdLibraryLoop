# RN 函数级一致性对比指南

本文档定义 RN 一致性检视中**函数级对比**的具体操作规范，确保每个对比项包含可定位的函数信息而非模糊的文字描述。

---

## 1. 函数级对比的核心原则

> ⚠️ **核心原则**：功能一致性对比**必须以具体函数为粒度**，而非以"连接管理"等模糊文字描述为粒度。每个对比项必须包含函数名、签名、文件位置、代码片段，确保检视结果可直接定位到代码问题。

### 1.1 对比粒度要求

| 粒度 | 说明 | 是否允许 | 原因 |
|------|------|----------|------|
| 模块级 | 如"NativeModule 功能一致" | ❌ **不允许** | 无法定位具体问题 |
| 功能级 | 如"蓝牙扫描功能一致" | ❌ **不允许** | 无法定位具体问题 |
| 函数级 | 如 "`connect(deviceId)` 方法一致" | ✅ **必须** | 可定位、可验证、可修复 |
| 参数级 | 如 "`deviceId` 参数类型 string→number" | ✅ **必须** | 可定位致命错误 |

### 1.2 每个对比项必须包含的信息

每个函数级对比项**必须包含以下全部字段**：

```
必填字段清单：
├── 函数名称          # 如 connect、startScan、sendData
├── 函数签名          # 如 connect(deviceId: string): Promise<boolean>
├── 所在文件          # 如 source/ohos/ets/NativeModule.ets:234、android/src/main/java/Module.java:156
├── JS 接口定义       # 对应的 NativeModules.XXX 或 TurboModule Spec
├── 代码片段          # 关键实现代码（至少3行）
├── 对比状态          # ✅ 一致 / ❌ 不一致 / ⚠️ Stub / ⛔ 缺失 / 🔶 平台差异
├── 问题描述          # 具体差异描述（必须引用具体代码行）
└── 扣分              # 根据扣分规则计算的扣分值
```

---

## 2. RN 源码函数提取流程

### 2.1 从 JS/TS 接口层提取方法清单

从 RN 库的 JS 层代码中提取所有 `NativeModules` 调用和 `TurboModuleRegistry` 注册：

```typescript
// 示例：从 JS 代码提取的方法列表
// 文件：src/NativeBluetoothModule.ts

import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  // 提取的所有方法：
  connect(deviceId: string): Promise<boolean>;           // Method: 'connect'
  disconnect(deviceId: string): Promise<void>;            // Method: 'disconnect'
  startScan(options: Object): Promise<void>;              // Method: 'startScan'
  stopScan(): Promise<void>;                              // Method: 'stopScan'
  sendData(deviceId: string, data: string): Promise<boolean>;  // Method: 'sendData'
  getConnectedDevices(): Promise<Array<string>>;          // Method: 'getConnectedDevices'
  removeBond(deviceId: string): Promise<boolean>;         // Method: 'removeBond'
}

export default TurboModuleRegistry.getEnforcing<Spec>('BluetoothModule');
```

**关键提取点**：
- `NativeModules.XXX` 直接调用的所有方法
- `TurboModuleRegistry.getEnforcing<Spec>('XXX')` 的 Spec 接口方法
- `NativeEventEmitter` 绑定的事件名
- 导出的常量（`getConstants()`）

### 2.2 从 Android 原生模块提取实现

从 `android/` 目录下的 Java/Kotlin 代码提取 NativeModule 方法：

```kotlin
// 示例：Android 原生模块实现
// 文件：android/src/main/java/com/example/BluetoothModule.kt

class BluetoothModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "BluetoothModule"

    @ReactMethod
    fun connect(deviceId: String, promise: Promise) {
        // 实际蓝牙连接实现
        val device = bluetoothAdapter.getRemoteDevice(deviceId)
        device.connect()
        promise.resolve(true)
    }

    @ReactMethod
    fun startScan(options: ReadableMap, promise: Promise) { ... }
}
```

**提取标记**：`@ReactMethod`、`@ReactSyncMethod`、`getConstants()`、`@ReactProperty`

### 2.3 从 iOS 原生模块提取实现

从 `ios/` 目录下的 Objective-C/Swift 代码提取 NativeModule 方法：

```objc
// 示例：iOS 原生模块实现
// 文件：ios/BluetoothModule.m

RCT_EXPORT_MODULE(BluetoothModule);

RCT_REMAP_METHOD(connect,
                 connectWithDeviceId:(NSString *)deviceId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
    // 实际 CoreBluetooth 连接实现
    [self.centralManager connectToDevice:deviceId];
    resolve(@(YES));
}

RCT_EXPORT_METHOD(startScan:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) { ... }
```

**提取标记**：`RCT_EXPORT_MODULE`、`RCT_EXPORT_METHOD`、`RCT_REMAP_METHOD`、`RCT_REMAP_BLOCKING_SYNCHRONOUS_METHOD`

### 2.4 从鸿蒙化代码提取实现

从 `source/ohos/` 下的 ArkTS/ETS 代码提取 TurboModule 方法：

```typescript
// 示例：鸿蒙化 TurboModule 实现
// 文件：source/ohos/ets/BluetoothModule.ets

export class BluetoothModule extends TurboModule {
  connect(deviceId: string): Promise<boolean> {
    // 对比 Android/iOS 实现
    const device = bluetooth.connect(deviceId);
    return Promise.resolve(true);
  }

  startScan(options: Record<string, Object>): Promise<void> {
    // 实际扫描实现
    return bluetooth.startBleScan(options);
  }
}
```

**提取标记**：TurboModule 继承、`@ohos.*` API 调用、NAPI 绑定函数

---

## 3. 函数级对比表格规范

### 3.1 方法签名对比表

```markdown
| # | 方法名 | JS Spec 签名 | OHOS 签名 | OHOS 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|-----------|---------------|------|------|
| 1 | `connect` | `connect(deviceId: string): Promise<boolean>` | `connect(deviceId: string): Promise<boolean>` | `BluetoothModule.ets:89` | ✅ 一致 | 0 |
| 2 | `removeBond` | `removeBond(deviceId: string): Promise<boolean>` | `removeBond(deviceId: string): Promise<boolean>` | `BluetoothModule.ets:278` | ⚠️ Stub | -8 |
```

### 3.2 参数类型对比表

```markdown
| # | 方法名 | 参数名 | JS/Android 类型 | OHOS 解析类型 | OHOS 文件:行号 | as 语句 | 状态 | 扣分 |
|---|--------|--------|----------------|-------------|---------------|---------|------|------|
| 1 | `startScan` | `options` | `Object` | `Record<string, Object>` | `BluetoothModule.ets:120` | `as Record<string, Object>` | ✅ 正确 | 0 |
| 2 | `setNotify` | `force` | `boolean` | `string` ❌ | `BluetoothModule.ets:344` | `as string` | ❌ 致命 | -15 |
```

### 3.3 Android vs OHOS 函数级功能对比表

```markdown
| # | 方法名 | Android 文件:行号 | Android 实现摘要 | OHOS 文件:行号 | OHOS 实现摘要 | 对比状态 | 扣分 |
|---|--------|------------------|-----------------|---------------|-------------|----------|------|
| 1 | `connect` | `BluetoothModule.kt:89` | ✅ 调用 `BluetoothDevice.connectGatt()` | `BluetoothModule.ets:89` | ✅ 调用 `@ohos.bluetooth.ble.connect()` | ✅ 一致 | 0 |
| 2 | `removeBond` | `BluetoothModule.kt:278` | ✅ 调用 `BluetoothDevice.removeBond()` | `BluetoothModule.ets:278` | ❌ Stub: `return true;` 未调用 `unpairDevice()` | ❌ 致命 | -15 |
```

### 3.4 iOS vs OHOS 函数级功能对比表

```markdown
| # | 方法名 | iOS 文件:行号 | iOS 实现摘要 | OHOS 文件:行号 | OHOS 实现摘要 | 对比状态 | 扣分 |
|---|--------|-------------|-------------|---------------|-------------|----------|------|
| 1 | `connect` | `BluetoothModule.m:45` | ✅ 调用 `CBCentralManager.connect()` | `BluetoothModule.ets:89` | ✅ 调用 `ble.connect()` | ✅ 一致 | 0 |
```

---

## 4. RN 特有模式对比

### 4.1 TurboModule Spec 一致性

RN 新架构下，TurboModule Spec（由 Codegen 生成）定义了接口契约。鸿蒙化实现必须与 Spec 完全一致：

| 检查项 | 对比对象 | 扣分规则 |
|--------|----------|----------|
| Spec 方法签名 | Codegen Spec vs OHOS 实现 | 不一致扣 10 分 |
| Spec 类型映射 | Flow/TS 类型 vs ArkTS 类型 | 映射错误扣 8 分 |
| Spec 常量 | Spec getConstants() vs OHOS getConstants() | 缺失扣 5 分 |
| Spec 事件 | Spec 事件定义 vs OHOS 事件发送 | 缺失扣 5 分 |

### 4.2 NativeModule 传统桥接一致性

RN 旧架构下，NativeModules 通过 `@ReactMethod` / `RCT_EXPORT_METHOD` 暴露接口：

| 检查项 | 对比对象 | 扣分规则 |
|--------|----------|----------|
| 方法名映射 | NativeModules.XXX 方法名 vs OHOS 方法名 | 不一致扣 5 分 |
| Promise 回调 | Android/iOS Promise resolve/reject vs OHOS | 不一致扣 6 分 |
| Callback 处理 | Android/iOS Callback vs OHOS 回调 | 不一致扣 5 分 |
| 事件发送 | Android/iOS sendEvent vs OHOS 事件发送 | 不一致扣 5 分 |

### 4.3 NAPI/C++ Native 层一致性

若鸿蒙化涉及 NAPI 绑定（C++ Native 层），需对比：

| 检查项 | 对比对象 | 扣分规则 |
|--------|----------|----------|
| NAPI 函数注册 | C++ napi_define_properties vs JS 导出 | 注册缺失扣 8 分 |
| NAPI 类型转换 | napi_value 类型与 JS 期望类型 | 转换错误扣 10 分 |
| NAPI 回调 | napi_call_threadsafe_function vs Android/iOS 回调 | 回调不一致扣 6 分 |

---

## 5. Stub 实现识别特征

| 特征 | 示例 | 判定 |
|------|------|------|
| 返回固定值 | `return true;` / `return false;` / `return '';` | Stub |
| 返回错误消息 | `return { error: 'not supported' };` | 未实现 |
| 空方法体 | `connect() { }` / `connect() { /* TODO */ }` | 未实现 |
| 仅打印日志 | `console.log('connect called'); return;` | Stub |
| 未调用 @ohos API | 方法内无任何 `@ohos.*` 或系统 API 调用 | Stub |
