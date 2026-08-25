---
name: rn-library-consistency-check
description: 对 RN 三方库的鸿蒙化代码进行一致性检视，对比 source/ohos/ 下的鸿蒙化实现与 source/RN/ 下 Android/iOS 原生模块的函数级实现一致性，检测方法缺失、Stub 实现、参数类型致命错误、返回值异常、TurboModule/NAPI 桥接不一致、原生组件 Props/Commands/事件不一致、Props副作用&关联影响不一致、非rawProps属性默认值不一致等问题，生成严苛评分报告（0-100分）。作为 RN 仓库检视流程的第三阶段，依赖稳定性检视和接口规格文档。Use when 需要对 RN 鸿蒙化库进行实现一致性检视或评估鸿蒙化完成度。
license: Apache-2.0
compatibility: 需要访问双仓库源码（ohos + RN 上游）、对比鸿蒙化与 Android/iOS 原生实现
metadata:
  author: CPPAgent
  version: "3.1"
  stage: "3"
  weight: "20"
---

# RNLibraryConsistencyCheckSkill

对 RN 三方库的**鸿蒙化实现代码**进行一致性检视，对比 `source/ohos/` 中的鸿蒙化实现与 `source/RN/` 中 Android/iOS 原生模块的实现。按四类型（`cppComp`/`cppTM`/`arktsComp`/`arktsTM`）分类检视：组件类检查 Props/Command/Methods/Callback/Lifecycle 五个关键点 + Props副作用&关联影响 + 非rawProps属性默认值；TurboModule 类检查函数签名/返回值/实现逻辑三个关键点。每个检查点均要求与 Android/iOS 做行为级对比，**最关键检查项为实现逻辑一致性**。扣分按四维度路由，副作用&关联影响、非rawProps默认值采用条件路由（有文档且合理→维度4，其余→维度2）。

> ⚠️ **核心定位与原则**：
> 1. 本 SKILL 同时使用**两个仓库**的源码：`source/ohos/`（鸿蒙化）和 `source/RN/`（上游原库）
> 2. **一致性对比必须以具体函数为粒度**，禁止使用模糊文字描述（如"连接管理"）
> 3. 每个对比项必须包含：函数名、签名、文件位置、代码片段
> 4. 检视范围仅限鸿蒙化代码 vs 原库 Android/iOS 原生实现

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `repoUrl` | ✅ | 鸿蒙化仓库地址 |
| `outputDir` | ✅ | 输出目录绝对路径 |
| `interfaceDocPath` | ✅ | 接口规格说明文档路径 |
| `repoName` | ✅ | 仓库名称 |

---

## 输入依赖

本 SKILL 是 RN 仓库检视流程的**第三阶段**，依赖：

- **前置 SKILL**: `rn-library-interface-check`、`rn-library-stability-check`
- **输入文件**: `接口规格说明.md`、`稳定性检视报告.md`
- **仓库源码**: `{outputDir}/source/ohos/`（鸿蒙化）+ `{outputDir}/source/RN/`（原库）

---

## 工作流程概览

```
Phase 0: 鸿蒙代码智能定位与范围识别（四类型 cppComp/cppTM/arktsComp/arktsTM）
    ↓
Phase 1: cppComp 检视（C++ 组件层）— Props/Command/Methods/Callback/Lifecycle
    ↓
Phase 2: cppTM 检视（C++ TurboModule 层）— 函数签名/返回值/实现逻辑
    ↓
Phase 3: arktsComp 检视（ArkTS @Component 层）— Props/Command/Methods/Callback/Lifecycle
    ↓
Phase 4: arktsTM 检视（ArkTS TurboModule 层）— 函数签名/返回值/实现逻辑 ⚠️最关键
    ↓
Phase 5: 其他架构检视 — NAPI桥接/NativeModule架构/平台差异记录
    ↓
Phase 6: 严苛评分计算 — 四维度加权扣分制（0-100分）
    ↓
Phase 7: 生成报告 — 一致性检视报告.md
```

