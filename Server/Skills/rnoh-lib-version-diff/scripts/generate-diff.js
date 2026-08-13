#!/usr/bin/env node
/**
 * generate-diff.js
 *
 * 从同一 Git 仓库的两个分支/tag 中生成对比 diff 文件 (.patch)。
 *
 * 默认聚焦三方库核心代码变更, 自动排除 lock 文件、example/、CI 配置、文档等
 * 与鸿蒙化升级排查无关的噪音文件。使用 --full 可生成包含所有变更的完整 diff。
 *
 * ## 两阶段 diff + rename 检测
 *
 * 对于 monorepo 架构重组场景 (如包重命名、目录迁移), 脚本使用 git 的 rename
 * 检测能力 (--find-renames) 来识别文件移动, 确保即使整个目录被重命名, 文件级
 * 的内容变更也不会丢失。
 *
 * 脚本会生成一个额外的结构变更摘要文件 (structure_<b1>_<b2>.md), 其中按状态
 * (Renamed/Modified/Added/Deleted/Copied) 分类展示所有变更文件, 方便人工识别
 * 哪些是真实内容变更、哪些是位置移动。
 *
 * 默认在当前目录下创建 diff/ 文件夹，其中包含:
 *   - 两个分支的源代码目录 (<branch1>/ 和 <branch2>/)
 *   - 对比 diff 文件 (diff_<branch1>_<branch2>.patch)
 *   - 变更摘要文件 (summary_<branch1>_<branch2>.md)
 *   - 结构变更摘要 (structure_<branch1>_<branch2>.md)
 *
 * 输出结构:
 *   diff/
 *   ├── <branch1>/                          (分支1 源代码, 无 .git)
 *   ├── <branch2>/                          (分支2 源代码, 无 .git)
 *   ├── diff_<b1>_<b2>.patch                (对比 diff 文件)
 *   ├── summary_<b1>_<b2>.md                (变更摘要, 按文件统计增删行数)
 *   └── structure_<b1>_<b2>.md              (结构变更摘要, 按 R/M/A/D 状态分类)
 *
 * 默认排除的路径模式 (聚焦核心代码):
 *   yarn.lock, package-lock.json, *.lock
 *   .yarn/, .github/, example/, docs/
 *   CHANGELOG.md, CONTRIBUTING.md, MIGRATION*.md, README.md
 *   .gitignore, .yarnrc.yml, .npmrc, .idea/
 *
 * 用法:
 *   node generate-diff.js --repo <url> --branch1 <name> --branch2 <name> [选项]
 *
 * 示例:
 *   # 对比 lottie-react-native 的 v7.2.2 和 v7.4.0 (默认排除噪音)
 *   node generate-diff.js \
 *     --repo https://github.com/lottie-react-native/lottie-react-native \
 *     --branch1 v7.2.2 \
 *     --branch2 v7.4.0
 *
 *   # 生成完整 diff (不排除任何文件)
 *   node generate-diff.js \
 *     --repo https://github.com/lottie-react-native/lottie-react-native \
 *     --branch1 v7.2.2 \
 *     --branch2 v7.4.0 \
 *     --full
 *
 *   # 在默认排除基础上追加额外排除
 *   node generate-diff.js \
 *     --repo https://github.com/lottie-react-native/lottie-react-native \
 *     --branch1 v7.2.2 \
 *     --branch2 v7.4.0 \
 *     --exclude packages/core/windows/
 *
 *   # 调整 rename 检测相似度阈值 (默认 50%, 降低可检测更多跨目录移动)
 *   node generate-diff.js \
 *     --repo https://github.com/react-native-async-storage/async-storage \
 *     --branch1 v2.2.0 \
 *     --branch2 v3.1.1 \
 *     --find-renames 30
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 引入 scan-exports.js 模块 (接口扫描 + 对比)
const scanExports = require('./scan-exports');

// ── 颜色输出 ─────────────────────────────────────────────
const COLORS = {
  RED: '\x1b[0;31m',
  GREEN: '\x1b[0;32m',
  YELLOW: '\x1b[1;33m',
  BLUE: '\x1b[0;34m',
  CYAN: '\x1b[0;36m',
  NC: '\x1b[0m',
};

function info(msg)  { console.log(`${COLORS.BLUE}[INFO]${COLORS.NC} ${msg}`); }
function ok(msg)    { console.log(`${COLORS.GREEN}[OK]${COLORS.NC} ${msg}`); }
function warn(msg)  { console.log(`${COLORS.YELLOW}[WARN]${COLORS.NC} ${msg}`); }
function error(msg) {
  console.error(`${COLORS.RED}[ERROR]${COLORS.NC} ${msg}`);
  process.exit(1);
}
function debug(msg) {
  if (VERBOSE) {
    console.log(`${COLORS.CYAN}[DEBUG]${COLORS.NC} ${msg}`);
  }
}

// ── 默认值 ───────────────────────────────────────────────
let REPO_URL = '';
let BRANCH1 = '';
let BRANCH2 = '';
let OUTPUT_DIR = '';
let VERBOSE = false;
let KEEP_REPO = false;
let FULL_DIFF = false;
let FIND_RENAMES = 50;
let FILES_LIST = '';
const EXCLUDES = [];

// ── 默认排除规则 (聚焦三方库核心代码, 过滤与鸿蒙化升级排查无关的噪音) ──
// 这些路径在 --full 模式下不会被排除
// 含 ** 的模式使用 git glob pathspec 匹配任意层级目录
const DEFAULT_EXCLUDES = [
  // lock 文件
  'yarn.lock',
  'package-lock.json',
  '*.lock',
  // 工具链 / CI
  '.yarn/',
  '.github/',
  '.yarnrc.yml',
  '.npmrc',
  '.idea/',
  '.gitignore',
  // 示例工程 (example/ 单数 + examples/ 复数, 兼容 monorepo 命名)
  'example/',
  'examples/',
  // 其他平台原生代码 (鸿蒙适配只关心 JS/TS 源码 + TurboModule Spec)
  // **/pattern/** 使用 glob 匹配任意层级的目录内文件
  '**/android/**',
  '**/ios/**',
  '**/apple/**',
  '**/windows/**',
  // 文档
  'docs/',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'MIGRATION*.md',
  'README.md',
];

// ── 参数解析 ─────────────────────────────────────────────
function usage() {
  console.log(`
RNOH 三方库分支对比脚本

从同一 Git 仓库的两个分支/tag 生成对比 diff 文件 (.patch)。
默认聚焦核心代码, 自动排除 lock 文件、example/、CI 配置、文档等噪音。
使用 --full 可生成包含所有变更的完整 diff。
使用 --find-renames 启用跨目录文件移动检测 (monorepo 重构场景)。

输出文件各有侧重:
  diff_*.patch       — diff 补丁 (应用排除规则, 聚焦可合并的代码变更)
  summary_*.md       — 变更摘要 (同 diff 的排除范围, 按目录统计增删行数)
  structure_*.md     — 适配分析报告 (以接口差异为锚点:
                       先用 scan-exports.js 判定是否需要原生适配,
                       有接口变更时按变更项展开 + 附其他平台实现参考,
                       无接口变更时只列 JS 合并清单 + 文件计数)
  api-diff_*.md      — 接口差异适配检查清单 (每个变更项含 checkbox, 直接指导适配)

输出结构:
  diff/
  ├── <branch1>/                          (分支1 源代码, 无 .git)
  ├── <branch2>/                          (分支2 源代码, 无 .git)
  ├── diff_<b1>_<b2>.patch                (对比 diff 文件)
  ├── summary_<b1>_<b2>.md                (变更摘要, 按文件统计增删行数)
  ├── structure_<b1>_<b2>.md              (适配分析报告, 接口驱动)
  └── api-diff_<b1>_<b2>.md               (接口差异适配检查清单)

用法:
  node generate-diff.js [选项]

必选参数:
  --repo <url>           Git 仓库地址
  --branch1 <name>       第一个分支/tag 名称
  --branch2 <name>       第二个分支/tag 名称

可选参数:
  --output-dir <path>    输出目录 (默认: 当前目录下的 diff/ 文件夹)
  --exclude <pattern>    排除文件路径模式, 在默认排除基础上追加 (可多次指定)
  --full                 生成完整 diff, 不使用默认排除规则 (仍可配合 --exclude)
  --find-renames <n>     rename 检测相似度阈值百分比 (默认: 50, 设为 0 关闭)
                          降低阈值可检测更多跨目录移动 (如 monorepo 重构)
                          git 默认为 50%, 设为 30% 可识别大幅重写的文件移动
  --keep-repo            保留克隆的仓库 (默认生成后自动删除)
  --files <path>         只对指定文件列表生成精简 diff patch (每行一个文件路径)
                          用于两阶段流程: 第一轮生成全量清单 → AI 筛选 → 第二轮精简 patch
                          与 --full 互斥; 指定后跳过排除规则, 只生成指定文件的 diff
  --verbose              显示详细调试信息
  --help, -h             显示帮助

默认排除的路径 (除非使用 --full):
  yarn.lock, package-lock.json, *.lock
  .yarn/, .github/, example/, examples/, docs/
  **/android/**, **/ios/**, **/apple/**, **/windows/**  (其他平台原生代码, glob 匹配任意层级)
  CHANGELOG.md, CONTRIBUTING.md, MIGRATION*.md, README.md
  .gitignore, .yarnrc.yml, .npmrc, .idea/

示例:
  # 对比 lottie-react-native 的 v7.2.2 和 v7.4.0 (默认排除噪音)
  node generate-diff.js \\
    --repo https://github.com/lottie-react-native/lottie-react-native \\
    --branch1 v7.2.2 \\
    --branch2 v7.4.0

  # monorepo 重构场景: 降低 rename 阈值以检测跨目录文件移动
  node generate-diff.js \\
    --repo https://github.com/react-native-async-storage/async-storage \\
    --branch1 v2.2.0 \\
    --branch2 v3.1.1 \\
    --find-renames 30

  # 生成完整 diff (不排除任何文件)
  node generate-diff.js \\
    --repo https://github.com/lottie-react-native/lottie-react-native \\
    --branch1 v7.2.2 \\
    --branch2 v7.4.0 \\
    --full

  # 在默认排除基础上追加额外排除
  node generate-diff.js \\
    --repo https://github.com/lottie-react-native/lottie-react-native \\
    --branch1 v7.2.2 \\
    --branch2 v7.4.0 \\
    --exclude packages/core/windows/

  # 两阶段流程: 第二轮只对 AI 筛选的文件生成精简 patch
  node generate-diff.js \\
    --repo https://github.com/react-native-async-storage/async-storage \\
    --branch1 v2.2.0 \\
    --branch2 v3.1.1 \\
    --files relevant-files.txt \\
    --output-dir ./diff-focused
`);
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--repo':          REPO_URL = args[i + 1]; i += 2; break;
      case '--branch1':       BRANCH1 = args[i + 1]; i += 2; break;
      case '--branch2':       BRANCH2 = args[i + 1]; i += 2; break;
      case '--output-dir':    OUTPUT_DIR = args[i + 1]; i += 2; break;
      case '--exclude':       EXCLUDES.push(args[i + 1]); i += 2; break;
      case '--full':          FULL_DIFF = true; i += 1; break;
      case '--find-renames':  {
        const val = parseInt(args[i + 1], 10);
        if (isNaN(val) || val < 0 || val > 100) {
          error(`--find-renames 值必须为 0-100 的整数, 收到: ${args[i + 1]}`);
        }
        FIND_RENAMES = val;
        i += 2;
        break;
      }
      case '--keep-repo':     KEEP_REPO = true; i += 1; break;
      case '--files':         FILES_LIST = args[i + 1]; i += 2; break;
      case '--verbose':       VERBOSE = true; i += 1; break;
      case '--help':
      case '-h':              usage(); break;
      default:                error(`未知参数: ${args[i]} (使用 --help 查看用法)`);
    }
  }
}

// ── 工具函数 ─────────────────────────────────────────────

/**
 * 执行 git 命令，返回 stdout (同步)。
 * @param {string[]} gitArgs git 命令参数
 * @param {object} [options] execFileSync 选项
 * @returns {string} stdout 输出
 */
