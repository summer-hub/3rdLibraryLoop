/**
 * M3 验收：F-18 循环检测与预编译语句缓存（两处"文档声称但未实现"的收口）
 *
 * 背景：原代码有两处只声明不使用的死代码，而文档却宣称对应能力存在：
 *   1. `Orchestrator._execPathTrace` + "每个 (taskId,stepId) 只执行一次"的循环检测；
 *   2. `SqliteAdapter._stmtCache` + "预编译 statement 缓存"。
 * 处理方式不是"照着文档硬实现"——严格"只执行一次"会破坏 failStepId 修复链
 * （A 失败→B 修复→回 A 重试）这一有意设计的语义。因此：
 *   - 循环检测改为**加载期静态环检测**（语义正确，且能抓出"nextStepId 写错指回前序"这类编排错误）；
 *   - 语句缓存**真正启用**（去掉每次 prepare 的开销）。
 *
 *   A 环检测：A.failStepId→B、B.nextStepId→A 应被识别为一个环
 *   B 环检测：纯线性链不应报环
 *   C 环检测：自环（nextStepId 指向自己）应被识别
 *   D 环检测：dependId 构成的环也应被识别
 *   E 环不报错（修复链天然成环），但通过 getProgress/exposed 暴露出来
 *   F 死字段 _execPathTrace 已彻底移除
 *   G 语句缓存：同一 SQL 重复调用不再重复 prepare，且缓存有界、close() 后清空
 *   H 语句缓存不改变行为（get/all/exec/upsert 结果正确）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { Orchestrator } = await import(pathToFileURL(`${ROOT}Server/Orchestrator/Orchestrator.js`).href);
const { default: SqliteAdapter } = await import(pathToFileURL(`${ROOT}Server/DbUse/adapters/SqliteAdapter.js`).href);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const storageStub = {
    manager: { rootDir: os.tmpdir() },
    json: () => ({ read: async () => null, write: async () => ({}), delete: async () => true }),
    taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
};

async function load(steps) {
    const orch = new Orchestrator({ storage: storageStub });
    await orch.loadTask({ taskId: 'cycTask', steps });
    return orch;
}

const norm = (cycles) => cycles.map((c) => [...c].sort().join(',')).sort().join(' | ');

// ─── A. failStepId ↔ nextStepId 成环（修复链）────────────────────────────
{
    const orch = await load([
        { stepId: 1, taskDescription: 's1', dependId: 0, nextStepId: 2, failStepId: 0 },
        { stepId: 2, taskDescription: 's2', dependId: 1, nextStepId: 1, failStepId: 0 },
    ]);
    check('A 识别出 1→2→1 的环', orch._cycles.length === 1 && norm(orch._cycles) === '1,2',
        `cycles=${JSON.stringify(orch._cycles)}`);
    check('A 环不导致加载失败（修复链天然成环）', orch.status === 'loaded', `status=${orch.status}`);
}

// ─── B. 线性链无环 ──────────────────────────────────────────────────────
{
    const orch = await load([
        { stepId: 1, taskDescription: 's1', dependId: 0, nextStepId: 2 },
        { stepId: 2, taskDescription: 's2', dependId: 1, nextStepId: 3 },
        { stepId: 3, taskDescription: 's3', dependId: 2, nextStepId: 0 },
    ]);
    check('B 线性链不报环', orch._cycles.length === 0, `cycles=${JSON.stringify(orch._cycles)}`);
}

// ─── C. 自环 ────────────────────────────────────────────────────────────
{
    const orch = await load([
        { stepId: 1, taskDescription: 's1', dependId: 0, nextStepId: 1 },
    ]);
    check('C 自环（nextStepId 指向自己）被识别', orch._cycles.length === 1 && norm(orch._cycles) === '1',
        `cycles=${JSON.stringify(orch._cycles)}`);
}

// ─── D. dependId 成环 ───────────────────────────────────────────────────
{
    // 必须保留一个真正的入口步骤（dependId=0），否则 loadTask 会因
    // "未找到入口步骤" 直接抛错——那是另一类校验，不属于环检测。
    // 这里 2 与 3 互相依赖，而 1 是合法入口，因此能加载成功并暴露环。
    const orch = await load([
        { stepId: 1, taskDescription: 's1', dependId: 0, nextStepId: 0 },
        { stepId: 2, taskDescription: 's2', dependId: 3, nextStepId: 0 },
        { stepId: 3, taskDescription: 's3', dependId: 2, nextStepId: 0 },
    ]);
    check('D dependId 互相依赖被识别为环', orch._cycles.length >= 1 && norm(orch._cycles) === '2,3',
        `cycles=${JSON.stringify(orch._cycles)}`);
}

// ─── E. 环经 getProgress 暴露 ────────────────────────────────────────────
{
    const orch = await load([
        { stepId: 1, taskDescription: 's1', dependId: 0, nextStepId: 2 },
        { stepId: 2, taskDescription: 's2', dependId: 1, nextStepId: 1 },
    ]);
    const progress = orch.getProgress();
    check('E getProgress 暴露 cycles', Array.isArray(progress.cycles) && progress.cycles.length === 1,
        `cycles=${JSON.stringify(progress.cycles)}`);
    check('E cycles 随状态落盘（getPersistableState 含该字段）',
        Array.isArray(orch.getPersistableState().cycles));
}

// ─── F. 死字段已删除 ────────────────────────────────────────────────────
{
    const orch = await load([{ stepId: 1, taskDescription: 's1', dependId: 0, nextStepId: 0 }]);
    check('F _execPathTrace 已彻底移除（不再是实例属性）', orch._execPathTrace === undefined,
        `type=${typeof orch._execPathTrace}`);
}

// ─── G/H. 预编译语句缓存 ────────────────────────────────────────────────
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-stmt-'));
    const db = new SqliteAdapter({ baseDir: tmp, subDir: 'S' });

    await db.exec('CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY, v INTEGER)');
    check('G 初始缓存为空', db.stmtCacheSize === 0, `size=${db.stmtCacheSize}`);

    // 同一 SQL 重复 20 次 → 缓存只应增加 1
    for (let i = 0; i < 20; i++) {
        await db.upsert('t', { id: `k${i}`, v: i });
    }
    const afterSameSql = db.stmtCacheSize;
    check('G 同一 SQL 重复 20 次只缓存 1 条语句', afterSameSql === 1, `size=${afterSameSql}`);

    // 不同 SQL → 缓存增长
    await db.all('SELECT * FROM t WHERE v > ?', [5]);
    await db.get('SELECT COUNT(*) AS n FROM t');
    check('G 不同 SQL 各自缓存', db.stmtCacheSize === 3, `size=${db.stmtCacheSize}`);

    // 行为正确性
    const rows = await db.all('SELECT * FROM t ORDER BY v');
    check('H upsert + all 结果正确', rows.length === 20 && rows[0].id === 'k0' && rows[19].v === 19,
        `rows=${rows.length}`);
    const one = await db.get('SELECT v FROM t WHERE id = ?', ['k7']);
    check('H get 带参数结果正确', one?.v === 7, `v=${one?.v}`);

    await db.exec('UPDATE t SET v = ? WHERE id = ?', [999, 'k1']);
    const updated = await db.get('SELECT v FROM t WHERE id = ?', ['k1']);
    check('H exec 带参数（走缓存语句）结果正确', updated?.v === 999, `v=${updated?.v}`);

    // 缓存命中不应污染结果：再查同一 SQL 仍返回最新值
    const again = await db.get('SELECT v FROM t WHERE id = ?', ['k1']);
    check('H 缓存语句复用后结果一致', again?.v === 999, `v=${again?.v}`);

    await db.close();
    check('G close() 后缓存清空', db.stmtCacheSize === 0, `size=${db.stmtCacheSize}`);

    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
