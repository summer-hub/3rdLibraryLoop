---
name: ohos-lib-pr-push
description: 'GitCode 三方库自动提 PR 工具。工作区为 fork 仓库克隆：在代码修改完成后复用当前分支提交推送，自动总结修改点、在源仓库（上游）创建 Issue、必要时同步更新 CHANGELOG（条目附 Issue 链接）、从 fork 向源仓库创建绑定 Issue 的 PR、评论 Start build 触发 CI。USE FOR: 三方库适配/修复/用例补充等本地修改完成后，从 fork 向 GitCode 源仓库（如 CPF-RN 组织仓库）自动提交 PR。'
license: Apache-2.0
compatibility: 需要 Node.js 18+（执行 scripts/gitcode-api.cjs），需要 git 命令行，需要 GitCode API Token（默认读取 3rdLibraryLoop/Server/.env 的 GIT_TOKEN）
metadata:
  author: LoopEngine
  version: "1.2.0"
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
Phase 1: 确定工作区与 Token
    ↓
Phase 2: 总结代码修改点（含 CHANGELOG 必要性判定）
    ↓
Phase 3: 创建 Issue
    ↓
Phase 4: 更新 CHANGELOG（仅当三方库内部源码有修改，英文条目带 Issue 链接）
    ↓
Phase 5: 提交并推送分支
    ↓
Phase 6: 创建绑定 Issue 的 PR
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



---

## Phase 2：总结代码修改点

### 2.1 采集修改

在工作区内依序执行并汇总：

| 命令 | 用途 |
|------|------|
| `git status --porcelain` | 未提交修改文件清单 |
| `git diff --stat` + `git diff` | 未暂存修改的统计与详情 |
| `git diff --cached --stat` | 已暂存修改 |
| `git log --oneline origin/{defaultBranch}..HEAD`（无 upstream 时用 `git log -10 --oneline`） | 本分支相对目标分支的提交 |

> 注意：若用户已在某分支做过提交，不要重复提交；只需 `git log` 提取已有提交。

### 2.2 归纳修改点清单

对每个修改文件/提交，整理为：

| 序号 | 文件路径 | 修改类型（新增/修改/删除） | 修改说明 |
|------|---------|--------------------------|---------|

修改说明需具体（如"新增 ImageCropPicker.openPicker 的 crop 场景 CPTF 用例 12 条"），避免笼统的"更新文件"。

### 2.3 生成提交文案

- `commitMessage`（未提供时）：一句话概括 + 修改点数量，如 `feat: 补充 image-crop-picker 裁剪场景 CPTF 用例并完善 demo`
- PR 标题：`{commitMessage 摘要}`（不加 `[auto]` 之类前缀）
- Issue 标题：`{分类}：{摘要}`，分类按修改性质从以下三类中选择，**禁止使用 `[auto]` 等无意义前缀**：
  - `Demo 需求`：新增/补充 demo 演示、示例页面、用例展示
  - `bug`：缺陷修复
  - `咨询`：问题咨询、方案确认类
- PR/Issue body：按 [报告模板](assets/PR_ISSUE_TEMPLATE.md) 填写修改点表格；body 内容一律写入 `/tmp` 临时文件，流程结束后删除，**不得写入工作目录**

### 2.4 判定是否需要更新 CHANGELOG

逐条审视 2.2 的修改点清单，按涉及范围判定：

| 判定 | 涉及范围（示例） | 结果 |
|------|------------------|------|
| **需要** | **三方库内部源码**：库源码目录（如 `library/`、`src/` 主代码）、harmony 模块、package 业务代码、进入交付产物的缺陷修复/行为变更 | Phase 4 更新 CHANGELOG |
| **不需要** | demo/example 页面、测试用例、README 等文档、CI 配置、注释等**不涉及三方库内部**的修改 | 跳过，报告记录"未修改三方库内部源码，跳过 CHANGELOG" |

边界拿不准或用户传了 `changelog` 参数时，以用户为准。

