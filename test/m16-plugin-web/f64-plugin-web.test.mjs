/**
 * M16-A 插件管理页 + HTTP 接口（回归锁）
 *
 * 被测对象是 `cli/lib/web.js` 新增的两个本地端点（必须在 `/api/*` 反代**之前**拦截）：
 *   GET  /api/plugins         → readState() + check() 的快照
 *   POST /api/plugins/toggle  → 校验后写用户 overlay，失败回 400（不 500）
 *
 * 服务跑在**子进程 + 假 HOME**里（见 server-child.mjs）：overlay 的写入路径由
 * `os.homedir()` 决定，只有换个家目录才能保证真实 `~/.3lib` 一个字节都不动。
 * 后端地址故意给一个不存在的端口：`/api/plugins` 若漏拦截落进反代，会变成 502，
 * 因此 A 组拿到 200 本身就证明了拦截位置正确。
 *
 * 断言只锚定结构化 JSON 与文件事实，不 grep 前端脚本实现（那会随样式改动碎掉）。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { promises as fs, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const failures = [];

/**
 * 单条断言。
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(name, ok, detail = '') {
    if (ok) {
        pass++;
        console.log(`PASS  ${name}`);
    } else {
        fail++;
        failures.push(name);
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

/** 取一个当前空闲的本地端口（监听 0 让系统给，再立刻释放） */
function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

/**
 * 起测试用 Web 服务子进程，等它就绪。
 * @param {number} port
 * @param {string} childHome - 假家目录（USERPROFILE / HOME）
 * @param {string} [accessToken] - 配了就启用令牌门禁（用来验访问控制）
 */
