#!/usr/bin/env node
/**
 * @tool flutter_extract_interfaces
 * @description 从 Flutter 三方库源码目录提取接口规格。基于 Dart 正则解析，提取类/枚举/mixin/extension/函数/变量的公开接口，输出 JSON 或直接传给下游覆盖率分析。用于分析 Flutter 库的完整 API 表面。
 * @param libroot: string - 库源码根目录路径（包含 lib/ 子目录和 pubspec.yaml）
 * @param output: string - 输出 JSON 文件路径（可选，不指定则输出 JSON 到 stdout）
 * @hidden
 * flutter-extract-interfaces.cjs — Flutter 三方库接口提取引擎
 *
 * 基于 Dart 正则解析，提取类/枚举/mixin/extension/函数/变量的公开接口。
 * 输出与 ArkTS extract-interfaces.cjs 兼容的 interface-spec.json 数据模型，
 * 供 flutter-render-spec-doc.cjs、flutter-analyze-demo-coverage.cjs、
 * flutter-analyze-xts-coverage.cjs 消费。
 *
 * 核心策略：
 *   1. pubspec.yaml → 包名 → lib/<package>.dart 入口定位
 *   2. export 链递归追踪（src/ 相对路径 + package: 跨包路径）
 *   3. export hide/show 过滤
 *   4. 预处理移除字符串/注释（保留行号），大括号块匹配提取类体
 *   5. 正则解析类/枚举/mixin/extension 成员 + 顶层函数/变量/typedef
 *   6. /// 文档注释提取
 *   7. _ 前缀私有成员过滤
 *   8. monorepo 多子包支持
 *
 * 用法:
 *   node flutter-extract-interfaces.cjs --repoDir <库源码目录> --output <interface-spec.json>
 *
 * 使用示例:
 *   node flutter-extract-interfaces.cjs --repoDir /path/to/advertising_id --output advertising_id-interface-spec.json
 *   node flutter-extract-interfaces.cjs --repoDir /path/to/flutter_inappwebview
 *
 * 库源码目录结构约定:
 *   /path/to/lib/
 *   ├── <package>.dart          ← 入口文件
 *   ├── src/                     ← 库源码
 *   └── constants.dart
 *
 *   # monorepo (如 flutter_inappwebview):
 *   /path/to/flutter_inappwebview/
 *   ├── flutter_inappwebview/        ← 主包
 *   │   ├── lib/
 *   │   └── pubspec.yaml
 *   └── flutter_inappwebview_platform_interface/
 *       └── lib/
 *
 * 模块导出:
 *   const { generateSpec } = require('./flutter-extract-interfaces.cjs');
 *   const spec = generateSpec('/path/to/lib_root');
 */

const fs = require('fs');
const path = require('path');

// ── 参数解析 ──────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  // MCP Gateway 模式：第一个参数是 JSON 字符串
  if (args.length > 0 && args[0].startsWith('{')) {
    try { return JSON.parse(args[0]); } catch (e) { /* 降级到 CLI 模式 */ }
  }
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

// ── 工具函数 ──────────────────────────────────────────────

function readText(file) {
  return fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
}

