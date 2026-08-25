# Flutter 代码检视清单

本文档包含 Flutter 三方库 PR 代码检视的完整检查项。

---

## 1. 非兼容变更（Breaking Changes）

- [ ] 是否删除或重命名了公开 Plugin API / MethodChannel 方法名
- [ ] 是否修改了 Dart 侧 `MethodChannel.invokeMethod` 的方法名或参数结构
- [ ] 是否修改了 `result.success()` 的返回数据格式（影响 Dart 侧解析）
- [ ] 是否修改了 `oh-package.json5` 中影响依赖解析的字段

---

## 2. Flutter Plugin 协议合规性（ohos/ ArkTS 实现）

- [ ] Plugin 入口类是否继承并正确实现了 `FlutterPlugin` 接口
- [ ] `onAttachedToEngine(binding: FlutterPluginBinding)` 中完成了 Channel 注册和资源初始化
- [ ] `onDetachedFromEngine(binding: FlutterPluginBinding)` 中释放了所有 Channel 和监听器
- [ ] `MethodCallHandler.onMethodCall` 覆盖了所有 Dart 侧声明的方法
- [ ] `onMethodCall` 含 `else` 分支调用 `result.notImplemented()`
- [ ] `result.success()` / `result.error()` / `result.notImplemented()` 调用后有 `return`，防止重复回调
- [ ] EventChannel（如有）的 `StreamHandler.onListen` / `onCancel` 对称实现

---

## 3. ArkTS 语言约束

- [ ] 无 `any` 类型使用（禁止 `as any`、隐式 any）
- [ ] 无 `eval()`、`Function()` 动态代码执行
- [ ] 无 `prototype` 动态修改
- [ ] 装饰器使用正确（`@Component`、`@State`、`@Observed` 等）
- [ ] 是否使用已废弃的 OHOS API（`@deprecated` 标注的接口）
- [ ] 泛型类型参数明确，避免推导歧义

---

## 4. OpenHarmony API 兼容性

- [ ] 新增 API 使用是否超出工程 `minAPIVersion`
- [ ] 是否使用了 OHOS 专有 API 但未做平台判断
- [ ] 权限申请是否正确（`requestPermissionsFromUser`）
- [ ] `OH_*` C API 的返回值是否有检查（Native 模块场景）

---

## 5. 异步处理

- [ ] 所有异步 OHOS API 调用均有 `await` 或 `.then()` 处理
- [ ] `try/catch` 覆盖所有 `await` 调用，catch 块有实质性错误处理
- [ ] 未处理的 Promise rejection（`.catch()` 或 `try/catch` 必须存在）
- [ ] 大量数据处理是否使用 Worker/TaskPool 而非主线程执行
- [ ] 并行异步操作使用 `Promise.all`，避免不必要的顺序 await

---

## 6. 事件监听器管理（on/off 对称性）

- [ ] 每个 `on('eventName', handler)` 有对应 `off('eventName', handler)`
- [ ] 监听器在 `onDetachedFromEngine` 或设备销毁时被移除
- [ ] 重连场景中同一事件多次调用 `on` 不会造成监听器堆积
- [ ] EventChannel 的 `onCancel` 中清理了所有底层事件订阅

---

## 7. C++ Native 实现

- [ ] NAPI 导出函数命名与 ArkTS 侧调用一致
- [ ] `napi_create_*` 创建的对象在不需要时正确释放
- [ ] `napi_ref` 在不需要时调用 `napi_delete_reference`
- [ ] 跨线程回调使用 `napi_threadsafe_function` 或 `uv_async_send`
- [ ] 共享数据结构有互斥锁保护
- [ ] C++ 异常捕获并转为 NAPI 错误
- [ ] `malloc`/`new` 有对应 `free`/`delete`

---

## 8. 错误处理

- [ ] `result.error()` 调用后有 `return`，避免后续代码继续执行
- [ ] 错误信息包含错误码（`e.code`）和错误描述（`e.message`）
- [ ] switch-case 中每个 case 末尾有 `break`（避免 fall-through）
- [ ] 提前 `return` 不会跳过必要的资源清理

---

## 9. 内存与资源管理

- [ ] `onDetachedFromEngine` 中清理了 MethodChannel、EventChannel 的 handler
- [ ] 定时器（`setInterval`/`setTimeout`）有对应 `clearInterval`/`clearTimeout`
- [ ] `ArrayBuffer` / `Uint8Array` 大数据用完后无强引用持有
- [ ] Map / Set 数据结构在不再需要时及时 `delete` / `clear`

---

## 10. 跨平台一致性对比（ohos vs android/iOS）

> PR 中仅包含鸿蒙代码提交，需从克隆的仓库中读取 `android/` 和 `ios/` 的已有实现进行对比。

- [ ] ohos `onMethodCall` 的 case 分支与 android `onMethodCall` 完全对应，无缺失方法
- [ ] 同一 MethodChannel 方法名在 ohos 注册与 android 注册一致（Dart 侧共用同一 Channel）
- [ ] 同一方法中，ohos 解析 `call.argument` 的类型与 android 一致（如 `bool` vs `string` 的致命错误）
- [ ] `result.success()` 返回值的数据结构与 android 对齐（字段名、类型、嵌套层级）
- [ ] `result.error()` 的 code 和 message 与 android 对齐，确保 Dart 侧异常处理逻辑一致
- [ ] android 有实现但 ohos 为 Stub（返回固定值无实际操作）的方法已标记并记录
- [ ] EventChannel（如有）的事件名和事件数据格式与 android 一致
- [ ] 新增的 ohos 方法在 android 中是否也存在对应实现，避免鸿蒙侧单方面新增

