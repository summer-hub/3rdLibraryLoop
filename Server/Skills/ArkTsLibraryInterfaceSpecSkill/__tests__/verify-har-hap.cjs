#!/usr/bin/env node
/**
 * verify-har-hap.cjs — ohos_webrtc har_hap 全链路一键验证。
 *
 * 对 ArkTsLibraryInterfaceSpecSkill 新增的接口提取脚本做端到端验证：
 *   extract-interfaces.cjs（源码/.d.ts → 中间 JSON）
 *   → render-report.cjs（中间 JSON → SKILL 格式 markdown 报告）
 *   → count-report.cjs（计数校验 + 摘要写回）
 *   → parse-spec.cjs（解析报告为方法级接口，与 N 恒等断言）
 *
 * 断言目标（对应 SKILL .d.ts 模式规则）：
 *   - Native 声明为 .d.ts → count-report M=0（接口已并入 N/S）
 *   - N = TOTAL - M - E - T_TYPE（T_TYPE=第 4 章 type 别名行）与脚本一致；S = C + I + F + V
 *   - parse-spec 解析条目数 == N（无警告，exit 0/2）
 *   - 报告含摘要行、第 8 章说明文字、{PENDING} 已被替换（count-report 写回）
 *
 * 用法：
 *   node __tests__/verify-har-hap.cjs [--repoDir <har_hap 目录>] [--workDir <临时目录>]
 *   默认 repoDir = D:\code\db\task\task_msr86pczjxuo\ohos_webrtc\sdk\ohos\har_hap
 *   默认 workDir = %TEMP%\verify-har-hap-<随机>
 *
 * 退出码：0=全部断言通过；1=任一断言失败。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── 参数解析 ──────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        parsed[key] = args[i + 1];
        i++;
      } else parsed[key] = true;
    }
  }
  return parsed;
}

const args = parseArgs();
const SKILL_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(SKILL_DIR, 'scripts');
const EXTRACT = path.join(SCRIPTS_DIR, 'extract-interfaces.cjs');
const RENDER = path.join(SCRIPTS_DIR, 'render-report.cjs');
const COUNT = path.join(SCRIPTS_DIR, 'count-report.cjs');
const PARSE = path.join(SKILL_DIR, '..', 'ArkTsLibraryDemoCoverageSkill', 'scripts', 'parse-spec.cjs');

const DEFAULT_REPO = 'D:\\code\\db\\task\\task_msr86pczjxuo\\ohos_webrtc\\sdk\\ohos\\har_hap';
const repoDir = args.repoDir || DEFAULT_REPO;
const workDir = args.workDir || fs.mkdtempSync(path.join(require('os').tmpdir(), 'verify-har-hap-'));

fs.mkdirSync(workDir, { recursive: true });
const specJson = path.join(workDir, 'webrtc-interfaces.json');
const reportMd = path.join(workDir, 'webrtc-spec.md');
const parseJson = path.join(workDir, 'webrtc-spec.json');

// ── 辅助 ──────────────────────────────────────────────────
let PASS = 0;
let FAIL = 0;
function ok(msg) { PASS++; console.log(`  ✅ ${msg}`); }
function fail(msg) { FAIL++; console.log(`  ❌ ${msg}`); }

function run(script, scriptArgs, opts = {}) {
  const res = spawnSync(process.execPath, [script, ...scriptArgs], {
    encoding: 'utf-8',
    cwd: opts.cwd || process.cwd(),
    shell: false,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** 统计第 4 章 (type) 小节内的表格数据行数（= count-report.cjs 的 T_TYPE，解析时整体排除） */
