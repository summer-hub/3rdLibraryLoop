---
name: gitcode-repo-fork
description: 'GitCode 仓库 Fork 准备工具。当需要修改的 GitCode 仓库不属于 Token 用户（无推送权限）时，自动将源仓库 Fork 到 Token 用户名下：幂等复用已有 Fork、创建后轮询就绪、克隆或接入本地工作区并配置 origin(fork)+upstream(源仓库) 双 remote 与提交人身份、落后分支 fast-forward 同步（禁强推），产出 fork-info.json 与报告，供后续代码修改与 ohos-lib-pr-push 提 PR 流程复用。USE FOR: 任何"需要修改非本人 GitCode 仓库"的流程前置阶段（Fork + 工作区准备）。'
license: Apache-2.0
compatibility: 需要 Node.js 18+（执行 scripts/gitcode-fork.cjs），需要 git 命令行，需要 GitCode API Token（默认读取 3rdLibraryLoop/Server/.env 的 GIT_TOKEN）
metadata:
  author: LoopEngine
  version: "1.0.0"
  category: gitcode-repo
---

# GitCode Repo Fork — 非本人仓库 Fork 准备

将**不属于 Token 用户**的 GitCode 仓库 Fork 到 Token 用户名下，并准备好可直接修改、可直接推送的本地工作区（origin=fork / upstream=源仓库），打通"修改 → 推送 → 提 PR"链路的前置环节。

> ⚠️ **核心原则：① 只 Fork 不改码——本 SKILL 只做"权限判定 → Fork → 工作区准备 → 同步检查"，不修改任何业务代码；② 幂等——已有 Fork 复用、已有工作区接入、已同步不重复操作；③ 禁破坏——禁删除重建 Fork、禁 force push，Fork 分叉时只报告不自动处理；④ Token 绝不写入报告、日志与 fork-info.json（remote URL 展示时必须脱敏）。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `repoUrl` | string | ✅ | 目标（源）仓库 GitCode 地址，支持 `/tree/{branch}`（含 `/-/tree/`）与 `?branch=` 内嵌分支；`/tree/{branch}/{subpath}` 视为 monorepo 子路径（仅记录，不单独克隆） |
| `workspaceDir` | string | ✅ | 本地工作区绝对路径。**已存在且为指向源仓库或其 Fork 的 git 克隆** → 走"已有工作区接入"（Phase 4.1）；**不存在或为空目录** → 克隆 Fork 到该路径（Phase 4.2）；非空且非 git 仓库 → 终止 |
| `branch` | string | ❌ | 工作分支。优先级：本参数 > repoUrl 内嵌分支 > 源仓库 `default_branch` |
| `token` | string | ❌ | GitCode Token。不提供时读取 `3rdLibraryLoop/Server/.env` 的 `GIT_TOKEN`（见 Phase 1.2） |
| `forkOwner` | string | ❌ | Fork 目标 namespace（Token 用户登录名）。默认由 `get-user` 自动获取；**Token 无 `read_user` scope（get-user 返回 403）时必须提供**（见 Phase 1.3） |
| `syncMode` | string | ❌ | `auto`（默认）：复用 Fork 且目标分支落后、无分叉时 fast-forward 同步；`none`：只检查不同步，结果记入报告 |
| `plainRemote` | boolean | ❌ | 默认 `false`：origin（fork）remote URL 内嵌 Token，使后续 `git push` 免交互（Token 仅存于本地 `.git/config`）。`true` 时不嵌入，依赖系统 credential helper |
| `dryRun` | boolean | ❌ | 默认 `false`。`true` 时只做只读探测（权限/Fork 状态/分支存在性/工作区布局预判），不执行 Fork/克隆/remote 变更/同步，不写任何文件，结果以文本汇报 |

---

## 输入依赖

- **前置 SKILL**: 无（通常是代码修改类任务的第一个环节）
- **输入文件**: 无（通过 `repoUrl` 定位源仓库）
- **下游消费者**: 代码修改类 SKILL（如 `rnoh-lib-code-adapt`、`rn-lib-add-example` 等）；`ohos-lib-pr-push`（其工作区约定 origin=fork / upstream=源仓库，本 SKILL 的 remote 布局与其完全对齐，fork 的 `parent` 字段亦满足其 Phase 1.1 上游推断）

---

## 工作流程概览

