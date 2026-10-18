/**
 * Profile.js — 插件配置组合（profile + bundle + 环境变量）
 *
 * 设计参考 DSH 的 profile/bundle：一份 profile 声明"启用哪些插件、各是什么选项"，
 * 不同场景（开发 / 测试 / 生产）切换不同 profile，而不改一行代码。
 *
 * 优先级（高 → 低）：
 *   1. 宿主 load() 显式传入的 pluginOptions（程序化覆盖，测试/嵌入场景用）
 *   2. 环境变量：
 *        - `3LIB_PLUGIN_PROFILE`  选择 profile 名（默认 `default`）
 *        - `3LIB_PLUGIN_DISABLE`  逗号分隔的禁用清单（运维应急开关）
 *        - `3LIB_PLUGINS_DIR`     额外插件根目录（路径分隔符分隔）
 *   3. profile 文件中的 `plugins.<name>`
 *   4. 插件自带默认配置（definePlugin 的 config / plugin.json 不携带默认值）
 *
 * 兼容性原则：**不引入任何新的必填环境变量**。现有变量（CLI_TYPE、
 * DASHSCOPE_API_KEY、3LIB_DATA_DIR……）语义与优先级完全不变；插件只是
 * 多了一层可选的显式配置入口。
 *
 * ── 「未提及」到底算启用还是禁用：`defaultEnabled`（profile 级，可选）──────────
 * 默认 `true`（不声明即此值）：
 *   - 未提及 = **启用**。这条保留了改造前的语义，也让「空 profile」成为合法的最小部署
 *     （`loadProfile` 在缺省 profile 文件缺失时返回空 profile）。
 *   - 代价：**往 `plugins/` 里放一个插件目录，就等于在所有部署里激活它** —— 插件目录本身
 *     成了激活开关，与"装了什么"耦合在一起。
 * 声明 `"defaultEnabled": false` 时：
 *   - 未提及 = **禁用**（白名单语义）；只有 `plugins.<name>.enabled === true` 的条目才加载，
 *     于是"装了"与"启用"解耦，发布态可以只带插件、按 profile 决定启用哪些。
 * 两种模式下 `plugins.<name>.enabled`（显式）与 `overrides`（程序化）的优先级都不变。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 选择 profile 名的环境变量 */
export const PROFILE_ENV = '3LIB_PLUGIN_PROFILE';
/** 禁用清单（逗号分隔） */
export const DISABLE_ENV = '3LIB_PLUGIN_DISABLE';
/** 额外插件根目录（路径分隔符分隔） */
export const ROOTS_ENV = '3LIB_PLUGINS_DIR';
/** 默认 profile 名 */
export const DEFAULT_PROFILE = 'default';
/**
 * 用户级 profile 目录（overlay）。
 *
 * 为什么必须有：发布态下内置 profile 在核心包里
 * （`node_modules/@ohos-cpf/3rdloop_core/profiles/`），用户既不该改、改了也会在下次
 * `3rdloop update` 时被覆盖。所以「开关插件」必须写到包外的用户目录，按 overlay 合并。
 */
export const USER_PROFILES_DIR = path.join(os.homedir(), '.3lib', '3rdloop', 'profiles');

/** 把 profilesDir 归一成目录数组（单目录、数组、undefined 都接受）。 */
function toDirList(profilesDir) {
    if (!profilesDir) return [];
    return Array.isArray(profilesDir) ? profilesDir.filter(Boolean) : [profilesDir];
}

/**
 * 去掉 UTF-8 BOM。
 *
 * Windows 用户用记事本/部分编辑器改 profile 时几乎必然带 BOM（`U+FEFF`），而
 * `JSON.parse` 会把 BOM 当非法字符直接抛 `Unexpected token '﻿'`——用户看到的是
 * "profile 解析失败"却找不到任何语法错误。BOM 没有语义，读入即剥掉。
 */
function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 深合并两个 profile：后者（overlay）覆盖前者（内置）。
 *
 * 合并粒度是**单个插件条目**：`plugins.brain = {...base, ...overlay}`，其中 `options`
 * 再按 key 合并（用户只改一个选项时不必重复整份配置）。
 */
