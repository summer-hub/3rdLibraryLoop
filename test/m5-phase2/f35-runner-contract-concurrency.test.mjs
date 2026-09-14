/**
 * M5（Phase 2）验收：运行器契约、编排集成与并发不变式
 *
 *   A FlexRunner 的角色化扩展（rolePrompt / skillAllowList / 初始执行序号）
 *   B MultiAgentRunner 满足 Orchestrator 的 Runner 契约
 *   C Orchestrator 分派与并发声明（managesOwnConcurrency）
 *   D 并发不变式：一个步骤跑 5 个角色会话，全局会话并发仍不超上限
 *   E 兼容性：多 Agent 关闭时行为与 Phase 1 完全一致；既有 SSE 事件未被改名
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { FlexRunner } = await imp('Server/FlexRunner/FlexRunner.js');
const { Orchestrator, Semaphore, SSE_EVENT } = await imp('Server/Orchestrator/Orchestrator.js');
const { MultiAgentRunner } = await imp('Server/Agent/Supervisor/MultiAgentRunner.js');
const { getBuiltinPlan } = await imp('Server/Agent/Supervisor/CollaborationPlan.js');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const storageStub = () => ({
    manager: { rootDir: os.tmpdir() },
    taskExecStore: () => ({ patchStep: async () => {} }),
    taskStepStore: () => ({ get: async () => null, create: async () => ({}), update: async () => ({}) }),
    json: () => ({ read: async () => null, write: async () => ({}), delete: async () => true })
});

function makeCli({ onPrompt } = {}) {
    const rec = { prompts: [], titles: [] };
    return {
        rec,
        getType: () => 'mock',
        checkHealth: async () => ({ status: 'ok' }),
        startSession: async (title, prompt) => {
            rec.titles.push(title);
            rec.prompts.push(prompt);
            if (onPrompt) onPrompt(prompt, title);
            return { sessionId: `sess-${rec.titles.length}` };
        },
        checkSessionStatus: async () => ({ status: 'completed' }),
        abortSession: async () => {},
        deleteSession: async () => {},
        getSessionMessages: async () => [],
        sendAndWaitMessage: async () => ({ success: false }),
        injectPrompt: async () => ({ success: true })
    };
}

/** 造一个真实的 SKILL 目录（含 SKILL.md frontmatter） */
async function makeSkillDir(names) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-skills-'));
    for (const n of names) {
        await fs.mkdir(path.join(dir, n), { recursive: true });
        await fs.writeFile(path.join(dir, n, 'SKILL.md'), `---\nname: ${n}\ndescription: t\n---\n\n# ${n}\n`, 'utf8');
    }
    return dir;
}

