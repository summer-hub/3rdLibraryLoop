# ArkTS 代码模式

> 编写鸿蒙原生 ArkTS 代码时的标准实现模式：异步编程、并发、错误处理、事件、权限、资源生命周期、UI 状态管理。所有模式均已通过 ArkTS 严格模式编译验证。

---

## 一、异步编程模式

### 1.1 Promise + async/await（默认选择）

```typescript
import fs from '@ohos.file.fs';
import hilog from '@ohos.hilog';

const DOMAIN: number = 0x0001;
const TAG: string = 'MyApp_Async';

/** 将回调式 API 封装为 Promise */
function readTextAsync(filePath: string): Promise<string> {
  return new Promise<string>((resolve: (value: string) => void,
    reject: (reason: Error) => void) => {
    fs.readText(filePath, (err: Error, data: string) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve(data);
    });
  });
}

/** 调用方：async/await + try/catch/finally */
async function processFile(filePath: string): Promise<string> {
  try {
    const content: string = await readTextAsync(filePath);
    hilog.info(DOMAIN, TAG, 'read ok, length=%{public}d', content.length);
    return content;
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'read failed: %{public}s', (e as Error).message);
    throw e instanceof Error ? e : new Error(String(e));
  }
}
```

### 1.2 超时控制（Promise.race）

```typescript
function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  const timer: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
      setTimeout(() => {
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  return Promise.race<T>([task, timer]);
}
```

---

## 二、并发模式（taskpool / worker）

> 阻塞 IO、大量计算禁止在主线程执行。优先 taskpool（轻量任务池），长生命周期后台线程用 worker。

### 2.1 taskpool 耗时计算

```typescript
import taskpool from '@ohos.taskpool';

// @Concurrent 函数必须是独立函数，不能捕获外部变量（可序列化参数传入）
@Concurrent
function computeChecksum(input: number[]): number {
  let sum: number = 0;
  for (const value of input) {
    sum += value * 31;
  }
  return sum;
}

async function runInBackground(input: number[]): Promise<number> {
  const task: taskpool.Task = new taskpool.Task(computeChecksum, input);
  return await taskpool.execute(task) as number;
}
```

### 2.2 worker 生命周期（必须 terminate）

```typescript
import worker from '@ohos.worker';

class WorkerHost {
  private threadWorker: worker.ThreadWorker | null = null;

  start(): void {
    // 脚本路径相对模块 src/main/ets
    this.threadWorker = new worker.ThreadWorker('entry/ets/workers/MyWorker.ets');
    this.threadWorker.onmessage = (event: MessageEvents): void => {
      // 处理子线程结果
    };
    this.threadWorker.postMessage({ type: 'start' });
  }

  /** 必须在确定生命周期节点调用，防止线程泄露 */
  stop(): void {
    if (this.threadWorker !== null) {
      this.threadWorker.terminate();
      this.threadWorker = null;
    }
  }
}
```

---

## 三、错误处理模式

### 3.1 BusinessError（系统 API 标准错误）

```typescript
import { BusinessError } from '@ohos.base';

async function callSystemApi(): Promise<void> {
  try {
    // await someSystemApi();
  } catch (error) {
    // 系统 API 错误统一转型为 BusinessError 读取 code
    const err: BusinessError = error as BusinessError;
    hilog.error(0x0001, 'MyApp', 'code=%{public}d, msg=%{public}s', err.code, err.message);
    throw err instanceof Error ? err : new Error(String(err));
  }
}
```

### 3.2 参数防御性校验

```typescript
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateInput(value: string | null | undefined, fieldName: string,
  maxLen: number = 256): string {
  if (value === null || value === undefined || value.length === 0) {
    throw new ValidationError(`${fieldName} must not be empty`);
  }
  if (value.length > maxLen) {
    throw new ValidationError(`${fieldName} exceeds max length ${maxLen}`);
  }
  return value;
}
```

### 3.3 统一 Result 类型（避免异常控制流蔓延）

```typescript
export interface Result<T> {
  success: boolean;
  value?: T;
  error?: string;
}

export class Ok<T> implements Result<T> {
  success: boolean = true;
  constructor(public value: T) {}
}

export class Fail<T> implements Result<T> {
  success: boolean = false;
  constructor(public error: string) {}
}
```

---

## 四、事件模式（emitter）

```typescript
import emitter from '@ohos.events.emitter';

// 事件常量集中定义
export const enum AppEvent {
  DATA_UPDATED = 1001,
  SYNC_FAILED = 1002,
}

class EventBus {
  private static subscriptionCount: number = 0;

  static subscribe(eventId: number, callback: (data: emitter.EventData) => void): void {
    emitter.on({ eventId: eventId }, callback);
    EventBus.subscriptionCount += 1;
  }

  static emit(eventId: number, data: Record<string, Object>): void {
    emitter.emit({ eventId: eventId }, { data: data });
  }

  /** 取消订阅必须与 on 配对 */
  static unsubscribe(eventId: number): void {
    emitter.off(eventId);
  }
}
```

---

## 五、权限申请模式

```typescript
import abilityAccessCtrl, { Permissions } from '@ohos.abilityAccessCtrl';
import { common } from '@kit.AbilityKit';

async function requestPermissions(context: common.UIAbilityContext,
  permissions: Permissions[]): Promise<boolean> {
  const atManager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
  const result: abilityAccessCtrl.PermissionRequestResult =
    await atManager.requestPermissionsFromUser(context, permissions);
  return result.authResults.every((status: number) =>
    status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED);
}
```

> normal 级权限仅声明即生效；user_grant 级权限须声明 + 运行时申请两步缺一不可。

---

## 六、资源生命周期管理（防泄露）

