---
name: arkts-library-documentation-quality-check
description: 对已鸿蒙化的 ArkTS 库进行文档质量检视，覆盖完整性、准确性、易读性、代码级文档（JSDoc/TSDoc）和鸿蒙化专项五个维度，生成评分报告（0-100分）。作为 ArkTS 仓库检视流程的第五阶段使用，当需要审计鸿蒙化库的 README/API 文档质量或评估发版前文档覆盖率时使用。
license: Apache-2.0
compatibility: Requires access to Git repos and ability to read Markdown, ETS, TS, and JSON5 files
metadata:
  author: CPPAgent
  version: "4.1"
  category: harmonyos-development
---

# ArkTS 库文档质量检视技能

对**已鸿蒙化的 ArkTS 库**的文档质量进行检视，评估文档的完整性、准确性、易读性、代码级文档质量和鸿蒙化说明的充分性。

> ⚠️ **核心定位**：检视鸿蒙化库的**所有文档**，包括 README、API 文档、使用指南、CHANGELOG、代码内 JSDoc/TSDoc 注释等。文档质量直接影响库的可采纳性，缺失或不准确的文档等同于功能缺失。

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `repoUrl` | ✅ | Git 仓库地址 |
| `outputDir` | ✅ | 输出目录绝对路径 |
| `repoName` | ✅ | 仓库名称 |

---

## 输入依赖

- **前置 SKILL**: `arkts-library-interface-spec`（生成接口规格说明）
- **输入文件**: `接口规格说明.md`（位于 `outputDir`，提供公开接口列表）
- **仓库源码**: 已克隆到 `{outputDir}/source/`

---

## 工作流程概览

```
Phase 1: 文档范围识别（目录探测 → 全量扫描 → 鸿蒙化说明定位 → 文档分类映射）
    ↓
Phase 2: 逐文档五维度质量分析（完整性/准确性/易读性/代码级/鸿蒙化）
    ↓
Phase 3: 文档质量评分计算（维度加权 + 分级扣分 + 严苛保障）
    ↓
Phase 4: 报告生成（综合评分 + 问题清单 + 修复建议）
    ↓
Phase 5: 合规性自检（对照检查清单 + 校验脚本）
```

---

## Phase 1：文档范围识别

### 1.1 目录结构探测

先探明仓库的目录布局，为后续智能查找提供依据：

```bash
# 查看顶层目录结构
find {{outputDir}}/source -maxdepth 1 -type d | sort

# 查看前两层目录结构（识别文档目录、鸿蒙化目录、源码目录的位置）
find {{outputDir}}/source -maxdepth 2 -type d | sort
```

> `workdir: "{{outputDir}}"`

根据目录结构，智能识别以下关键目录的**实际位置**：

| 目录类型 | 常见名称候选 | 识别策略 |
|----------|-------------|----------|
| 文档目录 | `docs/`、`doc/`、`documentation/`、`api/`、`wiki/`、`guides/` | 优先选择含最多 .md 文件的目录；若无独立目录则文档在项目根 |
| 鸿蒙化目录 | `ohos/`、`harmony/`、`harmonyos/`、`openharmony/`、`ohosmodule/` | 含 oh-package.json5 或 ETS 源码的目录 |
| 源码目录 | `src/`、`entry/src/`、`src/main/ets/`、`src/main/ts/`、`lib/` | 含 .ets/.ts 且有 index.ets/index.ts 的目录 |
| 示例工程 | `example/`、`demo/`、`sample/`、`samples/`、`Entry/` | 含独立 oh-package.json5 的可运行工程 |

### 1.2 全量文件扫描

基于 1.1 的探测结果，扫描所有文档和源码文件：

```bash
# 文档文件（全量递归，不受目录层级限制）
find {{outputDir}}/source -type f \( -name "README*" -o -name "*.md" -o -name "*.txt" -o -name "*.rst" -o -name "CHANGELOG*" -o -name "*.json5" \)

# 源码文件（用于 JSDoc/TSDoc 检查和文档-代码一致性验证）
find {{outputDir}}/source -type f \( -name "*.ets" -o -name "*.ts" \)
```

### 1.3 鸿蒙化说明定位

鸿蒙化说明文档位置高度不固定，按以下优先级依次查找：

```bash
# 优先级 1：独立鸿蒙化 README（常见于 CPF 仓库）
find {{outputDir}}/source -maxdepth 1 -type f \( -name "README.OpenHarmony*" -o -name "README_OpenHarmony*" -o -name "README.Harmony*" -o -name "README_Harmony*" -o -name "README.ohos*" \)

# 优先级 2：鸿蒙化子目录中的 README
find {{outputDir}}/source -type f -path "*/ohos/README*" -o -path "*/harmony/README*" -o -path "*/harmonyos/README*" -o -path "*/openharmony/README*"

# 优先级 3：主 README 中的鸿蒙化章节（最后手段）
# 检查 README.md / README_zh.md 中是否包含 "鸿蒙"/"HarmonyOS"/"OpenHarmony" 等关键词的章节
grep -n -i -E '(鸿蒙|harmony|openharmony|ohos)' {{outputDir}}/source/README*.md 2>/dev/null | head -30
```

**判定规则**：取优先级最高的匹配结果作为鸿蒙化说明文档。若多个位置均存在，则全部纳入检视范围。

### 1.4 文档分类映射

将扫描到的文件按类别归类（不假设固定路径，依据文件名模式和内容特征判断）：

