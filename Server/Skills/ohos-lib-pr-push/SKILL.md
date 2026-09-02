---
name: ohos-lib-pr-push
description: 'GitCode 三方库自动提 PR 工具。工作区为 fork 仓库克隆：在代码修改完成后复用当前分支提交推送，自动总结修改点、在源仓库（上游）创建 Issue、必要时同步更新 CHANGELOG（条目附 Issue 链接）、从 fork 向源仓库创建绑定 Issue 的 PR、评论 Start build 触发 CI。USE FOR: 三方库适配/修复/用例补充等本地修改完成后，从 fork 向 GitCode 源仓库（如 CPF-RN 组织仓库）自动提交 PR。'
license: Apache-2.0
compatibility: 需要 Node.js 18+（执行 scripts/gitcode-api.cjs），需要 git 命令行，需要 GitCode API Token（默认读取 3rdLibraryLoop/Server/.env 的 GIT_TOKEN）
metadata:
  author: LoopEngine
  version: "1.5.0"
  category: gitcode-pr
---

# OHOS Lib PR Push — 三方库自动提 PR

将本地工作区（**fork 仓库的克隆**）的代码修改自动提交为**源仓库（上游）**的 PR，并创建绑定 Issue、触发 CI 门禁。

> ⚠️ **核心原则：① 工作区是 fork 仓库，PR 必须“从 fork 提交到源仓库”，禁止提交到 fork 自身；② 不修改分支——当前在哪个分支，就在该分支上提交并推送，PR head 就是该分支；③ 不修改任何业务代码，只做"总结修改 → 提交 → 建 Issue → 建 PR → 触发 CI"的发布链路；④ Token 绝不写入日志和报告。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspaceDir` | string | ✅ | 本地工作区（git 仓库根目录）绝对路径，修改已在该目录完成 |
| `upstreamUrl` | string | ❌ | 源仓库（上游）URL（如 `https://gitcode.com/CPF-RN/rntpc_react-native-image-crop-picker`）。不提供时按 Phase 1.1 的上游推断规则确定 |
| `token` | string | ❌ | GitCode Token。不提供时读取 `3rdLibraryLoop/Server/.env` 的 `GIT_TOKEN`（见 Phase 1） |
| `baseBranch` | string | ❌ | PR 目标（上游）分支。默认为上游与当前分支同名的分支（见 Phase 1.5） |
| `branchName` | string | ❌ | **已废弃自动生成新分支**：默认使用当前分支。仅当用户明确要求指定分支名时才生效，且仍不得切换已有工作分支 |
| `commitMessage` | string | ❌ | 提交信息。默认由修改点总结自动生成 |
| `changelog` | string | ❌ | 默认 `auto`：按 Phase 2.4 判定是否更新 CHANGELOG；`true` 强制更新；`false` 强制跳过 |
| `dryRun` | boolean | ❌ | 默认 `false`。`true` 时只总结修改点和生成报告，不执行 Issue/CHANGELOG 写入/提交推送/PR/CI |

## 输入依赖

- 前置SKILL: 无（通常在 `rnoh-lib-code-adapt` / `rnoh-cptf-demo-test` 等修改类 SKILL 完成后调用）
- 输入文件: `workspaceDir` 内的未提交/已提交修改（`git status` / `git log` 可见）
- 输入前提: `workspaceDir` 是某 GitCode 仓库的 **fork 克隆**（本地 origin 指向 fork；可能另有 upstream remote 指向源仓库）

---

## 工作流程概览

```
Phase 1: 确定工作区与 Token（含 1.6 探测 Issue 模板、
         1.7 分支推送状态判定 + open PR 幂等检测）
    ↓
Phase 2: 总结代码修改点（基线 upstream/{base} 优先；
         含 CHANGELOG 必要性判定、Issue 分类归类、
         测试同步门禁：源码修复无测试即终止）
    ↓
Phase 3: 创建 Issue（有模板按模板渲染标题与 body；
         无模板用 [类型] 标题 + PR_CHECKLIST 字段结构）
    ↓
Phase 4: 更新 CHANGELOG（仅当三方库内部源码有修改，英文条目带 Issue 链接）
    ↓
Phase 5: 提交并推送分支（已推送跳过；分叉禁强推）
    ↓
Phase 6: 创建绑定 Issue 的 PR（body 按 PR_CHECKLIST 描述模板，
         Checklist 如实勾选；409 用 list-prs 兜底）
    ↓
Phase 7: 评论 Start build 触发 CI
    ↓
Phase 8: 生成报告
```

