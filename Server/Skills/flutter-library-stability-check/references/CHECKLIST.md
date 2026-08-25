# Flutter 鸿蒙化稳定性检视清单

本文档提供 Flutter 三方库**鸿蒙化代码**稳定性检视的详细检查项，供检视人员参考。

> ⚠️ **重要提示**：本清单适用于**智能识别的鸿蒙化代码**检视，通过文件类型（`.ets`）、API 特征（`@ohos`）、配置文件（`module.json5`）等多维度扫描识别，**不依赖固定目录名称**。

---

## 检视范围判定

### 鸿蒙代码智能识别流程

**扫描策略**（优先级递减）：

| 扫描维度 | 特征模式 | 权重 | 扫描命令示例 |
|----------|----------|------|--------------|
| 文件类型 | `*.ets` 文件 | ⭐⭐⭐ 高 | `find {sourceDir} -name "*.ets"` |
| 配置文件 | `module.json5`、`oh-package.json5` | ⭐⭐⭐ 高 | `find {sourceDir} -name "module.json5"` |
| API 调用 | `@ohos.*`、`napi_*` | ⭐⭐ 中 | `grep -r "@ohos" {sourceDir}` |
| 目录标识 | 目录名含 `ohos`、`harmony` | ⭐ 低 | `find {sourceDir} -type d -name "*ohos*"` |
| Native NAPI | `napi_create_reference` 等 | ⭐⭐ 中 | `grep -r "napi_" --include="*.cpp" {sourceDir}` |

### 前置检查判定规则

| 扫描结果 | 判定 | 评分 | 后续操作 |
|----------|------|------|----------|
| 发现 `.ets` 文件 | ✅ 存在鸿蒙化 | 正常评分 | 进入深度检视 |
| 发现 `module.json5` + NAPI 代码 | ✅ 存在鸿蒙化 | 正常评分 | 进入深度检视 |
| 仅目录名含 `ohos` 无代码 | ⚠️ 疑似未完成 | 0-30 分 | 报告标注"鸿蒙化代码疑似缺失" |
| 未发现任何鸿蒙特征 | ❌ 未实现鸿蒙化 | 0 分 | 报告标注"未发现鸿蒙化实现代码" |

**关键说明**：
- **不以固定目录名判定**：即使没有 `ohos/` 目录，发现 `.ets` 文件即认定鸿蒙化存在
- **不以目录名肯定**：仅有 `ohos/` 目录名无代码文件，不认定为完成鸿蒙化
- **优先代码特征**：文件类型和 API 特征权重高于目录名称

---

## 1. ArkTS 层稳定性检查

### 1.1 NAPI 引用管理（致命项）

NAPI 引用是鸿蒙 Native 层最核心的资源，必须严格管理。

#### 1.1.1 引用创建检查

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 必要性判断 | 是否判断对象是否需要长期持有 | 缺失扣 3 分 |
| 创建时机 | 是否在初始化阶段而非运行时频繁创建 | 不合理扣 5 分 |
| 引用计数 | `napi_create_reference` 的 refcount 参数是否合理（通常为 1） | 不合理扣 5 分 |
| 环境检查 | 创建前是否检查 napi_env 有效性 | 未检查扣 5 分 |

**ArkTS 代码示例**：

```typescript
// ❌ 致命：不必要的引用创建 + 未释放
export class MyPlugin {
  private refs: Map<string, napi_ref> = new Map();
  
  processValue(key: string, value: napi_value): void {
    // 运行时频繁创建引用（不合理）
    let ref: napi_ref;
    napi_create_reference(env, value, 1, &ref);
    this.refs.set(key, ref);
    // 没有释放逻辑
  }
}

// ✅ 正确实现
export class MyPlugin {
  private refs: Map<string, napi_ref> = new Map();
  
  // 初始化时创建必要引用
  initialize(): void {
    // 仅对需要长期持有的对象创建引用
    if (this.needsPersistentRef) {
      let ref: napi_ref;
      napi_create_reference(env, this.persistentObj, 1, &ref);
      this.refs.set('persistent', ref);
    }
  }
  
  // 销毁时释放所有引用
  onDestroy(): void {
    for (const [key, ref] of this.refs) {
      napi_delete_reference(env, ref);
    }
    this.refs.clear();
  }
}
```

