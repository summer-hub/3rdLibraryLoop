# 函数级一致性对比指南

本文档定义一致性检视中**函数级对比**的具体操作规范，确保每个对比项包含可定位的函数信息而非模糊的文字描述。

---

## 1. 函数级对比的核心原则

> ⚠️ **核心原则**：功能一致性对比**必须以具体函数为粒度**，而非以"连接管理"等模糊文字描述为粒度。每个对比项必须包含函数名、签名、文件位置、代码片段，确保检视结果可直接定位到代码问题。

### 1.1 对比粒度要求

| 粒度 | 说明 | 是否允许 | 原因 |
|------|------|----------|------|
| 模块级 | 如"连接管理功能一致" | ❌ **不允许** | 无法定位具体问题 |
| 功能级 | 如"BLE扫描功能一致" | ❌ **不允许** | 无法定位具体问题 |
| 函数级 | 如"`connectToDevice(deviceId)` 方法一致" | ✅ **必须** | 可定位、可验证、可修复 |
| 参数级 | 如"`force_indications` 参数类型 bool→string" | ✅ **必须** | 可定位致命错误 |

### 1.2 每个对比项必须包含的信息

每个函数级对比项**必须包含以下全部字段**：

```
必填字段清单：
├── 函数名称          # 如 connectToDevice、removeBond、setNotifyValue
├── 函数签名          # 如 connectToDevice(deviceId: string): Promise<boolean>
├── 所在文件          # 如 ohos/ets/plugin.ets:234、android/src/main/java/BluetoothPlugin.java:156
├── Dart 接口定义     # 对应的 MethodChannel 名称或 Dart 接口
├── 代码片段          # 关键实现代码（至少3行）
├── 对比状态          # ✅ 一致 / ❌ 不一致 / ⚠️ Stub / ⛔ 缺失 / 🔶 平台差异
├── 问题描述          # 具体差异描述（必须引用具体代码行）
└── 扣分              # 根据扣分规则计算的扣分值
```

---

## 2. 函数提取与对比流程

### 2.1 从源码中提取函数清单

**步骤 1：提取 Dart 层接口定义**

从 `lib/` 目录下的 Dart 代码中提取所有 MethodChannel 调用和公开接口：

```dart
// 示例：从 Dart 代码提取的方法列表
// 文件：lib/src/bluetooth_plugin.dart

static const MethodChannel _channel = MethodChannel('flutter_bluetooth');

// 提取的所有方法：
1. Future<bool> connectToDevice(String deviceId)        → Method: 'connectToDevice'
2. Future<void> disconnect(String deviceId)             → Method: 'disconnect'  
3. Future<bool> removeBond(String deviceId)             → Method: 'removeBond'
4. Future<void> setNotifyValue({bool force_indications}) → Method: 'setNotifyValue'
5. Future<String> getAdapterName()                      → Method: 'getAdapterName'
6. Future<void> requestConnectionPriority({String priority}) → Method: 'requestConnectionPriority'
7. Future<void> clearGattCache(String deviceId)         → Method: 'clearGattCache'
```

**步骤 2：提取 Android 层方法实现**

从 `android/src/main/java/` 或 `kotlin/` 目录提取所有公开方法：

```java
// 示例：从 Android 代码提取的方法列表
// 文件：android/src/main/java/BluetoothPlugin.java

1. public boolean connectToDevice(String deviceId)     → line 156
2. public void disconnect(String deviceId, int reason) → line 203
3. public boolean removeBond(String deviceId)          → line 278
4. public void setNotifyValue(boolean force_indications) → line 342
5. public String getAdapterName()                      → line 410
6. public void requestConnectionPriority(String priority) → line 455
7. public void clearGattCache(String deviceId)         → line 502
```

**步骤 3：提取 iOS 层方法实现**

从 `ios/Classes/` 目录提取所有公开方法：

```swift
// 示例：从 iOS 代码提取的方法列表
// 文件：ios/Classes/FlutterBluetoothPlugin.m

1. - (BOOL)connectToDevice:(NSString *)deviceId         → line 89
2. - (void)disconnect:(NSString *)deviceId              → line 134
3. - (BOOL)removeBond:(NSString *)deviceId              → line 176  // iOS 有系统限制
4. - (void)setNotifyValue:(BOOL)forceIndications        → line 210
5. - (NSString *)getAdapterName                         → line 256
```

**步骤 4：提取 OHOS 层方法实现**

从鸿蒙代码（ohos/ets/ 或其他定位到的目录）提取所有方法：

