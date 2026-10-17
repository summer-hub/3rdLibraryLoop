/**
 * TaskRegistryStore —— 任务注册表（SQLite）
 *
 * 用途：为"历史任务列表"提供高性能分页查询。
 *
 * 背景：
 *   任务详情数据（loop.json / orchestration.json / stepid_*.json）以 JSON 文件
 *   存储在 db/task/{taskId}/ 下，单任务读写 O(1)，简单可靠。
 *   但历史列表若逐个扫描 JSON 文件，任务数超过数百后会出现明显卡顿
 *   （N 次 readFile + JSON.parse + 全量返回）。
 *
 * 方案：
 *   新增一张 SQLite 注册表，仅记录任务的"摘要信息"（taskId / 类型 / 状态 /
 *   时间 / 描述 / 摘要元数据），供列表查询使用：
 *     - 列表查询走 SQL 分页（LIMIT/OFFSET），不读任何 JSON 文件
 *     - COUNT 用 SELECT COUNT(*)，不加载全部数据
 *     - 任务详情仍从 JSON 文件读取（单文件 O(1)）
 *
 * 表结构 (task_registry)：
 *   task_id      TEXT PRIMARY KEY   - 任务 ID
 *   task_type    TEXT NOT NULL      - 任务类型（'loop' | 'orchestrator' | 'flexrunner' | ...）
 *   status       TEXT NOT NULL      - 状态（running / completed / failed / aborted / ...）
 *   title        TEXT               - 任务标题/描述（截断）
 *   description  TEXT               - 完整描述（可选）
 *   created_at   TEXT NOT NULL      - 创建时间（ISO）
 *   updated_at   TEXT               - 最后更新时间（ISO）
 *   metadata     TEXT               - 扩展摘要元数据（JSON 字符串，如评分、轮次等）
 *
 * 索引：created_at（列表排序）、status（状态过滤）
 *
 * 依赖 SqliteAdapter（better-sqlite3）。
 */
const DDL = `
CREATE TABLE IF NOT EXISTS task_registry (
    task_id     TEXT PRIMARY KEY,
    task_type   TEXT NOT NULL,
    status      TEXT NOT NULL,
    title       TEXT,
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT,
    metadata    TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_registry_created_at ON task_registry(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_registry_status ON task_registry(status);
`;

