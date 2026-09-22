/**
 * M6（Phase 3）验收补充：取消闭环的"最后一公里"
 *
 *   A AgentRuntime：排队等槽位期间被取消 → **不创建会话**，且槽位正常归还
 *   B MultiAgentRunner：`supervisor.init()` 抛错 → 取消树不留孤儿 + `_running` 复位
 *   C FlexRunner：`setAbortSignal` 把外部信号接入取消流程（幂等、可中断在途请求）
 *   D MultiAgentRunner：`setAbortSignal` 保存的是信号、转发到内部 AbortController
 *
 * 回归背景（三处都是"取消后仍起新会话 / 资源不释放 / 信号被静默丢弃"）：
 *   A 原先只在取槽位**之前**查一次取消；取消若落在等待窗口（可达 slotTimeoutMs）
 *     就会先拿到槽位、再新建会话，并跑满自己的角色超时（coder 默认 90 分钟）；
 *   B 原先 `await supervisor.init()` 写在 try 之外，init() 抛错时 finally 不执行
 *     → 取消树留下永久孤儿节点（而"孤儿数"正是判定会话泄漏的核心指标），
 *       同时 `_running` 卡在 true、executeStep/retryTimes 不再推进；
 *   C 原先 FlexRunner 没有 `setAbortSignal`，AgentRuntime 合并后的取消信号
 *     （`AbortSignal.any`）被静默丢弃，只剩轮询式检查；
 *   D 原先 `_abortController = signal` 把 AbortSignal 存进了 AbortController 字段，
 *     于是 `._abortController.signal` 恒为 undefined、`?.abort?.()` 恒为 no-op。
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { AbortTree } = await imp('Server/library/AbortTree.js');
const { AgentRuntime } = await imp('Server/Agent/Runtime/AgentRuntime.js');
const { RoleLimiter } = await imp('Server/Agent/Runtime/RoleLimiter.js');
const { defaultRoleRegistry } = await imp('Server/Agent/Roles/AgentRole.js');
const { CollaborationPlan } = await imp('Server/Agent/Supervisor/CollaborationPlan.js');
const { MultiAgentRunner } = await imp('Server/Agent/Supervisor/MultiAgentRunner.js');
const { Semaphore } = await imp('Server/Orchestrator/Orchestrator.js');
const { FlexRunner } = await imp('Server/FlexRunner/FlexRunner.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const storageStub = () => ({
    manager: { rootDir: os.tmpdir() },
    taskExecStore: () => ({ patchStep: async () => {} }),
    taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
    json: () => ({ read: async () => null, write: async () => ({}), delete: async () => true })
});

/** 记录调用的会话适配器桩（用于断言"有没有真的建会话"） */
function makeAdapterStub(rec) {
    return async () => {
        rec.factoryCalls++;
        return {
            initContext: async () => {},
            executeStart: async () => { rec.executes++; return { success: true, resultPath: '', nextStepId: 0, metrics: null }; },
            controlExecution: async () => true,
            drainBackgroundTasks: async () => ({ drained: true, pending: 0 })
        };
    };
}

