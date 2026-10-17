/**
 * plugins/cli/opencode/lib/logger.js — **无状态**委托壳（实现已迁入 `plugins/util/logger/`）
 *
 * 迁移前本文件是 `Server/Routes/library/logger.js` 的第二份实现副本（147 行差异只在
 * `DB_ROOT` 上溯层数）。它持有自己的模块级 `_stream` / `_streamDate` 与自己的按天轮转和
 * 保留期清理，**两份实现向同一个 `db/log/app-YYYY-MM-DD.log` 追加写**：两个流各自缓冲、
 * 两套轮转在跨零点时各自关流重建、两套清理互相删对方正在写的文件。副本因此被删除。
 *
 * 现在这里只剩「把调用转给谁」这一件事，零实现、零状态（唯一的 `_impl` 是函数引用，
 * 不持有任何资源）：
 *
 *   - 有宿主：`plugins/cli/opencode` 的 `setup(ctx)` 调
 *     `setLoggerImpl(ctx.inject('app-logger'))`，实现 = `plugins/util/logger` 接缝工厂；
 *   - 无宿主（默认部署形态，以及 `Server/CLI/opencode/index.js` 这种快捷 import）：
 *     Server 侧门面在 import 期调 `setLoggerImpl(...)`，实现指向
 *     `Server/Routes/library/logger.js`（那是插件实现的**转发门面**，同一个模块实例）。
 *
 * 为什么 `_impl` 的形状是接缝工厂 `(options) => logger` 而不是裸 `(tag) => logger`：
 * 这样宿主侧就是字面上的 `setLoggerImpl(ctx.inject('app-logger'))`——注入什么就用什么，
 * 中间不需要适配层。`createLogger(tag, opts)` 在内部把调用整理成接缝工厂的入参形状
 * （`{ ...opts, tag }`），因此本文件的对外签名与迁移前一致（调用点
 * `adapter.js` 的 `createLogger(this._loggerName)` 一个都不用改）。
 *
 * 未接线即抛错（fail closed）：日志是旁观者，静默丢弃会让"为什么没有日志"变成
 * 幽灵问题；而退化成 `console` 会掩盖接线缺失。宁可第一次 `_log` 就炸出明确文案。
 */

/** @type {null | ((options: object) => { debug: Function, info: Function, warn: Function, error: Function })} */
let _impl = null;

/**
 * 接线：注入 `app-logger` 接缝工厂（`(options) => logger`）。
 *
 * 允许重复调用（后接线者生效）：宿主 setup 与 Server 侧无宿主兜底会各接一次，
 * 正常部署下两者指向**同一个**模块实例，重复接线无副作用。
 *
 * @param {(options: object) => { debug: Function, info: Function, warn: Function, error: Function }} factory
 * @returns {null | Function} 接线**前**的实现（供调用方在回收时复位；首次接线为 null）
 * @throws {TypeError} factory 不是函数时
 */
export function setLoggerImpl(factory) {
    if (typeof factory !== 'function') {
        throw new TypeError(
            `setLoggerImpl(factory)：factory 必须是 app-logger 接缝工厂函数，收到 ${typeof factory}`
        );
    }
    const prev = _impl;
    _impl = factory;
    return prev;
}

/**
 * 取一个日志器（签名与迁移前一致：`createLogger(tag)`，可选第二参 `opts`）。
 *
 * @param {string} tag - 日志行里的 `[tag]` 标签（如 `OpenCodeCLI`）
 * @param {object} [opts] - 额外的接缝工厂入参（当前实现只认 `tag`，其余忽略）
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 * @throws {Error} 还没接线时（见文件头「未接线即抛错」）
 */
export function createLogger(tag, opts) {
    if (!_impl) {
        throw new Error(
            'plugins/cli/opencode/lib/logger.js：app-logger 实现尚未接线 —— ' +
                '有宿主时由本插件 setup 调用 setLoggerImpl(ctx.inject(\'app-logger\'))；' +
                '无宿主时由 Server/CLI/opencode/index.js 门面在 import 期接线。' +
                '若你直接 import 了插件内的适配器而不经 Server 门面，请先自行 setLoggerImpl(...)。'
        );
    }
    return _impl({ ...(opts ?? {}), tag });
}

export default createLogger;
