#!/usr/bin/env node
/**
 * @tool arkts_render_spec_doc
 * @description 将接口规格数据渲染为 Markdown 格式的接口规格说明书文档。可直接从库源码提取接口（一步到位），或读取已有的 interface-spec.json 中间件生成文档。用于生成人类可读的 API 文档。
 * @param libroot: string - 库源码根目录路径（直接从源码提取，可选，与 spec 二选一）
 * @param spec: string - 已有的 interface-spec.json 路径（可选，与 libroot 二选一）
 * @param output: string - 输出 Markdown 文件路径（可选，不指定则输出到 stdout）
 * @hidden
 * render-spec-doc.cjs — 接口规格文档渲染器
 *
 * 读取 extract-interfaces.cjs 生成的 interface-spec.json，
 * 渲染为 Markdown 格式的接口规格文档。
 *
 * 用法:
 *   方式一（读 JSON 中间件）:
 *     node render-spec-doc.cjs --spec <interface-spec.json> --output <spec.md>
 *
 *   方式二（直接从源码提取，无需 JSON 中间件）:
 *     node render-spec-doc.cjs --libroot <库源码目录> --output <spec.md>
 *
 * 使用示例:
 *   # 方式一: 从已有 JSON 生成文档
 *   node render-spec-doc.cjs --spec lottie_turbo-interface-spec.json --output 01-lottie_turbo-接口规格说明书.md
 *
 *   # 方式二: 直接从源码生成文档（跳过 JSON 中间件）
 *   node render-spec-doc.cjs --libroot /path/to/lottie_turbo --output 01-lottie_turbo-接口规格说明书.md
 *
 *   # 库源码目录结构约定:
 *   #   /path/to/lottie_turbo/
 *   #     ├── library/              ← 库源码（Index.ets 入口）
 *   #     │   ├── Index.ets
 *   #     │   ├── src/main/ets/
 *   #     │   └── src/main/cpp/types/.../Index.d.ts   ← Native .so 声明
 *   #     └── entry/src/main/ets/    ← Demo 源码
 */

const fs = require('fs');
const path = require('path');
const { generateSpec } = require('./extract-interfaces.cjs');

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
      parsed[args[i].substring(2)] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

// ── 工具函数 ──────────────────────────────────────────────

