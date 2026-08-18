---
name: rnoh-lib-demo-doc
description: >-
  基于 RN 鸿蒙三方库的接口规格（interface-spec.json）生成 Demo 描述说明文档。
  当接口规格说明书（Markdown）缺失时，自动调用 script_rn_render_spec_doc 从规格 JSON
  或源码生成说明书，再结合源码补充默认值、错误码、事件名、平台差异等细节，
  以函数/接口为单位生成 HarmonyOS 平台可用的测试 Demo 描述（名称、描述、步骤、预期结果、对应接口），
  以表格形式汇总输出为"{库名}RN测试demo描述.md"。
  自动检查是否已有 Demo 描述文档，若已存在则调用 script_rn_analyze_demo_coverage 扫描覆盖率，
  仅针对未覆盖的接口生成 Demo 描述（增量模式），避免重复生成。
  当需要为 RN 鸿蒙三方库规划 Demo 验证方案、生成可执行测试描述文档、
  补全缺失 Demo 的描述、或仅有接口规格 JSON 而缺少人类可读说明书时使用此技能。
license: Apache-2.0
compatibility: 需要 MCP Gateway 运行中（script_rn_extract_interfaces、script_rn_render_spec_doc），需要文件读取与写入权限
metadata:
  author: rnoh-team
  version: "1.0.0"
  category: rn-testing
  language: JavaScript/TypeScript/React Native
  useWhen: 基于 RN 鸿蒙三方库接口规格生成 Demo 描述文档
  consumed-by: rnohLibDemoCreateSkill
---

# RN 鸿蒙三方库 Demo 描述文档生成

本技能基于 **RN 鸿蒙三方库的接口规格**（`interface-spec.json`），在接口规格说明书缺失时自动补全，自动扫描 Demo 覆盖率确定全量/增量模式，结合源码补充细节，生成 HarmonyOS 平台可用的测试 Demo 描述文档，输出为 `{库名}RN测试demo描述.md`。

> ⚠️ **核心约束**：所有 Demo 内容必须基于接口规格与源码中真实存在的接口和功能生成，严禁凭空捏造不存在的接口、参数或行为。每个 Demo 步骤中的按钮必须有可观测的预期结果（禁止"死按钮"）。
>
> 🎯 **两种模式（自动判定）**：
> - **全量模式**：Demo 描述文档不存在时，对规格中所有 HarmonyOS 可用接口生成 Demo 描述
> - **增量模式**：Demo 描述文档已存在时，扫描覆盖率，仅针对未覆盖接口生成 Demo 描述

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `libroot` | string | ✅* | RN 三方库鸿蒙化仓库根目录（含 `package.json`） |
| `spec` | string | ✅* | 已有的 `interface-spec.json` 路径（与 `libroot` 二选一，优先使用） |
| `specDoc` | string | ❌ | 接口规格说明书（Markdown）路径；缺失时自动生成 |
| `coverageReport` | string | ❌ | 已有的 Demo 覆盖率报告（Markdown）路径；**提供时跳过 Phase 1 & Phase 2，直接进入 Phase 3 解析报告** |
| `output` | string | ❌ | 输出文件路径，默认 `{libroot}/{库名}RN测试demo描述.md` |
| `version` | string | ❌ | 上游 npm 版本号（如 `2.2.0`），未指定时自动推断 |

> `libroot` 与 `spec` 至少提供一个。提供 `spec` 时直接使用；仅提供 `libroot` 时需先提取接口规格。
>
> **模式自动判定**：Phase 3 自动检查是否已有 Demo 描述文档并执行覆盖率扫描。文档不存在 → 全量模式；文档已存在 → 增量模式（仅未覆盖接口）。
>
> **覆盖率报告快捷路径**：当提供 `coverageReport` 参数（或调用方直接指定已有报告路径）时，**跳过 Phase 1（接口规格获取）和 Phase 2（接口规格说明书补全）**，直接进入 Phase 3 解析已有覆盖率报告。覆盖率报告中已包含未覆盖接口的名称、类型、参数、返回类型等详情，Phase 4 源码分析可补充精确签名，无需生成全量 `interface-spec.json` 和接口规格说明书。

