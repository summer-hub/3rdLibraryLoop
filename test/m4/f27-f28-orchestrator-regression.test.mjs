/**
 * M4 验收：F-27 测试入口补齐 ／ F-28 repro 脚本升级为断言式回归
 *
 * 原 `Server/Orchestrator/repro_deadlock.js`、`repro_regression.js` 只是**打印**
 * 观察结果（无断言、无退出码），既不能进 CI 也不能防回归。本套件把它们固化为
 * 带断言的用例，并补上此前**零覆盖**的两块 DAG 语义（fan-out / fan-in 聚合）。
 *
 *   A 死锁回归（原 repro_deadlock）：step5 首次失败 → 修复链回到 step4 →
 *     step4 二次成功必须能**重新激活** step5，最终全链完成
 *   B 线性链全成功 → completed（原 repro_regression 场景 A）
 *   C 失败且无 failStepId → 链终止，标记 failed 而非死锁（场景 B）
 *   D 失败经 failStepId 回环 → 达 maxRetries 后终止（场景 C）
 *   E fan-out：多个入口步骤并行执行
 *   F fan-in 聚合：dependId 为数组时，必须**等全部前置完成**才激活
 *   G 全局执行上限：成功态环不会无限执行（GLOBAL_EXEC_LIMIT=200 兜底）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { Orchestrator } = await import(pathToFileURL(`${ROOT}Server/Orchestrator/Orchestrator.js`).href);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const storageStub = () => ({
    manager: { rootDir: os.tmpdir() },
    json: () => ({ read: async () => null, write: async () => ({}), delete: async () => true }),
    taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
});

/**
 * 构造 mock FlexRunner（与真实 Orchestrator 的调用契约一致）。
 *
 * @param {object} opts
 * @param {(node: object, call: number) => {success: boolean}} opts.decide - 按节点与调用次数决定成败
 * @param {Array} [opts.log] - 执行日志（记录 stepId 与阶段，用于并发/聚合断言）
 * @param {number} [opts.delayMs] - 执行耗时
 */
function makeFactory({ decide, log = null, delayFor = null }) {
    const calls = new Map(); // stepId -> 已调用次数
    return (node) => {
        const stepId = String(node.stepId);
        return {
            taskId: 'mockTask',
            stepId,
            bigLoopIndex: 0,
            executeStep: 0,
            retryTimes: 0,
            maxRetries: node.maxRetries,
            sessionId: `mock_${stepId}`,
            startTime: null,
            endTime: null,
            resultPath: `mock_${stepId}.md`,
            metrics: null,
            canRetry: () => true,
            controlExecution: async () => true,
            drainBackgroundTasks: async () => ({ drained: true, pending: 0 }),
            executeStart: async () => {
                const call = (calls.get(stepId) ?? 0) + 1;
                calls.set(stepId, call);
                log?.push({ stepId, phase: 'start', call });
                const delay = delayFor ? delayFor(stepId) : 0;
                if (delay > 0) await sleep(delay);
                const { success } = decide({ ...node, retryCount: node.retryCount }, call);
                log?.push({ stepId, phase: 'end', call, success });
                return { resultPath: `mock_${stepId}.md`, success, nextStepId: node.nextStepId, metrics: null };
            },
        };
    };
}

async function run(steps, factoryOpts, { taskId = 'm4task' } = {}) {
    const orch = new Orchestrator({ storage: storageStub(), flexRunnerFactory: makeFactory(factoryOpts) });
    await orch.loadTask({ taskId, steps });
    const res = await orch.start();
    return { res, orch };
}

const statusOf = (orch, stepId) => orch.nodes.find((n) => String(n.stepId) === String(stepId))?.status;

/**
 * Orchestrator.start() 返回 `{ status, summary }`，其中 summary 是 getProgress()
 * 的快照，失败原因在 `summary.error`。取错位置会得到 undefined 而让断言静默失真，
 * 因此统一走这个 helper。
 */
const errOf = (res) => res.summary?.error ?? res.error;

