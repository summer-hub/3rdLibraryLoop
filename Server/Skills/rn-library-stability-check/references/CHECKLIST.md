# RN 稳定性检视完整检查清单

本文件包含所有检查项的详细说明、判定标准和代码示例。

---

## 一、异常处理完整性（维度总分 25 分）

### E-01：关键 API 调用无 try-catch（-10 分）

**判定标准**：涉及 `@ohos.*` 系统模块调用、网络请求、文件 I/O、蓝牙/传感器等系统资源操作的公共方法入口，若无 try-catch 包裹则触发。

**RN 鸿蒙化典型场景**：
- TurboModule 注册方法中对 `@ohos.*` API 的调用
- Native Module 桥接方法中涉及系统资源操作
- `source/ohos/` 下所有对外暴露的 ArkTS 方法

```typescript
// ❌ 触发 E-01（扣 10 分）
async startTracking(options: TrackingOptions): Promise<void> {
  await geoLocationManager.on('locationChange', this.request, this.callback);
  // @ohos.geoLocationManager 调用无异常捕获
}

// ✅ 正确实现
async startTracking(options: TrackingOptions): Promise<void> {
  try {
    await geoLocationManager.on('locationChange', this.request, this.callback);
  } catch (e) {
    throw new Error(`startTracking failed: ${(e as Error).message}`);
  }
}
```

### E-02：Promise rejection 未处理（-8 分）

**判定标准**：
- `.then()` 链无 `.catch()` 或 `.then(null, handler)`
- `await` 调用未在 try-catch 中
- TurboModule 返回 Promise 的方法未处理 rejection

```typescript
// ❌ 触发 E-02（扣 8 分）
fetchData(): void {
  this.httpClient.request(url)  // Promise 未 await 也未 catch
    .then(data => this.processData(data));
  // 缺少 .catch()
}

// ✅ 正确实现
async fetchData(): Promise<void> {
  try {
    const data = await this.httpClient.request(url);
    this.processData(data);
  } catch (e) {
    logger.error('fetchData failed', e);
    throw new Error(`fetchData failed: ${(e as Error).message}`);
  }
}
```

### E-03：异常吞没（-7 分）

**判定标准**：catch 块为空、仅 `console.log`/`console.error`，既不恢复状态、不重新抛出、也不通过回调/TurboModule 向 JS 层上报。

```typescript
// ❌ 触发 E-03（扣 7 分）
async connect(url: string): Promise<void> {
  try {
    await this.socket.connect(url);
  } catch (e) {
    console.log('connect error'); // 仅打印，无处理
  }
}

// ✅ 正确实现 - 重新抛出
async connect(url: string): Promise<void> {
  try {
    await this.socket.connect(url);
  } catch (e) {
    throw new Error(`Socket connect failed: ${(e as Error).message}`);
  }
}

// ✅ 正确实现 - 状态恢复 + 上报
async connect(url: string): Promise<void> {
  try {
    await this.socket.connect(url);
  } catch (e) {
    this.connectionState = ConnectionState.DISCONNECTED;
    this.emit('error', { message: (e as Error).message });
  }
}
```

### E-04：参数验证缺失（-5 分）

**判定标准**：TurboModule 注册方法或公共 API 入口，对外部传入参数无类型检查、空值判断或边界验证。

```typescript
// ❌ 触发 E-04（扣 5 分）
setItem(key: string, value: string): void {
  this.storage.put(key, value); // 无参数验证
}

// ✅ 正确实现
setItem(key: string, value: string): void {
  if (!key || key.length === 0) {
    throw new Error('key must not be empty');
  }
  if (typeof value !== 'string') {
    throw new Error('value must be a string');
  }
  this.storage.put(key, value);
}
```

### E-05：异常类型窄化（-3 分）

**判定标准**：仅捕获特定异常类型（如仅 catch BusinessError），遗漏其他可能的异常类型。

```typescript
// ❌ 触发 E-05（扣 3 分）
try {
  await bluetooth.connect(deviceId);
} catch (e) {
  if ((e as BusinessError).code === 12345) {
    // 仅处理特定业务错误，遗漏其他异常
  }
}

// ✅ 正确实现
try {
  await bluetooth.connect(deviceId);
} catch (e) {
  if ((e as BusinessError).code === 12345) {
    // 处理特定业务错误
  } else {
    // 处理其他异常
    throw new Error(`Bluetooth connect failed: ${(e as Error).message}`);
  }
}
```

