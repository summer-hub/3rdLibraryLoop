#!/usr/bin/env bash
# 3rdloop 一键安装（Linux / macOS）
#
# 为什么需要它：本项目是**双包发布**（@ohos-cpf/3rdloop_core + @ohos-cpf/3rdloop），
# CLI 的 package.json 里写着对核心包的版本依赖。只装 CLI 那个 tarball 时，npm 会去
# registry 找 @ohos-cpf/3rdloop_core —— 它**不在公共 npm 上**，安装直接 E404。
# 因此必须两个 tarball 一起装；本脚本把「下载 → 校验 → 一起装 → 自检」封成一条命令。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/summor/3rdLibraryLoop/master/scripts/install.sh | bash
#   ./scripts/install.sh --tag v0.0.13 --prefix "$HOME/.local"
#   ./scripts/install.sh --from-dir ./dist            # 离线/本地验证
#
# 选项：
#   --tag <vX.Y.Z>        指定 Release tag，缺省取 latest
#   --prefix <dir>        装到指定前缀（npm i -g --prefix），不上 PATH
#   --from-dir <dir>      离线：直接用该目录里打好的 tarball 与 SHA256SUMS
#   --repo <owner/repo>   默认 summor/3rdLibraryLoop
#   --api <base>          Release API 基地址，默认 https://api.gitcode.com/api/v5
#   --download-base <url> 显式指定下载基地址（默认由 --api 与 --repo 推导）

set -euo pipefail

TAG=""
PREFIX=""
FROM_DIR=""
REPO="summor/3rdLibraryLoop"
API="https://api.gitcode.com/api/v5"
DOWNLOAD_BASE=""

say() { printf '[3l-install] %s\n' "$*"; }
die() { printf '[3l-install] 失败：%s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --tag) TAG="${2:-}"; shift 2 ;;
        --prefix) PREFIX="${2:-}"; shift 2 ;;
        --from-dir) FROM_DIR="${2:-}"; shift 2 ;;
        --repo) REPO="${2:-}"; shift 2 ;;
        --api) API="${2:-}"; shift 2 ;;
        --download-base) DOWNLOAD_BASE="${2:-}"; shift 2 ;;
        -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
        *) die "未知参数：$1" ;;
    esac
done

# ── 1. 依赖与工具 ───────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "找不到 node —— 请先安装 Node.js >= 22（https://nodejs.org/）"
command -v npm  >/dev/null 2>&1 || die "找不到 npm"
say "Node.js $(node --version)"

if command -v sha256sum >/dev/null 2>&1; then
    sha256_of() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
else
    die "找不到 sha256sum / shasum，无法校验发布物"
fi

