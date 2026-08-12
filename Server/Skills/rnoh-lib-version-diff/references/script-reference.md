# 版本分析与差异生成 — 脚本参考

所有脚本位于本 skill 的 `scripts/` 目录下，可直接运行。

## detect-upstream-version.js

**用途**：从 RN 鸿蒙三方库 git 仓库链接中，分析出鸿蒙化仓库基于上游的哪个版本，同时查询 npm registry 获取最新发布版本。

**用法**：
```bash
node scripts/detect-upstream-version.js [选项] <git-repo-url>
```

**选项**：
- `-q, --quiet`：只输出 `<当前版本> <最新版本> <状态> <最近10个版本>`
- `-v, --verbose`：显示详细输出
- `-h, --help`：显示帮助

**支持的 URL 格式**：
- `https://gitcode.com/<owner>/<repo>`
- `https://gitcode.com/<owner>/<repo>/blob/<branch>`
- `https://gitcode.com/<owner>/<repo>/tree/<branch>`
- `https://github.com/<owner>/<repo>`
- `https://github.com/<owner>/<repo>/tree/<branch>`
- `git@gitcode.com:<owner>/<repo>.git`

**工作原理**：
1. 解析 git URL，提取平台、owner、repo、分支
2. 构造 raw URL 获取 package.json（回退顺序：raw URL → gitcode API → GitHub API → Gitee API → git clone）
3. 从 package.json 的 `harmony.alias` 字段或依赖列表中匹配上游包名
4. 查询 npm registry（回退顺序：packument API → /latest 端点 → npm view 命令）
5. 比较版本差距，输出状态

**包名推断规则**：
- `rntpc_<pkg-name>` → 去除 `rntpc_` 前缀
- `react-native-ohos-<name>` → 转为 `react-native-<name>`
- 其他 → 直接使用仓库名

**输出示例**：
```
[INFO] 正在获取 package.json: https://raw.gitcode.com/CPF-RN/rntpc_lottie-turbo-react-native/raw/br_rnoh0.77/package.json
[OK] 成功获取并解析 package.json
[INFO] 上游包名: lottie-react-native
[INFO] 鸿蒙化版本: 7.2.2
[INFO] npm 最新版本: 7.4.0
[INFO] 版本状态: behind (落后 2 个小版本)

鸿蒙化版本: 7.2.2
npm 最新版本: 7.4.0
版本状态: behind
最近10个版本: 7.4.0, 7.3.1, 7.2.2, 7.2.1, 7.1.0, ...
```

---

## generate-diff.js

**用途**：从同一 Git 仓库的两个分支/tag 中生成对比 diff 文件（.patch）和变更摘要。

**用法**：
```bash
node scripts/generate-diff.js --repo <url> --branch1 <name> --branch2 <name> [选项]
```

**选项**：
- `--repo <url>`：上游仓库 URL（**必选**）
- `--branch1 <name>`：基线版本分支/标签（**必选**）
- `--branch2 <name>`：目标版本分支/标签（**必选**）
- `--full`：生成包含所有变更的完整 diff（不排除噪音文件）
- `--exclude <pattern>`：在默认排除基础上追加排除路径（可多次指定）
- `--output-dir <path>`：指定输出目录（默认 `./diff`）
- `--keep-repo`：保留克隆的仓库（用于调试）
- `--verbose`：显示详细调试信息
- `--help, -h`：显示帮助

> **重要**：`--repo` 必须是**上游社区仓库 URL**（如 `https://github.com/lottie-react-native/lottie-react-native`），**不是**鸿蒙化仓库 URL。

**默认排除的路径模式**：
- lock 文件：`yarn.lock`, `package-lock.json`, `*.lock`
- 非核心目录：`.yarn/`, `.github/`, `example/`, `docs/`
- 文档文件：`CHANGELOG.md`, `CONTRIBUTING.md`, `MIGRATION*.md`, `README.md`
- 配置文件：`.gitignore`, `.yarnrc.yml`, `.npmrc`, `.idea/`

**输出文件**：
- `<branch1>/` — 分支1 源代码（无 .git）
- `<branch2>/` — 分支2 源代码（无 .git）
- `diff_<b1>_<b2>.patch` — 对比 diff 文件
- `summary_<b1>_<b2>.md` — 变更摘要（按文件统计增删行数）

**示例**：
```bash
# 对比 lottie v7.2.2 和 v7.4.0（默认排除噪音）
node scripts/generate-diff.js \
  --repo https://github.com/lottie-react-native/lottie-react-native \
  --branch1 v7.2.2 \
  --branch2 v7.4.0

# 指定输出目录
node scripts/generate-diff.js \
  --repo https://github.com/lottie-react-native/lottie-react-native \
  --branch1 v7.2.2 \
  --branch2 v7.4.0 \
  --output-dir ./diff-output

# 在默认排除基础上追加额外排除
node scripts/generate-diff.js \
  --repo https://github.com/lottie-react-native/lottie-react-native \
  --branch1 v7.2.2 \
  --branch2 v7.4.0 \
  --exclude packages/core/windows/
```

---

## 版本标签查询

### 查看可用分支

```bash
git ls-remote --heads <仓库URL>
```

### 查看可用标签

```bash
git ls-remote --tags <仓库URL>
```

### 常见分支命名规则

| 平台 | 鸿蒙化分支命名 | 示例 |
|------|---------------|------|
| GitCode (CPF-RN) | `br_rnoh<版本>` | `br_rnoh0.77`, `br_rnoh0.82`, `br_rnoh0.84` |
| GitHub (react-native-oh-library) | `main` 或 `rnoh_<版本>` | `rnoh_0.77`, `rnoh_0.82` |

### 常见版本标签格式

| 格式 | 示例 |
|------|------|
| `v` + 版本号 | `v7.2.2`, `v7.4.0` |
| 纯版本号 | `7.2.2`, `7.4.0` |
| commit hash | `a1b2c3d` |
