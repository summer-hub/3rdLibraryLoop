#!/usr/bin/env bash
#
# RNOH 测试 Demo/用例移植脚本
#
# 从 RN 三方库 git 仓库中拆解出测试 demo、用例目录，移植到模板工程中。
#
# 工作流程:
#   1. git clone 仓库到当前目录下的 TestGet/ 目录中
#   2. 自动检测仓库中的测试 demo/用例目录 (example、demo、test、tests、spec 等)
#   3. 如果 demo/用例目录中存在 package.json, 将其依赖的三方库安装到模板工程 (本地依赖)
#   4. 将 demo/用例目录中的所有文件按原有目录结构拷贝到模板工程 src/ 下
#      并将 demo 的入口组件接入到模板工程的 src/index.tsx
#
# 用法:
#   ./scripts/port-test-demo.sh --git-url <url> --branch <branch> [选项]
#
# 示例:
#   # 移植 lottie-react-native 的测试 demo
#   ./scripts/port-test-demo.sh \
#     --git-url https://github.com/lottie-react-native/lottie-react-native \
#     --branch v7.4.0
#
#   # 指定模板版本目录 (默认自动检测 0.77 或 0.82)
#   ./scripts/port-test-demo.sh \
#     --git-url https://github.com/lottie-react-native/lottie-react-native \
#     --branch v7.4.0 \
#     --template-dir /Users/lalhan/Desktop/RNOH/RN3rdTemplate/0.77
#
#   # 手动指定 demo 目录 (跳过自动检测)
#   ./scripts/port-test-demo.sh \
#     --git-url https://github.com/lottie-react-native/lottie-react-native \
#     --branch v7.4.0 \
#     --demo-dirs example
#
#   # dry-run 模式 (只检测不实际拷贝)
#   ./scripts/port-test-demo.sh \
#     --git-url https://github.com/lottie-react-native/lottie-react-native \
#     --branch v7.4.0 \
#     --dry-run
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
GIT_URL=""
GIT_BRANCH=""
TEMPLATE_DIR=""
DEMO_DIRS_OVERRIDE=""
NPM_INSTALL_FLAGS=""
VERBOSE=false
DRY_RUN=false
SKIP_NPM_INSTALL=false
SKIP_INDEX_MERGE=false

# 已知的 demo/用例目录名 (按常见度排序)
KNOWN_DEMO_DIRS=("example" "demo" "Example" "Demo" "test" "tests" "Test" "Tests" "spec" "specs" "__tests__" "e2e" "cypress")

# 脚本所在目录 (scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 模板根目录 (包含 0.77/ 0.82/ scripts/ 等)
TEMPLATE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── 参数解析 ──────────────────────────────────────────────
usage() {
  cat <<'EOF'
RNOH 测试 Demo/用例移植脚本

从 RN 三方库 git 仓库中拆解出测试 demo、用例目录，移植到模板工程中。

用法:
  ./scripts/port-test-demo.sh [选项]

必选参数:
  --git-url <url>              git 仓库 URL (如 https://github.com/lottie-react-native/lottie-react-native)
  --branch <branch>            git 分支名 (如 v7.4.0)

可选参数:
  --template-dir <path>        模板工程目录 (如 /path/to/RN3rdTemplate/0.77), 不指定则自动检测
  --demo-dirs <dir1,dir2,...>  手动指定 demo 目录名 (逗号分隔, 跳过自动检测)
  --legacy-peer-deps           npm install 时使用 --legacy-peer-deps
  --force                      npm install 时使用 --force
  --skip-npm-install           跳过依赖安装步骤
  --skip-index-merge           跳过 index.tsx 合并步骤 (只拷贝文件不修改入口)
  --verbose                    显示详细调试信息
  --dry-run                    只检测不实际拷贝
  --help, -h                   显示帮助

示例:
  # 移植 lottie-react-native 的测试 demo
  ./scripts/port-test-demo.sh \
    --git-url https://github.com/lottie-react-native/lottie-react-native \
    --branch v7.4.0

  # 手动指定 demo 目录
  ./scripts/port-test-demo.sh \
    --git-url https://github.com/lottie-react-native/lottie-react-native \
    --branch v7.4.0 \
    --demo-dirs example

  # dry-run 模式
  ./scripts/port-test-demo.sh \
    --git-url https://github.com/lottie-react-native/lottie-react-native \
    --branch v7.4.0 \
    --dry-run
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --git-url)            GIT_URL="$2"; shift 2;;
    --branch)             GIT_BRANCH="$2"; shift 2;;
    --template-dir)       TEMPLATE_DIR="$2"; shift 2;;
    --demo-dirs)          DEMO_DIRS_OVERRIDE="$2"; shift 2;;
    --legacy-peer-deps)   NPM_INSTALL_FLAGS="$NPM_INSTALL_FLAGS --legacy-peer-deps"; shift;;
    --force)              NPM_INSTALL_FLAGS="$NPM_INSTALL_FLAGS --force"; shift;;
    --skip-npm-install)   SKIP_NPM_INSTALL=true; shift;;
    --skip-index-merge)   SKIP_INDEX_MERGE=true; shift;;
    --verbose)            VERBOSE=true; shift;;
    --dry-run)            DRY_RUN=true; shift;;
    --help|-h)            usage;;
    *) error "未知参数: $1 (使用 --help 查看用法)";;
  esac
