# libraryTestScan.cjs 使用文档

> 三方库接口 / Demo / XTS 覆盖率扫描统一入口

## 一、简介

`libraryTestScan.cjs` 是一个 Node.js 命令行工具，用于对 **ArkTS / React Native / Flutter** 三类三方库进行：

- **api** — 接口规格说明书生成
- **xts** — XTS / 测试用例覆盖率分析
- **demo** — Demo 覆盖率分析

工具本身不实现分析逻辑，而是在线依赖 gitcode 仓库 [`summor/3rdLibraryLoop`](https://gitcode.com/summor/3rdLibraryLoop/tree/main/MCP/scripts) 下的 13 个 cjs 分析脚本。每次执行时通过 **git clone + sparse checkout** 只拉取 `MCP/scripts` 子目录，然后以子进程方式调用对应脚本完成分析。走 git 协议，不受 gitcode API 匿名限流影响，**无需 token**。

```
用户输入
   │
   ▼
┌─────────────────────────────────────────────────────┐
│  libraryTestScan.cjs                                 │
│  1. 解析参数 (platform + scanType + libroot)         │
│  2. 若 libroot 是 gitcode URL → git clone 仓库       │
│  3. git clone + sparse checkout 拉取 MCP/scripts     │
│  4. 定位 typescript 模块（通过 TYPESCRIPT_PATH 注入）│
│  5. 子进程执行下游脚本 → 输出 Markdown               │
└─────────────────────────────────────────────────────┘
```

---

## 二、环境要求

| 依赖 | 要求 | 说明 |
|------|------|------|
| Node.js | ≥ 16 | 需支持 `fs.rmSync`（递归删除） |
| git | 已安装且在 PATH 中 | 用于克隆目标仓库和脚本仓库 |
| typescript | arkts/rn 分析需要 | flutter 不强制，见下方安装说明 |

### typescript 安装（重要）

arkts 和 rn 的接口提取、覆盖率分析基于 TypeScript Compiler API，依赖 `typescript` 模块。**首次使用前必须在 `Tools/` 目录执行一次 `npm install`**：

```bash
cd Tools
npm install
```

这会根据 `Tools/package.json` 安装 `typescript` 到 `Tools/node_modules/`。

---

## 三、命令格式

```
node libraryTestScan.cjs <platform> <scanType> --libroot <库路径|URL> --output <文档路径>
                        [--title <标题>] [--lib <库名>]
```

### 位置参数

| 参数 | 取值 | 说明 |
|------|------|------|
| `platform` | `arkts` \| `rn` \| `flutter` | 三方库类型 |
| `scanType` | `api` \| `xts` \| `demo` | 扫描类型 |

### 扫描类型说明

| scanType | 含义 | 输出内容 |
|----------|------|----------|
| `api` | 接口规格说明书 | 完整 API 表面文档（类/接口/枚举/方法/属性/字段） |
| `xts` | XTS / 测试覆盖率 | 测试用例对库 API 的覆盖程度报告 |
| `demo` | Demo 覆盖率 | Demo 代码对库 API 的覆盖程度报告 |

> **注意**：rn 平台没有 XTS 概念，`xts` 类型自动映射为 **test 覆盖率分析**（`rn-analyze-test-coverage.cjs`）。

### 必填选项

| 选项 | 说明 |
|------|------|
| `--libroot <path\|url>` | 库源码根目录路径 或 gitcode URL（详见 [第五节](#五libroot-输入方式)） |
| `--output <path>` | 输出 Markdown 文档路径 |

### 可选选项

| 选项 | 说明 |
|------|------|
| `--title <t>` | 报告标题覆盖（默认使用库名自动生成） |
| `--lib <name>` | 库名覆盖（默认从源码自动提取） |
| `--help` / `-h` | 打印帮助信息 |

---

## 四、平台 × 扫描类型映射

| 平台 | api | xts | demo |
|------|-----|-----|------|
| **arkts** | `render-spec-doc.cjs` | `analyze-xts-coverage.cjs` | `analyze-demo-coverage.cjs` |
| **flutter** | `flutter-render-spec-doc.cjs` | `flutter-analyze-xts-coverage.cjs` | `flutter-analyze-demo-coverage.cjs` |
| **rn** | `rn-render-spec-doc.cjs` | `rn-analyze-test-coverage.cjs` | `rn-analyze-demo-coverage.cjs` |

每个主脚本（main）通过相对 `require` 依赖对应的 extract 脚本（deps），工具会一并拉取：

| 平台 | deps |
|------|------|
| arkts | `extract-interfaces.cjs` |
| flutter | `flutter-extract-interfaces.cjs` |
| rn | `rn-extract-interfaces.cjs` |

---

## 五、--libroot 输入方式

`--libroot` 支持两种输入：**本地目录路径** 和 **gitcode URL**。

### 方式一：本地目录路径

直接指向库源码根目录。

```bash
--libroot /path/to/lottie_turbo
```

**各平台目录结构约定**：

#### arkts

```
/path/to/lottie_turbo/
├── library/                          ← 库源码（Index.ets 入口）
│   ├── Index.ets
│   ├── src/main/ets/
│   └── src/main/cpp/types/.../Index.d.ts   ← Native .so 声明
└── entry/
    ├── src/main/ets/                 ← Demo 源码（demo 扫描时分析）
    └── src/ohosTest/                 ← XTS 测试源码（xts 扫描时分析）
```

#### flutter

```
/path/to/flutter_lib/
├── lib/                              ← 库源码（<package>.dart 入口）
│   ├── <package>.dart
│   └── src/
├── pubspec.yaml
└── example/
    └── lib/                          ← Demo 源码（demo 扫描时分析）
```

#### rn

```
/path/to/rn_lib/
├── package.json                      ← 鸿蒙化仓库标识
├── harmony/                          ← 鸿蒙适配层
└── src/                              ← TurboModule Spec（Native*.ts）
```

> rn 的 JS 层源码（`index.js` / `index.d.ts`）由下游脚本自动从上游 npm 拉取，无需本地提供。

### 方式二：gitcode URL

支持三种 URL 形式：

```
https://gitcode.com/{owner}/{repo}                          ← 裸仓库 URL（自动探测默认分支，克隆整个仓库）
https://gitcode.com/{owner}/{repo}/tree/{branch}            ← 指定分支，克隆整个仓库
https://gitcode.com/{owner}/{repo}/tree/{branch}[/{subdir}] ← 指定分支 + 子文件夹（sparse checkout）
```

#### 裸仓库 URL

未带 `/tree/{branch}` 时，工具通过 `git ls-remote --symref HEAD` 自动探测仓库默认分支（通常为 `master` 或 `main`），然后浅拷贝整个仓库。适合不确定分支名、想用默认分支的场景。

```bash
node libraryTestScan.js arkts api \
  --libroot https://gitcode.com/CPF-ApplicationTPC/ohos_mqtt \
  --output xx.md
```

#### 指定分支 + 子文件夹

| URL 形式 | 行为 |
|----------|------|
| `.../tree/br_rnoh0.82` | 浅拷贝整个仓库（`--depth 1 --branch br_rnoh0.82`） |
| `.../tree/br_rnoh0.82/harmony` | 仅浅拷贝 `harmony` 子文件夹（sparse checkout） |

#### 分支名探测

分支名可能包含 `/`（如 `feature/v2`），工具通过 `git ls-remote` 从最长路径段到最短路径段逐段试探，第一个匹配的即为真实分支，剩余部分为子文件夹。

```
输入: .../tree/br_rnoh0.82/harmony
试探顺序:
  1. br_rnoh0.82/harmony  → ls-remote 无匹配
  2. br_rnoh0.82          → ls-remote 有匹配 ✓
结果: 分支=br_rnoh0.82, 子文件夹=harmony
```

#### 克隆目标

仓库克隆到 `__dirname/.libraryTestScan-repos/` 目录下，命名格式为 `{repo}-{ref安全化}`：

```
.libraryTestScan-repos/
└── rntpc_lottie-react-native-br_rnoh0.82/
    ├── .git/
    ├── harmony/              ← sparse checkout 只包含此目录
    ├── package.json
    └── ...
```

> 每次执行会先删除旧目录再重新克隆。

---

## 六、脚本拉取机制

### 下载方式

通过 **git clone + sparse checkout** 只拉取脚本仓库的 `MCP/scripts` 子目录：

```
git clone --depth 1 --branch main --no-checkout https://gitcode.com/summor/3rdLibraryLoop.git
git sparse-checkout init --no-cone
echo "/MCP/scripts/" > .git/info/sparse-checkout
git checkout main
```

走 git 协议，**不受 gitcode API 匿名限流影响，无需 token**。

### 缓存策略

**每次执行都重新克隆**，先删除旧目录再重新 sparse checkout，确保始终使用线上最新版本。

```
.libraryTestScan-cache/
└── MCP/
    └── scripts/
        ├── extract-interfaces.cjs
        ├── render-spec-doc.cjs
        ├── analyze-demo-coverage.cjs
        ├── analyze-xts-coverage.cjs
        ├── flutter-extract-interfaces.cjs
        ├── flutter-render-spec-doc.cjs
        ├── flutter-analyze-demo-coverage.cjs
        ├── flutter-analyze-xts-coverage.cjs
        ├── rn-extract-interfaces.cjs
        ├── rn-render-spec-doc.cjs
        ├── rn-analyze-demo-coverage.cjs
        ├── rn-analyze-test-coverage.cjs
        ├── rn-scan-exports.cjs
        └── deveco_docs.js
```

> sparse checkout 只拉取 `MCP/scripts/` 下的脚本文件，不拉取 `MCP/` 父目录的其他文件（AGENTS.md、config.json 等）。

---

## 七、使用示例

### 7.1 ArkTS

```bash
# 接口规格说明书
node libraryTestScan.cjs arkts api \
  --libroot /path/to/lottie_turbo \
  --output 01-lottie-接口规格说明书.md

# Demo 覆盖率
node libraryTestScan.cjs arkts demo \
  --libroot /path/to/lottie_turbo \
  --output 02-lottie-Demo覆盖率报告.md

# XTS 覆盖率
node libraryTestScan.cjs arkts xts \
  --libroot /path/to/lottie_turbo \
  --output 03-lottie-XTS覆盖率报告.md
```

### 7.2 React Native

```bash
# 接口规格说明书
node libraryTestScan.cjs rn api \
  --libroot /path/to/rn_netinfo \
  --output 01-netinfo-接口规格说明书.md

# 测试覆盖率（xts 类型对 rn 映射为 test 覆盖率）
node libraryTestScan.cjs rn xts \
  --libroot /path/to/rn_netinfo \
  --output 03-netinfo-Test覆盖率报告.md

# Demo 覆盖率
node libraryTestScan.cjs rn demo \
  --libroot /path/to/rn_netinfo \
  --output 02-netinfo-Demo覆盖率报告.md
```

### 7.3 Flutter

```bash
# 接口规格说明书
node libraryTestScan.cjs flutter api \
  --libroot /path/to/advertising_id \
  --output 01-advertising-接口规格说明书.md

# XTS 覆盖率
node libraryTestScan.cjs flutter xts \
  --libroot /path/to/advertising_id \
  --output 03-advertising-XTS覆盖率报告.md

# Demo 覆盖率
node libraryTestScan.cjs flutter demo \
  --libroot /path/to/advertising_id \
  --output 02-advertising-Demo覆盖率报告.md
```

### 7.4 使用 gitcode URL

```bash
# 裸仓库 URL（自动探测默认分支）
node libraryTestScan.cjs arkts api \
  --libroot https://gitcode.com/CPF-ApplicationTPC/ohos_mqtt \
  --output 01-mqtt-接口规格说明书.md

# 整个仓库（指定分支）
node libraryTestScan.cjs rn api \
  --libroot https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.82 \
  --output 01-lottie-rn-接口规格说明书.md

# 仅 harmony 子文件夹（sparse checkout 浅拷贝）
node libraryTestScan.cjs rn api \
  --libroot https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.82/harmony \
  --output 01-lottie-rn-接口规格说明书.md
```

### 7.5 使用可选 flag

```bash
# 自定义报告标题
node libraryTestScan.cjs arkts demo \
  --libroot /path/to/lottie_turbo \
  --output report.md \
  --title "Lottie Turbo Demo 覆盖率专项报告"

# 自定义库名（库自身 oh-package.json5 缺 name 字段时有用）
node libraryTestScan.cjs flutter api \
  --libroot /path/to/flutter_lib \
  --output spec.md \
  --lib my_flutter_lib
```

---

## 八、执行流程

```
1. 解析 CLI 参数
   ├── 校验 platform (arkts|rn|flutter)
   ├── 校验 scanType (api|xts|demo)
   └── 校验 --libroot / --output 必填
         │
2. 解析 --libroot
   ├── 是 gitcode URL?
   │   ├── 裸仓库 URL → 探测默认分支 → git clone 整个仓库
   │   ├── 指定分支 → git clone 整个仓库
   │   └── 指定分支+子目录 → git clone + sparse checkout
   └── 否 → 校验本地目录存在且为目录
         │
3. git clone + sparse checkout 拉取 MCP/scripts 脚本
   └── 每次先删除旧目录再重新克隆
         │
4. 定位 typescript 模块
   ├── Tools/node_modules/typescript（npm install 后）
   ├── 向上查找 MCP/node_modules 等
   └── 找到 → 注入 TYPESCRIPT_PATH 环境变量
         │
5. 子进程执行下游脚本
   ├── node <main.cjs> --libroot <path> --output <path> [--title] [--lib]
   └── stdio 继承（实时输出进度）
         │
6. 返回退出码
   ├── 0 → 成功，输出文档已生成
   └── 非 0 → 失败，查看日志排查
```

---

## 九、输出产物

### api 扫描 — 接口规格说明书

Markdown 文档，包含：

- 基本信息（库名、入口文件、Native 声明、源文件数）
- 接口统计（类/接口/枚举总数、方法/属性/字段数）
- 按类分组的接口详情（方法表、属性表、字段表、枚举值表、函数表、变量表、类型别名表）
- 事件方法汇总
- 源文件列表

### xts / demo 扫描 — 覆盖率报告

Markdown 文档，包含：

- 覆盖率总览（方法级覆盖率百分比 + 进度条）
- 按接口类型统计（method/property/field/enumValue/function/variable）
- 类级覆盖率明细
- 未覆盖接口详情（按类分组，含参数和返回类型）
- 已覆盖接口详情（含覆盖文件列表）
- 文件覆盖详情
- 覆盖率提升建议（优先级排序的未覆盖接口清单）

---

## 十、目录结构

工具运行时会在脚本同级目录生成两个工作目录：

```
Tools/
├── libraryTestScan.cjs
├── package.json                      ← 声明 typescript 依赖
├── node_modules/                     ← npm install 后生成
│   └── typescript/
├── .libraryTestScan-cache/           ← 脚本仓库 sparse checkout（每次重新克隆）
│   ├── .git/
│   └── MCP/
│       └── scripts/                  ← 只包含此目录的脚本文件
│           ├── extract-interfaces.cjs
│           ├── render-spec-doc.cjs
│           └── ... (共 13 个 cjs + 1 个 deveco_docs.js)
└── .libraryTestScan-repos/           ← git 克隆的目标仓库（仅 --libroot 为 URL 时）
    └── ohos_mqtt-master/
        ├── .git/
        └── ... (仓库内容)
```

| 目录 | 何时生成 | 生命周期 |
|------|----------|----------|
| `node_modules` | 用户执行 `npm install` 后 | 持久（除非手动删除） |
| `.libraryTestScan-cache` | 每次执行 | 每次先删除再克隆 |
| `.libraryTestScan-repos` | `--libroot` 为 URL 时 | 每次先删除再克隆 |

---

## 十一、常见问题

### Q1: arkts/rn 分析报错 "无法加载 typescript 模块"

**原因**：arkts 和 rn 的接口提取、覆盖率分析基于 TypeScript Compiler API，需要 `typescript` 模块。

**解决**：在 `Tools/` 目录执行 `npm install`：

```bash
cd Tools
npm install
```

这会根据 `Tools/package.json` 安装 `typescript` 到 `Tools/node_modules/`。工具会自动找到它并通过 `TYPESCRIPT_PATH` 环境变量注入给下游脚本。

> flutter 走纯正则匹配，不依赖 typescript，可跳过安装。

### Q2: 脚本仓库克隆失败

**原因**：网络问题或 git 配置问题。

**排查**：

```bash
# 1. 确认 git 能访问 gitcode
git ls-remote https://gitcode.com/summor/3rdLibraryLoop.git HEAD

# 2. 若报 407（Proxy Authentication Required）→ 代理认证问题
#    检查代理配置：
git config --global --get http.proxy
git config --global --get https.proxy
#    不需要代理时清除：
git config --global --unset http.proxy
git config --global --unset https.proxy
```

### Q3: 目标仓库克隆失败

**排查**：

1. 确认 `git` 已安装且在 PATH 中：`git --version`
2. 确认 URL 格式正确（裸仓库 URL 或含 `/tree/{branch}`）
3. 确认分支存在：`git ls-remote https://gitcode.com/{owner}/{repo}.git {branch}`
4. 私有仓库需配置 git 凭证
5. 报 407 时见 Q2 的代理排查步骤

### Q4: Windows 下覆盖率报告显示 0%

**原因**：Windows 路径分隔符 `\` 与 TS 编译器内部的 `/` 不一致，导致源文件加载失败。

**状态**：已修复。所有 arkts/rn 覆盖率脚本已统一用 `toPosix()` 归一化路径。确保 `git pull` 拿到最新脚本即可。

### Q5: 库名识别错误导致覆盖率 0%

**原因**：部分库（如 `ohos_mqtt`）的 `oh-package.json5` 缺顶层 `name` 字段，工具误取工程名或 `author.name`。

**解决**：

- **方式一**：用 `--lib` flag 手动指定真实包名
  ```bash
  node libraryTestScan.cjs arkts demo --libroot https://gitcode.com/CPF-ApplicationTPC/ohos_mqtt --output demo.md --lib @ohos/mqtt
  ```
- **方式二**：已修复的脚本会从 `entry/oh-package.json5` 的 dependencies 反查真实包名，`git pull` 拿到最新脚本即可自动识别。

### Q6: rn 分析提取 0 个接口

**原因**：rn 库的 JS 层源码从上游 npm 拉取，若 `package.json` 中无法推断上游包名/版本，或上游包在 npm 上不存在，会导致提取失败。

**排查**：检查 `package.json` 的 `dependencies` 是否包含上游 RN 包，或 README 中是否声明了上游包信息。

### Q7: flutter 子文件夹 URL 克隆后提取 0 接口

**原因**：sparse checkout 只下载了子文件夹，若该文件夹下没有 `pubspec.yaml` 和 `lib/` 目录，flutter 接口提取无法定位入口。

**解决**：使用整个仓库 URL 而非子文件夹 URL，或确保子文件夹包含完整的 flutter 库结构。

---

## 十二、退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功，输出文档已生成 |
| 1 | 失败（参数错误、下载失败、克隆失败、下游脚本执行失败等） |

---

## 十三、在线脚本源码

所有 cjs 脚本位于 gitcode 仓库：

> https://gitcode.com/summor/3rdLibraryLoop/tree/main/MCP/scripts

| 脚本 | 平台 | 功能 |
|------|------|------|
| `extract-interfaces.cjs` | arkts | 接口提取（TS Compiler API） |
| `render-spec-doc.cjs` | arkts | 接口规格文档渲染 |
| `analyze-demo-coverage.cjs` | arkts | Demo 覆盖率分析（AST + 正则） |
| `analyze-xts-coverage.cjs` | arkts | XTS 覆盖率分析（AST + 正则） |
| `flutter-extract-interfaces.cjs` | flutter | 接口提取（Dart 正则） |
| `flutter-render-spec-doc.cjs` | flutter | 接口规格文档渲染 |
| `flutter-analyze-demo-coverage.cjs` | flutter | Demo 覆盖率分析（纯正则） |
| `flutter-analyze-xts-coverage.cjs` | flutter | XTS 覆盖率分析（纯正则） |
| `rn-extract-interfaces.cjs` | rn | 接口提取（npm 拉取 + JS 导出解析） |
| `rn-render-spec-doc.cjs` | rn | 接口规格文档渲染 |
| `rn-analyze-demo-coverage.cjs` | rn | Demo 覆盖率分析（AST） |
| `rn-analyze-test-coverage.cjs` | rn | 测试覆盖率分析（AST） |
| `rn-scan-exports.cjs` | rn | 导出接口扫描 + 双目录对比 |
| `deveco_docs.js` | 通用 | 鸿蒙 API 文档检索（devecocli 封装） |

> flutter 脚本走纯正则匹配，不依赖 typescript，Windows 下无路径兼容问题。
> arkts/rn 脚本走 TS Compiler API，已修复 Windows 路径分隔符兼容性。
