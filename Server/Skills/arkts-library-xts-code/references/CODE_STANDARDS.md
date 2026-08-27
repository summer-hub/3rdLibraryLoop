# XTS 测试代码生成规范速查

本文档为 `ohos-xts-code-generator` 技能提供编码规范速查，涵盖文件命名、ArkTS 禁止项、日志规范、注释规范、错误处理、hypium 测试框架使用等。

---

## 一、文件命名规范

### 测试文件命名

格式：`{LibraryName}XtsTest.test.ets`

所有测试文件统一放在 `entry/src/ohosTest/ets/test/` 目录。

> ⚠️ **扩展名必须为 `.test.ets`**，不能用 `.ts` 或 `.ets`。OpenHarmony XTS 测试框架要求测试文件使用 `.test.ets` 扩展名。

| 规则 | 说明 | 示例 |
|------|------|------|
| LibraryName | 库名（PascalCase） | `Lodash`、`Axios`、`BlurKit` |
| 完整文件名 | `{LibraryName}XtsTest.test.ets` | `LodashXtsTest.test.ets` |

**示例映射**：

| 库名 | 测试文件路径 |
|------|---------------------------------------|
| lodash | `entry/src/ohosTest/ets/test/LodashXtsTest.test.ets` |
| axios | `entry/src/ohosTest/ets/test/AxiosXtsTest.test.ets` |
| blur-kit | `entry/src/ohosTest/ets/test/BlurKitXtsTest.test.ets` |

### 测试函数命名

格式：`{function_snake_case}_{SEQ}`

| 规则 | 说明 | 示例 |
|------|------|------|
| function_snake_case | 英文功能描述（小写+下划线，≤20字符） | `chunk_basic`、`get_set_path` |
| SEQ | 三位数字序号 | `001`、`007`、`012` |
| 完整函数名 | `{描述}_{序号}` | `chunk_basic_001` |

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
| `unknown` 关键字及双重 `as unknown as T` | `arkts-no-any-unknown` | `unknown` 关键字在 ArkTS 严格模式下被完全禁止，不能用于类型转换中间层。替代方案：① 传递空但合法的对象（如 `new BleDevice('', '')` 代替 `null as BleDevice`）；② 对需要 null 参数的异常测试，改测空字符串/零值参数的行为；③ 构造最小必填字段对象字面量并 `as Type`（如 `as ble.ScanResult`）；④ 不需要实际功能的参数用 `{} as Type`（如 `{} as common.Context`） |
| `for...in` | `arkts-no-for-in` | `Object.keys().forEach()` |
| `eval()` | `arkts-no-eval` | 禁止使用 |
| `catch(e)` 中直接 `throw e` | `arkts-limited-throw` | **禁止重新抛出任意类型异常**。改用 try-catch + 布尔标记模式，catch 中仅设标记，不 throw |
| `null as SomeType` 强转 | 类型不兼容错误 | `{} as common.Context`（用于不需要实际功能的参数），或 null 检查 + `throw new Error()` |
| `undefined as SomeType` | 类型不兼容错误 | null 检查 + 安全默认值或 `throw new Error()` |
| catch 子句类型注解 | `arkts-no-types-in-catch` | `catch (e)` 不带类型注解，e 默认为 Object 类型（非 any），不违反 `arkts-no-any-unknown` |
| `as Object` 后访问属性 | `Property 'X' does not exist on type 'Object'` | 保留原始类型不做 `as Object` 转型；仅在不需要属性访问时用 `as Object`（如验证非 null） |
| 枚举成员直接比较 | `types 'A' and 'B' have no overlap` | `(Enum.A as number) !== (Enum.B as number)` 转型后比较 |
| 无类型对象字面量 | `arkts-no-untyped-obj-literals` | `{}` 或 `{ key: value }` 必须对应命名 interface/class；定义 `class MockTarget { prop: string = ''; }` 代替 `let x: Object = {}` |
| 向 `@ts-nocheck` 库 API 传 `null` 实参 | `Argument of type 'null' is not assignable to parameter of type 'string'` | 库源码的 `@ts-nocheck` **不豁免测试文件**，调用处仍受严格空值检查约束。库内部用 `if (x)` 判空时，空串 `''`/空数组 `[]` 与 null 语义等价 → 改传等价 falsy 值覆盖同一守卫路径（如 `new ID3v1Tag('')`），并在注释中说明等价性依据 |
| 断言裸函数调用 | `Cannot find name 'assertTrue'`（批量） | hypium 断言只存在于 `expect()` 返回对象上，**不存在独立全局函数**。`assertTrue(x)`/`assertEqual(a, b)` 裸调用是编译错误，必须写 `expect(x).assertTrue()` 链式调用 |

