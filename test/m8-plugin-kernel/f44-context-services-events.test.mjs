/**
 * M8 验收 B：插件上下文（服务接缝 · 类型化事件 · 作用域隔离）
 *
 *   A provide/inject 双通道：裸名（当前生效提供方）+ 限定名 `seam@provider` 永远可达
 *   B 同名覆盖：后注册者成为裸名，限定名各自可达
 *   C inject 缺失**抛错**并列出已注册清单（fail closed，不返回 undefined）
 *   D has()
 *   E scope() 私有作用域：子可见父共享表，父/兄弟不可见子的私有服务；
 *     **普通插件上下文（有 parent 但非 scope）必须仍然共享**——防止有人用 parent 存在性判定
 *     作用域，那会让所有插件互相看不见。
 *   F dispose 后 _assertLive 拒绝再注册
 *   G 事件：serial 收集数组 / waterfall 链式传递 / 无监听者时的缺省返回
 */
import { createSuite, impCore } from './helpers.mjs';

const { PluginContext, EventMode } = await impCore('Context.js');
const suite = createSuite('M8-B 插件上下文（服务 · 事件 · 作用域）');
const { check, throws } = suite;

/** 造一个「宿主 + 插件上下文」结构：服务/监听表由根持有，插件共享 */
function makeHost(pluginNames) {
    const root = new PluginContext({ name: 'root' });
    const plugins = pluginNames.map((name) => new PluginContext({
        name,
        parent: root,
        services: root._services,
        listeners: root._listeners,
    }));
    return { root, plugins, byName: Object.fromEntries(plugins.map((c) => [c.name, c])) };
}

// ─── A. 双通道 ──────────────────────────────────────────────────────────
{
    const { root, byName } = makeHost(['cli/opencode']);
    const ctx = byName['cli/opencode'];
    const svc = { kind: 'ai-cli' };
    ctx.provide('ai-cli', svc);

    check('A 裸名可注入（当前生效提供方）', ctx.inject('ai-cli') === svc);
    check('A 限定名 `seam@provider` 可注入', ctx.inject('ai-cli@cli/opencode') === svc);
    check('A 宿主根上下文也能注入插件提供的服务', root.inject('ai-cli') === svc);
    check('A has() 对裸名与限定名都成立',
        ctx.has('ai-cli') && ctx.has('ai-cli@cli/opencode') && !ctx.has('ai-cli@cli/none'));
    check('A listServices() 含裸名与限定名',
        ctx.listServices().includes('ai-cli') && ctx.listServices().includes('ai-cli@cli/opencode'),
        ctx.listServices().join(','));
}

// ─── B. 同名覆盖 ────────────────────────────────────────────────────────
{
    const logs = [];
    const root = new PluginContext({ name: 'root', logger: (m) => logs.push(m) });
    // 告警由「覆盖发生处」即后注册者的 logger 发出，故两个插件都要挂 logger
    const mk = (name) => new PluginContext({
        name,
        parent: root,
        services: root._services,
        listeners: root._listeners,
        logger: (m) => logs.push(m),
    });
    const p1 = mk('cli/opencode');
    const p2 = mk('cli/deveco-code');
    const s1 = { by: 'p1' };
    const s2 = { by: 'p2' };
    p1.provide('ai-cli', s1);
    p2.provide('ai-cli', s2);

    check('B 后注册者成为裸名', root.inject('ai-cli') === s2);
    check('B 先前提供方的限定名仍可达', root.inject('ai-cli@cli/opencode') === s1);
    check('B 后注册者的限定名可达', root.inject('ai-cli@cli/deveco-code') === s2);
    check('B 覆盖时记录告警（可运维可观测）',
        logs.some((m) => /接缝 'ai-cli' 原提供方 cli\/opencode 被覆盖/.test(m)), logs.join(' | '));
    await p1._dispose();
    check('B 提供方卸载后裸名回落不到已死的旧值（裸名仍指向 p2）', root.inject('ai-cli') === s2);
    check('B 卸载后原限定名消失', !root.has('ai-cli@cli/opencode'));
}

