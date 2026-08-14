#!/usr/bin/env node
/**
 * count-report.cjs — 接口规格报告计数验证与摘要行补写脚本。
 *
 * 替代 SKILL 步骤 5 中原有的基于 grep/sed 的 bash 计数（仅在 Linux/macOS/Git Bash
 * 可用，Windows/PowerShell 下不可用）。本脚本仅用 Node 内置 fs/path，无第三方依赖，
 * 跨平台（Windows/PowerShell 可直接运行）。
 *
 * 统计口径与既有 5a~5f 完全一致（新增 T_TYPE 修正）：
 *   - TOTAL：全报告中所有 `| 数字 |` 开头的表格数据行
 *   - E    ：第 10 章（枚举导出）数据行数
 *   - T_TYPE：第 4 章 `(type)` 小节内的表格数据行数 —— 类型别名（type alias）为类型定义，
 *            非可调用的方法级接口，从方法级总数 N 中排除。涵盖纯字面量联合（如
 *            `type X = "a" | "b"`，语义等价枚举）、简单类型别名（`type Y = number`）等。
 *   - C    ：第 3 章小节标题（^### 3.\d+）
 *   - I    ：第 4 章小节标题（^### 4.\d+，含 interface 与 type 小节）
 *   - F    ：第 6 章（函数）数据行数
 *   - V    ：第 7 章（变量/常量）数据行数
 *   - M    ：Native 导出数。.d.ets 模式优先从 nativeDPath 统计 `^export (const|class)`；
 *            未提供 nativeDPath 时从报告第 8 章数据行统计（M2 口径），并打印来源说明。
 *            **.d.ts 模式：M 固定为 0**（Native 声明为 .d.ts 时其全部公开接口已并入第 3/4/6/7 章，
 *            并计入 N/S，第 8 章仅保留来源说明文字，不再列表格）。
 *   - N    ：方法级接口总数 = TOTAL - M - E - T_TYPE（枚举与类型别名均不纳入 N；.d.ts 模式下
 *            M=0，N 涵盖全部可调用的公开接口）
 *   - S    ：类级条目数 = C + I + F + V（不含枚举；type 小节仍计入 I，故 S 含类型别名小节）
 *
 * N 口径修正背景：此前 N = TOTAL - M - E 会把第 4 章 type 别名行（纯字面量联合/简单类型别名等
 * 类型定义，不可调用）混入方法级接口总数，导致与 SKILL「类型别名/枚举不计入 S/N」语义冲突，
 * 也造成下游 parse-spec.cjs 提取的方法级条目数与摘要 N 不一致（如 @ohos/webrtc 偏差 39 项）。
 * 现通过 T_TYPE 统一两脚本口径：count-report 的 N 与 parse-spec 实际提取条目数恒等。
 *
 * nativeDPath 扩展名判定：
 *   - `.d.ets`：声明为 ArkTS Native（Multi-Core 标准模式）→ 走独立 Native 章节（M 口径），不计入 N
 *   - `.d.ts` ：声明为 TypeScript（如 WebRTC 类库的 libohos_webrtc/webrtc.d.ts）→ 接口计入 N/S，M=0
 *   - 无 nativeDPath：M 从报告第 8 章数据行统计（M2 口径）
 *
 * 校验通过后：
 *   - 摘要行 `> **{PENDING}**` 替换为正确数值；
 *   - 末尾 `{PENDING}` 替换为 `状态: 成功`。
 * 仅当报告含 `{PENDING}` 且全部校验通过时才写回文件；已定稿报告（无 {PENDING}）只做
 * 统计与现有摘要行校对，不写回，避免破坏已定稿报告。
 *
 * 用法（与项目既有脚本兼容的两种调用方式）：
 *   node count-report.cjs "<reportPath>"
 *   node count-report.cjs '{"reportPath":"<reportPath>","nativeDPath":"<nativeDPath>"}'
 *
 * 成功时 process.exit(0)，失败时 process.exit(1)。
 */

const fs = require('fs');
const path = require('path');

// ── 输出统计 ──────────────────────────────────────────────
let PASS = 0;
let FAIL = 0;

