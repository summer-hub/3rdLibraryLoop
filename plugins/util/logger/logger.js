/**
 * 轻量日志工具（支持文件持久化）—— **全仓库唯一实现**
 *
 * 原实现位于 `Server/Routes/library/logger.js`，行为逐字搬迁到本插件（`plugins/util/logger`），
 * `Server/Routes/library/logger.js` 改为纯转发门面（`export *`），因此全进程只有**一个**
 * 模块实例、一个 `WriteStream`、一套按天轮转与保留期清理。
 *
 * 为什么必须唯一：本文件持有**模块级可变状态**（`_stream` / `_streamDate`），并各自跑
 * 「按天轮转 + 过期清理」。历史上 `plugins/cli/opencode/lib/logger.js` 是第二份副本，
 * 两份都向同一个 `db/log/app-YYYY-MM-DD.log` 追加：两个流交错写、两套轮转各自关流重建、
 * 两套清理互相删对方正在写的文件。副本因此被删除，CLI 插件改为委托壳
 * （`plugins/cli/opencode/lib/logger.js` 只保留 `setLoggerImpl` + `createLogger`）。
 *
 * - 控制台：带 ANSI 颜色的高亮输出
 * - 文件：纯文本（去除颜色码），按天轮转写入 `<日志根>/log/app-YYYY-MM-DD.log`
 *
 * ## 配置（**惰性求值**）
 *
 * 全部配置**不在模块加载期求值**：只有真正用到时才在函数内读 `process.env`，
 * 因此宿主/测试可以在 `import` 之后改环境并生效：
 *
 *   LOG_LEVEL          日志级别（debug/info/warn/error），默认 info
 *   LOG_FILE_ENABLED   是否启用文件持久化（true/false），默认 true
 *   LOG_RETENTION_DAYS 日志保留天数，超过自动清理，默认 30
 *   3LIB_LOG_ROOT      日志根目录覆盖（见下方三层优先级）
 *
 * 稳定性约定：`LOG_LEVEL` 的解析结果对同一进程内的多次调用保持稳定（值不变时不重新解析，
 * 更不会每行解析一次）；`LOG_FILE_ENABLED` 每次写入前直读（便于临时关闭）；
 * `LOG_RETENTION_DAYS` 每次清理时直读。
 * 单个日志器还可以用工厂入参 `level` 显式指定级别（优先级最高，见 `createLogger`）。
 *
 * ## 日志根目录的三层优先级
 *
 *   1. `createLogger` 工厂入参 `options.rootDir`（最高；宿主/profile 显式指定）
 *   2. 环境变量 `3LIB_LOG_ROOT`
 *   3. 硬编码推导 `path.resolve(__dirname, '..', '..', '..', '..', 'db')`（默认）
 *
 * 第 3 层层级推导（逐段数目录）：
 *   logger → util → plugins → 仓库根(3rdLibraryLoop) → 父目录(260824) + 'db'
 * 迁移前本文件在 `Server/Routes/library/`，也是上溯 4 层（library → Routes → Server →
 * 仓库根 → 父目录），两者**解析到同一个绝对路径**（仓库开发态为
 * `D:\code\HarmonyProject\260824\db`），因此日志目录不因这次搬迁/改造而漂移。
 * 有了 1、2 两层之后：CLI 的 `--data-dir` 与测试可以把日志指到临时目录。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const DEFAULT_LEVEL = 'info';
const DEFAULT_RETENTION_DAYS = 30;

const COLORS = {
    debug: '\x1b[90m',
    info:  '\x1b[36m',
    warn:  '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
};

/** 日志根目录覆盖用的环境变量名 */
const LOG_ROOT_ENV = '3LIB_LOG_ROOT';

/** 第三层（默认）：从本文件上溯 4 层再拼 `db`，与迁移前解析到同一绝对路径 */
const DERIVED_DB_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'db');

/** 第一层：工厂入参强调的日志根目录；空串 = 未指定 */
let _optionRootDir = '';

/** 级别解析缓存：`LOG_LEVEL` 的解析结果在同一进程内保持稳定（不每行/每写一次就解析） */
let _levelRaw;
let _levelValue = DEFAULT_LEVEL;

