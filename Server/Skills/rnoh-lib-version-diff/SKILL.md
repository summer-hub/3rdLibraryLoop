---
name: rnoh-lib-version-diff
description: >-
  用于 RN 鸿蒙三方库升级适配：版本分析与差异生成。
  从鸿蒙化仓库 git URL 出发，自动提取上游基线版本、查询 npm 最新版本、判定升级类型，
  按需生成上游版本差异文档并输出结构化版本分析报告。当用户需要分析某个 RN 三方库的
  鸿蒙化版本与上游最新版本的差距、对比上游两个版本之间的修改、评估升级风险等级、
  批量检测版本落后情况时使用。典型场景：用户提供了鸿蒙化仓库的 git URL
  （如 gitcode.com/CPF-RN/rntpc_xxx），想升级到新的 RNOH 版本（如 0.84），
  需要先搞清楚当前鸿蒙化基线版本是多少、上游最新版本是多少、两者之间有哪些变更。
  也适用于：使用 devecocli docs search 核查鸿蒙 API 可行性、生成版本对比报告
  供后续代码适配阶段使用。
compatibility: 需要 git、node、npm，以及网络访问能力（用于查询 npm registry 和克隆上游仓库）；鸿蒙 API 核查需 devecocli CLI
allowed-tools: Bash Read Grep Glob Write
metadata:
  author: rnoh-team
  version: "2.0"
  phase: "1-of-4"
---

# RN 鸿蒙三方库版本分析与差异生成

## 路径约定

`{SKILL_DIR}` = 本技能根目录（本 SKILL.md 所在目录）。`{SKILLS_ROOT}` = 技能共用父目录（`{SKILL_DIR}/..`，可用环境变量 `SKILLS_ROOT` 覆盖）。命令均在 `{SKILL_DIR}` 下执行，使用 `scripts/...` 相对路径。

## 目录结构

```
{SKILL_DIR}/
├── SKILL.md
├── scripts/
│   ├── detect-upstream-version.js   # 提取基线版本 + 查询 npm 最新版本
│   └── generate-diff.js             # 上游版本差异生成
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
- 用户需要生成上游两个版本之间的代码差异文档，作为后续适配修改的依据。
- 用户想批量评估多个三方库的版本落后情况，决定升级优先级。

## 最小必要输入

- **必要**：鸿蒙化仓库的 git URL（如 `https://gitcode.com/CPF-RN/rntpc_lottie-turbo-react-native`）
- **必要**：目标 RNOH 版本号（如 `0.84`），用于确定分支名（通常为 `br_rnoh0.84`）
- **有帮助**：上游 npm 包名（如不知道会自动推断）
- **有帮助**：已知的当前基线版本号（如不知道会自动检测）

如果用户只提供了仓库名没有提供完整 URL，尝试拼接 `https://gitcode.com/CPF-RN/<仓库名>`。

## 进度清单

```
- [ ] Step 1: 提取基线版本 + 查询 npm 最新版本
- [ ] Step 2: 升级类型判定（A/B/C）
- [ ] Step 3: 检查目标分支是否存在
- [ ] Step 4: 生成上游版本差异文档（仅类型 A）
- [ ] Step 5: 鸿蒙 API 核查（devecocli docs search，仅涉及原生能力时）
- [ ] Step 6: 生成版本分析报告
```

---

## Step 1：提取基线版本与上游最新版本

使用 `detect-upstream-version.js` 脚本从鸿蒙化仓库的 package.json 中提取上游依赖版本，并查询 npm registry 获取最新版本。

```bash
# 普通模式：输出详细信息
node scripts/detect-upstream-version.js <git-repo-url>

# quiet 模式：输出 "当前版本 最新版本 状态 最近10个版本"
node scripts/detect-upstream-version.js -q <git-repo-url>
```

脚本会自动完成：
1. 解析 git URL，提取平台、owner、repo、分支
2. 获取仓库 package.json（先尝试 raw URL，回退到 API，最终回退到 git clone）
3. 从 package.json 的 `harmony.alias` 或依赖列表中匹配上游包名和版本
4. 查询 npm registry 获取 `dist-tags.latest` 和最近 10 个版本
5. 比较版本差距，输出状态（最新/落后/超前）

**记录以下关键信息供后续步骤使用：**

| 字段 | 说明 | 示例 |
|------|------|------|
| 鸿蒙化版本 | 当前鸿蒙化仓库基于的上游版本 | `7.2.2` |
| npm 最新版本 | 上游 npm 发布的最新版本 | `7.4.0` |
| 版本状态 | 落后/最新/超前 | `behind` |
| 差距描述 | 落后几个大/小/补丁版本 | `落后 2 个小版本` |
| 匹配包名 | 上游 npm 包名 | `lottie-react-native` |

