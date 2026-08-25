#!/usr/bin/env node
/**
 * @tool rn_extract_interfaces
 * @description 从 React Native 三方库的鸿蒙化仓库提取接口规格。自动拉取上游 npm 源码（index.js/index.d.ts），从本地鸿蒙工程提取 TurboModule Spec（Native*.ts），解析 JS 层导出（CommonJS/ES Module/Side-effect）和类型定义，输出 JSON 接口规格文件。用于分析 RN 三方库的完整 API 表面，是覆盖率分析和文档生成的基础。
 * @param libroot: string - 库根目录路径（RN 三方库的鸿蒙化仓库目录，包含 package.json）
 * @param output: string - 输出 JSON 文件路径（可选，不指定则输出 JSON 到 stdout）
 * @param version: string - 上游 npm 版本号（可选，如 "2.2.0"，不指定则自动从 dependencies/README 推断）
 * @hidden
 * extract-rn-interfaces.cjs — RN 接口提取与覆盖率分析核心引擎
 *
 * 本文件是整个工具集的唯一核心模块，包含:
 *   Part 0: 共享工具 (文件IO, 库发现, 解析工具, 字符串工具, CLI, 日志, TS加载)
 *   Part 1: 上游 npm 源码拉取 (版本确定 + npm pack + 解压)
 *   Part 2: 接口提取 (导出模式检测, 方法签名解析, TurboModule Spec, JS层导出, index.d.ts)
 *   Part 3: 接口规格生成 (generateRNSpec + loadSpec)
 *   Part 4: 覆盖率分析引擎 (正则匹配 + AST匹配 + 结果聚合 + Markdown渲染 + runCoverage)
 *
 * JS 层源码（index.js, index.d.ts）强制从上游 npm 拉取。
 * TurboModule Spec（src/Native*.ts）从本地鸿蒙工程提取。
 *
 * 被依赖: rn-render-spec-doc.cjs, rn-analyze-demo-coverage.cjs, rn-analyze-test-coverage.cjs
 *
 * 用法 (CLI):
 *   node rn-extract-interfaces.cjs --repoDir <库根目录> --output <spec.json> [--version <上游版本>]
 *
 * 用法 (模块):
 *   const { generateRNSpec, loadSpec, runCoverage } = require('./rn-extract-interfaces.cjs');
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ════════════════════════════════════════════════════════════
// Part 0: 共享工具
// ════════════════════════════════════════════════════════════

const COLORS = { RED: '\x1b[0;31m', GREEN: '\x1b[0;32m', YELLOW: '\x1b[1;33m', BLUE: '\x1b[0;34m', NC: '\x1b[0m' };
function info(msg)  { console.log(`${COLORS.BLUE}[INFO]${COLORS.NC} ${msg}`); }
function ok(msg)    { console.log(`${COLORS.GREEN}[OK]${COLORS.NC} ${msg}`); }
function warn(msg)  { console.log(`${COLORS.YELLOW}[WARN]${COLORS.NC} ${msg}`); }
function error(msg) { console.error(`${COLORS.RED}[ERROR]${COLORS.NC} ${msg}`); process.exit(1); }

function readText(file) {
  let c = fs.readFileSync(file, 'utf-8');
  if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
  return c;
}

function rel(filePath, repoDir) {
  let r = path.relative(repoDir, filePath).split(path.sep).join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

function walkDir(dir, opts, srcRoot) {
  const exts = opts.exts || ['.ts', '.tsx'];
  const excludeDirs = opts.excludeDirs || ['node_modules', 'lib', 'dist', '.git'];
  srcRoot = srcRoot || dir;
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const relDir = path.relative(srcRoot, dir);
  const topDir = relDir.split(path.sep)[0] || '';
  if (relDir !== '' && excludeDirs.includes(topDir)) return results;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(fullPath, opts, srcRoot));
    else if (entry.isFile() && exts.some(ext => entry.name.endsWith(ext))) results.push(fullPath);
  }
  return results;
}

function readPackageJson(dir) {
  const p = path.join(dir, 'package.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function getLibraryAlias(pkg) {
  if (!pkg) return null;
  if (pkg.harmony && pkg.harmony.alias) return pkg.harmony.alias;
  if (pkg.name) return pkg.name.replace(/^@[^/]+\//, '');
  return null;
}

function detectEntryFile(dir, explicitEntry) {
  if (explicitEntry) {
    const p = path.resolve(dir, explicitEntry);
    if (fs.existsSync(p)) return p;
    warn(`指定的入口文件不存在: ${explicitEntry}`);
  }
  const pkg = readPackageJson(dir);
  const fields = ['source', 'react-native', 'main', 'module'];
  if (pkg) {
    for (const field of fields) {
      const val = pkg[field];
      if (val && typeof val === 'string') {
        const variants = [val, val.replace(/^lib\//, 'src/'), val.replace(/^lib\/commonjs\//, 'src/'), val.replace(/^lib\/module\//, 'src/'), val.replace(/\.js$/, '.ts'), val.replace(/\.jsx$/, '.tsx'), val.replace(/^lib\//, 'src/').replace(/\.js$/, '.ts'), val.replace(/^lib\//, 'src/').replace(/\.js$/, '.tsx'), val.replace(/^lib\/module\//, 'src/').replace(/\.js$/, '.ts'), val.replace(/^lib\/module\//, 'src/').replace(/\.js$/, '.tsx')];
        for (const v of variants) {
          const p = path.resolve(dir, v);
          if (fs.existsSync(p) && (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx'))) return p;
        }
        const p = path.resolve(dir, val);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const conv of ['src/index.ts', 'src/index.tsx', 'index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
    const p = path.resolve(dir, conv);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findTurboModuleSpecFiles(dir) {
  const results = [];
  const pkg = readPackageJson(dir);
  const srcDirs = [];
  if (pkg && pkg.codegenConfig && pkg.codegenConfig.jsSrcsDir) srcDirs.push(path.resolve(dir, pkg.codegenConfig.jsSrcsDir));
  srcDirs.push(path.resolve(dir, 'src'));
  srcDirs.push(dir);
  for (const srcDir of srcDirs) {
    if (!fs.existsSync(srcDir)) continue;
    scanDirForNativeSpec(srcDir, results);
  }
  const allTsFiles = [];
  for (const srcDir of srcDirs) {
    if (!fs.existsSync(srcDir)) continue;
    collectTsFiles(srcDir, allTsFiles);
  }
  for (const tsFile of allTsFiles) {
    if (results.includes(tsFile)) continue;
    try {
      const content = readText(tsFile);
      if (/interface\s+Spec\s+extends\s+TurboModule/.test(content) ||
          /codegenNativeComponent/.test(content) ||
          /codegenNativeCommands/.test(content)) {
        results.push(tsFile);
      }
    } catch {}
  }
  return [...new Set(results)];
}

function scanDirForNativeSpec(dir, results) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (['node_modules', 'lib', 'dist', '.git', '.upstream-cache'].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) scanDirForNativeSpec(fullPath, results);
    else if (entry.isFile() && /^Native[A-Z].*\.(ts|tsx)$/.test(entry.name)) results.push(fullPath);
  }
}

function collectTsFiles(dir, results) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (['node_modules', 'lib', 'dist', '.git', '.upstream-cache', 'harmony', 'android', 'ios'].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsFiles(fullPath, results);
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) results.push(fullPath);
  }
}

function resolveRelativePath(fromFile, relativePath) {
  if (!relativePath) return null;
  const base = path.resolve(path.dirname(fromFile), relativePath);
  for (const c of [base + '.ts', base + '.tsx', base + '.d.ts', base + '.js', base + '.jsx', path.join(base, 'index.d.ts'), path.join(base, 'index.ts'), path.join(base, 'index.tsx'), path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveRelativePathDts(fromFile, relativePath) {
  if (!relativePath) return null;
  const base = path.resolve(path.dirname(fromFile), relativePath);
  const candidates = [
    base + '.d.ts', base + '.ts',
    path.join(base, 'index.d.ts'), path.join(base, 'index.ts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return resolveRelativePath(fromFile, relativePath);
}

function stripComments(content) { return content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); }

function extractBalancedBraces(text, startIdx) {
  let depth = 1, i = startIdx;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    if (depth === 0) return text.substring(startIdx, i);
    i++;
  }
  return null;
}

function findSignatureEnd(text, start) {
  let depth = 0, i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) {
        // Check if this is a method body or an object type
        let k = i - 1;
        while (k >= 0 && /[ \t\r\n]/.test(text[k])) k--;
        const prevCh = k >= 0 ? text[k] : '';
        if (!'|=,&<'.includes(prevCh)) return i; // Method body start
      }
      depth++;
    }
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') { if (depth === 0) return i; depth--; }
    else if (ch === ';' && depth === 0) return i;
    else if (ch === '\n' && depth === 0) {
      // ASI: stop at newline if next line starts a new declaration
      // and current line doesn't end with a continuation character
      let j = i + 1;
      while (j < text.length && /[ \t\r]/.test(text[j])) j++;
      let k = i - 1;
      while (k >= 0 && /[ \t\r]/.test(text[k])) k--;
      const prevCh = k >= 0 ? text[k] : '';
      if (/[a-zA-Z_$]/.test(text[j]) && !'|&({[,<.'.includes(prevCh)) {
        return i;
      }
    }
    i++;
  }
  return text.length;
}

function normalizeSignature(sig) { return sig.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').replace(/\s*;\s*$/, '').trim(); }

function extractExports(content) {
  let defaultExportDesc = null;
  const named = [], types = [], reExports = [];
  const cleaned = stripComments(content);
  const defaultMatch = cleaned.match(/export\s+default\s+(?:function\s+(\w+)|class\s+(\w+)|([^\s;{]+))/);
  if (defaultMatch) defaultExportDesc = defaultMatch[1] || defaultMatch[2] || defaultMatch[3] || 'anonymous';
  const exportBraceRegex = /export\s+(type\s+)?\{([^}]+)\}\s*(?:from\s*['"]([^'"]+)['"])?/g;
  let m;
  while ((m = exportBraceRegex.exec(cleaned)) !== null) {
    const isType = !!m[1], namesRaw = m[2], fromModule = m[3] || null;
    for (let name of namesRaw.split(',').map(s => s.trim()).filter(Boolean)) {
      let isTypeExport = isType;
      if (name.startsWith('type ')) { isTypeExport = true; name = name.substring(5).trim(); }
      const asMatch = name.match(/^(\w+)\s+as\s+(\w+)/);
      const exportName = asMatch ? asMatch[2] : name;
      const originalName = asMatch ? asMatch[1] : name;
      if (fromModule) reExports.push({ name: exportName, original: originalName, from: fromModule, isType: isTypeExport });
      else if (isTypeExport) { if (!types.includes(exportName)) types.push(exportName); }
      else { if (!named.includes(exportName)) named.push(exportName); }
    }
  }
  const starRegex = /export\s+\*\s*(?:as\s+(\w+)\s+)?from\s*['"]([^'"]+)['"]/g;
  while ((m = starRegex.exec(cleaned)) !== null) reExports.push({ name: m[1] || '*', original: '*', from: m[2], isType: false, isWildcard: true });
  const patterns = [
    { regex: /export\s+(?:async\s+)?function\s+(\w+)/g, kind: 'named' },
    { regex: /export\s+(?:abstract\s+)?class\s+(\w+)/g, kind: 'named' },
    { regex: /export\s+(?:const|let|var)\s+(\w+)/g, kind: 'named' },
    { regex: /export\s+interface\s+(\w+)/g, kind: 'types' },
    { regex: /export\s+type\s+(\w+)\s*[=<]/g, kind: 'types' },
    { regex: /export\s+(?:const\s+)?enum\s+(\w+)/g, kind: 'types' },
  ];
  for (const { regex, kind } of patterns) {
    while ((m = regex.exec(cleaned)) !== null) {
      if (kind === 'named') { if (!named.includes(m[1])) named.push(m[1]); }
      else { if (!types.includes(m[1])) types.push(m[1]); }
    }
  }
  return { defaultExport: defaultExportDesc, named, types, reExports };
}

function extractTurboModuleSpec(content) {
  const cleaned = stripComments(content);
  let moduleName = null;
  const nameMatch = cleaned.match(/TurboModuleRegistry\.get(?:Enforcing)?(?:<[^>]+>)?\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  if (nameMatch) moduleName = nameMatch[1];
  if (!moduleName) { const c = cleaned.match(/export\s+const\s+NAME\s*=\s*['"]([^'"]+)['"]/); if (c) moduleName = c[1]; }
  const methods = [];
  const interfaceMatch = cleaned.match(/export\s+interface\s+Spec\s+extends\s+TurboModule\s*\{/);
  if (interfaceMatch) {
    const body = extractBalancedBraces(cleaned, interfaceMatch.index + interfaceMatch[0].length);
    if (body) methods.push(...extractMethodsFromInterfaceBody(body));
  }
  return { moduleName, methods };
}

function extractMethodsFromInterfaceBody(body) {
  const methods = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    const modMatch = body.substring(i).match(/^(?:readonly|private|public|protected|static|async|override|abstract|get|set)\s+/);
    if (modMatch) { i += modMatch[0].length; continue; }
    const idMatch = body.substring(i).match(/^([a-zA-Z_$][\w$]*)/);
    if (!idMatch) { i++; continue; }
    const name = idMatch[1], nameStart = i;
    i += idMatch[0].length;
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    if (body[i] === '?' || body[i] === ':') {
      if (body[i] === '?') { i++; while (i < body.length && /\s/.test(body[i])) i++; }
      if (body[i] === ':') {
        const sigEnd = findSignatureEnd(body, nameStart);
        const fullSig = body.substring(nameStart, sigEnd).trim();
        methods.push({ name, signature: normalizeSignature(fullSig) });
        if (body[sigEnd] === '{') {
          let bd = 1, j = sigEnd + 1;
          while (j < body.length && bd > 0) { if (body[j] === '{') bd++; else if (body[j] === '}') bd--; if (bd === 0) break; j++; }
          i = j + 1;
        } else { i = sigEnd + 1; }
      } else { const sigEnd = findSignatureEnd(body, i); i = sigEnd + 1; }
      continue;
    }
    if (body[i] === '(') {
      const sigEnd = findSignatureEnd(body, nameStart);
      methods.push({ name, signature: normalizeSignature(body.substring(nameStart, sigEnd).trim()) });
      if (body[sigEnd] === '{') {
        let bd = 1, j = sigEnd + 1;
        while (j < body.length && bd > 0) { if (body[j] === '{') bd++; else if (body[j] === '}') bd--; if (bd === 0) break; j++; }
        i = j + 1;
      } else { i = sigEnd + 1; }
      continue;
    }
    while (i < body.length && body[i] !== ';' && body[i] !== '\n') i++;
    i++;
  }
  return methods;
}

function extractInterfaceMethods(content, interfaceName) {
  const cleaned = stripComments(content);
  let regex = new RegExp(`(?:export\\s+)?interface\\s+${interfaceName}\\s*(?:extends\\s+[^{]+)?\\s*\\{`);
  let match = regex.exec(cleaned);
  if (!match) { regex = new RegExp(`(?:export\\s+)?type\\s+${interfaceName}\\s*=\\s*(?:[^{]*?)\\{`); match = regex.exec(cleaned); }
  if (!match) return [];
  const body = extractBalancedBraces(cleaned, match.index + match[0].length);
  return body ? extractMethodsFromInterfaceBody(body) : [];
}

function extractClassMethods(content, className) {
  const cleaned = stripComments(content);
  const regex = new RegExp(`(?:export\\s+)?(?:abstract\\s+)?class\\s+${className}\\s*(?:extends\\s+[^{]+)?\\s*\\{`);
  const match = regex.exec(cleaned);
  if (!match) return [];
  const body = extractBalancedBraces(cleaned, match.index + match[0].length);
  return body ? extractMethodsFromInterfaceBody(body) : [];
}

function extractClassAndInterfaceDefs(content) {
  const cleaned = stripComments(content);
  const defs = [];

  // Classes: use simple regex to find class name, then manually skip generic params to find body
  const classRegex = /(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+(\w+)\b/g;
  let m;
  while ((m = classRegex.exec(cleaned)) !== null) {
    const className = m[1];
    let bracePos = m.index + m[0].length;
    let angleDepth = 0;
    while (bracePos < cleaned.length) {
      const ch = cleaned[bracePos];
      if (ch === '<') angleDepth++;
      else if (ch === '>') angleDepth--;
      else if (ch === '{' && angleDepth === 0) break;
      bracePos++;
    }
    if (bracePos >= cleaned.length) continue;
    const body = extractBalancedBraces(cleaned, bracePos + 1);
    if (!body) continue;
    const members = extractMethodsFromInterfaceBody(body);
    defs.push({ typeKind: 'class', name: className, members });
  }

  // Interfaces
  const ifaceRegex = /(?:export\s+)?interface\s+(\w+)\s*(?:extends\s+[^{]+)?\s*\{/g;
  while ((m = ifaceRegex.exec(cleaned)) !== null) {
    const ifaceName = m[1];
    const body = extractBalancedBraces(cleaned, m.index + m[0].length);
    if (!body) continue;
    const members = extractMethodsFromInterfaceBody(body);
    defs.push({ typeKind: 'interface', name: ifaceName, members });
  }

  // Type aliases
  const typeRegex = /(?:export\s+)?type\s+(\w+)\s*=/g;
  while ((m = typeRegex.exec(cleaned)) !== null) {
    const typeName = m[1];
    defs.push({ typeKind: 'type-alias', name: typeName, members: [] });
  }

  return defs;
}

function defsToInterfaces(defs, repoDir, sourceFile, typeLabel, layerLabel, content) {
  const type = typeLabel || 'type-decl';
  const layer = layerLabel || 'js';
  const interfaces = [];
  const sourceRel = rel(sourceFile, repoDir);
  for (const def of defs) {
    for (const member of def.members) {
      const isField = member.signature.includes(':') && !member.signature.includes('(') && !member.signature.includes('=>');
      const isDeprecated = content ? isDeprecatedMember(content, member.name) : false;
      if (isField) {
        const typeMatch = member.signature.match(/^\w+\??\s*:\s*(.+)$/);
        const fieldType = typeMatch ? typeMatch[1].trim() : '-';
        interfaces.push({
          className: def.name, memberName: member.name, fullName: `${def.name}.${member.name}`,
          kind: 'field', isStatic: false, isReadonly: /\breadonly\b/.test(member.signature),
          isOptional: member.signature.includes('?'), isEvent: /(?:onAnimation|onLayout)/.test(member.name),
          isDeprecated, type, layer, signature: member.signature, params: [], returnType: fieldType,
          description: '-', source: sourceRel, startLine: 0,
        });
      } else {
        const parsed = parseMethodSignature(member.signature);
        interfaces.push({
          className: def.name, memberName: member.name, fullName: `${def.name}.${member.name}`,
          kind: 'method', isStatic: /\bstatic\b/.test(member.signature), isReadonly: false,
          isOptional: false, isEvent: /(?:onAnimation|onLayout|Listener)/.test(member.name),
          isDeprecated, type, layer, signature: member.signature, params: parsed.params, returnType: parsed.returnType,
          description: '-', source: sourceRel, startLine: 0,
        });
      }
    }
  }
  return interfaces;
}

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeMd(text) { if (!text || text === '-') return '-'; return text.replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function formatParams(params) {
  if (!params || params.length === 0) return '';
  return params.map(p => `${p.name}${p.optional ? '?' : ''}: ${escapeMd(p.type)}`).join(', ');
}
function coverageBadge(rate) { const r = parseFloat(rate); if (r >= 80) return '高'; if (r >= 50) return '中'; if (r >= 20) return '低'; return '极低'; }

function parseArgs(argv) {
  // MCP Gateway 模式：第一个参数是 JSON 字符串
  if (argv.length > 0 && typeof argv[0] === 'string' && argv[0].startsWith('{')) {
    try { return JSON.parse(argv[0]); } catch (e) { /* 降级到 CLI 模式 */ }
  }
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].substring(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { parsed[key] = argv[i + 1]; i++; }
      else parsed[key] = true;
    }
  }
  return parsed;
}

