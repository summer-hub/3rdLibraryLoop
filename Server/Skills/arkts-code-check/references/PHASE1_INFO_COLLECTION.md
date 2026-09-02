# Phase 1：信息收集详细指南

本文档包含 ArkTS 代码检视第一阶段（输入解析与信息收集）的详细操作步骤。

---

## 1.1 解析 PR 地址

从 `prUrl` 中提取以下字段：

| 平台 | URL 模式 |
|------|----------|
| GitHub | `https://github.com/{owner}/{repo}/pull/{num}` |
| GitCode | `https://gitcode.com/{owner}/{repo}/pulls/{num}` |
| Gitee | `https://gitee.com/{owner}/{repo}/pulls/{num}` |
| GitLab | `https://gitlab.com/{owner}/{repo}/-/merge_requests/{num}` |

提取字段：`platform`、`owner`、`repo`、`prNumber`。

---

## 1.2 获取 PR 元数据

调用平台 API 获取 PR 基本信息：

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}?access_token={accessToken}"
```

从响应 JSON 提取：

| 字段 | JSON 路径 | 说明 |
|------|-----------|------|
| PR 标题 | `title` | |
| 目标分支 | `base.ref` | targetBranch |
| Head SHA | `head.sha` | PR 最新提交（用于获取 patch） |
| 作者 | `user.name` / `user.email` | |
| 创建时间 | `created_at` | |
| PR 状态 | `state` | open/merged/closed |

> ⚠️ 若用户已通过 `branch` 参数提供目标分支，直接使用，不覆盖。

---

## 1.3 获取 Commit Patch（仅供参考）

> 获取 PR 最新 commit 的 patch 文件，主要用于提取 commit 元数据（作者、日期、message）。
> **此 patch 仅包含单次 commit 的差异，不代表 PR 全量变更。**

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/commit/{headSha}/patch?access_token={accessToken}" -o {outputDir}/pr.patch
```

**关键注意**：
- 路径使用 `commit`（单数），不是 `commits`（复数）
- `{headSha}` 从 PR 元数据的 `head.sha` 字段获取
- **pr.patch 仅包含最新一次 commit 的差异**，若 PR 有多个 commit，需使用 1.5 步骤的累积 diff

**Patch 文件格式**：
```
From <commit-hash> Mon Sep 17 00:00:00 2001
From: <author> <email>
Date: <date>
Subject: [PATCH] <commit message>

<file change statistics>

diff --git a/<file> b/<file>
...
```

**从 Patch 提取信息**：
- Commit 作者、日期、message（头部元数据）
- 修改文件列表（扫描 `diff --git a/<file> b/<file>` 行）
- 文件变更统计（`<file> | <added> +, <removed> -` 行）
- 具体代码变更（diff hunks）

> ⚠️ **仅凭 pr.patch 可能遗漏 PR 的大量变更**。例如：某 PR head.sha 的 patch 仅包含 1 个文件的修改，但该 PR 实际包含 21 个文件的累积变更。必须使用 1.5 步骤的累积 diff 进行完整检视。

---

## 1.4 克隆仓库获取完整上下文

> **必须克隆仓库**，用于深度检视和跨文件引用分析，同时用于生成累积 diff。

```bash
git clone --depth=50 --branch {targetBranch} https://gitcode.com/{owner}/{repo}.git {outputDir}/source/
```

**克隆失败处理**：
- 若指定分支克隆失败，去掉 `--branch` 参数克隆默认分支
- 克隆后通过 `git ls-remote origin` 查找 `refs/merge-requests/{prNumber}/head`
- 再用 `git fetch origin refs/merge-requests/{prNumber}/head:pr{prNumber}` 拉取 PR HEAD
- 若克隆完全失败，在报告中注明"未能获取完整仓库上下文"并继续分析

**需要查阅完整源码的场景**：
- diff 删除了成员变量赋值 → 搜索该变量所有引用
- diff 修改了方法参数 → 查看函数定义确认签名
- diff 修改了 null 判断逻辑 → 追踪变量赋值路径
- diff 新增/删除事件监听 → 查阅完整类确认生命周期

