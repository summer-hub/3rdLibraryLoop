/**
 * plugins/agent/core/lib/logger.js —— **无状态**委托壳（`app-logger` 接缝的消费者侧）
 *
 * 为什么需要这一层：迁移前 `SkillSelector/core/Agent.js` 直接
 * `import { createLogger } from '../../../Routes/library/logger.js'`。插件不得引用
 * `Server/`（架构守卫 R2），而那条门面背后是 `plugins/util/logger`（`app-logger`
 * 接缝的唯一实现，也是全仓库唯一持有 `db/log` 写入流的地方，见 m8 `f50-util-copies`
 * C/D 组）。插件之间又不得互相 import，因此这里只做「把调用转给谁」这一件事：
 * **零实现、零状态**（唯一的 `_impl` 是函数引用，不持有任何资源）。
 *
 * 解析顺序（首次调用时解析一次，结果缓存）：
 *   1. 活跃宿主的 `app-logger` 接缝（`core/hostBridge.js` 的 `resolveSeamProvider`）——
 *      正常部署形态，profile 里 `util/logger` 一定启用；
 *   2. `Server/Agent/**` 门面在 import 期登记的兜底（`setLoggerImpl`）——无宿主的默认
 *      部署形态，门面转发的是 `plugins/util/logger` 的**同一个模块实例**；
 *   3. 都没有 → **静默降级为 noop**。
 *
 * 第 3 档为什么不像 `plugins/cli/opencode/lib/logger.js` 那样 fail closed：
 *   Agent 只用 `log.debug()`（`selectSkill` 的入参/出参留痕），日志在这里是**旁路观察者**，
 *   不是被选择的能力。若为一条 debug 日志抛错，就等于"没有装配 logger 就选不出 SKILL"——
 *   那是把观察者的缺失升级成功能故障。CLI 适配器不同：它的日志承载运行期排障主线，
 *   静默丢弃会让"为什么没有日志"变成幽灵问题，所以那里必须报错。判据是**日志在调用方
 *   的角色**，不是"日志重要"这种一句空话。
 *
 * 提供方签名：`app-logger` 接缝工厂是 `(options) => logger`（见 `seams/app-logger.js`），
 * 实现体实际只认 `options.tag`。本文件对外仍是迁移前的 `createLogger(tag, opts)` 签名，
 * 调用点一个都不用改。
 */

import { resolveSeamProvider } from '../../../../core/hostBridge.js';

/** @type {null | ((options: object) => object)} 门面登记的实现（无宿主兜底） */
let _impl = null;

/** @type {object|null} 已解析好的 logger（成功解析后缓存，避免每次 debug 都问宿主） */
let _logger = null;

/** 未接线时的空实现：吞掉全部级别，绝不抛错（理由见文件头第 3 档） */
const NOOP_LOGGER = Object.freeze({
    debug() {},
    info() {},
    warn() {},
    error() {},
});

/**
 * 接线：注入 `app-logger` 接缝工厂（`(options) => logger`）。
 *
 * 允许重复调用（后接线者生效）：宿主 `setup` 与 Server 侧无宿主兜底各接一次，
 * 正常部署下两者指向**同一个**模块实例，重复接线无副作用。
 *
 * @param {(options: object) => object} factory
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
    _logger = null; // 换实现后必须重新解析
    return prev;
}

/** 清空接线与缓存（仅测试 / 热替换用；正常部署不应调用）。 */
export function resetLogger() {
    _impl = null;
    _logger = null;
}

/**
 * 取一个日志器（签名与迁移前一致：`createLogger(tag)`，可选第二参 `opts`）。
 *
 * 返回的是**同一个**日志器对象（缓存），因此"多个 tag"不会产出多份实现——
 * 底层写入流本来就是 `plugins/util/logger` 的模块级单例。
 *
 * @param {string} tag - 日志行里的 `[tag]` 标签（首次解析时生效）
 * @param {object} [opts] - 额外的接缝工厂入参（当前实现只认 tag，其余忽略）
 * @returns {{debug: Function, info: Function, warn: Function, error: Function}}
 */
export function createLogger(tag, opts) {
    if (_logger) return _logger;

    const request = { ...(opts ?? {}), tag };
    const fromHost = resolveSeamProvider('app-logger');
    if (typeof fromHost === 'function') {
        _logger = fromHost(request);
        return _logger;
    }
    if (typeof _impl === 'function') {
        _logger = _impl(request);
        return _logger;
    }
    _logger = NOOP_LOGGER;
    return _logger;
}

export default createLogger;
