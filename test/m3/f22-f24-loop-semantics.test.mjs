/**
 * M3 验收：F-22 审核出错 ≠ 审核不通过 / F-24 恢复后的状态收敛
 *
 * F-22（核心语义）：TestCheck 返回 status=error（审核环节故障，"没跑起来"）
 * 与 status=failed（判定"不通过"）必须区别对待：
 *   A 审核出错会按 LOOP_CHECK_MAX_ATTEMPTS 重试
 *   B 重试仍出错 → 终态为 ERROR，且原因明确说明是"审核环节故障"
 *     （绝不谎报"达到最大循环次数，准出审核仍未通过"）
 *   C 审核出错**不消耗轮次**去驱动重规划（Brain 不会被再次调用去编造失败原因）
 *   D 真实判定不通过时，行为与原来一致：进入下一轮重规划直到 maxLoops → FAILED
 *
 * F-24：恢复时"进行中"状态投影为 interrupted（原实现会永远显示"运行中"）
 *   E planning/executing/checking → interrupted
 *   F aborting → aborted（且 aborted=true）
 *   G 终态原样保留；未知值 → idle
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { LoopEngine, LoopStatus } = await import(pathToFileURL(`${ROOT}Server/LoopEngine/index.js`).href);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/** 构造可编程的依赖桩 */
function makeDeps({ checkResults = [], onBrainCall, varyPlans = false } = {}) {
    const state = { brainCalls: 0, checkCalls: 0, loadCalls: 0 };
    const checkQueue = [...checkResults];

    // varyPlans=true → 每轮产出**不同**的步骤图（模拟"重规划确实在变化"）；
    // 否则每轮完全相同（F-23 会判定为计划振荡）
    const makeTaskDef = (n) => ({
        taskId: 'loopTask',
        steps: [{
            stepId: 1,
            taskDescription: varyPlans ? `s1-轮次${n}` : 's1',
            dependId: 0,
            nextStepId: 0,
        }],
    });

    const brain = {
        planTask: async () => {
            state.brainCalls++;
            onBrainCall?.(state.brainCalls);
            return {
                taskDef: makeTaskDef(state.brainCalls),
                analysis: { acceptanceCriteria: ['c1'], intent: 'i', domain: 'd', complexity: 'low' },
            };
        },
        replanTask: async () => {
            state.brainCalls++;
            onBrainCall?.(state.brainCalls);
            return {
                taskDef: makeTaskDef(state.brainCalls),
                analysis: { acceptanceCriteria: ['c1'], intent: 'i', domain: 'd', complexity: 'low' },
            };
        },
        loadPlan: async () => null,
    };

    const orch = {
        status: 'completed',
        taskId: 'loopTask',
        getProgress: () => ({ status: 'completed', taskId: 'loopTask', steps: [] }),
    };
    const orchestratorController = {
        load: async () => { state.loadCalls++; },
        start: async () => {},
        _getOrchestrator: () => orch,
        disposeOrchestrator: () => true,
    };

    const testCheck = {
        runCheck: async () => {
            state.checkCalls++;
            const next = checkQueue.length > 1 ? checkQueue.shift() : checkQueue[0];
            return { ...next };
        },
    };

    const storage = {
        manager: { rootDir: os.tmpdir() },
        json: () => ({ read: async () => null, write: async () => ({}), delete: async () => true }),
        taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
        taskRegistryStore: () => ({ upsert: async () => ({}), patch: async () => ({}) }),
    };

    return { state, brain, orchestratorController, testCheck, storage };
}

const ERROR_CHECK = { status: 'error', passed: false, error: 'selector 未匹配到审核 SKILL', summary: '' };
const FAILED_CHECK = { status: 'failed', passed: false, summary: '2/5 标准未满足', improvementSuggestions: ['补齐 x'] };

