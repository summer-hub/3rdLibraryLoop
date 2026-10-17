/**
 * M8 验收 E：required 契约 —— fail closed（缺一不可）
 *
 * profiles/default.json 承诺「required=true 的条目缺失将导致启动失败」。
 * 旧实现只在**扫描到的插件条目**上校验 required，于是 required 插件的目录根本不存在时
 * 循环里没有这一项 → 静默通过。本段守护这条安全底线：
 *
 *   A 目录不存在 + required → host.load() 抛错（含插件名 + 原因 + 已装清单）
 *   B 被 env 禁用 + required → host.load() 抛错（含插件名 + 原因）
 *   C 被 profile 禁用 + required → host.load() 抛错（含插件名 + 原因）
 *   D 报错发生在任何插件 setup 之前（不留半装配状态）
 *   E 边界：required 但已安装且启用 → 正常加载
 *   F 边界：未标记 required 的缺失条目 → 不报错（不得误伤现有最小部署）
 *   G 边界：空 profile / 缺省 profile 缺失 → 仍能 load（compat with loadProfile 的 {plugins:{}}）
 */
import path from 'node:path';
import { createSuite, impCore, ROOT, simplePluginSource, withTempDir, writePlugin } from './helpers.mjs';

const { PluginHost } = await impCore('PluginHost.js');
const suite = createSuite('M8-E required 契约（fail closed）');
const { check, throws } = suite;

const DISABLE_ENV = '3LIB_PLUGIN_DISABLE';
const noProfile = (dir) => path.join(dir, 'profiles-not-exist');

/** 起一个只认临时目录的宿主（env 显式注入，避免本机环境变量污染） */
const makeHost = (root, env = {}) => new PluginHost({ roots: [root], profilesDir: noProfile(root), env });

// ─── A. 目录不存在 + required ──────────────────────────────────────────
const missingCase = await withTempDir('req-missing', async (root) => {
    // 装一个无关插件：证明报错不是"空目录"导致的偶发现象
    await writePlugin(root, {
        name: 'demo/alpha',
        source: simplePluginSource({ name: 'demo/alpha', seam: 'alpha-svc' }),
    });
    globalThis.__M8_ORDER = [];
    const host = makeHost(root);
    const r = await throws(() => host.load({
        profile: { plugins: { 'demo/ghost': { enabled: true, required: true } } },
    }));
    return { r, host, order: [...globalThis.__M8_ORDER] };
});

check('A required 插件目录不存在 → load() 抛错', !!missingCase.r);
check('A 报错含插件名', !!missingCase.r && missingCase.r.msg.includes('demo/ghost'), missingCase.r?.msg);
check('A 报错说明原因（未安装）', !!missingCase.r && /未安装/.test(missingCase.r.msg), missingCase.r?.msg);
check('A 报错列出已装插件（便于排查装错位置）',
    !!missingCase.r && /已装/.test(missingCase.r.msg) && missingCase.r.msg.includes('demo/alpha'), missingCase.r?.msg);
check('A 报错点名 required 契约（运维一眼看懂后果）',
    !!missingCase.r && /required/.test(missingCase.r.msg) && /缺一不可/.test(missingCase.r.msg));
check('A 报错发生在任何插件 setup 之前（无半装配状态）',
    missingCase.order.length === 0 && missingCase.host.root === null && missingCase.host.loaded.length === 0,
    `setup 过: ${missingCase.order.join(',') || '（无）'}`);

// ─── B. 被 env 禁用 + required ─────────────────────────────────────────
const envDisabledCase = await withTempDir('req-env', async (root) => {
    await writePlugin(root, {
        name: 'demo/alpha',
        source: simplePluginSource({ name: 'demo/alpha', seam: 'alpha-svc' }),
    });
    globalThis.__M8_ORDER = [];
    const host = makeHost(root, { [DISABLE_ENV]: 'demo/alpha' });
    const r = await throws(() => host.load({
        profile: { plugins: { 'demo/alpha': { enabled: true, required: true } } },
    }));
    return { r, host, order: [...globalThis.__M8_ORDER] };
});

check('B required 插件被 env 禁用 → load() 抛错', !!envDisabledCase.r);
check('B 报错含插件名', !!envDisabledCase.r && envDisabledCase.r.msg.includes('demo/alpha'), envDisabledCase.r?.msg);
check('B 报错说明原因（禁用 + 变量名）',
    !!envDisabledCase.r && /禁用/.test(envDisabledCase.r.msg) && envDisabledCase.r.msg.includes(DISABLE_ENV),
    envDisabledCase.r?.msg);
check('B 报错发生在任何插件 setup 之前',
    envDisabledCase.order.length === 0 && envDisabledCase.host.root === null);

// ─── C. 被 profile 禁用 + required ─────────────────────────────────────
const profileDisabledCase = await withTempDir('req-profile', async (root) => {
    await writePlugin(root, {
        name: 'demo/alpha',
        source: simplePluginSource({ name: 'demo/alpha', seam: 'alpha-svc' }),
    });
    const host = makeHost(root);
    const r = await throws(() => host.load({
        profile: { plugins: { 'demo/alpha': { enabled: false, required: true } } },
    }));
    return { r, host };
});

