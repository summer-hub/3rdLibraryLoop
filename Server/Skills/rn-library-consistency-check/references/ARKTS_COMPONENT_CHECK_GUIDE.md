# ArkTS @Component 层一致性检视指南

本指南定义 RN 鸿蒙化一致性检视中 **ArkTS @Component struct 层**（Props 读取、Commands 实现、Events 发送、build() 渲染）的检视规范，确保 AI Agent 能系统性地读取和分析 ArkTS 组件代码，检测 rawProps 断桥、Commands fall-through、事件 emit 缺失、build() 渲染断桥等问题。

---

## 1. 适用条件与前置依赖

### 1.1 适用条件

当 `harmony/<module>/src/main/ets/` 目录存在 `@Component struct` 定义时，必须执行本指南的检视流程。若目录不存在或无 @Component struct，标注"⚠️ 无 ArkTS 组件层"并跳过。

### 1.2 前置依赖

- Phase 0 中已定位的组件名列表
- C++ JSIBinder/NapiBinder Props 列表（来自 CPP_COMPONENT_CHECK_GUIDE）
- 上游 JS NativeProps 定义
- OHOS generated Props 类型（`ComponentNameEtsProps.ts` / `ComponentNameEtsComponent.ts`）

### 1.3 与其他检视指南的关系

| 检视指南 | 检视层级 | 本指南关注点 |
|----------|----------|-------------|
| CPP_COMPONENT_CHECK_GUIDE | C++ 组件层 | JSIBinder Props 序列化、NapiBinder 桥接、Package 注册 |
| CPP_TURBOMODULE_CHECK_GUIDE | C++ TurboModule 层 | TurboModuleFactoryDelegate、TurboModule JSIBinder 方法绑定 |
| ARKTS_COMPONENT_CHECK_GUIDE（本文件） | ArkTS @Component 层 | rawProps 读取、Commands switch、事件 emit、build() 渲染 |
| ARKTS_TURBOMODULE_CHECK_GUIDE | ArkTS TurboModule 层 | TurboModule ArkTS 实现类、方法完整性、Stub 检测、常量导出、回调逻辑 |

---

## 2. 文件定位与读取

### 2.1 ArkTS @Component struct 定位

**搜索路径**：`harmony/<module>/src/main/ets/`

| 步骤 | 搜索目标 | 搜索模式 | 目的 |
|------|----------|----------|------|
| 2.1a | @Component struct 定义 | `@Component struct <组件名>` | 定位 ArkTS 组件实现 |
| 2.1b | 组件注册 | `DescriptorWrapper` / `createDescriptorWrapperFactoryByDescriptorType` | 确认组件在 Package 中注册 |
| 2.1c | generated Props 类型 | `generated/components/<组件名>EtsProps.ts` 或 `generated/RNOH/generated/components/<组件名>EtsComponent.ts` | 确认 Codegen Props 类型定义 |
| 2.1d | generated Commands 类型 | `generated/components/<组件名>EtsCommandPayload.ts` | 确认 Codegen Commands Payload 定义 |

**必须读取的文件清单**：

| # | 文件 | 说明 |
|---|------|------|
| 1 | `<组件名>.ets`（主实现文件） | 包含 @Component struct 定义、rawProps 读取、build() 方法 |
| 2 | `generated/components/<组件名>EtsProps.ts`（若存在） | Codegen Props 类型定义 |
| 3 | `generated/components/<组件名>EtsCommandPayload.ts`（若存在） | Codegen Commands Payload 定义 |
| 4 | `generated/components/<组件名>EtsEventEmitRequestHandler.ts`（若存在） | Codegen 事件处理器定义 |

### 2.2 @Component struct 必读内容（四个维度）

#### 维度 A：Props 读取

```
1. struct 内的成员变量声明
   → 提取所有 rawProps.propName 读取表达式
   → 提取所有 this.propName = rawProps.propName as <类型> 赋值表达式

2. rawProps 读取方式
   → DirectRawProps: rawProps.propName（Codegen 模式）
   → 手动读取: this.propsManager.getLocalProp(...)（Legacy 模式）

3. Props 使用位置
   → 在 build() 方法中哪些 rawProps 成员被传递给了原生组件属性
   → 在 aboutToAppear/aboutToDisappear 中哪些 rawProps 成员被使用
```

**Props 读取提取模板**：

```markdown
| # | Prop 名 | OHOS 类型 | ArkTS rawProps 读取 | as-类型断言 | build() 使用 | 原生属性 | 文件:行号 | 状态 |
|---|---------|----------|-------------------|------------|-------------|---------|----------|------|
| 1 | `javaScriptEnabled` | `boolean?` | `rawProps.javaScriptEnabled` | `as boolean` | ✅ `.javaScriptAccess()` | `javaScriptAccess` | `RNCWebView.ets:112` | ✅ |
| 2 | `injectedJavaScript` | `string?` | `rawProps.injectedJavaScript` | `as string` | ✅ `.runJavaScript()` | `runJavaScript` | `RNCWebView.ets:87` | ✅ |
| 3 | `allowFileAccessFromFileURLs` | `boolean?` | ⛔ 未读取 | — | ⛔ 未使用 | — | — | ❌ 断桥 |
```

#### 维度 B：Commands 实现

```
1. @Component struct 中是否有 Command handler 方法
   → 方法名通常为 handleCommand 或类似命名
   → 方法签名：(commandName: string, ...args: <类型>)

2. Command 处理方式
   → switch(commandName) { case "commandName": ... }
   → if (commandName === "commandName") { ... }

3. 每个 Command 的实现
   → 是否调用了正确的原生组件方法
   → 是否存在 fall-through bug（switch 缺少 break 或 return）

4. Command 参数处理
   → Command Payload 参数是否从 args 中正确提取
   → 参数类型转换是否正确
```

**Commands 提取模板**：

```markdown
| # | Command 名 | JS Spec Commands | ArkTS handler | ArkTS 实现逻辑 | fall-through | 文件:行号 | 状态 | 扣分 |
|---|-----------|----------------|-------------|--------------|-------------|----------|------|------|
| 1 | `goBack` | ✅ `goBack(): void` | ✅ `case "goBack"` | `webviewController.backward()` | ✅ 有 break | `RNCWebView.ets:130` | ✅ | 0 |
| 2 | `loadUrl` | ✅ `loadUrl(url: string)` | ✅ `case "loadUrl"` | `webviewController.loadUrl(url)` | ⛔ fall-through | `RNCWebView.ets:132` | ❌ | -10 |
| 3 | `injectJavaScript` | ✅ `injectJavaScript(script)` | ⛔ 未实现 | — | — | — | ❌ | -15 |
```

#### 维度 C：Events 发送

```
1. @Component struct 中的事件 emit 方式
   → this.eventEmitter.emitEvent(eventName, payload)
   → 直接调用 ArkTS 原生组件的 onXxx 回调

2. 事件 Payload 数据
   → 提取每个 emitEvent 的 payload 字段
   → 与上游 JS event.nativeEvent 字段对比

3. 事件触发时机
   → 在原生组件的 onXxx 回调中触发 emitEvent
   → 在 aboutToAppear 或其他生命周期中触发
```