```
Phase 1: 解析输入与 Token（repoUrl → owner/repo/branch；Token → Token 用户身份）
    ↓
Phase 2: 权限与必要性判定（有推送权限 → 无需 Fork，终止报告；
          分支确定与存在性探测）
    ↓
Phase 3: Fork 幂等检测与创建（已有且 parent 正确 → 复用；
          命名冲突 → 终止；否则创建并轮询就绪）
    ↓
Phase 4: 本地工作区准备（克隆 Fork，或已有工作区 remote 手术接入；
          origin=fork / upstream=源仓库；仓库级提交人身份）
    ↓
Phase 5: 分支同步检查（仅复用 Fork 时；落后无分叉 → ff 同步；
          分叉 → 只报告禁强推）
    ↓
Phase 6: 验证与产出（fork-info.json + gitcode-repo-fork-report.md）
```

> 各判定分支的完整决策树参见 [Fork 决策指南](references/FORK_DECISION_GUIDE.md)；API 细节与踩坑记录参见 [GitCode Fork API 参考](references/GITCODE_FORK_API.md)

---

## Phase 1：解析输入与 Token

### 1.1 解析 repoUrl

从 `repoUrl` 解析 `upstreamOwner` / `repoName` / `branch` / `monorepoSubpath`：

| URL 形式 | 解析结果 |
|----------|---------|
| `https://gitcode.com/{owner}/{repo}` | branch=null（后续取默认分支） |
| `https://gitcode.com/{owner}/{repo}.git` | 去掉 `.git` 后缀 |
| `https://gitcode.com/{owner}/{repo}/tree/{branch}` | branch={branch} |
| `https://gitcode.com/{owner}/{repo}/-/tree/{branch}` | GitLab 风格路径，等价上一行 |
| `https://gitcode.com/{owner}/{repo}/tree/{branch}/{subpath}` | branch + monorepoSubpath（仅记录到 fork-info，克隆整个仓库） |
| `https://gitcode.com/{owner}/{repo}?branch={branch}` | branch={branch} |

- 域名必须是 `gitcode.com`（允许 `www.` 前缀）；其他域名（gitee/github 等）→ **终止并报告**"本 SKILL 仅处理 GitCode 仓库"
- `monorepoSubpath` 非空时在报告与 fork-info 中标注（后续 PR 场景需注明子库位置，与 ohos-lib-pr-push 的 Monorepo 处理一致）

### 1.2 确定 Token

按优先级取值：

1. 用户显式传入的 `token` 参数
2. 读取 `3rdLibraryLoop/Server/.env` 中的 `GIT_TOKEN`（从本 SKILL 目录向上回溯：`SKILL 目录 = Server/Skills/gitcode-repo-fork`，`.env` 位于 `../../../.env`）
3. 都没有 → **终止并提示用户提供 Token**

### 1.3 获取 Token 用户身份

```bash
node scripts/gitcode-fork.cjs get-user --token "$GIT_TOKEN"
```

记录返回的 `username`（登录名，**Fork 目标 namespace**）、`name`、`email`。

**Token 无 `read_user` scope 的兜底**（实测存在：返回 `403 no scopes:read_user`）：

- 改用用户传入的 `forkOwner` 参数作为 Fork 目标 namespace；`name`/`email` 缺失时提交人配置改用 `{forkOwner}` 与 `{forkOwner}@noreply.gitcode.com`（在报告中注明"Token 缺 read_user scope，提交人邮箱为占位值"）
- `forkOwner` 也未提供 → **终止并提示**："Token 无 read_user scope，请传 forkOwner 参数，或为 Token 增加该 scope"

> 派生变量：`tokenUser` = get-user 的 `username` 或 `forkOwner` 参数。

---

## Phase 2：权限与必要性判定

### 2.1 获取源仓库信息

```bash
node scripts/gitcode-fork.cjs get-repo --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repoName}
```

记录：`id`（project_id）、`defaultBranch`、`parent`（源仓库本身是 fork 时的更上游，仅记录）、`permissions`（`{pull, push, admin}`，可能为 null）。

### 2.2 判定是否需要 Fork

| 判定依据 | 结果 |
|---------|------|
| `permissions.push == true` | **无需 Fork**：Token 用户对源仓库有写权限 → 终止并报告"可直接克隆修改，如需隔离开发建议建分支而非 Fork（平台通常拒绝 Fork 自己的仓库）"。用户明确指示仍要 Fork 时按指示继续，由 Phase 3 的 API 错误处理兜底 |
| `upstreamOwner == Token 用户 username` | 同上（owner 比对兜底） |
| `permissions` 为 null 且 owner 不同 | 按无写权限处理，**报告中标注"permissions 字段缺失，按 owner 比对判定"** |
| 无写权限 | 继续 Phase 3 |

