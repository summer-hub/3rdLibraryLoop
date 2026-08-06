---
name: tpc-xts-code
description: 基于 XTS 用例描述文档（由 TPCXTSDocSkill 生成）自动生成可在 OpenHarmony ohosTest 系统上编译运行的 XTS 测试用例代码。使用 hypium 测试框架，遵循 ArkTS 编码规范。当用户需要将 XTS 用例描述转化为可执行自动化测试代码时使用此技能。前置技能：TPCXTSCoverageSkill。
license: Apache-2.0
metadata:
  author: AIWeb
  version: "2.0.0"
  category: ohos-testing
---

# TPC XTS 测试代码生成

本 Skill 读取 XTS 用例描述文档（由 TPCXTSDocSkill 生成），为每个用例生成独立的 XTS 测试函数实现代码，使用 OpenHarmony hypium 测试框架。XTS 用例文档的"对应的函数接口"列已自包含完整接口签名，无需额外读取接口规格文档。

> ⚠️ **核心约束**：
> 1. 所有测试代码必须基于 XTS 用例描述文档中真实存在的用例和接口生成，严禁凭空捏造
> 2. 生成的代码必须能够在鸿蒙 ohosTest 系统上编译通过并运行

---

## 适用场景

- 将 `TPCXTSDocSkill` 生成的用例描述文档转化为可执行测试代码
- 为已移植鸿蒙三方库快速生成自动化测试用例
- 生成符合 OpenHarmony XTS 规范的测试代码用于自动化测试

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `sourcePath` | ✅ | 目标鸿蒙工程根目录（含 `entry/` 和测试模块） |
| `outputDir` | ✅ | 输出目录（XTS 用例文档和覆盖率报告所在目录） |
| `interfaceSpecPath` | 可选 | 接口规格文档路径，用于查询依赖类型的完整定义（回调签名、interface/class 区分）；若未提供，从 `outputDir` 搜索 `tpccoverage-interface-spec.md` |
| `xtsDocPath` | 可选 | 单个 XTS 用例文档路径；若未提供，从 `outputDir` 搜索 `*未覆盖接口XTS用例描述*.md` 文件 |

---

## 工作流程

### 阶段零：准备工作

#### 0.1 解析 XTS 用例描述文档

```
执行步骤：
1. read_file 读取 XTS 用例描述文档全文
2. 提取库名称（用于测试文件命名和导入语句）
3. 解析"用例索引表"，提取每个用例的：
   - 用例序号（三位数字）
   - 用例名称
   - 涉及接口列表
   - 模块归属
4. 解析"XTS 用例详细描述"部分，提取每个用例的：
   - 用例名称
   - 用例描述（用于注释）
   - 用例预期结果（用于编写 expect 断言）
   - 对应的函数接口（用于编写测试代码）
5. 统计用例总数，规划生成测试函数列表
```

#### 0.2 用例分类规划

根据解析结果，对用例进行分类，确定每类用例的生成策略：

| 用例类型 | 识别特征 | 生成策略 | 模板参考 |
|---------|---------|---------|---------|
| 正向功能测试 | 验证接口正常行为，预期返回具体值 | 单接口/多接口正向模板 | [TEMPLATE.md 二/三](references/TEMPLATE.md) |
| 多接口协同测试 | 用例涉及多个接口协作完成功能 | 按调用顺序依次调用验证 | [TEMPLATE.md 三](references/TEMPLATE.md) |
| 空值/null/undefined 测试 | 验证空值输入不崩溃 | 空值断言策略 + 空值模板 | [TEMPLATE.md 六](references/TEMPLATE.md) |
| 异常/边界值测试 | 验证非法参数、NaN/Infinity/负值 | 异常断言策略 + 边界值模板 | [TEMPLATE.md 七](references/TEMPLATE.md) |
| 大数据量测试 | 验证大数组/深度嵌套处理 | 大数据断言策略 + 大数据模板 | [TEMPLATE.md 八](references/TEMPLATE.md) |
| 异步测试 | 接口返回 Promise | async/await 模板 | [TEMPLATE.md 九](references/TEMPLATE.md) |

> 各类型的断言设计策略详见 [CODE_STANDARDS.md 七](references/CODE_STANDARDS.md)。

#### 0.3 探查鸿蒙工程结构

