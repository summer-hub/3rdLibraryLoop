# ArkTS TurboModule 层一致性检视指南

本指南定义 RN 鸿蒙化一致性检视中 **ArkTS TurboModule 层**（TurboModule ArkTS 实现类、generated Spec 类型、方法实现、常量导出、回调机制）的检视规范，确保 AI Agent 能系统性地读取和分析 ArkTS TurboModule 代码，检测方法 Stub、方法缺失、常量导出缺失、回调逻辑不一致等问题。

---

## 1. 适用条件与前置依赖

### 1.1 适用条件

当 `harmony/<module>/src/main/ets/` 目录存在 TurboModule 实现文件（`*TurboModule.ets`）时，必须执行本指南的检视流程。若不存在，标注"⚠️ 无 ArkTS TurboModule 实现"并跳过。

判定条件：

| 条件 | 判定 |
|------|------|
| `harmony/<module>/src/main/ets/*TurboModule.ets` 存在 | ✅ ArkTS TurboModule 实现（必须检视） |
| `generated/turboModules/TurboModuleName.ts` 存在 | ✅ Codegen Spec 类型定义（必须检视） |
| 以上均不存在 | ⚠️ 无 ArkTS TurboModule 层，跳过本指南 |

### 1.2 前置依赖

- Phase 0 中已定位的 TurboModule 名（从 C++ FactoryDelegate 或 JS Spec 提取）
- C++ TurboModule JSIBinder 方法列表（来自 CPP_TURBOMODULE_CHECK_GUIDE）
- JS 层 TurboModule Spec 定义（`NativeRNCWebViewModule.ts` 等文件）
- C++ TurboModuleFactoryDelegate 注册名列表

### 1.3 与其他检视指南的关系

| 检视指南 | 检视层级 | 本指南关注点 |
|----------|----------|-------------|
| CPP_COMPONENT_CHECK_GUIDE | C++ 组件层 | JSIBinder Props 序列化、NapiBinder 桥接、Package 注册 |
| CPP_TURBOMODULE_CHECK_GUIDE | C++ TurboModule 层 | TurboModuleFactoryDelegate 注册、TurboModule JSIBinder 方法绑定 |
| ARKTS_COMPONENT_CHECK_GUIDE | ArkTS @Component 层 | rawProps 读取、Commands switch、事件 emit、build() 渲染 |
| ARKTS_TURBOMODULE_CHECK_GUIDE（本文件） | ArkTS TurboModule 层 | 方法实现完整性、Stub 检测、常量导出、回调逻辑、行为对比 |

---

## 2. 文件定位与读取

### 2.1 ArkTS TurboModule 实现定位

**搜索路径**：`harmony/<module>/src/main/ets/`

| 步骤 | 搜索目标 | 搜索模式 | 目的 |
|------|----------|----------|------|
| 2.1a | TurboModule 实现文件 | `*TurboModule.ets` | 定位 ArkTS TurboModule 实际实现类 |
| 2.1b | TurboModule 继承方式 | `extends AnyThreadTurboModule` / `extends TurboModule` | 确定线程模型 |
| 2.1c | TurboModule Spec 实现 | `implements TM.Xxx.Spec` | 确认是否实现了 generated Spec 接口 |

**必须读取的文件清单**：

| # | 文件 | 说明 |
|---|------|------|
| 1 | `*TurboModule.ets`（主实现文件） | 包含 TurboModule 类声明、方法实现、常量导出 |
| 2 | `generated/turboModules/TurboModuleName.ts`（若存在） | Codegen Spec 类型定义（NAME 常量 + Spec 接口） |
| 3 | `generated/turboModules/ts.ts`（若存在） | TurboModule 命名空间导出汇总 |

### 2.2 ArkTS TurboModule 必读内容（五个维度）

#### 维度 A：类声明与 Spec 实现

```
1. 类声明
   → class XxxTurboModule extends AnyThreadTurboModule / TurboModule
   → 是否 implements TM.Xxx.Spec（Codegen 模式）
   → 是否手写 Spec 接口（Legacy 模式）

2. NAME 常量
   → TurboModule 注册名（TM.Xxx.NAME 或手写常量）
   → 与 JS Spec TurboModuleRegistry.getEnforcing<Spec>('XXX') 的模块名对比
   → 与 C++ FactoryDelegate 注册名对比

3. 构造方法
   → constructor(ctx: TurboModuleContext, name: string)
   → 是否在构造中初始化了必要的状态变量
```

**类声明提取模板**：

```markdown
| # | TurboModule 名 | ArkTS 类名 | ArkTS 父类 | implements Spec? | NAME 常量值 | JS Spec 注册名 | C++ FactoryDelegate 注册名 | 状态 |
|---|--------------|-----------|-----------|-----------------|------------|--------------|------------------------|------|
| 1 | `RNCWebViewModule` | `WebViewTurboModule` | `AnyThreadTurboModule` | ✅ TM.RNCWebViewModule.Spec | `RNCWebViewModule` | `RNCWebViewModule` ✅ | `RNCWebViewModule` ✅ | ✅ 全链路一致 |
```

#### 维度 B：方法实现完整性

```
1. 方法名列表
   → 提取所有 public 方法名
   → 与 JS Spec 方法名对比
   → 与 generated Spec 接口方法名对比

2. 方法签名
   → 提取每个方法的参数类型和返回值类型
   → 与 JS Spec 签名对比

3. 方法实现状态
   → 是否为正常实现（调用了 @ohos API 或业务逻辑）
   → 是否为 Stub（返回固定值、空方法体、仅日志）
```

**方法级对比模板**：

```markdown
| # | 方法名 | JS Spec 签名 | generated Spec 签名 | ArkTS TurboModule 签名 | ArkTS 文件:行号 | 实现状态 | 扣分 |
|---|--------|-------------|--------------------|----------------------|---------------|----------|------|
| 1 | `isFileUploadSupported` | `(): Promise<boolean>` | `(): Promise<boolean>` | `(): Promise<boolean>` | `WebViewTurboModule.ets:14` | ⚠️ Stub（固定返回 true） | -8 |
| 2 | `shouldStartLoadWithLockIdentifier` | `(shouldStart: boolean, lockIdentifier: Double): void` | `(shouldStart: boolean, lockIdentifier: number): void` | `(shouldStart: boolean, lockIdentifier: number): void` | `WebViewTurboModule.ets:18` | ✅ 正常实现 | 0 |
| 3 | `injectJavaScript` | `(script: string): void` | `(script: string): void` | ⛔ 不存在 | — | ❌ 方法缺失 | -15 |
```

#### 维度 C：Stub 检测

```
1. Stub 识别特征
   → 方法体仅有 return 语句，返回固定值
   → 未调用任何 @ohos 模块 API
   → 未执行实际业务操作
   → 仅日志输出（console.log）

2. Stub 合理性判定
   → 与 Android/iOS 同名方法对比行为
   → iOS 也返回固定值 → 合理 Stub（不扣分）
   → Android 有实际业务逻辑 → 致命 Stub（扣分）
```

**Stub 检测模板**：