### E-06：finally 缺失（-2 分）

**判定标准**：涉及资源操作（文件/网络/传感器）的方法，无 finally 块确保清理路径。

```typescript
// ❌ 触发 E-06（扣 2 分）
async readFile(path: string): Promise<string> {
  const file = fs.openSync(path);
  try {
    return fs.readTextSync(file.fd);
  } catch (e) {
    throw new Error(`Read failed: ${(e as Error).message}`);
    // 异常路径未关闭文件
  }
}

// ✅ 正确实现
async readFile(path: string): Promise<string> {
  let file: fs.File | null = null;
  try {
    file = fs.openSync(path);
    return fs.readTextSync(file.fd);
  } catch (e) {
    throw new Error(`Read failed: ${(e as Error).message}`);
  } finally {
    if (file) {
      fs.closeSync(file);
    }
  }
}
```

---

## 二、资源释放安全性（维度总分 20 分）

### R-01：系统资源未释放（-10 分）

**判定标准**：使用 `@ohos.*` 模块申请的系统资源（sensor/location/network/bluetooth/ble），在组件销毁或功能停止时未调用对应的 `unregister`/`disable`/`off` 释放。

**RN 鸿蒙化关键关注点**：
- TurboModule 中注册的系统资源监听
- NativeEventEmitter 绑定的系统事件

```typescript
// ❌ 触发 R-01（扣 10 分）
export class SensorModule extends TurboModule {
  startAccelerometer(callback: Function): void {
    sensor.on(sensor.SensorType.ACCELEROMETER, (data) => {
      callback(data);
    });
    // 缺少 off() 释放！
  }
}

// ✅ 正确实现
export class SensorModule extends TurboModule {
  private subscribed: boolean = false;

  startAccelerometer(callback: Function): void {
    sensor.on(sensor.SensorType.ACCELEROMETER, (data) => {
      callback(data);
    });
    this.subscribed = true;
  }

  stopAccelerometer(): void {
    if (this.subscribed) {
      sensor.off(sensor.SensorType.ACCELEROMETER);
      this.subscribed = false;
    }
  }

  destroy(): void {
    this.stopAccelerometer();
  }
}
```

### R-02：事件订阅未取消（-8 分）

**判定标准**：通过 `on()` 注册的事件监听器（包括 `@ohos.*` 模块事件和 emitter 事件），未在组件销毁或模块卸载时通过 `off()` 移除。

```typescript
// ❌ 触发 R-02（扣 8 分）
export class NetworkModule extends TurboModule {
  addListener(eventName: string): void {
    connection.on('netChange', (data) => {
      this.sendEvent(eventName, data);
    });
    // 未保存订阅引用，无法取消
  }
}

// ✅ 正确实现
export class NetworkModule extends TurboModule {
  private netChangeListener: Function | null = null;

  addListener(eventName: string): void {
    this.netChangeListener = (data) => {
      this.sendEvent(eventName, data);
    };
    connection.on('netChange', this.netChangeListener);
  }

  removeListeners(): void {
    if (this.netChangeListener) {
      connection.off('netChange', this.netChangeListener);
      this.netChangeListener = null;
    }
  }
}
```

### R-03：Stream/Connection 泄露（-5 分）

**判定标准**：打开的 I/O 流（`fs.open`/`socket`/`http` 连接）未在正确路径关闭。

```typescript
// ❌ 触发 R-03（扣 5 分）
async fetchData(url: string): Promise<string> {
  const httpClient = http.createHttp();
  const response = await httpClient.request(url);
  return response.result as string;
  // httpClient 未 destroy()
}

// ✅ 正确实现
async fetchData(url: string): Promise<string> {
  const httpClient = http.createHttp();
  try {
    const response = await httpClient.request(url);
    return response.result as string;
  } finally {
    httpClient.destroy();
  }
}
```

### R-04：Timer 未清理（-3 分）

**判定标准**：`setInterval`/`setTimeout` 创建的定时器，未在组件/模块销毁时通过 `clearInterval`/`clearTimeout` 清除。