```
执行步骤：
1. list_dir 列出工程根目录，识别 entry/、library/ 等模块
2. 检查 entry/src/ohosTest/ 目录是否存在（若不存在需创建）
3. 读取 entry/src/ohosTest/ets/test/ 目录结构（若存在），了解现有测试文件
4. 读取库导出接口：
   - library/Index.ets（HAR 模块）
   - library/src/main/ets/Index.ets（HSP 模块）
   - 或其他可能的导出入口，需根据工程实际情况探查
5. 读取现有测试文件（若存在），了解测试代码风格和导入惯例
6. **确认 deveco-cli 可用**：运行 `devecocli --version` 确认 CLI 已安装且可正常调用
```

#### 0.4 生成文件规划

根据解析结果，建立文件规划表：

```
文件规划（内部工作记录）：
┌──────────────────────────────────────────────────────────────────────┐
│ 测试文件：entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets  │
│                                                                      │
│ 测试函数列表（所有函数在同一文件中）：                                   │
│   chunk_basic_001()      → 用例 001：数组分块基础功能验证             │
│   clamp_range_002()      → 用例 002：数值范围限制功能验证             │
│   clone_shallow_003()    → 用例 003：对象浅拷贝功能验证               │
│   ...                                                                │
│                                                                      │
│ 导入语句：                                                            │
│   import { describe, it, expect, beforeAll, afterAll } from '@ohos/hypium';│
│   import { hilog } from '@kit.PerformanceAnalysisKit';              │
│   import { abilityDelegatorRegistry } from '@kit.TestKit';          │
│   import { common } from '@kit.AbilityKit';                         │
│   import { {ImportedSymbols} } from '{LibraryPackage}';              │
└──────────────────────────────────────────────────────────────────────┘
```

> **多文件策略**：当用例数超过 30 时，建议按模块拆分为多个测试文件（如 `LodashArrayXtsTest.test.ets`、`LodashObjectXtsTest.test.ets`），每个文件不超过 30 个测试函数。

---

### 阶段一：生成 XTS 测试文件框架

#### 1.1 确定测试文件命名

**命名规则**：测试文件统一放在 `entry/src/ohosTest/ets/test/` 目录，文件名格式为 `{LibraryName}XtsTest.test.ets`。

> ⚠️ **扩展名必须为 `.test.ets`**，不能用 `.ts` 或 `.ets`。OpenHarmony XTS 测试框架要求测试文件使用 `.test.ets` 扩展名。

示例映射：

| 库名 | 测试文件名 |
|------|-----------|
| lodash | `LodashXtsTest.test.ets` |
| axios | `AxiosXtsTest.test.ets` |
| blur-kit | `BlurKitXtsTest.test.ets` |

#### 1.2 生成测试文件基础框架

生成测试文件的基础结构，包含导入语句、日志常量、describe 块：

```typescript
/**
 * {LibraryName} XTS 测试用例
 *
 * 基于 XTS 用例描述文档生成，验证 {LibraryName} 的核心功能。
 * 文档来源：ohos_{LibraryName}xts用例描述.md
 *
 * 用例总数：{N}
 * 可测试接口数：{M}
 * 测试函数数：{N}
 *
 * @author lalhan
 */

import { describe, it, expect, beforeAll, afterAll } from '@ohos/hypium';
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

export default function {LibraryName}XtsTest() {
  describe('{LibraryName}XtsTest', () => {
    
    // ─── 测试前准备 ──────────────────────────────────────────────────────
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
    
    // ─── 测试用例区域 ────────────────────────────────────────────────────
    // 此处插入各个测试函数
  });
}
```

> 完整的测试文件及函数模板请参考 [TEMPLATE.md](references/TEMPLATE.md)。

---

### 阶段二：生成各测试用例函数

对每个用例，按以下步骤生成对应的测试函数代码。

#### 2.1 推导测试函数命名

**命名规则**：测试函数名格式为 `{英文功能描述_snake_case}_{序号}`。

示例映射：

| 用例序号 | 用例名称 | 测试函数名 |
|---------|---------|-----------|
| 001 | 数组分块基础功能验证 | `chunk_basic_001` |
| 002 | 数值范围限制功能验证 | `clamp_range_002` |
| 003 | 对象浅拷贝功能验证 | `clone_shallow_003` |
| 007 | 对象属性路径访问与设置验证 | `get_set_path_007` |

关键规则：
- 英文功能描述使用 snake_case（小写字母+下划线）
- 描述简洁，体现核心功能（不超过 20 字符）
- 序号使用三位数字（与用例描述文档对应）
- 多接口用例可合并功能描述（如 `get_set_path`）

