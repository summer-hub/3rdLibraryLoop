/**
 * PluginLoader.js — 插件发现与依赖拓扑
 *
 * 职责（只读文件系统 + 排序，不执行插件代码的副作用）：
 *   1. 扫描插件根目录：**递归**查找所有含 `plugin.json` 的目录（深度见
 *      MAX_PLUGIN_SCAN_DEPTH），因此 `plugins/<名>/` 与 `plugins/<组>/<名>/`
 *      都算插件；不含清单的目录只当作分组容器继续下探；
 *   2. 校验清单（委托 definePlugin.validateManifest，失败即抛错——静默跳过
 *      会让"装了插件却没生效"变成幽灵问题）；
 *   3. 依赖拓扑排序（Kahn）：`dependencies` 决定 setup 顺序，同层按名字典序，
 *      保证**确定性**（同样的输入永远得到同样的加载顺序）；
 *   4. 动态 import 插件入口，取出 definePlugin 的定义。
 *
 * 插件根目录的搜索顺序（由调用方给定，见 PluginHost.createDefaultHost）：
 *   项目 `plugins/` → 用户 `~/.3lib/plugins` → `3LIB_PLUGINS_DIR` 额外根。
 *   同名插件：**先到者胜**（项目内置优先于用户安装），后续同名记录入 conflicts；
 *   同一个 root 内"先到"= 越浅越优先，同深度按相对路径字典序（见 discoverPluginDirs）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from './definePlugin.js';

/**
 * 递归发现的最大深度（root 的一级子目录记为第 1 层，`plugin.json` 所在目录算一层）。
 *
 * 4 层覆盖 `plugins/<组>/<名>/`（2 层）并为未来的 `<组>/<子组>/<名>/`（3 层）
 * 与个别再加一层的重排留余量。
 *
 * **超过上限 = 静默忽略，这是刻意决定而非疏漏**：插件树不应无限嵌套，而"多放一层
 * 备份/归档目录就阻塞宿主启动"是更坏的失败模式——那里本来也就不该有插件。
 * 需要更多层时改这个常量，而不是在磁盘上赌深度。
 */
export const MAX_PLUGIN_SCAN_DEPTH = 4;

/** 相对 root 的路径（统一 `/` 分隔）——确定性排序键，与平台分隔符无关 */
function relativeKey(root, dir) {
    return path.relative(root, dir).split(path.sep).join('/');
}

/**
 * 在单个 root 下发现全部插件目录。
 *
 * 规则：
 *   - 目录自身含 `plugin.json` → 它就是一个插件条目，**不再**下探其子目录
 *     （插件内部的 `plugin.json` 不是插件，避免把插件内部误认成新插件）；
 *   - 目录自身不含清单 → 只当分组容器，继续下探子目录；
 *   - 跳过点目录与 `node_modules`；超过 MAX_PLUGIN_SCAN_DEPTH 不再下探
 *     （静默忽略，理由见该常量的注释）。
 *
 * 顺序（两层意义都要确定）：
 *   - 排序键 = `(深度, 相对路径字典序)`，先比深度数值、再比字典序。`readdirSync`
 *     的原始顺序**不进结果**——先收集再整体排序，所以同一批文件系统内容永远得到
 *     同一顺序，与建树顺序、文件系统返回顺序、平台分隔符都无关；
 *   - 深度优先参与排序，是为了同名冲突时**越浅越优先**（见 scanPluginRoots）：
 *     `plugins/tie` 与 `plugins/grp/tie` 同名时由"更接近根、更显眼"的那个胜出，
 *     而不是由分组目录的字母序决定。
 *
 * @param {string} root - 插件根目录
 * @returns {string[]} 插件目录绝对路径（已按 (深度, 相对路径) 排序）
 */
function discoverPluginDirs(root) {
    const found = [];
    const walk = (dir, childDepth) => {
        let dirents;
        try {
            dirents = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
            // 根目录读不了 = 配置错误，直接报（沿用旧行为，不静默变成"装了 0 个插件"）
            if (childDepth === 1) throw new Error(`无法读取插件根目录 ${root}: ${err.message}`);
            return; // 深层目录读不了：它不是插件根，跳过而不是让整个宿主起不来
        }
        for (const dirent of dirents) {
            if (!dirent.isDirectory()) continue;
            // 跳过点目录与 node_modules（用户根下可能混有依赖目录）
            if (dirent.name.startsWith('.') || dirent.name === 'node_modules') continue;
            const child = path.join(dir, dirent.name);
            if (fs.existsSync(path.join(child, 'plugin.json'))) {
                found.push(child);
                continue;
            }
            if (childDepth < MAX_PLUGIN_SCAN_DEPTH) walk(child, childDepth + 1);
        }
    };
    walk(root, 1);

    return found
        .map((dir) => {
            const key = relativeKey(root, dir);
            return { dir, key, depth: key.split('/').length };
        })
        .sort((a, b) => {
            if (a.depth !== b.depth) return a.depth - b.depth; // 越浅越靠前
            if (a.key === b.key) return 0;
            return a.key < b.key ? -1 : 1; // 同深度：相对路径字典序
        })
        .map((item) => item.dir);
}

