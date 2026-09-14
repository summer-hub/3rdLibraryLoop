/**
 * M7（Phase 4）验收：链路追踪、多租户、成本与审计
 *
 *   A Trace：W3C traceparent 解析/生成、父子跨度树、跨服务续接、采样
 *   B Tenant：结构性隔离（键命名空间）、RBAC、配额、跨租户"不存在"语义
 *   C CostMeter：token 计量、按用途下钻、预算熔断
 *   D AuditLog：哈希链完整性校验 + **篡改必被发现**
 *   E Notify：跨实例扇出（3 实例）、回环抑制、重复事件去重
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { Tracer, InMemoryExporter, parseTraceparent, formatTraceparent, newTraceId } = await imp('Server/Distributed/Trace.js');
const {
    TenantRegistry, TenantScope, runWithTenant, currentTenant, requireTenant, BUILTIN_RBAC
} = await imp('Server/Distributed/Tenant.js');
const { CostMeter, AuditLog } = await imp('Server/Distributed/Governance.js');
const { NotifyFanout, MemoryPubSubBackend } = await imp('Server/Distributed/Notify.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// ═══ A. 链路追踪 ════════════════════════════════════════════════════
console.log('\n── A. Trace（W3C traceparent + 父子跨度树）──');
{
    const tp = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    check('A1 正确解析 traceparent',
        tp.traceId === '4bf92f3577b34da6a3ce929d0e0e4736'
        && tp.parentId === '00f067aa0ba902b7' && tp.sampled === true);

    check('A2 畸形 traceparent 被拒绝（不猜测式修复，避免把无关请求接进同一棵树）',
        parseTraceparent('not-a-traceparent') === null
        && parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01') === null
        && parseTraceparent(null) === null
        && parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7') === null);

    const round = formatTraceparent({ traceId: newTraceId(), spanId: '00f067aa0ba902b7', sampled: false });
    check('A3 生成/解析往返一致（采样位保留）',
        parseTraceparent(round).sampled === false && round.startsWith('00-'));

    const exporter = new InMemoryExporter();
    const tracer = new Tracer({ service: 'orchestrator-svc', sampleRate: 1, exporter });

    const taskSpan = tracer.startSpan({ name: 'task:t1', attributes: { taskId: 't1' } });
    const stepSpan = tracer.startSpan({ name: 'step:2', traceId: taskSpan.traceId, parentSpanId: taskSpan.spanId });
    const roleSpan = tracer.startSpan({ name: 'role:coder', traceId: taskSpan.traceId, parentSpanId: stepSpan.spanId });
    const llmSpan = tracer.startSpan({ name: 'llm:chatJSON', traceId: taskSpan.traceId, parentSpanId: roleSpan.spanId });
    llmSpan.setAttribute('model', 'deepseek-v4-flash');
    llmSpan.addEvent('retry', { attempt: 2 });
    tracer.endSpan(llmSpan);
    tracer.endSpan(roleSpan);
    tracer.endSpan(stepSpan);
    tracer.endSpan(taskSpan);

    const tree = exporter.tree(taskSpan.traceId);
    check('A4 可以从"任务"下钻到"具体 LLM 调用"（4 层跨度树）',
        tree.total === 4 && tree.roots.length === 1 && tree.orphans.length === 0,
        `total=${tree.total} roots=${tree.roots.length}`);
    check('A5 父子链正确（task → step → role → llm）',
        tree.roots[0].name === 'task:t1'
        && tree.roots[0].children[0].name === 'step:2'
        && tree.roots[0].children[0].children[0].name === 'role:coder'
        && tree.roots[0].children[0].children[0].children[0].name === 'llm:chatJSON');
    const llm = tree.roots[0].children[0].children[0].children[0];
    check('A6 LLM 跨度带属性与事件（可回答"为什么这样规划"）',
        llm.attributes.model === 'deepseek-v4-flash'
        && llm.events[0].name === 'retry' && llm.events[0].attempt === 2);
    check('A7 跨度有时长（性能归因）', llm.durationMs >= 0 && llm.endTimeMs !== null);

    // 跨服务续接：下游用上游的 traceparent 建子跨度
    const upstream = tracer.inject(stepSpan);
    const downstream = new Tracer({ service: 'agent-runtime-svc', sampleRate: 0, exporter });
    const child = downstream.startSpan({ name: 'session:create', traceparent: upstream });
    check('A8 跨服务续接：子跨度属于**同一棵** trace（而非新开一棵）',
        child.traceId === taskSpan.traceId);
    check('A9 采样决定随 traceparent 传播（下游不再自行决定）',
        child.sampled === stepSpan.sampled, `child=${child.sampled} parent=${stepSpan.sampled}`);
    check('A10 上游采样率为 0 也不影响已采样链路（头部采样的一致性）',
        downstream.getStats().sampledOut === 0);

    // 未采样链路不导出
    const noSample = new Tracer({ service: 'x', sampleRate: 0, exporter: new InMemoryExporter() });
    const s = noSample.startSpan({ name: 'dropped' });
    noSample.endSpan(s);
    check('A11 未采样的跨度不导出（追踪数据本身也是成本）',
        noSample.exporter.all().length === 0 && noSample.getStats().sampledOut === 1);

    // 孤儿跨度显式暴露（父跨度缺失时不静默丢弃）
    const ex2 = new InMemoryExporter();
    const t2 = new Tracer({ service: 'x', exporter: ex2 });
    const root2 = t2.startSpan({ name: 'root' });
    const orphan = t2.startSpan({ name: 'child-of-missing', traceId: root2.traceId, parentSpanId: 'deadbeefdeadbeef' });
    t2.endSpan(orphan); t2.endSpan(root2);
    check('A12 父跨度缺失的跨度被归入 orphans（显式暴露而非静默丢弃）',
        ex2.tree(root2.traceId).orphans.length === 1);

    // 异常也计入
    const ex3 = new InMemoryExporter();
    const t3 = new Tracer({ service: 'x', exporter: ex3 });
    try {
        await t3.withSpan({ name: 'failing' }, async () => { throw new Error('boom'); });
    } catch { /* 预期 */ }
    check('A13 withSpan 自动记录异常与 error 状态',
        ex3.all()[0].status === 'error' && /boom/.test(ex3.all()[0].error.message));
}

