# 平台 API 参考

本文档详细说明各代码托管平台的 API 调用方式和 patch 下载方法。

---

## GitCode 平台

### 1. PR 元数据 API

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}?access_token={accessToken}"
```

响应字段提取：

| 字段 | JSON 路径 | 说明 |
|------|-----------|------|
| PR 标题 | `title` | |
| 目标分支 | `base.ref` | 即 `targetBranch` |
| Head SHA | `head.sha` | PR 最新提交 hash |
| 作者 | `user.name` / `user.email` | |
| 创建时间 | `created_at` | |
| PR 状态 | `state` | open/merged/closed |

### 2. Commit Patch API（推荐）

> **核心接口**：直接获取 PR head commit 的 patch 文件。

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/commit/{head.sha}/patch?access_token={accessToken}" -o {outputDir}/pr.patch
```

**关键注意**：
- 路径使用 `commit`（单数），不是 `commits`（复数）
- `{head.sha}` 从 PR 元数据 API 获取

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

---

## GitHub 平台

### 1. PR 元数据 API

```bash
curl -s "https://api.github.com/repos/{owner}/{repo}/pulls/{prNumber}"
```

### 2. Patch URL

```bash
curl -L -o pr.patch "https://github.com/{owner}/{repo}/pull/{prNumber}.patch"
curl -L -o pr.diff "https://github.com/{owner}/{repo}/pull/{prNumber}.diff"
```

---

## Gitee 平台

### 1. PR 元数据 API

```bash
curl -s "https://gitee.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}?access_token={accessToken}"
```

### 2. Patch URL

```bash
curl -L -o pr.patch "https://gitee.com/{owner}/{repo}/pulls/{prNumber}.patch"
```

---

## GitLab 平台

### 1. Patch URL

```bash
curl -L -o pr.patch "https://gitlab.com/{owner}/{repo}/-/merge_requests/{prNumber}.patch"
```

---

## 仓库克隆策略

### GitCode

```bash
# 克隆目标分支
git clone --depth=50 --branch {targetBranch} https://gitcode.com/{owner}/{repo}.git {outputDir}/source/

# 拉取 PR HEAD
git ls-remote origin  # 查找 refs/merge-requests/{prNumber}/head
git fetch origin refs/merge-requests/{prNumber}/head:pr{prNumber}
```

### 其他平台

```bash
git clone --depth=50 --branch {targetBranch} https://{platform}/{owner}/{repo}.git {outputDir}/source/
```

若指定分支克隆失败，去掉 `--branch` 参数克隆默认分支。

---

## 文件类型识别

| 路径/扩展名 | 类型 | 检视优先级 |
|-------------|------|------------|
| `ohos/src/main/ets/**/*.ets` | ArkTS Plugin 实现 | **最高** |
| `ohos/src/main/cpp/**` | C++ Native | **高** |
| `ohos/CMakeLists.txt` / `*.cmake` | 构建系统 | 中 |
| `ohos/oh-package.json5` | 包依赖 | 中 |
| `lib/**/*.dart` | Dart 接口层 | 中 |
| `example/**` | 示例工程 | 低 |