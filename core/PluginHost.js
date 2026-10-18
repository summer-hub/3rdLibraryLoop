/**
 * PluginHost.js — 插件宿主：加载 / 生命周期 / 查询 / 回收
 *
 * 宿主是整套插件系统的"操作系统内核"，对应 DSH 的 Harness 角色：
 *   - 只做加载插件、管理生命周期、维护上下文，**自身零业务逻辑**；
 *   - 所有能力（AI CLI、LLM、存储、引擎、HTTP……）都是挂上来的插件；
 *   - 禁用/替换任何插件都不需要改宿主——这正是"一切即插件"的检验标准。
 *
 * 生命周期：
 *   load()  → scan → profile 过滤 → topoSort → 逐个 setup(ctx)（登记 disposer）
 *   dispose() → 逆序执行各插件 disposer（可逆效果，热替换/关停不残留）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginContext } from './Context.js';
import { loadPluginEntry, scanPluginRoots, topoSort } from './PluginLoader.js';
import { loadProfile, mergePluginRoots, resolveProfileDir, resolvePluginState, USER_PROFILES_DIR } from './Profile.js';

/** 仓库内置插件根目录（core/ 的上一级 plugins/） */
const BUILTIN_PLUGINS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

/** 仓库内置 profile 目录（core/ 的上一级 profiles/） */
const BUILTIN_PROFILES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'profiles');

/** 用户级插件根目录（与 3rdloop CLI 数据目录同源：~/.3lib） */
const USER_PLUGINS_DIR = path.join(os.homedir(), '.3lib', 'plugins');

/**
 * 判断 dir 是否在 root 之下（用于标出插件来源：内置 / 用户）。
 * 统一分隔符与大小写，避免 Windows 上大小写不同被误判成"用户插件"。
 */
function isUnder(dir, root) {
    const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
    const d = norm(dir);
    const r = norm(root);
    return d === r || d.startsWith(`${r}/`);
}

export class PluginHost {
    /**
     * @param {object} [opts]
     * @param {string[]} [opts.roots]        - 插件根目录（按优先级）
     * @param {string} [opts.profilesDir]    - profile 目录（默认仓库 profiles/）
     * @param {NodeJS.ProcessEnv} [opts.env] - 环境变量来源（测试可注入）
     * @param {(msg: string) => void} [opts.logger]
     */
    constructor({ roots = null, profilesDir = null, env = process.env, logger = null } = {}) {
        this._roots = roots ?? [BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR];
        // profile 目录默认是「内置 + 用户 overlay」两级：用户级写在包外
        // （`~/.3lib/3rdloop/profiles`），发布态可写、升级不丢，见 USER_PROFILES_DIR 的说明。
        this._profilesDir = profilesDir ?? [BUILTIN_PROFILES_DIR, USER_PROFILES_DIR];
        this._env = env;
        this._log = logger ?? (() => {});
        this._rootContext = null;
        this._plugins = [];        // 已加载插件记录（加载顺序）
        this._profile = null;
        this._disposed = false;
    }

    get root() { return this._rootContext; }
    get profile() { return this._profile; }
    get loaded() { return this._plugins.map((p) => p.name); }
    get profileDirs() { return Array.isArray(this._profilesDir) ? [...this._profilesDir] : [this._profilesDir]; }
    get roots() { return mergePluginRoots(this._roots, this._env); }

    /**
     * 当前 profile 的目录（DSH 式：一个 profile 一个目录，插件装在其 node_modules 里）。
     * @param {string} [profileName]
     */
    profileDirFor(profileName) {
        return resolveProfileDir({ profilesDir: this._profilesDir, name: profileName, env: this._env });
    }

    /**
     * 实际扫描的插件根：内置 → **当前 profile 的 node_modules**（模拟 DSH 的 profile 依赖）
     * → 用户全局 → env 额外根。profile 的 node_modules 存在才加入，避免制造空根。
     */
    rootsFor(profileName) {
        const dir = this.profileDirFor(profileName);
        const profileModules = path.join(dir, 'node_modules');
        const base = [...this._roots];
        if (fs.existsSync(profileModules)) base.splice(1, 0, profileModules);
        return mergePluginRoots(base, this._env);
    }

