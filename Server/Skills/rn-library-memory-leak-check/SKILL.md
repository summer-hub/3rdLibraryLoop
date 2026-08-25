---
name: rn-library-memory-leak-check
description: 对 RN 三方库鸿蒙化代码进行内存泄露检视，聚焦 ArkTS/ETS 与 C++ NAPI 层，分析 TurboModule 生命周期、NativeComponent 资源管理、Bridge 事件监听、NAPI 引用管理、JSI 绑定泄露等内存安全问题，生成严苛评分报告（0-100分）。作为 RN 仓库检视流程第五阶段，依赖编码质量检视结果。Use when 需要对 RN 鸿蒙化库进行内存泄露风险检视或评估内存管理安全性。关键词：内存泄漏、NAPI、TurboModule、JSI、鸿蒙化、ArkTS。
license: Apache-2.0
compatibility: 需要访问 Git 仓库、分析 ohos 目录下的 ETS/C++ 源码
metadata:
  version: "1.0.0"
---

# RNLibraryMemoryLeakCheckSkill

对 RN 三方库的**鸿蒙化实现代码**进行内存泄露风险检视，识别 ArkTS/ETS 层与 C/C++ NAPI 绑定层代码中的潜在内存泄露问题，评估资源管理安全性。

> ⚠️ **核心定位**：本 SKILL **仅检视鸿蒙化代码**，不检视 RN JS 层或非鸿蒙化部分的代码。检视范围包括：
> - 鸿蒙平台特有的 ArkTS/ETS 代码（TurboModule 实现、NativeComponent 渲染、EventEmitter 等）
> - 鸿蒙 Native C++ 代码（NAPI 绑定、JSI HostFunction/HostObject、TurboModule C++ 层等）
> - 鸿蒙平台特有的 API 资源管理（如 GattClientDevice、NAPI 引用、@ohos 模块等）
>
> **重要**：目录名称不固定，需通过源码扫描识别鸿蒙化代码特征

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `repoUrl` | string | ✅ | Git 仓库地址，支持分支 `?branch=xxx` |
| `outputDir` | string | ✅ | 输出目录绝对路径，存放检视报告 |
| `interfaceDocPath` | string | ✅ | 接口规格说明文档路径 |
| `repoName` | string | ✅ | 仓库名称（用于报告标识） |

---

## 输入依赖

本 SKILL 是 RN 仓库检视流程的**第五阶段**，依赖：

- **前置 SKILL**: `rn-library-code-quality-check`
- **输入文件**: `接口规格说明.md`、`编码质量检视报告.md`
- **仓库源码**: 已克隆到 `{outputDir}/source/`，重点分析 `ohos/` 目录

> 💡 **编码质量报告为可选参考**：若 `编码质量检视报告.md` 不存在（流程未编排编码质量检视），直接跳过该参考输入，独立完成内存泄露检视，不影响评分。

> 💡 **利用前置报告**：参考编码质量检视报告中标记的架构问题和代码规范问题，重点关注其中涉及的资源管理相关代码段。

---

## 工作流程概览

```
Phase 0: 鸿蒙代码定位与范围识别
    ↓ （确认鸿蒙化实现 / 排除 RNJS 三方库）
Phase 1: TurboModule/NativeModule 生命周期检查
    ↓
Phase 2: 事件监听器管理检查
    ↓
Phase 3: ArkTS 内存管理检查
    ↓
Phase 4: C++ Native 内存检查
    ↓
Phase 5: 严苛评分计算与报告输出
```

---

## Phase 0：鸿蒙代码定位与范围识别

### 0.1 RN JS 三方库判定

扫描源码 ts、js 和 tsx 文件，识别是否**不包含** TurboModuleRegistry、NativeModules、codegenNativeComponent 等 RN 鸿蒙化特征。若不包含，判定为 **RNJS 三方库**，不进行后续检视，直接输出报告评分 0 分，标注"RNJS 三方库"。

### 0.2 鸿蒙代码特征识别

扫描源码文件，通过代码特征（而非仅依赖目录名称）识别鸿蒙化实现：

- **ArkTS/ETS 特征**：`@ohos` 模块导入、TurboModule 鸿蒙实现、`@Component` NativeComponent、NativeEventEmitter/DeviceEventEmitter、`.ets` 文件
- **C++ Native 特征**：`RNOH/CppComponentInstance.h`、`napi/native_api.h`、`ReactCommon/TurboModule.h`、NAPI 函数调用（`napi_create_reference`、`napi_wrap`）

> 详细特征模式、代码示例和目录结构参见 [鸿蒙代码特征识别模式](references/HARMONY_CODE_PATTERNS.md)

### 0.3 扫描执行

可使用辅助脚本快速扫描：

