---
name: arkts-library-xts-code
description: 基于 XTS 用例描述文档（由 ArkTsLibraryXTSDocSkill 生成）自动生成可在 Harmony ohosTest 系统上编译运行的 XTS 测试用例代码。使用 hypium 测试框架，遵循 ArkTS 编码规范。当需要将 XTS 用例描述转化为可执行自动化测试代码时使用。关键词：ArkTS、XTS、hypium、ohosTest、OpenHarmony。
license: Apache-2.0
compatibility: 需要 devecocli CLI（编译/静态检查/文档检索）、ohpm（依赖管理）、PowerShell（build.ps1）、hvigor 构建环境；MCP Gateway 运行中（script_deveco_docs 工具）
metadata:
  author: AIWeb
  version: "2.2.0"
  category: ohos-testing
  language: ArkTS/ETS
---

# ArkTS XTS 测试代码生成

读取 XTS 用例描述文档（由 ArkTsLibraryXTSDocSkill 生成），为每个用例生成独立的 XTS 测试函数代码，使用 OpenHarmony hypium 测试框架。用例文档的"对应的函数接口"列已自包含完整接口签名，无需额外读取接口规格文档。

> ⚠️ **核心约束**：
> 1. 所有测试代码必须基于 XTS 用例描述文档中真实存在的用例和接口生成，严禁凭空捏造
> 2. 生成的代码必须能够在鸿蒙 ohosTest 系统上编译通过并运行

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sourcePath` | string | ✅ | 目标鸿蒙工程根目录（含 `entry/` 和测试模块） |
| `outputDir` | string | ✅ | 输出目录（XTS 用例文档和覆盖率报告所在目录） |
| `skillDir` | string | ✅ | 本 SKILL 脚本目录绝对路径（`build.ps1`/`code-linter.cjs`/`migrate.cjs`/`ohpm-switch.cjs` 所在目录） |
| `interfaceSpecPath` | string | ❌ | 接口规格文档路径，用于查询依赖类型完整定义；未提供则从 `outputDir` 搜索 `arktscoverage-interface-spec.md` |
| `xtsDocPath` | string | ❌ | XTS 用例文档路径；未提供则从 `outputDir` 搜索 `*未覆盖接口XTS用例描述*.md` |

---

## 输入依赖

- **前置 SKILL**：ArkTsLibraryXTSDocSkill（生成 XTS 用例描述文档）
- **输入文件**：XTS 用例描述文档（`*未覆盖接口XTS用例描述*.md`）、接口规格文档（`arktscoverage-interface-spec.md`，可选）

---

## 工作流程概览

```
Phase 1: 准备工作（解析用例文档 → 分类 → 探查工程 → 文件规划）
    ↓
Phase 2: 生成测试文件框架
    ↓
Phase 3: 逐用例生成测试函数（命名 → 断言 → 接口预检 → 代码 → 隔离检查）
    ↓
Phase 4: 代码质量保障
    ↓
Phase 5: 编译与运行验证
    ↓
