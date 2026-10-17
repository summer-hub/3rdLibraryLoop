/**
 * M10（宿主作用域隔离与覆盖守卫）验收套件运行器
 *
 * 用法:
 *   npm run test:m10
 *   node test/m10-host-scope/run-all.mjs
 *
 * 设计同 m8/m9：每个测试文件独立进程运行（模块级默认宿主是进程状态，一个文件一个
 * 干净进程，避免文件之间互相看见对方的 setActiveHost 残留），全部失败也继续跑完并
 * 汇总；退出码全绿 0、否则 1。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

const DECLARED = [
    ['A 作用域隔离（并发 · 优先级 · await 链 · 嵌套）', 'f54-host-scope-isolation.test.mjs'],
    ['B 覆盖守卫 · 无宿主不变式', 'f55-override-guard.test.mjs'],
    ['C withAppHost 作用域化（真宿主 · dispose · 不碰全局状态）', 'f56-with-app-host.test.mjs'],
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
        const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
        child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
}

console.log('═══ M10 验收套件（宿主作用域隔离与覆盖守卫）═══\n');

const cases = await discover();
const summary = [];
for (const [label, file] of cases) {
    const { code, out } = await run(file);
    const passLines = (out.match(/^PASS/gm) || []).length;
    const failLines = (out.match(/^FAIL/gm) || []).length;
    const ok = code === 0 && failLines === 0;
    summary.push({ label, ok, passLines, failLines });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${passLines} 通过 / ${failLines} 失败（exit=${code}）`);
    if (!ok) {
        for (const line of out.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 10)) {
            console.log(`        ${line}`);
        }
        // 进程级异常（未捕获 throw / import 失败）没有 FAIL 行，单独兜底打印尾部
        if (failLines === 0) {
            for (const line of out.trimEnd().split('\n').slice(-8)) console.log(`        ${line}`);
        }
    }
}

const failed = summary.filter((s) => !s.ok);
const totalPass = summary.reduce((n, s) => n + s.passLines, 0);
const totalFail = summary.reduce((n, s) => n + s.failLines, 0);
console.log('\n═══ 汇总 ═══');
console.log(`套件 ${summary.length} 个：${summary.length - failed.length} 通过 / ${failed.length} 失败`);
console.log(`共 ${totalPass} 条断言，失败 ${totalFail} 条`);
process.exit(failed.length === 0 ? 0 : 1);