> 各阶段使用的 GitCode API 细节、参数表与踩坑记录统一参见 [GitCode API 参考](references/GITCODE_API.md)

---

## Phase 1：确定工作区与 Token

### 1.1 确定工作区与上游关系（fork → 源仓库）

1. 将 `workspaceDir` 设为当前工作目录
2. 校验是 git 仓库：执行 `git rev-parse --show-toplevel`
3. 记录当前分支：`git branch --show-current`（**此分支即提交分支与 PR head，禁止切换**）；remote 信息：`git remote -v`
4. **确定 fork 仓库与源仓库**：
   - 本地 `origin`（或其它 remote）指向的仓库视为 fork 仓库（如 `https://gitcode.com/{user}/rntpc_react-native-image-crop-picker`）
   - 源仓库（上游）按优先级确定：
     a. 用户传入的 `upstreamUrl`
     b. 本地名为 `upstream` 的 remote 指向的仓库
     c. `git remote -v` 中与 origin **同名不同 owner** 的 GitCode 仓库（如 origin 是 `{user}/rntpc_react-native-image-crop-picker`，另一 remote 或仓库推导出 `CPF-RN/rntpc_react-native-image-crop-picker`）
     d. 通过 GitCode API 查询 fork 仓库的 `parent` 字段（`GET /repos/{forkOwner}/{repo}`，取响应中 `parent.path_with_namespace`）
5. 无法确定源仓库 → **终止并询问用户**，禁止默认提交到 fork 自身
6. **Monorepo 判断**：若 `upstreamUrl` 含 `/tree/{branch}/{subpath}`，记录子库路径，Phase 2 总结修改时标注其在仓库内的相对位置

### 1.2 确定 Token

按优先级取值：

1. 用户显式传入的 `token` 参数
2. 读取 `{3rdLibraryLoop根目录}/3rdLibraryLoop/Server/.env` 中的 `GIT_TOKEN`（该目录通常是 `/Users/lalhan/Desktop/3rdLibraryLoop/3rdLibraryLoop/Server/.env`，亦可从本 SKILL 目录向上回溯：`SKILL 目录 = Server/Skills/ohos-lib-pr-push`，故 `.env` 位于 `../../../.env`）
3. 都没有 → **终止并提示用户提供 Token**

### 1.3 获取 Token 用户信息

执行（用 Token 换取提交人身份，用于 git config）：

```bash
node scripts/gitcode-api.cjs get-user --token "$GIT_TOKEN"
```

记录返回的 `username`（登录名）、`name`、`email`。

### 1.4 获取源仓库（上游）信息

```bash
node scripts/gitcode-api.cjs get-repo --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repo}
```

记录：`id`（源仓库 project_id，Phase 6 必需）、`default_branch`、`path_with_namespace`。

### 1.5 确定 PR base 分支（上游目标分支）

按优先级确定 PR 的 `base`：

1. 用户传入的 `baseBranch`
2. 上游存在与**当前分支同名**的分支 → 用同名分支（典型场景：当前在 `br_rnoh0.82`，上游也有 `br_rnoh0.82`）。API 探测：`GET /repos/{upstreamOwner}/{repo}/branches/{branch}` 存在即用
3. 上游无同名分支 → 使用上游 `default_branch`，并在报告中**明显标注**"当前分支 {branch} 在上游无同名分支，PR base 回退到 {default_branch}"

### 1.6 探测源仓库 Issue 模板（决定 Phase 2.3/3 的标题与 body 规则）

```bash
node scripts/gitcode-api.cjs get-issue-templates --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repo}
```

脚本按顺序探测（命中即停）：

1. 源仓库自身 `.gitcode/ISSUE_TEMPLATE/`
2. 源仓库自身 `.github/ISSUE_TEMPLATE/`
3. **组织级模板仓库** `{upstreamOwner}/.gitcode` 的 `.gitcode/ISSUE_TEMPLATE/`（实测 `CPF-ApplicationTPC/lottie_turbo` 即此情况：仓库自身无模板，模板来自 `CPF-ApplicationTPC/.gitcode` 组织仓库）

返回 `source: repo|org|none`、`blankIssuesEnabled`、`templates[]`（每项含 `file/name/title/labels/type/yaml` 原文）。

**三组织实测状态**（2026-09）：

