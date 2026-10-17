/**
 * mcp.js —— 3rdloop mcp：MCP Gateway 一键装配（install / uninstall / status）
 *
 * 背景：npm 包内 vendor/ 携带 MCP Gateway（vendor/MCP）、知识库检索引擎
 * （vendor/Archive）、已知问题知识库种子（vendor/BadCase），但 AI CLI
 * （opencode / deveco-code）需要在其**全局配置**里注册 mcp-gateway 才会在
 * serve 启动时 spawn Gateway。本命令完成装配：
 *
 *   3rdloop mcp install [--cli opencode|deveco|all] [--force]
 *     ① 生成用户级 Gateway 配置 ~/.3lib/3rdloop/mcp/config.json
 *        - scriptsDir / enginePath → 包内（vendor，随包更新获得新脚本/引擎）
 *        - knowledgeBase.dataDir → ~/.3lib/3rdloop/kb-data（用户数据，跨版本不丢）
 *     ② 种子复制：kb-data（← vendor/Archive/data）、BadCase 副本
 *        （← vendor/BadCase，泛化 SKILL 的可写知识库）
 *     ③ 注册 mcp-gateway 到 ~/.config/opencode/opencode.json 与
 *        ~/.config/deveco/deveco.jsonc（保留其他字段，幂等可重跑）
 *
 *   3rdloop mcp uninstall [--cli ...]   仅移除注册条目（用户数据保留）
 *   3rdloop mcp status                  查看注册状态与路径
 *
 * 设计约束：
 *   - 仓库开发态（npm link，无 vendor/）自动回退仓库 MCP/、Archive/、BadCase/
 *   - 用户已有 ~/.3lib/3rdloop/mcp/config.json 时仅刷新路径字段，
 *     保留 downstreamServers 等用户改动（--force 重置为包内默认）
 *   - deveco.jsonc 为 JSONC：容错解析（去注释重试），解析失败提示手动配置
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { resolveCliType } from './config.js';
import { resolveCoreRootsOrNull } from './core-paths.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = path.resolve(moduleDir, '..');

/** 注册到 AI CLI 全局配置的条目名（与既有生态约定一致） */
export const MCP_ENTRY_NAME = 'mcp-gateway';

/** AI CLI 全局配置文件位置（按平台） */
function aiCliConfigPaths() {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || '';
    const configRoot = process.env['XDG_CONFIG_HOME'] || path.join(home, '.config');
    return {
        opencode: path.join(configRoot, 'opencode', 'opencode.json'),
        'deveco-code': path.join(configRoot, 'deveco', 'deveco.jsonc'),
    };
}

// ─── 包内资产定位（核心树优先，vendor / 仓库开发态回退）────────────────

let _assetsCache = null;

/**
 * 定位 MCP / Archive / BadCase 资产目录。
 *
 * 双包发布态下资产随核心包走（`node_modules/@ohos-cpf/3rdloop_core/{MCP,Archive,BadCase}`），
 * 由 core-paths.js 的四级解析统一给出；`vendor` / 仓库根两级保留为本地回退。
 *
 * @returns {{ mcpDir: string, archiveDir: string, badcaseDir: string, mode: 'core'|'vendor'|'repo', source: string }}
 * @throws {Error} 三级路径均不存在
 */
export function resolveAssets() {
    if (_assetsCache) return _assetsCache;

    const coreRoot = resolveCoreRootsOrNull()?.coreRoot || '';
    const repoRoot = path.resolve(CLI_ROOT, '..');

    const tryDirs = [
        { root: coreRoot, mode: 'core', source: `核心树（${coreRoot || '未解析'}）` },
        { root: path.join(CLI_ROOT, 'vendor'), mode: 'vendor', source: '包内 vendor/' },
        { root: repoRoot, mode: 'repo', source: '仓库根' },
    ];
    for (const { root, mode, source } of tryDirs) {
        if (!root) continue;
        const mcpDir = path.join(root, 'MCP');
        if (fs.existsSync(path.join(mcpDir, 'src', 'index.js'))) {
            _assetsCache = {
                mcpDir,
                archiveDir: path.join(root, 'Archive'),
                badcaseDir: path.join(root, 'BadCase'),
                mode,
                source,
            };
            return _assetsCache;
        }
    }
    throw new Error(
        `无法定位 MCP Gateway：核心树 / cli/vendor / 仓库根下都没有 MCP/src/index.js。` +
        `npm 安装态请重装包（npm i -g @ohos-cpf/3rdloop），仓库态请在 cli/ 上一级执行`
    );
}

