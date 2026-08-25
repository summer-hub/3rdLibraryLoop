# RN 鸿蒙化代码内存泄露检视清单

本文档列出 RN 三方库鸿蒙化代码内存泄露检视的详细检查项、正例/反例代码示例和扣分细则，作为 SKILL.md Phase 1-5 的详细参考。

> ⚠️ **核心定位**：本清单**仅检视鸿蒙化代码**，不检视 RN JS 层或非鸿蒙化部分的代码。
>
> **重要**：目录名称不固定，需通过源码扫描识别鸿蒙化代码特征（如 `@ohos` 导入、TurboModule 实现、NAPI 函数等），而非仅依赖目录名称。

**相关参考文档**：
- [SKILL.md](../SKILL.md) — 主工作流文件（检视流程概览、Phase 0-5 核心步骤）
- [HARMONY_CODE_PATTERNS.md](HARMONY_CODE_PATTERNS.md) — Phase 0 鸿蒙代码特征识别模式
- [REPORT_TEMPLATE.md](../assets/REPORT_TEMPLATE.md) — 输出报告模板和评分等级对照表

---

## 1. TurboModule/NativeModule 生命周期管理

### 1.1 TurboModule 生命周期绑定

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| `initialize` | 资源初始化是否完整 | 高 | 缺失 -5 |
| `destroy` | 是否释放**所有**资源 | **致命** | 未释放 -20 |
| Bridge 事件监听清理 | NativeEventEmitter/DeviceEventEmitter 监听是否全部移除 | 高 | 未移除 -15 |
| Map 数据清理 | 模块级 Map（如 `mConnectedDevices`）是否清空 | 高 | 未清空 -12 |
| 释放顺序 | 先移除监听→停操作→清数据→释放资源 | 中 | 顺序错误 -8 |

**正确示例**：

```typescript
// ❌ 致命错误：destroy 未释放所有资源
class BleTurboModule extends TurboModule {
  private mConnectedDevices: Map<string, GattClientDevice> = new Map();
  private eventEmitter: NativeEventEmitter;
  private scanListener: EventSubscription | null = null;

  destroy(): void {
    // 仅清空了部分 Map，遗漏了事件监听和系统资源
    this.mConnectedDevices.clear();
    // 缺失：NativeEventEmitter 监听未移除
    // 缺失：ble.stopBLEScan() 未调用
    // 缺失：GattClientDevice 未 close()
  }
}

// ✅ 正确实现
class BleTurboModule extends TurboModule {
  private mConnectedDevices: Map<string, GattClientDevice> = new Map();
  private eventEmitter: NativeEventEmitter;
  private scanListener: EventSubscription | null = null;

  destroy(): void {
    // 1. 移除所有 Bridge 事件监听
    if (this.scanListener) {
      this.scanListener.remove();
      this.scanListener = null;
    }
    this.eventEmitter.removeAllListeners('onBleStateChange');

    // 2. 停止进行中的操作
    ble.stopBLEScan();

    // 3. 释放系统资源
    for (const device of this.mConnectedDevices.values()) {
      device.close();  // 释放 GattClientDevice
    }

    // 4. 清空 Map 数据
    this.mConnectedDevices.clear();

    // 5. 置空回调引用
    this.scanCallback = null;
  }
}
```

### 1.2 NativeComponent 生命周期绑定

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| `onDropViewInstance` | 视图销毁时是否释放所有关联资源 | **致命** | 未释放 -15 |
| View 级监听器清理 | 视图级事件监听是否在视图销毁时移除 | 高 | 未移除 -12 |
| RCTEventEmitter 引用清除 | 原生侧事件发送器引用是否清除 | 高 | 未清除 -10 |
| 子组件递归释放 | 自定义 View 的子 View 是否递归释放 | 中 | 未释放 -10 |

**关键检查**：
- `onDropViewInstance` 必须释放视图持有的所有系统资源（Sensor、Location、Timer 等）
- 视图级的 `on()` 监听不应依赖 TurboModule 的 `destroy()` 释放
- **多实例场景**：同一 ViewManager 创建的多个 View 实例必须各自独立清理