function ok(msg) { PASS++; console.log(`  ✅ ${msg}`); }
function fail(msg) { FAIL++; console.log(`  ❌ ${msg}`); }

/** 取某章节（^## N.）到下一章节之间的数据行数 */
function countSectionDataRows(lines, sectionRe) {
  const startIdx = lines.findIndex((l) => sectionRe.test(l));
  if (startIdx === -1) return 0;
  let count = 0;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+\d+\./.test(lines[i])) break; // 遇到下一章节即停止
    if (/^\|\s*\d+\s+\|/.test(lines[i])) count++;
  }
  return count;
}

/** 解析现有摘要行中的数值（已定稿报告校对用） */
function parseSummary(summaryLine) {
  const m = {};
  const s = summaryLine.match(/S\s*=\s*(\d+)/);
  const n = summaryLine.match(/N\s*=\s*(\d+)/);
  const e = summaryLine.match(/枚举\s+(\d+)/);
  const mm = summaryLine.match(/M\s*=\s*(\d+)/);
  if (s) m.S = parseInt(s[1], 10);
  if (n) m.N = parseInt(n[1], 10);
  if (e) m.E = parseInt(e[1], 10);
  if (mm) m.M = parseInt(mm[1], 10);
  return m;
}

// ── 入口与参数解析 ────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node count-report.cjs <reportPath> [nativeDPath]');
  console.error('   or: node count-report.cjs \'{"reportPath":"<reportPath>","nativeDPath":"<nativeDPath>"}\'');
  process.exit(1);
}

let reportPath = '';
let nativeDPath = '';

const first = args[0];
if (first.trim().startsWith('{')) {
  try {
    const parsed = JSON.parse(first);
    reportPath = parsed.reportPath || parsed.file || '';
    nativeDPath = parsed.nativeDPath || parsed.detsPath || '';
  } catch (err) {
    console.error(`Error: 参数 JSON 解析失败: ${err.message}`);
    process.exit(1);
  }
}

if (!reportPath) reportPath = first; // 回退为位置参数

// 位置参数形式的第二个参数视为 nativeDPath：
//   node count-report.cjs <reportPath> <nativeDPath>
if (!nativeDPath && args.length >= 2 && !args[1].trim().startsWith('{')) {
  nativeDPath = args[1];
}

if (!reportPath) {
  console.error('Error: reportPath 参数必填');
  process.exit(1);
}

if (!fs.existsSync(reportPath)) {
  console.error(`Error: 报告文件不存在: ${reportPath}`);
  process.exit(1);
}

const report = fs.readFileSync(reportPath, 'utf-8');
const lines = report.split(/\r?\n/);

console.log(`报告: ${reportPath}`);

// ── 1. 统计各计数 ─────────────────────────────────────────
// TOTAL：全报告所有 `| 数字 |` 数据行
const TOTAL = lines.filter((l) => /^\|\s*\d+\s+\|/.test(l)).length;
console.log(`TOTAL=${TOTAL}（全报告表格数据行）`);

