#!/usr/bin/env node
/**
 * libraryTestScan.js — 三方库接口/Demo/XTS 覆盖率扫描统一入口
 *
 * 在线依赖 gitcode 仓库 lalhanOrz/3rdLibraryLoop 下的 12 个 cjs 分析脚本，
 * 运行时按需下载到本地缓存目录（保持相对 require 依赖可解析），以子进程方式
 * 调用对应脚本，实现对 ArkTS / React Native / Flutter 三类库的：
 *   - api  : 接口规格说明书生成（render-spec-doc）
 *   - xts  : XTS / 测试用例覆盖率分析（analyze-xts-coverage / analyze-test-coverage）
 *   - demo : Demo 覆盖率分析（analyze-demo-coverage）
 *
 * 用法:
 *   node libraryTestScan.js <platform> <scanType> --libroot <库路径> --output <文档路径>
 *                          [--title <标题>] [--lib <库名>]
 *
 * 参数:
 *   platform   : arkts | rn | flutter          三方库类型
 *   scanType   : api | xts | demo              扫描类型（接口文档 / 测试覆盖 / Demo 覆盖）
 *   --libroot  : 库源码根目录路径 或 gitcode URL（必填）
 *                本地路径: /path/to/lib
 *                gitcode URL: https://gitcode.com/{owner}/{repo}/tree/{branch}[/{subdir}]
 *                URL 支持指定分支和子文件夹（子文件夹走 sparse checkout 浅拷贝）
 *   --output   : 输出 Markdown 文档路径（必填）
 *   --title    : （可选）报告标题覆盖
 *   --lib      : （可选）库名覆盖
 *   --help / -h: 打印帮助
 *
 * 平台 × 扫描类型 映射:
 *   ┌──────────┬───────────────────────────────────┬─────────────────────────────────────┐
 *   │ 平台     │ api                               │ xts                                 │ demo                            │
 *   ├──────────┼───────────────────────────────────┼─────────────────────────────────────┤
 *   │ arkts    │ render-spec-doc.cjs               │ analyze-xts-coverage.cjs            │ analyze-demo-coverage.cjs       │
 *   │ flutter  │ flutter-render-spec-doc.cjs       │ flutter-analyze-xts-coverage.cjs    │ flutter-analyze-demo-coverage.cjs │
 *   │ rn       │ rn-render-spec-doc.cjs            │ rn-analyze-test-coverage.cjs        │ rn-analyze-demo-coverage.cjs    │
 *   └──────────┴───────────────────────────────────┴─────────────────────────────────────┘
 *
 * 在线源（gitcode）:
 *   https://gitcode.com/lalhanOrz/3rdLibraryLoop/tree/main/MCP/scripts
 *   原始内容下载走 api/v5 端点（避开 raw 端点的 WAF 预览限制）:
 *   https://gitcode.com/api/v5/repos/lalhanOrz/3rdLibraryLoop/raw/MCP/scripts/<file>?ref=main
 *
 * 使用示例:
 *   # ArkTS 接口规格说明书
 *   node libraryTestScan.js arkts api --libroot /path/to/lottie_turbo --output 01-lottie-接口规格说明书.md
 *
 *   # ArkTS Demo 覆盖率
 *   node libraryTestScan.js arkts demo --libroot /path/to/lottie_turbo --output 02-lottie-Demo覆盖率报告.md
 *
 *   # ArkTS XTS 覆盖率
 *   node libraryTestScan.js arkts xts --libroot /path/to/lottie_turbo --output 03-lottie-XTS覆盖率报告.md
 *
 *   # RN 测试覆盖率（xts 类型对 rn 映射为 test 覆盖率）
 *   node libraryTestScan.js rn xts --libroot /path/to/rn_lib --output 03-rn-Test覆盖率报告.md
 *
 *   # Flutter 接口规格说明书
 *   node libraryTestScan.js flutter api --libroot /path/to/flutter_lib --output 01-flutter-接口规格说明书.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── 仓库与下载配置 ──────────────────────────────────────────
const REPO_OWNER = 'lalhanOrz';
const REPO_NAME = '3rdLibraryLoop';
const SCRIPTS_SUBDIR = 'MCP/scripts';
const SCRIPTS_REPO_URL = `https://gitcode.com/${REPO_OWNER}/${REPO_NAME}.git`;
const SCRIPTS_REPO_BRANCH = 'main';
const CACHE_DIR = path.join(__dirname, '.libraryTestScan-cache');

// ── 平台 × 扫描类型 → 脚本映射 ───────────────────────────────
// main: 直接执行的脚本；deps: main 通过相对 require 依赖的脚本（需一并缓存）
const SCRIPT_MAP = {
  arkts: {
    api:  { main: 'render-spec-doc.cjs',        deps: ['extract-interfaces.cjs'] },
    xts:  { main: 'analyze-xts-coverage.cjs',   deps: ['extract-interfaces.cjs'] },
    demo: { main: 'analyze-demo-coverage.cjs',  deps: ['extract-interfaces.cjs'] },
  },
  flutter: {
    api:  { main: 'flutter-render-spec-doc.cjs',        deps: ['flutter-extract-interfaces.cjs'] },
    xts:  { main: 'flutter-analyze-xts-coverage.cjs',   deps: ['flutter-extract-interfaces.cjs'] },
    demo: { main: 'flutter-analyze-demo-coverage.cjs',  deps: ['flutter-extract-interfaces.cjs'] },
  },
  rn: {
    api:  { main: 'rn-render-spec-doc.cjs',        deps: ['rn-extract-interfaces.cjs'] },
    // rn 没有 XTS 概念，xts 类型映射为 test 覆盖率分析
    xts:  { main: 'rn-analyze-test-coverage.cjs',  deps: ['rn-extract-interfaces.cjs'] },
    demo: { main: 'rn-analyze-demo-coverage.cjs',  deps: ['rn-extract-interfaces.cjs'] },
  },
};

// 允许透传给下游脚本的 flag 白名单（避免误传本工具内部 flag）
const PASSTHROUGH_FLAGS = ['title', 'lib', 'spec'];

// ── 日志工具 ────────────────────────────────────────────────
const C = {
  BLUE: '\x1b[0;34m', GREEN: '\x1b[0;32m', YELLOW: '\x1b[1;33m',
  RED: '\x1b[0;31m', CYAN: '\x1b[0;36m', NC: '\x1b[0m',
};
const log = {
  info: (m) => console.log(`${C.BLUE}[INFO]${C.NC} ${m}`),
  ok:   (m) => console.log(`${C.GREEN}[OK]${C.NC} ${m}`),
  warn: (m) => console.log(`${C.YELLOW}[WARN]${C.NC} ${m}`),
  err:  (m) => console.error(`${C.RED}[ERROR]${C.NC} ${m}`),
};

// ── 参数解析 ────────────────────────────────────────────────

/**
 * 解析 CLI 参数：位置参数（platform scanType） + --flag value
 * @param {string[]} argv
 * @returns {{ positional: string[], flags: Object }}
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ── 脚本仓库克隆（git clone + sparse checkout）──────────────────

/**
 * 浅拷贝脚本仓库的 MCP/scripts 子目录到 CACHE_DIR
 *
 * 使用非 cone 模式的 sparse checkout，精确匹配 /MCP/scripts/ 路径，
 * 只拉取 scripts 目录内容，不拉取 MCP/ 下的其他文件（AGENTS.md 等）。
 * git 协议不受 gitcode API 匿名限流影响，无需 token。
 *
 * @returns {string} 脚本目录路径（CACHE_DIR/MCP/scripts）
 */
