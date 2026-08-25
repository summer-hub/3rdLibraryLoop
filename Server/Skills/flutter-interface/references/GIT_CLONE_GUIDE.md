# Git Clone 指南

本文档详细说明从远程 Git 仓库克隆代码的 URL 解析规则和操作步骤。

---

## URL 格式解析规则

支持从 Web 页面 URL 直接复制使用，自动解析以下格式：

### 格式 1：仅分支

```
https://gitcode.com/openharmony-sig/flutter_inappwebview/tree/br_v6.1.5_ohos_dev
```

解析为：
- 仓库地址：`https://gitcode.com/openharmony-sig/flutter_inappwebview.git`
- 分支：`br_v6.1.5_ohos_dev`
- 子路径：无（分析整个仓库）

### 格式 2：分支 + 子路径

```
https://gitcode.com/openharmony-sig/kmptpc_compose_sample/tree/cmp192_for_ohos/harmonyApp
```

解析为：
- 仓库地址：`https://gitcode.com/openharmony-sig/kmptpc_compose_sample.git`
- 分支：`cmp192_for_ohos`
- 子路径：`harmonyApp`（只分析这个文件夹）

### 格式 3：标准 Git URL（支持扩展参数）

```
https://github.com/org/repo.git#branch=develop
https://github.com/org/repo.git#subpath=packages/core
https://github.com/org/repo.git#branch=develop&subpath=packages/core
```

---

## 解析步骤

### 1. 提取仓库基础 URL

- 如果 URL 包含 `/tree/`，提取 `https://域名/组织/仓库` 部分
- 添加 `.git` 后缀（如果尚未包含）

示例：
- `https://gitcode.com/org/repo/tree/branch` → `https://gitcode.com/org/repo.git`
- `https://gitcode.com/org/repo/tree/branch/subpath` → `https://gitcode.com/org/repo.git`

### 2. 提取分支名称

从 `/tree/` 后的第一个路径段提取分支名：
- `/tree/br_v6.1.5_ohos_dev` → 分支：`br_v6.1.5_ohos_dev`
- `/tree/cmp192_for_ohos/harmonyApp` → 分支：`cmp192_for_ohos`

### 3. 提取子路径

从分支名称后的路径段提取子路径（如果有）：
- `/tree/cmp192_for_ohos/harmonyApp` → 子路径：`harmonyApp`
- `/tree/main/packages/core` → 子路径：`packages/core`

### 4. 解析标准 Git URL 参数

如果 URL 包含 `#branch=` 或 `#subpath=` 参数，提取对应值：
- `repo.git#branch=develop` → 分支：`develop`
- `repo.git#branch=develop&subpath=packages/core` → 分支：`develop`，子路径：`packages/core`

---

## 克隆操作

### 检查 Git 环境

```bash
git --version
```

确认 Git 已安装且版本 ≥ 2.25.0（支持 Sparse Checkout）。

### 情况 A：无子路径（完整克隆）

```bash
# 克隆整个仓库
git clone <baseUrl> <outputDir>/source

# 切换到指定分支（如果有）
cd <outputDir>/source
git checkout <branch>
```

### 情况 B：有子路径（稀疏检出 - Sparse Checkout）

> 优势：只下载指定文件夹，节省时间和磁盘空间

```bash
# 1. 初始化空仓库
mkdir -p <outputDir>/source
cd <outputDir>/source
git init

# 2. 启用稀疏检出
git sparse-checkout init --cone

# 3. 设置远程仓库
git remote add origin <baseUrl>

# 4. 指定要检出的子路径
git sparse-checkout set <subpath>

# 5. 拉取指定分支的代码
git fetch origin <branch> --depth=1

# 6. 检出代码
git checkout <branch>
```

### 示例

```bash
# 示例：只克隆 harmonyApp 文件夹
mkdir -p /tmp/analysis/kmptpc/source
cd /tmp/analysis/kmptpc/source
git init
git sparse-checkout init --cone
git remote add origin https://gitcode.com/openharmony-sig/kmptpc_compose_sample.git
git sparse-checkout set harmonyApp
git fetch origin cmp192_for_ohos --depth=1
git checkout cmp192_for_ohos
```

---

## 验证克隆结果

检查 `<outputDir>/source` 目录：
- 如果有子路径，检查 `<outputDir>/source/<subpath>` 是否存在
- 确认目录包含源代码文件（`.dart`、`.ets`、`.ts`、`.js` 等）

---

## 记录克隆信息

将以下信息写入 `<outputDir>/clone-info.json`：

```json
{
  "baseUrl": "https://gitcode.com/openharmony-sig/kmptpc_compose_sample.git",
  "branch": "cmp192_for_ohos",
  "subpath": "harmonyApp",
  "sparseCheckout": true,
  "cloneTime": "2026-05-09T10:30:00Z",
  "commitHash": "abc123def456",
  "originalUrl": "https://gitcode.com/openharmony-sig/kmptpc_compose_sample/tree/cmp192_for_ohos/harmonyApp"
}
```

---

## 确定最终分析路径

- 如果有子路径：`analysisRoot = <outputDir>/source/<subpath>`
- 如果无子路径：`analysisRoot = <outputDir>/source`

后续 Phase 2 的脚本提取基于 `analysisRoot` 目录进行。

---

## 克隆失败处理

| 错误类型 | 可能原因 | 解决方案 |
|----------|----------|----------|
| 认证失败 | 私有仓库或权限不足 | 提示用户配置 SSH 密钥或 HTTPS Token |
| 分支不存在 | 分支名称错误 | 列出远程分支：`git branch -r`，提示用户选择正确分支 |
| 子路径不存在 | 路径错误或分支中无此目录 | 列出仓库根目录内容，提示用户确认路径 |
| 网络超时 | 网络问题 | 提示用户检查网络或使用镜像站点 |
| Sparse Checkout 失败 | Git 版本过低 | 提示升级 Git 到 2.25+ 或使用完整克隆 |

### 旧版本 Git 替代方案

如果 Git 版本 < 2.25，使用以下替代方案：

```bash
git config core.sparseCheckout true
echo "<subpath>/*" >> .git/info/sparse-checkout
git pull origin <branch>
```