// ═══ A. FlexRunner 角色化扩展 ═════════════════════════════════════════
console.log('\n── A. FlexRunner 角色化扩展 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-fr-'));

    async function runFlex(extra, { resultBody = '## 执行状态\n\n成功\n', cliOpts } = {}) {
        const cli = makeCli(cliOpts);
        const runner = new FlexRunner();
        await runner.initContext({
            taskId: 'frTask', stepId: 1, taskDir,
            skillDirectory: '', taskDescription: '做点事',
            cli, storage: storageStub(),
            skillSelector: { match: async () => null },
            pollIntervalMs: 1,
            ...extra
        });
        cliOpts?.onReady?.(runner);
        const res = await runner.executeStart();
        await runner.drainBackgroundTasks(2000);
        return { res, runner, cli };
    }

    // A1/A2：角色指令注入位置与顺序
    const a = await runFlex({ roleId: 'reviewer', rolePrompt: '你是评审者，只判定不修改。' });
    check('A1 角色指令被注入 prompt 且标注角色 id',
        a.cli.rec.prompts[0].includes('## 你的角色（角色：reviewer）')
        && a.cli.rec.prompts[0].includes('只判定不修改'));
    check('A2 角色节在任务描述之前（先立规矩再派活）',
        a.cli.rec.prompts[0].indexOf('## 你的角色') < a.cli.rec.prompts[0].indexOf('## 任务描述'));
    check('A3 会话标题带角色标识（多角色会话可在归档里区分）',
        a.cli.rec.titles[0].includes('|role=reviewer'), a.cli.rec.titles[0]);
    check('A4 运行器暴露 roleId', a.runner.roleId === 'reviewer');

    // A5：未设 rolePrompt 时 prompt 与 Phase 1 逐字一致（无角色节）
    const b = await runFlex({});
    check('A5 未设角色时不注入角色节（Phase 1 prompt 逐字不变）',
        !b.cli.rec.prompts[0].includes('## 你的角色')
        && !b.cli.rec.titles[0].includes('|role='), b.cli.rec.titles[0]);

    // A6/A7：SKILL 准入——自动匹配越权时降级无 SKILL
    const skillDir = await makeSkillDir(['acceptance-check', 'rnoh-lib-demo-create']);
    const selectorFor = (name) => ({
        selectSkill: async () => ({
            best: { name, skillPath: path.join(skillDir, name) },
            skillPath: path.join(skillDir, name)
        })
    });

    const c = await runFlex({
        skillDirectory: skillDir,
        skillSelector: selectorFor('acceptance-check'),
        skillAllowList: ['rnoh-lib-demo-create'],
        roleId: 'coder'
    });
    check('A6 自动匹配到越权 SKILL → 降级为无 SKILL 模式（绝不静默使用）',
        c.runner.usedSkillName === '' && !c.cli.rec.prompts[0].includes('## SKILL 目录'),
        `used=${c.runner.usedSkillName || '(空)'}`);

    const d = await runFlex({
        skillDirectory: skillDir,
        skillSelector: selectorFor('acceptance-check'),
        skillAllowList: ['acceptance-check'],
        roleId: 'reviewer'
    });
    check('A7 匹配到名单内 SKILL → 正常使用并记录 SKILL 名',
        d.runner.usedSkillName === 'acceptance-check'
        && d.cli.rec.prompts[0].includes('## SKILL 目录'),
        `used=${d.runner.usedSkillName}`);

    // A8：指定 SKILL 越权 → 直接拒绝，不创建会话
    const e = await runFlex({
        skillDirectory: skillDir, specifiedSkill: 'acceptance-check',
        skillAllowList: ['rnoh-lib-demo-create'], roleId: 'coder'
    });
    check('A8 指定 SKILL 越权 → 不创建会话即降级（不浪费一次会话）',
        e.runner.usedSkillName === '' && e.cli.rec.prompts.length === 1
        && !e.cli.rec.prompts[0].includes('## SKILL 目录'));

    // A9：指定 SKILL 在名单内 → 走 SKILL 模式
    const f = await runFlex({
        skillDirectory: skillDir, specifiedSkill: 'rnoh-lib-demo-create',
        skillAllowList: ['rnoh-lib-demo-create'], roleId: 'coder'
    });
    check('A9 指定 SKILL 在名单内 → 使用 SKILL 模式',
        f.runner.usedSkillName === 'rnoh-lib-demo-create'
        && f.cli.rec.prompts[0].includes('## SKILL 目录'));

    // A10/A11：初始执行序号影响产物命名（角色多次重做不互相覆盖）
    const g = await runFlex({ roleId: 'coder', initialExecuteStep: 3 });
    check('A10 产物文件名含角色后缀与指定执行序号',
        /result_3_coder\.md$/.test(g.res.resultPath), path.basename(g.res.resultPath || ''));
    check('A11 meta.json 命名同样带上角色与序号（指标可归属到具体角色尝试）',
        /meta_3_coder\.json/.test(g.cli.rec.prompts[0]),
        (g.cli.rec.prompts[0].match(/meta_\d+_\w+\.json/) || ['未找到'])[0]);

    const h = await runFlex({ initialExecuteStep: 2 });
    check('A12 无角色时命名与 Phase 1 一致（不留角色后缀）',
        /result_2\.md$/.test(h.res.resultPath), path.basename(h.res.resultPath || ''));

    // A13：历史文档收集复用同一命名规则（角色化后仍能收集到重做历史）
    await fs.writeFile(path.join(taskDir, 'stepId1_loop0_result_0_coder.md'), '## 执行状态\n\n成功\n', 'utf8');
    const i = await runFlex({ roleId: 'coder', initialExecuteStep: 1 });
    check('A13 角色化后仍能收集到同角色的历史结果文档路径（命名规则同源）',
        i.cli.rec.prompts[0].includes('历史执行文档路径')
        && i.cli.rec.prompts[0].includes('result_0_coder.md'));

    await fs.rm(taskDir, { recursive: true, force: true });
    await fs.rm(skillDir, { recursive: true, force: true });
}

