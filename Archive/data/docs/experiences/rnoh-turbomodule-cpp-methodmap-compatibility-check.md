## RNOH TurboModule C++/ArkTS methodMap_ 兼容性预检方法

### 问题现象
升级 RNOH 框架版本时（如 0.82→0.84），上游三方库可能引入新的 TurboModule Spec 文件（如 `NativeRNCNetInfo.ts`）和 `__turboModuleProxy` 加载逻辑。需要判断鸿蒙侧 C++ methodMap_ 和 ArkTS TurboModule 是否需要对应修改，还是仅需通过 npm 依赖升级自动同步。

### 解决方案
在执行代码适配前，先对比上游 TurboModule Spec 中定义的方法签名与鸿蒙侧 C++ methodMap_ 和 ArkTS TurboModule 实现的方法列表：

1. 读取上游 Spec 文件（`*Native*.ts`），提取所有方法签名
2. 读取鸿蒙侧 C++ 代码中的 `methodMap_` 数组，提取已注册的方法名
3. 读取鸿蒙侧 ArkTS TurboModule 实现，提取方法列表
4. 对比三者的方法名和参数签名

**判断规则**：
- 如果上游 Spec 定义的方法与鸿蒙侧 C++ methodMap_ 和 ArkTS 实现完全匹配 → **无需任何 C++/ArkTS 代码修改**，仅需通过 npm 依赖升级自动同步 JS 层变更
- 如果上游新增方法 → 需在鸿蒙侧 C++ 和 ArkTS 中新增对应实现
- 如果上游删除/重命名方法 → 需清理鸿蒙侧旧实现

### 结果
以 rntpc_react-native-netinfo 0.82→0.84 升级为例：上游 v11.4.1→v12.0.1 引入了 `NativeRNCNetInfo.ts` Spec，定义了 4 个方法（configure/getCurrentState/addListener/removeListeners）。鸿蒙侧 C++ methodMap_ 和 ArkTS TurboModule 已包含完全相同的 4 个方法，因此无需任何 C++/ArkTS 代码修改，仅通过 npm 依赖升级即自动同步 JS 层变更。此预检可大幅减少不必要的工作量。