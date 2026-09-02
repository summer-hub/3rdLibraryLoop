/**
 * smoke.test.mjs —— 最小冒烟测试
 *
 * 验证 CLI 核心入口可正常加载、命令分发正常、版本/帮助/workflows 不报错。
 * 不依赖 opencode serve 或 LLM 凭据（纯同步路径）。
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', '3rdloop.mjs');

/** 运行 CLI 命令，返回 { stdout, stderr, exitCode }。 */
function runCli(args = []) {
    try {
        const stdout = execFileSync(process.execPath, [BIN, ...args], {
            encoding: 'utf-8',
            timeout: 10000,
        });
        return { stdout, stderr: '', exitCode: 0 };
    } catch (err) {
        return {
            stdout: err.stdout?.toString() || '',
            stderr: err.stderr?.toString() || '',
            exitCode: err.status ?? 1,
        };
    }
}

// ── version ──────────────────────────────────────────────────────

const ver = runCli(['version']);
assert.equal(ver.exitCode, 0, `version 应退出码 0，实际 ${ver.exitCode}`);
assert.match(ver.stdout, /@ohos-cpf\/3rdloop v0\.0\.1/, 'version 输出应含包名和版本号');

const verJson = runCli(['version', '--json']);
assert.equal(verJson.exitCode, 0);
const parsed = JSON.parse(verJson.stdout);
assert.equal(parsed.name, '@ohos-cpf/3rdloop');
assert.equal(parsed.version, '0.0.1');

// ── --help ────────────────────────────────────────────────────────

const help = runCli(['--help']);
assert.equal(help.exitCode, 0, `--help 应退出码 0，实际 ${help.exitCode}`);
assert.match(help.stdout, /3rdloop run/, '帮助文本应含 3rdloop run 命令');
assert.match(help.stdout, /3rdloop workflows/, '帮助文本应含 3rdloop workflows 命令');

// ── workflows ────────────────────────────────────────────────────

const wf = runCli(['workflows']);
assert.equal(wf.exitCode, 0, `workflows 应退出码 0，实际 ${wf.exitCode}`);
assert.match(wf.stdout, /pr-check/, 'workflows 列表应含 pr-check');

const wfJson = runCli(['workflows', '--json']);
assert.equal(wfJson.exitCode, 0);
const wfParsed = JSON.parse(wfJson.stdout);
assert.ok(wfParsed.total >= 1, '至少应注册 1 个工作流');
assert.ok(wfParsed.workflows.some(w => w.name === 'pr-check'), '应含 pr-check 工作流');

// ── run pr-check --help（工作流参数说明）─────────────────────────

const wfHelp = runCli(['run', 'pr-check', '--help']);
assert.equal(wfHelp.exitCode, 0);
assert.match(wfHelp.stdout, /--pr-url/, 'pr-check --help 应含 --pr-url 参数');
assert.match(wfHelp.stdout, /--library-type/, 'pr-check --help 应含 --library-type 参数');

// ── run pr-check --print-taskdef（dry-run 构造 taskDef）──────────

const dry = runCli(['run', 'pr-check', '--pr-url', 'https://gitcode.com/owner/repo/pulls/123', '--print-taskdef']);
assert.equal(dry.exitCode, 0, `--print-taskdef 应退出码 0，实际 ${dry.exitCode}`);
assert.match(dry.stdout, /codecheck_owner_repo_123_/, 'dry-run 输出应含 codecheck_ 前缀的 taskId');

// ── run pr-check 缺必填参数 → 退出码 1 ──────────────────────────

const missing = runCli(['run', 'pr-check', '--print-taskdef']);
assert.equal(missing.exitCode, 1, `缺必填参数应退出码 1，实际 ${missing.exitCode}`);

// ── 未知命令 → 退出码 1 ──────────────────────────────────────────

const unknown = runCli(['nonexistent-command']);
assert.equal(unknown.exitCode, 1, `未知命令应退出码 1，实际 ${unknown.exitCode}`);

console.log('smoke tests: all passed');
