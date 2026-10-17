/**
 * M8 验收 G：嵌套插件目录发现（递归 · 深度上限 · 确定性 · 同名 tie-break）
 *
 * 背景：profiles/default.json 里的插件名是**带分组**的（cli/opencode、llm/dashscope、
 * storage/json…），落盘必然是 `plugins/<组>/<名>/`。旧扫描器只认一层，而分组目录
 * 自身没有 `plugin.json` → 被"非插件目录，静默跳过"，于是插件树建好了却**一个都
 * 不加载、也不报错**。本段把递归发现钉死：
 *
 *   A 扁平布局向后兼容：`<root>/<名>/plugin.json` 仍然被发现
 *   B 二级嵌套 `<root>/<组>/<名>/` 被发现，插件名只来自清单（不从路径推导）
 *   C 三层/四层嵌套发现；超过深度上限的更深插件静默忽略（不报错、不加载）
 *   D 插件目录内部的子目录不被误认成新插件（即使它自带 plugin.json）
 *   E 确定性：同一内容两次扫描顺序完全一致，且与 readdir 原始顺序无关
 *   F 同名冲突的 tie-break：**越浅越优先，同深度再按相对路径字典序**
 *     （跨 root 仍按传入 root 顺序先到者胜，由 f48-E 守护）
 *   G 端到端：嵌套布局经 PluginHost 真正加载（入口执行、拓扑生效、服务可注入）
 *
 * 为什么 tie-break 先比深度：同名冲突本来就是配置写错了。纯字典序选的话，
 * `plugins/tie` 会被 `plugins/grp/tie` 盖掉（'g' < 't'）——结果取决于分组目录的
 * 字母序，等于没有规则；选"更接近根、更显眼"的那个才可解释。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSuite, impCore, simplePluginSource, withTempDir, writePlugin } from './helpers.mjs';

const { PluginHost } = await impCore('PluginHost.js');
const { MAX_PLUGIN_SCAN_DEPTH, scanPluginRoots } = await impCore('PluginLoader.js');
const suite = createSuite('M8-G 嵌套插件目录发现');
const { check, throws } = suite;

const names = (entries) => entries.map((e) => e.manifest.name).join(',') || '（空）';
const rel = (root, dir) => path.relative(root, dir).split(path.sep).join('/');
/** 造一个只有清单的插件目录（扫描不 import 入口，空入口足够） */
const putPlugin = (root, name, ...segments) =>
    writePlugin(root, { name, dir: path.join(...segments), source: '' });

// ─── A. 扁平布局向后兼容 ───────────────────────────────────────────────
await withTempDir('nested-flat', async (tmp) => {
    const root = path.join(tmp, 'plugins');
    await fs.mkdir(root, { recursive: true });
    await putPlugin(root, 'demo/flat', 'demo-flat');

    const { entries, conflicts } = scanPluginRoots([root]);
    check('A 扁平布局 <root>/<名>/plugin.json 仍被发现（向后兼容）',
        entries.length === 1 && entries[0].manifest.name === 'demo/flat', names(entries));
    check('A 扁平布局的 dir 就是清单所在目录', entries[0]?.dir === path.join(root, 'demo-flat'), entries[0]?.dir);
    check('A 扁平布局不产生冲突', conflicts.length === 0, JSON.stringify(conflicts));
});

// ─── B. 二级嵌套（默认插件树形态）─────────────────────────────────────
await withTempDir('nested-two', async (tmp) => {
    const root = path.join(tmp, 'plugins');
    await fs.mkdir(root, { recursive: true });
    // 目录名与插件名刻意不一致：插件名只能来自清单
    await putPlugin(root, 'llm/dashscope', 'llm', 'dashscope-dir');
    await putPlugin(root, 'cli/opencode', 'cli', 'opencode');

    const { entries, conflicts } = scanPluginRoots([root]);
    check('B 二级嵌套 <root>/<组>/<名>/plugin.json 被发现',
        names(entries) === 'cli/opencode,llm/dashscope', names(entries));
    check('B 插件名只来自清单，不由目录名/层级推导',
        entries.find((e) => e.manifest.name === 'llm/dashscope')?.dir
        === path.join(root, 'llm', 'dashscope-dir'),
        entries.map((e) => `${e.manifest.name}@${rel(root, e.dir)}`).join(' '));
    check('B 分组目录本身不含清单 ≠ 插件条目（不会多出 llm/cli 之类的条目）',
        entries.length === 2 && conflicts.length === 0, names(entries));
});

