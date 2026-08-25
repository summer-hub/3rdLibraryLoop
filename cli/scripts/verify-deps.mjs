#!/usr/bin/env node
/**
 * verify-deps.mjs —— 校验 CLI 依赖声明与引擎代码一致（R2）
 *
 * 作用：
 *   - 扫描引擎代码下所有源码 import 的包名
 *   - 与 cli/package.json dependencies 比对，缺失则报错
 *   - 防止发布后引擎内 import 的依赖未声明导致运行时 ESM Module not found
 *
 * 扫描目录（双模式）：
 *   - 优先扫 cli/vendor/Server/（发布场景，prepack 已生成）
 *   - 缺失时回退扫仓库 Server/ 源码（开发场景，无需生成 vendor）
 *
 * 触发时机：npm run verify-deps（发布前 CI / prepublish 自动检查）
 */

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '..');
const VENDOR_SERVER = path.join(CLI_ROOT, 'vendor', 'Server');
const PKG = path.join(CLI_ROOT, 'package.json');

// Node 内置模块（含无 node: 前缀引用），无需声明
const BUILTIN = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);

// 已知的裸模块依赖（vendored 代码 import 的第三方包）
const BARE_MODULES = [
    '@github/copilot-sdk',
    '@opencode-ai/sdk',
    'better-sqlite3',
    'dotenv',
];

function collectImports(dir) {
    const imports = new Set();
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                walk(full);
            } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
                const content = fs.readFileSync(full, 'utf8');
                // 提取裸模块 import（非相对/绝对路径）
                const re = /(?:import\s+[^'"]*\s+from\s+|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g;
                let m;
                while ((m = re.exec(content)) !== null) {
                    const spec = m[2];
                    if (spec.startsWith('.') || spec.startsWith('/') ||
                        spec.startsWith('node:') || spec.startsWith('file:')) continue;
                    // 取包根名（@scope/name 或 name）
                    const parts = spec.split('/');
                    const pkgName = spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
                    imports.add(pkgName);
                }
                // 动态 import 内部模块
                const re2 = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
                while ((m = re2.exec(content)) !== null) {
                    const spec = m[1];
                    if (spec.startsWith('.') || spec.startsWith('/') ||
                        spec.startsWith('node:') || spec.startsWith('file:')) continue;
                    const parts = spec.split('/');
                    const pkgName = spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
                    imports.add(pkgName);
                }
            }
        }
    };
    walk(dir);
    return imports;
}

function main() {
    // 优先扫 vendor/Server（发布场景）；缺失时回退扫仓库 Server/ 源码（开发场景）
    const scanDir = fs.existsSync(VENDOR_SERVER)
        ? VENDOR_SERVER
        : path.resolve(CLI_ROOT, '..', 'Server');

    if (!fs.existsSync(scanDir)) {
        console.error(`[verify-deps] 未找到 vendor/Server，回退路径也不存在: ${scanDir}`);
        console.error('[verify-deps] 请先运行 npm run prepack 或确保源码 Server/ 存在');
        process.exit(1);
    }

    const srcLabel = scanDir === VENDOR_SERVER ? 'vendor/Server' : 'Server/ 源码';
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
    const declared = new Set(Object.keys(pkg.dependencies || {}));

    const imported = collectImports(scanDir);
    const missing = [];

    for (const name of imported) {
        // node: 内置模块与相对路径已过滤，这里再兜底一次
        if (BUILTIN.has(name) || name.startsWith('node:')) continue;
        if (BARE_MODULES.includes(name) || declared.has(name)) continue;
        missing.push(name);
    }

    if (missing.length > 0) {
        console.error(`[verify-deps] 以下 ${srcLabel} 代码 import 的依赖未在 cli/package.json 声明:`);
        for (const name of missing) console.error(`   - ${name}`);
        console.error('[verify-deps] 请添加到 cli/package.json dependencies');
        process.exit(1);
    }

    console.log(`[verify-deps] OK — ${srcLabel} 共 ${imported.size} 个外部 import 均已在 dependencies 声明`);
    process.exit(0);
}

main();