// ─── 用户级路径 ────────────────────────────────────────────────────────

/**
 * 用户级路径集合（kb 数据 / BadCase 副本 / Gateway 配置）。
 * @param {string} user3libHome - ~/.3lib
 */
export function userPaths(user3libHome) {
    const loopHome = path.join(user3libHome, '3rdloop');
    return {
        loopHome,
        mcpConfigDir: path.join(loopHome, 'mcp'),
        mcpConfig: path.join(loopHome, 'mcp', 'config.json'),
        kbDataDir: path.join(loopHome, 'kb-data'),
        badcaseDir: path.join(loopHome, 'BadCase'),
    };
}

// ─── 工具函数 ─────────────────────────────────────────────────────────

/** 递归复制目录（跳过 node_modules）。 */
function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

/**
 * 容错读取 JSON / JSONC 配置（带 // 与 /* 注释剥离重试）。
 * @returns {{ ok: boolean, data: object|null, raw: string, error?: string }}
 */
function readJsonc(file) {
    let raw = '';
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
        return { ok: false, data: null, raw: '', error: err.message };
    }
    try {
        return { ok: true, data: JSON.parse(raw), raw };
    } catch { /* 尝试剥注释 */ }
    const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
    try {
        return { ok: true, data: JSON.parse(stripped), raw };
    } catch (err) {
        return { ok: false, data: null, raw, error: `JSONC 解析失败: ${err.message}` };
    }
}

/** 合并写入 AI CLI 全局配置的 mcp.mcp-gateway 条目（保留其他字段）。 */
function upsertMcpEntry(file, entry, { createIfMissing = true } = {}) {
    const existed = fs.existsSync(file);
    if (!existed && !createIfMissing) return { ok: true, skipped: true };

    const parsed = existed ? readJsonc(file) : { ok: true, data: {} };
    if (!parsed.ok) {
        return { ok: false, error: `${file} ${parsed.error}（可手动编辑，或删除该文件后重跑 3rdloop mcp install）` };
    }
    const data = parsed.data || {};
    if (!data.mcp || typeof data.mcp !== 'object') data.mcp = {};
    data.mcp[MCP_ENTRY_NAME] = entry;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    return { ok: true, skipped: false, existed };
}

/** 从 AI CLI 全局配置移除 mcp.mcp-gateway 条目（文件不存在视为成功）。 */
function removeMcpEntry(file) {
    if (!fs.existsSync(file)) return { ok: true, removed: false };
    const parsed = readJsonc(file);
    if (!parsed.ok) {
        return { ok: false, error: `${file} ${parsed.error}（请手动删除其中的 "${MCP_ENTRY_NAME}" 条目）` };
    }
    const data = parsed.data || {};
    let removed = false;
    if (data.mcp && typeof data.mcp === 'object' && MCP_ENTRY_NAME in data.mcp) {
        delete data.mcp[MCP_ENTRY_NAME];
        removed = true;
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    }
    return { ok: true, removed };
}

/** 读取某 AI CLI 配置中 mcp-gateway 的注册状态。 */
function readMcpEntry(file) {
    if (!fs.existsSync(file)) return { state: 'missing-file' };
    const parsed = readJsonc(file);
    if (!parsed.ok) return { state: 'parse-error', error: parsed.error };
    const entry = parsed.data?.mcp?.[MCP_ENTRY_NAME];
    if (!entry) return { state: 'missing-entry' };
    return { state: 'registered', entry };
}

// ─── install ──────────────────────────────────────────────────────────

/**
 * 生成/刷新用户级 Gateway 配置。
 * 已存在时仅刷新 scriptsDir/enginePath/gateway/scripts 策略（保留 downstreamServers
 * 与用户自定义 dataDir），force 时以包内 config 为模板重置。
 */
