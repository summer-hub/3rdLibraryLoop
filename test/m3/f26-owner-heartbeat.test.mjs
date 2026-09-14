/**
 * M3 验收：F-26 属主判定强化（pid 复用防护）
 *
 * 原实现只凭 `process.kill(pid, 0)` 判断属主是否存活，存在 **pid 复用**风险：
 * 属主进程早已死亡、其 pid 恰被系统分配给一个无关进程 → 任务被永久误判为
 * "仍在执行"，既不恢复也不标失败，成为幽灵任务。现引入心跳时间戳作为
 * **独立于 pid 的时间证据**。
 *
 *   A owner.json 含 startedAt / heartbeatAt
 *   B 无 owner.json → false
 *   C pid == 本进程 → false
 *   D 异机属主 → true（保守，不引入心跳判定）
 *   E pid 已死 → false，且清理残留文件
 *   F **pid 存活但心跳超期 → false**（pid 复用防护，核心断言）并清理残留
 *   G pid 存活且心跳新鲜 → true（正常外部属主，如 3rdloop run）
 *   H 旧版 owner.json（缺心跳字段，仅有 wroteAt）→ 按超期处理（保守）
 *   I 旧版且 wroteAt 也很新 → true（向后兼容，避免误杀正在跑的老版本属主）
 *   J start() 启动心跳、终态后停止心跳（不残留定时器）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { Orchestrator } = await import(pathToFileURL(`${ROOT}Server/Orchestrator/Orchestrator.js`).href);
const { default: OrchestratorController } = await import(
    pathToFileURL(`${ROOT}Server/Routes/controllers/OrchestratorController.js`).href
);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/** 内存版 owner 存储桩 */
function makeOwnerStorage(initial = {}) {
    const files = new Map(Object.entries(initial));
    return {
        files,
        manager: { rootDir: os.tmpdir() },
        json: () => ({
            read: async (key) => files.get(key) ?? null,
            write: async (key, data) => { files.set(key, data); return data; },
            delete: async (key) => files.delete(key),
        }),
    };
}

/** 起一个存活的外部进程，用于模拟"pid 存活" */
const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const livePid = holder.pid;
let holderExited = false;
holder.on('exit', () => { holderExited = true; });

const HOST = os.hostname();
const ago = (ms) => new Date(Date.now() - ms).toISOString();

function makeController(storage) {
    return new OrchestratorController({ storage });
}

// ─── A. owner.json 结构 ─────────────────────────────────────────────────
{
    const storage = makeOwnerStorage();
    const orch = new Orchestrator({ storage });
    await orch.loadTask({ taskId: 'ownA', steps: [{ stepId: 1, taskDescription: 's', dependId: 0, nextStepId: 0 }] });
    orch._startTime = new Date().toISOString();
    await orch._writeOwnerFile();
    const owner = storage.files.get('ownA/owner');
    check('A owner.json 含 pid/hostname/startedAt/heartbeatAt',
        typeof owner?.pid === 'number' && !!owner.hostname && !!owner.startedAt && !!owner.heartbeatAt,
        JSON.stringify(owner));
    orch._stopOwnerHeartbeat();
}

// ─── B/C/D. 基础分支 ────────────────────────────────────────────────────
{
    const c1 = makeController(makeOwnerStorage());
    check('B 无 owner.json → false', (await c1._hasLiveExternalOwner('t')) === false);

    const c2 = makeController(makeOwnerStorage({
        'ownC/owner': { pid: process.pid, hostname: HOST, heartbeatAt: new Date().toISOString() },
    }));
    check('C pid == 本进程 → false', (await c2._hasLiveExternalOwner('ownC')) === false);

    const c3 = makeController(makeOwnerStorage({
        'ownD/owner': { pid: 999999, hostname: 'other-host', heartbeatAt: new Date().toISOString() },
    }));
    check('D 异机属主 → true（保守）', (await c3._hasLiveExternalOwner('ownD')) === true);
}

