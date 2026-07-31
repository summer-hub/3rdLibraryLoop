---
name: arkts-library-stability-check
description: 对 ArkTS 鸿蒙化库的**核心实现代码**进行稳定性检视，聚焦 ArkTS/ETS 和 C++ 代码，分析异常处理、资源释放、并发安全、生命周期管理、NAPI 跨语言调用、调用链完整性等维度，排除 example/demo/sample 及 test 代码，生成严苛评分报告（0-100分）。作为 ArkTS 仓库检视流程的第二阶段，依赖 library-interface-analyzer 的输出。
license: Apache-2.0
compatibility: 需要访问 Git 仓库、分析 ArkTS/ETS 和 C++ 源码
metadata:
  author: CPPAgent
  version: "3.0"
---

# ArktsLibraryStabilityCheckSkill

对**已鸿蒙化的 ArkTS 库**的核心实现代码进行稳定性检视，评估库在异常情况下的处理能力、资源管理安全性、并发处理可靠性、跨语言调用安全性等关键稳定性指标。

> ⚠️ **核心定位**：本 SKILL **仅检视鸿蒙化实现代码中的库核心能力**，针对已经完成鸿蒙化适配的 ArkTS 三方库。检视范围包括 `.ets`（ArkTS/ETS）文件、NAPI 相关 C++ 文件、`module.json5`（鸿蒙模块配置）、`@ohos.*` API 调用等鸿蒙化代码特征。**通过智能扫描识别代码范围**，而非依赖固定目录名称。

> ⚠️ **检视范围限定**：**排除 example、demo、sample 及 test 相关代码**。仅检视库的核心实现（对外暴露的 API、核心业务逻辑、NAPI 绑定层），不分析示例用例、演示代码、测试代码。这些代码仅供参考，不代表库的核心稳定性能力。

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `repoUrl` | ✅ | Git 仓库地址，支持分支参数 `?branch=xxx` |
| `outputDir` | ✅ | 输出目录绝对路径，存放检视报告 |
| `interfaceDocPath` | ✅ | 接口规格说明文档路径（由 library-interface-analyzer 生成） |
| `repoName` | ✅ | 仓库名称（用于报告标识） |

---

## 输入依赖

本 SKILL 是 ArkTS 仓库检视流程的**第二阶段**，依赖：

- **前置 SKILL**: `library-interface-analyzer`
- **输入文件**: `接口规格说明.md`（位于 outputDir）
- **仓库源码**: 已克隆到 `{outputDir}/source/`

---

## 工作流程

### Phase 1：鸿蒙代码智能定位与范围识别

**通过多维度特征扫描**，智能识别鸿蒙化代码，而非依赖固定目录名称。

#### 1.1 扫描策略（优先级递减）

| 扫描维度 | 特征模式 | 权重 | 说明 |
|----------|----------|------|------|
| **文件类型** | `*.ets` 文件 | ⭐⭐⭐ 高 | ArkTS/ETS 是鸿蒙化最强特征 |
| **配置文件** | `module.json5`、`oh-package.json5` | ⭐⭐⭐ 高 | 鸿蒙特有模块配置 |
| **API 调用** | `@ohos.*`、`napi_*`、`import from '@ohos'` | ⭐⭐ 中 | 鸿蒙 API 特征 |
| **C++ NAPI** | `napi_create_reference`、`napi_value` 等 | ⭐⭐ 中 | Native 层鸿蒙绑定 |
| **目录标识** | 目录名包含 `ohos`、`harmony`、`openharmony` | ⭐ 低 | 辅助参考 |

#### 1.2 范围过滤（排除非核心代码）

在扫描鸿蒙代码之前，**先过滤掉非核心代码**，确保检视聚焦于库的核心能力：

**排除规则**：

| 排除类型 | 目录/文件特征 | 说明 |
|----------|---------------|------|
| **示例代码** | 目录名含 `example`、`demo`、`sample`、`samples` | 这些是库的使用示例，不代表库核心能力 |
| **测试代码** | 目录名含 `test`、`tests`、`__test__`、`spec`、`unittest` | 测试代码验证功能而非实现功能 |
| **文档示例** | 文件名含 `example`、`demo`、`sample` 的 `.ets/.ts` 文件 | 嵌入文档中的示例代码 |

