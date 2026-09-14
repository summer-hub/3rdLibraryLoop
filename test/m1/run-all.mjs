/**
 * M1 验收套件运行器
 *
 * 逐项运行 M1（阻断级修复）的验收用例并汇总结果。
 * 另含两条静态防线：调试埋点残留、弱口令兜底残留、全量语法检查。
 *
 * 用法:
 *   npm run test:m1
 *   node test/m1/run-all.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 动态验收用例（每项一个独立进程，避免端口/环境变量互相干扰） */
const CASES = [
    ['F-02 CORS 收紧', 'f02-cors.test.mjs'],
    ['F-02 访问控制（Web/server.js + serve + issue 扩展）', 'f02-access-control.test.mjs'],
    ['F-03 会话生命周期回收', 'f03-session-lifecycle.test.mjs'],
    ['F-04 优雅停机（单元 + 真实 Server 端到端）', 'f04-graceful-shutdown.test.mjs'],
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
        const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
        child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
}

const summary = [];

// ─── 静态防线 ─────────────────────────────────────────────────────────────
async function staticGuards() {
    const guards = [
        {
            name: 'F-01 无调试埋点残留（7594 / #region agent log）',
            pattern: /7594|#region agent log/,
            scope: ['Server', 'cli', 'Web', 'MCP', 'Archive', 'Tools'],
        },
        {
            // 只拦「回退到非空字符串字面量」这种弱口令兜底；
            // `|| ''`（空串兜底＝未配置即拒绝）是安全写法，不应误报。
            name: 'F-02 无弱口令兜底（ADMIN_PASSWORD = ... || \'xxx\'）',
            pattern: /ADMIN_PASSWORD\s*=\s*[^;]*\|\|\s*['"][^'"]+['"]/,
            scope: ['Web/ext'],
        },
        {
            name: 'F-02 无明文密码不等比较（!== ADMIN_PASSWORD）',
            pattern: /!==\s*ADMIN_PASSWORD/,
            scope: ['Web/ext'],
        },
    ];
    for (const g of guards) {
        try {
            const { stdout } = await execFileAsync(
                'git', ['grep', '-nE', g.pattern.source, '--', ...g.scope],
                { cwd: ROOT }
            );
            summary.push({ name: g.name, ok: false, detail: `残留:\n${stdout.trim()}` });
        } catch (err) {
            // git grep 无匹配时退出码为 1
            if (err.code === 1) summary.push({ name: g.name, ok: true, detail: '无匹配' });
            else summary.push({ name: g.name, ok: false, detail: `git grep 执行失败: ${err.message}` });
        }
    }

    // 全量语法检查（Server + cli + Web + Archive + MCP + Tools）
    const targets = ['Server', 'cli', 'Web', 'Archive', 'MCP', 'Tools', 'test'];
    let checked = 0;
    const bad = [];
    for (const dir of targets) {
        const files = await walk(path.join(ROOT, dir));
        for (const f of files) {
            if (!/\.(mjs|cjs|js)$/.test(f)) continue;
            if (/node_modules|[\\/]vendor[\\/]/.test(f)) continue;
            checked++;
            try {
                await execFileAsync(process.execPath, ['--check', f], { cwd: ROOT });
            } catch (err) {
                bad.push(`${path.relative(ROOT, f)}: ${String(err.stderr || err.message).split('\n')[0]}`);
            }
        }
    }
    summary.push({
        name: `全量语法检查（${checked} 个文件）`,
        ok: bad.length === 0,
        detail: bad.length ? bad.slice(0, 5).join('\n') : 'ok',
    });
}

async function walk(dir, out = []) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            await walk(full, out);
        } else out.push(full);
    }
    return out;
}

console.log('══════ M1 验收套件 ══════\n');
console.log('── 静态防线 ──');
await staticGuards();
for (const s of summary) {
    console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}${s.ok ? '' : '  → ' + s.detail}`);
}

console.log('\n── 动态用例 ──');
for (const [label, file] of CASES) {
    const { code, out } = await run(file);
    const passLines = (out.match(/^PASS/gm) || []).length;
    const failLines = (out.match(/^FAIL/gm) || []).length;
    const ok = code === 0 && failLines === 0;
    summary.push({ name: `${label}（${passLines} 项）`, ok, detail: ok ? '' : out.split('\n').filter((l) => /^FAIL/.test(l)).join('\n') });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${passLines} 通过 / ${failLines} 失败（exit=${code}）`);
    if (!ok) {
        for (const line of out.split('\n').filter((l) => /^FAIL/.test(l))) console.log(`      ${line}`);
    }
}

const failed = summary.filter((s) => !s.ok);
console.log('\n══════ 汇总 ══════');
console.log(`共 ${summary.length} 项：${summary.length - failed.length} 通过 / ${failed.length} 失败`);
if (failed.length > 0) {
    console.log('\n失败项：');
    for (const f of failed) console.log(`  - ${f.name}`);
}
process.exit(failed.length === 0 ? 0 : 1);
