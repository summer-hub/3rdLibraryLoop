/**
 * plugin-store.js — 插件状态的**唯一读写入口**（CLI 与 Web 共用）
 *
 * 为什么单独一层：`3rdloop plugin ...` 与前端「插件」页必须看到同一份数据、走同一套校验，
 * 否则两边判定迟早漂移（一边允许禁用 required、一边拒绝）。所以：
 *   - 读：`readState()` → `PluginHost.describe()`（内核只读描述，不装配、不触发 setup）
 *   - 写：`setEnabled()` → 用户级 overlay（`~/.3lib/3rdloop/profiles/<profile>.json`）
 *
 * **绝不写包内 profile**：发布态 profile 在 `node_modules/@ohos-cpf/3rdloop_core/profiles/`，
 * 改它既越权又会在下次 `3rdloop update` 时丢掉。overlay 是包外的、升级后仍然生效。
 *
 * 生效语义：overlay 在**进程启动**时被读取（`PluginHost.load`），所以改完需重启
 * `3rdloop serve` / 下一次命令才会生效。本模块只负责把"需要重启"这件事如实回传。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginHost, USER_PLUGINS_DIR, USER_PROFILES_DIR, loadProfile, validateManifest } from '../../core/index.js';

/** 用户级 overlay 目录（包外、可写、升级不丢） */
export const OVERLAY_DIR = USER_PROFILES_DIR;

/**
 * 用户 profile 的 overlay 文件路径。
 * @param {string} profile
 * @returns {string}
 */
export function overlayPath(profile) {
    return path.join(OVERLAY_DIR, `${profile}.json`);
}

/**
 * 读取用户 overlay（不存在返回空壳）。
 * @param {string} profile
 * @returns {{plugins: Record<string, object>, description?: string, exists: boolean, path: string}}
 */
export function readOverlay(profile) {
    const file = overlayPath(profile);
    if (!fs.existsSync(file)) return { plugins: {}, exists: false, path: file };
    try {
        // 手写文件可能带 UTF-8 BOM（Windows 记事本），JSON.parse 会因此报"非法字符"。
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
        const plugins = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed.plugins ?? {}) : {};
        return { plugins, description: parsed?.description, exists: true, path: file };
    } catch (err) {
        throw new Error(`用户 profile 解析失败 ${file}: ${err.message}`);
    }
}

/**
 * 读取当前插件状态（只读、不装配）。
 *
 * @param {object} [opts]
 * @param {string} [opts.profile]        - profile 名（缺省取 env `3LIB_PLUGIN_PROFILE` → `default`）
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {object} `PluginHost.describe()` 的结果 + `overlay: {path, exists}`（供 CLI/UI 显示写入位置）
 */
export function readState({ profile, env = process.env } = {}) {
    const host = new PluginHost({ env });
    const state = host.describe();
    const overlay = readOverlay(state.profile);
    return {
        ...state,
        profileName: state.profile,
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
                `        装插件: 把插件目录放到 ${path.join(os.homedir(), '.3lib', 'plugins')}/<name>/ 后重试。`
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
 * 写入一次开关到用户 overlay（原子写：先写 `.tmp` 再 rename）。
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {boolean} opts.enabled
 * @param {string} [opts.profile]
 * @param {boolean} [opts.force]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ok: true, name: string, enabled: boolean, file: string, warnings: string[], requiresRestart: true}}
 */
