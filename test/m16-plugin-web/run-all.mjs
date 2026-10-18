/**
 * M16（插件管理页 + HTTP 接口）验收套件运行器
 *
 * 用法:
 *   node test/m16-plugin-web/run-all.mjs
 *
 * 结构与 m11/m12/m13/m14 一致：显式声明 + 自动发现未声明文件 + 汇总 + 退出码。
 * 每个 `*.test.mjs` 在独立子进程里跑（写盘一律用假 HOME，见 f64-plugin-web.test.mjs）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

const DECLARED = [
    ['A 插件管理页 / GET /api/plugins / toggle 语义', 'f64-plugin-web.test.mjs'],
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

console.log('═══ M16 验收套件（插件管理页 + /api/plugins 接口）═══\n');

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