**派生变量**：
- `skillDir`：本 SKILL 所在目录
- `libName`：从 `package.json` 的 `name` 字段提取
- `outputPath`：`output` 参数或默认 `{libroot}/{libName}RN测试demo描述.md`
- `hasCoverageReport`：是否提供了已有覆盖率报告（`coverageReport` 参数非空），为 true 时跳过 Phase 1 & 2
- `mode`：Phase 3 确定为 `full`（全量）或 `incremental`（增量）
- `coveredSet`：Phase 3 构建的已覆盖接口集合
- `uncoveredList`：Phase 3 构建的未覆盖接口列表
- `coverageReportPath`：Phase 3 使用的覆盖率报告路径（已有报告或新生成的报告）

---

## 输入依赖

- **前置SKILL**: `rnoh-lib-code-adapt`（可选；提供鸿蒙化仓库源码）
- **输入文件**: 接口规格 JSON（`interface-spec.json`）或库源码目录；**可选**已有 Demo 覆盖率报告（Markdown）
- **MCP工具**: `script_rn_extract_interfaces`、`script_rn_render_spec_doc`、`script_rn_analyze_demo_coverage`（提供 `coverageReport` 时前两个工具不调用）
- **输出文件**: `{libName}RN测试demo描述.md`（Markdown Demo 描述文档）

---

## 工作流程概览

### 标准路径（无已有覆盖率报告）

```
Phase 1: 接口规格获取（JSON 读取 / 源码提取）
    ↓
Phase 2: 接口规格说明书补全（缺失时调用 script_rn_render_spec_doc）
    ↓
Phase 3: Demo 覆盖率扫描（检查已有文档 + 调用 script_rn_analyze_demo_coverage）
    ↓
Phase 4: 源码补充分析（默认值、错误码、事件名、平台差异）
    ↓
Phase 5: 接口能力清单构建 + HarmonyOS 平台过滤 + 覆盖率增量过滤
    ↓
Phase 6: Demo 设计与分组（五要素 + 双计数器 + useState 规则）
    ↓
Phase 7: 文档生成与质量校验
```

### 快捷路径（提供已有覆盖率报告时）

```
Phase 1: ⏭️ 跳过（覆盖率报告已含未覆盖接口详情）
    ↓
Phase 2: ⏭️ 跳过（无需全量接口规格说明书）
    ↓
Phase 3: 解析已有覆盖率报告（提取未覆盖接口列表 + 确定增量模式）
    ↓
Phase 4: 源码补充分析（从未覆盖接口的源码中提取精确签名、默认值、平台差异）
    ↓
Phase 5: 接口能力清单构建 + HarmonyOS 平台过滤 + 覆盖率增量过滤
    ↓
Phase 6: Demo 设计与分组（五要素 + 双计数器 + useState 规则）
    ↓
Phase 7: 文档生成与质量校验
```

> **路径判定**：`hasCoverageReport` 为 true 时走快捷路径，跳过 Phase 1 & 2；否则走标准路径。
>
> Phase 3 在接口规格就绪后（标准路径）或直接从覆盖率报告入口（快捷路径）、源码分析前执行，确定全量/增量模式及待生成接口范围。

---

## Phase 1：接口规格获取

> ⏭️ **快捷路径跳过**：当 `hasCoverageReport` 为 true（提供了已有覆盖率报告）时，**跳过整个 Phase 1**。覆盖率报告中已包含未覆盖接口的名称、类型、参数、返回类型，Phase 4 源码分析将补充精确签名。直接进入 Phase 3。

### 1.1 判断输入来源

根据参数判断接口规格的获取路径：

| 输入情况 | 获取方式 |
|----------|----------|
| 提供了 `spec`（JSON 路径） | 直接读取 JSON 文件 |
| 仅提供 `libroot`，仓库内已有 `interface-spec.json` | 读取该文件 |
| 仅提供 `libroot`，无现成 JSON | 调用 MCP 工具提取（见 1.2） |

### 1.2 调用 MCP 工具提取接口规格（必要时）

当没有现成的 `interface-spec.json` 时，调用 MCP 脚本工具：

```
调用 script_rn_extract_interfaces：
  - libroot: {{libroot}}
  - output: {{libroot}}/interface-spec.json
  - version: {{version}}（可选）
```

脚本自动完成：拉取上游 npm 源码（`index.js`/`index.d.ts`）、提取本地 TurboModule Spec（`Native*.ts`）、解析 JS 层导出和类型定义，输出 JSON 接口规格文件。

### 1.3 解析接口规格 JSON

