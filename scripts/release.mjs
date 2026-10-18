#!/usr/bin/env node
/**
 * release.mjs —— 一键产出发布产物（**只打包，不上传、不发布**）
 *
 * 用法：node scripts/release.mjs [--out <dir>]   （默认 dist/）
 *
 * 六个步骤（任一步失败即非零退出并说明失败在哪个步骤）：
 *   ① 读两份 manifest 的 name/version
 *   ② 断言两包版本一致（核心包与 CLI 包必须同版本发布）
 *   ③ 清理上次生成的本脚本产物（两份 tarball + SHA256SUMS + RELEASE.md）
 *   ④ npm pack 核心包与 cli/ 包到 --out
 *   ⑤ 计算 sha256 写入 <out>/SHA256SUMS（两行，sha256sum 格式）
 *   ⑥ 生成 <out>/RELEASE.md（版本、两个 tarball 的文件数/体积、本地安装示例、发布步骤）
 *
 * 幂等：重复执行只清理**自己上次生成的同名产物**（两份 tarball + SHA256SUMS + RELEASE.md），
 * 绝不清空整个 --out 目录（用户可能在里面放了别的东西）。
 *
 * 刻意不做的事：npm publish、gh/git 调用、任何网络请求——发布动作一律留给人工。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIR = REPO_ROOT;
const CLI_DIR = path.join(REPO_ROOT, 'cli');

const OUT_ENV = '3LIB_RELEASE_OUT';

/** 产物文件名（不含目录）：tarball 名由包名派生，与 npm pack 的命名规则一致。 */
const SHA_FILE = 'SHA256SUMS';
const NOTES_FILE = 'RELEASE.md';

/** 当前步骤（失败信息要能指出是哪一步）。 */
let stepName = '';

class ReleaseError extends Error {}

/** 进入一个步骤（失败信息带上步骤名与序号）。 */
function step(name) {
    stepName = name;
    process.stderr.write(`\n[release] ▸ ${name}\n`);
}

/** 失败：抛出带步骤名的错误（main 里统一收口成非零退出）。 */
function fail(message) {
    throw new ReleaseError(stepName ? `「${stepName}」失败：${message}` : message);
}

/** 读 JSON 文件。 */
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        fail(`无法读取 ${file}：${err.message}`);
    }
}

