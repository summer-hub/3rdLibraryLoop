/**
 * M2 验收：F-06 获取超时 / F-07 总结计入并发上限 / F-08 单任务隔离
 *
 * 全部为纯逻辑测试（不连 opencode / LLM）：
 *   A 全局上限不被突破（含并发竞争下）
 *   B 单任务配额生效：一个任务无法吃满全局槽位
 *   C 隔离：A 任务配额耗尽时不阻塞 B 任务（无队头阻塞）
 *   D 获取超时：ok=false、无槽位泄漏、且超时者不会被后续 release 误唤醒
 *   E 租约释放幂等（重复 release 不导致计数漂移）
 *   F FlexRunner 经验总结：取不到槽位时优雅跳过，步骤结果不受影响
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { Semaphore } = await import(pathToFileURL(`${ROOT}Server/Orchestrator/Orchestrator.js`).href);
const { FlexRunner } = await import(pathToFileURL(`${ROOT}Server/FlexRunner/FlexRunner.js`).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// ─── A. 全局上限不被突破 ──────────────────────────────────────────────────
{
    const sem = new Semaphore({ limit: 3, perTaskLimit: 0 });
    let peak = 0;
    const workers = Array.from({ length: 12 }, () => (async () => {
        const lease = await sem.acquire({ key: null });
        peak = Math.max(peak, sem.active);
        await sleep(20);
        lease.release();
    })());
    await Promise.all(workers);
    check('A 12 个并发请求下，活跃数从未超过 limit=3', peak <= 3, `peak=${peak}`);
    check('A 全部完成后 active 归零', sem.active === 0, `active=${sem.active}`);
    check('A 队列清空', sem.waiting === 0, `waiting=${sem.waiting}`);
}

// ─── B. 单任务配额生效 ────────────────────────────────────────────────────
{
    const sem = new Semaphore({ limit: 10, perTaskLimit: 2 });
    let peakA = 0;
    const workers = Array.from({ length: 8 }, () => (async () => {
        const lease = await sem.acquire({ key: 'taskA' });
        peakA = Math.max(peakA, sem.activeForKey('taskA'));
        await sleep(20);
        lease.release();
    })());
    await Promise.all(workers);
    check('B 单任务并发从未超过 perTaskLimit=2（全局还有余量）', peakA <= 2, `peakA=${peakA}`);
    check('B 全部完成后单任务计数归零', sem.activeForKey('taskA') === 0);
}

// ─── C. 隔离：A 配额耗尽不阻塞 B（无队头阻塞）──────────────────────────────
{
    const sem = new Semaphore({ limit: 10, perTaskLimit: 1 });
    const leaseA = await sem.acquire({ key: 'taskA' }); // 占满 A 的配额
    // A 再取会排队；同时 B 应能立即拿到槽位
    const pendingA = sem.acquire({ key: 'taskA', timeoutMs: 300 });
    const leaseB = await sem.acquire({ key: 'taskB', timeoutMs: 1000 });
    check('C A 配额已满时，B 仍能立即取得槽位（有隔离）', leaseB.ok === true, `ok=${leaseB.ok}`);
    const timedOutA = await pendingA;
    check('C A 的排队请求按超时返回（不无限等）', timedOutA.ok === false, `ok=${timedOutA.ok}`);
    leaseB.release();
    leaseA.release();
    check('C 清理后 active 归零', sem.active === 0, `active=${sem.active}`);
}

// ─── D. 获取超时正确性 ────────────────────────────────────────────────────
{
    const sem = new Semaphore({ limit: 1, perTaskLimit: 0 });
    const lease = await sem.acquire({ key: null });
    const t0 = Date.now();
    const denied = await sem.acquire({ key: null, timeoutMs: 250 });
    const cost = Date.now() - t0;
    check('D 满额时 acquire 按时超时返回 ok=false', denied.ok === false, `ok=${denied.ok}`);
    check('D 超时耗时接近设定值', cost >= 200 && cost < 1500, `cost=${cost}ms`);
    check('D 超时后 active 未泄漏（仍为 1，即持锁者的那一个）', sem.active === 1, `active=${sem.active}`);
    check('D 超时者已从队列移除（waiting 不含已放弃者）', sem.waiting === 0, `waiting=${sem.waiting}`);

    // 关键：持锁者释放后，槽位必须归还计数，而不是被已超时的等待者"幽灵接管"
    lease.release();
    check('D 释放后 active 归零（未被幽灵等待者占用）', sem.active === 0, `active=${sem.active}`);
    const again = await sem.acquire({ key: null, timeoutMs: 200 });
    check('D 槽位可被后续请求正常取得', again.ok === true, `ok=${again.ok}`);
    again.release();
    check('D 统计计入超时次数', sem.stats().totalTimedOut === 1, `totalTimedOut=${sem.stats().totalTimedOut}`);
}

// ─── E. 租约释放幂等 ──────────────────────────────────────────────────────
{
    const sem = new Semaphore({ limit: 2, perTaskLimit: 2 });
    const lease = await sem.acquire({ key: 'taskE' });
    lease.release();
    lease.release();
    lease.release();
    check('E 重复 release 后 active 不为负', sem.active === 0, `active=${sem.active}`);
    check('E 重复 release 后单任务计数不为负', sem.activeForKey('taskE') === 0, `n=${sem.activeForKey('taskE')}`);
    const l2 = await sem.acquire({ key: 'taskE', timeoutMs: 300 });
    check('E 计数未漂移：仍可正常取得槽位', l2.ok === true, `ok=${l2.ok}`);
    l2.release();
}

// ─── F. FlexRunner：总结取不到槽位时优雅跳过，不影响步骤结果 ───────────────
{
    const archived = [];
    function makeCli() {
        return {
            getType: () => 'mock',
            checkHealth: async () => ({ status: 'ok' }),
            startSession: async () => ({ sessionId: 'sess-slot' }),
            checkSessionStatus: async () => ({ status: 'completed' }),
            abortSession: async () => {},
            deleteSession: async () => {},
            getSessionMessages: async (id) => { archived.push(id); return []; },
            sendAndWaitMessage: async () => ({ success: true, content: 'x' }),
        };
    }
    async function runWithSemaphore(sem) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'm2-slot-'));
        await fs.writeFile(path.join(dir, 'stepId9_loop0_result_0.md'), '# r\n\n## 执行状态\n\n成功\n', 'utf8');
        await fs.writeFile(path.join(dir, 'stepId9_loop0_Summary_0.md'), '# 经验\n- 无\n', 'utf8');
        const runner = new FlexRunner();
        await runner.initContext({
            taskId: 'slotTask', stepId: 9, taskDir: dir,
            skillDirectory: '', specifiedSkill: 'x',
            taskDescription: 'F-07 slot test',
            cli: makeCli(), storage: { manager: { rootDir: os.tmpdir() }, taskExecStore: () => ({ patchStep: async () => {} }) },
            knowledgeManager: { init: async () => {}, findByDocPath: async () => null, addExperience: async () => ({ id: 'k' }) },
            skillSelector: { match: async () => null },
            pollIntervalMs: 1,
            sessionSemaphore: sem,
        });
        const res = await runner.executeStart();
        await runner.drainBackgroundTasks(5000);
        await sleep(100);
        await fs.rm(dir, { recursive: true, force: true });
        return res;
    }

    // 信号量被外部占满 → 总结应跳过，但步骤仍成功、会话仍被回收
    const sem = new Semaphore({ limit: 1, perTaskLimit: 0 });
    const holder = await sem.acquire({ key: 'other' });
    const prev = process.env.SEMAPHORE_ACQUIRE_TIMEOUT_MS;
    process.env.SEMAPHORE_ACQUIRE_TIMEOUT_MS = '200';
    let res;
    try {
        res = await runWithSemaphore(sem);
    } finally {
        if (prev === undefined) delete process.env.SEMAPHORE_ACQUIRE_TIMEOUT_MS;
        else process.env.SEMAPHORE_ACQUIRE_TIMEOUT_MS = prev;
        holder.release();
    }
    check('F 取不到槽位时，步骤结果仍为成功', res.success === true, `success=${res.success}`);
    check('F 取不到槽位时，会话仍被归档回收', archived.includes('sess-slot'), `archived=${JSON.stringify(archived)}`);
    check('F 信号量最终无泄漏', sem.active === 0, `active=${sem.active}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
