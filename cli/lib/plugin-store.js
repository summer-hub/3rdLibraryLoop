/**
 * plugin-store.js — 插件状态的**唯一读写入口**（CLI 与 Web 共用）
 *
 * 为什么单独一层：`3rdloop plugin ...` 与前端「插件」页必须看到同一份数据、走同一套校验，
 * 否则两边判定迟早漂移（一边允许禁用 required、一边拒绝）。所以：
 *   - 读：`readState()` → `PluginHost.describe()`（内核只读描述，不装配、不触发 setup）
 *   - 写：`setEnabled()` / `installPlugin()` / `removePlugin()` → **profile 目录**
 *
 * ## DSH 式布局（本模块的核心约定）
 *
 * 一个 profile 一个目录（`<USER_PROFILES_DIR>/<profile>/`）：
 *   - **插件就是该目录的 npm 依赖**：装/卸走包管理器（`npm install/uninstall`，cwd=profile 目录），
 *     宿主扫描 `<profileDir>/node_modules` 就能发现它们（`source: 'profile'`）；
 *   - **启用状态另记**：`<profileDir>/profile.json` 的 `plugins[<插件名>] = { enabled }`；
 *   - **失败回滚**：安装/卸载前备份 `package.json` 与 `package-lock.json`，任何一步失败
 *     （含"装完复查宿主看不见"）都逐字节写回，不留半装的 profile。
 *
 * **绝不写包内 profile**：发布态 profile 在 `node_modules/@ohos-cpf/3rdloop_core/profiles/`，
 * 改它既越权又会在下次 `3rdloop update` 时丢掉。所有写盘都落在用户级 `~/.3lib/3rdloop/profiles/`。
 *
 * **旧式单文件 overlay 仍可读**：`<USER_PROFILES_DIR>/<profile>.json` 与目录式合并（目录式优先），
 * 但**写只写新位置**——下一次写盘会把旧文件里的开关一并落到 `profile.json`（等价迁移）。
 *
 * 生效语义：profile 在**进程启动**时被读取（`PluginHost.load`），所以改完需重启
 * `3rdloop serve` / 下一次命令才会生效。本模块只负责把"需要重启"这件事如实回传。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveCoreRoots } from './core-paths.js';

// 内核必须走**四级解析**（`3LIB_CORE_DIR` > 已安装核心包 > vendor > 仓库根），
// 不能用 `../../core/index.js` 这种静态相对路径：仓库里它指向仓库根的 `core/`，
// 但装成包之后 `<pkg>/lib/plugin-store.js` 的 `../../core` 会落到
// `node_modules/@ohos-cpf/core/`（不存在）——所有 `plugin` 子命令在安装态直接崩
// （实测：3rdloop plugin path → Cannot find module '@ohos-cpf/core/index.js'）。
// 顶层 await 让对外 API 保持同步，调用方无需改签名。
const {
    BUILTIN_PLUGINS_DIR,
    DEFAULT_PROFILE,
    PROFILE_ENV,
    PluginHost,
    USER_PLUGINS_DIR,
    USER_PROFILES_DIR,
    listProfiles,
    loadProfile,
    validateManifest,
} = await import(pathToFileURL(path.join(resolveCoreRoots().coreRoot, 'core', 'index.js')).href);

/** 用户级 profile 根目录（包外、可写、升级不丢） */
export const OVERLAY_DIR = USER_PROFILES_DIR;

/** profile 名允许的字符（它同时是目录名，必须挡掉 `..` 与分隔符） */
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** npm 子进程超时：安装大包/编译原生依赖可能慢，但卡死必须能结束 */
const NPM_TIMEOUT_MS = 300_000;

/** 当前 CLI 版本（engines.3rdloop 兼容预检的基准）；读不到时预检降级为 warning */
const CLI_VERSION = readCliVersion();

/** 装配点**硬性需要**的接缝：`Server/composition/buildApp.js` 在 `engineSeams:'require'`
 * （默认）下缺任何一条都会 fail closed。`check()` 必须按同一口径判定，否则会出现
 * "静态检查说没事、启动却炸了"——这比不检查更糟。 */
export const REQUIRED_SEAMS = Object.freeze([
    'engine-brain',
    'engine-knowledge',
    'engine-loop',
    'engine-orchestrator',
    'engine-testcheck',
]);

// ─── 小工具 ───────────────────────────────────────────────────────

/** 去 UTF-8 BOM（手写/记事本保存的 JSON 会带，`JSON.parse` 会因此报非法字符）。 */
function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 判断 target 是否在 root 之下（统一分隔符与大小写，Windows 上大小写不同不算越界）。 */
function isUnder(target, root) {
    const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
    const t = norm(target);
    const r = norm(root);
    return t === r || t.startsWith(`${r}/`);
}

/** 读文件原始字节（不存在返回 null）——回滚要"逐字节一模一样"，不能用 JSON 往返。 */
function readBytesOrNull(file) {
    try {
        return fs.readFileSync(file);
    } catch {
        return null;
    }
}

/** 原子写：先写 `.tmp` 再 rename（断电/中断不会留下半截 JSON）。 */
function writeFileAtomic(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
}