> 脚本详细参数与用法见 [references/script-reference.md](references/script-reference.md)。

---

## Step 2：升级类型判定（必须执行）

根据 Step 1 的版本检测结果，判定升级类型并决定后续步骤：

| 版本状态 | 升级类型 | 是否执行 Step 4 | 说明 |
|----------|----------|----------------|------|
| 落后 (behind) | **类型 A：上游版本升级 + 框架适配** | ✅ 执行 | 鸿蒙化版本 < npm 最新，需生成上游 diff 并适配框架 |
| 最新 (latest) | **类型 B：纯框架版本适配** | ❌ 跳过 | 鸿蒙化版本 = npm 最新，上游 JS 无差异，只需 RNOH 框架适配 |
| 超前 (ahead) | **类型 C：特殊情况** | ❌ 跳过 | 鸿蒙化版本 > npm 最新，需人工排查原因 |

**类型 B 时直接跳到 Step 3**，不生成 diff patch 和 summary 文件。报告聚焦于 RNOH 框架版本变化对比。

> **关键原则**：`generate-diff.js` 用于对比**上游社区仓库**的两个版本标签，**绝对不能**用于对比鸿蒙化仓库自身的分支（如 `br_rnoh0.77` vs `br_rnoh0.82`）。鸿蒙化分支间的差异不反映上游代码变更，没有分析价值。

---

## Step 3：检查目标分支是否存在

```bash
git ls-remote --heads <鸿蒙化仓库URL>
```

如果 `br_rnoh0.84` 分支不存在，说明该三方库尚未适配目标版本。此时：
- 使用已有的最高版本分支（如 `br_rnoh0.82`）作为起点
- 在报告中标注"该库尚未适配目标版本，需要从 0.82 基线升级到 0.84"
- 后续 code-adapt skill 会处理跨版本升级的适配工作

---

## Step 4：生成上游版本差异文档（仅类型 A 执行）

使用 `generate-diff.js` 脚本对比**上游社区仓库**两个版本之间的修改。

```bash
node scripts/generate-diff.js \
  --repo <上游仓库URL> \
  --branch1 <当前基线版本标签> \
  --branch2 <目标最新版本标签>
```

> **`--repo` 必须是上游社区仓库 URL**（如 `https://github.com/lottie-react-native/lottie-react-native`），
> **不是鸿蒙化仓库 URL**。上游仓库 URL 通常可以从 `README.OpenSource` 文件的 `Upstream URL` 字段
> 或 `detect-upstream-version.js` 输出的匹配包名推导。

**版本标签格式**：上游 npm 包的版本标签通常是 `v` + 版本号。如果不确定，先查看可用标签：

```bash
git ls-remote --tags <上游仓库URL>
```

脚本会在输出目录（默认 `./diff`）中生成：

| 文件 | 说明 |
|------|------|
| `<branch1>/` | 分支1 的完整源代码（无 .git） |
| `<branch2>/` | 分支2 的完整源代码（无 .git） |
| `diff_<b1>_<b2>.patch` | 对比 diff 文件（默认排除 lock 文件、example/、文档等噪音） |
| `summary_<b1>_<b2>.md` | 变更摘要，按文件统计增删行数 |

> 脚本详细参数、排除规则与输出格式见 [references/script-reference.md](references/script-reference.md)。

---

## Step 5：鸿蒙 API 核查（涉及原生能力时执行）

当差异分析中发现上游变更涉及原生能力（相机、扫码、蓝牙、定位、文件、权限等），**禁止仅凭 Android/iOS 实现或训练记忆推断 OHOS API**，必须使用 **devecocli docs search** 完成核查后再写入报告。

### 核查命令

```bash
# 搜索鸿蒙文档，关键词用空格隔开
devecocli docs search <keywords...> --catalog <name> --format <fmt> --limit <n>
```

**参数说明：**

| 参数 | 必选 | 说明 |
|------|------|------|
| `keywords...` | ✅ | 搜索关键词，多个用空格隔开 |
| `--catalog` | ❌ | 文档类别，默认 `all`。取值：`harmonyos-releases`（版本说明）、`harmonyos-guides`（指南）、`harmonyos-references`（API参考）、`best-practices`（最佳实践）、`harmonyos-faqs`（FAQ）、`harmonyos-roadmap`（变更预告）、`all`（所有分类） |
| `--format` | ❌ | 输出格式：`default`（默认）、`json` |
| `--limit` | ❌ | 返回条数，默认 10 |

### 核查流程

对每个需适配的**上游原生能力增量**（按整合主题，非每个 commit 一行）：

