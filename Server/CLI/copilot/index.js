import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { randomUUID } from 'node:crypto';
import MessageArchive from '../../DbUse/MessageArchive.js';
import { nowCST } from '../../library/cstTime.js';

/**
 * Copilot CLI 适配器
 *
 * 通过 @github/copilot-sdk 与 GitHub Copilot 交互，接口与 OpenCodeCLI 对标。
 * 内部维护一个 CopilotClient 单例，懒加载连接，按需创建 / 管理 Session。
 *
 * 配置选项：
 *   options.gitHubToken    - GitHub PAT（不传则使用已登录用户凭据）
 *   options.cliPath        - 覆盖 Copilot CLI 可执行路径
 *   options.cliUrl         - 连接到已有的外部 Copilot 服务（host:port）
 *   options.sendTimeout    - sendMessage 超时毫秒数（默认 120000）
 */
class CopilotCLI {
    /**
     * @param {object} options
     * @param {string} [options.gitHubToken]  - GitHub PAT
     * @param {string} [options.cliPath]      - Copilot CLI 可执行路径
     * @param {string} [options.cliUrl]       - 连接已有外部服务（host:port）
     * @param {number} [options.sendTimeout]  - 每条消息发送超时（ms）
     * @param {import('../../DbUse/MessageArchive.js').default} [options.archive] - 消息存档服务
     */
    constructor(options = {}) {
        // 消息存档：保留对话消息、判断 copilot 是否长时间无新响应（防卡死）
        this.archive = options.archive ?? new MessageArchive();
        const clientOpts = {};
        if (options.cliUrl) {
            clientOpts.cliUrl = options.cliUrl;
        } else {
            if (options.cliPath) clientOpts.cliPath = options.cliPath;
            if (options.gitHubToken) {
                clientOpts.gitHubToken = options.gitHubToken;
            } else {
                clientOpts.useLoggedInUser = true;
            }
        }
        this._clientOpts = clientOpts;
        this._client = null;

        this.sendTimeout = options.sendTimeout || 1200000; // 默认 20 分钟

        /**
         * 内存 Session 记录：sessionId → SessionRecord
         * @type {Map<string, SessionRecord>}
         */
        this.sessions = new Map();
    }

    // ─── 内部：懒加载 Client ───────────────────────────────────────────────────

    async _getClient() {
        if (!this._client) {
            this._client = new CopilotClient(this._clientOpts);
        }
        if (this._client.state !== 'connected') {
            await this._client.start();
        }
        return this._client;
    }

    // ─── 运行状态检查 ──────────────────────────────────────────────────────────

    /**
     * 检查 Copilot SDK 是否可用（尝试启动客户端连接）
     */
    async checkHealth() {
        this._log('info', 'checkHealth: 检测 Copilot SDK 连接');
        try {
            const client = await this._getClient();
            return { status: 'ok', message: 'Copilot SDK is connected', target: 'copilot-cli' };
        } catch (error) {
            this._log('warn', `checkHealth: 连接失败 — ${error.message}`);
            return {
                status: 'error',
                message: `Copilot SDK health check failed: ${error.message}`,
                error: error.message
            };
        }
    }

    // ─── Session 管理 ──────────────────────────────────────────────────────────

    /**
     * 获取所有 Session（融合持久化列表与内存状态）
     */
    async listSessions() {
        this._log('info', 'listSessions 开始');
        try {
            const client = await this._getClient();
            const persistedList = await client.listSessions();

            // 以持久化列表为主，补充内存中的状态
            const result = persistedList.map(meta => {
                const record = this.sessions.get(meta.sessionId);
                return {
                    id: meta.sessionId,
                    title: record?.title ?? meta.summary ?? meta.sessionId,
                    messages: record?.messages ?? [],
                    status: record?.status ?? 'unknown',
                    createdAt: record?.createdAt ?? meta.startTime?.toISOString() ?? null
                };
            });

            // 补充仅在内存中（尚未持久化）的 Session
            for (const [id, record] of this.sessions) {
                if (!result.find(r => r.id === id)) {
                    result.push({
                        id: record.id,
                        title: record.title,
                        messages: record.messages,
                        status: record.status,
                        createdAt: record.createdAt
                    });
                }
            }

            this._log('info', `listSessions 完成，共 ${result.length} 个 Session`);
            return result;
        } catch (error) {
            this._log('error', `listSessions 失败: ${error.message}`);
            throw new Error(`Failed to list sessions: ${error.message}`);
        }
    }

