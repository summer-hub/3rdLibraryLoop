import StorageManager from './StorageManager.js';
import SessionStore from './stores/SessionStore.js';

/**
 * MessageArchive —— Session 对话消息存档服务（兼容门面）
 *
 * ⚠️ 本类现为 SessionStore 的薄代理，保留原构造签名与方法，使现有 CLI 适配器
 *    （OpenCodeCLI / CopilotCLI）的 `new MessageArchive()` 与 `this.archive.*`
 *    调用无需任何改动即可工作。
 *
 * 实际逻辑已迁入 stores/SessionStore.js，存储细节下沉到 adapters/ 层。
 * 新代码请直接使用 StorageManager + SessionStore（见 index.js 导出）。
 *
 * 原有存储布局保持不变：
 *   db/Session/
 *     ├── <sessionId>.jsonl        # 消息流（append-only）
 *     └── <sessionId>.meta.json    # 元信息
 */
class MessageArchive {
    /**
     * @param {object} [options]
     * @param {string} [options.baseDir] - 存档根目录（绝对路径）。默认相对本项目推导。
     * @param {number} [options.stallThresholdMs] - 判定"卡死/停滞"的阈值，默认 5 分钟
     * @param {StorageManager} [options.manager] - 已有的 StorageManager（复用根目录与实例缓存）
     */
    constructor(options = {}) {
        const stallThresholdMs = options.stallThresholdMs ?? 5 * 60 * 1000;

        // 复用传入的 manager，或自建一个（rootDir 兼容旧的 baseDir 指向 db/Session 的情形）
        let manager = options.manager;
        if (!manager) {
            manager = new StorageManager(
                options.baseDir
                    ? { rootDir: options.baseDir }
                    : {}
            );
        }

        // 通过 manager 获取 Session 子域的 jsonl / json 适配器
        this._store = new SessionStore({
            jsonl: manager.jsonl('Session'),
            json: manager.json('Session'),
            stallThresholdMs
        });
    }

    // ─── 代理到 SessionStore，保持原方法签名 ──────────────────────────────────

    async readMeta(sessionId) { return this._store.readMeta(sessionId); }
    async writeMeta(sessionId, meta) { return this._store.writeMeta(sessionId, meta); }
    async patchMeta(sessionId, patch) { return this._store.patchMeta(sessionId, patch); }
    async appendMessage(sessionId, message, opts) { return this._store.appendMessage(sessionId, message, opts); }
    async appendMessages(sessionId, messages) { return this._store.appendMessages(sessionId, messages); }
    async readMessages(sessionId) { return this._store.readMessages(sessionId); }
    async readLastMessage(sessionId) { return this._store.readLastMessage(sessionId); }
    async listSessions() { return this._store.listSessions(); }
    async recordCheck(sessionId, current) { return this._store.recordCheck(sessionId, current); }
    async deleteSession(sessionId) { return this._store.deleteSession(sessionId); }
}

export default MessageArchive;
