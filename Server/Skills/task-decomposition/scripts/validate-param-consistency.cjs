#!/usr/bin/env node
/**
 * @tool validate-param-consistency
 * @description 校验 task-decomposition SKILL 输出中的关键参数一致性（拦截 LLM 生成时版本号/分支名臆造问题）。跨平台（Windows/macOS/Linux），仅需 Node.js。
 * @param resultFile: string - 拆解结果 JSON 文件路径
 *
 * validate-param-consistency.cjs
 *
 * 检测范围（拦截 LLM 生成时版本号/分支名臆造问题）：
 *   1. keyParameters 缺失 — 输出 JSON 未包含 keyParameters 字段
 *   2. keyParameters 子字段为空 — versionNumbers/branchNames 在任务含版本号/分支名时不应为空
 *   3. 步骤描述中的版本号不在 keyParameters 中 — 如 0.72 未声明
 *   4. 步骤描述中的分支名不在 keyParameters 中 — 如 br_rnoh0.72 未声明
 *   5. keyParameters 中声明的参数在步骤中完全未引用 — 声明但未使用
 *
 * 任一项 FAIL 则 process.exit(1)，供 SKILL 强制重拆解。
 *
 * 用法（与既有脚本兼容的两种调用方式）：
 *   node validate-param-consistency.cjs <resultFilePath>
 *   node validate-param-consistency.cjs '{"resultFile":"<resultFilePath>"}'
 *
 * 依赖：仅 Node 内置 fs/path，无第三方依赖。
 */

const fs = require('fs');

// ── 输出统计 ──────────────────────────────────────────────
let PASS = 0;
let FAIL = 0;
let WARN = 0;

function ok(msg) { PASS++; console.log(`  ✅ ${msg}`); }
function fail(msg) { FAIL++; console.log(`  ❌ ${msg}`); }
function warn(msg) { WARN++; console.log(`  ⚠️  ${msg}`); }

/** 从原始文本中容错提取纯 JSON（容忍 markdown 代码块包裹） */
function extractJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

// ── 参数提取工具 ──────────────────────────────────────────

/** 提取所有版本号（如 0.82, 7.88.0, 19.2，支持 2-4 段式），使用 \b 边界匹配。
 *  注意：br_rnoh0.82 等分支名内的数字因无词边界不会误提取为版本号。 */
function extractVersionNumbers(text) {
  const matches = text.match(/\b\d+(?:\.\d+){1,3}\b/g);
  return matches ? [...new Set(matches)] : [];
}

/** 提取所有分支名（br_ 前缀标识符，允许含版本号中的 . 字符） */
function extractBranchNames(text) {
  const matches = text.match(/br_[a-zA-Z0-9_.]+/g);
  return matches ? [...new Set(matches)] : [];
}

