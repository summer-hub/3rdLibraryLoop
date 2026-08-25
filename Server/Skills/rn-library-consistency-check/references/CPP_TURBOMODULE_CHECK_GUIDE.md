# C++ TurboModule 层一致性检视指南

本指南定义 RN 鸿蒙化一致性检视中 **C++ TurboModule 层**（TurboModuleFactoryDelegate、TurboModule JSIBinder）的检视规范，确保 AI Agent 能系统性地读取和分析 C++ TurboModule 代码，检测 TurboModule 注册缺失、方法绑定不完整等问题。

> 📖 **ArkTS TurboModule 层检视**（方法实现、Stub 检测、常量导出、回调逻辑等）已独立为 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md)，本指南仅覆盖 C++ 层。

---

## 1. 适用条件与前置依赖

### 1.1 适用条件

当 `harmony/<module>/src/main/cpp/` 目录存在 TurboModule 相关文件时，必须执行本指南的检视流程。判定条件：

| 条件 | 判定 |
|------|------|
| `generated/RNOH/generated/turbo_modules/` 目录存在 | ✅ Codegen TurboModule（必须检视） |
| `cpp/` 下存在 `*TurboModule*FactoryDelegate*` 文件 | ✅ Legacy TurboModule（必须检视） |
| 以上均不存在 | ⚠️ 无 TurboModule C++ 层，跳过本指南 |

> 📖 **ArkTS TurboModule 实现检视**：当 `harmony/<module>/src/main/ets/*TurboModule.ets` 存在时，需额外执行 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md)。

### 1.2 前置依赖

- Phase 0 中已定位的 TurboModule 名（从 Package 或 JS Spec 提取）
- JS 层 TurboModule Spec 定义（`NativeRNCWebViewModule.ts` 等文件）

---

## 2. 文件定位与读取

### 2.1 TurboModuleFactoryDelegate 定位

| 模式 | 文件位置 | 说明 |
|------|----------|------|
| Codegen | `generated/RNOH/generated/BaseReactNative*Package.h` 中的 `TurboModuleFactoryDelegate` 类 | 自动生成，包含所有 TurboModule 名 |
| Legacy | `cpp/*TurboModuleFactoryDelegate.h` 或 `*Package.h/cpp` 中手写的 TurboModule 工厂 | 手动实现，需逐条件读取 |

**必须读取的内容**：

```
1. createTurboModule(ctx, name) 方法
   → 提取所有 if (name == "TurboModule名") 条件
   → 每个条件对应一个注册的 TurboModule

2. 每个 TurboModule 的构造方式
   → std::make_shared<XxxTurboModule>(ctx, name)
   → 对应 ArkTS TurboModule 实现类
```

**TurboModule 注册提取模板**：

```markdown
| # | TurboModule 名 | C++ FactoryDelegate 注册 | C++ 文件:行号 | JS Spec 注册名 | 状态 |
|---|--------------|------------------------|-------------|--------------|------|
| 1 | `RNCWebViewModule` | ✅ if (name == "RNCWebViewModule") | `BaseReactNativeWebviewPackage.h:22` | `RNCWebViewModule` ✅ | ✅ 一致 |
| 2 | `AIRMapManager` | ✅ if (name == "AIRMapManager") | `MapsPackage.h:18` | `AIRMapManager` ✅ | ✅ 一致 |
```

> 📖 **ArkTS TurboModule 类名与 NAME 常量对比**详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 2.2 维度 A。

### 2.2 TurboModule JSIBinder 定位与读取

| 模式 | 文件位置 |
|------|----------|
| Codegen | `generated/RNOH/generated/turbo_modules/TurboModuleNameJSIBinder.h`（若存在） |
| Legacy | `cpp/TurboModuleNameJSIBinder.h` |

**必须读取的内容**：

```
1. createJSIBinder() 方法
   → 提取所有方法名的 JSI HostFunction 注册
   → 每个方法对应一个 JS→C++ 的方法桥接

2. 方法签名
   → 提取每个 HostFunction 的参数数量和类型
   → 与 JS Spec 的方法签名对比
```

> **注意**：部分 Codegen TurboModule 仅在 `turbo_modules/TurboModuleName.h` 中定义类声明，实际方法绑定在 `TurboModuleName.cpp` 中实现。需同时读取 `.h` 和 `.cpp` 文件。

### 2.3 ArkTS TurboModule generated 类型与实现

> 📖 **ArkTS TurboModule 实现的完整检视流程**（generated Spec 类型读取、ArkTS 实现类读取、方法实现完整性、Stub 检测、常量导出、回调逻辑）已独立为 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 2 节。

本指南仅提取 C++→ArkTS 映射所需的关键信息：

**C++ FactoryDelegate → ArkTS TurboModule 类映射**：

```
1. 从 C++ FactoryDelegate 的 createTurboModule() 方法中提取每个 TurboModule 的构造类名
   → std::make_shared<XxxTurboModule>(ctx, name) 中的 XxxTurboModule 类名
   → 此类名对应 ArkTS TurboModule 实现类（需在 ArkTS 层确认）

2. TurboModule 注册名→ArkTS NAME 常量映射
   → C++ if (name == "RNCWebViewModule") 对应 ArkTS TM.RNCWebViewModule.NAME
   → 需在 ArkTS 层确认 NAME 常量值是否与 C++ 注册名一致
```

---

