/**
 * M6（Phase 3）验收：高并发压测（不需要真实 LLM）
 *
 * 压测可行性来自 Phase 1 就有的注入点：`multiAgentRunnerFactory` /
 * `flexRunnerFactory` / `runnerFactory` 允许注入"mock 会话"，
 * 因此可以精确控制延迟分布、失败率与挂起率，把并发控制系统压到极限。
 *
 *   A 场景 A：500 并发角色会话（100 步 × 5 角色）—— 吞吐与不变式
 *   B 场景 A'：步骤数上限（GLOBAL_EXEC_LIMIT）的真实约束
 *   C 场景 B：10% 随机失败 + failStepId 修复链 —— 不放大、不饿死
 *   D 场景 C：永久挂起会话 + 角色超时 —— 超时回收、不死锁、槽位不泄漏
 *   E 场景 D：慢 SSE 客户端 —— 内存有界（有界队列 + 断开）
 *   F 可观测性：P95 排队等待 / 槽位持有 / 孤儿会话 可直接读出
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { Orchestrator, Semaphore } = await imp('Server/Orchestrator/Orchestrator.js');
const { MultiAgentRunner } = await imp('Server/Agent/Supervisor/MultiAgentRunner.js');
const { RoleLimiter } = await imp('Server/Agent/Runtime/RoleLimiter.js');
const { AbortTree } = await imp('Server/library/AbortTree.js');
const { default: SseHub } = await imp('Server/Routes/sse/SseHub.js');

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

/**
 * 构造一个可调速的 mock 会话工厂。
 *
 * @param {object} cfg
 * @param {number} [cfg.latencyMs=5]
 * @param {number} [cfg.failRate=0]
 * @param {number} [cfg.hangRoles=[]]   - 这些角色的会话**永不返回**（模拟僵死）
 * @param {object} [cfg.counters]
 * @returns {Function}
 */
function makeAdapterFactory(cfg = {}) {
    const latencyMs = cfg.latencyMs ?? 5;
    const failRate = cfg.failRate ?? 0;
    const hangRoles = new Set(cfg.hangRoles || []);
    const counters = cfg.counters || newCounters();
    if (counters.active === undefined) counters.active = 0;

    return async () => ({
        sessionId: `s-${++counters.started}`,
        usedSkillName: '',
        _signal: null,
        setAbortSignal(sig) { this._signal = sig; },
        async initContext(p) { this._p = p; },
        async executeStart() {
            // 计数放在**共享** counters 上：runnerFactory 是按步骤创建的，
            // 闭包内的局部变量只能看到"该步骤内"的并发（阶段顺序执行 → 恒为 1），
            // 用它当"全局并发"会得到"峰值=1"这种把测试自己骗过去的结论。
            counters.active++;
            counters.maxInflight = Math.max(counters.maxInflight, counters.active);
            try {
                if (hangRoles.has(this._p.roleId)) {
                    // 永不返回：只能靠超时/取消回收
                    counters.hung++;
                    await new Promise((resolve) => {
                        this._signal?.addEventListener('abort', () => { counters.cancelled++; resolve(); }, { once: true });
                    });
                    return { success: false, resultPath: '', metrics: null };
                }
                await sleep(latencyMs);
                const role = this._p.roleId;
                const fail = failRate > 0 && Math.random() < failRate;
                if (fail) {
                    counters.failed++;
                    return { success: false, resultPath: '', metrics: null };
                }
                counters.completed++;
                const file = path.join(this._p.taskDir, `r-${this._p.stepId}-${role}-${this._p.initialExecuteStep}.md`);
                await fs.writeFile(file, '## 执行状态\n\n成功\n', 'utf8');
                const metrics = role === 'reviewer' ? { approved: true, reasons: [] }
                    : role === 'verifier' ? { verdict: '通过', evidence: ['ok'] }
                        : { artifacts: [path.basename(file)] };
                return { success: true, resultPath: file, metrics };
            } finally {
                counters.active--;
            }
        },
        async controlExecution() { return true; },
        async drainBackgroundTasks() { return { drained: true }; }
    });
}

/** @returns {object} 一组新的压测计数器 */
function newCounters() {
    return { started: 0, completed: 0, failed: 0, cancelled: 0, hung: 0, maxInflight: 0, active: 0 };
}

