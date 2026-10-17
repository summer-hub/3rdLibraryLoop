/**
 * M8 验收 F：宿主端到端（真插件目录 · 拓扑 setup · dispose 回收）
 *
 * 用 os.tmpdir() 下的临时插件根造 2~3 个**真插件**（`plugin.json` + `index.js`，入口用
 * definePlugin），验证宿主是全链路可用的，而不只是各零件单测通过：
 *
 *   A 返回结构 {loaded, skipped, conflicts}
 *   B setup 顺序由依赖拓扑决定（不是目录/字典偶然序）
 *   C 服务接缝：跨插件 inject、listServices 的 provider 归属
 *   D 配置合并：profile options 覆盖插件默认 config
 *   E conflicts：同名插件先到者胜（项目内置优先于用户根）
 *   F skipped：被禁用插件的记录结构与原因
 *   G dispose：逆序回收、服务表清空、宿主不可复用、可再次 load 的需求由新宿主承担
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSuite, impCore, ROOT, simplePluginSource, withTempDir, writePlugin } from './helpers.mjs';

const { PluginHost } = await impCore('PluginHost.js');
const suite = createSuite('M8-F 宿主端到端');
const { check, throws } = suite;

/**
 * 递归列出目录下所有条目的相对路径（目录名带尾 `/`），排序。
 * 目录不存在/不可读 → 返回 null（与"存在但是空目录"区分开：后者是 []）。
 * 用于"跑用例前后是否多出/少了任何东西"的清单比对——只看存在布尔值会被
 * 别的任务预先建好 plugins/ 的情况架空，失去检测力。
 */
async function inventory(dir) {
    const out = [];
    const walk = async (cur, prefix) => {
        for (const d of await fs.readdir(cur, { withFileTypes: true })) {
            const relPath = prefix ? `${prefix}/${d.name}` : d.name;
            out.push(d.isDirectory() ? `${relPath}/` : relPath);
            if (d.isDirectory()) await walk(path.join(cur, d.name), relPath);
        }
    };
    try {
        await walk(dir, '');
    } catch {
        return null;
    }
    return out.sort();
}

// 仓库根 plugins/ 的**既有**清单：本用例只验证「自己没有往仓库里写东西」，
// 不假设它原本存在或为空——内置插件树可能由别的改动/并行任务落地。
const repoPlugins = path.join(ROOT, 'plugins');
const repoPluginsBefore = await inventory(repoPlugins);

