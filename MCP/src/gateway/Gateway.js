/**
 * MCPGateway —— Gateway 核心类
 *
 * 职责：
 *   1. 连接所有下游 MCP Server，拉取并聚合工具列表（加前缀）。
 *   2. 扫描脚本目录，解析 @tool 注释注册为工具。
 *   3. 注册所有工具到 MCP Server（统一暴露给 AI）。
 *   4. 统一调度工具调用：下游工具转发，脚本工具本地执行。
 *   5. 注册内置管理工具（gateway_list_tools / gateway_health 等）。
 *   6. 启动 stdio Server，等待 AI 客户端连接。
 *
 * 设计原则：
 *   - 高内聚：Gateway 是工具聚合与调度的核心，协调各子模块但不越权。
 *   - 低耦合：依赖注入 MCPClientPool / ScriptRegistry / ScriptExecutor / ToolRegistry，
 *     各子模块独立可测试，Gateway 只做编排。
 *   - 错误隔离：单个下游 Server / 脚本崩溃不影响其他工具。
 *
 * 架构：
 *   ┌─────────────────────────────────────────────────┐
 *   │  MCPGateway (编排核心)                           │
 *   │  ┌──────────────┐  ┌───────────────┐           │
 *   │  │ ToolRegistry  │  │ MCPClientPool │           │
 *   │  │ (工具注册表)  │  │ (下游连接池)  │           │
 *   │  └──────────────┘  └───────────────┘           │
 *   │  ┌──────────────┐  ┌───────────────┐           │
 *   │  │ScriptRegistry │  │ScriptExecutor │           │
 *   │  │ (脚本发现)    │  │ (脚本执行)    │           │
 *   │  └──────────────┘  └───────────────┘           │
 *   │  ┌──────────────────────────────────┐          │
 *   │  │ McpServer (MCP SDK, stdio)       │          │
 *   │  └──────────────────────────────────┘          │
 *   └─────────────────────────────────────────────────┘
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import MCPClientPool from '../client/MCPClientPool.js';
import ScriptRegistry from '../registry/ScriptRegistry.js';
import ScriptExecutor from '../executor/ScriptExecutor.js';
import ToolRegistry from '../registry/ToolRegistry.js';
import KBToolProvider from '../library/KBToolProvider.js';
import { createLogger } from '../library/logger.js';

const log = createLogger('Gateway');

/** 内置工具前缀 */
const BUILTIN_PREFIX = 'gateway_';

class MCPGateway {
    /**
     * @param {import('../types.js').GatewayConfig} config
     */
    constructor(config) {
        this._config = config;

        // MCP Server（底层 Server 类，支持直接 setRequestHandler + 原始 JSON Schema）
        // McpServer.registerTool 要求 Zod schema，不适合转发下游原始 JSON Schema，
        // 因此使用底层 Server + 手动注册 ListTools/CallTool handler。
        this._server = new Server(
            { name: config.gateway.name, version: config.gateway.version },
            { capabilities: { tools: { listChanged: true } } }
        );

        // 子模块实例（高内聚低耦合，各司其职）
        this._clientPool = new MCPClientPool();
        this._scriptRegistry = new ScriptRegistry(
            config.scriptsDir,
            config.scripts.allowedExtensions
        );
        this._scriptExecutor = new ScriptExecutor(config.scripts.timeout);
        this._toolRegistry = new ToolRegistry();

        // 知识库工具提供者（可选，配置未启用时为 null）
        this._kbProvider = config.knowledgeBase && config.knowledgeBase.enabled
            ? new KBToolProvider(config.knowledgeBase)
            : null;
    }

    // ─── 生命周期 ──────────────────────────────────────────────────────────────

    /**
     * 启动 Gateway：
     *   1. 连接下游 MCP Server 并聚合工具
     *   2. 扫描脚本目录并注册脚本工具
     *   3. 启动脚本热加载（如启用）
     *   4. 注册所有工具到 MCP Server
     *   5. 启动 stdio Server
     * @returns {Promise<void>}
     */
    async start() {
        log.info('Gateway 启动中...');

        // Step 1: 连接下游 Server 并聚合工具
        await this._connectDownstreamServers();

        // Step 2: 扫描脚本并注册
        if (this._config.scripts.enabled) {
            await this._loadScripts();
        }

        // Step 2.5: 注册知识库工具（惰性初始化，注册时不启动引擎）
        if (this._kbProvider) {
            this._loadKnowledgeBaseTools();
        }

        // Step 3: 注册所有工具到 MCP Server
        this._registerAllTools();

        // Step 4: 启动 stdio Server
        const transport = new StdioServerTransport();
        await this._server.connect(transport);

        log.info('Gateway 已启动 (stdio)', {
            tools: this._toolRegistry.size(),
            downstream: this._clientPool.getConnectedNames(),
            scripts: this._scriptRegistry.size(),
            knowledgeBase: this._kbProvider ? 'enabled' : 'disabled'
        });
    }

