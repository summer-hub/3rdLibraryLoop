/**
 * M9-A 契约索引完整性（seams/index.js ↔ 磁盘 seams/*.js）
 *
 * 这一组不看提供方，只保证"契约清单本身没说谎"：
 *
 *   A 磁盘上的每个 `seams/*.js`（index.js 除外）都登记进 `SEAMS`，且 `SEAMS` 里没有
 *     磁盘上不存在的项 —— 多一个、少一个都失败；
 *   B 每个契约文件的具名导出（`*_SEAM`）就是 `SEAMS` 里那个对象（同一个对象），
 *     且其 `name` 与文件名一致 —— 防止"文件叫 x.js、契约 name 写 y"；
 *   C 契约形状自洽（version 是数字、冻结、factory/factoryOptions 匹配、
 *     门面自有方法没被混进提供方契约）；
 *   D 快照输出：把当前接缝清单打印出来，供人工核对与回报引用。
 *
 * 全部动态发现：新增/删除接缝文件不需要改本文件。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSuite, imp, ROOT, shapeViolations } from './lib/conformance.mjs';

const suite = createSuite('M9-A 契约索引完整性');
const { check } = suite;

const seamsDir = path.join(ROOT, 'seams');
const { SEAMS, SEAM_NAMES } = await imp('seams/index.js');

const files = (await fs.readdir(seamsDir))
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .sort();
const diskNames = files.map((f) => f.replace(/\.js$/, '')).sort();
const registered = [...SEAM_NAMES].sort();

// ─── A 磁盘 ↔ SEAMS 双向一一对应 ─────────────────────────────────────────────
check(
    `seams/ 下有 ${diskNames.length} 个契约文件，SEAM_NAMES 有 ${registered.length} 条`,
    diskNames.length === registered.length,
    `磁盘 ${diskNames.join(',')} / 登记 ${registered.join(',')}`
);
const notRegistered = diskNames.filter((n) => !registered.includes(n));
check('磁盘上每个契约文件都登记进 SEAMS（无遗漏）', notRegistered.length === 0, notRegistered.join(',') || '无遗漏');
const notOnDisk = registered.filter((n) => !diskNames.includes(n));
check('SEAMS 里每一条都有对应磁盘文件（无幽灵登记）', notOnDisk.length === 0, notOnDisk.join(',') || '无幽灵项');
check(
    'SEAMS 的键与 SEAM_NAMES 完全一致',
    Object.keys(SEAMS).sort().join(',') === registered.join(','),
    Object.keys(SEAMS).join(',')
);
check('SEAMS / SEAM_NAMES 都被冻结', Object.isFrozen(SEAMS) && Object.isFrozen(SEAM_NAMES));

// ─── B 文件导出 ↔ SEAMS 登记的是同一个对象，且 name 与文件名一致 ──────────────
for (const file of files) {
    const base = file.replace(/\.js$/, '');
    const mod = await import(pathToFileURL(path.join(seamsDir, file)).href);
    const contracts = Object.entries(mod).filter(([k, v]) => k.endsWith('_SEAM') && v && typeof v === 'object');
    check(`${file} 恰好导出一个 *_SEAM 契约`, contracts.length === 1, contracts.map(([k]) => k).join(',') || '无');
    if (contracts.length !== 1) continue;
    const [exportName, contract] = contracts[0];
    check(`${file} 的 ${exportName}.name === '${base}'`, contract.name === base, String(contract.name));
    check(`SEAMS['${base}'] 与 ${file} 导出的是同一个对象`, SEAMS[base] === contract);
}

// ─── C 契约形状自洽 ──────────────────────────────────────────────────────────
for (const name of SEAM_NAMES) {
    const violations = shapeViolations(name, SEAMS[name]);
    for (const v of violations) check(v, false, '契约形状');
    check(
        `契约 ${name} 形状自洽（name/version/冻结/成员声明无冲突）`,
        violations.length === 0,
        violations.length ? `问题 ${violations.length} 处` : `v${String(SEAMS[name].version)}`
    );
}

// ─── D 快照（供人工核对 / 回报引用） ─────────────────────────────────────────
for (const name of SEAM_NAMES) {
    const c = SEAMS[name];
    const shape = c.factory === true ? `factory(${(c.factoryOptions ?? []).join('|')})` : 'class/object';
    const members = [
        ...(c.methods ?? []),
        ...(c.facadeMethods ?? []),
        ...(c.properties ?? []).map((p) => `${p}:prop`),
    ];
    // 一条契约至少要有一处**机器可检验**的声明：产物成员、工厂入参，或（事件型契约）事件名。
    // 三样都没有的契约等于不可验证，属于该清算的形状。
    const verifiable = members.length > 0 || c.factory === true || typeof c.event === 'string';
    check(`快照 ${name}: v${c.version} ${shape} 成员 ${members.length} 项`, verifiable, members.join(',') || '（无产物成员）');
}

suite.finish();
