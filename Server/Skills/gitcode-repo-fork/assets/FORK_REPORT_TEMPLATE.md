# Fork 报告模板（gitcode-repo-fork）

> Phase 6 产出两个文件：`fork-info.json`（机器可读，供下游 SKILL）与 `gitcode-repo-fork-report.md`（人类可读）。均写入 `{workspaceDir}`。**任何字段不得包含 Token。**

---

## fork-info.json 模板

```json
{
  "upstream": {
    "owner": "{upstreamOwner}",
    "repo": "{repoName}",
    "url": "https://gitcode.com/{upstreamOwner}/{repoName}",
    "projectId": "{源仓库 id}",
    "defaultBranch": "{default_branch}",
    "grandparent": "{源仓库自身的 parent，非 fork 时为 null}"
  },
  "fork": {
    "owner": "{tokenUser}",
    "repo": "{repoName}",
    "url": "https://gitcode.com/{tokenUser}/{repoName}",
    "reused": true,
    "createdAt": "{本次流程时间}"
  },
  "tokenUser": "{username}",
  "branch": "{branch}",
  "monorepoSubpath": "{子库路径或 null}",
  "workspaceDir": "{workspaceDir}",
  "remotes": {
    "origin": "fork",
    "upstream": "源仓库"
  },
  "workspaceMode": "clone | attach",
  "commit": "{git rev-parse HEAD}",
  "sync": {
    "status": "in-sync | fork-ahead | synced-ff | skipped-mode-none | diverged | skipped-new-fork",
    "detail": "{同步明细，如 '落后 3 个提交已 ff 同步' / '分叉：上游独有 2，fork 独有 1，未自动处理'}"
  },
  "branchAlignment": "{attached-kept-current（脏工作区保留原分支 {current}）| aligned | cloned}",
  "time": "{timestamp}"
}
```

---

## gitcode-repo-fork-report.md 模板

```markdown
# GitCode 仓库 Fork 报告

## 基本信息

| 项 | 值 |
|----|----|
| 执行时间 | {timestamp} |
| 模式 | 新建 Fork / 复用 Fork |
| 工作区模式 | 新克隆 / 已有工作区接入 |
| dry-run | 否 |

## 判定明细

| 判定项 | 结果 | 依据 |
|--------|------|------|
| 是否需要 Fork | 需要 / 不需要（终止） | permissions.push={true/false}（或 owner 比对兜底，标注"permissions 缺失"） |
| Fork 存在性 | 不存在→已创建 / 已存在→复用 / 命名冲突→终止 | parent={值} |
| 分支 | {branch}（来源：参数/URL/默认分支） | 上游分支存在：是 |

## 仓库信息

| 项 | 源仓库（上游） | Fork |
|----|---------------|------|
| 路径 | {upstreamOwner}/{repoName} | {tokenUser}/{repoName} |
| 地址 | https://gitcode.com/{upstreamOwner}/{repoName} | https://gitcode.com/{tokenUser}/{repoName} |
| 默认分支 | {defaultBranch} | — |
| project_id | {id} | — |

## 工作区

| 项 | 值 |
|----|----|
| 路径 | {workspaceDir} |
| remote 布局 | origin → fork（{tokenUser}/{repoName}）；upstream → 源仓库 |
| 当前分支 | {branch}（或"保留原分支 {current}：工作区有未提交修改，未切换"） |
| 提交人 | {name} <{email}>（Token 用户，仓库级配置） |
| HEAD | {commit} |
| Monorepo 子路径 | {subpath 或"无"} |

## 分支同步状态

| 状态 | 说明 |
|------|------|
| {sync.status} | {sync.detail} |

## 后续步骤

1. 在 `{workspaceDir}` 的 `{branch}` 分支上完成代码修改（调用相应修改类 SKILL）
2. 修改完成后执行 `ohos-lib-pr-push` 从 fork 向源仓库提 PR（工作区布局已满足其输入前提）
3. {如有分叉/命名冲突等待处理事项，逐条列出处理建议}

## 错误信息

{无 / 错误详情与已完成的产物清单}
```

---

## 填写规则

- **Token 安全**：`fork.url` / remote 地址一律使用不含 Token 的形式；remote URL 内嵌 Token 仅存在于本地 `.git/config`
- **状态枚举**：`sync.status` 只取模板中列出的枚举值，自定义状态写入 `detail`
- **终止场景**：流程中途终止时报告仍需生成（写入可写的位置），已完成步骤的产物信息（如已创建的 Fork 地址）必须保留
- **dryRun**：不写任何文件，结果以流程输出文本呈现（可参照本模板组织内容）