// ─── C. inject 缺失 fail closed ────────────────────────────────────────
{
    const { root, byName } = makeHost(['demo/alpha']);
    byName['demo/alpha'].provide('alpha-svc', { a: 1 });
    const r = await throws(() => root.inject('ghost-svc'));
    check('C inject 不存在时抛错（不返回 undefined）', !!r);
    check('C 错误信息含请求的服务名与消费者', !!r && r.msg.includes('ghost-svc') && r.msg.includes('root'), r?.msg);
    check('C 错误信息列出已注册服务清单（可自助排查）',
        !!r && r.msg.includes('已注册') && r.msg.includes('alpha-svc'), r?.msg);
}

// ─── D. has() ──────────────────────────────────────────────────────────
{
    const { root } = makeHost([]);
    check('D has() 对未注册服务返回 false（不抛错）', root.has('nothing') === false);
    root.provide('x', {});
    check('D has() 对已注册服务返回 true', root.has('x') === true);
}

// ─── E. scope() 私有作用域 ─────────────────────────────────────────────
{
    const { root, byName } = makeHost(['demo/alpha', 'demo/beta']);
    const alpha = byName['demo/alpha'];
    const beta = byName['demo/beta'];
    alpha.provide('shared-svc', { by: 'alpha' });

    const priv = alpha.scope('priv');
    priv.provide('priv-svc', { inner: true });

    // E1 文档承诺的核心：私有服务只在子作用域内可见
    check('E1 scope 私有服务：子可见', priv.has('priv-svc') && priv.inject('priv-svc').inner === true);
    check('E1 scope 私有服务：父不可见', alpha.has('priv-svc') === false);
    check('E1 scope 私有服务：宿主根不可见', root.has('priv-svc') === false);
    check('E1 scope 私有服务：兄弟插件不可见', beta.has('priv-svc') === false);
    check('E1 scope 私有服务不进共享表（宿主 listServices 看不到）',
        !root.listServices().includes('priv-svc'), root.listServices().join(','));

    // E2 护栏：普通插件上下文有 parent，但**不是** scope，服务必须仍然全树共享
    check('E2 普通插件上下文 provide 后宿主根可注入', root.inject('shared-svc') === root.inject('shared-svc@demo/alpha'));
    check('E2 普通插件上下文 provide 后兄弟插件可注入', beta.inject('shared-svc').by === 'alpha');
    check('E2 普通插件上下文 provide 后限定名可达', beta.inject('shared-svc@demo/alpha').by === 'alpha');

    // E3 子可见父 + 限定名在 scope 场景下不被破坏
    check('E3 scope 内可见父共享表', priv.inject('shared-svc').by === 'alpha');
    check('E3 scope 内限定名逐提供方可达',
        priv.inject('shared-svc@demo/alpha').by === 'alpha' && priv.inject('priv-svc@demo/alpha:priv').inner === true);
    priv.provide('shared-svc', { by: 'scope-shadow' });
    // 读取顺序是「共享表 → 私有表」（inject 的双表查找），因此裸名仍归父共享表；
    // scope 的同名服务只在自己的限定名下可达 —— 这既保证了「子可见父」不被遮蔽，
    // 也保证了「父不可见子」。
    check('E3 scope 内同名服务：裸名仍解析到父共享表（共享表优先）',
        priv.inject('shared-svc').by === 'alpha');
    check('E3 scope 内同名服务：限定名逐提供方可达，父不受影响',
        priv.inject('shared-svc@demo/alpha:priv').by === 'scope-shadow'
        && priv.inject('shared-svc@demo/alpha').by === 'alpha'
        && alpha.inject('shared-svc').by === 'alpha');

    // E4 回收边界：scope 回收清私有表，父的服务与表一并不受影响
    check('E4 scope 的 parent 指向创建者', priv.parent === alpha && priv.name === 'demo/alpha:priv');
    await priv._dispose();
    check('E4 scope 回收后私有表清空', priv._scopedServices.size === 0);
    check('E4 scope 回收后父的共享表不受影响',
        alpha.inject('shared-svc').by === 'alpha' && root.has('shared-svc') && root._services.size === 2,
        `shared=${root._services.size}`);
    check('E4 scope 被标 disposed', priv.disposed === true);

    // 父回收时自动回收子作用域
    const priv2 = alpha.scope('priv2');
    priv2.provide('priv2-svc', {});
    await alpha._dispose();
    check('E4 父 dispose 连带回收子作用域（无残留）',
        priv2.disposed === true && priv2._scopedServices.size === 0);
}

