# URL 格式解析规则

本文档详细说明 RNLibraryInterfaceAnalyzer 支持的输入 URL 格式与解析规则。

## 输入形式

| 输入形式 | 示例 | 获取方式 |
|----------|------|----------|
| **Git 仓库地址（完整 URL）** | `https://github.com/org/repo.git` | git clone 到指定目录后分析 |
| **Git 仓库地址（带分支）** | `https://gitcode.com/org/repo/tree/branch_name` | 自动解析分支并切换 |
| **Git 仓库地址（带分支和子路径）** | `https://gitcode.com/org/repo/tree/branch/subpath` | 使用 Sparse Checkout 只克隆指定子目录 |
| **Git 仓库地址（带 commit）** | `https://github.com/org/repo/blob/913e7da456a6` | 克隆仓库后 checkout 到指定 commit |
| **Git 仓库地址（带 commit 和子路径）** | `https://github.com/org/repo/blob/913e7da456a6/src` | 克隆仓库、checkout commit、Sparse Checkout 子目录 |
| **本地路径** | `/path/to/some-library`、`node_modules/axios` | 直接读取目录文件 |
| **npm 包名**（仅 upstreamRepoUrl） | `axios`、`lodash` | 查阅 `node_modules/` 或运行 `npm pack <包名>` 解包 |

> ⚠️ `ohosRepoUrl` 不支持 npm 包名形式，鸿蒙化仓库必须通过 Git 或本地路径提供

## URL 格式解析

支持从 Web 页面 URL 直接复制使用，自动解析以下格式：

### 格式 1：仅分支

```
https://gitcode.com/openharmony-sig/react-native-localization-settings/tree/ohos
```

解析为：
- 仓库地址：`https://gitcode.com/openharmony-sig/react-native-localization-settings.git`
- 分支：`ohos`
- 子路径：无（分析整个仓库）

### 格式 2：分支 + 子路径

```
https://gitcode.com/openharmony-sig/react-native-touch-id/tree/ohos/harmony
```

解析为：
- 仓库地址：`https://gitcode.com/openharmony-sig/react-native-touch-id.git`
- 分支：`ohos`
- 子路径：`harmony`（只分析这个文件夹）

### 格式 3：标准 Git URL（支持扩展参数）

```
https://github.com/org/repo.git#branch=develop
https://github.com/org/repo.git#subpath=packages/core
https://github.com/org/repo.git#branch=develop&subpath=packages/core
```

### 格式 4：Commit Hash

```
https://github.com/TencentCloud/cos-sdk-react-native-plugin/blob/913e7da456a653e8a910fa9c6d488cef41bcf37e
```

解析为：
- 仓库地址：`https://github.com/TencentCloud/cos-sdk-react-native-plugin.git`
- commit：`913e7da456a653e8a910fa9c6d488cef41bcf37e`
- 子路径：无（分析整个仓库）

> 识别规则：URL 中 `/blob/` 或 `/tree/` 或 `/commit/` 后的第一段，如果匹配正则 `[0-9a-f]{7,40}`（7~40 位十六进制字符），则判定为 commit hash 而非分支名。

### 格式 5：Commit Hash + 子路径

```
https://github.com/TencentCloud/cos-sdk-react-native-plugin/blob/913e7da456a653e8a910fa9c6d488cef41bcf37e/src
```

解析为：
- 仓库地址：`https://github.com/TencentCloud/cos-sdk-react-native-plugin.git`
- commit：`913e7da456a653e8a910fa9c6d488cef41bcf37e`
- 子路径：`src`（只分析这个文件夹）

### 格式 6：GitHub Commit 页面 URL

```
https://github.com/org/repo/commit/913e7da456a6
```

解析为：
- 仓库地址：`https://github.com/org/repo.git`
- commit：`913e7da456a6`
- 子路径：无

## 判断输入类型

根据参数值的格式判断输入类型：

