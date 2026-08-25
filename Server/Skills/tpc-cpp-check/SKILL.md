---
name: tpc-cpp-check
description: 检视 tpc_c_cplusplus 仓库适配库 PR 的规范性，包括编译脚本(HPKBUILD)、文档格式、目录结构、SHA512SUM 等，并输出结构化检视报告。当用户需要对 C/C++ 三方库 PR 进行规范性检视时调用。支持 GitCode 平台。仅基于 PR 差异和 API 获取文件内容进行检视，无需克隆整个仓库。
license: Apache-2.0
compatibility: 需要 curl、网络访问 GitCode API 的权限，无需 git clone
metadata:
  version: "1.0.0"
  platform: gitcode
  libraryType: tpccplus
---
# TpcCheckSkill — tpc_c_cplusplus 适配库 PR 规范性检视

## 概述

本 Skill 负责对 tpc_c_cplusplus 仓库中适配库 PR 进行规范性检视，包括编译脚本（HPKBUILD）、文档格式（README_zh.md、hap_integrate.md）、目录结构、SHA512SUM、README.OpenSource 等的合规性检查，输出结构化检视报告。

**核心设计原则：仅基于 PR 内容进行检视，不克隆整个仓库。** 所有文件内容通过 GitCode API 按需获取，只审查 PR 中实际变更的文件。

**关键特性**：
- **零克隆**：通过 GitCode API 获取 PR diff 和文件内容，无需 `git clone`，大幅减少时间和资源消耗
- 支持**增量检视**（已有库修改）和**全量检视**（新增库）两种模式
- 重点检查 HPKBUILD 编译脚本的字段完整性、函数规范性、构建类型合规性
- 检查文档格式与内容、SHA512SUM 校验、Patch 命名等
- 输出按严重程度分级的结构化报告

**重要：所有输出文档必须使用中文。**

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `prUrl` | ✅ | PR 地址，如 `https://gitcode.com/tpc_c_cplusplus/thirdparty/pulls/123` |
| `outputDir` | ✅ | 输出目录绝对路径，如 `/path/to/codecheck/owner_repo_pr123` |
| `libraryType` | ❌ | 固定为 `tpccplus` |
| `accessToken` | ❌ | GitCode API 访问令牌；GitCode API 强烈建议提供 |
| `branch` | ❌ | 目标分支名；若提供则优先使用 |

---

## 工作流程

### Phase 1：信息收集（仅 API 调用，不克隆仓库）

#### 1.1 解析 PR 地址

从 `prUrl` 提取：`platform`、`owner`、`repo`、`prNumber`。

| 平台 | URL 模式 | API 支持 |
|------|----------|----------|
| GitCode | `https://gitcode.com/{owner}/{repo}/pulls/{num}` | ✅ **API 优先** |
| Gitee | `https://gitee.com/{owner}/{repo}/pulls/{num}` | 部分 API |
| GitHub | `https://github.com/{owner}/{repo}/pull/{num}` | API diff |
| GitLab | `https://gitlab.com/{owner}/{repo}/-/merge_requests/{num}` | API diff |

#### 1.2 获取 PR 元数据

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}?access_token={accessToken}"
```

提取：`title`、`base.ref`（目标分支）、`head.sha`、`user.name`、`created_at`、`state`

#### 1.3 获取 PR 文件变更列表

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}/files?access_token={accessToken}&per_page=100"
```

返回 PR 中所有变更文件的列表，每个条目包含：
- `filename`：文件路径
- `status`：变更类型（added / modified / removed / renamed）
- `additions`：新增行数
- `deletions`：删除行数
- `patch`：文件 diff 内容（若文件不大）

> **分页处理**：若文件数超过 100，使用 `page` 参数翻页获取全部。

#### 1.4 获取 PR Diff（完整补丁）

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}/diff?access_token={accessToken}" -o {outputDir}/pr.diff
```

或通过 commit patch 获取（适用于 squash merge 场景）：

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/commit/{head.sha}/patch?access_token={accessToken}" -o {outputDir}/pr.patch
```

> **注意**：commit 路径使用 `commit`（单数），不是 `commits`

将 diff/patch 保存到 `{outputDir}/pr.diff` 供后续分析。

#### 1.5 按需获取文件内容（替代 git clone）

**核心机制：只获取 PR 中变更的文件内容，不克隆整个仓库。**

对 PR 中每个变更的文件，通过 API 获取其内容：

```bash
# 获取 PR head 分支上的文件内容（变更后的版本）
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/contents/{filePath}?ref={head.sha}&access_token={accessToken}"
```

返回 JSON 包含 `content` 字段（Base64 编码），解码后得到文件内容：

```bash
echo "{content}" | base64 -d > {outputDir}/files/{filePath}
```

