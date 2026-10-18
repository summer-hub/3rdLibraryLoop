#!/usr/bin/env node
/**
 * prepack.mjs —— npm pack/publish 前的**本地**打包准备（单包回退 / 本地调试工具）
 *
 * ⚠ 双包发布形态**不再使用 vendor**：核心随 `@summer-hub/3rdloop_core` 一起发布，
 * 安装态 CLI 从 node_modules 解析核心树（`cli/lib/core-paths.js` 四级解析的第②级），
 * `cli/package.json` 的 files 白名单**不含 vendor**，因此本脚本的产物不会进 CLI tarball。
 * 保留它的理由已缩小为三条：
 *   - 单包形态（把核心副本塞进 CLI 包）的遗留回退；
 *   - 离线/本地调试：生成 cli/vendor 供四级解析的第③级命中（不依赖 npm i 核心包）；
 *   - 生成 vendor/Web/public（核心前端的副本），让第③级 vendor 态自洽——
 *     核心前端已随核心包发布，`cli/web` 已退役，CLI 包内不再有任何前端副本。
 *
 * 作用：
 *   - 将仓库 Server/ 核心引擎复制到 cli/vendor/Server/（保持目录结构，
 *     使内部相对 import 全部保真）
 *   - 将 MCP/（Gateway + 脚本）、Archive/（kb 检索引擎 + 种子数据）、
 *     BadCase/（已知问题知识库种子）复制到 vendor/ 下平级目录：
 *       vendor/Server   ← Server/ 核心模块
 *       vendor/MCP      ← MCP Gateway（src/scripts/config.json）
 *       vendor/Archive  ← 文档检索引擎（src/ + data/ 种子）
 *       vendor/BadCase  ← 已知问题知识库种子数据
 *     平级布局使 SKILL.md 中的相对路径
 *     `{{skillDir}}/../../../MCP/scripts/...`（skillDir=vendor/Server/Skills/<x>）
 *     与 McpToolGuide 的 `Server/library → ../../MCP/config.json`
 *     在 npm 安装态与仓库开发态行为一致。
 *   - 写入 vendor/VERSION（关联 Server 代码版本，防漂移）
 *   - 校验清理 vendor 内的密钥/敏感文件
 *
 * 触发时机：npm run prepack（npm pack / npm publish 前自动执行）
 *
 * 实际是幂等的：重复执行会覆盖旧的 vendor 副本。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ 的上一级 = cli/
const CLI_ROOT = path.resolve(__dirname, '..');
// cli/ 的上一级 = 仓库根
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');

const SERVER_SRC = path.join(PROJECT_ROOT, 'Server');
const VENDOR_DIR = path.join(CLI_ROOT, 'vendor');
const VENDOR_SERVER = path.join(VENDOR_DIR, 'Server');

// 需要复制进 vendor 的核心模块
const CORE_MODULES = [
    'Agent',
    'Brain',
    'CLI',
    // 依赖装配唯一入口（buildApp）：runner.js 发布态要从 vendor/Server 动态 import 它，
    // 漏复制会让 CLI 报 module not found（开发态因回退仓库 Server/ 而察觉不到）。
    'composition',
    'DbUse',
    'FlexRunner',
    'Knowledge',
    'library',
    'LoopEngine',
    'Orchestrator',
    'Routes',
    'Skills',
    'TestCheck',
];

// 需要排除的危险/环境文件（密钥、签名、节点模块）
const EXCLUDE = [
    '.env',
    '.env.*',
    '*.signing',
    'node_modules',
    'db',
    '.git',
];

function shouldExclude(rel, isTopLevel = false) {
    const base = path.basename(rel);
    if (base === '.env' || base.startsWith('.env.')) return true;
    if (base === '.signing') return true;
    if (base === 'node_modules' || base === '.git') return true;
    // 运行时数据目录：仅排除复制根第一层的 db/（开发期残留的 SQLite 数据）。
    // 注意 Archive/src/db 是源码目录，嵌套层不能排除。
    if (isTopLevel && base === 'db') return true;
    // 开发测试产物
    if (base === '__tests__') return true;
    if (base === 'test.js' || base.startsWith('test-')) return true;
    if (base.startsWith('repro_')) return true;
    // 内部 AI 文档
    if (base === 'AGENTS.md') return true;
    // 包管理锁文件（依赖统一声明在 cli/package.json，vendor 内不携带）
    if (base === 'package-lock.json') return true;
    return false;
}

/**
 * 递归复制目录（跳过排除项）。
 * @param {string} src
 * @param {string} dst
 * @param {boolean} [isTop] - 当前 src 是否为复制根（控制 db/ 等仅顶层排除项）
 */
