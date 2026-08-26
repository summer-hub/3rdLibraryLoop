---
name: arkts-library-memory-leak-check
description: 对 ArkTS 鸿蒙化库进行内存泄露检视，聚焦 ArkTS/ETS 与 C/C++ NAPI 绑定代码中的生命周期管理、系统资源释放、NAPI 引用管理、事件订阅管理、闭包与上下文泄露等维度，识别潜在内存泄露风险，生成严苛评分报告（0-100分）。作为 ArkTS 仓库检视流程的第四阶段。
license: Apache-2.0
compatibility: 需要访问 Git 仓库、分析 ArkTS/ETS 及 C/C++ NAPI 绑定源码
metadata:
  author: CPPAgent
  version: "1.0.0"
---

# ArktsLibraryMemoryLeakCheckSkill

对**已鸿蒙化的 ArkTS 库**进行内存泄露风险检视，识别 ArkTS/ETS 层与 C/C++ NAPI 绑定层代码中的潜在内存泄露问题，评估资源管理安全性。

> ⚠️ **核心定位**：ArkTS 鸿蒙化库的内存泄露检视，**覆盖 ArkTS/ETS 层与 C/C++ NAPI 绑定层**，重点关注生命周期管理、系统资源释放、NAPI 引用管理、闭包上下文泄露、跨语言资源释放一致性等问题。

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

本 SKILL 是 ArkTS 仓库检视流程的**第四阶段**，依赖：

- **前置 SKILL**: `arkts-library-interface-spec`（接口规格说明已生成）
- **输入文件**: `接口规格说明.md`（位于 outputDir）；`编码质量检视报告.md` 为**可选参考**（若本地流程无编码质量检视 SKILL，跳过该参考，独立完成检视）
- **仓库源码**: 已克隆到 `{outputDir}/source/`

> 💡 **利用前置报告**：参考编码质量检视报告中标记的架构问题和代码规范问题，重点关注其中涉及的资源管理相关代码段。

---

## 工作流程

### Phase 1：源码范围识别

**分层扫描**仓库中的鸿蒙化代码文件：

1. **ArkTS/ETS 层**：扫描 `.ets`、`.ts`、`.json5` 文件
2. **C/C++ NAPI 绑定层**：扫描 `.cpp`、`.c`、`.h`、`.hpp` 文件（重点关注 NAPI 绑定入口）

**⚠️ 排除范围规则**：仅检视库的**核心源码**，以下目录和文件必须排除，不纳入内存泄露分析：

| 排除类别 | 目录/文件特征 | 说明 |
|----------|--------------|------|
| Demo/示例用例 | `demo/`、`example/`、`examples/`、`sample/`、`samples/` 目录，文件名含 `demo`、`example`、`sample` | 示例代码仅用于演示库用法，不属于库的核心实现 |
| 单元测试 | `test/`、`tests/`、`__tests__/`、`spec/`、`unittest/` 目录，文件名含 `test`、`spec`、`unittest` | 测试代码验证库功能而非生产运行，其资源管理模式与核心源码不同 |
| 集成测试 | `integration-test/`、`e2e/`、`itest/` 目录 | 同上，非核心源码 |
| 测试工具/辅助 | `mock/`、`fixture/`、`stub/`、`fuzz/` 目录 | 测试辅助代码不属于库运行时逻辑 |

> **原则**：核心源码指库在**生产运行时**实际执行的代码，即被外部应用调用的公开 API 实现、内部模块逻辑、NAPI 绑定层。Demo 和测试代码中即使存在资源管理问题，也不影响库的实际运行安全性，因此不应纳入检视和评分。

```bash
# ArkTS/ETS 层（排除 demo 与测试）
find {{outputDir}}/source -type f \( -name "*.ets" -o -name "*.ts" -o -name "*.json5" \) \
  -not -path "*/demo/*" -not -path "*/example/*" -not -path "*/examples/*" \
  -not -path "*/sample/*" -not -path "*/samples/*" \
  -not -path "*/test/*" -not -path "*/tests/*" -not -path "*/__tests__/*" \
  -not -path "*/spec/*" -not -path "*/unittest/*" \
  -not -path "*/integration-test/*" -not -path "*/e2e/*" \
  -not -path "*/mock/*" -not -path "*/fixture/*" \
  -not -path "*/fuzz/*" -not -path "*/stub/*" \
  -not -name "*demo*" -not -name "*example*" -not -name "*sample*" \
  -not -name "*test*" -not -name "*spec*" -not -name "*unittest*"

# C/C++ NAPI 绑定层（排除 demo 与测试）
find {{outputDir}}/source -type f \( -name "*.cpp" -o -name "*.c" -o -name "*.h" -o -name "*.hpp" \) \
  -not -path "*/demo/*" -not -path "*/example/*" -not -path "*/examples/*" \
  -not -path "*/sample/*" -not -path "*/samples/*" \
  -not -path "*/test/*" -not -path "*/tests/*" -not -path "*/unittest/*" \
  -not -path "*/integration-test/*" -not -path "*/e2e/*" \
  -not -path "*/mock/*" -not -path "*/fixture/*" \
  -not -path "*/fuzz/*" -not -path "*/stub/*" \
  -not -name "*demo*" -not -name "*example*" -not -name "*sample*" \
  -not -name "*test*" -not -name "*unittest*" \
  | xargs grep -l "napi_" 2>/dev/null || true
```