// ─── A. 死锁回归（原 repro_deadlock）────────────────────────────────────
{
    const steps = [
        { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 3 },
        { stepId: 2, dependId: 1, nextStepId: 3, failStepId: 0, maxRetries: 2 },
        { stepId: 3, dependId: 2, nextStepId: 4, failStepId: 0, maxRetries: 3 },
        { stepId: 4, dependId: 3, nextStepId: 5, failStepId: 3, maxRetries: 3 },
        { stepId: 5, dependId: 4, nextStepId: 6, failStepId: 4, maxRetries: 3 },
        { stepId: 6, dependId: 5, nextStepId: 0, failStepId: 4, maxRetries: 3 },
    ];
    const { res, orch } = await run(steps, {
        decide: (node) => {
            // step5 第 1 次失败、第 2 次（修复后）成功；其余一律成功
            if (String(node.stepId) === '5') return { success: node.retryCount >= 2 };
            return { success: true };
        },
    });

    check('A 修复链回环后全链完成（不再死锁）', res.status === 'completed', `status=${res.status}`);
    for (const id of [1, 2, 3, 4, 5, 6]) {
        check(`A step${id} 已 completed`, statusOf(orch, id) === 'completed', `status=${statusOf(orch, id)}`);
    }
    const s5 = orch.nodes.find((n) => n.stepId === '5');
    check('A step5 被重新激活过（retryCount=2，证明修复链生效）', s5.retryCount === 2, `retryCount=${s5.retryCount}`);
}

// ─── B. 线性链全成功 ────────────────────────────────────────────────────
{
    const { res, orch } = await run([
        { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 2 },
        { stepId: 2, dependId: 1, nextStepId: 3, failStepId: 0, maxRetries: 2 },
        { stepId: 3, dependId: 2, nextStepId: 0, failStepId: 0, maxRetries: 2 },
    ], { decide: () => ({ success: true }) });
    check('B 线性链全成功 → completed', res.status === 'completed', `status=${res.status}`);
    check('B 三步均只执行一次', [1, 2, 3].every((i) => {
        const n = orch.nodes.find((x) => String(x.stepId) === String(i));
        return n.retryCount === 1;
    }));
}

// ─── C. 失败且无 failStepId → 链终止，报 FAILED（而非 deadlocked）──────
{
    const { res, orch } = await run([
        { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 2 },
        { stepId: 2, dependId: 1, nextStepId: 3, failStepId: 0, maxRetries: 2 },
        { stepId: 3, dependId: 2, nextStepId: 0, failStepId: 0, maxRetries: 2 },
    ], { decide: (node) => ({ success: String(node.stepId) !== '2' }) });
    check('C 失败无 failStepId → 终态 failed（不再误报 deadlocked）',
        res.status === 'failed', `status=${res.status}`);
    check('C 原因点明是失败链终止并指名失败步骤',
        /失败链终止/.test(errOf(res) || '') && /step2/.test(errOf(res) || ''),
        `error=${errOf(res)}`);
    check('C 未完成的后续步骤被如实说明', /未能执行/.test(errOf(res) || ''));
    check('C step3 未被激活（pending）', statusOf(orch, 3) === 'pending', `status=${statusOf(orch, 3)}`);
}

// ─── D. 失败经 failStepId 回环 → 达 maxRetries 终止 ─────────────────────
{
    const { res, orch } = await run([
        { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 2 },
        { stepId: 2, dependId: 1, nextStepId: 3, failStepId: 1, maxRetries: 2 },
        { stepId: 3, dependId: 2, nextStepId: 0, failStepId: 0, maxRetries: 2 },
    ], { decide: (node) => ({ success: String(node.stepId) !== '2' }) });
    check('D 持续失败最终以 failed 终止（非 completed、非 deadlocked）',
        res.status === 'failed', `status=${res.status}`);
    const n2 = orch.nodes.find((x) => x.stepId === '2');
    check('D step2 的重试次数未超过 maxRetries', n2.retryCount <= n2.maxRetries,
        `retryCount=${n2.retryCount} maxRetries=${n2.maxRetries}`);
}

// ─── E. fan-out：入口步骤并行 ───────────────────────────────────────────
{
    const log = [];
    await run([
        { stepId: 1, dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 2 },
        { stepId: 2, dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 2 },
    ], { decide: () => ({ success: true }), log, delayFor: () => 150 });

    // 两个入口若串行，第二个的 start 会在第一个 end 之后
    const s1 = log.find((e) => e.stepId === '1' && e.phase === 'start');
    const s2 = log.find((e) => e.stepId === '2' && e.phase === 'start');
    const e1 = log.find((e) => e.stepId === '1' && e.phase === 'end');
    const e2 = log.find((e) => e.stepId === '2' && e.phase === 'end');
    const idx = (ev) => log.indexOf(ev);
    check('E 两个入口步骤均被执行', !!s1 && !!s2 && !!e1 && !!e2);
    check('E 并行执行（两个 start 都发生在任一 end 之前）',
        idx(s2) < idx(e1) && idx(s1) < idx(e2),
        `顺序=${log.map((e) => `${e.stepId}:${e.phase === 'start' ? 'S' : 'E'}`).join(' ')}`);
}

