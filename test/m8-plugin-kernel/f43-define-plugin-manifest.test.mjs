/**
 * M8 验收 A：插件定义与清单校验（definePlugin / validateManifest）
 *
 * definePlugin 是插件的唯一入口，原则是**启动期就报错**，不让"带病插件"上线：
 *   A definePlugin 拒绝非法名 / 非函数 setup / 非法 version / 非字符串数组 dependencies / 非对象 config
 *   B 合法定义被规范化并冻结（def 与 dependencies、config 都不可被外部篡改）
 *   C validateManifest：entry 必须 .js、name 必须合法、dependencies 必须字符串数组、
 *     缺省值归一为 entry=index.js / version=0.0.0
 */
import { createSuite, impCore } from './helpers.mjs';

const { definePlugin, validateManifest } = await impCore('definePlugin.js');
const suite = createSuite('M8-A 插件定义与清单校验');
const { check, throws } = suite;

const setup = () => {};

// ─── A. definePlugin：非法输入一律拒绝 ─────────────────────────────────
for (const [label, def] of [
    ['null', null],
    ['数组', []],
    ['字符串', 'plugin'],
    ['数字', 42],
]) {
    const r = await throws(() => definePlugin(def));
    check(`A 非对象 def 被拒（${label}）`, !!r && /必须为对象/.test(r.msg), r?.msg);
}

for (const [label, name] of [
    ['大写字母', 'MyPlugin'],
    ['空格', 'my plugin'],
    ['下划线', 'my_plugin'],
    ['中文', '插件'],
    ['以连字符开头', '-leading'],
    ['以斜杠结尾', 'cli/'],
    ['空字符串', ''],
]) {
    const r = await throws(() => definePlugin({ name, setup }));
    check(`A 非法插件名被拒（${label}: ${JSON.stringify(name)}）`, !!r && /插件名非法/.test(r.msg), r?.msg);
}

{
    const r1 = await throws(() => definePlugin({ name: 'demo/x', setup: 'nope' }));
    check('A 非函数 setup 被拒', !!r1 && /setup 必须为函数/.test(r1.msg), r1?.msg);
    const r2 = await throws(() => definePlugin({ name: 'demo/x' }));
    check('A 缺 setup 被拒', !!r2 && /setup 必须为函数/.test(r2.msg), r2?.msg);
}

for (const [label, version] of [
    ['两位版本 1.0', '1.0'],
    ['v 前缀', 'v1.0.0'],
    ['非字符串', 1.0],
]) {
    const r = await throws(() => definePlugin({ name: 'demo/x', setup, version }));
    check(`A 非法 version 被拒（${label}）`, !!r && /version 需为语义化版本/.test(r.msg), r?.msg);
}

for (const [label, dependencies] of [
    ['字符串而非数组', 'demo/a'],
    ['含非字符串元素', [1]],
    ['含 null 元素', ['demo/a', null]],
]) {
    const r = await throws(() => definePlugin({ name: 'demo/x', setup, dependencies }));
    check(`A 非法 dependencies 被拒（${label}）`, !!r && /dependencies 必须为字符串数组/.test(r.msg), r?.msg);
}

for (const [label, config] of [
    ['null', null],
    ['数组', []],
    ['字符串', 'x'],
]) {
    const r = await throws(() => definePlugin({ name: 'demo/x', setup, config }));
    check(`A 非对象 config 被拒（${label}）`, !!r && /config 必须为普通对象/.test(r.msg), r?.msg);
}

{
    const r = await throws(() => definePlugin({ name: 'demo/x', setup, seam: 123 }));
    check('A 非字符串 seam 被拒', !!r && /seam 必须为字符串/.test(r.msg), r?.msg);
}

