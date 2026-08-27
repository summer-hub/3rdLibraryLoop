---
name: arkts-library-source-clone
description: 克隆鸿蒙 ArkTS 三方库 Git 仓库源码到工作目录的固定路径 source/ 目录下（git clone，支持分支/子路径），并记录克隆元信息。作为 ArkTS 仓库检视流程的第一阶段（源码准备），供后续接口分析与各维度检视 SKILL 复用。当需要下载/克隆 ArkTS 三方库源码到固定路径时调用。
license: Apache-2.0
compatibility: 需要 git 命令行工具和网络访问（Gitee/GitCode/GitHub）。
metadata:
  version: "1.1.0"
  category: harmonyos-development
  language: ArkTS/ETS
  useWhen: ArkTS 仓库检视流程第一步，克隆仓库源码到 {outputDir}/source/ 固定路径
---

# ArkTS 三方库源码下载（固定路径克隆）

将 ArkTS 三方库仓库源码克隆到工作目录的**固定路径** `{outputDir}/source/`，供后续接口分析（arkts-library-interface-spec）与各维度检视 SKILL 直接复用。

> ⚠️ **核心原则**：源码必须克隆到 `{outputDir}/source/` 固定路径（后续所有检视 SKILL 均从该路径读取源码）。**不要**克隆到 `{outputDir}/{仓库名}` 等其他目录。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `outputDir` | string | ✅ | 工作目录（即任务下发的"工作目录"，绝对路径），源码克隆到 `outputDir/source/` |
| `repoUrl` | string | ✅ | 仓库 Git 地址，支持分支参数 `?branch=xxx` 或 `/tree/xxx` 路径形式 |

**派生变量**：
- `repoName`：从 `repoUrl` 提取仓库名（取 URL 最后一段，去掉 `.git` 后缀，用于报告标识）
- `sourceDir`：源码目录 = `outputDir/source`（**固定路径，禁止变更**）
- `baseUrl`：去掉分支参数后的仓库基础地址

---

## 输入依赖

- **前置 SKILL**：无（本 SKILL 是 ArkTS 仓库检视流程的第一阶段）
- **输入文件**：无（通过 `repoUrl` 克隆源码）
- **下游消费者**：`arkts-library-interface-spec`（接口分析）、`arkts-library-stability-check`、`arkts-library-memory-leak-check`、`arkts-library-documentation-quality-check`、`arkts-library-test-coverage-check`（均从 `{outputDir}/source/` 读取源码）

---

## 工作流程

### 步骤 1：解析仓库地址

从 `repoUrl` 解析出 `baseUrl` 与 `branch`：

| URL 形式 | baseUrl | branch |
|----------|---------|--------|
| `https://gitee.com/openharmony-sig/lottie` | 同原 URL | 默认分支 |
| `https://gitcode.com/xxx/repo/tree/dev_ohos` | `https://gitcode.com/xxx/repo` | `dev_ohos` |
| `https://github.com/xxx/repo.git#branch=develop` | `https://github.com/xxx/repo.git` | `develop` |
| `https://gitee.com/xxx/repo?branch=master` | `https://gitee.com/xxx/repo` | `master` |

### 步骤 2：克隆源码到固定路径

若 `sourceDir`（`outputDir/source`）已存在且含有效仓库源码（存在 `.git` 目录或 `oh-package.json5` / 入口文件，入口文件名大小写不敏感），直接复用，跳过克隆。

否则执行克隆：

```bash
# 指定分支
git clone --depth=1 -b {branch} {baseUrl} {outputDir}/source

# 未指定分支（默认分支）
git clone --depth=1 {baseUrl} {outputDir}/source
```

克隆失败时按序降级重试：
1. 去掉 `--depth=1` 改为完整克隆
2. 去掉 `-b {branch}`（克隆默认分支后 `git checkout {branch}`，失败则使用默认分支）

> ⚠️ 判定克隆失败以**命令退出码非 0 或目标目录无仓库内容**为准。GitCode 仓库克隆时输出"警告：重定向到 .../xxx.git/"属**正常行为**（GitCode 自动补全 `.git` 后缀重定向），不代表克隆失败，**不应**因此触发降级重试。

> ⚠️ 克隆目标必须是 `{outputDir}/source`（目录本身即仓库根），**不要**克隆成 `{outputDir}/source/{repoName}`。

### 步骤 3：验证与记录元信息

1. **验证**：用 `list_dir` 确认 `sourceDir` 下存在源码文件（`.ets` / `.ts` / `oh-package.json5` / 入口文件 / `module.json5` 任一即可）

   > ⚠️ **验证注意事项**：
   > - **入口文件大小写不敏感**：ArkTS 库入口文件可能是 `index.ets`（小写，如 mp3agic）或 `Index.ets`（大写），两者均视为有效。macOS（大小写不敏感文件系统）上按字面匹配可偶然命中，但在 Linux（大小写敏感文件系统）上按字面匹配会漏判，匹配时必须显式做大小写不敏感处理。
   > - **源码文件可能是 `.ts` 扩展名**：部分 ArkTS 库（如 mp3agic，`src/main/ets/` 下 48 个源文件全部为 `.ts`）的实现源码是 `.ts` 文件，`library/` 下仅入口 `index.ets` 一个 `.ets` 文件。**禁止以 `.ets` 文件数量作为源码存在的唯一判据**，应以 `oh-package.json5` / `module.json5` / 入口文件的存在为准。

2. **记录元信息**：将克隆信息写入 `{outputDir}/clone-info.json`：

```json
{
  "repoUrl": "{原始 repoUrl}",
  "baseUrl": "{baseUrl}",
  "branch": "{branch 或 null}",
  "commit": "{git rev-parse HEAD 结果}",
  "repoName": "{repoName}",
  "sourceDir": "{outputDir}/source",
  "cloneTime": "{timestamp}"
}
```

3. **失败处理**：若所有克隆方式均失败，在结果文件中说明失败原因并标注 `状态: 失败`，终止后续步骤。

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 仓库源码 | `{outputDir}/source/` | 固定路径，后续所有检视 SKILL 的源码输入 |
| 克隆元信息 | `{outputDir}/clone-info.json` | baseUrl / branch / commit / repoName |

> ⚠️ **下游消费提示**：库实现源码文件可能为 `.ts` 扩展名（如 mp3agic），下游 SKILL 扫描源码时应同时包含 `*.ets` 与 `*.ts`（路径限定在 `src/main/ets/` 下），入口统一从 `index.ets` 解析导出。

所有产物写入 `{outputDir}` 目录。本 SKILL 无评分，无需输出结构化指标文件。
