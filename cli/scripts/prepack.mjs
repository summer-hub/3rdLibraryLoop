#!/usr/bin/env node
/**
 * prepack.mjs —— npm publish 前的打包准备（A1）
 *
 * 作用：
 *   - 将仓库 Server/ 核心引擎复制到 cli/vendor/Server/（保持目录结构，
 *     使内部相对 import 全部保真）
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

function shouldExclude(rel) {
    const base = path.basename(rel);
    if (base === '.env' || base.startsWith('.env.')) return true;
    if (base === '.signing') return true;
    if (base === 'node_modules' || base === 'db' || base === '.git') return true;
    return false;
}

/**
 * 递归复制目录（跳过排除项）。
 * @param {string} src
 * @param {string} dst
 */
function copyDir(src, dst) {
    if (!fs.existsSync(src)) {
        console.error(`[prepack] 警告: 源目录不存在，已跳过: ${src}`);
        return;
    }
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const rel = entry.name;
        if (shouldExclude(rel)) continue;
        const srcPath = path.join(src, rel);
        const dstPath = path.join(dst, rel);

        if (entry.isDirectory()) {
            copyDir(srcPath, dstPath);
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

    // 安全校验：确认 vendor 内无密钥文件
    const securityIssues = _scanSecurity(VENDOR_DIR);
    if (securityIssues.length > 0) {
        console.error('[prepack] 错误: vendor 内发现敏感文件，已中止发布准备:');
        for (const p of securityIssues) console.error(`   ${p}`);
        process.exit(1);
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

/** 扫描 vendor 内是否有敏感文件。 */
function _scanSecurity(dir) {
    const issues = [];
    const walk = (d) => {
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