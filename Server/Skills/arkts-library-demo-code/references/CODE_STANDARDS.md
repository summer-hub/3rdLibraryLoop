# Demo 代码生成规范速查

本文档为 `arkts-library-demo-code` 技能的 ArkTS Demo 代码生成提供规范速查，涵盖命名规则、ArkTS 禁止项、日志规范、权限申请模式、国际化资源规范等。

---

## 一、文件命名规范

### Demo 页面文件命名

格式：`{三位序号}_{PascalCase功能描述}Page.ets`

所有 Demo 页面文件统一**平铺**在 `pages/` 目录，**严禁**创建子目录。

| 规则 | 说明 | 示例 |
|------|------|------|
| 三位序号 | 用零补齐，保证文件排序与 Demo 序号一致 | `001`、`012`、`100` |
| PascalCase 描述 | 大驼峰，体现 Demo 核心功能，单词首字母大写 | `CheckSupportAndConfig`、`BlurManagerLifecycle` |
| 完整文件名 | `{序号}_{PascalCase描述}Page.ets` | `001_CheckSupportAndConfigPage.ets` |

**示例映射**：

| Demo 中文名 | 文件路径（相对于 `entry/src/main/ets/`） |
|-----------|---------------------------------------|
| 环境检测与配置创建 Demo | `pages/001_CheckSupportAndConfigPage.ets` |
| 生命周期管理 Demo | `pages/002_BlurManagerLifecyclePage.ets` |
| 同步图像处理 Demo | `pages/003_SyncImageProcessPage.ets` |
| 异步网络请求 Demo | `pages/004_AsyncNetworkRequestPage.ets` |

> ⚠️ 路由注册（`main_pages.json`）和 `router.pushUrl` 中的 URL 路径格式为 `pages/{序号}_{PascalCaseName}Page`（**不含子目录**），如 `pages/001_CheckSupportAndConfigPage`。

### 模型文件命名（可选）

若 Demo 需要数据模型类，在 `pages/` 目录下与页面文件同级创建：`{PascalCase名}Model.ets`

---

## 二、ArkTS 编译禁止项（必查）

生成的所有代码必须规避以下 ArkTS 严格模式编译报错：

| 禁止项 | 错误标识 | 正确替代 |
|-------|---------|---------|
| `any` 类型 | `arkts-no-any` | 具体类型或泛型 `T` |
| `Object`/`ESObject` | `arkts-no-esobj` | 定义 `interface` 或具体类型 |
| 动态属性访问 `obj['key']` | `arkts-no-dynamic-property` | `obj.key` 类型安全访问 |
| 内联匿名对象类型 | `arkts-no-obj-literals-as-types` | 定义命名 `interface` |
| `prototype` 扩展 | `arkts-no-prototype-assignment` | 类继承或组合 |
| `delete` 操作符 | `arkts-no-delete` | 设为 `undefined` 或重构对象 |
| `arguments` 对象 | `arkts-no-arguments` | 展开参数 `...args: T[]` |
| 双重 `as unknown as T` | `arkts-no-unsafe-cast` | 正确定义类型，避免强转 |
| `for...in` | `arkts-no-for-in` | `Object.keys().forEach()` |
| `eval()` | `arkts-no-eval` | 禁止使用 |
| `catch(e)` 中直接 `throw e` | `arkts-limited-throw` | `e` 类型为 `unknown`，须用 `throw e instanceof Error ? e : new Error(String(e))` |
| `.then().catch()` 链式调用 | 可读性差 | 优先 `async/await + try/catch` |

---

## 三、日志规范

### 3.1 DOMAIN 与 TAG 分配

```typescript
// ✅ 正确：每个页面文件有独立 TAG，DOMAIN 在工程中统一范围
const DOMAIN: number = 0xD001;                     // 单个工程统一使用一个域值
const TAG: string = 'BlurKit_CheckSupportPage';   // {库名}_{页面/模块名}
```

**TAG 命名规则**：`{LibraryName}_{ComponentName}`，不超过 32 字符，只含字母数字下划线。

### 3.2 日志级别选择

| 级别 | 函数 | 使用场景 |
|------|------|---------|
| DEBUG | `hilog.debug(...)` | 方法入口、参数值、中间状态 |
| INFO | `hilog.info(...)` | 操作成功、状态变更、重要里程碑 |
| WARN | `hilog.warn(...)` | 输入非法但可处理、降级处理 |
| ERROR | `hilog.error(...)` | 捕获到异常、接口调用失败 |
| FATAL | `hilog.fatal(...)` | 不可恢复的致命错误（慎用） |

### 3.3 格式化参数

```typescript
// ✅ 公开数据用 %{public}s（会在日志中显示）
hilog.info(DOMAIN, TAG, 'Result count: %{public}d', count);
hilog.info(DOMAIN, TAG, 'File path: %{public}s', filePath);

// ✅ 敏感数据用 %{private}s（日志中显示为 <private>）
hilog.info(DOMAIN, TAG, 'User account: %{private}s', account);
hilog.info(DOMAIN, TAG, 'Token: %{private}s', token);

// ❌ 禁止：将密码、Token、手机号等用 %{public}s 输出
hilog.info(DOMAIN, TAG, 'Password: %{public}s', password); // 安全违规！
```

