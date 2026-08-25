import { randomUUID } from 'node:crypto';

/**
 * TaskStepStore —— 任务步骤持久化存储（SQLite）
 *
 * 用途：记录任务执行过程中的各个步骤信息，支持查询、状态流转、耗时统计。
 *
 * 表结构 (task_steps)：
 *   id          TEXT PRIMARY KEY      - 步骤唯一 ID（自动生成）
 *   task_id     TEXT NOT NULL          - 所属任务 ID
 *   seq         INTEGER NOT NULL       - 步骤序号（同任务内递增）
 *   name        TEXT                   - 步骤名称
 *   type        TEXT                   - 步骤类型（如 'cli'/'db'/'file'/'custom'）
 *   status      TEXT NOT NULL DEFAULT 'pending'  - pending/running/completed/error/skipped
 *   input       TEXT                   - 输入（JSON 字符串）
 *   output      TEXT                   - 输出（JSON 字符串）
 *   error       TEXT                   - 错误信息
 *   started_at  TEXT                   - 开始时间 ISO
 *   finished_at TEXT                   - 结束时间 ISO
 *   duration_ms INTEGER               - 耗时毫秒
 *   created_at  TEXT NOT NULL          - 创建时间 ISO
 *   updated_at  TEXT                   - 更新时间 ISO
 *   meta        TEXT                   - 扩展元信息（JSON 字符串）
 *
 * 索引：task_id、(task_id, seq)、status
 *
 * 依赖 SqliteAdapter（better-sqlite3）。
 */
const DDL = `
CREATE TABLE IF NOT EXISTS task_steps (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    name        TEXT,
    type        TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    input       TEXT,
    output      TEXT,
    error       TEXT,
    started_at  TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    created_at  TEXT NOT NULL,
    updated_at  TEXT,
    meta        TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_steps_task_id ON task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_task_steps_task_seq ON task_steps(task_id, seq);
CREATE INDEX IF NOT EXISTS idx_task_steps_status ON task_steps(status);
`;

class TaskStepStore {
    /**
     * @param {object} options
     * @param {import('../adapters/SqliteAdapter.js').default} options.sqlite - SQLite 适配器
     */
    constructor(options = {}) {
        this.sqlite = options.sqlite;
        if (!this.sqlite) {
            throw new Error('TaskStepStore 需要 sqlite 适配器');
        }
        this._initialized = false;
    }

    /** 幂等建表 */
    async _init() {
        if (this._initialized) return;
        await this.sqlite.exec(DDL);
        this._initialized = true;
    }

    /**
     * 创建一个任务步骤。
     * @param {object} step
     * @param {string} step.taskId
     * @param {string} [step.name]
     * @param {string} [step.type]
     * @param {string} [step.status='pending']
     * @param {object} [step.input]
     * @param {object} [step.meta]
     * @returns {Promise<object>} 创建后的步骤记录
     */
    async create(step) {
        await this._init();
        const now = new Date().toISOString();
        const id = step.id || randomUUID();
        const seq = await this._nextSeq(step.taskId);
        const row = {
            id,
            task_id: step.taskId,
            seq,
            name: step.name ?? null,
            type: step.type ?? null,
            status: step.status ?? 'pending',
            input: step.input != null ? JSON.stringify(step.input) : null,
            output: null,
            error: null,
            started_at: null,
            finished_at: null,
            duration_ms: null,
            created_at: now,
            updated_at: now,
            meta: step.meta != null ? JSON.stringify(step.meta) : null
        };
        await this.sqlite.upsert('task_steps', row);
        return this._rowToObj(row);
    }

    /** 获取同任务内下一个 seq */
    async _nextSeq(taskId) {
        const row = await this.sqlite.get(
            'SELECT MAX(seq) AS max_seq FROM task_steps WHERE task_id = ?',
            [taskId]
        );
        return (row?.max_seq ?? 0) + 1;
    }