function isEventMethod(name) {
  return /^on[A-Z]/.test(name);
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

function boolFlag(value) {
  return value ? '是' : '否';
}

function typeLabel(type) {
  const labels = {
    'class': '类 (class)', 'struct': '组件 (struct)', 'interface': '接口 (interface)',
    'dts-class': 'Native 声明 (declare var)', 'enum': '枚举 (enum)', 'type': '类型别名 (type)',
    'function': '函数 (function)', 'variable': '变量 (variable)',
  };
  return labels[type] || type;
}

// ── 分类辅助 ──────────────────────────────────────────────

/** 按类型分组接口 */
function groupByType(interfaces) {
  const groups = {
    'class': [], 'struct': [], 'interface': [], 'dts-class': [],
    'enum': [], 'type': [], 'function': [], 'variable': [],
  };
  for (const iface of interfaces) {
    const type = iface.type || 'class';
    if (!groups[type]) groups[type] = [];
    groups[type].push(iface);
  }
  return groups;
}

/** 按类名分组接口成员 */
function groupByClass(interfaces) {
  const classMap = new Map();
  for (const iface of interfaces) {
    const className = iface.className || '(顶层导出)';
    if (!classMap.has(className)) classMap.set(className, []);
    classMap.get(className).push(iface);
  }
  return classMap;
}

// ── 渲染函数 ──────────────────────────────────────────────

function renderHeader(spec) {
  const lines = [];
  lines.push(`# ${spec.libraryName} 接口规格说明书`);
  lines.push('');
  lines.push('> 本文档由 \`extract-interfaces.cjs\` 自动生成，基于 TypeScript Compiler API 语义分析。');
  lines.push('');
  lines.push('## 基本信息');
  lines.push('');
  lines.push('| 属性 | 值 |');
  lines.push('|------|----|');
  lines.push(`| 库名 | \`${spec.libraryName}\` |`);
  lines.push(`| 入口文件 | \`${spec.entryFile}\` |`);
  if (spec.nativeDPath) {
    lines.push(`| Native 声明 | \`${spec.nativeDPath}\` |`);
  }
  lines.push(`| 生成时间 | ${spec.extractedAt} |`);
  lines.push(`| 源文件数 | ${spec.sources ? spec.sources.length : '-'} |`);
  lines.push('');
  return lines.join('\n');
}

function renderSummary(spec) {
  const s = spec.summary || {};
  const lines = [];
  lines.push('## 接口统计');
  lines.push('');
  lines.push('| 统计项 | 数量 |');
  lines.push('|--------|------|');
  lines.push(`| 类/接口/枚举总数 (S) | ${s.S || '-'} |`);
  lines.push(`| 方法/属性/字段总数 (N) | ${s.N || '-'} |`);
  lines.push(`| 方法数 | ${s.methods || 0} |`);
  lines.push(`| 属性数 | ${s.properties || 0} |`);
  lines.push(`| 字段数 | ${s.fields || 0} |`);
  lines.push('');
  return lines.join('\n');
}

function renderClassSection(className, members, repoDir, index) {
  const lines = []
  const num = `${index}. `
  if (className === '(顶层导出)') {
    lines.push(`## ${num}顶层导出`)
    lines.push('')
  } else {
    const firstMember = members[0]
    const typeStr = firstMember ? firstMember.type : 'class'
    const label = typeLabel(typeStr)
    lines.push(`## ${num}${className}`)
    lines.push('');
    lines.push(`> 类型: ${label}`);
    lines.push('');
  }

  // 分离方法和属性
  const methods = members.filter(m => m.kind === 'method');
  const properties = members.filter(m => m.kind === 'property');
  const fields = members.filter(m => m.kind === 'field');
  const enumValues = members.filter(m => m.kind === 'enumValue');
  const functions = members.filter(m => m.kind === 'function');
  const variables = members.filter(m => m.kind === 'variable');
  const types = members.filter(m => m.kind === 'type');

  // 方法表格
  if (methods.length > 0) {
    lines.push('### 方法');
    lines.push('');
    lines.push('| # | 方法名 | 事件 | 静态 | 参数 | 返回类型 | 说明 |')
    lines.push('|---|--------|------|------|------|----------|------|')
    methods.forEach((m, i) => {
      const isEvent = isEventMethod(m.memberName)
      lines.push(`| ${i + 1} | \`${m.memberName}\` | ${boolFlag(isEvent)} | ${boolFlag(m.isStatic)} | ${escapeMd(formatParams(m.params))} | ${escapeMd(m.returnType)} | ${escapeMd(m.description)} |`)
    })
    lines.push('');
  }

  // 属性表格
  if (properties.length > 0) {
    lines.push('### 属性');
    lines.push('');
    lines.push('| # | 属性名 | 静态 | 只读 | 类型 | 说明 |')
    lines.push('|---|--------|------|------|------|------|')
    properties.forEach((p, i) => {
      lines.push(`| ${i + 1} | \`${p.memberName}\` | ${boolFlag(p.isStatic)} | ${boolFlag(p.isReadonly)} | ${escapeMd(p.returnType)} | ${escapeMd(p.description)} |`)
    })
    lines.push('');
  }

  // 字段表格
  if (fields.length > 0) {
    lines.push('### 字段');
    lines.push('');
    lines.push('| # | 字段名 | 可选 | 只读 | 类型 | 说明 |')
    lines.push('|---|--------|------|------|------|------|')
    fields.forEach((f, i) => {
      lines.push(`| ${i + 1} | \`${f.memberName}\` | ${boolFlag(f.isOptional)} | ${boolFlag(f.isReadonly)} | ${escapeMd(f.returnType)} | ${escapeMd(f.description)} |`)
    })
    lines.push('');
  }

  // 枚举值表格
  if (enumValues.length > 0) {
    lines.push('### 枚举值');
    lines.push('');
    lines.push('| # | 枚举值 | 值 | 说明 |')
    lines.push('|---|--------|----|------|')
    enumValues.forEach((e, i) => {
      lines.push(`| ${i + 1} | \`${e.memberName}\` | ${escapeMd(e.returnType)} | ${escapeMd(e.description)} |`)
    })
    lines.push('');
  }

  // 顶层函数表格
  if (functions.length > 0) {
    lines.push('### 函数');
    lines.push('');
    lines.push('| # | 函数名 | 参数 | 返回类型 | 说明 | 源码 |')
    lines.push('|---|--------|------|----------|------|------|')
    functions.forEach((f, i) => {
      const funcCall = `${f.memberName}(${formatParams(f.params)})`
      lines.push(`| ${i + 1} | \`${funcCall}\` | ${escapeMd(formatParams(f.params))} | \`${escapeMd(f.returnType)}\` | ${escapeMd(f.description)} | \`${f.source}:${f.startLine}\` |`)
    })
    lines.push('');
  }

  // 顶层变量表格
  if (variables.length > 0) {
    lines.push('### 变量');
    lines.push('');
    lines.push('| # | 变量名 | 类型 | 说明 |')
    lines.push('|---|--------|------|------|')
    variables.forEach((v, i) => {
      lines.push(`| ${i + 1} | \`${v.memberName}\` | ${escapeMd(v.returnType)} | ${escapeMd(v.description)} |`)
    })
    lines.push('');
  }

  // 类型别名表格
  if (types.length > 0) {
    lines.push('### 类型别名');
    lines.push('');
    lines.push('| # | 类型名 | 定义 | 说明 |')
    lines.push('|---|--------|------|------|')
    types.forEach((t, i) => {
      lines.push(`| ${i + 1} | \`${t.className}\` | \`${escapeMd(t.returnType)}\` | ${escapeMd(t.description)} |`)
    })
    lines.push('');
  }

  // 事件方法汇总表格
  const eventMethods = methods.filter(m => isEventMethod(m.memberName));
  if (eventMethods.length > 0) {
    lines.push('### 事件方法汇总');
    lines.push('');
    lines.push('| # | 事件方法 | 参数 | 返回类型 |')
    lines.push('|---|----------|------|----------|')
    eventMethods.forEach((e, i) => {
      lines.push(`| ${i + 1} | \`${e.memberName}\` | ${escapeMd(formatParams(e.params))} | \`${escapeMd(e.returnType)}\` |`)
    })
    lines.push('');
  }

  return lines.join('\n');
}

function renderSourceList(spec) {
  if (!spec.sources || spec.sources.length === 0) return '';
  const lines = [];
  lines.push('## 源文件列表');
  lines.push('');
  lines.push('| # | 文件路径 |');
  lines.push('|---|----------|');
  spec.sources.forEach((src, i) => {
    lines.push(`| ${i + 1} | \`${src}\` |`);
  });
  lines.push('');
  return lines.join('\n');
}

// ── 入口 ──────────────────────────────────────────────────

const args = parseArgs();
const specPath = args.spec;
const outputPath = args.output;

if (!specPath && !args.libroot && !args.repoDir) {
  console.error('用法: node render-spec-doc.cjs --spec <interface-spec.json> --output <spec.md>');
  console.error('  或: node render-spec-doc.cjs --libroot <库源码目录> --output <spec.md>');
  process.exit(1);
}

let spec;
if (specPath) {
  spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  console.log(`读取接口规格: ${specPath} (${spec.interfaces ? spec.interfaces.length : 0} 个接口)`);
} else {
  const repoDir = args.libroot || args.repoDir;
  console.log(`从源码目录提取接口: ${repoDir}`);
  spec = generateSpec(repoDir);
  console.log(`提取完成: ${spec.interfaces ? spec.interfaces.length : 0} 个接口, 库名: ${spec.libraryName}`);
}

const interfaces = spec.interfaces || [];

// 分组
const classGroups = groupByClass(interfaces);
let sectionIndex = 0;

// 渲染
const parts = [];
parts.push(renderHeader(spec));
parts.push(renderSummary(spec));

for (const [className, members] of classGroups) {
  sectionIndex++
  parts.push(renderClassSection(className, members, args.repoDir, sectionIndex))
}

parts.push(renderSourceList(spec));

const markdown = parts.join('\n---\n\n');

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, 'utf-8');
  console.log(`文档渲染完成: ${outputPath}`);
} else {
  console.log(markdown);
}