---

## 三、日志规范

### 3.1 DOMAIN 与 TAG 分配

```typescript
// ✅ 正确：每个测试文件有独立 TAG，DOMAIN 在工程中统一范围
const DOMAIN: number = 0xD001;                     // 单个工程统一使用一个域值
const TAG: string = 'Lodash_XtsTest';              // {库名}_XtsTest
```

**TAG 命名规则**：`{LibraryName}_XtsTest`，不超过 32 字符，只含字母数字下划线。

### 3.2 日志级别选择

| 级别 | 函数 | 使用场景 |
|------|------|---------|
| DEBUG | `hilog.debug(...)` | 测试执行结果、中间状态 |
| INFO | `hilog.info(...)` | 测试开始/结束、套件生命周期 |
| ERROR | `hilog.error(...)` | 测试失败、捕获到异常 |

### 3.3 格式化参数

```typescript
// ✅ 公开数据（测试结果、参数）用 %{public}s
hilog.debug(DOMAIN, TAG, 'Result: %{public}s', JSON.stringify(result));

// ✅ 敏感数据用 %{private}s（日志中显示为 <private>）
hilog.debug(DOMAIN, TAG, 'Token: %{private}s', token);

// ❌ 禁止将敏感信息用 %{public}s 输出
```

### 3.4 必须添加日志的位置

| 位置 | 日志级别 | 示例 |
|------|---------|------|
| 测试函数开始 | INFO | `hilog.info(..., 'Test XXX started')` |
| 测试执行结果 | DEBUG | `hilog.debug(..., 'Result: %{public}s', ...)` |
| 测试成功完成 | INFO | `hilog.info(..., 'Test XXX passed')` |
| 测试失败 | ERROR | `hilog.error(..., 'Test XXX failed: %{public}s', msg)` |
| beforeAll/afterAll | INFO | `hilog.info(..., 'Suite started/finished')` |

---

## 四、注释规范

### 4.1 文件头部注释

```typescript
/**
 * {LibraryName} XTS 测试用例
 *
 * 基于 XTS 用例描述文档生成，验证 {LibraryName} 的核心功能。
 * 文档来源：ohos_{LibraryName}xts用例描述.md
 * 
 * 用例总数：{N}
 * 可测试接口数：{M}
 *
 * @author lalhan
 */
```

### 4.2 测试函数注释

```typescript
/**
 * 用例 {SEQ}: {用例名称}
 *
 * 用例描述：{从用例描述文档提取的详细描述}
 * 涉及接口：{接口签名列表}
 * 预期结果：
 *   1. {预期结果 1}
 *   2. {预期结果 2}
 */
```

### 4.3 测试步骤注释

使用区块注释分隔测试步骤：

```typescript
// ─── 步骤 1：{步骤功能} ───────────────────────────────────────────────────
const step1Result = interface1Call();

// ─── 步骤 2：{步骤功能} ───────────────────────────────────────────────────
const step2Result = interface2Call();
```

### 4.4 注释风格对比

```typescript
// ✅ 推荐：使用块注释说明测试步骤和区块分隔
/**
 * ─── 步骤 1：设置属性 ───────────────────────────────────────────────────
 * 验证 _.set 能正确设置嵌套属性
 */
const setResult = _.set(obj, 'a.b.c', 1);

// ❌ 避免：过多单行注释影响可读性
// 调用 set 方法
// 设置属性 a.b.c
// 值为 1
const setResult = _.set(obj, 'a.b.c', 1);
```

