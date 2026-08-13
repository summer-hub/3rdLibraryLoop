#!/usr/bin/env node
/**
 * scan-exports.js
 *
 * 扫描 RN 三方库的对外导出接口 (public API) 和 TurboModule Spec。
 *
 * 用途:
 *   在版本差异分析中, 确定两个版本之间的 JS 层接口变更,
 *   从而判断鸿蒙侧是否需要原生适配 (接口不变 → 无需适配; 接口变更 → 需适配)。
 *
 * 扫描内容:
 *   1. 包入口文件 (index.ts/tsx 或 package.json 的 source/main 字段指向的文件)
 *      → 提取所有 export: default, named, type, re-export
 *   2. TurboModule Spec 文件 (匹配 Native*.ts 模式, 通常在 src/ 下)
 *      → 提取 Spec interface 的方法名和签名
 *   3. 公共接口/类型定义 (入口文件 re-export 的 interface/type/class)
 *      → 提取方法签名
 *
 * 输出:
 *   JSON 格式, 包含:
 *   - entryFile: 入口文件路径
 *   - exports: { default, named[], types[] }
 *   - turboModuleSpec: { moduleName, methods[] }
 *
 * 用法:
 *   # 扫描单个目录
 *   node scan-exports.js <源码目录>
 *
 *   # 扫描并指定包入口 (覆盖自动检测)
 *   node scan-exports.js <源码目录> --entry src/index.ts
 *
 *   # 对比两个目录, 输出接口差异
 *   node scan-exports.js --compare <目录1> <目录2>
 *
 *   # 只输出 JSON (适合脚本调用)
 *   node scan-exports.js -q <源码目录>
 *
 * 示例:
 *   # 扫描 async-storage v2.2.0
 *   node scan-exports.js ./diff/v2.2.0/packages/default-storage
 *
 *   # 对比两个版本的接口差异
 *   node scan-exports.js --compare \
 *     ./diff/v2.2.0/packages/default-storage \
 *     ./diff/v3.1.1/packages/async-storage
 */

'use strict';

const fs = require('fs');
const path = require('path');

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
function error(msg) { console.error(`${COLORS.RED}[ERROR]${COLORS.NC} ${msg}`); process.exit(1); }

// ── 参数解析 ─────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    compare: false,
    quiet: false,
    entry: '',
    output: '',
    dirs: [],
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--compare':   opts.compare = true; i += 1; break;
      case '-q':
      case '--quiet':     opts.quiet = true; i += 1; break;
      case '--entry':     opts.entry = args[i + 1]; i += 2; break;
      case '-o':
      case '--output':    opts.output = args[i + 1]; i += 2; break;
      case '-h':
      case '--help':
        console.log(`
scan-exports.js
扫描 RN 三方库的对外导出接口和 TurboModule Spec

用法:
  node scan-exports.js [选项] <源码目录>
  node scan-exports.js --compare [选项] <目录1> <目录2>

选项:
  --compare       对比两个目录的接口差异
  -q, --quiet     只输出 JSON (适合脚本调用)
  --entry <f>     指定包入口文件 (覆盖自动检测)
  -o, --output <f>  将结果写入 Markdown 文件 (对比模式生成适配检查清单)
  -h, --help      显示帮助

示例:
  # 扫描单个目录
  node scan-exports.js ./packages/async-storage

  # 对比两个版本, 输出到文件
  node scan-exports.js --compare \\
    ./diff/v2.2.0/packages/default-storage \\
    ./diff/v3.1.1/packages/async-storage \\
    --output ./api-diff.md
`);
        process.exit(0);
      default:
        opts.dirs.push(args[i]); i += 1;
    }
  }

  if (opts.compare && opts.dirs.length < 2) {
    error('--compare 需要两个目录参数');
  }
  if (!opts.compare && opts.dirs.length < 1) {
    error('请指定源码目录');
  }

  return opts;
}

// ── 文件查找 ─────────────────────────────────────────────

/**
 * 读取 package.json (如果存在)。
 * @param {string} dir 源码目录
 * @returns {object|null}
 */