// ─── C. 深层嵌套与深度上限 ─────────────────────────────────────────────
await withTempDir('nested-deep', async (tmp) => {
    const root = path.join(tmp, 'plugins');
    await fs.mkdir(root, { recursive: true });
    await putPlugin(root, 'engines/loopengine', 'engines', 'loop', 'loopengine'); // 3 层
    await putPlugin(root, 'demo/at-limit', 'd1', 'd2', 'd3', 'at-limit'); // 恰好第 4 层
    await putPlugin(root, 'demo/too-deep', 'd1', 'd2', 'd3', 'd4', 'too-deep'); // 第 5 层

    let scanned = null;
    let failure = null;
    try {
        scanned = scanPluginRoots([root]);
    } catch (err) {
        failure = err;
    }
    const entries = scanned?.entries ?? [];
    const dirs = entries.map((e) => rel(root, e.dir)).join(',');

    check('C 深度上限是 4 层（覆盖 <组>/<子组>/<名>/ 并留一层余量）', MAX_PLUGIN_SCAN_DEPTH === 4,
        String(MAX_PLUGIN_SCAN_DEPTH));
    check('C 三层嵌套 <root>/<组>/<子组>/<名>/ 被发现', dirs.includes('engines/loop/loopengine'), dirs);
    check('C 恰好第 4 层的插件仍被发现（边界含等于）', dirs.includes('d1/d2/d3/at-limit'), dirs);
    check('C 超过深度上限的第 5 层插件被忽略（不加载）',
        !dirs.includes('too-deep') && !names(entries).includes('demo/too-deep'), dirs);
    check('C 超深插件不报错（静默忽略，与旧的"非插件目录"语义一致）', failure === null,
        String(failure?.message ?? ''));
    check('C 超深目录之外的插件不受影响（共 2 个）', entries.length === 2, names(entries));
});

// ─── D. 插件内部目录不得被误认成新插件 ─────────────────────────────────
await withTempDir('nested-inner', async (tmp) => {
    const root = path.join(tmp, 'plugins');
    await fs.mkdir(root, { recursive: true });
    const outer = await putPlugin(root, 'demo/outer', 'grp', 'outer');
    // 插件内部再放一个带 plugin.json 的"假插件"：自身是插件条目的目录不再下探
    const inner = path.join(outer, 'lib');
    await fs.mkdir(inner, { recursive: true });
    await fs.writeFile(
        path.join(inner, 'plugin.json'),
        `${JSON.stringify({ name: 'demo/inner', entry: 'index.js', version: '1.0.0', dependencies: [] }, null, 2)}\n`,
        'utf8'
    );
    await fs.writeFile(path.join(inner, 'index.js'), '', 'utf8');

    const { entries, conflicts } = scanPluginRoots([root]);
    check('D 插件目录内部的子目录不被当成新插件（即使含 plugin.json）',
        names(entries) === 'demo/outer', names(entries));
    check('D 内部子目录也不进 conflicts（它压根没被当成候选）',
        conflicts.length === 0 && entries.every((e) => !e.dir.includes(`${path.sep}lib`)),
        JSON.stringify(conflicts));
    check('D 插件条目的 dir 是外层插件目录而不是内部的 lib/',
        entries[0]?.dir === outer, entries[0]?.dir);
});

