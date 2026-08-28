# XTS 测试代码模板

本文档提供 ArkTS XTS 测试代码生成时使用的标准模板，包含测试文件模板、测试函数模板、异步测试模板、多接口协同测试模板等。

> ⚠️ **核心规范**：
> - `it()` 必须使用三参数格式 `it(name, 0, () => {})` — 省略 filter 部分设备崩溃
> - 断言 API 必须使用 hypium 专用方法（`assertEqual`/`assertNull`/`assertTrue`/`assertFalse`/`assertLarger`/`assertContain`），**禁止** Jest 风格（`toBe`/`toEqual`/`toBeTruthy`/`toThrow` 等）
> - hilog 导入：`import { hilog } from '@kit.PerformanceAnalysisKit'`（禁止 `import hilog from '@ohos.hilog'`）
> - 文件扩展名：`.test.ets`（禁止 `.ts`）
> - 禁止 `catch(e) { throw e }`（arkts-limited-throw），正常测试不包裹 try-catch
> - 文件路径通过 `abilityDelegatorRegistry` 获取沙箱目录，禁止硬编码

---

## 一、测试文件基础模板

完整的 XTS 测试文件结构模板：

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

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@ohos/hypium';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { abilityDelegatorRegistry } from '@kit.TestKit';
import { common } from '@kit.AbilityKit';
import { {ImportedSymbols} } from '{LibraryPackage}';

// ─── 日志常量 ──────────────────────────────────────────────────────────────
const DOMAIN: number = 0xD001;
const TAG: string = '{LibraryName}_XtsTest';

// ─── 全局测试上下文 ──────────────────────────────────────────────────────────
/** 测试用临时目录（由 beforeAll 从 AbilityDelegator 获取真实 Context） */
let tempDir: string = '';

/**
 * {LibraryName} XTS 测试套件
 *
 * 验证 {LibraryName} 的以下功能模块：
 *   - 模块 A：{功能描述}
 *   - 模块 B：{功能描述}
 */
