import { promises as fs } from 'node:fs';
import { nowCST } from '../../../../core/cstTime.js';

/**
 * SessionStore —— Session 对话消息存档与卡死检测
 *
 * 组合两个适配器：
 *   - JsonlAdapter (subDir=Session)：消息流（append-only）
 *   - JsonAdapter  (subDir=Session)：元信息 meta.json
 *
 * 职责：
 *   1. 追加归档消息（带去重）
 *   2. 维护 meta（lastResponseAt / lastMessageId / status / archivedCount）
 *   3. 轮询时记录检查，计算停滞时长，判定 stalled（卡死）
 *   4. 读取已归档消息/元信息
 *
 * 这是原 MessageArchive 的业务逻辑迁入，存储细节下沉到适配器层。
 */
class SessionStore {
    /**
     * @param {object} options
     * @param {import('../adapters/JsonlAdapter.js').default} options.jsonl - 消息流适配器
     * @param {import('../adapters/JsonAdapter.js').default} options.json  - 元信息适配器
     * @param {number} [options.stallThresholdMs] - 卡死判定阈值，默认 5 分钟
     */
    constructor(options = {}) {
        this.jsonl = options.jsonl;
        this.json = options.json;
        if (!this.jsonl || !this.json) {
            throw new Error('SessionStore 需要 jsonl 与 json 适配器');
        }
        this.stallThresholdMs = options.stallThresholdMs ?? 5 * 60 * 1000;
    }

    // ─── 元信息 ────────────────────────────────────────────────────────────────

    async readMeta(sessionId) {
        const meta = await this.json.read(`${sessionId}.meta`);
        return meta ?? this._defaultMeta(sessionId);
    }

    async writeMeta(sessionId, meta) {
        return this.json.write(`${sessionId}.meta`, meta);
    }

    async patchMeta(sessionId, patch) {
        const meta = await this.readMeta(sessionId);
        const next = { ...meta, ...patch };
        await this.writeMeta(sessionId, next);
        return next;
    }

    _defaultMeta(sessionId) {
        return {
            sessionId,
            title: null,
            cliType: null,
            createdAt: nowCST(),
            status: 'idle',
            lastMessageId: null,
            lastResponseAt: null,
            lastCheckAt: null,
            archivedCount: 0
        };
    }

    // ─── 消息归档 ──────────────────────────────────────────────────────────────

    /**
     * 读取已归档消息的 ID 集合（用于去重）。
     * @param {string} sessionId
     * @returns {Promise<Set<string>>}
     */
    async _readArchivedIds(sessionId) {
        const messages = await this.jsonl.read(sessionId);
        const ids = new Set();
        for (const msg of messages) {
            if (msg.id != null) ids.add(String(msg.id));
        }
        return ids;
    }

    /**
     * 追加一条消息（带去重）。
     *
     * 去重策略：先检查 meta.lastMessageId（快速路径），
     * 再读取已归档 ID 集合做完整检查（防止非末尾消息重复）。
     *
     * 注意：批量归档请用 appendMessages（O(N) 批量优化），
     * 本方法每次调用都会读取整个 jsonl 做去重，逐条调用为 O(N²)。
     *
     * @param {string} sessionId
     * @param {object} message
     * @param {object} [opts]
     * @param {string} [opts.dedupeKey] - 自定义去重键（默认用 message.id）
     * @returns {Promise<{appended: boolean, seq: number, message: object}>}
     */
    async appendMessage(sessionId, message, opts = {}) {
        const meta = await this.readMeta(sessionId);
        const dedupeKey = String(opts.dedupeKey ?? message.id ?? '');

        // 快速路径：与 lastMessageId 相同则跳过
        if (dedupeKey && meta.lastMessageId === dedupeKey) {
            return { appended: false, seq: meta.archivedCount, message };
        }

        // 完整检查：读取已归档 ID 集合，防止非末尾消息重复
        if (dedupeKey) {
            const archivedIds = await this._readArchivedIds(sessionId);
            if (archivedIds.has(dedupeKey)) {
                return { appended: false, seq: meta.archivedCount, message };
            }
        }

        const seq = (meta.archivedCount || 0) + 1;
        const record = { seq, ...message, archivedAt: nowCST() };
        await this.jsonl.append(sessionId, record);

        // 直接写 meta（避免 patchMeta 内部重复 readMeta）
        const next = {
            ...meta,
            archivedCount: seq,
            lastMessageId: dedupeKey || meta.lastMessageId
        };
        if (message.role === 'assistant') {
            next.lastResponseAt = record.archivedAt;
        }
        await this.writeMeta(sessionId, next);

        return { appended: true, seq, message: record };
    }