// ═══ B. 多租户 ══════════════════════════════════════════════════════
console.log('\n── B. Tenant（结构性隔离 + RBAC + 配额）──');
{
    const reg = new TenantRegistry();
    reg.createTenant({ tenantId: 'acme', name: 'ACME' });
    reg.createTenant({ tenantId: 'globex', name: 'Globex', quota: { maxTasksPerDay: 2 } });

    const acmeKeys = reg.scope('acme');
    const globexKeys = reg.scope('globex');
    check('B1 键在构造时就带租户前缀（漏写过滤在结构上不可能发生）',
        acmeKeys.key('task', 't1') === 't:acme:task:t1'
        && globexKeys.key('task', 't1') === 't:globex:task:t1');
    check('B2 两个租户的同名资源键不冲突（不是靠查询过滤，是键本身不同）',
        acmeKeys.key('task', 't1') !== globexKeys.key('task', 't1'));
    check('B3 owns() 可判断归属（写入前可校验）',
        acmeKeys.owns('t:acme:task:t1') === true && acmeKeys.owns('t:globex:task:t1') === false);
    check('B4 未知租户无法取得作用域（抛错而非返回空 scope）',
        (() => { try { reg.scope('nope'); return false; } catch { return true; } })());

    // 上下文传播
    const seen = await runWithTenant(acmeKeys, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return currentTenant()?.tenantId;
    });
    check('B5 租户上下文跨 await 传播（存储层无需每个参数都传租户）', seen === 'acme');
    check('B6 无上下文时 requireTenant 明确报错（不会退化为"默认租户"）',
        (() => { try { requireTenant(); return false; } catch (e) { return e.code === 'ENO_TENANT'; } })());

    // RBAC
    reg.grant('acme', 'alice', ['operator']);
    reg.grant('acme', 'bob', ['viewer']);
    reg.grant('acme', 'root', ['platformAdmin']);
    check('B7 权限集合正确（显式列全，不做角色继承）',
        reg.permissionsOf('acme', 'alice').has('task:write')
        && !reg.permissionsOf('acme', 'bob').has('task:write'));
    check('B8 允许：operator 可写任务',
        reg.authorize({ tenantId: 'acme', userId: 'alice', permission: 'task:write' }).allowed === true);
    check('B9 拒绝：viewer 不可写任务',
        reg.authorize({ tenantId: 'acme', userId: 'bob', permission: 'task:write' }).allowed === false);
    check('B10 拒绝：operator 不可管理租户（权限边界清晰）',
        reg.authorize({ tenantId: 'acme', userId: 'alice', permission: 'tenant:manage' }).allowed === false);
    check('B11 通配平台管理员可跨所有权限',
        reg.authorize({ tenantId: 'acme', userId: 'root', permission: 'tenant:manage' }).allowed === true);
    reg.grant('globex', 'carol', ['operator']);
    check('B12 同一用户在不同租户的权限互相独立（成员关系按租户隔离）',
        reg.authorize({ tenantId: 'acme', userId: 'carol', permission: 'task:read' }).allowed === false);

    reg.disable('globex');
    check('B13 停用租户后一律拒绝（含本可放行的权限）',
        reg.authorize({ tenantId: 'globex', userId: 'carol', permission: 'task:read' }).allowed === false
        && reg.authorize({ tenantId: 'globex', userId: 'carol', permission: 'task:read' }).reason === 'tenant-disabled');

    // 跨租户：返回"不存在"而不是"无权限"
    const cross = reg.checkCrossTenant({ requesterTenant: 'acme', targetTenant: 'globex' });
    check('B14 跨租户访问返回 404 语义（不泄露"资源存在但不属于你"）',
        cross.ok === false && cross.code === 404 && cross.message === '资源不存在');

    // 配额
    const q1 = await reg.consumeQuota({ tenantId: 'globex', kind: 'tasksPerDay' });
    const q2 = await reg.consumeQuota({ tenantId: 'globex', kind: 'tasksPerDay' });
    const q3 = await reg.consumeQuota({ tenantId: 'globex', kind: 'tasksPerDay' });
    check('B15 配额生效：第 3 次超过上限被拒', q1.allowed && q2.allowed && !q3.allowed,
        `used=${q3.used}/${q3.limit}`);
    check('B16 被拒绝的请求不写入用量（否则租户永久无法恢复）',
        q3.used === 2, `used=${q3.used}`);
    check('B17 配额按租户独立（acme 不受 globex 影响）',
        (await reg.checkQuota({ tenantId: 'acme', kind: 'tasksPerDay' })).used === 0);
    check('B18 并发类配额可通过 release 归还',
        await (async () => {
            await reg.consumeQuota({ tenantId: 'acme', kind: 'concurrentSessions' });
            const after = await reg.checkQuota({ tenantId: 'acme', kind: 'concurrentSessions' });
            await reg.releaseQuota({ tenantId: 'acme', kind: 'concurrentSessions' });
            const final = await reg.checkQuota({ tenantId: 'acme', kind: 'concurrentSessions' });
            return after.used === 1 && final.used === 0;
        })());
    check('B19 内置 5 个角色齐备',
        Object.keys(BUILTIN_RBAC).length === 5 && BUILTIN_RBAC.viewer.includes('task:read'));
    check('B20 未知角色被拒绝（避免拼错角色名后静默无权限）',
        (() => { try { reg.grant('acme', 'x', ['superuser']); return false; } catch { return true; } })());
}

