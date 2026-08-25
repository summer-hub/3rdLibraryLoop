#!/usr/bin/env node
/**
 * generate-diff.js
 *
 * 通过 npm tgz 发行版对比 RN 三方库的两个版本, 生成 diff 文件 (.patch)。
 *
 * 工作流:
 *   1. 通过 npm pack 下载指定版本的 tgz (或使用本地 .tgz 文件)
 *   2. 解压到输出目录 (strip package/ 一级)
 *   3. 用文件系统 diff 对比两个目录, 生成 unified diff
 *   4. 生成变更摘要、适配分析报告、接口差异检查清单
 *
 * 默认聚焦三方库核心代码变更, 自动排除 lock 文件、example/、CI 配置、文档、
 * 编译产物 (lib/, dist/, build/) 等与鸿蒙化升级排查无关的噪音文件。
 * 使用 --full 可生成包含所有变更的完整 diff。
 *
 * 输出文件各有侧重:
 *   diff_*.patch       — diff 补丁 (应用排除规则, 聚焦可合并的代码变更)
 *   summary_*.md       — 变更摘要 (同 diff 的排除范围, 按目录统计增删行数)
 *   structure_*.md     — 适配分析报告 (以接口差异为锚点:
 *                        先用 rn-scan-exports.cjs 判定是否需要原生适配,
 *                        有接口变更时按变更项展开 + 附其他平台实现参考,
 *                        无接口变更时只列 JS 合并清单 + 文件计数)
 *   api-diff_*.md      — 接口差异适配检查清单 (每个变更项含 checkbox, 直接指导适配)
 *
 * 输出结构:
 *   diff/
 *   ├── <version1>/                         (版本1 源代码)
 *   ├── <version2>/                         (版本2 源代码)
 *   ├── diff_<v1>_<v2>.patch                (对比 diff 文件)
 *   ├── summary_<v1>_<v2>.md                (变更摘要, 按文件统计增删行数)
 *   ├── structure_<v1>_<v2>.md              (适配分析报告, 接口驱动)
 *   └── api-diff_<v1>_<v2>.md               (接口差异适配检查清单)
 *
 * 默认排除的路径模式 (聚焦核心代码):
 *   yarn.lock, package-lock.json, *.lock
 *   .yarn/, .github/, example/, docs/
 *   CHANGELOG.md, CONTRIBUTING.md, MIGRATION*.md, README.md
 *   .gitignore, .yarnrc.yml, .npmrc, .idea/
 *   android/, ios/, apple/, windows/ (其他平台原生代码, glob 匹配任意层级)
 *
 * tgz 额外排除 (npm 包含编译产物):
 *   lib/, dist/, build/, *.map, *.tsbuildinfo
 *   apple-frameworks/, xcframework/, framework/
 *
 * 用法:
 *   node generate-diff.js --npm-package <name> --tgz1 <ver> --tgz2 <ver> [选项]
 *
 * 示例:
 *   # 对比 async-storage 的 2.2.0 和 3.1.1 (默认排除噪音)
 *   node generate-diff.js \
 *     --npm-package @react-native-async-storage/async-storage \
 *     --tgz1 2.2.0 \
 *     --tgz2 3.1.1 \
 *     --output-dir ./diff-output
 *
 *   # 使用本地已下载的 tgz 文件
 *   node generate-diff.js \
 *     --npm-package @react-native-async-storage/async-storage \
 *     --tgz1 ./pkg-2.2.0.tgz \
 *     --tgz2 ./pkg-3.1.1.tgz \
 *     --output-dir ./diff-output
 *
 *   # 生成完整 diff (不排除任何文件)
 *   node generate-diff.js \
 *     --npm-package @react-native-async-storage/async-storage \
 *     --tgz1 2.2.0 \
 *     --tgz2 3.1.1 \
 *     --full
 *
 *   # 两阶段流程: 第二轮只对 AI 筛选的文件生成精简 patch
 *   node generate-diff.js \
 *     --npm-package @react-native-async-storage/async-storage \
 *     --tgz1 2.2.0 \
 *     --tgz2 3.1.1 \
 *     --files relevant-files.txt \
 *     --output-dir ./diff-focused
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 引入 rn-scan-exports.cjs 模块 (接口扫描 + 对比)
// 位于 3rdLibraryLoop/MCP/scripts/，通过相对路径引用
const scanExports = require('../../../../MCP/scripts/rn-scan-exports.cjs');

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
let OUTPUT_DIR = '';
let VERBOSE = false;
let FULL_DIFF = false;
let FILES_LIST = '';
let TGZ1 = '';
let TGZ2 = '';
let NPM_PACKAGE = '';
const EXCLUDES = [];

// ── 默认排除规则 (聚焦三方库核心代码, 过滤与鸿蒙化升级排查无关的噪音) ──
// 这些路径在 --full 模式下不会被排除
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
  // 含 ** 的模式使用 glob 匹配任意层级目录内文件
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
RNOH 三方库版本对比脚本 (tgz 模式)

通过 npm tgz 发行版对比两个版本, 无需 git clone。
--tgz1/--tgz2 可以是本地 .tgz 路径或 npm 版本号 (自动 npm pack 下载)。
默认聚焦核心代码, 自动排除 lock 文件、example/、CI 配置、文档、编译产物等噪音。
使用 --full 可生成包含所有变更的完整 diff。

输出文件各有侧重:
  diff_*.patch       — diff 补丁 (应用排除规则, 聚焦可合并的代码变更)
  summary_*.md       — 变更摘要 (同 diff 的排除范围, 按目录统计增删行数)
  structure_*.md     — 适配分析报告 (以接口差异为锚点:
                       先用 rn-scan-exports.cjs 判定是否需要原生适配,
                       有接口变更时按变更项展开 + 附其他平台实现参考,
                       无接口变更时只列 JS 合并清单 + 文件计数)
  api-diff_*.md      — 接口差异适配检查清单 (每个变更项含 checkbox, 直接指导适配)

输出结构:
  diff/
  ├── <version1>/                         (版本1 源代码)
  ├── <version2>/                         (版本2 源代码)
  ├── diff_<v1>_<v2>.patch                (对比 diff 文件)
  ├── summary_<v1>_<v2>.md                (变更摘要, 按文件统计增删行数)
  ├── structure_<v1>_<v2>.md              (适配分析报告, 接口驱动)
  └── api-diff_<v1>_<v2>.md               (接口差异适配检查清单)

用法:
  node generate-diff.js [选项]

必选参数:
  --npm-package <name>   npm 包名 (如 @react-native-async-storage/async-storage)
  --tgz1 <spec>          第一个版本: 版本号 (如 2.2.0) 或本地 .tgz 文件路径
  --tgz2 <spec>          第二个版本: 版本号 (如 3.1.1) 或本地 .tgz 文件路径

可选参数:
  --output-dir <path>    输出目录 (默认: 当前目录下的 diff/ 文件夹)
  --exclude <pattern>    排除文件路径模式, 在默认排除基础上追加 (可多次指定)
  --full                 生成完整 diff, 不使用默认排除规则 (仍可配合 --exclude)
  --files <path>         只对指定文件列表生成精简 diff patch (每行一个文件路径)
                          用于两阶段流程: 第一轮生成全量清单 → AI 筛选 → 第二轮精简 patch
                          与 --full 互斥; 指定后跳过排除规则, 只生成指定文件的 diff
  --verbose              显示详细调试信息
  --help, -h             显示帮助

默认排除的路径 (除非使用 --full):
  yarn.lock, package-lock.json, *.lock
  .yarn/, .github/, example/, examples/, docs/
  android/, ios/, apple/, windows/ (其他平台原生代码, glob 匹配任意层级)
  CHANGELOG.md, CONTRIBUTING.md, MIGRATION*.md, README.md
  .gitignore, .yarnrc.yml, .npmrc, .idea/
  lib/, dist/, build/, *.map, *.tsbuildinfo (tgz 编译产物)

示例:
  # 对比 async-storage 的 2.2.0 和 3.1.1 (默认排除噪音)
  node generate-diff.js \\
    --npm-package @react-native-async-storage/async-storage \\
    --tgz1 2.2.0 \\
    --tgz2 3.1.1 \\
    --output-dir ./diff-output

  # 使用本地已下载的 tgz 文件
  node generate-diff.js \\
    --npm-package @react-native-async-storage/async-storage \\
    --tgz1 ./pkg-2.2.0.tgz \\
    --tgz2 ./pkg-3.1.1.tgz \\
    --output-dir ./diff-output

  # 生成完整 diff (不排除任何文件)
  node generate-diff.js \\
    --npm-package @react-native-async-storage/async-storage \\
    --tgz1 2.2.0 \\
    --tgz2 3.1.1 \\
    --full

  # 在默认排除基础上追加额外排除
  node generate-diff.js \\
    --npm-package @react-native-async-storage/async-storage \\
    --tgz1 2.2.0 \\
    --tgz2 3.1.1 \\
    --exclude packages/core/windows/

  # 两阶段流程: 第二轮只对 AI 筛选的文件生成精简 patch
  node generate-diff.js \\
    --npm-package @react-native-async-storage/async-storage \\
    --tgz1 2.2.0 \\
    --tgz2 3.1.1 \\
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
      case '--output-dir':    OUTPUT_DIR = args[i + 1]; i += 2; break;
      case '--exclude':       EXCLUDES.push(args[i + 1]); i += 2; break;
      case '--full':          FULL_DIFF = true; i += 1; break;
      case '--files':         FILES_LIST = args[i + 1]; i += 2; break;
      case '--tgz1':          TGZ1 = args[i + 1]; i += 2; break;
      case '--tgz2':          TGZ2 = args[i + 1]; i += 2; break;
      case '--npm-package':   NPM_PACKAGE = args[i + 1]; i += 2; break;
      case '--verbose':       VERBOSE = true; i += 1; break;
      case '--help':
      case '-h':              usage(); break;
      default:                error(`未知参数: ${args[i]} (使用 --help 查看用法)`);
    }
  }
}

// ── 工具函数 ─────────────────────────────────────────────

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
 * tgz 模式额外排除规则。
 *
 * npm tgz 包含编译产物 (lib/, dist/, build/) 和 source maps (*.map),
 * 这些在 git 仓库中通常被 .gitignore 排除, 不会出现在 diff 中。
 * tgz 模式需要额外排除以聚焦源码变更。
 */