#### 1.1.2 引用释放检查

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 释放时机 | 是否在 onDestroy/onDetach 释放 | **未释放扣 20 分（致命）** |
| 释放完整性 | 是否释放所有创建的引用 | 不完整扣 15 分 |
| 释放顺序 | 是否按创建顺序逆序释放 | 错误顺序扣 5 分 |
| 引用计数平衡 | create 和 delete 数量是否匹配 | 不平衡扣 15 分 |
| 释放后置空 | 释放后是否将变量置为 null | 未置空扣 3 分 |

**检查方法**：

1. 统计所有 `napi_create_reference` 调用次数（N_create）
2. 统计所有 `napi_delete_reference` 调用次数（N_delete）
3. 若 N_create ≠ N_delete，扣 15 分
4. 检查 `onDestroy` 方法是否存在引用释放代码

#### 1.1.3 引用有效性检查

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 使用前验证 | 使用 ref 前是否检查非 null | 未检查扣 5 分 |
| 引用状态 | 是否检查引用是否已失效 | 未检查扣 5 分 |
| 错误处理 | 引用失效时的处理逻辑 | 缺失扣 3 分 |

---

### 1.2 异常处理完整性（严苛项）

#### 1.2.1 关键路径异常处理

**关键路径定义**：

| 路径类型 | 覆盖范围 | 扣分规则 |
|----------|----------|----------|
| MethodChannel 处理函数 | 所有 handleMethodCall 方法 | **无异常处理扣 10 分** |
| Native 回调函数 | 所有返回结果到 Flutter 的回调 | **无异常处理扣 10 分** |
| 系统资源操作 | 文件、网络、数据库、蓝牙等 | 无异常处理扣 8 分 |
| @ohos API 调用 | 所有鸿蒙系统 API 调用 | 无异常处理扣 7 分 |
| 类型转换操作 | JSON 解析、类型断言等 | 无异常处理扣 5 分 |

**ArkTS 代码示例**：

```typescript
// ❌ 致命：关键路径无异常处理
export class BluetoothPlugin extends FlutterPlugin {
  async handleMethodCall(call: MethodCall): Promise<void> {
    const method = call.method;
    const args = call.arguments;
    
    // 直接调用，无参数验证和异常处理
    if (method === 'connect') {
      const deviceId = args['deviceId'];
      await bluetooth.connect(deviceId); // 可能抛出多种异常
      return;
    }
  }
}

// ✅ 正确实现（严苛标准）
export class BluetoothPlugin extends FlutterPlugin {
  async handleMethodCall(call: MethodCall): Promise<void> {
    try {
      // 1. 参数验证
      const method = call.method;
      if (!method || method.length === 0) {
        throw new Error('Invalid method name');
      }
      
      const args = call.arguments;
      if (!args || typeof args !== 'object') {
        throw new Error('Invalid arguments');
      }
      
      // 2. 方法处理
      if (method === 'connect') {
        const deviceId = args['deviceId'];
        if (!deviceId || deviceId.length === 0) {
          throw new Error('Invalid deviceId');
        }
        
        // 3. API 调用异常捕获
        try {
          await bluetooth.connect(deviceId);
        } catch (e) {
          // 4. 异常传播到 Flutter 层
          throw new Error(`Bluetooth connect failed: ${e.message}`);
        }
      }
    } catch (e) {
      // 5. 全局异常处理
      console.error(`MethodCall error: ${e.message}`);
      throw e; // 传播到 Flutter
    }
  }
}
```

#### 1.2.2 参数验证检查

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 参数存在性 | 是否检查参数是否存在 | 缺失扣 5 分 |
| 参数类型 | 是否验证参数类型（string/number/object） | 缺失扣 5 分 |
| 参数边界 | 是否验证数值范围、字符串长度等 | 缺失扣 3 分 |
| 空值防护 | 是否处理 null/undefined | 缺失扣 5 分 |
| 数组验证 | 是否验证数组元素类型和长度 | 缺失扣 3 分 |

#### 1.2.3 异步异常处理

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Promise.catch | 所有 Promise 链是否有 catch | 缺失扣 8 分 |
| async 函数异常 | async 函数是否包裹 try-catch | 缺失扣 8 分 |
| 错误传播 | 异步错误是否传播到调用方 | 不传播扣 7 分 |
| 超时处理 | 长时间操作是否设置超时 | 缺失扣 5 分 |

---

### 1.3 资源释放与生命周期绑定（严苛项）

