# 一致性检视报告输出模板

本模板定义 RN 鸿蒙化一致性检视报告的完整输出格式。检视报告必须严格遵循此格式，确保 `_parseRNLibraryScore` 函数能正确解析评分。

> 📖 **引用来源**：SKILL.md Phase 7 输出格式规范节的详细内容。

> ⚠️ **扣分维度标注规则**：所有检视表格的扣分列，必须在分数后标注维度编号，格式为 **`-X（维度N）`**。详见 [SCORING_STANDARD.md](references/SCORING_STANDARD.md) 第 7 节。

> ⚠️ **评分格式要求**：必须包含 `**综合评分：XX/100**`（粗体标记，中文冒号）。

---

## 报告结构

```markdown
# {repoName} 一致性检视报告

## 一、检视概览

| 字段 | 内容 |
|------|------|
| **仓库名称** | {repoName} |
| **检视类型** | RN 鸿蒙化实现一致性检视 |
| **检视时间** | {timestamp} |
| **对比平台** | Android / iOS / OHOS |
| **分析方法数** | {methodCount} |
| **致命问题数** | {criticalCount} |
| **严重问题数** | {majorCount} |

## 二、综合评分

**综合评分：{score}/100**

评分等级：{grade}

> 评分说明：采用严苛扣分制，从 100 分开始扣减，最低 0 分。致命/严重/中等/轻微问题独立扣分计算。

## 三、各维度评分明细

| 维度编号 | 检视维度 | 权重 | 扣分 | 维度得分 | 致命数 | 严重数 | 中等数 | 轻微数 |
|----------|----------|------|------|----------|--------|--------|--------|--------|
| 维度1 | API 契约一致性 | 35% | {api扣分} | {api得分} | {c1} | {m1} | {n1} | {l1} |
| 维度2 | 平台实现一致性 | 30% | {platform扣分} | {platform得分} | {c2} | {m2} | {n2} | {l2} |
| 维度3 | RN 架构一致性 | 20% | {arch扣分} | {arch得分} | {c3} | {m3} | {n3} | {l3} |
| 维度4 | 平台适配合理性 | 15% | {adapt扣分} | {adapt得分} | {c4} | {m4} | {n4} | {l4} |

**扣分明细**（按四类型分组，表格形式，每项标注维度编号）：

| # | 类型 | 检查点 | 方法名/属性名 | 问题描述 | 文件:行号 | 严重度 | 维度 | 扣分 |
|---|------|--------|-------------|---------|----------|--------|------|------|
| 1 | arktsTM | 实现逻辑 | `startScan` 参数 `force` 类型错误 (boolean→string) | 参数类型致命错误 | `NativeModule.ets:344` | 致命 | 维度1 | -15 |
| 2 | arktsTM | 实现逻辑 | `removeBond` 为 Stub 方法，返回 `true` 未调用 `unpairDevice()` | Stub实现 | `NativeModule.ets:278` | 致命 | 维度2 | -8 |
| 3 | cppComp | Props | `src` Prop JSIBinder→NapiBinder 断桥 | 桥接缺失 | `JSIBinder.h:56` | 中等 | 维度3 | -5 |
| 4 | arktsComp | Props副作用 | `forceDarkOn` 影响 backgroundColor(White/Transparent)，Android无此副作用，无文档说明 | 无文档副作用 | `RNCWebView.ets:547` | 致命 | 维度2 | -15 |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

## 四、检视范围

### 鸿蒙代码智能定位结果

| 搜索方法 | 类型 | 定位结果 | 文件数 | 状态 |
|----------|------|----------|--------|------|
| `codegenNativeComponent` | arktsComp/cppComp | JS 层组件注册文件 | X | ✅/⚠️ 无 |
| `TurboModuleRegistry.getEnforcing` | arktsTM/cppTM | JS 层 TurboModule Spec 文件 | X | ✅/⚠️ 无 |
| `*Package extends RNOHPackage` | — | ArkTS Package 注册文件 | X | ✅/⚠️ 无 |
| C++ Package | cppComp | `harmony/<module>/src/main/cpp/*Package.h` | X | ✅/⚠️ 无 |
| C++ JSIBinder | cppComp | `generated/*JSIBinder.h` | X | ✅/⚠️ 无 |
| C++ NapiBinder | cppComp | `generated/*NapiBinder.h` | X | ✅/⚠️ 无 NapiBinder |
| C++ EventEmitRequestHandler | cppComp | `*Package.h` 中 `supportedEventNames` | X | ✅/⚠️ 无 |
| C++ TurboModule FactoryDelegate | cppTM | `generated/turbo_modules/*` | X | ✅/⚠️ 无 |
| C++ TurboModule JSIBinder | cppTM | `turbo_modules/*JSIBinder.h` | X | ✅/⚠️ 无 |
| @Component struct | arktsComp | 组件实现文件 | X | ✅/⚠️ 无 |
| generated Props 类型 | arktsComp | `generated/*EtsProps.ts` | X | ✅/⚠️ 无 |
| generated Commands Payload | arktsComp | `generated/*EtsCommandPayload.ts` | X | ✅/⚠️ 无 |
| generated EventEmitRequestHandler | arktsComp | `generated/*EtsEventEmitRequestHandler.ts` | X | ✅/⚠️ 无 |
| ArkTS TurboModule 实现文件 | arktsTM | `harmony/<module>/src/main/ets/*TurboModule.ets` | X | ✅/⚠️ 无 |
| generated TurboModule Spec 类型 | arktsTM | `generated/turboModules/*.ts` | X | ✅/⚠️ 无 |

### 四类型原生实体注册链路

| 原生实体名 | 类型 | JS 层注册文件:行号 | 桥接层文件:行号 | 原生实现文件:行号 |
|------------|------|-------------------|---------------|-------------------|
| {组件名} | cppComp | {JS文件}:{行号} | {JSIBinder}:{行号}; {NapiBinder}:{行号} | {Package.h}:{行号} |
| {TurboModule名} | cppTM | {JS Spec}:{行号} | {JSIBinder}:{行号}; {FactoryDelegate}:{行号} | {FactoryDelegate.h}:{行号} |
| {组件名} | arktsComp | {JS文件}:{行号} | {EtsProps}:{行号}; {EtsCommandPayload}:{行号} | {Component.ets}:{行号} |
| {TurboModule名} | arktsTM | {JS Spec}:{行号} | {TM Spec.ts}:{行号} | {TurboModule.ets}:{行号} |

> 若库不含某类型实体，在表中标注"⚠️ 无该类型"即可。

### 对比参考定位

| 平台 | 目录 | 文件数 | 状态 |
|------|--------|--------|------|
| Android | `source/RN/android/` | X | ✅ |
| iOS | `source/RN/ios/` | X | ✅ |
| JS 接口 | `source/RN/src/` | - | ⚠️ 仅接口定义 |

## 五、详细检视结果（按四类型分类）

#### cppComp 检视结果（C++ 组件层，如适用）

> 📖 详见 [CPP_COMPONENT_CHECK_GUIDE.md](references/CPP_COMPONENT_CHECK_GUIDE.md) 第 6 节输出格式。

**C++ Package 模式**：{Thin Wrapper / Hand-Written / ⚠️ 无 cppComp}

**1. Props 检视**：

| # | Prop 名 | 上游 NativeProps | C++ JSIBinder | C++ NapiBinder | OHOS DirectRawProps | ArkTS rawProps 使用 | 断桥位置 | 扣分 |
|---|---------|----------------|--------------|---------------|--------------------|-------------------|---------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**1a. Props 副作用&关联影响分析**（仅 C++ 渲染模式；桥接转发模式标注"⛔ 由arktsComp覆盖"）：

| # | 渲染模式 | Prop 名 | 主映射行为 | 副作用/关联影响 | Android/iOS 是否有同副作用 | 文档说明 | 文档合理性 | 致命度 | 扣分 |
|---|---------|---------|-----------|-------------|--------------------------|---------|-----------|--------|------|
| （桥接转发）| ⛔ 桥接转发 | — | — | — | — | — | — | — | 0 |
| （C++渲染）| ✅ C++渲染 | `propA` | ... | ... | ❌ | ❌ 无文档 | — | 致命 | -15（维度2） |
| （C++渲染）| ✅ C++渲染 | `propB` | ... | ... | ❌ | ✅ 有文档且合理 | ✅ | 轻微 | -3（维度4） |

**2. Command 检视**：

| # | Command 名 | 上游 JS Spec | C++ Command handler | C++ 实现逻辑 | Android/iOS 实现 | 实现逻辑一致性 | 扣分 |
|---|-----------|-------------|--------------------|-------------|----------------|---------------|------|
| ... | ... | ... | ... | ... | ... | ... | ... |

**3. Methods 检视**（Package 注册等）：

| # | 检查项 | 上游实现 | OHOS C++ 实现 | 状态 | 扣分 |
|---|--------|---------|-------------|------|------|
| 1 | 组件注册完整性 | ... | ... | ... | ... |
| 2 | JSIBinder 映射完整性 | ... | ... | ... | ... |

**4. Callback 检视**（EventEmitRequestHandler）：

| # | 事件名 | 上游 JS onXxx | C++ supportedEventNames | C++→JS 映射 | 回调触发时机 vs Android/iOS | 扣分 |
|---|--------|-------------|-------------------------|------------|---------------------------|------|
| ... | ... | ... | ... | ... | ... | ... |

**5. Lifecycle 检视**（C++ 组件构造/析构）：

| # | 生命周期 | Android/iOS 实现 | OHOS C++ 实现 | 一致性 | 扣分 |
|---|---------|----------------|-------------|--------|------|
| ... | ... | ... | ... | ... | ... |

#### cppTM 检视结果（C++ TurboModule 层，如适用）

> 📖 详见 [CPP_TURBOMODULE_CHECK_GUIDE.md](references/CPP_TURBOMODULE_CHECK_GUIDE.md) 第 7 节输出格式。

**C++ TurboModule 模式**：{Codegen / Legacy / ⚠️ 无 cppTM}

**1. 函数签名检视**：

| # | TurboModule 名 | JS Spec 注册名 | C++ FactoryDelegate | C++ JSIBinder 方法 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------------|--------------|--------------------|-----------------|-------------|------|------|
| ... | ... | ... | ... | ... | ... | ... | ... |

**TurboModule JSIBinder 方法级对比**：

| # | 方法名 | JS Spec 签名 | C++ JSIBinder 签名 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|-------------------|-------------|------|------|
| ... | ... | ... | ... | ... | ... | ... |

**2. 返回值检视**：

| # | 方法名 | JS Spec 期望返回 | C++ TurboModule 返回 | C++ 文件:行号 | 状态 | 扣分 |
|---|--------|----------------|--------------------|-------------|------|------|
| ... | ... | ... | ... | ... | ... | ... |

**3. 实现逻辑检视**（C++→ArkTS 映射）：

| # | TurboModule 名 | C++ FactoryDelegate 类名 | ArkTS TurboModule 类名 | 映射状态 | 扣分 |
|---|--------------|--------------------|--------------------|--------|------|
| ... | ... | ... | ... | ... | ... |

#### arktsComp 检视结果（ArkTS @Component 层，如适用）

> 📖 详见 [ARKTS_COMPONENT_CHECK_GUIDE.md](references/ARKTS_COMPONENT_CHECK_GUIDE.md) 第 7 节输出格式。

**ArkTS 组件模式**：{Codegen DirectRawProps / Legacy 手动读取 / ⚠️ 无 arktsComp}

**1. Props 检视**：

| # | Prop 名 | OHOS generated 类型 | ArkTS rawProps 读取 | as-类型断言 | build() 传递给原生组件 | 上游 Android/iOS Prop 处理 | 实现逻辑一致性 | 断桥位置 | 扣分 |
|---|---------|--------------------|-------------------|------------|--------------------|------------------------|---------------|---------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

**1a. Props 副作用&关联影响分析**：

| # | Prop 名 | 主映射原生属性 | 副作用/关联影响原生属性 | Android/iOS 是否有同副作用 | 文档说明 | 文档合理性 | 致命度 | 扣分 |
|---|---------|-------------|-------------------|--------------------------|---------|-----------|--------|------|
| 1 | `forceDarkOn` | .darkMode() | .backgroundColor(White/Transparent条件) | ❌ Android始终Transparent | ❌ 无文档 | — | 致命 | -15（维度2） |
| 2 | `propX` | ... | ... | ✅ | — | — | — | 0 |
| 3 | `propY` | ... | ... | ❌ | ✅ 有文档且合理 | ✅ | 轻微 | -3（维度4） |

**1b. build() 非 rawProps 属性跨平台默认值对比**：

| # | 原生属性 | OHOS build() 值 | 值来源类型 | Android 默认值 | iOS 默认值 | 一致性 | 文档说明 | 影响范围 | 扣分 |
|---|---------|----------------|-----------|-------------|-----------|--------|---------|---------|------|
| 1 | backgroundColor | getColorMode===On ? White : Transparent | 条件计算 | TRANSPARENT | clearColor | ❌ | ❌ 无文档 | 核心行为 | -12（维度2） |
| 2 | propX | ... | ... | ... | ... | ❌ | ✅ 有文档且合理 | 次要 | -3（维度4） |

**2. Command 检视**：

| # | Command 名 | 上游 JS Spec | ArkTS Command handler | ArkTS 实现逻辑 | 上游 Android/iOS Command 实现 | 实现逻辑一致性 | fall-through | 扣分 |
|---|-----------|-------------|--------------------|--------------|------------------------|---------------|-------------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**3. Methods 检视**（组件注册等）：

| # | 检查项 | 上游实现 | OHOS ArkTS 实现 | 状态 | 扣分 |
|---|--------|---------|---------------|------|------|
| 1 | 组件名注册一致性 | ... | ... | ... | ... |

**4. Callback 检视**（Events emit）：

| # | 事件名 | 上游 JS onXxx | C++ Handler | ArkTS emitEvent | ArkTS Payload | 上游 nativeEvent | 回调触发时机 vs Android/iOS | 扣分 |
|---|--------|-------------|------------|----------------|--------------|----------------|---------------------------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**5. Lifecycle 检视**（aboutToAppear/aboutToDisappear）：

| # | 生命周期 | Android/iOS 实现 | OHOS ArkTS 实现 | 一致性 | 扣分 |
|---|---------|----------------|---------------|--------|------|
| ... | ... | ... | ... | ... | ... |

#### arktsTM 检视结果（ArkTS TurboModule 层，如适用）

> 📖 详见 [ARKTS_TURBOMODULE_CHECK_GUIDE.md](references/ARKTS_TURBOMODULE_CHECK_GUIDE.md) 第 7 节输出格式。

**ArkTS TurboModule 模式**：{Codegen（implements TM.Xxx.Spec）/ Legacy（手写）/ ⚠️ 无 arktsTM}

**1. 函数签名检视**：

| # | TurboModule 名 | ArkTS 类名 | NAME 常量 | JS Spec 注册名 | C++ FactoryDelegate | implements Spec? | 状态 | 扣分 |
|---|--------------|-----------|----------|--------------|--------------------|----------------|------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**方法级签名对比**：

| # | 方法名 | JS Spec 签名 | generated Spec 签名 | ArkTS TurboModule 签名 | ArkTS 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|--------------------|----------------------|---------------|------|------|
| ... | ... | ... | ... | ... | ... | ... | ... |

**2. 返回值检视**：

| # | 方法名 | JS Spec 期望返回 | ArkTS TurboModule 返回 | ArkTS 文件:行号 | 状态 | 扣分 |
|---|--------|----------------|----------------------|---------------|------|------|
| ... | ... | ... | ... | ... | ... | ... |

**常量导出对比**：

| # | 常量名 | Android getConstants() | iOS getConstants() | ArkTS TurboModule getConstants() | ArkTS 文件:行号 | 值一致性 | 状态 | 扣分 |
|---|--------|----------------------|--------------------|--------------------------------|---------------|---------|------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**3. 实现逻辑检视**：

**Stub 检测**：

| # | 方法名 | ArkTS 文件:行号 | Stub 代码 | Android 实现 | iOS 实现 | Stub 合理性 | 缺失逻辑 | 严重度 | 扣分 |
|---|--------|---------------|----------|-------------|---------|------------|---------|--------|------|
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

**方法行为跨平台对比**：

| # | 方法名 | Android 实现摘要 | iOS 实现摘要 | ArkTS 实现摘要 | ArkTS 文件:行号 | 行为对比状态 | 扣分 |
|---|--------|----------------|-------------|--------------|---------------|------------|------|
| ... | ... | ... | ... | ... | ... | ... | ... |

#### NAPI/C++ 桥接一致性（如适用，适用于含 C++ Native 层但非 RN 新架构的库）

| # | 检查项 | 原库 C++ 实现 | OHOS NAPI 实现 | 状态 | 扣分 |
|---|--------|-------------|---------------|------|------|
| ... | ... | ... | ... | ... | ... |

#### NativeModule 架构一致性（如适用，适用于旧架构库）

| # | 检查项 | Android/iOS 实现 | OHOS 实现 | 状态 | 扣分 |
|---|--------|-----------------|----------|------|------|
| ... | ... | ... | ... | ... | ... |

## 六、平台差异记录

| # | 差异项 | Android/iOS 实现 | OHOS 实现 | 合理性判定 | 说明 |
|---|--------|-----------------|----------|-----------|------|
| 1 | `requestPriority` | ✅ 调用 `gatt.requestConnectionPriority()` | ⛔ 不支持 | 🔶 合理差异 | 鸿蒙蓝牙 API 无对应接口 |

---

**报告生成时间**：{timestamp}
```

> **重要**：报告必须包含 `**综合评分：XX/100**` 格式，且评分值位于"二、综合评分"章节，确保可被 `_parseRNLibraryScore` 函数正确解析。