export default function {LibraryName}XtsTest() {
  describe('{LibraryName}XtsTest', () => {

    // ─── 测试套件生命周期 ────────────────────────────────────────────────

    beforeAll(() => {
      // 通过 AbilityDelegator 获取应用真实 Context，以访问沙箱临时目录
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const appContext: common.Context = delegator.getAppContext();
      tempDir = appContext.tempDir;
      hilog.info(DOMAIN, TAG, 'XTS test suite started, tempDir=%{public}s', tempDir);
    });

    afterAll(() => {
      hilog.info(DOMAIN, TAG, 'XTS test suite finished');
    });

    // ─── 测试用例区域 ──────────────────────────────────────────────────────

    // 此处插入各个测试函数（见后续模板）

  });
}
```

---

## 二、单接口正向测试

适用于单个接口的基础功能验证测试：

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：{从用例描述文档提取的详细描述}
     * 涉及接口：{接口签名}
     * 预期结果：
     *   1. {预期结果 1}
     *   2. {预期结果 2}
     */
    it('{function_snake_case}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 测试数据准备 ────────────────────────────────────────────────────
      const inputData = { ... };  // 准备测试输入数据
      const expectedOutput = { ... };  // 准备预期输出

      // ─── 测试执行 ────────────────────────────────────────────────────────
      const result = {LibraryCall(inputData)};
      hilog.debug(DOMAIN, TAG, 'Result: %{public}s', JSON.stringify(result));

      // ─── 断言验证 ──────────────────────────────────────────────────────
      expect(result).assertEqual(expectedOutput);

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

> **关于 try-catch 策略**：ArkTS 严格模式下禁止 `throw err`（arkts-limited-throw），因此正常测试不建议包裹 try-catch。`expect` 断言失败会自动让测试框架标记失败，运行时异常也会被框架捕获。

---

## 三、多接口协同测试

适用于多个接口协同完成功能流程的测试：

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：验证多个接口的协同工作能力，确保接口间调用顺序和状态传递正确
     * 涉及接口：
     *   - {接口 1 签名}（作用：{接口 1 作用}）
     *   - {接口 2 签名}（作用：{接口 2 作用}）
     * 预期结果：
     *   1. {接口 1 执行后状态}
     *   2. {接口 2 执行后状态}
     *   3. {协同验证结果}
     */
    it('{functions_snake_case}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 步骤 1：{接口 1 功能} ──────────────────────────────────────────────
      const {objName} = {初始状态};
      const {step1Result} = {接口 1 调用};
      hilog.debug(DOMAIN, TAG, 'Step 1 result: %{public}s', JSON.stringify({step1Result}));
      expect({step1Result}).assertEqual({预期结果 1});

      // ─── 步骤 2：{接口 2 功能} ──────────────────────────────────────────────
      const {step2Result} = {接口 2 调用};
      hilog.debug(DOMAIN, TAG, 'Step 2 result: %{public}s', String({step2Result}));
      expect({step2Result}).assertEqual({预期结果 2});

      // ─── 步骤 3：协同验证 ────────────────────────────────────────────────
      expect({协同验证表达式}).assertEqual({预期协同结果});

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

---

## 四、空值/null/undefined 输入测试

适用于验证接口对空值输入的处理测试：

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：验证接口对 null/undefined/空值输入的处理能力，确保空值不会导致崩溃
     * 涉及接口：{接口签名}
     * 预期结果：
     *   1. 输入 null 时，应抛出异常或返回安全默认值
     *   2. 输入空数组/空字符串/空对象时，应返回空结果或安全默认值
     *   3. 所有空值输入不应导致崩溃或不可预期行为
     */
    it('{function_null_input}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 测试 1：null 输入（预期抛异常） ──────────────────────────────────────
      let caught1: boolean = false;
      try {
        {接口调用(null 或 null 等效值)};
      } catch (e) {
        caught1 = true;
      }
      expect(caught1).assertTrue();
      hilog.debug(DOMAIN, TAG, 'Null input handled correctly (exception thrown)');

      // ─── 测试 2：null 输入（预期返回安全默认值） ─────────────────────────────
      const result2 = {接口调用(null 或 null 等效值)};
      expect(result2).assertNull();  // 或 .assertEqual({安全默认值})
      hilog.debug(DOMAIN, TAG, 'Null input result: %{public}s', String(result2));

      // ─── 测试 3：空集合输入（空数组/空字符串/空对象）───────────────────────
      const result3 = {接口调用([])};  // 或 '' 或 {}
      hilog.debug(DOMAIN, TAG, 'Empty collection result: %{public}s', JSON.stringify(result3));
      expect(result3).assertEqual({预期空结果});  // 如 []、''、{} 或 null

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

> **null 输入处理策略**：
> - 若参数类型允许 null，直接传入 null
> - 若参数类型不允许 null（ArkTS 严格类型），使用 `{} as SomeType` 作为空对象 mock（仅当库不实际使用该参数时）
> - 若需要验证 null 拒绝，用 try-catch + 布尔标记模式

---

## 五、异常参数与边界值测试

适用于验证接口对异常参数和边界值的处理测试：

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：验证接口对异常参数（类型不匹配、超限值）和边界值（NaN、Infinity、负值、零值）的处理能力
     * 涉及接口：{接口签名}
     * 预期结果：
     *   1. 类型不匹配参数应抛出异常或返回错误码
     *   2. 超限值应被合理处理（clamp 到范围或抛出异常）
     *   3. NaN/Infinity/负值/零值应返回预期结果或抛出异常
     *   4. 所有异常处理不应导致崩溃
     */
    it('{function_exception_boundary}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 测试 1：类型不匹配参数（预期抛异常） ──────────────────────────────
      let caught1: boolean = false;
      try {
        {接口调用({类型不匹配值})};
      } catch (e) {
        caught1 = true;
      }
      expect(caught1).assertTrue();
      hilog.debug(DOMAIN, TAG, 'Type mismatch handled correctly');

      // ─── 测试 2：特殊值 NaN ────────────────────────────────────────────────
      const result2 = {接口调用(NaN)};
      hilog.debug(DOMAIN, TAG, 'NaN input result: %{public}s', String(result2));
      expect(Number.isNaN(result2)).assertTrue();  // 或 expect(result2).assertEqual({默认值})

      // ─── 测试 3：特殊值 Infinity ────────────────────────────────────────────
      const result3 = {接口调用(Infinity)};
      hilog.debug(DOMAIN, TAG, 'Infinity input result: %{public}s', String(result3));
      expect(result3).assertEqual({预期结果});

      // ─── 测试 4：负值/零值 ──────────────────────────────────────────────────
      const result4 = {接口调用({负值或零值})};
      hilog.debug(DOMAIN, TAG, 'Negative/zero input result: %{public}s', String(result4));
      expect(result4).assertEqual({预期结果});

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

---

## 六、反向测试（状态异常）

适用于验证接口在异常状态下的行为测试：

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：验证接口在未初始化状态下的调用行为
     * 涉及接口：{接口签名}
     * 前置条件：{正常前置条件}（本测试故意不满足）
     * 预期结果：
     *   1. 在未满足前置条件时调用，应抛出异常或返回错误码
     *   2. 不应导致崩溃或不可预期行为
     */
    it('{function_state_error}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 测试场景：未初始化状态调用 ──────────────────────────────────────
      // 不调用初始化方法，直接调用执行方法
      let caught: boolean = false;
      try {
        {执行接口调用()};
      } catch (e) {
        caught = true;
      }
      expect(caught).assertTrue();
      hilog.debug(DOMAIN, TAG, 'Uninitialized call handled correctly');

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

---

## 七、大数据量测试

适用于验证接口在大数据量输入下的处理能力和性能：

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：验证接口在大数据量输入（大数组、深度嵌套、大量属性）下的处理能力
     * 涉及接口：{接口签名}
     * 预期结果：
     *   1. 大数据量输入应正确处理，返回值结构与预期一致
     *   2. 操作应在合理时间内完成（建议 5 秒内）
     *   3. 不应发生内存溢出、栈溢出或崩溃
     *   4. 大数据量操作的结果准确性可验证（如首尾元素、深层值）
     */
    it('{function_large_data}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 准备大数据量测试数据 ────────────────────────────────────────────
      const largeArray: number[] = [];
      for (let i = 0; i < 10000; i++) {
        largeArray.push(i);
      }
      // 生成深度嵌套对象（10+ 层）需定义逐层嵌套的 interface 类型
      // 生成大量属性对象（1000+ 属性）需用类型安全的方式构建

      // ─── 测试 1：大数组处理 ────────────────────────────────────────────────
      const startTime1: number = Date.now();
      const result1 = {接口调用(largeArray)};
      const duration1: number = Date.now() - startTime1;
      hilog.debug(DOMAIN, TAG, 'Large array result length: %{public}d, duration: %{public}d ms', result1.length, duration1);

      // 验证结果正确性（长度、首尾元素）
      expect(result1.length).assertEqual({预期长度});
      expect(result1[0]).assertEqual({预期首元素});
      expect(result1[result1.length - 1]).assertEqual({预期尾元素});
      // 验证不超时（5 秒内完成）—— 反转比较方向：5000 > duration
      expect(5000).assertLarger(duration1);

      // ─── 测试 2：深度嵌套结构处理 ──────────────────────────────────────────
      // 构建深度嵌套对象（使用类型安全的方式，避免 any/Object）
      const deepNestedObj: {DeepNestedType} = {构建深度嵌套数据};
      const startTime2: number = Date.now();
      const result2 = {接口调用(deepNestedObj)};
      const duration2: number = Date.now() - startTime2;
      hilog.debug(DOMAIN, TAG, 'Deep nested result duration: %{public}d ms', duration2);

      // 验证深层拷贝完整性
      expect({深层属性访问}).assertEqual({预期深层值});
      // 验证不超时 —— 反转比较方向：5000 > duration
      expect(5000).assertLarger(duration2);
      // 验证不崩溃（能执行到这里即说明未崩溃）

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

> ⚠️ **大数据测试注意事项**：
> 1. ArkTS 禁止 `any`/`Object` 类型，构建大数据结构必须使用类型安全的方式（定义 interface 或具体类型）
> 2. 生成大数组推荐使用 `for` 循环逐个 push，避免使用动态构造
> 3. 深度嵌套对象需定义逐层嵌套的 interface 类型
> 4. 性能断言使用 `expect(5000).assertLarger(duration)` 验证操作在 5 秒内完成（反转比较方向）
> 5. 大数据测试建议放在测试文件末尾，与正向/反向测试分组区分
> 6. **期望值必须程序化计算**：当大数据通过 `arr[i] = f(i)` 生成时，首尾元素的期望值必须用 `f(0)` 和 `f(lastIndex)` 计算或表达式表示，禁止硬编码。例如 `arr[i] = i % 256`，`arr[9999]` 的期望值应写为 `expect(arr[9999]).assertEqual(9999 % 256)` 而非 `255`。

---

## 八、异步测试

适用于验证异步接口的测试：

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：验证异步接口的正确性
     * 涉及接口：{接口签名}（返回 Promise）
     * 预期结果：
     *   1. Promise resolve 后，结果应为 {预期结果}
     *   2. Promise 不应 reject
     */
    it('{async_function}_{SEQ}', 0, async () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 异步测试执行 ────────────────────────────────────────────────────
      const result = await {异步接口调用()};
      hilog.debug(DOMAIN, TAG, 'Async result: %{public}s', JSON.stringify(result));

      // ─── 断言验证 ──────────────────────────────────────────────────────
      expect(result).assertEqual({预期结果});

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

> ⚠️ **同步方法内部委托异步方法的陷阱**：若库的某个同步方法（如 `saveIntoFile`）内部实际委托给异步方法（如 `saveIntoFileAsync`），则测试时必须使用 `async` 函数 + `await` 调用异步版本，否则异步操作尚未完成就执行了后续断言。

**超时验证变体**（在异步测试中附加执行时间断言）：

```typescript
    it('{async_timeout}_{SEQ}', 0, async () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ} started (async with timeout)');

      const startTime = Date.now();

      const result = await {异步接口调用()};
      const duration = Date.now() - startTime;

      // 验证结果正确性
      expect(result).assertEqual({预期结果});

      // 验证执行时间在合理范围内 —— 反转比较方向：5000 > duration
      expect(5000).assertLarger(duration);

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed, duration: %{public}dms', duration);
    });
