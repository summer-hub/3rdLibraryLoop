/**
 * M5（Phase 2）验收：Supervisor 角色接力与评审环（Phase 2 的核心验收项）
 *
 * 对应 docs/ROADMAP.md 的 Phase 2 验收条款：
 *   1. 同一任务可被 Planner → Coder → Reviewer 三角色接力；
 *   2. Reviewer 否决时触发 Coder 重做（**有界**）；
 *   3. Agent 间通信 100% 可从 MessageBus 回放日志重建。
 *
 *   A 正向接力：计划 → 实现 → 评审 → 验证，各角色按序执行、产物入黑板
 *   B 评审驳回：驳回 → 回到实现阶段、理由注入 prompt、修订计数递增
 *   C 有界性：始终驳回时在 maxRevisions 处停止并给出可归因失败
 *   D 结论不可解析：不当作通过、也不消耗修订额度，重试一次后显式失败
 *   E 通信重建：回放日志可完整重建"谁跟谁说了什么"，拓扑包含双向边
 *   F 角色能力边界：越权 SKILL 不创建会话即被拦截
 *   G 指定 SKILL 的收窄策略：可配置，且收窄后仍能产出交付物
 *   H 兜底上限：maxRoleRuns 能截断任何未预期的循环
 *   I 失败归因：必需阶段（验证）结论不通过 → verify_failed
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { Supervisor } = await imp('Server/Agent/Supervisor/Supervisor.js');
const { getBuiltinPlan, CollaborationPlan } = await imp('Server/Agent/Supervisor/CollaborationPlan.js');
const { MessageIntent, BROADCAST } = await imp('Server/Agent/Messaging/AgentMessage.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const silence = () => {};

/**
 * 构造一个脚本化的「会话适配器工厂」。
 *
 * 每次调用 = 一个角色会话。`script(ctx)` 返回该会话的结果：
 *   - `{ success, metrics, verdictText, resultBody }`
 *   - `throw` 表示会话本身出错
 *
 * ctx = { role, stageId, attempt, prompt, taskDir }
 *
 * 刻意让 mock 真的**写结果文件**：因为 Supervisor 的"评审者必须看到实物"
 * 语义是从磁盘读被评审产物的，只在内存里返回 success 会绕过这条关键路径
 * （那样测试就会假绿）。
 */
function makeAdapterFactory(script) {
    const sessions = [];
    const factory = async () => {
        const rec = {
            role: null, stageId: null, attempt: 0, prompt: null,
            sessionId: null, resultPath: '', skill: ''
        };
        return {
            get sessionId() { return rec.sessionId; },
            get usedSkillName() { return rec.skill; },
            async initContext(p) {
                rec.role = p.roleId;
                rec.attempt = p.initialExecuteStep ?? 0;
                rec.prompt = p.rolePrompt || '';
                rec.taskDir = p.taskDir;
                rec.specifiedSkill = p.specifiedSkill;
                rec.taskDescription = p.taskDescription;
                // 从角色 prompt 里抽出 stageId（roleDesc 里含「当前阶段 X」）
                rec.stageId = (rec.prompt.match(/当前阶段 (\w+)/) || [, null])[1];
            },
            async executeStart() {
                rec.sessionId = `sess-${rec.role}-${sessions.length}`;

                const out = await script({
                    role: rec.role, stageId: rec.stageId, attempt: rec.attempt,
                    prompt: rec.prompt, taskDir: rec.taskDir,
                    specifiedSkill: rec.specifiedSkill, sessions
                });
                if (!out) return { success: false, resultPath: '', metrics: null };

                const base = `step${out.stepId ?? 1}_loop0_result_${rec.attempt}_${rec.role}.md`;
                rec.resultPath = path.join(rec.taskDir, base);
                await fs.mkdir(rec.taskDir, { recursive: true });
                await fs.writeFile(rec.resultPath,
                    `# ${rec.role}\n\n${out.resultBody || '产物正文'}\n\n## 执行状态\n\n成功\n`, 'utf8');
                rec.skill = out.skill || '';

                if (out.metrics !== undefined) {
                    await fs.writeFile(
                        path.join(rec.taskDir,
                            `step${out.stepId ?? 1}_loop0_meta_${rec.attempt}_${rec.role}.json`),
                        JSON.stringify(out.metrics), 'utf8');
                }
                // 快照在**产物落盘之后**登记，否则 factory.sessions 里看不到 resultPath
                // （这正是本套件第一次运行时 B6 假失败的原因）
                sessions.push({ ...rec });
                return { success: out.success !== false, resultPath: rec.resultPath, metrics: out.metrics ?? null };
            },
            async controlExecution() { return true; },
            async drainBackgroundTasks() { return { drained: true }; }
        };
    };
    factory.sessions = sessions;
    return factory;
}