function loadTypeScript() {
  // 最优先：libraryTestScan.js 通过环境变量注入的精确路径
  if (process.env.TYPESCRIPT_PATH) {
    try { const ts = require(process.env.TYPESCRIPT_PATH); if (ts && typeof ts.createProgram === 'function') return ts; } catch {}
  }
  for (const p of [path.join(__dirname, '..', 'node_modules', 'typescript'), path.join(__dirname, 'node_modules', 'typescript')]) {
    try { const ts = require(p); if (ts && typeof ts.createProgram === 'function') return ts; } catch {}
  }
  try { const ts = require('typescript'); if (ts && typeof ts.createProgram === 'function') return ts; } catch {}
  return null;
}

const ts = loadTypeScript();

// ════════════════════════════════════════════════════════════
// Part 1: 上游 npm 源码拉取
// ════════════════════════════════════════════════════════════

function extractFromReadme(repoDir) {
  const readmePath = path.join(repoDir, 'README.md');
  if (!fs.existsSync(readmePath)) return { pkgName: null, version: null };
  const content = fs.readFileSync(readmePath, 'utf-8');
  const match = content.match(/\[([a-z][a-z0-9-]*@(\d+\.\d+\.\d+[^)\]]*))\]/i);
  if (match) { const full = match[1], atIdx = full.indexOf('@'); return { pkgName: full.substring(0, atIdx), version: full.substring(atIdx + 1) }; }
  return { pkgName: null, version: null };
}

