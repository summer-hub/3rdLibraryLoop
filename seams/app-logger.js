/**
 * seams/app-logger.js — 应用日志契约（能力接缝）
 *
 * Provider：`plugins/util/logger`（`ctx.provide('app-logger', factory)`）。
 * Consumer：`plugins/cli/opencode/lib/logger.js`（委托壳）——它的 `createLogger(tag, opts)`
 *           把调用转给本接缝工厂；无宿主时由 `Server/CLI/opencode/index.js` /
 *           `Server/CLI/deveco-code/index.js` 门面在 import 期把实现指向
 *           `Server/Routes/library/logger.js`（那是本插件实现的转发门面，仍是同一个
 *           模块实例，不会变成第二份）。
 *
 * 为什么这条接缝是**必须**的（不是"为了整齐"）：
 *   实现持有模块级可变状态——一个 `fs.WriteStream`（`flags: 'a'` 追加写
 *   `db/log/app-YYYY-MM-DD.log`）、`_streamDate`（按天轮转）、以及保留期清理
 *   （`LOG_RETENTION_DAYS`，扫描同目录删过期文件）。这些是**有状态的进程级资源**，
 *   副本数 = 资源份数：
 *     - 两个流追加同一个文件 → 各自缓冲、各自 flush，行序不可预测；
 *     - 两套轮转 → 跨零点时一方关流重建、另一方仍写旧流；
 *     - 两套清理 → 互相删掉对方正在写的文件。
 *   所以"两份副本"在这里不是风格问题，是数据完整性问题。无状态的 16 行纯函数
 *   （`cstTime`）反过来不需要接缝：它是纯函数且已归一进 `core/cstTime.js`（插件可直连内核，故无副本、无接缝），见
 *   `test/m8-plugin-kernel/f50-util-copies.test.mjs` 的对照组与漂移守卫。
 *
 * 服务形状：**工厂**（按 tag 产出日志器对象，不是单例、不是类）：
 *     ctx.provide('app-logger', (options) => createLogger(options.tag))
 *   依据：消费者的既有写法是 `createLogger(tag)`（每次调用产出一个日志器对象），
 *   注册工厂比注册单例更贴合该调用形状，也让"多个日志器共享同一个写入流"这件事
 *   由实现自己保证，而不是靠消费者自觉只取一次。
 *
 * 方法清单从真实实现（`plugins/util/logger/logger.js` 的 `createLogger`）推导，
 * 不是通用日志愿望清单：实现只导出 4 个方法，无 flush / close / level 之类的能力。
 */

export const APP_LOGGER_SEAM = Object.freeze({
    name: 'app-logger',
    version: 1,
    factory: true,
    description: '应用日志器工厂：按 tag 产出 {debug,info,warn,error}；进程内唯一持有 db/log 写入流（按天轮转 + 保留期清理）',
    /**
     * 工厂入参（提供方必须支持，未知项忽略）——逐条对齐 `createLogger(tag, options)`：
     *   - `tag`：日志行里的 `[tag]` 标签（如 `OpenCodeCLI`）。缺省时由实现决定
     *     （现实现不做默认值，会写成 `[undefined]`，因此消费者必须传）。
     *   - `rootDir`：日志根目录（第一层优先级）。不传时实现按
     *     `3LIB_LOG_ROOT` → 硬编码推导（仓库上一级 `db`）的顺序解析，**默认值与历史一致**；
     *     传了就让宿主机/测试把日志落到自己的数据目录（此前 CLI 的 `--data-dir` 对日志无效）。
     *
     *   - `level`：该日志器的最低级别（`debug`/`info`/`warn`/`error`），优先于环境变量
     *     `LOG_LEVEL`；不传时按 `LOG_LEVEL`（默认 `info`）门限。
     *
     * 关于「声明什么」的判据：**实现真正接受、且消费者可能依赖的入参，就必须声明**——
     * 否则契约悄悄放宽（"未知项忽略"）会让"换一个提供方"时少了这项能力却没人发现。
     * m9 契约一致性守卫会要求每个声明的 factoryOptions 都在
     * `test/m9-contract-conformance/lib/conformance.mjs` 的 `OPTION_VALUES` 里有构造值；
     * 新增声明时同步补一行即可（这是刻意的双向约束，防止契约单方面膨胀）。
     */
    factoryOptions: Object.freeze(['tag', 'rootDir', 'level']),
    /** 工厂产物（日志器对象）必须实现的方法 */
    methods: Object.freeze(['debug', 'info', 'warn', 'error']),
    /** 各方法的返回值形状（消费者真正依赖的部分，逐条对齐现有实现） */
    returns: Object.freeze({
        debug: 'undefined（始终写文件，不打印控制台——即发即忘，无回调）',
        info: 'undefined（console.log + 写文件，受 LOG_LEVEL 门限）',
        warn: 'undefined（console.warn + 写文件，受 LOG_LEVEL 门限）',
        error: 'undefined（console.error + 写文件，受 LOG_LEVEL 门限）',
    }),
    /**
     * 产物上的属性：**一个都没有**——消费者只用四个方法，不得 poke 实现的
     * `_stream` / `_streamDate` 等私有状态（那会把提供方焊死成当前实现）。
     */
    properties: Object.freeze([]),
    /**
     * 契约层面的语义不变量（消费者与守卫测试可以依赖的部分）：
     *   - 同一进程内所有日志器共享**同一个**写入流；
     *   - 文件写入按天轮转，文件名 `app-YYYY-MM-DD.log`（UTC 日期）；
     *   - `LOG_FILE_ENABLED=false` 时只写控制台（`debug` 则彻底静默）；
     *   - 任何写入失败都降级为仅控制台，不抛错（日志不能打断主流程）。
     */
    invariants: Object.freeze([
        'single-writer-stream',
        'daily-rotation',
        'retention-cleanup',
        'never-throw',
    ]),
});

export default APP_LOGGER_SEAM;
