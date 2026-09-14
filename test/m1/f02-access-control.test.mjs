/**
 * M1 验收：F-02 访问控制
 *
 * 覆盖三层：
 *   1. Web/server.js（独立静态服务）——限绑回环、非回环必须带令牌、令牌门禁全路径生效
 *   2. cli/lib/web.js startWebServer（3rdloop serve 主路径）——同上门禁 + 默认回环
 *   3. Web/ext/issue 管理密码——未配置即 503（不回退弱口令）、限流、按 IP 隔离
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT_WEB_REFUSE = 13011;
const PORT_WEB_OK = 13012;
const PORT_WEB_OPEN = 13013;
const PORT_SERVE = 13014;
const TOKEN = 'm1-test-token';

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(port, p, headers = {}) {
    return new Promise((resolve) => {
        const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
            let n = 0;
            res.on('data', (c) => { n += c.length; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: n }));
        });
        r.on('error', (e) => resolve({ status: 0, error: e.message }));
        r.end();
    });
}

async function waitForListen(port, tries = 60) {
    for (let i = 0; i < tries; i++) {
        const ok = await new Promise((resolve) => {
            const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
            s.on('error', () => resolve(false));
            setTimeout(() => { s.destroy(); resolve(false); }, 200);
        });
        if (ok) return true;
        await sleep(100);
    }
    return false;
}

/** 尝试从非回环地址连接：能连上说明绑定了全网卡（不安全） */
function connectFromLanIp(port) {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const ni of list || []) {
            if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
        }
    }
    if (ips.length === 0) return Promise.resolve(null); // 无外网网卡，跳过
    const ip = ips[0];
    return new Promise((resolve) => {
        const s = net.connect({ host: ip, port }, () => { s.destroy(); resolve({ ip, reachable: true }); });
        s.on('error', (e) => resolve({ ip, reachable: false, code: e.code }));
        setTimeout(() => { s.destroy(); resolve({ ip, reachable: false, code: 'TIMEOUT' }); }, 1500);
    });
}