    /**
     * 关闭 Gateway：停止监听、断开下游、关闭 Server。
     * @returns {Promise<void>}
     */
    async shutdown() {
        log.info('Gateway 关闭中...');
        await this._scriptRegistry.stopWatch();
        if (this._kbProvider) {
            await this._kbProvider.shutdown();
        }
        await this._clientPool.disconnectAll();
        try {
            await this._server.close();
        } catch (err) {
            log.warn('关闭 MCP Server 时出错', { error: err.message });
        }
        log.info('Gateway 已关闭');
    }

    // ─── 下游 Server 聚合 ───────────────────────────────────────────────────────

    /**
     * 连接所有配置的下游 MCP Server，拉取工具列表并聚合到注册表。
     * 单个 Server 连接失败不影响其他。
     * @private
     */
    async _connectDownstreamServers() {
        const entries = Object.entries(this._config.downstreamServers);

        // 并行连接所有下游 Server
        await Promise.allSettled(
            entries.map(async ([name, cfg]) => {
                if (cfg.enabled === false) {
                    log.info(`下游 Server "${name}" 已禁用，跳过`);
                    return;
                }
                try {
                    await this._clientPool.connect(name, cfg);
                    const tools = await this._clientPool.listTools(name);
                    this._aggregateDownstreamTools(name, tools);
                } catch (err) {
                    log.error(`聚合下游 Server "${name}" 工具失败`, { error: err.message });
                }
            })
        );
    }

    /**
     * 将下游 Server 的工具列表聚合到 ToolRegistry（加前缀）。
     * @param {string} serverName
     * @param {Array<{ name: string, description: string, inputSchema: Object }>} tools
     * @private
     */
    _aggregateDownstreamTools(serverName, tools) {
        for (const tool of tools) {
            const aggregatedName = `${serverName}_${tool.name}`;
            this._toolRegistry.register({
                name: aggregatedName,
                source: 'downstream',
                sourceServer: serverName,
                originalName: tool.name,
                description: `[via ${serverName}] ${tool.description || ''}`,
                inputSchema: tool.inputSchema || { type: 'object', properties: {} }
            });
        }
        log.info(`聚合下游工具: ${serverName}`, { count: tools.length });
    }

    // ─── 脚本加载 ──────────────────────────────────────────────────────────────

    /**
     * 扫描脚本目录，注册脚本工具，并启动热加载（如启用）。
     * @private
     */
    async _loadScripts() {
        const metas = await this._scriptRegistry.scanAll();

        for (const meta of metas) {
            this._toolRegistry.register({
                name: meta.toolName,
                source: 'script',
                description: meta.description,
                inputSchema: _buildScriptInputSchema(meta)
            });
        }

        if (this._config.scripts.hotReload) {
            this._scriptRegistry.startWatch((meta, action) => {
                if (action === 'add') {
                    this._toolRegistry.register({
                        name: meta.toolName,
                        source: 'script',
                        description: meta.description,
                        inputSchema: _buildScriptInputSchema(meta)
                    });
                } else {
                    this._toolRegistry.unregister(meta.toolName);
                }
                this._server.sendToolListChanged();
            });
        }
    }

    // ─── 知识库工具 ─────────────────────────────────────────────────────────────

    /**
     * 注册知识库工具到 ToolRegistry。
     * 引擎采用惰性初始化——注册时仅注册工具定义，
     * 首次调用工具时才真正启动 DocSearchEngine。
     * @private
     */
    _loadKnowledgeBaseTools() {
        const tools = this._kbProvider.getTools();
        for (const tool of tools) {
            this._toolRegistry.register(tool);
        }
        log.info(`知识库工具已注册`, { count: tools.length });
    }

    // ─── 工具注册 ──────────────────────────────────────────────────────────────