```bash
python3 {skillDir}/scripts/scan_harmony_code.py '{"sourceDir": "{{outputDir}}/source"}'
```

> `workdir: "{{outputDir}}"`

**判定规则**：
- 优先通过代码特征识别，而非仅依赖目录名称
- 扫描到鸿蒙代码特征 → 确认鸿蒙化实现，进入 Phase 1
- 未发现鸿蒙代码特征 → 报告评分 0 分，标注"未实现鸿蒙化"

---

## Phase 1：TurboModule/NativeModule 生命周期检查

### 1.1 TurboModule 生命周期绑定（致命项，20分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| `__onDestroy__` 资源释放 | 是否释放**所有**资源 | 未释放扣 20 分 |
| Bridge 事件监听清理 | NativeEventEmitter/DeviceEventEmitter 监听是否全部移除 | 未移除扣 15 分 |
| Map 数据清理 | 模块级 Map（如 `mConnectedDevices`）是否清空 | 未清空扣 12 分 |
| 释放顺序 | 是否按正确顺序释放（先移除监听→停操作→清数据→释放资源） | 顺序错误扣 8 分 |

**关键检查**：`__onDestroy__` 必须按"移除监听 → 停止操作 → 释放系统资源 → 清空 Map → 置空回调引用"顺序执行。

### 1.2 NativeComponent 生命周期绑定（致命项，15分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| `aboutToDisappear` / `onDropViewInstance` | 视图销毁时是否释放所有关联资源 | **未释放扣 15 分（致命）** |
| View 级监听器清理 | 视图级事件监听是否在视图销毁时移除 | 未移除扣 12 分 |
| Native 侧事件发送器释放 | RCTEventEmitter 引用是否清除 | 未清除扣 10 分 |
| 子组件/子视图递归释放 | 自定义 View 的子 View 是否递归释放 | 未释放扣 10 分 |

**关键检查**：
- `aboutToDisappear` 必须释放视图持有的所有系统资源（DescriptorChangesListener、Sensor、Location、Timer 等）
- 组件属性缓存的实例是否释放（Controller、Operator 等）
- 多实例场景：同一 ViewManager 创建的多个 View 实例必须各自独立清理

