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

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginContext } from './Context.js';
import { loadPluginEntry, scanPluginRoots, topoSort } from './PluginLoader.js';
import { loadProfile, mergePluginRoots, resolvePluginState } from './Profile.js';

/** 仓库内置插件根目录（core/ 的上一级 plugins/） */
const BUILTIN_PLUGINS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins');

/** 用户级插件根目录（与 3rdloop CLI 数据目录同源：~/.3lib） */
const USER_PLUGINS_DIR = path.join(os.homedir(), '.3lib', 'plugins');

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
        this._profilesDir = profilesDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'profiles');
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

        const roots = mergePluginRoots(this._roots, this._env);
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

export { BUILTIN_PLUGINS_DIR, USER_PLUGINS_DIR };