function resolveUpstream(repoDir, explicitVersion) {
  const pkg = readPackageJson(repoDir);
  const alias = getLibraryAlias(pkg);
  let pkgName = alias || (pkg && pkg.name && pkg.name.replace(/^@[^/]+\//, '')) || path.basename(repoDir);
  let version = null, source = '';
  if (explicitVersion) { version = explicitVersion; source = '用户指定 (--version)'; }
  if (!version && pkg && pkg.dependencies) {
    if (pkg.dependencies[alias]) { version = pkg.dependencies[alias]; source = `dependencies[${alias}]`; }
    if (!version) {
      for (const [dep, ver] of Object.entries(pkg.dependencies)) {
        if (dep.startsWith('react-native-') && !dep.startsWith('@react-native-ohos/') && !dep.includes('harmony-cli')) { version = ver; pkgName = dep; source = `dependencies[${dep}]`; break; }
      }
    }
  }
  if (!version) { const r = extractFromReadme(repoDir); if (r.version) { version = r.version; if (r.pkgName) pkgName = r.pkgName; source = `README 声明: ${pkgName}@${version}`; } }
  if (!version && pkg && pkg.version) { const inferred = pkg.version.replace(/-(beta|rc)\..*$/i, ''); if (inferred && inferred !== pkg.version) { version = inferred; source = `从鸿蒙版本 ${pkg.version} 推断`; } }
  if (!version) { version = 'latest'; source = 'npm latest (降级)'; }
  return { pkgName, version, source };
}

function npmPackAndExtract(pkgName, version, cacheDir) {
  const versionLabel = version === 'latest' ? 'latest' : version;
  const targetDir = path.join(cacheDir, `${pkgName}@${versionLabel}`);
  if (fs.existsSync(path.join(targetDir, 'package', 'package.json'))) { info(`上游源码缓存命中: ${targetDir}`); return path.join(targetDir, 'package'); }
  fs.mkdirSync(targetDir, { recursive: true });
  const spec = version === 'latest' ? pkgName : `${pkgName}@${version}`;
  info(`npm pack ${spec} ...`);
  try { execSync(`npm pack ${spec} --pack-destination "${targetDir}"`, { cwd: targetDir, stdio: 'pipe', timeout: 60000 }); }
  catch (e) { if (version !== 'latest') { warn(`版本 ${version} 不存在，降级到 latest`); return npmPackAndExtract(pkgName, 'latest', cacheDir); } error(`npm pack 失败: ${e.message}`); }
  const tgzFiles = fs.readdirSync(targetDir).filter(f => f.endsWith('.tgz'));
  if (tgzFiles.length === 0) error(`npm pack 未生成 tgz 文件: ${targetDir}`);
  info(`解压: ${tgzFiles[0]}`);
  try { execSync(`tar xzf "${path.join(targetDir, tgzFiles[0])}" -C "${targetDir}"`, { stdio: 'pipe' }); } catch (e) { error(`解压失败: ${e.message}`); }
  fs.unlinkSync(path.join(targetDir, tgzFiles[0]));
  const sourceDir = path.join(targetDir, 'package');
  if (!fs.existsSync(sourceDir)) error(`解压后未找到 package/ 目录: ${targetDir}`);
  ok(`上游源码已拉取: ${pkgName}@${versionLabel}`);
  return sourceDir;
}

function fetchUpstream(repoDir, opts = {}) {
  const { version: explicitVersion, cacheDir } = opts;
  const { pkgName, version, source: versionSource } = resolveUpstream(repoDir, explicitVersion);
  info(`上游包: ${pkgName}, 版本: ${version} (${versionSource})`);
  const finalCacheDir = cacheDir || path.join(repoDir, '.upstream-cache');
  const sourceDir = npmPackAndExtract(pkgName, version, finalCacheDir);
  return { sourceDir, isUpstream: true, pkgName, version };
}

// ════════════════════════════════════════════════════════════
// Part 2: 接口提取
// ════════════════════════════════════════════════════════════

function detectExportStyle(content) {
  const cleaned = stripComments(content);
  if (/module\.exports\s*=/.test(cleaned)) return 'commonjs';
  if (/export\s+(default|{|function|class|const|interface|type|\*)/.test(cleaned)) return 'es-module';
  if (/global\.\w+/.test(cleaned)) return 'side-effect';
  return 'unknown';
}

function parseMethodSignature(sig) {
  const params = [];
  let returnType = 'void';
  let match = sig.match(/^(\w+)\s*\(([^)]*)\)\s*:\s*(.+)$/);
  if (!match) match = sig.match(/^(\w+)\s*:\s*\(([^)]*)\)\s*=>\s*(.+)$/);
  if (!match) match = sig.match(/^(\w+)\s*\(([^)]*)\)$/);
  if (match) {
    if (match[2] && match[2].trim()) params.push(...parseParamList(match[2]));
    if (match[3]) returnType = match[3].trim();
  }
  return { params, returnType };
}