// ═══ B. MultiAgentRunner 契约 ═════════════════════════════════════════
console.log('\n── B. MultiAgentRunner 运行器契约 ──');
{
    const runner = new MultiAgentRunner({ enabled: true });
    const required = ['initContext', 'executeStart', 'canRetry', 'controlExecution',
        'drainBackgroundTasks', 'getLiveMessages', 'getSessionContent',
        'setAbortSignal', 'abortInFlight'];
    check('B1 FlexRunner 契约方法齐备（Orchestrator 无需分支处理多 Agent）',
        required.every((m) => typeof runner[m] === 'function'),
        required.filter((m) => typeof runner[m] !== 'function').join(',') || 'all present');
    check('B2 声明自行管理会话并发（避免与编排层重复占用槽位）',
        runner.managesOwnConcurrency === true);
    check('B3 契约字段齐备（_runnerBrief 依赖）',
        ['taskId', 'stepId', 'bigLoopIndex', 'executeStep', 'retryTimes', 'maxRetries',
            'sessionId', 'startTime', 'endTime', 'resultPath', 'metrics']
            .every((k) => k in runner));

    let badInit = 0;
    try { await runner.initContext({ taskId: 't' }); } catch { badInit++; }
    try { await runner.initContext({ taskId: 't', stepId: 0 }); } catch { badInit++; }
    check('B4 initContext 参数校验（缺 stepId / stepId 非正数均拒绝）', badInit === 2);

    // 端到端：mock 适配器 + 单阶段计划
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-mar-'));
    const r2 = new MultiAgentRunner({
        enabled: true,
        plan: 'single',
        runnerFactory: async () => ({
            sessionId: 'sess-mock',
            usedSkillName: '',
            async initContext() {},
            async executeStart() {
                await fs.writeFile(path.join(taskDir, 'artifact.md'), '## 执行状态\n\n成功\n', 'utf8');
                return { success: true, resultPath: path.join(taskDir, 'artifact.md'), metrics: { artifacts: ['artifact.md'] } };
            },
            async controlExecution() { return true; },
            async drainBackgroundTasks() { return { drained: true }; }
        })
    });
    await r2.initContext({
        taskId: 'marTask', stepId: 1, taskDir, taskDescription: 'x',
        nextStepId: 9, failStepId: 7, maxRetries: 2
    });
    const out = await r2.executeStart();
    check('B5 executeStart 返回 FlexRunner 同构结构',
        typeof out.resultPath === 'string' && typeof out.success === 'boolean'
        && out.nextStepId === 9 && !!out.metrics, JSON.stringify(out));
    check('B6 成功走 nextStepId', out.nextStepId === 9);
    check('B7 executeStep/retryTimes 递增（进度展示正确）',
        r2.executeStep === 1 && r2.retryTimes === 1);
    check('B8 协作摘要可读（计划/角色数/失败归因）',
        r2.getCollaborationSummary()?.planId === 'single'
        && r2.getCollaborationSummary()?.plan?.id === 'single'
        && r2.getCollaborationSummary()?.roleRuns === 1,
        JSON.stringify({ planId: r2.getCollaborationSummary()?.planId, plan: r2.getCollaborationSummary()?.plan?.id }));
    check('B9 协作回放日志可读（供前端拓扑图）',
        Array.isArray(r2.getReplayLog()) && r2.getReplayLog().length > 0);

    // 失败路径：nextStepId 取 failStepId
    const r3 = new MultiAgentRunner({
        enabled: true, plan: 'single',
        runnerFactory: async () => ({
            sessionId: 's', usedSkillName: '',
            async initContext() {},
            async executeStart() { return { success: false, resultPath: '', metrics: null }; },
            async controlExecution() { return true; },
            async drainBackgroundTasks() { return { drained: true }; }
        })
    });
    await r3.initContext({ taskId: 't2', stepId: 2, taskDir, taskDescription: 'x', failStepId: 5, maxRetries: 1 });
    const out3 = await r3.executeStart();
    check('B10 失败走 failStepId（成功/失败链语义与 Phase 1 一致）',
        out3.success === false && out3.nextStepId === 5);

    // abort 语义
    const r4 = new MultiAgentRunner({ enabled: true, plan: 'single' });
    await r4.initContext({ taskId: 't3', stepId: 3, taskDir, taskDescription: 'x', maxRetries: 3 });
    await r4.controlExecution('abort');
    check('B11 abort 后 canRetry=false 且 executeStart 拒绝启动',
        r4.canRetry() === false
        && await r4.executeStart().then(() => false, () => true));

    check('B12 默认（未启用）时 enabled=false，避免误开', new MultiAgentRunner().enabled === false);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ C. Orchestrator 分派与并发声明 ═══════════════════════════════════
console.log('\n── C. Orchestrator 分派与并发声明 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-orch-'));

    async function runOrch({ steps, deps = {}, expectFlex = false }) {
        const calls = { flex: 0, multi: 0, acquire: 0, released: 0 };
        const sem = new Semaphore({ limit: 4, perTaskLimit: 0 });
        const origAcquire = sem.acquire.bind(sem);
        sem.acquire = async (opts) => { calls.acquire++; return origAcquire(opts); };

        const mkRunner = (impl) => ({
            managesOwnConcurrency: impl,
            taskId: 'x', stepId: 1, bigLoopIndex: 0, executeStep: 0, retryTimes: 1,
            maxRetries: 1, sessionId: 's', startTime: null, endTime: null,
            resultPath: '', metrics: null,
            canRetry: () => false,
            async initContext() {},
            async executeStart() { return { success: true, resultPath: '', nextStepId: 0, metrics: null }; },
            async controlExecution() {},
            async drainBackgroundTasks() { return { drained: true }; }
        });

        const orch = new Orchestrator({
            storage: storageStub(),
            sessionSemaphore: sem,
            ...deps,
            flexRunnerFactory: deps.flexRunnerFactory || (async () => { calls.flex++; return mkRunner(false); }),
            multiAgentRunnerFactory: deps.multiAgentRunnerFactory
                || (async () => { calls.multi++; return mkRunner(true); })
        });
        await orch.loadTask({ taskId: 'dTask', taskDir, steps });
        await orch.start();
        return { orch, calls };
    }

    // C1：默认关闭 → 一律单角色
    const c1 = await runOrch({ steps: [{ stepId: 1, taskDescription: 'x', nextStepId: 0, maxRetries: 1 }] });
    check('C1 默认（未启用）走单角色路径', c1.calls.flex === 1 && c1.calls.multi === 0,
        `flex=${c1.calls.flex} multi=${c1.calls.multi}`);
    check('C2 单角色路径照常预占编排层槽位', c1.calls.acquire === 1, `acquire=${c1.calls.acquire}`);

    // C3：全局启用 → 走多 Agent
    const c3 = await runOrch({
        steps: [{ stepId: 1, taskDescription: 'x', nextStepId: 0, maxRetries: 1 }],
        deps: { multiAgentEnabled: true }
    });
    check('C3 全局启用后走多 Agent 路径', c3.calls.multi === 1 && c3.calls.flex === 0,
        `flex=${c3.calls.flex} multi=${c3.calls.multi}`);
    check('C4 多 Agent 步骤**不**预占编排层槽位（由各角色会话自行取）',
        c3.calls.acquire === 0, `acquire=${c3.calls.acquire}`);

    // C5：步骤级关闭优先于全局启用
    const c5 = await runOrch({
        steps: [{ stepId: 1, taskDescription: 'x', nextStepId: 0, maxRetries: 1, multiAgent: false }],
        deps: { multiAgentEnabled: true }
    });
    check('C5 步骤级 multiAgent=false 覆盖全局启用（贵的步骤可以单独退回单角色）',
        c5.calls.flex === 1 && c5.calls.multi === 0,
        `flex=${c5.calls.flex} multi=${c5.calls.multi}`);

    // C6：步骤级开启在全局关闭时也生效
    const c6 = await runOrch({
        steps: [{ stepId: 1, taskDescription: 'x', nextStepId: 0, maxRetries: 1, multiAgent: true }]
    });
    check('C6 步骤级 multiAgent=true 在全局关闭时亦生效',
        c6.calls.multi === 1 && c6.calls.flex === 0,
        `flex=${c6.calls.flex} multi=${c6.calls.multi}`);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ D. 并发不变式 ════════════════════════════════════════════════════