---

## 五、错误处理规范

### 5.1 必须包含错误处理的位置

| 位置 | 处理方式 |
|------|---------|
| 预期异常测试 | try-catch + 布尔标记模式，catch 中禁止 `throw e` |
| 空值输入测试 | 验证不崩溃 + 验证返回安全默认值 |
| 大数据量测试 | 记录执行时间 + 验证不超时不崩溃 |
| 正常测试 | 不需要 try-catch，让 expect 断言和框架自动处理失败 |

### 5.2 预期异常测试模板

```typescript
// ✅ 推荐：try-catch + 布尔标记模式
let caught: boolean = false;
try {
  libraryFunc(null);
} catch (e) {
  caught = true;
  // 禁止 throw e（arkts-limited-throw）
}
expect(caught).assertTrue();
```

### 5.3 null 值输入测试模板

```typescript
// 对于需要传入 null 但参数类型不允许 null-as-Type 强转的场景
// 使用 null 检查 + throw new Error() 模式
let caught: boolean = false;
try {
  const emptyInput: SomeType | null = null;
  if (emptyInput === null) {
    throw new Error('Input cannot be null');
  }
  new SomeClass(emptyInput);
} catch (e) {
  caught = true;
}
expect(caught).assertTrue();
```

### 5.4 空对象作为 Mock Context

```typescript
// processRenderScript 等需要 Context 参数但不实际使用时
// ✅ 正确：空对象 as common.Context
const mockContext: common.Context = {} as common.Context;
manager.processRenderScript(mockContext, radius);

// ❌ 错误：null as common.Context（类型不兼容，ArkTS 编译报错）
// ❌ 错误：null as image.PixelMap（类型不兼容）
```

### 5.5 异常类型断言（instanceof）与深层路径导入

自定义异常类通常未从 `library/index.ets` 根入口导出，做 `instanceof` 类型断言前必须深层路径导入真实异常类（未导出的实现类同理）：

```typescript
// ✅ 正确：深层路径导入真实异常类后做 instanceof 断言
import { NoSuchTagException } from '@ohos/{LibraryName}/src/main/ets/components/{lib}/NoSuchTagException';

let isTarget: boolean = false;
try {
  someCall();
} catch (e) {
  isTarget = e instanceof NoSuchTagException;  // 必须真实 import，禁止用 e.message 字符串匹配替代
}
expect(isTarget).assertTrue();
```

> 深层导入路径以库源码实际目录为准。仅做异常"是否抛出"的布尔断言时无需导入异常类；需要断言"异常类型正确"时才用本模式。

---

## 六、hypium 测试框架使用指南

### 6.1 核心 API

| API | 用途 | 示例 |
|-----|------|------|
| `describe(name, fn)` | 定义测试套件 | `describe('LodashXtsTest', () => { ... })` |
| `it(name, fn)` | 定义单个测试 | `it('chunk_basic_001', () => { ... })` |
| `expect(value)` | 创建断言对象 | `expect(result).assertEqual(1)` |
| `beforeAll(fn)` | 套件开始前执行一次 | 全局初始化 |
| `afterAll(fn)` | 套件结束后执行一次 | 全局清理 |
| `beforeEach(fn)` | 每个测试前执行 | 测试数据准备 |
| `afterEach(fn)` | 每个测试后执行 | 测试数据清理 |

### 6.2 常用断言方法

> ⚠️ **重要**：`@ohos/hypium` 的 `expect()` 对象上**不存在** Jest 风格的 `toBe`/`toEqual`/`toBeTruthy`/`toBeFalsy`/`toThrow` 等方法。必须使用以下 hypium 专用断言方法：

| 断言方法 | 用途 | 示例 |
|---------|------|------|
| `assertEqual(value)` | 严格相等（===） | `expect(result).assertEqual(1)` |
| `assertContain(item)` | 包含判断（数组/字符串） | `expect(arr).assertContain(1)` |
| `assertLarger(value)` | 大于判断 | `expect(count).assertLarger(0)` |
| `assertNull()` | null 判断 | `expect(result).assertNull()` |
| `assertTrue()` | 布尔真判断 | `expect(x !== null).assertTrue()` |
| `assertFalse()` | 布尔假判断 | `expect(x === null).assertFalse()` |