## 3. 检视项与扣分规则

> 本指南覆盖 `cppTM` 类型实体，检视项按三个关键检查点组织：**函数签名、返回值、实现逻辑**。每个检查点覆盖三个检视维度：**①契约一致性**、**②平台实现差异**、**③架构桥接一致性**。

### 3.1 检查点：函数签名（方法名、参数、注册名一致性）

#### 检查项概要

| 维度 | # | 检查项 | 致命度 |
|------|---|--------|--------|
| ①契约一致性 | 1 | TurboModule 名一致性 | 中等 |
| ①契约一致性 | 2 | 方法名一致性 | 严重 |
| ①契约一致性 | 3 | 方法存在性 | 致命 |
| ①契约一致性 | 4 | 参数数量 | 致命 |
| ①契约一致性 | 5 | 参数类型 | 致命 |
| ①契约一致性 | 6 | 参数顺序 | 中等 |
| ②平台实现差异 | 7 | 方法签名 vs Android | — |
| ②平台实现差异 | 8 | 方法签名 vs iOS | — |
| ③架构桥接一致性 | 9 | TurboModule 注册完整性 | 致命 |

#### ①契约一致性

##### 检查项 1：TurboModule 名一致性

- **检查项**：TurboModule 名一致性
- **特征检索方式**：
  - C++ FactoryDelegate：grep `if (name == "XXX")` 或 `if (name ==` 于 `*Package.h`、`*TurboModuleFactoryDelegate.h/cpp`
  - JS Spec：grep `TurboModuleRegistry.getEnforcing` 于 `*.ts` Spec 文件
  - ArkTS：grep `NAME` 常量于 `*TurboModule.ets`（参考 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md)）
- **检视步骤**：
  1. 读取 C++ FactoryDelegate.h/cpp 文件，定位 `createTurboModule(ctx, name)` 方法，提取所有 `if (name == "TurboModule名")` 条件 → 得到 C++ 注册名列表
  2. 读取 JS Spec 文件，提取所有 `TurboModuleRegistry.getEnforcing<Spec>('模块名')` 调用 → 得到 JS 注册名列表
  3. 读取 ArkTS TurboModule.ets，提取 `NAME` 常量值（如 `static readonly NAME = 'RNCWebViewModule'`） → 得到 ArkTS NAME 列表
  4. 以 JS Spec 注册名为基准，逐一对比 C++ 注册名和 ArkTS NAME 常量
  5. **判定规则**：三层注册名必须完全一致（大小写敏感）；C++ 缺失注册名 → 致命问题归入检查项 9；JS Spec 缺失 → 标记为 JS 层遗漏；ArkTS NAME 不一致 → 归入 ArkTS 检视
- **扣分规则**：不一致扣 5 分/个
- **输出格式**：

```markdown
| # | TurboModule 名 | C++ FactoryDelegate 注册名 | JS Spec 注册名 | ArkTS NAME 常量 | C++ 文件:行号 | JS Spec 文件:行号 | 状态 | 扣分 |
|---|--------------|------------------------|--------------|--------------|-------------|-------------|------|------|
| 1 | {TM名} | {if(name=="XXX")提取值} | {getEnforcing提取值} | {NAME常量值} | {文件:行号} | {文件:行号} | ✅一致 / ❌不一致 | {扣分} |
```

##### 检查项 2：方法名一致性

- **检查项**：方法名一致性（C++ JSIBinder HostFunction 方法名 vs JS Spec 方法名）
- **特征检索方式**：
  - C++ JSIBinder：grep `HostFunction` 或 `obj.setProperty(rt,` 于 `*JSIBinder.h/cpp`
  - JS Spec：读取 Spec 接口定义，提取所有方法名
- **检视步骤**：
  1. 读取 TurboModule JSIBinder.h/cpp 文件，定位 `createJSIBinder()` 方法，提取所有 `obj.setProperty(rt, "methodName", ...)` 注册 → 得到 C++ 方法名列表
  2. 读取 JS Spec 文件，提取 Spec 接口中所有方法定义 → 得到 JS Spec 方法名列表
  3. 以 JS Spec 方法名列表为基准，逐一检查 C++ JSIBinder 中是否存在同名 HostFunction 注册
  4. **判定规则**：JS Spec 有但 C++ JSIBinder 无 → 方法缺失（归入检查项 3）；C++ JSIBinder 有但 JS Spec 无 → C++ 多余绑定（标记为冗余）；方法名拼写不一致 → 方法名不匹配
