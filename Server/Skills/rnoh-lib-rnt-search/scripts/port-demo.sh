#!/usr/bin/env bash
# @tool port-demo
# @description 将 rnt demo 目录内容复制到目标 RN 工程的 example/src/ 下。
#              支持默认排除项（node_modules/build/__tests__ 等）、--clean 清空目标、
#              --clean-all 强制全清（含通用组件 Navigation.tsx）、--exclude 追加排除项。
# @param demo-path: string - rnt demo 目录绝对路径
# @param target: string - 目标 example/src/ 目录绝对路径
# @param clean: boolean - 迁移前清空目标（默认 false）
# @param clean-all: boolean - 强制清空目标含通用组件（默认 false）
# @param exclude: string - 逗号分隔的追加排除项

set -euo pipefail

DEMO_PATH=""
TARGET=""
CLEAN="false"
CLEAN_ALL="false"
EXCLUDE_EXTRA=""

usage() {
  cat <<'EOF'
Usage: port-demo.sh --demo-path <demo-dir> --target <example-src> [--clean] [--clean-all] [--exclude 'a,b,c']

Copy rnt demo contents into target example/src/, excluding node_modules/build/__tests__ etc.

Options:
  --clean        Clear target before copy (requires user confirmation in SKILL flow)
  --clean-all    Force clear all including components/Navigation.tsx
  --exclude      Comma-separated additional exclude patterns

Exit codes:
  0 = success
  1 = error (missing args, paths not found, rsync failed)
EOF
}

log() { printf '[port-demo] %s\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --demo-path) DEMO_PATH="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --clean) CLEAN="true"; shift ;;
    --clean-all) CLEAN_ALL="true"; CLEAN="true"; shift ;;
    --exclude) EXCLUDE_EXTRA="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$DEMO_PATH" ]] || { echo "--demo-path is required" >&2; exit 1; }
[[ -n "$TARGET" ]] || { echo "--target is required" >&2; exit 1; }
[[ -d "$DEMO_PATH" ]] || { echo "Demo path not found: $DEMO_PATH" >&2; exit 1; }

DEMO_PATH="$(cd "$DEMO_PATH" && pwd)"

# Ensure target exists (create if missing, but warn — example/src should already exist)
if [[ ! -d "$TARGET" ]]; then
  log "Target directory does not exist: $TARGET"
  log "Creating target directory. If example/ does not exist, run rn-lib-add-example first."
  mkdir -p "$TARGET"
fi
TARGET="$(cd "$TARGET" && pwd)"

# Build exclude arguments
EXCLUDE_ARGS=(
  --exclude 'node_modules/'
  --exclude 'build/'
  --exclude '__tests__/'
  --exclude '.cxx/'
  --exclude 'oh_modules/'
  --exclude '.git/'
  --exclude '.hg/'
  --exclude 'dist/'
  --exclude 'coverage/'
  --exclude '.cache/'
  --exclude '.DS_Store'
  --exclude '*.log'
  --exclude 'oh-package-lock.json5'
)

# Unless --clean-all, preserve components/Navigation.tsx (common reusable component)
if [[ "$CLEAN_ALL" != "true" ]]; then
  EXCLUDE_ARGS+=(--filter 'protect components/Navigation.tsx')
fi

# Append user-provided excludes
if [[ -n "$EXCLUDE_EXTRA" ]]; then
  IFS=',' read -ra EX_ITEMS <<< "$EXCLUDE_EXTRA"
  for item in "${EX_ITEMS[@]}"; do
    item="$(echo "$item" | xargs)"  # trim whitespace
    [[ -n "$item" ]] && EXCLUDE_ARGS+=(--exclude "$item")
  done
fi

# Pre-copy: detect conflicts (files in both demo and target, excluding excludes)
log "Checking for conflicts between demo and target..."
CONFLICTS=""
while IFS= read -r line; do
  [[ -n "$line" ]] && CONFLICTS="$CONFLICTS$line"$'\n'
done < <(
  cd "$DEMO_PATH" && find . -type f \
    -not -path './node_modules/*' \
    -not -path './build/*' \
    -not -path './__tests__/*' \
    -not -path './.cxx/*' \
    -not -path './oh_modules/*' \
    -not -name '.DS_Store' \
    -not -name '*.log' 2>/dev/null | while read -r f; do
      [[ -f "$TARGET/$f" ]] && echo "$f"
  done
)

if [[ -n "$CONFLICTS" && "$CLEAN" != "true" ]]; then
  log "Conflicting files found in target (use --clean to overwrite, or resolve manually):"
  printf '%s\n' "$CONFLICTS" >&2
  log "Proceeding with rsync (will overwrite conflicts). Pass --clean to clear target first."
fi

# Clean target if requested
if [[ "$CLEAN" == "true" ]]; then
  log "Cleaning target: $TARGET (clean-all=$CLEAN_ALL)"
  if [[ "$CLEAN_ALL" == "true" ]]; then
    find "$TARGET" -mindepth 1 -delete 2>/dev/null || true
  else
    # Preserve components/Navigation.tsx if it exists
    NAV_TMP=""
    if [[ -f "$TARGET/components/Navigation.tsx" ]]; then
      NAV_TMP="$(mktemp -d)"
      cp "$TARGET/components/Navigation.tsx" "$NAV_TMP/Navigation.tsx"
      log "Preserved components/Navigation.tsx"
    fi
    find "$TARGET" -mindepth 1 -delete 2>/dev/null || true
    if [[ -n "$NAV_TMP" ]]; then
      mkdir -p "$TARGET/components"
      cp "$NAV_TMP/Navigation.tsx" "$TARGET/components/Navigation.tsx"
      rm -rf "$NAV_TMP"
    fi
  fi
fi

# Copy using rsync
log "Copying demo $DEMO_PATH -> $TARGET"
log "Excludes: ${EXCLUDE_ARGS[*]}"

if ! command -v rsync >/dev/null 2>&1; then
  log "rsync not found, falling back to cp"
  # Fallback: cp -R with manual excludes
  cd "$DEMO_PATH"
  for item in *; do
    [[ -e "$item" ]] || continue
    case "$item" in
      node_modules|build|__tests__|.cxx|oh_modules|.git|.hg|dist|coverage|.cache) continue ;;
      *) cp -R "$item" "$TARGET/" ;;
    esac
  done
else
  rsync -a "${EXCLUDE_ARGS[@]}" "$DEMO_PATH/" "$TARGET/"
fi

# Output migrated file list
log "Migration complete. Migrated files (excluding excluded):"
cd "$TARGET" && find . -type f \
  -not -path './node_modules/*' \
  -not -path './build/*' \
  -not -path './__tests__/*' \
  -not -path './.cxx/*' \
  -not -path './oh_modules/*' \
  -not -name '.DS_Store' \
  -not -name '*.log' | sort

log "Done. File count: $(cd "$TARGET" && find . -type f -not -path './node_modules/*' -not -path './build/*' | wc -l | tr -d ' ')"