function writeUserMcpConfig({ userMcpConfig, templateConfig, assets, kbDataDir, force }) {
    const existed = fs.existsSync(userMcpConfig);
    const current = existed ? readJsonc(userMcpConfig) : null;
    if (existed && !current.ok) {
        return { ok: false, error: `${userMcpConfig} ${current.error}（可 --force 覆盖或手动修复）` };
    }

    const tmplKb = templateConfig.knowledgeBase || {};
    const curKb = (!force && existed && current.data?.knowledgeBase) || null;

    let cfg;
    if (curKb) {
        // 刷新模式：以现有用户配置为基底
        cfg = current.data;
        cfg.scripts = { ...(templateConfig.scripts || {}), ...(cfg.scripts || {}) };
        cfg.gateway = cfg.gateway || templateConfig.gateway;
    } else {
        // 首次 / --force：以包内模板为基底（深拷贝，含 scripts 策略/downstreamServers）
        cfg = JSON.parse(JSON.stringify(templateConfig));
    }
    if (force) {
        cfg.downstreamServers = templateConfig.downstreamServers || {};
        cfg.gateway = templateConfig.gateway || cfg.gateway;
        cfg.scripts = { ...(templateConfig.scripts || {}) };
    }

    // dataDir：仅当用户改过（≠ 模板默认相对值）才保留，否则统一指向用户 kb-data
    const userSetDataDir = curKb && curKb.dataDir && curKb.dataDir !== tmplKb.dataDir
        ? curKb.dataDir : null;
    const finalDataDir = userSetDataDir || kbDataDir;

    // 路径字段始终刷新为当前安装位置（包更新后路径不变，幂等无害）
    cfg.scriptsDir = path.join(assets.mcpDir, 'scripts');
    cfg.knowledgeBase = {
        ...tmplKb,
        ...(curKb || {}),
        enabled: (curKb?.enabled) ?? tmplKb.enabled ?? true,
        enginePath: path.join(assets.archiveDir, 'src', 'index.js'),
        dataDir: finalDataDir,
    };

    fs.mkdirSync(path.dirname(userMcpConfig), { recursive: true });
    fs.writeFileSync(userMcpConfig, JSON.stringify(cfg, null, 2) + '\n');
    return { ok: true, existed, config: cfg };
}

/**
 * 3rdloop mcp install 实现。
 * @param {object} opts
 * @param {string} opts.user3libHome - ~/.3lib
 * @param {string[]} opts.rest - 命令参数（--cli / --force）
 * @param {boolean} opts.jsonMode
 * @returns {Promise<number>} 退出码
 */
