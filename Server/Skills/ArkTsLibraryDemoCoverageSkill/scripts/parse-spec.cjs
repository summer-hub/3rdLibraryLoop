/**
 * parse-spec.cjs — 解析 ArkTsLibraryInterfaceSpecSkill 生成的接口规格 Markdown 文档，
 * 提取方法级接口清单并输出为 JSON。
 *
 * 用法:
 *   node parse-spec.cjs --spec <spec.md> --output <interfaces.json>
 *
 * 输出 JSON 格式与 coverage-match.cjs 的 --interfaces 参数兼容。
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      parsed[args[i].substring(2)] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

// ── 辅助函数 ──────────────────────────────────────────────

/** 将括号内的 | 替换为占位符，防止按 | 切分列时错位 */
function protectPipes(line) {
  let depth = 0;
  let result = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(' || ch === '<') depth++;
    else if (ch === ')' || ch === '>') depth--;
    else if (ch === '|' && depth > 0) { result += '%%PIPE%%'; continue; }
    result += ch;
  }
  return result;
}

/** 从 Markdown 表格行提取管道分隔的列（保留空列） */
function splitRow(line) {
  const protected = protectPipes(line);
  // 不 filter 空串——表格中空列有语义（表示类名/枚举名延续上一行）
  return protected.split('|').map(s => s.trim().replace(/%%PIPE%%/g, '|')).slice(1, -1);
}

/** 判断行是否为表格数据行（以 | 数字 | 开头） */
function isDataRow(line) {
  return /^\|\s*\d+\s+\|/.test(line);
}

/** 判断行是否为章节标题 */
function isH2(line, num) { return new RegExp(`^##\\s+${num}\\.\\s`).test(line); }
function isH3(line, num) { return new RegExp(`^###\\s+${num}\\.\\d+\\s`).test(line); }