Phase 6: 输出与总结
```

---

## Phase 1：准备工作

#### 1.1 解析 XTS 用例描述文档

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

#### 1.2 用例分类规划

根据解析结果，对用例进行分类，确定每类用例的生成策略：

| 用例类型 | 识别特征 | 生成策略 | 模板参考 |
|---------|---------|---------|---------|
| 正向功能测试 | 验证接口正常行为，预期返回具体值 | 单接口/多接口正向模板 | [XTS_TEMPLATE.md 二/三](references/XTS_TEMPLATE.md) |
| 多接口协同测试 | 用例涉及多个接口协作完成功能 | 按调用顺序依次调用验证 | [XTS_TEMPLATE.md 三](references/XTS_TEMPLATE.md) |
| 空值/null/undefined 测试 | 验证空值输入不崩溃 | 空值断言策略 + 空值模板 | [XTS_TEMPLATE.md 七](references/XTS_TEMPLATE.md) |
| 异常/边界值测试 | 验证非法参数、NaN/Infinity/负值 | 异常断言策略 + 边界值模板 | [XTS_TEMPLATE.md 八](references/XTS_TEMPLATE.md) |
| 大数据量测试 | 验证大数组/深度嵌套处理 | 大数据断言策略 + 大数据模板 | [XTS_TEMPLATE.md 九](references/XTS_TEMPLATE.md) |
| 异步测试 | 接口返回 Promise | async/await 模板 | [XTS_TEMPLATE.md 十](references/XTS_TEMPLATE.md) |

> 各类型的断言设计策略详见 [CODE_STANDARDS.md 七](references/CODE_STANDARDS.md)。

#### 1.3 探查鸿蒙工程结构

1. `list_dir` 列出工程根目录，识别 `entry/`、`library/` 等模块
2. 检查 `entry/src/ohosTest/` 目录是否存在（若不存在需创建）
3. 读取库导出接口：`library/Index.ets`（HAR）或 `library/src/main/ets/Index.ets`（HSP）
4. 读取现有测试文件（若存在），了解测试代码风格和导入惯例
5. **确认 deveco-cli 可用**：运行 `devecocli --version`

#### 1.4 生成文件规划

建立内部文件规划记录：测试文件路径 `entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets`、测试函数命名列表、导入语句清单。

> **多文件策略**：当用例数超过 30 时，按模块拆分为多个测试文件，每个文件不超过 30 个测试函数。

---

### Phase 2：生成 XTS 测试文件框架

#### 2.1 确定测试文件命名

**命名规则**：测试文件统一放在 `entry/src/ohosTest/ets/test/` 目录，文件名格式为 `{LibraryName}XtsTest.test.ets`。

> ⚠️ **扩展名必须为 `.test.ets`**，不能用 `.ts` 或 `.ets`。OpenHarmony XTS 测试框架要求测试文件使用 `.test.ets` 扩展名。

示例映射：

| 库名 | 测试文件名 |
|------|-----------|
| lodash | `LodashXtsTest.test.ets` |
| axios | `AxiosXtsTest.test.ets` |
| blur-kit | `BlurKitXtsTest.test.ets` |

#### 2.2 生成测试文件基础框架

生成包含导入语句、日志常量、`describe` 块、`beforeAll`/`afterAll` 的测试文件基础结构。

> 完整的测试文件框架及函数模板请参考 [XTS_TEMPLATE.md 一](references/XTS_TEMPLATE.md)。

关键要点：
- `it()` 必须使用三参数格式 `it(name, 0, () => {})` — 省略 filter 部分设备崩溃
- 断言 API 必须使用 hypium 专用方法（`assertEqual`/`assertNull`/`assertTrue` 等），**禁止** Jest 风格
- hilog 导入：`import { hilog } from '@kit.PerformanceAnalysisKit'`
- 文件路径通过 `abilityDelegatorRegistry` 获取沙箱目录，禁止硬编码

---

---

### Phase 3：逐用例生成测试函数

对每个用例，按以下步骤生成对应的测试函数代码。

#### 3.1 推导测试函数命名

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

#### 3.2 分析预期结果并设计断言

根据用例描述文档中的"用例预期结果"，设计对应的 expect 断言。常见映射：

| 预期结果类型 | 断言方式 | 说明 |
|------------|---------|------|
| 返回值应等于 X | `expect(result).assertEqual(X)` | 严格相等（===）|
| 返回值应包含 X | `expect(result).assertContain(X)` | 包含判断 |
| 返回值应大于 X | `expect(result).assertLarger(X)` | 大于判断 |
| 返回值应为 null | `expect(result).assertNull()` | null 判断 |
| 布尔值为真 | `expect(bool).assertTrue()` | true 判断 |
| 布尔值为假 | `expect(bool).assertFalse()` | false 判断 |
| 应抛出异常 | try-catch + 布尔标记 | 见 CODE_STANDARDS.md 5.2 |
| 不应抛出异常 | try-catch 无异常 | 正常执行即通过 |

> ⚠️ **hypium 断言 API 重要约束**：`expect()` 对象上**不存在** Jest 风格方法（`toBe`/`toEqual`/`toBeNull`/`toBeTruthy`/`toThrow`/`toBeGreaterThan`/`toContain` 等）。完整替代方案见 [CODE_STANDARDS.md 6.2/6.3](references/CODE_STANDARDS.md)。
>
> 关键替代：`toThrow()` → try-catch + 布尔标记；`toBeLessThan(n)` → `expect(n).assertLarger(x)`（反转方向）。

> ⚠️ **期望值计算规则（强制）**：程序化生成的测试数据（如 `arr[i] = i % 256`），断言期望值必须用表达式计算或手动计算后注释计算过程，**禁止**从报告描述语义联想硬编码。详见 [CODE_STANDARDS.md 7.7](references/CODE_STANDARDS.md)。

> 空值/异常/大数据场景的详细断言策略参见 [CODE_STANDARDS.md 七](references/CODE_STANDARDS.md)。

#### 3.3 逐接口对照规格文档 + 系统 API 预检（强制预检）

> ⚠️ **此步骤必须在生成任何测试代码之前执行**，逐接口对照接口规格文档，杜绝凭记忆猜测类型。

对当前测试用例涉及的**每一个接口**，执行以下检查并记录结论：

| 检查项 | 查询来源 | 记录内容 |
|-------|---------|---------|
| **类型种类** | 接口规格文档第 4 章 | `(interface)` — 不可 `new`，用对象字面量；`(class)` — 可 `new`；`@ObservedV2` — 不可用于 `@State` |
| **返回值守卫** | 接口规格文档签名 | 返回类型含 `\| undefined` 或 `?:` 时，调用后必须 `if (result)` 判空 |
| **参数类型匹配** | 接口规格文档签名 | `common.UIAbilityContext` 参数需 `as common.UIAbilityContext`，不可直接传 `common.Context` |
| **回调参数签名** | 接口规格文档回调定义 | 字段名和参数类型逐字匹配 |
| **属性名准确性** | 接口规格文档第 3 章 | 只能使用列表内的属性名 |
| **系统 API** | `script_deveco_docs` 工具 | `@kit.*`/`@ohos.*`/`@hms.*` 的签名/参数/返回值/import 路径/枚举成员名/权限/系统能力，禁止凭记忆 |
| **import 类型存在性** | `library/Index.ets` | `import { X }` 的每个 X 必须在导出链中；不存在的用对象字面量，禁止 import |
| **未导出类型间接测试** | `library/Index.ets` + 库源码 | 未导出类型不可直接 import，采用间接策略：① 测试已导出的关联方法；② 用 implements 的子类替代；③ 回调用对象字面量匹配 |

> 🚨 **系统 API 强制预检**（不可跳过）：对每个系统 API 依赖，必须调用 MCP 工具 `script_deveco_docs` 检索确认：
> ```
> action=search, keywords=<系统API名/枚举名/模块名>
> action=read, documentId=<search结果>, section=<目标接口/枚举/属性名>
> ```
> 检索要点：search 取首条命中；read 带 `section` 精确定位（聚合文档不带 section 会返回数十 KB）；import 路径以 read 结果的 `#### 导入模块` 为准；`hypium` 与库自身 API 不在系统语料中，返回"未找到"时直接按接口规格文档/源码编写。
>
> 🚨 **import 类型链追踪**（不可跳过）：`read_file library/Index.ets` → 确认每个 import 类型在导出列表中 → 不在则禁止 import，用对象字面量 → 衍生类型 `read_file` 库源码找定义 → 库源码也找不到标记"不可用"。
>
> **未完成以上两步禁止进入 3.4 生成代码。**

