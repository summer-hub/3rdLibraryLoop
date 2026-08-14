#!/usr/bin/env node
/**
 * render-report.cjs — 将 extract-interfaces.cjs 产出的中间 JSON 渲染为
 * ArkTsLibraryInterfaceSpecSkill 步骤 4 规定的 Markdown 接口规格报告。
 *
 * 渲染规则（对齐 SKILL.md 步骤 4 模板与既定的 .d.ts Native 处理策略）：
 *   - 第 1 章（概述）与第 9 章（注意事项）：输出 {PENDING} 占位，等待人工补写
 *   - 第 2 章：自动列出入口文件与解析涉及的源文件
 *   - 第 3 章：类小节。ArkTS 类 `### 3.N ClassName`；`
   d.ts 类 `### 3.N ClassName（.d.ts 类）`；struct 组件 `### 3.N ClassName（struct 组件）`
 *   - 第 4 章：interface `### 4.N Xxx (interface)` / type `### 4.N Xxx (type)`
 *   - 第 5 章：struct 组件（JSON 无 struct 时输出"无"）
 *   - 第 6 章函数表 / 第 7 章变量表 / 第 10 章枚举表
 *   - 第 8 章：.d.ts 模式 → 仅来源说明文字（M=0，供 count-report.cjs 核对）；.d.ets/无 Native → 空说明
 *   - 表格单元格内联合类型/事件 handler 中的 `|` 一律转义为 `\|`，避免 markdown 表格错列
 *   - 泛型与 Promise<...> 保留源码写法；可选字段保留 `?`
 *   - 摘要行与末尾均写入 {PENDING}，由 count-report.cjs 在步骤 5 写回
 *
 * 依赖：仅 Node 内置模块（fs/path），零第三方依赖。
 *
 * 用法：
 *   node render-report.cjs --specJson <extract 输出 JSON> --reportPath <报告.md>
 *   node render-report.cjs --output <extract 输出 JSON> --reportPath <报告.md>   （兼容别名）
 */

const fs = require('fs');
const path = require('path');

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
const specJsonPath = args.specJson || args.input || '';
const reportPath = args.reportPath || args.outputMd || '';
const jsonOutput = args.output;

if (!specJsonPath) {
  console.error('用法: node render-report.cjs --specJson <中间JSON> --reportPath <报告.md>');
  process.exit(1);
}
if (!fs.existsSync(specJsonPath)) {
  console.error(`中间 JSON 不存在: ${specJsonPath}`);
  process.exit(1);
}
if (!reportPath) {
  console.error('用法: node render-report.cjs --specJson <中间JSON> --reportPath <报告.md>');
  process.exit(1);
}

// ── 数据加载 ──────────────────────────────────────────────
let spec;
try {
  spec = JSON.parse(fs.readFileSync(specJsonPath, 'utf-8'));
} catch (err) {
  console.error(`中间 JSON 解析失败: ${err.message}`);
  process.exit(1);
}

const S = spec.sections || {};
const libraryName = spec.libraryName || path.basename(path.dirname(spec.entryFile)) || '未命名库';

// ── 工具函数 ──────────────────────────────────────────────

/** 转义单元格内的管道符（保留已转义的 \| 原样，备份为单独字符） */
function esc(s) {
  if (!s) return '';
  return String(s).replace(/\\\|/g, '\u0001').replace(/\|/g, '\\|').replace(/\u0001/g, '\\|');
}

/** 去除签名中的 readonly 前缀（表格字段类型列单独处理） */
function stripReadonly(s) {
  return String(s).replace(/^readonly\s+/, '');
}

/** 功能描述：doc 为 '-' 表示无注释，此时回退 '-'（与 SKILL 一致不填占位） */
function desc(doc) {
  const d = typeof doc === 'string' ? doc.trim() : '';
  return d || '-';
}

/** 从 enum bodyText 提取枚举值列表（形如 "A, B, C" / "A = 0, B = 1" / 多行） */
function enumValues(bodyText) {
  if (!bodyText) return [];
  return bodyText
    .split(/[\r\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/;$/, '').trim());
}

/** 判断签名是否为方法（含 '(' 且不是纯属性） */
function isMethodSig(sig) {
  return /\(\s*\)\s*:|\([^)]*\)\s*(?::|$)/.test(String(sig)) && !/^[^()]*:[^()]+\s*$/.test(String(sig)) && /\(/.test(String(sig));
}

// ── 渲染辅助 ──────────────────────────────────────────────

