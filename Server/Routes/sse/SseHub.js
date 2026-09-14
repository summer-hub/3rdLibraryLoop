import { createLogger } from '../library/logger.js';

const logger = createLogger('SseHub');

/**
 * SseHub —— Server-Sent Events 推送中心
 *
 * 职责：按 channel（通常是 taskId）分组管理 SSE 连接，提供事件广播能力。
 * 与 HTTP 路由层解耦：路由层调用 subscribe/emit，业务层（Agent Loop）调用 emit。
 *
 * 设计要点：
 *  - 按 channel 分组：多用户订阅同一任务，互不干扰
 *  - 全局单心跳：替代 N 个 per-channel 定时器，减少资源占用
 *  - 僵尸连接清理：超时自动移除，防止连接泄漏
 *  - 连接关闭感知：客户端断开时自动清理
 *
 * F-09 背压保护（本文件的核心增强）：
 *   初版直接 `res.write(payload)` 且**忽略返回值**，也没有 drain/水位控制。
 *   而每帧又都是"全量进度快照"，于是一个不读数据的慢客户端会让 Node 在
 *   socket 写缓冲里无界堆积（几十 MB 起），M 个慢客户端即 O(M) 倍放大。
 *   现在：
 *     1. 检查 write() 返回值；返回 false 即进入背压态，改用**有界队列**承接；
 *     2. 背压期间，标记为可合并的事件（如全量进度快照）只保留最新一帧
 *        （旧帧本就已被更新帧取代，丢弃无信息损失）；
 *     3. 不可合并的事件进队列，队列长度/字节数超限即断开该慢客户端——
 *        宁可断掉一个读不动的订阅者，也不让进程内存无界增长；
 *     4. 注册 'drain' 与 'error' 监听：前者恢复发送，后者避免
 *        未监听的 error 事件把进程带崩。
 *
 * F-10 连接身份与准入（本次一并修正）：
 *   初版 `userId` 来自 query 参数且默认 'anonymous'，而前端 EventSource 并不传
 *   该参数 → 所有连接共享同一个 'anonymous'，使"单用户上限 10"实际变成
 *   **全进程 10 连接硬上限**；且被拒时因响应头已发出无法返回 429，
 *   还把 error 事件广播给了**别的**订阅者，被拒客户端只能看到"连上即断"，
 *   触发 EventSource 自动重连风暴。现在：
 *     - 新增 canSubscribe() 供路由层在**写响应头之前**做准入，超限返回真正的 429；
 *     - 每连接生成独立 connId，不再退化为共享常量身份；
 *     - 新增全局连接上限 maxTotalConnections 作为真正的保护边界；
 *     - _removeConnection 幂等（以 Set.delete 的返回值为准），修掉重复递减。
 *
 * 事件格式（SSE 协议）：
 *   id: <eventId>\n
 *   event: <eventType>\n
 *   data: <jsonString>\n\n
 *
 * 使用示例：
 *   // 路由层（StreamController）
 *   sseHub.subscribe(taskId, res, { userId: 'user1' });
 *
 *   // 业务层（Agent Loop）
 *   sseHub.emit(taskId, 'step:status', { stepId, status: 'running' });
 */

/**
 * @typedef {object} SseFrame
 * @property {number} eventId
 * @property {string} type
 * @property {string} payload - 已格式化的 SSE 文本
 * @property {number} bytes
 */

/**
 * @typedef {object} SseConnection
 * @property {import('node:http').ServerResponse} res  - 原始响应对象
 * @property {string} connId                            - 连接唯一标识（服务端生成，不信任客户端）
 * @property {string} userId                            - 用户标识（用于限流/展示）
 * @property {number} createdAt                         - 创建时间戳
 * @property {number} lastEventId                       - 最后推送的事件 ID
 * @property {boolean} backpressured                    - 是否处于背压态
 * @property {number} backpressuredSince                - 进入背压态的时间戳
 * @property {SseFrame|null} latestCoalesced            - 背压期间保留的最新可合并帧
 * @property {SseFrame[]} queued                        - 背压期间的不可合并帧队列
 * @property {number} queuedBytes                       - 队列字节数
 * @property {number} droppedFrames                     - 已丢弃帧数（可观测）
 */