#### 3.4 生成测试函数代码

每个测试函数结构规范：JSDoc 注释（用例序号/名称/描述/接口/预期结果）+ `it()` 三参数格式 + hilog 日志 + 断言。

> 完整的各类型测试函数模板（正向、反向、空值、异常、边界值、大数据、异步、类型判断等）参见 [XTS_TEMPLATE.md](references/XTS_TEMPLATE.md)。

> **try-catch 策略**：ArkTS 禁止 `throw e`（arkts-limited-throw）。正常用例不包裹 try-catch；预期异常用例使用 try-catch + 布尔标记。详见 [CODE_STANDARDS.md 五](references/CODE_STANDARDS.md)。

#### 3.5 多接口协同用例处理

当用例涉及多个接口时，按调用顺序依次调用并验证，每步独立 hilog 日志，确保失败可定位到具体步骤。模板参见 [XTS_TEMPLATE.md 三](references/XTS_TEMPLATE.md)。

#### 3.6 测试隔离与状态管理

> ⚠️ 此步骤必须在生成每条断言之前执行。

对当前用例涉及的每一个被断言的状态值，执行以下检查：

| 检查项 | 检查方法 | 处理方式 |
|-------|---------|---------|
| 单例模式识别 | 搜索库源码是否含 `getInstance()` 静态方法 | 若是，该类实例的状态跨用例持久化 |
| 状态可变性 | 确认被断言的状态是否被其他接口修改 | 若是，前面排队的用例可能已修改该状态 |
| 状态重置 | 在断言前是否调用了 reset/stop/clear 方法 | 若否，必须在断言前添加重置调用或使用 `beforeEach` |

