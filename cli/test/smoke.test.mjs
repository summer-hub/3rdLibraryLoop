/**
 * smoke.test.mjs —— 最小冒烟测试
 *
 * 验证 CLI 核心入口可正常加载、命令分发正常、版本/帮助/workflows 不报错。
 * 不依赖 opencode serve 或 LLM 凭据（纯同步路径）。
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', '3rdloop.mjs');

/** 运行 CLI 命令，返回 { stdout, stderr, exitCode }。 */
function runCli(args = [], env = {}) {
    try {
        const stdout = execFileSync(process.execPath, [BIN, ...args], {
            encoding: 'utf-8',
            timeout: 10000,
            env: { ...process.env, ...env },
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

// ── config（隔离 3LIB_HOME，避免污染真实 ~/.3lib/.env）───────────

const CfgHome = fs.mkdtempSync(path.join(tmpdir(), '3rdloop-cfg-'));
const cfgEnv = { '3LIB_HOME': CfgHome };
// 关键：必须移除可能存在的系统级 3LIB_DATA_DIR，确保测试基于临时 HOME 判定
delete process.env['3LIB_DATA_DIR'];
const cfgEnvNoDataDir = { ...cfgEnv };

// 1. config list 应显示默认值（3LIB_DATA_DIR → ~/.3lib/3rdloop/db，注意是绝对路径）
const cfgList = runCli(['config', 'list'], cfgEnvNoDataDir);
assert.equal(cfgList.exitCode, 0, `config list 应退出码 0，实际 ${cfgList.exitCode}`);
assert.match(cfgList.stdout, /3LIB_DATA_DIR/, 'config list 应含 3LIB_DATA_DIR');
assert.match(cfgList.stdout, /3rdloop/, '3LIB_DATA_DIR 行应含 3rdloop');

// 2. config get 3LIB_DATA_DIR（隔离 HOME 下应为默认值）
const cfgGetDef = runCli(['config', 'get', '3LIB_DATA_DIR'], cfgEnvNoDataDir);
assert.equal(cfgGetDef.exitCode, 0);
assert.match(cfgGetDef.stdout, /\.3lib[/\\]3rdloop[/\\]db/, '默认数据目录应为 ~/.3lib/3rdloop/db');

// 3. config set 3LIB_DATA_DIR → 写入临时 HOME
const cfgSet = runCli(['config', 'set', '3LIB_DATA_DIR', path.join(CfgHome, 'custom-db')], cfgEnvNoDataDir);
assert.equal(cfgSet.exitCode, 0, `config set 应退出码 0，实际 ${cfgSet.exitCode}`);
assert.match(cfgSet.stdout, /已设置/, 'set 成功后应提示已设置');

// 4. 写完后 .env 文件存在且含目标键
const envFile = path.join(CfgHome, '.env');
assert.ok(fs.existsSync(envFile), '~/.3lib/.env 应已创建');
assert.match(fs.readFileSync(envFile, 'utf8'), /3LIB_DATA_DIR=.*custom-db/, '.env 应含 3LIB_DATA_DIR 且为设定值');

// 5. 再次 get 应返回自定义值（user-env 来源）
const cfgGetCustom = runCli(['config', 'get', '3LIB_DATA_DIR'], cfgEnvNoDataDir);
assert.equal(cfgGetCustom.exitCode, 0);
assert.match(cfgGetCustom.stdout, /custom-db/, 'set 后 get 应返回自定义路径');

// 6. 未知键 set → 退出码 1
const cfgUnknown = runCli(['config', 'set', 'UNKNOWN_KEY', 'x'], cfgEnvNoDataDir);
assert.equal(cfgUnknown.exitCode, 1, `未知键应退出码 1，实际 ${cfgUnknown.exitCode}`);
assert.match(cfgUnknown.stderr, /未知配置项/, '未知键应提示未知配置项');

// 7. 密钥脱敏（get DASHSCOPE_API_KEY 不应输出完整明文；此处隔离 HOME 下 get 返回默认空，改用立即 set 后验证）
const cfgSetSecret = runCli(['config', 'set', 'GIT_TOKEN', 'aaaaaaaaaaaaaaaaaaaa'], cfgEnvNoDataDir);
assert.equal(cfgSetSecret.exitCode, 0);
assert.match(cfgSetSecret.stdout, /密钥不回显/, 'secret set 不应回显明文');
const cfgGetSecret = runCli(['config', 'get', 'GIT_TOKEN'], cfgEnvNoDataDir);
assert.match(cfgGetSecret.stdout, /[a-z]{6}…/, 'secret get 应脱敏');

// 8. unset → 恢复默认（用户 .env 中删除该键）
const cfgUnset = runCli(['config', 'unset', '3LIB_DATA_DIR'], cfgEnvNoDataDir);
assert.equal(cfgUnset.exitCode, 0, `config unset 应退出码 0，实际 ${cfgUnset.exitCode}`);
assert.match(cfgUnset.stdout, /已删除/, 'unset 后应提示已删除');
const cfgGetAfterUnset = runCli(['config', 'get', '3LIB_DATA_DIR'], cfgEnvNoDataDir);
assert.match(cfgGetAfterUnset.stdout, /\.3lib[/\\]3rdloop[/\\]db/, 'unset 后应恢复默认值');

// 9. config --json 结构化输出
const cfgJson = runCli(['config', 'list', '--json'], cfgEnvNoDataDir);
assert.equal(cfgJson.exitCode, 0);
const cfgParsed = JSON.parse(cfgJson.stdout);
assert.equal(cfgParsed.ok, true);
assert.ok(Array.isArray(cfgParsed.items), 'JSON list 应为数组');
assert.ok(cfgParsed.items.some(i => i.key === '3LIB_DATA_DIR'), 'JSON 应含 3LIB_DATA_DIR');

// 清理隔离 HOME（临时资产）
fs.rmSync(CfgHome, { recursive: true, force: true });

console.log('smoke tests: all passed');
