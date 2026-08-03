/**
 * ConfigLoader —— 配置加载与校验
 *
 * 职责：
 *   1. 从 JSON 文件加载 Gateway 配置。
 *   2. 校验配置字段完整性，缺失字段使用默认值。
 *   3. 解析相对路径（scriptsDir 相对于配置文件目录）。
 *
 * 设计原则：
 *   - 高内聚：所有配置解析逻辑集中在此模块。
 *   - 低耦合：只输出纯数据对象，不依赖任何业务模块。
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { createLogger } from '../library/logger.js';

const log = createLogger('ConfigLoader');

/** 默认脚本配置 */
const DEFAULT_SCRIPTS_CONFIG = {
    enabled: true,
    hotReload: true,
    timeout: 30000,
    allowedExtensions: ['.sh', '.py', '.js']
};

/** 默认 Gateway 元信息 */
const DEFAULT_GATEWAY_META = {
    name: 'mcp-gateway',
    version: '1.0.0',
    transport: 'stdio'
};

/**
 * 加载并校验 Gateway 配置。
 *
 * @param {string} configPath - 配置文件路径（绝对或相对）
 * @returns {import('../types.js').GatewayConfig}
 * @throws {Error} 配置文件不存在或格式非法时抛出
 */
export function loadConfig(configPath) {
    const absPath = resolve(configPath);

    let raw;
    try {
        raw = readFileSync(absPath, 'utf-8');
    } catch (err) {
        throw new Error(`无法读取配置文件: ${absPath} (${err.message})`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`配置文件 JSON 解析失败: ${absPath} (${err.message})`);
    }

    // 校验必需的顶层结构
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('配置根节点必须是 JSON 对象');
    }

    // 合并默认值
    const config = {
        downstreamServers: _normalizeDownstreamServers(parsed.downstreamServers),
        scriptsDir: _normalizeScriptsDir(parsed.scriptsDir, absPath),
        scripts: { ...DEFAULT_SCRIPTS_CONFIG, ...(parsed.scripts || {}) },
        gateway: { ...DEFAULT_GATEWAY_META, ...(parsed.gateway || {}) }
    };

    log.info('配置加载完成', {
        downstreamCount: Object.keys(config.downstreamServers).length,
        scriptsDir: config.scriptsDir,
        scriptsEnabled: config.scripts.enabled
    });

    return config;
}

/**
 * 规范化下游 Server 配置：过滤无效配置、补全默认字段。
 * 支持两种传输类型：
 *   - stdio（默认）：本地子进程，需要 command + args
 *   - remote：远程 HTTP，需要 url，可选 headers
 * @param {Object} [raw]
 * @returns {Object<string, import('../types.js').DownstreamServerConfig>}
 * @private
 */
function _normalizeDownstreamServers(raw) {
    if (!raw || typeof raw !== 'object') return {};

    const result = {};
    for (const [name, cfg] of Object.entries(raw)) {
        if (!cfg || typeof cfg !== 'object') {
            log.warn(`下游 Server "${name}" 配置无效，跳过`);
            continue;
        }

        const type = cfg.type || 'stdio';

        if (type === 'stdio') {
            if (!cfg.command || !Array.isArray(cfg.args)) {
                log.warn(`下游 Server "${name}" (stdio) 缺少 command 或 args，跳过`);
                continue;
            }
            result[name] = {
                type: 'stdio',
                command: cfg.command,
                args: cfg.args,
                env: cfg.env || {},
                enabled: cfg.enabled !== false
            };
        } else if (type === 'remote') {
            if (!cfg.url || typeof cfg.url !== 'string') {
                log.warn(`下游 Server "${name}" (remote) 缺少 url，跳过`);
                continue;
            }
            result[name] = {
                type: 'remote',
                url: cfg.url,
                headers: cfg.headers || {},
                enabled: cfg.enabled !== false
            };
        } else {
            log.warn(`下游 Server "${name}" 未知 type: ${type}，跳过`);
        }
    }
    return result;
}

/**
 * 规范化脚本目录路径：相对于配置文件目录解析。
 * @param {string} [raw]
 * @param {string} configPath
 * @returns {string}
 * @private
 */
function _normalizeScriptsDir(raw, configPath) {
    const fallback = resolve(dirname(configPath), 'scripts');
    if (!raw) return fallback;
    return isAbsolute(raw) ? raw : resolve(dirname(configPath), raw);
}

export default loadConfig;
