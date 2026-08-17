#!/usr/bin/env node
/**
 * Analyze demo source files: extract file list, external dependencies,
 * target library references, and entry file info.
 *
 * Usage: node analyze-demo-deps.cjs <demoPath> [--lib-name <packageName>] [--alias <harmony.alias>]
 *
 * Output: JSON with:
 *   - files: relative file paths (.ts/.tsx/.js/.jsx)
 *   - externalDeps: non-relative, non-builtin package names
 *   - libReferences: how demo imports the target library
 *   - entryFiles: App.tsx / index.tsx paths + displayName
 *   - nativeFiles: .ets/.cpp/.h files (not migrated, flagged for shell adaptation)
 *
 * Exit codes: 0 = success, 1 = error
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const demoPath = args[0];
if (!demoPath) {
  console.error('Usage: node analyze-demo-deps.cjs <demoPath> [--lib-name <packageName>] [--alias <harmony.alias>]');
  process.exit(1);
}

let libName = '';
let alias = '';
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--lib-name' && args[i + 1]) { libName = args[++i]; }
  else if (args[i] === '--alias' && args[i + 1]) { alias = args[++i]; }
}

if (!fs.existsSync(demoPath) || !fs.statSync(demoPath).isDirectory()) {
  console.error(`Demo path not found or not a directory: ${demoPath}`);
  process.exit(1);
}

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const NATIVE_EXTENSIONS = new Set(['.ets', '.cpp', '.h', '.c', '.cc']);
const EXCLUDE_DIRS = new Set([
  'node_modules', 'build', '__tests__', '.cxx', 'oh_modules',
  '.git', '.hg', 'dist', 'coverage', '.cache',
]);

// Node.js builtin modules (subset; covers common ones)
const BUILTIN_MODULES = new Set([
  'fs', 'path', 'util', 'os', 'url', 'http', 'https', 'crypto', 'stream',
  'buffer', 'events', 'child_process', 'net', 'tls', 'dns', 'zlib',
  'querystring', 'assert', 'process', 'timers', 'worker_threads',
  'assert/strict', 'util/types', 'path/posix', 'path/win32',
]);

const REACT_CORE = new Set(['react', 'react-native', 'react/jsx-runtime', 'react-native/Libraries/*']);

function walk(dir, files, nativeFiles, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files, nativeFiles, base);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full);
      if (JS_EXTENSIONS.has(ext)) {
        files.push(rel);
      } else if (NATIVE_EXTENSIONS.has(ext)) {
        nativeFiles.push(rel);
      }
    }
  }
}

/**
 * Extract import/require module specifiers from source code.
 * Supports:
 *   - ES: import X from 'mod'; import { X } from 'mod'; import * as X from 'mod';
 *         import 'mod'; export * from 'mod'; export { X } from 'mod';
 *   - CommonJS: require('mod'); require.resolve('mod');
 * Returns array of { kind, module, names? }
 */
function extractImports(source) {
  const refs = [];
  // ES import / export ... from 'mod'
  const esFromRegex = /(?:import|export)\s+(?:([^'";]+?)\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = esFromRegex.exec(source)) !== null) {
    const clause = m[1] || '';
    const mod = m[2];
    if (!mod) continue;
    const names = parseImportClause(clause);
    refs.push({ kind: names.default || names.named.length > 0 ? names.kind : 'side-effect', module: mod, names });
  }
  // Side-effect import: import 'mod';
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;
  while ((m = sideEffectRegex.exec(source)) !== null) {
    refs.push({ kind: 'side-effect', module: m[1], names: { default: null, named: [], kind: 'side-effect' } });
  }
  // CommonJS require('mod')
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRegex.exec(source)) !== null) {
    refs.push({ kind: 'cjs', module: m[1], names: { default: null, named: [], kind: 'cjs' } });
  }
  return refs;
}