**过滤执行**：

```bash
# Step 0: 排除非核心代码目录
# 排除 example/demo/sample/test 目录
find {sourceDir} -name "*.ets" -type f \
  -not -path "*/example*" \
  -not -path "*/demo*" \
  -not -path "*/sample*" \
  -not -path "*/samples*" \
  -not -path "*/test*" \
  -not -path "*/__test__*" \
  -not -path "*/spec*" \
  -not -path "*/unittest*"

# 排除 example/demo/sample/test 的鸿蒙配置文件
find {sourceDir} -name "module.json5" -type f \
  -not -path "*/example*" \
  -not -path "*/demo*" \
  -not -path "*/sample*" \
  -not -path "*/test*"

# 排除 example/demo/sample/test 的 NAPI C++ 文件
find {sourceDir} -name "*.cpp" -o -name "*.h" -type f \
  -not -path "*/example*" \
  -not -path "*/demo*" \
  -not -path "*/sample*" \
  -not -path "*/test*"
```

> **过滤原则**：如果目录路径中包含 `example/demo/sample/test` 关键词，该目录下的所有文件均不检视。但**库核心实现代码中引用 example/sample 作为数据或配置**（非代码逻辑）的情况不排除。

#### 1.3 扫描执行（核心代码范围）

在范围过滤后，对剩余的核心代码执行扫描：

```bash
# Step 1: 扫描核心 ArkTS/ETS 文件（最高优先级，已排除非核心目录）
find {sourceDir} -name "*.ets" -type f \
  -not -path "*/example*" \
  -not -path "*/demo*" \
  -not -path "*/sample*" \
  -not -path "*/test*"

# Step 2: 扫描核心鸿蒙配置文件（已排除非核心目录）
find {sourceDir} -name "module.json5" -o -name "oh-package.json5" -type f \
  -not -path "*/example*" \
  -not -path "*/demo*" \
  -not -path "*/sample*" \
  -not -path "*/test*"

# Step 3: 扫描核心 NAPI 相关 C++ 文件（已排除非核心目录）
grep -r "napi_" --include="*.cpp" --include="*.h" {sourceDir} \
  --exclude-dir="example" --exclude-dir="demo" --exclude-dir="sample" \
  --exclude-dir="test" --exclude-dir="tests" --exclude-dir="__test__"

# Step 4: 扫描核心代码中的 @ohos API 导入（已排除非核心目录）
grep -r "import.*@ohos" --include="*.ets" --include="*.ts" {sourceDir} \
  --exclude-dir="example" --exclude-dir="demo" --exclude-dir="sample" \
  --exclude-dir="test" --exclude-dir="tests" --exclude-dir="__test__"
```

#### 1.4 代码定位结果分类

```
检视范围判定：
├── 鸿蒙核心代码（必检视）
│   ├── *.ets 文件（排除 example/demo/sample/test）  # ArkTS/ETS 核心实现 ✅ 检视
│   ├── module.json5（排除 example/demo/sample/test） # 模块配置 ✅ 检视
│   ├── napi_*.cpp / *.cpp（排除 example/demo/sample/test） # Native NAPI 绑定 ✅ 检视
│   └── oh-package.json5（排除 example/demo/sample/test） # 依赖配置 ⚠️ 辅助参考
├── 非核心代码（不检视）
│   ├── example/demo/sample 目录下所有文件  ❌ 不检视
│   ├── test/tests/__test__/spec 目录下所有文件 ❌ 不检视
│   ├── 文件名含 example/demo/sample 的代码文件 ❌ 不检视
│   └── 未包含鸿蒙特征的代码                ❌ 不检视
├── 疑似鸿蒙代码（需验证）
│   ├── 含部分 napi 调用但无完整结构  ⚠️ 进一步检查
```

#### 1.5 判定规则