```typescript
// 示例：从 OHOS 代码提取的方法列表
// 文件：ohos/ets/plugin.ets

1. connectToDevice(deviceId: string): Promise<boolean>   → line 89
2. disconnect(deviceId: string): Promise<void>           → line 134
3. removeBond(deviceId: string): Promise<boolean>        → line 278  // ⚠️ Stub
4. setNotifyValue(force_indications: string): Promise<void> → line 342  // ⚠️ 类型错误
5. getAdapterName(): Promise<string>                     → line 410  // ⛔ 返回错误
```

### 2.2 构建函数级对比矩阵

将四个平台的方法提取结果构建为**函数级对比矩阵**：

```markdown
| # | Dart 接口 | Android 实现 | iOS 实现 | OHOS 实现 | 对比状态 |
|---|-----------|-------------|---------|----------|----------|
| 1 | `connectToDevice(deviceId)` → `connect` | `BluetoothPlugin.java:156` `public boolean connectToDevice(String)` | `FlutterBluetoothPlugin.m:89` `-(BOOL)connectToDevice:(NSString*)` | `plugin.ets:89` `connectToDevice(deviceId: string)` | ✅ 签名一致 |
| 2 | `disconnect(deviceId)` → `disconnect` | `BluetoothPlugin.java:203` `public void disconnect(String, int)` | `FlutterBluetoothPlugin.m:134` `-(void)disconnect:(NSString*)` | `plugin.ets:134` `disconnect(deviceId: string)` | ⚠️ Android 多 reason 参数 |
| 3 | `removeBond(deviceId)` → `removeBond` | `BluetoothPlugin.java:278` `public boolean removeBond(String)` | `FlutterBluetoothPlugin.m:176` `-(BOOL)removeBond:(NSString*)` iOS限制 | `plugin.ets:278` stub `return true` | ❌ OHOS Stub |
```

### 2.3 逐函数深度对比分析

对每个函数进行**四维对比**：

```
函数级四维对比：
├── 维度 1：方法签名
│   ├── 方法名是否一致
│   ├── 参数数量是否一致  
│   ├── 参数顺序是否一致
│   └── 参数类型是否一致
├── 维度 2：参数类型映射
│   ├── bool → boolean（致命：bool→string）
│   ├── int → number
│   ├── String → string
│   ├── List → Array
│   └── Map → Record/Object
├── 维度 3：返回值语义
│   ├── 返回类型是否匹配
│   ├── 返回语义是否一致
│   ├── void 方法是否正确处理
│   └── 错误返回是否标准格式
├── 维度 4：实现行为
│   ├── 是否调用实际系统 API
│   ├── 是否为 stub（返回固定值）
│   ├── 是否返回错误消息
│   ├── 核心逻辑是否一致
```

---

## 3. 函数级对比报告格式

### 3.1 API 契约函数级对比表

**必须使用以下格式**，每个对比项包含函数名、签名、文件位置：

```markdown
### 1.1 方法签名函数级对比

| # | 函数名 | Dart 签名 | OHOS 签名 | OHOS 文件:行号 | 状态 | 扣分 |
|---|--------|-----------|-----------|---------------|------|------|
| 1 | `connectToDevice` | `Future<bool> connectToDevice(String deviceId)` | `connectToDevice(deviceId: string): Promise<boolean>` | `plugin.ets:89` | ✅ 一致 | 0 |
| 2 | `setNotifyValue` | `Future<void> setNotifyValue({bool force_indications})` | `setNotifyValue(force_indications: string): Promise<void>` | `plugin.ets:342` | ❌ 参数类型错误 | -15 |
| 3 | `removeBond` | `Future<bool> removeBond(String deviceId)` | `removeBond(deviceId: string): Promise<boolean>` | `plugin.ets:278` | ⚠️ Stub | -8 |
| 4 | `getAdapterName` | `Future<String> getAdapterName()` | `getAdapterName(): Promise<string>` | `plugin.ets:410` | ⛔ 返回错误 | -10 |
| 5 | `requestConnectionPriority` | `Future<void> requestConnectionPriority({String priority})` | — | — | ⛔ 方法缺失 | -10 |
```

### 3.2 参数类型函数级对比表

**必须列出每个参数的具体类型映射**：

```markdown
### 1.2 参数类型函数级对比

| # | 函数名 | 参数名 | Dart 类型 | OHOS 解析类型 | OHOS 代码行 | as 语句 | 状态 | 扣分 |
|---|--------|--------|-----------|-------------|------------|---------|------|------|
| 1 | `setNotifyValue` | `force_indications` | `bool` | `string` ❌ | `plugin.ets:344` | `as string` | ❌ 致命类型错误 | -15 |
| 2 | `connectToDevice` | `deviceId` | `String` | `string` | `plugin.ets:91` | `as string` | ✅ 正确 | 0 |
| 3 | `disconnect` | `deviceId` | `String` | `string` | `plugin.ets:136` | `as string` | ✅ 正确 | 0 |
| 4 | `setNotifyValue` | `force_indications` | `bool` | — | — | — | ⛔ 缺失参数 | -8 |
```