读取 `interface-spec.json`，提取以下核心信息：

- **库名称**：用于输出文件命名
- **导出函数列表**：函数名、参数、返回值、功能描述
- **导出类/对象列表**：类名（如 `NativeModules.XxxModule`）、方法列表
- **React 组件列表**：组件名、Props 类型、事件回调 Props（onXxx）
- **Hooks 列表**：Hook 函数名、参数、返回值
- **接口/类型定义**：TypeScript interface / type alias
- **枚举/常量列表**：枚举名、常量名及含义
- **事件列表**：NativeEventEmitter 事件名称及回调数据格式
- **TurboModule Spec**：原生模块方法签名

---

## Phase 2：接口规格说明书补全

> ⏭️ **快捷路径跳过**：当 `hasCoverageReport` 为 true 时，**跳过整个 Phase 2**。增量模式下仅需针对未覆盖接口生成 Demo 描述，覆盖率报告 + Phase 4 源码分析已提供足够信息，无需生成全量接口规格说明书。

### 2.1 判断说明书是否存在

检查 `specDoc` 参数指向的 Markdown 文件是否存在，或在 `libroot` 下搜索 `*接口规格说明*.md`、`*API文档*.md`。

### 2.2 缺失时自动生成

当接口规格说明书缺失时，调用 MCP 脚本工具从 JSON 规格或源码生成：

```
调用 script_rn_render_spec_doc：
  - spec: {{libroot}}/interface-spec.json
  - libroot: {{libroot}}（与 spec 二选一）
  - output: {{libroot}}/{libName}接口规格说明.md
```

脚本将 JSON 接口规格渲染为人类可读的 Markdown 说明书文档。

### 2.3 读取说明书

读取生成的或已有的接口规格说明书，作为 Demo 设计的主要依据。说明书中的平台差异标注、参数说明、示例代码将用于 Demo 步骤编写。

