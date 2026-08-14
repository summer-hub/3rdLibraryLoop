#!/usr/bin/env node
/**
 * ohpm-switch.cjs — 鸿蒙工程「ohpm 线上版本替换」标准化脚本。
 *
 * 背景：ArkTS 三方库源工程通常以 `file:` 或相对路径依赖本地原生模块
 * （FFmpeg / libyuv / NDK / GN / Ninja 预编译等），在预编译产物缺失或构建链
 * 不完整时 devecocli build 会失败（如 libyuv.a 缺失导致 ninja 报错）。
 * 本脚本将 entry 模块对该库的依赖从本地路径替换为 ohpm 线上发行版本，
 * 绕过源库原生构建问题，并对齐三个 SKILL（DemoCode / XTSCode / XTSExecution）
 * 的「ohpm 线上版本替换」流程。
 *
 * 流程：
 *   1. 扫描工程内所有 oh-package.json5，定位 file: / 相对路径依赖
 *   2. 匹配工程级 build-profile.json5 `modules[]` 中注册的同名本地模块
 *   3. 通过 `ohpm info <pkg>` 查询线上版本列表（或 --version 显式指定）
 *   4. 将 oh-package.json5 中该库依赖值改为线上版本号
 *   5. 从 build-profile.json5 的 modules[] 移除本地模块条目
 *   6. 输出改动清单到 <source>/ohpm-switch-report.json，供 SKILL 报告引用
 *
 * 设计原则：
 *   - 零第三方依赖；JSON5 采用文本级正则 + 括号配对操作（与 migrate.cjs 同风格），
 *     保留原文件注释与尾逗号
 *   - 不修改 @ohos/hypium 等 devDependencies；只处理 file: / 相对路径依赖
 *   - Windows PowerShell 与跨平台兼容（ohpm 调用经 shell，支持 exe/.cmd/.bat）
 *   - 修改保留不回滚，通过 report 文件如实记录改动，供最终报告引用
 *
 * 用法:
 *   node ohpm-switch.cjs --source <工程根> [--pkg <库包名>] [--version <版本号>]
 *                        [--dry-run] [--run-install] [--help]
 *
 *   示例:
 *     node ohpm-switch.cjs --source D:/proj/ohos_ijkplayer --dry-run
 *     node ohpm-switch.cjs --source D:/proj/ohos_ijkplayer --pkg @ohos/ijkplayer --version 2.0.9
 *     node ohpm-switch.cjs --source D:/proj/ohos_ijkplayer --run-install
 *
 * 退出码:
 *   0  成功（或 dry-run 定位完成）
 *   1  参数/环境错误、ohpm 不可用且未指定版本、写入失败
 *   2  未找到可替换的本地 file 依赖，或依赖无对应 ohpm 线上版本
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── 日志（统一 [ohpm-switch] 前缀） ───────────────────────────
const PREFIX = '[ohpm-switch]';

function info(msg) {
  console.log(`${PREFIX} ${msg}`);
}

function ok(msg) {
  console.log(`${PREFIX} [OK] ${msg}`);
}

function warn(msg) {
  console.log(`${PREFIX} [WARN] ${msg}`);
}

function error(msg) {
  console.error(`${PREFIX} [ERROR] ${msg}`);
}

// ── 工具函数 ────────────────────────────────────────────────

/**
 * 解析 --key value 形式的命令行参数；--flag 形式的布尔参数值为 true。
 * @returns {Record<string, string|true>}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        parsed[key] = args[i + 1];
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

/**
 * 读取文件文本，文件不存在返回 null。
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 转义正则中的特殊字符。
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从指定起始索引查找配对的闭合括号位置。
 * @param {string} text
 * @param {number} openIdx 起始括号的索引
 * @param {string} openChar 左括号字符
 * @param {string} closeChar 右括号字符
 * @returns {number} 配对右括号索引；未找到返回 -1
 */
function findMatchingBracket(text, openIdx, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let quoteChar = '';
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quoteChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quoteChar = ch; continue; }
    if (ch === openChar) { depth++; continue; }
    if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 去除 JSON5 字符串值两端的引号。
 * @param {string} str
 * @returns {string}
 */