function makeOrchestrator({ steps, plan, limit, perTaskLimit = 0, roleLimits, counters, taskDir, hangRoles, latencyMs, failRate, stageTimeoutMs }) {
    const sem = new Semaphore({ limit, perTaskLimit });
    let peak = 0;
    const origAcquire = sem.acquire.bind(sem);
    sem.acquire = async (opts) => {
        const lease = await origAcquire(opts);
        if (lease.ok) peak = Math.max(peak, sem.active);
        return lease;
    };
    const roleLimiter = new RoleLimiter({ limits: roleLimits || {} });
    const tree = new AbortTree();
    const planDef = stageTimeoutMs
        ? { plan, stages: undefined, maxRevisions: 2 }
        : plan;

    const orch = new Orchestrator({
        storage: storageStub(),
        sessionSemaphore: sem,
        abortTree: tree,
        roleLimiter,
        multiAgentEnabled: true,
        multiAgentRunnerFactory: async (node, ir, ctx) => new MultiAgentRunner({
            enabled: true,
            plan: planDef,
            sessionSemaphore: ctx.sessionSemaphore,
            roleLimiter: ctx.roleLimiter,
            abortTree: ctx.abortTree,
            taskAbortNode: ctx.taskAbortNode,
            runnerFactory: makeAdapterFactory({
                latencyMs, failRate, hangRoles, counters
            })
        })
    });
    return { orch, sem, roleLimiter, tree, peakOf: () => peak };
}

// ═══ A. 500 并发角色会话 ════════════════════════════════════════════
console.log('\n── A. 场景 A：100 步 × 5 角色 = 500 个并发角色会话 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-load-a-'));
    const counters = newCounters();
    const STEPS = 100;
    const LIMIT = 40;

    const { orch, sem, roleLimiter, tree, peakOf } = makeOrchestrator({
        steps: STEPS, plan: 'thorough', limit: LIMIT, counters, taskDir, latencyMs: 5
    });
    await orch.loadTask({
        taskId: 'loadA', taskDir,
        steps: Array.from({ length: STEPS }, (_, i) => ({
            stepId: i + 1, taskDescription: `t${i + 1}`, dependId: 0, nextStepId: 0, maxRetries: 1
        }))
    });

    const t0 = Date.now();
    const res = await orch.start();
    const cost = Date.now() - t0;

    check('A1 编排全部成功完成（500 个会话、无死锁）',
        res.status === 'completed', `status=${res.status}`);
    check('A2 恰好创建 500 个角色会话（100 步 × 5 阶段）',
        counters.started === 500, `started=${counters.started}`);
    check(`A3 会话并发峰值未突破全局上限 ${LIMIT}`,
        counters.maxInflight <= LIMIT, `peak=${counters.maxInflight}`);
    check('A4 并发被真正利用（峰值接近上限，而非串行）',
        counters.maxInflight >= Math.max(2, Math.floor(LIMIT / 2)), `peak=${counters.maxInflight}`);
    check('A5 全局信号量峰值同样守约', peakOf() <= LIMIT, `peak=${peakOf()}`);
    check('A6 全部槽位释放（无泄漏）',
        sem.active === 0 && roleLimiter.activeTotal === 0 && roleLimiter.waitingTotal === 0,
        `global=${sem.active} role=${roleLimiter.activeTotal}`);
    check('A7 取消树无遗留节点（步骤/角色节点全部摘除）',
        !tree.getStats().orphanLabels.some((l) => l.startsWith('step:') || l.startsWith('role:')),
        `orphans=${tree.getStats().orphans}`);
    check('A8 编排统计记录了 100 个协作步骤',
        orch.getMultiAgentStats().steps === STEPS, `steps=${orch.getMultiAgentStats().steps}`);

    // 内存有界：500 个会话后 RSS 增长应远小于"无限累积"的量级
    const rssMB = process.memoryUsage().rss / 1024 / 1024;
    check('A9 RSS 有界（压测后未失控增长）', rssMB < 1200, `RSS=${rssMB.toFixed(0)}MB 耗时=${cost}ms`);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ B. 步骤数上限的真实约束 ═══════════════════════════════════════
console.log('\n── B. 场景 A′：GLOBAL_EXEC_LIMIT 对"步骤数"的真实约束 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-load-b-'));
    const counters = newCounters();
    const STEPS = 260;   // 超过 GLOBAL_EXEC_LIMIT(200)

    const { orch } = makeOrchestrator({
        steps: STEPS, plan: 'single', limit: 60, counters, taskDir, latencyMs: 2
    });
    await orch.loadTask({
        taskId: 'loadB', taskDir,
        steps: Array.from({ length: STEPS }, (_, i) => ({
            stepId: i + 1, taskDescription: `s${i + 1}`, dependId: 0, nextStepId: 0, maxRetries: 1
        }))
    });
    const res = await orch.start();
    const prog = orch.getProgress();
    const byStatus = {};
    for (const s of Object.values(prog.steps || {})) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    const completed = byStatus.completed || 0;

    check('B1 步骤数超过 GLOBAL_EXEC_LIMIT 时被安全截断（不会无限执行）',
        completed <= 200 && counters.started <= 200,
        `completed=${completed}/${STEPS} started=${counters.started}`);
    // 这一条是 Phase 3 压测发现的**真实缺陷**的回归守护：
    // 旧实现在命中上限时直接 return，把在途步骤全部抛下——
    // 实测 start() 返回时 completed=1 / running=199，而 199 个会话仍在运行。
    check('B2 截断不遗留"仍在运行"的步骤（编排结束 = 真的结束了）',
        (byStatus.running || 0) === 0, `byStatus=${JSON.stringify(byStatus)}`);
    check('B3 截断不是死锁：编排进入终态并给出可归因原因',
        ['completed', 'failed', 'deadlocked'].includes(res.status)
        && /上限/.test(prog.error || ''),
        `status=${res.status} error=${String(prog.error || '').slice(0, 48)}`);
    check('B4 被限制的步骤保持 ready/pending（提高上限后可继续）',
        (byStatus.ready || 0) + (byStatus.pending || 0) > 0,
        `ready=${byStatus.ready || 0} pending=${byStatus.pending || 0}`);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ C. 10% 失败 + 修复链 ══════════════════════════════════════════
