/**
 * M15-A CLI 插件管理（`3rdloop plugin list|info|enable|disable|check|path|add|remove`）
 *
 * 本套件锁的契约（DSH 式 profile 模型）：
 *   1. **一个 profile 一个目录**：`~/.3lib/3rdloop/profiles/<profile>/`；插件是该目录的
 *      **npm 依赖**（装/卸走 `npm install/uninstall`），启用状态记在同目录的 `profile.json`。
 *   2. **overlay 是唯一写盘目标**——开关落到 `<profileDir>/profile.json`，
 *      包内 `profiles/*.json` 一个字节都不能被改（随包发布、下次 update 会覆盖）。
 *   3. **CLI 开关真的能拔掉插件**——不是"文件里写了个 false"，而是装配点 `buildApp`
 *      取 `engine-*` 接缝时真的 fail closed（子进程真跑 host.load() + buildApp()）。
 *   4. **安装失败必须回滚**——`package.json` 逐字节不变、`profile.json` 不多出条目、
 *      不留 `node_modules` 残骸；**engines 预检不通过时连下载都不做**。
 *   5. **`--profile` 隔离**：装进 `web` 的插件不能出现在 `default` 的列表里。
 *   6. **--json 通道纯净**：stdout 只能是 JSON（脚本消费方的前提）。
 *
 * 隔离约束（不可协商）：所有会写盘的断言都通过子进程把 `USERPROFILE`（Windows 的
 * `os.homedir()` 依据）与 `HOME` 指向 `os.tmpdir()` 下的 mkdtemp 目录，结束时整棵删除；
 * 真实 `~/.3lib/3rdloop/profiles` 与包内 `profiles/` 都在首尾各取一次快照比对。
 * 内核的 `USER_PROFILES_DIR` / `USER_PLUGINS_DIR` 是**模块级常量**（import 时算一次），
 * 所以假 HOME 必须由子进程启动时带入——这也是本套件处处起子进程而不直接 import 命令模块的原因。
 *
 * 测试**不联网**：安装全部走 `file:` 本地包；需要 registry 路径时把
 * `npm_config_registry` 指向必失败的 `http://127.0.0.1:1`。
 */
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN = path.join(ROOT, 'cli', 'bin', '3rdloop.mjs');
const CLI_VERSION = JSON.parse(fsSync.readFileSync(path.join(ROOT, 'cli', 'package.json'), 'utf8')).version;

/** 已安装插件（14 个）：与 data 事实一致——`llm/mock` 已装但被 default profile 显式禁用 */
const INSTALLED = [
    'agent/core',
    'cli/deveco-code',
    'cli/opencode',
    'distributed/core',
    'engines/brain',
    'engines/knowledge',
    'engines/loopengine',
    'engines/orchestrator',
    'engines/testcheck',
    'llm/dashscope',
    'llm/mock',
    'stats/core',
    'storage/core',
    'util/logger',
];
/** profile 提到但未安装（2 个）：必须出现在 list 里，否则用户以为 profile 写错了 */
const MISSING = ['http/server', 'skills/directory'];

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

// ── 假 HOME（所有写盘断言的落点）──────────────────────────────────
const TMP_HOME = await fs.mkdtemp(path.join(os.tmpdir(), '3rdloop-m15-home-'));
const PROFILE_ROOT = path.join(TMP_HOME, '.3lib', '3rdloop', 'profiles');
const PROFILE_DIR = path.join(PROFILE_ROOT, 'default');
/** 目录式 profile 文件（**写目标**） */
const OVERLAY_FILE = path.join(PROFILE_DIR, 'profile.json');
/** 旧式单文件 overlay（只读兼容） */
const LEGACY_OVERLAY = path.join(PROFILE_ROOT, 'default.json');
const PROFILE_PKG = path.join(PROFILE_DIR, 'package.json');
const PROFILE_LOCK = path.join(PROFILE_DIR, 'package-lock.json');
const PROFILE_MODULES = path.join(PROFILE_DIR, 'node_modules');

/** 子进程环境：把「用户目录」整体搬到临时目录，并清掉会改写 profile/插件根的外部变量 */
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

/** 起一个子进程跑 node（CLI 或探针都一样），收集 stdout/stderr 与退出码 */
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

/** 严格 JSON 解析：解析失败返回 null（用来证明 stdout 是**纯** JSON） */
function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function readProfileJson() {
    return JSON.parse(await fs.readFile(OVERLAY_FILE, 'utf8'));
}
async function writeProfileJson(plugins) {
    await fs.mkdir(PROFILE_DIR, { recursive: true });
    await fs.writeFile(OVERLAY_FILE, `${JSON.stringify({ plugins }, null, 2)}\n`, 'utf8');
}
async function clearProfileJson() {
    await fs.rm(OVERLAY_FILE, { force: true });
}
const overlayExists = () => fsSync.existsSync(OVERLAY_FILE);

