---
name: arkts-library-xts-code
description: 基于 XTS 用例描述文档（由 ArkTsLibraryXTSDocSkill 生成）自动生成可在 Harmony ohosTest 系统上编译运行的 XTS 测试用例代码。使用 hypium 测试框架，遵循 ArkTS 编码规范。当需要将 XTS 用例描述转化为可执行自动化测试代码时使用。关键词：ArkTS、XTS、hypium、ohosTest、OpenHarmony。
license: Apache-2.0
compatibility: 需要 devecocli CLI（编译/静态检查/文档检索）、ohpm（依赖管理）、PowerShell（build.ps1）、hvigor 构建环境；MCP Gateway 运行中（script_deveco_docs 工具）
metadata:
  author: AIWeb
  version: "3.0.0"
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
Phase 1.5: 访问修饰符预检（扫描库源码 private/protected 成员 → 生成排除清单）
    ↓
Phase 2: 生成测试文件框架
    ↓
Phase 3: 逐用例生成测试函数（命名 → 断言 → 接口预检 → 代码 → 隔离检查）
    ↓
Phase 4: 代码质量保障
    ↓
Phase 5: 编译与运行验证（按错误优先级批量修复）
    ↓
Phase 6: 输出与总结
```

---

## Phase 1：准备工作

### 1.1 解析 XTS 用例描述文档

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

### 1.2 用例分类规划

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

### 1.3 探查鸿蒙工程结构

1. `list_dir` 列出工程根目录，识别 `entry/`、`library/` 等模块
2. 检查 `entry/src/ohosTest/` 目录是否存在（若不存在需创建）
3. 读取库导出接口：`library/Index.ets`（HAR）或 `library/src/main/ets/Index.ets`（HSP）
4. 读取现有测试文件（若存在），了解测试代码风格和导入惯例
5. **确认 deveco-cli 可用**：运行 `devecocli --version`

### 1.4 生成文件规划

建立内部文件规划记录：测试文件路径 `entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets`、测试函数命名列表、导入语句清单。

> **多文件策略**：当用例数超过 30 时，按模块拆分为多个测试文件，每个文件不超过 30 个测试函数。

---

### Phase 1.5：访问修饰符预检（编译前错误预防）

> 🔴 **本步骤在代码生成之前执行，可预防 ~35% 的编译错误**。
>
> 接口规格文档列出所有类的方法和属性，但**不包含访问修饰符信息**。若测试代码直接调用 `private`/`protected` 成员，ArkTS 编译会报 `Property 'X' is private and only accessible within class` 错误。

**执行步骤**：
1. 运行 `node {{skillDir}}/scripts/precheck-access-modifiers.cjs --source {{sourcePath}}` 扫描库源码
2. 读取生成的 `precheck-access-modifiers.json`，建立禁止直接调用清单
3. 生成代码时对清单成员使用桩断言 `expect(true).assertTrue()` + 注释说明间接覆盖
4. 若使用并行 Agent，将排除清单注入每个 Agent 的 prompt

> 完整的脚本用法、排除清单格式、桩断言模板、Agent 注入模板详见 [ACCESS_MODIFIER_PRECHECK.md](references/ACCESS_MODIFIER_PRECHECK.md)。

---

### Phase 2：生成 XTS 测试文件框架

### 2.1 确定测试文件命名

**命名规则**：测试文件统一放在 `entry/src/ohosTest/ets/test/` 目录，文件名格式为 `{LibraryName}XtsTest.test.ets`。

> ⚠️ **扩展名必须为 `.test.ets`**，不能用 `.ts` 或 `.ets`。OpenHarmony XTS 测试框架要求测试文件使用 `.test.ets` 扩展名。

示例映射：

| 库名 | 测试文件名 |
|------|-----------|
| lodash | `LodashXtsTest.test.ets` |
| axios | `AxiosXtsTest.test.ets` |
| blur-kit | `BlurKitXtsTest.test.ets` |

### 2.2 生成测试文件基础框架

生成包含导入语句、日志常量、`describe` 块、`beforeAll`/`afterAll` 的测试文件基础结构。

> 完整的测试文件框架及函数模板请参考 [XTS_TEMPLATE.md 一](references/XTS_TEMPLATE.md)。

关键要点：
- `it()` 必须使用三参数格式 `it(name, 0, () => {})` — 省略 filter 部分设备崩溃
- 断言 API 必须使用 hypium 专用方法（`assertEqual`/`assertNull`/`assertTrue` 等），**禁止** Jest 风格
- hilog 导入：`import { hilog } from '@kit.PerformanceAnalysisKit'`
- 文件路径通过 `abilityDelegatorRegistry` 获取沙箱目录，禁止硬编码

---

### Phase 3：逐用例生成测试函数

对每个用例，按以下步骤生成对应的测试函数代码。

### 3.1 推导测试函数命名

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

### 3.2 分析预期结果并设计断言

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

### 3.3 逐接口对照规格文档 + 系统 API 预检（强制预检）

> ⚠️ **此步骤必须在生成任何测试代码之前执行**，逐接口对照接口规格文档，杜绝凭记忆猜测类型。

对当前测试用例涉及的**每一个接口**，执行以下检查并记录结论：

| 检查项 | 查询来源 | 记录内容 |
|-------|---------|---------|
| **类型种类** | 接口规格文档第 4 章 | `(interface)` — 不可 `new`，用对象字面量；`(class)` — 可 `new`；`@ObservedV2` — 不可用于 `@State` |
| **访问修饰符** | Phase 1.5 预检结果 | `private`/`protected` 成员禁止直接调用，生成桩断言（见 Phase 1.5.3） |
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

### 3.4 生成测试函数代码

每个测试函数结构规范：JSDoc 注释（用例序号/名称/描述/接口/预期结果）+ `it()` 三参数格式 + hilog 日志 + 断言。

> 完整的各类型测试函数模板（正向、反向、空值、异常、边界值、大数据、异步、类型判断等）参见 [XTS_TEMPLATE.md](references/XTS_TEMPLATE.md)。

> **try-catch 策略**：ArkTS 禁止 `throw e`（arkts-limited-throw）。正常用例不包裹 try-catch；预期异常用例使用 try-catch + 布尔标记。详见 [CODE_STANDARDS.md 五](references/CODE_STANDARDS.md)。

### 3.5 多接口协同用例处理

当用例涉及多个接口时，按调用顺序依次调用并验证，每步独立 hilog 日志，确保失败可定位到具体步骤。模板参见 [XTS_TEMPLATE.md 三](references/XTS_TEMPLATE.md)。

### 3.6 测试隔离与状态管理

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

### 4.1 日志/注释/错误处理规范要点

> 以下为精简要点，完整规范详见 [CODE_STANDARDS.md 三/四/五](references/CODE_STANDARDS.md)。

- 每个测试函数开始/结束记录 INFO 日志，执行结果记录 DEBUG（`%{public}s`），失败记录 ERROR
- DOMAIN 统一 `0xD001`，TAG 格式 `{LibraryName}_XtsTest`
- 文件头部 + 每个测试函数前必须有 JSDoc 注释；测试步骤使用区块分隔注释
- 正常用例不包裹 try-catch；预期异常用例使用 try-catch + 布尔标记；禁止 `throw e`
- **`| undefined` 返回值守卫**：返回类型含 `| undefined` 或 `?:` 时，访问属性前必须显式判空
- **`@ObservedV2` + `@State` 冲突**：`@ObservedV2` 类不能用于 V1 装饰器，须改用 V2（`@Local`/`@Param`）
- **组件名/类名准确性**：必须与 `Index.ets` 导出名逐字符一致，禁止自行追加后缀
- **新增未知错误**：编译失败出现未覆盖的新错误时，对照接口规格文档+源码分析修复 → 记录模式 → 下次合并到规则列表

### 4.2 运行时反推验证

> ⚠️ 每个测试函数生成后、进入编译前，对每条断言执行以下两个反问：

| 反问 | 针对的故障类型 | 不通过时的处理 |
|------|-------------|-------------|
| "这个期望值在运行时到底等于多少？" | 期望值计算错误 | 实际计算后修正期望值，或改用表达式 |
| "这个初始状态在前面用例跑完后还成立吗？" | 单例状态污染 | 添加状态重置调用或改用 `beforeEach` |

**执行方式**：逐条遍历所有 `expect()` 调用，对每条回答两个反问。无法确认的回答"不确定"并标记需要进一步验证。

> ArkTS 类型安全规范、文件路径规范等完整编码标准参见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md) 二/五/六。

---

### Phase 5：编译与运行验证

> 🔴 本阶段包含三个强制步骤：工程迁移 → 静态检查 → 编译验证。详细操作、命令、修复策略和常见问题速查参见 [BUILD_VERIFICATION.md](references/BUILD_VERIFICATION.md)。

### 5.1 工程迁移（migrate.cjs，必做不可跳过）

> 🔴 **禁止跳过**：无论工程类型和 SDK 版本是否匹配，都必须执行迁移脚本。源工程的 hvigor 文件、`oh-package.json5`、product 的 `runtimeOS`/`compatibleSdkVersion` 等配置仍可能不兼容当前构建环境。

```powershell
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
```

**执行后强制校验**：输出以 `[migrate] 迁移完成。` 结尾 + `runtimeOS=HarmonyOS` + `compatibleSdkVersion=6.1.1(24)`。未通过则重新执行。

> 迁移校验细节参见 [BUILD_VERIFICATION.md 1](references/BUILD_VERIFICATION.md)。

### 5.2 Code Linter 静态检查（编译前必做）

```powershell
node {{skillDir}}/scripts/code-linter.cjs --source {{sourcePath}} --target entry/src/ohosTest/ets/test
```

| 退出码 | 含义 | 处理 |
|--------|------|------|
| 0 | 0 Error | 通过，进入编译验证 |
| 2 | 存在 Error | 逐条修复后重跑 |
| 1 | 环境不可用 | 标注跳过，进入编译验证 |

> 脚本行为、Warning 处理原则详见 [BUILD_VERIFICATION.md 2](references/BUILD_VERIFICATION.md)。

### 5.3 编译验证（最多 5 轮修复）

> 🔴 **必须通过 build.ps1 执行**（直接调用 devecocli build 会阻塞 session）。

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "cd /d {{sourcePath}} && devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "cd /d {{sourcePath}} && devecocli build --modules entry@ohosTest"
```