// ─── B. definePlugin：合法定义规范化 + 冻结 ────────────────────────────
{
    const def = definePlugin({
        name: 'cli/opencode',
        version: '1.2.3-beta.1',
        seam: 'ai-cli',
        dependencies: ['llm/dashscope'],
        config: { bin: 'opencode' },
        setup,
    });
    check('B 合法定义保留全部字段', def.name === 'cli/opencode' && def.version === '1.2.3-beta.1'
        && def.seam === 'ai-cli' && def.setup === setup, def.name);
    check('B dependencies 归一为数组副本',
        Array.isArray(def.dependencies) && def.dependencies.join(',') === 'llm/dashscope',
        JSON.stringify(def.dependencies));
    check('B config 归一为对象副本', def.config.bin === 'opencode', JSON.stringify(def.config));
    check('B 返回值被 Object.freeze（不可增删字段）',
        Object.isFrozen(def) && Object.isFrozen(def.dependencies) && Object.isFrozen(def.config));
}

{
    const def = definePlugin({ name: 'demo/min', setup });
    check('B 缺省 version 归一为 0.0.0', def.version === '0.0.0', def.version);
    check('B 缺省 seam 归一为 null', def.seam === null, String(def.seam));
    check('B 缺省 dependencies/config 归一为空集',
        def.dependencies.length === 0 && Object.keys(def.config).length === 0);
}

{
    const deps = ['demo/a'];
    const cfg = { k: 1 };
    const def = definePlugin({ name: 'demo/copy', setup, dependencies: deps, config: cfg });
    deps.push('demo/b');
    cfg.k = 999;
    check('B 定义持有输入数组/对象的副本（外部改动不影响已定义插件）',
        def.dependencies.length === 1 && def.config.k === 1,
        `${JSON.stringify(def.dependencies)} / ${JSON.stringify(def.config)}`);
}

// ─── C. validateManifest ────────────────────────────────────────────────
for (const [label, manifest] of [
    ['null', null],
    ['数组', []],
]) {
    const r = await throws(() => validateManifest(manifest));
    check(`C 非对象清单被拒（${label}）`, !!r && /必须为对象/.test(r.msg), r?.msg);
}

for (const [label, entry] of [
    ['ESM 后缀 .mjs', 'index.mjs'],
    ['无后缀', 'index'],
    ['非字符串', 1],
]) {
    const r = await throws(() => validateManifest({ name: 'demo/x', entry }));
    check(`C entry 非 .js 被拒（${label}）`, !!r && /entry 必须为 \.js 相对路径/.test(r.msg), r?.msg);
}

{
    const r1 = await throws(() => validateManifest({ name: 'Demo/X' }));
    check('C 清单插件名非法被拒', !!r1 && /插件名非法/.test(r1.msg), r1?.msg);
    const r2 = await throws(() => validateManifest({ name: 'demo/x', dependencies: 'demo/a' }));
    check('C 清单 dependencies 非数组被拒', !!r2 && /dependencies 必须为字符串数组/.test(r2.msg), r2?.msg);
    const r3 = await throws(() => validateManifest({ name: 'demo/x', version: '1.0' }));
    check('C 清单 version 非法被拒', !!r3 && /version 需为语义化版本/.test(r3.msg), r3?.msg);
}

{
    const m = validateManifest({ name: 'demo/x' });
    check('C 缺省值归一：entry=index.js', m.entry === 'index.js', m.entry);
    check('C 缺省值归一：version=0.0.0', m.version === '0.0.0', m.version);
    check('C 缺省值归一：seam=null / dependencies=[]',
        m.seam === null && Array.isArray(m.dependencies) && m.dependencies.length === 0);
    check('C 清单被冻结', Object.isFrozen(m) && Object.isFrozen(m.dependencies));
}

{
    const source = 'D:/tmp/plugins/demo-x/plugin.json';
    const r = await throws(() => validateManifest({ name: 'demo/x', entry: 'index.mjs' }, { source }));
    check('C 报错带来源路径（便于定位是哪个 plugin.json）', !!r && r.msg.includes(source), r?.msg);
    const m = validateManifest(
        { name: 'demo/x', entry: 'main.js', version: '2.0.0', seam: 's', dependencies: ['demo/a'] },
        { source }
    );
    check('C 合法清单字段原样保留',
        m.entry === 'main.js' && m.version === '2.0.0' && m.seam === 's' && m.dependencies.join(',') === 'demo/a');
}

suite.finish();
