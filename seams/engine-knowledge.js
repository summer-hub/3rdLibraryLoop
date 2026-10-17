/**
 * seams/engine-knowledge.js — 知识沉淀引擎契约（能力接缝）
 *
 * Provider：`plugins/engines/knowledge`（`setup` 内 `ctx.provide('engine-knowledge', KnowledgeManager)`）。
 * Consumer：`Server/Knowledge/**` 门面（`Server/composition/buildApp.js`、`Server/FlexRunner/`、
 *           `KnowledgeImportController`、`cli/lib/runner.js`）——它们的调用形状一直是
 *           `new KnowledgeManager()` + `await init()`，故注册**类**而不是工厂/单例。
 *           有宿主时消费者也可 `host.inject('engine-knowledge')` 取到同一个类。
 *
 * 服务形状：**类**（`factory: false`）——提供方的能力面全是**实例方法**，消费者自己
 * `new` 出来再 `init()`。注册工厂会强迫消费方多包一层 `new (inject(...))()`，注册单例
 * 则会焊死一个既有语义：每个 FlexRunner 各自 `new` 一个 KnowledgeManager 并共享
 * **按存储根目录**的串行锁（`knowledge:<rootDir>`），靠共享锁而不是共享实例来防丢更新。
 *
 * 实例方法清单从真实实现（`plugins/engines/knowledge/KnowledgeManager.js`）推导，
 * 逐条对齐公开 API，不含私有 `_xxx`：消费者不该 poke 实现的内部状态。
 *
 * ⚠️ 旁边的 `KnowledgeImporter` **不是**本接缝的一部分：它是被 HTTP 控制器直接 `new`
 *    的执行引擎（协作者 cli/storage/knowledgeManager 一律注入），没有"换提供方"的诉求。
 *    把它也塞进契约会把一条内部实现细节写进消费者契约（YAGNI）。
 *
 * 归属声明：`plugins/engines/knowledge/plugin.json` 与入口 `definePlugin` 都写
 * `seam: 'engine-knowledge'`。这是引擎簇（后续 brain / orchestrator / flexrunner /
 * testcheck / loopengine）的第一条接缝，形状刻意与 `storage` / `stats` / `app-logger` 对齐。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3 要求契约只碰契约）。
 */

export const ENGINE_KNOWLEDGE_SEAM = Object.freeze({
    name: 'engine-knowledge',
    version: 1,
    /** 提供方注册的是类（能力面是实例方法），不是工厂函数 */
    factory: false,
    description:
        '知识沉淀引擎：经验条目的登记/删除/更新/查询与相关性检索，持久化为 <数据目录>/Knowledge/ 下的 JSON',
    /**
     * 构造入参：**全部可选**，因此声明为空数组。
     * 提供方必须容忍空对象构造（`new KnowledgeManager()` 是主路径）：
     *   - `jsonAdapter`：注入 JSON 适配器（测试替身用）
     *   - `createStorage`：注入 `createStorage` 工厂（测试替身用）
     * 两者都是"测试/嵌入式"通道，不属于跨提供方契约，故不进 `options`。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法（`init()` 之后可用；`init()` 本身也在清单里） */
    methods: Object.freeze([
        'init', // async () => void（幂等；解析存储并拿到 JsonAdapter）
        'addExperience', // async (entry) => record（docPath 必填；返回含 id 的完整记录）
        'removeExperience', // async (id) => boolean（硬删除：详情文件 + 索引条目）
        'updateExperience', // async (id, patch) => record|null（id/createdAt 不可变）
        'getExperience', // async (id) => record|null
        'listExperiences', // async (filter?) => record[]（按 createdAt 倒序）
        'searchExperiences', // async ({query, limit, minScore, skillDir, withContent, maxContentChars}) => record[]（带 score）
        'findByDocPath', // async (docPath) => record|null
    ]),
    /**
     * 产物上的属性：**一个都没有**——消费者只调方法，不得依赖 `_json` / `_lockKey()`
     * 之类的内部形状（那会把提供方焊死成当前实现）。
     */
    properties: Object.freeze([]),
    /** 消费者与守卫可以依赖的语义不变量 */
    invariants: Object.freeze([
        'init-before-use',
        'index-and-detail-consistent',
        'serialized-write-per-root',
        'search-is-lexical-and-deterministic',
    ]),
    /** 消费者真正依赖的语义（逐条对齐现有实现） */
    notes: Object.freeze({
        init: '构造后必须 await init() 才能调用其它方法；重复 init 幂等（第二次直接返回）',
        storage:
            '存储解析顺序：注入的 createStorage → 宿主的 storage 接缝 → 门面登记的内置实现（无宿主）；' +
            '三档都没有即 fail closed，错误信息点名缺哪条接缝',
        lock:
            '同一存储根目录上的读改写走一条进程内串行链（键 knowledge:<rootDir>），' +
            '因此"每个任务各自 new 一个 KnowledgeManager"不会丢更新',
        degrade:
            'searchExperiences 的 withContent 读取正文失败时降级为空正文，不影响检索结果；' +
            '检索是词法打分（ASCII 词 + CJK 二元组），不依赖 embedding 或三方分词器',
        storageLocation: '<数据目录>/Knowledge/{index.json, kn_*.json}（数据目录由 storage 门面决定，' +
            '默认 <仓库上一级>/db，可由 3LIB_DATA_DIR 或 createStorage({rootDir}) 覆盖）',
    }),
});

export default ENGINE_KNOWLEDGE_SEAM;