- **扣分规则**：C++ JSIBinder 方法名不匹配扣 8 分/个
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 方法名 | C++ JSIBinder 方法名 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|-------------------|-------------|------|------|
| 1 | {方法名} | {Spec中的方法名} | {JSIBinder中的方法名} | {文件:行号} | ✅一致 / ❌不匹配 | {扣分} |
```

##### 检查项 3：方法存在性（方法 JSI 绑定完整性）

- **检查项**：JS Spec 方法是否在 C++ JSIBinder 中有 HostFunction 注册
- **特征检索方式**：同检查项 2；在文档中搜索不支持标注
- **检视步骤**：
  1. 读取 JS Spec 文件，提取所有方法名 → 得到 JS Spec 完整方法列表
  2. 读取 C++ JSIBinder.h/cpp，提取所有 `obj.setProperty(rt, "methodName", ...)` → 得到 C++ 已绑定方法列表
  3. 逐一对比：对每个 JS Spec 方法，检查 C++ JSIBinder 中是否存在对应的 HostFunction 注册
  4. **🟢 豁免检查（优先级高于扣分）**：对每个缺失的方法，检查文档是否标注不支持（接口规格说明、OHOS README、源码注释）
  5. **判定规则**：
     - 🟢 **文档已标注不支持** → 豁免，0分，标注"🟢 文档标注不支持（来源：文件:行号）"
     - ❌ **文档未标注不支持** → 方法绑定缺失（致命），扣 10 分/个
- **扣分规则**：C++ JSIBinder 方法缺失扣 10 分/个；文档标注不支持→豁免0分（不计入致命问题计数）
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 定义 | C++ JSIBinder 绑定 | 文档标注不支持 | 文档来源 | 绑定状态 | 扣分 |
|---|--------|-------------|------------------|--------------|---------|---------|------|
| 1 | {方法名} | ✅ {Spec文件:行号} | ✅ {JSIBinder文件:行号} | — | — | ✅已绑定 | 0 |
| 2 | `clearFormData` | ✅ | ❌ 无绑定 | ✅ Android only | README.md:380 | 🟢 豁免不扣分 | 0 |
| 3 | {方法名} | ✅ | ❌ 无绑定 | ❌ 无标注 | — | ❌缺失 | -10 |
```

##### 检查项 4：参数数量

- **检查项**：JS Spec 参数数量 vs C++ JSIBinder 参数数量
- **特征检索方式**：
  - C++ JSIBinder：在 HostFunction lambda 中计数 `args[n]` 或 `argv[n]` 访问
  - JS Spec：从 Spec 接口方法签名中计数参数
- **检视步骤**：
  1. 读取 JS Spec，对每个方法提取参数列表 → 记录参数数量
  2. 读取 C++ JSIBinder.h/cpp，对每个 HostFunction lambda 提取参数访问模式（如 `args[0]`、`args[1]`、`argv[0]`）→ 记录 C++ 实际使用的参数数量
  3. 逐一对比每个方法的参数数量
  4. **判定规则**：C++ 参数数量与 JS Spec 不匹配 → 致命；C++ 多于 JS Spec → 标记为冗余参数；C++ 少于 JS Spec → 标记为参数缺失
- **扣分规则**：不匹配扣 8 分/个（致命度）
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 参数数量 | JS Spec 参数列表 | C++ 参数数量 | C++ 参数访问 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|-------------|-----------|-----------|-------------|------|------|
| 1 | {方法名} | {数量} | {参数名列表} | {数量} | {args[n]列表} | {文件:行号} | ✅一致 / ❌不匹配 | {扣分} |
```

##### 检查项 5：参数类型

- **检查项**：C++ JSIBinder 方法参数 napi 类型转换 vs JS Spec 参数类型
- **特征检索方式**：
  - C++ JSIBinder：grep `napi_get_string_utf8`、`napi_get_double`、`napi_get_boolean`、`napi_get_value_int32`、`napi_get_object` 等类型转换函数于 `*JSIBinder.h/cpp`
  - JS Spec：从 Spec 接口提取参数类型声明（如 `string`、`boolean`、`number`、`Object`、`Function`）
- **检视步骤**：
  1. 读取 JS Spec，对每个方法的每个参数提取类型声明 → 得到 JS Spec 参数类型列表
  2. 读取 C++ JSIBinder.h/cpp，对每个 HostFunction lambda 提取参数 napi 类型转换模式 → 建立映射表：

```
JS Spec 类型 → 预期 napi 转换函数：
string     → napi_get_string_utf8 / napi_get_value_string_utf8
boolean    → napi_get_boolean / napi_get_value_bool
number     → napi_get_double / napi_get_value_double / napi_get_value_int32
Object     → napi_get_object / napi_get_value_object
Function   → napi_get_function / napi_get_value_function
Array      → napi_get_array / napi_get_value_array
```

  3. 逐一对比每个参数的类型映射是否正确
  4. **判定规则**：napi 类型转换函数与 JS Spec 参数类型不对应 → 类型致命错误
- **扣分规则**：类型转换致命错误扣 10 分/个
- **输出格式**：

```markdown
| # | 方法名 | 参数名 | JS Spec 类型 | 预期 napi 转换 | C++ 实际 napi 转换 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|------|-------------|-------------|-----------------|-------------|------|------|
| 1 | {方法名} | {参数名} | {JS Spec类型} | {预期转换函数} | {实际转换函数} | {文件:行号} | ✅一致 / ❌类型错误 | {扣分} |
```

##### 检查项 6：参数顺序

- **检查项**：JS Spec 参数位置 vs C++ JSIBinder 参数位置
- **特征检索方式**：同检查项 4 和 5，关注参数索引顺序
- **检视步骤**：
  1. 读取 JS Spec，对每个方法按定义顺序提取参数列表 → 得到 JS Spec 参数顺序
  2. 读取 C++ JSIBinder.h/cpp，对每个 HostFunction lambda 按 `args[n]` / `argv[n]` 索引顺序提取参数访问 → 得到 C++ 参数访问顺序
  3. 逐一对比每个方法中参数的位置顺序：JS Spec 第 1 个参数应对应 C++ `args[0]`，第 2 个对应 `args[1]`，以此类推
  4. **判定规则**：C++ 参数访问顺序与 JS Spec 参数定义顺序不一致 → 顺序错误
- **扣分规则**：顺序错误扣 6 分/个
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 参数顺序 | C++ args 索引顺序 | 顺序差异 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|---------------|---------|-------------|------|------|
| 1 | {方法名} | {参数1, 参数2, ...} | {args[0]=参数?, args[1]=参数?, ...} | {无 / 描述差异} | {文件:行号} | ✅一致 / ❌顺序错误 | {扣分} |
```

