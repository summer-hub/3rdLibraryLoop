import { createOpencodeClient } from '@opencode-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import MessageArchive from '../../DbUse/MessageArchive.js';
import { nowCST } from '../../library/cstTime.js';

/**
 * OpenCode CLI 适配器
 * 通过 @opencode-ai/sdk 与运行中的 opencode 服务通信，提供统一的 Session 管理接口。
 *
 * 依赖环境变量（可由 options 覆盖）：
 *   OPENCODE_HOST  - opencode 服务主机（默认 localhost）
 *   OPENCODE_PORT  - opencode 服务端口（默认 4096）
 */
class OpenCodeCLI {
    /**
     * @param {object} options
     * @param {string} [options.host]    - opencode 服务主机
     * @param {string} [options.port]    - opencode 服务端口
     * @param {string} [options.baseUrl] - 完整 baseUrl，优先级高于 host/port
     * @param {import('../../DbUse/MessageArchive.js').default} [options.archive] - 消息存档服务
     */
    constructor(options = {}) {
        this.host = options.host || process.env.OPENCODE_HOST || 'localhost';
        this.port = options.port || process.env.OPENCODE_PORT || '4096';
        this.baseUrl = options.baseUrl || `http://${this.host}:${this.port}`;
        this.client = null;
        // 消息存档：用于保留对话消息、判断 opencode 是否长时间无新响应（防卡死）
        this.archive = options.archive ?? new MessageArchive();
        // 记录各 session 首次进入 busy/retry 的时间戳（ms），用于"busy 停滞兜底"判定
        this._busySince = {};
        this._init();
    }

    // ─── 初始化 ────────────────────────────────────────────────────────────────

    _init() {
        try {
            this.client = createOpencodeClient({ baseUrl: this.baseUrl });
            this._log('info', `已连接至 ${this.baseUrl}`);
        } catch (error) {
            this._log('error', `初始化失败: ${error.message}`);
            throw error;
        }
    }

    // ─── 运行状态检查 ──────────────────────────────────────────────────────────

    async checkHealth() {
        this._log('info', `checkHealth → ${this.baseUrl}`);
        try {
            // 轻量健康检查：只调用 session.list() 验证连通性
            // 不再为每个 session 拉取全量消息（原 listSessions 会拉所有 session 的所有消息）
            await this.client.session.list();
            this._log('info', 'checkHealth: 连通正常');
            return { status: 'ok', message: 'OpenCode CLI is healthy', target: this.baseUrl };
        } catch (error) {
            this._log('warn', `checkHealth: 连接失败 — ${error.message}`);
            return {
                status: 'error',
                message: `Health check failed: ${error.message}`,
                error: error.message
            };
        }
    }

    // ─── Session 管理 ──────────────────────────────────────────────────────────

    /**
     * 获取所有 Session（附带状态）
     *
     * 优化：不再为每个 session 拉取全量消息来判断状态。
     * 仅返回 session 元信息，状态通过 checkSessionStatus 按需查询。
     * 原实现对 N 个 session 发起 N 个并发 HTTP 请求拉全量消息，
     * session 数量多时会压垮 OpenCode 服务。
     */
    async listSessions() {
        this._log('info', 'listSessions 开始');
        try {
            const sessions = await this.client.session.list();
            // 只返回 session 元信息，不拉取消息
            const result = sessions.data.map(s => ({ ...s, status: 'unknown' }));
            this._log('info', `listSessions 完成，共 ${result.length} 个 Session`);
            return result;
        } catch (error) {
            this._log('error', `listSessions 失败: ${error.message}`);
            throw new Error(`Failed to list sessions: ${error.message}`);
        }
    }

    /**
     * 获取指定 Session（含状态）
     *
     * 使用 session.get() 获取元信息 + session.status() 获取运行状态，
     * 不再拉取全量消息。
     *
     * @param {string} sessionId
     * @returns {Promise<object>} Session 元信息（含 status 字段）
     */
    async getSession(sessionId) {
        this._log('info', `getSession id=${sessionId}`);
        try {
            const [sessionRes, statusMap] = await Promise.all([
                this.client.session.get({ path: { id: sessionId } }),
                this.client.session.status({ query: {} }).catch(() => ({ data: {} }))
            ]);
            const session = sessionRes.data;
            const rawStatus = statusMap.data?.[sessionId];
            const status = this._mapSessionStatus(rawStatus);
            const result = { ...session, status };
            this._log('info', `getSession 完成，status=${status}`);
            return result;
        } catch (error) {
            this._log('error', `getSession 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to get session: ${error.message}`);
        }
    }