function rel(filePath, repoDir) {
  let r = path.relative(repoDir, filePath).split(path.sep).join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 获取字符索引对应的行号 (1-indexed) */
function getLineNum(content, index) {
  if (index < 0 || index > content.length) return 0;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

// ── pubspec.yaml 解析 ──────────────────────────────────────

function parsePubspec(repoDir) {
  const pubspecPath = path.join(repoDir, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) return { name: path.basename(repoDir), version: '' };
  const raw = readText(pubspecPath);
  const nameMatch = raw.match(/^name:\s*(.+)$/m);
  const versionMatch = raw.match(/^version:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim().replace(/['"]/g, '') : path.basename(repoDir),
    version: versionMatch ? versionMatch[1].trim().replace(/['"]/g, '') : '',
  };
}

// ── monorepo 检测 ──────────────────────────────────────────

/**
 * 检测是否为 monorepo（根目录无 lib/，但有多个子包）
 * 返回主包目录路径
 * 支持: flutter_inappwebview（子包在根目录下）、flutter_blue_plus（子包在 packages/ 下）
 */
function detectMainPackage(repoDir) {
  if (fs.existsSync(path.join(repoDir, 'lib')) && fs.existsSync(path.join(repoDir, 'pubspec.yaml'))) {
    return repoDir;
  }
  const dirName = path.basename(repoDir);
  const candidates = [];

  // 递归搜索（最多 3 层），收集所有含 pubspec.yaml + lib/ 的子目录
  function walk(dir, depth) {
    if (depth > 3) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build') continue;
        const subDir = path.join(dir, entry.name);
        if (fs.existsSync(path.join(subDir, 'pubspec.yaml')) && fs.existsSync(path.join(subDir, 'lib'))) {
          candidates.push(subDir);
          // 精确匹配根目录名，直接返回
          if (entry.name === dirName) return subDir;
          // 同名去掉前缀也匹配（如 fluttertpc_flutter_blue_plus → flutter_blue_plus）
          if (entry.name === dirName.replace(/^fluttertpc_/, '')) return subDir;
        }
        // 继续递归搜索（如 packages/flutter_blue_plus）
        const found = walk(subDir, depth + 1);
        if (found) return found;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  const exact = walk(repoDir, 0);
  if (exact) return exact;

  // 没有 exact match，从候选中选最合适的主包
  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const aName = path.basename(a);
      const bName = path.basename(b);
      // 排除 platform_interface / android / ios / darwin / linux / web / ohos 等辅助包
      const auxPatterns = ['platform_interface', '_android', '_ios', '_darwin', '_linux', '_web', '_ohos', '_windows', '_macos'];
      const aAux = auxPatterns.some(p => aName.includes(p));
      const bAux = auxPatterns.some(p => bName.includes(p));
      if (aAux && !bAux) return 1;
      if (!aAux && bAux) return -1;
      return aName.localeCompare(bName);
    });
    return candidates[0];
  }
  // fallback: 根目录下有 lib/ 但无 pubspec.yaml（如纯源码目录）
  if (fs.existsSync(path.join(repoDir, 'lib'))) return repoDir;
  return repoDir;
}

// ── 入口文件定位 ────────────────────────────────────────────

function locateEntryFile(repoDir, packageName) {
  const candidates = [
    path.join(repoDir, 'lib', `${packageName}.dart`),
    path.join(repoDir, 'lib', 'main.dart'),
    path.join(repoDir, 'lib', 'index.dart'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // fallback: 找 lib/ 下第一个 .dart 文件
  const libDir = path.join(repoDir, 'lib');
  if (fs.existsSync(libDir)) {
    for (const entry of fs.readdirSync(libDir)) {
      if (entry.endsWith('.dart') && !entry.startsWith('_')) {
        return path.join(libDir, entry);
      }
    }
  }
  return null;
}

// ── export 链追踪 ──────────────────────────────────────────

/**
 * 解析 export 语句，返回 { path, hide, show } 列表
 */
function parseExportStatements(content) {
  const exports = [];
  const regex = /^export\s+['"]([^'"]+)['"](?:\s+(hide|show)\s+([\w,\s]+))?/gm;
  let m;
  while ((m = regex.exec(content)) !== null) {
    exports.push({
      path: m[1],
      combinator: m[2] || null,    // 'hide' | 'show' | null
      names: m[3] ? m[3].split(',').map(s => s.trim()).filter(Boolean) : [],
    });
  }
  return exports;
}

/**
 * 解析 part 语句
 */
function parsePartStatements(content) {
  const parts = [];
  const regex = /^part\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = regex.exec(content)) !== null) {
    parts.push(m[1]);
  }
  return parts;
}

/**
 * 查找 package 的根目录（用于跨包 export）
 */
function findPackageRoot(pkgName, currentFile, repoDir) {
  // 从当前文件向上找包根目录
  let dir = path.dirname(currentFile);
  let pkgRoot = dir;
  while (dir !== '/' && dir !== repoDir) {
    if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
      pkgRoot = dir;
      break;
    }
    dir = path.dirname(dir);
  }
  if (dir === repoDir && fs.existsSync(path.join(repoDir, 'pubspec.yaml'))) {
    pkgRoot = repoDir;
  }

  // 策略1: 同级目录找同名包
  const parentDir = path.dirname(pkgRoot);
  const siblingDir = path.join(parentDir, pkgName);
  if (fs.existsSync(path.join(siblingDir, 'pubspec.yaml')) && fs.existsSync(path.join(siblingDir, 'lib'))) {
    return siblingDir;
  }

  // 策略2: 在 repoDir 下递归查找
  const found = [];
  function walk(dir, depth) {
    if (depth > 3) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.name === pkgName && fs.existsSync(path.join(full, 'pubspec.yaml')) && fs.existsSync(path.join(full, 'lib'))) {
          found.push(full);
          return;
        }
        walk(full, depth + 1);
      }
    } catch (e) { /* ignore */ }
  }
  walk(repoDir, 0);
  if (found.length > 0) return found[0];

  // 策略3: .dart_tool/package_config.json
  const configFile = path.join(pkgRoot, '.dart_tool', 'package_config.json');
  if (fs.existsSync(configFile)) {
    try {
      const config = JSON.parse(readText(configFile));
      const pkg = (config.packages || []).find(p => p.name === pkgName);
      if (pkg && pkg.rootUri) {
        const rootPath = pkg.rootUri.replace('file://', '').replace('file:', '');
        if (fs.existsSync(rootPath)) return rootPath;
      }
    } catch (e) { /* ignore */ }
  }

  return null;
}

/**
 * 解析 export 路径为实际文件路径
 */