/** 包名 → npm pack 的 tarball 名（`@scope/name` → `scope-name`）。 */
function tarballName(pkgName, version) {
    return `${pkgName.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

/** 从 argv 解析 --out / --help。 */
function parseArgs(argv) {
    const opts = { out: process.env[OUT_ENV] || 'dist', help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') {
            opts.help = true;
        } else if (a === '--out') {
            const v = argv[++i];
            if (!v) fail('--out 需要一个目录参数');
            opts.out = v;
        } else if (a.startsWith('--out=')) {
            opts.out = a.slice('--out='.length);
        } else {
            fail(`未知参数：${a}（用法：node scripts/release.mjs [--out <dir>]）`);
        }
    }
    return opts;
}

/**
 * npm 可执行入口：优先用当前 node 自带的 npm-cli.js（避免 Windows 下 npm.cmd
 * 需要 shell 才能执行、且路径含空格时的转义问题）；找不到才退回 `npm` + shell。
 */
function npmEntry() {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(cli)) return { file: process.execPath, prefix: [cli], shell: false };
    return { file: 'npm', prefix: [], shell: process.platform === 'win32' };
}

/**
 * 从 npm 输出中取出 pack 结果对象。
 * npm 的 lifecycle（prepack/postpack）日志与 JSON 混在 stdout 里，因此从最后一个
 * `"filename"` 向前找所属数组、再做括号配对切出纯 JSON 片段。
 */
function extractPackResult(stdout) {
    const keyAt = stdout.lastIndexOf('"filename"');
    if (keyAt < 0) return null;
    const start = stdout.lastIndexOf('[', keyAt);
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    for (let i = start; i < stdout.length; i++) {
        const ch = stdout[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) {
                try {
                    const arr = JSON.parse(stdout.slice(start, i + 1));
                    if (Array.isArray(arr) && arr[0]?.filename) return arr[0];
                } catch { /* 不是合法 JSON：交给调用方报错 */ }
                return null;
            }
        }
    }
    return null;
}

/** npm pack 一个包目录到 outDir，返回 { tarball, entryCount, unpackedSize }。 */
function packPackage(label, pkgDir, outDir) {
    const { file, prefix, shell } = npmEntry();
    const args = [...prefix, 'pack', '--json', '--pack-destination', outDir];
    const res = spawnSync(file, args, { cwd: pkgDir, encoding: 'utf8', shell });

    if (res.error) fail(`${label}：无法执行 npm pack（${res.error.message}）`);
    if (res.status !== 0) {
        const detail = (res.stderr || res.stdout || '').trim().split(/\r?\n/).slice(-8).join('\n');
        fail(`${label}：npm pack 退出码 ${res.status}\n${detail}`);
    }

    const info = extractPackResult(res.stdout || '');
    if (!info) fail(`${label}：无法解析 npm pack 的输出\n${(res.stdout || '').trim().slice(-800)}`);

    const tarball = String(info.filename);
    const full = path.join(outDir, tarball);
    if (!fs.existsSync(full)) fail(`${label}：npm pack 报告产出 ${tarball}，但 ${outDir} 下不存在该文件`);

    return {
        label,
        name: info.name,
        version: info.version,
        tarball,
        entryCount: Number(info.entryCount) || 0,
        unpackedSize: Number(info.unpackedSize) || 0,
        bytes: fs.statSync(full).size,
    };
}

/** 人类可读体积。 */
function human(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 文件 sha256（小写十六进制）。 */
function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 清理自己上次生成的同名产物（**不动** --out 里的其他内容，不删目录）。
 * 只认：两份包的 tarball（含历史版本）、SHA256SUMS、RELEASE.md。
 */
function cleanOwnArtifacts(outDir, pkgNames) {
    const prefixes = pkgNames.map((n) => `${n.replace(/^@/, '').replace('/', '-')}-`);
    const removed = [];
    for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const name = entry.name;
        const own = name === SHA_FILE || name === NOTES_FILE || (name.endsWith('.tgz') && prefixes.some((p) => name.startsWith(p)));
        if (!own) continue;
        fs.rmSync(path.join(outDir, name), { force: true });
        removed.push(name);
    }
    return removed;
}

/** 生成 RELEASE.md 正文。 */
function renderNotes({ version, core, cli, outDir, hashes, generatedAt }) {
    const install = `npm i ./${core.tarball} ./${cli.tarball}`;
    return `# 3rdLibraryLoop v${version} 发布产物

- 生成时间（UTC）：${generatedAt}
- 版本：\`${version}\`（核心包与 CLI 包**同版本**）
- 产物目录：\`${path.relative(REPO_ROOT, outDir).split(path.sep).join('/') || '.'}/\`

## 产物清单

| 包 | tarball | 文件数 | 体积（tarball / 解包） | sha256 |
|----|---------|--------|------------------------|--------|
| \`${core.name}\` | \`${core.tarball}\` | ${core.entryCount} | ${human(core.bytes)} / ${human(core.unpackedSize)} | \`${hashes[core.tarball]}\` |
| \`${cli.name}\` | \`${cli.tarball}\` | ${cli.entryCount} | ${human(cli.bytes)} / ${human(cli.unpackedSize)} | \`${hashes[cli.tarball]}\` |

校验文件：\`${SHA_FILE}\`（sha256sum 格式，两行）。

## 本地安装（验证用）

在产物目录下执行，注意**两个 tarball 一起装**（CLI 通过 \`@ohos-cpf/3rdloop_core\` 依赖核心包，
只装 CLI 会从 registry 拉旧版核心包）：

\`\`\`bash
${install}
\`\`\`

装完自检（应当报出安装态核心包版本与来源）：

\`\`\`bash
npx 3rdloop version
npx 3rdloop serve          # 前端扩展随核心包自动发现，无需 install-ext
\`\`\`

## 发布步骤（人工执行，本脚本不做任何上传/发布）

1. 校验产物完整性：

   \`\`\`bash
   sha256sum -c ${SHA_FILE}
   \`\`\`

2. 打 tag 并推送：

   \`\`\`bash
   git tag v${version} && git push origin v${version}
   \`\`\`

3. 创建 GitHub Release（用本文件作为说明）：

   \`\`\`bash
   gh release create v${version} --title "v${version}" --notes-file ${NOTES_FILE}
   \`\`\`

4. 上传两个 tarball：

   \`\`\`bash
   gh release upload v${version} ${core.tarball} ${cli.tarball}
   \`\`\`

5. （可选）发布到 npm registry——需要凭据，且顺序为**先核心包、再 CLI 包**：

   \`\`\`bash
   npm publish ${core.tarball}
   npm publish ${cli.tarball}
   \`\`\`
`;
}

