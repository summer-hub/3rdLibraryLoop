# ArkTS 规范与约束速查

> ArkTS 是 TypeScript 的扩展集，在 TS 基础上施加了更严格的静态类型约束（强制静态类型、禁止运行时改变对象布局），以获得更好的运行性能。本文档汇总编码时必须遵守的约束，**违反即编译报错**。

---

## 一、禁止项清单（编译必查）

以下是 ArkTS 严格模式下最常见的编译阻断项，生成代码必须全部规避：

| # | 禁止项 | 错误码/规则 | 正确替代方式 |
|---|--------|------------|------------|
| 1 | `any` / `unknown` 类型 | `arkts-no-any-unknown` | 使用具体类型或泛型 `T` |
| 2 | `ESObject` / `Object` 通用类型 | `arkts-no-esobj` | 使用 `interface` 或具体类型 |
| 3 | 动态属性访问 `obj['key']` | `arkts-no-dynamic-property` | `obj.key` 类型安全访问 |
| 4 | 未类型化对象字面量 `let o = {}` | `arkts-no-untyped-obj-literals` | 先声明 class/interface 再赋值 |
| 5 | 内联匿名对象类型参数 | `arkts-no-obj-literals-as-types` | 定义命名 `interface` |
| 6 | `prototype` 扩展 | `arkts-no-prototype-assignment` | 类继承或组合 |
| 7 | `delete` 操作符 | `arkts-no-delete` | 将属性设为 `undefined` 或重构数据结构 |
| 8 | `arguments` 对象 | `arkts-no-arguments` | 使用展开参数 `...args: T[]` |
| 9 | 双重类型转换 `as unknown as T` | `arkts-no-unsafe-cast` | 定义正确的类型，单次合法转型 |
| 10 | `for...in` 遍历 | `arkts-no-for-in` | `Object.keys()` + `for...of` / `forEach` |
| 11 | `eval()` / `new Function()` | `arkts-no-eval` | 禁止使用，无合法替代 |
| 12 | catch 块直接 `throw e` | `arkts-limited-throw` | `throw e instanceof Error ? e : new Error(String(e))` |
| 13 | 结构型类型（鸭子类型）匹配 | `arkts-no-structural-typing` | 显式 `extends` / `implements` |
| 14 | 函数类型不一致赋值 | `arkts-strict-function-types` | 参数/返回值类型完全一致 |
| 15 | 泛型函数非箭头定义 | `arkts-no-functional-constructors` | 使用 `function` 声明或箭头函数 |
| 16 | `Object.assign` 修改对象布局 | `arkts-no-object-assign` | 逐属性赋值（类型已声明） |
| 17 | 运行时修改 class 布局 | `arkts-no-runtime-change-layout` | 类型声明保持静态 |
| 18 | `Symbol()` API | `arkts-no-symbol` | 不使用 Symbol |
| 19 | `as any` / 类型断言到 any | `arkts-no-any` | 明确的目标类型断言 |
| 20 | `void` 返回值以外使用 `undefined` 检查歧义 | — | 显式 `T \| undefined` |

> 完整规则见官方文档 [从 TypeScript 到 ArkTS 的适配规则](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/typescript-to-arkts-migration-guide)。

---

## 二、高频错误正误对照

### 2.1 类型安全（规则 1/2/4/5）

```typescript
// ❌ 错误：any + 未类型化字面量
function parse(json: string): any {
  return JSON.parse(json);
}
let config = { timeout: 5000, retries: 3 };

// ✅ 正确：显式类型
interface Config {
  timeout: number;
  retries: number;
}
function parseConfig(json: string): Config {
  return JSON.parse(json) as Config;  // 单次断言到具体类型是允许的
}
const config: Config = { timeout: 5000, retries: 3 };
```

### 2.2 catch 重抛（规则 12，最高频报错之一）

```typescript
// ❌ 错误：e 为 unknown，直接 throw 违反 arkts-limited-throw
try {
  await doWork();
} catch (e) {
  throw e;
}

// ✅ 正确：确保抛出 Error 实例
try {
  await doWork();
} catch (e) {
  throw e instanceof Error ? e : new Error(String(e));
}
```

### 2.3 对象字面量必须对应显式类型（规则 4/5）

```typescript
// ❌ 错误：内联匿名类型 + 裸字面量
function fetchData(url: string, cb: (resp: { code: number }) => void): void {}
let resp = { code: 200 };

// ✅ 正确：命名 interface
interface Response {
  code: number;
}
function fetchData(url: string, cb: (resp: Response) => void): void {}
const resp: Response = { code: 200 };
```

### 2.4 结构型类型禁用（规则 13）

```typescript
// ❌ 错误：鸭子类型赋值（字段相同也不能赋值）
interface A { x: number }
class B { x: number = 1 }
const a: A = new B();  // 编译报错 arkts-no-structural-typing

// ✅ 正确：显式实现
class C implements A { x: number = 1 }
const a2: A = new C();
```

### 2.5 遍历（规则 10）

