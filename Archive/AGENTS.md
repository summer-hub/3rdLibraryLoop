# Archive — 本地文档检索引擎 (doc-search-engine)

基于 SQLite FTS5 全文检索 + BM25 Rerank 重排序 + jieba-wasm 中文分词的本地 Markdown 文档检索引擎。

## 运行

```bash
cd Archive
npm install jieba-wasm   # 可选，未安装时回退到简易正则分词
node demo.js             # 演示
```

- **Node.js ≥ 22**（使用内置 `node:sqlite` 模块，无需 WASM SQLite）
- **ESM** (`"type": "module"`)
- 唯一外部依赖：`jieba-wasm`（可选，缺失时自动降级）

## 目录结构

```
Archive/
├── package.json              # 包定义，入口 src/index.js
├── demo.js                   # 功能演示脚本
├── AGENTS.md                 # 本文件
├── data/                     # 默认数据目录（可 git 提交）
│   ├── docs/                 # 文档原文 .md 文件（按 catalog/路径 组织）
│   └── .index/               # 索引数据
│       ├── search.db         # SQLite FTS5 索引数据库
│       ├── meta.json         # 索引元数据（版本、指纹、构建时间）
│       └── write.lock        # 写入锁文件
└── src/
    ├── index.js              # 对外导出入口
    ├── engine.js             # 核心门面 DocSearchEngine
    ├── constants.js          # 全局常量与阈值
    ├── types.js              # JSDoc 类型定义
    ├── db/
    │   ├── sqlite-backend.js # SQLite 后端（node:sqlite 适配层）
    │   └── sqlite-schema.js  # FTS5 DDL 表结构定义
    ├── store/
    │   ├── doc-store.js      # 存储抽象接口
    │   └── dir-store.js      # 目录存储实现（.md 文件）
    ├── tokenizer/
    │   ├── tokenizer.js      # jieba-wasm 分词器
    │   └── lexicon.js        # 词典/同义词/停用词管理
    ├── parser/
    │   ├── markdown-splitter.js  # Markdown → 索引段拆分
    │   ├── api-identifiers.js    # API 符号提取
    │   ├── api-suffixes.js       # API 命名后缀规则
    │   └── heading-normalize.js  # 标题文本规范化
    ├── index/
    │   ├── index-manager.js      # 索引管理器（增删改）
    │   ├── index-state.js        # 索引状态/重建判断
    │   └── search-text-builder.js# 段搜索文本组装
    ├── search/
    │   ├── search-engine.js      # 搜索调度层
    │   ├── fts-search.js         # FTS5 查询 + Rerank
    │   ├── query-normalizer.js   # 查询预处理
    │   ├── query-rewriter.js     # 同义词扩展重写器
    │   ├── catalog-routing.js    # 目录权重路由
    │   └── snippet.js            # 搜索摘要提取
    ├── utils/
    │   ├── path-safety.js    # 路径穿越防护
    │   ├── paths.js          # 运行时路径管理
    │   ├── lock.js           # 文件锁（写入串行化）
    │   └── hash.js           # SHA256 哈希工具
    └── data/                 # 内置词典文件
        ├── terms.txt         # 领域术语词典
        ├── synonyms.json     # 同义词表
        └── stopwords.txt     # 停用词表
```

## 架构概览

```
用户调用 engine.addDocument() / engine.search()
     │
     ▼
┌─────────────────────────────────────────────┐
│           engine.js (DocSearchEngine)       │  ← 门面层
│  统一编排各子模块，写入加锁，查询无锁        │
└──────┬──────────┬──────────┬────────────────┘
       │          │          │
       ▼          ▼          ▼
  ┌────────┐ ┌─────────┐ ┌──────────┐
  │ store  │ │  index  │ │  search  │
  │(dir-   │ │(manager)│ │(engine)  │
  │ store) │ │         │ │          │
  └───┬────┘ └────┬────┘ └────┬─────┘
      │           │           │
      │           ▼           ▼
      │     ┌──────────┐ ┌─────────┐
      │     │  parser  │ │   fts   │
      │     │(splitter)│ │(search) │
      │     └────┬─────┘ └────┬────┘
      │          │            │
      │          ▼            │
      │     ┌──────────┐      │
      │     │tokenizer │◄─────┤  分词器共享
      │     │(jieba)   │      │
      │     └────┬─────┘      │
      │          │            │
      │          ▼            │
      │     ┌──────────┐      │
      │     │  lexicon │◄─────┤  词典共享
      │     │(synonyms)│      │
      │     └──────────┘      │
      │                       │
      ▼                       ▼
  ┌────────────────────────────────┐
  │       db/sqlite-backend        │  ← SQLite 读写分离
  │  (node:sqlite DatabaseSync)    │
  └────────────────────────────────┘
```