    /**
     * 只读描述当前插件状况——**不装配**，不触发任何插件 setup。
     *
     * CLI（`3rdloop plugin list`）与 Web（`GET /api/plugins`）共用这一份数据，
     * 避免两处各写一套判定逻辑而慢慢漂移。已 load 过时会额外标出实际加载结果。
     *
     * @returns {{
     *   profile: string,
     *   profileDirs: string[],
     *   overlayDir: string,
     *   roots: string[],
     *   plugins: Array<object>,
     *   seams: Record<string, {providers: string[], conflict: boolean, effective: string|null}>,
     *   conflicts: Array<{name: string, kept: string, skipped: string}>,
     * }}
     */
    describe() {
        const profile = typeof this._profile === 'object' && this._profile
            ? this._profile
            : loadProfile({ profilesDir: this._profilesDir, env: this._env });
        // 必须用 rootsFor(profile)：profile 目录的 node_modules 里装的是 npm 插件包，
        // 用 this.roots（不含它）会让 describe() 把它们永远报成 missing——
        // 而 load() 又明明能加载到，两者结论会相反（下拉/CLI 显示"未安装"、实际在跑）。
        const roots = this.rootsFor(profile.name);
        const { entries, conflicts } = scanPluginRoots(roots);
        const scanned = new Map(entries.map((e) => [e.manifest.name, e]));
        const loadedNow = new Set(this.loaded);

        // profile 里提到但没装上的条目也要露出来（否则用户以为 profile 写错了而查不到原因）
        const mentioned = Object.keys(profile.plugins ?? {});
        const names = [...new Set([...scanned.keys(), ...mentioned])].sort();

        const plugins = names.map((name) => {
            const entry = scanned.get(name);
            const state = resolvePluginState({
                pluginName: name,
                defaults: {},
                profile,
                env: this._env,
                overrides: {},
            });
            const manifest = entry?.manifest ?? { name, version: null, seam: null, entry: null, dependencies: [] };
            const dir = entry?.dir ?? null;
            return {
                name,
                version: manifest.version ?? null,
                seam: manifest.seam ?? null,
                entry: manifest.entry ?? null,
                dependencies: [...(manifest.dependencies ?? [])],
                installed: Boolean(entry),
                dir,
                source: dir
                    ? isUnder(dir, BUILTIN_PLUGINS_DIR)
                        ? 'builtin'
                        : isUnder(dir, path.join(this.profileDirFor(profile.name), 'node_modules'))
                          ? 'profile'
                          : 'user'
                    : 'missing',
                enabled: Boolean(state.enabled) && Boolean(entry),
                required: Boolean(state.required),
                reason: state.reason ?? null,
                options: state.options ?? {},
                loaded: loadedNow.has(name),
            };
        });

        // 反向依赖：谁声明依赖我（只在启用且已安装的插件之间算，避免误导）
        const byName = new Map(plugins.map((p) => [p.name, p]));
        for (const p of plugins) {
            p.dependents = [];
            p.dependencies = p.dependencies.filter((dep) => byName.has(dep) || scanned.has(dep));
        }
        for (const p of plugins) {
            if (!p.enabled) continue;
            for (const dep of p.dependencies) {
                const target = byName.get(dep);
                if (target) target.dependents.push(p.name);
            }
        }

        // 接缝 → 提供方；同一接缝多个**启用**提供方即为冲突（谁生效靠限定名，不靠顺序）
        const seams = {};
        for (const p of plugins) {
            if (!p.seam || !p.enabled) continue;
            if (!seams[p.seam]) seams[p.seam] = { providers: [], conflict: false, effective: null };
            seams[p.seam].providers.push(p.name);
            seams[p.seam].conflict = seams[p.seam].providers.length > 1;
            if (!seams[p.seam].effective) seams[p.seam].effective = p.name;
        }

        return {
            profile: profile.name,
            profileDirs: this.profileDirs,
            overlayDir: USER_PROFILES_DIR,
            roots,
            plugins,
            seams,
            conflicts,
        };
    }