function parseParamList(paramStr) {
  const params = [];
  if (!paramStr || !paramStr.trim()) return params;
  const parts = [];
  let depth = 0, current = '';
  for (const ch of paramStr) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  for (const part of parts) {
    const m = part.match(/^(\w+)\s*(\?)?\s*:\s*(.+)$/);
    if (m) params.push({ name: m[1], type: m[3].trim(), optional: !!m[2], description: '-' });
    else params.push({ name: part, type: 'any', optional: false, description: '-' });
  }
  return params;
}

function extractMethodJSDoc(content, methodName) {
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*(?://|/\\*)\\s*([^\\n*/]*)\\s*(?:\\*/)?\\s*(?:^|\\n)\\s*(?:readonly\\s+|static\\s+)*${methodName}\\s*[\\(:]`, 'm'),
    new RegExp(`\\/\\*\\*\\s*([\\s\\S]*?)\\*\\/\\s*(?:readonly\\s+|static\\s+)*${methodName}\\s*[\\(:]`),
  ];
  for (const pattern of patterns) {
    const m = content.match(pattern);
    if (m && m[1]) { const desc = m[1].replace(/^\s*\*\s?/gm, '').trim(); if (desc && !desc.startsWith('@')) return desc.split('\n')[0].trim(); }
  }
  const lm = content.match(new RegExp(`\\/\\/\\s*(.+)\\s*\\n\\s*${methodName}\\s*[\\(:]`));
  if (lm && lm[1]) return lm[1].trim();
  return '-';
}