### R-05：Worker 未终止（-3 分）

**判定标准**：通过 `worker.ThreadWorker` 创建的 Worker 线程，未在适当时机调用 `terminate()`。

---

## 三、并发安全（维度总分 20 分）

### C-01：主线程阻塞操作（-10 分）

**判定标准**：在 UI 主线程执行耗时同步操作，包括：
- 大循环计算（>100ms 可感知）
- 同步文件 I/O（`fs.openSync`/`fs.readSync` 在主线程调用）
- 同步网络请求
- 同步数据库操作

```typescript
// ❌ 触发 C-01（扣 10 分）
processLargeData(data: string): Result {
  // 在主线程执行大量计算
  const parsed = JSON.parse(data);  // 大 JSON 可能阻塞
  for (let i = 0; i < parsed.items.length; i++) {
    // 耗时循环
  }
  return result;
}

// ✅ 正确实现 - 使用 Worker
async processLargeData(data: string): Promise<Result> {
  const worker = new worker.ThreadWorker('workers/processor.ets');
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(data);
  });
}
```

### C-02：共享状态无同步保护（-7 分）

**判定标准**：多个异步回调/Promise 修改同一状态变量，无锁机制、队列串行化或原子操作保护。

```typescript
// ❌ 触发 C-02（扣 7 分）
export class DataModule extends TurboModule {
  private cache: Map<string, string> = new Map();

  async getValue(key: string): Promise<string | null> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const value = await this.fetchFromNetwork(key);
    this.cache.set(key, value);  // 多个并发调用可能同时写入
    return value;
  }
}

// ✅ 正确实现 - 使用队列串行化
export class DataModule extends TurboModule {
  private cache: Map<string, string> = new Map();
  private pendingRequests: Map<string, Promise<string>> = new Map();

  async getValue(key: string): Promise<string | null> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key)!;
    }
    const promise = this.fetchFromNetwork(key).then(value => {
      this.cache.set(key, value);
      this.pendingRequests.delete(key);
      return value;
    });
    this.pendingRequests.set(key, promise);
    return promise;
  }
}
```

### C-03：回调重入无防护（-3 分）

**判定标准**：异步回调可能重入导致状态混乱，缺少重入标志或互斥机制。

```typescript
// ❌ 触发 C-03（扣 3 分）
async refreshData(): Promise<void> {
  const data = await this.fetchData();
  this.state = data;  // 多次调用 refreshData 可能导致状态不一致
}

// ✅ 正确实现
private refreshing: boolean = false;
async refreshData(): Promise<void> {
  if (this.refreshing) return;
  this.refreshing = true;
  try {
    const data = await this.fetchData();
    this.state = data;
  } finally {
    this.refreshing = false;
  }
}
```

---

## 四、ArkTS 生命周期管理（维度总分 10 分）

### L-01：aboutToDisappear/onDestroy 未清理（-8 分）

**判定标准**：自定义组件的 `aboutToDisappear()` 或 Ability 的 `onDestroy()` 未释放资源、移除监听、取消订阅。

**RN 鸿蒙化关注点**：
- TurboModule 的 `destroy()`/`invalidate()` 方法是否清理所有资源
- RN Component 的鸿蒙化实现是否在 `aboutToDisappear` 中释放系统资源

```typescript
// ❌ 触发 L-01（扣 8 分）
@Component
export struct RNMapView {
  private mapController: map.MapComponentController | null = null;

  aboutToAppear(): void {
    this.mapController = new map.MapComponentController();
  }
  // 缺少 aboutToDisappear 清理！
}

// ✅ 正确实现
@Component
export struct RNMapView {
  private mapController: map.MapComponentController | null = null;

  aboutToAppear(): void {
    this.mapController = new map.MapComponentController();
  }

  aboutToDisappear(): void {
    if (this.mapController) {
      // 释放地图资源
      this.mapController = null;
    }
  }
}
```

### L-02：@State/@Link 对象持有大引用未释放（-2 分）

**判定标准**：`@State`/`@Link` 装饰的变量持有大对象（图片/音频/大数据缓存），在组件销毁后未释放引用。

---

## 五、NAPI 跨语言调用安全（维度总分 15 分）