**Events 提取模板**：

```markdown
| # | 事件名 | 上游 JS onXxx | C++ EventEmitHandler | ArkTS emitEvent | ArkTS Payload | 上游 nativeEvent | Payload缺失 | 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|--------------------|----------------|--------------|----------------|-----------|----------|------|------|
| 1 | `loadingStart` | `onLoadingStart` ✅ | ✅ | ✅ `{url: ...}` | `{url: string}` | `{url: string}` | — | `RNCWebView.ets:140` | ✅ | 0 |
| 2 | `contentSizeChange` | `onContentSizeChange` ✅ | ✅ | ⛔ 未 emit | — | `{width, height}` | width, height | — | ❌ | -8 |
| 3 | `message` | `onMessage` ✅ | ✅ | ✅ `{data: ...}` | `{data: string}` | `{data: string}` | — | `RNCWebView.ets:150` | ✅ | 0 |
```

#### 维度 D：build() 渲染

```
1. build() 方法中使用的原生组件
   → 提取所有原生组件属性设置（.xxx(this.xxx) 或 .xxx(rawProps.xxx))

2. 原生组件属性 vs rawProps Prop 映射
   → 每个 .xxx() 调用是否使用了正确的 rawProps Prop
   → rawProps 中读取了但未传递给原生组件的 Prop（渲染断桥）

3. 条件渲染逻辑
   → if/else 条件渲染是否与上游一致
   → 三元表达式是否与上游一致

4. 非 rawProps 来源的原生属性设置
   → 提取所有 .xxx(value) 中 value 不来自 rawProps 的原生属性
   → 记录值、值来源类型（硬编码/条件计算/辅助函数/成员变量）
   → 标注与哪些 rawProps Prop 存在条件依赖关系（副作用标记）
```

> **维度 A-D 的完整检视步骤与扣分规则见第 3 节各检查点**。本节仅提供文件定位与数据提取模板。

---

## 3. 检视项与扣分规则

> 本指南覆盖 `arktsComp` 类型实体，检视项按五个关键检查点组织：**Props、Command、Methods、Callback、Lifecycle**。每个检查点自包含完整检查方法。

### 3.0 前置过滤：原生注册缺失检测（优先级最高）

> ⚠️ **此步骤必须在所有 Props/Command 级检视（3.1-3.5）之前执行**。未注册的 Component 整体不可达，其内部 Props/Commands/Events 逐项检视会导致重复扣分且无实际意义。

- **检查项**: 原生注册缺失检测
- **适用场景**: 当 JS/TS Spec 注册的 Component 名（`codegenNativeComponent` 注册名）在 ArkTS Package 中未注册时，该组件整体不可达（JS 代码无法渲染该原生组件），此时应跳过该组件内部所有 Props/Commands/Events 的逐项检视。
- **特征检索方式**:
  1. 在 JS 层组件注册文件中提取 `codegenNativeComponent` 注册名
  2. 在 `*Package.ets` 中提取 `createDescriptorWrapperFactoryByDescriptorType` 方法中的组件名
- **检视步骤**:
  1. 读取 JS 层组件注册文件，提取所有 `codegenNativeComponent` 注册名 → 列表Comp_js
  2. 读取 `*Package.ets` 的 `createDescriptorWrapperFactoryByDescriptorType` 方法，提取所有组件名 → 列表Comp_registered
  3. 对每个 Comp_js 中的名称，检查是否存在于 Comp_registered 中
  4. 判定规则：
     - **Component 已注册** → ✅ 通过，继续 3.1-3.5 的正常 Props/Command 级检视
     - **Component 未注册** → ❌ 致命，扣 -15/实体名，**跳过该组件内部所有 Props/Commands/Events/Lifecycle 的逐项检视**
  5. 将跳过的 Component 记入输出表，明确标注"⛔ 跳过逐项检查"
- **扣分规则**: 未注册→致命-15/实体名；跳过的内部检查项不计入致命问题计数
- **输出格式**:

```markdown
| # | 实体类型 | JS/TS Spec 注册名 | ArkTS Package 注册 | 状态 | 致命度 | 扣分 | 内部检视 |
|---|---------|-----------------|-------------------|------|--------|------|---------|
| 1 | Component | `RNCWebView` | ✅ 已注册 | ✅ 通过 | — | 0 | 继续逐项检视 |
| 2 | Component | `RNCMapMarker` | ❌ 未注册 | ❌ 致命 | -15 | ⛔ 跳过 |
```

**⚠️ 关键说明**：
- 跳过的组件内部检查项**不计入致命问题计数**，避免因 Props/Commands 逐项重复扣分触发归零规则
- 此规则仅适用于 Component 整体未注册的场景。若 Component 已注册但部分 Props 缺失，仍按 3.1 检查项的正常规则扣分

---

### 3.1 检查点：Props

#### 检查项概要

| # | 检查项 | 所属维度 | 对比对象 | 致命度 |
|---|--------|----------|----------|--------|
| 1 | rawProps 读取完整性 | ①契约一致性 | ArkTS 实际读取的 rawProps Prop vs OHOS generated Props 类型 | 中等/轻微 |
| 2 | Props 类型断言一致性 | ①契约一致性 | ArkTS `rawProps.xxx as Yyy` vs OHOS generated 类型定义 | 轻微 |
| 3 | Props 默认值一致性 | ①契约一致性 | ArkTS `rawProps.xxx ?? defaultValue` vs 上游 WithDefault 默认值 | 轻微 |
| 4 | build() 渲染断桥 | ①契约一致性 | rawProps 中读取的 Prop 是否在 build() 中传递给原生组件 | 中等/轻微 |
| 5 | Props 实现逻辑一致性 | ②平台实现差异 | ArkTS build() 中 Prop 主映射逻辑 vs Android/iOS 同名 Prop 渲染逻辑 | 严重/致命 |
| 6 | Props 副作用&关联影响分析 | ②平台实现差异 | Prop 在 build() 中影响的所有原生属性（含间接/条件影响）vs Android/iOS；无文档说明的副作用 → 致命 | 致命/严重 |
| 7 | build() 非 rawProps 属性跨平台默认值一致性 | ②平台实现差异 | build() 中非 rawProps 来源的原生属性值 vs Android/iOS 同属性默认/初始值 | 严重/中等 |

#### ①契约一致性

**检查项 1：rawProps 读取完整性**

- **检查项**: rawProps 读取完整性
- **特征检索方式**: 在 `<组件名>.ets` 文件中 grep `rawProps\.`，提取所有 `rawProps.propName` 访问表达式；在 `generated/components/<组件名>EtsProps.ts` 或 `<组件名>EtsComponent.ts` 中提取所有 Prop 名
- **检视步骤**:
  1. 读取 `@Component struct` 所在 `.ets` 文件，提取所有 `rawProps.propName` 访问表达式 → 列表 A
  2. 读取 `generated/components/<组件名>EtsProps.ts`（若不存在则读 `<组件名>EtsComponent.ts`），提取所有 Prop 名 → 列表 B
  3. 对比 A vs B：B 有但 A 无 → ArkTS 端断桥
  4. 判定关键/次要：影响组件核心功能的 Prop（如 `source`、`javaScriptEnabled`）→ 关键 Prop；仅影响外观或次要行为的 Prop（如 `padding`、`insetAdjustmentBehavior`）→ 次要 Prop