---

## 1.5 获取 PR 累积差异（检视核心依据）

> **⚠️ 此步骤为检视的核心数据来源。必须基于累积 diff 进行检视，而非单次 commit patch。**

克隆仓库并 fetch PR HEAD 后，必须生成从 base 分支到 PR HEAD 的累积 diff：

```bash
cd {outputDir}/source/

# 1. fetch PR HEAD（若已在 1.4 中执行则跳过）
git fetch origin refs/merge-requests/{prNumber}/head:pr{prNumber}

# 2. checkout PR 分支
git checkout pr{prNumber}

# 3. 生成全量累积 diff（保存原始全量用于参考）
git diff {targetBranch}..pr{prNumber} > {outputDir}/pr-diff-raw.txt

# 4. 统计全量变更规模（用于对比和记录）
git diff --stat {targetBranch}..pr{prNumber}
```

**为什么必须使用累积 diff**：
- PR 可能包含多个 commit，单次 commit patch（pr.patch）无法反映全量变更
- 实际案例：某 PR 的 head.sha patch 仅包含 1 个文件修改（魔法数字替换），但累积 diff 包含 21 个文件变更（6处内存泄漏修复、8处null安全、测试新增等）
- 若仅基于 pr.patch 检视，会遗漏大量关键变更

**⚠️ 全量累积 diff 可能包含非 PR 意图范围的变更**：
- 在 Monorepo（如 `openharmony_tpc_samples`）中，fork 分支的 master 通过 merge commit 合入了其他 PR 的变更
- `git diff {targetBranch}..pr{prNumber}` 比较的是主仓库 master vs fork 的完整历史，包含所有分歧变更
- 实际案例：PR #3042 累积 diff 包含 113 个文件（ohos_rive、ohos_7zip、spinec、GstreamerDemo 等），但仅 18 个 eventsource 文件属于本 PR
- 必须在 1.6 步骤进行范围过滤，否则会将其他库的问题误判为本 PR 的 Blocker

**PR 更新检测**：
- PR 推送新 commit 后，`head.sha` 会变化（本次案例：从 `cb3b3235` 变为 `581a1c3`）
- **每次检视前必须重新获取 PR 元数据，对比 head.sha 是否变化**
- 若 head.sha 变化，必须：
  1. 重新 fetch PR HEAD：`git fetch origin refs/merge-requests/{prNumber}/head:pr{prNumber}`
  2. 重新 checkout 并生成 pr-diff-raw.txt 和 pr-diff.txt
  3. 重新生成所有报告文件

---

## 1.6 识别 PR 检视范围并过滤 diff（关键步骤）

> **⚠️ 此步骤防止检视范围污染，是 v2.1 新增的核心改进。**

### 问题背景

Monorepo（包含多个三方库子目录的仓库，如 `openharmony_tpc_samples`）中，fork 分支的 master 通常通过 merge commit 合入了其他 PR 的变更。此时全量累积 diff `git diff {targetBranch}..pr{prNumber}` 会包含**不属于本 PR 意图范围**的文件变更，导致检视范围污染。

**实际案例**（PR #3042）：
- PR 标题：`eventsource: fix: 资源泄漏修复、错误处理增强`
- 全量累积 diff：113 个文件，包含 ohos_rive（18 文件）、ohos_7zip（17 文件）、spinec（6 文件）、GstreamerDemo（54 文件删除）
- PR 实际意图范围：仅 eventsource（18 文件）
- **后果**：若不过滤，ohos_rive 的内存安全回归会被误判为本 PR 的 3 个 Blocker，导致错误的 REJECT 结论
- 过滤后仅检视 18 个 eventsource 文件，正确结论为 PASS

### 识别方法

按优先级依次尝试：