### 3.3 返回值函数级对比表

```markdown
### 1.3 返回值函数级对比

| # | 函数名 | Dart 期望返回 | OHOS 实际返回 | OHOS 代码行 | 代码片段 | 状态 | 扣分 |
|---|--------|-------------|-------------|------------|----------|------|------|
| 1 | `setOptions` | `void` | `Map<string, Object>` ❌ | `plugin.ets:502` | `return mConnectedDevices;` | ❌ 语义错误 | -8 |
| 2 | `connectToDevice` | `bool` | `boolean` | `plugin.ets:89` | `return result;` | ✅ 正确 | 0 |
| 3 | `removeBond` | `bool` | `boolean` (固定 true) | `plugin.ets:278` | `return true; // stub` | ⚠️ Stub | -8 |
```

### 3.4 平台功能函数级对比表

**这是最关键的对比维度**，必须列出每个函数在三个平台的实现状态：

```markdown
### 2.1 Android vs OHOS 函数级功能对比

| # | 函数名 | Android 文件:行号 | Android 实现 | OHOS 文件:行号 | OHOS 实现 | 对比状态 | 扣分 |
|---|--------|------------------|-------------|---------------|----------|----------|------|
| 1 | `connectToDevice` | `BluetoothPlugin.java:156` | ✅ 实际调用 BluetoothGatt.connect() | `plugin.ets:89` | ✅ 实际调用 @ohos.bluetooth.ble | ✅ 一致 | 0 |
| 2 | `removeBond` | `BluetoothPlugin.java:278` | ✅ 实际调用 BluetoothDevice.removeBond() | `plugin.ets:278` | ❌ Stub: `return true;` 无实际操作 | ❌ 致命不一致 | -15 |
| 3 | `setNotifyValue` | `BluetoothPlugin.java:342` | ✅ 实际调用 gatt.setCharacteristicNotification() + write descriptor | `plugin.ets:342` | ⚠️ force_indications 类型错误导致功能失效 | ❌ 致命不一致 | -15 |
| 4 | `getAdapterName` | `BluetoothPlugin.java:410` | ✅ 返回 BluetoothAdapter.getName() | `plugin.ets:410` | ⛔ 返回 "not supported" 错误消息 | ⛔ 功能缺失 | -15 |
| 5 | `clearGattCache` | `BluetoothPlugin.java:502` | ✅ 实际清理缓存 | `plugin.ets:502` | ❌ Stub: `return true;` | ❌ 严重不一致 | -12 |
| 4 | `requestConnectionPriority` | `BluetoothPlugin.java:455` | ✅ 实际调用 gatt.requestConnectionPriority() | — | ⛔ 方法不存在 | 🔶 平台限制 | 0 |

> **🔶 平台限制判定说明**：`requestConnectionPriority` 经查阅 `@ohos.bluetooth.ble` 官方文档确认无此接口，且无替代 API 可实现相同功能，iOS 亦存在类似限制，因此判定为平台限制，**不扣分**。但要求代码中添加注释说明该限制。
```

### 3.5 函数级 Stub 检测表

```markdown
### Stub 方法函数级检测

| # | 函数名 | OHOS 文件:行号 | Stub 代码片段 | 缺失的 @ohos API 调用 | 缺失的业务逻辑 | 扣分 |
|---|--------|---------------|--------------|---------------------|---------------|------|
| 1 | `removeBond` | `plugin.ets:278` | `if (!connected) return false; return true;` | `connection.unpairDevice()` | 实际解绑操作 | -8 |
| 2 | `clearGattCache` | `plugin.ets:502` | `return true;` | 无对应 API | 缓存清理操作 | 🔶 平台限制 0 |
| 3 | `requestConnectionPriority` | — | 方法不存在 | `@ohos.bluetooth.ble` 无此接口 | 连接优先级设置 | 🔶 平台限制 0 |
```

---

## 4. 函数级代码片段引用规范

### 4.1 代码片段必须包含的关键信息

每个代码片段引用必须包含：

```
代码片段引用规范：
├── 文件路径        # 如 ohos/ets/plugin.ets
├── 行号范围        # 如 :278-282
├── 函数签名        # 如 removeBond(deviceId: string): Promise<boolean>
├── 关键代码行      # 至少 3 行实际代码
├── 问题标注        # 在代码片段中标注问题所在行
└── 修复示例        # 展示正确实现的代码
```

### 4.2 代码片段格式示例

**致命问题代码片段格式**：

```markdown
**问题**：`removeBond` 方法为 Stub 实现，未调用实际解绑 API

**文件位置**：`ohos/ets/plugin.ets:278-282`

