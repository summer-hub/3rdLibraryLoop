/**
 * M4 验收：F-29 CI 入口 ／ F-30 Lint ／ F-31 覆盖率基线 ／ F-32 换行符策略
 *
 * 这一套件验证"工程纪律类"改动**真的落地且可用**，而不只是文件存在：
 *   A F-32：.gitattributes 存在，且对源码/文档强制 LF、对 .bat/.cmd 强制 CRLF、二进制标 binary
 *   B F-32：所有 *.sh 实际为 LF 且 shebang 不含 CR（CRLF 会让 macOS/Linux 直接 bad interpreter）
 *   C F-30：biome.json 合法，lint 以 **0 error** 通过（warning 不计为失败）
 *   D F-30：lint 能真正抓到错误（用临时目录构造一个"重复对象键"的坏文件，断言 lint 报错）
 *   E F-31：coverage 脚本存在且可运行，输出可解析的覆盖率数字
 *   F F-29：CI 入口存在（npm run ci / lint+test），且 CI 配置调用它
 *   G F-27：顶层与各里程碑测试入口在 package.json 中齐备
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

function run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
        let out = '';
        child.stdout.on('data', (c) => { out += c.toString(); });
        child.stderr.on('data', (c) => { out += c.toString(); });
        const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 300000);
        child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
}

/** 逐字节统计行尾与 BOM */
function lineEndings(file) {
    const b = fs.readFileSync(file);
    let crlf = 0;
    let lf = 0;
    for (let i = 0; i < b.length; i++) {
        if (b[i] === 10) {
            if (i > 0 && b[i - 1] === 13) crlf++;
            else lf++;
        }
    }
    const bom = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    return { crlf, lf, bom };
}

// ─── A. .gitattributes 内容 ─────────────────────────────────────────────
{
    const ga = path.join(ROOT, '.gitattributes');
    check('A .gitattributes 存在', fs.existsSync(ga));
    const txt = fs.existsSync(ga) ? fs.readFileSync(ga, 'utf8') : '';

    check('A 对源码/文档强制 eol=lf（避免跨平台整文件抖动）',
        /\*\.js\s+text\s+eol=lf/.test(txt) && /\*\.md\s+text\s+eol=lf/.test(txt),
        txt.split('\n').filter((l) => l.includes('eol=lf')).slice(0, 3).join(' | '));
    check('A 对 *.sh 强制 LF（否则 macOS/Linux 报 bad interpreter）',
        /\*\.sh\s+text\s+eol=lf/.test(txt));
    check('A 对 Windows 批处理强制 CRLF（cmd.exe 对 LF 解析不可靠）',
        /\*\.bat\s+text\s+eol=crlf/.test(txt) && /\*\.cmd\s+text\s+eol=crlf/.test(txt));
    check('A 二进制类型标 binary（禁止转换）',
        (txt.match(/binary/g) || []).length >= 5,
        `binary 行数=${(txt.match(/binary/g) || []).length}`);
    check('A 默认规则为 text=auto eol=lf', /\*\s+text=auto\s+eol=lf/.test(txt));

    // git 是否真的按规则解释（避免写了不生效）
    const attr = await run('git', ['check-attr', 'eol', '--', 'Server/Orchestrator/Orchestrator.js']);
    check('A git 实际按规则解释 .js 的 eol', /eol:\s*lf/.test(attr.out), attr.out.trim());
}

// ─── B. 所有 shell 脚本必须是 LF 且 shebang 干净 ────────────────────────
{
    const shs = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name === '.git' || e.name === 'vendor') continue;
                walk(full);
            } else if (e.name.endsWith('.sh')) {
                shs.push(full);
            }
        }
    };
    walk(ROOT);

    check('B 仓库内存在 shell 脚本（本项才有意义）', shs.length > 0, `count=${shs.length}`);

    const crlfOnes = [];
    const dirtyShebang = [];
    for (const f of shs) {
        const { crlf } = lineEndings(f);
        if (crlf > 0) crlfOnes.push(path.relative(ROOT, f));
        const first = fs.readFileSync(f, 'utf8').split('\n')[0];
        if (first.includes('\r')) dirtyShebang.push(path.relative(ROOT, f));
    }
    check(`B 全部 ${shs.length} 个 .sh 均为 LF（无 CRLF）`, crlfOnes.length === 0,
        crlfOnes.slice(0, 5).join(', '));
    check('B 全部 .sh 的 shebang 不含 CR（bad interpreter 的根因）',
        dirtyShebang.length === 0, dirtyShebang.slice(0, 5).join(', '));
}

