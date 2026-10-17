/**
 * f50 — 技术债守卫：`cstTime` 单实现 + `logger` 单实例 + 两类有状态副本的字节同源
 *
 * ── cstTime 已从「多份副本 + 行为比对」收敛为「内核一份 + 单实现断言」────────────
 * 历史：`nowCST()`（16 行无状态纯函数）曾以 5 份插件内副本存在（storage/core、
 * cli/opencode、engines/{knowledge,brain,testcheck}），A 组当时的职责是"同一组时间戳
 * 喂给每一份副本，输出必须逐字节相等"。那道守卫能覆盖的只有"语义漂移"一种故障，
 * 却要随副本数线性增加比对路径，而且**新增副本不会让它变红**（它按显式登记路径比对）。
 *
 * 收敛动作：实现归一到内核 `core/cstTime.js`，5 份副本全部删除，消费者改为
 * `import { nowCST } from '<上溯 n 层>/core/cstTime.js'`。合法性来自架构守卫本身——
 * R1 要求 `core/*.js` 只 import `node:` 或同目录 `./`（`nowCST` 只用 `Date`，一条
 * import 都没有），R2 允许**插件**引用 `core/`。所以「内核提供一个纯函数原语」
 * 一次性消掉全部副本，比继续加副本、或为 16 行代码立一条接缝（插件目录 + 清单 +
 * 拓扑依赖 + 加载失败路径 + 每次调用经 `ctx.inject`）都便宜。
 *
 * 守卫随之改为**单实现断言**（A 组）：
 *   ① 内核原语存在：`nowCST` 是函数，且 `default` 就是它；
 *   ② 14 组边界时间戳对**冻结的期望字符串**逐字相等（行为回归，不再与副本互比）；
 *   ③ `plugins/` 下不再存在任何 `cstTime.js` ——把"以后又有人复制一份"变成会报红的规则；
 *   ④ 插件里每一处 `cstTime.js` 的 import 说明符都指向 `core/cstTime.js`。
 * B 组盯门面：`Server/library/cstTime.js` 与 `core/cstTime.js` 必须是**同一个函数对象**
 * （`export *` 再导出，不是第二份实现），`core/index.js` 透出的也是同一个。
 *
 * ── 为什么 logger 必须接缝（不能也留给副本） ─────────────────────────────────
 * `createLogger` 背后是**模块级可变状态 + 进程级资源**：一个 `fs.WriteStream`
 * （`flags: 'a'` 追加 `db/log/app-YYYY-MM-DD.log`）、`_streamDate`（按天轮转）、
 * 以及 `LOG_RETENTION_DAYS` 保留期清理（扫描同目录删过期文件）。
 * 历史上 `Server/Routes/library/logger.js` 与 `plugins/cli/opencode/lib/logger.js`
 * 各是一份完整实现（差异只有 `DB_ROOT` 上溯层数），于是同一个文件被**两个流**追加：
 *   - 两个流各自缓冲/各自 flush，行序不可预测；
 *   - 跨零点时两套轮转各自关流重建，一方还在写旧流；
 *   - 两套清理互相删掉对方正在写的文件。
 * 这类故障**无法用"输出比对"覆盖**（副本实现可能逐字节相同，故障来自资源份数），
 * 只能靠"根本只有一份实现"来消除。而"只有一份"必须由**接缝**保证：
 * 插件之间不能互相 import（R2），副本无法靠 `export *` 合流。
 * ── 为什么 AtomicJsonFile 也用「字节比对」而不是接缝（E 组） ────────────────
 * `AtomicJsonFile`（`plugins/storage/core/lib` 与 `plugins/stats/core/lib` 各一份）
 * 是带**进程内锁状态**的通用写工具：`_chains` 是按路径的 Promise 链（per-path 串行化）。
 * 它和 logger 同为"有跨实例状态"，却和 logger 走了不同处置，原因是**状态的作用域**：
 *   - logger 的 `_stream` 指向**同一个文件**，两份副本必然互踩 → 必须单实例；
 *   - `_chains` 是**按路径**的锁，today 两份只锁各自的文件（stats 只碰
 *     `visit-stats.json`），所以今天不会互踩，风险只剩"代码静默分叉"。
 * 而接缝化会立刻制造新问题：把锁实现注册成一个共享服务，等于让 `storage` 与
 * `stats` 两个插件通过一条接缝**隐式耦合**（一个插件的锁实现升级会改变另一个插件的
 * 并发语义），且 R2 已经开始被绕过。当前取舍：**保留副本 + 字节守卫**，把"改一份忘
 * 另一份"从"并发下偶发"降级为"提交前必红"。
 * 注意字节守卫只比对**实现体**（剥掉文件头来源说明段），否则"副本来源说明"这种
 * 无害差异会让守卫长期假红。
 *
 * ── 剩下两类副本的统一判据：有没有跨实例状态 ────────────────────────────────
 *   - `AtomicJsonFile`（有状态，但状态作用域不重叠）→ **字节**守卫：实现体逐字符
 *     相同，把差异压到"实现体分叉"这一种；
 *   - `logger`（有状态，且状态指向同一个资源）→ **实例**守卫：必须是同一个模块实例
 *     （`===`），把差异压到零。
 * 一句话：状态越"共享资源"，守卫就要越靠前（字节 → 实例）。
 * `cstTime` 已退出这个坐标系：无状态 → 直接消除副本（单实现），不再需要"行为等价"。
 *
 * 所以：实现进 `plugins/util/logger`（`app-logger` 接缝的提供方），
 * `Server/Routes/library/logger.js` 改成**转发门面**（`export *` → 同一个模块实例），
 * `plugins/cli/opencode/lib/logger.js` 降级为**无状态委托壳**（`setLoggerImpl`）。
 * 本文件 C/D 组盯着这条链没有断回副本。
 *
 * 写入流的实证（"只有一个流写同一个文件"）不在本文件里做：那需要真实文件系统落点，
 * 而实现的 `DB_ROOT` 是相对 `import.meta.url` 的固定推导。用临时镜像目录做的
 * 单流探针见交付说明（`fs.createWriteStream` 调用计数 = 1）。本文件通过
 * `LOG_FILE_ENABLED=false` 保证**一次文件写入都不会发生**，不会污染真实 `db/log`。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSuite, ROOT } from './helpers.mjs';

// 必须在 **import 任何 logger 模块之前**生效（`FILE_ENABLED` 在模块加载期求值）：
// 本测试只做模块图与对象身份断言，不允许任何一行日志落到真实 db/log。
process.env.LOG_FILE_ENABLED = 'false';

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const suite = createSuite('f50 util 副本漂移守卫 · logger 单实例');

// ─── A cstTime 单实现：内核一份，插件零副本 ─────────────────────────────────
const coreCst = await imp('core/cstTime.js');

suite.check(
    'A core/cstTime.js 存在且 nowCST 是函数（纯函数原语在内核）',
    typeof coreCst.nowCST === 'function'
);
suite.check(
    'A core/cstTime.js 的 default 就是同一个 nowCST',
    coreCst.default === coreCst.nowCST
);

/**
 * 覆盖 0 / 负值 / 闰年 / 月末 / 跨年 / DST 边界 / 32 位时间戳上限。
 * 第 3 列是**冻结的期望输出**（迁移前 5 份副本逐字节同一份实现产出的值）：
 * 行为回归不再是"两份副本互比"，而是与这份字面量比。
 */