> `workdir: "{{outputDir}}"`

### Phase 2：逐文件内存泄露分析

对每个源码文件进行内存泄露检视，重点关注以下 7 个维度：

#### 2.1 ArkTS 生命周期管理

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| aboutToDisappear 未清理 | Critical | 组件销毁时未释放资源/移除监听/断开连接 |
| @State 大对象泄露 | Major | @State 变量持有大对象引用（如大数组/Map），组件销毁后未主动置空 |
| @Link/@Prop 双向绑定泄露 | Major | 双向绑定在组件销毁后未断开，父组件仍持有子组件引用 |
| 页面栈泄露 | Major | router.pushUrl 后未调用 router.back，页面未正确弹出 |
| PersistentStorage 泄露 | Minor | 持久化存储键未在组件销毁时清理 |
| CustomComponent 引用泄露 | Major | 父组件通过引用持有已销毁子组件实例 |

#### 2.2 系统资源释放

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| Sensor 未注销 | Critical | sensor.on() 后无对应 sensor.off() |
| Location 未关闭 | Critical | geoLocationManager 开启后未关闭 |
| Network 连接未断开 | Major | HTTP/WebSocket 连接未调用 disconnect/close |
| Timer 未清除 | Major | setInterval/setTimeout 未在生命周期结束时 clearInterval/clearTimeout |
| Worker 未终止 | Major | Worker 创建后未调用 terminate |
| Bitmap/Image 未释放 | Major | 图片资源未调用 recycle/release |
| media.AVPlayer 未释放 | Major | AVPlayer 创建后未调用 release |
| webview.WebView 未销毁 | Major | WebView 未正确销毁，可能持有 JS 上下文引用 |
| XMLParser/JSONParser 未释放 | Minor | 解析器资源未释放 |
| 数据库连接未关闭 | Critical | rdb 关闭未调用 close |

#### 2.3 事件订阅管理

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| CommonEvent 未取消订阅 | Critical | emitter.subscribe/on() 后无 unsubscribe/off() |
| Callback 未移除 | Major | 注册的回调在组件销毁时未移除 |
| Listener on/off 不匹配 | Major | on/off 注册与移除次数不匹配 |
| 全局事件泄露 | Critical | 全局事件订阅未在组件生命周期中管理 |
| emitter 持久订阅泄露 | Major | emitter.on() 使用 Persistent 选项但无取消机制 |

#### 2.4 闭包与上下文泄露

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| 闭包持有组件引用 | Major | 闭包捕获 this/组件引用，组件销毁后闭包仍存活 |
| 全局回调持有组件上下文 | Critical | 全局注册的回调函数持有组件实例引用 |
| 异步回调持有 stale context | Major | setTimeout/Promise 回调中引用已销毁组件上下文 |
| 静态大对象缓存泄露 | Minor | 全局 Map/Array/缓存未在适当时机清理 |

#### 2.5 NAPI 引用管理（ArkTS 层视角）

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| napi_create_reference 未释放 | Critical | napi_create_reference 后无 napi_delete_reference |
| napi_handle_scope 泄露 | Major | napi_open_handle_scope 后无 napi_close_handle_scope |
| napi_callback_info 泄露 | Minor | 回调信息未正确处理释放 |
| ArrayBuffer 外部资源泄露 | Major | napi_create_external ArrayBuffer 的 finalize 回调缺失或未正确释放 |