function cloneScriptsRepo() {
  rmrf(CACHE_DIR);
  fs.mkdirSync(path.dirname(CACHE_DIR), { recursive: true });

  log.info(`git clone --depth 1 --branch ${SCRIPTS_REPO_BRANCH} --no-checkout (sparse: ${SCRIPTS_SUBDIR})`);
  const clone = spawnSync('git', [
    'clone', '--depth', '1', '--branch', SCRIPTS_REPO_BRANCH, '--no-checkout',
    SCRIPTS_REPO_URL, CACHE_DIR,
  ], { stdio: 'inherit' });
  if (clone.status !== 0) {
    throw new Error(`git clone 脚本仓库失败（分支 ${SCRIPTS_REPO_BRANCH}），退出码 ${clone.status}`);
  }

  // 非 cone 模式：精确匹配 /MCP/scripts/ 路径，只拉取该子目录
  spawnSync('git', ['-C', CACHE_DIR, 'sparse-checkout', 'init', '--no-cone'], { stdio: 'inherit' });
  // 直接写入 sparse-checkout 模式文件（非 cone 模式按路径模式匹配）
  const sparseFile = path.join(CACHE_DIR, '.git', 'info', 'sparse-checkout');
  fs.writeFileSync(sparseFile, `/${SCRIPTS_SUBDIR}/\n`);
  const co = spawnSync('git', ['-C', CACHE_DIR, 'checkout', SCRIPTS_REPO_BRANCH], { stdio: 'inherit' });
  if (co.status !== 0) {
    throw new Error(`git checkout 脚本仓库失败（分支 ${SCRIPTS_REPO_BRANCH}），退出码 ${co.status}`);
  }

  const scriptsDir = path.join(CACHE_DIR, SCRIPTS_SUBDIR);
  if (!fs.existsSync(scriptsDir)) {
    throw new Error(`脚本目录不存在: ${scriptsDir}`);
  }
  const cjsFiles = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.cjs'));
  log.ok(`脚本已就绪: ${scriptsDir} (${cjsFiles.length} 个 cjs)`);
  return scriptsDir;
}