const TGZ_EXTRA_EXCLUDES = [
  'lib/',
  'dist/',
  'build/',
  '*.map',
  '*.tsbuildinfo',
  // 预编译二进制框架 (npm 包中的 xcframework 等)
  'apple-frameworks/',
  '**/*.xcframework/**',
  '**/*.framework/**',
];

/**
 * 构建最终的排除列表。
 * --full 模式下只用用户 --exclude 指定的; 否则合并默认排除 + 用户追加。
 * tgz 模式始终合并编译产物排除规则。
 * @returns {string[]} 排除路径模式数组
 */
function buildExcludeList() {
  if (FULL_DIFF) {
    return [...TGZ_EXTRA_EXCLUDES, ...EXCLUDES];
  }
  return [...DEFAULT_EXCLUDES, ...TGZ_EXTRA_EXCLUDES, ...EXCLUDES];
}

// ── tgz 模式: npm 包下载 + 解压 ──────────────────────────

/**
 * 判断字符串是否为有效的 npm 语义版本号。
 * 匹配 x.y.z 格式 (可含 prerelease 标签如 -next.0)。
 * @param {string} str 待判断的字符串
 * @returns {boolean}
 */
function isVersionString(str) {
  return /^\d+\.\d+\.\d+/.test(str);
}

/**
 * 获取 tgz 文件: 如果是本地路径直接返回, 如果是版本号则通过 npm pack 下载。
 * @param {string} tgzSpec 本地 .tgz 路径或版本号 (如 "2.2.0")
 * @param {string} npmPackage npm 包名 (如 @react-native-async-storage/async-storage)
 * @param {string} workDir 临时工作目录
 * @returns {string} tgz 文件的绝对路径
 */
