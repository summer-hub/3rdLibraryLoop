# C++ 组件层一致性检视指南

本指南定义 RN 鸿蒙化一致性检视中 **C++ 组件层**（JSIBinder、NapiBinder、Package、EventEmitRequestHandler）的检视规范，确保 AI Agent 能系统性地读取和分析 C++ 层代码，检测 Props 序列化断桥、NapiBinder 桥接缺失、事件注册缺失等问题。

---

## 1. 适用条件与前置依赖

### 1.1 适用条件

当 `harmony/<module>/src/main/cpp/` 目录存在时，必须执行本指南的检视流程。若目录不存在，标注"⚠️ 无 C++ 组件层"并跳过。

### 1.2 前置依赖

本指南依赖 Phase 0 中已定位的信息：
- 模块名（如 `rn_webview`、`rn_video`、`maps` 等）
- C++ Package 模式判定（Thin Wrapper vs Hand-Written）
- 组件名列表（从 Package 或 generated 中提取）

### 1.3 与其他检视指南的关系

| 检视指南 | 检视层级 | 本指南关注点 |
|----------|----------|-------------|
| CPP_COMPONENT_CHECK_GUIDE（本文件） | C++ 组件层 | JSIBinder Props 序列化、NapiBinder 桥接、Package 注册、EventEmitRequestHandler |
| CPP_TURBOMODULE_CHECK_GUIDE | C++ TurboModule 层 | TurboModuleFactoryDelegate、TurboModule JSIBinder 方法绑定 |
| ARKTS_COMPONENT_CHECK_GUIDE | ArkTS 组件层 | @Component struct 实现、rawProps 读取、Commands switch、事件 emit、build() 渲染 |
| ARKTS_TURBOMODULE_CHECK_GUIDE | ArkTS TurboModule 层 | TurboModule ArkTS 实现类、方法完整性、Stub 检测、常量导出、回调逻辑 |

---

## 2. 文件定位与读取

### 2.1 C++ Package 定位

**搜索路径**：`harmony/<module>/src/main/cpp/`

| 步骤 | 搜索目标 | 搜索模式 | 目的 |
|------|----------|----------|------|
| 2.1a | Package 头文件 | `*Package.h` | 定位 C++ Package 注册类 |
| 2.1b | Package 模式判定 | 类继承 `BaseReactNative*Package` vs `Package` | 确定 Thin Wrapper（Codegen）或 Hand-Written（Legacy） |
| 2.1c | Generated 基类 | `generated/RNOH/generated/BaseReactNative*Package.h` | Thin Wrapper 模式需读取此文件获取所有注册信息 |
| 2.1d | CMakeLists.txt | `CMakeLists.txt` | 确定编译源文件列表 |

**必须读取的文件清单**：

| 模式 | 必读文件 | 说明 |
|------|----------|------|
| Thin Wrapper | `*Package.h` + `generated/RNOH/generated/BaseReactNative*Package.h` | Package 仅继承基类，所有注册信息在 generated 基类中 |
| Hand-Written | `*Package.h` + `*Package.cpp`（如存在） | Package 手动实现所有注册方法，需逐方法读取 |

### 2.2 JSIBinder 定位与读取

| 模式 | JSIBinder 文件位置 | 说明 |
|------|-------------------|------|
| Codegen | `generated/RNOH/generated/components/ComponentNameJSIBinder.h` | 自动生成，Props 列表完整 |
| Legacy | `cpp/ComponentNameJSIBinder.h` 或 `cpp/components/ComponentNameJSIBinder.h` | 手动编写，需逐个检查 |

**必须读取的 JSIBinder 内容**：

```
1. createNativeProps() 方法（或 createJSIBinder() 方法）
   → 提取所有 obj.setProperty(rt, "propName", ...) 行
   → 每个 propName 即为 C++ 层注册的 Prop 名

2. Prop 默认值
   → 提取类成员变量：propName_ = defaultValue
   → 每个默认值需与上游 NativeProps WithDefault 值对比

3. createDirectEventTypes() 方法
   → 提取所有 events.setProperty(rt, "topXxx", createDirectEvent(rt, "onXxx")) 行
   → 每个 "topXxx" / "onXxx" 即为 C++ 层注册的事件名
```

**JSIBinder Props 提取模板**：

```markdown
| # | Prop 名 | C++ JSIBinder 默认值 | C++ 文件:行号 | 上游 NativeProps 是否有此 Prop | 状态 |
|---|---------|---------------------|-------------|------------------------------|------|
| 1 | `javaScriptEnabled` | `true` | `RNCWebViewJSIBinder.h:81` | ✅ | ✅ 一致 |
| 2 | `customProp` | `false` | `AIRMapJSIBinder.h:25` | ⛔ 无 | ❌ JS→C++ 多余注册 |
```

### 2.3 NapiBinder 定位与读取

| 模式 | NapiBinder 文件位置 | 说明 |
|------|-------------------|------|
| Codegen | `generated/RNOH/generated/components/ComponentNameNapiBinder.h`（若存在） | 自动生成 |
| Legacy | `cpp/ComponentNameNapiBinder.h` 或 `cpp/components/ComponentNameNapiBinder.h` | 手动编写 |
| 无 NapiBinder | — | 视图完全由 ArkTS 渲染，C++ 不需要向 ArkTS 传递 Props |

**必须读取的 NapiBinder 内容**（若文件存在）：

```
1. createNapiBinder() 方法
   → 提取所有 NapiBinder::setProperty(env, thisObj, "propName", propName_) 行
   → 每个 propName 即为 C++→ArkTS 桥接的 Prop 名

2. 比对 NapiBinder Prop 列表与 JSIBinder Prop 列表
   → JSIBinder 有但 NapiBinder 无 → C++→ArkTS 断桥
   → NapiBinder 有但 ArkTS 组件未使用 → ArkTS 端断桥
```

**若不存在 NapiBinder**：标注"⚠️ 无 NapiBinder（视图完全由 ArkTS 渲染）"，不扣分。

### 2.4 EventEmitRequestHandler 定位与读取

