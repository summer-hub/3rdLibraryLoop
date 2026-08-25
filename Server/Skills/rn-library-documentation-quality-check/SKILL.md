---
name: rn-library-documentation-quality-check
description: 对 RN 三方库的鸿蒙化代码进行文档质量检视，聚焦 source/ohos/ 下的 API 注释完整性、鸿蒙化适配说明、README/CHANGELOG 规范、代码示例质量、类型声明文档、国际化等维度，生成严苛评分报告（0-100分）。作为 RN 仓库检视流程的第六阶段。Use when 需要对 RN 鸿蒙化库进行文档质量评估、API 文档审查、适配说明完整性检查。
license: Apache-2.0
compatibility: 需要访问源码目录、分析文档和注释，读取 README/CHANGELOG/.d.ts 等文件；可选调用 MCP Gateway 的 gitcode_get_raw_file 获取外部文档
metadata:
  author: CPPAgent
  version: "4.0"
  stage: "6"
  weight: "10"
---

# RN 鸿蒙化库文档质量检视

对 RN 三方库的**鸿蒙化实现代码**进行文档质量检视，评估 API 文档完整性、鸿蒙化适配说明、README/CHANGELOG 规范、代码示例质量、类型声明文档、国际化等关键文档指标。

> ⚠️ **核心原则：不凭空捏造。** 所有检视结果必须基于实际读取到的文档和源码，禁止输出推测性结论。

> ⚠️ **核心定位**：本 SKILL **仅检视鸿蒙化版本的文档质量**，检视范围：源码 API 注释（TSDoc/JSDoc）、`.d.ts` 类型声明注释、README/CHANGELOG 文档、鸿蒙化适配说明、使用示例和集成指南、`module.json5` 权限与配置说明。

> ⚠️ **排除范围**：上游 RN 原库文档不在检视范围内，仅评估鸿蒙化新增/修改的文档内容。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `repoUrl` | string | ✅ | 鸿蒙化仓库地址 |
| `outputDir` | string | ✅ | 输出目录绝对路径 |
| `interfaceDocPath` | string | ✅ | 接口规格说明文档路径（通常为 `{outputDir}/接口规格说明.md`，由前置 `rn-library-interface-analyzer` 生成） |
| `repoName` | string | ✅ | 仓库名称 |
| `rndocUrl` | string | ❌ | 外部文档地址。当识别到跳转文档模式时，如果传入了 rndocUrl，优先使用 rndocUrl 下载文档，而非从 README 链接提取或构造标准 URL |

---

## 输入依赖

本 SKILL 是 RN 仓库检视流程的**第六阶段**，依赖：

- **前置 SKILL**: `rn-library-interface-analyzer`（第一阶段已生成接口规格说明文档）
- **前置 SKILL**: `rn-library-memory-leak-check`（内存泄露检视已完成）
- **输入文件**: `接口规格说明.md`、`内存泄露检视报告.md`（位于 outputDir）
- **仓库源码**: `{outputDir}/source/ohos/`
- **接口规格说明文档**（`{outputDir}/接口规格说明.md`）：包含完整的 API 列表、参数签名、鸿蒙化差异（缺失/新增/变更），是交叉验证的权威基准

---

## 工作流程概览

```
Phase 1: 文档文件定位与收集（识别内嵌/跳转模式，收集本地+外部文档）
    ↓
Phase 2: 逐维度文档质量检视（7大维度，按检查项清单逐一检视）
    ↓
Phase 2.5: 文档与接口规格交叉验证（强制环节，以接口规格说明为权威基准）
    ↓
Phase 3: 文档质量评分计算（维度加权扣分制，0-100分）
    ↓
Phase 4: 报告生成（六章节结构化报告）
```

---

## 检视维度与评分标准

### 维度权重分配

| 维度 | 权重 | 扣分上限 | 说明 |
|------|------|----------|------|
| API 文档完整性 | 20% | -20 | TSDoc/JSDoc 注释、参数/返回值/异常说明 |
| 鸿蒙化适配说明 | 20% | -20 | 适配说明文档、差异说明、平台限制 |
| 代码仓基础信息 | 15% | -15 | package.json 元数据、README 结构、LICENSE、发布配置 |
| 代码示例质量 | 10% | -10 | 示例可编译性、集成步骤、Demo |
| 变更记录与版本规范 | 10% | -10 | CHANGELOG、版本号、鸿蒙化变更 |
| 文档与代码交叉验证 | 15% | -15 | 文档接口与代码实现双向一致性、接口规格对齐 |
| 文档准确性与国际化 | 10% | -10 | 文档代码一致性、国际化支持 |

