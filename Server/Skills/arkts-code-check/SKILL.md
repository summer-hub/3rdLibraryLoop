---
name: arkts-code-check
description: 自动化检视 ArkTS 三方库 Pull Request，包括获取 PR 差异、深度分析代码变更、生成结构化检视报告。当用户需要对 ArkTS/OpenHarmony 三方库 PR 进行代码检视时调用。支持 GitCode、Gitee、GitHub、GitLab 平台。
license: Apache-2.0
compatibility: 需要 git、curl、网络访问代码仓库平台 API
metadata:
  author: CPPAgent
  version: "2.1"
---

# ArkTsCodeCheckSkill — ArkTS 三方库 PR 代码检视

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `prUrl` | ✅ | PR 地址，如 `https://gitee.com/openharmony-tpc/community/pulls/123` |
| `outputDir` | ✅ | 输出目录绝对路径，如 `/path/to/codecheck/owner_repo_pr123` |
| `branch` | ❌ | 目标分支名；若提供则优先使用 |
| `accessToken` | ❌ | 平台 API 访问令牌 |

---

## 工作流程概览

```
Phase 1: 信息收集（含范围识别） → Phase 2: 差异分析 → Phase 3: 代码检视 → Phase 4: 影响分析 → Phase 5: 报告生成
```

---

## Phase 1：信息收集

### 1.1 解析 PR 地址

从 `prUrl` 提取：`platform`、`owner`、`repo`、`prNumber`。

> 详细步骤参见 [信息收集指南](references/PHASE1_INFO_COLLECTION.md)

### 1.2 获取 PR 元数据

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}?access_token={accessToken}"
```

提取：`title`、`base.ref`、`head.sha`、`user.name`、`created_at`、`state`

### 1.3 获取 Commit Patch（仅供参考）

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/commit/{head.sha}/patch?access_token={accessToken}" -o {outputDir}/pr.patch
```

返回最新 commit 的 patch，包含 commit 元数据（作者、日期、message）和单次 commit 的文件变更。

> **注意**：
> - 路径使用 `commit`（单数），不是 `commits`
> - 此 patch 仅包含 PR **最新一次 commit** 的差异，不代表 PR 全量变更
> - PR 若包含多个 commit，需使用 1.5 步骤的累积 diff 进行检视

### 1.4 克隆仓库（必须）

```bash
git clone --depth=50 --branch {targetBranch} https://gitcode.com/{owner}/{repo}.git {outputDir}/source/
```

克隆后必须 fetch PR HEAD 并生成累积 diff（见 1.5）。

### 1.5 获取 PR 累积差异（检视依据）

> **核心步骤**：必须基于累积 diff 进行检视，而非单次 commit patch。

```bash
# 1. fetch PR HEAD 到本地分支
cd {outputDir}/source/
git fetch origin refs/merge-requests/{prNumber}/head:pr{prNumber}

# 2. checkout PR 分支
git checkout pr{prNumber}

# 3. 生成累积 diff（base 分支 vs PR HEAD）
git diff {targetBranch}..pr{prNumber} > {outputDir}/pr-diff-raw.txt
```

**为什么需要累积 diff**：
- PR 可能包含多个 commit，单次 commit patch 无法反映全量变更
- 本次检视中，head.sha patch 仅 1 个文件，但累积 diff 实际包含 21 个文件
- 累积 diff 才是 PR 的真实变更范围

**PR 更新检测**：
- PR 推送新 commit 后 `head.sha` 会变化
- 若 1.2 步骤获取的 `head.sha` 与上次不同，必须重新 fetch 并重新生成 `pr-diff.txt`
- 已生成的报告文件也需重新生成

### 1.6 识别 PR 检视范围（关键步骤）

> **⚠️ 此步骤防止检视范围污染，是本次迭代新增的核心改进。**

Monorepo（如 `openharmony_tpc_samples` 包含多个三方库子目录）中，fork 分支的 master 通常通过 merge commit 合入了其他 PR 的变更。此时 `git diff {targetBranch}..pr{prNumber}` 的累积 diff 会包含**不属于本 PR 意图范围**的文件变更（其他库的修改、删除等），导致检视误判。

**识别方法**：

1. 从 PR 标题提取目标库名称（如 `eventsource: fix: ...` → 目标库为 `eventsource`）
2. 若标题不含库名，从 PR body（描述）或 commit message 中提取
3. 若仍无法确定，取 PR 标题中第一个冒号前的部分，或取变更文件中最深层公共父目录

**范围过滤**：

