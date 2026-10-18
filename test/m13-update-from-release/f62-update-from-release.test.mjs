/**
 * M13-A 从 GitHub Release 附件升级（`3rdloop update --from-release`）
 *
 * 背景（本套件锁的行为）：双包发布形态是 `@ohos-cpf/3rdloop_core`（仓库根）+ `@ohos-cpf/3rdloop`
 * （cli/），产物由 `scripts/release.mjs` 打成两个 tarball 挂到 GitHub Release。包不一定发到公共
 * npm registry，因此从 Release 安装的用户跑 registry 路径的 `update` 必然 404——`--from-release`
 * 就是补这条路径：取 release → 挑两个 asset → 下载 → 一次 `npm i -g <core> <cli>` → 回读校验。
 *
 * 确定性 / 离线约束：
 *   - 不访问真实 GitHub：本地 `node:http` 服务扮演 Release API 与 asset 下载端点；
 *   - asset 是**真** tarball（`npm pack` 于仓库根与 `cli/`，`--ignore-scripts` 避免触发
 *     prepack/postpack 改动工作树），因此装出来的东西是真实包；
 *   - 安装走 npm 本地缓存（`npm_config_prefer_offline`），不下载安装脚本
 *     （`npm_config_ignore_scripts`，真包含 native 依赖，本套件不执行它们）。
 *
 * 断言只锚定**结构化 JSON 与文件系统事实**（版本号、asset 名、路径存在性、请求头、退出码），
 * 不锚定任何一句中文文案——文案随时可改，契约不会。
 *
 * 分组：
 *   O 前置：真 tarball 与 asset 分拣约定
 *   A `--check` 组合：只报告，不下载不安装
 *   B 真实安装（`--prefix` 落到临时前缀）
 *   C 版本不一致告警（tag 与 tarball 版本不符）
 *   D asset 缺失：明确报错并列出实际名单
 *   E API 不可达：报错带 URL
 *   F 仓库推导不出：要求显式 `--release-repo`
 *   G 成功路径：下载临时目录被清理（断言对象 = CLI 自己报出来的路径）
 *   H asset 下载 404：非零退出且临时目录仍被清理
 *   I npm 安装失败（坏 tarball）：报原始 npm 输出且临时目录仍被清理
 */
import { spawn, spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI_ROOT = path.join(ROOT, 'cli');
const BIN = path.join(CLI_ROOT, 'bin', '3rdloop.mjs');

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

const readJson = (file) => JSON.parse(fsSync.readFileSync(file, 'utf8'));
const exists = (p) => fsSync.existsSync(p);

// ── npm 入口（与 scripts/release.mjs 同策略：优先当前 node 自带的 npm-cli.js）──────────
function npmEntry() {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fsSync.existsSync(cli)) return { file: process.execPath, prefix: [cli], shell: false };
    return { file: 'npm', prefix: [], shell: process.platform === 'win32' };
}

/**
 * `npm pack` 一个包目录到 outDir，返回 tarball 文件名。
 * `--ignore-scripts`：跳过 cli 的 prepack/postpack（那会生成/删除 cli/vendor，污染工作树）。
 */
function packPackage(label, pkgDir, outDir) {
    const { file, prefix, shell } = npmEntry();
    const res = spawnSync(file, [...prefix, 'pack', '--ignore-scripts', '--json', '--pack-destination', outDir], {
        cwd: pkgDir,
        encoding: 'utf8',
        shell,
    });
    if (res.status !== 0) {
        throw new Error(`${label}: npm pack 退出码 ${res.status}\n${(res.stderr || '').slice(-800)}`);
    }
    const m = (res.stdout || '').match(/"filename"\s*:\s*"([^"]+\.tgz)"/);
    if (!m) throw new Error(`${label}: 无法从 npm pack 输出中解析 tarball 名\n${(res.stdout || '').slice(-800)}`);
    const name = m[1];
    const full = path.join(outDir, name);
    if (!fsSync.existsSync(full)) throw new Error(`${label}: npm pack 报告 ${name}，但 ${outDir} 下不存在`);
    return { name, file: full, bytes: fsSync.statSync(full).size };
}

// ── 运行 CLI ────────────────────────────────────────────────────
// npm config 走环境变量而不是改 update.js 的安装命令：生产命令保持「真装」（真用户需要安装脚本
// 与在线 registry），测试侧用 npm 自身的 env 开关把行为钉成确定性/离线。
const NPM_ENV = {
    npm_config_ignore_scripts: 'true',
    npm_config_prefer_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_progress: 'false',
    LOG_FILE_ENABLED: 'false',
};