> 📖 **详细参考文档索引**（渐进式披露，按需加载）：
>
> | 参考文件 | 内容 | 加载时机 |
> |----------|------|----------|
> | [references/SCORING_STANDARD.md](references/SCORING_STANDARD.md) | 完整扣分规则、豁免规则、归零规则、维度加权计算 | Phase 6 评分计算时 |
> | [references/NATIVE_COMPONENT_IDENTIFICATION.md](references/NATIVE_COMPONENT_IDENTIFICATION.md) | 四类型原生实体识别、注册链路定位流程、搜索模式 | Phase 0 代码定位时 |
> | [references/CPP_COMPONENT_CHECK_GUIDE.md](references/CPP_COMPONENT_CHECK_GUIDE.md) | C++ 组件层检视：Props/Command/Methods/Callback/Lifecycle 检查点详细操作 | Phase 1 执行时 |
> | [references/CPP_TURBOMODULE_CHECK_GUIDE.md](references/CPP_TURBOMODULE_CHECK_GUIDE.md) | C++ TurboModule 层检视：函数签名/返回值/实现逻辑 详细操作 | Phase 2 执行时 |
> | [references/ARKTS_COMPONENT_CHECK_GUIDE.md](references/ARKTS_COMPONENT_CHECK_GUIDE.md) | ArkTS @Component 层检视：Props/Command/Methods/Callback/Lifecycle + 副作用&默认值 | Phase 3 执行时 |
> | [references/ARKTS_TURBOMODULE_CHECK_GUIDE.md](references/ARKTS_TURBOMODULE_CHECK_GUIDE.md) | ArkTS TurboModule 层检视：函数签名/返回值/实现逻辑 + Stub检测 | Phase 4 执行时 |
> | [references/FUNCTION_COMPARISON_GUIDE.md](references/FUNCTION_COMPARISON_GUIDE.md) | 函数级对比规范：粒度要求、提取流程、对比表格格式、Stub识别特征 | 各Phase对比时 |
> | [references/CHECKLIST.md](references/CHECKLIST.md) | RN 一致性检视清单：四维度检查项速查表 | 检视过程参考 |
> | [assets/REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md) | 报告输出模板：完整Markdown格式规范 | Phase 7 生成报告时 |

---

## 评分体系摘要

采用**严苛扣分制**（从100分开始扣减），按四维度加权：

| 维度编号 | 维度 | 权重 | 满分 | 核心检查内容 |
|----------|------|------|------|-------------|
| 维度1 | API 契约一致性 | 35% | 35 | 方法签名、参数类型、返回值、事件/回调对比 |
| 维度2 | 平台实现一致性 | 30% | 30 | Android/iOS vs OHOS 函数级功能对比；副作用&默认值（无文档/不合理部分） |
| 维度3 | RN 架构一致性 | 20% | 20 | TurboModule/NativeModule/NAPI 桥接一致性 |
| 维度4 | 平台适配合理性 | 15% | 15 | 合理差异判定；副作用&默认值（有文档且合理部分） |

**归零规则**：致命≥4 / 致命≥3+严重≥2 / 累计扣分>60 / 无鸿蒙代码 / 全部Stub → 0分

> 📖 完整扣分规则、豁免规则、条件路由规则、评分等级说明详见 [SCORING_STANDARD.md](references/SCORING_STANDARD.md)

---

## Phase 0：鸿蒙代码智能定位与范围识别

鸿蒙化代码位置**可能不固定**，必须通过智能搜索定位实际实现。

### 0.1 四类型原生桥接实体识别

RN 库的鸿蒙化代码包含四种类型的原生桥接实体，必须分别识别：

| 类型标识 | 全称 | 关键文件特征 |
|----------|------|-------------|
| `cppComp` | C++ 组件层 | `*Package.h`、`*JSIBinder.h`、`*NapiBinder.h` |
| `cppTM` | C++ TurboModule 层 | `*TurboModule*FactoryDelegate*`、`turbo_modules/*JSIBinder.h` |
| `arktsComp` | ArkTS 组件层 | `@Component struct`、`*EtsProps.ts`、`*EtsCommandPayload.ts` |
| `arktsTM` | ArkTS TurboModule 层 | `*TurboModule.ets`、`generated/turboModules/*.ts` |

### 0.2 搜索流程

搜索分两步执行：

1. **JS/TS 层扫描与名称提取**：定位 `codegenNativeComponent`（组件注册）和 `TurboModuleRegistry.getEnforcing`（TM注册），提取组件名和TM名清单
2. **四类桥接层文件识别**：根据名称清单逐一定位各类型的桥接层文件和实现文件

> 📖 详细搜索步骤、关键词模式、提取模板详见 [NATIVE_COMPONENT_IDENTIFICATION.md](references/NATIVE_COMPONENT_IDENTIFICATION.md)

### 0.3 搜索结果判定

| 搜索结果 | 判定 | 下一步 |
|----------|------|--------|
| 找到 `*.ets`/`*.cpp`/`*.h`/`@ohos`/NAPI 绑定 | 定位鸿蒙化代码 | 进入对应Phase |
| 找到 RN 原生组件注册链路 | 按四类型分别定位 | 进入 Phase 1-4 |
| ❌ 无任何鸿蒙特征 | 未实现鸿蒙化 | **评分 0 分** |

> 💡 RN 库可能同时包含四种类型实体，每种类型独立检视、独立扣分。

