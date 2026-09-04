#!/usr/bin/env node
/**
 * prepack.mjs —— npm publish 前的打包准备（A1）
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

    // 覆写 vendor/Server/package.json：对齐 cli 依赖版本，避免版本冲突误导消费者
    const vendorPkgPath = path.join(VENDOR_SERVER, 'package.json');
    if (fs.existsSync(vendorPkgPath)) {
        const cliPkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
        const vendorPkg = JSON.parse(fs.readFileSync(vendorPkgPath, 'utf8'));
        vendorPkg.dependencies = { ...cliPkg.dependencies };
        vendorPkg._comment = 'vendored from Server/; dependencies aligned with cli package.json by prepack';
        fs.writeFileSync(vendorPkgPath, JSON.stringify(vendorPkg, null, 2) + '\n');
        console.log('[prepack] 覆写 vendor/Server/package.json dependencies（对齐 cli）');
    }

    // 写入 VERSION
    let version = 'dev';
    try {
        const cliPkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
        version = cliPkg.version || 'dev';
    } catch { /* 保持 dev */ }
    // 同时写入源码哈希便于审计
    const hash = _hashDir(VENDOR_SERVER);
    fs.writeFileSync(path.join(VENDOR_DIR, 'VERSION'),
        `${version}\nbuilt=${new Date().toISOString()}\nsha=${hash}\n`
    );

    // ── 3rdloop serve 内置核心前端（Web/public → cli/web）─────────────────
    // 核心前端进包；tag/issue/prcheck 等二级功能以扩展形式留仓库 Web/ext/，
    // 不进 npm 包（运行期经 install-ext 或仓库开发态自动挂载）。
    const WEB_SRC = path.join(PROJECT_ROOT, 'Web', 'public');
    const WEB_DST = path.join(CLI_ROOT, 'web');
    if (fs.existsSync(WEB_SRC)) {
        if (fs.existsSync(WEB_DST)) {
            fs.rmSync(WEB_DST, { recursive: true, force: true });
        }
        copyDir(WEB_SRC, WEB_DST);
        console.log('[prepack] 复制 Web/public/ → cli/web/（3rdloop serve 内置核心前端）');
    } else {
        console.warn('[prepack] 警告: 未找到 Web/public/，3rdloop serve 将无内置前端');
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
    'Archive/data',   // 知识库文档种子
    'BadCase',        // 已知问题知识库
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