const CASES = [
    ['epoch 0', 0, '1970-01-01T08:00:00+08:00'],
    ['负值 -1ms', -1, '1970-01-01T07:59:59+08:00'],
    ['负值 -1 天（1969-12-31）', -86400000, '1969-12-31T08:00:00+08:00'],
    // 1900 年上海尚未启用标准时区（LMT +08:05:43），这是真实行为，冻结它防止被"顺手修正"
    ['1900-01-01', -2208988800000, '1900-01-01T08:05:43+08:00'],
    ['闰年 2024-02-29', Date.parse('2024-02-29T12:00:00.000Z'), '2024-02-29T20:00:00+08:00'],
    ['非闰年 2026-02-28', Date.parse('2026-02-28T12:00:00.000Z'), '2026-02-28T20:00:00+08:00'],
    ['月末跨日（CST 进 3/1）', Date.parse('2026-02-28T16:00:00.000Z'), '2026-03-01T00:00:00+08:00'],
    ['美东 DST 开始前 1s', Date.parse('2026-03-08T09:59:59.000Z'), '2026-03-08T17:59:59+08:00'],
    ['美东 DST 开始瞬间', Date.parse('2026-03-08T10:00:00.000Z'), '2026-03-08T18:00:00+08:00'],
    ['美东 DST 结束瞬间', Date.parse('2026-11-01T06:00:00.000Z'), '2026-11-01T14:00:00+08:00'],
    ['UTC 跨年（CST 次日）', Date.parse('2026-12-31T16:00:00.000Z'), '2027-01-01T00:00:00+08:00'],
    ['32 位上限 2038', 2147483647000, '2038-01-19T11:14:07+08:00'],
    ['Date 对象入参', new Date('2026-07-27T07:12:08.774Z'), '2026-07-27T15:12:08+08:00'],
    ['ISO 字符串入参', '2026-07-27T07:12:08.774Z', '2026-07-27T15:12:08+08:00'],
];