function copyDir(src, dst, isTop = true) {
    if (!fs.existsSync(src)) {
        console.error(`[prepack] 警告: 源目录不存在，已跳过: ${src}`);
        return;
    }
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const rel = entry.name;
        if (shouldExclude(rel, isTop)) continue;
        const srcPath = path.join(src, rel);
        const dstPath = path.join(dst, rel);

        if (entry.isDirectory()) {
            copyDir(srcPath, dstPath, false);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

async function main() {
    console.log('——— [prepack] 复制 Server/ 核心引擎到 vendor/ ———');

    if (!fs.existsSync(SERVER_SRC)) {
        console.error('[prepack] 错误: 未找到仓库 Server/ 目录:', SERVER_SRC);
        process.exit(1);
    }

    // 清理旧 vendor/Server（保留上次构建残留的脏文件）
    if (fs.existsSync(VENDOR_SERVER)) {
        fs.rmSync(VENDOR_SERVER, { recursive: true, force: true });
    }
    fs.mkdirSync(VENDOR_DIR, { recursive: true });

    // 复制核心模块
    for (const mod of CORE_MODULES) {
        const srcDir = path.join(SERVER_SRC, mod);
        if (fs.existsSync(srcDir)) {
            copyDir(srcDir, path.join(VENDOR_SERVER, mod));
            console.log(`[prepack] 复制 ${mod}/`);
        } else {
            console.warn(`[prepack] 警告: 跳过不存在的模块 ${mod}`);
        }
    }

    // 单独复制顶层文件（如果有 index/常量文件）
    for (const f of ['index.js', 'package.json']) {
        const srcFile = path.join(SERVER_SRC, f);
        if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, path.join(VENDOR_SERVER, f));
            console.log(`[prepack] 复制 ${f}`);
        }
    }

    // 覆写 vendor/Server/package.json：对齐**核心包**依赖（双包形态下核心树由
    // 仓库根 package.json = @summer-hub/3rdloop_core 声明依赖，CLI 只声明它自己 import 的）
    const vendorPkgPath = path.join(VENDOR_SERVER, 'package.json');
    if (fs.existsSync(vendorPkgPath)) {
        const corePkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
        const vendorPkg = JSON.parse(fs.readFileSync(vendorPkgPath, 'utf8'));
        vendorPkg.dependencies = { ...corePkg.dependencies };
        vendorPkg._comment = 'vendored from Server/; dependencies aligned with @summer-hub/3rdloop_core package.json by prepack';
        fs.writeFileSync(vendorPkgPath, JSON.stringify(vendorPkg, null, 2) + '\n');
        console.log('[prepack] 覆写 vendor/Server/package.json dependencies（对齐核心包）');
    }

    // 写入 VERSION
    let version = 'dev';
    try {
        const corePkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
        version = corePkg.version || 'dev';
    } catch { /* 保持 dev */ }
    // 同时写入源码哈希便于审计
    const hash = _hashDir(VENDOR_SERVER);
    fs.writeFileSync(path.join(VENDOR_DIR, 'VERSION'),
        `${version}\nbuilt=${new Date().toISOString()}\nsha=${hash}\n`
    );

    // ── 核心前端（Web/public → vendor/Web/public）─────────────────────────
    // 核心前端已随核心包 `@summer-hub/3rdloop_core` 发布（files 含 `Web/public`），安装态
    // （第②级）与开发态（第④级）都能命中；CLI 不再自带副本（`cli/web` 已退役）。
    // vendor 态（第③级）是核心树的完整副本，前端也放同一深度，使三级解析同构。
    // tag/issue/prcheck 等二级功能仍以扩展形式留仓库 Web/ext/，不进 npm 包。
    const WEB_SRC = path.join(PROJECT_ROOT, 'Web', 'public');
    const WEB_DST = path.join(VENDOR_DIR, 'Web', 'public');
    if (fs.existsSync(WEB_SRC)) {
        if (fs.existsSync(WEB_DST)) {
            fs.rmSync(WEB_DST, { recursive: true, force: true });
        }
        copyDir(WEB_SRC, WEB_DST);
        console.log('[prepack] 复制 Web/public/ → vendor/Web/public/（第③级 vendor 态的核心前端）');
    } else {
        console.warn('[prepack] 警告: 未找到 Web/public/，vendor 态将没有前端资产');
    }

    // 历史遗留：早期 prepack 把前端复制到 cli/web（CLI 包内副本，已退役）。
    // 老 checkout 里可能残留，顺手清掉，避免旧副本被误当作资产来源。
    const LEGACY_WEB = path.join(CLI_ROOT, 'web');
    if (fs.existsSync(LEGACY_WEB)) {
        fs.rmSync(LEGACY_WEB, { recursive: true, force: true });
        console.log('[prepack] 清理历史遗留 cli/web/（前端已并入核心包）');
    }

    // ── 插件树：仓库根 plugins/ → vendor/plugins/ ─────────────────────────
    // 插件必须随包发布，否则发布态会"内核在、插件不在"：Server 侧的门面
    // （vendor/Server/Agent/SkillSelector/llm/llmClient.js → ../../../../plugins/...）
    // 会指向一个不存在的目录，发布态直接 module not found。
    // 复制到 vendor/ 根（与 vendor/MCP、vendor/Archive 同级）而不是塞进 vendor/Server/，
    // 是为了让「上溯 4 层 = 仓库根」这个相对路径深度在开发态与发布态同构。
    // 插件树自身 import 内核：`plugins/<组>/<名>/index.js` 一律
    // `import { definePlugin } from '../../../core/definePlugin.js'`。
    // 所以"插件随包发布"必须连带内核（core/）、能力契约（seams/）与 profile（profiles/）
    // 一起复制到 vendor/ 根 —— 否则发布态从"内核在、插件不在"变成"插件在、内核不在"，
    // 门面照样 module not found。平级复制使 vendor/ 与仓库根布局同构。
    const PLUGINS_SRC = path.join(PROJECT_ROOT, 'plugins');
    const VENDOR_PLUGINS = path.join(VENDOR_DIR, 'plugins');
    if (fs.existsSync(PLUGINS_SRC)) {
        if (fs.existsSync(VENDOR_PLUGINS)) {
            fs.rmSync(VENDOR_PLUGINS, { recursive: true, force: true });
        }
        copyDir(PLUGINS_SRC, VENDOR_PLUGINS);
        console.log('[prepack] 复制 plugins/ → vendor/plugins/（插件随包发布）');

        const KERNEL_DIRS = [
            { src: 'core', desc: '插件内核（插件入口 import ../../../core/definePlugin.js）' },
            { src: 'seams', desc: '能力契约（seam 形状声明）' },
            { src: 'profiles', desc: 'profile（插件启停与选项）' },
        ];
        for (const { src, desc } of KERNEL_DIRS) {
            const srcDir = path.join(PROJECT_ROOT, src);
            const dstDir = path.join(VENDOR_DIR, src);
            if (!fs.existsSync(srcDir)) {
                console.warn(`[prepack] 警告: 未找到 ${src}/，跳过（发布态插件树将缺 ${desc}）`);
                continue;
            }
            if (fs.existsSync(dstDir)) {
                fs.rmSync(dstDir, { recursive: true, force: true });
            }
            copyDir(srcDir, dstDir);
            console.log(`[prepack] 复制 ${src}/ → vendor/${src}/（${desc}）`);
        }
    } else {
        console.warn('[prepack] 警告: 未找到 plugins/，跳过（发布态 Server 侧插件门面将无实现可加载）');
    }

    // 安全校验：确认 vendor 内无密钥文件
    const securityIssues = _scanSecurity(VENDOR_DIR);
    if (securityIssues.length > 0) {
        console.error('[prepack] 错误: vendor 内发现敏感文件，已中止发布准备:');
        for (const p of securityIssues) console.error(`   ${p}`);
        process.exit(1);
    }

    // ── 配套资产：MCP Gateway / Archive 检索引擎 / BadCase 知识库种子 ──────
    // 平级复制到 vendor/ 下（vendor/MCP、vendor/Archive、vendor/BadCase），
    // 与 vendor/Server 平级以保证相对路径（{{skillDir}}/../../../MCP、
    // McpToolGuide 的 ../../MCP/config.json）在安装态可解析。
    // 依赖不装在各自子 package.json（npm 不为包内文件安装依赖），
    // 统一声明在 cli/package.json（node 模块解析沿目录树向上命中包内 node_modules）。
    const ASSETS = [
        { src: 'MCP', dst: 'MCP', desc: 'MCP Gateway（src/scripts/config.json）' },
        { src: 'Archive', dst: 'Archive', desc: '文档检索引擎（src + data 种子）' },
        { src: 'BadCase', dst: 'BadCase', desc: '已知问题知识库种子（rn）' },
    ];
    for (const { src, dst, desc } of ASSETS) {
        const srcDir = path.join(PROJECT_ROOT, src);
        const dstDir = path.join(VENDOR_DIR, dst);
        if (!fs.existsSync(srcDir)) {
            console.warn(`[prepack] 警告: 未找到 ${src}/，跳过（npm 包将缺少 ${desc}）`);
            continue;
        }
        if (fs.existsSync(dstDir)) {
            fs.rmSync(dstDir, { recursive: true, force: true });
        }
        copyDir(srcDir, dstDir);
        console.log(`[prepack] 复制 ${src}/ → vendor/${dst}/（${desc}）`);
    }

    console.log('[prepack] 完成。');
    console.log(`[prepack] 版本: ${version}, 校验: ${hash}`);
    console.log(`[prepack] vendor 目录: ${VENDOR_DIR}`);
}