| 方法 | 说明 | 示例 |
|------|------|------|
| PR 标题前缀 | 标题中冒号前的库名 | `eventsource: fix: ...` → `eventsource` |
| PR body 描述 | 描述中提及的目标库 | "修复 eventsource 的资源泄漏" → `eventsource` |
| Commit message | commit 中提及的目标库 | `fix: 代码质量加固` → 需结合变更文件判断 |
| 变更文件公共父目录 | 最深层公共父目录名 | 所有变更在 `eventsource/` 下 → `eventsource` |

**提取逻辑**：
```
1. 检查 PR title 是否包含 "库名:" 格式 → 提取库名
2. 检查 PR body 是否提及库名 → 提取库名
3. 分析变更文件列表，取公共父目录（去掉 source/ 等前缀）
4. 若多个库都有变更，优先取 PR 标题/body 指定的库
```

### 过滤操作

```bash
cd {outputDir}/source/

# 仅保留目标库目录下的 diff（关键：避免检视范围污染）
git diff {targetBranch}..pr{prNumber} -- {targetLibraryDir}/ > {outputDir}/pr-diff.txt

# 重新统计（基于过滤后的 diff）
git diff --stat {targetBranch}..pr{prNumber} -- {targetLibraryDir}/

# 重新生成 changed-files.txt（基于过滤后的 diff）
# ⚠️ 禁止使用 sed 's/diff --git a\/.* b\/\//' —— macOS BSD sed 对该转义组合不兼容，
#    会报 "unterminated substitute in regular expression" 并静默生成 0 字节空文件
grep "^diff --git" {outputDir}/pr-diff.txt | awk '{print $4}' | sed 's/^b\///' > {outputDir}/changed-files.txt

# 生成后必须校验非空（0 字节空文件 = 提取失败，会导致后续检视范围判断失据，且收尾前不易察觉）
wc -l {outputDir}/changed-files.txt
```

### 边界情况

| 场景 | 处理方式 |
|------|----------|
| PR 标题不含库名 | 使用变更文件公共父目录 |
| PR 跨多个库修改 | 检视所有涉及的库目录，但每个库独立检视 |
| PR 仅修改配置/根文件（不涉及子库） | 不做目录过滤，全量检视 |
| fork 分支与主仓库 master 无分歧 | 全量 diff = 目标范围 diff，过滤无影响 |

---

## 1.7 保存输出文件

| 文件 | 内容 | 用途 |
|------|------|------|
| `{outputDir}/pr.patch` | 最新 commit 的 patch（unified diff 格式） | 参考：commit 元数据提取 |
| `{outputDir}/pr-diff-raw.txt` | PR 全量累积 diff（base → PR HEAD，所有文件） | 参考：记录全量变更，不用于检视 |
| `{outputDir}/pr-diff.txt` | PR 累积 diff（目标库目录范围内） | **检视核心依据** |
| `{outputDir}/changed-files.txt` | 修改文件列表（基于范围过滤后的 diff） | 文件清单 |

**生成 changed-files.txt**：
```bash
# 基于范围过滤后的 diff 生成（而非 pr-diff-raw.txt 或 pr.patch）
# ⚠️ 禁止使用 sed 's/diff --git a\/.* b\/\//' —— macOS BSD sed 不兼容该转义组合，
#    会静默生成 0 字节空文件；改用 awk 提取第 4 列再去掉 b/ 前缀
grep "^diff --git" {outputDir}/pr-diff.txt | awk '{print $4}' | sed 's/^b\///' > {outputDir}/changed-files.txt

# 生成后必须校验非空（自检步骤：空文件意味着提取失败，必须立即发现而非收尾时）
wc -l {outputDir}/changed-files.txt
```

> **注意**：changed-files.txt 必须基于 `pr-diff.txt`（范围过滤后的累积 diff）生成，而非 `pr-diff-raw.txt`（全量累积 diff）或 `pr.patch`（单次 commit）。
> **自检要求**：`wc -l` 结果为 0 行时禁止继续后续流程，必须先排查 diff 生成与提取命令是否失败（实际案例：mp3agic PR #53 中 BSD sed 静默失败生成空文件，直至收尾才发现，险些遗漏检视范围）。