function isDeprecatedMember(content, memberName) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('@deprecated')) {
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].includes('/**')) {
          let endJ = i;
          while (endJ < lines.length && !lines[endJ].includes('*/')) endJ++;
          for (let k = endJ + 1; k < Math.min(endJ + 4, lines.length); k++) {
            const line = lines[k].trim();
            if (!line || line.startsWith('*') || line.startsWith('//')) continue;
            const declPattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|readonly|static|get|set)\\s+${memberName}\\b`);
            const fieldPattern = new RegExp(`^${memberName}\\s*\\??\\s*:`);
            if (declPattern.test(line) || fieldPattern.test(line)) return true;
            break;
          }
          break;
        }
      }
    }
  }
  return false;
}

function findMethodLineNumber(content, methodName) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`\\b${methodName}\\s*[\\(:]`).test(lines[i]) && !lines[i].trim().startsWith('//')) return i + 1;
  }
  return 0;
}

function extractTurboModuleSpecs(repoDir) {
  const specFiles = findTurboModuleSpecFiles(repoDir);
  const files = [], interfaces = [];
  for (const specFile of specFiles) {
    const content = readText(specFile);
    const basic = extractTurboModuleSpec(content);
    if (basic.methods.length === 0 && !basic.moduleName) continue;
    files.push(rel(specFile, repoDir));
    for (const method of basic.methods) {
      const parsed = parseMethodSignature(method.signature);
      interfaces.push({
        className: basic.moduleName, memberName: method.name, fullName: `${basic.moduleName}.${method.name}`,
        kind: 'method', isStatic: false, isReadonly: false, isOptional: false,
        isEvent: /(?:add|remove)\w*Listener/.test(method.name),
        type: 'turbo-module', layer: 'turbo', signature: method.signature,
        params: parsed.params, returnType: parsed.returnType,
        description: extractMethodJSDoc(content, method.name), source: rel(specFile, repoDir), startLine: findMethodLineNumber(content, method.name),
      });
    }
  }
  return { files, interfaces };
}

function extractFabricComponentSpecs(repoDir) {
  const specFiles = findTurboModuleSpecFiles(repoDir);
  const files = [], interfaces = [];

  for (const specFile of specFiles) {
    const content = readText(specFile);
    const cleaned = stripComments(content);
    const sourceRel = rel(specFile, repoDir);

    const isFabric = /codegenNativeComponent/.test(cleaned) || /codegenNativeCommands/.test(cleaned);
    const isTurboModule = /interface\s+Spec\s+extends\s+TurboModule/.test(cleaned);
    if (!isFabric && !isTurboModule) continue;

    files.push(sourceRel);

    const defs = extractClassAndInterfaceDefs(content);
    const allFabricInterfaces = defsToInterfaces(defs, repoDir, specFile, 'fabric-spec', 'fabric', content);

    for (const iface of allFabricInterfaces) {
      if (isFabric && iface.className === 'NativeProps') {
        if (iface.signature && /DirectEventHandler/.test(iface.signature)) continue;
        if (iface.memberName === 'isFirstRefresh') continue;
        interfaces.push(iface);
      }
    }
  }

  return { files, interfaces };
}

function extractCommonJSExports(content, repoDir, entryFile) {
  const cleaned = stripComments(content);
  const interfaces = [];
  const match = cleaned.match(/module\.exports\s*=\s*\{/);
  if (!match) return interfaces;
  const body = extractBalancedBraces(cleaned, match.index + match[0].length);
  if (!body) return interfaces;
  const funcRegex = /(?:^|\n)\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/g;
  const seen = new Set();
  let m;
  while ((m = funcRegex.exec(body)) !== null) {
    const name = m[1];
    if (seen.has(name) || ['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'try'].includes(name)) continue;
    seen.add(name);
    const paramStr = m[2];
    interfaces.push({
      className: null, memberName: name, fullName: name, kind: 'function',
      isStatic: false, isReadonly: false, isOptional: false,
      isEvent: /(?:add|remove)\w*Listener/.test(name),
      type: 'commonjs-export', layer: 'js', signature: `${name}(${paramStr})`,
      params: parseParamList(paramStr), returnType: 'void',
      description: extractMethodJSDoc(content, name), source: rel(entryFile, repoDir), startLine: findMethodLineNumber(content, name),
    });
  }
  const namedFuncRegex = /(\w+)\s*:\s*(?:async\s+)?function\s*\(([^)]*)\)/g;
  while ((m = namedFuncRegex.exec(body)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const paramStr = m[2];
    interfaces.push({
      className: null, memberName: name, fullName: name, kind: 'function',
      isStatic: false, isReadonly: false, isOptional: false,
      isEvent: /(?:add|remove)\w*Listener/.test(name),
      type: 'commonjs-export', layer: 'js', signature: `${name}(${paramStr})`,
      params: parseParamList(paramStr), returnType: 'void',
      description: extractMethodJSDoc(content, name), source: rel(entryFile, repoDir), startLine: findMethodLineNumber(content, name),
    });
  }
  return interfaces;
}

function processNamedExportsFromContent(content, repoDir, sourceFile, namedExports) {
  const interfaces = [];
  const cleaned = stripComments(content);
  const sourceRel = rel(sourceFile, repoDir);
  for (const name of namedExports) {
    const isDeprecated = isDeprecatedMember(content, name);
    const funcMatch = cleaned.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*(?:<[^>]*>)?\\s*\\(([\\s\\S]*?)\\)\\s*(?::\\s*([^{{]+?))?\\s*[{=]`));
    if (funcMatch) {
      const paramStr = (funcMatch[1] || '').replace(/\n/g, ' ').trim();
      const retType = funcMatch[2] ? funcMatch[2].trim() : '-';
      interfaces.push({
        className: null, memberName: name, fullName: name, kind: 'function',
        isStatic: false, isReadonly: false, isOptional: false, isEvent: false, isDeprecated,
        type: 'es-export', layer: 'js', signature: `${name}(${paramStr})${retType !== '-' ? ': ' + retType : ''}`,
        params: parseParamList(paramStr), returnType: retType,
        description: extractMethodJSDoc(content, name), source: sourceRel, startLine: findMethodLineNumber(content, name),
      });
      continue;
    }
    const classMatch = cleaned.match(new RegExp(`export\\s+(?:abstract\\s+)?class\\s+${name}\\b`));
    if (classMatch) {
      const classMethods = extractClassMethods(content, name);
      for (const method of classMethods) {
        const parsed = parseMethodSignature(method.signature);
        const methodDeprecated = isDeprecatedMember(content, method.name);
        interfaces.push({
          className: name, memberName: method.name, fullName: `${name}.${method.name}`, kind: 'method',
          isStatic: /\bstatic\b/.test(method.signature), isReadonly: false, isOptional: false, isEvent: false,
          isDeprecated: methodDeprecated, type: 'es-export', layer: 'js', signature: method.signature,
          params: parsed.params, returnType: parsed.returnType, description: '-',
          source: sourceRel, startLine: 0,
        });
      }
      continue;
    }
    const constMatch = cleaned.match(new RegExp(`export\\s+(?:const|let|var)\\s+${name}\\s*(?::\\s*([^=]+?))?\\s*=\\s*([^;\\n]+)`));
    if (constMatch) {
      const varType = constMatch[1] ? constMatch[1].trim() : '-';
      const varValue = constMatch[2].trim();
      interfaces.push({
        className: null, memberName: name, fullName: name, kind: 'variable',
        isStatic: false, isReadonly: false, isOptional: false, isEvent: false, isDeprecated,
        type: 'es-export', layer: 'js', signature: `${name}${varType !== '-' ? ': ' + varType : ''} = ${varValue}`,
        params: [], returnType: varType, description: '-', source: sourceRel, startLine: 0,
      });
    }
  }
  return interfaces;
}