/** 类成员渲染为第 3 章表格行数组（兼容 members 为数组或 {methods,properties} 对象） */
function classMemberRows(className, members, statics, doc) {
  const rows = [];
  let shown = false;
  const push = (methodCell, funcDesc) => {
    rows.push({
      className: shown ? '' : className,
      methodCell,
      desc: funcDesc,
    });
    shown = true;
  };

  // 先静态方法
  if (Array.isArray(statics) && statics.length > 0) {
    for (const st of statics) {
      const label = desc(st.doc) === '-' ? '静态方法' : desc(st.doc);
      push(`static ${st.signature || st.name + '(): void'}`, label);
    }
  }

  // members 归一化：数组（ArkTS 类）或 { methods, properties }（.d.ts 类）
  const propList = Array.isArray(members)
    ? members.filter((x) => x && x.isProperty)
    : (members?.properties || []);
  const methodList = Array.isArray(members)
    ? members.filter((x) => x && !x.isProperty)
    : (members?.methods || []);

  // 数组型成员若均为静态属性（常量容器类），类名行仍保留首个属性行的类名
  for (const p of propList) {
    const ro = p.isReadonly ? 'readonly ' : '';
    const cell = `${ro}${p.signature || ''}`;
    const label = desc(p.doc) === '-' ? (p.isEvent ? '事件回调属性' : (p.isStatic || /^static\s/.test(p.signature || '') ? '静态常量' : '属性')) : desc(p.doc);
    push(cell, label);
  }

  for (const m of methodList) {
    if (m.name === 'constructor' || /^new\s*\(/.test(m.signature || '')) continue;
    const cell = m.signature || '';
    const label = desc(m.doc) === '-' ? '方法' : desc(m.doc);
    push(cell, label);
  }

  if (!shown) {
    // 无成员类（如仅继承的空异常类）：不渲染标题行，避免污染方法级接口计数
    return [];
  }
  return rows;
}

/** 渲染第 3 章表格 */
function renderClassTable(className, kind, members, statics, doc) {
  const rows = classMemberRows(className, members, statics, doc);
  const lines = [
    `| 序号 | 类名/成员 | 方法/属性 | 功能描述 |`,
    `|------|-----------|-----------|----------|`,
  ];
  rows.forEach((r, idx) => {
    lines.push(`| ${idx + 1}    | ${r.className ? esc(r.className) : ''} | ${esc(r.methodCell)} | ${esc(r.desc)} |`);
  });
  return lines.join('\n');
}

/** 渲染第 4 章 interface 表格 */
function renderInterfaceTable(interfaceName, iface) {
  const props = iface.members?.properties || [];
  const lines = [
    `| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |`,
    `|------|------------|----------------------|------|----------|------|------|`,
  ];
  if (props.length === 0) {
    lines.push(`| 1    | ${esc(interfaceName)} | interface | — | — | — | 空接口（无字段） |`);
    return lines.join('\n');
  }
  props.forEach((p, idx) => {
    const rawName = (p.name || stripReadonly(p.signature).split(':')[0].trim()).replace(/\?$/, '');
    const fieldName = /^on\w+/.test(rawName) ? rawName : rawName;  // 事件 handler 也保留原名
    const fieldType = stripReadonly(p.signature).includes(':')
      ? stripReadonly(p.signature).split(':').slice(1).join(':').trim()
      : p.type || '';
    const optional = p.isOptional || (p.signature || '').indexOf('?') > -1 ? '?' : '';
    // 必填列：可选或事件回调(hander 恒可空) → 否；否则 是
    const required = optional || /^on\w+/.test(rawName) ? '否' : '是';
    lines.push(`| ${idx + 1}    | ${idx === 0 ? esc(interfaceName) : ''} | interface | ${esc(fieldName + optional)} | ${esc(fieldType)} | ${required} | ${esc(desc(p.doc)) || '字段'} |`);
  });
  return lines.join('\n');
}

/** 渲染第 4 章 type 表格（字段列填 —，类型放字段类型列） */
function renderTypeTable(typeName, ty) {
  const raw = (ty.raw || '').replace(/^export\s+type\s+\w+\s*=\s*/, '').replace(/;\s*$/, '').trim();
  const lines = [
    `| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |`,
    `|------|------------|----------------------|------|----------|------|------|`,
    `| 1    | ${esc(typeName)} | type | — | ${esc(raw)} | 是 | ${esc(desc(ty.doc))} |`,
  ];
  return lines.join('\n');
}

/** 第 8 章 Native 说明文字 */
function nativeChapterText(spec) {
  if (spec.nativeMode === 'dts' && spec.nativeDPath) {
    return `> 本库 Native 声明为 \`.d.ts\`（${spec.nativeDPath}），其全部公开接口已展开纳入第 3/4/6/7 章并**计入 ArkTS 接口统计**，此处不再列表格（M=0）。`;
  }
  if (spec.nativeMode === 'dets' && spec.nativeDPath) {
    return `> 以下接口通过 Native 模块（\`.d.ets\`）导出，来自 ${spec.nativeDPath}。**不计入 ArkTS 接口总数。**`;
  }
  return '> 无 Native 模块导出。';
}

// ── 渲染正文 ──────────────────────────────────────────────

const out = [];
out.push(`# ${libraryName} 接口规格说明`);
out.push('');
out.push(`> **{PENDING}**`);
out.push('');

// 1. 概述（占位）
out.push('## 1. 鸿蒙原生库概述');
out.push('');
out.push('{PENDING}');
out.push('');

// 2. 入口文件与分析范围
out.push('## 2. 入口文件与分析范围');
out.push('');
out.push(`**入口文件：** \`${spec.entryFile || ''}\``);
out.push('');
out.push('**分析涉及的源文件：**');
if (Array.isArray(spec.sources) && spec.sources.length > 0) {
  for (const f of spec.sources) {
    out.push(`- \`${f}\``);
  }
} else {
  out.push('- （无额外源文件）');
}
out.push('');

// 3. 对外导出的类
out.push('## 3. 对外导出的类');
out.push('');
let classSeq = 0;
const allClasses = [
  ...(S.classes || []).map((c) => ({ ...c, kind: c.kind || 'class' })),
  ...(S.nativeClasses || []).map((c) => ({ ...c, kind: c.kind || 'dts-class' })),
];
if (allClasses.length === 0) {
  out.push('无。');
  out.push('');
} else {
  for (const c of allClasses) {
    classSeq++;
    out.push(`### 3.${classSeq} ${c.name}${c.kind === 'dts-class' ? '（.d.ts 类）' : c.kind === 'struct' ? '（struct 组件）' : ''}`);
    out.push('');
    if (c.kind === 'dts-class') {
      out.push('> 来源：`declared in .d.ts`，可 `new` 实例化。');
      out.push('> 装饰器：无（Native 类型声明类）。');
      out.push('> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。');
      out.push('');
      out.push(renderClassTable(c.name, c.kind, c.members, c.statics, c.doc));
    } else if (c.kind === 'struct') {
      out.push('> 装饰器：`@Component`/`@ComponentV2`（struct 组件，UI 组件）。');
      out.push('> ⚠️ **struct 组件只列公开成员属性，不列方法**：生命周期回调和状态监听回调由框架自动调用。');
      out.push('');
      const rows = classMemberRows(c.name, { properties: (c.members?.properties || []), methods: [] }, [], c.doc);
      out.push(`| 序号 | 类名/成员 | 方法/属性 | 功能描述 |`);
      out.push(`|------|-----------|-----------|----------|`);
      rows.forEach((r, i) => out.push(`| ${i + 1}    | ${r.className ? esc(r.className) : ''} | ${esc(r.methodCell)} | ${esc(r.desc)} |`));
    } else {
      // 根据是否有可实例化成员动态生成描述
      const mems = Array.isArray(c.members) ? c.members : [];
      const hasInstanceMethod = mems.some((x) => x && !x.isStatic && !x.isProperty);
      const hasAnyNonStatic = mems.some((x) => x && !x.isStatic);
      const descText = c.decodecorator
        || (hasInstanceMethod
          ? '无（普通导出类，可 `new` 实例化，支持单例或多实例模式）'
          : hasAnyNonStatic
            ? '无（普通导出类，含实例成员）'
            : '无（普通导出类，全部为静态成员，不可实例化）');
      out.push(`> 装饰器：${descText}`);
      out.push('');
      out.push(renderClassTable(c.name, c.kind, c.members, c.statics, c.doc));
    }
    out.push('');
  }
}

// 4. 对外导出的接口/类型
out.push('## 4. 对外导出的接口/类型');
out.push('');
const ifaces = S.interfaces || [];
const types = S.types || [];
if (ifaces.length === 0 && types.length === 0) {
  out.push('无。');
  out.push('');
} else {
  let ifaceSeq = 0;
  // interface 小节
  for (const it of ifaces) {
    ifaceSeq++;
    out.push(`### 4.${ifaceSeq} ${it.name} (interface)`);
    out.push('');
    out.push('> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。');
    out.push('');
    out.push(renderInterfaceTable(it.name, it));
    out.push('');
  }
  // type 小节
  for (const ty of types) {
    ifaceSeq++;
    out.push(`### 4.${ifaceSeq} ${ty.name} (type)`);
    out.push('');
    out.push('> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。');
    out.push('');
    out.push(renderTypeTable(ty.name, ty));
    out.push('');
  }
}

// 5. UI 组件装饰器兼容性
out.push('## 5. UI 组件装饰器兼容性');
out.push('');
const structs = (S.classes || []).filter((c) => c.kind === 'struct');
if (structs.length === 0) {
  out.push('无。本库未导出 @Component/@ComponentV2 struct 组件。');
  out.push('');
} else {
  out.push('| 组件名 | 源文件 | 属性装饰器 | 属性名 | 属性类型 | 关联类装饰器 | 兼容性 |');
  out.push('|-------|--------|----------|--------|---------|------------|--------|');
  for (const s of structs) {
    out.push(`| ${esc(s.name)} | ${esc(s.source || '')} | — | — | — | — | — |`);
  }
  out.push('');
}

// 6. 对外导出的函数
out.push('## 6. 对外导出的函数');
out.push('');
const funcs = S.functions || [];
if (funcs.length === 0) {
  out.push('无。');
  out.push('');
} else {
  out.push('| 序号 | 函数名称 | 返回值 | 参数列表 | 功能描述 |');
  out.push('|------|----------|--------|----------|----------|');
  funcs.forEach((f, i) => {
    // 解析签名：name(args): ret
    const sig = f.signature || '';
    const nameM = sig.match(/^export\s+function\s+(\w+)/) || sig.match(/^(\w+)/);
    const name = nameM ? nameM[1] : f.name;
    const argsM = sig.match(/\(([^)]*)\)/);
    const argsList = argsM ? argsM[1].trim() : '';
    const retM = sig.match(/\)\s*:\s*([^;]+)/);
    const ret = retM ? retM[1].trim() : ': void';
    out.push(`| ${i + 1}    | ${esc(name)} | ${esc(ret)} | ${esc(argsList)} | ${esc(desc(f.doc))} |`);
  });
  out.push('');
}

