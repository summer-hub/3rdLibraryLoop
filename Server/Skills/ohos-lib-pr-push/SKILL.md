---
name: ohos-lib-pr-push
description: 'GitCode 三方库自动提 PR 工具。在本地工作区代码修改完成后，自动总结修改点、在目标仓库创建 Issue、必要时同步更新 CHANGELOG（条目附 Issue 链接）、推送分支并创建绑定 Issue 的 PR、评论 Start build 触发 CI。USE FOR: 三方库适配/修复/用例补充等本地修改完成后向 GitCode 原仓库（如 CPF-RN 组织仓库）自动提交 PR。'
license: Apache-2.0
compatibility: 需要 Node.js 18+（执行 scripts/gitcode-api.cjs），需要 git 命令行，需要 GitCode API Token（默认读取 3rdLibraryLoop/Server/.env 的 GIT_TOKEN）
metadata:
  author: LoopEngine
  version: "1.1.0"
  category: gitcode-pr
---

# OHOS Lib PR Push — 三方库自动提 PR

将本地工作区的代码修改自动提交为 GitCode 原仓库的 PR，并创建绑定 Issue、触发 CI 门禁。

> ⚠️ **核心原则：不修改任何业务代码，只做"总结修改 → 提交 → 建 Issue → 建 PR → 触发 CI"的发布链路。Token 绝不写入日志和报告。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspaceDir` | string | ✅ | 本地工作区（git 仓库根目录）绝对路径，修改已在该目录完成 |
| `repoUrl` | string | ❌ | 目标仓库 URL（如 `https://gitcode.com/CPF-RN/rntpc_react-native-image-crop-picker`）。不提供时从 `git remote -v` 推断 |
| `token` | string | ❌ | GitCode Token。不提供时读取 `3rdLibraryLoop/Server/.env` 的 `GIT_TOKEN`（见 Phase 1） |
| `branchName` | string | ❌ | 提交分支名。默认按修改类型自动生成，如 `fix/image-crop-picker-20260828` |
| `commitMessage` | string | ❌ | 提交信息。默认由修改点总结自动生成 |
| `changelog` | string | ❌ | 默认 `auto`：按 Phase 2.4 判定是否更新 CHANGELOG；`true` 强制更新；`false` 强制跳过 |
| `dryRun` | boolean | ❌ | 默认 `false`。`true` 时只总结修改点和生成报告，不执行 Issue/CHANGELOG 写入/提交推送/PR/CI |

## 输入依赖

- 前置SKILL: 无（通常在 `rnoh-lib-code-adapt` / `rnoh-cptf-demo-test` 等修改类 SKILL 完成后调用）
- 输入文件: `workspaceDir` 内的未提交/已提交修改（`git status` / `git log` 可见）

---

## 工作流程概览

