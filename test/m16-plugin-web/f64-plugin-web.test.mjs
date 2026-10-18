/**
 * M16-A 插件管理页 + HTTP 接口（回归锁）
 *
 * 被测对象是 `cli/lib/web.js` 的四个本地端点（必须在 `/api/*` 反代**之前**拦截）：
 *   GET  /api/plugins?profile=<name>  → readState() + check() 的快照
 *   POST /api/plugins/toggle          → 校验后写用户 overlay，失败回 400（不 500）
 *   POST /api/plugins/install         → 按 npm spec 装进 profile 目录（旧 `{dir}` 仍可）
 *   POST /api/plugins/remove          → 从 profile 目录卸载
 *
 * 插件模型已改成 DSH 式：**一个 profile 一个目录，插件是该目录的 npm 依赖**。
 * 因此本套件除了原有语义，还必须锁住：
 *   - `?profile=` 选中哪个 profile，看到的就是哪个 profile 的插件；
 *   - 两个 profile 的插件**互不影响**（在 web 里装的东西，default 的列表里不能出现）；
 *   - 装/卸都落在 profile 目录的 `node_modules/`，不再往 `~/.3lib/plugins` 复制。
 *
 * 服务跑在**子进程 + 假 HOME**里（见 server-child.mjs）：profile 目录、overlay 与
 * `node_modules` 的落点都由 `os.homedir()` 决定，只有换个家目录才能保证真实 `~/.3lib`
 * 一个字节都不动。后端地址故意给一个不存在的端口：`/api/plugins` 若漏拦截落进反代，
 * 会变成 502，因此 A 组拿到 200 本身就证明了拦截位置正确。
 *
 * 断言只锚定结构化 JSON 与文件事实，不 grep 前端脚本实现（那会随样式改动碎掉）。
 * `install` 一律用 `file:` 本地夹具（离线）；要证明失败路径时用必失败的 spec。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { promises as fs, existsSync, readdirSync, statSync } from 'node:fs';
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
    delete env['3LIB_PLUGIN_PROFILE']; // profile 必须由 ?profile= 决定，别被环境串味
    delete env['3LIB_ACCESS_TOKEN'];   // 令牌只由参数决定，别被外部环境串味
    delete env['3LIB_PLUGINS_DIR'];    // 额外插件根会让"两个 profile 互不影响"失去意义

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

/**
 * 造一个可被 npm 安装的插件包夹具：`package.json`（npm 需要）+ `plugin.json`（宿主清单）。
 * 两个文件都要写：包管理器按 package.json 装，宿主按 plugin.json 识别。
 *
 * @param {string} dir - 夹具目录
 * @param {{name: string, pkg?: string, version?: string, engines?: object}} opts
 * @returns {Promise<string>} 夹具目录
 */
async function makeFixture(dir, { name, pkg = name, version = '1.0.0', engines = null }) {
    await fs.mkdir(dir, { recursive: true });
    const manifest = { name, version, seam: 'app-logger', entry: 'index.js', dependencies: [] };
    const pkgJson = { name: pkg, version, main: 'index.js' };
    if (engines) {
        manifest.engines = engines;
        pkgJson.engines = engines;
    }
    await fs.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf8');
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkgJson), 'utf8');
    await fs.writeFile(path.join(dir, 'index.js'), `export default { name: ${JSON.stringify(name)} };\n`, 'utf8');
    return dir;
}

/** node_modules 里是否有东西（不存在 / 空目录都算"没产生"） */
function nodeModulesEmpty(dir) {
    if (!existsSync(dir)) return true;
    try {
        return readdirSync(dir).length === 0;
    } catch {
        return true;
    }
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'm16-plugin-web-'));
const fakeHome = path.join(tmp, 'home');
await fs.mkdir(fakeHome, { recursive: true });