### 6.3 Jest 风格方法替代方案

| Jest 风格（❌ 不存在） | hypium 替代（✅ 正确） | 说明 |
|----------------------|----------------------|------|
| `expect(x).toBe(y)` | `expect(x).assertEqual(y)` | 严格相等 |
| `expect(x).toEqual(y)` | `expect(x).assertEqual(y)` | 深度相等也用 assertEqual |
| `expect(x).toBeNull()` | `expect(x).assertNull()` | null 判断 |
| `expect(x).toBeTruthy()` | `expect(x !== null).assertTrue()` | 真值 → 布尔表达式 |
| `expect(x).toBeFalsy()` | `expect(x).assertFalse()` | 假值 |
| `expect(x).not.toBeNull()` | `expect(x !== null).assertTrue()` | 否定断言 → 布尔表达式 |
| `expect(fn).toThrow()` | try-catch + 布尔标记 | 见下方说明 |
| `expect(x).toBeGreaterThan(n)` | `expect(x).assertLarger(n)` | 大于 |
| `expect(x).toBeLessThan(n)` | `expect(n).assertLarger(x)` | 小于（反转方向） |
| `expect(x).toContain(y)` | `expect(x).assertContain(y)` | 包含 |
| `expect(x).not.toBe(y)` | `expect(x === y).assertFalse()` | 否定断言 → 布尔表达式 |

**`toThrow()` 替代方案**：

```typescript
// ❌ 错误：hypium 不支持 toThrow()
expect(() => func(null)).toThrow();

// ✅ 正确：try-catch + 布尔标记模式
let caught: boolean = false;
try {
  func(null);
} catch (e) {
  caught = true;
}
expect(caught).assertTrue();
```

**`toBeLessThan()` 替代方案**：

```typescript
// ❌ 错误：hypium 不支持 toBeLessThan()
expect(duration).toBeLessThan(10000);

// ✅ 正确：反转比较方向
expect(10000).assertLarger(duration);  // 即 10000 > duration
```

### 6.4 异步测试

```typescript
// 异步测试使用 async/await
it('async_test', async () => {
  const result = await asyncFunc();
  expect(result).assertEqual(expected);
});
```

> ⚠️ **同步方法内部委托异步方法的陷阱**：若库的某个同步方法（如 `saveIntoFile`）内部实际委托给异步方法（如 `saveIntoFileAsync`），则测试时必须使用 `async` 函数 + `await`，否则异步操作尚未完成就执行了后续断言。
>
> ```typescript
> // ❌ 错误：saveIntoFile 内部是异步的，同步调用后立即检查文件
> it('save_test', 0, () => {
>   manager.saveIntoFile(path);      // 内部调用 saveIntoFileAsync（异步）
>   expect(fs.accessSync(path)).assertTrue();  // 文件可能还没写入！
> });
>
> // ✅ 正确：使用 async + await
> it('save_test', 0, async () => {
>   await manager.saveIntoFileAsync(path);     // 等待异步写入完成
>   expect(fs.accessSync(path)).assertTrue();  // 文件已写入
> });
> ```

### 6.5 测试套件导出与注册

```typescript
// 测试文件必须导出默认函数
export default function LodashXtsTest() {
  describe('LodashXtsTest', () => {
    // 测试用例...
  });
}

// 在入口文件中导入注册（import 路径不带 .ets 扩展名，保留 .test 部分）
import LodashXtsTest from './test/LodashXtsTest.test';

export default function testsuite() {
  LodashXtsTest();
}
```

### 6.6 文件路径规范

