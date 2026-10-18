/**
 * update.js —— 自更新（3rdloop update）
 *
 * 职责（两条互不干扰的升级路径）：
 *   - npm registry 路径（默认）：检测本地版本（getCliVersion）与 registry 最新版，
 *     交互确认后卸载旧版 + npm install -g 重装最新版
 *   - GitHub Release 附件路径（--from-release）：从 release 的两个 tarball
 *     （核心包 + CLI 包）下载后用一次 npm install -g 装上
 *
 * 为什么需要 Release 路径：双包（@ohos-cpf/3rdloop_core + @ohos-cpf/3rdloop）不一定发布到
 * 公共 npm registry；从 Release 附件安装的用户跑 registry 路径必然 404。该路径不碰 registry
 * 元数据，只做「取 release → 取两个 asset → 下载 → 安装 → 回读校验」。
 *
 * 交互/输出契约：
 *   - 进度/日志 → stderr；--json 结构化结果 → stdout（只一个对象）
 *   - 非 TTY 下交互确认自动拒绝（需 --yes 配合脚本化更新）
 *
 * 安全：
 *   - registry 默认尊重用户 npm 配置（镜像源），--registry 可覆盖
 *   - 全部经 runNpm 调 npm：POSIX 保持 execFileSync 直接调用（无 shell），
 *     win32 因 npm 是 npm.cmd shim 需 shell:true（cmd 按 PATHEXT 解析），
 *     该分支对用户可控的 --registry 值做白名单校验防 shell 注入
 *   - Release 路径只读公开仓库：**从不携带任何 token**（不发 Authorization 头，
 *     也不读 GITHUB_TOKEN 等环境变量），因此 token 不可能流入 URL 或被日志带出；
 *     对外 URL 仅来自 --release-api / --release-repo 与 GitHub 返回的
 *     browser_download_url，发请求前统一校验 http(s) 协议
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 本文件在 cli/lib/ 下
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_NAME = '@ohos-cpf/3rdloop';
const CORE_PKG_NAME = '@ohos-cpf/3rdloop_core';

// ── npm 调用封装 ─────────────────────────────────────────────────

// --registry 值来自用户输入，win32 走 shell 前做白名单校验
const SAFE_REGISTRY_RE = /^https?:\/\/[^\s"'&|<>^();%]+$/;

/**
 * 跨平台调用 npm。
 *
 * - POSIX（macOS/Linux）：shell 为 false，等价于直接 execFileSync('npm', args)，
 *   macOS 行为与修复前完全一致。
 * - win32：shell 为 true，Node 用 cmd.exe /d /s /c 执行，cmd 按 PATHEXT
 *   找到 npm.cmd（execFileSync 的 CreateProcess 无法直接执行批处理 shim）。
 *
 * 注入防护：仅 win32 分支对 args 中 --registry 的值做 http(s) URL 白名单校验；
 * 其余参数均为代码内常量，无用户输入面。npm 缺失时把原生 ENOENT/EINVAL
 * 转成可读中文提示。
 */
export function runNpm(args, opts = {}) {
    const shell = process.platform === 'win32';
    if (shell) {
        const regIdx = args.indexOf('--registry');
        const reg = regIdx !== -1 ? args[regIdx + 1] : null;
        if (reg !== undefined && reg !== null && !SAFE_REGISTRY_RE.test(String(reg))) {
            const err = new Error(`非法 --registry 值（仅允许不含空白/引号/元字符的 http(s) URL）: ${reg}`);
            err.code = 'INVALID_REGISTRY';
            throw err;
        }
    }
    try {
        return execFileSync('npm', args, { ...opts, shell });
    } catch (err) {
        if (err && (err.code === 'ENOENT' || err.code === 'EINVAL')) {
            throw new Error('未找到 npm 命令，请确认已安装 Node.js 且 npm 在 PATH 中（npm --version 可验证）');
        }
        throw err;
    }
}

/**
 * win32 下 shell:true 时 Node 只用空格拼接 argv，不做转义——含空格的路径必须自己加引号。
 * POSIX 分支不走 shell，加了引号反而是路径的一部分，故原样返回。
 * 仅 Release 路径使用（默认路径的参数保持原样，行为零变化）。
 */
function _shellArg(value) {
    const s = String(value);
    if (process.platform !== 'win32') return s;
    // 双引号内 cmd 不解释 & | < > ^ ( )；去掉内嵌双引号，路径中不可能合法出现
    return `"${s.replace(/"/g, '')}"`;
}