> CHANGELOG 格式遵循 [Keep a Changelog](https://keepachangelog.com/)（与 `rn-lib-update-doc` SKILL 的 Step 6 约定一致）。

---

## Phase 3：创建 Issue

> **必须在提交与 PR 之前创建**：CHANGELOG 条目（Phase 4）与 PR body（Phase 6）都要引用 Issue 编号/链接；绑定关系必须创建时写入，后续 PATCH PR 可能因权限不足失败。

```bash
node scripts/gitcode-api.cjs create-issue \
  --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repo} \
  --title "{issue标题}" --body-file /tmp/issue-body.md
```

- body 内容：本次提交的作用 + Phase 2 的修改点清单（模板见 [assets/PR_ISSUE_TEMPLATE.md](assets/PR_ISSUE_TEMPLATE.md)）
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

4. 推送**当前分支**到 origin（fork 仓库）：

```bash
git push -u origin HEAD
```

推送失败（fork 无写权限/无 fork remote）→ 参照 [GitCode API 参考](references/GITCODE_API.md) 的"Fork 模式"章节，用 Token Fork 后添加 remote 再推，仍推送当前分支。

---

## Phase 6：从 fork 向源仓库创建绑定 Issue 的 PR

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

- 基本信息（仓库、分支、时间、模式：直推/Fork）
- 执行结果（PR 地址与编号、Issue 地址与编号、Issue 绑定状态、CI 触发状态）
- CHANGELOG 状态（已更新并附 Issue 链接；或跳过及原因，如"未修改三方库本身内容"）
- 修改文件清单（Phase 2 成果）
- 错误信息（如有）

> **Token 安全**：报告中不得出现 Token 明文。

---

## 注意事项

- **只发布不修改**：发现代码问题应停下报告，不顺手改代码
- **PR 方向**：恒为 fork → 源仓库（上游）。Issue 建、PR 提、CI 评论均在**源仓库**进行；禁止提交到 fork 自身
- **分支不变**：当前在哪个分支，就在该分支提交、推送并作为 PR head；禁止 `checkout -b`/`git switch` 创建或切换分支（用户明确指定 `branchName` 并说明目标时除外）
- **修改点先行**：Issue/PR 的标题与 body 必须基于 Phase 2 的真实修改总结，禁止编造
- **CHANGELOG 条件更新**：仅当修改了**三方库内部源码**（如 `library/` 目录、harmony 模块、交付产物行为变更）才更新 CHANGELOG，条目使用**英文**描述且必须附 Issue 链接；demo 页面、测试用例、文档、CI 配置等不涉及库内部的修改一律跳过并在报告说明原因
- **Issue 分类**：Issue 标题必须以 `Demo 需求：` / `bug：` / `咨询：` 之一开头，禁止 `[auto]` 等无意义前缀
- **单一产出到工作目录**：整个流程只允许在 `{workspaceDir}` 下生成 `ohos-lib-pr-push-report.md` 一个文档；Issue/PR body 等中间文件一律放 `/tmp`，流程结束后删除
- **Monorepo**：PR body 中标注子库路径；分支名建议带子库名前缀
- **顺序不可颠倒**：Issue（Phase 3）→ CHANGELOG（Phase 4）→ 提交推送（Phase 5）→ PR（Phase 6）→ CI 评论（Phase 7）
- **失败恢复**：某步失败时保留已完成产物的编号与链接写入报告，终止后续步骤

## 流程步骤顺序速查

1. 确定工作区 + fork/上游关系 + 当前分支 → 2. 确定 Token（用户传入 or `Server/.env` 的 `GIT_TOKEN`）→ 3. 获取用户与源仓库信息（project_id、base 分支探测）→ 4. 总结修改点（判定 CHANGELOG 必要性：仅三方库内部源码修改才更新）→ **5. 在源仓库创建 Issue（标题带分类前缀：`Demo 需求：`/`bug：`/`咨询：`）** → 6. 更新 CHANGELOG（仅三方库内部源码有修改时，英文条目带 Issue 链接）→ 7. **在当前分支提交并推送到 fork（禁止切分支）** → 8. 从 fork 向源仓库创建 PR（head=当前分支， base=上游对应分支， body 含 `Closes #{issue_number}`）→ 9. 在源仓库评论 Start build → 10. 生成报告（工作目录唯一产出文档，清理 /tmp 中间文件）