- **扣分规则**: 关键 Prop 未读取 -5 分/个；次要 Prop 未读取 -3 分/个
- **输出格式**:

| # | Prop 名 | OHOS 类型 | ArkTS 读取 | 断桥判定 | 关键/次要 | 扣分 |
|---|---------|----------|-----------|---------|----------|------|
| 1 | `javaScriptEnabled` | `boolean?` | ✅ `rawProps.javaScriptEnabled` | ✅ 无断桥 | 关键 | 0 |
| 2 | `allowFileAccessFromFileURLs` | `boolean?` | ⛔ 未读取 | ❌ ArkTS 端断桥 | 次要 | -3 |

---

**检查项 2：Props 类型断言一致性**

- **检查项**: Props 类型断言一致性
- **特征检索方式**: 在 `<组件名>.ets` 文件中 grep `as ` 类型断言模式，提取所有 `rawProps.xxx as Yyy` 表达式；在 `generated/components/<组件名>EtsProps.ts` 中读取每个 Prop 的声明类型
- **检视步骤**:
  1. 从 `@Component struct` 所在 `.ets` 文件提取所有 `rawProps.xxx as Yyy` 表达式，记录 propName 和 assertedType
  2. 从 `generated/components/<组件名>EtsProps.ts` 读取每个 Prop 的声明类型
  3. 对比：assertedType 与 declaredType 不一致 → 类型断言错误
- **扣分规则**: 类型断言不一致 -4 分/个
- **输出格式**:

| # | Prop 名 | ArkTS 断言类型 | OHOS 声明类型 | 一致性 | 扣分 |
|---|---------|--------------|-------------|--------|------|
| 1 | `javaScriptEnabled` | `boolean` | `boolean?` | ✅ | 0 |
| 2 | `source` | `string` | `Source?` | ❌ 不一致 | -4 |

---

**检查项 3：Props 默认值一致性**

- **检查项**: Props 默认值一致性
- **特征检索方式**: 在 `<组件名>.ets` 文件中 grep `\?\?` 或 `\|\|` 默认值模式，提取所有 `rawProps.xxx ?? defaultValue` 或 `rawProps.xxx \|\| defaultValue` 表达式；在上游 NativeProps WithDefault 注解中读取默认值
- **检视步骤**:
  1. 从 `@Component struct` 所在 `.ets` 文件提取所有 `rawProps.xxx ?? defaultValue` 或 `rawProps.xxx \|\| defaultValue` 表达式
  2. 从上游 NativeProps WithDefault 注解读取每个 Prop 的默认值
  3. 对比：ArkTS 默认值与上游 WithDefault 默认值不一致 → 默认值错误
- **扣分规则**: 默认值不一致 -4 分/个
- **输出格式**:

| # | Prop 名 | ArkTS 默认值 | 上游 WithDefault 默认值 | 一致性 | 扣分 |
|---|---------|------------|----------------------|--------|------|
| 1 | `javaScriptEnabled` | `false` | `false` | ✅ | 0 |
| 2 | `cacheEnabled` | `true` | `false` | ❌ 不一致 | -4 |

---

**检查项 4：build() 渲染断桥**

- **检查项**: build() 渲染断桥
- **特征检索方式**: 在 `<组件名>.ets` 文件中定位 `build()` 方法，提取所有 `.nativeComponentProp(this.arktsProp)` 或类似表达式；结合检查项 1 的列表 A（rawProps 读取列表）
- **检视步骤**:
  1. 从检查项 1 的列表 A 中识别所有已读取的 rawProps Prop
  2. 读取 `build()` 方法，提取所有 `.nativeComponentProp(this.arktsProp)` 或 `.nativeComponentProp(rawProps.xxx)` 表达式 → 列表 C
  3. 对比：在列表 A 中已读取但未在列表 C 中传递给原生组件 → 渲染断桥
  4. 判定关键/次要：同检查项 1 规则
- **扣分规则**: 关键 Prop 渲染断桥 -5 分/个；次要 Prop 渲染断桥 -3 分/个
- **输出格式**:

| # | Prop 名 | rawProps 读取 | build() 传递 | 原生组件属性 | 渲染断桥 | 关键/次要 | 扣分 |
|---|---------|-------------|-------------|-----------|---------|----------|------|
| 1 | `javaScriptEnabled` | ✅ | ✅ `.javaScriptAccess()` | `javaScriptAccess` | ✅ 无断桥 | 关键 | 0 |
| 2 | `injectedJavaScript` | ✅ | ⛔ 未传递 | — | ❌ 渲染断桥 | 关键 | -5 |

---

#### ②平台实现差异

**检查项 5：Props 实现逻辑一致性**

> ⚠️ **注意**：检查项5仅对比 Prop 的"主映射"逻辑一致性（Prop → 其自然对应的原生属性）。若 Prop 还影响了其他原生属性（副作用），须在检查项6中单独分析。

- **检查项**: Props 实现逻辑一致性
- **特征检索方式**: 在 `<组件名>.ets` 的 `build()` 方法中提取每个 Prop 传递给原生组件的映射逻辑；在 Android ViewManager 中 grep `@ReactProp` 读取对应 setter 实现；在 iOS ViewManager 中 grep `RCT_EXPORT_VIEW_PROPERTY` 读取对应 handler
- **检视步骤**:
  1. 从 ArkTS `build()` 方法提取每个 Prop 如何变换并传递给原生组件（如 `rawProps.source as Resource` → `.src($rawProps.source)`）
  2. 从 Android ViewManager 读取 `@ReactProp` setter 实现中同名 Prop 的实际渲染逻辑
  3. 从 iOS ViewManager 读取 `RCT_EXPORT_VIEW_PROPERTY` handler 中同名 Prop 的实际渲染逻辑
  4. 对比三端实际行为：ArkTS 逻辑 vs Android 逻辑 vs iOS 逻辑，关注值变换、条件分支、副作用等
- **扣分规则**: 逻辑不一致 -8 分/个（关键 Prop，影响核心功能）至 -15 分/个（致命 Prop，导致功能完全不可用）；次要 Prop -5 分/个
- **输出格式**:

| # | Prop 名 | ArkTS 实现逻辑 | Android 实现逻辑 | iOS 实现逻辑 | 一致性 | 致命度 | 扣分 |
|---|---------|--------------|----------------|-------------|--------|--------|------|
| 1 | `source` | `.src($rawProps.source as Resource)` | `setSource(uri)` → `loadUrl(uri)` | `setSource(uri)` → `loadRequest(uri)` | ✅ 三端一致 | — | 0 |
| 2 | `scalesPageToFit` | `.zoomAccess(rawProps.scalesPageToFit as boolean)` | `setScalesPageToFit` → `setUseWideViewPort` | `setScalesPageToFit` → `scrollView.scalesPageToFit` | ❌ ArkTS 语义不同 | 严重 | -8 |

