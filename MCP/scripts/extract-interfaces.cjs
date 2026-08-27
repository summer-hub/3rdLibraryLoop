#!/usr/bin/env node
/**
 * @tool arkts_extract_interfaces
 * @description 从鸿蒙 ArkTS 三方库源码目录提取接口规格。基于 TypeScript Compiler API 语义分析，提取类/接口/枚举/方法/属性/字段等导出接口信息，输出 JSON 或直接传给下游覆盖率分析。用于分析库的完整 API 表面。
 * @param libroot: string - 库源码根目录路径（包含 library/ 子目录，其中有 Index.ets 入口文件）
 * @param output: string - 输出 JSON 文件路径（可选，不指定则输出 JSON 到 stdout）
 * @hidden
 * extract-interfaces.cjs — 鸿蒙 ArkTS 三方库接口提取引擎（统一版）
 *
 * 合并了 parse-spec-ast.cjs（AST 语义分析）和 extract-interfaces.cjs（正则边缘场景）
 * 两套方案的优势，作为接口规格文档生成、XTS 覆盖率、Demo 覆盖率的统一数据源。
 *
 * 核心策略：
 *   1. TS Compiler API 语义分析为引擎核心（类型推断、导出可见性、JSDoc）
 *   2. .ets → .ts 虚拟路径映射 + struct→class 文本替换
 *   3. .so 模块 types/ 目录搜索 + declare var 静态方法提取
 *   4. export default / export { } 转发导出追踪
 *   5. 内部类展开（static Builder = new InnerBuilder()）
 *   6. 深度递归搜索 Index.ets（≤4 层）
 *
 * 用法:
 *   node extract-interfaces.cjs --repoDir <库源码目录> --output <interface-spec.json>
 *
 * 使用示例:
 *   # 从库源码目录提取接口，输出 JSON 中间件
 *   node extract-interfaces.cjs --repoDir /path/to/lottie_turbo --output lottie_turbo-interface-spec.json
 *
 *   # 无 --output 时输出到 stdout
 *   node extract-interfaces.cjs --repoDir /path/to/lottie_turbo
 *
 *   # 库源码目录结构约定:
 *   #   /path/to/lottie_turbo/
 *   #     ├── library/              ← 库源码（Index.ets 入口）
 *   #     │   ├── Index.ets
 *   #     │   ├── src/main/ets/
 *   #     │   └── src/main/cpp/types/.../Index.d.ts   ← Native .so 声明
 *   #     └── entry/src/main/ets/    ← Demo 源码
 *
 * 输出 JSON 数据模型见 INTERFACE_SCHEMA.md
 *
 * 模块导出:
 *   const { generateSpec } = require('./extract-interfaces.cjs');
 *   const spec = generateSpec('/path/to/lottie_turbo');  // 直接返回内存对象，无需写 JSON
 */

const fs = require('fs');
const path = require('path');

// ── TypeScript 加载（自动查找）─────────────────────────────
function loadTypeScript() {
  // 最优先：libraryTestScan.js 通过环境变量注入的精确路径
  if (process.env.TYPESCRIPT_PATH) {
    try {
      const ts = require(process.env.TYPESCRIPT_PATH);
      if (ts && typeof ts.createProgram === 'function') return ts;
    } catch (e) { /* continue */ }
  }
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'typescript'),
    path.join(__dirname, 'node_modules', 'typescript'),
    // fallback: 从 XTS Skill 目录查找
    path.join(__dirname, '..', '..', '3rdLibraryLoop', 'Server', 'Skills', 'ArkTsLibraryXTSCoverageSkill', 'node_modules', 'typescript'),
    path.join(__dirname, '..', 'Server', 'Skills', 'ArkTsLibraryXTSCoverageSkill', 'node_modules', 'typescript'),
  ];
  for (const p of candidates) {
    try {
      const ts = require(p);
      if (ts && typeof ts.createProgram === 'function') return ts;
    } catch (e) { /* continue */ }
  }
  // 最后尝试全局 require
  try {
    const ts = require('typescript');
    if (ts && typeof ts.createProgram === 'function') return ts;
  } catch (e) { /* continue */ }
  console.error('错误: 无法加载 typescript 模块。请运行 npm install typescript');
  process.exit(1);
}

const ts = loadTypeScript();

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
      rec(dir, idx + 1);
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        let st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (st.isDirectory()) {
          if (entry === '.git' || entry === 'node_modules' || entry === 'oh_modules' || entry === 'build' || entry === '.hvigor') continue;
          rec(full, idx);
          rec(full, idx + 1);
        }
      }
      return;
    }
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (part.includes('*')) {
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

/** 获取某文件相对 repoDir 的 posix 风格相对路径 */
function rel(filePath, repoDir) {
  let r = path.relative(repoDir, filePath).split('\\').join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

/** 读取文件文本，兼容 BOM */
function readText(file) {
  return fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
}

/** 从源码行列表中提取 JSDoc 描述（向上回溯注释，作为正则方案补充） */
function extractDocFromLines(lines, idx, maxLookback = 8) {
  const docLines = [];
  let j = idx - 1;
  while (j >= 0 && idx - j <= maxLookback) {
    const line = lines[j].trim();
    if (line.startsWith('*/')) { docLines.unshift(line); j--; continue; }
    if (line.startsWith('*') || line.startsWith('/**') || line.startsWith('/*')) {
      docLines.unshift(line); j--; continue;
    }
    if (line.startsWith('//')) { docLines.unshift(line.replace(/^\/\/\s*/, '')); j--; continue; }
    break;
  }
  const text = docLines.join(' ').replace(/\/\*|\*\//g, '').replace(/\s+/g, ' ').trim();
  const filtered = text
    .replace(/Copyright\s*\(c\)[^]*?License[^]*?(License\)|limitations[^.]*)/gi, '')
    .replace(/#[036]477969|https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(license|licensed under)/i.test(filtered)) return '-';
  return filtered || '-';
}

// ── 入口文件定位 ────────────────────────────────────────────

/**
 * 大小写校准：macOS/Windows 文件系统大小写不敏感，fs.existsSync('Index.ets')
 * 对磁盘上实际名为 index.ets 的文件同样返回 true，导致返回的路径大小写可能与
 * 磁盘真实大小写不一致；后续以该路径为 key 的精确匹配（Map/对象查找、TS 虚拟
 * 路径解析）会静默失败。用 readdirSync 返回的真实文件名回写。
 */
function toRealCase(filePath) {
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const entries = fs.readdirSync(dir);
    if (entries.includes(base)) return filePath;
    const real = entries.find((e) => e.toLowerCase() === base.toLowerCase());
    if (real) return path.join(dir, real);
  } catch (e) { /* ignore */ }
  return filePath;
}

/**
 * 定位入口 Index.ets（多级自适应搜索）
 * 优先级: library/Index.ets > library/src/main/ets/Index.ets > {repoDir}/Index.ets
 * Fallback: 深度递归搜索模块根目录（≤4 层）
 * 注意：返回路径统一经 toRealCase 校准为磁盘真实大小写（Index.ets vs index.ets）
 */
function locateEntryFile(repoDir) {
  const candidates = [
    path.join(repoDir, 'library', 'Index.ets'),
    path.join(repoDir, 'library', 'src', 'main', 'ets', 'Index.ets'),
    path.join(repoDir, 'Index.ets'),
  ];
  let entryFile = candidates.find((f) => fs.existsSync(f));
  if (entryFile) return toRealCase(entryFile);

  // 深度递归搜索
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
        if (idx) deep.push(toRealCase(path.join(full, 'Index.ets')));
      }
    }
  };
  try { walkIndex(repoDir, 0); } catch (e) { /* ignore */ }
  if (deep.length > 0) {
    deep.sort((a, b) => a.length - b.length);
    entryFile = deep.find((p) => fs.existsSync(path.join(path.dirname(p), 'oh-package.json5'))) || deep[0];
  }
  return entryFile ? toRealCase(entryFile) : null;
}