#### ②平台实现差异

##### 检查项 7：方法签名 vs Android

- **检查项**：C++ JSIBinder 方法签名 vs Android @ReactMethod 方法签名
- **特征检索方式**：
  - C++ JSIBinder：grep HostFunction 注册于 `*JSIBinder.h/cpp`
  - Android：grep `@ReactMethod` 于 Java/Kotlin 文件
- **检视步骤**：
  1. 从 C++ JSIBinder 提取方法签名列表（方法名 + 参数数量/类型 + 返回值类型）
  2. 从 Android Java/Kotlin 文件读取所有 `@ReactMethod` 注解方法及其签名
  3. 对每个方法，对比 C++ 签名与 Android 签名的差异（参数数量、参数类型）
  4. **判定规则**：C++ 与 Android 签名差异不独立扣分，与 JS Spec 一致性检查合并计算——如果 C++ 与 JS Spec 一致但与 Android 不一致，说明 Android 实现存在偏差；如果 C++ 与 JS Spec 也不一致，则以 JS Spec 检查项扣分为主
- **扣分规则**：签名差异（参数数量/类型）与 JS Spec 一致性检查合并计算，不独立扣分
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 签名 | C++ JSIBinder 签名 | Android @ReactMethod 签名 | C++ vs JS Spec 状态 | C++ vs Android 状态 | 备注 |
|---|--------|-------------|-------------------|--------------------------|-------------------|-------------------|------|
| 1 | {方法名} | {签名} | {签名} | {签名} | {一致/不一致} | {一致/不一致} | {合并扣分归属} |
```

##### 检查项 8：方法签名 vs iOS

- **检查项**：C++ JSIBinder 方法签名 vs iOS RCT_EXPORT_METHOD 方法签名
- **特征检索方式**：
  - C++ JSIBinder：grep HostFunction 注册于 `*JSIBinder.h/cpp`
  - iOS：grep `RCT_EXPORT_METHOD` 于 ObjC 文件或 Swift 方法导出声明
- **检视步骤**：
  1. 从 C++ JSIBinder 提取方法签名列表
  2. 从 iOS Swift/ObjC 文件读取所有 `RCT_EXPORT_METHOD` 定义及其签名
  3. 对每个方法，对比 C++ 签名与 iOS 签名的差异
  4. **判定规则**：同检查项 7，差异与 JS Spec 一致性检查合并计算
- **扣分规则**：签名差异与 JS Spec 一致性检查合并计算，不独立扣分
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 签名 | C++ JSIBinder 签名 | iOS RCT_EXPORT_METHOD 签名 | C++ vs JS Spec 状态 | C++ vs iOS 状态 | 备注 |
|---|--------|-------------|-------------------|--------------------------|-------------------|---------------|------|
| 1 | {方法名} | {签名} | {签名} | {签名} | {一致/不一致} | {一致/不一致} | {合并扣分归属} |
```

#### ③架构桥接一致性

##### 检查项 9：TurboModule 注册完整性

- **检查项**：C++ FactoryDelegate 注册名 vs JS 层所有 TurboModuleRegistry 注册名
- **特征检索方式**：
  - C++ FactoryDelegate：grep `if (name ==` 于 `*Package.h`、`*TurboModuleFactoryDelegate.h/cpp`
  - JS 层：grep `TurboModuleRegistry.getEnforcing` 或 `TurboModuleRegistry.get` 于所有 `*.ts` 文件
- **检视步骤**：
  1. 读取 C++ FactoryDelegate.h/cpp，从 `createTurboModule()` 方法中提取所有 `if (name == "TurboModule名")` 条件 → 得到 C++ 已注册 TurboModule 名列表
  2. 在 JS 层所有 `.ts` 文件中搜索 `TurboModuleRegistry.getEnforcing<Spec>('模块名')` 和 `TurboModuleRegistry.get('模块名')` → 得到 JS 层所有 TurboModule 注册名列表
  3. 以 JS 层注册名列表为基准，逐一检查 C++ FactoryDelegate 中是否有对应的注册条件
  4. **判定规则**：JS 层注册了 TurboModule 但 C++ FactoryDelegate 无对应 `if (name == "XXX")` 条件 → C++ 缺失 TurboModule 注册（致命）
- **扣分规则**：C++ 缺失 TurboModule 注册扣 10 分/个
- **输出格式**：

```markdown
| # | TurboModule 名 | JS 层 TurboModuleRegistry 注册 | C++ FactoryDelegate 注册 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------------|--------------------------|------------------------|-------------|------|------|
| 1 | {TM名} | ✅ {JS文件:行号} | ✅ {C++文件:行号} / ❌ 无注册 | {文件:行号} | ✅已注册 / ❌缺失注册 | {扣分} |
```

---

### 3.2 检查点：返回值（返回值类型与语义一致性）

#### 检查项概要