    /**
     * 将 opencode SessionStatus 映射为统一状态
     * busy → running, retry → running, idle → idle, 其他 → unknown
     */
    _mapSessionStatus(rawStatus) {
        if (!rawStatus || !rawStatus.type) return 'unknown';
        switch (rawStatus.type) {
            case 'busy':
            case 'retry':
                return 'running';
            case 'idle':
                return 'idle';
            default:
                return 'unknown';
        }
    }

    /**
     * 删除 Session
     * @param {string} sessionId
     */
    async deleteSession(sessionId) {
        this._log('info', `deleteSession id=${sessionId}`);
        try {
            const result = await this.client.session.delete({ path: { id: sessionId } });
            this._log('info', `deleteSession 成功 id=${sessionId}`);
            return result.data;
        } catch (error) {
            this._log('error', `deleteSession 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to delete session: ${error.message}`);
        }
        // 保留本地存档文件，不删除（用于事后审计/对比）
    }

    /**
     * 终止 Session（中断正在运行的任务）
     * @param {string} sessionId
     */
    async abortSession(sessionId) {
        this._log('info', `abortSession id=${sessionId}`);
        try {
            const result = await this.client.session.abort({ path: { id: sessionId } });
            this._log('info', `abortSession 成功 id=${sessionId}`);
            return result.data;
        } catch (error) {
            this._log('error', `abortSession 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to abort session: ${error.message}`);
        }
    }