**提效策略**：按错误优先级批量修复（P0-P3 sed 批量 1 轮 + P4-P6 逐个 1 轮 = 2 轮而非 5 轮）：

| 优先级 | 错误类型 | 批量修复方式 | 预计解决数 |
|--------|---------|-------------|-----------|
| P0 | private/protected 访问 | 桩断言替换 | ~35% |
| P1 | `any`/`unknown` 残留 | `sed` 替换 `as any` → `as Object` | ~15% |
| P2 | catch 类型注解 | `sed` 替换 `catch (e: Object)` → `catch (e)` | ~5% |
| P3 | `null as Object` 转型 | `sed` 替换 → `null` | ~8% |
| P4 | Object 属性访问 | 逐个改为原始类型 | ~15% |
| P5-P6 | 枚举比较/其他类型不匹配 | 逐个分析修复 | ~22% |

> ⚠️ 修复后**不要** `build clean`，hvigor 增量编译可节省 ~70% 时间。

**错误来源分级**：生成代码错误（按表修复 / 对照规格文档+源码 / 记录新模式）、源库错误（SDK/依赖 ✅ 修复 / ArkTS 类型 ⚠️ 仅机械性修正 / 业务逻辑 ❌ 不修复）。连续 2 轮源库不可修复 → 终止。