/** 提取所有 URL（https:// 开头，到空白/中文/引号为止） */
function extractUrls(text) {
  const matches = text.match(/https:\/\/[^\s'"，。、））》\]]+/g);
  return matches ? [...new Set(matches)] : [];
}

// ── 入口与参数解析 ────────────────────────────────────────
const args = process.argv.slice(2);
let resultFile = '';

if (args.length === 0) {
  console.error('Usage: node validate-param-consistency.cjs <resultFilePath>');
  console.error('   or: node validate-param-consistency.cjs \'{"resultFile":"<resultFilePath>"}\'');
  process.exit(1);
}

const first = args[0];
if (first.trim().startsWith('{')) {
  try {
    const parsed = JSON.parse(first);
    resultFile = parsed.resultFile || parsed.file || '';
  } catch (err) {
    console.error(`Error: 参数 JSON 解析失败: ${err.message}`);
    process.exit(1);
  }
}

if (!resultFile) resultFile = first;

if (!resultFile) {
  console.error('Error: resultFile 参数必填');
  process.exit(1);
}

if (!fs.existsSync(resultFile)) {
  console.error(`Error: 文件不存在: ${resultFile}`);
  process.exit(1);
}

const raw = fs.readFileSync(resultFile, 'utf-8');
const jsonStr = extractJson(raw);

if (jsonStr === null) {
  fail('文件中未找到 JSON 内容（缺少 { 或 }）');
  console.log(`\n=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(jsonStr);
  ok('JSON 格式合法可解析');
} catch (err) {
  fail(`JSON 解析失败: ${err.message}`);
  console.log(`\n=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
  process.exit(1);
}

// ── 1. keyParameters 存在性检查 ────────────────────────────
console.log('\n--- 1. keyParameters 存在性检查 ---');

if (!data.keyParameters || typeof data.keyParameters !== 'object') {
  fail('输出 JSON 缺少 keyParameters 字段（Phase 1.4 要求提取关键参数）');
  console.log(`\n=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
  process.exit(1);
}
ok('keyParameters 字段存在');

const kp = data.keyParameters;
const declaredVersions = Array.isArray(kp.versionNumbers) ? kp.versionNumbers.map(String) : [];
const declaredBranches = Array.isArray(kp.branchNames) ? kp.branchNames.map(String) : [];
const declaredUrls = Array.isArray(kp.repoUrls) ? kp.repoUrls.map(String) : [];
const declaredLibs = Array.isArray(kp.libraryNames) ? kp.libraryNames.map(String) : [];

// ── 2. 收集步骤描述中的所有文本 ────────────────────────────
console.log('\n--- 2. 步骤文本参数提取 ---');

const steps = Array.isArray(data.steps) ? data.steps : [];
if (steps.length === 0) {
  fail('steps 数组为空，无法进行参数一致性校验');
  console.log(`\n=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
  process.exit(1);
}

// 收集所有步骤的文本（taskDescription + acceptanceCriteria 的所有字符串字段）
let allStepText = '';
for (const step of steps) {
  if (step.taskDescription) allStepText += ' ' + step.taskDescription;
  if (Array.isArray(step.acceptanceCriteria)) {
    for (const ac of step.acceptanceCriteria) {
      if (ac.criterion) allStepText += ' ' + ac.criterion;
      if (ac.verification) allStepText += ' ' + ac.verification;
    }
  }
}

const stepVersions = extractVersionNumbers(allStepText);
const stepBranches = extractBranchNames(allStepText);
const stepUrls = extractUrls(allStepText);

ok(`步骤描述中提取到 ${stepVersions.length} 个版本号: ${stepVersions.join(', ') || '(无)'}`);
if (stepBranches.length > 0) ok(`步骤描述中提取到 ${stepBranches.length} 个分支名: ${stepBranches.join(', ')}`);
if (stepUrls.length > 0) ok(`步骤描述中提取到 ${stepUrls.length} 个 URL: ${stepUrls.join(', ')}`);

// ── 3. 版本号一致性检查 ───────────────────────────────────
console.log('\n--- 3. 版本号一致性检查 ---');

if (declaredVersions.length === 0) {
  if (stepVersions.length > 0) {
    fail(`keyParameters.versionNumbers 为空，但步骤描述中出现了版本号: ${stepVersions.join(', ')}（请补充到 keyParameters）`);
  } else {
    warn('keyParameters.versionNumbers 为空（任务描述中可能无版本号，若任务确无版本号可忽略）');
  }
} else {
  ok(`keyParameters.versionNumbers 声明: ${declaredVersions.join(', ')}`);

  // 检查步骤中的版本号是否都在 keyParameters 中
  const undeclaredVersions = stepVersions.filter((v) => !declaredVersions.includes(v));
  if (undeclaredVersions.length > 0) {
    for (const v of undeclaredVersions) {
      fail(`步骤描述中出现版本号 '${v}'，但未在 keyParameters.versionNumbers 中声明 — 疑似版本号臆造/篡改`);
    }
  } else {
    ok('步骤描述中所有版本号均已在 keyParameters 中声明');
  }

  // 检查 keyParameters 中的版本号是否至少在一个步骤中被引用
  const unusedVersions = declaredVersions.filter((v) => !stepVersions.includes(v));
  if (unusedVersions.length > 0) {
    for (const v of unusedVersions) {
      warn(`keyParameters.versionNumbers 声明了 '${v}'，但步骤描述中未引用该版本号`);
    }
  } else {
    ok('keyParameters 中所有版本号均在步骤描述中被引用');
  }
}

// ── 4. 分支名一致性检查 ───────────────────────────────────
console.log('\n--- 4. 分支名一致性检查 ---');

if (declaredBranches.length === 0) {
  if (stepBranches.length > 0) {
    fail(`keyParameters.branchNames 为空，但步骤描述中出现了分支名: ${stepBranches.join(', ')}（请补充到 keyParameters）`);
  } else {
    // 任务中无分支名是正常的，不报错
    ok('任务无分支名相关参数（keyParameters.branchNames 为空，步骤描述中也无分支名）');
  }
} else {
  ok(`keyParameters.branchNames 声明: ${declaredBranches.join(', ')}`);

  // 检查步骤中的分支名是否都在 keyParameters 中
  const undeclaredBranches = stepBranches.filter((b) => !declaredBranches.includes(b));
  if (undeclaredBranches.length > 0) {
    for (const b of undeclaredBranches) {
      fail(`步骤描述中出现分支名 '${b}'，但未在 keyParameters.branchNames 中声明 — 疑似分支名臆造/篡改`);
    }
  } else {
    ok('步骤描述中所有分支名均已在 keyParameters 中声明');
  }

  // 检查 keyParameters 中的分支名是否至少在一个步骤中被引用
  const unusedBranches = declaredBranches.filter((b) => !stepBranches.includes(b));
  if (unusedBranches.length > 0) {
    for (const b of unusedBranches) {
      warn(`keyParameters.branchNames 声明了 '${b}'，但步骤描述中未引用该分支名`);
    }
  } else {
    ok('keyParameters 中所有分支名均在步骤描述中被引用');
  }
}

// ── 5. URL 一致性检查（软检查，仅 warn）───────────────────
console.log('\n--- 5. URL 一致性检查 ---');

if (declaredUrls.length > 0 && stepUrls.length > 0) {
  const undeclaredUrls = stepUrls.filter((u) => !declaredUrls.includes(u));
  if (undeclaredUrls.length > 0) {
    for (const u of undeclaredUrls) {
      warn(`步骤描述中出现 URL '${u}'，但未在 keyParameters.repoUrls 中声明`);
    }
  } else {
    ok('步骤描述中所有 URL 均已在 keyParameters 中声明');
  }
} else if (declaredUrls.length === 0 && stepUrls.length > 0) {
  warn(`步骤描述中出现 URL 但 keyParameters.repoUrls 为空: ${stepUrls.join(', ')}`);
} else {
  ok('URL 参数检查通过（无 URL 或全部一致）');
}

// ── 汇总 ──────────────────────────────────────────────────
console.log(`\n=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
if (FAIL > 0) {
  console.log('###################################################');
  console.log('# 检测到关键参数不一致，步骤图无效！请对照原始  #');
  console.log('# 任务描述修正 keyParameters 及步骤描述后重新生成。 #');
  console.log('###################################################');
  process.exit(1);
} else {
  console.log(WARN === 0 ? 'ALL CHECKS PASSED' : 'ALL CHECKS PASSED (with warnings)');
  process.exit(0);
}