| 模式 | 文件位置 | 说明 |
|------|----------|------|
| Codegen | `generated/RNOH/generated/BaseReactNative*Package.h` 中 `EventEmitRequestHandler` 类 | 自动生成，包含 `supportedEventNames` 列表 |
| Legacy | `*Package.h/cpp` 中手写的 EventEmitRequestHandler | 手动实现 `handleEvent()` |

**必须读取的 EventEmitRequestHandler 内容**：

```
Codegen 模式：
1. 找到 supportedEventNames 数组（vector<string>）
2. 提取所有事件名字符串

Legacy 模式：
1. 找到 handleEvent() 方法
2. 提取所有 eventName 条件分支
```

**事件名提取模板**：

```markdown
| # | 事件名 | C++ EventEmitRequestHandler | 上游 JS onXxx Prop | OHOS EventPayloadByName | 状态 |
|---|--------|----------------------------|-------------------|------------------------|------|
| 1 | `loadingStart` | ✅ supportedEventNames 中 | `onLoadingStart` ✅ | ✅ "loadingStart" | ✅ 全链路一致 |
| 2 | `contentSizeChange` | ✅ supportedEventNames 中 | `onContentSizeChange` ✅ | ⛔ 无 emit 调用 | ❌ ArkTS 端断桥 |
```

---

## 3. 检视项与扣分规则（cppComp 五个关键检查点）

> 本指南覆盖 `cppComp` 类型实体，检视项按五个关键检查点组织：**Props、Command、Methods、Callback、Lifecycle**。每个检查点按三个维度展开：①契约一致性、②平台实现差异、③架构桥接一致性。

### 3.1 检查点：Props（属性传递与逻辑一致性）

#### 检查项概要

| # | 检查项 | 维度 | 扣分规则 | 致命度 |
|---|--------|------|----------|--------|
| 1 | Props传递完整性 | ①契约 | JS→C++断桥 -8分/个 | 致命 |
| 2 | Props类型一致性 | ①契约 | 类型不一致扣分（视严重度） | 中等 |
| 3 | Props默认值一致性 | ①契约 | 默认值不一致 -4分/个 | 轻微 |
| 4 | NapiBinder桥接完整性 | ①契约 | C++→ArkTS断桥 -5分/个 | 中等 |
| 5 | Props实现逻辑一致性 | ②平台 | 逻辑不一致 -8~-15分/个 | 严重/致命 |
| 6 | Props副作用&关联影响分析 | ②平台 | 无文档说明的副作用 -15分/处；有文档但不合理 -12分/处；有文档且合理 -3分/处 | 致命/严重 |
| 7 | 全链路Props断桥检测 | ③架构 | 按断桥位置分别计分 | 致命 |

#### ①契约一致性

**检查项1：Props传递完整性**

- **特征检索方式**：搜索 `obj.setProperty` in `*JSIBinder.h` 文件，提取所有 propName；搜索上游 NativeProps 类型定义中的 Prop 名列表
- **检视步骤**：
  1. 读取 JSIBinder.h 文件（路径：`generated/RNOH/generated/components/*JSIBinder.h` 或 `cpp/*JSIBinder.h`），提取所有 `obj.setProperty(rt, "propName", ...)` 行，构建 C++ Prop 列表 A
  2. 读取上游 JS NativeProps 类型定义文件，提取所有 Prop 名，构建上游 Prop 列表 B
  3. 对比 A vs B：B 有但 A 无 → JS→C++ 断桥；A 有但 B 无 → 多余注册
  4. 判定规则：JS→C++ 断桥（B有A无）-8分/个（致命）；多余注册（A有B无）-3分/个（轻微）
- **扣分规则**：JS→C++ 断桥 -8分/个；多余注册 -3分/个
- **输出格式**：

```markdown
| # | Prop 名 | 上游 NativeProps | C++ JSIBinder setProperty | 状态 | 扣分 |
|---|---------|----------------|--------------------------|------|------|
| 1 | `javaScriptEnabled` | ✅ | ✅ | ✅ 一致 | 0 |
| 2 | `injectedJavaScript` | ✅ | ⛔ 无 | ❌ JS→C++ 断桥 | -8 |
| 3 | `customProp` | ⛔ 无 | ✅ | ❌ 多余注册 | -3 |
```

**检查项2：Props类型一致性**

- **特征检索方式**：从 JSIBinder.h 提取成员变量类型声明或 setProperty 调用中的类型信息；从上游 NativeProps 提取类型注解
- **检视步骤**：
  1. 从 JSIBinder.h 提取每个 Prop 的类型信息（从成员变量声明如 `bool propName_` 或 setProperty 中的类型推断）
  2. 从上游 NativeProps 提取每个 Prop 的类型注解（如 `string?`、`boolean`、`WithDefault<boolean, true>`）
  3. 逐 Prop 对比 C++ 类型 vs 上游类型
  4. 判定规则：类型不匹配（如 C++ 用 bool 但上游为 string）扣分，视严重度而定
- **扣分规则**：类型不一致 -4~-8分/个（视影响范围）
- **输出格式**：

```markdown
| # | Prop 名 | 上游 NativeProps 类型 | C++ JSIBinder 类型 | 状态 | 扣分 |
|---|---------|--------------------|-------------------|------|------|
| 1 | `javaScriptEnabled` | `boolean` | `bool` | ✅ 一致 | 0 |
| 2 | `source` | `object` | `std::string` | ❌ 类型不匹配 | -8 |
```

**检查项3：Props默认值一致性**

- **特征检索方式**：从 JSIBinder.h 提取成员变量默认值赋值（`propName_ = defaultValue`）；从上游 NativeProps 提取 WithDefault 值
- **检视步骤**：
  1. 从 JSIBinder 类提取成员变量默认值（搜索 `propName_ = defaultValue` 模式）
  2. 从上游 NativeProps 提取 WithDefault 值（如 `WithDefault<boolean, true>` 中的 `true`）
  3. 逐 Prop 对比 C++ 默认值 vs 上游 WithDefault 值
  4. 判定规则：默认值不一致 -4分/个
- **扣分规则**：默认值不一致 -4分/个
- **输出格式**：

