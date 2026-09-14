/**
 * M1 验收：F-02 CORS 收紧（Server/Routes/router/Router.js）
 *
 * 断言：恶意来源不回显 ACAO、回环来源回显、恶意预检 403、无 Origin 的普通
 * OPTIONS 仍 204、3LIB_ALLOWED_ORIGINS 可显式放行。
 *
 * 该模块无外部依赖，可直接构造 Router + mock req/res 进行单测。
 */
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { Router } = await import(pathToFileURL(`${ROOT}Server/Routes/router/Router.js`).href);

function mockRes() {
    const state = { status: null, headers: {}, ended: false };
    return {
        state,
        setHeader(k, v) { state.headers[k.toLowerCase()] = v; },
        writeHead(status, headers) {
            state.status = status;
            if (headers) for (const [k, v] of Object.entries(headers)) state.headers[k.toLowerCase()] = v;
        },
        end() { state.ended = true; },
    };
}

const router = new Router();
router.get('/api/health/ping', async (req, res) => res.json({ ok: true }));

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

{
    const res = mockRes();
    await router.handle({ method: 'GET', url: '/api/health/ping', headers: { origin: 'https://evil.example' } }, res);
    check('恶意来源 GET：不返回 ACAO',
        res.state.headers['access-control-allow-origin'] === undefined,
        `ACAO=${res.state.headers['access-control-allow-origin']}`);
}

for (const origin of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080']) {
    const res = mockRes();
    await router.handle({ method: 'GET', url: '/api/health/ping', headers: { origin } }, res);
    check(`回环来源回显 ACAO: ${origin}`,
        res.state.headers['access-control-allow-origin'] === origin,
        `实际=${res.state.headers['access-control-allow-origin']}`);
}

{
    const res = mockRes();
    await router.handle({ method: 'GET', url: '/api/health/ping', headers: { origin: 'http://localhost:8080' } }, res);
    check('回环来源附带 Vary: Origin', res.state.headers['vary'] === 'Origin');
}

{
    const res = mockRes();
    await router.handle({ method: 'OPTIONS', url: '/api/health/ping', headers: { origin: 'https://evil.example' } }, res);
    check('恶意来源 OPTIONS → 403', res.state.status === 403, `status=${res.state.status}`);
}

{
    const res = mockRes();
    await router.handle({ method: 'OPTIONS', url: '/api/health/ping', headers: { origin: 'http://localhost:8080' } }, res);
    check('回环来源 OPTIONS → 204 + ACAO',
        res.state.status === 204 && res.state.headers['access-control-allow-origin'] === 'http://localhost:8080',
        `status=${res.state.status}`);
}

{
    const res = mockRes();
    await router.handle({ method: 'OPTIONS', url: '/api/health/ping', headers: {} }, res);
    check('无 Origin 的 OPTIONS → 204 且无 ACAO',
        res.state.status === 204 && res.state.headers['access-control-allow-origin'] === undefined,
        `status=${res.state.status}`);
}

{
    process.env['3LIB_ALLOWED_ORIGINS'] = 'https://trusted.example';
    const res = mockRes();
    await router.handle({ method: 'GET', url: '/api/health/ping', headers: { origin: 'https://trusted.example' } }, res);
    check('3LIB_ALLOWED_ORIGINS 显式放行',
        res.state.headers['access-control-allow-origin'] === 'https://trusted.example',
        `实际=${res.state.headers['access-control-allow-origin']}`);
    delete process.env['3LIB_ALLOWED_ORIGINS'];
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