// ─── C/D. Lint ─────────────────────────────────────────────────────────
// ⚠️ Windows：不能直接 spawn node_modules/.bin/biome.cmd —— Node 不允许无 shell
// 执行 .cmd/.bat（spawn EINVAL）。这与本项目 cli/lib/update.js 中记录的 npm.cmd
// 问题是同一类坑。这里统一改为用 node 执行 Biome 的 JS 入口（跨平台一致）。
const BIOME_JS = path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
const biomeArgs = (args) => [BIOME_JS, ...args];
{
    check('C biome 已安装（devDependency）', fs.existsSync(BIOME_JS), BIOME_JS);
    check('C biome.json 存在且为合法 JSON', (() => {
        try { JSON.parse(fs.readFileSync(path.join(ROOT, 'biome.json'), 'utf8')); return true; } catch { return false; }
    })());

    if (fs.existsSync(BIOME_JS)) {
        const lint = await run(process.execPath, biomeArgs(['lint', '--reporter=summary']));
        const errMatch = /Found (\d+) errors?/.exec(lint.out);
        const errors = errMatch ? Number(errMatch[1]) : 0;
        check('C 全量 lint 通过（0 errors；warning 不计为失败）', lint.code === 0 && errors === 0,
            `exit=${lint.code} errors=${errors}`);
        check('C lint 检查了实质数量的文件', /Checked (\d+) files/.test(lint.out),
            (/Checked \d+ files/.exec(lint.out) || [''])[0]);

        // D. 负向验证：lint 必须能抓到真错误，否则"0 error"毫无意义。
        //
        // 注意：探针文件必须落在**本仓库被 files.includes 覆盖的路径**下。
        // 放到系统临时目录是不行的——biome.json 的 includes 白名单不含外部路径，
        // Biome 会以"没有可处理文件"退出，而不是报出目标诊断，测试会得到假结论。
        const probe = path.join(ROOT, 'Server', '.m4-lint-probe.js');
        try {
            // 重复对象键：后一个键会静默覆盖前一个——正是 Biome 在本项目中真正抓到过的那类问题
            // （当时它抓出 LoopEngine 里我自己引入的重复 error/aborted 键）
            await fsp.writeFile(probe, 'export const x = { a: 1, a: 2 };\n', 'utf8');
            const badLint = await run(process.execPath, biomeArgs([
                'lint', '--config-path', path.join(ROOT, 'biome.json'), probe,
            ]));
            check('D lint 能抓到"重复对象键"（负向验证，证明 lint 真的生效）',
                badLint.code !== 0 && /noDuplicateObjectKeys|Duplicate/i.test(badLint.out),
                `exit=${badLint.code} matched=${/noDuplicateObjectKeys/i.test(badLint.out)}`);
        } finally {
            await fsp.rm(probe, { force: true });
        }
        check('D 探针文件已清理（不留残留）', !fs.existsSync(probe));
    }
}

// ─── E. 覆盖率基线脚本 ──────────────────────────────────────────────────
{
    const cov = path.join(ROOT, 'scripts', 'coverage.mjs');
    check('E 覆盖率脚本存在', fs.existsSync(cov));

    const res = await run(process.execPath, [cov, '--only=unit'], { timeoutMs: 600000 });
    const m = /已加载文件字节覆盖率:\s*([\d.]+)%/.exec(res.out);
    check('E 覆盖率脚本可运行并输出可解析的百分比', !!m, m ? `${m[1]}%` : res.out.slice(-200));
    check('E 输出包含"从未被测试加载"的文件清单（暴露覆盖缺口）',
        /从未被测试加载/.test(res.out));
    // 覆盖率基线不作为门禁（本阶段目标是建立基线），脚本应始终以 0 退出
    check('E 覆盖率基线不阻断构建（非门禁）', res.code === 0, `exit=${res.code}`);
}

// ─── F. CI 入口 ────────────────────────────────────────────────────────
{
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    check('F package.json 提供 ci 脚本', typeof pkg.scripts?.ci === 'string', pkg.scripts?.ci);
    check('F package.json 提供 lint 脚本', typeof pkg.scripts?.lint === 'string', pkg.scripts?.lint);
    check('F package.json 提供 coverage 脚本', typeof pkg.scripts?.coverage === 'string', pkg.scripts?.coverage);

    const ciScript = path.join(ROOT, 'scripts', 'ci.mjs');
    check('F scripts/ci.mjs 存在（供任意 CI 平台调用）', fs.existsSync(ciScript));

    const wf = path.join(ROOT, '.github', 'workflows', 'ci.yml');
    check('F 提供 GitHub Actions 工作流（可被镜像/其他平台参照）', fs.existsSync(wf));
    if (fs.existsSync(wf)) {
        const y = fs.readFileSync(wf, 'utf8');
        check('F 工作流调用统一 CI 入口（而非各自拼命令）', /npm run ci|scripts\/ci\.mjs/.test(y));
        check('F 工作流安装依赖使用 npm ci（可复现）', /npm ci/.test(y));
    }
}

// ─── G. 测试入口齐备 ───────────────────────────────────────────────────
{
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const s = pkg.scripts ?? {};
    for (const k of ['test', 'test:m1', 'test:m2', 'test:m3', 'test:m4', 'test:unit']) {
        check(`G package.json 提供 ${k}`, typeof s[k] === 'string', s[k]);
    }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
