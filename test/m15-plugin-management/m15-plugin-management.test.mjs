/**
 * M15-A CLI 插件管理（`3rdloop plugin list|info|enable|disable|check|path|add|remove`）
 *
 * 本套件锁的契约：
 *   1. **overlay 是唯一写盘目标**——开关落到 `~/.3lib/3rdloop/profiles/<profile>.json`，
 *      包内 `profiles/*.json` 一个字节都不能被改（随包发布、下次 update 会覆盖）。
 *   2. **CLI 开关真的能拔掉插件**——不是"文件里写了个 false"，而是装配点 `buildApp`
 *      取 `engine-*` 接缝时真的 fail closed。这条是本套件最重要的断言：用子进程真跑
 *      `host.load()` + `buildApp()`，禁用 `engines/brain` 必须抛「缺失接缝: engine-brain」，
 *      恢复 overlay 后同一个调用必须成功（对照组，否则"抛错"可能只是探针本身坏了）。
 *   3. **--json 通道纯净**：stdout 只能是 JSON，表格/日志不得混入（脚本消费方的前提）。
 *
 * 隔离约束（不可协商）：所有会写盘的断言都通过子进程把 `USERPROFILE`（Windows 的
 * `os.homedir()` 依据）与 `HOME` 指向 `os.tmpdir()` 下的 mkdtemp 目录，结束时整棵删除；
 * 真实 `~/.3lib/3rdloop/profiles` 与包内 `profiles/` 都在首尾各取一次快照比对。
 * 内核的 `USER_PROFILES_DIR` / `USER_PLUGINS_DIR` 是**模块级常量**（import 时算一次），
 * 所以假 HOME 必须由子进程启动时带入——这也是本套件处处起子进程而不直接 import 命令模块的原因。
 */
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN = path.join(ROOT, 'cli', 'bin', '3rdloop.mjs');

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
const OVERLAY_FILE = path.join(TMP_HOME, '.3lib', '3rdloop', 'profiles', 'default.json');
const FAKE_PLUGINS_DIR = path.join(TMP_HOME, '.3lib', 'plugins');

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
function runNode(args, { env: extraEnv = {}, timeoutMs = 120000 } = {}) {
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

async function readOverlay() {
    return JSON.parse(await fs.readFile(OVERLAY_FILE, 'utf8'));
}
async function writeOverlay(plugins) {
    await fs.mkdir(path.dirname(OVERLAY_FILE), { recursive: true });
    await fs.writeFile(OVERLAY_FILE, `${JSON.stringify({ plugins }, null, 2)}\n`, 'utf8');
}
async function clearOverlay() {
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

// ── 真实目录 / 包内 profile 的首尾快照 ────────────────────────────
const REAL_OVERLAY = path.join(os.homedir(), '.3lib', '3rdloop', 'profiles', 'default.json');
const REPO_PROFILES_DIR = path.join(ROOT, 'profiles');
const REPO_DEFAULT_PROFILE = path.join(REPO_PROFILES_DIR, 'default.json');
const realOverlayBefore = snapshot(REAL_OVERLAY);
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

    const FIELDS = ['name', 'version', 'seam', 'entry', 'installed', 'dir', 'source', 'enabled', 'required', 'reason', 'options', 'loaded', 'dependencies', 'dependents'];
    const thin = (listJson?.items ?? []).filter((it) => FIELDS.some((f) => !(f in it))).map((it) => it.name);
    check('B4 每条条目字段齐全（14 个字段）', (listJson?.items ?? []).length === 16 && thin.length === 0, `缺字段: ${thin.join(', ')}`);

    const aiCli = listJson?.seams?.['ai-cli'];
    check(
        'B5 接缝 ai-cli 有 2 个提供方',
        aiCli?.providers?.length === 2 && aiCli.providers.includes('cli/opencode') && aiCli.providers.includes('cli/deveco-code'),
        JSON.stringify(aiCli)
    );
    check(
        'B6 overlay 指向假 HOME 且此时尚未创建（只读命令不写盘）',
        listJson?.overlay?.path === OVERLAY_FILE && listJson?.overlay?.exists === false,
        JSON.stringify(listJson?.overlay)
    );

    // ── C `plugin info``──────────────────────────────────────────
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
    check('I4 --help 不写盘（overlay 仍不存在）', !overlayExists());

    // ── I5/I6 `plugin path`（overlay 路径 + profile 名，只读）───
    const pathRun = await runCli(['plugin', 'path']);
    check(
        'I5 plugin path 打印 profile 名与 overlay 路径',
        pathRun.code === 0 && pathRun.stdout.includes('profile: default') && pathRun.stdout.includes(OVERLAY_FILE),
        `exit=${pathRun.code} ${pathRun.stdout.slice(0, 200)}`
    );
    const pathJson = parseJson((await runCli(['plugin', 'path', '--json'])).stdout);
    check(
        'I6 path --json 的 overlay.path 指向假 HOME 的 profile 文件',
        pathJson?.profile === 'default' && pathJson?.overlay?.path === OVERLAY_FILE,
        JSON.stringify(pathJson?.overlay)
    );

    // ── D disable / enable 落盘（假 HOME）───────────────────────
    const disable = await runCli(['plugin', 'disable', 'engines/brain']);
    check(
        'D1 disable engines/brain 成功且打印 overlay 路径与重启提示',
        disable.code === 0 && disable.stdout.includes('已写入') && disable.stdout.includes('重启 3rdloop serve 后生效'),
        `exit=${disable.code} ${disable.stderr.slice(0, 200)}`
    );
    check('D2 overlay 文件真的落到假 HOME', overlayExists(), OVERLAY_FILE);

    const overlayAfterDisable = overlayExists() ? await readOverlay() : null;
    check(
        'D3 overlay 形状为 {"plugins":{"engines/brain":{"enabled":false}}}',
        JSON.stringify(overlayAfterDisable?.plugins) === JSON.stringify({ 'engines/brain': { enabled: false } }),
        JSON.stringify(overlayAfterDisable?.plugins)
    );

    const afterDisableJson = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    const brainOff = afterDisableJson?.items?.find((it) => it.name === 'engines/brain');
    check(
        'D4 list --json 显示 engines/brain 已禁用',
        brainOff?.enabled === false && brainOff?.status === 'disabled' && typeof brainOff?.reason === 'string' && brainOff.reason.length > 0,
        JSON.stringify(brainOff)
    );

    const enable = await runCli(['plugin', 'enable', 'engines/brain']);
    check('D5 enable engines/brain 退出码 0', enable.code === 0, `exit=${enable.code} ${enable.stderr.slice(0, 200)}`);
    const overlayAfterEnable = overlayExists() ? await readOverlay() : null;
    check('D6 enable 后 overlay 里 enabled 变回 true', overlayAfterEnable?.plugins?.['engines/brain']?.enabled === true, JSON.stringify(overlayAfterEnable?.plugins));

    const afterEnableJson = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    check(
        'D7 list --json 显示 engines/brain 恢复启用',
        afterEnableJson?.items?.find((it) => it.name === 'engines/brain')?.enabled === true
    );

    // ── E 拒绝路径（被依赖 / 未知插件）──────────────────────────
    await clearOverlay();
    const dependReject = await runCli(['plugin', 'disable', 'storage/core']);
    check('E1 disable storage/core 被拒绝（非 0 退出）', dependReject.code !== 0, `exit=${dependReject.code}`);
    check(
        'E2 拒绝信息含依赖者名字 cli/opencode',
        dependReject.stderr.includes('cli/opencode'),
        dependReject.stderr.slice(0, 300)
    );
    check('E3 被拒绝时不写盘（overlay 未创建）', !overlayExists());

    const unknownToggle = await runCli(['plugin', 'disable', 'no/such-plugin']);
    check(
        'E4 disable 不存在的插件 → 非 0 且提示未知插件',
        unknownToggle.code !== 0 && unknownToggle.stderr.includes('未知插件'),
        `exit=${unknownToggle.code}`
    );

    const forced = await runCli(['plugin', 'disable', 'storage/core', '--force']);
    const overlayForced = overlayExists() ? await readOverlay() : null;
    check(
        'E5 --force 越过依赖检查并写盘',
        forced.code === 0 && overlayForced?.plugins?.['storage/core']?.enabled === false,
        `exit=${forced.code} ${JSON.stringify(overlayForced?.plugins)}`
    );

    const restoreStorage = await runCli(['plugin', 'enable', 'storage/core']);
    const overlayRestored = overlayExists() ? await readOverlay() : null;
    check(
        'E6 enable storage/core 恢复启用',
        restoreStorage.code === 0 && overlayRestored?.plugins?.['storage/core']?.enabled === true,
        `exit=${restoreStorage.code}`
    );

    // ── F `plugin check` ────────────────────────────────────────
    await clearOverlay();
    const checkOk = await runCli(['plugin', 'check']);
    check('F1 正常状态 check 退出码 0', checkOk.code === 0, `exit=${checkOk.code} ${checkOk.stdout.slice(0, 300)}`);

    const checkOkJsonRun = await runCli(['plugin', 'check', '--json']);
    const checkOkJson = parseJson(checkOkJsonRun.stdout);
    check(
        'F2 check --json 为纯 JSON 且 ok=true、errors 为空',
        checkOkJson !== null && checkOkJson.ok === true && Array.isArray(checkOkJson.errors) && checkOkJson.errors.length === 0,
        checkOkJsonRun.stdout.slice(0, 300)
    );

    // 构造「依赖被禁」的 overlay：storage/core 被禁后 cli/opencode 的依赖缺失
    await writeOverlay({ 'storage/core': { enabled: false } });
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

    await clearOverlay();
    const checkRecovered = await runCli(['plugin', 'check']);
    check('F5 恢复 overlay 后 check 重新 ok', checkRecovered.code === 0, `exit=${checkRecovered.code}`);

    // ── G 真跑一次 fail closed（装配点 buildApp）────────────────
    await writeOverlay({ 'engines/brain': { enabled: false } });
    const probeBroken = await runNode([PROBE, PROBE_DATA], { timeoutMs: 180000 });
    check(
        'G1 禁用 engines/brain 后 buildApp fail closed 且消息含「缺失接缝: engine-brain」',
        probeBroken.stdout.includes('FAIL-CLOSED') && probeBroken.stdout.includes('缺失接缝: engine-brain'),
        `exit=${probeBroken.code} ${(probeBroken.stdout + probeBroken.stderr).slice(0, 400)}`
    );
    check('G2 禁用状态下装配确实没有成功', !probeBroken.stdout.includes('OK: buildApp 成功'));
    check('G3 探针进程本身没有崩溃（exit 0）', probeBroken.code === 0, `exit=${probeBroken.code} ${probeBroken.stderr.slice(0, 300)}`);

    await clearOverlay();
    const probeHealthy = await runNode([PROBE, PROBE_DATA], { timeoutMs: 180000 });
    check(
        'G4 恢复 overlay 后同一个 buildApp 调用成功（对照组）',
        probeHealthy.code === 0 && probeHealthy.stdout.includes('OK: buildApp 成功'),
        `exit=${probeHealthy.code} ${(probeHealthy.stdout + probeHealthy.stderr).slice(0, 400)}`
    );

    // ── H `plugin add` / `plugin remove` ────────────────────────
    const srcDir = path.join(TMP_HOME, 'demo-plugin-src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
        path.join(srcDir, 'plugin.json'),
        `${JSON.stringify({ name: 'demo/hello', version: '1.0.0', seam: 'demo-seam', entry: 'index.js' }, null, 2)}\n`,
        'utf8'
    );
    await fs.writeFile(path.join(srcDir, 'index.js'), "export default { name: 'demo/hello' };\n", 'utf8');

    const add = await runCli(['plugin', 'add', srcDir]);
    check('H1 add 安装临时插件退出码 0', add.code === 0, `exit=${add.code} ${add.stderr.slice(0, 300)}`);
    const addedManifest = path.join(FAKE_PLUGINS_DIR, 'demo', 'hello', 'plugin.json');
    check('H2 插件目录被复制到 ~/.3lib/plugins/<name>/', fsSync.existsSync(addedManifest), addedManifest);

    const afterAddJson = parseJson((await runCli(['plugin', 'list', '--json'])).stdout);
    const added = afterAddJson?.items?.find((it) => it.name === 'demo/hello');
    check(
        'H3 add 后 list --json 能看到它且 source=user',
        added?.installed === true && added?.source === 'user',
        JSON.stringify(added)
    );

    const addBad = await runCli(['plugin', 'add', TMP_HOME]);
    check(
        'H4 add 无 plugin.json 的目录 → 非 0 且提示缺清单',
        addBad.code !== 0 && addBad.stderr.includes('plugin.json'),
        `exit=${addBad.code}`
    );

    const addAgain = await runCli(['plugin', 'add', srcDir]);
    check('H5 重复 add 被拒绝（目标已存在）', addAgain.code !== 0 && addAgain.stderr.includes('已存在'), `exit=${addAgain.code}`);

    const remove = await runCli(['plugin', 'remove', 'demo/hello']);
    check(
        'H6 remove 卸载成功且目录消失',
        remove.code === 0 && !fsSync.existsSync(path.join(FAKE_PLUGINS_DIR, 'demo', 'hello')),
        `exit=${remove.code} ${remove.stderr.slice(0, 300)}`
    );

    const removeBuiltin = await runCli(['plugin', 'remove', 'engines/brain']);
    check(
        'H7 remove 内置插件被拒绝并说明原因',
        removeBuiltin.code !== 0 && removeBuiltin.stderr.includes('内置'),
        `exit=${removeBuiltin.code}`
    );

    // ── K 隔离：包内 profile 与真实用户目录一个字节都没被动 ──────
    check('K1 包内 profiles/default.json 未被改动', sameSnapshot(snapshot(REPO_DEFAULT_PROFILE), repoDefaultBefore));
    const repoProfilesListAfter = fsSync.existsSync(REPO_PROFILES_DIR) ? fsSync.readdirSync(REPO_PROFILES_DIR).sort() : [];
    check(
        'K2 包内 profiles/ 目录清单未变（没有新增文件）',
        JSON.stringify(repoProfilesListAfter) === JSON.stringify(repoProfilesListBefore)
    );
    check('K3 真实用户 overlay（~/.3lib/3rdloop/profiles）未被改动', sameSnapshot(snapshot(REAL_OVERLAY), realOverlayBefore));
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
