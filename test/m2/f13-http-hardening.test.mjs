/**
 * M2 验收：F-13 HTTP 层加固
 *
 * A/B/C 用最小 Router + 本地 http.Server 做**真实 HTTP 往返**（不用 mock req/res），
 * 保证"超限 413 / JSON 非法 400 / 正常小 JSON 到达 handler"是端到端成立的：
 *   A 超过上限的 POST body → 413（且请求被排空、连接不挂起）
 *   B 非法 JSON → 400（不再被上层兜底 catch 变成 500）
 *   C 合法小 JSON → 200 且 body 原样到达 handler
 *   D 上限可通过 Router 选项 / MAX_JSON_BODY_BYTES 配置，默认 2MB
 * E 真实 Server（Server/Routes/server.js）：
 *   - 用后端真实路由 POST /api/orchestrator/load 验证 413 / 400 / 正常路径
 *   - 断言 maxConnections / headersTimeout / requestTimeout / keepAliveTimeout 已显式配置
 *   - requestTimeout 必须为 0（关闭）：SSE 长连接的合法时长无上界，任何非 0 值都会切断流
 *   - 2MB 上限对真实接口同样生效
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import http from 'node:http';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { Router } = await import(pathToFileURL(`${ROOT}Server/Routes/router/Router.js`).href);
const { createServer } = await import(pathToFileURL(`${ROOT}Server/Routes/server.js`).href);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024;

/** 起一个只含被测路由的本地 HTTP 服务，返回 { port, close } */
async function startRouterServer({ maxJsonBodyBytes, received } = {}) {
    const router = new Router(maxJsonBodyBytes != null ? { maxJsonBodyBytes } : undefined);
    router.post('/api/test/echo', async (req, res) => {
        if (received) received.push(req.body);
        res.json({ ok: true, body: req.body });
    });
    const server = http.createServer(async (req, res) => {
        try {
            const matched = await router.handle(req, res);
            if (!matched) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Not Found' }));
            }
        } catch (err) {
            // 与 server.js 相同的兜底：只应是"真正的服务端错误"
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: `内部错误: ${err.message}` }));
            }
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        port: server.address().port,
        router,
        close: () => new Promise((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        }),
    };
}

/** 发一个 JSON POST，返回 { status, body } */
async function postJson(port, path, rawBody, { contentLength } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (contentLength != null) headers['Content-Length'] = String(contentLength);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers,
        body: rawBody,
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
}

/**
 * 用原生 http.request 发 POST，可手工指定与 body 不匹配的 Content-Length。
 * fetch/undici 会校验并直接抛 RequestContentLengthMismatchError，覆盖不到
 * Router 的"按声明长度提前拒绝"分支，因此这里必须走裸 socket 语义。
 */
function postJsonRaw(port, path, rawBody, { contentLength } = {}) {
    return new Promise((resolve, reject) => {
        const bodyBuf = Buffer.from(rawBody, 'utf8');
        const req = http.request({
            host: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': contentLength != null ? contentLength : bodyBuf.length,
                // 声明超长时用分块发送会让服务端等待剩余字节；这里直接关掉
                'Connection': 'close',
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let body = null;
                try { body = JSON.parse(text); } catch { body = text; }
                resolve({ status: res.statusCode, body });
            });
        });
        req.on('error', reject);
        req.end(bodyBuf);
    });
}