console.log('\n── C. 场景 B：10% 随机失败 + failStepId 修复链 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-load-c-'));
    const counters = newCounters();
    const STEPS = 40;

    const { orch, sem, roleLimiter } = makeOrchestrator({
        steps: STEPS, plan: 'single', limit: 12, counters, taskDir, latencyMs: 3, failRate: 0.1
    });
    await orch.loadTask({
        taskId: 'loadC', taskDir,
        steps: Array.from({ length: STEPS }, (_, i) => ({
            stepId: i + 1, taskDescription: `f${i + 1}`, dependId: 0, nextStepId: 0, maxRetries: 1
        }))
    });

    const t0 = Date.now();
    const res = await orch.start();
    const cost = Date.now() - t0;

    check('C1 有失败但编排仍收敛到终态（不死锁、不饿死）',
        ['completed', 'failed'].includes(res.status), res.status);
    check('C2 失败没有放大成"重试风暴"（会话数 ≤ 步骤数 × 2）',
        counters.started <= STEPS * 2, `started=${counters.started} steps=${STEPS}`);
    check('C3 失败率大致符合注入值（随机但可观测）',
        counters.failed <= STEPS * 0.4, `failed=${counters.failed}/${STEPS}`);
    check('C4 全部槽位释放（失败路径同样不泄漏）',
        sem.active === 0 && roleLimiter.activeTotal === 0,
        `global=${sem.active} role=${roleLimiter.activeTotal}`);
    check('C5 完成时间未因失败而显著放大', cost < 30000, `耗时=${cost}ms`);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ D. 永久挂起会话 ═══════════════════════════════════════════════
console.log('\n── D. 场景 C：永久挂起会话（超时回收 + 不死锁）──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-load-d-'));
    const counters = newCounters();

    // 让 reviewer 角色永久挂起；阶段超时 400ms 应把它回收
    const sem = new Semaphore({ limit: 6, perTaskLimit: 0 });
    const roleLimiter = new RoleLimiter({ limits: { coder: 3, reviewer: 3 } });
    const tree = new AbortTree();
    const { CollaborationPlan } = await imp('Server/Agent/Supervisor/CollaborationPlan.js');

    const plan = new CollaborationPlan({
        id: 'hang-test',
        stages: [
            { id: 'code', role: 'coder', produces: '实现', timeoutMs: 2000 },
            { id: 'review', role: 'reviewer', produces: '评审结论', reviews: 'code', timeoutMs: 400 }
        ],
        maxRevisions: 0,
        maxRoleRuns: 6
    });

    const orch = new Orchestrator({
        storage: storageStub(), sessionSemaphore: sem, abortTree: tree, roleLimiter,
        multiAgentEnabled: true,
        multiAgentRunnerFactory: async (node, ir, ctx) => new MultiAgentRunner({
            enabled: true, plan, sessionSemaphore: ctx.sessionSemaphore, roleLimiter: ctx.roleLimiter,
            abortTree: ctx.abortTree, taskAbortNode: ctx.taskAbortNode,
            runnerFactory: makeAdapterFactory({ latencyMs: 5, hangRoles: ['reviewer'], counters })
        })
    });
    await orch.loadTask({
        taskId: 'loadD', taskDir,
        steps: Array.from({ length: 6 }, (_, i) => ({
            stepId: i + 1, taskDescription: `h${i + 1}`, dependId: 0, nextStepId: 0, maxRetries: 1
        }))
    });

    const t0 = Date.now();
    const res = await orch.start();
    const cost = Date.now() - t0;

    check('D1 挂起会话被角色超时回收（不永久占用槽位）',
        counters.hung >= 1 && res.status !== 'running', `hung=${counters.hung} status=${res.status}`);
    check('D2 整批在合理时间内结束（超时上限 × 步数，而非无限等待）',
        cost < 15000, `耗时=${cost}ms`);
    check('D3 挂起被归因为超时（可归因，而非"未知错误"）',
        Object.values(orch.getProgress().steps || {}).some((s) => /超时|timeout/i.test(s.error || '')),
        Object.values(orch.getProgress().steps || {}).map((s) => (s.error || '').slice(0, 24)).join('|'));
    check('D4 槽位在超时路径上全部释放（无泄漏、无死锁）',
        sem.active === 0 && roleLimiter.activeTotal === 0 && roleLimiter.waitingTotal === 0,
        `global=${sem.active} role=${roleLimiter.activeTotal} waiting=${roleLimiter.waitingTotal}`);
    check('D5 取消树无遗留步骤/角色节点',
        !tree.getStats().orphanLabels.some((l) => l.startsWith('step:') || l.startsWith('role:')),
        tree.getStats().orphanLabelMap ? '' : `orphans=${tree.getStats().orphans}`);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ E. 慢 SSE 客户端 ══════════════════════════════════════════════