| 组织 | Issue 模板 | 处理 |
|------|-----------|------|
| `CPF-ApplicationTPC` | 组织级 `.gitcode` 仓库（9 个模板，`blank_issues_enabled: false`） | 按模板渲染标题与 body（Phase 2.3 / 3.1） |
| `cpf-rn` | 无（组织级/仓库级均 404） | 默认规范格式：`[类型] {摘要}` 标题 + PR_CHECKLIST 字段结构 body |
| `cpf-flutter` | 无（组织级/仓库级均 404） | 同 cpf-rn |

- **`source: none`（无模板）** → Phase 2.3/3 沿用默认规范格式（`[类型] {摘要}` 标题 + 与 [PR_CHECKLIST.md](assets/PR_CHECKLIST.md) Issue 必填内容对齐的 body 字段结构，见 [PR_ISSUE_TEMPLATE.md](assets/PR_ISSUE_TEMPLATE.md) 默认模板）
- **有模板** → 记录 `source`、`blankIssuesEnabled`、模板清单；Phase 2.3 标题、Phase 3 body **必须按选中模板渲染**（见 2.3 分类映射与 3.1 渲染规则）。模板为 GitHub Issue Forms YAML 格式（`name/description/title/labels/type/body[]`）

> 注意：`blank_issues_enabled: false` 表示该仓库网页端只允许按模板建 Issue，API 同样应遵循模板结构提交。

### 1.7 判定分支推送状态与幂等检测（覆盖"已推送到 fork 未提 PR"场景）

**推送状态三态判定**（先同步远端引用，fetch 只更新 remote-tracking 不动工作区，安全）：

```bash
git fetch origin
git rev-list --left-right --count origin/{当前分支}...HEAD   # 输出 "远端领先数<TAB>本地领先数"
```

| 判定 | 输出特征 | 处理 |
|------|---------|------|
| **已推送（一致）** | 本地领先 0（工作区亦干净） | 记录"分支已在 fork 远端，Phase 5 跳过 commit/push"；修改点采集走"已推送"路径（2.1） |
| **本地领先** | 本地领先 >0 | 正常流程（commit 未提交内容后 push） |
| **远端领先/分叉** | 远端领先 >0 | **终止并报告**：说明远端分支与本地分叉（可能被 rebase/force push/网页修改），**禁止自动 force push / pull / rebase**，交由用户处理 |

**open PR 幂等检测**（防止重复建 Issue / create-pr 409——发布链路非幂等，maxRetries=0）：

```bash
node scripts/gitcode-api.cjs list-prs --token "$GIT_TOKEN" \
  --owner {upstreamOwner} --repo {repo} --state open --head {当前分支}
```

- 在返回的 `prs[]` 中过滤 `headUser` 为 fork 仓库 owner（Token 用户或 fork 所属组织）的条目
- **命中** → 该分支已有指向源仓库的 open PR：**终止并报告**，写明已有 PR 编号与链接（`url` 字段），提示如需更新走该 PR 的评论区/重新执行前先处理
- **未命中** → 继续流程。此检测同时覆盖两种情形：① 用户已手动推送但尚未提 PR（正常继续，Issue/PR 一次建好）；② 此前 pr-push 中途失败重跑（避免重复产物）

> 失败恢复入口：从 push 之后任意阶段中断重跑时，1.7 的 PR 检测可拦住"PR 已建"的重复；但 **Issue 已建、PR 未建**的中间态无法自动识别（无关联标记），重跑会重复建 Issue——此类情形应在重跑前人工确认，报告中如出现两个同主题 Issue 属预期。

---

## Phase 2：总结代码修改点

### 2.1 采集修改

在工作区内依序执行并汇总：

| 命令 | 用途 |
|------|------|
| `git status --porcelain` | 未提交修改文件清单 |
| `git diff --stat` + `git diff` | 未暂存修改的统计与详情 |
| `git diff --cached --stat` | 已暂存修改 |
| `git log --oneline {diffBase}..HEAD` | 本分支相对基线的提交（`{diffBase}` 确定规则见下） |

**`{diffBase}` 基线确定**（按优先级取第一个可用者，fetch 均为只读安全操作）：

1. 存在 `upstream` remote：`git fetch upstream` 后用 `upstream/{Phase 1.5 确定的 base 分支}`
2. 无 upstream remote 但要精确基线：`git fetch https://gitcode.com/{upstreamOwner}/{repo}.git {base分支}` 后用 `FETCH_HEAD`（不添加 remote，无侵入）
3. 兜底（现行为）：`origin/{defaultBranch}`（注意：fork 的默认分支可能落后上游，导致多算与上游的同步提交——发现基线包含大量非本次修改的提交时，改用方式 2 并在报告标注）

