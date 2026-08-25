---
name: rn-library-stability-check
description: 对 RN 三方库鸿蒙化代码进行稳定性检视，聚焦 ArkTS/ETS 和 C++ 代码，分析异常处理、资源释放、并发安全、生命周期管理、NAPI 跨语言调用、调用链完整性等维度，生成严苛评分报告（0-100分）。作为 RN 仓库检视流程的第二阶段，依赖 rn-library-interface-analyzer 的输出。使用场景：RN 三方库鸿蒙化稳定性评估、稳定性问题发现、代码质量改进。
license: Apache-2.0
compatibility: 需要访问源码目录、分析 ArkTS/ETS 和 C++ 源码，可选调用 MCP 脚本工具辅助代码扫描
metadata:
  author: CPPAgent
  version: "2.1.0"
  category: rn-library-check
---

# RNLibraryStabilityCheckSkill

对 RN 三方库的**鸿蒙化实现代码**进行稳定性检视，评估库在异常情况下的处理能力、资源管理安全性、并发处理可靠性、跨语言调用安全性等关键稳定性指标。

> ⚠️ **核心定位**：本 SKILL **仅检视鸿蒙化实现代码**，通过智能扫描识别代码范围（`*.ets`、NAPI C++、`module.json5`、`@ohos.*` API、TurboModule 桥接），而非依赖固定目录名称。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `repoUrl` | string | ✅ | 鸿蒙化仓库地址（ohosRepoUrl） |
| `outputDir` | string | ✅ | 输出目录绝对路径 |
| `interfaceDocPath` | string | ✅ | 接口规格说明文档路径 |
| `repoName` | string | ✅ | 仓库名称 |

---

## 输入依赖

- **前置 SKILL**: `rn-library-interface-analyzer`
- **输入文件**: `接口规格说明.md`（位于 outputDir）
- **仓库源码**: 已克隆到 `{outputDir}/source/`

---

## 工作流程概览

```
Phase 1: 鸿蒙代码智能定位与范围识别
    ↓
Phase 2: ArkTS 层稳定性分析（异常处理 + 资源释放 + 并发安全 + 生命周期）
    ↓
Phase 3: C++ Native 层稳定性分析（NAPI 跨语言 + 内存管理）
    ↓
Phase 4: 调用链完整性分析（跨层级异常传播追踪）
    ↓
Phase 5: 严苛评分计算（维度扣分 + 归零规则）
    ↓
Phase 6: 报告生成
```

---

## Phase 1：鸿蒙代码智能定位与范围识别

**通过多维度特征扫描**，智能识别鸿蒙化代码，而非依赖固定目录名称。

### 1.1 扫描策略（优先级递减）

| 扫描维度 | 特征模式 | 权重 | 说明 |
|----------|----------|------|------|
| **文件类型** | `*.ets` 文件 | ⭐⭐⭐ 高 | ArkTS/ETS 是鸿蒙化最强特征 |
| **配置文件** | `module.json5`、`oh-package.json5` | ⭐⭐⭐ 高 | 鸿蒙特有模块配置 |
| **API 调用** | `@ohos.*`、`napi_*`、`import from '@ohos'` | ⭐⭐ 中 | 鸿蒙 API 特征 |
| **RN 桥接** | TurboModule、NativeModule 注册代码 | ⭐⭐ 中 | RN 鸿蒙化关键桥接层 |
| **C++ NAPI** | `napi_create_reference`、`napi_value` 等 | ⭐⭐ 中 | Native 层鸿蒙绑定 |
| **目录标识** | 目录名包含 `ohos`、`harmony`、`openharmony` | ⭐ 低 | 辅助参考 |

### 1.2 扫描执行

可使用辅助脚本 `scripts/scan-harmony-code.py` 自动执行扫描，传入 `sourceDir` 参数：

```bash
python3 scripts/scan-harmony-code.py '{"sourceDir": "{outputDir}/source"}'
```

脚本输出各维度文件列表和分类统计，辅助判定检视范围。

### 1.3 判定规则

