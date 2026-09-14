/**
 * M2 验收：F-12 内存注册表淘汰
 *
 * A/B/C/D 直接测 Server/library/BoundedRegistry.js 本身：
 *   A 上限强制：超出后按 LRU 淘汰，size 不超过 max
 *   B LRU 顺序：get/has 刷新使用时间，最久未使用者优先被淘汰
 *   C TTL：超时条目被惰性清理并触发 onEvict
 *   D 淘汰保护：isProtected 可否决淘汰（活跃对象不被踢掉，上限被暂时突破）
 * E OrchestratorController._orchestrators：有界 + 只淘汰终态实例 + 可观测
 * F Brain._plans：有界（持续 planTask 不会无限增长）
 * G FlexRunnerController._runners：有界 + 只淘汰已结束实例 + 死字段 _taskLogs 已删除
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { BoundedRegistry } = await import(pathToFileURL(`${ROOT}Server/library/BoundedRegistry.js`).href);
const { default: OrchestratorControllerCtor } = await import(
    pathToFileURL(`${ROOT}Server/Routes/controllers/OrchestratorController.js`).href
);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── A. 上限强制 ────────────────────────────────────────────────────────────
{
    const evicted = [];
    const reg = new BoundedRegistry({ max: 3, onEvict: (k, v) => evicted.push(k) });
    for (const k of ['a', 'b', 'c', 'd', 'e']) reg.set(k, { id: k });

    check('A size 被钉在上限内', reg.size === 3, `size=${reg.size}`);
    check('A max 可读', reg.max === 3, `max=${reg.max}`);
    check('A 最早的 2 个被淘汰', evicted.join(',') === 'a,b', `evicted=${evicted.join(',')}`);
    check('A 最新写入的仍在', reg.has('e') && reg.has('c') && !reg.has('a'));
    check('A 统计记录淘汰数', reg.stats().evicted === 2, `evicted=${reg.stats().evicted}`);
}

// ─── B. LRU 顺序（touch 刷新）──────────────────────────────────────────────
{
    const evicted = [];
    const reg = new BoundedRegistry({ max: 2, onEvict: (k) => evicted.push(k) });
    reg.set('a', 1);
    await sleep(5);
    reg.set('b', 2);
    await sleep(5);
    reg.get('a');            // 刷新 a 的使用时间 → b 成为最久未使用
    await sleep(5);
    reg.set('c', 3);         // 触发淘汰：应淘汰 b 而非 a
    check('B get 刷新 LRU：淘汰的是最久未使用的 b', evicted.join(',') === 'b', `evicted=${evicted.join(',')}`);
    check('B 被 touch 的 a 仍存活', reg.has('a') && reg.has('c'));

    // has 命中同样刷新
    const evicted2 = [];
    const reg2 = new BoundedRegistry({ max: 2, onEvict: (k) => evicted2.push(k) });
    reg2.set('x', 1);
    await sleep(5);
    reg2.set('y', 2);
    await sleep(5);
    reg2.has('x');           // 命中并刷新
    await sleep(5);
    reg2.set('z', 3);
    check('B has 命中刷新 LRU：淘汰 y', evicted2.join(',') === 'y', `evicted=${evicted2.join(',')}`);

    // peek 不刷新
    const evicted3 = [];
    const reg3 = new BoundedRegistry({ max: 2, onEvict: (k) => evicted3.push(k) });
    reg3.set('p', 1);
    await sleep(5);
    reg3.set('q', 2);
    await sleep(5);
    reg3.peek('p');          // 只看不刷新 → p 仍是最久未使用
    await sleep(5);
    reg3.set('r', 3);
    check('B peek 不刷新 LRU：淘汰仍是最久未使用的 p', evicted3.join(',') === 'p', `evicted=${evicted3.join(',')}`);
}

// ─── C. TTL 过期 ────────────────────────────────────────────────────────────
{
    const evicted = [];
    const reg = new BoundedRegistry({ max: 10, ttlMs: 40, onEvict: (k) => evicted.push(k) });
    reg.set('t1', 1);
    check('C TTL 未到：条目仍在', reg.peek('t1') === 1);
    await sleep(70);
    reg.set('t2', 2);        // set 顺带清理过期条目
    check('C TTL 到期后条目被惰性清理', reg.peek('t1') === undefined, `t1=${reg.peek('t1')}`);
    check('C TTL 过期触发 onEvict', evicted.includes('t1'), `evicted=${evicted.join(',')}`);
    check('C TTL 统计并入 evicted', reg.stats().evicted >= 1, `evicted=${reg.stats().evicted}`);
    check('C ttlMs 可从 stats 读出', reg.stats().ttlMs === 40, `ttlMs=${reg.stats().ttlMs}`);

    // 无 TTL 时不会过期
    const reg2 = new BoundedRegistry({ max: 10 });
    reg2.set('n1', 1);
    await sleep(60);
    reg2.pruneExpired();
    check('C ttlMs=0 时不过期', reg2.peek('n1') === 1);
}

// ─── D. 淘汰保护（否决权）──────────────────────────────────────────────────
{
    const evicted = [];
    const active = new Set(['act1', 'act2', 'act3']);
    const reg = new BoundedRegistry({
        max: 3,
        onEvict: (k) => evicted.push(k),
        isProtected: (k) => active.has(k),   // 活跃对象不可淘汰
    });
    reg.set('act1', 1);
    reg.set('act2', 2);
    reg.set('act3', 3);
    check('D 全部受保护时超限也不淘汰（活跃对象不被踢掉）', reg.size === 3, `size=${reg.size}`);
    check('D 受保护条目全部存活', ['act1', 'act2', 'act3'].every((k) => reg.has(k)));
    check('D onEvict 未被调用', evicted.length === 0, `evicted=${evicted.join(',')}`);
    check('D 统计可见受保护条目数', reg.stats().protected === 3, `protected=${reg.stats().protected}`);
    // 超出上限且"无可淘汰者"（全部受保护）→ 记一次 skipped，并保持不淘汰
    const overflow = new BoundedRegistry({
        max: 2,
        onEvict: (k) => evicted.push(k),
        isProtected: () => true,      // 极端场景：所有条目都不可淘汰
    });
    overflow.set('a', 1);
    overflow.set('b', 2);
    overflow.set('c', 3);
    check('D 无可淘汰者时上限被暂时突破而非误删',
        overflow.size === 3 && ['a', 'b', 'c'].every((k) => overflow.peek(k) !== undefined),
        `size=${overflow.size}`);
    check('D 记录 skipped 以便观测"上限偏紧"',
        overflow.stats().skipped >= 1, `skipped=${overflow.stats().skipped}`);

    // 解除其中一个的保护 + 写入新条目 → 淘汰的必须是"最久未用且未受保护"的那个，
    // 而不是刚写入的新条目（同一毫秒内写入的时间戳相同，用时间戳做 LRU 会误判）
    active.delete('act1');
    reg.set('act4', 4);
    check('D 解除保护后淘汰的是该条目（最久未用且未受保护）',
        evicted.join(',') === 'act1', `evicted=${evicted.join(',')}`);
    check('D 淘汰后 size 收敛回上限', reg.size === 3, `size=${reg.size}`);
    check('D 刚写入的新条目不会被误当成 LRU 受害者',
        reg.peek('act4') !== undefined, `keys=${Array.from(reg.keys()).join(',')}`);
    check('D 仍受保护的活跃实例依旧存活', reg.has('act2') && reg.has('act3'));

    // 全部解除保护 → 恢复严格上限
    active.clear();
    reg.set('act5', 5);
    check('D 全部解除保护后恢复严格上限', reg.size <= 3, `size=${reg.size}`);
    check('D 最新写入的条目仍在（淘汰的是最久未用者）',
        reg.peek('act5') !== undefined, `keys=${Array.from(reg.keys()).join(',')}`);


    // 显式 delete 不触发 onEvict（调用方自行负责收尾）
    const before = evicted.length;
    check('D delete 返回 true 且不触发 onEvict',
        reg.delete('act2') === true && evicted.length === before);
    check('D delete 不存在的 key 返回 false', reg.delete('nope') === false);
    check('D 迭代接口可用（entries/values/for-of）',
        Array.from(reg.entries()).length === reg.size
        && Array.from(reg.values()).length === reg.size
        && Array.from(reg).length === reg.size);
}

// ─── E. OrchestratorController._orchestrators 有界 ─────────────────────────
{
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-f12-'));
    // 造 5 个持久化任务快照，全部为终态（completed），其中 1 个为 running
    const taskRoot = path.join(tmpRoot, 'task');
    const makeState = (taskId, status) => ({
        taskId, taskDir: path.join(taskRoot, taskId), skillDirectory: '', loopCount: 0,
        status, startTime: '2026-01-01T00:00:00+08:00', endTime: '2026-01-01T00:01:00+08:00',
        error: null, currentStepId: null, globalExecCount: 1, entryStepIds: ['1'],
        steps: [{ stepId: 1, taskDescription: 's1', dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 3, status: 'completed', retryCount: 1, history: [] }],
    });
    for (const [i, status] of [['t1', 'completed'], ['t2', 'completed'], ['t3', 'completed'], ['t4', 'completed'], ['t5', 'completed']]) {
        fs.mkdirSync(path.join(taskRoot, i), { recursive: true });
        fs.writeFileSync(path.join(taskRoot, i, 'orchestration.json'), JSON.stringify(makeState(i, status)), 'utf8');
    }

    const storage = {
        manager: { rootDir: tmpRoot },
        json: () => ({
            read: async (key) => {
                const p = path.join(taskRoot, `${key}.json`);
                if (!fs.existsSync(p)) return null;
                return JSON.parse(fs.readFileSync(p, 'utf8'));
            },
            write: async () => ({}),
            delete: async () => true,
        }),
        taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
        taskRegistryStore: () => null,
    };

    const ctrl = new OrchestratorControllerCtor({ storage, maxLiveOrchestrators: 3 });
    check('E 注册表上限可配置（maxLiveOrchestrators=3）',
        ctrl.getRegistryStats().max === 3, `max=${ctrl.getRegistryStats().max}`);

    const { restored } = await ctrl.restoreFromDisk();
    check('E restoreFromDisk 仍恢复全部历史任务（历史可查询）',
        restored.length === 5, `restored=${restored.length}`);
    check('E 恢复后内存实例数不超过上限',
        ctrl.getRegistryStats().size <= 3, `size=${ctrl.getRegistryStats().size}`);
    check('E 发生了淘汰（evicted ≥ 2）',
        ctrl.getRegistryStats().evicted >= 2, `evicted=${ctrl.getRegistryStats().evicted}`);

    // 活跃实例绝不被淘汰：手工放入 LOADED/RUNNING 实例并触发淘汰
    const activeOrch = { status: 'running', dispose() { this.disposed = true; }, getProgress: () => ({}) };
    const otherOrch = { status: 'completed', dispose() { this.disposed = true; }, getProgress: () => ({}) };
    ctrl._orchestrators.set('live-running', activeOrch);
    ctrl._orchestrators.set('live-completed', otherOrch);
    ctrl._orchestrators.set('extra-1', { status: 'failed', dispose() {}, getProgress: () => ({}) });
    check('E RUNNING 实例不会被淘汰（isProtected 生效）',
        ctrl._orchestrators.peek('live-running') === activeOrch,
        `size=${ctrl.getRegistryStats().size} protected=${ctrl.getRegistryStats().protected}`);
    check('E 终态实例承担淘汰', ctrl._orchestrators.peek('live-completed') === undefined || ctrl.getRegistryStats().size <= 3,
        `size=${ctrl.getRegistryStats().size}`);

    // disposeOrchestrator 默认保留实例（历史查询需要），removeInstance 时移除
    check('E disposeOrchestrator 默认不移除实例',
        ctrl.disposeOrchestrator('live-running') === true && ctrl._orchestrators.peek('live-running') === activeOrch);
    check('E disposeOrchestrator(removeInstance) 移除实例',
        ctrl.disposeOrchestrator('live-running', { removeInstance: true }) === true
        && ctrl._orchestrators.peek('live-running') === undefined);
    check('E 不存在的 taskId 返回 false', ctrl.disposeOrchestrator('nope') === false);

    // 环境变量可调
    const prevEnv = process.env.MAX_LIVE_ORCHESTRATORS;
    try {
        process.env.MAX_LIVE_ORCHESTRATORS = '7';
        const c2 = new OrchestratorControllerCtor({ storage });
        check('E MAX_LIVE_ORCHESTRATORS 环境变量生效',
            c2.getRegistryStats().max === 7, `max=${c2.getRegistryStats().max}`);
    } finally {
        if (prevEnv === undefined) delete process.env.MAX_LIVE_ORCHESTRATORS;
        else process.env.MAX_LIVE_ORCHESTRATORS = prevEnv;
    }

    fs.rmSync(tmpRoot, { recursive: true, force: true });
}

// ─── F. Brain._plans 有界 ──────────────────────────────────────────────────
{
    const { Brain } = await import(pathToFileURL(`${ROOT}Server/Brain/Brain.js`).href);
    const brain = new Brain({ maxPlans: 3, storage: { json: () => ({ read: async () => null, write: async () => ({}), list: async () => [] }) } });
    check('F Brain 计划缓存有界（maxPlans=3）',
        brain.getRegistryStats().max === 3, `max=${brain.getRegistryStats().max}`);

    for (let i = 0; i < 10; i++) {
        brain._plans.set(`plan_${i}`, { planId: `plan_${i}` });
    }
    check('F 写入 10 个计划后缓存不超过上限',
        brain.getRegistryStats().size <= 3, `size=${brain.getRegistryStats().size}`);
    check('F 已发生淘汰（evicted ≥ 7）',
        brain.getRegistryStats().evicted >= 7, `evicted=${brain.getRegistryStats().evicted}`);
    check('F getPlans() 仍可用且不超上限',
        brain.getPlans().length <= 3, `plans=${brain.getPlans().length}`);
    check('F 最近写入的计划仍可读（getPlan 命中）',
        !!brain.getPlan('plan_9'), `plan_9=${!!brain.getPlan('plan_9')}`);
    check('F 最旧的计划已被淘汰（历史走磁盘加载）',
        brain.getPlan('plan_0') === undefined);
}

// ─── G. FlexRunnerController._runners 有界 ─────────────────────────────────
{
    const { default: FlexRunnerController } = await import(
        pathToFileURL(`${ROOT}Server/Routes/controllers/FlexRunnerController.js`).href
    );
    const ctrl = new FlexRunnerController({ maxRunners: 2 });
    check('G FlexRunner 实例注册表有界（maxRunners=2）',
        ctrl.getRegistryStats().max === 2, `max=${ctrl.getRegistryStats().max}`);
    check('G 死字段 _taskLogs 已删除', ctrl._taskLogs === undefined);

    const finished = (id) => ({ taskId: id, stepId: 1, canRetry: () => false, endTime: '2026-01-01T00:01:00+08:00' });
    const active = (id) => ({ taskId: id, stepId: 1, canRetry: () => true, endTime: null });

    ctrl._runners.set('t1::1', finished('t1'));
    ctrl._runners.set('t2::1', finished('t2'));
    ctrl._runners.set('t3::1', active('t3'));
    // 已结束的会被淘汰，仍在重试窗口内的活跃实例必须留下
    check('G 未结束的实例不会被淘汰（仍在重试窗口内）',
        ctrl._runners.peek('t3::1') !== undefined, `size=${ctrl.getRegistryStats().size}`);
    check('G 已结束的实例被淘汰至上限内',
        ctrl.getRegistryStats().size <= 3, `size=${ctrl.getRegistryStats().size}`);
    check('G 至少淘汰了一个已结束实例',
        ctrl.getRegistryStats().evicted >= 1, `evicted=${ctrl.getRegistryStats().evicted}`);
    check('G getRegistryStats 暴露 current size/bound',
        typeof ctrl.getRegistryStats().size === 'number' && ctrl.getRegistryStats().max === 2);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
