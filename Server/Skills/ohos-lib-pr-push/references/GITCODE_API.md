# GitCode API 参考（ohos-lib-pr-push）

所有 API 均可通过对应子命令执行 `node scripts/gitcode-api.cjs <cmd> --help` 查看参数。脚本内部统一使用 `application/x-www-form-urlencoded` + UTF-8 发送写请求，避免中文乱码。

Base: `https://gitcode.com/api/v5`

认证方式：查询参数 `access_token={token}` 或 Header `Authorization: Bearer {token}`（脚本已内置）。

---

## API 一览

| 操作 | 方法 | 端点 | 关键参数 |
|------|------|------|---------|
| 获取用户信息 | GET | `/user` | 返回 `username`、`name`、`email` |
| 获取仓库信息 | GET | `/repos/{owner}/{repo}` | 返回 `id`（project_id）、`default_branch`、fork 仓库响应含 `parent.path_with_namespace`（源仓库推断依据） |
| 探测分支存在 | GET | `/repos/{owner}/{repo}/branches/{branch}` | 200 存在 / 404 不存在，用于 PR base 同名分支探测 |
| Fork 仓库 | POST | `/repos/{owner}/{repo}/forks` | `name`（fork 仓库名），仅当工作区不是 fork 克隆时用于补建 fork |
| 创建 Issue | POST | `/repos/{owner}/{repo}/issues` | `title`、`body` |
| 创建跨仓库 PR | POST | `/repos/{forkOwner}/{repo}/pulls` | `fork_repo`（原仓库）、`target_project_id`（原仓库 id） |
| PR 评论 | POST | `/repos/{owner}/{repo}/pulls/{number}/comments` | `body=Start build`；owner/repo 用**原仓库** |
| 关闭 PR | PATCH | `/repos/{forkOwner}/{repo}/pulls/{number}` | `state=closed`（仅参数错误的 PR 需关闭重建时用） |

---

## 踩坑记录（来自 LibraryIntelligentFixSkill 实战）

### 1. 跨仓库 PR 必须传 target_project_id

从 fork 向源仓库（上游）提 PR 时，调用 **fork 仓库**的 pulls API，且必须传：

- `fork_repo` = 源仓库 `{upstreamOwner}/{repo}`
- `target_project_id` = 源仓库的 `id`

缺失任一参数，GitCode 会把 PR 的 source/target 都设为 fork 仓库（fork 内部 PR），源仓库看不见、无法合并。

**验证方法**：检查响应 `target_project.path_with_namespace` 是否等于源仓库路径；不等则关闭该 PR 重试。

### 1.5 fork → 上游是唯一主路径

- 本 SKILL 的工作区恒为 fork 仓库的克隆（本地 origin 指向 fork），Issue/PR/CI 评论均落在**源仓库（上游）**，禁止提交到 fork 自身
- 源仓库推断优先级：`upstreamUrl` 参数 > `upstream` remote > 同名不同 owner 的 remote > fork 仓库 API 的 `parent` 字段
- head = 当前分支（禁止切分支）；base = 上游同名分支（用 `GET /repos/{upstreamOwner}/{repo}/branches/{branch}` 探测），无同名分支时回退 `default_branch` 并在报告标注

### 1.6 head 分支不在 fork 远端时的处理

若 API 报 head 分支不存在，先确认 `git push -u origin HEAD` 是否成功推到 fork；跨仓库 PR 的 head 必须已存在于 fork 仓库。

### 2. Issue 必须先于 CHANGELOG 提交与 PR 创建

两处都需要在"落盘/创建时"引用 Issue：

- CHANGELOG 条目末尾附 Issue 链接 —— 条目随分支提交，必须在 commit/push 前拿到 issue_number
- PR body 需在创建时就包含 `Closes #{issue_number}` 才能自动绑定；创建后再 PATCH 原仓库 PR 补写可能因权限不足返回 400

### 3. 中文 body 的编码问题

- ❌ 不要用 `Content-Type: application/json` 发含中文的 body —— 部分中文字符会显示为 `?` 或乱码
- ✅ 使用 `application/x-www-form-urlencoded`，body 值经 `encodeURIComponent`（脚本已内置）

### 4. POST 写操作认证必须用 Bearer 头（2026-08 ohos_checksum 实战）

