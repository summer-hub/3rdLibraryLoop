#!/usr/bin/env node
/**
 * @tool rn_render_spec_doc
 * @description 将 RN 三方库接口规格数据渲染为 Markdown 格式的接口规格说明书文档。可直接从库源码提取接口（一步到位），或读取已有的 interface-spec.json 中间件生成文档。用于生成人类可读的 RN API 文档。
 * @param libroot: string - 库根目录路径（直接从源码提取，可选，与 spec 二选一）
 * @param spec: string - 已有的 interface-spec.json 路径（可选，与 libroot 二选一）
 * @param output: string - 输出 Markdown 文件路径（可选，不指定则输出到 stdout）
 * @hidden
 * render-spec-doc.cjs — Layer 2: 接口规格文档渲染器
 *
 * 读取 rn-extract-interfaces.cjs 生成的接口规格 (JSON 或直接提取)，
 * 渲染为 Markdown 格式的接口规格说明书。
 *
 * 依赖: require('./rn-extract-interfaces.cjs')
 *       require('./rn-extract-interfaces.cjs')  (loadSpec/generateRNSpec)
 * 被依赖: 无 (终端脚本)
 *
 * 用法:
 *   方式一 (JSON 中间件):
 *     node rn-render-spec-doc.cjs --spec <interface-spec.json> --output <spec.md>
 *   方式二 (直接从源码提取):
 *     node rn-render-spec-doc.cjs --libroot <库根目录> --output <spec.md>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  escapeMd, formatParams, parseArgs, info, ok, loadSpec,
} = require('./rn-extract-interfaces.cjs');

// ── 工具函数 ──────────────────────────────────────────────

function isEventMethod(name) {
  return /(?:add|remove)\w*Listener/.test(name) || /^on[A-Z]/.test(name);
}

function boolFlag(value) {
  return value ? '是' : '否';
}

function typeLabel(type) {
  const labels = {
    'turbo-module': 'TurboModule Spec',
    'es-export': 'ES Module 导出',
    'commonjs-export': 'CommonJS 导出',
    'side-effect': 'Side-effect (全局补丁)',
    'type-decl': '类型声明 (index.d.ts)',
    'class': '类 (class)',
    'interface': '接口 (interface)',
    'enum': '枚举 (enum)',
    'type': '类型别名 (type)',
    'function': '函数 (function)',
    'variable': '变量 (variable)',
  };
  return labels[type] || type;
}

function layerLabel(layer) {
  const labels = {
    'turbo': 'TurboModule 层',
    'js': 'JS 层',
  };
  return labels[layer] || layer || '-';
}

// ── 分类辅助 ──────────────────────────────────────────────

function groupByClass(interfaces) {
  const classMap = new Map();
  for (const iface of interfaces) {
    const className = iface.className || '(顶层导出)';
    if (!classMap.has(className)) classMap.set(className, []);
    classMap.get(className).push(iface);
  }
  return classMap;
}

function groupByLayer(interfaces) {
  const groups = { turbo: [], js: [] };
  for (const iface of interfaces) {
    const layer = iface.layer || 'js';
    if (!groups[layer]) groups[layer] = [];
    groups[layer].push(iface);
  }
  return groups;
}

// ── 渲染函数 ──────────────────────────────────────────────

function renderHeader(spec) {
  const lines = [];
  lines.push(`# ${spec.libraryName} 接口规格说明书`);
  lines.push('');
  lines.push('> 本文档由 `rn-extract-interfaces.cjs` 自动生成。');
  lines.push('');
  lines.push('## 基本信息');
  lines.push('');
  lines.push('| 属性 | 值 |');
  lines.push('|------|----|');
  lines.push(`| 库名 | \`${spec.libraryName}\` |`);
  lines.push(`| 导入别名 | \`${spec.libraryAlias || '-'}\` |`);
  lines.push(`| 入口文件 | \`${spec.entryFile || '-'}\` |`);
  lines.push(`| 导出模式 | \`${spec.exportStyle || '-'}\` |`);
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
  lines.push(`| 类/接口/模块总数 (S) | ${s.S || '-'} |`);
  lines.push(`| 方法/属性/字段总数 (N) | ${s.N || '-'} |`);
  lines.push(`| 方法数 | ${s.methods || 0} |`);
  lines.push(`| 属性数 | ${s.properties || 0} |`);
  lines.push(`| 字段数 | ${s.fields || 0} |`);
  lines.push('');
  return lines.join('\n');
}

function renderLayerOverview(interfaces) {
  const layers = groupByLayer(interfaces);
  const lines = [];
  lines.push('## 按层级分布');
  lines.push('');
  lines.push('| 层级 | 接口数 | 说明 |');
  lines.push('|------|--------|------|');
  lines.push(`| TurboModule 层 | ${layers.turbo.length} | 原生 TurboModule Spec 方法 |`);
  lines.push(`| JS 层 | ${layers.js.length} | JS 层导出 (CommonJS/ES Module/Side-effect) |`);
  lines.push('');
  return lines.join('\n');
}

function renderClassSection(className, members, index) {
  const lines = [];
  const num = `${index}. `;

  if (className === '(顶层导出)') {
    lines.push(`## ${num}顶层导出`);
    lines.push('');
  } else {
    const firstMember = members[0];
    const typeStr = firstMember ? firstMember.type : 'class';
    const layerStr = firstMember ? firstMember.layer : 'js';
    lines.push(`## ${num}${className}`);
    lines.push('');
    lines.push(`> 类型: ${typeLabel(typeStr)} | 层级: ${layerLabel(layerStr)}`);
    lines.push('');
  }

  // 分离不同种类的成员
  const methods = members.filter(m => m.kind === 'method');
  const functions = members.filter(m => m.kind === 'function');
  const properties = members.filter(m => m.kind === 'property');
  const fields = members.filter(m => m.kind === 'field');
  const variables = members.filter(m => m.kind === 'variable');
  const types = members.filter(m => m.kind === 'type');

  // 方法表格
  if (methods.length > 0) {
    lines.push('### 方法');
    lines.push('');
    lines.push('| # | 方法名 | 事件 | 静态 | 参数 | 返回类型 | 说明 | 源码 |');
    lines.push('|---|--------|------|------|------|----------|------|------|');
    methods.forEach((m, i) => {
      const isEvent = isEventMethod(m.memberName);
      const source = m.source ? `${m.source}:${m.startLine || 0}` : '-';
      lines.push(`| ${i + 1} | \`${m.memberName}\` | ${boolFlag(isEvent)} | ${boolFlag(m.isStatic)} | ${escapeMd(formatParams(m.params))} | ${escapeMd(m.returnType)} | ${escapeMd(m.description)} | \`${source}\` |`);
    });
    lines.push('');
  }

  // 函数表格
  if (functions.length > 0) {
    lines.push('### 函数');
    lines.push('');
    lines.push('| # | 函数名 | 参数 | 返回类型 | 说明 | 源码 |');
    lines.push('|---|--------|------|----------|------|------|');
    functions.forEach((f, i) => {
      const source = f.source ? `${f.source}:${f.startLine || 0}` : '-';
      lines.push(`| ${i + 1} | \`${f.memberName}\` | ${escapeMd(formatParams(f.params))} | ${escapeMd(f.returnType)} | ${escapeMd(f.description)} | \`${source}\` |`);
    });
    lines.push('');
  }

  // 属性表格
  if (properties.length > 0) {
    lines.push('### 属性');
    lines.push('');
    lines.push('| # | 属性名 | 静态 | 只读 | 类型 | 说明 |');
    lines.push('|---|--------|------|------|------|------|');
    properties.forEach((p, i) => {
      lines.push(`| ${i + 1} | \`${p.memberName}\` | ${boolFlag(p.isStatic)} | ${boolFlag(p.isReadonly)} | ${escapeMd(p.returnType)} | ${escapeMd(p.description)} |`);
    });
    lines.push('');
  }

  // 字段表格
  if (fields.length > 0) {
    lines.push('### 字段');
    lines.push('');
    lines.push('| # | 字段名 | 可选 | 只读 | 类型 | 说明 |');
    lines.push('|---|--------|------|------|------|------|');
    fields.forEach((f, i) => {
      lines.push(`| ${i + 1} | \`${f.memberName}\` | ${boolFlag(f.isOptional)} | ${boolFlag(f.isReadonly)} | ${escapeMd(f.returnType)} | ${escapeMd(f.description)} |`);
    });
    lines.push('');
  }

  // 变量表格
  if (variables.length > 0) {
    lines.push('### 变量');
    lines.push('');
    lines.push('| # | 变量名 | 类型 | 说明 |');
    lines.push('|---|--------|------|------|');
    variables.forEach((v, i) => {
      lines.push(`| ${i + 1} | \`${v.memberName}\` | ${escapeMd(v.returnType)} | ${escapeMd(v.description)} |`);
    });
    lines.push('');
  }

  // 类型别名表格
  if (types.length > 0) {
    lines.push('### 类型别名');
    lines.push('');
    lines.push('| # | 类型名 | 定义 | 说明 |');
    lines.push('|---|--------|------|------|');
    types.forEach((t, i) => {
      lines.push(`| ${i + 1} | \`${t.className}\` | \`${escapeMd(t.returnType)}\` | ${escapeMd(t.description)} |`);
    });
    lines.push('');
  }

  // 事件方法汇总
  const eventMethods = methods.filter(m => isEventMethod(m.memberName));
  if (eventMethods.length > 0) {
    lines.push('### 事件方法汇总');
    lines.push('');
    lines.push('| # | 事件方法 | 参数 | 返回类型 |');
    lines.push('|---|----------|------|----------|');
    eventMethods.forEach((e, i) => {
      lines.push(`| ${i + 1} | \`${e.memberName}\` | ${escapeMd(formatParams(e.params))} | \`${escapeMd(e.returnType)}\` |`);
    });
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

// ── 主渲染函数 ────────────────────────────────────────────

/**
 * 渲染接口规格文档。
 * @param {object} spec 接口规格数据
 * @returns {string} Markdown 文档
 */