| 输入类型 | 判断规则 | 处理方式 |
|----------|----------|----------|
| Git URL | 以 `http://`、`https://`、`git://`、`ssh://` 开头，或以 `.git` 结尾 | 执行 Git 克隆流程 |
| 本地路径 | 以 `/` 开头或包含路径分隔符且路径存在 | 直接作为 analysisRoot |
| npm 包名 | 不以 `/` 或 `http` 开头的纯字母数字字符串 | npm 解包流程 |

## 克隆命令参考

### 按分支克隆（无 commit hash）

```bash
# 无子路径（完整克隆）
mkdir -p {outputDir}/source/{target}
git clone --depth=1 -b {branch} {baseUrl} {outputDir}/source/{target}

# 有子路径（Sparse Checkout）
mkdir -p {outputDir}/source/{target}
cd {outputDir}/source/{target}
git init
git sparse-checkout init --cone
git remote add origin {baseUrl}
git sparse-checkout set {subpath}
git fetch origin {branch} --depth=1
git checkout {branch}
```

### 按 commit hash 克隆

> ⚠️ 按 commit checkout 时**不能使用 `--depth=1`**，因为 shallow clone 不包含任意 commit 的历史。必须先完整克隆或 fetch 到该 commit，然后 checkout。

```bash
# 无子路径
mkdir -p {outputDir}/source/{target}
git clone {baseUrl} {outputDir}/source/{target}
cd {outputDir}/source/{target}
git checkout {commitHash}

# 有子路径（Sparse Checkout + commit checkout）
mkdir -p {outputDir}/source/{target}
cd {outputDir}/source/{target}
git init
git sparse-checkout init --cone
git remote add origin {baseUrl}
git sparse-checkout set {subpath}
git fetch origin
git checkout {commitHash}
```

### 本地路径

```bash
ln -s {localPath} {outputDir}/source/{target}
```

### npm 包名（仅 upstreamRepoUrl）

```bash
if [ -d "node_modules/{packageName}" ]; then
  ln -s node_modules/{packageName} {outputDir}/source/RN
else
  mkdir -p {outputDir}/source/RN
  cd {outputDir}/source/RN
  npm pack {packageName}
  tar -xzf *.tgz
  mv package/* .
  rm -rf package *.tgz
fi
```

## 获取失败处理

| 错误类型 | 可能原因 | 解决方案 |
|----------|----------|----------|
| 认证失败 | 私有仓库或权限不足 | 提示用户配置 SSH 密钥或 HTTPS Token |
| 分支不存在 | 分支名称错误 | `git branch -r` 列出远程分支，提示用户选择 |
| commit 不存在 | commit hash 错误或 abbreviated hash 无法定位 | `git log --oneline -20` 列出近期 commit，提示用户确认；或尝试使用完整 40 位 hash |
| 子路径不存在 | 路径错误或分支/commit 中无此目录 | 列出仓库根目录内容，提示确认路径 |
| 网络超时 | 网络问题 | 提示检查网络或使用镜像站点 |
| Sparse Checkout 失败 | Git 版本过低 | 提示升级 Git 到 2.25+ 或使用完整克隆 |
| npm 包不存在 | 包名错误 | 提示用户确认包名，尝试 `npm search` |
| 本地路径不存在 | 路径错误 | 提示用户确认路径 |
| commit checkout 后仓库内容与预期不符 | commit hash 指向的代码版本不是适配基准 | 提示用户核实 commit hash 是否为鸿蒙化适配时对应的上游版本 |
| rndocUrl 克隆失败 | Git 仓库不可访问 | 回退使用鸿蒙化仓库 README.md 作为文档来源 |
| rndocUrl Web fetch 失败 | 页面不可访问或非 Markdown 内容 | 回退使用鸿蒙化仓库 README.md 作为文档来源 |
| 鸿蒙化仓库无 README.md | 鸿蒙化仓库根目录缺少 README.md | 所有差异项标注 `—`（无文档） |