// ── 库名提取 ──────────────────────────────────────────────

/**
 * 简单正则转义
 */
function escapeRegexStr(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从 oh-package.json5 文件提取顶层 name 字段
 * 注意：只匹配顶层 name（缩进 ≤2 空格），避免误匹配嵌套对象的 name 字段
 *      （如 author.name / contributor.name）
 * @param {string} pkgPath
 * @returns {string|null}
 */
function readPkgName(pkgPath) {
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const m = raw.match(/^\s{0,2}["']?name["']?\s*:\s*["']([^"']+)["']/m);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * 从 entry/oh-package.json5 的 dependencies 反查指向 libDirName 的依赖名
 * 当库自身 oh-package.json5 缺 name 字段时，消费方 dependencies 的 key
 * 才是用户 import 时用的真实包名（如 @ohos/mqtt）
 * @param {string} repoDir
 * @param {string} libDirName  库模块目录名（如 ohos_Mqtt）
 * @returns {string|null}
 */
function findDepNameFromEntry(repoDir, libDirName) {
  const entryPkgPath = path.join(repoDir, 'entry', 'oh-package.json5');
  if (!fs.existsSync(entryPkgPath)) return null;
  try {
    const raw = fs.readFileSync(entryPkgPath, 'utf-8');
    // 匹配 "依赖名": "file:../libDirName" 或 "file:../libDirName/..."
    const depRegex = new RegExp(
      `["']([^"']+)["']\\s*:\\s*["']file:\\.\\./${escapeRegexStr(libDirName)}(?:/[^"']*)?["']`
    );
    const m = raw.match(depRegex);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * 提取库的真实包名（用户 import 时用的名字）
 *
 * 查找优先级:
 *   1. 库模块目录（entryFile 所在的最近含 oh-package.json5 的父目录）的 name 字段
 *   2. {repoDir}/library/oh-package.json5 的 name 字段（标准结构向后兼容）
 *   3. entry/oh-package.json5 的 dependencies 中指向库目录的依赖名
 *      （库自身缺 name 时，消费方声明的依赖名才是真实包名，如 @ohos/mqtt）
 *   4. {repoDir}/oh-package.json5 的 name 字段（工程名兜底）
 *   5. path.basename(repoDir)
 *
 * @param {string} repoDir
 * @param {string=} entryFile  入口文件路径（用于定位库模块目录）
 */
function extractLibraryName(repoDir, entryFile) {
  const candidates = [];

  // 1. entryFile 所在的最近含 oh-package.json5 的父目录
  if (entryFile) {
    let dir = path.dirname(entryFile);
    for (let i = 0; i < 6 && dir && dir.startsWith(repoDir); i++) {
      const pkgPath = path.join(dir, 'oh-package.json5');
      if (fs.existsSync(pkgPath)) {
        candidates.push(pkgPath);
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // 2. 标准结构
  candidates.push(path.join(repoDir, 'library', 'oh-package.json5'));

  // 先从库自身 oh-package.json5 取 name
  for (const p of candidates) {
    const name = readPkgName(p);
    if (name) return name;
  }

  // 3. entry dependencies 反查（库自身缺 name 时的关键回退）
  if (entryFile) {
    const libDirName = path.basename(path.dirname(entryFile));
    const depName = findDepNameFromEntry(repoDir, libDirName);
    if (depName) return depName;
  }

  // 4. 根 oh-package.json5（工程名兜底）
  const rootName = readPkgName(path.join(repoDir, 'oh-package.json5'));
  if (rootName) return rootName;

  // 5. basename 兜底
  return path.basename(repoDir);
}

// ── 源文件收集 ──────────────────────────────────────────────

/**
 * 收集库中所有 .d.ts / .ets / .ts 源文件路径
 *
 * 模块根目录定位策略（与 locateEntryFile 保持一致）:
 *   1. {libRoot}/library              ← 标准结构（lottie_turbo 等），向后兼容
 *   2. entryFile 向上最近的含 oh-package.json5 / oh-package.json 的目录
 *      ← 非标准结构（ohos_mqtt 用 ohos_Mqtt/ 作模块根）
 *   3. entryFile 所在目录              ← 兜底
 *
 * @param {string} libRoot   库源码根目录
 * @param {string} entryFile 入口 Index.ets 路径（用于定位非标准结构的模块根）
 */
function collectSourceFiles(libRoot, entryFile) {
  const sources = [];

  // 定位模块根目录
  let moduleRoot = path.join(libRoot, 'library');
  if (!fs.existsSync(moduleRoot) && entryFile) {
    let dir = path.dirname(entryFile);
    for (let i = 0; i < 6 && dir && dir.startsWith(libRoot); i++) {
      if (fs.existsSync(path.join(dir, 'oh-package.json5')) ||
          fs.existsSync(path.join(dir, 'oh-package.json'))) {
        moduleRoot = dir;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    // 兜底：entryFile 所在目录
    if (!fs.existsSync(moduleRoot)) moduleRoot = path.dirname(entryFile);
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'oh_modules' || entry.name === 'build') continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.ets') || entry.name.endsWith('.ts')) {
          sources.push(fullPath);
        }
      }
    }
  }

  walk(moduleRoot);
  return sources;
}

// ── AST 辅助函数 ────────────────────────────────────────────

/** 获取 symbol 的 JSDoc 描述 */
function getJsDocDescription(checker, node) {
  if (!node) return '-';
  try {
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol) {
      const jsDocTags = symbol.getJsDocTags();
      const descTag = jsDocTags.find(t => t.name === 'description' || t.name === 'desc');
      if (descTag && descTag.text) return descTag.text;

      const decls = symbol.getDeclarations();
      if (decls && decls.length > 0) {
        const jsDoc = ts.getJSDocCommentsAndTags(decls[0]);
        if (jsDoc && jsDoc.length > 0 && typeof jsDoc[0].comment === 'string') {
          return jsDoc[0].comment.trim().split('\n')[0];
        }
      }
    }
  } catch (e) { /* fall through */ }
  return '-';
}

/** 获取成员签名字符串 */
function getMemberSignature(checker, node) {
  try {
    if (node.name) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, node);
        if (type) {
          const typeStr = checker.typeToString(type);
          if (typeStr && typeStr !== 'any') {
            return `${node.name.text}: ${typeStr}`;
          }
        }
      }
    }
  } catch (e) { /* fall through */ }
  return node.getText().trim().split('\n')[0];
}

/** 判断成员是否为 static */
function isStaticMember(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) return false;
  return modifiers.some(m => m.kind === ts.SyntaxKind.StaticKeyword);
}

/** 判断成员是否为 readonly */
function isReadonlyMember(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) return false;
  return modifiers.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword);
}

/** 判断成员是否为 private/protected/internal */
function isPrivateMember(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) return false;
  return modifiers.some(m =>
    m.kind === ts.SyntaxKind.PrivateKeyword ||
    m.kind === ts.SyntaxKind.ProtectedKeyword
  );
}