> **大文件处理**：若文件超过 1MB，API 可能返回错误，此时使用 `?ref={head.sha}&download=true` 参数直接获取原始内容。

对于需要对比的情况（检查删除/修改的旧内容），可获取 base 分支上的文件：

```bash
# 获取目标分支上的文件内容（变更前的版本）
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/contents/{filePath}?ref={base.ref}&access_token={accessToken}"
```

#### 1.6 获取适配库目录结构（仅目录列表，不下载文件）

判断检视策略时需要知道 base 分支上是否已存在该库目录：

```bash
# 查询 base 分支上的目录结构
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/contents/{libDir}?ref={base.ref}&access_token={accessToken}"
```

返回目录下的文件和子目录列表（仅名称和类型，不下载内容），用于：
- 判断是**增量检视**还是**全量检视**
- 增量检视时了解未变更文件是否存在（不获取其内容）

> **注意**：API 返回的目录列表可能不完整（子目录深度有限），若需检查深层目录（如 `docs/pic/`），可单独请求子目录。

---

### Phase 2：差异分析与检视策略判断

#### 2.1 识别变更的适配库目录

从 PR 文件变更列表（1.3 的返回结果）中提取变更文件路径，识别涉及的适配库目录：
- `thirdparty/<libname>/` → thirdparty 类型的适配库
- `community/<libname>/` → community 类型的适配库

若 PR 涉及多个适配库目录，需分别对每个库独立检视。

#### 2.2 判断检视策略：增量 vs 全量

**判断方法**：通过 1.6 步骤获取的 base 分支目录列表，判断该库目录是否已存在：

- **目录存在** → 已有库的修改 → **增量检视**：仅检查 PR 中变更的文件的规范性
- **目录不存在** → 新增库 → **全量检视**：对所有必需文件和可选文件进行完整合规性检查

> **全量检视时的文件获取**：全量检视需要检查所有必需文件，对 PR 中未变更的必需文件，需通过 API 单独获取其内容进行审查。但若某必需文件既不在 PR 变更中，也不在 base 分支上，则记录为"缺失"问题。

#### 2.3 统计改动规模

从 PR 文件变更列表统计：文件数、新增/删除行数、变更类型分布。

#### 2.4 获取变更文件的完整内容

对 Phase 3 检视需要审查的每个文件，按 1.5 的方法获取其完整内容并保存到 `{outputDir}/files/` 目录下。

**按需获取原则**：
- HPKBUILD：必须获取完整内容
- SHA512SUM：必须获取完整内容
- README.OpenSource：必须获取完整内容
- README_zh.md：必须获取完整内容
- docs/hap_integrate.md：若 PR 变更了此文件或为全量检视，获取完整内容
- HPKCHECK：若存在，获取完整内容
- OAT.xml：仅检查是否存在，不获取内容
- Patch 文件：若 PR 变更了 patch，获取完整内容

---

### Phase 3：规范性检视

> 详细检查项参见 [references/CHECKLIST.md](references/CHECKLIST.md)

#### 3.1 目录结构检查

**thirdparty 适配库必需文件**：

| 文件 | 必需性 | 检查方式 |
|------|--------|----------|
| HPKBUILD | **必需** | PR 变更内容 + API |
| SHA512SUM | **必需** | PR 变更内容 + API |
| README.OpenSource | **必需** | PR 变更内容 + API |
| README_zh.md | **必需** | PR 变更内容 + API |
| docs/ | **必需** | 目录列表 API |
| docs/hap_integrate.md | **必需** | PR 变更内容 + API |
| docs/pic/ | 有文档时必需 | 目录列表 API |
| HPKCHECK | 建议 | 目录列表 API |
| OAT.xml | 建议 | 目录列表 API |

**community 适配库必需文件**：

| 文件 | 必需性 | 检查方式 |
|------|--------|----------|
| HPKBUILD | **必需** | PR 变更内容 + API |
| SHA512SUM | **必需** | PR 变更内容 + API |

其余文件为可选但建议有。

> **增量检视**：仅检查 PR 中变更的文件是否存在规范性问题，不对未变更的文件提出缺失问题。
> 
> **全量检视**：对所有必需文件进行完整性检查，缺失的必需文件记为 Critical 问题。

#### 3.2 HPKBUILD 检查（重点维度）

读取通过 API 获取的 HPKBUILD 文件完整内容，逐项检查。

**必需字段**：