// ─── 造 3 个真插件：demo/alpha（根）、demo/beta / demo/zeta（都依赖 alpha）──
await withTempDir('e2e', async (tmp) => {
    const pluginsRoot = path.join(tmp, 'plugins');
    await fs.mkdir(pluginsRoot, { recursive: true });

    await writePlugin(pluginsRoot, {
        name: 'demo/alpha',
        source: simplePluginSource({ name: 'demo/alpha', seam: 'alpha-svc', config: { tag: 'alpha-default', n: 1 } }),
    });
    await writePlugin(pluginsRoot, {
        name: 'demo/beta',
        source: simplePluginSource({
            name: 'demo/beta',
            seam: 'beta-svc',
            dependencies: ['demo/alpha'],
            config: { tag: 'beta-default', n: 2 },
        }),
    });
    await writePlugin(pluginsRoot, {
        name: 'demo/zeta',
        source: simplePluginSource({
            name: 'demo/zeta',
            seam: 'zeta-svc',
            dependencies: ['demo/alpha'],
            config: { tag: 'zeta-default' },
        }),
    });

    globalThis.__M8_ORDER = [];
    const profilesDir = path.join(tmp, 'profiles'); // 不存在 → loadProfile 走空 profile
    const host = new PluginHost({ roots: [pluginsRoot], profilesDir, env: {} });
    const res = await host.load({ profile: { plugins: { 'demo/beta': { options: { tag: 'from-profile' } } } } });
    const setupOrder = [...globalThis.__M8_ORDER];

    // A. 返回结构
    check('A load() 返回 {loaded, skipped, conflicts}',
        Array.isArray(res.loaded) && Array.isArray(res.skipped) && Array.isArray(res.conflicts),
        Object.keys(res).join(','));
    check('A loaded 含全部 3 个插件', res.loaded.join(',') === 'demo/alpha,demo/beta,demo/zeta', res.loaded.join(','));
    check('A 无冲突、无跳过', res.conflicts.length === 0 && res.skipped.length === 0);

    // B. setup 顺序由拓扑决定
    check('B setup 顺序满足依赖（alpha 先于依赖它的 beta/zeta）',
        setupOrder.join(',') === 'demo/alpha,demo/beta,demo/zeta', setupOrder.join(','));
    check('B setup 顺序与 loaded 一致（宿主记录即真实执行序）',
        setupOrder.join(',') === res.loaded.join(','));

    // C. 服务接缝
    check('C 跨插件服务可被宿主注入（裸名）', host.inject('alpha-svc').plugin === 'demo/alpha');
    check('C 限定名 `seam@provider` 可注入', host.inject('beta-svc@demo/beta').plugin === 'demo/beta');
    const services = host.listServices();
    check('C listServices 只列裸名并标注提供方',
        services.map((s) => `${s.service}<-${s.provider}`).join(',')
        === 'alpha-svc<-demo/alpha,beta-svc<-demo/beta,zeta-svc<-demo/zeta',
        services.map((s) => `${s.service}<-${s.provider}`).join(','));
    // version 来自入口 definePlugin（此处未声明 → 归一为 0.0.0），不是 plugin.json 里的版本
    check('C list() 暴露插件元数据（name/version/seam/dir/status）',
        host.list().every((p) => p.name && p.dir && p.seam && p.status === 'active' && p.version === '0.0.0'),
        JSON.stringify(host.list()[0]));

    // D. 配置合并
    const betaCfg = host.inject('beta-svc').config;
    check('D profile options 覆盖插件默认 config', betaCfg.tag === 'from-profile', JSON.stringify(betaCfg));
    check('D 未覆盖的默认值保留（浅合并而非替换）', betaCfg.n === 2, JSON.stringify(betaCfg));
    check('D 未被 profile 提及的插件用自身默认 config', host.inject('alpha-svc').config.tag === 'alpha-default');

    // E. conflicts：同名插件先到者胜
    const secondRoot = path.join(tmp, 'plugins-user');
    await fs.mkdir(secondRoot, { recursive: true });
    await writePlugin(secondRoot, {
        name: 'demo/alpha',
        source: simplePluginSource({ name: 'demo/alpha', seam: 'alpha-user-svc' }),
    });
    const host2 = new PluginHost({ roots: [pluginsRoot, secondRoot], profilesDir, env: {} });
    const res2 = await host2.load();
    check('E 同名插件产生 conflicts 记录（先到者胜）',
        res2.conflicts.length === 1 && res2.conflicts[0].name === 'demo/alpha'
        && res2.conflicts[0].kept.includes('plugins') && res2.conflicts[0].skipped.includes('plugins-user'),
        JSON.stringify(res2.conflicts));
    check('E 保留的是优先级更高根的插件',
        host2.inject('alpha-svc').plugin === 'demo/alpha' && !host2.has('alpha-user-svc'));
    await host2.dispose();

    // F. skipped：禁用记录的归属与原因
    const host3 = new PluginHost({ roots: [pluginsRoot], profilesDir, env: { '3LIB_PLUGIN_DISABLE': 'demo/zeta' } });
    const res3 = await host3.load();
    check('F 被禁用插件进入 skipped（含 name 与 reason）',
        res3.skipped.length === 1 && res3.skipped[0].name === 'demo/zeta' && !!res3.skipped[0].reason,
        JSON.stringify(res3.skipped));
    check('F 被禁用插件未被 setup', res3.loaded.join(',') === 'demo/alpha,demo/beta', res3.loaded.join(','));
    check('F 宿主的事件总线仍可用（插件 ctx 的监听同样被记录）',
        typeof host3.emit === 'function' && Array.isArray(await host3.emit('m8:none', 1)));
    await host3.dispose();

    // 重复 load 保护
    const rDup = await throws(() => host.load());
    check('F 已加载的宿主重复 load 抛错（要求先 dispose）', !!rDup && /重复 load/.test(rDup.msg), rDup?.msg);

    // G. dispose
    const rootCtx = host.root;
    // 只看本宿主的回收序（host2/host3 共用同一个记录数组；插件模块持有数组引用，
    // 只能按长度切片，不能重新赋值 globalThis 上的键）
    const mark = globalThis.__M8_ORDER.length;
    await host.dispose();
    const disposeOrder = globalThis.__M8_ORDER.slice(mark);
    check('G dispose 逆序回收（后 setup 先 dispose）',
        disposeOrder.join(',') === 'dispose:demo/zeta,dispose:demo/beta,dispose:demo/alpha',
        disposeOrder.join(','));
    check('G dispose 后服务表清空', rootCtx._services.size === 0, `services=${rootCtx._services.size}`);
    check('G dispose 后监听表清空', rootCtx._listeners.size === 0, `listeners=${rootCtx._listeners.size}`);
    check('G dispose 后宿主不再暴露服务/插件', host.root === null && host.listServices().length === 0
        && host.list().length === 0 && host.has('alpha-svc') === false);
    check('G dispose 幂等（二次 dispose 不抛错）', (await throws(() => host.dispose())) === null);
    const rReload = await throws(() => host.load());
    check('G dispose 后宿主不可复用（与 Context 的一次生命周期一致）',
        !!rReload && /已 dispose/.test(rReload.msg), rReload?.msg);
});

// ─── H. 清理不留痕：临时目录已删，未向仓库写任何文件 ───────────────────
{
    const after = await inventory(repoPlugins);
    check('H 本用例没有向仓库根 plugins/ 写入/删除任何条目（清单前后完全一致）',
        JSON.stringify(after) === JSON.stringify(repoPluginsBefore),
        `before=${JSON.stringify(repoPluginsBefore)} after=${JSON.stringify(after)}`);
}

suite.finish();