    /**
     * 扫描 + 加载全部启用插件。
     *
     * @param {object} [opts]
     * @param {string|object} [opts.profile]  - profile 名或已解析的 profile 对象
     * @param {Record<string, {enabled?: boolean, options?: object}>} [opts.pluginOverrides] - 按插件名显式覆盖
     * @param {string[]} [opts.only]          - 只加载这些插件（调试/测试用；依赖仍会自动补齐）
     * @returns {Promise<{loaded: string[], skipped: Array<{name: string, reason: string}>, conflicts: object[]}>}
     */
    async load({ profile, pluginOverrides = {}, only = null } = {}) {
        if (this._disposed) throw new Error('PluginHost 已 dispose，不能再次 load');
        if (this._rootContext) throw new Error('PluginHost 已加载，重复 load 请先 dispose');

        this._profile = typeof profile === 'string' || profile === undefined
            ? loadProfile({ profilesDir: this._profilesDir, name: profile, env: this._env })
            : profile;

        const profileName = typeof profile === 'string' ? profile : this._profile?.name;
        const roots = this.rootsFor(profileName);
        const { entries, conflicts } = scanPluginRoots(roots);
        for (const c of conflicts) {
            this._log(`[plugin-host] 同名插件 ${c.name}：采用 ${c.kept}，跳过 ${c.skipped}`);
        }

        // required 契约（fail closed）：profile 显式声明 required:true 的插件必须真的被加载。
        // 旧实现只在「扫描到的条目」上校验 required，于是 required 插件的目录根本不存在时
        // 循环里没有这一项 → 静默通过，与 profiles/default.json 的承诺相反。
        // 边界：只校验 profile 显式提及的条目——未提及 = 未安装、不关心（兼容空 profile 的最小部署）；
        // `only` 是显式调试豁免，被它排除的插件不做 required 校验。
        const scannedNames = new Set(entries.map((e) => e.manifest.name));
        for (const [name, decl] of Object.entries(this._profile?.plugins ?? {})) {
            if (!decl || typeof decl !== 'object' || decl.required !== true) continue;
            if (only && !only.includes(name)) continue;
            const state = resolvePluginState({
                pluginName: name,
                defaults: {},
                profile: this._profile,
                env: this._env,
                overrides: pluginOverrides[name] ?? {},
            });
            if (!state.enabled) {
                throw new Error(
                    `插件 ${name} 被标记 required，但被禁用（${state.reason ?? '未知原因'}）——required 插件缺一不可`
                );
            }
            if (!scannedNames.has(name)) {
                throw new Error(
                    `插件 ${name} 被标记 required，但未安装（插件根: ${roots.join(', ') || '（无）'}；` +
                        `已装: ${[...scannedNames].sort().join(', ') || '（无）'}）——required 插件缺一不可`
                );
            }
        }

        // profile 过滤 + only 过滤
        const skipped = [];
        const candidates = [];
        for (const entry of entries) {
            const name = entry.manifest.name;
            const state = resolvePluginState({
                pluginName: name,
                defaults: {}, // 插件默认配置在入口加载后合并（见下）
                profile: this._profile,
                env: this._env,
                overrides: pluginOverrides[name] ?? {},
            });
            if (only && !only.includes(name)) {
                skipped.push({ name, reason: 'only 过滤' });
                continue;
            }
            if (!state.enabled) {
                if (state.required) {
                    throw new Error(`插件 ${name} 被标记 required，但不能禁用（${state.reason ?? '未知原因'}）`);
                }
                skipped.push({ name, reason: state.reason ?? 'profile 禁用' });
                continue;
            }
            candidates.push(entry);
        }

        // only 模式下把缺失依赖自动补齐（保证被选中插件的依赖闭合）
        if (only) {
            const selected = new Set(candidates.map((e) => e.manifest.name));
            const queue = [...selected];
            while (queue.length > 0) {
                const cur = queue.shift();
                const entry = entries.find((e) => e.manifest.name === cur);
                for (const dep of entry.manifest.dependencies) {
                    if (!selected.has(dep)) {
                        selected.add(dep);
                        candidates.push(entries.find((e) => e.manifest.name === dep));
                        queue.push(dep);
                    }
                }
            }
        }

        const ordered = topoSort(candidates);

        this._rootContext = new PluginContext({
            name: 'root',
            logger: (msg) => this._log(msg),
        });

        for (const entry of ordered) {
            const def = await loadPluginEntry(entry);
            const state = resolvePluginState({
                pluginName: def.name,
                defaults: def.config,
                profile: this._profile,
                env: this._env,
                overrides: pluginOverrides[def.name] ?? {},
            });
            const ctx = new PluginContext({
                name: def.name,
                parent: this._rootContext,
                config: state.options,
                services: this._rootContext._services,
                listeners: this._rootContext._listeners,
                logger: (msg) => this._log(msg),
            });
            let disposer;
            try {
                disposer = await def.setup(ctx);
            } catch (err) {
                throw new Error(`插件 ${def.name} setup 失败: ${err.message}`);
            }
            if (typeof disposer === 'function') ctx.addDisposer(disposer);
            this._plugins.push({
                name: def.name,
                version: def.version,
                seam: def.seam,
                dir: entry.dir,
                ctx,
                status: 'active',
            });
            this._log(`[plugin-host] 已加载插件 ${def.name}@${def.version}${def.seam ? ` (seam: ${def.seam})` : ''}`);
        }

        return { loaded: this.loaded, skipped, conflicts };
    }

