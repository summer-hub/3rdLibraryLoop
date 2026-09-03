# ArkTS 代码模板

> 按代码类型选择模板起步，替换占位内容后按需扩展。所有模板均符合 ArkTS 严格模式与华为编码规范，可通过 `devecocli build` 编译验证。

---

## 一、工具类模板（codeType: util）

无状态、可复用的纯逻辑封装。文件：`utils/StringValidator.ets`

```typescript
import hilog from '@ohos.hilog';

const DOMAIN: number = 0x0001;
const TAG: string = 'MyApp_StringValidator';

/**
 * 字符串校验工具类（纯静态方法，禁止实例化）
 */
export class StringValidator {
  private constructor() {
    // 工具类禁止实例化
  }

  /**
   * 校验字符串非空且长度不超上限
   * @param value - 待校验字符串
   * @param maxLen - 最大长度，默认 256
   * @returns 是否合法
   */
  static isValidText(value: string | null | undefined, maxLen: number = 256): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    return value.length > 0 && value.length <= maxLen;
  }

  /**
   * 校验字符串是否匹配正则
   * @param value - 待校验字符串
   * @param pattern - 正则表达式
   * @returns 是否匹配
   */
  static matches(value: string, pattern: RegExp): boolean {
    const matched: boolean = pattern.test(value);
    hilog.debug(DOMAIN, TAG, 'matches result=%{public}s', String(matched));
    return matched;
  }
}
```

---

## 二、业务服务类模板（codeType: service）

有状态、含异步操作与资源生命周期管理。文件：`service/ConfigService.ets`

```typescript
import hilog from '@ohos.hilog';

const DOMAIN: number = 0x0001;
const TAG: string = 'MyApp_ConfigService';

/** 服务配置 */
export interface ConfigServiceOptions {
  /** 请求超时（毫秒） */
  timeoutMs: number;
  /** 最大重试次数 */
  maxRetries: number;
}

/** 默认配置 */
const DEFAULT_OPTIONS: ConfigServiceOptions = {
  timeoutMs: 5000,
  maxRetries: 3,
};

/** 服务状态 */
export const enum ServiceState {
  IDLE = 0,
  RUNNING = 1,
  FINISHED = 2,
  FAILED = 3,
}

/**
 * 配置加载服务：管理状态机、异步操作与日志
 */
export class ConfigService {
  private readonly options: ConfigServiceOptions;
  private state: ServiceState = ServiceState.IDLE;

  constructor(options: ConfigServiceOptions = DEFAULT_OPTIONS) {
    this.options = options;
  }

  /** 获取当前状态 */
  getState(): ServiceState {
    return this.state;
  }

  /**
   * 执行业务操作（示例骨架，替换为实际逻辑）
   * @param input - 输入参数
   * @returns 处理结果
   */
  async execute(input: string): Promise<string> {
    hilog.info(DOMAIN, TAG, 'execute start, input length=%{public}d', input.length);
    this.state = ServiceState.RUNNING;
    try {
      // TODO: 替换为实际业务逻辑（系统 API 须经文档查证，见 API_VERIFICATION.md）
      const result: string = input.trim();
      this.state = ServiceState.FINISHED;
      hilog.info(DOMAIN, TAG, 'execute success');
      return result;
    } catch (e) {
      this.state = ServiceState.FAILED;
      const err: Error = e instanceof Error ? e : new Error(String(e));
      hilog.error(DOMAIN, TAG, 'execute failed: %{public}s', err.message);
      throw err;
    }
  }
}
```

---

## 三、页面模板（codeType: page）

文件：`pages/ExamplePage.ets`（须注册到 `resources/base/profile/main_pages.json`）

```typescript
import hilog from '@ohos.hilog';
import { ConfigService } from '../service/ConfigService';

const DOMAIN: number = 0x0001;
const TAG: string = 'MyApp_ExamplePage';

/**
 * 示例页面：演示状态驱动 UI 与资源清理
 */
@Entry
@Component
struct ExamplePage {
  @State message: string = 'ready';
  @State isLoading: boolean = false;
  private service: ConfigService = new ConfigService();
  private timerId: number = -1;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'page appear');
  }

  aboutToDisappear(): void {
    // 清理页面持有的 Timer / 订阅等资源
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
    hilog.info(DOMAIN, TAG, 'page disappear');
  }

  private async onRunClicked(): Promise<void> {
    this.isLoading = true;
    try {
      const result: string = await this.service.execute('  demo input  ');
      this.message = `result: ${result}`;
    } catch (e) {
      this.message = `failed: ${(e as Error).message}`;
    } finally {
      this.isLoading = false;
    }
  }

  build() {
    Column({ space: 12 }) {
      Text(this.message)
        .fontSize(16)
        .width('90%')
        .textAlign(TextAlign.Center)

      if (this.isLoading) {
        LoadingProgress()
          .width(36)
          .height(36)
      } else {
        Button('run')
          .width('60%')
          .onClick(() => {
            this.onRunClicked();
          })
      }
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  }
}
```