---

## 11. Dart 接口层（lib/ 目录）

> **核心原则**：鸿蒙适配 PR 中 Dart 代码不应修改。以下检查项用于验证现有 Dart 代码的正确性，若发现 PR 修改了 Dart 代码，必须转入第 15 节进行必要性审查。

- [ ] Platform Interface 方法签名与鸿蒙侧 `onMethodCall` 实现一致
- [ ] 是否有鸿蒙平台判断：`Platform.isOHOS` 或 `defaultTargetPlatform == TargetPlatform.ohos`
- [ ] 公共 API 有完整的文档注释（Dart doc）
- [ ] 异步方法返回 `Future<T>`，同步方法有明确说明
- [ ] Dart 侧 `MethodChannel` 注册名与 ohos 侧注册名一致
- [ ] Dart 侧 `invokeMethod` 调用的方法名在 ohos `onMethodCall` 中均有对应 case 分支

---

## 12. 安全性

- [ ] 无硬编码的密钥、Token、密码等敏感信息
- [ ] 网络请求是否校验 HTTPS 证书（禁止忽略证书错误）
- [ ] 用户输入是否有校验和过滤（防注入）
- [ ] 文件路径是否有安全校验（防路径穿越）
- [ ] 敏感数据不在日志中输出

---

## 13. 构建配置

- [ ] `oh-package.json5` 新增依赖合理，来源可信，无 `*` 通配版本
- [ ] `CMakeLists.txt` 链接的系统库均为必要依赖
- [ ] `minAPIVersion` / `targetAPIVersion` 变更合理
- [ ] 不存在不必要的依赖或版本锁定过死

---

## 14. 代码规范

- [ ] 命名遵循驼峰规则（变量/方法小驼峰，类/接口大驼峰）
- [ ] 无冗余的 `console.log` 调试代码遗留
- [ ] 公共 API 有完整 JSDoc / Dart doc 注释
- [ ] 文件头版权声明完整

---

## 15. Dart 改动必要性审查（lib/ 目录变更）

> **前提**：鸿蒙适配 PR 的本质是为已有库增加 ohos 平台实现，Dart 代码理论上不应修改。若 PR 包含 `lib/` 目录的变更，必须逐项进行必要性审查。

### 15.1 变更识别

- [ ] 已完整列出 PR 中所有 `lib/**/*.dart` 文件的变更点
- [ ] 已区分每处变更是「新增代码」还是「修改/删除已有代码」
- [ ] 已记录每处变更涉及的文件、行号、变更类型

### 15.2 必要性判定

- [ ] 每处 Dart 变更是否为鸿蒙适配的**唯一实现方式**（无法在 ohos 侧单独完成）
- [ ] 新增 `Platform.isOHOS` / `TargetPlatform.ohos` 条件分支 — ✅ 通常必要
- [ ] 新增 ohos 平台注册逻辑 — ✅ 通常必要
- [ ] 修改 `MethodChannel` 名称 — ❌ 应在 ohos 侧注册相同 Channel 名
- [ ] 修改 `invokeMethod` 的参数结构 — ❌ 应在 ohos 侧适配参数解析
- [ ] 修改 `result` 返回值的解析/类型 — ❌ 应在 ohos 侧返回与 android 相同格式
- [ ] 修改 Platform Interface 方法签名 — ❌ 应通过 ohos Plugin 实现适配
- [ ] 删除或注释已有功能代码 — ❌ 鸿蒙适配不应删除已有功能
- [ ] 新增 `import 'dart:io'`（原无此依赖） — ⚠️ 需评估是否影响 Web 平台编译
- [ ] 新增公共 API 方法 — ⚠️ 需评估是否为通用需求还是仅 ohos 使用
- [ ] 修改 `pubspec.yaml` 依赖 — ⚠️ 需评估新增依赖的必要性

### 15.3 跨平台影响评估

- [ ] Dart 变更是否在 `Platform.isOHOS` 条件分支内，确保不影响 android/iOS 运行时行为
- [ ] 修改后的 `MethodChannel.invokeMethod` 参数是否仍与 android 侧实现兼容
- [ ] 修改后的返回值解析逻辑是否仍与 android 侧 `result.success()` 返回格式兼容
- [ ] Platform Interface 的默认实现行为是否被改变（影响未注册平台的行为）
- [ ] 公共 API 签名若变更，`pubspec.yaml` 版本号是否对应升 major（语义化版本）
- [ ] 新增的 `import` 或依赖是否引入了 android/iOS/Web 平台的编译或运行时问题

### 15.4 替代方案建议

- [ ] 对于「不应修改」的变更，已给出 ohos 侧的替代实现方案
- [ ] 对于「需评估」的变更，已分析替代方案并给出推荐
- [ ] 替代方案不引入新的跨平台兼容性问题