> ⚠️ **禁止硬编码文件路径**。测试中涉及文件操作（如 `saveIntoFile`、`saveIntoFileAsync`），必须通过 `abilityDelegatorRegistry` 获取应用沙箱目录。
>
> ```typescript
> // ❌ 错误：硬编码路径在应用沙箱中不可访问
> const testFilePath = '/data/local/tmp/test.png';
> const testFilePath = '/data/storage/el2/base/haps/entry/files/test.png';
>
> // ✅ 正确：通过 AbilityDelegator 获取真实沙箱目录
> import { abilityDelegatorRegistry } from '@kit.TestKit';
> import { common } from '@kit.AbilityKit';
>
> let tempDir: string = '';
>
> beforeAll(() => {
>   const delegator = abilityDelegatorRegistry.getAbilityDelegator();
>   const appContext: common.Context = delegator.getAppContext();
>   tempDir = appContext.tempDir;
> });
>
> // 使用时拼接
> const testFilePath: string = tempDir + '/test.png';
> ```
>
> Context 提供的沙箱目录：
> | 属性 | 说明 | 适用场景 |
> |------|------|---------|
> | `tempDir` | 临时目录，系统可能自动清理 | 测试文件输出 |
> | `filesDir` | 文件目录，持久存储 | 需持久化的文件 |
> | `cacheDir` | 缓存目录 | 缓存文件 |

---

## 七、代码质量检查清单

生成代码后，按以下清单逐项检查：

### 7.1 编译检查

- ✅ 无 `any` 类型使用
- ✅ 无 `Object`/`ESObject` 类型使用
- ✅ 无动态属性访问 `obj['key']`
- ✅ 所有变量有明确类型声明
- ✅ 无 Jest 风格断言（toBe/equal/toThrow/toBeNull/toBeTruthy 等）
- ✅ 断言全部为 `expect(x).assertXxx()` 链式调用（无 `assertTrue(x)`/`assertEqual(a, b)` 裸函数调用）
- ✅ 无向库 API 直传 `null` 实参（用等价 falsy 值覆盖守卫路径并注释依据）
- ✅ 无硬编码文件路径（使用 abilityDelegatorRegistry 获取沙箱目录）
- ✅ 无 `null as SomeType` 不兼容强转
- ✅ 无 `unknown` 关键字使用（包括 `as unknown as` 双重转换，arkts-no-any-unknown）
- ✅ 无 `catch(e) { throw e }` 模式（arkts-limited-throw）
- ✅ hilog 使用 `@kit.PerformanceAnalysisKit` 导入（非 `@ohos.hilog`）
- ✅ 文件扩展名为 `.test.ets`（非 `.ts`）

### 7.2 空值/异常/大数据测试检查

- ✅ 每个可测试接口至少有 1 个空值/null/undefined 输入用例
- ✅ 每个可测试接口至少有 1 个异常参数或边界值输入用例
- ✅ 接受集合类型参数的接口至少有 1 个大数据量输入用例
- ✅ 空值输入用例验证不崩溃 + 验证返回安全默认值
- ✅ 异常/边界值用例验证抛出异常或返回合理处理结果
- ✅ 大数据量用例验证结果正确性（长度/首尾/深层值）+ 不超时 + 不崩溃
- ✅ 大数据量用例的测试数据构建使用类型安全方式（定义 interface，禁止 any/Object）
- ✅ 所有导入路径正确
- ✅ 使用 DevEco MCP `check_ets_files` 工具验证通过

### 7.2 日志检查

- ✅ 所有测试函数开始有 INFO 日志
- ✅ 测试执行结果有 DEBUG 日志
- ✅ 测试失败有 ERROR 日志
- ✅ beforeAll/afterAll 有 INFO 日志
- ✅ 日志格式化参数正确（public/private）
- ✅ DOMAIN 和 TAG 定义正确

### 7.3 注释检查

- ✅ 文件头部有完整注释
- ✅ 每个测试函数有 JSDoc 注释
- ✅ 测试步骤有区块分隔注释
- ✅ 注释内容清晰明了

### 7.4 错误处理检查

