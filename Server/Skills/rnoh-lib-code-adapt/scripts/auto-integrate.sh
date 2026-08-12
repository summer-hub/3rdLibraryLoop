#!/usr/bin/env bash
#
# RNOH 三方库自动检测集成脚本
#
# 只需提供 npm 包名或 git URL，脚本会自动解析库的文件结构，
# 推导出所有集成参数，然后调用 add-library.sh 完成集成。
#
# 用法:
#   ./scripts/auto-integrate.sh --npm-name <npm-package-name> [--npm-version <version>]
#   ./scripts/auto-integrate.sh --git-url <git-url> --branch <branch>
#
# 示例:
#   # 自动集成 image-picker (从 npm 安装)
#   ./scripts/auto-integrate.sh --npm-name @react-native-ohos/react-native-image-picker
#
#   # 自动集成 lottie (指定版本)
#   ./scripts/auto-integrate.sh --npm-name @react-native-ohos/lottie-react-native --npm-version 7.2.7-rc.6
#
#   # 从 git 仓库克隆并自动集成
#   ./scripts/auto-integrate.sh --git-url https://gitcode.com/CPF-RN/rntpc_react-native-image-picker --branch br_rnoh0.77
#
#   # 从 git 仓库克隆，指定子目录 (monorepo 场景)
#   ./scripts/auto-integrate.sh --git-url https://gitcode.com/xxx/mono-repo --branch main --subdir packages/lib-name
#

set -euo pipefail

# ── 颜色输出 ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
debug() { [[ "${VERBOSE:-false}" == "true" ]] && echo -e "${CYAN}[DEBUG]${NC} $*" || true; }

# ── 默认值 ────────────────────────────────────────────────
NPM_NAME=""
NPM_VERSION=""
GIT_URL=""
GIT_BRANCH=""
GIT_SUBDIR=""
NPM_INSTALL_FLAGS=""
VERBOSE=false
DRY_RUN=false

# 脚本所在目录 (scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 模板根目录 (包含 0.77/ 0.82/ scripts/ 等)
TEMPLATE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ADD_LIBRARY_SCRIPT="${SCRIPT_DIR}/add-library.sh"
PARSE_LIBRARY_SCRIPT="${SCRIPT_DIR}/parse-library.py"

# 工程目录: 优先使用当前工作目录 (用户 cd 到 0.77/ 或 0.82/ 后运行脚本)
# 如果 CWD 中有 package.json 则视为工程目录
# 否则回退到 CWD
if [[ -f "$(pwd)/package.json" ]]; then
  PROJECT_DIR="$(pwd)"
else
  # 尝试向上查找 package.json
  PROJECT_DIR="$(pwd)"
  for i in $(seq 1 5); do
    if [[ -f "${PROJECT_DIR}/package.json" ]]; then
      break
    fi
    PROJECT_DIR="$(dirname "${PROJECT_DIR}")"
  done
  if [[ ! -f "${PROJECT_DIR}/package.json" ]]; then
    error "未找到工程目录 (需要包含 package.json), 请 cd 到 0.77/ 或 0.82/ 目录后运行"
  fi
fi