    /**
     * 获取指定 Session
     * @param {string} sessionId
     */
    async getSession(sessionId) {
        this._log('info', `getSession id=${sessionId}`);
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        return {
            id: record.id,
            title: record.title,
            messages: record.messages,
            status: record.status,
            createdAt: record.createdAt
        };
    }

    /**
     * 删除 Session（先断开，再从持久化存储和内存中移除）
     * @param {string} sessionId
     */
    async deleteSession(sessionId) {
        this._log('info', `deleteSession id=${sessionId}`);
        if (!this.sessions.has(sessionId)) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        try {
            const client = await this._getClient();
            await client.deleteSession(sessionId);
        } catch (error) {
            this._log('warn', `deleteSession: SDK 删除失败（已忽略）: ${error.message}`);
        }
        this.sessions.delete(sessionId);
        // 保留本地存档文件，不删除（用于事后审计/对比）
        this._log('info', `deleteSession 成功 id=${sessionId}`);
        return { sessionId, deleted: true };
    }

    /**
     * 终止 Session（中断正在运行的任务，Session 仍可继续使用）
     * @param {string} sessionId
     */
    async abortSession(sessionId) {
        this._log('info', `abortSession id=${sessionId}`);
        const record = this.sessions.get(sessionId);
        if (!record) {
            return { sessionId, aborted: true };
        }
        try {
            if (record.session) {
                await record.session.abort();
            }
        } catch (error) {
            this._log('warn', `abortSession: 中止信号失败（已忽略）: ${error.message}`);
        }
        record.status = 'aborted';
        this._log('info', `abortSession 成功 id=${sessionId}`);
        return { sessionId, aborted: true };
    }