const DEFAULT_HEARTBEAT_MS = 30000;    // 30 秒心跳
const DEFAULT_TIMEOUT_MS = 1800000;    // 30 分钟超时
const DEFAULT_CLEANUP_MS = 300000;     // 5 分钟清理一次
const DEFAULT_MAX_PER_USER = 10;       // 单用户最大连接数
const DEFAULT_MAX_TOTAL = 200;         // 全进程最大连接数（真正的保护边界）
const DEFAULT_MAX_QUEUED_FRAMES = 512; // 背压队列最大帧数
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024; // 背压队列最大字节数（4MB）
const DEFAULT_MAX_BACKPRESSURE_MS = 60000;          // 持续背压多久后断开慢客户端

/**
 * 可合并事件类型：这些事件携带的是"全量快照"，后一帧完全取代前一帧，
 * 背压期间只保留最新一帧不会丢信息。其余事件（增量/一次性）一律保序排队。
 */
const COALESCIBLE_EVENTS = new Set([
    'orch:task:progress',
    'loop:progress',
]);

class SseHub {
    /**
     * @param {object} [options]
     * @param {number} [options.heartbeatMs]        - 心跳间隔
     * @param {number} [options.timeoutMs]          - 连接超时
     * @param {number} [options.cleanupMs]          - 清理周期
     * @param {number} [options.maxPerUser]         - 单用户最大连接数
     * @param {number} [options.maxTotalConnections]- 全局最大连接数
     * @param {number} [options.maxQueuedFrames]    - 单连接背压队列最大帧数
     * @param {number} [options.maxBufferedBytes]   - 单连接背压队列最大字节数
     * @param {number} [options.maxBackpressureMs]  - 持续背压多久后断开慢客户端
     */
    constructor(options = {}) {
        /** @type {Map<string, Set<SseConnection>>} */
        this._channels = new Map();
        /** @type {Map<string, number>} 用户连接数反向索引 */
        this._userCounts = new Map();
        /** 自增事件 ID */
        this._eventId = 0;
        /** 自增连接 ID */
        this._connSeq = 0;
        /** 全进程连接总数（等于各 channel 连接数之和，独立计数避免遍历） */
        this._totalConnections = 0;
        /** 累计因背压丢弃的帧数（可观测性） */
        this._totalDroppedFrames = 0;
        /** 累计因背压被断开的慢客户端数（可观测性） */
        this._totalDroppedConnections = 0;

        this._heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
        this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this._maxPerUser = options.maxPerUser ?? DEFAULT_MAX_PER_USER;
        this._maxTotal = options.maxTotalConnections ?? DEFAULT_MAX_TOTAL;
        this._maxQueuedFrames = options.maxQueuedFrames ?? DEFAULT_MAX_QUEUED_FRAMES;
        this._maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
        this._maxBackpressureMs = options.maxBackpressureMs ?? DEFAULT_MAX_BACKPRESSURE_MS;

        // 全局单心跳
        this._heartbeatTimer = setInterval(
            () => this._broadcastHeartbeat(),
            this._heartbeatMs
        );
        this._heartbeatTimer.unref?.();

        // 僵尸连接清理
        this._cleanupTimer = setInterval(
            () => this._cleanZombies(),
            options.cleanupMs ?? DEFAULT_CLEANUP_MS
        );
        this._cleanupTimer.unref?.();

        logger.info('SseHub 已初始化', {
            heartbeatMs: this._heartbeatMs,
            timeoutMs: this._timeoutMs,
            maxPerUser: this._maxPerUser,
            maxTotalConnections: this._maxTotal,
            maxQueuedFrames: this._maxQueuedFrames,
            maxBufferedBytes: this._maxBufferedBytes,
        });
    }

    // ─── 公开接口 ──────────────────────────────────────────────────────

    /**
     * 准入判定（F-10）：供路由层在**写响应头之前**调用，以便超限时返回真正的 429。
     *
     * 注意：本方法只做判定，注册动作由随后的 subscribe() 完成。两者之间没有
     * await，Node 单线程下不会被其它请求插入，因此不存在 TOCTOU 超发。
     *
     * @param {string} [userId='anonymous']
     * @returns {{ok: boolean, errorCode?: string, message?: string}}
     */
    canSubscribe(userId = 'anonymous') {
        if (this._totalConnections >= this._maxTotal) {
            return {
                ok: false,
                errorCode: 'E429_SSE_TOTAL_LIMIT',
                message: `SSE 连接总数已达上限（${this._maxTotal}）`
            };
        }
        const userCount = this._userCounts.get(userId) ?? 0;
        if (userCount >= this._maxPerUser) {
            return {
                ok: false,
                errorCode: 'E429_SSE_LIMIT',
                message: `用户连接数已达上限（${this._maxPerUser}）`
            };
        }
        return { ok: true };
    }

