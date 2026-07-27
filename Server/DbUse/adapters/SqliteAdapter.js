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
                return this._db;
            })();
        }
        return this._ready;
    }

    /**
     * 执行无返回值的 SQL（DDL/DML），可带参数。
     * @param {string} sql
     * @param {Array} [params]
     */
    async exec(sql, params) {
        const db = await this._ready_();
        if (params) {
            db.prepare(sql).run(...params);
        } else {
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
        const db = await this._ready_();
        return db.prepare(sql).all(...params);
    }

    /**
     * 执行查询并返回首行。
     * @param {string} sql
     * @param {Array} [params]
     * @returns {Promise<object|undefined>}
     */
    async get(sql, params = []) {
        const db = await this._ready_();
        return db.prepare(sql).get(...params);
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
        const db = await this._ready_();
        db.prepare(sql).run(...cols.map(c => row[c]));
        return row;
    }

    /**
     * 在事务中执行多个写操作（better-sqlite3 同步事务）。
     * @param {Function} fn - 接收 db，执行同步操作
     */
    async transaction(fn) {
        const db = await this._ready_();
        const tx = db.transaction(fn);
        return tx();
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