function runCli(args, { env = {}, timeoutMs = 240000 } = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [BIN, ...args], {
            cwd: ROOT,
            env: { ...process.env, ...NPM_ENV, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => { stdout += c.toString(); });
        child.stderr.on('data', (c) => { stderr += c.toString(); });
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, stdout, stderr });
        });
    });
}

/** 解析 `--json` 的 stdout；不是合法 JSON 返回 null。 */
function jsonOf(r) {
    try {
        return JSON.parse(r.stdout);
    } catch {
        return null;
    }
}

/**
 * 等某个路径真的从磁盘消失（最多 ~2s）。
 * Windows 上刚写入的大文件可能还有待完成的删除（句柄释放后才落地），
 * 这里只做沉降等待，判定对象仍是**本次运行自己报告的那个路径**。
 */
async function dirGone(dirPath) {
    if (!dirPath) return false;
    for (let i = 0; i < 10; i++) {
        if (!exists(dirPath)) return true;
        await new Promise((r) => setTimeout(r, 200));
    }
    return !exists(dirPath);
}

// ═══════════════════════════════════════════════════════════════════
// O 前置：真 tarball
// ═══════════════════════════════════════════════════════════════════
console.log('─── O 前置：真 tarball 与 asset 分拣约定 ───');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'm13-release-'));
const assetDir = path.join(tmp, 'assets');
await fs.mkdir(assetDir, { recursive: true });

const corePkgJson = readJson(path.join(ROOT, 'package.json'));
const cliPkgJson = readJson(path.join(CLI_ROOT, 'package.json'));
const VERSION = String(cliPkgJson.version);

check('O1 核心包与 CLI 包版本一致（双包同版本发布）', corePkgJson.version === cliPkgJson.version,
    `${corePkgJson.version} vs ${cliPkgJson.version}`);

let coreAsset = null;
let cliAsset = null;
try {
    coreAsset = packPackage('core', ROOT, assetDir);
    cliAsset = packPackage('cli', CLI_ROOT, assetDir);
} catch (err) {
    check('O2 npm pack 产出两个真 tarball', false, err.message);
}

check('O2 npm pack 产出两个真 tarball 且非空',
    Boolean(coreAsset && cliAsset && coreAsset.bytes > 0 && cliAsset.bytes > 0),
    coreAsset && cliAsset ? `${coreAsset.bytes} / ${cliAsset.bytes}` : '打包失败');
check('O3 核心包 tarball 名含 3rdloop_core（asset 分拣约定）',
    Boolean(coreAsset && coreAsset.name.includes('3rdloop_core')), coreAsset?.name);
check('O4 CLI 包 tarball 名含 3rdloop 且不含 _core（asset 分拣约定）',
    Boolean(cliAsset && cliAsset.name.includes('3rdloop') && !cliAsset.name.includes('_core')), cliAsset?.name);

if (!coreAsset || !cliAsset) {
    // 没有真 tarball 后面全部无意义：直接收口，避免制造一堆误导性 FAIL
    console.log(`\n汇总: ${pass} 通过 / ${fail} 失败（前置失败，中止）`);
    await fs.rm(tmp, { recursive: true, force: true });
    process.exit(1);
}

const coreBytes = await fs.readFile(coreAsset.file);
const cliBytes = await fs.readFile(cliAsset.file);

// ═══════════════════════════════════════════════════════════════════
// 假 GitHub：Release API + asset 下载端点
// ═══════════════════════════════════════════════════════════════════
const requests = [];
const downloads = [];
let base = '';

/** 一份 release JSON：两个真 tarball + 两个诱饵附件（证明只挑 .tgz 且按命名分拣）。 */
function releaseJson(tagVersion) {
    return {
        tag_name: `v${tagVersion}`,
        name: `v${tagVersion}`,
        draft: false,
        prerelease: false,
        assets: [
            {
                name: coreAsset.name,
                size: coreAsset.bytes,
                browser_download_url: `${base}/download/${coreAsset.name}`,
            },
            {
                name: cliAsset.name,
                size: cliAsset.bytes,
                browser_download_url: `${base}/download/${cliAsset.name}`,
            },
            { name: 'SHA256SUMS', size: 132, browser_download_url: `${base}/download/SHA256SUMS` },
            { name: 'RELEASE.md', size: 2048, browser_download_url: `${base}/download/RELEASE.md` },
        ],
    };
}

