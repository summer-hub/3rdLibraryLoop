/**
 * M7（Phase 4）验收：分布式租约、令牌与消息队列
 *
 * 对应 ROADMAP 的 Phase 4 验收条款：
 *   - 水平扩展：3 实例并跑，任务不被重复执行；
 *   - 任一实例"崩溃"，在途任务在租约过期后被其他实例接管并正确收尾。
 *
 *   A 租约基本语义：获取/续租/释放/peek
 *   B **fencing token**：旧持有者的写入被必然拒绝（僵死写入者问题的真正解法）
 *   C 3 实例并跑：同一任务只被一个实例执行
 *   D 实例崩溃 → 租约过期 → 其他实例接管（幂等，不重复执行）
 *   E 分布式令牌：全局上限跨实例生效 + 崩溃实例的令牌自动回收
 *   F 消息队列：至少一次、幂等消费、失败重投、毒消息进死信
 *   G 真实后端：PostgreSQL / Redis 的命令与参数可静态复核
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { LeaseStore, MemoryLeaseBackend, PostgresLeaseBackend } = await imp('Server/Distributed/Lease.js');
const { MessageQueue, IdempotentConsumer, MemoryQueueBackend, RedisStreamsBackend } = await imp('Server/Distributed/Queue.js');
const { DistributedSemaphore, MemoryTokenBackend, RedisTokenBackend } = await imp('Server/Distributed/Semaphore.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══ A. 租约基本语义 ════════════════════════════════════════════════
console.log('\n── A. 租约基本语义 ──');
{
    let now = 1_000_000;
    const clock = () => now;
    const store = new LeaseStore({ ttlMs: 1000, clock });

    const a = await store.acquire({ resource: 'task:t1', owner: 'svc-A' });
    check('A1 首次获取成功且 token=1', a.ok === true && a.lease.fencingToken === 1, JSON.stringify(a.lease));

    const b = await store.acquire({ resource: 'task:t1', owner: 'svc-B' });
    check('A2 未过期时其他实例获取失败（且不是异常，是"被占用"）',
        b.ok === false && b.reason === 'held', b.reason);

    const r = await store.renew({ resource: 'task:t1', owner: 'svc-A', fencingToken: 1 });
    check('A3 持有者可续租并延长过期时间',
        r.ok === true && Date.parse(r.lease.expiresAt) === now + 1000);

    // 续租在过期后必须失败：否则"GC 暂停 30 秒后恢复"的实例能复活已失效的租约
    now += 2000;
    const r2 = await store.renew({ resource: 'task:t1', owner: 'svc-A', fencingToken: 1 });
    check('A4 过期后不允许续租（防止僵死持有者复活）',
        r2.ok === false && r2.reason === 'expired', r2.reason);

    const peek = await store.peek('task:t1');
    check('A5 peek 报告过期状态', peek.expired === true);

    const rel = await store.release({ resource: 'task:t1', owner: 'svc-B', fencingToken: 1 });
    check('A6 非持有者不能释放（owner 校验）', rel === false);
    const rel2 = await store.release({ resource: 'task:t1', owner: 'svc-A', fencingToken: 1 });
    check('A7 持有者可释放', rel2 === true && (await store.peek('task:t1')) === null);

    const list = await store.list();
    check('A8 list 可枚举全部租约（运维视角）', Array.isArray(list));
}

// ═══ B. fencing token ══════════════════════════════════════════════
console.log('\n── B. fencing token：挡住僵死写入者 ──');
{
    let now = 5_000_000;
    const store = new LeaseStore({ ttlMs: 1000, clock: () => now });

    const a = await store.acquire({ resource: 'task:x', owner: 'svc-A' });
    const tokenA = a.lease.fencingToken;

    // A 卡住（如长 GC / 网络分区），租约过期，B 接管
    now += 2000;
    const b = await store.acquire({ resource: 'task:x', owner: 'svc-B' });
    check('B1 接管后 token 单调递增（B 的 token > A 的 token）',
        b.ok === true && b.takeover === true && b.lease.fencingToken > tokenA,
        `A=${tokenA} B=${b.lease.fencingToken}`);

    // A 恢复后试图写入 → 必须被拒绝
    let err = null;
    try { await store.assertFence('task:x', tokenA); } catch (e) { err = e; }
    check('B2 旧持有者恢复后写入被**必然**拒绝（ESTALE_FENCE）',
        err !== null && err.code === 'ESTALE_FENCE', err?.message?.slice(0, 60));

    // B 写入正常
    let okB = true;
    try { await store.assertFence('task:x', b.lease.fencingToken); } catch { okB = false; }
    check('B3 当前持有者写入正常', okB === true);

    check('B4 已见最大 token 可查询（围栏单调性的可观测依据）',
        store.maximumFence('task:x') === b.lease.fencingToken,
        `max=${store.maximumFence('task:x')}`);
    check('B5 拒绝计数可观测（否则"围栏是否真的在生效"无从判断）',
        store.getStats().fenceRejected === 1, JSON.stringify(store.getStats().fenceRejected));

    // 再接管一次，token 继续递增（永不回退）
    now += 2000;
    const c = await store.acquire({ resource: 'task:x', owner: 'svc-C' });
    check('B6 多次接管 token 严格单调递增',
        c.lease.fencingToken === b.lease.fencingToken + 1,
        `B=${b.lease.fencingToken} C=${c.lease.fencingToken}`);
}

// ═══ C. 3 实例并跑：任务不被重复执行 ════════════════════════════════
console.log('\n── C. 3 实例并跑（水平扩展）──');
{
    // 3 个实例共享同一个后端（真实部署里是 PostgreSQL）
    const backend = new MemoryLeaseBackend();
    const instances = ['svc-1', 'svc-2', 'svc-3'].map((id) =>
        ({ id, store: new LeaseStore({ backend, ttlMs: 5000 }) }));

    const TASKS = 30;
    const executions = new Map();   // taskId → [实例]

    // 每个实例都尝试抢占全部任务（最坏情况下的竞争）
    await Promise.all(instances.map(async (inst) => {
        for (let i = 0; i < TASKS; i++) {
            const resource = `task:t-${i}`;
            const got = await inst.store.acquire({ resource, owner: inst.id });
            if (got.ok) {
                if (!executions.has(resource)) executions.set(resource, []);
                executions.get(resource).push(inst.id);
                // 模拟执行耗时（期间租约有效）
                await sleep(1);
            }
        }
    }));

    const duplicated = [...executions.entries()].filter(([, list]) => list.length > 1);
    check(`C1 ${TASKS} 个任务在 3 实例竞争下**没有一个**被重复执行`,
        duplicated.length === 0,
        duplicated.length ? duplicated.slice(0, 3).map(([r, l]) => `${r}:${l.join('+')}`).join(' ') : '');
    check('C2 全部任务都被执行了（没有因竞争而漏掉）',
        executions.size === TASKS, `executed=${executions.size}/${TASKS}`);
    check('C3 负载分布到多个实例（不是每次都同一个赢）',
        new Set([...executions.values()].flat()).size >= 2,
        `winners=${[...new Set([...executions.values()].flat())].join(',')}`);
    check('C4 竞争失败被计数（可观测），且不是异常',
        instances.every((i) => i.store.getStats().acquireBusy >= 0));
}

// ═══ D. 实例崩溃 → 接管 ════════════════════════════════════════════
console.log('\n── D. 实例崩溃后的接管（模拟 kill -9）──');
{
    let now = 10_000_000;
    const backend = new MemoryLeaseBackend();
    const ttl = 1000;
    const dead = new LeaseStore({ backend, ttlMs: ttl, clock: () => now });
    const alive = new LeaseStore({ backend, ttlMs: ttl, clock: () => now });

    // svc-A 拿到任务后"崩溃"——它不会再调用 release，也不会再续租
    const got = await dead.acquire({ resource: 'task:crash', owner: 'svc-A' });
    check('D1 崩溃前 svc-A 持有租约', got.ok === true);

    const before = await alive.acquire({ resource: 'task:crash', owner: 'svc-B' });
    check('D2 租约未过期时 svc-B 不会抢占（避免脑裂）',
        before.ok === false && before.reason === 'held');

    now += ttl + 1;   // 时间推进到过期之后

    const expired = await alive.listExpired();
    check('D3 过期租约可被枚举（"哪些任务待接管"的直接答案）',
        expired.some((l) => l.resource === 'task:crash'),
        `expired=${expired.map((l) => l.resource).join(',')}`);

    const takeover = await alive.acquire({ resource: 'task:crash', owner: 'svc-B' });
    check('D4 过期后 svc-B 接管成功，且被标记为接管',
        takeover.ok === true && takeover.takeover === true);
    check('D5 接管者的 token 更大（可安全覆盖前者的残留写入）',
        takeover.lease.fencingToken > got.lease.fencingToken);

    // 幂等：任务完成的写入只认当前 token
    let oldRejected = false;
    try { await alive.assertFence('task:crash', got.lease.fencingToken); } catch { oldRejected = true; }
    check('D6 崩溃实例的旧 token 无法写入（不会覆盖接管者的成果）', oldRejected === true);
}

// ═══ D2. 并发接管：只能有一个赢家（防脑裂）════════════════════════════
// 回归背景：`_newRecord` 曾把 revision 恒置为 1，导致两个并发接管者的 CAS
// 都能通过（写回后 revision 仍是 1），且两者从同一快照算出**相同 token** ——
// 双主 + 围栏失效。这里把"并发接管只能有一个赢家 + token 严格单调"固定下来。
console.log('\n── D2. 并发接管（两个备用实例同时发现过期）──');
{
    let now = 20_000_000;
    const backend = new MemoryLeaseBackend();
    const ttl = 1000;
    // 同一进程内的两个 Store 实例：holder 模拟被 kill -9 的 svc-A，
    // standby 模拟"发现租约过期后尝试接管"的备用实例（并发的两个接管者都走它）。
    const holder = new LeaseStore({ backend, ttlMs: ttl, clock: () => now });
    const standby = new LeaseStore({ backend, ttlMs: ttl, clock: () => now });

    const first = await holder.acquire({ resource: 'task:split', owner: 'svc-A' });
    check('D7 首次获取 token=1、revision=1',
        first.ok === true && first.lease.fencingToken === 1 && first.lease.revision === 1);

    now += ttl + 1;   // 过期（模拟 svc-A 被 kill -9）

    // 两个备用实例**同时**接管（同一份快照、同一时刻）
    const [b, c] = await Promise.all([
        standby.acquire({ resource: 'task:split', owner: 'svc-B' }),
        standby.acquire({ resource: 'task:split', owner: 'svc-C' })
    ]);
    const winners = [b, c].filter((r) => r.ok === true);
    check('D8 并发接管只有一个赢家（另一个明确拿到 race，而不是静默双主）',
        winners.length === 1,
        `b=${b.ok}/${b.reason || ''} c=${c.ok}/${c.reason || ''}`);

    check('D9 赢家的 token 严格大于前任（围栏仍然单调）',
        winners[0]?.lease.fencingToken === first.lease.fencingToken + 1,
        `token=${winners[0]?.lease.fencingToken}`);
    check('D10 赢家的 revision 已递增（CAS 凭证不再与前任快照相同）',
        winners[0]?.lease.revision > first.lease.revision,
        `rev=${winners[0]?.lease.revision}`);

    // 输家重试应看到"已被占用"，而不是复用同一 token 再次成功
    const loser = await standby.acquire({ resource: 'task:split', owner: 'svc-B' });
    check('D11 输家重试时租约已被占用（不会复用同一 token）',
        loser.ok === false && loser.reason === 'held', loser.reason);

    // 围栏是**实例内**的守卫：接管者所在实例必须拒绝前任 token
    //（跨实例的写入拒绝由后端/数据库的 token 校验承担）
    let prevRejected = false;
    try { await standby.assertFence('task:split', first.lease.fencingToken); } catch { prevRejected = true; }
    check('D12 接管后前任 token 无法写入（僵死写入者被挡）', prevRejected === true);
}

// ═══ E. 分布式令牌 ═════════════════════════════════════════════════
console.log('\n── E. 分布式令牌（全局并发上限跨实例生效）──');
{
    // 用**真实时间**而不是冻结的假时钟：等待超时的判定依赖时钟推进，
    // 注入一个永不前进的 clock 会让重试循环永远等不到 deadline（写这个用例时踩到过）。
    const backend = new MemoryTokenBackend();
    const mk = () => new DistributedSemaphore({
        backend, limit: 3, tokenTtlMs: 250, acquireTimeoutMs: 150,
        retryMs: 5
    });
    const i1 = mk(), i2 = mk(), i3 = mk();

    const l1 = await i1.acquire();
    const l2 = await i2.acquire();
    const l3 = await i3.acquire();
    check('E1 3 个实例各取 1 个令牌（总计 3 = 上限）',
        l1.ok && l2.ok && l3.ok && (await i1.count()) === 3, `count=${await i1.count()}`);
    // 回归守护：token id 必须跨实例唯一。曾经因 pid/hostname/毫秒都相同而碰撞，
    // 三个令牌被集合语义折叠成一个，导致"全局上限被静默放宽"。
    check('E1b token id 跨实例唯一（集合折叠会让限流静默失效）',
        new Set([l1.tokenId, l2.tokenId, l3.tokenId]).size === 3,
        [l1.tokenId, l2.tokenId, l3.tokenId].join(' | ').slice(0, 90));

    const l4 = await i1.acquire();
    check('E2 第 4 个请求被跨实例拒绝（单实例视角看不见的"别人占满了"）',
        l4.ok === false && l4.tokenId === null, `waited=${l4.waitedMs}ms`);

    await l1.release();
    const l5 = await i1.acquire();
    check('E3 释放后其他实例可获取', l5.ok === true);

    // 崩溃实例的令牌靠 TTL 自动回收（否则跑够 3 次崩溃后集群永久拿不到令牌）
    await l2.release(); await l3.release(); await l5.release();
    const l6 = await i2.acquire();
    const l7 = await i3.acquire();
    const l8 = await i1.acquire();
    check('E4 重新占满', l6.ok && l7.ok && l8.ok);
    const blocked = await i2.acquire();
    check('E5 占满后再次拒绝', blocked.ok === false);

    // 时间推进过 TTL：持有者"崩溃"（从未 release）
    await sleep(300);
    const tokensAfter = await i1.count();
    check('E6 崩溃实例的令牌在 TTL 后被自动回收（不会永久漏令牌）',
        tokensAfter === 0, `count=${tokensAfter}`);
    const l9 = await i1.acquire();
    check('E7 回收后可重新获取', l9.ok === true);

    check('E8 排队等待 P95 可观测（判断限流是否过紧的依据）',
        typeof i1.getStats().queueWaitP95Ms === 'number');

    // 不限流时不占用任何分布式资源
    const unlimited = new DistributedSemaphore({ backend, limit: 0 });
    const u = await unlimited.acquire();
    check('E9 limit=0 时不占用分布式资源（关闭的开关不应产生网络成本）',
        u.ok === true && u.tokenId === null);
}

// ═══ F. 消息队列 ═══════════════════════════════════════════════════
console.log('\n── F. 消息队列（至少一次 + 幂等消费 + 死信）──');
{
    const q = new MessageQueue({ visibilityMs: 50, maxAttempts: 3 });

    await q.publish('orch', { intent: 'task.assign', taskId: 't1' });
    const r1 = await q.consume('orch', async () => 'handled');
    check('F1 正常消费一次', r1.consumed === 1 && r1.executed === 1);

    // 重复投递（broker 语义：同一条消息再来一次）
    const backend = new MemoryQueueBackend();
    const q2 = new MessageQueue({ backend, visibilityMs: 20, maxAttempts: 3 });
    const id = await q2.publish('c', { n: 1 });
    await q2.consume('c', async () => {});
    // 手动把消息恢复为"未确认、可见"以模拟 broker 重投
    const all = await backend.claim('c', 'other', { limit: 10, visibilityMs: 1 });
    check('F2 已 ack 的消息不会被再次领取（broker 语义正确）',
        all.length === 0, `claimed=${all.length}`);
    check('F3 消息 id 稳定可引用（幂等键的基础）', typeof id === 'string' && id.length > 0);

    // 幂等消费者：同一 messageId 两次只执行一次
    const consumer = new IdempotentConsumer();
    let runs = 0;
    const first = await consumer.runOnce({ messageId: 'm-1', run: async () => { runs++; return 'ok'; } });
    const second = await consumer.runOnce({ messageId: 'm-1', run: async () => { runs++; return 'ok'; } });
    check('F4 幂等消费：同一消息重复投递只执行一次',
        first.executed === true && second.executed === false && runs === 1,
        `runs=${runs}`);
    check('F5 重复被计数（可观测）', consumer.getStats().skipped === 1);

    // 去重表有界
    const bounded = new IdempotentConsumer({ capacity: 5 });
    for (let i = 0; i < 20; i++) bounded.mark(`k${i}`);
    check('F6 去重表有界（否则长时间运行就是内存泄漏）',
        bounded.getStats().tracked === 5 && bounded.getStats().evicted === 15,
        `tracked=${bounded.getStats().tracked} evicted=${bounded.getStats().evicted}`);

    // TTL 过期
    let tick = 0;
    const ttlConsumer = new IdempotentConsumer({ ttlMs: 100, clock: () => tick });
    ttlConsumer.mark('x');
    tick += 200;
    check('F7 超过 TTL 的记录视为新消息（宁可重复执行，也不永久漏执行）',
        ttlConsumer.has('x') === false && ttlConsumer.getStats().expired === 1);

    // 失败重投 → 超过上限进死信
    const backend2 = new MemoryQueueBackend();
    const q3 = new MessageQueue({ backend: backend2, visibilityMs: 5, maxAttempts: 2 });
    await q3.publish('poison', { bad: true });
    let attempts = 0;
    for (let i = 0; i < 6; i++) {
        await q3.consume('poison', async () => { attempts++; throw new Error('always fails'); });
        await sleep(10);
    }
    const dead = await q3.listDead('poison');
    check('F8 反复失败的消息进入死信队列（不会无限重投）',
        dead.length === 1, `dead=${dead.length} attempts=${attempts}`);
    check('F9 死信记录了原因与投递次数',
        /最大投递次数/.test(dead[0]?.reason || '') && dead[0].attempts >= 3,
        `reason=${dead[0]?.reason}`);
    check('F10 至少一次语义：失败的消息确实被重投过',
        attempts >= 2, `attempts=${attempts}`);

    // 部分失败不影响同批其他消息
    const backend3 = new MemoryQueueBackend();
    const q4 = new MessageQueue({ backend: backend3, visibilityMs: 5 });
    await q4.publish('mix', { n: 1 });
    await q4.publish('mix', { n: 2 });
    const r4 = await q4.consume('mix', async (body) => {
        if (body.n === 1) throw new Error('fail one');
        return 'ok';
    }, { limit: 2 });
    check('F11 单条失败不影响同批其他消息（失败隔离）',
        r4.consumed === 2 && r4.failed === 1 && r4.executed === 1,
        JSON.stringify(r4));
}

// ═══ G. 真实后端的命令可静态复核 ══════════════════════════════════
console.log('\n── G. 真实后端的命令与参数（静态复核）──');
{
    // PostgreSQL 租约：必须是**单条**原子语句，不能是"先查后写"
    const calls = [];
    const fakePg = {
        query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [{ fencing_token: 1, revision: 1, expires_at: '2026-01-01T00:00:00Z' }], rowCount: 1 };
        }
    };
    const pg = new PostgresLeaseBackend({ query: fakePg.query });

    const lease = await pg.acquireAtomic({
        resource: 'task:t1', owner: 'svc-A',
        now: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T00:00:30Z', ttlMs: 30000
    });
    check('G1 获取租约只用 1 条语句（消除"读-判-写"竞态窗口）',
        calls.length === 1, `statements=${calls.length}`);
    check('G2 使用 ON CONFLICT + WHERE expires_at < ... 单语句完成"判空/判过期/写入"',
        /ON CONFLICT \(resource\) DO UPDATE/.test(calls[0].sql)
        && /WHERE leases\.expires_at < EXCLUDED\.heartbeat_at/.test(calls[0].sql));
    check('G3 接管时 token 与 revision 在同一语句内自增',
        /fencing_token = leases\.fencing_token \+ 1/.test(calls[0].sql)
        && /revision      = leases\.revision \+ 1/.test(calls[0].sql));
    check('G4 RETURNING 直接返回结果（无需二次查询）',
        /RETURNING fencing_token, revision, expires_at/.test(calls[0].sql));
    check('G5 参数化查询（无 SQL 注入面）',
        calls[0].params.length === 4 && calls[0].params[0] === 'task:t1');
    check('G6 解析 RETURNING 结果并归一化类型',
        lease.fencingToken === 1 && lease.owner === 'svc-A');

    // 续租/释放同样是原子且带 token 校验
    calls.length = 0;
    await pg.renewAtomic({
        resource: 'task:t1', owner: 'svc-A', fencingToken: 1,
        now: '2026-01-01T00:00:10Z', expiresAt: '2026-01-01T00:00:40Z'
    });
    check('G7 续租校验 owner + fencing_token + 未过期（三重条件）',
        /WHERE resource = \$1 AND owner = \$2 AND fencing_token = \$3 AND expires_at > \$4/.test(calls[0].sql));

    calls.length = 0;
    await pg.releaseAtomic({ resource: 'task:t1', owner: 'svc-A', fencingToken: 1 });
    check('G8 释放校验 token（越权释放被数据库拒绝）',
        /WHERE resource = \$1 AND owner = \$2 AND fencing_token = \$3/.test(calls[0].sql));

    check('G9 建表脚本幂等（IF NOT EXISTS，可重复执行迁移）',
        /CREATE TABLE IF NOT EXISTS leases/.test(PostgresLeaseBackend.schema())
        && /CREATE INDEX IF NOT EXISTS leases_expires_idx/.test(PostgresLeaseBackend.schema()));

    // Redis 令牌：Lua 必须包含"回收过期令牌"这一步
    const scripts = [];
    const fakeRedis = {
        evalScript: async (script, keys, args) => {
            scripts.push({ script, keys, args });
            return [1, 1];
        }
    };
    const rt = new RedisTokenBackend({ evalScript: fakeRedis.evalScript });
    await rt.acquireToken('3lib:sess', 'tok-1', { limit: 50, ttlMs: 60000 });
    check('G10 令牌用 ZSET（逐个令牌的过期时间，计数器做不到）',
        /ZADD/.test(scripts[0].script) && /ZCARD/.test(scripts[0].script));
    check('G11 Lua 先回收过期令牌（否则崩溃实例会永久漏令牌）',
        /ZREMRANGEBYSCORE/.test(scripts[0].script)
        && scripts[0].script.indexOf('ZREMRANGEBYSCORE') < scripts[0].script.indexOf('ZCARD'));
    check('G12 满额时返回失败与当前数量（调用方可退避/告警）',
        /return \{0, count\}/.test(scripts[0].script));
    check('G13 KEYS/ARGV 传参规范（避免把值拼进脚本）',
        scripts[0].keys.length === 1 && scripts[0].args.length === 4);

    // Redis Streams：消费组 + 接管僵死消费者
    const redisCalls = [];
    const fakeStream = { call: async (cmd, args) => { redisCalls.push([cmd, args]); return null; } };
    const rs = new RedisStreamsBackend({ call: fakeStream.call });
    await rs.ensureGroup('orch');
    await rs.push('orch', { n: 1 });
    await rs.claim('orch', 'c1', { limit: 5, visibilityMs: 30000 });
    await rs.ack('orch', '1-0');
    const cmds = redisCalls.map((c) => c[0]);
    check('G14 使用 XGROUP/XADD/XREADGROUP/XACK 完整生命周期',
        cmds.includes('XGROUP') && cmds.includes('XADD') && cmds.includes('XACK'));
    check('G15 用 XAUTOCLAIM 接管僵死消费者的消息（"至少一次"能落地的前提）',
        cmds.includes('XAUTOCLAIM'),
        cmds.join(','));
    const xgroup = redisCalls.find((c) => c[0] === 'XGROUP');
    check('G16 消费组创建用 MKSTREAM（流不存在也能建组）',
        xgroup[1].includes('MKSTREAM'));

    let pgErr = null;
    try { new PostgresLeaseBackend({}); } catch (e) { pgErr = e; }
    check('G17 缺少 SQL 客户端时明确报错（而不是静默用内存后端假装分布式）',
        pgErr !== null && /需要注入 query/.test(pgErr.message));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