---

**检查项 6：Props 副作用&关联影响分析**

- **检查项**: Props 副作用&关联影响分析
- **定义**: 一个 Prop 除了直接影响其"自然映射"的原生属性（主映射）外，还可能通过条件表达式、辅助函数、计算逻辑等方式**间接影响其他原生属性或功能点**（副作用/关联影响）。这些副作用必须与 Android/iOS 进行跨平台对比，且需溯源文档说明。ArkTS @Component 的 build() 始终是实际渲染层，不存在"仅桥接转发"的情况，因此所有 Props 副作用均需在本层分析。
- **特征检索方式**:
  1. 对每个 ArkTS rawProps Prop，在 build() 方法中 grep 所有引用该 Prop 的表达式
  2. 对每个引用，追踪其最终影响的原生属性（.xxx() 调用目标）
  3. 将每个 Prop 的影响范围分类为：
     - 主映射：Prop → 其自然对应的原生属性（如 source → .src()，已在检查项5覆盖）
     - 副作用：Prop → 非自然对应的原生属性（如 forceDarkOn → .backgroundColor()）
     - 关联影响：Prop → 辅助函数/条件逻辑 → 多个原生属性（如 forceDarkOn → getColorMode() → .darkMode() + .backgroundColor()）
  4. 对 build() 中的条件表达式/辅助函数调用，如果引用了多个 rawProps Prop，标注"多Prop联合副作用"

- **检视步骤**:
  1. 从 ArkTS rawProps 读取列表提取所有 Props → 列表 P
  2. 从 ArkTS build() 提取每个 Prop 的**完整影响范围** → 影响图 G
     （对每个 Prop，列出它在 build() 中直接影响的所有 .xxx() 原生属性调用）
  3. 将影响图 G 中的每个影响分类为主映射/副作用/关联影响
  4. 对每个副作用/关联影响，在 Android/iOS 同名 Prop 的实现中查找：
     Android/iOS 是否也影响同一原生属性或功能点？
  5. 若 Android/iOS 无此副作用：
     a. 查阅接口规格说明.md 中是否有对此副作用的明确文档说明
     b. 查阅 README、docs 目录、上游 JS Spec 或 NativeProps 注释中是否有说明
     c. 判定：
        - 有文档说明且合理 → 合理差异（轻微 -3/处，归入平台适配合理性维度）
        - 有文档说明但不合理 → 严重问题（-12/处）
        - 无文档说明 → 致命问题（-15/处）

- **扣分规则**:
  无文档说明的副作用（OHOS 有副作用，Android/iOS 无，且无任何文档解释）-15 分/处（致命）
  有文档说明但不合理的副作用（文档标注了但理由不成立）-12 分/处（严重）
  有文档说明且合理的副作用（如 README 注明平台特有行为）-3 分/处（轻微，归入平台适配合理性）
  主映射不一致（已在检查项5覆盖）不重复扣分

- **输出格式**:

| # | Prop 名 | 主映射原生属性 | 副作用/关联影响原生属性 | Android/iOS 是否有同副作用 | 文档说明 | 文档合理性 | 致命度 | 扣分 |
|---|---------|-------------|-------------------|--------------------------|---------|-----------|--------|------|
| 1 | `forceDarkOn` | .darkMode() | .backgroundColor(White/Transparent条件) | ❌ Android始终Transparent，与forceDarkOn无关 | ❌ 接口规格说明、README均未说明 | — | 致命 | -15 |
| 2 | `scrollEnabled` | .setScrollable() | 无 | ✅ | — | — | — | 0 |

---

**检查项 7：build() 非 rawProps 属性跨平台默认值一致性**

- **检查项**: build() 非 rawProps 属性跨平台默认值一致性
- **定义**: build() 中部分原生属性的值不来自 rawProps（硬编码常量、条件表达式、辅助函数计算、成员变量默认值），这些默认值应与 Android/iOS 同属性的默认/初始值一致。不一致时需溯源文档说明。
- **特征检索方式**:
  1. 在 `<组件名>.ets` 的 build() 方法中提取所有 `.nativeAttribute(value)` 调用
  2. 识别其中 value 不是 rawProps.xxx 或 this.xxx（来自rawProps）的调用
  3. 在 Android ViewManager/Wrapper 初始化代码中定位同属性的默认值设置
  4. 在 iOS View 初始化代码（initWithFrame/didMoveToWindow/setBackgroundColor 等）中定位同属性的默认值设置

- **检视步骤**:
  1. 从 build() 提取所有非 rawProps 来源的原生属性设置 → 列表 N
     （记录：属性名、值/表达式、值来源类型[硬编码/条件计算/辅助函数/成员变量]）
  2. 从 Android 初始化代码（createViewInstance/RNCWrapper init 等）提取同属性默认值 → 列表 NA
  3. 从 iOS 初始化代码（initWithFrame/didMoveToWindow/setBackgroundColor 等）提取同属性默认值 → 列表 NI
  4. 对比 N vs NA vs NI：默认值不一致 → 按影响范围判定
  5. 对不一致的默认值，执行文档溯源判定：
     a. 查阅接口规格说明.md、README、docs 目录是否有文档说明
     b. 判定：
        - 有文档说明且合理 → 合理差异（轻微 -3/处）
        - 有文档说明但不合理 → 严重问题（核心 -12/处，次要 -8/处）
        - 无文档说明 → 按影响范围扣分（核心 -12/处，次要 -8/处）

- **扣分规则**:
  核心行为属性默认值不一致且无文档说明 -12 分/处（严重）
  次要行为属性默认值不一致且无文档说明 -8 分/处（中等）
  有文档说明的合理差异 -3 分/处（轻微，归入平台适配合理性）
  有文档说明但不合理的差异：核心 -12 分/处，次要 -8 分/处

- **输出格式**:

| # | 原生属性 | OHOS build() 值 | 值来源类型 | Android 默认值 | iOS 默认值 | 一致性 | 文档说明 | 影响范围 | 扣分 |
|---|---------|----------------|-----------|-------------|-----------|--------|---------|---------|------|
| 1 | backgroundColor | getColorMode===On ? White : Transparent | 条件计算 | TRANSPARENT（始终） | clearColor（始终） | ❌ | ❌ 无文档 | 核心行为 | -12 |
| 2 | forceDarkAccess | this.forceDark(默认true) | 成员变量 | DARK_STRATEGY | 系统自动 | ✅ 功能一致 | — | — | 0 |

---

#### ③架构桥接一致性

由 ①契约一致性 和 ②平台实现差异 共同覆盖。若 ① 中发现 rawProps 读取断桥，则 C++ 层序列化传入但 ArkTS 未使用，属架构桥接断桥；若 ② 中发现逻辑不一致，则跨平台行为不一致，属架构桥接偏差。无需单独检查。

---

### 3.2 检查点：Command

#### 检查项概要