#### 1.3.1 Ability 生命周期绑定

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| onDestroy 实现 | 是否实现 onDestroy 方法 | **缺失扣 15 分** |
| 资源释放完整性 | onDestroy 是否释放所有资源 | 不完整扣 12 分 |
| 释放顺序 | 是否按正确顺序释放（后创建先释放） | 错误顺序扣 5 分 |
| 释放验证 | 释放后是否验证资源状态 | 未验证扣 3 分 |

**ArkTS 代码示例**：

```typescript
// ❌ 致命：缺少 onDestroy 方法
export class MyPlugin {
  private controllers: StreamController[] = [];
  private timers: Timer[] = [];
  
  onAttachedToEngine(): void {
    this.controllers.push(new StreamController());
    this.timers.push(setInterval(() => {}, 1000));
  }
  
  // 没有 onDestroy 方法！
}

// ✅ 正确实现
export class MyPlugin {
  private controllers: StreamController[] = [];
  private timers: Timer[] = [];
  private listeners: Map<string, Function> = new Map();
  private refs: Map<string, napi_ref> = new Map();
  
  onAttachedToEngine(): void {
    // 初始化资源...
  }
  
  onDestroy(): void {
    // 1. 取消所有定时器（先创建后释放）
    for (const timer of this.timers.reverse()) {
      clearInterval(timer);
    }
    this.timers = [];
    
    // 2. 关闭所有 Stream
    for (const controller of this.controllers.reverse()) {
      controller.close();
    }
    this.controllers = [];
    
    // 3. 取消所有事件订阅
    for (const [event, callback] of this.listeners) {
      geoLocationManager.off(event, callback);
    }
    this.listeners.clear();
    
    // 4. 释放所有 NAPI 引用
    for (const [key, ref] of this.refs) {
      napi_delete_reference(env, ref);
    }
    this.refs.clear();
  }
}
```

#### 1.3.2 事件订阅管理

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| on/off 对称性 | 每个 on 是否有对应的 off | **不对称扣 12 分** |
| 订阅记录 | 是否记录所有订阅以便取消 | 未记录扣 8 分 |
| 回调一致性 | off 的回调是否与 on 一致 | 不一致扣 10 分 |
| 订阅时机 | 是否在合适的生命周期订阅 | 不合理扣 5 分 |

**检查方法**：

1. 扫描所有 `@ohos` 模块的 `.on()` 调用
2. 检查是否有对应的 `.off()` 调用
3. 检查 `.off()` 的参数是否与 `.on()` 一致

**关键事件订阅模块**：

| 模块 | 常见事件 | 检查重点 |
|------|----------|----------|
| `@ohos.bluetooth` | connectionStateChange, deviceStateChange | 连接状态订阅必须取消 |
| `@ohos.geolocation` | locationChange, locationServiceState | 位置订阅必须取消 |
| `@ohos.net.connection` | netConnectionChange | 网络状态订阅必须取消 |
| `@ohos.sensor` | sensorChange | 传感器订阅必须取消 |
| `@ohos.multimedia.media` | stateChange, volumeChange | 媒体事件订阅必须取消 |

#### 1.3.3 Stream 和 Timer 管理

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| StreamController.close | dispose 时是否关闭 | 未关闭扣 10 分 |
| StreamSubscription.cancel | 是否取消所有订阅 | 未取消扣 10 分 |
| Timer.cancel | 是否取消所有 Timer | 未取消扣 5 分 |
| 监听器注销 | 是否注销所有监听器 | 未注销扣 8 分 |

---

### 1.4 并发安全与状态管理（严苛项）

#### 1.4.1 全局状态保护

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 共享状态识别 | 是否识别所有共享状态变量 | 未识别扣 5 分 |
| 状态保护机制 | 是否使用锁/互斥/原子操作 | **无保护扣 10 分** |
| 状态变更通知 | 状态变更是否通知所有依赖方 | 未通知扣 5 分 |
| 状态一致性 | 多实例状态是否隔离 | 不隔离扣 7 分 |

**ArkTS 代码示例**：

```typescript
// ❌ 严重：全局状态无保护
export class GlobalPlugin {
  private static instances: MyPlugin[] = []; // 全局共享
  private static counter: number = 0; // 无保护
  
  static registerInstance(instance: MyPlugin): void {
    this.instances.push(instance); // 多线程可能并发
    this.counter++; // 无原子操作
  }
}

// ✅ 正确实现（使用锁机制）
export class GlobalPlugin {
  private static instances: MyPlugin[] = [];
  private static counter: number = 0;
  private static lock: Mutex = new Mutex();
  
  static async registerInstance(instance: MyPlugin): Promise<void> {
    await this.lock.acquire();
    try {
      this.instances.push(instance);
      this.counter++;
    } finally {
      this.lock.release();
    }
  }
}
```

