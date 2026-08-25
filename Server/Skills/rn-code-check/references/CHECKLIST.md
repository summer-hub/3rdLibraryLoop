# React Native 代码检视清单

本文档包含详细的检视检查项，用于 Phase 3 的深度检视阶段。

---

## 一、非兼容变更检查

- [ ] 是否删除或重命名了公开 TurboModule 方法
- [ ] 是否修改了 NAPI 接口函数名称或参数结构（影响 JS 侧调用）
- [ ] 是否修改了 JS/TS 声明文件中的方法签名或返回类型
- [ ] 是否修改了 `package.json` 中影响依赖解析的字段

---

## 二、C++ CAPI 实现检视（harmony/src/main/cpp/）

### 2.1 TurboModule 实现

- [ ] TurboModule 是否正确实现了 `getTurboModule()` 工厂函数
- [ ] NAPI 接口函数签名与 JS 侧声明一致（方法名、参数类型、返回值类型）

### 2.2 内存管理

- [ ] `napi_create_*` 创建的对象在不需要时正确释放
- [ ] `napi_ref` 在不需要时调用 `napi_delete_reference`
- [ ] C++ 对象生命周期正确管理（无悬挂指针）
- [ ] `malloc`/`new` 有对应 `free`/`delete`，无内存泄漏
- [ ] TurboModule 实例销毁时释放所有持有的 C++ 资源
- [ ] `napi_env` 生命周期内创建的对象不在 env 销毁后访问
- [ ] `ArrayBuffer` 大数据用完后无强引用持有

### 2.3 线程安全（重点）

> ⚠️ **线程安全问题是 RN Native 模块最常见的严重问题，必须重点检查**

- [ ] 子线程中不直接调用 NAPI 函数（必须通过 `napi_threadsafe_function`）
- [ ] 主 JS 线程与 C++ 线程间共享的数据有锁保护（`std::mutex`）
- [ ] `napi_threadsafe_function` 创建后在不再使用时调用 `napi_release_threadsafe_function`
- [ ] 多线程场景中无竞态条件（Race Condition）

### 2.4 错误处理

- [ ] C++ 异常捕获并转为 NAPI 错误抛出
- [ ] 每个返回分支均有明确的返回值赋值（无未初始化返回）
- [ ] 所有 NAPI API 返回值检查（`napi_status` 不为 `napi_ok` 时有处理）
- [ ] `OH_*` C API 的返回值是否有检查

---

## 三、ArkTS 胶水层检视（harmony/src/main/ets/）

### 3.1 TurboModule 注册

- [ ] TurboModule 正确注册（`createTurboModuleManager` 或 `TurboModuleRegistry.get`）
- [ ] ArkUI Fabric 组件（如有）正确实现了 `RNComponentContext`

### 3.2 代码规范

- [ ] 日志调用使用 `RNLog` 而非原生 `console.log`
- [ ] 无 `any` 类型使用（ArkTS 禁止 `as any`、隐式 any）
- [ ] 无 `prototype` 动态修改
- [ ] 泛型类型参数明确，避免推导歧义

### 3.3 API 兼容性

- [ ] 新增 API 使用是否超出 `minAPIVersion`
- [ ] 是否使用已废弃的 OHOS API（`@deprecated` 标注的接口）
- [ ] 权限申请是否正确（`requestPermissionsFromUser`）

---

## 四、异步处理

- [ ] 所有异步 OHOS API 调用均有 `await` 或 `.then()` 处理
- [ ] `try/catch` 覆盖所有 `await` 调用，catch 块有实质性错误处理（非空 catch）
- [ ] 未处理的 Promise rejection（`.catch()` 或 `try/catch` 必须存在）
- [ ] 并行异步操作使用 `Promise.all`，避免不必要的顺序 await

---

## 五、事件监听器管理

- [ ] JS 侧注册的事件监听器在模块销毁时取消注册
- [ ] C++ 层的回调函数在对象销毁时被正确移除
- [ ] 重复注册同一事件不会造成监听器堆积

---

## 六、错误处理

