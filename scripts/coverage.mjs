/**
 * coverage.mjs — 基于 V8 内建覆盖率收集器的覆盖率基线（F-31）
 *
 * 设计取舍：本项目不使用 jest/vitest/c8 等测试框架（测试是零依赖的裸 node 脚本），
 * 因此覆盖率也走零依赖路线：设置 `NODE_V8_COVERAGE=<dir>` 后运行测试套件，
 * Node 会把每个进程的 V8 覆盖率（以字节区间表示）写成 JSON，本脚本再聚合为
 * **按文件的语句/字节覆盖率**。
 *
 * 为什么用字节覆盖率而非行覆盖率：V8 的原生输出就是字节区间，换算成"行"需要
 * 解析 AST 或 sourcemap。字节覆盖率足以回答本阶段唯一关心的问题——
 * **哪些 Server 模块几乎/完全没被测试触达**（这决定了后续补测试的优先级）。
 *
 * 注意：V8 覆盖率只统计**被加载过**的脚本。从未被 import 的文件会以
 * "未被加载"列出（覆盖率视为 0），这正是最有价值的信号。
 *
 * 用法:
 *   node scripts/coverage.mjs                 # 跑全部套件并输出报告
 *   node scripts/coverage.mjs --only=m3       # 只跑 M3 套件
 *   node scripts/coverage.mjs --json          # 额外输出 JSON 摘要
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** 统计范围：只关心 Server 引擎源码（cli/Web/test 不纳入基线） */
const INCLUDE_PREFIX = path.join(ROOT, 'Server');

/** 排除项（按完整路径匹配；用于过滤**文件**，故带路径分隔符） */
const EXCLUDE = [
    `${path.sep}node_modules${path.sep}`,
    `${path.sep}Skills${path.sep}`,
    `${path.sep}vendor${path.sep}`,
    `${path.sep}__tests__${path.sep}`,
];

/**
 * 排除目录（按**目录名**匹配）。
 *
 * ⚠️ 不能复用 EXCLUDE 来过滤目录：目录路径以目录名**结尾**、没有尾部分隔符，
 * `dir.includes('\__tests__\')` 恒为 false。第一版就因此把测试文件误列为
 * "从未被测试加载的源码"，产生了误导性输出。
 */
const EXCLUDED_DIR_NAMES = new Set([
    'node_modules',
    '.git',
    'vendor',
    '__tests__',
    'Skills',
]);

const argOnly = process.argv.find((a) => a.startsWith('--only='));
const ONLY = argOnly ? argOnly.slice('--only='.length) : null;
const WANT_JSON = process.argv.includes('--json');

const SUITES = [
    ['m1', 'test/m1/run-all.mjs'],
    ['m2', 'test/m2/run-all.mjs'],
    ['m3', 'test/m3/run-all.mjs'],
    ['m4', 'test/m4/run-all.mjs'],
    ['unit', 'Server/Agent/SkillSelector/__tests__/test-pure-logic.js'],
].filter(([name]) => !ONLY || name === ONLY);

/** 运行一个套件，带 V8 覆盖率收集 */
function runSuite(script, covDir) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(ROOT, script)], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, NODE_V8_COVERAGE: covDir },
        });
        let out = '';
        child.stdout.on('data', (c) => { out += c.toString(); });
        child.stderr.on('data', (c) => { out += c.toString(); });
        const timer = setTimeout(() => child.kill('SIGKILL'), 900000);
        child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
}

/**
 * 把 V8 覆盖率条目聚合为「文件 → 已覆盖字节数 / 总字节数」。
 *
 * ⚠️ 两条容易搞错的语义（第一版两条都错，导致结果不可复现）：
 *
 * 1. **单个脚本内部**：`functions[].ranges[]` 是**嵌套**的——外层区间覆盖整个函数体
 *    （count = 调用次数），内层区间细化未执行的分支（count = 0）。某字节的归属由
 *    **最内层**包含它的区间决定。V8 保证「父区间在前、子区间在后」，故实现为
 *    **顺序写入、后写胜出（last-wins）**。
 *
 * 2. **跨进程/跨脚本条目之间**：同一个文件会在多个覆盖率文件里出现（每个子进程
 *    各写一份）。此时必须取 **max（逻辑或）**——某进程没执行到，不代表别的进程
 *    没执行到。若沿用 last-wins，后读到的 0 会覆盖先前进程的正数，
 *    而 `fs.readdir` 的顺序是文件系统相关的，于是**同一套件两次运行得到不同数字**
 *    （实测 36.5% vs 50.9%）。这正是"基线必须可复现"的反面教材。
 */