```typescript
// ❌ 错误
for (const key in obj) { console.log(key); }

// ✅ 正确
const keys: string[] = Object.keys(obj);
for (const key of keys) {
  console.log(key);
}
```

---

## 三、类型系统约束

| 约束 | 说明 |
|------|------|
| 显式类型标注 | 所有变量、参数、返回值建议显式标注；字面量初始化可省略 |
| 联合类型 | `string \| null` 合法；禁止用 `any` 模拟联合 |
| 泛型 | 完整支持；优先泛型而非 any/Object 传参 |
| 字面量联合 | `mode: 'sync' \| 'async'` 合法，简单场景优先于枚举 |
| 可选属性 | `timeout?: number` 合法；访问时用 `?.` 或显式判空 |
| Record 类型 | `Record<string, string>` 用于键值对场景 |
| 函数类型 | 箭头函数与 function 声明均可；回调参数类型必须显式 |

---

## 四、命名与格式规范（华为 ArkTS 编程规范）

### 4.1 命名约定

| 元素 | 风格 | 示例 |
|------|------|------|
| 类 / 接口 / 枚举 / struct / 装饰器类 | PascalCase | `HttpClient`、`RetryPolicy`、`LoadState` |
| 方法 / 变量 / 参数 | camelCase | `sendRequest`、`maxRetries` |
| 常量 | UPPER_SNAKE_CASE | `const MAX_SIZE: number = 1024` |
| 枚举成员 | UPPER_SNAKE_CASE 或 PascalCase（全工程统一） | `enum Status { IDLE, RUNNING }` |
| 布尔变量/方法 | is/has/can 前缀 | `isValid`、`hasData` |
| 私有成员 | `private` 修饰符（不加 `_` 前缀） | `private count: number` |
| 文件名 | PascalCase.ets | `HttpClient.ets`、`Index.ets` |

### 4.2 代码格式

- 缩进 **2 空格**，禁止 Tab
- 语句行尾**分号**（`.ets` 源文件中必写）
- 单行长度建议 ≤ 120 字符
- 单文件 ≤ 400 行，超出按职责拆分
- import 顺序：`@ohos.*` / `@kit.*` → 第三方库 → 相对路径模块

### 4.3 注释规范

- 公共接口必须有 JSDoc：功能、`@param`、`@returns`
- 复杂逻辑块行内注释说明"为什么"而非"是什么"
- 禁止提交注释掉的死代码

```typescript
/**
 * 重试策略配置
 */
export interface RetryPolicy {
  /** 最大重试次数，默认 3 */
  maxRetries: number;
  /** 重试间隔基数（毫秒），按指数退避递增 */
  baseIntervalMs: number;
}

/**
 * 按指数退避执行重试
 * @param fn - 要执行的异步操作
 * @param policy - 重试策略
 * @returns 操作结果
 */
async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  // ...实现
}
```

---

## 五、日志规范

### 5.1 初始化

```typescript
import hilog from '@ohos.hilog';

// 域值 0x0000~0xFFFF，按模块分配
const DOMAIN: number = 0x0001;
// 标签 ≤ 31 字符，格式：模块名_功能名
const TAG: string = 'MyApp_HttpClient';
```

### 5.2 级别使用

| 级别 | 场景 |
|------|------|
| `debug` | 方法进出、中间状态（禁止用于高频循环） |
| `info` | 关键流程节点、状态变更、操作成功 |
| `warn` | 可恢复异常、参数降级处理 |
| `error` | 操作失败、异常捕获 |

### 5.3 隐私保护（强制）

```typescript
// ✅ 敏感数据使用 %{private}s
hilog.info(DOMAIN, TAG, 'login, account: %{private}s', account);

// ❌ 禁止密码/Token/手机号使用 %{public}s
```

---

## 六、ArkUI 声明式 UI 约束

| 约束 | 说明 |
|------|------|
| 状态变量必须加装饰器 | `@State` / `@Prop` / `@Link` / `@Provide` / `@Consume` 等 |
| 组件内状态修改触发刷新 | 只能通过状态变量驱动 UI，禁止命令式操作 |
| build() 内禁止修改状态 | 只做声明；状态修改放事件回调和生命周期 |
| 尺寸单位 | 布局用 `vp`、字体用 `fp`，禁止硬编码 px 假设 |
| 资源引用 | `$r('app.string.xxx')`；string 避免硬编码 |
| 条件渲染 | `if/else` 分支中组件结构须完整闭合 |
| 列表性能 | 大数据量列表用 `LazyForEach` + `IDataSource` |

---

## 七、依赖与导入约束

- `@ohos.*` 模块导入：`import http from '@ohos.net.http';`
- Kit 聚合导入（优先）：`import { http } from '@kit.NetworkKit';`
- 相对导入必须带文件名（无扩展名）：`import { Config } from './Config';`
- import 路径大小写敏感（macOS 不敏感、构建机 Linux 敏感，必须按实际文件名大小写书写）
- 三方依赖通过 `oh-package.json5` 声明，`ohpm install` 安装，禁止直接引用未声明依赖