| 维度 | # | 检查项 | 致命度 |
|------|---|--------|--------|
| ①契约一致性 | 1 | 返回值类型 | 致命 |
| ①契约一致性 | 2 | 返回值语义 | 严重 |
| ①契约一致性 | 3 | Promise 处理 | 中等 |
| ①契约一致性 | 4 | C++ getConstants() | 中等 |
| ②平台实现差异 | 5 | 返回值 vs Android | — |
| ②平台实现差异 | 6 | 返回值 vs iOS | — |
| ③架构桥接一致性 | — | 已在①中覆盖 | — |

#### ①契约一致性

##### 检查项 1：返回值类型

- **检查项**：C++ TurboModule 方法返回值 vs JS Spec 期望返回值
- **特征检索方式**：
  - C++ JSIBinder：grep `napi_create_string_utf8`、`napi_create_double`、`napi_create_boolean`、`napi_create_object`、`napi_create_array`、`napi_create_promise`、`napi_create_null`、`napi_create_int32` 等返回值构造函数于 `*JSIBinder.h/cpp`
  - JS Spec：从 Spec 接口提取方法返回值类型声明
- **检视步骤**：
  1. 读取 JS Spec，对每个方法提取返回值类型 → 得到 JS Spec 期望返回值类型列表
  2. 读取 C++ JSIBinder.h/cpp，对每个 HostFunction lambda 提取返回值构造模式 → 建立映射表：

```
JS Spec 返回类型 → 预期 napi 构造函数：
string     → napi_create_string_utf8
boolean    → napi_create_boolean
number     → napi_create_double / napi_create_int32
Object     → napi_create_object
Array      → napi_create_array
Promise<T> → napi_create_promise
void       → napi_create_null / napi_get_null
null       → napi_create_null / napi_get_null
```

  3. 逐一对比每个方法的返回值类型映射
  4. **判定规则**：C++ 返回值构造函数与 JS Spec 期望返回值类型不对应 → 返回值类型致命错误
- **扣分规则**：返回值类型错误扣 10 分/个
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 返回类型 | 预期 napi 构造 | C++ 实际 napi 构造 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|-------------|-----------------|-------------|------|------|
| 1 | {方法名} | {JS Spec返回类型} | {预期构造函数} | {实际构造函数} | {文件:行号} | ✅一致 / ❌类型错误 | {扣分} |
```

##### 检查项 2：返回值语义

- **检查项**：C++ TurboModule 返回内容是否符合接口语义
- **特征检索方式**：
  - C++ JSIBinder + TurboModule 实现：读取 HostFunction lambda 返回值构造的具体内容
  - JS Spec：读取方法语义描述和返回值文档
- **检视步骤**：
  1. 读取 C++ TurboModule 实现代码（JSIBinder 中的 HostFunction lambda 或 TurboModule.cpp 方法实现），验证返回值的具体内容是否正确
  2. 读取 JS Spec，提取每个方法的语义描述（如方法名 `isFileUploadSupported` 应返回布尔值表示是否支持文件上传）
  3. 对比 C++ 返回值内容与 JS Spec 语义描述是否一致
  4. **判定规则**：返回值语义与 JS Spec 描述不一致 → 语义错误；例如方法名暗示返回布尔值但 C++ 固定返回 `napi_create_null`
- **扣分规则**：语义错误扣 8 分/个
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 返回语义 | C++ 返回值内容 | C++ 文件:行号 | 语义一致性 | 扣分 |
|---|--------|-------------|-----------|-------------|---------|------|
| 1 | {方法名} | {语义描述} | {实际返回内容} | {文件:行号} | ✅一致 / ❌语义错误 | {扣分} |
```

##### 检查项 3：Promise 处理

- **检查项**：异步方法是否正确返回 Promise
- **特征检索方式**：
  - C++ JSIBinder：grep `napi_create_promise`、`napi_resolve_deferred`、`napi_reject_deferred` 于 `*JSIBinder.h/cpp`
  - JS Spec：从 Spec 接口提取返回 `Promise<T>` 的方法
- **检视步骤**：
  1. 读取 JS Spec，识别所有返回值为 `Promise<T>` 的异步方法
  2. 读取 C++ JSIBinder.h/cpp，对每个异步方法检查是否使用了 `napi_create_promise` 创建 Promise
  3. 检查 Promise 的 resolve/reject 模式：是否有 `napi_resolve_deferred` 和 `napi_reject_deferred` 的正确调用
  4. **判定规则**：JS Spec 标记为异步方法但 C++ 未使用 Promise 模式 → Promise 处理不正确；C++ 使用了 Promise 但未正确 resolve/reject → Promise 不完整
