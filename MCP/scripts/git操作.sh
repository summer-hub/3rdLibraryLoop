#!/bin/bash
# @tool git操作
# @description 执行 Git 操作，支持 status/log/branch/diff 等
# @param action: string - 操作类型 (status|log|branch|diff)
# @param repo: string - 仓库路径（默认当前目录）

ARGS_JSON="$1"

# 解析参数（使用 python3 解析 JSON，兼容性最佳）
action=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('action','status'))" "$ARGS_JSON" 2>/dev/null || echo "status")
repo=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('repo','.'))" "$ARGS_JSON" 2>/dev/null || echo ".")

cd "$repo" 2>/dev/null || { echo "Error: 无法进入目录 $repo"; exit 1; }

case "$action" in
    status)
        git status --short
        ;;
    log)
        git log --oneline -10
        ;;
    branch)
        git branch -a
        ;;
    diff)
        git diff --stat
        ;;
    *)
        echo "Unknown action: $action"
        echo "Supported: status|log|branch|diff"
        exit 1
        ;;
esac
