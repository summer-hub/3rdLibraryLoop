/**
 * M5（Phase 2 —— 多 Agent 单体架构）验收套件运行器
 *
 * 用法:
 *   npm run test:m5
 *   node test/m5-phase2/run-all.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

const DECLARED = [
    ['F-33 协作基础件（消息/总线/黑板/角色/计划）', 'f33-agent-foundation.test.mjs'],
    ['F-34 角色接力与评审环（Phase 2 核心验收）', 'f34-supervisor-review-loop.test.mjs'],
    ['F-35 运行器契约 · 编排集成 · 并发不变式', 'f35-runner-contract-concurrency.test.mjs'],
];

async function discover() {
    const files = (await fs.readdir(HERE)).filter((f) => /\.test\.mjs$/.test(f)).sort();
    const declared = new Set(DECLARED.map(([, f]) => f));
    const extras = files.filter((f) => !declared.has(f)).map((f) => [`（未声明）${f}`, f]);
    return [...DECLARED, ...extras];
}

function run(file) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(HERE, file)], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (c) => { out += c.toString(); });
        child.stderr.on('data', (c) => { out += c.toString(); });
        const timer = setTimeout(() => child.kill('SIGKILL'), 900000);
        child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
}

console.log('═══ M5 验收套件（Phase 2：多 Agent 单体）═══\n');

const cases = await discover();
const summary = [];
for (const [label, file] of cases) {
    const { code, out } = await run(file);
    const passLines = (out.match(/^PASS/gm) || []).length;
    const failLines = (out.match(/^FAIL/gm) || []).length;
    const ok = code === 0 && failLines === 0;
    summary.push({ label, ok, passLines, failLines });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(38)} ${passLines} 通过 / ${failLines} 失败（exit=${code}）`);
    if (!ok) {
        for (const line of out.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 8)) {
            console.log(`        ${line}`);
        }
    }
}

const failed = summary.filter((s) => !s.ok);
const totalPass = summary.reduce((n, s) => n + s.passLines, 0);
console.log('\n═══ 汇总 ═══');
console.log(`套件 ${summary.length} 个：${summary.length - failed.length} 通过 / ${failed.length} 失败，共 ${totalPass} 条断言`);
process.exit(failed.length === 0 ? 0 : 1);
