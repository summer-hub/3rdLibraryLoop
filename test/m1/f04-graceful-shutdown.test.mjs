/**
 * M1 验收：F-04 优雅停机（Orchestrator.abortAndWait 语义 + 真实 Server 停机序列）
 *
 * 第一部分（in-process，mock runner）：
 *   A 运行中停机 → aborted 终态、在途清空、全部 runner 被 abort 且后台任务排空、持久化落盘
 *   B 已加载未启动 → 直接标记 aborted
 *   C 步骤忽略 abort → 停机仍在预算内有界返回，并如实上报未收尾数量
 *
 * 第二部分（子进程 + 真实 Server）：验证 gracefulShutdown 的日志序列与退出码。
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { Orchestrator } = await import(pathToFileURL(`${ROOT}Server/Orchestrator/Orchestrator.js`).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// ─── 第一部分：abortAndWait 单元语义 ───────────────────────────────────────

function makeStorage() {
    const writes = [];
    return {
        writes,
        manager: { rootDir: os.tmpdir() },
        json: () => ({
            write: async (key) => { writes.push(key); return {}; },
            read: async () => null,
            delete: async () => true,
        }),
        taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
    };
}

function makeRunnerFactory({ abortWorks = true } = {}) {
    const runners = [];
    const factory = async (node) => {
        const runner = {
            aborted: false, drainCalls: 0,
            taskId: 't', stepId: Number(node.stepId), bigLoopIndex: 0,
            executeStep: 1, retryTimes: 0, maxRetries: 3, sessionId: `sess-${node.stepId}`,
            startTime: null, endTime: null, resultPath: '', metrics: null,
            canRetry: () => true,
            controlExecution: async (type) => { if (type === 'abort') runner.aborted = true; return true; },
            drainBackgroundTasks: async () => { runner.drainCalls++; return { drained: true, pending: 0 }; },
            executeStart: async () => {
                if (!abortWorks) {
                    // 模拟「忽略 abort 的卡死步骤」：一直挂住，用于验证停机被超时兜底
                    await sleep(3000);
                    return { resultPath: '', success: true, nextStepId: 0, metrics: null };
                }
                const deadline = Date.now() + 30000;
                while (Date.now() < deadline && !runner.aborted) {
                    await sleep(20);
                }
                return { resultPath: '', success: true, nextStepId: 0, metrics: null };
            },
        };
        runners.push(runner);
        return runner;
    };
    return { factory, runners };
}

const def = (id) => ({
    taskId: id,
    steps: [
        { stepId: 1, taskDescription: 's1', dependId: 0, nextStepId: 0, maxRetries: 3 },
        { stepId: 2, taskDescription: 's2', dependId: 0, nextStepId: 0, maxRetries: 3 },
    ],
});

// A. 运行中停机
{
    const storage = makeStorage();
    const { factory, runners } = makeRunnerFactory();
    const orch = new Orchestrator({ storage, flexRunnerFactory: factory });
    await orch.loadTask(def('f04-a'));
    const startP = orch.start();
    await sleep(200);
    check('A 停机前：running 且有 2 个在途步骤',
        orch.status === 'running' && orch.nodes.filter((n) => n.isRunning).length === 2,
        `status=${orch.status} running=${orch.nodes.filter((n) => n.isRunning).length}`);

    const t0 = Date.now();
    const r = await orch.abortAndWait({ timeoutMs: 5000 });
    const cost = Date.now() - t0;
    await startP;

    check('A 停机后：进入 aborted 终态', r.status === 'aborted', `status=${r.status}`);
    check('A 停机后：在途步骤已清空', r.inFlight === 0, `inFlight=${r.inFlight}`);
    check('A 停机后：所有 runner 被 abort', runners.length === 2 && runners.every((x) => x.aborted));
    check('A 停机后：后台任务已排空（drainCalls=1）', runners.every((x) => x.drainCalls === 1),
        `drainCalls=${runners.map((x) => x.drainCalls).join(',')}`);
    check('A 停机后：无未收尾项', r.pending === 0, `pending=${r.pending}`);
    check('A 停机后：持久化链已落盘', storage.writes.length > 0, `writes=${storage.writes.length}`);
    check('A 停机耗时在预算内', cost < 5000, `cost=${cost}ms`);
}

// B. 已加载未启动
{
    const storage = makeStorage();
    const { factory } = makeRunnerFactory();
    const orch = new Orchestrator({ storage, flexRunnerFactory: factory });
    await orch.loadTask(def('f04-b'));
    const r = await orch.abortAndWait({ timeoutMs: 1000 });
    check('B 已加载未启动：直接标记 aborted', r.status === 'aborted', `status=${r.status}`);
    check('B 已加载未启动：无在途步骤', r.inFlight === 0);
}

// C. 步骤忽略 abort → 有界返回
{
    const storage = makeStorage();
    const { factory } = makeRunnerFactory({ abortWorks: false });
    const orch = new Orchestrator({ storage, flexRunnerFactory: factory });
    await orch.loadTask(def('f04-c'));
    const startP = orch.start();
    await sleep(150);
    const t0 = Date.now();
    const r = await orch.abortAndWait({ timeoutMs: 600 });
    const cost = Date.now() - t0;
    check('C 忽略 abort：停机仍在预算内有界返回', cost < 3000, `cost=${cost}ms`);
    check('C 忽略 abort：如实上报未收尾数量', r.inFlight > 0 || r.pending > 0, `inFlight=${r.inFlight} pending=${r.pending}`);
    await orch.abort();
    await startP;
}

// ─── 第二部分：真实 Server 的 gracefulShutdown 序列 ────────────────────────

const PORT = 13002;
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'f04-e2e-'));
const childFile = path.join(tmpDir, 'child.mjs');
writeFileSync(childFile, `
import { pathToFileURL } from 'node:url';
const { createServer } = await import(pathToFileURL(${JSON.stringify(`${ROOT}Server/Routes/server.js`)}).href);
const server = await createServer({ port: ${PORT} });
setTimeout(() => {
  console.log('[TEST] 触发 gracefulShutdown');
  server.gracefulShutdown({ exitCode: 0, timeoutMs: 15000 });
}, 1200);
`, 'utf8');

const child = spawn(process.execPath, [childFile], {
    cwd: ROOT,
    env: { ...process.env, '3LIB_DATA_DIR': path.join(tmpDir, 'db') },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (c) => { out += c.toString(); });
child.stderr.on('data', (c) => { out += c.toString(); });

const t0 = Date.now();
const code = await new Promise((resolve) => {
    const killTimer = setTimeout(() => { child.kill('SIGKILL'); resolve('TIMEOUT'); }, 30000);
    child.on('exit', (c) => { clearTimeout(killTimer); resolve(c); });
});
const e2eCost = Date.now() - t0;

check('E2E 进程以退出码 0 正常退出（非硬杀）', code === 0, `code=${code}`);
check('E2E 停机耗时在预算内', e2eCost < 20000, `cost=${e2eCost}ms`);
check('E2E 输出「正在关闭」', out.includes('正在关闭'));
check('E2E 执行了编排收尾统计', out.includes('优雅停机'));
check('E2E 输出「已关闭」', out.includes('已关闭'));
check('E2E 未触发硬超时兜底', !out.includes('优雅关闭超时'));
check('E2E 收尾顺序正确（停收 → 收尾 → 关闭）',
    out.indexOf('正在关闭') < out.indexOf('优雅停机') && out.indexOf('优雅停机') < out.indexOf('已关闭'));

try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