```bash
# 仅保留目标库目录下的 diff（关键：避免检视范围污染）
git diff {targetBranch}..pr{prNumber} -- {targetLibraryDir}/ > {outputDir}/pr-diff.txt

# 同时生成全量 diff 供参考（不用于检视，仅用于记录）
# pr-diff-raw.txt 已在 1.5 中生成
```

**实际案例**：
- PR #3042 标题为 `eventsource: fix: ...`，目标库为 `eventsource`
- 累积 diff 包含 113 个文件（ohos_rive、ohos_7zip、spinec、GstreamerDemo 等），但仅 18 个 eventsource 文件属于本 PR
- 若不过滤，ohos_rive 的内存安全回归会被误判为本 PR 的 Blocker，导致错误的 REJECT 结论
- 过滤后仅检视 18 个 eventsource 文件，结果为 PASS

**过滤后更新统计**：

```bash
# 重新统计（基于过滤后的 diff）
git diff --stat {targetBranch}..pr{prNumber} -- {targetLibraryDir}/

# 重新生成 changed-files.txt（基于过滤后的 diff）
grep "^diff --git" {outputDir}/pr-diff.txt | sed 's/diff --git a\/.* b\/\//' > {outputDir}/changed-files.txt
```

> **原则**：检视应聚焦于 PR 的意图范围（单次提交涉及的目标库），不应将 fork 分支 divergent master 上的其他变更纳入检视和分级。

---

## Phase 2：差异分析

> **必须基于 `pr-diff.txt`（经过范围过滤的累积 diff）进行分析，而非 `pr-diff-raw.txt`（全量累积 diff）或 `pr.patch`（单次 commit patch）**

### 2.1 统计改动规模

- 文件数、新增/删除行数：从 `pr-diff.txt` 统计，或使用 `git diff --stat {targetBranch}..pr{prNumber}`

### 2.2 识别文件类型

| 扩展名 | 类型 | 检视重点 |
|--------|------|----------|
| `.ets` | ArkTS | 语言约束、装饰器、UI |
| `.ts` | TypeScript | 类型安全、异步 |
| `oh-package.json5` | 配置 | 依赖版本 |
| `module.json5` | 配置 | 权限、API Level |

> 完整分类参见 [文件类型指南](references/FILE_TYPE_GUIDE.md)

### 2.3 理解改动意图

结合 PR 标题、commit message、diff 上下文分析修改目的。

---

## Phase 3：代码深度检视

对每个 `.ets` / `.ts` 文件逐项检查。

### 3.1 核心检视维度

| 维度 | 检查要点 |
|------|----------|
| 非兼容变更 | 删除/修改公开 API、函数签名变更 |
| ArkTS 约束 | 无 `any`、无动态代码、装饰器正确 |
| API 兼容性 | minAPIVersion 匹配、权限正确 |
| 异步处理 | await 不遗漏、try/catch 完整 |
| 事件监听 | on/off 对称、生命周期正确 |
| 错误处理 | 错误码完整、return/break 正确 |
| 内存管理 | 监听器清理、定时器清除 |
| 安全性 | 无硬编码密钥、输入校验 |

> 完整检查清单参见 [代码检视指南](references/CODE_CHECK_GUIDE.md)

### 3.2 问题严重程度

| 级别 | 标识 | 说明 |
|------|------|------|
| Blocker | 🔴 | 必须修复，影响功能/安全/兼容 |
| Major | 🟡 | 建议修复，存在风险 |
| Minor | 🔵 | 优化建议 |

---

## Phase 4：影响分析

综合评估：
- **功能影响**：新功能或行为变更
- **兼容性影响**：接口向后兼容性
- **性能影响**：异步优化、对象创建等
- **安全影响**：修复或引入安全问题

---

## Phase 5：生成报告

输出文件：
- `{outputDir}/check-report.md` — 检视报告
- `{outputDir}/changed-files.txt` — 修改文件列表（基于范围过滤后的 diff 生成）
- `{outputDir}/pr-diff.txt` — PR 累积差异（目标库目录范围内，检视核心依据）
- `{outputDir}/pr-diff-raw.txt` — PR 全量累积差异（base → PR HEAD，仅供参考，不用于检视）
- `{outputDir}/pr.patch` — 最新 commit patch（仅供 commit 元数据参考）
- `{outputDir}/result.txt` — 合入建议分级结果

> 报告模板参见 [报告模板](references/REPORT_TEMPLATE.md)

### 5.1 合入建议分级标准

根据代码检视结果，将合入建议分为四个等级：