```markdown
| # | Prop 名 | 上游 WithDefault 值 | C++ 成员变量默认值 | 状态 | 扣分 |
|---|---------|-------------------|-------------------|------|------|
| 1 | `javaScriptEnabled` | `true` | `true` | ✅ 一致 | 0 |
| 2 | `cacheEnabled` | `false` | `true` | ❌ 默认值不一致 | -4 |
```

**检查项4：NapiBinder桥接完整性**

- **特征检索方式**：搜索 `NapiBinder::setProperty` 或 `setProperty(env, thisObj` in `*NapiBinder.h` 文件
- **检视步骤**：
  1. 读取 NapiBinder.h 文件（路径：`generated/RNOH/generated/components/*NapiBinder.h` 或 `cpp/*NapiBinder.h`），提取所有 `setProperty(env, thisObj, "propName", propName_)` 行，构建 NapiBinder Prop 列表 C
  2. 将列表 C 与步骤1中构建的 JSIBinder Prop 列表 A 对比
  3. A 有但 C 无 → C++→ArkTS 断桥
  4. 判定规则：JSIBinder 有但 NapiBinder 无（C++→ArkTS 断桥）-5分/个；若不存在 NapiBinder 文件，标注"⚠️ 无 NapiBinder"不扣分
- **扣分规则**：C++→ArkTS 断桥 -5分/个
- **输出格式**：

```markdown
| # | Prop 名 | C++ JSIBinder | C++ NapiBinder | 状态 | 扣分 |
|---|---------|-------------|---------------|------|------|
| 1 | `javaScriptEnabled` | ✅ | ✅ | ✅ 桥接完整 | 0 |
| 2 | `injectedJavaScript` | ✅ | ⛔ 无 | ❌ C++→ArkTS 断桥 | -5 |
```

#### ②平台实现差异

**检查项5：Props实现逻辑一致性**

> ⚠️ **注意**：检查项5仅对比 Prop 的"主映射"逻辑一致性（Prop → 其自然对应的原生属性）。若 Prop 还影响了其他原生属性（副作用），须在检查项6中单独分析。

- **特征检索方式**：从 C++ JSIBinder 提取 Prop 序列化逻辑；从 Android ViewManager 提取 @ReactProp setter；从 iOS ViewManager 提取 RCT_EXPORT_VIEW_PROPERTY handler

- **特征检索方式**：从 C++ JSIBinder 提取 Prop 序列化逻辑；从 Android ViewManager 提取 @ReactProp setter；从 iOS ViewManager 提取 RCT_EXPORT_VIEW_PROPERTY handler
- **检视步骤**：
  1. 从 C++ JSIBinder 提取每个 Prop 的序列化逻辑（setProperty 如何转换/处理值）
  2. 读取 Android ViewManager 文件，提取 @ReactProp setter 方法中对同名 Prop 的处理逻辑
  3. 读取 iOS ViewManager 文件，提取 RCT_EXPORT_VIEW_PROPERTY handler 中对同名 Prop 的处理逻辑
  4. 对比三个平台对每个 Prop 的实际行为/转换逻辑
  5. 判定规则：逻辑不一致（如 C++ 直接传递原值但 Android 做了类型转换）-8~-15分/个，视功能影响程度
- **扣分规则**：逻辑不一致 -8~-15分/个
- **输出格式**：

```markdown
| # | Prop 名 | C++ JSIBinder 逻辑 | Android @ReactProp 逻辑 | iOS RCT_EXPORT_VIEW_PROPERTY 逻辑 | 状态 | 扣分 |
|---|---------|-------------------|------------------------|----------------------------------|------|------|
| 1 | `source` | 直接序列化为 string | 解析 URI + 设置 baseUrl | 解析 URI + 加载 request | ❌ 逻辑不一致 | -15 |
| 2 | `javaScriptEnabled` | bool 直接传递 | bool 直接传递 | BOOL 直接传递 | ✅ 一致 | 0 |
```

---

**检查项6：Props副作用&关联影响分析**

- **检查项**: Props副作用&关联影响分析
- **适用条件判定**: 执行此检查项前，必须先判定组件的渲染模式：

  | 渲染模式 | 判定特征 | 副作用分析策略 |
  |---------|---------|-------------|
  | 桥接转发模式 | C++ Package 为 Thin Wrapper（extends BaseReactNative*Package）；Props 仅通过 generated JSIBinder 序列化 + NapiBinder 传递到 ArkTS；C++ 代码中无基于 Props 值的条件分支或渲染逻辑 | **⛔ 不执行副作用分析，由 arktsComp 检视覆盖** |
  | C++ 渲染模式 | C++ Package 为 Hand-Written；Props 在 C++ 代码中被消费（参与条件分支、状态控制、渲染计算）；C++ 有自定义 EventEmitRequestHandler 或其他业务逻辑依赖 Props 值 | **✅ 执行本检查项** |

  判定步骤：
  1. 读取 C++ Package.h，判断 extends BaseReactNative*Package（Thin Wrapper）还是自定义 Package（Hand-Written）
  2. 若 Thin Wrapper：检查 JSIBinder/NapiBinder 是否均为 generated（无自定义 C++ Props 消费逻辑）→ 桥接转发模式
  3. 若 Hand-Written 或 C++ 代码中有 Props 值相关的条件逻辑 → C++ 渲染模式

- **定义**: 一个 Prop 除了直接影响其"自然映射"的原生属性（主映射）外，还可能通过条件表达式、辅助函数、计算逻辑等方式**间接影响其他原生属性或功能点**（副作用/关联影响）。这些副作用必须与 Android/iOS 进行跨平台对比，且需溯源文档说明。
- **特征检索方式**（仅 C++ 渲染模式）:
  1. 对每个 C++ Prop，在 C++ 实现代码（Package.h、EventEmitRequestHandler、自定义 ComponentDescriptor 等）中 grep 所有引用该 Prop 值的逻辑
  2. 对每个引用，追踪其影响的 C++ 原生行为（状态更新、条件分支、EventEmit 触发、ArkTS 属性设置等）
  3. 将每个 Prop 的影响范围分类为：
     - 主映射：Prop → 其自然对应的原生行为（已在检查项5覆盖）
     - 副作用：Prop → 非自然对应的其他原生行为或功能点
     - 关联影响：Prop → 辅助函数/条件逻辑 → 多个原生行为