#### 1.4.2 线程安全检查

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Worker 线程识别 | 是否识别 Worker 线程场景 | 未识别扣 5 分 |
| 主线程资源访问 | Worker 是否安全访问主线程资源 | 不安全扣 8 分 |
| 异步操作同步 | 异步操作完成时的状态同步 | 不同步扣 7 分 |
| 初始化顺序 | 是否确保初始化完成后再使用 | 未确保扣 5 分 |

---

## 2. C++ Native 层稳定性检查

### 2.1 NAPI Handle 管理（致命项）

#### 2.1.1 Handle Scope 管理

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Scope 创建 | 函数开始是否创建 handle_scope | 缺失扣 10 分 |
| Scope 清理 | 函数结束是否关闭 handle_scope | **未清理扣 15 分** |
| Scope 嵌套 | 嵌套 scope 是否正确管理 | 错误扣 8 分 |
| 异常路径 | 异常发生时是否清理 scope | 未清理扣 12 分 |

**C++ 代码示例**：

```cpp
// ❌ 致命：Handle Scope 未清理
static napi_value GetValue(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  
  napi_value result;
  napi_create_string_utf8(env, "value", NAPI_AUTO_LENGTH, &result);
  
  // 没有 napi_close_handle_scope！
  return result; // 导致内存泄漏
}

// ✅ 正确实现
static napi_value GetValue(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  
  napi_value result = nullptr;
  napi_status status = napi_create_string_utf8(env, "value", NAPI_AUTO_LENGTH, &result);
  
  if (status != napi_ok) {
    napi_close_handle_scope(env, scope); // 异常路径也要清理
    napi_throw_error(env, nullptr, "Failed to create string");
    return nullptr;
  }
  
  napi_close_handle_scope(env, scope); // 正常路径清理
  return result;
}

// ✅ 最佳实践：使用 RAII 封装
class ScopedHandleScope {
public:
  ScopedHandleScope(napi_env env) : env_(env) {
    napi_open_handle_scope(env_, &scope_);
  }
  ~ScopedHandleScope() {
    napi_close_handle_scope(env_, scope_);
  }
private:
  napi_env env_;
  napi_handle_scope scope_;
};

static napi_value GetValue(napi_env env, napi_callback_info info) {
  ScopedHandleScope scope(env); // 自动清理
  napi_value result;
  napi_create_string_utf8(env, "value", NAPI_AUTO_LENGTH, &result);
  return result; // scope 自动析构清理
}
```

#### 2.1.2 NAPI 引用管理

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 引用创建 | 是否仅对必要对象创建引用 | 不必要扣 8 分 |
| 引用释放 | 是否在析构时释放所有引用 | **未释放扣 20 分** |
| 引用有效性 | 使用前是否验证引用有效 | 未验证扣 10 分 |
| 异步引用 | 异步操作中引用是否保持有效 | 失效扣 10 分 |

**检查方法**：

1. 扫描所有 `napi_create_reference` 调用
2. 扫描所有 `napi_delete_reference` 调用
3. 检查类析构函数是否释放引用
4. 统计引用数量是否平衡

#### 2.1.3 异常传播

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Native 异常捕获 | 是否捕获所有可能异常 | 缺失扣 8 分 |
| 异常转换 | 是否转换为 napi_throw | 不转换扣 8 分 |
| 错误信息 | 错误信息是否清晰完整 | 不完整扣 5 分 |
| 错误传播 | 错误是否传播到 ArkTS 层 | 不传播扣 6 分 |

---

### 2.2 内存管理（严苛项）

#### 2.2.1 内存分配释放检查

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| malloc/new 记录 | 是否记录所有分配点 | 未记录扣 5 分 |
| free/delete 对应 | 每个分配是否有对应释放 | **不匹配扣 15 分** |
| 释放时机 | 是否在合适的时机释放 | 不合理扣 8 分 |
| 异常路径释放 | 异常时是否释放已分配内存 | 未释放扣 12 分 |

**C++ 代码示例**：