// ─── E. 确定性 + 排序键 (深度, 相对路径) ───────────────────────────────
await withTempDir('nested-determinism', async (tmp) => {
    const layout = [['alpha', 'p1'], ['mid', 'p2'], ['zeta', 'p3']]; // 都是 2 层
    const root = path.join(tmp, 'plugins');
    await fs.mkdir(root, { recursive: true });
    // 一个 1 层插件，目录名字典序最后（'zzz' > 'alpha'）：键先比深度 → 它必须排最前
    await putPlugin(root, 'demo/flat', 'zzz-flat');
    // 逆序建树：readdir 的原始顺序（取决于创建顺序/文件系统）不得渗进结果
    for (const seg of [...layout].reverse()) await putPlugin(root, `demo/${seg[1]}`, ...seg);

    const scanOnce = (r) => scanPluginRoots([r]).entries.map((e) => rel(r, e.dir)).join(',');
    const expected = 'zzz-flat,alpha/p1,mid/p2,zeta/p3';
    const first = scanOnce(root);
    check('E 同一内容两次扫描顺序完全一致（确定性）', first === scanOnce(root), scanOnce(root));
    check('E 同深度按相对路径字典序（与建树/readdir 顺序无关）', first === expected, first);
    check('E 越浅越靠前：1 层的 zzz-flat 排在全部 2 层插件之前（深度先于字典序）',
        first.startsWith('zzz-flat,'), first);

    // 同一布局在另一个临时根里按不同创建顺序建一次，相对顺序必须相同
    const root2 = path.join(tmp, 'plugins2');
    await fs.mkdir(root2, { recursive: true });
    for (const seg of layout) await putPlugin(root2, `demo/${seg[1]}`, ...seg);
    await putPlugin(root2, 'demo/flat', 'zzz-flat');
    check('E 反向/正向建树的两次扫描结果一致（顺序只由内容决定）',
        scanOnce(root2) === first, scanOnce(root2));
});

// ─── F. 同名冲突 tie-break：越浅越优先，同深度按相对路径字典序 ─────────
await withTempDir('nested-conflict', async (tmp) => {
    const root = path.join(tmp, 'plugins');
    await fs.mkdir(root, { recursive: true });
    // ① 同深度：字典序在前的 grp-a/dup 胜出
    const sameA = await putPlugin(root, 'demo/same-depth', 'grp-a', 'dup');
    const sameB = await putPlugin(root, 'demo/same-depth', 'grp-b', 'dup');
    // ② 不同深度：浅的胜出——深层的相对路径字典序更前（'a-deep/…' < 'zz-shallow'）也不该赢
    const shallow = await putPlugin(root, 'demo/shallow-wins', 'zz-shallow'); // 1 层
    const deep = await putPlugin(root, 'demo/shallow-wins', 'a-deep', 'inside', 'deep'); // 3 层

    const { entries, conflicts } = scanPluginRoots([root]);
    const keptOf = (name) => entries.find((e) => e.manifest.name === name)?.dir;
    const conflictOf = (name) => conflicts.find((c) => c.name === name);

    check('F 同深度同名：相对路径字典序在前的目录胜出',
        keptOf('demo/same-depth') === sameA && conflictOf('demo/same-depth')?.skipped === sameB,
        JSON.stringify(conflictOf('demo/same-depth')));
    check('F 不同深度同名：越浅越优先（深层 a-deep/… 字典序更前也不赢）',
        keptOf('demo/shallow-wins') === shallow && conflictOf('demo/shallow-wins')?.skipped === deep,
        `${keptOf('demo/shallow-wins')} ← 应保留浅的那个`);
    check('F 同名只保留一个条目（两个名字各 1 条，冲突各 1 条）',
        entries.length === 2 && conflicts.length === 2, `${names(entries)} | ${JSON.stringify(conflicts)}`);
    check('F conflicts 结构仍是 {name, kept, skipped}',
        conflicts.every((c) => Object.keys(c).sort().join(',') === 'kept,name,skipped'),
        JSON.stringify(conflicts));
    check('F kept/skipped 都是完整绝对路径（不是相对片段）',
        conflicts.every((c) => path.isAbsolute(c.kept) && path.isAbsolute(c.skipped)),
        JSON.stringify(conflicts));
    check('F conflicts.name 是清单里的插件名',
        conflicts.map((c) => c.name).sort().join(',') === 'demo/same-depth,demo/shallow-wins',
        conflicts.map((c) => c.name).join(','));
});