    /**
     * 按 ID 获取步骤。
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async get(id) {
        await this._init();
        const row = await this.sqlite.get('SELECT * FROM task_steps WHERE id = ?', [id]);
        return row ? this._rowToObj(row) : null;
    }

    /**
     * 列出某任务的所有步骤（按 seq 升序）。
     * @param {string} taskId
     * @returns {Promise<Array<object>>}
     */
    async listByTask(taskId) {
        await this._init();
        const rows = await this.sqlite.all(
            'SELECT * FROM task_steps WHERE task_id = ? ORDER BY seq ASC',
            [taskId]
        );
        return rows.map(r => this._rowToObj(r));
    }

    /**
     * 按状态查询步骤。
     * @param {string} status
     * @returns {Promise<Array<object>>}
     */
    async listByStatus(status) {
        await this._init();
        const rows = await this.sqlite.all(
            'SELECT * FROM task_steps WHERE status = ? ORDER BY created_at ASC',
            [status]
        );
        return rows.map(r => this._rowToObj(r));
    }

    /**
     * 更新步骤状态（状态流转 + 时间戳 + 耗时）。
     * @param {string} id
     * @param {object} patch
     * @param {string} [patch.status]
     * @param {object} [patch.output]
     * @param {string} [patch.error]
     * @param {object} [patch.meta]
     * @returns {Promise<object|null>} 更新后的步骤
     */
    async update(id, patch) {
        await this._init();
        const now = new Date().toISOString();
        const updates = [];
        const params = [];

        if (patch.status) {
            updates.push('status = ?'); params.push(patch.status);
            // 状态流转时自动维护时间戳
            if (patch.status === 'running' && !patch.started_at) {
                updates.push('started_at = ?'); params.push(now);
            }
            if (['completed', 'error', 'skipped'].includes(patch.status) && !patch.finished_at) {
                updates.push('finished_at = ?'); params.push(now);
                // 计算耗时
                const cur = await this.get(id);
                if (cur?.startedAt) {
                    const dur = Date.parse(now) - Date.parse(cur.startedAt);
                    updates.push('duration_ms = ?'); params.push(dur);
                }
            }
        }
        if (patch.output != null) {
            updates.push('output = ?'); params.push(JSON.stringify(patch.output));
        }
        if (patch.error != null) {
            updates.push('error = ?'); params.push(patch.error);
        }
        if (patch.meta != null) {
            updates.push('meta = ?'); params.push(JSON.stringify(patch.meta));
        }
        if (updates.length === 0) return this.get(id);

        updates.push('updated_at = ?'); params.push(now);
        params.push(id);
        await this.sqlite.exec(
            `UPDATE task_steps SET ${updates.join(', ')} WHERE id = ?`,
            params
        );
        return this.get(id);
    }

    /**
     * 删除步骤。
     * @param {string} id
     */
    async delete(id) {
        await this._init();
        await this.sqlite.exec('DELETE FROM task_steps WHERE id = ?', [id]);
        return true;
    }

    /**
     * 删除某任务的所有步骤。
     * @param {string} taskId
     */
    async deleteByTask(taskId) {
        await this._init();
        await this.sqlite.exec('DELETE FROM task_steps WHERE task_id = ?', [taskId]);
        return true;
    }

    /**
     * 任务步骤统计（各状态数量）。
     * @param {string} taskId
     * @returns {Promise<object>} { total, pending, running, completed, error, skipped }
     */
    async stats(taskId) {
        await this._init();
        const rows = await this.sqlite.all(
            `SELECT status, COUNT(*) AS cnt FROM task_steps WHERE task_id = ? GROUP BY status`,
            [taskId]
        );
        const result = { total: 0, pending: 0, running: 0, completed: 0, error: 0, skipped: 0 };
        for (const r of rows) {
            result[r.status] = r.cnt;
            result.total += r.cnt;
        }
        return result;
    }

    // ─── 内部：行 → 业务对象（解包 JSON 字段，转驼峰）──────────────────────────

    _rowToObj(row) {
        return {
            id: row.id,
            taskId: row.task_id,
            seq: row.seq,
            name: row.name,
            type: row.type,
            status: row.status,
            input: this._parseJson(row.input),
            output: this._parseJson(row.output),
            error: row.error,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            durationMs: row.duration_ms,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            meta: this._parseJson(row.meta)
        };
    }

    _parseJson(s) {
        if (!s) return null;
        try { return JSON.parse(s); } catch { return s; }
    }
}

export default TaskStepStore;
