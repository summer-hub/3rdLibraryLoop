#!/usr/bin/env node
/**
 * verify-deps.mjs —— 校验依赖声明与引擎/插件代码一致（R2，三模式）
 *
 * 作用：
 *   - 扫描随包发布的源码中所有 import 的裸模块包名
 *     （扫描前先剥注释：注释里写的 import 示例不计为依赖，见 stripComments）
 *   - 与**对应 manifest** 的 dependencies 比对，缺失则报错并列出「文件:行 说明符」
 *   - 防止发布后代码 import 的依赖未声明导致运行时 ESM Module not found
 *
 * 双包发布形态：`@ohos-cpf/3rdloop_core`（核心树）+ `@ohos-cpf/3rdloop`（CLI）。
 * 核心树的依赖归核心包，CLI 自身代码的依赖归 CLI 包；两棵树的 manifest 不可混用。
 *
 * 三种模式（按可靠性排序，命中即停）：
 *   ① installed：`node_modules/@ohos-cpf/3rdloop_core` 已安装（双包发布态正路）
 *      核心树 → `node_modules/@ohos-cpf/3rdloop_core/{Server,MCP/src,Archive/src,plugins,core,seams,profiles}`
 *      比对**核心包自己的 package.json**；CLI 代码（cli/{lib,bin,workflows}）比对 cli/package.json。
 *   ② vendor：`cli/vendor/Server` 存在（prepack 产物 / 单包回退）
 *      vendor 是**核心树的副本**，依赖归核心包：依次取「已装核心包 manifest → 仓库根 package.json
 *      → cli/package.json（遗留单包形态）」，取第一个存在的作为核对口径；CLI 代码照旧比对 cli 包。
 *   ③ repo：仓库源码（`Server/` 存在）
 *      核心树（仓库根 {Server,MCP/src,Archive/src,plugins,core,seams,profiles}）比对
 *      **仓库根 package.json（= 核心包 manifest）**；CLI 代码比对 cli/package.json。
 *
 * 关于「同一依赖同时出现在两个包」：`dotenv` 是唯一一处——
 * 核心树的 `Server/composition/envBootstrap.js` 与 CLI 的 `cli/lib/config.js` 各自
 * **直接 import** 它，任何一方缺声明都会在自己的运行路径上失败，因此两个 manifest 都必须声明。
 * 交叉验证口径正是上面两组扫描：核心树组只认核心包 manifest，CLI 代码组只认 cli manifest，
 * 互不顶替——漏在任一包里都会被这一组扫出来。
 *
 * 目录动态扫描：插件按目录发现，不硬编码插件名；目录不存在/为空时给出提示并跳过。
 *
 * 触发时机：npm run verify-deps（发布前 CI / prepublish 自动检查）
 */

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const VENDOR_DIR = path.join(CLI_ROOT, 'vendor');
const VENDOR_SERVER = path.join(VENDOR_DIR, 'Server');

const CORE_PACKAGE = '@ohos-cpf/3rdloop_core';
const _require = createRequire(import.meta.url);

/** CLI 包 manifest（CLI 自身代码的依赖口径）。 */
const MANIFEST_CLI = { file: path.join(CLI_ROOT, 'package.json'), label: 'cli/package.json' };
/** 核心包 manifest（仓库根即核心包；仓库态与 vendor 态的默认口径）。 */
const MANIFEST_CORE = { file: path.join(PROJECT_ROOT, 'package.json'), label: 'package.json（仓库根 = 核心包）' };

/** 核心树的固定子目录（三种形态同构；资产目录只扫 src/）。 */
const CORE_SUBDIRS = ['Server', path.join('MCP', 'src'), path.join('Archive', 'src'), 'plugins', 'core', 'seams', 'profiles'];
/** 随 CLI 包发布的自身代码目录（bin/lib/workflows 都在 files 白名单里）。 */
const CLI_CODE_DIRS = ['lib', 'bin', 'workflows'];

const SOURCE_EXTS = ['.js', '.mjs', '.cjs'];

// Node 内置模块（含无 node: 前缀引用），无需声明
const BUILTIN = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);

// import/export-from/动态 import/require 的说明符。相对路径、绝对路径、node:/file:
// 在包名归一前过滤；import.meta 不匹配（无说明符）。
const SPECIFIER_RE = /(?:import\s+[^'"]*?\bfrom\s+|import\s*\(\s*|require\s*\(\s*|export\s+[^'"]*?\bfrom\s+)(['"])([^'"]+)\1/g;

/** 显示用相对仓库根的路径（统一正斜杠，跨平台输出稳定）。 */
function displayPath(p) {
    return path.relative(PROJECT_ROOT, p).split(path.sep).join('/') || '.';
}

/**
 * `/` 出现在代码位置时，它是正则字面量开头还是除号？
 * 只有「期待一个值」的位置才是正则开头：前一有效字符是运算符/开括号/分隔符，
 * 或前一 token 是 return/typeof 这类关键字。前一 token 是标识符、数字、`)`、`]`、
 * 引号结束，或 `++`/`--` 之后，一律是除号。
 * 判断错了方向很关键：把除号误当正则开头会吞掉后面的代码（可能漏掉真实依赖），
 * 所以拿不准时一律按除号处理（保持原文，只多不少）。
 */
const REGEX_PREFIX_CHARS = '(,=:[!&|?{};+-*%~^<>';
const REGEX_PREFIX_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'case', 'do', 'else', 'yield', 'await', 'throw',
]);