function git(gitArgs, options = {}) {
  return execFileSync('git', gitArgs, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

/**
 * 执行 git 命令，直接继承终端 stdio (用于 clone 等需要显示进度的场景)。
 * @param {string[]} gitArgs git 命令参数
 * @param {object} [options] execSync 选项
 */
function gitInherit(gitArgs, options = {}) {
  execSync('git ' + gitArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' '), {
    stdio: 'inherit',
    ...options,
  });
}

/**
 * 清理分支名用于文件名 (去除特殊字符)。
 * @param {string} name 分支/tag 名称
 * @returns {string} 清理后的名称
 */
function cleanBranchName(name) {
  return name
    .replace(/^origin\//, '')  // 去除 origin/ 前缀
    .replace(/\//g, '-');       // 替换 / 为 -
}

/**
 * 格式化文件大小。
 * @param {number} bytes 字节数
 * @returns {string} 人类可读的大小
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 使用 git archive 将指定 ref 的源代码导出到目标目录 (不含 .git)。
 * @param {string} repoDir 仓库目录
 * @param {string} ref git ref (分支/tag)
 * @param {string} destDir 目标目录
 */
function exportBranchSource(repoDir, ref, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // git archive 输出 tar 到 stdout, 管道给 tar 解压到目标目录
  execSync(`git archive "${ref}" | tar -x -C "${destDir}"`, {
    cwd: repoDir,
    stdio: 'pipe',
    timeout: 60000,
  });
}

/**
 * 构建最终的排除列表。
 * --full 模式下只用用户 --exclude 指定的; 否则合并默认排除 + 用户追加。
 * @returns {string[]} 排除路径模式数组
 */
function buildExcludeList() {
  if (FULL_DIFF) {
    return [...EXCLUDES];
  }
  return [...DEFAULT_EXCLUDES, ...EXCLUDES];
}

/**
 * 构建 git diff 的 pathspec 参数数组。
 * 含 ** 的模式使用 :(glob,exclude) 语法匹配任意层级目录;
 * 普通模式使用 :! 前缀匹配根目录路径。
 * @param {string[]} excludePatterns 排除模式列表
 * @returns {string[]} git pathspec 参数 (含前导 '--')
 */
function buildPathspecArgs(excludePatterns) {
  if (excludePatterns.length === 0) return [];
  const args = ['--'];
  for (const pattern of excludePatterns) {
    if (pattern.includes('**')) {
      args.push(`:(glob,exclude)${pattern}`);
    } else {
      args.push(`:!${pattern}`);
    }
  }
  return args;
}

/**
 * 构建 git diff 的 --find-renames 参数。
 * @returns {string[]} git 参数数组 (如 ['--find-renames=30%'] 或 [])
 */
function buildFindRenamesArgs() {
  if (FIND_RENAMES <= 0) return [];
  return [`--find-renames=${FIND_RENAMES}%`];
}

// ── 结构变更分析: 鸿蒙相关性分类 ─────────────────────────

/**
 * 结构分析使用的排除集。
 *
 * 与 DEFAULT_EXCLUDES 一致, 排除所有非 JS/TS 文件 (原生平台代码、文档、CI 等)。
 * 只保留 JS/TS 源码、TurboModule Spec、包配置和构建规格。
 */
const MINIMAL_EXCLUDES = [
  // lock 文件
  'yarn.lock',
  'package-lock.json',
  '*.lock',
  // 工具链 / CI
  '.yarn/',
  '.github/',
  '.yarnrc.yml',
  '.npmrc',
  '.idea/',
  '.gitignore',
  // 示例工程
  'example/',
  'examples/',
  // 其他平台原生代码 (只关心 JS/TS 层)
  '**/android/**',
  '**/ios/**',
  '**/apple/**',
  '**/windows/**',
  // Kotlin Multiplatform (shared-storage 等)
  '**/commonMain/**',
  '**/androidMain/**',
  '**/appleMain/**',
  // 文档
  'docs/',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'MIGRATION*.md',
  'README.md',
  // 二进制文件
  '**/*.jar',
  '**/*.aar',
  '**/*.dylib',
  '**/*.so',
  '**/gradle/wrapper/**',
];

/**
 * 鸿蒙相关性分类。
 *
 * 将变更文件按对鸿蒙 RN 三方库适配的相关性分为以下类别:
 *
 * @typedef {string} RelevanceCategory
 * @property {'js-ts-source'}      JS/TS 源码 — 需合并到 harmony/src/ 的文件
 * @property {'turbo-module-spec'} TurboModule Spec — 定义原生接口, 需 codegen
 * @property {'package-config'}    包配置 — package.json, tsconfig
 * @property {'build-spec'}        构建规格 — podspec, CMakeLists
 * @property {'not-relevant'}      不相关 — 文档/图片/CI/lock/原生平台代码等
 */

/**
 * 对变更文件进行鸿蒙相关性分类。
 *
 * 判断依据:
 *   1. 文件扩展名 (源码类型)
 *   2. 文件路径 (是否在 src/, android/, ios/ 等关键目录)
 *   3. 文件名模式 (Native*.ts → TurboModule Spec)
 *
 * @param {ChangeEntry} entry 变更条目
 * @returns {RelevanceCategory} 相关性类别
 */
function classifyFileRelevance(entry) {
  // 优先用 newPath 判断 (新增/修改的文件), D 类型用 oldPath
  const checkPath = entry.status === 'D' ? entry.oldPath : entry.newPath;
  const lower = checkPath.toLowerCase();
  const ext = checkPath.substring(checkPath.lastIndexOf('.') + 1).toLowerCase();
  const basename = checkPath.substring(checkPath.lastIndexOf('/') + 1);

  // ── TurboModule Spec: Native*.ts — 最高优先级 ──
  // 匹配 NativeXxx.ts / NativeXxx.tsx, 通常在 src/ 下
  if (/^Native[A-Z]/.test(basename) && ['ts', 'tsx'].includes(ext)) {
    return 'turbo-module-spec';
  }

  // ── JS/TS 源码: src/ 下的 .ts/.tsx/.js/.jsx ──
  // 也匹配根目录或 packages/*/src/ 下的源码
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    if (lower.includes('/src/') || lower.startsWith('src/')) {
      return 'js-ts-source';
    }
    // 根目录的 index.ts/index.js 也算源码入口
    if (!checkPath.includes('/') && ['index.ts', 'index.js', 'index.tsx'].includes(basename.toLowerCase())) {
      return 'js-ts-source';
    }
    // jest/ 下的 mock 也算 (与鸿蒙测试相关)
    if (lower.includes('/jest/') || lower.startsWith('jest/')) {
      return 'js-ts-source';
    }
  }

  // ── 包配置: package.json, tsconfig*.json ──
  if (basename === 'package.json' || basename.toLowerCase().startsWith('tsconfig')) {
    return 'package-config';
  }

  // ── 构建规格: podspec, CMakeLists.txt ──
  if (ext === 'podspec' || basename.toLowerCase() === 'cmakelists.txt') {
    return 'build-spec';
  }

  // ── 其他: 不相关 (包括原生平台代码、文档、图片、CI 等) ──
  return 'not-relevant';
}

/**
 * 相关性类别的元信息 (展示顺序、标题、说明)。
 */
const RELEVANCE_META = {
  'js-ts-source': {
    title: 'JS/TS 源码',
    icon: '📄',
    desc: '需合并到鸿蒙化仓库 src/ 的源代码文件',
    showDetail: true,
  },
  'turbo-module-spec': {
    title: 'TurboModule Spec',
    icon: '🔌',
    desc: '定义原生模块接口, 需更新 codegen 并同步 ETS/C++ 层',
    showDetail: true,
  },
  'package-config': {
    title: '包配置',
    icon: '📦',
    desc: 'package.json / tsconfig 变更, 影响 codegen 和依赖',
    showDetail: true,
  },
  'build-spec': {
    title: '构建规格',
    icon: '🔧',
    desc: 'podspec / CMakeLists 等构建配置',
    showDetail: true,
  },
  'not-relevant': {
    title: '不相关变更 (已过滤)',
    icon: '🔇',
    desc: '文档/图片/CI/lock/原生平台代码等, 与鸿蒙适配无关',
    showDetail: false,
  },
};

/**
 * 相关性类别的展示顺序。
 */
const RELEVANCE_ORDER = [
  'turbo-module-spec',
  'js-ts-source',
  'package-config',
  'build-spec',
  'not-relevant',
];

// ── 结构变更分析: 状态解析 ─────────────────────────────────

/**
 * 变更文件的状态类型。
 * @typedef {'R'|'M'|'A'|'D'|'C'|'T'} FileStatus
 * R = Renamed (重命名/移动, 可能含内容修改)
 * M = Modified (原地修改)
 * A = Added (纯新增)
 * D = Deleted (纯删除)
 * C = Copied (复制)
 * T = Type changed (文件类型变更, 如 文件→符号链接)
 */

/**
 * 单个变更文件的描述。
 * @typedef {Object} ChangeEntry
 * @property {FileStatus} status - 变更状态
 * @property {string} oldPath - 旧路径 (M/A 为空或同 newPath)
 * @property {string} newPath - 新路径 (D 为空或同 oldPath)
 * @property {number} similarity - 相似度百分比 (仅 R/C 有意义, 0-100)
 * @property {number} added - 新增行数 (来自 numstat)
 * @property {number} deleted - 删除行数 (来自 numstat)
 */

/**
 * 解析 git diff --name-status 输出的单行。
 *
 * --name-status 行格式:
 *   M\tpath/to/file                         (Modified)
 *   A\tpath/to/file                         (Added)
 *   D\tpath/to/file                         (Deleted)
 *   T\tpath/to/file                         (Type changed)
 *   R90\told/path\tnew/path                 (Renamed, 90% similar)
 *   C80\told/path\tnew/path                 (Copied, 80% similar)
 *
 * 注意: R/C 的相似度百分比可能与状态码写在一起 (R90) 或分开 (R\t90\told\tnew)
 * git 默认格式为 R90\told\tnew
 *
 * @param {string} line 单行输出
 * @returns {ChangeEntry|null} 解析结果, 无法解析返回 null
 */
function parseNameStatusLine(line) {
  if (!line.trim()) return null;

  const parts = line.split('\t');
  const statusField = parts[0];

  // 提取状态字母和相似度
  const statusLetter = statusField[0];
  let similarity = 100;

  // R90 / C75 等格式: 状态字母后面跟着数字
  if (statusLetter === 'R' || statusLetter === 'C') {
    const numMatch = statusField.match(/^([RC])(\d+)$/);
    if (numMatch) {
      similarity = parseInt(numMatch[2], 10);
    }
  }

  switch (statusLetter) {
    case 'M':
    case 'A':
    case 'D':
    case 'T':
      return {
        status: statusLetter,
        oldPath: parts[1] || '',
        newPath: parts[1] || '',
        similarity: 100,
        added: 0,
        deleted: 0,
      };
    case 'R':
    case 'C':
      return {
        status: statusLetter,
        oldPath: parts[1] || '',
        newPath: parts[2] || '',
        similarity,
        added: 0,
        deleted: 0,
      };
    default:
      // 未知状态, 跳过
      debug(`  未知状态码: ${statusField} (line: ${line})`);
      return null;
  }
}

/**
 * 使用 git diff --numstat 获取每个文件的增删行数。
 *
 * numstat 行格式:
 *   <added>\t<deleted>\t<filepath>
 *   对于 rename, filepath 格式可能是 "old => new" 或仅 "new"
 *
 * @param {string} repoDir 仓库目录
 * @param {string} ref1 分支1 ref
 * @param {string} ref2 分支2 ref
 * @param {string[]} excludePatterns 排除模式列表
 * @returns {Map<string, {added: number, deleted: number}>} filepath → numstat
 */
function fetchNumstat(repoDir, ref1, ref2, excludePatterns) {
  const numstatArgs = ['diff', '--numstat', ...buildFindRenamesArgs(), ref1, ref2];
  numstatArgs.push(...buildPathspecArgs(excludePatterns));

  const result = new Map();

  let output = '';
  try {
    output = git(numstatArgs, { cwd: repoDir, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
  } catch { /* ignore */ }

  if (!output) return result;

  for (const line of output.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
    const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
    // filepath 可能含 "old => new" (rename) 或纯路径
    const filepath = parts.slice(2).join('\t');
    result.set(filepath, { added, deleted });
  }

  return result;
}

/**
 * 从 numstat 的 filepath 字段中提取 rename 的旧路径和新路径。
 *
 * numstat 对于 rename 的输出格式:
 *   0\t0\told/path => new/path
 *   10\t5\t{old => new}/path/to/file
 *   10\t5\tpath/{old => new}/file.ts
 *
 * @param {string} rawPath numstat 的 filepath 字段
 * @returns {{oldPath: string, newPath: string}} 解析后的路径对
 */
function parseRenameFromNumstatPath(rawPath) {
  // 匹配 "old => new" 或 "{old => new}" 模式
  const arrowMatch = rawPath.match(/^(.*?)\{?(.+?)\s*=>\s*(.+?)\}?(.*)$/);
  if (arrowMatch) {
    const prefix = arrowMatch[1] || '';
    const oldPart = arrowMatch[2];
    const newPart = arrowMatch[3];
    const suffix = arrowMatch[4] || '';
    const oldPath = (prefix + oldPart + suffix).replace(/\/+/g, '/');
    const newPath = (prefix + newPart + suffix).replace(/\/+/g, '/');
    return { oldPath, newPath };
  }

  // 匹配 "a => b" (无花括号)
  const simpleMatch = rawPath.match(/^(.+?)\s*=>\s*(.+)$/);
  if (simpleMatch) {
    return { oldPath: simpleMatch[1].trim(), newPath: simpleMatch[2].trim() };
  }

  return { oldPath: rawPath, newPath: rawPath };
}

/**
 * 分析两个分支之间的结构变更。
 *
 * 使用 git diff --name-status -M -C 获取每个文件的变更状态,
 * 结合 numstat 获取增删行数, 生成结构化的变更列表。
 * 每个条目会附加 relevance 字段 (鸿蒙相关性分类)。
 *
 * 注意: 此函数使用 MINIMAL_EXCLUDES (而非完整的 DEFAULT_EXCLUDES),
 * 以便捕获 android/ios 等原生文件的变更作为鸿蒙适配参考。
 *
 * @param {string} repoDir 仓库目录
 * @param {string} ref1 分支1 ref
 * @param {string} ref2 分支2 ref
 * @param {string[]} extraExcludes 额外排除模式 (用户 --exclude 指定的)
 * @returns {{entries: ChangeEntry[], stats: Object, relevantCount: number, irrelevantCount: number}} 变更条目列表和统计信息
 */
function analyzeStructuralChanges(repoDir, ref1, ref2, extraExcludes = []) {
  // 结构分析使用最小排除集 + 用户额外排除, 保留原生文件可见
  const structureExcludes = [...MINIMAL_EXCLUDES, ...extraExcludes];

  // 1. 获取 name-status (含 rename 检测)
  const nameStatusArgs = ['diff', '--name-status', ...buildFindRenamesArgs(), ref1, ref2];
  nameStatusArgs.push(...buildPathspecArgs(structureExcludes));

  let nameStatusOutput = '';
  try {
    nameStatusOutput = git(nameStatusArgs, {
      cwd: repoDir,
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch { /* ignore */ }

  // 2. 获取 numstat (增删行数)
  const numstatMap = fetchNumstat(repoDir, ref1, ref2, structureExcludes);

  // 3. 解析 name-status 行, 合并 numstat 数据
  const entries = [];
  if (nameStatusOutput) {
    for (const line of nameStatusOutput.split('\n').filter(Boolean)) {
      const entry = parseNameStatusLine(line);
      if (!entry) continue;

      // 尝试从 numstat 匹配增删行数
      // numstat 的 filepath 对于 rename 是 "old => new" 格式
      if (entry.status === 'R' || entry.status === 'C') {
        const numstatKey = `${entry.oldPath} => ${entry.newPath}`;
        const numstatKey2 = `{${entry.oldPath} => ${entry.newPath}}`;
        const ns = numstatMap.get(numstatKey) || numstatMap.get(numstatKey2)
          || numstatMap.get(entry.newPath) || numstatMap.get(entry.oldPath);
        if (ns) {
          entry.added = ns.added;
          entry.deleted = ns.deleted;
        }
      } else {
        const ns = numstatMap.get(entry.newPath);
        if (ns) {
          entry.added = ns.added;
          entry.deleted = ns.deleted;
        }
      }

      entries.push(entry);
    }
  }

  // 4. 对每个条目进行鸿蒙相关性分类
  for (const entry of entries) {
    entry.relevance = classifyFileRelevance(entry);
  }

  // 5. 统计
  const relevantEntries = entries.filter(e => e.relevance !== 'not-relevant');
  const irrelevantEntries = entries.filter(e => e.relevance === 'not-relevant');

  // 按相关性类别统计
  const relevanceCounts = {};
  for (const cat of RELEVANCE_ORDER) {
    relevanceCounts[cat] = entries.filter(e => e.relevance === cat).length;
  }

  const stats = {
    total: entries.length,
    relevant: relevantEntries.length,
    irrelevant: irrelevantEntries.length,
    renamed: entries.filter(e => e.status === 'R').length,
    modified: entries.filter(e => e.status === 'M').length,
    added: entries.filter(e => e.status === 'A').length,
    deleted: entries.filter(e => e.status === 'D').length,
    copied: entries.filter(e => e.status === 'C').length,
    typeChanged: entries.filter(e => e.status === 'T').length,
    totalAdded: entries.reduce((sum, e) => sum + e.added, 0),
    totalDeleted: entries.reduce((sum, e) => sum + e.deleted, 0),
    relevanceCounts,
  };

  return { entries, stats };
}

/**
 * 扫描目录的导出接口 (支持 monorepo)。
 *
 * 如果根目录有 package.json 且包含 codegenConfig 或 source 字段, 直接扫描。
 * 否则递归查找 packages 子目录中有 codegenConfig 的包。
 *
 * @param {string} dir 源码目录
 * @returns {Object|null} 扫描结果, 未找到包返回 null
 */
function scanDirectoryForExports(dir) {
  // 先尝试根目录
  try {
    const result = scanExports.scanDirectory(dir);
    if (result.entryFile || (result.turboModuleSpecs && result.turboModuleSpecs.length > 0)) {
      return result;
    }
  } catch { /* continue */ }

  // monorepo: 查找 packages/*/ 子目录
  const packagesDir = path.join(dir, 'packages');
  if (fs.existsSync(packagesDir)) {
    let entries;
    try {
      entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(packagesDir, entry.name);
      const pkgPath = path.join(subDir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;

      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        // 优先选择有 codegenConfig 的包 (那是 TurboModule 库)
        // 其次选择有 source 字段的包
        if (pkg.codegenConfig || pkg.source || (pkg.name && !pkg.name.includes('eslint-config') && !pkg.name.includes('website'))) {
          const result = scanExports.scanDirectory(subDir);
          if (result.entryFile || (result.turboModuleSpecs && result.turboModuleSpecs.length > 0)) {
            debug(`接口扫描: 使用 monorepo 子包 packages/${entry.name}`);
            return result;
          }
        }
      } catch { /* continue */ }
    }
  }

  // 回退: 再试根目录 (即使没有 entryFile, 也可能有 TurboModule Spec)
  try {
    return scanExports.scanDirectory(dir);
  } catch {
    return null;
  }
}

/**
 * 生成接口驱动的结构变更摘要。
 *
 * 核心逻辑:
 *   1. 调用 scan-exports.js 对比两个版本的 JS 层接口 (导出 + TurboModule Spec)
 *   2. 如果接口未变更 → 报告"仅 JS 合并 + codegen, 无需原生适配", 文件变更只计数
 *   3. 如果接口有变更 → 以接口变更项为锚点组织内容:
 *      - 每个新增/变更的接口方法下, 附上其他平台 (Android/iOS) 的实现文件作为参考
 *      - 纯 bug 修复 / 文档 / CI 等 → 只计数, 不展开
 *
 * @param {string} repoDir 仓库目录
 * @param {string} ref1 分支1 ref
 * @param {string} ref2 分支2 ref
 * @param {string[]} extraExcludes 用户额外排除模式
 * @param {object} meta 元信息
 * @param {string} branch1Dir 分支1 导出目录 (用于 scan-exports)
 * @param {string} branch2Dir 分支2 导出目录 (用于 scan-exports)
 * @returns {{content: string, stats: Object, apiDiff: Object}} 结构摘要内容、统计、接口差异
 */
function generateStructureSummary(repoDir, ref1, ref2, extraExcludes, meta, branch1Dir, branch2Dir) {
  // ── Step 1: 扫描接口差异 ──
  // monorepo: 需要找到包含 codegenConfig 的子包目录
  let scan1 = null;
  let scan2 = null;
  let apiDiff = null;
  try {
    scan1 = scanDirectoryForExports(branch1Dir);
    scan2 = scanDirectoryForExports(branch2Dir);
    if (scan1 && scan2) {
      apiDiff = scanExports.compareScans(scan1, scan2);
    } else {
      warn('接口扫描: 未找到包入口 (monorepo 子包可能未包含 codegenConfig)');
    }
  } catch (err) {
    warn(`接口扫描失败: ${err.message}`);
  }

  // ── Step 2: 分析结构变更 (文件级) ──
  const { entries, stats } = analyzeStructuralChanges(repoDir, ref1, ref2, extraExcludes);

  const lines = [];

  // ── 头部 ──
  lines.push(`# 适配分析报告: ${meta.branch1} → ${meta.branch2}`);
  lines.push('');
  lines.push(`| 项目 | 值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 仓库 | ${meta.repoUrl} |`);
  lines.push(`| 分支 1 | ${meta.branch1} (${meta.commit1Hash}) |`);
  lines.push(`| 分支 2 | ${meta.branch2} (${meta.commit2Hash}) |`);
  lines.push(`| 文件变更总数 | ${stats.total} |`);
  lines.push(`| rename 检测阈值 | ${FIND_RENAMES <= 0 ? '关闭' : FIND_RENAMES + '%'} |`);
  lines.push('');

  // ── 判定结果 ──
  lines.push('## 判定结果');
  lines.push('');
  if (apiDiff) {
    if (apiDiff.summary.needsNativeAdaptation) {
      lines.push('> ⚠️ **需要原生适配** — JS 层接口或 TurboModule Spec 发生变更。');
      lines.push('> 下方按接口变更项展开, 每项附其他平台实现作为参考。');
    } else {
      lines.push('> ✅ **无需原生适配** — JS 层接口未变更, 仅 bug 修复/内部重构。');
      lines.push('> 鸿蒙侧只需合并 JS 代码 + 重新 codegen。');
    }
    lines.push('');
    lines.push('| 检查项 | 结果 |');
    lines.push('|--------|------|');
    lines.push(`| JS 导出变更 | ${apiDiff.summary.hasExportChanges ? '⚠️ 有' : '✅ 无'} |`);
    lines.push(`| 接口定义变更 | ${apiDiff.summary.hasInterfaceChanges ? '⚠️ 有' : '✅ 无'} |`);
    lines.push(`| TurboModule Spec 变更 | ${apiDiff.summary.hasTurboModuleChanges ? '⚠️ 有' : '✅ 无'} |`);
    lines.push(`| **需要原生适配** | ${apiDiff.summary.needsNativeAdaptation ? '⚠️ **是**' : '✅ **否**'} |`);
  } else {
    lines.push('> ⚠️ 接口扫描失败, 无法判定是否需要原生适配, 请手动检查。');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── 文件变更计数摘要 ──
  lines.push('## 文件变更统计');
  lines.push('');
  lines.push('| 类别 | 数量 | 说明 |');
  lines.push('|------|------|------|');
  for (const cat of RELEVANCE_ORDER) {
    const count = stats.relevanceCounts[cat] || 0;
    if (count === 0 && cat === 'not-relevant') continue;
    const m = RELEVANCE_META[cat];
    lines.push(`| ${m.icon} ${m.title} | ${count} | ${m.desc} |`);
  }
  lines.push('');

  // ── 辅助函数 ──
  const getBase = (p) => {
    const sep = p.lastIndexOf('/');
    return sep >= 0 ? p.substring(sep + 1) : p;
  };
  const statusIcon = (s) => ({ R: '🔄', M: '✏️', A: '➕', D: '➖', C: '📋', T: '🔀' }[s] || '❓');

  // ── 核心内容: 接口变更驱动的适配分析 ──
  if (apiDiff && apiDiff.summary.needsNativeAdaptation) {
    lines.push('## 适配分析 (按接口变更项)');
    lines.push('');
    lines.push('> 以下每个检查项对应一个接口变更, 需在鸿蒙侧对等实现。');
    lines.push('> 接口不变的文件变更 (bug 修复/内部重构) 不在此展开, 见下方计数。');
    lines.push('');

    let itemNum = 0;

    // ── TurboModule Spec 变更 ──
    if (apiDiff.turboModuleDiff.length > 0) {
      lines.push('### TurboModule Spec 变更');
      lines.push('');
      lines.push('> 原生模块接口变更, 需同步 codegen + ETS TurboModule + C++ Package。');
      lines.push('');

      for (const d of apiDiff.turboModuleDiff) {
        if (d.change === 'added') {
          itemNum++;
          lines.push(`#### [ ] #${itemNum} 新增 TurboModule: \`${d.moduleName}\``);
          lines.push('');
          lines.push('**新增方法:**');
          lines.push('');
          lines.push('| 方法 | 签名 |');
          lines.push('|------|------|');
          for (const m of d.methods) {
            lines.push(`| \`${m.name}\` | \`${m.signature}\` |`);
          }
          lines.push('');
        } else if (d.change === 'removed') {
          itemNum++;
          lines.push(`#### [ ] #${itemNum} 移除 TurboModule: \`${d.moduleName}\``);
          lines.push('');
          lines.push('**移除方法:**');
          lines.push('');
          lines.push('| 方法 | 签名 |');
          lines.push('|------|------|');
          for (const m of d.methods) {
            lines.push(`| \`${m.name}\` | \`${m.signature}\` |`);
          }
          lines.push('');
        } else if (d.change === 'modified') {
          if (d.note) {
            itemNum++;
            lines.push(`#### [ ] #${itemNum} TurboModule 结构变更: \`${d.moduleName}\``);
            lines.push(`> ⚠️ ${d.note}`);
            if (d.specFiles1) lines.push(`> 旧 Spec: ${d.specFiles1.join(', ')}`);
            if (d.specFiles2) lines.push(`> 新 Spec: ${d.specFiles2.join(', ')}`);
            lines.push('');
          } else {
            const added = d.methods.filter(m => m.change === 'added');
            const removed = d.methods.filter(m => m.change === 'removed');
            const modified = d.methods.filter(m => m.change === 'modified');

            if (added.length > 0) {
              itemNum++;
              lines.push(`#### [ ] #${itemNum} TurboModule \`${d.moduleName}\` 新增方法`);
              lines.push('');
              lines.push('| 方法 | 签名 |');
              lines.push('|------|------|');
              for (const m of added) {
                lines.push(`| \`${m.name}\` | \`${m.signature}\` |`);
              }
              lines.push('');
            }
            if (removed.length > 0) {
              itemNum++;
              lines.push(`#### [ ] #${itemNum} TurboModule \`${d.moduleName}\` 移除方法`);
              lines.push('');
              lines.push('| 方法 | 签名 |');
              lines.push('|------|------|');
              for (const m of removed) {
                lines.push(`| \`${m.name}\` | \`${m.signature}\` |`);
              }
              lines.push('');
            }
            if (modified.length > 0) {
              itemNum++;
              lines.push(`#### [ ] #${itemNum} TurboModule \`${d.moduleName}\` 修改方法签名`);
              lines.push('');
              lines.push('| 方法 | 旧签名 | 新签名 |');
              lines.push('|------|--------|--------|');
              for (const m of modified) {
                lines.push(`| \`${m.name}\` | \`${m.oldSignature}\` | \`${m.newSignature}\` |`);
              }
              lines.push('');
            }
          }
        }
      }
    }

    // ── 公共接口/类型定义变更 ──
    if (apiDiff.interfaceDefsDiff.length > 0) {
      lines.push('### 公共接口/类型定义变更');
      lines.push('');
      lines.push('> JS 层公共 API 接口变更, 需同步鸿蒙化仓库 src/。');
      lines.push('');

      for (const d of apiDiff.interfaceDefsDiff) {
        if (d.change === 'added') {
          itemNum++;
          lines.push(`#### [ ] #${itemNum} 新增接口: \`${d.name}\``);
          lines.push('');
          lines.push('| 方法 |');
          lines.push('|------|');
          for (const m of d.methods) lines.push(`| \`${m}\` |`);
          lines.push('');
        } else if (d.change === 'removed') {
          itemNum++;
          lines.push(`#### [ ] #${itemNum} 移除接口: \`${d.name}\``);
          lines.push('');
          lines.push('| 方法 |');
          lines.push('|------|');
          for (const m of d.methods) lines.push(`| \`${m}\` |`);
          lines.push('');
        } else if (d.change === 'modified') {
          if (d.added.length > 0) {
            itemNum++;
            lines.push(`#### [ ] #${itemNum} 接口 \`${d.name}\` 新增方法`);
            lines.push('');
            lines.push('| 方法 | 签名 |');
            lines.push('|------|------|');
            for (const m of d.added) lines.push(`| \`${m.name}\` | \`${m.signature}\` |`);
            lines.push('');
          }
          if (d.removed.length > 0) {
            itemNum++;
            lines.push(`#### [ ] #${itemNum} 接口 \`${d.name}\` 移除方法`);
            lines.push('');
            lines.push('| 方法 | 签名 |');
            lines.push('|------|------|');
            for (const m of d.removed) lines.push(`| \`${m.name}\` | \`${m.signature}\` |`);
            lines.push('');
          }
          if (d.modified.length > 0) {
            itemNum++;
            lines.push(`#### [ ] #${itemNum} 接口 \`${d.name}\` 修改方法签名`);
            lines.push('');
            lines.push('| 方法 | 旧签名 | 新签名 |');
            lines.push('|------|--------|--------|');
            for (const m of d.modified) {
              lines.push(`| \`${m.name}\` | \`${m.oldSignature}\` | \`${m.newSignature}\` |`);
            }
            lines.push('');
          }
        }
      }
    }

    // ── JS 导出变更 ──
    const e = apiDiff.exportsDiff;
    if (e.defaultChanged || e.added.length > 0 || e.removed.length > 0 || e.typesAdded.length > 0 || e.typesRemoved.length > 0) {
      lines.push('### JS 导出变更');
      lines.push('');
      if (e.defaultChanged) {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} default export 变更:** \`${e.defaultFrom || '(无)'}\` → \`${e.defaultTo || '(无)'}\``);
      }
      if (e.added.length > 0) {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} 新增导出:** ${e.added.map(n => `\`${n}\``).join(', ')}`);
      }
      if (e.removed.length > 0) {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} 移除导出:** ${e.removed.map(n => `\`${n}\``).join(', ')}`);
      }
      if (e.typesAdded.length > 0) {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} 新增类型导出:** ${e.typesAdded.map(n => `\`${n}\``).join(', ')}`);
      }
      if (e.typesRemoved.length > 0) {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} 移除类型导出:** ${e.typesRemoved.map(n => `\`${n}\``).join(', ')}`);
      }
      lines.push('');
    }

    if (itemNum === 0) {
      lines.push('*接口变更项为空。*');
      lines.push('');
    }
  } else if (apiDiff && !apiDiff.summary.needsNativeAdaptation) {
    // ── 接口未变更: 只需合并 JS ──
    lines.push('## JS 代码合并清单');
    lines.push('');
    lines.push('> 接口未变更, 以下 JS/TS 源码变更只需合并到鸿蒙化仓库 src/。');
    lines.push('> 包配置变更需同步到 package.json。');
    lines.push('');

    // 列出 JS/TS 源码变更
    const jsEntries = entries.filter(e => e.relevance === 'js-ts-source' || e.relevance === 'turbo-module-spec');
    if (jsEntries.length > 0) {
      const groups = {};
      for (const e of jsEntries) {
        const checkPath = e.status === 'D' ? e.oldPath : e.newPath;
        const sep = checkPath.lastIndexOf('/');
        const dir = sep >= 0 ? checkPath.substring(0, sep) : '(根目录)';
        if (!groups[dir]) groups[dir] = [];
        groups[dir].push(e);
      }
      for (const dir of Object.keys(groups).sort()) {
        lines.push(`**${dir}/**`);
        lines.push('');
        lines.push('| 状态 | 文件 | 新增 | 删除 |');
        lines.push('|------|------|------|------|');
        for (const e of groups[dir].sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted))) {
          const name = e.status === 'D' ? getBase(e.oldPath) : getBase(e.newPath);
          lines.push(`| ${statusIcon(e.status)} ${e.status} | ${name} | +${e.added} | -${e.deleted} |`);
        }
        lines.push('');
      }
    } else {
      lines.push('*无 JS/TS 源码变更。*');
      lines.push('');
    }
  }

  // ── 无需展开的变更 (只计数) ──
  lines.push('## 其他变更 (仅计数)');
  lines.push('');
  lines.push('> 以下变更与接口适配无关, 不展开详情。');
  lines.push('');

  // 包配置
  const configEntries = entries.filter(e => e.relevance === 'package-config');
  if (configEntries.length > 0) {
    lines.push(`**包配置 (${configEntries.length}):**`);
    lines.push('');
    lines.push('| 状态 | 文件 | 新增 | 删除 |');
    lines.push('|------|------|------|------|');
    for (const e of configEntries.sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted))) {
      const name = e.status === 'R' ? `${getBase(e.oldPath)} → ${getBase(e.newPath)}` : (e.status === 'D' ? getBase(e.oldPath) : getBase(e.newPath));
      lines.push(`| ${statusIcon(e.status)} ${e.status} | ${name} | +${e.added} | -${e.deleted} |`);
    }
    lines.push('');
  }

  // 构建规格
  const buildEntries = entries.filter(e => e.relevance === 'build-spec');
  if (buildEntries.length > 0) {
    lines.push(`**构建规格 (${buildEntries.length}):**`);
    lines.push('');
    lines.push('| 状态 | 文件 | 新增 | 删除 |');
    lines.push('|------|------|------|------|');
    for (const e of buildEntries.sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted))) {
      const name = e.status === 'D' ? getBase(e.oldPath) : getBase(e.newPath);
      lines.push(`| ${statusIcon(e.status)} ${e.status} | ${name} | +${e.added} | -${e.deleted} |`);
    }
    lines.push('');
  }

  // 不相关变更
  if (stats.irrelevant > 0) {
    lines.push(`**不相关变更 (${stats.irrelevant}):** 文档/图片/CI/lock/原生平台代码等, 已过滤`);
    lines.push('');
  }

  if (entries.length === 0) {
    lines.push('*两个分支之间没有结构差异。*');
  }

  return { content: lines.join('\n'), stats, apiDiff, scan1, scan2 };
}

/**
 * 生成变更摘要 Markdown 文件。
 * 按文件统计新增/删除行数, 并按目录分组展示。
 *
 * @param {string} repoDir 仓库目录
 * @param {string} ref1 分支1 ref
 * @param {string} ref2 分支2 ref
 * @param {string[]} excludePatterns 排除模式列表
 * @param {object} meta 元信息 { repoUrl, branch1, branch2, commit1Hash, commit2Hash }
 * @returns {string} 摘要 Markdown 内容
 */
function generateSummary(repoDir, ref1, ref2, excludePatterns, meta) {
  // 获取 --stat 输出 (含每个文件的增删行数), 启用 rename 检测
  const statArgs = ['diff', '--numstat', ...buildFindRenamesArgs(), ref1, ref2];
  statArgs.push(...buildPathspecArgs(excludePatterns));

  let statOutput = '';
  try {
    statOutput = git(statArgs, { cwd: repoDir, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
  } catch { /* ignore */ }

  // 解析 numstat: 每行格式 "<added>\t<deleted>\t<filepath>"
  // rename 的 filepath 可能是 "old => new" 格式
  const files = [];
  let totalAdded = 0;
  let totalDeleted = 0;

  if (statOutput) {
    for (const line of statOutput.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      let filepath = parts.slice(2).join('\t');

      // 处理 rename 的 "old => new" 格式, 提取新路径用于展示
      const renameInfo = parseRenameFromNumstatPath(filepath);
      if (renameInfo.oldPath !== renameInfo.newPath) {
        filepath = `${renameInfo.oldPath} → ${renameInfo.newPath}`;
      }

      files.push({ filepath, added, deleted });
      totalAdded += added;
      totalDeleted += deleted;
    }
  }

  // 按目录分组
  const groups = {};
  for (const f of files) {
    const sep = f.filepath.lastIndexOf('/');
    const dir = sep >= 0 ? f.filepath.substring(0, sep) : '(根目录)';
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(f);
  }

  // 构建 Markdown
  const lines = [];
  lines.push(`# 变更摘要: ${meta.branch1} → ${meta.branch2}`);
  lines.push('');
  lines.push(`| 项目 | 值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 仓库 | ${meta.repoUrl} |`);
  lines.push(`| 分支 1 | ${meta.branch1} (${meta.commit1Hash}) |`);
  lines.push(`| 分支 2 | ${meta.branch2} (${meta.commit2Hash}) |`);
  lines.push(`| 变更文件数 | ${files.length} |`);
  lines.push(`| 新增行数 | +${totalAdded} |`);
  lines.push(`| 删除行数 | -${totalDeleted} |`);
  lines.push(`| rename 检测阈值 | ${FIND_RENAMES <= 0 ? '关闭' : FIND_RENAMES + '%'} |`);
  if (excludePatterns.length > 0) {
    lines.push(`| 排除模式 | ${excludePatterns.join(', ')} |`);
  } else {
    lines.push(`| 排除模式 | 无 (--full 模式) |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // 按目录输出表格
  const sortedDirs = Object.keys(groups).sort();
  for (const dir of sortedDirs) {
    lines.push(`## ${dir}/`);
    lines.push('');
    lines.push('| 文件 | 新增 | 删除 |');
    lines.push('|------|------|------|');
    // 按新增+删除行数降序
    for (const f of groups[dir].sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted))) {
      const name = f.filepath.substring(f.filepath.lastIndexOf('/') + 1);
      lines.push(`| ${name} | +${f.added} | -${f.deleted} |`);
    }
    lines.push('');
  }

  if (files.length === 0) {
    lines.push('*两个分支之间没有差异 (在当前排除规则下)。*');
  }

  return lines.join('\n');
}

// ── 主流程 ───────────────────────────────────────────────

function main() {
  parseArgs();

  // 参数校验
  if (!REPO_URL) error('必须指定 --repo <url>');
  if (!BRANCH1) error('必须指定 --branch1 <name>');
  if (!BRANCH2) error('必须指定 --branch2 <name>');
  if (BRANCH1 === BRANCH2) error(`两个分支不能相同: ${BRANCH1}`);

  // 检查依赖
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
  } catch {
    error('未找到 git, 请先安装');
  }
  try {
    execFileSync('tar', ['--version'], { stdio: 'pipe' });
  } catch {
    error('未找到 tar, 请先安装');
  }

  // 默认输出目录: 当前目录下的 diff/ 文件夹
  if (!OUTPUT_DIR) {
    OUTPUT_DIR = path.join(process.cwd(), 'diff');
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 生成文件名/目录名
  const fileBranch1 = cleanBranchName(BRANCH1);
  const fileBranch2 = cleanBranchName(BRANCH2);
  const outputFile = path.join(OUTPUT_DIR, `diff_${fileBranch1}_${fileBranch2}.patch`);
  const branch1Dir = path.join(OUTPUT_DIR, fileBranch1);
  const branch2Dir = path.join(OUTPUT_DIR, fileBranch2);

  console.log('');
  console.log('==========================================');
  console.log('  RNOH 三方库分支对比');
  console.log('==========================================');
  console.log('');
  // 构建最终排除列表
  const effectiveExcludes = buildExcludeList();

  info(`仓库地址:   ${REPO_URL}`);
  info(`分支 1:     ${BRANCH1}`);
  info(`分支 2:     ${BRANCH2}`);
  info(`输出目录:   ${OUTPUT_DIR}`);
  info(`输出文件:   ${outputFile}`);
  info(`rename 检测: ${FIND_RENAMES <= 0 ? '关闭' : `相似度阈值 ${FIND_RENAMES}%`}`);
  if (FULL_DIFF) {
    info(`模式:       完整 diff (--full)`);
  } else {
    info(`模式:       聚焦核心代码 (默认排除噪音)`);
  }
  if (effectiveExcludes.length > 0) {
    info(`排除模式:   ${effectiveExcludes.join(' ')}`);
  }
  console.log('');

  // ── 1. 创建临时工作目录并克隆仓库 ──────────────────────
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-diff-'));
  const repoDir = path.join(workDir, 'repo');

  debug(`临时目录: ${workDir}`);

  info('克隆仓库 (完整克隆, 需要获取两个分支)...');

  try {
    gitInherit(['clone', REPO_URL, repoDir], { timeout: 120000 });
  } catch (err) {
    error(`git clone 失败: ${REPO_URL}`);
  }

  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    error(`git clone 失败: ${REPO_URL}`);
  }

  ok('仓库克隆完成');
  console.log('');

  // ── 2. 确认两个分支/tag 都存在 ─────────────────────────
  info('验证分支/tag 存在性...');

  /**
   * 检查 ref 是否存在 (origin/<branch>、<branch>、tags/<branch>)。
   * @param {string} ref 分支/tag 名称
   * @returns {string|null} 可用的 git ref，不存在返回 null
   */
  function resolveRef(ref) {
    // 尝试 origin/<branch>
    try {
      git(['rev-parse', '--verify', `origin/${ref}`], { cwd: repoDir, stdio: 'pipe' });
      return `origin/${ref}`;
    } catch { /* continue */ }

    // 尝试直接 ref (本地分支或 tag)
    try {
      git(['rev-parse', '--verify', ref], { stdio: 'pipe' });
      return ref;
    } catch { /* continue */ }

    // 尝试 fetch tags 后再检查
    try {
      git(['fetch', '--tags'], { cwd: repoDir, stdio: 'pipe' });
      git(['rev-parse', '--verify', ref], { cwd: repoDir, stdio: 'pipe' });
      return ref;
    } catch { /* continue */ }

    return null;
  }

  const ref1 = resolveRef(BRANCH1);
  const ref2 = resolveRef(BRANCH2);

  if (!ref1) error(`分支/tag 不存在: ${BRANCH1}`);
  if (!ref2) error(`分支/tag 不存在: ${BRANCH2}`);

  ok(`  ✓ ${BRANCH1} 存在`);
  ok(`  ✓ ${BRANCH2} 存在`);
  console.log('');

  // ── 3. 导出两个分支的源代码 ────────────────────────────
  info(`导出分支源代码到 ${OUTPUT_DIR}/ ...`);

  // 如果目录已存在则先清理 (避免残留文件干扰)
  for (const dir of [branch1Dir, branch2Dir]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  try {
    exportBranchSource(repoDir, ref1, branch1Dir);
    ok(`  ✓ ${BRANCH1} 源代码已导出到: ${branch1Dir}`);
  } catch (err) {
    error(`导出 ${BRANCH1} 源代码失败: ${err.message}`);
  }

  try {
    exportBranchSource(repoDir, ref2, branch2Dir);
    ok(`  ✓ ${BRANCH2} 源代码已导出到: ${branch2Dir}`);
  } catch (err) {
    error(`导出 ${BRANCH2} 源代码失败: ${err.message}`);
  }

  console.log('');

  // ── 4. 生成 diff ──────────────────────────────────────
  info('生成 diff...');

  // 获取 commit 简要信息
  let commit1Hash = 'unknown';
  let commit2Hash = 'unknown';
  try {
    commit1Hash = git(['rev-parse', '--short', ref1], { cwd: repoDir, stdio: 'pipe' });
  } catch { /* ignore */ }
  try {
    commit2Hash = git(['rev-parse', '--short', ref2], { cwd: repoDir, stdio: 'pipe' });
  } catch { /* ignore */ }

  // ── --files 模式: 只对指定文件生成精简 patch ──
  if (FILES_LIST) {
    info(`--files 模式: 从 ${FILES_LIST} 读取文件列表`);

    let fileEntries;
    try {
      const content = fs.readFileSync(FILES_LIST, 'utf-8');
      fileEntries = content.split('\n').map(s => s.trim()).filter(Boolean);
    } catch (err) {
      error(`无法读取文件列表: ${FILES_LIST} (${err.message})`);
    }

    if (fileEntries.length === 0) {
      error('文件列表为空');
    }

    info(`  共 ${fileEntries.length} 个文件`);

    // 构建 git diff 参数: 只对指定文件生成 diff
    // 不应用排除规则, 因为文件列表本身就是筛选结果
    const focusedDiffArgs = ['diff', ...buildFindRenamesArgs(), ref1, ref2, '--', ...fileEntries];

    let focusedDiffContent = '';
    try {
      focusedDiffContent = git(focusedDiffArgs, { cwd: repoDir, stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
    } catch (err) {
      error(`git diff (focused) 执行失败: ${err.message}`);
    }

    // 写入精简 patch
    const focusedHeader = [
      `From ${REPO_URL}`,
      `Date: ${new Date().toISOString()}`,
      `Subject: [PATCH] Focused diff between ${BRANCH1} (${commit1Hash}) and ${BRANCH2} (${commit2Hash})`,
      '',
      `Repository: ${REPO_URL}`,
      `Branch 1:   ${BRANCH1} (${commit1Hash})`,
      `Branch 2:   ${BRANCH2} (${commit2Hash})`,
      `Files: ${fileEntries.length} (from ${FILES_LIST})`,
      `Rename detection: ${FIND_RENAMES <= 0 ? 'disabled' : FIND_RENAMES + '% similarity threshold'}`,
      '',
    ].join('\n');

    fs.writeFileSync(outputFile, focusedHeader + focusedDiffContent, 'utf-8');

    const focusedSize = fs.statSync(outputFile).size;
    ok(`精简 diff 已生成: ${outputFile} (${formatSize(focusedSize)}, ${fileEntries.length} 文件)`);

    console.log('');
    console.log('==========================================');
    console.log('  精简 diff 生成完成');
    console.log('==========================================');
    console.log(`  仓库:     ${REPO_URL}`);
    console.log(`  分支 1:   ${BRANCH1} (${commit1Hash})`);
    console.log(`  分支 2:   ${BRANCH2} (${commit2Hash})`);
    console.log(`  文件数:   ${fileEntries.length}`);
    console.log(`  patch:    ${formatSize(focusedSize)}`);
    console.log(`  输出:     ${outputFile}`);
    console.log('==========================================');
    console.log('');

    // 清理
    if (!KEEP_REPO) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    return;
  }

  // 构建 git diff 参数 (含排除 pathspec + rename 检测)
  const diffArgs = ['diff', ...buildFindRenamesArgs(), ref1, ref2, ...buildPathspecArgs(effectiveExcludes)];

  // 统计变更文件数
  let changedFiles = 0;
  try {
    const nameOnlyArgs = ['diff', '--name-only', ...buildFindRenamesArgs(), ref1, ref2, ...buildPathspecArgs(effectiveExcludes)];
    const output = git(nameOnlyArgs, { cwd: repoDir, stdio: 'pipe' });
    changedFiles = output ? output.split('\n').filter(Boolean).length : 0;
  } catch { /* ignore */ }

  info(`  变更文件数: ${changedFiles}`);

  if (changedFiles === 0) {
    warn('两个分支之间没有差异');
  }

  // 生成 diff 内容
  let diffContent = '';
  try {
    diffContent = git(diffArgs, { cwd: repoDir, stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    error(`git diff 执行失败: ${err.message}`);
  }

  // 写入 patch 文件 (附带头部元信息)
  const header = [
    `From ${REPO_URL}`,
    `Date: ${new Date().toISOString()}`,
    `Subject: [PATCH] Diff between ${BRANCH1} (${commit1Hash}) and ${BRANCH2} (${commit2Hash})`,
    '',
    `Repository: ${REPO_URL}`,
    `Branch 1:   ${BRANCH1} (${commit1Hash})`,
    `Branch 2:   ${BRANCH2} (${commit2Hash})`,
    `Changed files: ${changedFiles}`,
    `Rename detection: ${FIND_RENAMES <= 0 ? 'disabled' : FIND_RENAMES + '% similarity threshold'}`,
    FULL_DIFF ? 'Mode: full (no default excludes)' : 'Mode: filtered (default excludes applied)',
    effectiveExcludes.length > 0 ? `Excludes: ${effectiveExcludes.join(', ')}` : 'Excludes: none',
    '',
  ].join('\n');

  fs.writeFileSync(outputFile, header + diffContent, 'utf-8');

  ok(`diff 文件已生成: ${outputFile}`);

  // ── 4b. 生成变更摘要 summary.md ───────────────────────
  const summaryFile = path.join(OUTPUT_DIR, `summary_${fileBranch1}_${fileBranch2}.md`);
  info('生成变更摘要...');
  try {
    const summaryContent = generateSummary(repoDir, ref1, ref2, effectiveExcludes, {
      repoUrl: REPO_URL,
      branch1: BRANCH1,
      branch2: BRANCH2,
      commit1Hash,
      commit2Hash,
    });
    fs.writeFileSync(summaryFile, summaryContent, 'utf-8');
    ok(`变更摘要已生成: ${summaryFile}`);
  } catch (err) {
    warn(`生成变更摘要失败: ${err.message}`);
  }

  // ── 4c. 生成适配分析报告 structure.md ─────────────────
  // 结构摘要使用 scan-exports.js 对比接口差异 + 结构变更分析
  // 传入导出的源码目录供 scan-exports 扫描
  const structureFile = path.join(OUTPUT_DIR, `structure_${fileBranch1}_${fileBranch2}.md`);
  info('生成适配分析报告 (接口驱动)...');
  let structureStats = null;
  let apiDiffResult = null;
  let scanResult = null;
  try {
    scanResult = generateStructureSummary(repoDir, ref1, ref2, EXCLUDES, {
      repoUrl: REPO_URL,
      branch1: BRANCH1,
      branch2: BRANCH2,
      commit1Hash,
      commit2Hash,
    }, branch1Dir, branch2Dir);
    fs.writeFileSync(structureFile, scanResult.content, 'utf-8');
    structureStats = scanResult.stats;
    apiDiffResult = scanResult.apiDiff;
    ok(`适配分析报告已生成: ${structureFile}`);

    // 打印判定结果
    if (apiDiffResult) {
      console.log('');
      if (apiDiffResult.summary.needsNativeAdaptation) {
        info('⚠️ 需要原生适配 — 接口或 TurboModule Spec 发生变更');
      } else {
        info('✅ 无需原生适配 — 接口未变更, 仅需合并 JS + codegen');
      }
    }

    // 打印结构统计
    if (structureStats) {
      console.log('');
      info(`文件变更统计 (总数 ${structureStats.total}):`);
      for (const cat of RELEVANCE_ORDER) {
        const count = structureStats.relevanceCounts[cat] || 0;
        if (count > 0) {
          const m = RELEVANCE_META[cat];
          info(`  ${m.icon} ${m.title}: ${count}`);
        }
      }
    }
  } catch (err) {
    warn(`生成适配分析报告失败: ${err.message}`);
  }

  // ── 4d. 生成接口差异适配检查清单 api-diff.md ──────────
  const apiDiffFile = path.join(OUTPUT_DIR, `api-diff_${fileBranch1}_${fileBranch2}.md`);
  if (apiDiffResult && scanResult && scanResult.scan1 && scanResult.scan2) {
    info('生成接口差异适配检查清单...');
    try {
      const apiReport = scanExports.generateMarkdownReport(scanResult.scan1, scanResult.scan2, apiDiffResult, {
        version1: BRANCH1,
        version2: BRANCH2,
        repoUrl: REPO_URL,
      });
      fs.writeFileSync(apiDiffFile, apiReport, 'utf-8');
      ok(`接口差异检查清单已生成: ${apiDiffFile}`);
    } catch (err) {
      warn(`生成接口差异检查清单失败: ${err.message}`);
    }
  }
  console.log('');

  // ── 5. 显示摘要 ────────────────────────────────────────
  const fileSize = fs.statSync(outputFile).size;

  console.log('==========================================');
  console.log('  对比完成');
  console.log('==========================================');
  console.log(`  仓库:     ${REPO_URL}`);
  console.log(`  分支 1:   ${BRANCH1} (${commit1Hash})`);
  console.log(`  分支 2:   ${BRANCH2} (${commit2Hash})`);
  console.log(`  变更文件: ${changedFiles}`);
  console.log(`  rename:   ${FIND_RENAMES <= 0 ? '关闭' : FIND_RENAMES + '%'}`);
  console.log(`  模式:     ${FULL_DIFF ? '完整 diff (--full)' : '聚焦核心代码 (默认排除噪音)'}`);
  console.log('');
  console.log(`  输出目录:   ${OUTPUT_DIR}/`);
  console.log(`  ├── ${fileBranch1}/                              (分支1 源代码)`);
  console.log(`  ├── ${fileBranch2}/                              (分支2 源代码)`);
  console.log(`  ├── diff_${fileBranch1}_${fileBranch2}.patch              (${formatSize(fileSize)})`);
  console.log(`  ├── summary_${fileBranch1}_${fileBranch2}.md               (变更摘要)`);
  console.log(`  ├── structure_${fileBranch1}_${fileBranch2}.md             (适配分析报告)`);
  if (apiDiffResult && scanResult && scanResult.scan1 && scanResult.scan2) {
    console.log(`  └── api-diff_${fileBranch1}_${fileBranch2}.md             (接口差异检查清单)`);
  } else {
    console.log(`  └── (接口差异检查清单生成失败)`);
  }
  console.log('==========================================');
  console.log('');

  // ── 6. 清理 ────────────────────────────────────────────
  if (KEEP_REPO) {
    info(`保留克隆的仓库: ${repoDir}`);
  } else {
    fs.rmSync(workDir, { recursive: true, force: true });
    debug(`已清理临时目录: ${workDir}`);
  }
}

main();
