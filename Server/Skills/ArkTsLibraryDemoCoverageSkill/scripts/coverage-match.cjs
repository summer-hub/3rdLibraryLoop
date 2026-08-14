const fs = require('fs');
const path = require('path');

/** 转义正则特殊字符 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      parsed[key] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

/** 测试目录黑名单：任意层级命中即跳过（demo 统计不得混入测试代码） */
const TEST_DIR_NAMES = new Set(['ohosTest', 'test', 'tests', '__tests__', 'testability']);

function walkDir(dir, ext, excludeTopDirs, srcRoot) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const relDir = path.relative(srcRoot, dir);
  const topDir = relDir.split(path.sep)[0] || '';
  if (relDir !== '' && excludeTopDirs.includes(topDir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 任意层级的测试目录均跳过，防止 AI 误扩 --src 范围时混入测试文件
      if (TEST_DIR_NAMES.has(entry.name)) continue;
      results = results.concat(walkDir(fullPath, ext, excludeTopDirs, srcRoot));
    } else if (entry.isFile()) {
      if (ext.includes(path.extname(entry.name))) {
        const relPath = path.relative(srcRoot, fullPath);
        const depth = relPath.split(path.sep).length;
        if (depth === 1 && entry.name === 'Index.ets') continue;
        results.push(fullPath);
      }
    }
  }
  return results;
}

function extractImports(content, libName) {
  const importedSymbols = [];
  // 支持单行/多行 import，包含：
  //   import { A } from 'lib'
  //   import A, { B } from 'lib'          （默认导出 + 具名导出混合）
  //   import type { A } from 'lib'        （类型导入，不产生运行时符号）
  //   import * as Lib from 'lib'          （命名空间导入，返回空符号列表）
  const importRegex = /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*?)\}\s*from\s*['"]([^'"]+)['"]/gs;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const symbolsStr = match[1];
    const fromLib = match[2];
    if (fromLib === libName || fromLib.endsWith('/' + libName.split('/').pop())) {
      const symbols = symbolsStr.split(',').map(s => {
        const trimmed = s.trim().replace(/\n/g, '').replace(/\s+/g, ' ');
        const aliasMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
        if (aliasMatch) {
          return { name: aliasMatch[1], alias: aliasMatch[2] };
        }
        return { name: trimmed, alias: trimmed };
      }).filter(s => s.name.length > 0);
      importedSymbols.push(...symbols);
    }
  }
  return importedSymbols;
}

/** 检测纯默认导入：import defaultName from 'lib'（无 { ... } 具名部分）。
 *  返回默认别名（如 'webrtc'）或 null。用于处理 `export default webrtc` 模式的库，
 *  其 demo 通过 `webrtc.ClassName.method()` 命名空间前缀访问所有导出类。 */