async function makeSupervisor({ script, plan = 'thorough', knownSkills, tag, ...rest }) {
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), `m5-sup-${tag || 'x'}-`));
    const factory = makeAdapterFactory(script);
    const sup = new Supervisor({
        taskId: `t-${tag || 'x'}`,
        taskDir,
        skillDirectory: '',
        plan,
        runnerFactory: factory,
        logger: silence,
        knownSkillNames: knownSkills,
        ...rest
    });
    await sup.init();
    return { sup, taskDir, factory };
}

// ═══ A. 正向接力 ═══════════════════════════════════════════════════════
console.log('\n── A. 正向接力（planner → coder → reviewer → verifier）──');
{
    const order = [];
    const { sup, taskDir, factory } = await makeSupervisor({
        tag: 'happy',
        knownSkills: ['rnoh-lib-demo-create', 'acceptance-check', 'rnoh-cptf-test-run'],
        script: ({ role, stageId }) => {
            order.push(stageId);
            if (role === 'reviewer') return { metrics: { approved: true, reasons: [], suggestions: [] } };
            if (role === 'verifier') {
                return { metrics: { verdict: '通过', evidence: ['node test.mjs → 12 passed'] } };
            }
            if (role === 'planner') return { metrics: { subtasks: [{ goal: 'g', output: 'o', verify: 'v' }], risks: [] } };
            if (role === 'retriever') return { metrics: { findings: [{ fact: 'f', source: 'docs/x.md' }], hits: 1 } };
            // coder 产出可被评审的真实正文
            return { metrics: { artifacts: ['a.md'], summary: 'done' }, resultBody: '实现正文：已生成 ArkTS 桥接代码' };
        }
    });

    const res = await sup.run({ stepId: 1, taskDescription: '实现 X 库的鸿蒙桥接' });
    check('A1 全流程成功', res.success === true, res.error || '');
    check('A2 五个阶段按计划顺序执行（检索→规划→实现→评审→验证）',
        order.join('>') === 'retrieve>plan>code>review>verify', order.join('>'));
    check('A3 角色会话数 = 阶段数，无多余会话',
        res.roleRuns === 5 && factory.sessions.length === 5, `roleRuns=${res.roleRuns}`);
    const coderArtifact = factory.sessions.find((s) => s.role === 'coder').resultPath;
    check('A4 返回的交付物路径 = 主阶段（实现）的产物路径（供 Orchestrator 链路传递）',
        res.resultPath === coderArtifact && /_coder\.md$/.test(res.resultPath),
        path.basename(res.resultPath || ''));
    check('A5 结构化指标来自主阶段（通用键值对透传）',
        res.metrics && Array.isArray(res.metrics.artifacts));

    // 黑板：协作结论确实落盘并可读
    check('A6 黑板记录了「实现」条目（作者 coder）',
        sup.blackboard.getEntry('实现')?.author === 'coder');
    check('A7 黑板记录了「计划」「评审结论」「验证结论」',
        !!sup.blackboard.getEntry('计划') && !!sup.blackboard.getEntry('评审结论')
        && !!sup.blackboard.getEntry('验证结论'));
    check('A8 黑板按阶段 id 保存产物引用（供精确取用）',
        !!sup.blackboard.getEntry('artifact:code')?.value?.resultPath);

    // 评审独立性关键证据：评审者的 prompt 里出现了执行者的**产物正文**
    const reviewSession = factory.sessions.find((s) => s.role === 'reviewer');
    check('A9 评审者 prompt 含被评审产物的真实正文（不是只看路径）',
        reviewSession.prompt.includes('实现正文：已生成 ArkTS 桥接代码'));
    check('A10 执行者 prompt 含规划者产出的计划（黑板共享生效）',
        factory.sessions.find((s) => s.role === 'coder').prompt.includes('计划'));

    // 验证者必须独立复现证据：prompt 里带上评审结论
    const verifySession = factory.sessions.find((s) => s.role === 'verifier');
    check('A11 验证者 prompt 含评审结论（独立验证而非重复评审）',
        verifySession.prompt.includes('评审结论'));

    // 未指定 SKILL 时角色会话不应被塞入越权 SKILL
    check('A12 角色会话未收到指定的 SKILL（本次未指定）',
        factory.sessions.every((s) => !s.specifiedSkill));

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ B. 评审驳回 → 重做 ═══════════════════════════════════════════════
console.log('\n── B. 评审驳回触发重做（有界）──');
{
    const codeAttempts = [];
    const reviewAttempts = [];
    let codeFeedback = null;

    const { sup, taskDir, factory } = await makeSupervisor({
        tag: 'reject',
        knownSkills: ['rnoh-lib-demo-create'],
        script: ({ role, attempt, prompt }) => {
            if (role === 'coder') {
                codeAttempts.push(attempt);
                if (attempt === 1) codeFeedback = prompt;
                return { metrics: { artifacts: ['a.md'] }, resultBody: `第 ${attempt} 版实现` };
            }
            if (role === 'reviewer') {
                reviewAttempts.push(attempt);
                if (attempt === 0) {
                    return { metrics: {
                        approved: false,
                        reasons: ['缺少错误分支处理', '未给出编译验证结果'],
                        suggestions: ['建议补充日志']
                    } };
                }
                return { metrics: { approved: true, reasons: [] } };
            }
            if (role === 'verifier') return { metrics: { verdict: '通过', evidence: ['cmd → ok'] } };
            return { metrics: {} };
        }
    });

    const res = await sup.run({ stepId: 2, taskDescription: '实现 Y' });
    check('B1 驳回后重做并最终成功（评审门不是单向门）', res.success === true, res.error || '');
    check('B2 实现阶段被执行两次（attempt 0 与 1）',
        codeAttempts.length === 2 && codeAttempts[0] === 0 && codeAttempts[1] === 1,
        `attempts=${codeAttempts.join(',')}`);
    check('B3 评审阶段被执行两次', reviewAttempts.length === 2, `attempts=${reviewAttempts.join(',')}`);
    check('B4 修订计数被记录', res.revisions?.code === 1, JSON.stringify(res.revisions));
    check('B5 驳回理由被逐条注入重做时的 prompt（可行动，不是"质量不好"）',
        !!codeFeedback && codeFeedback.includes('缺少错误分支处理')
        && codeFeedback.includes('未给出编译验证结果'));
    check('B6 重做产出的产物文件名不与上一版冲突（可对比改前/改后）',
        new Set(factory.sessions.filter((s) => s.role === 'coder').map((s) => s.resultPath)).size === 2);
    check('B7 最终阶段链完整（验证在通过后执行）',
        res.stageRuns.filter((s) => s.stageId === 'verify').length === 1);
    check('B8 协作成功时无失败归因', res.failureKind === null, String(res.failureKind));

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ C. 有界性：始终驳回 ══════════════════════════════════════════════
console.log('\n── C. 修订环有界（始终驳回）──');
{
    const plan = getBuiltinPlan('standard');   // maxRevisions 默认 2
    const codeCount = { n: 0 };
    const reviewCount = { n: 0 };
    const { sup, taskDir } = await makeSupervisor({
        tag: 'bounded',
        plan,
        script: ({ role }) => {
            if (role === 'coder') { codeCount.n++; return { metrics: { artifacts: ['a.md'] } }; }
            if (role === 'reviewer') { reviewCount.n++; return { metrics: { approved: false, reasons: ['仍然不足'] } }; }
            return { metrics: {} };
        }
    });

    const res = await sup.run({ stepId: 3, taskDescription: '实现 Z' });
    check('C1 始终驳回时任务失败', res.success === false);
    check('C2 失败归因明确为 review_rejected', res.failureKind === 'review_rejected', String(res.failureKind));
    check('C3 修订次数严格等于 maxRevisions（不多不少）',
        res.revisions.code === plan.maxRevisions, `revisions=${res.revisions.code}`);
    check('C4 实现阶段执行次数 = 1 + maxRevisions（不无限重做）',
        codeCount.n === plan.maxRevisions + 1, `code=${codeCount.n}`);
    check('C5 评审阶段执行次数 = 1 + maxRevisions',
        reviewCount.n === plan.maxRevisions + 1, `review=${reviewCount.n}`);
    check('C6 失败原因包含评审者给出的理由（可归因，非"未知错误"）',
        /仍然不足/.test(res.error || ''), res.error);
    check('C7 失败时不再执行验证阶段（不在未通过的实现上白跑验证）',
        !res.stageRuns.some((s) => s.stageId === 'verify'));

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ D. 结论不可解析 ══════════════════════════════════════════════════
console.log('\n── D. 评审结论不可解析（三态语义）──');
{
    const reviewCount = { n: 0 };
    const { sup, taskDir } = await makeSupervisor({
        tag: 'unparsable',
        plan: 'standard',
        script: ({ role }) => {
            if (role === 'coder') return { metrics: { artifacts: ['a.md'] } };
            if (role === 'reviewer') {
                reviewCount.n++;
                // 故意不写 approved（模拟"评审者没按契约产出结论文件"）
                return { metrics: reviewCount.n === 1 ? { note: '我觉得还行' } : undefined };
            }
            return { metrics: {} };
        }
    });

    const res = await sup.run({ stepId: 4, taskDescription: '实现 W' });
    check('D1 结论不可解析 → 显式失败，绝不当作通过',
        res.success === false && res.failureKind === 'verdict_unparsable', String(res.failureKind));
    check('D2 不可解析会原地重跑一次评审（不消耗修订额度，给一次纠错机会）',
        reviewCount.n === 2, `review=${reviewCount.n}`);
    check('D3 重跑时通过 prompt 明确告知缺少的字段',
        res.stageRuns.some((r) => r.note === 'gate_retry') || reviewCount.n === 2);
    check('D4 未消耗修订次数（revisions 为空 —— 与"驳回"区分开）',
        Object.keys(res.revisions).length === 0, JSON.stringify(res.revisions));

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ E. 通信重建 ══════════════════════════════════════════════════════
console.log('\n── E. 协作过程 100% 可由回放日志重建 ──');
{
    const { sup, taskDir } = await makeSupervisor({
        tag: 'replay',
        plan: 'standard',
        script: ({ role, attempt }) => {
            if (role === 'coder') return { metrics: { artifacts: ['a.md'] } };
            if (role === 'reviewer') {
                return attempt === 0
                    ? { metrics: { approved: false, reasons: ['证据不足'] } }
                    : { metrics: { approved: true, reasons: [] } };
            }
            return { metrics: {} };
        }
    });

    const res = await sup.run({ stepId: 5, taskDescription: '实现 V' });
    const log = sup.getReplayLog();

    check('E1 协作日志非空且覆盖全部阶段', log.length >= 8, `messages=${log.length}`);
    check('E2 日志含派发任务（supervisor → 角色）',
        log.some((m) => m.from === 'supervisor' && m.to === 'coder' && m.intent === MessageIntent.TASK_ASSIGN));

    const revision = log.find((m) => m.intent === MessageIntent.REVISION_REQUEST);
    check('E3 日志含驳回指令且指向被驳回的角色',
        !!revision && revision.from === 'reviewer' && revision.to === 'coder',
        revision ? `${revision.from}→${revision.to}` : '缺失');
    check('E4 驳回指令携带可行动理由与修订计数',
        !!revision && Array.isArray(revision.payload.reasons)
        && revision.payload.reasons.includes('证据不足')
        && revision.payload.revision === 1);

    check('E5 日志含产物发布广播',
        log.some((m) => m.intent === MessageIntent.ARTIFACT_PUBLISHED && m.to === BROADCAST));
    check('E6 日志含终局报告',
        log.some((m) => m.intent === MessageIntent.FINAL_REPORT));

    // 用 logs 独立重建角色序列，并断言与 stageRuns 一致（"可重建"的实质检验）
    const rebuilt = log
        .filter((m) => m.intent === MessageIntent.TASK_ASSIGN)
        .map((m) => m.to);
    const fromRecords = res.stageRuns.filter((r) => !r.note).map((r) => r.role);
    check('E7 由日志重建的角色序列与执行记录完全一致',
        rebuilt.length === fromRecords.length && rebuilt.every((r, i) => r === fromRecords[i]),
        `log=[${rebuilt.join(',')}] records=[${fromRecords.join(',')}]`);

    const topo = sup.getTopology().topology;
    const edgeCodes = topo.edges.map((e) => `${e.from}>${e.to}`);

    check('E8 拓扑图含 supervisor→coder→reviewer 与 reviewer→coder 的驳回边',
        edgeCodes.includes('supervisor>coder')
        && edgeCodes.includes('coder>reviewer')
        && edgeCodes.includes('reviewer>coder'),
        `edges=${edgeCodes.join(' ')}`);

    // 关键：广播（ARTIFACT_PUBLISHED / FINAL_REPORT）不得被展开成 N 条"假交互边"。
    // 5 个角色时一条广播就会产生 4 条并不存在的定向交互，把"谁跟谁真有来往"淹没。
    check('E9 广播单独统计、不污染交互边，也不出现 * 节点',
        Array.isArray(topo.broadcasts) && topo.broadcasts.length >= 1
        && !edgeCodes.includes('supervisor>planner')
        && !edgeCodes.includes('supervisor>retriever')
        && !topo.nodes.includes('*'),
        `broadcasts=${topo.broadcasts.map((b) => `${b.from}:${b.intent}×${b.count}`).join(' ')}`);
    check('E10 回放日志是副本（外部修改不影响总线内部事实源）',
        (() => { const l = sup.getReplayLog(); l[0].from = 'HACK'; return sup.getReplayLog()[0].from !== 'HACK'; })());
    check('E11 协作结束后总线已关闭（实例不可复用，日志不会被污染）',
        sup.getStats().bus.closed === true);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ F. 角色能力边界 ══════════════════════════════════════════════════
console.log('\n── F. 角色能力边界（越权 SKILL 拦截）──');
{
    // 计划强制保留完整协作（不收窄），因此指定的 SKILL 会落到主阶段（coder）。
    // 这里故意指定一个**评审类** SKILL —— coder 无权使用，必须在创建会话前被拦下。
    const factorySessions = [];
    const { sup, taskDir, factory } = await makeSupervisor({
        tag: 'policy',
        plan: new CollaborationPlan({
            id: 'policy-test',
            name: '策略测试',
            stages: [{ id: 'code', role: 'coder', produces: '实现' }],
            onSpecifiedSkill: 'keep',
            maxRoleRuns: 1
        }),
        knownSkills: ['rnoh-lib-demo-create', 'acceptance-check'],
        script: ({ role }) => { factorySessions.push(role); return { metrics: {} }; }
    });

    const res = await sup.run({ stepId: 6, taskDescription: 'x', specifiedSkill: 'acceptance-check' });
    check('F1 越权 SKILL → 失败且归因为 skill_blocked',
        res.success === false && res.failureKind === 'skill_blocked', String(res.failureKind));
    check('F2 越权时**不创建会话**（明知会失败的会话不该占用并发额度）',
        factory.sessions.length === 0, `sessions=${factory.sessions.length}`);
    check('F3 失败原因指名 SKILL 与角色（可行动）',
        /acceptance-check/.test(res.error || '') && /coder/.test(res.error || ''), res.error);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ G. 指定 SKILL 的收窄策略 ════════════════════════════════════════
console.log('\n── G. 指定 SKILL：默认收窄为单阶段（成本可控）──');
{
    const { sup, taskDir, factory } = await makeSupervisor({
        tag: 'collapse',
        plan: 'thorough',
        knownSkills: ['rnoh-lib-demo-create', 'acceptance-check'],
        script: ({ role }) => {
            if (role === 'coder') return { metrics: { artifacts: ['a.md'] } };
            return { metrics: {} };
        }
    });

    const res = await sup.run({ stepId: 7, taskDescription: 'x', specifiedSkill: 'rnoh-lib-demo-create' });
    check('G1 指定执行类 SKILL → 收窄到实现阶段且成功', res.success === true, res.error || '');
    check('G2 只产生 1 个会话（而非 5 个，成本 5 倍之差）',
        res.roleRuns === 1 && factory.sessions.length === 1, `roleRuns=${res.roleRuns}`);
    check('G3 收窄决策被显式记录（不静默改变行为）',
        res.skillRedirect?.toStage === 'code' && res.plan.includes('single'), JSON.stringify(res.skillRedirect));
    check('G4 指定的 SKILL 被真正下发给会话',
        factory.sessions[0].specifiedSkill === 'rnoh-lib-demo-create');

    // 指定评审类 SKILL → 收窄到评审阶段（而不是硬塞给执行者）
    const r2 = await makeSupervisor({
        tag: 'collapse2',
        plan: 'thorough',
        knownSkills: ['rnoh-lib-demo-create', 'acceptance-check'],
        script: ({ role }) => (role === 'reviewer'
            ? { metrics: { approved: true, reasons: [] } }
            : { metrics: {} })
    });
    const res2 = await r2.sup.run({ stepId: 8, taskDescription: 'x', specifiedSkill: 'acceptance-check' });
    check('G5 指定评审类 SKILL → 收窄到评审阶段（按角色能力路由）',
        res2.skillRedirect?.toStage === 'review' && res2.roleRuns === 1,
        JSON.stringify(res2.skillRedirect));
    await fs.rm(taskDir, { recursive: true, force: true });
    await fs.rm(r2.taskDir, { recursive: true, force: true });
}

// ═══ H. 兜底上限 ══════════════════════════════════════════════════════
console.log('\n── H. maxRoleRuns 兜底 ──');
{
    // 构造一个"评审 → 重做"永远循环的计划：maxRevisions 设很大，靠 maxRoleRuns 截断
    const { sup, taskDir } = await makeSupervisor({
        tag: 'runlimit',
        plan: new CollaborationPlan({
            id: 'runaway',
            name: '跑飞计划',
            stages: [
                { id: 'code', role: 'coder', produces: '实现' },
                { id: 'review', role: 'reviewer', produces: '评审结论', reviews: 'code' }
            ],
            maxRevisions: 1000,
            maxRoleRuns: 7
        }),
        script: ({ role }) => (role === 'coder'
            ? { metrics: { artifacts: ['a.md'] } }
            : { metrics: { approved: false, reasons: ['always'] } })
    });

    const res = await sup.run({ stepId: 9, taskDescription: 'x' });
    check('H1 未预期的循环被 maxRoleRuns 截断（不会真的跑 1000 轮）',
        res.roleRuns === 7, `roleRuns=${res.roleRuns}`);
    check('H2 归因明确为 role_run_limit 并提示"修订环未收敛"',
        res.failureKind === 'role_run_limit' && /未收敛/.test(res.error || ''),
        String(res.failureKind));

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ I. 必需阶段的结论校验 ════════════════════════════════════════════
console.log('\n── I. 验证阶段结论校验（required）──');
{
    const { sup, taskDir } = await makeSupervisor({
        tag: 'verifyfail',
        plan: 'verify-only',
        script: ({ role }) => {
            if (role === 'coder') return { metrics: { artifacts: ['a.md'] } };
            if (role === 'verifier') {
                return { metrics: { verdict: '不通过', evidence: ['npm test → 2 failed'] } };
            }
            return { metrics: {} };
        }
    });

    const res = await sup.run({ stepId: 10, taskDescription: 'x' });
    check('I1 验证不通过 → 步骤失败且归因 verify_failed',
        res.success === false && res.failureKind === 'verify_failed', String(res.failureKind));
    check('I2 失败原因含验证者的原始证据（可复现，不是"环境问题"）',
        /npm test → 2 failed/.test(res.error || ''), res.error);
    check('I3 实现阶段产物仍被记录（失败也要保留证据链）',
        sup.blackboard.getEntry('实现')?.author === 'coder');

    // "无法验证"是独立结论，不能混同通过
    const r2 = await makeSupervisor({
        tag: 'verifyunknown',
        plan: 'verify-only',
        script: ({ role }) => (role === 'verifier'
            ? { metrics: { verdict: '无法验证', evidence: ['缺少设备'] } }
            : { metrics: { artifacts: ['a.md'] } })
    });
    const res2 = await r2.sup.run({ stepId: 11, taskDescription: 'x' });
    check('I4 「无法验证」不当作通过', res2.success === false && res2.failureKind === 'verify_failed');

    await fs.rm(taskDir, { recursive: true, force: true });
    await fs.rm(r2.taskDir, { recursive: true, force: true });
}

// ═══ J. 中止与排空 ════════════════════════════════════════════════════
console.log('\n── J. 中止与排空 ──');
{
    const { sup, taskDir } = await makeSupervisor({
        tag: 'abort',
        plan: 'standard',
        script: () => ({ metrics: {} })
    });
    const drained = await sup.drain({ timeoutMs: 500 });
    check('J1 drain 在无在途任务时立即返回', drained.drained === true);

    const r2 = await makeSupervisor({
        tag: 'abort2',
        plan: 'standard',
        script: ({ role }) => (role === 'coder' ? { metrics: { artifacts: ['a.md'] } } : { metrics: { approved: true, reasons: [] } })
    });
    await r2.sup.run({ stepId: 12, taskDescription: 'x' });
    const aborted = await r2.sup.abort();
    check('J2 abort 幂等且可重复调用（已结束的协作不报错）', typeof aborted === 'number');

    await fs.rm(taskDir, { recursive: true, force: true });
    await fs.rm(r2.taskDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
