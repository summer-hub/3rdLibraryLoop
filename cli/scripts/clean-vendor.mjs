#!/usr/bin/env node
/**
 * clean-vendor.mjs —— npm pack/publish 完成后的 vendor 清理（配套 prepack.mjs）
 *
 * ⚠ 双包发布形态**不再使用 vendor**：安装态核心来自
 * `node_modules/@ohos-cpf/3rdloop_core`（`cli/lib/core-paths.js` 四级解析第②级），
 * CLI 的 files 白名单不含 vendor，本清理只针对本地 prepack 产物。
 *
 * 作用：
 *   - 删除 cli/vendor/ 目录（prepack 生成的临时构建产物，含 vendor/Web/public 前端副本）
 *   - 删除历史遗留的 cli/web/（早期 prepack 在 CLI 包内复制的前端副本，已退役）
 *   - tarball 已包含所需内容，删除本地副本不影响发布结果
 *   - 开发期工作区保持"仅 Server/ 一份源码、仅 Web/public 一份前端"，不残留双份代码
 *
 * 触发时机：npm run postpack（npm pack / npm publish 完成后自动执行）
 *
 * 幂等：目录不存在时静默成功，无副作用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ 的上一级 = cli/
const CLI_ROOT = path.resolve(__dirname, '..');

const VENDOR_DIR = path.join(CLI_ROOT, 'vendor');
// 前端资产已并入核心包（`<核心树根>/Web/public`），CLI 包内不再有副本；
// 这个路径只用于清理老 checkout 的历史残留。
const LEGACY_WEB_DIR = path.join(CLI_ROOT, 'web');
// prepack 从仓库根 plugins/ 复制的插件树（构建产物，源码只有仓库根 plugins/ 一份）
const VENDOR_PLUGINS = path.join(VENDOR_DIR, 'plugins');

async function main() {
    if (fs.existsSync(VENDOR_DIR)) {
        console.log('——— [clean-vendor] 删除发布产物 cli/vendor/ ———');
        if (fs.existsSync(VENDOR_PLUGINS)) {
            console.log(
                '[clean-vendor] 含插件树与其内核副本 cli/vendor/{plugins,core,seams,profiles}/' +
                '（随 vendor/ 一并删除，源码各自只有仓库根一份）'
            );
        }
        fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
        console.log('[clean-vendor] 完成。工作区已回归仅有 Server/ 一份源码。');
    } else {
        console.log('[clean-vendor] vendor 目录不存在，无需清理:', VENDOR_DIR);
    }

    // 历史遗留：早期 prepack 把前端复制进 CLI 包（cli/web），现已退役；
    // 老 checkout 里可能还在，删掉避免它被误当作前端资产来源。
    if (fs.existsSync(LEGACY_WEB_DIR)) {
        console.log('——— [clean-vendor] 删除历史遗留 cli/web/（前端已并入核心包）———');
        fs.rmSync(LEGACY_WEB_DIR, { recursive: true, force: true });
        console.log('[clean-vendor] 完成。工作区已回归仅有 Web/public 一份前端源码。');
    } else {
        console.log('[clean-vendor] cli/web 目录不存在（前端已并入核心包），无需清理:', LEGACY_WEB_DIR);
    }

    // 断言：两个目录都必须不存在，否则下次打包含有不确定内容
    const leftover = [VENDOR_DIR, LEGACY_WEB_DIR].filter((d) => fs.existsSync(d));
    if (leftover.length > 0) {
        console.error('[clean-vendor] 错误: 清理后仍存在目录:', leftover.join(', '));
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[clean-vendor] 执行失败:', err.message);
    process.exit(1);
});