/** 文件快照（用于"没被改过"的断言）：不存在也如实记录 */
function snapshot(file) {
    try {
        const st = fsSync.statSync(file);
        return { exists: true, size: st.size, mtimeMs: st.mtimeMs, text: fsSync.readFileSync(file, 'utf8') };
    } catch {
        return { exists: false };
    }
}
const sameSnapshot = (a, b) => a.exists === b.exists && a.size === b.size && a.mtimeMs === b.mtimeMs && a.text === b.text;
const bytesOf = (file) => {
    try {
        return fsSync.readFileSync(file).toString('base64');
    } catch {
        return null;
    }
};

/**
 * 造一个最小插件包（目录含 package.json + index.js + plugin.json）。
 *
 * 为什么必须有 `package.json`：插件现在是 profile 的 **npm 依赖**，没有它 npm 装不进去
 * （`plugin add` 会直接报「本地目录不是 npm 包」）。
 *
 * @param {string} dir
 * @param {{pkgName?: string, pluginName?: string, version?: string, engines?: object}} [opts]
 */
async function makePluginPackage(dir, { pkgName = 'm15-demo-plugin', pluginName = 'm15/demo', version = '1.0.0', engines } = {}) {
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

// ── 真实目录 / 包内 profile 的首尾快照 ────────────────────────────
const REAL_PROFILE_DIR = path.join(os.homedir(), '.3lib', '3rdloop', 'profiles');
const REAL_OVERLAY = path.join(REAL_PROFILE_DIR, 'default', 'profile.json');
const REAL_LEGACY = path.join(REAL_PROFILE_DIR, 'default.json');
const REPO_PROFILES_DIR = path.join(ROOT, 'profiles');
const REPO_DEFAULT_PROFILE = path.join(REPO_PROFILES_DIR, 'default.json');
const realOverlayBefore = snapshot(REAL_OVERLAY);
const realLegacyBefore = snapshot(REAL_LEGACY);
const realProfilesListBefore = fsSync.existsSync(REAL_PROFILE_DIR) ? fsSync.readdirSync(REAL_PROFILE_DIR).sort() : [];
const repoDefaultBefore = snapshot(REPO_DEFAULT_PROFILE);
const repoProfilesListBefore = fsSync.existsSync(REPO_PROFILES_DIR) ? fsSync.readdirSync(REPO_PROFILES_DIR).sort() : [];

// ── fail closed 探针：真跑 host.load() + buildApp() ───────────────
const PROBE = path.join(TMP_HOME, 'probe-buildapp.mjs');
const PROBE_DATA = path.join(TMP_HOME, 'probe-db');

/** 探针源码：import 仓库真模块；成功打印 OK，fail closed 打印 FAIL-CLOSED + 消息 */
function probeSource() {
    const coreUrl = pathToFileURL(path.join(ROOT, 'core', 'index.js')).href;
    const buildAppUrl = pathToFileURL(path.join(ROOT, 'Server', 'composition', 'buildApp.js')).href;
    return `import { createDefaultHost } from '${coreUrl}';
import { buildApp } from '${buildAppUrl}';

const host = createDefaultHost();
await host.load();
try {
    await buildApp({
        host,
        storageOptions: { rootDir: process.argv[2] },
        attachCliArchive: false,
        sseHub: null,
        knowledgeManager: null,
    });
    process.stdout.write('OK: buildApp 成功\\n');
} catch (err) {
    process.stdout.write('FAIL-CLOSED: ' + err.message + '\\n');
}
await host.dispose().catch(() => {});
`;
}

// ═══════════════════════════════════════════════════════════════════
async function main() {
    await fs.writeFile(PROBE, probeSource(), 'utf8');

    // ── A `plugin list`（人读表格）───────────────────────────────
    const list = await runCli(['plugin', 'list']);
    check('A1 plugin list 退出码 0', list.code === 0, `exit=${list.code} stderr=${list.stderr.slice(0, 300)}`);

    const missingNames = INSTALLED.filter((n) => !list.stdout.includes(n));
    check('A2 list 表格含全部 14 个已安装插件', missingNames.length === 0, `缺失: ${missingNames.join(', ')}`);

    const missingRows = MISSING.filter((n) => !list.stdout.includes(n));
    const missingLabeled = MISSING.every((n) => (list.stdout.split('\n').find((l) => l.includes(n)) ?? '').includes('未安装'));
    check('A3 list 含 2 个未安装条目且标注「未安装」', missingRows.length === 0 && missingLabeled, `缺失: ${missingRows.join(', ')}`);

    const mockRow = list.stdout.split('\n').find((l) => l.includes('llm/mock')) ?? '';
    check('A4 已装但被 profile 禁用的 llm/mock 显示「禁用」', mockRow.includes('禁用'), mockRow.trim());

    check(
        'A5 表格五列齐全（插件名/接缝/状态/来源/被依赖）',
        ['插件名', '接缝', '状态', '来源', '被依赖'].every((h) => list.stdout.includes(h))
    );
    check(
        'A6 汇总行报出「已安装 14」「未安装 2」',
        list.stdout.includes('已安装 14') && list.stdout.includes('未安装 2'),
        list.stdout.split('\n').find((l) => l.includes('已安装')) ?? ''
    );
    check('A7 人读输出含「profile 目录」一行且指向假 HOME', list.stdout.includes('profile 目录') && list.stdout.includes(PROFILE_DIR), list.stdout.slice(0, 200));

    // ── B `plugin list --json`（纯 JSON + 字段齐全）───────────────
    const listJsonRun = await runCli(['plugin', 'list', '--json']);
    const listJson = parseJson(listJsonRun.stdout);
    check('B1 plugin list --json 退出码 0', listJsonRun.code === 0, `exit=${listJsonRun.code}`);
    check('B2 --json 的 stdout 是纯 JSON（无表格/日志混入）', listJson !== null, listJsonRun.stdout.slice(0, 300));
    check(
        'B3 条目计数 16 = 已安装 14 + 未安装 2',
        listJson?.total === 16 && listJson?.installed === 14 && listJson?.missing === 2,
        `total=${listJson?.total} installed=${listJson?.installed} missing=${listJson?.missing}`
    );

    const FIELDS = [
        'name',
        'version',
        'seam',
        'entry',
        'installed',
        'dir',
        'source',
        'enabled',
        'required',
        'reason',
        'options',
        'loaded',
        'dependencies',
        'dependents',
    ];
    const thin = (listJson?.items ?? []).filter((it) => FIELDS.some((f) => !(f in it))).map((it) => it.name);
    check('B4 每条条目字段齐全（14 个字段）', (listJson?.items ?? []).length === 16 && thin.length === 0, `缺字段: ${thin.join(', ')}`);

    const aiCli = listJson?.seams?.['ai-cli'];
    check(
        'B5 接缝 ai-cli 有 2 个提供方',
        aiCli?.providers?.length === 2 && aiCli.providers.includes('cli/opencode') && aiCli.providers.includes('cli/deveco-code'),
        JSON.stringify(aiCli)
    );
    check(
        'B6 overlay.path 指向 profile 目录内的 profile.json（目录式布局）',
        listJson?.overlay?.path === OVERLAY_FILE && listJson?.overlay?.exists === false,
        JSON.stringify(listJson?.overlay)
    );
    check('B7 --json 带 profileDir 且指向假 HOME 的 profile 目录', listJson?.profileDir === PROFILE_DIR, String(listJson?.profileDir));
    check(
        'B8 --json 带 profiles 列表（含 default 与包内 mock-llm）',
        Array.isArray(listJson?.profiles) && listJson.profiles.includes('default') && listJson.profiles.includes('mock-llm'),
        JSON.stringify(listJson?.profiles)
    );

    // ── C `plugin info` ──────────────────────────────────────────
    const info = await runCli(['plugin', 'info', 'engines/brain']);
    check('C1 plugin info engines/brain 退出码 0 且报出接缝', info.code === 0 && info.stdout.includes('engine-brain'), info.stderr.slice(0, 300));

    const infoJsonRun = await runCli(['plugin', 'info', 'engines/brain', '--json']);
    const infoJson = parseJson(infoJsonRun.stdout);
    check(
        'C2 info --json 的 seam === engine-brain（纯 JSON）',
        infoJson !== null && infoJson.plugin?.seam === 'engine-brain',
        infoJsonRun.stdout.slice(0, 200)
    );
    check(
        'C3 info 给出禁用后果（提到接缝 engine-brain 会失去提供方）',
        Array.isArray(infoJson?.disableImpact) && infoJson.disableImpact.some((t) => t.includes('engine-brain')),
        JSON.stringify(infoJson?.disableImpact)
    );

    const infoUnknown = await runCli(['plugin', 'info', 'no/such-plugin']);
    check(
        'C4 info 未知插件 → 退出码非 0 且提示未知插件',
        infoUnknown.code !== 0 && infoUnknown.stderr.includes('未知插件'),
        `exit=${infoUnknown.code}`
    );

    // ── I 用法 / 帮助（放在任何写盘之前，验证 --help 不写盘）──────
    const noSub = await runCli(['plugin']);
    check('I1 无子命令 → 退出码非 0 且打用法到 stderr', noSub.code !== 0 && noSub.stderr.includes('用法:'), `exit=${noSub.code}`);

    const bogus = await runCli(['plugin', 'bogus']);
    check(
        'I2 未知子命令 → 退出码非 0 且列出可用子命令',
        bogus.code !== 0 && bogus.stderr.includes('未知 plugin 子命令'),
        `exit=${bogus.code}`
    );

    const help = await runCli(['plugin', '--help']);
    check('I3 --help 退出码 0 且打印完整用法', help.code === 0 && help.stdout.includes('用法:'), `exit=${help.code}`);
    check('I4 --help 不写盘（profile.json 仍不存在）', !overlayExists());
    check('I5 用法写明 add 的语义是「包 spec」', help.stdout.includes('包 spec'), help.stdout.slice(0, 200));

    // ── I6/I7 `plugin path`（profile 目录 + overlay 路径，只读）──
    const pathRun = await runCli(['plugin', 'path']);
    check(
        'I6 plugin path 打印 profile 名、profile 目录与 overlay 路径',
        pathRun.code === 0 &&
            pathRun.stdout.includes('profile: default') &&
            pathRun.stdout.includes(`profile 目录: ${PROFILE_DIR}`) &&
            pathRun.stdout.includes(OVERLAY_FILE),
        `exit=${pathRun.code} ${pathRun.stdout.slice(0, 300)}`
    );
    const pathJson = parseJson((await runCli(['plugin', 'path', '--json'])).stdout);
    check(
        'I7 path --json 的 overlay.path / profileDir 都落在假 HOME 的 profile 目录',
        pathJson?.profile === 'default' && pathJson?.overlay?.path === OVERLAY_FILE && pathJson?.profileDir === PROFILE_DIR,
        JSON.stringify(pathJson?.overlay)
    );

    // ── D disable / enable 落盘（假 HOME）───────────────────────
    const disable = await runCli(['plugin', 'disable', 'engines/brain']);
    check(
        'D1 disable engines/brain 成功且打印 overlay 路径与重启提示',
        disable.code === 0 && disable.stdout.includes('已写入') && disable.stdout.includes('重启 3rdloop serve 后生效'),
        `exit=${disable.code} ${disable.stderr.slice(0, 200)}`
    );
    check('D2 profile.json 真的落到假 HOME 的 profile 目录', overlayExists(), OVERLAY_FILE);

    const overlayAfterDisable = overlayExists() ? await readProfileJson() : null;
    check(
        'D3 profile.json 形状为 {"plugins":{"engines/brain":{"enabled":false}}}',
        JSON.stringify(overlayAfterDisable?.plugins) === JSON.stringify({ 'engines/brain': { enabled: false } }),
        JSON.stringify(overlayAfterDisable?.plugins)
    );
    check('D4 旧式单文件 overlay（<profile>.json）没有被写入', !fsSync.existsSync(LEGACY_OVERLAY), LEGACY_OVERLAY);

    const afterDisableJson = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    const brainOff = afterDisableJson?.items?.find((it) => it.name === 'engines/brain');
    check(
        'D5 list --json 显示 engines/brain 已禁用',
        brainOff?.enabled === false && brainOff?.status === 'disabled' && typeof brainOff?.reason === 'string' && brainOff.reason.length > 0,
        JSON.stringify(brainOff)
    );

    const enable = await runCli(['plugin', 'enable', 'engines/brain']);
    check('D6 enable engines/brain 退出码 0', enable.code === 0, `exit=${enable.code} ${enable.stderr.slice(0, 200)}`);
    const overlayAfterEnable = overlayExists() ? await readProfileJson() : null;
    check('D7 enable 后 profile.json 里 enabled 变回 true', overlayAfterEnable?.plugins?.['engines/brain']?.enabled === true, JSON.stringify(overlayAfterEnable?.plugins));

    const afterEnableJson = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    check(
        'D8 list --json 显示 engines/brain 恢复启用',
        afterEnableJson?.items?.find((it) => it.name === 'engines/brain')?.enabled === true
    );

    // ── E 拒绝路径（被依赖 / 未知插件）──────────────────────────
    await clearProfileJson();
    const dependReject = await runCli(['plugin', 'disable', 'storage/core']);
    check('E1 disable storage/core 被拒绝（非 0 退出）', dependReject.code !== 0, `exit=${dependReject.code}`);
    check(
        'E2 拒绝信息含依赖者名字 cli/opencode',
        dependReject.stderr.includes('cli/opencode'),
        dependReject.stderr.slice(0, 300)
    );
    check('E3 被拒绝时不写盘（profile.json 未创建）', !overlayExists());

    const unknownToggle = await runCli(['plugin', 'disable', 'no/such-plugin']);
    check(
        'E4 disable 不存在的插件 → 非 0 且提示未知插件',
        unknownToggle.code !== 0 && unknownToggle.stderr.includes('未知插件'),
        `exit=${unknownToggle.code}`
    );

    const forced = await runCli(['plugin', 'disable', 'storage/core', '--force']);
    const overlayForced = overlayExists() ? await readProfileJson() : null;
    check(
        'E5 --force 越过依赖检查并写盘',
        forced.code === 0 && overlayForced?.plugins?.['storage/core']?.enabled === false,
        `exit=${forced.code} ${JSON.stringify(overlayForced?.plugins)}`
    );

    const restoreStorage = await runCli(['plugin', 'enable', 'storage/core']);
    const overlayRestored = overlayExists() ? await readProfileJson() : null;
    check(
        'E6 enable storage/core 恢复启用',
        restoreStorage.code === 0 && overlayRestored?.plugins?.['storage/core']?.enabled === true,
        `exit=${restoreStorage.code}`
    );

    // ── F `plugin check` ────────────────────────────────────────
    await clearProfileJson();
    const checkOk = await runCli(['plugin', 'check']);
    check('F1 正常状态 check 退出码 0', checkOk.code === 0, `exit=${checkOk.code} ${checkOk.stdout.slice(0, 300)}`);

    const checkOkJsonRun = await runCli(['plugin', 'check', '--json']);
    const checkOkJson = parseJson(checkOkJsonRun.stdout);
    check(
        'F2 check --json 为纯 JSON 且 ok=true、errors 为空',
        checkOkJson !== null && checkOkJson.ok === true && Array.isArray(checkOkJson.errors) && checkOkJson.errors.length === 0,
        checkOkJsonRun.stdout.slice(0, 300)
    );

    // 构造「依赖被禁」的 profile：storage/core 被禁后 cli/opencode 的依赖缺失
    await writeProfileJson({ 'storage/core': { enabled: false } });
    const checkBad = await runCli(['plugin', 'check']);
    check('F3 依赖被禁时 check 退出码 1', checkBad.code === 1, `exit=${checkBad.code}`);

    const checkBadJsonRun = await runCli(['plugin', 'check', '--json']);
    const checkBadJson = parseJson(checkBadJsonRun.stdout);
    const depError = (checkBadJson?.errors ?? []).find((e) => e.includes('storage/core') && e.includes('cli/opencode'));
    check(
        'F4 check --json 报出「cli/opencode 依赖 storage/core 被禁用」',
        checkBadJson?.ok === false && typeof depError === 'string',
        JSON.stringify(checkBadJson?.errors)
    );

    await clearProfileJson();
    const checkRecovered = await runCli(['plugin', 'check']);
    check('F5 恢复 profile 后 check 重新 ok', checkRecovered.code === 0, `exit=${checkRecovered.code}`);

    // ── G 真跑一次 fail closed（装配点 buildApp）────────────────
    await writeProfileJson({ 'engines/brain': { enabled: false } });
    const probeBroken = await runNode([PROBE, PROBE_DATA], { timeoutMs: 240000 });
    check(
        'G1 禁用 engines/brain 后 buildApp fail closed 且消息含「缺失接缝: engine-brain」',
        probeBroken.stdout.includes('FAIL-CLOSED') && probeBroken.stdout.includes('缺失接缝: engine-brain'),
        `exit=${probeBroken.code} ${(probeBroken.stdout + probeBroken.stderr).slice(0, 400)}`
    );
    check('G2 禁用状态下装配确实没有成功', !probeBroken.stdout.includes('OK: buildApp 成功'));
    check('G3 探针进程本身没有崩溃（exit 0）', probeBroken.code === 0, `exit=${probeBroken.code} ${probeBroken.stderr.slice(0, 300)}`);

    await clearProfileJson();
    const probeHealthy = await runNode([PROBE, PROBE_DATA], { timeoutMs: 240000 });
    check(
        'G4 恢复 profile 后同一个 buildApp 调用成功（对照组）',
        probeHealthy.code === 0 && probeHealthy.stdout.includes('OK: buildApp 成功'),
        `exit=${probeHealthy.code} ${(probeHealthy.stdout + probeHealthy.stderr).slice(0, 400)}`
    );

    // ── H `plugin add` / `plugin remove`（DSH 式 npm 安装）──────
    const fixture = await makePluginPackage(path.join(TMP_HOME, 'fixture-plugin'));

    const add = await runCli(['plugin', 'add', `file:${fixture}`, '--json']);
    const addedJson = parseJson(add.stdout);
    check('H1 add file:<目录> 退出码 0 且 --json 纯净', add.code === 0 && addedJson?.ok === true, `exit=${add.code} ${add.stderr.slice(0, 300)}`);
    check(
        'H2 add 报出的注册名是 package.json 的 name（不是 file: 路径）',
        addedJson?.name === 'm15-demo-plugin' && addedJson?.pluginName === 'm15/demo' && addedJson?.spec.startsWith('file:'),
        JSON.stringify({ name: addedJson?.name, pluginName: addedJson?.pluginName, spec: addedJson?.spec })
    );
    check(
        'H3 add 报出 source=profile / enabled=true / requiresRestart=true',
        addedJson?.source === 'profile' && addedJson?.enabled === true && addedJson?.requiresRestart === true,
        JSON.stringify(addedJson)
    );
    check('H4 profile 目录出现 package.json', fsSync.existsSync(PROFILE_PKG), PROFILE_PKG);
    check('H5 profile 目录出现 package-lock.json', fsSync.existsSync(PROFILE_LOCK), PROFILE_LOCK);
    check('H6 profile 目录出现 node_modules', fsSync.existsSync(PROFILE_MODULES), PROFILE_MODULES);
    const installedDir = path.join(PROFILE_MODULES, 'm15-demo-plugin');
    let linkType = 'missing';
    try {
        linkType = fsSync.lstatSync(installedDir).isSymbolicLink() ? 'symlink' : 'directory';
    } catch {
        linkType = 'missing';
    }
    check(
        'H7 装进去的是真实目录而非 symlink（--install-links，否则内核扫描会跳过）',
        linkType === 'directory',
        `node_modules/m15-demo-plugin = ${linkType}`
    );

    const afterAddJson = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    const added = afterAddJson?.items?.find((it) => it.name === 'm15/demo');
    check(
        'H8 list --json 能看到该插件且 source=profile、installed、enabled',
        added?.installed === true && added?.source === 'profile' && added?.enabled === true,
        JSON.stringify(added)
    );
    const profileAfterAdd = await readProfileJson();
    check(
        'H9 profile.json 里有该插件且 enabled=true',
        profileAfterAdd?.plugins?.['m15/demo']?.enabled === true,
        JSON.stringify(profileAfterAdd?.plugins)
    );
    const depsAfterAdd = JSON.parse(fsSync.readFileSync(PROFILE_PKG, 'utf8')).dependencies ?? {};
    check(
        'H10 profile 的 package.json 把插件记成了依赖（file: 规范成绝对路径）',
        typeof depsAfterAdd['m15-demo-plugin'] === 'string' && depsAfterAdd['m15-demo-plugin'].startsWith('file:'),
        JSON.stringify(depsAfterAdd)
    );

    const remove = await runCli(['plugin', 'remove', 'm15-demo-plugin', '--json']);
    const removedJson = parseJson(remove.stdout);
    check('H11 remove <npm 包名> 退出码 0 且报出 packageName', remove.code === 0 && removedJson?.packageName === 'm15-demo-plugin', `exit=${remove.code} ${remove.stdout.slice(0, 200)}`);
    check('H12 remove 后 node_modules 被清掉', !fsSync.existsSync(PROFILE_MODULES), PROFILE_MODULES);
    const profileAfterRemove = await readProfileJson();
    check(
        'H13 remove 后 profile.json 不再有该条目',
        profileAfterRemove?.plugins?.['m15/demo'] === undefined,
        JSON.stringify(profileAfterRemove?.plugins)
    );
    const depsAfterRemove = JSON.parse(fsSync.readFileSync(PROFILE_PKG, 'utf8')).dependencies ?? {};
    check('H14 remove 后 package.json 的依赖里没有它', depsAfterRemove['m15-demo-plugin'] === undefined, JSON.stringify(depsAfterRemove));

    // ── J 回滚：安装注定失败时 profile 必须逐字节原样 ───────────
    const pkgBytesBefore = bytesOf(PROFILE_PKG);
    const overlayBytesBefore = bytesOf(OVERLAY_FILE);

    const badRegistry = await runCli(['plugin', 'add', '3rdloop-nonexistent-pkg-xyz', '--json'], {
        env: { npm_config_registry: 'http://127.0.0.1:1/' },
    });
    const badRegistryJson = parseJson(badRegistry.stdout);
    check(
        'J1 registry 不可达时 add 非 0 且错误消息可读（点名 registry/网络）',
        badRegistry.code !== 0 && /registry|网络|npm view/i.test(badRegistryJson?.error ?? ''),
        `exit=${badRegistry.code} ${String(badRegistryJson?.error ?? badRegistry.stderr).slice(0, 300)}`
    );
    check('J2 失败后 package.json 逐字节未变', bytesOf(PROFILE_PKG) === pkgBytesBefore);
    check('J3 失败后 profile.json 逐字节未变（没新增条目）', bytesOf(OVERLAY_FILE) === overlayBytesBefore);
    check('J4 失败后没有留下 node_modules', !fsSync.existsSync(PROFILE_MODULES), PROFILE_MODULES);

    // 本地包装得成功、但复查会失败（包内没有 plugin.json）→ 必须回滚已装内容
    const notAPlugin = path.join(TMP_HOME, 'not-a-plugin');
    await fs.mkdir(notAPlugin, { recursive: true });
    await fs.writeFile(path.join(notAPlugin, 'package.json'), `${JSON.stringify({ name: 'm15-not-a-plugin', version: '1.0.0' }, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(notAPlugin, 'index.js'), 'export default {};\n', 'utf8');

    const badPackage = await runCli(['plugin', 'add', `file:${notAPlugin}`, '--json']);
    const badPackageJson = parseJson(badPackage.stdout);
    check(
        'J5 装完复查失败（缺 plugin.json）→ 非 0 且点名 plugin.json',
        badPackage.code !== 0 && /plugin\.json/.test(badPackageJson?.error ?? ''),
        `exit=${badPackage.code} ${String(badPackageJson?.error ?? '').slice(0, 300)}`
    );
    check('J6 复查失败后 package.json 逐字节未变', bytesOf(PROFILE_PKG) === pkgBytesBefore);
    check('J7 复查失败后 profile.json 逐字节未变', bytesOf(OVERLAY_FILE) === overlayBytesBefore);
    check('J8 复查失败后没有留下 node_modules', !fsSync.existsSync(PROFILE_MODULES), PROFILE_MODULES);

    // ── L engines.3rdloop 兼容预检 ─────────────────────────────
    const incompatible = await makePluginPackage(path.join(TMP_HOME, 'fixture-incompatible'), {
        pkgName: 'm15-incompatible',
        pluginName: 'm15/incompatible',
        engines: { '3rdloop': '^99.0.0' },
    });
    const enginesReject = await runCli(['plugin', 'add', `file:${incompatible}`, '--json']);
    const enginesRejectJson = parseJson(enginesReject.stdout);
    check(
        'L1 engines.3rdloop=^99.0.0 被拒且错误消息点名 engines.3rdloop 与当前版本',
        enginesReject.code !== 0 &&
            /engines\.3rdloop/.test(enginesRejectJson?.error ?? '') &&
            String(enginesRejectJson?.error ?? '').includes(CLI_VERSION),
        `exit=${enginesReject.code} ${String(enginesRejectJson?.error ?? '').slice(0, 300)}`
    );
    check('L2 预检拒绝后没有下载/安装（无 node_modules）', !fsSync.existsSync(PROFILE_MODULES), PROFILE_MODULES);
    check('L3 预检拒绝后 package.json 逐字节未变', bytesOf(PROFILE_PKG) === pkgBytesBefore);
    check('L4 预检拒绝后 profile.json 逐字节未变', bytesOf(OVERLAY_FILE) === overlayBytesBefore);

    const compatible = await makePluginPackage(path.join(TMP_HOME, 'fixture-compatible'), {
        pkgName: 'm15-compatible',
        pluginName: 'm15/compatible',
        engines: { '3rdloop': `^${CLI_VERSION}` },
    });
    const enginesPass = await runCli(['plugin', 'add', `file:${compatible}`, '--json']);
    const enginesPassJson = parseJson(enginesPass.stdout);
    check(
        `L5 engines.3rdloop=^${CLI_VERSION}（当前版本）通过预检并安装成功`,
        enginesPass.code === 0 && enginesPassJson?.ok === true && enginesPassJson?.pluginName === 'm15/compatible',
        `exit=${enginesPass.code} ${String(enginesPassJson?.error ?? '').slice(0, 300)}`
    );
    check(
        'L6 未声明 engines.3rdloop 的包被装上了但仍然给 warning',
        Array.isArray(addedJson?.warnings) && addedJson.warnings.some((w) => w.includes('engines.3rdloop')),
        JSON.stringify(addedJson?.warnings)
    );
    await runCli(['plugin', 'remove', 'm15-compatible']);
    check('L7 卸载后 node_modules 再次清空', !fsSync.existsSync(PROFILE_MODULES), PROFILE_MODULES);

    // ── M `--profile`：装进 web 的插件不污染 default ────────────
    const webProfileDir = path.join(PROFILE_ROOT, 'web');
    const addWeb = await runCli(['plugin', 'add', '--profile', 'web', `file:${compatible}`]);
    check('M1 add --profile web 退出码 0', addWeb.code === 0, `exit=${addWeb.code} ${addWeb.stderr.slice(0, 300)}`);
    check(
        'M2 web profile 目录自成一体（package.json + profile.json 都在 web 目录下）',
        fsSync.existsSync(path.join(webProfileDir, 'package.json')) && fsSync.existsSync(path.join(webProfileDir, 'profile.json')),
        webProfileDir
    );
    const webList = parseJson((await runCli(['plugin', 'list', '--json', '--profile', 'web'])).stdout);
    check(
        'M3 list --profile web 能看到它且 source=profile',
        webList?.profile === 'web' && webList?.items?.find((i) => i.name === 'm15/compatible')?.source === 'profile',
        `profile=${webList?.profile} items=${webList?.items?.length}`
    );
    const defaultList = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    check(
        'M4 list（default）看不到 web 里装的插件（profile 隔离）',
        defaultList?.profile === 'default' && defaultList?.items?.find((i) => i.name === 'm15/compatible') === undefined,
        `default 里出现了 ${defaultList?.items?.find((i) => i.name === 'm15/compatible')?.name}`
    );
    const webPath = parseJson((await runCli(['plugin', 'path', '--json', '--profile', 'web'])).stdout);
    check(
        'M5 path --profile web 的 overlay 落在 web profile 目录内',
        webPath?.overlay?.path === path.join(webProfileDir, 'profile.json') && webPath?.profileDir === webProfileDir,
        JSON.stringify(webPath?.overlay)
    );
    const removeWeb = await runCli(['plugin', 'remove', '--profile', 'web', 'm15/compatible']);
    check('M6 remove --profile web 退出码 0 且 web 的 node_modules 被清空', removeWeb.code === 0 && !fsSync.existsSync(path.join(webProfileDir, 'node_modules')), `exit=${removeWeb.code}`);

    const removeBuiltin = await runCli(['plugin', 'remove', 'engines/brain']);
    check(
        'M7 remove 内置插件被拒绝并说明原因',
        removeBuiltin.code !== 0 && removeBuiltin.stderr.includes('内置'),
        `exit=${removeBuiltin.code}`
    );
    const removeUnknown = await runCli(['plugin', 'remove', 'no/such-plugin']);
    check('M8 remove 未知插件 → 非 0 且提示未知插件', removeUnknown.code !== 0 && removeUnknown.stderr.includes('未知插件'), `exit=${removeUnknown.code}`);

    // ── K 隔离：包内 profile 与真实用户目录一个字节都没被动 ──────
    check('K1 包内 profiles/default.json 未被改动', sameSnapshot(snapshot(REPO_DEFAULT_PROFILE), repoDefaultBefore));
    const repoProfilesListAfter = fsSync.existsSync(REPO_PROFILES_DIR) ? fsSync.readdirSync(REPO_PROFILES_DIR).sort() : [];
    check(
        'K2 包内 profiles/ 目录清单未变（没有新增文件）',
        JSON.stringify(repoProfilesListAfter) === JSON.stringify(repoProfilesListBefore)
    );
    check('K3 真实 ~/.3lib/3rdloop/profiles/default/profile.json 未被改动', sameSnapshot(snapshot(REAL_OVERLAY), realOverlayBefore));
    check('K4 真实旧式 overlay（~/.3lib/3rdloop/profiles/default.json）未被改动', sameSnapshot(snapshot(REAL_LEGACY), realLegacyBefore));
    const realProfilesListAfter = fsSync.existsSync(REAL_PROFILE_DIR) ? fsSync.readdirSync(REAL_PROFILE_DIR).sort() : [];
    check(
        'K5 真实 ~/.3lib/3rdloop/profiles 目录清单未变（没有新 profile）',
        JSON.stringify(realProfilesListAfter) === JSON.stringify(realProfilesListBefore)
    );
}

try {
    await main();
} catch (err) {
    check('套件执行未意外抛错', false, err?.message ?? String(err));
} finally {
    // 假 HOME 整棵删除：任何残留的 overlay / 临时插件都留不到下一次运行
    await fs.rm(TMP_HOME, { recursive: true, force: true, maxRetries: 10 }).catch(() => {});
}

console.log(`\n共 ${pass + fail} 条断言，失败 ${fail} 条`);
if (fail > 0) {
    console.log('失败项：');
    for (const name of failures) console.log(`  - ${name}`);
}
process.exit(fail === 0 ? 0 : 1);
