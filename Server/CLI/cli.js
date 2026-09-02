import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenCodeCLI from './opencode/index.js';
import DevEcoCodeCLI from './deveco-code/index.js';
import { StatsService } from '../library/StatsService.js';

// 加载 Server/.env（本文件在 CLI/ 下，上一级目录为 Server/）。
// dotenv 为可选依赖：未安装时跳过（如纯 mock 测试场景）。
// dotenv 默认不覆盖已存在的环境变量，因此 shell export / --type 参数优先级仍高于 .env。
try {
    const dotenv = (await import('dotenv')).default;
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
} catch {
    // dotenv 未安装或 .env 不存在，跳过
}

/**
 * 通用 CLI 控制类
 *
 * 封装 AI 编程助手 CLI（opencode / deveco-code），对外暴露统一的 Session 管理接口。
 *
 * 默认 CLI 类型可在 Server/.env 中配置 CLI_TYPE=opencode|deveco-code，
 * 也可通过 shell 环境变量 CLI_TYPE 指定（优先级高于 .env），均未设置时默认 'opencode'。
 * 显式传入 type 参数优先级最高。
 *
 * 连接配置同样支持 .env：OPENCODE_HOST/OPENCODE_PORT、DEVECO_HOST/DEVECO_PORT。
 *
 * @example
 * const cli = new CLIController('opencode');   // 连接 localhost:4096
 * const cli = new CLIController('deveco-code'); // 连接 localhost:4096（两者默认端口一致）
 * const cli = new CLIController();  // 使用 .env / 环境变量 CLI_TYPE 指定的默认类型
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
     * @param {'opencode'|'deveco-code'} [type] - CLI 类型，缺省时取环境变量 CLI_TYPE
     *   （shell 环境变量 > Server/.env），仍未设置则 'opencode'
     * @param {object} [options={}]       - 传递给对应适配器的配置项
     *
     * opencode 选项：
     *   options.host    {string} - 服务主机（默认 localhost）
     *   options.port    {string} - 服务端口（默认 4096）
     *   options.baseUrl {string} - 完整 URL，优先级高于 host/port
     *
     * deveco-code 选项：
     *   options.host    {string} - 服务主机（默认 localhost）
     *   options.port    {string} - 服务端口（默认 4096，与 opencode 一致；两者需同时
     *                              运行时可通过 DEVECO_PORT 指定不同端口）
     *   options.baseUrl {string} - 完整 URL，优先级高于 host/port
     *
     * 公共选项：
     *   options.archive    - MessageArchive 实例（消息存档与卡死检测），不传则适配器内部自建
     */
    constructor(type = process.env.CLI_TYPE || 'opencode', options = {}) {
        this.type = type;

        switch (type) {
            case 'opencode':
                this.adapter = new OpenCodeCLI(options);
                break;
            case 'deveco-code':
                this.adapter = new DevEcoCodeCLI(options);
                break;
            default:
                throw new Error(
                    `不支持的 CLI 类型: "${type}"，可选值为 'opencode'、'deveco-code'`
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
     * 向 Session 发送消息并同步等待 AI 回复完成
     *
     * 发送消息后阻塞等待 AI 生成完整回复，然后返回回复内容。
     * 与 sendMessage（异步 fire-and-forget）不同，此方法会等到 AI 回复完成。
     *
     * @param {string} sessionId
     * @param {string} message
     * @returns {Promise<{ success: boolean, response: object|string, content: string }>}
     */
    async sendAndWaitMessage(sessionId, message) {
        return this.adapter.sendAndWaitMessage(sessionId, message);
    }

    /**
     * 向 Session 注入提示词/上下文（不触发 AI 响应）
     *
     * 利用 opencode SDK 的 noReply: true 能力，将文本注入对话历史
     * 但不触发 AI 生成回复。适用于对话过程中动态补充上下文、规则、指令。
     *
     * 向 Session 注入上下文（不触发 AI 响应，基于 opencode noReply 模式）。
     *
     * @param {string} sessionId
     * @param {string} message  - 要注入的提示词/上下文
     * @returns {Promise<{ success: boolean }>}
     */
    async injectPrompt(sessionId, message) {
        return this.adapter.injectPrompt(sessionId, message);
    }

    /**
     * 创建新 Session，可选附带初始提示词
     * @param {string} title    - Session 标题
     * @param {string} [prompt] - 初始提示词（可选）
     * @param {object} [options]
     * @param {string} [options.cwd] - 工作目录（指定后 opencode session 的文件操作在此目录下执行）
     * @returns {Promise<{ sessionId: string, action: string, message: string }>}
     */
    async startSession(title, prompt, options = {}) {
        // 记录 Session 调用次数（异步执行，不影响主流程）
        StatsService.incrementSessionCount().catch(err => {
            // 统计失败不影响正常业务，仅记录日志
            console.warn('[CLIController] Session 统计记录失败:', err.message);
        });
        
        return this.adapter.startSession(title, prompt, options);
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
     * @returns {'opencode'|'deveco-code'}
     */
    getType() {
        return this.type;
    }

    /**
     * 返回底层适配器实例（供高级用途）
     * @returns {OpenCodeCLI|DevEcoCodeCLI}
     */
    getAdapter() {
        return this.adapter;
    }
}

export { CLIController, OpenCodeCLI, DevEcoCodeCLI };
export default CLIController;