function unquote(str) {
  const s = str.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 在对象文本中查找指定 key 的简单字符串/数字值。
 * @param {string} objText 对象片段（不含外层 {}）
 * @param {string} key
 * @returns {string|null}
 */
function getFieldValueFrom(objText, key) {
  const escaped = escapeRegExp(key);
  const re = new RegExp(
    `["']?${escaped}["']?\\s*:\\s*("([^"\\\\]|\\\\.)*"|'([^'\\\\]|\\\\.)*'|[0-9]+|true|false|null)`
  );
  const m = re.exec(objText);
  if (!m) return null;
  return m[1];
}

// ── 工程扫描 ────────────────────────────────────────────────

/**
 * 从 build-profile.json5 文本中提取 modules[] 数组内的所有模块对象。
 * 支持 JSON5 中键带引号或不带引号两种写法。
 * @param {string} content
 * @returns {Array<{name: string, srcPath: string, rawStart: number, rawEnd: number}>}
 */
function extractModules(content) {
  const match = content.match(/(?:^|[,{:])[ \t]*(?:"modules"|'modules'|modules)[ \t]*:[ \t]*\[/m);
  if (!match) return [];
  const arrStart = match.index + match[0].lastIndexOf('['); // 指向 [
  const arrEnd = findMatchingBracket(content, arrStart, '[', ']');
  if (arrEnd === -1) return [];

  const arrContent = content.slice(arrStart + 1, arrEnd);
  const result = [];
  let i = 0;
  while (i < arrContent.length) {
    if (arrContent[i] === '{') {
      const objEnd = findMatchingBracket(arrContent, i, '{', '}');
      if (objEnd === -1) break;
      const objStr = arrContent.slice(i + 1, objEnd);
      const nameRaw = getFieldValueFrom(objStr, 'name');
      const srcPathRaw = getFieldValueFrom(objStr, 'srcPath');
      result.push({
        name: nameRaw ? unquote(nameRaw) : '',
        srcPath: srcPathRaw ? unquote(srcPathRaw) : '',
        absStart: arrStart + 1 + i,
        absEnd: arrStart + 1 + objEnd,
      });
      i = objEnd + 1;
    } else {
      i++;
    }
  }
  return result;
}

/**
 * 提取 JSON5 对象文本中全部 key: string-value 对。
 * @param {string} objText 对象片段（不含外层 {}）
 * @returns {Array<{key: string, value: string}>} 去引号后的键值
 */
function extractKeyValuePairs(objText) {
  const pairs = [];
  const re = /("([^"\\]|\\.)*"|'([^'\\]|\\.)*')\s*:\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/g;
  let m;
  while ((m = re.exec(objText)) !== null) {
    pairs.push({ key: unquote(m[1]), value: unquote(m[4]) });
  }
  return pairs;
}

/**
 * 提取对象文本中指定顶层字段（如 dependencies）的对象内部内容。
 * 支持字段键带引号或不带引号写法。
 * @param {string} content
 * @param {string} field 字段名（如 dependencies / devDependencies）
 * @returns {string|null} 找到返回内部文本（不含外层 {}），否则 null
 */
function getObjectBody(content, field) {
  const re = new RegExp(`(?:"${escapeRegExp(field)}"|'${escapeRegExp(field)}'|${escapeRegExp(field)})\\s*:\\s*\\{`);
  const m = re.exec(content);
  if (!m) return null;
  const bodyStart = m.index + m[0].lastIndexOf('{'); // 指向 {
  const bodyEnd = findMatchingBracket(content, bodyStart, '{', '}');
  if (bodyEnd === -1) return null;
  return content.slice(bodyStart + 1, bodyEnd);
}

/**
 * 递归扫描工程目录树内所有 oh-package.json5，定位 file:/相对路径依赖。
 * 跳过 dependencies/oh_modules/node_modules/.git/build 等目录，避免进入依赖产物目录。
 * @param {string} projectRoot
 * @returns {Array<{pkgFile: string, section: string, depKey: string, depValue: string}>}
 */
function scanFileDeps(projectRoot) {
  const IGNORE_DIRS = new Set([
    'oh_modules', 'node_modules', '.git', 'build',
    'default', 'intermediates', '.idea', '.hvigor', '.cxx',
  ]);
  const pkgFiles = [];

  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.name === 'oh-package.json5') {
        pkgFiles.push(full);
      }
    }
  })(projectRoot);

  const results = [];
  for (const pkgFile of pkgFiles) {
    const content = readFileSafe(pkgFile);
    if (!content) continue;

    for (const section of ['dependencies', 'devDependencies']) {
      const body = getObjectBody(content, section);
      if (body === null) continue;
      for (const { key, value } of extractKeyValuePairs(body)) {
        const v = value.trim();
        // 排除编译产物/NAPI types 伪依赖（如 "libijkplayer_audio_napi.so": "file:./src/main/cpp/types/..."）
        // 这类依赖是库打包后的二进制映射，无法通过 ohpm 线上安装，替换会破坏构建
        if (/\.(so|aar|har)$/i.test(key)) continue;
        // 命中 file: 或相对路径（../ ./ ..\ 等）
        if (/^(file:|\.\.?[\\/])/i.test(v)) {
          results.push({
            pkgFile,
            section,
            depKey: key,
            depValue: v,
          });
        }
      }
    }
  }
  return results;
}

