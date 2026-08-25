# 代码示例参考

> 本文件收录 `arkts-library-stability-check` 各检视维度的代码示例，供检视时对照参考。

---

## 1. 异常处理完整性

### 1.1 关键路径无异常处理（E-01）

```typescript
// ❌ 关键路径无异常处理（E-01，扣 10 分）
async connect(deviceId: string): Promise<void> {
  await bluetooth.connect(deviceId); // 可能抛出 PermissionError
  return; // 异常未传播
}

// ✅ 正确实现
async connect(deviceId: string): Promise<void> {
  try {
    if (!deviceId || deviceId.length === 0) {
      throw new Error('Invalid deviceId'); // 参数验证 (E-04)
    }
    await bluetooth.connect(deviceId);
  } catch (e) {
    throw new Error(`Connect failed: ${e.message}`); // 异常传播而非吞没
  }
}
```

### 1.2 Promise rejection 未处理（E-02）

```typescript
// ❌ Promise rejection 未处理（E-02，扣 8 分）
bluetooth.startScanning()
  .then((devices) => { /* 处理设备 */ });
  // 缺少 .catch() 处理 rejection

// ✅ 正确实现
bluetooth.startScanning()
  .then((devices) => { /* 处理设备 */ })
  .catch((error) => {
    console.error('Scan failed:', error);
    throw error; // 重新抛出或上报
  });
```

### 1.3 异常吞没（E-03）

```typescript
// ❌ 异常吞没（E-03，扣 7 分）
try {
  await sensor.subscribe();
} catch (e) {
  // 空 catch 块，异常被吞没
}

// ❌ 仅日志输出，未恢复/上报/重新抛出
try {
  await sensor.subscribe();
} catch (e) {
  console.log('error'); // 仅打印，未处理
}

// ✅ 正确实现
try {
  await sensor.subscribe();
} catch (e) {
  console.error('Sensor subscribe failed:', e);
  // 恢复到安全状态或重新抛出
  throw new Error(`Sensor error: ${e.message}`);
}
```

### 1.4 参数验证缺失（E-04）

```typescript
// ❌ 参数验证缺失（E-04，扣 5 分）
async writeData(data: string): Promise<void> {
  await fileIo.writeText(this.fd, data);
  // 未检查 data 是否为空或超出长度限制
}

// ✅ 正确实现
async writeData(data: string): Promise<void> {
  if (!data || data.length === 0) {
    throw new Error('Data cannot be empty');
  }
  if (data.length > MAX_DATA_SIZE) {
    throw new Error('Data exceeds maximum size');
  }
  await fileIo.writeText(this.fd, data);
}
```

### 1.5 finally 缺失（E-06）

```typescript
// ❌ finally 缺失（E-06，扣 2 分）
try {
  await this.lock.acquire();
  await this.processData();
  this.lock.release();
} catch (e) {
  this.lock.release(); // 异常路径也释放，但重复代码
  throw e;
}
// 如果 processData 之后的代码也抛出异常，lock 不会释放

// ✅ 正确实现
try {
  await this.lock.acquire();
  await this.processData();
} catch (e) {
  throw e; // 异常传播
} finally {
  this.lock.release(); // 无论异常与否都释放
}
```

---

## 2. 资源释放安全性

### 2.1 事件订阅未取消（R-02）

```typescript
// ❌ 事件订阅未取消（R-02，扣 8 分）
export class LocationPlugin {
  startListening(): void {
    geoLocationManager.on('locationChange', this.callback);
    // 缺少 off() 调用！
  }
}

// ✅ 正确实现
export class LocationPlugin {
  private isListening: boolean = false;

  startListening(): void {
    geoLocationManager.on('locationChange', this.callback);
    this.isListening = true;
  }

  stopListening(): void {
    if (this.isListening) {
      geoLocationManager.off('locationChange', this.callback);
      this.isListening = false;
    }
  }

  aboutToDisappear(): void {
    this.stopListening(); // 必须取消订阅
  }
}
```

### 2.2 Timer 未清理（R-04）

```typescript
// ❌ Timer 未清理（R-04，扣 5 分）
export class PollingService {
  startPolling(): void {
    this.timer = setInterval(() => {
      this.checkStatus();
    }, 1000);
    // 缺少 clearInterval 调用
  }
}

// ✅ 正确实现
export class PollingService {
  private timer: number | null = null;

  startPolling(): void {
    this.timer = setInterval(() => {
      this.checkStatus();
    }, 1000);
  }

  stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  aboutToDisappear(): void {
    this.stopPolling();
  }
}
```

---

## 3. NAPI 跨语言调用

### 3.1 Handle Scope 未清理（N-02）

```cpp
// ❌ Handle Scope 未清理（N-02，扣 8 分）
static napi_value GetInfo(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  // ... 业务逻辑 ...
  // 缺少 napi_close_handle_scope！
  return result;
}

// ✅ 正确实现
static napi_value GetInfo(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  napi_value result;
  // ... 业务逻辑 ...
  napi_close_handle_scope(env, scope); // 必须清理
  return result;
}
```

### 3.2 napi_ref 创建/释放不匹配（N-01）

```cpp
// ❌ napi_ref 创建后未释放（N-01，扣 10 分）
static napi_value SetCallback(napi_env env, napi_callback_info info) {
  napi_value callback;
  napi_ref callbackRef;
  napi_get_cb_info(env, info, ...);
  napi_create_reference(env, callback, 1, &callbackRef);
  // callbackRef 存储到全局，但从未调用 napi_delete_reference
  return nullptr;
}

// ✅ 正确实现
static napi_value SetCallback(napi_env env, napi_callback_info info) {
  napi_value callback;
  napi_ref callbackRef;
  napi_get_cb_info(env, info, ...);
  napi_create_reference(env, callback, 1, &callbackRef);
  this->callbackRef = callbackRef;
  return nullptr;
}

// 在适当时机释放
void Cleanup() {
  if (this->callbackRef != nullptr) {
    napi_delete_reference(env, this->callbackRef);
    this->callbackRef = nullptr;
  }
}
```

---

## 4. 调用链完整性

### 4.1 跨层级调用链追踪

```
调用链结构示例：
ArkTS 层                      Native (C++) 层
│                              │
├─ publicAPI.method()          │
│  ├─ try-catch ✅/❌          │
│  └─ invokeNative()           │
│                               ├─ NativeImpl::execute()
│                               │  ├─ napi_handle_scope ✅/❌
│                               │  ├─ napi_ref 管理 ✅/❌
│                               │  └─ return result
│                               │
├─ callback/result             │
│  ├─ 异常检查 ✅/❌           │
│  └─ return to caller         │
```

### 4.2 异常传播链检查示例

```typescript
// ❌ ArkTS → Native 异常传播断裂（CH-01，扣 10 分）
// Native 层：
static napi_value Execute(napi_env env, napi_callback_info info) {
  // 执行失败，但未通过 napi_throw 传播异常
  return nullptr; // ArkTS 层收到 null 但不知原因
}

// ArkTS 层：
const result = nativeModule.execute();
if (result === null) {
  // 无法判断是执行失败还是正常返回 null
}

// ✅ 正确实现
// Native 层：
static napi_value Execute(napi_env env, napi_callback_info info) {
  if (executionFailed) {
    napi_throw_error(env, nullptr, "Execution failed: timeout");
    return nullptr;
  }
  return result;
}

// ArkTS 层：
try {
  const result = nativeModule.execute();
} catch (e) {
  console.error('Native execution error:', e);
  // 异常已正确传播到 ArkTS 层
}
```