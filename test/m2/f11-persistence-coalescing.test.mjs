/**
 * M2 验收：F-11 消除持久化写放大（Server/Orchestrator/Orchestrator.js 持久化层）
 *
 * 全部为纯逻辑测试（不连 opencode / LLM，使用 mock storage 计数落盘次数）：
 *   A 合并窗口：20 次 _emitStepStatus 连发 → 实际落盘 ≤ 5 次，绝大多数请求被合并
 *   B 最新状态：窗口内状态连续变化，落盘快照是最后一次的状态（快照在写入时刻取）
 *   C 关闭合并：PERSIST_DEBOUNCE_MS=0 时每次调用都立即写（可退回旧行为）
 *   D 强制冲刷：窗口内 force（updateStepConfig / flushPersistence）立即落盘，
 *     且不留下待触发的定时器
 *   E 落盘内容可解析、可恢复（合并后仍写出完整合法的 orchestration.json）
 *   F 无悬挂定时器：单次写入失败不打断写链；env 可配置且非法值回退默认
 *
 * 注意：各断言块之间用 settlePersist() 把上一个块的合并定时器排空，
 * 避免跨块计数互相污染（每个 Orchestrator 实例的统计只反映自己的行为，
 * 但定时器是全局的，必须显式等待其触发/被取消）。
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
/** 排空默认 300ms 合并窗口（留 2 倍余量，避免定时器与断言竞争） */
const settlePersist = () => sleep(650);

/** 计数型 mock storage：记录每次 write 的 key 与内容，可重置计数 */
function makeStorage() {
    const writes = [];
    const files = new Map();
    return {
        writes,
        files,
        manager: { rootDir: os.tmpdir() },
        json: () => ({
            write: async (key, data) => {
                writes.push({ key, data });
                files.set(key, JSON.parse(JSON.stringify(data)));
                return data;
            },
            read: async (key) => files.get(key) ?? null,
            delete: async (key) => files.delete(key),
        }),
        taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
        reset() { writes.length = 0; },
        /** 编排快照文件的写入条数（每次 _persistState 落两份：loop 快照 + 最新快照） */
        snapshotWrites() {
            return writes.filter((w) => /orchestration(_loop\d+)?$/.test(w.key)).length;
        },
    };
}

const taskDef = (taskId, stepCount) => ({
    taskId,
    steps: Array.from({ length: stepCount }, (_, i) => ({
        stepId: i + 1,
        taskDescription: `step-${i + 1}`,
        dependId: 0,
        nextStepId: 0,
        failStepId: 0,
        maxRetries: 3,
    })),
});

