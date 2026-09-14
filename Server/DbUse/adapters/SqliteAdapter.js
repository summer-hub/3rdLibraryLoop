import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import BaseAdapter from './BaseAdapter.js';

/**
 * SqliteAdapter —— SQLite（better-sqlite3）存储适配器
 *
 * 用途：结构化、需要查询/索引/事务的大量记录存储，如任务步骤、执行记录。
 *
 * 特性：
 *   - 同步 API（better-sqlite3 为同步），通过 async 包装保持接口一致
 *   - 懒加载数据库连接，首次操作时打开
 *   - 预编译 statement 缓存，提升重复执行性能
 *   - 支持 upsert（INSERT OR REPLACE）
 *
 * 依赖：better-sqlite3（需 npm 安装）
 *
 * 注意：better-sqlite3 为同步原生绑定，导入失败时会给出清晰提示。
 */
let _Database = null;
async function loadDatabase() {
    if (_Database) return _Database;
    try {
        const mod = await import('better-sqlite3');
        _Database = mod.default || mod.Database;
        return _Database;
    } catch (err) {
        throw new Error(
            '未安装 better-sqlite3。请在项目根目录执行: npm install better-sqlite3'
        );
    }
}

/** 默认写锁等待（ms），可由环境变量 SQLITE_BUSY_TIMEOUT_MS 覆盖 */
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * 解析 busy_timeout（F-17）。非法值或负值回退默认，避免配成 0 时退化为"立即失败"。
 * @returns {number}
 */
function resolveBusyTimeoutMs() {
    const n = parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUSY_TIMEOUT_MS;
}

class SqliteAdapter extends BaseAdapter {
    constructor(options = {}) {
        super(options);
        this._dbName = options.dbName || 'store.db';
        this._db = null;
        this._stmtCache = new Map();
        this._ready = null;
    }

    get type() {
        return 'sqlite';
    }

    /**
     * 懒加载并打开数据库连接。
     * @returns {Promise<import('better-sqlite3').Database>}
     */
    async _ready_() {
        if (!this._ready) {
            this._ready = (async () => {
                const Database = await loadDatabase();
                await this.ensureDir();
                const dbPath = this.pathSync(this._dbName);
                this._db = new Database(dbPath);
                // 性能优化：WAL 模式 + 同步策略
                this._db.pragma('journal_mode = WAL');
                this._db.pragma('synchronous = NORMAL');
                // F-17：写锁等待时间。默认为 0 时，遇到其它连接持写锁会**立即**
                // 抛 SQLITE_BUSY，而调用方（如 Orchestrator._persistStepDb）通常
                // 用 try/catch 静默吞掉，表现为"步骤记录莫名不落库"。
                // 设为有界等待后，并发写会排队而不是直接失败。
                // 注意：仅缓解同进程/同机多连接竞争，跨机共享数据库文件仍不建议。
                this._db.pragma(`busy_timeout = ${resolveBusyTimeoutMs()}`);
                return this._db;
            })();
        }
        return this._ready;
    }

    /**
     * 取得（并缓存）预编译语句。
     *
     * F-18：`_stmtCache` 此前只被声明与清空、从未写入，即文档宣传的
     * "预编译 statement 缓存"实际不存在，每次调用都在 `prepare` 同一 SQL。
     * better-sqlite3 的 `prepare` 有实际开销（解析+编译），而本项目存在
     * **高频热路径**（每个步骤的 running/终态都要写 task_steps），因此这里
     * 真正把缓存用起来。
     *
     * 生命周期：缓存与连接同生命周期，`close()` 时清空（见 close()）。
     *
     * @param {string} sql
     * @returns {import('better-sqlite3').Statement}
     * @private
     */
    async _stmt(sql) {
        const db = await this._ready_();
        let stmt = this._stmtCache.get(sql);
        if (!stmt) {
            stmt = db.prepare(sql);
            this._stmtCache.set(sql, stmt);
        }
        return stmt;
    }

    /** 预编译语句缓存条目数（供测试/观测） */
    get stmtCacheSize() {
        return this._stmtCache.size;
    }

