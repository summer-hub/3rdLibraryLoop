---
name: arkts-library-stability-check
description: 对 ArkTS 鸿蒙化库核心实现代码进行稳定性检视，分析异常处理、资源释放、并发安全、生命周期管理、NAPI 跨语言调用、调用链完整性，排除 example/demo/sample/test 代码，生成严苛评分报告（0-100分）。作为 ArkTS 仓库检视流程第二阶段，依赖 library-interface-analyzer 输出。当需要对已鸿蒙化的 ArkTS 三方库进行稳定性评估时使用。
license: Apache-2.0
compatibility: 需要访问 Git 仓库、分析 ArkTS/ETS 和 C++ 源码
metadata:
  version: "1.1.0"
  category: harmonyos-testing
  language: ArkTS/ETS/C++
  invoked-by: LoopEngine
  consumed-by: arkts-library-documentation-quality-check
  upstream: arkts-library-interface-spec
---

# ArktsLibraryStabilityCheckSkill

对**已鸿蒙化的 ArkTS 库**的核心实现代码进行稳定性检视，评估异常处理、资源管理、并发安全、跨语言调用等关键稳定性指标，生成严苛评分报告。

> ⚠️ **核心原则**：本 SKILL **仅检视核心实现代码**（对外暴露的 API、核心业务逻辑、NAPI 绑定层），**排除 example、demo、sample 及 test 相关代码**。通过多维度特征扫描智能识别代码范围，而非依赖固定目录名称。

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

- **前置 SKILL**: `arkts-library-interface-spec`
- **输入文件**: `接口规格说明.md`（位于 outputDir）
- **仓库源码**: 已克隆到 `{outputDir}/source/`

---

## 工作流程概览

```
Phase 1: 鸿蒙代码智能定位 → Phase 2: ArkTS 核心层稳定性分析 → Phase 3: C++ Native 层稳定性分析 → Phase 4: 调用链完整性分析 → Phase 5: 严苛评分计算 → Phase 6: 报告生成
```

---

## Phase 1：鸿蒙代码智能定位与范围识别

### 1.1 扫描策略（优先级递减）

| 扫描维度 | 特征模式 | 权重 | 说明 |
|----------|----------|------|------|
| **文件类型** | `*.ets` 文件 | ⭐⭐⭐ 高 | ArkTS/ETS 是鸿蒙化最强特征 |
| **配置文件** | `module.json5`、`oh-package.json5` | ⭐⭐⭐ 高 | 鸿蒙特有模块配置 |
| **API 调用** | `@ohos.*`、`napi_*`、`import from '@ohos'` | ⭐⭐ 中 | 鸿蒙 API 特征 |
| **C++ NAPI** | `napi_create_reference`、`napi_value` 等 | ⭐⭐ 中 | Native 层鸿蒙绑定 |
| **目录标识** | 目录名包含 `ohos`、`harmony`、`openharmony` | ⭐ 低 | 辅助参考 |

### 1.2 范围过滤（排除非核心代码）

**排除规则**：目录路径含 `example`/`demo`/`sample`/`test`/`tests`/`__test__`/`spec`/`unittest` 的全部排除。文件名含 `example`/`demo`/`sample` 的 `.ets`/`.ts` 文件也排除。

```bash
# 扫描核心 ArkTS/ETS 文件（排除非核心目录）
find {sourceDir} -name "*.ets" -type f \
  -not -path "*/example*" -not -path "*/demo*" \
  -not -path "*/sample*" -not -path "*/samples*" \
  -not -path "*/test*" -not -path "*/__test__*" \
  -not -path "*/spec*" -not -path "*/unittest*"

# 扫描核心鸿蒙配置文件
find {sourceDir} \( -name "module.json5" -o -name "oh-package.json5" \) -type f \
  -not -path "*/example*" -not -path "*/demo*" \
  -not -path "*/sample*" -not -path "*/test*"

# 扫描核心 NAPI C++ 文件
grep -r "napi_" --include="*.cpp" --include="*.h" {sourceDir} \
  --exclude-dir="example" --exclude-dir="demo" \
  --exclude-dir="sample" --exclude-dir="test" --exclude-dir="tests"

# 扫描核心 @ohos API 导入
grep -r "import.*@ohos" --include="*.ets" --include="*.ts" {sourceDir} \
  --exclude-dir="example" --exclude-dir="demo" \
  --exclude-dir="sample" --exclude-dir="test" --exclude-dir="tests"
```

### 1.3 判定规则

| 扫描结果 | 判定 | 评分 | 后续操作 |
|----------|------|------|----------|
| 发现核心 `.ets` 文件 | ✅ 存在鸿蒙化 | 正常评分 | 进入 Phase 2 |
| 发现核心 `module.json5` + NAPI 代码 | ✅ 存在鸿蒙化 | 正常评分 | 进入 Phase 2 |
| 仅目录名含 `ohos` 但无代码文件 | ⚠️ 疑似未完成 | 0-30 分 | 标注"鸿蒙化代码疑似缺失" |
| 未发现任何鸿蒙特征（核心代码） | ❌ 未鸿蒙化 | 0 分 | 标注"未发现鸿蒙化核心实现代码" |
| 仅在 example/demo/sample/test 中发现鸿蒙代码 | ⚠️ 核心实现缺失 | 0 分 | 标注"鸿蒙化代码仅存在于示例中" |
| 无法访问源码目录 | ❌ 无法检视 | 0 分 | 标注"源码目录不可访问" |

