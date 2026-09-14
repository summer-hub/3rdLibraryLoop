/**
 * M6（Phase 3）验收：取消树与三级限流
 *
 *   A AbortTree：向下传播 / 不向上传播 / 取消后新派生即死 / 幂等 / 原因透传
 *   B AbortTree：孤儿可观测 + dispose 摘除（长任务不累积节点）
 *   C RoleLimiter：上限生效 / FIFO / 超时 / 幂等释放 / 运行期调整 / 统计
 *   D 三级限流顺序：角色 → 全局，饱和下**不死锁**（这是最关键的并发不变式）
 *   E 端到端：多 Agent 步骤饱和 + 级联取消（角色会话确实被取消）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { AbortTree, AbortNode } = await imp('Server/library/AbortTree.js');
const { RoleLimiter, resolveRoleLimits } = await imp('Server/Agent/Runtime/RoleLimiter.js');
const { Orchestrator, Semaphore, getRoleLimiterStats } = await imp('Server/Orchestrator/Orchestrator.js');
const { MultiAgentRunner } = await imp('Server/Agent/Supervisor/MultiAgentRunner.js');

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

// ═══ A. 取消树语义 ═════════════════════════════════════════════════
console.log('\n── A. AbortTree 取消传播语义 ──');
{
    const tree = new AbortTree();
    const task = tree.createRoot('task:t1');
    const stepA = tree.createChild(task, 'step:A');
    const stepB = tree.createChild(task, 'step:B');
    const roleA1 = tree.createChild(stepA, 'role:A1');
    const roleA2 = tree.createChild(stepA, 'role:A2');
    const httpNode = tree.createChild(roleA1, 'http');

    check('A1 初始全部存活',
        [task, stepA, stepB, roleA1, roleA2, httpNode].every((n) => n.alive));

    roleA1.abort('单角色取消');
    check('A2 向下传播到孙节点（role → http 逐层可达）',
        roleA1.aborted && httpNode.aborted);
    check('A3 不向上传播（父节点与其他兄弟不受影响）',
        stepA.alive && stepB.alive && roleA2.alive);
    check('A4 取消原因向下透传',
        httpNode.reason === '单角色取消', httpNode.reason);
    check('A5 AbortController 信号同步为 aborted（fetch 等原生消费者立刻中断）',
        httpNode.signal.aborted === true && roleA1.signal.aborted === true);

    // 取消后新派生即死 —— 这是相对 Phase 1 平铺取消的关键增益。
    // 注意必须在**已取消**的节点下派生（roleA1 已取消，stepA 仍存活）。
    const lateChild = tree.createChild(roleA1, 'role:A3');
    check('A6 已取消父节点下**新派生**的节点立即为取消态（平铺实现做不到）',
        lateChild.aborted === true && lateChild.reason === '单角色取消', lateChild.reason);
    const lateAlive = tree.createChild(stepB, 'role:B1');
    check('A6b 存活父节点下派生的节点仍是存活态（不误伤）', lateAlive.alive === true);

    // 幂等
    const before = tree.getStats().tracked;
    const again = roleA1.abort('重复取消');
    check('A7 重复 abort 幂等（不重复触发回调、不改变原因）',
        again === 0 && roleA1.reason === '单角色取消' && tree.getStats().tracked === before);

    // 触发计数：回调只调一次
    let hits = 0;
    const t2 = new AbortTree();
    const r2 = t2.createRoot('r');
    const c2 = t2.createChild(r2, 'c');
    c2.onAbort(() => { hits++; });
    r2.abort('第一次');
    r2.abort('第二次');
    check('A8 级联触发的回调只执行一次', hits === 1, `hits=${hits}`);

    // 回调异常不阻断整棵树
    const t3 = new AbortTree();
    const r3 = t3.createRoot('r');
    const bad = t3.createChild(r3, 'bad');
    const good = t3.createChild(r3, 'good');
    bad.onAbort(() => { throw new Error('listener boom'); });
    r3.abort('x');
    check('A9 单个监听器抛错不阻断整棵树的级联取消',
        bad.aborted && good.aborted);

    // 整树取消
    const t4 = new AbortTree();
    const r4 = t4.createRoot('r');
    t4.createChild(t4.createChild(r4, 'a'), 'a1');
    t4.createChild(r4, 'b');
    const n = t4.abort('任务终止');
    check('A10 整树取消覆盖全部节点并返回计数',
        n === 4 && t4.aborted === true, `cancelled=${n}`);
    check('A11 无父节点时 createChild 明确报错（而不是建出游离节点）',
        (() => { try { t4.createChild(null); return false; } catch { return true; } })());
}

// ═══ B. 孤儿可观测 ═════════════════════════════════════════════════
console.log('\n── B. 孤儿可观测与摘除 ──');
{
    const tree = new AbortTree();
    const task = tree.createRoot('task');
    const steps = [];
    for (let i = 0; i < 50; i++) steps.push(tree.createChild(task, `step:${i}`));

    task.abort('终止');
    const st1 = tree.getStats();
    check('B1 已取消但未摘除的节点被统计为孤儿（泄漏信号可见）',
        st1.orphans === 51, `orphans=${st1.orphans}（含根节点，共 1 + 50）`);

    for (const s of steps) s.dispose();
    const st2 = tree.getStats();
    check('B2 dispose 后只剩根节点未摘除（长任务不会累积节点）',
        st2.orphans === 1 && st2.live === 0, `orphans=${st2.orphans} live=${st2.live}`);

    // 监听器泄漏：反复派生+摘除后父节点的监听器数不增长
    const t3 = new AbortTree();
    const root = t3.createRoot('root');
    for (let i = 0; i < 200; i++) {
        const ch = t3.createChild(root, 'tmp');
        ch.dispose();
    }
    check('B3 反复派生/摘除 200 次后根节点无监听器累积（避免 Node 的 10 监听器告警）',
        root.brief().listeners === 0 && root.children.size === 0,
        `listeners=${root.brief().listeners} children=${root.children.size}`);

    check('B4 统计含按标签分组（可定位是哪一类节点在泄漏）',
        typeof st1.byLabel === 'object' && st1.byLabel['step:0'] === 1
        && Object.keys(st1.byLabel).length === 51,
        JSON.stringify(st1.byLabel).slice(0, 120));
}

// ═══ C. 角色级限流 ═════════════════════════════════════════════════
console.log('\n── C. RoleLimiter（第三级限流）──');
{
    const limiter = new RoleLimiter({ limits: { coder: 2, reviewer: 5 } });

    check('C1 未配置的角色默认不限制（0 = 不限制，行为与 Phase 2 一致）',
        limiter.limitOf('planner') === 0 && limiter.limitOf('coder') === 2);

    const l1 = await limiter.acquire('coder');
    const l2 = await limiter.acquire('coder');
    check('C2 上限内获取成功且计入 active',
        l1.ok && l2.ok && limiter.getStats().perRole.coder.active === 2);

    // 第三个必须等待
    let thirdGranted = false;
    const p3 = limiter.acquire('coder', { timeoutMs: 1000 }).then((r) => { thirdGranted = true; return r; });
    await sleep(30);
    check('C3 超限时进入排队（而不是越限放行）',
        thirdGranted === false && limiter.getStats().perRole.coder.waiting === 1);

    l1.release();
    const l3 = await p3;
    check('C4 释放后队首被派发（FIFO）', l3.ok === true && l3.waitedMs >= 20, `waited=${l3.waitedMs}ms`);

    check('C5 不同角色互相独立（coder 满不影响 reviewer）',
        (await limiter.acquire('reviewer')).ok === true);
    check('C6 未配置角色的获取是空租约（不过度设计）',
        (await limiter.acquire('planner')).ok === true && limiter.limitOf('planner') === 0);

    check('C7 重复释放幂等（不会出现计数漂移）',
        l1.release() === false && limiter.getStats().perRole.coder.active === 2);

    // 超时
    const lt = await limiter.acquire('coder', { timeoutMs: 40 });
    check('C8 等待超时返回 ok=false 且计数可核对',
        lt.ok === false && lt.timedOut === true
        && limiter.getStats().perRole.coder.totalTimedOut === 1,
        `waited=${lt.waitedMs}ms`);

    // 运行期调整上限：**放宽后必须立刻派发排队者**（否则要等下一次 release 才生效）
    // 构造真实排队：先把 coder 收紧到 1（此时已有 2 个在位），第 3 个必然排队
    limiter.setLimit('coder', 1);
    let qResolved = null;
    const q = limiter.acquire('coder', { timeoutMs: 3000 }).then((r) => { qResolved = r; return r; });
    await sleep(25);
    check('C9 收紧上限后新请求排队（不驱逐已持槽位者，只影响后续准入）',
        qResolved === null && limiter.getStats().perRole.coder.active === 2
        && limiter.getStats().perRole.coder.waiting === 1,
        `active=${limiter.getStats().perRole.coder.active} waiting=${limiter.getStats().perRole.coder.waiting}`);

    limiter.setLimit('coder', 3);
    const qr = await q;
    check('C10 放宽上限后排队者**立即**被派发（不必等下一次 release）',
        qr.ok === true && limiter.getStats().perRole.coder.active === 3,
        `active=${limiter.getStats().perRole.coder.active} waited=${qr.waitedMs}ms`);
    qr.release();

    // 非法配置回退默认
    limiter.setLimit('coder', -5);
    check('C11 非法上限回退为"不限制"而非"无准入"（错误的配置不应造成灾难）',
        limiter.limitOf('coder') === 0);

    const st = limiter.getStats();
    check('C12 统计含 P95 排队/持有指标（判断限流是否过紧的依据）',
        typeof st.queueWaitP95Ms === 'number' && typeof st.slotHoldP95Ms === 'number'
        && st.perRole.coder.totalAcquired >= 4 && st.perRole.coder.totalTimedOut === 1,
        `waitP95=${st.queueWaitP95Ms}ms holdP95=${st.slotHoldP95Ms}ms acquired=${st.perRole.coder.totalAcquired}`);

    check('C13 环境变量与代码覆盖的优先级解析正确',
        resolveRoleLimits({ coder: 7 }).limits.coder === 7);
}

// ═══ D. 三级限流顺序：饱和下不死锁 ═════════════════════════════════
console.log('\n── D. 三级限流：饱和下不死锁（顺序不变式）──');
{
    // 全局上限 3、coder 上限 2 —— 两者都吃紧，最容易暴露循环等待。
    // 峰值必须自己记录：`Semaphore.stats()` 不提供峰值字段（只有当前值），
    // 因此这里包一层 acquire 采样（与 test/m5 的并发不变式用例同一手法）。
    const globalSem = new Semaphore({ limit: 3, perTaskLimit: 0 });
    let globalPeak = 0;
    const origAcquire = globalSem.acquire.bind(globalSem);
    globalSem.acquire = async (opts) => {
        const lease = await origAcquire(opts);
        if (lease.ok) globalPeak = Math.max(globalPeak, globalSem.active);
        return lease;
    };
    const roleLimiter = new RoleLimiter({ limits: { coder: 2, reviewer: 2 } });

    /** 与 AgentRuntime 完全相同的获取/释放顺序：角色 → 全局，释放相反 */
    async function session(roleId) {
        const roleLease = await roleLimiter.acquire(roleId, { timeoutMs: 20000 });
        if (!roleLease.ok) return { ok: false, reason: 'role-timeout' };
        const sem = await globalSem.acquire({ timeoutMs: 20000, key: 't' });
        if (!sem.ok) { roleLease.release(); return { ok: false, reason: 'global-timeout' }; }
        try {
            await sleep(15);
            return { ok: true };
        } finally {
            sem.release();
            roleLease.release();
        }
    }

    // 24 个会话（12 coder + 12 reviewer）远超声量，饱和运行
    const tasks = [];
    for (let i = 0; i < 12; i++) {
        tasks.push(session('coder'), session('reviewer'));
    }
    const t0 = Date.now();
    const out = await Promise.all(tasks);
    const cost = Date.now() - t0;

    check('D1 饱和下全部会话都在超时前完成（**无死锁**）',
        out.every((r) => r.ok === true), out.filter((r) => !r.ok).map((r) => r.reason).join(',') || 'all ok');
    check('D2 全局并发峰值未突破上限 3',
        globalPeak <= 3, `peak=${globalPeak}`);
    check('D3 角色并发峰值未突破各自上限',
        roleLimiter.getStats().perRole.coder.peakActive <= 2
        && roleLimiter.getStats().perRole.reviewer.peakActive <= 2,
        `coder=${roleLimiter.getStats().perRole.coder.peakActive} reviewer=${roleLimiter.getStats().perRole.reviewer.peakActive}`);
    check('D4 全部租约释放（无泄漏）',
        globalSem.active === 0 && roleLimiter.activeTotal === 0 && roleLimiter.waitingTotal === 0,
        `global=${globalSem.active} role=${roleLimiter.activeTotal}`);
    check('D5 完成时间接近理论下界（说明并发被真正利用，而非串行化）',
        cost < 24 * 15, `耗时=${cost}ms（理论下界约 ${Math.ceil(24 / 3) * 15}ms）`);

    // 全局上限 1 —— 极端串行化下同样不能死锁
    const g1 = new Semaphore({ limit: 1, perTaskLimit: 0 });
    const r1 = new RoleLimiter({ limits: { coder: 1 } });
    const seq = [];
    for (let i = 0; i < 6; i++) {
        seq.push((async () => {
            const rl = await r1.acquire('coder', { timeoutMs: 20000 });
            const gs = await g1.acquire({ timeoutMs: 20000, key: 't' });
            try { await sleep(5); return rl.ok && gs.ok; } finally { gs.release(); rl.release(); }
        })());
    }
    const seqOut = await Promise.all(seq);
    check('D6 全局上限=1 且角色上限=1 时仍不死锁（顺序不变式的极端情形）',
        seqOut.every(Boolean) && g1.active === 0 && r1.activeTotal === 0);
}

