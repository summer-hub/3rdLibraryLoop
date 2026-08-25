#!/usr/bin/env node
/**
 * validate-step-graph.cjs — 校验 task-decomposition SKILL 生成的步骤图是否存在死锁/循环。
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
 * BFS 可达性检查：从入口节点沿依赖关系遍历，标记所有可到达的步骤。
 *
 * 覆盖三类执行路径：
 *   - dependId：步骤依赖的前置（fan-in 聚合 + fan-out 并行），执行依赖关系
 *   - nextStepId 成功链（串行推进）
 *   - failStepId 失败回退链
 *
 * 从入口沿 dependId 反向传播（fan-out）：某步骤可达后，依赖它的并行步骤也可达。
 * 同时沿 nextStepId/failStepId 传播串行/回退链。
 *
 * @param {Map<string, object>} nodes - stepId -> step
 * @param {string[]} entryIds
 * @returns {Set<string>} 可到达的 stepId 集合
 */
function reachableFromEntries(nodes, entryIds) {
  // 反向依赖索引：dep -> 依赖它的步骤列表（fan-out 传播）
  // 同时维护正向邻接（nextStepId/failStepId）
  const dependents = new Map(); // 前置 id -> 依赖它的步骤 id[]
  for (const [sid, step] of nodes) {
    for (const dep of getDepIds(step.dependId)) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(sid);
    }
  }

  const visited = new Set();
  const queue = [...entryIds];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const node = nodes.get(cur);
    if (!node) continue;

    // dependId fan-out：被当前步骤依赖的并行步骤
    for (const dep of dependents.get(cur) || []) {
      if (!visited.has(dep)) queue.push(dep);
    }

    // nextStepId 成功链
    const next = String(node.nextStepId ?? 0);
    if (next !== '0' && nodes.has(next) && !visited.has(next)) {
      queue.push(next);
    }

    // failStepId 失败回退链
    const fail = String(node.failStepId ?? 0);
    if (fail !== '0' && nodes.has(fail) && !visited.has(fail)) {
      queue.push(fail);
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

/** 提取 dependId（支持单值或数组）的所有前置 ID 数组。排除 -1（修复步骤哨兵，仅应经 failStepId 触发，不是真实依赖 ID） */
function getDepIds(dependId) {
  if (Array.isArray(dependId)) {
    return dependId.map(String).filter((v) => v !== '0' && v !== '' && v !== '-1');
  }
  if (dependId == null) return [];
  const s = String(dependId);
  return s === '0' || s === '' || s === '-1' ? [] : [s];
}

// 引用有效性检查（引用的 stepId 必须存在，0 除外）
const refFields = ['nextStepId', 'failStepId'];
const refErrors = [];
for (const step of steps) {
  const sid = String(step.stepId);
  for (const field of refFields) {
    const ref = step[field];
    if (ref != null && ref !== 0 && ref !== '0' && !stepIds.has(String(ref))) {
      refErrors.push(`stepId=${sid}: ${field}=${ref} 引用了不存在的步骤`);
    }
  }
  // dependId 支持单值或数组，逐项校验
  for (const depId of getDepIds(step.dependId)) {
    if (!stepIds.has(depId)) {
      refErrors.push(`stepId=${sid}: dependId=${depId} 引用了不存在的步骤`);
    }
  }
}
if (refErrors.length > 0) {
  for (const e of refErrors) fail(e);
} else {
  ok('所有 dependId/nextStepId/failStepId 引用有效');
}

// ── 识别修复步骤集合（被其它步骤 failStepId 指向）─────────────────
const fixStepIds = new Set();
for (const step of steps) {
  const fail = String(step.failStepId ?? 0);
  if (fail !== '0' && stepIds.has(fail)) fixStepIds.add(fail);
}

// 入口步骤（dependId 无前置，或全部前置指向不存在步骤）。
// 排除修复步骤：即使其 dependId=0/空/-1，也只应经 failStepId 触发，不能当作入口。
const entryIds = Array.from(nodes.keys()).filter((sid) => {
  if (fixStepIds.has(sid)) return false;
  const deps = getDepIds(nodes.get(sid).dependId);
  return deps.length === 0 || deps.every((d) => !stepIds.has(d));
});
if (entryIds.length === 0) {
  fail('无入口步骤（排除修复步骤后，至少需要一个 dependId=0 的步骤）');
} else {
  ok(`入口步骤存在: ${entryIds.join(', ')}`);
}
if (fixStepIds.size > 0) {
  ok(`修复步骤识别: ${Array.from(fixStepIds).join(', ')}（仅经 failStepId 触发，不计入入口）`);
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

// ── 3. 依赖环检测（dependId，支持单值或数组）───────────────
const depGraph = new Map();
for (const [sid, step] of nodes) {
  // 每个前置依赖作为一条 dependId 边；排除自身回退
  const deps = getDepIds(step.dependId).filter((d) => d !== sid);
  depGraph.set(sid, deps);
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

// ── 4.1 修复链歧义图检查（failStepId 目标被 dependId 反向依赖）──
// 若 A.failStepId=B 且 B.dependId 包含 A，则 B 既被"失败条件边"进入，又被 dependId
// 当作"成功依赖边"。Orchestrator 已能正确运行此类图（A 成功时跳过 failStepId 目标、
// A 失败时跳过依赖聚合），故此处仅 WARN 提示语义不清晰，建议修复步骤不声明修复目标为
// 成功依赖（默认 WARN 不阻塞，可通过 --strict 提升为 FAIL）。
const fixChainAmbiguities = [];
for (const [fromId, fromStep] of nodes) {
  const failTarget = String(fromStep.failStepId ?? 0);
  if (failTarget === '0' || !nodes.has(failTarget)) continue;
  const targetStep = nodes.get(failTarget);
  const deps = getDepIds(targetStep.dependId);
  if (deps.includes(fromId)) {
    fixChainAmbiguities.push(`步骤${fromId} 的 failStepId=${failTarget}，但修复步骤${failTarget} 的 dependId 又包含 ${fromId}`);
  }
}
if (fixChainAmbiguities.length > 0) {
  for (const msg of fixChainAmbiguities) {
    warn(`修复链歧义图（dependId 与 failStepId 反向重叠）: ${msg}。建议从修复步骤的 dependId 中移除其修复目标，Orchestrator 仍可正确执行。`);
  }
} else {
  ok('无修复链歧义图（failStepId 目标未被 dependId 反向依赖）');
}

// ── 4.2 修复步骤被并行 dependId 依赖检查（fan-out 误激活）──
// 修复步骤 B（被某步骤 A 的 failStepId 指向）的 dependId 若包含 A 或 A 的"依赖祖先"
// （即能让 B 与 A 在同一轮并行 READY 的节点），则 A 的前置完成后 B 会被 fan-out 并行
// 激活，与真正的验证步骤 A 落入同一并行轮次，导致误执行/阻塞后续链。
// 判定"祖先"：沿 dependId 链逆向可达 A 的节点（含 A 本身）。
// Orchestrator 已兜底禁止修复步骤被 fan-out 激活，故此处仅 WARN 提示语义不清晰。
function collectDepAncestors(startId) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const curStep = nodes.get(cur);
    if (!curStep) continue;
    for (const dep of getDepIds(curStep.dependId)) {
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return seen;
}

const fixFanoutIssues = [];
for (const [fixId, fixStep] of nodes) {
  const triggerSources = [];
  for (const [sid, s] of nodes) {
    if (String(s.failStepId ?? 0) === fixId) {
      triggerSources.push(sid);
    }
  }
  if (triggerSources.length === 0) continue; // 不是修复步骤
  const fixDeps = getDepIds(fixStep.dependId);
  if (fixDeps.length === 0) continue; // 无 dependId，不存在 fan-out 风险
  for (const src of triggerSources) {
    const srcAncestors = collectDepAncestors(src); // 含 src 本身及其全部依赖祖先
    const overlap = fixDeps.filter((d) => srcAncestors.has(d));
    if (overlap.length > 0) {
      fixFanoutIssues.push(`修复步骤${fixId}（步骤${triggerSources.join('/')} 的 failStepId 目标）的 dependId ${overlap.join(',')} 与触发源步骤${src} 的依赖祖先重叠，触发源前置完成后会与触发源并行 fan-out 激活`);
    }
  }
}
if (fixFanoutIssues.length > 0) {
  for (const msg of fixFanoutIssues) {
    warn(`修复步骤 fan-out 误激活风险: ${msg}。修复步骤只应经 failStepId 触发，Orchestrator 已兜底禁止并行激活。`);
  }
} else {
  ok('无修复步骤 fan-out 误激活风险');
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