// ── 工具 ─────────────────────────────────────────────────────────

/**
 * 轻量语义化版本比较。返回负数/零/正数；pre-release 视为低于正式版。
 */
export function compareVersions(a, b) {
    const parse = (v) => String(v || '')
        .trim()
        .replace(/^v/i, '')
        .split(/[\.+\-]/)
        .map((part, idx) => idx < 3 ? parseInt(part, 10) || 0 : part);
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < 3; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na !== nb) return na - nb;
    }
    // 无 pre-release（第 4 部分为空 / 纯数字）视为正式版，大于带 pre 的版本
    const preA = pa[3];
    const preB = pb[3];
    if (!preA && preB) return 1;
    if (preA && !preB) return -1;
    return String(preA).localeCompare(String(preB));
}

/**
 * 获取最新版本。
 * 优先 `npm view`（尊重用户 .npmrc 镜像配置）；失败回退 packument API。
 * @returns {Promise<string | null>} latest 版本号；查询失败返回 null
 */
export async function fetchLatestVersion({ registry } = {}) {
    const args = ['view', PKG_NAME, 'version'];
    if (registry) args.push('--registry', registry);
    try {
        const out = runNpm(args, {
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: 30000,
        });
        const v = out.trim().split('\n')[0];
        return v || null;
    } catch { /* 回退 packument API */ }

    // packument API 兜底（尊重用户 npm 镜像配置）
    const registryHost = registry || _detectNpmRegistry();
    try {
        const enc = encodeURIComponent(PKG_NAME);
        const url = `${registryHost.replace(/\/$/, '')}/${enc}/latest`;
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) return null;
        const data = await res.json();
        return data.version || null;
    } catch {
        return null;
    }
}

/** 从用户 npm 配置读取 registry（无 --registry 时使用镜像源）。 */
function _detectNpmRegistry() {
    try {
        const out = runNpm(['config', 'get', 'registry'], {
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: 10000,
        });
        const v = out.trim();
        return v && v !== 'undefined' ? v : 'https://registry.npmjs.org/';
    } catch {
        return 'https://registry.npmjs.org/';
    }
}

/**
 * 交互确认是否更新。非 TTY 自动视为不确认。
 * @returns {Promise<boolean>}
 */
export async function confirmUpdate({ current, latest } = {}) {
    if (!process.stdin.isTTY) return false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
        rl.question(`  检测到新版本 ${latest}（当前 ${current}），是否更新? [y/N] `, (ans) => {
            rl.close();
            resolve(/^y(es)?$/i.test(ans.trim()));
        });
    });
}

/**
 * 执行更新：卸载旧版后通过 npm install -g 重装最新版。
 * @param {object} opts
 * @param {string} opts.latest        目标版本（registry latest）
 * @param {string} [opts.registry]    registry 覆盖
 */
export function performUpdate({ latest, registry } = {}) {
    const installArgs = ['install', '-g', `${PKG_NAME}@latest`];
    if (registry) installArgs.push('--registry', registry);

    process.stderr.write(`[update] 卸载旧版本（@${PKG_NAME}）...\n`);
    try {
        runNpm(['uninstall', '-g', PKG_NAME], { encoding: 'utf-8', stdio: 'inherit' });
    } catch { /* 卸载失败不阻断重装 */ }

    process.stderr.write(`[update] 安装最新版本...\n`);
    runNpm(installArgs, { encoding: 'utf-8', stdio: 'inherit' });

    return { updated: true, version: latest };
}

// ── GitHub Release 附件升级（--from-release）──────────────────────

const DEFAULT_RELEASE_API = 'https://api.github.com';
// asset 命名约定（与 scripts/release.mjs 的 tarballName 一致）：
//   核心包 ohos-cpf-3rdloop_core-<ver>.tgz / CLI 包 ohos-cpf-3rdloop-<ver>.tgz
const CORE_ASSET_MARK = '3rdloop_core';
const CLI_ASSET_MARK = '3rdloop';
const API_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 60000;
const INSTALL_TIMEOUT_MS = 300000;
// GitHub API 强制要求非空 User-Agent（缺省会被 403 拒绝）
const USER_AGENT = '3rdloop-update';