function readPackageJson(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 检测包入口文件。
 *
 * 优先级:
 *   1. --entry 参数指定的路径
 *   2. package.json 的 "source" 字段 (react-native-builder-bob 约定)
 *   3. package.json 的 "react-native" 字段
 *   4. package.json 的 "main" 字段
 *   5. 约定文件: src/index.ts, src/index.tsx, index.ts, index.tsx
 *
 * @param {string} dir 源码目录
 * @param {string} explicitEntry --entry 参数
 * @returns {string|null} 入口文件绝对路径
 */
function detectEntryFile(dir, explicitEntry) {
  if (explicitEntry) {
    const p = path.resolve(dir, explicitEntry);
    if (fs.existsSync(p)) return p;
    warn(`指定的入口文件不存在: ${explicitEntry}`);
  }

  const pkg = readPackageJson(dir);

  // package.json 字段优先级
  // source 字段通常指向 src/ 下的入口 (react-native-builder-bob 约定)
  // main/module/react-native 字段可能指向 lib/ (构建产物), 需回退到 src/
  const fields = ['source', 'react-native', 'main', 'module'];
  if (pkg) {
    for (const field of fields) {
      const val = pkg[field];
      if (val && typeof val === 'string') {
        // 尝试多种路径变体: 原始值 → src/ 替换 → .ts/.tsx 扩展名替换
        const variants = [
          val,
          val.replace(/^lib\//, 'src/'),
          val.replace(/^lib\/commonjs\//, 'src/'),
          val.replace(/^lib\/module\//, 'src/'),
          val.replace(/\.js$/, '.ts'),
          val.replace(/\.jsx$/, '.tsx'),
          val.replace(/^lib\//, 'src/').replace(/\.js$/, '.ts'),
          val.replace(/^lib\//, 'src/').replace(/\.js$/, '.tsx'),
          val.replace(/^lib\/module\//, 'src/').replace(/\.js$/, '.ts'),
          val.replace(/^lib\/module\//, 'src/').replace(/\.js$/, '.tsx'),
        ];
        for (const v of variants) {
          const p = path.resolve(dir, v);
          if (fs.existsSync(p) && (p.endsWith('.ts') || p.endsWith('.tsx'))) {
            return p;
          }
        }
      }
    }
  }

  // 约定文件
  const conventions = [
    'src/index.ts', 'src/index.tsx',
    'index.ts', 'index.tsx',
  ];
  for (const conv of conventions) {
    const p = path.resolve(dir, conv);
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * 查找 TurboModule Spec 文件。
 *
 * 匹配模式: src/ 下以 Native 开头的 .ts/.tsx 文件
 * (react-native codegen 约定: jsSrcsDir 下的 Native*.ts)
 *
 * @param {string} dir 源码目录
 * @returns {string[]} Spec 文件路径列表
 */
function findTurboModuleSpecFiles(dir) {
  const results = [];

  // 从 package.json 获取 codegenConfig.jsSrcsDir
  const pkg = readPackageJson(dir);
  const srcDirs = [];
  if (pkg && pkg.codegenConfig && pkg.codegenConfig.jsSrcsDir) {
    srcDirs.push(path.resolve(dir, pkg.codegenConfig.jsSrcsDir));
  }
  // 也扫描 src/ 和根目录
  srcDirs.push(path.resolve(dir, 'src'));
  srcDirs.push(dir);

  for (const srcDir of srcDirs) {
    if (!fs.existsSync(srcDir)) continue;
    scanDirForNativeSpec(srcDir, results);
  }

  // 去重
  return [...new Set(results)];
}

/**
 * 递归扫描目录, 查找 Native*.ts 文件。
 * @param {string} dir 当前目录
 * @param {string[]} results 结果数组
 */
function scanDirForNativeSpec(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    // 跳过 node_modules, lib, dist
    if (['node_modules', 'lib', 'dist', '.git'].includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirForNativeSpec(fullPath, results);
    } else if (entry.isFile()) {
      // 匹配 Native*.ts 或 Native*.tsx
      if (/^Native[A-Z].*\.(ts|tsx)$/.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }
}

// ── TS 解析: export 提取 ─────────────────────────────────

/**
 * 从 TS/TSX 文件内容中提取导出信息。
 *
 * 支持的 export 语法:
 *   - export default <expr>
 *   - export default function name()
 *   - export default class Name
 *   - export { a, b, c }
 *   - export { a, b } from './module'
 *   - export type { A, B }
 *   - export type { A, B } from './module'
 *   - export function name()
 *   - export class Name
 *   - export const name = ...
 *   - export interface Name
 *   - export type Name = ...
 *   - export * from './module'
 *   - export * as namespace from './module'
 *
 * @param {string} content 文件内容
 * @returns {{defaultExport: string|null, named: string[], types: string[], reExports: Array}}
 */
function extractExports(content) {
  const defaultExport = null;
  let defaultExportDesc = null;
  const named = [];
  const types = [];
  const reExports = []; // re-export: { names, from, isType }

  // 移除注释 (避免注释中的 export 被误匹配)
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/\/\/.*$/gm, '');            // 行注释

  const lines = cleaned.split('\n');

  // ── 1. export default ──
  // 匹配: export default ..., export default function name, export default class Name
  const defaultMatch = cleaned.match(/export\s+default\s+(?:function\s+(\w+)|class\s+(\w+)|([^\s;{]+))/);
  if (defaultMatch) {
    defaultExportDesc = defaultMatch[1] || defaultMatch[2] || defaultMatch[3] || 'anonymous';
  }

  // ── 2. export { ... } 和 export type { ... } ──
  // 匹配单行和多行 export { a, b, c } [from '...']
  const exportBraceRegex = /export\s+(type\s+)?\{([^}]+)\}\s*(?:from\s+['"]([^'"]+)['"])?/g;
  let m;
  while ((m = exportBraceRegex.exec(cleaned)) !== null) {
    const isType = !!m[1];
    const namesRaw = m[2];
    const fromModule = m[3] || null;

    // 解析 names: "a, b as c, type d" → ["a", "b as c", "d"]
    const names = namesRaw.split(',').map(s => s.trim()).filter(Boolean);

    for (let name of names) {
      // 处理 "name as alias" → 取 alias
      // 处理 "type Name" → type export
      let isTypeExport = isType;
      if (name.startsWith('type ')) {
        isTypeExport = true;
        name = name.substring(5).trim();
      }
      // 取 as 后的别名
      const asMatch = name.match(/^(\w+)\s+as\s+(\w+)/);
      const exportName = asMatch ? asMatch[2] : name;
      const originalName = asMatch ? asMatch[1] : name;

      if (fromModule) {
        reExports.push({ name: exportName, original: originalName, from: fromModule, isType: isTypeExport });
      } else {
        if (isTypeExport) {
          if (!types.includes(exportName)) types.push(exportName);
        } else {
          if (!named.includes(exportName)) named.push(exportName);
        }
      }
    }
  }

  // ── 3. export * from '...' 和 export * as ns from '...' ──
  const starRegex = /export\s+\*\s*(?:as\s+(\w+)\s+)?from\s+['"]([^'"]+)['"]/g;
  while ((m = starRegex.exec(cleaned)) !== null) {
    reExports.push({
      name: m[1] || '*',
      original: '*',
      from: m[2],
      isType: false,
      isWildcard: true,
    });
  }

  // ── 4. export function/class/const/interface/type ──
  // export function name
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  while ((m = funcRegex.exec(cleaned)) !== null) {
    if (!named.includes(m[1])) named.push(m[1]);
  }

  // export class Name
  const classRegex = /export\s+(?:abstract\s+)?class\s+(\w+)/g;
  while ((m = classRegex.exec(cleaned)) !== null) {
    if (!named.includes(m[1])) named.push(m[1]);
  }

  // export const/let/var name
  const constRegex = /export\s+(?:const|let|var)\s+(\w+)/g;
  while ((m = constRegex.exec(cleaned)) !== null) {
    if (!named.includes(m[1])) named.push(m[1]);
  }

  // export interface Name
  const interfaceRegex = /export\s+interface\s+(\w+)/g;
  while ((m = interfaceRegex.exec(cleaned)) !== null) {
    if (!types.includes(m[1])) types.push(m[1]);
  }

  // export type Name = ...
  const typeRegex = /export\s+type\s+(\w+)\s*[=<]/g;
  while ((m = typeRegex.exec(cleaned)) !== null) {
    if (!types.includes(m[1])) types.push(m[1]);
  }

  // export enum Name
  const enumRegex = /export\s+(?:const\s+)?enum\s+(\w+)/g;
  while ((m = enumRegex.exec(cleaned)) !== null) {
    if (!types.includes(m[1])) types.push(m[1]);
  }

  return {
    defaultExport: defaultExportDesc,
    named,
    types,
    reExports,
  };
}

// ── TS 解析: TurboModule Spec 提取 ───────────────────────

/**
 * 从 TurboModule Spec 文件中提取 Spec interface 的方法和模块名。
 *
 * 匹配模式:
 *   export interface Spec extends TurboModule {
 *     methodName: (params) => ReturnType;
 *     ...
 *   }
 *   export default TurboModuleRegistry.get<Spec>("ModuleName");
 *
 * @param {string} content 文件内容
 * @returns {{moduleName: string|null, methods: Array}} 方法列表
 */
function extractTurboModuleSpec(content) {
  // 移除注释
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // 提取模块名: TurboModuleRegistry.get<Spec>("ModuleName")
  let moduleName = null;
  const nameMatch = cleaned.match(/TurboModuleRegistry\.get(?:<[^>]+>)?\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  if (nameMatch) {
    moduleName = nameMatch[1];
  }

  // 也检查: export const NAME = 'ModuleName'
  if (!moduleName) {
    const constNameMatch = cleaned.match(/export\s+const\s+NAME\s*=\s*['"]([^'"]+)['"]/);
    if (constNameMatch) {
      moduleName = constNameMatch[1];
    }
  }

  // 提取 Spec interface 的方法
  const methods = [];

  // 匹配 interface Spec extends TurboModule { ... }
  // 使用平衡括号的方式提取 interface 体
  const interfaceMatch = cleaned.match(/export\s+interface\s+Spec\s+extends\s+TurboModule\s*\{/);
  if (interfaceMatch) {
    const startIdx = interfaceMatch.index + interfaceMatch[0].length;
    const body = extractBalancedBraces(cleaned, startIdx);

    if (body) {
      // 使用逐字符扫描提取方法 (与 extractMethodsFromInterfaceBody 相同的逻辑)
      // 正则方式无法正确处理嵌套的 {} () [] (如 Promise<{ key: string }>)
      methods.push(...extractMethodsFromInterfaceBody(body));
    }
  }

  return { moduleName, methods };
}

/**
 * 从起始位置提取平衡的花括号内容。
 * @param {string} text 文本
 * @param {number} startIdx 第一个 { 之后的位置
 * @returns {string|null} 花括号内的内容
 */
function extractBalancedBraces(text, startIdx) {
  let depth = 1;
  let i = startIdx;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    if (depth === 0) return text.substring(startIdx, i);
    i++;
  }
  return null;
}

/**
 * 查找方法签名的结束位置 (下一个 ; 或 })。
 * @param {string} text 文本
 * @param {number} start 起始位置
 * @returns {number} 结束位置
 */
function findSignatureEnd(text, start) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (depth === 0) return i;
      depth--;
    }
    else if (ch === ';' && depth === 0) return i;
    i++;
  }
  return text.length;
}

// ── 接口签名规范化 ───────────────────────────────────────

/**
 * 规范化方法签名, 用于对比。
 *
 * 移除注释、多余空白, 统一格式。
 *
 * @param {string} sig 原始签名
 * @returns {string} 规范化后的签名
 */
function normalizeSignature(sig) {
  return sig
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/\/\/.*$/gm, '')            // 行注释
    .replace(/\s+/g, ' ')               // 合并空白
    .replace(/\s*;\s*$/, '')            // 移除末尾分号
    .trim();
}

// ── 扫描主流程 ───────────────────────────────────────────

/**
 * 扫描一个源码目录的导出接口。
 *
 * @param {string} dir 源码目录
 * @param {string} explicitEntry 指定的入口文件 (可选)
 * @returns {Object} 扫描结果
 */
function scanDirectory(dir, explicitEntry = '') {
  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    error(`目录不存在: ${dir}`);
  }

  // 1. 检测入口文件
  const entryFile = detectEntryFile(absDir, explicitEntry);
  if (!entryFile) {
    warn(`未找到入口文件: ${absDir}`);
  }

  // 2. 提取入口文件的 exports
  let exports = { defaultExport: null, named: [], types: [], reExports: [] };
  if (entryFile) {
    const content = fs.readFileSync(entryFile, 'utf-8');
    exports = extractExports(content);
  }

  // 3. 跟踪 re-export 的类型定义
  // 如果入口文件 re-export 了 type/interface, 跟踪到源文件提取方法签名
  const interfaceDefs = [];
  if (entryFile) {
    for (const re of exports.reExports) {
      // 跟踪 type re-export 和 named re-export (可能是 class/function)
      const sourceFile = resolveRelativePath(entryFile, re.from);
      if (sourceFile && fs.existsSync(sourceFile)) {
        const sourceContent = fs.readFileSync(sourceFile, 'utf-8');

        // 提取 re-export 指定的 interface/type 方法签名
        if (re.name && re.name !== '*') {
          const methods = extractInterfaceMethods(sourceContent, re.name);
          if (methods.length > 0) {
            interfaceDefs.push({
              name: re.name,
              sourceFile: path.relative(absDir, sourceFile),
              methods,
            });
          }
          // 也尝试 class 方法
          const classMethods = extractClassMethods(sourceContent, re.name);
          if (classMethods.length > 0) {
            interfaceDefs.push({
              name: re.name,
              sourceFile: path.relative(absDir, sourceFile),
              methods: classMethods,
            });
          }
        } else if (re.isWildcard) {
          // wildcard: 提取源文件的所有 interface/type/class
          const sourceExports = extractExports(sourceContent);
          for (const typeName of sourceExports.types) {
            const methods = extractInterfaceMethods(sourceContent, typeName);
            if (methods.length > 0) {
              interfaceDefs.push({
                name: typeName,
                sourceFile: path.relative(absDir, sourceFile),
                methods,
              });
            }
          }
          for (const namedExport of sourceExports.named) {
            const methods = extractClassMethods(sourceContent, namedExport);
            if (methods.length > 0) {
              interfaceDefs.push({
                name: namedExport,
                sourceFile: path.relative(absDir, sourceFile),
                methods,
              });
            }
          }
        }
      }
    }

    // 也直接从入口文件提取 export interface/type
    for (const typeName of exports.types) {
      const content = fs.readFileSync(entryFile, 'utf-8');
      const methods = extractInterfaceMethods(content, typeName);
      if (methods.length > 0) {
        interfaceDefs.push({
          name: typeName,
          sourceFile: path.relative(absDir, entryFile),
          methods,
        });
      }
    }
  }

  // 4. 查找并提取 TurboModule Spec
  const specFiles = findTurboModuleSpecFiles(absDir);
  const turboModuleSpecs = [];
  for (const specFile of specFiles) {
    const content = fs.readFileSync(specFile, 'utf-8');
    const spec = extractTurboModuleSpec(content);
    if (spec.methods.length > 0 || spec.moduleName) {
      turboModuleSpecs.push({
        file: path.relative(absDir, specFile),
        moduleName: spec.moduleName,
        methods: spec.methods.map(m => ({
          name: m.name,
          signature: normalizeSignature(m.signature),
        })),
      });
    }
  }

  return {
    directory: absDir,
    entryFile: entryFile ? path.relative(absDir, entryFile) : null,
    exports,
    interfaceDefs,
    turboModuleSpecs,
  };
}

/**
 * 解析相对路径引用 (from './module' → 文件路径)。
 * @param {string} fromFile 引用源文件
 * @param {string} relativePath 相对路径
 * @returns {string|null} 解析后的文件路径
 */
function resolveRelativePath(fromFile, relativePath) {
  if (!relativePath) return null;
  const dir = path.dirname(fromFile);
  const base = path.resolve(dir, relativePath);
  // 尝试 .ts, .tsx, .d.ts, /index.ts, /index.tsx
  const candidates = [
    base + '.ts',
    base + '.tsx',
    base + '.d.ts',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * 从文件内容中提取指定 interface 或 type 定义的方法签名。
 *
 * 支持两种形式:
 *   - export interface Name { ... }
 *   - export type Name = { ... }
 *
 * @param {string} content 文件内容
 * @param {string} name interface/type 名称
 * @returns {Array<{name: string, signature: string}>} 方法列表
 */
function extractInterfaceMethods(content, interfaceName) {
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // 尝试匹配 interface Name { ... }
  let regex = new RegExp(`(?:export\\s+)?interface\\s+${interfaceName}\\s*(?:extends\\s+[^{]+)?\\s*\\{`);
  let match = regex.exec(cleaned);

  if (!match) {
    // 尝试匹配 type Name = { ... } 或 type Name = SomeOtherType & { ... }
    regex = new RegExp(`(?:export\\s+)?type\\s+${interfaceName}\\s*=\\s*(?:[^{]*?)\\{`);
    match = regex.exec(cleaned);
  }

  if (!match) return [];

  const startIdx = match.index + match[0].length;
  const body = extractBalancedBraces(cleaned, startIdx);
  if (!body) return [];

  return extractMethodsFromInterfaceBody(body);
}

/**
 * 从文件内容中提取指定 class 的方法签名。
 * @param {string} content 文件内容
 * @param {string} className class 名称
 * @returns {Array<{name: string, signature: string}>} 方法列表
 */
function extractClassMethods(content, className) {
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const regex = new RegExp(`(?:export\\s+)?(?:abstract\\s+)?class\\s+${className}\\s*(?:extends\\s+[^{]+)?\\s*\\{`);
  const match = regex.exec(cleaned);
  if (!match) return [];

  const startIdx = match.index + match[0].length;
  const body = extractBalancedBraces(cleaned, startIdx);
  if (!body) return [];

  return extractMethodsFromInterfaceBody(body);
}

/**
 * 从 interface/class body 中提取方法。
 * @param {string} body interface/class 体内容
 * @returns {Array<{name: string, signature: string}>} 方法列表
 */
function extractMethodsFromInterfaceBody(body) {
  const methods = [];

  // 方法模式: methodName(params): ReturnType; 或 methodName: (params) => ReturnType;
  // 使用逐字符扫描来正确处理嵌套括号
  let i = 0;
  while (i < body.length) {
    // 跳过空白和注释
    while (i < body.length && /\s/.test(body[i])) i++;

    // 跳过修饰符: readonly, private, public, protected, static, async
    const modifierRegex = /^(?:readonly|private|public|protected|static|async|override|abstract|get|set)\s+/;
    const remaining = body.substring(i);
    const modMatch = remaining.match(modifierRegex);
    if (modMatch) {
      i += modMatch[0].length;
      continue;
    }

    // 提取标识符 (方法名或属性名)
    const idMatch = body.substring(i).match(/^([a-zA-Z_$][\w$]*)/);
    if (!idMatch) {
      i++;
      continue;
    }

    const name = idMatch[1];
    const nameStart = i;
    i += idMatch[0].length;

    // 跳过空白
    while (i < body.length && /\s/.test(body[i])) i++;

    // 检查后面是什么
    if (i >= body.length) break;

    // 跳过属性 (如 key?: string;), 只关注方法
    // 方法: name(params): ReturnType  或  name: (params) => ReturnType
    if (body[i] === '?' || body[i] === ':') {
      // 可能是属性或方法类型
      // 检查是否是方法签名: name: (params) => ReturnType
      if (body[i] === ':') {
        const sigEnd = findSignatureEnd(body, nameStart);
        const fullSig = body.substring(nameStart, sigEnd).trim();
        // 如果包含 => 或 ( ), 认为是方法
        if (fullSig.includes('=>') || (fullSig.includes('(') && fullSig.includes(')'))) {
          methods.push({ name, signature: normalizeSignature(fullSig) });
        }
        i = sigEnd + 1;
      } else {
        // name?: ... 跳过
        i++;
        const sigEnd = findSignatureEnd(body, i);
        i = sigEnd + 1;
      }
      continue;
    }

    if (body[i] === '(') {
      // 方法: name(params): ReturnType;
      const sigEnd = findSignatureEnd(body, nameStart);
      const fullSig = body.substring(nameStart, sigEnd).trim();
      methods.push({ name, signature: normalizeSignature(fullSig) });
      i = sigEnd + 1;
      continue;
    }

    // 其他情况跳过到下一个 ; 或换行
    while (i < body.length && body[i] !== ';' && body[i] !== '\n') i++;
    i++;
  }

  return methods;
}

// ── 对比逻辑 ─────────────────────────────────────────────

/**
 * 对比两个扫描结果, 生成接口差异报告。
 *
 * @param {Object} scan1 版本1 的扫描结果
 * @param {Object} scan2 版本2 的扫描结果
 * @returns {Object} 差异报告
 */
function compareScans(scan1, scan2) {
  const result = {
    exportsDiff: {
      defaultChanged: false,
      added: [],
      removed: [],
      typesAdded: [],
      typesRemoved: [],
    },
    interfaceDefsDiff: [],
    turboModuleDiff: [],
    summary: {
      hasInterfaceChanges: false,
      hasTurboModuleChanges: false,
      needsNativeAdaptation: false,
    },
  };

  // ── 1. 对比 exports ──
  const e1 = scan1.exports;
  const e2 = scan2.exports;

  // default export
  if (e1.defaultExport !== e2.defaultExport) {
    result.exportsDiff.defaultChanged = true;
    result.exportsDiff.defaultFrom = e1.defaultExport;
    result.exportsDiff.defaultTo = e2.defaultExport;
  }

  // named exports
  const named1 = new Set(e1.named);
  const named2 = new Set(e2.named);
  for (const n of named2) {
    if (!named1.has(n)) result.exportsDiff.added.push(n);
  }
  for (const n of named1) {
    if (!named2.has(n)) result.exportsDiff.removed.push(n);
  }

  // type exports
  const types1 = new Set(e1.types);
  const types2 = new Set(e2.types);
  for (const t of types2) {
    if (!types1.has(t)) result.exportsDiff.typesAdded.push(t);
  }
  for (const t of types1) {
    if (!types2.has(t)) result.exportsDiff.typesRemoved.push(t);
  }

  // ── 2. 对比 interface/type 定义的方法 ──
  const ifaceMap1 = new Map(scan1.interfaceDefs.map(d => [d.name, d]));
  const ifaceMap2 = new Map(scan2.interfaceDefs.map(d => [d.name, d]));

  const allIfaceNames = new Set([...ifaceMap1.keys(), ...ifaceMap2.keys()]);
  for (const name of allIfaceNames) {
    const def1 = ifaceMap1.get(name);
    const def2 = ifaceMap2.get(name);

    if (!def1 && def2) {
      // 新增 interface
      result.interfaceDefsDiff.push({
        name,
        change: 'added',
        methods: def2.methods.map(m => m.name),
      });
    } else if (def1 && !def2) {
      // 删除 interface
      result.interfaceDefsDiff.push({
        name,
        change: 'removed',
        methods: def1.methods.map(m => m.name),
      });
    } else if (def1 && def2) {
      // 对比方法
      const methods1 = new Map(def1.methods.map(m => [m.name, m.signature]));
      const methods2 = new Map(def2.methods.map(m => [m.name, m.signature]));
      const added = [];
      const removed = [];
      const modified = [];

      for (const [mName, mSig] of methods2) {
        if (!methods1.has(mName)) {
          added.push({ name: mName, signature: mSig });
        } else if (methods1.get(mName) !== mSig) {
          modified.push({ name: mName, oldSignature: methods1.get(mName), newSignature: mSig });
        }
      }
      for (const [mName, mSig] of methods1) {
        if (!methods2.has(mName)) {
          removed.push({ name: mName, signature: mSig });
        }
      }

      if (added.length > 0 || removed.length > 0 || modified.length > 0) {
        result.interfaceDefsDiff.push({
          name,
          change: 'modified',
          added,
          removed,
          modified,
        });
      }
    }
  }

  // ── 3. 对比 TurboModule Spec ──
  const specMap1 = new Map();
  for (const s of scan1.turboModuleSpecs) {
    if (s.moduleName) specMap1.set(s.moduleName, s);
  }
  const specMap2 = new Map();
  for (const s of scan2.turboModuleSpecs) {
    if (s.moduleName) specMap2.set(s.moduleName, s);
  }

  const allModuleNames = new Set([...specMap1.keys(), ...specMap2.keys()]);
  for (const modName of allModuleNames) {
    const spec1 = specMap1.get(modName);
    const spec2 = specMap2.get(modName);

    if (!spec1 && spec2) {
      // 新增 TurboModule
      result.turboModuleDiff.push({
        moduleName: modName,
        change: 'added',
        methods: spec2.methods.map(m => ({ name: m.name, signature: m.signature, change: 'added' })),
      });
    } else if (spec1 && !spec2) {
      // 删除 TurboModule
      result.turboModuleDiff.push({
        moduleName: modName,
        change: 'removed',
        methods: spec1.methods.map(m => ({ name: m.name, signature: m.signature, change: 'removed' })),
      });
    } else if (spec1 && spec2) {
      // 对比方法
      const methods1 = new Map(spec1.methods.map(m => [m.name, m.signature]));
      const methods2 = new Map(spec2.methods.map(m => [m.name, m.signature]));
      const methodChanges = [];

      for (const [mName, mSig] of methods2) {
        if (!methods1.has(mName)) {
          methodChanges.push({ name: mName, signature: mSig, change: 'added' });
        } else if (methods1.get(mName) !== mSig) {
          methodChanges.push({
            name: mName,
            oldSignature: methods1.get(mName),
            newSignature: mSig,
            change: 'modified',
          });
        }
      }
      for (const [mName, mSig] of methods1) {
        if (!methods2.has(mName)) {
          methodChanges.push({ name: mName, signature: mSig, change: 'removed' });
        }
      }

      if (methodChanges.length > 0) {
        result.turboModuleDiff.push({
          moduleName: modName,
          change: 'modified',
          methods: methodChanges,
        });
      }
    }
  }

  // 如果两个版本都没有 moduleName (可能模块名变了), 按 Spec 文件对比
  if (result.turboModuleDiff.length === 0) {
    const unnamedSpecs1 = scan1.turboModuleSpecs.filter(s => !s.moduleName);
    const unnamedSpecs2 = scan2.turboModuleSpecs.filter(s => !s.moduleName);
    if (unnamedSpecs1.length > 0 || unnamedSpecs2.length > 0) {
      // 简单按文件名对比
      const files1 = new Set(unnamedSpecs1.map(s => path.basename(s.file)));
      const files2 = new Set(unnamedSpecs2.map(s => path.basename(s.file)));
      if (files1.size !== files2.size || [...files1].some(f => !files2.has(f))) {
        result.turboModuleDiff.push({
          moduleName: '(unknown - module name may have changed)',
          change: 'modified',
          note: 'Spec 文件结构发生变化, 请手动检查',
          specFiles1: unnamedSpecs1.map(s => s.file),
          specFiles2: unnamedSpecs2.map(s => s.file),
        });
      }
    }
  }

  // ── 4. 生成摘要判定 ──
  const hasExportChanges = result.exportsDiff.added.length > 0
    || result.exportsDiff.removed.length > 0
    || result.exportsDiff.typesAdded.length > 0
    || result.exportsDiff.typesRemoved.length > 0
    || result.exportsDiff.defaultChanged;

  const hasInterfaceChanges = result.interfaceDefsDiff.length > 0;
  const hasTurboModuleChanges = result.turboModuleDiff.length > 0;

  result.summary.hasExportChanges = hasExportChanges;
  result.summary.hasInterfaceChanges = hasInterfaceChanges;
  result.summary.hasTurboModuleChanges = hasTurboModuleChanges;
  result.summary.needsNativeAdaptation = hasTurboModuleChanges || hasInterfaceChanges;

  return result;
}

// ── 输出格式化 ───────────────────────────────────────────

/**
 * 将扫描结果格式化为人类可读的文本。
 * @param {Object} scan 扫描结果
 * @returns {string} 格式化文本
 */
function formatScanResult(scan) {
  const lines = [];
  lines.push(`目录: ${scan.directory}`);
  lines.push(`入口: ${scan.entryFile || '(未找到)'}`);
  lines.push('');

  // exports
  lines.push('导出 (Exports):');
  if (scan.exports.defaultExport) {
    lines.push(`  default: ${scan.exports.defaultExport}`);
  }
  if (scan.exports.named.length > 0) {
    lines.push(`  named: ${scan.exports.named.join(', ')}`);
  }
  if (scan.exports.types.length > 0) {
    lines.push(`  types: ${scan.exports.types.join(', ')}`);
  }
  if (scan.exports.reExports.length > 0) {
    lines.push(`  re-exports:`);
    for (const re of scan.exports.reExports) {
      const typeMark = re.isType ? 'type ' : '';
      const wildMark = re.isWildcard ? '* ' : '';
      lines.push(`    ${typeMark}${wildMark}${re.name} from '${re.from}'`);
    }
  }
  lines.push('');

  // interface defs
  if (scan.interfaceDefs.length > 0) {
    lines.push('公共接口/类型定义:');
    for (const def of scan.interfaceDefs) {
      lines.push(`  ${def.name} (${def.sourceFile}):`);
      for (const m of def.methods) {
        lines.push(`    ${m.name}: ${m.signature}`);
      }
    }
    lines.push('');
  }

  // turbo module specs
  if (scan.turboModuleSpecs.length > 0) {
    lines.push('TurboModule Spec:');
    for (const spec of scan.turboModuleSpecs) {
      lines.push(`  模块名: ${spec.moduleName || '(未检测到)'} (${spec.file})`);
      lines.push(`  方法 (${spec.methods.length}):`);
      for (const m of spec.methods) {
        lines.push(`    ${m.name}: ${m.signature}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 将对比结果格式化为人类可读的文本。
 * @param {Object} scan1
 * @param {Object} scan2
 * @param {Object} diff 对比结果
 * @returns {string} 格式化文本
 */
function formatDiffResult(scan1, scan2, diff) {
  const lines = [];
  lines.push('==========================================');
  lines.push('  接口差异分析');
  lines.push('==========================================');
  lines.push('');

  // 摘要判定
  lines.push('## 判定结果');
  lines.push('');
  if (diff.summary.needsNativeAdaptation) {
    lines.push('⚠️  需要原生适配 — JS 层接口或 TurboModule Spec 发生变更');
  } else {
    lines.push('✅ 无需原生适配 — JS 层接口未变更 (可能仅 bug 修复/内部重构)');
  }
  lines.push('');
  lines.push(`| 检查项 | 结果 |`);
  lines.push(`|--------|------|`);
  lines.push(`| 导出变更 | ${diff.summary.hasExportChanges ? '⚠️ 有变更' : '✅ 无变更'} |`);
  lines.push(`| 接口定义变更 | ${diff.summary.hasInterfaceChanges ? '⚠️ 有变更' : '✅ 无变更'} |`);
  lines.push(`| TurboModule Spec 变更 | ${diff.summary.hasTurboModuleChanges ? '⚠️ 有变更' : '✅ 无变更'} |`);
  lines.push(`| 需要原生适配 | ${diff.summary.needsNativeAdaptation ? '⚠️ 是' : '✅ 否'} |`);
  lines.push('');

  // exports diff
  const e = diff.exportsDiff;
  if (e.defaultChanged || e.added.length > 0 || e.removed.length > 0 || e.typesAdded.length > 0 || e.typesRemoved.length > 0) {
    lines.push('## JS 导出变更');
    lines.push('');
    if (e.defaultChanged) {
      lines.push(`- default export: ${e.defaultFrom || '(无)'} → ${e.defaultTo || '(无)'}`);
    }
    if (e.added.length > 0) lines.push(`- 新增导出: ${e.added.join(', ')}`);
    if (e.removed.length > 0) lines.push(`- 移除导出: ${e.removed.join(', ')}`);
    if (e.typesAdded.length > 0) lines.push(`- 新增类型导出: ${e.typesAdded.join(', ')}`);
    if (e.typesRemoved.length > 0) lines.push(`- 移除类型导出: ${e.typesRemoved.join(', ')}`);
    lines.push('');
  }

  // interface defs diff
  if (diff.interfaceDefsDiff.length > 0) {
    lines.push('## 公共接口/类型定义变更');
    lines.push('');
    for (const d of diff.interfaceDefsDiff) {
      if (d.change === 'added') {
        lines.push(`### ➕ 新增接口: ${d.name}`);
        for (const m of d.methods) lines.push(`  - ${m}`);
      } else if (d.change === 'removed') {
        lines.push(`### ➖ 移除接口: ${d.name}`);
        for (const m of d.methods) lines.push(`  - ${m}`);
      } else if (d.change === 'modified') {
        lines.push(`### ✏️ 修改接口: ${d.name}`);
        if (d.added.length > 0) {
          lines.push('  新增方法:');
          for (const m of d.added) lines.push(`    + ${m.name}: ${m.signature}`);
        }
        if (d.removed.length > 0) {
          lines.push('  移除方法:');
          for (const m of d.removed) lines.push(`    - ${m.name}: ${m.signature}`);
        }
        if (d.modified.length > 0) {
          lines.push('  修改方法:');
          for (const m of d.modified) {
            lines.push(`    * ${m.name}:`);
            lines.push(`      旧: ${m.oldSignature}`);
            lines.push(`      新: ${m.newSignature}`);
          }
        }
      }
      lines.push('');
    }
  }

  // turbo module diff
  if (diff.turboModuleDiff.length > 0) {
    lines.push('## TurboModule Spec 变更');
    lines.push('');
    for (const d of diff.turboModuleDiff) {
      if (d.change === 'added') {
        lines.push(`### ➕ 新增模块: ${d.moduleName}`);
        for (const m of d.methods) lines.push(`  + ${m.name}: ${m.signature}`);
      } else if (d.change === 'removed') {
        lines.push(`### ➖ 移除模块: ${d.moduleName}`);
        for (const m of d.methods) lines.push(`  - ${m.name}: ${m.signature}`);
      } else if (d.change === 'modified') {
        lines.push(`### ✏️ 修改模块: ${d.moduleName}`);
        if (d.note) {
          lines.push(`  ⚠️ ${d.note}`);
          if (d.specFiles1) lines.push(`  旧 Spec 文件: ${d.specFiles1.join(', ')}`);
          if (d.specFiles2) lines.push(`  新 Spec 文件: ${d.specFiles2.join(', ')}`);
        } else {
          for (const m of d.methods) {
            if (m.change === 'added') {
              lines.push(`  + ${m.name}: ${m.signature}`);
            } else if (m.change === 'removed') {
              lines.push(`  - ${m.name}: ${m.signature}`);
            } else if (m.change === 'modified') {
              lines.push(`  * ${m.name}:`);
              lines.push(`    旧: ${m.oldSignature}`);
              lines.push(`    新: ${m.newSignature}`);
            }
          }
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Markdown 文档生成 (适配检查清单) ─────────────────────

/**
 * 生成适配检查清单 Markdown 文档。
 *
 * 以"适配任务"为单位组织内容, 每个接口变更对应一个检查项 (含 checkbox),
 * 直接指导后续代码适配环节, 避免遗漏。
 *
 * 文档结构:
 *   1. 判定结果 (是否需要原生适配)
 *   2. 适配检查清单 (TurboModule Spec 变更 → 接口定义变更 → JS 导出变更)
 *   3. 无需适配项 (接口未变, 仅计数)
 *   4. 附录: 完整接口快照 (旧版 + 新版)
 *
 * @param {Object} scan1 版本1 的扫描结果
 * @param {Object} scan2 版本2 的扫描结果
 * @param {Object} diff 对比结果
 * @param {Object} meta 元信息 { version1, version2, repoUrl }
 * @returns {string} Markdown 内容
 */
function generateMarkdownReport(scan1, scan2, diff, meta = {}) {
  const v1 = meta.version1 || '版本1';
  const v2 = meta.version2 || '版本2';
  const lines = [];

  // ── 标题与元信息 ──
  lines.push(`# 接口差异适配检查清单: ${v1} → ${v2}`);
  lines.push('');
  if (meta.repoUrl) {
    lines.push(`**仓库:** ${meta.repoUrl}`);
  }
  lines.push(`**版本 1:** ${v1} (入口: ${scan1.entryFile || '未检测到'})`);
  lines.push(`**版本 2:** ${v2} (入口: ${scan2.entryFile || '未检测到'})`);
  lines.push(`**生成日期:** ${new Date().toISOString().split('T')[0]}`);
  lines.push('');

  // ── 1. 判定结果 ──
  lines.push('## 判定结果');
  lines.push('');
  if (diff.summary.needsNativeAdaptation) {
    lines.push('> ⚠️ **需要原生适配** — JS 层接口或 TurboModule Spec 发生变更, 鸿蒙侧需同步修改。');
  } else {
    lines.push('> ✅ **无需原生适配** — JS 层接口未变更, 可能仅 bug 修复/内部重构。');
    lines.push('> 鸿蒙侧只需合并 JS 代码 + 重新 codegen + 验证 RNOH 框架兼容性。');
  }
  lines.push('');
  lines.push('| 检查项 | 结果 | 说明 |');
  lines.push('|--------|------|------|');
  lines.push(`| JS 导出变更 | ${diff.summary.hasExportChanges ? '⚠️ 有' : '✅ 无'} | default/named/type 导出的增删改 |`);
  lines.push(`| 接口定义变更 | ${diff.summary.hasInterfaceChanges ? '⚠️ 有' : '✅ 无'} | 公共 interface/type 的方法增删改 |`);
  lines.push(`| TurboModule Spec 变更 | ${diff.summary.hasTurboModuleChanges ? '⚠️ 有' : '✅ 无'} | 原生模块方法签名变更 |`);
  lines.push(`| **需要原生适配** | ${diff.summary.needsNativeAdaptation ? '⚠️ **是**' : '✅ **否**'} | 接口不变则原生无需动 |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── 2. 适配检查清单 ──
  lines.push('## 适配检查清单');
  lines.push('');
  lines.push('> 以下每个检查项对应一个需要适配的接口变更。');
  lines.push('> 完成后勾选 `[x]` 标记为已完成。');
  lines.push('');

  let itemNum = 0;

  // ── 2a. TurboModule Spec 变更 (最高优先级) ──
  if (diff.turboModuleDiff.length > 0) {
    lines.push('### TurboModule Spec 变更');
    lines.push('');
    lines.push('> 原生模块接口变更, 需同步更新 codegen、ETS TurboModule、C++ Package。');
    lines.push('');

    for (const d of diff.turboModuleDiff) {
      if (d.change === 'added') {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} 新增 TurboModule: \`${d.moduleName}\`**`);
        lines.push(`  - 动作: 在 ETS 中实现新模块, 更新 C++ codegen methodMap, 更新 Package 注册`);
        lines.push(`  - 新增方法 (${d.methods.length}):`);
        for (const m of d.methods) {
          lines.push(`    - \`${m.name}\`: \`${m.signature}\``);
        }
        lines.push('');
      } else if (d.change === 'removed') {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} 移除 TurboModule: \`${d.moduleName}\`**`);
        lines.push(`  - 动作: 删除 ETS TurboModule 实现, 删除 C++ codegen, 移除 Package 注册`);
        lines.push(`  - 移除方法 (${d.methods.length}):`);
        for (const m of d.methods) {
          lines.push(`    - \`${m.name}\`: \`${m.signature}\``);
        }
        lines.push('');
      } else if (d.change === 'modified') {
        if (d.note) {
          itemNum++;
          lines.push(`- [ ] **#${itemNum} TurboModule 结构变更: \`${d.moduleName}\`**`);
          lines.push(`  - ⚠️ ${d.note}`);
          if (d.specFiles1) lines.push(`  - 旧 Spec: ${d.specFiles1.join(', ')}`);
          if (d.specFiles2) lines.push(`  - 新 Spec: ${d.specFiles2.join(', ')}`);
          lines.push(`  - 动作: 手动检查 Spec 文件, 更新 codegen + ETS + C++`);
        } else {
          // 按方法变更类型分组
          const added = d.methods.filter(m => m.change === 'added');
          const removed = d.methods.filter(m => m.change === 'removed');
          const modified = d.methods.filter(m => m.change === 'modified');

          if (added.length > 0) {
            itemNum++;
            lines.push(`- [ ] **#${itemNum} TurboModule \`${d.moduleName}\` 新增方法**`);
            lines.push(`  - 动作: ETS 实现新方法 + C++ codegen 新增方法映射`);
            for (const m of added) {
              lines.push(`    - \`${m.name}\`: \`${m.signature}\``);
            }
            lines.push('');
          }
          if (removed.length > 0) {
            itemNum++;
            lines.push(`- [ ] **#${itemNum} TurboModule \`${d.moduleName}\` 移除方法**`);
            lines.push(`  - 动作: 删除 ETS 方法 + C++ codegen 移除方法映射`);
            for (const m of removed) {
              lines.push(`    - \`${m.name}\`: \`${m.signature}\``);
            }
            lines.push('');
          }
          if (modified.length > 0) {
            itemNum++;
            lines.push(`- [ ] **#${itemNum} TurboModule \`${d.moduleName}\` 修改方法签名**`);
            lines.push(`  - 动作: 更新 ETS 方法签名 + C++ codegen 参数数量 + 验证返回值类型兼容`);
            for (const m of modified) {
              lines.push(`    - \`${m.name}\`:`);
              lines.push(`      - 旧: \`${m.oldSignature}\``);
              lines.push(`      - 新: \`${m.newSignature}\``);
            }
            lines.push('');
          }
        }
      }
    }
  }

  // ── 2b. 公共接口/类型定义变更 ──
  if (diff.interfaceDefsDiff.length > 0) {
    lines.push('### 公共接口/类型定义变更');
    lines.push('');
    lines.push('> JS 层公共 API 接口变更, 需同步鸿蒙化仓库的 src/ 代码。');
    lines.push('');

    for (const d of diff.interfaceDefsDiff) {
      if (d.change === 'added') {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} 新增接口: \`${d.name}\`**`);
        lines.push(`  - 动作: 合并新接口到鸿蒙化仓库 src/`);
        lines.push(`  - 方法:`);
        for (const m of d.methods) lines.push(`    - \`${m}\``);
        lines.push('');
      } else if (d.change === 'removed') {
        itemNum++;
        lines.push(`- [ ] **#${itemNum} 移除接口: \`${d.name}\`**`);
        lines.push(`  - 动作: 从鸿蒙化仓库 src/ 删除旧接口`);
        lines.push(`  - 方法:`);
        for (const m of d.methods) lines.push(`    - \`${m}\``);
        lines.push('');
      } else if (d.change === 'modified') {
        if (d.added.length > 0) {
          itemNum++;
          lines.push(`- [ ] **#${itemNum} 接口 \`${d.name}\` 新增方法**`);
          lines.push(`  - 动作: 在鸿蒙化仓库 src/ 中新增对应方法`);
          for (const m of d.added) {
            lines.push(`    - \`${m.name}\`: \`${m.signature}\``);
          }
          lines.push('');
        }
        if (d.removed.length > 0) {
          itemNum++;
          lines.push(`- [ ] **#${itemNum} 接口 \`${d.name}\` 移除方法**`);
          lines.push(`  - 动作: 从鸿蒙化仓库 src/ 中删除对应方法`);
          for (const m of d.removed) {
            lines.push(`    - \`${m.name}\`: \`${m.signature}\``);
          }
          lines.push('');
        }
        if (d.modified.length > 0) {
          itemNum++;
          lines.push(`- [ ] **#${itemNum} 接口 \`${d.name}\` 修改方法签名**`);
          lines.push(`  - 动作: 更新鸿蒙化仓库 src/ 中的方法签名`);
          for (const m of d.modified) {
            lines.push(`    - \`${m.name}\`:`);
            lines.push(`      - 旧: \`${m.oldSignature}\``);
            lines.push(`      - 新: \`${m.newSignature}\``);
          }
          lines.push('');
        }
      }
    }
  }

  // ── 2c. JS 导出变更 ──
  const e = diff.exportsDiff;
  if (e.defaultChanged || e.added.length > 0 || e.removed.length > 0 || e.typesAdded.length > 0 || e.typesRemoved.length > 0) {
    lines.push('### JS 导出变更');
    lines.push('');
    lines.push('> 入口文件的导出变更, 影响包的对外 API。');
    lines.push('');

    if (e.defaultChanged) {
      itemNum++;
      lines.push(`- [ ] **#${itemNum} default export 变更**`);
      lines.push(`  - 旧: \`${e.defaultFrom || '(无)'}\``);
      lines.push(`  - 新: \`${e.defaultTo || '(无)'}\``);
      lines.push(`  - 动作: 更新鸿蒙化仓库入口文件的 default export`);
      lines.push('');
    }
    if (e.added.length > 0) {
      itemNum++;
      lines.push(`- [ ] **#${itemNum} 新增 named 导出**`);
      lines.push(`  - 导出: ${e.added.map(n => `\`${n}\``).join(', ')}`);
      lines.push(`  - 动作: 确保新导出在鸿蒙化仓库中可用`);
      lines.push('');
    }
    if (e.removed.length > 0) {
      itemNum++;
      lines.push(`- [ ] **#${itemNum} 移除 named 导出**`);
      lines.push(`  - 导出: ${e.removed.map(n => `\`${n}\``).join(', ')}`);
      lines.push(`  - 动作: 从鸿蒙化仓库中移除对应导出`);
      lines.push('');
    }
    if (e.typesAdded.length > 0) {
      itemNum++;
      lines.push(`- [ ] **#${itemNum} 新增 type 导出**`);
      lines.push(`  - 类型: ${e.typesAdded.map(n => `\`${n}\``).join(', ')}`);
      lines.push(`  - 动作: 确保新类型在鸿蒙化仓库中可用`);
      lines.push('');
    }
    if (e.typesRemoved.length > 0) {
      itemNum++;
      lines.push(`- [ ] **#${itemNum} 移除 type 导出**`);
      lines.push(`  - 类型: ${e.typesRemoved.map(n => `\`${n}\``).join(', ')}`);
      lines.push(`  - 动作: 从鸿蒙化仓库中移除对应类型导出`);
      lines.push('');
    }
  }

  if (itemNum === 0) {
    lines.push('*无接口变更, 无需适配。*');
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // ── 3. 无需适配项 ──
  lines.push('## 无需适配项');
  lines.push('');
  if (!diff.summary.needsNativeAdaptation) {
    lines.push('- ✅ JS 层接口未变更 — 仅 bug 修复/内部重构, 合并 JS 代码即可');
    lines.push('- ✅ TurboModule Spec 未变更 — 原生模块无需修改');
    lines.push('');
  } else {
    // 即使需要适配, 也标注哪些部分不需要动
    if (!diff.summary.hasTurboModuleChanges) {
      lines.push('- ✅ TurboModule Spec 未变更 — 原生模块方法签名不变');
    }
    if (!diff.summary.hasInterfaceChanges) {
      lines.push('- ✅ 公共接口定义未变更 — JS 层 API 不变');
    }
    if (!diff.summary.hasExportChanges) {
      lines.push('- ✅ JS 导出未变更 — 入口文件 API 不变');
    }
    lines.push('- ℹ️ 纯 bug 修复/内部重构的文件变更 (不涉及接口) — 合并 JS 代码即可, 无需原生适配');
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // ── 4. 附录: 完整接口快照 ──
  lines.push('## 附录: 接口快照');
  lines.push('');

  // 旧版
  lines.push(`### ${v1} 接口快照`);
  lines.push('');
  lines.push(`**入口:** ${scan1.entryFile || '(未检测到)'}`);
  lines.push('');
  if (scan1.exports.defaultExport) {
    lines.push(`- default: \`${scan1.exports.defaultExport}\``);
  }
  if (scan1.exports.named.length > 0) {
    lines.push(`- named: ${scan1.exports.named.map(n => `\`${n}\``).join(', ')}`);
  }
  if (scan1.exports.types.length > 0) {
    lines.push(`- types: ${scan1.exports.types.map(n => `\`${n}\``).join(', ')}`);
  }
  for (const def of scan1.interfaceDefs) {
    lines.push(`- **${def.name}** (${def.sourceFile}):`);
    for (const m of def.methods) {
      lines.push(`  - \`${m.name}: ${m.signature}\``);
    }
  }
  for (const spec of scan1.turboModuleSpecs) {
    lines.push(`- **TurboModule: ${spec.moduleName || '(未命名)'}** (${spec.file})`);
    for (const m of spec.methods) {
      lines.push(`  - \`${m.name}: ${m.signature}\``);
    }
  }
  lines.push('');

  // 新版
  lines.push(`### ${v2} 接口快照`);
  lines.push('');
  lines.push(`**入口:** ${scan2.entryFile || '(未检测到)'}`);
  lines.push('');
  if (scan2.exports.defaultExport) {
    lines.push(`- default: \`${scan2.exports.defaultExport}\``);
  }
  if (scan2.exports.named.length > 0) {
    lines.push(`- named: ${scan2.exports.named.map(n => `\`${n}\``).join(', ')}`);
  }
  if (scan2.exports.types.length > 0) {
    lines.push(`- types: ${scan2.exports.types.map(n => `\`${n}\``).join(', ')}`);
  }
  for (const def of scan2.interfaceDefs) {
    lines.push(`- **${def.name}** (${def.sourceFile}):`);
    for (const m of def.methods) {
      lines.push(`  - \`${m.name}: ${m.signature}\``);
    }
  }
  for (const spec of scan2.turboModuleSpecs) {
    lines.push(`- **TurboModule: ${spec.moduleName || '(未命名)'}** (${spec.file})`);
    for (const m of spec.methods) {
      lines.push(`  - \`${m.name}: ${m.signature}\``);
    }
  }
  lines.push('');

  return lines.join('\n');
}

