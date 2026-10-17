/**
 * M12-A CLI RunContext 生命周期（出口收口）回归锁
 *
 * 背景（本套件锁的缺口）：`RunContext.close()` 负责关闭 storage（SQLite 等）并释放本上下文
 * 持有的插件宿主引用，但**命令入口从来没人调用它** —— 资源只靠进程退出被操作系统回收。
 * 插件化之后又多了宿主与引用计数要回收，继续依赖进程退出等于"清理路径从未被执行过"。
 *
 * 修法是**出口统一收口**而不是逐点 try/finally：创建点分散在 4 个文件、且多处在 try 之前
 * 就有早退（例如 ai serve 起不来直接 return），逐点包必然漏。CLI 是"一进程一命令"，所以
 * 出口收口与"命令结束时收口"语义等价、覆盖更完整。
 *
 * 本套件四组：
 *   A 登记表语义（假 ctx，不触引擎）：登记 / 注销 / 幂等 / 单个失败不影响其它
 *   B 真实 RunContext：创建 → `_init()`（真装插件宿主 + 开 storage）→ 收口 → 幂等
 *   C 静态回归锁：入口与信号处理器里的收口点**必须仍在**（防未来重构悄悄删掉）
 *   D 端到端：真跑一次 CLI 命令（orch load），证明 finally 不影响正常退出码与产物
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const readSrc = (rel) => fs.readFile(path.join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

/**
 * 单条断言。
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(name, ok, detail = '') {
    if (ok) {
        pass++;
        console.log(`PASS  ${name}`);
    } else {
        fail++;
        failures.push(name);
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

const L = await imp('cli/lib/lifecycle.js');

// ─── A 登记表语义（假 ctx）──────────────────────────────────────────────────
{
    const calls = [];
    const mk = (id, throws = false) => ({
        id,
        close: async () => {
            calls.push(id);
            if (throws) throw new Error(`boom:${id}`);
        },
    });

    L.registerRunContext(mk('a1'));
    L.registerRunContext(mk('a2'));
    check('A1 登记后 liveRunContextCount() 反映在册数量', L.liveRunContextCount() >= 2, `实际 ${L.liveRunContextCount()}`);

    const r1 = await L.closeAllRunContexts();
    check('A2 收口调用了每个已登记 ctx 的 close()', r1.closed >= 2 && calls.includes('a1') && calls.includes('a2'));
    check('A3 收口后登记表清空', L.liveRunContextCount() === 0, `实际 ${L.liveRunContextCount()}`);

    const before = calls.length;
    const r2 = await L.closeAllRunContexts();
    check('A4 二次收口是幂等的（0 次新调用）', r2.closed === 0 && r2.failed === 0 && calls.length === before);

    L.registerRunContext(mk('a3-throws', true));
    L.registerRunContext(mk('a4'));
    const r3 = await L.closeAllRunContexts();
    check('A5 单个 ctx 关闭抛错被隔离（其它仍关闭，失败数如实上报）',
        r3.failed === 1 && r3.closed === 1 && calls.includes('a4'), JSON.stringify({ closed: r3.closed, failed: r3.failed }));

    const never = mk('a5-manual');
    L.registerRunContext(never);
    L.unregisterRunContext(never);
    const beforeManual = calls.length;
    const r4 = await L.closeAllRunContexts();
    check('A6 手动注销后收口不再调用它', r4.closed === 0 && calls.length === beforeManual);
}

// ─── B 真实 RunContext ─────────────────────────────────────────────────────
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'm12-lifecycle-'));
let ctx;
try {
    const r = await imp('cli/lib/runner.js');
    ctx = r.createRunContext({
        projectRoot: 'm12-probe',
        dataDir: tmp,
        skillDir: path.join(tmp, 'Skills'),
        verbose: false,
    });
    check('B1 createRunContext() 立即登记到生命周期表', L.liveRunContextCount() === 1, `实际 ${L.liveRunContextCount()}`);
    check('B2 构造后尚未初始化（_closed=false）', ctx._closed === false);

    await ctx._init();
    check('B3 _init() 真的装了 storage 与插件宿主', Boolean(ctx.storage && ctx.host));

    const res = await L.closeAllRunContexts();
    check('B4 出口收口后 ctx._closed=true 且在册归零',
        ctx._closed === true && L.liveRunContextCount() === 0,
        JSON.stringify({ closed: res.closed, live: L.liveRunContextCount() }));

    const again = await L.closeAllRunContexts();
    check('B5 收口后再收口仍幂等', again.closed === 0 && again.failed === 0);

    let threw = false;
    try {
        await ctx.close();
    } catch {
        threw = true;
    }
    check('B6 已关闭的 ctx.close() 再调一次不抛（幂等契约）', threw === false);
} finally {
    await fs.rm(tmp, { recursive: true, force: true });
}

// ─── C 静态回归锁（收口点不得被悄悄删掉）────────────────────────────────────
{
    const bin = await readSrc('cli/bin/3rdloop.mjs');
    // 锚定**调用点**而不是任何出现处：文件顶部有 `import { closeAllRunContexts }`，
    // 用 indexOf('closeAllRunContexts') 会命中 import，从而把断言变成永真/永假。
    const callAt = bin.indexOf('await closeAllRunContexts()');
    const finallyAt = bin.indexOf('} finally {');
    const exitAt = bin.lastIndexOf('process.exit');
    check('C1 cli/bin/3rdloop.mjs 在 finally 里调用收口', finallyAt !== -1 && callAt > finallyAt);
    check('C2 收口发生在 process.exit 之前（否则永远不会执行）', callAt !== -1 && callAt < exitAt);
    check('C3 收口失败不改变退出码（try/catch 包住）', /try\s*\{\s*\n?\s*await closeAllRunContexts\(\);/.test(bin));

    // 信号处理器会直接 process.exit（绕过出口），因此每个退出点前都必须先收口
    const SIG_LINE = "process.exit(sig === 'SIGINT' ? EXIT.SIGINT : EXIT.SIGTERM);";
    const cliModules = ['cli.js', 'orch.js', 'step.js', 'workflow.js'];
    const missing = [];
    let seen = 0;
    for (const f of cliModules) {
        const lines = (await readSrc(`cli/lib/${f}`)).split(/\r?\n/);
        lines.forEach((line, i) => {
            if (line.trim() !== SIG_LINE) return;
            seen++;
            const window = lines.slice(Math.max(0, i - 6), i).join('\n');
            if (!window.includes('closeAllRunContexts')) missing.push(`${f}:${i + 1}`);
        });
    }
    check('C4 每个信号退出点前都有收口', seen > 0 && missing.length === 0,
        missing.length ? `缺失：${missing.join(', ')}` : `${seen} 个退出点全覆盖`);

    const runnerSrc = await readSrc('cli/lib/runner.js');
    check('C5 createRunContext() 仍调用 registerRunContext',
        /createRunContext[\s\S]{0,400}?registerRunContext\(ctx\)/.test(runnerSrc));
    check('C6 RunContext.close() 仍调用 unregisterRunContext',
        /async close\(\)[\s\S]{0,300}?unregisterRunContext\(this\)/.test(runnerSrc));

    const lifeSrc = await readSrc('cli/lib/lifecycle.js');
    check('C7 lifecycle.js 保持零依赖（bin 静态引入它，不能牵出 .env/引擎加载链）',
        !/^import\s/m.test(lifeSrc), '出现了 import 行');
}

// ─── D 端到端：真跑一次 CLI 命令，退出码与产物不受 finally 影响 ─────────────
{
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'm12-cli-'));
    try {
        const defPath = path.join(dir, 'task-def.json');
        const taskDef = {
            taskId: 'm12_cleanup_probe',
            title: 'm12 cleanup probe',
            skillDirectory: '',
            loopCount: 0,
            steps: [{
                stepId: 1,
                taskDescription: 'noop',
                dependId: 0,
                nextStepId: 0,
                failStepId: 0,
                maxRetries: 1,
                skillDirectory: '',
                specifiedSkill: '',
                inputReport: '',
            }],
        };
        await fs.writeFile(defPath, JSON.stringify(taskDef), 'utf8');

        const result = await new Promise((resolve) => {
            const child = spawn(process.execPath, ['cli/bin/3rdloop.mjs', 'orch', 'load', defPath, '--data-dir', dir, '--json'], {
                cwd: ROOT,
                env: { ...process.env, LOG_FILE_ENABLED: 'false', DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY ?? 'sk-m12-probe' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let out = '';
            child.stdout.on('data', (c) => {
                out += c.toString();
            });
            child.stderr.on('data', (c) => {
                out += c.toString();
            });
            const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
            child.on('exit', (code) => {
                clearTimeout(timer);
                resolve({ code, out });
            });
        });

        check('D1 CLI 命令正常退出（收口没有改变退出码）', result.code === 0, `exit=${result.code}`);
        check('D2 命令产物已落盘', /"status"\s*:\s*"loaded"/.test(result.out) || result.out.includes('m12_cleanup_probe'));

        const taskFile = path.join(dir, 'task', 'm12_cleanup_probe', 'orchestration.json');
        const exists = await fs.access(taskFile).then(() => true, () => false);
        check('D3 编排定义真的写到磁盘（收口发生在写盘之后）', exists, taskFile);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

console.log('\n═══ M12-A 汇总 ═══');
console.log(`共 ${pass + fail} 条断言，通过 ${pass} 条，失败 ${fail} 条`);
if (fail > 0) {
    console.log(`失败项：${failures.join(' / ')}`);
}
process.exit(fail === 0 ? 0 : 1);
