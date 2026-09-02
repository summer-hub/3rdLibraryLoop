/**
 * workflows.js —— 工作流注册表与加载器
 *
 * 机制：目录自动加载（可插拔）。
 *   - 扫描 cli/workflows/ 下所有 .mjs/.js 模块，每个模块默认导出一个工作流声明
 *   - 工作流新增 = 目录下新增一个文件，零改动核心分发代码（cli.js）
 *
 * 工作流声明对象约定：
 *   {
 *     name: 'pr push',                 // 工作流名（支持多词，空格分隔）
 *     description: '简述该固定编排的目的',
 *     params: [                        // CLI flags schema
 *       { flag: 'workspace-dir', required: true,  describe: '本地工作区 git 仓库根目录' },
 *       { flag: 'upstream-url', required: false, describe: '上游仓库 URL' },
 *     ],
 *     buildTaskDef(params) {           // params: { 'workspace-dir': <值>, ... }
 *       return { ... };                // 与 Orchestrator.loadTask 对齐的 taskDef（含 steps）
 *     },
 *   }
 *
 * 加载容错：
 *   - 模块 import 失败 / 导出非法：跳过该文件并记录警告（不阻断其余工作流）
 *   - name 缺失或与已注册工作流重名：跳过并记录警告
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// cli/ 目录绝对路径（本文件在 cli/lib/ 下）
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS_DIR = path.join(CLI_ROOT, 'workflows');

/**
 * 扫描并加载 cli/workflows/ 下所有工作流。
 * @param {object} [opts]
 * @param {string} [opts.workflowsDir] - 覆盖工作流目录（便于测试）
 * @returns {Promise<{ workflows: Map<string, object>, warnings: string[] }>}
 */
export async function loadWorkflows(opts = {}) {
    const dir = opts.workflowsDir || WORKFLOWS_DIR;
    const workflows = new Map();
    const warnings = [];

    if (!fs.existsSync(dir)) {
        return { workflows, warnings: [`工作流目录不存在: ${dir}（已跳过自动加载）`] };
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
        .filter(ent => ent.isFile() && /\.(mjs|js)$/.test(ent.name))
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const ent of files) {
        const filePath = path.join(dir, ent.name);
        try {
            const modUrl = new URL(`file://${filePath.replace(/\\/g, '/')}`);
            const mod = await import(modUrl.href);
            const wf = mod.default;
            if (!wf || typeof wf !== 'object' || typeof wf.buildTaskDef !== 'function') {
                warnings.push(`[workflows] 跳过 ${ent.name}: 默认导出缺少 buildTaskDef()（参考声明约定）`);
                continue;
            }
            const name = String(wf.name || '').trim();
            if (!name) {
                warnings.push(`[workflows] 跳过 ${ent.name}: 缺少 name 字段`);
                continue;
            }
            if (workflows.has(name)) {
                warnings.push(`[workflows] 跳过 ${ent.name}: 工作流名 "${name}" 已注册（来自其他文件）`);
                continue;
            }
            workflows.set(name, wf);
        } catch (err) {
            warnings.push(`[workflows] 加载失败 ${ent.name}: ${err.message}`);
        }
    }

    return { workflows, warnings };
}

/**
 * 按位置参数列表做工作流最长匹配。
 *
 * 规则：
 *   - 依次尝试 words.join(' ') 的降序组合，命中即返回
 *   - 例：['pr', 'push', '--x', 'v'] → 先试 'pr push'，未中退 'pr' → 再未中返回 namedFlow
 *
 * @param {Map<string, object>} workflows - loadWorkflows 返回的注册表
 * @param {string[]} words - 位置参数数组（不含 flag）
 * @returns {{ wf: object|null, matchWords: number, name: string|null }}
 */
export function resolveWorkflow(workflows, words) {
    if (!workflows || !Array.isArray(words) || words.length === 0) {
        return { wf: null, matchWords: 0, name: null };
    }

    // 只取连续位置参数前缀做匹配（遇 flag 即截断）
    const positional = [];
    for (const w of words) {
        if (typeof w === 'string' && w.startsWith('--')) break;
        positional.push(w);
    }
    if (positional.length === 0) return { wf: null, matchWords: 0, name: null };

    for (let len = positional.length; len >= 1; len--) {
        const candidate = positional.slice(0, len).join(' ');
        if (workflows.has(candidate)) {
            return { wf: workflows.get(candidate), matchWords: len, name: candidate };
        }
    }
    return { wf: null, matchWords: 0, name: null };
}

/**
 * 列出已注册工作流（供 help / list 使用）。
 * @param {Map<string, object>} workflows
 * @returns {Array<{ name: string, description: string, params: object[] }>}
 */
export function listWorkflows(workflows) {
    if (!workflows) return [];
    const out = [];
    for (const [name, wf] of workflows) {
        out.push({
            name,
            description: wf.description || '',
            params: Array.isArray(wf.params) ? wf.params : [],
        });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}