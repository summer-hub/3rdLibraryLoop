/**
 * M17-B profile 插件语义（DSH 式：一个 profile 一个目录，插件 = 该目录的 npm 依赖）
 *
 * 与 m15 的分工：m15 守「CLI 命令面」（list/info/开关/check/fail closed/增删的输出契约），
 * 本套件专门守 **profile 目录 + npm 生命周期**这一层的语义：
 *
 *   1. **overlayPath 落在 profile 目录内**（`<USER_PROFILES_DIR>/<profile>/profile.json`），
 *      旧式 `<profile>.json` 只读兼容且不会被写；
 *   2. **npm 生命周期是唯一安装通道**：`package.json` 脚手架 / `package-lock.json` /
 *      `node_modules` 真实目录（不是 symlink）/ `--save-exact` 生效；
 *   3. **回滚**：安装失败（registry 不可达 / 装完不是插件）后 `package.json` 与
 *      `profile.json` 逐字节不变、不留 `node_modules`；
 *   4. **engines.3rdloop 预检**：不满足 → 直接拒绝且**不下载不安装**；不声明 → warning；
 *   5. **卸载清理**：npm uninstall + profile.json 条目删除 + 空 node_modules 整棵清掉；
 *   6. **spec 分类**（本地 / git / tarball / registry / scoped 包名 + 版本）与
 *      **最小 semver 判定**（`^x.y.z` / `>=a <b` / `*`）都按 npm 语义；
 *   7. **profile 隔离**：`web` 里装的插件不出现在 `default`。
 *
 * 隔离约束与 m15 相同：所有写盘断言都在**假 HOME** 下跑（子进程传 `USERPROFILE` 与 `HOME`），
 * 真实 `~/.3lib` 与仓库 `profiles/` 首尾快照比对必须一字节不差。
 * 测试**不联网**：本地包走 `file:`；需要 registry 路径时把 `npm_config_registry`
 * 指向必失败的 `http://127.0.0.1:1`。
 */
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN = path.join(ROOT, 'cli', 'bin', '3rdloop.mjs');
const STORE = path.join(ROOT, 'cli', 'lib', 'plugin-store.js');
const CLI_VERSION = JSON.parse(fsSync.readFileSync(path.join(ROOT, 'cli', 'package.json'), 'utf8')).version;

let pass = 0;
let fail = 0;
const failures = [];

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

// ── 假 HOME ───────────────────────────────────────────────────────
const TMP_HOME = await fs.mkdtemp(path.join(os.tmpdir(), '3rdloop-m17-home-'));
const PROFILE_ROOT = path.join(TMP_HOME, '.3lib', '3rdloop', 'profiles');
const DEFAULT_DIR = path.join(PROFILE_ROOT, 'default');
const PROFILE_FILE = path.join(DEFAULT_DIR, 'profile.json');
const LEGACY_FILE = path.join(PROFILE_ROOT, 'default.json');
const PROFILE_PKG = path.join(DEFAULT_DIR, 'package.json');
const PROFILE_LOCK = path.join(DEFAULT_DIR, 'package-lock.json');
const MODULES = path.join(DEFAULT_DIR, 'node_modules');

function baseEnv(extra = {}) {
    const env = {
        ...process.env,
        HOME: TMP_HOME,
        USERPROFILE: TMP_HOME,
        LOG_FILE_ENABLED: 'false',
        DOTENV_CONFIG_QUIET: 'true',
        ...extra,
    };
    for (const key of ['3LIB_PLUGIN_PROFILE', '3LIB_PLUGINS_DIR', '3LIB_PLUGIN_DISABLE', '3LIB_ROOT', '3LIB_HOME']) {
        delete env[key];
    }
    return env;
}