| 字段 | 必需 | 说明 |
|------|------|------|
| `pkgname` | 必需 | 与目录名一致 |
| `pkgver` | 必需 | 上游版本号，与上游 tag 一致；**不能是 `master`** |
| `pkgrel` | 必需 | 发布号，默认 0 |
| `pkgdesc` | 必需 | 简短描述 |
| `url` | 必需 | 上游官网链接 |
| `archs` | 必需 | 必须包含 `armeabi-v7a` `arm64-v8a` `x86_64` |
| `license` | 必需 | 许可证数组 |
| `depends` | 必需 | 依赖库名数组 |
| `makedepends` | 必需 | 构建依赖数组 |
| `source` | 必需 | 源码下载链接 |
| `downloadpackage` | 必需 | true/false |
| `autounpack` | 必需 | true/false |
| `builddir` | 必需 | 解压后目录名 |
| `packagename` | 必需 | 压缩包名 |

**pkgver 版本号规范**：
1. 必须与上游 tag 名称一致（含 `v` 前缀）
2. 不能是 `master`，无合适 release tag 时应使用 commit hash
3. commit hash 作为 pkgver 时，不应使用额外的 `commitid` 变量
4. pkgver 与 builddir 的关系：不带 `v` → `builddir=$pkgname-${pkgver}`；带 `v` → `builddir=$pkgname-${pkgver:1}`

**必需函数**：`prepare()`、`build()`、`package()`、`check()`、`cleanbuild()`

**构建类型检查**：

| buildtools | 必须包含 |
|------------|----------|
| cmake | 使用 `${OHOS_SDK}/native/build-tools/cmake/bin/cmake`，`-DOHOS_ARCH=$ARCH` |
| configure | `source envset.sh`，`setXXXENV`/`unsetXXXENV` |
| automake | `source envset.sh`，`setXXXENV`/`unsetXXXENV` |
| make | `source envset.sh`，使用 `$CC` |
| meson | `source envset.sh`，`--cross-file`，`ninja -C` |

**必需头部**：Apache 2.0 许可证头部 + Contributor/Maintainer 信息

> 详细检查项参见 [references/HPKBUILD_GUIDE.md](references/HPKBUILD_GUIDE.md)

#### 3.3 SHA512SUM 检查

读取通过 API 获取的 SHA512SUM 文件完整内容，检查：

- 每行格式：`<128字符SHA512哈希>  <文件名>`
- 必须包含源码压缩包校验值
- 如有 patch 文件，也必须包含其校验值

#### 3.4 README.OpenSource 检查

读取通过 API 获取的 README.OpenSource 文件完整内容，检查：

- 必须是合法 JSON 数组
- 每个对象必须包含：Name、License、License File、Version Number、Owner、Upstream URL、Description
- Name 应与 pkgname 一致，Version Number 应与 pkgver 对应

#### 3.5 README_zh.md 检查

读取通过 API 获取的 README_zh.md 文件完整内容，检查：

必须包含章节：功能简介、三方库版本、已适配功能、使用约束（链接到 `../../docs/constraint.md`）、集成方式（链接到 `docs/hap_integrate.md`）

#### 3.6 docs/hap_integrate.md 检查

读取通过 API 获取的 docs/hap_integrate.md 文件完整内容，检查：

必须包含章节：准备应用工程、准备应用开发环境（链接到 `../../../docs/hap_integrate_environment.md`）、增加构建脚本及配置文件、准备三方库源码、应用中使用三方库、编译工程、运行效果、参考资料

#### 3.7 可选文件检查

- **OAT.xml**：仅通过目录列表 API 检查文件是否存在
- **HPKCHECK**：若存在，通过 API 获取完整内容，检查 `source HPKBUILD` 行、`openharmonycheck()` 函数名、`cd $OLDPWD` 和 `return $res`
- **Patch 文件**：命名格式 `<libname>_oh_pkg.patch` / `<libname>_oh_test.patch`，SHA512SUM 中有校验值

---

### Phase 4：问题分级与影响分析

#### 4.1 严重程度定义

| 级别 | 含义 | 合入影响 |
|------|------|----------|
| **严重 (Critical)** | 缺失必需文件、JSON/XML 格式错误、构建脚本核心函数缺失或错误 | **阻断合入** |
| **重要 (Major)** | 必需字段缺失或值不正确、文档章节缺失、链接路径错误 | **阻断合入** |
| **一般 (Minor)** | 建议项缺失（如 HPKCHECK、OAT.xml）、描述不够详尽 | 可后续迭代 |
| **表面 (Cosmetic)** | 拼写小错误、格式风格不一致 | 可后续迭代 |

#### 4.2 合入阻断规则

**严重 (Critical) 和重要 (Major) 问题为合入前置条件，必须在 PR 合入前全部修复，否则不予批准合入。**

---

### Phase 5：生成检视报告

输出文件：
- `{outputDir}/check-report.md` — 检视报告
- `{outputDir}/changed-files.txt` — 修改文件列表
- `{outputDir}/result.txt` — 合入建议分级结果

