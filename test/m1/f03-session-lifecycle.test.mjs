/**
 * M1 验收：F-03 会话生命周期回收（Server/FlexRunner/FlexRunner.js）
 *
 * 场景（全程 mock CLI，不依赖真实 opencode / LLM）：
 *   A 失败路径    → abort + 归档 + 删除
 *   B 成功路径    → 总结后收尾，删除恰好 1 次，不 abort 正常结束的会话
 *   C 归档失败    → 仍 abort，但跳过删除（保全对话记录）
 *   D keepSessions → abort 但保留远端会话
 *   E 终止路径    → skipped、abort 不重复、会话已回收
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { FlexRunner } = await import(pathToFileURL(`${ROOT}Server/FlexRunner/FlexRunner.js`).href);

function makeCli({ archiveFails = false, runStatus = 'completed' } = {}) {
    const calls = { startSession: 0, abortSession: [], deleteSession: [], getSessionMessages: [] };
    return {
        calls,
        getType: () => 'mock',
        checkHealth: async () => ({ status: 'ok' }),
        startSession: async () => { calls.startSession++; return { sessionId: 'sess-1' }; },
        checkSessionStatus: async () => ({ status: runStatus }),
        abortSession: async (id) => { calls.abortSession.push(id); },
        deleteSession: async (id) => { calls.deleteSession.push(id); },
        getSessionMessages: async (id) => {
            calls.getSessionMessages.push(id);
            if (archiveFails) throw new Error('mock 归档失败');
            return [];
        },
        sendAndWaitMessage: async () => ({ success: true }),
    };
}

const storageStub = {
    manager: { rootDir: os.tmpdir() },
    taskExecStore: () => ({ patchStep: async () => {} }),
};
const knowledgeStub = {
    init: async () => {},
    findByDocPath: async () => null,
    addExperience: async () => ({ id: 'kn_test' }),
};
// initContext 无条件构造 SkillSelector（其 Agent.js 顶层会 await loadServerEnv()
// 加载 Server/.env，dotenv 是可选依赖），必须注入 stub 才能在未装依赖时做纯 mock 测试。
const selectorStub = { match: async () => null, select: async () => null };

async function makeTaskDir(stepId, { resultStatus }) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'f03-'));
    if (resultStatus) {
        await fs.writeFile(
            path.join(dir, `stepId${stepId}_loop0_result_0.md`),
            `# 报告\n\n## 执行状态\n\n${resultStatus}\n`,
            'utf8'
        );
    }
    // 预置经验总结文件，使 _waitForFile 立即通过
    await fs.writeFile(
        path.join(dir, `stepId${stepId}_loop0_Summary_0.md`),
        '# 经验总结\n- 无\n',
        'utf8'
    );
    return dir;
}

async function run({ resultStatus, archiveFails, keepSessions, runStatus, abortDuringRun, stepId }) {
    const cli = makeCli({ archiveFails, runStatus });
    const taskDir = await makeTaskDir(stepId, { resultStatus });
    const runner = new FlexRunner();
    await runner.initContext({
        taskId: 'f03task', stepId, taskDir,
        skillDirectory: '', specifiedSkill: 'ignored-skill',
        taskDescription: 'F-03 会话回收测试',
        cli, storage: storageStub, knowledgeManager: knowledgeStub, skillSelector: selectorStub,
        pollIntervalMs: 1,
        keepSessions,
    });

    let abortTimer = null;
    if (abortDuringRun) {
        abortTimer = setTimeout(() => { runner.controlExecution('abort').catch(() => {}); }, 30);
    }
    const res = await runner.executeStart();
    if (abortTimer) clearTimeout(abortTimer);

    // 成功路径的经验总结是 fire-and-forget，等它跑完（含 finally 收尾）
    await runner.drainBackgroundTasks(3000).catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
    await fs.rm(taskDir, { recursive: true, force: true });
    return { res, calls: cli.calls };
}

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// ── A. 失败路径 ──
{
    const { res, calls } = await run({ resultStatus: '失败', stepId: 1 });
    check('A 失败路径：步骤结果为失败', res.success === false);
    check('A 失败路径：已 abort 远端会话', calls.abortSession.includes('sess-1'), `abort=${JSON.stringify(calls.abortSession)}`);
    check('A 失败路径：删除前已归档', calls.getSessionMessages.includes('sess-1'));
    check('A 失败路径：已删除远端会话', calls.deleteSession.includes('sess-1'), `delete=${JSON.stringify(calls.deleteSession)}`);
}

// ── B. 成功路径 ──
{
    const { res, calls } = await run({ resultStatus: '成功', stepId: 2 });
    check('B 成功路径：步骤结果为成功', res.success === true);
    check('B 成功路径：删除恰好一次（无双重收尾）', calls.deleteSession.length === 1, `delete=${calls.deleteSession.length}`);
    check('B 成功路径：不 abort 正常结束的会话', calls.abortSession.length === 0, `abort=${calls.abortSession.length}`);
    check('B 成功路径：删除前已归档', calls.getSessionMessages.length === 1);
}

// ── C. 归档失败 → 保全记录，不删除 ──
{
    const { calls } = await run({ resultStatus: '失败', archiveFails: true, stepId: 3 });
    check('C 归档失败：仍 abort 远端会话', calls.abortSession.includes('sess-1'));
    check('C 归档失败：跳过删除以保全对话记录', calls.deleteSession.length === 0, `delete=${JSON.stringify(calls.deleteSession)}`);
}

// ── D. keepSessions ──
{
    const { calls } = await run({ resultStatus: '失败', keepSessions: true, stepId: 4 });
    check('D keepSessions：仍 abort 但不删除',
        calls.abortSession.includes('sess-1') && calls.deleteSession.length === 0,
        `abort=${calls.abortSession.length} delete=${calls.deleteSession.length}`);
}

// ── E. 终止路径 ──
{
    const { res, calls } = await run({ runStatus: 'running', abortDuringRun: true, stepId: 5 });
    check('E 终止路径：步骤未成功', res.success === false);
    check('E 终止路径：abort 未被重复调用', calls.abortSession.length === 1, `abort=${calls.abortSession.length}`);
    check('E 终止路径：远端会话已回收', calls.deleteSession.includes('sess-1'), `delete=${JSON.stringify(calls.deleteSession)}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