#### 2.6 C/C++ 层内存泄露

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| malloc/free 不匹配 | Critical | malloc 后无 free，或 calloc/realloc 后未释放 |
| new/delete 不匹配 | Critical | new 后无 delete，new[] 后用 delete（而非 delete[]） |
| 智能指针循环引用 | Critical | shared_ptr 循环引用导致引用计数永不为零 |
| NAPI Native 对象泄露 | Critical | napi_wrap 包装的 Native 对象在 finalize 中未释放 |
| 智能指针误用 | Major | unique_ptr 被 raw pointer 接管后未管理 |
| 全局/静态缓冲区无限增长 | Major | 全局 vector/map 无上限增长，缺少清理机制 |
| RAII 覆盖不全 | Major | 未使用 RAII 管理 C++ 资源（如文件句柄、锁） |
| 内存池未释放 | Minor | 自定义内存池/allocator 未在析构时释放 |

#### 2.7 跨语言资源释放一致性

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| ArkTS on/C++ resource 不对称释放 | Critical | ArkTS 层调用 off() 但 C++ 层未释放对应资源，或反过来 |
| Native 对象生命周期不一致 | Critical | C++ Native 对象与 ArkTS 包装对象生命周期不一致 |
| finalize 回调缺失 | Critical | napi_wrap 未提供 finalize 回调，Native 对象无法被回收 |
| 跨语言回调链泄露 | Major | C++ 层回调引用 ArkTS 函数，双向引用未正确断开 |

### Phase 3：内存泄露评分计算

基于检视结果进行**严苛评分**（0-100分），采用维度加权扣分与零容忍规则：

#### 3.1 扣分规则

```
基础分 = 100

标准扣分（按问题数量叠加）：
- Critical 级别问题：每项 -20 分（上限 -60）
- Major 级别问题：每项 -10 分（上限 -40）
- Minor 级别问题：每项 -4 分（上限 -16）

零容忍加重扣分（叠加于标准扣分之上）：
- napi_ref/NAPI finalize 缺失：每项额外 -5 分（上限 -15）
- malloc/free 或 new/delete 不匹配：每项额外 -5 分（上限 -15）
- 闭包持有组件引用 + 全局事件泄露组合：额外 -10 分（上限 -10）

最终分 = max(0, 基础分 - 标准扣分 - 零容忍加重扣分)
```

#### 3.2 维度子评分计算

每个维度独立计算子评分（用于报告中明细展示）：

```
维度基础分 = 100
维度扣分：
  - 该维度 Critical 问题：每项 -20（上限 -60）
  - 该维度 Major 问题：每项 -10（上限 -40）
  - 该维度 Minor 问题：每项 -4（上限 -16）
维度分 = max(0, 维度基础分 - 维度扣分)
```

#### 3.3 综合评分 = 各维度子评分加权平均

```
综合评分 = (
  生命周期管理分 × 0.15 +
  系统资源释放分 × 0.20 +
  事件订阅管理分 × 0.15 +
  闭包与上下文泄露分 × 0.10 +
  NAPI 引用管理分 × 0.15 +
  C/C++ 层内存泄露分 × 0.20 +
  跨语言一致性分 × 0.05
)
```

> **重要**：当综合评分与"基础分 - 总扣分"不一致时，取两者中的**较低值**作为最终综合评分。这确保了零容忍加重扣分和维度加权不会导致评分偏高。

#### 3.4 评分标准说明

| 分数区间 | 等级 | 说明 |
|----------|------|------|
| 95-100 分 | 优秀 | 资源管理完善，无任何泄露风险 |
| 85-94 分 | 良好 | 仅存在少量 Minor 级别风险，无 Major/Critical 问题 |
| 70-84 分 | 一般 | 存在 Major 级别泄露，需针对性修复 |
| 55-69 分 | 较差 | 存在 Critical 级别泄露风险，内存安全受威胁 |
| <55 分 | 严重不足 | 多个 Critical 泄露问题，内存风险极高，不可发布 |

> ⚠️ **严苛标准**：内存泄露不同于一般代码质量问题，一旦发生即造成持续损害。因此 85 分以下即不建议发布，55 分以下视为严重不可用。

### Phase 4：报告生成

在 `{outputDir}` 下生成 `内存泄露检视报告.md`，格式如下：

