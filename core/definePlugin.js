/**
 * definePlugin.js — 插件定义与清单（manifest）校验
 *
 * 设计参考 DeepSeek Harness / Cordis 的「一切皆插件」理念：
 *   - 插件是能力单元，`setup(ctx)` 内注册服务 / 监听事件即"副作用"；
 *   - setup 可返回 dispose 函数（或经 ctx.addDisposer 登记），实现**可逆卸载**；
 *   - 插件通过 `dependencies` 声明依赖，由宿主做拓扑排序，不存在"先来后到"问题。
 *
 * 本文件只做**形状校验与规范化**，不涉及加载与生命周期（见 PluginLoader / PluginHost）。
 */

/**
 * 插件名规范：小写字母/数字/连字符，可用 `/` 分组（如 `cli/opencode`、`llm/dashscope`）。
 * 分组名同时是文档与 `3rdloop plugin` 命令的展示维度。
 */
const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;

/** 语义化版本号（宽松）：major.minor.patch，允许预后缀 */
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * 定义插件（规范化 + 校验，失败即抛错，不带病上线）。
 *
 * @param {object} def
 * @param {string} def.name            - 插件名（必填，如 `cli/opencode`）
 * @param {(ctx: import('./Context.js').PluginContext) => (void | (() => void | Promise<void>))} def.setup
 *                                      - 安装函数（必填）；返回值作为 dispose
 * @param {string} [def.version]       - 版本（默认 '0.0.0'）
 * @param {string} [def.seam]          - 本插件提供的能力接缝名（如 `ai-cli`）
 * @param {string[]} [def.dependencies] - 依赖的插件名列表
 * @param {object} [def.config]        - 默认配置（可被 profile / 宿主参数覆盖）
 * @returns {Readonly<object>} 规范化后的插件定义（冻结）
 */
export function definePlugin(def) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
        throw new TypeError('definePlugin(def)：def 必须为对象');
    }
    const { name, setup, version, seam, dependencies, config } = def;

    if (typeof name !== 'string' || !PLUGIN_NAME_RE.test(name)) {
        throw new Error(
            `插件名非法: ${JSON.stringify(name)}；需匹配 ${PLUGIN_NAME_RE}（小写字母/数字/连字符，可用 / 分组）`
        );
    }
    if (typeof setup !== 'function') {
        throw new Error(`插件 ${name}：setup 必须为函数 (ctx) => dispose?`);
    }
    if (version !== undefined && (typeof version !== 'string' || !VERSION_RE.test(version))) {
        throw new Error(`插件 ${name}：version 需为语义化版本（如 1.0.0），收到 ${JSON.stringify(version)}`);
    }
    if (seam !== undefined && typeof seam !== 'string') {
        throw new Error(`插件 ${name}：seam 必须为字符串`);
    }
    if (dependencies !== undefined) {
        if (!Array.isArray(dependencies) || dependencies.some((d) => typeof d !== 'string')) {
            throw new Error(`插件 ${name}：dependencies 必须为字符串数组`);
        }
    }
    if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config))) {
        throw new Error(`插件 ${name}：config 必须为普通对象`);
    }

    return Object.freeze({
        name,
        version: version ?? '0.0.0',
        seam: seam ?? null,
        dependencies: Object.freeze([...(dependencies ?? [])]),
        config: Object.freeze({ ...(config ?? {}) }),
        setup,
    });
}

/**
 * 校验插件目录下的 `plugin.json` 清单。
 *
 * 清单与 `definePlugin` 定义分工：
 *   - `plugin.json` 描述**静态元数据**（扫描阶段即可读，无需执行代码）；
 *   - `definePlugin` 携带 **setup 实现**（加载阶段才 import）。
 *
 * @param {object} manifest - 已 JSON.parse 的 plugin.json 内容
 * @param {object} [opts]
 * @param {string} [opts.source] - 来源路径（用于报错定位）
 * @returns {Readonly<object>} 规范化后的清单
 */
export function validateManifest(manifest, { source = '' } = {}) {
    const where = source ? `（${source}）` : '';
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new TypeError(`plugin.json 必须为对象${where}`);
    }
    const { name, entry, version, seam, dependencies } = manifest;

    if (typeof name !== 'string' || !PLUGIN_NAME_RE.test(name)) {
        throw new Error(`plugin.json 插件名非法${where}: ${JSON.stringify(name)}`);
    }
    if (version !== undefined && (typeof version !== 'string' || !VERSION_RE.test(version))) {
        throw new Error(`plugin.json ${name}：version 需为语义化版本${where}`);
    }
    if (entry !== undefined && (typeof entry !== 'string' || !entry.endsWith('.js'))) {
        throw new Error(`plugin.json ${name}：entry 必须为 .js 相对路径${where}`);
    }
    if (seam !== undefined && typeof seam !== 'string') {
        throw new Error(`plugin.json ${name}：seam 必须为字符串${where}`);
    }
    if (dependencies !== undefined) {
        if (!Array.isArray(dependencies) || dependencies.some((d) => typeof d !== 'string')) {
            throw new Error(`plugin.json ${name}：dependencies 必须为字符串数组${where}`);
        }
    }

    return Object.freeze({
        name,
        entry: entry ?? 'index.js',
        version: version ?? '0.0.0',
        seam: seam ?? null,
        dependencies: Object.freeze([...(dependencies ?? [])]),
    });
}