```

---

## 九、类型判断测试

适用于验证类型判断接口的测试：

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：验证类型判断接口对不同类型值的判断准确性
     * 涉及接口：{类型判断接口签名}
     * 预期结果：
     *   1. 输入 {类型 A} 时，应返回 true
     *   2. 输入 {类型 B} 时，应返回 false
     */
    it('{is_type}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 正向测试：输入目标类型 ──────────────────────────────────────────
      const trueResult = {类型判断接口({目标类型值})};
      expect(trueResult).assertTrue();
      hilog.debug(DOMAIN, TAG, 'True test passed');

      // ─── 反向测试：输入非目标类型 ────────────────────────────────────────
      const falseResult = {类型判断接口({非目标类型值})};
      expect(falseResult).assertFalse();
      hilog.debug(DOMAIN, TAG, 'False test passed');

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

---

## 十、需要 Mock 数据的测试模板

```typescript
    /**
     * 用例 {SEQ}: {用例名称}（需 Mock）
     *
     * 测试前提：需准备模拟数据或使用测试服务器
     */
    it('{mock_function}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ} started (with mock data)');

      // ─── 准备 Mock 数据 ────────────────────────────────────────────────────
      const mockData = {
        status: 200,
        data: { id: 1, name: 'test' }
      };
      const mockUrl = 'http://test-server.mock/api';

      // 使用 Mock 数据验证接口逻辑
      const result = {接口调用(mockUrl)};
      expect(result.status).assertEqual(mockData.status);
      expect(result.data).assertEqual(mockData.data);

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