// ── TypeScript 模块定位（arkts 脚本依赖 typescript）──────────

/**
 * 从若干种子目录向上查找 node_modules/typescript，返回 node_modules 目录
 * 找不到返回 null（flutter/rn 不依赖 TS 时可忽略）
 * @param {string[]} seeds
 * @returns {string|null}
 */
function findTypeScriptNodeModules(seeds) {
  // 先尝试 require.resolve（若全局或当前路径可见）
  try {
    const resolved = require.resolve('typescript');
    // resolved 形如 .../node_modules/typescript/lib/typescript.js
    const nm = path.join(path.dirname(resolved), '..', '..');
    if (fs.existsSync(path.join(nm, 'typescript', 'package.json'))) return nm;
  } catch (_) { /* fallthrough */ }

  for (const seed of seeds) {
    let dir = seed;
    for (let i = 0; i < 12 && dir; i++) {
      const tsPkg = path.join(dir, 'node_modules', 'typescript', 'package.json');
      if (fs.existsSync(tsPkg)) {
        return path.join(dir, 'node_modules');
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

// ── Git 仓库克隆（支持 gitcode URL 含分支 + 子文件夹）─────────

const REPOS_DIR = path.join(__dirname, '.libraryTestScan-repos');

/**
 * 判断输入是否为 gitcode git URL
 * 支持两种形式:
 *   https://gitcode.com/{owner}/{repo}                          ← 裸仓库 URL（克隆默认分支）
 *   https://gitcode.com/{owner}/{repo}/tree/{branch}[/{subdir}] ← 指定分支/子目录
 * @param {string} str
 * @returns {boolean}
 */
function isGitUrl(str) {
  return /^https?:\/\/gitcode\.com\/[^/]+\/[^/]+(\/tree\/.+)?$/.test(str);
}

/**
 * 解析 gitcode URL，提取 owner/repo 和 tree 后的路径段
 *   https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.82
 *   https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.82/harmony
 *   https://gitcode.com/CPF-ApplicationTPC/ohos_mqtt              ← 裸仓库 URL（parts=[]）
 * @param {string} url
 * @returns {{owner:string, repo:string, parts:string[], cloneUrl:string}}
 *          parts 为空数组表示未指定分支，由调用方探测默认分支
 */
function parseGitcodeUrl(url) {
  const m = url.match(/^https?:\/\/gitcode\.com\/([^/]+)\/([^/]+)(?:\/tree\/(.+))?$/);
  if (!m) throw new Error(`无法解析 gitcode URL: ${url}`);
  const [, owner, repo, refPath] = m;
  // 去掉 query/hash，按 / 切分路径段（裸仓库 URL 时 refPath 为 undefined → parts=[]）
  const parts = refPath ? refPath.split(/[?#]/)[0].split('/').filter(Boolean) : [];
  return { owner, repo, parts, cloneUrl: `https://gitcode.com/${owner}/${repo}.git` };
}

/**
 * 用 git ls-remote 确定分支边界（分支名可能含 /，需逐段试探）
 * 从最长 ref 到最短 ref 尝试，第一个 ls-remote 有输出的即为真实分支
 * @param {string} cloneUrl
 * @param {string[]} parts  tree 后的路径段
 * @returns {{ref:string, subdir:string}}  ref=分支名, subdir=子文件夹（空字符串表示整个仓库）
 */
function resolveRefAndSubdir(cloneUrl, parts) {
  for (let i = parts.length; i >= 1; i--) {
    const ref = parts.slice(0, i).join('/');
    const result = spawnSync('git', ['ls-remote', cloneUrl, ref], { encoding: 'utf-8' });
    if (result.status === 0 && result.stdout.trim()) {
      return { ref, subdir: parts.slice(i).join('/') };
    }
  }
  // 兜底：第一段当 ref
  return { ref: parts[0], subdir: parts.slice(1).join('/') };
}

/**
 * 用 git ls-remote --symref 探测仓库默认分支（HEAD 指向的分支）
 * 用于裸仓库 URL（未指定 /tree/{branch}）的情况
 * @param {string} cloneUrl
 * @returns {string} 默认分支名（如 master / main）
 */
function detectDefaultBranch(cloneUrl) {
  const result = spawnSync('git', ['ls-remote', '--symref', cloneUrl, 'HEAD'], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`无法探测默认分支: ${result.stderr || result.stdout || 'git ls-remote 失败'}`);
  }
  // 输出形如: ref: refs/heads/master\tHEAD
  const m = result.stdout.match(/ref:\s+refs\/heads\/(\S+)/);
  if (m) return m[1];
  // 兜底：无法解析 symref 时用 HEAD 作为 ref（浅拷贝仍可工作，但 dest 命名会用 HEAD）
  log.warn('无法解析默认分支名，将使用 HEAD 作为 ref');
  return 'HEAD';
}

/**
 * 删除目录（含 .git，需强制删除只读文件）
 * @param {string} dir
 */
function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * 克隆仓库到本地（浅拷贝 + 子文件夹 sparse checkout）
 * @param {string} cloneUrl
 * @param {string} ref      分支名
 * @param {string} subdir   子文件夹（空字符串=整个仓库）
 * @param {string} dest     目标目录
 * @returns {string} 实际 libroot 路径（dest 或 dest/subdir）
 */
function cloneRepo(cloneUrl, ref, subdir, dest) {
  rmrf(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (subdir) {
    // 子文件夹：--no-checkout + sparse-checkout
    log.info(`git clone --depth 1 --branch ${ref} --no-checkout (sparse: ${subdir})`);
    const clone = spawnSync('git', [
      'clone', '--depth', '1', '--branch', ref, '--no-checkout', cloneUrl, dest,
    ], { stdio: 'inherit' });
    if (clone.status !== 0) {
      throw new Error(`git clone 失败（分支 ${ref}），退出码 ${clone.status}`);
    }
    const sp1 = spawnSync('git', ['-C', dest, 'sparse-checkout', 'init', '--cone'], { stdio: 'inherit' });
    const sp2 = spawnSync('git', ['-C', dest, 'sparse-checkout', 'set', subdir], { stdio: 'inherit' });
    const co = spawnSync('git', ['-C', dest, 'checkout', ref], { stdio: 'inherit' });
    if (co.status !== 0) {
      throw new Error(`git checkout 失败（分支 ${ref}），退出码 ${co.status}`);
    }
    return path.join(dest, subdir);
  }

  // 整个仓库浅拷贝
  log.info(`git clone --depth 1 --branch ${ref}`);
  const clone = spawnSync('git', [
    'clone', '--depth', '1', '--branch', ref, cloneUrl, dest,
  ], { stdio: 'inherit' });
  if (clone.status !== 0) {
    throw new Error(`git clone 失败（分支 ${ref}），退出码 ${clone.status}`);
  }
  return dest;
}

/**
 * 从 gitcode URL 下载仓库并返回本地 libroot 路径
 * @param {string} url
 * @returns {string} 本地 libroot 路径
 */
function cloneFromGitUrl(url) {
  const { owner, repo, parts, cloneUrl } = parseGitcodeUrl(url);
  let ref, subdir;
  if (parts.length === 0) {
    // 裸仓库 URL（未指定 /tree/{branch}）：探测默认分支，克隆整个仓库
    ref = detectDefaultBranch(cloneUrl);
    subdir = '';
    log.info(`仓库: ${owner}/${repo} | 未指定分支，使用默认分支: ${ref}`);
  } else {
    ({ ref, subdir } = resolveRefAndSubdir(cloneUrl, parts));
    log.info(`仓库: ${owner}/${repo} | 分支: ${ref}${subdir ? ` | 子目录: ${subdir}` : ''}`);
  }
  // dest 命名：{repo}-{ref中/替换为-}
  const refSafe = ref.replace(/[^A-Za-z0-9._-]/g, '-');
  const dest = path.join(REPOS_DIR, `${repo}-${refSafe}`);
  const libroot = cloneRepo(cloneUrl, ref, subdir, dest);
  if (!fs.existsSync(libroot)) {
    throw new Error(`克隆后目标路径不存在: ${libroot}`);
  }
  log.ok(`仓库已就绪: ${libroot}`);
  return libroot;
}

// ── 子进程执行 ────────────────────────────────────────────────

/**
 * 以子进程方式执行缓存的 cjs 脚本，stdio 继承（实时输出进度）
 * @param {string} scriptPath
 * @param {string} libroot 绝对路径
 * @param {string} output  绝对路径
 * @param {Object} extraFlags 透传 flag
 * @param {Object} env 环境变量
 * @returns {number} 退出码
 */
function runScript(scriptPath, libroot, output, extraFlags, env) {
  const args = [scriptPath, '--libroot', libroot, '--output', output];
  for (const key of PASSTHROUGH_FLAGS) {
    if (extraFlags[key] !== undefined && extraFlags[key] !== false) {
      args.push(`--${key}`, String(extraFlags[key]));
    }
  }
  log.info(`执行: node ${path.basename(scriptPath)} --libroot ${libroot} --output ${output}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.error) {
    log.err(`子进程启动失败: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 0;
}

// ── 帮助 ────────────────────────────────────────────────────

function printHelp() {
  const help = [
    'libraryTestScan.js — 三方库接口/Demo/XTS 覆盖率扫描统一入口',
    '',
    '用法:',
    '  node libraryTestScan.js <platform> <scanType> --libroot <库路径> --output <文档路径>',
    '                        [--title <标题>] [--lib <库名>]',
    '',
    '位置参数:',
    '  platform : arkts | rn | flutter          三方库类型',
    '  scanType : api | xts | demo              扫描类型',
    '             api  → 接口规格说明书',
    '             xts  → XTS/测试覆盖率（rn 映射为 test 覆盖率）',
    '             demo → Demo 覆盖率',
    '',
    '必填选项:',
    '  --libroot <path|url>  库源码根目录路径 或 gitcode URL',
    '                        本地: /path/to/lib',
    '                        URL:  https://gitcode.com/{owner}/{repo}/tree/{branch}[/{subdir}]',
    '                        URL 支持指定分支和子文件夹（子文件夹走 sparse checkout 浅拷贝）',
    '  --output  <path>      输出 Markdown 文档路径',
    '',
    '可选选项:',
    '  --title <t>        报告标题覆盖',
    '  --lib <name>       库名覆盖',
    '  --help, -h         打印本帮助',
    '',
    '映射表:',
    '  arkts   api → render-spec-doc.cjs            xts → analyze-xts-coverage.cjs     demo → analyze-demo-coverage.cjs',
    '  flutter api → flutter-render-spec-doc.cjs    xts → flutter-analyze-xts-coverage.cjs  demo → flutter-analyze-demo-coverage.cjs',
    '  rn      api → rn-render-spec-doc.cjs         xts → rn-analyze-test-coverage.cjs    demo → rn-analyze-demo-coverage.cjs',
    '',
    '示例:',
    '  node libraryTestScan.js arkts api --libroot ./libs/lottie_turbo --output 01-lottie-接口规格说明书.md',
    '  node libraryTestScan.js arkts demo --libroot ./libs/lottie_turbo --output 02-lottie-Demo覆盖率报告.md',
    '  node libraryTestScan.js flutter xts --libroot ./libs/advertising_id --output 03-advertising-XTS覆盖率报告.md',
    '  node libraryTestScan.js rn xts --libroot ./libs/rn_netinfo --output 03-netinfo-Test覆盖率报告.md',
    '',
    '  # gitcode URL（整个仓库，指定分支）',
    '  node libraryTestScan.js rn api --libroot https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.82 --output 01-lottie-rn-接口规格说明书.md',
    '',
    '  # gitcode URL（仅 harmony 子文件夹，sparse checkout 浅拷贝）',
    '  node libraryTestScan.js rn api --libroot https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.82/harmony --output 01-lottie-rn-接口规格说明书.md',
  ];
  console.log(help.join('\n'));
}

// ── 主流程 ────────────────────────────────────────────────────

(() => {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h) {
    printHelp();
    process.exit(0);
  }

  const platform = positional[0];
  const scanType = positional[1];

  // 参数校验
  if (!platform || !scanType) {
    log.err('缺少位置参数 <platform> <scanType>。使用 --help 查看用法。');
    process.exit(1);
  }
  if (!SCRIPT_MAP[platform]) {
    log.err(`不支持的 platform: ${platform}（可选 arkts | rn | flutter）`);
    process.exit(1);
  }
  if (!SCRIPT_MAP[platform][scanType]) {
    log.err(`不支持的 scanType: ${scanType}（可选 api | xts | demo）`);
    process.exit(1);
  }

  const librootRaw = flags.libroot;
  const outputRaw = flags.output;
  if (!librootRaw) {
    log.err('--libroot 为必填项。使用 --help 查看用法。');
    process.exit(1);
  }
  if (!outputRaw) {
    log.err('--output 为必填项。使用 --help 查看用法。');
    process.exit(1);
  }

  // 解析 libroot：本地目录或 gitcode URL
  let libroot;
  if (isGitUrl(librootRaw)) {
    log.info(`--libroot 为 gitcode URL，开始克隆仓库...`);
    try {
      libroot = cloneFromGitUrl(librootRaw);
    } catch (e) {
      log.err(`仓库克隆失败: ${e.message}`);
      process.exit(1);
    }
  } else {
    libroot = path.resolve(librootRaw);
    if (!fs.existsSync(libroot)) {
      log.err(`库路径不存在: ${libroot}`);
      process.exit(1);
    }
    const libStat = fs.statSync(libroot);
    if (!libStat.isDirectory()) {
      log.err(`库路径不是目录: ${libroot}`);
      process.exit(1);
    }
  }
  const output = path.resolve(outputRaw);

  const mapping = SCRIPT_MAP[platform][scanType];

  // 1. 每次都从线上克隆最新脚本仓库（git clone + sparse checkout，无需 token）
  log.info(`平台: ${platform} | 扫描类型: ${scanType} | 主脚本: ${mapping.main}`);
  log.info(`库路径: ${libroot}`);
  log.info(`输出: ${output}`);
  let scriptsDir;
  try {
    scriptsDir = cloneScriptsRepo();
  } catch (e) {
    log.err(`脚本仓库克隆失败: ${e.message}`);
    log.warn('可尝试: 1) 稍后重试 2) 检查 git 是否能访问 gitcode.com');
    process.exit(1);
  }

  // 2. 定位 typescript 模块（arkts/flutter 覆盖率分析需要；缺失仅告警，交由下游脚本自行处理）
  const tsNM = findTypeScriptNodeModules([__dirname, libroot, path.join(__dirname, '..', 'MCP'), path.join(__dirname, '3rdLibraryLoop', 'MCP')]);
  const env = { ...process.env };
  if (tsNM) {
    env.NODE_PATH = tsNM + (env.NODE_PATH ? path.delimiter + env.NODE_PATH : '');
    log.ok(`TypeScript 模块: ${path.join(tsNM, 'typescript')}`);
  } else {
    // 仅 arkts 真正强依赖 TS；flutter/rn 可能不需要
    if (platform === 'arkts') {
      log.warn('未找到 typescript 模块，arkts 分析可能失败。请安装 typescript（npm i -D typescript）或将含 typescript 的 node_modules 置于本脚本上级目录。');
    }
  }

  // 3. 收集透传 flag
  const extra = {};
  for (const k of PASSTHROUGH_FLAGS) {
    if (flags[k] !== undefined && flags[k] !== false) extra[k] = flags[k];
  }

  // 4. 执行下游脚本
  const scriptPath = path.join(scriptsDir, mapping.main);
  const code = runScript(scriptPath, libroot, output, extra, env);

  if (code === 0) {
    log.ok(`完成 ✓  输出文档: ${output}`);
  } else {
    log.err(`下游脚本退出码: ${code}`);
  }
  process.exit(code);
})().catch((e) => {
  log.err(`未捕获异常: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
