/**
 * ci.mjs — 统一 CI 入口（F-29）
 *
 * 为什么要有这一层：CI 配置（GitHub Actions / GitLab CI / GitCode 流水线）的写法
 * 各不相同、且容易随平台迁移而失效。把真正的校验逻辑放在这里，各平台配置只需调用
 * 同一个命令，本地也能跑出一致结果：
 *
 *     node scripts/ci.mjs      # 等价于 npm run ci
 *
 * 校验顺序（快速失败优先）：
 *   0. arch   —— scripts/arch-guard.mjs：架构守卫，把「一切即插件」的三条铁律
 *                （R1 内核纯净 / R2 插件互斥 / R3 契约不碰实现）做成机器判定。
 *                纯文本扫描、毫秒级完成，放在最前面兜底最便宜的失败
 *   1. lint   —— Biome 静态检查，**0 error 才通过**（warning 只报告不阻断，
 *                这是"先 warn 后 error 渐进收紧"的第一阶段）
 *   2. test   —— 全部里程碑套件（M1~M7 + 引擎单元测试），任一失败即失败
 *
 * 退出码：0 全绿；1 任一环节失败（可直接作为 CI 门禁）。
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Biome 的可移植调用方式。
 *
 * ⚠️ Windows 坑：不能 spawn `node_modules/.bin/biome.cmd`——Node 在无 shell 时
 * 拒绝执行 `.cmd`/`.bat`，会抛 `spawn EINVAL`。这与本项目 cli/lib/update.js 里
 * 记录过的 `npm.cmd` 问题是同一类。因此统一用 node 执行 Biome 的 JS 入口
 * （`@biomejs/biome/bin/biome` 会自行定位平台原生二进制），跨平台一致。
 */
const BIOME_JS = path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');

function runStep(label, cmd, args, { timeoutMs = 1800000 } = {}) {
    return new Promise((resolve) => {
        console.log(`\n──── ${label} ────`);
        const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        // 保留完整输出以便 CI 日志排查，同时实时回显（避免长任务看似卡死）
        let out = '';
        const onData = (buf) => {
            const s = buf.toString();
            out += s;
            process.stdout.write(s);
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            console.error(`\n[ci] ${label} 超时（${timeoutMs}ms），强制终止`);
            child.kill('SIGKILL');
        }, timeoutMs);

        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ code: timedOut ? 'TIMEOUT' : code, out });
        });
    });
}

const t0 = Date.now();
console.log('══════════ CI 校验 ══════════');
console.log(`仓库根目录: ${ROOT}`);
console.log(`Node: ${process.version}`);

const steps = [];

// ── 0. arch-guard（架构守卫，最快失败优先）──
{
    const r = await runStep('arch-guard（一切即插件三条铁律）', process.execPath, ['scripts/arch-guard.mjs']);
    const summary = (r.out.match(/arch-guard: .*/g) || []).pop() ?? `exit=${r.code}`;
    steps.push({ label: 'arch', ok: r.code === 0, detail: summary });
}

// ── 1. lint ──
if (!fs.existsSync(BIOME_JS)) {
    steps.push({ label: 'lint', ok: false, detail: `未找到 Biome（${BIOME_JS}）。请先 npm ci / npm install` });
} else {
    const r = await runStep('lint（Biome，0 error 为通过）', process.execPath, [BIOME_JS, 'lint', '--reporter=summary']);
    const errMatch = /Found (\d+) errors?/.exec(r.out);
    // Biome 在 0 个 error 时**不打印** "Found N errors" 这一行，因此不能把
    // "没匹配到"当成"未知"——退出码为 0 即等价于 0 error。
    const errors = errMatch ? Number(errMatch[1]) : (r.code === 0 ? 0 : null);
    const warnMatch = /Found (\d+) warnings?/.exec(r.out);
    const warnings = warnMatch ? Number(warnMatch[1]) : 0;
    const ok = r.code === 0 && errors === 0;
    steps.push({
        label: 'lint',
        ok,
        detail: `errors=${errors ?? '未知'} warnings=${warnings} exit=${r.code}`,
    });
}

// ── 2. 测试 ──
const testResult = await runStep('test（M1~M7 + 引擎单元测试）', process.execPath, ['test/run-all.mjs']);
{
    const failLine = /套件 (\d+) 个：(\d+) 通过 \/ (\d+) 失败/.exec(testResult.out);
    const summary = failLine
        ? `${failLine[2]}/${failLine[1]} 套件通过`
        : (() => {
            const n = (testResult.out.match(/合计: (\d+) 通过 \/ (\d+) 失败/g) || []).pop();
            return n ?? `exit=${testResult.code}`;
        })();
    steps.push({ label: 'test', ok: testResult.code === 0, detail: summary });
}

const cost = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n══════════ CI 汇总 ══════════');
for (const s of steps) {
    console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.label.padEnd(8)} ${s.detail}`);
}
console.log(`总耗时 ${cost}s`);

const failed = steps.filter((s) => !s.ok);
process.exit(failed.length === 0 ? 0 : 1);
