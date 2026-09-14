/**
 * M3 验收套件运行器（正确性与一致性）
 *
 * 用法:
 *   npm run test:m3
 *   node test/m3/run-all.mjs
 *
 * 每项独立进程运行，避免端口/环境变量互相干扰。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 显式列出以保证顺序稳定；同时自动发现未被列出的 *.test.mjs */
const DECLARED = [
    ['F-14/15 原子写 · 串行化读改写', 'f14-f15-atomic-json.test.mjs'],
    ['F-16 seq 分配竞态', 'f16-seq-race.test.mjs'],
    ['F-17 SQLite busy_timeout · 连接收敛', 'f17-sqlite-connections.test.mjs'],
    ['F-18 环检测 · 语句缓存', 'f18-cycle-and-stmt-cache.test.mjs'],
    ['F-21 LLM 熔断 · 准入 · JSON 容错', 'f21-llm-resilience.test.mjs'],
    ['F-22/23/24 审核三态 · 计划振荡 · 恢复收敛', 'f22-f24-loop-semantics.test.mjs'],
    ['F-25 知识闭环（经验注入 prompt）', 'f25-knowledge-loop.test.mjs'],
    ['F-26 属主心跳（pid 复用防护）', 'f26-owner-heartbeat.test.mjs'],
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
        const timer = setTimeout(() => child.kill('SIGKILL'), 300000);
        child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
}

console.log('══════ M3 验收套件（正确性与一致性）══════\n');

const cases = await discover();
const summary = [];
for (const [label, file] of cases) {
    const { code, out } = await run(file);
    const passLines = (out.match(/^PASS/gm) || []).length;
    const failLines = (out.match(/^FAIL/gm) || []).length;
    const ok = code === 0 && failLines === 0;
    summary.push({ label, ok, passLines, failLines });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${passLines} 通过 / ${failLines} 失败（exit=${code}）`);
    if (!ok) {
        for (const line of out.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 8)) {
            console.log(`        ${line}`);
        }
    }
}

const failed = summary.filter((s) => !s.ok);
const totalPass = summary.reduce((n, s) => n + s.passLines, 0);
console.log('\n══════ 汇总 ══════');
console.log(`套件 ${summary.length} 个：${summary.length - failed.length} 通过 / ${failed.length} 失败，共 ${totalPass} 条断言`);
process.exit(failed.length === 0 ? 0 : 1);
