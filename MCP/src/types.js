/**
 * MCP Gateway 类型定义
 *
 * 使用 JSDoc @typedef 定义所有共享类型，保持 JS 项目的类型安全。
 * 各模块通过 @import 或 @type 引用这些类型。
 */

/**
 * 下游 MCP Server 配置（stdio 类型）。
 * @typedef {Object} StdioServerConfig
 * @property {'stdio'} type        - 传输类型，固定为 'stdio'
 * @property {string} command          - 启动命令（如 'npx'、'node'、'python3'）
 * @property {string[]} args           - 命令参数
 * @property {Object<string, string>} [env] - 环境变量
 * @property {boolean} [enabled]       - 是否启用，默认 true
 */

/**
 * 下游 MCP Server 配置（remote 类型）。
 * @typedef {Object} RemoteServerConfig
 * @property {'remote'} type       - 传输类型，固定为 'remote'
 * @property {string} url          - 远程 MCP Server URL（如 'https://example.com/mcp'）
 * @property {Object<string, string>} [headers] - 自定义 HTTP 请求头（如 Authorization）
 * @property {boolean} [enabled]   - 是否启用，默认 true
 */

/**
 * 下游 MCP Server 配置（联合类型）。
 * @typedef {StdioServerConfig | RemoteServerConfig} DownstreamServerConfig
 */

/**
 * 脚本功能配置。
 * @typedef {Object} ScriptsConfig
 * @property {boolean} enabled              - 是否启用脚本功能
 * @property {boolean} hotReload            - 是否热加载脚本
 * @property {number} timeout               - 脚本执行超时（ms）
 * @property {string[]} allowedExtensions   - 允许的脚本扩展名
 */

/**
 * 知识库 catalog 配置（与 Archive CatalogConfig 对应）。
 * @typedef {Object} KBCatalogConfig
 * @property {string} id            - 目录标识，如 'guides'
 * @property {string} title         - 目录中文名
 * @property {number} [searchBoost] - 搜索权重倍数（>1 提升）
 * @property {boolean} [tailInGlobalSearch] - 全局搜索时是否排到尾部
 */

/**
 * 知识库配置。
 * @typedef {Object} KnowledgeBaseConfig
 * @property {boolean} enabled          - 是否启用知识库工具
 * @property {string} enginePath       - Archive 引擎入口路径（ESM import 路径）
 * @property {string} dataDir          - 知识库数据根目录（文档 + 索引）
 * @property {KBCatalogConfig[]} [catalogs] - 目录配置（不传使用 Archive 默认）
 */

/**
 * Gateway 总配置。
 * @typedef {Object} GatewayConfig
 * @property {Object<string, DownstreamServerConfig>} downstreamServers - 下游 Server 配置
 * @property {string} scriptsDir        - 脚本目录路径
 * @property {ScriptsConfig} scripts    - 脚本功能配置
 * @property {KnowledgeBaseConfig} [knowledgeBase] - 知识库配置（可选）
 * @property {{ name: string, version: string, transport: 'stdio' }} gateway - Gateway 元信息
 */

/**
 * 脚本参数定义。
 * @typedef {Object} ScriptParam
 * @property {string} name          - 参数名
 * @property {'string'|'number'|'boolean'} type - 参数类型
 * @property {string} description   - 参数描述
 * @property {boolean} required     - 是否必填
 */

/**
 * 脚本元数据（从头部 @tool 注释解析）。
 * @typedef {Object} ScriptMeta
 * @property {string} toolName      - 注册的工具名（含 'script_' 前缀）
 * @property {string} rawName       - 原始工具名（去掉前缀）
 * @property {string} description   - 工具描述
 * @property {string} filePath      - 脚本文件绝对路径
 * @property {string} extension     - 文件扩展名（如 '.sh'）
 * @property {ScriptParam[]} params - 参数列表
 */

/**
 * 聚合工具来源类型。
 * @typedef {'downstream'|'script'|'builtin'} ToolSource
 */

/**
 * 聚合工具条目。
 * @typedef {Object} AggregatedTool
 * @property {string} name              - 聚合后的工具名（含前缀）
 * @property {ToolSource} source        - 来源类型
 * @property {string} [sourceServer]    - 下游来源 Server 名（source='downstream' 时）
 * @property {string} [originalName]    - 下游原始工具名（source='downstream' 时）
 * @property {string} description       - 工具描述
 * @property {Object} inputSchema       - JSON Schema 输入定义
 */

/**
 * 下游 Server 连接状态。
 * @typedef {Object} ServerConnectionStatus
 * @property {string} name          - Server 名称
 * @property {boolean} connected    - 是否已连接
 * @property {number} toolCount     - 已注册工具数
 * @property {string} [error]       - 错误信息
 * @property {number} [processPid]  - 子进程 PID
 */

export {};