// ─── F2. 扁平 vs 嵌套同名：浅的赢（纯字典序会判错的经典组合）───────────
await withTempDir('nested-conflict-flat', async (tmp) => {
    const root = path.join(tmp, 'plugins');
    await fs.mkdir(root, { recursive: true });
    // grp/tie 的字典序在 tie 之前（'g' < 't'）——仍必须由更浅的 <root>/tie 胜出
    const nestedDir = await putPlugin(root, 'demo/tie', 'grp', 'tie');
    const flatDir = await putPlugin(root, 'demo/tie', 'tie');

    const { entries, conflicts } = scanPluginRoots([root]);
    check('F2 扁平 <root>/tie 胜出（浅于 <root>/grp/tie，尽管字典序在后）',
        entries.length === 1 && entries[0].dir === flatDir, `${entries[0]?.dir} 应为 ${flatDir}`);
    check('F2 冲突记录 kept=扁平 / skipped=嵌套',
        conflicts.length === 1 && conflicts[0].kept === flatDir && conflicts[0].skipped === nestedDir,
        JSON.stringify(conflicts));
});

// ─── G. 端到端：嵌套插件真的被加载 ─────────────────────────────────────
await withTempDir('nested-e2e', async (tmp) => {
    const root = path.join(tmp, 'plugins');
    await fs.mkdir(root, { recursive: true });
    await writePlugin(root, {
        name: 'llm/mock',
        dir: path.join('llm', 'mock'),
        source: simplePluginSource({ name: 'llm/mock', seam: 'llm-svc' }),
    });
    await writePlugin(root, {
        name: 'http/server',
        dir: path.join('http', 'server'),
        dependencies: ['llm/mock'],
        source: simplePluginSource({
            name: 'http/server',
            seam: 'http-svc',
            dependencies: ['llm/mock'],
        }),
    });

    globalThis.__M8_ORDER = [];
    const host = new PluginHost({ roots: [root], profilesDir: path.join(tmp, 'profiles-none'), env: {} });
    const res = await host.load();

    check('G 嵌套布局经宿主真正加载（两个插件都进 loaded）',
        res.loaded.join(',') === 'llm/mock,http/server', res.loaded.join(','));
    check('G 嵌套插件入口被真实执行（服务可注入）',
        host.inject('llm-svc')?.plugin === 'llm/mock' && host.inject('http-svc')?.plugin === 'http/server',
        JSON.stringify(host.listServices()));
    check('G 嵌套布局的依赖拓扑生效（mock 先于 server setup）',
        globalThis.__M8_ORDER.join(',') === 'llm/mock,http/server', globalThis.__M8_ORDER.join(','));
    check('G 嵌套布局不产生冲突/跳过', res.conflicts.length === 0 && res.skipped.length === 0,
        JSON.stringify({ conflicts: res.conflicts, skipped: res.skipped }));
    check('G 宿主记录的 dir 指向嵌套插件目录本身（入口在组目录之下解析）',
        host.list().every((p) => rel(root, p.dir) === p.name),
        host.list().map((p) => rel(root, p.dir)).join(' '));

    await host.dispose();
});

// 不存在的根目录不得让扫描抛错（最小部署/未装插件的用户根）
{
    const r = await throws(async () => scanPluginRoots([path.join(process.cwd(), '__m8-no-such-root__')]));
    check('G 不存在的插件根被忽略（不报错、不阻塞最小部署）', r === null, r?.msg);
}

suite.finish();