#### 2.2 分析预期结果并设计断言

根据用例描述文档中的"用例预期结果"，设计对应的 expect 断言。常见映射：

| 预期结果类型 | 断言方式 | 说明 |
|------------|---------|------|
| 返回值应等于 X | `expect(result).assertEqual(X)` | 严格相等（===）|
| 返回值应包含 X | `expect(result).assertContain(X)` | 包含判断 |
| 返回值应大于 X | `expect(result).assertLarger(X)` | 大于判断 |
| 返回值应为 null | `expect(result).assertNull()` | null 判断 |
| 布尔值为真 | `expect(bool).assertTrue()` | true 判断 |
| 布尔值为假 | `expect(bool).assertFalse()` | false 判断 |
| 应抛出异常 | try-catch + 布尔标记 | 见下方说明 |
| 不应抛出异常 | try-catch 无异常 | 正常执行即通过 |

> ⚠️ **hypium 断言 API 重要约束**：
>
> `@ohos/hypium` 的 `expect()` 对象上**不存在**以下 Jest 风格方法：
> - ❌ `toBe()`, `toEqual()`, `toStrictEqual()` → 使用 `assertEqual()`
> - ❌ `toBeNull()`, `toBeUndefined()` → 使用 `assertNull()`
> - ❌ `toBeTruthy()`, `toBeFalsy()` → 改写为 `expect(x !== null).assertTrue()` / `expect(x).assertFalse()`
> - ❌ `toThrow()` → 改用 try-catch + 布尔标记模式（见下方）
> - ❌ `toBeGreaterThan()`, `toBeLessThan()` → 使用 `assertLarger()`（注意反转比较方向）
> - ❌ `toContain()` → 使用 `assertContain()`
> - ❌ `not.{method}` → 改写为 `expect(条件表达式).assertFalse()`
>
> **`toThrow()` 替代方案（try-catch + 布尔标记模式）**：
>
> ```typescript
> // ❌ 错误：hypium 不支持 toThrow()
> expect(() => func(null)).toThrow();
>
> // ✅ 正确：try-catch + 布尔标记
> let caught: boolean = false;
> try {
>   func(null);
> } catch (e) {
>   caught = true;
> }
> expect(caught).assertTrue();
> ```
>
> **`toBeLessThan()` 替代方案（反转比较方向）**：
>
> ```typescript
> // ❌ 错误：hypium 不支持 toBeLessThan()
> expect(duration).toBeLessThan(10000);
>
> // ✅ 正确：反转比较方向，用 assertLarger
> expect(10000).assertLarger(duration);  // 即 10000 > duration
> ```

> 空值/异常/大数据场景的详细断言策略参见 [CODE_STANDARDS.md 七](references/CODE_STANDARDS.md)。

#### 2.3 逐接口对照规格文档（强制预检）

> ⚠️ **此步骤必须在生成任何测试代码之前执行**，逐接口对照接口规格文档，杜绝凭记忆猜测类型。

对当前测试用例涉及的**每一个接口**，执行以下检查并记录结论：

| 检查项 | 查询来源 | 记录内容 |
|-------|---------|---------|
| **类型种类** | 接口规格文档第 4 章 | `(interface)` — 不可 `new`，用对象字面量；`(class)` — 可 `new`；`@ObservedV2` — 不可用于 `@State` |
| **返回值守卫** | 接口规格文档签名 | 返回类型是否含 `\| undefined` 或 `?:`？若含则调用后必须 `if (result)` 判空再访问属性 |
| **参数类型匹配** | 接口规格文档签名 | 参数是否声明为 `common.UIAbilityContext`？若是则传 `appContext as common.UIAbilityContext`，不可直接传 `common.Context` |
| **回调参数签名** | 接口规格文档回调接口定义 | 回调的每个字段名和参数类型，代码中必须逐字匹配 |
| **属性名准确性** | 接口规格文档第 3 章属性列表 | 该类的所有属性名，代码中只能使用列表内的名称 |
| **枚举成员名** | ① 三方库枚举：`read_file` 库源码 ② 系统SDK枚举：`devecocli docs search <枚举名> --catalog harmonyos-references` → `devecocli docs read <documentId>` | 不做大小写假设，系统枚举查 API 参考文档确认 |
| **import 类型存在性** | `library/Index.ets` | 代码中 `import { X }` 的每个 X 必须在 Index.ets 导出链中；不存在的类型用对象字面量，禁止 import |