// ─── A/B. 合并窗口：20 次连发 → 一次落盘，且是最新状态 ─────────────────────
{
    const storage = makeStorage();
    const orch = new Orchestrator({ storage, persistDebounceMs: 300 });
    await orch.loadTask(taskDef('f11-a', 20));

    check('A 合并窗口已生效（debounce=300ms）',
        orch.getPersistStats().debounceMs === 300, `debounceMs=${orch.getPersistStats().debounceMs}`);

    // loadTask 的初始落盘是 force（关键跃迁），此处重置计数只看连发的效果
    storage.reset();

    // 模拟 20 次步骤状态变更（每次都会触发 _persistState）
    for (const node of orch.nodes) {
        orch._emitStepStatus(node);
    }

    const afterEmit = orch.getPersistStats();
    check('A 20 次连发后：实际落盘次数 ≤ 5',
        afterEmit.writes <= 5, `writes=${afterEmit.writes}`);
    check('A 20 次连发后：落盘次数 ≤ 1/4 调用次数（写放大被消除）',
        afterEmit.writes * 4 <= 20, `writes=${afterEmit.writes}`);
    check('A 已安排待触发的合并写入（窗口内不再落盘）',
        afterEmit.pending === true && afterEmit.writes <= 1,
        `pending=${afterEmit.pending} writes=${afterEmit.writes}`);
    check('A 被合并掉的请求数 ≥ 19',
        afterEmit.coalesced >= 19, `coalesced=${afterEmit.coalesced}`);
    check('A 连发期间文件写入次数 ≤ 2（无写放大）',
        storage.snapshotWrites() <= 2, `snapshotWrites=${storage.snapshotWrites()}`);

    // 等待窗口结束，定时器触发一次合并写入
    await settlePersist();
    const afterWindow = orch.getPersistStats();
    check('B 窗口结束后落盘一次（总数 ≤ 5）', afterWindow.writes <= 5, `writes=${afterWindow.writes}`);
    check('B 窗口结束后无待触发定时器', afterWindow.pending === false, `pending=${afterWindow.pending}`);
    check('B 窗口内最多落盘 2 次（20 次请求合并为至多 2 次写）',
        afterWindow.writes <= 2, `writes=${afterWindow.writes}`);

    // B 的关键断言：落盘快照必须是最新状态（含最后一次变更）
    const snapshot = storage.files.get('f11-a/orchestration');
    check('B 落盘快照存在且是合法 JSON', !!snapshot && Array.isArray(snapshot.steps),
        `steps=${snapshot?.steps?.length}`);
    check('B 落盘快照含全部 20 个步骤', snapshot?.steps?.length === 20,
        `steps=${snapshot?.steps?.length}`);
    check('B 落盘快照的状态为最新（最后一步 status 与内存一致）',
        snapshot?.steps?.[19]?.status === orch.nodes[19].status,
        `disk=${snapshot?.steps?.[19]?.status} mem=${orch.nodes[19].status}`);

    // 用落盘快照恢复，验证内容可用
    const restored = new Orchestrator({ storage, persistDebounceMs: 300 });
    await restored.restoreState(snapshot);
    check('B 落盘快照可被 restoreState 正常恢复',
        restored.status === snapshot.status && restored.nodes.length === 20,
        `status=${restored.status} nodes=${restored.nodes.length}`);
    await settlePersist();
}

// ─── C. 关闭合并：debounce=0 → 每次调用立即落盘 ─────────────────────────────
{
    const storage = makeStorage();
    const orch = new Orchestrator({ storage, persistDebounceMs: 0 });
    await orch.loadTask(taskDef('f11-c', 5));
    check('C debounce=0 时 loadTask 仍强制立即落盘（关键跃迁不受合并影响）',
        storage.snapshotWrites() === 2, `snapshotWrites=${storage.snapshotWrites()}`);
    storage.reset();

    for (const node of orch.nodes) {
        orch._emitStepStatus(node);
    }
    // debounce=0 时落盘已排入写链，需等写链排空后再断言"每次都写"。
    // flushPersistence 会先补一次尾部写（此时窗口已关闭，属于幂等空操作），
    // 因此总数 = loadTask 的 1 次 + 5 次连发 + 1 次幂等补写。
    await orch.flushPersistence();
    check('C debounce=0 时 5 次调用全部落盘（可退回旧行为，无合并）',
        orch.getPersistStats().writes >= 6, `writes=${orch.getPersistStats().writes}`);
    check('C debounce=0 时不产生合并计数',
        orch.getPersistStats().coalesced === 0, `coalesced=${orch.getPersistStats().coalesced}`);
    check('C debounce=0 时无待触发定时器', orch.getPersistStats().pending === false);
    check('C 落盘文件为两份/次（reset 后 5 次调用 → 5×2 个文件）',
        storage.snapshotWrites() === 10, `snapshotWrites=${storage.snapshotWrites()}`);
    await settlePersist();
}

