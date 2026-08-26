# PR 材料获取指南

> `scripts/fetch-pr-info.py` 用于获取 GitCode PR 的元数据与 diff，为根因分析提供修复前后对照材料。

---

## 1. 调用方式

```bash
python3 scripts/fetch-pr-info.py '{"prUrl": "https://gitcode.com/owner/repo/pull/123", "outputDir": "/absolute/path", "token": "可选"}'
```

参数（JSON 字符串）：

| 参数 | 必填 | 说明 |
|------|------|------|
| `prUrl` | ✅ | GitCode PR 地址，`https://gitcode.com/{owner}/{repo}/pull/{number}` |
| `outputDir` | ✅ | 知识库根目录（knowledgeDir），材料写入 `{knowledgeDir}/pr-info/` |
| `token` | ❌ | GitCode API Token，私有仓库/限流时使用 |

---

## 2. 产出文件

| 文件 | 内容 | 用途 |
|------|------|------|
| `pr-info/{repo}-{number}.md` | 可读摘要：标题、描述、状态、变更文件列表、逐文件 diff | Agent 根因分析的主要输入 |
| `pr-info/{repo}-{number}.json` | API 原始响应 | 排查/二次解析用 |

---

## 3. API 端点

GitCode 兼容 GitHub API v3 风格（`https://gitcode.com/api/v5`）：

| 数据 | 端点 |
|------|------|
| PR 元数据 | `GET /repos/{owner}/{repo}/pulls/{number}` |
| 变更文件 | `GET /repos/{owner}/{repo}/pulls/{number}/files`（含 patch 字段） |

- 无 Token 有速率限制；批量获取案例材料时建议传 `token`
- `files` 接口分页（per_page=100，page 递增），脚本已处理

---

## 4. 降级策略

| 情况 | 处理 |
|------|------|
| 私有仓库 401/404 | 脚本返回失败标记；Phase 1.3 走"材料不足"分支 |
| 速率限制 403/429 | 有 token 时自动重试（间隔递增，最多 3 次）；仍失败走降级 |
| PR 超大（files>300 或 patch 过大） | 脚本截断 diff 并在摘要中标注"diff 已截断"，保留变更文件全列表 |
| 网络不可达 | 脚本返回失败标记；走降级分支 |

**降级分支要求**（见 SKILL.md Phase 1.3）：基于问题描述做有限泛化，草稿"审核要点"中必须标注该规则未验证修复 diff。

---

## 5. 本地已有材料复用

若 `{outputDir}/pr-info/{repo}-{number}.md` 已存在，脚本直接跳过获取（幂等）。批量重跑时不会重复请求 API。
