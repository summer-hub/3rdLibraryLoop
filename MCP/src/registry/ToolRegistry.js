/**
 * ToolRegistry —— 统一工具注册表
 *
 * 职责：
 *   1. 维护所有聚合工具的注册表（下游工具 + 脚本工具 + 内置工具）。
 *   2. 提供工具的增删查接口，供 Gateway 核心调用。
 *   3. 检测工具名冲突，后注册同名工具时跳过并记录警告。
 *
 * 设计原则：
 *   - 高内聚：工具注册/查找/删除逻辑集中在此模块。
 *   - 低耦合：只存储数据，不执行工具调用，不感知 MCP SDK。
 *
 * 工具命名规范：
 *   - 下游工具：{serverName}_{originalToolName}（如 fetch_url）
 *   - 脚本工具：script_{rawName}（如 script_git操作）
 *   - 内置工具：gateway_{action}（如 gateway_health）
 */

import { createLogger } from '../library/logger.js';

const log = createLogger('ToolRegistry');

class ToolRegistry {
    constructor() {
        /** @type {Map<string, import('../types.js').AggregatedTool>} */
        this._tools = new Map();
    }

    /**
     * 注册一个工具。若名称已存在则跳过并记录警告。
     * @param {import('../types.js').AggregatedTool} tool
     * @returns {boolean} 是否注册成功（false 表示名称冲突被跳过）
     */
    register(tool) {
        if (this._tools.has(tool.name)) {
            log.warn(`工具名冲突，跳过注册: "${tool.name}"`);
            return false;
        }
        this._tools.set(tool.name, tool);
        return true;
    }

    /**
     * 移除一个工具。
     * @param {string} name
     * @returns {boolean} 是否移除成功
     */
    unregister(name) {
        return this._tools.delete(name);
    }

    /**
     * 按名称查找工具。
     * @param {string} name
     * @returns {import('../types.js').AggregatedTool | undefined}
     */
    get(name) {
        return this._tools.get(name);
    }

    /**
     * 判断工具是否已注册。
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this._tools.has(name);
    }

    /**
     * 获取所有已注册工具。
     * @returns {import('../types.js').AggregatedTool[]}
     */
    getAll() {
        return Array.from(this._tools.values());
    }

    /**
     * 获取所有工具名。
     * @returns {string[]}
     */
    names() {
        return Array.from(this._tools.keys());
    }

    /**
     * 获取工具总数。
     * @returns {number}
     */
    size() {
        return this._tools.size;
    }

    /**
     * 按来源过滤工具。
     * @param {import('../types.js').ToolSource} source
     * @returns {import('../types.js').AggregatedTool[]}
     */
    filterBySource(source) {
        return this.getAll().filter(t => t.source === source);
    }

    /**
     * 清空注册表。
     */
    clear() {
        this._tools.clear();
    }
}

export default ToolRegistry;