| 扫描结果 | 判定 | 评分 | 后续操作 |
|----------|------|------|----------|
| 发现 `.ets` 文件（核心代码） | ✅ 存在鸿蒙化 | 正常评分 | 进入 Phase 2 |
| 发现 `module.json5` + NAPI 代码（核心代码） | ✅ 存在鸿蒙化 | 正常评分 | 进入 Phase 2 |
| 仅发现目录名含 `ohos` 但无代码文件 | ⚠️ 疑似未完成 | 0-30 分 | 标注"鸿蒙化代码疑似缺失" |
| 未发现任何鸿蒙特征（核心代码） | ❌ 未鸿蒙化 | 0 分 | 标注"未发现鸿蒙化核心实现代码" |
| 仅在 example/demo/sample/test 中发现鸿蒙代码 | ⚠️ 核心实现缺失 | 0 分 | 标注"鸿蒙化代码仅存在于示例中，核心实现缺失" |
| 无法访问源码目录 | ❌ 无法检视 | 0 分 | 标注"源码目录不可访问" |

> **不以固定目录名否定**：即使没有 `ohos/` 目录，只要发现 `.ets` 文件或鸿蒙 API 调用，即判定为存在鸿蒙化。

---

### Phase 2：ArkTS 核心实现层稳定性分析

#### 2.1 异常处理完整性（维度总分 25 分）

**仅检视库核心实现代码中的异常处理**，不分析 example/demo/sample 及 test 代码。

所有 `@ohos` 模块 API 调用必须覆盖异常捕获，关键路径必须包含完整异常处理链。关键路径定义：库对外暴露的公共 API 方法、涉及系统资源的核心操作。

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| E-01 | 核心公共 API 调用无 try-catch | **-10** | 涉及系统 API 调用但无异常捕获，关键路径定义：库对外暴露方法、涉及系统资源的核心操作（不含 example/demo 中的调用） |
| E-02 | Promise rejection 未处理 | **-8** | `.then()` 无 `.catch()` 或 await 无 try-catch |
| E-03 | 异常吞没 | **-7** | catch 块为空或仅 `console.log`，未恢复/上报/重新抛出 |
| E-04 | 参数验证缺失 | **-5** | 库公共 API 方法入口无类型/边界/空值检查 |
| E-05 | 异常类型窄化 | **-3** | 仅捕获特定异常类型，遗漏其他可能类型 |
| E-06 | finally 缺失 | **-2** | 涉及资源操作但无 finally 清理路径 |

**代码示例**：

```typescript
// ❌ 关键路径无异常处理（E-01，扣 10 分）
async connect(deviceId: string): Promise<void> {
  await bluetooth.connect(deviceId); // 可能抛出 PermissionError
  return; // 异常未传播
}

// ✅ 正确实现
async connect(deviceId: string): Promise<void> {
  try {
    if (!deviceId || deviceId.length === 0) {
      throw new Error('Invalid deviceId'); // 参数验证 (E-04)
    }
    await bluetooth.connect(deviceId);
  } catch (e) {
    throw new Error(`Connect failed: ${e.message}`); // 异常传播而非吞没
  }
}
```

#### 2.2 资源释放安全性（维度总分 25 分）

**仅检视库核心实现代码中的资源释放**，不分析 example/demo/sample 及 test 代码。

鸿蒙系统资源必须在组件/Ability 生命周期结束时释放。

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| R-01 | 系统资源未释放（sensor/location/network） | **-12** | 未调用 `unregister`/`disable`/`off` 释放系统资源 |
| R-02 | 事件订阅未取消 | **-8** | `on()` 注册的监听器未在 `aboutToDisappear`/`onDestroy` 中 `off()` 移除 |
| R-03 | Stream/Connection 泄露 | **-5** | 打开但未关闭的 I/O 流或连接 |
| R-04 | Timer 未清理 | **-5** | `setInterval`/`setTimeout` 未在销毁时清除 |
| R-05 | Worker 未终止 | **-5** | Worker 创建后未在适当时机 `terminate()` |

**代码示例**：

```typescript
// ❌ 事件订阅未取消（R-02，扣 8 分）
export class LocationPlugin {
  startListening(): void {
    geoLocationManager.on('locationChange', this.callback);
    // 缺少 off() 调用！
  }
}

// ✅ 正确实现
export class LocationPlugin {
  private isListening: boolean = false;

  startListening(): void {
    geoLocationManager.on('locationChange', this.callback);
    this.isListening = true;
  }

  stopListening(): void {
    if (this.isListening) {
      geoLocationManager.off('locationChange', this.callback);
      this.isListening = false;
    }
  }

  aboutToDisappear(): void {
    this.stopListening(); // 必须取消订阅
  }
}
```