/**
 * 匹配 file 依赖与 build-profile.json5 modules[] 中的本地模块。
 * 依赖键 @ohos/ijkplayer 与本地模块 name=ijkplayer / srcPath=./ijkplayer 匹配规则：
 *   - 精确匹配
 *   - 去掉 scope（@ohos/ 等）后与模块 name 匹配
 *   - 依赖键以 "/<模块name>" 结尾
 *   - srcPath 文件目录名与依赖键去 scope 后匹配
 * @param {string} depKey
 * @param {Array<{name: string, srcPath: string}>} modules
 * @returns {{name: string, srcPath: string}|null}
 */
function matchModuleForDep(depKey, modules) {
  const normalized = depKey.replace(/^@[^/]+\//, '');
  for (const mod of modules) {
    const srcName = mod.srcPath ? mod.srcPath.split(/[\\/]+/).filter(Boolean).pop() : '';
    if (mod.name && mod.name === normalized) return mod;
    if (mod.name && depKey.endsWith('/' + mod.name)) return mod;
    if (mod.name && normalized === srcName && srcName) return mod;
    if (srcName && srcName === normalized) return mod;
    if (mod.name && normalized.includes(mod.name)) return mod;
  }
  return null;
}

// ── ohpm 查询 ───────────────────────────────────────────────

/**
 * 探测 ohpm 是否可用。Windows 下经 shell 以兼容 ohpm.cmd/ohpm.bat。
 * @returns {string|null} ohpm 版本字符串；不可用返回 null
 */
function checkOhpm() {
  try {
    const out = execFileSync('ohpm', ['--version'], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
      timeout: 30000,
    });
    const lines = out.split(/\r?\n/).filter((l) => l.trim());
    return lines.length > 0 ? lines[lines.length - 1].trim() : 'unknown';
  } catch {
    return null;
  }
}

/**
 * 执行 `ohpm info <pkg>` 查询线上包信息。
 * @param {string} pkg
 * @returns {string|null} 原始输出；失败返回 null
 */
function queryOhpmInfo(pkg) {
  try {
    return execFileSync('ohpm', ['info', pkg], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
      timeout: 60000,
    });
  } catch (e) {
    const msg = String((e && (e.stderr || e.message)) || '').trim().slice(0, 300);
    warn(`ohpm info ${pkg} 失败: ${msg || '未知错误'}`);
    return null;
  }
}

/**
 * 从任意文本中宽松提取所有语义化版本号。
 * @param {string} text
 * @returns {string[]} 去重后的版本号列表
 */
function extractVersions(text) {
  const set = new Set();
  const re = /(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    set.add(m[0]);
  }
  return [...set];
}

/**
 * 解析语义化版本号为结构化对象。
 * @param {string} version
 * @returns {{major: number, minor: number, patch: number, prerelease: string}}
 */
function parseSemver(version) {
  const [mainPart, prePart] = version.split('-');
  const parts = mainPart.split('.');
  return {
    major: parseInt(parts[0] || '0', 10),
    minor: parseInt(parts[1] || '0', 10),
    patch: parseInt(parts[2] || '0', 10),
    prerelease: prePart || '',
  };
}

/**
 * 比较两个语义化版本号（含 prerelease 优先级）。
 * @param {string} v1
 * @param {string} v2
 * @returns {number} -1 | 0 | 1
 */
function compareSemver(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  if (p1.major !== p2.major) return p1.major < p2.major ? -1 : 1;
  if (p1.minor !== p2.minor) return p1.minor < p2.minor ? -1 : 1;
  if (p1.patch !== p2.patch) return p1.patch < p2.patch ? -1 : 1;
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && !p2.prerelease) return 0;
  const a = p1.prerelease.split('.');
  const b = p2.prerelease.split('.');
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (!a[i]) return -1;
    if (!b[i]) return 1;
    const na = parseInt(a[i], 10);
    const nb = parseInt(b[i], 10);
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * 将版本号数组按语义化版本降序排序（最新在前）。
 * @param {string[]} versions
 * @returns {string[]}
 */
