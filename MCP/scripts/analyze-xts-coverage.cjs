#!/usr/bin/env node
/**
 * @tool arkts_analyze_xts_coverage
 * @description 分析鸿蒙 ArkTS 三方库的 XTS 测试覆盖率。从库源码提取接口规格，扫描 entry/src/ohosTest 下的 XTS 测试源码，执行 AST/正则双层覆盖率匹配，输出 Markdown 覆盖率报告。用于评估 XTS 测试用例对库 API 的覆盖程度。
 * @param libroot: string - 库源码根目录路径（包含 library/ 和 entry/ 子目录）
 * @param spec: string - 已有的 interface-spec.json 路径（可选，与 libroot 二选一）
 * @hidden   
 * @param output: string - 输出 Markdown 报告路径（可选，默认 03-xxx-XTS覆盖率报告.md）
 * @param mode: string - 匹配模式: auto(默认) | ast | regex（可选）
 *
 * analyze-xts-coverage.cjs — XTS 覆盖率分析专用脚本
 *
 * 从库源码提取接口规格，针对 XTS 测试源码目录执行 AST/正则双层覆盖率匹配，
 * 直接渲染输出 Markdown 覆盖率报告。
 *
 * 用法:
 *   方式一（读 JSON 中间件）:
 *     node analyze-xts-coverage.cjs --spec <interface-spec.json> --libroot <库根目录> \
 *       [--output <report.md>] [--title <标题>] [--mode auto|ast|regex]
 *
 *   方式二（直接从源码提取，无需 JSON 中间件）:
 *     node analyze-xts-coverage.cjs --libroot <库根目录> \
 *       [--output <report.md>] [--title <标题>] [--mode auto|ast|regex]
 *
 * 参数:
 *   --spec      interface-spec.json 路径（由 extract-interfaces.cjs 生成）
 *   --libroot   库根目录（XTS 源码默认取 <libroot>/entry/src/ohosTest）
 *   --output    （可选）输出 Markdown 报告路径，默认 03-xxx-XTS覆盖率报告.md
 *   --title     （可选）报告标题
 *   --mode      （可选）匹配模式: auto(默认) | ast | regex
 *   --lib       （可选）库名覆盖，默认从 spec 中读取
 *
 * 使用示例:
 *   # 直接从源码生成 XTS 覆盖率报告（推荐，一步到位）
 *   node analyze-xts-coverage.cjs --libroot /path/to/lottie_turbo --output 03-lottie_turbo-XTS覆盖率报告.md
 *
 *   # 从已有 JSON 中间件生成（需先用 extract-interfaces.cjs 生成 JSON）
 *   node analyze-xts-coverage.cjs --spec lottie_turbo-interface-spec.json --libroot /path/to/lottie_turbo
 *
 *   # 库源码目录结构约定:
 *   #   /path/to/lottie_turbo/
 *   #     ├── library/              ← 库源码（Index.ets 入口）
 *   #     │   ├── Index.ets
 *   #     │   ├── src/main/ets/
 *   #     │   └── src/main/cpp/types/.../Index.d.ts   ← Native .so 声明
 *   #     └── entry/src/ohosTest/    ← XTS 测试源码（被分析的目录）
 */

const fs = require('fs');
const path = require('path');
const { generateSpec } = require('./extract-interfaces.cjs');

// ════════════════════════════════════════════════════════════
// Part 0: TypeScript 加载 + 参数解析 + 工具函数
// ════════════════════════════════════════════════════════════

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
    path.join(__dirname, '..', '..', '3rdLibraryLoop', 'Server', 'Skills', 'ArkTsLibraryXTSCoverageSkill', 'node_modules', 'typescript'),
    path.join(__dirname, '..', 'Server', 'Skills', 'ArkTsLibraryXTSCoverageSkill', 'node_modules', 'typescript'),
  ];
  for (const p of candidates) {
    try {
      const ts = require(p);
      if (ts && typeof ts.createProgram === 'function') return ts;
    } catch (e) { /* continue */ }
  }
  try {
    const ts = require('typescript');
    if (ts && typeof ts.createProgram === 'function') return ts;
  } catch (e) { /* continue */ }
  return null;
}

const ts = loadTypeScript();

function parseArgs() {
  const args = process.argv.slice(2);
  // MCP Gateway 模式：第一个参数是 JSON 字符串
  if (args.length > 0 && args[0].startsWith('{')) {
    try { return JSON.parse(args[0]); } catch (e) { /* 降级到 CLI 模式 */ }
  }
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      parsed[args[i].substring(2)] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeMd(text) {
  if (!text || text === '-') return '-';
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatParams(params) {
  if (!params || params.length === 0) return '';
  return params.map(p => {
    const opt = p.optional ? '?' : '';
    return `${p.name}${opt}: ${escapeMd(p.type)}`;
  }).join(', ');
}

function coverageBadge(rate) {
  const r = parseFloat(rate);
  if (r >= 80) return '高';
  if (r >= 50) return '中';
  if (r >= 20) return '低';
  return '极低';
}

// ════════════════════════════════════════════════════════════
// Part A: 文件扫描 + 正则匹配引擎
// ════════════════════════════════════════════════════════════

const EXCLUDE_TOP_DIRS = ['entryability', 'entrybackupability', 'model', 'util', 'ohosTest'];

function walkDir(dir, excludeTopDirs, srcRoot) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const relDir = path.relative(srcRoot, dir);
  const topDir = relDir.split(path.sep)[0] || '';
  if (relDir !== '' && excludeTopDirs.includes(topDir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, excludeTopDirs, srcRoot));
    } else if (entry.isFile() && (entry.name.endsWith('.ets') || entry.name.endsWith('.ts'))) {
      if (entry.name === 'Index.ets' || entry.name === 'index.ts') {
        const relPath = path.relative(srcRoot, fullPath);
        const depth = relPath.split(path.sep).length;
        if (depth === 1) continue;
      }
      results.push(fullPath);
    }
  }
  return results;
}

