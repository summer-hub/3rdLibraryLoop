/**
 * M8（插件内核）验收套件运行器
 *
 * 用法:
 *   npm run test:m8
 *   node test/m8-plugin-kernel/run-all.mjs
 *
 * 设计同 m4/m7：每个测试文件独立进程运行（互不污染临时目录、模块缓存、环境变量），
 * 全部失败也继续跑完并汇总；退出码全绿 0、否则 1。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

const DECLARED = [
    ['A 插件定义与清单校验（definePlugin / validateManifest）', 'f43-define-plugin-manifest.test.mjs'],
    ['B 上下文：服务接缝 · 类型化事件 · 作用域隔离', 'f44-context-services-events.test.mjs'],
    ['C 可逆回收（逆序/幂等/汇总）与依赖拓扑确定性', 'f45-dispose-toposort.test.mjs'],
    ['D 配置组合（overrides > env > profile > 默认）', 'f46-profile-precedence.test.mjs'],
    ['E required 契约 fail closed（缺失/禁用即启动失败）', 'f47-required-fail-closed.test.mjs'],
    ['F 宿主端到端（真插件目录 · 拓扑 setup · dispose）', 'f48-host-end-to-end.test.mjs'],
    ['G 嵌套插件目录发现（递归 · 深度上限 · 确定性 · 冲突）', 'f49-nested-discovery.test.mjs'],
    ['H 技术债守卫（cstTime 行为 · logger 实例 · AtomicJsonFile 字节）', 'f50-util-copies.test.mjs'],
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

console.log('═══ M8 验收套件（插件内核）═══\n');

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