// ─── A/B/C. 最小 Router 的真实 HTTP 往返 ───────────────────────────────────
{
    const received = [];
    const { port, router, close } = await startRouterServer({ maxJsonBodyBytes: 1024, received });

    check('D Router 暴露上限（供测试/调用方读取）', router.maxJsonBodyBytes === 1024,
        `maxJsonBodyBytes=${router.maxJsonBodyBytes}`);

    // A. 超限 → 413（用 Content-Length 声明 4KB，实际 body 也是 4KB）
    {
        const big = JSON.stringify({ pad: 'x'.repeat(4096) });
        const r = await postJson(port, '/api/test/echo', big);
        check('A 超过上限的 body → 413', r.status === 413, `status=${r.status} body=${JSON.stringify(r.body)}`);
        check('A 413 响应带 code=BODY_TOO_LARGE',
            r.body && r.body.code === 'BODY_TOO_LARGE', `code=${r.body?.code}`);
        check('A 超限请求未到达 handler', received.length === 0, `received=${received.length}`);
    }

    // A2. Content-Length 声明超限（提前拒绝分支，不读 body）
    {
        const small = JSON.stringify({ a: 1 });
        const r = await postJsonRaw(port, '/api/test/echo', small, { contentLength: 99999 });
        check('A Content-Length 声明超限时提前 413', r.status === 413,
            `status=${r.status} body=${JSON.stringify(r.body)}`);
    }

    // B. 非法 JSON → 400
    {
        const r = await postJson(port, '/api/test/echo', '{ this is not json ');
        check('B 非法 JSON → 400（不再是 500）', r.status === 400, `status=${r.status}`);
        check('B 400 响应带 code=INVALID_JSON',
            r.body && r.body.code === 'INVALID_JSON', `code=${r.body?.code}`);
        check('B 非法 JSON 未到达 handler', received.length === 0, `received=${received.length}`);
    }

    // C. 合法小 JSON → 200 且 body 到达 handler
    {
        const r = await postJson(port, '/api/test/echo', JSON.stringify({ hello: '世界' }));
        check('C 合法小 JSON → 200', r.status === 200, `status=${r.status}`);
        check('C body 原样到达 handler（含多字节字符）',
            received.length === 1 && received[0]?.hello === '世界',
            `received=${JSON.stringify(received)}`);
    }

    // C2. 空 body 不报错（解析为 null）
    {
        const r = await postJson(port, '/api/test/echo', '');
        check('C 空 body → 200（解析为 null）', r.status === 200 && r.body?.body === null,
            `status=${r.status} body=${JSON.stringify(r.body)}`);
    }

    // C3. 恰好等于上限的 body 允许通过（边界不算超限）
    {
        const exact = JSON.stringify({ pad: 'y'.repeat(1024 - JSON.stringify({ pad: '' }).length) });
        const r = await postJson(port, '/api/test/echo', exact);
        check('C 恰好等于上限的 body 允许通过（字节数边界）',
            exact.length === 1024 && r.status === 200,
            `len=${exact.length} status=${r.status}`);
    }

    // 连接未被销毁：后续请求仍能复用（413 后排空而非 destroy）
    {
        const r = await postJson(port, '/api/test/echo', JSON.stringify({ after: 'overflow' }));
        check('A 413 之后连接服务仍正常（未 destroy 掉后续请求）',
            r.status === 200 && r.body?.body?.after === 'overflow', `status=${r.status}`);
    }

    await close();
}

// ─── D. 上限可配置 ─────────────────────────────────────────────────────────
{
    const prev = process.env.MAX_JSON_BODY_BYTES;

    check('D 默认上限为 2MB', new Router().maxJsonBodyBytes === DEFAULT_BODY_LIMIT,
        `limit=${new Router().maxJsonBodyBytes}`);

    try {
        process.env.MAX_JSON_BODY_BYTES = '4096';
        check('D MAX_JSON_BODY_BYTES 生效', new Router().maxJsonBodyBytes === 4096,
            `limit=${new Router().maxJsonBodyBytes}`);

        process.env.MAX_JSON_BODY_BYTES = 'not-a-number';
        check('D 非法环境变量回退默认', new Router().maxJsonBodyBytes === DEFAULT_BODY_LIMIT,
            `limit=${new Router().maxJsonBodyBytes}`);

        process.env.MAX_JSON_BODY_BYTES = '0';
        check('D 非正数（0）回退默认（不允许"无上限"）',
            new Router().maxJsonBodyBytes === DEFAULT_BODY_LIMIT,
            `limit=${new Router().maxJsonBodyBytes}`);
    } finally {
        if (prev === undefined) delete process.env.MAX_JSON_BODY_BYTES;
        else process.env.MAX_JSON_BODY_BYTES = prev;
    }
}