for (const [label, input, expected] of CASES) {
    const actual = coreCst.nowCST(input);
    suite.check(
        `A nowCST 行为与冻结期望一致：${label}`,
        actual === expected,
        actual === expected ? actual : `实际=${actual} 期望=${expected}`
    );
}

/** 递归枚举目录下所有文件，返回 `{ abs, rel }`（跳过 node_modules 与点目录）。 */
async function walkFiles(dir) {
    const out = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...(await walkFiles(path.join(dir, entry.name))));
        } else {
            const abs = path.join(dir, entry.name);
            out.push({ abs, rel: path.relative(ROOT, abs).split(path.sep).join('/') });
        }
    }
    return out;
}

const pluginFiles = await walkFiles(path.join(ROOT, 'plugins'));
const pluginJs = pluginFiles.filter((f) => f.rel.endsWith('.js'));

// ③ 「以后又有人复制一份」必须是会报红的规则，而不是靠显式登记路径
const cstCopies = pluginFiles.filter((f) => path.basename(f.rel) === 'cstTime.js').map((f) => f.rel);
suite.check(
    'A plugins/ 下不再存在任何 cstTime.js 副本（fs 全量扫描 = 0）',
    cstCopies.length === 0,
    cstCopies.length === 0 ? `扫描 ${pluginJs.length} 个 .js` : `副本回来了：${cstCopies.join(', ')}`
);
suite.check(
    'A 扫描本身有牙（递归到深层目录且枚举到全部插件 .js，0 不是扫描失效的结果）',
    pluginJs.length > 30 && pluginJs.some((f) => f.rel === 'plugins/storage/core/lib/AtomicJsonFile.js'),
    `实际枚举 ${pluginJs.length} 个 .js`
);

// 迁移前的 5 个副本路径（逐个点名，报错时不必再猜是哪一份）
const FORMER_COPIES = [
    'plugins/storage/core/lib/cstTime.js',
    'plugins/cli/opencode/lib/cstTime.js',
    'plugins/engines/knowledge/lib/cstTime.js',
    'plugins/engines/brain/lib/cstTime.js',
    'plugins/engines/testcheck/lib/cstTime.js',
];
const stillThere = [];
for (const rel of FORMER_COPIES) {
    const hit = await fs.access(path.join(ROOT, rel)).then(() => true, () => false);
    if (hit) stillThere.push(rel);
}
suite.check(
    `A 迁移前的 ${FORMER_COPIES.length} 个插件内副本文件均已删除`,
    stillThere.length === 0,
    stillThere.length === 0
        ? FORMER_COPIES.map((p) => p.replace('/lib/cstTime.js', '')).join(', ')
        : stillThere.join(', ')
);

// ④ 插件里的 cstTime 依赖只能来自内核
const cstImportSpecs = [];
for (const f of pluginJs) {
    const src = await fs.readFile(f.abs, 'utf8');
    if (!/\bcstTime\.js\b/.test(src)) continue;
    for (const m of src.matchAll(/from\s+['"]([^'"\n]*cstTime\.js)['"]/g)) {
        cstImportSpecs.push({ rel: f.rel, spec: m[1] });
    }
}
const badSpecs = cstImportSpecs.filter((s) => !s.spec.endsWith('/core/cstTime.js'));
const consumerFiles = [...new Set(cstImportSpecs.map((s) => s.rel))].sort();
suite.check(
    'A 插件里所有 cstTime.js 的 import 说明符都指向 core/cstTime.js',
    cstImportSpecs.length > 0 && badSpecs.length === 0,
    badSpecs.length === 0
        ? `${cstImportSpecs.length} 处引用 / ${consumerFiles.length} 个消费者`
        : badSpecs.map((s) => `${s.rel} → ${s.spec}`).join(', ')
);
suite.check(
    'A 5 个插件（≥7 个消费者文件）都真的改指内核了',
    // 不锁死具体文件数：新增插件/文件时消费者只会变多。真正的约束是「每个曾经的副本
    // 所属插件目录都必须仍有消费者」，否则说明有人把某处悄悄改回了 private 副本。
    consumerFiles.length >= 7 &&
        FORMER_COPIES.every((p) => {
            const root = p.replace('/lib/cstTime.js', '/');
            return consumerFiles.some((c) => c.startsWith(root));
        }),
    consumerFiles.join(', ')
);