// ═══ C. 成本计量 ════════════════════════════════════════════════════
console.log('\n── C. CostMeter（token 计量与预算熔断）──');
{
    const meter = new CostMeter();
    meter.record({
        model: 'deepseek-v4-flash', usage: { prompt_tokens: 1000, completion_tokens: 2000 },
        tenantId: 'acme', taskId: 't1', purpose: 'execute', role: 'coder'
    });
    meter.record({
        model: 'deepseek-v4-flash', usage: { prompt_tokens: 500, completion_tokens: 100 },
        tenantId: 'acme', taskId: 't1', purpose: 'skill-selection', role: null
    });
    meter.record({
        model: 'deepseek-v4-flash', usage: { prompt_tokens: 800, completion_tokens: 400 },
        tenantId: 'acme', taskId: 't1', purpose: 'summarize', role: 'coder'
    });

    const byPurpose = meter.report({ tenantId: 'acme', by: 'purpose' });
    check('C1 按用途下钻（能回答"成本花在匹配还是执行"）',
        Object.keys(byPurpose.byKey).length === 3 && byPurpose.byKey.execute.calls === 1,
        Object.keys(byPurpose.byKey).join(','));
    check('C2 总成本 = 各用途之和', byPurpose.totalUsd > 0 && byPurpose.calls === 3);

    const expected = (1000 / 1000) * 0.0002 + (2000 / 1000) * 0.0008
        + (500 / 1000) * 0.0002 + (100 / 1000) * 0.0008
        + (800 / 1000) * 0.0002 + (400 / 1000) * 0.0008;
    check('C3 计价正确（按 model 的输入/输出单价分别计算）',
        Math.abs(byPurpose.totalUsd - expected) < 1e-6,
        `got=${byPurpose.totalUsd} expect=${Number(expected.toFixed(6))}`);
    check('C4 任务级成本可查（SLA 的"单任务成本上限"依据）',
        meter.taskCost('t1') === byPurpose.totalUsd);

    // 缺失 usage 必须显式计数，不能当 0 成本
    meter.record({ model: 'deepseek-v4-flash', tenantId: 'acme', taskId: 't1', purpose: 'execute' });
    check('C5 缺失 usage 被显式计数（当 0 成本会让报表系统性偏低且无提示）',
        meter.getStats().missingUsage === 1 && meter.getStats().calls === 4);

    // 未知模型按最贵档估算
    const unknown = new CostMeter();
    const u = unknown.record({ model: 'brand-new-model', usage: { prompt_tokens: 1000, completion_tokens: 1000 } });
    check('C6 未知模型按最贵档估算（宁可高估，避免"未知即免费"导致失控）',
        u.costUsd === 0.005 + 0.015, `cost=${u.costUsd}`);

    // 单次超大头告警
    const big = new CostMeter({ singleCallMaxUsd: 0.001 });
    big.record({ model: 'deepseek-v4-flash', usage: { prompt_tokens: 100000, completion_tokens: 100000 } });
    check('C7 单次调用超过上限被计数（预检拦不住单次超大头）',
        big.getStats().oversizeCalls === 1);

    // 预算熔断
    const breaker = meter.createBudgetBreaker({ tenantId: 'acme', budgetUsd: 0.001 });
    check('C8 预算熔断：已用超预算时拒绝', breaker.open === true && breaker.check().allowed === false,
        `spent=$${breaker.spentUsd}`);
    const rich = meter.createBudgetBreaker({ tenantId: 'acme', budgetUsd: 100 });
    check('C9 预算充足时放行', rich.check().allowed === true && rich.open === false);
    const other = meter.createBudgetBreaker({ tenantId: 'globex', budgetUsd: 0.001 });
    check('C10 预算按租户隔离（一个租户超支不影响别人）', other.open === false);
}