function parseImportClause(clause) {
  const result = { default: null, named: [], namespace: null, kind: 'named' };
  if (!clause) return result;
  const trimmed = clause.trim();

  // namespace: * as X
  const nsMatch = trimmed.match(/\*\s+as\s+(\w+)/);
  if (nsMatch) {
    result.namespace = nsMatch[1];
    result.kind = 'namespace';
  }

  // Extract named imports from { X, Y as Z, ... } (handles multi-line and spaces)
  const namedMatch = trimmed.match(/\{([^}]*)\}/);
  if (namedMatch) {
    const inner = namedMatch[1];
    if (inner.trim()) {
      for (const item of inner.split(',')) {
        const itemName = item.trim().split(/\s+as\s+/)[0].trim();
        if (itemName) result.named.push(itemName);
      }
    }
  }

  // Extract default import: everything outside braces and namespace alias
  let defaultPart = trimmed
    .replace(/\{[^}]*\}/, '')   // remove { ... }
    .replace(/\*\s+as\s+\w+/, '') // remove * as X
    .replace(/^[\s,]+|[\s,]+$/g, ''); // trim leading/trailing commas and whitespace
  if (defaultPart && defaultPart !== '*') {
    result.default = defaultPart.split(/\s+as\s+/)[0].trim();
    if (result.kind === 'namespace' || result.named.length > 0) {
      result.kind = 'mixed';
    } else {
      result.kind = 'default';
    }
  }

  return result;
}

function isRelative(mod) {
  return mod.startsWith('./') || mod.startsWith('../') || mod === '.' || mod === '..';
}

function isBuiltin(mod) {
  const base = mod.split('/')[0];
  return BUILTIN_MODULES.has(base) || BUILTIN_MODULES.has(mod);
}

function isReactCore(mod) {
  const base = mod.split('/')[0];
  return REACT_CORE.has(base) || REACT_CORE.has(mod);
}

function isTargetLib(mod) {
  if (!libName && !alias) return false;
  const base = mod.split('/')[0];
  if (alias && (mod === alias || base === alias)) return true;
  if (libName && (mod === libName || base === libName)) return true;
  // also handle scoped: @scope/pkg
  if (libName && mod.startsWith(libName + '/')) return true;
  if (alias && mod.startsWith(alias + '/')) return true;
  return false;
}

function classifyDep(mod) {
  if (isRelative(mod)) return 'relative';
  if (isBuiltin(mod)) return 'builtin';
  if (isReactCore(mod)) return 'react-core';
  if (isTargetLib(mod)) return 'target-lib';
  const base = mod.split('/')[0];
  if (base.startsWith('@react-native-oh') || base.startsWith('@rnoh') || mod.includes('react-native-harmony')) {
    return 'rnoh';
  }
  if (base.startsWith('react-native') || base.startsWith('@react-native') || base.startsWith('@react-native-community')) {
    return 'rn-general';
  }
  return 'third-party';
}

// Main
const files = [];
const nativeFiles = [];
walk(demoPath, files, nativeFiles);

const externalDeps = new Set();
const libReferences = [];
const entryFiles = { app: null, index: null, displayName: null, title: null };

for (const rel of files) {
  const full = path.join(demoPath, rel);
  const source = fs.readFileSync(full, 'utf8');
  const refs = extractImports(source);

  for (const ref of refs) {
    const cat = classifyDep(ref.module);
    if (cat === 'relative' || cat === 'builtin' || cat === 'react-core') continue;
    if (cat === 'target-lib') {
      libReferences.push({
        file: rel,
        kind: ref.kind,
        module: ref.module,
        names: ref.names.named,
        default: ref.names.default,
        namespace: ref.names.namespace,
      });
      continue;
    }
    // For external deps, strip subpath (keep scope/pkg)
    const base = ref.module.startsWith('@')
      ? ref.module.split('/').slice(0, 2).join('/')
      : ref.module.split('/')[0];
    externalDeps.add(base);
  }

  // Detect entry files
  const baseName = path.basename(rel);
  if (baseName === 'App.tsx' || baseName === 'App.ts' || baseName === 'App.jsx' || baseName === 'App.js') {
    if (!entryFiles.app) entryFiles.app = rel;
    // Extract displayName
    const dnMatch = source.match(/\.displayName\s*=\s*['"]([^'"]+)['"]/);
    if (dnMatch) entryFiles.displayName = dnMatch[1];
    const titleMatch = source.match(/title\s*[:=]\s*['"]([^'"]+)['"]/);
    if (titleMatch && !entryFiles.title) entryFiles.title = titleMatch[1];
  }
  if ((baseName === 'index.tsx' || baseName === 'index.ts' || baseName === 'index.jsx' || baseName === 'index.js') && !entryFiles.index) {
    entryFiles.index = rel;
  }
}

const result = {
  demoPath: path.resolve(demoPath),
  files,
  fileCount: files.length,
  nativeFiles,
  nativeFileCount: nativeFiles.length,
  externalDeps: [...externalDeps].sort(),
  libReferences,
  entryFiles,
};

console.log(JSON.stringify(result, null, 2));