function sortVersionsDesc(versions) {
  return [...versions].sort((a, b) => compareSemver(b, a));
}

/**
 * 从版本列表挑选最新版本（优先稳定版，全部为预发布时取最高预发布版）。
 * @param {string[]} versions
 * @returns {string|null}
 */
function pickLatestVersion(versions) {
  if (!versions || versions.length === 0) return null;
  const sorted = sortVersionsDesc(versions);
  const stable = sorted.filter((v) => !v.includes('-'));
  return stable.length > 0 ? stable[0] : sorted[0];
}

/**
 * 从源工程 README 中判断是否出现 ohpm 安装提示的包名（辅助确认包存在）。
 * @param {string} projectRoot
 * @param {string} pkg
 * @returns {boolean}
 */
function hasInstallHint(projectRoot, pkg) {
  for (const name of ['README.md', 'README_zh.md', 'README_CN.md']) {
    const content = readFileSafe(path.join(projectRoot, name));
    if (content && content.includes(`ohpm install ${pkg}`)) return true;
  }
  return false;
}

// ── 文件修改（文本级 JSON5 操作） ───────────────────────────

/**
 * 将 oh-package.json5 中指定依赖键的值替换为新版本号（保留注释与尾逗号）。
 * @param {string} content 原始文本
 * @param {string} depKey 依赖键
 * @param {string} newValue 新依赖值（版本号）
 * @returns {string|null} 修改后的文本；未找到返回 null
 */
function replaceDependencyValue(content, depKey, newValue) {
  const escaped = escapeRegExp(depKey);
  const patterns = [
    // "key": "value" 或 'key': "value"（值可能含转义）
    new RegExp(`("${escaped}"\\s*:\\s*)("[^"]*"|'[^']*')`),
    new RegExp(`('${escaped}'\\s*:\\s*)("[^"]*"|'[^']*')`),
  ];
  for (const p of patterns) {
    if (p.test(content)) {
      return content.replace(p, `$1"${newValue}"`);
    }
  }
  return null;
}

/**
 * 从 build-profile.json5 文本中删除指定本地模块对象（含前导缩进、行尾与逗号）。
 * @param {string} content 原始文本
 * @param {{absStart: number, absEnd: number}} module 模块对象位置
 * @returns {string|null} 修改后的文本；异常返回 null
 */
function removeModuleFromContent(content, module) {
  const start = module.absStart;
  const end = module.absEnd; // 指向 }

  // 定位对象起行行首
  let lineStart = start;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') lineStart--;
  // 定位对象结行行尾（含换行）
  let lineEnd = end + 1;
  while (lineEnd < content.length && content[lineEnd] !== '\n') lineEnd++;
  if (lineEnd < content.length) lineEnd++; // 含换行

  // 若 } 后紧跟逗号，一并删除（处理同行逗号）
  if (lineEnd < content.length && content[lineEnd] === ',') {
    lineEnd++;
  }

  const removed = content.slice(lineStart, lineEnd);
  if (!removed.includes('{')) return null;

  let result = content.slice(0, lineStart) + content.slice(lineEnd);

  // 若 } 后逗号换行的情况已覆盖；再清理可能遗留的重复空行
  result = result.replace(/\n{3,}/g, '\n\n');

  // 若 modules 数组因此为空（[ 与 ] 之间仅剩空白），收拢为 []
  const emptyArrRe = /(\bmodules\s*:\s*\[)\s+(\s*\])/m;
  result = result.replace(emptyArrRe, '$1$2');

  return result;
}

// ── 主流程 ──────────────────────────────────────────────────

/**
 * 打印用法。
 */
function usage() {
  console.log(`
用法:
  node ohpm-switch.cjs --source <工程根> [--pkg <库包名>] [--version <版本号>]
                       [--dry-run] [--run-install] [--help]

选项:
  --source <路径>    目标鸿蒙工程根目录（必填）
  --pkg <包名>       指定要替换的依赖包名（如 @ohos/ijkplayer）；缺省处理全部 file 依赖
  --version <版本号>   指定线上版本号（如 2.0.9）；缺省通过 ohpm info 自动查询最新稳定版
  --dry-run          只定位与查询，不修改任何文件（在 stdout 打印计划改动）
  --run-install      修改完成后自动执行 ohpm install
  --help             显示本帮助

退出码: 0=成功  1=环境/参数/写入错误  2=无 file 依赖或无线上版本
`);
}

