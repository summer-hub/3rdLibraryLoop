/**
 * M8 验收 C：可逆回收（dispose）与依赖拓扑（topoSort）
 *
 *   A dispose 逆序执行：后登记先回收（先建的后拆，符合资源依赖）
 *   B 幂等：二次 dispose 不重复执行 disposer
 *   C 单个 disposer 抛错不中断其余，最终汇总抛出（不留半死状态）
 *   D dispose 后服务表与监听表清空（插件卸载不残留幽灵接缝）
 *   E topoSort 确定性：同样输入跑两次结果一致，同层按名字典序
 *   F 缺失依赖抛错，且错误含已装清单
 *   G 循环依赖抛错，且列出环上插件
 */
import { createSuite, impCore } from './helpers.mjs';

const { PluginContext } = await impCore('Context.js');
const { topoSort } = await impCore('PluginLoader.js');
const suite = createSuite('M8-C 可逆回收与依赖拓扑');
const { check, throws } = suite;

const entry = (name, dependencies = []) => ({ dir: `/virtual/${name}`, manifest: { name, dependencies } });
const names = (list) => list.map((e) => e.manifest.name);

// ─── A. 逆序 ────────────────────────────────────────────────────────────
{
    const ctx = new PluginContext({ name: 'demo/order' });
    const seen = [];
    ctx.addDisposer(() => seen.push('first'));
    ctx.addDisposer(() => seen.push('second'));
    ctx.addDisposer(() => seen.push('third'));
    await ctx._dispose();
    check('A dispose 逆序执行（后登记先回收）',
        seen.join(',') === 'third,second,first', seen.join(','));
}

// ─── B. 幂等 ────────────────────────────────────────────────────────────
{
    const ctx = new PluginContext({ name: 'demo/once' });
    let calls = 0;
    ctx.addDisposer(() => { calls++; });
    await ctx._dispose();
    await ctx._dispose();
    await ctx._dispose();
    check('B 二次/三次 dispose 不重复执行 disposer', calls === 1, `calls=${calls}`);
}

// ─── C. 单个失败不中断、最终汇总抛出 ────────────────────────────────────
{
    const ctx = new PluginContext({ name: 'demo/boom' });
    const ran = [];
    ctx.addDisposer(() => ran.push('a'));
    ctx.addDisposer(() => { throw new Error('E-boom'); });
    ctx.addDisposer(() => ran.push('c'));
    const r = await throws(() => ctx._dispose());
    check('C 抛错的 disposer 不中断其余回收', ran.join(',') === 'c,a', ran.join(','));
    check('C 最终汇总抛出（含失败数量与原始消息）',
        !!r && /1 个 disposer 失败/.test(r.msg) && /E-boom/.test(r.msg), r?.msg);
    check('C 汇总错误指明是哪个上下文', !!r && r.msg.includes('demo/boom'), r?.msg);
}

// ─── D. dispose 后表清空 ───────────────────────────────────────────────
{
    const ctx = new PluginContext({ name: 'demo/tables' });
    ctx.provide('svc-a', {});
    ctx.provide('svc-b', {});
    ctx.on('evt', () => {});
    const priv = ctx.scope('p');
    priv.provide('priv-svc', {});
    check('D 前置：服务表与监听表非空',
        ctx._services.size === 4 && ctx._listeners.get('evt').length === 1 && priv._scopedServices.size === 2,
        `services=${ctx._services.size} scoped=${priv._scopedServices.size}`);

    await ctx._dispose();
    check('D dispose 后服务表清空', ctx._services.size === 0, `services=${ctx._services.size}`);
    check('D dispose 后监听表清空', ctx._listeners.size === 0, `listeners=${ctx._listeners.size}`);
    check('D dispose 后私有作用域表清空', priv._scopedServices.size === 0 && priv.disposed === true);
    const r = await throws(() => ctx.inject('svc-a'));
    check('D dispose 后 inject 已回收服务会抛错而不是拿到幽灵值', !!r && /不存在/.test(r.msg), r?.msg);
}

// ─── E. topoSort 确定性 ────────────────────────────────────────────────
{
    const input = [entry('demo/zeta'), entry('demo/alpha'), entry('demo/beta')];
    const first = names(topoSort(input));
    const second = names(topoSort(input));
    check('E 同层按名字典序（与输入顺序无关）',
        first.join(',') === 'demo/alpha,demo/beta,demo/zeta', first.join(','));
    check('E 同一输入两次结果完全一致（确定性）', first.join(',') === second.join(','), second.join(','));

    const shuffled = [entry('demo/beta'), entry('demo/zeta'), entry('demo/alpha')];
    check('E 输入顺序打乱不改变输出',
        names(topoSort(shuffled)).join(',') === first.join(','), names(topoSort(shuffled)).join(','));
}

{
    // demo/d 依赖 b、c；b、c 依赖 a —— 菱形依赖，a 必须先于 b/c，b/c 先于 d
    const order = names(topoSort([
        entry('demo/d', ['demo/b', 'demo/c']),
        entry('demo/c', ['demo/a']),
        entry('demo/b', ['demo/a']),
        entry('demo/a'),
    ]));
    check('E 拓扑顺序满足依赖（菱形依赖）', order.join(',') === 'demo/a,demo/b,demo/c,demo/d', order.join(','));
    check('E 依赖一定排在被依赖者之后',
        order.indexOf('demo/a') === 0 && order.indexOf('demo/d') === order.length - 1, order.join(','));
}

{
    check('E 空输入返回空数组（最小部署不报错）', topoSort([]).length === 0);
}

// ─── F. 缺失依赖 ────────────────────────────────────────────────────────
{
    const r = await throws(() => topoSort([entry('demo/a'), entry('demo/b', ['demo/ghost'])]));
    check('F 缺失依赖抛错', !!r);
    check('F 错误含依赖方与被依赖方', !!r && r.msg.includes('demo/b') && r.msg.includes('demo/ghost'), r?.msg);
    check('F 错误列出已装插件清单', !!r && r.msg.includes('已装') && r.msg.includes('demo/a'), r?.msg);
}

// ─── G. 循环依赖 ────────────────────────────────────────────────────────
{
    const r = await throws(() => topoSort([entry('demo/a', ['demo/b']), entry('demo/b', ['demo/a'])]));
    check('G 循环依赖抛错', !!r && /循环依赖/.test(r.msg));
    check('G 错误列出环上插件', !!r && r.msg.includes('demo/a') && r.msg.includes('demo/b'), r?.msg);
}

{
    const r = await throws(() => topoSort([
        entry('demo/x'),
        entry('demo/a', ['demo/b']),
        entry('demo/b', ['demo/c']),
        entry('demo/c', ['demo/a']),
    ]));
    check('G 三元环只列环上插件，不误报无关插件',
        !!r && r.msg.includes('demo/a') && r.msg.includes('demo/b') && r.msg.includes('demo/c')
        && !r.msg.includes('demo/x'), r?.msg);
}

suite.finish();
