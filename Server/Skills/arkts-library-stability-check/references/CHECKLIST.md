# ArkTS 稳定性检视详细检查清单

本文件为 `ArktsLibraryStabilityCheckSkill` 的详细检查项参考，供深度检视时按项逐查。

> ⚠️ **检视范围限定**：以下所有检查项**仅适用于库核心实现代码**，排除 example、demo、sample 及 test 相关代码。仅检视库对外暴露的公共 API、核心业务逻辑、NAPI 绑定层。

---

## 相关参考文档

| 文档 | 内容 | 位置 |
|------|------|------|
| **代码示例** | 各维度正确/错误代码示例对照 | [CODE_EXAMPLES.md](CODE_EXAMPLES.md) |
| **评分规则** | 评分计算方式、归零规则、等级说明 | [SCORING_RULES.md](SCORING_RULES.md) |

---

## 1. 鸿蒙代码定位清单

### 1.0 范围过滤（排除非核心代码）

**在扫描前先过滤掉非核心代码**，确保检视聚焦于库的核心能力：

| 排除类型 | 目录/文件特征 | 说明 |
|----------|---------------|------|
| **示例代码** | 目录名含 `example`、`demo`、`sample`、`samples` | 库的使用示例，不代表核心能力 |
| **测试代码** | 目录名含 `test`、`tests`、`__test__`、`spec`、`unittest` | 测试代码验证功能而非实现功能 |
| **文档示例** | 文件名含 `example`、`demo`、`sample` 的 `.ets/.ts` 文件 | 嵌入文档中的示例代码 |

> **过滤原则**：目录路径中包含 `example/demo/sample/test` 关键词时，该目录下所有文件均不检视。

### 1.1 文件类型特征扫描

| 特征 | 模式 | 权重 | 说明 |
|------|------|------|------|
| ArkTS/ETS 文件 | `*.ets`（排除 example/demo/sample/test） | ⭐⭐⭐ 高 | 最强鸿蒙化特征 |
| 鸿蒙配置 | `module.json5`、`oh-package.json5`（排除 example/demo/sample/test） | ⭐⭐⭐ 高 | 鸿蒙特有配置 |
| TypeScript | `*.ts`（含 `@ohos` 导入，排除 example/demo/sample/test） | ⭐⭐ 中 | 需配合 API 特征判断 |
| NAPI C++ 文件 | `*.cpp`、`*.h`（含 `napi_*` 调用，排除 example/demo/sample/test） | ⭐⭐ 中 | Native 层绑定 |

### 1.2 API 调用特征扫描

| 特征 | 模式 | 说明 |
|------|------|------|
| 鸿蒙系统 API | `@ohos.*`、`import from '@ohos'` | 鸿蒙官方模块（核心代码范围） |
| NAPI 绑定 | `napi_create_*`、`napi_get_*`、`napi_call_function` | Native 接口（核心代码范围） |
| 鸿蒙组件 | `@Entry`、`@Component`、`@Builder` | ArkUI 声明式组件（核心代码范围） |
| 鸿蒙生命周期 | `aboutToAppear`、`aboutToDisappear`、`onPageShow` | 组件/页面生命周期（核心代码范围） |
| 鸿蒙服务 | `geoLocationManager`、`sensor`、`network` | 系统服务调用（核心代码范围） |

### 1.3 判定规则

| 扫描结果 | 判定 | 评分 | 后续操作 |
|----------|------|------|----------|
| 发现核心 `.ets` 文件 | ✅ 存在鸿蒙化 | 正常评分 | 进入深度分析 |
| 发现核心 `module.json5` + NAPI 代码 | ✅ 存在鸿蒙化 | 正常评分 | 进入深度分析 |
| 仅发现目录名含 `ohos` 但无代码文件 | ⚠️ 疑似未完成 | 0-30 分 | 标注"鸿蒙化代码疑似缺失" |
| 未发现任何鸿蒙特征（核心代码） | ❌ 未实现鸿蒙化 | 0 分 | 标注"未发现鸿蒙化核心实现代码" |
| 仅在 example/demo/sample/test 中发现鸿蒙代码 | ⚠️ 核心实现缺失 | 0 分 | 标注"鸿蒙化代码仅存在于示例中" |
| 无法访问源码目录 | ❌ 无法检视 | 0 分 | 标注"源码目录不可访问" |

---

## 2. ArkTS 核心实现层稳定性检查清单

### 2.1 异常处理完整性（25 分）

**仅检视库核心实现代码**，不分析 example/demo/sample 及 test 代码。

| # | 检查项 | 扣分 | 检查方式 | 关键路径定义 |
|---|--------|------|----------|-------------|
| E-01 | 核心公共 API 调用无 try-catch | **-10** | 搜索 `@ohos.*` 调用上下文是否包裹 try-catch（排除 example/demo/sample/test） | 库对外暴露方法、涉及系统资源的核心操作 |
| E-02 | Promise rejection 未处理 | **-8** | 搜索 `.then()` 无 `.catch()`、await 无 try-catch | 所有异步操作链（核心实现） |
| E-03 | 异常吞没 | **-7** | catch 块为空或仅 `console.log`，未恢复/上报/重新抛出 | 所有 catch 块（核心实现） |
| E-04 | 参数验证缺失 | **-5** | 库公共 API 方法入口无类型/边界/空值检查 | 对外暴露的公共方法 |
| E-05 | 异常类型窄化 | **-3** | 仅捕获特定异常类型，遗漏其他可能异常 | 涉及多种异常源的核心操作 |
| E-06 | finally 缺失 | **-2** | 涉及资源操作但无 finally 清理路径 | 含资源分配的 try-catch（核心实现） |

### 2.2 资源释放安全性（25 分）

