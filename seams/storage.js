/**
 * seams/storage.js — 持久化存储契约（能力接缝）
 *
 * Provider：`plugins/storage/core`（`setup` 内 `ctx.provide('storage', createStorage)`）。
 * Consumer：`Server/DbUse/index.js` 门面（经 hostBridge.createStorageFromHost 取提供方），
 *           及其下游 Store 使用者（SessionStore / TaskStepStore /
 *           TaskExecutionStore / TaskRegistryStore / MessageArchive）。
 *
 * 服务形状：**工厂函数**——`createStorage(options)` 同步返回一个门面对象，
 *   不是类、不是单例、不是注册表。依据：存储门面天然「按数据目录、按卡死阈值
 *   各建一套」，单例化会把「谁用哪个根目录」重新焊死。
 *
 * 契约 v2（校正）：v1 写的是 `factory: false` +「四种适配器类各自成为接缝提供方」
 *   + `storage:json` 等限定名，与实现不符——实现从未按格式注册服务，只注册了
 *   这一个门面工厂。本次按 `plugins/storage/core/createStorage.js` 的真实返回对象
 *   与 `StorageManager._ADAPTERS` 更正；v1 的适配器矩阵与限定名说法保留在
 *   `adapterMethods` / `perTypeProviders` 两处，并标注现状（不删除历史信息）。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3 要求契约只碰契约）。
 */

export const STORAGE_SEAM = Object.freeze({
    name: 'storage',
    version: 2,
    /** 提供方注册的是工厂函数：`ctx.provide('storage', createStorage)` */
    factory: true,
    description: '持久化存储门面工厂：统一根目录、按格式取适配器、按子域取 Store、统一关闭',
    /** 工厂入参（对齐 `createStorage(options)`：rootDir→StorageManager.rootDir，stallThresholdMs→Session 卡死阈值） */
    factoryOptions: Object.freeze(['rootDir', 'stallThresholdMs']),
    /**
     * 工厂产物必须提供的键（逐条对齐 `createStorage()` 的返回对象，共 11 项）：
     * manager 属性 1 项 + Store 访问器 5 项（惰性单例）+ 适配器直取 4 项 + close 1 项。
     */
    facadeMethods: Object.freeze([
        'manager', // StorageManager 实例：根目录解析 + 按 (type,subDir) 复用适配器 + closeAll
        'sessionStore', // () => SessionStore（db/Session：jsonl 消息流 + meta.json）
        'taskStepStore', // () => TaskStepStore（db/TaskStep/store.db，SQLite）
        'taskExecStore', // () => TaskExecutionStore（db/task/{taskId}/stepid_{stepId}.json）
        'taskRegistryStore', // () => TaskRegistryStore（db/TaskRegistry/registry.db）
        'messageArchive', // () => MessageArchive（兼容门面，独立接缝见 seams/message-archive.js）
        'json', // (subDir) => JsonAdapter
        'jsonl', // (subDir) => JsonlAdapter
        'sqlite', // (subDir) => SqliteAdapter
        'file', // (subDir?) => FileAdapter，默认子域 'Artifacts'
        'close', // async () => void（manager.closeAll()）
    ]),
    /** 消费者真正依赖的时序/复用语义 */
    facadeNotes: Object.freeze({
        sync: '工厂与全部访问器均同步返回；只有 Store / 适配器方法返回 Promise',
        lazyStore: 'Store 访问器惰性单例：首次调用构造并缓存，之后返回同一实例',
        adapterReuse: '适配器实例按 `${type}:${subDir}` 复用；close() 后缓存清空，再取是新实例',
    }),

    // ─── 适配器：随 `storage/core` 一并提供，**不是**独立接缝提供方 ─────────────
    /** `StorageManager._ADAPTERS` 内置的四种格式（实现内部分层，经门面/manager 取用） */
    adapterTypes: Object.freeze(['json', 'jsonl', 'sqlite', 'file']),
    /** 各格式适配器的方法矩阵（对齐 adapters/*.js 现存实现；属实现内部契约，非接缝提供方契约） */
    adapterMethods: Object.freeze({
        json: Object.freeze(['read', 'write', 'delete', 'list']), // 整文档
        jsonl: Object.freeze(['append', 'appendBatch', 'read', 'readLast', 'delete', 'list']), // 追加流
        sqlite: Object.freeze(['exec', 'all', 'get', 'upsert', 'transaction', 'getDb', 'delete', 'close']),
        file: Object.freeze([
            'write',
            'read',
            'readFile',
            'createFile',
            'appendFile',
            'exists',
            'stat',
            'delete',
            'list',
        ]), // 原始文件
    }),
    /** 各格式刻意不列为「可用方法」的例外（实现里确实存在，但不是能力承诺） */
    adapterExceptions: Object.freeze({
        sqlite: Object.freeze({
            /** 存在但一律抛错：SQLite 没有通用整文档读写，请用 all/get/exec/upsert */
            throwingStubs: Object.freeze(['read', 'write', 'list']),
            /** 只读诊断属性，不是契约方法 */
            diagnostics: Object.freeze(['stmtCacheSize']),
        }),
    }),
    /** 适配器构造入参（对齐 BaseAdapter / SqliteAdapter 的构造签名；由 StorageManager.get 传入） */
    adapterOptions: Object.freeze(['baseDir', 'subDir', 'dbName']),
    /** BaseAdapter 提供、子类无需重写的基础能力 */
    baseMethods: Object.freeze(['ensureDir', 'path', 'pathSync', 'type']),
    /** BaseAdapter 声明、子类必须覆盖的抽象方法（基类默认抛 NotImplemented） */
    abstractMethods: Object.freeze(['read', 'write', 'delete', 'list']),

    /**
     * 按类型的独立提供方：**尚未提供**（后续步骤）。
     *
     * 现状：四种适配器只经 `storage/core` 内部的 `StorageManager._ADAPTERS` 取用，
     *   该注册表是硬编码的 4 个类，无法单独替换其中一种格式。
     * 目标形态（未实现）：每个格式拆成独立插件 `plugins/storage/{json,jsonl,sqlite,file}`，
     *   各自 `ctx.provide('storage', ...)`；按 core/Context.js 的限定名规则
     *   （`${serviceName}@${pluginName}`）将得到 `storage@storage/json`、
     *   `storage@storage/jsonl`、`storage@storage/sqlite`、`storage@storage/file`。
     * 注意：v1 里写的 `storage:json` 这类名字**从未存在**，不要按它接线。
     */
    perTypeProviders: Object.freeze({
        status: 'not-provided',
        plannedQualifiedNames: Object.freeze([
            'storage@storage/json',
            'storage@storage/jsonl',
            'storage@storage/sqlite',
            'storage@storage/file',
        ]),
        legacyNamesFromV1: Object.freeze(['storage:json', 'storage:jsonl', 'storage:sqlite', 'storage:file']),
    }),
});

export default STORAGE_SEAM;