/**
 * 主流程。
 */
function main() {
  const args = parseArgs();

  if (args.help === true) {
    usage();
    process.exit(0);
  }

  if (!args.source || args.source === true) {
    error('缺少 --source 参数。用法: node ohpm-switch.cjs --source <工程根> [--pkg <库包名>]');
    usage();
    process.exit(1);
  }

  const projectRoot = path.resolve(String(args.source));
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    error(`--source 路径不存在或非目录: ${projectRoot}`);
    process.exit(1);
  }

  const dryRun = args['dry-run'] === true;
  const runInstall = args['run-install'] === true;
  const pkgFilter = args.pkg ? String(args.pkg) : null;
  const explicitVersion = args.version ? String(args.version).trim() : null;

  info(`开始 ohpm 线上版本替换分析: ${projectRoot}`);
  info(`模式: ${dryRun ? 'DRY-RUN（不写文件）' : '直接修改'}`);

  // 0. ohpm 探测
  const ohpmAvailable = checkOhpm();
  if (ohpmAvailable) {
    ok(`ohpm 可用，版本: ${ohpmAvailable}`);
  } else if (explicitVersion) {
    warn('ohpm 不可用，但已指定 --version，跳过 ohpm info 自动查询');
  } else {
    error('ohpm 不可用（ohpm --version 执行失败），且未指定 --version，无法查询线上版本。');
    error('请确保 ohpm 在 PATH 中，或使用 --version 显式指定版本号。');
    process.exit(1);
  }

  // 1. 扫描 file 依赖
  const deps = scanFileDeps(projectRoot);
  if (deps.length === 0) {
    error('未在任意 oh-package.json5 中发现 file: / 相对路径依赖，无需替换。');
    process.exit(2);
  }

  // 2. 读取 build-profile modules
  const bpPath = path.join(projectRoot, 'build-profile.json5');
  const bpContent = readFileSafe(bpPath);
  const modules = bpContent ? extractModules(bpContent) : [];
  info(`build-profile.json5: ${bpContent ? `已读取，modules[] 含 ${modules.length} 个模块` : '不存在（跳过模块条目移除）'}`);

  // 3. 过滤 + 匹配 + 查版本
  const candidates = [];
  for (const dep of deps) {
    if (pkgFilter && dep.depKey !== pkgFilter) continue;

    const matchedModule = bpContent ? matchModuleForDep(dep.depKey, modules) : null;

    let targetVersion = explicitVersion || null;
    if (!targetVersion && ohpmAvailable) {
      const out = queryOhpmInfo(dep.depKey);
      if (out) {
        const versions = extractVersions(out);
        if (versions.length > 0) {
          targetVersion = pickLatestVersion(versions);
          info(`  ${dep.depKey} 线上可用版本(${versions.length} 个)，选取: ${targetVersion}`);
        } else {
          warn(`  ohpm info ${dep.depKey} 输出中未提取到版本号`);
        }
      }
    }

    candidates.push({
      pkgFile: dep.pkgFile,
      section: dep.section,
      depKey: dep.depKey,
      depValue: dep.depValue,
      matchedModule,
      targetVersion,
    });
  }

  if (candidates.length === 0) {
    error(pkgFilter ? `未找到依赖键为 ${pkgFilter} 的 file/相对路径依赖。` : '未找到匹配的 file 依赖。');
    process.exit(2);
  }

  // 4. 输出定位结果
  info('=== 定位到本地 file 依赖 ===');
  for (const c of candidates) {
    const relPkg = path.relative(projectRoot, c.pkgFile) || path.basename(c.pkgFile);
    info(`  ${c.depKey} (${relPkg} ${c.section}) = ${c.depValue}`);
    if (c.matchedModule) {
      info(`    -> 匹配本地模块: name=${c.matchedModule.name}, srcPath=${c.matchedModule.srcPath}`);
    } else {
      warn(`    -> build-profile.json5 modules[] 中未注册该模块（仅替换依赖值）`);
    }
    if (c.targetVersion) {
      info(`    -> 线上版本: ${c.targetVersion}`);
    } else {
      warn(`    -> 未获取到线上版本（需 --version 指定或检查 ohpm registry）`);
    }
  }

  // 5. dry-run 提前结束
  if (dryRun) {
    info('=== DRY-RUN 计划改动（未写入任何文件） ===');
    for (const c of candidates) {
      if (!c.targetVersion) {
        warn(`  [跳过] ${c.depKey}: 无目标版本`);
        continue;
      }
      const relPkg = path.relative(projectRoot, c.pkgFile) || path.basename(c.pkgFile);
      info(`  ${relPkg}: "${c.depKey}": "${c.depValue}" -> "${c.targetVersion}"`);
      if (c.matchedModule) {
        info(`  build-profile.json5: 移除 modules[] 中 ${c.matchedModule.name}`);
      }
    }
    process.exit(0);
  }

  // 6. 确定无版本依赖的处理
  const noVersion = candidates.filter((c) => !c.targetVersion);
  if (noVersion.length > 0) {
    error(`以下依赖未获取到线上版本，中止修改（避免写入不完整改动）:`);
    for (const c of noVersion) {
      error(`  - ${c.depKey}（原值 ${c.depValue}）`);
    }
    error('请为这些包通过 --version 指定版本号，或修正 ohpm registry 后重试。');
    process.exit(2);
  }

  // 7. 执行修改
  const changes = [];
  let failed = false;

  for (const c of candidates) {
    // 修改 oh-package.json5
    const pkgContent = readFileSafe(c.pkgFile);
    if (pkgContent === null) {
      error(`读取失败: ${c.pkgFile}`);
      failed = true;
      continue;
    }
    const newContent = replaceDependencyValue(pkgContent, c.depKey, c.targetVersion);
    if (newContent === null || newContent === pkgContent) {
      error(`在 ${c.pkgFile} 中未找到依赖键 ${c.depKey}，无法替换`);
      failed = true;
      continue;
    }
    fs.writeFileSync(c.pkgFile, newContent, 'utf-8');
    ok(`${path.relative(projectRoot, c.pkgFile)}: "${c.depKey}": "${c.depValue}" -> "${c.targetVersion}"`);
    changes.push({
      file: path.relative(projectRoot, c.pkgFile) || path.basename(c.pkgFile),
      action: 'replace-dependency',
      key: c.depKey,
      oldValue: c.depValue,
      newValue: c.targetVersion,
    });

    // 移除 build-profile.json5 中的本地模块条目
    if (c.matchedModule && bpContent) {
      for (const mod of modules) {
        if (
          mod.absStart === c.matchedModule.absStart &&
          mod.absEnd === c.matchedModule.absEnd
        ) {
          const removed = removeModuleFromContent(bpContent, mod);
          if (removed !== null) {
            fs.writeFileSync(bpPath, removed, 'utf-8');
            ok(`build-profile.json5: 移除本地模块 ${mod.name}（srcPath=${mod.srcPath}）`);
            changes.push({
              file: 'build-profile.json5',
              action: 'remove-module',
              module: mod.name,
            });
          } else {
            error(`build-profile.json5 移除模块 ${mod.name} 失败（文本结构异常）`);
            failed = true;
          }
          break;
        }
      }
    }
  }

  if (failed) {
    error('存在修改失败项，请检查上述错误后重试。已成功的修改保留不回滚，请核对后再继续。');
    process.exit(1);
  }

  // 8. 可选 ohpm install
  let installResult = null;
  if (runInstall) {
    info('执行 ohpm install ...');
    try {
      execFileSync('ohpm', ['install'], {
        cwd: projectRoot,
        encoding: 'utf-8',
        shell: process.platform === 'win32',
        timeout: 300000,
        stdio: 'inherit',
      });
      installResult = { ok: true };
      ok('ohpm install 执行成功');
    } catch (e) {
      installResult = { ok: false, message: String(e.message || '').slice(0, 300) };
      error('ohpm install 执行失败，请手动在工程目录执行 ohpm install 后重新编译。');
      error(`  ${installResult.message}`);
    }
  }

  // 9. 输出改动清单报告
  const report = {
    tool: 'ohpm-switch',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    sourcePath: projectRoot,
    dryRun: false,
    ohpmAvailable: !!ohpmAvailable,
    ohpmVersion: ohpmAvailable || null,
    changes,
    runInstall,
    installResult,
  };
  const reportPath = path.join(projectRoot, 'ohpm-switch-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  ok(`改动清单已写入: ${reportPath}`);

  if (runInstall && installResult && !installResult.ok) {
    // install 失败但文件修改已生效：返回 1 提醒用户，仍保留 report
    process.exit(1);
  }

  ok('ohpm 线上版本替换完成。请使用 build.ps1 重新编译验证。');
  process.exit(0);
}

main();