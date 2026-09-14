/**
 * M3 验收：F-21 LLM 熔断器 / 准入限流 / JSON 容错
 *
 * 核心断言：供应商过载时，并发调用产生的**总请求数随并发数收敛**（O(1) 级），
 * 而不是"每个调用各自重试 10 次"（O(N) 级）——后者会把过载放大成重试风暴。
 *
 *   A CircuitBreaker：阈值熔断 → 快速失败 → 冷却后 half-open → 成功恢复 closed
 *   B CircuitBreaker：half-open 探测失败立即重新熔断
 *   C 非瞬态错误（400）不计入熔断失败
 *   D LlmRateLimiter：并发上限严格生效、排队者最终都能拿到许可
 *   E 并发 20 路撞上持续 529 → 总 API 调用数收敛（远小于 20×10）
 *   F chatJSON：启用 response_format: json_object
 *   G chatJSON：供应商不支持 response_format → 自动降级并重试成功
 *   H chatJSON：解析失败会重试，最终成功（不再"一次坏 JSON 吃掉一轮"）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { LLMClient, CircuitBreaker, LlmRateLimiter, isTransientError, retryDelay } =
    await import(pathToFileURL(`${ROOT}Server/Agent/SkillSelector/llm/llmClient.js`).href);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 构造可编程的 mock openai client */
function makeMock(handler) {
    const seen = [];
    const mock = {
        seen,
        get calls() { return seen.length; },
        chat: { completions: { create: async (params) => { seen.push(params); return handler(params, seen.length); } } },
    };
    return mock;
}

function err529() {
    const e = new Error('overloaded');
    e.status = 529;
    return e;
}
function err400(msg = 'bad request') {
    const e = new Error(msg);
    e.status = 400;
    return e;
}

// ─── A/B/C. CircuitBreaker 状态机 ────────────────────────────────────────
{
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 150, halfOpenMax: 1 });

    check('A 初始为 closed', cb.state === 'closed' && cb.canAttempt().ok === true);

    cb.recordFailure(); cb.recordFailure();
    check('A 未达阈值仍放行', cb.state === 'closed' && cb.canAttempt().ok === true, `state=${cb.state}`);

    cb.recordFailure();
    check('A 达阈值即熔断为 open', cb.state === 'open', `state=${cb.state}`);
    const gate = cb.canAttempt();
    check('A open 态快速失败并给出 retryAfterMs', gate.ok === false && gate.retryAfterMs > 0,
        JSON.stringify(gate));

    await sleep(180);
    check('A 冷却到期自动转 half-open', cb.canAttempt().ok === true && cb.state === 'half-open',
        `state=${cb.state}`);
    check('A half-open 只放行 halfOpenMax 个探测', cb.canAttempt().ok === false, '第二个探测应被拒');

    cb.recordSuccess();
    check('A 探测成功恢复 closed', cb.state === 'closed', `state=${cb.state}`);

    // B. half-open 探测失败 → 立即重新熔断
    const cb2 = new CircuitBreaker({ failureThreshold: 1, openMs: 100, halfOpenMax: 1 });
    cb2.recordFailure();
    await sleep(130);
    cb2.canAttempt();                    // 进入 half-open 并占用探测名额
    check('B half-open 态就绪', cb2.state === 'half-open', `state=${cb2.state}`);
    cb2.recordFailure();
    check('B half-open 探测失败立即重新熔断', cb2.state === 'open', `state=${cb2.state}`);

    // C. 非瞬态不计入熔断（由 LLMClient 的调用逻辑保证，这里验证判定函数）
    check('C 400 被识别为非瞬态', isTransientError(err400()) === null);
    check('C 529 被识别为瞬态且 is529', isTransientError(err529())?.is529 === true);
    check('C retryDelay 仍遵循指数退避', retryDelay(0) >= 500 && retryDelay(0) < 625);
}

// ─── D. LlmRateLimiter 并发上限 ──────────────────────────────────────────
{
    const limiter = new LlmRateLimiter({ maxConcurrency: 4, maxQps: 0 });
    let peak = 0;
    const workers = Array.from({ length: 20 }, () => (async () => {
        const release = await limiter.acquire();
        peak = Math.max(peak, limiter.active);
        await sleep(15);
        release();
    })());
    await Promise.all(workers);
    check('D 20 路并发下活跃数从未超过 maxConcurrency=4', peak <= 4, `peak=${peak}`);
    check('D 全部完成后 active 归零', limiter.active === 0, `active=${limiter.active}`);
    check('D 统计峰值正确', limiter.peakActive <= 4, `peakActive=${limiter.peakActive}`);

    // 释放幂等
    const rel = await limiter.acquire();
    rel(); rel(); rel();
    check('D 重复释放不导致计数为负', limiter.active === 0, `active=${limiter.active}`);
}

