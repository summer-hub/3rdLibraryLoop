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

**用途**：通过 npm tgz 发行版对比 RN 三方库的两个版本，生成 diff 文件（.patch）和变更摘要。

**工作方式**：通过 `npm pack` 下载指定版本的 tgz（或使用本地 `.tgz` 文件），解压后用文件系统 diff 对比两个目录。不需要 git 仓库，仅需 npm registry 访问。

**用法**：
```bash
node scripts/generate-diff.js --npm-package <name> --tgz1 <ver1> --tgz2 <ver2> [选项]
```

**选项**：
- `--npm-package <name>`：npm 包名（**必选**），如 `@react-native-async-storage/async-storage`
- `--tgz1 <spec>`：版本1（**必选**）— 可以是版本号（如 `2.2.0`）或本地 `.tgz` 文件路径
- `--tgz2 <spec>`：版本2（**必选**）— 同上
- `--full`：生成包含所有变更的完整 diff（不排除噪音文件）
- `--exclude <pattern>`：在默认排除基础上追加排除路径（可多次指定）
- `--output-dir <path>`：指定输出目录（默认 `./diff`）
- `--files <path>`：从文件列表生成精简 patch（Phase 2 聚焦模式）
- `--verbose`：显示详细调试信息
- `--help, -h`：显示帮助

**默认排除的路径模式**：
- lock 文件：`yarn.lock`, `package-lock.json`, `*.lock`
- 非核心目录：`.yarn/`, `.github/`, `example/`, `examples/`, `docs/`
- 其他平台原生代码（glob 匹配任意层级）：`**/android/**`, `**/ios/**`, `**/apple/**`, `**/windows/**`
- 文档文件：`CHANGELOG.md`, `CONTRIBUTING.md`, `MIGRATION*.md`, `README.md`
- 配置文件：`.gitignore`, `.yarnrc.yml`, `.npmrc`, `.idea/`

**tgz 额外排除的路径**：

npm tgz 包含编译产物和预编译二进制框架，这些在 git 仓库中通常被 `.gitignore` 排除。脚本自动追加以下排除规则以聚焦源码变更：
- 编译产物：`lib/`, `dist/`, `build/`
- source maps：`*.map`
- TypeScript 构建信息：`*.tsbuildinfo`
- 预编译二进制框架：`apple-frameworks/`, `**/*.xcframework/**`, `**/*.framework/**`

> **关于 `**` glob 模式**：含 `**` 的排除模式匹配任意层级的目录。例如 `**/android/**` 会排除根目录 `android/` 和 monorepo 子包 `packages/*/android/` 下的所有文件。鸿蒙适配只关心 JS/TS 源码和 TurboModule Spec，其他平台原生实现无分析价值。

**限制**：
- 不支持 rename 检测。npm 包之间的文件移动较少见，且 diff 内容已能展示差异。
- 接口差异自动判定（rn-scan-exports.cjs）只覆盖 TurboModule Spec（`src/specs/Native*Module.ts`），**不检查 Fabric 组件 Spec**（`codegenNativeComponent` 输入文件）。View 型库（相机/播放器/地图/WebView）须人工 diff 组件 Spec 文件的 props/事件增删，否则可能产生「无需原生适配」假阴性（实测 camera-kit 16.1.3→18.0.0）。

**输出文件**：
- `<version1>/` — 版本1 源代码（解压后的 npm 包）
- `<version2>/` — 版本2 源代码
- `diff_<v1>_<v2>.patch` — 对比 diff 文件
- `summary_<v1>_<v2>.md` — 变更摘要（按文件统计增删行数）
- `structure_<v1>_<v2>.md` — 适配分析报告（接口驱动的结构变更分析）
- `api-diff_<v1>_<v2>.md` — 接口差异适配检查清单（含 checkbox，直接指导适配）

**示例**：
```bash
# 通过 npm pack 下载两个版本对比
node scripts/generate-diff.js \
  --npm-package @react-native-async-storage/async-storage \
  --tgz1 2.2.0 \
  --tgz2 3.1.1 \
  --output-dir ./diff-output

# 使用本地 tgz 文件对比
node scripts/generate-diff.js \
  --npm-package @react-native-async-storage/async-storage \
  --tgz1 /path/to/package-2.2.0.tgz \
  --tgz2 /path/to/package-3.1.1.tgz \
  --output-dir ./diff-output

# 生成完整 diff（不排除任何文件）
node scripts/generate-diff.js \
  --npm-package @react-native-async-storage/async-storage \
  --tgz1 2.2.0 \
  --tgz2 3.1.1 \
  --full

# 在默认排除基础上追加额外排除
node scripts/generate-diff.js \
  --npm-package @react-native-async-storage/async-storage \
  --tgz1 2.2.0 \
  --tgz2 3.1.1 \
  --exclude packages/core/windows/

# --files 精简 patch（Phase 2 聚焦模式）
node scripts/generate-diff.js \
  --npm-package @react-native-async-storage/async-storage \
  --tgz1 2.2.0 \
  --tgz2 3.1.1 \
  --files relevant-files.txt \
  --output-dir ./diff-focused
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
