# GitCode Fork API 参考（gitcode-repo-fork）

所有 API 可通过 `node scripts/gitcode-fork.cjs <cmd> --help` 查看参数。

Base: `https://gitcode.com/api/v5`

认证方式：**所有请求统一使用 Header `Authorization: Bearer {token}`**（脚本已内置）。

---

## API 一览

| 操作 | 方法 | 端点 | 关键参数 / 返回 |
|------|------|------|----------------|
| 获取用户信息 | GET | `/user` | 返回 `login`（登录名 = Fork 目标 namespace）、`name`、`email` |
| 获取仓库信息 | GET | `/repos/{owner}/{repo}` | 返回 `id`（project_id）、`default_branch`、`parent.path_with_namespace`（fork 的直接源仓库）、`permissions`（`{pull,push,admin}`，可能缺失）；脚本 `get-repo` 已封装，`--allow-missing` 时 404 → `{exists:false}` |
| 探测分支存在 | GET | `/repos/{owner}/{repo}/branches/{branch}` | 200 存在 / 404 不存在（脚本 `get-branch` 已封装） |
| 创建 Fork | POST | `/repos/{owner}/{repo}/forks` | `name`（可选，fork 仓库名，默认与源仓库同名）；Fork 创建到 **Token 用户名下**；脚本 `create-fork` 已封装（幂等回查 + 就绪轮询） |

---

## 踩坑记录

### 1. POST 写操作认证必须用 Bearer 头（2026-08 ohos_checksum 实战）

- ❌ POST 时把 token 放在 form body 的 `access_token` 字段会被拒：`401 token not found`
- ✅ POST 一律用 Header `Authorization: Bearer {token}`；GET 用 Bearer 头或 query 参数均可（本脚本统一 Bearer 头）
- 来源于 ohos-lib-pr-push 的 GITCODE_API.md 实战记录，本脚本实现已遵循

### 2. Fork 是异步操作，创建后可能短暂 404

- `POST /repos/{owner}/{repo}/forks` 返回成功 ≠ 仓库立即可访问；刚创建的 Fork 在数秒内可能 404
- ✅ 创建后必须**轮询** `GET /repos/{forkOwner}/{repo}` 直到 200（脚本 `wait-fork` / `create-fork` 内置，默认超时 60s、间隔 3s）
- 超时不代表失败：Fork 可能仍在后台创建，稍后重跑即可（幂等探测会复用）

### 3. Fork 已存在的处理（幂等策略）

- Fork API 在 fork 已存在时可能报错（409/400，错误文案不稳定，**不要依赖错误文案做分支判断**）
- ✅ 策略：**先 GET 探测后创建**（`GET /repos/{tokenUser}/{repo}`）；创建失败时回查一次，仓库已出现则按"复用"返回
- 复用前必须校验 `parent` 是否等于目标源仓库 `{owner}/{repo}`：
  - `parent` 正确 → 复用
  - `parent` 为空或指向其他仓库 → **命名冲突**（Token 用户名下已有同名非本仓库 Fork 的仓库），终止交由用户处理，**禁止误用/覆盖**
- ⚠️ **禁止删除重建 Fork**（区别于旧文档"无未合并分支可删除重 Fork"的策略）：无法可靠验证对方仓库"无在用分支"，API 删除是破坏性操作且无法恢复；落后用 ff 同步即可达到同等效果，分叉场景属用户已有工作，必须人工决策

### 4. permissions 字段判定写权限

- 仓库响应的 `permissions` 对象（`{pull, push, admin}`）是"是否需要 Fork"的权威判据：`push == true` → 无需 Fork
- **实测（2026-09 CPF-RN 组织仓库）：`permissions` 可能为 null** → 兜底：`owner == Token 用户 username` 比对；两者都无法判定时终止询问用户，**禁止默认带写权限处理**

### 4.5 Token 可能缺 read_user scope（2026-09 实测）