```typescript
// ❌ 致命错误：onDropViewInstance 未清理视图资源
class MapViewManager extends ViewManager {
  onDropViewInstance(view: Component): void {
    super.onDropViewInstance(view);
    // 缺失：view 持有的 Sensor 监听未注销
    // 缺失：view 的 Timer 未清除
  }
}

// ✅ 正确实现
class MapViewManager extends ViewManager {
  onDropViewInstance(view: Component): void {
    // 1. 注销视图级 Sensor 监听
    sensor.off(sensor.SensorId.ACCELEROMETER, view.accelerometerCallback);

    // 2. 清除视图级 Timer
    clearInterval(view.updateTimer);

    // 3. 释放视图级资源
    if (view.mediaPlayer) {
      view.mediaPlayer.release();
    }

    // 4. 从 ViewManager 的 Map 中移除视图实例
    this.viewInstances.delete(view.getTag());

    super.onDropViewInstance(view);
  }
}
```

---

## 2. RN Bridge 事件机制

### 2.1 NativeEventEmitter 监听管理

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| addListener/removeAllListeners | 每个监听是否在适当时机移除 | 高 | 未移除 -15 |
| DeviceEventEmitter 监听泄露 | DeviceEventEmitter.addListener 后是否在 destroy 移除 | 高 | 未移除 -15 |
| RCTEventEmitter 强引用 | 原生侧 RCTEventEmitter 是否持有已销毁 View 引用 | 高 | 持有 -12 |
| 事件发送器生命周期 | EventEmitter 实例是否随 TurboModule 销毁 | 中 | 未销毁 -10 |

**致命问题示例**：

```typescript
// ❌ 致命：每次调用都注册新监听器，destroy 时未移除
class BleTurboModule extends TurboModule {
  startScan(): void {
    this.deviceEventEmitter.addListener('onDeviceFound', (device) => {
      this.handleDeviceFound(device);
    });
    // ⚠️ 多次调用会注册多个监听器，且 destroy 时未移除！
  }
}

// ✅ 正确实现：使用 EventSubscription 保存监听引用
class BleTurboModule extends TurboModule {
  private scanListenerSubscription: EventSubscription | null = null;

  startScan(): void {
    // 先移除旧监听
    if (this.scanListenerSubscription) {
      this.scanListenerSubscription.remove();
    }
    this.scanListenerSubscription = this.deviceEventEmitter.addListener(
      'onDeviceFound', (device) => this.handleDeviceFound(device)
    );
  }

  destroy(): void {
    if (this.scanListenerSubscription) {
      this.scanListenerSubscription.remove();
      this.scanListenerSubscription = null;
    }
    this.eventEmitter.removeAllListeners('onBleStateChange');
  }
}
```

### 2.2 RN Bridge 事件监听的常见泄露场景

```typescript
// ❌ 场景1：Promise 回调中的监听器泄露
class NetworkTurboModule extends TurboModule {
  async waitForConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      this.eventEmitter.addListener('onNetworkChange', (state) => {
        if (state.connected) {
          resolve(true);
          // ⚠️ resolve 后监听器未移除！
        }
      });
    });
  }
}

// ✅ 正确实现
class NetworkTurboModule extends TurboModule {
  private networkListener: EventSubscription | null = null;

  async waitForConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      this.networkListener = this.eventEmitter.addListener('onNetworkChange', (state) => {
        if (state.connected) {
          resolve(true);
          // 移除监听
          if (this.networkListener) {
            this.networkListener.remove();
            this.networkListener = null;
          }
        }
      });
    });
  }
}

// ❌ 场景2：RCTEventEmitter 持有已销毁 View 引用
class CameraViewManager extends ViewManager {
  private eventEmitter: RCTEventEmitter;
  private viewMap: Map<number, Component> = new Map();

  // 视图销毁后 eventEmitter 仍可能向该 view 发送事件
  sendEventToView(viewTag: number, eventName: string, data: Object): void {
    this.eventEmitter.emit(eventName, { viewTag, ...data });
    // ⚠️ 如果 view 已被 onDropViewInstance 清理，事件仍会发送
  }
}

// ✅ 正确实现：发送事件前检查 view 是否仍存在
class CameraViewManager extends ViewManager {
  private eventEmitter: RCTEventEmitter;
  private viewMap: Map<number, Component> = new Map();

  sendEventToView(viewTag: number, eventName: string, data: Object): void {
    if (!this.viewMap.has(viewTag)) {
      return;  // 视图已销毁，不再发送事件
    }
    this.eventEmitter.emit(eventName, { viewTag, ...data });
  }

  onDropViewInstance(view: Component): void {
    this.viewMap.delete(view.getTag());  // 从 Map 中移除
    super.onDropViewInstance(view);
  }
}
```