### 0.4 检视范围记录

必须在报告中记录实际定位到的鸿蒙代码位置（搜索方法、定位结果、文件数、类型标识）。四类型原生实体定位记录表格式详见 [REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md) 第四节。

---

## Phase 1：cppComp 检视（C++ 组件层）

> ⚠️ **适用条件**：Phase 0 中识别到 `cppComp` 类型文件时必须执行。
> 📖 **完整检视方法**详见 [CPP_COMPONENT_CHECK_GUIDE.md](references/CPP_COMPONENT_CHECK_GUIDE.md) 第 3 节

每个检查点覆盖三个维度：**①契约一致性**、**②平台实现差异**、**③架构桥接一致性**。

| 检查点 | ①契约一致性 | ②平台实现差异 | ③架构桥接一致性 |
|--------|-------------|---------------|-----------------|
| **Props** | 传递完整性(-8/个)、类型一致性(-5)、默认值(-4)、NapiBinder桥接(-5) | 实现逻辑一致性(-8~-15)；副作用&关联影响(条件路由) | 全链路断桥检测(JS→C++→ArkTS→build()) |
| **Command** | 注册完整性(-8)、签名一致性(-8/-15) | 实现逻辑一致性(-10~-15)、边界处理(-8) | （已覆盖） |
| **Methods** | 组件名一致性(-5) | N/A | Package注册(-8)、JSIBinder映射(-8) |
| **Callback** | 事件注册(-5)、事件名映射(-5)、数据格式(-6) | 回调触发时机一致性(-8) | C++事件名→OHOS映射(-5) |
| **Lifecycle** | N/A | 构造逻辑(-5)、析构逻辑(-5) | （已覆盖） |

---

## Phase 2：cppTM 检视（C++ TurboModule 层）

> ⚠️ **适用条件**：Phase 0 中识别到 `cppTM` 类型文件时必须执行。
> 📖 **完整检视方法**详见 [CPP_TURBOMODULE_CHECK_GUIDE.md](references/CPP_TURBOMODULE_CHECK_GUIDE.md) 第 3 节

| 检查点 | ①契约一致性 | ②平台实现差异 | ③架构桥接一致性 |
|--------|-------------|---------------|-----------------|
| **函数签名** | TM名一致性(-5)、方法名(-8)、方法存在性(-10)、参数数量(-8)、参数类型(-10)、参数顺序(-6) | 方法签名vs Android/iOS | TurboModule注册完整性(-10) |
| **返回值** | 返回值类型(-10)、语义(-8)、Promise(-6)、getConstants()(-5) | 返回值vs Android/iOS | （已覆盖） |
| **实现逻辑** | N/A | C++→ArkTS映射(-8)、回调绑定(-8)、回调参数类型(-10) | （已覆盖） |

---

## Phase 3：arktsComp 检视（ArkTS @Component 层）

> ⚠️ **适用条件**：Phase 0 中识别到 `arktsComp` 类型文件时必须执行。
> 📖 **完整检视方法**详见 [ARKTS_COMPONENT_CHECK_GUIDE.md](references/ARKTS_COMPONENT_CHECK_GUIDE.md) 第 3 节

**⚠️ 前置过滤规则**：检视前先检查 JS/TS Spec 注册的 Component 名是否在 ArkTS Package 中注册。未注册 → 致命-15 + ⛔跳过该组件内部逐项检查。

| 检查点 | ①契约一致性 | ②平台实现差异 | ③架构桥接一致性 |
|--------|-------------|---------------|-----------------|
| **Props** | rawProps读取完整性(-5/-3)、类型断言(-4)、默认值(-4)、build()断桥(-5/-3) | 实现逻辑一致性(-8~-15)；副作用&关联影响(条件路由)；非rawProps默认值(-12/-8) | （已覆盖） |
| **Command** | 注册完整性(-15)、签名(-8)、参数类型(-15)、fall-through(-10) | 实现逻辑一致性(-10~-15)、边界处理(-8) | （已覆盖） |
| **Methods** | 组件名注册一致性(-5) | N/A | （已覆盖） |
| **Callback** | Events emit完整性(-8)、Payload完整性(-3/字段) | 回调触发时机一致性(-8) | （已覆盖） |
| **Lifecycle** | N/A | aboutToAppear(-5)、aboutToDisappear(-5) | （已覆盖） |

---

## Phase 4：arktsTM 检视（ArkTS TurboModule 层）

