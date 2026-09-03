/**
 * GitCodeTagDB — GitCode 打 TAG 数据库持久化层
 *
 * 职责：
 *  1. 管理 GitCodeTag SQLite 数据库（CRUD）
 *  2. 不存储 Token，仅存储任务元信息与打 TAG 结果
 *
 * 数据表 tag_tasks：
 *  - id           INTEGER PRIMARY KEY 自增
 *  - repoUrl      TEXT    仓库地址
 *  - ref          TEXT    Commit ID 或分支名称
 *  - tagName      TEXT    TAG 名称
 *  - tagDesc      TEXT    TAG 描述
 *  - status       TEXT    状态：pending / success / failed
 *  - tagUrl       TEXT    成功时返回的 TAG 链接
 *  - errorMessage TEXT    失败时的错误原因
 *  - createdAt    TEXT    创建时间（ISO 8601）
 *  - updatedAt    TEXT    更新时间（ISO 8601）
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

/** 状态常量 */
const STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED:  'failed',
});

class GitCodeTagDB {
  /**
   * @param {string} dbDir - 数据库文件所在目录（绝对路径）
   * @param {Function} Database - better-sqlite3 的 Database 类（由宿主注入，避免模块解析路径问题）
   * @param {string} [dbName=GitCodeTag] - 数据库文件名（不含扩展名）
   */
  constructor(dbDir, Database, dbName = 'GitCodeTag') {
    /** @type {import('better-sqlite3').Database|null} */
    this._db = null;
    /** @type {Function} */
    this._DatabaseClass = Database;

    // 确保目录存在
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this._dbPath = path.join(dbDir, `${dbName}.db`);
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────────

  /** 初始化数据库：建表、WAL 模式、索引 */
  initialize() {
    this._db = new this._DatabaseClass(this._dbPath);

    // 性能优化
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('busy_timeout = 5000');
    this._db.pragma('synchronous = NORMAL');

    this._db.exec(`
      CREATE TABLE IF NOT EXISTS tag_tasks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        repoUrl      TEXT    NOT NULL,
        ref          TEXT    NOT NULL DEFAULT '',
        tagName      TEXT    NOT NULL,
        tagDesc      TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT '${STATUS.PENDING}',
        tagUrl       TEXT    NOT NULL DEFAULT '',
        errorMessage TEXT    NOT NULL DEFAULT '',
        createdAt    TEXT    NOT NULL DEFAULT (datetime('now')),
        updatedAt    TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tag_tasks_status    ON tag_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tag_tasks_createdAt ON tag_tasks(createdAt DESC);
    `);

    return this;
  }

  /** 关闭数据库连接 */
  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  /**
   * 创建一条打 TAG 记录
   * @param {{ repoUrl: string, ref: string, tagName: string, tagDesc?: string }} data
   * @returns {{ id: number, repoUrl: string, ref: string, tagName: string, tagDesc: string, status: string, tagUrl: string, errorMessage: string, createdAt: string, updatedAt: string }}
   */
  create(data) {
    const stmt = this._db.prepare(`
      INSERT INTO tag_tasks (repoUrl, ref, tagName, tagDesc)
      VALUES (@repoUrl, @ref, @tagName, @tagDesc)
    `);

    const info = stmt.run({
      repoUrl: data.repoUrl,
      ref:     data.ref,
      tagName: data.tagName,
      tagDesc: data.tagDesc || '',
    });

    return this.getById(info.lastInsertRowid);
  }

  /**
   * 根据 ID 获取记录
   * @param {number} id
   * @returns {object|null}
   */
  getById(id) {
    const row = this._db.prepare('SELECT * FROM tag_tasks WHERE id = ?').get(id);
    return row || null;
  }

  /**
   * 获取所有记录（按创建时间降序，最新在前）
   * @returns {object[]}
   */
  getAll() {
    return this._db.prepare('SELECT * FROM tag_tasks ORDER BY createdAt DESC').all();
  }

  /**
   * 更新打 TAG 结果（成功或失败）
   * @param {number} id
   * @param {{ status: string, tagUrl?: string, errorMessage?: string }} result
   * @returns {object|null}
   */
  updateResult(id, result) {
    const stmt = this._db.prepare(`
      UPDATE tag_tasks
      SET status = @status,
          tagUrl = @tagUrl,
          errorMessage = @errorMessage,
          updatedAt = datetime('now')
      WHERE id = @id
    `);

    stmt.run({
      id,
      status:      result.status,
      tagUrl:      result.tagUrl || '',
      errorMessage: result.errorMessage || '',
    });

    return this.getById(id);
  }

  /**
   * 删除一条记录
   * @param {number} id
   * @returns {boolean}
   */
  deleteById(id) {
    const info = this._db.prepare('DELETE FROM tag_tasks WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 获取记录总数
   * @returns {number}
   */
  getCount() {
    const row = this._db.prepare('SELECT COUNT(*) AS cnt FROM tag_tasks').get();
    return row.cnt;
  }
}

module.exports = { GitCodeTagDB, STATUS };