| 扫描结果 | 判定 | 评分 | 后续操作 |
|----------|------|------|----------|
| 发现 `.ets` 文件 | ✅ 存在鸿蒙化 | 正常评分 | 进入 Phase 2 |
| 发现 `module.json5` + NAPI 代码 | ✅ 存在鸿蒙化 | 正常评分 | 进入 Phase 2 |
| 仅发现目录名含 `ohos` 但无代码文件 | ⚠️ 疑似未完成 | 0-30 分 | 标注"鸿蒙化代码疑似缺失" |
| 未发现任何鸿蒙特征 | ❌ 未鸿蒙化 | 0 分 | 标注"未发现鸿蒙化实现代码" |
| 无法访问源码目录 | ❌ 无法检视 | 0 分 | 标注"源码目录不可访问" |

> **不以固定目录名否定**：即使没有 `ohos/` 目录，只要发现 `.ets` 文件或鸿蒙 API 调用，即判定为存在鸿蒙化。

---

## Phase 2：ArkTS 层稳定性分析

> 完整检查项判定标准与代码示例参见 [references/CHECKLIST.md](references/CHECKLIST.md)

### 2.1 异常处理完整性（基础分 25）

所有 `@ohos` 模块 API 调用和 TurboModule 注册方法必须覆盖异常捕获，关键路径必须包含完整异常处理链。

| # | 检查项 | 扣分 | 严重度 |
|---|--------|------|--------|
| E-01 | 关键 API 调用无 try-catch | **-10** | Critical |
| E-02 | Promise rejection 未处理 | **-8** | Critical |
| E-03 | 异常吞没（catch 块为空或仅 console.log） | **-7** | Major |
| E-04 | 参数验证缺失 | **-5** | Major |
| E-05 | 异常类型窄化 | **-3** | Minor |
| E-06 | finally 缺失（资源操作路径） | **-2** | Minor |

### 2.2 资源释放安全性（基础分 20）

鸿蒙系统资源必须在 TurboModule 销毁或组件/Ability 生命周期结束时释放。

| # | 检查项 | 扣分 | 严重度 |
|---|--------|------|--------|
| R-01 | 系统资源未释放（sensor/location/network/bluetooth） | **-10** | Critical |
| R-02 | 事件订阅未取消（`on()` 无对应 `off()`） | **-8** | Critical |
| R-03 | Stream/Connection 泄露 | **-5** | Major |
| R-04 | Timer 未清理 | **-3** | Minor |
| R-05 | Worker 未终止 | **-3** | Minor |

### 2.3 并发安全（基础分 20）

| # | 检查项 | 扣分 | 严重度 |
|---|--------|------|--------|
| C-01 | 主线程阻塞操作（耗时同步 I/O/大循环） | **-10** | Critical |
| C-02 | 共享状态无同步保护 | **-7** | Major |
| C-03 | 回调重入无防护 | **-3** | Minor |

### 2.4 ArkTS 生命周期管理（基础分 10）

| # | 检查项 | 扣分 | 严重度 |
|---|--------|------|--------|
| L-01 | aboutToDisappear/onDestroy 未清理 | **-8** | Critical |
| L-02 | @State/@Link 对象持有大引用未释放 | **-2** | Minor |

---

## Phase 3：C++ Native 层稳定性分析

> 完整检查项判定标准与代码示例参见 [references/CHECKLIST.md](references/CHECKLIST.md)

### 3.1 NAPI 跨语言调用安全（基础分 15）

| # | 检查项 | 扣分 | 严重度 |
|---|--------|------|--------|
| N-01 | napi_ref 创建/释放不匹配 | **-10** | Critical |
| N-02 | napi_handle_scope 未清理 | **-8** | Critical |
| N-03 | napi_value 类型转换无边界检查 | **-5** | Major |
| N-04 | napi_create_async_work 缺少异常处理 | **-5** | Major |
| N-05 | Native 对象与 JS 对象生命周期不一致 | **-3** | Minor |

### 3.2 C++ 内存管理安全（基础分 10）