| # | 检查项 | 所属维度 | 对比对象 | 致命度 |
|---|--------|----------|----------|--------|
| 1 | Command 注册完整性 | ①契约一致性 | ArkTS Command handler case 列表 vs 上游 JS Spec NativeCommands | 致命 |
| 2 | Command 签名一致性 | ①契约一致性 | ArkTS Command handler 方法签名 vs 上游 JS Spec Command 签名 | 致命 |
| 3 | Command 参数类型 | ①契约一致性 | Command Payload 参数类型转换 vs generated CommandPayload 类型定义 | 致命 |
| 4 | Command fall-through | ①契约一致性 | switch/if-else 每个 case 是否有 break/return | 严重 |
| 5 | Command 实现逻辑一致性 | ②平台实现差异 | ArkTS Command handler 调用的原生组件方法 vs Android/iOS 同名 Command 实际行为 | 严重/致命 |
| 6 | Command 边界处理 | ②平台实现差异 | ArkTS Command 边界条件 vs Android/iOS 边界处理 | 中等 |

#### ①契约一致性

**检查项 1：Command 注册完整性**

- **检查项**: Command 注册完整性
- **特征检索方式**: 在 `<组件名>.ets` 文件中 grep `case "` 或 `handleCommand`，提取所有 Command case 分支；在上游 JS Spec 中 grep `NativeCommands` 或 `Commands` 提取所有 Command 名；在文档中搜索不支持标注
- **检视步骤**:
  1. 读取 `@Component struct` 所在 `.ets` 文件，找到 Command handler 方法（`handleCommand` 或类似命名）
  2. 从 switch 或 if-else 结构中提取所有 `case "commandName"` 或 `commandName === "xxx"` → 列表 C
  3. 读取上游 JS Spec NativeCommands 类型定义，提取所有 Command 名 → 列表 D
  4. 对比 C vs D：D 有但 C 无 → Command 缺失
  5. **🟢 豁免检查（优先级高于扣分）**：对每个 ArkTS 缺失的 Command，检查文档是否标注不支持：
     - 查找 **接口规格说明**（如 `接口规格说明.md`），该 Command 行是否有 `(Android only)`、`(iOS only)`、`(不支持)` 等标注
     - 查找 **OHOS README**（如 `harmony/README.md`），"HarmonyOS Support" 列是否为 "No"，"Platform" 列是否非 "All" 且非 "HarmonyOS"
     - 查找 **源码注释**，是否有 `// not supported`、`// Android only` 等标注
  6. 判定规则：
     - 🟢 **文档已标注不支持** → 豁免，0分，标注"🟢 文档标注不支持（来源：文件:行号）"
     - ❌ **文档未标注不支持** → Command 缺失→致命-15分/个
- **扣分规则**: Command 缺失 -15 分/个（致命）；文档标注不支持→豁免0分（不计入致命问题计数）
- **输出格式**:

| # | Command 名 | JS Spec | ArkTS handler | 文档标注不支持 | 文档来源 | 缺失判定 | 扣分 |
|---|-----------|---------|-------------|--------------|---------|---------|------|
| 1 | `goBack` | ✅ | ✅ `case "goBack"` | — | — | ✅ 无缺失 | 0 |
| 2 | `clearFormData` | ✅ | ⛔ 未实现 | ✅ Android only, HarmonyOS Support: No | README.md:380 | 🟢 豁免不扣分 | 0 |
| 3 | `injectJavaScript` | ✅ | ⛔ 未实现 | ❌ 无标注 | — | ❌ Command 缺失 | -15 |

---

**检查项 2：Command 签名一致性**

- **检查项**: Command 签名一致性
- **特征检索方式**: 在 `<组件名>.ets` 文件中读取 Command handler 方法签名；在上游 JS Spec 中读取 NativeCommands 各 Command 签名
- **检视步骤**:
  1. 从 `@Component struct` 读取 Command handler 方法签名，记录参数数量和类型
  2. 从 JS Spec NativeCommands 读取各 Command 签名，记录参数数量和类型
  3. 对比：参数数量或类型不一致 → 签名错误
- **扣分规则**: 签名不一致 -8 分/个；参数数量缺失 -10 分/个
- **输出格式**:

| # | Command 名 | JS Spec 签名 | ArkTS handler 签名 | 一致性 | 扣分 |
|---|-----------|-------------|-------------------|--------|------|
| 1 | `goBack` | `(): void` | `(): void` | ✅ | 0 |
| 2 | `loadUrl` | `(url: string): void` | `(args: EsObject[]): void` | ❌ 参数类型不一致 | -8 |

---

**检查项 3：Command 参数类型**

- **检查项**: Command 参数类型
- **特征检索方式**: 在 `<组件名>.ets` 文件中读取 Command handler 内 args 提取和类型转换逻辑；在 `generated/components/<组件名>EtsCommandPayload.ts` 中读取声明参数类型
- **检视步骤**:
  1. 从 Command handler 读取 args 提取方式（如 `args[0] as string`、`args[0]?.asString()` 等），记录每个参数的提取表达式和目标类型
  2. 从 `generated/components/<组件名>EtsCommandPayload.ts` 读取每个 Command 的声明参数类型
  3. 对比：提取的目标类型与声明类型不一致 → 类型致命错误
- **扣分规则**: 参数类型致命错误 -15 分/个
- **输出格式**:

| # | Command 名 | 参数名 | ArkTS 提取类型 | generated 声明类型 | 一致性 | 扣分 |
|---|-----------|--------|--------------|------------------|--------|------|
| 1 | `loadUrl` | `url` | `string` | `string` | ✅ | 0 |
| 2 | `injectJavaScript` | `script` | `EsObject` | `string` | ❌ 类型致命错误 | -15 |

---

**检查项 4：Command fall-through**

- **检查项**: Command fall-through
- **特征检索方式**: 在 `<组件名>.ets` 文件中读取 Command handler 的 switch 语句结构，逐 case 检查 break/return
- **检视步骤**:
  1. 定位 `switch(commandName)` 结构（或 if-else 链）
  2. 对每个 case 分支，检查是否有 `break` 或 `return` 语句
  3. 无 break/return → fall-through bug
  4. 检查 fall-through 后进入的下一个 case 是否有实际业务逻辑：
     - 下一个 case 有逻辑 → 逻辑 fall-through（双重 bug）
     - 下一个 case 仅 break/return → 空 fall-through（代码不规范）
  5. 对 if-else 链：检查每个 if 条件是否独立且无重叠，检查是否有 else 分支兜底
- **扣分规则**: 逻辑 fall-through（进入有业务逻辑的下一个 case）-10 分/个；空 fall-through（进入仅 break 的下一个 case）-3 分/个；if-else 条件重叠 -5 分/个
- **输出格式**:

| # | Command 名 | case 分支 | break/return | fall-through 类型 | 影响的下一个 case | 扣分 |
|---|-----------|----------|-------------|------------------|----------------|------|
| 1 | `goBack` | `case "goBack"` | ✅ 有 break | — | — | 0 |
| 2 | `loadUrl` | `case "loadUrl"` | ⛔ 无 break | 逻辑 fall-through | `case "reload"` | -10 |
| 3 | `stopLoading` | `case "stopLoading"` | ⛔ 无 break | 空 fall-through | `case "___": break` | -3 |