- ❌ POST（创建 Issue/PR/评论）时把 token 放在 form body 的 `access_token` 字段会被拒：`401 token not found`（脚本旧实现即此问题，尚未修复）
- ✅ POST 一律用 Header `Authorization: Bearer {token}`；GET 读操作用 query 参数或 Bearer 头均可
- 规避：用 curl + `--data-urlencode` + Bearer 头替代脚本执行写操作

### 5. 组织迁移导致 API 路径分裂（2026-08 ohos_checksum 实战）

仓库从旧组织迁移到新组织后（如 `CPF-ApplicationTPC` → `openharmony-sig`）：
- 读 API（GET repo/issues/pulls/branches）新旧路径均可用
- 写 API（POST 创建 Issue/评论等）**只能用旧组织路径**，新路径返回 `1003 项目不存在`
- 排查方法：仓库 issue 的 `html_url` 会暴露真正的写入口（旧组织路径）；提交信息中 `See merge request: {org}/{repo}!N` 也可指示

### 6. PATCH 更新 PR 的字段名与权限（2026-08 ohos_checksum 实战）

- PR 描述字段名是 **`body`**，不是 `description`：用 `description` PATCH 返回 200 但**静默不生效**，用 `body` 才真正更新
- PATCH 更新 PR 必须同时带 `title`，否则报 400 参数缺失
- 跨仓 PR 作者**无权关闭自己的 PR**（`403 you can only update the title or description`）；同一 source branch 只能有 1 个打开的 PR（新创建返 409）
- 误建探测 PR 无法关闭时，可 PATCH 其 title/body 收编为正式 PR（分支方向一致即可）
- Issue 的 PATCH 类似：需同时带 `title`+`body`，关闭用 `state_event=close` 或 `state=close`

### 4. PR 网页地址格式

GitCode 的 PR 网页路径是 `/merge_requests/{number}`（非 GitHub 风格的 `/pull/{number}`）。

### 5. 提交人身份

不设置仓库级 `git config user.name/user.email` 时，提交人使用本地全局配置，可能与 Token 所属用户不一致。克隆/Fork 后立即设置：

```bash
git config user.name "{name}"
git config user.email "{email}"
```

### 6. Fork 已存在的处理

Fork API 在 fork 已存在时可能报错。策略：

1. 先 `GET /repos/{currentUser}/{repo}` 探测是否已 fork
2. 已存在且无未合并分支 → 删除后重 Fork（保持与上游同步）
3. 已存在且有在用分支 → 直接复用，推送前 `git pull --rebase` 同步上游

---

## Fork 模式完整流程（工作区非 fork 克隆时补建 fork）

> 主路径是工作区已是 fork 克隆（直接从步骤 5 开始）。仅当工作区是源仓库直克隆且无写权限时，才从步骤 1 开始补建 fork。

```
1. POST /repos/{upstreamOwner}/{repo}/forks     # Fork 源仓库
2. git remote add fork https://{token}@gitcode.com/{currentUser}/{repo}.git
3. git config user.name/email                   # Token 用户身份
4. GET  /repos/{upstreamOwner}/{repo}           # 记 id、default_branch；探测同名分支
5. POST /repos/{upstreamOwner}/{repo}/issues    # 先建 Issue（CHANGELOG 与 PR 均需引用）
6. 更新 CHANGELOG.md                            # 仅当库本身有修改，条目带 Issue 链接
7. git add -A && git commit && git push -u {fork|origin} HEAD   # 当前分支，禁止切分支
8. POST /repos/{forkOwner}/{repo}/pulls         # 跨仓库 PR（head=当前分支，base=上游对应分支，带 fork_repo + target_project_id）
9. POST /repos/{upstreamOwner}/{repo}/pulls/{n}/comments  # body: Start build
```

> Token 出现在 clone URL 中属于正常用法，但**不得**写入报告、日志正文或 issue/PR 内容。

## Start build 评论规范

- 评论内容固定为 `Start build`（有的组织流水线要求首字母大写，不要写全小写）
- 必须评论在**原仓库**的 PR 上；评论在 fork 仓库不会触发原仓库门禁
- 评论失败不影响 PR 有效性，报告中如实记录 CI 触发状态即可
