#!/usr/bin/env node
/**
 * clean-vendor.mjs —— npm pack/publish 完成后的 vendor 清理（A1）
 *
 * 作用：
 *   - 删除 cli/vendor/ 目录（prepack 生成的临时构建产物）
 *   - tarball 已包含 vendor，删除本地副本不影响发布结果
 *   - 开发期工作区保持"仅 Server/ 一份源码"，不残留双份代码
 *
 * 触发时机：npm run postpack（npm pack / npm publish 完成后自动执行）
 *
 * 幂等：vendor 不存在时静默成功，无副作用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ 的上一级 = cli/
const CLI_ROOT = path.resolve(__dirname, '..');

const VENDOR_DIR = path.join(CLI_ROOT, 'vendor');

async function main() {
    if (!fs.existsSync(VENDOR_DIR)) {
        console.log('[clean-vendor] vendor 目录不存在，无需清理:', VENDOR_DIR);
        return;
    }

    console.log('——— [clean-vendor] 删除发布产物 cli/vendor/ ———');
    fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
    console.log('[clean-vendor] 完成。工作区已回归仅有 Server/ 一份源码。');
}

main().catch(err => {
    console.error('[clean-vendor] 执行失败:', err.message);
    process.exit(1);
});