function spawnWebServer(port, args = [], env = {}) {
    return spawn(process.execPath, [path.join(ROOT, 'Web/server.js'), '--port', String(port), ...args], {
        cwd: ROOT,
        env: { ...process.env, '3LIB_ACCESS_TOKEN': '', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

// ─── 1a. 非回环 + 无令牌 → 拒绝启动 ────────────────────────────────────────
{
    const child = spawnWebServer(PORT_WEB_REFUSE, ['--host', '0.0.0.0']);
    let err = '';
    child.stderr.on('data', (c) => { err += c.toString(); });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    check('Web/server.js：非回环 + 无令牌 → 拒绝启动(exit 1)', code === 1, `code=${code}`);
    check('Web/server.js：拒绝时给出修复指引', /访问令牌|3LIB_ACCESS_TOKEN/.test(err));
}

// ─── 1b. 带令牌启动 → 门禁全路径生效 ──────────────────────────────────────
{
    const child = spawnWebServer(PORT_WEB_OK, [], { '3LIB_ACCESS_TOKEN': TOKEN });
    const up = await waitForListen(PORT_WEB_OK);
    check('Web/server.js：带令牌可正常启动', up);

    if (up) {
        const lan = await connectFromLanIp(PORT_WEB_OK);
        if (lan) {
            check(`Web/server.js：未绑定全网卡（从 ${lan.ip} 连接应失败）`, lan.reachable === false, `code=${lan.code}`);
        }

        const cases = [
            ['无凭据 401', '/', {}, 401],
            ['Cookie 正确令牌 200', '/', { Cookie: `3lib_token=${TOKEN}` }, 200],
            ['Cookie 错误令牌 401', '/', { Cookie: '3lib_token=wrong' }, 401],
            ['Bearer 200', '/', { Authorization: `Bearer ${TOKEN}` }, 200],
            ['X-Auth-Token 200', '/', { 'X-Auth-Token': TOKEN }, 200],
            ['受保护 API 无凭据 401', '/api/health', {}, 401],
            ['受保护 SSE 无凭据 401', '/stream/tasks/x', {}, 401],
        ];
        for (const [name, p, h, want] of cases) {
            const r = await req(PORT_WEB_OK, p, h);
            check(`Web/server.js：${name}`, r.status === want, `status=${r.status}`);
        }

        const q = await req(PORT_WEB_OK, `/?token=${TOKEN}`);
        check('Web/server.js：?token= → 302 + Set-Cookie + Location 不含令牌',
            q.status === 302
            && /3lib_token=/.test(q.headers['set-cookie']?.[0] || '')
            && !/token=/.test(q.headers.location || ''),
            `status=${q.status} loc=${q.headers.location}`);
    }
    child.kill('SIGKILL');
}

// ─── 1c. 默认（不传 --host）→ 回环可用，无需令牌 ──────────────────────────
{
    const child = spawnWebServer(PORT_WEB_OPEN, []);
    const up = await waitForListen(PORT_WEB_OPEN);
    check('Web/server.js：默认启动可监听', up);
    if (up) {
        const r = await req(PORT_WEB_OPEN, '/');
        check('Web/server.js：回环 + 无令牌 → 200（不破坏本机默认体验）', r.status === 200, `status=${r.status}`);
    }
    child.kill('SIGKILL');
}

// ─── 2. cli/lib/web.js startWebServer ─────────────────────────────────────
{
    const { startWebServer } = await import(pathToFileURL(`${ROOT}cli/lib/web.js`).href);

    let refused = null;
    try {
        await startWebServer({ port: 13021, backend: 'http://127.0.0.1:3000', host: '0.0.0.0', noExt: true, log: () => {} });
    } catch (e) { refused = e.message; }
    check('startWebServer：非回环 + 无令牌 → 抛错拒绝', !!refused && /访问令牌|3LIB_ACCESS_TOKEN/.test(refused));

    const server = await startWebServer({
        port: PORT_SERVE, backend: 'http://127.0.0.1:3000',
        accessToken: TOKEN, noExt: true, log: () => {},
    });
    const addr = server.address();
    check('startWebServer：默认绑定 127.0.0.1', addr.address === '127.0.0.1', `addr=${addr.address}`);

    const noTok = await req(PORT_SERVE, '/');
    check('startWebServer：无令牌 401', noTok.status === 401, `status=${noTok.status}`);
    const withTok = await req(PORT_SERVE, '/', { Cookie: `3lib_token=${TOKEN}` });
    check('startWebServer：Cookie 令牌 200', withTok.status === 200, `status=${withTok.status}`);
    const api = await req(PORT_SERVE, '/api/ext-registry');
    check('startWebServer：受保护 API 无令牌 401', api.status === 401, `status=${api.status}`);
    const sse = await req(PORT_SERVE, '/stream/tasks/x');
    check('startWebServer：受保护 SSE 无令牌 401', sse.status === 401, `status=${sse.status}`);
    server.close();

    const open = await startWebServer({ port: 13022, backend: 'http://127.0.0.1:3000', noExt: true, log: () => {} });
    const openRes = await req(13022, '/');
    check('startWebServer：回环 + 无令牌 → 200', openRes.status === 200, `status=${openRes.status}`);
    open.close();
}

// ─── 3. issue 扩展管理密码（两个模式需独立进程：常量在模块加载时读取）──────
{
    const script = path.join(ROOT, 'test/m1/f02-issue-admin.test.mjs');
    if (!fs.existsSync(script)) {
        check('issue 扩展：密码校验测试脚本存在', false, '缺少 f02-issue-admin.test.mjs');
    } else {
        for (const mode of ['unset', 'set']) {
            const code = await new Promise((resolve) => {
                const c = spawn(process.execPath, [script, mode], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
                let o = '';
                c.stdout.on('data', (d) => { o += d.toString(); });
                c.stderr.on('data', (d) => { o += d.toString(); });
                c.on('exit', (code2) => {
                    for (const line of o.split('\n')) if (line.trim()) console.log(`      ${line.trim()}`);
                    resolve(code2);
                });
            });
            check(`issue 扩展管理密码（${mode} 模式）全部通过`, code === 0, `exit=${code}`);
        }
    }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