---

## 3. 鸿蒙 API 事件订阅管理

### 3.1 @ohos 模块事件订阅

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| `on/off` 对称性 | 每个 `on()` 是否有对应 `off()` | **致命** | 无对应 -20 |
| 回调参数匹配 | `off()` 是否传入正确的回调函数引用 | 高 | 参数错误 -12 |
| 多次注册风险 | 同一事件是否可能被多次注册监听 | 高 | 存在风险 -15 |
| TurboModule 级 vs View 级监听 | TurboModule 级监听不应在 View 销毁时取消 | 中 | 混淆 -10 |

**致命问题示例**：

```typescript
// ❌ 致命：每次调用都注册新监听器，无对应取消
class BleTurboModule extends TurboModule {
  async setNotifyValue(remoteId: string, characteristic: ble.BLECharacteristic): Promise<void> {
    const gatt = this.mConnectedDevices.get(remoteId);
    gatt.on('BLECharacteristicChange', (data) => {
      this.onCharacteristicReceived(remoteId, data);
    });
    // ⚠️ 每次调用注册新监听器，断开连接时未取消！
  }
}

// ✅ 正确实现：使用 Map 保存回调引用
class BleTurboModule extends TurboModule {
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

  destroy(): void {
    // 释放所有特征变化监听
    for (const [remoteId, callback] of this.characteristicCallbacks) {
      const gatt = this.mConnectedDevices.get(remoteId);
      if (gatt) {
        gatt.off('BLECharacteristicChange', callback);
      }
    }
    this.characteristicCallbacks.clear();
  }
}
```

### 3.2 特殊系统资源释放

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| GattClientDevice.close | BLE Gatt 客户端是否调用 close() | **致命** | 未调用 -20 |
| 扫描状态清理 | `ble.stopBLEScan()` 是否在适当时机调用 | 高 | 未调用 -15 |
| 地理位置监听 | `geoLocationManager.off()` 是否取消 | 高 | 未取消 -15 |
| Sensor 注销 | `sensor.off()` 是否取消 | **致命** | 未注销 -20 |
| 网络状态监听 | `connection.on/off` 是否对称 | 高 | 不对称 -12 |
| 数据库连接未关闭 | rdb 关闭未调用 close | **致命** | 未关闭 -20 |
| Timer 未清除 | setInterval/setTimeout 未在 destroy 时清除 | 高 | 未清除 -12 |

**致命泄漏场景**：

```typescript
// ❌ 致命：GattClientDevice 创建后未释放
class BleTurboModule extends TurboModule {
  async scanCallback(device: ble.ScanResult): void {
    const gattClient = ble.createGattClientDevice(device.getMac());
    const deviceName = await gattClient.getDeviceName();
    // ⚠️ gattClient 未调用 close()，每次扫描都泄漏！
  }
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

## 4. 闭包与上下文泄露

### 4.1 闭包循环引用

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| this 捕获 | 箭头函数是否捕获 `this` 引用且未在 destroy 释放 | 高 | 捕获且未释放 -15 |
| 闭包保留 | 闭包是否保留外部变量引用且无法释放 | 高 | 保留且无法释放 -12 |
| RN 回调链泄露 | JS → Native → JS 回调链中的闭包引用是否正确断开 | 高 | 未断开 -12 |
| 异步回调持有 stale context | setTimeout/Promise 回调中引用已销毁 TurboModule 上下文 | 中 | 引用 -10 |

**循环引用检测**：

```typescript
// ❌ 风险：箭头函数捕获 this，形成循环引用
class BleTurboModule extends TurboModule {
  private gatt: ble.GattClientDevice;

