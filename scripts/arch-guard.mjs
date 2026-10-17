#!/usr/bin/env node
/**
 * arch-guard.mjs — 「一切即插件」三条铁律的机器判定
 *
 * 为什么要有这一层：`core/`（插件内核）、`seams/`（能力契约）、`plugins/`（插件实现）
 * 三者之间的依赖方向是这套架构的全部约束所在，但它只是一段口头约定。靠 code review
 * 记不住、靠 lint 也拦不住（Biome 只管单文件语法级规则）。这里用零依赖的正则扫描
 * 把三条铁律变成可执行的判定，进了 CI 门禁就再也退不回去了：
 *
 *   R1 内核纯净 —— `core/*.js` 只允许 import `node:` 内置与同目录相对路径（`./`）。
 *                  禁止第三方包，禁止向上引用（`../`）。内核是宿主，不能反过来依赖
 *                  任何外部实现，否则「可替换的一切」就有了硬依赖。
 *   R2 插件互斥 —— **npm 依赖允许，仓库内耦合禁止**。
 *
 *                  允许：`node:` 内置、**裸说明符（npm 包，如 `openai`、
 *                  `better-sqlite3`）**、仓库内 `core/`、`seams/`，以及**自身插件
 *                  目录内**的相对路径。
 *                  禁止：跨插件的相对引用（`../other/index.js`）、相对路径伸手进
 *                  `Server/` 等仓库内部实现、绝对路径与 `file:`/`http:` 这类仓库外
 *                  资源。
 *
 *                  为什么允许 npm 包：插件本身就是一个独立包，依赖自己的三方依赖是
 *                  正常且必要的需求（不能用 openai / better-sqlite3 的插件系统只剩
 *                  玩具），Node 解析裸说明符时会从插件目录逐级向上找 node_modules。
 *                  为什么仍禁止仓库内耦合：R2 真正要防的是①两个插件互相牵手——摘掉
 *                  任一插件整个系统就起不来；②插件绕过 `core/`/`seams/` 契约直接
 *                  抓 `Server/` 的内部实现——那会让「一切即插件」退化成一张网。
 *                  一句话：插件可以带自己的行李，但不能共用别人的内脏。
 *
 *                  扫描集合：`plugins/` 下**全部** `.js`（递归，含入口与非入口的内部
 *                  模块）。只扫入口文件不够：插件长大后互相牵手发生在
 *                  `lib/adapter.js` 这类内部模块里，那才是这条规则真正要拦的地方。
 *                  「自身插件目录」按插件根判定（最近的 `plugin.json` → 最近的
 *                  `index.js` → `plugins/` 下一级目录），不是按文件所在目录判定，
 *                  否则内部模块里指回自己入口的 `../index.js` 会被误判成跨插件。
 *   R3 契约不碰实现 —— `seams/*.js` 中所有依赖说明符（`import`、`import()`、
 *                  `require()`、以及 `export ... from` 的再导出）必须匹配 `^\./`：
 *                  只允许同目录兄弟契约模块。禁止 `node:` 内置、第三方包、`../` 向上
 *                  引用。契约是纯常量 + JSDoc 的形状声明，一旦 import 了实现就会与
 *                  实现同生共死，「可替换」也就无从谈起。
 *
 *                  为什么是「只允许 `./`」而不是「一条 import 都不许」：
 *                  `seams/index.js` 是契约 barrel，必须 `./x.js` 聚合 6 个兄弟契约。
 *                  契约聚合不是实现依赖——被引用的仍是同目录的纯契约文件。而 `node:`
 *                  内置、npm 包、`core/`、`plugins/`、`Server/` 里拿来的都是货真价实的
 *                  实现（或平台能力），所以除 `./` 之外的一切说明符一律拦下。
 *                  这样判定既没有文件名白名单（脆弱、会随重构失效），也没有豁免漏洞。
 *                  注意 `export { X } from './x.js'` 会绕过只扫 `import` 的检查，
 *                  因此再导出与 import 同等对待（见 DEP_PATTERNS 的 `from` 分支）。
 *
 * 用法：node scripts/arch-guard.mjs
 * 输出：违规逐条 `R<n> | 相对路径:行号 | 说明`；有违规则退出码 1，无违规则退出码 0
 *       并打印一行汇总。`plugins/` 尚未建立时 R2 打印跳过而非失败（允许先有内核）。
 *
 * 实现取舍：不引入 AST 解析器（本项目零依赖，`npm ci` 只装 Biome）。扫描前先把注释
 * 替换成等长空格（保留换行），因此 JSDoc 里出现的 "import" 字样不会误报，行号也不漂移。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * 把注释内容替换为空格（保留换行符数量），使后续正则只看到真正的代码。
 * 需要跟踪字符串/模板字面量状态，否则字符串里的 `//` 会被当成注释开头。
 */
