#!/usr/bin/env node

/**
 * MCP Gateway Server —— 入口
 *
 * 启动流程：
 *   1. 加载配置文件（默认 ./config.json，或通过 --config 指定）
 *   2. 创建 MCPGateway 实例
 *   3. 注册优雅退出（SIGINT / SIGTERM）
 *   4. 启动 Gateway（连接下游 + 加载脚本 + 启动 stdio Server）
 *
 * 用法：
 *   node src/index.js                    # 使用默认 config.json
 *   node src/index.js --config /path     # 指定配置文件
 *   node src/index.js /path/to/config.json  # 位置参数（兼容）
 *
 * AI 客户端配置（Claude Desktop / VS Code / Copilot）：
 *   command: node
 *   args: ["/path/to/MCP/src/index.js", "--config", "/path/to/config.json"]
 */

import { resolve } from 'node:path';
import { loadConfig } from './config/ConfigLoader.js';
import MCPGateway from './gateway/Gateway.js';
import { createLogger } from './library/logger.js';

const log = createLogger('Main');

/**
 * 从命令行参数解析配置文件路径。
 * 支持 --config <path> 和位置参数两种形式。
 * @returns {string}
 */
function _resolveConfigPath() {
    const args = process.argv.slice(2);

    // --config <path>
    const configFlagIdx = args.indexOf('--config');
    if (configFlagIdx !== -1 && args[configFlagIdx + 1]) {
        return resolve(args[configFlagIdx + 1]);
    }

    // 位置参数（第一个非 -- 的参数）
    const positional = args.find(a => !a.startsWith('--'));
    if (positional) {
        return resolve(positional);
    }

    // 默认：当前目录下的 config.json
    return resolve('config.json');
}

/**
 * 主函数：加载配置、创建并启动 Gateway。
 */
async function main() {
    const configPath = _resolveConfigPath();
    log.info('配置文件路径', { path: configPath });

    const config = loadConfig(configPath);
    const gateway = new MCPGateway(config);

    // 优雅退出
    let shuttingDown = false;
    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        log.info(`收到 ${signal} 信号，开始优雅退出...`);
        try {
            await gateway.shutdown();
        } catch (err) {
            log.error('退出过程中出错', { error: err.message });
        }
        process.exit(0);
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    await gateway.start();
    log.info(`[${config.gateway.name}] Gateway 已就绪，等待 AI 客户端连接 (stdio)`);
}

main().catch((err) => {
    log.error('启动失败', { error: err.message, stack: err.stack });
    process.exit(1);
});
