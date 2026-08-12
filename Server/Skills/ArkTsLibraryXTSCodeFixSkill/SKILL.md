---
name: arkts-library-xts-code-fix
description: 依据失败报告修正有缺陷的 XTS 测试用例代码，使其通过编译与执行验证。Use when 已有待修复的测试代码和下游失败报告，需要根据失败原因针对性修正。本技能只纠错，不创作新用例。
license: Apache-2.0
metadata:
  author: AIWeb
  version: "1.0.0"
  category: ohos-testing
  language: ArkTS/ETS
---

# ArkTS XTS 测试用例代码纠错

本 Skill 用于**修正有缺陷的 XTS 测试用例代码**（`.test.ets`），使其通过编译并在设备上执行通过。它与"创作新用例"（`ArkTsLibraryXTSCodeSkill`）职责分离：本 Skill 的输入是**已有待修正的测试代码 + 下游失败报告**，输出是**修正后的测试代码 + 纠错报告**。

> ⚠️ **核心约束**：
> 1. **职责边界**：只修正"本次写入的测试代码"，不改源库业务逻辑、不改源库源码（`library/`、`entry/src/main/ets/pages/` 等）
> 2. **代码归属识别**：必须能区分"哪些测试代码是本次写入的、哪些是源库原有的"，只改本次写入的
> 3. **失败来源分类**：先判断失败是"测试代码缺陷"还是"源库构建问题"还是"环境/设备问题"，只修复可修复项
> 4. 修正后必须重新编译验证，输出 `## 执行状态` 字段（`成功` / `失败`）供编排器判断

---

## 适用场景

- XTS 测试执行步骤（`ArkTsLibraryXTSExecutionSkill`）失败后，通过 `failStepId` 回到本步骤修复测试代码
- 编译失败且错误定位在测试代码（`entry/src/ohosTest/ets/test/*.test.ets`）
- 测试执行发现断言不匹配（fail）或运行时异常（error），需修正测试代码

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `sourcePath` | ✅ | 目标鸿蒙工程根目录（含 `entry/` 和测试模块） |
| `outputDir` | ✅ | 输出目录（XTS 用例文档、覆盖率报告、执行报告所在目录） |
| `inputReportPath` | ✅ | **下游失败报告路径**（由编排器通过 `## 输入报告路径` 注入，通常是执行报告 `arktscoverage-xts-exec-report.md` 或编译失败日志） |
| `xtsDocPath` | 可选 | XTS 用例描述文档路径；若未提供，从 `outputDir` 搜索 `*XTS用例描述*.md` 或 `arktscoverage-xts-doc.md` |

> 本 Skill 依赖的规范与脚本（`CODE_STANDARDS.md`、`TEMPLATE.md`、`build.ps1`、`migrate.cjs`）位于生成代码技能 `ArkTsLibraryXTSCodeSkill` 目录下，本目录通过 `references/` 与 `scripts/` 以**相对引用**方式复用，避免重复维护。若 `{{skillDir}}` 指向本目录且其中缺少某文件，请到 `{{skillDir}}/../../ArkTsLibraryXTSCodeSkill/` 下查找。

---

## 工作流程

### 0. 前置准备：梳理上下文

开始修复前，先建立对当前状态的完整认知：

1. **读取失败报告**：`read_file` `{{inputReportPath}}`（即 `## 输入报告路径`），完整解析：
   - 报告状态：`成功` / `部分通过` / `源库构建问题` / `环境不可用` / `设备不可用`
   - 编译结果：`成功` / `失败（修复N轮后）` / `环境不可用`
   - 测试结果统计：总数 / 通过 / 失败（fail）/ 错误（error）
   - 失败/错误用例清单及原因分析
   - 源库问题诊断表（依赖缺失 / SDK 版本 / 类型错误等）

2. **识别本次生成的测试代码**（代码归属识别的关键步骤）：
   - `glob` `{{sourcePath}}/entry/src/ohosTest/ets/test/*.test.ets` 列出所有测试文件
   - 排除 `List.test.ets`（入口文件）
   - 用 `git status` / `git diff --name-only` 找出**未提交/新修改**的 `.test.ets` 文件 = 本次生成的
   - 若无 git 仓库，根据文件时间戳 + 名称模式（`{LibraryName}XtsTest.test.ets`）识别
   - `read_file` 生成时留下的报告（`arktscoverage-xts-code-report.md`）确认"生成测试文件"清单
   - **只修改确认属于本次生成的测试文件**，源库已有的测试文件原则上不动

3. **读取测试代码**：`read_file` 本次生成的 `.test.ets` 全文，理解现有断言与接口调用。