> 报告格式参见 [references/REPORT_TEMPLATE.md](references/REPORT_TEMPLATE.md)

#### 5.1 合入建议分级标准

根据检视结果，将合入建议分为四个等级：

| 等级 | 标识 | 颜色建议 | 判断标准 | 举例场景 |
|------|------|----------|----------|----------|
| **建议合入** | ✅ `PASS` | 绿色 | 无或极少（≤2 Minor）问题，改动风险低 | 纯文档更新、配置优化 |
| **条件合入** | ⚠️ `CONDITIONAL` | 黄色 | 存在少量（≤3 Major）可修复问题 | 需补充文档章节、链接路径错误 |
| **修改后合入** | 🔧 `NEED_FIX` | 橙色 | 存在较多问题（≥1 Critical 或 ≥4 Major），需修复后方可合入 | HPKBUILD 核心函数缺失、必需文件缺失 |
| **不允许合入** | ❌ `REJECT` | 红色 | 存在严重问题（≥2 Critical），影响构建/功能/安全 | 多个必需文件缺失、构建脚本严重错误 |

**分级判断流程**：

```
统计问题数量：
  - Critical 级别问题数
  - Major 级别问题数  
  - Minor 级别问题数

判断逻辑：
  IF Critical ≥ 2 → ❌ REJECT
  IF Critical ≥ 1 → 🔧 NEED_FIX
  IF Major ≥ 4    → 🔧 NEED_FIX
  IF Major ≥ 1    → ⚠️ CONDITIONAL
  IF Minor ≤ 2    → ✅ PASS
  ELSE            → ⚠️ CONDITIONAL
```

#### 5.2 result.txt 文件格式

`result.txt` 用于存储分级结果和统计信息，格式如下：

```txt
=== 合入建议分级报告 ===
PR 地址：{prUrl}
仓库：{owner}/{repo}
PR 编号：#{prNumber}
生成时间：{YYYY-MM-DD HH:mm:ss}

【合入建议】：✅ 建议合入

【问题统计】
- Critical 级别：0 个
- Major 级别：0 个  
- Minor 级别：2 个

【分级理由】
本次修改仅包含少量 Minor 级别优化建议，无功能性问题，改动风险低，建议直接合入。

【详细分析】
━━━ Critical 级别问题 ━━━
{列出所有 Critical 问题，每个占一行}

━━━ Major 级别问题 ━━━
{列出所有 Major 问题，每个占一行}

━━━ Minor 级别问题 ━━━
1. [文件类型：建议项] 缺少 HPKCHECK 测试脚本（建议补充）
2. [文件类型：建议项] 缺少 OAT.xml 合规审计配置（建议补充）

━━━ 合入建议 ━━━
建议合入：本次修改质量良好，无功能性风险。

=== 分级结束 ===
```

#### 5.3 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将分级结果以下述 JSON 对象写入该路径：

```json
{
  "mergeLevel": "PASS | CONDITIONAL | NEED_FIX | REJECT",
  "critical": 0,
  "major": 0,
  "minor": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `mergeLevel` | string | 合入等级：PASS / CONDITIONAL / NEED_FIX / REJECT |
| `critical` | number | Critical 级别问题数 |
| `major` | number | Major 级别问题数 |
| `minor` | number | Minor 级别问题数 |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取，无需解析报告文本）；详细的统计与理由已在 `result.txt` 中完整记录。若 prompt 未下发该路径则跳过本节。

---

## 注意事项

1. **不克隆仓库**：所有文件内容通过 GitCode API 按需获取，只获取 PR 中变更的文件和检视必需的文件，大幅减少时间和资源消耗
2. **API 限流**：GitCode API 有调用频率限制，建议提供 `accessToken` 以提高限额；无 Token 时注意控制请求频率
3. **增量检视范围**：仅检查 PR 变更的文件，不对未修改的文件提出缺失问题
4. **预存问题不在增量检视范围内**：增量检视不纳入仓库中已存在的问题
5. **报告文件名必须是 `check-report.md`**，路径在 `{outputDir}` 下
6. **所有输出文档必须使用中文**
7. **pkgver 不能是 `master`**：这是历史遗留模式，新增或修改的适配库不应再使用
8. **大文件处理**：若 API 返回的文件内容为 Base64 编码且超过 1MB，应使用 download 参数获取原始内容
9. **Base64 解码**：GitCode API contents 端点返回的 `content` 字段为 Base64 编码，需解码后才是文件原始内容

---

## 参考文档

- [规范性检查清单](references/CHECKLIST.md)
- [HPKBUILD 详细检查指南](references/HPKBUILD_GUIDE.md)
- [检视报告模板](references/REPORT_TEMPLATE.md)
