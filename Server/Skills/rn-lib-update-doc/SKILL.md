---
name: rn-lib-update-doc
description: 将 RN 鸿蒙三方库文档与元数据按模板（默认 v0.4.2）迁移/升级：README 中英文、package.json 链接与 keywords、harmony oh-package.json5、CHANGELOG 格式；必要时从 usage-docs 拉正文并结合库实现改写；链接统一 CPF-RN 组织。Use when the user mentions 更新 README、readme 模板、0.4.2 文档、usage-docs 迁移、README_EN、文档模板升级、rn-lib-update-doc、更新文档、CHANGELOG 规范、package.json 链接.
license: Apache-2.0
compatibility: 需要 Node.js（脚本）与 curl（链接可达性校验），需对目标库与 usage-docs（可选）的文件读写权限
metadata:
  author: LoopEngine
  version: "1.1.0"
---

## 路径约定

`{SKILL_DIR}` = 本技能根目录，命令在 `{SKILL_DIR}` 下执行（即下文 `node scripts/...` 均为相对于 `{SKILL_DIR}` 的路径）；`$LIB` = 目标库根目录。

# RN 三方库文档与元数据升级（rn-lib-update-doc）

将目标库 **README / 包元数据 / CHANGELOG** 升级到规范：文档模板（默认 **v0.4.2**，见 [`references/model-0.4.2.md`](references/model-0.4.2.md)）、[CPF-RN](https://gitcode.com/CPF-RN) 组织链接、npm/harmony 包描述一致；内容必须与**当前库版本实际实现**一致；若本地有 usage-docs，再按 overview 模板覆盖回写该库中英文档。

## 任务参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `libPath` | ✅ | 目标库根目录（含 package.json / README.md） |
| `templateVersion` | ❌ | 文档模板版本，默认 0.4.2 |
| `usageDocsPath` | ❌ | 本地 usage-docs 仓路径（config.json 无效时需提供） |

---

## 工作流程概览

```
Phase 1 确认模板版本 → Phase 2 判定格式/获取正文 → Phase 3 改写 README（含链接规范化）
    → Phase 4 回写 usage-docs（可选） → Phase 5 规范包元数据 → Phase 6 规范 CHANGELOG
```

## 执行步骤

```
Task Progress:
- [ ] Step 1: 确认文档模板版本（默认 0.4.2）
- [ ] Step 2: 判定本库 README 格式；必要时从 usage-docs 迁移正文
- [ ] Step 3: 按模板 + 库实际实现改写 README.md / README_EN.md
- [ ] Step 3.5: 链接规范化（CPF-RN：Issue/PR/LICENSE/Autolink 等）
- [ ] Step 4: 若有本地 usage-docs，按 overview 覆盖回写中英文
- [ ] Step 5: 规范 package.json 与 harmony oh-package.json5
- [ ] Step 6: 规范 CHANGELOG.md（Keep a Changelog）
```

### Step 1 — 确认文档模板

**必须先问用户**：是否要更换文档模板版本？

- **不更换** → 使用 [`references/model-0.4.2.md`](references/model-0.4.2.md) 与 [`references/model-0.4.2-overview.md`](references/model-0.4.2-overview.md)
- **要更换** → 用户提供新模板路径，复制到 `references/` 后按新模板执行

### Step 2 — 判定格式并获取正文来源

```bash
node scripts/detect-readme-format.cjs <lib-root> [--expect 0.4.2]
```

| 检测结果 | 动作 |
|----------|------|
| 已是目标模板（如 0.4.2） | 进入 Step 3 校对/补全 |
| 已是 **0.4.1** 结构 | 以本库现有 README 为素材，直接 Step 3 升级 |
| 非目标模板 / 仅外链 README | 从 usage-docs 迁正文（见下方） |

**usage-docs：**

```bash
node scripts/resolve-usage-docs.cjs [--set <local-path>] [--print]
node scripts/find-usage-doc.cjs --lib-path <lib-root> [--usage-docs <path>]
```

远端 fallback：`https://gitcode.com/CPF-RN/usage-docs`（raw：`.../raw/master/zh-cn/<alias>.md` 与 `en/<alias>.md`）

### Step 3 — 按模板改造 README（必须贴合当前库）

以 `model-0.4.2.md` 为骨架，结合 `package.json`、源码、`harmony/`、example、当前分支 Autolink 事实改写 `README.md` / `README_EN.md`。

**硬性要求：**

- 版本关系表、安装、Link、约束、示例、接口说明与**当前实现**一致
- **贡献代码**：Issue / PR 链接必须指向 **CPF-RN 本库**（`https://gitcode.com/CPF-RN/rntpc_<alias>/issues` 与 `.../pulls`）
- **开源协议**：LICENSE 链接指向 **CPF-RN 本库** `.../blob/master/LICENSE`（勿仅指向上游 GitHub LICENSE，除非协议章节明确说明上游协议且本库 LICENSE 文件不同）
- 对照 [format-diff.md](references/format-diff.md) 完成章节与表头调整，并按其中 [ManualLink 章节规则](references/format-diff.md#manuallink-章节autolink-全支持时删除) 判断 Autolink 全支持时删除该章节（**必判**）

### Step 3.5 — 链接规范化与可达性校验（**必做**）

**禁止**仅做字符串级组织替换。所有写入 README / `package.json` 的链接，替换后必须 **HTTP 可达**（2xx/3xx）方可 `--write`。

```bash
node scripts/normalize-readme-links.cjs --lib-path "$LIB"
node scripts/normalize-readme-links.cjs --lib-path "$LIB" --write
```

**校验规则（`scripts/link-verify.cjs`）：**

1. 解析本库 GitCode：对 `git remote` / `repository` / `rntpc_<alias>` 等候选执行 `curl -L`，选用首个可达的 CPF-RN 仓库根 URL
2. 组织迁移：含 `openharmony-sig` 的 URL 仅当 CPF-RN 目标**探测可达**才替换；不可达则保留原链并报告 `unverified-org-migration`
3. Issue / PR / LICENSE：仅在仓库根 URL 已验证时，才改写到 `{libRepoBase}/issues`、`/pulls`、`/blob/master/LICENSE`
4. 对 README 终稿中全部 `http(s)` 链接汇总校验（报告 `linkVerification.failures`）

离线调试可加 `--skip-verify`；**交付前必须去掉**重新校验。

**必须确认：**

- 本库 Gitcode 在 [CPF-RN](https://gitcode.com/CPF-RN) 且仓库页可访问
- README 中 **Issue / PR / LICENSE** 链接均可打开
- Autolinking → `CPF-RN/ohos_react_native`；link-source-code → `CPF-RN/usage-docs`

退出码 `2` 表示链接不可达或仓库未验证，修复后再 `--write`。

### Step 4 — 回写 usage-docs（仅本地仓）

有本地 usage-docs 时，用 `model-0.4.2-overview.md` 覆盖 `{usageDocs}/zh-cn/<alias>.md` 与 `en/<alias>.md`。无本地仓则跳过。

### Step 5 — 规范 package.json 与 harmony oh-package.json5（**必做**）

```bash
node scripts/normalize-package-meta.cjs --lib-path "$LIB"
node scripts/normalize-package-meta.cjs --lib-path "$LIB" --write
```

**package.json 检查项：**

| 字段 | 要求 |
|------|------|
| `repository.url` | `https://gitcode.com/CPF-RN/rntpc_<alias>.git` |
| `homepage` | `https://gitcode.com/CPF-RN/rntpc_<alias>` |
| `bugs.url` | `https://gitcode.com/CPF-RN/rntpc_<alias>/issues` |
| `license` | `"MIT"`（与库根 LICENSE 一致；若非 MIT 以 LICENSE 文件为准并告知用户） |
| `publishConfig` | `{ "registry": "https://registry.npmjs.org/", "access": "public" }` |
| `keywords` | 在现有基础上**补全**（去重）：`rnoh`、`harmonyos`、`openharmony`、`ohos` |

**harmony 模块 `oh-package.json5`（每个 `harmony/**/oh-package.json5`，不含 example 内三方依赖副本时可跳过 example）：**

| 字段 | 要求 |
|------|------|
| `license` | `"MIT"` |
| `description` | 简短说明，与 `package.json` 的 `description` 一致或同义（如 `React Native Blur OpenHarmony module`） |

脚本在写回 `homepage` / `bugs.url` / `repository` 前会调用 `link-verify.cjs` 校验可达性；验证失败时**拒绝 `--write`**（除非 `--skip-verify`）。

### Step 6 — 规范 CHANGELOG.md（**必做**）

按 [Keep a Changelog](https://keepachangelog.com/) 重组，参考 [`references/changelog-template.md`](references/changelog-template.md)。

**结构要求：**

1. 文首说明基于 Keep a Changelog
2. `## [Unreleased]` 节（可为空）
3. 鸿蒙化版本：`## [x.y.z] - YYYY-MM-DD`，下含 `### Added` / `Changed` / `Fixed` / `Deprecated` 等（无内容可省略该分类，但**禁止**仅用无序列表无分类）
4. 上游 Release 可单独放在 `## Upstream Release Notes`，勿与鸿蒙版本混用 `## 鸿蒙化Log`、`### v4.x.x` 等旧标题

**校验：**

```bash
node scripts/normalize-changelog.cjs --lib-path "$LIB"
```

退出码 `2` 表示格式不合规，需人工重组后再提交。

## 需向用户确认

1. 是否更换文档模板（Step 1；默认 0.4.2）
2. 目标库根目录（若工作区不明确）
3. usage-docs 本地路径（需拉取且 config 无效时）
4. `license` 非 MIT 时是否仍强制写 MIT（以 LICENSE 文件为准）
5. Step 4 回写前展示将覆盖的 usage-docs 路径

## 不在范围内

- 不修改库业务源码（仅文档与元数据；`package.json` / `CHANGELOG.md` / `OAT.xml` 等交付相关除外）
- 不自动 git commit / push
- 不替代 OAT / 交付件生成技能