> ⚠️ **适用条件**：Phase 0 中识别到 `arktsTM` 类型文件时必须执行。
> 📖 **完整检视方法**详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](references/ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 3 节

**⚠️ 前置过滤规则**：检视前先检查 JS/TS Spec 注册的 TurboModule 名是否在 ArkTS Factory 中注册。未注册 → 致命-15 + ⛔跳过该TM内部方法逐项检查。

**Stub 识别特征**：方法体仅有 `return` 固定值；未调用 `@ohos` API；未执行实际业务操作。

| 检查点 | ①契约一致性 | ②平台实现差异 | ③架构桥接一致性 |
|--------|-------------|---------------|-----------------|
| **函数签名** | NAME常量(-5)、Spec接口实现(-8)、方法存在性(-15)、签名(-8)、参数类型(-10)、参数顺序(-6) | 方法签名vs Android/iOS | （已覆盖） |
| **返回值** | 返回值类型(-10)、语义(-8)、Promise(-6)、常量导出(-5)、常量值(-3) | 返回值vs Android/iOS | （已覆盖） |
| **实现逻辑 ⚠️最关键** | N/A | Stub检测(致命-8/合理0)、方法行为跨平台对比(致命-15/严重-12)、边界处理(-8)、错误处理(-6) | 回调/事件机制(-12) |

---

## Phase 5：其他架构检视（如适用）

### 5.1 NAPI/C++ 桥接层一致性（适用于含 C++ Native 层但非 RN 新架构的库）

| 检查项 | 对比对象 | 扣分 |
|--------|----------|------|
| NAPI 函数注册 | C++ 导出函数 vs JS 期望方法 | -8 |
| NAPI 类型转换 | napi_value 类型与 JS 期望类型 | -10 |
| JSI 绑定一致性 | JSI HostFunction vs 原库实现 | -8 |

### 5.2 NativeModule 架构一致性（适用于旧架构库）

| 检查项 | 对比对象 | 扣分 |
|--------|----------|------|
| 模块名注册 | Android getName() vs OHOS 模块名 | -5 |
| 方法导出 | @ReactMethod / RCT_EXPORT_METHOD vs OHOS 导出 | -8 |
| Promise 处理 | Android/iOS Promise vs OHOS Promise | -6 |
| Callback 处理 | Android/iOS Callback vs OHOS 回调 | -5 |
| 事件发送 | Android/iOS sendEvent vs OHOS 事件 | -5 |

### 5.3 平台差异记录

| 检查项 | 检查内容 | 扣分 |
|--------|----------|------|
| OHOS 限制标注 | 特有限制是否文档化 | -3 |
| 平台检测机制 | 是否有 `Platform.OS` 判断 | -2 |
| 平台差异文档 | 是否有 README 说明差异 | -3 |

---

## Phase 6：严苛评分计算

基于 Phase 1-5 检视结果进行**四维度加权扣分**（0-100分）：

1. 按检查项维度标签将扣分归入对应维度（①→维度1, ②→维度2, ③→维度3）
2. 副作用&关联影响、非rawProps默认值采用**条件路由**：无文档/不合理→维度2，有文档且合理→维度4
3. 各维度实际扣分 = min(扣分上限, 累计扣分)
4. 执行归零检查（致命≥4 / 致命≥3+严重≥2 / 累计>60 / 无代码 / 全Stub）
5. 最终分 = max(0, 100 - 各维度实际扣分之和)

> 📖 完整扣分规则、条件路由详情、维度扣分来源映射详见 [SCORING_STANDARD.md](references/SCORING_STANDARD.md)

---

## Phase 7：生成报告

输出文件：`{outputDir}/一致性检视报告.md`

> ⚠️ **评分格式要求**：报告必须包含 `**综合评分：XX/100**`（粗体标记，中文冒号），确保 `_parseRNLibraryScore` 函数正确解析。

> ⚠️ **扣分维度标注**：所有检视表格扣分列须标注维度编号，格式 `-X（维度N）`。

> 📖 完整报告结构、表格模板详见 [REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md)

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 一致性检视报告 | `一致性检视报告.md` | 四类型分类检视 + Props副作用&关联影响分析 + 非rawProps属性默认值对比 + 函数级对比表格 + Stub检测 + 全链路Props对比 + 扣分维度标注 + 平台差异记录 |

---

## 评分权重

本 SKILL 在 RN 仓库检视综合评分中权重为 **20%**。

---

## 与前置/后置 SKILL 的衔接

| 衔接方向 | SKILL 名称 | 依赖/产出 |
|----------|-----------|-----------|
| 前置依赖 | `rn-library-interface-check` | 输入：`接口规格说明.md` |
| 前置依赖 | `rn-library-stability-check` | 输入：`稳定性检视报告.md` |
| 后置衔接 | `rn-library-code-quality-check` | 输出：`一致性检视报告.md` 供编码质量检视参考 |