- `GET /user` 可能返回 `403 no scopes:read_user`——Token 创建时未勾选用户信息读取权限
- 影响：无法自动获取 Token 用户登录名（Fork 目标 namespace）
- ✅ 兜底：`create-fork` 支持 `--fork-owner` 显式指定（跳过 /user 查询）；SKILL 层面提供 `forkOwner` 任务参数
- 提交人 `email` 不可得时用 `{forkOwner}@noreply.gitcode.com` 占位并在报告注明
- 长期建议：为 Token 补充 read_user scope

### 5. Fork of Fork 语义

- 目标仓库本身是 fork（响应含 `parent`）时，`POST forks` 仍 Fork **该仓库本身**（新 fork 的 `parent` = 该仓库，不追溯更上游）
- 后续 PR 的提交目标 = 被 Fork 的仓库（ohos-lib-pr-push 通过 fork 仓库的 `parent` 字段推断上游，与本语义一致）

### 6. GitCode clone 重定向警告属正常行为（KB: experiences/gitcode-clone-redirect-warning-normal）

- `git clone https://gitcode.com/xxx/yyy` 输出"警告：重定向到 .../yyy.git/"是 GitCode 自动补全 `.git` 后缀的正常行为
- **不算失败、不触发降级重试**；判定克隆失败以命令退出码非 0 或目标目录无仓库内容为准

### 7. Token 嵌入 remote URL 的惯例与红线

- `https://{token}@gitcode.com/{user}/{repo}.git` 形式的 clone/remote URL 可使后续 `git push` 免交互（ohos-lib-pr-push 的 Fork 模式同款用法）
- **为什么允许明文内嵌**（设计决策，经评审确认保持）：① 下游 `ohos-lib-pr-push` 需无人值守推送，无 credential helper 的环境（Linux 常见）会卡死在交互式密码提示；② URL 内嵌是唯一零依赖、三平台行为一致的免交互方式；③ 信任边界不变——Token 本就以明文存于 `Server/.env`，`.git/config` 同为本机用户级文件，HTTPS 下只发给 gitcode.com
- 已知残余风险（接受）：后续会话 `git remote -v` 可见明文；工作区打包/共享时 `.git/config` 随之暴露。更严格的替代方案（`git credential approve` 注入系统凭证管理器 + 干净 remote）已评估，因跨平台自动化可靠性优先而未采用；如未来环境变化（如统一 macOS）可重新评估
- Token 仅存于本地 `.git/config`，属可接受的正常用法
- **红线**：Token 绝不写入报告、fork-info.json、日志正文、issue/PR 内容；`git remote -v` 输出展示前必须将 Token 替换为 `***`

### 8. 提交人身份

- 不设置仓库级 `git config user.name/user.email` 时，提交人使用本地全局配置，可能与 Token 所属用户不一致（上游显示为"陌生人"提交）
- 克隆/Fork 后立即设置仓库级配置（本 SKILL Phase 4 已内置）

---

## 与 ohos-lib-pr-push 的衔接契约

本 SKILL 产出的工作区直接满足 ohos-lib-pr-push 的输入前提：

| 契约项 | 本 SKILL 的落实 |
|--------|----------------|
| origin 指向 fork 仓库 | Phase 4 remote 手术 / 克隆自 fork |
| upstream（或可推断的）指向源仓库 | Phase 4 `git remote add upstream` |
| fork 仓库 API 的 `parent` 字段可推断上游 | Fork 创建后 parent 恒为源仓库 |
| 仓库级提交人 = Token 用户 | Phase 4.1 步骤 5 / Phase 4.2 |
| Token 可推送 | fork remote URL 内嵌 Token（`plainRemote=false` 默认） |

ohos-lib-pr-push Phase 5 推送失败提示"用 Token Fork 后添加 remote 再推"的场景，即本 SKILL Phase 4.1 的"已有工作区接入"路径——先跑本 SKILL 再重跑 pr-push 即可。