// ─── B Server 侧门面与内核是同一函数对象 ────────────────────────────────────
const serverCst = await imp('Server/library/cstTime.js');
const coreBarrel = await imp('core/index.js');
suite.check(
    'B Server/library/cstTime.js 的 nowCST 与 core/cstTime.js 是同一函数对象',
    serverCst.nowCST === coreCst.nowCST
);
suite.check(
    'B Server/library/cstTime.js 的 default 与 core/cstTime.js 的 default 同一',
    serverCst.default === coreCst.default
);
suite.check(
    'B core/index.js 透出的 nowCST 与 core/cstTime.js 是同一函数对象',
    coreBarrel.nowCST === coreCst.nowCST
);

// ─── C logger 单实例 ────────────────────────────────────────────────────────
const impl = await imp('plugins/util/logger/logger.js');
const facade = await imp('Server/Routes/library/logger.js');
const pluginEntry = await imp('plugins/util/logger/index.js');
const shell = await imp('plugins/cli/opencode/lib/logger.js');

suite.check(
    'C 门面 default 与插件实现 default 通过 === 相同（没有第二份实现）',
    facade.default === impl.default
);
suite.check(
    'C 门面 createLogger 与插件实现 createLogger 同一函数对象',
    facade.createLogger === impl.createLogger
);
suite.check(
    'C 插件入口 export * 透出的是同一个 createLogger',
    pluginEntry.createLogger === impl.createLogger
);

const unbound = await suite.throws(() => shell.createLogger('Probe'));
suite.check(
    'C 委托壳未接线时 fail closed 并给出明确文案',
    unbound !== null && unbound.msg.includes('app-logger') && unbound.msg.includes('setLoggerImpl'),
    unbound ? unbound.msg.slice(0, 72) + '…' : '未抛错'
);

let observed = null;
const prev = shell.setLoggerImpl((options) => {
    observed = options;
    return impl.createLogger(options.tag);
});
suite.check('C setLoggerImpl 返回接线前的实现（首次为 null）', prev === null);
const logger = shell.createLogger('Probe', { extra: 1 });
suite.check(
    'C 委托壳把调用整理成接缝工厂入参 {tag, ...opts}',
    observed?.tag === 'Probe' && observed?.extra === 1 && typeof logger.info === 'function',
    JSON.stringify(observed)
);
logger.debug('f50 探针：LOG_FILE_ENABLED=false，不写文件');

// 插件 setup 的形状：provide('app-logger', factory)，工厂产物有 4 个方法
const provided = {};
pluginEntry.default.setup({
    name: 'util/logger',
    config: {},
    provide: (name, service) => {
        provided[name] = service;
    },
    inject: () => {
        throw new Error('util/logger 不应 inject 任何服务');
    },
    addDisposer: () => {},
});
suite.check(
    'C 插件清单/定义声明 app-logger 接缝',
    pluginEntry.default.seam === 'app-logger' && pluginEntry.default.name === 'util/logger'
);
suite.check(
    'C setup 注册 app-logger 工厂函数',
    typeof provided['app-logger'] === 'function'
);
const produced = provided['app-logger']({ tag: 'FromSeam' });
suite.check(
    'C 工厂产物实现 debug/info/warn/error 四个方法',
    ['debug', 'info', 'warn', 'error'].every((m) => typeof produced[m] === 'function')
);

// ─── D 接线回归：依赖声明 / profile 条目 / 副本不许回来 ──────────────────────
const readJson = async (rel) => JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8'));
const opencodeManifest = await readJson('plugins/cli/opencode/plugin.json');
suite.check(
    'D cli/opencode 清单声明依赖 util/logger',
    opencodeManifest.dependencies.includes('util/logger')
);

for (const profile of ['profiles/default.json', 'profiles/mock-llm.json']) {
    const plugins = (await readJson(profile)).plugins;
    suite.check(
        `D ${profile} 启用 util/logger`,
        plugins['util/logger']?.enabled === true
    );
}

const seams = await imp('seams/index.js');
suite.check(
    'D seams 登记 app-logger（SEAMS 与 SEAM_NAMES 同源）',
    seams.SEAMS['app-logger']?.name === 'app-logger' && seams.SEAM_NAMES.includes('app-logger')
);

