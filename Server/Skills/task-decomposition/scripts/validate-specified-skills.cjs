#!/usr/bin/env node
/**
 * @tool validate-specified-skills
 * @description 校验 task-decomposition 输出 JSON 中步骤的 specifiedSkill 字段：引用的 SKILL 必须存在于实时扫描的可用 SKILL 列表（黑名单过滤后），且 taskDescription 中不得出现旧式"推荐使用 X SKILL 执行"文本。跨平台（Windows/macOS/Linux），仅需 Node.js。
 * @param resultFile: string - 拆解结果 JSON 文件路径
 * @param root: string - SKILL 根目录路径（可选，默认为脚本所在 SKILL 的上级目录）
 *
 * validate-specified-skills.cjs
 *
 * 用法（两种调用方式兼容）:
 *   node validate-specified-skills.cjs <resultFilePath>
 *   node validate-specified-skills.cjs <resultFilePath> --root /path/to/Skills
 *   node validate-specified-skills.cjs '{"resultFile":"<resultFilePath>","root":"/path/to/Skills"}'
 *
 * 校验规则（任一 FAIL 则以非零码退出）:
 *   1. specifiedSkill 存在性 — 每个步骤的 specifiedSkill（非空时）必须能在可用 SKILL 列表
 *      中按 name 或目录名匹配（大小写不敏感）。引用不存在的 SKILL（含黑名单中的 SKILL）
 *      判定为臆造引用。
 *   2. specifiedSkill 类型 — 若字段存在则必须为非空字符串或空串（空串视为未指定，合法）。
 *   3. 旧式推荐文本拦截 — taskDescription 中出现「推荐使用 X SKILL 执行」模式判定为
 *      FAIL（该模式已废止，应改用 specifiedSkill 字段）。
 *
 * 依赖：仅 Node 内置 fs/path，无第三方依赖。可用列表扫描逻辑复用 list-available-skills.cjs。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { scanSkills, DEFAULT_ROOT } = require('./list-available-skills.cjs');

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

// ── 入口与参数解析 ────────────────────────────────────────

/**
 * 解析 CLI 参数（兼容位置参数 + flag 与 JSON 字符串两种形式）。
 *
 * @param {string[]} argv
 * @returns {{resultFile: string, root: string}}
 */
function parseArgs(argv) {
  const args = { resultFile: '', root: '' };

  // JSON 字符串形式：{"resultFile": "...", "root": "..."}
  if (argv.length > 0 && typeof argv[0] === 'string' && argv[0].startsWith('{')) {
    try {
      const parsed = JSON.parse(argv[0]);
      if (parsed.resultFile) args.resultFile = String(parsed.resultFile);
      if (parsed.root) args.root = String(parsed.root);
      if (parsed.resultFile) return args;
    } catch {
      // 解析失败则按位置参数形式继续
    }
  }

  // 位置参数 + flag 形式：<resultFile> [--root <path>]
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) {
      args.root = argv[i + 1];
      i++;
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length > 0) args.resultFile = positional[0];
  return args;
}