    /**
     * 订阅 channel（注册 SSE 连接）
     *
     * 调用前应先经 canSubscribe() 判定；本方法内部仍会再判一次并拒绝超限，
     * 用于防御直接调用（此时响应头可能已发出，由调用方按需处理）。
     *
     * @param {string} channel - 频道名（通常为 taskId）
     * @param {import('node:http').ServerResponse} res
     * @param {object} [options]
     * @param {string} [options.userId='anonymous']
     * @param {object} [options.initialData] - 连接建立后立即推送的数据
     * @returns {{ ok: boolean, errorCode?: string, message?: string, connId?: string }}
     */
    subscribe(channel, res, options = {}) {
        const { userId = 'anonymous', initialData = null } = options;

        const admission = this.canSubscribe(userId);
        if (!admission.ok) {
            logger.warn('SSE 订阅被拒', { userId, channel, total: this._totalConnections });
            return admission;
        }

        const connId = `sse-${++this._connSeq}`;
        /** @type {SseConnection} */
        const conn = {
            res,
            connId,
            userId,
            createdAt: Date.now(),
            lastEventId: 0,
            backpressured: false,
            backpressuredSince: 0,
            latestCoalesced: null,
            queued: [],
            queuedBytes: 0,
            droppedFrames: 0,
        };

        // 注册到 channel
        if (!this._channels.has(channel)) {
            this._channels.set(channel, new Set());
        }
        this._channels.get(channel).add(conn);
        conn.channel = channel;

        // 更新计数
        this._userCounts.set(userId, (this._userCounts.get(userId) ?? 0) + 1);
        this._totalConnections++;

        // 客户端断开时自动清理
        res.on('close', () => {
            this._removeConnection(channel, conn);
        });
        // F-09：未监听的 'error' 事件会让 EventEmitter 抛出并可能终止进程。
        // 只监听不处理会掩盖问题，因此记录后按断连处理。
        res.on('error', (err) => {
            logger.warn('SSE 连接错误', { channel, connId, error: err?.message });
            this._removeConnection(channel, conn);
        });
        // F-09：背压恢复
        res.on('drain', () => this._onDrain(conn));

        // 立即推送初始数据（如有）
        if (initialData) {
            this._write(conn, 'connected', initialData);
        } else {
            // 发送连接确认事件
            this._write(conn, 'connected', { channel, timestamp: new Date().toISOString() });
        }

        return { ok: true, connId };
    }

    /**
     * 向 channel 的所有订阅者推送事件
     *
     * F-09：返回值为本次实际写入的订阅者数（含入队数），便于调用方观测。
     *
     * @param {string} channel  - 频道名
     * @param {string} eventType - 事件类型（如 'step:status'）
     * @param {object} data      - 事件数据（将被 JSON 序列化）
     * @returns {number} 送达（写入或入队）的连接数
     */
    emit(channel, eventType, data) {
        const subscribers = this._channels.get(channel);
        if (!subscribers || subscribers.size === 0) {
            return 0; // 无订阅者，跳过
        }

        const eventId = ++this._eventId;
        const payload = this._formatSse(eventId, eventType, data);
        const frame = { eventId, type: eventType, payload, bytes: Buffer.byteLength(payload) };

        let sent = 0;
        for (const conn of subscribers) {
            if (!this._isAlive(conn)) continue;
            if (conn.backpressured) {
                this._enqueue(conn, frame);
            } else {
                this._rawWrite(conn, frame);
            }
            sent++;
        }
        return sent;
    }

    /**
     * 关闭 channel 的所有连接
     * @param {string} channel
     */
    close(channel) {
        const subscribers = this._channels.get(channel);
        if (!subscribers) return;

        // 先逐个走正规移除流程（维护计数），再清空 channel——
        // 初版直接 end() + delete(channel) 会让 _userCounts 永久虚高。
        for (const conn of [...subscribers]) {
            this._removeConnection(channel, conn);
            try { conn.res.end(); } catch { /* 已断开 */ }
        }
        this._channels.delete(channel);
        logger.info('SSE channel 已关闭', { channel });
    }

