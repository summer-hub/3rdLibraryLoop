import { createLogger } from '../library/logger.js';

const logger = createLogger('SseHub');

/**
 * SseHub —— Server-Sent Events 推送中心
 *
 * 职责：按 channel（通常是 taskId）分组管理 SSE 连接，提供事件广播能力。
 * 与 HTTP 路由层解耦：路由层调用 subscribe/emit，业务层（Agent Loop）调用 emit。
 *
 * 设计要点（参考 AIWeb SSEEmitter）：
 *  - 按 channel 分组：多用户订阅同一任务，互不干扰
 *  - 全局单心跳：替代 N 个 per-channel 定时器，减少资源占用
 *  - 僵尸连接清理：超时自动移除，防止连接泄漏
 *  - 连接关闭感知：客户端断开时自动清理
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
 * @typedef {object} SseConnection
 * @property {import('node:http').ServerResponse} res  - 原始响应对象
 * @property {string} userId                            - 用户标识（用于限流）
 * @property {number} createdAt                         - 创建时间戳
 * @property {number} lastEventId                       - 最后推送的事件 ID
 */

const DEFAULT_HEARTBEAT_MS = 30000;    // 30 秒心跳
const DEFAULT_TIMEOUT_MS = 1800000;    // 30 分钟超时
const DEFAULT_CLEANUP_MS = 300000;     // 5 分钟清理一次
const DEFAULT_MAX_PER_USER = 10;       // 单用户最大连接数

class SseHub {
    /**
     * @param {object} [options]
     * @param {number} [options.heartbeatMs]    - 心跳间隔
     * @param {number} [options.timeoutMs]      - 连接超时
     * @param {number} [options.cleanupMs]      - 清理周期
     * @param {number} [options.maxPerUser]     - 单用户最大连接数
     */
    constructor(options = {}) {
        /** @type {Map<string, Set<SseConnection>>} */
        this._channels = new Map();
        /** @type {Map<string, number>} 用户连接数反向索引 */
        this._userCounts = new Map();
        /** 自增事件 ID */
        this._eventId = 0;

        this._heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
        this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this._maxPerUser = options.maxPerUser ?? DEFAULT_MAX_PER_USER;

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
            maxPerUser: this._maxPerUser
        });
    }

    // ─── 公开接口 ──────────────────────────────────────────────────────

    /**
     * 订阅 channel（注册 SSE 连接）
     * @param {string} channel - 频道名（通常为 taskId）
     * @param {import('node:http').ServerResponse} res
     * @param {object} [options]
     * @param {string} [options.userId='anonymous']
     * @param {object} [options.initialData] - 连接建立后立即推送的数据
     * @returns {{ ok: boolean, errorCode?: string, message?: string }}
     */
    subscribe(channel, res, options = {}) {
        const { userId = 'anonymous', initialData = null } = options;

        // 单用户限流
        const userCount = this._userCounts.get(userId) ?? 0;
        if (userCount >= this._maxPerUser) {
            logger.warn('用户连接数已达上限', { userId, count: userCount });
            return {
                ok: false,
                errorCode: 'E429_SSE_LIMIT',
                message: `用户连接数已达上限（${this._maxPerUser}）`
            };
        }

        const conn = {
            res,
            userId,
            createdAt: Date.now(),
            lastEventId: 0
        };

        // 注册到 channel
        if (!this._channels.has(channel)) {
            this._channels.set(channel, new Set());
        }
        this._channels.get(channel).add(conn);

        // 更新用户连接计数
        this._userCounts.set(userId, userCount + 1);

        // 客户端断开时自动清理
        res.on('close', () => {
            this._removeConnection(channel, conn);
        });

        // 立即推送初始数据（如有）
        if (initialData) {
            this._write(conn, 'connected', initialData);
        } else {
            // 发送连接确认事件
            this._write(conn, 'connected', { channel, timestamp: new Date().toISOString() });
        }

        return { ok: true };
    }

    /**
     * 向 channel 的所有订阅者推送事件
     * @param {string} channel  - 频道名
     * @param {string} eventType - 事件类型（如 'step:status'）
     * @param {object} data      - 事件数据（将被 JSON 序列化）
     */
    emit(channel, eventType, data) {
        const subscribers = this._channels.get(channel);
        if (!subscribers || subscribers.size === 0) {
            return; // 无订阅者，跳过
        }

        const eventId = ++this._eventId;
        const payload = this._formatSse(eventId, eventType, data);

        let sent = 0;
        for (const conn of subscribers) {
            if (this._isAlive(conn)) {
                conn.res.write(payload);
                conn.lastEventId = eventId;
                sent++;
            }
        }
    }

    /**
     * 关闭 channel 的所有连接
     * @param {string} channel
     */
    close(channel) {
        const subscribers = this._channels.get(channel);
        if (!subscribers) return;

        for (const conn of subscribers) {
            conn.res.end();
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
        let totalConnections = 0;
        let channelCount = 0;
        for (const [, subscribers] of this._channels) {
            totalConnections += subscribers.size;
            if (subscribers.size > 0) channelCount++;
        }
        return {
            totalConnections,
            channelCount,
            totalUsers: this._userCounts.size,
            lastEventId: this._eventId
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
        logger.info('SseHub 已销毁');
    }

    // ─── 内部方法 ──────────────────────────────────────────────────────

    /**
     * 向单个连接写入 SSE 数据
     */
    _write(conn, eventType, data) {
        const eventId = ++this._eventId;
        conn.res.write(this._formatSse(eventId, eventType, data));
        conn.lastEventId = eventId;
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
     */
    _broadcastHeartbeat() {
        const heartbeat = `: heartbeat ${Date.now()}\n\n`;
        for (const [channel, subscribers] of this._channels) {
            for (const conn of subscribers) {
                if (!this._isAlive(conn)) continue;
                try {
                    conn.res.write(heartbeat);
                } catch (e) {
                    // 写入失败说明连接已失效，立即清理，防止僵尸连接残留
                    this._removeConnection(channel, conn);
                    conn.res.end();
                }
            }
        }
    }

    /**
     * 清理超时僵尸连接
     */
    _cleanZombies() {
        const now = Date.now();
        for (const [channel, subscribers] of this._channels) {
            for (const conn of subscribers) {
                if (now - conn.createdAt > this._timeoutMs) {
                    logger.warn('清理僵尸 SSE 连接', {
                        channel,
                        userId: conn.userId,
                        age: now - conn.createdAt
                    });
                    this._removeConnection(channel, conn);
                    conn.res.end();
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
     * 移除连接并更新计数
     */
    _removeConnection(channel, conn) {
        const subscribers = this._channels.get(channel);
        if (!subscribers) return;
        subscribers.delete(conn);

        // 更新用户计数
        const count = this._userCounts.get(conn.userId) ?? 1;
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