- **检视步骤**（仅 C++ 渲染模式）:
  1. 判定渲染模式（桥接转发 vs C++ 渲染）
  2. 若桥接转发模式：在报告中标注"⛔ 桥接转发模式，副作用分析由 arktsComp 覆盖"，跳过后续步骤
  3. 若 C++ 渲染模式：从 C++ 代码提取每个 Prop 的**完整影响范围** → 影响图 G
     （对每个 Prop，列出它在 C++ 实现中直接影响的所有原生行为/功能点）
  4. 将影响图 G 中的每个影响分类为主映射/副作用/关联影响
  5. 对每个副作用/关联影响，在 Android/iOS 同名 Prop 的实现中查找：
     Android/iOS 是否也影响同一原生行为/功能点？
  6. 若 Android/iOS 无此副作用：
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

```markdown
| # | 渲染模式 | Prop 名 | 主映射行为 | 副作用/关联影响 | Android/iOS 是否有同副作用 | 文档说明 | 文档合理性 | 致命度 | 扣分 |
|---|---------|---------|-----------|-------------|--------------------------|---------|-----------|--------|------|
| （桥接转发模式）| ⛔ 桥接转发 | — | — | — | — | — | — | — | 0（由arktsComp覆盖） |
| （C++ 渲染模式）| ✅ C++渲染 | `propA` | state.update(A) | conditionalRender(B) when propA=true | ❌ Android/iOS无此条件渲染 | ❌ 无文档 | — | 致命 | -15 |
```

---

#### ③架构桥接一致性

**检查项7：全链路Props断桥检测**

- **特征检索方式**：综合上述列表 A（JSIBinder）、B（NativeProps）、C（NapiBinder），加上 ArkTS rawProps 与 build() 使用信息
- **检视步骤**：
  1. 构建每个 Prop 的全链路状态表：上游 NativeProps → C++ JSIBinder → C++ NapiBinder → ArkTS rawProps → ArkTS build() 使用
  2. 识别链路中断位置
  3. 判定规则：JS→C++ 断桥 -8分/个（致命）；C++→ArkTS 断桥 -5分/个（中等）；ArkTS 端断桥：关键 Prop -5分/个，次要 Prop -3分/个
- **扣分规则**：按断桥位置分别计分（详见第4节断桥类型定义）
- **输出格式**：

```markdown
| # | Prop 名 | 上游 NativeProps | C++ JSIBinder | C++ NapiBinder | OHOS DirectRawProps | ArkTS rawProps 使用 | 断桥位置 | 扣分 |
|---|---------|----------------|--------------|---------------|--------------------|-------------------|---------|------|
| 1 | `javaScriptEnabled` | ✅ | ✅ | ✅ | ✅ | ✅ | — | 0 |
| 2 | `injectedJavaScript` | ✅ | ✅ | ⛔ | ✅ | ✅ | C++→ArkTS | -5 |
| 3 | `customMapStyle` | ✅ | ⛔ | — | ✅ | ✅ | JS→C++ | -8 |
```

---

### 3.2 检查点：Command（命令传递与逻辑一致性）

#### 检查项概要

| # | 检查项 | 维度 | 扣分规则 | 致命度 |
|---|--------|------|----------|--------|
| 1 | Command注册完整性 | ①契约 | Command缺失 -8分/个 | 严重 |
| 2 | Command签名一致性 | ①契约 | 签名不匹配 -8分/个 | 严重 |
| 3 | Command实现逻辑一致性 | ②平台 | 逻辑不一致 -10~-15分/个 | 严重/致命 |
| 4 | Command边界处理 | ②平台 | 边界处理不一致 -5分/个 | 中等 |
| 5 | Command错误处理 | ②平台 | 错误处理不一致 -5分/个 | 中等 |

#### ①契约一致性

**检查项1：Command注册完整性**

- **特征检索方式**：搜索 `createCommandHandlerDelegateProviders` in `*Package.h`，提取所有 Command 注册；搜索上游 NativeCommands 类型定义；在文档中搜索不支持标注
- **检视步骤**：
  1. 读取 Package.h 文件（路径：`*Package.h` 或 `generated/RNOH/generated/BaseReactNative*Package.h`），提取 `createCommandHandlerDelegateProviders` 中所有 Command 注册项，构建 C++ Command 列表 A
  2. 读取上游 JS Spec NativeCommands 类型定义，提取所有 Command 名，构建上游 Command 列表 B
  3. 对比 A vs B：B 有但 A 无 → Command 注册缺失
  4. **🟢 豁免检查（优先级高于扣分）**：对每个缺失的 Command，检查文档是否标注不支持（接口规格说明、OHOS README、源码注释）
  5. 判定规则：
     - 🟢 **文档已标注不支持** → 豁免，0分，标注"🟢 文档标注不支持（来源：文件:行号）"
     - ❌ **文档未标注不支持** → Command 缺失 -8分/个
- **扣分规则**：Command 缺失 -8分/个；文档标注不支持→豁免0分（不计入严重问题计数）
- **输出格式**：

```markdown
| # | Command 名 | 上游 NativeCommands | C++ Package 注册 | 文档标注不支持 | 文档来源 | 状态 | 扣分 |
|---|-----------|-------------------|-----------------|--------------|---------|------|------|
| 1 | `goBack` | ✅ | ✅ | — | — | ✅ 一致 | 0 |
| 2 | `clearFormData` | ✅ | ⛔ 无 | ✅ Android only, HarmonyOS Support: No | README.md:380 | 🟢 豁免不扣分 | 0 |
| 3 | `loadUrl` | ✅ | ⛔ 无 | ❌ 无标注 | — | ❌ Command 注册缺失 | -8 |
```

**检查项2：Command签名一致性**