function aggregate(entries) {
    /** @type {Map<string, {counts: Int32Array, seen: Int32Array}>} */
    const perFile = new Map();

    for (const entry of entries) {
        for (const script of entry.result ?? []) {
            const url = script.url || '';
            if (!url.startsWith('file://')) continue;
            let file;
            try {
                file = fileURLToPath(url);
            } catch {
                continue;
            }
            if (!file.startsWith(INCLUDE_PREFIX)) continue;
            if (EXCLUDE.some((x) => file.includes(x))) continue;

            // 先按"单脚本 last-wins"算出本脚本的逐字节 count
            const ranges = [];
            let maxOffset = 0;
            for (const fn of script.functions ?? []) {
                for (const r of fn.ranges ?? []) {
                    const start = r.startOffset ?? 0;
                    const end = r.endOffset ?? 0;
                    if (end <= start) continue;
                    ranges.push({ start, end, count: r.count ?? 0 });
                    if (end > maxOffset) maxOffset = end;
                }
            }
            if (maxOffset === 0) continue;

            const local = new Int32Array(maxOffset).fill(-1);
            for (const r of ranges) {
                for (let i = r.start; i < r.end; i++) {
                    local[i] = r.count;   // 后写胜出：最内层区间决定归属
                }
            }

            // 再按 max 合并进文件维度（跨进程取并集）
            let bucket = perFile.get(file);
            if (!bucket || bucket.counts.length < maxOffset) {
                const counts = new Int32Array(maxOffset);
                const seen = new Int32Array(maxOffset);
                if (bucket) {
                    counts.set(bucket.counts);
                    seen.set(bucket.seen);
                }
                bucket = { counts, seen };
                perFile.set(file, bucket);
            }
            for (let i = 0; i < maxOffset; i++) {
                const v = local[i];
                if (v < 0) continue;
                bucket.seen[i] = 1;
                if (v > bucket.counts[i]) bucket.counts[i] = v;
            }
        }
    }
    return perFile;
}

/** 列出 Server 下所有应纳入统计的源码文件（用于识别"从未被加载"的文件） */
async function listServerSources(dir = path.join(ROOT, 'Server'), acc = []) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (EXCLUDED_DIR_NAMES.has(e.name)) continue;
            await listServerSources(full, acc);
        } else if (/\.(js|mjs|cjs)$/.test(e.name)) {
            acc.push(full);
        }
    }
    return acc;
}

const covDir = await fs.mkdtemp(path.join(os.tmpdir(), 'v8cov-'));
console.log(`══════ 覆盖率基线（V8 coverage）══════\n`);
console.log(`套件: ${SUITES.map(([n]) => n).join(', ')}`);
console.log(`收集目录: ${covDir}\n`);

for (const [name, script] of SUITES) {
    const { code, out } = await runSuite(script, covDir);
    const summary = (out.match(/合计:\s*(\d+) 通过 \/ (\d+) 失败/) || [])
        || (out.match(/共 (\d+) 条断言/) || []);
    const label = summary[0] ? summary[0].trim() : `exit=${code}`;
    console.log(`${code === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(6)} ${label}`);
}

// 聚合 V8 输出
const files = await fs.readdir(covDir);
const entries = [];
for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
        entries.push(JSON.parse(await fs.readFile(path.join(covDir, f), 'utf8')));
    } catch { /* 忽略半写入文件 */ }
}
console.log(`\n读取 ${entries.length} 份 V8 覆盖率文件`);

const perFile = aggregate(entries);
const allSources = await listServerSources();

const rows = [];
for (const file of allSources) {
    const bucket = perFile.get(file);
    let total = 0;
    let covered = 0;
    if (bucket) {
        for (let i = 0; i < bucket.counts.length; i++) {
            if (bucket.seen[i] !== 1) continue; // 未被任何区间覆盖的字节（空白/注释）不计入分母
            total++;
            if (bucket.counts[i] > 0) covered++;
        }
    }
    const loaded = bucket !== undefined;
    const pct = total > 0 ? (covered / total) * 100 : 0;
    rows.push({
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        loaded,
        total,
        covered,
        pct,
    });
}

rows.sort((a, b) => a.pct - b.pct || a.file.localeCompare(b.file));

const loadedRows = rows.filter((r) => r.loaded);
const untouched = rows.filter((r) => !r.loaded);
const totalBytes = loadedRows.reduce((n, r) => n + r.total, 0);
const coveredBytes = loadedRows.reduce((n, r) => n + r.covered, 0);
const overall = totalBytes > 0 ? (coveredBytes / totalBytes) * 100 : 0;

console.log('\n─── 总览 ───');
console.log(`Server 源码文件: ${rows.length}`);
console.log(`  已加载（被测到）: ${loadedRows.length}`);
console.log(`  从未加载:        ${untouched.length}`);
console.log(`已加载文件字节覆盖率: ${overall.toFixed(1)}%  (${coveredBytes}/${totalBytes})`);

console.log('\n─── 覆盖率最低的 15 个「已加载」文件（优先补测）───');
for (const r of loadedRows.slice(0, 15)) {
    console.log(`  ${r.pct.toFixed(1).padStart(5)}%  ${r.file}`);
}

if (untouched.length > 0) {
    console.log(`\n─── 从未被测试加载的 ${untouched.length} 个文件（覆盖率视为 0）───`);
    for (const r of untouched.slice(0, 25)) {
        console.log(`    0.0%  ${r.file}`);
    }
    if (untouched.length > 25) console.log(`    … 另有 ${untouched.length - 25} 个`);
}

if (WANT_JSON) {
    console.log('\n─── JSON 摘要 ───');
    console.log(JSON.stringify({
        overallPercent: Number(overall.toFixed(2)),
        serverFiles: rows.length,
        loadedFiles: loadedRows.length,
        untouchedFiles: untouched.length,
        lowestCovered: loadedRows.slice(0, 15),
        untouched: untouched.map((r) => r.file),
    }, null, 2));
}

try { fsSync.rmSync(covDir, { recursive: true, force: true }); } catch { /* ignore */ }

// 覆盖率基线不作为门禁（本阶段只建立基线并暴露缺口），因此始终返回 0
process.exit(0);