> 详细检查清单参见 [references/CHECKLIST.md](references/CHECKLIST.md)

---

## Phase 2：ArkTS 核心实现层稳定性分析

**仅检视库核心实现代码**，不分析 example/demo/sample 及 test 代码。每个维度按检查项逐项检视并扣分。

### 2.1 异常处理完整性（25 分）

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| E-01 | 核心公共 API 调用无 try-catch | **-10** | 涉及系统 API 调用但无异常捕获（不含 example/demo） |
| E-02 | Promise rejection 未处理 | **-8** | `.then()` 无 `.catch()` 或 await 无 try-catch |
| E-03 | 异常吞没 | **-7** | catch 块为空或仅 `console.log` |
| E-04 | 参数验证缺失 | **-5** | 公共 API 入口无类型/边界/空值检查 |
| E-05 | 异常类型窄化 | **-3** | 仅捕获特定类型，遗漏其他可能 |
| E-06 | finally 缺失 | **-2** | 资源操作无 finally 清理路径 |

### 2.2 资源释放安全性（25 分）

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| R-01 | 系统资源未释放（sensor/location/network） | **-12** | 未调用 `unregister`/`disable`/`off` |
| R-02 | 事件订阅未取消 | **-8** | `on()` 无对应 `off()` |
| R-03 | Stream/Connection 泄露 | **-5** | 打开未关闭的 I/O 流或连接 |
| R-04 | Timer 未清理 | **-5** | `setInterval`/`setTimeout` 未清除 |
| R-05 | Worker 未终止 | **-5** | Worker 创建后未 `terminate()` |

### 2.3 并发安全（20 分）

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| C-01 | 主线程阻塞 | **-10** | 核心 API 中存在耗时同步操作 |
| C-02 | 共享状态无同步保护 | **-7** | 多异步回调修改同一状态，无锁/队列 |
| C-03 | 回调重入 | **-3** | 缺少重入防护标志 |

### 2.4 ArkTS 生命周期管理（10 分）

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| L-01 | aboutToDisappear 未清理 | **-8** | 销毁钩子未释放资源/移除监听 |
| L-02 | @State 持有大引用未释放 | **-2** | 组件销毁后大对象引用未释放 |

> 代码示例参见 [references/CODE_EXAMPLES.md](references/CODE_EXAMPLES.md)

---

## Phase 3：C++ Native 核心层稳定性分析

**仅检视库核心 NAPI 绑定和 C++ 实现代码**，不分析 example/demo/sample 及 test 代码。

### 3.1 NAPI 跨语言调用（15 分）

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| N-01 | napi_ref 创建/释放不匹配 | **-10** | 创建和释放数量不匹配 |
| N-02 | napi_handle_scope 未清理 | **-8** | 无对应 `napi_close_handle_scope` |
| N-03 | napi_value 类型转换无边界检查 | **-5** | 缺少类型检查和边界验证 |
| N-04 | napi_create_async_work 缺少异常处理 | **-5** | 回调未检查返回值 |
| N-05 | Native 对象与 ArkTS 生命周期不一致 | **-3** | 未绑定 ArkTS 侧 GC 回调 |

### 3.2 C++ 内存管理安全（10 分）

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| M-01 | malloc/new 与 free/delete 不匹配 | **-8** | 分配/释放不对称或双重释放 |
| M-02 | 异常路径资源未释放 | **-5** | try/catch 异常分支未释放 |
| M-03 | 未使用 RAII 管理资源 | **-3** | 可改用智能指针但未使用 |

> 代码示例参见 [references/CODE_EXAMPLES.md](references/CODE_EXAMPLES.md)

---

## Phase 4：核心功能调用链完整性分析

**仅追踪库对外暴露的核心功能调用链**，不分析 example/demo/sample 中展示的调用链。**必须追踪至少 3 个库核心功能的完整调用链**。

### 4.1 跨层级调用链追踪

追踪核心功能的完整调用链（ArkTS → Native），检查异常传播路径和资源释放节点：

```
调用链示例：
ArkTS 层                      Native (C++) 层
├─ publicAPI.method()          │
│  ├─ try-catch ✅/❌          ├─ NativeImpl::execute()
│  └─ invokeNative()           │  ├─ napi_handle_scope ✅/❌
│                               │  ├─ napi_ref 管理 ✅/❌
├─ callback/result             │  └─ return result
│  ├─ 异常检查 ✅/❌           │
│  └─ return to caller         │
```

### 4.2 异常传播链检查