- **特征检索方式**：从 Package.h 或 JSIBinder 提取 Command handler 方法签名；从 JS Spec NativeCommands 提取 Command 签名
- **检视步骤**：
  1. 从 Package.h 或 JSIBinder.h 提取每个 Command handler 的方法签名（参数数量、参数类型、参数顺序）
  2. 从上游 JS Spec NativeCommands 提取每个 Command 的签名定义（参数数量、类型、顺序）
  3. 逐 Command 对比 C++ 签名 vs 上游签名
  4. 判定规则：参数数量不一致 -8分/个；参数顺序不一致 -8分/个；参数类型不一致 -8分/个
- **扣分规则**：签名不匹配 -8分/个
- **输出格式**：

```markdown
| # | Command 名 | 上游 JS Spec 签名 | C++ handler 签名 | 状态 | 扣分 |
|---|-----------|-----------------|-----------------|------|------|
| 1 | `goBack` | `(viewRef: ViewRef)` | `(ComponentInstance& instance)` | ✅ 签名一致 | 0 |
| 2 | `loadUrl` | `(viewRef: ViewRef, url: string)` | `(ComponentInstance& instance)` | ❌ 参数数量不一致 | -8 |
```

#### ②平台实现差异

**检查项3：Command实现逻辑一致性**

- **特征检索方式**：从 C++ Package 读取 Command handler 实现；从 Android ViewManager 读取 receiveCommand 实现；从 iOS ViewManager 读取 RCT_EXPORT_METHOD 实现
- **检视步骤**：
  1. 从 C++ Package.h/cpp 读取每个 Command handler 的具体实现逻辑
  2. 从 Android ViewManager 文件读取 `receiveCommand()` 方法中对同名 Command 的实现
  3. 从 iOS ViewManager 文件读取 `RCT_EXPORT_METHOD` 中对同名 Command 的实现
  4. 对比三个平台对每个 Command 的实际行为
  5. 判定规则：逻辑不一致 -10~-15分/个，视功能影响程度
- **扣分规则**：逻辑不一致 -10~-15分/个
- **输出格式**：

```markdown
| # | Command 名 | C++ handler 逻辑 | Android receiveCommand 逻辑 | iOS RCT_EXPORT_METHOD 逻辑 | 状态 | 扣分 |
|---|-----------|-----------------|---------------------------|---------------------------|------|------|
| 1 | `goBack` | 调用 instance.goBack() | 调用 webView.goBack() | 调用 webView.goBack() | ✅ 一致 | 0 |
| 2 | `injectJavaScript` | 直接执行 JS 字符串 | 评估 JS 脚本 + 回调 | 评估 JS 脚本 + 回调 | ❌ 逻辑不一致 | -15 |
```

**检查项4：Command边界处理**

- **特征检索方式**：对比 C++ Command handler 对边界条件（空参数、越界值、null）的处理 vs Android/iOS 同名 Command 的边界处理
- **检视步骤**：
  1. 从 C++ Command handler 代码分析边界条件处理（空值、越界、类型异常等）
  2. 从 Android receiveCommand 分析同名边界处理
  3. 从 iOS RCT_EXPORT_METHOD 分析同名边界处理
  4. 对比三个平台的边界处理策略
  5. 判定规则：边界处理不一致 -5分/个
- **扣分规则**：边界处理不一致 -5分/个
- **输出格式**：

```markdown
| # | Command 名 | 边界场景 | C++ 处理 | Android 处理 | iOS 处理 | 状态 | 扣分 |
|---|-----------|---------|---------|-------------|---------|------|------|
| 1 | `loadUrl` | url 为空字符串 | 忽略 | 忽略 | 加载空页面 | ❌ 不一致 | -5 |
```

**检查项5：Command错误处理**

- **特征检索方式**：对比 C++ Command handler 错误处理（异常捕获、错误回调）vs Android/iOS 同名 Command 错误处理
- **检视步骤**：
  1. 从 C++ Command handler 代码分析错误处理机制（try-catch、错误回调、静默失败等）
  2. 从 Android receiveCommand 分析同名错误处理
  3. 从 iOS RCT_EXPORT_METHOD 分析同名错误处理
  4. 对比三个平台的错误处理策略
  5. 判定规则：错误处理不一致 -5分/个
- **扣分规则**：错误处理不一致 -5分/个
- **输出格式**：

```markdown
| # | Command 名 | 错误场景 | C++ 处理 | Android 处理 | iOS 处理 | 状态 | 扣分 |
|---|-----------|---------|---------|-------------|---------|------|------|
| 1 | `loadUrl` | URL 格式无效 | 静默忽略 | 回调 onError | 回调 onError | ❌ 不一致 | -5 |
```

#### ③架构桥接一致性

由 ①契约一致性 检查覆盖。Command 的注册完整性已涵盖 JS→C→ArkTS 链路一致性。

---

### 3.3 检查点：Methods（方法注册与映射一致性）

#### 检查项概要

| # | 检查项 | 维度 | 扣分规则 | 致命度 |
|---|--------|------|----------|--------|
| 1 | 组件名一致性 | ①契约 | 不一致 -5分/个 | 中等 |
| 2 | Package注册完整性 | ③架构 | 不一致 -8分/个 | 严重 |
| 3 | JSIBinder映射完整性 | ③架构 | 缺失映射 -8分/个 | 严重 |

#### ①契约一致性

**检查项1：组件名一致性**

- **特征检索方式**：从 Package.h 提取 `createComponentDescriptorProviders` 中注册的组件名；从上游 JS 文件提取 `codegenNativeComponent('组件名')` 参数
- **检视步骤**：
  1. 从 C++ Package.h 提取 `createComponentDescriptorProviders()` 中所有组件描述符注册，提取组件名列表 A
  2. 从上游 JS 文件读取 `codegenNativeComponent('组件名')` 调用参数，提取组件名列表 B
  3. 对比 A vs B：名称拼写不一致或缺失均计为不一致
  4. 判定规则：组件名不一致 -5分/个
- **扣分规则**：组件名不一致 -5分/个
- **输出格式**：

```markdown
| # | 组件名 | 上游 JS codegenNativeComponent 参数 | C++ Package 注册名 | 状态 | 扣分 |
|---|--------|----------------------------------|-------------------|------|------|
| 1 | `RNCWebView` | `'RNCWebView'` | `'RNCWebView'` | ✅ 一致 | 0 |
| 2 | `AIRMap` | `'AIRMap'` | `'AirMap'` | ❌ 名称不一致 | -5 |
```