| 类别 | 识别模式 | 说明 |
|------|----------|------|
| 入口文档 | 文件名匹配 `README*` | 项目概览与入门；注意可能有多语言版本 |
| API 文档 | 位于文档目录下的 `.md` 文件，或文件名含 `api`/`interface`/`reference` | 公开接口说明；可能散布在多个目录 |
| 鸿蒙化说明 | 1.3 定位到的文件 | 鸿蒙适配说明；位置不固定，必须通过 1.3 专门定位 |
| 构建配置 | 文件名匹配 `oh-package.json5` / `build-profile.json5` / `hvigorfile.ts` | 依赖与构建说明；可在多级子目录 |
| 导出声明 | 文件名 `index.ets` / `index.ts`（排除 node_modules） | 模块导出文档；需识别实际导出入口 |
| 示例工程 | 含独立 `oh-package.json5` 的 example/demo/sample 目录 | 可运行示例；验证示例代码可运行性 |
| 代码注释 | `*.ets` / `*.ts` 中 JSDoc/TSDoc | 代码级文档；需过滤掉 node_modules 和第三方依赖 |

同时读取 `接口规格说明.md`，提取所有公开接口列表，用于评估文档覆盖率。

> 文档分类的完整检查清单参见 [参考文档](references/CHECK_DIMENSIONS.md)

### Phase 2：逐文档质量分析

对每个文档和源码文件进行**五维度**质量检视。各维度的完整检查项和判定标准参见 [references/CHECK_DIMENSIONS.md](references/CHECK_DIMENSIONS.md)（按需加载）。

| 维度 | 权重 | 核心关注 |
|------|------|----------|
| 文档完整性 | 30% | 关键文档是否缺失（README、鸿蒙化说明、API 文档、示例代码） |
| 文档准确性 | 25% | 文档描述与代码实现是否一致（API 签名、示例代码可运行性） |
| 文档易读性 | 15% | 结构、格式、语言是否规范 |
| 代码级文档质量 | 10% | JSDoc/TSDoc 注释是否完善 |
| 鸿蒙化文档专项 | 20% | 权限说明、差异对比、迁移指南、兼容性说明 |

**执行要点**：
- 对照 `接口规格说明.md` 的公开接口列表，逐个检查是否有文档覆盖
- 示例代码必须检查可运行性（导入路径、API 签名、异步处理）
- JSDoc 检查重点：导出函数/类是否有注释、参数/返回值是否描述、@ohos.* API 是否标注权限/版本
- 鸿蒙化专项重点：权限说明（Critical）、差异对比、迁移指南、兼容性范围

> 如需查询鸿蒙知识库补充检查标准，参见 [知识库查询指南](references/KB_QUERY_GUIDE.md)

### Phase 3：文档质量评分计算

基于检视结果进行**严苛评分**（0-100分），采用维度加权 + 分级扣分机制。评分公式和等级标准参见 [references/SCORING_FORMULA.md](references/SCORING_FORMULA.md)（按需加载）。

**快速参考**：

```
维度子评分 = max(0, 100 - Critical×15 - Major×8 - Minor×3)

综合评分 = max(0, round(
  完整性×0.30 + 准确性×0.25 + 易读性×0.15 + 代码级×0.10 + 鸿蒙化×0.20
))

严苛保障：≥3个Critical → 最高60分；≥1 Critical + ≥5 Major → 最高50分
```

### Phase 4：报告生成

在 `{outputDir}` 下生成 `文档质量检视报告.md`。报告模板参见 [assets/REPORT_TEMPLATE.md](assets/REPORT_TEMPLATE.md)，格式要求参见 [references/REPORT_TEMPLATE.md](references/REPORT_TEMPLATE.md)（按需加载）。

**关键格式要求**（后端自动解析依赖）：

1. 综合评分行格式：`**综合评分：数字/100**`（中文全角冒号 `：`）
2. 维度评分明细表紧随综合评分之后
3. 各维度详情末尾标注子评分

### Phase 5：合规性自检

报告生成后，对照 [references/COMPLIANCE_CHECKLIST.md](references/COMPLIANCE_CHECKLIST.md) 执行自检，确认：

- 五维度检视完整（无遗漏维度）
- 评分计算正确（维度加权 + 严苛保障）
- 报告格式合规（后端可自动解析）

可运行校验脚本进行自动化检查（跨平台，仅需 Node.js）：

```bash
node {skillDir}/scripts/validate-skill.cjs {skillDir}
```

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 文档质量检视报告 | `文档质量检视报告.md` | 综合评分 + 维度子评分 + 问题清单 + 修复建议 |

所有产物写入 `{outputDir}` 目录。

---

## 常见陷阱

- **示例代码可运行性**：导入路径错误（`import lottie from` vs `import { lottie } from`）是最常见的 Critical 问题
- **权限说明遗漏**：使用 @ohos.network 等系统 API 但未在文档中说明权限要求
- **文档-代码不一致**：README 描述的参数类型/返回值与源码实际签名不匹配
- **双 README 不同步**：README_zh.md 与 README.md 内容差异，需双向检查
- **隐含行为未文档化**：生命周期方法中的自动 API 调用（如 `aboutToDisappear` 调用 `destroy()`）容易遗漏
- **oh-package.json5 不是严格 JSON**：允许注释和尾逗号，不能按 JSON 解析
- **鸿蒙化文档位置不固定**：不要假设鸿蒙化说明在 `ohos/` 或 `harmony/` 下，必须通过 Phase 1 1.3 的三级优先级搜索定位；CPF 仓库常在项目根目录放 `README.OpenHarmony.md`，Gitee 仓库常用 `README_OpenHarmony.md`，部分仓库鸿蒙化说明嵌在主 README 的某个章节中
- **API 文档可能不在 docs/ 下**：部分库将 API 文档放在 `doc/`、`api/`、`documentation/`、`guides/` 或直接在项目根目录；必须基于目录探测结果动态识别，而非硬编码路径

---

## 综合评分权重

本 SKILL 在 ArkTS 仓库检视综合评分中权重为 **15%**。