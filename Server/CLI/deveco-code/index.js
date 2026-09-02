import OpenCodeCLI from '../opencode/index.js';

/**
 * DevEco Code CLI 适配器
 *
 * 对接华为开源的 DevEco Code（https://gitcode.com/openharmony-sig/deveco-code），
 * 面向 HarmonyOS 开发场景的 AI Agent 工具（npm 包 @deveco/deveco-code）。
 *
 * DevEco Code 基于开源项目 OpenCode 扩展开发，其 headless 服务（`deveco serve`）
 * 保留与 opencode 完全一致的 HTTP API（/session、/session/{id}/message、
 * /session/{id}/prompt_async、/session/status 等），因此本适配器直接继承
 * OpenCodeCLI，复用其全部 Session 管理逻辑，仅覆盖连接配置与身份标识：
 *
 *   - 环境变量：DEVECO_HOST / DEVECO_PORT（优先级低于 options.host / options.port）
 *   - 默认端口：4096（与 opencode 一致，两者同一时间只运行一个，无需改端口配置；
 *     若需与 opencode 服务同时运行，可通过 DEVECO_PORT 指定其他端口）
 *   - 存档 meta.cliType：'deveco-code'
 *
 * 服务启动方式：
 *   deveco serve            （默认即监听 4096）
 *   deveco serve --port X   （需共存/端口冲突时显式指定）
 *   （注意：`deveco serve` 在 4096 被占用且未指定 --port 时会随机分配端口）
 *
 * @example
 * const cli = new CLIController('deveco-code');  // 连接 localhost:4096
 * await cli.checkHealth();
 */
class DevEcoCodeCLI extends OpenCodeCLI {
    /** 存档 meta.cliType 标识 */
    static _cliType = 'deveco-code';

    /** 日志器名称 */
    static _loggerName = 'DevEcoCodeCLI';

    /**
     * @param {object} options
     * @param {string} [options.host]    - deveco 服务主机（默认 DEVECO_HOST 或 localhost）
     * @param {string} [options.port]    - deveco 服务端口（默认 DEVECO_PORT 或 4096）
     * @param {string} [options.baseUrl] - 完整 baseUrl，优先级高于 host/port
     * @param {import('../../DbUse/MessageArchive.js').default} [options.archive] - 消息存档服务
     */
    constructor(options = {}) {
        super({
            ...options,
            host: options.host || process.env.DEVECO_HOST || 'localhost',
            port: options.port || process.env.DEVECO_PORT || '4096'
        });
        // cliType / _loggerName 已通过 static 覆盖，在父类构造期间即正确初始化
    }

    // ─── 运行状态检查 ──────────────────────────────────────────────────────────

    /**
     * 检查 deveco 服务是否正常运行（复用父类轻量健康检查逻辑，仅覆盖提示文案）
     */
    async checkHealth() {
        try {
            await this.client.session.list();
            return { status: 'ok', message: 'DevEco Code CLI is healthy', target: this.baseUrl };
        } catch (error) {
            this._log('warn', `checkHealth: 连接失败 — ${error.message}`);
            return {
                status: 'error',
                message: `Health check failed: ${error.message}`,
                error: error.message
            };
        }
    }
}

export default DevEcoCodeCLI;
