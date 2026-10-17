/**
 * seams/message-archive.js — 会话消息归档契约（能力接缝）
 *
 * Provider：`plugins/storage/core`（`ctx.provide('message-archive', factory)`）。
 * Consumer：AI CLI 适配器——现为 `plugins/cli/opencode` / `plugins/cli/deveco-code`：
 *           两个插件的 `ai-cli` 工厂在构造适配器时补齐
 *           `options.archive ?? inject('message-archive')(options)`，
 *           适配器本身不认识任何具体归档实现（不认识 StorageManager / 目录布局）。
 *
 * 为什么单列一条接缝（而不是塞进 `storage`）：
 *   AI CLI 插件只需要"把会话消息存档、读回来、判卡死"这一能力，不该认识
 *   StorageManager / 适配器 / 目录布局。归档独立成接缝后，CLI 插件只依赖裸名
 *   `message-archive`，存储实现可以整体替换（jsonl → sqlite → 远端），
 *   换提供方不改消费者——这就是「一切即插件」的检验标准。
 *
 * 服务形状：**工厂**（每次调用构造一个归档实例，不是单例、不是类）：
 *     ctx.provide('message-archive', (options) => new MessageArchive(options));
 *   依据：消费者的既有写法是 `this.archive = options.archive ?? new MessageArchive()`，
 *   即"注入一个实例，没有就自己造一个"。注册工厂让消费者写成
 *   `inject('message-archive')(options)` 就能拿到实例，不必再包一层 `new`。
 *
 * 方法清单**从真实实现与真实调用方推导**，不是通用 CRUD 愿望清单：
 *   - 实现：`plugins/storage/core/MessageArchive.js`（10 个方法，全部列在下面）；
 *   - 调用方：`Server/CLI/opencode/index.js` 实际调用 patchMeta / recordCheck /
 *     appendMessages / readMessages / readMeta；`Server/composition/buildApp.js` 与
 *     `cli/lib/runner.js` 走 `storage.messageArchive()` 注入。
 *   - `exportSession` 属于 AI CLI 适配器自己的能力（`seams/ai-cli.js`），不是本接缝的方法：
 *     它内部才调用本契约的 appendMessages / readMessages / readMeta。
 */

export const MESSAGE_ARCHIVE_SEAM = Object.freeze({
    name: 'message-archive',
    version: 1,
    factory: true,
    description: '会话消息归档：消息追加（带去重）/ 读取 / 元信息维护 / 停滞判定',
    /**
     * 工厂入参（提供方必须全部支持，未知项忽略）——逐条对齐
     * `new MessageArchive({ baseDir, stallThresholdMs, manager })`：
     *   - `manager` 优先：给了 StorageManager 就复用它（根目录与实例缓存），忽略 baseDir；
     *   - `baseDir` 仅在无 manager 时生效，等价于 `new StorageManager({ rootDir: baseDir })`；
     *   - `stallThresholdMs` 缺省 5 分钟。
     */
    factoryOptions: Object.freeze(['baseDir', 'stallThresholdMs', 'manager']),
    /** 工厂产物（归档实例）必须实现的方法 */
    methods: Object.freeze([
        'readMeta',
        'writeMeta',
        'patchMeta',
        'appendMessage',
        'appendMessages',
        'readMessages',
        'readLastMessage',
        'listSessions',
        'recordCheck',
        'deleteSession',
    ]),
    /** 各方法的返回值形状（消费者真正依赖的部分，逐条对齐现有实现） */
    returns: Object.freeze({
        readMeta: '会话元信息对象；不存在时返回默认值（sessionId/title/cliType/createdAt/status/lastMessageId/lastResponseAt/lastCheckAt/archivedCount）',
        writeMeta: '写入的元信息对象',
        patchMeta: '合并更新后的元信息对象',
        appendMessage: '{ appended: boolean, seq: number, message: object }',
        appendMessages: '{ appended: number, skipped: number }',
        readMessages: '已归档消息数组（写入顺序，每条含 seq 与 archivedAt）',
        readLastMessage: '最后一条已归档消息；无消息时 null',
        listSessions: '会话元信息数组（按 createdAt 降序）',
        recordCheck: '{ status, stallDurationMs, stalled, hasNewMessage, meta }',
        deleteSession: 'undefined（删除消息流与元信息两个文件）',
    }),
    /**
     * 产物必须具备的属性/字段（不是方法，消费者按名字直读，**不得 poke 实现私有状态**）。
     *
     * `stallThresholdMs`：卡死判定阈值（ms，number）。AI CLI 适配器既用它判「停滞」，
     * 也用它做「远端 busy 过久 → 降级查消息层」的兜底阈；以前读的是
     * `archive._store.stallThresholdMs`（私有字段），等于要求提供方必须是 MessageArchive。
     * 列进契约后，任何提供方只要给出这个属性就满足消费者。
     */
    properties: Object.freeze(['stallThresholdMs']),
    /** 元信息的语义字段（消费者按这些字段判活/判卡死，不读实现私有状态） */
    metaFields: Object.freeze([
        'sessionId',
        'title',
        'cliType',
        'createdAt',
        'status',
        'lastMessageId',
        'lastResponseAt',
        'lastCheckAt',
        'archivedCount',
    ]),
});

export default MESSAGE_ARCHIVE_SEAM;