/** 提取 import 的具名符号 */
function extractImportsRegex(content, libName) {
  const importedSymbols = [];
  const importRegex = /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*?)\}\s*from\s*['"]([^'"]+)['"]/gs;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const symbolsStr = match[1];
    const fromLib = match[2];
    if (fromLib === libName || fromLib.endsWith('/' + libName.split('/').pop())) {
      const symbols = symbolsStr.split(',').map(s => {
        const trimmed = s.trim().replace(/\n/g, '').replace(/\s+/g, ' ');
        const aliasMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
        if (aliasMatch) return { name: aliasMatch[1], alias: aliasMatch[2] };
        return { name: trimmed, alias: trimmed };
      }).filter(s => s.name.length > 0);
      importedSymbols.push(...symbols);
    }
  }
  return importedSymbols;
}

/** 检测纯默认导入 */
function extractDefaultImportRegex(content, libName) {
  const libSuffix = libName.split('/').pop();
  const defaultRegex = new RegExp(
    `import\\s+(?:type\\s+)?([A-Za-z_$][\\w$]*)\\s+from\\s*['"](?:${escapeRegex(libName)}|[^'"]*${escapeRegex(libSuffix)})['"]`,
    'g'
  );
  let match;
  while ((match = defaultRegex.exec(content)) !== null) {
    const afterMatch = content.slice(match.index + match[0].length);
    if (!/^\s*,\s*\{/.test(afterMatch)) return match[1];
  }
  return null;
}

/** 追踪实例变量 → 类名映射 */
function trackInstanceVariablesRegex(content, importedSymbols, defaultAlias, allClassNames) {
  const varMap = {};
  const classSet = new Set(allClassNames);

  for (const sym of importedSymbols) {
    const className = sym.alias;
    const patterns = [
      new RegExp(`(?:let|const|var)\\s+(\\w+)\\s*:\\s*${className}\\s*=`, 'g'),
      new RegExp(`(?:let|const|var)\\s+(\\w+)\\s*=\\s*new\\s+${className}\\s*\\(`, 'g'),
      new RegExp(`(?:let|const|var)\\s+(\\w+)\\s*=\\s*${className}\\s*\\.\\s*getInstance\\s*\\(`, 'g'),
      new RegExp(`(?:private|public|protected|@State)\\s+(?:\\w+\\s+)?(\\w+)\\s*:\\s*${className}\\b`, 'g'),
      new RegExp(`(?:private|public|protected)\\s+(\\w+)\\s*:\\s*${className}\\s*\\|`, 'g'),
      new RegExp(`\\(\\s*(\\w+)\\s*:\\s*${className}\\s*\\)`, 'g'),
      new RegExp(`\\(\\s*(\\w+)\\s*:\\s*${className}\\s*,`, 'g'),
    ];
    for (const regex of patterns) {
      let m;
      while ((m = regex.exec(content)) !== null) {
        const varName = m[1];
        if (varName && !varMap[varName]) varMap[varName] = [];
        if (varName && !varMap[varName].includes(className)) varMap[varName].push(className);
      }
    }
  }

  if (defaultAlias) {
    const nsPatterns = [
      new RegExp(`(?:let|const|var)\\s+(\\w+)\\s*=\\s*${escapeRegex(defaultAlias)}\\s*\\.\\s*(${[...classSet].map(escapeRegex).join('|')})\\s*\\.\\s*\\w+\\s*\\(`, 'g'),
      new RegExp(`(?:let|const|var)\\s+(\\w+)\\s*=\\s*new\\s+${escapeRegex(defaultAlias)}\\s*\\.\\s*(${[...classSet].map(escapeRegex).join('|')})\\s*\\(`, 'g'),
      new RegExp(`(?:let|const|var)\\s+(\\w+)\\s*:\\s*${escapeRegex(defaultAlias)}\\s*\\.\\s*(${[...classSet].map(escapeRegex).join('|')})\\b`, 'g'),
    ];
    for (const regex of nsPatterns) {
      let m;
      while ((m = regex.exec(content)) !== null) {
        const varName = m[1];
        const cls = m[2];
        if (varName && !varMap[varName]) varMap[varName] = [];
        if (varName && !varMap[varName].includes(cls)) varMap[varName].push(cls);
      }
    }
  }

  return varMap;
}

/** 正则覆盖率匹配核心 */
function matchCoverageRegex(interfaces, files, libName) {
  const fileCoverageMap = {};
  const demoFileCount = files.length;
  const allClassNames = [...new Set(interfaces.map(i => i.className).filter(n => n !== null))];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const importedSymbols = extractImportsRegex(content, libName);
    const defaultAlias = extractDefaultImportRegex(content, libName);

    if (importedSymbols.length === 0 && !defaultAlias) continue;

    const varMap = trackInstanceVariablesRegex(content, importedSymbols, defaultAlias, allClassNames);
    const fileCovered = [];

    for (const iface of interfaces) {
      if (iface.className === null) {
        if (iface.kind === 'function') {
          const regex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\s*\\(`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        } else if (iface.kind === 'variable') {
          const regex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\b`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        }
        continue;
      }

      const classNameUsed = importedSymbols.find(s => s.name === iface.className || s.alias === iface.className);

      if (defaultAlias && !fileCovered.includes(iface.fullName)) {
        const ns = escapeRegex(defaultAlias);
        const cls = escapeRegex(iface.className);
        const mem = escapeRegex(iface.memberName);

        if (iface.isStatic) {
          if (iface.kind === 'method') {
            const nsStaticMethod = new RegExp(`${ns}\\s*\\.\\s*${cls}\\s*\\.\\s*${mem}\\s*\\(`, 'g');
            if (nsStaticMethod.test(content)) { fileCovered.push(iface.fullName); continue; }
          } else if (iface.kind === 'property') {
            const nsStaticProp = new RegExp(`${ns}\\s*\\.\\s*${cls}\\s*\\.\\s*${mem}\\b`, 'g');
            if (nsStaticProp.test(content)) { fileCovered.push(iface.fullName); continue; }
          }
        } else {
          if (iface.kind === 'method') {
            const nsInstMethod = new RegExp(`${ns}\\s*\\.\\s*${cls}\\s*\\.\\s*${mem}\\s*\\(`, 'g');
            if (nsInstMethod.test(content)) { fileCovered.push(iface.fullName); continue; }
          } else if (iface.kind === 'property') {
            const nsInstProp = new RegExp(`${ns}\\s*\\.\\s*${cls}\\s*\\.\\s*${mem}\\b`, 'g');
            if (nsInstProp.test(content)) { fileCovered.push(iface.fullName); continue; }
          }
        }
        if (iface.kind === 'method' || iface.kind === 'property') {
          for (const [varName, classNames] of Object.entries(varMap)) {
            if (classNames.includes(iface.className)) {
              if (iface.kind === 'method') {
                const instRegex = new RegExp(`(?:this\\s*\\.\\s*)?${escapeRegex(varName)}\\s*\\.\\s*${mem}\\s*\\(`, 'g');
                if (instRegex.test(content)) { fileCovered.push(iface.fullName); break; }
              } else if (iface.kind === 'property') {
                const instRegex = new RegExp(`(?:this\\s*\\.\\s*)?${escapeRegex(varName)}\\s*\\.\\s*${mem}\\b`, 'g');
                if (instRegex.test(content)) { fileCovered.push(iface.fullName); break; }
              }
            }
          }
          if (fileCovered.includes(iface.fullName)) continue;
        }
      }

      if (!classNameUsed) continue;

      const ca = classNameUsed.alias;

      if (iface.kind === 'enumValue') {
        const regex = new RegExp(`${escapeRegex(ca)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\b`, 'g');
        if (regex.test(content)) fileCovered.push(iface.fullName);
        continue;
      }

      if (iface.isStatic) {
        if (iface.kind === 'method') {
          const regex = new RegExp(`${escapeRegex(ca)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\s*\\(`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        } else if (iface.kind === 'property') {
          const regex = new RegExp(`${escapeRegex(ca)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\b`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        }
        continue;
      }

      if (iface.kind === 'method' || iface.kind === 'property') {
        const chainRegex = new RegExp(
          `${escapeRegex(ca)}\\s*\\.\\s*getInstance\\s*\\(\\s*\\)[\\s\\S]*?\\.\\s*${escapeRegex(iface.memberName)}\\s*\\(`,
          'g'
        );
        if (chainRegex.test(content)) { fileCovered.push(iface.fullName); continue; }

        for (const [varName, classNames] of Object.entries(varMap)) {
          if (classNames.includes(ca)) {
            if (iface.kind === 'method') {
              const instRegex = new RegExp(`(?:this\\s*\\.\\s*)?${escapeRegex(varName)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\s*\\(`, 'g');
              if (instRegex.test(content)) { fileCovered.push(iface.fullName); break; }
            } else if (iface.kind === 'property') {
              const instRegex = new RegExp(`(?:this\\s*\\.\\s*)?${escapeRegex(varName)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\b`, 'g');
              if (instRegex.test(content)) { fileCovered.push(iface.fullName); break; }
            }
          }
        }

        const directRegex = new RegExp(`${escapeRegex(ca)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\s*\\(`, 'g');
        if (directRegex.test(content)) { fileCovered.push(iface.fullName); continue; }
      }

      if (iface.kind === 'field') {
        const regex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\b`, 'g');
        if (regex.test(content)) fileCovered.push(iface.fullName);
        continue;
      }
    }

    // 对象字面量属性检测
    for (const iface of interfaces) {
      if ((iface.kind === 'property' || iface.kind === 'field' || iface.kind === 'method') && !fileCovered.includes(iface.fullName)) {
        if (iface.memberName && iface.memberName.length >= 2) {
          const objLitRegex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\??\\s*:`, 'g');
          if (objLitRegex.test(content)) fileCovered.push(iface.fullName);
        }
      }
    }

    // 默认导入命名空间的宽松兜底匹配
    if (defaultAlias) {
      for (const iface of interfaces) {
        if (fileCovered.includes(iface.fullName)) continue;
        if (!iface.className) continue;
        if (iface.isStatic) continue;
        const mem = escapeRegex(iface.memberName);
        if (iface.kind === 'method') {
          const looseMethodRegex = new RegExp(`\\.${mem}\\s*\\(`, 'g');
          if (looseMethodRegex.test(content)) fileCovered.push(iface.fullName);
        } else if (iface.kind === 'property' || iface.kind === 'field') {
          const loosePropRegex = new RegExp(`\\.${mem}\\b`, 'g');
          if (loosePropRegex.test(content)) fileCovered.push(iface.fullName);
        }
      }
    }

    for (const fullName of fileCovered) {
      if (!fileCoverageMap[fileName]) fileCoverageMap[fileName] = { count: 0, interfaces: [] };
      fileCoverageMap[fileName].count++;
      fileCoverageMap[fileName].interfaces.push(fullName);
    }
  }

  return aggregateResults(interfaces, fileCoverageMap, {}, libName, demoFileCount);
}

// ════════════════════════════════════════════════════════════
// Part B: AST 匹配引擎
// ════════════════════════════════════════════════════════════

function extractImportedSymbolsAST(sourceFile, libName) {
  const symbols = new Map();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const moduleSpec = stmt.moduleSpecifier;
    if (!moduleSpec || !ts.isStringLiteral(moduleSpec)) continue;
    const fromLib = moduleSpec.text;
    if (fromLib !== libName && !fromLib.endsWith('/' + libName.split('/').pop())) continue;
    const importClause = stmt.importClause;
    if (!importClause) continue;
    if (importClause.name) {
      symbols.set('default', importClause.name.text);
    }
    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        const name = element.propertyName ? element.propertyName.text : element.name.text;
        const alias = element.name.text;
        symbols.set(name, alias);
      }
    }
  }
  return symbols;
}