// 7. 对外导出的变量/常量
out.push('## 7. 对外导出的变量/常量');
out.push('');
const vars = S.variables || [];
if (vars.length === 0) {
  out.push('无。');
  out.push('');
} else {
  out.push('| 序号 | 变量名称 | 变量类型 | 功能描述 |');
  out.push('|------|----------|----------|----------|');
  vars.forEach((v, i) => {
    out.push(`| ${i + 1}    | ${esc(v.name)} | ${esc(v.type || 'unknown')} | ${esc(desc(v.doc))} |`);
  });
  out.push('');
}

// 8. Native 模块导出
out.push('## 8. Native 模块导出');
out.push('');
if (spec.nativeMode === 'dts') {
  out.push('### 8.1 Native 声明为 `.d.ts`（已计入 N/S，仅说明来源）');
  out.push('');
  out.push(nativeChapterText(spec));
} else if (spec.nativeMode === 'dets') {
  out.push('### 8.1 Native 声明为 `.d.ets`（不计入 N，独立章节）');
  out.push('');
  out.push(nativeChapterText(spec));
} else {
  out.push(nativeChapterText(spec));
}
out.push('');

// 9. 注意事项（占位）
out.push('## 9. 注意事项');
out.push('');
out.push('{PENDING}');
out.push('');