    /**
     * 返回 channel 的当前订阅者数量
     */
    subscriberCount(channel) {
        return this._channels.get(channel)?.size ?? 0;
    }

    /**
     * 返回全局统计信息
     */
    getStats() {
        let channelCount = 0;
        let backpressured = 0;
        let queuedFrames = 0;
        for (const [, subscribers] of this._channels) {
            if (subscribers.size > 0) channelCount++;
            for (const conn of subscribers) {
                if (conn.backpressured) backpressured++;
                queuedFrames += conn.queued.length + (conn.latestCoalesced ? 1 : 0);
            }
        }
        return {
            totalConnections: this._totalConnections,
            channelCount,
            totalUsers: this._userCounts.size,
            lastEventId: this._eventId,
            // F-09 可观测性：背压与丢弃情况
            backpressured,
            queuedFrames,
            maxTotalConnections: this._maxTotal,
            maxPerUser: this._maxPerUser,
            totalDroppedFrames: this._totalDroppedFrames,
            totalDroppedConnections: this._totalDroppedConnections,
        };
    }

    /**
     * 销毁 SseHub，释放所有定时器和连接
     */
    destroy() {
        clearInterval(this._heartbeatTimer);
        clearInterval(this._cleanupTimer);
        for (const [channel] of this._channels) {
            this.close(channel);
        }
        this._channels.clear();
        this._userCounts.clear();
        this._totalConnections = 0;
        logger.info('SseHub 已销毁');
    }

    // ─── 内部方法：写入与背压 ───────────────────────────────────────────

    /**
     * 直接写入一帧（不做背压判断，由调用方保证不在背压态）。
     * @param {SseConnection} conn
     * @param {SseFrame} frame
     * @private
     */
    _rawWrite(conn, frame) {
        let ok = false;
        try {
            ok = conn.res.write(frame.payload);
        } catch (err) {
            this._dropSlowConnection(conn, `写入异常: ${err.message}`);
            return;
        }
        conn.lastEventId = frame.eventId;
        if (!ok) {
            // 返回 false 表示内核/Node 缓冲已超水位：停止继续写入，转入有界队列
            conn.backpressured = true;
            if (!conn.backpressuredSince) conn.backpressuredSince = Date.now();
        }
    }

    /**
     * 背压期间承接一帧：可合并事件只留最新，其余进有界队列。
     * @param {SseConnection} conn
     * @param {SseFrame} frame
     * @private
     */
    _enqueue(conn, frame) {
        if (COALESCIBLE_EVENTS.has(frame.type)) {
            if (conn.latestCoalesced) {
                conn.droppedFrames++;
                this._totalDroppedFrames++;
            }
            conn.latestCoalesced = frame;
            return;
        }

        if (conn.queued.length >= this._maxQueuedFrames
            || conn.queuedBytes + frame.bytes > this._maxBufferedBytes) {
            // 保护进程：慢客户端不能把内存拖垮
            this._dropSlowConnection(conn,
                `背压队列超限（帧数=${conn.queued.length}, 字节=${conn.queuedBytes}）`);
            return;
        }
        conn.queued.push(frame);
        conn.queuedBytes += frame.bytes;
    }

    /**
     * 收到 drain：退出背压态并尽快排空队列。
     * @param {SseConnection} conn
     * @private
     */
    _onDrain(conn) {
        if (!conn.backpressured) return;
        conn.backpressured = false;
        conn.backpressuredSince = 0;
        this._flushConnection(conn);
    }

    /**
     * 排空单连接的待发帧：先保序发不可合并队列，再发（更新的）合并快照。
     * @param {SseConnection} conn
     * @private
     */
    _flushConnection(conn) {
        while (conn.queued.length > 0) {
            const frame = conn.queued.shift();
            conn.queuedBytes -= frame.bytes;
            this._rawWrite(conn, frame);
            if (conn.backpressured || !this._isAlive(conn)) return;
        }
        if (conn.latestCoalesced) {
            const frame = conn.latestCoalesced;
            conn.latestCoalesced = null;
            this._rawWrite(conn, frame);
        }
    }