1. 从上游 diff 提取能力关键词（动词 + 名词 + Kit 名）
2. 执行 `devecocli docs search` 搜索鸿蒙 API 文档：
   ```bash
   # 先搜 API 参考（精确签名）
   devecocli docs search "ScanKit scanCore ScanType" --catalog harmonyos-references --limit 10

   # 再搜指南（实现步骤、约束）
   devecocli docs search "扫码 ScanKit" --catalog harmonyos-guides --limit 10

   # 搜最佳实践（性能约束）
   devecocli docs search "实时人脸检测 CoreVision" --catalog best-practices --limit 5
   ```
3. 记录到报告「鸿蒙 API 核查表」：
   - **模块导入**（如 `import { scanCore } from '@kit.ScanKit'`）
   - **关键 API 签名**（方法名、参数类型、返回值）
   - **约束与风险**（来自 guides / best-practices 的性能、权限限制）
4. 填写可行性判定：✅ 可实现 / ⚠️ 部分实现 / 🔶 合理差异 / ❌ 无法实现

完整核查流程、速查表与禁止事项见 [references/OHOS_API_LOOKUP.md](references/OHOS_API_LOOKUP.md)。

---

## Step 6：生成版本分析报告

综合前述步骤的结果，生成一份结构化的版本分析报告。报告模板见 [templates/report-template.md](templates/report-template.md)。

### 升级风险评估标准

| 风险等级 | 判定依据 |
|----------|----------|
| 🟢 低风险 | 仅补丁版本差距，无 breaking change |
| 🟡 中风险 | 小版本差距，有 API 变更但向后兼容 |
| 🔴 高风险 | 大版本差距，有 breaking change 或原生层重构 |

### 鸿蒙化适配判断规则

上游版本升级后，鸿蒙侧是否需要同步修改，判断矩阵见 [references/OHOS_ADAPTATION.md](references/OHOS_ADAPTATION.md)。

---

## 常见边界情况

### 1. 上游版本已是最新（类型 B：纯框架适配）

`detect-upstream-version.js` 输出版本状态为"最新"时：
- **跳过 Step 4**，不执行 `generate-diff.js`
- 升级性质为**纯 RNOH 框架版本适配**，核心工作是验证 RNOH API 兼容性和重新 codegen
- 报告聚焦于：RNOH 框架版本变化对比、需验证的原生 API 列表、codegen 重新生成说明
- 这是非常常见的场景，许多活跃维护的鸿蒙化仓库会保持与上游同步

### 2. 上游仓库没有版本标签

某些仓库使用分支而非标签管理版本。此时：
- 使用 commit hash 或分支名替代版本标签
- 在 `generate-diff.js` 中 `--branch1` 和 `--branch2` 传入 commit hash 或分支名

### 3. detect-upstream-version.js 无法匹配包名

如果脚本输出"未找到匹配的上游版本号"：
- 手动查看鸿蒙化仓库的 package.json，找到 `harmony.alias` 字段
- 或在 dependencies/devDependencies 中查找不含 `@react-native-ohos/` 前缀的包
- 将手动找到的包名和版本号直接记录到报告中

### 4. monorepo 场景

如果三方库是 monorepo 结构（如 `packages/core/`），`generate-diff.js` 的 `--exclude` 参数可指定排除非核心子目录，聚焦差异分析。

### 5. devecocli 未安装

如果 `devecocli` 命令不可用：
- 尝试 `ohpm install -g @ohos/deveco-cli` 或通过 DevEco Studio 安装
- 临时替代：使用 [harmonyos-sdk-api-lookup](../../rn-skills/harmonyos-sdk-api-lookup/) 子技能的 `api-references/` 本地文件
- 报告中标注"API 核查使用本地 SDK 文档替代 devecocli"

---

## 输出物清单

### 类型 A（上游版本升级 + 框架适配）

1. **版本分析报告**（Markdown 格式）— 包含版本差距、差异概览、风险评估、鸿蒙 API 核查表、下一步建议
2. **差异 patch 文件**（`diff_*.patch`）— 供后续 code-adapt skill 分析
3. **变更摘要文件**（`summary_*.md`）— 供后续 code-adapt skill 分析
4. **上游两个版本的源码目录** — 供后续 code-adapt skill 对比参考

### 类型 B（纯框架版本适配）

1. **版本分析报告**（Markdown 格式）— 包含版本状态（最新）、RNOH 框架版本变化对比、需验证的 RNOH API 列表、风险评估、升级步骤建议
2. ~~差异 patch 文件~~ — 无（上游无差异）
3. ~~变更摘要文件~~ — 无（上游无差异）
4. ~~上游源码目录~~ — 无（上游无差异）

这些输出物是后续 code-adapt skill 的输入。