function mergeProfiles(base, overlay) {
    const merged = { ...base, ...overlay };
    const plugins = { ...(base.plugins ?? {}) };
    for (const [name, entry] of Object.entries(overlay.plugins ?? {})) {
        const prev = plugins[name];
        plugins[name] = prev
            ? { ...prev, ...entry, options: { ...(prev.options ?? {}), ...(entry.options ?? {}) } }
            : entry;
    }
    merged.plugins = plugins;
    return merged;
}

/**
 * 读取 profile 文件（支持 overlay：目录数组按优先级从低到高，后者覆盖前者）。
 *
 * @param {object} opts
 * @param {string|string[]} opts.profilesDir - profile 目录；数组时后者覆盖前者（用户目录放最后）
 * @param {string} [opts.name]      - profile 名，缺省取 env `3LIB_PLUGIN_PROFILE`，再缺省 `default`
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ name: string, plugins: Record<string, {enabled?: boolean, options?: object, required?: boolean}> }}
 */
export function loadProfile({ profilesDir, name, env = process.env }) {
    const profileName = name ?? env[PROFILE_ENV] ?? DEFAULT_PROFILE;
    const dirs = toDirList(profilesDir);

    let merged = null;
    for (const dir of dirs) {
        // 目录式（DSH 布局）优先：<dir>/<name>/profile.json；其次旧式 <dir>/<name>.json
        const one = readProfileDir(path.join(dir, profileName), profileName)
            ?? readProfileFileIfExists(path.join(dir, `${profileName}.json`), profileName, dirs);
        if (!one) continue;
        merged = merged ? mergeProfiles(merged, one) : one;
    }
    if (merged) return merged;

    if (profileName !== DEFAULT_PROFILE) {
        const tried = dirs
            .flatMap((d) => [path.join(d, profileName, 'profile.json'), path.join(d, `${profileName}.json`)])
            .join('、');
        throw new Error(`profile 不存在: ${tried || '（无目录）'}（可用: ${listProfiles(dirs).join(', ') || '无'}）`);
    }
    // 缺省 profile 文件时返回空 profile（全部启用、无选项）——允许最小部署
    return { name: profileName, plugins: {} };
}

/** 旧式单文件 profile：存在才读，不存在返回 null。 */
function readProfileFileIfExists(file, profileName, dirs = []) {
    if (!fs.existsSync(file)) return null;
    return readProfileFile(file, profileName, dirs);
}

/** 目录式 profile（`<profileDir>/profile.json`）：存在才读，不存在返回 null。 */
function readProfileDir(profileDir, profileName) {
    const file = path.join(profileDir, 'profile.json');
    if (!fs.existsSync(file)) return null;
    return readProfileFile(file, profileName);
}

/**
 * 解析某个 profile 的**目录**（DSH 式布局：一个 profile 一个目录）。
 *
 * 插件就是该目录 `node_modules/` 里的 npm 包（安装/卸载由包管理器完成，见
 * `cli/lib/plugin-store.js`），启用状态记在该目录的 `profile.json`。
 * 仍兼容旧布局 `<profilesRoot>/<name>.json`（单文件 overlay）。
 *
 * @param {object} opts
 * @param {string|string[]} [opts.profilesDir] - profile 根目录列表（后者优先）
 * @param {string} [opts.name] - profile 名，缺省取 env `3LIB_PLUGIN_PROFILE` → `default`
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {string} profile 目录绝对路径（可能尚不存在）
 */
export function resolveProfileDir({ profilesDir, name, env = process.env } = {}) {
    const profileName = name ?? env[PROFILE_ENV] ?? DEFAULT_PROFILE;
    const dirs = toDirList(profilesDir);
    for (const dir of dirs) {
        const candidate = path.join(dir, profileName);
        if (fs.existsSync(path.join(candidate, 'profile.json'))) return candidate;
    }
    for (const dir of dirs) {
        if (fs.existsSync(path.join(dir, `${profileName}.json`))) return path.join(dir, profileName);
    }
    return path.join(dirs.length ? dirs[dirs.length - 1] : USER_PROFILES_DIR, profileName);
}

