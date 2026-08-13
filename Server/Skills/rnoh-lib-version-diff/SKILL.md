---
name: rnoh-lib-version-diff
description: >-
  用于 RN 鸿蒙三方库升级适配：版本分析与差异生成。
  从鸿蒙化仓库 git URL 出发，自动提取上游基线版本、查询 npm 最新版本、判定升级类型，
  通过两阶段 diff 流程（全量生成 + AI 筛选精简）生成 JS 层接口差异文档并输出结构化适配检查清单。
  当用户需要分析某个 RN 三方库的鸿蒙化版本与上游最新版本的差距、判断是否需要原生适配、
  对比上游两个版本之间的 JS 接口变更时使用。典型场景：用户提供了鸿蒙化仓库的 git URL
  （如 gitcode.com/CPF-RN/rntpc_xxx），想升级到新的 RNOH 版本（如 0.84），
  需要先搞清楚当前鸿蒙化基线版本是多少、上游最新版本是多少、JS 层接口有哪些变更。
  也适用于：使用 devecocli docs search 核查鸿蒙 API 可行性、生成版本对比报告
  供后续代码适配阶段使用。
license: MIT
compatibility: 需要 git、node、npm，以及网络访问能力（用于查询 npm registry 和克隆上游仓库）；鸿蒙 API 核查需 devecocli CLI
allowed-tools: Bash Read Grep Glob Write
metadata:
  author: rnoh-team
  version: "3.0"
  phase: "1-of-4"
---

# RN 鸿蒙三方库版本分析与差异生成

分析 RN 鸿蒙三方库的上游版本变更。通过对比两个版本的 JS 层接口契约（导出、TurboModule Spec），判断鸿蒙侧是否需要原生适配。

## 目录结构

```
{SKILL_DIR}/
├── SKILL.md
├── scripts/
│   ├── detect-upstream-version.js   # 提取基线版本 + 查询 npm 最新版本
│   ├── generate-diff.js             # 两阶段 diff 生成（全量 + 精简）
│   └── scan-exports.js              # 扫描 JS 导出接口 + TurboModule Spec
├── references/
│   ├── OHOS_API_LOOKUP.md           # 鸿蒙 API 核查流程（devecocli docs search）
│   ├── OHOS_ADAPTATION.md           # 鸿蒙化适配判断规则
│   └── script-reference.md          # 脚本参数与用法详解
└── templates/
    └── report-template.md           # 版本分析报告模板
```

## 何时使用

- 用户提供了一个 RN 鸿蒙三方库的 git 仓库 URL，想要升级到新的 RNOH 版本。
- 用户想知道某个鸿蒙化三方库当前基于上游哪个版本、上游最新版本是多少、差距多大。
- 用户需要判断是否需要原生（ETS/C++）适配，还是只需合并 JS 代码 + 重新 codegen。

## 最小必要输入

- **必要**：鸿蒙化仓库的 git URL（如 `https://gitcode.com/CPF-RN/rntpc_lottie-turbo-react-native`）
- **必要**：目标 RNOH 版本号（如 `0.84`），用于确定分支名（通常为 `br_rnoh0.84`）
- **有帮助**：上游 npm 包名（如不知道会自动推断）
- **有帮助**：已知的当前基线版本号（如不知道会自动检测）

## 工作流程

```
Step 1: 提取基线版本 + 查询 npm 最新版本
Step 2: 升级类型判定（A/B/C）
Step 3: 检查目标分支是否存在
Step 4: 两阶段 diff 生成（仅类型 A）
  Phase 1: 生成全量文件变更清单 + 接口差异分析
  Phase 2: AI 筛选相关文件 → 生成精简 patch
Step 5: 鸿蒙 API 核查（仅涉及原生能力时）
Step 6: 生成版本分析报告
```

---

## Step 1：提取基线版本

### 如果已指定基线版本和目标版本

直接记录，跳到 Step 2。仅需从 `README.OpenSource` 文件获取上游仓库 URL：