> 详细代码示例（正例/反例）参见 [检查清单 - 1. TurboModule/NativeModule 生命周期管理](references/CHECKLIST.md#1-turbomodulenativemodule-生命周期管理)

---

## Phase 2：事件监听器管理检查

### 2.1 RN Bridge 事件机制（致命项，20分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| NativeEventEmitter addListener/removeAllListeners | 每个监听是否在适当时机移除 | **未移除扣 15 分** |
| DeviceEventEmitter 监听泄露 | DeviceEventEmitter.addListener 后是否在 destroy 移除 | 未移除扣 15 分 |
| RCTEventEmitter 强引用 | 原生侧 RCTEventEmitter 是否持有已销毁 View 引用 | 持有扣 12 分 |
| 事件发送器生命周期 | EventEmitter 实例是否随 TurboModule 销毁 | 未销毁扣 10 分 |

**典型泄露场景**：
- 每次调用都注册新监听器，destroy 时未移除
- Promise 回调中的监听器 resolve 后未移除
- RCTEventEmitter 向已销毁 View 发送事件

### 2.2 鸿蒙 API 事件订阅（致命项，20分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| `on/off` 对称性 | 每个 `on()` 是否有对应 `off()` | **无对应 off 扣 20 分（致命）** |
| 回调参数匹配 | `off()` 是否传入正确的回调函数引用 | 参数错误扣 12 分 |
| 多次注册风险 | 同一事件是否可能被多次注册监听 | 存在风险扣 15 分 |
| TurboModule 级 vs View 级监听 | TurboModule 级监听不应在 View 销毁时取消 | 混淆扣 10 分 |

**特殊系统资源释放检查**：

| 资源类型 | 检查项 | 扣分 |
|----------|--------|------|
| GattClientDevice | 是否调用 `close()` | **未调用扣 20 分** |
| Sensor | 是否调用 `off()` 注销 | **未注销扣 20 分** |
| 数据库连接 | rdb 是否调用 `close()` | **未关闭扣 20 分** |
| BLE 扫描 | `ble.stopBLEScan()` 是否调用 | 未调用扣 15 分 |
| 地理位置 | `geoLocationManager.off()` 是否取消 | 未取消扣 15 分 |
| Timer | setInterval/setTimeout 是否清除 | 未清除扣 12 分 |

> 详细代码示例和常见泄露场景参见 [检查清单 - 2. RN Bridge 事件机制](references/CHECKLIST.md#2-rn-bridge-事件机制) 和 [检查清单 - 3. 鸿蒙 API 事件订阅管理](references/CHECKLIST.md#3-鸿蒙-api-事件订阅管理)

---

## Phase 3：ArkTS 内存管理检查

### 3.1 闭包循环引用（致命项，15分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| this 捕获 | 箭头函数是否捕获 `this` 引用且未在 destroy 释放 | 捕获且未释放扣 15 分 |
| 闭包保留 | 闭包是否保留外部变量引用且无法释放 | 保留且无法释放扣 12 分 |
| RN 回调链泄露 | JS → Native → JS 回调链中的闭包引用是否正确断开 | 未断开扣 12 分 |
| 异步回调持有 stale context | setTimeout/Promise 回调中引用已销毁 TurboModule 上下文 | 引用扣 10 分 |

**检测要点**：
- 箭头函数捕获 `this` 形成循环引用链（`this.gatt → 回调 → this → this.gatt`）
- TurboModule 级回调持有 View 实例引用，View 销毁后回调仍持有引用
- 推荐在构造函数中预创建回调，destroy 时清除引用打破循环

### 3.2 Map/Set 数据清理（严苛项，10分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| Map.clear() | TurboModule 的 Map 数据是否在 destroy 时调用 clear() | 未清理扣 10 分 |
| View 实例 Map | ViewManager 维护的 View 实例 Map 是否在 onDropViewInstance 删除 | 未删除扣 12 分 |
| 静态 Map 风险 | 静态 Map 是否无限累积 | **累积风险扣 15 分** |
| 缓存上限 | 是否设置缓存大小上限 | 无上限扣 8 分 |

> 详细代码示例参见 [检查清单 - 4. 闭包与上下文泄露](references/CHECKLIST.md#4-闭包与上下文泄露)

---

## Phase 4：C++ Native 内存检查

### 4.1 NAPI 引用管理（致命项，20分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| `napi_ref` 释放 | 是否在 dispose/destroy 时调用 `napi_delete_reference` | **未释放扣 20 分（致命）** |
| Handle Scope 清理 | 是否正确关闭 `napi_handle_scope` | **未关闭扣 20 分（致命）** |
| finalize 回调 | `napi_wrap` 是否提供 finalize 回调释放 Native 对象 | **缺失扣 20 分（致命）** |
| 引用计数平衡 | `napi_create_reference` 和 `napi_delete_reference` 数量是否匹配 | 不平衡扣 18 分 |
| ArrayBuffer 外部资源 | `napi_create_external` 的 finalize 回调是否缺失 | 缺失扣 15 分 |
| 线程安全函数引用 | `napi_create_threadsafe_function` 后是否调用 `napi_release_threadsafe_function` | 未释放扣 15 分 |

### 4.2 TurboModule/JSI 绑定内存（致命项，15分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| TurboModule C++ 实例释放 | C++ 实例在 JS 对象回收后是否释放 | **未释放扣 15 分（致命）** |
| JSI HostFunction 泄露 | HostFunction 绑定在 Runtime 销毁时是否释放 | **未释放扣 15 分** |
| JSI HostObject 属性回调 | HostObject 的 getter/setter 闭包持有外部引用未清理 | 未清理扣 12 分 |
| 跨语言回调链 | C++ 层回调引用 JS 函数的双向引用是否正确断开 | 未断开扣 12 分 |
| C++ 与 JS 生命周期不一致 | C++ 侧实例比 JS 侧对象存活更久，导致悬垂引用 | **不一致扣 15 分** |
| Codegen 生成代码资源释放 | Codegen 自动生成的代码中资源释放逻辑是否完整 | 不完整扣 10 分 |

### 4.3 Native 内存分配释放（致命项，15分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| malloc/free 匹配 | 每个 `malloc` 是否有对应 `free` | **不匹配扣 15 分（致命）** |
| new/delete 匹配 | 每个 `new` 是否有对应 `delete` | **不匹配扣 15 分（致命）** |
| new[]/delete[] 匹配 | `new[]` 是否使用 `delete[]` 释放 | **误用扣 15 分** |
| 智能指针循环引用 | `shared_ptr` 循环引用导致引用计数永不为零 | **循环引用扣 15 分** |
| 异常路径释放 | 异常发生时是否释放已分配内存 | 未释放扣 12 分 |
| 全局/静态缓冲区增长 | 全局 vector/map 无上限增长 | 无清理扣 12 分 |

### 4.4 跨语言生命周期不一致（致命项，15分）

| 检查项 | 问题描述 | 扣分规则 |
|--------|----------|----------|
| ArkTS/C++ 不对称释放 | ArkTS 层调用 off() 但 C++ 层未释放对应资源 | **不对称扣 15 分** |
| Native 对象生命周期不一致 | C++ Native 对象与 ArkTS 包装对象生命周期不一致 | **不一致扣 15 分** |
| TurboModule 与 View 生命周期混淆 | TurboModule 级资源不应在 View 销毁时释放 | 混淆扣 12 分 |
| Bridge 消息队列累积 | 原生模块与 JS 之间的消息队列在模块销毁时未清空 | 未清空扣 10 分 |

> 详细代码示例（NAPI 管理、JSI 绑定、智能指针循环引用、跨语言释放不对称）参见 [检查清单 - 5~8 节](references/CHECKLIST.md#5-napi-引用管理)

---

## Phase 5：严苛评分计算与报告输出

### 5.1 评分规则

采用**严苛扣分制**，从 100 分开始扣减：

| 扣分类型 | 单项扣分 | 典型问题 |
|----------|----------|----------|
| 致命问题 | -20 分 | TurboModule destroy 未释放、NAPI 引用未释放、Handle Scope 未关闭、malloc/free 不匹配、鸿蒙 API 事件无对应取消、NativeEventEmitter 监听未移除、GattClientDevice/Sensor/数据库未释放 |
| 严重问题 | -12 分 | Bridge 事件监听未移除、闭包循环引用、Map 数据未清理、View 实例 Map 未删除、跨语言回调链泄露 |
| 中等问题 | -8 分 | 回调参数匹配错误、释放顺序不当、初始化不完整 |
| 轻微问题 | -5 分 | 订阅状态未追踪、缓存无上限 |

### 5.2 特殊规则（直接 0 分）

- 未发现鸿蒙代码特征 → 0 分
- 致命问题 ≥ 3 个 → 0 分
- 致命问题 ≥ 2 个 + 严重问题 ≥ 3 个 → 0 分
- 关键路径（TurboModule 注册、NAPI 绑定入口）存在致命问题 → 0 分
- 累计扣分超过 60 分 → 0 分

> **严苛标准**：85 分以下不建议发布，55 分以下视为严重不可用。
> 完整评分规则汇总参见 [检查清单 - 9. 评分规则汇总](references/CHECKLIST.md#9-评分规则汇总)

### 5.3 评分等级

| 分数区间 | 等级 | 说明 |
|----------|------|------|
| 95-100 分 | 优秀 | 资源管理完善，无任何泄露风险 |
| 85-94 分 | 良好 | 仅存在少量轻微风险，无严重/致命问题 |
| 70-84 分 | 一般 | 存在严重级别泄露，需针对性修复 |
| 55-69 分 | 较差 | 存在致命级别泄露风险，内存安全受威胁 |
| <55 分 | 严重不足 | 多个致命泄露问题，内存风险极高，不可发布 |

### 5.4 报告生成

在 `{outputDir}` 下生成 `内存泄露检视报告.md`，报告必须包含 `**综合评分：XX/100**` 格式且位于"综合评分"章节，确保可被 `_parseRNLibraryScore` 函数正确解析。

> 报告模板和评分等级对照表参见 [报告模板](assets/REPORT_TEMPLATE.md)

**报告关键要求**：
- 泄露风险清单必须标注 **语言层**（ArkTS/C++/RN/跨语言）
- 每条泄露记录包含足够的定位信息（文件路径+行号）
- 扣分明细表按致命/严重/中等/轻微分类汇总

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 内存泄露检视报告 | `内存泄露检视报告.md` | 综合评分 + 扣分明细 + 9维度评分 + 泄露清单 + 修复建议 |

所有产物写入 `{outputDir}` 目录。

> ⚠️ **输出文件自检**：写入结果文件前，先确认 `内存泄露检视报告.md` 已存在且内容完整（**独立文件，禁止只写入 result 执行结果文件**）。若报告内容仅在草稿中，必须先将其保存为上述独立文件。

### 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将最终评分以下述 JSON 对象写入该路径：

```json
{
  "memoryLeakScore": 85,
  "scoreReason": "致命问题1处-20，资源未释放2处-16等（一句话判定依据，≤50字；触发一票否决时必须注明）"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `memoryLeakScore` | number | 内存泄露评分（0-100 整数，与报告中 `**综合评分：XX/100**` 的数值一致） |
| `scoreReason` | string | 评分判定依据摘要（可选，前端悬浮提示展示；0 分时强烈建议写明触发规则，如"关键路径致命问题触发归零"） |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取评分，无需解析报告文本）。若 prompt 未下发该路径则跳过本节。

---

## 评分权重

本 SKILL 在 RN 仓库检视综合评分中权重为 **20%**。

---

## 与前置/后置 SKILL 的衔接

- **前置依赖**：`rn-library-code-quality-check`（第4阶段）输出的 `编码质量检视报告.md`
- **后置输入**：本 SKILL 输出的 `内存泄露检视报告.md` 将作为后续阶段的参考输入

---

## 详细检查清单

> 完整的检查项、正例/反例代码示例和扣分细则见 [CHECKLIST.md](references/CHECKLIST.md)
