/**
 * update.js —— 自更新（3rdloop update）
 *
 * 职责：
 *   - 检测本地版本（getCliVersion）与 npm registry 最新版
 *   - 识别开发态（npm link 软链）与正式全局安装
 *   - 交互确认后通过 npm install -g 重装
 *
 * 交互/输出契约：
 *   - 进度/日志 → stderr；--json 结构化结果 → stdout
 *   - 非 TTY 下交互确认自动拒绝（需 --yes 配合脚本化更新）
 *
 * 安全：
 *   - registry 默认尊重用户 npm 配置（镜像源），--registry 可覆盖
 *   - 全部经 child_process.execFileSync 调 npm，避免 shell 注入
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 本文件在 cli/lib/ 下
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_NAME = '@ohos-cpf/3rdloop';
const BIN_ABS = path.join(CLI_ROOT, 'bin', '3rdloop.mjs');

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
 * 检测当前命令是否为 npm link 软链（开发态）。
 *
 * 原理：npm link 的全局 bin 是指向仓库 bin 的软链；真实全局安装则是
 * node_modules 内的副本。比较 process.argv[1] 与仓库内 bin 的 realpath 是否相同。
 */
export function detectLinkMode(argv1 = process.argv[1]) {
    try {
        const realArgv = fs.realpathSync(argv1 || '');
        const realLocal = fs.realpathSync(BIN_ABS);
        return realArgv === realLocal;
    } catch {
        return false;
    }
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
        const out = execFileSync('npm', args, {
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
        const out = execFileSync('npm', ['config', 'get', 'registry'], {
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
 * 执行更新。
 * @param {object} opts
 * @param {string} opts.latest        目标版本（registry latest）
 * @param {string} [opts.registry]    registry 覆盖
 * @param {boolean} [opts.force]      开发态也强制替换
 * @param {boolean} [opts.isLink]     是否 link 模式（可注入便于测试）
 */
export function performUpdate({ latest, registry, force = false, isLink = detectLinkMode() } = {}) {
    const installArgs = ['install', '-g', `${PKG_NAME}@latest`];
    if (registry) installArgs.push('--registry', registry);

    // 开发态（npm link）：默认警告并跳过，仅提示 git pull
    if (isLink && !force) {
        process.stderr.write(
            `\n[update] 检测到当前为开发态（npm link），已跳过自更新。\n` +
            `  开发态请用 git pull 更新仓库源码（数据目录 ~/.3lib/3rdloop/db 不受影响）。\n` +
            `  如需强制用正式包替换链接，可加 --force。\n`
        );
        return { updated: false, skipped: 'link-mode' };
    }

    // 开发态 + --force：先解除链接
    if (isLink && force) {
        process.stderr.write(`[update] 检测到 npm link，先解除链接...\n`);
        execFileSync('npm', ['unlink', '-g', PKG_NAME], { encoding: 'utf-8', stdio: 'inherit' });
    }

    process.stderr.write(`[update] 卸载旧版本（@${PKG_NAME}）...\n`);
    try {
        execFileSync('npm', ['uninstall', '-g', PKG_NAME], { encoding: 'utf-8', stdio: 'inherit' });
    } catch { /* 卸载失败不阻断重装 */ }

    process.stderr.write(`[update] 安装最新版本...\n`);
    execFileSync('npm', installArgs, { encoding: 'utf-8', stdio: 'inherit' });

    return { updated: true, version: latest };
}

/**
 * update 命令主入口。
 * @param {object} opts
 * @param {boolean} opts.jsonMode
 * @param {string[]} opts.rest  位置参数 + flags
 * @returns {Promise<{ok: boolean, skipLink?: boolean, message?: string, current?: string, latest?: string}>}
 */
export async function cmdUpdateImpl({ jsonMode = false, rest = [] } = {}) {
    const checkOnly = rest.includes('--check');
    const yes = rest.includes('--yes') || rest.includes('-y');
    const force = rest.includes('--force');
    const regIdx = rest.indexOf('--registry');
    const registry = regIdx !== -1 ? rest[regIdx + 1] : undefined;

    // update 用法说明（--help，离线可测，不触碰网络）
    if (rest.includes('--help') || rest.includes('-h')) {
        const help = [
            '用法: 3rdloop update [--check] [--yes] [--force] [--registry <url>]',
            '',
            '  默认: 检测本地版本与 npm registry 最新版，差异存在时交互确认后重装',
            '  --check           仅检查是否有新版本，不执行更新',
            '  --yes, -y         跳过交互确认直接更新（非 TTY 必须）',
            '  --force           开发态（npm link）也强制替换为 registry 正式包',
            '  --registry <url>  覆盖 npm registry（默认尊重用户 npm 镜像配置）',
            '  注意: 数据目录 ~/.3lib/3rdloop/db 与 SKILL 配置不受更新影响',
        ].join('\n');
        process.stdout.write(help + '\n');
        return { ok: true, helped: true };
    }

    // 拒绝多余的位置参数（保持命令简单）
    const unknowns = rest.filter(a => !a.startsWith('--'));
    if (unknowns.length > 0) {
        process.stderr.write(`未知参数: ${unknowns.join(' ')}（update 不接受位置参数）\n`);
        if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, error: '未知参数' }, null, 2) + '\n');
        return { ok: false, error: '未知参数' };
    }

    const run = await import('./config.js');
    const current = run.getCliVersion();

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
                const r = performUpdate({ latest, registry, force });
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
        const r = performUpdate({ latest, registry, force });
        return { ok: true, ...r };
    } catch (err) {
        const msg = `更新失败: ${err.message}`;
        process.stderr.write(`\n[update] ${msg}\n`);
        return { ok: false, error: msg };
    }
}