**强制规则**：
- 断言单例"初始状态"时，必须在断言前显式重置该状态
- 优先使用 `beforeEach`（而非 `beforeAll`）重置单例状态
- 若无法重置（库未提供 reset 方法），改为断言"调用某方法后的状态"而非"初始状态"

> 单例状态隔离测试模板参见 [XTS_TEMPLATE.md 十七](references/XTS_TEMPLATE.md)。

---

### Phase 4：代码质量保障

> 以下为精简要点，完整的日志规范、注释规范、错误处理规范详见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md)。

#### 4.1 日志/注释/错误处理规范要点

> 以下为精简要点，完整规范详见 [CODE_STANDARDS.md 三/四/五](references/CODE_STANDARDS.md)。

- 每个测试函数开始/结束记录 INFO 日志，执行结果记录 DEBUG（`%{public}s`），失败记录 ERROR
- DOMAIN 统一 `0xD001`，TAG 格式 `{LibraryName}_XtsTest`
- 文件头部 + 每个测试函数前必须有 JSDoc 注释；测试步骤使用区块分隔注释
- 正常用例不包裹 try-catch；预期异常用例使用 try-catch + 布尔标记；禁止 `throw e`
- **`| undefined` 返回值守卫**：返回类型含 `| undefined` 或 `?:` 时，访问属性前必须显式判空
- **`@ObservedV2` + `@State` 冲突**：`@ObservedV2` 类不能用于 V1 装饰器，须改用 V2（`@Local`/`@Param`）
- **组件名/类名准确性**：必须与 `Index.ets` 导出名逐字符一致，禁止自行追加后缀
- **新增未知错误**：编译失败出现未覆盖的新错误时，对照接口规格文档+源码分析修复 → 记录模式 → 下次合并到规则列表

#### 4.2 运行时反推验证

> ⚠️ 每个测试函数生成后、进入编译前，对每条断言执行以下两个反问：

| 反问 | 针对的故障类型 | 不通过时的处理 |
|------|-------------|-------------|
| "这个期望值在运行时到底等于多少？" | 期望值计算错误 | 实际计算后修正期望值，或改用表达式 |
| "这个初始状态在前面用例跑完后还成立吗？" | 单例状态污染 | 添加状态重置调用或改用 `beforeEach` |

