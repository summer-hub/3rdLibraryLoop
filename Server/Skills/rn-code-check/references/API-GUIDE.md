# 平台 API 使用指南

本文档提供各平台 PR API 的详细使用方法和响应格式。

---

## 一、GitCode 平台 API

### 1.1 PR 元数据 API

**请求示例**：
```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}?access_token={accessToken}"
```

**响应字段提取**：
| 字段 | JSON 路径 | 说明 |
|------|-----------|------|
| PR 标题 | `title` | 用于报告基本信息 |
| 目标分支 | `base.ref` | 用于 git clone |
| Head SHA | `head.sha` | PR 最新提交 hash |
| 作者 | `user.name` / `user.email` | 用于报告基本信息 |
| 创建时间 | `created_at` | 用于报告基本信息 |
| PR 状态 | `state` | open/merged/closed |

---

### 1.2 PR 文件变更 API

**请求示例**：
```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}/files.json?access_token={accessToken}"
```

**响应结构**：
```json
{
  "code": 0,
  "added_lines": 117,
  "remove_lines": 35,
  "count": 6,
  "diff_refs": {
    "base_sha": "<base commit>",
    "head_sha": "<PR head commit>"
  },
  "diffs": [
    {
      "statistic": {
        "new_path": "harmony/src/main/cpp/NativeCamera.cpp",
        "old_path": "harmony/src/main/cpp/NativeCamera.cpp"
      },
      "head": {
        "url": "https://raw.gitcode.com/{owner}/{repo}/raw/{head_sha}/{filePath}"
      },
      "added_lines": 40,
      "remove_lines": 29,
      "content": {
        "text": [
          { "line_content": "napi_value result;", "type": "new" },
          { "line_content": "napi_value oldVar;", "type": "old" },
          { "line_content": "napi_status status;", "type": "context" },
          { "line_content": "@@ -10,5 +10,6 @@", "type": "match" }
        ]
      }
    }
  ]
}
```

**关键字段说明**：

- **改动统计**：`added_lines`（新增行数）、`remove_lines`（删除行数）、`count`（文件数）
- **改动文件列表**：`diffs[].statistic.new_path`（含重命名时的 `old_path`）
- **结构化 diff**：`diffs[].content.text`（逐行带类型标记）
- **原始文件 URL**：`diffs[].head.url`（PR HEAD 版本的完整文件）

---

### 1.3 构建 Unified Diff

从 API 的 `content.text` 数组构建标准 diff 格式：

| API 类型 | Diff 前缀 | 说明 |
|----------|-----------|------|
| `old` | `-` | 删除的行 |
| `new` | `+` | 新增的行 |
| `context` | ` `（空格）| 未修改的上下文行 |
| `match` | 无前缀 | Hunk header（`@@ ... @@`）|

**保存路径**：`{outputDir}/pr.diff`

---

## 二、GitHub 平台 API

### 2.1 PR 元数据 API

**请求示例**：
```bash
curl -s "https://api.github.com/repos/{owner}/{repo}/pulls/{prNumber}"
# 若有 accessToken，添加 Header：
curl -s -H "Authorization: token {accessToken}" "https://api.github.com/repos/{owner}/{repo}/pulls/{prNumber}"
```

**响应字段**：
- `title`：PR 标题
- `base.ref`：目标分支
- `head.sha`：PR HEAD commit
- `user.login`：作者用户名

---

### 2.2 下载 Patch 文件

**Patch URL**：
```bash
curl -L -o {outputDir}/pr.patch "https://github.com/{owner}/{repo}/pull/{num}.patch"
```

**检测 HTML 重定向**：
```bash
head -1 {outputDir}/pr.patch | grep -q "<!DOCTYPE html"
```

若为 HTML，说明需要认证，提示用户提供 `accessToken`。

---

### 2.3 获取原始文件

**Raw URL**：
```
https://raw.githubusercontent.com/{owner}/{repo}/{head.sha}/{filename}
```

---

## 三、Gitee 平台 API

### 3.1 PR 元数据 API

**请求示例**：
```bash
curl -s "https://gitee.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}?access_token={accessToken}"
```

**响应字段**：同 GitCode API

---

### 3.2 获取原始文件

**请求示例**：
```bash
curl -s "https://gitee.com/api/v5/repos/{owner}/{repo}/raw/{filename}?ref={head.sha}&access_token={accessToken}"
```

---

### 3.3 下载 Patch 文件

**Patch URL**：
```bash
curl -L -o {outputDir}/pr.patch "https://gitee.com/{owner}/{repo}/pulls/{num}.patch"
```

---

## 四、GitLab 平台 API

### 4.1 PR 元数据 API

**请求示例**：
```bash
curl -s "https://gitlab.com/api/v4/projects/{id}/merge_requests/{num}"
# 项目 ID 可以编码为 {owner}%2F{repo}
```

---

### 4.2 下载 Patch 文件

**Patch URL**：
```bash
curl -L -o {outputDir}/pr.patch "https://gitlab.com/{owner}/{repo}/-/merge_requests/{num}.patch"
```

---

## 五、Git Clone 策略

### 5.1 标准克隆流程

```bash
# 1. 克隆目标分支（浅克隆节省时间）
git clone --depth=50 --branch {targetBranch} https://{platform}/{owner}/{repo}.git {outputDir}/source/

# 2. 若指定分支失败，克隆默认分支
git clone --depth=50 https://{platform}/{owner}/{repo}.git {outputDir}/source/

# 3. 拉取 PR HEAD（GitCode/GitLab）
cd {outputDir}/source/
git ls-remote origin | grep "refs/merge-requests/{prNumber}/head"
git fetch origin refs/merge-requests/{prNumber}/head:pr{prNumber}
git checkout pr{prNumber}
```

---

### 5.2 Clone 失败处理

若克隆完全失败，在报告中注明：
```
未能获取完整仓库上下文，以下分析仅基于 API diff / patch 内容
```

并继续完成检视分析。

---

## 六、平台 URL 模式总结

| 平台 | PR URL 模式 | API 支持 | Raw URL 模式 |
|------|-------------|----------|--------------|
| GitHub | `github.com/{owner}/{repo}/pull/{num}` | ✅ | `raw.githubusercontent.com/{owner}/{repo}/{sha}/{file}` |
| GitCode | `gitcode.com/{owner}/{repo}/pulls/{num}` | ✅ **推荐** | `raw.gitcode.com/{owner}/{repo}/raw/{sha}/{file}` |
| Gitee | `gitee.com/{owner}/{repo}/pulls/{num}` | ✅ | 通过 API 获取 |
| GitLab | `gitlab.com/{owner}/{repo}/-/merge_requests/{num}` | ✅ | `gitlab.com/{owner}/{repo}/-/raw/{sha}/{file}` |

---

**使用建议**：
- GitCode 平台优先使用 API（1.2 节）
- 其他平台使用 patch 下载 + 元数据 API（1.3 节）
- 所有平台都必须执行 git clone 获取完整上下文