---

## 十一、降级测试（接口不可导入）

> 当接口类型被标记为「未导出」或「ESObject 阻断」时使用此模板。
> 仅测试 getter 初始状态，setter 标注不可测试原因。

### 11.1 setter 参数不可导入 — 仅测试 getter

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     * 涉及接口：{仅列出可测试的 getter 接口}
     * 降级说明：{UnimportableType} {未导出/ESObject阻断}，setXxx() 不可测试
     * 预期结果：
     *   1. getXxx() 初始返回 null/默认值
     */
    it('{name}_degraded_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} (降级) started');

      const obj = new TestableSubclass();
      expect(obj.getXxx()).assertNull();
      // setXxx({UnimportableType}) 不可测试：{UnimportableType} {未导出/ESObject阻断}

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

### 11.2 构造器参数含不可导入类型 — 使用 SDK Mock 替代

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     * 降级说明：构造器参数 {UnimportableType} 不可导入，使用 {SDKMockMethod} 创建 Mock 对象
     * 预期结果：
     *   1. 构造成功，getXxx() 返回预期值
     */
    it('{name}_mock_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} (Mock 降级) started');

      const mockParam = ble.createGattClientDevice('mock-device-id');
      const obj = new TargetClass(mockParam, {numberParam});
      expect(obj.getXxx()).assertEqual({预期值});
      hilog.debug(DOMAIN, TAG, 'Result: %{public}s', String(obj.getXxx()));

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