console.log('\n── D. 并发不变式：多角色步骤不突破全局会话上限 ──');
{
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-conc-'));
    const LIMIT = 3;
    const STEPS = 4;
    const STAGES = 5;                    // thorough 计划的阶段数
    const SESSION_MS = 25;

    const sem = new Semaphore({ limit: LIMIT, perTaskLimit: 0 });
    const origAcquire = sem.acquire.bind(sem);
    let maxActive = 0;
    let totalSessions = 0;
    let inflight = 0;
    let maxInflight = 0;
    sem.acquire = async (opts) => {
        const lease = await origAcquire(opts);
        if (lease.ok) maxActive = Math.max(maxActive, sem.active);
        return lease;
    };

    // 每个角色会话记一次"在途"计数。
    // 注意：**不**在这里自行取信号量——真实路径是 AgentRuntime 在调用
    // executeStart 前后取/放槽位；若 mock 再取一次就变成嵌套获取，
    // 会把"并发是否受限"测成"并发是否死锁"（第一次写这个用例时正是如此）。
    const adapterFactory = async () => ({
        sessionId: `s-${++totalSessions}`,
        usedSkillName: '',
        async initContext(p) { this._p = p; },
        async executeStart() {
            inflight++;
            maxInflight = Math.max(maxInflight, inflight);
            try {
                await new Promise((r) => setTimeout(r, SESSION_MS));
                const p = this._p;
                const file = path.join(p.taskDir, `r_${p.roleId}_${p.initialExecuteStep}.md`);
                await fs.writeFile(file, '## 执行状态\n\n成功\n', 'utf8');
                // 让评审者/验证者拿到可解析结论
                const metrics = p.roleId === 'reviewer' ? { approved: true, reasons: [] }
                    : p.roleId === 'verifier' ? { verdict: '通过', evidence: ['ok'] }
                        : { artifacts: [path.basename(file)] };
                await fs.writeFile(
                    path.join(p.taskDir, `m_${p.roleId}_${p.initialExecuteStep}.json`),
                    JSON.stringify(metrics), 'utf8');
                return { success: true, resultPath: file, metrics };
            } finally {
                inflight--;
            }
        },
        async controlExecution() { return true; },
        async drainBackgroundTasks() { return { drained: true }; }
    });

    const orch = new Orchestrator({
        storage: storageStub(),
        sessionSemaphore: sem,
        multiAgentEnabled: true,
        multiAgentRunnerFactory: async () => new MultiAgentRunner({
            enabled: true,
            plan: getBuiltinPlan('thorough'),
            sessionSemaphore: sem,
            runnerFactory: adapterFactory
        })
    });

    await orch.loadTask({
        taskId: 'concTask',
        taskDir,
        steps: Array.from({ length: STEPS }, (_, i) => ({
            stepId: i + 1,
            taskDescription: `任务 ${i + 1}`,
            dependId: 0,            // 全部无依赖 → 并行
            nextStepId: 0,
            maxRetries: 1
        }))
    });
    const t0 = Date.now();
    await orch.start();
    const elapsed = Date.now() - t0;
    const progress = orch.getProgress();

    const expectedSessions = STEPS * STAGES;
    check(`D1 全部 ${expectedSessions} 个角色会话都真实创建（4 步 × 5 角色）`,
        totalSessions === expectedSessions, `sessions=${totalSessions}`);
    check(`D2 会话并发**从未**突破全局上限 ${LIMIT}`,
        maxInflight <= LIMIT, `maxInflight=${maxInflight}`);
    check('D3 并发被真正利用（不是串行退化成 1）',
        maxInflight >= 2, `maxInflight=${maxInflight} 耗时=${elapsed}ms`);
    check('D4 编排成功完成', progress.status === 'completed', progress.status);
    check('D5 所有步骤完成',
        Object.values(progress.steps || {}).every((s) => s.status === 'completed'),
        JSON.stringify(Object.fromEntries(Object.entries(progress.steps || {}).map(([k, v]) => [k, v.status]))));

    // 反证：若每个角色会话各取一个槽位、而编排层再预占一个，可用并发会被腰斩。
    check('D6 槽位租约已全部释放（无泄漏）', sem.active === 0, `active=${sem.active}`);
    check('D7 槽位获取次数 = 会话数（既不多占也不少占）',
        sem.stats().totalAcquired === expectedSessions,
        `acquired=${sem.stats().totalAcquired} sessions=${totalSessions}`);

    await fs.rm(taskDir, { recursive: true, force: true });
}

