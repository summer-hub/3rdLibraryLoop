#!/usr/bin/env node
/**
 * extract-interfaces.cjs — 从鸿蒙原生库源码中确定性提取对外公开的接口/类型/类清单。
 *
 * 替代 ArkTsLibraryInterfaceSpecSkill 步骤 0~3b 中由 LLM 人工完成的源码解读：
 *   - 定位入口 Index.ets 与 Native 声明文件（.d.ts / .d.ets）
 *   - 解析 Index.ets 导出链（export { X } from / export * from / export default / Native .so 默认导出）
 *   - 解析 .d.ts 声明（export type / export interface / export class / declare var 可实例化类 / 事件 handler）
 *   - 解析 ArkTS 源文件（export class / export enum / 转发导出目标）
 * 输出结构化中间 JSON，供 render-report.cjs 渲染 SKILL 规范 markdown 报告。
 *
 * 设计原则（对应 SKILL 核心规则）：
 *   - 只提取公开（export / 无 private/protected 修饰）成员
 *   - 构造函数（new(...) / constructor(...)）不纳入接口统计
 *   - 枚举（export enum / 字符串字面量联合）单独列入枚举清单，不计入 S/N
 *   - 只生成"签名 + 来源"，功能描述（JSDoc/行注释）尽力提取，无则 '-'
 *
 * 仅依赖 Node 内置模块（fs/path），零第三方依赖；Windows/PowerShell 可直接运行。
 *
 * 用法:
 *   node extract-interfaces.cjs --repoDir <库源码目录> --output <中间JSON路径>
 */

const fs = require('fs');
const path = require('path');

// ── 参数解析 ──────────────────────────────────────────────
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

const args = parseArgs();
const repoDir = args.repoDir || args.input || '';
if (!repoDir) {
  console.error('用法: node extract-interfaces.cjs --repoDir <库源码目录> --output <中间JSON路径>');
  process.exit(1);
}

const output = args.output || '';

// ── 工具函数 ──────────────────────────────────────────────

/** 获取某文件相对 repoDir 的 posix 风格相对路径 */
function rel(filePath) {
  let r = path.relative(repoDir, filePath).split('\\').join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

/** 递归收集某个 glob（简单 ** 支持）匹配的文件 */
function glob(baseDir, pattern) {
  const results = [];
  const parts = pattern.split('/');
  const rec = (dir, idx) => {
    if (idx >= parts.length) {
      if (fs.existsSync(dir) && fs.statSync(dir).isFile()) results.push(dir);
      return;
    }
    const part = parts[idx];
    if (part === '**') {
      // ** 匹配零或多个目录层
      rec(dir, idx + 1); // 零层：继续匹配剩余 pattern
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        let st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (st.isDirectory()) {
          if (entry === '.git' || entry === 'node_modules' || entry === 'oh_modules' || entry === 'build' || entry === '.hvigor') continue;
          rec(full, idx);     // 一层：继续匹配 ** 本身
          rec(full, idx + 1); // 一层：匹配完 ** 继续匹配剩余 pattern
        }
      }
      return;
    }
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (part.includes('*')) {
        // 文件名通配符（* 匹配任意字符）
        const re = new RegExp('^' + part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
        if (re.test(entry)) {
          rec(path.join(dir, entry), idx + 1);
        }
        continue;
      }
      if (entry.toLowerCase() === part.toLowerCase()) {
        rec(path.join(dir, entry), idx + 1);
      }
    }
  };
  rec(baseDir, 0);
  return results;
}

/** 读取文件文本，兼容 BOM */
function readText(file) {
  return fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
}

