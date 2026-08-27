---
name: arkts-library-xts-code
description: 基于 XTS 用例描述文档（由 ArkTsLibraryXTSDocSkill 生成）自动生成可在 Harmony ohosTest 系统上编译运行的 XTS 测试用例代码。使用 hypium 测试框架，遵循 ArkTS 编码规范。当需要将 XTS 用例描述转化为可执行自动化测试代码时使用。关键词：ArkTS、XTS、hypium、ohosTest、OpenHarmony。
license: Apache-2.0
compatibility: 需要 devecocli CLI（编译/静态检查/文档检索）、ohpm（依赖管理）、hvigor 构建环境；MCP Gateway 运行中（script_deveco_docs 工具）。编译验证平台适配：Windows 用 build.ps1（PowerShell），macOS/Linux 直接 Bash 调用 devecocli build（见 Phase 7.3）
metadata:
  version: "2.1.0"
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

- **前置 SKILL**：arkts-library-xts-doc（生成 XTS 用例描述文档）
- **输入文件**：XTS 用例描述文档（`*未覆盖接口XTS用例描述*.md`）、接口规格文档（`arktscoverage-interface-spec.md`，可选）

---

## 工作流程概览

```
Phase 1: 准备工作（解析用例文档 → 分类 → 探查工程 → 文件规划，条件性访问修饰符预检）
    ↓
Phase 2: 分批策略判断（用例数 >20 或 代码 >500 行 → subagent 分批模式）
    ↓
Phase 3: 生成测试文件框架
    ↓
┌───────────────────────────────────────────────────────────────┐
│  Phase 2 判定结果：                                           │
│                                                               │
│  触发分批（>20 用例）：          未触发（≤20 用例）：          │
│  Phase 4: Subagent 分批        Phase 5: Orchestrator 直接生成 │
│  （并行 dispatch subagent      （逐用例生成测试函数）           │
│   → 各自查 API + 写代码）                                      │
└───────────────────────────────────────────────────────────────┘
    ↓
Phase 6: 代码质量保障
    ↓
Phase 7: 编译与运行验证（迁移 → Linter → 编译修复，强制不可跳过）
    ↓
Phase 8: 输出与总结（报告含分批方式 / Linter / 编译结论）
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

### 1.5 访问修饰符预检（条件性，编译前错误预防）

> ⚠️ **条件性执行**：本子步骤仅在输入含 `private`/`protected` 成员可能漏出时执行。上游 `arkts-library-interface-spec`（提取时已剔除 private/protected）与 `arkts-library-xts-doc`（已将 private/protected 归为不可测试）**已保证 XTS 用例描述文档不含 private/protected**；因此当 `interfaceSpecPath` 为最新格式接口规格文档且由标准链路生成时，**本子步骤可跳过**。
>
> 需要执行的情形：输入的是**旧格式接口规格文档** / XTS 文档由**旧版 xts-doc** 生成 / **接口规格文档缺失**，此时用例描述中可能残留 private/protected 成员，需预检拦截 ~35% 编译错误。

**执行步骤**：
1. 运行 `node {{skillDir}}/scripts/precheck-access-modifiers.cjs --source {{sourcePath}}` 扫描库源码
2. 读取生成的 `precheck-access-modifiers.json`，建立禁止直接调用清单
3. 生成代码时跳过清单成员，不生成用例（这些接口无需补充 XTS 用例）
4. 若使用并行 Agent，将排除清单注入每个 Agent 的 prompt

> 完整的脚本用法、排除清单格式、Agent 注入模板详见 [ACCESS_MODIFIER_PRECHECK.md](references/ACCESS_MODIFIER_PRECHECK.md)。

---

## Phase 2：分批策略判断

> 本步骤决定代码生成方式：subagent 分批（Phase 4）还是 orchestrator 直接生成（Phase 5）。

**判定条件**：

| 条件 | 模式 | 执行阶段 |
|------|------|---------|
| 用例数 > 20 **或** 预估代码 > 500 行 | Subagent 分批模式 | Phase 3 → **Phase 4** → Phase 6 |
| 用例数 ≤ 20 **且** 预估代码 ≤ 500 行 | 直接生成模式 | Phase 3 → **Phase 5** → Phase 6 |

> 预估代码行数 = 用例数 × 15~25 行/用例（含注释和日志）。

**Subagent 分批模式下的额外准备**：

1. **预扫描 helper class**：读全部用例的"涉及接口"，提取所有 abstract callback 类、abstract exception 类等需要子类化的类型，在框架文件中预定义子类（subagent 直接引用，不重复定义）
2. **按模块分批**：同模块用例尽量在同一批（减少 subagent 需读源文件数），每批 5-8 用例
3. **指定临时输出路径**：每批输出到工作目录内的独立临时文件（`{outputDir}/.xts-batches/batch_{n}.ets`），避免并发冲突。**禁止写到工作目录之外**（如系统 temp 目录），否则人工审核无法追溯写权限

> 验证依据：subagent 可访问 MCP Gateway 工具（`script_deveco_docs` 等），已实测确认。

---

## Phase 3：生成 XTS 测试文件框架

### 3.1 确定测试文件命名

**命名规则**：测试文件统一放在 `entry/src/ohosTest/ets/test/` 目录，文件名格式为 `{LibraryName}XtsTest.test.ets`。

> ⚠️ **扩展名必须为 `.test.ets`**，不能用 `.ts` 或 `.ets`。OpenHarmony XTS 测试框架要求测试文件使用 `.test.ets` 扩展名。

示例映射：

| 库名 | 测试文件名 |
|------|-----------|
| lodash | `LodashXtsTest.test.ets` |
| axios | `AxiosXtsTest.test.ets` |
| blur-kit | `BlurKitXtsTest.test.ets` |

### 3.2 生成测试文件基础框架

生成包含导入语句、日志常量、`describe` 块、`beforeAll`/`afterAll` 的测试文件基础结构。

> 完整的测试文件框架及函数模板请参考 [XTS_TEMPLATE.md 一](references/XTS_TEMPLATE.md)。

关键要点：
- `it()` 必须使用三参数格式 `it(name, 0, () => {})` — 省略 filter 部分设备崩溃
- 断言 API 必须使用 hypium 专用方法（`assertEqual`/`assertNull`/`assertTrue` 等），**禁止** Jest 风格
- hilog 导入：`import { hilog } from '@kit.PerformanceAnalysisKit'`
- 文件路径通过 `abilityDelegatorRegistry` 获取沙箱目录，禁止硬编码

> **Subagent 分批模式下**：框架文件需额外包含预定义的 helper class（callback 子类、exception 子类等，由 Phase 2 预扫描确定），并在 `describe` 块内预留 `// === INSERTION_POINT ===` 标记，供 Phase 4 合并 subagent 输出。

