#!/usr/bin/env node
/**
 * @tool flutter_analyze_demo_coverage
 * @description 分析 Flutter 三方库的 Demo 覆盖率。从库源码提取接口规格，扫描 example/lib 下的 Demo 源码，执行正则覆盖率匹配，输出 Markdown 覆盖率报告。用于评估 Demo 对 Flutter 库 API 的覆盖程度。
 * @param libroot: string - 库根目录路径（包含 lib/ 和 example/ 子目录）
 * @param spec: string - 已有的 interface-spec.json 路径（可选，与 libroot 二选一）
 * @param output: string - 输出 Markdown 报告路径（可选，默认 02-xxx-Demo覆盖率报告.md）
 * @hidden
 * flutter-analyze-demo-coverage.cjs — Flutter Demo 覆盖率分析脚本
 *
 * 从库源码提取接口规格，针对 Demo 源码目录（example/lib/）执行正则覆盖率匹配，
 * 直接渲染输出 Markdown 覆盖率报告。
 *
 * 用法:
 *   方式一（读 JSON 中间件）:
 *     node flutter-analyze-demo-coverage.cjs --spec <interface-spec.json> --libroot <库根目录> \
 *       [--output <report.md>] [--title <标题>]
 *   方式二（直接从源码提取）:
 *     node flutter-analyze-demo-coverage.cjs --libroot <库根目录> \
 *       [--output <report.md>] [--title <标题>]
 *
 * 参数:
 *   --spec      interface-spec.json 路径
 *   --libroot   库根目录（Demo 源码默认取 <libroot>/example/lib）
 *   --output    输出 Markdown 报告路径，默认 02-xxx-Demo覆盖率报告.md
 *   --title     报告标题
 *   --lib       库名覆盖
 *
 * 使用示例:
 *   node flutter-analyze-demo-coverage.cjs --libroot /path/to/advertising_id --output 02-advertising_id-Demo覆盖率报告.md
 *   node flutter-analyze-demo-coverage.cjs --spec advertising_id-interface-spec.json --libroot /path/to/advertising_id
 */

const fs = require('fs');
const path = require('path');
const { generateSpec, detectMainPackage, parsePubspec } = require('./flutter-extract-interfaces.cjs');

// ── 参数解析 + 工具函数 ──────────────────────────────────────

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

// ── 文件扫描 ──────────────────────────────────────────────

const EXCLUDE_DIRS = ['.dart_tool', 'build', '.fvm', 'ios', 'android', 'ohos', 'macos', 'windows', 'web', 'linux'];