### 严重度定义

| 严重度 | 单项扣分 | 说明 |
|--------|----------|------|
| Critical | -8 | 文档严重缺失导致用户无法使用核心功能 |
| Major | -4 | 文档缺失或不规范，影响用户理解和使用 |
| Minor | -1 | 文档轻微不规范，不影响功能使用 |

### 归零规则

- 文档完全空白（无 README、无 API 注释、无任何示例）→ 评分直接 **0 分**
- 核心 TurboModule/NAPI 接口无任何文档说明 → 评分直接 **0 分**

> 各维度的详细检查项清单（编号 AD/DT/NP/NC/CE/TG/HA/RM/CF/EX/CL/AC/XC-xxx）参考 [references/CHECK_CHECKLIST.md](references/CHECK_CHECKLIST.md)（按需加载）。

---

## Phase 1：文档文件定位与收集

RN 三方库的文档存在**两种分布模式**，必须先识别模式再进行收集：

| 模式 | 特征 | 典型库 |
|------|------|--------|
| **内嵌文档** | README.md / README_zh.md 包含完整的安装、链接、接口说明、约束与限制 | `react-native-svg`、`react-native-linear-gradient` |
| **跳转文档** | README.md 极简（仅含包名+许可证），"文档"章节指向外部集中式文档仓库 | `react-native-network-info`、`react-native-device-info` |

### 步骤 1.1：识别文档模式

读取仓库根目录的 `README.md`，检查是否包含跳转特征（`OpenHarmony-RN/usage-docs` 链接等）。

### 步骤 1.2：收集本地文档文件

收集 `*.md`、`*.d.ts`、`*.json5`、`*.txt` 等文档文件。确认关键文件清单存在性。

### 步骤 1.3：收集外部跳转文档（跳转模式专属）

若识别为跳转模式，**必须**获取外部文档内容作为检视依据。获取优先级：**rndocUrl > README 链接提取 > 标准 URL 构造**。

> **MCP 工具可选**：若 MCP Gateway 可用，可调用 `gitcode_get_raw_file` 工具获取 GitCode 上的外部 usage-docs，比 curl 更可靠。

> 完整的文档收集流程、识别信号、文件分类规则、边界场景处理参见 [references/DOC_COLLECTION_GUIDE.md](references/DOC_COLLECTION_GUIDE.md)。

---

## Phase 2：逐维度文档质量检视

按维度 1-7 逐一检视，对每个发现的问题记录：

1. **严重度**：Critical / Major / Minor
2. **文件路径**：问题所在文件
3. **行号/位置**：问题在文件中的位置
4. **检查项编号**：AD/DT/NP/NC/CE/TG/HA/RM/CF/EX/CL/AC/XC-xxx
5. **问题描述**：缺少什么或存在什么问题
6. **修复建议**：具体的改进方案

**检视顺序建议**：README → .d.ts 文件 → 配置文件 → CHANGELOG 和示例

> 完整检查项清单参考 [references/CHECK_CHECKLIST.md](references/CHECK_CHECKLIST.md)。检视示例参考 [references/EXAMPLES.md](references/EXAMPLES.md)。

---

## Phase 2.5：文档与接口规格交叉验证（强制环节）

> ⚠️ **本环节为强制执行**，不可跳过。

以**前置 SKILL `RNLibraryInterfaceAnalyzer` 生成的接口规格说明文档**为权威基准，与用户文档（README/外部 usage-docs）中的 API 描述进行比对。

**核心步骤**：
1. **加载接口规格说明文档** — 从 `{outputDir}/接口规格说明.md` 提取 API 清单、签名、鸿蒙化差异
2. **从用户文档提取 API 清单** — 从 README/外部 usage-docs 提取文档声称的接口信息
3. **双向比对** — 规格→文档、文档→规格、签名与类型、鸿蒙化差异
4. **权限与配置比对** — module.json5 权限声明 vs 文档说明
5. **生成交叉验证差异报告** — 结构化表格输出

> 若接口规格说明文档不存在，记录 XC-001 Critical，跳过交叉验证，在报告中注明。

> 完整交叉验证流程、比对逻辑、差异分类参见 [references/CROSS_VALIDATION_GUIDE.md](references/CROSS_VALIDATION_GUIDE.md)。