### 3.4 必须添加日志的位置

| 位置 | 日志级别 | 示例 |
|------|---------|------|
| `aboutToAppear()` | INFO | `hilog.info(..., 'XxxPage appeared')` |
| `aboutToDisappear()` | INFO | `hilog.info(..., 'XxxPage disappeared')` |
| 每个事件处理方法入口 | DEBUG | `hilog.debug(..., 'onButtonClick called')` |
| 接口调用成功 | INFO | `hilog.info(..., 'apiCall succeeded: ...')` |
| 捕获到异常 | ERROR | `hilog.error(..., 'apiCall failed: %{public}s', msg)` |
| 输入校验失败 | WARN | `hilog.warn(..., 'Invalid input: ...')` |

---

## 四、错误处理规范

### 4.1 异步接口标准模式

```typescript
private async callLibraryApi(param: string): Promise<void> {
  hilog.debug(DOMAIN, TAG, 'callLibraryApi called, param: %{public}s', param);
  this.isLoading = true;
  try {
    const result: ReturnType = await libraryApi(param);
    hilog.info(DOMAIN, TAG, 'callLibraryApi succeeded');
    this.resultText = `成功：${String(result)}`;
  } catch (err) {
    // ✅ 正确：使用 (err as Error).message，不使用 any
    const msg: string = (err as Error).message ?? String(err);
    hilog.error(DOMAIN, TAG, 'callLibraryApi failed: %{public}s', msg);
    this.resultText = `错误：${msg}`;
  } finally {
    // ✅ 无论成功失败都要重置 Loading 状态
    this.isLoading = false;
  }
}
```

### 4.2 同步接口标准模式

```typescript
private callSyncApi(): void {
  hilog.debug(DOMAIN, TAG, 'callSyncApi called');
  try {
    const result: ReturnType = syncApi();
    this.resultText = `结果：${String(result)}`;
    hilog.info(DOMAIN, TAG, 'callSyncApi succeeded: %{public}s', String(result));
  } catch (err) {
    const msg: string = (err as Error).message ?? String(err);
    hilog.error(DOMAIN, TAG, 'callSyncApi failed: %{public}s', msg);
    this.resultText = `错误：${msg}`;
  }
}
```

### 4.3 页面跳转错误处理

```typescript
// 组件方法内（推荐 getUIContext().getRouter()，路由路径无子目录）
this.getUIContext().getRouter().pushUrl({ url: 'pages/001_XxxPage' })
  .catch((err: Error) => {
    hilog.error(DOMAIN, TAG, 'Navigation failed: %{public}s', err.message);
  });
```

---

## 五、资源生命周期管理

所有持有的资源必须在 `aboutToDisappear()` 中释放，防止内存泄露：

```typescript
// 持有的资源（非状态变量）
private blurManager: BlurManager | null = null;
private timerId: number = -1;
private httpRequest: http.HttpRequest | null = null;

aboutToDisappear(): void {
  hilog.info(DOMAIN, TAG, 'XxxPage disappeared, releasing resources');

  // 释放鸿蒙原生库实例
  if (this.blurManager !== null) {
    this.blurManager.release();
    this.blurManager = null;
  }

  // 清除定时器
  if (this.timerId !== -1) {
    clearInterval(this.timerId);
    this.timerId = -1;
  }

  // 销毁 HTTP 请求
  if (this.httpRequest !== null) {
    this.httpRequest.destroy();
    this.httpRequest = null;
  }
}
```

---

## 六、权限申请规范

### 6.1 常见权限速查

| 功能 | 权限名 | 授权类型 |
|------|-------|---------|
| 网络访问 | `ohos.permission.INTERNET` | 系统自动授权 |
| 读取媒体文件 | `ohos.permission.READ_MEDIA` | 用户授权 |
| 写入媒体文件 | `ohos.permission.WRITE_MEDIA` | 用户授权 |
| 相机 | `ohos.permission.CAMERA` | 用户授权 |
| 麦克风 | `ohos.permission.MICROPHONE` | 用户授权 |
| 位置（精确） | `ohos.permission.LOCATION` | 用户授权 |
| 位置（模糊） | `ohos.permission.APPROXIMATELY_LOCATION` | 用户授权 |
| 蓝牙 | `ohos.permission.USE_BLUETOOTH` | 系统自动授权 |
| 振动 | `ohos.permission.VIBRATE` | 系统自动授权 |

### 6.2 动态权限申请标准模式