> 🚨 **系统 SDK 枚举强制验证（立即执行，不可跳过）**：
>
> 当前用例涉及的**每一个**系统 SDK 枚举，**必须立即运行以下命令**确认成员名，禁止凭记忆猜测：
>
> ```
> devecocli docs search <枚举名> --catalog harmonyos-references
> devecocli docs read <文档ID>
> ```
>
> **未完成此步骤禁止进入 2.4 生成代码。**
>
> 🚨 **第二步：import 类型链强制追踪（立即执行，不可跳过）**：
>
> 代码中 `import { X, Y } from '@ohos/库名'` 的**每一个**类型，必须满足以下流程：
>
> 1. `read_file library/Index.ets` → 列出所有 `export` 的类型名
> 2. 对每个 import 的 X、Y，确认其在导出列表中；不在则**禁止 import**
> 3. 对回调签名中出现的衍生类型，`read_file` 库源码找到定义；
>    未通过 Index.ets 导出的类型用**对象字面量**匹配，**禁止 import**；
>    库源码中也找不到的标记为"不可用"
> 4. 完成后将已验证的类型列表记录到下方
>
> **未完成此步骤禁止进入 2.4 生成代码。**

完成本用例所有接口的对照后，再进入 2.4 生成代码。

#### 2.4 生成测试函数代码

每个测试函数的结构规范：

```typescript
/**
 * 用例 {SEQ}: {用例名称}
 * 用例描述：{从用例描述文档提取的描述}
 * 涉及接口：{涉及的函数签名列表}
 * 预期结果：{预期结果摘要}
 */
it('{英文功能描述_snake_case}_{SEQ}', () => {
  hilog.info(DOMAIN, TAG, 'Test {SEQ} started');

  // 步骤 1：{步骤功能}
  const result = {libraryCall};
  hilog.debug(DOMAIN, TAG, 'Step 1: {步骤功能}, result=%{public}s', String(result));
  expect(result).assertEqual({expectedValue});

  hilog.info(DOMAIN, TAG, 'Test {SEQ} passed');
});
```

> **关于 try-catch 策略**：ArkTS 严格模式下禁止 `throw err`（arkts-limited-throw），因此不建议在每个测试函数内包裹 try-catch 并重新抛出。推荐的错误处理策略：
>
> 1. **正常测试用例**：不包裹 try-catch，直接写测试逻辑。若测试失败，`expect` 断言会自动让测试框架标记失败；若运行时异常，框架也会自动捕获。
> 2. **预期异常测试用例**：使用 try-catch + 布尔标记模式（见上方断言 API 说明），在 catch 中只设标记，**禁止** `throw e`。
> 3. **需要区分步骤的协同测试**：每步可独立 try-catch，但 catch 中**禁止**重新抛出任意类型异常，只记录日志或设置标记。

#### 2.5 多接口协同用例处理

当用例涉及多个接口时，按调用顺序依次调用并验证。每步独立 try-catch，确保失败可定位到具体步骤：

```typescript
it('get_set_path_007', () => {
  hilog.info(DOMAIN, TAG, 'Test 007 started');

  // 步骤 1：设置属性
  const setResult = _.set(obj, 'a.b.c', 1);
  expect(setResult).assertEqual({ a: { b: { c: 1 } } });
  hilog.debug(DOMAIN, TAG, 'Step 1: set completed');

  // 步骤 2：获取属性验证
  const getValue = _.get(obj, 'a.b.c');
  expect(getValue).assertEqual(1);
  hilog.debug(DOMAIN, TAG, 'Step 2: get completed');

  // 步骤 3：协同验证
  expect(_.get(setResult, 'a.b.c')).assertEqual(1);
  hilog.debug(DOMAIN, TAG, 'Step 3: coordination verified');

  hilog.info(DOMAIN, TAG, 'Test 007 passed');
});
```

> 各类型测试函数的完整模板（正向、反向、空值、异常、边界值、大数据、异步、类型判断等）参见 [TEMPLATE.md](references/TEMPLATE.md)。

---

### 阶段三：代码质量保障

> 以下为精简要点，完整的日志规范、注释规范、错误处理规范详见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md)。

#### 3.1 日志规范要点

- 每个测试函数开始/结束必须记录 INFO 日志
- 测试执行结果记录 DEBUG 日志，使用 `%{public}s` 格式化公开数据
- 测试失败记录 ERROR 日志
- DOMAIN 统一使用 `0xD001`，TAG 格式为 `{LibraryName}_XtsTest`

#### 3.2 注释规范要点

