#!/usr/bin/env node
/**
 * validate-step-graph.cjs — 校验 TaskDecompositionSkill 生成的步骤图是否存在死锁/循环。
 *
 * 检测范围（覆盖成功链 / 失败链 / 依赖链三类有向边 + 可达性）：
 *   1. 成功链环（nextStepId 边成环）—— 如 step4.nextStepId→5、step5.nextStepId→4
 *   2. 失败链环（failStepId 边成环）—— 自回退 failStepId==自己 且配合 maxRetries 视为合法
 *   3. 依赖环（dependId 边成环）—— 导致拓扑无法启动
 *   4. 不可达/孤立步骤—— 从入口沿 nextStepId 链无法到达的步骤，永远无法被激活
 *   5. 成功链无终止—— 所有步骤沿 next 链均无 nextStepId=0
 *
 * 任一项 FAIL 则 process.exit(1)，供 SKILL 强制重拆解。
 *
 * 用法（与既有脚本兼容的两种调用方式）：
 *   node validate-step-graph.cjs <resultFilePath>
 *   node validate-step-graph.cjs '{"resultFile":"<resultFilePath>"}'
 *
 * 依赖：仅 Node 内置 fs/path，无第三方依赖，跨平台（Windows/PowerShell 可用）。
 */

const fs = require('fs');
const path = require('path');

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

/**
 * 通用有向环检测（DFS 三色标记）。
 * @param {Map<string, string[]>} graph - stepId -> 邻接表（可达的 stepId 列表）
 * @param {string} edgeName - 边名称，用于错误提示
 * @returns {string[]} 检测到的环路径列表（如 ["4 → 5 → 4"]）
 */
function findCycles(graph, edgeName) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const cycles = [];
  const stack = [];

  for (const id of graph.keys()) color.set(id, WHITE);

  const dfs = (id) => {
    color.set(id, GRAY);
    stack.push(id);
    for (const next of graph.get(id) || []) {
      if (!graph.has(next)) continue; // 引用不存在的步骤由引用校验负责
      if (color.get(next) === GRAY) {
        // 找到环：从 next 在 stack 中的位置起截取
        const startIdx = stack.indexOf(next);
        const cycle = stack.slice(startIdx).concat(next);
        cycles.push(cycle.join(' → '));
      } else if (color.get(next) === WHITE) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) dfs(id);
  }

  return cycles;
}

/**
 * BFS 可达性检查：从入口节点沿 nextStepId 链，标记所有可到达的步骤。
 * @param {Map<string, object>} nodes - stepId -> step
 * @param {string[]} entryIds
 * @returns {Set<string>} 可到达的 stepId 集合
 */
function reachableFromEntries(nodes, entryIds) {
  const visited = new Set();
  const queue = [...entryIds];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = nodes.get(cur);
    if (!node) continue;
    const next = String(node.nextStepId ?? 0);
    if (next !== '0' && nodes.has(next) && !visited.has(next)) {
      queue.push(next);
    }
  }
  return visited;
}

// ── 入口与参数解析 ────────────────────────────────────────
const args = process.argv.slice(2);
let resultFile = '';

if (args.length === 0) {
  console.error('Usage: node validate-step-graph.cjs <resultFilePath>');
  console.error('   or: node validate-step-graph.cjs \'{"resultFile":"<resultFilePath>"}\'');
  process.exit(1);
}

// 兼容 JSON 参数（MCP 脚本调用约定：第一个参数为 JSON 字符串）
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

if (!resultFile) resultFile = first; // 回退为位置参数

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

if (raw.trim() !== jsonStr.trim()) {
  warn('输出包含非 JSON 内容（markdown 包裹或其他文字），建议输出纯 JSON');
}