// ─── D. 强制冲刷：窗口内 force 立即落盘 + 无残留定时器 ─────────────────────
{
    const storage = makeStorage();
    // 用很长的窗口，确保"立即落盘"只能来自 force，而非窗口到期
    const orch = new Orchestrator({ storage, persistDebounceMs: 60000 });
    await orch.loadTask(taskDef('f11-d', 3));
    storage.reset();

    // 产生一次待触发的合并写入
    orch._emitStepStatus(orch.nodes[0]);
    check('D 已产生待触发的合并写入（窗口 60s 内不会落盘）',
        orch.getPersistStats().pending === true && orch.getPersistStats().writes <= 1,
        `pending=${orch.getPersistStats().pending} writes=${orch.getPersistStats().writes}`);

    // 窗口内发生关键跃迁：修改未执行步骤配置（force 路径）
    const ok = orch.updateStepConfig(1, { taskDescription: 'F-11 forced write' });
    await orch.flushPersistence();
    check('D 关键跃迁（updateStepConfig）成功', ok === true);

    const stats = orch.getPersistStats();
    check('D 窗口内 force 后立即落盘（不等到 60s 窗口）', stats.writes >= 2, `writes=${stats.writes}`);
    check('D force 后待触发定时器已被取消（不会重复写）',
        stats.pending === false, `pending=${stats.pending}`);

    const forced = storage.files.get('f11-d/orchestration');
    check('D force 落盘的是最新状态（含刚改的 taskDescription）',
        forced?.steps?.[0]?.taskDescription === 'F-11 forced write',
        `disk=${forced?.steps?.[0]?.taskDescription}`);

    // flushPersistence 也必须能独立冲刷一次待触发写入
    orch._emitStepStatus(orch.nodes[1]);
    const beforeFlush = orch.getPersistStats().writes;
    await orch.flushPersistence();
    const afterFlush = orch.getPersistStats();
    check('D flushPersistence 会先冲刷待触发写入再等待写链',
        afterFlush.writes === beforeFlush + 1,
        `writes=${afterFlush.writes} before=${beforeFlush}`);
    check('D flushPersistence 后无待触发定时器', afterFlush.pending === false);
    check('D flushPersistence 幂等可用（连续两次不抛错）',
        await orch.flushPersistence().then(() => true));
    await settlePersist();
}

// ─── E. 写失败不阻断链 + env 可配置 ────────────────────────────────────────
{
    let failNext = true;
    const files = new Map();
    const storage = {
        manager: { rootDir: os.tmpdir() },
        json: () => ({
            write: async (key, data) => {
                if (failNext) { failNext = false; throw new Error('模拟磁盘写入失败'); }
                files.set(key, data);
                return data;
            },
            read: async (key) => files.get(key) ?? null,
            delete: async () => true,
        }),
        taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
    };
    const orch = new Orchestrator({ storage, persistDebounceMs: 0 });
    await orch.loadTask(taskDef('f11-e', 2));       // 第一次写失败（已被吞掉并记日志）
    await orch._persistState({ force: true });      // 后续写入必须仍能成功
    check('E 单次写入失败后写链未被打断（后续写入成功落盘）',
        !!files.get('f11-e/orchestration'), `keys=${Array.from(files.keys()).join(',')}`);
    await settlePersist();
}

// ─── F. 环境变量可配置 + 非法值回退默认 ────────────────────────────────────
{
    const prev = process.env.PERSIST_DEBOUNCE_MS;
    try {
        process.env.PERSIST_DEBOUNCE_MS = '50';
        const o1 = new Orchestrator({ storage: makeStorage() });
        check('F PERSIST_DEBOUNCE_MS 生效', o1.getPersistStats().debounceMs === 50,
            `debounceMs=${o1.getPersistStats().debounceMs}`);

        process.env.PERSIST_DEBOUNCE_MS = 'not-a-number';
        const o2 = new Orchestrator({ storage: makeStorage() });
        check('F 非法环境变量回退默认 300ms（不抛错）',
            o2.getPersistStats().debounceMs === 300, `debounceMs=${o2.getPersistStats().debounceMs}`);

        process.env.PERSIST_DEBOUNCE_MS = '0';
        const o3 = new Orchestrator({ storage: makeStorage() });
        check('F PERSIST_DEBOUNCE_MS=0 可关闭合并',
            o3.getPersistStats().debounceMs === 0);
    } finally {
        if (prev === undefined) delete process.env.PERSIST_DEBOUNCE_MS;
        else process.env.PERSIST_DEBOUNCE_MS = prev;
    }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