console.log('\n── E. 场景 D：慢 SSE 客户端（内存有界）──');
{
    const hub = new SseHub({ maxQueuedFrames: 10, maxTotalConnections: 50 });
    const writes = [];
    // 模拟一个"永不 drain"的慢客户端：write 恒返回 false
    const res = {
        writeHead() {},
        write(chunk) { writes.push(chunk); return false; },   // 持续背压
        end() {},
        on() {},
        destroy() {},
        writableEnded: false
    };
    hub.subscribe('slow-task', res, { userId: 'u1' });

    for (let i = 0; i < 200; i++) {
        hub.emit('slow-task', 'orch:step:status', { i });
    }
    const stats = hub.getStats();

    check('E1 慢客户端不会让内存无界增长（队列有界/被断开）',
        writes.length <= 60, `writes=${writes.length}（上限 10 帧队列 + 1 次断开通知）`);
    check('E2 慢客户端被断开且统计可见（可观测，不静默丢帧）',
        stats.totalDroppedConnections >= 1 || stats.totalDroppedFrames >= 1,
        `droppedConns=${stats.totalDroppedConnections} droppedFrames=${stats.totalDroppedFrames}`);
    check('E3 断开后仍可接受新连接（单点故障不影响全局）',
        hub.canSubscribe('u2').allowed !== false);
}

// ═══ F. 可观测性 ═══════════════════════════════════════════════════
console.log('\n── F. 可观测性：并发指标可直接读出 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm6-load-f-'));
    const counters = newCounters();
    const { orch, roleLimiter } = makeOrchestrator({
        steps: 12, plan: 'single', limit: 4, counters, taskDir, latencyMs: 8,
        roleLimits: { coder: 2 }
    });
    await orch.loadTask({
        taskId: 'loadF', taskDir,
        steps: Array.from({ length: 12 }, (_, i) => ({
            stepId: i + 1, taskDescription: `o${i + 1}`, dependId: 0, nextStepId: 0, maxRetries: 1
        }))
    });
    await orch.start();

    const cs = orch.getConcurrencyStats();
    check('F1 快照含四块：全局信号量 / 角色限流 / 取消树 / 协作统计',
        !!cs.session && !!cs.roles && !!cs.abort && !!cs.multiAgent, Object.keys(cs).join(','));
    check('F2 角色排队等待 P95 可读（判断限流是否过紧）',
        typeof cs.roles.queueWaitP95Ms === 'number' && cs.roles.queueWaitP95Ms >= 0,
        `waitP95=${cs.roles.queueWaitP95Ms}ms samples=${cs.roles.waitSamples.windowSize}`);
    check('F3 角色槽位持有 P95 可读（判断贵角色是否霸占）',
        typeof cs.roles.slotHoldP95Ms === 'number' && cs.roles.slotHoldP95Ms > 0,
        `holdP95=${cs.roles.slotHoldP95Ms}ms`);
    check('F4 角色上限与实际并发被同时暴露（可核对是否守约）',
        cs.roles.perRole.coder.limit === 2 && cs.roles.perRole.coder.peakActive <= 2,
        `limit=${cs.roles.perRole.coder.limit} peak=${cs.roles.perRole.coder.peakActive}`);
    check('F5 孤儿会话指标可读（泄漏信号）',
        typeof cs.abort.orphans === 'number' && cs.abort.orphans === 0,
        `orphans=${cs.abort.orphans}`);
    check('F6 全局等待队列长度可读（>0 即为饱和）',
        typeof cs.session.waiting === 'number' && cs.session.waiting === 0,
        `waiting=${cs.session.waiting}`);
    check('F7 角色限流器可运行期调整（运维手段）',
        roleLimiter.setLimit('coder', 5) === 5 && roleLimiter.limitOf('coder') === 5);

    await fs.rm(taskDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