check('C required 插件被 profile 禁用 → load() 抛错', !!profileDisabledCase.r);
check('C 报错含插件名与 profile 禁用原因',
    !!profileDisabledCase.r && profileDisabledCase.r.msg.includes('demo/alpha')
    && /profile 禁用/.test(profileDisabledCase.r.msg), profileDisabledCase.r?.msg);

// ─── D. 边界：required 但已安装且启用 → 正常加载 ───────────────────────
await withTempDir('req-ok', async (root) => {
    await writePlugin(root, {
        name: 'demo/alpha',
        source: simplePluginSource({ name: 'demo/alpha', seam: 'alpha-svc' }),
    });
    const host = makeHost(root);
    const r = await throws(() => host.load({
        profile: { plugins: { 'demo/alpha': { enabled: true, required: true } } },
    }));
    check('E required 插件齐备时正常加载', r === null && host.loaded.join(',') === 'demo/alpha',
        r ? r.msg : host.loaded.join(','));
    check('E 齐备时服务接缝可用', host.has('alpha-svc'));
    await host.dispose();
});

// ─── E. 边界：未标记 required 的缺失条目 → 不报错 ───────────────────────
await withTempDir('req-not-required', async (root) => {
    await writePlugin(root, {
        name: 'demo/alpha',
        source: simplePluginSource({ name: 'demo/alpha', seam: 'alpha-svc' }),
    });
    const host = makeHost(root);
    const r = await throws(() => host.load({
        profile: { plugins: { 'demo/ghost': { enabled: true }, 'demo/alpha': { enabled: true } } },
    }));
    check('F 未标记 required 的缺失条目被静默忽略（未安装 = 不关心）',
        r === null && host.loaded.join(',') === 'demo/alpha', r ? r.msg : host.loaded.join(','));
    await host.dispose();
});

// ─── F. 边界：空 profile / 缺省 profile 缺失 → 仍能 load ────────────────
{
    const emptyProfile = await withTempDir('req-empty-profile', async (root) => {
        const host = makeHost(root);
        const r = await throws(() => host.load({ profile: { plugins: {} } }));
        const out = { r, loaded: [...host.loaded], skipped: null };
        await host.dispose();
        return out;
    });
    check('G 空 profile + 空插件根 → 正常 load（最小部署不报错）',
        emptyProfile.r === null && emptyProfile.loaded.length === 0,
        emptyProfile.r ? emptyProfile.r.msg : `loaded=[${emptyProfile.loaded.join(',')}]`);
}

{
    const defaultProfileMissing = await withTempDir('req-default-missing', async (root) => {
        await writePlugin(root, {
            name: 'demo/alpha',
            source: simplePluginSource({ name: 'demo/alpha', seam: 'alpha-svc' }),
        });
        const host = makeHost(root); // profilesDir 不存在 → loadProfile 走「缺省 profile 缺失返回空 profile」
        const r = await throws(() => host.load());
        const out = { r, loaded: [...host.loaded], profileName: host.profile?.name };
        await host.dispose();
        return out;
    });
    check('G 缺省 profile 文件缺失 → load() 不报错（兼容 {plugins:{}}）',
        defaultProfileMissing.r === null, defaultProfileMissing.r?.msg);
    check('G 缺省 profile 名回落为 default',
        defaultProfileMissing.profileName === 'default', String(defaultProfileMissing.profileName));
    check('G 未在 profile 提及的已装插件照常加载',
        defaultProfileMissing.loaded.join(',') === 'demo/alpha', defaultProfileMissing.loaded.join(','));
}

// ─── H. 仓库自带 profiles/default.json 的 required 承诺自洽 ────────────
// 注意：这里**不锁条目的数量**。profile 的条目会随插件化推进增减（例如 4 条
// storage/{json,jsonl,sqlite,file} 已合并为一条 storage/core），锁数量只会制造假红，
// 而且数量本来就不是"required 承诺有据可查"的意思。真正要守的是：
// profile 可解析 → 每条声明都是对象（required/options 有处可挂）
// → 存储条目确实存在（迁移后的真实形状）→ 未把未安装的插件标为 required。
{
    const { loadProfile } = await impCore('Profile.js');
    let def = null;
    let parseError = null;
    try {
        def = loadProfile({ profilesDir: path.join(ROOT, 'profiles'), name: 'default', env: {} });
    } catch (err) {
        parseError = err;
    }
    check('H 仓库 default profile 可解析（required 承诺有据可查）',
        parseError === null, parseError?.message ?? 'ok');

    const entries = Object.entries(def?.plugins ?? {});
    check('H profile.plugins 为对象且至少有一条条目',
        !Array.isArray(def?.plugins) && entries.length >= 1, `${entries.length} 条`);

    const badShapes = entries
        .filter(([, v]) => !v || typeof v !== 'object' || Array.isArray(v))
        .map(([k]) => k);
    check('H 每条条目都是对象（required/options 有处可挂）',
        badShapes.length === 0, badShapes.join(',') || '（全部合法）');

    check('H 存储条目已合并为 storage/core（适配器随 core 一起提供）',
        Object.hasOwn(def?.plugins ?? {}, 'storage/core'),
        Object.keys(def?.plugins ?? {}).join(',') || '（空）');

    const requiredNames = entries.filter(([, v]) => v.required === true).map(([k]) => k);
    check('H 当前 default profile 未把未安装的插件标为 required（否则本仓库自身无法启动）',
        requiredNames.length === 0, requiredNames.join(',') || '（无）');
}

suite.finish();