### 11.3 getter 返回不可导入类型 — 仅验证初始 null

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     * 降级说明：getXxx() 返回类型 {UnimportableType} 不可导入，仅验证初始 null 状态
     * 预期结果：
     *   1. getXxx() 初始返回 null
     */
    it('{name}_getter_only_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} (getter-only 降级) started');

      const obj = new TestableSubclass();
      expect(obj.getXxx()).assertNull();
      hilog.debug(DOMAIN, TAG, 'getXxx initial null: %{public}s', String(obj.getXxx() === null));

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

---

## 十二、interface 实例化模板

> ⚠️ interface 类型禁止 `new`（见 [CODE_STANDARDS.md 二](CODE_STANDARDS.md)）

### 12.1 interface 对象字面量

```typescript
    // ✅ 正确：interface 用对象字面量赋值
    const headerOpt: HeaderOptions = { key: 'Accept', value: '*/*' };

    // ❌ 错误：interface 不能 new
    // const headerOpt = new HeaderOptions();
```

### 12.2 implements 实现类

```typescript
    // ✅ 正确：interface 用 implements 实现类
    class TestCallback implements OnLoadCallBack {
      onLoadSuccess: (data: ImageInfo) => void = (data: ImageInfo) => {
        hilog.debug(DOMAIN, TAG, 'onLoadSuccess: %{public}s', JSON.stringify(data));
      };
      onLoadFailed: (err: ErrorInfo) => void = (err: ErrorInfo) => {
        hilog.error(DOMAIN, TAG, 'onLoadFailed: %{public}s', JSON.stringify(err));
      };
    }

    const callback: OnLoadCallBack = new TestCallback();
    option.onLoadListener = callback;
```

### 12.3 嵌套 interface 属性赋值