/**
 * update 的已知开关。**值型** flag 的取值由 `valueIdx` 放行（见 parseUpdateArgs），
 * 其余以 `-` 开头的 token 必须是这张表里的开关，否则算未知参数。
 *
 * 这张表存在的原因：早先「未知参数」判定写成"不是 `--` 开头的都算位置参数"，于是
 * `--registry <url>` 的取值与短开关 `-y` 都被误判成位置参数而拒绝（两个既有 bug）。
 * 判据应当是"这个 token 是不是我认识的开关 / 已知开关的取值"，而不是"它长什么样"。
 */
const KNOWN_FLAGS = new Set([
    '--check',
    '--yes',
    '-y',
    '--help',
    '-h',
    '--from-release',
    '--release-api',
    '--release-repo',
    '--prefix',
    '--registry',
]);

/**
 * 把 `--flag=value` 展开成 `['--flag', 'value']`（其余 token 原样）。
 * 展开后再解析，既支持 `=` 写法，又让"取值位置"的记账只有一套逻辑。
 */
function _expandEqualsForm(list = []) {
    const out = [];
    for (const token of list) {
        const m = /^(--[a-z-]+)=([\s\S]*)$/.exec(token);
        if (m && KNOWN_FLAGS.has(m[1])) out.push(m[1], m[2]);
        else out.push(token);
    }
    return out;
}

/**
 * 解析 update 的参数（纯函数，无 IO，便于单测）。
 *
 * @param {string[]} rest - 去掉命令名与全局 flag 之后的参数
 * @returns {object} 解析结果，含 `unknowns`（未知选项 + 多余位置参数）
 */
export function parseUpdateArgs(rest = []) {
    const argv = _expandEqualsForm(rest);
    const opts = {
        checkOnly: false,
        yes: false,
        help: false,
        registry: undefined,
        fromRelease: false,
        tag: '',
        releaseApi: DEFAULT_RELEASE_API,
        releaseRepo: '',
        prefix: '',
        valueIdx: new Set(),
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--check':
                opts.checkOnly = true;
                break;
            case '--yes':
            case '-y':
                opts.yes = true;
                break;
            case '--help':
            case '-h':
                opts.help = true;
                break;
            case '--from-release': {
                opts.fromRelease = true;
                // 可选 tag：下一个不是 flag 的 token 视为 tag（`--from-release --check` = latest）
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith('-')) {
                    opts.tag = next;
                    opts.valueIdx.add(i + 1);
                    i++;
                }
                break;
            }
            case '--release-api':
                opts.releaseApi = argv[i + 1] ?? '';
                if (argv[i + 1] !== undefined) opts.valueIdx.add(i + 1);
                i++;
                break;
            case '--release-repo':
                opts.releaseRepo = argv[i + 1] ?? '';
                if (argv[i + 1] !== undefined) opts.valueIdx.add(i + 1);
                i++;
                break;
            case '--prefix':
                opts.prefix = argv[i + 1] ?? '';
                if (argv[i + 1] !== undefined) opts.valueIdx.add(i + 1);
                i++;
                break;
            case '--registry':
                opts.registry = argv[i + 1];
                if (argv[i + 1] !== undefined) opts.valueIdx.add(i + 1);
                i++;
                break;
            default:
                break;
        }
    }
    // 未知项判定：已知开关的取值（valueIdx）放行；已知开关放行；其余一律算未知。
    opts.unknowns = argv.filter((a, i) => {
        if (opts.valueIdx.has(i)) return false;
        if (a.startsWith('-')) return !KNOWN_FLAGS.has(a);
        return true;
    });
    return opts;
}

/** 人类可读体积。 */
function _humanSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 校验并规整 API base（去掉尾部斜杠）。 */
function _normalizeApiBase(raw) {
    const value = String(raw || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(value)) {
        throw new Error(`--release-api 需要一个 http(s) 地址，当前值: ${raw || '(空)'}`);
    }
    return value;
}

/**
 * 把裸 `owner/repo` 或仓库 URL 规整成 `owner/repo`（规整不出返回 null）。
 *
 * 两种输入分开处理，避免把裸 slug 的 owner 当成主机名剥掉：
 *   - 带 scheme 或 scp 形式（`git+https://host/o/r.git`、`git@host:o/r.git`）→ 剥前缀；
 *   - 裸 `owner/repo` → 直接要求恰好两段。
 */