    /**
     * 注册内置管理工具到 ToolRegistry，
     * 并在底层 Server 上注册 tools/list 和 tools/call 请求处理器。
     *
     * 使用底层 Server.setRequestHandler 而非 McpServer.registerTool，
     * 因为后者要求 Zod schema，而下游工具返回的是原始 JSON Schema。
     * @private
     */
    _registerAllTools() {
        // 先注册内置管理工具到 ToolRegistry
        this._registerBuiltinTools();

        // 注册 tools/list handler — 返回 ToolRegistry 中所有工具
        this._server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools = this._toolRegistry.getAll().map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema
            }));
            return { tools };
        });

        // 注册 tools/call handler — 统一路由到 _handleToolCall
        this._server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            return this._handleToolCall(name, args || {});
        });
    }

    /**
     * 统一工具调用处理器。
     * @param {string} toolName
     * @param {Object} args
     * @returns {Promise<Object>} MCP CallToolResult
     * @private
     */
    async _handleToolCall(toolName, args) {
        const tool = this._toolRegistry.get(toolName);
        if (!tool) {
            return _textResult(`未知工具: ${toolName}`);
        }

        try {
            // 内置管理工具：调用存储的 handler
            if (tool.source === 'builtin' && tool._handler) {
                return await tool._handler(args);
            }

            if (tool.source === 'downstream') {
                // 转发到下游 MCP Server
                const result = await this._clientPool.callTool(
                    tool.sourceServer,
                    tool.originalName,
                    args
                );
                return result;
            }

            if (tool.source === 'script') {
                // 本地执行脚本
                const meta = this._scriptRegistry.get(toolName);
                if (!meta) {
                    return _textResult(`脚本未找到: ${toolName}`);
                }
                const output = await this._scriptExecutor.execute(
                    meta.filePath,
                    meta.extension,
                    args
                );
                return _textResult(output);
            }

            return _textResult(`工具类型不支持: ${tool.source}`);
        } catch (err) {
            log.error(`工具调用失败: ${toolName}`, { error: err.message });
            return _textResult(`Error: ${err.message}`);
        }
    }

    /**
     * 注册内置管理工具到 ToolRegistry（不直接注册到 MCP Server，
     * 由统一的 tools/list handler 从 ToolRegistry 返回）。
     * @private
     */
    _registerBuiltinTools() {
        // gateway_list_tools — 列出所有聚合工具及其来源
        this._registerBuiltin('list_tools', '列出 Gateway 聚合的所有工具及其来源', async () => {
            const tools = this._toolRegistry.getAll().map(t => ({
                name: t.name,
                source: t.source,
                sourceServer: t.sourceServer,
                description: t.description
            }));
            return _textResult(JSON.stringify(tools, null, 2));
        });

        // gateway_list_servers — 列出下游 Server 连接状态
        this._registerBuiltin('list_servers', '列出下游 MCP Server 连接状态', async () => {
            const statuses = this._clientPool.getStatuses();
            return _textResult(JSON.stringify(statuses, null, 2));
        });

        // gateway_reload_scripts — 重新扫描脚本目录
        this._registerBuiltin('reload_scripts', '重新扫描脚本目录，更新工具列表', async () => {
            const before = this._scriptRegistry.size();
            await this._scriptRegistry.stopWatch();
            this._toolRegistry.filterBySource('script').forEach(t => {
                this._toolRegistry.unregister(t.name);
            });
            const metas = await this._scriptRegistry.scanAll();
            for (const meta of metas) {
                this._toolRegistry.register({
                    name: meta.toolName,
                    source: 'script',
                    description: meta.description,
                    inputSchema: _buildScriptInputSchema(meta)
                });
            }
            if (this._config.scripts.hotReload) {
                this._scriptRegistry.startWatch((meta, action) => {
                    if (action === 'add') {
                        this._toolRegistry.register({
                            name: meta.toolName,
                            source: 'script',
                            description: meta.description,
                            inputSchema: _buildScriptInputSchema(meta)
                        });
                    } else {
                        this._toolRegistry.unregister(meta.toolName);
                    }
                    this._server.sendToolListChanged();
                });
            }
            const after = this._scriptRegistry.size();
            this._server.sendToolListChanged();
            return _textResult(`脚本重载完成: ${before} → ${after}`);
        });

        // gateway_health — 健康检查
        this._registerBuiltin('health', 'Gateway 健康检查', async () => {
            const health = {
                downstream: this._clientPool.getStatuses(),
                scripts: this._scriptRegistry.size(),
                totalTools: this._toolRegistry.size(),
                uptime: Math.round(process.uptime()),
                timestamp: new Date().toISOString()
            };
            return _textResult(JSON.stringify(health, null, 2));
        });
    }

    /**
     * 注册一个内置管理工具到 ToolRegistry。
     * @param {string} action   - 操作名（不含前缀）
     * @param {string} desc     - 工具描述
     * @param {() => Promise<Object>} handler
     * @private
     */
    _registerBuiltin(action, desc, handler) {
        const name = `${BUILTIN_PREFIX}${action}`;
        this._toolRegistry.register({
            name,
            source: 'builtin',
            description: desc,
            inputSchema: { type: 'object', properties: {} },
            _handler: handler  // 存储 handler 供 _handleToolCall 调用
        });
    }
}

// ─── 内部工具函数 ──────────────────────────────────────────────────────────────

/**
 * 构建脚本的 JSON Schema inputSchema。
 * @param {import('../types.js').ScriptMeta} meta
 * @returns {Object}
 * @private
 */
function _buildScriptInputSchema(meta) {
    const properties = {};
    for (const param of meta.params) {
        properties[param.name] = {
            type: param.type,
            description: param.description
        };
    }
    return {
        type: 'object',
        properties,
        required: meta.params.filter(p => p.required).map(p => p.name)
    };
}

/**
 * 构造文本类型的 CallToolResult。
 * @param {string} text
 * @returns {Object}
 * @private
 */
function _textResult(text) {
    return {
        content: [{ type: 'text', text }]
    };
}

export default MCPGateway;