const shellSource = await fs.readFile(path.join(ROOT, 'plugins/cli/opencode/lib/logger.js'), 'utf8');
suite.check(
    'D 委托壳不含文件写入实现（无 node:fs / createWriteStream）',
    !/from\s+['"]node:fs['"]/.test(shellSource) && !shellSource.includes('createWriteStream')
);

const implSource = await fs.readFile(path.join(ROOT, 'plugins/util/logger/logger.js'), 'utf8');
suite.check(
    'D 唯一实现仍持有模块级写入流与轮转/清理（未退化成空壳）',
    implSource.includes("let _stream = null") &&
        implSource.includes('createWriteStream') &&
        implSource.includes('_cleanupOldLogs') &&
        implSource.includes("flags: 'a'")
);

// ─── E AtomicJsonFile 副本漂移守卫（字节比对实现体）──────────────────────────
/**
 * 剥掉文件头的块注释（副本"来源说明"那一段），只留实现体。
 * 返回 { lines, firstKeptLineNo }：firstKeptLineNo 是被保留的第一行在**原始文件**里的
 * 行号（1 起），用于把实现体差异换算回"你在文件第几行能看到它"。
 */
function stripHeaderComment(text) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => l.trimStart().startsWith('/**'));
    let kept = 0;
    if (start !== -1) {
        const end = lines.findIndex((l, i) => i > start && l.trimEnd().endsWith('*/'));
        if (end !== -1) kept = end + 1;
    }
    return { lines: lines.slice(kept), firstKeptLineNo: kept + 1 };
}

/** 首个差异 + 差异总数；无差异返回 null。行号换算回原始文件（含文件头）。 */
function bodyDiff(aText, bText) {
    const a = stripHeaderComment(aText);
    const b = stripHeaderComment(bText);
    const n = Math.max(a.lines.length, b.lines.length);
    const diffs = [];
    for (let i = 0; i < n; i++) {
        if ((a.lines[i] ?? '') !== (b.lines[i] ?? '')) {
            diffs.push({ i, aNo: a.firstKeptLineNo + i, bNo: b.firstKeptLineNo + i });
        }
    }
    if (diffs.length === 0) return null;
    const first = diffs[0];
    return {
        count: diffs.length,
        detail:
            `实现体 ${diffs.length} 行不同，首个在 storage 第 ${first.aNo} 行 / stats 第 ${first.bNo} 行：` +
            `storage=${JSON.stringify((a.lines[first.i] ?? '').trim())} ≠ ` +
            `stats=${JSON.stringify((b.lines[first.i] ?? '').trim())}`,
    };
}

const AJF = 'plugins/storage/core/lib/AtomicJsonFile.js';
const AJF_STATS = 'plugins/stats/core/lib/AtomicJsonFile.js';
const AJF_KNOWLEDGE = 'plugins/engines/knowledge/lib/AtomicJsonFile.js';
const ajfText = await fs.readFile(path.join(ROOT, AJF), 'utf8');
const ajfStatsText = await fs.readFile(path.join(ROOT, AJF_STATS), 'utf8');
const ajfKnowledgeText = await fs.readFile(path.join(ROOT, AJF_KNOWLEDGE), 'utf8');
const ajfDiff = bodyDiff(ajfText, ajfStatsText);
suite.check(
    `E AtomicJsonFile 两份副本实现体逐字符一致（${AJF} ↔ ${AJF_STATS}）`,
    ajfDiff === null,
    ajfDiff?.detail ?? ''
);
const ajfKnowledgeDiff = bodyDiff(ajfText, ajfKnowledgeText);
suite.check(
    `E AtomicJsonFile 第 3 份副本实现体逐字符一致（${AJF} ↔ ${AJF_KNOWLEDGE}）`,
    ajfKnowledgeDiff === null,
    ajfKnowledgeDiff?.detail ?? ''
);