```markdown
| # | 方法名 | ArkTS 文件:行号 | Stub 代码片段 | Android 实现 | iOS 实现 | Stub 合理性 | 缺失逻辑 | 严重度 | 扣分 |
|---|--------|---------------|--------------|-------------|---------|------------|---------|--------|------|
| 1 | `isFileUploadSupported` | `WebViewTurboModule.ets:14` | `return Promise.resolve(true)` | ✅ Android 5+ 返回 true | ✅ 始终返回 YES | ✅ 三平台一致 | 无 | ⚠️ 合理 | 0 |
| 2 | `removeBond` | `BleTurboModule.ets:278` | `return true;` | ✅ 调用 BluetoothDevice.removeBond() | ✅ 调用 CBCentralManager.remove() | ❌ 缺失实际解绑 | 实际解绑操作 | ❌ 致命 | -8 |
| 3 | `requestPriority` | `BleTurboModule.ets:455` | `// todo: implement` | ✅ 调用 gatt.requestConnectionPriority() | ⛔ 不支持 | ❌ 空方法体 | 优先级请求 | ❌ 致命 | -8 |
```

#### 维度 D：常量导出

```
1. getConstants() 方法（若有）
   → 提取所有导出的常量名和值
   → 与 Android/iOS getConstants() 对比

2. 常量值一致性
   → 各平台导出的常量值是否一致
   → 常量名拼写是否一致
```

**常量导出对比模板**：

```markdown
| # | 常量名 | Android getConstants() | iOS getConstants() | ArkTS TurboModule getConstants() | ArkTS 文件:行号 | 值一致性 | 状态 | 扣分 |
|---|--------|----------------------|--------------------|--------------------------------|---------------|---------|------|------|
| 1 | `Scale` | `{Scale: 0.0001}` | `{Scale: 0.0001}` | `{Scale: 0.0001}` | `MapsTurboModule.ets:25` | ✅ | ✅ 一致 | 0 |
| 2 | `ConnectionPriority` | `{HIGH: 1, BALANCED: 0, LOW_POWER: -1}` | ⛔ 无 | ⛔ 无 | — | — | ⚠️ 仅 Android 有 | -3 |
```

#### 维度 E：回调/事件机制

```
1. 回调方法
   → TurboModule 中定义的回调方法（如 shouldStartLoadWithLockIdentifier）
   → 回调触发时机和方式

2. 事件发送
   → TurboModule 是否通过 emitDeviceEvent / sendEvent 发送事件
   → 事件名与 payload 是否与 Android/iOS 一致

3. 回调参数类型
   → 回调方法的参数类型映射是否正确
   → 与 JS Spec 回调参数类型对比
