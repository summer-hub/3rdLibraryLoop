#!/usr/bin/env node
/**
 * generate-diff.js
 *
 * 从同一 Git 仓库的两个分支/tag 中生成对比 diff 文件 (.patch)。
 *
 * 默认聚焦三方库核心代码变更, 自动排除 lock 文件、example/、CI 配置、文档等
 * 与鸿蒙化升级排查无关的噪音文件。使用 --full 可生成包含所有变更的完整 diff。
 *
 * 默认在当前目录下创建 diff/ 文件夹，其中包含:
 *   - 两个分支的源代码目录 (<branch1>/ 和 <branch2>/)
 *   - 对比 diff 文件 (diff_<branch1>_<branch2>.patch)
 *   - 变更摘要文件 (summary_<branch1>_<branch2>.md)
 *
 * 输出结构:
 *   diff/
 *   ├── <branch1>/                          (分支1 源代码, 无 .git)
 *   ├── <branch2>/                          (分支2 源代码, 无 .git)
 *   ├── diff_<b1>_<b2>.patch                (对比 diff 文件)
 *   └── summary_<b1>_<b2>.md                (变更摘要, 按文件统计增删行数)
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
 *   # 指定输出目录 (替代默认的 ./diff)
 *   node generate-diff.js \
 *     --repo https://github.com/lottie-react-native/lottie-react-native \
 *     --branch1 v7.2.2 \
 *     --branch2 v7.4.0 \
 *     --output-dir /tmp/my-diffs
 *
 *   # 保留克隆的仓库 (用于调试)
 *   node generate-diff.js \
 *     --repo https://github.com/lottie-react-native/lottie-react-native \
 *     --branch1 v7.2.2 \
 *     --branch2 v7.4.0 \
 *     --keep-repo
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

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

输出结构:
  diff/
  ├── <branch1>/                          (分支1 源代码, 无 .git)
  ├── <branch2>/                          (分支2 源代码, 无 .git)
  ├── diff_<b1>_<b2>.patch                (对比 diff 文件)
  └── summary_<b1>_<b2>.md                (变更摘要, 按文件统计增删行数)

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
  --keep-repo            保留克隆的仓库 (默认生成后自动删除)
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
`);
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--repo':         REPO_URL = args[i + 1]; i += 2; break;
      case '--branch1':      BRANCH1 = args[i + 1]; i += 2; break;
      case '--branch2':      BRANCH2 = args[i + 1]; i += 2; break;
      case '--output-dir':   OUTPUT_DIR = args[i + 1]; i += 2; break;
      case '--exclude':      EXCLUDES.push(args[i + 1]); i += 2; break;
      case '--full':         FULL_DIFF = true; i += 1; break;
      case '--keep-repo':    KEEP_REPO = true; i += 1; break;
      case '--verbose':      VERBOSE = true; i += 1; break;
      case '--help':
      case '-h':             usage(); break;
      default:               error(`未知参数: ${args[i]} (使用 --help 查看用法)`);
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
  // 获取 --stat 输出 (含每个文件的增删行数)
  const statArgs = ['diff', '--numstat', ref1, ref2];
  statArgs.push(...buildPathspecArgs(excludePatterns));

  let statOutput = '';
  try {
    statOutput = git(statArgs, { cwd: repoDir, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
  } catch { /* ignore */ }

  // 解析 numstat: 每行格式 "<added>\t<deleted>\t<filepath>"
  // 新增文件: added=行数, deleted=0; 删除文件: added=0, deleted=行数; 二进制: -
  const files = [];
  let totalAdded = 0;
  let totalDeleted = 0;

  if (statOutput) {
    for (const line of statOutput.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      const filepath = parts.slice(2).join('\t');
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

  // ── 4. 生成 diff ───────────────────────────────────────
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

  // 构建 git diff 参数 (含排除 pathspec)
  const diffArgs = ['diff', ref1, ref2, ...buildPathspecArgs(effectiveExcludes)];

  // 统计变更文件数
  let changedFiles = 0;
  try {
    const nameOnlyArgs = ['diff', '--name-only', ref1, ref2, ...buildPathspecArgs(effectiveExcludes)];
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
  console.log(`  模式:     ${FULL_DIFF ? '完整 diff (--full)' : '聚焦核心代码 (默认排除噪音)'}`);
  console.log('');
  console.log(`  输出目录:   ${OUTPUT_DIR}/`);
  console.log(`  ├── ${fileBranch1}/                              (分支1 源代码)`);
  console.log(`  ├── ${fileBranch2}/                              (分支2 源代码)`);
  console.log(`  ├── diff_${fileBranch1}_${fileBranch2}.patch              (${formatSize(fileSize)})`);
  console.log(`  └── summary_${fileBranch1}_${fileBranch2}.md               (变更摘要)`);
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
