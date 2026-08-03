/**
 * 轻量日志工具
 *
 * 为 MCP Gateway 各模块提供统一日志接口。
 * 所有日志输出到 stderr（MCP stdio 协议要求 stdout 仅用于 JSON-RPC）。
 *
 * 日志级别通过环境变量 LOG_LEVEL 控制（debug/info/warn/error）。
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;

const COLORS = {
    debug: '\x1b[90m',
    info:  '\x1b[36m',
    warn:  '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
};

/**
 * 格式化日志行。
 * @param {string} level
 * @param {string} tag
 * @param {string} message
 * @param {object} [meta]
 * @returns {string}
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
 * 创建带标签的日志实例。
 * @param {string} tag - 模块标签（如 'Gateway'、'ClientPool'）
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(tag) {
    return {
        debug: (msg, meta) => {
            if (LEVELS.debug >= MIN_LEVEL) console.error(format('debug', tag, msg, meta));
        },
        info: (msg, meta) => {
            if (LEVELS.info >= MIN_LEVEL) console.error(format('info', tag, msg, meta));
        },
        warn: (msg, meta) => {
            if (LEVELS.warn >= MIN_LEVEL) console.error(format('warn', tag, msg, meta));
        },
        error: (msg, meta) => {
            if (LEVELS.error >= MIN_LEVEL) console.error(format('error', tag, msg, meta));
        }
    };
}

export default createLogger;