- 文件头部必须有 JSDoc 注释（含库名、文档来源、作者）
- 每个测试函数前必须有 JSDoc 注释（含用例序号、名称、描述、涉及接口、预期结果）
- 测试步骤使用区块分隔注释（`// ─── 步骤 N：... ──`）
- 避免过多单行注释影响可读性

#### 3.3 错误处理规范要点

- 所有测试执行体**不建议** try-catch 包裹并重新抛出（违反 arkts-limited-throw）
- 正常测试用例：不包裹 try-catch，让 expect 断言和框架自动处理失败
- 预期异常用例使用 try-catch + 布尔标记模式
- 禁止 `catch(e)` 后 `throw e`（arkts-limited-throw），仅允许 `throw new Error(msg)`
- **`| undefined` 返回值守卫**：签名含 `| undefined` 或 `?:` 的接口调用，返回值可能为 `undefined`。访问其属性前必须显式判空（`if (result) { result.prop }`），否则 ArkTS 严格模式会将类型坍缩为 `never`，导致 `Property does not exist on type 'never'` 编译错误
- **`@ObservedV2` + `@State` 冲突**：`@ObservedV2` 装饰的类不能用于 `@State`/`@Prop`/`@Link`（V1 装饰器），须改用 V2 装饰器（`@Local`/`@Param`）或使用 `!!` 语法
- **组件名/类名准确性**：组件名/类名必须与库 `Index.ets` 导出名逐字符一致，禁止自行追加后缀（如 "V2"、"New"）
- **新增未知错误**：编译失败出现以上规则未覆盖的新错误时，对照接口规格文档+源码分析修复 → 记录模式 → 下次合并到本规则列表

---

### 阶段四：编译与运行验证

#### 4.1 工程迁移（migrate.cjs）

三方库源码多为历史工程，`build-profile.json5` 的 SDK 版本配置、hvigor 文件、oh-package.json5 等经常不兼容当前构建环境。使用 `migrate.cjs` 脚本一次性完成华为官方 Manual Migration 全流程迁移。

1. 执行迁移脚本：

```powershell
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
```

#### 4.2 编译验证（5 轮修复策略）

> 🔴 **必须通过 build.ps1 执行**，直接调用 devecocli build 会导致 session 永久阻塞。
> 测试 HAP 构建需要 -JavaHome 参数（自动设置 JAVA_HOME）。
> 编译是验证生成代码质量的**唯一方式**，源库问题也必须尝试修复——否则隐藏的生成代码错误会传给下游。
> 源库修复仅限**机械性**操作（SDK 版本、依赖、构建配置），不改源库业务逻辑。