function renderSpecDoc(spec) {
  const interfaces = spec.interfaces || [];

  // 按类名分组
  const classGroups = groupByClass(interfaces);
  let sectionIndex = 0;

  const parts = [];
  parts.push(renderHeader(spec));
  parts.push(renderSummary(spec));

  for (const [className, members] of classGroups) {
    sectionIndex++;
    parts.push(renderClassSection(className, members, sectionIndex));
  }

  parts.push(renderSourceList(spec));

  return parts.join('\n---\n\n');
}

// ── 导出 ──────────────────────────────────────────────────

module.exports = { renderSpecDoc };

// ── CLI 入口 ──────────────────────────────────────────────

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output;

  const loaded = loadSpec(args);
  if (!loaded) {
    console.error('用法: node rn-render-spec-doc.cjs --spec <interface-spec.json> --output <spec.md>');
    console.error('  或: node rn-render-spec-doc.cjs --libroot <库根目录> --output <spec.md>');
    process.exit(1);
  }

  const { spec, specBasename } = loaded;
  const markdown = renderSpecDoc(spec);

  const finalOutput = outputPath || path.join(
    args.libroot || args.repoDir || (args.spec ? path.dirname(args.spec) : process.cwd()),
    `01-${specBasename}-接口规格说明书.md`
  );

  fs.mkdirSync(path.dirname(finalOutput), { recursive: true });
  fs.writeFileSync(finalOutput, markdown, 'utf-8');
  ok(`文档渲染完成: ${finalOutput}`);
}
