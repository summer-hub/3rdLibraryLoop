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
  const importRegex = /import\s*\{([^}]*?)\}\s*from\s*['"]([^'"]+)['"]/gs;
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

function trackInstanceVariables(content, importedSymbols) {
  const varMap = {};
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
  return varMap;
}

function matchCoverage(interfaces, files, libName) {
  const covered = [];
  const uncovered = [];
  const classCoverageMap = {};
  const fileCoverageMap = {};
  const multiLineImportFiles = [];
  const demoFileCount = files.length;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const importedSymbols = extractImports(content, libName);

    if (importedSymbols.length === 0) continue;

    if (/import\s*\{[^}]*\n[^}]*\}\s*from\s*['"]@ohos\/fastble['"]/s.test(content)) {
      multiLineImportFiles.push(fileName);
    }

    const varMap = trackInstanceVariables(content, importedSymbols);
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
    // 对于未通过 import+方法调用匹配到的属性/字段，检测是否作为对象字面量 key 使用。
    // ArkTS 声明式 UI 中配置项常以对象字面量形式出现（如 ImageKnifeOption({ loadSrc: ... })），
    // 这种情况下不需要 import 对应的类，因此前序匹配会漏掉，此处兜底。
    for (const iface of interfaces) {
      if ((iface.kind === 'property' || iface.kind === 'field') && !fileCovered.includes(iface.fullName)) {
        if (iface.memberName && iface.memberName.length >= 2) {
          // 匹配对象字面量 key: `  loadSrc:`, `  placeholderSrc?:`, `  writeCacheStrategy:`
          const objLitRegex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\??\\s*:`, 'g');
          if (objLitRegex.test(content)) {
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

const EXCLUDE_TOP_DIRS = ['entryability', 'entrybackupability', 'model', 'util'];

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
