/**
 * M3 验收：F-14 统计计数并发安全 / F-15 知识索引读写串行化
 *
 * 核心断言：并发写不再丢更新（这是 read-modify-write 的典型失败模式）。
 *   A StatsService：100 次并发 +1 → 精确 100（初版会 < 100）
 *   B StatsService：损坏文件不抛错、按初始值降级、且不留临时文件
 *   C StatsService：并发 +1 与读取交错时文件始终可解析（原子写）
 *   D KnowledgeManager：50 次并发登记 → 索引恰好 50 条，且每条详情文件都存在
 *   E KnowledgeManager：多实例（模拟并行 FlexRunner 各自 new）共享同一把锁
 *   F KnowledgeManager：并发 add/remove 后索引与详情保持一致（无孤儿、无悬空）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// STATS_DIR 在模块加载时读取环境变量，必须在 import 之前设置
const statsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'm3-stats-'));
process.env.WEB_STATS_ROOT = statsRoot;

const { StatsService } = await import(pathToFileURL(`${ROOT}Server/library/StatsService.js`).href);
const { default: KnowledgeManager } = await import(pathToFileURL(`${ROOT}Server/Knowledge/KnowledgeManager.js`).href);
const { default: JsonAdapter } = await import(pathToFileURL(`${ROOT}Server/DbUse/adapters/JsonAdapter.js`).href);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const STATS_FILE = path.join(statsRoot, 'visit-stats.json');

// ─── A. 并发计数不丢更新 ─────────────────────────────────────────────────
{
    const N = 100;
    await Promise.all(Array.from({ length: N }, () => StatsService.incrementSessionCount()));
    const got = await StatsService.getSessionCount();
    check(`A ${N} 次并发 +1 后计数精确为 ${N}（无丢更新）`, got === N, `count=${got}`);

    // 顺带覆盖 visitCount 的并发
    await Promise.all(Array.from({ length: 30 }, () => StatsService.incrementVisitCount()));
    const visits = await StatsService.getVisitCount();
    check('A 30 次并发访问计数精确为 30', visits === 30, `visitCount=${visits}`);
}

// ─── B. 损坏文件降级 ─────────────────────────────────────────────────────
{
    await fs.writeFile(STATS_FILE, '{ 这不是合法 JSON', 'utf8');
    let threw = false;
    let count = null;
    try {
        count = await StatsService.getSessionCount();
    } catch {
        threw = true;
    }
    check('B 文件损坏时不抛错', threw === false);
    check('B 损坏时按初始值降级为 0', count === 0, `count=${count}`);

    const after = await StatsService.incrementSessionCount();
    check('B 损坏后可自愈继续计数', after === 1, `after=${after}`);

    const leftovers = (await fs.readdir(statsRoot)).filter((f) => f.endsWith('.tmp'));
    check('B 无残留临时文件', leftovers.length === 0, `leftovers=${JSON.stringify(leftovers)}`);
}

// ─── C. 并发写 + 并发读：既不损坏也不丢更新 ───────────────────────────────
// 这一项是发现 Windows rename EPERM 的用例：目标文件被读句柄占用时，
// 直接 rename 会失败并静默丢更新；必须靠 renameWithRetry 兜住。
{
    const before = await StatsService.getSessionCount();
    const N = 40;
    const writers = Array.from({ length: N }, () => StatsService.incrementSessionCount());
    const readers = Array.from({ length: 60 }, () => (async () => {
        for (let i = 0; i < 5; i++) {
            const raw = await fs.readFile(STATS_FILE, 'utf8').catch(() => '');
            if (raw.trim()) {
                try { JSON.parse(raw); } catch { return false; }
            }
            await new Promise((r) => setTimeout(r, 1));
        }
        return true;
    })());
    const readResults = await Promise.all(readers);
    const written = await Promise.all(writers);
    const after = await StatsService.getSessionCount();

    check('C 并发读写期间从未读到损坏 JSON（原子写生效）',
        readResults.every((x) => x === true), `bad=${readResults.filter((x) => x !== true).length}`);
    check(`C 并发读写交错下 ${N} 次 +1 全部生效（Windows rename 重试生效，无丢更新）`,
        after - before === N, `before=${before} after=${after} delta=${after - before}`);
    check('C 没有任何一次写入返回错误值（0 表示写失败被吞）',
        written.every((v) => typeof v === 'number' && v > 0), `bad=${written.filter((v) => !v).length}`);
}

// ─── D. 知识索引并发登记 ─────────────────────────────────────────────────
const knowRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'm3-know-'));
const makeKm = () => new KnowledgeManager({
    jsonAdapter: new JsonAdapter({ baseDir: knowRoot, subDir: 'Knowledge' }),
});
{
    const km = makeKm();
    await km.init();
    const N = 50;
    await Promise.all(Array.from({ length: N }, (_, i) =>
        km.addExperience({ docPath: `/tmp/doc-${i}.md`, taskId: `t${i}`, taskDescription: `任务 ${i}` })
    ));

    const index = await km._readIndex();
    check(`D ${N} 次并发登记后索引恰好 ${N} 条（无丢更新）`, index.length === N, `index=${index.length}`);

    const ids = new Set(index.map((e) => e.id));
    check('D 索引中 id 无重复', ids.size === index.length, `unique=${ids.size}`);

    let missing = 0;
    for (const e of index) {
        const full = await km.getExperience(e.id);
        if (!full) missing++;
    }
    check('D 每条索引项都有对应详情文件（无悬空索引）', missing === 0, `missing=${missing}`);
}

// ─── E. 多实例共享同一把锁 ───────────────────────────────────────────────
{
    // 模拟并行 FlexRunner：各自 new 一个 KnowledgeManager（进程内不同实例）
    const kms = Array.from({ length: 8 }, () => makeKm());
    await Promise.all(kms.map((k) => k.init()));

    const perInstance = 10;
    await Promise.all(kms.flatMap((km, ki) =>
        Array.from({ length: perInstance }, (_, i) =>
            km.addExperience({ docPath: `/tmp/multi-${ki}-${i}.md`, taskId: `m${ki}`, taskDescription: 'multi' })
        )
    ));

    const index = await kms[0]._readIndex();
    const expect = 50 + kms.length * perInstance;
    check(`E 多实例并发登记总计 ${expect} 条（共享锁生效，无丢更新）`,
        index.length === expect, `index=${index.length}`);
}

// ─── F. 并发 add/remove 后一致性 ─────────────────────────────────────────
{
    const km = makeKm();
    await km.init();
    const indexBefore = await km._readIndex();

    // 并发删除一半、同时新增一半
    const toRemove = indexBefore.slice(0, 25).map((e) => e.id);
    await Promise.all([
        ...toRemove.map((id) => km.removeExperience(id)),
        ...Array.from({ length: 25 }, (_, i) =>
            km.addExperience({ docPath: `/tmp/churn-${i}.md`, taskId: `c${i}`, taskDescription: 'churn' })
        ),
    ]);

    const indexAfter = await km._readIndex();
    const expect = indexBefore.length - toRemove.length + 25;
    check(`F 并发增删后索引条数正确（${expect}）`, indexAfter.length === expect, `index=${indexAfter.length}`);

    // 被删的必须消失、且详情文件也没了
    const removedStillListed = toRemove.filter((id) => indexAfter.some((e) => e.id === id));
    check('F 已删除项不出现在索引中（无悬空索引）', removedStillListed.length === 0,
        `stale=${removedStillListed.length}`);

    const goneFiles = toRemove.filter((id) => fsSync.existsSync(path.join(knowRoot, 'Knowledge', `${id}.json`)));
    check('F 已删除项的详情文件已物理删除', goneFiles.length === 0, `left=${goneFiles.length}`);

    check('F 重复删除返回 false（幂等）', (await km.removeExperience(toRemove[0])) === false);
}

try { fsSync.rmSync(statsRoot, { recursive: true, force: true }); } catch { /* ignore */ }
try { fsSync.rmSync(knowRoot, { recursive: true, force: true }); } catch { /* ignore */ }

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