#### ②平台实现差异

N/A（Methods 主要涉及架构注册，无平台实现差异维度）

#### ③架构桥接一致性

**检查项2：Package注册完整性**

- **特征检索方式**：从 C++ Package.h 提取 `createComponentDescriptorProviders` 组件列表；从 ArkTS Package.ets 提取 `createDescriptorWrapperFactoryByDescriptorType` 组件列表
- **检视步骤**：
  1. 从 C++ Package.h 提取 `createComponentDescriptorProviders()` 中所有组件描述符注册，提取组件名列表 A
  2. 从 ArkTS Package.ets 提取 `createDescriptorWrapperFactoryByDescriptorType` 映射，提取组件名列表 B
  3. 对比 A vs B：A 有但 B 无 → ArkTS 端注册缺失；B 有但 A 无 → C++ 端注册缺失
  4. 判定规则：不一致 -8分/个
- **扣分规则**：不一致 -8分/个
- **输出格式**：

```markdown
| # | 组件名 | C++ Package 注册 | ArkTS Package 注册 | 状态 | 扣分 |
|---|--------|-----------------|-------------------|------|------|
| 1 | `RNCWebView` | ✅ | ✅ | ✅ 一致 | 0 |
| 2 | `AIRMapMarker` | ✅ | ⛔ 无 | ❌ ArkTS 注册缺失 | -8 |
```

**检查项3：JSIBinder映射完整性**

- **特征检索方式**：从 Package.h 提取 `createComponentJSIBinderByName()` 中组件名→JSIBinder 映射；对比上游组件名
- **检视步骤**：
  1. 从 C++ Package.h 提取 `createComponentJSIBinderByName()` 映射表（组件名 → JSIBinder 类名）
  2. 对比映射表中的组件名与上游已知组件名列表
  3. 缺失映射 → 该组件无 C++ JSIBinder，Props 无法序列化
  4. 判定规则：缺失映射 -8分/个
- **扣分规则**：缺失映射 -8分/个
- **输出格式**：

```markdown
| # | 组件名 | C++ JSIBinder 映射 | 上游组件名 | 状态 | 扣分 |
|---|--------|-------------------|----------|------|------|
| 1 | `RNCWebView` | `RNCWebViewJSIBinder` ✅ | ✅ | ✅ 映射完整 | 0 |
| 2 | `AIRMapMarker` | ⛔ 无映射 | ✅ | ❌ 映射缺失 | -8 |
```

---

### 3.4 检查点：Callback（回调/事件传递与触发时机一致性）

#### 检查项概要

| # | 检查项 | 维度 | 扣分规则 | 致命度 |
|---|--------|------|----------|--------|
| 1 | 事件注册完整性 | ①契约 | 事件注册缺失 -5分/个 | 中等 |
| 2 | 事件名→JS映射 | ①契约 | 映射不一致 -5分/个 | 中等 |
| 3 | 事件数据格式 | ①契约 | 字段不一致 -5分/个 | 中等 |
| 4 | 回调触发时机一致性 | ②平台 | 触发时机不一致 -8分/个 | 严重 |
| 5 | 事件名映射 | ③架构 | 不一致 -5分/个 | 中等 |

#### ①契约一致性

**检查项1：事件注册完整性**

- **特征检索方式**：搜索 `supportedEventNames` in `*Package.h`；搜索上游 JS `onXxx` DirectEventHandler Props
- **检视步骤**：
  1. 从 Package.h 或 generated 基类提取 `supportedEventNames` vector 中所有事件名，构建 C++ 事件列表 A
  2. 从上游 JS NativeProps 提取所有 `onXxx` DirectEventHandler 类型 Prop 名（去掉 `on` 前缀得到事件名），构建上游事件列表 B
  3. 对比 A vs B：B 有但 A 无 → 事件注册缺失
  4. 判定规则：C++ 层未注册上游存在的事件 -5分/个
- **扣分规则**：事件注册缺失 -5分/个
- **输出格式**：

```markdown
| # | 事件名 | 上游 JS onXxx Prop | C++ supportedEventNames | 状态 | 扣分 |
|---|--------|-------------------|------------------------|------|------|
| 1 | `loadingStart` | `onLoadingStart` ✅ | ✅ | ✅ 一致 | 0 |
| 2 | `onError` | `onError` ✅ | ⛔ 无 | ❌ 事件注册缺失 | -5 |
```

**检查项2：事件名→JS映射**

- **特征检索方式**：搜索 `createDirectEventTypes` in `*JSIBinder.h`；提取所有 `events.setProperty(rt, "topXxx", createDirectEvent(rt, "onXxx"))` 行
- **检视步骤**：
  1. 从 JSIBinder.h 提取所有 `events.setProperty(rt, "topXxx", createDirectEvent(rt, "onXxx"))` 行，构建 topXxx→onXxx 映射表
  2. 验证每个映射是否符合 RN 事件映射规则：`topXxx` 对应 `onXxx`（`top` 前缀 + 首字母大写 → `on` 前缀 + 首字母大写）
  3. 与上游 JS 事件名对比确认映射正确性
  4. 判定规则：映射不一致 -5分/个
- **扣分规则**：映射不一致 -5分/个
- **输出格式**：

```markdown
| # | topXxx | onXxx | 上游 JS 事件名 | 映射是否符合 RN 规则 | 状态 | 扣分 |
|---|--------|-------|--------------|-------------------|------|------|
| 1 | `topLoadingStart` | `onLoadingStart` | `onLoadingStart` | ✅ | ✅ 一致 | 0 |
| 2 | `topError` | `onMessage` | `onError` | ❌ | ❌ 映射不一致 | -5 |
```

**检查项3：事件数据格式**

