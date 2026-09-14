/**
 * M2 验收套件运行器（并发正确性 F-06 ~ F-13）
 *
 * 用法:
 *   npm run test:m2
 *   node test/m2/run-all.mjs
 *
 * 每项独立进程运行，避免端口/环境变量互相干扰。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

const CASES = [
    ['F-06/07/08 超时 · 取消 · 准入隔离', 'f06-f08-concurrency.test.mjs'],
    ['F-09/10 SSE 背压 · 连接身份与准入', 'f09-f10-sse-backpressure.test.mjs'],
    ['F-11 持久化写放大消除', 'f11-persistence-coalescing.test.mjs'],
    ['F-12 内存注册表淘汰', 'f12-registry-eviction.test.mjs'],
    ['F-13 HTTP 层加固', 'f13-http-hardening.test.mjs'],
];

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

console.log('══════ M2 验收套件（并发正确性）══════\n');

const summary = [];
for (const [label, file] of CASES) {
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