/** 从 H3 标题提取类名/接口名，如 "### 3.1 ImageKnifeComponent（struct 组件）" → "ImageKnifeComponent" */
function extractNameFromH3(line) {
  const m = line.match(/^###\s+\d+\.\d+\s+(.+)/);
  if (!m) return null;
  // 去掉后缀标注如 "（struct 组件）"、"(interface)"、"(class)"、"`@Observed`"
  return m[1].replace(/[（(][^)）]*[）)]/g, '').replace(/`[^`]*`/g, '').trim();
}

/** 判断 H3 标题是否标记为 struct 组件 */
function isStructH3(line) {
  return /（struct\s*组件）/.test(line);
}

/** 判断 H3 标题下的类型标注是 interface 还是 class */
function getTypeKindFromH3(line) {
  if (/\(interface\)/i.test(line)) return 'interface';
  if (/\(class\)/i.test(line)) return 'class';
  return null;
}

/** 从类表格的"方法/属性"列判断 kind 和 memberName */
function parseClassMember(cell) {
  // 去掉装饰器前缀（@Trace, @Track 等）
  const cleaned = cell.replace(/^@\w+\s+/, '').trim();

  // constructor — 不纳入接口统计，跳过
  if (/^constructor\s*\(/.test(cleaned)) {
    return { memberName: 'constructor', kind: 'constructor', skip: true };
  }

  // static/async methods: "static methodName(...)" or "async methodName(...)"
  if (/^(static|async)\s+\w+\s*\(/.test(cleaned)) {
    const m = cleaned.match(/^(?:static|async)\s+(\w+)\s*\(/);
    return { memberName: m ? m[1] : cleaned, kind: 'method' };
  }

  // regular method: "methodName(...)"
  if (/^\w+\s*\(/.test(cleaned)) {
    const m = cleaned.match(/^(\w+)\s*\(/);
    return { memberName: m ? m[1] : cleaned, kind: 'method' };
  }

  // property: "propName: type" or "propName?: type"
  const propM = cleaned.match(/^(\w+)\??\s*:/);
  if (propM) {
    return { memberName: propM[1], kind: 'property' };
  }

  // fallback
  return { memberName: cleaned, kind: 'property' };
}

/** 判断成员是否为 static */
function isStaticMember(cell, kind) {
  if (kind === 'constructor') return false;
  if (kind === 'property') return /\bstatic\s+readonly\b/.test(cell);
  return /\bstatic\s/.test(cell) || /\bstatic\s+readonly\b/.test(cell);
}

// ── 主解析逻辑 ────────────────────────────────────────────

function parseSpec(specPath) {
  const content = fs.readFileSync(specPath, 'utf-8');
  const lines = content.split('\n');

  const result = {
    libraryName: '',
    summaryN: 0,
    summaryS: 0,
    summaryM: 0,
    interfaces: [],
  };

  // 提取库名
  for (const line of lines) {
    const titleM = line.match(/^#\s+(.+?)\s+接口规格说明/);
    if (titleM) { result.libraryName = titleM[1].trim(); break; }
  }

  // 提取摘要行中的 N, S, M
  for (const line of lines) {
    const summaryM = line.match(/S\s*=\s*(\d+).*?N\s*=\s*(\d+).*?M\s*=\s*(\d+)/);
    if (summaryM) {
      result.summaryS = parseInt(summaryM[1], 10);
      result.summaryN = parseInt(summaryM[2], 10);
      result.summaryM = parseInt(summaryM[3], 10);
      break;
    }
  }

  let section = null;      // 'class' | 'interface' | 'function' | 'variable'
  let currentClassName = null;
  let currentTypeKind = null;  // 'interface' | 'class' (for Chapter 4)
  let isStruct = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测章节切换（章节编号: 3=类, 4=接口, 5=函数, 6=变量, 7=Native/跳过, 8=注意事项/跳过）
    if (isH2(line, 3)) { section = 'class'; currentClassName = null; continue; }
    if (isH2(line, 4)) { section = 'interface'; currentClassName = null; continue; }
    if (isH2(line, 5)) { section = 'function'; currentClassName = null; continue; }
    if (isH2(line, 6)) { section = 'variable'; currentClassName = null; continue; }
    if (isH2(line, 7) || isH2(line, 8)) { section = null; continue; }

    if (!section) continue;
    if (!isDataRow(line)) {
      // 检测 H3 子标题
      if (section === 'class' && isH3(line, 3)) {
        currentClassName = extractNameFromH3(line);
        isStruct = isStructH3(line);
        continue;
      }
      if (section === 'interface' && isH3(line, 4)) {
        currentClassName = extractNameFromH3(line);
        const tk = getTypeKindFromH3(line);
        currentTypeKind = tk || 'interface';
        continue;
      }
      continue;
    }

    const cols = splitRow(line);

    switch (section) {
      case 'class': {
        if (!currentClassName) continue;
        // 类表格: | 序号 | 类名/成员 | 方法/属性 | 功能描述 |
        const cellMethod = cols[2] || '';
        if (!cellMethod) continue;

        const { memberName, kind } = parseClassMember(cellMethod);
        if (kind === 'constructor') continue;  // 构造函数不纳入接口统计
        // struct 组件：所有行都是 property
        const actualKind = isStruct ? 'property' : kind;
        const isStatic = isStaticMember(cellMethod, actualKind);

        const signature = cellMethod;                     // 方法/属性列的原始签名
        const description = cols[3] || '';               // 功能描述列

        result.interfaces.push({
          className: currentClassName,
          memberName,
          fullName: `${currentClassName}.${memberName}`,
          kind: actualKind,
          isStatic,
          type: 'class',
          signature,
          description,
        });
        break;
      }

      case 'interface': {
        if (!currentClassName) continue;
        // 接口表格: | 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
        const fieldCell = cols[3] || '';
        if (!fieldCell) continue;
        const fieldName = fieldCell.replace(/\?$/, '').trim();

        const signature = `${fieldName}: ${cols[4] || ''}`;  // 字段:类型
        const description = cols[6] || '';                   // 描述列

        result.interfaces.push({
          className: currentClassName,
          memberName: fieldName,
          fullName: `${currentClassName}.${fieldName}`,
          kind: 'field',
          isStatic: false,
          type: currentTypeKind || 'interface',
          signature,
          description,
        });
        break;
      }

      case 'enum': {
        // 枚举不纳入接口统计，跳过
        break;
      }

      case 'function': {
        // 函数表格: | 序号 | 函数名称 | 返回值 | 参数列表 | 功能描述 |
        const funcName = cols[1] || '';
        if (!funcName) continue;

        const signature = `${funcName}(${cols[3] || ''}): ${cols[2] || ''}`;  // 名称(参数):返回值
        const description = cols[4] || '';                                     // 描述列

        result.interfaces.push({
          className: null,
          memberName: funcName,
          fullName: funcName,
          kind: 'function',
          isStatic: false,
          type: 'function',
          signature,
          description,
        });
        break;
      }

      case 'variable': {
        // 变量表格: | 序号 | 变量名称 | 变量类型 | 功能描述 |
        const varName = cols[1] || '';
        if (!varName) continue;

        const signature = `${varName}: ${cols[2] || ''}`;   // 变量名:类型
        const description = cols[3] || '';                 // 描述列

        result.interfaces.push({
          className: null,
          memberName: varName,
          fullName: varName,
          kind: 'variable',
          isStatic: false,
          type: 'variable',
          signature,
          description,
        });
        break;
      }
    }
  }

  return result;
}

// ── 入口 ──────────────────────────────────────────────────

const args = parseArgs();
if (!args.spec || !args.output) {
  console.error('用法: node parse-spec.cjs --spec <spec.md> --output <interfaces.json>');
  process.exit(1);
}

const result = parseSpec(args.spec);
const count = result.interfaces.length;

// 校验
const mismatch = result.summaryN > 0 && count !== result.summaryN;
if (mismatch) {
  console.warn(
    `⚠️ 警告: 解析条目数 (${count}) ≠ 摘要行 N (${result.summaryN})，差 ${result.summaryN - count} 项。`
  );
  console.warn(
    '   上游接口规格文档的摘要行 N 与实际表格行数不一致。已输出解析结果，但 N 值以表格实际行数为准。'
  );
}

// 输出
fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, JSON.stringify(result.interfaces, null, 2), 'utf-8');

const status = mismatch ? '⚠️ 警告' : '✅';
console.log(`${status} 解析完成: ${count} 个方法级接口`);
if (!mismatch) console.log(`   (与摘要行 N=${result.summaryN} 一致)`);
console.log(`   库名: ${result.libraryName}`);
console.log(`   输出: ${args.output}`);

if (mismatch) process.exit(2);  // exit code 2 = 警告但继续