function resolveExportPath(exportPath, currentFile, repoDir) {
  // package:xxx/file.dart → 跨包
  if (exportPath.startsWith('package:')) {
    const match = exportPath.match(/^package:([^/]+)\/(.+)$/);
    if (!match) return null;
    const pkgName = match[1];
    const filePath = match[2];
    const pkgRoot = findPackageRoot(pkgName, currentFile, repoDir);
    if (!pkgRoot) return null;
    const resolved = path.join(pkgRoot, 'lib', filePath);
    return fs.existsSync(resolved) ? resolved : null;
  }

  // dart:xxx → 系统库，跳过
  if (exportPath.startsWith('dart:')) return null;

  // 相对路径 src/xxx.dart
  const baseDir = path.dirname(currentFile);
  const resolved = path.resolve(baseDir, exportPath);
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * 递归收集所有通过 export 链可达的源文件
 */
function collectExportedFiles(entryFile, repoDir, visited = new Set(), hideShowMap = new Map()) {
  if (visited.has(entryFile)) return [];
  visited.add(entryFile);

  const files = [entryFile];
  const content = readText(entryFile);

  // 追踪 export
  const exports = parseExportStatements(content);
  for (const exp of exports) {
    const resolvedPath = resolveExportPath(exp.path, entryFile, repoDir);
    if (!resolvedPath) continue;

    // 记录 hide/show 过滤器
    if (exp.combinator) {
      if (!hideShowMap.has(resolvedPath)) hideShowMap.set(resolvedPath, []);
      hideShowMap.get(resolvedPath).push({ type: exp.combinator, names: exp.names });
    }

    files.push(...collectExportedFiles(resolvedPath, repoDir, visited, hideShowMap));
  }

  // 追踪 part 文件
  const parts = parsePartStatements(content);
  for (const partPath of parts) {
    const resolved = path.resolve(path.dirname(entryFile), partPath);
    if (fs.existsSync(resolved) && !visited.has(resolved)) {
      visited.add(resolved);
      files.push(resolved);
    }
  }

  return files;
}

/**
 * 检查名称是否被 hide/show 过滤掉
 */
function isHiddenByExport(name, hideShowMap, filePath) {
  const filters = hideShowMap.get(filePath);
  if (!filters) return false;

  for (const f of filters) {
    if (f.type === 'hide' && f.names.includes(name)) return true;
    if (f.type === 'show' && !f.names.includes(name)) return true;
  }
  return false;
}

// ── 源文件收集 ──────────────────────────────────────────────

function collectAllSourceFiles(repoDir) {
  const sources = [];
  const libDir = path.join(repoDir, 'lib');
  if (!fs.existsSync(libDir)) return sources;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.dart_tool' || entry.name === 'node_modules') continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.dart') && !entry.name.endsWith('.g.dart') && !entry.name.endsWith('.freezed.dart')) {
        sources.push(fullPath);
      }
    }
  }
  walk(libDir);
  return sources;
}

// ── 预处理：移除字符串/注释（保留行号）──────────────────────────

function preprocess(content) {
  let result = content;

  // 1. 移除块注释 /* ... */ (保留换行)
  result = result.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    return match.replace(/[^\n]/g, ' ');
  });

  // 2. 移除多行字符串 ''' ... ''' 和 """ ... """
  result = result.replace(/'''[\s\S]*?'''/g, (match) => match.replace(/[^\n]/g, ' '));
  result = result.replace(/"""[\s\S]*?"""/g, (match) => match.replace(/[^\n]/g, ' '));

  // 3. 逐行处理：保留 /// 文档注释行，其他行先移除字符串再移除注释
  const lines = result.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trimStart();
    // 保留 /// 文档注释行（不移除其中的字符串）
    if (trimmed.startsWith('///')) {
      // 但需要移除 /// 行中的 { 和 }，避免 {@template} {@endtemplate} 等
      // Dartdoc 注解的大括号干扰 extractBraceBlock 的深度计数
      return line.replace(/[{}]/g, ' ');
    }
    // 其他行：先移除字符串，再移除注释
    let processed = line;
    // 移除双引号字符串
    processed = processed.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    // 移除单引号字符串
    processed = processed.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    // 移除单行注释 //（字符串已移除，剩余的 // 一定是注释；但跳过 ///）
    const commentIdx = processed.indexOf('//');
    if (commentIdx >= 0) {
      // 检查是否为 /// (三个斜线)
      if (commentIdx + 2 < processed.length && processed[commentIdx + 2] === '/') {
        // /// 文档注释，保留
        return processed;
      }
      // 普通 // 注释，用空格替换注释部分（保留换行）
      processed = processed.substring(0, commentIdx) + ' '.repeat(line.length - commentIdx);
    }
    return processed;
  });

  return processedLines.join('\n');
}

// ── 文档注释提取 ──────────────────────────────────────────

/**
 * 从原始内容的指定行号向上回溯提取 /// 文档注释
 */
function extractDocComment(content, lineNum) {
  const lines = content.split('\n');
  const docLines = [];
  let j = lineNum - 2; // 0-indexed, 上一行
  while (j >= 0) {
    const line = lines[j].trim();
    if (line.startsWith('///')) {
      docLines.unshift(line.replace(/^\/\/\/\s*/, ''));
      j--;
    } else if (line.startsWith('*') && j > 0 && lines[j - 1].trim().startsWith('/*')) {
      // /* */ 风格文档注释
      docLines.unshift(line.replace(/^\*\s*/, ''));
      j--;
    } else {
      break;
    }
  }
  const text = docLines.join(' ').replace(/\s+/g, ' ').trim();
  return text || '-';
}

// ── 大括号块提取 ──────────────────────────────────────────

/**
 * 从 startIndex 位置（`{` 的位置）开始，匹配大括号块
 * 返回 { body: 块体内容, end: 闭合大括号位置 }
 */
function extractBraceBlock(cleanContent, startIndex) {
  let depth = 1;
  let i = startIndex + 1;
  while (i < cleanContent.length && depth > 0) {
    const c = cleanContent[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) return { body: '', end: startIndex };
  return {
    body: cleanContent.substring(startIndex + 1, i - 1),
    end: i,
  };
}

// ── 参数解析 ──────────────────────────────────────────────

/**
 * 按逗号分割参数列表（处理嵌套的 <> 和 ()）
 */
function splitByComma(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
    else if (c === '>' || c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(str.substring(start, i));
      start = i + 1;
    }
  }
  parts.push(str.substring(start));
  return parts.filter(s => s.trim());
}

/**
 * 解析 Dart 参数列表
 * 支持: 位置参数、可选位置参数 [x]、命名参数 {x}、required 命名参数
 */