### 核心数据流

**写入流程** (`addDocument`):
1. `PathSafety` 校验 documentId 无路径穿越
2. `acquireLock` 获取写入锁（串行化）
3. `DirectoryDocStore.write()` 写 .md 原文到 `docs/`
4. `IndexManager.addDocument()`:
   - `splitMarkdown()` 按 H4 拆分为段
   - `extractApiSymbols()` 提取 API 符号
   - `buildSearchText()` 按预算组装段搜索文本
   - `tokenizer.tokenizeForIndex()` 分词写入
   - 写入 `documents` + `segments` 表，触发器自动同步 FTS5
5. 失效只读 DB 缓存
6. 更新 `meta.json`
7. 释放锁

**查询流程** (`search`):
1. `QueryRewriter.expand()` 同义词扩展（可关闭）
2. `prepareQuery()` 规范化 + jieba 分词 + 特殊模式检测
3. `FtsSearch.search()`:
   - AND/OR 回退策略（token 2-4 个时优先 AND）
   - FTS5 MATCH 查询 + BM25 排序
   - 池放大 (`limit × RERANK_POOL_FACTOR`) → Rerank
   - 目录权重 boost（API 查询提 references，如何类查询提 guides）
   - 标题/API 符号匹配 boost
   - 同文档多段去重（保留最佳段）
4. `extractSnippet()` 提取摘要

## 模块详解

### engine.js — 核心门面

对外 API：

| 方法 | 说明 |
|------|------|
| `init(options)` | 初始化引擎（数据目录、目录映射、词典、DB、存储、索引） |
| `search(query, options)` | 搜索，返回 `SearchResult[]` |
| `addDocument(doc)` | 添加/更新单个文档（加锁） |
| `addDocuments(docs)` | 批量添加（单事务） |
| `removeDocument(documentId)` | 删除文档（加锁） |
| `rebuildIndex()` | 全量重建索引（从 store 读取所有 .md） |
| `vacuum()` | VACUUM 压缩数据库 |
| `checkpoint()` | WAL checkpoint（git 提交前调用） |
| `getStatus()` | 引擎状态（文档数、段数、DB 大小等） |
| `hasDocument(documentId)` | 检查文档是否存在 |
| `getDocument(documentId)` | 获取文档原文 |
| `getDocumentRecord(documentId)` | 获取文档元数据记录 |
| `rawQuery(sql, ...params)` | 原始 SQL 查询（高级） |
| `addSynonyms(words)` | 注册运行时同义词组 |
| `addTerms(words)` | 添加自定义分词词条 |
| `close()` | 关闭引擎 |

**设计原则**：
- 写入操作全部通过 `acquireLock` 串行化
- 查询无锁，复用只读 DB 连接
- `assertReady()` 保证初始化后才可操作

### db/ — SQLite 后端

- **sqlite-backend.js**: 基于 `node:sqlite` 的 `DatabaseSync`
  - `StmtAdapter`: 适配 `StatementSync` 为 WASM 风格的 `bind/step/get/finalize` 接口
  - 读写分离：`openWriteDb`（持久化文件） / `openReadDb`（按 mtimeMs 缓存只读连接）
  - 写入后 `invalidateReadCache()` 失效只读缓存
  - 支持 `vacuum()` 和 `checkpoint()`