| # | 检查项 | 扣分 | 说明 |
|---|--------|------|------|
| CH-01 | ArkTS → Native 异常传播断裂 | **-10** | Native 异常未通过 `napi_throw` 传播 |
| CH-02 | 跨模块调用异常未传播 | **-8** | 模块间异常被吞没 |
| CH-03 | 核心调用链缺失异常处理节点 | **-7** | 至少一个节点无异常处理 |

---

## Phase 5：严苛评分计算

### 5.1 维度评分规则

采用**严苛扣分制**，每个维度独立计算：

| 维度 | 基础分 | 扣分上限 |
|------|--------|----------|
| 异常处理完整性 | 25 | -25 |
| 资源释放安全性 | 25 | -25 |
| 并发安全 | 20 | -20 |
| ArkTS 生命周期 | 10 | -10 |
| NAPI 跨语言调用 | 15 | -15 |
| C++ 内存管理 | 10 | -10 |
| 调用链完整性 | 5 | -5 |

**维度得分** = max(0, 基础分 - 该维度累计扣分)
**综合评分** = Σ(各维度得分)，范围 0-100

### 5.2 特殊归零规则

| 规则 | 条件 | 结果 |
|------|------|------|
| 归零规则 1 | Critical 问题 ≥ 5 个 | **0 分** |
| 归零规则 2 | Critical ≥ 3 个 + Major ≥ 4 个 | **0 分** |
| 归零规则 3 | 核心 API 异常处理完全缺失（≥ 3 个无 try-catch） | **0 分** |
| 归零规则 4 | NAPI 引用管理完全不匹配 | **0 分** |
| 归零规则 5 | 未发现鸿蒙化核心代码 | **0 分** |
| 归零规则 6 | 源码目录不可访问 | **0 分** |

> 详细评分规则、严重度映射、等级说明参见 [references/SCORING_RULES.md](references/SCORING_RULES.md)

---

## Phase 6：报告生成

在 `{outputDir}` 下生成 `稳定性检视报告.md`，须包含：

- **检视概览**：仓库名称、时间、文件数、范围摘要
- **综合评分**：`**综合评分：{score}/100**`（粗体、中文冒号，后端 `_parseArktsLibraryScore` 依赖此格式）
- **检视范围**：各维度文件数、检视/排除列表
- **维度明细**：7 个维度逐项列出发现、扣分和详情
- **调用链分析**：至少 3 个核心功能调用链图
- **问题清单**：文件、行号、编号、严重度、描述、修复建议
- **改进建议**：按 P0/P1/P2 优先级排列

> 完整报告模板参见 [assets/REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md)

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 稳定性检视报告 | `稳定性检视报告.md` | 评分 + 维度明细 + 调用链 + 问题清单 + 修复建议 |

所有产物写入 `{outputDir}` 目录。

> ⚠️ **输出文件自检**：写入结果文件前，先确认 `稳定性检视报告.md` 已存在且内容完整（**独立文件，禁止只写入 result 执行结果文件**）。若报告内容仅在草稿中，必须先将其保存为上述独立文件。

### 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将最终评分以下述 JSON 对象写入该路径：

```json
{
  "stabilityScore": 85,
  "scoreReason": "异常处理缺失2处-16等（一句话判定依据，≤50字；触发一票否决时必须注明）"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `stabilityScore` | number | 稳定性评分（0-100 整数，与报告中 `**综合评分：XX/100**` 的数值一致） |
| `scoreReason` | string | 评分判定依据摘要（可选，前端悬浮提示展示；0 分时强烈建议写明触发规则，如"Critical≥5 触发归零"） |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取评分，无需解析报告文本）。若 prompt 未下发该路径则跳过本节。

---

## 特殊情况处理

| 情况 | 处理方式 | 评分 |
|------|----------|------|
| 未发现 `.ets` 核心文件和鸿蒙 API 特征（排除 example/test 后） | 报告标注"未发现鸿蒙化核心实现代码" | 0 分 |
| 仅在 example/demo/sample/test 中发现鸿蒙代码 | 报告标注"鸿蒙化代码仅存在于示例中" | 0 分 |
| 仅目录名含 `ohos` 但无代码文件 | 报告标注"鸿蒙化代码疑似缺失" | 0-30 分 |
| 发现鸿蒙核心代码但解析失败 | 报告标注"解析失败"并说明原因 | 0 分 |
| 扫描到 `.ets` 但不在 `ohos/` 目录 | 正常检视，标注实际路径 | 正常评分 |

---

## 评分权重

本 SKILL 在 ArkTS 仓库检视综合评分中权重为 **25%**。

---

## 详细参考

| 文档 | 内容 |
|------|------|
| [检查清单](references/CHECKLIST.md) | 各维度完整检查项、检查方式、判定规则 |
| [代码示例](references/CODE_EXAMPLES.md) | 各维度正确/错误代码示例对照 |
| [评分规则](references/SCORING_RULES.md) | 评分计算方式、归零规则、等级说明 |
| [报告模板](assets/REPORT_TEMPLATE.md) | 输出报告完整格式模板 |