- ✅ 预期异常测试使用 try-catch + 布尔标记模式
- ✅ catch 中禁止 `throw e`（arkts-limited-throw）
- ✅ 正常测试不需要 try-catch 包裹
- ✅ null 值输入测试使用 null 检查 + `throw new Error()` 或空对象 mock
- ✅ instanceof 异常类型断言已深层路径导入真实异常类（见 5.5）
- ✅ 文件路径通过 abilityDelegatorRegistry 获取，不硬编码

### 7.5 测试逻辑检查

- ✅ 预期结果断言完整
- ✅ 多接口用例调用顺序正确
- ✅ 测试数据准备充分
- ✅ 边界值覆盖完整

### 7.6 测试隔离检查

- ✅ 单例状态隔离：库使用 `getInstance()` 单例模式时，断言单例状态的用例必须在断言前重置状态
- ✅ 跨用例污染检查：同一测试文件中排在前面的用例是否可能修改了被断言的全局/单例状态
- ✅ `beforeAll` vs `beforeEach`：单例状态重置应使用 `beforeEach`（每个用例前都执行），而非 `beforeAll`（仅执行一次）
- ✅ 初始状态断言守则：断言"初始状态/默认状态"时，必须确认该状态在当前运行环境中确实可达（前面用例未修改）

### 7.7 期望值验证检查

- ✅ 程序化数据期望值：测试数据通过 `for` 循环、取余、映射等程序化方式生成时，期望值必须用表达式计算或手动计算后注释计算过程
- ✅ 取余/循环计算验证：涉及 `%`（取余）操作的测试数据，必须实际计算目标索引处的值（如 `9999 % 256 = 15`），禁止从"循环范围上界"联想
- ✅ 语义联想禁止：禁止从报告描述（如"0-255 循环"、"递增序列"）直接推断具体索引处的期望值，必须基于生成公式计算
- ✅ 计算过程注释：硬编码期望值旁建议添加注释记录计算依据（如 `// 9999 % 256 = 15`）

### 7.8 访问修饰符预检检查

- ✅ Phase 1.5 预检已执行（条件性）：`precheck-access-modifiers.cjs` 脚本已运行（当输入含旧格式规格文档时），`precheck-access-modifiers.json` 已生成
- ✅ private/protected 成员排除清单已建立：所有 `private`/`protected` 属性和方法已记录
- ✅ private/protected 成员已跳过：未为 private/protected 成员生成任何用例
- ✅ 并行 Agent 预检规则已注入：每个 Agent 的 prompt 包含排除清单
- ✅ 无 `Property 'X' is private` 编译错误残留
- ✅ 输入经标准链路生成（xts-doc 已过滤 private/protected）时，可跳过此预检并说明依据

---

## 八、常见编译错误及修复