- **特征检索方式**：从 EventEmitRequestHandler 提取 payload 构建逻辑；从上游 JS Spec 提取 event.nativeEvent 类型定义
- **检视步骤**：
  1. 从 C++ EventEmitRequestHandler 代码读取 emitEvent 时的 payload 构建逻辑，提取所有 payload 字段名和值来源
  2. 从上游 JS Spec 读取 event.nativeEvent 类型定义，提取所有字段名和类型
  3. 逐事件对比 C++ payload 字段 vs 上游 nativeEvent 字段
  4. 判定规则：字段缺失或不一致 -5分/个
- **扣分规则**：字段不一致 -5分/个
- **输出格式**：

```markdown
| # | 事件名 | 上游 nativeEvent 字段 | C++ payload 字段 | 状态 | 扣分 |
|---|--------|--------------------|-----------------|------|------|
| 1 | `loadingStart` | `{url: string}` | `{url: std::string}` | ✅ 一致 | 0 |
| 2 | `onError` | `{description: string, code: number}` | `{description: std::string}` | ❌ 字段缺失（code） | -5 |
```

#### ②平台实现差异

**检查项4：回调触发时机一致性**

- **特征检索方式**：从 C++ EventEmitRequestHandler 读取 emitEvent 调用时机；从 Android 读取 RCTEventEmitter.receiveEvent() 调用时机；从 iOS 读取 RCTDirectEventBlock 调用时机
- **检视步骤**：
  1. 从 C++ EventEmitRequestHandler 代码分析何时调用 emitEvent（触发条件、触发时机）
  2. 从 Android ViewManager 代码分析何时调用 `RCTEventEmitter.receiveEvent()`（触发条件、触发时机）
  3. 从 iOS ViewManager 代码分析何时调用 `RCTDirectEventBlock`（触发条件、触发时机）
  4. 对比三个平台对每个事件的触发条件和时机
  5. 判定规则：触发时机不一致 -8分/个
- **扣分规则**：触发时机不一致 -8分/个
- **输出格式**：

```markdown
| # | 事件名 | C++ 触发时机 | Android 触发时机 | iOS 触发时机 | 状态 | 扣分 |
|---|--------|-------------|-----------------|------------|------|------|
| 1 | `loadingStart` | 页面开始加载时 | 页面开始加载时 | 页面开始加载时 | ✅ 一致 | 0 |
| 2 | `onError` | JS 执行错误时 | HTTP 错误 + JS 错误 | HTTP 错误 + JS 错误 | ❌ 触发条件不一致 | -8 |
```

#### ③架构桥接一致性

**检查项5：事件名映射**

- **特征检索方式**：从 C++ EventEmitRequestHandler 提取事件名；从 ArkTS generated EventEmitRequestHandler 提取 EventPayloadByName 映射
- **检视步骤**：
  1. 从 C++ EventEmitRequestHandler 代码提取所有注册的事件名字符串，构建列表 A
  2. 从 ArkTS generated EventEmitRequestHandler 文件提取 `EventPayloadByName` 映射中的事件名，构建列表 B
  3. 对比 A vs B：A 有但 B 无 → ArkTS 端事件映射缺失
  4. 判定规则：不一致 -5分/个
- **扣分规则**：不一致 -5分/个
- **输出格式**：

```markdown
| # | 事件名 | C++ EventEmitRequestHandler | OHOS EventPayloadByName | 状态 | 扣分 |
|---|--------|----------------------------|------------------------|------|------|
| 1 | `loadingStart` | ✅ | ✅ | ✅ 一致 | 0 |
| 2 | `contentSizeChange` | ✅ | ⛔ 无映射 | ❌ ArkTS 映射缺失 | -5 |
```

---

### 3.5 检查点：Lifecycle（生命周期逻辑一致性）

#### 检查项概要

| # | 检查项 | 维度 | 扣分规则 | 致命度 |
|---|--------|------|----------|--------|
| 1 | C++组件构造逻辑 | ②平台 | 初始化逻辑不一致 -5分/个 | 中等 |
| 2 | C++组件析构逻辑 | ②平台 | 清理逻辑不一致 -5分/个 | 中等 |

#### ①契约一致性

N/A（Lifecycle 主要涉及平台实现差异，无契约一致性维度）

#### ②平台实现差异

**检查项1：C++组件构造逻辑**

- **特征检索方式**：从 C++ 组件描述符（ComponentDescriptor）读取构造/初始化逻辑；从 Android ViewManager 读取 onCreate/初始化逻辑
- **检视步骤**：
  1. 从 C++ ComponentDescriptor 文件读取组件构造函数和初始化逻辑（状态初始化、默认值设置、子组件创建等）
  2. 从 Android ViewManager 文件读取 `createViewInstance()` / `onCreate()` 中的初始化逻辑
  3. 对比两端初始化逻辑（哪些状态被初始化、默认值设置、子组件创建顺序等）
  4. 判定规则：初始化逻辑不一致 -5分/个
- **扣分规则**：初始化逻辑不一致 -5分/个
- **输出格式**：

```markdown
| # | 初始化项 | C++ 构造逻辑 | Android ViewManager 初始化 | 状态 | 扣分 |
|---|---------|-------------|---------------------------|------|------|
| 1 | 默认状态设置 | Props 默认值初始化 | Props 默认值初始化 | ✅ 一致 | 0 |
| 2 | 子组件创建 | 无子组件创建 | 创建默认 Marker 子视图 | ❌ 不一致 | -5 |
```

**检查项2：C++组件析构逻辑**

- **特征检索方式**：从 C++ 组件读取析构函数/清理逻辑；从 Android ViewManager 读取 onDestroy 清理逻辑
- **检视步骤**：
  1. 从 C++ 组件代码读取析构函数和清理逻辑（资源释放、监听器移除、子组件销毁等）
  2. 从 Android ViewManager 读取 `onDestroy()` 中的清理逻辑
  3. 对比两端清理逻辑（哪些资源被释放、监听器移除、回调取消等）
  4. 判定规则：清理逻辑不一致 -5分/个
- **扣分规则**：清理逻辑不一致 -5分/个
- **输出格式**：

```markdown
| # | 清理项 | C++ 析构逻辑 | Android onDestroy | 状态 | 扣分 |
|---|--------|-------------|------------------|------|------|
| 1 | WebView 销毁 | 调用 instance.destroy() | 调用 webView.destroy() | ✅ 一致 | 0 |
| 2 | 事件监听移除 | 仅移除部分监听器 | 移除所有监听器 | ❌ 不一致 | -5 |
```