// 假 HOME 里先造出第二个 profile 目录（目录式布局：<profiles>/<name>/profile.json）
const profilesRoot = path.join(fakeHome, '.3lib', '3rdloop', 'profiles');
const webProfileDir = path.join(profilesRoot, 'web');
await fs.mkdir(webProfileDir, { recursive: true });
await fs.writeFile(
    path.join(webProfileDir, 'profile.json'),
    JSON.stringify({ name: 'web', description: 'M16 测试用 profile', plugins: {} }, null, 2),
    'utf8'
);

// 坏包测试专用 profile：它从没被成功装过插件，所以能干净地断言"失败没留下 node_modules"
const badProfileDir = path.join(profilesRoot, 'bad');
await fs.mkdir(badProfileDir, { recursive: true });
await fs.writeFile(
    path.join(badProfileDir, 'profile.json'),
    JSON.stringify({ name: 'bad', description: 'M16 坏包测试 profile', plugins: {} }, null, 2),
    'utf8'
);

// 真实用户目录的"开关文件"：测试前后必须一字节未变（存在则 mtime 不变，不存在则依然不存在）
const realOverlayFile = path.join(os.homedir(), '.3lib', '3rdloop', 'profiles', 'default.json');
const realBefore = existsSync(realOverlayFile) ? statSync(realOverlayFile).mtimeMs : null;
const realUserPluginsDir = path.join(os.homedir(), '.3lib', 'plugins');

