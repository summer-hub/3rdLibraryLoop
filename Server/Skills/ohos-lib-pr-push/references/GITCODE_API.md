# GitCode API 参考（ohos-lib-pr-push）

所有 API 均可通过对应子命令执行 `node scripts/gitcode-api.cjs <cmd> --help` 查看参数。脚本内部统一使用 `application/x-www-form-urlencoded` + UTF-8 发送写请求，避免中文乱码。

Base: `https://gitcode.com/api/v5`

认证方式：查询参数 `access_token={token}` 或 Header `Authorization: Bearer {token}`（脚本已内置）。

---

## API 一览

| 操作 | 方法 | 端点 | 关键参数 |
|------|------|------|---------|
| 获取用户信息 | GET | `/user` | 返回 `username`、`name`、`email` |
| 获取仓库信息 | GET | `/repos/{owner}/{repo}` | 返回 `id`（project_id）、`default_branch` |
| Fork 仓库 | POST | `/repos/{owner}/{repo}/forks` | `name`（fork 仓库名） |
| 创建 Issue | POST | `/repos/{owner}/{repo}/issues` | `title`、`body` |
| 创建跨仓库 PR | POST | `/repos/{forkOwner}/{repo}/pulls` | `fork_repo`（原仓库）、`target_project_id`（原仓库 id） |
| PR 评论 | POST | `/repos/{owner}/{repo}/pulls/{number}/comments` | `body=Start build`；owner/repo 用**原仓库** |
| 关闭 PR | PATCH | `/repos/{forkOwner}/{repo}/pulls/{number}` | `state=closed`（仅参数错误的 PR 需关闭重建时用） |

---

## 踩坑记录（来自 LibraryIntelligentFixSkill 实战）

### 1. 跨仓库 PR 必须传 target_project_id

从 fork 向原仓库提 PR 时，调用 **fork 仓库**的 pulls API，且必须传：

- `fork_repo` = 原仓库 `{owner}/{repo}`
- `target_project_id` = 原仓库的 `id`

缺失任一参数，GitCode 会把 PR 的 source/target 都设为 fork 仓库（fork 内部 PR），原仓库看不见、无法合并。

**验证方法**：检查响应 `target_project.path_with_namespace` 是否等于原仓库路径；不等则关闭该 PR 重试。

### 2. Issue 必须先于 CHANGELOG 提交与 PR 创建

两处都需要在"落盘/创建时"引用 Issue：

- CHANGELOG 条目末尾附 Issue 链接 —— 条目随分支提交，必须在 commit/push 前拿到 issue_number
- PR body 需在创建时就包含 `Closes #{issue_number}` 才能自动绑定；创建后再 PATCH 原仓库 PR 补写可能因权限不足返回 400

### 3. 中文 body 的编码问题

- ❌ 不要用 `Content-Type: application/json` 发含中文的 body —— 部分中文字符会显示为 `?` 或乱码
- ✅ 使用 `application/x-www-form-urlencoded`，body 值经 `encodeURIComponent`（脚本已内置）

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

## Fork 模式完整流程（无原仓库写权限时）

```
1. POST /repos/{owner}/{repo}/forks            # Fork
2. git remote add fork https://{token}@gitcode.com/{currentUser}/{repo}.git
3. git config user.name/email                   # Token 用户身份
4. GET  /repos/{owner}/{repo}                   # 记 id、default_branch
5. POST /repos/{owner}/{repo}/issues            # 先建 Issue（CHANGELOG 与 PR 均需引用）
6. 更新 CHANGELOG.md                            # 仅当库本身有修改，条目带 Issue 链接
7. git add -A && git commit && git push -u fork {branchName}
8. POST /repos/{currentUser}/{repo}/pulls       # 跨仓库 PR（带 fork_repo + target_project_id）
9. POST /repos/{owner}/{repo}/pulls/{n}/comments  # body: Start build
```

> Token 出现在 clone URL 中属于正常用法，但**不得**写入报告、日志正文或 issue/PR 内容。

## Start build 评论规范

- 评论内容固定为 `Start build`（有的组织流水线要求首字母大写，不要写全小写）
- 必须评论在**原仓库**的 PR 上；评论在 fork 仓库不会触发原仓库门禁
- 评论失败不影响 PR 有效性，报告中如实记录 CI 触发状态即可