// ─── E. pid 已死 → false 且清理 ─────────────────────────────────────────
{
    const deadPid = await (async () => {
        const p = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
        await new Promise((r) => p.on('exit', r));
        return p.pid;
    })();
    const storage = makeOwnerStorage({
        'ownE/owner': { pid: deadPid, hostname: HOST, heartbeatAt: new Date().toISOString() },
    });
    const c = makeController(storage);
    const r = await c._hasLiveExternalOwner('ownE');
    check('E pid 已死 → false', r === false, `result=${r}`);
    check('E pid 已死 → 清理残留 owner.json', storage.files.has('ownE/owner') === false);
}

// ─── F. 关键断言：pid 存活 + 心跳超期（pid 复用）────────────────────────
{
    check('前置：外部进程确实存活', holderExited === false && livePid > 0, `pid=${livePid}`);
    process.env.OWNER_STALE_MS = '1000';
    const storage = makeOwnerStorage({
        'ownF/owner': {
            pid: livePid,             // ← 存活（模拟 pid 被无关进程复用）
            hostname: HOST,
            heartbeatAt: ago(60_000), // ← 但心跳已 60s 未更新
            wroteAt: ago(60_000),
        },
    });
    const c = makeController(storage);
    const r = await c._hasLiveExternalOwner('ownF');
    delete process.env.OWNER_STALE_MS;
    check('F pid 存活但心跳超期 → false（pid 复用防护）', r === false, `result=${r}`);
    check('F 同时清理残留 owner.json（避免反复误判）', storage.files.has('ownF/owner') === false);
}

// ─── G. pid 存活 + 心跳新鲜 → true ──────────────────────────────────────
{
    const storage = makeOwnerStorage({
        'ownG/owner': { pid: livePid, hostname: HOST, heartbeatAt: new Date().toISOString() },
    });
    const c = makeController(storage);
    const r = await c._hasLiveExternalOwner('ownG');
    check('G pid 存活且心跳新鲜 → true（正常外部属主）', r === true, `result=${r}`);
    check('G 不清理仍在运行的属主标记', storage.files.has('ownG/owner') === true);
}

// ─── H/I. 旧版格式兼容 ──────────────────────────────────────────────────
{
    process.env.OWNER_STALE_MS = '1000';
    const oldStale = makeOwnerStorage({
        'ownH/owner': { pid: livePid, hostname: HOST, wroteAt: ago(60_000) }, // 无 heartbeatAt
    });
    const cH = makeController(oldStale);
    const rH = await cH._hasLiveExternalOwner('ownH');
    check('H 旧版格式（仅 wroteAt 且已超期）→ false（保守）', rH === false, `result=${rH}`);

    const oldFresh = makeOwnerStorage({
        'ownI/owner': { pid: livePid, hostname: HOST, wroteAt: new Date().toISOString() },
    });
    delete process.env.OWNER_STALE_MS;
    const cI = makeController(oldFresh);
    const rI = await cI._hasLiveExternalOwner('ownI');
    check('I 旧版格式但 wroteAt 新鲜 → true（向后兼容，不误杀在跑的老版本属主）',
        rI === true, `result=${rI}`);
}

// ─── J. 心跳定时器生命周期 ──────────────────────────────────────────────
{
    const storage = makeOwnerStorage();
    const orch = new Orchestrator({
        storage,
        flexRunnerFactory: async () => ({
            taskId: 't', stepId: 1, bigLoopIndex: 0, executeStep: 1, retryTimes: 0,
            maxRetries: 3, sessionId: 's', startTime: null, endTime: null,
            resultPath: '', metrics: null,
            canRetry: () => true,
            controlExecution: async () => true,
            drainBackgroundTasks: async () => ({ drained: true, pending: 0 }),
            executeStart: async () => ({ resultPath: '', success: true, nextStepId: 0, metrics: null }),
        }),
    });
    await orch.loadTask({ taskId: 'ownJ', steps: [{ stepId: 1, taskDescription: 's', dependId: 0, nextStepId: 0 }] });
    check('J 启动前无心跳定时器', orch._ownerHeartbeatTimer === null);
    await orch.start();
    check('J 终态后心跳定时器已停止（不残留定时器）', orch._ownerHeartbeatTimer === null,
        `timer=${orch._ownerHeartbeatTimer}`);
    check('J 终态后 owner.json 已删除', storage.files.has('ownJ/owner') === false);
}

holder.kill('SIGKILL');

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
