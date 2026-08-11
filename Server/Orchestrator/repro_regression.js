/**
 * 回归验证：确认修复不影响正常场景
 * 场景A：线性链全成功 → completed
 * 场景B：某步失败且无 failStepId → 链终止（FAILED，不死锁）
 * 场景C：某步失败且超过 maxRetries → 链终止
 */
import { Orchestrator, OrchestratorStatus } from './index.js';

function makeRunner(taskId, node, results) {
    return {
        taskId, stepId: node.stepId, bigLoopIndex: 0,
        sessionId: `mock_${taskId}_${node.stepId}`, resultPath: `mock_${node.stepId}.md`,
        canRetry: () => true,
        async initContext() { return this; },
        async executeStart() {
            const r = results[node.stepId] ?? { success: true };
            return { resultPath: this.resultPath, success: r.success, nextStepId: node.nextStepId };
        },
    };
}

async function run(name, def, results) {
    const orch = new Orchestrator({
        flexRunnerFactory: (node) => makeRunner(def.taskId, node, results),
    });
    await orch.loadTask(def);
    const res = await orch.start();
    const states = orch.nodes.map(n => `step${n.stepId}:${n.status}(${n.retryCount})`).join(' ');
    console.log(`[${name}] status=${res.status} | ${states}`);
    return res.status;
}

// 场景A：线性链全成功 1→2→3
const defA = { taskId: 'regA', steps: [
    { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 2 },
    { stepId: 2, dependId: 1, nextStepId: 3, failStepId: 0, maxRetries: 2 },
    { stepId: 3, dependId: 2, nextStepId: 0, failStepId: 0, maxRetries: 2 },
]};
await run('A-全成功', defA, {});

// 场景B：step2 失败且无 failStepId → 链终止
const defB = { taskId: 'regB', steps: [
    { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 2 },
    { stepId: 2, dependId: 1, nextStepId: 3, failStepId: 0, maxRetries: 2 },
    { stepId: 3, dependId: 2, nextStepId: 0, failStepId: 0, maxRetries: 2 },
]};
await run('B-失败无failStep', defB, { '2': { success: false } });

// 场景C：step2 失败，failStepId=1 循环，但 step2 每次失败达 maxRetries 后终止
const defC = { taskId: 'regC', steps: [
    { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 2 },
    { stepId: 2, dependId: 1, nextStepId: 3, failStepId: 1, maxRetries: 2 },
    { stepId: 3, dependId: 2, nextStepId: 0, failStepId: 0, maxRetries: 2 },
]};
await run('C-失败循环达上限', defC, { '2': { success: false } });