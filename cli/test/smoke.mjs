/**
 * smoke.mjs —— CLI 冒烟测试（npm test）
 *
 * 目标：快速自检 CLI 关键能力，不依赖外部服务（opencode/LLM）。
 * 覆盖：
 *   - 入口脚本可加载（bin/loop.mjs）
 *   - --help / version / doctor 不乱码、正常退出
 *   - progress/list/result 磁盘直读（写临时 loop.json 后验证）
 *   - exit-codes 映射完整性
 *
 * 注意：本测试不启动真实引擎（需要 opencode+LLM），
 * 仅验证命令表层与数据读取层（A/B 测试隔离）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '..');
const BIN = path.join(CLI_ROOT, 'bin', 'loop.mjs');
const NODE = process.execPath;

/** 运行 CLI 命令，返回 { code, stdout, stderr }。 */
function runCli(args, opts = {}) {
    return new Promise((resolve) => {
        const child = spawn(NODE, [BIN, ...args], {
            cwd: opts.cwd || CLI_ROOT,
            env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.on('error', (err) => resolve({ code: -1, stdout, stderr, error: err.message }));
    });
}

/** 创建一次性临时数据目录。 */
function tmpDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'loop-cli-smoke-'));
}

test('入口脚本存在且可执行', () => {
    assert.ok(fs.existsSync(BIN), `bin/loop.mjs 缺失: ${BIN}`);
    const content = fs.readFileSync(BIN, 'utf8');
    assert.ok(content.includes('#!/usr/bin/env node'), '缺少 node shebang');
});

test('--help 正常输出并退出 0', async () => {
    const { code, stdout } = await runCli(['--help']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('loop run'), '帮助应包含 run 用法');
    assert.ok(stdout.includes('退出码'), '帮助应包含退出码表');
});

test('version 输出版本号', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
    const { code, stdout } = await runCli(['version']);
    assert.equal(code, 0);
    assert.match(stdout, new RegExp(`v${pkg.version.replace(/\./g, '\\.')}`));
});

test('doctor 输出 5 项检查并退出', async () => {
    const { code, stdout } = await runCli(['doctor', '--skill-dir', path.join(CLI_ROOT, '..', 'Server', 'Skills')]);
    // doctor 至少不崩溃；stdout 无要求（日志走 stderr）
    assert.ok(code === 0 || code === 1);
});

// ─── 磁盘直读层（不启动引擎）──────────────────────────────────────────────