// ═══ E. 兼容性 ════════════════════════════════════════════════════════
console.log('\n── E. 兼容性（既有能力不回归）──');
{
    // Phase 1 的 SSE 事件名一个都不能少（4 个前端面板依赖它们）
    const legacy = ['orch:task:start', 'orch:step:status', 'orch:step:detail', 'orch:task:progress',
        'orch:task:complete', 'orch:task:error', 'orch:task:aborted'];
    const missing = legacy.filter((e) => !Object.values(SSE_EVENT).includes(e));
    check('E1 Phase 1 的 7 个 SSE 事件名全部保留（面板不会静默失效）',
        missing.length === 0, missing.join(',') || 'all present');
    check('E2 新增的协作事件独立命名，不与既有事件冲突',
        Object.values(SSE_EVENT).length === new Set(Object.values(SSE_EVENT)).size);

    // 4 个前端面板：`Web/public/index.html` 是单页外壳，四个面板是其中的脚本模块
    // （arkts/rn/flutter/codecheck 各自有 js + css，没有独立 html）。
    const panels = ['arktslibrarycheck', 'rnlibrarycheck', 'flutterlibrarycheck', 'codecheck'];
    const missingFiles = [];
    for (const p of panels) {
        for (const rel of [`js/${p}.js`, `css/${p}.css`]) {
            try {
                await fs.access(path.join(ROOT, 'Web', 'public', rel));
            } catch { missingFiles.push(rel); }
        }
    }
    check('E3 4 个前端面板的 js/css 资源齐备（arkts/rn/flutter/codecheck）',
        missingFiles.length === 0, missingFiles.join(',') || 'all present');

    const shell = await fs.readFile(path.join(ROOT, 'Web', 'public', 'index.html'), 'utf8');
    const missingScripts = panels
        .map((p) => `js/${p}.js`)
        .filter((s) => !shell.includes(s));
    check('E4 单页外壳仍挂载全部 4 个面板脚本（面板不会静默消失）',
        missingScripts.length === 0, missingScripts.join(',') || 'all mounted');

    const loopJs = await fs.readFile(path.join(ROOT, 'Web', 'public', 'js', 'loop.js'), 'utf8');
    const usedEvents = ['orch:step:status', 'orch:task:complete', 'orch:task:error', 'orch:task:aborted'];
    const deadEvents = usedEvents.filter((e) => !loopJs.includes(e));
    check('E5 步骤图前端使用的事件名仍然有效（不会静默收不到事件）',
        deadEvents.length === 0 && loopJs.includes('EventSource'),
        deadEvents.join(',') || `checked ${usedEvents.length} events`);
}