// ─── E. 真实 Server：超时/连接数配置 + 真实路由上的 413/400/正常 ───────────
{
    const logs = [];
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...a) => logs.push(a.join(' '));
    console.warn = (...a) => logs.push(a.join(' '));

    let server = null;
    try {
        server = await createServer({ port: 0, cliType: 'deveco-code' });
    } finally {
        console.log = origLog;
        console.warn = origWarn;
    }

    const port = server.address().port;

    check('E maxConnections 已显式配置（默认 512）', server.maxConnections === 512,
        `maxConnections=${server.maxConnections}`);
    check('E headersTimeout 已显式配置（60000ms）', server.headersTimeout === 60000,
        `headersTimeout=${server.headersTimeout}`);
    check('E keepAliveTimeout 已显式配置（10000ms）', server.keepAliveTimeout === 10000,
        `keepAliveTimeout=${server.keepAliveTimeout}`);
    check('E requestTimeout=0（关闭；SSE 长连接不能被它切断）',
        server.requestTimeout === 0, `requestTimeout=${server.requestTimeout}`);
    check('E headersTimeout > keepAliveTimeout（避免 keep-alive 复用时被抢先断开）',
        server.headersTimeout > server.keepAliveTimeout,
        `${server.headersTimeout} > ${server.keepAliveTimeout}`);
    check('E server.httpLimits 暴露实际生效取值',
        server.httpLimits && server.httpLimits.maxConnections === 512
        && server.httpLimits.requestTimeout === 0,
        JSON.stringify(server.httpLimits));

    // E-a. 超过 2MB 上限 → 413（走真实路由 POST /api/orchestrator/load）
    {
        const big = JSON.stringify({ taskId: 'x', steps: [], pad: 'x'.repeat(DEFAULT_BODY_LIMIT + 1024) });
        const r = await postJson(port, '/api/orchestrator/load', big);
        check('E 真实路由：超过 2MB 上限的 body → 413', r.status === 413,
            `status=${r.status} body=${JSON.stringify(r.body)}`);
    }

    // E-b. 非法 JSON → 400
    {
        const r = await postJson(port, '/api/orchestrator/load', '{"taskId": broken');
        check('E 真实路由：非法 JSON → 400', r.status === 400, `status=${r.status}`);
        check('E 400 响应体为 JSON 错误结构',
            r.body && typeof r.body.error === 'string', `body=${JSON.stringify(r.body)}`);
    }

    // E-c. 合法 JSON → 到达 handler（缺 steps 时由 controller 返回 400，证明 body 已解析）
    {
        const r = await postJson(port, '/api/orchestrator/load', JSON.stringify({ taskId: 'f13-probe' }));
        check('E 真实路由：合法 JSON 到达 handler（controller 校验 steps）',
            r.status === 400 && /steps/.test(r.body?.error || ''), `status=${r.status} body=${JSON.stringify(r.body)}`);
    }

    // E-d. 正常 body → 路由命中（handler 正常返回 200）
    {
        const r = await postJson(port, '/api/orchestrator/load', JSON.stringify({
            taskId: 'f13-ok',
            taskDir: os.tmpdir(),
            steps: [{ stepId: 1, taskDescription: 'f13 probe', dependId: 0, nextStepId: 0, failStepId: 0, maxRetries: 1 }],
        }));
        check('E 真实路由：合法任务定义 → 200',
            r.status === 200 && r.body?.status === 'ok', `status=${r.status} body=${JSON.stringify(r.body)?.slice(0, 160)}`);
    }

    // 关闭真实服务（走优雅停机路径）
    try {
        if (typeof server.gracefulShutdown === 'function') {
            await server.gracefulShutdown({ timeoutMs: 5000 });
        }
    } catch (err) {
        check('E 优雅停机未抛异常', false, `error=${err.message}`);
    }
    check('E 服务器已关闭（gracefulShutdown 可调用）', server.listening === false,
        `listening=${server.listening}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