function resolveTgz(tgzSpec, npmPackage, workDir) {
  // 如果是本地文件路径
  if (fs.existsSync(tgzSpec) && tgzSpec.endsWith('.tgz')) {
    const absPath = path.resolve(tgzSpec);
    ok(`使用本地 tgz 文件: ${absPath}`);
    return absPath;
  }

  // 如果是版本号, 通过 npm pack 下载
  if (isVersionString(tgzSpec)) {
    if (!npmPackage) {
      error(`--tgz1/--tgz2 指定了版本号 "${tgzSpec}" 但未指定 --npm-package`);
    }
    info(`通过 npm pack 下载: ${npmPackage}@${tgzSpec}`);
    const tgzFile = execSync(`npm pack ${npmPackage}@${tgzSpec}`, {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
    }).trim();
    const absPath = path.join(workDir, tgzFile);
    if (!fs.existsSync(absPath)) {
      error(`npm pack 下载失败: ${npmPackage}@${tgzSpec} (预期文件: ${absPath})`);
    }
    ok(`已下载: ${tgzFile}`);
    return absPath;
  }

  error(`无效的 tgz 参数: "${tgzSpec}" — 应为本地 .tgz 文件路径或版本号 (如 2.2.0)`);
}

/**
 * 解压 tgz 文件到目标目录 (npm tgz 内部为 package/ 目录, 去除一级)。
 * @param {string} tgzFile tgz 文件路径
 * @param {string} destDir 目标目录
 */
function extractTgz(tgzFile, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // npm pack 生成的 tgz 内部结构为 package/..., 用 --strip-components=1 去除
  execSync(`tar xzf "${tgzFile}" -C "${destDir}" --strip-components=1`, {
    stdio: 'pipe',
    timeout: 60000,
  });
}

// ── 文件系统遍历 + diff ────────────────────────────────

/**
 * 将排除模式转换为正则表达式 (用于文件系统遍历)。
 * 支持两种模式:
 *  - 含 glob 双星号的模式 (如 android 子树): 匹配任意层级同名目录下的文件
 *  - 普通路径: example/ → 匹配根目录 example/ 下的文件
 * @param {string} pattern 排除模式
 * @returns {RegExp} 匹配正则
 */
function excludePatternToRegex(pattern) {
  // 去除尾部 /
  let p = pattern.replace(/\/$/, '');
  if (p.includes('**')) {
    // glob 双星号模式: 匹配任意路径中包含对应目录名的文件
    const escaped = p
      .replace(/\*\*/g, '<<<GLOB>>>')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/<<<GLOB>>>/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`(^|/)${escaped}(/|$)`);
  }
  // 普通模式: 匹配根目录或任意层级同名目录
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`(^|/)${escaped}(/|$)`);
}

/**
 * 判断文件相对路径是否应被排除。
 * @param {string} relPath 相对于源码根目录的路径
 * @param {RegExp[]} excludeRegexes 排除正则数组
 * @returns {boolean} 是否应排除
 */
function shouldExclude(relPath, excludeRegexes) {
  return excludeRegexes.some(re => re.test(relPath));
}

/**
 * 递归遍历目录, 返回所有文件的相对路径列表。
 * @param {string} dir 根目录
 * @param {RegExp[]} excludeRegexes 排除正则数组
 * @returns {string[]} 相对路径列表 (POSIX 风格 / 分隔)
 */