/** 读 JSON（不存在返回 null；损坏则抛出可直接展示的错误）。 */
function readJsonIfExists(file, label = file) {
    if (!fs.existsSync(file)) return null;
    try {
        const parsed = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (err) {
        throw new Error(`${label} 解析失败 ${file}: ${err.message}`);
    }
}

/** 读 CLI 版本（`cli/package.json`）；失败返回空串，预检据此降级。 */
function readCliVersion() {
    try {
        const file = new URL('../package.json', import.meta.url);
        const parsed = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
        return typeof parsed.version === 'string' ? parsed.version : '';
    } catch {
        return '';
    }
}

// ─── 最小 semver 子集（只判 engines.3rdloop 这类兼容范围）─────────

/** 解析版本号（允许 `1` / `1.2` / `1.2.3`，缺位补 0），非法返回 null。 */
function parseVersion(text) {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(String(text ?? '').trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** 三版本号比较：a<b → -1，相等 → 0，a>b → 1 */
function compareVersions(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

/** `^x.y.z` 的上界：大版本优先，其次次版本，`0.0.z` 只放开 patch（与 npm caret 一致）。 */
function caretUpper([major, minor, patch]) {
    if (major > 0) return [major + 1, 0, 0];
    if (minor > 0) return [0, minor + 1, 0];
    return [0, 0, patch + 1];
}

/** 单个比较符（`>=1.2.3` / `^0.0.13` / `~1.2` / `1.2.3`）是否命中版本。 */
function matchComparator(version, token) {
    const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(String(token).trim());
    if (!m) return false;
    const op = m[1] ?? '';
    const bound = parseVersion(m[2]);
    // 非数字范围（`latest` / `x` / `*` / `workspace:*`）无法判定：保守放行并交给安装期报错，
    // 这里宁可漏报也不要拦掉一个本来能装的插件
    if (!bound) return true;

    switch (op) {
        case '^': {
            const upper = caretUpper(bound);
            return compareVersions(version, bound) >= 0 && compareVersions(version, upper) < 0;
        }
        case '~': {
            const upper = [bound[0], bound[1] + 1, 0];
            return compareVersions(version, bound) >= 0 && compareVersions(version, upper) < 0;
        }
        case '>=':
            return compareVersions(version, bound) >= 0;
        case '>':
            return compareVersions(version, bound) > 0;
        case '<=':
            return compareVersions(version, bound) <= 0;
        case '<':
            return compareVersions(version, bound) < 0;
        default:
            // 无操作符 = 精确版本（`1.2` 视为 1.2.0，与 parseVersion 的补 0 一致）
            return compareVersions(version, bound) === 0;
    }
}

/**
 * 判断 `version` 是否满足 `range`（最小 semver 子集）。
 * 支持 `*` / `||` 多段 / 空格分隔的合取，以及 `^` `~` `>=` `<=` `>` `<` `=`。
 *
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 */
export function satisfiesRange(version, range) {
    const v = parseVersion(version);
    if (!v) return false;
    const text = String(range ?? '').trim();
    if (text === '' || text === '*' || text === 'x' || text === 'latest') return true;
    return text
        .split('||')
        .some((alt) => alt.split(/\s+/).filter(Boolean).every((token) => matchComparator(v, token)));
}

// ─── profile 解析（名字 → 目录）────────────────────────────────────

/**
 * 解析 profile 名（显式参数 > env `3LIB_PLUGIN_PROFILE` > `default`），并挡掉非法目录名。
 * @param {{profile?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {string}
 */
export function resolveProfileName({ profile, env = process.env } = {}) {
    const name = String(profile ?? env[PROFILE_ENV] ?? DEFAULT_PROFILE).trim();
    if (!name) throw new Error('profile 名不能为空（--profile <name> 或 3LIB_PLUGIN_PROFILE）');
    if (!PROFILE_NAME_RE.test(name)) {
        throw new Error(`profile 名非法: ${name}（只允许字母、数字、点、下划线、连字符，且不能以符号开头）`);
    }
    return name;
}

/**
 * profile 目录（插件装在这里，`node_modules` 就是插件集合）。
 *
 * 宿主 `profileDirFor()` 会优先返回"已存在的目录式 profile"，只有旧式
 * `<profilesRoot>/<name>.json` 时它也会返回 `<profilesRoot>/<name>` —— 而那个 root 可能是
 * **包内只读目录**（发布态在 `node_modules/@ohos-cpf/3rdloop_core/profiles/`），往那里装插件
 * 会被下次 `3rdloop update` 抹掉。所以：目录式 profile 真存在才采信宿主解析，否则一律用
 * 用户级目录（`USER_PROFILES_DIR`，包外可写）。
 *
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function profileDirOf(name, env = process.env) {
    const probe = new PluginHost({ env: { ...env, [PROFILE_ENV]: name } });
    const hostDir = probe.profileDirFor(name);
    if (fs.existsSync(path.join(hostDir, 'profile.json'))) return hostDir;
    return path.join(USER_PROFILES_DIR, name);
}

/**
 * 一次操作需要的 profile 上下文：名字、目录、node_modules、宿主扫描根。
 *
 * 扫描根顺序 = 内置 `plugins/` → `<profileDir>/node_modules`（存在才加）→ `~/.3lib/plugins`
 * → env 额外根。**为什么在这里显式传 roots**：`PluginHost.describe()` 扫的是构造时的
 * `roots`（不是 `rootsFor()`），不把 profile 的 node_modules 传进去，装好的插件永远显示
 * `missing`/`source:'user'`，`plugin list` 与真实装配就会给出相反结论。
 *
 * @param {{profile?: string, env?: NodeJS.ProcessEnv}} [opts]
 */
function profileContext({ profile, env = process.env } = {}) {
    const name = resolveProfileName({ profile, env });
    const dir = profileDirOf(name, env);
    const modules = path.join(dir, 'node_modules');
    const roots = [BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR];
    if (fs.existsSync(modules)) roots.splice(1, 0, modules);
    return { name, dir, modules, roots, env: { ...env, [PROFILE_ENV]: name } };
}

/** 按 profileContext 造宿主（describe 的扫描根与 `plugin list` 显示保持同一份）。 */
function hostFor(ctx) {
    return new PluginHost({ roots: ctx.roots, env: ctx.env });
}

// ─── overlay（profile.json）读写 ──────────────────────────────────

/**
 * profile 的 overlay 文件路径（**写目标**）：`<USER_PROFILES_DIR>/<profile>/profile.json`。
 * @param {string} profile
 * @returns {string}
 */
export function overlayPath(profile) {
    return path.join(OVERLAY_DIR, resolveProfileName({ profile }), 'profile.json');
}

/** 旧式单文件 overlay（只读兼容）：`<USER_PROFILES_DIR>/<profile>.json`。 */
function legacyOverlayPath(name) {
    return path.join(OVERLAY_DIR, `${name}.json`);
}

/**
 * 读取 profile 的 overlay（目录式优先，旧式单文件兜底合并）。
 *
 * @param {string} profile
 * @returns {{plugins: Record<string, object>, description?: string, defaultEnabled?: boolean,
 *            exists: boolean, path: string, legacyPath: string, legacyExists: boolean,
 *            file: string, data: object}}
 */
export function readOverlay(profile) {
    const name = resolveProfileName({ profile });
    const file = overlayPath(name);
    const legacyFile = legacyOverlayPath(name);
    const modern = readJsonIfExists(file, 'profile.json');
    const legacy = readJsonIfExists(legacyFile, 'profile.json（旧式单文件）');

    // 合并粒度：单文件先、目录式后（后者覆盖）；未给出的顶层字段沿用旧文件，
    // 这样"只改开关"的用户不会因为迁移丢掉 defaultEnabled 之类的设置。
    const fields = {};
    for (const source of [legacy, modern]) {
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) {
            if (key === 'plugins' || key === 'name') continue;
            fields[key] = value;
        }
    }
    const plugins = { ...(legacy?.plugins ?? {}), ...(modern?.plugins ?? {}) };

    return {
        plugins,
        // 写盘基准：目录式文件一旦存在，它就与内核的读取结果一致（内核只读目录式），
        // 所以写入只以它为底，避免把旧式文件里的历史条目"复活"成新开关
        writeBase: modern ? { ...(modern.plugins ?? {}) } : plugins,
        ...(fields.description !== undefined ? { description: fields.description } : {}),
        ...(fields.defaultEnabled !== undefined ? { defaultEnabled: fields.defaultEnabled } : {}),
        exists: Boolean(modern || legacy),
        path: file,
        file,
        legacyPath: legacyFile,
        legacyExists: Boolean(legacy),
        data: { name, ...fields, plugins },
    };
}

/**
 * 改写 overlay 并落盘（原子写，只写目录式新位置）。
 *
 * @param {object} opts
 * @param {string} opts.profileName
 * @param {(plugins: Record<string, object>) => void} opts.mutate - 就地改 plugins
 * @returns {string} 写入的文件路径
 */
function patchOverlay({ profileName, mutate }) {
    const overlay = readOverlay(profileName);
    const plugins = { ...overlay.writeBase };
    mutate(plugins);
    const next = {
        name: profileName,
        description: overlay.description ?? '用户级插件开关（由 3rdloop plugin 维护，覆盖内置 profile）',
        ...(overlay.defaultEnabled !== undefined ? { defaultEnabled: overlay.defaultEnabled } : {}),
        plugins,
    };
    const file = overlayPath(profileName);
    writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    return file;
}

// ─── 读状态 ───────────────────────────────────────────────────────

/**
 * 读取当前插件状态（只读、不装配）。
 *
 * @param {object} [opts]
 * @param {string} [opts.profile]        - profile 名（缺省取 env `3LIB_PLUGIN_PROFILE` → `default`）
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {object} `PluginHost.describe()` 的结果 + profile 位置/可用名单
 */
export function readState({ profile, env = process.env } = {}) {
    const ctx = profileContext({ profile, env });
    const host = hostFor(ctx);
    const state = host.describe();
    const overlay = readOverlay(ctx.name);
    return {
        ...state,
        profileName: state.profile,
        profileDir: ctx.dir,
        profiles: listProfiles(host.profileDirs),
        overlay: { path: overlay.path, exists: overlay.exists, dir: OVERLAY_DIR },
        // 只读快照：这些字段来自内核，写回时不要用它们
        readonly: true,
    };
}

/**
 * 找某个插件的"被依赖者"（启用中且 manifest 声明依赖它的插件）。
 * @param {string} name
 * @param {object} state - readState() 结果
 * @returns {string[]}
 */
export function findDependents(name, state) {
    const target = state.plugins.find((p) => p.name === name);
    return target ? [...(target.dependents ?? [])] : [];
}

/**
 * 校验一次开关是否允许（不写盘）。不允许时抛错，消息可直接展示给用户。
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {boolean} opts.enabled
 * @param {object} opts.state - readState() 结果
 * @param {boolean} [opts.force] - 强制（仍不允许禁用 required）
 */
export function validateToggle({ name, enabled, state, force = false }) {
    const target = state.plugins.find((p) => p.name === name);
    if (!target) {
        const known = state.plugins.map((p) => p.name).join(', ');
        throw new Error(`未知插件: ${name}（已发现: ${known || '无'}）`);
    }
    if (!target.installed) {
        throw new Error(
            `插件 ${name} 未安装（profile 提到了它，但插件根里没有目录）。\n` +
                `        插件根: ${(state.roots ?? []).join('、') || '（无）'}\n` +
                `        装插件: 3rdloop plugin add <包 spec> --profile ${state.profileName}`
        );
    }
    if (enabled) return { target };

    // 关闭方向才需要拦：required 与"有人依赖它"
    if (target.required) {
        throw new Error(`插件 ${name} 被标记 required，不能禁用（禁用会导致启动 fail closed）`);
    }
    const dependents = findDependents(name, state).filter((d) => {
        const dep = state.plugins.find((p) => p.name === d);
        return dep && dep.enabled;
    });
    if (dependents.length > 0 && !force) {
        throw new Error(
            `插件 ${name} 正被以下启用中的插件依赖: ${dependents.join(', ')}\n` +
                `        先禁用它们，或加 --force（--force 会让这些插件在启动时报依赖缺失）。`
        );
    }
    return { target, warnings: dependents.length ? [`仍有启用中的插件依赖它: ${dependents.join(', ')}`] : [] };
}

/**
 * 写入一次开关到 profile 的 overlay（原子写；旧式单文件里的开关一并迁移过来）。
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {boolean} opts.enabled
 * @param {string} [opts.profile]
 * @param {boolean} [opts.force]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ok: true, name: string, enabled: boolean, file: string, profile: string, profileDir: string,
 *            warnings: string[], requiresRestart: true}}
 */
export function setEnabled({ name, enabled, profile, force = false, env = process.env }) {
    const state = readState({ profile, env });
    const { warnings = [] } = validateToggle({ name, enabled, state, force });

    const file = patchOverlay({
        profileName: state.profileName,
        mutate: (plugins) => {
            plugins[name] = { ...(plugins[name] ?? {}), enabled: Boolean(enabled) };
        },
    });

    return {
        ok: true,
        name,
        enabled: Boolean(enabled),
        file,
        profile: state.profileName,
        profileDir: state.profileDir,
        warnings,
        requiresRestart: true,
    };
}

// ─── npm 子进程 ───────────────────────────────────────────────────

/**
 * 定位 npm 入口。
 *
 * Windows 下 `npm` 是 `npm.cmd`，`spawnSync('npm')` 的 CreateProcess 无法执行批处理 shim
 * （报 `spawnSync npm ENOENT`）。所以优先用**与 node 同目录**的 `npm-cli.js` 直接调
 * （`node <npm-cli.js> ...`，零 shell 依赖，参数无需转义）；只有它不存在时才回退
 * `npm` + `shell:true`（做法与 `scripts/release.mjs` 的 `npmEntry()` 一致）。
 */
function npmEntry() {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(cli)) return { file: process.execPath, prefix: [cli], shell: false };
    return { file: 'npm', prefix: [], shell: process.platform === 'win32' };
}

/**
 * 同步跑一次 npm。
 *
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runNpm(args, { cwd, env = process.env } = {}) {
    const entry = npmEntry();
    const res = spawnSync(entry.file, [...entry.prefix, ...args], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: NPM_TIMEOUT_MS,
        shell: entry.shell,
        windowsHide: true,
    });
    if (res.error) {
        return { status: -1, stdout: '', stderr: `无法启动 npm（${entry.file}）：${res.error.message}` };
    }
    return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** 从 npm 输出里挑出真正有用的几行（内部堆栈与 JSON 外壳对用户没有信息量）。 */
function npmFailureDetail(res) {
    const text = `${res.stderr || ''}\n${res.stdout || ''}`.trim();
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/A complete log of this run/.test(line));
    const primary = lines.filter((line) =>
        /reason:|ECONNREFUSED|EAI_AGAIN|E404|ETARGET|EEXIST|npm error code|npm error 4\d\d/i.test(line)
    );
    const npmError = lines.filter((line) => /npm (error|ERR)/.test(line));
    const detail = (primary.length > 0 ? primary : npmError.length > 0 ? npmError : lines).slice(0, 5).join('\n        ');
    return detail || `（npm 无输出，exit=${res.status}）`;
}

// ─── spec 分类 ────────────────────────────────────────────────────

/** 本地目录 / 路径型 spec 的特征（`./x`、`../x`、`/x`、`D:\x`、含反斜杠）。 */
function looksLikePath(spec) {
    return (
        spec.startsWith('.') ||
        spec.startsWith('/') ||
        /^[A-Za-z]:[\\/]/.test(spec) ||
        spec.includes('\\')
    );
}

/** 拆 registry 名：`@scope/name@1.0.0` → name `@scope/name`、version `1.0.0`。 */
function splitRegistrySpec(spec) {
    const scoped = /^(@[^/@]+\/[^@]+?)(?:@(.+))?$/.exec(spec);
    if (scoped) return { name: scoped[1], version: scoped[2] ?? '' };
    const plain = /^([^@]+?)(?:@(.+))?$/.exec(spec);
    if (!plain) throw new Error(`无法识别的包 spec: ${spec}`);
    return { name: plain[1], version: plain[2] ?? '' };
}

/**
 * 把用户给的安装目标分类（本地 / git / tarball / registry），并规范成 npm 能吃的 spec。
 *
 * `dir` 参数是旧接口，调用方先折成 `file:<绝对路径>`，语义与 `file:` 完全一致。
 *
 * @param {string} raw
 * @returns {{kind: 'local'|'git'|'tarball'|'registry', input: string, spec: string,
 *            dir: string|null, name?: string, version?: string}}
 * @throws {Error} 空 spec / 本地路径不存在 / 本地目录不是 npm 包
 */
export function classifySpec(raw) {
    const spec = String(raw ?? '').trim();
    if (!spec) {
        throw new Error('缺少安装目标（包 spec：包名 / file: / link: / git 地址 / tarball / 本机目录）');
    }

    const asLocal = () => {
        const target = spec.replace(/^(file|link):/i, '');
        const abs = path.resolve(target);
        if (!fs.existsSync(abs)) throw new Error(`本地路径不存在: ${abs}（spec: ${spec}）`);
        if (fs.statSync(abs).isDirectory()) {
            if (!fs.existsSync(path.join(abs, 'package.json'))) {
                throw new Error(
                    `本地目录不是 npm 包（缺 package.json）: ${abs}\n` +
                        `        插件要被包管理器装成依赖，目录里必须有 package.json（至少含 name 与 version）`
                );
            }
            return { kind: 'local', input: spec, spec: `file:${abs}`, dir: abs };
        }
        return { kind: 'tarball', input: spec, spec: abs, dir: null };
    };

    if (/^(file|link):/i.test(spec)) return asLocal();
    if (/^(git\+|git:|github:|gitlab:|bitbucket:|git@)/i.test(spec)) {
        return { kind: 'git', input: spec, spec, dir: null };
    }
    if (/^https?:/i.test(spec)) return { kind: 'tarball', input: spec, spec, dir: null };
    if (/\.(tgz|tar\.gz)$/i.test(spec) && !fs.existsSync(path.resolve(spec)) && !looksLikePath(spec)) {
        // `foo.tgz` 既不存在也不像路径：当成 registry 包名（npm 会报找不到）
        const { name, version } = splitRegistrySpec(spec);
        return { kind: 'registry', input: spec, spec, name, version, dir: null };
    }
    if (/\.(tgz|tar\.gz)$/i.test(spec)) return asLocal();
    if (looksLikePath(spec)) return asLocal();

    const { name, version } = splitRegistrySpec(spec);
    return { kind: 'registry', input: spec, spec, name, version, dir: null };
}

// ─── 兼容预检（engines.3rdloop）────────────────────────────────────

/**
 * 用 `npm view <spec> engines --json` 取 registry 包的 engines。
 *
 * 失败必须区分三种情况（错误消息直接展示给用户，不能一句"npm 失败"糊过去）：
 * 找不到包 / registry 不可达 / 其它。
 *
 * @param {string} spec
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, string>|null}
 */
function npmViewEngines(spec, env) {
    const res = runNpm(['view', spec, 'engines', '--json'], { env });
    const text = `${res.stderr}\n${res.stdout}`;
    if (res.status !== 0) {
        if (/E404|404 Not Found|is not in (this|the) registry/i.test(text)) {
            throw new Error(
                `找不到包: ${spec}（registry 上没有这个包）\n` +
                    `        检查包名拼写，或先 npm view ${spec} 确认它已发布`
            );
        }
        if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ERR_SOCKET|network|getaddrinfo/i.test(text)) {
            throw new Error(
                `无法访问 npm registry（预检 ${spec} 失败）\n` +
                    `        ${npmFailureDetail(res)}\n` +
                    `        网络/镜像不可用时无法做兼容预检，因此本次安装未执行；修好后重试，或直接 3rdloop plugin add <本机目录>`
            );
        }
        throw new Error(`npm view ${spec} engines 失败（exit=${res.status}）：\n        ${npmFailureDetail(res)}`);
    }
    const raw = res.stdout.trim();
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * 安装**之前**的兼容预检：目标包声明了 `engines['3rdloop']` 就必须满足当前 CLI 版本。
 *
 * 无声明 → 允许但给 warning（不能因为插件没写 engines 就装不上）。
 * 预检失败**不下载、不安装**，磁盘零改动。
 *
 * @param {object} opts
 * @param {ReturnType<typeof classifySpec>} opts.classified
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {string[]} opts.warnings - 出参：可展示的警告
 */
function precheckEngines({ classified, env, warnings }) {
    if (!CLI_VERSION) {
        warnings.push('读不到当前 CLI 版本，已跳过 engines.3rdloop 兼容预检');
        return;
    }

    let engines = null;
    const label = classified.input;
    if (classified.kind === 'local') {
        const pkg = readJsonIfExists(path.join(classified.dir, 'package.json'), '包 package.json');
        engines = pkg?.engines && typeof pkg.engines === 'object' ? pkg.engines : null;
    } else if (classified.kind === 'registry') {
        engines = npmViewEngines(classified.spec, env);
    } else {
        warnings.push(`来源是 ${classified.kind}，无法在安装前预检 engines.3rdloop（不兼容需手动卸载）`);
        return;
    }

    const range = engines?.['3rdloop'];
    if (range === undefined || range === null || String(range).trim() === '') {
        warnings.push('插件未声明 engines.3rdloop（无法预检它对 CLI 版本的要求）');
        return;
    }
    if (!satisfiesRange(CLI_VERSION, String(range))) {
        throw new Error(
            `插件与当前 CLI 不兼容：${label} 要求 engines.3rdloop = ${range}，当前 CLI 版本 ${CLI_VERSION}\n` +
                `        未做任何下载与安装（profile 目录一个字节都没动）。升级 CLI：3rdloop update`
        );
    }
}

// ─── profile 目录脚手架 / 回滚 ─────────────────────────────────────

/** 确保 profile 目录就绪：没有 package.json 就写一份最小私有清单（npm 安装的落脚点）。 */
function ensureProfileScaffold(ctx) {
    fs.mkdirSync(ctx.dir, { recursive: true });
    const pkgFile = path.join(ctx.dir, 'package.json');
    if (fs.existsSync(pkgFile)) return;
    const name = `3rdloop-profile-${ctx.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`;
    writeFileAtomic(pkgFile, `${JSON.stringify({ name, private: true, dependencies: {} }, null, 2)}\n`);
}

/** 读 profile 的 `dependencies`（不存在/损坏都当空，安装成败由 npm 判定）。 */
function readDependencies(pkgFile) {
    const pkg = readJsonIfExists(pkgFile, 'package.json');
    const deps = pkg?.dependencies;
    return deps && typeof deps === 'object' && !Array.isArray(deps) ? { ...deps } : {};
}

/** 列出 node_modules 里的顶层包（`@scope/name` 记两段，忽略 `.bin`/`.package-lock.json` 等点条目）。 */
function listInstalledPackages(modulesDir) {
    const found = new Set();
    if (!fs.existsSync(modulesDir)) return found;
    for (const entry of fs.readdirSync(modulesDir)) {
        if (entry.startsWith('.')) continue;
        const dir = path.join(modulesDir, entry);
        if (!entry.startsWith('@')) {
            found.add(entry);
            continue;
        }
        let inner = [];
        try {
            inner = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const name of inner) found.add(`${entry}/${name}`);
    }
    return found;
}

/** 备份一次写操作可能碰到的全部文件（字节级，回滚要一模一样）。 */
function snapshotWritable(ctx) {
    const pkgFile = path.join(ctx.dir, 'package.json');
    const lockFile = path.join(ctx.dir, 'package-lock.json');
    const overlayFile = overlayPath(ctx.name);
    return {
        dir: ctx.dir,
        modules: ctx.modules,
        pkgFile,
        lockFile,
        overlayFile,
        pkg: readBytesOrNull(pkgFile),
        lock: readBytesOrNull(lockFile),
        overlay: readBytesOrNull(overlayFile),
        modulesExisted: fs.existsSync(ctx.modules),
        modulesLock: readBytesOrNull(path.join(ctx.modules, '.package-lock.json')),
        packages: listInstalledPackages(ctx.modules),
    };
}

/** 把备份原样写回（不存在则删除），并清掉 npm 可能留下的残留。 */
function rollback(snapshot) {
    if (snapshot.pkg === null) fs.rmSync(snapshot.pkgFile, { force: true });
    else fs.writeFileSync(snapshot.pkgFile, snapshot.pkg);
    if (snapshot.lock === null) fs.rmSync(snapshot.lockFile, { force: true });
    else fs.writeFileSync(snapshot.lockFile, snapshot.lock);
    if (snapshot.overlay === null) fs.rmSync(snapshot.overlayFile, { force: true });
    else fs.writeFileSync(snapshot.overlayFile, snapshot.overlay);

    if (!snapshot.modulesExisted) {
        // 装之前没有 node_modules：整棵清掉（半装的包目录不能留）
        fs.rmSync(snapshot.modules, { recursive: true, force: true });
        return;
    }
    // 原本就有：只删"这次新装进来的包"，老包一个都不动；再清 npm 每次安装都会重写的残留锁
    for (const pkg of listInstalledPackages(snapshot.modules)) {
        if (snapshot.packages.has(pkg)) continue;
        fs.rmSync(path.join(snapshot.modules, ...pkg.split('/')), { recursive: true, force: true });
        const scope = pkg.startsWith('@') ? path.join(snapshot.modules, pkg.split('/')[0]) : '';
        if (scope && fs.existsSync(scope) && fs.readdirSync(scope).length === 0) fs.rmdirSync(scope);
    }
    const modulesLock = path.join(snapshot.modules, '.package-lock.json');
    if (snapshot.modulesLock === null) fs.rmSync(modulesLock, { force: true });
    else fs.writeFileSync(modulesLock, snapshot.modulesLock);
}

// ─── 安装 ─────────────────────────────────────────────────────────

/** 从 dependencies 差集推出真实注册名（`file:./x` 不是名字）。 */
function resolvePackageName({ before, after, classified }) {
    const changed = Object.keys(after).filter((key) => before[key] !== after[key]);
    const localName = classified.dir
        ? (readJsonIfExists(path.join(classified.dir, 'package.json'), '包 package.json')?.name ?? '')
        : '';
    if (changed.length === 1) return changed[0];
    if (changed.length > 1) {
        if (localName && changed.includes(localName)) return localName;
        return changed[0];
    }
    // 差集为空 = 同一 spec 重复安装（dependencies 没变）
    if (localName) return localName;
    return classified.kind === 'registry' ? classified.name : '';
}

/** 已装包的版本（读 node_modules 里的 package.json，而不是声明串）。 */
function installedVersion(modulesDir, pkgName) {
    if (!pkgName) return '';
    const pkg = readJsonIfExists(path.join(modulesDir, ...pkgName.split('/'), 'package.json'), '包 package.json');
    return typeof pkg?.version === 'string' ? pkg.version : '';
}

/** 从当前 profile 的 node_modules 里找插件清单（`plugin.json`）。 */
function readInstalledManifest(modulesDir, pkgName) {
    const pkgDir = path.join(modulesDir, ...pkgName.split('/'));
    const manifestFile = path.join(pkgDir, 'plugin.json');
    if (!fs.existsSync(manifestFile)) return { pkgDir, manifest: null };
    let manifest;
    try {
        manifest = JSON.parse(stripBom(fs.readFileSync(manifestFile, 'utf8')));
    } catch (err) {
        throw new Error(`plugin.json 解析失败 ${manifestFile}: ${err.message}`);
    }
    return { pkgDir, manifest };
}

/**
 * 安装插件到 profile（DSH 式：插件就是该 profile 的 npm 依赖）。
 *
 * 流程：spec 分类 → **兼容预检（不通过则不下载不安装）** → 备好 profile 目录 →
 * `npm install --save-exact --install-links` → 从 dependencies 差集推注册名 →
 * 写 `profile.json` 的 `enabled:true` → 用 `readState()` **复查**（装好 ≠ 宿主看得见）。
 * 任何一步失败（含复查失败）都按备份逐字节回滚。
 *
 * 必须带 `--install-links`：npm 默认把本地目录依赖装成 symlink（Windows 上是 junction），
 * 而内核 `discoverPluginDirs()` 用 `dirent.isDirectory()` 过滤，symlink 会被**直接跳过** ——
 * 不加这个开关，插件装进去了但宿主永远看不见。加了 npm 会真的复制文件进 node_modules。
 *
 * @param {object} opts
 * @param {string} [opts.spec] - 包 spec（包名 / `file:` / `link:` / git / tarball / 本机路径）
 * @param {string} [opts.dir]  - 旧参数：等价 `file:<绝对路径>`
 * @param {string} [opts.profile]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ok: true, name: string, pluginName: string, spec: string, version: string,
 *            source: 'profile', enabled: true, profileDir: string, dir: string,
 *            requiresRestart: true, warnings: string[]}}
 * @throws {Error} spec 非法 / engines 不满足 / npm 安装失败 / 装完不是插件 / 复查失败（均已回滚）
 */
export function installPlugin({ spec, dir, profile, env = process.env } = {}) {
    const input =
        typeof spec === 'string' && spec.trim()
            ? spec.trim()
            : typeof dir === 'string' && dir.trim()
              ? `file:${path.resolve(dir.trim())}`
              : '';
    const classified = classifySpec(input);
    const ctx = profileContext({ profile, env });
    const warnings = [];
    const snapshot = snapshotWritable(ctx);

    try {
        // 预检先于任何写盘：不兼容时 profile 目录一个字节都不动，也就没有回滚可言
        precheckEngines({ classified, env: ctx.env, warnings });
        ensureProfileScaffold(ctx);

        const pkgFile = path.join(ctx.dir, 'package.json');
        const before = readDependencies(pkgFile);
        const args = ['install', classified.spec, '--save-exact', '--no-audit', '--no-fund', '--install-links'];
        const res = runNpm(args, { cwd: ctx.dir, env: ctx.env });
        if (res.status !== 0) {
            throw new Error(
                `安装失败（${classified.spec}）：\n        ${npmFailureDetail(res)}\n` +
                    `        已回滚：profile 目录（${ctx.dir}）恢复原样`
            );
        }

        const after = readDependencies(pkgFile);
        const pkgName = resolvePackageName({ before, after, classified });
        if (!pkgName) {
            throw new Error(`安装失败：无法从 ${pkgFile} 的 dependencies 推出注册名（spec: ${classified.spec}）`);
        }

        const { pkgDir, manifest } = readInstalledManifest(ctx.modules, pkgName);
        if (!manifest) {
            throw new Error(
                `装的包不是 3rdloop 插件（缺 plugin.json）: ${path.join(pkgDir, 'plugin.json')}\n` +
                    `        已回滚：profile 目录恢复原样。插件包根必须有 plugin.json 清单`
            );
        }
        try {
            validateManifest(manifest, { source: path.join(pkgDir, 'plugin.json') });
        } catch (err) {
            throw new Error(`插件清单非法（已回滚）：${err.message}`);
        }
        const pluginName = manifest.name;

        // 先落启用状态（同时把目录式 profile 建出来），复查才有稳定的 profileDir 解析
        patchOverlay({
            profileName: ctx.name,
            mutate: (plugins) => {
                plugins[pluginName] = { ...(plugins[pluginName] ?? {}), enabled: true };
            },
        });

        const state = readState({ profile: ctx.name, env });
        const entry = state.plugins.find((p) => p.name === pluginName);
        if (!entry || !entry.installed || entry.source !== 'profile') {
            const why = !entry
                ? '宿主没有发现这个插件'
                : entry.source === 'builtin'
                  ? '同名内置插件已存在（内置优先）'
                  : `宿主看到的来源是 ${entry.source}`;
            throw new Error(`安装复查失败（已回滚）：${why}`);
        }

        return {
            ok: true,
            name: pkgName,
            pluginName,
            spec: classified.spec,
            version: installedVersion(ctx.modules, pkgName) || String(manifest.version ?? ''),
            seam: manifest.seam ?? '',
            dir: entry.dir,
            source: 'profile',
            enabled: true,
            profile: ctx.name,
            profileDir: ctx.dir,
            requiresRestart: true,
            warnings,
        };
    } catch (err) {
        rollback(snapshot);
        throw err;
    }
}

// ─── 卸载 ─────────────────────────────────────────────────────────

/** 由 node_modules 里的目录反推注册名（`@scope/name` 要取两段）。 */
function packageNameOfDir(dir, modulesDir) {
    if (!dir) return '';
    const rel = path.relative(path.resolve(modulesDir), path.resolve(dir)).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) return '';
    const parts = rel.split('/');
    return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** npm 卸载后 node_modules 是否已空（忽略 npm 自己的锁文件与空 `.bin`）。 */
function isEmptyModulesDir(modulesDir) {
    if (!fs.existsSync(modulesDir)) return false;
    const rest = fs.readdirSync(modulesDir).filter((entry) => {
        if (entry === '.package-lock.json') return false;
        if (entry !== '.bin') return true;
        const binDir = path.join(modulesDir, entry);
        return fs.existsSync(binDir) && fs.readdirSync(binDir).length > 0;
    });
    return rest.length === 0;
}

/** 清掉已空的 node_modules 与其 `.package-lock.json`（DSH：profile 目录只该留下 profile.json/package.json）。 */
function pruneEmptyModules(modulesDir) {
    if (!isEmptyModulesDir(modulesDir)) return false;
    fs.rmSync(path.join(modulesDir, '.package-lock.json'), { force: true });
    fs.rmSync(modulesDir, { recursive: true, force: true });
    return true;
}

/**
 * 从当前 profile 卸载一个 npm 装进来的插件（`npm uninstall`）。
 *
 * @param {object} opts
 * @param {ReturnType<typeof profileContext>} opts.ctx
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {string} opts.packageName - npm 注册名
 * @param {string[]} opts.pluginNames - 要从 profile.json 删掉的插件条目名
 */
function uninstallFromProfile({ ctx, env, packageName, pluginNames }) {
    const snapshot = snapshotWritable(ctx);
    try {
        const res = runNpm(['uninstall', packageName, '--no-audit', '--no-fund'], { cwd: ctx.dir, env });
        if (res.status !== 0) {
            throw new Error(
                `卸载失败（${packageName}）：\n        ${npmFailureDetail(res)}\n` +
                    `        已回滚：profile 目录（${ctx.dir}）恢复原样`
            );
        }

        patchOverlay({
            profileName: ctx.name,
            mutate: (plugins) => {
                for (const name of pluginNames) delete plugins[name];
            },
        });

        const state = readState({ profile: ctx.name, env });
        for (const name of pluginNames) {
            const left = state.plugins.find((p) => p.name === name);
            if (left?.installed && left.source === 'profile') {
                throw new Error(`卸载复查失败（已回滚）：${name} 仍被发现于 ${left.dir}`);
            }
        }
        const pruned = isEmptyModulesDir(ctx.modules) ? pruneEmptyModules(ctx.modules) : false;
        return { pruned };
    } catch (err) {
        rollback(snapshot);
        throw err;
    }
}

/**
 * 卸载插件。
 *
 * 三种来源三套语义（不能混）：
 *   - `builtin`：拒绝（随核心包发布，卸载请走包管理器）；
 *   - `profile`：`npm uninstall`（插件是 profile 的 npm 依赖）；
 *   - `user`：沿用旧逻辑（删 `~/.3lib/plugins/<name>` 目录，并清掉变空的组目录）。
 *
 * `name` 既接受插件名（`m15/demo`）也接受 npm 注册名（`m15-demo-plugin`）。
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} [opts.profile]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ok: true, name: string, dir: string, packageName?: string, removed: true,
 *            profile: string, profileDir: string, requiresRestart: true}}
 */
export function removePlugin({ name, profile, env = process.env }) {
    if (!name) throw new Error('缺少插件名（卸载需要插件名）');
    const ctx = profileContext({ profile, env });
    const state = readState({ profile: ctx.name, env });
    const target = state.plugins.find((p) => p.name === name);

    if (target?.source === 'builtin') {
        throw new Error(
            `插件 ${name} 是内置插件（${target.dir}），不能卸载。\n` +
                `        内置插件随核心包发布，卸载请走包管理器；只想起停用它：3rdloop plugin disable ${name}`
        );
    }

    if (target?.source === 'profile') {
        const packageName =
            packageNameOfDir(target.dir, ctx.modules) ||
            (readInstalledManifest(ctx.modules, name).manifest ? name : '');
        if (!packageName) throw new Error(`无法从 ${target.dir} 反推 npm 包名，拒绝卸载（请手工处理该目录）`);
        uninstallFromProfile({ ctx, env: ctx.env, packageName, pluginNames: [target.name] });
        return {
            ok: true,
            name: target.name,
            dir: target.dir,
            packageName,
            removed: true,
            profile: ctx.name,
            profileDir: ctx.dir,
            requiresRestart: true,
        };
    }

    if (target?.source === 'user') return removeUserPlugin({ ctx, target, env });

    // 未知 / 未安装：`name` 可能就是 npm 注册名（例如 `plugin add foo@1.0.0` 后想按包名卸载）
    const deps = readDependencies(path.join(ctx.dir, 'package.json'));
    const pkgName = Object.keys(deps).find((key) => key === name) ?? '';
    if (pkgName) {
        const { manifest } = readInstalledManifest(ctx.modules, pkgName);
        const pluginNames = [manifest?.name ?? pkgName];
        uninstallFromProfile({ ctx, env: ctx.env, packageName: pkgName, pluginNames });
        return {
            ok: true,
            name,
            dir: path.join(ctx.modules, ...pkgName.split('/')),
            packageName: pkgName,
            removed: true,
            profile: ctx.name,
            profileDir: ctx.dir,
            requiresRestart: true,
        };
    }

    if (!target) {
        const known = state.plugins.map((p) => p.name).join(', ');
        throw new Error(`未知插件: ${name}（已发现: ${known || '无'}）`);
    }
    throw new Error(
        `插件 ${name} 未安装（profile 提到了它，但插件根里没有目录），无需卸载。\n` +
            `        插件根: ${(state.roots ?? []).join('、') || '（无）'}`
    );
}

/** 旧逻辑：删 `~/.3lib/plugins/<name>` 目录（内置拒绝、越界拒绝、顺手清空组目录）。 */
function removeUserPlugin({ ctx, target, env }) {
    const dir = path.resolve(target.dir);
    if (!isUnder(dir, USER_PLUGINS_DIR)) throw new Error(`拒绝删除用户插件根之外的路径: ${dir}`);

    fs.rmSync(dir, { recursive: true, force: true });
    let parent = path.dirname(dir);
    while (isUnder(parent, USER_PLUGINS_DIR) && path.resolve(parent) !== path.resolve(USER_PLUGINS_DIR)) {
        const rest = fs.readdirSync(parent);
        if (rest.length > 0) break;
        fs.rmdirSync(parent);
        parent = path.dirname(parent);
    }
    const after = readState({ profile: ctx.name, env }).plugins.find((p) => p.name === target.name);
    if (after?.installed && after.source === 'user') throw new Error(`卸载未生效：${after.name} 仍被发现于 ${after.dir}`);

    return { ok: true, name: target.name, dir, removed: true, profile: ctx.name, requiresRestart: true };
}

// ─── 静态检查 ─────────────────────────────────────────────────────

/** 声明串是否为精确版本（`1.2.3`，不带范围符号）——只有这种能直接比"与已装一致"。 */
function isPlainVersion(text) {
    return /^\d+\.\d+\.\d+\S*$/.test(String(text ?? '').trim());
}

/**
 * 校验 profile 与内置 profile 合并后能否装起来（不启动服务）。
 *
 * 做四件事：条目可用性 / 依赖闭合 / **必需接缝是否仍有提供方** / **profile 插件版本是否与已装一致**。
 * 真正的装配仍以 `buildApp({host})` 为准（这里不替它下结论），但结论必须与它同向。
 *
 * @param {object} [opts]
 * @param {string} [opts.profile]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ok: boolean, errors: string[], warnings: string[], state: object}}
 */
export function check({ profile, env = process.env } = {}) {
    const state = readState({ profile, env });
    const errors = [];
    const warnings = [];

    for (const p of state.plugins) {
        if (!p.installed) {
            warnings.push(`${p.name}：profile 提到但未安装（忽略）`);
            continue;
        }
        if (p.required && !p.enabled) {
            errors.push(`${p.name}：required 但被禁用 —— 启动会 fail closed`);
        }
        for (const dep of p.dependencies) {
            const target = state.plugins.find((x) => x.name === dep);
            if (p.enabled && (!target || !target.installed)) {
                errors.push(`${p.name}：依赖 ${dep} 不存在`);
            } else if (p.enabled && target && !target.enabled) {
                errors.push(`${p.name}：依赖 ${dep} 被禁用`);
            }
        }
    }

    // profile 插件的版本一致性：`package.json` 声明的是包管理器的事实，与 node_modules 里
    // 真装的对不上 → 用户可能在别处手改过，或装完没跑 npm install（运行期加载的是后者）
    const modulesDir = path.join(state.profileDir, 'node_modules');
    const declaredDeps = readDependencies(path.join(state.profileDir, 'package.json'));
    for (const p of state.plugins) {
        if (p.source !== 'profile') continue;
        const packageName = packageNameOfDir(p.dir, modulesDir);
        if (!packageName) continue;
        const installed = installedVersion(modulesDir, packageName);
        const declared = declaredDeps[packageName];
        if (declared === undefined) {
            warnings.push(`${p.name}：profile 的 package.json 未声明依赖 ${packageName}（可能被手工改过）`);
            continue;
        }
        if (installed && isPlainVersion(declared) && declared !== installed) {
            warnings.push(`${p.name}：package.json 声明 ${declared}，实际已装 ${installed}（版本不一致）`);
        }
    }

    // 必需接缝必须有启用中的提供方（这条曾经漏掉：禁用 engines/brain 后 check 仍报 ok，
    // 而 buildApp 立刻 fail closed —— 静态检查与真实装配结论相反）
    for (const seam of REQUIRED_SEAMS) {
        const info = state.seams[seam];
        if (!info || info.providers.length === 0) {
            const owner = seam.replace(/^engine-/, '');
            errors.push(
                `接缝 ${seam} 没有启用中的提供方 —— 装配会 fail closed（启用插件 engines/${owner}）`
            );
        }
    }

    for (const [seam, info] of Object.entries(state.seams)) {
        if (info.conflict) {
            warnings.push(`接缝 ${seam} 有多个提供方（${info.providers.join('、')}），生效者靠限定名或首个：${info.effective}`);
        }
    }
    const enabledCount = state.plugins.filter((p) => p.enabled).length;
    if (enabledCount === 0) errors.push('没有任何启用的插件 —— 装配必然失败');

    return { ok: errors.length === 0, errors, warnings, state };
}

export { loadProfile, USER_PLUGINS_DIR };