> 错误优先级完整表、增量编译、ohpm 线上版本替换、降级流程、常见问题速查详见 [BUILD_VERIFICATION.md 3-6](references/BUILD_VERIFICATION.md)。

---

### Phase 6：输出与总结

### 6.1 输出文件

`entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets`

### 6.2 测试套件注册

在 `entry/src/ohosTest/ets/test/List.test.ets` 中注册（已存在则追加，不覆盖）。import 路径不带 `.ets` 扩展名但保留 `.test` 部分。模板参见 [XTS_TEMPLATE.md 十二](references/XTS_TEMPLATE.md)。

### 6.3 测试覆盖率统计

在测试文件末尾添加覆盖率统计注释，格式参见 [XTS_TEMPLATE.md 十三](references/XTS_TEMPLATE.md)。

### 6.4 生成XTS代码生成报告

`write_file` `{{outputDir}}/arktscoverage-xts-code-report.md`，报告内容包含：生成测试文件、测试套件注册、用例统计、Code Linter 检查结果、编译验证结果（含 ohpm 替换情况如适用）、接口覆盖表、验证步骤。

> 完整报告模板参见 [report-template.md](assets/report-template.md)。

---

## 参考文档

| 文档 | 内容说明 |
|------|---------|
| [CODE_STANDARDS.md](references/CODE_STANDARDS.md) | 编码规范完整参考：文件命名、ArkTS 禁止项、日志/注释/错误处理规范、hypium 框架使用（含断言 API 速查）、编译错误修复、代码质量检查清单 |
| [XTS_TEMPLATE.md](references/XTS_TEMPLATE.md) | 各类型测试函数模板：测试文件框架、单接口/多接口正向、反向、空值、异常/边界值、大数据量、异步、类型判断、Mock、降级测试、interface 实例化、单例状态隔离、断言 API 速查表 |
| [EXAMPLES.md](references/EXAMPLES.md) | 基于 lodash 的完整示例：输入文档片段、生成的完整测试代码、编译运行验证、覆盖率统计 |
| [SYSTEM_API_LOOKUP.md](references/SYSTEM_API_LOOKUP.md) | 系统 API 检索工具指南：`script_deveco_docs` 用法、常用系统 API 速查、降噪策略、检索边界 |
| [ACCESS_MODIFIER_PRECHECK.md](references/ACCESS_MODIFIER_PRECHECK.md) | 访问修饰符预检详细指南：脚本用法、排除清单格式、桩断言模板、并行 Agent 注入模板 |
| [BUILD_VERIFICATION.md](references/BUILD_VERIFICATION.md) | 编译与运行验证详细指南：工程迁移、静态检查、5 轮修复策略、ohpm 线上版本替换、降级流程、常见问题速查 |

### 资源文件

| 文件 | 内容说明 |
|------|---------|
| [report-template.md](assets/report-template.md) | XTS 代码生成报告输出模板 |

### 脚本清单

| 脚本 | 用途 | 调用时机 |
|------|------|---------|
| `scripts/precheck-access-modifiers.cjs` | 扫描库源码 private/protected 成员 | Phase 1.5（代码生成前） |
| `scripts/migrate.cjs` | 工程迁移至 HarmonyOS SDK | Phase 5.1（编译前） |
| `scripts/code-linter.cjs` | Code Linter 静态检查 | Phase 5.2（编译前） |
| `scripts/build.ps1` | 编译执行（防 session 阻塞） | Phase 5.3（编译验证） |
| `scripts/ohpm-switch.cjs` | ohpm 线上版本替换 | Phase 5.3（源库编译失败兜底） |