if command -v curl >/dev/null 2>&1; then
    dl() { curl -fsSL --retry 2 --max-time 180 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
    dl() { wget -q -T 180 -O "$2" "$1"; }
else
    die "找不到 curl 或 wget"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/3l-install-XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# ── 2. 备齐两个 tarball + SHA256SUMS ───────────────────────────────
if [ -n "$FROM_DIR" ]; then
    [ -d "$FROM_DIR" ] || die "目录不存在：$FROM_DIR"
    say "离线模式：使用 $FROM_DIR"
    [ -f "$FROM_DIR/SHA256SUMS" ] || die "缺少 $FROM_DIR/SHA256SUMS（先跑 npm run release:pack）"
    WANT=""
    [ -n "$TAG" ] && WANT="$(printf '%s' "$TAG" | sed 's/^v//')"
    pick() { # $1=glob-ish 前缀匹配, $2=是否排除 _core
        local cand
        cand=$(ls -1 "$FROM_DIR" | grep -E "$1" | grep -v -E '\.sha256$' || true)
        [ "$2" = "exclude-core" ] && cand=$(printf '%s\n' "$cand" | grep -v '_core' || true)
        [ -n "$WANT" ] && cand=$(printf '%s\n' "$cand" | grep -F -- "-$WANT.tgz" || true)
        printf '%s\n' "$cand" | grep -v '^$' | sort -r | head -n1
    }
    CORE_NAME=$(pick '3rdloop_core-.*\.tgz$' include)
    CLI_NAME=$(pick '3rdloop-.*\.tgz$' exclude-core)
    [ -n "$CORE_NAME" ] && [ -n "$CLI_NAME" ] || die "目录里找不到匹配的核心包或 CLI 包：$FROM_DIR（tag=$TAG）"
    cp "$FROM_DIR/$CORE_NAME" "$FROM_DIR/$CLI_NAME" "$FROM_DIR/SHA256SUMS" "$WORK/"
    say "选用 $CORE_NAME + $CLI_NAME"
    TAG="${TAG:-本地产物}"
else
    if [ -z "$TAG" ]; then
        say "查询 latest Release（$REPO）"
        LATEST_JSON="$WORK/latest.json"
        dl "$API/repos/$REPO/releases/latest" "$LATEST_JSON" \
            || die "查询 latest 失败（$API）。请显式指定 --tag，例如 --tag v0.0.13"
        TAG=$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.tag_name||j.name||"")' "$LATEST_JSON" 2>/dev/null || true)
        [ -n "$TAG" ] || die "latest Release 响应里没有 tag_name"
    fi
    say "目标版本：$TAG"

    if [ -z "$DOWNLOAD_BASE" ]; then
        HOST=$(printf '%s' "$API" | sed -E 's#^https?://##; s#/.*$##; s#^api\.##')
        DOWNLOAD_BASE="https://$HOST/$REPO/releases/download/$TAG"
    fi
    say "下载地址：$DOWNLOAD_BASE"

    dl "$DOWNLOAD_BASE/SHA256SUMS" "$WORK/SHA256SUMS" || die "下载 SHA256SUMS 失败"
    # 清单元数据里的每个 asset 都下（当前就是两个 tarball）
    while read -r _hash name; do
        name="${name#\*}"
        [ -n "$name" ] || continue
        case "$name" in
            *.tgz) say "下载 $name"; dl "$DOWNLOAD_BASE/$name" "$WORK/$name" || die "下载 $name 失败" ;;
        esac
    done < "$WORK/SHA256SUMS"
    CORE_NAME=$(ls -1 "$WORK" | grep -E '3rdloop_core-.*\.tgz$' | head -n1 || true)
    CLI_NAME=$(ls -1 "$WORK" | grep -E '3rdloop-.*\.tgz$' | grep -v '_core' | head -n1 || true)
    [ -n "$CORE_NAME" ] && [ -n "$CLI_NAME" ] || die "Release 里缺核心包或 CLI 包的 .tgz —— 产物不完整"
fi

# ── 3. 校验 SHA256 ─────────────────────────────────────────────────
say "校验 SHA256"
while read -r hash name; do
    name="${name#\*}"
    [ -n "$name" ] || continue
    [ -f "$WORK/$name" ] || continue
    actual=$(sha256_of "$WORK/$name")
    expected=$(printf '%s' "$hash" | tr 'A-F' 'a-f')
    [ "$actual" = "$expected" ] || die "$name 的 SHA256 不匹配（期望 $expected，实际 $actual）"
    say "  ✓ $name"
done < "$WORK/SHA256SUMS"

# ── 4. 两个 tarball 一起装 ─────────────────────────────────────────
NPM_ARGS=(install -g "$WORK/$CORE_NAME" "$WORK/$CLI_NAME" --no-audit --no-fund)
[ -n "$PREFIX" ] && NPM_ARGS+=(--prefix "$PREFIX")
say "npm ${NPM_ARGS[*]}"
npm "${NPM_ARGS[@]}" || die "npm 安装失败（见上方输出）"

# ── 5. 自检 ────────────────────────────────────────────────────────
say "自检 3rdloop version"
if [ -n "$PREFIX" ]; then
    BIN=$(find "$PREFIX" -maxdepth 3 -name '3rdloop' -type f -o -maxdepth 3 -name '3rdloop' -type l 2>/dev/null | head -n1)
    [ -n "$BIN" ] || die "安装后在 $PREFIX 下找不到 3rdloop"
    "$BIN" version
else
    3rdloop version
fi

say ""
say "安装完成（$TAG）"
[ -n "$PREFIX" ] && say "  该前缀不在 PATH 上，请把它加入 PATH 或直接用 $PREFIX/bin/3rdloop"
say "  下一步：3rdloop doctor    （环境体检）"
say "          3rdloop serve     （起后端 + 前端 + 扩展）"
say "  升级：  3rdloop update --from-release --yes"
