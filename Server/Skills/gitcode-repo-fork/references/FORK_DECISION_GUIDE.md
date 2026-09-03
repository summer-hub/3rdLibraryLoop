# Fork 决策指南（gitcode-repo-fork）

本 SKILL 的四个核心判定分支的完整决策树、场景矩阵与安全红线。

---

## 决策树 1：是否需要 Fork（Phase 2）

```
获取源仓库信息（get-repo）
├── permissions.push == true ──────────────→ 无需 Fork：终止报告
│                                             （可直接克隆修改；如需隔离开发建议建分支，
│                                               平台通常拒绝 Fork 自己的仓库）
├── permissions 缺失
│   ├── upstreamOwner == Token 用户 ───────→ 无需 Fork：终止报告
│   └── 不同 ─────────────────────────────→ 按无写权限处理，报告标注"按 owner 比对判定"
└── permissions.push == false ─────────────→ 需要 Fork：继续 Phase 3
```

> 用户明确指示"仍要 Fork"时按指示继续（用户指令优先），由 Phase 3 的 API 错误处理兜底；判定拿不准时终止询问用户，禁止默认带写权限。

---

## 决策树 2：Fork 三态（Phase 3）

```
探测 {tokenUser}/{repoName}（get-repo --allow-missing）
├── exists: false ─────────────────────────→ 创建（create-fork，内置幂等回查+就绪轮询）
├── exists: true
│   ├── parent == {upstreamOwner}/{repoName} → 复用（reused: true）
│   └── parent 为空 / 指向其他仓库 ─────────→ 命名冲突：终止报告，
│                                             提示用户先处理同名仓库（重命名/删除），
│                                             禁止误用或覆盖
└── create-fork 返回 reused: true（并发创建）→ 按本树校验 parent 后复用
```

**为什么禁止删除重建 Fork**：API 删除不可恢复，且无法可靠验证对方仓库"无在用分支/未推送提交"；落后场景 ff 同步可达同等效果，分叉场景属用户已有工作，必须人工决策。

---

## 决策树 3：工作区三态（Phase 4）

```
workspaceDir 状态探测
├── 存在 .git（git 仓库）
│   └── 已有工作区接入（Phase 4.1，remote 手术，不动工作区内容）
│       ├── origin 指向源仓库、无 upstream   → rename origin→upstream + add origin=fork
│       ├── origin 指向源仓库、有 upstream   → set-url origin=fork（upstream 保持）
│       ├── origin 已指向 fork（owner=Token 用户）→ 补/校正 upstream
│       └── origin 指向无关仓库             → 终止报告，交由用户确认
│       分支对齐：当前==目标 → 无操作；不同且干净 → checkout；
│                不同且脏（有未提交修改）→ 不切换，警告（防丢改动）
├── 不存在 / 空目录
│   └── 新克隆 Fork（Phase 4.2）：完整克隆（非 --depth=1）+ add upstream + 仓库级提交人
└── 非空且非 git 仓库 ─────────────────────→ 终止报告
```

**关键认知**："已从源仓库克隆并已有修改，才发现无推送权限"是本 SKILL 的**主场景之一**——脏工作区属预期输入，remote 手术（rename/add/set-url）不触碰工作区内容，安全。

---

## 决策树 4：同步四态（Phase 5，仅复用 Fork 时）

```
git rev-list --left-right --count upstream/{b}...origin/{b}
输出 "上游独有<TAB>fork独有"
├── 0, 0 ────→ in-sync（无操作）
├── 0, N ────→ fork-ahead（用户此前的工作，不动）
├── N, 0 ────→ fork 落后、无分叉
│   ├── syncMode=auto → ① git push origin upstream/{b}:{b}（远端 ff，不依赖本地检出）
│   │                    ② 当前在目标分支且干净 → git merge --ff-only upstream/{b} 本地跟进
│   │                    （否则报告本地跟进指引）
│   └── syncMode=none → skipped-mode-none（报告记录）
└── N, M ────→ diverged：只报告禁强推，提示人工处理（可 rebase 后重推）
```

**安全机制**：`git push origin upstream/{b}:{b}` 不带 `--force` 时 git 天然拒绝非 fast-forward，无需自行判断；本地 `--ff-only` 同理。分叉绝不自动处理。

---

## 场景矩阵

| 场景 | 触发条件 | 行为 |
|------|---------|------|
| dry-run 探测 | `dryRun=true` | Phase 1~3.1 只读探测后文本汇报，不写文件、不执行任何变更 |
| 已有工作区接入 | workspaceDir 存在 `.git` | remote 手术 + 分支对齐（脏则跳过切换）+ 提交人 |
| 新克隆 | workspaceDir 不存在/空 | 完整克隆 fork + upstream remote + 提交人 |
| 复用已有 Fork | Phase 3.1 命中 | 不创建；Phase 5 必做同步检查 |
| 新建 Fork | Phase 3.1 未命中 | 创建 + 轮询就绪；Phase 5 跳过（记 `skipped-new-fork`） |
| Monorepo 子路径 | repoUrl 含 `/tree/{b}/{subpath}` | 克隆整个仓库，subpath 记入 fork-info 与报告（后续 PR 标注） |
| Fork of Fork | 源仓库响应含 `parent` | 仍 Fork 该仓库本身；更上游仅记录 |
| 命名冲突 | 同名仓库存在但 parent 不符 | 终止，交由用户处理 |
| 有写权限 | `permissions.push=true` | 无需 Fork，终止报告 |

---

## 安全红线

1. **禁删除重建 Fork**——破坏性且无法可靠验证安全性（见决策树 2）
2. **禁 force push / 自动 pull / 自动 rebase**——同步只做 ff-only；分叉只报告
3. **Token 脱敏**——不入报告 / fork-info.json / 日志；`git remote -v` 展示前替换为 `***`
4. **脏工作区保护**——不切换分支、不本地 ff 跟进，只警告
5. **只准备不修改**——不改任何业务代码，产出仅 Fork + 工作区 + 两个元信息文件
6. **终止优于猜测**——判定拿不准（权限缺失、remote 指向不明、命名冲突）一律终止询问用户

---

## 上下游协作

```
任务规划
   ↓
gitcode-repo-fork（本 SKILL：非本人仓库 → Fork + 工作区准备）
   ↓
代码修改类 SKILL（rnoh-lib-code-adapt / rn-lib-add-example / arkts-library-demo-code 等）
   ↓
ohos-lib-pr-push（fork → 源仓库提 PR；其 origin=fork / upstream=源仓库 布局已就位）
```

| 相邻 SKILL | 关系 |
|-----------|------|
| `arkts-library-source-clone` | **只读检视**用 source-clone（克隆源仓库到 `outputDir/source/`，无推送诉求）；**需要修改并回推**用本 SKILL（克隆的是 fork，带推送能力） |
| `ohos-lib-pr-push` | 直接下游。其 Phase 1.1 上游推断（origin/upstream/parent）、Phase 5 推送（fork remote 内嵌 Token）均依赖本 SKILL 的工作区布局 |
| 各修改类 SKILL | 在本 SKILL 产出的 `{workspaceDir}`（分支 `{branch}`）上工作；fork-info.json 提供仓库元信息 |