### 2.3 确定并探测工作分支

1. `branch` = 用户参数 > repoUrl 内嵌分支 > 源仓库 `defaultBranch`
2. 探测源仓库分支存在性：

```bash
node scripts/gitcode-fork.cjs get-branch --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repoName} --branch {branch}
```

3. 返回 `exists: false` → **终止并报告**"分支 {branch} 在源仓库不存在"

> `dryRun=true` 时：完成 Phase 1~3.1 后跳过一切写操作，将探测结果（权限判定、Fork 存在性、分支存在性、工作区模式预判）以文本汇报，**不执行 Fork/克隆/remote 变更/同步，不写任何文件**

---

## Phase 3：Fork 幂等检测与创建

### 3.1 探测已有 Fork

```bash
node scripts/gitcode-fork.cjs get-repo --token "$GIT_TOKEN" --owner {tokenUser} --repo {repoName} --allow-missing
```

| 探测结果 | 处置 |
|---------|------|
| `exists: false` | 走 3.2 创建 |
| `exists: true` 且 `parent` 为 `{upstreamOwner}/{repoName}` | **复用**（记录 `reused: true`），跳到 3.4 |
| `exists: true` 且 `parent` 为空或指向其他仓库 | **命名冲突**：Token 用户名下已有同名但非本仓库 Fork 的仓库 → **终止并报告**，提示用户先处理该仓库（重命名/删除），**禁止误用或覆盖** |

### 3.2 创建 Fork

```bash
node scripts/gitcode-fork.cjs create-fork --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repoName} --timeout 60
# Token 无 read_user scope 时（Phase 1.3 兜底路径）显式指定 Fork 目标：
node scripts/gitcode-fork.cjs create-fork --token "$GIT_TOKEN" --owner {upstreamOwner} --repo {repoName} --fork-owner {tokenUser} --timeout 60
```

- Fork 创建到 **Token 用户名下**，仓库名默认与源仓库一致
- 脚本内置幂等回查：POST 失败时自动回查 `{tokenUser}/{repoName}`，已存在则返回 `reused: true`（仍需按 3.1 校验 `parent`）
- 返回 `reused: true` 而探测 3.1 为不存在（并发创建等罕见场景）→ 按 3.1 规则校验后复用
- 其他失败 → **终止并报告**原始错误

### 3.3 等待 Fork 就绪

`create-fork` 已内置就绪轮询（Fork 为异步操作，刚创建的仓库 API 可能短暂 404）。若单独轮询：

```bash
node scripts/gitcode-fork.cjs wait-fork --token "$GIT_TOKEN" --owner {tokenUser} --repo {repoName} --timeout 60 --interval 3
```

超时未就绪 → **终止并报告**"Fork 可能仍在后台创建，请稍后重跑（已有 Fork 会被 3.1 幂等复用）"。

### 3.4 校验 Fork 分支

```bash
node scripts/gitcode-fork.cjs get-branch --token "$GIT_TOKEN" --owner {tokenUser} --repo {repoName} --branch {branch}
```

Fork 复制源仓库全部分支，一般必存在；`exists: false`（极端：Fork 期间源分支被删）→ **终止并报告**。

---

## Phase 4：本地工作区准备

> 先探测 `workspaceDir` 状态选择路径：存在 `.git` → 4.1 接入；不存在或为空目录 → 4.2 克隆；非空且非 git 仓库 → **终止并报告**。

### 4.1 已有工作区接入（remote 手术，不动工作区内容）

适用于"已从源仓库克隆并可能已有修改，才发现无推送权限"的场景（**工作区有未提交修改属预期输入，remote 手术不影响工作区**）：

1. 校验 git 仓库：`git rev-parse --show-toplevel`；记录当前分支 `git branch --show-current`、`git remote -v`、工作区状态 `git status --porcelain`
2. **remote 手术**（目标布局：origin=fork、upstream=源仓库）：

| 现状 | 操作 |
|------|------|
| origin 指向源仓库，无 upstream remote | `git remote rename origin upstream` + `git remote add origin {forkCloneUrl}` |
| origin 指向源仓库，upstream 已存在 | `git remote set-url origin {forkCloneUrl}`（upstream 保持） |
| origin 已指向 fork（owner == Token 用户） | 仅补 upstream：缺则 `git remote add upstream {upstreamUrl}`；已存在则校验指向，不符时 `git remote set-url upstream {upstreamUrl}` 并在报告注明覆盖 |
| origin 指向无关仓库 | **终止并报告**，交由用户确认 |

