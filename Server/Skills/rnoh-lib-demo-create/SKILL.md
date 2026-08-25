---
name: rnoh-lib-demo-create
description: >-
  根据 Demo 描述文档（{库名}RN测试demo描述.md）为 RN 工程生成完整的 Tester 框架 Demo 代码。
  解析描述文档中的 Demo 五要素（名称、描述、步骤、预期结果、对应接口），探查三方库 JS 层
  导出接口与平台兼容性（Platform.OS === 'harmony' 分支可用 API），生成 Demo 页面代码、
  主入口文件（index.tsx）、RNTesterList 注册。仅关注 RN 工程的 Demo 代码补充，
  不涉及鸿蒙原生侧配置（oh-package/CMake/PackageProvider 等由其他流程处理）。
  当已有 Demo 描述文档需要落地为可运行 Demo 代码时使用。
license: Apache-2.0
compatibility: 需要 MCP Gateway 运行中（script_rn_extract_interfaces、kb_search），需要文件读取与写入权限，需要 RN 工程（含 example/demo 目录和 Tester 框架）
metadata:
  version: "1.0.0"
  category: rn-testing
  language: JavaScript/TypeScript/React Native
  useWhen: 基于 Demo 描述文档生成 RN Tester 框架 Demo 代码
  consumes: rnohLibDemoDocSkill
  consumed-by: rnohLibDemoCoverageSkill
---

# RN 鸿蒙三方库 Demo 代码生成

本技能根据 **Demo 描述文档**（由 `rnoh-lib-demo-doc` 生成的 `{库名}RN测试demo描述.md`），探查三方库 JS 层导出接口与平台兼容性后，自动探查当前工程的 example/demo 目录结构和 Demo 注册入口，生成 Tester 框架的 Demo 页面代码、主入口文件并注册到工程中。

> ⚠️ **核心约束**：本技能仅关注 RN 工程的 Demo 代码生成，不涉及鸿蒙原生侧配置（oh-package.json5、CMakeLists.txt、PackageProvider.cpp、RNPackagesFactory.ets、buildCustomRNComponent 等由工程集成流程处理）。Demo 代码只使用 `Platform.OS === 'harmony'` 分支中定义的 API，禁止照搬 iOS/Android 示例。不硬编码工程路径，所有目录和注册入口通过探查确定。

> ⚠️ **无平台分支库**：部分库（如 `react-native-safe-area-context`）没有 `Platform.OS === 'harmony'` 分支，而是通过 TurboModule 原生适配，JS 层所有导出在 HarmonyOS 上全部可用。探查时需区分此类库，无需过滤 iOS/Android 专属属性。

> ⚠️ **废弃接口**：部分库包含 `@deprecated` 废弃别名接口（如 `useSafeArea` → `useSafeAreaInsets`、`SafeAreaContext` → `SafeAreaInsetsContext`）。废弃接口在 HarmonyOS 平台仍正常可用，需生成 Demo 验证其兼容性，并使用引用相等性比较（`===`）验证别名关系。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `demoDoc` | string | ✅ | Demo 描述文档路径（`{库名}RN测试demo描述.md`） |
| `projectRoot` | string | ✅ | RN 工程根目录（含 example/demo 目录） |
| `libName` | string | ✅ | 三方库名（如 `react-native-audio`），用于目录命名 |
| `harmonyPkgName` | string | ✅ | 鸿蒙包名（如 `@react-native-ohos/react-native-audio`），用于 import 语句 |
| `category` | string | ❌ | Demo 分类，默认 `UI`（可选 `API`/`Media`/`Basic`/`Component`） |

**派生变量**（Phase 1 探查后确定）：
- `skillDir`：本 SKILL 所在目录
- `exampleDir`：探查到的 example/demo 目录绝对路径（见 Phase 1.2）
- `demoDir`：`{exampleDir}/{libName}/demo/`
- `indexFile`：`{exampleDir}/{libName}/index.tsx`
- `registerFile`：探查到的 Demo 注册入口文件路径（见 Phase 1.2）

---

## 输入依赖

- **前置SKILL**: `rnoh-lib-demo-doc`（提供 Demo 描述文档）
- **输入文件**: Demo 描述文档（Markdown，含五要素表格）
- **MCP工具**: `script_rn_extract_interfaces`（提取接口规格辅助验证）、`kb_search`（鸿蒙知识查询）
- **项目结构**: RN 工程（含 example/demo 目录和 Tester 框架）