/** 计算目录内容 SHA（用于审计）。 */
function _hashDir(dir) {
    const hash = crypto.createHash('sha256');
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                hash.update(`D:${entry.name}\n`);
                walk(full);
            } else {
                hash.update(`F:${path.relative(dir, full)}\n`);
                hash.update(fs.readFileSync(full));
            }
        }
    };
    walk(dir);
    return hash.digest('hex').slice(0, 16);
}

/** 安全扫描跳过的知识内容目录（文档/知识库数据，文件名含 key/credential 属正常语义）。 */
const SCAN_SKIP_DIRS = new Set([
    // 用 path.join 而不是字面量 'Archive/data'：path.relative 在 Windows 返回反斜杠，
    // 字面量分隔符会让跳过表永不命中（第二运行时把知识库文档误报成密钥文件而中止）。
    path.join('Archive', 'data'),   // 知识库文档种子
    'BadCase',                      // 已知问题知识库
]);

/** 扫描 vendor 内是否有敏感文件。 */
function _scanSecurity(dir) {
    const issues = [];
    const relBase = path.relative(VENDOR_DIR, dir);
    if (SCAN_SKIP_DIRS.has(relBase)) return issues;
    const walk = (d) => {
        const rel = path.relative(VENDOR_DIR, d);
        if (SCAN_SKIP_DIRS.has(rel)) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                walk(full);
            } else {
                const base = entry.name.toLowerCase();
                if (base === '.env' || base.startsWith('.env.') ||
                    base === '.signing' || base.includes('key') || base.includes('credential') ||
                    base === '.npmrc') {
                    issues.push(full);
                }
            }
        }
    };
    walk(dir);
    return issues;
}

main().catch(err => {
    console.error('[prepack] 执行失败:', err.message);
    process.exit(1);
});