- [ ] 错误信息包含错误码和错误描述
- [ ] `reject()` / `napi_reject_deferred` 调用后函数立即返回
- [ ] switch-case 中每个 case 末尾有 `break`（避免 fall-through）

---

## 七、JS/TS 接口层（src/ 目录）

- [ ] Native Module 方法类型声明完整（返回 `Promise<T>` 或同步类型明确）
- [ ] 是否包含鸿蒙平台条件判断 `Platform.OS === 'harmony'`
- [ ] 公共 API 有完整的 JSDoc 注释
- [ ] 参数有基本校验（null check、类型检查）

---

## 八、跨平台一致性对比（harmony ↔ Android/iOS）

> ⚠️ **这是 RN 三方库 PR 检视最关键的质量维度之一**。harmony 实现必须与 Android/iOS 原生模块在方法路由、参数类型、返回值格式上保持一致，否则 JS 侧调用同一 Native Module 时在鸿蒙平台上行为异常。

### 8.1 TurboModule 方法路由一致性

- [ ] harmony 的 TurboModule 方法列表是否与 Android NativeModule 完全对应
- [ ] 缺失方法（Android 有但 harmony 无）是否标记为功能缺失
- [ ] 多余方法（harmony 有但 Android 无）是否有合理说明

### 8.2 TurboModule 名称一致性

- [ ] harmony 注册的 TurboModule 名是否与 Android 注册名一致（JS 侧共用同一模块名）
- [ ] NativeModule 名是否与 JS 侧 `NativeModules.XxxModule` 引用一致

### 8.3 参数类型映射一致性

- [ ] 同一 TurboModule 方法，harmony 解析的参数类型是否与 Android 一致（如 `bool` vs `string`）
- [ ] 复杂对象参数的属性结构是否一致
- [ ] 可选参数的处理方式是否一致（默认值 vs undefined）

### 8.4 返回值格式一致性

- [ ] `resolve()` 返回的数据结构是否与 Android `success()` 对齐
- [ ] 返回值嵌套层级和字段名是否一致
- [ ] 空值/空数组的返回格式是否一致

### 8.5 错误码/错误消息一致性

- [ ] `reject()` 的 error code 是否与 Android `error()` 对齐
- [ ] 错误消息的格式和内容是否一致
- [ ] 同一错误场景在不同平台的错误码是否相同

### 8.6 功能实现完整性

- [ ] Android 有实现但 harmony 为 Stub（返回固定值无实际操作）的标记为功能缺失
- [ ] Android 有实现但 harmony 完全缺失的标记为方法缺失
- [ ] 已知平台差异（如权限模型不同）是否有注释说明

### 8.7 EventEmitter 事件名一致性

- [ ] harmony 发送的事件名是否与 Android 发送的事件名一致
- [ ] 事件数据格式（字段名、类型）是否一致
- [ ] 事件监听器的注册/移除接口是否一致

---

## 九、安全性

- [ ] 无硬编码的 API Key / Token / URL 等敏感信息
- [ ] 网络请求校验 HTTPS 证书（禁止忽略证书错误）
- [ ] 用户输入有校验和过滤（防注入）
- [ ] 文件路径有安全校验（防路径穿越）
- [ ] 敏感数据不在日志中输出

---

## 十、构建配置

- [ ] `CMakeLists.txt` 链接的系统库均为必要依赖
- [ ] `oh-package.json5` 新增依赖合理，无 `*` 通配版本
- [ ] 编译选项无安全风险（如 `-fno-stack-protector` 等）

---

## 十一、代码规范

- [ ] C++ 代码遵循现代 C++ 规范（优先使用 RAII、智能指针）
- [ ] ArkTS 命名遵循驼峰规则（变量/方法小驼峰，类/接口大驼峰）
- [ ] 无冗余的 `RNLog`/`console.log` 调试代码遗留
- [ ] 公共 API 有完整注释
- [ ] 文件头版权声明完整

---

## 十二、资源管理

- [ ] 定时器有对应清理
- [ ] `napi_env` 生命周期内创建的对象不在 env 销毁后访问

---

**使用说明**：在检视阶段按章节逐项检查，对发现的问题在报告中标注等级（CRITICAL/MAJOR/MINOR/SUGGEST）。