function main() {
  const opts = parseArgs();

  if (opts.compare) {
    // 对比模式
    const [dir1, dir2] = opts.dirs;
    if (!opts.quiet) info(`扫描目录 1: ${dir1}`);
    const scan1 = scanDirectory(dir1, opts.entry);
    if (!opts.quiet) info(`扫描目录 2: ${dir2}`);
    const scan2 = scanDirectory(dir2, opts.entry);

    const diff = compareScans(scan1, scan2);

    if (opts.output) {
      // 写入 Markdown 文件
      const report = generateMarkdownReport(scan1, scan2, diff, {
        version1: path.basename(dir1),
        version2: path.basename(dir2),
      });
      const outputPath = path.resolve(opts.output);
      fs.writeFileSync(outputPath, report, 'utf-8');
      if (!opts.quiet) {
        ok(`适配检查清单已写入: ${outputPath}`);
        // 也在终端打印摘要
        console.log('');
        console.log(formatDiffResult(scan1, scan2, diff));
      }
    } else if (opts.quiet) {
      // JSON 输出
      console.log(JSON.stringify({ scan1, scan2, diff }, null, 2));
    } else {
      console.log(formatDiffResult(scan1, scan2, diff));
    }
  } else {
    // 单目录扫描模式
    const [dir] = opts.dirs;
    if (!opts.quiet) info(`扫描目录: ${dir}`);
    const scan = scanDirectory(dir, opts.entry);

    if (opts.output) {
      // 单目录模式也支持写入 Markdown 文件 (接口快照)
      const report = generateSingleScanMarkdown(scan, {
        version: path.basename(dir),
      });
      const outputPath = path.resolve(opts.output);
      fs.writeFileSync(outputPath, report, 'utf-8');
      if (!opts.quiet) ok(`接口快照已写入: ${outputPath}`);
    } else if (opts.quiet) {
      console.log(JSON.stringify(scan, null, 2));
    } else {
      console.log(formatScanResult(scan));
    }
  }
}