test('queries：写入 loop.json 后可 progress/list/result', async () => {
    const dataDir = tmpDataDir();
    const taskId = 'task_smoketest01';
    const taskPath = path.join(dataDir, 'task', taskId);
    fs.mkdirSync(taskPath, { recursive: true });

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const fakeState = {
        taskId,
        taskDescription: 'smoke 假任务',
        currentLoop: 1,
        maxLoops: 3,
        status: 'passed',
        startTime: now,
        endTime: now,
        taskDir: taskPath,
        rounds: [
            { loop: 0, passed: true, orchestratorStatus: 'completed', checkPassed: true, checkSummary: 'smoke 通过' },
        ],
    };
    fs.writeFileSync(path.join(taskPath, 'loop.json'), JSON.stringify(fakeState, null, 2), 'utf8');

    try {
        // progress --json
        const p = await runCli(['progress', taskId, '--data-dir', dataDir, '--json']);
        assert.equal(p.code, 0);
        const pState = JSON.parse(p.stdout);
        assert.equal(pState.taskId, taskId);
        assert.equal(pState.status, 'passed');

        // list --json
        const l = await runCli(['list', '--data-dir', dataDir, '--json']);
        assert.equal(l.code, 0);
        const list = JSON.parse(l.stdout);
        assert.ok(Array.isArray(list.tasks));
        assert.equal(list.tasks.length, 1);
        assert.equal(list.tasks[0].passed, true);

        // result --json
        const r = await runCli(['result', taskId, '--data-dir', dataDir, '--json']);
        assert.equal(r.code, 0);
        const result = JSON.parse(r.stdout);
        assert.equal(result.passed, true);
        assert.ok(Array.isArray(result.rounds));
        assert.equal(result.rounds[0].checkSummary, 'smoke 通过');

        // result 文本模式（非 json，stdout 应有任务行）
        const rt = await runCli(['result', taskId, '--data-dir', dataDir]);
        assert.equal(rt.code, 0);
        assert.ok(rt.stdout.includes('任务:'));
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('queries：任务不存在时返回错误退出码', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stdout } = await runCli(['progress', 'task_myvzzzzzzz', '--data-dir', dataDir, '--json']);
        assert.equal(code, 1);
        const obj = JSON.parse(stdout);
        assert.equal(obj.ok, false);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('abort 不存在的任务在 json 模式下错误退出', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stdout } = await runCli(['abort', 'task_myvzzzzzzz', '--data-dir', dataDir, '--json']);
        // abort 用 RunnerContext 磁盘 fallback，未找到返回 false → 退出码 1
        assert.equal(code, 1);
        const obj = JSON.parse(stdout);
        assert.equal(obj.ok, false);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('exit-codes 表完整且互不冲突', async () => {
    const url = new URL(`file://${path.join(CLI_ROOT, 'lib', 'exit-codes.js').replace(/\\/g, '/')}`);
    const { EXIT } = await import(url.href);
    const values = Object.values(EXIT);
    assert.equal(new Set(values).size, values.length, '退出码存在重复');
    assert.ok(EXIT.OK === 0);
    assert.ok(EXIT.TASK_FAILED === 2);
    assert.ok(EXIT.TIMEOUT === 3);
    assert.ok(EXIT.SIGINT === 130);
});

test('stdout 纯净：--json 模式下 stdout 可被 JSON.parse', async () => {
    const dataDir = tmpDataDir();
    // 无任务时 progress --json 也必须是纯 JSON
    const { code, stdout } = await runCli(['progress', 'task_myvzzzzzzz', '--data-dir', dataDir, '--json']);
    assert.equal(code, 1);
    // stdout 无 ANSI 也无进度日志混入
    assert.doesNotThrow(() => JSON.parse(stdout));
    assert.ok(!stdout.includes('\x1b['), 'stdout 不应包含 ANSI 颜色码');
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// ─── step 单步执行：参数校验（不触发真实 LLM）─────────────────────────────

test('help 应包含 step 子命令用法', async () => {
    const { code, stdout } = await runCli(['--help']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('loop step run'), '帮助应包含 step run 用法');
    assert.ok(stdout.includes('--task-id'), '帮助应包含 --task-id');
});

test('step 缺子命令时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['step', '--data-dir', dataDir]);
        assert.equal(code, 1);
        assert.ok(stderr.includes('step run|status|result'), '应提示正确用法');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('step run 缺任务描述时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['step', 'run', '--data-dir', dataDir, '--task-id', 'task_s1']);
        assert.equal(code, 1);
        assert.ok(stderr.includes('缺少任务描述'));
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('step run 缺 --task-id 时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['step', 'run', '冒烟步骤', '--data-dir', dataDir]);
        assert.equal(code, 1);
        assert.ok(stderr.includes('--task-id'));
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('step run 非法 --step-id 时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['step', 'run', '冒烟步骤', '--data-dir', dataDir,
            '--task-id', 'task_s1', '--step-id', '0']);
        assert.equal(code, 1);
        assert.ok(stderr.includes('--step-id'));
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('step run 不存在的 --input-report 时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['step', 'run', '冒烟步骤', '--data-dir', dataDir,
            '--task-id', 'task_s1', '--input-report', path.join(dataDir, 'no-such-report.md')]);
        assert.equal(code, 1);
        assert.ok(stderr.includes('--input-report'));
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('step run 非法 --max-retries 时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['step', 'run', '冒烟步骤', '--data-dir', dataDir,
            '--task-id', 'task_s1', '--max-retries', '-1']);
        assert.equal(code, 1);
        assert.ok(stderr.includes('--max-retries'));
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

// ─── step status / result：磁盘直读 ─────────────────────────────────────────

test('step status/result 磁盘直读临时产物', async () => {
    const dataDir = tmpDataDir();
    const taskId = 'task_stepsmoke01';
    const taskPath = path.join(dataDir, 'task', taskId);
    fs.mkdirSync(taskPath, { recursive: true });

    // 模拟 FlexRunner 产物：result md + 步骤执行记录
    fs.writeFileSync(
        path.join(taskPath, 'stepId1_loop0_result_0.md'),
        '# 结果\n\n单步冒烟产物内容\n',
        'utf8'
    );
    fs.writeFileSync(
        path.join(taskPath, 'stepid_1_loop0.json'),
        JSON.stringify({
            taskId, stepId: 1, bigLoopIndex: 0,
            status: 'passed', matchedSkillDir: 'demo-code',
            sessionId: 'ses_mock', executeStep: 0,
        }, null, 2),
        'utf8'
    );

    try {
        // status --json
        const st = await runCli(['step', 'status', taskId, '--data-dir', dataDir, '--json']);
        assert.equal(st.code, 0);
        const status = JSON.parse(st.stdout);
        assert.equal(status.ok, true);
        assert.equal(status.stepId, 1);
        assert.equal(status.stepState.matchedSkillDir, 'demo-code');
        assert.equal(status.stepState.sessionId, 'ses_mock');
        assert.ok(status.resultFiles.length >= 1);

        // result --json
        const rs = await runCli(['step', 'result', taskId, '--data-dir', dataDir, '--json']);
        assert.equal(rs.code, 0);
        const result = JSON.parse(rs.stdout);
        assert.equal(result.ok, true);
        assert.ok(result.content.includes('单步冒烟产物内容'));

        // result 文本模式（stdout 输出内容）
        const rt = await runCli(['step', 'result', taskId, '--data-dir', dataDir, '--quiet']);
        assert.equal(rt.code, 0);
        assert.ok(rt.stdout.includes('单步冒烟产物内容'));
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('step result 无产物时退出 1', async () => {
    const dataDir = tmpDataDir();
    const taskId = 'task_stepsmoke02';
    const taskPath = path.join(dataDir, 'task', taskId);
    fs.mkdirSync(taskPath, { recursive: true });
    try {
        const { code, stderr } = await runCli(['step', 'result', taskId, '--data-dir', dataDir]);
        assert.equal(code, 1);
        assert.ok(stderr.includes('尚无产物'));
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

// ─── orch 编排层：help / 参数校验 / 磁盘直读 ───────────────────────────────

test('help 应包含 orch 子命令用法', async () => {
    const { code, stdout } = await runCli(['--help']);
    assert.equal(code, 0);
    assert.ok(stdout.includes('loop orch run'), '帮助应包含 orch run 用法');
    assert.ok(stdout.includes('loop orch start'), '帮助应包含 orch start 用法');
    assert.ok(stdout.includes('task-def.json'), '帮助应包含 task-def 格式说明');
});

test('orch 缺子命令时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['orch', '--data-dir', dataDir]);
        assert.equal(code, 1);
        assert.ok(stderr.includes('orch run|load|start|progress|abort|pause|resume|tasks'), '应提示正确用法');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('orch load 缺 task-def 文件时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['orch', 'load', '--data-dir', dataDir]);
        assert.equal(code, 1);
        assert.ok(stderr.includes('缺少任务定义文件'), '应提示缺少任务定义');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('orch load 不存在的 task-def 文件时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stderr } = await runCli(['orch', 'load', path.join(dataDir, 'no-such.json'), '--data-dir', dataDir]);
        assert.equal(code, 1);
        assert.ok(stderr.includes('任务定义文件不存在'), '应提示文件不存在');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('orch load 不合法 task-def（缺 steps）时退出 1', async () => {
    const dataDir = tmpDataDir();
    const defFile = path.join(dataDir, 'bad.json');
    fs.writeFileSync(defFile, JSON.stringify({ taskId: 'task_arch001' }, null, 2), 'utf8');
    try {
        const { code, stderr } = await runCli(['orch', 'load', defFile, '--data-dir', dataDir]);
        assert.equal(code, 1);
        assert.ok(stderr.includes('steps'), '应提示缺少 steps');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('orch progress 不存在任务时退出 1', async () => {
    const dataDir = tmpDataDir();
    try {
        const { code, stdout } = await runCli(['orch', 'progress', 'task_myvzzzzzzz', '--data-dir', dataDir, '--json']);
        assert.equal(code, 1);
        const obj = JSON.parse(stdout);
        assert.equal(obj.ok, false);
        assert.ok(obj.error.includes('不存在'), '应提示编排任务不存在');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('orch progress/tasks：磁盘直读 orchestration.json', async () => {
    const dataDir = tmpDataDir();
    const taskId = 'task_archsmoke01';
    const taskPath = path.join(dataDir, 'task', taskId);
    fs.mkdirSync(taskPath, { recursive: true });

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const fakeOrch = {
        taskId,
        taskDir: taskPath,
        loopCount: 0,
        status: 'completed',
        startTime: now,
        endTime: now,
        error: null,
        stats: { total: 2, completed: 2, failed: 0, pending: 0, ready: 0, running: 0 },
        steps: [
            { stepId: 1, taskDescription: '分析接口', status: 'completed', resultPath: path.join(taskPath, 'stepId1_loop0_result_0.md'), dependId: 0, nextStepId: '2', failStepId: '0', maxRetries: 3, retryCount: 1, history: [] },
            { stepId: 2, taskDescription: '生成 demo', status: 'completed', resultPath: path.join(taskPath, 'stepId2_loop0_result_0.md'), dependId: 1, nextStepId: '0', failStepId: '0', maxRetries: 3, retryCount: 1, history: [] },
        ],
    };
    fs.writeFileSync(path.join(taskPath, 'orchestration.json'), JSON.stringify(fakeOrch, null, 2), 'utf8');

    try {
        // progress --json
        const p = await runCli(['orch', 'progress', taskId, '--data-dir', dataDir, '--json']);
        assert.equal(p.code, 0);
        const pState = JSON.parse(p.stdout);
        assert.equal(pState.ok, true);
        assert.equal(pState.taskId, taskId);
        assert.equal(pState.status, 'completed');
        assert.equal(pState.progress.stats.completed, 2);

        // progress --loop 历史轮次
        const pl = await runCli(['orch', 'progress', taskId, '--data-dir', dataDir, '--loop', '0', '--json']);
        assert.equal(pl.code, 0);
        const plState = JSON.parse(pl.stdout);
        assert.equal(plState.loop, 0);

        // tasks --json
        const l = await runCli(['orch', 'tasks', '--data-dir', dataDir, '--json']);
        assert.equal(l.code, 0);
        const list = JSON.parse(l.stdout);
        assert.ok(Array.isArray(list.tasks));
        assert.equal(list.tasks.length, 1);
        assert.equal(list.tasks[0].taskId, taskId);
        assert.equal(list.tasks[0].stepCount, 2);
        assert.equal(list.tasks[0].stepCompleted, 2);

        // tasks 文本模式
        const lt = await runCli(['orch', 'tasks', '--data-dir', dataDir]);
        assert.equal(lt.code, 0);
        assert.ok(lt.stdout.includes(taskId), '文本模式应列出任务 ID');
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});