// ═══ A. 排队期间取消 → 不创建会话 ═══════════════════════════════════
console.log('\n── A. AgentRuntime：等槽位期间被取消 ──');
{
    const sem = new Semaphore({ limit: 1, perTaskLimit: 0 });
    const hold = await sem.acquire({ timeoutMs: 1000, key: 'other-task' });
    check('A1 前置：全局槽位已被占满', sem.active === 1 && hold.ok === true);

    const tree = new AbortTree();
    const root = tree.createRoot('task:cancel');
    const stepNode = tree.createChild(root, 'step:1');
    const roleNode = tree.createChild(stepNode, 'role:coder');

    const rec = { factoryCalls: 0, executes: 0 };
    const rt = new AgentRuntime({
        role: defaultRoleRegistry.get('coder'),
        taskId: 'cancel',
        sessionSemaphore: sem,
        abortNode: roleNode,
        runnerFactory: makeAdapterStub(rec)
    });

    const pending = rt.run({
        stepId: 1,
        taskDescription: '做点事',
        round: 0,
        slotTimeoutMs: 20000,
        timeoutMs: 20000
    });

    await sleep(50);                                  // 让它停在"等全局槽位"
    check('A2 运行器已在排队等槽位（尚未创建会话）', rec.factoryCalls === 0 && sem.waiting >= 1,
        `factoryCalls=${rec.factoryCalls} waiting=${sem.waiting}`);

    const cancelled = roleNode.abort('用户点了终止');
    check('A3 取消传入取消树（向下传播到角色节点）', cancelled >= 0 && roleNode.aborted === true);

    hold.release();                                   // 槽位空出 → 排队的角色被唤醒
    const r = await pending;

    check('A4 唤醒后**不创建会话**（取消后不再派生新会话）', rec.factoryCalls === 0,
        `factoryCalls=${rec.factoryCalls}`);
    check('A5 结果归因为 aborted（而不是 session_error / 超时）',
        r.failureKind === 'aborted' && r.success === false, r.failureKind);
    check('A6 未真正占用全局槽位（槽位已归还）', sem.active === 0, `active=${sem.active}`);

    // 反向对照：同一路径下**没有**取消时必须照常执行（避免"修成永远不执行"）
    const rec2 = { factoryCalls: 0, executes: 0 };
    const rt2 = new AgentRuntime({
        role: defaultRoleRegistry.get('coder'),
        taskId: 'cancel',
        sessionSemaphore: sem,
        abortNode: tree.createChild(root, 'role:coder2'),
        runnerFactory: makeAdapterStub(rec2)
    });
    const ok = await rt2.run({ stepId: 1, taskDescription: '做点事', round: 0, slotTimeoutMs: 5000, timeoutMs: 5000 });
    check('A7 对照：未取消时正常创建并执行会话',
        rec2.factoryCalls === 1 && rec2.executes === 1 && ok.success === true,
        `factoryCalls=${rec2.factoryCalls} success=${ok.success}`);
    check('A8 对照：执行后槽位同样归零', sem.active === 0);
}

// ═══ B. init() 抛错 → 取消树不留孤儿 ════════════════════════════════
console.log('\n── B. MultiAgentRunner：init() 抛错时的资源收尾 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-init-throw-'));
    const tree = new AbortTree();
    const taskNode = tree.createRoot('task:badinit');

    // 计划引用一个**未注册**的角色 → Supervisor.init() 必然抛错（合法的失败路径）
    const badPlan = new CollaborationPlan({
        id: 'bad-plan',
        name: 'bad-plan',
        stages: [{ id: 'impl', role: 'not-a-role', consumes: [], produces: '实现' }]
    });

    const runner = new MultiAgentRunner({
        enabled: true,
        plan: badPlan,
        abortTree: tree,
        taskAbortNode: taskNode,
        runnerFactory: makeAdapterStub({ factoryCalls: 0, executes: 0 })
    });

    await runner.initContext({
        taskId: 'badinit', stepId: 7, taskDir,
        skillDirectory: '', taskDescription: 'x', maxRetries: 2,
        collaboration: badPlan
    });

    const r = await runner.executeStart();

    check('B1 init() 抛错被归一化为失败结果（不向调用方抛出）',
        r.success === false && runner._lastResult?.failureKind === 'supervisor_error',
        `${runner._lastResult?.failureKind}: ${runner._lastResult?.error}`);
    check('B2 取消树上**没有**遗留孤儿节点（原实现会永久留下一个）',
        tree.getOrphans().length === 0 && tree.getStats().orphans === 0,
        `orphans=${tree.getStats().orphans}`);
    check('B3 步骤节点已从取消树摘除（只剩从未被 dispose 的任务根节点）',
        tree.getStats().live <= 1
        && !tree.getLiveNodes().some((n) => String(n.label || '').startsWith('step:')),
        `live=${tree.getStats().live}`);
    check('B4 `_running` 已复位（否则该步骤再也不能重试）', runner._running === false);
    check('B5 executeStep / retryTimes 正常推进（重试链不被卡死）',
        runner.executeStep === 1 && runner.retryTimes === 1,
        `executeStep=${runner.executeStep} retryTimes=${runner.retryTimes}`);
}