function trackInstanceVariablesAST(sourceFile, checker, importedSymbols) {
  const varMap = {};

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      trackVar(node.name.text, node);
    }
    if (ts.isPropertyDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      trackVar(node.name.text, node);
    }
    if (ts.isParameter(node) && node.name && ts.isIdentifier(node.name)) {
      trackVar(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  }

  function trackVar(varName, node) {
    try {
      const type = checker.getTypeAtLocation(node);
      const typeStr = checker.typeToString(type);
      for (const [className, alias] of importedSymbols) {
        if (className === 'default') continue;
        if (typeStr === className || typeStr === alias ||
            typeStr.startsWith(className + ' |') || typeStr.startsWith(alias + ' |') ||
            typeStr.includes(className) || typeStr.includes(alias)) {
          if (!varMap[varName]) varMap[varName] = [];
          const displayName = importedSymbols.get(className) || className;
          if (!varMap[varName].includes(displayName)) varMap[varName].push(displayName);
        }
      }
    } catch (e) { /* ignore */ }
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
  for (const [, alias] of importedSymbols) {
    if (alias !== 'default') importedClassNames.add(alias);
  }
  const defaultAlias = importedSymbols.get('default');

  function visit(node) {
    if (ts.isPropertyAccessExpression(node)) {
      const propName = node.name.text;
      const expr = node.expression;

      if (ts.isIdentifier(expr) || (ts.isNonNullExpression(expr) && ts.isIdentifier(expr.expression))) {
        const varName = ts.isIdentifier(expr) ? expr.text : expr.expression.text;
        const classNames = varMap[varName];
        if (classNames) {
          for (const cn of classNames) {
            const fullName = `${cn}.${propName}`;
            if (ifaceByFullName.has(fullName)) covered.add(fullName);
          }
        }
      }

      if (ts.isIdentifier(expr) && importedClassNames.has(expr.text)) {
        const className = expr.text;
        const fullName = `${className}.${propName}`;
        if (ifaceByFullName.has(fullName)) covered.add(fullName);
      }

      try {
        const exprType = checker.getTypeAtLocation(expr);
        const receiverType = checker.typeToString(exprType);
        if (receiverType) {
          for (const [className, alias] of importedSymbols) {
            if (className === 'default') continue;
            if (receiverType === alias || receiverType === className) {
              const fullName = `${alias}.${propName}`;
              if (ifaceByFullName.has(fullName)) covered.add(fullName);
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        const funcName = expr.text;
        const candidates = ifaceByMemberName.get(funcName);
        if (candidates) {
          for (const c of candidates) {
            if (c.className === null && (c.kind === 'function' || c.kind === 'variable')) {
              covered.add(c.fullName);
            }
          }
        }
      }
    }

    if (ts.isIdentifier(node)) {
      const name = node.text;
      const candidates = ifaceByMemberName.get(name);
      if (candidates) {
        for (const c of candidates) {
          if (c.className === null && c.kind === 'variable') covered.add(c.fullName);
        }
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      let contextualType = null;
      try {
        const objType = checker.getContextualType(node);
        if (objType) contextualType = checker.typeToString(objType);
      } catch (e) { /* ignore */ }

      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
          let propName = null;
          if (ts.isIdentifier(prop.name)) propName = prop.name.text;
          else if (ts.isStringLiteral(prop.name)) propName = prop.name.text;
          if (!propName) continue;

          if (contextualType) {
            for (const [className, alias] of importedSymbols) {
              if (className === 'default') continue;
              if (contextualType === className || contextualType === alias ||
                  contextualType.startsWith(className) || contextualType.startsWith(alias)) {
                const fullName = `${alias}.${propName}`;
                if (ifaceByFullName.has(fullName)) covered.add(fullName);
              }
            }
          }

          const candidates = ifaceByMemberName.get(propName);
          if (candidates) {
            for (const c of candidates) {
              if (c.kind === 'property' || c.kind === 'field') covered.add(c.fullName);
            }
          }
        }
      }
    }

    if (defaultAlias && ts.isPropertyAccessExpression(node)) {
      const expr = node.expression;
      if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === defaultAlias) {
        const className = expr.name.text;
        const memberName = node.name.text;
        const fullName = `${className}.${memberName}`;
        if (ifaceByFullName.has(fullName)) covered.add(fullName);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return covered;
}

function matchCoverageAST(interfaces, testFiles, libName, libRoot) {
  if (!ts) {
    console.warn('TypeScript 模块不可用，降级到正则模式');
    return null;
  }

  // Windows 兼容：TS 编译器内部使用正斜杠 / 作为路径分隔符
  const toPosix = (p) => p.replace(/\\/g, '/');

  // 定位库模块根目录（兼容非标准结构，如 ohos_mqtt 用 ohos_Mqtt/ 而非 library/）
  const { locateEntryFile } = require('./extract-interfaces.cjs');
  const entryFile = locateEntryFile(libRoot);
  let libraryDir = path.join(libRoot, 'library');
  if (!fs.existsSync(libraryDir) && entryFile) {
    let dir = path.dirname(entryFile);
    for (let i = 0; i < 6 && dir && dir.startsWith(libRoot); i++) {
      if (fs.existsSync(path.join(dir, 'oh-package.json5')) ||
          fs.existsSync(path.join(dir, 'oh-package.json'))) {
        libraryDir = dir;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!fs.existsSync(libraryDir) && entryFile) libraryDir = path.dirname(entryFile);
  }

  const libSourceFiles = [];
  function collectLibFiles(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'oh_modules' || entry.name === 'build') continue;
        collectLibFiles(fullPath);
      } else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.ets') || entry.name.endsWith('.ts')) {
        libSourceFiles.push(fullPath);
      }
    }
  }
  collectLibFiles(libraryDir);

  const virtualPaths = new Map();
  const allSourceFiles = [...libSourceFiles, ...testFiles];
  for (const realPath of allSourceFiles) {
    let virtualPath = realPath.endsWith('.ets') ? realPath.replace(/\.ets$/, '.ts') : realPath;
    virtualPath = toPosix(virtualPath);
    virtualPaths.set(virtualPath, realPath);
  }

  const fileContents = {};
  for (const [vPath, rPath] of virtualPaths) {
    let content = fs.readFileSync(rPath, 'utf-8');
    if (rPath.endsWith('.ets')) content = content.replace(/\b(struct)\s+(\w+)/g, 'class $2');
    fileContents[vPath] = content;
  }

  const compilerOptions = {
    target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.ESNext,
    strict: false, skipLibCheck: true, noEmit: true,
    allowSyntheticDefaultImports: true, esModuleInterop: true,
  };

  const host = {
    getSourceFile: function(fileName, languageVersion) {
      const content = fileContents[fileName] || fileContents[toPosix(fileName)];
      if (content) return ts.createSourceFile(fileName, content, languageVersion, true, ts.ScriptKind.TS);
      if (!fileName.endsWith('.ets')) {
        try { const c = ts.sys.readFile(fileName); if (c !== undefined) return ts.createSourceFile(fileName, c, languageVersion, true); } catch (e) {}
      }
      return undefined;
    },
    getDefaultLibFileName: function() { return ts.getDefaultLibFilePath(compilerOptions); },
    writeFile: function() {},
    getCurrentDirectory: function() { return process.cwd(); },
    getCanonicalFileName: function(fileName) { return fileName; },
    useCaseSensitiveFileNames: function() { return true; },
    getNewLine: function() { return '\n'; },
    fileExists: function(fileName) { return !!fileContents[fileName] || !!fileContents[toPosix(fileName)] || ts.sys.fileExists(fileName); },
    readFile: function(fileName) { return fileContents[fileName] || fileContents[toPosix(fileName)] || ts.sys.readFile(fileName); },
    resolveModuleNames: function(moduleNames, containingFile) {
      const resolved = [];
      for (const moduleName of moduleNames) {
        let resolvedPath = null;
        const baseDir = path.dirname(containingFile);
        if (moduleName.startsWith('.')) {
          for (const c of [path.resolve(baseDir, moduleName + '.ts'), path.resolve(baseDir, moduleName + '.d.ts'), path.resolve(baseDir, moduleName, 'Index.ts'), path.resolve(baseDir, moduleName, 'Index.d.ts')]) {
            const pc = toPosix(c);
            if (fileContents[pc] || ts.sys.fileExists(c)) { resolvedPath = pc; break; }
          }
        }
        if (moduleName.endsWith('.so') && !resolvedPath) {
          const soName = moduleName.replace(/\.so$/, '');
          for (const sf of libSourceFiles) {
            if (sf.includes('types/' + soName + '/Index.d.ts') || sf.includes('types/' + soName.replace(/-/g, '_') + '/Index.d.ts')) { resolvedPath = toPosix(sf); break; }
          }
        }
        if (moduleName === libName && !resolvedPath) {
          const indexEts = entryFile || path.join(libraryDir, 'Index.ets');
          const indexVirtual = toPosix(indexEts.replace(/\.ets$/, '.ts'));
          if (fileContents[indexVirtual]) resolvedPath = indexVirtual;
        }
        resolved.push(resolvedPath ? { resolvedFileName: resolvedPath, extension: '.ts' } : undefined);
      }
      return resolved;
    },
  };

  const program = ts.createProgram(Array.from(virtualPaths.keys()), compilerOptions, host);
  const checker = program.getTypeChecker();

  const fileCoverageMap = {};
  for (const testFile of testFiles) {
    const virtualTestPath = toPosix(testFile.replace(/\.ets$/, '.ts'));
    const sourceFile = program.getSourceFile(virtualTestPath);
    if (!sourceFile) continue;
    const fileName = path.basename(testFile);
    const importedSymbols = extractImportedSymbolsAST(sourceFile, libName);
    if (importedSymbols.size === 0) continue;
    const varMap = trackInstanceVariablesAST(sourceFile, checker, importedSymbols);
    const fileCovered = collectCoverageAST(sourceFile, checker, interfaces, importedSymbols, varMap);
    fileCoverageMap[fileName] = { count: fileCovered.size, interfaces: Array.from(fileCovered) };
  }

  return aggregateResults(interfaces, fileCoverageMap, {}, libName, testFiles.length);
}

// ════════════════════════════════════════════════════════════
// Part C: 结果聚合
// ════════════════════════════════════════════════════════════

function aggregateResults(interfaces, fileCoverageMap, classCoverageMap, libName, demoFileCount) {
  const coveredSet = new Set();
  for (const fc of Object.values(fileCoverageMap)) {
    for (const intf of fc.interfaces) coveredSet.add(intf);
  }

  const covered = [];
  const uncovered = [];

  for (const iface of interfaces) {
    const className = iface.className || '';
    if (!classCoverageMap[className]) classCoverageMap[className] = { total: 0, covered: 0 };
    classCoverageMap[className].total++;
    if (coveredSet.has(iface.fullName)) {
      classCoverageMap[className].covered++;
      covered.push({
        ...iface,
        files: Object.entries(fileCoverageMap)
          .filter(([_, fc]) => fc.interfaces.includes(iface.fullName))
          .map(([fn]) => fn)
      });
    } else {
      uncovered.push(iface);
    }
  }

  const N = interfaces.length;
  const M = coveredSet.size;
  const X = N > 0 ? (M / N * 100).toFixed(2) : '0.00';

  const byKind = {};
  const kindNames = ['method', 'constructor', 'property', 'field', 'enumValue', 'function', 'variable'];
  for (const kind of kindNames) {
    const kindInterfaces = interfaces.filter(i => i.kind === kind);
    const kindCovered = kindInterfaces.filter(i => coveredSet.has(i.fullName));
    byKind[kind] = {
      total: kindInterfaces.length,
      covered: kindCovered.length,
      rate: kindInterfaces.length > 0 ? (kindCovered.length / kindInterfaces.length * 100).toFixed(2) : '-'
    };
  }

  const classCoverage = [];
  for (const [className, data] of Object.entries(classCoverageMap)) {
    if (className === '') continue;
    classCoverage.push({
      className, total: data.total, covered: data.covered,
      uncovered: data.total - data.covered,
      rate: data.total > 0 ? (data.covered / data.total * 100).toFixed(2) : '-'
    });
  }

  const S = Object.keys(classCoverageMap).filter(k => k !== '').length;

  return {
    libraryName: libName,
    totalInterfacesClassLevel: S,
    totalInterfacesMethodLevel: N,
    coveredMethodCount: M,
    coverageRateMethodLevel: X,
    byKind,
    classCoverage,
    covered,
    uncovered,
    fileCoverage: Object.entries(fileCoverageMap).map(([file, data]) => ({
      file, count: data.count, interfaces: data.interfaces
    })),
    demoFileCount,
  };
}

// ════════════════════════════════════════════════════════════
// Part D: Markdown 渲染
// ════════════════════════════════════════════════════════════

function renderHeader(result, title) {
  const lines = [];
  lines.push(`# ${title || result.libraryName + ' 覆盖率分析报告'}`);
  lines.push('');
  lines.push('> 本报告由 `analyze-coverage.cjs` 自动生成。');
  lines.push('');
  lines.push('## 基本信息');
  lines.push('');
  lines.push('| 属性 | 值 |');
  lines.push('|------|----|');
  lines.push(`| 库名 | \`${result.libraryName}\` |`);
  lines.push(`| 源文件数 | ${result.demoFileCount || '-'} |`);
  lines.push(`| 生成时间 | ${new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').replace('Z', '+08:00')} |`);
  lines.push('');
  return lines.join('\n');
}

function renderOverview(result) {
  const lines = [];
  lines.push('## 覆盖率总览');
  lines.push('');
  const rate = parseFloat(result.coverageRateMethodLevel) || 0;
  lines.push(`### 方法级覆盖率: ${result.coverageRateMethodLevel}% (${coverageBadge(result.coverageRateMethodLevel)})`);
  lines.push('');
  lines.push('| 统计项 | 数量 |');
  lines.push('|--------|------|');
  lines.push(`| 类/接口总数 (S) | ${result.totalInterfacesClassLevel} |`);
  lines.push(`| 方法/属性总数 (N) | ${result.totalInterfacesMethodLevel} |`);
  lines.push(`| 已覆盖 (M) | ${result.coveredMethodCount} |`);
  lines.push(`| 未覆盖 | ${result.totalInterfacesMethodLevel - result.coveredMethodCount} |`);
  lines.push('');

  const filled = Math.round(rate / 5);
  const empty = 20 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  lines.push('```');
  lines.push(`覆盖率进度: [${bar}] ${rate.toFixed(2)}%`);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function renderByKind(result) {
  const lines = [];
  lines.push('### 按接口类型统计');
  lines.push('');
  lines.push('| 类型 | 总数 | 已覆盖 | 覆盖率 | 状态 |');
  lines.push('|------|------|--------|--------|------|');
  const byKind = result.byKind || {};
  for (const [kind, data] of Object.entries(byKind)) {
    const badge = coverageBadge(data.rate);
    lines.push(`| ${kind} | ${data.total} | ${data.covered} | ${data.rate}% | ${badge} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderClassCoverage(result) {
  const lines = [];
  lines.push('## 类级覆盖率');
  lines.push('');
  lines.push('| # | 类名 | 总数 | 已覆盖 | 未覆盖 | 覆盖率 | 状态 |');
  lines.push('|---|------|------|--------|--------|--------|------|');

  const classCoverage = result.classCoverage || [];
  const sorted = [...classCoverage].sort((a, b) => {
    const ra = parseFloat(a.rate) || 0;
    const rb = parseFloat(b.rate) || 0;
    return ra - rb;
  });

  sorted.forEach((cls, i) => {
    const badge = coverageBadge(cls.rate);
    lines.push(`| ${i + 1} | \`${cls.className}\` | ${cls.total} | ${cls.covered} | ${cls.uncovered} | ${cls.rate}% | ${badge} |`);
  });
  lines.push('');
  return lines.join('\n');
}

function renderFileCoverage(result) {
  const lines = [];
  lines.push('## 文件覆盖详情');
  lines.push('');
  lines.push('| # | 文件 | 覆盖接口数 | 覆盖的接口 |');
  lines.push('|---|------|-----------|-----------|');

  const fileCoverage = result.fileCoverage || [];
  const sorted = [...fileCoverage].sort((a, b) => b.count - a.count);

  sorted.forEach((fc, i) => {
    const ifaces = fc.interfaces.slice(0, 10).map(i => `\`${i}\``).join(', ');
    const more = fc.interfaces.length > 10 ? ` ... (+${fc.interfaces.length - 10})` : '';
    lines.push(`| ${i + 1} | \`${fc.file}\` | ${fc.count} | ${ifaces}${more} |`);
  });
  lines.push('');
  return lines.join('\n');
}

function renderCoveredDetails(result) {
  const lines = [];
  lines.push('## 已覆盖接口详情');
  lines.push('');
  const covered = result.covered || [];
  if (covered.length === 0) {
    lines.push('*暂无已覆盖接口*');
    lines.push('');
    return lines.join('\n');
  }

  const grouped = {};
  for (const c of covered) {
    const cn = c.className || '(顶层)';
    if (!grouped[cn]) grouped[cn] = [];
    grouped[cn].push(c);
  }

  let sectionIdx = 0;
  for (const [className, members] of Object.entries(grouped)) {
    sectionIdx++;
    lines.push(`### ${sectionIdx}. ${className}`);
    lines.push('');
    lines.push('| # | 接口 | 类型 | 静态 | 签名 | 覆盖文件 |');
    lines.push('|---|------|------|------|------|----------|');
    members.forEach((m, i) => {
      const files = (m.files || []).slice(0, 3).map(f => `\`${f}\``).join(', ');
      const more = m.files && m.files.length > 3 ? ` +${m.files.length - 3}` : '';
      lines.push(`| ${i + 1} | \`${m.memberName}\` | ${m.kind} | ${m.isStatic ? '是' : '否'} | \`${escapeMd(m.signature)}\` | ${files}${more} |`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

function renderUncoveredDetails(result) {
  const lines = [];
  lines.push('## 未覆盖接口详情');
  lines.push('');
  const uncovered = result.uncovered || [];
  if (uncovered.length === 0) {
    lines.push('*所有接口均已覆盖！*');
    lines.push('');
    return lines.join('\n');
  }

  const grouped = {};
  for (const u of uncovered) {
    const cn = u.className || '(顶层)';
    if (!grouped[cn]) grouped[cn] = [];
    grouped[cn].push(u);
  }

  let sectionIdx = 0;
  for (const [className, members] of Object.entries(grouped)) {
    sectionIdx++;
    lines.push(`### ${sectionIdx}. ${className} (${members.length} 个未覆盖)`);
    lines.push('');
    lines.push('| # | 接口 | 类型 | 静态 | 参数 | 返回类型 | 说明 |');
    lines.push('|---|------|------|------|------|----------|------|');
    members.forEach((m, i) => {
      lines.push(`| ${i + 1} | \`${m.memberName}\` | ${m.kind} | ${m.isStatic ? '是' : '否'} | ${escapeMd(formatParams(m.params))} | ${escapeMd(m.returnType)} | ${escapeMd(m.description)} |`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

function renderRecommendations(result) {
  const lines = [];
  lines.push('## 覆盖率提升建议');
  lines.push('');

  const uncovered = result.uncovered || [];
  const rate = parseFloat(result.coverageRateMethodLevel) || 0;

  if (rate >= 80) {
    lines.push('覆盖率优秀！以下接口仍可补充测试：');
  } else if (rate >= 50) {
    lines.push('覆盖率中等，建议优先补充以下接口的测试：');
  } else {
    lines.push('覆盖率较低，强烈建议补充以下接口的测试：');
  }
  lines.push('');

  const priority = uncovered.sort((a, b) => {
    const kindOrder = { 'method': 0, 'property': 1, 'field': 2, 'function': 3, 'variable': 4, 'enumValue': 5 };
    const ka = kindOrder[a.kind] !== undefined ? kindOrder[a.kind] : 99;
    const kb = kindOrder[b.kind] !== undefined ? kindOrder[b.kind] : 99;
    if (ka !== kb) return ka - kb;
    return (a.className || '').localeCompare(b.className || '');
  });

  const top = priority.slice(0, 20);
  top.forEach((u, i) => {
    const cn = u.className ? `\`${u.className}.\`` : '';
    lines.push(`${i + 1}. [ ] ${cn}\`${u.memberName}\` — ${u.kind}${u.isStatic ? ' (静态)' : ''}${formatParams(u.params) ? ` (${formatParams(u.params)})` : ''}`);
  });
  if (priority.length > 20) {
    lines.push(`- ... 还有 ${priority.length - 20} 个未覆盖接口，详见上方表格`);
  }
  lines.push('');
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════
// Part E: 入口 — XTS 覆盖率匹配 + 渲染
// ════════════════════════════════════════════════════════════

const args = parseArgs();
const specPath = args.spec;
const mode = args.mode || 'auto';
const title = args.title;

if (!specPath && !args.libroot && !args.repoDir) {
  console.error('用法: node analyze-xts-coverage.cjs --spec <interface-spec.json> --libroot <库根目录> [--output <report.md>] [--title <标题>] [--mode auto|ast|regex]');
  console.error('  或: node analyze-xts-coverage.cjs --libroot <库根目录> [--output <report.md>] [--mode auto|ast|regex]');
  process.exit(1);
}

const libRoot = args.libroot || args.repoDir || (specPath ? path.dirname(specPath) : '');

// 获取接口规格数据
let specData;
let specBasename;
if (specPath) {
  specData = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  specBasename = path.basename(specPath, '-interface-spec.json');
  console.log(`[XTS 覆盖率分析]`);
  console.log(`接口规格: ${specPath} (${specData.interfaces ? specData.interfaces.length : 0} 个接口)`);
} else {
  console.log(`[XTS 覆盖率分析]`);
  console.log(`从源码目录提取接口: ${libRoot}`);
  specData = generateSpec(libRoot);
  specBasename = specData.libraryName ? specData.libraryName.replace(/^@[^/]+\//, '') : path.basename(libRoot);
  console.log(`提取完成: ${specData.interfaces ? specData.interfaces.length : 0} 个接口, 库名: ${specData.libraryName}`);
}

// XTS 源码目录固定为 <libroot>/entry/src/ohosTest
const srcDir = args.src || path.join(libRoot, 'entry', 'src', 'ohosTest');
const libName = args.lib || '';

// 输出路径默认取 spec 同目录下的 03-xxx-XTS覆盖率报告.md
const outputPath = args.output || path.join(path.dirname(specPath || __dirname), `03-${specBasename}-XTS覆盖率报告.md`);

const interfaces = specData.interfaces || [];
const resolvedLibName = libName || specData.libraryName || specBasename;

console.log(`库名: ${resolvedLibName}`);
console.log(`XTS 源码目录: ${srcDir}`);

if (!fs.existsSync(srcDir)) {
  console.error(`XTS 源码目录不存在: ${srcDir}`);
  process.exit(1);
}

// 扫描 XTS 源文件
const testFiles = walkDir(srcDir, EXCLUDE_TOP_DIRS, srcDir);
console.log(`扫描到 ${testFiles.length} 个 .ets/.ts 文件`);

// 执行匹配
let result = null;

if (mode === 'ast' || (mode === 'auto' && ts)) {
  console.log('使用 AST 模式匹配...');
  result = matchCoverageAST(interfaces, testFiles, resolvedLibName, libRoot);
  if (!result && mode === 'auto') {
    console.warn('AST 模式失败，降级到正则模式...');
  }
}

if (!result) {
  console.log('使用正则模式匹配...');
  result = matchCoverageRegex(interfaces, testFiles, resolvedLibName);
}

result.specSummary = specData.summary;

console.log(`XTS 匹配完成: ${result.coveredMethodCount}/${result.totalInterfacesMethodLevel} (${result.coverageRateMethodLevel}%)`);

// 渲染 Markdown
const resolvedTitle = title || `${resolvedLibName} XTS 覆盖率分析报告`;
const parts = [];
parts.push(renderHeader(result, resolvedTitle));
parts.push(renderOverview(result));
parts.push(renderByKind(result));
parts.push(renderClassCoverage(result));
parts.push(renderUncoveredDetails(result));
parts.push(renderCoveredDetails(result));
parts.push(renderFileCoverage(result));

const markdown = parts.join('\n---\n\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, markdown, 'utf-8');
console.log(`XTS 报告渲染完成: ${outputPath}`);