```typescript
    // ✅ 正确：通过嵌套 interface 对象设置（接口属性为对象时整体赋值）
    const option = new ImageKnifeOptionV2();
    option.onLoadListener = {
      onLoadSuccess: (data: ImageInfo) => { ... },
      onLoadFailed: (err: ErrorInfo) => { ... },
    };

    // ❌ 错误：直接赋值嵌套属性
    // option.onLoadSuccess = (data) => { ... };  // onLoadSuccess 不是直接属性
```

---

## 十三、测试套件注册模板

测试套件需要在 ohosTest 的入口文件中注册：

```typescript
// entry/src/ohosTest/ets/test/List.test.ets

import {LibraryName}XtsTest from './{LibraryName}XtsTest.test';
import {OtherLibrary}XtsTest from './{OtherLibrary}XtsTest.test';

export default function testsuite() {
  {LibraryName}XtsTest();
  {OtherLibrary}XtsTest();
}
```

> **注意**：import 路径不带 `.ets` 扩展名，但保留 `.test` 部分（如 `'./LodashXtsTest.test'`）。

---

## 十四、测试覆盖率统计注释

在测试文件末尾添加覆盖率统计注释：

```typescript
/**
 * ─── 测试覆盖率统计 ──────────────────────────────────────────────────────
 *
 * 用例总数：{N}
 * 可测试接口数：{M}
 * 测试函数数：{K}
 *
 * 功能模块覆盖：
 *   - {模块 A}：{X} 个用例（{接口列表}）- 100% 覆盖
 *   - {模块 B}：{Y} 个用例（{接口列表}）- 100% 覆盖
 *
 * 测试类型分布：
 *   - 正向功能测试：{X} 个（{%}）
 *   - 多接口协同测试：{X} 个（{%}）
 *   - 空值输入测试：{X} 个（{%}）
 *   - 异常/边界值测试：{X} 个（{%}）
 *   - 大数据量测试：{X} 个（{%}）
 */
```

---

## 十五、外部硬件/服务依赖接口测试模板

适用于接口依赖真实硬件（BLE/NFC/传感器/定位等）或外部服务，测试环境无法提供真实设备的场景。
核心策略：try-catch 验证不崩溃 + 可选状态预检 + 链式返回判空。

```typescript
    /**
     * 用例 {SEQ}: {用例名称}
     *
     * 用例描述：验证 {接口名} 在无真实硬件环境下的健壮性，确保不崩溃
     * 涉及接口：{接口签名}（依赖 BLE/NFC/传感器等硬件）
     * 预期结果：
     *   1. 无硬件时调用应安全失败或返回默认值，不崩溃
     *   2. 返回值若为 null/false 属于预期行为（硬件不可用）
     */
    it('{hardware_func}_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: {用例名称} started');

      // ─── 可选：硬件状态预检 ────────────────────────────────────────────
      // 若库提供 isXxxEnabled() 方法，先查询当前硬件状态
      // let hardwareAvailable: boolean = false;
      // try {
      //   hardwareAvailable = SomeManager.getInstance().isBlueEnable();
      // } catch (e) { /* 硬件查询失败也视为不可用 */ }
      // hilog.debug(DOMAIN, TAG, 'Hardware available: %{public}s', String(hardwareAvailable));

      // ─── 硬件依赖调用（try-catch 验证不崩溃）────────────────────────────
      let caught: boolean = false;
      let result: boolean = false;
      try {
        // 调用依赖硬件的接口（如 scan/connect/enableBluetooth）
        result = SomeManager.getInstance().startScan();
      } catch (e) {
        caught = true;
      }

      // 断言：不崩溃即通过（caught 为 true 或 false 均可接受）
      // 若返回值为 boolean，额外验证类型正确
      expect(typeof result === 'boolean').assertTrue();
      hilog.debug(DOMAIN, TAG, 'Hardware call result: caught=%{public}s, result=%{public}s', String(caught), String(result));

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });
```