---

## 工作流程概览

```
Phase 1: 描述文档解析与项目分析
    ↓
Phase 2: 三方库 JS 层接口与平台兼容性探查
    ↓
Phase 3: Demo 代码生成（页面/入口/RNTester注册）
    ↓
Phase 4: 质量校验与输出报告
```

---

## Phase 1：描述文档解析与项目分析

### 1.1 解析 Demo 描述文档

读取 `demoDoc`，提取 Demo 五要素表格：

| 要素 | 提取内容 |
|------|----------|
| 名称 | Demo 名称，用于文件命名（转 kebab-case） |
| 描述 | 功能说明，用于 TestCase `itShould` |
| 步骤 | 编号列表，含 useState/useEffect/接口调用/setXxx() |
| 预期结果 | 可观测指标，用于验证 |
| 对应接口 | 函数签名列表，用于代码生成依据 |

### 1.2 探查工程目录结构与注册入口

> ⚠️ 不硬编码工程路径，通过探查确定 example/demo 目录和 Demo 注册文件。

#### 1.2.1 探查 example/demo 目录

在 `projectRoot` 下按优先级搜索 example/demo 目录（取第一个存在的）：

| 优先级 | 搜索路径 | 说明 |
|--------|----------|------|
| 1 | `{projectRoot}/rn-tester/examples/` | RNTester 框架标准目录 |
| 2 | `{projectRoot}/example/src/` | 常见 example 工程 |
| 3 | `{projectRoot}/examples/src/` | 多 example 工程 |
| 4 | `{projectRoot}/example/` | 简单 example |
| 5 | `{projectRoot}/demo/src/` | demo 目录 |
| 6 | `{projectRoot}/demo/` | 简单 demo |

探查到的目录赋值给 `exampleDir`。Demo 页面文件将生成在 `{exampleDir}/{libName}/demo/` 下。

#### 1.2.2 探查 Demo 注册入口文件

在 `projectRoot` 下搜索 Demo 注册入口（即已有 Demo 列表被注册的文件），按优先级：

| 优先级 | 搜索路径 | 说明 |
|--------|----------|------|
| 1 | `{projectRoot}/**/RNTesterList.ts` | RNTester 框架注册文件 |
| 2 | `{projectRoot}/**/TesterList.*` | Tester 列表变体 |
| 3 | `{projectRoot}/example/src/App.tsx` 或 `App.ts` | example 工程入口 |
| 4 | `{projectRoot}/**/navigation*` 或 `routes*` | 导航/路由配置 |

探查到的文件赋值给 `registerFile`。读取其内容，分析现有 Demo 的注册模式（require/import 方式、数组结构），后续按相同模式注册新 Demo。

> ⚠️ **注册模式识别**：不同工程使用不同的注册模式，必须读取 `registerFile` 内容后分析其数组结构、import 方式和对象字段，按相同模式追加。常见模式见 Phase 3.4。

#### 1.2.3 缺失处理

| 探查项 | 缺失处理 |
|--------|----------|
| `package.json` | ⚠️ 停止，提示非 RN 工程 |
| example/demo 目录 | ⚠️ 停止，提示用户指定 Demo 目录 |
| 注册入口文件 | ⚠️ 停止，提示用户指定注册文件，或手动注册 |

### 1.3 验证依赖存在

检查 `package.json` 中 `dependencies` 是否包含目标库。**依赖不存在时必须停止**，不得继续代码生成。

> 描述文档解析与项目分析的详细步骤参见 [Demo 代码规则](references/DEMO_CODE_RULES.md)

---

## Phase 2：三方库 JS 层接口与平台兼容性探查

> ⚠️ **关键步骤**：生成 Demo 代码前，必须探查三方库 JS 层实际导出的接口和平台兼容性，确保 Demo 代码只使用 HarmonyOS 平台实际支持的 API。详细探查方法参见 [源码探查指南](references/SOURCE_EXPLORATION.md)

### 2.1 探查清单