// ─── F. fan-in 聚合：必须等全部前置完成 ─────────────────────────────────
{
    const log = [];
    const { res, orch } = await run([
        { stepId: 1, dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 2 },
        { stepId: 2, dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 2 },
        // step3 依赖 1 与 2 两者（fan-in 聚合）
        { stepId: 3, dependId: [1, 2], nextStepId: 0, failStepId: 0, maxRetries: 2 },
    ], {
        decide: () => ({ success: true }),
        log,
        // step1 慢、step2 快：若聚合逻辑正确，step3 必须等 step1 也完成
        delayFor: (stepId) => (stepId === '1' ? 250 : 10),
    });

    check('F fan-in 全链完成', res.status === 'completed', `status=${res.status}`);
    const s3 = log.find((e) => e.stepId === '3' && e.phase === 'start');
    const e1 = log.find((e) => e.stepId === '1' && e.phase === 'end');
    const e2 = log.find((e) => e.stepId === '2' && e.phase === 'end');
    check('F step3 已执行', !!s3);
    check('F step3 的启动晚于**慢前置** step1 的完成（等全部前置，不被快前置提前唤醒）',
        !!s3 && !!e1 && log.indexOf(s3) > log.indexOf(e1),
        `顺序=${log.map((e) => `${e.stepId}:${e.phase === 'start' ? 'S' : 'E'}`).join(' ')}`);
    check('F step3 也晚于 step2 的完成', !!e2 && log.indexOf(s3) > log.indexOf(e2));
    check('F 三步均 completed', [1, 2, 3].every((i) => statusOf(orch, i) === 'completed'));
}

// ─── G. 成功态环不会被重复执行（"每步只执行一次"的真实机制）────────────
{
    // 注意：真正阻止"已完成节点被 nextStepId 再次激活"的机制**不是**文档里写的
    // `_execPathTrace`（该字段是死代码），而是 `_activateNextStep` 的守卫：
    //   if (!allowCompleted && !nextNode.isPending) { ...除非 FAILED 且未用尽重试，否则 return }
    // 因此一个"双方都成功"的 nextStepId 环只会执行一轮即收敛。
    const { res, orch } = await run([
        { stepId: 1, dependId: 0, nextStepId: 2, failStepId: 0, maxRetries: 99 },
        { stepId: 2, dependId: 1, nextStepId: 1, failStepId: 0, maxRetries: 99 },
    ], { decide: () => ({ success: true }) });

    check('G 成功态环每步只执行一次（completed 节点不被 nextStepId 重复激活）',
        orch._globalExecCount === 2, `globalExecCount=${orch._globalExecCount}`);
    check('G 全成功 → completed', res.status === 'completed', `status=${res.status}`);
}

// ─── G2. 失败态 ping-pong 环 → 由 GLOBAL_EXEC_LIMIT 兜底 ────────────────
{
    // 双方 fail 且 failStepId 互指：每次都会经 allowCompleted 重新激活对方，
    // maxRetries 设得足够大，使其必须由全局执行上限兜住。
    const { res, orch } = await run([
        { stepId: 1, dependId: 0, nextStepId: 0, failStepId: 2, maxRetries: 500 },
        { stepId: 2, dependId: 0, nextStepId: 0, failStepId: 1, maxRetries: 500 },
    ], { decide: () => ({ success: false }) });

    check('G2 失败态互指环被 GLOBAL_EXEC_LIMIT 有界兜底（恰好 200 次）',
        orch._globalExecCount === 200, `globalExecCount=${orch._globalExecCount}`);
    check('G2 编排正常返回（未挂起、未栈溢出）',
        ['failed', 'deadlocked', 'completed'].includes(res.status), `status=${res.status}`);
    check('G2 上限触发时有明确原因说明',
        /上限/.test(errOf(res) || ''), `error=${errOf(res)}`);
}

// ─── H. 真死锁：无失败步骤但依赖不可达 ──────────────────────────────────
{
    // step1 是唯一入口；step2 依赖 [1,3]，step3 依赖 2 —— 2 与 3 互相等待，
    // 且都不存在失败步骤可归因，因此这才是**真死锁**（与 C/D 的失败链终止不同）。
    const { res, orch } = await run([
        { stepId: 1, dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 2 },
        { stepId: 2, dependId: [1, 3], nextStepId: 0, failStepId: 0, maxRetries: 2 },
        { stepId: 3, dependId: 2, nextStepId: 0, failStepId: 0, maxRetries: 2 },
    ], { decide: () => ({ success: true }) });

    check('H 依赖不可达 → 终态 deadlocked', res.status === 'deadlocked', `status=${res.status}`);
    check('H 原因明确为死锁且未与失败链终止混同',
        /死锁/.test(errOf(res) || '') && !/失败链终止/.test(errOf(res) || ''),
        `error=${errOf(res)}`);
    check('H step2/step3 仍为 pending', statusOf(orch, 2) === 'pending' && statusOf(orch, 3) === 'pending');
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