// E：第 10 章枚举行数
const E = countSectionDataRows(lines, /^##\s+10\./);
console.log(`E=${E}（第 10 章枚举行）`);

// T_TYPE：第 4 章 (type) 小节内的表格数据行数（类型别名行，不计入方法级接口 N）
// 解析方式：逐行定位第 4 章范围内，H3 标题含 "(type)" 的小节，累计其数据行。
let T_TYPE = 0;
{
  let inCh4 = false;
  let curType = false; // 当前小节是否 (type) 类型
  const typeH3 = /^###\s+4\.\d+\s+.+\(type\)\s*$/i;
  for (const l of lines) {
    if (/^##\s+4\./.test(l)) { inCh4 = true; curType = false; continue; }
    if (inCh4 && /^##\s+\d+\./.test(l)) break; // 进入第 5 章或更后章节即停止
    if (!inCh4) continue;
    if (/^###\s+4\.\d+/.test(l)) { curType = typeH3.test(l); continue; }
    if (curType && /^\|\s*\d+\s+\|/.test(l)) T_TYPE++;
  }
}
console.log(`T_TYPE=${T_TYPE}（第 4 章 type 别名行，不计入 N）`);

// C / I：第 3、4 章小节标题数
const C = lines.filter((l) => /^###\s+3\.\d+/.test(l)).length;
const I = lines.filter((l) => /^###\s+4\.\d+/.test(l)).length;
console.log(`C=${C}（第 3 章类小节）  I=${I}（第 4 章接口小节）`);

// F / V：第 6、7 章数据行数
const F = countSectionDataRows(lines, /^##\s+6\./);
const V = countSectionDataRows(lines, /^##\s+7\./);
console.log(`F=${F}（第 6 章函数）  V=${V}（第 7 章变量/常量）`);

// M：三种模式——
//   a) nativeDPath 指向 .d.ts：Native 声明为 TypeScript，接口已并入第 3/4/6/7 章，M 固定为 0
//   b) nativeDPath 指向 .d.ets：按 `^export (const|class)` 统计独立 Native 数
//   c) 无 nativeDPath：从报告第 8 章数据行统计（M2 口径）
let M = null;
let M2 = null;
let mSource = '';
let nativeMode = 'none'; // 'dets' | 'dts' | 'none'

if (nativeDPath && fs.existsSync(nativeDPath)) {
  nativeMode = nativeDPath.toLowerCase().endsWith('.d.ts') ? 'dts' : 'dets';
  const dets = fs.readFileSync(nativeDPath, 'utf-8');
  if (nativeMode === 'dts') {
    // .d.ts 模式：全部公开接口计入 N/S，M=0；统计声明类别供核对参考
    M = 0;
    mSource = 'nativeDPath(.d.ts) → M=0（接口已计入 N/S）';
    const declStats = {
      declareVar: dets.split(/\r?\n/).filter((l) => /^declare\s+var\s+\w+/.test(l)).length,
      exportClass: dets.split(/\r?\n/).filter((l) => /^export\s+class\b/.test(l)).length,
      exportInterface: dets.split(/\r?\n/).filter((l) => /^export\s+interface\b/.test(l)).length,
      exportType: dets.split(/\r?\n/).filter((l) => /^export\s+type\b/.test(l)).length,
      exportFunction: dets.split(/\r?\n/).filter((l) => /^export\s+function\b/.test(l)).length,
      exportConst: dets.split(/\r?\n/).filter((l) => /^export\s+const\b/.test(l)).length,
    };
    console.log(`M=${M}（来源: ${nativeDPath}，.d.ts 模式：接口已计入 N/S）`);
    console.log(`  .d.ts 声明统计: declareVar=${declStats.declareVar} exportClass=${declStats.exportClass} exportInterface=${declStats.exportInterface} exportType=${declStats.exportType} exportFunction=${declStats.exportFunction} exportConst=${declStats.exportConst}`);
  } else {
    // .d.ets 模式：独立 Native 章节，不计入 N
    M = dets.split(/\r?\n/).filter((l) => /^export\s+(const|class)\b/.test(l)).length;
    mSource = 'nativeDPath(.d.ets)';
    console.log(`M=${M}（来源: ${nativeDPath}）`);
  }
} else if (nativeDPath) {
  nativeMode = nativeDPath.toLowerCase().endsWith('.d.ts') ? 'dts' : 'dets';
  console.log(`⚠️  指定的 nativeDPath 不存在，退回从报告第 8 章统计 M2: ${nativeDPath}`);
}
M2 = countSectionDataRows(lines, /^##\s+8\./);
console.log(`M2=${M2}（报告第 8 章数据行）`);

if (M === null) {
  M = M2;
  mSource = '报告第 8 章(M2)';
  console.log(`M=${M}（无 nativeDPath，采用报告第 8 章口径）`);
}

// ── 2. 交叉核对 ───────────────────────────────────────────
if (nativeDPath && fs.existsSync(nativeDPath)) {
  if (nativeMode === 'dts') {
    // .d.ts 模式：第 8 章应为纯说明文字（无数据行），M=0 与 M2 直接一致即通过
    if (M === M2 && M2 === 0) {
      ok(`Native 数核对一致（.d.ts 模式）: M=0 == M2=0，接口已并入 N/S`);
    } else if (M2 === 0) {
      ok(`Native 数核对一致（.d.ts 模式）: M=${M}，M2=0（第 8 章无数据行，符合说明文字约定）`);
    } else {
      fail(`Native 数不一致（.d.ts 模式）: M=${M}(应 0) != M2=${M2}(报告第 8 章不应有数据行)`);
    }
  } else {
    if (M === M2) {
      ok(`Native 数交叉核对一致: M=${M} == M2=${M2}`);
    } else {
      fail(`Native 数不一致: M=${M}(.d.ets) != M2=${M2}(报告第 8 章)`);
    }
  }
}

// N / S
const N = TOTAL - M - E - T_TYPE;
const S = C + I + F + V;
console.log(`N=${N}（TOTAL=${TOTAL} - M=${M} - E=${E} - T_TYPE=${T_TYPE}）`);
console.log(`S=${S}（C=${C} + I=${I} + F=${F} + V=${V}，不含枚举）`);

// ── 3. 摘要行构造（与既有格式一致）────────────────────────
// .d.ts 模式下 M=0 且接口已计入 N，摘要行附注说明以区分 .d.ets 模式的 M=0（无 Native）
const nativeNote = (nativeMode === 'dts' && M === 0)
  ? 'M = 0（Native 声明为 .d.ts，已计入 N）'
  : `M = ${M}`;
const summary = `> **ArkTS 导出项类级条目数 S = ${S}（类 ${C} + 接口 ${I} + 函数 ${F} + 变量 ${V}），枚举 ${E}（不计入接口统计），方法级接口总数 N = ${N}，Native 导出 ${nativeNote}**`;

// ── 4. 写回摘要 / 校对已定稿报告 ─────────────────────────
const hasPendingSummary = report.includes('> **{PENDING}**');
const hasPendingTail = /(^|\n)\{PENDING\}/.test(report);

if (hasPendingSummary || hasPendingTail) {
  // 未定稿：校验通过后写回
  if (FAIL === 0) {
    let updated = report;
    if (hasPendingSummary) {
      updated = updated.replace('> **{PENDING}**', summary);
      ok('摘要行已替换');
    }
    if (hasPendingTail) {
      updated = updated.replace(/(\n)\{PENDING\}/, '$1状态: 成功');
      ok('末尾 {PENDING} 已替换为 状态: 成功');
    }
    fs.writeFileSync(reportPath, updated, 'utf-8');
    ok('已写回报告文件');
  } else {
    fail('存在校验失败，未写回报告（禁止标记 状态: 成功）');
  }
} else {
  // 已定稿：仅校对现有摘要行，不写回
  const sumLine = lines.find((l) => /^>\s*\*\*ArkTS 导出项类级条目数/.test(l));
  if (sumLine) {
    const parsed = parseSummary(sumLine);
    let consistent = true;
    if (parsed.S !== undefined && parsed.S !== S) { fail(`摘要 S=${parsed.S} 与计算值 ${S} 不一致`); consistent = false; }
    if (parsed.N !== undefined && parsed.N !== N) { fail(`摘要 N=${parsed.N} 与计算值 ${N} 不一致`); consistent = false; }
    if (parsed.E !== undefined && parsed.E !== E) { fail(`摘要 E=${parsed.E} 与计算值 ${E} 不一致`); consistent = false; }
    if (parsed.M !== undefined && parsed.M !== M) { fail(`摘要 M=${parsed.M} 与计算值 ${M} 不一致`); consistent = false; }
    if (consistent) ok('已定稿报告，摘要行与计算值一致（未写回）');
  } else {
    ok('报告已定稿且无摘要行，仅统计（未写回）');
  }
}

// ── 5. 汇总 ──────────────────────────────────────────────
console.log(`\n=== 计数验证结果: ${PASS} passed, ${FAIL} failed ===`);
if (FAIL > 0) {
  console.log('验证未通过，请回步骤 3b 修正后重新生成报告，再执行本脚本。');
  process.exit(1);
} else {
  console.log('验证通过');
  process.exit(0);
}