**已推送场景**（Phase 1.7 判定"已推送（一致）"）：`git status`/`git diff` 全空属预期，修改点**全部来自 `git log {diffBase}..HEAD` + `git diff --stat {diffBase}..HEAD`**（已推送提交的文件级变化）；同时用 `git rev-list --count origin/{当前分支}..HEAD` 应为 0 佐证。

> 注意：若用户已在某分支做过提交，不要重复提交；只需 `git log` 提取已有提交。

### 2.2 归纳修改点清单

对每个修改文件/提交，整理为：

| 序号 | 文件路径 | 修改类型（新增/修改/删除） | 修改说明 |
|------|---------|--------------------------|---------|

修改说明需具体（如"新增 ImageCropPicker.openPicker 的 crop 场景 CPTF 用例 12 条"），避免笼统的"更新文件"。

### 2.3 生成提交文案

- `commitMessage`（未提供时）：一句话概括 + 修改点数量，如 `feat: 补充 image-crop-picker 裁剪场景 CPTF 用例并完善 demo`
- PR 标题：`{commitMessage 摘要}`（不加 `[auto]` 之类前缀）
- Issue 标题与分类：先按修改性质归类，再按 Phase 1.6 探测结果决定标题格式。**禁止使用 `[auto]` 等无意义前缀**

**修改性质归类**（六选一，取最贴近项）：

| 分类 | 适用场景 |
|------|---------|
| `新需求` | 新增/补充 demo 演示、示例页面、用例展示、新功能 |
| `bug` | 缺陷修复 |
| `咨询` | 问题咨询、方案确认类 |
| `文档` | README/文档/注释类改进 |
| `工程化改进` | CI 配置、构建脚本、工程结构类改进 |
| `代码重构` | 不改变行为、仅改善结构的重构 |

**标题格式（按 Phase 1.6 探测结果）**：

- **无模板（source: none，cpf-rn / cpf-flutter 等）**：`[类型] {摘要}`（与 [PR_CHECKLIST.md](assets/PR_CHECKLIST.md) 示例一致，如 `[Bug] ScrollView 在 xxx 场景上滑动卡顿`），类型取 `Bug` / `新需求` / `咨询` / `文档` / `工程化` / `重构` 六选一
- **有模板**：从 `templates[]` 中选与修改性质最贴近的模板（映射见下表），标题按该模板 `title` 字段的格式生成：

| 修改性质 | 模板 name（参考） | 模板 title 格式（参考） |
|---------|------------------|------------------------|
| 新需求 | `新需求\|Feature` | `[新需求]: {摘要}` |
| bug | `缺陷反馈\|Bug` | `[Bug]: 【等级：严重/一般/提示】【分类：稳定性/性能/功能/工程/工具】【三方库版本】【组件】【属性】问题描述` —— 各 `【】` 占位需按实际情况填充真实值 |
| 咨询 | `问题咨询\|Question` | `[Question]: {摘要}` |
| 文档 | `文档资料\|Document` | `[Document]: {摘要}` |
| 工程化改进 | `工程化改进\|Engineering` | `[Engineering]: {摘要}` |
| 代码重构 | `代码重构\|Refactor` | `[Refactor]: {摘要}` |

> 表中模板 name/title 为 `CPF-ApplicationTPC/.gitcode` 组织模板实测值，**以 Phase 1.6 实际拉取的 `templates[].title` 为准**（各仓库/组织可能自定义）；找不到贴近模板时回退无模板格式并在报告标注。
> Bug 模板标题等级判定参考：崩溃/功能不可用=严重，功能异常但有绕过=一般，体验/提示类=提示。
- PR/Issue body：PR body **所有仓库统一按 [PR_CHECKLIST.md](assets/PR_CHECKLIST.md) 的 PR 描述模板**生成（修改点/根因分析/方案说明/测试情况/资料修改/依赖变更/Checklist，删除不适用章节）；Issue body 无模板时按 PR_CHECKLIST 的 Issue 必填字段结构填写，有模板时按 Phase 3.1 规则渲染模板；body 内容一律写入 `/tmp` 临时文件，流程结束后删除，**不得写入工作目录**

### 2.4 判定是否需要更新 CHANGELOG

逐条审视 2.2 的修改点清单，按涉及范围判定：

| 判定 | 涉及范围（示例） | 结果 |
|------|------------------|------|
| **需要** | **三方库内部源码**：库源码目录（如 `library/`、`src/` 主代码）、harmony 模块、package 业务代码、进入交付产物的缺陷修复/行为变更 | Phase 4 更新 CHANGELOG |
| **不需要** | demo/example 页面、测试用例、README 等文档、CI 配置、注释等**不涉及三方库内部**的修改 | 跳过，报告记录"未修改三方库内部源码，跳过 CHANGELOG" |