class TaskRegistryStore {
    /**
     * @param {object} options
     * @param {import('../adapters/SqliteAdapter.js').default} options.sqlite - SQLite 适配器
     */
    constructor(options = {}) {
        this.sqlite = options.sqlite;
        if (!this.sqlite) {
            throw new Error('TaskRegistryStore 需要 sqlite 适配器');
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
     * 注册（插入或更新）一条任务摘要。
     * 幂等：同一 taskId 重复调用会覆盖。
     *
     * @param {object} entry
     * @param {string} entry.taskId
     * @param {string} [entry.taskType='loop'] - 任务类型
     * @param {string} [entry.status='running'] - 状态
     * @param {string} [entry.title=''] - 标题/描述（截断到 200 字符）
     * @param {string} [entry.description=''] - 完整描述
     * @param {string} [entry.createdAt] - 创建时间（默认 now）
     * @param {object} [entry.metadata] - 扩展摘要元数据（会 JSON 序列化）
     * @returns {Promise<object>} 写入的条目
     */
    async upsert(entry) {
        await this._init();
        const now = new Date().toISOString();
        const row = {
            task_id: entry.taskId,
            task_type: entry.taskType || 'loop',
            status: entry.status || 'running',
            title: entry.title ? String(entry.title).slice(0, 200) : '',
            description: entry.description || '',
            created_at: entry.createdAt || now,
            updated_at: now,
            metadata: entry.metadata ? JSON.stringify(entry.metadata) : null
        };
        await this.sqlite.upsert('task_registry', row);
        return row;
    }

    /**
     * 更新任务状态（保留其他字段）。
     * @param {string} taskId
     * @param {object} patch - { status?, title?, description?, metadata? }
     * @returns {Promise<object|null>} 更新后的条目，不存在返回 null
     */
    async patch(taskId, patch) {
        await this._init();
        const existing = await this.get(taskId);
        if (!existing) return null;

        const next = {
            ...existing,
            ...patch,
            task_id: taskId,
            updated_at: new Date().toISOString()
        };
        if (next.metadata && typeof next.metadata === 'object') {
            next.metadata = JSON.stringify(next.metadata);
        }
        await this.sqlite.upsert('task_registry', next);
        return next;
    }

    /**
     * 按 taskId 查询单条摘要。
     * @param {string} taskId
     * @returns {Promise<object|null>}
     */
    async get(taskId) {
        await this._init();
        const row = await this.sqlite.get(
            'SELECT * FROM task_registry WHERE task_id = ?',
            [taskId]
        );
        return row ? this._deserialize(row) : null;
    }

    /**
     * 分页查询任务列表（按 created_at 降序）。
     * @param {object} [opts]
     * @param {number} [opts.page=1] - 页码，从 1 开始
     * @param {number} [opts.pageSize=20] - 每页条数
     * @param {string} [opts.status] - 可选，按状态过滤
     * @param {string} [opts.taskType] - 可选，按任务类型过滤
     * @param {string} [opts.taskIdPrefix] - 可选，按 taskId 前缀过滤（如 'fluttercheck_' / 'codecheck_'）
     * @returns {Promise<{ tasks: object[], total: number, page: number, pageSize: number, totalPages: number }>}
     */
    async listPage(opts = {}) {
        await this._init();
        const page = Math.max(1, opts.page || 1);
        const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
        const offset = (page - 1) * pageSize;

        const where = [];
        const params = [];
        if (opts.status) {
            where.push('status = ?');
            params.push(opts.status);
        }
        if (opts.taskType) {
            where.push('task_type = ?');
            params.push(opts.taskType);
        }
        if (opts.taskIdPrefix) {
            where.push("task_id LIKE ? ESCAPE '\\'");
            // LIKE 通配符转义：前缀中的 %/_ 按字面匹配
            params.push(String(opts.taskIdPrefix).replace(/([%_\\])/g, '\\$1') + '%');
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const countRow = await this.sqlite.get(
            `SELECT COUNT(*) AS total FROM task_registry ${whereSql}`,
            params
        );
        const total = countRow?.total ?? 0;

        const rows = await this.sqlite.all(
            `SELECT * FROM task_registry ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
        );

        return {
            tasks: rows.map(r => this._deserialize(r)),
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize))
        };
    }

    /**
     * 查询符合条件的全部 task_id（不分页），供跨页去重判断使用。
     *
     * listPage 只返回当前页的 ID，无法判断某 taskId 是否出现在其他页，
     * 因此提供本方法返回全量 ID 集合（与 listPage 使用相同的 where 过滤条件）。
     *
     * @param {object} [opts]
     * @param {string} [opts.status]
     * @param {string} [opts.taskType]
     * @param {string} [opts.taskIdPrefix]
     * @returns {Promise<string[]>}
     */
    async listIds(opts = {}) {
        await this._init();
        const where = [];
        const params = [];
        if (opts.status) {
            where.push('status = ?');
            params.push(opts.status);
        }
        if (opts.taskType) {
            where.push('task_type = ?');
            params.push(opts.taskType);
        }
        if (opts.taskIdPrefix) {
            where.push("task_id LIKE ? ESCAPE '\\'");
            params.push(String(opts.taskIdPrefix).replace(/([%_\\])/g, '\\$1') + '%');
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = await this.sqlite.all(
            `SELECT task_id FROM task_registry ${whereSql}`,
            params
        );
        return rows.map(r => r.task_id);
    }

    /**
     * 删除一条任务摘要。
     * @param {string} taskId
     * @returns {Promise<boolean>}
     */
    async delete(taskId) {
        await this._init();
        await this.sqlite.exec('DELETE FROM task_registry WHERE task_id = ?', [taskId]);
        return true;
    }

    /**
     * 获取任务总数（仅 COUNT，不加载数据）。
     * @returns {Promise<number>}
     */
    async count() {
        await this._init();
        const row = await this.sqlite.get('SELECT COUNT(*) AS total FROM task_registry');
        return row?.total ?? 0;
    }

    /** 反序列化：metadata JSON 字符串 → 对象 */
    _deserialize(row) {
        if (!row) return null;
        const out = { ...row };
        if (out.metadata) {
            try {
                out.metadata = JSON.parse(out.metadata);
            } catch {
                out.metadata = null;
            }
        }
        return out;
    }
}

export default TaskRegistryStore;