export function repoSlug(value) {
    let s = String(value || '').trim();
    if (!s) return null;
    if (/:\/\//.test(s) || /^[^@/\s]+@[^/\s]+:/.test(s)) {
        s = s
            .replace(/^git\+/i, '')
            .replace(/^[a-z+]+:\/\//i, '')
            .replace(/^[^@/\s]+@/, '')
            .replace(/^[^/:\s]+(?::\d+)?[:/]/, '');
    }
    s = s.replace(/\.git$/i, '').replace(/\/+$/, '');
    const parts = s.split('/').filter(Boolean);
    return parts.length === 2 ? `${parts[0]}/${parts[1]}` : null;
}

/** 从 package.json 的 repository 字段推导 owner/repo（字符串与 {url} 两种写法都认）。 */
export function repoFromManifest(pkg) {
    const repo = pkg?.repository;
    return repoSlug(typeof repo === 'string' ? repo : repo?.url);
}

/**
 * 确定 release 仓库：--release-repo 优先；否则从 CLI 包 / 核心包的 repository 字段推导。
 * 两处都推不出时抛错要求显式传入（不猜、不静默用默认仓库）。
 * @returns {Promise<string>}
 */
export async function resolveReleaseRepo({ explicit = '' } = {}) {
    if (String(explicit || '').trim()) {
        const slug = repoSlug(explicit);
        if (!slug) {
            throw new Error(`--release-repo 需要 <owner/repo> 形式，当前值: ${explicit}`);
        }
        return slug;
    }

    const tried = [];
    // ① CLI 包自身 manifest
    const cliManifest = path.join(CLI_ROOT, 'package.json');
    tried.push(cliManifest);
    const cliSlug = _repoFromFile(cliManifest);
    if (cliSlug) return cliSlug;

    // ② 核心包 manifest（四级解析：安装态 / vendor / 仓库根）
    try {
        const { resolveCoreRootsOrNull } = await import('./core-paths.js');
        const roots = resolveCoreRootsOrNull();
        const coreManifest = roots?.coreRoot ? path.join(roots.coreRoot, 'package.json') : null;
        if (coreManifest) {
            tried.push(coreManifest);
            const coreSlug = _repoFromFile(coreManifest);
            if (coreSlug) return coreSlug;
        }
    } catch { /* 核心树解析失败：按「推导不出」处理，下面统一报错 */ }

    throw new Error(
        `无法推导 release 仓库地址（owner/repo）：请显式传入 --release-repo <owner/repo>。\n` +
        `        已尝试读取的 manifest：${tried.join(' / ')}\n` +
        `        这些 manifest 缺少可解析的 repository 字段（或对应的包未安装）。`
    );
}

/** 读一个 manifest 的 repository → owner/repo（读不到/解析不出返回 null）。 */
function _repoFromFile(manifestPath) {
    try {
        return repoFromManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    } catch {
        return null;
    }
}

/**
 * 拉取 release 元数据。
 * @param {object} opts
 * @param {string} opts.api   API base（无尾部斜杠）
 * @param {string} opts.repo  owner/repo
 * @param {string} [opts.tag] tag 名；缺省取 latest
 * @returns {Promise<object>} release JSON
 */
export async function fetchRelease({ api, repo, tag } = {}) {
    const url = tag
        ? `${api}/repos/${repo}/releases/tags/${encodeURIComponent(String(tag))}`
        : `${api}/repos/${repo}/releases/latest`;

    let res;
    try {
        res = await fetch(url, {
            headers: {
                accept: 'application/vnd.github+json',
                'user-agent': USER_AGENT,
                'x-github-api-version': '2022-11-28',
            },
            signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
    } catch (err) {
        const reason = err?.cause?.code || err?.cause?.message || err?.name || err?.message || String(err);
        throw new Error(
            `无法访问 Release API：${url}\n` +
            `        原因：${reason}\n` +
            `        排查：网络/代理是否可达该地址；自建镜像用 --release-api <base>；限流时稍后重试或改用 npm 路径。`
        );
    }

    if (!res.ok) {
        const why = res.status === 404
            ? '404 表示仓库不存在/私有、tag 不存在，或 --release-repo 写错'
            : res.status === 403 || res.status === 429
                ? '可能是 GitHub API 限流（未认证请求每小时 60 次），稍后重试'
                : '见下方 URL 与状态码';
        throw new Error(
            `Release API 返回 HTTP ${res.status}：${url}\n` +
            `        ${why}\n` +
            `        查看实际 release：gh release list --repo ${repo}`
        );
    }

    try {
        return await res.json();
    } catch {
        throw new Error(`Release API 返回的不是合法 JSON：${url}（HTTP ${res.status}）`);
    }
}

/**
 * 从 release.assets 里挑出核心包与 CLI 包两个 tarball。
 * 缺失任一个都直接报错并列出**实际** asset 名单（不猜文件名、不回退到 registry）。
 */
export function pickReleaseAssets(release, { repo } = {}) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const tarballs = assets.filter((a) => typeof a?.name === 'string' && /\.tgz$/i.test(a.name));
    const core = tarballs.find((a) => a.name.includes(CORE_ASSET_MARK)) || null;
    const cli = tarballs.find((a) => !a.name.includes(CORE_ASSET_MARK) && a.name.includes(CLI_ASSET_MARK)) || null;

    if (core && cli) return { core, cli };

    const tag = release?.tag_name || '(未命名 release)';
    const listing = assets.length
        ? assets.map((a) => `- ${a.name}（${_humanSize(a.size)}）`).join('\n            ')
        : '（该 release 没有任何附件）';
    const missing = !core && !cli ? '核心包与 CLI 包' : !core ? `核心包（文件名需含 ${CORE_ASSET_MARK}）` : `CLI 包（文件名需含 ${CLI_ASSET_MARK} 且不含 ${CORE_ASSET_MARK}）`;
    throw new Error(
        `release ${tag} 缺少${missing}的 .tgz 附件，无法安装。\n` +
        `        实际附件：\n            ${listing}\n` +
        `        修正：先产出产物再上传到该 release\n` +
        `            node scripts/release.mjs --out dist\n` +
        `            gh release upload ${tag} dist/*.tgz${repo ? ` --repo ${repo}` : ''}\n` +
        `        核对：gh release view ${tag}${repo ? ` --repo ${repo}` : ''} --json assets`
    );
}

/** 下载单个 asset 到 dir，返回本地文件路径。 */
async function _downloadAsset({ asset, label, dir }) {
    const url = asset?.browser_download_url || asset?.url;
    if (!/^https?:\/\//i.test(String(url || ''))) {
        throw new Error(`release asset ${asset?.name || label} 缺少可用的下载地址（browser_download_url）`);
    }
    const file = path.join(dir, path.basename(String(asset.name || `${label}.tgz`)));

    process.stderr.write(`[update] 下载${label} ${asset.name}（${_humanSize(asset.size)}）\n`);
    let res;
    try {
        res = await fetch(url, {
            headers: { 'user-agent': USER_AGENT },
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
    } catch (err) {
        const reason = err?.cause?.code || err?.cause?.message || err?.name || err?.message || String(err);
        throw new Error(`下载${label}失败：${url}\n        原因：${reason}`);
    }
    if (!res.ok) {
        throw new Error(`下载${label}失败：HTTP ${res.status} ${url}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(file, buf);
    process.stderr.write(`[update] 已保存 ${file}（${_humanSize(buf.length)}）\n`);
    return { file, bytes: buf.length, name: asset.name, url };
}

/** 用两个 tarball 做一次全局安装（带 --prefix 时落到该前缀，供测试/自建镜像使用）。 */
function _installTarballs({ coreFile, cliFile, prefix, registry }) {
    const args = ['install', '-g', _shellArg(coreFile), _shellArg(cliFile), '--no-audit', '--no-fund'];
    if (prefix) args.push('--prefix', _shellArg(prefix));
    // tarball 本身不来自 registry，但核心包的传递依赖要解析——用户给了 --registry 就照传
    if (registry) args.push('--registry', registry);

    process.stderr.write(`[update] 安装核心包 + CLI 包（npm install -g）...\n`);
    try {
        runNpm(args, { encoding: 'utf-8', stdio: 'pipe', timeout: INSTALL_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
    } catch (err) {
        const out = [err?.stdout, err?.stderr].filter(Boolean).join('\n').trim();
        const tail = out ? out.split(/\r?\n/).slice(-3).join('\n        ') : String(err?.message || err);
        throw new Error(
            `安装失败（npm 退出码 ${err?.status ?? '未知'}）\n` +
            `        原始 npm 输出（末三行）：\n        ${tail}`
        );
    }
    process.stderr.write(`[update] 安装完成\n`);
}

/** 全局安装根目录：优先问 npm（--prefix 会被尊重），失败再按平台布局兜底。 */
function _globalInstallRoot({ prefix }) {
    const args = ['root', '-g'];
    if (prefix) args.push('--prefix', _shellArg(prefix));
    try {
        const out = runNpm(args, { encoding: 'utf-8', stdio: 'pipe', timeout: 30000 });
        const root = out.trim().split(/\r?\n/).pop();
        if (root) return root;
    } catch { /* 回退到下面的布局推断 */ }

    if (!prefix) return null;
    // POSIX 全局布局是 <prefix>/lib/node_modules，Windows 是 <prefix>/node_modules
    for (const candidate of [path.join(prefix, 'node_modules'), path.join(prefix, 'lib', 'node_modules')]) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** 读 <installRoot>/<pkgName>/package.json 的 version（读不到返回 null）。 */
function _readInstalledVersion({ installRoot, pkgName }) {
    if (!installRoot) return null;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(installRoot, ...pkgName.split('/'), 'package.json'), 'utf8'));
        return pkg.version || null;
    } catch {
        return null;
    }
}

/**
 * 清理本次运行的下载临时目录（幂等）。
 * 清理结果记在 staging 上并随 --json 输出返回——「清理」因此是**可审计的输出**，
 * 而不是调用方只能靠扫 os.tmpdir 全局状态去猜。
 * @param {{dir: string | null, cleaned: boolean | null}} staging
 */
async function _cleanupStaging(staging) {
    if (!staging.dir || staging.cleaned !== null) return;
    try {
        // win32 上杀毒/索引器可能短暂占用刚写入的 tarball：让 fs.rm 自带重试
        await fsp.rm(staging.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        staging.cleaned = true;
    } catch {
        staging.cleaned = false;
    }
}

/**
 * --from-release 主流程：取 release → 挑 asset → （--check 到此为止）下载 → 安装 → 回读校验。
 * @param {object} opts
 * @param {object} opts.args      parseUpdateArgs 结果
 * @param {boolean} opts.jsonMode
 * @param {string} opts.current   当前 CLI 版本
 * @returns {Promise<{ok: boolean, [key: string]: any}>}
 */
async function _updateFromRelease({ args, jsonMode, current }) {
    const emitJson = (data) => {
        if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    };
    const log = (line) => process.stderr.write(`[update] ${line}\n`);

    /** 本次运行的下载临时目录状态（dir 为空 = 还没创建；cleaned 为 null = 还没清理） */
    const staging = { dir: null, cleaned: null };
    try {
        // ① release 元数据
        const api = _normalizeApiBase(args.releaseApi || DEFAULT_RELEASE_API);
        const repo = await resolveReleaseRepo({ explicit: args.releaseRepo });
        log(`release 来源: ${repo}${args.tag ? `@${args.tag}` : '（latest）'} @ ${api}`);
        const release = await fetchRelease({ api, repo, tag: args.tag });

        // ② 两个 asset
        const { core, cli } = pickReleaseAssets(release, { repo });
        const tag = release.tag_name || release.name || (args.tag || '');
        const version = String(tag).replace(/^v/i, '');
        const upToDate = compareVersions(current, version) >= 0;

        const assetsInfo = {
            core: { name: core.name, size: Number(core.size) || 0, url: core.browser_download_url },
            cli: { name: cli.name, size: Number(cli.size) || 0, url: cli.browser_download_url },
        };

        // ③ --check：只报告，不下载不安装（不创建临时目录，也不碰 node_modules）
        if (args.checkOnly) {
            log(`当前 v${current} / Release ${tag} / ${upToDate ? '已是最新（或更高）' : '可更新'}（--check 不下载不安装）`);
            log(`asset: ${core.name}（${_humanSize(core.size)}）`);
            log(`asset: ${cli.name}（${_humanSize(cli.size)}）`);
            emitJson({
                ok: true,
                mode: 'release',
                check: true,
                current,
                repo,
                tag,
                version,
                upToDate,
                assets: assetsInfo,
            });
            return { ok: true, mode: 'release', check: true, current, tag, version, upToDate, assets: assetsInfo };
        }

        // ④ 交互确认（--yes / --json 跳过；非 TTY 自动拒绝）
        const confirmed = args.yes || jsonMode ? true : await confirmUpdate({ current, latest: version });
        if (!confirmed) {
            process.stderr.write('已取消更新。\n');
            emitJson({ ok: true, mode: 'release', skipped: 'declined', current, tag, version });
            return { ok: true, mode: 'release', skipped: 'declined', current, tag, version };
        }

        // ⑤ 下载到独立临时目录（无论成功/失败都在 finally 里删）
        staging.dir = await fsp.mkdtemp(path.join(os.tmpdir(), '3rdloop-release-'));
        const coreFile = await _downloadAsset({ asset: core, label: '核心包', dir: staging.dir });
        const cliFile = await _downloadAsset({ asset: cli, label: 'CLI 包', dir: staging.dir });

        // ⑥ 安装（一次 npm install -g 两个 tarball：CLI 依赖核心包，分开装会去 registry 找旧版）
        const prefix = String(args.prefix || '').trim();
        _installTarballs({ coreFile: coreFile.file, cliFile: cliFile.file, prefix, registry: args.registry });

        // ⑦ 回读校验：装上的版本必须与 release tag 一致
        const installRoot = _globalInstallRoot({ prefix });
        const installedCli = _readInstalledVersion({ installRoot, pkgName: PKG_NAME });
        const installedCore = _readInstalledVersion({ installRoot, pkgName: CORE_PKG_NAME });
        const versionMismatch = installedCli !== version || installedCore !== version;
        if (versionMismatch) {
            process.stderr.write(
                `[update] ⚠ 版本校验不一致：release ${tag}（${version}）` +
                ` / 已安装 CLI ${installedCli || '(读不到)'}、核心包 ${installedCore || '(读不到)'}\n` +
                `        安装根目录: ${installRoot || '(未知)'}\n` +
                `        若附件与 tag 不匹配，请核对 release 的 tarball 版本。\n`
            );
        }

        await _cleanupStaging(staging);
        const result = {
            ok: true,
            mode: 'release',
            check: false,
            current,
            repo,
            tag,
            version,
            upToDate,
            assets: assetsInfo,
            prefix: prefix || null,
            installRoot,
            installed: { cli: installedCli, core: installedCore },
            versionMismatch,
            // 本次下载用的临时目录与清理结果（可审计，调用方不必去扫 os.tmpdir）
            download: { dir: staging.dir, cleaned: staging.cleaned },
        };
        emitJson(result);
        log(`更新完成：v${current} → ${installedCli || version}`);
        return result;
    } catch (err) {
        const msg = err?.message || String(err);
        process.stderr.write(`\n[update] ${msg}\n`);
        await _cleanupStaging(staging);
        emitJson({
            ok: false,
            mode: 'release',
            error: msg,
            download: staging.dir ? { dir: staging.dir, cleaned: staging.cleaned } : null,
        });
        return { ok: false, mode: 'release', error: msg };
    } finally {
        // 兜底：catch 里再抛（例如 stderr 写失败）时也要收干净
        await _cleanupStaging(staging);
    }
}

// ── 主入口 ───────────────────────────────────────────────────────

/**
 * update 命令主入口。
 * @param {object} opts
 * @param {boolean} opts.jsonMode
 * @param {string[]} opts.rest  位置参数 + flags
 * @returns {Promise<{ok: boolean, skipLink?: boolean, message?: string, current?: string, latest?: string}>}
 */
export async function cmdUpdateImpl({ jsonMode = false, rest = [] } = {}) {
    const args = parseUpdateArgs(rest);
    const checkOnly = args.checkOnly;
    const yes = args.yes;
    const registry = args.registry;

    // update 用法说明（--help，离线可测，不触碰网络）
    if (args.help) {
        const help = [
            '用法: 3rdloop update [--check] [--yes] [--registry <url>]',
            '     3rdloop update --from-release [<tag>] [--check] [--yes]',
            '                     [--release-api <base>] [--release-repo <owner/repo>] [--prefix <dir>]',
            '',
            '  默认: 检测本地版本与 npm registry 最新版，差异存在时交互确认后重装',
            '  --check           仅检查是否有新版本，不执行更新',
            '  --yes, -y         跳过交互确认直接更新（非 TTY 必须）',
            '  --registry <url>  覆盖 npm registry（默认尊重用户 npm 镜像配置）',
            '',
            '  --from-release        从 GitHub Release 的两个 tarball（核心包 + CLI 包）安装；',
            '                        不给 tag 时取 latest，给 tag 时取该 tag（如 --from-release v0.0.12）',
            '  --release-api <base>  Release API 基地址（默认 https://api.github.com；自建镜像/测试用）',
            '  --release-repo <r>    仓库 owner/repo（默认从 CLI 包或核心包的 repository 字段推导）',
            '  --prefix <dir>        把「全局安装」落到指定前缀（测试用；正式使用不传 = 系统全局目录）',
            '  说明: --check 可与 --from-release 组合，只报告版本与附件，不下载不安装',
            '  说明: 值型开关支持 `--flag=value` 写法（如 --registry=https://registry.npmjs.org/）',
            '  注意: 数据目录 ~/.3lib/3rdloop/db 与 SKILL 配置不受更新影响',
        ].join('\n');
        process.stdout.write(help + '\n');
        return { ok: true, helped: true };
    }

    // 拒绝未知选项与多余位置参数（保持命令简单）。
    // 判据由 `parseUpdateArgs` 统一给出：已知开关与已知开关的取值放行，其余算未知。
    // 早先这里按"是否以 -- 开头"判定，导致 `--registry <url>` 与 `-y` 被当成位置参数拒绝。
    const unknowns = args.unknowns;
    if (unknowns.length > 0) {
        process.stderr.write(`未知参数: ${unknowns.join(' ')}（update 只接受下列开关：${[...KNOWN_FLAGS].join(' ')}）\n`);
        if (args.fromRelease) {
            process.stderr.write('提示: tag 必须紧跟 --from-release，例如 --from-release v0.0.12\n');
        }
        if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, error: '未知参数' }, null, 2) + '\n');
        return { ok: false, error: '未知参数' };
    }

    const run = await import('./config.js');
    const current = run.getCliVersion();

    // ── GitHub Release 附件路径 ──────────────────────────────────
    if (args.fromRelease) {
        return _updateFromRelease({ args, jsonMode, current });
    }

    // ── 以下为默认 npm registry 路径（行为保持不变）──────────────
    const latest = await fetchLatestVersion({ registry });
    if (!latest) {
        const msg = `无法查询 ${PKG_NAME} 的 registry 最新版本（网络或镜像配置问题）`;
        process.stderr.write(`\n[update] ${msg}\n`);
        if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
        return { ok: false, error: msg };
    }

    if (jsonMode) {
        process.stdout.write(JSON.stringify({
            ok: true,
            latest,
            current,
            upToDate: compareVersions(current, latest) >= 0,
        }, null, 2) + '\n');
        if (!checkOnly) {
            // --json 下不交互，直接更新（用户显式要求命令行为，等价 --yes）
            try {
                const r = performUpdate({ latest, registry });
                process.stdout.write(JSON.stringify({ ...r, ok: true }, null, 2) + '\n');
                return { ok: true, ...r };
            } catch (err) {
                const msg = `更新失败: ${err.message}`;
                process.stderr.write(`\n[update] ${msg}\n`);
                return { ok: false, error: msg };
            }
        }
        return { ok: true, current, latest };
    }

    // ── 非 JSON 模式 ──────────────────────────────────────────
    process.stderr.write(`当前版本: ${current}  最新版本: ${latest}\n`);

    if (compareVersions(current, latest) >= 0) {
        process.stderr.write(`\n[update] 已是最新版本，无需更新。\n`);
        return { ok: true, upToDate: true, current, latest };
    }

    if (checkOnly) {
        process.stderr.write(`\n[update] 可更新到 ${latest}（使用 "3rdloop update" 执行更新）\n`);
        return { ok: true, current, latest };
    }

    // 交互确认（非 TTY 自动拒绝；--yes 跳过）
    const confirmed = yes ? true : await confirmUpdate({ current, latest });

    if (jsonMode) {
        if (!confirmed) {
            process.stdout.write(JSON.stringify({ ok: true, confirmed: false }, null, 2) + '\n');
            return { ok: true, skipped: 'declined' };
        }
    }

    if (!confirmed) {
        process.stderr.write(`已取消更新。\n`);
        return { ok: true, skipped: 'declined' };
    }

    process.stderr.write(`\n`);
    try {
        const r = performUpdate({ latest, registry });
        return { ok: true, ...r };
    } catch (err) {
        const msg = `更新失败: ${err.message}`;
        process.stderr.write(`\n[update] ${msg}\n`);
        return { ok: false, error: msg };
    }
}