function isRegexStart(tail) {
    const t = tail.replace(/\s+$/, '');
    if (t === '') return true;
    const last = t[t.length - 1];
    if ((last === '+' || last === '-') && /[+-]$/.test(t.slice(0, -1))) return false; // a++ / b
    if (REGEX_PREFIX_CHARS.includes(last)) return true;
    const word = /([A-Za-z_$][\w$]*)$/.exec(t);
    return word ? REGEX_PREFIX_KEYWORDS.has(word[1]) : false;
}

/**
 * 把注释内容替换为等长空格（换行原样保留），使说明符正则只看到真正的代码。
 * 注释里写 import 示例（含「不要这样写」的反面例子）是常见写法，不剥会长期假红。
 * 逐字符状态机：code / // 行注释 / 块注释 / '…' "…" `…` 字面量 / 正则字面量（含 [ ] 字符类）。
 * 后两者内部按原文保留，并识别 `\` 转义，否则字符串里的 //、/* 会被误当注释开头。
 * 正则字面量必须单独识别：`/['"]/g` 这种带引号的正则若不跳过，会污染字符串状态，
 * 使后续整段代码被当成字符串、注释不再被剥（SKILL 脚本里的正则示例就是这种情况）。
 * 等长空格替换保证偏移量与行号与原文完全一致（行号由 slice(...).split('\n') 求得）。
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
            } else if (c === '/' && isRegexStart(out.slice(-16))) {
                state = 'regex';
                out += c;
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
        } else if (state === 'regex') {
            // 正则内部：原文保留；[ 进入字符类（类内的 / 不是结束），换行退出（正则不跨行）
            if (c === '\\') {
                out += c + (d ?? '');
                i++;
            } else if (c === '[') {
                state = 'regexClass';
                out += c;
            } else if (c === '/' || c === '\n') {
                state = 'code';
                out += c;
            } else out += c;
        } else if (state === 'regexClass') {
            if (c === '\\') {
                out += c + (d ?? '');
                i++;
            } else if (c === ']') {
                state = 'regex';
                out += c;
            } else out += c;
        } else {
            // 字面量内部：原样保留，转义字符成对跳过
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

/** 归一说明符到包名：'@scope/name/sub' → '@scope/name'，'name/sub' → 'name'。 */
function packageNameOf(spec) {
    const parts = spec.split('/');
    return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** 是否需要声明（排除内置、相对/绝对路径、显式协议）。 */
function isSkippedSpecifier(spec) {
    return spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('file:');
}

/**
 * 扫描目录下所有源码的裸模块引用。
 * @returns {{files: number, refs: Array<{file: string, line: number, spec: string}>}}
 */
function collectImports(dir) {
    const refs = [];
    let files = 0;
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                walk(full);
            } else if (SOURCE_EXTS.includes(path.extname(entry.name))) {
                files += 1;
                // 先剥注释再扫说明符：等长空格替换，行号与原文一致
                const content = stripComments(fs.readFileSync(full, 'utf8'));
                SPECIFIER_RE.lastIndex = 0;
                let m;
                while ((m = SPECIFIER_RE.exec(content)) !== null) {
                    const spec = m[2];
                    if (isSkippedSpecifier(spec)) continue;
                    // 说明符在文件中的行号（1 起）
                    const line = content.slice(0, m.index).split('\n').length;
                    refs.push({ file: full, line, spec });
                }
            }
        }
    };
    walk(dir);
    return { files, refs };
}

/** 已安装核心包的 manifest（未安装返回 null）。 */
function installedCoreManifest() {
    try {
        const pkgJson = _require.resolve(`${CORE_PACKAGE}/package.json`);
        return { file: pkgJson, label: `${CORE_PACKAGE}/package.json（node_modules）` };
    } catch {
        return null;
    }
}

/** 三个候选 manifest 中第一个真实存在的（vendor 态的核对口径链）。 */
function firstExistingManifest(candidates) {
    return candidates.find(m => m && fs.existsSync(m.file)) || MANIFEST_CLI;
}

/**
 * 判定当前核对模式（命中即停：installed → vendor → repo）。
 * @returns {{mode: string, label: string, coreRoot: string, coreManifest: object}|null}
 */