---

## 四、自定义组件模板（codeType: component）

文件：`components/StatusCard.ets`

```typescript
/**
 * 状态卡片组件：父组件传 @Prop 单向数据，@Link 双向同步计数
 */
@Component
export struct StatusCard {
  @Prop title: string = '';
  @Link count: number;
  private onCountChanged: ((count: number) => void) | null = null;

  build() {
    Column({ space: 8 }) {
      Text(this.title)
        .fontSize(16)
        .fontWeight(FontWeight.Medium)

      Text(`count: ${this.count}`)
        .fontSize(20)

      Row({ space: 12 }) {
        Button('+')
          .width(44)
          .height(44)
          .onClick(() => {
            this.count += 1;
            if (this.onCountChanged !== null) {
              this.onCountChanged(this.count);
            }
          })
        Button('-')
          .width(44)
          .height(44)
          .onClick(() => {
            this.count -= 1;
            if (this.onCountChanged !== null) {
              this.onCountChanged(this.count);
            }
          })
      }
    }
    .padding(12)
    .borderRadius(12)
    .backgroundColor('#F1F3F5')
    .width('90%')
  }
}
```

> 组件内回调属性（如 `onCountChanged`）须显式声明类型；父组件使用：`StatusCard({ title: 'demo', count: $count, onCountChanged: (c: number) => {} })`

---

## 五、HTTP 服务类模板（网络场景常用）

文件：`service/HttpService.ets`。须在 `module.json5` 声明 `ohos.permission.INTERNET`。

```typescript
import { http } from '@kit.NetworkKit';
import hilog from '@ohos.hilog';

const DOMAIN: number = 0x0001;
const TAG: string = 'MyApp_HttpService';

/** 请求配置 */
export interface HttpServiceOptions {
  connectTimeoutMs: number;
  readTimeoutMs: number;
}

/** 响应封装 */
export interface ApiResponse {
  statusCode: number;
  body: string;
}

const MAX_RESPONSE_BYTES: number = 5 * 1024 * 1024;

/**
 * HTTP 服务：每次请求独立 HttpRequest，try/finally 释放
 */
export class HttpService {
  private readonly options: HttpServiceOptions;

  constructor(options: HttpServiceOptions) {
    this.options = options;
  }

  /**
   * 发起 GET 请求
   * @param url - 目标地址（https 优先）
   * @returns 状态码与响应体
   */
  async get(url: string): Promise<ApiResponse> {
    const httpRequest: http.HttpRequest = http.createHttp();
    try {
      const response: http.HttpResponse = await httpRequest.request(url, {
        method: http.RequestMethod.GET,
        connectTimeout: this.options.connectTimeoutMs,
        readTimeout: this.options.readTimeoutMs,
      });
      if (typeof response.result !== 'string') {
        throw new Error('unexpected response type');
      }
      if (response.result.length > MAX_RESPONSE_BYTES) {
        throw new Error(`response too large: ${response.result.length} bytes`);
      }
      hilog.info(DOMAIN, TAG, 'GET %{public}s -> %{public}d', url, response.responseCode);
      return { statusCode: response.responseCode, body: response.result };
    } finally {
      httpRequest.destroy();
    }
  }
}
```

---

## 六、模块导出模板（index.ets）

```typescript
// library/src/main/ets/index.ets 或模块入口
export { StringValidator } from './utils/StringValidator';
export { ConfigService } from './service/ConfigService';
export type { ConfigServiceOptions } from './service/ConfigService';
export { ServiceState } from './service/ConfigService';
export { HttpService } from './service/HttpService';
export type { HttpServiceOptions, ApiResponse } from './service/HttpService';
```

> 仅 `export` 的符号对外可见；`interface`/`type` 导出用 `export type`。

---

## 七、main_pages.json 注册模板

`entry/src/main/resources/base/profile/main_pages.json`：

```json
{
  "src": [
    "pages/Index",
    "pages/ExamplePage"
  ]
}
```

## 八、module.json5 权限声明模板

`entry/src/main/module.json5`（module 节点内）：

```json
{
  "module": {
    "requestPermissions": [
      { "name": "ohos.permission.INTERNET" }
    ]
  }
}
```

> user_grant 级权限（如 LOCATION）声明后还须运行时申请，参见 [代码模式 §五](../references/CODE_PATTERNS.md)。