function parseParameters(paramStr) {
  if (!paramStr || !paramStr.trim()) return [];

  // 检测可选/命名参数区域
  let inOptional = false;
  let inNamed = false;
  // 去掉标记符号但记录存在
  const hasOptional = /\[.*\]/.test(paramStr);
  const hasNamed = /\{.*\}/.test(paramStr);
  const cleanStr = paramStr.replace(/[\[\]{}]/g, '');

  const parts = splitByComma(cleanStr);
  const params = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // 去掉 required / covariant 修饰符
    const isRequired = /^required\s+/.test(trimmed);
    const cleanPart = trimmed.replace(/^(required|covariant)\s+/, '');

    // 先检查 this.name 简写形式（Dart 构造函数参数简写）
    const thisMatch = cleanPart.match(/^this\.(\w+)\s*(?:=\s*(.+))?$/);
    if (thisMatch) {
      params.push({
        name: thisMatch[1],
        type: 'dynamic',
        optional: !isRequired && (hasOptional || hasNamed || !!thisMatch[2]),
        description: '-',
      });
      continue;
    }

    // 匹配: [final/const] Type name [= default]
    // Type 可以是: String, String?, List<int>, Map<String, dynamic>, Future<List<T>?>, etc.
    let m = cleanPart.match(/^(?:(final|const)\s+)?([\w<>\?,\s@.]+?)\s+(\w+)\s*(?:=\s*(.+))?$/);
    if (m) {
      const typeStr = m[2].trim();
      const nameStr = m[3].trim();
      params.push({
        name: nameStr,
        type: typeStr,
        optional: !isRequired && (hasOptional || hasNamed || !!m[4]),
        description: '-',
      });
    } else {
      // 简单变量名（如 var name 或 dynamic name）
      m = cleanPart.match(/^(?:var\s+)?(\w+)\s*(?:=\s*(.+))?$/);
      if (m) {
        params.push({
          name: m[1],
          type: 'dynamic',
          optional: !isRequired && (hasOptional || hasNamed || !!m[2]),
          description: '-',
        });
      }
    }
  }

  return params;
}

// ── 移除大括号块（方法体）──────────────────────────────────

/**
 * 将内容中所有顶层大括号块替换为等长空格（保留行号）
 */
function removeAllBraceBlocks(content) {
  let result = content;
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (result[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        blocks.push({ start, end: i + 1 });
        start = -1;
      }
    }
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    result = result.substring(0, b.start) + ' '.repeat(b.end - b.start) + result.substring(b.end);
  }
  return result;
}

// ── 类成员提取 ──────────────────────────────────────────────

/**
 * 在清理后的类体内提取成员
 * 策略：先匹配方法/getter/构造函数（行首锚定），然后移除方法体后再匹配字段
 */