```bash
# 查看 README.OpenSource 获取 Upstream URL
cat <鸿蒙化仓库>/README.OpenSource
```

### 如果未指定基线版本

```bash
node scripts/detect-upstream-version.js <git-repo-url>
```

脚本自动完成：解析 git URL → 获取 package.json → 从 `harmony.alias` 匹配上游包名 → 查询 npm registry 获取 `dist-tags.latest`。

**回退方案**：如果脚本输出"未找到匹配的上游版本号"，检查仓库根目录的 `README.OpenSource` 文件——其中包含 `Version Number` 和 `Upstream URL` 字段，比 package.json 依赖列表更可靠（鸿蒙化仓库会用 `@react-native-ohos/` 前缀替换上游包名）。

记录以下信息：基线版本、npm 最新版本、版本状态（落后/最新/超前）、上游仓库 URL。

---

## Step 2：升级类型判定

| 版本状态 | 升级类型 | 后续动作 |
|----------|----------|----------|
| 落后 (behind) | **类型 A：上游版本升级 + 框架适配** | 执行 Step 4 |
| 最新 (latest) | **类型 B：纯框架版本适配** | 跳过 Step 4 |
| 超前 (ahead) | **类型 C：特殊情况** | 人工排查 |

**核心原则**：只有类型 A 需要生成 diff。类型 B 意味着 JS 层未变更——只需更新 RNOH 框架版本 + 重新 codegen。

---

## Step 3：检查目标分支

```bash
git ls-remote --heads <鸿蒙化仓库URL>
```

如果 `br_rnoh0.84` 分支不存在，使用已有的最高版本分支（如 `br_rnoh0.82`）作为起点，在报告中标注需要跨版本升级。

---

## Step 4：两阶段 diff 生成（仅类型 A）

### 版本标签格式

| 格式 | 示例 | 适用场景 |
|------|------|----------|
| `v` + 版本号 | `v7.2.2`, `v7.4.0` | 大多数非 scoped 包 |
| 纯版本号 | `7.2.2`, `7.4.0` | 部分仓库 |
| `@scope/name@version` | `@react-native-async-storage/async-storage@3.1.1` | **scoped 包**（`@scope/` 前缀） |
| commit hash | `a1b2c3d` | 无标签的仓库 |

如果不确定标签格式，先查看可用标签：

```bash
git ls-remote --tags <上游仓库URL>
```

### Phase 1：生成全量 diff + 接口差异分析

```bash
node scripts/generate-diff.js \
  --repo <上游仓库URL> \
  --branch1 <基线版本标签> \
  --branch2 <目标版本标签> \
  --find-renames 30 \
  --output-dir <输出目录>
```

生成 4 个文件：

| 文件 | 说明 |
|------|------|
| `diff_*.patch` | 全量 diff 补丁（仅 JS 层，已排除原生平台代码） |
| `summary_*.md` | 文件变更摘要（按文件统计增删行数） |
| `structure_*.md` | 适配分析报告（以接口差异为锚点：接口未变更→只需合并 JS；接口变更→按变更项展开 + 文件计数） |
| `api-diff_*.md` | 接口差异适配检查清单（每个变更项含 checkbox、方法签名、适配动作） |

其中 `structure_*.md` 和 `api-diff_*.md` 由脚本内部调用 `scan-exports.js` 对比两个版本的 JS 导出和 TurboModule Spec 自动生成。

**核心逻辑**：如果 JS 层接口未变更 → "无需原生适配，只需合并 JS + codegen"。如果接口变更 → 列出每个变更的方法及其签名作为适配检查项。

### Phase 2：AI 筛选相关文件 → 生成精简 patch

Phase 1 的全量 patch 可能仍包含与适配无关的文件（已删除的包、示例代码、配置文件等）。Phase 2 通过 AI 筛选：