##### 首次编译

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "devecocli build --modules entry@ohosTest"
```

编译通过 → 跳转 4.2。

##### 修复循环（最多 5 轮）

每轮：
1. 逐条读取构建日志中的错误
2. **判断错误来源并分级修复**：

**生成代码错误**（文件路径在 `entry/src/ohosTest/ets/test/*.test.ets`）：

| 错误类型 | 修复方式 |
|---------|---------|
| 对照 3.3 规范已知模式 | 按表修复 |
| 接口签名/类型不匹配 | 对照接口规格文档 + 源码 |
| 表外新错误 | 分析 → 修复 → 记录到 3.3 规范 |

**源库错误**（文件路径在 `library/`、entry/src/main/ets/pages/、CMakeLists.txt、hvigorfile.ts、build-profile.json5）：

| 错误类型 | 修复方式 | 可修复？ |
|---------|---------|---------|
| SDK 版本不匹配 | 修正 `build-profile.json5` | ✅ |
| 依赖缺失（如 @ohos/hypium） | 补充 oh-package.json5 | ✅ |
| CMake 选项冲突 | 修改 externalNativeOptions | ✅ |
| 源库 ArkTS 类型错误 | 修正类型注解/补充 @Observed | ⚠️ 仅机械性 |
| 源库业务逻辑错误 | 不修复，标注 | ❌ |

3. 重新编译：

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "devecocli build --modules entry@ohosTest"
```

4. 编译通过 → 跳转 4.3 代码规范自查

**终止判定（立即退出循环）**：

若构建日志中出现以下任一模式，**立即终止修复循环**，不再尝试后续轮次，直接跳转 4.3 代码规范自查：
- 连续 2 轮出现的错误均为源库不可修复错误（❌ 行）

终止后在报告中标注编译跳过原因和修复建议。

##### 降级：5 轮仍失败 / 提前终止

- ⚠️ 编译验证未通过
- 在最终报告中列出：
  - 生成代码未修复的错误 → 标注"需加入 3.3 错误处理规范"
  - 源库不可修复的错误 → 标注"需源库作者修复"
- **任务状态仍为"完成"**（代码生成本身已完成，编译验证因源库问题跳过）

#### 4.3 编译失败常见问题

| 错误类型 | 解决方法 |
|---------|---------|
| arkts-no-any | 定义具体类型或 interface |
| arkts-no-esobj | 定义命名 interface |
| arkts-no-unsafe-cast | 正确定义类型，避免双重 `as unknown as` |
| 导入路径错误 | 检查库导出入口的实际路径 |
| 缺少权限 | 在 ohosTest 的 module.json5 中声明 |

> 完整的编译错误列表及修复方法参见 [CODE_STANDARDS.md 二和八](references/CODE_STANDARDS.md)。

---

### 阶段五：输出与总结

#### 5.1 输出文件

生成的测试文件存放在：

```
entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets
```

#### 5.2 测试套件注册

生成的测试文件需要在 ohosTest 入口文件中注册：

```typescript
// entry/src/ohosTest/ets/test/List.test.ets
import {LibraryName}XtsTest from './{LibraryName}XtsTest.test';

export default function testsuite() {
  {LibraryName}XtsTest();
}
```

> 如果 List.test.ets 已存在，追加新的 import 和调用即可，不要覆盖已有内容。
> **注意**：import 路径不带 `.ets` 扩展名，但保留 `.test` 部分（如 `./LodashXtsTest.test`）。

#### 5.3 测试覆盖率统计

在测试文件末尾添加覆盖率统计注释，格式参见 [TEMPLATE.md 十三](references/TEMPLATE.md) 中"测试覆盖率统计"模板。

#### 5.4 生成XTS代码生成报告

`write_file` `{{outputDir}}/tpccoverage-xts-code-report.md`：

生成完成后，向用户输出以下信息：

​```markdown
## XTS 代码生成完成

### 生成测试文件
| 文件路径 | 说明 |
|---------|------|
| entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets | N 个测试用例 |

### 测试套件注册
已在 `entry/src/ohosTest/ets/test/List.test.ets` 中注册新测试套件。

### 用例统计
- 总用例数：N
- 可测试接口数：M
- 降级/跳过接口数：D（需标注原因）

### 编译验证
{编译结果：通过 / 失败（X 轮修复后）}

### 接口覆盖
| 接口 | 用例编号 | 类型 | 备注 |
|------|---------|------|------|
| interfaceA | 001 | 正向功能 | — |
| ... | ... | ... | ... |

### 验证步骤
1. 在 DevEco Studio 中打开工程，构建完成后右键运行entry/src/ohosTest/ets/test
2. 检查测试执行日志
3. 查看测试文件末尾的覆盖率统计注释
​```

---

### 3.4 ArkTS 类型安全规范

| 规范 | 错误标识 | 正确做法 |
|------|---------|---------|
| 禁止 `null as SomeType` 强转 | arkts-limited-throw / 类型不兼容错误 | `{} as common.Context`（用于不需要实际功能的参数如 processRenderScript 的 context）|
| 禁止 `catch(e)` 后 `throw e` | arkts-limited-throw | 仅 `throw new Error(msg)` 合法；用 try-catch + 布尔标记替代 |
| 禁止 `undefined as SomeType` | 类型不兼容错误 | 使用 null 检查 + `throw new Error()` 或安全默认值 |
| 禁止 `any` 类型 | arkts-no-any | 定义具体 interface 或使用泛型 |

### 3.5 文件路径规范

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

## 参考文档

| 文档 | 内容说明 |
|------|---------|
| [CODE_STANDARDS.md](references/CODE_STANDARDS.md) | 编码规范完整参考：文件命名、ArkTS 禁止项、日志/注释/错误处理规范、hypium 框架使用、编译错误修复、代码质量检查清单 |
| [TEMPLATE.md](references/TEMPLATE.md) | 各类型测试函数模板：正向测试、多接口协同、反向测试（参数/状态异常）、空值测试、异常/边界值测试、大数据量测试、异步测试、类型判断测试、覆盖率统计 |
| [EXAMPLES.md](references/EXAMPLES.md) | 基于 lodash 的完整示例：输入文档片段、生成的完整测试代码、编译运行验证、覆盖率统计 |
- hypium 测试框架使用指南