> **适用场景分类**：
> - 纯硬件操作（scan/connect/enable）：try-catch + 布尔标记验证不崩溃
> - 回调透传：注入 Mock 实现验证回调标志（见 XTS_TEMPLATE.md 十二 implements 模板）
> - 链式返回：验证返回值非 null（`expect(result !== null).assertTrue()`）+ instanceof 判断
> - 状态查询：先 reset 再断言状态值（见 XTS_TEMPLATE.md 十六 单例状态隔离）

---

## 十六、单例状态隔离模板（beforeEach 重置）

适用于库使用单例模式（含 `getInstance()` 静态方法）且实例状态跨用例持久化的场景。
在 `beforeEach` 中调用 reset/stop 方法重置单例状态，防止前序用例污染后续断言。

```typescript
export default function {LibraryName}XtsTest() {
  describe('{LibraryName}XtsTest', () => {

    beforeAll(() => {
      // 全局初始化（仅执行一次）
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const appContext: common.Context = delegator.getAppContext();
      tempDir = appContext.tempDir;
      hilog.info(DOMAIN, TAG, 'XTS test suite started, tempDir=%{public}s', tempDir);
    });

    // ─── 单例状态重置（每个用例前执行）──────────────────────────────────
    beforeEach(() => {
      // 调用库提供的 reset/stop 方法将单例恢复到已知初始状态
      // 用 try-catch 包裹：若单例尚未初始化或 reset 方法抛异常，不影响后续用例
      try { SomeManager.getInstance().stopScan() } catch (e) {}
      try { SomeManager.getInstance().stopLeScan() } catch (e) {}
      // 可选：重置其他单例
      // try { OtherManager.getInstance().reset() } catch (e) {}
    });

    afterEach(() => {
      hilog.info(DOMAIN, TAG, 'Test case finished');
    });

    // ─── 测试用例 ────────────────────────────────────────────────────────

    /**
     * 用例 {SEQ}: 单例初始状态验证
     *
     * 用例描述：验证单例在 beforeEach 重置后处于初始状态
     * 涉及接口：SomeManager.getInstance().getScanState()
     * 预期结果：
     *   1. beforeEach 重置后 getScanState() 返回 STATE_IDLE
     */
    it('singleton_initial_state_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: singleton initial state started');

      // beforeEach 已调用 stopScan()，此时状态应为 IDLE
      const state: number = SomeManager.getInstance().getScanState();
      expect(state).assertEqual(0); // STATE_IDLE = 0
      hilog.debug(DOMAIN, TAG, 'Singleton state after reset: %{public}d', state);

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });

    /**
     * 用例 {SEQ}: 单例状态变更后验证
     *
     * 用例描述：验证调用 startScan() 后状态变更为 SCANNING
     * 涉及接口：SomeManager.getInstance().startScan() / getScanState()
     * 预期结果：
     *   1. startScan() 后 getScanState() 返回 STATE_SCANNING
     */
    it('singleton_after_start_{SEQ}', 0, () => {
      hilog.info(DOMAIN, TAG, 'Test {SEQ}: singleton state after start started');

      // beforeEach 已重置，从已知初始状态开始
      try { SomeManager.getInstance().startScan() } catch (e) {}
      const state: number = SomeManager.getInstance().getScanState();
      expect(state).assertEqual(1); // STATE_SCANNING = 1
      hilog.debug(DOMAIN, TAG, 'Singleton state after start: %{public}d', state);

      hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
    });

  });
}
```

> **降级策略**：若库未提供 reset/stop 方法（无法重置单例状态），改为断言"调用某方法后的状态"而非"初始状态"。
> 例如，不验证 `getScanState() == STATE_IDLE`，改为验证 `startScan()` 后 `getScanState() == STATE_SCANNING`，
> 避免因前序用例已修改状态而导致"初始状态"断言不稳定。
