#!/usr/bin/env node
/**
 * @tool validate-decomposition-output
 * @description 校验 task-decomposition SKILL 输出的 JSON 是否符合规范（字段完整、类型正确、依赖图有效、验收标准合规）。跨平台（Windows/macOS/Linux），仅需 Node.js。
 * @param resultFile: string - 拆解结果 JSON 文件路径
 *
 * validate-decomposition-output.cjs
 *
 * 用法（两种调用方式兼容）:
 *   node validate-decomposition-output.cjs <resultFilePath>
 *   node validate-decomposition-output.cjs '{"resultFile":"<resultFilePath>"}'
 *
 * 依赖：仅 Node 内置 fs/path，无第三方依赖。
 */

'use strict';

const fs = require('node:fs');

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

function parseArgs(argv) {
  if (argv.length === 0) return {};
  const first = argv[0];
  if (typeof first === 'string' && first.startsWith('{')) {
    try { return JSON.parse(first); } catch (e) { return {}; }
  }
  return { resultFile: first };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const resultFile = args.resultFile || '';

  if (!resultFile) {
    console.log('Usage: node validate-decomposition-output.cjs <resultFile>');
    console.log('Error: resultFile parameter is required');
    process.exit(1);
  }

  if (!fs.existsSync(resultFile) || !fs.statSync(resultFile).isFile()) {
    console.log(`Error: File does not exist: ${resultFile}`);
    process.exit(1);
  }

  console.log('=== TaskDecomposition 输出校验 ===');
  console.log(`文件: ${resultFile}`);
  console.log('');

  const raw = fs.readFileSync(resultFile, 'utf-8');

  // 尝试提取纯 JSON（容错：容忍 markdown 包裹）
  const jsonStr = extractJson(raw);
  if (!jsonStr) {
    fail('文件中未找到 JSON 内容（缺少 { 或 }）');
    summary();
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
    ok('JSON 格式合法可解析');
  } catch (e) {
    fail(`JSON 解析失败: ${e.message}`);
    summary();
    process.exit(1);
  }

  // 检查是否有 markdown 包裹
  if (raw.trim() !== jsonStr.trim()) {
    warn('输出包含非 JSON 内容（markdown 包裹或其他文字），建议输出纯 JSON');
  }

  // ─── 1. 顶层结构检查 ───
  console.log('');
  console.log('--- 1. 顶层结构检查 ---');

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail(`顶层应为 object，实际为 ${Array.isArray(data) ? 'array' : typeof data}`);
    summary();
    process.exit(1);
  }

  if (!('steps' in data)) {
    fail("缺少 'steps' 字段");
    summary();
    process.exit(1);
  }

  const steps = data.steps;
  if (!Array.isArray(steps)) {
    fail(`'steps' 应为 array，实际为 ${typeof steps}`);
    summary();
    process.exit(1);
  }

  if (steps.length === 0) {
    fail("'steps' 数组为空");
    summary();
    process.exit(1);
  }

  ok(`steps 数组存在且非空 (${steps.length} 个步骤)`);

  // ─── 2. 步骤字段检查 ───
  console.log('');
  console.log('--- 2. 步骤字段检查 ---');

  const stepIds = new Set();
  const entrySteps = [];
  const exitSteps = [];

  steps.forEach((step, i) => {
    const stepNum = i + 1;
    const errors = [];

    // stepId
    if (!('stepId' in step)) {
      errors.push(`步骤${stepNum}: 缺少 stepId`);
    } else if (typeof step.stepId !== 'number') {
      errors.push(`步骤${stepNum}: stepId 应为 number，实际为 ${typeof step.stepId}`);
    } else {
      const sid = step.stepId;
      if (stepIds.has(sid)) {
        errors.push(`步骤${stepNum}: stepId=${sid} 重复`);
      }
      stepIds.add(sid);
      if (sid < 1) {
        errors.push(`步骤${stepNum}: stepId=${sid} 应 ≥ 1`);
      }
    }

    // taskDescription
    if (!('taskDescription' in step)) {
      errors.push(`步骤${stepNum}: 缺少 taskDescription`);
    } else if (typeof step.taskDescription !== 'string' || !step.taskDescription.trim()) {
      errors.push(`步骤${stepNum}: taskDescription 为空或非 string`);
    }

    // dependId（支持 number 或 number[]，fan-in 聚合；-1 为修复步骤哨兵）
    const did = step.dependId;
    if (!('dependId' in step)) {
      errors.push(`步骤${stepNum}: 缺少 dependId`);
    } else if (typeof did !== 'number' && !Array.isArray(did)) {
      errors.push(`步骤${stepNum}: dependId 应为 number 或 array`);
    } else if (Array.isArray(did)) {
      did.forEach((dep) => {
        if (typeof dep !== 'number') {
          errors.push(`步骤${stepNum}: dependId 数组元素应为 number`);
        }
      });
    }

    // nextStepId
    if (!('nextStepId' in step)) {
      errors.push(`步骤${stepNum}: 缺少 nextStepId`);
    } else if (typeof step.nextStepId !== 'number') {
      errors.push(`步骤${stepNum}: nextStepId 应为 number，实际为 ${typeof step.nextStepId}`);
    }

    // failStepId
    if (!('failStepId' in step)) {
      errors.push(`步骤${stepNum}: 缺少 failStepId`);
    } else if (typeof step.failStepId !== 'number') {
      errors.push(`步骤${stepNum}: failStepId 应为 number，实际为 ${typeof step.failStepId}`);
    }

    // maxRetries
    if (!('maxRetries' in step)) {
      warn(`步骤${stepNum}: 缺少 maxRetries（将使用兜底值 3）`);
    } else if (typeof step.maxRetries !== 'number' || step.maxRetries < 1) {
      errors.push(`步骤${stepNum}: maxRetries 应为 ≥ 1 的 number`);
    }

    // acceptanceCriteria
    if (!('acceptanceCriteria' in step)) {
      warn(`步骤${stepNum}: 缺少 acceptanceCriteria`);
    } else if (!Array.isArray(step.acceptanceCriteria)) {
      errors.push(`步骤${stepNum}: acceptanceCriteria 应为 array`);
    } else if (step.acceptanceCriteria.length === 0) {
      warn(`步骤${stepNum}: acceptanceCriteria 为空数组`);
    } else {
      step.acceptanceCriteria.forEach((ac, j) => {
        const acNum = j + 1;
        const acErrors = [];

        if (typeof ac !== 'object' || ac === null || Array.isArray(ac)) {
          acErrors.push(`AC${acNum}: 应为 object`);
        } else {
          if (!('id' in ac) || !ac.id) {
            acErrors.push(`AC${acNum}: 缺少 id`);
          } else if (!/^ac\d+_\d+$/.test(String(ac.id))) {
            acErrors.push(`AC${acNum}: id 格式应为 ac{stepId}_{序号}，实际为 '${ac.id}'`);
          }

          if (!('criterion' in ac) || !String(ac.criterion || '').trim()) {
            acErrors.push(`AC${acNum}: 缺少 criterion 或为空`);
          }

          if (!('type' in ac)) {
            acErrors.push(`AC${acNum}: 缺少 type`);
          } else if (!['output', 'quality', 'performance', 'compliance'].includes(ac.type)) {
            acErrors.push(`AC${acNum}: type 应为 output/quality/performance/compliance，实际为 '${ac.type}'`);
          }

          if (!('verification' in ac) || !String(ac.verification || '').trim()) {
            acErrors.push(`AC${acNum}: 缺少 verification 或为空`);
          }

          if (!('taskACIds' in ac)) {
            acErrors.push(`AC${acNum}: 缺少 taskACIds`);
          } else if (!Array.isArray(ac.taskACIds)) {
            acErrors.push(`AC${acNum}: taskACIds 应为 array`);
          }
        }

        acErrors.forEach((e) => errors.push(`步骤${stepNum} ${e}`));
      });
    }

    if (errors.length > 0) {
      errors.forEach((e) => fail(e));
    } else {
      ok(`步骤${stepNum} (stepId=${step.stepId}): 字段完整`);
    }

    // 记录入口和终止步骤（dependId 支持单值或数组，空数组视为入口；-1 为修复步骤哨兵，不计入入口）
    const didVal = step.dependId;
    const isEntry = didVal === undefined || didVal === null || didVal === 0 ||
      (Array.isArray(didVal) && didVal.length === 0);
    if (isEntry) entrySteps.push(step.stepId);
    if (step.nextStepId === 0) exitSteps.push(step.stepId);
  });

  // ─── 3. 依赖图检查 ───
  console.log('');
  console.log('--- 3. 依赖图检查 ---');

  if (entrySteps.length === 0) {
    fail('无入口步骤（至少需要一个 dependId=0 的步骤）');
  } else {
    ok(`入口步骤存在: ${JSON.stringify(entrySteps)}`);
  }

  if (exitSteps.length === 0) {
    fail('无终止步骤（至少需要一个 nextStepId=0 的步骤）');
  } else {
    ok(`终止步骤存在: ${JSON.stringify(exitSteps)}`);
  }

  // 引用有效性（dependId 支持单值或数组）
  const refErrors = [];
  steps.forEach((step) => {
    const sid = step.stepId;
    // nextStepId / failStepId 为单值
    ['nextStepId', 'failStepId'].forEach((field) => {
      const ref = step[field];
      if (ref !== 0 && !stepIds.has(ref)) {
        refErrors.push(`stepId=${sid}: ${field}=${ref} 引用了不存在的步骤`);
      }
    });
    // dependId 支持单值或数组（-1 为修复步骤哨兵，合法）
    const did = step.dependId;
    const depIds = Array.isArray(did) ? did : (did !== undefined && did !== null ? [did] : []);
    depIds.forEach((dep) => {
      if (dep !== 0 && dep !== -1 && !stepIds.has(dep)) {
        refErrors.push(`stepId=${sid}: dependId=${dep} 引用了不存在的步骤`);
      }
    });
  });

  if (refErrors.length > 0) {
    refErrors.forEach((e) => fail(e));
  } else {
    ok('所有 dependId/nextStepId/failStepId 引用有效');
  }

  // 简单循环检测（failStepId 链）
  const stepsDict = new Map(steps.map((s) => [s.stepId, s]));
  const loopWarnings = checkFailLoop(stepsDict);
  if (loopWarnings.length > 0) {
    loopWarnings.forEach((w) => warn(w));
  } else {
    ok('failStepId 链无明显无限循环');
  }

  // ─── 4. stepId 连续性检查 ───
  console.log('');
  console.log('--- 4. stepId 连续性检查 ---');

  const sortedIds = [...stepIds].sort((a, b) => a - b);
  const expectedIds = Array.from({ length: stepIds.size }, (_, i) => i + 1);
  if (JSON.stringify(sortedIds) === JSON.stringify(expectedIds)) {
    ok(`stepId 从 1 连续递增到 ${stepIds.size}`);
  } else {
    warn(`stepId 非连续递增: ${JSON.stringify(sortedIds)}（建议从 1 开始连续编号）`);
  }

  // ─── 5. 验收标准覆盖检查 ───
  console.log('');
  console.log('--- 5. 验收标准覆盖检查 ---');

  const allTaskAcIds = new Set();
  steps.forEach((step) => {
    (step.acceptanceCriteria || []).forEach((ac) => {
      if (typeof ac === 'object' && ac !== null && Array.isArray(ac.taskACIds)) {
        ac.taskACIds.forEach((tid) => allTaskAcIds.add(tid));
      }
    });
  });

  if (allTaskAcIds.size > 0) {
    ok(`步骤级 AC 共引用了 ${allTaskAcIds.size} 个任务级 AC ID: ${JSON.stringify([...allTaskAcIds].sort())}`);
  } else {
    warn('步骤级 AC 未引用任何任务级 AC ID（taskACIds 均为空）');
  }

  summary();
  process.exit(FAIL > 0 ? 1 : 0);
}

/** 检测 failStepId 链是否可能形成无限循环 */
function checkFailLoop(stepsDict) {
  const warnings = [];
  for (const [startId] of stepsDict) {
    const visited = new Set();
    let current = startId;
    const chain = [];
    while (current && current !== 0) {
      if (visited.has(current)) {
        const chainStr = [...chain, current].join(' → ');
        warnings.push(`步骤${startId} 的 failStepId 链可能循环: ${chainStr}`);
        break;
      }
      visited.add(current);
      chain.push(current);
      const currentStep = stepsDict.get(current);
      if (!currentStep) break;
      // 沿 failStepId 追踪
      current = currentStep.failStepId ?? 0;
      if (current === 0) break;
      // 如果 failStepId 指向自己（自身回退，配合 maxRetries 合法）
      if (current === startId) break;
    }
  }
  return warnings;
}

function summary() {
  console.log('');
  console.log(`=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
  if (FAIL === 0) {
    console.log(WARN === 0 ? 'ALL CHECKS PASSED' : 'ALL CHECKS PASSED (with warnings)');
  }
}

main();