/**
 * 读取并校验单个 profile 文件。
 *
 * @param {string} file - profile 文件绝对路径
 * @param {string} profileName - profile 名（错误信息用）
 * @param {string[]} dirs - profile 目录列表（错误信息里列出可选项）
 */
function readProfileFile(file, profileName, dirs = []) {
    let parsed;
    try {
        parsed = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
    } catch (err) {
        throw new Error(`profile 解析失败 ${file}: ${err.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`profile 必须为对象: ${file}`);
    }
    const plugins = parsed.plugins ?? {};
    if (typeof plugins !== 'object' || plugins === null || Array.isArray(plugins)) {
        throw new Error(`profile ${profileName}：plugins 必须为对象`);
    }
    for (const [pname, entry] of Object.entries(plugins)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`profile ${profileName}：plugins.${pname} 必须为对象`);
        }
    }
    if (parsed.defaultEnabled !== undefined && typeof parsed.defaultEnabled !== 'boolean') {
        throw new Error(`profile ${profileName}：defaultEnabled 必须是布尔值`);
    }
    // defaultEnabled 决定「profile 未提及某插件」时的默认值：
    //   undefined / true（默认）→ 未提及 = 启用（兼容既有 profile 与「空 profile 最小部署」）
    //   false                  → 未提及 = 禁用（白名单语义：装了什么 ≠ 启用什么）
    void dirs;
    return { name: profileName, plugins, defaultEnabled: parsed.defaultEnabled };
}

/** 列出 profiles 目录下可用 profile 名 */
export function listProfiles(profilesDir) {
    const dirs = toDirList(profilesDir);
    const names = new Set();
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
            // 旧式单文件 <name>.json
            if (entry.endsWith('.json')) {
                names.add(entry.slice(0, -'.json'.length));
                continue;
            }
            // 目录式 <name>/profile.json（DSH 布局）
            if (fs.existsSync(path.join(dir, entry, 'profile.json'))) names.add(entry);
        }
    }
    return [...names].sort();
}

/**
 * 解析单个插件的启用状态与合并后选项。
 *
 * @param {object} opts
 * @param {string} opts.pluginName
 * @param {object} opts.defaults   - 插件自带默认配置
 * @param {{plugins: Record<string, object>}} opts.profile
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {object} [opts.overrides] - 显式覆盖（优先级最高）
 * @returns {{ enabled: boolean, options: object, required: boolean, reason?: string }}
 */
export function resolvePluginState({ pluginName, defaults, profile, env = process.env, overrides = {} }) {
    const entry = profile?.plugins?.[pluginName] ?? {};
    const disableList = (env[DISABLE_ENV] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    // 「未提及」= 启用还是禁用，由 profile 级 defaultEnabled 决定（见 loadProfile 的说明）。
    // 显式 entry.enabled 永远优先于 profile 默认值：显式声明过的条目意图明确，不该被默认值改写。
    const defaultEnabled = profile?.defaultEnabled !== false;
    let enabled = typeof entry.enabled === 'boolean' ? entry.enabled : defaultEnabled;
    let reason;
    if (disableList.includes(pluginName)) {
        enabled = false;
        reason = `env ${DISABLE_ENV} 禁用`;
    } else if (entry.enabled === false) {
        reason = `profile 禁用`;
    } else if (entry.enabled !== true && !defaultEnabled) {
        reason = `profile defaultEnabled:false 且未显式启用`;
    }
    if (Object.hasOwn(overrides, 'enabled')) {
        enabled = overrides.enabled === true;
        reason = '显式覆盖';
    }

    return {
        enabled,
        required: entry.required === true,
        reason,
        options: Object.freeze({
            ...defaults,
            ...(entry.options ?? {}),
            ...(overrides.options ?? {}),
        }),
    };
}

/**
 * 合并插件根目录：内置根 + 用户根 + env 额外根（去重，保持顺序）。
 * @param {string[]} baseRoots
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function mergePluginRoots(baseRoots, env = process.env) {
    const extra = (env[ROOTS_ENV] ?? '')
        .split(path.delimiter)
        .map((s) => s.trim())
        .filter(Boolean);
    const out = [];
    for (const r of [...(baseRoots ?? []), ...extra]) {
        if (r && !out.includes(r)) out.push(r);
    }
    return out;
}