function stripComments(src) {
    let out = '';
    let state = 'code';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') {
                state = 'line';
                out += '  ';
                i++;
            } else if (c === '/' && d === '*') {
                state = 'block';
                out += '  ';
                i++;
            } else {
                if (c === "'" || c === '"' || c === '`') state = c;
                out += c;
            }
        } else if (state === 'line') {
            if (c === '\n') {
                state = 'code';
                out += c;
            } else out += ' ';
        } else if (state === 'block') {
            if (c === '*' && d === '/') {
                state = 'code';
                out += '  ';
                i++;
            } else out += c === '\n' ? '\n' : ' ';
        } else {
            // 字符串/模板字面量内部：原样保留，处理转义
            if (c === '\\') {
                out += c + (d ?? '');
                i++;
            } else {
                if (c === state) state = 'code';
                out += c;
            }
        }
    }
    return out;
}

// 依赖说明符：静态 import/export-from、副作用 import、动态 import()、require()。
// `(?<!\.)\bfrom\b` 排除 `Array.from('x')` 这类方法调用被误判成 re-export。
const DEP_PATTERNS = [
    /(?<!\.)\bfrom\b\s*(['"])([^'"\n]+)\1/g,
    /\bimport\b\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g,
];

/** 提取一个文件里所有依赖说明符（含行号），已剔除注释。 */
function scanDeps(text) {
    const code = stripComments(text);
    const found = new Map(); // spec -> 首次出现的行号
    for (const re of DEP_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(code)) !== null) {
            const spec = m[2];
            if (found.has(spec)) continue;
            const line = code.slice(0, m.index).split('\n').length;
            found.set(spec, line);
        }
    }
    return [...found].map(([spec, line]) => ({ spec, line }));
}

function rel(abs) {
    return path.relative(ROOT, abs).split(path.sep).join('/');
}

function listJsFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.js'))
        .map((e) => path.join(dir, e.name))
        .sort();
}

/**
 * 递归收集 plugins/ 下**全部** .js 文件，跳过 node_modules 与点目录。
 *
 * 为什么不是只收 `index.js`：插件入口只是插件的第一个文件。真实插件会长出
 * `plugins/cli/opencode/lib/adapter.js`、`plugins/storage/sqlite/adapters/Foo.js`
 * 这类内部模块，而「插件互相牵手」恰恰最容易在这里发生——只扫入口等于留了个后门。
 */
function listPluginFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    const walk = (cur) => {
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
                walk(path.join(cur, e.name));
            } else if (e.name.endsWith('.js')) {
                out.push(path.join(cur, e.name));
            }
        }
    };
    walk(dir);
    return out.sort();
}

const violations = [];
function report(rule, file, line, message) {
    violations.push(`${rule} | ${rel(file)}:${line} | ${message}`);
}

/** 相对说明符解析成绝对路径，用于判断它落在仓库的哪个区域。 */
function resolveSpec(file, spec) {
    return path.resolve(path.dirname(file), spec);
}

function isUnder(child, parent) {
    const r = path.relative(parent, child);
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

// ── R1 内核纯净 ──
const coreFiles = listJsFiles(path.join(ROOT, 'core'));
for (const file of coreFiles) {
    for (const { spec, line } of scanDeps(fs.readFileSync(file, 'utf8'))) {
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('./')) continue;
        if (spec.startsWith('../')) {
            report('R1', file, line, `内核不得向上引用（../）：${spec}`);
            continue;
        }
        report('R1', file, line, `内核只允许 node: 内置与同目录相对路径，发现外部依赖：${spec}`);
    }
}

// ── R2 插件互斥 ──
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const pluginsExist = fs.existsSync(PLUGINS_DIR);