```
Phase 1: 确定工作区与 Token
    ↓
Phase 2: 总结代码修改点（含 CHANGELOG 必要性判定）
    ↓
Phase 3: 创建 Issue
    ↓
Phase 4: 更新 CHANGELOG（仅当库本身内容有修改，条目带 Issue 链接）
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

### 1.1 确定工作区

1. 将 `workspaceDir` 设为当前工作目录
2. 校验是 git 仓库：执行 `git rev-parse --show-toplevel`
3. 记录当前分支、remote 信息（`git remote -v`）
4. **Monorepo 判断**：若 `repoUrl` 含 `/tree/{branch}/{subpath}`，记录子库路径，Phase 2 总结修改时标注其在仓库内的相对位置

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

### 1.4 获取原仓库信息

```bash
node scripts/gitcode-api.cjs get-repo --token "$GIT_TOKEN" --owner {owner} --repo {repo}
```

记录：`id`（原仓库 project_id，Phase 6 必需）、`default_branch`（PR 目标分支）、`path_with_namespace`。

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
- PR/Issue 标题：`[auto] {commitMessage 摘要}`
- PR/Issue body：按 [报告模板](assets/PR_ISSUE_TEMPLATE.md) 填写修改点表格

### 2.4 判定是否需要更新 CHANGELOG

逐条审视 2.2 的修改点清单，按涉及范围判定：

| 判定 | 涉及范围（示例） | 结果 |
|------|------------------|------|
| **需要** | 库源码（js/ts/ets/cpp）、harmony 模块、package 业务代码、缺陷修复、行为变更 | Phase 4 更新 CHANGELOG |
| **需要（默认，建议询问用户确认）** | 交付范围的测试用例、demo/example（随版本交付的资产） | Phase 4 更新 CHANGELOG |
| **不需要** | 仅 README 等文档、CI 配置、注释等不影响交付内容的修改 | 跳过，报告记录"未修改库本身内容" |

边界拿不准或用户传了 `changelog` 参数时，以用户为准。

> CHANGELOG 格式遵循 [Keep a Changelog](https://keepachangelog.com/)（与 `rn-lib-update-doc` SKILL 的 Step 6 约定一致）。

---

## Phase 3：创建 Issue

> **必须在提交与 PR 之前创建**：CHANGELOG 条目（Phase 4）与 PR body（Phase 6）都要引用 Issue 编号/链接；绑定关系必须创建时写入，后续 PATCH PR 可能因权限不足失败。

```bash
node scripts/gitcode-api.cjs create-issue \
  --token "$GIT_TOKEN" --owner {owner} --repo {repo} \
  --title "{issue标题}" --body-file /tmp/issue-body.md
```

- body 内容：本次提交的作用 + Phase 2 的修改点清单（模板见 [assets/PR_ISSUE_TEMPLATE.md](assets/PR_ISSUE_TEMPLATE.md)）
- 记录返回的 `number`（Issue 编号），Phase 4 与 Phase 6 使用

---

## Phase 4：更新 CHANGELOG（仅当库本身内容有修改）

按 Phase 2.4 的判定执行（`changelog` 参数为 `true`/`false` 时强制覆盖判定）：

**判定为"不需要"** → 跳过本阶段，报告中记录"未修改三方库本身内容，跳过 CHANGELOG"。

**判定为"需要"** → 在 `{workspaceDir}/CHANGELOG.md` 新增条目：

1. 遵循仓库现有 CHANGELOG 格式：Keep a Changelog 格式时写入 `## [Unreleased]` 下对应分类（`### Added` / `### Changed` / `### Fixed` / `### Deprecated`），无该节则创建；仓库为其他格式时遵循现状；无 CHANGELOG.md 时按 Keep a Changelog 新建
2. 条目描述与 Phase 2 修改点一致，具体到模块/场景（禁止笼统的"更新代码"）
3. **条目末尾必须附上 Phase 3 创建的 Issue 链接**：`- {描述} ([#{issueNumber}](https://gitcode.com/{owner}/{repo}/issues/{issueNumber}))`
4. 该文件修改随 Phase 5 一并提交（`git add -A` 自然包含）

条目示例：

```markdown
## [Unreleased]

### Added
- 新增 image-crop-picker 裁剪场景 CPTF 用例 12 条并补充 demo ([#42](https://gitcode.com/CPF-RN/rntpc_react-native-image-crop-picker/issues/42))
```

---

## Phase 5：提交并推送分支

> 本 SKILL 的典型场景是用户对**已有写权限仓库**（如 CPF-RN 组织仓库的克隆）直接推分支；若仓库无写权限，参照 [GitCode API 参考](references/GITCODE_API.md) 的"Fork 模式"章节先 Fork。

1. `dryRun=true` → 跳过 Phase 3~7，直接进 Phase 8
2. 设置仓库级提交人（与 Token 用户一致，避免本地全局配置冒名）：

```bash
cd "{workspaceDir}"
git config user.name "{name}"
git config user.email "{email}"
```

3. 创建/切换分支并提交（含 Phase 4 的 CHANGELOG 修改）：

```bash
git checkout -b "{branchName}"     # 已在目标分支则跳过
git add -A
git commit --signoff -m "{commitMessage}"
```

4. 推送：

```bash
git push -u origin "{branchName}"
```