| 等级 | 标识 | 颜色建议 | 判断标准 | 举例场景 |
|------|------|----------|----------|----------|
| **建议合入** | ✅ `PASS` | 绿色 | 无或极少（≤2 Minor）修改引入问题，改动风险低，功能验证充分 | 纯文档更新、配置优化、已验证的 Bug 修复 |
| **条件合入** | ⚠️ `CONDITIONAL` | 黄色 | 存在少量（≤3 Major）可修复问题，在特定条件下可合入 | 需补充测试用例、需调整文档说明、非核心路径兼容性问题 |
| **修改后合入** | 🔧 `NEED_FIX` | 橙色 | 存在较多问题（≥1 Blocker 或 ≥4 Major），需修复后方可合入 | API 兼容性破坏、性能风险、内存泄漏、异步逻辑缺陷 |
| **不允许合入** | ❌ `REJECT` | 红色 | 存在严重问题（≥2 Blocker），影响功能/安全/稳定性，不建议合入 | 安全漏洞、严重兼容性破坏、架构缺陷、未验证的重大变更 |

**分级判断流程**：

```
统计问题数量：
  - Blocker 级别问题数
  - Major 级别问题数  
  - Minor 级别问题数

判断逻辑：
  IF Blocker ≥ 2 → ❌ REJECT
  IF Blocker ≥ 1 → 🔧 NEED_FIX
  IF Major ≥ 4   → 🔧 NEED_FIX
  IF Major ≥ 1   → ⚠️ CONDITIONAL
  IF Minor ≤ 2   → ✅ PASS
  ELSE           → ⚠️ CONDITIONAL
```

### 5.2 result.txt 文件格式

`result.txt` 用于存储分级结果和统计信息，格式如下：

```txt
=== 合入建议分级报告 ===
PR 地址：{prUrl}
仓库：{owner}/{repo}
PR 编号：#{prNumber}
生成时间：{YYYY-MM-DD HH:mm:ss}

【合入建议】：✅ 建议合入

【问题统计】
- Blocker 级别：0 个
- Major 级别：0 个  
- Minor 级别：2 个

【分级理由】
本次修改仅包含少量 Minor 级别优化建议，无功能性问题，改动风险低，建议直接合入。

【详细分析】
━━━ Minor 级别问题 ━━━
1. [文件类型：代码质量] 删除了无用变量 `pairFlag`，代码更简洁
2. [文件类型：可观测性] 错误信息从模糊描述改为包含 `e.code` 和 `e.message` 的格式

━━━ 合入建议 ━━━
建议合入：本次修改质量良好，无功能性风险。

=== 分级结束 ===
```

### 5.3 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将分级结果以下述 JSON 对象写入该路径：

```json
{
  "mergeLevel": "PASS | CONDITIONAL | NEED_FIX | REJECT",
  "blocker": 0,
  "major": 0,
  "minor": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `mergeLevel` | string | 合入等级：PASS / CONDITIONAL / NEED_FIX / REJECT |
| `blocker` | number | Blocker 级别问题数 |
| `major` | number | Major 级别问题数 |
| `minor` | number | Minor 级别问题数 |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取，无需解析报告文本）；详细的统计与理由已在 `result.txt` 中完整记录。若 prompt 未下发该路径则跳过本节。

---

## 注意事项

1. **必须克隆仓库**：用于深度检视和跨文件引用分析，不可仅凭 diff 下结论
2. **必须使用累积 diff 进行检视**：`pr.patch`（单次 commit patch）可能仅包含部分变更，必须使用 `git diff {targetBranch}..pr{prNumber}` 生成的累积 diff。实际案例中 pr.patch 仅 1 个文件，但累积 diff 有 21 个文件
3. **必须识别 PR 检视范围**（新增）：Monorepo 中 fork 分支的累积 diff 可能包含不属于本 PR 的其他库变更，必须根据 PR 标题/描述识别目标库目录，将 diff 限定在该范围内。实际案例：PR #3042 标题为 `eventsource: fix:`，但累积 diff 包含 113 个文件（含 ohos_rive、ohos_7zip 等），不过滤会导致误判 REJECT
4. **克隆失败处理**：在报告中注明，继续基于 diff 完成分析
5. **Patch 过大**：优先分析 `.ets`/`.ts` 文件，其余按改动量排序
6. **PR 更新检测**：每次检视前重新获取 PR 元数据，对比 head.sha 是否变化；若变化，必须重新 fetch 并重新生成 pr-diff.txt 和所有报告
7. **所有操作记录日志**：方便问题排查

---

## 快速参考

- [信息收集详细指南](references/PHASE1_INFO_COLLECTION.md)
- [代码检视检查清单](references/CODE_CHECK_GUIDE.md)
- [检视报告模板](references/REPORT_TEMPLATE.md)
- [文件类型识别指南](references/FILE_TYPE_GUIDE.md)