/**
 * 文件所属的**插件根**（取由近及远第一个命中）。
 *   1. 最近的含 `plugin.json` 的祖先 —— 清单是内核认的插件标识（core/PluginLoader.scanPluginRoots）；
 *   2. 最近的含 `index.js` 的祖先 —— 清单尚未补上时用入口文件兜底；
 *   3. `plugins/` 下一级目录 —— 两者都没有，按最粗粒度归属（宁可少判，不误判）。
 *
 * 「自身目录」必须按插件根而不是文件所在目录判定：否则
 * `plugins/cli/opencode/lib/adapter.js` 里的 `../index.js`（指回自己的插件入口）
 * 会被误判成跨插件引用。
 */
const pluginRootCache = new Map();
function pluginRootOf(file) {
    const cached = pluginRootCache.get(file);
    if (cached !== undefined) return cached;
    const chain = []; // 由近及远的祖先目录链（不含 PLUGINS_DIR 本身）
    for (let dir = path.dirname(file); dir !== PLUGINS_DIR && isUnder(dir, PLUGINS_DIR); dir = path.dirname(dir)) {
        chain.push(dir);
    }
    const root =
        chain.find((d) => fs.existsSync(path.join(d, 'plugin.json'))) ??
        chain.find((d) => fs.existsSync(path.join(d, 'index.js'))) ??
        chain[chain.length - 1] ??
        PLUGINS_DIR; // 直接躺在 plugins/ 根下的游离文件：归属整个插件根，按"非本插件"处理
    pluginRootCache.set(file, root);
    return root;
}

const pluginFiles = listPluginFiles(PLUGINS_DIR);
const pluginRoots = new Set();
for (const file of pluginFiles) {
    const ownRoot = pluginRootOf(file);
    pluginRoots.add(ownRoot);
    for (const { spec, line } of scanDeps(fs.readFileSync(file, 'utf8'))) {
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('/') || /^[a-zA-Z]+:/.test(spec)) {
            report('R2', file, line, `插件不得引用仓库外资源：${spec}`);
            continue;
        }
        if (!spec.startsWith('.')) {
            // 裸说明符 = npm 包：插件本身就是独立包，依赖自己的三方包是正常需求
            // （openai / better-sqlite3），Node 会从插件目录向上找 node_modules。
            continue;
        }
        const target = resolveSpec(file, spec);
        if (ownRoot !== PLUGINS_DIR && isUnder(target, ownRoot)) continue;
        if (isUnder(target, path.join(ROOT, 'core')) || isUnder(target, path.join(ROOT, 'seams'))) continue;
        if (isUnder(target, path.join(ROOT, 'Server'))) {
            report('R2', file, line, `插件不得引用 Server/ 内部实现：${spec}`);
            continue;
        }
        if (isUnder(target, PLUGINS_DIR)) {
            const otherRoot = pluginRootOf(target);
            const other = path.relative(PLUGINS_DIR, otherRoot ?? target).split(path.sep).join('/');
            report('R2', file, line, `插件不得互相引用（指向其他插件 ${other || 'plugins/ 根目录'}/）：${spec}`);
            continue;
        }
        report('R2', file, line, `插件只允许 node: 内置 / npm 包 / core/ / seams/ / 自身插件目录：${spec}`);
    }
}

// ── R3 契约不碰实现 ──
const seamFiles = listJsFiles(path.join(ROOT, 'seams'));
for (const file of seamFiles) {
    for (const { spec, line } of scanDeps(fs.readFileSync(file, 'utf8'))) {
        if (spec.startsWith('./')) continue;
        if (spec.startsWith('../')) {
            report('R3', file, line, `契约不得向上引用实现（../）：${spec}`);
            continue;
        }
        report('R3', file, line, `契约只允许引用同目录兄弟契约（./），发现实现依赖：${spec}`);
    }
}

const scanned = coreFiles.length + pluginFiles.length + seamFiles.length;

if (violations.length > 0) {
    for (const v of violations) console.error(v);
    console.error(`arch-guard: 发现 ${violations.length} 处架构违规`);
    process.exit(1);
}

const pluginNote = pluginsExist
    ? `plugins/ 扫描 ${pluginFiles.length} 个文件 / ${pluginRoots.size} 个插件`
    : 'plugins/ 不存在已跳过';
console.log(`arch-guard: R1/R2/R3 通过（扫描 ${scanned} 个文件，${pluginNote}）`);