  connect(): void {
    this.gatt.on('BLEConnectionStateChange', (state) => {
      this.onConnectionStateChanged(state);  // this 被捕获
    });
    // 循环链：this.gatt → 回调 → this → this.gatt
  }
}

// ✅ 正确实现：在构造函数中预创建回调，destroy 时清除引用
class BleTurboModule extends TurboModule {
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

  destroy(): void {
    if (this.gatt) {
      this.gatt.off('BLEConnectionStateChange', this.connectionCallback);
    }
    this.connectionCallback = null;  // 清除引用，打破循环
  }
}
```

### 4.2 RN 特有回调链泄露

```typescript
// ❌ 风险：TurboModule 级回调持有 View 实例引用
class CameraTurboModule extends TurboModule {
  private onFrameCallback: ((frameData: Object) => void) | null = null;

  startCamera(viewTag: number): void {
    const view = this.viewManager.getViewByTag(viewTag);
    this.onFrameCallback = (frameData: Object) => {
      view.updateFrame(frameData);  // 持有 view 引用
    };
    // ⚠️ view 销毁后回调仍持有引用
  }
}

// ✅ 正确实现：使用 viewTag 而非 view 引用
class CameraTurboModule extends TurboModule {
  private onFrameCallbacks: Map<number, Function> = new Map();

  startCamera(viewTag: number): void {
    this.onFrameCallbacks.set(viewTag, (frameData: Object) => {
      const view = this.viewManager.getViewByTag(viewTag);
      if (view) {
        view.updateFrame(frameData);  // 按需获取 view
      }
    });
  }

  // View 销毁时移除回调
  removeFrameCallback(viewTag: number): void {
    this.onFrameCallbacks.delete(viewTag);
  }

  destroy(): void {
    this.onFrameCallbacks.clear();
  }
}
```

### 4.3 Map/Set 数据清理

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| Map.clear() | TurboModule 的 Map 数据是否在 destroy 时调用 clear() | 高 | 未清理 -10 |
| View 实例 Map | ViewManager 维护的 View 实例 Map 是否在 onDropViewInstance 删除 | 高 | 未删除 -12 |
| 静态 Map 风险 | 静态 Map 是否无限累积 | **致命** | 累积风险 -15 |
| 缓存上限 | 是否设置缓存大小上限 | 中 | 无上限 -8 |

**Map 清理检查**：

```typescript
// ❌ 问题：ViewManager 的 View 实例 Map 未在 onDropViewInstance 删除
class CameraViewManager extends ViewManager {
  private viewInstances: Map<number, CameraView> = new Map();

  createViewInstance(viewTag: number): CameraView {
    const view = new CameraView();
    this.viewInstances.set(viewTag, view);
    return view;
  }

  onDropViewInstance(view: Component): void {
    super.onDropViewInstance(view);
    // ⚠️ viewInstances 中该 viewTag 对应的条目未删除！
  }
}

// ✅ 正确实现
class CameraViewManager extends ViewManager {
  private viewInstances: Map<number, CameraView> = new Map();

  createViewInstance(viewTag: number): CameraView {
    const view = new CameraView();
    this.viewInstances.set(viewTag, view);
    return view;
  }