export async function mcpInstall({ user3libHome, rest = [], jsonMode = false }) {
    const cliFilter = _parseCliFilter(rest); // 'all' | 'opencode' | 'deveco-code'
    const force = rest.includes('--force');
    const out = (data) => { if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n'); };
    const log = (msg) => process.stderr.write(`${msg}\n`);

    const assets = resolveAssets();
    const up = userPaths(user3libHome);

    // ① 包内模板 config（downstreamServers / gateway / 脚本策略）
    const templateFile = path.join(assets.mcpDir, 'config.json');
    if (!fs.existsSync(templateFile)) {
        log(`错误: 未找到 Gateway 配置模板: ${templateFile}`);
        return 1;
    }
    const templateConfig = JSON.parse(fs.readFileSync(templateFile, 'utf8'));

    // ② 用户级 Gateway 配置
    const writeResult = writeUserMcpConfig({
        userMcpConfig: up.mcpConfig,
        templateConfig,
        assets,
        kbDataDir: up.kbDataDir,
        force,
    });
    if (!writeResult.ok) {
        log(`错误: ${writeResult.error}`);
        return 1;
    }

    // ③ 种子数据（目录已存在则跳过，保用户数据）
    const seeds = [
        { src: path.join(assets.archiveDir, 'data'), dst: up.kbDataDir, label: '知识库数据' },
        { src: assets.badcaseDir, dst: up.badcaseDir, label: 'BadCase 已知问题知识库' },
    ];
    const seeded = [];
    for (const { src, dst, label } of seeds) {
        if (fs.existsSync(dst)) continue;
        if (!fs.existsSync(src)) continue; // 仓库缺该资产时跳过（prepack 有警告）
        copyDir(src, dst);
        seeded.push({ label, dst });
    }

    // ④ 注册到 AI CLI 全局配置
    const entry = {
        command: ['node', path.join(assets.mcpDir, 'src', 'index.js'), '--config', up.mcpConfig],
        enabled: true,
        type: 'local',
    };
    const targets = cliFilter === 'all'
        ? Object.keys(aiCliConfigPaths())
        : [cliFilter];
    const registered = [];
    const failures = [];
    for (const cliType of targets) {
        const file = aiCliConfigPaths()[cliType];
        const res = upsertMcpEntry(file, entry);
        if (!res.ok) failures.push(res.error);
        else registered.push({ cliType, file, existed: !!res.existed });
    }
    if (failures.length > 0) {
        for (const f of failures) log(`错误: ${f}`);
        return 1;
    }

    if (jsonMode) {
        out({
            ok: true,
            mode: assets.mode,
            userConfig: up.mcpConfig,
            kbDataDir: up.kbDataDir,
            badcaseDir: up.badcaseDir,
            seeded,
            registered,
        });
    } else {
        log(`[3rdloop mcp] Gateway 来源: ${assets.source}`);
        log(`[3rdloop mcp] 用户配置: ${up.mcpConfig}${writeResult.existed && !force ? '（已存在，仅刷新路径）' : ''}`);
        log(`[3rdloop mcp] 知识库数据目录: ${up.kbDataDir}`);
        log(`[3rdloop mcp] BadCase 副本: ${up.badcaseDir}`);
        for (const s of seeded) log(`[3rdloop mcp] 已种子复制 ${s.label} → ${s.dst}`);
        for (const r of registered) {
            log(`[3rdloop mcp] 已注册 ${MCP_ENTRY_NAME} → ${r.file}${r.existed ? '（覆盖旧条目）' : ''}`);
        }
        log(`[3rdloop mcp] 完成。重启 ${targets.join(' / ')} serve 后 AI 会话即可使用 MCP 工具`);
    }
    return 0;
}

// ─── uninstall / status ───────────────────────────────────────────────

export async function mcpUninstall({ rest = [], jsonMode = false }) {
    const cliFilter = _parseCliFilter(rest);
    const out = (data) => { if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n'); };
    const log = (msg) => process.stderr.write(`${msg}\n`);

    const targets = cliFilter === 'all' ? Object.keys(aiCliConfigPaths()) : [cliFilter];
    const removed = [];
    const failures = [];
    for (const cliType of targets) {
        const file = aiCliConfigPaths()[cliType];
        const res = removeMcpEntry(file);
        if (!res.ok) failures.push(res.error);
        else if (res.removed) removed.push({ cliType, file });
    }
    if (failures.length > 0) {
        for (const f of failures) log(`错误: ${f}`);
        return 1;
    }
    if (jsonMode) out({ ok: true, removed });
    else if (removed.length === 0) log('[3rdloop mcp] 未发现已注册的条目，无需卸载');
    else for (const r of removed) log(`[3rdloop mcp] 已移除 ${MCP_ENTRY_NAME} → ${r.file}`);
    log('[3rdloop mcp] 用户数据（kb-data / BadCase / config）已保留，可随时重新 install');
    return 0;
}

export async function mcpStatus({ user3libHome, jsonMode = false }) {
    const out = (data) => { if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n'); };
    const log = (msg) => process.stderr.write(`${msg}\n`);

    let assets;
    try {
        assets = resolveAssets();
    } catch (err) {
        if (jsonMode) out({ ok: false, error: err.message });
        else log(`错误: ${err.message}`);
        return 1;
    }
    const up = userPaths(user3libHome);

    const registrations = {};
    for (const [cliType, file] of Object.entries(aiCliConfigPaths())) {
        const st = readMcpEntry(file);
        registrations[cliType] = { file, state: st.state, entry: st.entry || null };
    }

    const result = {
        ok: true,
        mode: assets.mode,
        gateway: path.join(assets.mcpDir, 'src', 'index.js'),
        userConfig: up.mcpConfig,
        userConfigExists: fs.existsSync(up.mcpConfig),
        kbDataDir: up.kbDataDir,
        kbDataSeeded: fs.existsSync(up.kbDataDir),
        badcaseDir: up.badcaseDir,
        badcaseSeeded: fs.existsSync(up.badcaseDir),
        registrations,
    };

    if (jsonMode) {
        out(result);
    } else {
        log(`Gateway 来源: ${assets.source}（${result.gateway}）`);
        log(`用户配置: ${up.mcpConfig}${result.userConfigExists ? '' : '（未生成，先 3rdloop mcp install）'}`);
        log(`知识库数据: ${up.kbDataDir}${result.kbDataSeeded ? '' : '（未初始化）'}`);
        log(`BadCase 副本: ${up.badcaseDir}${result.badcaseSeeded ? '' : '（未初始化）'}`);
        for (const [cliType, r] of Object.entries(registrations)) {
            const icon = r.state === 'registered' ? '✓' : '✗';
            const detail = r.state === 'registered'
                ? `已注册 (${r.file})`
                : r.state === 'missing-file' ? `未注册（配置文件不存在: ${r.file}）`
                : r.state === 'missing-entry' ? `未注册（${r.file} 无 ${MCP_ENTRY_NAME} 条目）`
                : `解析失败: ${r.file}`;
            log(`${icon} ${cliType}: ${detail}`);
        }
        const anyRegistered = Object.values(registrations).some(r => r.state === 'registered');
        if (!anyRegistered) log('提示: 执行 3rdloop mcp install 完成装配');
    }
    return 0;
}

// ─── 命令入口 ─────────────────────────────────────────────────────────

/**
 * 3rdloop mcp 命令入口（子命令分发）。
 * @param {object} opts
 * @param {string[]} opts.rest - flags.rest（含子命令与参数）
 * @param {string} opts.user3libHome - ~/.3lib
 * @param {boolean} opts.jsonMode
 * @returns {Promise<number>} 退出码
 */
export async function cmdMcp({ rest = [], user3libHome = '', jsonMode = false }) {
    if (rest.includes('--help') || rest.includes('-h')) {
        printMcpHelp();
        return 0;
    }

    // 位置子命令 = 第一个非 flag 参数（--cli 的值跳过）
    let subcommand = null;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--cli') { i++; continue; }
        if (rest[i].startsWith('--')) continue;
        subcommand = rest[i];
        break;
    }

    try {
        if (subcommand === 'install') return await mcpInstall({ user3libHome, rest, jsonMode });
        if (subcommand === 'uninstall') return await mcpUninstall({ rest, jsonMode });
        if (subcommand === 'status') return await mcpStatus({ user3libHome, jsonMode });
        if (subcommand === null && rest.length === 0) {
            printMcpHelp();
            return 0;
        }
        if (subcommand !== null) {
            process.stderr.write(`未知子命令: ${subcommand}\n`);
        } else {
            process.stderr.write(`未知参数: ${rest.join(' ')}\n`);
        }
        printMcpHelp();
        return 1;
    } catch (err) {
        process.stderr.write(`错误: ${err.message}\n`);
        return 1;
    }
}

// ─── 帮助 / 参数 ──────────────────────────────────────────────────────

function _parseCliFilter(rest) {
    const idx = rest.indexOf('--cli');
    const raw = idx !== -1 ? rest[idx + 1] : undefined;
    if (!raw || raw === 'all') return 'all';
    if (raw === 'opencode') return 'opencode';
    if (raw === 'deveco' || raw === 'deveco-code') return 'deveco-code';
    throw new Error(`非法 --cli 值: "${raw}"（可选: opencode | deveco | all）`);
}

export function printMcpHelp() {
    process.stdout.write(`3rdloop mcp —— MCP Gateway 装配（npm 安装态必需，仓库开发态可选）

用法:
  3rdloop mcp install [--cli opencode|deveco|all] [--force]
      ① 生成用户级 Gateway 配置 ~/.3lib/3rdloop/mcp/config.json
         （scriptsDir/enginePath 指向包内 vendor，kb 数据落在 ~/.3lib/3rdloop/kb-data）
      ② 种子复制知识库数据（kb-data）与 BadCase 已知问题知识库到用户目录
      ③ 注册 mcp-gateway 到 opencode / deveco 全局配置（幂等，可重跑）
      --force 重置用户级配置为包内默认（downstreamServers 等）
  3rdloop mcp uninstall [--cli opencode|deveco|all]
      仅移除注册条目；用户数据（kb-data / BadCase / config）保留
  3rdloop mcp status
      查看注册状态、用户配置与数据目录

说明:
  - opencode/deveco serve 启动时会按全局配置自动 spawn MCP Gateway，
    AI 会话即可调用 kb 搜索、覆盖率分析脚本等工具
  - 安装/更新 npm 包后路径不变，注册条目持续有效；包更新后新脚本
    自动可用（scriptsDir 随包）
  - 默认注册到 opencode 与 deveco 两处（--cli 可限定）
`);
}
