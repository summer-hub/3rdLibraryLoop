#!/usr/bin/env python3
# @tool fetch-pr-info
# @description 获取 GitCode PR 元数据与 diff，生成可读摘要材料（rn-library-issue-generalizer 专用）
# @param prUrl: string - GitCode PR 地址，https://gitcode.com/{owner}/{repo}/pull/{number}
# @param outputDir: string - 输出目录绝对路径，材料写入 {outputDir}/pr-info/
# @param token: string - 可选，GitCode API Token（私有仓库/限流时使用）

"""fetch-pr-info.py — GitCode PR 材料获取脚本

用法:
    python3 fetch-pr-info.py '{"prUrl": "https://gitcode.com/owner/repo/pull/123", "outputDir": "/abs/path", "token": "xxx"}'

产出:
    {outputDir}/pr-info/{repo}-{number}.md    可读摘要（标题/描述/状态/变更文件/diff）
    {outputDir}/pr-info/{repo}-{number}.json  API 原始响应

依赖: 仅 Python 标准库（urllib），无第三方依赖
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

API_BASE = "https://gitcode.com/api/v5"
REQUEST_TIMEOUT = 20          # 单次请求超时（秒）
MAX_RETRIES = 3               # 限流/网络错误重试次数
RETRY_BASE_DELAY = 2          # 重试基础间隔（秒），按次数递增
PER_PAGE = 100                # files 接口分页大小
MAX_FILES_PAGES = 5           # files 接口最多翻页数（防超大 PR）
MAX_PATCH_CHARS = 20000       # 单文件 patch 截断阈值
MAX_TOTAL_PATCH_CHARS = 200000  # 全部 patch 总量截断阈值


def parse_pr_url(pr_url: str):
    """解析 PR 地址，返回 (owner, repo, number)"""
    parsed = urlparse(pr_url)
    if "gitcode.com" not in (parsed.hostname or ""):
        raise ValueError(f"仅支持 gitcode.com 地址: {pr_url}")
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 4 or parts[2] != "pull":
        raise ValueError(f"PR 地址格式无效（应为 owner/repo/pull/number）: {pr_url}")
    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    try:
        number = int(parts[3])
    except ValueError:
        raise ValueError(f"PR 序号无效: {parts[3]}")
    if number <= 0:
        raise ValueError(f"PR 序号无效: {number}")
    return owner, repo, number


def api_get(path: str, token: str = "") -> dict:
    """GET {API_BASE}{path}，带重试，返回 JSON dict"""
    url = f"{API_BASE}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            # 403/429 视为限流，可重试；401/404 等直接失败
            if e.code in (403, 429) and attempt < MAX_RETRIES:
                last_err = e
                time.sleep(RETRY_BASE_DELAY * attempt)
                continue
            raise ValueError(f"HTTP {e.code}: {url}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < MAX_RETRIES:
                last_err = e
                time.sleep(RETRY_BASE_DELAY * attempt)
                continue
            raise ValueError(f"网络错误: {url} ({e})") from e
    raise ValueError(f"重试耗尽: {url} ({last_err})")


def normalize_patch(file_entry: dict) -> None:
    """归一化 patch 字段：GitCode 返回 dict（含 diff/old_path/new_path），GitHub 风格为字符串。
    统一转换为字符串，并补充 filename（若缺失）。原地修改。"""
    patch = file_entry.get("patch")
    if isinstance(patch, dict):
        diff = patch.get("diff") or ""
        if not file_entry.get("filename"):
            file_entry["filename"] = patch.get("new_path") or patch.get("old_path") or "?"
        file_entry["patch"] = diff
    elif patch is None:
        file_entry["patch"] = ""


def fetch_pr_files(owner: str, repo: str, number: int, token: str) -> list:
    """分页获取 PR 变更文件列表（含 patch 字段）"""
    all_files = []
    for page in range(1, MAX_FILES_PAGES + 1):
        data = api_get(
            f"/repos/{owner}/{repo}/pulls/{number}/files?per_page={PER_PAGE}&page={page}",
            token,
        )
        if not data:
            break
        all_files.extend(data)
        if len(data) < PER_PAGE:
            break
    for f in all_files:
        normalize_patch(f)
    return all_files


def truncate_patch(files: list) -> tuple:
    """截断超大 patch，返回 (处理后的文件列表, 是否发生截断)"""
    truncated = False
    total = 0
    for f in files:
        patch = f.get("patch")
        if not patch:
            continue
        total += len(patch)
        if len(patch) > MAX_PATCH_CHARS or total > MAX_TOTAL_PATCH_CHARS:
            keep = min(len(patch), max(0, MAX_PATCH_CHARS), max(0, MAX_TOTAL_PATCH_CHARS - total + len(patch)))
            if keep < len(patch):
                f["patch"] = patch[:keep] + "\n... [diff 已截断]"
                truncated = True
    return files, truncated


def render_markdown(pr: dict, files: list, truncated: bool) -> str:
    """渲染可读摘要 markdown"""
    lines = []
    lines.append(f"# PR #{pr.get('number', '?')}: {pr.get('title', '(无标题)')}")
    lines.append("")
    lines.append(f"- **状态**: {pr.get('state', 'unknown')}")
    lines.append(f"- **作者**: {(pr.get('user') or {}).get('login', 'unknown')}")
    lines.append(f"- **创建时间**: {pr.get('created_at', '')}")
    lines.append(f"- **分支**: {pr.get('head', {}).get('ref', '')} → {pr.get('base', {}).get('ref', '')}")
    lines.append(f"- **变更文件数**: {len(files)}")
    if truncated:
        lines.append("- **⚠️ 注意**: diff 过大已截断，变更文件列表完整保留")
    lines.append("")

    body = (pr.get("body") or "").strip()
    if body:
        lines.append("## PR 描述")
        lines.append("")
        lines.append(body[:5000])
        lines.append("")

    lines.append("## 变更文件")
    lines.append("")
    lines.append("| 文件 | 变更 | +行 | -行 |")
    lines.append("|------|------|-----|-----|")
    for f in files:
        name = f.get("filename", "?")
        status = f.get("status", "?")
        add = f.get("additions", 0)
        dele = f.get("deletions", 0)
        lines.append(f"| `{name}` | {status} | +{add} | -{dele} |")
    lines.append("")

    lines.append("## Diff")
    lines.append("")
    for f in files:
        patch = f.get("patch")
        lines.append(f"### `{f.get('filename', '?')}`")
        lines.append("")
        if patch:
            lines.append(f"```diff\n{patch}\n```")
        else:
            lines.append("（无 patch 内容：二进制文件或 diff 不可用）")
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"参数 JSON 解析失败: {e}"}, ensure_ascii=False))
        return 1

    pr_url = args.get("prUrl", "")
    output_dir = args.get("outputDir", "")
    token = args.get("token", "")

    if not pr_url or not output_dir:
        print(json.dumps({"ok": False, "error": "prUrl 与 outputDir 为必填参数"}, ensure_ascii=False))
        return 1

    try:
        owner, repo, number = parse_pr_url(pr_url)
    except ValueError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1

    pr_dir = Path(output_dir) / "pr-info"
    md_path = pr_dir / f"{repo}-{number}.md"
    json_path = pr_dir / f"{repo}-{number}.json"

    # 幂等：已有材料直接复用
    if md_path.exists():
        print(json.dumps({"ok": True, "cached": True, "mdPath": str(md_path)}, ensure_ascii=False))
        return 0

    try:
        pr = api_get(f"/repos/{owner}/{repo}/pulls/{number}", token)
        files = fetch_pr_files(owner, repo, number, token)
    except ValueError as e:
        print(json.dumps({"ok": False, "error": str(e), "prUrl": pr_url}, ensure_ascii=False))
        return 1

    files, truncated = truncate_patch(files)

    pr_dir.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps({"pr": pr, "files": files}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md_path.write_text(render_markdown(pr, files, truncated), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "cached": False,
        "mdPath": str(md_path),
        "jsonPath": str(json_path),
        "filesCount": len(files),
        "truncated": truncated,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