| # | 探查项 | 探查路径 | 提取信息 |
|---|--------|----------|----------|
| 2.1 | JS 层导出接口 | `node_modules/{harmonyPkgName}/index.js` 或 `index.ts` | 导出的函数、类、组件、Hooks、常量、枚举 |
| 2.2 | 平台兼容性 API | 同上，查找 `Platform.OS === 'harmony'` 分支 | harmony 分支下可用属性/常量/方法、不可用 API |
| 2.3 | TurboModule Spec | `node_modules/{harmonyPkgName}/src/**/Native*.ts` | 方法签名、Promise vs 同步、事件名 |
| 2.4 | 类型定义 | `node_modules/{harmonyPkgName}/**/*.d.ts` | 参数类型、可选参数、返回值类型 |

### 2.2 探查结果汇总

探查完成后汇总为接口能力清单：

| 信息 | 说明 | 示例 |
|------|------|------|
| HarmonyOS 可用导出 | harmony 分支中定义的属性和 API | `FilesDirectoryPath`、`startRecording()` |
| HarmonyOS 不可用 API | 仅 iOS/Android 分支存在的属性 | `DocumentDirectoryPath`、`MainBundlePath` |
| 方法调用方式 | Promise vs 同步 | `startRecording()` 返回 Promise |
| 事件名称 | DeviceEventEmitter 监听的事件名 | `recordingProgress`、`recordingFinished` |

### 2.3 MCP 工具辅助

可调用 `script_rn_extract_interfaces` 提取接口规格 JSON，用于交叉验证描述文档中的接口签名是否与源码一致。

调用 `kb_search` 查询鸿蒙平台特定约束（如权限要求、ArkTS 限制）。

---

## Phase 3：Demo 代码生成

> 详细的代码规范、禁止事项、模板参见 [Demo 代码规则](references/DEMO_CODE_RULES.md) 和 [代码模板](assets/DEMO_PAGE_TEMPLATE.md)

### 3.1 创建目录结构

在 Phase 1.2 探查到的 `exampleDir` 下创建：

```
{exampleDir}/{libName}/
├── index.tsx                  # 主入口（Tester 框架 + 元数据导出）
└── demo/
    ├── 001_{描述1}Page.tsx
    ├── 002_{描述2}Page.tsx
    └── ...
```

### 3.2 生成 Demo 页面代码

每个 Demo 页面基于描述文档五要素生成，必须遵循以下核心规则：

| 规则 | 说明 |
|------|------|
| 根组件用 `View` | ❌ 禁止 `ScrollView` 作为根（Tester 已有 ScrollView，嵌套导致高度塌陷） |
| 不用 `SafeAreaView`/`StatusBar` | Tester 框架不需要 |
| 不用 `Slider` | HarmonyOS 不支持，用按钮组替代 |
| 不用 `console.error()` | 会触发系统弹窗，用 `console.warn()` 替代 |
| 平台兼容性 | 只用 `Platform.OS === 'harmony'` 分支的属性（基于 Phase 2.2）；无平台分支的库全部可用 |
| 权限请求 | 涉及麦克风/相机/定位等操作前必须请求权限 |
| 计时器兜底 | 原生事件不可靠时用 JS `setInterval` 兜底，停止时只清计时器不重置值 |
| 异步处理 | 用 `async/await` + `try/catch`，不用 `.then()/.catch()` 链 |
| 无注释 | 代码中不使用 `//` 或 `/* */` |
| Hook 调用位置 | Hook 必须在组件顶层调用，不可在事件回调中调用；依赖 Context 的 Hook 须放在 Provider 子组件中 |
| 废弃接口验证 | 使用引用相等性比较（`===`）验证别名关系，比功能对比更可靠 |
| type 导入 | 使用 `import { type EdgeInsets }` inline type 语法，与运行时导出混写，避免类型进入打包 |
| Provider 子组件拆分 | 依赖 Context 值的 Hook/组件须拆分到 Provider 子组件中，确保 Context 有值 |

### 3.3 生成主入口文件

`index.tsx` 包含：
1. Tester 框架集成（`Tester` + `TestSuite` + `TestCase`）
2. 元数据导出（`displayName`、`framework`、`category`、`title`、`description`、`examples`）

> 入口文件模板参见 [入口模板](assets/INDEX_TEMPLATE.md)

### 3.4 更新 Demo 注册入口

在 Phase 1.2 探查到的 `registerFile` 中注册新模块。**按该文件现有的注册模式追加**，不破坏已有结构。必须先读取 `registerFile` 内容分析其注册模式，按相同模式追加。