| 错误 | 常见原因 | 修复方法 |
|------|---------|---------|
| private/protected 访问 | 接口规格未标注访问修饰符，测试代码直接调用 | Phase 1.5 预检排除（已执行时）；残留的删除直接访问或跳过该用例 |
| arkts-no-any | 使用了 any 类型 | 定义具体类型 `interface ResultType { ... }` |
| arkts-no-any-unknown | 使用了 `unknown` 关键字或 `null as unknown as Type` 双重转换 | `unknown` 被完全禁止。改用空但合法的对象（如 `new BleDevice('', '')`）、构造最小字段对象字面量 `as Type`、或 `{} as Type`（不需实际功能的参数） |
| arkts-no-types-in-catch | catch 子句带类型注解 `catch (e: Object)` | `catch (e)` 不带类型注解，e 默认为 Object 类型 |
| Property does not exist on type 'Object' | `as Object` 转型后访问属性 | 保留原始类型不做 `as Object` 转型；或用 `as SpecificType` |
| types have no overlap | 枚举成员直接 `===` 比较 | `(Enum.A as number) !== (Enum.B as number)` |
| arkts-no-untyped-obj-literals | `{}` 赋值给 Object 类型变量 | 定义命名 class/interface，用 `new MockClass()` 代替 `{}` |
| Type 'null' is not assignable to type 'Object' | `null as Object` 转型 | 直接用 `null`，不做 `as Object` 转型 |
| arkts-no-esobj | 使用了 Object 类型 | 定义命名 interface |
| arkts-limited-throw | `throw e` 其中 e 非Error类型 | 仅允许 `throw new Error(msg)`，改用 try-catch + 布尔标记 |
| 类型不兼容 | `null as SomeType` 强转 | 使用 `{} as common.Context` 或 null 检查 + throw new Error |
| 类型推断失败 | 类型定义不明确 | 添加显式类型声明 `const result: number = ...` |
| 导入路径错误 | 库包名不正确 | 检查 `library/index.ets` 的导出路径 |
| 函数签名不匹配 | 参数类型/数量错误 | 检查接口规格文档中的函数签名 |
| 未找到模块 | 模块未安装 | 运行 `ohpm install` 安装依赖 |
| hilog 导入错误 | 使用 `import hilog from '@ohos.hilog'` | 改为 `import { hilog } from '@kit.PerformanceAnalysisKit'` |
| 断言方法不存在 | 使用 Jest 风格如 toBe/toThrow | 改用 hypium 断言：assertEqual/assertNull/assertTrue/assertFalse/assertLarger/assertContain |
| `Cannot find name 'assertTrue'`（批量） | 生成了 `assertTrue(x)`/`assertEqual(a,b)` 裸函数调用而非 `expect(x).assertXxx()` 链式调用（hypium 断言只存在于 expect 对象上） | 脚本批量转换（括号配平、顶层逗号切分双参断言、单参直接包裹）；生成前 prompt 给断言正反例预防 |
| 接口赋值类型不兼容 | `The types returned by 'getX()' are incompatible` + `is missing the following properties from type` —— 库接口方法返回类型声明与实现类不一致（Demo 不暴露，测试首次触达才显现） | 修接口声明对齐实现类实际返回类型（如 `Array<>` 改实际容器类型，属源库机械性修正 ⚠️），禁止在测试中强转绕过 |
| `Argument of type 'null' is not assignable to parameter of type 'string'` | 测试代码向库 API 传 null 实参（库源码 `@ts-nocheck` 不豁免测试文件的严格检查） | 库内部用 `if (x)` 判空时空串/空数组与 null 语义等价，改传等价 falsy 值（如 `new ID3v1Tag('')`）覆盖同一守卫路径并注释等价依据 |
| instanceof 异常类型断言失效/异常类未导出 | 自定义异常类未从 `library/index.ets` 导出，无法 import | 深层路径导入（如 `@ohos/mp3agic/src/main/ets/components/mp3agic/NoSuchTagException`），import 真实类后做 `e instanceof XxxException` |
| 文件路径不可写 | 硬编码 `/data/local/tmp/` 等 | 通过 abilityDelegatorRegistry 获取沙箱 tempDir/filesDir |

---

## 九、测试执行验证流程

### 9.1 编译验证步骤

```
1. 使用 DevEco MCP 的 check_ets_files 工具：
   mcp_deveco-mcp_check_ets_files({ files: ["测试文件路径"] })

2. 若有错误，根据诊断信息修复代码

3. 使用 DevEco MCP 的 build_project 工具编译：
   mcp_deveco-mcp_build_project({ 
     build_intent: "LogVerification", 
     clean: true 
   })

4. 确保编译成功，无 ArkTS 严格模式错误
```

### 9.2 运行验证步骤

```
1. 使用 DevEco MCP 的 start_app 工具运行测试：
   mcp_deveco-mcp_start_app({ 
     hvd: "设备名", 
     module: "entry_test" 
   })

2. 检查测试执行日志：
   - 搜索 "XTS test suite started" 确认套件启动
   - 搜索 "Test XXX passed" 确认各测试通过
   - 搜索 "Test XXX failed" 定位失败测试

3. 若有测试失败：
   - 分析 ERROR 日志中的异常信息
   - 根据失败原因修复测试代码或库实现
   - 重新编译运行验证

4. 确保所有测试用例在目标设备上成功运行
```

---

## 十、Subagent 注入用规则速查

