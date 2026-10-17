/**
 * M8 验收 D：配置组合（Profile.js）
 *
 *   A 优先级：overrides > env(3LIB_PLUGIN_DISABLE) > profile.plugins.<name> > 插件默认 config
 *   B loadProfile：缺省 profile 缺失 → 空 profile（允许最小部署）；**非 default 的缺失必须报错**
 *   C mergePluginRoots：去重且保持顺序
 *   D required 标记只能由 profile 显式声明
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSuite, impCore, withTempDir, ROOT } from './helpers.mjs';

const {
    loadProfile,
    listProfiles,
    resolvePluginState,
    mergePluginRoots,
    PROFILE_ENV,
    DISABLE_ENV,
    ROOTS_ENV,
} = await impCore('Profile.js');
const suite = createSuite('M8-D 配置组合与优先级');
const { check, throws } = suite;

const write = (dir, name, body) => fs.writeFile(path.join(dir, `${name}.json`), body, 'utf8');

// ─── A. 优先级 ──────────────────────────────────────────────────────────
{
    const defaults = { a: 'default', b: 'default', c: 'default' };
    const profile = { plugins: { 'demo/p': { options: { b: 'profile', c: 'profile' } } } };
    const state = resolvePluginState({
        pluginName: 'demo/p',
        defaults,
        profile,
        env: {},
        overrides: { options: { c: 'override' } },
    });
    check('A 选项合并：插件默认 < profile < overrides',
        state.options.a === 'default' && state.options.b === 'profile' && state.options.c === 'override',
        JSON.stringify(state.options));
    check('A 合并后的 options 被冻结', Object.isFrozen(state.options));
}

{
    const base = { pluginName: 'demo/p', defaults: {}, profile: { plugins: { 'demo/p': { enabled: true } } } };

    const byEnv = resolvePluginState({ ...base, env: { [DISABLE_ENV]: 'demo/p,other' } });
    check('A env 禁用生效（逗号清单，含空白也识别）', byEnv.enabled === false);
    check('A env 禁用原因写明变量名', /3LIB_PLUGIN_DISABLE/.test(String(byEnv.reason)), byEnv.reason);

    const byProfile = resolvePluginState({
        pluginName: 'demo/p',
        defaults: {},
        profile: { plugins: { 'demo/p': { enabled: false } } },
        env: {},
    });
    check('A profile 禁用生效', byProfile.enabled === false);
    check('A profile 禁用原因写明来源', /profile/.test(String(byProfile.reason)), byProfile.reason);

    const byOverride = resolvePluginState({
        pluginName: 'demo/p',
        defaults: {},
        profile: { plugins: { 'demo/p': { enabled: false } } },
        env: { [DISABLE_ENV]: 'demo/p' },
        overrides: { enabled: true },
    });
    check('A overrides 优先级最高（可压过 env 与 profile 的禁用）',
        byOverride.enabled === true && /显式覆盖/.test(String(byOverride.reason)), byOverride.reason);

    const plain = resolvePluginState({ pluginName: 'demo/absent', defaults: {}, profile: { plugins: {} }, env: {} });
    check('A profile 未提及的插件默认启用、非 required', plain.enabled === true && plain.required === false);
}

// ─── B. loadProfile ────────────────────────────────────────────────────
{
    const loaded = await withTempDir('profile', async (dir) => {
        await write(dir, 'default', JSON.stringify({ name: 'default', plugins: { 'demo/a': { enabled: true } } }));
        await write(dir, 'staging', JSON.stringify({ plugins: { 'demo/b': { enabled: false, required: true } } }));

        const def = loadProfile({ profilesDir: dir, env: {} });
        const staging = loadProfile({ profilesDir: dir, name: 'staging', env: {} });
        const byEnv = loadProfile({ profilesDir: dir, env: { [PROFILE_ENV]: 'staging' } });
        const empty = await withTempDir('profile-empty', (emptyDir) => loadProfile({ profilesDir: emptyDir, env: {} }));
        const missing = await throws(() => loadProfile({ profilesDir: dir, name: 'prod', env: {} }));
        const listed = listProfiles(dir);
        return { def, staging, byEnv, empty, missing, listed };
    });

    check('B 缺省 profile 名取自 env，再缺省 default', loaded.def.name === 'default', loaded.def.name);
    check('B 读取 profile.plugins', loaded.def.plugins['demo/a'].enabled === true);
    check('B 显式 name 优先生效', loaded.staging.plugins['demo/b'].required === true);
    check('B env 3LIB_PLUGIN_PROFILE 可选 profile', loaded.byEnv.name === 'staging', loaded.byEnv.name);
    check('B 缺省 profile 文件缺失 → 返回空 profile（最小部署可启动）',
        loaded.empty.name === 'default' && Object.keys(loaded.empty.plugins).length === 0,
        JSON.stringify(loaded.empty));
    check('B 非 default profile 缺失 → 必须报错', !!loaded.missing);
    check('B 缺失报错含 profile 名与可用清单',
        !!loaded.missing && loaded.missing.msg.includes('prod') && loaded.missing.msg.includes('staging'),
        loaded.missing?.msg);
    check('B listProfiles 列出全部可用 profile（排序）',
        loaded.listed.join(',') === 'default,staging', loaded.listed.join(','));
}

{
    const bad = await withTempDir('profile-bad', async (dir) => {
        await write(dir, 'broken', '{ not json');
        await write(dir, 'badplugins', JSON.stringify({ plugins: [] }));
        await write(dir, 'badentry', JSON.stringify({ plugins: { 'demo/a': 'nope' } }));
        return {
            broken: await throws(() => loadProfile({ profilesDir: dir, name: 'broken', env: {} })),
            badplugins: await throws(() => loadProfile({ profilesDir: dir, name: 'badplugins', env: {} })),
            badentry: await throws(() => loadProfile({ profilesDir: dir, name: 'badentry', env: {} })),
        };
    });
    check('B 非法 JSON 报错（带文件路径）', !!bad.broken && /解析失败/.test(bad.broken.msg), bad.broken?.msg);
    check('B plugins 非对象报错', !!bad.badplugins && /plugins 必须为对象/.test(bad.badplugins.msg), bad.badplugins?.msg);
    check('B plugins.<name> 非对象报错', !!bad.badentry && /必须为对象/.test(bad.badentry.msg), bad.badentry?.msg);
}

// ─── C. mergePluginRoots ───────────────────────────────────────────────
{
    const d = path.delimiter;
    const merged = mergePluginRoots(['/builtin/plugins', '/user/plugins', '/builtin/plugins'], {});
    check('C 基根去重且保持顺序', merged.join('|') === '/builtin/plugins|/user/plugins', merged.join('|'));
    const withEnv = mergePluginRoots(['/builtin/plugins'], { [ROOTS_ENV]: `/extra/a${d}/builtin/plugins${d}/extra/b` });
    check('C env 额外根追加在基根之后，且与基根去重',
        withEnv.join('|') === '/builtin/plugins|/extra/a|/extra/b', withEnv.join('|'));
    check('C 空输入返回空数组', mergePluginRoots(null, {}).length === 0);
}

// ─── D. required 语义来源 ──────────────────────────────────────────────
{
    const fromProfile = resolvePluginState({
        pluginName: 'demo/p',
        defaults: {},
        profile: { plugins: { 'demo/p': { required: true } } },
        env: {},
    });
    const notMentioned = resolvePluginState({ pluginName: 'demo/p', defaults: {}, profile: { plugins: {} }, env: {} });
    check('D required 只能由 profile 显式声明', fromProfile.required === true);
    check('D profile 未提及时一律视为「未安装、不关心」（required=false）', notMentioned.required === false);
    check('D 默认 env 下 enabled 为 true', notMentioned.enabled === true);
}

// ─── E. profile 级 defaultEnabled（「未提及」= 启用还是禁用）────────────
// 背景：`enabled = entry.enabled !== false` 意味着「未提及 = 启用」，于是**往 plugins/ 里丢一个
// 目录 = 在所有部署里自动激活**。对发布成 npm 包的形态而言，「装了什么」与「启用什么」应当可以
// 解耦，所以默认值改为 profile 级可配；不声明时保持原语义（向后兼容）。
{
    const legacy = resolvePluginState({ pluginName: 'demo/p', defaults: {}, profile: { plugins: {} }, env: {} });
    check('E1 未声明 defaultEnabled 时未提及 = 启用（向后兼容）', legacy.enabled === true);

    const whitelist = { defaultEnabled: false, plugins: {} };
    const notListed = resolvePluginState({ pluginName: 'demo/p', defaults: {}, profile: whitelist, env: {} });
    check('E2 defaultEnabled:false 时未提及 = 禁用', notListed.enabled === false);
    check('E3 禁用原因点名 defaultEnabled（排障要能看出是默认值还是显式声明）',
        /defaultEnabled/.test(String(notListed.reason)), notListed.reason);

    const listed = resolvePluginState({
        pluginName: 'demo/p',
        defaults: {},
        profile: { defaultEnabled: false, plugins: { 'demo/p': { enabled: true } } },
        env: {},
    });
    check('E4 显式 enabled:true 压过 defaultEnabled:false', listed.enabled === true);

    const explicitlyOff = resolvePluginState({
        pluginName: 'demo/p',
        defaults: {},
        profile: { defaultEnabled: true, plugins: { 'demo/p': { enabled: false } } },
        env: {},
    });
    check('E5 显式 enabled:false 压过 defaultEnabled:true', explicitlyOff.enabled === false);

    const overridden = resolvePluginState({ pluginName: 'demo/p', defaults: {}, profile: whitelist, env: {}, overrides: { enabled: true } });
    check('E6 overrides 仍可压过 defaultEnabled:false（优先级不变）',
        overridden.enabled === true && /显式覆盖/.test(String(overridden.reason)), overridden.reason);

    const loaded = await withTempDir('profile-default-enabled', async (dir) => {
        await write(dir, 'whitelist', JSON.stringify({ defaultEnabled: false, plugins: { 'demo/a': { enabled: true } } }));
        await write(dir, 'bad', JSON.stringify({ defaultEnabled: 'yes', plugins: {} }));
        return {
            ok: loadProfile({ profilesDir: dir, name: 'whitelist', env: {} }),
            badType: await throws(() => loadProfile({ profilesDir: dir, name: 'bad', env: {} })),
        };
    });
    check('E7 loadProfile 透传 defaultEnabled', loaded.ok.defaultEnabled === false);
    check('E8 defaultEnabled 非布尔 → 报错（配置错误不该被静默吞掉）',
        !!loaded.badType && /defaultEnabled 必须是布尔值/.test(loaded.badType.msg), loaded.badType?.msg);

    // 端到端对照：同一个 profile，加不加 defaultEnabled:false 决定"插件目录是否等于激活开关"
    const { PluginHost } = await impCore('PluginHost.js');
    const loadWith = async (prefix, profileBody) =>
        withTempDir(prefix, async (dir) => {
            await write(dir, 'p', JSON.stringify(profileBody));
            const host = new PluginHost({ roots: [path.join(ROOT, 'plugins')], profilesDir: dir, env: {}, logger: () => {} });
            await host.load({ profile: 'p' });
            const names = [...host.loaded];
            await host.dispose();
            return names;
        });

    const restricted = await loadWith('profile-whitelist', {
        defaultEnabled: false,
        plugins: { 'engines/brain': { enabled: true } },
    });
    check('E9 端到端：defaultEnabled:false → 只加载显式启用项',
        restricted.length === 1 && restricted[0] === 'engines/brain', restricted.join(','));

    const open = await loadWith('profile-open', { plugins: { 'engines/brain': { enabled: true } } });
    check('E10 对照：去掉 defaultEnabled:false → 全部插件照旧加载（默认语义未变）',
        open.length > 1, open.join(','));
}

suite.finish();