// ═══ E. 端到端：级联取消真的到达角色会话 ═══════════════════════════
console.log('\n── E. 端到端：多 Agent 步骤饱和 + 级联取消 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-abort-'));
    const tree = new AbortTree();
    const sem = new Semaphore({ limit: 6, perTaskLimit: 0 });
    const roleLimiter = new RoleLimiter({ limits: { coder: 4, reviewer: 4 } });

    const observed = { started: 0, cancelled: 0, orphanAfter: null };
    // 角色会话：长耗时，用于观察取消是否真的到达
    const adapterFactory = async () => ({
        sessionId: 's', usedSkillName: '',
        _signal: null,
        setAbortSignal(sig) { this._signal = sig; },
        async initContext(p) { this._p = p; },
        async executeStart() {
            observed.started++;
            const sig = this._signal;
            // 已经取消的会话不应真的启动（生产侧 AgentRuntime 会在取槽位前就拦住，
            // 这里再兜一层，避免测试因"取消后的会话要等满 5s"而超时）
            if (sig?.aborted) { observed.cancelled++; return { success: false, resultPath: '', metrics: null }; }
            // 支持取消的会话：取消后立刻返回失败（模拟 F-06 的中断在途 HTTP）
            const done = new Promise((resolve) => {
                const t = setTimeout(() => resolve('done'), 1000);
                if (sig) {
                    sig.addEventListener('abort', () => { clearTimeout(t); observed.cancelled++; resolve('aborted'); }, { once: true });
                }
            });
            const why = await done;
            if (why === 'aborted') return { success: false, resultPath: '', metrics: null };
            const file = path.join(this._p.taskDir, `r_${this._p.roleId}.md`);
            await fs.writeFile(file, '## 执行状态\n\n成功\n', 'utf8');
            const metrics = this._p.roleId === 'reviewer' ? { approved: true, reasons: [] } : { artifacts: ['a'] };
            return { success: true, resultPath: file, metrics };
        },
        async controlExecution() { return true; },
        async drainBackgroundTasks() { return { drained: true }; }
    });

    const orch = new Orchestrator({
        storage: storageStub(),
        sessionSemaphore: sem,
        abortTree: tree,
        roleLimiter,
        multiAgentEnabled: true,
        multiAgentRunnerFactory: async (node, inputReport, ctx) => new MultiAgentRunner({
            enabled: true,
            plan: 'standard',
            sessionSemaphore: ctx.sessionSemaphore,
            roleLimiter: ctx.roleLimiter,
            abortTree: ctx.abortTree,
            taskAbortNode: ctx.taskAbortNode,
            runnerFactory: adapterFactory
        })
    });

    await orch.loadTask({
        taskId: 'abortTask', taskDir,
        steps: [
            { stepId: 1, taskDescription: 'a', dependId: 0, nextStepId: 0, maxRetries: 1 },
            { stepId: 2, taskDescription: 'b', dependId: 0, nextStepId: 0, maxRetries: 1 }
        ]
    });

    const runner = orch.start();
    await sleep(120);                       // 让会话真正起来
    check('E1 会话已启动（取消前确有在途工作）', observed.started >= 2, `started=${observed.started}`);

    await orch.abort();
    // 必须用 abortAndWait 而不是直接 await start()：
    // start() 在调度循环退出后即返回，此时**在途步骤的执行体可能仍在退出途中**，
    // 立刻检查取消树会看到"尚未摘除的步骤节点"，把正常的收尾误判成泄漏。
    // （这也是 server.js 停机时用 abortAndWait 的原因。）
    const st = await runner;
    await orch.abortAndWait({ timeoutMs: 8000 });

    check('E2 编排被终止', st.status === 'aborted', st.status);
    check('E3 级联取消**真的到达了角色会话**（不是只改了编排层标志）',
        observed.cancelled >= 1, `cancelled=${observed.cancelled}`);
    check('E4 取消树整体为取消态', tree.aborted === true);

    const treeStats = tree.getStats();
    check('E5 步骤与角色节点已全部摘除（只剩任务根节点）',
        !treeStats.orphanLabels.some((l) => l.startsWith('step:') || l.startsWith('role:')),
        `orphans=${treeStats.orphans} labels=${treeStats.orphanLabels.join('|')}`);
    check('E6 角色槽位与全局槽位全部释放',
        sem.active === 0 && roleLimiter.activeTotal === 0,
        `global=${sem.active} role=${roleLimiter.activeTotal}`);

    const cs = orch.getConcurrencyStats();
    check('E7 可观测快照含取消树/角色限流/全局信号量/协作统计四块',
        !!cs.abort && !!cs.roles && !!cs.session && !!cs.multiAgent,
        Object.keys(cs).join(','));
    check('E8 进程级角色限流统计可查（供 /api/stats/agents 暴露）',
        typeof getRoleLimiterStats().activeTotal === 'number');
    check('E9 AbortNode 可序列化为 brief（供前端/日志展示）',
        typeof new AbortNode({ parent: null, label: 'x', tree: new AbortTree() }).brief().label === 'string');

    // dispose 释放任务根节点 → 孤儿指标归零（"永远不为零的指标等于没有指标"）
    orch.dispose();
    check('E10 dispose 释放任务根节点后孤儿归零（泄漏指标可分辨）',
        tree.getStats().orphans === 0, `orphans=${tree.getStats().orphans}`);

    await fs.rm(taskDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
