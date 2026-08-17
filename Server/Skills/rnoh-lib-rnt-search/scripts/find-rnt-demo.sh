#!/usr/bin/env bash
# @tool find-rnt-demo
# @description 在 rnt 工程中扫描定位目标 RN 三方库的 demo 目录。基于 read-lib-meta.cjs 生成的候选名，
#              遍历 {rnt-root}/*/rn-tester/examples/ 匹配 demo，支持大小写不敏感兜底。
# @param lib-path: string - 目标 RN 三方库根目录（含 package.json）
# @param rnt-path: string - rnt 工程根目录
# @param demo-path: string - 用户已明确的 demo 目录（提供时跳过扫描）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_PATH=""
RNT_PATH=""
DEMO_PATH=""

usage() {
  cat <<'EOF'
Usage: find-rnt-demo.sh --lib-path <lib-root> --rnt-path <rnt-root> [--demo-path <explicit-demo-dir>]

Find the rnt tester demo directory for a target library.

Output: one demo path per line (absolute).
Exit codes:
  0 = exactly one match found
  1 = no match found
  2 = multiple matches found (auto-select first; user can override via --demo-path)
EOF
}

log() { printf '[find-rnt-demo] %s\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lib-path) LIB_PATH="${2:-}"; shift 2 ;;
    --rnt-path) RNT_PATH="${2:-}"; shift 2 ;;
    --demo-path) DEMO_PATH="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$LIB_PATH" ]] || { echo "--lib-path is required" >&2; exit 1; }
[[ -d "$LIB_PATH" ]] || { echo "Library path not found: $LIB_PATH" >&2; exit 1; }

# If user provided explicit demo path, validate and return it.
if [[ -n "$DEMO_PATH" ]]; then
  [[ -d "$DEMO_PATH" ]] || { echo "Demo path not found: $DEMO_PATH" >&2; exit 1; }
  cd "$DEMO_PATH" && pwd
  exit 0
fi

[[ -n "$RNT_PATH" ]] || { echo "--rnt-path is required when --demo-path is omitted" >&2; exit 1; }
[[ -d "$RNT_PATH" ]] || { echo "RNT path not found: $RNT_PATH" >&2; exit 1; }

LIB_PATH="$(cd "$LIB_PATH" && pwd)"
RNT_PATH="$(cd "$RNT_PATH" && pwd)"

# Read library metadata to get candidate search names.
META_JSON="$(node "$SCRIPT_DIR/read-lib-meta.cjs" "$LIB_PATH")"
SEARCH_NAMES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && SEARCH_NAMES+=("$line")
done < <(printf '%s' "$META_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(d["searchNames"]))')

log "Search names: ${SEARCH_NAMES[*]}"

matches=()
for sub in "$RNT_PATH"/*; do
  [[ -d "$sub" ]] || continue
  examples_root="$sub/rn-tester/examples"
  [[ -d "$examples_root" ]] || continue

  # Direct match: {examples-root}/{candidate-name}/
  for name in "${SEARCH_NAMES[@]}"; do
    candidate="$examples_root/$name"
    if [[ -d "$candidate" ]]; then
      matches+=("$(cd "$candidate" && pwd)")
    fi
  done

  # Case-insensitive fallback: compare directory names with scoped package tail.
  while IFS= read -r demo_dir; do
    demo_name="$(basename "$demo_dir")"
    for name in "${SEARCH_NAMES[@]}"; do
      if [[ "$(printf '%s' "$demo_name" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" ]]; then
        matches+=("$(cd "$demo_dir" && pwd)")
      fi
    done
  done < <(find "$examples_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
done

# Deduplicate
deduped="$(printf '%s\n' "${matches[@]}" | awk '!seen[$0]++')"
match_count="$(printf '%s\n' "$deduped" | grep -c . || true)"

if [[ "$match_count" -eq 0 ]]; then
  log "No demo found under $RNT_PATH/*/rn-tester/examples/"
  log "Searched candidates: ${SEARCH_NAMES[*]}"
  log "Hint: manually browse $RNT_PATH/*/rn-tester/examples/ for similar names, or provide --demo-path explicitly."
  exit 1
fi

if [[ "$match_count" -eq 1 ]]; then
  printf '%s\n' "$deduped"
  exit 0
fi

# Multiple matches: print all and exit 2
printf '%s\n' "$deduped"
log "Multiple demo directories found; auto-selected first match."
exit 2