---

## Phase 4：Subagent 分批代码生成

> 🔴 **本阶段仅在 Phase 2 判定为"Subagent 分批模式"时执行。** 若判定为"直接生成模式"，跳过本阶段，进入 Phase 5。

#### 4.1 填充模板并 dispatch subagent

对 Phase 2 规划的每批用例：

1. 读取 [SUBAGENT_PROMPT_TEMPLATE.md](references/SUBAGENT_PROMPT_TEMPLATE.md) 模板
2. 填充 `{PLACEHOLDER}`：

| 占位符 | 填充来源 |
|--------|---------|
| `{LIBRARY_NAME}` | Phase 1.1 提取的库名 |
| `{BATCH_SIZE}` | 本批用例数 |
| `{SOURCE_FILE_PATHS}` | 本批涉及的所有库源文件路径 |
| `{FRAMEWORK_FILE_PATH}` | Phase 3 生成的框架文件路径 |
| `{OUTPUT_FILE_PATH}` | 本批临时输出路径（`{outputDir}/.xts-batches/batch_{n}.ets`，必须在工作目录内） |
| `{ACCESS_MODIFIER_EXCLUSION_LIST}` | Phase 1.5 预检结果（本批涉及类的 private/protected 成员，如已执行预检） |
| `{ADDITIONAL_PRIVATE_MEMBERS}` | Orchestrator 从源码额外发现的 private 成员 |
| `{TEST_CASE_DESCRIPTIONS}` | 本批用例的序号/名称/涉及接口/预期结果（从 XTS 报告提取） |
| `{DOMAIN}` | `0xD001` |
| `{TAG}` | `{LibraryName}_XtsTest` |