    /**
     * 向指定 Session 发送消息并等待回复
     * @param {string} sessionId
     * @param {string} message
     */
    async sendMessage(sessionId, message) {

        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        const userMsg = {
            role: 'user',
            content: message,
            timestamp: nowCST()
        };
        record.messages.push(userMsg);
        record.status = 'running';
        // 归档用户消息
        this.archive.appendMessage(sessionId, userMsg, {
            dedupeKey: `user:${userMsg.timestamp}:${message.length}`
        }).catch(e => {
            this._log('warn', `sendMessage: 归档用户消息失败 id=${sessionId}: ${e.message}`);
        });
        await this.archive.patchMeta(sessionId, { status: 'running' }).catch(() => {});

        try {
            const event = await record.session.sendAndWait(
                { prompt: message },
                this.sendTimeout
            );

            const content = event?.data?.content ?? '';
            const assistantMsg = {
                role: 'assistant',
                content,
                timestamp: nowCST()
            };
            record.messages.push(assistantMsg);
            record.status = 'completed';
            // 先记录检查（此时 meta.lastMessageId 尚未更新 → hasNewMessage=true → 刷新 lastResponseAt），
            // 再归档 assistant 响应（appendMessage 更新 lastMessageId）
            const assistantDedupeKey = `assistant:${assistantMsg.timestamp}:${content.length}`;
            this.archive.recordCheck(sessionId, {
                lastMessageId: assistantDedupeKey,
                status: 'completed'
            }).catch(() => {});
            this.archive.appendMessage(sessionId, assistantMsg, {
                dedupeKey: assistantDedupeKey
            }).catch(e => {
                this._log('warn', `sendMessage: 归档响应失败 id=${sessionId}: ${e.message}`);
            });

            this._log('info', `sendMessage 完成 id=${sessionId}`);
            return { success: true, response: content };
        } catch (error) {
            record.status = 'error';
            this.archive.patchMeta(sessionId, { status: 'error' }).catch(() => {});
            this._log('error', `sendMessage 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    /**
     * 向指定 Session 发送消息并同步等待 AI 回复完成
     *
     * Copilot SDK 的 sendAndWait 本身就是同步等待模式，因此直接复用 sendMessage
     * 的实现（两者行为一致：发送 → 等待 AI 回复 → 返回内容）。
     *
     * @param {string} sessionId
     * @param {string} message
     * @returns {Promise<{ success: boolean, response?: string, content: string }>}
     */
    async sendAndWaitMessage(sessionId, message) {
        // Copilot 的 sendMessage 本身就是同步等待模式，直接委派
        const result = await this.sendMessage(sessionId, message);
        return {
            success: result.success,
            response: result.response,
            content: result.response || ''
        };
    }

    /**
     * 向指定 Session 注入提示词/上下文（不触发 AI 响应）
     *
     * ⚠️ Copilot SDK 不原生支持 noReply 模式（sendAndWait 始终等待 AI 回复），
     * 此方法会抛出 not-supported 错误。调用方应先通过 getType() 判断
     * 当前 CLI 类型，仅对 opencode 使用 injectPrompt。
     *
     * @param {string} sessionId
     * @param {string} message - 要注入的提示词/上下文
     * @throws {Error} Copilot SDK 不支持此能力
     */
    async injectPrompt(sessionId, message) {
        this._log('warn', `injectPrompt id=${sessionId} — Copilot SDK 不支持 noReply 模式`);
        throw new Error(
            `injectPrompt is not supported by Copilot SDK: ` +
            `Copilot's sendAndWait always triggers AI response. ` +
            `Use opencode CLI type for context injection.`
        );
    }

    /**
     * 创建新 Session，可选附带初始提示词
     *
     * 与 OpenCodeCLI 保持一致：若传入 prompt，则以 fire-and-forget 方式在后台异步执行，
     * 立即返回 sessionId，供上层 PollingScheduler 轮询 checkSessionStatus 判断完成。
     *
     * @param {string} title    - Session 标题
     * @param {string} [prompt] - 初始提示词（可选）
     * @param {object} [options] - 可选参数（copilot 适配器暂不支持 cwd，忽略此参数）
     */
    async startSession(title, prompt, options = {}) {

        try {
            const client = await this._getClient();
            const sessionId = randomUUID();

            const session = await client.createSession({
                sessionId,
                onPermissionRequest: approveAll
            });

            /** @type {SessionRecord} */
            const record = {
                id: sessionId,
                title,
                messages: [],
                status: 'idle',
                createdAt: nowCST(),
                session
            };
            this.sessions.set(sessionId, record);
            this._log('info', `Session 已创建 id=${sessionId}`);

            // 初始化存档元信息
            this.archive.patchMeta(sessionId, {
                sessionId,
                title,
                cliType: 'copilot',
                createdAt: record.createdAt,
                status: 'idle'
            }).catch(e => {
                this._log('warn', `startSession: 初始化存档 meta 失败 id=${sessionId}: ${e.message}`);
            });

            if (prompt) {
                // Fire-and-forget：后台异步执行，不阻塞调用方
                // record.status 由 sendMessage 内部同步更新（running → completed / error）
                // PollingScheduler 通过 checkSessionStatus 轮询内存状态即可正常工作
                this.sendMessage(sessionId, prompt).catch(error => {
                    this._log('error', `startSession 后台执行失败 id=${sessionId}: ${error.message}`);
                    const r = this.sessions.get(sessionId);
                    if (r) r.status = 'error';
                });
                return { sessionId, action: 'create', message: '已创建新 Session 并开始执行' };
            }

            return { sessionId, action: 'create', message: '已创建新 Session' };
        } catch (error) {
            this._log('error', `startSession 失败: ${error.message}`);
            throw new Error(`Failed to start session: ${error.message}`);
        }
    }

    /**
     * 查询 Session 当前状态
     * @param {string} sessionId
     * @returns {{ status: string, lastMessage?: object }}
     */
    async checkSessionStatus(sessionId) {
        const record = this.sessions.get(sessionId);
        if (!record) {
            return { status: 'unknown' };
        }
        const lastMessage = record.messages.length > 0
            ? record.messages[record.messages.length - 1]
            : null;

        // 记录检查并计算停滞时长（用于检测 copilot 长时间无新响应）
        const lastId = lastMessage
            ? `${lastMessage.role}:${lastMessage.timestamp}:${(lastMessage.content || '').length}`
            : null;
        const checkRes = await this.archive.recordCheck(sessionId, {
            lastMessageId: lastId,
            status: record.status
        }).catch(() => ({ stalled: false, stallDurationMs: null, hasNewMessage: false }));

        const finalStatus = checkRes.stalled ? 'stalled' : record.status;
        if (checkRes.stalled) {
            this._log('warn',
                `checkSessionStatus: 检测到停滞 id=${sessionId}, 已 ${Math.round((checkRes.stallDurationMs || 0) / 1000)}s 无新响应`);
        }
        this._log('info', `checkSessionStatus: status=${finalStatus}`);
        return {
            status: finalStatus,
            lastMessage,
            stallDurationMs: checkRes.stallDurationMs,
            stalled: !!checkRes.stalled,
            hasNewMessage: !!checkRes.hasNewMessage
        };
    }

    /**
     * 获取 Session 消息历史
     * @param {string} sessionId
     */
    async getSessionMessages(sessionId) {
        this._log('info', `getSessionMessages id=${sessionId}`);
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        return record.messages;
    }

    /**
     * 实时查看当前对话消息（运行中安全调用）
     *
     * Copilot 的消息存在内存 record.messages 中，运行中也能完整读取。
     * 不写入本地存档，不影响后续归档去重。
     *
     * @param {string} sessionId
     * @returns {Promise<Array<{role,content,timestamp}>>}
     */
    async getLiveMessages(sessionId) {
        this._log('info', `getLiveMessages id=${sessionId}`);
        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        // 返回内存中的消息副本（去掉引用）
        return record.messages.map(m => ({ ...m }));
    }

    /**
     * 导出完整对话（合并内存 + 本地存档，支持运行中 / 已结束）
     *
     * @param {string} sessionId
     * @param {object} [opts]
     * @param {'json'|'markdown'} [opts.format='json'] - 导出格式
     * @returns {Promise<object|string>}
     */
    async exportSession(sessionId, opts = {}) {
        const format = opts.format || 'json';
        this._log('info', `exportSession id=${sessionId} format=${format}`);

        const record = this.sessions.get(sessionId);
        if (!record) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        // 内存消息归档到本地（增量去重）
        const archRes = await this.archive.appendMessages(
            sessionId,
            record.messages.map(m => ({ ...m }))
        ).catch(e => {
            this._log('warn', `exportSession: 归档失败 id=${sessionId}: ${e.message}`);
            return { appended: 0, skipped: 0 };
        });
        this._log('debug', `exportSession: 归档 appended=${archRes.appended} skipped=${archRes.skipped}`);

        // 读本地归档（合并后按 seq 排序）
        const archivedMessages = await this.archive.readMessages(sessionId);
        const meta = await this.archive.readMeta(sessionId);
        const messagesSorted = archivedMessages.sort((a, b) => (a.seq || 0) - (b.seq || 0));

        if (format === 'markdown') {
            return this._toMarkdown(meta, messagesSorted);
        }
        return {
            sessionId,
            meta,
            messages: messagesSorted
        };
    }

    /**
     * 将对话消息渲染为 Markdown 格式
     * @param {object} meta - Session 元信息
     * @param {Array} messages - 已归档消息列表
     * @returns {string}
     */
    _toMarkdown(meta, messages) {
        const lines = [];
        lines.push(`# ${meta.title || meta.sessionId}`);
        lines.push('');
        lines.push(`> **Session ID**: ${meta.sessionId}  `);
        lines.push(`> **CLI 类型**: ${meta.cliType || 'N/A'}  `);
        lines.push(`> **创建时间**: ${meta.createdAt || 'N/A'}  `);
        lines.push(`> **状态**: ${meta.status || 'N/A'}  `);
        lines.push(`> **消息数**: ${messages.length}  `);
        lines.push('');
        lines.push('---');
        lines.push('');
        for (const msg of messages) {
            const roleLabel = msg.role === 'user' ? '🧑 User' : (msg.role === 'assistant' ? '🤖 Assistant' : msg.role);
            const ts = msg.timestamp || '';
            lines.push(`### ${roleLabel}`);
            lines.push(`*${ts}*`);
            lines.push('');
            lines.push(msg.content || '(empty)');
            lines.push('');
        }
        return lines.join('\n');
    }

    /**
     * 读取本地已归档的消息（持久化文件，进程重启后仍可读）
     * @param {string} sessionId
     * @returns {Promise<Array<object>>}
     */
    async getArchivedMessages(sessionId) {
        return this.archive.readMessages(sessionId);
    }

    /**
     * 读取本地存档元信息（含 lastResponseAt / archivedCount 等）
     * @param {string} sessionId
     * @returns {Promise<object>}
     */
    async getArchiveMeta(sessionId) {
        return this.archive.readMeta(sessionId);
    }

    // ─── 内部方法 ──────────────────────────────────────────────────────────────

    _log(level, msg) {
        const prefix = '[CopilotCLI]';
        if (level === 'error') console.error(`❌ ${prefix} ${msg}`);
        else if (level === 'warn') console.warn(`⚠️  ${prefix} ${msg}`);
        else console.log(`ℹ️  ${prefix} ${msg}`);
    }
}

/**
 * @typedef {object} SessionRecord
 * @property {string} id
 * @property {string} title
 * @property {Array<{role: string, content: string, timestamp: string}>} messages
 * @property {'idle'|'running'|'completed'|'error'|'aborted'} status
 * @property {string} createdAt
 * @property {import('@github/copilot-sdk').CopilotSession} session
 */

export default CopilotCLI;