// ─── E. 关键断言：并发撞 529 时重试风暴被收敛 ────────────────────────────
{
    const breaker = new CircuitBreaker({ failureThreshold: 5, openMs: 300, halfOpenMax: 1 });
    const limiter = new LlmRateLimiter({ maxConcurrency: 8, maxQps: 0 });
    const mock = makeMock(() => { throw err529(); });
    const client = new LLMClient({ apiKey: 'x', client: mock, breaker, rateLimiter: limiter, fallbackModel: '' });

    const N = 20;
    const settled = await Promise.allSettled(
        Array.from({ length: N }, () => client.chat('hi'))
    );
    const allRejected = settled.every((s) => s.status === 'rejected');
    check(`E ${N} 路并发全部失败（供应商持续过载）`, allRejected);

    const calls = mock.calls;
    // 若不收敛：每个调用各自重试到 MAX_RETRIES(10) → 最多 200 次
    check('E 总请求数收敛到熔断阈值量级（远小于 N×10）', calls <= 20,
        `apiCalls=${calls}（不收敛时可达 ${N * 10}）`);
    check('E 熔断器确实开过路', breaker.totalOpened >= 1, `opened=${breaker.totalOpened}`);
    check('E 大量调用被快速失败短路', breaker.totalShortCircuited >= N - 10,
        `shortCircuited=${breaker.totalShortCircuited}`);

    const fastFail = settled.filter((s) => s.status === 'rejected'
        && /熔断/.test(s.reason?.message || '')).length;
    check('E 失败原因明确标注熔断（便于排障）', fastFail >= N - 10, `marked=${fastFail}`);
}

// ─── F. chatJSON 启用 response_format ────────────────────────────────────
{
    const breaker = new CircuitBreaker();
    const mock = makeMock(() => ({ choices: [{ message: { content: '{"ok":true}' } }] }));
    const client = new LLMClient({ apiKey: 'x', client: mock, breaker });

    const out = await client.chatJSON('给我 JSON');
    check('F chatJSON 正常解析', out?.ok === true, JSON.stringify(out));
    check('F 请求携带 response_format: json_object',
        mock.seen[0]?.response_format?.type === 'json_object',
        JSON.stringify(mock.seen[0]?.response_format));
}

// ─── G. 供应商不支持 response_format → 自动降级 ──────────────────────────
{
    const breaker = new CircuitBreaker();
    let firstWithFormat = true;
    const mock = makeMock((params) => {
        if (params.response_format) {
            firstWithFormat = false;
            throw err400('response_format is not supported by this model');
        }
        return { choices: [{ message: { content: '{"degraded":true}' } }] };
    });
    const client = new LLMClient({ apiKey: 'x', client: mock, breaker });

    const out = await client.chatJSON('给我 JSON');
    check('G 降级后仍成功取得结果', out?.degraded === true, JSON.stringify(out));
    check('G 首次带 response_format 被拒后去掉再试', firstWithFormat === false && mock.calls === 2,
        `calls=${mock.calls}`);

    // 第二次调用应不再携带 response_format（记住降级，不白撞）
    const before = mock.calls;
    await client.chatJSON('再来一次');
    const lastReq = mock.seen[mock.seen.length - 1];
    check('G 后续调用不再携带 response_format（已记住降级）',
        lastReq?.response_format === undefined && mock.calls === before + 1,
        `calls=${mock.calls}`);
}

// ─── H. JSON 解析失败会重试 ─────────────────────────────────────────────
{
    const breaker = new CircuitBreaker();
    let attempt = 0;
    const mock = makeMock(() => {
        attempt++;
        // 前两次返回非 JSON，第三次返回合法 JSON
        const content = attempt < 3 ? '抱歉，我无法提供 JSON 格式的回答。' : '{"recovered":true}';
        return { choices: [{ message: { content } }] };
    });
    const client = new LLMClient({ apiKey: 'x', client: mock, breaker, jsonParseRetries: 2 });

    const out = await client.chatJSON('给我 JSON');
    check('H 解析失败重试后成功', out?.recovered === true, JSON.stringify(out));
    check('H 重试次数符合预期', mock.calls === 3, `calls=${mock.calls}`);

    // 始终返回非 JSON → 在有界次数后明确失败（不无限重试）
    const breaker2 = new CircuitBreaker();
    const mock2 = makeMock(() => ({ choices: [{ message: { content: '不是 JSON' } }] }));
    const client2 = new LLMClient({ apiKey: 'x', client: mock2, breaker: breaker2, jsonParseRetries: 1 });
    let threw = null;
    try { await client2.chatJSON('x'); } catch (e) { threw = e; }
    check('H 始终不可解析时在有界次数后抛错', !!threw && mock2.calls === 2,
        `calls=${mock2.calls} err=${threw?.message?.slice(0, 40)}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
