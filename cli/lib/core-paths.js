/**
 * core-paths.js —— 核心树定位（零依赖：只用 node 内置模块）
 *
 * 双包发布形态下核心来自 `@ohos-cpf/3rdloop_core`，本地调试仍可用 vendor / 仓库源码。
 * 四级解析（命中即返回，顺序固定）：
 *   1. 环境变量 3LIB_CORE_DIR —— 显式覆盖（运维/测试用，写错即刻报错）
 *   2. 已安装的 @ohos-cpf/3rdloop_core 包根 —— 双包发布态的正路
 *   3. cli/vendor —— prepack 产物（单包回退 / 本地调试），保留可用
 *   4. 仓库根（cli/ 的上一级）—— 开发期直接引用源码
 *
 * 四个级别都指向同一个形状：**核心树根**，其下有
 * `Server/ plugins/ core/ seams/ profiles/`（安装态即包根，vendor 态即 cli/vendor，
 * 仓库态即仓库根）。这样的同构让 `Server/**` 里上千条相对 import 与 21 条接缝路径
 * 在三种形态下完全一致，不需要任何搬家或路径改写。
 * 核心前端资产 `Web/public` 也随核心包发布，因此同样由这里派生（`webRoot`），
 * CLI 侧不再自带前端副本。
 *
 * 单独成模块（而不是写在 runner.js 里）的理由：config.js / mcp.js / serve.js / doctor.js
 * 都要定位同一棵树，而 runner.js 会牵出 config.js（`.env` 链）；放在这里可以双向避免循环依赖。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** CLI 包根（cli/）。 */
export const CLI_ROOT = path.resolve(moduleDir, '..');

/** 核心包名（发布态由 CLI 的 dependencies 拉取）。 */
export const CORE_PACKAGE = '@ohos-cpf/3rdloop_core';
/** 显式覆盖核心树目录的环境变量。 */
export const CORE_DIR_ENV = '3LIB_CORE_DIR';

const _require = createRequire(import.meta.url);

/** 四级来源的人类可读名（错误信息与诊断输出共用）。 */
const LEVELS = [
    `环境变量 ${CORE_DIR_ENV}`,
    `已安装核心包 ${CORE_PACKAGE}`,
    'cli/vendor（prepack 产物）',
    '仓库根（cli/ 的上一级）',
];

let _cache = null;

/**
 * 把核心树根展开为各子根。
 * @param {string} coreRoot - 含 Server/ plugins/ core/ seams/ profiles/ 的目录
 * @param {number} level - 命中的级别（1..4）
 * @returns {{level: number, label: string, coreRoot: string, serverRoot: string, pluginsRoot: string, seamsRoot: string, profilesRoot: string, webRoot: string}}
 */
function describeRoots(coreRoot, level) {
    return {
        level,
        label: LEVELS[level - 1],
        coreRoot,
        serverRoot: path.join(coreRoot, 'Server'),
        pluginsRoot: path.join(coreRoot, 'plugins'),
        seamsRoot: path.join(coreRoot, 'seams'),
        profilesRoot: path.join(coreRoot, 'profiles'),
        // 核心前端资产（随核心包发布）：安装态=核心包根/Web/public，vendor 态=cli/vendor/Web/public，
        // 仓库态=仓库根/Web/public。CLI 不再持有前端副本，因此这是唯一派生点。
        webRoot: path.join(coreRoot, 'Web', 'public'),
    };
}

/** 目录看起来像核心树根吗（Server/ 在即可，插件树缺失由各自的 fail closed 兜住）。 */
function looksLikeCoreRoot(dir) {
    return !!dir && fs.existsSync(path.join(dir, 'Server'));
}

/**
 * 四级尝试的唯一实现：逐级探测并把每级结果记进 attempts（错误信息按此列出）。
 * @param {string} cliRoot
 * @returns {{roots: object|null, attempts: Array<{label: string, detail: string}>}}
 */