function walkDir(dir, excludeRegexes = []) {
  const results = [];
  function walk(currentDir, relPrefix) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      // 检查是否被排除
      if (shouldExclude(relPath, excludeRegexes)) continue;
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name), relPath);
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
  }
  walk(dir, '');
  return results.sort();
}

/**
 * 用 GNU diff 对比两个目录, 生成 unified diff 输出。
 *
 * @param {string} dir1 目录1
 * @param {string} dir2 目录2
 * @param {string[]} excludePatterns 排除模式列表
 * @returns {string} diff 输出
 */
function diffDirsWithFs(dir1, dir2, excludePatterns) {
  const excludeRegexes = excludePatterns.map(excludePatternToRegex);

  // 收集两个目录的文件列表 (应用排除)
  const files1 = walkDir(dir1, excludeRegexes);
  const files2 = walkDir(dir2, excludeRegexes);

  const set1 = new Set(files1);
  const set2 = new Set(files2);

  // 合并所有文件 (排序)
  const allFiles = [...new Set([...files1, ...files2])].sort();

  const lines = [];

  for (const file of allFiles) {
    const in1 = set1.has(file);
    const in2 = set2.has(file);
    const path1 = path.join(dir1, file);
    const path2 = path.join(dir2, file);

    if (in1 && in2) {
      // 两边都有: 用 diff 对比内容
      try {
        const output = execSync(
          `diff -u --label "a/${file}" --label "b/${file}" "${path1}" "${path2}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 }
        );
        // diff 返回 0=相同, 1=有差异(输出到stdout), 2=错误
        if (output) {
          lines.push(`diff --git a/${file} b/${file}`);
          lines.push(output);
        }
      } catch (err) {
        // diff 返回 1 时 execSync 抛异常但 stdout 有内容
        if (err.stdout) {
          lines.push(`diff --git a/${file} b/${file}`);
          lines.push(err.stdout.toString('utf-8'));
        }
      }
    } else if (in1 && !in2) {
      // 仅在 dir1: 删除
      lines.push(`diff --git a/${file} b/${file}`);
      lines.push(`deleted file mode 100644`);
      lines.push(`--- a/${file}`);
      lines.push(`+++ /dev/null`);
      try {
        const content = fs.readFileSync(path1, 'utf-8');
        for (const line of content.split('\n')) {
          lines.push(`-${line}`);
        }
      } catch { /* binary */ }
      lines.push('');
    } else if (!in1 && in2) {
      // 仅在 dir2: 新增
      lines.push(`diff --git a/${file} b/${file}`);
      lines.push(`new file mode 100644`);
      lines.push(`--- /dev/null`);
      lines.push(`+++ b/${file}`);
      try {
        const content = fs.readFileSync(path2, 'utf-8');
        for (const line of content.split('\n')) {
          lines.push(`+${line}`);
        }
      } catch { /* binary */ }
      lines.push('');
    }
    // rename 检测: tgz 模式不做跨文件相似度匹配
    // (npm 包之间的文件移动较少见, 且 diff -u 已能展示内容差异)
  }

  return lines.join('\n');
}

/**
 * 统计文件增删行数 (文件系统遍历, 替代 git diff --numstat)。
 * 对每个有差异的文件, 用 diff 统计 +N / -N。
 *
 * @param {string} dir1 目录1
 * @param {string} dir2 目录2
 * @param {string[]} excludePatterns 排除模式列表
 * @returns {Map<string, {added: number, deleted: number}>} filepath → numstat
 */
function fetchNumstatWithFs(dir1, dir2, excludePatterns) {
  const excludeRegexes = excludePatterns.map(excludePatternToRegex);
  const files1 = walkDir(dir1, excludeRegexes);
  const files2 = walkDir(dir2, excludeRegexes);
  const set1 = new Set(files1);
  const set2 = new Set(files2);
  const allFiles = [...new Set([...files1, ...files2])].sort();

  const result = new Map();

  for (const file of allFiles) {
    const in1 = set1.has(file);
    const in2 = set2.has(file);
    const path1 = path.join(dir1, file);
    const path2 = path.join(dir2, file);

    let added = 0;
    let deleted = 0;

    if (in1 && in2) {
      try {
        const output = execSync(`diff "${path1}" "${path2}"`, {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024,
        });
        if (output) {
          for (const line of output.split('\n')) {
            if (line.startsWith('> ')) added++;
            if (line.startsWith('< ')) deleted++;
          }
        }
      } catch (err) {
        if (err.stdout) {
          for (const line of err.stdout.toString('utf-8').split('\n')) {
            if (line.startsWith('> ')) added++;
            if (line.startsWith('< ')) deleted++;
          }
        }
      }
    } else if (!in1 && in2) {
      // 新文件: 全部为新增行
      try {
        const content = fs.readFileSync(path2, 'utf-8');
        added = content.split('\n').filter(Boolean).length;
      } catch { /* binary */ }
    } else if (in1 && !in2) {
      // 删除文件: 全部为删除行
      try {
        const content = fs.readFileSync(path1, 'utf-8');
        deleted = content.split('\n').filter(Boolean).length;
      } catch { /* binary */ }
    }

    if (added > 0 || deleted > 0) {
      result.set(file, { added, deleted });
    }
  }

  return result;
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

// ── 结构变更分析 ─────────────────────────────────────────

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
 * 分析两个目录之间的结构变更。
 *
 * 通过文件存在性判断状态:
 *  - 两边都有 → Modified
 *  - 仅 dir2 有 → Added
 *  - 仅 dir1 有 → Deleted
 *  (rename 检测在 tgz 模式下降级为 modified + added + deleted)
 *
 * @param {string} dir1 目录1源码
 * @param {string} dir2 目录2源码
 * @param {string[]} extraExcludes 额外排除模式
 * @returns {{entries: ChangeEntry[], stats: Object}} 变更条目列表和统计信息
 */
function analyzeStructuralChangesWithFs(dir1, dir2, extraExcludes = []) {
  const structureExcludes = [...MINIMAL_EXCLUDES, ...TGZ_EXTRA_EXCLUDES, ...extraExcludes];
  const excludeRegexes = structureExcludes.map(excludePatternToRegex);

  const files1 = walkDir(dir1, excludeRegexes);
  const files2 = walkDir(dir2, excludeRegexes);
  const set1 = new Set(files1);
  const set2 = new Set(files2);
  const allFiles = [...new Set([...files1, ...files2])].sort();

  const numstatMap = fetchNumstatWithFs(dir1, dir2, structureExcludes);
  const entries = [];

  for (const file of allFiles) {
    const in1 = set1.has(file);
    const in2 = set2.has(file);

    let status, oldPath, newPath;
    if (in1 && in2) {
      // 检查是否有实际差异
      const ns = numstatMap.get(file);
      if (!ns) continue; // 无差异, 跳过
      status = 'M';
      oldPath = file;
      newPath = file;
    } else if (!in1 && in2) {
      status = 'A';
      oldPath = '';
      newPath = file;
    } else if (in1 && !in2) {
      status = 'D';
      oldPath = file;
      newPath = '';
    } else {
      continue;
    }

    const ns = numstatMap.get(file) || { added: 0, deleted: 0 };
    entries.push({
      status,
      oldPath,
      newPath,
      similarity: 100,
      added: ns.added,
      deleted: ns.deleted,
    });
  }

  // 鸿蒙相关性分类
  for (const entry of entries) {
    entry.relevance = classifyFileRelevance(entry);
  }

  // 统计
  const relevantEntries = entries.filter(e => e.relevance !== 'not-relevant');
  const irrelevantEntries = entries.filter(e => e.relevance === 'not-relevant');
  const relevanceCounts = {};
  for (const cat of RELEVANCE_ORDER) {
    relevanceCounts[cat] = entries.filter(e => e.relevance === cat).length;
  }

  const stats = {
    total: entries.length,
    relevant: relevantEntries.length,
    irrelevant: irrelevantEntries.length,
    renamed: 0,
    modified: entries.filter(e => e.status === 'M').length,
    added: entries.filter(e => e.status === 'A').length,
    deleted: entries.filter(e => e.status === 'D').length,
    copied: 0,
    typeChanged: 0,
    totalAdded: entries.reduce((sum, e) => sum + e.added, 0),
    totalDeleted: entries.reduce((sum, e) => sum + e.deleted, 0),
    relevanceCounts,
  };

  return { entries, stats };
}

/**
 * 生成变更摘要 Markdown。
 *
 * @param {string} dir1 目录1源码
 * @param {string} dir2 目录2源码
 * @param {string[]} excludePatterns 排除模式列表
 * @param {object} meta 元信息
 * @returns {string} 摘要 Markdown 内容
 */
function generateSummaryWithFs(dir1, dir2, excludePatterns, meta) {
  const numstatMap = fetchNumstatWithFs(dir1, dir2, excludePatterns);

  const files = [];
  let totalAdded = 0;
  let totalDeleted = 0;

  for (const [filepath, { added, deleted }] of numstatMap) {
    files.push({ filepath, added, deleted });
    totalAdded += added;
    totalDeleted += deleted;
  }

  // 按目录分组
  const groups = {};
  for (const f of files) {
    const sep = f.filepath.lastIndexOf('/');
    const dir = sep >= 0 ? f.filepath.substring(0, sep) : '(根目录)';
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(f);
  }

  const lines = [];
  lines.push(`# 变更摘要: ${meta.branch1} → ${meta.branch2}`);
  lines.push('');
  lines.push(`| 项目 | 值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 仓库 | ${meta.repoUrl} |`);
  lines.push(`| 版本 1 | ${meta.branch1} (${meta.commit1Hash}) |`);
  lines.push(`| 版本 2 | ${meta.branch2} (${meta.commit2Hash}) |`);
  lines.push(`| 变更文件数 | ${files.length} |`);
  lines.push(`| 新增行数 | +${totalAdded} |`);
  lines.push(`| 删除行数 | -${totalDeleted} |`);
  lines.push(`| 对比方式 | tgz (npm 发行版) |`);
  if (excludePatterns.length > 0) {
    lines.push(`| 排除模式 | ${excludePatterns.join(', ')} |`);
  } else {
    lines.push(`| 排除模式 | 无 (--full 模式) |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const dir of Object.keys(groups).sort()) {
    lines.push(`## ${dir}/`);
    lines.push('');
    lines.push('| 文件 | 新增 | 删除 |');
    lines.push('|------|------|------|');
    for (const f of groups[dir].sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted))) {
      lines.push(`| ${f.filepath} | +${f.added} | -${f.deleted} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
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
 *   1. 调用 rn-scan-exports.cjs 对比两个版本的 JS 层接口 (导出 + TurboModule Spec)
 *   2. 如果接口未变更 → 报告"仅 JS 合并 + codegen, 无需原生适配", 文件变更只计数
 *   3. 如果接口有变更 → 以接口变更项为锚点组织内容:
 *      - 每个新增/变更的接口方法下, 附上其他平台 (Android/iOS) 的实现文件作为参考
 *      - 纯 bug 修复 / 文档 / CI 等 → 只计数, 不展开
 *
 * @param {string} dir1 目录1源码
 * @param {string} dir2 目录2源码
 * @param {string[]} extraExcludes 用户额外排除模式
 * @param {object} meta 元信息
 * @param {string} branch1Dir 分支1 导出目录 (用于 rn-scan-exports.cjs)
 * @param {string} branch2Dir 分支2 导出目录 (用于 rn-scan-exports.cjs)
 * @returns {{content: string, stats: Object, apiDiff: Object, scan1: Object, scan2: Object}}
 */
function generateStructureSummaryTgz(dir1, dir2, extraExcludes, meta, branch1Dir, branch2Dir) {
  // ── Step 1: 扫描接口差异 ──
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

  // ── Step 2: 分析结构变更 (文件级, 用文件系统遍历) ──
  const { entries, stats } = analyzeStructuralChangesWithFs(dir1, dir2, extraExcludes);

  const lines = [];

  // ── 头部 ──
  lines.push(`# 适配分析报告: ${meta.branch1} → ${meta.branch2}`);
  lines.push('');
  lines.push(`| 项目 | 值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 仓库 | ${meta.repoUrl} |`);
  lines.push(`| 版本 1 | ${meta.branch1} (${meta.commit1Hash}) |`);
  lines.push(`| 版本 2 | ${meta.branch2} (${meta.commit2Hash}) |`);
  lines.push(`| 文件变更总数 | ${stats.total} |`);
  lines.push(`| 对比方式 | tgz (npm 发行版, 无 rename 检测) |`);
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

  if (stats.irrelevant > 0) {
    lines.push(`**不相关变更 (${stats.irrelevant}):** 文档/图片/CI/lock/原生平台代码等, 已过滤`);
    lines.push('');
  }

  if (entries.length === 0) {
    lines.push('*两个版本之间没有结构差异。*');
  }

  return { content: lines.join('\n'), stats, apiDiff, scan1, scan2 };
}

// ── 主流程 ───────────────────────────────────────────────

/**
 * 主流程: 通过 npm 包发行版对比两个版本, 无需 git。
 *
 * 工作流:
 * 1. 创建临时工作目录
 * 2. 下载/定位两个 tgz 文件 (本地路径或 npm pack)
 * 3. 解压到输出目录
 * 4. 用文件系统 diff 生成 patch + summary + structure + api-diff
 * 5. 清理临时文件
 */
function main() {
  parseArgs();

  // 参数校验
  if (!NPM_PACKAGE) error('必须指定 --npm-package <name>');
  if (!TGZ1) error('必须指定 --tgz1 <版本号或.tgz路径>');
  if (!TGZ2) error('必须指定 --tgz2 <版本号或.tgz路径>');
  if (TGZ1 === TGZ2) error(`两个版本不能相同: ${TGZ1}`);

  // 检查依赖 (需要 tar, diff, npm)
  try {
    execFileSync('tar', ['--version'], { stdio: 'pipe' });
  } catch {
    error('未找到 tar, 请先安装');
  }
  try {
    execFileSync('diff', ['--version'], { stdio: 'pipe' });
  } catch {
    error('未找到 diff, 请先安装');
  }
  try {
    execFileSync('npm', ['--version'], { stdio: 'pipe' });
  } catch {
    error('未找到 npm, 请先安装');
  }

  // 默认输出目录
  if (!OUTPUT_DIR) {
    OUTPUT_DIR = path.join(process.cwd(), 'diff');
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 生成文件名/目录名
  const fileBranch1 = isVersionString(TGZ1) ? `v${TGZ1}` : cleanBranchName(path.basename(TGZ1, '.tgz'));
  const fileBranch2 = isVersionString(TGZ2) ? `v${TGZ2}` : cleanBranchName(path.basename(TGZ2, '.tgz'));
  const outputFile = path.join(OUTPUT_DIR, `diff_${fileBranch1}_${fileBranch2}.patch`);
  const branch1Dir = path.join(OUTPUT_DIR, fileBranch1);
  const branch2Dir = path.join(OUTPUT_DIR, fileBranch2);

  console.log('');
  console.log('==========================================');
  console.log('  RNOH 三方库版本对比 (tgz 模式)');
  console.log('==========================================');
  console.log('');

  const effectiveExcludes = buildExcludeList();

  info(`npm 包名:   ${NPM_PACKAGE}`);
  info(`版本 1:     ${TGZ1}`);
  info(`版本 2:     ${TGZ2}`);
  info(`输出目录:   ${OUTPUT_DIR}`);
  info(`输出文件:   ${outputFile}`);
  info(`对比方式:   tgz (npm 发行版, 无 rename 检测)`);
  if (FULL_DIFF) {
    info(`模式:       完整 diff (--full)`);
  } else {
    info(`模式:       聚焦核心代码 (默认排除噪音)`);
  }
  if (effectiveExcludes.length > 0) {
    info(`排除模式:   ${effectiveExcludes.join(' ')}`);
  }
  console.log('');

  // ── 1. 创建临时工作目录 ────────────────────────────────
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-diff-tgz-'));
  debug(`临时目录: ${workDir}`);

  // ── 2. 下载/定位 tgz 文件 ──────────────────────────────
  info('获取 tgz 文件...');
  const tgzFile1 = resolveTgz(TGZ1, NPM_PACKAGE, workDir);
  const tgzFile2 = resolveTgz(TGZ2, NPM_PACKAGE, workDir);
  console.log('');

  // ── 3. 解压到输出目录 ──────────────────────────────────
  info('解压 tgz 文件...');

  // 清理旧目录
  for (const dir of [branch1Dir, branch2Dir]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  try {
    extractTgz(tgzFile1, branch1Dir);
    ok(`  ✓ ${TGZ1} 已解压到: ${branch1Dir}`);
  } catch (err) {
    error(`解压 ${TGZ1} 失败: ${err.message}`);
  }

  try {
    extractTgz(tgzFile2, branch2Dir);
    ok(`  ✓ ${TGZ2} 已解压到: ${branch2Dir}`);
  } catch (err) {
    error(`解压 ${TGZ2} 失败: ${err.message}`);
  }
  console.log('');

  // 版本标签用于报告
  const version1Label = isVersionString(TGZ1) ? TGZ1 : fileBranch1;
  const version2Label = isVersionString(TGZ2) ? TGZ2 : fileBranch2;
  const commit1Hash = 'npm-tgz';
  const commit2Hash = 'npm-tgz';

  const meta = {
    repoUrl: `npm:${NPM_PACKAGE}`,
    branch1: version1Label,
    branch2: version2Label,
    commit1Hash,
    commit2Hash,
  };

  // ── 4. --files 模式: 精简 patch ────────────────────────
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

    // 逐文件生成 diff
    const lines = [];
    for (const file of fileEntries) {
      const path1 = path.join(branch1Dir, file);
      const path2 = path.join(branch2Dir, file);
      const exists1 = fs.existsSync(path1);
      const exists2 = fs.existsSync(path2);

      if (exists1 && exists2) {
        try {
          const output = execSync(
            `diff -u --label "a/${file}" --label "b/${file}" "${path1}" "${path2}"`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 }
          );
          if (output) {
            lines.push(`diff --git a/${file} b/${file}`);
            lines.push(output);
          }
        } catch (err) {
          if (err.stdout) {
            lines.push(`diff --git a/${file} b/${file}`);
            lines.push(err.stdout.toString('utf-8'));
          }
        }
      } else if (!exists1 && exists2) {
        lines.push(`diff --git a/${file} b/${file}`);
        lines.push(`new file mode 100644`);
        lines.push(`--- /dev/null`);
        lines.push(`+++ b/${file}`);
        try {
          const content = fs.readFileSync(path2, 'utf-8');
          for (const line of content.split('\n')) lines.push(`+${line}`);
        } catch { /* binary */ }
        lines.push('');
      } else if (exists1 && !exists2) {
        lines.push(`diff --git a/${file} b/${file}`);
        lines.push(`deleted file mode 100644`);
        lines.push(`--- a/${file}`);
        lines.push(`+++ /dev/null`);
        try {
          const content = fs.readFileSync(path1, 'utf-8');
          for (const line of content.split('\n')) lines.push(`-${line}`);
        } catch { /* binary */ }
        lines.push('');
      }
    }

    const focusedHeader = [
      `From npm:${NPM_PACKAGE}`,
      `Date: ${new Date().toISOString()}`,
      `Subject: [PATCH] Focused diff between ${version1Label} and ${version2Label} (tgz)`,
      '',
      `npm Package: ${NPM_PACKAGE}`,
      `Version 1:   ${version1Label}`,
      `Version 2:   ${version2Label}`,
      `Files: ${fileEntries.length} (from ${FILES_LIST})`,
      `Mode: tgz (npm release)`,
      '',
    ].join('\n');

    fs.writeFileSync(outputFile, focusedHeader + lines.join('\n'), 'utf-8');

    const focusedSize = fs.statSync(outputFile).size;
    ok(`精简 diff 已生成: ${outputFile} (${formatSize(focusedSize)}, ${fileEntries.length} 文件)`);

    console.log('');
    console.log('==========================================');
    console.log('  精简 diff 生成完成 (tgz)');
    console.log('==========================================');
    console.log(`  包名:     ${NPM_PACKAGE}`);
    console.log(`  版本 1:   ${version1Label}`);
    console.log(`  版本 2:   ${version2Label}`);
    console.log(`  文件数:   ${fileEntries.length}`);
    console.log(`  patch:    ${formatSize(focusedSize)}`);
    console.log(`  输出:     ${outputFile}`);
    console.log('==========================================');
    console.log('');

    // 清理
    fs.rmSync(workDir, { recursive: true, force: true });
    debug(`已清理临时目录: ${workDir}`);
    return;
  }

  // ── 5. 生成完整 diff patch ─────────────────────────────
  info('生成 diff (文件系统对比)...');

  const diffContent = diffDirsWithFs(branch1Dir, branch2Dir, effectiveExcludes);

  // 统计变更文件数
  const numstatMap = fetchNumstatWithFs(branch1Dir, branch2Dir, effectiveExcludes);
  const changedFiles = numstatMap.size;

  info(`  变更文件数: ${changedFiles}`);
  if (changedFiles === 0) {
    warn('两个版本之间没有差异');
  }

  const header = [
    `From npm:${NPM_PACKAGE}`,
    `Date: ${new Date().toISOString()}`,
    `Subject: [PATCH] Diff between ${version1Label} and ${version2Label} (tgz)`,
    '',
    `npm Package: ${NPM_PACKAGE}`,
    `Version 1:   ${version1Label}`,
    `Version 2:   ${version2Label}`,
    `Changed files: ${changedFiles}`,
    `Mode: tgz (npm release, no rename detection)`,
    FULL_DIFF ? 'Mode: full (no default excludes)' : 'Mode: filtered (default excludes applied)',
    effectiveExcludes.length > 0 ? `Excludes: ${effectiveExcludes.join(', ')}` : 'Excludes: none',
    '',
  ].join('\n');

  fs.writeFileSync(outputFile, header + diffContent, 'utf-8');
  ok(`diff 文件已生成: ${outputFile}`);

  // ── 5b. 生成变更摘要 summary.md ───────────────────────
  const summaryFile = path.join(OUTPUT_DIR, `summary_${fileBranch1}_${fileBranch2}.md`);
  info('生成变更摘要...');
  try {
    const summaryContent = generateSummaryWithFs(branch1Dir, branch2Dir, effectiveExcludes, meta);
    fs.writeFileSync(summaryFile, summaryContent, 'utf-8');
    ok(`变更摘要已生成: ${summaryFile}`);
  } catch (err) {
    warn(`生成变更摘要失败: ${err.message}`);
  }

  // ── 5c. 生成适配分析报告 structure.md ─────────────────
  const structureFile = path.join(OUTPUT_DIR, `structure_${fileBranch1}_${fileBranch2}.md`);
  info('生成适配分析报告 (接口驱动)...');
  let structureStats = null;
  let apiDiffResult = null;
  let scanResult = null;
  try {
    scanResult = generateStructureSummaryTgz(branch1Dir, branch2Dir, EXCLUDES, meta, branch1Dir, branch2Dir);
    fs.writeFileSync(structureFile, scanResult.content, 'utf-8');
    structureStats = scanResult.stats;
    apiDiffResult = scanResult.apiDiff;
    ok(`适配分析报告已生成: ${structureFile}`);

    if (apiDiffResult) {
      console.log('');
      if (apiDiffResult.summary.needsNativeAdaptation) {
        info('⚠️ 需要原生适配 — 接口或 TurboModule Spec 发生变更');
      } else {
        info('✅ 无需原生适配 — 接口未变更, 仅需合并 JS + codegen');
      }
    }

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

  // ── 5d. 生成接口差异适配检查清单 api-diff.md ──────────
  const apiDiffFile = path.join(OUTPUT_DIR, `api-diff_${fileBranch1}_${fileBranch2}.md`);
  if (apiDiffResult && scanResult && scanResult.scan1 && scanResult.scan2) {
    info('生成接口差异适配检查清单...');
    try {
      const apiReport = scanExports.generateMarkdownReport(scanResult.scan1, scanResult.scan2, apiDiffResult, {
        version1: version1Label,
        version2: version2Label,
        repoUrl: `npm:${NPM_PACKAGE}`,
      });
      fs.writeFileSync(apiDiffFile, apiReport, 'utf-8');
      ok(`接口差异检查清单已生成: ${apiDiffFile}`);
    } catch (err) {
      warn(`生成接口差异检查清单失败: ${err.message}`);
    }
  }
  console.log('');

  // ── 6. 显示摘要 ────────────────────────────────────────
  const fileSize = fs.statSync(outputFile).size;

  console.log('==========================================');
  console.log('  对比完成 (tgz 模式)');
  console.log('==========================================');
  console.log(`  包名:     ${NPM_PACKAGE}`);
  console.log(`  版本 1:   ${version1Label}`);
  console.log(`  版本 2:   ${version2Label}`);
  console.log(`  变更文件: ${changedFiles}`);
  console.log(`  模式:     ${FULL_DIFF ? '完整 diff (--full)' : '聚焦核心代码 (默认排除噪音)'}`);
  console.log('');
  console.log(`  输出目录:   ${OUTPUT_DIR}/`);
  console.log(`  ├── ${fileBranch1}/                              (版本1 源代码)`);
  console.log(`  ├── ${fileBranch2}/                              (版本2 源代码)`);
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

  // ── 7. 清理临时目录 ────────────────────────────────────
  fs.rmSync(workDir, { recursive: true, force: true });
  debug(`已清理临时目录: ${workDir}`);
}

main();