#### 2.3 并发安全（维度总分 20 分）

**仅检视库核心实现代码中的并发问题**，不分析 example/demo/sample 及 test 代码。

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| C-01 | 主线程阻塞 | **-10** | 在核心 API 执行路径中存在耗时同步操作（大循环、同步 I/O） |
| C-02 | 共享状态无同步保护 | **-7** | 多个异步回调修改同一状态变量，无锁/队列/原子操作 |
| C-03 | 回调重入 | **-3** | 异步回调可能重入导致状态混乱，缺少重入防护 |

#### 2.4 ArkTS 生命周期管理（维度总分 10 分）

**仅检视库核心实现代码中的生命周期问题**，不分析 example/demo/sample 及 test 代码。

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| L-01 | aboutToDisappear 未清理 | **-8** | 库核心组件销毁钩子未释放资源/移除监听/取消订阅 |
| L-02 | @State 对象持有大引用未释放 | **-2** | 核心状态变量持有大对象引用在组件销毁后未释放 |

---

### Phase 3：C++ Native 核心层稳定性分析

**仅检视库核心 NAPI 绑定和 C++ 实现代码**，不分析 example/demo/sample 及 test 代码。

#### 3.1 NAPI 跨语言调用（维度总分 15 分）

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| N-01 | napi_ref 创建/释放不匹配 | **-10** | `napi_create_reference` 和 `napi_delete_reference` 数量不匹配或路径不对称 |
| N-02 | napi_handle_scope 未清理 | **-8** | `napi_open_handle_scope` 无对应 `napi_close_handle_scope` |
| N-03 | napi_value 类型转换无边界检查 | **-5** | `napi_get_value_*` 缺少类型检查和边界验证 |
| N-04 | napi_create_async_work 缺少异常处理 | **-5** | 异步 work 的 execute/complete 回调未检查返回值 |
| N-05 | Native 对象与 ArkTS 对象生命周期不一致 | **-3** | Native 侧对象未绑定 ArkTS 侧 GC 回调 |

**代码示例**：

```cpp
// ❌ Handle Scope 未清理（N-02，扣 8 分）
static napi_value GetInfo(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  // ... 业务逻辑 ...
  // 缺少 napi_close_handle_scope！
  return result;
}

// ✅ 正确实现
static napi_value GetInfo(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  napi_value result;
  // ... 业务逻辑 ...
  napi_close_handle_scope(env, scope); // 必须清理
  return result;
}
```

#### 3.2 C++ 内存管理安全（维度总分 10 分）

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| M-01 | malloc/new 与 free/delete 不匹配 | **-8** | 分配/释放不对称，或存在双重释放风险 |
| M-02 | 异常路径资源未释放 | **-5** | try/catch 中分配的资源在异常分支未释放 |
| M-03 | 未使用 RAII 管理资源 | **-3** | 裸指针管理资源可改用智能指针但未使用 |

---

### Phase 4：核心功能调用链完整性分析

**仅追踪库对外暴露的核心功能调用链**，不分析 example/demo/sample 中展示的调用链。

#### 4.1 跨层级调用链追踪

追踪核心功能的完整调用链，检查异常传播路径和资源释放节点：

```
调用链结构示例：
ArkTS 层                      Native (C++) 层
│                              │
├─ publicAPI.method()          │
│  ├─ try-catch ✅/❌          │
│  └─ invokeNative()           │
│                               ├─ NativeImpl::execute()
│                               │  ├─ napi_handle_scope ✅/❌
│                               │  ├─ napi_ref 管理 ✅/❌
│                               │  └─ return result
│                               │
├─ callback/result             │
│  ├─ 异常检查 ✅/❌           │
│  └─ return to caller         │
```

#### 4.2 异常传播链检查

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| CH-01 | ArkTS → Native 异常传播断裂 | **-10** | Native 异常未通过 `napi_throw` 传播到 ArkTS 层 |
| CH-02 | 跨模块调用异常未传播 | **-8** | 模块间调用异常被吞没而非传播 |
| CH-03 | 核心功能调用链缺失异常处理节点 | **-7** | 核心功能调用链中至少一个节点无异常处理 |

**必须追踪至少 3 个库核心功能的完整调用链**（对外暴露的公共 API），标注每个节点的异常处理状态。不追踪 example/demo 中的调用链。