3. 使用 `Task` 工具 dispatch `general` 类型 subagent
4. **全部批次并行 dispatch**（各写独立临时文件，无并发冲突）

> subagent 内部执行流程：`script_deveco_docs` 查系统 API（强制）→ `read` 库源码确认签名 → 写 `it()` 函数体 → 自检（7 项规则清单）

#### 4.2 收集并合并输出

1. 等待所有 subagent 返回
2. 按批次顺序将各 subagent 输出的 `it()` 函数体合并到框架文件的 `INSERTION_POINT` 位置
3. 合并后保存为最终测试文件 `{LibraryName}XtsTest.test.ets`
4. 🔴 **合并后置校验（强制，校验不过禁止进入 Phase 6/7）**：
   - 逐文件统计 `it(` 出现次数，与批次规划的用例总数逐批对照（防止空批次先消费 INSERTION_POINT 标记、后续合并静默不生效导致用例丢失）
   - 用例名唯一性检查（防止插入脚本重跑导致用例重复）
   - 文件结尾完整性检查：必须以 `});` + `}` 收尾（describe 块完整闭合，防止合并/手工去重误删结尾括号）
   - 任一项不过 → 修复后重新校验，全部通过才继续（实测该校验可省去 3 轮编译-修复循环）

#### 4.3 失败回退

若某个 subagent 返回失败或标注"API 未预检"：
- Orchestrator 接管该批，按 Phase 5 直接生成模式补写
- 不影响其他批的输出
- 在最终报告中标注哪些批次走了回退

> subagent 自检结果（✓/✗）应记录到最终报告中，用于评估分批效果。

---

## Phase 5：逐用例生成测试函数

> **本阶段为"直接生成模式"（Phase 2 判定为 ≤20 用例时执行）。** 若 Phase 2 判定为"Subagent 分批模式"，本阶段跳过（已由 Phase 4 完成）。

对每个用例，按以下步骤生成对应的测试函数代码。

### 5.1 推导测试函数命名

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

### 5.2 分析预期结果并设计断言

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

### 5.3 逐接口对照规格文档 + 系统 API 预检（强制预检）

> ⚠️ **此步骤必须在生成任何测试代码之前执行**，逐接口对照接口规格文档，杜绝凭记忆猜测类型。

对当前测试用例涉及的**每一个接口**，执行以下检查并记录结论：

| 检查项 | 查询来源 | 记录内容 |
|-------|---------|---------|
| **类型种类** | 接口规格文档第 4 章 | `(interface)` — 不可 `new`，用对象字面量；`(class)` — 可 `new`；`@ObservedV2` — 不可用于 `@State` |
| **访问修饰符** | Phase 1.5 预检结果（已执行时） | `private`/`protected` 成员禁止直接调用，跳过不生成用例 |
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
> **未完成以上两步禁止进入 5.4 生成代码。**

### 5.4 生成测试函数代码

每个测试函数结构规范：JSDoc 注释（用例序号/名称/描述/接口/预期结果）+ `it()` 三参数格式 + hilog 日志 + 断言。

> 完整的各类型测试函数模板（正向、反向、空值、异常、边界值、大数据、异步、类型判断等）参见 [XTS_TEMPLATE.md](references/XTS_TEMPLATE.md)。

> **try-catch 策略**：ArkTS 禁止 `throw e`（arkts-limited-throw）。正常用例不包裹 try-catch；预期异常用例使用 try-catch + 布尔标记。详见 [CODE_STANDARDS.md 五](references/CODE_STANDARDS.md)。

### 5.5 多接口协同用例处理

当用例涉及多个接口时，按调用顺序依次调用并验证，每步独立 hilog 日志，确保失败可定位到具体步骤。模板参见 [XTS_TEMPLATE.md 三](references/XTS_TEMPLATE.md)。

### 5.6 测试隔离与状态管理

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

## Phase 6：代码质量保障

> 以下为精简要点，完整的日志规范、注释规范、错误处理规范详见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md)。

### 6.1 日志/注释/错误处理规范要点

> 以下为精简要点，完整规范详见 [CODE_STANDARDS.md 三/四/五](references/CODE_STANDARDS.md)。