---

## Phase 3：文档质量评分计算

基于检视结果进行**严苛评分**（0-100分），采用维度加权扣分制：

```
基础分 = 100

每个维度内扣分规则：
- Critical: 每项 -8 分
- Major: 每项 -4 分
- Minor: 每项 -1 分

维度实际扣分 = min(扣分上限, Critical扣分 + Major扣分 + Minor扣分)

归零检查：
- 文档完全空白 → 最终分 = 0
- 核心 TurboModule/NAPI 接口无任何文档说明 → 最终分 = 0

最终分 = max(0, 100 - 各维度实际扣分之和)
```

**评分等级**：90-100 优秀 | 80-89 良好 | 70-79 一般 | 60-69 较差 | 50-59 严重不足 | <50 极差

---

## Phase 4：报告生成

在 `{outputDir}` 下生成 `文档质量检视报告.md`，包含六个章节：检视概览、综合评分、各维度评分明细、检视维度详情、问题清单、改进建议。

> 完整报告模板和评分计算示例参考 [assets/REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md)。

**关键格式要求**：
- 报告必须包含 `**综合评分：XX/100**` 格式，位于"二、综合评分"章节
- 确保可被 `_parseRNLibraryScore` 函数正确解析
- 评分正则匹配优先级为 `综合评分` > `总体评分/评分` > `得分`

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 文档质量检视报告 | `文档质量检视报告.md` | 各维度评分明细 + 问题清单 + 修复建议 |

---

## 评分权重

本 SKILL 在 RN 仓库检视综合评分中权重为 **10%**。

---

## 常见陷阱（Gotchas）

以下为检视中最高频的 5 个陷阱，完整列表参见 [references/GOTCHAS.md](references/GOTCHAS.md)。

- **跳转文档模式误判为"文档缺失"**：跳转模式的 README 极简是设计选择，不应扣分为 RM-002/RM-004，应转而检视外部 usage-docs
- **async/Promise 返回类型遗漏**：文档写 `getConfig(): Config` 但代码为 `getConfig(): Promise<Config>`，是最常见的签名不一致
- **命名导出 vs 默认导出**：`export { lottie }` 是命名导出，示例必须用 `import { lottie }` 而非 `import lottie`
- **CHANGELOG 未记录鸿蒙化变更**：CHANGELOG 存在但仅含原库版本历史，无鸿蒙化适配条目
- **接口规格说明文档是权威基准**：交叉验证时直接使用，无需再从源码逐条提取

---

## 与前置/后置 SKILL 的衔接

- **前置依赖**：`rn-library-interface-analyzer`（第1阶段）输出的 `接口规格说明.md` — **交叉验证的权威基准**
- **前置依赖**：`rn-library-memory-leak-check`（第5阶段）输出的 `内存泄露检视报告.md`
- **后置输入**：本 SKILL 输出的 `文档质量检视报告.md` 将作为 `rn-library-test-coverage-check`（第7阶段）的输入依赖
- 确保报告中的问题清单包含足够的定位信息（文件路径+行号+检查项编号），便于后续 SKILL 参考和综合报告汇总

---

## 参考文件

| 文件 | 用途 | 加载时机 |
|------|------|----------|
| [references/CHECK_CHECKLIST.md](references/CHECK_CHECKLIST.md) | 各维度详细检查项清单与编号 | Phase 2 检视时按需加载 |
| [references/DOC_COLLECTION_GUIDE.md](references/DOC_COLLECTION_GUIDE.md) | 文档模式识别与收集完整流程 | Phase 1 文档收集时按需加载 |
| [references/CROSS_VALIDATION_GUIDE.md](references/CROSS_VALIDATION_GUIDE.md) | 交叉验证完整流程与比对方法 | Phase 2.5 交叉验证时按需加载 |
| [references/EXAMPLES.md](references/EXAMPLES.md) | 检视示例与常见场景 | 理解检视流程时按需加载 |
| [references/GOTCHAS.md](references/GOTCHAS.md) | 完整常见陷阱列表 | 检视过程中按需加载 |
| [assets/REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md) | 报告模板与评分计算示例 | Phase 4 报告生成时按需加载 |
| [assets/MODEL.md](assets/MODEL.md) | 中文文档模板规范 | 检视文档规范性时按需加载 |
| [assets/MODEL_en.md](assets/MODEL_en.md) | 英文文档模板规范 | 检视英文文档规范性时按需加载 |