// ═══ C. FlexRunner.setAbortSignal ═══════════════════════════════════
console.log('\n── C. FlexRunner：外部取消信号接入 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-fr-signal-'));
    const rec = { abortInFlight: 0 };
    const cli = {
        getType: () => 'mock',
        checkHealth: async () => ({ status: 'ok' }),
        startSession: async () => ({ sessionId: 'sess-x' }),
        checkSessionStatus: async () => ({ status: 'completed' }),
        abortSession: async () => { rec.abortSession = (rec.abortSession || 0) + 1; },
        deleteSession: async () => {},
        getSessionMessages: async () => [],
        sendAndWaitMessage: async () => ({ success: false }),
        injectPrompt: async () => ({ success: true }),
        abortInFlight: () => { rec.abortInFlight++; }
    };

    const runner = new FlexRunner();
    await runner.initContext({
        taskId: 'sigTask', stepId: 1, taskDir,
        skillDirectory: '', taskDescription: '做点事',
        cli, storage: storageStub(),
        skillSelector: { match: async () => null },
        pollIntervalMs: 1
    });

    check('C1 FlexRunner 现在实现了 setAbortSignal（AgentRuntime 才会下发合并信号）',
        typeof runner.setAbortSignal === 'function');

    const ac = new AbortController();
    runner.setAbortSignal(ac.signal);
    check('C2 信号未中止时不产生副作用', runner.canRetry() === true && rec.abortInFlight === 0);

    ac.abort();
    await sleep(30);
    check('C3 外部信号中止 → 中断在途 HTTP 请求（#cli.abortInFlight）', rec.abortInFlight === 1,
        `abortInFlight=${rec.abortInFlight}`);
    check('C4 外部信号中止 → 置位 #aborted（canRetry 变 false，后续不再启动执行）',
        runner.canRetry() === false);

    let threw = null;
    try { await runner.executeStart(); } catch (e) { threw = e; }
    check('C5 终止后调用 executeStart 直接拒绝（不会建会话）',
        threw !== null && /已被终止/.test(threw.message), threw?.message);

    // 幂等：重复中止不重复触发（`{once:true}` + 内部 #aborted 守卫）
    ac.abort();
    await sleep(20);
    check('C6 重复中止幂等（不重复调用中断）', rec.abortInFlight === 1, `abortInFlight=${rec.abortInFlight}`);

    // 已经 abort 的信号在注入时立即生效
    const ac2 = new AbortController();
    ac2.abort();
    const runner2 = new FlexRunner();
    await runner2.initContext({
        taskId: 'sigTask2', stepId: 1, taskDir,
        skillDirectory: '', taskDescription: '做点事',
        cli, storage: storageStub(),
        skillSelector: { match: async () => null },
        pollIntervalMs: 1
    });
    runner2.setAbortSignal(ac2.signal);
    await sleep(20);
    check('C7 注入"已中止"的信号立即生效（不会漏掉竞态窗口）',
        runner2.canRetry() === false, `canRetry=${runner2.canRetry()}`);
}

// ═══ D. MultiAgentRunner.setAbortSignal 字段语义 ════════════════════
console.log('\n── D. MultiAgentRunner：外部信号 → 内部 AbortController ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-mar-signal-'));
    const runner = new MultiAgentRunner({ enabled: true, plan: 'single' });
    await runner.initContext({
        taskId: 'marSignal', stepId: 1, taskDir,
        skillDirectory: '', taskDescription: 'x'
    });

    check('D1 初始化后内部持有 AbortController（而非信号）',
        typeof runner._abortController?.abort === 'function'
        && runner._abortController?.signal instanceof AbortSignal);

    const ac = new AbortController();
    runner.setAbortSignal(ac.signal);
    check('D2 注入信号后 _abortController 仍是 Controller（字段语义未被写坏）',
        typeof runner._abortController?.abort === 'function'
        && runner._abortController?.signal instanceof AbortSignal);
    check('D3 未中止时传给 Supervisor 的 signal 有效（不再是 undefined）',
        runner._abortController.signal.aborted === false);

    ac.abort();
    await sleep(20);
    check('D4 外部信号中止 → 内部控制器同步中止（Supervisor 能收到）',
        runner._abortController.signal.aborted === true && runner._aborted === true);

    let threw = null;
    try { await runner.executeStart(); } catch (e) { threw = e; }
    check('D5 中止后 executeStart 直接拒绝（不会启动角色子图）',
        threw !== null && /已被终止/.test(threw.message), threw?.message);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exitCode = failed.length === 0 ? 0 : 1;