---

### Phase 5：严苛评分计算

#### 5.1 维度评分规则

采用**严苛扣分制**，每个维度独立计算扣分后汇总：

| 维度 | 基础分 | 扣分上限 | 说明 |
|------|--------|----------|------|
| 异常处理完整性 | 25 | -25 | E-01~E-06 各项扣分叠加 |
| 资源释放安全性 | 25 | -25 | R-01~R-05 各项扣分叠加 |
| 并发安全 | 20 | -20 | C-01~C-03 各项扣分叠加 |
| ArkTS 生命周期 | 10 | -10 | L-01~L-02 各项扣分叠加 |
| NAPI 跨语言调用 | 15 | -15 | N-01~N-05 各项扣分叠加 |
| C++ 内存管理 | 10 | -10 | M-01~M-03 各项扣分叠加 |
| 调用链完整性 | 5 | -5 | CH-01~CH-03 各项扣分叠加 |

**维度得分** = max(0, 基础分 - 该维度累计扣分)

**综合评分** = Σ(各维度得分)，范围 0-100

#### 5.2 特殊归零规则（叠加于维度扣分之上）

| 规则 | 条件 | 结果 |
|------|------|------|
| 归零规则 1 | Critical 级别问题 ≥ 5 个 | **直接评 0 分** |
| 归零规则 2 | Critical ≥ 3 个 + Major ≥ 4 个 | **直接评 0 分** |
| 归零规则 3 | 核心公共 API 异常处理完全缺失（≥ 3 个核心 API 调用无 try-catch，不含 example/demo 代码） | **直接评 0 分** |
| 归零规则 4 | NAPI 引用管理完全不匹配（创建远多于释放） | **直接评 0 分** |
| 归零规则 5 | 未发现鸿蒙化核心实现代码 | **0 分** |
| 归零规则 6 | 源码目录不可访问 | **0 分** |

#### 5.3 严重度映射

问题严重度按扣分值映射：

| 严重度 | 扣分范围 | 说明 |
|--------|----------|------|
| **Critical** | ≥ 8 分 | 致命问题，可能导致崩溃或严重资源泄露 |
| **Major** | 5-7 分 | 严重问题，影响系统稳定性 |
| **Minor** | ≤ 3 分 | 轻微问题，建议改进 |

#### 5.4 评分等级说明

| 分数段 | 等级 | 说明 |
|--------|------|------|
| 90-100 | 优秀 | 异常处理完善，资源管理规范，无稳定性风险 |
| 80-89 | 良好 | 存在少量 Minor 问题，不影响核心稳定性 |
| 70-79 | 一般 | 存在 Major 级别问题需关注，有一定风险 |
| 60-69 | 较差 | 存在 Critical 级别问题，稳定性堪忧 |
| <60 | 严重不足 | 多个 Critical 问题，崩溃/泄露风险极高 |
| 0 | 不可用 | 触发归零规则或完全缺失稳定性设计 |

---

### Phase 6：报告生成

在 `{outputDir}` 下生成 `稳定性检视报告.md`，严格遵循以下格式：

