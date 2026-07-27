/**
 * 轻量日志工具
 *
 * 为 Routes 层提供统一日志接口，避免对外部库的硬依赖。
 * 后续可替换为项目级日志实现（如 AIWeb 的 library/logger.js）。
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

function format(level, tag, message, meta) {
    const time = new Date().toISOString();
    const prefix = `${COLORS[level]}${time} [${tag}] ${level.toUpperCase()}${COLORS.reset} ${message}`;
    if (meta && Object.keys(meta).length > 0) {
        return `${prefix} ${JSON.stringify(meta)}`;
    }
    return prefix;
}

export function createLogger(tag) {
    return {
        debug: (msg, meta) => { if (LEVELS.debug >= MIN_LEVEL) console.debug(format('debug', tag, msg, meta)); },
        info:  (msg, meta) => { if (LEVELS.info  >= MIN_LEVEL) console.log(format('info',  tag, msg, meta)); },
        warn:  (msg, meta) => { if (LEVELS.warn  >= MIN_LEVEL) console.warn(format('warn',  tag, msg, meta)); },
        error: (msg, meta) => { if (LEVELS.error >= MIN_LEVEL) console.error(format('error', tag, msg, meta)); }
    };
}

export default createLogger;