**执行方式**：逐条遍历所有 `expect()` 调用，对每条回答两个反问。无法确认的回答"不确定"并标记需要进一步验证。

> ArkTS 类型安全规范、文件路径规范等完整编码标准参见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md) 二/五/六。

---

### Phase 5：编译与运行验证

#### 5.1 工程迁移（migrate.cjs，必做不可跳过）

> 🔴 **强制步骤，禁止跳过**：
> - **无论工程类型（OpenHarmony / HarmonyOS）、无论 `build-profile.json5` 的 `compileSdkVersion` 是否与已安装 SDK 匹配，都必须执行下述迁移脚本**。
> - 禁止以"工程已是新版本""`compileSdkVersion` 已匹配已安装 SDK""工程为 OpenHarmony 无需切换到 HarmonyOS"等理由自行判断并跳过本步骤。
> - 即使 SDK 版本匹配，源工程的 hvigor 文件、`oh-package.json5`、product 的 `runtimeOS`/`compatibleSdkVersion` 等配置仍可能不兼容当前构建环境，必须在编译前执行迁移。

ArkTS原生库源码多为历史工程，`build-profile.json5` 的 SDK 版本配置、hvigor 文件、oh-package.json5 等经常不兼容当前构建环境。使用 `migrate.cjs` 脚本一次性完成华为官方 Manual Migration 全流程迁移。

1. 执行迁移脚本：

```powershell
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
```

2. **执行后强制校验（未通过不得进入 4.2）**：
   - 迁移脚本必须正常执行完成，输出以 `[migrate] 迁移完成。` 结尾，且包含 `强制 N 个 product compatibleSdkVersion/targetSdkVersion=6.1.1(24) + runtimeOS=HarmonyOS` 日志（N≥1）
   - 校验 `{{sourcePath}}/build-profile.json5`：每个 product 的 `runtimeOS` 已为 `HarmonyOS`、`compatibleSdkVersion` 已为 `6.1.1(24)`
   - 任一项不满足 → 重新执行迁移脚本，直至校验通过后方可进入 4.2 编译验证

#### 5.2 Code Linter 静态代码检查（编译前必做）

> 🔴 **编译前静态检查**：在进入编译验证（4.3）之前，先通过 Code Linter 静态扫描测试代码，把可静态发现的问题（样式/正确性/性能/安全规则）前置到编译循环之外，减少编译轮次消耗。
> 由脚本 `code-linter.cjs` 自动化完成（config 检测/创建 → 执行 lint → 解析 JSON → 输出报告）。

1. **调用脚本检查（作用域：本 SKILL 生成的 ohosTest 测试代码）**：

```powershell
node {{skillDir}}/scripts/code-linter.cjs --source {{sourcePath}} --target entry/src/ohosTest/ets/test
```

脚本行为：
- 探测 `devecocli --version`；不可用 → 报「构建环境不可用」退出码 1，本步骤标注跳过，但**不阻塞进入编译验证**（编译同样依赖该环境，届时会暴露）
- 检测工程根 `code-linter.json5`；缺失则按推荐规则集自动创建（否则 `devecocli check lint` 会报 `--config-path does not exist`）
- 执行 `devecocli check lint "<target>" --format json --output-path code-linter-raw.json`（仅传 1 个路径，满足命令路径参数限制）
- 解析 `{ issues }`，按 `Error` / `Warning` 统计，输出 `{{sourcePath}}/code-linter-report.json`

2. **结果判定**：

| 情况 | 处理 |
|------|------|
| 退出码 0（0 Error） | 静态检查通过，进入 4.3 编译验证 |
| 退出码 2（存在 Error） | 逐条修复（判断属测试生成代码则按 4.3 编译修复循环 / 3.3 规范同源修复），重跑脚本直至 0 Error；计入编译修复轮次 |
| 退出码 1（环境不可用） | 标注"Code Linter 环境不可用，跳过"，进入编译验证 |