function extractClassMembers(classBody, className, classType, filePath, repoDir, bodyStartLine, rawContent, exportedNames, hideShowMap) {
  const members = [];
  const DART_KEYWORDS = ['class','extends','implements','with','void','return','final','const','late','static','var','get','set','operator','if','else','for','while','switch','case','break','continue','try','catch','finally','throw','new','import','export','part','library','show','hide','as','is','enum','mixin','extension','typedef','abstract','factory','this','super','do','in','yield','sync','async','await','dynamic','covariant','required','external','native','assert','default'];

  // 正则模式（行首锚定 + 类型不含空格，避免回溯匹配 static）
  const patterns = {
    // 方法: [static] [async] ReturnType methodName(params) [async*] { ... } | => ... | ;
    // 类型用 [^\s{}()]+ 匹配（不含空格/大括号/括号），避免回溯
    method: /^[ \t]*(?:(static)\s+)?(?:(async)\s+)?([^\s{}()]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:async\*?|sync\*?)?\s*(?:\{|=>|;)/gm,
    // getter: [static] Type get name [async] { ... } | => ...
    getter: /^[ \t]*(?:(static)\s+)?([^\s{}()]+)\s+get\s+(\w+)\s*(?:async\s*)?(?:\{|=>|;)/gm,
    // 构造函数: [factory] ClassName[.named](params) [: init] { ... } | => ... | ;
    constructor: /^[ \t]*(?:(factory)\s+)?(\w+)(?:\.(\w+))?\s*\(([^)]*)\)\s*(?::\s*[^{;]+)?\s*(?:\{|=>|;)/gm,
    // 字段: [static] [final/const/late] Type fieldName [= value]; （在移除方法体后匹配）
    field: /^[ \t]*(?:(static)\s+)?(?:(final|const|late)\s+)?([^\s{}();=]+)\s+(\w+)\s*(?:=\s*[^;]+)?;/gm,
  };

  // 1. 提取方法
  let m;
  while ((m = patterns.method.exec(classBody)) !== null) {
    const isStatic = !!m[1];
    const returnType = (m[3] || '').trim();
    const memberName = m[4];
    const paramStr = m[5] || '';

    if (memberName.startsWith('_')) continue;
    if (memberName === className) continue;
    if (DART_KEYWORDS.includes(memberName)) continue;
    if (DART_KEYWORDS.includes(returnType)) continue;

    const charIdx = m.index;
    const lineNum = bodyStartLine + getLineNum(classBody, charIdx);
    const isEvent = /^on[A-Z]/.test(memberName);

    members.push({
      className, memberName, fullName: `${className}.${memberName}`,
      kind: 'method', isStatic, isReadonly: false, isOptional: false, isEvent,
      type: classType,
      signature: `${isStatic ? 'static ' : ''}${returnType} ${memberName}(${paramStr})`,
      params: parseParameters(paramStr), returnType: returnType || 'void',
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir), startLine: lineNum,
    });
  }

  // 2. 提取 getter（属性）
  while ((m = patterns.getter.exec(classBody)) !== null) {
    const isStatic = !!m[1];
    const returnType = (m[2] || '').trim();
    const memberName = m[3];
    if (memberName.startsWith('_')) continue;
    if (DART_KEYWORDS.includes(memberName)) continue;
    if (members.some(mem => mem.memberName === memberName)) continue;

    const charIdx = m.index;
    const lineNum = bodyStartLine + getLineNum(classBody, charIdx);

    members.push({
      className, memberName, fullName: `${className}.${memberName}`,
      kind: 'property', isStatic, isReadonly: true, isOptional: false, isEvent: false,
      type: classType,
      signature: `${isStatic ? 'static ' : ''}${returnType} get ${memberName}`,
      params: [], returnType,
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir), startLine: lineNum,
    });
  }

  // 3. 提取构造函数
  // 跳过无参默认构造函数 ClassName()（非 factory、非命名、无参数），因为：
  //   - Dart 会隐式提供默认构造函数，不含业务逻辑
  //   - Demo 中即使使用也难以正则匹配，且无测试意义
  patterns.constructor.lastIndex = 0;
  while ((m = patterns.constructor.exec(classBody)) !== null) {
    const isFactory = !!m[1];
    const ctorClassName = m[2];
    const namedCtor = m[3];
    const paramStr = (m[4] || '').trim();
    if (ctorClassName !== className) continue;

    // 跳过无参默认构造函数：非 factory、非命名、无参数
    if (!isFactory && !namedCtor && paramStr === '') continue;

    const memberName = namedCtor || 'constructor';
    if (memberName.startsWith('_')) continue;
    if (members.some(mem => mem.memberName === memberName)) continue;

    const charIdx = m.index;
    const lineNum = bodyStartLine + getLineNum(classBody, charIdx);

    members.push({
      className, memberName,
      fullName: namedCtor ? `${className}.${namedCtor}` : `${className}.constructor`,
      kind: 'constructor', isStatic: false, isReadonly: false, isOptional: false, isEvent: false,
      type: classType,
      signature: `${isFactory ? 'factory ' : ''}${ctorClassName}${namedCtor ? '.' + namedCtor : ''}(${paramStr})`,
      params: parseParameters(paramStr), returnType: className,
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir), startLine: lineNum,
    });
  }

  // 4. 移除所有大括号块（方法体），在剩余内容上匹配字段
  // 类内字段分类：
  //   const → kind='constant'（编译时常量）
  //   final → kind='field'（运行时只读字段，如 Widget 配置参数，用户可通过构造函数传值）
  //   无修饰符/late → kind='field'
  const fieldContent = removeAllBraceBlocks(classBody);
  patterns.field.lastIndex = 0;
  while ((m = patterns.field.exec(fieldContent)) !== null) {
    const isStatic = !!m[1];
    const modifier = m[2];
    const fieldType = (m[3] || '').trim();
    const memberName = m[4];

    if (memberName.startsWith('_')) continue;
    if (members.some(mem => mem.memberName === memberName)) continue;
    if (DART_KEYWORDS.includes(memberName)) continue;
    if (DART_KEYWORDS.includes(fieldType)) continue;
    if (fieldType.length === 0) continue;

    const charIdx = m.index;
    const lineNum = bodyStartLine + getLineNum(classBody, charIdx);
    // 类内只有 const 才是真正的常量；final 是只读字段（Widget 参数等），应计入覆盖率
    const isConstant = modifier === 'const';

    members.push({
      className, memberName, fullName: `${className}.${memberName}`,
      kind: isConstant ? 'constant' : 'field', isStatic, isReadonly: modifier === 'const' || modifier === 'final', isOptional: false, isEvent: false,
      type: classType,
      signature: `${isStatic ? 'static ' : ''}${modifier ? modifier + ' ' : ''}${fieldType} ${memberName}`,
      params: [], returnType: fieldType,
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir), startLine: lineNum,
    });
  }

  // 5. 过滤 export hide/show
  return members.filter(m => {
    const nameToCheck = m.kind === 'constructor' ? className : m.memberName;
    return !isHiddenByExport(nameToCheck, hideShowMap, filePath);
  });
}

// ── 枚举成员提取 ──────────────────────────────────────────────

function extractEnumMembers(enumBody, enumName, filePath, repoDir, bodyStartLine, rawContent) {
  const members = [];

  // Dart 2 简单枚举: { val1, val2, val3 }
  // Dart 3 增强枚举: { val1, val2(args); Type field; const Name(this.field); }

  // 先提取枚举值（在第一个 ; 之前的部分）
  const semicolonIdx = enumBody.indexOf(';');
  const enumValuesPart = semicolonIdx >= 0 ? enumBody.substring(0, semicolonIdx) : enumBody;

  // 按逗号分割枚举值
  const valuePattern = /(\w+)(?:\s*\(([^)]*)\))?/g;
  let m;
  while ((m = valuePattern.exec(enumValuesPart)) !== null) {
    const name = m[1];
    if (name.startsWith('_')) continue;
    if (['const', 'final', 'static', 'factory', 'class', 'enum', 'mixin'].includes(name)) continue;

    const charIdx = m.index;
    const lineNum = bodyStartLine + getLineNum(enumBody, charIdx);

    members.push({
      className: enumName,
      memberName: name,
      fullName: `${enumName}.${name}`,
      kind: 'enumValue',
      isStatic: true,
      isReadonly: true,
      isOptional: false,
      isEvent: false,
      type: 'enum',
      signature: m[2] ? `${name}(${m[2]})` : name,
      params: [],
      returnType: name,
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir),
      startLine: lineNum,
    });
  }

  // 如果是增强枚举，也提取成员方法/字段
  if (semicolonIdx >= 0) {
    const memberPart = enumBody.substring(semicolonIdx + 1);
    const classMembers = extractClassMembers(memberPart, enumName, 'enum', filePath, repoDir, bodyStartLine + getLineNum(enumBody, semicolonIdx + 1), rawContent, null, new Map());
    members.push(...classMembers);
  }

  return members;
}