// ═══ F. 协作快照与前端数据源 ══════════════════════════════════════════
console.log('\n── F. 协作快照与前端数据源（步骤结束后仍可查）──');
{
    const { createOrchestratorRouter } = await imp('Server/Routes/routes/orchestrator.js');
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-snap-'));
    const sem = new Semaphore({ limit: 5, perTaskLimit: 0 });

    const adapterFactory = async () => ({
        sessionId: `s-${Math.random().toString(36).slice(2, 8)}`,
        usedSkillName: 'rnoh-lib-demo-create',
        async initContext(p) { this._p = p; },
        async executeStart() {
            const p = this._p;
            await new Promise((r) => setTimeout(r, 5));
            const file = path.join(p.taskDir, `r_${p.roleId}_${p.initialExecuteStep}.md`);
            await fs.writeFile(file, '## 执行状态\n\n成功\n', 'utf8');
            const metrics = p.roleId === 'reviewer' ? { approved: true, reasons: [] }
                : p.roleId === 'verifier' ? { verdict: '通过', evidence: ['cmd → ok'] }
                    : { artifacts: [path.basename(file)] };
            return { success: true, resultPath: file, metrics };
        },
        async controlExecution() { return true; },
        async drainBackgroundTasks() { return { drained: true }; }
    });

    const orch = new Orchestrator({
        storage: storageStub(),
        sessionSemaphore: sem,
        multiAgentEnabled: true,
        multiAgentRunnerFactory: async () => new MultiAgentRunner({
            enabled: true, plan: 'standard', sessionSemaphore: sem, runnerFactory: adapterFactory
        })
    });
    await orch.loadTask({
        taskId: 'snapTask', taskDir,
        steps: [
            { stepId: 1, taskDescription: '甲', nextStepId: 2, maxRetries: 1 },
            { stepId: 2, taskDescription: '乙', dependId: 1, nextStepId: 0, maxRetries: 1, multiAgent: false }
        ]
    });
    await orch.start();

    // 关键：编排结束后，上层（OrchestratorController）会 dispose 各节点的 runner。
    orch.dispose();

    const topo = orch.getAgentTopology(1);
    check('F1 步骤结束后协作拓扑仍可查（已快照到节点，不受 runner 回收影响）',
        topo.available === true && !!topo.plan && Array.isArray(topo.stageRuns),
        `plan=${topo.plan?.id} stageRuns=${topo.stageRuns?.length}`);
    check('F2 拓扑含计划阶段与角色（前端可直接渲染角色子图）',
        (topo.plan?.stages || []).length === 2
        && topo.plan.stages.map((s) => s.role).join(',') === 'coder,reviewer',
        (topo.plan?.stages || []).map((s) => s.id + ':' + s.role).join(' '));
    check('F3 拓扑含消息边（corder→reviewer 的评审请求 + 驳回边）',
        !!topo.topology && topo.topology.edges.some((e) => e.to === 'reviewer'),
        JSON.stringify((topo.topology?.edges || []).map((e) => `${e.from}>${e.to}`)));
    check('F4 单角色步骤明确返回"未启用协作"（前端据此显示引导文案）',
        orch.getAgentTopology(2).available === false
        && /多 Agent/.test(orch.getAgentTopology(2).reason || ''));
    check('F5 不存在的步骤返回可归因结果而非抛错',
        orch.getAgentTopology(99).available === false);

    const stats = orch.getMultiAgentStats();
    check('F6 跨步骤协作统计可查（角色会话数 / 修订数 / 失败归因）',
        stats.steps === 1 && stats.roleRuns >= 2 && typeof stats.failures === 'object',
        JSON.stringify({ steps: stats.steps, roleRuns: stats.roleRuns, failures: stats.failures }));

    // 路由注册：前端调用的 /api/orchestrator/agent-topology 确实存在
    const router = createOrchestratorRouter({ storage: storageStub() });
    const routes = (router.routes || []).map((r) => `${r.method} ${r.path}`);
    check('F7 协作拓扑 HTTP 端点已注册（前端调用路径有效）',
        routes.includes('GET /agent-topology'), routes.join(' | '));

    await fs.rm(taskDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
process.exit(failed.length === 0 ? 0 : 1);