done

# ── 参数校验 ──────────────────────────────────────────────
if [[ -z "$GIT_URL" ]]; then
  error "必须指定 --git-url 参数"
fi

if [[ -z "$GIT_BRANCH" ]]; then
  warn "未指定 --branch, 将使用默认分支"
  GIT_BRANCH="--"
fi

# ── 检查依赖 ──────────────────────────────────────────────
for cmd in python3 npm git rsync; do
  command -v "$cmd" >/dev/null 2>&1 || error "未找到命令: $cmd, 请先安装"
done

# ── 自动检测模板工程目录 ──────────────────────────────────
detect_template_dir() {
  # 如果用户指定了 --template-dir, 直接使用
  if [[ -n "$TEMPLATE_DIR" ]]; then
    if [[ ! -d "$TEMPLATE_DIR" ]]; then
      error "指定的模板目录不存在: $TEMPLATE_DIR"
    fi
    if [[ ! -f "$TEMPLATE_DIR/package.json" ]]; then
      error "模板目录中没有 package.json: $TEMPLATE_DIR"
    fi
    return
  fi

  # 优先检查当前工作目录
  if [[ -f "$(pwd)/package.json" ]] && [[ -f "$(pwd)/src/index.tsx" ]]; then
    TEMPLATE_DIR="$(pwd)"
    return
  fi

  # 在模板根目录下查找 0.77 和 0.82
  for ver in "0.77" "0.82"; do
    local candidate="${TEMPLATE_ROOT}/${ver}"
    if [[ -d "$candidate" && -f "${candidate}/package.json" && -f "${candidate}/src/index.tsx" ]]; then
      TEMPLATE_DIR="$candidate"
      return
    fi
  done

  # 向上查找
  local search_dir
  search_dir="$(pwd)"
  for _i in $(seq 1 5); do
    if [[ -f "${search_dir}/package.json" && -f "${search_dir}/src/index.tsx" ]]; then
      TEMPLATE_DIR="$search_dir"
      return
    fi
    search_dir="$(dirname "$search_dir")"
  done

  error "未找到模板工程目录 (需要包含 package.json 和 src/index.tsx), 请使用 --template-dir 指定"
}

detect_template_dir
info "模板工程目录: ${TEMPLATE_DIR}"

# ════════════════════════════════════════════════════════════
# 阶段 1: git clone 仓库到 TestGet/ 目录
# ════════════════════════════════════════════════════════════

echo ""
echo "=========================================="
echo "  RNOH 测试 Demo/用例移植"
echo "=========================================="
echo ""

# TestGet 目录位于脚本调用时的当前工作目录下
WORK_DIR="$(pwd)/TestGet"
info "工作目录: ${WORK_DIR}"

# 从 URL 中提取仓库名作为克隆目录名
REPO_NAME=$(basename "$GIT_URL" .git)
debug "仓库名: ${REPO_NAME}"

CLONE_DIR="${WORK_DIR}/${REPO_NAME}"

info "克隆仓库: ${GIT_URL}"
if [[ "$GIT_BRANCH" == "--" ]]; then
  info "  分支: (默认)"
  mkdir -p "$WORK_DIR"
  rm -rf "$CLONE_DIR"
  git clone --depth=1 "$GIT_URL" "$CLONE_DIR" 2>&1 | tail -3
else
  info "  分支: ${GIT_BRANCH}"
  mkdir -p "$WORK_DIR"
  rm -rf "$CLONE_DIR"
  git clone --depth=1 -b "$GIT_BRANCH" "$GIT_URL" "$CLONE_DIR" 2>&1 | tail -3
fi

[[ -d "$CLONE_DIR" ]] || error "git clone 失败: $GIT_URL"
[[ -d "$CLONE_DIR/.git" ]] || error "git clone 不完整: $CLONE_DIR"

# 移除 .git 目录 (减少体积, 避免后续拷贝时出问题)
rm -rf "$CLONE_DIR/.git"

ok "仓库克隆完成: ${CLONE_DIR}"
echo ""

# ════════════════════════════════════════════════════════════
# 阶段 2: 检测测试 demo/用例目录
# ════════════════════════════════════════════════════════════

info "检测测试 demo/用例目录..."

# 检测 demo 目录
# 支持手动指定或自动检测
# 自动检测策略:
#   1. 优先检查根目录下的已知 demo 目录名
#   2. 如果根目录没有, 在 packages/*/ 下查找 (monorepo 场景)
DETECTED_DEMO_DIRS=()

if [[ -n "$DEMO_DIRS_OVERRIDE" ]]; then
  # 用户手动指定
  IFS=',' read -ra DETECTED_DEMO_DIRS <<< "$DEMO_DIRS_OVERRIDE"
  info "  使用手动指定的 demo 目录: ${DETECTED_DEMO_DIRS[*]}"