> 以下为 condensed 通用版，用于注入 subagent prompt（见 [SUBAGENT_PROMPT_TEMPLATE.md](SUBAGENT_PROMPT_TEMPLATE.md)）。
> 仅保留最高频违反的规则，完整规则见本文档第一至九节。

### 10.1 断言 API（最高频违反项）

| 场景 | hypium 正确写法 | Jest 错误写法（编译失败） |
|------|----------------|-------------------------|
| 严格相等 | `expect(x).assertEqual(y)` | `toBe`、`toEqual` |
| null 判断 | `expect(x).assertNull()` | `toBeNull`、`assertNotNull` |
| 布尔真 | `expect(x).assertTrue()` | `toBeTruthy` |
| 布尔假 | `expect(x).assertFalse()` | `toBeFalsy` |
| 大于 | `expect(x).assertLarger(y)` | `toBeGreaterThan` |
| 小于（反转方向） | `expect(y).assertLarger(x)` | `toBeLessThan` |
| 包含 | `expect(x).assertContain(y)` | `toContain` |
| undefined | `expect(x).assertUndefined()` | — |
| 非 null | `expect(x !== null).assertTrue()` | `not.toBeNull` |
| 不等于 | `expect(x === y).assertFalse()` | `not.toBe` |
| 抛异常 | `try-catch` + 布尔标记 | `toThrow` |

> ⚠️ `expect()` 对象上**不存在** Jest 风格方法。`assertNotNull` **不存在**于 hypium，用 `expect(x !== null).assertTrue()` 替代。
> ⚠️ **断言必须链式调用**：裸调用 `assertTrue(x)`/`assertEqual(a, b)` 是编译错误（`Cannot find name`），唯一合法形式为 `expect(x).assertXxx()`。

### 10.2 类型禁止速查

| 禁止 | 原因标识 | 替代方案 |
|------|---------|---------|
| `any` | `arkts-no-any` | 具体类型或泛型 `T` |
| `Object` | `arkts-no-esobj` | 定义 `interface` 或使用具体类型 |
| `unknown`（含 `as unknown as T`） | `arkts-no-any-unknown` | 禁止，改用空但合法的对象或系统 API 创建 |
| `ESObject` 作变量声明 | `arkts-limited-esobj` | 仅用于 `null as ESObject as SomeType` 转型 |
| `{ } as Type` 无类型字面量 | `arkts-no-untyped-obj-literals` | `new Class()` 或系统 API 创建 |
| `catch(e: Type)` 类型注解 | `arkts-no-types-in-catch` | `catch(e)` 无注解 |
| `throw e`（e 非 Error 类型） | `arkts-limited-throw` | 仅设标记变量，不 throw |
| `null as SomeType` 直接强转 | 类型不兼容 | 系统 API 创建 或 `null as ESObject as SomeType` |
| 向 `@ts-nocheck` 库 API 传 `null` 实参 | `Argument of type 'null' is not assignable to parameter of type 'string'` | 库内部 `if (x)` 判空时空串/空数组与 null 等价 → 改传等价 falsy 值覆盖同一守卫路径，注释等价依据 |

### 10.3 测试函数格式速查

| 规则 | 正确 | 错误 |
|------|------|------|
| `it()` 参数 | 三参数 `it('name', 0, () => {})` | 省略 `0`（部分设备崩溃） |
| 文件扩展名 | `.test.ets` | `.ts` 或 `.ets` |
| hilog 导入 | `import { hilog } from '@kit.PerformanceAnalysisKit'` | `import hilog from '@ohos.hilog'` |
| 日志格式 | 公开数据 `%{public}s`，敏感数据 `%{private}s` | 禁止敏感信息用 `%{public}s` |
| 文件路径 | `abilityDelegatorRegistry` 获取沙箱 `tempDir` | 硬编码 `/data/local/tmp/` |
| 返回值含 `\| undefined` | `if (result) { ... }` 判空后访问属性 | 直接访问属性 |
| 枚举比较 | `(Enum.A as number) !== (Enum.B as number)` | `Enum.A === Enum.B`（报 overlap） |