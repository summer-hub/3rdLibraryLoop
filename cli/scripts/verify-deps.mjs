#!/usr/bin/env node
/**
 * verify-deps.mjs —— 校验依赖声明与引擎/插件代码一致（R2）
 *
 * 作用：
 *   - 扫描被嵌入随包发布的源码中所有 import 的裸模块包名
 *     （扫描前先剥注释：注释里写的 import 示例不计为依赖，见 stripComments）
 *   - 与对应 manifest 的 dependencies 比对，缺失则报错并列出「文件:行 说明符」
 *   - 防止发布后代码 import 的依赖未声明导致运行时 ESM Module not found
 *
 * 扫描集合（双模式）：
 *   - 发布态（cli/vendor/Server 存在，prepack 已生成）：
 *       vendor/Server、vendor/MCP/src、vendor/Archive/src、
 *       vendor/plugins、vendor/core、vendor/seams
 *     依赖声明统一以 cli/package.json 为准（vendor 内容随 npm 包安装，
 *     依赖由 cli/package.json 拉取；子目录不各自声明依赖）。
 *   - 开发态（无 vendor，回退源码）：
 *       Server、MCP/src、Archive/src          → 声明以 cli/package.json 为准
 *       plugins、core、seams                  → 声明以仓库根 package.json 为准
 *     两组 manifest 不可混用：开发态仓库根插件树由仓库根 package.json 安装依赖
 *     （例：plugins/llm/dashscope 的 openai 声明在仓库根 package.json），
 *     而 vendor 副本随包安装、依赖由 cli/package.json 声明。
 *
 * 目录动态扫描：插件按目录发现，不硬编码插件名；目录不存在/为空时给出提示并跳过。
 *
 * 触发时机：npm run verify-deps（发布前 CI / prepublish 自动检查）
 */

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const VENDOR_DIR = path.join(CLI_ROOT, 'vendor');
const VENDOR_SERVER = path.join(VENDOR_DIR, 'Server');

// 两份 manifest：vendor/** 与仓库 Server 侧以 cli/package.json 判定；
// 仓库根插件树（plugins/core/seams）以仓库根 package.json 判定。
const MANIFEST_CLI = { file: path.join(CLI_ROOT, 'package.json'), label: 'cli/package.json' };
const MANIFEST_ROOT = { file: path.join(PROJECT_ROOT, 'package.json'), label: 'package.json（仓库根）' };

const SOURCE_EXTS = ['.js', '.mjs', '.cjs'];

// Node 内置模块（含无 node: 前缀引用），无需声明
const BUILTIN = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);

// 已知的裸模块依赖（vendored 代码 import 的第三方包）
const BARE_MODULES = [
    '@opencode-ai/sdk',
    '@modelcontextprotocol/sdk',
    'better-sqlite3',
    'chokidar',
    'dotenv',
    'jieba-wasm',
    'typescript',
];

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

/** 按模式决定扫描集合与每组的 manifest。 */
function buildScanGroups(useVendor) {
    if (useVendor) {
        return [{
            manifest: MANIFEST_CLI,
            dirs: [
                VENDOR_SERVER,
                path.join(VENDOR_DIR, 'MCP', 'src'),
                path.join(VENDOR_DIR, 'Archive', 'src'),
                path.join(VENDOR_DIR, 'plugins'),
                path.join(VENDOR_DIR, 'core'),
                path.join(VENDOR_DIR, 'seams'),
            ],
        }];
    }
    return [
        {
            manifest: MANIFEST_CLI,
            dirs: [
                path.join(PROJECT_ROOT, 'Server'),
                path.join(PROJECT_ROOT, 'MCP', 'src'),
                path.join(PROJECT_ROOT, 'Archive', 'src'),
            ],
        },
        {
            manifest: MANIFEST_ROOT,
            dirs: [
                path.join(PROJECT_ROOT, 'plugins'),
                path.join(PROJECT_ROOT, 'core'),
                path.join(PROJECT_ROOT, 'seams'),
            ],
        },
    ];
}

function main() {
    const useVendor = fs.existsSync(VENDOR_SERVER);
    const requiredDir = useVendor ? VENDOR_SERVER : path.join(PROJECT_ROOT, 'Server');
    if (!fs.existsSync(requiredDir)) {
        console.error(`[verify-deps] 未找到 vendor/Server，回退路径也不存在: ${requiredDir}`);
        console.error('[verify-deps] 请先运行 npm run prepack 或确保源码 Server/ 存在');
        process.exit(1);
    }

    console.log(`[verify-deps] 模式: ${useVendor ? 'vendor/（发布态）' : '源码（开发态）'}`);

    const groups = buildScanGroups(useVendor);
    const missing = [];
    let totalFiles = 0;
    const totalPackages = new Set();

    for (const group of groups) {
        const declared = new Set(Object.keys(JSON.parse(fs.readFileSync(group.manifest.file, 'utf8')).dependencies || {}));
        console.log(`[verify-deps] 扫描组（依赖声明: ${group.manifest.label}）`);
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
                if (BARE_MODULES.includes(name) || declared.has(name)) continue;
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