// ── 顶层结构 ──────────────────────────────────────────────
if (!data || typeof data !== 'object' || !Array.isArray(data.steps)) {
  fail("顶层应为包含 'steps' 数组的 object");
  console.log(`\n=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
  process.exit(1);
}

const steps = data.steps;
if (steps.length === 0) {
  fail("'steps' 数组为空");
  console.log(`\n=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
  process.exit(1);
}
ok(`steps 数组存在且非空 (${steps.length} 个步骤)`);

// ── 构建节点表与邻接表 ────────────────────────────────────
const nodes = new Map(); // stepId(str) -> step
const stepIds = new Set();

for (const step of steps) {
  if (step && step.stepId != null) {
    const id = String(step.stepId);
    nodes.set(id, step);
    stepIds.add(id);
  }
}

// 引用有效性检查（引用的 stepId 必须存在，0 除外）
const refFields = ['dependId', 'nextStepId', 'failStepId'];
const refErrors = [];
for (const step of steps) {
  const sid = String(step.stepId);
  for (const field of refFields) {
    const ref = step[field];
    if (ref != null && ref !== 0 && ref !== '0' && !stepIds.has(String(ref))) {
      refErrors.push(`stepId=${sid}: ${field}=${ref} 引用了不存在的步骤`);
    }
  }
}
if (refErrors.length > 0) {
  for (const e of refErrors) fail(e);
} else {
  ok('所有 dependId/nextStepId/failStepId 引用有效');
}

// 入口步骤（dependId==0 或指向不存在步骤）
const entryIds = Array.from(nodes.keys()).filter((sid) => {
  const d = nodes.get(sid).dependId;
  return d == null || d === 0 || d === '0' || !stepIds.has(String(d));
});
if (entryIds.length === 0) {
  fail('无入口步骤（至少需要一个 dependId=0 的步骤）');
} else {
  ok(`入口步骤存在: ${entryIds.join(', ')}`);
}

// ── 1. 成功链环检测（nextStepId）──────────────────────────
const nextGraph = new Map();
for (const [sid, step] of nodes) {
  const n = step.nextStepId;
  nextGraph.set(sid, n != null && n !== 0 && n !== '0' ? [String(n)] : []);
}
const nextCycles = findCycles(nextGraph, 'nextStepId');
if (nextCycles.length > 0) {
  for (const c of nextCycles) fail(`成功链环（nextStepId）: ${c}`);
} else {
  ok('成功链（nextStepId）无明显循环');
}

// ── 2. 失败链环检测（failStepId，允许自身回退）────────────
const failGraph = new Map();
for (const [sid, step] of nodes) {
  const f = step.failStepId;
  // 自身回退（failStepId==自己）配合 maxRetries 视为合法修复循环，跳过
  const self = f != null && String(f) === sid;
  failGraph.set(sid, f != null && f !== 0 && f !== '0' && !self ? [String(f)] : []);
}
const failCycles = findCycles(failGraph, 'failStepId');
if (failCycles.length > 0) {
  for (const c of failCycles) fail(`失败链环（failStepId）: ${c}`);
} else {
  ok('失败链（failStepId）无明显循环');
}

// ── 3. 依赖环检测（dependId）──────────────────────────────
const depGraph = new Map();
for (const [sid, step] of nodes) {
  const d = step.dependId;
  depGraph.set(sid, d != null && d !== 0 && d !== '0' && String(d) !== sid ? [String(d)] : []);
}
const depCycles = findCycles(depGraph, 'dependId');
if (depCycles.length > 0) {
  for (const c of depCycles) fail(`依赖环（dependId）: ${c}`);
} else {
  ok('依赖（dependId）无明显循环');
}

// ── 4. 可达性检查（从入口沿 nextStepId 链）────────────────
const reachable = reachableFromEntries(nodes, entryIds);
const unreachable = Array.from(nodes.keys()).filter((sid) => !reachable.has(sid));
if (unreachable.length > 0) {
  for (const sid of unreachable) {
    fail(`步骤 ${sid} 不可达（从入口沿 nextStepId 链无法到达），永远不会被执行`);
  }
} else {
  ok('所有步骤均从入口可达');
}

// ── 5. 成功链无终止检测 ───────────────────────────────────
const noTerminal = Array.from(nodes.values()).every(
  (s) => s.nextStepId != null && s.nextStepId !== 0 && s.nextStepId !== '0'
);
if (noTerminal) {
  fail('成功链无终止步骤（所有步骤 nextStepId 均非 0，无法结束）');
} else {
  ok('存在终止步骤（nextStepId=0）');
}

// ── 汇总 ──────────────────────────────────────────────────
console.log(`\n=== 校验结果: ${PASS} passed, ${FAIL} failed, ${WARN} warnings ===`);
if (FAIL > 0) {
  console.log('###################################################');
  console.log('# 检测到死锁/循环，步骤图无效！请修正后重新生成。 #');
  console.log('###################################################');
  process.exit(1);
} else {
  console.log(WARN === 0 ? 'ALL CHECKS PASSED' : 'ALL CHECKS PASSED (with warnings)');
  process.exit(0);
}