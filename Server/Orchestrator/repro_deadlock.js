/**
 * 复现脚本：step4 二次成功后无法激活 step5 → 死锁
 *
 * 用 mock FlexRunner 工厂驱动与真实任务一致的任务图：
 *   1→2→3 依次 success；step4 第1次 success；step5 第1次 fail → 跳 step4；
 *   step4 第2次 success → 预期激活 step5 第2次（成功→step6）。
 * 观察 step5 是否被重新激活。
 */
import { Orchestrator } from './index.js';

// mock FlexRunner：按 (taskId,stepId,执行次数) 返回预设结果
const MOCK_RESULTS = {
    '1': { success: true },
    '2': { success: true },
    '3': { success: true },
    '4': { success: true },   // 第1次、第2次均成功
    '5': { success: false },  // 第1次失败
    '6': { success: true },
};

function makeMockRunner(taskId, node, inputReport) {
    return {
        taskId,
        stepId: node.stepId,
        bigLoopIndex: 0,
        executeStep: 0,
        retryTimes: 0,
        maxRetries: node.maxRetries,
        sessionId: `mock_${taskId}_${node.stepId}`,
        startTime: new Date().toISOString(),
        endTime: null,
        resultPath: `mock_${node.stepId}.md`,
        inputReport,
        canRetry: () => true,
        async initContext() { return this; },
        async executeStart() {
            // step5 第1次失败，第2次（修复后）成功
            let success = MOCK_RESULTS[node.stepId].success;
            if (node.stepId === '5' && node.retryCount >= 2) success = true;
            return { resultPath: this.resultPath, success, nextStepId: node.nextStepId };
        },
        getLiveMessages: async () => [],
        getSessionContent: async () => '',
    };
}

const taskDef = {
    taskId: 'task_repro_deadlock',
    skillDirectory: 'D:/code/3rdLibraryLoop/Server/Skills',
    loopCount: 0,
    steps: [
        { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 3 },
        { stepId: 2, dependId: 1, nextStepId: 3, failStepId: 0, maxRetries: 2 },
        { stepId: 3, dependId: 2, nextStepId: 4, failStepId: 0, maxRetries: 3 },
        { stepId: 4, dependId: 3, nextStepId: 5, failStepId: 3, maxRetries: 3 },
        { stepId: 5, dependId: 4, nextStepId: 6, failStepId: 4, maxRetries: 3 },
        { stepId: 6, dependId: 5, nextStepId: 0, failStepId: 4, maxRetries: 3 },
    ]
};

const orch = new Orchestrator({
    flexRunnerFactory: (node, inputReport) => makeMockRunner(taskDef.taskId, node, inputReport),
});

await orch.loadTask(taskDef);
const result = await orch.start();

console.log('\n===== 复现结果 =====');
console.log('最终状态:', result.status);
console.log('步骤状态:');
for (const n of orch.nodes) {
    console.log(`  step${n.stepId}: status=${n.status}, retryCount=${n.retryCount}`);
}
console.log('error:', orch._error);