- **扣分规则**：不正确扣 6 分/个
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 返回类型 | C++ Promise 创建 | C++ resolve/reject | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|---------------|------------------|-------------|------|------|
| 1 | {方法名} | Promise<T> | ✅ napi_create_promise / ❌ 未创建 | ✅ resolve+reject / ⚠️ 不完整 / ❌ 缺失 | {文件:行号} | ✅正确 / ❌不正确 | {扣分} |
```

##### 检查项 4：C++ getConstants()

- **检查项**：C++ TurboModule getConstants() vs JS Spec 常量定义
- **特征检索方式**：
  - C++ TurboModule：grep `getConstants` 于 `*TurboModule.h/cpp`，提取常量名和值
  - JS Spec：从 Spec 文件读取常量定义
- **检视步骤**：
  1. 读取 C++ TurboModule.h/cpp 文件，定位 `getConstants()` 方法，提取所有常量名及其值 → 得到 C++ 常量列表
  2. 读取 JS Spec 文件，提取所有常量定义（通常在 Spec 接口的常量部分） → 得到 JS Spec 常量列表
  3. 以 JS Spec 常量列表为基准，逐一检查 C++ getConstants() 中是否包含对应常量
  4. **判定规则**：JS Spec 定义了常量但 C++ getConstants() 缺失该常量 → C++ 缺失常量
- **扣分规则**：C++ 缺失常量扣 5 分/个
- **输出格式**：

```markdown
| # | 常量名 | JS Spec 常量定义 | C++ getConstants() 常量 | C++ 常量值 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|-------------------|---------|-------------|------|------|
| 1 | {常量名} | ✅ {Spec文件:行号} | ✅ 有 / ❌ 缺失 | {值} | {文件:行号} | ✅一致 / ❌缺失 | {扣分} |
```

#### ②平台实现差异

##### 检查项 5：返回值 vs Android

- **检查项**：C++ TurboModule 返回值 vs Android @ReactMethod 返回值
- **特征检索方式**：
  - C++ JSIBinder：grep 返回值构造函数于 `*JSIBinder.h/cpp`
  - Android：grep `@ReactMethod` 注解方法返回类型于 Java/Kotlin 文件
- **检视步骤**：
  1. 从 C++ JSIBinder 提取方法返回值类型列表
  2. 从 Android Java/Kotlin 文件读取 `@ReactMethod` 方法的返回值类型
  3. 对每个方法，对比 C++ 返回值与 Android 返回值
  4. **判定规则**：C++ 与 Android 返回值差异不独立扣分，与 JS Spec 一致性检查合并计算
- **扣分规则**：与 JS Spec 一致性检查合并计算，不独立扣分
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 返回类型 | C++ 返回值类型 | Android 返回值类型 | C++ vs JS Spec 状态 | C++ vs Android 状态 | 备注 |
|---|--------|-------------|-------------|-----------------|-------------------|-------------------|------|
| 1 | {方法名} | {类型} | {类型} | {类型} | {一致/不一致} | {一致/不一致} | {合并扣分归属} |
```

##### 检查项 6：返回值 vs iOS

- **检查项**：C++ TurboModule 返回值 vs iOS RCT_EXPORT_METHOD 返回值
- **特征检索方式**：
  - C++ JSIBinder：grep 返回值构造函数于 `*JSIBinder.h/cpp`
  - iOS：grep `RCT_EXPORT_METHOD` 返回类型于 ObjC/Swift 文件
- **检视步骤**：
  1. 从 C++ JSIBinder 提取方法返回值类型列表
  2. 从 iOS Swift/ObjC 文件读取方法返回值类型
  3. 对每个方法，对比 C++ 返回值与 iOS 返回值
  4. **判定规则**：同检查项 5，差异与 JS Spec 一致性检查合并计算
- **扣分规则**：与 JS Spec 一致性检查合并计算，不独立扣分
- **输出格式**：

```markdown
| # | 方法名 | JS Spec 返回类型 | C++ 返回值类型 | iOS 返回值类型 | C++ vs JS Spec 状态 | C++ vs iOS 状态 | 备注 |
|---|--------|-------------|-------------|-------------|-------------------|---------------|------|
| 1 | {方法名} | {类型} | {类型} | {类型} | {一致/不一致} | {一致/不一致} | {合并扣分归属} |
```

#### ③架构桥接一致性

（返回值的架构桥接在①契约一致性中已覆盖）

---

### 3.3 检查点：实现逻辑（C++→ArkTS 映射、回调绑定一致性）

#### 检查项概要

| 维度 | # | 检查项 | 致命度 |
|------|---|--------|--------|
| ①契约一致性 | — | N/A（实现逻辑不属于契约维度） | — |
| ②平台实现差异 | 1 | C++→ArkTS 映射 | 严重 |
| ②平台实现差异 | 2 | C++ 回调绑定 | 严重 |
| ②平台实现差异 | 3 | C++ 回调参数类型 | 致命 |
| ③架构桥接一致性 | — | 已在②中覆盖 | — |

> 📖 **ArkTS TurboModule 方法实现完整性检视**（方法存在性、签名一致性、Stub 检测等）详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 3.2-3.3 节。

#### ①契约一致性

（实现逻辑不属于契约维度）

#### ②平台实现差异

##### 检查项 1：C++→ArkTS 映射

- **检查项**：C++ FactoryDelegate `std::make_shared<XxxTurboModule>` 类名 vs ArkTS 实际 TurboModule 类名
- **特征检索方式**：
  - C++ FactoryDelegate：grep `std::make_shared<` 于 `*Package.h`、`*TurboModuleFactoryDelegate.h/cpp`
  - ArkTS TurboModule：读取 `*TurboModule.ets` 文件中的类声明
- **检视步骤**：
  1. 读取 C++ FactoryDelegate.h/cpp，从 `createTurboModule()` 方法中提取所有 `std::make_shared<XxxTurboModule>(ctx, name)` 构造调用 → 得到 C++ 构造类名列表
  2. 读取 ArkTS TurboModule.ets 文件，提取 TurboModule 实现类名（如 `class RNCWebViewModule extends TurboModule`）→ 得到 ArkTS TurboModule 类名列表
  3. 逐一对比每个 TurboModule 的 C++ 构造类名与 ArkTS 实际类名
  4. **判定规则**：C++ `std::make_shared<XxxTurboModule>` 中的类名必须与 ArkTS TurboModule.ets 中的类名一致；不匹配 → 类名映射错误