---

#### ②平台实现差异

**检查项 5：Command 实现逻辑一致性**

- **检查项**: Command 实现逻辑一致性
- **特征检索方式**: 在 `<组件名>.ets` 的 Command handler 中提取每个 Command 调用的原生组件方法；在 Android ViewManager 中 grep `receiveCommand` 读取同名 Command 实现；在 iOS ViewManager 中 grep `RCT_EXPORT_METHOD` 读取同名 Command 实现
- **检视步骤**:
  1. 从 ArkTS handler 读取每个 Command 调用的原生组件方法及调用参数
  2. 从 Android ViewManager 读取 `receiveCommand()` 实现中同名 Command 的实际行为
  3. 从 iOS ViewManager 读取 `RCT_EXPORT_METHOD` 中同名 Command 的实际行为
  4. 对比三端实际行为：ArkTS vs Android vs iOS，关注方法调用链、参数变换、副作用等
- **扣分规则**: 逻辑不一致 -10 分/个（严重）至 -15 分/个（致命，导致功能完全不可用）
- **输出格式**:

| # | Command 名 | ArkTS 实现逻辑 | Android 实现逻辑 | iOS 实现逻辑 | 一致性 | 致命度 | 扣分 |
|---|-----------|--------------|----------------|-------------|--------|--------|------|
| 1 | `goBack` | `webviewController.backward()` | `goBack()` | `goBack()` | ✅ 三端一致 | — | 0 |
| 2 | `reload` | `webviewController.refresh()` | `reload()` | `reload()` | ❌ 方法语义不同 | 严重 | -10 |

---

**检查项 6：Command 边界处理**

- **检查项**: Command 边界处理
- **特征检索方式**: 在 `<组件名>.ets` 的 Command handler 中读取每个 Command 的边界条件处理（如参数为 null/undefined、索引越界等）；在 Android/iOS 中读取同名 Command 的边界处理
- **检视步骤**:
  1. 从 ArkTS handler 读取每个 Command 的边界条件处理（如 `if (args[0] === undefined) return`、`try-catch` 等）
  2. 从 Android/iOS 读取同名 Command 的边界条件处理
  3. 对比：边界处理策略不一致 → 中等偏差
- **扣分规则**: 边界处理不一致 -8 分/个
- **输出格式**:

| # | Command 名 | ArkTS 边界处理 | Android 边界处理 | iOS 边界处理 | 一致性 | 扣分 |
|---|-----------|--------------|----------------|-------------|--------|------|
| 1 | `loadUrl` | `if (!url) return` | `if (url == null) return` | `if (!url) return` | ✅ 三端一致 | 0 |
| 2 | `injectJavaScript` | 无边界检查 | `if (script == null) return` | `if (!script) return` | ❌ ArkTS 缺失边界检查 | -8 |

---

#### ③架构桥接一致性

由 ①契约一致性 覆盖。若 ① 中发现 Command 注册缺失，则 JS 调用 Command 但 ArkTS 不响应，属架构桥接断桥。无需单独检查。

---

### 3.3 检查点：Methods

#### 检查项概要

| # | 检查项 | 所属维度 | 对比对象 | 致命度 |
|---|--------|----------|----------|--------|
| 1 | 组件名注册一致性 | ①契约一致性 | ArkTS Package createDescriptorWrapperFactoryByDescriptorType 组件名 vs 上游 codegenNativeComponent 组件名 | 中等 |

#### ①契约一致性

**检查项 1：组件名注册一致性**

- **检查项**: 组件名注册一致性
- **特征检索方式**: 在 `Package.ets` 文件中 grep `createDescriptorWrapperFactoryByDescriptorType`，提取所有组件 descriptor 注册及名称；在上游 JS 文件中 grep `codegenNativeComponent`，提取 `codegenNativeComponent('组件名')` 参数
- **检视步骤**:
  1. 从 `Package.ets` 提取所有 `createDescriptorWrapperFactoryByDescriptorType` 注册的组件名及 descriptor 名 → 列表 M
  2. 从上游 JS 文件读取 `codegenNativeComponent('组件名')` 参数 → 列表 N
  3. 对比 M vs N：组件名不一致 → 注册偏差
- **扣分规则**: 组件名注册不一致 -5 分/个
- **输出格式**:

| # | 组件名 | ArkTS Package 注册名 | 上游 codegenNativeComponent 名 | 一致性 | 扣分 |
|---|--------|-------------------|-----------------------------|--------|------|
| 1 | `RNCWebView` | `RNCWebView` | `RNCWebView` | ✅ | 0 |
| 2 | `RNCModal` | `RNModal` | `RNCModal` | ❌ 不一致 | -5 |

---

#### ②平台实现差异

N/A — Methods 检查点仅关注组件名注册一致性，不涉及平台实现差异对比。

#### ③架构桥接一致性

由 ①契约一致性 覆盖。若 ① 中发现组件名注册不一致，则 JS 端与 ArkTS 端的组件名映射出错，属架构桥接偏差。无需单独检查。

---

### 3.4 检查点：Callback

#### 检查项概要

| # | 检查项 | 所属维度 | 对比对象 | 致命度 |
|---|--------|----------|----------|--------|
| 1 | Events emit 完整性 | ①契约一致性 | ArkTS emitEvent 事件名 vs 上游 JS onXxx DirectEventHandler Props | 严重 |
| 2 | Events Payload 完整性 | ①契约一致性 | ArkTS emitEvent payload 字段 vs 上游 JS event.nativeEvent 字段 | 中等 |
| 3 | 回调触发时机一致性 | ②平台实现差异 | ArkTS emitEvent 触发时机 vs Android/iOS 事件触发条件 | 严重 |

#### ①契约一致性

**检查项 1：Events emit 完整性**

- **检查项**: Events emit 完整性
- **特征检索方式**: 在 `<组件名>.ets` 文件中 grep `emitEvent` 或 `this.eventEmitter`，提取所有 `this.eventEmitter.emitEvent(eventName, payload)` 调用；在上游 NativeProps 中提取所有 `onXxx` DirectEventHandler Prop 名
- **检视步骤**:
  1. 从 `@Component struct` 提取所有 `this.eventEmitter.emitEvent(eventName, payload)` 调用 → 列表 E（事件名集合）
  2. 从上游 NativeProps 提取所有 `onXxx` DirectEventHandler Prop 名 → 列表 F（事件名集合）
  3. 对比 E vs F：F 有但 E 无 → 事件 emit 缺失
- **扣分规则**: 事件 emit 缺失 -8 分/个
- **输出格式**:

| # | 事件名 | 上游 JS onXxx | C++ EventEmitHandler | ArkTS emitEvent | 缺失判定 | 扣分 |
|---|--------|-------------|--------------------|----------------|---------|------|
| 1 | `loadingStart` | `onLoadingStart` ✅ | ✅ | ✅ | ✅ 无缺失 | 0 |
| 2 | `contentSizeChange` | `onContentSizeChange` ✅ | ✅ | ⛔ 未 emit | ❌ 事件 emit 缺失 | -8 |