/** `3LIB_LOG_ROOT` 解析缓存：raw 变化时重新解析（宿主改环境后仍能生效） */
let _rootRaw = null;
let _rootValue = '';

/** @type {import('node:fs').WriteStream | null} */
let _stream = null;
let _streamDate = '';

/**
 * 把任意值规整成合法级别名；非法/缺省回落 `info`（与改造前 `LEVELS[...] ?? LEVELS.info` 等价）。
 * @param {*} value
 * @returns {'debug'|'info'|'warn'|'error'}
 */
function _normalizeLevel(value) {
    const key = String(value ?? '').trim().toLowerCase();
    return Object.hasOwn(LEVELS, key) ? key : DEFAULT_LEVEL;
}

/**
 * 惰性解析 `LOG_LEVEL`（**首次调用时读环境**，之后结果稳定）。
 * @returns {'debug'|'info'|'warn'|'error'}
 */
function _envLevel() {
    const raw = process.env.LOG_LEVEL;
    if (_levelRaw === undefined || raw !== _levelRaw) {
        // 首次解析：缓存；此后仅当环境值变化时才重新解析（保持"同一进程内稳定"）
        _levelRaw = raw;
        _levelValue = _normalizeLevel(raw);
    }
    return _levelValue;
}

/**
 * 惰性解析 `3LIB_LOG_ROOT`（未设置时返回空串，由调用方回落硬编码推导）。
 * @returns {string} 绝对路径或 ''
 */
function _envRootDir() {
    const raw = String(process.env[LOG_ROOT_ENV] ?? '').trim();
    if (raw !== _rootRaw) {
        _rootRaw = raw;
        _rootValue = raw ? path.resolve(raw) : '';
    }
    return _rootValue;
}

/**
 * 惰性解析 `LOG_RETENTION_DAYS`（每次清理时读，非法值回落默认）。
 * @returns {number}
 */
function _retentionDays() {
    const parsed = Number.parseInt(
        process.env.LOG_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
        10
    );
    return Number.isFinite(parsed) ? parsed : DEFAULT_RETENTION_DAYS;
}

/**
 * 解析生效的日志根目录（三层优先级，见文件头）。
 * @returns {string} 绝对路径
 */
export function resolveLogRoot() {
    if (_optionRootDir) return _optionRootDir;
    return _envRootDir() || DERIVED_DB_ROOT;
}

/**
 * 解析生效的日志目录（`<日志根>/log`）。
 * @returns {string} 绝对路径
 */
export function resolveLogDir() {
    return path.join(resolveLogRoot(), 'log');
}

/**
 * 文件持久化是否启用（惰性读 `LOG_FILE_ENABLED`，每次调用都读，便于宿主/测试临时关闭）。
 * @returns {boolean}
 */
export function isFileLoggingEnabled() {
    return process.env.LOG_FILE_ENABLED !== 'false';
}

/**
 * 关闭当前写入流并允许下次写入新建（目录/开关变化时调用）。
 */
function _closeStream() {
    if (_stream) {
        _stream.end();
        _stream = null;
    }
    _streamDate = '';
}

/**
 * 应用工厂入参传入的日志根目录（第一层优先级）。
 *
 * 目录变化时关闭已有流：否则旧流会继续往旧目录追加，配置看起来"没生效"。
 * @param {*} rootDir
 */
function _applyRootDir(rootDir) {
    if (typeof rootDir !== 'string' || rootDir.trim() === '') return;
    const resolved = path.resolve(rootDir);
    if (resolved === _optionRootDir) return;
    _optionRootDir = resolved;
    _closeStream();
}

/**
 * 获取当天日期字符串 (YYYY-MM-DD)。
 */
function _today() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * 获取（或轮转）当前日志文件的 WriteStream。
 * 日期变化时自动关闭旧流、创建新流，实现按天轮转。
 * @returns {import('node:fs').WriteStream | null}
 */
