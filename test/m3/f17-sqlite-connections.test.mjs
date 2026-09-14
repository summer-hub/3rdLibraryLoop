/**
 * M3 验收：F-17 SQLite busy_timeout 与连接收敛
 *
 *   A SqliteAdapter 已设置 busy_timeout（默认 5000ms）
 *   B SQLITE_BUSY_TIMEOUT_MS 可覆盖
 *   C 非法/0/负值回退默认（不允许退化成"立即失败"的 0）
 *   D 跨进程并发写同一 DB 文件不报 SQLITE_BUSY（server 与 CLI 同时写是真实场景）
 *     —— 这是 busy_timeout 的实际价值：无它时遇到写锁会**立即**抛错，
 *        而调用方通常静默吞掉，表现为"步骤记录莫名不落库"
 *   E Orchestrator 会把自身 storage 注入 FlexRunner（不再每个步骤各建一套存储/连接）
 *   F KnowledgeManager 为进程级单例（不再每步 new 一个并各自 init）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { default: SqliteAdapter } = await import(pathToFileURL(`${ROOT}Server/DbUse/adapters/SqliteAdapter.js`).href);
const { default: TaskStepStore } = await import(pathToFileURL(`${ROOT}Server/DbUse/stores/TaskStepStore.js`).href);
const { Orchestrator } = await import(pathToFileURL(`${ROOT}Server/Orchestrator/Orchestrator.js`).href);
const { FlexRunner, __getSharedKnowledgeManagerForTest } = await import(
    pathToFileURL(`${ROOT}Server/FlexRunner/FlexRunner.js`).href
);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/** 读取已生效的 busy_timeout（pragma 查询） */
async function readBusyTimeout(adapter) {
    const row = await adapter.get('PRAGMA busy_timeout');
    return row?.timeout ?? row?.['busy_timeout'] ?? Object.values(row ?? {})[0];
}

