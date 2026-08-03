/**
 * MCPClientPool —— 下游 MCP Server 连接池
 *
 * 职责：
 *   1. 管理与下游 MCP Server 的 Client 连接（stdio + remote 两种传输）。
 *   2. 拉取下游 Server 的工具列表。
 *   3. 转发工具调用到下游 Server。
 *   4. 维护连接状态，支持断开与重连。
 *
 * 设计原则：
 *   - 高内聚：所有下游 MCP Client 的连接/调用/断开逻辑集中在此模块。
 *   - 低耦合：不感知工具注册表和脚本执行器，只提供 connect/listTools/callTool 接口。
 *   - 错误隔离：单个下游 Server 连接失败不影响其他 Server。
 *
 * 支持的传输方式：
 *   - stdio：spawn 子进程，通过 stdin/stdout 通信 JSON-RPC
 *   - remote：Streamable HTTP，连接远程 MCP Server URL
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createLogger } from '../library/logger.js';

const log = createLogger('ClientPool');

class MCPClientPool {
    constructor() {
        /** @type {Map<string, Client>} */
        this._clients = new Map();
        /** @type {Map<string, StdioClientTransport | StreamableHTTPClientTransport>} */
        this._transports = new Map();
        /** @type {Map<string, import('../types.js').ServerConnectionStatus>} */
        this._statuses = new Map();
        /** @type {Map<string, string[]>} 下游原始工具名列表 */
        this._toolNames = new Map();
    }

    /**
     * 连接一个下游 MCP Server。
     * - 根据 type 选择传输方式（stdio / remote）
     * - 建立 Client session
     * - 自动完成 MCP 握手（connect 内部会发送 initialize）
     *
     * @param {string} name - Server 名称（用作工具前缀）
     * @param {import('../types.js').DownstreamServerConfig} config
     * @returns {Promise<void>}
     */
    async connect(name, config) {
        const transport = _createTransport(name, config);
        if (!transport) return; // 创建失败已记录错误

        const client = new Client(
            { name: 'mcp-gateway', version: '1.0.0' },
            { capabilities: {} }
        );

        try {
            // connect() 内部会启动 transport 并完成 initialize 握手
            await client.connect(transport);
        } catch (err) {
            _setStatus(this._statuses, name, false, 0, err.message);
            log.error(`连接下游 Server "${name}" 失败`, { error: err.message });
            // 清理已创建但连接失败的资源
            try { await client.close(); } catch { /* 忽略 */ }
            return;
        }

        this._clients.set(name, client);
        this._transports.set(name, transport);
        _setStatus(this._statuses, name, true, 0);
        log.info(`下游 Server "${name}" 连接成功`);
    }

    /**
     * 拉取下游 Server 的工具列表。
     * @param {string} name - Server 名称
     * @returns {Promise<Array<{ name: string, description: string, inputSchema: Object }>>}
     *   MCP SDK 的 Tool 对象数组
     * @throws {Error} Server 未连接或拉取失败
     */
    async listTools(name) {
        const client = this._clients.get(name);
        if (!client) {
            throw new Error(`下游 Server "${name}" 未连接`);
        }

        const result = await client.listTools();
        const tools = result.tools || [];
        this._toolNames.set(name, tools.map(t => t.name));
        _updateStatus(this._statuses, name, { toolCount: tools.length });
        return tools;
    }

    /**
     * 转发工具调用到下游 Server。
     * @param {string} serverName - Server 名称
     * @param {string} toolName   - 原始工具名（不含前缀）
     * @param {Object} args       - 工具参数
     * @returns {Promise<Object>} MCP CallToolResult
     * @throws {Error} Server 未连接或调用失败
     */
    async callTool(serverName, toolName, args) {
        const client = this._clients.get(serverName);
        if (!client) {
            throw new Error(`下游 Server "${serverName}" 未连接`);
        }

        const result = await client.callTool({
            name: toolName,
            arguments: args
        });

        // 返回 CallToolResult：{ content: [{ type, text }], isError? }
        return result;
    }

    /**
     * 断开指定 Server 的连接。
     * @param {string} name
     * @returns {Promise<void>}
     */
    async disconnect(name) {
        const client = this._clients.get(name);
        if (client) {
            try { await client.close(); } catch { /* 忽略关闭错误 */ }
        }
        this._clients.delete(name);
        this._transports.delete(name);
        this._toolNames.delete(name);
        _setStatus(this._statuses, name, false, 0, '已断开');
        log.info(`下游 Server "${name}" 已断开`);
    }

    /**
     * 断开所有下游连接。
     * @returns {Promise<void>}
     */
    async disconnectAll() {
        const names = Array.from(this._clients.keys());
        await Promise.allSettled(names.map(n => this.disconnect(n)));
        log.info('所有下游 Server 连接已断开');
    }

    /**
     * 获取所有 Server 连接状态。
     * @returns {import('../types.js').ServerConnectionStatus[]}
     */
    getStatuses() {
        return Array.from(this._statuses.values());
    }

    /**
     * 获取已连接的 Server 名称列表。
     * @returns {string[]}
     */
    getConnectedNames() {
        return Array.from(this._clients.keys());
    }
}

// ─── 内部工具函数 ──────────────────────────────────────────────────────────────

/**
 * 根据 config.type 创建对应的 Transport。
 * @param {string} name - Server 名称（日志用）
 * @param {import('../types.js').DownstreamServerConfig} config
 * @returns {StdioClientTransport | StreamableHTTPClientTransport | null}
 * @private
 */
function _createTransport(name, config) {
    const type = config.type || 'stdio';

    if (type === 'stdio') {
        log.info(`连接下游 Server: ${name}`, { type, command: config.command });
        return new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: { ...process.env, ...config.env }
        });
    }

    if (type === 'remote') {
        log.info(`连接下游 Server: ${name}`, { type, url: config.url });
        return new StreamableHTTPClientTransport(
            new URL(config.url),
            { requestInit: { headers: config.headers || {} } }
        );
    }

    log.error(`下游 Server "${name}" 传输类型未知: ${type}`);
    return null;
}

/**
 * 设置/更新 Server 连接状态。
 * @param {Map} statuses
 * @param {string} name
 * @param {boolean} connected
 * @param {number} [toolCount]
 * @param {string} [error]
 * @private
 */
function _setStatus(statuses, name, connected, toolCount, error) {
    statuses.set(name, { name, connected, toolCount: toolCount ?? 0, error });
}

/**
 * 部分更新 Server 连接状态。
 * @param {Map} statuses
 * @param {string} name
 * @param {Object} patch
 * @private
 */
function _updateStatus(statuses, name, patch) {
    const current = statuses.get(name) || { name, connected: false, toolCount: 0 };
    statuses.set(name, { ...current, ...patch });
}

export default MCPClientPool;