/** 收集一行式 JSDoc 注释（/** ... *\/，可多行）与行注释，作为它后面声明项的功能描述 */
function extractDoc(lines, idx, maxLookback = 8) {
  // 向上收集紧邻的连续 /** */ 块注释与 // 行注释
  const docLines = [];
  let j = idx - 1;
  while (j >= 0 && idx - j <= maxLookback) {
    const line = lines[j].trim();
    if (line.startsWith('*/')) { docLines.unshift(line); j--; continue; }
    if (line.startsWith('*') || line.startsWith('/**') || line.startsWith('/*')) {
      docLines.unshift(line); j--; continue;
    }
    if (line.startsWith('//')) { docLines.unshift(line.replace(/^\/\/\s*/, '')); j--; continue; }
    break; // 空行或代码行即停止
  }
  const text = docLines.join(' ').replace(/\/\*|\*\//g, '').replace(/\s+/g, ' ').trim();
  // 过滤版权注释与 W3C 链接行
  const filtered = text
    .replace(/Copyright\s*\(c\)[^]*?License[^]*?(License\)|limitations[^.]*)/gi, '')
    .replace(/#[036]477969|https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(license|licensed under)/i.test(filtered)) return '-';
  return filtered || '-';
}

// ── 顶层声明统计（对应 SKILL 步骤 3b-2）────────────────────

/**
 * 解析 .d.ts / .ets 文件中的顶层声明块。
 * 返回 { types:[], interfaces:[], classes:[], declareVars:[], functions:[], consts:[], enums:[] }
 * 每个元素: { name, startLine, bodyStart, bodyEnd, raw, doc }
 */
function parseTopLevelDecls(filePath) {
  const content = readText(filePath);
  const lines = content.split('\n');
  const decls = {
    types: [], interfaces: [], classes: [], declareVars: [],
    functions: [], consts: [], enums: [], others: [],
    defaultExportedNames: new Set(), // 由 `export default X;` 转发的名字
  };

  // 扫描从 startIdx 行开始的大括号块，返回 body 文本（不含闭合大括号行）
  function scanBlock(startIdx) {
    let depth = 0;
    let j = startIdx;
    while (j < lines.length) {
      depth += (lines[j].match(/{/g) || []).length;
      depth -= (lines[j].match(/}/g) || []).length;
      if (depth <= 0) break;
      j++;
    }
    return { bodyStart: startIdx, bodyEnd: j }; // bodyEnd 为闭合行 index（闭括号所在行）
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 多行 type/interface 声明
    let m = trimmed.match(/^export\s+type\s+(\w+)\s*=/);
    if (m) {
      const name = m[1];
      const joinLines = [trimmed];
      let j = i + 1;
      // 累计到行尾 ';' 或 '= ...' 结束
      while (j < lines.length && !joinLines[joinLines.length - 1].trim().endsWith(';')) {
        joinLines.push(lines[j].trim());
        j++;
      }
      const raw = joinLines.join(' ').replace(/\s+/g, ' ').trim();
      decls.types.push({ name, raw, doc: extractDoc(lines, i), startLine: i + 1 });
      i = j;
      continue;
    }

    m = trimmed.match(/^(?:declare\s+|export(?:\s+default)?\s+|export\s+declare\s+)?interface\s+(\w+)(<[^>]*>)?/);
    if (m) {
      const name = m[1];
      const isDirectExport = /export/.test(trimmed);
      const { bodyStart, bodyEnd } = scanBlock(i);
      decls.interfaces.push({
        name,
        directExport: isDirectExport,
        doc: extractDoc(lines, i),
        startLine: i + 1,
        bodyStartLine: bodyStart,
        bodyText: lines.slice(bodyStart + 1, bodyEnd).join('\n'),
      });
      i = bodyEnd + 1;
      continue;
    }

    // `export default X;` 转发行（类/接口在文件内声明但未加 export 前缀）
    m = trimmed.match(/^export\s+default\s+(\w+)\s*;$/);
    if (m) {
      decls.defaultExportedNames.add(m[1]);
      i++;
      continue;
    }

    m = trimmed.match(/^(?:export(?:\s+default)?\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (m && /^export\s+type\s/.test(trimmed) === false) {
      const name = m[1];
      const isDirectExport = /^export/.test(trimmed);
      const { bodyStart, bodyEnd } = scanBlock(i);
      decls.classes.push({
        name,
        directExport: isDirectExport,
        doc: extractDoc(lines, i),
        startLine: i + 1,
        bodyText: lines.slice(bodyStart + 1, bodyEnd).join('\n'),
      });
      i = bodyEnd + 1;
      continue;
    }

    m = trimmed.match(/^(?:export(?:\s+default)?\s+)?enum\s+(\w+)/);
    if (m) {
      const name = m[1];
      const isDirectExport = /^export/.test(trimmed);
      const { bodyStart, bodyEnd } = scanBlock(i);
      let bodyText = lines.slice(bodyStart + 1, bodyEnd).join('\n');
      // 单行 enum（`export enum X { A = 1, B = 2 }` 同行闭合）时直接从声明行截取
      if (!bodyText.trim()) {
        const openIdx = lines[i].indexOf('{');
        const closeIdx = lines[i].lastIndexOf('}');
        if (openIdx > -1 && closeIdx > openIdx) {
          bodyText = lines[i].slice(openIdx + 1, closeIdx).trim();
        }
      }
      decls.enums.push({
        name,
        directExport: isDirectExport,
        doc: extractDoc(lines, i),
        bodyText,
      });
      i = bodyEnd + 1;
      continue;
    }

    m = trimmed.match(/^(?:export\s+)?(?:declare\s+)?var\s+(\w+)\s*:/);
    if (m) {
      const name = m[1];
      const { bodyStart, bodyEnd } = scanBlock(i);
      decls.declareVars.push({
        name,
        doc: extractDoc(lines, i),
        startLine: i + 1,
        bodyText: lines.slice(bodyStart + 1, bodyEnd).join('\n'),
      });
      i = bodyEnd + 1;
      continue;
    }

    m = trimmed.match(/^export\s+function\s+(\w+)/);
    if (m) {
      const name = m[1];
      const joinLines = [trimmed];
      let j = i + 1;
      while (j < lines.length && !/\)\s*(:\s*[^;]+)?;\s*$/.test(joinLines[joinLines.length - 1])) {
        joinLines.push(lines[j].trim());
        j++;
      }
      decls.functions.push({
        name,
        raw: joinLines.join(' ').replace(/\s+/g, ' ').trim(),
        doc: extractDoc(lines, i),
      });
      i = j;
      continue;
    }

    m = trimmed.match(/^export\s+const\s+(\w+)/);
    if (m) {
      decls.consts.push({
        name: m[1],
        raw: trimmed,
        doc: extractDoc(lines, i),
        startLine: i + 1,
      });
      i++;
      continue;
    }

    i++;
  }
  // 过滤未导出的内部声明：仅保留直接 export 或通过 `export default X;` 转发导出的项
  // （避免把文件内仅用于内部实现的辅助类/接口/枚举计入对外接口清单）
  if (decls.defaultExportedNames.size > 0) {
    const keep = (d) => (d.directExport === true || d.directExport === undefined ? true : decls.defaultExportedNames.has(d.name));
    decls.classes = decls.classes.filter(keep);
    decls.interfaces = decls.interfaces.filter(keep);
    decls.enums = decls.enums.filter(keep);
  }
  return decls;
}

// ── 从 interface body 提取成员（方法/属性/事件）────────────

/**
 * 解析 interface / declare var body 的成员。
 * 返回 { methods:[], properties:[], statics:[], }
 * 每个成员: { signature, name, isStatic, isReadonly, isEvent }
 */
function parseInterfaceMembers(bodyText) {
  const lines = bodyText.split('\n');
  const methods = [];
  const properties = [];
  const statics = [];
  const t = (l) => l.trim();

  for (let i = 0; i < lines.length; i++) {
    const line = t(lines[i]);

    // 跳过空行、单行注释、双斜杠注释
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;

    // 函数类型属性: name: (... ) => type ;   视为属性（回调/事件）
    // onXxx 事件 handler 与普通回调属性
    let m = line.match(/^(?:readonly\s+)?(\w+)\s*(<[^>]*>)?\s*:\s*\(/);
    if (m && !line.includes(': ')) {
      // 处理跨行签名
      let full = line;
      let j = i;
      while (/[({]\s*$/.test(full) && j + 1 < lines.length) {
        full += ' ' + t(lines[++j]);
      }
      const name = m[1];
      const isEvent = /^on\w+/.test(name);
      const isReadonly = /^readonly\s/.test(line);
      // 解析完整签名，提取参数类型文本
      properties.push({
        name,
        signature: full.replace(/\)\s*:\s*/, ': ').replace(/;\s*$/, '').trim(),
        isEvent,
        isReadonly,
        isStatic: false,
      });
      i = j;
      continue;
    }

    // 方法: name(args): ret ;
    m = line.match(/^(?:readonly\s+)?(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(:\s*[^;]+)?\s*;?\s*$/);
    if (m) {
      const name = m[1];
      const args = m[3] || '';
      const ret = (m[4] || '').trim();
      const isReadonly = /^readonly\s/.test(line);
      // 处理参数跨行
      let fullArgs = args;
      let j = i;
      while (countOpen(fullArgs, '(', ')') > 0 && j + 1 < lines.length) {
        fullArgs += ' ' + t(lines[++j]);
      }
      if (fullArgs !== args) {
        // 重新解析完整签名
        const fullLine = line + ' ' + lines.slice(i + 1, j + 1).map(t).join(' ');
        const fm = fullLine.match(/^(?:readonly\s+)?(\w+)\s*(<[^>]*>)?\s*\(([\s\S]*?)\)\s*(:\s*[^;]+)?\s*;?\s*$/);
        if (fm) {
          methods.push({
            name: fm[1],
            signature: fullLine.replace(/;\s*$/, '').trim(),
            args: fm[3].trim(),
            ret: (fm[4] || '').trim() || ': void',
            isReadonly,
            isStatic: false,
            isEvent: false,
          });
          i = j;
          continue;
        }
      }
      methods.push({
        name,
        signature: line.replace(/;\s*$/, '').trim(),
        args,
        ret: ret || ': void',
        isReadonly,
        isStatic: false,
        isEvent: false,
      });
      continue;
    }

    // 属性: readonly name: type ; 或 name: type ;（保留可选 ?）
    m = line.match(/^(?:readonly\s+)?(\w+)(\??)\s*:\s*(.+?)\s*;?\s*$/);
    if (m) {
      const name = m[1];
      const optional = m[2] || '';
      const type = m[3].trim();
      properties.push({
        name: name + optional,
        signature: `${name}${optional}: ${type}`,
        type,
        isOptional: !!optional,
        isEvent: /^on\w+/.test(name),
        isReadonly: /^readonly\s/.test(line),
        isStatic: false,
      });
      continue;
    }

    // declare var 静态方法: methodName(args): ret;
    m = line.match(/^(\w+)\s*\(([^)]*)\)\s*(:\s*[^;]+)?\s*;?\s*$/);
    if (m && line.includes('(') && line.includes(')') && /^\w+\(/.test(line)) {
      methods.push({
        name: m[1],
        signature: line.replace(/;\s*$/, '').trim(),
        args: m[2].trim(),
        ret: (m[3] || '').trim() || ': void',
        isStatic: true, // declare var 主体中的方法均静态
        isReadonly: false,
        isEvent: false,
      });
      continue;
    }
  }
  return { methods, properties, statics };
}

/** 从 declare var body / export class body 提取静态成员（排除 new(...) 与 prototype: 字段） */
function parseDeclareVarStatics(bodyText) {
  const lines = bodyText.split('\n');
  const statics = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    if (t.startsWith('prototype:') || /^new[(\s]/.test(t) || /^new\s*[({]/.test(t)) continue;
    // 静态方法: static name(args): ret; 或 name(args): ret;
    const m = t.match(/^(?:static\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(/);
    if (m) {
      let full = t;
      let j = i;
      while (/[({]\s*$/.test(full) && j + 1 < lines.length) { full += ' ' + lines[++j].trim(); }
      statics.push({
        name: m[1],
        signature: full.replace(/;\s*$/, '').trim(),
        isStatic: true,
      });
      i = j;
    }
  }
  return statics;
}

function countOpen(str, openCh, closeCh) {
  let c = 0;
  for (const ch of str) {
    if (ch === openCh) c++;
    else if (ch === closeCh) c--;
  }
  return c;
}

// ── 主流程 ────────────────────────────────────────────────

const result = {
  libraryName: '',
  entryFile: '',
  nativeMode: 'none', // 'dts' | 'dets' | 'none'
  nativeDPath: '',
  sources: [],
  sections: {
    classes: [],      // ArkTS 侧 export class（含转发的）
    nativeClasses: [], // .d.ts 侧 declare var / export class（计入第 3 章）
    interfaces: [],   // export interface（第 4 章）
    types: [],        // export type（第 4 章）
    functions: [],
    variables: [],
    enums: [],        // 第 10 章枚举清单（不计入 S/N）
  },
};

// 1. 定位入口 Index.ets（路径自适应）
const candidates = [
  path.join(repoDir, 'library', 'Index.ets'),
  path.join(repoDir, 'library', 'src', 'main', 'ets', 'Index.ets'),
  path.join(repoDir, 'Index.ets'),
];
let entryFile = candidates.find((f) => fs.existsSync(f));
if (!entryFile) {
  // 深度自适应：在 repoDir 下递归寻找模块根目录的 Index.ets（如 ohos_webrtc/Index.ets）
  const deep = [];
  const walkIndex = (dir, depth) => {
    if (depth > 4) return;
    let hasIndex = false;
    for (const entry of fs.readdirSync(dir)) {
      if (entry === '.git' || entry === 'node_modules' || entry === 'oh_modules' || entry === 'entry' || entry === 'AppScope' || entry === 'build') continue;
      const full = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(full); } catch (e) { continue; }
      if (stat.isDirectory()) {
        walkIndex(full, depth + 1);
        const idx = fs.existsSync(path.join(full, 'Index.ets'));
        if (idx) deep.push(path.join(full, 'Index.ets'));
      }
    }
  };
  try { walkIndex(repoDir, 0); } catch (e) { /* ignore */ }
  // 优先选择含 oh-package.json5 且路径最短的模块目录
  if (deep.length > 0) {
    deep.sort((a, b) => a.length - b.length);
    entryFile = deep.find((p) => fs.existsSync(path.join(path.dirname(p), 'oh-package.json5')))
      || deep[0];
  }
}
if (!entryFile) {
  console.error(`无法定位入口文件 Index.ets（已尝试 library/Index.ets、library/src/main/ets/Index.ets、{repoDir}/Index.ets 及模块根目录递归搜索）: ${repoDir}`);
  process.exit(1);
}
result.entryFile = rel(entryFile);
console.log(`入口文件: ${result.entryFile}`);

// 2. 读取 oh-package.json5 获取库名（宽松 JSON5 解析）
const ohPkgCandidates = [
  path.join(repoDir, 'library', 'oh-package.json5'),
  path.join(repoDir, 'oh-package.json5'),
];
for (const p of ohPkgCandidates) {
  if (fs.existsSync(p)) {
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const m = raw.match(/["']?name["']?\s*:\s*["']([^"']+)["']/);
      if (m) { result.libraryName = m[1]; break; }
    } catch (e) { /* ignore */ }
  }
}

// 3. 解析 Index.ets
const indexContent = readText(entryFile);
const indexLines = indexContent.split('\n');

// 是否 Native 默认导出（import X from '*.so'; export default X）或 export * from '*.so'
const hasNativeSoImport = /import\s+\w+\s+from\s+['"][^'"]*\.so['"]/.test(indexContent);
const hasNativeSoExportStar = /export\s*\*\s*from\s+['"][^'"]*\.so['"]/.test(indexContent);

if (hasNativeSoImport || hasNativeSoExportStar) {
  // 定位 .d.ts / .d.ets
  console.log('检测到 Native 模块导出（.so 默认导出/通配转发）');
  for (const l of indexLines) {
    const soM = l.match(/from\s+['"]([^'"]*\.so)['"]/);
    if (soM) {
      const soName = soM[1];
      const libBase = soName.replace(/\.so$/, '').replace(/.*\//, '');
      // 搜索 .d.ts（优先）与 .d.ets
      const dtsPaths = glob(repoDir, `**/*.d.ts`);
      const detsPaths = glob(repoDir, `**/*.d.ets`);
      // 优先匹配包含 libBase 的文件
      let nativeFile = dtsPaths.find((p) => p.toLowerCase().includes(libBase.toLowerCase()));
      if (!nativeFile) nativeFile = detsPaths.find((p) => p.toLowerCase().includes(libBase.toLowerCase()));
      if (!nativeFile) nativeFile = dtsPaths.find((p) => /libohos_|webrtc/.test(p.toLowerCase()));
      if (!nativeFile && dtsPaths.length > 0) nativeFile = dtsPaths[0];
      if (nativeFile) {
        result.nativeDPath = rel(nativeFile);
        result.nativeMode = nativeFile.toLowerCase().endsWith('.d.ts') ? 'dts' : 'dets';
        result.sources.push(result.nativeDPath);

        // 若命中 index.d.ts 转发层（export * from './xxx'），追踪到实际声明文件
        const nativeAbs = nativeFile;
        const nativeContent = readText(nativeAbs);
        const starExp = nativeContent.match(/export\s*\*\s*from\s*['"]([^'"]+)['"]/);
        if (starExp && /index\.d\.ts$/i.test(nativeFile)) {
          const target = path.resolve(path.dirname(nativeAbs), starExp[1]);
          // 补全扩展名 .d.ts
          for (const cand of [target, `${target}.d.ts`, path.join(target, 'index.d.ts')]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
              result.nativeDPath = rel(cand);
              result.sources.push(result.nativeDPath);
              break;
            }
          }
        }
      }
      break;
    }
  }
}

// 解析 Index.ets 的具名转发导出
function resolveModulePath(fromSpec) {
  // from './path' → 相对入口目录
  const fromClean = fromSpec.replace(/^['"]|['"]$/g, '').replace(/^\.[/\\]?/, '');
  let base;
  if (fromClean.startsWith('lib') || fromClean.includes('.so')) return null;
  base = path.join(path.dirname(entryFile), fromClean);
  // ArkTS 扩展名 .ets，兼容文件或目录
  const candidatesEts = [
    `${base}.ets`,
    path.join(base, 'index.ets'),
    path.join(base, 'Index.ets'),
    base,
  ];
  for (const c of candidatesEts) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// 递归追踪转发导出（depth ≤ 3）
const visitedFiles = new Set();
function traceExports(fromSpec, depth, localExportNames) {
  if (depth > 3) return;
  const target = resolveModulePath(fromSpec);
  if (!target) return;
  if (visitedFiles.has(target)) return;
  visitedFiles.add(target);
  result.sources.push(rel(target));

  const content = readText(target);
  // 处理 export { X } from './x' 继续追踪
  const fwd = content.match(/export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/);
  const starFwd = content.match(/export\s*\*\s*from\s*['"][^'"]+['"]/);
  for (const m of content.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    traceExports(m[2], depth + 1, names);
  }
  for (const m of content.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    traceExports(m[1], depth + 1, null);
  }

  // 解析目标文件的顶层导出
  const decls = parseTopLevelDecls(target);
  const isExported = (name) => !localExportNames || localExportNames.includes(name);
  for (const cls of decls.classes) {
    if (isExported(cls.name)) {
      result.sections.classes.push({
        name: cls.name,
        kind: 'class',
        source: rel(target),
        doc: cls.doc,
        bodyText: cls.bodyText,
      });
    }
  }
  for (const it of decls.interfaces) {
    if (isExported(it.name)) {
      result.sections.interfaces.push({
        name: it.name,
        kind: 'interface',
        source: rel(target),
        doc: it.doc,
        bodyText: it.bodyText,
        members: parseInterfaceMembers(it.bodyText),
      });
    }
  }
  for (const ty of decls.types) {
    if (isExported(ty.name)) {
      result.sections.types.push({
        name: ty.name,
        kind: 'type',
        source: rel(target),
        doc: ty.doc,
        raw: ty.raw,
      });
    }
  }
  for (const fn of decls.functions) {
    if (isExported(fn.name)) {
      result.sections.functions.push({ name: fn.name, signature: fn.raw, doc: fn.doc, source: rel(target) });
    }
  }
  for (const cs of decls.consts) {
    if (isExported(cs.name)) {
      result.sections.variables.push({
        name: cs.name,
        type: cs.raw.replace(/^export\s+const\s+\w+\s*=\s*/, '').trim(),
        doc: cs.doc,
        source: rel(target),
      });
    }
  }
  for (const en of decls.enums) {
    if (isExported(en.name)) {
      result.sections.enums.push({
        name: en.name,
        source: rel(target),
        bodyText: en.bodyText,
        doc: en.doc,
      });
    }
  }
}

// 收集 Index.ets 各项
for (const line of indexLines) {
  const t = line.trim();
  // export { X, Y } from './path'
  let m = t.match(/^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/);
  if (m) {
    const names = m[1].split(',').map((s) => s.trim().replace(/^.*\bas\s+/, '')).filter(Boolean);
    traceExports(m[2], 1, names);
    continue;
  }
  // export * from './path'
  m = t.match(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/);
  if (m) {
    traceExports(m[1], 1, null);
    continue;
  }
}

// 若未解析到 ArkTS classes/enums（转发导出失败或为空），从 decls 直接解析入口文件自身
if (result.sections.classes.length === 0 && result.sections.enums.length === 0) {
  const ownDecls = parseTopLevelDecls(entryFile);
  for (const cls of ownDecls.classes) {
    result.sections.classes.push({ name: cls.name, kind: 'class', source: rel(entryFile), doc: cls.doc, bodyText: cls.bodyText });
  }
  for (const en of ownDecls.enums) {
    result.sections.enums.push({ name: en.name, source: rel(entryFile), bodyText: en.bodyText, doc: en.doc });
  }
}

// ── 4. 解析 Native 声明（.d.ts 模式，计入 N/S）──────────────
if (result.nativeMode === 'dts' && result.nativeDPath) {
  const nativeFile = path.join(repoDir, result.nativeDPath.replace(/^\.\//, '').split('/').join(path.sep));
  console.log(`解析 Native 声明: ${rel(nativeFile)} (${result.nativeMode})`);
  const decls = parseTopLevelDecls(nativeFile);

  // 先收集 declare var 类名集合
  const declareVarNames = new Set();
  for (const dv of decls.declareVars) {
    declareVarNames.add(dv.name);
    // 提取 { prototype: X; new(...); 静态方法 } 中的静态方法
    const statics = parseDeclareVarStatics(dv.bodyText);
    result.sections.nativeClasses.push({
      name: dv.name,
      kind: 'dts-class',
      isStaticOnly: statics.length === 0,
      statics, // 静态方法/变量（从 declare var body 提取）
      doc: dv.doc,
      source: result.nativeDPath,
      bodyText: dv.bodyText,
    });
  }

  // interfaces / types
  for (const it of decls.interfaces) {
    // has declare var 同名 → 类（第 3 章），否则 → 接口（第 4 章）
    if (declareVarNames.has(it.name)) {
      const cls = result.sections.nativeClasses.find((c) => c.name === it.name);
      if (cls) {
        cls.members = parseInterfaceMembers(it.bodyText);
        cls.doc = cls.doc && cls.doc !== '-' ? cls.doc : it.doc;
      }
    } else {
      result.sections.interfaces.push({
        name: it.name,
        kind: 'interface',
        source: result.nativeDPath,
        doc: it.doc,
        bodyText: it.bodyText,
        members: parseInterfaceMembers(it.bodyText),
      });
    }
  }

  for (const ty of decls.types) {
    result.sections.types.push({
      name: ty.name,
      kind: 'type',
      source: result.nativeDPath,
      doc: ty.doc,
      raw: ty.raw,
    });
  }

  // export class（如 NativeLogging）
  for (const cls of decls.classes) {
    if (declareVarNames.has(cls.name)) continue;
    const statics = parseDeclareVarStatics(cls.bodyText);
    result.sections.nativeClasses.push({
      name: cls.name,
      kind: 'dts-class',
      isStaticOnly: true,
      doc: cls.doc,
      source: result.nativeDPath,
      statics,
      members: { methods: [], properties: [] },
    });
  }

  // export function / const（第 6、7 章）
  for (const fn of decls.functions) {
    result.sections.functions.push({ name: fn.name, signature: fn.raw, doc: fn.doc, source: result.nativeDPath });
  }
  for (const cs of decls.consts) {
    result.sections.variables.push({ name: cs.name, type: cs.raw.replace(/^export\s+const\s+\w+\s*=\s*/, '').trim(), doc: cs.doc, source: result.nativeDPath });
  }
  // export enum
  for (const en of decls.enums) {
    result.sections.enums.push({ name: en.name, source: result.nativeDPath, bodyText: en.bodyText, doc: en.doc });
  }
}

// ── 5. 将 ArkTS classes 的 bodyText 解析为成员 ─────────────
for (const cls of result.sections.classes) {
  const srcFile = path.join(repoDir, cls.source.replace(/^\.\//, '').split('/').join(path.sep));
  if (!fs.existsSync(srcFile)) continue;
  cls.members = extractArkTSClassMembers(readText(srcFile), cls.name);
}

/**
 * 从 ArkTS 类定义提取公开成员（方法/属性）。
 * 规则：仅取无 private/protected/internal 修饰的成员；static 标注；构造跳过。
 */
function extractArkTSClassMembers(fileContent, className) {
  // 定位类声明，取类体文本
  const lines = fileContent.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(?:export(?:\s+default)?\s+)?(?:abstract\s+)?(?:class|struct)\s+(\w+)/);
    if (m && m[1] === className) { startIdx = i; break; }
  }
  if (startIdx === -1) return [];
  let depth = 0;
  const body = [];
  for (let i = startIdx; i < lines.length; i++) {
    depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
    if (depth >= 1 && i > startIdx) body.push(lines[i]);
    if (depth <= 0 && i > startIdx) break;
  }
  const members = parseArkTSClassMembersFromBody(body.join('\n'));

  // 内部类/Builder 展开：检测 `static X = new Y()` 公有静态属性，若同文件存在 `class Y`，
  // 将 Y 的公开方法以 `X.方法名()` 前缀合并进成员（内部类本身不单独建小节）。
  const memberDefs = members.slice();
  for (const m of memberDefs) {
    const im = (m.signature || '').match(/(?:^|\s)static\s+(\w+)\s*=\s*new\s+(\w+)\s*\(/i);
    if (!im) continue;
    const prefixName = im[1]; // 静态属性名（如 Builder）
    const innerName = im[2]; // 内部类名（如 BleScanRuleConfigBuilder）
    let innerStart = -1;
    for (let i = 0; i < lines.length; i++) {
      const imm = lines[i].trim().match(/^(?:export(?:\s+default)?\s+)?(?:abstract\s+)?class\s+(\w+)/);
      if (imm && imm[1] === innerName) { innerStart = i; break; }
    }
    if (innerStart === -1) continue;
    let d = 0;
    const innerBody = [];
    for (let i = innerStart; i < lines.length; i++) {
      d += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
      if (d >= 1 && i > innerStart) innerBody.push(lines[i]);
      if (d <= 0 && i > innerStart) break;
    }
    const innerMembers = parseArkTSClassMembersFromBody(innerBody.join('\n'));
    for (const inner of innerMembers) {
      if (inner.name === 'constructor' || /^new\s*\(/.test(inner.signature || '')) continue;
      members.push({
        name: `${prefixName}.${inner.name}`,
        signature: inner.signature.replace(new RegExp(`^${inner.name}\\b`), `${prefixName}.${inner.name}`),
        isStatic: false,
        isProperty: false,
      });
    }
  }
  return members;
}

/**
 * 从 ArkTS 类体文本提取公开成员（方法/字段/箭头函数属性）。
 * 规则（对应 SKILL 步骤 3b）：
 *  - 忽略 private/protected/internal 修饰成员与 constructor
 *  - 无修饰符成员默认 public
 *  - 方法体包围深度跳节
 */
function parseArkTSClassMembersFromBody(bodyText) {
  const lines = bodyText.split('\n');
  const members = [];
  const t = (l) => l.trim();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const s = t(line);

    // 跳过非声明行
    if (!s || s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) continue;
    // 跳过方法体内部的语句
    if (/^(if|for|while|switch|return|break|continue|try|catch|finally|throw|new|console\.|this\.)/.test(s)) continue;
    // 跳过方法体内部的 const 箭头函数声明并跳至其闭合（`const func = async (...) => { ... };`）
    if (/^const\s+\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>/.test(s)) {
      let depth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      while (i + 1 < lines.length) {
        i++;
        depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
        if (depth <= 0) break;
      }
      continue;
    }
    // 跳过方法体内部的无分号赋值语句（`descriptor = this.getDescriptor(...)` 等 === 标识符 = 表达式）
    if (/^\w+\s*=\s*[^;]+$/.test(s) && !s.includes('==') && !s.includes('=>') && !/^\s*(public|private|protected|static|readonly|let|var|const)\b/.test(s)) continue;
    // 跳过 private/protected/internal 方法（含跨行签名与方法体）
    if (/(?:^|\s)(?:private|protected|internal)\s+(?:(?:static|abstract|readonly|async)\s+)*[\w<>]+\s*\(/.test(s)) {
      // 合并跨行签名
      let full = s;
      let j = i;
      let guard = 0;
      while (countOpen(full, '(', ')') > 0 && j + 1 < lines.length && guard < 20) {
        full += ' ' + t(lines[++j]);
        guard++;
      }
      // 跳过方法体
      let md = 0;
      for (let p = i; p <= j; p++) md += (lines[p].match(/{/g) || []).length - (lines[p].match(/}/g) || []).length;
      i = j;
      if (!/;\s*$/.test(full.trim())) {
        while (i + 1 < lines.length) {
          i++;
          md += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
          if (md <= 0) break;
        }
      }
      continue;
    }
    if (/(?:^|\s)(?:private|protected|internal)\s+/.test(s)) continue;
    if (/(?:^|\s)constructor\s*\(/.test(s)) continue;

    // 字段声明: 修饰符任意组合后跟 name: type [= value];
    // （含常量容器类 static NAME: type = value;、public static readonly TAG: string 等）
    const propM = s.match(/^(?:(?:public|private|protected|internal|static|readonly|async)\s+)*(?:(\w+)\s*:\s*(.+?))[;]?\s*$/);
    if (propM) {
      const name = propM[1];
      const flagsPart = s.slice(0, s.indexOf(':')).trim();
      const isStatic = /(^|\s)static(\s|$)/.test(flagsPart);
      const hasPrivate = /\b(private|protected|internal)\b/.test(flagsPart);
      if (!hasPrivate && !/^(if|for|while|switch|return|break|continue|try|catch|finally|throw|let|const|var)\b/.test(name)) {
        members.push({ name, signature: s.replace(/;\s*$/, ''), isStatic, isProperty: true });
        continue;
      }
    }

    // 常量字段声明（无类型标注）: [public] [static] [readonly] NAME = value;
    // （常量容器类，如 BluetoothGattCharacteristic 的 public static readonly PROPERTY_XXX = 0x01）
    const constM = s.match(/^(?:(?:public|private|protected|internal|static|readonly)\s+)*(\w+)\s*=\s*[^;]*;?\s*$/);
    if (constM) {
      const name = constM[1];
      const flagsPart = s.slice(0, s.indexOf('=')).trim();
      const isStatic = /(^|\s)static(\s|$)/.test(flagsPart);
      const hasPrivate = /\b(private|protected|internal)\b/.test(flagsPart);
      if (!hasPrivate && !/^(if|for|while|switch|return|break|continue|try|catch|finally|throw|let|const|var)\b/.test(name)) {
        members.push({ name, signature: s.replace(/;\s*$/, ''), isStatic, isProperty: true });
        continue;
      }
    }

    // 方法声明（含返回类型；可 static/async/public，修饰符任意顺序），支持参数跨行
    // 形如: [static] [public] methodName(args): ret {  或  [public] [static] methodName(args) { 或 ...; 结尾
    // 跨行示例: public enableCharacteristicNotify(a: string,\n b: boolean): void {
    let m = null;
    if (s.includes('(') && !s.includes('?.') && !s.includes('=>')) {
      m = s.match(/^(?:(static|async|public|abstract)\s+)?(?:(static|async|public|abstract)\s+)?(\w+)\s*\(([^)]*)\)\s*(:\s*[^{;]+?)?\s*[;{]?\s*$/);
    }
    // 单行形式未匹配但形似方法签名开头且括号未闭合 → 参数跨行累积
    if (!m && s.match(/^(?:(static|async|public|abstract)\s+)?(?:(static|async|public|abstract)\s+)?\w+\s*\(/) && countOpen(s, '(', ')') > 0) {
      let full = s;
      let j = i;
      let guard = 0;
      while (countOpen(full, '(', ')') > 0 && j + 1 < lines.length && guard < 20) {
        full += ' ' + t(lines[++j]);
        guard++;
      }
      m = full.match(/^(?:(static|async|public|abstract)\s+)?(?:(static|async|public|abstract)\s+)?(\w+)\s*\(([\s\S]*?)\)\s*(:\s*[^{;]+?)?\s*[;{]?\s*$/);
      if (m) {
        const mname = m[3];
        const isStatic = /(^|\s)static(\s|$)/.test(full);
        const ret = (m[5] || '').trim() || ': void';
        members.push({
          name: mname,
          signature: `${(isStatic ? 'static ' : '')}${mname}(${m[4] ? m[4].replace(/\s+/g, ' ').trim() : ''})${ret}`,
          isStatic,
          isProperty: false,
        });
        // 跳过完整声明 + 方法体
        let md = 0;
        for (let p = i; p <= j; p++) md += (lines[p].match(/{/g) || []).length - (lines[p].match(/}/g) || []).length;
        i = j;
        if (!/;\s*$/.test(full.trim())) {
          while (i + 1 < lines.length) {
            i++;
            md += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
            if (md <= 0) break;
          }
        }
        continue;
      }
    }
    if (m) {
      const name = m[3];
      // 过滤保留字伪方法（super/throw/return/new 等调用行被误判）
      if (!/^(super|throw|new|return|break|continue|void|this)$/.test(name)) {
        const flags = ((m[1] || '') + ' ' + (m[2] || '')).trim();
        const isStatic = /\bstatic\b/.test(flags);
        const ret = (m[5] || '').trim() || ': void';
        const sig = `${(isStatic ? 'static ' : '')}${name}(${m[4].trim()})${ret}`;
        members.push({ name, signature: sig, isStatic, isProperty: false });
      }
      // 跳过方法体：从声明行起累计大括号深度，直到闭合（含同行的 { 或空实现 ;）
      let md = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      if (/;\s*$/.test(s)) { continue; } // 空实现（; 结尾），无需跳过
      while (i + 1 < lines.length) {
        i++;
        md += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
        if (md <= 0) break;
      }
      continue;
    }

    // 箭头函数字段属性（callback = (data) => {...}）
    const arrowM = s.match(/^(?:(static)\s+)?(?:public\s+)?(\w+)\s*=\s*\(([^)]*)\)\s*=>/);
    if (arrowM) {
      members.push({
        name: arrowM[1],
        signature: `${(arrowM[1] ? '' : '')}${arrowM[1]}(${arrowM[2].trim()})`,
        isStatic: false,
        isProperty: true,
      });
      continue;
    }
  }
  return members;
}

// ── 6. 输出 ───────────────────────────────────────────────
const outText = JSON.stringify(result, null, 2);
if (output) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, outText, 'utf-8');
}
console.log('\n=== 提取结果 ===');
console.log(`库名: ${result.libraryName || '(未识别)'}`);
console.log(`入口: ${result.entryFile}`);
console.log(`Native 模式: ${result.nativeMode}${result.nativeDPath ? ' (' + result.nativeDPath + ')' : ''}`);
console.log(`ArkTS 类: ${result.sections.classes.length}  枚举: ${result.sections.enums.length}`);
console.log(`Native 类(declare var/class): ${result.sections.nativeClasses.length}  interface: ${result.sections.interfaces.length}  type: ${result.sections.types.length}`);
console.log(`函数: ${result.sections.functions.length}  变量: ${result.sections.variables.length}`);
console.log(`\n中间 JSON${output ? ' 已写入: ' + output : '（未指定 --output，仅打印统计）'}`);

if (output) {
  console.log(`已写出 ${fs.statSync(output).size} 字节`);
}