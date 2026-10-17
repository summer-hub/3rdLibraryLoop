/**
 * cli.js —— CLIController 统一控制类（按 type 委派给适配器）
 *
 * **本文件不隐式加载 env**。`Server/.env` / CLI 三层 `.env` 链的加载由**装配点**保证：
 *   - HTTP 模式与嵌入式 CLI：`Server/composition/buildApp.js` 的 `loadServerEnv()`；
 *   - `cli/lib/config.js` 的 `loadEnvChain()`：三层链（系统 env > `~/.3lib/.env` >
 *     项目 `Server/.env`），跑完会调 `markServerEnvLoaded()` 让 Server 侧不再重复加载；
 *   - 直接 import 本文件的手工入口（`Server/CLI/test.js` 等）：自行显式
 *     `await loadServerEnv();` 引导一次（幂等）。
 *
 * 历史：这里曾有一行模块顶层 `await loadServerEnv();`，属隐式副作用——import 门面即
 * 改进程环境变量。已删除（迁移目标达成），改为在入口/装配点显式引导。
 */

import OpenCodeCLI from './opencode/index.js';
import DevEcoCodeCLI from './deveco-code/index.js';
import { StatsService } from '../library/StatsService.js';
import { resolveAiCliFactory, resolveStats } from '../composition/hostBridge.js';

/** 支持的 CLI 类型（闭集）：非法值一律抛错，宿主模式也不例外 */
const SUPPORTED_TYPES = Object.freeze(['opencode', 'deveco-code']);

/**
 * 非法类型的错误（文案与改造前逐字一致；只此一处，避免两份文案漂移）。
 * @param {string} type
 * @returns {Error}
 */
function unsupportedType(type) {
    return new Error(
        `不支持的 CLI 类型: "${type}"，可选值为 'opencode'、'deveco-code'`
    );
}

/**
 * 遗留兜底路径：**没有该 type 的宿主提供方**时按 type 直接构造适配器。
 * 与改造前的 `switch` 逐项等价：同一个类、同样的 options 原样转发、同样的报错文案。
 *
 * 归档不需要在这里补：适配器按 `options.archive` → 类静态 `defaultArchiveFactory`
 * 的顺序自取（该静态钩子由 `Server/CLI/{opencode,deveco-code}/index.js` 门面在 import 期
 * 挂成"宿主 message-archive 接缝工厂 → 内置 MessageArchive"，见那两个文件）。
 * `buildApp({ attachCliArchive: true })` 传进来的 `options.archive` 依然最优先。
 *
 * @param {'opencode'|'deveco-code'} type
 * @param {object} options
 * @returns {object} 适配器实例
 * @throws {Error} 不支持的 type
 */
function legacyCreate(type, options) {
    switch (type) {
        case 'opencode':
            return new OpenCodeCLI(options);
        case 'deveco-code':
            return new DevEcoCodeCLI(options);
        default:
            throw unsupportedType(type);
    }
}

/**
 * 通用 CLI 控制类
 *
 * 封装 AI 编程助手 CLI（opencode / deveco-code），对外暴露统一的 Session 管理接口。
 *
 * 默认 CLI 类型可在 Server/.env 中配置 CLI_TYPE=opencode|deveco-code，
 * 也可通过 shell 环境变量 CLI_TYPE 指定（优先级高于 .env），均未设置时默认 'deveco-code'。
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
     *   （shell 环境变量 > Server/.env），仍未设置则 'deveco-code'
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
     *   options.archive          - MessageArchive 实例（消息存档与卡死检测）。不传时有宿主则取
     *                              `message-archive` 接缝的工厂，无宿主则自建（与改造前一致）
     *   options.stats            - 统计提供方（类，需有静态 `incrementSessionCount()`）。不传时
     *                              见 startSession 的优先级链
     *   options.stallThresholdMs - 卡死判定阈值（ms），不传则读归档契约（默认 5 分钟）
     */
    constructor(type = process.env.CLI_TYPE || 'deveco-code', options = {}) {
        // 类型校验前移：宿主模式下若先问接缝，非法 type 会被裸名 `ai-cli` 兜住而悄悄放行，
        // 与改造前「非法 type 必抛」的契约相反。文案由 unsupportedType() 单点维护。
        if (!SUPPORTED_TYPES.includes(type)) throw unsupportedType(type);

        this.type = type;

        // stats 是「旁路计数」依赖，不是适配能力：装配层（buildApp）在有宿主时把
        // host.inject('stats') 经 cliOptions.stats 递进来，这里**摘出来**再转发选项，
        // 免得把统计依赖塞进只认连接配置的适配器。
        // 未注入时原对象转发（同一个引用、同样的 key），无宿主场景逐字节等价。
        const { stats, ...optionsWithoutStats } = options;
        this._stats = stats ?? null;

        // 接缝解析（本片的核心改动）：把原来的 switch 换成「宿主优先 → 遗留兜底」。
        //   有宿主且注册了 ai-cli@cli/<type>（或裸名 ai-cli）→ 用插件注册的工厂构造
        //   否则（无宿主 = 默认部署形态）→ legacyCreate，行为与改造前逐字节等价
        const adapterOptions = stats === undefined ? options : optionsWithoutStats;
        const factory = resolveAiCliFactory(type);
        this.adapter = factory ? factory(adapterOptions) : legacyCreate(type, adapterOptions);
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
        // 记录 Session 调用次数（异步执行，不影响主流程）。
        // 统计提供方的优先级链（高 → 低），显式注入永远压过全局桥：
        //   ① `constructor` 收到的 `options.stats` —— 装配层显式注入。有宿主时
        //      `buildApp` 把 `host.inject('stats')` 的提供方经 cliOptions 递进来；
        //      测试/上层也可以直接传别的实现，装配层不再回头去问全局状态。
        //   ② `resolveStats()` —— 当前活跃宿主注册的 `stats` 接缝提供方
        //      （`Server/composition/hostBridge.js`；无宿主时返回 null）。
        //   ③ `StatsService` —— 门面内置实现，也是无宿主（默认部署形态）下与迁移前
        //      逐字节等价的那一条：同一个类、同样的静态方法、同样的时机。
        // 为什么保留 ②③：Agent/Brain/FlexRunner 等深处仍会 `new CLIController()`，
        // 它们不带装配层注入，靠全局桥（②）或内置实现（③）跟住同一个提供方。
        const stats = this._stats ?? resolveStats() ?? StatsService;
        stats.incrementSessionCount().catch(err => {
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

    /**
     * F-06：注入外部取消源，使 abort 能中断在途 HTTP 请求
     * （而非只在步骤边界被感知）。适配器不支持时静默降级。
     * @param {AbortSignal} signal
     */
    setAbortSignal(signal) {
        if (typeof this.adapter.setAbortSignal === 'function') {
            this.adapter.setAbortSignal(signal);
        }
    }

    /**
     * F-06：立即取消所有在途请求（幂等）。适配器不支持时静默降级。
     * @param {string} [reason]
     */
    abortInFlight(reason) {
        if (typeof this.adapter.abortInFlight === 'function') {
            this.adapter.abortInFlight(reason);
        }
    }
}

export { CLIController, OpenCodeCLI, DevEcoCodeCLI };
export default CLIController;