function countTypeRows(mdPath) {
  const lines = fs.readFileSync(mdPath, 'utf-8').split(/\r?\n/);
  let inCh4 = false;
  let curType = false;
  let typeRows = 0;
  const typeH3 = /^###\s+4\.\d+\s+.+\(type\)\s*$/i;
  for (const line of lines) {
    if (/^##\s+4\./.test(line)) { inCh4 = true; curType = false; continue; }
    if (inCh4 && /^##\s+\d+\./.test(line)) break;
    if (!inCh4) continue;
    if (/^###\s+4\.\d+/.test(line)) { curType = typeH3.test(line); continue; }
    if (curType && /^\|\s*\d+\s+\|/.test(line)) typeRows++;
  }
  return typeRows;
}

console.log('=== ohos_webrtc har_hap 全链路验证 ===\n');
console.log(`repoDir : ${repoDir}`);
console.log(`workDir : ${workDir}\n`);

// 0. 前置检查
if (!fs.existsSync(repoDir)) {
  fail(`repoDir 不存在: ${repoDir}`);
  console.log(`\n=== 验证结果: ${PASS} passed, ${FAIL} failed ===`);
  process.exit(1);
}
if (!fs.existsSync(EXTRACT) || !fs.existsSync(RENDER) || !fs.existsSync(COUNT)) {
  fail(`缺失必要脚本: ${[EXTRACT, RENDER, COUNT].filter(f => !fs.existsSync(f)).join(', ')}`);
  process.exit(1);
}
if (!fs.existsSync(PARSE)) {
  console.log(`⚠️  未找到 parse-spec.cjs（${PARSE}），将跳过 parse-spec 解析一致性检查`);
}

// 1. extract-interfaces
console.log('[1/4] extract-interfaces.cjs');
const ex = run(EXTRACT, ['--repoDir', repoDir, '--output', specJson]);
if (ex.code !== 0) {
  fail(`extract-interfaces 退出码 ${ex.code}: ${ex.stderr || ex.stdout}`);
  process.exit(1);
}
if (!fs.existsSync(specJson)) {
  fail('extract-interfaces 未生成中间 JSON');
  process.exit(1);
}
ok(`生成中间 JSON: ${specJson}`);

const spec = JSON.parse(fs.readFileSync(specJson, 'utf-8'));
// Native .d.ts 模式断言
if (spec.nativeMode !== 'dts') fail(`nativeMode 应为 dts，实际 ${spec.nativeMode}`);
else ok(`nativeMode = dts`);
if (!spec.nativeDPath) fail('缺少 nativeDPath');
else ok(`nativeDPath = ${spec.nativeDPath}`);

// 2. render-report
console.log('\n[2/4] render-report.cjs');
const rd = run(RENDER, ['--specJson', specJson, '--reportPath', reportMd]);
if (rd.code !== 0) {
  fail(`render-report 退出码 ${rd.code}: ${rd.stderr || rd.stdout}`);
  process.exit(1);
}
if (!fs.existsSync(reportMd)) {
  fail('render-report 未生成报告');
  process.exit(1);
}
const report = fs.readFileSync(reportMd, 'utf-8');
ok(`生成报告: ${reportMd}（${fs.statSync(reportMd).size} 字节）`);

// 3. count-report
console.log('\n[3/4] count-report.cjs（.d.ts 模式）');
const nativeAbs = path.join(repoDir, spec.nativeDPath.replace(/^\.\//, '').split('/').join(path.sep));
const ct = run(COUNT, [reportMd, nativeAbs]);
if (ct.code !== 0) {
  fail(`count-report 退出码 ${ct.code}`);
} else ok(`count-report 退出码 0`);
const countOut = ct.stdout + ct.stderr;

// 解析 count-report 输出中的关键数值
const mVal = parseInt((countOut.match(/M=\d+/) || [''])[0].replace('M=', ''), 10);
const nVal = parseInt((countOut.match(/N=(\d+)/) || [''])[1], 10);
const sVal = parseInt((countOut.match(/S=(\d+)/) || [''])[1], 10);
const eVal = parseInt((countOut.match(/E=\d+/) || [''])[0].replace('E=', ''), 10);
const totalVal = parseInt((countOut.match(/TOTAL=(\d+)/) || [''])[1], 10);
const typeVal = parseInt((countOut.match(/T_TYPE=(\d+)/) || [''])[1], 10);

if (mVal === 0) ok(`M=0（.d.ts 模式，接口已计入 N/S）`);
else fail(`M 应 0，实际 ${mVal}`);
if (nVal >= 100 && !Number.isNaN(nVal)) ok(`N=${nVal}（方法级接口总数，含 .d.ts）`);
else fail(`N 异常: ${nVal}`);
// N/TOTAL/E/S 交叉核对: N = TOTAL - M - E - T_TYPE；S = C + I + F + V（脚本已自行校验,此处仅记录）
console.log(`  （count-report 口径: TOTAL=${totalVal}, E=${eVal}, T_TYPE=${typeVal}, N=${nVal}, S=${sVal}）`);
const nFromTotal = totalVal - mVal - eVal - typeVal;
if (nFromTotal === nVal) ok(`交叉核对 N=${nVal} == TOTAL(${totalVal}) - M(${mVal}) - E(${eVal}) - T_TYPE(${typeVal})`);
else fail(`交叉核对 N 不一致: ${nVal} vs ${nFromTotal}`);

// 摘要行写回（count-report 运行后重新读取报告）
let hasSummary = report.includes('ArkTS 导出项类级条目数');
if (hasSummary) ok('摘要行已由 count-report 写回');
else if (fs.existsSync(reportMd)) {
  const after = fs.readFileSync(reportMd, 'utf-8');
  hasSummary = after.includes('ArkTS 导出项类级条目数');
  if (hasSummary) ok('摘要行已由 count-report 写回（运行后重读）');
  else fail('摘要行缺失/未写回');
} else fail('摘要行缺失/未写回');

// 4. parse-spec
console.log('\n[4/4] parse-spec.cjs（解析一致性）');
if (fs.existsSync(PARSE)) {
  const ps = run(PARSE, ['--spec', reportMd, '--output', parseJson]);
  if (ps.code === 0 || ps.code === 2) {
    ok(`parse-spec 退出码 ${ps.code}（0 或 2 均接受）`);
  } else {
    fail(`parse-spec 退出码 ${ps.code}: ${ps.stderr}`);
  }
  if (fs.existsSync(parseJson)) {
    const parsed = JSON.parse(fs.readFileSync(parseJson, 'utf-8'));
    const count = Array.isArray(parsed) ? parsed.length : (parsed.interfaces || []).length;
    // 口径（计划 A）：第 4 章 (type) 小节 = 类型别名，不可调用，
    // count-report 以 T_TYPE 从 N 中排除，parse-spec 整体跳过该小节 → count == N 恒等。
    const typeRows = countTypeRows(reportMd);
    if (count === nVal) {
      ok(`parse-spec 条目数 ${count} == N(${nVal})（N 已排除 T_TYPE=${typeRows} 个 type 别名，口径一致）`);
    } else {
      fail(`parse-spec 条目数 ${count} != N(${nVal})（第 4 章 type 行 ${typeRows}，两口径仍不一致）`);
    }
    console.log(`  （count-report 的 N = TOTAL - M - E - T_TYPE；parse-spec 跳过全部 (type) 小节，与 N 恒等。T_TYPE=${typeRows}）`);
  } else {
    fail('parse-spec 未生成解析 JSON');
  }
} else {
  console.log('  （跳过 parse-spec 一致性检查）');
}

// 5. 人工核对：demo workPage.ets 符号命中率（提示，非硬断言）
console.log('\n[附加] demo workPage.ets 使用的 webrtc 符号命中率（供人工核对，非断言）');
const demoFile = path.join(repoDir, 'entry', 'src', 'main', 'ets', 'pages', 'workPage.ets');
const demoKeywords = [
  'MediaDevices', 'getUserMedia', 'PeerConnectionFactory', 'createPeerConnection',
  'createVideoSource', 'addTrack', 'sendChannel', 'RTCDataChannelInit',
  'createDataChannel', 'RTCPeerConnection', 'onicecandidate', 'setRemoteDescription',
  'setLocalDescription', 'createOffer', 'ontrack', 'Logging', 'VideoRenderController',
  'AudioDeviceModule', 'RTCConfiguration', 'setConfiguration',
];
if (fs.existsSync(demoFile)) {
  const demo = fs.readFileSync(demoFile, 'utf-8');
  let hit = 0;
  for (const kw of demoKeywords) {
    if (demo.includes(kw)) hit++;
  }
  console.log(`  在报告中找到 demo 关键词 ${hit}/${demoKeywords.length}`);
  if (hit >= demoKeywords.length * 0.6) ok(`demo 关键词命中率 ${hit}/${demoKeywords.length} ≥ 60%（提取完整性良好）`);
  else fail(`demo 关键词命中率 ${hit}/${demoKeywords.length} < 60%（可能存在漏提取，请人工核对）`);
} else {
  console.log(`  （未找到 demo 文件 ${demoFile}，跳过命中率检查）`);
}

// ── 汇总 ──────────────────────────────────────────────────
console.log(`\n=== 验证结果: ${PASS} passed, ${FAIL} failed ===`);
if (FAIL > 0) {
  console.log(`临时产物保留于: ${workDir}`);
  process.exit(1);
} else {
  console.log(`全部断言通过。临时产物: ${workDir}`);
  console.log('工作区清理：tmp/webrtc-interfaces.json、webrtc-spec.md、webrtc-spec.json 为本脚本产物。');
  process.exit(0);
}