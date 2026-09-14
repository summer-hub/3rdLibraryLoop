/**
 * M6（Phase 3）验收：会话等待器与延迟指标
 *
 *   A LatencyRecorder：环形有界、分位数正确、近期窗口语义
 *   B SessionWaiter：先查后睡（消除整间隔盲区）
 *   C SessionWaiter：事件驱动（延迟从 ~5000ms 降到事件延迟）
 *   D SessionWaiter：事件丢失时的兜底轮询 / 超时 / 中止
 *   E SessionWaiter：无监听器泄漏（所有返回路径都退订）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { LatencyRecorder } = await imp('Server/library/LatencyRecorder.js');
const { SessionWaiter, DEFAULT_SAFETY_POLL_MS } = await imp('Server/library/SessionWaiter.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══ A. LatencyRecorder ═════════════════════════════════════════════
console.log('\n── A. LatencyRecorder（有界分位数采样）──');
{
    const rec = new LatencyRecorder({ capacity: 100, name: 't' });
    check('A1 空记录器返回 0（不抛错、不返回 NaN）',
        rec.percentile(0.95) === 0 && rec.stats().p50 === 0 && rec.empty === true);

    for (let i = 1; i <= 100; i++) rec.record(i);
    check('A2 P50/P95/P99 符合最邻近秩定义',
        rec.percentile(0.5) === 50 && rec.percentile(0.95) === 95 && rec.percentile(0.99) === 99,
        `p50=${rec.percentile(0.5)} p95=${rec.percentile(0.95)} p99=${rec.percentile(0.99)}`);

    // 环形：写入 200 个，窗口只保留最后 100 个（101..200）
    for (let i = 101; i <= 200; i++) rec.record(i);
    const st = rec.stats();
    check('A3 窗口有界（capacity=100，写入 200 个后窗口仍为 100）',
        st.windowSize === 100 && st.capacity === 100, `window=${st.windowSize}`);
    check('A4 分位数反映**近期**窗口（P50 从 50 变为 150）',
        rec.percentile(0.5) === 150, `p50=${rec.percentile(0.5)}`);
    check('A5 累计计数与极值不受窗口限制（总量可核对）',
        st.count === 200 && st.min === 1 && st.max === 200,
        `count=${st.count} min=${st.min} max=${st.max}`);

    // 关键动机断言：平均值会掩盖长尾。
    // 注意 nearest-rank 的定义边界：100 个样本时 P95 取第 95 小的值，
    // 因此"恰好 95 个小值"会让 P95 仍等于小值（P99 才暴露长尾）。
    // 这里用 94 个小值 + 6 个大值（>5% 长尾），P95 才会落在长尾区间——
    // 写这个用例时我一开始用 95/5，得到一个"看起来像 bug 的正确答案"。
    const longtail = new LatencyRecorder({ capacity: 100 });
    for (let i = 0; i < 94; i++) longtail.record(100);
    for (let i = 0; i < 6; i++) longtail.record(60000);
    const lt = longtail.stats();
    check('A6 平均值掩盖长尾、P95 暴露长尾（这正是要有分位数的原因）',
        lt.avg < 4000 && lt.p95 >= 60000, `avg=${lt.avg}ms p95=${lt.p95}ms p99=${lt.p99}ms`);

    const ignored = new LatencyRecorder({ capacity: 10 });
    ignored.record(NaN);
    ignored.record(-1);
    ignored.record(Infinity);
    check('A7 非法样本（NaN/负数/Infinity）被丢弃而非污染统计',
        ignored.stats().count === 0);
}

// ═══ B. 先查后睡 ════════════════════════════════════════════════════
console.log('\n── B. SessionWaiter：先查后睡（消除整间隔盲区）──');
{
    const calls = { n: 0 };
    const waiter = new SessionWaiter({
        poll: async () => { calls.n++; return { status: 'completed' }; },
        pollIntervalMs: 5000      // 故意设成 5s（Phase 1 的默认值）
    });

    const t0 = Date.now();
    const r = await waiter.wait('sess-done');
    const cost = Date.now() - t0;

    check('B1 已完成会话几乎立刻返回（不再等满一个轮询间隔）',
        r.completed === true && cost < 500, `耗时=${cost}ms（旧实现 ≥5000ms）`);
    check('B2 只查一次（无多余状态查询——这正是 N/interval 空转的来源）',
        calls.n === 1, `polls=${calls.n}`);
    check('B3 结果是"已完成的轮询"而非事件',
        r.mode === 'poll' && r.reason === 'already-completed');

    // 未完成的会话应持续轮询直到完成
    let status = 'unknown';
    const w2 = new SessionWaiter({
        poll: async () => ({ status }),
        pollIntervalMs: 30
    });
    setTimeout(() => { status = 'completed'; }, 90);
    const t2 = Date.now();
    const r2 = await w2.wait('sess-late');
    const cost2 = Date.now() - t2;
    check('B4 未完成的会话持续轮询直到完成',
        r2.completed === true && r2.polls >= 2 && cost2 >= 80,
        `polls=${r2.polls} 耗时=${cost2}ms`);
}

// ═══ C. 事件驱动 ════════════════════════════════════════════════════
console.log('\n── C. SessionWaiter：事件驱动替代轮询 ──');
{
    let emit = null;
    let unsubscribed = 0;
    const waiter = new SessionWaiter({
        poll: async () => ({ status: 'unknown' }),
        subscribe: (sessionId, onEvent) => {
            emit = onEvent;
            return () => { unsubscribed++; };
        },
        pollIntervalMs: 5000,
        safetyPollMs: DEFAULT_SAFETY_POLL_MS
    });

    const t0 = Date.now();
    const p = waiter.wait('sess-evt');
    await sleep(20);
    emit({ type: 'session.idle' });          // 模拟事件流推送完成
    const r = await p;
    const cost = Date.now() - t0;

    check('C1 事件到达即返回（延迟远小于轮询间隔）',
        r.completed === true && r.mode === 'event' && cost < 1000,
        `mode=${r.mode} 耗时=${cost}ms（轮询模式下至少 30000ms）`);
    check('C2 统计里事件胜出被记录（可验证事件驱动真的生效）',
        waiter.getStats().eventWins === 1 && waiter.getStats().eventModeEnabled === true);
    check('C3 事件模式下不再按 5s 间隔轮询（使用更长的兜底间隔）',
        r.polls <= 1, `polls=${r.polls}`);
    check('C4 返回后已退订事件源（无监听器泄漏）', unsubscribed === 1);

    // 事件判定兼容多种形状（不同 SDK 版本字段名不同）
    const probe = new SessionWaiter({ poll: async () => ({ status: 'unknown' }) });
    check('C5 完成事件判定兼容多种字段形状',
        SessionWaiter.defaultIsCompletionEvent({ type: 'session.idle' })
        && SessionWaiter.defaultIsCompletionEvent({ status: 'completed' })
        && SessionWaiter.defaultIsCompletionEvent({ event: 'done' })
        && !SessionWaiter.defaultIsCompletionEvent({ type: 'message.part' })
        && !SessionWaiter.defaultIsCompletionEvent(null));
}

// ═══ D. 兜底轮询 / 超时 / 中止 ═════════════════════════════════════
console.log('\n── D. SessionWaiter：丢事件兜底 / 超时 / 中止 ──');
{
    // 事件永远不来 → 兜底轮询必须把会话判定为完成
    let polls = 0;
    const w = new SessionWaiter({
        poll: async () => { polls++; return { status: polls >= 2 ? 'completed' : 'unknown' }; },
        subscribe: () => () => {},
        pollIntervalMs: 5000,
        safetyPollMs: 40          // 兜底轮询间隔（生产默认 30s，测试压到 40ms）
    });
    const t0 = Date.now();
    const r = await w.wait('sess-lost-event');
    check('D1 事件丢失时兜底轮询仍能完成（不把可靠性押在外部事件流上）',
        r.completed === true && r.mode === 'poll' && Date.now() - t0 < 2000,
        `mode=${r.mode} polls=${r.polls} 耗时=${Date.now() - t0}ms`);

    // 超时
    const w2 = new SessionWaiter({ poll: async () => ({ status: 'unknown' }), pollIntervalMs: 20 });
    const r2 = await w2.wait('sess-timeout', { timeoutMs: 80 });
    check('D2 超时返回 completed=false 且原因为 timeout（不假装成功）',
        r2.completed === false && r2.reason === 'timeout', `reason=${r2.reason}`);

    // 中止：必须**立刻**返回，不等下一次轮询
    let aborted = false;
    const w3 = new SessionWaiter({ poll: async () => ({ status: 'unknown' }), pollIntervalMs: 5000 });
    const t3 = Date.now();
    const p3 = w3.wait('sess-abort', { isAborted: () => aborted });
    setTimeout(() => { aborted = true; }, 30);
    const r3 = await p3;
    check('D3 中止后立刻返回（不受轮询间隔约束）',
        r3.completed === false && r3.reason === 'aborted' && Date.now() - t3 < 1000,
        `reason=${r3.reason} 耗时=${Date.now() - t3}ms`);

    // 状态查询自身抛错 → 继续等待，而不是把步骤判失败
    let n = 0;
    const w4 = new SessionWaiter({
        poll: async () => { n++; if (n === 1) throw new Error('boom'); return { status: 'completed' }; },
        pollIntervalMs: 20
    });
    const r4 = await w4.wait('sess-err');
    check('D4 状态查询异常不判失败（继续等待，与 Phase 1 的静默降级一致）',
        r4.completed === true, `polls=${r4.polls}`);

    // 订阅本身抛错 → 退化为轮询并最终完成
    const w5 = new SessionWaiter({
        poll: async () => ({ status: 'completed' }),
        subscribe: () => { throw new Error('subscribe failed'); },
        pollIntervalMs: 5000
    });
    const r5 = await w5.wait('sess-subfail');
    check('D5 事件订阅失败自动退化为轮询（不误报完成、也不挂死）',
        r5.completed === true && r5.mode === 'poll');
}

// ═══ E. 无监听器/定时器泄漏 ════════════════════════════════════════
console.log('\n── E. 无泄漏（所有返回路径都清理）──');
{
    // 反复等待同一"事件源"，若退订缺失则订阅计数会持续增长
    let liveSubscriptions = 0;
    const waiter = new SessionWaiter({
        poll: async () => ({ status: 'unknown' }),
        subscribe: () => { liveSubscriptions++; return () => { liveSubscriptions--; }; },
        pollIntervalMs: 10,
        safetyPollMs: 10
    });

    for (let i = 0; i < 25; i++) {
        await waiter.wait(`s-${i}`, { timeoutMs: 25 });
    }
    check('E1 25 次等待后活跃订阅归零（退订在所有路径上执行）',
        liveSubscriptions === 0, `live=${liveSubscriptions}`);
    check('E2 超时次数被正确统计（25 次等待，每次都超时）',
        waiter.getStats().timeouts === 25, `timeouts=${waiter.getStats().timeouts}`);

    // 中止路径同样要退订
    let live2 = 0;
    let abortNow = false;
    const w2 = new SessionWaiter({
        poll: async () => ({ status: 'unknown' }),
        subscribe: () => { live2++; return () => { live2--; }; },
        pollIntervalMs: 5000
    });
    const p = w2.wait('s-abort2', { isAborted: () => abortNow });
    setTimeout(() => { abortNow = true; }, 20);
    await p;
    check('E3 中止路径同样退订', live2 === 0, `live=${live2}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