- **扣分规则**：不匹配扣 8 分/个
- **输出格式**：

```markdown
| # | TurboModule 名 | C++ 构造类名 | C++ 文件:行号 | ArkTS TurboModule 类名 | ArkTS 文件:行号 | 状态 | 扣分 |
|---|--------------|------------|-------------|---------------------|-------------|------|------|
| 1 | {TM名} | {std::make_shared<类名>} | {文件:行号} | {ArkTS class名} | {文件:行号} | ✅一致 / ❌不匹配 | {扣分} |
```

##### 检查项 2：C++ 回调绑定

- **检查项**：JS Spec 回调方法是否在 C++ JSIBinder 中有 HostFunction 注册
- **特征检索方式**：
  - JS Spec：识别接受 Function 类型参数的方法（回调方法）
  - C++ JSIBinder：grep `napi_get_function` 或 Function 参数处理于 `*JSIBinder.h/cpp`
- **检视步骤**：
  1. 读取 JS Spec，识别所有回调类型方法（方法参数类型包含 `Function` 或 `(callback: (...args) => void)` 的方法） → 得到 JS Spec 回调方法列表
  2. 读取 C++ JSIBinder.h/cpp，检查这些回调方法是否有对应的 HostFunction 注册
  3. 对每个回调方法，检查 C++ JSIBinder 中是否正确处理了 Function 参数（是否有 `napi_get_function` 提取回调函数并绑定）
  4. **判定规则**：JS Spec 定义了回调方法但 C++ JSIBinder 无对应 HostFunction 注册 → 回调绑定缺失
- **扣分规则**：C++ 缺失回调绑定扣 8 分/个
- **输出格式**：

```markdown
| # | 回调方法名 | JS Spec 回调参数 | C++ JSIBinder HostFunction | C++ 回调处理 | C++ 文件:行号 | 状态 | 扣分 |
|---|----------|-------------|--------------------------|-----------|-------------|------|------|
| 1 | {方法名} | {callback参数签名} | ✅ 有注册 / ❌ 无注册 | ✅ napi_get_function / ❌ 缺失 | {文件:行号} | ✅已绑定 / ❌缺失 | {扣分} |
```

##### 检查项 3：C++ 回调参数类型

- **检查项**：C++ JSIBinder 回调参数类型映射
- **特征检索方式**：
  - C++ JSIBinder：在回调 HostFunction lambda 中提取回调参数的 napi 类型转换模式
  - JS Spec：从回调方法的 Function 参数类型签名提取回调参数类型
- **检视步骤**：
  1. 读取 JS Spec，对每个回调方法提取 Function 参数的回调参数类型签名（如 `(success: boolean, error: string) => void`）→ 得到 JS Spec 回调参数类型列表
  2. 读取 C++ JSIBinder.h/cpp，对每个回调 HostFunction 提取回调参数的 napi 类型转换模式（回调调用时的参数构造，如 `napi_create_boolean`、`napi_create_string_utf8`）→ 得到 C++ 回调参数类型映射列表
  3. 逐一对比回调参数的类型映射
  4. **判定规则**：C++ 回调参数 napi 类型与 JS Spec 回调参数类型不对应 → 回调参数类型致命错误
- **扣分规则**：类型错误扣 10 分/个
- **输出格式**：

```markdown
| # | 回调方法名 | 回调参数名 | JS Spec 回调参数类型 | 预期 napi 构造 | C++ 实际 napi 构造 | C++ 文件:行号 | 状态 | 扣分 |
|---|----------|---------|-------------|-------------|-----------------|-------------|------|------|
| 1 | {方法名} | {参数名} | {类型} | {预期构造函数} | {实际构造函数} | {文件:行号} | ✅一致 / ❌类型错误 | {扣分} |
```

#### ③架构桥接一致性

（已在②平台实现差异中覆盖）

> 📖 **ArkTS TurboModule 常量导出检视**详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 3.4 节。
> 📖 **ArkTS TurboModule 回调/事件检视**详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 3.5 节。

---

## 4. 方法级对比格式

### 4.1 TurboModule 方法签名对比（C++ 层）

> 📖 **ArkTS TurboModule 方法签名对比**详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 2.2 维度 B。

```markdown
| # | 方法名 | JS Spec 签名 | C++ JSIBinder 签名 | C++ 文件:行号 | C++ 绑定状态 | 扣分 |
|---|--------|-------------|-------------------|-------------|-------------|------|
| 1 | `isFileUploadSupported` | `(): Promise<boolean>` | `SharedTurboModule → resolve bool` | `RNCWebViewModuleJSIBinder.h:12` | ✅ 一致 | 0 |
| 2 | `shouldStartLoadWithLockIdentifier` | `(shouldStart: boolean, lockIdentifier: Double): void` | `(bool, double) → void` | `RNCWebViewModuleJSIBinder.h:18` | ✅ 一致 | 0 |
```

### 4.2 TurboModule 跨层一致性对比（C++ 层视角）

> 📖 **ArkTS TurboModule Stub 检测**详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 2.2 维度 C。