**模式 A：RNTesterList.ts 数组注册**（常见于 RNTester 框架）：
```typescript
{
  key: '{libName}',
  category: '{category}',
  module: require('{相对于registerFile的路径到index}'),
}
```

**模式 B：App.tsx 导入注册**（常见于 example 工程）：
```typescript
import {libNamePascalCase}Tester from './{相对于App.tsx的路径到index}';
// 在导航/路由配置中添加该 Demo 页面
```

**模式 C：自定义 demos 数组注册**（常见于工程自带的自定义 Tester 入口，如 `example/src/index.tsx`）：
```typescript
import {libNamePascalCase}Tester from './{相对于registerFile的路径到index}';
// 追加到 demos 数组
const demos: IDemoItem[] = [
  // ...已有条目
  { Component: {libNamePascalCase}Tester, name: '{Demo显示名}', key: '{libNamePascalCase}' }
];
```

> ⚠️ `require`/`import` 的路径必须是从 `registerFile` 到 `indexFile` 的**相对路径**，根据实际目录层级计算，不硬编码固定路径。

> ⚠️ **模式选择策略**：读取 `registerFile` 后，按以下优先级匹配注册模式：
> 1. 文件含 `require(...)` + 数组对象含 `module` 字段 → 模式 A
> 2. 文件含 `import ... from ...` + 导航/路由配置 → 模式 B
> 3. 文件含 `demos`/`items` 数组 + `Component` 字段 → 模式 C
> 4. 以上均不匹配 → 停止，提示用户指定注册方式

> 注册模式与路径计算的详细说明参见 [入口模板](assets/INDEX_TEMPLATE.md)

---

## Phase 4：质量校验与输出报告

### 4.1 质量校验

生成完成后执行校验：

> 完整检查清单参见 [质量检查清单](references/QUALITY_CHECKLIST.md)

| 校验维度 | 关键检查项 |
|----------|-----------|
| 接口探查完整性 | JS 导出接口、平台兼容性 API、TurboModule Spec、类型定义 全部探查 |
| 工程结构探查 | example/demo 目录已探查、注册入口文件已探查 |
| 代码规范 | 无 ScrollView 根组件、无 Slider、无 console.error、无注释 |
| 平台兼容性 | 未使用 iOS/Android 专属属性（基于 Phase 2.2）；无平台分支库全部可用 |
| 权限处理 | 敏感权限操作前有权限请求 |
| Tester 集成 | 注册入口已更新、index.tsx 含元数据导出 |
| 注册模式适配 | 注册模式（A/B/C）与 registerFile 现有模式一致，未破坏已有结构 |
| Hook 约束 | Hook 在组件顶层调用，依赖 Context 的 Hook 在 Provider 子组件中 |
| 废弃接口验证 | 使用引用相等性比较（`===`）验证别名关系 |

### 4.2 输出产物

| 产物 | 路径 | 说明 |
|------|------|------|
| Demo 页面文件 | `{exampleDir}/{libName}/demo/00X_*.tsx` | 每个 Demo 一个文件 |
| 主入口文件 | `{exampleDir}/{libName}/index.tsx` | Tester 框架 + 元数据 |
| 注册入口文件 | `{registerFile}` | 已追加新 Demo 注册 |

### 4.3 输出报告

生成完成后输出确认信息，包含：
- 生成的文件列表
- 探查到的工程结构（exampleDir、registerFile）
- 接口探查结果汇总（JS 导出接口、harmony 可用/不可用 API）
- Demo 数量与覆盖接口数
- 注册模式（模式 A/B/C）及注册路径
- 废弃接口验证结果（如涉及）
- 需用户后续确认的事项（如需手动验证的项）

---

## 参考资料

- [源码探查指南](references/SOURCE_EXPLORATION.md) — JS 层导出接口、平台兼容性 API 探查方法与示例
- [Demo 代码规则](references/DEMO_CODE_RULES.md) — 目录规范、页面代码规范、禁止事项、常见陷阱
- [质量检查清单](references/QUALITY_CHECKLIST.md) — 完整校验项
- [Demo 页面模板](assets/DEMO_PAGE_TEMPLATE.md) — 可复制的页面代码模板
- [入口文件模板](assets/INDEX_TEMPLATE.md) — 可复制的 index.tsx 模板
- React Native 官方文档：https://reactnative.dev
- RNOH 官方文档：https://gitcode.com/OpenHarmony-RN/usage-docs/tree/master/zh-cn