// 10. 枚举导出（不计入接口统计）
out.push('## 10. 枚举导出（不计入接口统计）');
out.push('');
const enums = S.enums || [];
if (enums.length === 0) {
  out.push('无。');
  out.push('');
} else {
  out.push('> 以下枚举为类型定义，非可调用的 API，**不纳入 S/N 接口统计**，仅作导出清单展示。');
  out.push('');
  out.push('| 序号 | 枚举名 | 源文件 | 枚举值 | 功能描述 |');
  out.push('|------|--------|--------|--------|----------|');
  enums.forEach((e, i) => {
    const vals = enumValues(e.bodyText);
    const cleanVals = vals.join(', ');
    out.push(`| ${i + 1}    | ${esc(e.name)} | \`${esc(e.source || '')}\` | \`${esc(cleanVals)}\` | ${esc(desc(e.doc)) || '枚举定义'} |`);
  });
  out.push('');
}

// 末尾占位
out.push('---');
out.push('{PENDING}');
out.push('');

const md = out.join('\n');
fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
fs.writeFileSync(reportPath, md, 'utf-8');

console.log(`已渲染: ${reportPath}`);
console.log(`类小节: ${classSeq}  接口小节: ${ifaces.length}  type 小节: ${types.length}  函数: ${funcs.length}  变量: ${vars.length}  枚举: ${enums.length}`);
console.log(`报告大小: ${fs.statSync(reportPath).size} 字节`);