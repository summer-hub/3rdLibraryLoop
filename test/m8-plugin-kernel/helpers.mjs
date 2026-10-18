/**
 * M8 共用工具：断言汇总器 · 临时目录 · 插件夹具
 *
 * 约定与 m1~m7 一致：每条断言打印一行 PASS/FAIL，末尾汇总「共 N 条断言，失败 M 条」，
 * 有失败则退出码非 0。
 *
 * 所有文件产物只写在 `os.tmpdir()` 下的 mkdtemp 目录，并由 finally 无条件删除——
 * 本套件**不向仓库内写任何路径**（仓库根可能还有用户本地资产，如 db/、logs/）。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 仓库根（test/m8-plugin-kernel/ → ../../） */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 以仓库根为基准 import `core/*` 模块 */
export const impCore = (rel) => import(pathToFileURL(path.join(ROOT, 'core', rel)).href);

/** 生成插件入口源码时用的 definePlugin 绝对 URL（插件目录在临时目录，无法用相对路径） */
export const DEFINE_URL = pathToFileURL(path.join(ROOT, 'core', 'definePlugin.js')).href;

/**
 * 断言汇总器。
 * @param {string} title - 段落标题
 */
export function createSuite(title) {
    const results = [];
    console.log(`── ${title} ──`);
    return {
        results,
        check(name, ok, detail = '') {
            results.push({ name, ok: !!ok });
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
        },
        /** 断言 fn 抛错；返回 { err, msg }，未抛错返回 null */
        async throws(fn) {
            try {
                await fn();
                return null;
            } catch (err) {
                return { err, msg: String(err?.message ?? err) };
            }
        },
        /** 打印汇总并按需设置退出码 */
        finish() {
            const failed = results.filter((r) => !r.ok);
            console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
            process.exitCode = failed.length === 0 ? 0 : 1;
            return failed.length;
        },
    };
}

/**
 * 在 os.tmpdir() 下开一个临时目录，回调结束后无条件删除。
 * @template T
 * @param {string} prefix
 * @param {(dir: string) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTempDir(prefix, fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `m8-${prefix}-`));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
}

/**
 * 在插件根目录下造一个真实的插件目录（`plugin.json` + 入口文件）。
 * @param {string} root - 插件根目录
 * @param {object} spec
 * @param {string} spec.name         - 清单插件名
 * @param {string} spec.source       - 入口文件源码
 * @param {string} [spec.dir]        - 相对 root 的目录路径（默认由插件名派生；可含层级，
 *                                    如 `path.join('llm', 'mock')`，扫描器递归发现）
 * @param {string[]} [spec.dependencies]
 * @param {string} [spec.entry]
 * @param {string} [spec.version]
 * @returns {Promise<string>} 插件目录绝对路径
 */
export async function writePlugin(root, { name, source, dir = null, dependencies = [], entry = 'index.js', version = '1.0.0' }) {
    const pluginDir = path.join(root, dir ?? name.replace(/[^a-z0-9]+/gi, '-'));
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
        path.join(pluginDir, 'plugin.json'),
        `${JSON.stringify({ name, entry, version, dependencies }, null, 2)}\n`,
        'utf8'
    );
    await fs.writeFile(path.join(pluginDir, entry), source, 'utf8');
    return pluginDir;
}

/**
 * 生成一个最小可加载插件的入口源码：注册一个服务 + 记录 setup/dispose 顺序。
 * @param {object} spec
 * @param {string} spec.name
 * @param {string} spec.seam            - 提供的服务名
 * @param {string[]} [spec.dependencies]
 * @param {object} [spec.config]        - 插件默认配置（可被 profile 覆盖）
 * @param {string} [spec.orderKey]      - 顺序记录用的 globalThis 键
 */
export function simplePluginSource({ name, seam, dependencies = [], config = {}, orderKey = '__M8_ORDER' }) {
    return `import { definePlugin } from ${JSON.stringify(DEFINE_URL)};

const order = (globalThis[${JSON.stringify(orderKey)}] ??= []);

export default definePlugin({
    name: ${JSON.stringify(name)},
    dependencies: ${JSON.stringify(dependencies)},
    config: ${JSON.stringify(config)},
    seam: ${JSON.stringify(seam)},
    setup(ctx) {
        order.push(ctx.name);
        ctx.provide(${JSON.stringify(seam)}, { plugin: ${JSON.stringify(name)}, config: ctx.config });
        return () => {
            order.push('dispose:' + ctx.name);
        };
    },
});
`;
}
