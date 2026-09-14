/**
 * M1 验收：issue 扩展管理密码（Web/ext/issue/router.cjs）
 *
 * 用法: node f02-issue-admin.test.mjs <unset|set>
 *
 * 注意：ADMIN_PASSWORD 在模块加载时读取，因此必须在 import 之前设定环境变量，
 * 故 unset / set 两个模式由调用方以独立进程分别运行。
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const MODE = process.argv[2] || 'set';
const ADMIN = 'Str0ng-Secret!';

if (MODE === 'set') {
    process.env.ISSUE_ADMIN_PASSWORD = ADMIN;
} else {
    delete process.env.ISSUE_ADMIN_PASSWORD;
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { initExtRouter } = await import(pathToFileURL(`${ROOT}cli/lib/web-ext.js`).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f02-issue-'));
const router = initExtRouter(
    {
        name: 'issue', mount: '/issue', title: 'Issue',
        server: path.join(ROOT, 'Web/ext/issue/router.cjs'),
        dir: path.join(ROOT, 'Web/ext/issue'),
    },
    { cliRoot: ROOT, dataDir: tmp, logger: () => {} }
);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${MODE}] ${name}${detail ? '  → ' + detail : ''}`);
};

if (!router || typeof router.match !== 'function') {
    check('issue 扩展路由可加载', false, 'initExtRouter 未返回可用 Router');
    process.exit(1);
}
check('issue 扩展路由可加载', true);

async function callRefresh(password, ip) {
    const m = router.match('POST', '/refresh');
    if (!m) throw new Error('未找到 POST /refresh 路由');
    const captured = { status: null, body: null };
    const req = {
        body: { org: 'openharmony-sig', password },
        params: m.params, query: {}, headers: {}, socket: { remoteAddress: ip },
    };
    const res = {
        status(c) { captured.status = c; return this; },
        json(b) { captured.body = b; return this; },
        send(b) { captured.body = b; return this; },
        setHeader() {}, end() {},
    };
    await m.handler(req, res);
    return captured;
}

if (MODE === 'unset') {
    const r = await callRefresh('admin123', '10.0.0.9');
    check('未配置管理密码时，即便传 admin123 也返回 503（不回退弱口令）',
        r.status === 503, `status=${r.status} msg=${r.body?.message}`);
    const r2 = await callRefresh('', '10.0.0.9');
    check('未配置管理密码时，空密码同样 503', r2.status === 503, `status=${r2.status}`);
} else {
    const r1 = await callRefresh('admin123', '10.0.0.11');
    check('已配置密码时，错误密码（含 admin123）返回 403',
        r1.status === 403, `status=${r1.status} msg=${r1.body?.message}`);

    let last = null;
    for (let i = 0; i < 6; i++) last = await callRefresh('wrong-password', '10.0.0.12');
    check('同 IP 连续失败 5 次后触发限流 429', last.status === 429, `status=${last.status}`);

    const r2 = await callRefresh(ADMIN, '10.0.0.13');
    check('正确密码通过密码校验（非 401/403/429/503）',
        ![401, 403, 429, 503].includes(r2.status), `status=${r2.status}`);

    const r3 = await callRefresh('wrong-password', '10.0.0.14');
    check('限流按来源 IP 隔离（新 IP 首次失败仍为 403）', r3.status === 403, `status=${r3.status}`);
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

const failed = results.filter((r) => !r.ok).length;
console.log(`[${MODE}] 合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