    /** 宿主级事件监听（供应用代码挂扩展点，如 server.js 挂路由） */
    on(eventName, handler, opts) {
        if (!this._rootContext) throw new Error('PluginHost 尚未 load');
        return this._rootContext.on(eventName, handler, opts);
    }

    /** 发射类型化事件 */
    emit(eventName, payload, opts) {
        if (!this._rootContext) throw new Error('PluginHost 尚未 load');
        return this._rootContext.emit(eventName, payload, opts);
    }

    /**
     * 消费服务（能力接缝）。
     * @param {string} serviceName - 裸名（当前生效提供方）或限定名 `seam@plugin`
     */
    inject(serviceName) {
        if (!this._rootContext) throw new Error('PluginHost 尚未 load');
        return this._rootContext.inject(serviceName);
    }

    /** 服务是否存在 */
    has(serviceName) {
        return this._rootContext?.has(serviceName) ?? false;
    }

    /** 列出已加载插件（供 `3rdloop plugin list`） */
    list() {
        return this._plugins.map((p) => ({
            name: p.name,
            version: p.version,
            seam: p.seam,
            dir: p.dir,
            status: p.status,
        }));
    }

    /** 列出已注册服务（接缝 → 提供方） */
    listServices() {
        if (!this._rootContext) return [];
        return [...this._rootContext._services.entries()]
            .filter(([name]) => !name.includes('@'))
            .map(([name, hit]) => ({ service: name, provider: hit.provider }))
            .sort((a, b) => a.service.localeCompare(b.service));
    }

    /** 逆序回收全部插件（可逆效果） */
    async dispose() {
        if (this._disposed) return;
        this._disposed = true;
        for (const plugin of [...this._plugins].reverse()) {
            try {
                await plugin.ctx._dispose();
                plugin.status = 'disposed';
            } catch (err) {
                this._log(`[plugin-host] 插件 ${plugin.name} 回收失败: ${err.message}`);
                throw err;
            }
        }
        this._plugins = [];
        this._rootContext = null;
    }
}

/**
 * 构建默认宿主：内置 plugins/ + 用户 ~/.3lib/plugins + env 额外根。
 * @param {object} [opts] 同 PluginHost 构造参数
 * @returns {PluginHost}
 */
export function createDefaultHost(opts = {}) {
    return new PluginHost(opts);
}

export { BUILTIN_PLUGINS_DIR, BUILTIN_PROFILES_DIR, USER_PLUGINS_DIR };