// ── 顶层声明提取 ──────────────────────────────────────────────

function extractTopLevelDeclarations(cleanContent, rawContent, filePath, repoDir, exportedNames, hideShowMap) {
  const members = [];
  const fullContent = cleanContent;
  // 控制流关键字（不能作为返回类型）
  const FLOW_KEYWORDS = ['return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'import', 'export', 'part', 'library', 'show', 'hide', 'as', 'is', 'class', 'extends', 'implements', 'with', 'enum', 'mixin', 'extension', 'typedef', 'abstract', 'factory', 'this', 'super', 'do', 'in', 'yield', 'sync', 'await', 'covariant', 'required', 'external', 'native', 'assert', 'default', 'operator', 'get', 'set', 'static', 'late', 'const', 'final', 'var'];

  // 顶层函数: [async] ReturnType functionName(params) [async] { ... } | => ...
  // 行首锚定 + 类型不含空格，避免回溯
  const funcPattern = /^[ \t]*(?:(async)\s+)?([^\s{}()]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:async\*?|sync\*?)?\s*(?:\{|=>|;)/gm;
  let m;
  while ((m = funcPattern.exec(fullContent)) !== null) {
    const returnType = (m[2] || '').trim();
    const funcName = m[3];
    const paramStr = m[4] || '';

    if (funcName.startsWith('_')) continue;
    // 跳过关键字函数名
    if (FLOW_KEYWORDS.includes(funcName)) continue;
    // 跳过关键字返回类型（如 return X(...) 被误匹配为函数）
    if (FLOW_KEYWORDS.includes(returnType)) continue;

    const lineNum = getLineNum(rawContent, m.index);

    // 检查是否在 export 链中
    if (exportedNames && !exportedNames.has(funcName) && !isExported(filePath, hideShowMap)) continue;

    members.push({
      className: null,
      memberName: funcName,
      fullName: funcName,
      kind: 'function',
      isStatic: false,
      isReadonly: false,
      isOptional: false,
      isEvent: false,
      type: 'function',
      signature: `${returnType} ${funcName}(${paramStr})`,
      params: parseParameters(paramStr),
      returnType: returnType || 'void',
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir),
      startLine: lineNum,
    });
  }

  // 顶层常量/变量: const/final/var Type name = value; 或 const name = value;
  // 行首锚定，类型不含空格
  // const → kind='constant', final → kind='constant', var → kind='variable'
  const constPattern = /^[ \t]*(?:(const|final|var)\s+)(?:([^\s;=]+)\s+)?(\w+)\s*=\s*[^;]+;/gm;
  while ((m = constPattern.exec(fullContent)) !== null) {
    const modifier = m[1];
    const typeStr = (m[2] || '').trim();
    const varName = m[3];

    if (varName.startsWith('_')) continue;
    if (FLOW_KEYWORDS.includes(varName)) continue;
    if (typeStr && FLOW_KEYWORDS.includes(typeStr)) continue;

    // 跳过已在函数中匹配的
    if (members.some(mem => mem.memberName === varName)) continue;

    const lineNum = getLineNum(rawContent, m.index);

    if (exportedNames && !exportedNames.has(varName) && !isExported(filePath, hideShowMap)) continue;

    const isConstant = modifier === 'const' || modifier === 'final';
    members.push({
      className: null,
      memberName: varName,
      fullName: varName,
      kind: isConstant ? 'constant' : 'variable',
      isStatic: false,
      isReadonly: isConstant,
      isOptional: false,
      isEvent: false,
      type: isConstant ? 'constant' : 'variable',
      signature: `${modifier} ${typeStr || 'var'} ${varName}`,
      params: [],
      returnType: typeStr || 'dynamic',
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir),
      startLine: lineNum,
    });
  }

  // typedef: typedef ReturnType AliasName = Type; 或 typedef AliasName = Type;
  const typedefPattern = /^typedef\s+(\w+)\s*=\s*([^;]+);/gm;
  while ((m = typedefPattern.exec(fullContent)) !== null) {
    const typedefName = m[1];
    const typeValue = (m[2] || '').trim();
    if (typedefName.startsWith('_')) continue;

    const lineNum = getLineNum(rawContent, m.index);
    if (exportedNames && !exportedNames.has(typedefName) && !isExported(filePath, hideShowMap)) continue;

    members.push({
      className: typedefName,
      memberName: typedefName,
      fullName: typedefName,
      kind: 'type',
      isStatic: false,
      isReadonly: false,
      isOptional: false,
      isEvent: false,
      type: 'typedef',
      signature: `typedef ${typedefName} = ${typeValue}`,
      params: [],
      returnType: typeValue,
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir),
      startLine: lineNum,
    });
  }

  // 旧式 typedef: typedef ReturnType AliasName(params);
  const oldTypedefPattern = /^typedef\s+([\w<>\?,\s@]+?)\s+(\w+)\s*\(([^)]*)\)/gm;
  while ((m = oldTypedefPattern.exec(fullContent)) !== null) {
    const returnType = (m[1] || '').trim();
    const typedefName = m[2];
    const paramStr = m[3] || '';
    if (typedefName.startsWith('_')) continue;
    if (members.some(mem => mem.memberName === typedefName)) continue;

    const lineNum = getLineNum(rawContent, m.index);
    if (exportedNames && !exportedNames.has(typedefName) && !isExported(filePath, hideShowMap)) continue;

    members.push({
      className: typedefName,
      memberName: typedefName,
      fullName: typedefName,
      kind: 'type',
      isStatic: false,
      isReadonly: false,
      isOptional: false,
      isEvent: false,
      type: 'typedef',
      signature: `typedef ${returnType} ${typedefName}(${paramStr})`,
      params: parseParameters(paramStr),
      returnType,
      description: extractDocComment(rawContent, lineNum),
      source: rel(filePath, repoDir),
      startLine: lineNum,
    });
  }

  return members;
}

