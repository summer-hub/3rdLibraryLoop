/**
 * M12（CLI RunContext 生命周期）验收套件运行器
 *
 * 用法:
 *   npm run test:m12
 *   node test/m12-cli-lifecycle/run-all.mjs
 *
 * 设计同 m4/m7/m8/m9/m11：每个测试文件独立进程运行（互不污染临时目录、模块缓存、环境变量），
 * 全部失败也继续跑完并汇总；退出码全绿 0、否则 1。
 *
 * 套件清单在下面显式声明（顺序即阅读顺序），目录里多出来的 `*.test.mjs` 会被自动发现
 * 并以「（未声明）」前缀追加执行——新增测试不会被忘在目录里。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

const DECLARED = [
    ['A 登记表语义 + 真实上下文收口 + 静态回归锁', 'f61-cli-runcontext-lifecycle.test.mjs'],
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
            env: { ...process.env, LOG_FILE_ENABLED: 'false' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (c) => {
            out += c.toString();
        });
        child.stderr.on('data', (c) => {
            out += c.toString();
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ code, out });
        });
    });
}

console.log('═══ M12 验收套件（CLI 命令出口的 RunContext 收口）═══\n');

const cases = await discover();
const summary = [];
for (const [label, file] of cases) {
    const { code, out } = await run(file);
    const passLines = (out.match(/^PASS/gm) || []).length;
    const failLines = (out.match(/^FAIL/gm) || []).length;
    const ok = code === 0 && failLines === 0;
    summary.push({ label: `${label} [${file}]`, ok, passLines, failLines });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${passLines} 通过 / ${failLines} 失败（exit=${code}）`);
    if (!ok) {
        for (const line of out.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 20)) {
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