function main() {
    step('解析参数与产物目录');
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        process.stdout.write('用法：node scripts/release.mjs [--out <dir>]（默认 dist/；只打包，不发布）\n');
        return 0;
    }
    const outDir = path.resolve(REPO_ROOT, opts.out);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    process.stderr.write(`[release] 产物目录: ${outDir}\n`);

    step('① 读取两份 manifest');
    const corePkg = readJson(path.join(CORE_DIR, 'package.json'));
    const cliPkg = readJson(path.join(CLI_DIR, 'package.json'));
    if (!corePkg.name || !corePkg.version) fail(`核心包 manifest 缺 name/version：${path.join(CORE_DIR, 'package.json')}`);
    if (!cliPkg.name || !cliPkg.version) fail(`CLI 包 manifest 缺 name/version：${path.join(CLI_DIR, 'package.json')}`);
    process.stderr.write(`[release] ${corePkg.name}@${corePkg.version} / ${cliPkg.name}@${cliPkg.version}\n`);

    step('② 校验两包版本一致');
    if (String(corePkg.version) !== String(cliPkg.version)) {
        fail(
            `两包版本不一致：${corePkg.name}=${corePkg.version}，${cliPkg.name}=${cliPkg.version}。\n` +
                `        双包发布要求同版本（CLI 的 dependencies 以范围形式引用核心包），请先把两份 package.json 的 version 改成一致再重跑。`
        );
    }

    step('③ 清理上次产物（只清自己生成的同名文件）');
    const removed = cleanOwnArtifacts(outDir, [corePkg.name, cliPkg.name]);
    process.stderr.write(removed.length ? `[release] 已清理: ${removed.join(', ')}\n` : '[release] 无历史产物需清理\n');

    step('④ 打包核心包 + CLI 包');
    const core = packPackage(corePkg.name, CORE_DIR, outDir);
    process.stderr.write(`[release] ${core.tarball}（${core.entryCount} 文件，${human(core.bytes)}）\n`);
    const cli = packPackage(cliPkg.name, CLI_DIR, outDir);
    process.stderr.write(`[release] ${cli.tarball}（${cli.entryCount} 文件，${human(cli.bytes)}）\n`);

    step('⑤ 计算 sha256（SHA256SUMS）');
    const hashes = {
        [core.tarball]: sha256(path.join(outDir, core.tarball)),
        [cli.tarball]: sha256(path.join(outDir, cli.tarball)),
    };
    const sums = [core.tarball, cli.tarball].map((n) => `${hashes[n]}  ${n}`).join('\n');
    fs.writeFileSync(path.join(outDir, SHA_FILE), `${sums}\n`, 'utf8');
    process.stderr.write(`[release]\n${sums}\n`);

    step('⑥ 生成 RELEASE.md');
    const notes = renderNotes({
        version: String(corePkg.version),
        core,
        cli,
        outDir,
        hashes,
        generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
    fs.writeFileSync(path.join(outDir, NOTES_FILE), notes, 'utf8');

    process.stderr.write(
        `\n[release] 完成：${outDir}\n` +
            `[release]   ${core.tarball}\n` +
            `[release]   ${cli.tarball}\n` +
            `[release]   ${SHA_FILE} / ${NOTES_FILE}\n` +
            '[release] 上传/发布请按 RELEASE.md 的步骤人工执行（本脚本不联网、不调用 git/gh）。\n'
    );
    return 0;
}

try {
    process.exitCode = main();
} catch (err) {
    if (err instanceof ReleaseError) {
        process.stderr.write(`\n[release] ✗ ${err.message}\n`);
    } else {
        process.stderr.write(`\n[release] ✗ ${stepName ? `「${stepName}」` : ''}未预期错误：${err?.stack || err}\n`);
    }
    process.exitCode = 1;
}