3. **Warning 处理原则**：
- `@hw-stylistic/file-naming-convention` Warning：多因数字前缀文件名（要求大驼峰）。**不阻塞编译**，无需强制改命名
- 其他 Warning：`addTryCatch`/`addAsyncCatch`/未使用变量等属 P2 优化项，编译通过后按需处理
- **`any`/`unknown` 说明**：Linter 的 `@typescript-eslint/no-explicit-any` 仅对 `.js/.ts` 生效；`.ets` 的 any/unknown 由 ArkTS 编译器强制（`arkts-no-any-unknown`），需在编译验证中确认

#### 5.3 编译验证（5 轮修复策略）

> 🔴 **必须通过 build.ps1 执行**（直接调用 devecocli build 会阻塞 session）。`-Cmd` 必须含 `cd /d {{sourcePath}} &&` 前缀。

```powershell
# 首次编译
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "cd /d {{sourcePath}} && devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "cd /d {{sourcePath}} && devecocli build --modules entry@ohosTest"
```

##### 修复循环（最多 5 轮）

每轮逐条读取错误，**判断来源并分级修复**：

| 错误来源 | 错误类型 | 修复方式 |
|---------|---------|---------|
| 生成代码 | 3.3 规范已知模式 | 按表修复 |
| 生成代码 | 接口签名/类型不匹配 | 对照接口规格文档 + 源码 |
| 生成代码 | 表外新错误 | 分析 → 修复 → 记录到 3.3 规范 |
| 源库 | SDK 版本/依赖缺失/CMake 冲突 | 修正 build-profile/oh-package/externalNativeOptions ✅ |
| 源库 | ArkTS 类型错误 | 仅机械性修正 ⚠️ |
| 源库 | 业务逻辑错误 | 不修复，标注 ❌ |

重新编译后若通过 → 进入 5.4；**连续 2 轮均为源库不可修复错误（❌）→ 立即终止**。

##### ohpm 线上版本替换（源库原生编译失败兜底）

> 当源库原生库（.so）需复杂构建（GN/Ninja/FFmpeg/libyuv/NDK 等）导致编译失败时，可用 ohpm 线上版本替换本地依赖。由共享脚本 `ohpm-switch.cjs` 自动化完成。

**触发条件**（全部满足才执行）：① `ohpm` 可用；② README 含 `.so`/`FFmpeg`/`NDK`/`GN`/`Ninja`/`prebuild` 等特征词；③ 存在 ohpm 线上版本；④ 修复循环内编译仍失败。

```powershell
node {{skillDir}}/scripts/ohpm-switch.cjs --source {{sourcePath}}
# 多个本地依赖时：node {{skillDir}}/scripts/ohpm-switch.cjs --source {{sourcePath}} --pkg <库包名> [--version <版本号>]
cd /d {{sourcePath}} && ohpm install
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "cd /d {{sourcePath}} && devecocli build --modules entry@ohosTest"
```

脚本自动完成：扫描 `oh-package.json5` 定位 `file:` 依赖 → `ohpm info` 查询版本 → 改为线上版本号 → 移除 `build-profile.json5` `modules[]` 中本地模块条目 → 输出 `ohpm-switch-report.json`。

**版本降级 API 兼容性核验（必做）**：替换后必须对照 `library/index.ets` 导出链确认 import 的类型/常量/枚举仍存在。缺失时优先用更接近版本重跑；所有版本均不满足则降级为对象字面量并在报告备注。

| 结果 | 处理 |
|------|------|
| 替换后编译通过 | 编译验证通过，报告标注线上版本切换，附 `ohpm-switch-report.json` |
| 替换后仍失败 | 走降级路径 |
| 无 ohpm 线上版本 | 维持原流程 |

> ⚠️ 修改保留不回滚，报告如实记录改动（引用 `ohpm-switch-report.json`）。

##### 降级：5 轮仍失败 / 提前终止