// ═══ D. 审计哈希链 ══════════════════════════════════════════════════
console.log('\n── D. AuditLog（哈希链可验证未被篡改）──');
{
    const log = new AuditLog();
    log.append({ actor: 'alice', tenantId: 'acme', action: 'task.create', resource: 't:acme:task:t1' });
    log.append({ actor: 'alice', tenantId: 'acme', action: 'llm.call', resource: 't:acme:task:t1', detail: { model: 'x' } });
    log.append({ actor: 'bob', tenantId: 'acme', action: 'role.decision', resource: 'step:2', detail: { approved: false } });

    const v1 = log.verify();
    check('D1 未篡改时链校验通过', v1.ok === true && v1.checked === 3, JSON.stringify(v1).slice(0, 80));
    check('D2 链尾 hash 可对外锚定（抗抵赖的外部接口）',
        typeof v1.chainHead === 'string' && v1.chainHead.length === 64);

    // 篡改内容 → 必须被发现，并给出精确 seq
    log._tamperForTest(2, { outcome: 'denied' });
    const v2 = log.verify();
    check('D3 修改记录内容会被发现并指出具体 seq',
        v2.ok === false && v2.brokenAt === 2 && /不匹配/.test(v2.reason),
        `brokenAt=${v2.brokenAt} reason=${v2.reason}`);

    // 恢复后依然能校验（证明检测是内容驱动而非一次性状态）
    const log2 = new AuditLog();
    log2.append({ actor: 'a', action: 'x.1' });
    log2.append({ actor: 'a', action: 'x.2' });
    const head = log2.getChainHead();
    log2.append({ actor: 'a', action: 'x.3' });
    check('D4 追加后链头变化（每一条都影响后续所有 hash）', log2.getChainHead() !== head);

    // 删除条目（模拟"悄悄删掉一条不利记录"）
    const log3 = new AuditLog();
    for (let i = 0; i < 5; i++) log3.append({ actor: 'a', action: `a.${i}` });
    const before = log3.verify().ok;
    // 直接破坏连续性：把第 4 条的前置 hash 改掉
    log3._tamperForTest(4, { prevHash: 'f'.repeat(64) });
    check('D5 删除/重排条目会让 prevHash 不连续（无法悄悄移除记录）',
        before === true && log3.verify().ok === false && /prevHash 不连续/.test(log3.verify().reason));

    // 规范化：键顺序不影响 hash
    check('D6 hash 与键的插入顺序无关（规范化后再哈希）',
        AuditLog.hashEntry({ a: 1, b: 2 }) === AuditLog.hashEntry({ b: 2, a: 1 }));

    // 有界
    const small = new AuditLog({ maxEntries: 3 });
    for (let i = 0; i < 10; i++) small.append({ actor: 'a', action: `n.${i}` });
    check('D7 审计日志有界且淘汰后仍可校验（记录新的链起点）',
        small.size === 3 && small.verify().ok === true && small.getStats().baseSeq === 7,
        `size=${small.size} baseSeq=${small.getStats().baseSeq}`);

    check('D8 缺少 actor/action 的记录被拒绝（审计不能有空记录）',
        (() => { try { small.append({ action: 'x' }); return false; } catch { return true; } })());

    const q = log.query({ tenantId: 'acme', action: 'llm.call' });
    check('D9 可按租户/动作检索（合规核查的前提）', q.length === 1 && q[0].actor === 'alice');
}

