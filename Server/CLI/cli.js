import OpenCodeCLI from './opencode/index.js';
import CopilotCLI from './copilot/index.js';
import { StatsService } from '../library/StatsService.js';

/**
 * 通用 CLI 控制类
 *
 * 统一封装 opencode-cli 和 copilot-cli，对外暴露一致的 Session 管理接口。
 * 底层实现通过 type 参数动态选择对应的适配器。
 *
 * @example
 * // 使用 opencode
 * const cli = new CLIController('opencode', { host: 'localhost', port: '4096' });
 *
 * // 使用 copilot
 * const cli = new CLIController('copilot', { mode: 'suggest' });
 *
 * // 通用接口
 * await cli.checkHealth();
 * const { sessionId } = await cli.startSession('任务标题', '初始提示词');
 * await cli.sendMessage(sessionId, '继续消息');
 * const status = await cli.checkSessionStatus(sessionId);
 * const sessions = await cli.listSessions();
 * const session = await cli.getSession(sessionId);
 * await cli.abortSession(sessionId);
 * await cli.deleteSession(sessionId);
 */
class CLIController {
    /**
     * @param {'opencode'|'copilot'} type - CLI 类型
     * @param {object} [options={}]       - 传递给对应适配器的配置项
     *
     * opencode 选项：
     *   options.host    {string} - 服务主机（默认 localhost）
     *   options.port    {string} - 服务端口（默认 4096）
     *   options.baseUrl {string} - 完整 URL，优先级高于 host/port
     *
     * copilot 选项：
     *   options.ghCommand  {string} - gh CLI 路径（默认 'gh'）
     *   options.mode       {'suggest'|'explain'} - 对话模式（默认 'suggest'）
     *   options.shellType  {string} - suggest 的 shell 类型（默认 'shell'）
     *
     * 公共选项：
     *   options.archive    - MessageArchive 实例（消息存档与卡死检测），不传则适配器内部自建
     */
    constructor(type = 'opencode', options = {}) {
        this.type = type;

        switch (type) {
            case 'opencode':
                this.adapter = new OpenCodeCLI(options);
                break;
            case 'copilot':
                this.adapter = new CopilotCLI(options);
                break;
            default:
                throw new Error(
                    `不支持的 CLI 类型: "${type}"，可选值为 'opencode' | 'copilot'`
                );
        }
    }

    // ─── 运行状态检查 ──────────────────────────────────────────────────────────

    /**
     * 检查 CLI 服务是否正常运行
     * @returns {Promise<{ status: 'ok'|'error'|'disabled', message: string }>}
     */
    async checkHealth() {
        return this.adapter.checkHealth();
    }

    // ─── Session 管理 ──────────────────────────────────────────────────────────

    /**
     * 获取所有 Session
     * @returns {Promise<Array<object>>}
     */
    async listSessions() {
        return this.adapter.listSessions();
    }

    /**
     * 获取指定 Session
     * @param {string} sessionId
     * @returns {Promise<object>}
     */
    async getSession(sessionId) {
        return this.adapter.getSession(sessionId);
    }

    /**
     * 删除 Session
     * @param {string} sessionId
     * @returns {Promise<object>}
     */
    async deleteSession(sessionId) {
        return this.adapter.deleteSession(sessionId);
    }

    /**
     * 终止 Session（中断正在运行的任务或进程）
     * @param {string} sessionId
     * @returns {Promise<object>}
     */
    async abortSession(sessionId) {
        return this.adapter.abortSession(sessionId);
    }

    /**
     * 向 Session 发送消息
     * @param {string} sessionId
     * @param {string} message
     * @returns {Promise<{ success: boolean, response?: string }>}
     */
    async sendMessage(sessionId, message) {
        return this.adapter.sendMessage(sessionId, message);
    }

    /**
     * 创建新 Session，可选附带初始提示词
     * @param {string} title    - Session 标题
     * @param {string} [prompt] - 初始提示词（可选）
     * @returns {Promise<{ sessionId: string, action: string, message: string }>}
     */
    async startSession(title, prompt) {
        // 记录 Session 调用次数（异步执行，不影响主流程）
        StatsService.incrementSessionCount().catch(err => {
            // 统计失败不影响正常业务，仅记录日志
            console.warn('[CLIController] Session 统计记录失败:', err.message);
        });
        
        return this.adapter.startSession(title, prompt);
    }

    /**
     * 查询 Session 当前状态
     * @param {string} sessionId
     * @returns {Promise<{ status: string, lastMessage?: object }>}
     */
    async checkSessionStatus(sessionId) {
        return this.adapter.checkSessionStatus(sessionId);
    }

    /**
     * 获取 Session 消息历史
     * @param {string} sessionId
     * @returns {Promise<Array<object>>}
     */
    async getSessionMessages(sessionId) {
        return this.adapter.getSessionMessages(sessionId);
    }

    /**
     * 读取本地已归档的消息（持久化文件，不请求远端，用于事后审计/对比）
     * @param {string} sessionId
     * @returns {Promise<Array<object>>}
     */
    async getArchivedMessages(sessionId) {
        return this.adapter.getArchivedMessages(sessionId);
    }

    /**
     * 实时查看当前对话消息（运行中安全调用，不写入存档）
     *
     * 从远端 / 内存拉取当前已有消息并转为精简格式返回。
     * 适用于对话进行中查看 "目前聊了什么"，不影响后续归档去重。
     *
     * @param {string} sessionId
     * @returns {Promise<Array<{id?,role,content,finish?,timestamp?}>>}
     */
    async getLiveMessages(sessionId) {
        return this.adapter.getLiveMessages(sessionId);
    }

    /**
     * 导出完整对话（合并远端 + 本地，支持运行中 / 已结束）
     *
     * @param {string} sessionId
     * @param {object} [opts]
     * @param {'json'|'markdown'} [opts.format='json'] - 导出格式
     * @returns {Promise<object|string>}
     */
    async exportSession(sessionId, opts) {
        return this.adapter.exportSession(sessionId, opts);
    }

    /**
     * 读取本地存档元信息（含 lastResponseAt / archivedCount / status 等，用于卡死判断）
     * @param {string} sessionId
     * @returns {Promise<object>}
     */
    async getArchiveMeta(sessionId) {
        return this.adapter.getArchiveMeta(sessionId);
    }

    /**
     * 列出所有本地已存档的 Session（基于存档文件）
     * @returns {Promise<Array<object>>}
     */
    async listArchivedSessions() {
        return this.adapter.archive.listSessions();
    }

    // ─── 元信息 ────────────────────────────────────────────────────────────────

    /**
     * 返回当前使用的 CLI 类型
     * @returns {'opencode'|'copilot'}
     */
    getType() {
        return this.type;
    }

    /**
     * 返回底层适配器实例（供高级用途）
     * @returns {OpenCodeCLI|CopilotCLI}
     */
    getAdapter() {
        return this.adapter;
    }
}

export { CLIController, OpenCodeCLI, CopilotCLI };
export default CLIController;