```cpp
// ❌ 致命：内存泄漏
static napi_value ProcessData(napi_env env, napi_callback_info info) {
  char* buffer = (char*)malloc(1024); // 分配内存
  
  // 业务逻辑...
  
  if (error_occurred) {
    return nullptr; // 异常路径未释放！
  }
  
  // 正常路径也没有释放！
  return result;
}

// ✅ 正确实现
static napi_value ProcessData(napi_env env, napi_callback_info info) {
  char* buffer = (char*)malloc(1024);
  if (!buffer) {
    napi_throw_error(env, nullptr, "Memory allocation failed");
    return nullptr;
  }
  
  try {
    // 业务逻辑...
    free(buffer); // 正常路径释放
    return result;
  } catch (...) {
    free(buffer); // 异常路径释放
    napi_throw_error(env, nullptr, "Processing failed");
    return nullptr;
  }
}

// ✅ 最佳实践：使用智能指针
static napi_value ProcessData(napi_env env, napi_callback_info info) {
  std::unique_ptr<char[]> buffer(new char[1024]); // RAII 管理
  
  // 业务逻辑...
  
  return result; // buffer 自动释放
}
```

#### 2.2.2 ArrayBuffer 管理

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Buffer 创建 | 是否正确创建 ArrayBuffer | 错误扣 10 分 |
| Buffer 生命周期 | 是否正确管理 Buffer 生命周期 | 错误扣 10 分 |
| 外部 Buffer | 外部 Buffer 是否正确注册回调 | 未注册扣 8 分 |
| Buffer 传递 | Buffer 传递所有权是否清晰 | 不清晰扣 8 分 |

#### 2.2.3 RAII 使用

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 智能指针使用 | 是否使用 unique_ptr/shared_ptr | 未使用扣 8 分 |
| 资源封装类 | 是否封装资源管理为类 | 未封装扣 5 分 |
| 析构函数释放 | 析构函数是否释放所有资源 | 未释放扣 12 分 |

---

### 2.3 跨语言调用安全（严苛项）

#### 2.3.1 回调函数管理

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 回调有效性 | 调用前是否验证回调函数有效 | 未验证扣 7 分 |
| 回调类型 | 是否验证回调函数类型 | 未验证扣 5 分 |
| 回调上下文 | 是否正确传递回调上下文 | 错误扣 8 分 |
| 回调释放 | 回调引用是否正确释放 | 未释放扣 10 分 |

#### 2.3.2 类型转换安全

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| 类型检查 | 转换前是否检查类型 | 未检查扣 8 分 |
| 类型匹配 | Native 类型与 ArkTS 类型是否匹配 | 不匹配扣 8 分 |
| 数值边界 | 数值转换是否检查边界溢出 | 未检查扣 6 分 |
| 字符串编码 | 字符串编码转换是否正确 | 错误扣 8 分 |

#### 2.3.3 环境有效性

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| napi_env 有效性 | 异步操作中 env 是否有效 | 失效扣 10 分 |
| 环境引用 | 异步操作是否引用有效环境 | 未引用扣 8 分 |
| 环境清理 | 环境销毁时的清理逻辑 | 缺失扣 7 分 |

---

## 3. 调用链完整性检查

### 3.1 跨层级调用链追踪

检查关键功能的完整调用链，确保异常能在各层级正确传播。

#### 3.1.1 调用链结构

```
典型调用链：
Flutter (Dart)                    鸿蒙 (ArkTS/ETS)                Native (C++)
│                                 │                              │
├─ MethodChannel.call()           │                              │
│  ├─ method: "connect"           │                              │
│  ├─ arguments: {deviceId}       │                              │
│                                 │                              │
                                 ├─ Plugin.handleMethodCall()    │
                                 │  ├─ 参数验证 ✅               │
                                 │  ├─ try-catch ✅              │
                                 │  └─ NativeBridge.connect()    │
                                 │                                │
                                 │                               ├─ NativeImpl::connect()
                                 │                               │  ├─ napi_handle_scope ✅
                                 │                               │  ├─ 参数提取 ✅
                                 │                               │  ├─ 业务逻辑
                                 │                               │  └─ 异常处理 ✅
                                 │                               │
                                 ├─ 回调(result)                 │
                                 │  ├─ 异常检查 ✅               │
                                 │  └─ return to Flutter         │
```

#### 3.1.2 调用链检查项

