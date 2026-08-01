/**
 * types.js — 类型定义（JSDoc 形式）
 *
 * 本文件以 JSDoc typedef 定义对外接口的数据结构，
 * 供 IDE 智能提示和调用方文档参考，不产生运行时副作用。
 */

/**
 * @typedef {Object} CatalogConfig
 * @property {string} id            目录标识，如 'guides'
 * @property {string} title         目录中文名
 * @property {number} [searchBoost] 搜索权重倍数（>1 提升）
 * @property {boolean} [tailInGlobalSearch] 全局搜索时是否排到尾部
 */

/**
 * @typedef {Object} EngineOptions
 * @property {string} dataDir           数据根目录
 * @property {CatalogConfig[]} [catalogs] 目录配置
 * @property {string} [lexiconDir]      词典目录（不传用内置默认）
 * @property {'directory'|'zip'} [storageMode] 存储方式，默认 directory
 * @property {string} [dbPath]          索引数据库路径
 * @property {boolean} [autoIndex=true] 写入时自动分词建索引
 * @property {number} [maxSectionsPerDoc=28] 单文档最大段数
 * @property {number} [defaultLimit=10] 搜索默认上限
 */

/**
 * @typedef {Object} DocumentInput
 * @property {string} documentId        文档唯一标识
 * @property {string} catalog           所属目录 ID
 * @property {string} [title]           文档标题
 * @property {string} content           Markdown 原文
 * @property {Record<string,string>} [metadata] 自定义元数据
 */

/**
 * @typedef {Object} SearchQuery
 * @property {string} query              搜索关键词（空格分隔）
 * @property {string} [catalog]          限定目录
 * @property {number} [limit]            结果数量上限
 * @property {boolean} [includeSnippet=true] 是否包含摘要
 * @property {number} [snippetMaxChars=200] 摘要最大字符数
 */

/**
 * @typedef {Object} SearchOptions
 * @property {boolean} [preferAnd]       是否优先 AND 匹配
 * @property {boolean} [expandSynonyms=true] 是否启用同义词扩展
 * @property {number} [synonymExpandLimit=8] 同义词扩展上限
 */

/**
 * @typedef {Object} SearchResult
 * @property {string} documentId
 * @property {string} title
 * @property {string} sectionTitle
 * @property {string} snippet
 * @property {number} score              相关度（越小越相关）
 * @property {string} catalog
 * @property {number} [rawScore]         Rerank 前 BM25 分数
 */

/**
 * @typedef {Object} DocumentRecord
 * @property {string} documentId
 * @property {string} title
 * @property {string} catalog
 * @property {string} content
 * @property {number} segmentCount
 * @property {Record<string,string>} [metadata]
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} EngineStatus
 * @property {boolean} ready
 * @property {number} documentCount
 * @property {number} segmentCount
 * @property {number} dbSizeBytes
 * @property {string} indexVersion
 * @property {number|null} lastBuiltAt
 * @property {boolean} isWriting
 */