4. **读取接口规格**：`read_file`（`interfaceSpecPath` 或从 `outputDir` 搜索 `arktscoverage-interface-spec.md`），用于核对接口签名、类型、返回值守卫。

---

### 1. 失败分类与修复决策

根据失败报告，将失败归入以下类别，决定是否修复：

| 失败类别 | 判定依据 | 是否本次可修复 | 修复动作 |
|---------|---------|--------------|---------|
| **编译错误（测试代码）** | 错误路径在 `entry/src/ohosTest/ets/test/*.test.ets` | ✅ | 对照规范修复（见步骤 2） |
| **编译错误（源库）** | 错误路径在 `library/`、`CMakeLists.txt`、`build-profile.json5` 等 | ⚠️ 仅机械性 | 仅修 SDK 版本、依赖、构建配置；不改业务逻辑 |
| **断言不匹配（fail）** | 报告中 `Failure: F`，`fail` = 断言不匹配 | ✅ | 修正期望值 / 断言逻辑（见步骤 4） |
| **运行时异常（error）** | 报告中 `Error: E`，`error` = 运行时异常 | ✅（测试代码引起） | 修正调用方式 / 状态管理 / 异步处理 |
| **源库不可修复** | 连续 2 轮均为源库不可修复错误 | ❌ | 不修复，报告中标注"需源库作者修复" |
| **环境/设备不可用** | `环境不可用` / `设备不可用` | ❌ | 不修复，报告中标注，任务状态为"完成"（非失败） |

**关键判定**：只有当失败**可归因于本次生成的测试代码**且**可修复**时，本 Skill 才真正修改代码并重新编译。若失败为源库问题或环境问题，本 Skill 不做无效修复，直接输出报告并标记 `## 执行状态: 成功`（因为不是测试代码的缺陷），并在报告中说明。

---

### 2. 修复编译错误（测试代码）

错误定位在 `entry/src/ohosTest/ets/test/*.test.ets` 时的修复策略，对照规范表逐条修复：

| 错误类型 | 修复方式 |
|---------|---------|
| `arkts-no-any` | 定义具体类型或 interface |
| `arkts-no-esobj` | 定义命名 interface |
| `arkts-no-unsafe-cast` | 正确定义类型，避免双重 `as unknown as` |
| `arkts-no-dynamic-property` | 改用类型安全访问 `obj.key` |
| `arkts-limited-throw` | catch 中禁止 `throw e`，改用 try-catch + 布尔标记 |
| 接口签名/类型不匹配 | 对照接口规格文档 + 源码修正 |
| 导入路径错误 | 检查库导出入口 `Index.ets` 的实际路径 |
| `\| undefined` 返回值守卫 | 签名含 `\| undefined` 或 `?:` 的接口，访问属性前必须 `if (result)` 判空 |
| 缺少权限 | 在 ohosTest 的 `module.json5` 中声明 |
| 表外新错误 | 分析 → 修复 → 记录到本规范，供后续复用 |

> 完整规范参考生成代码技能的 [CODE_STANDARDS.md]({{skillDir}}/../../ArkTsLibraryXTSCodeSkill/references/CODE_STANDARDS.md)（二、八章节为 ArkTS 禁止项与编译错误修复表）。

---

### 3. 修复断言不匹配（fail）

`fail` 表示测试代码的**断言逻辑/期望值**与库实际行为不符。修复步骤：

1. **复核期望值**：对照接口规格文档与实际运行逻辑，判断期望值是否正确
   - **程序化数据期望值**：测试数据通过 `for` 循环、取余、映射生成时，期望值必须用表达式计算或手动计算后注释（如 `9999 % 256 = 15`），禁止从语义联想硬编码
2. **复核断言 API**：确认使用 hypium 断言（`assertEqual`/`assertNull`/`assertTrue`/`assertFalse`/`assertLarger`/`assertContain`），**禁止** Jest 风格（`toBe`/`toEqual`/`toThrow`/`toBeTruthy`）
3. **区分"测试错" vs "库行为"**：若期望值与库真实行为不符，且库行为是合理的，则修正测试期望值；若库行为本身有缺陷，标注"源库问题"，不强制让测试通过
4. **`toThrow()` 替代**：预期异常用 try-catch + 布尔标记模式

---

### 4. 修复运行时异常（error）

`error` 表示测试代码执行时抛出异常。常见原因与修复：