function isExported(filePath, hideShowMap) {
  return hideShowMap.size === 0 || hideShowMap.has(filePath) || true; // 如果在 export 链中则已导出
}

// ── 类/枚举/mixin/extension 声明查找 ───────────────────────────

/**
 * 检查某位置是否在 /// 文档注释行内
 */
function isInsideDocComment(cleanContent, index) {
  const lineStart = cleanContent.lastIndexOf('\n', index) + 1;
  const linePrefix = cleanContent.substring(lineStart, index).trimStart();
  // 如果行以 /// 开头（去除前导空格后），则是在文档注释内
  return linePrefix.startsWith('///');
}

function findDeclarations(cleanContent) {
  const declarations = [];
  const seen = new Set();

  // class / abstract class / final class / sealed class / base class / interface class / mixin class
  const classPattern = /(?:(abstract|final|sealed|base|interface)\s+)*(mixin\s+)?class\s+(\w+)/g;
  let m;
  while ((m = classPattern.exec(cleanContent)) !== null) {
    // 跳过 /// 文档注释内的误匹配（如 "///This class is used..."）
    if (isInsideDocComment(cleanContent, m.index)) continue;
    const name = m[3];
    if (seen.has(name)) continue;
    const isAbstract = m[1] === 'abstract';
    const isMixin = !!m[2];
    let type = 'class';
    if (isMixin) type = 'mixin_class';
    else if (isAbstract) type = 'abstract_class';

    // 找到 { 的位置
    const braceIdx = cleanContent.indexOf('{', m.index);
    if (braceIdx < 0) continue;

    declarations.push({
      type,
      name,
      declIndex: m.index,
      braceIndex: braceIdx,
    });
    seen.add(name);
  }

  // mixin Name { ... } — 跳过 "mixin class" (Dart 3 mixin class 修饰符)
  const mixinPattern = /\bmixin\s+(?!class\b)(\w+)\b/g;
  while ((m = mixinPattern.exec(cleanContent)) !== null) {
    if (isInsideDocComment(cleanContent, m.index)) continue;
    const name = m[1];
    if (seen.has(name)) continue;
    // 排除 "mixin class" 已被上面匹配
    const after = cleanContent.substring(m.index + m[0].length).trimStart();
    if (/^class\b/.test(after)) continue;

    const braceIdx = cleanContent.indexOf('{', m.index);
    if (braceIdx < 0) continue;

    declarations.push({
      type: 'mixin',
      name,
      declIndex: m.index,
      braceIndex: braceIdx,
    });
    seen.add(name);
  }

  // enum Name { ... }
  const enumPattern = /\benum\s+(\w+)\b/g;
  while ((m = enumPattern.exec(cleanContent)) !== null) {
    if (isInsideDocComment(cleanContent, m.index)) continue;
    const name = m[1];
    if (seen.has(name)) continue;

    const braceIdx = cleanContent.indexOf('{', m.index);
    if (braceIdx < 0) continue;

    declarations.push({
      type: 'enum',
      name,
      declIndex: m.index,
      braceIndex: braceIdx,
    });
    seen.add(name);
  }

  // extension [Name] on Type { ... }
  const extPattern = /\bextension\s+(\w+)?\s*(?:on\s+[\w<>\?,\s@\[\]{}.]+)?\s*\{/g;
  while ((m = extPattern.exec(cleanContent)) !== null) {
    if (isInsideDocComment(cleanContent, m.index)) continue;
    const name = m[1] || `(ext_${m.index})`;
    if (seen.has(name)) continue;

    declarations.push({
      type: 'extension',
      name: m[1] || '(anonymous)',
      declIndex: m.index,
      braceIndex: m.index + m[0].length - 1, // { 在正则匹配的最后一个字符
    });
    seen.add(name);
  }

  declarations.sort((a, b) => a.declIndex - b.declIndex);
  return declarations;
}

// ── 主解析函数 ──────────────────────────────────────────────

function parseLibrary(repoDir) {
  const mainPkgDir = detectMainPackage(repoDir);
  const pubspec = parsePubspec(mainPkgDir);
  const packageName = pubspec.name;
  const libraryName = packageName;

  const entryFile = locateEntryFile(mainPkgDir, packageName);
  if (!entryFile) {
    throw new Error(`无法定位入口文件: ${mainPkgDir}/lib/${packageName}.dart`);
  }

  // 收集 export 链可达的文件
  const hideShowMap = new Map();
  const exportedFiles = collectExportedFiles(entryFile, repoDir, new Set(), hideShowMap);

  // 也收集所有 lib/ 下的源文件（用于 fallback）
  const allSources = collectAllSourceFiles(mainPkgDir);

  // 合并去重
  const sourceSet = new Set([...exportedFiles, ...allSources]);

  // 收集所有跨包子包的源文件（monorepo）
  for (const [filePath] of hideShowMap) {
    if (!sourceSet.has(filePath)) sourceSet.add(filePath);
    // 递归收集被 export 的文件的源码
    const subSources = collectAllSourceFiles(path.dirname(path.dirname(filePath)));
    for (const s of subSources) sourceSet.add(s);
  }

  const sources = [...sourceSet];
  const interfaces = [];
  const visitedClassNames = new Set();

  for (const filePath of sources) {
    if (!fs.existsSync(filePath)) continue;
    const rawContent = readText(filePath);
    const cleanContent = preprocess(rawContent);

    // 查找类/枚举/mixin/extension 声明
    const declarations = findDeclarations(cleanContent);

    for (const decl of declarations) {
      if (visitedClassNames.has(decl.name)) continue;
      // 跳过私有类/枚举/mixin/extension（_ 前缀）
      if (decl.name.startsWith('_')) continue;
      visitedClassNames.add(decl.name);

      // 提取大括号块
      const block = extractBraceBlock(cleanContent, decl.braceIndex);
      if (!block.body) continue;

      const bodyStartLine = getLineNum(rawContent, decl.braceIndex + 1);

      if (decl.type === 'enum') {
        interfaces.push(...extractEnumMembers(block.body, decl.name, filePath, repoDir, bodyStartLine, rawContent));
      } else {
        // 过滤 export hide/show
        const filtered = isHiddenByExport(decl.name, hideShowMap, filePath);
        if (filtered) continue;

        interfaces.push(...extractClassMembers(
          block.body, decl.name, decl.type, filePath, repoDir,
          bodyStartLine, rawContent, null, hideShowMap
        ));
      }
    }

    // 顶层声明：先移除所有类/枚举/mixin/extension 块体，避免类内方法被误匹配为顶层函数
    const isExportedFile = exportedFiles.includes(filePath) || allSources.includes(filePath);
    if (isExportedFile) {
      // 收集所有声明块的范围，从 cleanContent 中移除
      let topLevelContent = cleanContent;
      const rangesToRemove = [];
      for (const decl of declarations) {
        const block = extractBraceBlock(cleanContent, decl.braceIndex);
        rangesToRemove.push({ start: decl.braceIndex, end: block.end });
      }
      // 从后往前移除
      rangesToRemove.sort((a, b) => b.start - a.start);
      for (const r of rangesToRemove) {
        topLevelContent = topLevelContent.substring(0, r.start) + ' '.repeat(r.end - r.start) + topLevelContent.substring(r.end);
      }
      interfaces.push(...extractTopLevelDeclarations(topLevelContent, rawContent, filePath, repoDir, null, hideShowMap));
    }
  }

  // 去重（同一个 fullName 可能从多个文件提取）
  const seenFullNames = new Set();
  const dedupedInterfaces = [];
  for (const iface of interfaces) {
    if (!seenFullNames.has(iface.fullName)) {
      seenFullNames.add(iface.fullName);
      dedupedInterfaces.push(iface);
    }
  }

  // 统计
  const classCount = new Set(dedupedInterfaces.map(i => i.className).filter(n => n !== null)).size;
  const methodCount = dedupedInterfaces.filter(i => i.kind === 'method').length;
  const propertyCount = dedupedInterfaces.filter(i => i.kind === 'property').length;
  const fieldCount = dedupedInterfaces.filter(i => i.kind === 'field').length;
  const constantCount = dedupedInterfaces.filter(i => i.kind === 'constant').length;

  return {
    libraryName,
    entryFile: rel(entryFile, repoDir),
    nativeDPath: null,
    extractedAt: new Date().toISOString(),
    summary: {
      S: classCount,
      N: dedupedInterfaces.length,
      M: 0,
      methods: methodCount,
      properties: propertyCount,
      fields: fieldCount,
      constants: constantCount,
    },
    sources: sources.map(s => rel(s, repoDir)),
    interfaces: dedupedInterfaces,
  };
}

// ── 模块导出 ───────────────────────────────────────────────

function generateSpec(repoDir) {
  if (!fs.existsSync(repoDir)) {
    throw new Error(`目录不存在: ${repoDir}`);
  }
  return parseLibrary(repoDir);
}

module.exports = {
  generateSpec,
  parseLibrary,
  detectMainPackage,
  locateEntryFile,
  parsePubspec,
  collectExportedFiles,
  preprocess,
  parseParameters,
};

// ── 入口 ──────────────────────────────────────────────────

if (require.main === module) {
  const args = parseArgs();
  const repoDir = args.repoDir || args.libroot || '';
  const outputPath = args.output || '';

  if (!repoDir) {
    console.error('用法: node flutter-extract-interfaces.cjs --repoDir <库源码目录> --output <interface-spec.json>');
    process.exit(1);
  }

  console.log(`库源码目录: ${repoDir}`);

  try {
    const result = generateSpec(repoDir);

    console.log(`解析完成: ${result.interfaces.length} 个接口`);
    console.log(`  库名: ${result.libraryName}`);
    console.log(`  入口文件: ${result.entryFile}`);
    console.log(`  源文件数: ${result.sources.length}`);
    console.log(`  类级: ${result.summary.S} | 方法: ${result.summary.methods} | 属性: ${result.summary.properties} | 字段: ${result.summary.fields} | 常量: ${result.summary.constants}`);

    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
      console.log(`  输出: ${outputPath}`);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}