| # | 检查项 | 扣分 | 严重度 |
|---|--------|------|--------|
| M-01 | malloc/new 与 free/delete 不匹配 | **-8** | Critical |
| M-02 | 异常路径资源未释放 | **-5** | Major |
| M-03 | 未使用 RAII 管理资源 | **-3** | Minor |

---

## Phase 4：调用链完整性分析

### 4.1 跨层级调用链追踪

追踪关键功能的完整调用链（JS 层 → ArkTS 鸿蒙层 → Native C++ 层），检查异常传播路径和资源释放节点。**必须追踪至少 3 个关键功能**的完整调用链，标注每个节点的异常处理状态。

### 4.2 异常传播链检查（额外扣分，不占基础分）

| # | 检查项 | 扣分 | 严重度 |
|---|--------|------|--------|
| CH-01 | ArkTS → Native 异常传播断裂（未通过 `napi_throw` 传播） | **-10** | Critical |
| CH-02 | 跨模块调用异常未传播 | **-5** | Major |
| CH-03 | 关键功能调用链缺失异常处理节点 | **-3** | Minor |

---

## Phase 5：严苛评分计算

### 5.1 评分公式

```
维度得分 = max(0, 基础分 - 该维度累计扣分)
综合评分 = Σ(各维度得分) - 调用链完整性扣分（CH-01~CH-03）
```

| 维度 | 基础分 | 检查项范围 |
|------|--------|------------|
| 异常处理完整性 | 25 | E-01~E-06 |
| 资源释放安全性 | 20 | R-01~R-05 |
| 并发安全 | 20 | C-01~C-03 |
| ArkTS 生命周期 | 10 | L-01~L-02 |
| NAPI 跨语言调用 | 15 | N-01~N-05 |
| C++ 内存管理 | 10 | M-01~M-03 |

### 5.2 归零规则与严重度映射

存在特殊归零规则（如 Critical ≥ 5 个直接评 0 分），以及按扣分值映射的严重度分级（Critical/Major/Minor）。

> 完整归零规则、严重度映射表和评分等级说明参见 [references/SCORING_RULES.md](references/SCORING_RULES.md)

---

## Phase 6：报告生成

在 `{outputDir}` 下生成 `稳定性检视报告.md`，包含：检视概览、综合评分、检视范围、维度明细、调用链分析、问题清单、改进建议。

> 完整报告格式模板参见 [assets/REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md)

> **重要**：报告必须包含 `**综合评分：XX/100**` 格式（粗体标记、中文冒号），且评分值位于"二、综合评分"章节，确保可被 `_parseRNLibraryScore` 函数正确解析。评分正则匹配优先级为 `综合评分` > `总体评分/评分` > `得分`。

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
| 未发现 `.ets` 文件和鸿蒙 API 特征 | 报告标注"未发现鸿蒙化实现代码" | 0 分 |
| 仅发现目录名含 `ohos` 但无代码文件 | 报告标注"鸿蒙化代码疑似缺失" | 0-30 分 |
| 发现鸿蒙代码但解析失败 | 报告标注"鸿蒙代码解析失败"并说明原因 | 0 分 |
| Critical 问题 ≥ 5 个 | 报告标注"存在严重稳定性风险" | 0 分 |
| 扫描到 `.ets` 但不在 `ohos/` 目录 | 正常检视，标注实际路径 | 正常评分 |

---

## 评分权重

本 SKILL 在 RN 仓库检视综合评分中权重为 **25%**。

---

## 参考文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 完整检查清单 | [references/CHECKLIST.md](references/CHECKLIST.md) | 所有检查项的判定标准与代码示例 |
| 评分规则 | [references/SCORING_RULES.md](references/SCORING_RULES.md) | 归零规则、严重度映射、评分等级 |
| 报告模板 | [assets/REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md) | 完整报告格式模板 |
| 代码扫描脚本 | [scripts/scan-harmony-code.py](scripts/scan-harmony-code.py) | Phase 1 鸿蒙代码智能扫描辅助工具（跨平台） |