function walkDir(dir, excludeDirs) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excludeDirs.includes(entry.name)) {
        results.push(...walkDir(fullPath, excludeDirs));
      }
    } else if (entry.isFile() && entry.name.endsWith('.dart') && !entry.name.endsWith('.g.dart') && !entry.name.endsWith('.freezed.dart')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Demo 源码目录定位 ──────────────────────────────────────

function locateDemoDir(libRoot) {
  const mainPkgDir = detectMainPackage(libRoot);
  const candidates = [
    path.join(mainPkgDir, 'example', 'lib'),
    path.join(mainPkgDir, 'examples', 'lib'),
    path.join(mainPkgDir, 'demo', 'lib'),
    path.join(libRoot, 'example', 'lib'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getPackageName(libRoot) {
  const mainPkgDir = detectMainPackage(libRoot);
  return parsePubspec(mainPkgDir).name;
}

// ── 正则覆盖率匹配引擎 ──────────────────────────────────────

/**
 * 提取 import 语句中的导入符号
 * Dart import 语法:
 *   import 'package:pkg/file.dart';                        → 全部符号导入
 *   import 'package:pkg/file.dart' show ClassA, ClassB;   → 仅 ClassA, ClassB
 *   import 'package:pkg/file.dart' hide PrivateClass;     → 全部除 PrivateClass
 *   import 'package:pkg/file.dart' as alias;              → 命名空间导入
 */
function extractImports(content, packageName) {
  const imports = {
    direct: new Set(),      // 直接导入的符号（无前缀使用）
    aliased: new Map(),     // alias → 包名
    showList: null,         // show 列表
    hideList: new Set(),    // hide 列表
    hasImport: false,
  };

  // 匹配 import 'package:xxx/...' [show/hide/as ...]
  const importRegex = /^import\s+['"]package:([^/]+)\/[^'"]+['"](?:\s+(show|hide|as)\s+([\w,\s]+))?/gm;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    const pkgName = m[1];
    if (pkgName !== packageName && !pkgName.includes(packageName)) continue;
    imports.hasImport = true;

    if (m[2] === 'show') {
      const names = m[3].split(',').map(s => s.trim()).filter(Boolean);
      imports.showList = imports.showList || new Set();
      // 块体而非简写体：简写体隐含返回 Set.add() 的返回值，语义上具误导性
      names.forEach(n => { imports.showList.add(n); });
    } else if (m[2] === 'hide') {
      const names = m[3].split(',').map(s => s.trim()).filter(Boolean);
      names.forEach(n => { imports.hideList.add(n); });
    } else if (m[2] === 'as') {
      const alias = m[3].trim();
      imports.aliased.set(alias, pkgName);
    } else {
      // 无 show/hide/as，全部导入
      imports.direct.add('*');
    }
  }

  return imports;
}

/**
 * 追踪实例变量 → 类名映射
 * Dart:
 *   Type varName = ClassName(...)     → varMap['varName'] = 'ClassName'
 *   ClassName varName = ClassName(...)
 *   var varName = ClassName.named(...)
 *   final exif = FlutterExif.fromBytes(...)
 */
function trackInstanceVariables(content, importedClassNames) {
  const varMap = {};
  const classSet = new Set(importedClassNames);

  for (const className of classSet) {
    // var/final/const/Type name = ClassName(...)
    const patterns = [
      new RegExp(`(?:var|final|const)\\s+(\\w+)\\s*=\\s*${escapeRegex(className)}\\s*[.(]`, 'g'),
      new RegExp(`(?:var|final|const)\\s+(\\w+)\\s*=\\s*new\\s+${escapeRegex(className)}\\s*\\(`, 'g'),
      new RegExp(`${escapeRegex(className)}\\s+(\\w+)\\s*=\\s*${escapeRegex(className)}\\s*[.(]`, 'g'),
      new RegExp(`${escapeRegex(className)}\\s+(\\w+)\\s*=\\s*new\\s+${escapeRegex(className)}\\s*\\(`, 'g'),
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

  // 从类型注解追踪: Type name (参数声明、字段声明)
  for (const className of classSet) {
    const typePattern = new RegExp(`\\b${escapeRegex(className)}\\s+(\\w+)\\b`, 'g');
    let m;
    while ((m = typePattern.exec(content)) !== null) {
      const varName = m[1];
      // 排除关键字
      if (['extends', 'implements', 'with', 'class', 'enum', 'mixin', 'return', 'final', 'const', 'var', 'static', 'void', 'get', 'set', 'new', 'this', 'super'].includes(varName)) continue;
      if (varName && !varMap[varName]) varMap[varName] = [];
      if (varName && !varMap[varName].includes(className)) varMap[varName].push(className);
    }
  }

  return varMap;
}

/**
 * 正则覆盖率匹配核心
 */
function matchCoverage(interfaces, files, packageName) {
  const fileCoverageMap = {};
  const allClassNames = [...new Set(interfaces.map(i => i.className).filter(n => n !== null))];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.relative(path.dirname(filePath), filePath);
    const imports = extractImports(content, packageName);

    if (!imports.hasImport && imports.aliased.size === 0) continue;

    const varMap = trackInstanceVariables(content, allClassNames);
    const fileCovered = [];

    for (const iface of interfaces) {
      if (fileCovered.includes(iface.fullName)) continue;

      // 顶层函数/变量
      if (iface.className === null) {
        if (iface.kind === 'function') {
          const regex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\s*\\(`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        } else if (iface.kind === 'variable' || iface.kind === 'type') {
          const regex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\b`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        }
        continue;
      }

      const className = iface.className;
      const memberName = iface.memberName;

      // 1. 静态方法/属性: ClassName.memberName(
      if (iface.isStatic) {
        if (iface.kind === 'method' || iface.kind === 'constructor') {
          const regex = new RegExp(`${escapeRegex(className)}\\s*\\.\\s*${escapeRegex(memberName)}\\s*\\(`, 'g');
          if (regex.test(content)) { fileCovered.push(iface.fullName); continue; }
        } else if (iface.kind === 'property' || iface.kind === 'field') {
          const regex = new RegExp(`${escapeRegex(className)}\\s*\\.\\s*${escapeRegex(memberName)}\\b`, 'g');
          if (regex.test(content)) { fileCovered.push(iface.fullName); continue; }
        }
      }

      // 2. 构造函数: ClassName() 或 ClassName.named()
      if (iface.kind === 'constructor') {
        if (memberName === 'constructor') {
          const regex = new RegExp(`new\\s+${escapeRegex(className)}\\s*\\(`, 'g');
          if (regex.test(content)) { fileCovered.push(iface.fullName); continue; }
          const regex2 = new RegExp(`\\b${escapeRegex(className)}\\s*\\(`, 'g');
          if (regex2.test(content)) { fileCovered.push(iface.fullName); continue; }
        } else {
          const regex = new RegExp(`${escapeRegex(className)}\\s*\\.\\s*${escapeRegex(memberName)}\\s*\\(`, 'g');
          if (regex.test(content)) { fileCovered.push(iface.fullName); continue; }
        }
      }

      // 3. 枚举值: ClassName.valueName
      if (iface.kind === 'enumValue') {
        const regex = new RegExp(`${escapeRegex(className)}\\s*\\.\\s*${escapeRegex(memberName)}\\b`, 'g');
        if (regex.test(content)) { fileCovered.push(iface.fullName); continue; }
      }

      // 4. 实例方法/属性: varName.memberName
      if (iface.kind === 'method' || iface.kind === 'property') {
        // 对于 extension 方法，同时匹配 onType（extension 所扩展的类型）
        const matchClassNames = [className];
        if (iface.onType) matchClassNames.push(iface.onType);
        // 通过实例变量追踪
        for (const [varName, classNames] of Object.entries(varMap)) {
          if (matchClassNames.some(cn => classNames.includes(cn))) {
            if (iface.kind === 'method') {
              const regex = new RegExp(`${escapeRegex(varName)}\\s*(?:\\?\\.|\\.)\\s*${escapeRegex(memberName)}\\s*\\(`, 'g');
              if (regex.test(content)) { fileCovered.push(iface.fullName); break; }
            } else if (iface.kind === 'property') {
              const regex = new RegExp(`${escapeRegex(varName)}\\s*(?:\\?\\.|\\.)\\s*${escapeRegex(memberName)}\\b`, 'g');
              if (regex.test(content)) { fileCovered.push(iface.fullName); break; }
            }
          }
        }
        if (fileCovered.includes(iface.fullName)) continue;

        // 直接链式调用: ClassName().methodName(  (也支持 onType 链式)
        if (iface.kind === 'method') {
          for (const cn of matchClassNames) {
            const regex = new RegExp(`${escapeRegex(cn)}\\s*\\([^)]*\\)\\s*\\.\\s*${escapeRegex(memberName)}\\s*\\(`, 'g');
            if (regex.test(content)) { fileCovered.push(iface.fullName); break; }
          }
          if (fileCovered.includes(iface.fullName)) continue;
        }
      }

      // 5. 字段: 直接引用名称
      if (iface.kind === 'field') {
        const regex = new RegExp(`\\b${escapeRegex(memberName)}\\b`, 'g');
        if (regex.test(content)) { fileCovered.push(iface.fullName); continue; }
      }
    }

    // 6. 对象字面量/命名参数兜底: propertyName: 或 propertyName,
    for (const iface of interfaces) {
      if (fileCovered.includes(iface.fullName)) continue;
      if ((iface.kind === 'property' || iface.kind === 'field') && iface.memberName && iface.memberName.length >= 2) {
        const regex = new RegExp(`\\b${escapeRegex(iface.memberName)}\\??\\s*:`, 'g');
        if (regex.test(content)) fileCovered.push(iface.fullName);
      }
    }

    // 7. aliased import 兜底: alias.ClassName.memberName
    for (const [alias, pkgName] of imports.aliased) {
      if (pkgName !== packageName && !pkgName.includes(packageName)) continue;
      for (const iface of interfaces) {
        if (fileCovered.includes(iface.fullName)) continue;
        if (!iface.className) continue;
        if (iface.kind === 'method') {
          const regex = new RegExp(`${escapeRegex(alias)}\\s*\\.\\s*${escapeRegex(iface.className)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\s*\\(`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        } else if (iface.kind === 'property' || iface.kind === 'field') {
          const regex = new RegExp(`${escapeRegex(alias)}\\s*\\.\\s*${escapeRegex(iface.className)}\\s*\\.\\s*${escapeRegex(iface.memberName)}\\b`, 'g');
          if (regex.test(content)) fileCovered.push(iface.fullName);
        }
      }
    }

    for (const fullName of fileCovered) {
      if (!fileCoverageMap[fileName]) fileCoverageMap[fileName] = { count: 0, interfaces: [] };
      fileCoverageMap[fileName].count++;
      fileCoverageMap[fileName].interfaces.push(fullName);
    }
  }

  return aggregateResults(interfaces, fileCoverageMap, packageName, files.length);
}

// ── 结果聚合 ──────────────────────────────────────────────

function aggregateResults(interfaces, fileCoverageMap, libName, demoFileCount) {
  // 不要求覆盖率的类型：
  //   constant — const/final 常量，只读值无业务逻辑
  //   enumValue — 枚举常量，同上
  //   constructor — 实例化入口，Demo 中常通过间接方式获得对象
  //   type — 类型别名 (typedef)，不是可调用的方法/属性
  const EXCLUDE_KINDS = ['constant', 'enumValue', 'constructor', 'type'];
  // 框架生命周期方法，通过 testWidgets/pumpWidget 间接覆盖，正则无法追踪
  // Object 基类内置成员：所有 Dart 对象自动继承，不属于库自身公开 API
  const EXCLUDE_METHODS = ['createState', 'hashCode', 'toString', 'noSuchMethod', 'runtimeType'];
  const countedInterfaces = interfaces.filter(i =>
    !EXCLUDE_KINDS.includes(i.kind) &&
    !(i.kind === 'method' && EXCLUDE_METHODS.includes(i.memberName))
  );

  const coveredSet = new Set();
  for (const fc of Object.values(fileCoverageMap)) {
    for (const intf of fc.interfaces) coveredSet.add(intf);
  }

  const covered = [];
  const uncovered = [];
  const classCoverageMap = {};

  for (const iface of countedInterfaces) {
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

  const N = countedInterfaces.length;
  const M = covered.filter(i => coveredSet.has(i.fullName)).length;
  const X = N > 0 ? (M / N * 100).toFixed(2) : '0.00';

  const byKind = {};
  const kindNames = ['method', 'constructor', 'property', 'field', 'constant', 'enumValue', 'function', 'type', 'variable'];
  for (const kind of kindNames) {
    const kindInterfaces = interfaces.filter(i => i.kind === kind);
    const kindCovered = kindInterfaces.filter(i => coveredSet.has(i.fullName));
    byKind[kind] = {
      total: kindInterfaces.length,
      covered: kindCovered.length,
      rate: kindInterfaces.length > 0 ? (kindCovered.length / kindInterfaces.length * 100).toFixed(2) : '-',
      excluded: EXCLUDE_KINDS.includes(kind),
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

// ── Markdown 渲染 ──────────────────────────────────────────

function renderHeader(result, title) {
  const lines = [];
  lines.push(`# ${title || result.libraryName + ' Demo 覆盖率分析报告'}`);
  lines.push('');
  lines.push('> 本报告由 `flutter-analyze-demo-coverage.cjs` 自动生成。');
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
  lines.push(`| 排除类型 | 常量 (constant) / 枚举值 (enumValue) / 构造函数 (constructor) / 类型别名 (type) / 框架方法 (createState) / Object 内置方法 (hashCode/toString/noSuchMethod/runtimeType) |`);
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
  lines.push('| 类型 | 总数 | 已覆盖 | 覆盖率 | 状态 | 备注 |');
  lines.push('|------|------|--------|--------|------|------|');
  for (const [kind, data] of Object.entries(result.byKind || {})) {
    const badge = coverageBadge(data.rate);
    const note = data.excluded ? '不计入覆盖率' : '';
    lines.push(`| ${kind} | ${data.total} | ${data.covered} | ${data.rate}% | ${badge} | ${note} |`);
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
  const sorted = [...(result.classCoverage || [])].sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));
  sorted.forEach((cls, i) => {
    lines.push(`| ${i + 1} | \`${cls.className}\` | ${cls.total} | ${cls.covered} | ${cls.uncovered} | ${cls.rate}% | ${coverageBadge(cls.rate)} |`);
  });
  lines.push('');
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
  let idx = 0;
  for (const [className, members] of Object.entries(grouped)) {
    idx++;
    lines.push(`### ${idx}. ${className} (${members.length} 个未覆盖)`);
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
  let idx = 0;
  for (const [className, members] of Object.entries(grouped)) {
    idx++;
    lines.push(`### ${idx}. ${className}`);
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

function renderFileCoverage(result) {
  const lines = [];
  lines.push('## 文件覆盖详情');
  lines.push('');
  lines.push('| # | 文件 | 覆盖接口数 | 覆盖的接口 |');
  lines.push('|---|------|-----------|-----------|');
  const sorted = [...(result.fileCoverage || [])].sort((a, b) => b.count - a.count);
  sorted.forEach((fc, i) => {
    const ifaces = fc.interfaces.slice(0, 10).map(i => `\`${i}\``).join(', ');
    const more = fc.interfaces.length > 10 ? ` ... (+${fc.interfaces.length - 10})` : '';
    lines.push(`| ${i + 1} | \`${fc.file}\` | ${fc.count} | ${ifaces}${more} |`);
  });
  lines.push('');
  return lines.join('\n');
}

// ── 入口 ──────────────────────────────────────────────────

const args = parseArgs();
const specPath = args.spec;
const title = args.title;

if (!specPath && !args.libroot && !args.repoDir) {
  console.error('用法: node flutter-analyze-demo-coverage.cjs --spec <interface-spec.json> --libroot <库根目录> [--output <report.md>]');
  console.error('  或: node flutter-analyze-demo-coverage.cjs --libroot <库根目录> [--output <report.md>]');
  process.exit(1);
}

const libRoot = args.libroot || args.repoDir || (specPath ? path.dirname(specPath) : '');

// 获取接口规格数据
let specData;
let specBasename;
if (specPath) {
  specData = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  specBasename = path.basename(specPath, '-interface-spec.json');
  console.log(`[Demo 覆盖率分析]`);
  console.log(`接口规格: ${specPath} (${specData.interfaces ? specData.interfaces.length : 0} 个接口)`);
} else {
  console.log(`[Demo 覆盖率分析]`);
  console.log(`从源码目录提取接口: ${libRoot}`);
  specData = generateSpec(libRoot);
  specBasename = specData.libraryName || path.basename(libRoot);
  console.log(`提取完成: ${specData.interfaces ? specData.interfaces.length : 0} 个接口, 库名: ${specData.libraryName}`);
}

// Demo 源码目录
const srcDir = args.src || locateDemoDir(libRoot);
const packageName = args.lib || getPackageName(libRoot);
const resolvedLibName = packageName;

const outputPath = args.output || path.join(process.cwd(), `02-${specBasename}-Demo覆盖率报告.md`);

console.log(`库名: ${resolvedLibName}`);
console.log(`Demo 源码目录: ${srcDir || '(未找到)'}`);

if (!srcDir || !fs.existsSync(srcDir)) {
  console.error(`Demo 源码目录不存在: ${srcDir || '未找到 example/lib'}`);
  process.exit(1);
}

// 扫描 Demo 源文件
const testFiles = walkDir(srcDir, EXCLUDE_DIRS);
console.log(`扫描到 ${testFiles.length} 个 .dart 文件`);

const interfaces = specData.interfaces || [];

// 执行匹配
console.log('使用正则模式匹配...');
const result = matchCoverage(interfaces, testFiles, resolvedLibName);
result.specSummary = specData.summary;

console.log(`Demo 匹配完成: ${result.coveredMethodCount}/${result.totalInterfacesMethodLevel} (${result.coverageRateMethodLevel}%)`);

// 渲染 Markdown
const resolvedTitle = title || `${resolvedLibName} Demo 覆盖率分析报告`;
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
console.log(`Demo 报告渲染完成: ${outputPath}`);