/**
 * 扫描一组根目录，收集插件清单。
 *
 * 插件名只来自 `plugin.json` 的 `name`，与目录在第几层无关——分组目录名不参与命名。
 * 同名插件的优先级：root 之间按传入顺序（项目内置优先于用户安装）；同一个 root 内
 * **越浅越优先，同深度再按相对路径字典序**。后者是刻意的 tie-break：同名本就是
 * 配置写错了，此时选更接近根、更显眼的那个才可解释，否则结果取决于字母序。
 *
 * @param {string[]} roots - 根目录列表（按优先级排序）
 * @returns {{ entries: Array<{dir: string, manifest: object}>, conflicts: Array<{name: string, kept: string, skipped: string}> }}
 *          conflicts 的 kept/skipped 是完整目录路径（kept = 胜出者）
 */
export function scanPluginRoots(roots) {
    const entries = [];
    const seen = new Map(); // name → dir（先到者胜）
    const conflicts = [];

    for (const root of roots ?? []) {
        if (!root || !fs.existsSync(root)) continue;
        for (const dir of discoverPluginDirs(root)) {
            const manifestPath = path.join(dir, 'plugin.json');
            let manifest;
            try {
                manifest = validateManifest(
                    JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
                    { source: manifestPath }
                );
            } catch (err) {
                throw new Error(`插件清单无效: ${err.message}`);
            }
            if (seen.has(manifest.name)) {
                conflicts.push({ name: manifest.name, kept: seen.get(manifest.name), skipped: dir });
                continue;
            }
            seen.set(manifest.name, dir);
            entries.push({ dir, manifest });
        }
    }
    return { entries, conflicts };
}

/**
 * 依赖拓扑排序（Kahn 算法，同层按名字典序保证确定性）。
 *
 * @param {Array<{dir: string, manifest: object}>} entries - scanPluginRoots 的产物
 * @returns {Array<{dir: string, manifest: object}>} 排序后的条目
 * @throws 依赖缺失或存在循环依赖时抛出含插件名的错误
 */
export function topoSort(entries) {
    const byName = new Map(entries.map((e) => [e.manifest.name, e]));
    const indegree = new Map();
    const dependents = new Map(); // dep -> [被依赖者]

    for (const { manifest } of entries) {
        indegree.set(manifest.name, manifest.dependencies.length);
        for (const dep of manifest.dependencies) {
            if (!byName.has(dep)) {
                throw new Error(
                    `插件 ${manifest.name} 依赖 ${dep}，但该插件不存在（已装: ${[...byName.keys()].sort().join(', ')}）`
                );
            }
            const list = dependents.get(dep) ?? [];
            list.push(manifest.name);
            dependents.set(dep, list);
        }
    }

    // 就绪集合按名字典序出队 → 结果确定
    const ready = [...indegree.entries()].filter(([, d]) => d === 0).map(([n]) => n).sort();
    const ordered = [];
    while (ready.length > 0) {
        const name = ready.shift();
        ordered.push(byName.get(name));
        for (const dep of (dependents.get(name) ?? []).sort()) {
            const left = indegree.get(dep) - 1;
            indegree.set(dep, left);
            if (left === 0) {
                ready.push(dep);
                ready.sort();
            }
        }
    }

    if (ordered.length !== entries.length) {
        const cycle = [...indegree.entries()].filter(([, d]) => d > 0).map(([n]) => n).sort();
        throw new Error(`插件存在循环依赖: ${cycle.join(' → ')}`);
    }
    return ordered;
}

/**
 * 动态 import 插件入口并取出 definePlugin 定义。
 *
 * @param {{dir: string, manifest: object}} entry
 * @returns {Promise<object>} definePlugin 规范化后的插件定义
 */
export async function loadPluginEntry(entry) {
    const entryPath = path.join(entry.dir, entry.manifest.entry);
    if (!fs.existsSync(entryPath)) {
        throw new Error(`插件 ${entry.manifest.name} 入口不存在: ${entryPath}`);
    }
    let mod;
    try {
        mod = await import(pathToFileURL(entryPath).href);
    } catch (err) {
        throw new Error(`插件 ${entry.manifest.name} 加载失败（${entryPath}）: ${err.message}`);
    }
    const def = mod.default ?? mod;
    if (!def || typeof def !== 'object' || typeof def.setup !== 'function') {
        throw new Error(
            `插件 ${entry.manifest.name} 入口需默认导出 definePlugin(...) 定义（收到 ${typeof def}）`
        );
    }
    return def;
}