> 接口规格说明书渲染的详细说明参见 [script_rn_render_spec_doc 文档](https://gitcode.com/OpenHarmony-RN)

---

## Phase 3：Demo 覆盖率扫描

> 本阶段在接口规格就绪后（标准路径）或直接作为入口（快捷路径）、源码分析前执行，确定全量/增量模式及待生成接口范围。
>
> **快捷路径**：当 `hasCoverageReport` 为 true 时，跳过 3.1（文档检查可选）和 3.2（覆盖率扫描），直接执行 3.3（解析已有报告）和 3.4（确定模式）。

### 3.1 检查已有 Demo 描述文档

> 快捷路径下此步骤可选，仅用于记录文档是否存在。

在 `libroot` 目录下查找是否已存在 Demo 描述文档：

| 查找目标 | 文件名模式 |
|----------|-----------|
| Demo 描述文档 | `{libName}RN测试demo描述.md` |

| 查找结果 | 后续动作 |
|----------|----------|
| 文档不存在 | 进入全量模式，扫描覆盖率用于记录基线（可选） |
| 文档已存在 | 进入增量模式，需扫描覆盖率找出未覆盖接口 |

### 3.2 执行 Demo 覆盖率扫描

> ⏭️ **快捷路径跳过**：当 `hasCoverageReport` 为 true 时，**跳过此步骤**，直接使用 `coverageReport` 参数指向的已有报告，进入 3.3 解析。

调用 MCP 脚本工具分析现有 Demo 对接口的覆盖情况：

```
调用 script_rn_analyze_demo_coverage：
  - libroot: {{libroot}}
  - spec: {{libroot}}/interface-spec.json
  - output: {{libroot}}/02-{libName}-Demo覆盖率报告.md
  - mode: auto（可选）
  - version: {{version}}（可选）
```

脚本自动完成：检测 Demo 源码目录（`example/src` 等）、扫描源码文件、AST/正则匹配接口调用、生成 Markdown 覆盖率报告。

> 该脚本即为 `rnoh-lib-demo-coverage` SKILL 调用的脚本，详见同目录 Skill 说明。

### 3.3 解析覆盖率报告

读取覆盖率报告（快捷路径下为 `coverageReport` 参数指向的已有报告；标准路径下为 3.2 生成的报告），提取关键信息：

| 报告章节 | 提取内容 | 用途 |
|----------|----------|------|
| 覆盖率总览 | 总接口数 N、已覆盖数 M、未覆盖数、覆盖率百分比 | 记录基线统计 |
| 已覆盖接口详情 | 接口名、类名、覆盖来源文件 | 构建 `coveredSet` |
| 未覆盖接口详情 | 接口名、类名、参数、返回类型、说明 | 构建 `uncoveredList` |

### 3.4 确定模式与待生成范围

根据 3.1 的查找结果和 3.3 的解析结果确定模式：

| 条件 | 模式 | 待生成范围 |
|------|------|-----------|
| 文档不存在 | 全量模式 | 所有 HarmonyOS 可用接口（Phase 5 过滤后） |
| 文档已存在，未覆盖接口 > 0 | 增量模式 | 仅未覆盖接口（经 Phase 5 平台过滤后） |
| 文档已存在，未覆盖接口 = 0 | 终止 | 输出"所有接口已覆盖，无需生成新 Demo" |

**派生变量更新**：
- `mode`：`full` 或 `incremental`
- `coveredSet`：已覆盖接口集合（类名.方法名）
- `uncoveredList`：未覆盖接口列表（含详细信息）
- `coverageReportPath`：覆盖率报告路径（快捷路径下为 `coverageReport` 参数值）

> 覆盖率报告解析的详细规则与边界处理参见 [覆盖率增量过滤指南](references/COVERAGE_INCREMENTAL.md)

---

## Phase 4：源码补充分析

> **快捷路径下本阶段尤为关键**：由于跳过了 Phase 1 & 2，未覆盖接口的精确签名、默认值、回调数据格式等信息需完全从源码中提取。从覆盖率报告中获取未覆盖接口的类名和接口名后，定位到对应源码文件读取详细实现。

> ⚠️ **源码分析边界（强制）**：本阶段提取的信息**仅用于完善 Demo 步骤细节**（函数签名、参数类型、默认值、事件名称、回调数据结构等）。**严禁**将源码中的平台分支判断（`Platform.OS`）、TurboModule Spec 定义情况、原生实现是否存在等作为 Phase 5 平台过滤的依据。平台过滤的唯一依据是 README 文档的「HarmonyOS Support」标注（详见 Phase 5.2）。原因：源码中缺失鸿蒙实现可能是**适配遗漏**而非官方不支持，需通过 Demo 验证来发现此类问题，而非在过滤阶段直接排除。

接口规格 JSON 和说明书可能未覆盖所有细节，需结合源码补充：

### 4.1 读取源码关键文件

| 文件 | 补充内容 |
|------|----------|
| `src/index.ts` / `index.js` | 导出方式、默认导出、命名导出 |
| `src/*.d.ts` | 类型定义、参数详细类型、可选参数 |
| `harmony/xxx/TurboModule.ts` | TurboModule 方法签名、原生事件定义（仅用于补充签名，不用于判断平台支持） |
| `src/constants.ts` | 常量值、枚举实际值 |
| `README.md` | 使用示例、平台差异说明、已知限制 |
| `.upstream-cache/*/src/*.tsx` | 上游源码（快捷路径下从覆盖率报告的接口名定位到此处的精确签名） |

### 4.2 接口名 → 源码位置定位策略

从 `uncoveredList` 中每个接口的类名 + 接口名出发，按以下优先级定位源码定义位置：

| 优先级 | 搜索范围 | 搜索模式 | 适用场景 |
|--------|----------|----------|----------|
| 1 | `src/specs/Native*.ts` | `interface.*{接口名}` 或 `{接口名}.*:` | TurboModule/Fabric 层接口（fabric 层级） |
| 2 | `.upstream-cache/*/src/*.tsx` | `export.*{接口名}` 或 `function {接口名}` 或 `const {接口名}` | JS 层导出函数/变量/Hook |
| 3 | `.upstream-cache/*/src/*.ts` | `export.*{接口名}` 或 `interface {接口名}` | 类型定义/接口定义 |
| 4 | `src/*.tsx` / `src/*.ts` | 同上 | 鸿蒙化仓库本地覆盖的源码 |
| 5 | `lib/typescript/*.d.ts` | `{接口名}` | 编译后的类型声明文件（兜底） |

**定位后提取内容**：
- 完整函数签名（参数名、参数类型、可选标记、返回类型）
- JSDoc 注释（`@param`、`@returns`、`@deprecated`、平台标注）
- 类型注解和 interface 定义
- 默认参数值（如 `timeout = 10000`）

> **搜索工具**：使用 `grep` 搜索 `export (const|function|interface|type) {接口名}` 定位定义点，或直接搜索 `{接口名}` 在源码中的出现位置。覆盖率报告中的"层级"字段（js/fabric）可用于优先选择搜索范围。

### 4.3 接口别名/重复检测

未覆盖接口可能是其他接口的别名（常见于 `@deprecated` 废弃接口）。检测别名关系有助于 Demo 分组和行为一致性验证：

| 别名模式 | 源码特征 | 检测方法 | 示例 |
|----------|----------|----------|------|
| 变量别名 | `export const A = B` | 搜索 `export const {接口名} = ` | `export const SafeAreaContext = SafeAreaInsetsContext` |
| 函数别名 | `export function A() { return B() }` | 搜索 `function {接口名}` + 函数体是否仅 `return B()` | `export function useSafeArea() { return useSafeAreaInsets() }` |
| 属性别名 | `export const A = B.Consumer` 或 `export const A = B.Provider` | 搜索 `= .*\.Consumer` / `= .*\.Provider` | `export const SafeAreaConsumer = SafeAreaInsetsContext.Consumer` |
| 常量派生 | `export const A = B?.insets` 或 `export const A = B?.x` | 搜索 `= .*\.?.*` 模式 | `export const initialWindowSafeAreaInsets = initialWindowMetrics?.insets` |
| 接口继承 | `interface A extends B` | 搜索 `interface {接口名} extends` | `interface SafeAreaProviderProps extends ViewProps` |

**别名关系记录**：为每个检测到别名关系的接口记录：
- `aliasTarget`：别名指向的原始接口名
- `aliasType`：别名模式（变量别名/函数别名/属性别名/常量派生）
- `isDeprecated`：是否标记为 `@deprecated`

> **别名关系在 Phase 6 的用途**：同一底层 API 的多个别名优先合并到同一 Demo，并在 Demo 描述中说明别名关系和 `@deprecated` 状态。Demo 步骤中验证别名与原始接口行为一致性（返回值对比、`===` 引用比较等）。详见 [Demo 设计规则 §6.7 废弃别名模式](references/DEMO_DESIGN_RULES.md)。

### 4.4 提取补充信息

从源码注释和实现中提取：

- **默认参数值**：函数参数的默认值（如 `timeout = 10000`）
- **错误码/异常类型**：throw 语句、Promise reject 的错误对象
- **事件名称**：`NativeEventEmitter` 发出的事件名字符串
- **平台差异标注**：`Platform.OS === 'ios'` / `'android'` / `'harmony'` 判断
- **回调数据格式**：事件回调的数据结构字段
- **使用示例**：README 或注释中的代码示例
- **README 接口说明表**：README.md 中若包含"HarmonyOS平台支持"列表格，提取每个接口的平台支持状态（yes/no/partially），作为 Phase 5 平台过滤的**唯一依据**（详见 Phase 5.2）。**注意**：README 中未列出的接口视为无平台标注，默认跨平台，不因源码缺失实现而排除

> 源码补充信息仅用于完善 Demo 步骤细节（函数签名、参数类型、默认值、事件名称、回调数据格式等），不得引入规格中未定义的接口。
>
> ⚠️ **平台过滤边界**：源码中的 `Platform.OS` 分支判断、TurboModule Spec 是否定义、原生层是否实现等信息**不作为**平台过滤依据。这些信息仅用于 Demo 步骤设计（如标注"建议验证 HarmonyOS 平台实际可用性"）和预期结果诊断指标设计（如"若回调未触发，可能为鸿蒙化适配遗漏"）。

---

## Phase 5：接口能力清单构建 + 平台过滤 + 覆盖率增量过滤

### 5.1 构建接口能力清单

将 Phase 1-4 获取的信息整合为内部能力清单（不写入输出文件）：

```
能力清单结构：
┌─────────────────────────────────────────────────┐
│ HarmonyOS 平台可用接口                           │
│   模块 A（NativeModules / TurboModules）         │
│     - methodA(param): Promise<Result> [✅ 跨平台]│
│     - methodB(): void               [✅ 鸿蒙支持]│
│     - methodC(): void               [❌ iOS 专用]│
│   模块 B（React 组件）                           │
│     - <ComponentX prop1={} onEvent={} />         │
│   模块 C（Hook）                                 │
│     - useXxxHook(config): { value, setValue }    │
│ 事件：XxxModule.addListener('eventName', cb)     │
│ 常量：MODULE_CONSTANTS.KEY = 'value'             │
└─────────────────────────────────────────────────┘
```

### 5.2 HarmonyOS 平台过滤

> ⚠️ **过滤依据（强制）**：平台过滤**仅依据 README 文档**的「HarmonyOS Support」列（或等效的接口说明表/平台支持表）。**禁止**通过源码（`Platform.OS` 分支判断、TurboModule Spec 定义、原生实现是否存在）进行平台过滤。原因：源码中缺失鸿蒙实现可能是**适配遗漏**而非官方不支持，需通过 Demo 验证来发现此类问题，而非在过滤阶段直接排除。

#### 5.2.1 数据源

| 数据源 | 用途 | 说明 |
|--------|------|------|
| README.md「接口说明」/「HarmonyOS Support」列 | **唯一过滤依据** | 鸿蒙化维护者在 README 中标注的平台支持状态（yes/no/partially）代表官方确认的支持情况 |
| 接口规格 JSON / 说明书中的平台标注 | 辅助参考 | 标准/快捷路径下，若 README 无平台支持表但接口规格 JSON 中有平台标注，可作为辅助依据 |
| 源码 `Platform.OS` 分支 | **禁止用于过滤** | 仅用于 Demo 步骤设计，标注平台行为差异 |
| TurboModule Spec 定义情况 | **禁止用于过滤** | 仅用于补充签名信息 |
| 原生层实现是否存在 | **禁止用于过滤** | 缺失可能是适配遗漏 |

#### 5.2.2 过滤规则

| README「HarmonyOS Support」标注 | 处理方式 | 说明 |
|--------------------------------|----------|------|
| `no` | **排除**，不生成 Demo | 鸿蒙化维护者明确标注不支持 |
| `yes` | **优先生成** Demo | 鸿蒙化维护者明确标注支持 |
| `partially` | **生成 Demo**，步骤中标注部分支持 | 需在 Demo 步骤中说明哪些子功能可用 |
| 接口在 README 接口表中**未列出** | **视为无平台标注**，默认跨平台，生成 Demo | 上游新增接口但鸿蒙化 README 未及时收录；可能是适配遗漏，需通过 Demo 验证发现 |
| 无平台标注（README 有接口但无 Support 列） | 默认视为跨平台，生成 Demo 但建议验证 | 标准/快捷路径下 README 无平台支持表时的默认行为 |

#### 5.2.3 排除接口记录

对每个排除的接口，记录以下信息用于输出文档：

| 字段 | 说明 |
|------|------|
| 接口名称 | 被排除的接口签名 |
| README 标注 | README「HarmonyOS Support」列的值（`no`） |
| README 行号 | 标注所在行号（便于追溯） |
| 排除原因 | 基于 README 文档标注排除 |

> 排除接口清单需在输出文档中以独立章节呈现，明确标注排除依据为 README 文档标注（非源码分析）。

#### 5.2.4 保留接口的 Demo 设计要求

对于 README 未列出或无平台标注而保留的接口，在 Demo 设计中须：

1. **Demo 描述中标注**："README 中未列出此接口，建议验证 HarmonyOS 平台实际可用性"
2. **预期结果中设计诊断指标**：如"若回调未触发（callbackCount 保持 0），可能为鸿蒙化适配遗漏，需进一步排查"
3. **双计数器模式**：通过 callCount 与 callbackCount 的对比，诊断接口在 HarmonyOS 平台是否实际可用

### 5.3 覆盖率增量过滤（仅增量模式）

当 Phase 3 确定为增量模式时，在平台过滤之后额外执行覆盖率过滤：

将 5.2 平台过滤后的接口清单与 Phase 3 构建的 `coveredSet` 取差集，仅保留**未覆盖**的接口：

```
待生成接口 = (HarmonyOS 可用接口) - (coveredSet 中已覆盖接口)
```

记录以下信息用于输出文档的概述章节：
- 增量模式标识
- 覆盖率报告来源路径
- 总接口数 / 已覆盖数 / 本次待生成数
- 已排除的已覆盖接口列表（简要）

> 当增量模式下未覆盖接口为空时，输出文档标注"所有 HarmonyOS 可用接口均已由现有 Demo 覆盖，无需生成新 Demo"。
>
> 覆盖率过滤的详细规则参见 [覆盖率增量过滤指南](references/COVERAGE_INCREMENTAL.md)

### 5.4 过滤结果汇总

经过 5.2（平台过滤）和 5.3（覆盖率过滤，如有）后，得到最终的**待生成 Demo 接口清单**：

| 模式 | 过滤链 | 待生成范围 |
|------|--------|-----------|
| 全量模式 | 平台过滤 | 所有 HarmonyOS 可用接口 |
| 增量模式 | 平台过滤 → 覆盖率过滤 | 仅 HarmonyOS 可用且未被现有 Demo 覆盖的接口 |

---

## Phase 6：Demo 设计与分组

### 6.1 Demo 分组原则

**原则一**：每个待生成接口（Phase 5 过滤后）至少被一个 Demo 覆盖。

> 全量模式下覆盖所有 HarmonyOS 可用接口；增量模式下仅覆盖未覆盖接口。

**原则二**：关联接口可合并到同一 Demo（调用依赖、完整业务场景、同主题功能簇、事件配对）。

> 增量模式下，若未覆盖接口与已覆盖接口存在调用依赖，可将未覆盖接口合并到新 Demo 中独立描述，不依赖已覆盖接口的 Demo 步骤。

**原则三**：禁止无关合并，不同功能方向的接口不得强行合并。

> 分组规则的完整说明与示例参见 [Demo 设计规则](references/DEMO_DESIGN_RULES.md)

### 6.2 Demo 五要素

每个 Demo 包含五个要素：

| 要素 | 说明 |
|------|------|
| ① 名称 | `[功能动词/名词][操作对象][场景]Demo`，≤20字 |
| ② 描述 | 2-4句话，说明功能、目的、覆盖接口，标注 HarmonyOS 特性 |
| ③ 步骤 | 编号列表，以 RN 函数式组件为载体，含 useState/useEffect/接口调用/setXxx()更新 |
| ④ 预期结果 | 编号列表，具体可观测指标，标注 HarmonyOS 平台预期行为 |
| ⑤ 对应函数接口 | 列出该 Demo 涉及的所有函数签名 |

### 6.3 强制规则

- **禁止死按钮**：每个按钮（触发接口调用的步骤）必须对应至少一条 UI 可观测的预期结果
- **useState 强制更新**：所有计数器、状态标志变量必须通过 `setXxx()` 更新，否则 RN 不触发重新渲染
- **异步回调双计数器**：涉及 Promise/事件回调的 Demo 必须设计双计数器（`callCount` + `callbackCount`），两者都须在验证区域展示并用 `useState` setter 更新

> 双计数器模式与 useState 规则的详细说明参见 [Demo 设计规则](references/DEMO_DESIGN_RULES.md)

### 6.4 生成策略优先级

1. **核心功能 Demo**（P0）：覆盖最主要的跨平台功能接口
2. **完整流程 Demo**（P1）：展示"初始化 → 核心操作 → 释放"完整生命周期
3. **HarmonyOS 权限配置 Demo**（P1）：若涉及权限需求
4. **组合能力 Demo**（P1）：关联接口合并，展示完整使用链路
5. **参数变体 Demo**（P2）：同一接口的不同参数组合（可选）

---

## Phase 7：文档生成与质量校验

### 7.1 生成输出文档

使用输出模板生成 `{libName}RN测试demo描述.md`，文档包含以下章节：

1. **概述**：文档目的、**来源声明**（根据路径动态生成）、平台说明、**模式标识**（全量/增量）
2. **Demo 总览**：Demo 数量、覆盖接口数量、生成日期
3. **测试 Demo 描述列表**：五列表格（序号、名称、描述、步骤、预期结果、对应接口）
4. **接口覆盖矩阵**：接口名称、所在 Demo、覆盖状态

**概述章节来源声明规则**：

| 路径 | 来源声明内容 |
|------|------------|
| 标准路径（全量模式） | "本文档基于 `{库名}` 库的接口规格（`interface-spec.json`）和接口规格说明书（`{libName}接口规格说明.md`）生成" |
| 标准路径（增量模式） | "本文档基于 `{库名}` 库的接口规格和 Demo 覆盖率报告生成" |
| 快捷路径（增量模式） | "本文档基于 `{库名}` 库的 Demo 覆盖率报告（`{coverageReport}`）和源码分析生成" |

> ⚠️ 快捷路径下**不得**在概述中声称"基于接口规格（interface-spec.json）"或"基于接口规格说明书"，因为这两个文件未生成。来源声明必须与实际使用的数据源一致。

> 增量模式下，概述章节额外说明覆盖率报告来源、总接口数/已覆盖数/本次生成数。

> 输出文档结构与字段规范参见 [输出格式规范](references/OUTPUT_FORMAT.md)
> 可直接复制的输出模板参见 [Demo 文档模板](assets/DEMO_DOC_TEMPLATE.md)

### 7.2 质量校验

生成文档前完成以下检查：

| 检查项 | 标准 |
|--------|------|
| 接口覆盖完整性 | 所有**待生成**接口（Phase 5 过滤后）至少被一个 Demo 覆盖 |
| 增量模式一致性 | 增量模式下，输出文档中不包含已覆盖接口的 Demo（与覆盖率报告一致） |
| 来源声明准确性 | 概述章节的来源声明与实际路径一致；快捷路径下不得提及 interface-spec.json 或接口规格说明书 |
| 内容真实性 | 接口名称、参数类型、返回值与源码/规格严格一致 |
| 步骤可执行性 | 步骤具体可执行，开发者可按步骤实现 Demo 页面 |
| 预期结果可验证 | 每条预期结果可观测、可判断 |
| 无死按钮 | 每个按钮有可观测预期结果；iOS/Android 专用接口不作为主步骤 |
| useState 完整性 | 所有计数器/状态标志注明 `setXxx()` 更新；异步链路有双计数器（Hook/Context/常量模式无需双计数器，参见 Demo 设计规则 §6.1） |
| 接口模式适配 | Demo 步骤与接口模式匹配（Hook 顶层调用、Consumer render props、HOC 包装等，参见 Demo 设计规则 §6） |
| 平台差异标注 | HarmonyOS 平台差异在步骤中明确标注 |
| iOS/Android 排除 | 已移除所有 README 标注 `no` 的接口的 Demo |
| 平台过滤依据 | 平台过滤仅依据 README 文档标注，未使用源码（`Platform.OS` 分支、TurboModule Spec、原生实现）作为过滤依据；README 未列出的接口已保留并生成 Demo |
| 未列出接口处理 | README 中未列出的接口已生成 Demo，Demo 描述中标注"建议验证"，预期结果中设计诊断指标（回调未触发等） |

> 完整质量检查清单参见 [质量检查清单](references/QUALITY_CHECKLIST.md)

### 7.3 输出产物

最终输出文件：

- **`{outputPath}`** — `{libName}RN测试demo描述.md`，Demo 描述文档（**始终生成**）

标准路径额外产物（无已有覆盖率报告时）：

- **`{libroot}/interface-spec.json`** — 接口规格 JSON（若 Phase 1 生成了）
- **`{libroot}/{libName}接口规格说明.md`** — 接口规格说明书（若 Phase 2 生成了）
- **`{libroot}/02-{libName}-Demo覆盖率报告.md`** — Demo 覆盖率报告（若 Phase 3 生成了）

> **快捷路径**（提供 `coverageReport` 时）：仅生成 Demo 描述文档，不生成 `interface-spec.json`、接口规格说明书和覆盖率报告，避免冗余全量产物。

输出确认信息包含：生成的文件列表、**模式**（全量/增量）、**路径**（标准/快捷）、Demo 数量、覆盖接口数量、排除的 iOS/Android 接口列表。增量模式下额外输出：覆盖率报告来源、总接口数、已覆盖数、本次生成数。

---

## 参考资料

- [Demo 设计规则](references/DEMO_DESIGN_RULES.md) — 分组原则、五要素、双计数器、useState 规则
- [覆盖率增量过滤指南](references/COVERAGE_INCREMENTAL.md) — 覆盖率报告解析、已覆盖接口提取、增量过滤规则
- [输出格式规范](references/OUTPUT_FORMAT.md) — 文档结构、表格格式、字段填写规范
- [质量检查清单](references/QUALITY_CHECKLIST.md) — 完整质量校验项
- [Demo 文档模板](assets/DEMO_DOC_TEMPLATE.md) — 可直接复制的输出模板
- React Native 官方文档：https://reactnative.dev
- RNOH 官方文档：https://gitcode.com/OpenHarmony-RN/usage-docs/tree/master/zh-cn
