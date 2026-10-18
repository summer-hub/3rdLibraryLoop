/**
 * M14-A Web 扩展来源与同名遮蔽（回归锁）
 *
 * 背景：扩展现在**随核心包发布**（`<核心树根>/Web/ext`），解析顺序是
 *   `--ext-root` > `3LIB_WEB_EXT_ROOT` > 仓库 Web/ext > 核心树 Web/ext > 用户目录
 * 于是"以前用 `serve install-ext` 装过、现在被随包同名扩展遮蔽"的副本不会生效。
 * 只告警"重名忽略"不够用：用户看不出**被忽略的是自己装的那份**，也没有可执行的下一步；
 * `list-ext` 里干脆看不到它。本套件锁三件事：
 *
 *   A 同名去重：靠前的根胜出，被遮蔽的副本记进 `shadowed`（含 dir 与 keptDir）
 *   B 可执行的告警：被遮蔽副本位于用户目录时，文案带 `serve remove-ext <name>`
 *   C 可观测：`webExtList` 的 JSON 同时给出生效项与 `shadowed`（effective:false + shadowedBy）
 *   D 根解析去重：仓库 `Web/ext` 与核心树 `Web/ext` 是同一路径时只出现一次
 */
import { promises as fs } from 'node:fs';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

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

const { loadExtensions } = await imp('cli/lib/web-ext.js');
const { resolveExtRoots, webExtList } = await imp('cli/lib/web.js');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'm14-ext-'));
const coreRoot = path.join(tmp, 'core-ext');
const userRoot = path.join(tmp, 'user-ext');

/** 造一个最小可识别扩展（readManifest 只校验 name/mount/可选 server|page 越界） */
async function makeExt(root, name, mount, extra = {}) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ name, title: `${name} title`, mount, order: 10, ...extra }),
        'utf8'
    );
    return dir;
}

try {
    // ─── A 同名去重 + shadowed 记录 ────────────────────────────────────────
    const coreSame = await makeExt(coreRoot, 'm14same', '/m14same');
    const userSame = await makeExt(userRoot, 'm14same', '/m14same');
    const userOnly = await makeExt(userRoot, 'm14only', '/m14only');

    const warnings = [];
    const r1 = loadExtensions([coreRoot, userRoot], (m) => warnings.push(m), { userExtRoot: userRoot });
    check('A1 同名扩展只保留靠前根的那一份',
        r1.extensions.filter((e) => e.name === 'm14same').length === 1 &&
            path.resolve(r1.extensions.find((e) => e.name === 'm14same').dir) === path.resolve(coreSame),
        r1.extensions.map((e) => e.name).join(','));
    check('A2 不重名的扩展照常合并', r1.extensions.some((e) => e.name === 'm14only'));
    const sh = r1.shadowed.find((s) => s.name === 'm14same');
    check('A3 被遮蔽副本记进 shadowed（含自身 dir 与胜出者 keptDir）',
        !!sh && path.resolve(sh.dir) === path.resolve(userSame) && path.resolve(sh.keptDir) === path.resolve(coreSame),
        JSON.stringify(r1.shadowed));

    // ─── B 告警可执行 ─────────────────────────────────────────────────────
    const shadowWarn = warnings.find((w) => w.includes('m14same')) ?? '';
    check('B1 重名时确实告警（不是静默丢弃）', /重名/.test(shadowWarn), shadowWarn);
    check('B2 被遮蔽副本在用户目录时，告警带可照抄的清理命令',
        /serve remove-ext m14same/.test(shadowWarn), shadowWarn);

    const warningsNoHint = [];
    loadExtensions([coreRoot, userRoot], (m) => warningsNoHint.push(m), {});
    const noHintWarn = warningsNoHint.find((w) => w.includes('m14same')) ?? '';
    check('B3 未传 userExtRoot 时不硬猜来源（保持原告警，向后兼容）',
        /重名/.test(noHintWarn) && !/remove-ext/.test(noHintWarn), noHintWarn);

    // ─── C list-ext 可观测（JSON）─────────────────────────────────────────
    // 用仓库真实 Web/ext 里的第一个扩展名造一个"用户同名旧副本"，覆盖真实遮蔽路径
    const repoExtDir = path.join(ROOT, 'Web', 'ext');
    const repoNames = (await fs.readdir(repoExtDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    if (repoNames.length > 0) {
        const clash = repoNames[0];
        const clashDir = path.join(userRoot, clash);
        await fs.mkdir(clashDir, { recursive: true });
        await fs.writeFile(
            path.join(clashDir, 'manifest.json'),
            JSON.stringify({ name: clash, title: `${clash} (user copy)`, mount: `/${clash}`, order: 1 }),
            'utf8'
        );
    }

    let payload = null;
    webExtList({ userExtRoot: userRoot, jsonMode: true, out: (o) => { payload = o; } });
    check('C1 list-ext 的 JSON 里同时给出 extensions 与 shadowed', !!payload &&
        Array.isArray(payload.extensions) && Array.isArray(payload.shadowed));
    check('C2 生效项都带 source', (payload?.extensions ?? []).every((e) => typeof e.source === 'string'));
    if (repoNames.length > 0) {
        const clash = repoNames[0];
        const shadowedEntry = (payload?.shadowed ?? []).find((s) => s.name === clash);
        check('C3 用户目录里的同名旧副本在 shadowed 里标记 effective=false 并指出遮蔽者',
            !!shadowedEntry && shadowedEntry.effective === false && typeof shadowedEntry.shadowedBy === 'string',
            JSON.stringify(shadowedEntry));
        check('C4 生效的那份不是用户目录的副本',
            (payload?.extensions ?? []).find((e) => e.name === clash)?.source?.includes(`${path.sep}Web${path.sep}ext`) === true,
            (payload?.extensions ?? []).find((e) => e.name === clash)?.source);
    }

    // ─── D 根解析去重（仓库 Web/ext 与核心树 Web/ext 同路径）────────────────
    const emptyUser = path.join(tmp, 'empty-user');
    await fs.mkdir(emptyUser, { recursive: true });
    const roots = resolveExtRoots([], emptyUser);
    const normalized = roots.map((r) => {
        try {
            const real = realpathSync(r);
            return process.platform === 'win32' ? real.toLowerCase() : real;
        } catch {
            return path.resolve(r);
        }
    });
    check('D1 同一目录（仓库 Web/ext == 核心树 Web/ext）在根列表里只出现一次',
        new Set(normalized).size === normalized.length, roots.join(' | '));
    check('D2 仓库 Web/ext 确实在根列表里', normalized.some((r) => r.includes(`${path.sep}web${path.sep}ext`)), roots.join(' | '));
} finally {
    await fs.rm(tmp, { recursive: true, force: true });
}

console.log('\n═══ M14-A 汇总 ═══');
console.log(`共 ${pass + fail} 条断言，通过 ${pass} 条，失败 ${fail} 条`);
if (fail > 0) {
    console.log(`失败项：${failures.join(' / ')}`);
}
process.exit(fail === 0 ? 0 : 1);