- **sqlite-schema.js**: FTS5 DDL
  - `documents` 表：文档元信息（id, document_id, catalog_id, doc_title, metadata, timestamps）
  - `segments` 表：文档拆分后的索引段（doc_id, section_title, lead_text, search_text）
  - `segments_fts` 虚拟表：FTS5 全文索引（外部内容表模式 `content='segments'`）
  - 同步触发器：segments 增删改自动同步 FTS
  - `index_meta` 表：索引元数据键值对

### store/ — 文档存储

- **doc-store.js**: 抽象接口（`write/read/delete/list`），支持插拔实现
- **dir-store.js**: 目录存储实现
  - 文档以 `.md` 文件存放在 `docs/{catalog}/{path}.md`
  - 路径穿越防护：documentId 中禁止 `..`
  - `list()` 递归遍历返回所有文档 ID

### tokenizer/ — 分词层

- **tokenizer.js**: jieba-wasm 分词器
  - 索引时用搜索引擎模式（`cutForSearch`，细粒度高召回）
  - 查询时用精确模式（`cut`，高准确率）
  - WASM 懒加载单例 + 并发安全
  - 未安装 jieba-wasm 时回退到 `simpleTokenize`（正则中英文切分）
  - 合并装饰器（`@` + `Component` → `@Component`）
  - 去停用词、保留大小写变体
- **lexicon.js**: 词典文件管理
  - `terms.txt`: 领域术语（增强 jieba 分词）
  - `synonyms.json`: 同义词组（双向映射，查询扩展）
  - `stopwords.txt`: 停用词
  - 词典指纹（SHA256）用于判断是否需要重建索引

### parser/ — Markdown 解析

- **markdown-splitter.js**: 将 Markdown 按 H4 标题拆分为索引段
  - 不依赖 AST 库，使用轻量正则 + 行扫描
  - 代码块内不识别标题
  - 限制单文档最大段数 (`MAX_SECTIONS_PER_DOC = 28`)
  - 每段输出：`sectionTitle / leadText / apiSymbols / headingsText / titleTokens / bodySample`
- **api-identifiers.js**: 从文本和代码块提取 API 符号
  - 模块路径 `@ohos.camera`、camelCase `cameraManager`、PascalCase `CameraManager`、装饰器 `@Component`
  - 过滤通用词（API, Type, Value...）和被包含的子串