  onDropViewInstance(view: Component): void {
    const viewTag = view.getTag();
    const cameraView = this.viewInstances.get(viewTag);
    if (cameraView) {
      cameraView.release();  // 释放视图资源
      this.viewInstances.delete(viewTag);  // 从 Map 中移除
    }
    super.onDropViewInstance(view);
  }
}
```

---

## 5. NAPI 引用管理

### 5.1 NAPI 引用生命周期

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| `napi_ref` 释放 | 是否在 dispose/destroy 时调用 `napi_delete_reference` | **致命** | 未释放 -20 |
| Handle Scope 清理 | 是否正确关闭 `napi_handle_scope` | **致命** | 未关闭 -20 |
| finalize 回调 | `napi_wrap` 是否提供 finalize 回调释放 Native 对象 | **致命** | 缺失 -20 |
| 引用计数平衡 | `napi_create_reference` 和 `napi_delete_reference` 数量是否匹配 | 高 | 不平衡 -18 |
| ArrayBuffer 外部资源泄露 | `napi_create_external` ArrayBuffer 的 finalize 回调缺失 | 高 | 缺失 -15 |
| NAPI 线程安全函数引用泄露 | `napi_create_threadsafe_function` 后未调用 `napi_release_threadsafe_function` | 高 | 未释放 -15 |

**C++ NAPI 管理示例**：

```cpp
// ❌ 致命：NAPI 引用未释放，且缺少 finalize 回调
class NativeTurboModule {
private:
  napi_ref callbackRef;

public:
  void registerCallback(napi_env env, napi_value callback) {
    napi_create_reference(env, callback, 1, &this->callbackRef);
    // 缺少释放逻辑！
    // 缺少 finalize 回调！
  }
};

// ✅ 正确实现
class NativeTurboModule {
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

// ✅ 正确实现：napi_wrap 带 finalize 回调
void NativeObjectFinalize(napi_env env, void* nativeObj, void* hint) {
  auto* obj = static_cast<NativeResource*>(nativeObj);
  delete obj;  // 在 finalize 中释放 Native 对象
}

napi_status WrapNativeObject(napi_env env, napi_value jsThis, NativeResource* nativeObj) {
  napi_ref ref;
  return napi_wrap(env, jsThis, nativeObj, NativeObjectFinalize, nullptr, &ref);
}
```

### 5.2 Handle Scope 管理

```cpp
// ❌ 致命：Handle Scope 未关闭
napi_value ProcessData(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);

  napi_value result;
  napi_create_string_utf8(env, "hello", NAPI_AUTO_LENGTH, &result);

  // ⚠️ 缺少 napi_close_handle_scope！
  return result;
}

// ✅ 正确实现：使用 RAII 或手动关闭
napi_value ProcessData(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);

  napi_value result;
  napi_create_string_utf8(env, "hello", NAPI_AUTO_LENGTH, &result);

  napi_close_handle_scope(env, scope);  // 必须关闭
  return result;
}
```

---

## 6. TurboModule/JSI 绑定内存

### 6.1 TurboModule C++ 生命周期管理

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| TurboModule C++ 实例释放 | C++ 实例在 JS 对象回收后是否释放 | **致命** | 未释放 -15 |
| JSI HostFunction 泄露 | HostFunction 绑定在 Runtime 销毁时是否释放 | **致命** | 未释放 -15 |
| JSI HostObject 属性回调泄露 | HostObject 的 getter/setter 闭包持有外部引用未清理 | 高 | 未清理 -12 |
| 跨语言回调链泄露 | C++ 层回调引用 JS 函数的双向引用是否正确断开 | 高 | 未断开 -12 |
| Codegen 生成代码资源释放 | Codegen 自动生成的代码中资源释放逻辑是否完整 | 中 | 不完整 -10 |
| TurboModule C++ 与 JS 对象生命周期不一致 | C++ 侧实例比 JS 侧对象存活更久，导致悬垂引用 | **致命** | 不一致 -15 |

**TurboModule C++ 资源释放示例**：

```cpp
// ❌ 致命：TurboModule C++ 实例未在析构时释放资源
class BleTurboModule : public TurboModule {
private:
  std::map<std::string, GattClient*> mConnectedDevices;
  napi_ref mJsCallbackRef;

public:
  ~BleTurboModule() {
    // ⚠️ 未释放 mConnectedDevices 中的 GattClient
    // ⚠️ 未释放 mJsCallbackRef
  }
};