边界拿不准或用户传了 `changelog` 参数时，以用户为准。

> CHANGELOG 格式遵循 [Keep a Changelog](https://keepachangelog.com/)（与 `rn-lib-update-doc` SKILL 的 Step 6 约定一致）。

### 2.5 判定测试用例同步情况（PR_CHECKLIST 硬性要求）

[PR_CHECKLIST.md](assets/PR_CHECKLIST.md) 要求：**修复代码与对应测试用例必须同时提交，不接受无测试的 PR**。对 Phase 2.2 修改点清单逐条判定：

1. **识别测试类修改**：路径命中测试/用例特征即算——`test/`、`__tests__/`、`ohosTest/`、`integration_test/`、`*.test.*`、`*.spec.*`、CPTF/demo 用例文件、`example/` 下的用例页面（新增 demo 演示/用例补充类提交，其本身即测试资产）
2. **识别库内部源码修改**：`library/`、`src/`、harmony 模块、package 主代码（与 2.4 的 CHANGELOG 判定同口径）
3. 按组合处置：

| 情况 | 处置 |
|------|------|
| 含测试类修改（含"本次即用例补充"） | 通过；PR body「测试情况」列出新增用例清单 |
| 仅库内部源码修改（bug 修复类）、无任何测试 | **终止并报告**：说明"按 PR 提交 checklist，修复代码与测试用例必须同步提交"，引导先补用例再重跑本流程 |
| 已有测试可覆盖（工作区存在能覆盖本次修改的测试文件，但本次未改动） | 通过；PR body「触发的已有测试用例」列出文件与分支 |
| 纯文档/工程化/CI 配置类（不涉及行为变更） | 通过；PR body 删除测试小节并标注"不适用" |

> 判定拿不准时（如源码修改是否属行为变更存疑），**从严处理**：终止并在报告中说明存疑点，交由人工确认。

---

## Phase 3：创建 Issue

> **必须在提交与 PR 之前创建**：CHANGELOG 条目（Phase 4）与 PR body（Phase 6）都要引用 Issue 编号/链接；绑定关系必须创建时写入，后续 PATCH PR 可能因权限不足失败。

### 3.1 生成 Issue body（按 Phase 1.6 探测结果二选一）

**无模板（source: none）** → 按 [assets/PR_ISSUE_TEMPLATE.md](assets/PR_ISSUE_TEMPLATE.md) 的 Issue Body 默认模板（字段与 PR_CHECKLIST 的 Issue 必填内容对齐）：问题描述、复现步骤、预期结果、实际结果、复现概率、环境信息、DEMO（如有）、日志/截图（如有）、影响范围 + 修改点清单。**bug 类**复现步骤/预期/实际/复现概率必填；**需求/咨询类**删除不适用小节。环境信息中库版本从 `workspaceDir` 的 `oh-package.json5` / `package.json` 读取，其余可得的如实填写、不可得写"未提供"。

**有模板** → 按选中模板的 `yaml` 中 `body[]` 字段**逐项渲染**为 markdown（GitCode API 的 body 是纯 markdown，网页端模板表单即由此生成）：

1. `type: markdown` 项 → 原样输出 `value`（通常是致谢/说明文字）
2. `type: textarea` / `type: input` 项 → 输出 `### {label}` 小节；`description`/`placeholder` 有助于理解字段意图时以引用块附上；正文填**真实内容**（基于 Phase 2 修改点总结），非必填且无合适内容时填 `无`
3. `validations.required: true` 的字段**必须填充真实内容，禁止留空/原样保留 placeholder**
4. `type: checkboxes` 项 → 逐条输出 `- [x] {label}`（自动提交场景默认全部勾选）
5. 模板字段之外的补充内容（修改点清单、PR 关联说明、自动创建标记）统一追加到 body 末尾的 `---` 分隔线之后

渲染示例与各类型字段的映射细节见 [assets/PR_ISSUE_TEMPLATE.md](assets/PR_ISSUE_TEMPLATE.md)「Issue 模板渲染规则」章节。

### 3.2 创建 Issue

```bash
node scripts/gitcode-api.cjs create-issue \
  --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repo} \
  --title "{issue标题，按 2.3 规则}" --body-file /tmp/issue-body.md \
  --labels "{模板 labels 逗号分隔}"
```

- body 内容：按 3.1 生成（无模板时 = PR_CHECKLIST 字段结构 + Phase 2 修改点清单；有模板时 = 模板逐项渲染）
- `--labels`（可选）：有模板时传该模板的 `labels`（如 `bug,triage`）；无模板仓库可按分类传（`bug` / `feature` 等，可选）；脚本对 labels 不被接受的情况会自动去掉重试，不影响创建
- 记录返回的 `number`（Issue 编号），Phase 4 与 Phase 6 使用

---

## Phase 4：更新 CHANGELOG（仅当三方库内部源码有修改）

按 Phase 2.4 的判定执行（`changelog` 参数为 `true`/`false` 时强制覆盖判定）：

**判定为"不需要"** → 跳过本阶段，报告中记录"未修改三方库内部源码，跳过 CHANGELOG"。

**判定为"需要"** → 在 `{workspaceDir}/CHANGELOG.md` 新增条目：

1. 遵循仓库现有 CHANGELOG 格式：Keep a Changelog 格式时写入 `## [Unreleased]` 下对应分类（`### Added` / `### Changed` / `### Fixed` / `### Deprecated`），无该节则创建；仓库为其他格式时遵循现状；无 CHANGELOG.md 时按 Keep a Changelog 新建
2. 条目描述**使用英文书写**，与 Phase 2 修改点一致，具体到模块/场景（禁止笼统的 "update code"）
3. **条目末尾必须附上 Phase 3 创建的 Issue 链接**：`- {英文描述} ([#{issueNumber}](https://gitcode.com/{upstreamOwner}/{repo}/issues/{issueNumber}))`
4. 该文件修改随 Phase 5 一并提交（`git add -A` 自然包含）

条目示例：

```markdown
## [Unreleased]

### Added
- Add 12 CPTF crop-scenario test cases for image-crop-picker and enhance the demo ([#42](https://gitcode.com/CPF-RN/rntpc_react-native-image-crop-picker/issues/42))
```

---

## Phase 5：在当前分支提交并推送（禁止切换分支）

1. `dryRun=true` → 跳过 Phase 3~7，直接进 Phase 8
2. 设置仓库级提交人（与 Token 用户一致，避免本地全局配置冒名）：

```bash
cd "{workspaceDir}"
git config user.name "{name}"
git config user.email "{email}"
```

3. **在当前分支直接提交**（含 Phase 4 的 CHANGELOG 修改）。**禁止 `git checkout -b` / `git switch` 创建或切换分支**：

```bash
git add -A
git commit --signoff -m "{commitMessage}"
# 仅当工作区完全干净（无待提交内容且有已存在提交）时，跳过 commit
```

4. 推送**当前分支**到 origin（fork 仓库），按 Phase 1.7 判定结果执行：

| 1.7 判定 | 执行 |
|----------|------|
| 已推送（一致） | **跳过 push**（报告注明"分支已推送至 fork，跳过"），直接进 Phase 6 |
| 本地领先 | `git push -u origin HEAD` |
| 远端领先/分叉 | 应已在 1.7 终止；此处兜底**禁止 `--force` 强推**，终止并报告 |

```bash
git push -u origin HEAD
```

push 报 non-fast-forward（rejections/远端有新提交）→ 同分叉处理：**禁止 force push、禁止自动 pull/rebase 合并**，保留现场终止报告，由用户决定。

推送失败（fork 无写权限/无 fork remote）→ 参照 [GitCode API 参考](references/GITCODE_API.md) 的"Fork 模式"章节，用 Token Fork 后添加 remote 再推，仍推送当前分支。

---

## Phase 6：从 fork 向源仓库创建绑定 Issue 的 PR

### 6.1 生成 PR body（按 PR_CHECKLIST 描述模板，所有仓库通用）

按 [assets/PR_ISSUE_TEMPLATE.md](assets/PR_ISSUE_TEMPLATE.md)「PR Body 模板」生成，章节包括：修改点、根因分析（需求/文档类删除）、方案说明（AI输出，含影响范围/兼容性分析）、测试情况（新增用例 / 触发的已有用例 / 手动验证，按 Phase 2.5 判定结果填写）、资料修改、依赖关系变更、关联 Issue、Checklist。

- **删除不适用的章节**（checklist 模板自身约定），不适用而非必删时标注原因
- Checklist 勾选原则：本流程能保证/已验证的项勾选 `[x]`；**AI 扫描、手动验证等需外部确认的项保持 `[ ]` 并括注说明，禁止无凭据全勾**（上游已跑 pr-check 扫描时方可勾选 AI 扫描项）
- 测试工程名按实际填写（RN 库为 RNT 工程，Flutter 库为对应测试工程）

### 6.2 创建 PR

```bash
node scripts/gitcode-api.cjs create-pr \
  --token "$GIT_TOKEN" --owner {forkOwner} --repo {repo} \
  --head "{当前分支名}" --base "{Phase 1.5 确定的上游 base 分支}" \
  --title "{pr标题}" --body-file /tmp/pr-body.md \
  --fork-repo "{upstreamOwner}/{repo}" --target-project-id "{源仓库 project_id}"
```

关键规则（详细踩坑说明见 [GitCode API 参考](references/GITCODE_API.md)）：

1. **PR 方向恒为 fork → 源仓库（上游）**：调用 fork 仓库的 pulls API，**必须传 `--fork-repo`（源仓库路径）和 `--target-project-id`（源仓库 id）**，否则 PR 变成 fork 仓库内部 PR，源仓库不可见。**禁止**向 fork 自身提 PR
2. **`head` = 当前分支**（Phase 1.1 记录，随推送更新到 fork）；**`base` = Phase 1.5 确定的上游分支**，不默认使用 `default_branch`
3. PR body 中**必须**包含 `Closes #{issue_number}`（创建时写入，不事后 PATCH）
4. body 从 `--body-file` 读取，脚本内部以 UTF-8 form-encoded 发送，避免中文乱码
5. **返回 409 兜底**：同一 source branch 只能有 1 个 open PR（正常已在 Phase 1.7 幂等检测拦截）；若仍遇 409，用 `list-prs --owner {upstreamOwner} --repo {repo} --state open --head {当前分支}` 找回已有 PR 链接写入报告，终止（不重复创建）

验证：检查响应 `target_project.path_with_namespace` 是否为源仓库（`{upstreamOwner}/{repo}`）；记录 PR `number` 与网页地址（格式 `https://gitcode.com/{upstreamOwner}/{repo}/merge_requests/{number}`）。

---

## Phase 7：评论 Start build 触发 CI

在**源仓库（上游）**的 PR 下评论（注意 owner/repo 用源仓库，不是 fork）：

```bash
node scripts/gitcode-api.cjs comment-pr \
  --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repo} \
  --pr "{prNumber}" --body "Start build"
```

记录评论是否成功（报告的 CI 状态字段）。

---

## Phase 8：生成报告

在 `{workspaceDir}` 下生成 `ohos-lib-pr-push-report.md`——**这是整个流程在工作目录产出的唯一文档**（Issue/PR body 等中间文件一律放 `/tmp` 并在流程结束后删除），模板见 [assets/PR_ISSUE_TEMPLATE.md](assets/PR_ISSUE_TEMPLATE.md)，包含：

- 基本信息（仓库、分支、时间、模式：直推/Fork、**分支推送状态**：新推送 / 已推送跳过 / 分叉终止）
- 执行结果（PR 地址与编号、Issue 地址与编号、Issue 绑定状态、CI 触发状态）
- 幂等检测（Phase 1.7 结果：未发现已有 open PR / 发现并终止（附已有 PR 链接））
- Issue 模板使用情况（有模板：`{模板 name}`（来源：仓库级/组织级）+ 渲染的标题；无模板：标注"仓库未配置 Issue 模板，使用默认规范字段（PR_CHECKLIST 对齐）"）
- 测试同步情况（Phase 2.5 判定结果：新增用例 N 条 / 已有用例覆盖 / 本次即用例补充 / 不适用原因；被门禁拦截时说明原因与引导）
- AI 扫描状态（已通过（上游 pr-check）/ 未执行——PR body 已如实括注）
- CHANGELOG 状态（已更新并附 Issue 链接；或跳过及原因，如"未修改三方库本身内容"）
- 修改文件清单（Phase 2 成果）
- 错误信息（如有）

> **Token 安全**：报告中不得出现 Token 明文。

---

## 注意事项

- **只发布不修改**：发现代码问题应停下报告，不顺手改代码
- **幂等与推送状态**（Phase 1.7）：已推送到 fork 未提 PR 属正常输入——跳过 commit/push 直接建 Issue/PR；远端分叉时**禁止 force push / 自动 pull / rebase**，终止交由用户处理；发现已有同源 open PR 时终止并报告链接，不重复建产物
- **PR 方向**：恒为 fork → 源仓库（上游）。Issue 建、PR 提、CI 评论均在**源仓库**进行；禁止提交到 fork 自身
- **分支不变**：当前在哪个分支，就在该分支提交、推送并作为 PR head；禁止 `checkout -b`/`git switch` 创建或切换分支（用户明确指定 `branchName` 并说明目标时除外）
- **修改点先行**：Issue/PR 的标题与 body 必须基于 Phase 2 的真实修改总结，禁止编造
- **CHANGELOG 条件更新**：仅当修改了**三方库内部源码**（如 `library/` 目录、harmony 模块、交付产物行为变更）才更新 CHANGELOG，条目使用**英文**描述且必须附 Issue 链接；demo 页面、测试用例、文档、CI 配置等不涉及库内部的修改一律跳过并在报告说明原因
- **Issue 模板优先**：Phase 1.6 探测到模板时（如 CPF-ApplicationTPC），Issue 标题与 body **必须按模板渲染**（title 格式 + body 字段逐项填充），不得再用默认格式；模板 `required` 字段必须填真实内容。两种情况都禁止 `[auto]` 等无意义前缀
- **Issue 分类与标题**：修改性质六分类（新需求/bug/咨询/文档/工程化改进/代码重构）；有模板时映射到 `templates[]` 中最贴近的模板并按其 title 格式；无模板时（cpf-rn / cpf-flutter 等）用 `[类型] {摘要}` 格式（如 `[Bug] {摘要}`），body 按 PR_CHECKLIST 的 Issue 必填字段结构
- **PR checklist 硬性要求**：PR body **所有仓库统一**按 [PR_CHECKLIST.md](assets/PR_CHECKLIST.md) 描述模板（修改点/根因分析/方案说明/测试情况/资料修改/依赖变更/Checklist）；**修复代码与测试用例必须同步提交**（Phase 2.5 门禁，无测试的源码修复终止并报告）；Checklist 中 AI 扫描/手动验证等外部确认项保持 `[ ]` 并括注，禁止无凭据全勾
- **单一产出到工作目录**：整个流程只允许在 `{workspaceDir}` 下生成 `ohos-lib-pr-push-report.md` 一个文档；Issue/PR body 等中间文件一律放 `/tmp`，流程结束后删除
- **Monorepo**：PR body 中标注子库路径；分支名建议带子库名前缀
- **顺序不可颠倒**：Issue（Phase 3）→ CHANGELOG（Phase 4）→ 提交推送（Phase 5）→ PR（Phase 6）→ CI 评论（Phase 7）
- **失败恢复**：某步失败时保留已完成产物的编号与链接写入报告，终止后续步骤；重跑前先走 Phase 1.7 幂等检测（可拦住"PR 已建"的重复）；"Issue 已建、PR 未建"的中间态无法自动识别，重跑会重复建 Issue，此类情形需人工确认

## 流程步骤顺序速查

1. 确定工作区 + fork/上游关系 + 当前分支 → 2. 确定 Token（用户传入 or `Server/.env` 的 `GIT_TOKEN`）→ 3. 获取用户与源仓库信息（project_id、base 分支探测）→ 4. **探测 Issue 模板（仓库级 → 组织级 `{owner}/.gitcode`；CPF-ApplicationTPC 有组织模板，cpf-rn/cpf-flutter 无 → 默认规范格式）** → 5. **分支推送状态三态判定 + open PR 幂等检测（已推送未提 PR → 跳过 commit/push；分叉 → 终止禁强推；已有 open PR → 终止报链接）** → 6. 总结修改点（基线 `upstream/{base}` 优先，已推送场景从 log+diff 采集；判定 CHANGELOG 必要性 + **测试同步门禁：源码修复无测试即终止**）→ **7. 在源仓库创建 Issue（有模板按模板 title 格式 + body 逐字段渲染；无模板用 `[类型] {摘要}` + PR_CHECKLIST 字段结构 body）** → 8. 更新 CHANGELOG（仅三方库内部源码有修改时，英文条目带 Issue 链接）→ 9. **在当前分支提交并推送到 fork（禁止切分支；已推送则跳过；分叉禁强推）** → 10. 从 fork 向源仓库创建 PR（head=当前分支， base=上游对应分支， **body 按 PR_CHECKLIST 描述模板**，含 `Closes #{issue_number}`，Checklist 如实勾选；409 用 list-prs 兜底）→ 11. 在源仓库评论 Start build → 12. 生成报告（工作目录唯一产出文档，含推送状态/幂等检测/Issue 模板/测试同步/AI 扫描状态，清理 /tmp 中间文件）