else
  # 自动检测: 检查根目录
  # 注意: macOS 文件系统大小写不敏感, example 和 Example 会匹配同一个目录
  # 需要用小写名去重, 但保留实际目录名
  # 不使用关联数组 (macOS bash 3.2 不支持 declare -A)
  SEEN_DIRS_LOWER=""
  for dir in "${KNOWN_DEMO_DIRS[@]}"; do
    if [[ -d "${CLONE_DIR}/${dir}" ]]; then
      # 获取实际目录名 (解决大小写不敏感问题)
      # ls 输出的目录名是磁盘上的实际大小写
      actual_dir=$(ls -1 "${CLONE_DIR}" | grep -ix "^${dir}\$" 2>/dev/null | head -1)
      [[ -z "$actual_dir" ]] && actual_dir="$dir"
      dir_lower=$(echo "$actual_dir" | tr '[:upper:]' '[:lower:]')
      # 检查是否已存在 (用空格分隔的字符串)
      if [[ -z "$(echo " $SEEN_DIRS_LOWER " | grep " $dir_lower ")" ]]; then
        SEEN_DIRS_LOWER="${SEEN_DIRS_LOWER} ${dir_lower}"
        DETECTED_DEMO_DIRS+=("$actual_dir")
        debug "  根目录发现: ${actual_dir}/"
      fi
    fi
  done
  unset SEEN_DIRS_LOWER

  # 自动检测: 检查 monorepo 子包中的 demo 目录
  if [[ ${#DETECTED_DEMO_DIRS[@]} -eq 0 ]] && [[ -d "${CLONE_DIR}/packages" ]]; then
    debug "  根目录未发现 demo 目录, 检查 monorepo packages/*/"
    SEEN_MONO_LOWER=""
    for pkg_subdir in "${CLONE_DIR}"/packages/*/; do
      [[ -d "$pkg_subdir" ]] || continue
      pkg_rel="${pkg_subdir#${CLONE_DIR}/}"
      pkg_rel="${pkg_rel%/}"
      # 获取子包内实际目录名
      for dir in "${KNOWN_DEMO_DIRS[@]}"; do
        if [[ -d "${pkg_subdir}${dir}" ]]; then
          actual_mono_dir=$(ls -1 "${pkg_subdir}" | grep -ix "^${dir}\$" 2>/dev/null | head -1)
          [[ -z "$actual_mono_dir" ]] && actual_mono_dir="$dir"
          full_path="${pkg_rel}/${actual_mono_dir}"
          full_lower=$(echo "$full_path" | tr '[:upper:]' '[:lower:]')
          if [[ -z "$(echo " $SEEN_MONO_LOWER " | grep " $full_lower ")" ]]; then
            SEEN_MONO_LOWER="${SEEN_MONO_LOWER} ${full_lower}"
            DETECTED_DEMO_DIRS+=("$full_path")
            debug "  monorepo 子包发现: ${full_path}/"
          fi
        fi
      done
    done
    unset SEEN_MONO_LOWER
  fi
fi

if [[ ${#DETECTED_DEMO_DIRS[@]} -eq 0 ]]; then
  warn "未检测到任何测试 demo/用例目录"
  warn "已知目录名: ${KNOWN_DEMO_DIRS[*]}"
  warn "可使用 --demo-dirs 手动指定"
  echo ""

  # 列出仓库根目录内容供用户参考
  info "仓库根目录内容:"
  ls -1 "$CLONE_DIR" | head -20
  exit 0
fi

echo ""
echo "──────────────────────────────────────────"
echo "  检测到 ${#DETECTED_DEMO_DIRS[@]} 个 demo/用例目录"
echo "──────────────────────────────────────────"
for dir in "${DETECTED_DEMO_DIRS[@]}"; do
  echo -e "  ${GREEN}✓${NC} ${dir}/"
done
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  info "dry-run 模式: 不执行实际拷贝"

  # 展示各目录内容
  for dir in "${DETECTED_DEMO_DIRS[@]}"; do
    echo ""
    info "目录 ${dir}/ 内容:"
    ls -1 "${CLONE_DIR}/${dir}" 2>/dev/null | head -15 || true
  done

  # 展示 package.json 依赖
  for dir in "${DETECTED_DEMO_DIRS[@]}"; do
    local_pkg="${CLONE_DIR}/${dir}/package.json"
    if [[ -f "$local_pkg" ]]; then
      echo ""
      info "${dir}/package.json 依赖:"
      python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
deps = data.get('dependencies', {})
dev_deps = data.get('devDependencies', {})
if deps:
    print('  dependencies:')
    for k, v in deps.items():
        print(f'    {k}: {v}')
if dev_deps:
    print('  devDependencies:')
    for k, v in dev_deps.items():
        print(f'    {k}: {v}')
if not deps and not dev_deps:
    print('  (无依赖)')
" "$local_pkg" 2>/dev/null || warn "  无法解析 package.json"
    fi
  done

  echo ""
  ok "dry-run 完成"
  exit 0
fi

# ════════════════════════════════════════════════════════════
# 阶段 3: 安装 demo 依赖到模板工程 (本地依赖)
# ════════════════════════════════════════════════════════════

# 收集所有 demo 目录中的 package.json 依赖
# 依赖安装策略:
#   - 跳过 react / react-native (模板工程已有)
#   - 跳过 workspace: 协议依赖 (monorepo 内部引用, 需特殊处理)
#   - 其他依赖以 npm 包方式安装到模板工程
#   - workspace: 依赖指向的本仓库自身的库, 以本地依赖 (file:) 方式安装
#     需要从仓库根的 package.json 获取真实包名和版本

# 模板工程已有的依赖 (从 package.json 读取)
TEMPLATE_DEPS_JSON=""
TEMPLATE_DEPS_JSON=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
deps = data.get('dependencies', {})
dev_deps = data.get('devDependencies', {})
all_deps = set(list(deps.keys()) + list(dev_deps.keys()))
for d in sorted(all_deps):
    print(d)
" "$TEMPLATE_DIR/package.json" 2>/dev/null || echo "")

# 读取仓库根 package.json (用于处理 workspace: 依赖)
REPO_PKG_JSON="${CLONE_DIR}/package.json"
REPO_NPM_NAME=""
REPO_NPM_VERSION=""
if [[ -f "$REPO_PKG_JSON" ]]; then
  REPO_NPM_NAME=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
print(data.get('name', ''))
" "$REPO_PKG_JSON" 2>/dev/null || echo "")
  REPO_NPM_VERSION=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
print(data.get('version', '*'))
" "$REPO_PKG_JSON" 2>/dev/null || echo "*")
  debug "仓库包名: ${REPO_NPM_NAME}, 版本: ${REPO_NPM_VERSION}"
fi

if [[ "$SKIP_NPM_INSTALL" == "true" ]]; then
  warn "跳过依赖安装步骤 (--skip-npm-install)"
else
  info "开始安装 demo 依赖到模板工程..."

  # 收集需要安装的依赖
  # 格式: 包名|版本, 用临时文件传递给 python 处理
  DEPS_TMP_FILE=$(mktemp /tmp/port-test-demo-deps.XXXXXX)
  trap 'rm -f "$DEPS_TMP_FILE"' EXIT

  for dir in "${DETECTED_DEMO_DIRS[@]}"; do
    local_pkg="${CLONE_DIR}/${dir}/package.json"
    [[ -f "$local_pkg" ]] || continue

    info "  解析 ${dir}/package.json 依赖..."

    # 提取 dependencies 和 devDependencies
    # 输出格式: dep_name|dep_version (每行一个)
    python3 -c "
import json, sys

pkg_path = sys.argv[1]
repo_name = sys.argv[2]
repo_version = sys.argv[3]

with open(pkg_path) as f:
    data = json.load(f)

all_deps = {}
all_deps.update(data.get('dependencies', {}))
all_deps.update(data.get('devDependencies', {}))

for dep_name, dep_version in all_deps.items():
    # workspace: 协议 → 指向仓库自身, 替换为仓库包名和版本
    if dep_version.startswith('workspace:'):
        # workspace:* 或 workspace:^ 等 → 使用仓库根 package.json 的版本
        if repo_name and repo_name == dep_name:
            # demo 引用的就是仓库自身的主包, 用 file: 本地依赖
            print(f'{dep_name}|file:{repo_version}')
        elif repo_name:
            # 可能引用的是仓库内的子包, 也用 file: 指向仓库根
            print(f'{dep_name}|file:{repo_version}')
        else:
            # 无法确定包名, 用 latest
            print(f'{dep_name}|latest')
    elif dep_version.startswith('file:') or dep_version.startswith('link:'):
        # 已经是本地依赖, 原样输出
        clean_ver = dep_version.replace('file:', '').replace('link:', '')
        print(f'{dep_name}|file:{clean_ver}')
    else:
        # 普通 npm 依赖, 原样输出版本号
        print(f'{dep_name}|{dep_version}')
" "$local_pkg" "$REPO_NPM_NAME" "$REPO_NPM_VERSION" >> "$DEPS_TMP_FILE" 2>/dev/null || warn "  无法解析 ${dir}/package.json"
  done

  # 去重并过滤掉模板工程已有的依赖和不需要的依赖
  # 需要排除的包名列表 (模板工程已有或不需要安装)
  EXCLUDE_PKGS=("react" "react-native" "react-dom" "react-test-renderer"
    "@babel/core" "@babel/preset-env" "@babel/runtime" "@babel/preset-react"
    "@react-native-community/cli" "@react-native-community/cli-platform-android"
    "@react-native-community/cli-platform-ios" "@react-native-community/eslint-config"
    "@react-native/babel-preset" "@react-native/eslint-config"
    "@react-native/metro-config" "@react-native/typescript-config"
    "@react-native-oh/react-native-harmony" "@react-native-oh/react-native-harmony-cli"
    "@tsconfig/react-native" "@types/react" "@types/react-test-renderer"
    "@types/jest" "babel-jest" "eslint" "jest" "metro-react-native-babel-preset"
    "prettier" "typescript" "react-native-macos" "react-native-web"
    "react-native-test-app" "@rnx-kit/metro-config")

  # 构建排除模式字符串 (用于 grep -v -E)
  EXCLUDE_PATTERN=$(IFS='|' ; echo "${EXCLUDE_PKGS[*]}")

  # 去重 + 过滤
  UNIQUE_DEPS=$(sort -u "$DEPS_TMP_FILE" | grep -v -E "^(${EXCLUDE_PATTERN})\|" || true)

  if [[ -z "$UNIQUE_DEPS" ]]; then
    info "  没有需要安装的新依赖"
  else
    dep_count=$(echo "$UNIQUE_DEPS" | wc -l | tr -d ' ')
    info "  发现 ${dep_count} 个需要安装的依赖:"
    echo "$UNIQUE_DEPS" | while IFS='|' read -r dep_name dep_version; do
      echo -e "    ${CYAN}${dep_name}${NC} -> ${dep_version}"
    done
    echo ""

    # 安装依赖
    info "  开始安装依赖..."

    # 分为两类: npm 包依赖 和 file: 本地依赖
    NPM_DEPS=()
    FILE_DEPS=()

    while IFS='|' read -r dep_name dep_version; do
      if [[ "$dep_version" == file:* ]]; then
        FILE_DEPS+=("${dep_name}@${dep_version}")
      else
        NPM_DEPS+=("${dep_name}@${dep_version}")
      fi
    done <<< "$UNIQUE_DEPS"

    # 安装 npm 包依赖
    if [[ ${#NPM_DEPS[@]} -gt 0 ]]; then
      info "  安装 npm 依赖 (${#NPM_DEPS[@]} 个)..."
      (cd "$TEMPLATE_DIR" && npm install --save "${NPM_DEPS[@]}" $NPM_INSTALL_FLAGS 2>&1 | tail -5) || warn "npm install 部分依赖可能安装失败"
    fi

    # 安装 file: 本地依赖
    # 对于 workspace: 依赖, file: 指向的路径是仓库根目录的版本号 (不是实际路径)
    # 需要将其改为指向 TestGet/ 下的实际仓库路径
    if [[ ${#FILE_DEPS[@]} -gt 0 ]]; then
      info "  安装本地依赖 (${#FILE_DEPS[@]} 个)..."

      for file_dep in "${FILE_DEPS[@]}"; do
        dep_name="${file_dep%%@*}"
        dep_value="${file_dep#*@}"

        # 如果 file: 后面跟的是版本号 (来自 workspace: 转换), 改为指向实际仓库路径
        file_target="${dep_value#file:}"
        if [[ ! "$file_target" == /* && ! "$file_target" == ./* ]]; then
          # file_target 是版本号, 不是路径 → 指向 TestGet 中的仓库
          # 检查仓库中是否有 packages/<dep_name> 子目录 (monorepo)
          local_pkg_dir=""
          if [[ -d "${CLONE_DIR}/packages" ]]; then
            for pkg_subdir in "${CLONE_DIR}"/packages/*/; do
              if [[ -f "${pkg_subdir}package.json" ]]; then
                local_pkg_name=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
print(data.get('name', ''))
" "${pkg_subdir}package.json" 2>/dev/null || echo "")
                if [[ "$local_pkg_name" == "$dep_name" ]]; then
                  local_pkg_dir="${pkg_subdir%/}"
                  break
                fi
              fi
            done
          fi

          # 如果没在 packages/ 中找到, 检查仓库根目录
          if [[ -z "$local_pkg_dir" && "$REPO_NPM_NAME" == "$dep_name" ]]; then
            local_pkg_dir="$CLONE_DIR"
          fi

          if [[ -n "$local_pkg_dir" ]]; then
            # 计算从模板工程到本地仓库的相对路径
            local_rel_path=$(python3 -c "
import os, sys
print(os.path.relpath(sys.argv[1], sys.argv[2]))
" "$local_pkg_dir" "$TEMPLATE_DIR")
            dep_value="file:${local_rel_path}"
          else
            # 无法找到本地路径, 回退为普通 npm 安装
            warn "  无法找到 ${dep_name} 的本地路径, 尝试从 npm 安装"
            (cd "$TEMPLATE_DIR" && npm install --save "${dep_name}@latest" $NPM_INSTALL_FLAGS 2>&1 | tail -3) || warn "  ${dep_name} 安装失败"
            continue
          fi
        fi

        info "    ${dep_name} -> ${dep_value}"
        # 写入 package.json (file: 依赖)
        python3 -c "
import json, sys
pkg_path = sys.argv[1]
dep_name = sys.argv[2]
dep_value = sys.argv[3]

with open(pkg_path) as f:
    pkg = json.load(f)
deps = pkg.setdefault('dependencies', {})
deps[dep_name] = dep_value
with open(pkg_path, 'w') as f:
    json.dump(pkg, f, indent=2, ensure_ascii=False)
    f.write('\n')
" "$TEMPLATE_DIR/package.json" "$dep_name" "$dep_value" || warn "  无法写入 ${dep_name} 到 package.json"
      done

      # 运行 npm install 解析 file: 依赖
      info "  npm install (解析本地依赖)"
      (cd "$TEMPLATE_DIR" && npm install $NPM_INSTALL_FLAGS 2>&1 | tail -5) || warn "npm install 可能部分失败 (可忽略 peer dependency 警告)"
    fi
  fi

  ok "依赖安装完成"
fi

echo ""

# ════════════════════════════════════════════════════════════
# 阶段 4: 拷贝 demo/用例文件到模板工程
# ════════════════════════════════════════════════════════════

info "开始拷贝 demo/用例文件到模板工程..."

# 模板工程 src/ 目录
TEMPLATE_SRC_DIR="${TEMPLATE_DIR}/src"

# demo 文件拷贝策略:
#   - demo 的支撑文件 (assets、animations、其他模块) 拷贝到 src/ 顶层
#     这样 demo 代码中的 require("./animations/...") 等相对路径可以直接工作
#   - demo 的入口文件 (App.tsx / index.tsx 等) 不拷贝, 而是直接合并到 src/index.tsx
#   - 配置文件 (package.json / app.json / babel.config.js 等) 不拷贝

# 入口文件名 (按优先级排序)
ENTRY_FILE_NAMES=("App.tsx" "App.js" "index.tsx" "index.js")

# 需要跳过的文件 (不拷贝到 src/ 顶层)
# - 入口文件 → 直接合并到 index.tsx
# - index.js (AppRegistry 注册) → 模板工程有自己的 index.js
# - 配置文件 → 不拷贝
SKIP_FILES=(
  "App.tsx"
  "App.js"
  "index.tsx"
  "index.js"
  "index.web.js"
  "app.json"
  "babel.config.js"
  "metro.config.js"
  "react-native.config.js"
  "webpack.config.js"
  ".watchmanconfig"
  ".gitignore"
  "tsconfig.json"
  "package.json"
  "Gemfile"
  "Gemfile.lock"
  "ReactTestApp-Resources.podspec.json"
)

# 需要排除的目录 (find -not -path)
EXCLUDE_DIR_PATTERNS=(
  '*/node_modules/*'
  '*/android/*'
  '*/ios/*'
  '*/macos/*'
  '*/visionos/*'
  '*/dist/*'
  '*/build/*'
  '*/.git/*'
  '*/Pods/*'
  '*/public/*'
)

# 记录入口文件信息 (用于后续合并)
# 格式: "demo_dir_name|entry_file_name"
ENTRY_FILES=()

for dir in "${DETECTED_DEMO_DIRS[@]}"; do
  src_dir="${CLONE_DIR}/${dir}"
  [[ -d "$src_dir" ]] || continue

  dir_name=$(basename "$dir")

  info "  处理 ${dir}/"

  # 检测入口文件 (在拷贝之前, 从源目录检测)
  found_entry=""
  for entry_file in "${ENTRY_FILE_NAMES[@]}"; do
    if [[ -f "${src_dir}/${entry_file}" ]]; then
      found_entry="$entry_file"
      debug "    发现入口文件: ${dir_name}/${entry_file}"
      break
    fi
  done

  if [[ -n "$found_entry" ]]; then
    ENTRY_FILES+=("${dir_name}|${found_entry}")
  fi

  # 构建 find 排除参数
  find_exclude_args=()
  for pattern in "${EXCLUDE_DIR_PATTERNS[@]}"; do
    find_exclude_args+=(-not -path "$pattern")
  done

  # 拷贝支撑文件 (assets、animations、其他模块) 到 src/ 顶层
  # 跳过入口文件和配置文件
  while IFS= read -r -d '' file; do
    # 计算相对于 demo 目录的相对路径
    rel_path="${file#${src_dir}/}"
    file_name=$(basename "$rel_path")

    # 跳过配置文件和入口文件
    skip=false
    for skip_file in "${SKIP_FILES[@]}"; do
      if [[ "$file_name" == "$skip_file" ]]; then
        skip=true
        break
      fi
    done
    [[ "$skip" == "true" ]] && { debug "    跳过: ${rel_path}"; continue; }

    # 目标路径: src/<rel_path>
    dest_file="${TEMPLATE_SRC_DIR}/${rel_path}"
    dest_parent=$(dirname "$dest_file")
    mkdir -p "$dest_parent"
    # 如果目标文件已存在, 跳过 (保留本地已适配的文件, 只拷贝缺失的文件)
    if [[ -f "$dest_file" ]]; then
      info "    已存在, 跳过: ${rel_path}"
      continue
    fi
    cp "$file" "$dest_file"
    debug "    拷贝: ${rel_path}"
  done < <(find "$src_dir" -type f "${find_exclude_args[@]}" -print0)

done

# 统计拷贝的文件数
copied_count=$(find "$TEMPLATE_SRC_DIR" -type f -not -name 'index.tsx' -not -name 'index.backup.tsx' -not -name '*.d.ts' | wc -l | tr -d ' ')
info "  src/ 下共 ${copied_count} 个支撑文件"

ok "文件拷贝完成"
echo ""

# ════════════════════════════════════════════════════════════
# 阶段 5: 合并入口文件到 src/index.tsx
# ════════════════════════════════════════════════════════════

if [[ "$SKIP_INDEX_MERGE" == "true" ]]; then
  warn "跳过 index.tsx 合并步骤 (--skip-index-merge)"
  echo ""
  ok "测试 Demo/用例移植完成!"
  echo ""
  info "后续步骤:"
  echo "  1. 手动修改 src/index.tsx 引入 demo 组件"
  echo "  2. cd ${TEMPLATE_DIR} && npm run codegen"
  echo "  3. npm run dev"
  echo "  4. 用 DevEco Studio 打开 harmony/ 目录构建 HAP"
  exit 0
fi

info "合并入口文件到 src/index.tsx..."

# 备份原始 index.tsx
BACKUP_INDEX="${TEMPLATE_SRC_DIR}/index.backup.tsx"
# 首次运行: 备份原始模板 index.tsx
if [[ ! -f "$BACKUP_INDEX" ]]; then
  cp "${TEMPLATE_SRC_DIR}/index.tsx" "$BACKUP_INDEX"
  info "  已备份原始 index.tsx → index.backup.tsx"
fi
# 二次运行保护: 如果 index.tsx 已被修改 (与原始备份不同), 先备份当前版本再覆盖
if [[ -f "$BACKUP_INDEX" ]] && ! cmp -s "${TEMPLATE_SRC_DIR}/index.tsx" "$BACKUP_INDEX"; then
  backup_ts=$(date +%s)
  cp "${TEMPLATE_SRC_DIR}/index.tsx" "${TEMPLATE_SRC_DIR}/index.tsx.bak.${backup_ts}"
  warn "  index.tsx 已被修改 (可能已移植过 demo), 已备份当前版本 → index.tsx.bak.${backup_ts}"
fi

if [[ ${#ENTRY_FILES[@]} -eq 0 ]]; then
  warn "未检测到 demo 入口文件 (App.tsx / App.js / index.tsx / index.js)"
  warn "请手动修改 src/index.tsx 引入 demo 组件"
else
  info "  检测到 ${#ENTRY_FILES[@]} 个入口文件:"
  for entry in "${ENTRY_FILES[@]}"; do
    # entry 格式: "demo_dir_name|entry_file_name"
    entry_dir_name="${entry%%|*}"
    entry_file_name="${entry##*|}"
    echo -e "    ${GREEN}✓${NC} ${entry_dir_name}/${entry_file_name}"
  done
  echo ""

  # 生成新的 index.tsx
  # 策略:
  #   - 如果只有一个入口文件, 将其内容直接写入 src/index.tsx
  #     (去掉 AppRegistry 注册代码, 保留版权声明)
  #   - 如果有多个入口文件, 拷贝各入口到 src/<demo_dir>/ 下, 生成 TabView 切换器
  #     (切换器 import 各 demo 组件)

  if [[ ${#ENTRY_FILES[@]} -eq 1 ]]; then
    # ═══ 单个入口文件: 直接将内容写入 index.tsx ═══
    entry="${ENTRY_FILES[0]}"
    entry_dir_name="${entry%%|*}"
    entry_file_name="${entry##*|}"

    # 入口文件在源仓库中的路径
    # 如果 demo 目录在 monorepo 子包中 (如 packages/foo/example),
    # entry_dir_name 只是 basename, 需要找到完整的 demo 目录路径
    src_entry=""
    for dir in "${DETECTED_DEMO_DIRS[@]}"; do
      dir_bn=$(basename "$dir")
      if [[ "$dir_bn" == "$entry_dir_name" ]]; then
        src_entry="${CLONE_DIR}/${dir}/${entry_file_name}"
        break
      fi
    done
    [[ -z "$src_entry" || ! -f "$src_entry" ]] && src_entry="${CLONE_DIR}/${entry_dir_name}/${entry_file_name}"
    [[ ! -f "$src_entry" ]] && error "找不到入口文件: ${entry_dir_name}/${entry_file_name}"

    info "  将 ${entry_dir_name}/${entry_file_name} 内容写入 src/index.tsx"

    # 生成新的 index.tsx:
    #   1. 版权声明
    #   2. demo 入口文件内容 (去掉 AppRegistry 注册行)
    #
    # 过滤规则:
    #   - 去掉包含 AppRegistry 的 import 行
    #   - 去掉包含 AppRegistry.registerComponent 的行
    #   - 去掉包含 appName 的 import (from './app.json')
    #   - 去掉行首为 /** @format */ 的注释

    {
      # 版权声明
      cat <<'HEADER'
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

HEADER

      # demo 入口文件内容 (过滤 AppRegistry 相关代码)
      grep -vE 'AppRegistry|@format|from\s+["'\'']\./app\.json["'\'']' "$src_entry" || true
    } > "${TEMPLATE_SRC_DIR}/index.tsx"

    ok "  已更新 src/index.tsx ← ${entry_dir_name}/${entry_file_name} 内容"

  else
    # ═══ 多个入口文件: 拷贝各入口到 src/<demo_dir>/ 并生成切换器 ═══
    info "  生成多 demo 切换器组件..."

    # 拷贝各 demo 的入口文件到 src/<demo_dir>/ 下
    # 并收集导入信息
    IMPORTS=""
    DEMO_ITEMS=""
    idx=0
    for entry in "${ENTRY_FILES[@]}"; do
      entry_dir_name="${entry%%|*}"
      entry_file_name="${entry##*|}"
      entry_name="${entry_file_name%.*}"  # 去掉扩展名
      component_name="Demo${idx}"
      demo_label="$entry_dir_name"

      # 找到源入口文件
      src_entry=""
      for dir in "${DETECTED_DEMO_DIRS[@]}"; do
        dir_bn=$(basename "$dir")
        if [[ "$dir_bn" == "$entry_dir_name" ]]; then
          src_entry="${CLONE_DIR}/${dir}/${entry_file_name}"
          break
        fi
      done
      [[ -z "$src_entry" || ! -f "$src_entry" ]] && src_entry="${CLONE_DIR}/${entry_dir_name}/${entry_file_name}"
      [[ ! -f "$src_entry" ]] && { warn "找不到入口文件: ${entry_dir_name}/${entry_file_name}, 跳过"; continue; }

      # 拷贝入口文件到 src/<demo_dir>/<entry_file>
      demo_dest_dir="${TEMPLATE_SRC_DIR}/${entry_dir_name}"
      mkdir -p "$demo_dest_dir"
      cp "$src_entry" "${demo_dest_dir}/${entry_file_name}"

      import_path="./${entry_dir_name}/${entry_name}"

      # 检测默认导出
      has_default_export=false
      if grep -qE 'export\s+default' "$src_entry" 2>/dev/null; then
        has_default_export=true
      fi

      if [[ "$has_default_export" == "true" ]]; then
        IMPORTS+="import ${component_name} from \"${import_path}\";\n"
      else
        export_name=$(grep -oE 'export\s+(const|function|class)\s+(\w+)' "$src_entry" 2>/dev/null | head -1 | awk '{print $3}')
        if [[ -n "$export_name" ]]; then
          IMPORTS+="import { ${export_name} as ${component_name} } from \"${import_path}\";\n"
        else
          IMPORTS+="import ${component_name} from \"${import_path}\";\n"
        fi
      fi

      DEMO_ITEMS+="      { key: \"${demo_label}\", component: ${component_name} },\n"
      ((idx++)) || true
    done

    # 生成切换器组件
    cat > "${TEMPLATE_SRC_DIR}/index.tsx" <<INDEX_EOF
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
$(printf "${IMPORTS}" | sed '/^$/d')

interface DemoItem {
  key: string;
  component: React.ComponentType;
}

const demoItems: DemoItem[] = [
$(printf "${DEMO_ITEMS}" | sed '/^$/d')
];

const App = () => {
  const [currentDemo, setCurrentDemo] = useState(0);

  if (demoItems.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>No demo found</Text>
      </View>
    );
  }

  const CurrentComponent = demoItems[currentDemo].component;

  return (
    <View style={styles.container}>
      {/* Demo 切换栏 */}
      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {demoItems.map((item, index) => (
            <TouchableOpacity
              key={item.key}
              onPress={() => setCurrentDemo(index)}
              style={[
                styles.tab,
                currentDemo === index && styles.activeTab,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  currentDemo === index && styles.activeTabText,
                ]}
              >
                {item.key}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Demo 内容区 */}
      <View style={styles.content}>
        <CurrentComponent />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  tabBar: {
    height: 50,
    backgroundColor: "#f5f5f5",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  tab: {
    paddingHorizontal: 16,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: "#1652f0",
  },
  tabText: {
    fontSize: 14,
    color: "#666",
  },
  activeTabText: {
    color: "#1652f0",
    fontWeight: "600",
  },
  content: {
    flex: 1,
  },
  emptyText: {
    fontSize: 18,
    color: "#999",
  },
});

export default App;
INDEX_EOF

    ok "  已更新 src/index.tsx → 多 demo 切换器 (${#ENTRY_FILES[@]} 个 demo)"
  fi
fi

echo ""

# ════════════════════════════════════════════════════════════
# 阶段 6: 汇总输出
# ════════════════════════════════════════════════════════════

echo "=========================================="
echo "  移植完成"
echo "=========================================="
echo ""

info "汇总:"
echo "  仓库: ${GIT_URL} (${GIT_BRANCH})"
echo "  克隆到: ${CLONE_DIR}"
echo ""
echo "  demo/用例目录 (${#DETECTED_DEMO_DIRS[@]} 个):"
for dir in "${DETECTED_DEMO_DIRS[@]}"; do
  echo "    ✓ ${dir}/"
done
echo ""
if [[ ${#ENTRY_FILES[@]} -gt 0 ]]; then
  echo "  入口文件 (${#ENTRY_FILES[@]} 个):"
  for entry in "${ENTRY_FILES[@]}"; do
    entry_dir_name="${entry%%|*}"
    entry_file_name="${entry##*|}"
    if [[ ${#ENTRY_FILES[@]} -eq 1 ]]; then
      echo "    ✓ ${entry_dir_name}/${entry_file_name} → src/index.tsx (内容已写入)"
    else
      echo "    ✓ ${entry_dir_name}/${entry_file_name} → src/${entry_dir_name}/${entry_file_name}"
    fi
  done
  echo ""
fi
echo "  支撑文件 (assets/animations/模块等) 已拷贝到: src/"
echo "  模板工程: ${TEMPLATE_DIR}"
echo ""

ok "测试 Demo/用例移植完成!"
echo ""
info "后续步骤:"
echo "  1. 检查 src/index.tsx 中的导入路径是否正确"
echo "  2. 检查 demo 中是否有平台特定代码需要适配 (如 Platform.OS === 'ios')"
echo "  3. cd ${TEMPLATE_DIR}"
echo "  4. npm run codegen"
echo "  5. npm run dev"
echo "  6. 用 DevEco Studio 打开 harmony/ 目录构建 HAP"
echo ""
warn "注意:"
echo "  - demo 中的动画/图片等资源文件已拷贝到 src/ 下, 请确认路径引用正确"
echo "  - 如果 demo 依赖了平台原生模块 (如 CameraPicker), 需要额外集成鸿蒙化版本"
echo "  - 原始 index.tsx 已备份为 index.backup.tsx"