- 每个测试函数开始/结束记录 INFO 日志，执行结果记录 DEBUG（`%{public}s`），失败记录 ERROR
- DOMAIN 统一 `0xD001`，TAG 格式 `{LibraryName}_XtsTest`
- 文件头部 + 每个测试函数前必须有 JSDoc 注释；测试步骤使用区块分隔注释
- 正常用例不包裹 try-catch；预期异常用例使用 try-catch + 布尔标记；禁止 `throw e`
- **`| undefined` 返回值守卫**：返回类型含 `| undefined` 或 `?:` 时，访问属性前必须显式判空
- **`@ObservedV2` + `@State` 冲突**：`@ObservedV2` 类不能用于 V1 装饰器，须改用 V2（`@Local`/`@Param`）
- **组件名/类名准确性**：必须与 `Index.ets` 导出名逐字符一致，禁止自行追加后缀
- **新增未知错误**：编译失败出现未覆盖的新错误时，对照接口规格文档+源码分析修复 → 记录模式 → 下次合并到规则列表

### 6.2 运行时反推验证

> ⚠️ 每个测试函数生成后、进入编译前，对每条断言执行以下两个反问：

| 反问 | 针对的故障类型 | 不通过时的处理 |
|------|-------------|-------------|
| "这个期望值在运行时到底等于多少？" | 期望值计算错误 | 实际计算后修正期望值，或改用表达式 |
| "这个初始状态在前面用例跑完后还成立吗？" | 单例状态污染 | 添加状态重置调用或改用 `beforeEach` |

**执行方式**：逐条遍历所有 `expect()` 调用，对每条回答两个反问。无法确认的回答"不确定"并标记需要进一步验证。

> 标记"不确定"的期望值：库满足 5.3.1 探针触发条件时必须经运行时探针实测确认（或核对 5.3.1 已产出的实测清单）；不满足时在报告中标注"期望值未实测，存在运行时失败风险"。

> ArkTS 类型安全规范、文件路径规范等完整编码标准参见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md) 二/五/六。

---

## Phase 7：编译与运行验证

> 🔴 **本阶段为强制阶段，不可跳过**。包含三个强制步骤：工程迁移 → 静态检查 → 编译验证。若宿主机无编译环境（devecocli/ohpm/hvigor 不可用），必须在最终报告中标注并在报告中给出明确原因；只要环境可用，就必须执行并产出真实编译结论。详细操作、命令、修复策略和常见问题速查参见 [BUILD_VERIFICATION.md](references/BUILD_VERIFICATION.md)。

### 7.1 工程迁移（migrate.cjs，必做不可跳过）

> 🔴 **禁止跳过**：无论工程类型和 SDK 版本是否匹配，都必须执行迁移脚本。源工程的 hvigor 文件、`oh-package.json5`、product 的 `runtimeOS`/`compatibleSdkVersion` 等配置仍可能不兼容当前构建环境。

**预迁移设备探测**（可选）：
```powershell
cmd /c "hdc list targets"
# 若有设备：cmd /c "hdc shell param get const.ohos.apiversion" → deviceApi
```

```powershell
# 有设备时
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}} --compatible-api {deviceApi}

# 无设备时
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
```

**执行后强制校验**：输出以 `[migrate] 迁移完成。` 结尾 + `[migrate] SDK版本: ...` 行 + `runtimeOS=HarmonyOS`。`compatibleSdkVersion` 的 API 版本须 ≤ 设备 API（有设备时）或 = SDK API（无设备时）。未通过则重新执行。

> 迁移校验细节参见 [BUILD_VERIFICATION.md 1](references/BUILD_VERIFICATION.md)。

### 7.2 Code Linter 静态检查（编译前必做）

```powershell
node {{skillDir}}/scripts/code-linter.cjs --source {{sourcePath}} --target entry/src/ohosTest/ets/test
```

| 退出码 | 含义 | 处理 |
|--------|------|------|
| 0 | 0 Error | 通过，进入编译验证 |
| 2 | 存在 Error | 逐条修复后重跑 |
| 1 | 环境不可用 | 标注跳过，进入编译验证 |

> 脚本行为、Warning 处理原则详见 [BUILD_VERIFICATION.md 2](references/BUILD_VERIFICATION.md)。

### 7.3 编译验证（最多 5 轮修复）