function extractDefaultImport(content, libName) {
  const libSuffix = libName.split('/').pop();
  // 纯默认导入：import defaultName from 'lib'（不包含 { ... }）
  const defaultRegex = new RegExp(
    `import\\s+(?:type\\s+)?([A-Za-z_$][\\w$]*)\\s+from\\s+['"](?:${escapeRegex(libName)}|[^'"]*${escapeRegex(libSuffix)})['"]`,
    'g'
  );
  let match;
  while ((match = defaultRegex.exec(content)) !== null) {
    // 排除 "import defaultName, { ... } from" 混合导入（已由 extractImports 处理）
    const afterMatch = content.slice(match.index + match[0].length);
    if (!/^\s*,\s*\{/.test(afterMatch)) {
      return match[1];
    }
  }
  return null;
}

function trackInstanceVariables(content, importedSymbols, defaultAlias, allClassNames) {
  const varMap = {};
  const classSet = new Set(allClassNames);
  const prefixes = [];
  // 命名导入的类名作为前缀
  for (const sym of importedSymbols) {
    prefixes.push({ prefix: sym.alias, isNamespace: false });
  }
  // 默认导入作为命名空间前缀（如 webrtc.ClassName）
  if (defaultAlias) {
    prefixes.push({ prefix: defaultAlias, isNamespace: true });
  }

  for (const { prefix: prefix, isNamespace: isNamespace } of prefixes) {
    // 构造匹配该前缀下的 className 的正则
    const classGroup = isNamespace
      ? `(${[...classSet].map(escapeRegex).join('|')})`
      : escapeRegex(prefix);
    const accessPrefix = isNamespace ? `${escapeRegex(prefix)}\\s*\\.\\s*` : '';

    if (isNamespace) {
      // 命名空间模式：webrtc.ClassName.getInstance() / webrtc.ClassName.anyStatic()
      // 追踪 varName = webrtc.ClassName.someMethod( → 假设 varName 为 ClassName 实例
      const nsFactoryRegex = new RegExp(
        `(?:let|const|var)\\s+(\\w+)\\s*=\\s*${escapeRegex(prefix)}\\s*\\.\\s*(${[...classSet].map(escapeRegex).join('|')})\\s*\\.\\s*\\w+\\s*\\(`,
        'g'
      );
      let m;
      while ((m = nsFactoryRegex.exec(content)) !== null) {
        const varName = m[1];
        const cls = m[2];
        if (varName && !varMap[varName]) varMap[varName] = [];
        if (varName && !varMap[varName].includes(cls)) varMap[varName].push(cls);
      }
      // 命名空间模式：varName = new webrtc.ClassName( → 追踪为 ClassName 实例
      const nsNewRegex = new RegExp(
        `(?:let|const|var)\\s+(\\w+)\\s*=\\s*new\\s+${escapeRegex(prefix)}\\s*\\.\\s*(${[...classSet].map(escapeRegex).join('|')})\\s*\\(`,
        'g'
      );
      while ((m = nsNewRegex.exec(content)) !== null) {
        const varName = m[1];
        const cls = m[2];
        if (varName && !varMap[varName]) varMap[varName] = [];
        if (varName && !varMap[varName].includes(cls)) varMap[varName].push(cls);
      }
      // 命名空间类型标注：varName: webrtc.ClassName = ...
      const nsTypeRegex = new RegExp(
        `(?:let|const|var)\\s+(\\w+)\\s*:\\s*${escapeRegex(prefix)}\\s*\\.\\s*(${[...classSet].map(escapeRegex).join('|')})\\b`,
        'g'
      );
      while ((m = nsTypeRegex.exec(content)) !== null) {
        const varName = m[1];
        const cls = m[2];
        if (varName && !varMap[varName]) varMap[varName] = [];
        if (varName && !varMap[varName].includes(cls)) varMap[varName].push(cls);
      }
    } else {
      // 命名导入模式（原有逻辑）
      const className = prefix;
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
  }
  return varMap;
}

function matchCoverage(interfaces, files, libName) {
  const covered = [];
  const uncovered = [];
  const classCoverageMap = {};
  const fileCoverageMap = {};
  const multiLineImportFiles = [];
  const demoFileCount = files.length;
  const allClassNames = [...new Set(interfaces.map(i => i.className).filter(n => n !== null))];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const importedSymbols = extractImports(content, libName);
    const defaultAlias = extractDefaultImport(content, libName);

    if (importedSymbols.length === 0 && !defaultAlias) continue;

    const multiLineLibRegex = new RegExp(
      `import\\s*\\{[^}]*\\n[^}]*\\}\\s*from\\s*['"]${escapeRegex(libName)}['"]`,
      's'
    );
    if (multiLineLibRegex.test(content)) {
      multiLineImportFiles.push(fileName);
    }

    const varMap = trackInstanceVariables(content, importedSymbols, defaultAlias, allClassNames);
    const fileCovered = [];

    for (const iface of interfaces) {
      if (iface.className === null) {
        if (iface.kind === 'function') {
          const regex = new RegExp(`\\b${iface.memberName}\\s*\\(`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        } else if (iface.kind === 'variable') {
          const regex = new RegExp(`\\b${iface.memberName}\\b`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        }
        continue;
      }

      const classNameUsed = importedSymbols.find(s => s.name === iface.className || s.alias === iface.className);

      // ── 命名空间前缀匹配（默认导入模式） ──
      // 当 demo 使用 `import webrtc from '@ohos/webrtc'` 后通过 `webrtc.ClassName.xxx` 访问
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
          // 非静态成员：检测命名空间下的实例方法/属性调用
          // 如 webrtc.PeerConnectionFactory.createPeerConnection() 直接在类上调用
          if (iface.kind === 'method') {
            const nsInstMethod = new RegExp(`${ns}\\s*\\.\\s*${cls}\\s*\\.\\s*${mem}\\s*\\(`, 'g');
            if (nsInstMethod.test(content)) { fileCovered.push(iface.fullName); continue; }
          } else if (iface.kind === 'property') {
            const nsInstProp = new RegExp(`${ns}\\s*\\.\\s*${cls}\\s*\\.\\s*${mem}\\b`, 'g');
            if (nsInstProp.test(content)) { fileCovered.push(iface.fullName); continue; }
          }
        }
        // 命名空间下的构造函数（用于实例方法变量追踪）
        if (iface.kind === 'method' || iface.kind === 'property') {
          // 变量已由 trackInstanceVariables 追踪（来自 new ns.Class 或 ns.Class.factory()）
          for (const [varName, classNames] of Object.entries(varMap)) {
            if (classNames.includes(iface.className)) {
              if (iface.kind === 'method') {
                const instRegex = new RegExp(`(?:this\\s*\\.\\s*)?${varName}\\s*\\.\\s*${mem}\\s*\\(`, 'g');
                if (instRegex.test(content)) { fileCovered.push(iface.fullName); break; }
              } else if (iface.kind === 'property') {
                const instRegex = new RegExp(`(?:this\\s*\\.\\s*)?${varName}\\s*\\.\\s*${mem}\\b`, 'g');
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
        const regex = new RegExp(`${ca}\\s*\\.\\s*${iface.memberName}\\b`, 'g');
        if (regex.test(content)) fileCovered.push(iface.fullName);
        continue;
      }

      if (iface.isStatic) {
        if (iface.kind === 'method') {
          const regex = new RegExp(`${ca}\\s*\\.\\s*${iface.memberName}\\s*\\(`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        } else if (iface.kind === 'property') {
          const regex = new RegExp(`${ca}\\s*\\.\\s*${iface.memberName}\\b`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        }
        continue;
      }

      if (iface.kind === 'constructor') {
        const regex = new RegExp(`new\\s+${ca}\\s*\\(`, 'g');
        if (regex.test(content)) fileCovered.push(iface.fullName);
        continue;
      }

      if (iface.kind === 'method' || iface.kind === 'property') {
        const chainRegex = new RegExp(
          `${ca}\\s*\\.\\s*getInstance\\s*\\(\\s*\\)[\\s\\S]*?\\.\\s*${iface.memberName}\\s*\\(`,
          'g'
        );
        if (chainRegex.test(content)) {
          fileCovered.push(iface.fullName);
          continue;
        }

        for (const [varName, classNames] of Object.entries(varMap)) {
          if (classNames.includes(ca)) {
            if (iface.kind === 'method') {
              const instRegex = new RegExp(`(?:this\\s*\\.\\s*)?${varName}\\s*\\.\\s*${iface.memberName}\\s*\\(`, 'g');
              if (instRegex.test(content)) {
                fileCovered.push(iface.fullName);
                break;
              }
            } else if (iface.kind === 'property') {
              const instRegex = new RegExp(`(?:this\\s*\\.\\s*)?${varName}\\s*\\.\\s*${iface.memberName}\\b`, 'g');
              if (instRegex.test(content)) {
                fileCovered.push(iface.fullName);
                break;
              }
            }
          }
        }

        const directRegex = new RegExp(`${ca}\\s*\\.\\s*${iface.memberName}\\s*\\(`, 'g');
        if (directRegex.test(content)) {
          fileCovered.push(iface.fullName);
          continue;
        }
      }

      if (iface.kind === 'field') {
        const regex = new RegExp(`\\b${iface.memberName}\\b`, 'g');
        if (regex.test(content)) fileCovered.push(iface.fullName);
        continue;
      }
    }

    // ── 对象字面量属性检测（补充） ──
    // 对于未通过 import+方法调用匹配到的属性/字段/接口方法，检测是否作为对象字面量 key 使用。
    // ArkTS 声明式 UI 中配置项常以对象字面量形式出现（如 ImageKnifeOption({ loadSrc: ... })），
    // 这种情况下不需要 import 对应的类，因此前序匹配会漏掉，此处兜底。
    // 接口方法（如 Loggable.logMessage）也可能以对象字面量 key 形式实现（回调模式），一并检测。
    for (const iface of interfaces) {
      if ((iface.kind === 'property' || iface.kind === 'field' || iface.kind === 'method') && !fileCovered.includes(iface.fullName)) {
        if (iface.memberName && iface.memberName.length >= 2) {
          // 匹配对象字面量 key: `  loadSrc:`, `  placeholderSrc?:`, `  writeCacheStrategy:`, `  logMessage:`
          const objLitRegex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\??\\s*:`, 'g');
          if (objLitRegex.test(content)) {
            fileCovered.push(iface.fullName);
          }
        }
      }
    }

    // ── 默认导入命名空间的宽松实例方法/属性/字段兜底匹配 ──
    // 当 demo 使用 `import webrtc from '@ohos/webrtc'` 且通过返回值链式调用
    // （如 `const pc = pcf.createPeerConnection(); pc.createDataChannel()`），
    // 上述严格匹配可能遗漏。此兜底在文件含默认导入时，对每个未覆盖的 instance method/property/field
    // 检查 `.memberName(` 或 `.memberName` 是否出现。仅对 webrtc 接口列表中存在的 memberName 生效，
    // 故不会与非 webrtc API 冲突。
    if (defaultAlias) {
      for (const iface of interfaces) {
        if (fileCovered.includes(iface.fullName)) continue;
        if (!iface.className) continue;
        if (iface.isStatic) continue; // 静态成员已在上方严格匹配
        const mem = escapeRegex(iface.memberName);
        if (iface.kind === 'method') {
          const looseMethodRegex = new RegExp(`\\.${mem}\\s*\\(`, 'g');
          if (looseMethodRegex.test(content)) {
            fileCovered.push(iface.fullName);
          }
        } else if (iface.kind === 'property' || iface.kind === 'field') {
          const loosePropRegex = new RegExp(`\\.${mem}\\b`, 'g');
          if (loosePropRegex.test(content)) {
            fileCovered.push(iface.fullName);
          }
        }
      }
    }

    for (const fullName of fileCovered) {
      if (!fileCoverageMap[fileName]) {
        fileCoverageMap[fileName] = { count: 0, interfaces: [] };
      }
      fileCoverageMap[fileName].count++;
      fileCoverageMap[fileName].interfaces.push(fullName);
    }
  }

  const coveredSet = new Set();
  for (const fc of Object.values(fileCoverageMap)) {
    for (const intf of fc.interfaces) {
      coveredSet.add(intf);
    }
  }

  for (const iface of interfaces) {
    const className = iface.className || '';
    if (!classCoverageMap[className]) {
      classCoverageMap[className] = { total: 0, covered: 0 };
    }
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

  const totalInterfacesMethodLevel = interfaces.length;
  const coveredMethodCount = coveredSet.size;
  const coverageRateMethodLevel = totalInterfacesMethodLevel > 0
    ? (coveredMethodCount / totalInterfacesMethodLevel * 100).toFixed(2)
    : '0.00';

  const byKind = {};
  const kindNames = ['method', 'constructor', 'property', 'field', 'enumValue', 'function', 'variable'];
  for (const kind of kindNames) {
    const kindInterfaces = interfaces.filter(i => i.kind === kind);
    const kindCovered = kindInterfaces.filter(i => coveredSet.has(i.fullName));
    byKind[kind] = {
      total: kindInterfaces.length,
      covered: kindCovered.length,
      rate: kindInterfaces.length > 0
        ? (kindCovered.length / kindInterfaces.length * 100).toFixed(2)
        : '-'
    };
  }

  const classCoverage = [];
  for (const [className, data] of Object.entries(classCoverageMap)) {
    if (className === '') continue;
    classCoverage.push({
      className,
      total: data.total,
      covered: data.covered,
      uncovered: data.total - data.covered,
      rate: data.total > 0 ? (data.covered / data.total * 100).toFixed(2) : '-'
    });
  }

  const totalInterfacesClassLevel = Object.keys(classCoverageMap).filter(k => k !== '').length;

  return {
    libraryName: libName,
    totalInterfacesClassLevel,
    totalInterfacesMethodLevel,
    coveredMethodCount,
    coverageRateMethodLevel,
    byKind,
    classCoverage,
    covered,
    uncovered,
    fileCoverage: Object.entries(fileCoverageMap).map(([file, data]) => ({
      file,
      count: data.count,
      interfaces: data.interfaces
    })),
    demoFileCount,
    multiLineImportFiles
  };
}

const EXCLUDE_TOP_DIRS = ['entryability', 'entrybackupability', 'model', 'util', 'ohosTest'];

const args = parseArgs();

if (!args.interfaces || !args.src || !args.lib || !args.output) {
  console.error('Usage: node coverage-match.cjs --interfaces <path> --src <path> --lib <name> --output <path>');
  process.exit(1);
}

const interfaces = JSON.parse(fs.readFileSync(args.interfaces, 'utf-8'));
const etsFiles = walkDir(args.src, ['.ets'], EXCLUDE_TOP_DIRS, args.src);

const result = matchCoverage(interfaces, etsFiles, args.lib);
fs.writeFileSync(args.output, JSON.stringify(result, null, 2), 'utf-8');

console.log(`Coverage analysis complete.`);
console.log(`Total interfaces (method level): ${result.totalInterfacesMethodLevel}`);
console.log(`Covered: ${result.coveredMethodCount}`);
console.log(`Coverage rate: ${result.coverageRateMethodLevel}%`);
console.log(`Demo files analyzed: ${result.demoFileCount}`);