function startServer(port, childHome, accessToken = '') {
    const env = { ...process.env, USERPROFILE: childHome, HOME: childHome, LOG_FILE_ENABLED: 'false' };
    delete env['3LIB_PLUGIN_PROFILE']; // profile 必须是 default，否则读到的 overlay 不是断言里的那份
    delete env['3LIB_ACCESS_TOKEN'];   // 令牌只由参数决定，别被外部环境串味

    const args = [path.join(HERE, 'server-child.mjs'), String(port), 'http://127.0.0.1:1'];
    if (accessToken) args.push(accessToken);

    const child = spawn(process.execPath, args, {
        cwd: ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stderr.on('data', (c) => {
        err += c.toString();
    });

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待服务就绪超时；stderr=${err.slice(-800)}`)), 30000);
        child.stdout.on('data', (c) => {
            out += c.toString();
            const m = /READY (\d+)/.exec(out);
            if (!m) return;
            clearTimeout(timer);
            resolve({ child, port: Number(m[1]) });
        });
        child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`服务子进程提前退出 code=${code}；stderr=${err.slice(-800)}`));
        });
        child.once('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

/** 极简 HTTP 客户端（零依赖，避免为测试引入 fetch 之外的第三方包） */
function request(port, method, pathname, { body = null, raw = null, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const payload = raw !== null
            ? Buffer.from(raw, 'utf8')
            : body !== null
                ? Buffer.from(JSON.stringify(body), 'utf8')
                : null;
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                path: pathname,
                method,
                headers: payload
                    ? { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers }
                    : headers,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try {
                        json = JSON.parse(text);
                    } catch { /* 静态资源不是 JSON，交给调用方看 text */ }
                    resolve({ status: res.statusCode, headers: res.headers, text, json });
                });
            }
        );
        req.once('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'm16-plugin-web-'));
const fakeHome = path.join(tmp, 'home');
await fs.mkdir(fakeHome, { recursive: true });
const overlayFile = path.join(fakeHome, '.3lib', '3rdloop', 'profiles', 'default.json');

// 真实用户目录的"开关文件"：测试前后必须一字节未变（存在则 mtime 不变，不存在则依然不存在）
const realOverlayFile = path.join(os.homedir(), '.3lib', '3rdloop', 'profiles', 'default.json');
const realBefore = existsSync(realOverlayFile) ? statSync(realOverlayFile).mtimeMs : null;

let child = null;
let port = 0;
const children = [];
try {
    port = await freePort();
    const started = await startServer(port, fakeHome);
    child = started.child;
    children.push(child);
    port = started.port;

    // ─── A GET /api/plugins：状态快照 ────────────────────────────────────
    const a1 = await request(port, 'GET', '/api/plugins');
    check('A1 GET /api/plugins 返回 200（而不是被 /api/* 反代成 502）', a1.status === 200, `status=${a1.status}`);
    check('A2 success=true', a1.json?.success === true, JSON.stringify(a1.json)?.slice(0, 200));

    const data = a1.json?.data ?? {};
    const plugins = Array.isArray(data.plugins) ? data.plugins : [];
    check('A3 data.plugins 至少 16 条（14 已安装 + 2 未安装）', plugins.length >= 16, `len=${plugins.length}`);

    const brain = plugins.find((p) => p.name === 'engines/brain');
    check('A4 含 engines/brain 且接缝为 engine-brain',
        !!brain && brain.seam === 'engine-brain', JSON.stringify(brain)?.slice(0, 200));

    const aiCli = (data.seams ?? {})['ai-cli'];
    check('A5 seams["ai-cli"].providers 长度为 2', aiCli?.providers?.length === 2,
        JSON.stringify(aiCli));
    check('A6 seams["ai-cli"].conflict === true（接缝冲突能力被锁住）', aiCli?.conflict === true,
        JSON.stringify(aiCli));

    check('A7 check() 结果随快照下发（errors / warnings 都是数组）',
        Array.isArray(data.errors) && Array.isArray(data.warnings),
        JSON.stringify({ errors: data.errors, warnings: data.warnings })?.slice(0, 200));
    check('A8 overlay.path 落在假 HOME 下（子进程的 USERPROFILE 生效）',
        String(data.overlay?.path ?? '').startsWith(fakeHome), String(data.overlay?.path));

    // ─── B toggle 成功路径 ──────────────────────────────────────────────
    const b1 = await request(port, 'POST', '/api/plugins/toggle', { body: { name: 'engines/brain', enabled: false } });
    check('B1 禁用 engines/brain 返回 200 + success=true',
        b1.status === 200 && b1.json?.success === true, `status=${b1.status} ${b1.text?.slice(0, 200)}`);
    check('B2 返回 requiresRestart=true（overlay 只在进程启动时被读）',
        b1.json?.data?.requiresRestart === true, JSON.stringify(b1.json?.data));
    check('B3 返回的写入文件就是假 HOME 下的 overlay',
        String(b1.json?.data?.file ?? '') === overlayFile, String(b1.json?.data?.file));

    const a2 = await request(port, 'GET', '/api/plugins');
    const brain2 = (a2.json?.data?.plugins ?? []).find((p) => p.name === 'engines/brain');
    check('B4 再次 GET 确认 engines/brain 的 enabled 已变为 false', brain2?.enabled === false,
        JSON.stringify(brain2)?.slice(0, 200));

    // ─── C 校验失败一律 400（不 500） ───────────────────────────────────
    const c1 = await request(port, 'POST', '/api/plugins/toggle', { body: { name: 'storage/core', enabled: false } });
    const c1msg = String(c1.json?.message ?? '');
    check('C1 禁用被依赖的 storage/core → HTTP 400 且 success=false',
        c1.status === 400 && c1.json?.success === false, `status=${c1.status} ${c1.text?.slice(0, 200)}`);
    check('C2 拒绝原因里点名依赖者 cli/opencode', c1msg.includes('cli/opencode'), c1msg.slice(0, 200));

    const c2 = await request(port, 'POST', '/api/plugins/toggle', { body: { name: 'no/such-plugin', enabled: false } });
    check('C3 未知插件 → 400 且 success=false',
        c2.status === 400 && c2.json?.success === false, `status=${c2.status} ${c2.text?.slice(0, 200)}`);

    const c3 = await request(port, 'POST', '/api/plugins/toggle', { raw: '{ 这不是 JSON' });
    check('C4 非 JSON body → 400（不 500）',
        c3.status === 400 && c3.json?.success === false, `status=${c3.status} ${c3.text?.slice(0, 200)}`);

    const c4 = await request(port, 'POST', '/api/plugins/toggle');
    check('C5 空 body → 400（不 500）',
        c4.status === 400 && c4.json?.success === false, `status=${c4.status} ${c4.text?.slice(0, 200)}`);

    const c5 = await request(port, 'POST', '/api/plugins/toggle', { body: { name: 'engines/brain' } });
    check('C6 缺 enabled 字段 → 400', c5.status === 400 && c5.json?.success === false,
        `status=${c5.status} ${c5.text?.slice(0, 200)}`);

    // ─── D 静态资源：前端入口与脚本 ─────────────────────────────────────
    const d1 = await request(port, 'GET', '/js/plugins.js');
    check('D1 GET /js/plugins.js → 200 且是 JS 内容类型',
        d1.status === 200 && /javascript/.test(String(d1.headers['content-type'] ?? '')),
        `status=${d1.status} type=${d1.headers['content-type']}`);

    const d2 = await request(port, 'GET', '/');
    check('D2 GET / 的 index.html 含插件入口（导航项 data-panel="p-plugins"）',
        d2.status === 200 && d2.text.includes('data-panel="p-plugins"'), `status=${d2.status}`);
    check('D3 GET / 的 index.html 含插件面板容器 id="p-plugins"', d2.text.includes('id="p-plugins"'));
    check('D4 GET / 的 index.html 加载了 js/plugins.js', d2.text.includes('js/plugins.js'));

    // ─── E 恢复开关 + overlay 落盘记录 ──────────────────────────────────
    const e1 = await request(port, 'POST', '/api/plugins/toggle', { body: { name: 'engines/brain', enabled: true } });
    check('E1 恢复 engines/brain 为启用 → 200 + enabled=true',
        e1.status === 200 && e1.json?.data?.enabled === true, `status=${e1.status} ${e1.text?.slice(0, 200)}`);

    const overlayRaw = await fs.readFile(overlayFile, 'utf8').catch(() => '');
    let overlayJson = null;
    try {
        overlayJson = JSON.parse(overlayRaw);
    } catch { /* 留空，下面断言会红 */ }
    check('E2 overlay 文件里留有 engines/brain 的记录且 enabled=true',
        overlayJson?.plugins?.['engines/brain']?.enabled === true, overlayRaw.slice(0, 200));

    const e2 = await request(port, 'GET', '/api/plugins');
    const brain3 = (e2.json?.data?.plugins ?? []).find((p) => p.name === 'engines/brain');
    check('E3 恢复后 GET 确认 enabled 回到 true', brain3?.enabled === true);

    // ─── F 不污染真实用户目录 ───────────────────────────────────────────
    const realAfter = existsSync(realOverlayFile) ? statSync(realOverlayFile).mtimeMs : null;
    check('F1 真实 ~/.3lib 的 profile overlay 未被创建 / 未被改写',
        realBefore === realAfter, `before=${realBefore} after=${realAfter} file=${realOverlayFile}`);

    // ─── G 访问控制：配了令牌时新端点同样要令牌（与 /api/ext-registry 同一套门禁）──
    const token = 'm16-test-token';
    const guarded = await startServer(await freePort(), fakeHome, token);
    children.push(guarded.child);
    const g1 = await request(guarded.port, 'GET', '/api/plugins');
    check('G1 配了令牌且未携带 → GET /api/plugins 返回 401',
        g1.status === 401 && g1.json?.success === false, `status=${g1.status} ${g1.text?.slice(0, 160)}`);
    const g2 = await request(guarded.port, 'GET', '/api/plugins', { headers: { 'X-Auth-Token': token } });
    check('G2 携带 X-Auth-Token 后 → 200 且 success=true',
        g2.status === 200 && g2.json?.success === true, `status=${g2.status} ${g2.text?.slice(0, 160)}`);
    const g3 = await request(guarded.port, 'POST', '/api/plugins/toggle', { body: { name: 'engines/brain', enabled: true } });
    check('G3 未携带令牌的 POST /api/plugins/toggle 同样 401（不写盘）',
        g3.status === 401 && g3.json?.success === false, `status=${g3.status} ${g3.text?.slice(0, 160)}`);
} catch (err) {
    check('Z1 测试执行未抛异常', false, err?.message ?? String(err));
} finally {
    for (const c of children) {
        if (c && !c.killed) c.kill('SIGTERM');
    }
    await fs.rm(tmp, { recursive: true, force: true });
}

console.log('\n═══ M16-A 汇总 ═══');
console.log(`共 ${pass + fail} 条断言，通过 ${pass} 条，失败 ${fail} 条`);
if (fail > 0) {
    console.log(`失败项：${failures.join(' / ')}`);
}
process.exit(fail === 0 ? 0 : 1);