> **规则**：凡是 `create/open/on/connect` 获取的资源，必须存在对称的 `destroy/close/off/disconnect` 释放路径，置于 `try/finally` 或组件销毁回调中。

| 资源 | 获取 | 释放 | 位置 |
|------|------|------|------|
| HTTP 连接 | `http.createHttp()` | `httpRequest.destroy()` | `try/finally` |
| 文件句柄 | `fs.openSync()` | `fs.closeSync(fd)` | `try/finally` |
| RDB 存储 | `getRdbStore()` | `close()` | 模块卸载 |
| Worker | `new ThreadWorker()` | `terminate()` | 任务完成/销毁 |
| Timer | `setInterval()` | `clearInterval(id)` | `aboutToDisappear` |
| emitter 订阅 | `emitter.on()` | `emitter.off(id)` | `aboutToDisappear` |
| 传感器 | `sensor.on()` | `sensor.off(type)` | 页面隐藏/销毁 |
| AVPlayer | `createAVPlayer()` | `release()` | 播放结束/销毁 |

### 6.1 HTTP 请求标准范式（最常见泄露点）

```typescript
import { http } from '@kit.NetworkKit';

const MAX_RESPONSE_BYTES: number = 5 * 1024 * 1024;

async function httpGet(url: string): Promise<string> {
  const httpRequest: http.HttpRequest = http.createHttp();
  try {
    const response: http.HttpResponse = await httpRequest.request(url, {
      method: http.RequestMethod.GET,
      connectTimeout: 10_000,
      readTimeout: 15_000,
      expectMaxDuration: 20_000,
    });
    if (typeof response.result !== 'string') {
      throw new Error('unexpected response type');
    }
    if (response.result.length > MAX_RESPONSE_BYTES) {
      throw new Error(`response too large: ${response.result.length}`);
    }
    return response.result;
  } finally {
    // ✅ 成功失败均释放
    httpRequest.destroy();
  }
}
```

### 6.2 文件读写标准范式

```typescript
import fs from '@ohos.file.fs';

function readFileSafely(filePath: string): string {
  let fd: number = -1;
  try {
    const file: fs.File = fs.openSync(filePath, fs.OpenMode.READ_ONLY);
    fd = file.fd;
    const stat: fs.Stat = fs.statSync(filePath);
    const buffer: ArrayBuffer = new ArrayBuffer(stat.size);
    fs.readSync(fd, buffer);
    return String.fromCharCode(...new Uint8Array(buffer));
  } finally {
    if (fd >= 0) {
      fs.closeSync(fd);
    }
  }
}
```

### 6.3 组件内订阅/Timer 清理

```typescript
@Component
struct PollingComponent {
  @State message: string = '';
  private timerId: number = -1;

  aboutToAppear(): void {
    this.timerId = setInterval(() => {
      this.message = `tick ${Date.now()}`;
    }, 1000);
  }

  aboutToDisappear(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  build() {
    Text(this.message)
  }
}
```

---

## 七、UI 状态管理模式

### 7.1 父子组件通信

```typescript
// 子组件：单向输入 @Prop，双向绑定 @Link
@Component
struct CounterCard {
  @Prop title: string = '';
  @Link count: number;

  build() {
    Column({ space: 8 }) {
      Text(this.title)
        .fontSize(16)
      Text(`count: ${this.count}`)
        .fontSize(20)
      Button('+1')
        .onClick(() => {
          this.count += 1;
        })
    }
    .padding(12)
  }
}

@Entry
@Component
struct Index {
  @State count: number = 0;

  build() {
    Column({ space: 12 }) {
      CounterCard({ title: 'demo', count: $count })  // @Link 用 $ 传引用
    }
  }
}
```

### 7.2 @Provide/@Consume 跨层级

```typescript
// 祖先组件
@Entry
@Component
struct GrandParent {
  @Provide themeColor: string = '#007DFF';

  build() { /* 包含后代组件 */ }
}

// 任意后代组件（无需逐层传递）
@Component
struct DeepChild {
  @Consume themeColor: string;

  build() {
    Text('themed').fontColor(this.themeColor)
  }
}
```

### 7.3 @Builder 复用 + @BuilderParam 插槽

```typescript
@Builder
function LoadingView(text: string) {
  Column({ space: 8 }) {
    LoadingProgress().width(48).height(48)
    Text(text).fontSize(14)
  }
  .width('100%')
  .justifyContent(FlexAlign.Center)
}
```

---

## 八、兼容性守卫模式

```typescript
import deviceInfo from '@ohos.deviceInfo';

// 硬件能力检测：调用蓝牙/NFC/摄像头前必须
function ensureBluetooth(): boolean {
  return canIUse('SystemCapability.Communication.Bluetooth.Core');
}

// API Level 守卫：使用 since 高于目标版本的接口前必须
function getSdkApiLevel(): number {
  return deviceInfo.sdkApiVersion;
}
```

---

## 九、典型平台陷阱速查

| 陷阱 | 正确做法 |
|------|---------|
| 沙箱路径 | 用 `context.filesDir` / `context.cacheDir`；禁止硬编码 `/data/local/tmp` |
| rawfile 资源 | 不可直接路径访问；用 `resourceManager.getRawFileContentSync()` / `getRawFdSync()` |
| `file://` 前缀 | 拼接为 `file://` + 绝对路径（两斜杠），媒体 URL 不用三斜杠 |
| fs.writeSync 传 Uint8Array | 必须传 `uint8array.buffer`（ArrayBuffer） |
| 高频 hilog.debug | 禁止每帧/每秒多次打印，影响性能 |
| 阻塞主线程 | `Thread.sleep` 类同步等待不存在；用 `await new Promise` + setTimeout 或 taskpool |