function detectMode() {
    const installed = installedCoreManifest();
    if (installed) {
        const root = path.dirname(installed.file);
        if (fs.existsSync(path.join(root, 'Server'))) {
            return { mode: 'installed', label: '① 已安装核心包（双包发布态）', coreRoot: root, coreManifest: installed };
        }
    }
    if (fs.existsSync(VENDOR_SERVER)) {
        // vendor 是核心树副本：依赖归核心包（已装核心包 → 仓库根 → cli 的遗留单包形态）
        return {
            mode: 'vendor',
            label: '② cli/vendor（prepack 产物 / 单包回退）',
            coreRoot: VENDOR_DIR,
            coreManifest: firstExistingManifest([installed, MANIFEST_CORE, MANIFEST_CLI]),
        };
    }
    if (fs.existsSync(path.join(PROJECT_ROOT, 'Server'))) {
        return { mode: 'repo', label: '③ 仓库源码（开发态）', coreRoot: PROJECT_ROOT, coreManifest: MANIFEST_CORE };
    }
    return null;
}

/** 按模式决定扫描组与每组的 manifest。 */
function buildScanGroups(sel) {
    return [
        {
            name: `核心树（${sel.coreManifest.label}）`,
            manifest: sel.coreManifest,
            dirs: CORE_SUBDIRS.map(d => path.join(sel.coreRoot, d)),
        },
        {
            name: `CLI 自身代码（${MANIFEST_CLI.label}）`,
            manifest: MANIFEST_CLI,
            dirs: CLI_CODE_DIRS.map(d => path.join(CLI_ROOT, d)),
        },
    ];
}

function main() {
    const sel = detectMode();
    if (!sel) {
        console.error('[verify-deps] 未找到任何可核对的核心树，三种模式都不可用：');
        console.error(`  [1] 已安装核心包 —— node_modules/${CORE_PACKAGE} 不存在（npm i ${CORE_PACKAGE}）`);
        console.error(`  [2] cli/vendor     —— ${VENDOR_SERVER} 不存在（npm run prepack）`);
        console.error(`  [3] 仓库源码       —— ${path.join(PROJECT_ROOT, 'Server')} 不存在`);
        process.exit(1);
    }

    console.log(`[verify-deps] 模式: ${sel.label}`);
    console.log(`[verify-deps] 核心树: ${displayPath(sel.coreRoot)}（依赖核对: ${sel.coreManifest.label}）`);

    const groups = buildScanGroups(sel);
    const missing = [];
    let totalFiles = 0;
    const totalPackages = new Set();

    for (const group of groups) {
        const declared = new Set(Object.keys(JSON.parse(fs.readFileSync(group.manifest.file, 'utf8')).dependencies || {}));
        console.log(`[verify-deps] 扫描组: ${group.name}`);
        const groupPackages = new Set();

        for (const dir of group.dirs) {
            const label = displayPath(dir);
            if (!fs.existsSync(dir)) {
                console.warn(`[verify-deps]   警告: 目录不存在，跳过: ${label}`);
                continue;
            }
            const { files, refs } = collectImports(dir);
            if (files === 0) {
                console.warn(`[verify-deps]   警告: 目录内无源码文件（空目录），跳过: ${label}`);
                continue;
            }
            const packages = new Set();
            for (const ref of refs) {
                const name = packageNameOf(ref.spec);
                if (BUILTIN.has(name) || name.startsWith('node:')) continue;
                packages.add(name);
                if (declared.has(name)) continue;
                missing.push({ manifest: group.manifest, file: ref.file, line: ref.line, spec: ref.spec, name });
            }
            totalFiles += files;
            for (const name of packages) {
                groupPackages.add(name);
                totalPackages.add(name);
            }
            console.log(`[verify-deps]   ${label}: ${files} 个源文件, ${packages.size} 个外部包`);
        }

        console.log(`[verify-deps]   小计: ${groupPackages.size} 个外部包（声明核对: ${group.manifest.label}）`);
    }

    if (missing.length > 0) {
        console.error(`[verify-deps] 发现 ${missing.length} 处未在对应 manifest 声明的外部依赖 import:`);
        for (const group of groups) {
            const items = missing.filter(m => m.manifest === group.manifest);
            if (items.length === 0) continue;
            console.error(`   [manifest: ${group.manifest.label}]`);
            for (const item of items) {
                console.error(`   - ${displayPath(item.file)}:${item.line} ${item.spec}`);
            }
            console.error(`     请将 ${[...new Set(items.map(i => i.name))].join(', ')} 添加到 ${group.manifest.label} dependencies`);
        }
        process.exit(1);
    }

    console.log(`[verify-deps] OK — 共 ${totalFiles} 个源文件、${totalPackages.size} 个外部 import 均已在对应 manifest 声明`);
    process.exit(0);
}

main();