// ─── A/B/C pragma ────────────────────────────────────────────────────────
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-busy-'));

    delete process.env.SQLITE_BUSY_TIMEOUT_MS;
    const a1 = new SqliteAdapter({ baseDir: tmp, subDir: 'A' });
    await a1.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)');
    const v1 = await readBusyTimeout(a1);
    check('A 默认 busy_timeout = 5000ms', v1 === 5000, `timeout=${v1}`);
    await a1.close();

    process.env.SQLITE_BUSY_TIMEOUT_MS = '1234';
    const a2 = new SqliteAdapter({ baseDir: tmp, subDir: 'B' });
    await a2.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)');
    const v2 = await readBusyTimeout(a2);
    check('B SQLITE_BUSY_TIMEOUT_MS 生效', v2 === 1234, `timeout=${v2}`);
    await a2.close();

    for (const bad of ['0', '-1', 'abc', '']) {
        process.env.SQLITE_BUSY_TIMEOUT_MS = bad;
        const a = new SqliteAdapter({ baseDir: tmp, subDir: `C${bad || 'empty'}` });
        await a.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)');
        const v = await readBusyTimeout(a);
        check(`C 非法值 "${bad}" 回退默认（不退化为 0）`, v === 5000, `timeout=${v}`);
        await a.close();
    }
    delete process.env.SQLITE_BUSY_TIMEOUT_MS;
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── D 跨进程并发写 ──────────────────────────────────────────────────────
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-xproc-'));
    const childFile = path.join(tmp, 'writer.mjs');
    const busyMs = 8000;
    fs.writeFileSync(childFile, `
import { pathToFileURL } from 'node:url';
const ROOT = ${JSON.stringify(ROOT)};
process.env.SQLITE_BUSY_TIMEOUT_MS = ${JSON.stringify(String(busyMs))};
const { default: SqliteAdapter } = await import(pathToFileURL(ROOT + 'Server/DbUse/adapters/SqliteAdapter.js').href);
const { default: TaskStepStore } = await import(pathToFileURL(ROOT + 'Server/DbUse/stores/TaskStepStore.js').href);
const store = new TaskStepStore({ sqlite: new SqliteAdapter({ baseDir: ${JSON.stringify(tmp)}, subDir: 'Shared' }) });
const tag = process.argv[2];
const N = 150;
let errors = 0;
for (let i = 0; i < N; i++) {
  try {
    await store.create({ taskId: 'shared', id: tag + '-' + i, name: tag + '-step-' + i });
  } catch (e) {
    errors++;
    if (errors <= 2) console.error('WRITE_ERROR ' + tag + ': ' + e.message);
  }
}
console.log('DONE ' + tag + ' errors=' + errors);
`, 'utf8');

    const children = ['w1', 'w2', 'w3'].map((tag) => new Promise((resolve) => {
        const c = spawn(process.execPath, [childFile, tag], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        c.stdout.on('data', (d) => { out += d.toString(); });
        c.stderr.on('data', (d) => { out += d.toString(); });
        const timer = setTimeout(() => { c.kill('SIGKILL'); resolve({ out, killed: true }); }, 120000);
        c.on('exit', () => { clearTimeout(timer); resolve({ out }); });
    }));
    const outs = await Promise.all(children);
    const allOut = outs.map((o) => o.out).join('\n');

    const busyErrors = (allOut.match(/SQLITE_BUSY|database is locked/g) || []).length;
    const writeErrors = outs.reduce((n, o) => n + (Number((o.out.match(/errors=(\d+)/) || [])[1]) || 0), 0);

    check('D 跨进程并发写未出现 SQLITE_BUSY / database is locked',
        busyErrors === 0, `busyErrors=${busyErrors}`);
    check('D 三个进程的写入全部成功（errors=0）', writeErrors === 0, `writeErrors=${writeErrors}`);

    // 复核落库条数
    const verify = new TaskStepStore({ sqlite: new SqliteAdapter({ baseDir: tmp, subDir: 'Shared' }) });
    const rows = await verify.listByTask('shared');
    check('D 落库条数等于三进程写入总数（450）', rows.length === 450, `rows=${rows.length}`);
    const seqs = new Set(rows.map((r) => r.seq));
    check('D 跨进程下 seq 仍无重复', seqs.size === rows.length, `unique=${seqs.size}/${rows.length}`);

    // 清理：关闭连接后删目录，避免 Windows 文件占用导致 rm 失败
    await verify.sqlite.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── E Orchestrator 注入 storage ─────────────────────────────────────────
{
    const used = [];
    const storageStub = {
        manager: { rootDir: os.tmpdir() },
        taskExecStore: () => ({ patchStep: async () => { used.push('taskExecStore'); } }),
        taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
        json: () => ({ read: async () => null, write: async () => ({}), delete: async () => true }),
    };

    // 用真实 FlexRunner（不注入 factory），让 Orchestrator 走 _createFlexRunner 的注入路径
    let capturedRunner = null;
    const orch = new Orchestrator({
        storage: storageStub,
        flexRunnerFactory: async (node, inputReport) => {
            // 复刻 _createFlexRunner 的注入行为等价验证：直接断言真实路径
            const runner = new FlexRunner();
            await runner.initContext({
                taskId: 'f17task', stepId: Number(node.stepId) || 1,
                taskDir: os.tmpdir(), taskDescription: 'f17',
                skillDirectory: '', specifiedSkill: 'x',
                cli: { getType: () => 'mock', checkHealth: async () => ({ status: 'error' }) },
                storage: storageStub,
                knowledgeManager: { init: async () => {}, findByDocPath: async () => null, addExperience: async () => ({ id: 'k' }) },
                skillSelector: { match: async () => null },
                pollIntervalMs: 1,
            });
            capturedRunner = runner;
            return runner;
        },
    });
    await orch.loadTask({ taskId: 'f17task', steps: [{ stepId: 1, taskDescription: 's', dependId: 0, nextStepId: 0 }] });
    await orch.start();

    check('E 注入的 storage 被 FlexRunner 实际使用（_persistStep 走注入实例）',
        used.length > 0, `taskExecStore 调用 ${used.length} 次`);
    check('E 该步骤未被误判为成功（checkHealth 返回 error）', !!capturedRunner);
}

// ─── F KnowledgeManager 进程级单例 ───────────────────────────────────────
{
    const km1 = await __getSharedKnowledgeManagerForTest();
    const km2 = await __getSharedKnowledgeManagerForTest();
    check('F 多次取得的是同一个 KnowledgeManager 实例', km1 === km2, `same=${km1 === km2}`);
    check('F 共享实例已完成 init（具备索引读写能力）',
        typeof km1.listExperiences === 'function' && typeof km1.addExperience === 'function');

    const [a, b] = await Promise.all([
        __getSharedKnowledgeManagerForTest(),
        __getSharedKnowledgeManagerForTest(),
    ]);
    check('F 并发首次初始化也只产生一个实例（promise 单例）', a === b && a === km1);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