/**
 * 生成单目录扫描的 Markdown 文档 (接口快照)。
 *
 * @param {Object} scan 扫描结果
 * @param {Object} meta 元信息
 * @returns {string} Markdown 内容
 */
function generateSingleScanMarkdown(scan, meta = {}) {
  const version = meta.version || '扫描结果';
  const lines = [];

  lines.push(`# 接口快照: ${version}`);
  lines.push('');
  lines.push(`**目录:** ${scan.directory}`);
  lines.push(`**入口:** ${scan.entryFile || '(未检测到)'}`);
  lines.push(`**生成日期:** ${new Date().toISOString().split('T')[0]}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // exports
  lines.push('## 导出 (Exports)');
  lines.push('');
  if (scan.exports.defaultExport) {
    lines.push(`- **default:** \`${scan.exports.defaultExport}\``);
  }
  if (scan.exports.named.length > 0) {
    lines.push(`- **named:** ${scan.exports.named.map(n => `\`${n}\``).join(', ')}`);
  }
  if (scan.exports.types.length > 0) {
    lines.push(`- **types:** ${scan.exports.types.map(n => `\`${n}\``).join(', ')}`);
  }
  if (scan.exports.reExports.length > 0) {
    lines.push('- **re-exports:**');
    for (const re of scan.exports.reExports) {
      const typeMark = re.isType ? 'type ' : '';
      const wildMark = re.isWildcard ? '* ' : '';
      lines.push(`  - ${typeMark}${wildMark}\`${re.name}\` from \`${re.from}\``);
    }
  }
  if (scan.exports.defaultExport === null && scan.exports.named.length === 0 && scan.exports.types.length === 0 && scan.exports.reExports.length === 0) {
    lines.push('*(无导出)*');
  }
  lines.push('');

  // interface defs
  if (scan.interfaceDefs.length > 0) {
    lines.push('## 公共接口/类型定义');
    lines.push('');
    for (const def of scan.interfaceDefs) {
      lines.push(`### \`${def.name}\` (${def.sourceFile})`);
      lines.push('');
      lines.push('| 方法 | 签名 |');
      lines.push('|------|------|');
      for (const m of def.methods) {
        lines.push(`| \`${m.name}\` | \`${m.signature}\` |`);
      }
      lines.push('');
    }
  }

  // turbo module specs
  if (scan.turboModuleSpecs.length > 0) {
    lines.push('## TurboModule Spec');
    lines.push('');
    for (const spec of scan.turboModuleSpecs) {
      lines.push(`### 模块: \`${spec.moduleName || '(未检测到)'}\` (${spec.file})`);
      lines.push('');
      lines.push('| 方法 | 签名 |');
      lines.push('|------|------|');
      for (const m of spec.methods) {
        lines.push(`| \`${m.name}\` | \`${m.signature}\` |`);
      }
      lines.push('');
    }
  }

  if (scan.interfaceDefs.length === 0 && scan.turboModuleSpecs.length === 0) {
    lines.push('## 公共接口/类型定义');
    lines.push('');
    lines.push('*(未检测到公共接口或 TurboModule Spec)*');
    lines.push('');
  }

  return lines.join('\n');
}

// ── 模块导出 (供 generate-diff.js 调用) ──────────────────

module.exports = {
  scanDirectory,
  compareScans,
  generateMarkdownReport,
  formatDiffResult,
};

// ── 直接运行时执行主流程 ──────────────────────────────────

if (require.main === module) {
  main();
}