**问题代码**：
```typescript
async removeBond(deviceId: string): Promise<boolean> {
  if (!this.isConnected(deviceId)) {
    return false;
  }
  return true;  // ❌ Stub: 未调用 unpairDevice，始终返回 true
}
```

**Android 参考实现**（`BluetoothPlugin.java:278-285`）：
```java
public boolean removeBond(String deviceId) {
  BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
  return device.removeBond();  // ✅ 实际调用解绑方法
}
```

**修复方案**：
```typescript
async removeBond(deviceId: string): Promise<boolean> {
  if (!this.isConnected(deviceId)) {
    return false;
  }
  try {
    return await connection.unpairDevice(deviceId);  // ✅ 调用 OHOS 解绑 API
  } catch (err) {
    throw new PlatformException('removeBond failed', err.code, err.message);
  }
}
```
```

### 4.3 禁止使用的模糊描述

| ❌ 禁止格式 | ✅ 必须格式 | 原因 |
|------------|-----------|------|
| "连接管理功能一致" | "`connectToDevice(deviceId: string): Promise<boolean>` — Android `BluetoothPlugin.java:156` 实际调用 `BluetoothGatt.connect()`，OHOS `plugin.ets:89` 实际调用 `@ohos.bluetooth.ble.connect()`，核心行为一致" | 模糊描述无法定位和验证 |
| "BLE扫描功能缺失" | "`startScan(filter: ScanFilter)` — Android `BluetoothPlugin.java:89` 实际调用 `BluetoothLeScanner.startScan()`，OHOS 未实现该方法" | 必须指明具体缺失的函数 |
| "通知订阅不一致" | "`setNotifyValue(force_indications: bool)` → OHOS 解析为 `string` — `plugin.ets:344` `as string` 导致功能失效" | 必须指明具体参数和类型错误 |
| "绑定管理有问题" | "`removeBond(deviceId)` → `plugin.ets:278` 为 Stub，返回固定 `true`，未调用 `connection.unpairDevice()`" | 必须指明具体函数和问题 |

---

## 5. 函数级对比的评分应用

### 5.1 每个函数独立评分

每个函数的对比结果独立计算扣分，而非按功能模块统一扣分：

```
函数级独立扣分：
├── 函数 A: connectToDevice
│   ├── 签名一致 → 0 分扣减
│   ├── 参数类型正确 → 0 分扣减
│   └── 行为一致 → 0 分扣减
│   └── 总扣分：0 分
├── 函数 B: setNotifyValue  
│   ├── 签名一致 → 0 分扣减
│   ├── 参数类型致命错误 (bool→string) → -15 分
│   ├── 行为致命不一致 → -15 分
│   └── 总扣分：-30 分
├── 函数 C: removeBond
│   ├── 签名一致 → 0 分扣减
│   ├── Stub 实现 → -8 分
│   ├── 总扣分：-8 分
```

### 5.2 扣分规则与函数级映射

| 扣分类别 | 函数级判定 | 扣分值 | 示例 |
|----------|-----------|--------|------|
| 致命-方法缺失 | 函数在 OHOS 中不存在（适配缺陷） | -10 分 | `getAdapterName` 方法不存在于 `plugin.ets` |
| 🔶 平台限制-方法缺失 | 函数在 OHOS 中不存在且鸿蒙无对应系统 API 且无替代路径 | **0 分** | `requestConnectionPriority` 因 `@ohos.bluetooth.ble` 无此接口，判定为平台限制 |
| 致命-类型错误 | 参数类型映射致命错误 | -15 分 | `force_indications` 在 `plugin.ets:344` 解析为 `string` 而非 `boolean` |
| 致命-Stub实现 | 方法返回固定值无实际操作 | -8 分 | `removeBond` 在 `plugin.ets:278` 仅返回 `true` |
| 致命-返回错误 | 方法返回错误消息而非实现 | -10 分 | `getAdapterName` 在 `plugin.ets:410` 返回 "not supported" |
| 严重-行为不一致 | 函数核心逻辑差异 | -12 分 | `disconnect` 在 Android 传递 reason 码，OHOS 硬编码 `code: 1` |
| 中等-参数数量 | 参数数量不匹配 | -8 分 | Android `disconnect` 有 reason 参数，OHOS 无 |
| 轻微-命名不规范 | 函数名不符合规范 | -3 分 | `OnDiscoveredServices` 应为 `onDiscoveredServices` |

---

**文档版本**：v3.1
**更新时间**：2026-07-03
**适用范围**：Flutter 三方库一致性检视函数级对比

> 🔶 **鸿蒙平台限制判定规则**：详见 [PLATFORM_LIMITATION_GUIDE.md](PLATFORM_LIMITATION_GUIDE.md)。确认无法鸿蒙化的接口直接不扣分，无需检查文档化状态。