### N-01：napi_ref 创建/释放不匹配（-10 分）

**判定标准**：`napi_create_reference` 和 `napi_delete_reference` 数量不匹配，或释放路径不对称（如异常分支未释放）。

```cpp
// ❌ 触发 N-01（扣 10 分）
static napi_value RegisterCallback(napi_env env, napi_callback_info info) {
  napi_ref callbackRef;
  napi_create_reference(env, argv[0], 1, &callbackRef);
  // ... 使用 callbackRef ...
  // 缺少 napi_delete_reference！
  return nullptr;
}

// ✅ 正确实现
static napi_value RegisterCallback(napi_env env, napi_callback_info info) {
  napi_ref callbackRef;
  napi_create_reference(env, argv[0], 1, &callbackRef);
  // ... 使用 callbackRef ...
  napi_delete_reference(env, callbackRef);  // 必须释放
  return nullptr;
}
```

### N-02：napi_handle_scope 未清理（-8 分）

**判定标准**：`napi_open_handle_scope` 无对应 `napi_close_handle_scope`，或异常路径遗漏关闭。

```cpp
// ❌ 触发 N-02（扣 8 分）
static napi_value ProcessData(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  // ... 业务逻辑，可能提前返回 ...
  if (error) {
    return nullptr;  // 未关闭 scope！
  }
  napi_close_handle_scope(env, scope);
  return result;
}

// ✅ 正确实现
static napi_value ProcessData(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  napi_value result = nullptr;
  // ... 业务逻辑 ...
  napi_close_handle_scope(env, scope);  // 始终关闭
  return result;
}
```

### N-03：napi_value 类型转换无边界检查（-5 分）

**判定标准**：`napi_get_value_int32`/`napi_get_value_string_utf8` 等类型转换函数，调用前未使用 `napi_typeof` 验证类型。

### N-04：napi_create_async_work 缺少异常处理（-5 分）

**判定标准**：异步 work 的 execute/complete 回调未检查 `napi_status` 返回值。

### N-05：Native 对象与 JS 对象生命周期不一致（-3 分）

**判定标准**：C++ 侧对象未绑定 JS 侧 GC 回调（`napi_wrap` + finalize callback），导致 Native 对象泄露。

---

## 六、C++ 内存管理安全（维度总分 10 分）

### M-01：malloc/new 与 free/delete 不匹配（-8 分）

**判定标准**：
- `malloc` 配 `delete` 或 `new` 配 `free`
- 分配/释放数量不对称
- 双重释放风险

```cpp
// ❌ 触发 M-01（扣 8 分）
char* buffer = (char*)malloc(1024);
// ...
delete buffer;  // malloc 应配 free！

// ✅ 正确实现
char* buffer = (char*)malloc(1024);
// ...
free(buffer);
```

### M-02：异常路径资源未释放（-5 分）

**判定标准**：try/catch 中分配的资源在异常分支未释放。

```cpp
// ❌ 触发 M-02（扣 5 分）
void process() {
  char* buffer = new char[1024];
  someOperation();  // 可能抛出异常
  delete[] buffer;  // 异常路径未执行
}

// ✅ 正确实现
void process() {
  char* buffer = new char[1024];
  try {
    someOperation();
    delete[] buffer;
  } catch (...) {
    delete[] buffer;
    throw;
  }
}
```

### M-03：未使用 RAII 管理资源（-3 分）

**判定标准**：裸指针管理资源，可改用智能指针（`std::unique_ptr`/`std::shared_ptr`）但未使用。

---

## 七、调用链完整性（维度总分 5 分，独立于维度外额外扣分）

### CH-01：ArkTS → Native 异常传播断裂（-10 分）

**判定标准**：Native C++ 层异常未通过 `napi_throw_error`/`napi_throw_type_error` 传播到 ArkTS 层，导致上层调用者无法感知错误。

### CH-02：跨模块调用异常未传播（-5 分）

**判定标准**：TurboModule 间调用或模块间调用时，异常被吞没而非向调用者传播。

### CH-03：关键功能调用链缺失异常处理节点（-3 分）

**判定标准**：关键功能的完整调用链中，至少一个节点无异常处理。

**必须追踪至少 3 个关键功能的完整调用链**，标注每个节点的异常处理状态。