#### ③架构桥接一致性

由 ②平台实现差异 检查覆盖。Lifecycle 的平台对比已涵盖构造→注册→析构的架构链路一致性。

---

## 4. 跨层断桥检测

### 4.1 断桥类型定义

| 断桥位置 | 识别方式 | 影响 | 扣分 |
|---------|----------|------|------|
| JS→C++ 断桥 | 上游 NativeProps 有 Prop，但 C++ JSIBinder 无 `obj.setProperty` | JS 传入值在 C++ 序列化阶段被丢弃，永远无法到达组件 | -8/个（致命） |
| C++→ArkTS 断桥 | C++ JSIBinder 有 Prop，但 NapiBinder 无 `setProperty` | C++ 有值但未传递给 ArkTS，ArkTS 无法获取 | -5/个（中等） |
| ArkTS 端断桥 | ArkTS rawProps 有 Prop，但 build() 中未传递给原生组件 | Prop 传入但未使用，功能未生效 | 关键 Prop -5/个，次要 Prop -3/个 |

### 4.2 全链路 Props 对比格式

```markdown
| # | Prop 名 | 上游 NativeProps | C++ JSIBinder | C++ NapiBinder | OHOS DirectRawProps | ArkTS rawProps 使用 | 断桥位置 | 扣分 |
|---|---------|----------------|--------------|---------------|--------------------|-------------------|---------|------|
| 1 | `javaScriptEnabled` | ✅ boolean | ✅ `setProperty(rt, "javaScriptEnabled", true)` | ✅ | ✅ boolean? | ✅ `this.javaScriptEnable` → `.javaScriptAccess()` | — | 0 |
| 2 | `injectedJavaScript` | ✅ string? | ✅ `setProperty(rt, "injectedJavaScript", true)` | ⛔ 无桥接 | ✅ string? | ✅ `runInjectedJavaScript()` | C++→ArkTS | -5 |
| 3 | `customMapStyle` | ✅ object? | ⛔ 无 `setProperty` | — | ✅ MapStyleElement[]? | ✅ `rawProps.customMapStyle` | JS→C++ | -8 |
```

---

## 5. 检视操作流程

### 5.1 Phase 0 补充步骤（C++ 层定位）

在 Phase 0.1a 的 5f 子步骤基础上，增加以下必读步骤：

```
5f-1: 定位 C++ Package 文件
      → 搜索 harmony/<module>/src/main/cpp/*Package.h
      → 判定 Thin Wrapper 或 Hand-Written 模式

5f-2: 读取 C++ Package 或 generated 基类
      → Thin Wrapper: 读取 generated/RNOH/generated/BaseReactNative*Package.h
      → Hand-Written: 读取 *Package.h + *Package.cpp

5f-3: 定位 JSIBinder 文件
      → Codegen: generated/RNOH/generated/components/*JSIBinder.h
      → Legacy: cpp/*JSIBinder.h

5f-4: 读取 JSIBinder 文件
      → 提取 createNativeProps() 中所有 obj.setProperty 行
      → 提取 createDirectEventTypes() 中所有事件映射

5f-5: 检查 NapiBinder 文件是否存在
      → 搜索 harmony/<module>/src/main/cpp/generated/RNOH/generated/components/*NapiBinder.h
      → 搜索 harmony/<module>/src/main/cpp/*NapiBinder.h
      → 不存在则标注"⚠️ 无 NapiBinder"
```

### 5.2 Phase 3 补充步骤（C++ 层分析）

在 SKILL.md Phase 3 的 3.3（RN 原生组件架构一致性）中增加以下检视步骤：

```
C++-1: JSIBinder Props 对比
      → 将 C++ JSIBinder 的 Prop 列表与上游 NativeProps 对比
      → 标注 JS→C++ 断桥

C++-2: NapiBinder 桥接对比（若 NapiBinder 存在）
      → 将 NapiBinder 的 Prop 列表与 JSIBinder 对比
      → 标注 C++→ArkTS 断桥

C++-3: EventEmitRequestHandler 事件对比
      → 将 C++ 注册的事件名与上游 JS onXxx Props 对比
      → 将 C++ 事件名与 OHOS EventPayloadByName 对比

C++-4: Package 注册完整性对比
      → 将 C++ 注册的组件名与 ArkTS Package 注册的组件名对比
      → 将 C++ JSIBinder 映射与上游组件名对比

C++-5: 生成全链路 Props 对比表
      → 合并 JS→C++→NapiBinder→ArkTS 链路的 Prop 状态

C++-6: Props 副作用&关联影响分析
      → 判定渲染模式（桥接转发 vs C++ 渲染）
      → 若桥接转发：标注"由 arktsComp 覆盖"
      → 若 C++ 渲染：追踪每个 Prop 在 C++ 实现中的完整影响范围
      → 对比副作用是否存在跨平台差异
      → 查阅文档是否有说明
```

---

## 6. 报告输出格式

在一致性检视报告的"5.8 RN 架构一致性检视"中增加以下子章节：

### C++ 组件层一致性（如适用）

```markdown
#### C++ 组件层一致性

**C++ Package 模式**：{Thin Wrapper / Hand-Written / ⚠️ 无 C++ 层}

| # | 检查项 | 上游实现 | OHOS C++ 实现 | 状态 | 扣分 |
|---|--------|---------|-------------|------|------|
| 1 | 组件注册完整性 | ... | ... | ... | ... |
| 2 | JSIBinder Props 完整性 | ... | ... | ... | ... |
| 3 | NapiBinder 桥接完整性 | ... | ... | ... | ... |
| 4 | EventEmitRequestHandler 事件 | ... | ... | ... | ... |

**全链路 Props 对比**：

| # | Prop 名 | 上游 NativeProps | C++ JSIBinder | C++ NapiBinder | OHOS DirectRawProps | ArkTS rawProps 使用 | 断桥位置 | 扣分 |
|---|---------|----------------|--------------|---------------|--------------------|-------------------|---------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |
```