| 检查层级 | 检查项 | 扣分规则 |
|----------|--------|----------|
| Flutter → ArkTS | MethodChannel 参数是否正确传递 | 错误扣 8 分 |
| ArkTS 入口 | handleMethodCall 是否有参数验证 | 缺失扣 5 分 |
| ArkTS → Native | Native 调用是否包裹 try-catch | 缺失扣 10 分 |
| Native 入口 | Native 函数是否创建 handle_scope | 缺失扣 10 分 |
| Native → ArkTS | Native 结果是否正确转换 | 错误扣 8 分 |
| ArkTS → Flutter | 异常是否转换为 PlatformException | 不转换扣 10 分 |

### 3.2 异常传播链检查

#### 3.2.1 异常传播检查

| 传播路径 | 检查项 | 扣分规则 |
|----------|--------|----------|
| Native → ArkTS | C++ 异常是否转换为 napi_throw | 不转换扣 10 分 |
| ArkTS → Flutter | ArkTS 异常是否传播到 Flutter | 不传播扣 10 分 |
| 完整链路 | 异常是否能从底层到顶层 | **断裂扣 15 分** |

**检查方法**：

1. 识别关键功能（至少 3 个）
2. 绘制每个功能的调用链图
3. 检查每个节点的异常处理
4. 检查异常传播路径是否完整

---

## 4. 严苛评分标准

### 4.1 扣分类型定义

| 问题等级 | 扣分幅度 | 典型问题 |
|----------|----------|----------|
| **致命** | -20 分 | NAPI 引用未释放、Handle Scope 未清理、关键路径无异常处理、事件订阅未取消、异常传播链断裂 |
| **严重** | -15 分 | 资源释放不完整、全局状态无保护、内存分配释放不匹配 |
| **中等** | -10 分 | 部分异常处理缺失、参数验证不完整、回调有效性未验证 |
| **轻微** | -5 分 | 代码风格不规范、注释不完整、日志记录缺失 |

### 4.2 特殊规则

| 规则 | 条件 | 评分 |
|------|------|------|
| 未实现鸿蒙化 | 不存在 `ohos/` 目录 | 0 分 |
| 鸿蒙化代码缺失 | `ohos/` 目录无 ETS/C++ 文件 | 0 分 |
| 致命问题过多 | 致命问题 ≥ 3 个 | 0 分 |
| 混合致命严重 | 致命问题 ≥ 2 个 + 严重问题 ≥ 2 个 | 0 分 |
| 扣分上限 | 致命问题扣分超过 60 分 | 0 分 |

### 4.3 评分计算公式

```
初始分数 = 100 分

总分 = 100 - Σ(各问题扣分)

若存在特殊情况 → 评分 = 0 分
若总分 < 0 → 评分 = 0 分

最终评分 = max(0, min(100, 总分))
```

---

## 5. 检视报告格式要求

### 5.1 评分格式

报告必须包含以下格式，确保 `_parseFlutterLibraryScore` 函数能正确解析：

```markdown
## 📊 稳定性评分

**综合评分：78/100**
```

**关键要求**：
- 使用粗体标记（`**` 包裹）
- 使用中文冒号（`：`）
- 格式为 `**综合评分：XX/100**`

### 5.2 必需内容

| 内容模块 | 要求 |
|----------|------|
| 检视范围 | 明确标注检视的目录和文件 |
| 扣分明细 | 列出每个扣分项的原因和位置 |
| 调用链分析 | 至少 3 个关键功能的调用链图 |
| 修复建议 | 按 P0/P1/P2 优先级分类 |
| 示例代码 | 关键问题的修复示例 |

---

## 6. 常见问题快速检查表

### 6.1 必查致命项

- [ ] NAPI 引用是否全部释放？
- [ ] Handle Scope 是否全部清理？
- [ ] 关键路径是否有异常处理？
- [ ] 事件订阅是否全部取消？
- [ ] 异常传播链是否完整？

### 6.2 必查严苛项

- [ ] onDestroy 是否释放所有资源？
- [ ] 全局状态是否有保护机制？
- [ ] 内存分配释放是否匹配？
- [ ] 参数验证是否完整？

### 6.3 快速判定标准

| 检查项数 | 通过标准 | 失败标准 |
|----------|----------|----------|
| 致命项（5 项） | 全部通过 | ≥ 1 项失败 → 扣 20 分 |
| 严苛项（10 项） | ≥ 8 项通过 | ≤ 6 项通过 → 扣分 ≥ 15 分 |
| 中等项（15 项） | ≥ 12 项通过 | ≤ 10 项通过 → 扣分 ≥ 10 分 |
| 轻微项（20 项） | ≥ 16 项通过 | ≤ 14 项通过 → 扣分 ≥ 5 分 |