---

**检查项 2：Events Payload 完整性**

- **检查项**: Events Payload 完整性
- **特征检索方式**: 在 `<组件名>.ets` 文件中提取每个 `emitEvent` 调用的 payload 字段；在上游 JS Spec 中读取 `event.nativeEvent` 类型定义
- **检视步骤**:
  1. 从 `@Component struct` 提取每个 `emitEvent` 调用的 payload 字段（如 `{url: this.webUrl, loading: true}`）
  2. 从 JS Spec 读取 `event.nativeEvent` 类型定义，提取每个事件的字段列表
  3. 对比：Payload 字段缺失 → 中等偏差
- **扣分规则**: Payload 字段缺失 -3 分/个字段
- **输出格式**:

| # | 事件名 | ArkTS Payload 字段 | 上游 nativeEvent 字段 | 缺失字段 | 扣分 |
|---|--------|------------------|--------------------|---------|------|
| 1 | `loadingStart` | `{url, loading}` | `{url, loading}` | — | 0 |
| 2 | `contentSizeChange` | `{width}` | `{width, height}` | `height` | -3 |

---

#### ②平台实现差异

**检查项 3：回调触发时机一致性**

- **检查项**: 回调触发时机一致性
- **特征检索方式**: 在 `<组件名>.ets` 中读取每个 `emitEvent` 调用所在上下文（在原生组件 onXxx 回调中、在 aboutToAppear 中、在定时器中等）；在 Android ViewManager 中 grep `RCTEventEmitter.receiveEvent` 读取触发条件；在 iOS ViewManager 中 grep `RCTDirectEventBlock` 读取触发条件
- **检视步骤**:
  1. 从 ArkTS `@Component struct` 读取每个 `emitEvent` 的调用时机（如在原生组件 `onPageBegin` 回调中、在 `aboutToAppear` 中等）
  2. 从 Android ViewManager 读取 `RCTEventEmitter.receiveEvent()` 的调用时机
  3. 从 iOS ViewManager 读取 `RCTDirectEventBlock` 的调用时机
  4. 对比三端触发条件：触发时机不一致 → 严重偏差
- **扣分规则**: 触发时机不一致 -8 分/个
- **输出格式**:

| # | 事件名 | ArkTS 触发时机 | Android 触发时机 | iOS 触发时机 | 一致性 | 扣分 |
|---|--------|-------------|----------------|------------|--------|------|
| 1 | `loadingStart` | `onPageBegin` 回调 | `onPageStarted` 回调 | `webViewDidStartLoad` 回调 | ✅ 三端一致 | 0 |
| 2 | `message` | `onMessage` 回调 | `onJsAlert` 回调 | `webView:runJavaScriptAlertPanelWithMessage` | ❌ 触发时机不同 | -8 |

---

#### ③架构桥接一致性

由 ①契约一致性 和 ②平台实现差异 共同覆盖。若 ① 中发现事件 emit 缺失，则 C++ 层有事件通道但 ArkTS 未触发，属架构桥接断桥；若 ② 中发现触发时机不一致，则跨平台行为不一致，属架构桥接偏差。无需单独检查。

---

### 3.5 检查点：Lifecycle

#### 检查项概要

| # | 检查项 | 所属维度 | 对比对象 | 致命度 |
|---|--------|----------|----------|--------|
| 1 | aboutToAppear 初始化一致性 | ②平台实现差异 | ArkTS aboutToAppear 初始化逻辑 vs Android ViewManager 初始化 | 中等 |
| 2 | aboutToDisappear 清理一致性 | ②平台实现差异 | ArkTS aboutToDisappear 清理逻辑 vs Android ViewManager onDestroy | 中等 |

#### ①契约一致性

N/A — Lifecycle 检查点不涉及契约一致性（aboutToAppear/aboutToDisappear 是 ArkTS 特有生命周期，无上游 JS Spec 契约可对比）。

#### ②平台实现差异

**检查项 1：aboutToAppear 初始化一致性**

- **检查项**: aboutToAppear 初始化一致性
- **特征检索方式**: 在 `<组件名>.ets` 文件中 grep `aboutToAppear`，提取初始化操作；在 Android ViewManager 中 grep `onCreateView` 或 `onStart`，读取初始化操作
- **检视步骤**:
  1. 从 `@Component struct` 读取 `aboutToAppear` 方法，提取所有初始化操作（如状态初始化、监听器注册、定时器启动等）→ 列表 P
  2. 从 Android ViewManager 读取 `onCreateView` / `onStart` 初始化操作 → 列表 Q
  3. 对比 P vs Q：初始化逻辑不一致 → 中等偏差
- **扣分规则**: 初始化逻辑不一致 -5 分/个
- **输出格式**:

| # | 初始化操作 | ArkTS aboutToAppear | Android onCreateView/onStart | 一致性 | 扣分 |
|---|----------|-------------------|---------------------------|--------|------|
| 1 | WebView 初始化 | `this.webviewController = new webview.WebviewController()` | `webView = new WebView(context)` | ✅ | 0 |
| 2 | JS 桥接注册 | ⛔ 未注册 | `webView.addJavascriptInterface()` | ❌ ArkTS 缺失 | -5 |

---

**检查项 2：aboutToDisappear 清理一致性**

- **检查项**: aboutToDisappear 清理一致性
- **特征检索方式**: 在 `<组件名>.ets` 文件中 grep `aboutToDisappear`，提取清理操作；在 Android ViewManager 中 grep `onDestroy`，读取清理操作
- **检视步骤**:
  1. 从 `@Component struct` 读取 `aboutToDisappear` 方法，提取所有清理操作（如监听器注销、定时器清除、资源释放等）→ 列表 R
  2. 从 Android ViewManager 读取 `onDestroy` 清理操作 → 列表 S
  3. 对比 R vs S：清理逻辑不一致 → 中等偏差
- **扣分规则**: 清理逻辑不一致 -5 分/个
- **输出格式**:

| # | 清理操作 | ArkTS aboutToDisappear | Android onDestroy | 一致性 | 扣分 |
|---|----------|----------------------|------------------|--------|------|
| 1 | 监听器注销 | `this.webviewController.off('pageBegin')` | `webView.setWebViewClient(null)` | ✅ | 0 |
| 2 | 定时器清除 | ⛔ 未清除 | `handler.removeCallbacks()` | ❌ ArkTS 缺失 | -5 |

---

#### ③架构桥接一致性

由 ②平台实现差异 覆盖。若 ② 中发现初始化或清理逻辑不一致，则跨平台行为不一致，属架构桥接偏差。无需单独检查。

---

## 4. 跨层断桥检测（ArkTS 端视角）

### 4.1 ArkTS 端断桥类型