function main() {
  const { resultFile, root } = parseArgs(process.argv.slice(2));

  if (!resultFile) {
    console.log('Usage: node validate-specified-skills.cjs <resultFile> [--root <skillsRoot>]');
    console.log('Error: resultFile parameter is required');
    process.exit(1);
  }

  if (!fs.existsSync(resultFile) || !fs.statSync(resultFile).isFile()) {
    console.log(`Error: File does not exist: ${resultFile}`);
    process.exit(1);
  }

  console.log('=== TaskDecomposition specifiedSkill 校验 ===');
  console.log(`文件: ${resultFile}`);
  console.log('');

  const raw = fs.readFileSync(resultFile, 'utf-8');

  const jsonStr = extractJson(raw);
  if (!jsonStr) {
    fail('文件中未找到 JSON 内容（缺少 { 或 }）');
    summary();
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    fail(`JSON 解析失败: ${e.message}`);
    summary();
    process.exit(1);
  }

  const steps = Array.isArray(data.steps) ? data.steps : [];
  if (steps.length === 0) {
    fail("缺少非空的 'steps' 数组");
    summary();
    process.exit(1);
  }

  // ── 实时扫描可用 SKILL 列表（黑名单过滤后）作为合法集合 ──
  const skillsRoot = root || DEFAULT_ROOT;
  let available;
  try {
    available = scanSkills(skillsRoot, []);
  } catch (e) {
    fail(`扫描可用 SKILL 列表失败（root=${skillsRoot}）: ${e.message}`);
    summary();
    process.exit(1);
  }

  const validNames = new Set(); // name 与目录名均合法（小写）
  for (const s of available) {
    validNames.add(s.name.toLowerCase());
    validNames.add(s.dir.toLowerCase());
  }

  console.log(`可用 SKILL 列表: ${available.length} 个（root=${skillsRoot}，黑名单已过滤）`);
  console.log('');

  // ── 1. specifiedSkill 存在性 + 类型校验 ──
  console.log('--- 1. specifiedSkill 校验 ---');

  let specifiedCount = 0;
  let attemptedCount = 0;
  const legacyPattern = /推荐使用\s*\S+\s*SKILL\s*执行/;

  steps.forEach((step, i) => {
    const stepNum = i + 1;
    const label = `步骤${stepNum} (stepId=${step && step.stepId})`;

    // specifiedSkill 为可选字段：不存在或空串均视为未指定
    if (step && 'specifiedSkill' in step && step.specifiedSkill !== undefined && step.specifiedSkill !== null && String(step.specifiedSkill).trim() !== '') {
      attemptedCount++;
      if (typeof step.specifiedSkill !== 'string') {
        fail(`${label}: specifiedSkill 应为 string，实际为 ${typeof step.specifiedSkill}`);
        return;
      }
      const value = step.specifiedSkill.trim();
      if (!validNames.has(value.toLowerCase())) {
        fail(`${label}: specifiedSkill="${value}" 不在可用 SKILL 列表中（臆造引用或黑名单 SKILL），可用列表请运行 node scripts/list-available-skills.cjs 查看`);
        return;
      }
      specifiedCount++;
      ok(`${label}: specifiedSkill="${value}" 存在于可用 SKILL 列表`);
    }

    // 旧式推荐文本拦截（无论是否设置 specifiedSkill 都不允许出现）
    const desc = (step && typeof step.taskDescription === 'string') ? step.taskDescription : '';
    if (legacyPattern.test(desc)) {
      fail(`${label}: taskDescription 含旧式推荐文本「推荐使用 X SKILL 执行」，该模式已废止，请改用 specifiedSkill 字段并删除该句`);
    }
  });

  if (specifiedCount === 0 && attemptedCount === 0) {
    warn('所有步骤均未设置 specifiedSkill（合法；若有职责匹配可用 SKILL 的步骤建议设置）');
  } else if (specifiedCount > 0) {
    ok(`共 ${specifiedCount} 个步骤绑定了 specifiedSkill`);
  }

  // ── 2. 旧式推荐文本全量扫描（含非步骤字段兜底） ──
  console.log('');
  console.log('--- 2. 旧式推荐文本扫描 ---');

  if (legacyPattern.test(raw)) {
    // steps 循环中已逐条 fail，这里只做兜底提示（如出现在其他字段）
    if (!steps.some(s => s && typeof s.taskDescription === 'string' && legacyPattern.test(s.taskDescription))) {
      fail('结果文件中存在旧式推荐文本「推荐使用 X SKILL 执行」（非步骤描述位置），请移除');
    }
  } else {
    ok('未发现旧式推荐文本「推荐使用 X SKILL 执行」');
  }

  summary();
  process.exit(FAIL > 0 ? 1 : 0);
}

function summary() {
  console.log('');
  console.log(`=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
  if (FAIL === 0) {
    console.log(WARN === 0 ? 'ALL CHECKS PASSED' : 'ALL CHECKS PASSED (with warnings)');
  }
}

main();