```markdown
# {repoName} 稳定性检视报告

## 一、检视概览

| 字段 | 内容 |
|------|------|
| **仓库名称** | {repoName} |
| **检视类型** | ArkTS 稳定性检视（核心实现） |
| **检视时间** | {timestamp} |
| **分析文件数** | {fileCount} |
| **检视范围** | {鸿蒙核心代码定位结果摘要} |
| **排除范围** | example/demo/sample/test 相关代码 |

## 二、综合评分

**综合评分：{score}/100**

> 评分说明：采用严苛扣分制，7 个维度独立评分后汇总，最低 0 分。**仅对库核心实现代码评分**，example/demo/sample/test 代码不参与评分。

| 维度 | 基础分 | 扣分 | 得分 |
|------|--------|------|------|
| 异常处理完整性 | 25 | {扣分} | {得分}/25 |
| 资源释放安全性 | 25 | {扣分} | {得分}/25 |
| 并发安全 | 20 | {扣分} | {得分}/20 |
| ArkTS 生命周期管理 | 10 | {扣分} | {得分}/10 |
| NAPI 跨语言调用 | 15 | {扣分} | {得分}/15 |
| C++ 内存管理 | 10 | {扣分} | {得分}/10 |
| 调用链完整性 | 5 | {扣分} | {得分}/5 |

**扣分明细**：
- {检查项编号}：{问题描述}（{严重度}）：-{扣分值} 分
- ……

{归零规则触发时追加：}
> ⚠️ 触发归零规则：{规则描述}，综合评分直接为 0 分

## 三、检视范围

### 鸿蒙核心代码定位结果

**扫描策略**：通过文件类型 + API 特征 + 配置文件智能识别，**排除 example/demo/sample/test 代码**

| 扫描维度 | 发现文件数 | 检视状态 |
|----------|------------|----------|
| `.ets` 文件（核心） | {count} | ✅ 已检视（核心） |
| `module.json5` | {count} | ✅ 已检视 |
| NAPI C++ 文件 | {count} | ✅ 已检视 |
| `@ohos` API 导入 | {count} 处 | ✅ 已检视 |
| example/demo/sample/test | {count} | ❌ 已排除 |

**实际检视文件列表**（仅核心实现）：
- `{文件路径}` ✅
- ……

**已排除文件列表**：
- `{example/demo/sample/test 文件路径}` ❌ 已排除（非核心代码）

## 四、检视维度明细

### 4.1 异常处理完整性

| 检查项编号 | 检查项 | 严重度 | 发现数量 | 扣分 | 详情 |
|------------|--------|--------|----------|------|------|
| E-01 | …… | …… | …… | …… | …… |
| …… | …… | …… | …… | …… | …… |

### 4.2 资源释放安全性
……

### 4.3 并发安全
……

### 4.4 ArkTS 生命周期管理
……

### 4.5 NAPI 跨语言调用
……

### 4.6 C++ 内存管理
……

## 五、调用链完整性分析

### 5.1 核心功能调用链图

**核心功能 1**：{功能名称}

```
调用链：{methodA} → {methodB} → {nativeMethodC}
异常处理：✅ / ❌（标注每个节点）
```

### 5.2 异常传播链检查

| 检查项编号 | 检查项 | 扣分 | 详情 |
|------------|--------|------|------|
| CH-01 | …… | …… | …… |

## 六、问题清单

| # | 文件 | 行号 | 检查项编号 | 严重度 | 描述 | 修复建议 |
|---|------|------|------------|--------|------|----------|
| …… | …… | …… | …… | …… | …… | …… |

## 七、改进建议

### 优先级 P0（Critical，必须修复）
……

### 优先级 P1（Major，强烈建议修复）
……

### 优先级 P2（Minor，建议改进）
……

---

**报告生成时间**：{timestamp}
```

> **重要**：报告必须包含 `**综合评分：XX/100**` 格式（粗体标记、中文冒号），以便后端 `_parseArktsLibraryScore` 函数正确解析评分。

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 稳定性检视报告 | `稳定性检视报告.md` | 评分 + 维度明细 + 调用链 + 问题清单 + 修复建议 |

所有产物写入 `{outputDir}` 目录。

---

## 特殊情况处理

| 情况 | 处理方式 | 评分 |
|------|----------|------|
| 未发现 `.ets` 核心文件和鸿蒙 API 特征（排除 example/test 后） | 报告标注"未发现鸿蒙化核心实现代码" | 0 分 |
| 仅在 example/demo/sample/test 中发现鸿蒙代码 | 报告标注"鸿蒙化代码仅存在于示例中，核心实现缺失" | 0 分 |
| 仅发现目录名含 `ohos` 但无代码文件 | 报告标注"鸿蒙化代码疑似缺失" | 0-30 分 |
| 发现鸿蒙核心代码但解析失败 | 报告标注"鸿蒙核心代码解析失败"并说明原因 | 0 分 |
| Critical 问题 ≥ 5 个 | 报告标注"存在严重稳定性风险" | 0 分 |
| 扫描到 `.ets` 但不在 `ohos/` 目录 | 正常检视，标注实际路径 | 正常评分 |

---

## 评分权重

本 SKILL 在 ArkTS 仓库检视综合评分中权重为 **25%**。

---

## 详细检查清单

完整检查项参考参见 [references/CHECKLIST.md](references/CHECKLIST.md)