#!/usr/bin/env node
/**
 * @tool rn_analyze_test_coverage
 * @description 分析 React Native 三方库的测试用例覆盖率。从库源码提取接口规格，扫描测试源码目录（__tests__ 或 test/tests），执行 AST/正则双层覆盖率匹配，输出 Markdown 覆盖率报告。用于评估测试用例对 RN 库 API 的覆盖程度。
 * @param libroot: string - 库根目录路径（RN 三方库的鸿蒙化仓库目录）
 * @param spec: string - 已有的 interface-spec.json 路径（可选，与 libroot 二选一）
 * @param output: string - 输出 Markdown 报告路径（可选，默认 03-xxx-Test覆盖率报告.md）
 * @param mode: string - 匹配模式: auto(默认) | ast | regex（可选）
 * @param version: string - 上游 npm 版本号（可选，如 "2.2.0"）
 * @hidden
 * analyze-test-coverage.cjs — 测试用例覆盖率分析脚本
 *
 * 基于 rn-extract-interfaces.cjs 生成的接口规格，分析测试用例源码对接口的覆盖情况。
 * 覆盖率计算逻辑（AST/正则匹配 + 结果聚合 + Markdown 渲染）完整实现在本文件中。
 *
 * 依赖: require('./rn-extract-interfaces.cjs')  (loadSpec + 共享工具)
 *
 * 用法:
 *   方式一 (JSON 中间件):
 *     node rn-analyze-test-coverage.cjs --spec <spec.json> --libroot <库根目录> \
 *       [--output <report.md>] [--mode auto|ast|regex] [--version <上游版本>]
 *   方式二 (直接提取):
 *     node rn-analyze-test-coverage.cjs --libroot <库根目录> \
 *       [--output <report.md>] [--mode auto|ast|regex] [--version <上游版本>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadSpec, parseArgs, walkDir, escapeRegex, escapeMd, formatParams,
  coverageBadge, loadTypeScript, info, ok, warn,
} = require('./rn-extract-interfaces.cjs');

const ts = loadTypeScript();

// ════════════════════════════════════════════════════════════
// 正则匹配引擎
// ════════════════════════════════════════════════════════════

function extractImportsRegex(content, libName, fullLibName) {
  const namedSymbols = [];
  let defaultAlias = null, hasImport = false;
  const libPatterns = [escapeRegex(libName), escapeRegex(fullLibName), escapeRegex(libName.split('/').pop())].filter((v, i, a) => a.indexOf(v) === i);
  const libRegexStr = libPatterns.join('|');
  let m;
  const esDefaultRegex = new RegExp(`import\\s+(?:type\\s+)?([A-Za-z_$][\\w$]*)(?:\\s*,\\s*\\{[^}]*\\})?\\s+from\\s*['"](?:${libRegexStr})['"]`, 'g');
  while ((m = esDefaultRegex.exec(content)) !== null) { defaultAlias = m[1]; hasImport = true; }
  const esNamedRegex = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"](?:${libRegexStr})['"]`, 'g');
  while ((m = esNamedRegex.exec(content)) !== null) {
    hasImport = true;
    namedSymbols.push(...m[1].split(',').map(s => { const t = s.trim().replace(/\n/g, '').replace(/\s+/g, ' '); const a = t.match(/(\w+)\s+as\s+(\w+)/); return a ? { name: a[1], alias: a[2] } : { name: t, alias: t }; }).filter(s => s.name && s.name.length > 0 && s.name !== 'type'));
  }
  const cjsDefaultRegex = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\s*\\(\\s*['"](?:${libRegexStr})['"]\\s*\\)`, 'g');
  while ((m = cjsDefaultRegex.exec(content)) !== null) { if (!defaultAlias) defaultAlias = m[1]; hasImport = true; }
  const cjsNamedRegex = new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*require\\s*\\(\\s*['"](?:${libRegexStr})['"]\\s*\\)`, 'g');
  while ((m = cjsNamedRegex.exec(content)) !== null) {
    hasImport = true;
    namedSymbols.push(...m[1].split(',').map(s => { const t = s.trim(); const a = t.match(/(\w+)\s*:\s*(\w+)/); return a ? { name: a[1], alias: a[2] } : { name: t, alias: t }; }).filter(s => s.name && s.name.length > 0));
  }
  if (new RegExp(`import\\s*['"](?:${libRegexStr})['"]`, 'g').test(content)) hasImport = true;
  return { defaultAlias, namedSymbols, hasImport };
}

function trackInstanceVariablesRegex(content, defaultAlias, namedSymbols, allClassNames) {
  const varMap = {};
  const classSet = new Set(allClassNames);
  if (defaultAlias) {
    for (const regex of [
      new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*${escapeRegex(defaultAlias)}\\b(?!\\s*\\.)`, 'g'),
      new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*${escapeRegex(defaultAlias)}\\s*\\.\\s*(${[...classSet].map(escapeRegex).join('|')})\\s*\\(`, 'g'),
    ]) { let m; while ((m = regex.exec(content)) !== null) { const vn = m[1], cls = m[2] || defaultAlias; if (!varMap[vn]) varMap[vn] = []; if (!varMap[vn].includes(cls)) varMap[vn].push(cls); } }
  }
  for (const sym of namedSymbols) {
    for (const regex of [
      new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*new\\s+${sym.alias}\\s*\\(`, 'g'),
      new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*:\\s*${sym.alias}\\b`, 'g'),
    ]) { let m; while ((m = regex.exec(content)) !== null) { if (!varMap[m[1]]) varMap[m[1]] = []; if (!varMap[m[1]].includes(sym.alias)) varMap[m[1]].push(sym.alias); } }
  }
  return varMap;
}

function matchCoverageRegex(interfaces, files, libName, fullLibName) {
  const fileCoverageMap = {};
  const allClassNames = [...new Set(interfaces.filter(i => i.className).map(i => i.className))];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const { defaultAlias, namedSymbols, hasImport } = extractImportsRegex(content, libName, fullLibName);
    const sideEffectInterfaces = interfaces.filter(i => i.type === 'side-effect');
    if (!hasImport && sideEffectInterfaces.length === 0) continue;
    const varMap = trackInstanceVariablesRegex(content, defaultAlias, namedSymbols, allClassNames);
    const fileCovered = [];
    for (const iface of interfaces) {
      if (iface.type === 'side-effect') {
        const mem = escapeRegex(iface.memberName);
        const patterns = [new RegExp(`\\b${mem}\\s*\\(`, 'g')];
        if (iface.className) patterns.push(new RegExp(`${escapeRegex(iface.className)}\\s*\\.\\s*${mem}\\s*\\(`, 'g'));
        for (const r of patterns) { if (r.test(content)) { fileCovered.push(iface.fullName); break; } }
        continue;
      }
      if (iface.className === null) {
        if (new RegExp(`\\b${escapeRegex(iface.memberName)}\\s*\\(`, 'g').test(content)) { fileCovered.push(iface.fullName); continue; }
        continue;
      }
      const ca = defaultAlias;
      if (ca) {
        const mem = escapeRegex(iface.memberName);
        if (new RegExp(`\\b${escapeRegex(ca)}\\s*\\.\\s*${mem}\\s*\\(`, 'g').test(content)) { fileCovered.push(iface.fullName); continue; }
        if (new RegExp(`\\b${escapeRegex(ca)}\\s*\\.\\s*${mem}\\b`, 'g').test(content)) { fileCovered.push(iface.fullName); continue; }
      }
      const classNameUsed = namedSymbols.find(s => s.name === iface.className || s.alias === iface.className);
      if (classNameUsed) {
        const alias = classNameUsed.alias, mem = escapeRegex(iface.memberName);
        if (iface.isStatic) { if (new RegExp(`\\b${escapeRegex(alias)}\\s*\\.\\s*${mem}\\s*\\(`, 'g').test(content)) { fileCovered.push(iface.fullName); continue; } }
        else {
          for (const [vn, cls] of Object.entries(varMap)) { if (cls.includes(alias) && new RegExp(`(?:this\\s*\\.\\s*)?${escapeRegex(vn)}\\s*\\.\\s*${mem}\\s*\\(`, 'g').test(content)) { fileCovered.push(iface.fullName); break; } }
          if (new RegExp(`\\b${escapeRegex(alias)}\\s*\\.\\s*${mem}\\s*\\(`, 'g').test(content)) { fileCovered.push(iface.fullName); continue; }
        }
      }
      if (ca && iface.className) { if (new RegExp(`\\b${escapeRegex(ca)}\\s*\\.\\s*${escapeRegex(iface.className)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\s*\\(`, 'g').test(content)) { fileCovered.push(iface.fullName); continue; } }
    }
    for (const iface of interfaces) {
      if (fileCovered.includes(iface.fullName)) continue;
      if ((iface.kind === 'property' || iface.kind === 'field' || iface.kind === 'method') && iface.memberName && iface.memberName.length >= 2) {
        if (new RegExp(`\\b${escapeRegex(iface.memberName)}\\??\\s*:`, 'g').test(content)) fileCovered.push(iface.fullName);
      }
    }
    if (defaultAlias) {
      for (const iface of interfaces) {
        if (fileCovered.includes(iface.fullName) || !iface.className || iface.isStatic) continue;
        const mem = escapeRegex(iface.memberName);
        if ((iface.kind === 'method' || iface.kind === 'function') && new RegExp(`\\.${mem}\\s*\\(`, 'g').test(content)) fileCovered.push(iface.fullName);
        else if ((iface.kind === 'property' || iface.kind === 'field') && new RegExp(`\\.${mem}\\b`, 'g').test(content)) fileCovered.push(iface.fullName);
      }
    }
    for (const fullName of fileCovered) {
      if (!fileCoverageMap[fileName]) fileCoverageMap[fileName] = { count: 0, interfaces: [] };
      fileCoverageMap[fileName].count++;
      fileCoverageMap[fileName].interfaces.push(fullName);
    }
  }
  return aggregateResults(interfaces, fileCoverageMap, libName, files.length);
}

// ════════════════════════════════════════════════════════════
// AST 匹配引擎
// ════════════════════════════════════════════════════════════

function extractImportedSymbolsAST(sourceFile, libName, fullLibName) {
  const symbols = new Map();
  const libSuffix = libName.split('/').pop();
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const ms = stmt.moduleSpecifier;
      if (!ms || !ts.isStringLiteral(ms)) continue;
      const fromLib = ms.text;
      if (fromLib !== libName && fromLib !== fullLibName && !fromLib.endsWith('/' + libSuffix)) continue;
      const ic = stmt.importClause;
      if (!ic) { symbols.set('__sideEffect__', true); continue; }
      if (ic.name) symbols.set('default', ic.name.text);
      if (ic.namedBindings && ts.isNamedImports(ic.namedBindings)) for (const el of ic.namedBindings.elements) { const n = el.propertyName ? el.propertyName.text : el.name.text; symbols.set(n, el.name.text); }
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue;
        const callee = decl.initializer.expression;
        if (!ts.isIdentifier(callee) || callee.text !== 'require' || decl.initializer.arguments.length === 0) continue;
        const arg = decl.initializer.arguments[0];
        if (!ts.isStringLiteral(arg)) continue;
        const fromLib = arg.text;
        if (fromLib !== libName && fromLib !== fullLibName && !fromLib.endsWith('/' + libSuffix)) continue;
        if (ts.isIdentifier(decl.name)) symbols.set('default', decl.name.text);
        if (ts.isObjectBindingPattern(decl.name)) for (const el of decl.name.elements) { if (el.propertyName && ts.isIdentifier(el.propertyName)) symbols.set(el.propertyName.text, ts.isIdentifier(el.name) ? el.name.text : el.propertyName.text); else if (ts.isIdentifier(el.name)) symbols.set(el.name.text, el.name.text); }
      }
    }
  }
  return symbols;
}

function trackInstanceVariablesAST(sourceFile, checker, importedSymbols) {
  const varMap = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)) trackVar(node.name.text, node);
    if (ts.isParameter(node) && node.name && ts.isIdentifier(node.name)) trackVar(node.name.text, node);
    ts.forEachChild(node, visit);
  }
  function trackVar(varName, node) {
    try {
      const typeStr = checker.typeToString(checker.getTypeAtLocation(node));
      for (const [cn, alias] of importedSymbols) {
        if (cn === 'default' || cn === '__sideEffect__') continue;
        if (typeStr === cn || typeStr === alias || typeStr.startsWith(cn + ' |') || typeStr.startsWith(alias + ' |') || typeStr.includes(cn) || typeStr.includes(alias)) {
          if (!varMap[varName]) varMap[varName] = [];
          const dn = importedSymbols.get(cn) || cn;
          if (!varMap[varName].includes(dn)) varMap[varName].push(dn);
        }
      }
    } catch {}
  }
  visit(sourceFile);
  return varMap;
}

function collectCoverageAST(sourceFile, checker, interfaces, importedSymbols, varMap) {
  const covered = new Set();
  const ifaceByFullName = new Map();
  const ifaceByMemberName = new Map();
  for (const iface of interfaces) {
    ifaceByFullName.set(iface.fullName, iface);
    if (!ifaceByMemberName.has(iface.memberName)) ifaceByMemberName.set(iface.memberName, []);
    ifaceByMemberName.get(iface.memberName).push(iface);
  }
  const importedClassNames = new Set();
  for (const [, alias] of importedSymbols) if (alias !== 'default' && alias !== '__sideEffect__') importedClassNames.add(alias);
  const defaultAlias = importedSymbols.get('default');

  function visit(node) {
    if (ts.isPropertyAccessExpression(node)) {
      const propName = node.name.text;
      const expr = node.expression;
      if (ts.isIdentifier(expr) || (ts.isNonNullExpression(expr) && ts.isIdentifier(expr.expression))) {
        const varName = ts.isIdentifier(expr) ? expr.text : expr.expression.text;
        const classNames = varMap[varName];
        if (classNames) for (const cn of classNames) { const fn = `${cn}.${propName}`; if (ifaceByFullName.has(fn)) covered.add(fn); }
      }
      if (ts.isIdentifier(expr) && importedClassNames.has(expr.text)) { const fn = `${expr.text}.${propName}`; if (ifaceByFullName.has(fn)) covered.add(fn); }
      if (defaultAlias && ts.isIdentifier(expr) && expr.text === defaultAlias) {
        for (const iface of interfaces) if (iface.className && iface.memberName === propName) covered.add(iface.fullName);
        const cands = ifaceByMemberName.get(propName);
        if (cands) for (const c of cands) if (c.className === null) covered.add(c.fullName);
      }
      try {
        const rt = checker.typeToString(checker.getTypeAtLocation(expr));
        if (rt) for (const [cn, alias] of importedSymbols) { if (cn === 'default' || cn === '__sideEffect__') continue; if (rt === alias || rt === cn) { const fn = `${alias}.${propName}`; if (ifaceByFullName.has(fn)) covered.add(fn); } }
      } catch {}
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const cands = ifaceByMemberName.get(node.expression.text);
      if (cands) for (const c of cands) if (c.className === null && (c.kind === 'function' || c.kind === 'variable')) covered.add(c.fullName);
    }
    if (ts.isIdentifier(node)) {
      const cands = ifaceByMemberName.get(node.text);
      if (cands) for (const c of cands) if (c.className === null && c.kind === 'variable') covered.add(c.fullName);
    }
    if (ts.isObjectLiteralExpression(node)) {
      let ctxType = null;
      try { const t = checker.getContextualType(node); if (t) ctxType = checker.typeToString(t); } catch {}
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
        let pn = null;
        if (ts.isIdentifier(prop.name)) pn = prop.name.text;
        else if (ts.isStringLiteral(prop.name)) pn = prop.name.text;
        if (!pn) continue;
        if (ctxType) for (const [cn, alias] of importedSymbols) { if (cn === 'default' || cn === '__sideEffect__') continue; if (ctxType === cn || ctxType === alias || ctxType.startsWith(cn) || ctxType.startsWith(alias)) { const fn = `${alias}.${pn}`; if (ifaceByFullName.has(fn)) covered.add(fn); } }
        const cands = ifaceByMemberName.get(pn);
        if (cands) for (const c of cands) if (c.kind === 'property' || c.kind === 'field') covered.add(c.fullName);
      }
    }
    if (defaultAlias && ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === defaultAlias) {
      const fn = `${node.expression.name.text}.${node.name.text}`;
      if (ifaceByFullName.has(fn)) covered.add(fn);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return covered;
}

function matchCoverageAST(interfaces, testFiles, libName, fullLibName, libRoot) {
  if (!ts) { warn('TypeScript 模块不可用，降级到正则模式'); return null; }
  // Windows 兼容：TS 编译器内部使用正斜杠 / 作为路径分隔符
  const toPosix = (p) => p.replace(/\\/g, '/');
  const libSourceFiles = [];
  function collectLibFiles(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'harmony', 'android', 'ios', '.git'].includes(entry.name)) continue;
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) collectLibFiles(fp);
      else if (/\.(ts|tsx|js|jsx|d\.ts)$/.test(entry.name)) libSourceFiles.push(fp);
    }
  }
  collectLibFiles(libRoot);
  const allSourceFiles = [...libSourceFiles, ...testFiles];
  const fileContents = {};
  for (const rp of allSourceFiles) { try { fileContents[toPosix(rp)] = fs.readFileSync(rp, 'utf-8'); } catch {} }
  const posixLibSourceFiles = libSourceFiles.map(toPosix);
  const posixRootNames = allSourceFiles.map(toPosix);
  const compilerOptions = { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.ESNext, strict: false, skipLibCheck: true, noEmit: true, allowJs: true, allowSyntheticDefaultImports: true, esModuleInterop: true, jsx: ts.JsxEmit.React };
  const host = {
    getSourceFile(fileName, lv) {
      const content = fileContents[fileName] || fileContents[toPosix(fileName)];
      if (content) { const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : fileName.endsWith('.jsx') ? ts.ScriptKind.JSX : fileName.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS; return ts.createSourceFile(fileName, content, lv, true, kind); }
      try { const c = ts.sys.readFile(fileName); if (c !== undefined) return ts.createSourceFile(fileName, c, lv, true); } catch {}
      return undefined;
    },
    getDefaultLibFileName() { return ts.getDefaultLibFilePath(compilerOptions); },
    writeFile() {}, getCurrentDirectory() { return process.cwd(); },
    getCanonicalFileName(fn) { return fn; }, useCaseSensitiveFileNames() { return true; }, getNewLine() { return '\n'; },
    fileExists(fn) { return !!fileContents[fn] || !!fileContents[toPosix(fn)] || ts.sys.fileExists(fn); },
    readFile(fn) { return fileContents[fn] || fileContents[toPosix(fn)] || ts.sys.readFile(fn); },
    resolveModuleNames(moduleNames, containingFile) {
      const resolved = [];
      for (const moduleName of moduleNames) {
        let rp = null;
        const baseDir = path.dirname(containingFile);
        if (moduleName.startsWith('.')) {
          for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.d.ts']) { const p = toPosix(path.resolve(baseDir, moduleName + ext)); if (fileContents[p] || ts.sys.fileExists(p)) { rp = p; break; } }
          if (!rp) for (const ext of ['.ts', '.tsx', '.js', '.jsx']) { const p = toPosix(path.resolve(baseDir, moduleName, 'index' + ext)); if (fileContents[p] || ts.sys.fileExists(p)) { rp = p; break; } }
        }
        if ((moduleName === libName || moduleName === fullLibName) && !rp) for (const sf of posixLibSourceFiles) if (sf.endsWith('index.ts') || sf.endsWith('index.js') || sf.endsWith('index.tsx')) { rp = sf; break; }
        resolved.push(rp ? { resolvedFileName: rp, extension: '.ts' } : undefined);
      }
      return resolved;
    },
  };
  const program = ts.createProgram(posixRootNames, compilerOptions, host);
  const checker = program.getTypeChecker();
  const hasSideEffectInterfaces = interfaces.some(i => i.type === 'side-effect');
  const fileCoverageMap = {};
  for (const testFile of testFiles) {
    const sourceFile = program.getSourceFile(toPosix(testFile));
    if (!sourceFile) continue;
    const fileName = path.basename(testFile);
    const importedSymbols = extractImportedSymbolsAST(sourceFile, libName, fullLibName);
    if (importedSymbols.size === 0 && !hasSideEffectInterfaces) continue;
    const varMap = trackInstanceVariablesAST(sourceFile, checker, importedSymbols);
    const fileCovered = collectCoverageAST(sourceFile, checker, interfaces, importedSymbols, varMap);
    if (hasSideEffectInterfaces) {
      const content = fs.readFileSync(testFile, 'utf-8');
      for (const iface of interfaces) {
        if (iface.type !== 'side-effect' || fileCovered.has(iface.fullName)) continue;
        const mem = escapeRegex(iface.memberName);
        const patterns = [new RegExp(`\\b${mem}\\s*\\(`, 'g')];
        if (iface.className) patterns.push(new RegExp(`${escapeRegex(iface.className)}\\s*\\.\\s*${mem}\\s*\\(`, 'g'));
        for (const r of patterns) { if (r.test(content)) { fileCovered.add(iface.fullName); break; } }
      }
    }
    if (fileCovered.size > 0) fileCoverageMap[fileName] = { count: fileCovered.size, interfaces: Array.from(fileCovered) };
  }
  return aggregateResults(interfaces, fileCoverageMap, libName, testFiles.length);
}

// ════════════════════════════════════════════════════════════
// 结果聚合
// ════════════════════════════════════════════════════════════

function aggregateResults(interfaces, fileCoverageMap, libName, sourceFileCount) {
  const coveredSet = new Set();
  for (const fc of Object.values(fileCoverageMap)) for (const intf of fc.interfaces) coveredSet.add(intf);
  const classCoverageMap = {}, covered = [], uncovered = [];
  for (const iface of interfaces) {
    const cn = iface.className || '';
    if (!classCoverageMap[cn]) classCoverageMap[cn] = { total: 0, covered: 0 };
    classCoverageMap[cn].total++;
    if (coveredSet.has(iface.fullName)) { classCoverageMap[cn].covered++; covered.push({ ...iface, files: Object.entries(fileCoverageMap).filter(([_, fc]) => fc.interfaces.includes(iface.fullName)).map(([fn]) => fn) }); }
    else uncovered.push(iface);
  }
  const N = interfaces.length, M = coveredSet.size, X = N > 0 ? (M / N * 100).toFixed(2) : '0.00';
  const byKind = {};
  for (const kind of ['method', 'constructor', 'property', 'field', 'enumValue', 'function', 'variable', 'type']) {
    const ki = interfaces.filter(i => i.kind === kind);
    const kc = ki.filter(i => coveredSet.has(i.fullName));
    byKind[kind] = { total: ki.length, covered: kc.length, rate: ki.length > 0 ? (kc.length / ki.length * 100).toFixed(2) : '-' };
  }
  const classCoverage = [];
  for (const [cn, d] of Object.entries(classCoverageMap)) if (cn !== '') classCoverage.push({ className: cn, total: d.total, covered: d.covered, uncovered: d.total - d.covered, rate: d.total > 0 ? (d.covered / d.total * 100).toFixed(2) : '-' });
  return {
    libraryName: libName, totalInterfacesClassLevel: Object.keys(classCoverageMap).filter(k => k !== '').length,
    totalInterfacesMethodLevel: N, coveredMethodCount: M, coverageRateMethodLevel: X,
    byKind, classCoverage, covered, uncovered,
    fileCoverage: Object.entries(fileCoverageMap).map(([file, data]) => ({ file, count: data.count, interfaces: data.interfaces })),
    sourceFileCount,
  };
}

// ════════════════════════════════════════════════════════════
// Markdown 渲染
// ════════════════════════════════════════════════════════════

function renderHeader(result, title) {
  return `# ${title || result.libraryName + ' 覆盖率分析报告'}\n\n> 本报告自动生成。\n\n## 基本信息\n\n| 属性 | 值 |\n|------|----|\n| 库名 | \`${result.libraryName}\` |\n| 源文件数 | ${result.sourceFileCount || '-'} |\n| 生成时间 | ${new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').replace('Z', '+08:00')} |\n`;
}
function renderOverview(result) {
  const rate = parseFloat(result.coverageRateMethodLevel) || 0;
  const filled = Math.round(rate / 5), empty = 20 - filled;
  return `## 覆盖率总览\n\n### 方法级覆盖率: ${result.coverageRateMethodLevel}% (${coverageBadge(result.coverageRateMethodLevel)})\n\n| 统计项 | 数量 |\n|--------|------|\n| 类/接口总数 (S) | ${result.totalInterfacesClassLevel} |\n| 方法/属性总数 (N) | ${result.totalInterfacesMethodLevel} |\n| 已覆盖 (M) | ${result.coveredMethodCount} |\n| 未覆盖 | ${result.totalInterfacesMethodLevel - result.coveredMethodCount} |\n\n\`\`\`\n覆盖率进度: [${'\u2588'.repeat(filled)}${'\u2591'.repeat(empty)}] ${rate.toFixed(2)}%\n\`\`\`\n`;
}
function renderByKind(result) {
  let lines = '### 按接口类型统计\n\n| 类型 | 总数 | 已覆盖 | 覆盖率 | 状态 |\n|------|------|--------|--------|------|\n';
  for (const [kind, d] of Object.entries(result.byKind || {})) if (d.total > 0) lines += `| ${kind} | ${d.total} | ${d.covered} | ${d.rate}% | ${coverageBadge(d.rate)} |\n`;
  return lines + '\n';
}
function renderClassCoverage(result) {
  let lines = '## 类级覆盖率\n\n| # | 类名 | 总数 | 已覆盖 | 未覆盖 | 覆盖率 | 状态 |\n|---|------|------|--------|--------|--------|------|\n';
  [...(result.classCoverage || [])].sort((a, b) => (parseFloat(a.rate) || 0) - (parseFloat(b.rate) || 0)).forEach((c, i) => { lines += `| ${i + 1} | \`${c.className}\` | ${c.total} | ${c.covered} | ${c.uncovered} | ${c.rate}% | ${coverageBadge(c.rate)} |\n`; });
  return lines + '\n';
}
function renderFileCoverage(result) {
  let lines = '## 文件覆盖详情\n\n| # | 文件 | 覆盖接口数 | 覆盖的接口 |\n|---|------|-----------|-----------|\n';
  [...(result.fileCoverage || [])].sort((a, b) => b.count - a.count).forEach((f, i) => { const ifaces = f.interfaces.slice(0, 10).map(i => `\`${i}\``).join(', '); lines += `| ${i + 1} | \`${f.file}\` | ${f.count} | ${ifaces}${f.interfaces.length > 10 ? ` ... (+${f.interfaces.length - 10})` : ''} |\n`; });
  return lines + '\n';
}
function renderCoveredDetails(result) {
  const covered = result.covered || [];
  if (covered.length === 0) return '## 已覆盖接口详情\n\n*暂无已覆盖接口*\n\n';
  const grouped = {};
  for (const c of covered) { const cn = c.className || '(顶层)'; if (!grouped[cn]) grouped[cn] = []; grouped[cn].push(c); }
  let lines = '## 已覆盖接口详情\n\n';
  let idx = 0;
  for (const [cn, members] of Object.entries(grouped)) { idx++; lines += `### ${idx}. ${cn}\n\n| # | 接口 | 类型 | 层级 | 签名 | 覆盖文件 |\n|---|------|------|------|------|----------|\n`; members.forEach((m, i) => { const files = (m.files || []).slice(0, 3).map(f => `\`${f}\``).join(', '); lines += `| ${i + 1} | \`${m.memberName}\` | ${m.kind} | ${m.layer || '-'} | \`${escapeMd(m.signature)}\` | ${files}${m.files && m.files.length > 3 ? ` +${m.files.length - 3}` : ''} |\n`; }); lines += '\n'; }
  return lines;
}
function renderUncoveredDetails(result) {
  const uncovered = result.uncovered || [];
  if (uncovered.length === 0) return '## 未覆盖接口详情\n\n*所有接口均已覆盖！*\n\n';
  const grouped = {};
  for (const u of uncovered) { const cn = u.className || '(顶层)'; if (!grouped[cn]) grouped[cn] = []; grouped[cn].push(u); }
  let lines = '## 未覆盖接口详情\n\n';
  let idx = 0;
  for (const [cn, members] of Object.entries(grouped)) { idx++; lines += `### ${idx}. ${cn} (${members.length} 个未覆盖)\n\n| # | 接口 | 类型 | 层级 | 参数 | 返回类型 | 说明 |\n|---|------|------|------|------|----------|------|\n`; members.forEach((m, i) => { lines += `| ${i + 1} | \`${m.memberName}\` | ${m.kind} | ${m.layer || '-'} | ${escapeMd(formatParams(m.params))} | ${escapeMd(m.returnType)} | ${escapeMd(m.description)} |\n`; }); lines += '\n'; }
  return lines;
}
function renderRecommendations(result) {
  const uncovered = result.uncovered || [];
  const rate = parseFloat(result.coverageRateMethodLevel) || 0;
  let lines = '## 覆盖率提升建议\n\n';
  lines += rate >= 80 ? '覆盖率优秀！以下接口仍可补充测试：\n' : rate >= 50 ? '覆盖率中等，建议优先补充以下接口的测试：\n' : '覆盖率较低，强烈建议补充以下接口的测试：\n\n';
  const priority = uncovered.sort((a, b) => { const ko = { method: 0, function: 1, property: 2, field: 3, variable: 4, enumValue: 5, type: 6 }; const ka = ko[a.kind] ?? 99, kb = ko[b.kind] ?? 99; return ka !== kb ? ka - kb : (a.className || '').localeCompare(b.className || ''); });
  priority.slice(0, 20).forEach((u, i) => { lines += `${i + 1}. [ ] ${u.className ? `\`${u.className}.\`` : ''}\`${u.memberName}\` — ${u.kind}${u.isStatic ? ' (静态)' : ''}${formatParams(u.params) ? ` (${formatParams(u.params)})` : ''}\n`; });
  if (priority.length > 20) lines += `- ... 还有 ${priority.length - 20} 个未覆盖接口\n`;
  return lines + '\n';
}

// ════════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════════

const args = parseArgs(process.argv.slice(2));

if (!args.spec && !args.libroot && !args.repoDir) {
  console.error('用法: node rn-analyze-test-coverage.cjs --spec <spec.json> --libroot <库根目录>');
  console.error('  或: node rn-analyze-test-coverage.cjs --libroot <库根目录> [--version <上游版本>]');
  process.exit(1);
}

const loaded = loadSpec(args);
if (!loaded) { console.error('无法加载接口规格数据'); process.exit(1); }

const { spec, libRoot, specBasename } = loaded;

// 自动检测测试源码目录
function detectTestDir(libRoot) {
  for (const c of [
    path.join(libRoot, 'example', 'src', 'test'),
    path.join(libRoot, 'example', 'src', 'tests'),
    path.join(libRoot, 'example', '__tests__'),
    path.join(libRoot, 'demo', '__tests__'),
    path.join(libRoot, 'demo', 'src', 'test'),
    path.join(libRoot, 'demo', 'src', 'tests'),
    path.join(libRoot, '__tests__'),
    path.join(libRoot, 'test'),
    path.join(libRoot, 'tests'),
  ]) { if (fs.existsSync(c)) return c; }
  return path.join(libRoot, '__tests__');
}

const srcDir = args.src || detectTestDir(libRoot);
const mode = args.mode || 'auto';
const libName = spec.libraryAlias || spec.libraryName || '';
const fullLibName = spec.libraryName || '';
const interfaces = spec.interfaces || [];

info('[Test 覆盖率分析]');
info(`库名: ${libName} (完整: ${fullLibName})`);
info(`源码目录: ${srcDir}`);

let result;
if (!fs.existsSync(srcDir)) {
  warn(`测试源码目录不存在: ${srcDir}`);
  result = aggregateResults(interfaces, {}, libName, 0);
} else {
  const testFiles = walkDir(srcDir, { exts: ['.ts', '.tsx', '.js', '.jsx', '.ets'], excludeDirs: ['node_modules', 'harmony', 'android', 'ios', '__mocks__'] }, srcDir);
  info(`扫描到 ${testFiles.length} 个源文件`);
  result = null;
  if (testFiles.length > 0) {
    if (mode === 'ast' || (mode === 'auto' && ts)) {
      info('使用 AST 模式匹配...');
      try { result = matchCoverageAST(interfaces, testFiles, libName, fullLibName, libRoot); } catch (e) { warn(`AST 模式出错: ${e.message}`); result = null; }
      if (!result && mode === 'auto') warn('AST 模式失败，降级到正则模式...');
    }
    if (!result) { info('使用正则模式匹配...'); result = matchCoverageRegex(interfaces, testFiles, libName, fullLibName); }
  } else {
    warn('未找到测试源文件');
    result = aggregateResults(interfaces, {}, libName, 0);
  }
}
result.specSummary = spec.summary;
result.noTestFiles = !fs.existsSync(srcDir) || (result.sourceFileCount === 0);
ok(`匹配完成: ${result.coveredMethodCount}/${result.totalInterfacesMethodLevel} (${result.coverageRateMethodLevel}%)`);

const title = args.title || `${spec.libraryName} Test 覆盖率分析报告`;
const parts = [renderHeader(result, title)];
if (result.noTestFiles) {
  parts.push(`## 无测试文档声明\n\n> **该库未找到 JS 测试源文件。**\n>\n> 测试源码目录: \`${srcDir}\`\n>\n> 覆盖率: **0%**（所有 ${result.totalInterfacesMethodLevel} 个接口均未被测试覆盖）\n\n请添加测试文件后重新运行分析。\n`);
}
parts.push(renderOverview(result), renderByKind(result), renderClassCoverage(result), renderUncoveredDetails(result), renderCoveredDetails(result), renderFileCoverage(result), renderRecommendations(result));
const markdown = parts.join('\n---\n\n');

const outputPath = args.output || path.join(libRoot, `03-${specBasename}-Test覆盖率报告.md`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, markdown, 'utf-8');
ok(`报告渲染完成: ${outputPath}`);