async function runLoop({ checkResults, maxLoops = 3, env, varyPlans = false, envVars = null } = {}) {
    const deps = makeDeps({ checkResults, varyPlans });
    const engine = new LoopEngine({
        brainController: { _getBrain: () => deps.brain },
        orchestratorController: deps.orchestratorController,
        testCheck: deps.testCheck,
        storage: deps.storage,
        skillDirectory: ROOT + 'Server/Skills',
    });

    // 环境变量：进入前保存、结束后恢复，避免用例之间互相污染
    const saved = new Map();
    const toSet = { ...(env ? { LOOP_CHECK_MAX_ATTEMPTS: env } : {}), ...(envVars || {}) };
    for (const [k, v] of Object.entries(toSet)) {
        saved.set(k, process.env[k]);
        process.env[k] = String(v);
    }

    let result;
    try {
        result = await engine.startLoop({ taskId: 'loopTask', taskDescription: '测试任务', maxLoops });
    } finally {
        for (const [k, v] of saved) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
    return { result, state: deps.state };
}

// ─── A/B/C. 审核出错 ─────────────────────────────────────────────────────
{
    const { result, state } = await runLoop({ checkResults: [ERROR_CHECK], env: '2' });
    check('A 审核出错按配置重试 2 次', state.checkCalls === 2, `checkCalls=${state.checkCalls}`);
    check('B 终态为 error（不是 failed）', result.status === LoopStatus.ERROR, `status=${result.status}`);
    check('B 原因明确指向审核环节故障，未谎报"准出未通过"',
        /审核/.test(result.error || '') && /故障|未能完成/.test(result.error || '')
        && !/准出审核仍未通过/.test(result.error || ''),
        `error=${result.error}`);
    check('C 未驱动重规划（Brain 只被调用一次）', state.brainCalls === 1, `brainCalls=${state.brainCalls}`);
    check('C 轮次未因审核出错而追加', result.rounds.length === 1, `rounds=${result.rounds.length}`);
}

// ─── 审核出错后重试成功 ─────────────────────────────────────────────────
{
    const { result, state } = await runLoop({
        checkResults: [ERROR_CHECK, { status: 'passed', passed: true, summary: '全部满足' }],
        env: '2',
    });
    check('A 第一次出错、第二次成功 → 最终 passed', result.status === LoopStatus.PASSED,
        `status=${result.status}`);
    check('A 重试后成功不再继续重试', state.checkCalls === 2, `checkCalls=${state.checkCalls}`);
}

// ─── D. 真实不通过保留原语义（计划每轮确有变化 → 走满 maxLoops）──────────
{
    // 注意：这里必须让每轮的步骤图**不同**（varyPlans）。
    // 若每轮产出完全相同的计划，F-23 的振荡检测会正确地在第 2 轮止损——
    // 那是另一条用例（见下），不是本条要验证的"走满轮次后 FAILED"。
    const { result, state } = await runLoop({ checkResults: [FAILED_CHECK], maxLoops: 3, varyPlans: true });
    check('D 判定不通过 + 计划有变化 → 走满 maxLoops 后 FAILED', result.status === LoopStatus.FAILED,
        `status=${result.status}`);
    check('D 原因仍为"准出审核仍未通过"', /准出审核仍未通过/.test(result.error || ''),
        `error=${result.error}`);
    check('D 每轮都调用了审核（3 轮）', state.checkCalls === 3, `checkCalls=${state.checkCalls}`);
    check('D 每轮都做了重规划（Brain 调用 3 次）', state.brainCalls === 3, `brainCalls=${state.brainCalls}`);
}

// ─── F-23. 计划振荡：相同计划不得空耗剩余轮次 ────────────────────────────
{
    const { result, state } = await runLoop({ checkResults: [FAILED_CHECK], maxLoops: 3 });
    check('F-23 计划重复时提前止损（未走满 3 轮）', result.rounds.length < 3,
        `rounds=${result.rounds.length}`);
    check('F-23 终态为 error 且原因明确指出振荡',
        result.status === LoopStatus.ERROR && /计划振荡/.test(result.error || ''),
        `status=${result.status} error=${result.error}`);
    check('F-23 不再谎报"达到最大循环次数"', !/达到最大循环次数/.test(result.error || ''));
    check('F-23 Brain 调用次数少于 maxLoops（省下轮次）', state.brainCalls < 3, `brainCalls=${state.brainCalls}`);
    check('F-23 记录振荡来源轮次', result.rounds.some((r) => typeof r.oscillatedWith === 'number'),
        `oscillatedWith=${JSON.stringify(result.rounds.map((r) => r.oscillatedWith))}`);
    check('F-23 记录计划指纹', result.rounds.some((r) => !!r.planFingerprint));

    // 关闭开关时应恢复"走满轮次"的旧行为（便于排障与对比）
    const off = await runLoop({
        checkResults: [FAILED_CHECK],
        maxLoops: 3,
        envVars: { LOOP_DETECT_OSCILLATION: '0' },
    });
    check('F-23 LOOP_DETECT_OSCILLATION=0 时关闭检测（恢复走满 maxLoops）',
        off.result.rounds.length === 3 && off.result.status === LoopStatus.FAILED,
        `rounds=${off.result.rounds.length} status=${off.result.status}`);
}

// ─── E/F/G. F-24 恢复状态收敛 ────────────────────────────────────────────
{
    const deps = makeDeps({});
    const engine = new LoopEngine({
        brainController: { _getBrain: () => deps.brain },
        orchestratorController: deps.orchestratorController,
        testCheck: deps.testCheck,
        storage: deps.storage,
        skillDirectory: ROOT + 'Server/Skills',
    });

    for (const st of ['planning', 'executing', 'checking']) {
        check(`E 恢复 ${st} → interrupted`, engine._projectRestoredStatus(st) === LoopStatus.INTERRUPTED,
            `got=${engine._projectRestoredStatus(st)}`);
    }
    check('F 恢复 aborting → aborted', engine._projectRestoredStatus('aborting') === LoopStatus.ABORTED);
    for (const st of ['passed', 'failed', 'aborted', 'error', 'interrupted']) {
        check(`G 终态 ${st} 原样保留`, engine._projectRestoredStatus(st) === st);
    }
    check('G 空值 → idle', engine._projectRestoredStatus(undefined) === LoopStatus.IDLE);
    check('G 未知值 → idle（不把垃圾状态一路透传）',
        engine._projectRestoredStatus('running-ish') === LoopStatus.IDLE,
        `got=${engine._projectRestoredStatus('running-ish')}`);
}

// ─── restoreLoop 端到端：进行中状态不再显示为运行中 ──────────────────────
{
    const persisted = {
        taskId: 'restoredTask',
        taskDescription: '崩溃中断的任务',
        maxLoops: 3,
        currentLoop: 1,
        status: 'executing',   // 崩溃前正在执行
        startTime: '2026-09-04T10:00:00+08:00',
        rounds: [{ loop: 0, passed: false, checkStatus: 'failed' }],
    };
    const storage = {
        manager: { rootDir: os.tmpdir() },
        json: () => ({ read: async () => persisted, write: async () => ({}), delete: async () => true }),
    };
    const deps = makeDeps({});
    const engine = new LoopEngine({
        brainController: { _getBrain: () => deps.brain },
        orchestratorController: deps.orchestratorController,
        testCheck: deps.testCheck,
        storage,
        skillDirectory: ROOT + 'Server/Skills',
    });
    const ctx = await engine.restoreLoop('restoredTask');
    check('restoreLoop: executing 快照恢复为 interrupted（不再谎报运行中）',
        ctx?.status === LoopStatus.INTERRUPTED, `status=${ctx?.status}`);
    check('restoreLoop: 历史轮次保留', ctx?.rounds?.length === 1, `rounds=${ctx?.rounds?.length}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