function extractESModuleExports(content, repoDir, entryFile) {
  const exports = extractExports(content);
  const interfaces = [];
  const cleaned = stripComments(content);
  interfaces.push(...processNamedExportsFromContent(content, repoDir, entryFile, exports.named));
  for (const name of exports.types) {
    const ifaceMethods = extractInterfaceMethods(content, name);
    for (const method of ifaceMethods) {
      const parsed = parseMethodSignature(method.signature);
      interfaces.push({
        className: name, memberName: method.name, fullName: `${name}.${method.name}`, kind: 'method',
        isStatic: false, isReadonly: false, isOptional: false, isEvent: false,
        type: 'type-decl', layer: 'js', signature: method.signature,
        params: parsed.params, returnType: parsed.returnType, description: '-',
        source: rel(entryFile, repoDir), startLine: 0,
      });
    }
  }

  // ── re-export 链追踪 ──────────────────────────────────

  // 1. Wildcard re-export tracking (export * from './types')
  for (const reExport of exports.reExports) {
    if (!reExport.isWildcard) continue;
    const targetFile = resolveRelativePath(entryFile, reExport.from);
    if (!targetFile) continue;
    const targetContent = readText(targetFile);
    const defs = extractClassAndInterfaceDefs(targetContent);
    interfaces.push(...defsToInterfaces(defs, repoDir, targetFile, undefined, undefined, targetContent));
    const targetExports = extractExports(targetContent);
    interfaces.push(...processNamedExportsFromContent(targetContent, repoDir, targetFile, targetExports.named));

    // Recursively process re-exports in the target file
    for (const subReExport of targetExports.reExports) {
      if (!subReExport.isWildcard) continue;
      const subTarget = resolveRelativePath(targetFile, subReExport.from);
      if (!subTarget) continue;
      const subContent = readText(subTarget);
      const subDefs = extractClassAndInterfaceDefs(subContent);
      interfaces.push(...defsToInterfaces(subDefs, repoDir, subTarget, undefined, undefined, subContent));
      const subExports = extractExports(subContent);
      interfaces.push(...processNamedExportsFromContent(subContent, repoDir, subTarget, subExports.named));
    }
  }

  // 2. Named re-export tracking (export { Foo } from './bar')
  for (const reExport of exports.reExports) {
    if (reExport.isWildcard) continue;
    const targetFile = resolveRelativePath(entryFile, reExport.from);
    if (!targetFile) continue;
    const targetContent = readText(targetFile);
    const defs = extractClassAndInterfaceDefs(targetContent);
    const filteredDefs = defs.filter(d => d.name === reExport.original || d.name === reExport.name);
    interfaces.push(...defsToInterfaces(filteredDefs, repoDir, targetFile, undefined, undefined, targetContent));
    if (!reExport.isType) {
      interfaces.push(...processNamedExportsFromContent(targetContent, repoDir, targetFile, [reExport.original, reExport.name]));
    }
  }

  // 3. Default export import tracking (import { LottieView } from './LottieView'; export default LottieView)
  if (exports.defaultExport && !exports.named.includes(exports.defaultExport)) {
    const importRegex = new RegExp(`import\\s+\\{[^}]*\\b${escapeRegex(exports.defaultExport)}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`);
    const importMatch = cleaned.match(importRegex);
    if (importMatch) {
      const targetFile = resolveRelativePath(entryFile, importMatch[1]);
      if (targetFile) {
        const targetContent = readText(targetFile);
        const defs = extractClassAndInterfaceDefs(targetContent);
        const filteredDefs = defs.filter(d => d.name === exports.defaultExport);
        interfaces.push(...defsToInterfaces(filteredDefs, repoDir, targetFile, undefined, undefined, targetContent));
      }
    }
  }

  return interfaces;
}