# ── 参数解析 ──────────────────────────────────────────────
usage() {
  cat <<'EOF'
RNOH 三方库自动检测集成脚本

用法:
  ./scripts/auto-integrate.sh [选项]

数据源 (二选一):
  --npm-name <name>              npm 包名 (如 @react-native-ohos/react-native-image-picker)
  --git-url <url>                git 仓库 URL (如 https://gitcode.com/CPF-RN/rntpc_react-native-image-picker)

可选参数:
  --npm-version <version>        npm 包版本
  --branch <branch>              git 分支名 (配合 --git-url 使用)
  --subdir <path>                库在 monorepo 中的子目录路径
  --legacy-peer-deps             npm install 时使用 --legacy-peer-deps
  --force                        npm install 时使用 --force
  --verbose                      显示详细调试信息
  --dry-run                      只解析不实际集成
  --help, -h                     显示帮助

示例:
  # 自动集成 image-picker
  ./scripts/auto-integrate.sh --npm-name @react-native-ohos/react-native-image-picker

  # 自动集成 lottie (指定版本)
  ./scripts/auto-integrate.sh --npm-name @react-native-ohos/lottie-react-native --npm-version 7.2.7-rc.6

  # 从 git 仓库克隆并集成
  ./scripts/auto-integrate.sh --git-url https://gitcode.com/CPF-RN/rntpc_react-native-image-picker --branch br_rnoh0.77
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --npm-name)           NPM_NAME="$2"; shift 2;;
    --npm-version)        NPM_VERSION="$2"; shift 2;;
    --git-url)            GIT_URL="$2"; shift 2;;
    --branch)             GIT_BRANCH="$2"; shift 2;;
    --subdir)             GIT_SUBDIR="$2"; shift 2;;
    --legacy-peer-deps)   NPM_INSTALL_FLAGS="$NPM_INSTALL_FLAGS --legacy-peer-deps"; shift;;
    --force)              NPM_INSTALL_FLAGS="$NPM_INSTALL_FLAGS --force"; shift;;
    --verbose)            VERBOSE=true; shift;;
    --dry-run)            DRY_RUN=true; shift;;
    --help|-h)            usage;;
    *) error "未知参数: $1 (使用 --help 查看用法)";;
  esac
done

# ── 参数校验 ──────────────────────────────────────────────
if [[ -z "$NPM_NAME" && -z "$GIT_URL" ]]; then
  error "必须指定 --npm-name 或 --git-url"
fi

if [[ -n "$GIT_URL" && -z "$GIT_BRANCH" ]]; then
  warn "未指定 --branch, 将使用默认分支"
  GIT_BRANCH="--"
fi

# ── 检查依赖 ──────────────────────────────────────────────
for cmd in python3 npm git; do
  command -v "$cmd" >/dev/null 2>&1 || error "未找到命令: $cmd, 请先安装"
done

[[ -x "$ADD_LIBRARY_SCRIPT" ]] || error "add-library.sh 不存在或不可执行: $ADD_LIBRARY_SCRIPT"
[[ -f "$PARSE_LIBRARY_SCRIPT" ]] || error "parse-library.py 不存在: $PARSE_LIBRARY_SCRIPT"

# ════════════════════════════════════════════════════════════
# 阶段 1: 安装/获取库
# ════════════════════════════════════════════════════════════

echo ""
echo "=========================================="
echo "  RNOH 三方库自动检测集成"
echo "=========================================="
echo ""

