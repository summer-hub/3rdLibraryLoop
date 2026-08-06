/**
 * KBToolProvider —— 知识库工具提供者
 *
 * 封装 Archive 的 DocSearchEngine，将其搜索/文档管理/索引管理能力
 * 以 MCP 内置工具形式（前缀 `kb_`）注册到 ToolRegistry。
 *
 * 设计原则：
 *   - 高内聚：所有知识库相关的工具定义、引擎生命周期、调用分发集中于此。
 *   - 低耦合：不直接依赖 MCP SDK，只产出纯数据（工具定义 + handler），
 *     由 Gateway 负责注册到 MCP Server。
 *   - 延迟初始化：引擎在 register() 时仅注册工具定义（不启动引擎），
 *     首次调用搜索类工具时才惰性 init()，避免 Gateway 启动阻塞。
 *
 * 工具清单（前缀 kb_）：
 *   - kb_search          全文搜索（FTS5 + BM25 Rerank + jieba 中文分词）
 *   - kb_add_document    添加/更新文档
 */

import path from 'node:path';
import { createLogger } from '../library/logger.js';

const log = createLogger('KBToolProvider');

/** 知识库工具前缀 */
const KB_PREFIX = 'kb_';

class KBToolProvider {
    /**
     * @param {import('../types.js').KnowledgeBaseConfig} config
     */
    constructor(config) {
        this._config = config;
        /** @type {import('../../Archive/src/engine.js').default | null} */
        this._engine = null;
        this._initialized = false;
        this._initPromise = null;
    }

    // ─── 生命周期 ──────────────────────────────────────────────────────────────

    /**
     * 惰性初始化引擎（并发安全：多次调用复用同一 Promise）。
     * @returns {Promise<void>}
     */
    async _ensureInit() {
        if (this._initialized) return;
        if (!this._initPromise) {
            this._initPromise = this._doInit();
        }
        await this._initPromise;
    }

    /**
     * 实际执行引擎初始化。
     * @private
     */
    async _doInit() {
        // 动态导入 Archive 引擎，避免未启用知识库时加载失败
        const { DocSearchEngine } = await import(this._config.enginePath);

        this._engine = new DocSearchEngine();

        const initOptions = {
            dataDir: this._config.dataDir,
            catalogs: this._config.catalogs,
        };

        await this._engine.init(initOptions);
        this._initialized = true;

        const status = await this._engine.getStatus();
        log.info('知识库引擎已初始化', {
            dataDir: this._config.dataDir,
            documentCount: status.documentCount,
            segmentCount: status.segmentCount,
            dbSizeBytes: status.dbSizeBytes,
        });
    }

    /**
     * 关闭引擎，释放资源。
     * @returns {Promise<void>}
     */
    async shutdown() {
        if (this._engine) {
            try {
                await this._engine.close();
            } catch (err) {
                log.warn('关闭知识库引擎时出错', { error: err.message });
            }
            this._engine = null;
            this._initialized = false;
            this._initPromise = null;
        }
    }

    // ─── 工具注册 ──────────────────────────────────────────────────────────────

    /**
     * 返回所有知识库工具定义（含 handler）。
     * 每个工具包含 name / source / description / inputSchema / _handler。
     *
     * @returns {Array<{name:string, source:'builtin', description:string, inputSchema:Object, _handler:(args:Object)=>Promise<Object>}>}
     */
    getTools() {
        return [
            this._searchTool(),
            this._addDocumentTool(),
        ];
    }

    // ─── 工具定义 ──────────────────────────────────────────────────────────────

    /**
     * kb_search — 全文搜索。
     * @private
     */
    _searchTool() {
        return {
            name: `${KB_PREFIX}search`,
            source: 'builtin',
            description: '知识库全文搜索（FTS5 + BM25 Rerank + jieba 中文分词）。支持按目录过滤、同义词扩展。返回相关度排序的文档片段摘要。',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '搜索关键词（空格分隔多词）',
                    },
                    catalog: {
                        type: 'string',
                        description: '限定搜索的目录 ID（如 guides/references/best-practices/faqs/releases/roadmap）。不传则全局搜索。',
                    },
                    limit: {
                        type: 'number',
                        description: '返回结果数量上限，默认 10',
                    },
                    includeSnippet: {
                        type: 'boolean',
                        description: '是否包含摘要片段，默认 true',
                    },
                    snippetMaxChars: {
                        type: 'number',
                        description: '摘要最大字符数，默认 200',
                    },
                    preferAnd: {
                        type: 'boolean',
                        description: '是否优先 AND（全部匹配）策略，默认 false（OR 任一匹配）',
                    },
                },
                required: ['query'],
            },
            _handler: async (args) => {
                await this._ensureInit();
                const results = await this._engine.search(
                    { query: args.query },
                    {
                        catalog: args.catalog,
                        limit: args.limit,
                        includeSnippet: args.includeSnippet,
                        snippetMaxChars: args.snippetMaxChars,
                        preferAnd: args.preferAnd,
                    }
                );
                return _textResult(JSON.stringify(results, null, 2));
            },
        };
    }

    /**
     * kb_add_document — 添加或更新文档。
     * @private
     */
    _addDocumentTool() {
        return {
            name: `${KB_PREFIX}add_document`,
            source: 'builtin',
            description: '向知识库添加或更新文档（自动分词建索引）。若文档已存在则覆盖更新。',
            inputSchema: {
                type: 'object',
                properties: {
                    documentId: {
                        type: 'string',
                        description: '文档唯一标识（如 guides/intro）。禁止包含 .. 或绝对路径。',
                    },
                    catalog: {
                        type: 'string',
                        description: '所属目录 ID（如 guides/references/best-practices/faqs/releases/roadmap）',
                    },
                    title: {
                        type: 'string',
                        description: '文档标题（可选，不传则从 Markdown 首个标题提取）',
                    },
                    content: {
                        type: 'string',
                        description: '文档 Markdown 原文',
                    },
                },
                required: ['documentId', 'catalog', 'content'],
            },
            _handler: async (args) => {
                await this._ensureInit();
                await this._engine.addDocument({
                    documentId: args.documentId,
                    catalog: args.catalog,
                    title: args.title,
                    content: args.content,
                });
                return _textResult(`文档已添加: ${args.documentId} (catalog: ${args.catalog})`);
            },
        };
    }
}

// ─── 内部工具函数 ──────────────────────────────────────────────────────────────

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

export default KBToolProvider;