3. 统一收尾：`git remote set-url origin {forkCloneUrl}`（幂等，确保 Token 嵌入；`plainRemote=true` 时用不含 Token 的 `{forkUrl}`）
4. **分支对齐**（目标：当前分支 = `{branch}`）：

| 现状 | 处置 |
|------|------|
| 当前分支 == 目标分支 | 无操作 |
| 不同且工作区干净 | `git fetch origin` 后 `git checkout {branch}`（本地无该分支时自动跟踪 `origin/{branch}`） |
| 不同且工作区有未提交修改 | **不切换**（防丢改动），报告警告"停留在当前分支 {current}，请在提交修改后再切换到 {branch}" |

5. 设置仓库级提交人（Token 用户身份，避免本地全局配置冒名）：

```bash
git config user.name "{name}"
git config user.email "{email}"
```

### 4.2 新克隆 Fork

```bash
# 完整克隆（非 --depth=1：后续需要提交/推送/rebase 同步，浅克隆受限）
git clone -b {branch} {forkCloneUrl} {workspaceDir}
# 降级重试：去掉 -b，克隆默认分支后 git checkout {branch}
git remote add upstream {upstreamUrl}
git config user.name "{name}" && git config user.email "{email}"
```

- `{forkCloneUrl}`：`plainRemote=false` 时为 `https://{token}@gitcode.com/{tokenUser}/{repoName}.git`（Token 仅存于 `.git/config`）；`true` 时为 `https://gitcode.com/{tokenUser}/{repoName}.git`
- 克隆时输出"警告：重定向到 .../xxx.git/"属 **GitCode 正常行为**（自动补全 `.git` 后缀重定向），**不算失败、不触发降级重试**；判定失败以**命令退出码非 0 或目标目录无仓库内容**为准
- 大仓库完整克隆耗时属预期

### 4.3 Monorepo 子路径

`monorepoSubpath` 非空时：克隆整个仓库（不使用 sparse-checkout），在报告与 fork-info 中记录子库路径，供后续修改与 PR 流程标注。

---

## Phase 5：分支同步检查（仅复用 Fork 时执行；新建 Fork 跳过——刚创建必与上游一致，记 `skipped-new-fork`）

```bash
git fetch upstream
git fetch origin
git rev-list --left-right --count upstream/{branch}...origin/{branch}   # 输出 "上游独有<TAB>fork独有"
```

| 判定 | 输出特征 | 处置 |
|------|---------|------|
| 一致 | `0<TAB>0` | 记 `in-sync`，无操作 |
| Fork 领先 | `0<TAB>N` | 记 `fork-ahead`（用户此前的工作，**不动**） |
| Fork 落后、无分叉 | `N<TAB>0` | `syncMode=auto` → 同步（见下）；`syncMode=none` → 记 `skipped-mode-none` |
| 分叉 | `N<TAB>M`（均 >0） | 记 `diverged`，**只报告禁强推**：提示"fork 的 {branch} 与上游分叉，请人工确认（可 rebase 后重推）；本流程禁止 force push / 自动 rebase" |

**落后同步操作**（全部 fast-forward 安全，任何非 ff 均被 git 拒绝，无需额外判断）：

```bash
# ① 远端同步：直接把 fork 远端分支快进到上游（不依赖本地检出状态）
git push origin upstream/{branch}:{branch}
# ② 本地跟进：仅当当前在目标分支且工作区干净时
git merge --ff-only upstream/{branch}
```

- ① 失败（non-fast-forward）→ 说明期间有并发变更，按分叉处理（记 `diverged`，只报告）
- ② 跳过时（不在目标分支/工作区脏）→ 报告注明"本地工作区未跟进，请在合适时机 `git merge --ff-only upstream/{branch}`"

---

## Phase 6：验证与产出

### 6.1 验证

| 检查项 | 命令 | 预期 |
|--------|------|------|
| remote 布局 | `git remote -v` | origin → fork（`{tokenUser}/{repoName}`）、upstream → 源仓库（**展示输出前将 Token 替换为 `***` 脱敏**） |
| 当前分支 | `git branch --show-current` | == `{branch}`（4.1 脏工作区保留原分支的除外，报告注明） |
| 提交人 | `git config user.name` / `user.email` | Token 用户身份 |
| HEAD | `git rev-parse HEAD` | 记录到 fork-info |

