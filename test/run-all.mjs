/**
 * 顶层验收套件运行器
 *
 * 用法:
 *   npm test            # 全量：M1 + M2 + M3 + 引擎单元测试
 *   node test/run-all.mjs
 *
 * 设计说明（F-27）：
 *   - 每个里程碑套件独立进程运行，互不污染（端口、环境变量、SQLite 文件）；
 *   - 单套件崩溃/超时不会中断其余套件，最终汇总所有失败项；
 *   - 退出码：全绿 0，否则 1（可直接用于 CI 门禁）。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** [显示名, 命令, 参数, 超时ms] */
const SUITES = [
    ['M1 阻断级修复验收', 'test/m1/run-all.mjs', [], 600000],
    ['M2 并发正确性验收', 'test/m2/run-all.mjs', [], 900000],
    ['M3 正确性与一致性验收', 'test/m3/run-all.mjs', [], 900000],
    ['M4 工程纪律验收', 'test/m4/run-all.mjs', [], 900000],
    ['M5 多 Agent 架构验收（Phase 2）', 'test/m5-phase2/run-all.mjs', [], 900000],
    ['M6 高并发验收（Phase 3）', 'test/m6-phase3/run-all.mjs', [], 900000],
    ['M7 企业级分布式验收（Phase 4）', 'test/m7-phase4/run-all.mjs', [], 900000],
    ['M8 插件内核验收', 'test/m8-plugin-kernel/run-all.mjs', [], 300000],
    ['M9 契约一致性验收', 'test/m9-contract-conformance/run-all.mjs', [], 300000],
    ['M10 宿主作用域隔离验收', 'test/m10-host-scope/run-all.mjs', [], 300000],
    ['M11 存储 list 语义验收', 'test/m11-storage-list-semantics/run-all.mjs', [], 300000],
    ['M12 CLI 上下文生命周期验收', 'test/m12-cli-lifecycle/run-all.mjs', [], 300000],
    ['SkillSelector 纯逻辑回归', 'Server/Agent/SkillSelector/__tests__/test-pure-logic.js', [], 180000],
];

function run(script, args, timeoutMs) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(ROOT, script), ...args], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (c) => { out += c.toString(); });
        child.stderr.on('data', (c) => { out += c.toString(); });
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ code: timedOut ? 'TIMEOUT' : code, out });
        });
    });
}

const t0 = Date.now();
console.log('══════════ 3rdLibraryLoop 全量验收 ══════════\n');

const summary = [];
for (const [label, script, args, timeoutMs] of SUITES) {
    const started = Date.now();
    const { code, out } = await run(script, args, timeoutMs);
    const cost = ((Date.now() - started) / 1000).toFixed(1);

    const failLines = (out.match(/^FAIL/gm) || []).length;
    // 顶层套件的断言数：优先取其汇总行，否则统计 PASS 行
    const declared = out.match(/(?:共\s*)?(\d+)\s*条断言/);
    const ok = code === 0 && failLines === 0;
    summary.push({ label, ok, code, failLines, cost });

    const detail = declared ? `${declared[1]} 条断言` : `${(out.match(/^PASS/gm) || []).length} 条断言`;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} ${detail.padEnd(12)} 耗时 ${cost}s（exit=${code}）`);
    if (!ok) {
        for (const line of out.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 10)) {
            console.log(`        ${line}`);
        }
        if (code === 'TIMEOUT') console.log(`        超时未完成（上限 ${timeoutMs / 1000}s）`);
    }
}

const failed = summary.filter((s) => !s.ok);
const total = ((Date.now() - t0) / 1000).toFixed(1);

console.log('\n══════════ 汇总 ══════════');
console.log(`套件 ${summary.length} 个：${summary.length - failed.length} 通过 / ${failed.length} 失败，总耗时 ${total}s`);
if (failed.length > 0) {
    console.log('\n失败套件：');
    for (const f of failed) console.log(`  - ${f.label}（exit=${f.code}，FAIL ${f.failLines} 条）`);
}
process.exit(failed.length === 0 ? 0 : 1);