function _getStream() {
    if (!isFileLoggingEnabled()) return null;

    const today = _today();
    if (_stream && _streamDate === today) {
        return _stream;
    }

    // 日期变化 → 关闭旧流
    if (_stream) {
        _stream.end();
        _stream = null;
    }

    const logDir = resolveLogDir();
    try {
        fs.mkdirSync(logDir, { recursive: true });
        const file = path.join(logDir, `app-${today}.log`);
        _stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
        _streamDate = today;
        _stream.on('error', (err) => {
            console.error(`[Logger] 文件写入失败，降级为仅控制台输出: ${err.message}`);
            _stream = null;
        });
        // 启动时清理过期日志
        _cleanupOldLogs();
    } catch (err) {
        console.error(`[Logger] 无法创建日志文件: ${err.message}`);
        _stream = null;
    }

    return _stream;
}

/**
 * 清理超过保留天数的旧日志文件（幂等，失败静默）。
 */
function _cleanupOldLogs() {
    try {
        const logDir = resolveLogDir();
        const files = fs.readdirSync(logDir);
        const now = Date.now();
        const maxAgeMs = _retentionDays() * 24 * 60 * 60 * 1000;
        for (const file of files) {
            if (!file.startsWith('app-') || !file.endsWith('.log')) continue;
            const filePath = path.join(logDir, file);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
                console.debug(`[Logger] 已清理过期日志: ${file}`);
            }
        }
    } catch {
        // 清理失败不影响主流程
    }
}

// 进程退出时刷新写入流
process.on('exit', () => {
    if (_stream) {
        _stream.end();
    }
});

/**
 * 格式化日志行（带 ANSI 颜色，用于控制台）。
 */
function format(level, tag, message, meta) {
    const time = new Date().toISOString();
    const prefix = `${COLORS[level]}${time} [${tag}] ${level.toUpperCase()}${COLORS.reset} ${message}`;
    if (meta && Object.keys(meta).length > 0) {
        return `${prefix} ${JSON.stringify(meta)}`;
    }
    return prefix;
}

/**
 * 格式化日志行（纯文本，用于文件写入）。
 */
function formatPlain(level, tag, message, meta) {
    const time = new Date().toISOString();
    const prefix = `${time} [${tag}] ${level.toUpperCase()} ${message}`;
    if (meta && Object.keys(meta).length > 0) {
        return `${prefix} ${JSON.stringify(meta)}`;
    }
    return prefix;
}

/**
 * 将一行日志异步写入文件（非阻塞）。
 * @param {string} line
 */
function _writeFile(line) {
    const stream = _getStream();
    if (stream) {
        stream.write(line + '\n');
    }
}

/**
 * 创建一个日志器。
 *
 * @param {string} tag - 日志行里的 `[tag]` 标签
 * @param {object} [options] - 可选配置（接缝工厂入参透传，未知项忽略）
 * @param {string} [options.rootDir] - 日志根目录（第一层优先级，见文件头）
 * @param {string} [options.level]   - 级别门限（debug/info/warn/error），优先于 `LOG_LEVEL`
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(tag, options) {
    const opts = options ?? {};
    _applyRootDir(opts.rootDir);
    // 级别在**创建时**解析一次：日志器生命周期内稳定，且不随每行日志重复读环境
    // （`LOG_LEVEL` 的解析由 `_envLevel()` 缓存，同一进程内结果一致）。
    const rawLevel = opts.level;
    const minLevel = LEVELS[
        rawLevel === undefined || rawLevel === null || rawLevel === ''
            ? _envLevel()
            : _normalizeLevel(rawLevel)
    ];

    return {
        debug: (msg, meta) => {
            // debug 始终写入文件，但不打印到控制台
            _writeFile(formatPlain('debug', tag, msg, meta));
        },
        info: (msg, meta) => {
            if (LEVELS.info >= minLevel) {
                console.log(format('info', tag, msg, meta));
                _writeFile(formatPlain('info', tag, msg, meta));
            }
        },
        warn: (msg, meta) => {
            if (LEVELS.warn >= minLevel) {
                console.warn(format('warn', tag, msg, meta));
                _writeFile(formatPlain('warn', tag, msg, meta));
            }
        },
        error: (msg, meta) => {
            if (LEVELS.error >= minLevel) {
                console.error(format('error', tag, msg, meta));
                _writeFile(formatPlain('error', tag, msg, meta));
            }
        }
    };
}

export default createLogger;