const tiny = {
    SHA256SUMS: Buffer.from(`${'0'.repeat(64)}  ${coreAsset.name}\n${'1'.repeat(64)}  ${cliAsset.name}\n`, 'utf8'),
    'RELEASE.md': Buffer.from('# 诱饵附件：不该被下载\n', 'utf8'),
};

const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);

    if (pathname.startsWith('/download/')) {
        const name = pathname.slice('/download/'.length);
        downloads.push(name);
        // 故障注入：missing/ = asset 下载 404；corrupt/ = 返回垃圾字节（让 npm install 失败）
        if (name.startsWith('missing/')) {
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('not found');
            return;
        }
        if (name.startsWith('corrupt/')) {
            const junk = Buffer.from('这不是一个合法的 npm tarball\n');
            res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(junk.length) });
            res.end(junk);
            return;
        }
        const body = name === coreAsset.name ? coreBytes : name === cliAsset.name ? cliBytes : tiny[name];
        if (!body) {
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('not found');
            return;
        }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) });
        res.end(body);
        return;
    }

    const send = (obj) => {
        const body = Buffer.from(JSON.stringify(obj), 'utf8');
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length) });
        res.end(body);
    };

    if (pathname === '/repos/fake/repo/releases/latest' || pathname === `/repos/fake/repo/releases/tags/v${VERSION}`) {
        send(releaseJson(VERSION));
        return;
    }
    if (pathname === '/repos/fake/mismatch/releases/latest') {
        send(releaseJson('9.9.9'));
        return;
    }
    if (pathname === '/repos/fake/partial/releases/latest') {
        // 只有核心包：CLI 包 asset 缺失
        const full = releaseJson(VERSION);
        send({ ...full, assets: full.assets.filter((a) => a.name !== cliAsset.name) });
        return;
    }
    if (pathname === '/repos/fake/broken/releases/latest' || pathname === '/repos/fake/corrupt/releases/latest') {
        // 两个 asset 名字齐全，但核心包的下载地址是坏的（404 / 垃圾字节）
        const kind = pathname.includes('/fake/corrupt/') ? 'corrupt' : 'missing';
        const full = releaseJson(VERSION);
        send({
            ...full,
            assets: full.assets.map((a) => a.name === coreAsset.name
                ? { ...a, browser_download_url: `${base}/download/${kind}/${coreAsset.name}` }
                : a),
        });
        return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not Found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${server.address().port}`;

const prefixCheck = path.join(tmp, 'prefix-check');
const prefixMain = path.join(tmp, 'prefix-main');
const prefixMismatch = path.join(tmp, 'prefix-mismatch');
const prefixPartial = path.join(tmp, 'prefix-partial');
const prefixDead = path.join(tmp, 'prefix-dead');
const prefixBroken = path.join(tmp, 'prefix-broken');
const prefixCorrupt = path.join(tmp, 'prefix-corrupt');

const apiArgs = (repo = 'fake/repo') => ['--release-api', base, '--release-repo', repo];

try {
    // ═══════════════════════════════════════════════════════════════
    // A `--check` 组合：只报告，不下载不安装
    // ═══════════════════════════════════════════════════════════════
    console.log('─── A --from-release --check（只报告）───');

    const help = await runCli(['update', '--help'], { timeoutMs: 60000 });
    check('A1 update --help 离线可用（exit 0）', help.code === 0, `exit=${help.code}`);
    check('A2 --help 文档声明了 --from-release', /--from-release/.test(help.stdout), help.stdout.slice(0, 80));

    const dlBeforeCheck = downloads.length;
    const apiBeforeCheck = requests.filter((r) => r.url.startsWith('/repos/')).length;
    // --prefix 也带上：--check 若回归成「照装不误」，污染范围被钉死在临时前缀，
    // 绝不会落到这台机器真正的全局目录里。
    const chk = await runCli(['update', '--from-release', ...apiArgs(), '--check', '--prefix', prefixCheck, '--json']);
    const chkJson = jsonOf(chk);

    check('A3 --check 退出 0', chk.code === 0, `exit=${chk.code}`);
    check('A4 --check stdout 是合法 JSON 且 ok=true', Boolean(chkJson && chkJson.ok === true), chk.stdout.slice(0, 200));
    check('A5 --check 标记 check=true', chkJson?.check === true);
    check('A6 --check 报告 release tag', chkJson?.tag === `v${VERSION}`, String(chkJson?.tag));
    check('A7 --check 报告 release 版本（去 v 前缀）', chkJson?.version === VERSION, String(chkJson?.version));
    check('A8 --check 判定不需要更新（当前 = release）', chkJson?.upToDate === true, String(chkJson?.upToDate));
    check('A9 --check 报告核心包 asset 名', chkJson?.assets?.core?.name === coreAsset.name, String(chkJson?.assets?.core?.name));
    check('A10 --check 报告 CLI 包 asset 名', chkJson?.assets?.cli?.name === cliAsset.name, String(chkJson?.assets?.cli?.name));
    check('A11 --check 报告的核心包体积等于磁盘实际字节数', chkJson?.assets?.core?.size === coreAsset.bytes,
        `${chkJson?.assets?.core?.size} vs ${coreAsset.bytes}`);
    check('A12 --check 不产生 node_modules（未安装）', !exists(path.join(prefixCheck, 'node_modules')));
    check('A13 --check 不下载任何 asset', downloads.length === dlBeforeCheck, `downloads=${downloads.length - dlBeforeCheck}`);
    check('A14 --check 仍会查询一次 Release API', requests.filter((r) => r.url.startsWith('/repos/')).length === apiBeforeCheck + 1);
    check('A15 --check 不创建下载临时目录（结果里没有 download 字段）', chkJson?.download === undefined, JSON.stringify(chkJson?.download));

    // ═══════════════════════════════════════════════════════════════
    // B 真实安装（--prefix 落到临时前缀）
    // ═══════════════════════════════════════════════════════════════
    console.log('─── B --from-release 真实安装（--prefix）───');

    const dlBefore = downloads.length;
    const run = await runCli([
        'update', '--from-release', ...apiArgs(), '--yes', '--prefix', prefixMain, '--json',
    ]);
    const runJson = jsonOf(run);
    const installedCliPkg = path.join(prefixMain, 'node_modules', '@ohos-cpf', '3rdloop', 'package.json');
    const installedCorePkg = path.join(prefixMain, 'node_modules', '@ohos-cpf', '3rdloop_core', 'package.json');

    check('B1 安装退出 0', run.code === 0, `exit=${run.code} stderr=${run.stderr.slice(-400)}`);
    check('B2 stdout 是合法 JSON（--json 通道纯净）', Boolean(runJson), run.stdout.slice(0, 300));
    check('B3 结果 ok=true 且 mode=release', runJson?.ok === true && runJson?.mode === 'release');
    check('B4 回读的 CLI 包版本 = release 版本', runJson?.installed?.cli === VERSION, String(runJson?.installed?.cli));
    check('B5 回读的核心包版本 = release 版本', runJson?.installed?.core === VERSION, String(runJson?.installed?.core));
    check('B6 版本校验一致（versionMismatch=false）', runJson?.versionMismatch === false, String(runJson?.versionMismatch));
    check('B7 安装根目录落在 --prefix 下', String(runJson?.installRoot || '').startsWith(prefixMain), String(runJson?.installRoot));
    check('B8 <prefix>/node_modules/@ohos-cpf/3rdloop/package.json 存在', exists(installedCliPkg));
    check('B9 <prefix>/node_modules/@ohos-cpf/3rdloop_core/package.json 存在', exists(installedCorePkg));
    check('B10 装上的 CLI 包版本 = release tag 版本', exists(installedCliPkg) && readJson(installedCliPkg).version === VERSION,
        exists(installedCliPkg) ? readJson(installedCliPkg).version : '(缺文件)');
    check('B11 装上的核心包版本 = release tag 版本', exists(installedCorePkg) && readJson(installedCorePkg).version === VERSION,
        exists(installedCorePkg) ? readJson(installedCorePkg).version : '(缺文件)');
    check('B12 stderr 有下载/安装进度（含两个 asset 名）',
        run.stderr.includes(coreAsset.name) && run.stderr.includes(cliAsset.name), run.stderr.slice(-300));
    check('B13 只下载了两个 asset（诱饵 SHA256SUMS/RELEASE.md 未被下载）',
        downloads.slice(dlBefore).length === 2 && !downloads.slice(dlBefore).includes('SHA256SUMS'),
        downloads.slice(dlBefore).join(','));

    const apiCalls = requests.filter((r) => r.url.startsWith('/repos/'));
    const lastApi = apiCalls[apiCalls.length - 1];
    check('B14 Release API 请求带非空 User-Agent（GitHub 硬要求）',
        Boolean(lastApi && lastApi.headers['user-agent']), String(lastApi?.headers['user-agent']));
    check('B15 公开仓库不发送任何 Authorization 头（不带 token）',
        Boolean(lastApi) && !('authorization' in lastApi.headers),
        String(lastApi?.headers.authorization));

    // ═══════════════════════════════════════════════════════════════
    // C 版本不一致告警（tag 与 tarball 版本不符）
    // ═══════════════════════════════════════════════════════════════
    console.log('─── C 版本不一致告警（tag v9.9.9 / tarball ' + VERSION + '）───');

    const mis = await runCli([
        'update', '--from-release', ...apiArgs('fake/mismatch'), '--yes', '--prefix', prefixMismatch, '--json',
    ]);
    const misJson = jsonOf(mis);
    check('C1 tag 与 tarball 不符时安装本身仍成功（exit 0）', mis.code === 0, `exit=${mis.code}`);
    check('C2 报告的是 release tag 的版本', misJson?.tag === 'v9.9.9' && misJson?.version === '9.9.9', `${misJson?.tag}/${misJson?.version}`);
    check('C3 回读版本来自实际安装的 tarball', misJson?.installed?.cli === VERSION, String(misJson?.installed?.cli));
    check('C4 标注 versionMismatch=true（告警不阻断）', misJson?.versionMismatch === true, String(misJson?.versionMismatch));
    check('C5 告警写到 stderr（含两个版本号）', mis.stderr.includes('9.9.9') && mis.stderr.includes(VERSION), mis.stderr.slice(-300));

    // ═══════════════════════════════════════════════════════════════
    // D asset 缺失
    // ═══════════════════════════════════════════════════════════════
    console.log('─── D asset 缺失（只有核心包）───');

    const part = await runCli([
        'update', '--from-release', ...apiArgs('fake/partial'), '--yes', '--prefix', prefixPartial, '--json',
    ]);
    const partJson = jsonOf(part);
    check('D1 asset 缺失时非零退出', part.code !== 0, `exit=${part.code}`);
    check('D2 结构化结果 ok=false', partJson?.ok === false, part.stdout.slice(0, 200));
    check('D3 错误信息列出实际存在的 asset 名单', String(partJson?.error || '').includes(coreAsset.name), String(partJson?.error).slice(0, 300));
    check('D4 错误信息不编造缺失的 asset 名', !String(partJson?.error || '').includes(cliAsset.name));
    check('D5 asset 缺失时不产生 node_modules', !exists(path.join(prefixPartial, 'node_modules')));

    // ═══════════════════════════════════════════════════════════════
    // E API 不可达
    // ═══════════════════════════════════════════════════════════════
    console.log('─── E Release API 不可达（未监听端口）───');

    const deadPort = await new Promise((resolve) => {
        const probe = http.createServer(() => {});
        probe.listen(0, '127.0.0.1', () => {
            const p = probe.address().port;
            probe.close(() => resolve(p));
        });
    });
    const deadApi = `http://127.0.0.1:${deadPort}`;
    const dead = await runCli([
        'update', '--from-release', '--release-api', deadApi, '--release-repo', 'fake/repo',
        '--yes', '--prefix', prefixDead, '--json',
    ]);
    const deadJson = jsonOf(dead);
    check('E1 网络失败时非零退出', dead.code !== 0, `exit=${dead.code}`);
    check('E2 结构化结果 ok=false', deadJson?.ok === false, dead.stdout.slice(0, 200));
    check('E3 错误信息带完整请求 URL（含端口）',
        String(deadJson?.error || '').includes(`${deadApi}/repos/fake/repo/releases/latest`),
        String(deadJson?.error).slice(0, 300));
    check('E4 网络失败时不产生 node_modules', !exists(path.join(prefixDead, 'node_modules')));

    // ═══════════════════════════════════════════════════════════════
    // F 仓库推导不出（manifest 无 repository）
    // ═══════════════════════════════════════════════════════════════
    console.log('─── F 仓库推导不出（包内无 repository 字段）───');

    // 拷一份 cli 的 bin+lib 到临时目录，manifest 去掉 repository：
    // 这份副本的 CLI_ROOT 就是临时目录，四级解析也找不到仓库根，于是「CLI 包 + 核心包」都推不出仓库。
    const noRepoCli = path.join(tmp, 'norepo', 'cli');
    await fs.cp(path.join(CLI_ROOT, 'bin'), path.join(noRepoCli, 'bin'), { recursive: true });
    await fs.cp(path.join(CLI_ROOT, 'lib'), path.join(noRepoCli, 'lib'), { recursive: true });
    await fs.writeFile(
        path.join(noRepoCli, 'package.json'),
        JSON.stringify({ name: cliPkgJson.name, version: VERSION, type: 'module' }, null, 2),
        'utf8'
    );

    const apiBeforeNoRepo = requests.filter((r) => r.url.startsWith('/repos/')).length;
    const noRepo = await new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(noRepoCli, 'bin', '3rdloop.mjs'), 'update', '--from-release',
            '--release-api', base, '--json'], {
            cwd: ROOT,
            env: { ...process.env, ...NPM_ENV },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => { stdout += c.toString(); });
        child.stderr.on('data', (c) => { stderr += c.toString(); });
        const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
    const noRepoJson = jsonOf(noRepo);

    check('F1 仓库推导不出时非零退出', noRepo.code !== 0, `exit=${noRepo.code} stderr=${noRepo.stderr.slice(-300)}`);
    check('F2 结构化结果 ok=false', noRepoJson?.ok === false, noRepo.stdout.slice(0, 200));
    check('F3 错误信息要求显式传 --release-repo', String(noRepoJson?.error || '').includes('--release-repo'),
        String(noRepoJson?.error).slice(0, 300));
    check('F4 错误信息说明推导依据（repository 字段）', /repository/.test(String(noRepoJson?.error || '')));
    check('F5 推导失败发生在查询 Release 之前（不触网）',
        requests.filter((r) => r.url.startsWith('/repos/')).length === apiBeforeNoRepo);

    // ═══════════════════════════════════════════════════════════════
    // G 下载临时目录的清理（口径：本次运行自己报告的那个路径）
    // ═══════════════════════════════════════════════════════════════
    console.log('─── G 下载临时目录清理（成功路径）───');

    // 断言对象是 CLI 自己报出来的路径，而不是「os.tmpdir 里没有任何 3rdloop-release-*」这种
    // 全局状态——后者的假红来源（别人手动跑过 / 上一轮被 Ctrl+C 杀掉 / 并行跑多份）与本次运行无关。
    const okDir = runJson?.download?.dir;
    check('G1 安装成功的结果报告了本次运行的下载临时目录', typeof okDir === 'string' && okDir.length > 0, String(okDir));
    check('G2 清理标记 cleaned=true', runJson?.download?.cleaned === true, String(runJson?.download?.cleaned));
    check('G3 该临时目录已从磁盘删除', await dirGone(okDir), String(okDir));

    // ═══════════════════════════════════════════════════════════════
    // H 下载失败（asset 404）：仍要清掉临时目录
    // ═══════════════════════════════════════════════════════════════
    console.log('─── H asset 下载 404 ───');

    const broken = await runCli([
        'update', '--from-release', ...apiArgs('fake/broken'), '--yes', '--prefix', prefixBroken, '--json',
    ]);
    const brokenJson = jsonOf(broken);
    check('H1 下载失败时非零退出', broken.code !== 0, `exit=${broken.code}`);
    check('H2 结构化结果 ok=false', brokenJson?.ok === false, broken.stdout.slice(0, 200));
    check('H3 错误信息带下载 URL 与状态码', /HTTP 404/.test(String(brokenJson?.error || '')), String(brokenJson?.error).slice(0, 300));
    check('H4 下载失败也报告了清理结果', brokenJson?.download?.cleaned === true, JSON.stringify(brokenJson?.download));
    check('H5 下载失败后临时目录已删除', await dirGone(brokenJson?.download?.dir), String(brokenJson?.download?.dir));
    check('H6 下载失败不产生 node_modules', !exists(path.join(prefixBroken, 'node_modules')));

    // ═══════════════════════════════════════════════════════════════
    // I 安装失败（tarball 是垃圾字节）：报原始 npm 输出 + 清掉临时目录
    // ═══════════════════════════════════════════════════════════════
    console.log('─── I npm 安装失败（坏 tarball）───');

    const corrupt = await runCli([
        'update', '--from-release', ...apiArgs('fake/corrupt'), '--yes', '--prefix', prefixCorrupt, '--json',
    ]);
    const corruptJson = jsonOf(corrupt);
    check('I1 安装失败时非零退出', corrupt.code !== 0, `exit=${corrupt.code}`);
    check('I2 结构化结果 ok=false', corruptJson?.ok === false, corrupt.stdout.slice(0, 200));
    check('I3 错误信息带原始 npm 输出（含 npm 字样）', /npm/i.test(String(corruptJson?.error || '')),
        String(corruptJson?.error).slice(0, 300));
    check('I4 安装失败也报告了清理结果', corruptJson?.download?.cleaned === true, JSON.stringify(corruptJson?.download));
    check('I5 安装失败后临时目录已删除', await dirGone(corruptJson?.download?.dir), String(corruptJson?.download?.dir));
    check('I6 安装失败没有留下 CLI 包（安装未完成）',
        !exists(path.join(prefixCorrupt, 'node_modules', '@ohos-cpf', '3rdloop', 'package.json')));
} finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// ─── J 参数解析（默认 registry 路径两个既有 bug 的回归锁）─────────────────
// 早先「未知参数」判定按"是否以 -- 开头"，于是 `--registry <url>` 的取值与短开关 `-y`
// 都被当成位置参数拒绝；`--flag=value` 写法也不被接受。这组只跑纯函数，不联网不落盘。
{
    const { parseUpdateArgs } = await import(new URL('../../cli/lib/update.js', import.meta.url).href);

    const r1 = parseUpdateArgs(['--check', '--registry', 'https://mirror.example.com/']);
    check('J1 `--registry <url>` 的取值不再被当成位置参数',
        r1.unknowns.length === 0 && r1.registry === 'https://mirror.example.com/',
        JSON.stringify({ unknowns: r1.unknowns, registry: r1.registry }));

    const r2 = parseUpdateArgs(['-y']);
    check('J2 短开关 `-y` 被识别（不再报未知参数）',
        r2.unknowns.length === 0 && r2.yes === true, JSON.stringify(r2.unknowns));

    const r3 = parseUpdateArgs(['--registry=https://mirror.example.com/', '--yes']);
    check('J3 支持 `--flag=value` 写法',
        r3.unknowns.length === 0 && r3.registry === 'https://mirror.example.com/' && r3.yes === true,
        JSON.stringify({ registry: r3.registry, unknowns: r3.unknowns }));

    const r4 = parseUpdateArgs(['--from-release', 'v0.0.12', '--prefix', '/tmp/x']);
    check('J4 Release 路径的 tag 与 `--prefix` 取值仍被放行',
        r4.unknowns.length === 0 && r4.tag === 'v0.0.12' && r4.prefix === '/tmp/x', JSON.stringify(r4.unknowns));

    check('J5 裸位置参数仍被拒绝', parseUpdateArgs(['something']).unknowns.length === 1);
    check('J6 未知长选项被拒绝', parseUpdateArgs(['--bogus']).unknowns[0] === '--bogus');
    check('J7 未知短选项被拒绝', parseUpdateArgs(['-x']).unknowns[0] === '-x');
    check('J8 `--help` / `-h` 不算未知',
        parseUpdateArgs(['-h']).unknowns.length === 0 && parseUpdateArgs(['--help']).help === true);

    // J9 守的是"修复这一片时差点引入的回归"：update 必须解析 `flags.rest`（全局解析认领之后
    // 的剩余参数），而不是原始 argv —— 否则 `--json` / `--data-dir <d>` 这类全局 flag 会被
    // 子命令当成未知参数拒绝。
    const cliSrc = await fs.readFile(path.join(CLI_ROOT, 'lib', 'cli.js'), 'utf8');
    check('J9 cmdUpdate 把 `flags.rest` 交给 update.js（全局 flag 不在子命令参数里）',
        /cmdUpdateImpl\(\{[^}]*rest:\s*flags\?\.rest\s*\?\?\s*rest/.test(cliSrc),
        'cli.js 里的 cmdUpdate 未使用 flags.rest');
}

console.log(`\n${fail === 0 ? 'M13-A 全部通过' : 'M13-A 存在失败'}：${pass} 通过 / ${fail} 失败`);
if (fail > 0) console.log(`失败断言: ${failures.join(' | ')}`);
process.exit(fail === 0 ? 0 : 1);
