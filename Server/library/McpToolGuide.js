/**
 * McpToolGuide —— MCP 工具引导 prompt 段落生成器
 *
 * 职责：
 *   从 MCP/config.json 读取下游 Server 名称 + 扫描 MCP/scripts/ 解析 @tool 注释，
 *   生成引导性 prompt 段落，提醒 AI 主动使用 MCP 工具。
 *
 * 设计原则：
 *   - 折中方式：prompt 只写引导性文字，不列具体工具名和参数。
 *     工具发现交给 opencode MCP 协议（opencode 启动时已通过 tools/list 拿到全部工具信息）。
 *   - 数据驱动：从 config.json + scripts/ 动态生成，新增/删除工具无需改代码。
 *   - 不缓存：每次调用都重新读取，确保新增工具即时被发现。
 *   - 静默失败：配置文件不存在或读取异常时返回空字符串，不影响主流程。
 *
 * 脚本头部注释约定（与 MCP/src/registry/ScriptRegistry.js 一致）：
 *   # @tool <名称>              — 必填，工具名（中文可用）
 *   # @description <描述>        — 工具描述
 *
 * @example
 * import { McpToolGuide } from '../library/McpToolGuide.js';
 *
 * const guide = new McpToolGuide('D:/code/3rdLibraryLoop/MCP/config.json');
 * const segment = guide.buildToolGuide();
 * // → "## 可用的 MCP 工具\n你已通过 MCP Gateway 获得以下工具..."
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 只解析脚本前 N 行的注释（与 ScriptRegistry 保持一致） */
const MAX_SCAN_LINES = 20;

/** 允许的脚本扩展名 */
const ALLOWED_EXTENSIONS = ['.sh', '.py', '.js'];

class McpToolGuide {
    /** @type {string} MCP config.json 绝对路径 */
    #configPath = '';

    /**
     * @param {string} [configPath] - MCP config.json 路径，默认相对当前文件推导
     */
    constructor(configPath) {
        if (configPath) {
            this.#configPath = path.resolve(configPath);
        } else {
            // 默认：Server/library/ → 上两级 → MCP/config.json
            const here = path.dirname(fileURLToPath(import.meta.url));
            this.#configPath = path.resolve(here, '..', '..', 'MCP', 'config.json');
        }
    }

    /**
     * 生成 MCP 工具引导 prompt 段落。
     *
     * 从 config.json 读取下游 Server 名称 + 扫描 scripts/ 解析 @tool 注释，
     * 拼接为引导性段落（不列工具参数 schema）。
     *
     * @returns {string} prompt 段落文本，无工具时返回空字符串
     */
    buildToolGuide() {
        const tools = this._collectTools();
        if (tools.length === 0) return '';

        const lines = [
            '## 可用的 MCP 工具',
            '你已通过 MCP Gateway 获得以下工具，请根据任务需要主动调用：',
            ''
        ];

        for (const t of tools) {
            lines.push(`- **${t.label}** — ${t.hint}`);
        }

        lines.push('');
        lines.push('遇到不确定的技术问题时，建议先用知识库搜索是否有相关经验可参考。');

        return lines.join('\n');
    }

    /**
     * 收集所有可用工具信息（下游 Server + 脚本）。
     * @returns {Array<{label: string, hint: string}>}
     * @private
     */
    _collectTools() {
        const config = this._readConfig();
        if (!config) return [];

        const tools = [];

        // ── 1. 下游 MCP Server ──
        const servers = config.downstreamServers || {};
        for (const [name, conf] of Object.entries(servers)) {
            if (conf && conf.enabled !== false) {
                tools.push({
                    label: name,
                    hint: this._serverHint(name, conf)
                });
            }
        }

        // ── 2. 本地脚本工具 ──
        const scripts = this._scanScripts(config);
        for (const s of scripts) {
            tools.push({
                label: s.toolName,
                hint: s.description
            });
        }

        return tools;
    }

    /**
     * 读取并解析 config.json。
     * @returns {object|null} 配置对象，读取失败返回 null
     * @private
     */
    _readConfig() {
        try {
            const raw = fs.readFileSync(this.#configPath, 'utf-8');
            return JSON.parse(raw);
        } catch (err) {
            return null;
        }
    }

    /**
     * 根据下游 Server 名称生成用途提示。
     * @param {string} name - Server 名称
     * @param {object} conf - Server 配置
     * @returns {string}
     * @private
     */
    _serverHint(name, conf) {
        // 已知的下游 Server 给出更友好的描述
        // FIXME: 后续需要根据实际情况修改
        const known = {
            'kb-server': '知识库搜索（全文检索，返回带相关性分数的条目）。测试阶段只允许查询，禁止调用 create_entry、update_entry、delete_entry',
            'gitcode': 'GitCode 平台仓库操作'
        };
        if (known[name]) return known[name];
        // 未知 Server：用 url 或 type 推导
        if (conf.url) return `${conf.type || 'remote'} Server (${conf.url})`;
        return `${conf.type || 'remote'} Server`;
    }

    /**
     * 扫描脚本目录，解析每个脚本的 @tool + @description 注释。
     *
     * @param {object} config - MCP 配置对象
     * @returns {Array<{toolName: string, description: string}>}
     * @private
     */
    _scanScripts(config) {
        if (!config.scriptsDir) return [];
        if (config.scripts && config.scripts.enabled === false) return [];

        // scriptsDir 是相对路径，相对于 config.json 所在目录
        const configDir = path.dirname(this.#configPath);
        const scriptsDir = path.resolve(configDir, config.scriptsDir);

        let files;
        try {
            files = fs.readdirSync(scriptsDir);
        } catch {
            return [];
        }

        const allowed = (config.scripts && config.scripts.allowedExtensions) || ALLOWED_EXTENSIONS;
        const results = [];

        for (const file of files) {
            const filePath = path.join(scriptsDir, file);
            const meta = this._parseScriptMeta(filePath, allowed);
            if (meta) results.push(meta);
        }

        return results;
    }

    /**
     * 解析单个脚本的元数据。
     * 复用 ScriptRegistry._parseScriptMeta 的正则逻辑。
     *
     * @param {string} filePath - 脚本文件绝对路径
     * @param {string[]} allowed - 允许的扩展名
     * @returns {{toolName: string, description: string}|null} 无 @tool 注释返回 null
     * @private
     */
    _parseScriptMeta(filePath, allowed) {
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch {
            return null;
        }
        if (!stat.isFile()) return null;

        const ext = path.extname(filePath);
        if (!allowed.includes(ext)) return null;

        let content;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            return null;
        }

        const lines = content.split('\n').slice(0, MAX_SCAN_LINES);

        let rawName = '';
        let description = '';

        for (const line of lines) {
            const toolMatch = line.match(/@tool\s+(.+)/);
            if (toolMatch) {
                rawName = toolMatch[1].trim();
                continue;
            }
            const descMatch = line.match(/@description\s+(.+)/);
            if (descMatch) {
                description = descMatch[1].trim();
                continue;
            }
        }

        if (!rawName) return null;

        return {
            toolName: `script_${rawName}`,
            description: description || `Script: ${rawName}`
        };
    }
}

export { McpToolGuide };
export default McpToolGuide;