# ── 1a. 从 git 克隆 ──────────────────────────────────────
if [[ -n "$GIT_URL" ]]; then
  info "从 git 仓库获取库..."

  TMP_GIT_DIR="/tmp/rnoh-auto-integrate-$(date +%s)"
  info "  克隆 ${GIT_URL} (分支: ${GIT_BRANCH})"

  if [[ "$GIT_BRANCH" == "--" ]]; then
    git clone --depth=1 "$GIT_URL" "$TMP_GIT_DIR" 2>&1 | tail -3
  else
    git clone --depth=1 -b "$GIT_BRANCH" "$GIT_URL" "$TMP_GIT_DIR" 2>&1 | tail -3
  fi

  [[ -d "$TMP_GIT_DIR" ]] || error "git clone 失败"

  # 如果有子目录
  if [[ -n "$GIT_SUBDIR" ]]; then
    LIB_SRC_DIR="${TMP_GIT_DIR}/${GIT_SUBDIR}"
  else
    LIB_SRC_DIR="$TMP_GIT_DIR"
  fi

  [[ -f "${LIB_SRC_DIR}/package.json" ]] || error "未在 ${LIB_SRC_DIR} 找到 package.json"

  # 从 package.json 读取 npm 包名
  NPM_NAME=$(python3 -c "
import json
with open('${LIB_SRC_DIR}/package.json') as f:
    data = json.load(f)
print(data.get('name', ''))
")

  [[ -z "$NPM_NAME" ]] && error "无法从 package.json 读取包名"
  info "  库包名: ${NPM_NAME}"

  # 将库复制到 node_modules
  NODE_MODULES_DIR="${PROJECT_DIR}/node_modules/${NPM_NAME}"
  info "  复制库到 node_modules/${NPM_NAME}"
  mkdir -p "$(dirname "$NODE_MODULES_DIR")"
  rm -rf "$NODE_MODULES_DIR"
  cp -r "$LIB_SRC_DIR" "$NODE_MODULES_DIR"

  # 在 package.json 中添加依赖声明 (如果还没有)
  LIB_VERSION=$(python3 -c "
import json
with open('${LIB_SRC_DIR}/package.json') as f:
    data = json.load(f)
print(data.get('version', '*'))
")
  info "  库版本: ${LIB_VERSION}"

  # 添加到 package.json dependencies
  python3 -c "
import json, sys
pkg_path = '${PROJECT_DIR}/package.json'
with open(pkg_path) as f:
    pkg = json.load(f)
deps = pkg.setdefault('dependencies', {})
if '${NPM_NAME}' not in deps:
    deps['${NPM_NAME}'] = '${LIB_VERSION}'
    with open(pkg_path, 'w') as f:
        json.dump(pkg, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('added')
else:
    print('exists')
" || warn "无法更新 package.json"

  # 运行 npm install 解析依赖 (库本身已在 node_modules 中, 这步主要安装库的 peer deps)
  info "  解析依赖..."
  (cd "$PROJECT_DIR" && npm install $NPM_INSTALL_FLAGS 2>&1 | tail -5) || warn "npm install 可能部分失败 (可忽略 peer dependency 警告)"

else
  # ── 1b. 从 npm 安装 ──────────────────────────────────────
  info "从 npm 安装库..."

  if [[ -n "$NPM_VERSION" ]]; then
    info "  npm install ${NPM_NAME}@${NPM_VERSION}${NPM_INSTALL_FLAGS}"
    (cd "$PROJECT_DIR" && npm install "${NPM_NAME}@${NPM_VERSION}" --save $NPM_INSTALL_FLAGS)
  else
    info "  npm install ${NPM_NAME}${NPM_INSTALL_FLAGS}"
    (cd "$PROJECT_DIR" && npm install "$NPM_NAME" --save $NPM_INSTALL_FLAGS)
  fi
fi

# ── 确定库目录 ────────────────────────────────────────────
LIB_DIR="${PROJECT_DIR}/node_modules/${NPM_NAME}"
[[ -d "$LIB_DIR" ]] || error "库目录不存在: ${LIB_DIR}"
[[ -f "${LIB_DIR}/package.json" ]] || error "package.json 不存在: ${LIB_DIR}/package.json"

ok "库已就绪: ${LIB_DIR}"

# ════════════════════════════════════════════════════════════
# 阶段 2: 自动解析库结构 (调用 parse-library.py)
# ════════════════════════════════════════════════════════════

echo ""
info "开始自动解析库结构..."

PARSE_FLAGS=""
[[ "$VERBOSE" == "true" ]] && PARSE_FLAGS="--verbose"

PARSED_JSON=$(python3 "$PARSE_LIBRARY_SCRIPT" "$LIB_DIR" $PARSE_FLAGS 2>/dev/null) || {
  # 如果失败, 重新运行并显示 stderr
  python3 "$PARSE_LIBRARY_SCRIPT" "$LIB_DIR" $PARSE_FLAGS
  error "库解析失败"
}

debug "解析结果 (JSON):"
debug "$PARSED_JSON"

# 从 JSON 提取各字段
extract_json() {
  local key="$1"
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('${key}',''))" <<< "$PARSED_JSON"
}

PARSED_NPM_NAME=$(extract_json "npm_name")
PARSED_ALIAS=$(extract_json "harmony_alias")
LIB_TYPE=$(extract_json "lib_type")
HAS_FABRIC=$(extract_json "has_fabric_component")
HAS_TURBO=$(extract_json "has_turbo_module")

HAR_DEP_NAME=$(extract_json "har_dep_name")
HAR_DEP_PATH=$(extract_json "har_dep_path")

ETS_PKG_CLASS=$(extract_json "ets_package_class")
ETS_IMPORT_PATH=$(extract_json "ets_import_path")

CPP_PKG_CLASS=$(extract_json "cpp_package_class")
CPP_PKG_HEADER=$(extract_json "cpp_package_header")
CPP_CMAKE_TARGET=$(extract_json "cpp_cmake_target")
CPP_CMAKE_SUBDIR=$(extract_json "cpp_cmake_subdir")

COMPONENT_NAME=$(extract_json "component_name")
ARKTS_COMP_STRUCT=$(extract_json "arkts_component_struct")
ARKTS_COMP_NAME=$(extract_json "arkts_component_name")
ARKTS_COMP_IMPORT=$(extract_json "arkts_component_import")

AUTOLINKING_PRESENT=$(extract_json "autolinking_present")

# ════════════════════════════════════════════════════════════
# 阶段 3: 输出解析结果
# ════════════════════════════════════════════════════════════

echo ""
echo "──────────────────────────────────────────"
echo "  自动解析结果"
echo "──────────────────────────────────────────"
echo ""

print_field() {
  local label="$1"
  local value="$2"
  if [[ -n "$value" && "$value" != "null" ]]; then
    echo -e "  ${GREEN}✓${NC} ${label}: ${value}"
  else
    echo -e "  ${NC}-${NC} ${label}: (未检测到)${NC}"
  fi
}

print_field "npm 包名" "$PARSED_NPM_NAME"
print_field "harmony alias" "$PARSED_ALIAS"
print_field "库类型" "$LIB_TYPE"
if [[ "$AUTOLINKING_PRESENT" == "True" ]]; then
  print_field "解析来源" "package.json autolinking + 文件扫描"
else
  print_field "解析来源" "纯文件结构扫描"
fi
echo ""
print_field "HAR 依赖名" "$HAR_DEP_NAME"
print_field "HAR 文件路径" "$HAR_DEP_PATH"
echo ""
print_field "ArkTS Package 类名" "$ETS_PKG_CLASS"
print_field "ArkTS import 路径" "$ETS_IMPORT_PATH"
echo ""
print_field "C++ Package 类名" "$CPP_PKG_CLASS"
print_field "C++ 头文件名" "$CPP_PKG_HEADER"
print_field "CMake target" "$CPP_CMAKE_TARGET"
print_field "CMake 子目录" "$CPP_CMAKE_SUBDIR"
echo ""

if [[ "$HAS_FABRIC" == "True" ]]; then
  print_field "组件名" "$COMPONENT_NAME"
  print_field "组件 struct" "$ARKTS_COMP_STRUCT"
  print_field "组件类型常量" "$ARKTS_COMP_NAME"
  print_field "组件 import 路径" "$ARKTS_COMP_IMPORT"
else
  echo -e "  ${NC}-${NC} Fabric 组件: 无 (TurboModule 库不需要注册 ArkTS 组件)${NC}"
fi

echo ""
echo "──────────────────────────────────────────"
echo ""

# ════════════════════════════════════════════════════════════
# 阶段 4: 调用 add-library.sh 完成集成
# ════════════════════════════════════════════════════════════

if [[ "$DRY_RUN" == "true" ]]; then
  info "dry-run 模式: 不执行实际集成"
  echo ""
  echo "等价命令:"
  echo ""

  # 构建等效的 add-library.sh 命令
  CMD="./scripts/add-library.sh"
  CMD+=" --npm-name '${PARSED_NPM_NAME}'"
  [[ -n "$NPM_VERSION" ]] && CMD+=" --npm-version '${NPM_VERSION}'"
  [[ -n "$PARSED_ALIAS" ]] && CMD+=" --harmony-alias '${PARSED_ALIAS}'"
  [[ -n "$ETS_PKG_CLASS" ]] && CMD+=" --ets-package-class '${ETS_PKG_CLASS}'"
  [[ -n "$ETS_IMPORT_PATH" ]] && CMD+=" --ets-package-import-path '${ETS_IMPORT_PATH}'"
  [[ -n "$CPP_PKG_CLASS" ]] && CMD+=" --cpp-package-class '${CPP_PKG_CLASS}'"
  [[ -n "$CPP_PKG_HEADER" ]] && CMD+=" --cpp-package-header '${CPP_PKG_HEADER}'"
  [[ -n "$CPP_CMAKE_TARGET" ]] && CMD+=" --cpp-cmake-target '${CPP_CMAKE_TARGET}'"
  [[ -n "$CPP_CMAKE_SUBDIR" ]] && CMD+=" --cpp-cmake-subdir '${CPP_CMAKE_SUBDIR}'"
  [[ -n "$HAR_DEP_NAME" ]] && CMD+=" --har-dep-name '${HAR_DEP_NAME}'"
  [[ -n "$HAR_DEP_PATH" ]] && CMD+=" --har-dep-path '${HAR_DEP_PATH}'"
  [[ -n "$ARKTS_COMP_NAME" ]] && CMD+=" --arkts-component-name '${ARKTS_COMP_NAME}'"
  [[ -n "$ARKTS_COMP_IMPORT" ]] && CMD+=" --arkts-component-import-path '${ARKTS_COMP_IMPORT}'"
  [[ -n "$ARKTS_COMP_STRUCT" ]] && CMD+=" --arkts-component-struct '${ARKTS_COMP_STRUCT}'"

  # 美化输出 (每行一个参数)
  echo "$CMD" | sed 's/ --/\n    --/g' | sed 's/^/  /'
  echo ""
  exit 0
fi

# 构建参数数组
ARGS=()
ARGS+=(--npm-name "$PARSED_NPM_NAME")
ARGS+=(--skip-npm-install)  # 库已在阶段1安装
[[ -n "$NPM_VERSION" ]] && ARGS+=(--npm-version "$NPM_VERSION")
[[ -n "$PARSED_ALIAS" ]] && ARGS+=(--harmony-alias "$PARSED_ALIAS")
[[ -n "$ETS_PKG_CLASS" ]] && ARGS+=(--ets-package-class "$ETS_PKG_CLASS")
[[ -n "$ETS_IMPORT_PATH" ]] && ARGS+=(--ets-package-import-path "$ETS_IMPORT_PATH")
[[ -n "$CPP_PKG_CLASS" ]] && ARGS+=(--cpp-package-class "$CPP_PKG_CLASS")
[[ -n "$CPP_PKG_HEADER" ]] && ARGS+=(--cpp-package-header "$CPP_PKG_HEADER")
[[ -n "$CPP_CMAKE_TARGET" ]] && ARGS+=(--cpp-cmake-target "$CPP_CMAKE_TARGET")
[[ -n "$CPP_CMAKE_SUBDIR" ]] && ARGS+=(--cpp-cmake-subdir "$CPP_CMAKE_SUBDIR")
[[ -n "$HAR_DEP_NAME" ]] && ARGS+=(--har-dep-name "$HAR_DEP_NAME")
[[ -n "$HAR_DEP_PATH" ]] && ARGS+=(--har-dep-path "$HAR_DEP_PATH")
[[ -n "$ARKTS_COMP_NAME" ]] && ARGS+=(--arkts-component-name "$ARKTS_COMP_NAME")
[[ -n "$ARKTS_COMP_IMPORT" ]] && ARGS+=(--arkts-component-import-path "$ARKTS_COMP_IMPORT")
[[ -n "$ARKTS_COMP_STRUCT" ]] && ARGS+=(--arkts-component-struct "$ARKTS_COMP_STRUCT")

info "调用 add-library.sh 执行集成..."
echo ""

# 因为库已经安装, add-library.sh 的步骤 1 (npm install) 会重新执行
# 但 npm 有缓存所以很快, 且能正确写入 package.json
"$ADD_LIBRARY_SCRIPT" "${ARGS[@]}" || error "add-library.sh 执行失败"

echo ""
ok "自动检测集成完成!"
echo ""
echo "解析来源汇总:"
if [[ "$AUTOLINKING_PRESENT" == "True" ]]; then
  echo "  - package.json harmony.autolinking: 有 (优先使用)"
  echo "  - 文件结构扫描: 补充验证"
else
  echo "  - package.json harmony.autolinking: 无"
  echo "  - 文件结构扫描: ArkTS(*Package.ts) + C++(*Package.h) + CMake(CMakeLists.txt)"
fi

if [[ "$HAS_FABRIC" == "True" ]]; then
  echo "  - 组件名解析: *NativeComponent.ts → codegenNativeComponent()"
fi