| 断桥位置 | 识别方式 | 影响 | 扣分 |
|---------|----------|------|------|
| rawProps 读取断桥 | OHOS generated Props 类型有 Prop，但 @Component struct 未从 rawProps 读取 | C++ 序列化传入但 ArkTS 未使用 | 关键 -5/个，次要 -3/个 |
| 渲染断桥 | @Component 读取了 rawProps Prop，但 build() 中未传递给原生组件属性 | Prop 传入 ArkTS 但未渲染生效 | 关键 -5/个，次要 -3/个 |
| 事件 emit 断桥 | C++ EventEmitRequestHandler 注册了事件，但 @Component 未 emitEvent | C++ 层有事件通道但 ArkTS 未触发 | -8/个 |
| Command 断桥 | 上游 JS Spec 定义了 Command，但 @Component handler 中无对应 case | JS 调用 Command 但 ArkTS 不响应 | -15/个 |

### 4.2 全链路 Props 对比（ArkTS 端视角）

此对比表与 CPP_COMPONENT_CHECK_GUIDE 中的全链路表相同，但本指南侧重 ArkTS 端两列：

```markdown
| # | Prop 名 | 上游 NativeProps | C++ JSIBinder | C++ NapiBinder | OHOS DirectRawProps | ArkTS rawProps 读取 | ArkTS build() 传递 | 断桥位置 | 扣分 |
|---|---------|----------------|--------------|---------------|--------------------|-------------------|-------------------|---------|------|
| 1 | `javaScriptEnabled` | ✅ | ✅ | ✅ | ✅ boolean? | ✅ `rawProps.javaScriptEnabled as boolean` | ✅ `.javaScriptAccess()` | — | 0 |
| 2 | `injectedJavaScript` | ✅ | ✅ | ⛔ 无桥接 | ✅ string? | ✅ `rawProps.injectedJavaScript as string` | ✅ `.runJavaScript()` | C++→ArkTS | -5 |
| 3 | `allowFileAccessFromFileURLs` | ✅ | ✅ | ✅ | ✅ boolean? | ⛔ 未读取 | ⛔ 未传递 | ArkTS 读取断桥 | -5 |
```

---

## 5. fall-through 检测专项

### 5.1 fall-through 定义

switch 语句中某个 case 分支缺少 `break` 或 `return`，导致执行流意外滑入下一个 case。这在 ArkTS Commands handler 中是常见且致命的 bug。

### 5.2 检测方法

对每个 @Component struct 中的 Command handler switch/if-else 结构：

```
1. 定位所有 switch(commandName) 或类似结构
2. 对每个 case 分支：
   a. 检查是否有 break 或 return 语句
   b. 若无 → 标记为 fall-through bug
   c. 检查 fall-through 后进入的下一个 case 是否有实际业务逻辑
      → 如果下一个 case 也有逻辑 → 双重 bug（两个 Command 共享同一实现）
      → 如果下一个 case 仅是 break/return → 可能是开发遗留
3. 对 if-else 链：
   a. 检查每个 if 条件是否独立且无重叠
   b. 检查是否有 else 分支兜底
```

### 5.3 fall-through 严重度分类

| fall-through 类型 | 严重度 | 扣分 | 说明 |
|------------------|--------|------|------|
| 逻辑 fall-through（进入有业务逻辑的下一个 case） | 致命 | -10 | Command A 的执行意外触发 Command B 的逻辑 |
| 空 fall-through（进入仅 break 的下一个 case） | 轻微 | -3 | 无实际影响，但代码不规范 |
| if-else 条件重叠 | 中等 | -5 | 多个 Command 可能同时触发 |

---

## 6. 检视操作流程

### 6.1 Phase 0 补充步骤（ArkTS 组件定位）

```
ARK-1: 定位 @Component struct 定义
      → 搜索 harmony/<module>/src/main/ets/ 中的 @Component struct

ARK-2: 定位 generated Props 类型
      → 搜索 generated/components/*EtsProps.ts 或 generated/RNOH/generated/components/*EtsComponent.ts

ARK-3: 定位 generated Commands Payload
      → 搜索 generated/components/*EtsCommandPayload.ts

ARK-4: 定位 generated EventEmitRequestHandler
      → 搜索 generated/components/*EtsEventEmitRequestHandler.ts
```

### 6.2 Phase 3 补充步骤（ArkTS 组件分析）

```
ARK-5: Props 检查
      → 按 3.1 检查点逐项执行：rawProps 读取完整性、类型断言、默认值、渲染断桥、实现逻辑一致性、副作用&关联影响分析、非rawProps属性默认值

ARK-6: Command 检查
      → 按 3.2 检查点逐项执行：注册完整性、签名一致性、参数类型、fall-through、实现逻辑、边界处理

ARK-7: Methods 检查
      → 按 3.3 检查点逐项执行：组件名注册一致性

ARK-8: Callback 检查
      → 按 3.4 检查点逐项执行：Events emit 完整性、Payload 完整性、回调触发时机一致性

ARK-9: Lifecycle 检查
      → 按 3.5 检查点逐项执行：aboutToAppear 初始化一致性、aboutToDisappear 清理一致性
```

---

## 7. 报告输出格式

在一致性检视报告的"5.8 RN 架构一致性检视"中增加以下子章节：

### ArkTS @Component 层一致性（如适用）

```markdown
#### ArkTS @Component 层一致性

**ArkTS 组件模式**：{Codegen DirectRawProps / Legacy 手动读取 / ⚠️ 无 ArkTS 组件层}

**rawProps 读取完整性**：

| # | Prop 名 | OHOS 类型 | ArkTS 读取 | build() 传递 | 断桥位置 | 扣分 |
|---|---------|----------|-----------|-------------|---------|------|
| ... | ... | ... | ... | ... | ... | ... |

**Commands 实现一致性**：

| # | Command 名 | JS Spec | ArkTS handler | 实现逻辑 | fall-through | 扣分 |
|---|-----------|---------|-------------|---------|-------------|------|
| ... | ... | ... | ... | ... | ... | ... |

**Events emit 一致性**：

| # | 事件名 | JS onXxx | C++ Handler | ArkTS emit | Payload缺失 | 扣分 |
|---|--------|---------|------------|-----------|------------|------|
| ... | ... | ... | ... | ... | ... | ... |

**build() 渲染一致性**：

| # | Prop 名 | rawProps 读取 | build() 传递 | 原生组件属性 | 渲染断桥 | 扣分 |
|---|---------|-------------|-------------|-----------|---------|------|
| ... | ... | ... | ... | ... | ... | ... |
```

---

## 8. 与 CPP_COMPONENT_CHECK_GUIDE 的协同

本指南与 CPP_COMPONENT_CHECK_GUIDE 共享"全链路 Props 对比表"。检视执行顺序建议：

1. **先执行 CPP_COMPONENT_CHECK_GUIDE** → 获得 JSIBinder/NapiBinder/EventEmitRequestHandler 数据
2. **再执行 ARKTS_COMPONENT_CHECK_GUIDE** → 获得 rawProps 读取/build() 渲染/Commands/Events emit 数据
3. **合并两张表** → 生成完整全链路断桥分析

若两个指南独立执行，各自的全链路表可能存在重叠列。合并时以 Prop 名为主键，将两表的列拼接为完整链路。