// ─── F. dispose 后拒绝再注册 ───────────────────────────────────────────
{
    const ctx = new PluginContext({ name: 'demo/dead' });
    ctx.provide('svc', {});
    ctx.on('evt', () => {});
    await ctx._dispose();
    const r1 = await throws(() => ctx.provide('svc2', {}));
    const r2 = await throws(() => ctx.on('evt2', () => {}));
    const r3 = await throws(() => ctx.addDisposer(() => {}));
    check('F dispose 后 provide 被拒', !!r1 && /已回收/.test(r1.msg), r1?.msg);
    check('F dispose 后 on 被拒', !!r2 && /已回收/.test(r2.msg), r2?.msg);
    check('F dispose 后 addDisposer 被拒', !!r3 && /已回收/.test(r3.msg), r3?.msg);
    const fresh = new PluginContext({ name: 'demo/fresh' });
    const r4 = await throws(() => fresh.provide('', {}));
    const r5 = await throws(() => fresh.provide('ok', undefined));
    check('F 空服务名被拒（另一条 fail closed）', !!r4 && /非空字符串/.test(r4.msg), r4?.msg);
    check('F service 为 undefined 被拒', !!r5 && /不能为 undefined/.test(r5.msg), r5?.msg);
}

// ─── G. 类型化事件 ─────────────────────────────────────────────────────
{
    const ctx = new PluginContext({ name: 'demo/evt' });

    ctx.on('m8:serial', (p) => `s1:${p}`);
    ctx.on('m8:serial', (p) => `s2:${p}`);
    const serial = await ctx.emit('m8:serial', 'v');
    check('G serial 收集为结果数组（按注册顺序）',
        Array.isArray(serial) && serial.join(',') === 's1:v,s2:v', JSON.stringify(serial));

    ctx.on('m8:waterfall', (p) => `${p}-a`, { mode: EventMode.WATERFALL });
    ctx.on('m8:waterfall', (p) => `${p}-b`, { mode: EventMode.WATERFALL });
    const wf = await ctx.emit('m8:waterfall', 'x');
    check('G waterfall 链式传递（后一个收到前一个的返回值）', wf === 'x-a-b', String(wf));

    ctx.on('m8:maybe', () => 'changed');
    check('G 无监听者时 serial 返回空数组',
        (await ctx.emit('m8:nobody', 'p')).length === 0);
    check('G 无监听者时 waterfall 返回原 payload 不变',
        (await ctx.emit('m8:nobody', { k: 1 }, { mode: EventMode.WATERFALL })).k === 1);
    check('G 显式指定 waterfall 时即使监听者登记为 serial 也走链式',
        (await ctx.emit('m8:maybe', 'in', { mode: EventMode.WATERFALL })) === 'changed');
}

{
    const ctx = new PluginContext({ name: 'demo/evt-bad' });
    const r1 = await throws(() => ctx.on('', () => {}));
    const r2 = await throws(() => ctx.on('e', 'nope'));
    const r3 = await throws(() => ctx.on('e', () => {}, { mode: 'bogus' }));
    check('G 非法事件名被拒', !!r1 && /非空字符串/.test(r1.msg), r1?.msg);
    check('G 非函数 handler 被拒', !!r2 && /handler 必须为函数/.test(r2.msg), r2?.msg);
    check('G 非法事件模式被拒', !!r3 && /仅支持 serial \/ waterfall/.test(r3.msg), r3?.msg);
}

suite.finish();