**仅检视库核心实现代码**，不分析 example/demo/sample 及 test 代码。

| # | 检查项 | 扣分 | 检查方式 |
|---|--------|------|----------|
| R-01 | 系统资源未释放（sensor/location/network） | **-12** | 搜索核心代码中 `sensor.on()`/`geoLocationManager.on()` 等是否有对应 `.off()`/`.disable()`（排除 example/demo/sample/test） |
| R-02 | 事件订阅未取消 | **-8** | 搜索核心代码中 `on()` 注册是否在组件 `aboutToDisappear` 或 Ability `onDestroy` 中对应 `off()`（排除 example/demo/sample/test） |
| R-03 | Stream/Connection 泄露 | **-5** | 搜索 `createConnection`/`openSession` 是否有 `close`/`disconnect` |
| R-04 | Timer 未清理 | **-5** | 搜索 `setInterval`/`setTimeout` 是否在销毁时 `clearInterval`/`clearTimeout` |
| R-05 | Worker 未终止 | **-5** | 搜索 Worker 创建是否在适当时机 `terminate()` |

### 2.3 并发安全（20 分）

**仅检视库核心实现代码**，不分析 example/demo/sample 及 test 代码。

| # | 检查项 | 扣分 | 检查方式 |
|---|--------|------|----------|
| C-01 | 主线程阻塞 | **-10** | 搜索核心 API 执行路径中是否存在耗时同步操作（大循环、同步 I/O、同步锁等待） |
| C-02 | 共享状态无同步保护 | **-7** | 搜索多个异步回调修改同一状态变量，无锁/队列/原子操作 |
| C-03 | 回调重入 | **-3** | 搜索异步回调可能重入导致状态混乱，缺少重入防护标志 |

### 2.4 ArkTS 生命周期管理（10 分）

**仅检视库核心实现代码**，不分析 example/demo/sample 及 test 代码。

| # | 检查项 | 扣分 | 检查方式 |
|---|--------|------|----------|
| L-01 | aboutToDisappear 未清理 | **-8** | 库核心组件销毁钩子是否释放资源/移除监听/取消订阅 |
| L-02 | @State 对象持有大引用 | **-2** | 核心状态变量持有大对象引用在组件销毁后未释放 |

---

## 3. C++ Native 核心层稳定性检查清单

**仅检视库核心 NAPI 绑定和 C++ 实现代码**，不分析 example/demo/sample 及 test 代码。

### 3.1 NAPI 跨语言调用（15 分）

| # | 检查项 | 扣分 | 检查方式 |
|---|--------|------|----------|
| N-01 | napi_ref 创建/释放不匹配 | **-10** | 搜索核心 NAPI 代码中 `napi_create_reference` 和 `napi_delete_reference` 是否数量匹配、路径对称（排除 example/demo/sample/test） |
| N-02 | napi_handle_scope 未清理 | **-8** | 搜索 `napi_open_handle_scope` 是否有对应 `napi_close_handle_scope` |
| N-03 | napi_value 类型转换无边界检查 | **-5** | 搜索 `napi_get_value_*` 是否有类型检查和边界验证 |
| N-04 | napi_create_async_work 缺少异常处理 | **-5** | 搜索异步 work 的 execute/complete 回调是否检查返回值 |
| N-05 | Native 对象与 ArkTS 对象生命周期不一致 | **-3** | 搜索 Native 侧对象是否绑定 ArkTS 侧 GC 回调 |

### 3.2 C++ 内存管理安全（10 分）

| # | 检查项 | 扣分 | 检查方式 |
|---|--------|------|----------|
| M-01 | malloc/new 与 free/delete 不匹配 | **-8** | 搜索分配/释放是否对称，是否存在双重释放 |
| M-02 | 异常路径资源未释放 | **-5** | 搜索 try/catch 中分配的资源是否在异常分支释放 |
| M-03 | 未使用 RAII 管理资源 | **-3** | 搜索裸指针管理资源是否可改用智能指针 |

---

## 4. 核心功能调用链完整性检查清单

**仅追踪库对外暴露的核心功能调用链**，不分析 example/demo/sample 中展示的调用链。

### 4.1 跨层级调用链追踪

| # | 检查项 | 扣分 | 检查方式 |
|---|--------|------|----------|
| CH-01 | ArkTS → Native 异常传播断裂 | **-10** | Native 异常是否通过 `napi_throw` 传播到 ArkTS 层 |
| CH-02 | 跨模块调用异常未传播 | **-8** | 模块间调用异常是否正确传播而非被吞没 |
| CH-03 | 核心功能调用链缺失异常处理节点 | **-7** | 追踪核心功能完整调用链，标注每个节点的异常处理状态 |

---

## 5. 特殊归零规则

| 规则 | 条件 | 结果 |
|------|------|------|
| 归零规则 1 | Critical 级别问题 ≥ 5 个 | 直接评 0 分 |
| 归零规则 2 | Critical 级别问题 ≥ 3 个 + Major 级别问题 ≥ 4 个 | 直接评 0 分 |
| 归零规则 3 | 核心公共 API 异常处理完全缺失（≥ 3 个核心 API 调用无 try-catch，不含 example/demo 代码） | 直接评 0 分 |
| 归零规则 4 | NAPI 引用管理完全不匹配（创建远多于释放） | 直接评 0 分 |
| 归零规则 5 | 未发现鸿蒙化核心实现代码 | 0 分 |
| 归零规则 6 | 源码目录不可访问 | 0 分 |

---

## 6. 评分规则参考

> 评分计算方式、严重度映射、等级说明详见 [SCORING_RULES.md](SCORING_RULES.md)。
| 归零规则 6 | 源码目录不可访问 | 0 分 |