let child = null;
let port = 0;
const children = [];
try {
    port = await freePort();
    const started = await startServer(port, fakeHome);
    child = started.child;
    children.push(child);
    port = started.port;

    // ─── A GET /api/plugins：状态快照（当前 profile） ────────────────────
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

    // 新契约：profiles 名单 + 当前 profile 的目录（DSH：插件装在这个目录的 node_modules 里）
    check('A9 data.profiles 是数组且含 default', Array.isArray(data.profiles) && data.profiles.includes('default'),
        JSON.stringify(data.profiles));
    check('A10 data.profileDir 指向假 HOME 下的 profile 目录',
        String(data.profileDir ?? '').startsWith(fakeHome) && !!data.profileDir,
        String(data.profileDir));
    check('A11 overlayPath 与 overlay.path 一致（前端信息条用同一个落点）',
        data.overlayPath === data.overlay?.path, `overlayPath=${data.overlayPath} path=${data.overlay?.path}`);

    // 记下服务端自己报告的 overlay 落点：后面的断言都以它为准，
    // 不再硬编码 ~/.3lib/3rdloop/profiles/<p>.json（目录式 profile 布局换过落点）
    const defaultOverlayPath = String(data.overlay?.path ?? '');
    const defaultProfileDir = String(data.profileDir ?? '');

    // ─── B toggle 成功路径 ──────────────────────────────────────────────
    const b1 = await request(port, 'POST', '/api/plugins/toggle', { body: { name: 'engines/brain', enabled: false } });
    check('B1 禁用 engines/brain 返回 200 + success=true',
        b1.status === 200 && b1.json?.success === true, `status=${b1.status} ${b1.text?.slice(0, 200)}`);
    check('B2 返回 requiresRestart=true（overlay 只在进程启动时被读）',
        b1.json?.data?.requiresRestart === true, JSON.stringify(b1.json?.data));
    check('B3 返回的写入文件就是快照报告的 overlay 落点（且在假 HOME 下）',
        String(b1.json?.data?.file ?? '') === defaultOverlayPath && defaultOverlayPath.startsWith(fakeHome),
        `file=${b1.json?.data?.file} overlay=${defaultOverlayPath}`);

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

    // ─── D 静态资源：前端入口、脚本与 profile 选择器 ─────────────────────
    const d1 = await request(port, 'GET', '/js/plugins.js');
    check('D1 GET /js/plugins.js → 200 且是 JS 内容类型',
        d1.status === 200 && /javascript/.test(String(d1.headers['content-type'] ?? '')),
        `status=${d1.status} type=${d1.headers['content-type']}`);

    const d2 = await request(port, 'GET', '/');
    check('D2 GET / 的 index.html 含插件入口（导航项 data-panel="p-plugins"）',
        d2.status === 200 && d2.text.includes('data-panel="p-plugins"'), `status=${d2.status}`);
    check('D3 GET / 的 index.html 含插件面板容器 id="p-plugins"', d2.text.includes('id="p-plugins"'));
    check('D4 GET / 的 index.html 加载了 js/plugins.js', d2.text.includes('js/plugins.js'));

    // profile 选择器：前端要能把 profile 切过去（id 是前后端/测试之间的锚点）
    check('D5 index.html 含 profile 选择器 id="plugins-profile-select"',
        d2.text.includes('id="plugins-profile-select"'));
    check('D6 index.html 的安装输入框文案给出 npm spec 三种写法（file:D:/my-plugin）',
        d2.text.includes('file:D:/my-plugin') && d2.text.includes('npm 包名'),
        d2.text.includes('file:D:/my-plugin') ? '' : 'placeholder 未更新');
    check('D7 plugins.js 会带 ?profile= 拉取并处理 profile 下拉',
        d1.text.includes('plugins-profile-select') && d1.text.includes("'?profile='"),
        d1.text.includes("'?profile='") ? '' : 'plugins.js 未透传 profile');

    // ─── E 恢复开关 + overlay 落盘记录 ──────────────────────────────────
    const e1 = await request(port, 'POST', '/api/plugins/toggle', { body: { name: 'engines/brain', enabled: true } });
    check('E1 恢复 engines/brain 为启用 → 200 + enabled=true',
        e1.status === 200 && e1.json?.data?.enabled === true, `status=${e1.status} ${e1.text?.slice(0, 200)}`);

    const overlayRaw = defaultOverlayPath
        ? await fs.readFile(defaultOverlayPath, 'utf8').catch(() => '')
        : '';
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
    check('F2 真实 ~/.3lib/plugins 下没有本次夹具体的目录（安装不落到真实插件根）',
        !existsSync(path.join(realUserPluginsDir, 'm16demo')) &&
            !existsSync(path.join(realUserPluginsDir, 'm16web-demo')),
        realUserPluginsDir);

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

    // ─── H 安装 / 卸载：旧参数 {dir}（等价 file:<abs>），落在当前 profile ──
    const fixtureDir = await makeFixture(path.join(tmp, 'fixture-plugin'), { name: 'm16demo' });

    const h1 = await request(port, 'POST', '/api/plugins/install', { body: { dir: fixtureDir } });
    check('H1 旧参数 {dir} 仍能吃（等价 file:<abs>）→ 200 + success=true',
        h1.status === 200 && h1.json?.success === true, `status=${h1.status} ${h1.text?.slice(0, 240)}`);
    check('H2 回传的 spec 已被折成 file: 协议（旧参数的等价语义可核对）',
        String(h1.json?.data?.spec ?? '').startsWith('file:'), String(h1.json?.data?.spec));
    check('H3 装进的是 profile 目录（回传的 dir 在 profileDir 下，且 plugin.json 在）',
        String(h1.json?.data?.dir ?? '').startsWith(defaultProfileDir) &&
            existsSync(path.join(String(h1.json?.data?.dir ?? ''), 'plugin.json')),
        `dir=${h1.json?.data?.dir} profileDir=${defaultProfileDir}`);

    const h4 = await request(port, 'GET', '/api/plugins');
    const h4entry = (h4.json?.data?.plugins ?? []).find((p) => p.name === 'm16demo');
    check('H4 安装后快照里出现该插件且来源=profile', h4entry?.source === 'profile',
        JSON.stringify(h4entry)?.slice(0, 240));

    const h5 = await request(port, 'POST', '/api/plugins/install', { body: { dir: fixtureDir } });
    check('H5 重复安装同一 spec 不 500（重复安装不是服务端故障）',
        h5.status === 200 || (h5.status >= 400 && h5.status < 500),
        `status=${h5.status} ${h5.text?.slice(0, 160)}`);
    const h6 = await request(port, 'POST', '/api/plugins/install', { body: { dir: path.join(tmp, 'no-such-dir') } });
    check('H6 目录不存在 → 400', h6.status === 400 && h6.json?.success === false, `status=${h6.status} ${h6.text?.slice(0, 200)}`);
    const h7 = await request(port, 'POST', '/api/plugins/install', { body: {} });
    check('H7 缺 spec / dir → 400 且 message 提到 spec',
        h7.status === 400 && /spec/.test(String(h7.json?.message ?? '')), String(h7.json?.message));

    const h8 = await request(port, 'POST', '/api/plugins/remove', { body: { name: 'm16demo' } });
    check('H8 卸载 profile 里的插件 → 200 + removed=true',
        h8.status === 200 && h8.json?.data?.removed === true, `status=${h8.status} ${h8.text?.slice(0, 200)}`);
    check('H9 卸载后插件目录消失', !existsSync(String(h4entry?.dir ?? h1.json?.data?.dir ?? '')));

    const h10 = await request(port, 'POST', '/api/plugins/remove', { body: { name: 'storage/core' } });
    check('H10 卸载内置插件 → 400 且点名"内置"',
        h10.status === 400 && /内置/.test(h10.json?.message ?? ''), `status=${h10.status} ${h10.text?.slice(0, 200)}`);
    const h11 = await request(port, 'POST', '/api/plugins/remove', { body: { name: 'no/such-plugin' } });
    check('H11 卸载未知插件 → 400', h11.status === 400 && h11.json?.success === false, `status=${h11.status}`);
    const h12 = await request(port, 'GET', '/api/plugins/remove');
    check('H12 用 GET 访问 remove 端点 → 405', h12.status === 405, `status=${h12.status}`);

    // ─── I profile 隔离（本套验收核心）────────────────────────────────────
    const i1 = await request(port, 'GET', '/api/plugins?profile=web');
    check('I1 GET /api/plugins?profile=web → 200 且 data.profile === "web"',
        i1.status === 200 && i1.json?.data?.profile === 'web',
        `status=${i1.status} profile=${i1.json?.data?.profile} ${i1.text?.slice(0, 160)}`);
    const webData = i1.json?.data ?? {};
    check('I2 data.profiles 同时含 default 与 web',
        Array.isArray(webData.profiles) && webData.profiles.includes('default') && webData.profiles.includes('web'),
        JSON.stringify(webData.profiles));
    check('I3 profile=web 的 profileDir 是假 HOME 下 profiles/web',
        path.resolve(String(webData.profileDir ?? '')) === path.resolve(webProfileDir),
        `got=${webData.profileDir} want=${webProfileDir}`);
    check('I4 web profile 的 overlay 落点与 default 不是同一个文件',
        String(webData.overlay?.path ?? '') !== defaultOverlayPath && !!webData.overlay?.path,
        `web=${webData.overlay?.path} default=${defaultOverlayPath}`);

    const webFixture = await makeFixture(path.join(tmp, 'fixture-web'), { name: 'm16web-demo' });
    const i5 = await request(port, 'POST', '/api/plugins/install', {
        body: { spec: `file:${webFixture}`, profile: 'web' },
    });
    check('I5 install {spec:file:<夹具>, profile:web} → 200 且来源=profile',
        i5.status === 200 && i5.json?.data?.source === 'profile',
        `status=${i5.status} ${i5.text?.slice(0, 240)}`);
    check('I6 安装回传的 profile 就是 web', i5.json?.data?.profile === 'web', String(i5.json?.data?.profile));
    check('I7 装到 web profile 的 node_modules 下（不再复制到 ~/.3lib/plugins）',
        String(i5.json?.data?.dir ?? '').startsWith(path.join(webProfileDir, 'node_modules')),
        String(i5.json?.data?.dir));

    const i8 = await request(port, 'GET', '/api/plugins?profile=web');
    const i8entry = (i8.json?.data?.plugins ?? []).find((p) => p.name === 'm16web-demo');
    check('I8 随后 GET ?profile=web 能看到它且来源=profile',
        i8entry?.source === 'profile' && i8entry?.installed === true,
        JSON.stringify(i8entry)?.slice(0, 240));

    const i9 = await request(port, 'GET', '/api/plugins');
    const i9entry = (i9.json?.data?.plugins ?? []).find((p) => p.name === 'm16web-demo');
    check('I9 ★ 两个 profile 互不影响：default 的列表里没有 web 刚装的插件',
        i9entry === undefined, `default 里出现了 ${JSON.stringify(i9entry)?.slice(0, 200)}`);
    check('I10 default 与 web 的 profileDir 不同（一个 profile 一个目录）',
        path.resolve(defaultProfileDir) !== path.resolve(String(webData.profileDir ?? '')),
        `default=${defaultProfileDir} web=${webData.profileDir}`);

    // ─── J 未知 profile：明确 4xx / 明确拒绝，绝不 500 ────────────────────
    const j1 = await request(port, 'GET', '/api/plugins?profile=no-such-profile');
    check('J1 GET ?profile=<不存在> → 400（不是 500）',
        j1.status === 400 && j1.json?.success === false, `status=${j1.status} ${j1.text?.slice(0, 200)}`);
    check('J2 未知 profile 的 message 可读（提到 profile / 可用名单）',
        /profile/i.test(String(j1.json?.message ?? '')), String(j1.json?.message)?.slice(0, 200));
    const j3 = await request(port, 'POST', '/api/plugins/toggle', {
        body: { name: 'engines/brain', enabled: true, profile: 'no-such-profile' },
    });
    check('J3 toggle 带未知 profile → 400（不 500）',
        j3.status === 400 && j3.json?.success === false, `status=${j3.status} ${j3.text?.slice(0, 200)}`);
    // profile 名非法（越出目录语义）必须被挡：这类名字不该被当成"新 profile 目录"建出来
    const j4 = await request(port, 'GET', '/api/plugins?profile=' + encodeURIComponent('../evil'));
    check('J4 profile 名非法（../evil）→ 400 且不 500',
        j4.status === 400 && j4.json?.success === false, `status=${j4.status} ${j4.text?.slice(0, 200)}`);
    // 合法但尚不存在的 profile：store 允许"装的时候就把它建出来"，那种情况必须是
    // 明确的 200 且 profile 真的进了名单 —— 不能是 500，也不能静默什么都没发生
    const j5 = await request(port, 'POST', '/api/plugins/install', {
        body: { dir: path.join(tmp, 'no-such-dir'), profile: 'virtual-x' },
    });
    check('J5 装到尚未存在的合法 profile：失败路径仍是 400（不 500）',
        j5.status === 400 && j5.json?.success === false, `status=${j5.status} ${j5.text?.slice(0, 200)}`);

    // ─── K 坏包（engines 不满足）：400 + 不落盘 ─────────────────────────
    const badFixture = await makeFixture(path.join(tmp, 'fixture-bad-engines'), {
        name: 'm16web-bad',
        engines: { '3rdloop': '^99.0.0' },
    });
    const k1 = await request(port, 'POST', '/api/plugins/install', {
        body: { spec: `file:${badFixture}`, profile: 'bad' },
    });
    const k1msg = String(k1.json?.message ?? '');
    check('K1 engines 不满足的坏包 → 400 且 success=false',
        k1.status === 400 && k1.json?.success === false, `status=${k1.status} ${k1.text?.slice(0, 240)}`);
    check('K2 拒绝原因说明版本不满足（提到版本 / engines / 不满足）',
        /版本|engines|不满足/i.test(k1msg), k1msg.slice(0, 240));
    check('K3 假 HOME 下该 profile 没产生 node_modules（预检失败不留给包管理器）',
        !existsSync(path.join(badProfileDir, 'node_modules')) || nodeModulesEmpty(path.join(badProfileDir, 'node_modules')),
        `${path.join(badProfileDir, 'node_modules')} len=${nodeModulesEmpty(path.join(badProfileDir, 'node_modules'))}`);
    check('K4 坏包目录本身没有落进任何 profile',
        !existsSync(path.join(badProfileDir, 'node_modules', 'm16web-bad')) &&
            !existsSync(path.join(webProfileDir, 'node_modules', 'm16web-bad')));
    const k5 = await request(port, 'GET', '/api/plugins?profile=bad');
    check('K5 坏包也不出现在该 profile 的插件快照里',
        k5.status === 200 && (k5.json?.data?.plugins ?? []).every((p) => p.name !== 'm16web-bad'),
        JSON.stringify((k5.json?.data?.plugins ?? []).map((p) => p.name))?.slice(0, 240));

    // ─── L 旧参数 {dir} 也能装进指定 profile（兼容期两条路等价）──────────
    const legacyWebFixture = await makeFixture(path.join(tmp, 'fixture-web-legacy'), { name: 'm16web-legacy' });
    const l1 = await request(port, 'POST', '/api/plugins/install', {
        body: { dir: legacyWebFixture, profile: 'web' },
    });
    check('L1 {dir, profile:web} → 200 且来源=profile（旧参数也遵循 profile）',
        l1.status === 200 && l1.json?.data?.source === 'profile',
        `status=${l1.status} ${l1.text?.slice(0, 240)}`);
    check('L2 旧参数被折成 file: 协议', String(l1.json?.data?.spec ?? '').startsWith('file:'),
        String(l1.json?.data?.spec));
    const l3 = await request(port, 'GET', '/api/plugins?profile=web');
    check('L3 该插件出现在 web 的列表里',
        (l3.json?.data?.plugins ?? []).some((p) => p.name === 'm16web-legacy'));
    const l4 = await request(port, 'GET', '/api/plugins');
    check('L4 该插件不出现在 default 的列表里（profile 隔离对旧参数同样成立）',
        (l4.json?.data?.plugins ?? []).every((p) => p.name !== 'm16web-legacy'));

    // ─── M 卸载只作用于指定 profile ─────────────────────────────────────
    const m1 = await request(port, 'POST', '/api/plugins/remove', { body: { name: 'm16web-demo', profile: 'web' } });
    check('M1 remove {name, profile:web} → 200 + removed=true',
        m1.status === 200 && m1.json?.data?.removed === true, `status=${m1.status} ${m1.text?.slice(0, 240)}`);
    const m2 = await request(port, 'GET', '/api/plugins?profile=web');
    check('M2 卸载后 web 的列表里消失',
        (m2.json?.data?.plugins ?? []).every((p) => p.name !== 'm16web-demo'),
        JSON.stringify((m2.json?.data?.plugins ?? []).map((p) => p.name))?.slice(0, 240));
    check('M3 default 的列表仍然没有它（卸载不越 profile）',
        ((await request(port, 'GET', '/api/plugins')).json?.data?.plugins ?? []).every((p) => p.name !== 'm16web-demo'));

    // ─── N web profile 的开关写自己的落点，不碰 default ─────────────────
    const n1 = await request(port, 'POST', '/api/plugins/toggle', {
        body: { name: 'engines/brain', enabled: false, profile: 'web' },
    });
    check('N1 toggle 带 profile:web → 200 且回传 profile=web',
        n1.status === 200 && n1.json?.data?.profile === 'web',
        `status=${n1.status} ${n1.text?.slice(0, 240)}`);
    check('N2 web 的开关写到自己的落点（不是 default 那份）',
        String(n1.json?.data?.file ?? '') !== defaultOverlayPath && !!n1.json?.data?.file,
        `file=${n1.json?.data?.file}`);
    const n3 = await request(port, 'GET', '/api/plugins?profile=web');
    const n3brain = (n3.json?.data?.plugins ?? []).find((p) => p.name === 'engines/brain');
    check('N3 web profile 里 engines/brain 已禁用', n3brain?.enabled === false,
        JSON.stringify(n3brain)?.slice(0, 200));
    const n4 = await request(port, 'GET', '/api/plugins');
    const n4brain = (n4.json?.data?.plugins ?? []).find((p) => p.name === 'engines/brain');
    check('N4 default profile 的 engines/brain 不受影响（仍为 true）', n4brain?.enabled === true,
        JSON.stringify(n4brain)?.slice(0, 200));
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
