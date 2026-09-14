/**
 * M5（Phase 2）验收：多 Agent 协作基础件
 *
 *   A 结构化消息：不可变、id 确定、correlationId 配对、纯数据校验
 *   B 协作总线：点对点 / 广播 / 请求-响应 / 超时 / 异常隔离 / 有界日志 / 排空
 *   C 共享黑板：条目版本、路径边界、原子落盘、重载
 *   D 角色定义：能力边界（SKILL 策略）、通信契约、prompt 组装
 *   E 协作计划：计划校验、评审门引用、收窄语义
 *
 * 断言全部基于"可观察行为"，不依赖内部实现细节。
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { AgentMessage, MessageIntent, BROADCAST } = await imp('Server/Agent/Messaging/AgentMessage.js');
const { MessageBus, MessageBusTimeoutError } = await imp('Server/Agent/Messaging/MessageBus.js');
const { Blackboard } = await imp('Server/Agent/Blackboard/Blackboard.js');
const { AgentRole, defaultRoleRegistry, matchSkillPattern } = await imp('Server/Agent/Roles/AgentRole.js');
const { CollaborationPlan, resolvePlan, getBuiltinPlan, BUILTIN_PLANS } =
    await imp('Server/Agent/Supervisor/CollaborationPlan.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// ═══ A. 结构化消息 ═══════════════════════════════════════════════════════
console.log('\n── A. AgentMessage ──');
{
    const m1 = AgentMessage.create(
        { from: 'coder', to: 'reviewer', intent: MessageIntent.REQUEST_REVIEW, payload: { a: 1 } },
        { seq: 0, clock: () => 'T0' }
    );
    check('A1 id 由总线序号生成（确定性，重放可比对）', m1.id === 'msg-000000', m1.id);
    check('A2 correlationId 缺省等于自身 id（请求方即交互根）', m1.correlationId === m1.id);
    check('A3 实例与 payload 均被深冻结（回放日志不可被事后篡改）',
        Object.isFrozen(m1) && Object.isFrozen(m1.payload));

    const r1 = m1.reply({ from: 'reviewer', intent: MessageIntent.REVIEW_RESULT, payload: { approved: false } },
        { seq: 1 });
    check('A4 reply 继承 correlationId（请求-响应配对的基础）', r1.correlationId === m1.correlationId);
    check('A5 reply 反向寻址并记录 inReplyTo',
        r1.to === 'coder' && r1.inReplyTo === m1.id && r1.isReply === true);

    // 非法输入必须被拒——否则坏消息会在总线上排队并污染回放日志
    const bad = [
        ['from 为空', { from: '', to: 'x', intent: MessageIntent.QUERY }],
        ['未知 intent', { from: 'a', to: 'x', intent: 'not.an.intent' }],
        ['to 为空数组', { from: 'a', to: [], intent: MessageIntent.QUERY }],
        ['payload 含函数', { from: 'a', to: 'x', intent: MessageIntent.QUERY, payload: { f: () => 1 } }],
        ['payload 含 class 实例', { from: 'a', to: 'x', intent: MessageIntent.QUERY, payload: { d: new Date() } }],
        ['payload 含 Promise', { from: 'a', to: 'x', intent: MessageIntent.QUERY, payload: { p: Promise.resolve() } }],
        ['payload 循环引用', (() => { const c = {}; c.self = c; return { from: 'a', to: 'x', intent: MessageIntent.QUERY, payload: c }; })()],
        ['payload 含 NaN', { from: 'a', to: 'x', intent: MessageIntent.QUERY, payload: { n: NaN } }],
        ['artifacts 含空串', { from: 'a', to: 'x', intent: MessageIntent.QUERY, artifacts: [''] }],
    ];
    let rejected = 0;
    for (const [, input] of bad) {
        try { AgentMessage.create(input); } catch { rejected++; }
    }
    check('A6 9 类非法消息全部被拒（含 NaN/循环/Promise）',
        rejected === bad.length, `rejected=${rejected}/${bad.length}`);

    const bc = AgentMessage.create({ from: 'a', to: BROADCAST, intent: MessageIntent.ARTIFACT_PUBLISHED });
    check('A7 广播对他人可见、对自己不可见（避免自环处理）',
        bc.matches('b') === true && bc.matches('a') === false);
    check('A8 点对点精确匹配', m1.matches('reviewer') === true && m1.matches('coder') === false);
    check('A9 toJSON → fromJSON 往返等价',
        JSON.stringify(AgentMessage.fromJSON(m1.toJSON()).toJSON()) === JSON.stringify(m1.toJSON()));
}

// ═══ B. 协作总线 ═════════════════════════════════════════════════════════
console.log('\n── B. MessageBus ──');
{
    const bus = new MessageBus({ clock: () => 'T0' });
    const got = [];
    bus.register('coder', (msg) => { got.push(`coder:${msg.intent}`); },
        { intents: [MessageIntent.TASK_ASSIGN, MessageIntent.REVISION_REQUEST] });
    bus.register('reviewer', (msg) => {
        got.push(`reviewer:${msg.intent}`);
        return msg.reply({ from: 'reviewer', intent: MessageIntent.REVIEW_RESULT, payload: { approved: true } });
    });

    const reply = await bus.request(
        { from: 'coder', to: 'reviewer', intent: MessageIntent.REQUEST_REVIEW, payload: { stepId: 1 } },
        { acceptIntents: [MessageIntent.REVIEW_RESULT], timeoutMs: 2000, description: '请求审核' }
    );
    check('B1 请求-响应按 correlationId 成功配对', reply.payload.approved === true);

    await bus.send({ from: 'reviewer', to: 'coder', intent: MessageIntent.REVIEW_RESULT, payload: {} });
    await new Promise((r) => setTimeout(r, 20));
    check('B2 intent 白名单过滤（coder 不处理 review.result）', !got.includes('coder:review.result'));

    const before = bus.getStats().undelivered;
    await bus.send({ from: 'coder', to: 'ghost', intent: MessageIntent.QUERY, payload: {} });
    check('B3 无订阅者计入 undelivered（不静默丢弃）',
        bus.getStats().undelivered === before + 1 && bus.getUndelivered().length >= 1);

    let toErr = null;
    try {
        await bus.request({ from: 'coder', to: 'nobody', intent: MessageIntent.QUERY, payload: {} }, { timeoutMs: 60 });
    } catch (e) { toErr = e; }
    check('B4 超时抛 MessageBusTimeoutError（而非返回 undefined）',
        toErr instanceof MessageBusTimeoutError, toErr?.name);

    bus.register('bad', () => { throw new Error('boom'); });
    const errBefore = bus.getStats().handlerErrors;
    const r = await bus.send({ from: 'x', to: 'bad', intent: MessageIntent.QUERY, payload: {} });
    check('B5 单个 handler 异常被隔离且计数', r.errors === 1 && bus.getStats().handlerErrors === errBefore + 1);

    const trace = bus.deriveTrace(reply.correlationId);
    check('B6 deriveTrace 可重建一次交互（请求 + 应答）', trace.length === 2, `len=${trace.length}`);
    const topo = bus.deriveTopology();
    check('B7 deriveTopology 得到角色间有向边',
        topo.edges.some((e) => e.from === 'coder' && e.to === 'reviewer'), `edges=${topo.edges.length}`);

    const bus2 = new MessageBus({ maxLogSize: 3, clock: () => 'T0' });
    for (let i = 0; i < 10; i++) {
        await bus2.send({ from: 'a', to: BROADCAST, intent: MessageIntent.PROGRESS, payload: { i } });
    }
    check('B8 回放日志有界并累计丢弃数',
        bus2.getReplayLog().length === 3 && bus2.getStats().logDropped === 7);

    const bus3 = new MessageBus({ clock: () => 'T0' });
    let finished = false;
    bus3.register('slow', async () => { await new Promise((rr) => setTimeout(rr, 120)); finished = true; });
    await bus3.send({ from: 'a', to: 'slow', intent: MessageIntent.QUERY, payload: {} });
    const drained = await bus3.drain({ timeoutMs: 3000 });
    check('B9 drain 等待在途 handler（停机不丢副作用）', drained.drained === true && finished === true);

    const bus4 = new MessageBus({ clock: () => 'T0' });
    bus4.register('never', () => {});
    const pending = bus4.request({ from: 'a', to: 'never', intent: MessageIntent.QUERY, payload: {} },
        { timeoutMs: 30000 });
    await new Promise((rr) => setTimeout(rr, 20));
    const closed = await bus4.close({ timeoutMs: 100 });
    let closedErr = null;
    try { await pending; } catch (e) { closedErr = e; }
    check('B10 close 时挂起请求以错误结束（不悬挂到超时）',
        closedErr?.name === 'MessageBusClosedError' && closed.cancelledRequests === 1);

    // 单 handler 覆盖语义：重复 register 同一角色不应导致同一条消息被处理 N 次
    const bus5 = new MessageBus({ clock: () => 'T0' });
    let hits = 0;
    bus5.register('dup', () => { hits++; });
    bus5.register('dup', () => { hits++; });
    await bus5.send({ from: 'a', to: 'dup', intent: MessageIntent.QUERY, payload: {} });
    check('B11 同一角色重复注册为覆盖（避免重复处理导致 N 倍副作用）', hits === 1, `hits=${hits}`);
}

// ═══ C. 共享黑板 ═════════════════════════════════════════════════════════
console.log('\n── C. Blackboard ──');
{
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-bb-'));
    const board = new Blackboard({ taskId: 't1', taskDir: tmp, flushDebounceMs: 0 });
    const init = await board.init();
    check('C1 空黑板初始化', init.loaded === 0 && init.corrupted === false);

    await board.put({ key: '计划', value: { steps: [1, 2] }, author: 'planner', round: 0 });
    check('C2 条目记录作者（协作产物必须可追溯）',
        board.getEntry('计划').author === 'planner' && board.getEntry('计划').revision === 1);

    await board.put({ key: '计划', value: { steps: [1, 2, 3] }, author: 'planner', round: 0, stepId: 2 });
    check('C3 同 key 覆盖递增 revision 且旧版本进历史',
        board.getEntry('计划').revision === 2 && board.getHistory('计划').length === 1);
    check('C4 get 返回最新 value 的副本（外部改动不影响黑板）',
        board.get('计划').steps.length === 3);

    let authorRejected = 0;
    try { await board.put({ key: 'x', value: 1, author: '' }); } catch { authorRejected++; }
    try { await board.put({ key: 'x', value: undefined, author: 'a' }); } catch { authorRejected++; }
    check('C5 缺少作者/undefined 值的写入被拒', authorRejected === 2, `n=${authorRejected}`);

    // 路径边界：这些输入都可能来自 LLM 输出
    const badPaths = ['../x.md', 'a/../../x.md', '/abs/x.md', 'C:\\x.md', '//host/share/x', '', '   ', './../up.md'];
    let pathRejected = 0;
    for (const p of badPaths) {
        try { board.resolveArtifact(p); } catch { pathRejected++; }
    }
    check('C6 8 类越界路径全部被拒（含归一化后逃逸）',
        pathRejected === badPaths.length, `rejected=${pathRejected}/${badPaths.length}`);
    check('C7 合法路径解析到 board/ 子目录内',
        board.resolveArtifact('sub/a.md').startsWith(path.join(tmp, 'board') + path.sep));

    await board.writeArtifact('sub/a.md', 'hello');
    check('C8 产物读写与列举',
        (await board.readArtifact('sub/a.md')) === 'hello'
        && (await board.listArtifacts()).includes('sub/a.md'));
    check('C9 缺失产物返回 fallback（可选产物语义）',
        (await board.readArtifact('missing.md', 'FB')) === 'FB');

    const snap = board.snapshotForPrompt({ maxEntries: 1, maxEntryChars: 20, maxTotalChars: 200 });
    check('C10 snapshotForPrompt 受条数/字符预算约束',
        snap.entries <= 1 && snap.chars <= 200 && snap.text.includes('计划'),
        `entries=${snap.entries} chars=${snap.chars} truncated=${snap.truncated}`);

    check('C11 flush 落盘', (await board.flush()) === true);
    const board2 = new Blackboard({ taskId: 't1', taskDir: tmp, flushDebounceMs: 0 });
    const reloaded = await board2.init();
    check('C12 重载后条目与版本完好（协作可跨进程审计）',
        reloaded.loaded >= 1 && board2.getEntry('计划')?.revision === 2);

    // 并发写：同一 key 并发 put 不应丢更新（复用 AtomicJsonFile 的串行化语义）
    const board3 = new Blackboard({ taskId: 't2', taskDir: path.join(tmp, 'b3'), flushDebounceMs: 0 });
    await board3.init();
    await Promise.all(Array.from({ length: 30 }, (_, i) =>
        board3.put({ key: 'k', value: { i }, author: 'a' })));
    check('C13 30 路并发 put 无丢更新（revision 精确为 30）',
        board3.getEntry('k').revision === 30, `revision=${board3.getEntry('k').revision}`);

    await fs.rm(tmp, { recursive: true, force: true });
}

// ═══ D. 角色定义 ═════════════════════════════════════════════════════════
console.log('\n── D. AgentRole ──');
{
    check('D1 模式匹配：精确 / 前缀 / 中缀',
        matchSkillPattern('acceptance-check', 'acceptance-check') === true
        && matchSkillPattern('arkts-*', 'arkts-code-check') === true
        && matchSkillPattern('arkts-*', 'rn-code-check') === false
        && matchSkillPattern('*-code-check', 'rn-code-check') === true);

    const coder = defaultRoleRegistry.get('coder');
    const reviewer = defaultRoleRegistry.get('reviewer');
    const verifier = defaultRoleRegistry.get('verifier');

    // 角色隔离的核心断言：执行者不能使用评审/验证类 SKILL（防"自己给自己打分"）
    check('D2 执行者可用实现类 SKILL', coder.matchesSkill('rnoh-lib-demo-create') === true);
    check('D3 执行者不可用验收类 SKILL（防自评）', coder.matchesSkill('acceptance-check') === false);
    check('D4 执行者不可用稳定性/覆盖率类 SKILL',
        coder.matchesSkill('flutter-library-stability-check') === false
        && coder.matchesSkill('rnoh-lib-xts-coverage') === false);
    check('D5 评审者可做一致性/代码检查（跨产品线，模式覆盖）',
        reviewer.matchesSkill('flutter-library-consistency-check') === true
        && reviewer.matchesSkill('arkts-code-check') === true);
    check('D6 评审者不做实现类 SKILL', reviewer.matchesSkill('rnoh-lib-demo-create') === false);
    // 注意：`*-interface-*` 是**刻意**归入验证者的能力范围——"比对接口签名"是
    // 验证产物正确性的手段之一（不是实现行为）。因此这里的负例必须取真正的
    // 实现类 SKILL（生成 demo / 写示例代码），而不是接口分析。
    check('D7 验证者只做验证类 SKILL（接口分析归验证、生成物归执行）',
        verifier.matchesSkill('rnoh-cptf-test-run') === true
        && verifier.matchesSkill('rn-library-interface-analyzer') === true
        && verifier.matchesSkill('rnoh-lib-demo-create') === false
        && verifier.matchesSkill('arkts-library-demo-code') === false);

    check('D8 通信契约：评审者接受审核请求、不接受驳回指令',
        reviewer.accepts(MessageIntent.REQUEST_REVIEW) === true
        && reviewer.accepts(MessageIntent.REVISION_REQUEST) === false);

    const prompt = reviewer.buildSystemPrompt({
        role: '审核 stepId=3', blackboard: '- **计划**（作者 planner）：x',
        feedback: '缺少错误分支', round: 1
    });
    check('D9 prompt 注入驳回原因与黑板现状',
        prompt.includes('缺少错误分支') && prompt.includes('计划'));
    check('D10 prompt 以输出契约为末节，且含「## 执行状态」（与 Phase 1 解析兼容）',
        prompt.includes('## 执行状态') && prompt.lastIndexOf('## 输出契约') > prompt.indexOf('缺少错误分支'));
    check('D11 限定 SKILL 范围的角色会在 prompt 里声明边界',
        /可用 SKILL 范围/.test(prompt));

    const noSkill = new AgentRole({ id: 'x', systemPrompt: 'y', skillPolicy: { mode: 'none' } });
    check('D12 mode=none 拒绝一切 SKILL 且 prompt 声明不使用 SKILL',
        noSkill.matchesSkill('anything') === false
        && noSkill.buildSystemPrompt().includes('不使用任何 SKILL'));

    const clone = defaultRoleRegistry.clone();
    clone.register({ id: 'coder2', kind: 'coder', systemPrompt: 'X', skillPolicy: { mode: 'none' } });
    check('D13 派生注册表不污染全局（避免多任务互相影响）',
        defaultRoleRegistry.has('coder2') === false && clone.has('coder2') === true);
    check('D14 内置 5 角色齐备',
        defaultRoleRegistry.list().length === 5
        && ['planner', 'retriever', 'coder', 'reviewer', 'verifier']
            .every((r) => defaultRoleRegistry.has(r)));
}

// ═══ E. 协作计划 ═════════════════════════════════════════════════════════
console.log('\n── E. CollaborationPlan ──');
{
    const plan = getBuiltinPlan('thorough');
    check('E1 内置计划齐备', Object.keys(BUILTIN_PLANS).length === 4
        && !!getBuiltinPlan('standard') && !!getBuiltinPlan('single'));
    check('E2 thorough 计划主阶段 = 被评审的实现阶段',
        plan.primaryStage === 'code' && plan.stage('review').reviews === 'code');
    check('E3 只有声明 reviews 的阶段有否决权',
        plan.gates().length === 1 && plan.gates()[0].id === 'review');
    check('E4 计划收敛为 5 个角色各一？否——角色去重后为 5 个不同角色',
        plan.roleIds().length === 5, plan.roleIds().join(','));

    let rejectSelf = 0;
    try {
        new CollaborationPlan({ id: 'x', stages: [{ id: 'a', role: 'coder', reviews: 'a' }] });
    } catch { rejectSelf++; }
    check('E5 自审计划被拒（否则"驳回"会无限重做自己）', rejectSelf === 1);

    let rejectRef = 0;
    try {
        new CollaborationPlan({ id: 'x', stages: [{ id: 'a', role: 'coder', reviews: 'nope' }] });
    } catch { rejectRef++; }
    check('E6 reviews 指向不存在阶段被拒（引用完整性）', rejectRef === 1);

    let rejectDup = 0;
    try {
        new CollaborationPlan({ id: 'x', stages: [{ id: 'a', role: 'coder' }, { id: 'a', role: 'reviewer' }] });
    } catch { rejectDup++; }
    check('E7 阶段 id 重复被拒', rejectDup === 1);

    check('E8 resolvePlan：缺省/字符串/对象三种写法均可',
        resolvePlan(undefined, 'standard').id === 'standard'
        && resolvePlan('single').id === 'single'
        && resolvePlan({ plan: 'standard', maxRevisions: 5 }).maxRevisions === 5);

    const collapsed = plan.collapseTo('code', '指定 SKILL');
    check('E9 收窄为单阶段计划：stage 数与 maxRevisions 同步收敛',
        collapsed.stages.length === 1 && collapsed.maxRevisions === 0
        && collapsed.primaryStage === 'code' && collapsed.roleIds().length === 1);

    let badPlan = 0;
    try { resolvePlan('no-such-plan'); } catch { badPlan++; }
    check('E10 未知计划名给出明确错误（而非静默降级）', badPlan === 1);
    check('E11 single 计划等价单角色，maxRoleRuns=1',
        getBuiltinPlan('single').roleIds().length === 1 && getBuiltinPlan('single').maxRoleRuns === 1);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