    /**
     * 执行无返回值的 SQL（DDL/DML），可带参数。
     * @param {string} sql
     * @param {Array} [params]
     */
    async exec(sql, params) {
        if (params) {
            const stmt = await this._stmt(sql);
            stmt.run(...params);
        } else {
            // 无参数的 DDL/多语句：走 db.exec（支持分号分隔的多条语句，
            // prepared statement 不支持多语句，故不缓存）
            const db = await this._ready_();
            db.exec(sql);
        }
    }

    /**
     * 执行查询并返回所有匹配行。
     * @param {string} sql
     * @param {Array} [params]
     * @returns {Promise<Array<object>>}
     */
    async all(sql, params = []) {
        const stmt = await this._stmt(sql);
        return stmt.all(...params);
    }

    /**
     * 执行查询并返回首行。
     * @param {string} sql
     * @param {Array} [params]
     * @returns {Promise<object|undefined>}
     */
    async get(sql, params = []) {
        const stmt = await this._stmt(sql);
        return stmt.get(...params);
    }

    /**
     * upsert：存在则替换，不存在则插入。
     * 要求表有主键或唯一约束。
     * @param {string} table
     * @param {object} row - 列名→值
     */
    async upsert(table, row) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(', ');
        const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
        const stmt = await this._stmt(sql);
        stmt.run(...cols.map(c => row[c]));
        return row;
    }

    /**
     * 在事务中执行多个写操作（better-sqlite3 同步事务）。
     *
     * @param {Function} fn - 事务体，必须是**完全同步**的（见下方说明与 getDb()）
     * @param {object} [opts]
     * @param {'deferred'|'immediate'|'exclusive'} [opts.mode='deferred'] - 事务模式
     *
     * ⚠️ mode 的选择不是风格问题，而是**跨进程正确性**问题：
     *   - deferred（默认）先取读锁，首条写语句时才尝试升级为写锁。若在此期间
     *     另一个连接提交了写事务，升级会立即失败并返回 SQLITE_BUSY——
     *     而 **`busy_timeout` 对这类"锁升级冲突"不起作用**（SQLite 的 busy
     *     handler 无法解决升级冲突，只能由调用方用 BEGIN IMMEDIATE 规避）。
     *   - immediate 在事务开始时就取写锁，冲突退化为普通锁竞争，
     *     此时 busy_timeout 才能生效（等待而非立即失败）。
     *   因此"先读后写"的事务（如分配 seq、条件 upsert）必须用 immediate。
     */
    async transaction(fn, { mode = 'deferred' } = {}) {
        const db = await this._ready_();
        const tx = db.transaction(fn);
        if (mode === 'immediate') return tx.immediate();
        if (mode === 'exclusive') return tx.exclusive();
        return tx();
    }

    /**
     * 获取底层 better-sqlite3 数据库句柄（F-16）。
     *
     * 为什么需要：`transaction(fn)` 把 fn 直接交给 better-sqlite3，而 better-sqlite3
     * 的事务要求 fn **完全同步**——一旦 fn 里出现 await，事务会在挂起处提前提交，
     * 原子性失效。因此需要"读 MAX 再插入"这类必须在同一事务内完成的逻辑时，
     * Store 层应取原始句柄后自己组织同步事务，而不是用 async 包装的 exec/get。
     *
     * 使用约束：拿到句柄后的事务体必须是同步的；不要在事务内做 I/O 或 await。
     *
     * @returns {Promise<import('better-sqlite3').Database>}
     */
    async getDb() {
        return this._ready_();
    }

    async delete(key) {
        // 语义：删除整个数据库文件
        try {
            await this.close();
            const { promises: fs } = await import('node:fs');
            await fs.unlink(this.pathSync(this._dbName));
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') return false;
            throw err;
        }
    }

    /** 关闭连接 */
    async close() {
        if (this._db) {
            this._db.close();
            this._db = null;
            this._ready = null;
            this._stmtCache.clear();
        }
    }

    // read/write/list 语义不适用于通用 SQLite，由具体 Store 定义表结构
    async read() { throw new Error('SqliteAdapter 不提供通用 read，请在 Store 层使用 all/get/upsert'); }
    async write() { throw new Error('SqliteAdapter 不提供通用 write，请在 Store 层使用 exec/upsert'); }
    async list() { throw new Error('SqliteAdapter 不提供通用 list，请在 Store 层使用 all'); }
}

export default SqliteAdapter;