/** 判断是否为 @Component struct 组件 */
function isStructComponent(node) {
  if (!node.modifiers) return false;
  return node.modifiers.some(m =>
    m.kind === ts.SyntaxKind.Decorator &&
    m.expression &&
    ts.isIdentifier(m.expression) &&
    m.expression.text === 'Component'
  );
}

// ── 成员分类 ──────────────────────────────────────────────

/** 检查属性的类型是否为函数类型（如 `play: () => void`） */
function isFunctionTypedProperty(node) {
  if (!node.type) return false;
  const t = node.type;
  // 直接函数类型节点: () => void
  if (ts.isFunctionTypeNode(t)) return true;
  // 联合类型中包含函数类型: (() => void) | null
  if (ts.isUnionTypeNode(t)) {
    return t.types.some(ty => ts.isFunctionTypeNode(ty));
  }
  // 括号包裹的函数类型
  if (ts.isParenthesizedTypeNode(t)) {
    return ts.isFunctionTypeNode(t.type);
  }
  return false;
}

/** 从函数类型节点提取参数列表 */
function extractParamsFromFunctionType(checker, funcTypeNode) {
  const params = [];
  if (!funcTypeNode.parameters) return params;
  for (const param of funcTypeNode.parameters) {
    if (!param.name) continue;
    const name = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
    const optional = !!param.questionToken || (param.initializer !== undefined);
    const typeStr = param.type ? param.type.getText() : '-';
    params.push({ name, type: typeStr, optional, description: '-' });
  }
  return params;
}

/** 从属性节点的函数类型中提取参数和返回类型 */
function extractFuncTypeInfoFromProperty(node) {
  if (!node.type) return { params: [], returnType: 'void' };
  let funcType = null;
  if (ts.isFunctionTypeNode(node.type)) {
    funcType = node.type;
  } else if (ts.isUnionTypeNode(node.type)) {
    funcType = node.type.types.find(t => ts.isFunctionTypeNode(t));
  } else if (ts.isParenthesizedTypeNode(node.type) && ts.isFunctionTypeNode(node.type.type)) {
    funcType = node.type.type;
  }
  if (!funcType) return { params: [], returnType: 'void' };
  const params = extractParamsFromFunctionType(null, funcType);
  const returnType = funcType.type ? funcType.type.getText() : 'void';
  return { params, returnType };
}

function classifyMember(node, isStruct) {
  if (ts.isConstructorDeclaration(node)) {
    return { memberName: 'constructor', kind: 'constructor', skip: true };
  }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    if (isStruct) {
      return { memberName: node.name.text, kind: 'method', skip: true };
    }
    if (isPrivateMember(node)) {
      return { memberName: node.name.text, kind: 'method', skip: true };
    }
    return { memberName: node.name.text, kind: 'method', skip: false };
  }
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) ||
      ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
      ts.isAccessor(node)) {
    // 检测函数类型属性: play: () => void → 重分类为 method
    const isFuncTyped = isFunctionTypedProperty(node);
    if (isStruct) {
      if (isPrivateMember(node)) {
 return { memberName: node.name.text, kind: isFuncTyped ? 'method' : 'property', skip: true };
      }
      // struct 公有属性: 函数类型也跳过（struct 的 build 方法不导出）
      return { memberName: node.name.text, kind: 'property', skip: false };
    }
    if (isPrivateMember(node)) {
      return { memberName: node.name.text, kind: isFuncTyped ? 'method' : 'property', skip: true };
    }
    if (isFuncTyped) {
      return { memberName: node.name.text, kind: 'method', skip: false };
    }
    return { memberName: node.name.text, kind: 'property', skip: false };
  }
  return null;
}

// ── 参数提取 ──────────────────────────────────────────────

/** 从方法节点提取参数列表 */
function extractParams(checker, node) {
  const params = [];
  if (!node.parameters) return params;
  for (const param of node.parameters) {
    if (!param.name) continue;
    const name = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
    const optional = !!param.questionToken || (param.initializer !== undefined);
    let typeStr = '-';
    try {
      const type = checker.getTypeAtLocation(param);
      typeStr = checker.typeToString(type);
      if (typeStr === 'any' && param.type) typeStr = param.type.getText();
    } catch (e) {
      if (param.type) typeStr = param.type.getText();
    }
    params.push({ name, type: typeStr, optional, description: '-' });
  }
  return params;
}

/** 从方法节点提取返回类型 */
function extractReturnType(checker, node) {
  try {
    if (node.type) return node.type.getText();
    const sig = checker.getSignatureFromDeclaration(node);
    if (sig) {
      const retType = checker.getReturnTypeOfSignature(sig);
      return checker.typeToString(retType);
    }
  } catch (e) { /* fall through */ }
  return 'void';
}