    /**
     * 向指定 Session 发送消息
     * @param {string} sessionId
     * @param {string} message
     */
    async sendMessage(sessionId, message) {
        this._log('info', `sendMessage id=${sessionId}`);
        this._log('info', `  message (前100字): ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);
        try {
            await this.client.session.promptAsync({
                path: { id: sessionId },
                body: {
                    parts: [{ type: 'text', text: message }],
                    noReply: false
                },
                url: `/session/${sessionId}/prompt_async`
            });
            // 用户消息不由这里归档，统一由 checkSessionStatus / getSessionMessages
            // 从远端拉取归档，确保所有消息用 opencode id 去重，避免重复
            this._log('info', `sendMessage 成功 id=${sessionId}`);
            return { success: true };
        } catch (error) {
            this._log('error', `sendMessage 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    /**
     * 向指定 Session 发送消息并同步等待 AI 回复完成
     *
     * 使用 opencode SDK 的 session.prompt()（同步版本），发送消息后阻塞等待
     * AI 生成完整回复，然后直接返回 AssistantMessage 及其 parts。
     *
     * 与 sendMessage 的区别：
     *   sendMessage       → promptAsync，发送后立即返回，不等 AI 回复（fire-and-forget）
     *   sendAndWaitMessage → prompt，发送后等待 AI 回复完成再返回
     *
     * 适用场景：
     *   - 需要立即获取 AI 回复内容，不适合轮询等待
     *   - 简单问答、单轮对话
     *   - 调用方需要同步拿到结果继续处理
     *
     * ⚠️ 注意：AI 回复可能耗时较长（几十秒到几分钟），调用方需设置合理的超时。
     *
     * @param {string} sessionId
     * @param {string} message - 发送的消息
     * @returns {Promise<{ success: boolean, response: object, content: string }>}
     *   response: opencode 返回的完整 AssistantMessage（含 info + parts）
     *   content: AI 回复的文本内容（从 parts 中提取拼接）
     */
    async sendAndWaitMessage(sessionId, message) {
        this._log('info', `sendAndWaitMessage id=${sessionId}`);
        this._log('info', `  message (前100字): ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);
        try {
            const result = await this.client.session.prompt({
                path: { id: sessionId },
                body: {
                    parts: [{ type: 'text', text: message }],
                    noReply: false
                },
                url: `/session/${sessionId}/message`
            });
            const assistantMsg = result.data;
            // 从 parts 中提取文本内容
            const textParts = (assistantMsg.parts || []).filter(p => p.type === 'text');
            const content = textParts.map(p => p.text).join('\n');
            this._log('info',
                `sendAndWaitMessage 成功 id=${sessionId}, ` +
                `回复长度=${content.length}字, finish=${assistantMsg.info?.finish ?? 'N/A'}`);
            // 用户消息 + AI 回复均不由这里归档，统一由 getSessionMessages
            // 从远端拉取归档，确保用 opencode id 去重
            return {
                success: true,
                response: assistantMsg,
                content
            };
        } catch (error) {
            this._log('error', `sendAndWaitMessage 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to send and wait message: ${error.message}`);
        }
    }

    /**
     * 向指定 Session 注入提示词/上下文（不触发 AI 响应）
     *
     * 利用 opencode SDK 的 noReply: true 能力，将文本作为 UserMessage
     * 注入对话历史，但不会触发 AI 生成回复。
     *
     * 适用场景：
     *   - 对话过程中动态补充上下文、规则、指令
     *   - 插件向会话注入参考信息，不打断当前 AI 任务
     *   - 追加系统级约束（如代码规范、输出格式要求）
     *
     * 与 sendMessage 的区别：
     *   sendMessage   → noReply: false，发送后 AI 会生成回复
     *   injectPrompt  → noReply: true，仅注入上下文，AI 不回复
     *
     * @param {string} sessionId
     * @param {string} message - 要注入的提示词/上下文
     * @returns {Promise<{ success: boolean }>}
     */
    async injectPrompt(sessionId, message) {
        this._log('info', `injectPrompt id=${sessionId}`);
        this._log('info', `  message (前100字): ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);
        try {
            await this.client.session.promptAsync({
                path: { id: sessionId },
                body: {
                    parts: [{ type: 'text', text: message }],
                    noReply: true
                },
                url: `/session/${sessionId}/prompt_async`
            });
            // 注入的上下文消息不由这里归档，统一由 getSessionMessages
            // 从远端拉取归档，确保用 opencode id 去重
            this._log('info', `injectPrompt 成功 id=${sessionId}（已注入上下文，不触发 AI 响应）`);
            return { success: true };
        } catch (error) {
            this._log('error', `injectPrompt 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to inject prompt: ${error.message}`);
        }
    }

    /**
     * 创建新 Session，可选附带初始提示词
     * @param {string} title  - Session 标题
     * @param {string} [prompt] - 初始提示词（可选）
     * @param {object} [options]
     * @param {string} [options.cwd] - 工作目录（通过 opencode session.create 的 query.directory 设定）
     */
    async startSession(title, prompt, options = {}) {
        const cwd = options.cwd;
        this._log('info', `startSession title="${title}"${cwd ? ` cwd="${cwd}"` : ''}`);

        // 前置检查：如果指定了 cwd，确保目录存在
        // opencode session.create 不会检查目录是否存在，但 promptAsync 时会
        // realPath 检查，目录不存在时静默失败（返回 204，tokens=0+0）。
        if (cwd) {
            try {
                const stats = fs.statSync(cwd);
                if (!stats.isDirectory()) {
                    throw new Error(`cwd 不是目录: ${cwd}`);
                }
            } catch (statErr) {
                if (statErr.code === 'ENOENT') {
                    this._log('info', `startSession: cwd 不存在，自动创建 ${cwd}`);
                    fs.mkdirSync(cwd, { recursive: true });
                } else {
                    throw new Error(`startSession: cwd 检查失败: ${statErr.message}`);
                }
            }
        }

        try {
            // opencode SDK session.create 支持 query.directory 参数，
            // 用于指定该 Session 的工作目录（git clone、文件读写等操作均在此目录下执行）
            const createParams = { body: { title } };
            if (cwd) {
                createParams.query = { directory: cwd };
            }
            const session = await this.client.session.create(createParams);
            const sessionId = session.data.id;
            this._log('info', `Session 已创建 id=${sessionId}${cwd ? ` directory="${cwd}"` : ''}`);

            // 初始化存档元信息
            await this.archive.patchMeta(sessionId, {
                sessionId,
                title,
                cliType: 'opencode',
                createdAt: nowCST(),
                status: 'idle'
            }).catch(e => {
                this._log('warn', `startSession: 初始化存档 meta 失败 id=${sessionId}: ${e.message}`);
            });

            if (prompt) {
                await this.client.session.promptAsync({
                    path: { id: sessionId },
                    body: {
                        parts: [{ type: 'text', text: prompt }],
                        noReply: false
                    },
                    url: `/session/${sessionId}/prompt_async`
                });
                // 初始 prompt 的用户消息不由这里归档，统一由 checkSessionStatus /
                // getSessionMessages 从远端拉取归档，确保用 opencode id 去重
                await this.archive.patchMeta(sessionId, { status: 'running' }).catch(() => {});
                this._log('info', `初始 prompt 已发送 id=${sessionId}`);
            }

            return {
                sessionId,
                action: 'create',
                message: prompt ? '已创建新 Session 并开始执行' : '已创建新 Session'
            };
        } catch (error) {
            this._log('error', `startSession 失败: ${error.message}`);
            throw new Error(`Failed to start session: ${error.message}`);
        }
    }

    /**
     * 查询 Session 当前状态
     * @param {string} sessionId
     * @returns {{ status: 'completed'|'running'|'unknown', lastMessage?: object }}
     */
    async checkSessionStatus(sessionId) {
        try {
            // ── 快路径：先查 session.status()，busy/retry 时直接返回 running，不拉消息 ──
            // session.status() 返回 {[id]: {type: "busy"|"idle"|"retry"}}，极轻量
            // 只有 idle 时才需要拉最后一条消息检查 finish/error 判断 completed/error
            let statusMap;
            try {
                statusMap = await this.client.session.status({ query: {} });
            } catch (e) {
                this._log('warn', `checkSessionStatus: session.status() 失败，降级为拉消息: ${e.message}`);
            }
            const rawStatus = statusMap?.data?.[sessionId];
            if (rawStatus && (rawStatus.type === 'busy' || rawStatus.type === 'retry')) {
                // AI 正在生成，无需拉消息（快路径）
                // 但若 busy 持续过久（超过停滞阈值），则降级拉最后一条消息兜底：
                // opencode 的 session.status() 在任务实际完成后仍可能长时间保持 busy，
                // 仅依赖 status 会永远无法识别已完成的 finish:"stop" 消息，导致上层轮询超时。
                const now = Date.now();
                if (!this._busySince[sessionId]) {
                    this._busySince[sessionId] = now;
                }
                // 复用存档的卡死阈值（默认 5 分钟），作为 busy 停滞兜底的超时判定
                const stallThresholdMs = this.archive?._store?.stallThresholdMs ?? 5 * 60 * 1000;
                const busyDurationMs = now - this._busySince[sessionId];

                if (busyDurationMs >= stallThresholdMs) {
                    // busy 停滞超阈值 → 检查消息层，识别是否实际已完成
                    this._log('warn',
                        `checkSessionStatus: session ${sessionId} busy 持续 ${Math.round(busyDurationMs / 1000)}s，降级检查消息层`);
                    const fallback = await this._checkMessageLayer(sessionId);
                    if (fallback) {
                        return fallback;
                    }
                }

                const checkRes = await this.archive.recordCheck(sessionId, {
                    lastMessageId: null,
                    status: 'running'
                }).catch(() => ({ stalled: false, stallDurationMs: null, hasNewMessage: false }));
                return {
                    status: checkRes.stalled ? 'stalled' : 'running',
                    stallDurationMs: checkRes.stallDurationMs,
                    stalled: !!checkRes.stalled,
                    hasNewMessage: false
                };
            }
            // 非 busy/retry：清除停滞计时，避免脏状态
            delete this._busySince[sessionId];

            // ── idle 或 status 查询失败：拉最后 1 条消息判断 completed/error/running ──
            const messages = await this.client.session.messages({
                path: { id: sessionId },
                query: { limit: 1 },
            });
            const data = messages.data;

            if (!data || data.length === 0) {
                return { status: 'unknown' };
            }

            const lastMessage = data[data.length - 1];

            // 出错 / 被中断
            if (lastMessage.info?.error) {
                const errName = lastMessage.info.error.name ?? 'UnknownError';
                this._log('warn', `checkSessionStatus: 检测到错误 ${errName}，status=error`);
                await this.archive.recordCheck(sessionId, {
                    lastMessageId: this._msgDedupeKey(lastMessage),
                    status: 'error'
                }).catch(() => {});
                // 错误结束时也自动归档全量消息
                await this._autoArchive(sessionId, 'error');
                return { status: 'error', error: lastMessage.info.error, lastMessage };
            }

            // 正常完成
            const isCompleted = this._isCompletedMessage(lastMessage);

            const status = isCompleted ? 'completed' : 'running';

            // 状态检查 + 卡死检测
            const dedupeKey = this._msgDedupeKey(lastMessage);
            const checkRes = await this.archive.recordCheck(sessionId, {
                lastMessageId: dedupeKey,
                status
            }).catch(() => ({ stalled: false, stallDurationMs: null, hasNewMessage: false }));

            // 若检测到停滞（running 状态下长时间无新 assistant 消息）
            const finalStatus = checkRes.stalled ? 'stalled' : status;
            if (checkRes.stalled) {
                this._log('warn',
                    `checkSessionStatus: 检测到停滞 id=${sessionId}, 已 ${Math.round((checkRes.stallDurationMs || 0) / 1000)}s 无新响应`);
            }

            // session 完成时自动归档全量消息（写入 .jsonl）
            if (isCompleted) {
                await this._autoArchive(sessionId, 'completed');
            }

            return {
                status: finalStatus,
                lastMessage,
                // 卡死检测相关字段
                stallDurationMs: checkRes.stallDurationMs,
                stalled: !!checkRes.stalled,
                hasNewMessage: !!checkRes.hasNewMessage
            };
        } catch (error) {
            this._log('warn', `checkSessionStatus 异常 id=${sessionId}: ${error.message}`);
            return { status: 'unknown' };
        }
    }

    /**
     * 判断 opencode 消息是否为正常完成（finish='stop' 且含 text part）。
     *
     * 供 checkSessionStatus 的 idle 分支与 busy 停滞兜底分支共用，避免判定逻辑漂移。
     *
     * @param {object} lastMessage - opencode 原始消息
     * @returns {boolean}
     * @private
     */
    _isCompletedMessage(lastMessage) {
        return Boolean(
            lastMessage &&
            lastMessage.info?.finish === 'stop' &&
            Array.isArray(lastMessage.parts) &&
            lastMessage.parts.some(p => p.type === 'text')
        );
    }

    /**
     * 从消息层检查 session 是否实际已完成/出错。
     *
     * 用于 busy/retry 停滞兜底：拉取最后 1 条消息，若已 finish='stop' 或 info.error，
     * 则返回对应的 completed/error 状态；否则返回 null（表示任务确实仍在运行）。
     *
     * 注意：本方法不更新 _busySince——由调用方在返回非 completed/error 时继续累积。
     *
     * @param {string} sessionId
     * @returns {Promise<object|null>} 已终态时返回状态对象；仍在运行返回 null
     * @private
     */
    async _checkMessageLayer(sessionId) {
        try {
            const messages = await this.client.session.messages({
                path: { id: sessionId },
                query: { limit: 1 },
            });
            const data = messages.data;
            if (!data || data.length === 0) {
                return null;
            }

            const lastMessage = data[data.length - 1];

            // 出错 / 被中断
            if (lastMessage.info?.error) {
                const errName = lastMessage.info.error.name ?? 'UnknownError';
                this._log('warn', `checkSessionStatus: busy 兜底检测到错误 ${errName}，status=error`);
                await this.archive.recordCheck(sessionId, {
                    lastMessageId: this._msgDedupeKey(lastMessage),
                    status: 'error'
                }).catch(() => {});
                await this._autoArchive(sessionId, 'error');
                delete this._busySince[sessionId];
                return { status: 'error', error: lastMessage.info.error, lastMessage };
            }

            // 正常完成（finish='stop' 且含 text）
            if (this._isCompletedMessage(lastMessage)) {
                this._log('info', `checkSessionStatus: busy 兜底确认 session ${sessionId} 已完成`);
                const dedupeKey = this._msgDedupeKey(lastMessage);
                await this.archive.recordCheck(sessionId, {
                    lastMessageId: dedupeKey,
                    status: 'completed'
                }).catch(() => {});
                await this._autoArchive(sessionId, 'completed');
                delete this._busySince[sessionId];
                return {
                    status: 'completed',
                    lastMessage,
                    stallDurationMs: null,
                    stalled: false,
                    hasNewMessage: true
                };
            }

            // 仍在运行：刷新 busySince（避免一次长消息生成被误判），返回 null 表示继续等待
            this._busySince[sessionId] = Date.now();
            return null;
        } catch (err) {
            this._log('warn', `checkSessionStatus: busy 兜底检查消息失败 id=${sessionId}: ${err.message}`);
            return null;
        }
    }

    /**
     * 生成 opencode 消息的去重键
     * 优先用消息 id（全局唯一）；无 id 时用 role+finish+时间+内容文本长度
     * 注意：不使用 parts 长度，因为 checkSessionStatus(limit=1) 与 getSessionMessages(全量)
     * 返回的 parts 结构可能不同，导致同一条消息算出不同去重键而重复归档。
     */
    _msgDedupeKey(msg) {
        const id = msg.id ?? msg.info?.id;
        if (id) return String(id);
        const role = msg.info?.role ?? 'unknown';
        const finish = msg.info?.finish ?? '';
        const ts = msg.info?.time?.created ?? msg.timestamp ?? '';
        const textParts = (msg.parts || []).filter(p => p.type === 'text');
        const content = textParts.map(p => p.text).join('\n');
        return `${role}:${finish}:${ts}:${content.length}`;
    }

    /**
     * 将 opencode 原始消息转换为精简归档格式
     *
     * 只保留核心对话字段（role / content / finish / timestamp / id），
     * 去掉 raw 原始结构（含 parts / tokens / cost / reasoning 等），
     * 使归档文件轻量可读，关注实际发生了哪些对话。
     */
    _toArchiveMessage(msg) {
        const role = msg.info?.role ?? 'unknown';
        const textParts = (msg.parts || []).filter(p => p.type === 'text');
        const content = textParts.map(p => p.text).join('\n');
        // opencode 时间在 info.time.created（epoch 毫秒），非 ISO 字符串
        const createdMs = msg.info?.time?.created;
        const timestamp = createdMs != null
            ? nowCST(createdMs)
            : (msg.timestamp ?? nowCST());
        return {
            id: msg.id ?? msg.info?.id,
            role,
            content,
            finish: msg.info?.finish ?? null,
            timestamp
        };
    }

    /**
     * 自动归档 — session 完成或出错时全量拉取消息并写入 .jsonl
     *
     * checkSessionStatus 平时只用 limit=1 查状态（不归档），
     * 但当检测到 session 已结束（completed / error）时，
     * 应自动全量拉取消息归档，确保 .jsonl 文件生成。
     *
     * 归档采用 appendMessages 增量去重，重复调用安全无副作用。
     *
     * @param {string} sessionId
     * @param {'completed'|'error'} reason - 触发归档的原因
     * @private
     */
    async _autoArchive(sessionId, reason) {
        try {
            const messages = await this.client.session.messages({ path: { id: sessionId } });
            const data = messages.data || [];
            const archRes = await this.archive.appendMessages(
                sessionId,
                data.map(m => this._toArchiveMessage(m))
            );
            this._log('info',
                `自动归档 id=${sessionId} reason=${reason} — appended=${archRes.appended} skipped=${archRes.skipped}`);
        } catch (e) {
            this._log('warn', `自动归档失败 id=${sessionId} reason=${reason}: ${e.message}`);
        }
    }

    /**
     * 获取 Session 消息历史
     * @param {string} sessionId
     */
    async getSessionMessages(sessionId) {
        this._log('info', `getSessionMessages id=${sessionId}`);
        try {
            const messages = await this.client.session.messages({ path: { id: sessionId } });
            const data = messages.data || [];
            // 增量归档全量消息（首次拉取或补档），await 确保调用方能立即读取归档结果
            const archRes = await this.archive.appendMessages(
                sessionId,
                data.map(m => this._toArchiveMessage(m))
            ).catch(e => {
                this._log('warn', `getSessionMessages: 归档失败 id=${sessionId}: ${e.message}`);
                return { appended: 0, skipped: 0 };
            });
            this._log('debug', `getSessionMessages: 归档 appended=${archRes.appended} skipped=${archRes.skipped}`);
            return data;
        } catch (error) {
            this._log('error', `getSessionMessages 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to get session messages: ${error.message}`);
        }
    }

    /**
     * 实时查看当前对话消息（运行中安全调用）
     *
     * 从远端拉取当前已有消息并转为精简格式返回，**不写入本地存档**。
     * 适用于对话进行中查看 "目前聊了什么"，不影响后续归档去重。
     *
     * @param {string} sessionId
     * @returns {Promise<Array<{id,role,content,finish,timestamp}>>}
     */
    async getLiveMessages(sessionId) {
        this._log('info', `getLiveMessages id=${sessionId}`);
        try {
            const messages = await this.client.session.messages({ path: { id: sessionId } });
            const data = messages.data || [];
            return data.map(m => this._toArchiveMessage(m));
        } catch (error) {
            this._log('error', `getLiveMessages 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to get live messages: ${error.message}`);
        }
    }

    /**
     * 导出完整对话（合并远端 + 本地，支持运行中 / 已结束）
     *
     * 流程：
     *   1. 从远端拉取全量消息（运行中也能拿到已生成的部分）
     *   2. 增量归档到本地 jsonl（去重，补全运行中缺失的消息）
     *   3. 合并本地已归档消息，按 seq 排序
     *   4. 按 format 返回结构化结果
     *
     * @param {string} sessionId
     * @param {object} [opts]
     * @param {'json'|'markdown'} [opts.format='json'] - 导出格式
     * @returns {Promise<object|string>}
     *   format='json' → { sessionId, meta, messages: [...] }
     *   format='markdown' → Markdown 字符串
     */
    async exportSession(sessionId, opts = {}) {
        const format = opts.format || 'json';
        this._log('info', `exportSession id=${sessionId} format=${format}`);
        try {
            // 1. 远端拉取全量消息
            const messages = await this.client.session.messages({ path: { id: sessionId } });
            const data = messages.data || [];

            // 2. 增量归档（去重补档，运行中也能持久化已有消息）
            const archRes = await this.archive.appendMessages(
                sessionId,
                data.map(m => this._toArchiveMessage(m))
            ).catch(e => {
                this._log('warn', `exportSession: 归档失败 id=${sessionId}: ${e.message}`);
                return { appended: 0, skipped: 0 };
            });
            this._log('debug', `exportSession: 归档 appended=${archRes.appended} skipped=${archRes.skipped}`);

            // 3. 读本地归档（合并后按 seq 排序，确保完整且有序）
            const archivedMessages = await this.archive.readMessages(sessionId);
            const meta = await this.archive.readMeta(sessionId);
            const messages_sorted = archivedMessages.sort((a, b) => (a.seq || 0) - (b.seq || 0));

            // 4. 按格式输出
            if (format === 'markdown') {
                return this._toMarkdown(meta, messages_sorted);
            }
            return {
                sessionId,
                meta,
                messages: messages_sorted
            };
        } catch (error) {
            this._log('error', `exportSession 失败 id=${sessionId}: ${error.message}`);
            throw new Error(`Failed to export session: ${error.message}`);
        }
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
     * 读取本地已归档的消息（不请求远端，用于事后审计/对比）
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
        const prefix = '[OpenCodeCLI]';
        if (level === 'error') console.error(`❌ ${prefix} ${msg}`);
        else if (level === 'warn') console.warn(`⚠️  ${prefix} ${msg}`);
        else console.log(`ℹ️  ${prefix} ${msg}`);
    }
}

export default OpenCodeCLI;