推送失败（无权限）→ 走 Fork 模式：Fork → 添加 fork remote → 推送到 fork → Phase 6 使用跨仓库 PR 参数。

---

## Phase 6：创建绑定 Issue 的 PR

```bash
node scripts/gitcode-api.cjs create-pr \
  --token "$GIT_TOKEN" --owner {forkOwner|owner} --repo {repo} \
  --head "{branchName}" --base "{defaultBranch}" \
  --title "{pr标题}" --body-file /tmp/pr-body.md \
  [--fork-repo "{owner}/{repo}" --target-project-id "{projectId}"]
```

关键规则（详细踩坑说明见 [GitCode API 参考](references/GITCODE_API.md)）：

1. **直推模式**（对原仓库有写权限）：在原仓库 API 上创建 PR，无需 `--fork-repo/--target-project-id`
2. **Fork 模式**：调用 fork 仓库的 pulls API，**必须传 `--fork-repo`（原仓库路径）和 `--target-project-id`（原仓库 id）**，否则 PR 变成 fork 仓库内部 PR，原仓库不可见
3. PR body 中**必须**包含 `Closes #{issue_number}`（创建时写入，不事后 PATCH）
4. body 从 `--body-file` 读取，脚本内部以 UTF-8 form-encoded 发送，避免中文乱码

验证：检查响应 `target_project.path_with_namespace` 是否为原仓库；记录 PR `number` 与网页地址（格式 `https://gitcode.com/{owner}/{repo}/merge_requests/{number}`）。

---

## Phase 7：评论 Start build 触发 CI

在**原仓库**的 PR 下评论（注意 owner/repo 用原仓库，不是 fork）：

```bash
node scripts/gitcode-api.cjs comment-pr \
  --token "$GIT_TOKEN" --owner {owner} --repo {repo} \
  --pr "{prNumber}" --body "Start build"
```

记录评论是否成功（报告的 CI 状态字段）。

---

## Phase 8：生成报告

在 `{workspaceDir}` 下生成 `ohos-lib-pr-push-report.md`，模板见 [assets/PR_ISSUE_TEMPLATE.md](assets/PR_ISSUE_TEMPLATE.md)，包含：

- 基本信息（仓库、分支、时间、模式：直推/Fork）
- 执行结果（PR 地址与编号、Issue 地址与编号、Issue 绑定状态、CI 触发状态）
- CHANGELOG 状态（已更新并附 Issue 链接；或跳过及原因，如"未修改三方库本身内容"）
- 修改文件清单（Phase 2 成果）
- 错误信息（如有）

> **Token 安全**：报告中不得出现 Token 明文。

---

## 注意事项

- **只发布不修改**：发现代码问题应停下报告，不顺手改代码
- **修改点先行**：Issue/PR 的标题与 body 必须基于 Phase 2 的真实修改总结，禁止编造
- **CHANGELOG 条件更新**：仅当修改了三方库本身内容（源码、harmony 模块、交付范围用例/demo 等）才更新 CHANGELOG，条目必须附 Issue 链接；纯文档/CI 配置类修改跳过并在报告说明原因
- **Monorepo**：PR body 中标注子库路径；分支名建议带子库名前缀
- **顺序不可颠倒**：Issue（Phase 3）→ CHANGELOG（Phase 4）→ 提交推送（Phase 5）→ PR（Phase 6）→ CI 评论（Phase 7）
- **失败恢复**：某步失败时保留已完成产物的编号与链接写入报告，终止后续步骤

## 流程步骤顺序速查

1. 确定工作区 → 2. 确定 Token（用户传入 or `Server/.env` 的 `GIT_TOKEN`）→ 3. 获取用户与仓库信息 → 4. 总结修改点（判定 CHANGELOG 必要性）→ **5. 创建 Issue（获取 issue_number）** → 6. 更新 CHANGELOG（库本身有修改时，条目带 Issue 链接）→ 7. 提交推送分支 → 8. 创建 PR（body 含 `Closes #{issue_number}`）→ 9. 评论 Start build → 10. 生成报告