function _probe(cliRoot) {
    const attempts = [];

    // ① 显式覆盖：写错不能静默降级，直接报出「该目录不是核心树根」
    const override = String(process.env[CORE_DIR_ENV] ?? '').trim();
    if (!override) {
        attempts.push({ label: LEVELS[0], detail: '未设置' });
    } else {
        const dir = path.resolve(override);
        if (looksLikeCoreRoot(dir)) return { roots: describeRoots(dir, 1), attempts };
        attempts.push({ label: LEVELS[0], detail: `已设置但该目录下没有 Server/: ${dir}` });
        return { roots: null, attempts };
    }

    // ② 已安装核心包：解析失败不抛，落到下一级
    try {
        const pkgJson = _require.resolve(`${CORE_PACKAGE}/package.json`);
        const dir = path.dirname(pkgJson);
        if (looksLikeCoreRoot(dir)) return { roots: describeRoots(dir, 2), attempts };
        attempts.push({ label: LEVELS[1], detail: `已解析到 ${dir}，但该目录下没有 Server/` });
    } catch (err) {
        attempts.push({ label: LEVELS[1], detail: `未安装（${err.code || err.message}）` });
    }

    // ③ prepack 产物
    const vendorRoot = path.join(cliRoot, 'vendor');
    if (looksLikeCoreRoot(vendorRoot)) return { roots: describeRoots(vendorRoot, 3), attempts };
    attempts.push({ label: LEVELS[2], detail: `不存在: ${path.join(vendorRoot, 'Server')}` });

    // ④ 仓库源码
    const repoRoot = path.resolve(cliRoot, '..');
    if (looksLikeCoreRoot(repoRoot)) return { roots: describeRoots(repoRoot, 4), attempts };
    attempts.push({ label: LEVELS[3], detail: `不存在: ${path.join(repoRoot, 'Server')}` });

    return { roots: null, attempts };
}

/**
 * 解析核心树（四级，缓存）。
 * @param {string} [cliRoot] - CLI 包根，缺省为本模块所在的 cli/
 * @returns {{level: number, label: string, coreRoot: string, serverRoot: string, pluginsRoot: string, seamsRoot: string, profilesRoot: string, webRoot: string}}
 * @throws {Error} 四级全部落空（或 3LIB_CORE_DIR 指错）时，错误信息逐级列出实测结果与可照抄的修法
 */
export function resolveCoreRoots(cliRoot = CLI_ROOT) {
    if (_cache) return _cache;
    const { roots, attempts } = _probe(cliRoot);
    if (!roots) throw _resolutionError(attempts);
    _cache = roots;
    return roots;
}

/**
 * 同 resolveCoreRoots，但**不抛错**（尽力而为的接线用：env 标记、诊断输出）。
 * @param {string} [cliRoot]
 * @returns {object|null}
 */
export function resolveCoreRootsOrNull(cliRoot = CLI_ROOT) {
    try {
        return resolveCoreRoots(cliRoot);
    } catch {
        return null;
    }
}

/** 四级落空时的错误（逐级实测 + 可照抄的修法）。 */
function _resolutionError(attempts) {
    const lines = LEVELS.map((label, i) => {
        const hit = attempts.find(a => a.label === label);
        return `  ${i + 1}. ${label} —— ${hit ? hit.detail : '未尝试'}`;
    });
    return new Error(
        `无法定位核心引擎目录（${CORE_PACKAGE}）。已依次尝试四级来源：\n${lines.join('\n')}\n` +
        '修复（任选其一，照抄即可）：\n' +
        `  npm i ${CORE_PACKAGE}                        # 双包发布态：安装核心包后重试\n` +
        '  npm i -g @ohos-cpf/3rdloop@latest                   # 或重装 CLI（会连带安装核心包）\n' +
        `  ${CORE_DIR_ENV}=<含 Server/ 的目录> 3rdloop <cmd>      # 指定任意核心树（运维/测试）\n` +
        '  npm run prepack                                     # 仓库内：生成 cli/vendor 回退副本'
    );
}

/**
 * 读核心树 manifest 的版本信息（诊断/排障用：doctor 与 version 输出）。
 *
 * 安装态/仓库态读核心树根 `package.json`；vendor 态没有包 manifest（它是核心树的副本），
 * 回退读 `prepack` 写入的 `VERSION` 文件首行——两种形态都能报出版本便于排障。
 *
 * @param {string} [coreRoot]
 * @returns {{name: string, version: string, root: string, from: 'package.json'|'VERSION'}|null}
 */
export function corePackageInfo(coreRoot) {
    const root = coreRoot || resolveCoreRootsOrNull()?.coreRoot;
    if (!root) return null;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (pkg.name === CORE_PACKAGE) {
            return { name: pkg.name, version: String(pkg.version || '0.0.0'), root, from: 'package.json' };
        }
    } catch { /* 无包 manifest（vendor 态）：落到 VERSION */ }
    try {
        const line = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').split(/\r?\n/)[0].trim();
        if (line) return { name: CORE_PACKAGE, version: line, root, from: 'VERSION' };
    } catch { /* 也没有 VERSION */ }
    return null;
}

/**
 * 一行诊断：核心取自哪一级、哪个目录、哪个版本（version / doctor 复用）。
 * @returns {{mode: string, level: number, root: string, version: string|null}}
 */
export function describeCoreSource() {
    const roots = resolveCoreRootsOrNull();
    if (!roots) {
        return { mode: '未解析', level: 0, root: '', version: null };
    }
    const info = corePackageInfo(roots.coreRoot);
    const mode = roots.level === 2 ? 'node_modules（已安装核心包）' : roots.label;
    return { mode, level: roots.level, root: roots.coreRoot, version: info?.version ?? null };
}