```markdown
| # | TurboModule 名 | JS Spec 定义 | JS Spec 注册名 | C++ FactoryDelegate | C++ JSIBinder | C++ 文件 | 状态 | 扣分 |
|---|--------------|------------|--------------|--------------------|-------------|---------|------|------|
| 1 | `RNCWebViewModule` | `NativeRNCWebViewModule.ts` | `RNCWebViewModule` | ✅ BaseReactNativeWebviewPackageTurboModuleFactoryDelegate | ✅ RNCWebViewModuleJSIBinder | `BaseReactNativeWebviewPackage.h:22` | ✅ C++ 层一致 | 0 |
```

> 📖 **ArkTS TurboModule 层补充列**（ArkTS 实现类、ArkTS NAME 常量、ArkTS 方法签名）详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 5.1 节全链路对比表。

---

## 5. Stub 检测指引

> 📖 **ArkTS TurboModule Stub 检测与合理性判定**已独立为 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 3.3 节和第 2.2 维度 C。

本指南（C++ 层）不直接执行 Stub 检测，因为 Stub 是 ArkTS TurboModule 实现层的概念。但 C++ JSIBinder 层可能存在以下问题：

| C++ 层问题 | 识别方式 | 扣分 |
|----------|----------|------|
| C++ JSIBinder 方法缺失 | JS Spec 定义了方法但 C++ JSIBinder 无 HostFunction 注册 | -10/方法 |
| C++ JSIBinder 参数类型错误 | napi 类型转换与 JS Spec 不一致 | -10/方法 |
| C++ JSIBinder 方法名不匹配 | HostFunction 方法名与 JS Spec 方法名不一致 | -8/方法 |

---

## 6. 检视操作流程

### 6.1 Phase 0 补充步骤（TurboModule C++ 层定位）

```
TM-1: 定位 TurboModuleFactoryDelegate
      → Codegen: 读取 generated/RNOH/generated/BaseReactNative*Package.h
      → Legacy: 读取 *Package.h 或 *TurboModuleFactoryDelegate.h

TM-2: 提取 TurboModule 名列表
      → 从 createTurboModule() 方法的 if 条件中提取所有 TurboModule 名
      → 对比 JS 层 TurboModuleRegistry.getEnforcing<Spec>('XXX') 的模块名

TM-3: 定位 TurboModule JSIBinder（若存在）
      → 搜索 generated/RNOH/generated/turbo_modules/*JSIBinder.h
      → 搜索 cpp/*TurboModule*JSIBinder.h
```

> 📖 **ArkTS TurboModule 定位步骤**（TM-ARK-1~4）详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 6.1 节。

### 6.2 Phase 3 补充步骤（TurboModule C++ 层分析）

```
TM-5: TurboModule 注册完整性对比
      → C++ FactoryDelegate TurboModule 名 vs JS Spec TurboModule 名
      → 标注缺失的 TurboModule 注册

TM-6: TurboModule JSIBinder 方法级对比（C++ 层）
      → JS Spec 方法签名 vs C++ JSIBinder 方法签名
      → 标注 C++ JSIBinder 方法缺失、类型映射错误

TM-7: TurboModule C++→ArkTS 映射对比
      → C++ FactoryDelegate 构造类名 vs ArkTS TurboModule 类名
      → C++ 注册名 vs ArkTS NAME 常量
```

> 📖 **ArkTS TurboModule 分析步骤**（TM-ARK-5~11）详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 6.2 节。

---

## 7. 报告输出格式

在一致性检视报告的"5.8 RN 架构一致性检视"中增加以下子章节（C++ 层部分）：

> 📖 **ArkTS TurboModule 层报告输出格式**详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 7 节。

```markdown
#### C++ TurboModule 层一致性（如适用）

**C++ TurboModule 模式**：{Codegen / Legacy / ⚠️ 无 C++ TurboModule 层}

| # | TurboModule 名 | JS Spec 注册名 | C++ FactoryDelegate | C++ JSIBinder | C++ 文件 | 状态 | 扣分 |
|---|--------------|--------------|--------------------|-------------|---------|------|------|
| ... | ... | ... | ... | ... | ... | ... | ... |

**TurboModule JSIBinder 方法级对比（C++ 层）**：

| # | 方法名 | JS Spec 签名 | C++ JSIBinder 签名 | C++ 文件:行号 | C++ 绑定状态 | 扣分 |
|---|--------|-------------|-------------------|-------------|-------------|------|
| ... | ... | ... | ... | ... | ... | ... |
```

---

## 8. 与 ARKTS_TURBOMODULE_CHECK_GUIDE 的协同

本指南仅覆盖 **C++ TurboModule 层**（FactoryDelegate + JSIBinder），ArkTS TurboModule 层（实现类 + 方法完整性 + Stub + 常量 + 回调）已独立为 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](ARKTS_TURBOMODULE_CHECK_GUIDE.md)。

检视执行顺序建议：

1. **先执行本指南** → 获得 C++ FactoryDelegate 注册名、JSIBinder 方法列表
2. **再执行 ARKTS_TURBOMODULE_CHECK_GUIDE** → 获得 ArkTS TurboModule 类声明、方法实现、Stub 检测、常量导出、回调/事件
3. **合并两张表** → 以 TurboModule 名为主键，拼接 C++ 层列和 ArkTS 层列，生成完整全链路一致性分析