function runNode(args, { env: extraEnv = {}, timeoutMs = 240000 } = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, {
            cwd: ROOT,
            env: baseEnv(extraEnv),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => {
            stdout += c.toString();
        });
        child.stderr.on('data', (c) => {
            stderr += c.toString();
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
}

const runCli = (args, opts) => runNode([BIN, ...args], opts);

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

const bytesOf = (file) => {
    try {
        return fsSync.readFileSync(file).toString('base64');
    } catch {
        return null;
    }
};
const readJson = (file) => {
    try {
        return JSON.parse(fsSync.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
};

/**
 * 造一个最小插件包（package.json + index.js + plugin.json）。
 * @param {string} dir
 * @param {{pkgName?: string, pluginName?: string, version?: string, engines?: object}} [opts]
 */
async function makePluginPackage(dir, { pkgName = 'm17-demo-plugin', pluginName = 'm17/demo', version = '1.0.0', engines } = {}) {
    await fs.mkdir(dir, { recursive: true });
    const pkg = { name: pkgName, version, main: 'index.js' };
    if (engines) pkg.engines = engines;
    await fs.writeFile(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(dir, 'index.js'), `export default { name: '${pluginName}' };\n`, 'utf8');
    await fs.writeFile(
        path.join(dir, 'plugin.json'),
        `${JSON.stringify({ name: pluginName, version, seam: 'app-logger', entry: 'index.js', dependencies: [] }, null, 2)}\n`,
        'utf8'
    );
    return dir;
}

// ── 真实目录首尾快照 ─────────────────────────────────────────────
const REAL_PROFILE_ROOT = path.join(os.homedir(), '.3lib', '3rdloop', 'profiles');
const REPO_PROFILES_DIR = path.join(ROOT, 'profiles');
const snapshotTree = (dir) => {
    try {
        const entries = fsSync.readdirSync(dir).sort();
        return entries.map((e) => {
            const p = path.join(dir, e);
            const st = fsSync.statSync(p);
            return { e, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs };
        });
    } catch {
        return null;
    }
};
const realProfilesBefore = snapshotTree(REAL_PROFILE_ROOT);
const repoProfilesBefore = snapshotTree(REPO_PROFILES_DIR);

/**
 * 探针：在假 HOME 子进程里直接调 store 的 API（`USER_PROFILES_DIR` 等是模块级常量，
 * 只能在子进程里按假 HOME 求值），结果以 JSON 打回给主进程断言。
 */
function probeSource() {
    const storeUrl = pathToFileURL(STORE).href;
    return `const store = await import('${storeUrl}');
const fixture = process.argv[2];
const out = {
    overlayDefault: store.overlayPath('default'),
    overlayWeb: store.overlayPath('web'),
    rangeOkCaret: store.satisfiesRange('${CLI_VERSION}', '^${CLI_VERSION}'),
    rangeBadCaret: store.satisfiesRange('${CLI_VERSION}', '^99.0.0'),
    rangeAnd: store.satisfiesRange('${CLI_VERSION}', '>=0.0.1 <0.1.0'),
    rangeStar: store.satisfiesRange('${CLI_VERSION}', '*'),
    state: (() => {
        const s = store.readState();
        return { profileName: s.profileName, profileDir: s.profileDir, overlay: s.overlay, roots: s.roots, profiles: s.profiles, readonly: s.readonly };
    })(),
    classifyLocal: store.classifySpec('file:' + fixture),
    classifyBare: store.classifySpec(fixture),
    classifyScoped: store.classifySpec('@scope/name@1.0.0'),
    classifyVersioned: store.classifySpec('some-plugin@^1.2.0'),
    classifyGit: store.classifySpec('github:owner/repo'),
    classifyTarball: store.classifySpec('https://example.com/p.tgz'),
};
process.stdout.write(JSON.stringify(out));
`;
}

// ═══════════════════════════════════════════════════════════════════
async function main() {
    // ── A store API 层（假 HOME 子进程）────────────────────────────
    const fixture = await makePluginPackage(path.join(TMP_HOME, 'fixture-plugin'));
    const probeFile = path.join(TMP_HOME, 'probe-store.mjs');
    await fs.writeFile(probeFile, probeSource(), 'utf8');
    const probeRun = await runNode([probeFile, fixture]);
    const probe = parseJson(probeRun.stdout);
    check('A0 store 探针跑通且输出纯 JSON', probe !== null && probeRun.code === 0, `exit=${probeRun.code} ${probeRun.stderr.slice(0, 300)}`);

    check(
        'A1 overlayPath 落在 profile 目录内（<USER_PROFILES_DIR>/<profile>/profile.json）',
        probe?.overlayDefault === path.join(PROFILE_ROOT, 'default', 'profile.json'),
        String(probe?.overlayDefault)
    );
    check(
        'A2 overlayPath 随 profile 名变化（web 在 web 目录内）',
        probe?.overlayWeb === path.join(PROFILE_ROOT, 'web', 'profile.json'),
        String(probe?.overlayWeb)
    );
    check(
        'A3 readState 带 profileName / profileDir / profiles / readonly',
        probe?.state?.profileName === 'default' &&
            probe?.state?.profileDir === DEFAULT_DIR &&
            Array.isArray(probe?.state?.profiles) &&
            probe?.state?.readonly === true,
        JSON.stringify(probe?.state && { ...probe.state, roots: undefined })
    );
    check('A4 readState 的 overlay.path 与 overlayPath() 同源', probe?.state?.overlay?.path === probe?.overlayDefault, String(probe?.state?.overlay?.path));
    check(
        'A5 readState 的扫描根含 profile 的 node_modules 位置（存在才加：此刻不存在故只有两层）',
        Array.isArray(probe?.state?.roots) && probe.state.roots.length === 2 && probe.state.roots[0].endsWith('plugins'),
        JSON.stringify(probe?.state?.roots)
    );
    check(`A6 semver: ^${CLI_VERSION} 命中当前版本`, probe?.rangeOkCaret === true);
    check('A7 semver: ^99.0.0 不命中当前版本', probe?.rangeBadCaret === false);
    check('A8 semver: 合取范围 >=0.0.1 <0.1.0 命中', probe?.rangeAnd === true);
    check('A9 semver: * 恒命中', probe?.rangeStar === true);
    check(
        'A10 spec 分类: file:<目录> → kind=local 且规范成 file:<绝对路径>',
        probe?.classifyLocal?.kind === 'local' && probe.classifyLocal.spec === `file:${fixture}`,
        JSON.stringify(probe?.classifyLocal)
    );
    check(
        'A11 spec 分类: 裸绝对路径等价 file:<绝对路径>',
        probe?.classifyBare?.kind === 'local' && probe.classifyBare.spec === `file:${fixture}`,
        JSON.stringify(probe?.classifyBare)
    );
    check(
        'A12 spec 分类: scoped 包名 @scope/name@1.0.0 解析出 name 与 version',
        probe?.classifyScoped?.kind === 'registry' && probe.classifyScoped.name === '@scope/name' && probe.classifyScoped.version === '1.0.0',
        JSON.stringify(probe?.classifyScoped)
    );
    check(
        'A13 spec 分类: 普通包名带范围 some-plugin@^1.2.0',
        probe?.classifyVersioned?.kind === 'registry' && probe.classifyVersioned.name === 'some-plugin' && probe.classifyVersioned.version === '^1.2.0',
        JSON.stringify(probe?.classifyVersioned)
    );
    check('A14 spec 分类: github:owner/repo → git', probe?.classifyGit?.kind === 'git', JSON.stringify(probe?.classifyGit));
    check(
        'A15 spec 分类: https://…tgz → tarball',
        probe?.classifyTarball?.kind === 'tarball',
        JSON.stringify(probe?.classifyTarball)
    );

    // ── B npm 生命周期 ────────────────────────────────────────────
    const add = await runCli(['plugin', 'add', `file:${fixture}`, '--json']);
    const addJson = parseJson(add.stdout);
    check('B1 add 成功（退出码 0、纯 JSON、ok=true）', add.code === 0 && addJson?.ok === true, `exit=${add.code} ${add.stderr.slice(0, 300)}`);

    const scaffold = readJson(PROFILE_PKG);
    check(
        'B2 profile 目录按需生成私有脚手架 package.json（name/private/dependencies）',
        scaffold?.name === '3rdloop-profile-default' && scaffold?.private === true && typeof scaffold?.dependencies === 'object',
        JSON.stringify(scaffold)
    );
    const lock = readJson(PROFILE_LOCK);
    check(
        'B3 package-lock.json 生成且登记了该依赖',
        lock !== null && Boolean(lock.packages?.['node_modules/m17-demo-plugin']),
        JSON.stringify(Object.keys(lock?.packages ?? {}))
    );
    check(
        'B4 依赖用 file: spec 记录（--save-exact 不引入 ^ 范围）',
        String(scaffold?.dependencies?.['m17-demo-plugin'] ?? '').startsWith('file:'),
        JSON.stringify(scaffold?.dependencies)
    );
    let installedKind = 'missing';
    try {
        installedKind = fsSync.lstatSync(path.join(MODULES, 'm17-demo-plugin')).isSymbolicLink() ? 'symlink' : 'directory';
    } catch {
        installedKind = 'missing';
    }
    check('B5 node_modules 里是真实目录（--install-links，symlink 会被内核扫描跳过）', installedKind === 'directory', installedKind);
    check('B6 npm 内部锁 node_modules/.package-lock.json 存在', fsSync.existsSync(path.join(MODULES, '.package-lock.json')));

    const stateJson = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    const entry = stateJson?.items?.find((i) => i.name === 'm17/demo');
    check(
        'B7 list --json 里该插件 installed / source=profile / enabled=true / version=1.0.0',
        entry?.installed === true && entry.source === 'profile' && entry.enabled === true && entry.version === '1.0.0',
        JSON.stringify(entry)
    );
    check(
        'B8 profile.json 里记了 plugins["m17/demo"].enabled=true',
        readJson(PROFILE_FILE)?.plugins?.['m17/demo']?.enabled === true,
        JSON.stringify(readJson(PROFILE_FILE)?.plugins)
    );

    const addAgain = await runCli(['plugin', 'add', `file:${fixture}`, '--json']);
    const depsAfterAgain = readJson(PROFILE_PKG)?.dependencies ?? {};
    check(
        'B9 同一 file: spec 重复安装是幂等的（dependencies 只有一个键）',
        addAgain.code === 0 && Object.keys(depsAfterAgain).length === 1 && depsAfterAgain['m17-demo-plugin'] !== undefined,
        `exit=${addAgain.code} deps=${JSON.stringify(depsAfterAgain)}`
    );

    // ── C profile 隔离 ───────────────────────────────────────────
    const addWeb = await runCli(['plugin', 'add', '--profile', 'web', `file:${fixture}`, '--json']);
    check('C1 add --profile web 成功', addWeb.code === 0, `exit=${addWeb.code} ${addWeb.stderr.slice(0, 300)}`);
    const webState = parseJson((await runCli(['plugin', 'list', '--json', '--profile', 'web'])).stdout);
    check(
        'C2 web profile 里能查到该插件（source=profile）',
        webState?.items?.find((i) => i.name === 'm17/demo')?.source === 'profile',
        `profile=${webState?.profile}`
    );
    check(
        'C3 每个 profile 有独立目录（web/default 的 profile.json 互不相同）',
        path.join(PROFILE_ROOT, 'web', 'profile.json') !== path.join(DEFAULT_DIR, 'profile.json') &&
            fsSync.existsSync(path.join(PROFILE_ROOT, 'web', 'profile.json')) &&
            fsSync.existsSync(PROFILE_FILE)
    );
    check(
        'C4 default 的 node_modules 与 web 的 node_modules 是两份（互不影响）',
        fsSync.existsSync(path.join(DEFAULT_DIR, 'node_modules')) && fsSync.existsSync(path.join(PROFILE_ROOT, 'web', 'node_modules'))
    );
    const removeWeb = await runCli(['plugin', 'remove', '--profile', 'web', 'm17-demo-plugin', '--json']);
    check('C5 remove --profile web 卸载成功', removeWeb.code === 0, `exit=${removeWeb.code} ${removeWeb.stdout.slice(0, 200)}`);
    check(
        'C6 卸载 web 的插件后 default 的插件仍在（隔离）',
        parseJson((await runCli(['plugin', 'list', '--json'])).stdout)?.items?.find((i) => i.name === 'm17/demo')?.installed === true &&
            !fsSync.existsSync(path.join(PROFILE_ROOT, 'web', 'node_modules'))
    );

    // ── D 回滚（registry 不可达）────────────────────────────────
    const pkgBytes = bytesOf(PROFILE_PKG);
    const overlayBytes = bytesOf(PROFILE_FILE);
    const badRegistry = await runCli(['plugin', 'add', '3rdloop-nonexistent-pkg-xyz', '--json'], {
        env: { npm_config_registry: 'http://127.0.0.1:1/' },
    });
    const badJson = parseJson(badRegistry.stdout);
    check(
        'D1 registry 不可达时 add 失败且错误消息可读（点名 registry/网络/找不到包）',
        badRegistry.code !== 0 && /registry|网络|找不到包|npm view/i.test(badJson?.error ?? ''),
        `exit=${badRegistry.code} ${String(badJson?.error ?? '').slice(0, 300)}`
    );
    check('D2 回滚后 profile 的 package.json 逐字节未变', bytesOf(PROFILE_PKG) === pkgBytes);
    check('D3 回滚后 profile.json 逐字节未变（没新增条目）', bytesOf(PROFILE_FILE) === overlayBytes);
    check('D4 回滚后 dependencies 里没有那个包', readJson(PROFILE_PKG)?.dependencies?.['3rdloop-nonexistent-pkg-xyz'] === undefined);

    // ── E 回滚（装完发现不是插件）──────────────────────────────
    const notAPlugin = path.join(TMP_HOME, 'not-a-plugin');
    await fs.mkdir(notAPlugin, { recursive: true });
    await fs.writeFile(path.join(notAPlugin, 'package.json'), `${JSON.stringify({ name: 'm17-not-a-plugin', version: '1.0.0' }, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(notAPlugin, 'index.js'), 'export default {};\n', 'utf8');
    const badPkg = await runCli(['plugin', 'add', `file:${notAPlugin}`, '--json']);
    check(
        'E1 包内缺 plugin.json → 安装被复查拒绝且错误点名 plugin.json',
        badPkg.code !== 0 && /plugin\.json/.test(parseJson(badPkg.stdout)?.error ?? ''),
        `exit=${badPkg.code} ${String(parseJson(badPkg.stdout)?.error ?? '').slice(0, 300)}`
    );
    check(
        'E2 复查失败后 npm 装进来的包目录已被清掉',
        !fsSync.existsSync(path.join(MODULES, 'm17-not-a-plugin')),
        path.join(MODULES, 'm17-not-a-plugin')
    );
    check('E3 复查失败后 package.json 逐字节未变', bytesOf(PROFILE_PKG) === pkgBytes);

    // ── F engines.3rdloop 预检 ──────────────────────────────────
    const incompatible = await makePluginPackage(path.join(TMP_HOME, 'fixture-incompatible'), {
        pkgName: 'm17-incompatible',
        pluginName: 'm17/incompatible',
        engines: { '3rdloop': '^99.0.0' },
    });
    const reject = await runCli(['plugin', 'add', `file:${incompatible}`, '--json']);
    const rejectError = String(parseJson(reject.stdout)?.error ?? '');
    check(
        'F1 engines.3rdloop=^99.0.0 → 拒绝安装且消息含要求范围与当前版本',
        reject.code !== 0 && rejectError.includes('^99.0.0') && rejectError.includes(CLI_VERSION),
        `exit=${reject.code} ${rejectError.slice(0, 300)}`
    );
    check('F2 预检拒绝时没有产生 node_modules（不下载不安装）', !fsSync.existsSync(MODULES) || !fsSync.readdirSync(MODULES).includes('m17-incompatible'));
    check('F3 预检拒绝后 dependencies 未变', readJson(PROFILE_PKG)?.dependencies?.['m17-incompatible'] === undefined);

    const compatible = await makePluginPackage(path.join(TMP_HOME, 'fixture-compatible'), {
        pkgName: 'm17-compatible',
        pluginName: 'm17/compatible',
        engines: { '3rdloop': `^${CLI_VERSION}` },
    });
    const passAdd = await runCli(['plugin', 'add', `file:${compatible}`, '--json']);
    check(
        `F4 engines.3rdloop=^${CLI_VERSION} → 预检通过并安装成功`,
        passAdd.code === 0 && parseJson(passAdd.stdout)?.pluginName === 'm17/compatible',
        `exit=${passAdd.code} ${String(parseJson(passAdd.stdout)?.error ?? '').slice(0, 300)}`
    );
    check(
        'F5 未声明 engines.3rdloop 的包会给 warning（而不是静默）',
        Array.isArray(addJson?.warnings) && addJson.warnings.some((w) => w.includes('engines.3rdloop')),
        JSON.stringify(addJson?.warnings)
    );

    // ── G 卸载清理 ──────────────────────────────────────────────
    const remove = await runCli(['plugin', 'remove', 'm17-compatible', '--json']);
    const removeJson = parseJson(remove.stdout);
    check('G1 remove <npm 包名> 成功且报出 packageName', remove.code === 0 && removeJson?.packageName === 'm17-compatible', `exit=${remove.code} ${remove.stdout.slice(0, 200)}`);
    check('G2 卸载后 profile.json 里没有该条目', readJson(PROFILE_FILE)?.plugins?.['m17/compatible'] === undefined, JSON.stringify(readJson(PROFILE_FILE)?.plugins));
    check('G3 卸载后 package.json 的 dependencies 里没有它', readJson(PROFILE_PKG)?.dependencies?.['m17-compatible'] === undefined);
    check('G4 卸载后 npm 的包目录消失', !fsSync.existsSync(path.join(MODULES, 'm17-compatible')));

    const removeLast = await runCli(['plugin', 'remove', 'm17-demo-plugin']);
    check(
        'G5 卸载最后一个 profile 插件后 node_modules 整棵被清掉',
        removeLast.code === 0 && !fsSync.existsSync(MODULES),
        `exit=${removeLast.code} modules=${fsSync.existsSync(MODULES)}`
    );
    check(
        'G6 卸载后 profile.json 与 package.json 仍在（profile 目录本身不删）',
        fsSync.existsSync(PROFILE_FILE) && fsSync.existsSync(PROFILE_PKG)
    );
    const removeBuiltin = await runCli(['plugin', 'remove', 'engines/brain']);
    check('G7 remove 内置插件 → 拒绝并点名「内置」', removeBuiltin.code !== 0 && removeBuiltin.stderr.includes('内置'), `exit=${removeBuiltin.code}`);
    const removeUnknown = await runCli(['plugin', 'remove', 'no/such-plugin']);
    check('G8 remove 未知插件 → 拒绝并提示未知插件', removeUnknown.code !== 0 && removeUnknown.stderr.includes('未知插件'), `exit=${removeUnknown.code}`);

    // ── H 旧式单文件 overlay 只读兼容 + 迁移 ────────────────────
    await fs.rm(PROFILE_FILE, { force: true });
    await fs.rm(PROFILE_LOCK, { force: true });
    await fs.writeFile(
        LEGACY_FILE,
        `${JSON.stringify({ plugins: { 'llm/dashscope': { enabled: false }, 'storage/core': { enabled: true } } }, null, 2)}\n`,
        'utf8'
    );
    const legacyBytes = bytesOf(LEGACY_FILE);
    const legacyList = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    check(
        'H1 只有旧式 <profile>.json 时仍可读（llm/dashscope 显示禁用）',
        legacyList?.items?.find((i) => i.name === 'llm/dashscope')?.enabled === false,
        JSON.stringify(legacyList?.items?.find((i) => i.name === 'llm/dashscope'))
    );
    check('H2 旧式布局下 overlay.path 仍报目录式新位置（写目标不漂移）', legacyList?.overlay?.path === PROFILE_FILE, String(legacyList?.overlay?.path));

    const enableLegacy = await runCli(['plugin', 'enable', 'engines/brain']);
    const migrated = readJson(PROFILE_FILE);
    check(
        'H3 enable 写目录式新位置（旧式文件不被写）',
        enableLegacy.code === 0 && migrated !== null && fsSync.existsSync(PROFILE_FILE),
        `exit=${enableLegacy.code}`
    );
    check(
        'H4 首次写盘把旧式文件里的开关一起迁移过来（三个条目都在）',
        migrated?.plugins?.['engines/brain']?.enabled === true &&
            migrated?.plugins?.['llm/dashscope']?.enabled === false &&
            migrated?.plugins?.['storage/core']?.enabled === true,
        JSON.stringify(migrated?.plugins)
    );
    check('H5 旧式文件本身一字节未改', bytesOf(LEGACY_FILE) === legacyBytes);

    // ── I 隔离：真实用户目录与仓库 profiles 一字节未动 ─────────
    check(
        'I1 真实 ~/.3lib/3rdloop/profiles 目录树未变',
        JSON.stringify(snapshotTree(REAL_PROFILE_ROOT)) === JSON.stringify(realProfilesBefore)
    );
    check('I2 仓库 profiles/ 目录树未变（没有新增 profile 文件）', JSON.stringify(snapshotTree(REPO_PROFILES_DIR)) === JSON.stringify(repoProfilesBefore));
}

try {
    await main();
} catch (err) {
    check('套件执行未意外抛错', false, err?.message ?? String(err));
} finally {
    await fs.rm(TMP_HOME, { recursive: true, force: true, maxRetries: 10 }).catch(() => {});
}

console.log(`\n共 ${pass + fail} 条断言，失败 ${fail} 条`);
if (fail > 0) {
    console.log('失败项：');
    for (const name of failures) console.log(`  - ${name}`);
}
process.exit(fail === 0 ? 0 : 1);
