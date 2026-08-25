/**
 * 轻量日志工具（支持文件持久化）
 *
 * 为 Routes 层提供统一日志接口。
 * - 控制台：带 ANSI 颜色的高亮输出
 * - 文件：纯文本（去除颜色码），按天轮转写入 db/log/app-YYYY-MM-DD.log
 *
 * 环境变量：
 *   LOG_LEVEL          日志级别（debug/info/warn/error），默认 info
 *   LOG_FILE_ENABLED   是否启用文件持久化（true/false），默认 true
 *   LOG_RETENTION_DAYS 日志保留天数，超过自动清理，默认 30
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;

const COLORS = {
    debug: '\x1b[90m',
    info:  '\x1b[36m',
    warn:  '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
};

// ─── 文件持久化配置 ──────────────────────────────────────────────────
const FILE_ENABLED = process.env.LOG_FILE_ENABLED !== 'false';
const RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS ?? '30', 10);

// 解析 db/ 根目录：从 Server/Routes/library/ 上溯 4 层到 workspace 根
const DB_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'db');
const LOG_DIR = path.join(DB_ROOT, 'log');

/** @type {import('node:fs').WriteStream | null} */
let _stream = null;
let _streamDate = '';

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
    if (!FILE_ENABLED) return null;

    const today = _today();
    if (_stream && _streamDate === today) {
        return _stream;
    }

    // 日期变化 → 关闭旧流
    if (_stream) {
        _stream.end();
        _stream = null;
    }

    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const file = path.join(LOG_DIR, `app-${today}.log`);
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
        const files = fs.readdirSync(LOG_DIR);
        const now = Date.now();
        const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
        for (const file of files) {
            if (!file.startsWith('app-') || !file.endsWith('.log')) continue;
            const filePath = path.join(LOG_DIR, file);
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

export function createLogger(tag) {
    return {
        debug: (msg, meta) => {
            // debug 始终写入文件，但不打印到控制台
            _writeFile(formatPlain('debug', tag, msg, meta));
        },
        info: (msg, meta) => {
            if (LEVELS.info >= MIN_LEVEL) {
                console.log(format('info', tag, msg, meta));
                _writeFile(formatPlain('info', tag, msg, meta));
            }
        },
        warn: (msg, meta) => {
            if (LEVELS.warn >= MIN_LEVEL) {
                console.warn(format('warn', tag, msg, meta));
                _writeFile(formatPlain('warn', tag, msg, meta));
            }
        },
        error: (msg, meta) => {
            if (LEVELS.error >= MIN_LEVEL) {
                console.error(format('error', tag, msg, meta));
                _writeFile(formatPlain('error', tag, msg, meta));
            }
        }
    };
}

export default createLogger;