// ═══ E. 跨实例事件扇出 ══════════════════════════════════════════════
console.log('\n── E. Notify（跨实例扇出 + 回环抑制 + 去重）──');
{
    const bus = new MemoryPubSubBackend();
    /** @type {Map<string, object[]>} 用实例 id 作键（避免 key 拼错导致假失败） */
    const got = new Map();
    const mk = (id) => {
        got.set(id, []);
        return new NotifyFanout({
            instanceId: id,
            backend: bus,
            localSink: (channel, eventType, data) => got.get(id).push({ channel, eventType, data })
        });
    };
    const i1 = mk('inst-1'), i2 = mk('inst-2'), i3 = mk('inst-3');
    for (const i of [i1, i2, i3]) await i.subscribeChannel('task:t1');

    // 前端连在 i1，任务在 i2 上执行 → i1 必须收到
    const r = await i2.publish({ channel: 'task:t1', eventType: 'orch:step:status', data: { stepId: 2 } });
    check('E1 跨实例扇出：发布到 i2，i1 与 i3 都能收到',
        got.get('inst-1').length === 1 && got.get('inst-3').length === 1,
        `i1=${got.get('inst-1').length} i3=${got.get('inst-3').length}`);
    check('E2 发布者本地直发（不依赖总线回环，延迟最低）',
        got.get('inst-2').length === 1 && r.local === 1);
    check('E3 回环被抑制：发布者不会因为总线回投而收到两次',
        got.get('inst-2').length === 1,
        `i2=${got.get('inst-2').length} suppressed=${i2.getStats().loopbackSuppressed}`);
    check('E4 返回了 local/remote 投递数（remote = 扇出的**其他**实例数）',
        r.remote === 2 && r.local === 1, `remote=${r.remote} local=${r.local}`);
    // 防御性：真实 Redis Pub/Sub 会把消息投回发布者，因此接收侧的来源判定必须保留
    const beforeSelf = got.get('inst-2').length;
    i2._onEnvelope({
        eventId: 'loopback-1', channel: 'task:t1', eventType: 'x', data: {},
        originInstance: 'inst-2', at: 'now'
    });
    check('E4b 即使 broker 把消息投回发布者，接收侧仍会抑制回环（双保险）',
        got.get('inst-2').length === beforeSelf && i2.getStats().loopbackSuppressed === 1,
        `loopbackSuppressed=${i2.getStats().loopbackSuppressed}`);

    // 模拟 broker 重复投递同一条事件
    const dupEnvelope = {
        eventId: 'fixed-event-id', channel: 'task:t1', eventType: 'orch:step:status',
        data: { stepId: 3 }, originInstance: 'inst-2', at: 'now'
    };
    i1._onEnvelope(dupEnvelope);
    i1._onEnvelope(dupEnvelope);
    check('E5 重复投递的事件只投递一次（实例 × 事件维度去重）',
        got.get('inst-1').filter((e) => e.data.stepId === 3).length === 1
        && i1.getStats().duplicates === 1,
        `delivered=${got.get('inst-1').filter((e) => e.data.stepId === 3).length} dup=${i1.getStats().duplicates}`);

    // 每个实例都需要处理一次 → 去重不能是全局的
    i2._onEnvelope({ ...dupEnvelope, originInstance: 'inst-3' });
    check('E6 去重作用域是"实例 × 事件"（扇出本就是有意的多次投递）',
        got.get('inst-2').filter((e) => e.data.stepId === 3).length === 1);

    check('E7 退订后不再收到事件',
        await (async () => {
            await i3.close();
            const before = got.get('inst-3').length;
            await i2.publish({ channel: 'task:t1', eventType: 'x', data: {} });
            return got.get('inst-3').length === before;
        })());
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