export function setEnabled({ name, enabled, profile, force = false, env = process.env }) {
    const state = readState({ profile, env });
    const { warnings = [] } = validateToggle({ name, enabled, state, force });

    const overlay = readOverlay(state.profile);
    const next = {
        name: state.profile,
        description: overlay.description ?? `用户级插件开关（由 3rdloop plugin 维护，覆盖内置 profile）`,
        plugins: { ...overlay.plugins },
    };
    const prev = next.plugins[name] ?? {};
    next.plugins[name] = { ...prev, enabled: Boolean(enabled) };

    fs.mkdirSync(OVERLAY_DIR, { recursive: true });
    const tmp = `${overlay.path}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, overlay.path);

    return {
        ok: true,
        name,
        enabled: Boolean(enabled),
        file: overlay.path,
        profile: state.profile,
        warnings,
        requiresRestart: true,
    };
}

/**
 * 装配点**硬性需要**的接缝：`Server/composition/buildApp.js` 在 `engineSeams:'require'`
 * （默认）下缺任何一条都会 fail closed。`check()` 必须按同一口径判定，否则会出现
 * "静态检查说没事、启动却炸了"——这比不检查更糟。
 */
export const REQUIRED_SEAMS = Object.freeze([
    'engine-brain',
    'engine-knowledge',
    'engine-loop',
    'engine-orchestrator',
    'engine-testcheck',
]);

/**
 * 校验 overlay 与内置 profile 合并后能否装起来（不启动服务）。
 *
 * 做三件事：条目可用性 / 依赖闭合 / **必需接缝是否仍有提供方**。
 * 真正的装配仍以 `buildApp({host})` 为准（这里不替它下结论），但结论必须与它同向。
 *
 * @param {object} [opts]
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

/** 判断 target 是否在 root 之下（统一分隔符与大小写，Windows 上大小写不同不算越界）。 */
function isUnder(target, root) {
    const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
    const t = norm(target);
    const r = norm(root);
    return t === r || t.startsWith(`${r}/`);
}

/** 去 UTF-8 BOM（手写/记事本保存的 plugin.json 会带，JSON.parse 会因此报非法字符）。 */
function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 安装插件目录到 `~/.3lib/plugins/<name>/`（CLI `plugin add` 与前端「安装插件」共用）。
 *
 * 复制前校验清单（复用内核 `validateManifest`，与宿主扫描同一套判定），复制后用
 * `readState()` **复查**——"命令说装好了"不算数，"宿主能看见且来源是 user"才算；
 * 复查失败即回滚，不留幽灵目录。
 *
 * @param {object} opts
 * @param {string} opts.dir - 源插件目录
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{name: string, dir: string, version: string, seam: string, source: string, enabled: boolean, requiresRestart: true}}
 * @throws {Error} 目录不存在 / 缺清单 / 清单非法 / 目标已存在 / 复查失败（已回滚）
 */
export function installPlugin({ dir, env = process.env }) {
    if (!dir) throw new Error('缺少插件目录（安装需要插件目录路径）');

    const source = path.resolve(dir);
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
        throw new Error(`插件目录不存在或不是目录: ${source}`);
    }
    const manifestFile = path.join(source, 'plugin.json');
    if (!fs.existsSync(manifestFile)) throw new Error(`目录里没有 plugin.json: ${manifestFile}`);

    let manifest;
    try {
        manifest = JSON.parse(stripBom(fs.readFileSync(manifestFile, 'utf8')));
    } catch (err) {
        throw new Error(`plugin.json 解析失败 ${manifestFile}: ${err.message}`);
    }
    try {
        validateManifest(manifest, { source: manifestFile });
    } catch (err) {
        throw new Error(err.message);
    }
    // 安装要求四项齐全：缺字段的清单装了也无法被发现/装载
    for (const key of ['name', 'version', 'seam', 'entry']) {
        if (typeof manifest[key] !== 'string' || manifest[key] === '') {
            throw new Error(`${manifestFile} 缺少 ${key}（安装要求 name/version/seam/entry 齐全）`);
        }
    }

    const name = manifest.name;
    const target = path.join(USER_PLUGINS_DIR, ...name.split('/'));
    if (!isUnder(target, USER_PLUGINS_DIR)) throw new Error(`插件名非法（越出用户插件根）: ${name}`);
    if (fs.existsSync(target)) throw new Error(`目标目录已存在: ${target}（先卸载旧版再装）`);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });

    const entry = readState({ env }).plugins.find((p) => p.name === name);
    if (!entry || !entry.installed || entry.source !== 'user') {
        fs.rmSync(target, { recursive: true, force: true });
        const why = !entry
            ? '宿主没有发现这个插件'
            : entry.source === 'builtin'
              ? '同名内置插件已存在（先到者胜，内置优先）'
              : `宿主看到的是 ${entry.source} 来源`;
        throw new Error(`安装复查失败（已回滚 ${target}）：${why}`);
    }

    return {
        name,
        dir: entry.dir,
        version: manifest.version,
        seam: manifest.seam,
        source: entry.source,
        enabled: entry.enabled,
        requiresRestart: true,
    };
}

/**
 * 卸载用户级插件（只删 `~/.3lib/plugins/<name>`，内置插件拒绝）。
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{name: string, dir: string, removed: true, requiresRestart: true}}
 * @throws {Error} 未知插件 / 未安装 / 内置插件 / 越界路径 / 卸载未生效
 */
export function removePlugin({ name, env = process.env }) {
    if (!name) throw new Error('缺少插件名（卸载需要插件名）');

    const state = readState({ env });
    const target = state.plugins.find((p) => p.name === name);
    if (!target) {
        const known = state.plugins.map((p) => p.name).join(', ');
        throw new Error(`未知插件: ${name}（已发现: ${known || '无'}）`);
    }
    if (!target.installed) throw new Error(`插件 ${name} 未安装（profile 提到了它，但插件根里没有目录），无需卸载`);
    if (target.source !== 'user') {
        throw new Error(
            `插件 ${name} 是内置插件（${target.dir}），不能卸载。\n` +
                `        内置插件随核心包发布，卸载请走包管理器；只想起停用它：3rdloop plugin disable ${name}`
        );
    }

    const dir = path.resolve(target.dir);
    // 删除前二次确认：目录来自磁盘扫描结果，不该有任何越界余地
    if (!isUnder(dir, USER_PLUGINS_DIR)) throw new Error(`拒绝删除用户插件根之外的路径: ${dir}`);

    fs.rmSync(dir, { recursive: true, force: true });
    // 顺手清掉空的组目录（如 demo/echo 卸载后留下空的 demo/）——否则用户插件根会积一堆空壳
    let parent = path.dirname(dir);
    while (isUnder(parent, USER_PLUGINS_DIR) && path.resolve(parent) !== path.resolve(USER_PLUGINS_DIR)) {
        const rest = fs.readdirSync(parent);
        if (rest.length > 0) break;
        fs.rmdirSync(parent);
        parent = path.dirname(parent);
    }
    const after = readState({ env }).plugins.find((p) => p.name === name);
    if (after?.installed) throw new Error(`卸载未生效：${name} 仍被发现于 ${after.dir}`);

    return { name, dir, removed: true, requiresRestart: true };
}
