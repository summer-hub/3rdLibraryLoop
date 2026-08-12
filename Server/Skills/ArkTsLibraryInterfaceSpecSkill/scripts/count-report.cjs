#!/usr/bin/env node
/**
 * count-report.cjs — 接口规格报告计数验证与摘要行补写脚本。
 *
 * 替代 SKILL 步骤 5 中原有的基于 grep/sed 的 bash 计数（仅在 Linux/macOS/Git Bash
 * 可用，Windows/PowerShell 下不可用）。本脚本仅用 Node 内置 fs/path，无第三方依赖，
 * 跨平台（Windows/PowerShell 可直接运行）。
 *
 * 统计口径与既有 5a~5f 完全一致：
 *   - TOTAL：全报告中所有 `| 数字 |` 开头的表格数据行
 *   - E    ：第 10 章（枚举导出）数据行数
 *   - C    ：第 3 章小节标题（^### 3.\d+）
 *   - I    ：第 4 章小节标题（^### 4.\d+）
 *   - F    ：第 6 章（函数）数据行数
 *   - V    ：第 7 章（变量/常量）数据行数
 *   - M    ：Native 导出数。优先从 nativeDPath 的 .d.ets 统计 `^export (const|class)`；
 *            未提供 nativeDPath 时从报告第 8 章数据行统计（M2 口径），并打印来源说明。
 *   - N    ：方法级接口总数 = TOTAL - M - E（枚举不纳入 N）
 *   - S    ：类级条目数 = C + I + F + V（不含枚举）
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
  console.error('Usage: node count-report.cjs <reportPath>');
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

// C / I：第 3、4 章小节标题数
const C = lines.filter((l) => /^###\s+3\.\d+/.test(l)).length;
const I = lines.filter((l) => /^###\s+4\.\d+/.test(l)).length;
console.log(`C=${C}（第 3 章类小节）  I=${I}（第 4 章接口小节）`);

// F / V：第 6、7 章数据行数
const F = countSectionDataRows(lines, /^##\s+6\./);
const V = countSectionDataRows(lines, /^##\s+7\./);
console.log(`F=${F}（第 6 章函数）  V=${V}（第 7 章变量/常量）`);

// M：优先级 nativeDPath(.d.ets) > 报告第 8 章数据行
let M = null;
let M2 = null;
let mSource = '';
if (nativeDPath && fs.existsSync(nativeDPath)) {
  const dets = fs.readFileSync(nativeDPath, 'utf-8');
  M = dets.split(/\r?\n/).filter((l) => /^export\s+(const|class)\b/.test(l)).length;
  mSource = 'nativeDPath(.d.ets)';
  console.log(`M=${M}（来源: ${nativeDPath}）`);
} else if (nativeDPath) {
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
  if (M === M2) {
    ok(`Native 数交叉核对一致: M=${M} == M2=${M2}`);
  } else {
    fail(`Native 数不一致: M=${M}(.d.ets) != M2=${M2}(报告第 8 章)`);
  }
}

// N / S
const N = TOTAL - M - E;
const S = C + I + F + V;
console.log(`N=${N}（TOTAL=${TOTAL} - M=${M} - E=${E}）`);
console.log(`S=${S}（C=${C} + I=${I} + F=${F} + V=${V}，不含枚举）`);

// ── 3. 摘要行构造（与既有格式一致）────────────────────────
const summary = `> **ArkTS 导出项类级条目数 S = ${S}（类 ${C} + 接口 ${I} + 函数 ${F} + 变量 ${V}），枚举 ${E}（不计入接口统计），方法级接口总数 N = ${N}，Native 导出 M = ${M}**`;

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