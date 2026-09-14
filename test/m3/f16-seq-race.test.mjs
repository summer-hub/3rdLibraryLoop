/**
 * M3 验收：F-16 TaskStepStore 的 seq 分配竞态
 *
 * 核心断言：同一任务内并发创建步骤时 seq 不重复。
 * 原实现是「SELECT MAX(seq)+1 → INSERT」两步且中间有 await 间隙，
 * 并发下会读到同一个 MAX 从而拿到重复 seq（列表按 seq 排序时顺序不确定）。
 *
 * 同时覆盖：
 *   A 并发创建 30 条 → seq 恰好为 1..30 且无重复
 *   B 同一 id 重复创建 → 保留原 seq（幂等，不重排顺序）
 *   C 多任务之间 seq 互不干扰（各从 1 开始）
 *   D 状态流转仍正常（running → completed 维护时间戳与耗时）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fsSync from 'node:fs';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { default: SqliteAdapter } = await import(pathToFileURL(`${ROOT}Server/DbUse/adapters/SqliteAdapter.js`).href);
const { default: TaskStepStore } = await import(pathToFileURL(`${ROOT}Server/DbUse/stores/TaskStepStore.js`).href);

const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'm3-step-'));
const sqlite = new SqliteAdapter({ baseDir: tmp, subDir: 'TaskStep' });
const store = new TaskStepStore({ sqlite });

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// ─── A. 并发创建：seq 不重复 ─────────────────────────────────────────────
{
    const N = 30;
    await Promise.all(Array.from({ length: N }, (_, i) =>
        store.create({ taskId: 'taskA', name: `step-${i}`, type: 'cli' })
    ));

    const rows = await store.listByTask('taskA');
    const seqs = rows.map((r) => r.seq);
    const uniq = new Set(seqs);

    check(`A 并发创建 ${N} 条后条数正确`, rows.length === N, `rows=${rows.length}`);
    check('A seq 无重复（原实现会重复）', uniq.size === N,
        `unique=${uniq.size} duplicates=${N - uniq.size}`);
    check('A seq 恰好覆盖 1..N（连续无空洞）',
        Math.min(...seqs) === 1 && Math.max(...seqs) === N,
        `min=${Math.min(...seqs)} max=${Math.max(...seqs)}`);
}

// ─── B. 同 id 重复创建保留原 seq ─────────────────────────────────────────
{
    const first = await store.create({ taskId: 'taskB', id: 'fixed-step-id', name: 'v1' });
    await store.create({ taskId: 'taskB', id: 'other', name: 'other' });
    const again = await store.create({ taskId: 'taskB', id: 'fixed-step-id', name: 'v2' });

    check('B 同 id 重复创建保留原 seq', again.seq === first.seq,
        `first=${first.seq} again=${again.seq}`);
    check('B 重复创建不新增记录', (await store.listByTask('taskB')).length === 2,
        `rows=${(await store.listByTask('taskB')).length}`);
    check('B 重复创建时字段被更新（upsert 语义）', again.name === 'v2', `name=${again.name}`);
}

// ─── C. 多任务 seq 独立 ──────────────────────────────────────────────────
{
    await Promise.all([
        store.create({ taskId: 'taskC1', name: 'a' }),
        store.create({ taskId: 'taskC2', name: 'b' }),
        store.create({ taskId: 'taskC3', name: 'c' }),
    ]);
    const c1 = await store.listByTask('taskC1');
    const c2 = await store.listByTask('taskC2');
    check('C 不同任务的 seq 各自独立（均为 1）',
        c1[0].seq === 1 && c2[0].seq === 1, `c1=${c1[0].seq} c2=${c2[0].seq}`);
}

// ─── D. 状态流转未受影响 ─────────────────────────────────────────────────
{
    const s = await store.create({ taskId: 'taskD', name: 'flow' });
    await store.update(s.id, { status: 'running' });
    const running = await store.get(s.id);
    check('D running 状态自动写入 started_at', !!running.startedAt, `startedAt=${running.startedAt}`);

    await new Promise((r) => setTimeout(r, 15));
    await store.update(s.id, { status: 'completed', output: { ok: true } });
    const done = await store.get(s.id);
    check('D completed 自动写入 finished_at 与 duration_ms',
        !!done.finishedAt && typeof done.durationMs === 'number' && done.durationMs >= 10,
        `durationMs=${done.durationMs}`);
    check('D output 正确反序列化', done.output?.ok === true);
}

// ─── E. 并发创建 + 并发状态更新交错 ──────────────────────────────────────
{
    const N = 20;
    const created = await Promise.all(Array.from({ length: N }, (_, i) =>
        store.create({ taskId: 'taskE', name: `e-${i}` })
    ));
    // 交错更新
    await Promise.all(created.map((r) => store.update(r.id, { status: 'running' })));
    await Promise.all(created.map((r) => store.update(r.id, { status: 'completed' })));

    const rows = await store.listByTask('taskE');
    const seqs = new Set(rows.map((r) => r.seq));
    check('E 并发建 + 并发改后 seq 仍无重复', seqs.size === N, `unique=${seqs.size}`);
    check('E 全部进入 completed', rows.every((r) => r.status === 'completed'),
        `completed=${rows.filter((r) => r.status === 'completed').length}`);
    const stats = await store.stats('taskE');
    check('E stats 统计正确', stats.total === N && stats.completed === N,
        `total=${stats.total} completed=${stats.completed}`);
}

try { sqlite.close?.(); } catch { /* ignore */ }
try { fsSync.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