function extractSideEffectExports(content, repoDir, entryFile) {
  const cleaned = stripComments(content);
  const interfaces = [];
  const globalAssignRegex = /global\.(\w+(?:\.\w+)*)\s*=\s*(\w+|function\s*\([^)]*\))/g;
  const seen = new Set();
  let m;
  while ((m = globalAssignRegex.exec(cleaned)) !== null) {
    const fullPath = m[1], target = m[2];
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);
    const parts = fullPath.split('.');
    const memberName = parts[parts.length - 1];
    const className = parts.length > 1 ? parts.slice(0, -1).join('.') : null;
    const isFunction = target.startsWith('function') || /^[a-zA-Z_$]/.test(target);
    interfaces.push({
      className, memberName, fullName: fullPath,
      kind: isFunction ? 'function' : 'variable',
      isStatic: false, isReadonly: false, isOptional: false, isEvent: false,
      type: 'side-effect', layer: 'js', signature: `global.${fullPath} = ${target}`,
      params: [], returnType: isFunction ? 'void' : '-',
      description: `Side-effect: patches global.${fullPath}`,
      source: rel(entryFile, repoDir), startLine: findMethodLineNumber(content, memberName),
    });
  }
  return interfaces;
}

function extractTypeDefinitions(repoDir) {
  const pkg = readPackageJson(repoDir);
  const candidates = [
    path.join(repoDir, 'index.d.ts'),
    path.join(repoDir, 'lib', 'typescript', 'index.d.ts'),
    path.join(repoDir, 'types', 'index.d.ts'),
    path.join(repoDir, 'dist', 'index.d.ts'),
  ];
  if (pkg && pkg.types) candidates.unshift(path.resolve(repoDir, pkg.types));
  if (pkg && pkg.typings) candidates.unshift(path.resolve(repoDir, pkg.typings));

  let dtsPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { dtsPath = c; break; }
  }
  if (!dtsPath) return { found: false, interfaces: [], source: null, allSources: [] };

  const allSources = [];
  const interfaces = [];
  const visited = new Set();

  function processDts(filePath) {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    allSources.push(rel(filePath, repoDir));

    const content = readText(filePath);
    const defs = extractClassAndInterfaceDefs(content);
    interfaces.push(...defsToInterfaces(defs, repoDir, filePath, undefined, undefined, content));

    // Track re-exports
    const exports = extractExports(content);
    for (const reExport of exports.reExports) {
      const targetFile = resolveRelativePathDts(filePath, reExport.from);
      if (targetFile) processDts(targetFile);
    }

    // Track default export import source
    if (exports.defaultExport) {
      const importRegex = new RegExp(`import\\s+\\{[^}]*\\b${escapeRegex(exports.defaultExport)}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`);
      const cleaned = stripComments(content);
      const importMatch = cleaned.match(importRegex);
      if (importMatch) {
        const targetFile = resolveRelativePathDts(filePath, importMatch[1]);
        if (targetFile) processDts(targetFile);
      }
    }

    // Track named export import sources
    for (const namedExport of exports.named) {
      const importRegex = new RegExp(`import\\s+\\{[^}]*\\b${escapeRegex(namedExport)}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`);
      const cleaned = stripComments(content);
      const importMatch = cleaned.match(importRegex);
      if (importMatch) {
        const targetFile = resolveRelativePathDts(filePath, importMatch[1]);
        if (targetFile) processDts(targetFile);
      }
    }
  }

  processDts(dtsPath);

  return { found: true, interfaces, source: rel(dtsPath, repoDir), allSources };
}

// ════════════════════════════════════════════════════════════
// Part 3: 接口规格生成
// ════════════════════════════════════════════════════════════