### 6.2 产出文件（仅以下两个，均写入 `{workspaceDir}`；dryRun 不写）

- **`{workspaceDir}/fork-info.json`** — 机器可读元信息（上游/fork/分支/remote 布局/同步状态/commit，**不含 Token**），供下游 SKILL 与 ohos-lib-pr-push 复用
- **`{workspaceDir}/gitcode-repo-fork-report.md`** — 人类可读报告

两个文件的模板见 [Fork 报告模板](assets/FORK_REPORT_TEMPLATE.md)。

报告必须包含"后续步骤"指引：① 在 `{workspaceDir}` 的 `{branch}` 分支上完成代码修改（调用相应修改类 SKILL）；② 修改完成后执行 `ohos-lib-pr-push`（其 origin=fork / upstream=源仓库 布局已由本 SKILL 就位）。

---

## 注意事项

- **只准备不修改**：发现代码问题应停下报告，不顺手改代码；本 SKILL 的产出仅为 Fork + 工作区 + 元信息
- **幂等**：Fork 已存在（parent 正确）→ 复用；工作区已接入 → 只做 remote 校正；已同步 → 不重复操作。重跑安全（各 Phase 均先探测后执行）
- **禁破坏**：禁删除重建 Fork（无法可靠验证"无在用分支"，删除可能毁掉用户已有工作）；禁 force push / 自动 pull / rebase（同步只做 ff-only，分叉只报告）
- **Token 安全**：Token 可出现在 clone/remote URL（本地 `.git/config`，属正常用法），但**绝不写入报告、fork-info.json、日志正文**；任何 `git remote -v` 输出展示前必须脱敏
- **判定兜底**：API 未返回 `permissions` 时按 owner 比对判定并在报告标注；拿不准时**终止询问用户**，禁止默认带写权限处理
- **Fork of Fork**：目标仓库本身是 fork 时，仍 Fork 该仓库本身（fork 的 `parent` = 该仓库，其更上游仅记录）；后续 PR 提交目标即该仓库
- **工作区保护**：已有工作区有未提交修改属预期（remote 手术不影响）；但分支切换、本地 ff 跟进在脏工作区下跳过并警告，防丢改动
- **顺序不可颠倒**：权限判定（Phase 2）→ Fork（Phase 3）→ 工作区（Phase 4）→ 同步（Phase 5）→ 产出（Phase 6）；先 Fork 后克隆（克隆的是 fork，不是源仓库）
- **失败恢复**：任一步失败保留已完成信息写入报告后终止；重跑时 Phase 3.1 幂等检测会复用已创建的 Fork，Phase 4 remote 手术幂等收敛到目标布局

## 流程步骤顺序速查

1. 解析 repoUrl（gitcode.com 域名校验 → owner/repo/branch/monorepoSubpath）→ 2. 确定 Token（参数 > `Server/.env` 的 `GIT_TOKEN`）→ 3. `get-user` 获取 Token 用户（fork 目标 namespace；**403 无 read_user scope 时用 `forkOwner` 参数兜底**，email 以 noreply 占位并注明）→ 4. `get-repo` 源仓库（id/default_branch/parent/permissions）→ 5. **权限判定（push=true 或 owner=Token 用户 → 无需 Fork 终止；permissions 缺失按 owner 比对并标注）** → 6. 确定分支（参数 > URL 内嵌 > default_branch）+ `get-branch` 探测存在性 → 7. **`get-repo --allow-missing` 探测已有 Fork（parent 正确 → 复用；命名冲突 → 终止）** → 8. 不存在 → `create-fork`（内置幂等回查 + 就绪轮询，异步 404 属正常）→ 9. `get-branch` 校验 fork 分支 → 10. **工作区准备**（已有 git 克隆 → remote 手术：origin=fork/upstream=源仓库 + 脏工作区不切分支；否则完整克隆 fork + add upstream；统一设置仓库级提交人）→ 11. **同步检查（仅复用 Fork）**：`rev-list --left-right` 四态（一致/fork 领先不动/落后 → `git push origin upstream/{b}:{b}` ff 同步 + 本地 `merge --ff-only` 跟进/分叉 → 只报告禁强推）→ 12. 验证（remote 布局脱敏展示/分支/提交人/HEAD）→ 13. 产出 `fork-info.json` + `gitcode-repo-fork-report.md`（含后续步骤：修改类 SKILL → `ohos-lib-pr-push`）