```typescript
import abilityAccessCtrl, { Permissions } from '@ohos.abilityAccessCtrl';
import common from '@ohos.app.ability.common';

/**
 * 申请运行时权限
 * @param permissions 需要申请的权限列表
 * @returns 所有权限均已授予返回 true，否则返回 false
 */
private async requestPermissions(permissions: Permissions[]): Promise<boolean> {
  hilog.debug(DOMAIN, TAG, 'requestPermissions called, count: %{public}d', permissions.length);
  const context = getContext(this) as common.UIAbilityContext;
  const atManager = abilityAccessCtrl.createAtManager();
  try {
    const result = await atManager.requestPermissionsFromUser(context, permissions);
    const allGranted: boolean = result.authResults.every((r: number) => r === 0);
    hilog.info(DOMAIN, TAG, 'Permission request result: %{public}s',
               allGranted ? 'all granted' : 'some denied');
    return allGranted;
  } catch (err) {
    const msg: string = (err as Error).message ?? String(err);
    hilog.error(DOMAIN, TAG, 'requestPermissions failed: %{public}s', msg);
    return false;
  }
}
```

---

## 七、UI 组件使用规范

### 7.1 状态显示模板

```typescript
// Loading 状态
if (this.isLoading) {
  LoadingProgress().width(40).height(40).margin({ top: 8 })
}

// 错误/结果文本
if (this.resultText.length > 0) {
  Text(this.resultText)
    .fontSize(14)
    .width('100%')
    .padding(12)
    .backgroundColor(this.isError ? '#FFEBEE' : '#F5F5F5')
    .fontColor(this.isError ? '#C62828' : '#212121')
    .borderRadius(8)
    .margin({ top: 8 })
}
```

### 7.2 按钮禁用逻辑

```typescript
// 按钮文本必须通过 $r() 引用国际化字符串，禁止硬编码
Button($r('app.string.demo_001_action_btn'))
  .width('100%')
  .enabled(!this.isLoading)  // 加载中禁用，防止重复触发
  .onClick(() => this.doAction())
```

### 7.3 列表渲染 key 要求

```typescript
// ✅ ForEach 第三个参数必须提供稳定唯一的 key
ForEach(this.items, (item: ItemType) => {
  ListItem() { /* ... */ }
}, (item: ItemType) => item.id)  // 使用唯一 id 作为 key
```

### 7.4 @Builder 动态数据禁用

**严禁**将 `@Builder` 方法用于展示需要动态更新的 `@State` 数据（耗时、计数器、状态标志等）：

- 原因：`@Builder` 在调用时对参数进行 **by-value 快照复制**，ArkUI diff 算法在同一位置遇到同一 `@Builder` 调用时判断"结构未变"而**跳过重渲染**，即使外部 `@State` 已更新，`@Builder` 子作用域内的展示内容也**不会刷新**
- 正确做法：将涉及动态 `@State` 的 `Text`/`Image` 等节点**直接内联在 `build()` 方法中**，让 `@State` 变量直接出现在组件树属性表达式里，ArkUI 才能建立正确依赖并触发细粒度更新
- 合法用法：`@Builder` 仅适用于静态布局复用（不依赖 `@State` 的纯展示结构）；`DemoIndex` 中的 `@Builder DemoCard(demo: DemoEntry)` 传入静态数据对象，属于合法用法

---

## 八、国际化资源规范

### 8.1 强制规则

- 所有出现在 UI `Text`/`Button` 组件中的静态字符串（页面标题、按钮文本、区块标签等）**必须**通过 `$r('app.string.xxx')` 引用，禁止在 ETS 代码中硬编码任何 UI 文本
- 主导航页面 `DemoEntry` 数组中，`title` 和 `description` 字段类型必须声明为 `Resource`，使用 `$r('app.string.demo_NNN_title')` 和 `$r('app.string.demo_NNN_index_desc')` 赋值
- 动态文本（运行时错误信息、接口返回结果等）不属于静态字符串，不需要资源键，在代码中直接赋值

### 8.2 三文件同步

每个 `$r('app.string.xxx')` 键必须**同时**在三个资源文件中添加同名条目：

| 文件 | 值的约定 |
|------|---------|
| `entry/src/main/resources/base/element/string.json` | 默认值（建议中文） |
| `entry/src/main/resources/zh_CN/element/string.json` | 中文，值用【序号】前缀标识 |
| `entry/src/main/resources/en_US/element/string.json` | 英文，值用 Title Case |

> 遗漏 base 会报 `Warning: the string of 'xxx' does not have a base resource.`（不阻塞编译，但影响资源回退与运行时定位）。

### 8.3 键名规则

- 格式：`demo_{三位序号}_{语义描述}`，如 `demo_001_title`、`demo_001_check_btn`
- 主导航专用键：每个 Demo 的 `demo_NNN_index_desc`（列表描述）、页面标题 `demo_index_title`
- 原始 Demo 入口：`demo_original_title`、`demo_original_index_desc`
- 键名以序号前缀隔离不同 Demo，避免冲突

---

## 九、验证点注释规范

在代码中为 Demo 描述文档中的每条"预期结果"添加验证点注释，帮助开发者对照验证：

```typescript
// ✅ 验证点 1: {第一条预期结果原文}
const result1 = await libraryApi();

// ✅ 验证点 2: {第二条预期结果原文}
this.displayResult = result1;
```

验证点注释应贴近产生该可观测结果的代码行或数据赋值语句。