/**
 * 统一生成方法/函数类成员的签名，保证 signature 与 params/returnType 字段自洽。
 * 形态: name: (p1?: T1, p2: T2) => ReturnType (returnType 取自 extractReturnType，保留 | null 等联合细节)
 */
function buildMethodSignature(name, params, returnType, optional) {
  const paramStr = (params || [])
    .map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type === '-' ? 'any' : p.type}`)
    .join(', ');
  return `${name}${optional ? '?' : ''}: (${paramStr}) => ${returnType}`;
}

// ── 类成员提取 ──────────────────────────────────────────────

function extractClassMembers(node, checker, className, isStruct, sourceFile, realPath, repoDir) {
  const members = [];
  for (const member of node.members) {
    const classified = classifyMember(member, isStruct);
    if (!classified || classified.skip) continue;

    const { memberName, kind } = classified;
    const isStatic = isStaticMember(member);
    const isReadonly = isReadonlyMember(member);
    const isEvent = /^on\w+/.test(memberName);
    const access = isPrivateMember(member) ? 'private' : 'public';
    const lowValue = !!(isStatic && isReadonly && kind === 'property');

    // 对于函数类型属性（被重分类为 method），从函数类型节点提取参数和返回值
    let params = [];
    let returnType = '-';
    let methodSignature = null;
    if (kind === 'method') {
      if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
        params = extractParams(checker, member);
        returnType = extractReturnType(checker, member);
        methodSignature = buildMethodSignature(memberName, params, returnType, false);
      } else if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
        const funcInfo = extractFuncTypeInfoFromProperty(member);
        params = funcInfo.params;
        returnType = funcInfo.returnType;
        methodSignature = buildMethodSignature(memberName, params, returnType, false);
      }
    }

    members.push({
      className,
      memberName,
      fullName: `${className}.${memberName}`,
      kind,
      isStatic,
      isReadonly,
      isOptional: false,
      isEvent,
      access,
      lowValue,
      type: isStruct ? 'struct' : 'class',
      signature: methodSignature || getMemberSignature(checker, member),
      params,
      returnType,
      description: getJsDocDescription(checker, member.name || member),
      source: rel(realPath, repoDir),
      startLine: sourceFile ? sourceFile.getLineAndCharacterOfPosition(member.getStart ? member.getStart() : member.pos).line + 1 : 0,
    });
  }

  // 内部类展开：检测 `static X = new Y()` 公有静态属性，若同文件存在 `class Y`，
  // 将 Y 的公开方法以 `X.方法名()` 前缀合并进成员
  const memberDefs = members.slice();
  for (const m of memberDefs) {
    const im = (m.signature || '').match(/(?:^|\s)static\s+(\w+)\s*=\s*new\s+(\w+)\s*\(/i);
    if (!im) continue;
    const prefixName = im[1];
    const innerName = im[2];
    // 在 AST 中查找同名内部类
    ts.forEachChild(sourceFile, (child) => {
      if (ts.isClassDeclaration(child) && child.name && child.name.text === innerName) {
        const innerMembers = extractClassMembers(child, checker, innerName, false, sourceFile, realPath, repoDir);
        for (const inner of innerMembers) {
          if (inner.name === 'constructor' || /^new\s*\(/.test(inner.signature || '')) continue;
          members.push({
            ...inner,
            memberName: `${prefixName}.${inner.memberName}`,
            fullName: `${className}.${prefixName}.${inner.memberName}`,
            className,
          });
        }
      }
    });
  }

  return members;
}

// ── 接口字段提取 ──────────────────────────────────────────────

function extractInterfaceFields(node, checker, interfaceName, sourceFile, realPath, repoDir) {
  const fields = [];
  for (const member of node.members) {
    if (ts.isPropertySignature(member) && member.name) {
      const name = member.name.text;
      const optional = !!member.questionToken;
      const readonly = !!(member.modifiers && member.modifiers.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword));
      const fieldType = member.type ? member.type.getText() : '-';
      const isEvent = /^on\w+/.test(name);

      // 检测函数类型属性: onComplete: () => void → kind=method
      const isFuncTyped = isFunctionTypedProperty(member);
      let params = [];
      let returnType = fieldType;
      let kind = 'field';
      let sigStr = `${name}${optional ? '?' : ''}: ${fieldType}`;
      if (isFuncTyped) {
        const funcInfo = extractFuncTypeInfoFromProperty(member);
        params = funcInfo.params;
        returnType = funcInfo.returnType;
        kind = 'method';
        sigStr = buildMethodSignature(name, funcInfo.params, funcInfo.returnType, optional);
      }

      fields.push({
        className: interfaceName,
        memberName: name,
        fullName: `${interfaceName}.${name}`,
        kind,
        isStatic: false,
        isReadonly: readonly,
        isOptional: optional,
        isEvent,
        type: 'interface',
        signature: sigStr,
        params,
        returnType,
        description: getJsDocDescription(checker, member.name),
        source: rel(realPath, repoDir),
        startLine: sourceFile ? sourceFile.getLineAndCharacterOfPosition(member.getStart ? member.getStart() : member.pos).line + 1 : 0,
      });
    } else if (ts.isMethodSignature(member) && member.name) {
      const name = member.name.text;
      let methodSig = null;
      if (name === 'new') { /* 构造签名：保留原生形态 */ } else {
        const params = extractParams(checker, member);
        const returnType = extractReturnType(checker, member);
        methodSig = buildMethodSignature(name, params, returnType, !!member.questionToken);
      }
      if (!methodSig) {
        let rawSig = '-';
        try {
          const symbol = checker.getSymbolAtLocation(member.name);
          if (symbol) {
            const type = checker.getTypeOfSymbolAtLocation(symbol, member);
            rawSig = checker.typeToString(type);
          }
        } catch (e) { /* use text */ }
        if (rawSig === 'any' || rawSig === '-') {
          rawSig = member.getText().trim().split('\n')[0];
        }
        methodSig = rawSig;
      }

      fields.push({
        className: interfaceName,
        memberName: name,
        fullName: `${interfaceName}.${name}`,
        kind: 'method',
        isStatic: false,
        isReadonly: false,
        isOptional: !!member.questionToken,
        isEvent: /^on\w+/.test(name),
        type: 'interface',
        signature: methodSig,
        params: extractParams(checker, member),
        returnType: extractReturnType(checker, member),
        description: getJsDocDescription(checker, member.name),
        source: rel(realPath, repoDir),
        startLine: sourceFile ? sourceFile.getLineAndCharacterOfPosition(member.getStart ? member.getStart() : member.pos).line + 1 : 0,
      });
    }
  }
  return fields;
}

// ── 顶层导出提取 ──────────────────────────────────────────────

function extractTopLevelExports(node, checker, realPath, repoDir, sourceFile) {
  const exports = [];

  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (!decl.name || !ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;
      let typeStr = '-';
      try {
        const type = checker.getTypeAtLocation(decl);
        typeStr = checker.typeToString(type);
      } catch (e) { /* use '-' */ }
      if (typeStr === 'any' && decl.type) typeStr = decl.type.getText();

      // 检测函数类型变量: lottiePlay: (lottieId?: string) => void → kind=function
      const isFuncTyped = decl.type ? (ts.isFunctionTypeNode(decl.type) ||
        (ts.isUnionTypeNode(decl.type) && decl.type.types.some(t => ts.isFunctionTypeNode(t))) ||
        (ts.isParenthesizedTypeNode(decl.type) && ts.isFunctionTypeNode(decl.type.type))) : false;
      let kind = 'variable';
      let params = [];
      let returnType = typeStr;
      let sigStr = `${name}: ${typeStr}`;
      if (isFuncTyped) {
        kind = 'function';
        let funcType = decl.type;
        if (ts.isUnionTypeNode(funcType)) funcType = funcType.types.find(t => ts.isFunctionTypeNode(t));
        if (ts.isParenthesizedTypeNode(funcType)) funcType = funcType.type;
        if (funcType && ts.isFunctionTypeNode(funcType)) {
          for (const param of funcType.parameters) {
            if (!param.name) continue;
            const pname = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
            params.push({ name: pname, type: param.type ? param.type.getText() : '-', optional: !!param.questionToken, description: '-' });
          }
          returnType = funcType.type ? funcType.type.getText() : 'void';
        }
        sigStr = buildMethodSignature(name, params, returnType, false);
      }

      exports.push({
        className: null,
        memberName: name,
        fullName: name,
        kind,
        isStatic: false,
        isReadonly: false,
        isOptional: false,
        isEvent: false,
        type: kind === 'function' ? 'function' : 'variable',
        signature: sigStr,
        params,
        returnType,
        description: getJsDocDescription(checker, decl.name),
        source: rel(realPath, repoDir),
        startLine: sourceFile ? sourceFile.getLineAndCharacterOfPosition(decl.getStart ? decl.getStart() : decl.pos).line + 1 : 0,
      });
    }
  } else if (ts.isFunctionDeclaration(node) && node.name) {
    const name = node.name.text;
    const params = extractParams(checker, node);
    const returnType = extractReturnType(checker, node);
    const sigStr = buildMethodSignature(name, params, returnType, false);

    exports.push({
      className: null,
      memberName: name,
      fullName: name,
      kind: 'function',
      isStatic: false,
      isReadonly: false,
      isOptional: false,
      isEvent: false,
      type: 'function',
      signature: sigStr,
      params,
      returnType,
      description: getJsDocDescription(checker, node.name),
      source: rel(realPath, repoDir),
      startLine: 0,
    });
  }
  return exports;
}

// ── Enum 成员提取 ──────────────────────────────────────────────

function extractEnumMembers(node, checker, enumName, realPath, repoDir) {
  const members = [];
  for (const member of node.members) {
    if (!member.name) continue;
    const name = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();
    let value = '-';
    try {
      const type = checker.getTypeAtLocation(member);
      value = checker.typeToString(type);
    } catch (e) { /* use text */ }
    if (value === 'any' || value === '-') {
      value = member.initializer ? member.initializer.getText() : name;
    }
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
      signature: `${name} = ${value}`,
      params: [],
      returnType: value,
      description: getJsDocDescription(checker, member.name),
      source: rel(realPath, repoDir),
      startLine: 0,
    });
  }
  return members;
}

// ── declare var 静态方法提取 ───────────────────────────────────

/**
 * 从 declare var body 提取静态方法（C 风格 .d.ts 类声明）
 * 形如: declare var LottiePlayer: { prototype: ILottiePlayer; new(): ILottiePlayer; play(): void; ... }
 */
function extractDeclareVarStatics(node, checker, varName, sourceFile, realPath, repoDir) {
  const members = [];
  // declare var 的类型在 node.type 中（TypeLiteral 或 IntersectionType）
  if (!node.type) return members;

  // 如果是 TypeLiteral，遍历其成员
  let typeMembers = [];
  if (ts.isTypeLiteralNode(node.type)) {
    typeMembers = node.type.members;
  } else if (ts.isIntersectionTypeNode(node.type)) {
    for (const t of node.type.types) {
      if (ts.isTypeLiteralNode(t)) {
        typeMembers = typeMembers.concat(t.members);
      }
    }
  }

  for (const member of typeMembers) {
    // 跳过 prototype 和 new(...) 签名
    if (ts.isPropertySignature(member) && member.name) {
      const name = member.name.text;
      if (name === 'prototype') continue;
      const isStatic = false; // declare var 的成员都是实例方法
      const fieldType = member.type ? member.type.getText() : '-';

      // 检测函数类型属性: play: () => void → kind=method
      const isFuncTyped = isFunctionTypedProperty(member);
      let params = [];
      let returnType = fieldType;
      let kind = 'property';
      let sigStr = `${name}${member.questionToken ? '?' : ''}: ${fieldType}`;
      if (isFuncTyped) {
        const funcInfo = extractFuncTypeInfoFromProperty(member);
        params = funcInfo.params;
        returnType = funcInfo.returnType;
        kind = 'method';
        sigStr = buildMethodSignature(name, funcInfo.params, funcInfo.returnType, !!member.questionToken);
      }

      members.push({
        className: varName,
        memberName: name,
        fullName: `${varName}.${name}`,
        kind,
        isStatic,
        isReadonly: false,
        isOptional: !!member.questionToken,
        isEvent: /^on\w+/.test(name),
        type: 'dts-class',
        signature: sigStr,
        params,
        returnType,
        description: getJsDocDescription(checker, member.name),
        source: rel(realPath, repoDir),
        startLine: sourceFile ? sourceFile.getLineAndCharacterOfPosition(member.getStart ? member.getStart() : member.pos).line + 1 : 0,
      });
    } else if (ts.isMethodSignature(member) && member.name) {
      const name = member.name.text;
      if (name === 'new') continue; // 跳过构造签名
      const params = extractParams(checker, member);
      const returnType = extractReturnType(checker, member);
      let sig = buildMethodSignature(name, params, returnType, !!member.questionToken);
      if (!sig || sig === `(${name}) => any`) {
        try {
          const symbol = checker.getSymbolAtLocation(member.name);
          if (symbol) {
            const type = checker.getTypeOfSymbolAtLocation(symbol, member);
            sig = checker.typeToString(type);
          }
        } catch (e) { /* use text */ }
        if (sig === 'any' || sig === '-') {
          sig = member.getText().trim().split('\n')[0];
        }
      }

      members.push({
        className: varName,
        memberName: name,
        fullName: `${varName}.${name}`,
        kind: 'method',
        isStatic: false,
        isReadonly: false,
        isOptional: !!member.questionToken,
        isEvent: /^on\w+/.test(name),
        type: 'dts-class',
        signature: sig,
        params,
        returnType,
        description: getJsDocDescription(checker, member.name),
        source: rel(realPath, repoDir),
        startLine: sourceFile ? sourceFile.getLineAndCharacterOfPosition(member.getStart ? member.getStart() : member.pos).line + 1 : 0,
      });
    }
  }
  return members;
}

// ── .so 模块 Native 声明检测 ───────────────────────────────────

/**
 * 从 Index.ets 检测 Native .so 模块导出，返回 .d.ts 文件路径和导出名称集合
 */
function detectNativeSo(repoDir, entryFile) {
  const indexContent = readText(entryFile);
  const indexLines = indexContent.split('\n');

  const hasNativeSoImport = /import\s+\w+\s+from\s+['"][^'"]*\.so['"]/.test(indexContent);
  const hasNativeSoExportStar = /export\s*\*\s*from\s+['"][^'"]*\.so['"]/.test(indexContent);
  const hasNativeSoNamedExport = /export\s+(?:type\s+)?\{[^}]+\}\s*from\s+['"][^'"]*\.so['"]/.test(indexContent);

  if (!hasNativeSoImport && !hasNativeSoExportStar && !hasNativeSoNamedExport) {
    return { nativeDPath: null, nativeSoExportNames: new Set() };
  }

  // 收集从 .so 具名导出的名称
  const nativeSoExportNames = new Set();
  for (const l of indexLines) {
    const namedSoM = l.match(/^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]*\.so['"]/);
    if (namedSoM) {
      const names = namedSoM[1].split(',').map((s) => s.trim().replace(/^.*\bas\s+/, '')).filter(Boolean);
      for (const n of names) nativeSoExportNames.add(n);
    }
  }

  // 定位 .d.ts 文件
  let nativeDPath = null;
  for (const l of indexLines) {
    const soM = l.match(/from\s+['"]([^'"]*\.so)['"]/);
    if (soM) {
      const soName = soM[1];
      const libBase = soName.replace(/\.so$/, '').replace(/.*\//, '');
      const dtsPaths = glob(repoDir, `**/*.d.ts`);
      const detsPaths = glob(repoDir, `**/*.d.ets`);
      let nativeFile = dtsPaths.find((p) => p.toLowerCase().includes(libBase.toLowerCase()));
      if (!nativeFile) nativeFile = detsPaths.find((p) => p.toLowerCase().includes(libBase.toLowerCase()));
      if (!nativeFile) nativeFile = dtsPaths.find((p) => /libohos_|webrtc/.test(p.toLowerCase()));
      if (!nativeFile && dtsPaths.length > 0) nativeFile = dtsPaths[0];
      if (nativeFile) {
        nativeDPath = nativeFile;
        // 若命中 index.d.ts 转发层（export * from './xxx'），追踪到实际声明文件
        const nativeContent = readText(nativeFile);
        const starExp = nativeContent.match(/export\s*\*\s*from\s*['"]([^'"]+)['"]/);
        if (starExp && /index\.d\.ts$/i.test(nativeFile)) {
          const target = path.resolve(path.dirname(nativeFile), starExp[1]);
          for (const cand of [target, `${target}.d.ts`, path.join(target, 'index.d.ts')]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
              nativeDPath = cand;
              break;
            }
          }
        }
      }
      break;
    }
  }

  return { nativeDPath, nativeSoExportNames };
}

// ── 主解析：TS Compiler API ────────────────────────────────────

/**
 * 核心解析函数 — 将 .ets 文件映射为虚拟 .ts 路径，
 * 因为 TS 编译器会忽略不在其支持扩展名列表中的 .ets 文件。
 */
function parseLibraryWithTS(repoDir, entryFile, nativeSoInfo, libraryName) {
  const libRoot = repoDir;
  const sourceFiles = collectSourceFiles(repoDir, entryFile);

  // 大小写归一化：macOS/Windows 文件系统大小写不敏感，locateEntryFile 可能返回
  // Index.ets 而磁盘实际文件名为 index.ets，导致 entryFile 不在 sourceFiles 中。
  // 用 sourceFiles 中的实际路径替换 entryFile（大小写不敏感匹配）。
  if (!sourceFiles.includes(entryFile)) {
    const lower = entryFile.toLowerCase();
    const real = sourceFiles.find((f) => f.toLowerCase() === lower);
    if (real) entryFile = real;
  }

  // 收集 Native .d.ts 文件（可能在模块根目录外）
  if (nativeSoInfo.nativeDPath && !sourceFiles.includes(nativeSoInfo.nativeDPath)) {
    sourceFiles.push(nativeSoInfo.nativeDPath);
  }
  if (sourceFiles.length === 0) {
    console.error(`错误: 未找到源文件（入口: ${entryFile}）`);
    process.exit(1);
  }

  if (!libraryName) libraryName = extractLibraryName(repoDir, entryFile);

  // Windows 兼容：TS 编译器内部使用正斜杠 / 作为路径分隔符，
  // 需将所有作为 fileContents/virtualPaths key 的路径统一为 POSIX 风格，
  // 否则 host.getSourceFile(fileName) 的 fileName 被 TS 标准化为正斜杠后查不到。
  const toPosix = (p) => p.replace(/\\/g, '/');

  // 将 .ets 文件映射为虚拟 .ts 路径，.d.ts 保持原样
  const virtualPaths = new Map(); // virtualPath(POSIX) -> realPath(原始)
  const realToVirtual = new Map(); // realPath(原始) -> virtualPath(POSIX)

  for (const realPath of sourceFiles) {
    let virtualPath;
    if (realPath.endsWith('.ets')) {
      virtualPath = realPath.replace(/\.ets$/, '.ts');
    } else {
      virtualPath = realPath;
    }
    virtualPath = toPosix(virtualPath);
    virtualPaths.set(virtualPath, realPath);
    realToVirtual.set(realPath, virtualPath);
  }

  // 读取所有源文件内容（用虚拟 POSIX 路径作为 key）
  // 对 .ets 文件进行预处理：将 ArkTS 特有的 `struct` 关键字替换为 `class`
  const fileContents = {};
  for (const [vPath, rPath] of virtualPaths) {
    let content = fs.readFileSync(rPath, 'utf-8');
    if (rPath.endsWith('.ets')) {
      content = content.replace(/\b(struct)\s+(\w+)/g, 'class $2');
    }
    fileContents[vPath] = content;
  }

  const compilerOptions = {
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.ESNext,
    strict: false,
    skipLibCheck: true,
    noEmit: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
  };

  // 构建自定义 host
  const host = {
    getSourceFile: function(fileName, languageVersion) {
      const content = fileContents[fileName] || fileContents[toPosix(fileName)];
      if (content) {
        return ts.createSourceFile(fileName, content, languageVersion, true,
          fileName.endsWith('.d.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TS);
      }
      if (!fileName.endsWith('.ets')) {
        try {
          const sysContent = ts.sys.readFile(fileName);
          if (sysContent !== undefined) {
            return ts.createSourceFile(fileName, sysContent, languageVersion, true);
          }
        } catch (e) { /* fall through */ }
      }
      return undefined;
    },
    getDefaultLibFileName: function() {
      return ts.getDefaultLibFilePath(compilerOptions);
    },
    writeFile: function() {},
    getCurrentDirectory: function() { return process.cwd(); },
    getCanonicalFileName: function(fileName) { return fileName; },
    useCaseSensitiveFileNames: function() { return true; },
    getNewLine: function() { return '\n'; },
    fileExists: function(fileName) {
      return !!fileContents[fileName] || !!fileContents[toPosix(fileName)] || ts.sys.fileExists(fileName);
    },
    readFile: function(fileName) {
      return fileContents[fileName] || fileContents[toPosix(fileName)] || ts.sys.readFile(fileName);
    },
    resolveModuleNames: function(moduleNames, containingFile) {
      const resolved = [];
      for (const moduleName of moduleNames) {
        let resolvedPath = null;
        const baseDir = path.dirname(containingFile);

        if (moduleName.startsWith('.')) {
          const candidates = [
            path.resolve(baseDir, moduleName + '.ts'),
            path.resolve(baseDir, moduleName + '.d.ts'),
            path.resolve(baseDir, moduleName, 'Index.ts'),
            path.resolve(baseDir, moduleName, 'Index.d.ts'),
          ];
          for (const c of candidates) {
            const posixC = toPosix(c);
            if (fileContents[posixC] || ts.sys.fileExists(c)) {
              resolvedPath = posixC;
              break;
            }
          }
        }

        // .so 模块 → 查找 types/ 目录下的 .d.ts
        if (moduleName.endsWith('.so') && !resolvedPath) {
          const soName = moduleName.replace(/\.so$/, '');
          const realContaining = virtualPaths.get(containingFile) || containingFile;
          const realBaseDir = path.dirname(realContaining);
          const typesCandidates = [
            path.resolve(realBaseDir, 'src/main/cpp/types', soName, 'Index.d.ts'),
            path.resolve(realBaseDir, 'types', soName, 'Index.d.ts'),
            path.resolve(path.dirname(libRoot), 'library', 'src/main/cpp/types', soName, 'Index.d.ts'),
          ];
          for (const sf of sourceFiles) {
            if (sf.includes(`types/${soName}/Index.d.ts`) || sf.includes(`types/${soName.replace(/-/g, '_')}/Index.d.ts`)) {
              typesCandidates.push(sf);
            }
          }
          for (const c of typesCandidates) {
            if (fs.existsSync(c) || fileContents[c]) {
              resolvedPath = c;
              break;
            }
          }
        }

        if (resolvedPath) {
          resolved.push({ resolvedFileName: resolvedPath, extension: '.ts' });
        } else {
          resolved.push(undefined);
        }
      }
      return resolved;
    },
  };

  const virtualFileList = Array.from(virtualPaths.keys());
  const program = ts.createProgram(virtualFileList, compilerOptions, host);
  const checker = program.getTypeChecker();

  // 获取入口文件的虚拟路径
  const indexVirtualPath = realToVirtual.get(entryFile);
  if (!indexVirtualPath) {
    console.error(`错误: 无法加载 ${entryFile}`);
    process.exit(1);
  }

  const indexSourceFile = program.getSourceFile(indexVirtualPath);
  if (!indexSourceFile) {
    console.error(`错误: Index.ets 未加载到编译程序中`);
    process.exit(1);
  }

  // 获取入口模块的导出符号
  const indexSymbol = checker.getSymbolAtLocation(indexSourceFile);
  const exports = indexSymbol ? checker.getExportsOfModule(indexSymbol) : [];
  const indexExportedNames = new Set(exports.map(e => e.name));

  // 公开 API 判据：仅「Index.ets 实际导出（getExportsOfModule 已解析 export * 转发链）」
  // 或「Index.ets 显式从 .so 再导出（export { X } from 'xxx.so'）」。
  // 注意：不能把所有 .d.ts（含 cpp/types 内部 NAPI 类型声明）的导出计入，
  // 否则未导出的内部实现类（如门面类私有持有的 .so 包装类）会被误统计。
  const nativeSoExportNames = nativeSoInfo.nativeSoExportNames;
  const exportedNames = new Set([...indexExportedNames, ...nativeSoExportNames]);
  const exportedTypeNames = indexExportedNames; // 类型（类/接口/type）仅从 Index.ets 导出

  const interfaces = [];
  const visitedClassNames = new Set();
  const sources = [];

  // 遍历所有源文件
  for (const sourceFile of program.getSourceFiles()) {
    if (!virtualPaths.has(sourceFile.fileName)) continue;
    const realPath = virtualPaths.get(sourceFile.fileName);
    sources.push(rel(realPath, repoDir));

    function visit(node) {
      // 类声明（含 struct 组件，已预处理为 class）
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        if (visitedClassNames.has(className)) return;
        if (!exportedTypeNames.has(className) && !nativeSoExportNames.has(className)) return;
        visitedClassNames.add(className);

        const isStruct = isStructComponent(node);
        interfaces.push(...extractClassMembers(node, checker, className, isStruct, sourceFile, realPath, repoDir));
      }

      // 接口声明
      if (ts.isInterfaceDeclaration(node) && node.name) {
        const ifaceName = node.name.text;
        if (visitedClassNames.has(ifaceName)) return;
        if (!exportedTypeNames.has(ifaceName) && !nativeSoExportNames.has(ifaceName)) return;
        visitedClassNames.add(ifaceName);

        interfaces.push(...extractInterfaceFields(node, checker, ifaceName, sourceFile, realPath, repoDir));
      }

      // 类型别名
      if (ts.isTypeAliasDeclaration(node) && node.name) {
        const typeName = node.name.text;
        if (visitedClassNames.has(typeName)) return;
        if (!exportedNames.has(typeName)) return;
        visitedClassNames.add(typeName);

        const typeValue = node.type ? node.type.getText() : '-';
        interfaces.push({
          className: typeName,
          memberName: typeName,
          fullName: typeName,
          kind: 'type',
          isStatic: false,
          isReadonly: false,
          isOptional: false,
          isEvent: false,
          type: 'type',
          signature: `type ${typeName} = ${typeValue}`,
          params: [],
          returnType: typeValue,
          description: getJsDocDescription(checker, node.name),
          source: rel(realPath, repoDir),
          startLine: sourceFile ? sourceFile.getLineAndCharacterOfPosition(node.getStart ? node.getStart() : node.pos).line + 1 : 0,
        });
      }

      // 枚举声明
      if (ts.isEnumDeclaration(node) && node.name) {
        const enumName = node.name.text;
        if (visitedClassNames.has(enumName)) return;
        if (!exportedTypeNames.has(enumName) && !nativeSoExportNames.has(enumName)) return;
        visitedClassNames.add(enumName);

        interfaces.push(...extractEnumMembers(node, checker, enumName, realPath, repoDir));
      }

      // declare var （C 风格 .d.ts 类声明）
      if (ts.isVariableStatement(node)) {
        // 检查是否为 declare var X: { prototype: ...; new(): ...; ... }
        for (const decl of node.declarationList.declarations) {
          if (!decl.name || !ts.isIdentifier(decl.name)) continue;
          const varName = decl.name.text;
          if (visitedClassNames.has(varName)) continue;
          // 检查是否含 prototype 属性（C 风格类声明标志）
          let hasPrototype = false;
          if (decl.type) {
            if (ts.isTypeLiteralNode(decl.type)) {
              hasPrototype = decl.type.members.some(m =>
                ts.isPropertySignature(m) && m.name && m.name.text === 'prototype'
              );
            } else if (ts.isIntersectionTypeNode(decl.type)) {
              for (const t of decl.type.types) {
                if (ts.isTypeLiteralNode(t)) {
                  hasPrototype = t.members.some(m =>
                    ts.isPropertySignature(m) && m.name && m.name.text === 'prototype'
                  );
                  if (hasPrototype) break;
                }
              }
            }
          }
          if (hasPrototype) {
            if (!exportedTypeNames.has(varName) && !nativeSoExportNames.has(varName)) continue;
            visitedClassNames.add(varName);
            interfaces.push(...extractDeclareVarStatics(decl, checker, varName, sourceFile, realPath, repoDir));
          }
        }

        // 顶层变量/函数
        const topExports = extractTopLevelExports(node, checker, realPath, repoDir);
        for (const exp of topExports) {
          if (exportedNames.has(exp.memberName)) {
            interfaces.push(exp);
          }
        }
      }

      // 顶层函数声明
      if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text;
        if (!exportedNames.has(name)) return;
        // 避免重复
        if (interfaces.some(i => i.fullName === name)) return;
        const params = extractParams(checker, node);
        const returnType = extractReturnType(checker, node);
        const sig = buildMethodSignature(name, params, returnType, false);

        interfaces.push({
          className: null,
          memberName: name,
          fullName: name,
          kind: 'function',
          isStatic: false,
          isReadonly: false,
          isOptional: false,
          isEvent: false,
          type: 'function',
          signature: sig,
          params,
          returnType,
          description: getJsDocDescription(checker, node.name),
          source: rel(realPath, repoDir),
          startLine: sourceFile ? sourceFile.getLineAndCharacterOfPosition(node.getStart ? node.getStart() : node.pos).line + 1 : 0,
        });
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  // 统计汇总
  const classCount = new Set(interfaces.map(i => i.className).filter(n => n !== null)).size;
  const methodCount = interfaces.filter(i => i.kind === 'method').length;
  const propertyCount = interfaces.filter(i => i.kind === 'property').length;
  const fieldCount = interfaces.filter(i => i.kind === 'field').length;

  return {
    libraryName,
    entryFile: rel(entryFile, repoDir),
    nativeDPath: nativeSoInfo.nativeDPath ? rel(nativeSoInfo.nativeDPath, repoDir) : null,
    extractedAt: new Date().toISOString(),
    summary: {
      S: classCount,  // 类级总数
      N: interfaces.length,  // 方法/属性级总数
      M: 0,  // 已覆盖数（覆盖率分析时填充）
      methods: methodCount,
      properties: propertyCount,
      fields: fieldCount,
    },
    sources,
    interfaces,
  };
}

// ── 模块导出（供其他脚本调用）──────────────────────────────

/**
 * 从库源码目录直接生成接口规格数据（内存对象，无需写 JSON 中间件）
 * @param {string} repoDir 库源码根目录
 * @returns {object} interface-spec 数据对象
 */
function generateSpec(repoDir) {
  if (!fs.existsSync(repoDir)) {
    throw new Error(`目录不存在: ${repoDir}`);
  }
  const entryFile = locateEntryFile(repoDir);
  if (!entryFile) {
    throw new Error(`无法定位入口文件 Index.ets: ${repoDir}`);
  }
  const nativeSoInfo = detectNativeSo(repoDir, entryFile);
  const libraryName = extractLibraryName(repoDir, entryFile);
  return parseLibraryWithTS(repoDir, entryFile, nativeSoInfo, libraryName);
}

module.exports = { generateSpec, parseLibraryWithTS, locateEntryFile, detectNativeSo };

// ── 入口（直接运行时执行）──────────────────────────────────

if (require.main === module) {
  const args = parseArgs();
  const repoDir = args.repoDir || args.libroot || '';
  const outputPath = args.output || '';

  if (!repoDir) {
    console.error('用法: node extract-interfaces.cjs --repoDir <库源码目录> --output <interface-spec.json>');
    process.exit(1);
  }

  console.log(`库源码目录: ${repoDir}`);

  try {
    const result = generateSpec(repoDir);

    console.log(`解析完成: ${result.interfaces.length} 个接口`);
    console.log(`  库名: ${result.libraryName}`);
    console.log(`  入口文件: ${result.entryFile}`);
    if (result.nativeDPath) console.log(`  Native 声明: ${result.nativeDPath}`);
    console.log(`  类级: ${result.summary.S} | 方法: ${result.summary.methods} | 属性: ${result.summary.properties} | 字段: ${result.summary.fields}`);

    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
      console.log(`  输出: ${outputPath}`);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
    process.exit(1);
  }
}