// ✅ 正确实现
class BleTurboModule : public TurboModule {
private:
  std::map<std::string, GattClient*> mConnectedDevices;
  napi_ref mJsCallbackRef = nullptr;

public:
  ~BleTurboModule() {
    // 1. 释放所有 GattClient
    for (auto& [id, client] : mConnectedDevices) {
      delete client;
    }
    mConnectedDevices.clear();

    // 2. 释放 NAPI 引用（注意：需要 env，通常在 destroy 中处理）
  }

  void destroy(napi_env env) {
    // 释放 NAPI 引用
    if (mJsCallbackRef) {
      napi_delete_reference(env, mJsCallbackRef);
      mJsCallbackRef = nullptr;
    }
  }
};
```

### 6.2 JSI HostFunction/HostObject 管理

```cpp
// ❌ 风险：HostFunction 闭包持有外部引用
class MyHostObject : public jsi::HostObject {
private:
  jsi::Function mCallback;  // 持有 JS 函数引用

public:
  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override {
    if (name.utf8(rt) == "callback") {
      return mCallback;  // 返回 JS 函数
    }
    // ⚠️ Runtime 销毁时 mCallback 未释放
  }
};

// ✅ 正确实现：在 Runtime 销毁时清理
class MyHostObject : public jsi::HostObject {
private:
  std::optional<jsi::Function> mCallback;

public:
  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override {
    if (name.utf8(rt) == "callback" && mCallback.has_value()) {
      return mCallback.value();
    }
    return jsi::Value::undefined();
  }

  // Runtime 销毁时由 TurboModule 的 destroy 调用
  void invalidate() {
    mCallback.reset();  // 清除 JS 函数引用
  }
};
```

---

## 7. C/C++ 层内存泄露

### 7.1 Native 内存分配释放

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| malloc/free 匹配 | 每个 `malloc` 是否有对应 `free` | **致命** | 不匹配 -15 |
| new/delete 匹配 | 每个 `new` 是否有对应 `delete` | **致命** | 不匹配 -15 |
| new[]/delete[] 匹配 | `new[]` 是否使用 `delete[]` 释放 | **致命** | 误用 -15 |
| 智能指针循环引用 | `shared_ptr` 循环引用导致引用计数永不为零 | **致命** | 循环引用 -15 |
| 异常路径释放 | 异常发生时是否释放已分配内存 | 高 | 未释放 -12 |
| RAII 模式 | 是否优先使用智能指针 | 中 | 未使用 -10 |
| 全局/静态缓冲区无限增长 | 全局 vector/map 无上限增长 | 高 | 无清理 -12 |

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
  // 禁止拷贝
  BufferGuard(const BufferGuard&) = delete;
  BufferGuard& operator=(const BufferGuard&) = delete;
};
```

**智能指针循环引用检测**：

```cpp
// ❌ 致命：shared_ptr 循环引用
class TurboModuleImpl;
class CallbackHolder : public std::enable_shared_from_this<CallbackHolder> {
public:
  std::shared_ptr<TurboModuleImpl> module;  // 持有 module 引用
};

class TurboModuleImpl : public std::enable_shared_from_this<TurboModuleImpl> {
public:
  std::shared_ptr<CallbackHolder> callback;  // 持有 callback 引用
  // 循环链：module ↔ callback，引用计数永不为零！
};

// ✅ 正确实现：使用 weak_ptr 打破循环
class CallbackHolder {
public:
  std::weak_ptr<TurboModuleImpl> module;  // 弱引用，不增加引用计数
};

class TurboModuleImpl : public std::enable_shared_from_this<TurboModuleImpl> {
public:
  std::shared_ptr<CallbackHolder> callback;
};
```

---

## 8. RN 鸿蒙化特有内存风险

### 8.1 跨语言生命周期不一致

| 检查项 | 问题描述 | 风险等级 | 扣分 |
|--------|----------|----------|------|
| ArkTS on/C++ resource 不对称释放 | ArkTS 层调用 off() 但 C++ 层未释放对应资源，或反过来 | **致命** | 不对称 -15 |
| Native 对象生命周期不一致 | C++ Native 对象与 ArkTS 包装对象生命周期不一致 | **致命** | 不一致 -15 |
| TurboModule 与 View 生命周期混淆 | TurboModule 级资源不应在 View 销毁时释放，反之亦然 | 高 | 混淆 -12 |
| RN Bridge 消息队列累积 | 原生模块与 JS 之间的消息队列在模块销毁时未清空 | 中 | 未清空 -10 |