const ajf = await imp(AJF);
const ajfStats = await imp(AJF_STATS);
const names = (m) => Object.keys(m).sort();
const missing = names(ajf).filter((k) => !names(ajfStats).includes(k));
const extra = names(ajfStats).filter((k) => !names(ajf).includes(k));
const EXPECTED_AJF_EXPORTS = [
    '_resetChains',
    'default',
    'readJson',
    'renameWithRetry',
    'updateJson',
    'withSerializedLock',
    'writeJsonAtomic',
];
suite.check(
    'E AtomicJsonFile 两份导出的函数名集合一致且覆盖契约导出面',
    missing.length === 0 &&
        extra.length === 0 &&
        EXPECTED_AJF_EXPORTS.every((k) => names(ajf).includes(k)),
    missing.length || extra.length
        ? `storage 缺 [${missing.join(', ')}] / stats 多 [${extra.join(', ')}]`
        : `实际导出：${names(ajf).join(', ')}`
);
suite.check(
    'E 比对的是真实实现体（不是两个空壳/门面）',
    ajfText.includes('const _chains = new Map()') &&
        ajfStatsText.includes('const _chains = new Map()') &&
        stripHeaderComment(ajfText).lines.length > 100
);

// ─── F BoundedRegistry 副本漂移守卫（字节比对实现体）────────────────────────
// 它是**每实例状态**的纯容器（`_map`/`_order` 按实例隔离），不像 AtomicJsonFile 的
// `_chains` 或 logger 的 `_stream` 指向共享资源 —— 所以判据是"字节一致"（代码分叉才是风险）。
const BR = 'Server/library/BoundedRegistry.js';
const BR_BRAIN = 'plugins/engines/brain/lib/BoundedRegistry.js';
const brText = await fs.readFile(path.join(ROOT, BR), 'utf8');
const brBrainText = await fs.readFile(path.join(ROOT, BR_BRAIN), 'utf8');
const brDiff = bodyDiff(brText, brBrainText);
suite.check(
    `F BoundedRegistry 副本实现体逐字符一致（${BR} ↔ ${BR_BRAIN}）`,
    brDiff === null,
    brDiff?.detail ?? ''
);
const br = await imp(BR);
const brBrain = await imp(BR_BRAIN);
suite.check(
    'F BoundedRegistry 两份导出名集合一致',
    JSON.stringify(names(br)) === JSON.stringify(names(brBrain)),
    `Server=[${names(br).join(', ')}] / brain=[${names(brBrain).join(', ')}]`
);
suite.check(
    'F BoundedRegistry 比对的是真实实现体（不是空壳/门面）',
    brText.includes('class BoundedRegistry') &&
        brBrainText.includes('class BoundedRegistry') &&
        stripHeaderComment(brText).lines.length > 200
);

// ─── G AbortTree / SessionWaiter 副本漂移守卫（字节比对实现体）──────────────
// 二者状态全是**每实例**的（AbortTree 按编排器隔离；SessionWaiter 每次等待 new，
// 持 #deadline/#pollCount/取消监听），没有指向共享资源的状态，也没有"第二家提供方"
// 语义 —— 所以判据与 BoundedRegistry 相同：字节一致（静默分叉才是风险）。
const STATEFUL_COPIES = [
    ['Server/library/AbortTree.js', 'plugins/engines/orchestrator/lib/AbortTree.js'],
    ['Server/library/SessionWaiter.js', 'plugins/engines/orchestrator/lib/SessionWaiter.js'],
];
for (const [srcRel, copyRel] of STATEFUL_COPIES) {
    const srcText = await fs.readFile(path.join(ROOT, srcRel), 'utf8');
    const copyText = await fs.readFile(path.join(ROOT, copyRel), 'utf8');
    const base = path.basename(srcRel);
    // 判据：副本必须是「源文件全文 + 前面一段说明头」。用 indexOf 而不是剥注释块——
    // 剥第一块 `/** */` 对头部结构不同的文件会错位（Server 版首块可能是文件级 docblock，
    // 而副本首块是自己的说明），从而制造假红。
    const idx = copyText.indexOf(srcText);
    suite.check(
        `G ${base} 副本 = 「说明头 + 与源文件逐字节相同的实现」`,
        idx >= 0,
        idx >= 0
            ? `说明头 ${idx} 字符，其后 ${srcText.length} 字符与源文件逐字节相同`
            : `副本里找不到源文件全文 ⇒ 实现体已漂移（改一份必须同步另一份）`
    );
    const srcMod = await imp(srcRel);
    const copyMod = await imp(copyRel);
    suite.check(
        `G ${base} 两份导出名集合一致`,
        JSON.stringify(names(srcMod)) === JSON.stringify(names(copyMod)),
        `src=[${names(srcMod).join(', ')}] / copy=[${names(copyMod).join(', ')}]`
    );
    suite.check(
        `G ${base} 比对的是真实实现体（不是空壳/门面）`,
        srcText.split(/\r?\n/).length > 200 && !/\bimport\s/.test(srcText)
    );
}

suite.finish();