- ⚠️ 编译验证未通过
- 在最终报告中列出：
  - 生成代码未修复的错误 → 标注"需加入 3.3 错误处理规范"
  - 源库不可修复的错误 → 标注"需源库作者修复"
- **任务状态仍为"完成"**（代码生成本身已完成，编译验证因源库问题跳过）

#### 5.4 编译失败常见问题

| 错误类型 | 解决方法 |
|---------|---------|
| arkts-no-any | 定义具体类型或 interface |
| arkts-no-any-unknown | `unknown` 关键字被完全禁止。改用空但合法的对象（如 `new BleDevice('', '')`）、构造最小字段对象字面量 `as Type`、或 `{} as Type` |
| arkts-no-esobj | 定义命名 interface |
| arkts-no-unsafe-cast | 正确定义类型，避免双重 `as unknown as` |
| 导入路径错误 | 检查库导出入口的实际路径 |
| 缺少权限 | 在 ohosTest 的 module.json5 中声明 |

> 完整的编译错误列表及修复方法参见 [CODE_STANDARDS.md 二和八](references/CODE_STANDARDS.md)。

---

### Phase 6：输出与总结

#### 6.1 输出文件

`entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets`

#### 6.2 测试套件注册

在 `entry/src/ohosTest/ets/test/List.test.ets` 中注册（已存在则追加，不覆盖）。import 路径不带 `.ets` 扩展名但保留 `.test` 部分。模板参见 [XTS_TEMPLATE.md 十二](references/XTS_TEMPLATE.md)。

#### 6.3 测试覆盖率统计

在测试文件末尾添加覆盖率统计注释，格式参见 [XTS_TEMPLATE.md 十三](references/XTS_TEMPLATE.md)。

#### 6.4 生成XTS代码生成报告

`write_file` `{{outputDir}}/arktscoverage-xts-code-report.md`：

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

### Code Linter 检查
{结果：通过（0 Error / N Warning）/ 有 Error（已修复，见编译验证）/ 环境不可用跳过}
- 引用 `{{sourcePath}}/code-linter-report.json`
- 关键 Warning 需人工确认：{如 @hw-stylistic/file-naming-convention 等，不阻塞编译}

### 编译验证
{编译结果：通过 / 失败（X 轮修复后）}

（若已执行 ohpm 线上版本替换，需附加：）
- 源库本地原生编译失败：{原因简述}
- 已切换 ohpm 线上版本：`{库包名}@{版本号}`
- 依赖改动记录：{entry/oh-package.json5 的依赖变更、build-profile.json5 modules[] 移除的模块，可直接引用 `{{sourcePath}}/ohpm-switch-report.json`
- **版本降级 API 兼容核验**：{线上版本对照 library/index.ets 导出链的结果，所有 import 类型是否仍存在；缺失类型的降级处理}

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

## 参考文档

| 文档 | 内容说明 |
|------|---------|
| [CODE_STANDARDS.md](references/CODE_STANDARDS.md) | 编码规范完整参考：文件命名、ArkTS 禁止项、日志/注释/错误处理规范、hypium 框架使用（含断言 API 速查）、编译错误修复、代码质量检查清单（含测试隔离检查 7.6、期望值验证检查 7.7） |
| [XTS_TEMPLATE.md](references/XTS_TEMPLATE.md) | 各类型测试函数模板：测试文件框架、单接口/多接口正向、反向（参数/状态异常）、空值、异常/边界值、大数据量、异步、类型判断、Mock、降级测试、interface 实例化、单例状态隔离、断言 API 速查表 |
| [EXAMPLES.md](references/EXAMPLES.md) | 基于 lodash 的完整示例：输入文档片段、生成的完整测试代码、编译运行验证、覆盖率统计 |
| [SYSTEM_API_LOOKUP.md](references/SYSTEM_API_LOOKUP.md) | 系统 API 检索工具指南：`script_deveco_docs` 用法、常用系统 API 速查、降噪策略、检索边界 |