**跨语言释放不对称示例**：

```typescript
// ❌ 致命：ArkTS 层 off() 但 C++ 层未释放资源
class BleTurboModule extends TurboModule {
  disconnect(remoteId: string): void {
    const gatt = this.mConnectedDevices.get(remoteId);
    gatt.off('BLEConnectionStateChange', this.connectionCallback);
    this.mConnectedDevices.delete(remoteId);
    // ⚠️ ArkTS 层取消了监听并从 Map 删除，但 C++ 层的 GattClient 未释放
  }
}

// ✅ 正确实现：确保 C++ 层也释放对应资源
disconnect(remoteId: string): void {
  const gatt = this.mConnectedDevices.get(remoteId);
  if (gatt) {
    gatt.off('BLEConnectionStateChange', this.connectionCallback);
    gatt.close();  // 确保 C++ 层资源也释放
  }
  this.mConnectedDevices.delete(remoteId);
}
```

### 8.2 Spec Codegen 生成代码

```typescript
// ❌ 风险：Codegen 生成的 TurboModule 代码中未实现资源释放
// Codegen 生成的接口：
interface NativeBleModule extends TurboModule {
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  // ⚠️ 没有 destroy/invalidate 方法来释放资源
}

// ✅ 正确做法：在 Codegen 生成的接口基础上，补充资源释放逻辑
class BleTurboModuleImpl extends TurboModule implements NativeBleModuleSpec {
  // 实现 Codegen 接口方法
  startScan(): Promise<void> { ... }
  stopScan(): Promise<void> { ... }

  // 补充资源释放方法（在 TurboModule destroy 时调用）
  destroy(): void {
    // 释放 Codegen 未管理的资源
    this.cleanupResources();
  }
}
```

---

## 9. 评分规则汇总

### 致命问题（-20 分，最多扣 60 分）

| 问题类型 | 扣分 | 直接 0 分条件 |
|----------|------|---------------|
| TurboModule destroy 未释放资源 | -20 | ≥ 3 个致命问题 |
| onDropViewInstance 未清理 | -15 | ≥ 2 个致命 + ≥ 3 个严重 |
| NAPI 引用未释放 | -20 | 关键路径存在致命 |
| finalize 回调缺失 | -20 | 累计扣分 > 60 |
| Handle Scope 未关闭 | -20 | |
| malloc/free 不匹配 | -15 | |
| new/delete 不匹配 | -15 | |
| 鸿蒙 API 事件订阅无对应取消 | -20 | |
| NativeEventEmitter 监听未移除 | -15 | |
| GattClientDevice 未释放 | -20 | |
| Sensor 未注销 | -20 | |
| 数据库连接未关闭 | -20 | |

### 严重问题（-12 分）

| 问题类型 | 扣分 |
|----------|------|
| Bridge 事件监听未移除 | -15 |
| 闭包循环引用风险 | -15 |
| Map 数据未清理 | -10 |
| View 实例 Map 未删除 | -12 |
| 跨语言回调链泄露 | -12 |
| JSI HostObject 属性回调泄露 | -12 |
| 扫描状态未清理 | -15 |
| Timer 未清除 | -12 |

### 中等问题（-8 分）

| 问题类型 | 扣分 |
|----------|------|
| 回调参数匹配错误 | -12 |
| 释放顺序不当 | -8 |
| 初始化不完整 | -5 |
| TurboModule 级 vs View 级监听混淆 | -10 |
| Codegen 生成代码资源释放不完整 | -10 |
| RN Bridge 消息队列未清空 | -10 |

### 轻微问题（-5 分）

| 问题类型 | 扣分 |
|----------|------|
| 订阅状态未追踪 | -8 |
| 缓存无上限 | -8 |
| RAII 未使用 | -10 |
| 事件发送器未随 TurboModule 销毁 | -10 |
