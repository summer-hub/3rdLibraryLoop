/**
 * sqlite-backend.js — SQLite 后端（基于 node:sqlite）
 *
 * 使用 Node.js 内置的 node:sqlite 模块（DatabaseSync / StatementSync），
 * 完整支持 FTS5 + bm25，直接操作文件持久化，无需 WASM。
 *
 * 对外暴露适配后的 DB 对象，提供与原 WASM 方案一致的 API：
 *   db.exec(sql)
 *   db.prepare(sql)        → StmtAdapter
 *   db.selectValue(sql)
 *
 * StatementSync 适配层（StmtAdapter）：
 *   stmt.bind(params[])    → 缓存参数
 *   stmt.step()            → 执行一次，返回是否有行
 *   stmt.get()             → 取当前行（对象形式）
 *   stmt.reset()           → 重置语句状态
 *   stmt.finalize()        → 释放语句（node:sqlite 自动管理，此处空操作）
 *
 * 读写分离：
 *   - openWriteDb：打开持久化文件 DB（DatabaseSync），支持增删改查。
 *   - openReadDb：复用写库连接（node:sqlite 同进程内支持并发读），
 *     按 mtimeMs 缓存独立只读连接，写入后失效。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './sqlite-schema.js';

/**
 * StatementSync 适配器 — 兼容 WASM 风格的 bind/step/get/finalize/reset。
 *
 * node:sqlite 的 StatementSync 不支持逐行 step() 游标推进。
 * get() 每次返回第一行，iterate() 返回迭代器，all() 返回全部行。
 * 为兼容 WASM 风格的 while(stmt.step()) { stmt.get() } 循环，
 * 在首次 step() 时用 all() 预取全部行，后续 step() 推进索引。
 */
class StmtAdapter {
  /**
   * @param {import('node:sqlite').StatementSync} stmt
   */
  constructor(stmt) {
    this._stmt = stmt;
    /** @type {unknown[]|null} */
    this._bound = null;
    /** @type {object[]|null} 预取的全部行 */
    this._rows = null;
    /** @type {number} 当前行索引 */
    this._index = -1;
  }

  /**
   * 绑定参数（WASM 风格接受数组）。
   * @param {unknown[]} params
   */
  bind(params) {
    this._bound = Array.isArray(params) ? params : [params];
    this._rows = null;
    this._index = -1;
  }

  /**
   * 执行一步，返回是否还有数据行。
   *
   * 首次调用：用 all() 预取全部行（SELECT）或 run() 执行（INSERT/UPDATE/DELETE）。
   * 后续调用：推进行索引。
   *
   * @returns {boolean}
   */
  step() {
    if (!this._stmt) return false;

    // 首次 step：执行语句并预取结果
    if (this._rows === null) {
      const params = this._bound || [];
      try {
        // SELECT 语句：all() 返回全部行
        this._rows = this._stmt.all(...params);
      } catch {
        // 非 SELECT 语句（INSERT/UPDATE/DELETE）：用 run() 执行
        try {
          this._stmt.run(...params);
        } catch {
          // 忽略执行错误，上层通过返回空结果感知
        }
        this._rows = [];
      }
      this._index = 0;
    } else {
      // 后续 step：推进索引
      this._index++;
    }

    return this._index < this._rows.length;
  }

  /**
   * 获取当前行数据（对象形式）。
   * @returns {object}
   */
  get() {
    if (this._rows === null || this._index < 0 || this._index >= this._rows.length) {
      return {};
    }
    return this._rows[this._index];
  }

  /**
   * 重置语句（WASM 风格）。
   * 清空预取结果，下次 step() 会重新执行。
   */
  reset() {
    this._rows = null;
    this._index = -1;
  }

  /**
   * 释放语句（WASM 风格）。
   * node:sqlite 的 StatementSync 由 GC 管理，此处清空引用。
   */
  finalize() {
    this._stmt = null;
    this._bound = null;
    this._rows = null;
    this._index = -1;
  }
}

/**
 * DatabaseSync 适配器 — 在原 DB 上添加 selectValue 等便捷方法。
 */
class DbAdapter {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   */
  constructor(db) {
    this._db = db;
  }

  /**
   * 执行 SQL（无参数）。
   * @param {string} sql
   */
  exec(sql) {
    this._db.exec(sql);
  }

  /**
   * 预处理 SQL，返回适配后的语句。
   * @param {string} sql
   * @returns {StmtAdapter}
   */
  prepare(sql) {
    const stmt = this._db.prepare(sql);
    return new StmtAdapter(stmt);
  }

  /**
   * 执行查询并返回单个标量值。
   * @param {string} sql
   * @param {...unknown} params
   * @returns {unknown}
   */
  selectValue(sql, ...params) {
    const stmt = this._db.prepare(sql);
    const row = stmt.get(...params);
    if (!row) return undefined;
    const keys = Object.keys(row);
    if (keys.length === 0) return undefined;
    return row[keys[0]];
  }

  /**
   * 关闭数据库连接。
   */
  close() {
    this._db.close();
  }
}

export default class SqliteBackend {
  constructor() {
    /** @type {DbAdapter|null} */
    this.writeDb = null;
    /** @type {{path:string,mtimeMs:number,db:DbAdapter}|null} */
    this.readCache = null;
    /** @type {string|null} */
    this._dbPath = null;
  }

  /**
   * 初始化后端（node:sqlite 无需异步初始化）。
   * @returns {Promise<void>}
   */
  async init() {
    // node:sqlite 是同步内置模块，无需异步初始化
  }

  /**
   * 打开（或复用）持久化读写数据库。
   * @param {string} dbPath
   * @returns {Promise<DbAdapter>}
   */
  async openWriteDb(dbPath) {
    if (this.writeDb) return this.writeDb;

    await fs.promises.mkdir(path.dirname(dbPath), { recursive: true });

    const isNew = !fs.existsSync(dbPath);
    const rawDb = new DatabaseSync(dbPath);
    // 启用 WAL 模式提升并发读写性能
    rawDb.exec('PRAGMA journal_mode = WAL;');
    rawDb.exec('PRAGMA foreign_keys = ON;');

    if (isNew) {
      rawDb.exec(SCHEMA_SQL);
    }

    this.writeDb = new DbAdapter(rawDb);
    this._dbPath = dbPath;
    return this.writeDb;
  }

  /**
   * 打开只读数据库连接（按 mtime 缓存）。
   * 优先复用写库连接，避免多连接开销。
   * @param {string} dbPath
   * @returns {Promise<DbAdapter>}
   */
  async openReadDb(dbPath) {
    // 同路径直接复用写库（node:sqlite 单连接支持读写并发）
    if (this.writeDb && this._dbPath === dbPath) {
      return this.writeDb;
    }

    const stat = await fs.promises.stat(dbPath);

    if (
      this.readCache &&
      this.readCache.path === dbPath &&
      this.readCache.mtimeMs === stat.mtimeMs
    ) {
      return this.readCache.db;
    }

    this.readCache?.db.close();
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec('PRAGMA query_only = ON;');
    this.readCache = {
      path: dbPath,
      mtimeMs: stat.mtimeMs,
      db: new DbAdapter(rawDb),
    };
    return this.readCache.db;
  }

  /**
   * 写入后调用，使只读缓存失效。
   */
  invalidateReadCache() {
    this.readCache?.db.close();
    this.readCache = null;
  }

  /**
   * 关闭所有数据库连接，释放资源。
   * @returns {Promise<void>}
   */
  async close() {
    this.writeDb?.close();
    this.readCache?.db.close();
    this.writeDb = null;
    this.readCache = null;
  }
}