    /**
     * 批量追加消息（带去重）。
     *
     * 优化：只读取 1 次 meta + 1 次 jsonl 做全量去重，
     * 过滤后用 appendBatch 一次性写入，再 patch 1 次 meta。
     * 复杂度 O(N) 而非逐条 appendMessage 的 O(N²)。
     *
     * @param {string} sessionId
     * @param {Array<object>} messages
     * @returns {Promise<{appended: number, skipped: number}>}
     */
    async appendMessages(sessionId, messages) {
        if (!messages.length) return { appended: 0, skipped: 0 };

        // 1. 读 meta 一次
        const meta = await this.readMeta(sessionId);

        // 2. 读已归档 ID 集合一次
        const archivedIds = await this._readArchivedIds(sessionId);

        // 3. 内存中去重，收集新消息
        const newMessages = [];
        for (const msg of messages) {
            const dedupeKey = String(msg.id ?? '');
            if (dedupeKey && (meta.lastMessageId === dedupeKey || archivedIds.has(dedupeKey))) {
                continue; // 跳过重复
            }
            if (dedupeKey) archivedIds.add(dedupeKey); // 防止本批次内重复
            newMessages.push(msg);
        }

        if (newMessages.length === 0) {
            return { appended: 0, skipped: messages.length };
        }

        // 4. 构造记录（seq 连续递增）
        let seq = meta.archivedCount || 0;
        const now = nowCST();
        const records = newMessages.map(msg => {
            seq++;
            return { seq, ...msg, archivedAt: now };
        });

        // 5. 批量写入 jsonl（一次 I/O）
        await this.jsonl.appendBatch(sessionId, records);

        // 6. 写 meta 一次
        const next = { ...meta, archivedCount: seq };
        const lastRecord = records[records.length - 1];
        const lastDedupeKey = String(lastRecord.id ?? '');
        if (lastDedupeKey) {
            next.lastMessageId = lastDedupeKey;
        }
        // lastResponseAt 取最后一条 assistant 消息的 archivedAt
        const lastAssistant = [...records].reverse().find(r => r.role === 'assistant');
        if (lastAssistant) {
            next.lastResponseAt = lastAssistant.archivedAt;
        }
        await this.writeMeta(sessionId, next);

        return { appended: records.length, skipped: messages.length - records.length };
    }

    // ─── 读取 ──────────────────────────────────────────────────────────────────

    async readMessages(sessionId) {
        return this.jsonl.read(sessionId);
    }

    async readLastMessage(sessionId) {
        const msgs = await this.readMessages(sessionId);
        return msgs.length > 0 ? msgs[msgs.length - 1] : null;
    }

    async listSessions() {
        const metas = [];
        const items = await this.json.list();
        for (const { key, data } of items) {
            if (key.endsWith('.meta')) {
                metas.push(data);
            }
        }
        return metas.sort((a, b) =>
            (b.createdAt || '').localeCompare(a.createdAt || '')
        );
    }

    // ─── 卡死检测 ──────────────────────────────────────────────────────────────

    /**
     * 记录一次轮询检查并计算停滞时长。
     *
     * 注意：本方法只更新 lastCheckAt / lastResponseAt / status，
     *       **不更新 lastMessageId**（那是 appendMessage 的职责）。
     *       这样在 checkSessionStatus 中先 recordCheck 后 appendMessage 时，
     *       appendMessage 仍能正确检测重复。
     *
     * @param {string} sessionId
     * @param {object} [current]
     * @param {string} [current.lastMessageId] - 当前最新消息 ID（用于对比判断是否有新消息）
     * @param {string} [current.status]
     * @returns {Promise<object>} { status, stallDurationMs, stalled, hasNewMessage, meta }
     */
    async recordCheck(sessionId, current = {}) {
        const now = Date.now();
        const meta = await this.readMeta(sessionId);
        const nowCstStr = nowCST(now);

        const currentId = current.lastMessageId ?? null;
        const hasNewMessage = currentId != null && currentId !== meta.lastMessageId;

        const patch = { lastCheckAt: nowCstStr };
        // 有新消息时刷新 lastResponseAt（用于停滞计时），
        // 但不更新 lastMessageId —— 交给 appendMessage 负责
        if (hasNewMessage) {
            patch.lastResponseAt = nowCstStr;
        }
        if (current.status) {
            patch.status = current.status;
        }
        const next = await this.patchMeta(sessionId, patch);

        const lastRespMs = next.lastResponseAt ? Date.parse(next.lastResponseAt) : null;
        const stallDurationMs = lastRespMs != null ? (now - lastRespMs) : null;
        const stalled =
            (current.status === 'running') &&
            stallDurationMs != null &&
            stallDurationMs >= this.stallThresholdMs;

        return {
            status: stalled ? 'stalled' : (current.status || next.status || 'unknown'),
            stallDurationMs,
            stalled,
            hasNewMessage,
            meta: next
        };
    }

    async deleteSession(sessionId) {
        await Promise.all([
            this.jsonl.delete(sessionId),
            this.json.delete(`${sessionId}.meta`)
        ]);
    }
}

export default SessionStore;