| 异常原因 | 修复方式 |
|---------|---------|
| **单例状态污染** | 库使用 `getInstance()` 单例时，断言状态前必须重置；用 `beforeEach`（而非 `beforeAll`）重置 |
| **异步未等待** | 同步方法内部委托异步方法时，测试必须 `async` + `await` |
| 空值/undefined 访问 | 访问返回值属性前判空，或用 null 检查 + `throw new Error()` |
| `@ObservedV2` + `@State` 冲突 | V2 装饰器类不能用于 V1 `@State`/`@Prop`/`@Link`，改用 `@Local`/`@Param` 或 `!!` 语法 |
| 组件名/类名不准确 | 与库 `Index.ets` 导出名逐字符一致，禁止自行追加后缀 |
| 沙箱路径不可访问 | 通过 `abilityDelegatorRegistry` 获取 `tempDir`/`filesDir`，禁止硬编码路径 |

---

### 5. 修复源库机械性问题（可选）

若编译错误定位在源库且属于**机械性**问题，可修复（不改变业务逻辑）：

| 错误类型 | 修复方式 | 可修复？ |
|---------|---------|---------|
| SDK 版本不匹配 | 修正 `build-profile.json5` | ✅ |
| 依赖缺失（如 @ohos/hypium） | 补充 `oh-package.json5` | ✅ |
| CMake 选项冲突 | 修改 `externalNativeOptions` | ✅ |
| 源库 ArkTS 类型错误 | 修正类型注解/补充 @Observed | ⚠️ 仅机械性 |
| 源库业务逻辑错误 | 不修复，标注 | ❌ |

---

### 6. 重新编译验证

> 🔴 **必须通过 `build.ps1` 执行**，直接调用 `devecocli build` 会导致 session 永久阻塞。测试 HAP 构建需要 `-JavaHome` 参数。

首次编译：
```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/../../ArkTsLibraryXTSCodeSkill/scripts/build.ps1" -Cmd "devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/../../ArkTsLibraryXTSCodeSkill/scripts/build.ps1" -JavaHome -Cmd "devecocli build --modules entry@ohosTest"
```

**修复循环（最多 5 轮）**：每轮逐条读取编译错误 → 按步骤 2/3/4 分类修复 → 重新编译。编译通过则进入步骤 7。

**终止判定**：连续 2 轮错误均为源库不可修复错误（❌ 行）→ 立即终止，标注"编译跳过原因 + 修复建议"。

---

### 7. 输出与总结

#### 7.1 输出文件

`write_file` `{{outputDir}}/arktscoverage-xts-code-fix-report.md`，内容：

```markdown
# XTS 测试代码修复报告

## 1. 修复概述
- 下游失败报告：{{inputReportPath}}
- 失败类别：{编译错误-测试代码 / 编译错误-源库 / 断言不匹配 / 运行时异常 / 源库不可修复 / 环境不可用}
- 修复的测试文件：{文件清单}

## 2. 代码归属识别
- 本次生成的测试文件：{文件清单}
- 源库已有测试文件：{文件清单}
- 本次修改的文件：{文件清单}

## 3. 失败根因与修复
| 失败位置 | 根因 | 修复动作 | 结果 |
|---------|------|---------|------|
| ... | ... | ... | ✅ / ❌ |

## 4. 重新编译验证
{编译结果：通过 / 失败（X 轮修复后）}

## 5. 未修复项
- 源库不可修复错误 → 标注"需源库作者修复"
- 环境/设备问题 → 标注"环境不可用/设备不可用"

---
状态: {成功 / 部分通过 / 源库构建问题 / 环境不可用 / 设备不可用}
```

#### 7.2 结果文件

在 `## 结果文件输出路径` 指定的文件中写入并包含：

```
## 执行状态
成功
```

> 只有当"本次生成的测试代码已修复且编译通过"、或"失败可归因为源库/环境问题"时，才标记 `成功`。若测试代码存在无法修复的错误，标记 `失败`，让编排器走终止逻辑。

---

## 设计原则

- **职责单一**：只修复，不生成新用例；生成新用例由 `ArkTsLibraryXTSCodeSkill` 负责
- **代码归属第一**：先识别"哪些是我生成的"，只改自己的代码，避免污染源库
- **失败归因**：先判断失败来源（测试代码 / 源库 / 环境），只修复可修复项，不为源库问题担责
- **规范复用**：编译规范与脚本复用生成代码技能，避免规则漂移

---

## 参考文档

| 文档 | 内容说明 |
|------|---------|
| [CODE_STANDARDS.md](../ArkTsLibraryXTSCodeSkill/references/CODE_STANDARDS.md) | 编码规范完整参考：ArkTS 禁止项、hypium 断言、编译错误修复、测试隔离、期望值验证 |
| [TEMPLATE.md](../ArkTsLibraryXTSCodeSkill/references/TEMPLATE.md) | 各类型测试函数模板（修复时参考正确写法） |
| [error-fixing-examples.md](../ArkTsLibraryXTSExecutionSkill/references/error-fixing-examples.md) | 编译错误修复示例（执行技能诊断参考） |