> 🔴 **必须通过 build.ps1 执行**（Windows 下直接调用 devecocli build 会阻塞 session）。
>
> **macOS/Linux 平台适配**：build.ps1 为 Windows PowerShell 专用（cmd.exe/.NET Process/hvigor daemon 清理）。macOS/Linux 上直接经 Bash 调用 `devecocli build` 即可（hvigor daemon 后台运行不占用 shell 句柄，无 session 阻塞问题），以 Bash 工具的 timeout 参数做等效保护，编译结论与 Windows 同等有效：
> ```bash
> cd {{sourcePath}} && devecocli build clean
> cd {{sourcePath}} && devecocli build --modules entry@ohosTest
> ```

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "cd /d {{sourcePath}} && devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "cd /d {{sourcePath}} && devecocli build --modules entry@ohosTest"
```

**提效策略**：按错误优先级批量修复（P0-P3 sed 批量 1 轮 + P4-P6 逐个 1 轮 = 2 轮而非 5 轮）：

| 优先级 | 错误类型 | 批量修复方式 | 预计解决数 |
|--------|---------|-------------|-----------|
| P0 | private/protected 访问 | 删除直接访问或跳过该用例 | ~35% |
| P1 | `any`/`unknown` 残留 | `sed` 替换 `as any` → `as Object` | ~15% |
| P2 | catch 类型注解 | `sed` 替换 `catch (e: Object)` → `catch (e)` | ~5% |
| P3 | `null as Object` 转型 | `sed` 替换 → `null` | ~8% |
| P4 | Object 属性访问 | 逐个改为原始类型 | ~15% |
| P5-P6 | 枚举比较/其他类型不匹配 | 逐个分析修复 | ~22% |

> ⚠️ 修复后**不要** `build clean`，hvigor 增量编译可节省 ~70% 时间。

**错误来源分级**：生成代码错误（按表修复 / 对照规格文档+源码 / 记录新模式）、源库错误（SDK/依赖 ✅ 修复 / ArkTS 类型 ⚠️ 仅机械性修正 / 业务逻辑 ❌ 不修复）。连续 2 轮源库不可修复 → 终止。

> 错误优先级完整表、增量编译、ohpm 线上版本替换、降级流程、常见问题速查详见 [BUILD_VERIFICATION.md 3-6](references/BUILD_VERIFICATION.md)。

---

## Phase 8：输出与总结

### 8.1 输出文件

`entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets`

### 8.2 测试套件注册

在 `entry/src/ohosTest/ets/test/List.test.ets` 中注册（已存在则追加，不覆盖）。import 路径不带 `.ets` 扩展名但保留 `.test` 部分。模板参见 [XTS_TEMPLATE.md 十二](references/XTS_TEMPLATE.md)。

### 8.3 测试覆盖率统计

在测试文件末尾添加覆盖率统计注释，格式参见 [XTS_TEMPLATE.md 十三](references/XTS_TEMPLATE.md)。

### 8.4 生成XTS代码生成报告

`write_file` `{{outputDir}}/arktscoverage-xts-code-report.md`，报告内容包含：生成测试文件、测试套件注册、用例统计、分批模式说明、Code Linter 检查结果、编译验证结果（含 ohpm 替换情况如适用）、接口覆盖表、验证步骤。

> 完整报告模板参见 [report-template.md](assets/report-template.md)。

---

## Todos 蓝图

> 🔴 **在开始任何 Phase 之前，先建立以下 todos，并逐项勾选完成。加粗项为强制项，不可跳过。** 这是 opencode 生成运行待办清单的蓝图：必须覆盖以下全部条目，不得只凭标题简化为"写文件 → 报告"。

- [ ] **Phase 1 解析 XTS 用例描述文档**：读取用例文档，提取库名、用例索引、涉及接口，规划文件
- [ ] **Phase 1 探查鸿蒙工程结构**：确认 `entry/src/ohosTest/` 存在、`devecocli` 可用
- [ ] **Phase 1 访问修饰符预检（条件性）**：仅当输入规格文档可能含 private/protected 成员时运行 precheck 脚本
- [ ] **Phase 2 分批策略判断**：统计用例数与预估代码行，判定走 Subagent 分批还是直接生成
- [ ] **Phase 3 生成测试文件框架**：建 `{LibraryName}XtsTest.test.ets` 基础结构（导入、describe、beforeAll、helper class）与 INSERTION_POINT 标记
- [ ] **Phase 4 Subagent 分批代码生成（分批模式）**：填充 SUBAGENT_PROMPT_TEMPLATE → 并行 dispatch subagent → 收集合并输出 → 记录各批自检结果  ✓/✗
- [ ] **Phase 5 逐用例生成测试函数（直接生成模式）**：逐用例系统 API 预检 → 生成 it() 函数体
- [ ] **Phase 6 代码质量保障**：逐条断言运行时反推、ArkTS 规范自检
- [ ] **Phase 7.1 工程迁移**：执行 `migrate.cjs`（强制，禁止跳过）
- [ ] **Phase 7.2 Code Linter 静态检查**：执行 `code-linter.cjs`（强制）
- [ ] **Phase 7.3 编译验证**：执行 `build.ps1` → 修复循环（强制；不可仅报"生成完成"）
- [ ] **Phase 8 输出与总结**：注册 `List.test.ets`、生成 XTS 代码生成报告（含分批方式 / Linter / 编译结论）

> 若环境无编译能力，Phase 7 的三项 todos 勾选时必须同步在报告中注明"环境不可用"及原因。

---

## 参考文档

| 文档 | 内容说明 |
|------|---------|
| [CODE_STANDARDS.md](references/CODE_STANDARDS.md) | 编码规范完整参考：文件命名、ArkTS 禁止项、日志/注释/错误处理规范、hypium 框架使用（含断言 API 速查）、编译错误修复、代码质量检查清单、§10 Subagent 注入用规则速查 |
| [XTS_TEMPLATE.md](references/XTS_TEMPLATE.md) | 各类型测试函数模板：测试文件框架、单接口/多接口正向、反向、空值、异常/边界值、大数据量、异步、类型判断、Mock、降级测试、interface 实例化、单例状态隔离、测试夹具 rawfile 注入交付、断言 API 速查表 |
| [SUBAGENT_PROMPT_TEMPLATE.md](references/SUBAGENT_PROMPT_TEMPLATE.md) | Subagent prompt 通用模板：系统 API 预检步骤、ArkTS 规则清单（含断言语法正反例）、access modifier 排除清单、输出要求、7 项自检清单。Phase 4 分批模式下由 orchestrator 填充后发给 subagent |
| [EXAMPLES.md](references/EXAMPLES.md) | 基于 lodash 的完整示例：输入文档片段、生成的完整测试代码、编译运行验证、覆盖率统计 |
| [SYSTEM_API_LOOKUP.md](references/SYSTEM_API_LOOKUP.md) | 系统 API 检索工具指南：`script_deveco_docs` 用法、常用系统 API 速查、降噪策略、检索边界 |
| [ACCESS_MODIFIER_PRECHECK.md](references/ACCESS_MODIFIER_PRECHECK.md) | 访问修饰符预检详细指南：脚本用法、排除清单格式、跳过规则、并行 Agent 注入模板 |
| [BUILD_VERIFICATION.md](references/BUILD_VERIFICATION.md) | 编译与运行验证详细指南：工程迁移、静态检查、5 轮修复策略、编译错误速查（含接口/实现类型不匹配、裸断言批量处理）、ohpm 线上版本替换、降级流程、常见问题速查 |

### 资源文件

| 文件 | 内容说明 |
|------|---------|
| [report-template.md](assets/report-template.md) | XTS 代码生成报告输出模板 |

### 脚本清单

| 脚本 | 用途 | 调用时机 |
|------|------|---------|
| `scripts/precheck-access-modifiers.cjs` | 扫描库源码 private/protected 成员 | Phase 1.5（条件性，代码生成前） |
| `scripts/migrate.cjs` | 工程迁移至 HarmonyOS SDK | Phase 7.1（编译前） |
| `scripts/code-linter.cjs` | Code Linter 静态检查 | Phase 7.2（编译前） |
| `scripts/build.ps1` | 编译执行（防 session 阻塞） | Phase 7.3（编译验证） |
| `scripts/ohpm-switch.cjs` | ohpm 线上版本替换 | Phase 7.3（源库编译失败兜底） |