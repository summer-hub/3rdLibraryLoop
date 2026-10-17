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
import { createSuite, impCore, withTempDir } from './helpers.mjs';

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

suite.finish();