    /**
     * 断开读不动的慢客户端（而非放任其无界占内存）。
     * @param {SseConnection} conn
     * @param {string} reason
     * @private
     */
    _dropSlowConnection(conn, reason) {
        this._totalDroppedConnections++;
        logger.warn('断开慢速 SSE 客户端', {
            channel: conn.channel, connId: conn.connId, reason,
            droppedFrames: conn.droppedFrames,
        });
        this._removeConnection(conn.channel, conn);
        try { conn.res.end(); } catch { /* 已断开 */ }
    }

    // ─── 内部方法：通用 ────────────────────────────────────────────────

    /**
     * 向单个连接写入 SSE 数据（非 emit 路径，如初始 connected 事件）
     */
    _write(conn, eventType, data) {
        const eventId = ++this._eventId;
        const payload = this._formatSse(eventId, eventType, data);
        this._rawWrite(conn, {
            eventId, type: eventType, payload, bytes: Buffer.byteLength(payload),
        });
    }

    /**
     * 格式化 SSE 消息
     */
    _formatSse(eventId, eventType, data) {
        const json = typeof data === 'string' ? data : JSON.stringify(data);
        return `id: ${eventId}\nevent: ${eventType}\ndata: ${json}\n\n`;
    }

    /**
     * 全局心跳：向所有连接发送注释行（保持连接活跃）
     *
     * 心跳是"保活"手段而非数据，背压态下直接跳过——
     * 给读不动的客户端继续堆心跳只会加速内存增长。
     */
    _broadcastHeartbeat() {
        const heartbeat = `: heartbeat ${Date.now()}\n\n`;
        for (const [channel, subscribers] of this._channels) {
            for (const conn of [...subscribers]) {
                if (!this._isAlive(conn)) continue;
                if (conn.backpressured) continue;
                try {
                    conn.res.write(heartbeat);
                } catch (err) {
                    // 写入失败说明连接已失效，立即清理，防止僵尸连接残留
                    logger.warn('心跳写入失败，清理连接', { channel, error: err?.message });
                    this._removeConnection(channel, conn);
                    try { conn.res.end(); } catch { /* 已断开 */ }
                }
            }
        }
    }

    /**
     * 清理超时僵尸连接与持续背压的慢连接
     */
    _cleanZombies() {
        const now = Date.now();
        for (const [channel, subscribers] of this._channels) {
            for (const conn of [...subscribers]) {
                if (now - conn.createdAt > this._timeoutMs) {
                    logger.warn('清理僵尸 SSE 连接', {
                        channel,
                        connId: conn.connId,
                        userId: conn.userId,
                        age: now - conn.createdAt
                    });
                    this._removeConnection(channel, conn);
                    try { conn.res.end(); } catch { /* 已断开 */ }
                    continue;
                }
                // 长时间背压未恢复 → 判定为读不动的客户端，主动断开
                if (conn.backpressured && conn.backpressuredSince
                    && now - conn.backpressuredSince > this._maxBackpressureMs) {
                    this._dropSlowConnection(conn,
                        `持续背压超过 ${this._maxBackpressureMs}ms 未恢复`);
                }
            }
        }
    }

    /**
     * 检查连接是否仍然存活
     */
    _isAlive(conn) {
        return !conn.res.writableEnded && !conn.res.destroyed;
    }

    /**
     * 移除连接并更新计数。
     *
     * F-10：以 Set.delete 的返回值为准做幂等保护。
     * 初版无条件递减，而同一连接可能因 close / 僵尸清理 / 心跳失败等多条路径
     * 重复进入本方法，导致 _userCounts 被重复递减（计数漂移 → 限额失真）。
     *
     * @param {string} channel
     * @param {SseConnection} conn
     * @private
     */
    _removeConnection(channel, conn) {
        const subscribers = this._channels.get(channel);
        if (!subscribers) return;
        // 已移除过（或不属于本 channel）→ 直接返回，避免重复递减
        if (!subscribers.delete(conn)) return;

        if (this._totalConnections > 0) this._totalConnections--;

        // 更新用户计数
        const count = this._userCounts.get(conn.userId) ?? 0;
        if (count <= 1) {
            this._userCounts.delete(conn.userId);
        } else {
            this._userCounts.set(conn.userId, count - 1);
        }

        // channel 空了就移除
        if (subscribers.size === 0) {
            this._channels.delete(channel);
        }
    }
}

export default SseHub;
export { COALESCIBLE_EVENTS };