```

**回调/事件对比模板**：

```markdown
| # | 回调/事件名 | JS Spec 定义 | Android 实现 | iOS 实现 | ArkTS TurboModule 实现 | ArkTS 文件:行号 | 行为一致性 | 扣分 |
|---|------------|-------------|-------------|---------|----------------------|---------------|-----------|------|
| 1 | `shouldStartLoadWithLockIdentifier` | `(shouldStart: boolean, lockIdentifier: Double): void` | ✅ AtomicReference + notify | ✅ DecisionManager setResult | ✅ ShouldStartParams + lockState | `WebViewTurboModule.ets:18` | ✅ 功能一致 | 0 |
| 2 | `onBluetoothStateChange` | `event: {state: string}` | ✅ sendEvent("onBluetoothStateChange", {state}) | ✅ RCTEventEmitter | ⛔ 未发送事件 | — | ❌ 事件缺失 | -8 |
```

---

## 3. 检视项与扣分规则

> 本指南覆盖 `arktsTM` 类型实体，检视项按三个关键检查点组织：**函数签名、返回值、实现逻辑**。**最关键检查项为实现逻辑一致性**。

### 3.0 前置过滤：原生注册缺失检测（优先级最高）

> ⚠️ **此步骤必须在所有方法级检视（3.1-3.3）之前执行**。未注册的 TM 整体不可达，其内部方法逐项检视会导致重复扣分且无实际意义。

- **检查项**: 原生注册缺失检测
- **适用场景**: 当 JS/TS Spec 注册的 TurboModule 名在 ArkTS Factory 中未注册时，该 TM 整体不可达（JS 调用 `TurboModuleRegistry.getEnforcing` 将失败），此时应跳过该 TM 内部所有方法的逐项检视。
- **特征检索方式**:
  1. 在 `generated/turboModules/*.ts` 中提取所有 TurboModule `NAME` 常量
  2. 在 `*Package.ets` 中提取 `createTurboModule()` 方法的 `if(name===)` 条件
- **检视步骤**:
  1. 读取 `generated/turboModules/*.ts`，提取所有 TurboModule NAME 常量 → 列表TM_js
  2. 读取 `*Package.ets` 的 `createTurboModule` 方法，提取所有 `if(name===)` 条件中的 TM 名 → 列表TM_registered
  3. 对每个 TM_js 中的名称，检查是否存在于 TM_registered 中
  4. 判定规则：
     - **TM 已注册** → ✅ 通过，继续 3.1-3.3 的正常方法级检视
     - **TM 未注册** → ❌ 致命，扣 -15/实体名，**跳过该 TM 内部所有方法的逐项检视**（方法存在性、签名一致性、参数类型、返回值、实现逻辑等均不再检查）
  5. 将跳过的 TM 记入输出表，明确标注"⛔ 跳过逐项检查"
- **扣分规则**: 未注册→致命-15/实体名；跳过的方法不计入致命问题计数
- **输出格式**:

```markdown
| # | 实体类型 | JS/TS Spec 注册名 | ArkTS Factory 注册 | 状态 | 致命度 | 扣分 | 内部方法检查 |
|---|---------|-----------------|-------------------|------|--------|------|------------|
| 1 | TurboModule | `RNCWebViewModule` | ✅ 已注册 | ✅ 通过 | — | 0 | 继续逐项检视 |
| 2 | TurboModule | `RNCWebView` | ❌ 未注册 | ❌ 致命 | -15 | ⛔ 跳过 |
```

**⚠️ 关键说明**：
- 跳过的 TM 内部方法**不计入致命问题计数**，避免因方法级重复扣分触发归零规则
- 此规则仅适用于 TM 整体未注册（无 ArkTS Factory 条件）的场景。若 TM 已注册但部分方法缺失，仍按检查项 3（方法存在性）的正常规则扣分

### 3.1 检查点：函数签名（仅对已注册的 TM 执行）

#### 检查项概要

| # | 检查项 | 维度 | 对比对象 | 扣分规则 | 致命度 |
|---|--------|------|----------|----------|--------|
| 1 | NAME常量一致性 | ①契约一致性 | ArkTS NAME vs JS Spec注册名 vs C++ FactoryDelegate注册名 | 不一致→-5分/个 | 中等 |
| 2 | 方法签名一致性 | ①契约一致性 | ArkTS方法签名 vs generated Spec签名 vs JS Spec签名 | 签名不匹配→-8分/个 | 严重 |
| 3 | 方法存在性 | ①契约一致性 | JS Spec方法名 vs ArkTS TurboModule方法名 | 方法缺失→-15分/个 | 致命 |
| 4 | 参数数量 | ①契约一致性 | JS Spec参数数量 vs ArkTS TurboModule参数数量 | 不匹配→-8分 | 致命 |
| 5 | 参数类型 | ①契约一致性 | ArkTS TurboModule参数类型 vs JS Spec参数类型 | 类型致命错误→-10分/个 | 致命 |
| 6 | 参数顺序 | ①契约一致性 | JS Spec参数位置 vs ArkTS TurboModule参数位置 | 顺序错误→-6分 | 中等 |
| 7 | 方法签名vs Android | ②平台实现差异 | ArkTS TurboModule方法签名 vs Android @ReactMethod签名 | 合并至①检查 | — |
| 8 | 方法签名vs iOS | ②平台实现差异 | ArkTS TurboModule方法签名 vs iOS RCT_EXPORT_METHOD签名 | 合并至①检查 | — |
| 9 | Spec接口实现 | ③架构桥接一致性 | ArkTS TurboModule是否implements generated Spec接口 | 未实现→-8分/个 | 严重 |

> ⚠️ **前置过滤规则（3.0节）优先级最高**：检查项 1-9 仅对**已注册的 TM** 执行。未注册的 TM 整体在 3.0 中已扣致命-15，其内部方法不再逐项检视。

#### ①契约一致性

##### 检查项1：NAME常量一致性

- **检查项**: NAME常量一致性
- **特征检索方式**: 在 `*TurboModule.ets` 中 grep `NAME = ` 或 `static NAME`；在 JS Spec 中 grep `TurboModuleRegistry.getEnforcing`；在 C++ FactoryDelegate 中 grep `if(name=="`
- **检视步骤**:
  1. 读取 `*TurboModule.ets`，提取 NAME 常量值（格式为 `TM.Xxx.NAME` 或 `static NAME = "xxx"`）
  2. 读取 JS Spec 文件，提取 `TurboModuleRegistry.getEnforcing<Spec>('XXX')` 中的模块注册名
  3. 读取 C++ FactoryDelegate 文件，提取 `if(name=="XXX")` 条件中的注册名
  4. 比较三者：ArkTS NAME值、JS Spec注册名、C++ FactoryDelegate注册名
  5. 判定规则：三者完全一致→通过；任一不一致→标注不一致并扣分
- **扣分规则**: 不一致→中等-5分/个
- **输出格式**:

```markdown
| # | NAME来源 | NAME值 | 是否一致 | 扣分 |
|---|---------|--------|---------|------|
| 1 | ArkTS TurboModule NAME常量 | `"RNCWebViewModule"` | — | — |
| 2 | JS Spec TurboModuleRegistry注册名 | `'RNCWebViewModule'` | ✅/❌ | 0/-5 |
| 3 | C++ FactoryDelegate注册名 | `"RNCWebViewModule"` | ✅/❌ | 0/-5 |
```

##### 检查项2：方法签名一致性

- **检查项**: 方法签名一致性
- **特征检索方式**: 在 `*TurboModule.ets` 中 grep 所有 public 方法声明；在 generated Spec ts 文件中 grep interface 方法签名；在 JS Spec 中 grep 方法签名
- **检视步骤**:
  1. 从 `*TurboModule.ets` 提取所有 public 方法名及完整签名（参数类型+返回值类型）→列表M
  2. 从 generated Spec ts 文件提取所有 interface 方法签名→列表S
  3. 从 JS Spec 提取所有方法签名→列表J
  4. 逐方法对比 M vs S vs J：方法名相同则对比参数类型、参数顺序、返回值类型是否完全匹配
  5. 判定规则：签名完全一致→通过；任一不匹配→标注不匹配项并扣分
- **扣分规则**: 签名不匹配→严重-8分/个
- **输出格式**:

```markdown
| # | 方法名 | ArkTS TurboModule签名 | generated Spec签名 | JS Spec签名 | 签名一致性 | 不匹配详情 | 扣分 |
|---|--------|----------------------|--------------------|------------|-----------|-----------|------|
| 1 | `connect` | `(id: string): void` | `(id: string): void` | `(id: string): void` | ✅ | — | 0 |
| 2 | `readRSSI` | `(id: number): Promise<number>` | `(id: string): Promise<number>` | `(id: string): Promise<number>` | ❌ | ArkTS参数类型number vs string | -8 |
```

##### 检查项3：方法存在性

- **检查项**: 方法存在性
- **特征检索方式**: 在 JS Spec 中提取所有方法名列表；在 `*TurboModule.ets` 中 grep 所有 public 方法名；在文档中搜索不支持标注
- **检视步骤**:
  1. 从 JS Spec 提取所有方法名→列表J
  2. 从 `*TurboModule.ets` 提取所有 public 方法名→列表A
  3. 对每个 JS Spec 方法名，检查是否存在于列表A中
  4. **🟢 豁免检查（优先级高于扣分）**：对每个 ArkTS 缺失的方法，检查文档是否标注不支持：
     - 查找 **接口规格说明**（如 `接口规格说明.md`），该方法行是否有 `(Android only)`、`(iOS only)`、`(不支持)` 等标注
     - 查找 **OHOS README**（如 `harmony/README.md`），"HarmonyOS Support" 列是否为 "No"，"Platform" 列是否非 "All" 且非 "HarmonyOS"
     - 查找 **源码注释**，是否有 `// not supported`、`// Android only` 等标注
  5. 判定规则：
     - 🟢 **文档已标注不支持** → 豁免，0分，标注"🟢 文档标注不支持（来源：文件:行号）"
     - ❌ **文档未标注不支持** → 方法缺失→致命-15分/个
- **扣分规则**: 方法缺失→致命-15分/个；文档标注不支持→豁免0分（不计入致命问题计数）
- **输出格式**:

```markdown
| # | 方法名 | JS Spec存在 | ArkTS TurboModule存在 | 文档标注不支持 | 文档来源 | 状态 | 扣分 |
|---|--------|------------|----------------------|--------------|---------|------|------|
| 1 | `connect` | ✅ | ✅ | — | — | ✅ 方法存在 | 0 |
| 2 | `clearFormData` | ✅ | ❌ | ✅ Android only, HarmonyOS Support: No | README.md:380 | 🟢 豁免不扣分 | 0 |
| 3 | `injectJavaScript` | ✅ | ❌ | ❌ 无标注 | — | ❌ 方法缺失 | -15 |
```

##### 检查项4：参数数量

- **检查项**: 参数数量
- **特征检索方式**: 在 JS Spec 中统计每个方法参数数量；在 `*TurboModule.ets` 中统计每个方法参数数量
- **检视步骤**:
  1. 从 JS Spec 逐方法统计参数数量→映射Q_js
  2. 从 `*TurboModule.ets` 逐方法统计参数数量→映射Q_arkts
  3. 对每个共有方法，对比 Q_js[method] vs Q_arkts[method]
  4. 判定规则：数量一致→通过；不匹配→标注差异并扣分
- **扣分规则**: 不匹配→致命-8分
- **输出格式**:

```markdown
| # | 方法名 | JS Spec参数数量 | ArkTS TurboModule参数数量 | 是否一致 | 扣分 |
|---|--------|---------------|-------------------------|---------|------|
| 1 | `connect` | 1 | 1 | ✅ | 0 |
| 2 | `startScan` | 3 | 2 | ❌ | -8 |
```

##### 检查项5：参数类型

- **检查项**: 参数类型
- **特征检索方式**: 在 `*TurboModule.ets` 中读取每个方法参数的类型标注；在 JS Spec 中读取对应方法参数类型定义
- **检视步骤**:
  1. 从 `*TurboModule.ets` 逐方法读取每个参数的类型标注→映射T_arkts
  2. 从 JS Spec 逐方法读取每个参数的类型定义→映射T_js
  3. 对每个共有方法的每个参数，对比 T_arkts[method][param] vs T_js[method][param]
  4. 判定规则：类型完全匹配或为合理的跨平台类型映射（如Double→number）→通过；类型致命错误→标注并扣分
- **扣分规则**: 类型致命错误→致命-10分/个
- **输出格式**:

```markdown
| # | 方法名 | 参数位置 | JS Spec类型 | ArkTS TurboModule类型 | 类型一致性 | 扣分 |
|---|--------|---------|------------|----------------------|-----------|------|
| 1 | `shouldStartLoadWithLockIdentifier` | 参数1 | `boolean` | `boolean` | ✅ | 0 |
| 2 | `shouldStartLoadWithLockIdentifier` | 参数2 | `Double` | `number` | ✅（合理映射） | 0 |
| 3 | `readRSSI` | 参数1 | `string` | `number` | ❌ | -10 |
```

##### 检查项6：参数顺序

- **检查项**: 参数顺序
- **特征检索方式**: 在 JS Spec 中提取每个方法参数定义顺序；在 `*TurboModule.ets` 中提取每个方法参数声明顺序
- **检视步骤**:
  1. 从 JS Spec 逐方法提取参数定义顺序→映射O_js
  2. 从 `*TurboModule.ets` 逐方法提取参数声明顺序→映射O_arkts
  3. 对每个共有方法，逐参数位置对比 O_js[method][i] vs O_arkts[method][i] 的参数名
  4. 判定规则：同名参数位置完全一致→通过；顺序错误→标注并扣分
- **扣分规则**: 顺序错误→中等-6分
- **输出格式**:

```markdown
| # | 方法名 | JS Spec参数顺序 | ArkTS TurboModule参数顺序 | 顺序一致性 | 扣分 |
|---|--------|----------------|-------------------------|-----------|------|
| 1 | `connect` | `(id, options)` | `(id, options)` | ✅ | 0 |
| 2 | `startScan` | `(filter, options, callback)` | `(options, filter, callback)` | ❌ | -6 |
```

#### ②平台实现差异

##### 检查项7：方法签名vs Android

- **检查项**: 方法签名vs Android
- **特征检索方式**: 在 Android Java/Kotlin 文件中 grep `@ReactMethod` 注解的方法签名；在 `*TurboModule.ets` 中 grep public 方法签名
- **检视步骤**:
  1. 从 `*TurboModule.ets` 提取所有方法签名→列表M
  2. 从 Android Java/Kotlin TurboModule 文件中读取所有 `@ReactMethod` 标注的方法签名→列表A_android
  3. 对每个共有方法，对比 M[method] vs A_android[method] 的参数数量、参数类型、返回值类型
  4. 判定规则：差异项合并至①契约一致性检查，不独立扣分；Android签名差异视为JS Spec签名差异的补充参考
- **扣分规则**: 差异合并至①检查，不独立扣分
- **输出格式**:

```markdown
| # | 方法名 | ArkTS TurboModule签名 | Android @ReactMethod签名 | 差异 | 合并至①检查项 |
|---|--------|----------------------|------------------------|------|-------------|
| 1 | `connect` | `(id: string): void` | `(String id): void` | ✅ 功能一致 | — |
| 2 | `requestPriority` | `(priority: number): void` | `(int priority): void` | ✅ 合理映射 | — |
```

##### 检查项8：方法签名vs iOS

- **检查项**: 方法签名vs iOS
- **特征检索方式**: 在 iOS 文件中 grep `RCT_EXPORT_METHOD` 宏定义的方法签名；在 `*TurboModule.ets` 中 grep public 方法签名
- **检视步骤**:
  1. 从 `*TurboModule.ets` 提取所有方法签名→列表M
  2. 从 iOS TurboModule 文件中读取所有 `RCT_EXPORT_METHOD` 定义的签名→列表A_ios
  3. 对每个共有方法，对比 M[method] vs A_ios[method] 的参数数量、参数类型、返回值类型
  4. 判定规则：差异项合并至①契约一致性检查，不独立扣分；iOS签名差异视为JS Spec签名差异的补充参考
- **扣分规则**: 差异合并至①检查，不独立扣分
- **输出格式**:

```markdown
| # | 方法名 | ArkTS TurboModule签名 | iOS RCT_EXPORT_METHOD签名 | 差异 | 合并至①检查项 |
|---|--------|----------------------|--------------------------|------|-------------|
| 1 | `connect` | `(id: string): void` | `(NSString *id)` | ✅ 功能一致 | — |
| 2 | `readRSSI` | `(id: number): Promise<number>` | `(NSString *deviceID)` | 参数名差异 | 参考① |
```

#### ③架构桥接一致性

##### 检查项9：Spec接口实现

- **检查项**: Spec接口实现
- **特征检索方式**: 在 `*TurboModule.ets` 中 grep `implements TM.Xxx.Spec` 或类声明中的 implements 关系
- **检视步骤**:
  1. 读取 `*TurboModule.ets` 中 TurboModule 类声明行
  2. 检查类声明是否包含 `implements TM.Xxx.Spec`（Codegen模式）或手写 Spec 接口（Legacy模式）
  3. 判定规则：实现了 generated Spec 接口→通过；未实现→标注并扣分
- **扣分规则**: 未实现→严重-8分/个
- **输出格式**:

```markdown
| # | TurboModule名 | ArkTS类声明 | implements Spec? | Spec接口来源 | 状态 | 扣分 |
|---|--------------|------------|-----------------|------------|------|------|
| 1 | `RNCWebViewModule` | `class WebViewTurboModule extends AnyThreadTurboModule implements TM.RNCWebViewModule.Spec` | ✅ | generated Codegen | ✅ 已实现 | 0 |
| 2 | `BleManagerModule` | `class BleTurboModule extends TurboModule` | ❌ | — | ❌ 未实现 | -8 |
```

---

### 3.2 检查点：返回值

#### 检查项概要

| # | 检查项 | 维度 | 对比对象 | 扣分规则 | 致命度 |
|---|--------|------|----------|----------|--------|
| 1 | 返回值类型 | ①契约一致性 | ArkTS TurboModule返回值 vs JS Spec期望返回值 | 返回值类型错误→-10分/个 | 致命 |
| 2 | 返回值语义 | ①契约一致性 | ArkTS TurboModule返回内容 vs JS Spec接口语义 | 语义不匹配→视严重度扣分 | 严重/中等 |
| 3 | Promise处理 | ①契约一致性 | ArkTS TurboModule异步方法返回值 vs JS Spec异步声明 | Promise未正确包裹→-8分/个 | 严重 |
| 4 | 常量导出完整性 | ①契约一致性 | ArkTS TurboModule getConstants() vs Android/iOS getConstants() | 失常量→-5分/个 | 中等 |
| 5 | 常量值一致性 | ①契约一致性 | 各平台导出的常量值 | 值不一致→-3分/个 | 轻微 |
| 6 | 返回值vs Android/iOS | ②平台实现差异 | ArkTS TurboModule方法返回值 vs Android/iOS方法返回值 | 合并至①检查 | — |
| — | ③架构桥接一致性 | — | 已由①覆盖 | — | — |

#### ①契约一致性

##### 检查项1：返回值类型

- **检查项**: 返回值类型
- **特征检索方式**: 在 `*TurboModule.ets` 中读取每个方法的返回值类型标注；在 JS Spec 中读取对应方法的期望返回值类型
- **检视步骤**:
  1. 从 `*TurboModule.ets` 逐方法读取返回值类型标注→映射R_arkts
  2. 从 JS Spec 逐方法读取期望返回值类型→映射R_js
  3. 对每个共有方法，对比 R_arkts[method] vs R_js[method]
  4. 判定规则：类型完全匹配或为合理跨平台映射→通过；返回值类型错误→标注并扣分
- **扣分规则**: 返回值类型错误→致命-10分/个
- **输出格式**:

```markdown
| # | 方法名 | JS Spec期望返回值类型 | ArkTS TurboModule返回值类型 | 类型一致性 | 扣分 |
|---|--------|--------------------|--------------------------|-----------|------|
| 1 | `isFileUploadSupported` | `Promise<boolean>` | `Promise<boolean>` | ✅ | 0 |
| 2 | `connect` | `void` | `Promise<void>` | ❌（多包裹Promise） | -10 |
```

##### 检查项2：返回值语义

- **检查项**: 返回值语义
- **特征检索方式**: 在 `*TurboModule.ets` 中读取每个方法的方法体，验证返回值的语义正确性；在 JS Spec 中读取接口语义描述
- **检视步骤**:
  1. 读取 `*TurboModule.ets` 中每个方法的方法体，分析返回内容是否符合接口语义
  2. 读取 JS Spec 中对应方法的语义描述（方法名、注释、类型语义）
  3. 对比 ArkTS 实际返回值语义是否与 JS Spec 接口语义一致
  4. 判定规则：语义一致→通过；语义不匹配→视严重度扣分
- **扣分规则**: 语义严重不匹配→严重扣分；轻微语义偏差→中等扣分
- **输出格式**:

```markdown
| # | 方法名 | JS Spec接口语义 | ArkTS TurboModule返回语义 | 语义一致性 | 扣分 |
|---|--------|---------------|--------------------------|-----------|------|
| 1 | `isFileUploadSupported` | 返回当前设备是否支持文件上传 | 固定返回true（语义：始终支持） | ✅ | 0 |
| 2 | `getOpenPeripherals` | 返回已连接的外围设备列表 | 返回空数组[]（语义：无设备） | ❌ | -5 |
```

##### 检查项3：Promise处理

- **检查项**: Promise处理
- **特征检索方式**: 在 JS Spec 中 grep `Promise<` 或标注为异步的方法；在 `*TurboModule.ets` 中 grep `Promise<` 或 `async` 关键字
- **检视步骤**:
  1. 从 `*TurboModule.ets` 检查每个方法是否返回 Promise→映射P_arkts
  2. 从 JS Spec 检查哪些方法声明为异步（返回值类型含 Promise）→映射P_js
  3. 对每个共有方法，对比 P_arkts[method] vs P_js[method]
  4. 验证 ArkTS 异步方法是否正确使用 `Promise.resolve()`/`Promise.reject()` 包裹返回值
  5. 判定规则：JS Spec异步方法在ArkTS也返回Promise且包裹正确→通过；异步未包裹Promise→标注并扣分
- **扣分规则**: Promise未正确包裹→严重-8分/个
- **输出格式**:

```markdown
| # | 方法名 | JS Spec是否异步 | ArkTS TurboModule是否返回Promise | Promise包裹正确性 | 扣分 |
|---|--------|---------------|-------------------------------|-----------------|------|
| 1 | `isFileUploadSupported` | ✅ Promise<boolean> | ✅ Promise.resolve(true) | ✅ | 0 |
| 2 | `readRSSI` | ✅ Promise<number> | ❌ 直接返回number | ❌ | -8 |
```

##### 检查项4：常量导出完整性

- **检查项**: 常量导出完整性
- **特征检索方式**: 在 `*TurboModule.ets` 中 grep `getConstants()` 方法；在 Android Java 中 grep `getConstants()` 方法；在 iOS 中 grep `getConstants()` 或常量导出相关代码
- **检视步骤**:
  1. 从 `*TurboModule.ets` 读取 `getConstants()` 方法，提取所有常量名→列表O
  2. 从 Android Java TurboModule 文件读取 `getConstants()` 方法，提取所有常量名→列表A
  3. 从 iOS TurboModule 文件读取常量导出代码，提取所有常量名→列表I
  4. 对比 O vs A vs I：检查每个常量是否在三平台均有导出
  5. 判定规则：三平台均导出→通过；任一平台失常量→标注并扣分
- **扣分规则**: 失常量→中等-5分/个
- **输出格式**:

```markdown
| # | 常量名 | Android导出 | iOS导出 | ArkTS TurboModule导出 | ArkTS文件:行号 | 完整性 | 扣分 |
|---|--------|-----------|---------|----------------------|---------------|--------|------|
| 1 | `Scale` | ✅ | ✅ | ✅ | `MapsTurboModule.ets:25` | ✅ 三平台一致 | 0 |
| 2 | `ConnectionPriority` | ✅ | ⛔ 无 | ⛔ 无 | — | ⚠️ 仅Android有 | -5 |
```

##### 检查项5：常量值一致性

- **检查项**: 常量值一致性
- **特征检索方式**: 在各平台 TurboModule 文件中读取 `getConstants()` 返回的常量值
- **检视步骤**:
  1. 从各平台 `getConstants()` 方法中提取常量的具体值
  2. 对每个共有常量，对比 Android值 vs iOS值 vs ArkTS TurboModule值
  3. 判定规则：值完全一致→通过；值不一致→标注差异并扣分
- **扣分规则**: 值不一致→轻微-3分/个
- **输出格式**:

```markdown
| # | 常量名 | Android值 | iOS值 | ArkTS TurboModule值 | 值一致性 | 扣分 |
|---|--------|---------|-------|--------------------|---------|------|
| 1 | `Scale` | `0.0001` | `0.0001` | `0.0001` | ✅ | 0 |
| 2 | `Timeout` | `30` | `30` | `60` | ❌ | -3 |
```

#### ②平台实现差异

##### 检查项6：返回值vs Android/iOS

- **检查项**: 返回值vs Android/iOS
- **特征检索方式**: 在 Android/iOS TurboModule 文件中读取方法返回值；在 `*TurboModule.ets` 中读取方法返回值
- **检视步骤**:
  1. 从 `*TurboModule.ets` 提取每个方法的返回值类型和语义
  2. 从 Android/iOS TurboModule 提取对应方法的返回值类型和语义
  3. 对比 ArkTS返回值 vs Android/iOS返回值
  4. 判定规则：差异合并至①契约一致性检查，不独立扣分；Android/iOS返回值差异视为JS Spec返回值对比的补充参考
- **扣分规则**: 差异合并至①检查，不独立扣分
- **输出格式**:

```markdown
| # | 方法名 | ArkTS TurboModule返回值 | Android返回值 | iOS返回值 | 差异 | 合并至①检查项 |
|---|--------|------------------------|-------------|---------|------|-------------|
| 1 | `isFileUploadSupported` | `Promise<boolean>` | `boolean` | `BOOL` | ✅ 功能一致 | — |
```

#### ③架构桥接一致性

> ③架构桥接一致性维度已由①契约一致性检查覆盖（Spec接口实现已在3.1检查点9中完成），此处不再重复。

---

### 3.3 检查点：实现逻辑 ⚠️ 最关键检查项

#### 检查项概要

| # | 检查项 | 维度 | 对比对象 | 扣分规则 | 致命度 |
|---|--------|------|----------|----------|--------|
| 1 | Stub检测与合理性判定 | ②平台实现差异⚠️核心 | ArkTS方法实现 vs Android/iOS同名方法行为 | 致命Stub→-8分/方法；空方法体→-8分/方法；逻辑Stub→-12分/方法；合理Stub→0分 | 致命/严重/0 |
| 2 | 方法行为跨平台对比 | ②平台实现差异⚠️核心 | Android/iOS/OHOS三平台方法行为 | 行为致命不一致→-15分/方法；行为严重不一致→-12分/方法 | 致命/严重 |
| 3 | 边界处理 | ②平台实现差异 | ArkTS方法边界条件 vs Android/iOS边界处理 | 不一致→-8分 | 中等 |
| 4 | 错误处理 | ②平台实现差异 | ArkTS方法错误处理 vs Android/iOS错误处理 | 不一致→-6分 | 中等 |
| 5 | 回调/事件机制 | ③架构桥接一致性 | ArkTS回调触发逻辑 vs Android/iOS回调触发逻辑 | 触发逻辑不一致→-12分/个 | 严重 |
| — | ①契约一致性 | — | 实现逻辑不属于契约维度，N/A | — | — |

#### ①契约一致性

> 实现逻辑不属于契约维度（契约维度仅覆盖签名和返回值声明），①为 N/A。

#### ②平台实现差异 ⚠️ 核心维度：每个方法与Android/iOS行为级对比

##### 检查项1：Stub检测与合理性判定

- **检查项**: Stub检测与合理性判定
- **特征检索方式**: 在 `*TurboModule.ets` 中查找以下Stub模式：(a) `return true;` / `return false;` / `return null;` 等固定返回值；(b) `return Promise.resolve(true)` / `return Promise.resolve(false)` 等固定Promise返回；(c) 方法体仅有 `console.log` 或注释；(d) 方法体为空或仅有 `{}`；(e) 未调用任何 `@ohos` API 或实际业务操作
- **检视步骤**:
  1. 读取 `*TurboModule.ets` 中每个方法的方法体
  2. 识别Stub模式：(a) 方法体仅有return固定值；(b) 未调用@ohos API；(c) 未执行实际业务操作；(d) 仅console.log输出
  3. 读取 Android Java/Kotlin TurboModule 中同名方法的实际实现
  4. 读取 iOS TurboModule 中同名方法的实际实现
  5. 对比：Android/iOS有实际业务逻辑但ArkTS为Stub→致命Stub；iOS也返回固定值→合理Stub
  6. 判定规则：三平台行为一致（均为固定返回）→合理Stub 0分；Android/iOS有实际逻辑但ArkTS为Stub→致命Stub 扣分
- **扣分规则**:
  - 合理固定返回：方法语义本身返回固定值且与Android/iOS一致→0分
  - 无条件Stub：返回固定值但Android/iOS有实际业务逻辑→致命-8分/方法
  - 空方法体Stub：方法体为空或仅有console.log→致命-8分/方法
  - 逻辑Stub：有部分逻辑但缺少核心操作→严重-12分/方法
- **输出格式**:

```markdown
| # | 方法名 | ArkTS文件:行号 | Stub代码片段 | Stub类型 | Android实现 | iOS实现 | Stub合理性 | 缺失逻辑 | 严重度 | 扣分 |
|---|--------|---------------|-------------|---------|------------|--------|-----------|---------|--------|------|
| 1 | `isFileUploadSupported` | `WebViewTurboModule.ets:14` | `return Promise.resolve(true)` | 合理固定返回 | ✅ Android5+返回true | ✅ 始终返回YES | ✅ 三平台一致 | 无 | ⚠️ 合理 | 0 |
| 2 | `removeBond` | `BleTurboModule.ets:278` | `return true;` | 无条件Stub | ✅ 调用BluetoothDevice.removeBond() | ✅ 调用CBCentralManager.remove() | ❌ 缺失实际解绑 | 实际解绑操作 | ❌ 致命 | -8 |
| 3 | `requestPriority` | `BleTurboModule.ets:455` | `// todo: implement` | 空方法体Stub | ✅ 调用gatt.requestConnectionPriority() | ⛔ 不支持 | ❌ 空方法体 | 优先级请求 | ❌ 致命 | -8 |
| 4 | `connect` | `BleTurboModule.ets:89` | 仅更新状态变量未调用蓝牙连接 | 逻辑Stub | ✅ 调用BluetoothGatt.connect() | ✅ 调用CBCentralManager.connect() | ❌ 缺少核心操作 | 蓝牙连接API调用 | ❌ 严重 | -12 |
```

##### 检查项2：方法行为跨平台对比

- **检查项**: 方法行为跨平台对比
- **特征检索方式**: 在 Android/iOS/ArkTS 三平台 TurboModule 文件中读取每个方法的实现摘要
- **检视步骤**:
  1. 对每个TurboModule方法，读取Android实现并提取行为摘要（调用的API、执行的操作、产生的结果）
  2. 读取iOS实现并提取行为摘要
  3. 读取ArkTS TurboModule实现并提取行为摘要
  4. 对比三平台实际行为：核心业务逻辑是否一致、副作用是否一致、结果是否等效
  5. 判定规则：三平台行为一致或功能等效→通过；行为致命不一致→致命扣分；行为严重不一致→严重扣分
- **扣分规则**:
  - 行为致命不一致（核心功能缺失或行为完全不同）→致命-15分/方法
  - 行为严重不一致（部分核心逻辑缺失）→严重-12分/方法
- **输出格式**:

```markdown
| # | 方法名 | Android实现摘要 | iOS实现摘要 | ArkTS实现摘要 | ArkTS文件:行号 | 行为对比状态 | 扣分 |
|---|--------|---------------|------------|--------------|---------------|------------|------|
| 1 | `isFileUploadSupported` | ✅ Android5+返回true | ✅ 始终返回YES | ✅ 始终返回true | `WebViewTurboModule.ets:14` | ✅ 三平台一致 | 0 |
| 2 | `connect` | ✅ 调用BluetoothGatt.connect() | ✅ 调用CBCentralManager.connect() | ✅ 调用@ohos.bluetooth.ble.connect() | `BleTurboModule.ets:89` | ✅ 功能一致 | 0 |
| 3 | `removeBond` | ✅ 调用BluetoothDevice.removeBond() | ✅ 调用CBCentralManager.remove() | ❌ Stub: return true | `BleTurboModule.ets:278` | ❌ 致命不一致 | -15 |
```

##### 检查项3：边界处理

- **检查项**: 边界处理
- **特征检索方式**: 在 `*TurboModule.ets` 中查找边界条件处理代码（null/undefined检查、空数组检查、越界检查等）；在 Android/iOS TurboModule 中查找同名方法的边界条件处理
- **检视步骤**:
  1. 从 `*TurboModule.ets` 读取每个方法的边界条件处理（null检查、空值检查、参数校验等）
  2. 从 Android/iOS TurboModule 读取同名方法的边界条件处理
  3. 对比 ArkTS边界处理 vs Android/iOS边界处理
  4. 判定规则：边界处理一致或ArkTS有更严格的处理→通过；不一致→标注并扣分
- **扣分规则**: 不一致→中等-8分
- **输出格式**:

```markdown
| # | 方法名 | Android/iOS边界处理 | ArkTS TurboModule边界处理 | 一致性 | 扣分 |
|---|--------|-------------------|-------------------------|--------|------|
| 1 | `connect` | ✅ 检查id非null | ✅ 检查id非null和非空字符串 | ✅ ArkTS更严格 | 0 |
| 2 | `startScan` | ✅ 检查filter非null | ❌ 无边界检查 | ❌ | -8 |
```

##### 检查项4：错误处理

- **检查项**: 错误处理
- **特征检索方式**: 在 `*TurboModule.ets` 中查找 try-catch 块、error回调、Promise.reject 等错误处理模式；在 Android/iOS TurboModule 中查找同名方法的错误处理
- **检视步骤**:
  1. 从 `*TurboModule.ets` 读取每个方法的错误处理（try-catch、error callback、Promise.reject等）
  2. 从 Android/iOS TurboModule 读取同名方法的错误处理
  3. 对比 ArkTS错误处理 vs Android/iOS错误处理
  4. 判定规则：错误处理一致或ArkTS有合理的错误处理→通过；不一致→标注并扣分
- **扣分规则**: 不一致→中等-6分
- **输出格式**:

```markdown
| # | 方法名 | Android/iOS错误处理 | ArkTS TurboModule错误处理 | 一致性 | 扣分 |
|---|--------|-------------------|-------------------------|--------|------|
| 1 | `connect` | ✅ try-catch + Promise.reject | ✅ try-catch + Promise.reject | ✅ | 0 |
| 2 | `readRSSI` | ✅ try-catch + 回调error参数 | ❌ 无错误处理 | ❌ | -6 |
```

#### ③架构桥接一致性

##### 检查项5：回调/事件机制

- **检查项**: 回调/事件机制
- **特征检索方式**: 在 `*TurboModule.ets` 中 grep 回调调用模式（`this.emitDeviceEvent`、`sendEvent`、回调函数调用）；在 Android/iOS TurboModule 中 grep 同名回调触发模式（Android: `sendEvent`/回调接口；iOS: `RCTEventEmitter`/block回调）
- **检视步骤**:
  1. 从 `*TurboModule.ets` 读取每个回调方法的触发逻辑（触发时机、触发方式、回调参数）
  2. 从 Android TurboModule 读取同名回调/事件的触发逻辑
  3. 从 iOS TurboModule 读取同名回调/事件的触发逻辑
  4. 对比 ArkTS回调触发逻辑 vs Android/iOS回调触发逻辑
  5. 判定规则：触发时机、触发方式、回调参数三平台一致→通过；触发逻辑不一致→标注并扣分
- **扣分规则**: 触发逻辑不一致→严重-12分/个
- **输出格式**:

```markdown
| # | 回调/事件名 | JS Spec定义 | Android触发逻辑 | iOS触发逻辑 | ArkTS TurboModule触发逻辑 | ArkTS文件:行号 | 触发逻辑一致性 | 扣分 |
|---|------------|-------------|---------------|------------|-------------------------|---------------|--------------|------|
| 1 | `shouldStartLoadWithLockIdentifier` | `(shouldStart: boolean, lockIdentifier: Double): void` | ✅ AtomicReference + notify | ✅ DecisionManager setResult | ✅ ShouldStartParams + lockState | `WebViewTurboModule.ets:18` | ✅ 功能一致 | 0 |
| 2 | `onBluetoothStateChange` | `event: {state: string}` | ✅ sendEvent("onBluetoothStateChange", {state}) | ✅ RCTEventEmitter | ⛔ 未发送事件 | — | ❌ 事件缺失 | -12 |
```

---

## 4. 方法行为跨平台对比

### 4.1 方法行为对比格式

对每个 TurboModule 方法，必须与 Android/iOS 的同名方法做行为对比：

```markdown
| # | 方法名 | Android 实现摘要 | iOS 实现摘要 | ArkTS TurboModule 实现摘要 | ArkTS 文件:行号 | 行为对比状态 | 扣分 |
|---|--------|----------------|-------------|--------------------------|---------------|------------|------|
| 1 | `isFileUploadSupported` | ✅ Android 5+ 返回 true | ✅ 始终返回 YES | ✅ 始终返回 true | `WebViewTurboModule.ets:14` | ✅ 三平台一致 | 0 |
| 2 | `connect` | ✅ 调用 BluetoothGatt.connect() | ✅ 调用 CBCentralManager.connect() | ✅ 调用 @ohos.bluetooth.ble.connect() | `BleTurboModule.ets:89` | ✅ 功能一致 | 0 |
| 3 | `removeBond` | ✅ 调用 BluetoothDevice.removeBond() | ✅ 调用 CBCentralManager.remove() | ❌ Stub: `return true;` | `BleTurboModule.ets:278` | ❌ 致命不一致 | -8 |
```

### 4.2 行为一致性判定规则

| 行为对比结果 | 判定 | 扣分 |
|-------------|------|------|
| 三平台行为一致 | ✅ 一致 | 0 |
| OHOS 使用不同机制但功能等效 | ✅ 功能一致 | 0 |
| OHOS 仅缺少非核心差异 | ⚠️ 轻微不一致 | -3~-5 |
| OHOS 缺少部分核心逻辑 | ❌ 严重不一致 | -8~-12 |
| OHOS 为 Stub 或方法缺失 | ❌ 致命 | -8~-15 |

---

## 5. 跨层一致性检测（ArkTS TurboModule 视角）

### 5.1 全链路 TurboModule 对比

```markdown
| # | TurboModule 名 | JS Spec 定义 | JS Spec 注册名 | C++ FactoryDelegate 注册名 | C++ JSIBinder | generated Spec 接口 | ArkTS TurboModule 类 | ArkTS 文件 | 状态 | 扣分 |
|---|--------------|------------|--------------|------------------------|-------------|--------------------|--------------------|-----------|------|------|
| 1 | `RNCWebViewModule` | `NativeRNCWebViewModule.ts` | `RNCWebViewModule` | ✅ `RNCWebViewModule` | ✅ JSIBinder | ✅ TM.RNCWebViewModule.Spec | ✅ WebViewTurboModule | `WebViewTurboModule.ets:11` | ✅ 全链路一致 | 0 |
```

### 5.2 断桥类型定义（TurboModule 视角）

| 断桥位置 | 识别方式 | 影响 | 扣分 |
|---------|----------|------|------|
| JS→C++ 注册断桥 | JS Spec TurboModuleRegistry 注册名在 C++ FactoryDelegate 中无对应 if 条件 | JS 调用 TurboModule 但 C++ 无法创建实例 | -10/个（致命） |
| C++→ArkTS 类映射断桥 | C++ FactoryDelegate 中 `std::make_shared<XxxTurboModule>` 类名在 ArkTS 中无对应实现类 | C++ 创建实例但无法路由到 ArkTS 实现 | -8/个（严重） |
| ArkTS 方法缺失断桥 | JS Spec 方法在 ArkTS TurboModule 中无对应方法实现 | JS 调用方法但 ArkTS 不响应 | -15/个（致命） |
| ArkTS Stub 断桥 | ArkTS TurboModule 方法为 Stub 但 Android/iOS 有实际业务逻辑 | 方法调用成功但行为完全不同 | -8/方法（致命） |
| ArkTS 常量缺失断桥 | Android/iOS getConstants() 导出的常量在 ArkTS TurboModule 中缺失 | JS 读取常量返回 undefined | -5/个（中等） |

---

## 6. 检视操作流程

### 6.1 Phase 0 补充步骤（ArkTS TurboModule 定位）

```
TM-ARK-1: 定位 ArkTS TurboModule 实现文件
      → 搜索 harmony/<module>/src/main/ets/*TurboModule.ets

TM-ARK-2: 定位 generated TurboModule Spec 类型
      → 搜索 generated/turboModules/TurboModuleName.ts
      → 搜索 generated/turboModules/ts.ts

TM-ARK-3: 读取 ArkTS TurboModule 类声明
      → 提取 NAME 常量、父类、implements Spec 接口

TM-ARK-4: 读取 generated Spec 接口方法列表
      → 提取所有方法名和签名
```

### 6.2 Phase 3 补充步骤（ArkTS TurboModule 分析）

```
TM-ARK-5: TurboModule NAME 常量对比
      → ArkTS NAME 常量 vs JS Spec TurboModuleRegistry 注册名 vs C++ FactoryDelegate 注册名
      → 标注注册名不一致

TM-ARK-6: 方法实现完整性对比
      → JS Spec 方法名 vs generated Spec 方法名 vs ArkTS TurboModule 方法名
      → 标注方法缺失

TM-ARK-7: 方法签名对比
      → ArkTS TurboModule 方法签名 vs generated Spec 接口方法签名
      → 标注签名不匹配、类型映射错误

TM-ARK-8: Stub 检测与合理性判定
      → 对每个 ArkTS TurboModule 方法判断是否为 Stub
      → 与 Android/iOS 同名方法行为对比判定 Stub 合理性
      → 标注 Stub 方法及其缺失逻辑

TM-ARK-9: 常量导出对比
      → Android/iOS getConstants() vs ArkTS TurboModule getConstants()
      → 标注失常量

TM-ARK-10: 回调/事件对比
      → ArkTS TurboModule 回调/事件实现 vs Android/iOS 回调/事件
      → 标注回调缺失、事件缺失、Payload 缺失

TM-ARK-11: 方法行为跨平台对比
      → 对每个方法列出 Android/iOS/OHOS 三平台行为
      → 标注行为不一致
```

---

## 7. 报告输出格式

在一致性检视报告的"5.8 RN 架构一致性检视"中增加以下子章节：

```markdown
#### ArkTS TurboModule 层一致性（如适用）

**ArkTS TurboModule 模式**：{Codegen（implements TM.Xxx.Spec）/ Legacy（手写） / ⚠️ 无 ArkTS TurboModule 层}

**TurboModule 类声明一致性**：

| # | TurboModule 名 | ArkTS 类名 | NAME 常量 | JS Spec 注册名 | C++ FactoryDelegate | implements Spec? | 状态 | 扣分 |
|---|--------------|-----------|----------|--------------|--------------------|----------------|------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**TurboModule 方法级对比**：

| # | 方法名 | JS Spec 签名 | generated Spec 签名 | ArkTS TurboModule 签名 | ArkTS 文件:行号 | 实现状态 | 扣分 |
|---|--------|-------------|--------------------|----------------------|---------------|----------|------|
| ... | ... | ... | ... | ... | ... | ... | ... |

**TurboModule Stub 检测**：

| # | 方法名 | ArkTS 文件:行号 | Stub 代码 | Android 实现 | iOS 实现 | Stub 合理性 | 缺失逻辑 | 严重度 | 扣分 |
|---|--------|---------------|----------|-------------|---------|------------|---------|--------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

**TurboModule 常量导出对比**：

| # | 常量名 | Android getConstants() | iOS getConstants() | ArkTS TurboModule getConstants() | ArkTS 文件:行号 | 值一致性 | 状态 | 扣分 |
|---|--------|----------------------|--------------------|--------------------------------|---------------|---------|------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**TurboModule 回调/事件对比**：

| # | 回调/事件名 | JS Spec 定义 | Android 实现 | iOS 实现 | ArkTS TurboModule 实现 | ArkTS 文件:行号 | 行为一致性 | 扣分 |
|---|------------|-------------|-------------|---------|----------------------|---------------|-----------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**TurboModule 方法行为跨平台对比**：

| # | 方法名 | Android 实现摘要 | iOS 实现摘要 | ArkTS 实现摘要 | ArkTS 文件:行号 | 行为对比状态 | 扣分 |
|---|--------|----------------|-------------|--------------|---------------|------------|------|
| ... | ... | ... | ... | ... | ... | ... | ... |
```

---

## 8. 与 CPP_TURBOMODULE_CHECK_GUIDE 的协同

本指南与 CPP_TURBOMODULE_CHECK_GUIDE 共享"TurboModule 全链路对比表"。检视执行顺序建议：

1. **先执行 CPP_TURBOMODULE_CHECK_GUIDE** → 获得 C++ FactoryDelegate 注册名、JSIBinder 方法列表
2. **再执行 ARKTS_TURBOMODULE_CHECK_GUIDE** → 获得 ArkTS TurboModule 类声明、方法实现、Stub 检测、常量导出、回调/事件数据
3. **合并两张表** → 生成完整 TurboModule 全链路一致性分析

若两个指南独立执行，各自的全链路表可能存在重叠列。合并时以 TurboModule 名为主键，将两表的列拼接为完整链路。