- **api-suffixes.js**: API 命名后缀规则（Manager, Controller, Service...）
- **heading-normalize.js**: 标题规范化（去 `#`/`*`/`` ` ``/链接，合并空白）

### index/ — 索引层

- **index-manager.js**: 索引增删改
  - 单文档添加：先删旧索引 → 拆段 → 组装 search_text → 事务写入
  - 批量添加：外层事务包裹多个 `addDocumentInternal`
  - 删除：级联删除 segments（`ON DELETE CASCADE`）+ FTS 触发器自动清理
- **index-state.js**: 索引状态管理
  - 判断是否需要重建：版本变更 / 词典指纹变更 / 无索引
  - 持久化 `meta.json`（indexVersion, termsHash, synonymsHash, segmentCount, builtAt）
- **search-text-builder.js**: 按字符预算组装段搜索文本
  - 标题和 API 符号占比较高（精确匹配优先）
  - 段级与文档级有不同预算（见 constants.js）

### search/ — 搜索层

- **search-engine.js**: 搜索调度层
  - 编排：同义词扩展 → 查询预处理 → FTS5 检索 → Rerank → 摘要
- **fts-search.js**: FTS5 查询执行 + Rerank 重排序
  - BM25 排序基础
  - 多层 boost：目录权重、标题匹配、API 符号匹配
  - 同文档多段去重（保留最佳段）
  - AND/OR 回退策略
- **query-normalizer.js**: 查询预处理
  - 合并空白、截断超长查询
  - 特殊模式：单个 API 符号、API 短语拆分（`camera manager`）
  - 2-4 token 自动启用 `preferAnd`
  - 构建 FTS MATCH 表达式（`buildFtsOrMatch` / `buildFtsAndMatch`）
- **query-rewriter.js**: 运行时同义词扩展
  - 内存同义词组叠加到 Lexicon 词典之上
  - 不修改磁盘词典文件
- **catalog-routing.js**: 目录权重路由
  - `@ohos.` 查询 → references ×1.5
  - "如何/步骤" 查询 → guides ×1.45
  - 中英混合 → guides ×1.45 + references ×1.35
  - `tailInGlobalSearch` 目录排尾部
- **snippet.js**: 搜索摘要提取
  - 以查询词命中位置为中心截取
  - 词边界截断 + 省略号标记

### utils/ — 工具层

- **path-safety.js**: 路径穿越防护（`PathSafetyError`）
  - 校验数据目录可访问
  - 防止 documentId 中 `..` 和绝对路径
  - 校验文件在沙箱内
- **paths.js**: 运行时路径管理（docs / .index / db / meta / lock）
- **lock.js**: 简易文件锁
  - 基于 `fs.open(..., 'wx')` 原子操作
  - 写入 PID + 时间戳，stale 自动释放（30 分钟）
  - 轮询获取，200ms 间隔
- **hash.js**: SHA256 文本哈希（词典指纹）

## 关键常量 (constants.js)

| 常量 | 值 | 说明 |
|------|----|------|
| `DEFAULT_DATA_DIR` | `../data` | 默认数据目录（Archive/data） |
| `INDEX_VERSION` | `1.0.0` | 索引版本（变更需全量重建） |
| `INDEX_DB_MAX_BYTES` | 48MB | DB 大小上限 |
| `GIT_WARN_BYTES` | 8MB | Git 提交警告阈值 |
| `MAX_SECTIONS_PER_DOC` | 28 | 单文档最大段数 |
| `RERANK_POOL_FACTOR` | 6 | 结果池放大系数 |
| `LOCK_STALE_MS` | 30 分钟 | 锁过期时间 |

### 默认目录配置

| ID | 标题 | 特殊属性 |
|----|------|----------|
| guides | 开发指南 | — |
| references | API参考 | — |
| best-practices | 最佳实践 | — |
| faqs | 常见问题 | — |
| releases | 版本说明 | `tailInGlobalSearch` |
| roadmap | 变更预告 | `tailInGlobalSearch` |

## 开发规范

### 代码风格
- 纯 JavaScript ESM（`import/export`），无 TypeScript
- JSDoc 类型注释（见 `types.js` 中的 typedef 定义）
- 每个文件头部有模块说明注释块
- 函数有 `@param` / `@returns` 注释
- 避免魔术数字，常量集中管理在 `constants.js`

### 安全规范
- 所有 documentId 必须经过 `PathSafety.validateDocumentId()` 校验
- 写入操作必须通过 `acquireLock()` 获取文件锁
- 文件操作限制在 `dataRoot` 内（`assertPathInside`）

### 依赖原则
- 优先使用 Node.js 内置模块（`node:sqlite`, `node:fs`, `node:path`, `node:crypto`）
- 外部依赖仅 `jieba-wasm`（可选，缺失时自动降级）
- 不依赖 AST 解析库（unified/remark），使用轻量正则

### 数据安全
- `data/` 目录可 git 提交（包含 docs 原文 + .index 索引）
- 重复执行 demo.js 不会覆盖已有数据（已存在文档自动跳过）
- git 提交前调用 `engine.checkpoint()` 确保 WAL 合并到主库
- DB 超过 `GIT_WARN_BYTES` 时 `getStatus()` 返回 `dbSizeWarning: true`

## 类型定义 (types.js)

核心 JSDoc typedef：

- `EngineOptions`: 初始化参数（dataDir, catalogs, lexiconDir, dbPath...）
- `DocumentInput`: 文档输入（documentId, catalog, content, title, metadata）
- `SearchQuery`: 搜索查询（query, catalog, limit, includeSnippet...）
- `SearchResult`: 搜索结果（documentId, title, sectionTitle, snippet, score, catalog）
- `DocumentRecord`: 文档记录（含 segmentCount, createdAt, updatedAt）
- `EngineStatus`: 引擎状态（ready, documentCount, segmentCount, dbSizeBytes...）
- `CatalogConfig`: 目录配置（id, title, searchBoost, tailInGlobalSearch）