function generateRNSpec(repoDir, opts = {}) {
  const absDir = path.resolve(repoDir);
  if (!fs.existsSync(absDir)) error(`目录不存在: ${repoDir}`);
  const pkg = readPackageJson(absDir);
  const libraryName = (pkg && pkg.name) || path.basename(absDir);
  const libraryAlias = getLibraryAlias(pkg) || libraryName.replace(/^@[^/]+\//, '');

  info('拉取上游 npm 源码...');
  const upstreamInfo = fetchUpstream(absDir, { version: opts.upstreamVersion });
  const upstreamDir = upstreamInfo.sourceDir;
  function upstreamRel(filePath) { return `upstream:${upstreamInfo.pkgName}@${upstreamInfo.version}/${path.relative(upstreamDir, filePath).split(path.sep).join('/')}`; }

  const sources = [], interfaces = [];

  // JS 层导出 — 从上游源码提取
  const entryFile = detectEntryFile(upstreamDir);
  const entryContent = entryFile ? readText(entryFile) : '';
  const exportStyle = entryFile ? detectExportStyle(entryContent) : 'unknown';
  if (entryFile) sources.push(upstreamRel(entryFile));

  info(`JS 层导出 (模式: ${exportStyle}, 来源: 上游)...`);
  let jsInterfaces = [];
  if (exportStyle === 'commonjs') {
    jsInterfaces = extractCommonJSExports(entryContent, upstreamDir, entryFile);
    for (const i of jsInterfaces) i.source = upstreamRel(entryFile);
  }
  else if (exportStyle === 'es-module') {
    jsInterfaces = extractESModuleExports(entryContent, upstreamDir, entryFile);
    const entryRel = rel(entryFile, upstreamDir);
    for (const i of jsInterfaces) {
      if (i.source && !i.source.startsWith('upstream:') && i.source !== entryRel) {
        const fullSrc = `upstream:${upstreamInfo.pkgName}@${upstreamInfo.version}/${i.source.replace(/^\.\//, '')}`;
        i.source = fullSrc;
        if (!sources.includes(fullSrc)) sources.push(fullSrc);
      } else if (!i.source || i.source === entryRel) {
        i.source = upstreamRel(entryFile);
      }
    }
  }
  else if (exportStyle === 'side-effect') {
    jsInterfaces = extractSideEffectExports(entryContent, upstreamDir, entryFile);
    for (const i of jsInterfaces) i.source = upstreamRel(entryFile);
  }
  interfaces.push(...jsInterfaces);
  ok(`JS 层导出: ${jsInterfaces.length} 个接口`);

  // 类型定义层 (index.d.ts) — 从上游源码提取
  info('提取类型定义 (index.d.ts, 来源: 上游)...');
  const typeDefs = extractTypeDefinitions(upstreamDir);
  if (typeDefs.found) {
    for (const src of typeDefs.allSources || [typeDefs.source]) {
      const fullSrc = `upstream:${upstreamInfo.pkgName}@${upstreamInfo.version}/${src.replace(/^\.\//, '')}`;
      if (!sources.includes(fullSrc)) sources.push(fullSrc);
    }
    interfaces.push(...typeDefs.interfaces);
    for (const i of typeDefs.interfaces) {
      const fullSrc = `upstream:${upstreamInfo.pkgName}@${upstreamInfo.version}/${(i.source || typeDefs.source).replace(/^\.\//, '')}`;
      i.source = fullSrc;
    }
    ok(`类型定义: ${typeDefs.interfaces.length} 个接口`);
  } else { info('上游源码未找到 index.d.ts，跳过类型定义提取'); }

  // Fabric Component / TurboModule Spec — 从鸿蒙化仓库提取
  info('提取 Fabric Component / TurboModule Spec (来源: 鸿蒙化仓库)...');
  const fabricSpecs = extractFabricComponentSpecs(absDir);
  if (fabricSpecs.files.length > 0) {
    for (const f of fabricSpecs.files) {
      const fullSrc = `ohos:${f}`;
      if (!sources.includes(fullSrc)) sources.push(fullSrc);
    }
    for (const i of fabricSpecs.interfaces) { i.source = `ohos:${i.source}`; }
    interfaces.push(...fabricSpecs.interfaces);
    ok(`Fabric/TurboModule Spec: ${fabricSpecs.interfaces.length} 个接口`);
  } else { info('未找到 Fabric/TurboModule Spec 文件'); }

  const seen = new Set();
  const deduped = interfaces.filter(i => {
    if (i.className === 'NativeSafeAreaProviderProps') return false;
    if (seen.has(i.fullName)) return false;
    seen.add(i.fullName);
    return true;
  });

  const methods = deduped.filter(i => i.kind === 'method' || i.kind === 'function');
  const fields = deduped.filter(i => i.kind === 'field');
  const classSet = new Set(deduped.filter(i => i.className).map(i => i.className));

  ok(`接口提取完成: ${deduped.length} 个接口, ${classSet.size} 个类/模块`);
  return {
    libraryName, libraryAlias,
    entryFile: entryFile ? upstreamRel(entryFile) : null,
    exportStyle,
    upstream: { pkgName: upstreamInfo.pkgName, version: upstreamInfo.version, isUpstream: true },
    extractedAt: new Date().toISOString(),
    summary: { S: classSet.size, N: deduped.length, M: 0, methods: methods.length, properties: 0, fields: fields.length },
    sources, interfaces: deduped,
  };
}

function loadSpec(args) {
  const specPath = args.spec;
  const libRoot = args.libroot || args.repoDir || (specPath ? path.dirname(specPath) : '');
  let spec, specBasename;
  if (specPath) {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    specBasename = spec.libraryName ? spec.libraryName.replace(/^@[^/]+\//, '') : path.basename(specPath, '-interface-spec.json');
    info(`读取接口规格: ${specPath} (${spec.interfaces ? spec.interfaces.length : 0} 个接口)`);
  } else if (libRoot) {
    info(`从源码目录提取接口: ${libRoot}`);
    spec = generateRNSpec(libRoot, { upstreamVersion: args.version });
    specBasename = spec.libraryName ? spec.libraryName.replace(/^@[^/]+\//, '') : path.basename(libRoot);
    ok(`提取完成: ${spec.interfaces ? spec.interfaces.length : 0} 个接口, 库名: ${spec.libraryName}`);
  } else return null;
  return { spec, libRoot, specBasename };
}

// ════════════════════════════════════════════════════════════
// 导出
// ════════════════════════════════════════════════════════════

module.exports = {
  generateRNSpec, loadSpec,
  fetchUpstream, resolveUpstream,
  // 供 rn-scan-exports.cjs 等外部模块使用
  readText, rel, walkDir, readPackageJson, getLibraryAlias,
  detectEntryFile, findTurboModuleSpecFiles, resolveRelativePath, resolveRelativePathDts,
  stripComments, extractBalancedBraces, findSignatureEnd, normalizeSignature,
  extractMethodsFromInterfaceBody, extractExports, extractTurboModuleSpec,
  extractInterfaceMethods, extractClassMethods,
  extractClassAndInterfaceDefs, defsToInterfaces,
  extractFabricComponentSpecs,
  escapeRegex, escapeMd, formatParams, coverageBadge,
  parseArgs, loadTypeScript, info, ok, warn, error,
};

// ── CLI 入口 ──────────────────────────────────────────────

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const repoDir = args.repoDir || args.libroot || args._;
  if (!repoDir) { console.error('用法: node rn-extract-interfaces.cjs --repoDir <库根目录> [--output <spec.json>] [--version <上游版本>]'); process.exit(1); }
  const spec = generateRNSpec(repoDir, { upstreamVersion: args.version });
  const json = JSON.stringify(spec, null, 2);
  if (args.output) { fs.mkdirSync(path.dirname(args.output), { recursive: true }); fs.writeFileSync(args.output, json, 'utf-8'); ok(`接口规格已写入: ${args.output}`); }
  else console.log(json);
}