```markdown
# {repoName} 内存泄露检视报告

## 一、检视概览

| 字段 | 内容 |
|------|------|
| **仓库名称** | {repoName} |
| **检视类型** | ArkTS 内存泄露检视 |
| **检视时间** | {timestamp} |
| **分析文件数（ArkTS层）** | {etsFileCount} |
| **分析文件数（C/C++层）** | {cppFileCount} |

## 二、综合评分

**综合评分：{score}/100**

> 评分等级：{level}。{levelDescription}

### 扣分明细

| 扣分项 | 数量 | 单项扣分 | 小计 | 上限 |
|--------|------|----------|------|------|
| Critical 标准扣分 | {criticalCount} | -20 | {criticalTotal} | -60 |
| Major 标准扣分 | {majorCount} | -10 | {majorTotal} | -40 |
| Minor 标准扣分 | {minorCount} | -4 | {minorTotal} | -16 |
| napi_ref/finalize 零容忍加重 | {napiCriticalCount} | -5 | {napiExtraTotal} | -15 |
| malloc/new 零容忍加重 | {memCriticalCount} | -5 | {memExtraTotal} | -15 |
| 闭包+全局事件组合加重 | {comboCount} | -10 | {comboExtraTotal} | -10 |

## 三、检视维度明细

### 3.1 ArkTS 生命周期管理

**维度评分：{dim1Score}/100**

| 检查项 | 严重度 | 发现数量 | 详情 |
|--------|--------|----------|------|
| …… | …… | …… | …… |

### 3.2 系统资源释放

**维度评分：{dim2Score}/100**

| 检查项 | 严重度 | 发现数量 | 详情 |
|--------|--------|----------|------|
| …… | …… | …… | …… |

### 3.3 事件订阅管理

**维度评分：{dim3Score}/100**

| 检查项 | 严重度 | 发现数量 | 详情 |
|--------|--------|----------|------|
| …… | …… | …… | …… |

### 3.4 闭包与上下文泄露

**维度评分：{dim4Score}/100**

| 检查项 | 严重度 | 发现数量 | 详情 |
|--------|--------|----------|------|
| …… | …… | …… | …… |

### 3.5 NAPI 引用管理

**维度评分：{dim5Score}/100**

| 检查项 | 严重度 | 发现数量 | 详情 |
|--------|--------|----------|------|
| …… | …… | …… | …… |

### 3.6 C/C++ 层内存泄露

**维度评分：{dim6Score}/100**

| 检查项 | 严重度 | 发现数量 | 详情 |
|--------|--------|----------|------|
| …… | …… | …… | …… |

### 3.7 跨语言资源释放一致性

**维度评分：{dim7Score}/100**

| 检查项 | 严重度 | 发现数量 | 详情 |
|--------|--------|----------|------|
| …… | …… | …… | …… |

## 四、泄露风险清单

| # | 文件 | 行号 | 语言层 | 严重度 | 泄露类型 | 泄露描述 | 影响范围 | 修复建议 |
|---|------|------|--------|--------|----------|----------|----------|----------|
| …… | …… | …… | ArkTS/C++ | …… | …… | …… | …… | …… |

> **语言层**列标注问题所在的代码层：`ArkTS`（ETS/TS 层）或 `C++`（Native 层）或 `跨语言`（涉及两层交互）。

## 五、改进建议

### 5.1 Critical 级别修复优先级

（列出所有 Critical 问题的修复建议，按影响排序）

### 5.2 Major 级别修复建议

……

### 5.3 通用改进方案

……

---

**报告生成时间**：{timestamp}
```

> **重要**：
> 1. 报告必须包含 `**综合评分：XX/100**` 格式，以便后端 `_parseArktsLibraryScore` 函数自动解析评分。
> 2. 每个维度必须包含 `**维度评分：XX/100**` 格式。
> 3. 泄露风险清单必须标注 **语言层**（ArkTS/C++/跨语言）。

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 内存泄露检视报告 | `内存泄露检视报告.md` | 综合评分 + 扣分明细 + 7维度评分 + 泄露清单 + 修复建议 |

所有产物写入 `{outputDir}` 目录。

> ⚠️ **输出文件自检**：写入结果文件前，先确认 `内存泄露检视报告.md` 已存在且内容完整（**独立文件，禁止只写入 result 执行结果文件**）。若报告内容仅在草稿中，必须先将其保存为上述独立文件。

### 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将最终评分以下述 JSON 对象写入该路径：

```json
{
  "memoryLeakScore": 85,
  "scoreReason": "Critical泄露1处-20等（一句话判定依据，≤50字；触发零容忍规则时必须注明）"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `memoryLeakScore` | number | 内存泄露评分（0-100 整数，与报告中 `**综合评分：XX/100**` 的数值一致） |
| `scoreReason` | string | 评分判定依据摘要（可选，前端悬浮提示展示；0 分时强烈建议写明触发的扣分/零容忍规则） |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取评分，无需解析报告文本）。若 prompt 未下发该路径则跳过本节。

---

## 评分权重

本 SKILL 在 ArkTS 仓库检视综合评分中权重为 **25%**。