1. **阅读** `structure_*.md` 和 `api-diff_*.md`，理解哪些接口发生了变更
2. **阅读** `summary_*.md`，查看完整的文件变更列表（路径 + 增删行数）
3. **AI 判断**：对变更列表中的每个文件，判断是否与接口变更相关：
   - **包含**：实现变更接口的 JS/TS 源码文件、TurboModule Spec 文件、含 codegenConfig 的 package.json
   - **排除**：已删除的包、示例代码、文档、CI 配置、构建脚本、原生平台代码
4. **写入** 筛选后的文件列表到 `relevant-files.txt`（每行一个路径）
5. **生成精简 patch**：

```bash
node scripts/generate-diff.js \
  --repo <上游仓库URL> \
  --branch1 <基线版本标签> \
  --branch2 <目标版本标签> \
  --files relevant-files.txt \
  --output-dir <输出目录>
```

生成的 `diff_*.patch` 只包含相关文件（通常缩小 70-90%）。

**AI 筛选标准**：
- 如果 TurboModule Spec 变更 → 包含所有新旧 Spec 文件（看新增了什么、移除了什么）
- 如果公共接口变更 → 包含定义/实现该接口的文件
- 如果导出变更 → 包含入口文件（index.ts/tsx）
- 始终包含含 codegenConfig 变更的 package.json
- 绝不包含：example/、docs/、.github/、原生平台目录、已删除的包目录

---

## Step 5：鸿蒙 API 核查

当接口变更涉及原生能力（存储、相机、蓝牙等）时，使用 `devecocli docs search` 核查 OHOS API 可行性后再下结论。

```bash
devecocli docs search "<关键词>" --catalog harmonyos-references --limit 10
```

完整核查流程见 [references/OHOS_API_LOOKUP.md](references/OHOS_API_LOOKUP.md)。

---

## Step 6：生成版本分析报告

使用 [templates/report-template.md](templates/report-template.md) 模板生成结构化版本分析报告。

风险等级：
- 🟢 低风险：仅补丁版本差距，无 breaking change
- 🟡 中风险：小版本差距，有 API 变更但向后兼容
- 🔴 高风险：大版本差距，有 breaking change 或原生层重构

适配判断规则见 [references/OHOS_ADAPTATION.md](references/OHOS_ADAPTATION.md)。

---

## 常见边界情况

### detect-upstream-version.js 无法匹配包名

检查仓库根目录的 `README.OpenSource` 文件——其中包含 `Version Number` 和 `Upstream URL` 字段，比 package.json 依赖列表更可靠。

### monorepo 包重命名场景

使用 `--find-renames 30` 检测跨目录文件移动。`structure_*.md` 报告会展示文件移动（旧路径 → 新路径）。

### scan-exports.js 在 monorepo 中找不到入口文件

如果仓库是 monorepo 结构，`scan-exports.js` 可能需要指定子包目录。直接运行：

```bash
node scripts/scan-exports.js --compare \
  <分支1目录>/packages/<包名> \
  <分支2目录>/packages/<包名> \
  --output api-diff.md
```

### devecocli 未安装

尝试 `ohpm install -g @ohos/deveco-cli` 或通过 DevEco Studio 安装。也可使用 MCP 工具 `script_deveco_docs`（如果可用）。

---

## 输出物清单

### 类型 A（上游版本升级 + 框架适配）

1. **版本分析报告**（Markdown）— 版本差距、风险评估、适配检查清单
2. **精简 diff patch**（`diff_*.patch`）— 只包含相关 JS 文件，供 code-adapt skill 使用
3. **接口差异检查清单**（`api-diff_*.md`）— 每个接口变更含 checkbox，指导适配
4. **适配分析报告**（`structure_*.md`）— 接口驱动的分析 + 文件计数
5. **源码目录** — 两个版本的源码导出，供参考

### 类型 B（纯框架版本适配）

1. **版本分析报告** — 版本状态（最新）、RNOH 框架版本对比、codegen 说明
2. 无 diff/summary/structure 文件（上游未变更）
