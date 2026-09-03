/**
 * PrCheckDB — PR 检视意见批量解决数据库持久化层
 *
 * 职责：
 *  1. 管理 PrCheck SQLite 数据库（CRUD）
 *  2. 不存储 Token，仅存储 PR 元信息与执行结果
 *
 * 数据表 pr_check_records：
 *  - id           INTEGER PRIMARY KEY 自增
 *  - repoUrl       TEXT    PR 完整地址
 *  - description   TEXT    问题描述说明
 *  - owner        TEXT    仓库所属空间
 *  - repo         TEXT    仓库名称
 *  - prNumber     INTEGER PR 序号
 *  - status       TEXT    状态：pending / success / partial / failed
 *  - totalCount   INTEGER 待解决意见总数
 *  - resolvedCount INTEGER 成功解决数
 *  - failedCount  INTEGER 失败数
 *  - errorMessage TEXT    错误信息 *  - details       TEXT    执行明细 JSON（每条 discussion_id 的结果） *  - createdAt    TEXT    创建时间（ISO 8601）
 *  - updatedAt    TEXT    更新时间（ISO 8601）
 */

'use strict';

const path = require('node:path');
const fs   = require('node:fs');

/** 状态常量 */
const STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILED:  'failed',
});

class PrCheckDB {
  /**
   * @param {string}   dbDir    - 数据库文件所在目录（绝对路径）
   * @param {Function} Database - better-sqlite3 的 Database 类（由宿主注入，避免模块解析路径问题）
   * @param {string}   [dbName=PrCheck] - 数据库文件名（不含扩展名）
   */
  constructor(dbDir, Database, dbName = 'PrCheck') {
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
      CREATE TABLE IF NOT EXISTS pr_check_records (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        repoUrl       TEXT    NOT NULL,
        description   TEXT    NOT NULL DEFAULT '',
        owner         TEXT    NOT NULL DEFAULT '',
        repo          TEXT    NOT NULL DEFAULT '',
        prNumber      INTEGER NOT NULL DEFAULT 0,
        status        TEXT    NOT NULL DEFAULT '${STATUS.PENDING}',
        totalCount    INTEGER NOT NULL DEFAULT 0,
        resolvedCount INTEGER NOT NULL DEFAULT 0,
        failedCount   INTEGER NOT NULL DEFAULT 0,
        errorMessage  TEXT    NOT NULL DEFAULT '',
        details        TEXT    NOT NULL DEFAULT '[]',
        reviewApproved INTEGER NOT NULL DEFAULT 0,
        createdAt     TEXT    NOT NULL DEFAULT (datetime('now')),
        updatedAt     TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_pr_check_status     ON pr_check_records(status);
      CREATE INDEX IF NOT EXISTS idx_pr_check_createdAt  ON pr_check_records(createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_pr_check_owner_repo ON pr_check_records(owner, repo);
    `);

    // 兼容旧表：自动添加可能缺少的列
    const columns = this._db.prepare("PRAGMA table_info(pr_check_records)").all().map(c => c.name);
    if (!columns.includes('description')) {
      this._db.exec("ALTER TABLE pr_check_records ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.includes('reviewApproved')) {
      this._db.exec("ALTER TABLE pr_check_records ADD COLUMN reviewApproved INTEGER NOT NULL DEFAULT 0");
    }

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
   * 创建一条 PR 检视记录
   * @param {{ repoUrl: string, description?: string, owner?: string, repo?: string, prNumber?: number }} data
   * @returns {object} 新创建的记录
   */
  create(data) {
    const stmt = this._db.prepare(`
      INSERT INTO pr_check_records (repoUrl, description, owner, repo, prNumber)
      VALUES (@repoUrl, @description, @owner, @repo, @prNumber)
    `);

    const info = stmt.run({
      repoUrl:     data.repoUrl,
      description: data.description || '',
      owner:       data.owner       || '',
      repo:        data.repo        || '',
      prNumber:    data.prNumber    || 0,
    });

    return this.getById(info.lastInsertRowid);
  }

  /**
   * 根据 ID 获取记录
   * @param {number} id
   * @returns {object|null}
   */
  getById(id) {
    const row = this._db.prepare('SELECT * FROM pr_check_records WHERE id = ?').get(id);
    return row || null;
  }

  /**
   * 获取所有记录（按创建时间降序，最新在前）
   * @returns {object[]}
   */
  getAll() {
    return this._db.prepare('SELECT * FROM pr_check_records ORDER BY createdAt DESC').all();
  }

  /**
   * 更新 PR 检视执行结果
   * @param {number} id
   * @param {object}  result
   * @param {string}  result.status        - 状态：pending / success / partial / failed
   * @param {number}  [result.totalCount]  - 待解决意见总数
   * @param {number}  [result.resolvedCount] - 成功解决数
   * @param {number}  [result.failedCount] - 失败数
   * @param {string}  [result.errorMessage] - 错误信息
   * @param {string}  [result.details]         - 执行明细 JSON
   * @param {number}  [result.reviewApproved]   - 审查是否通过（0=未审批/1=通过/-1=失败）
   * @param {string}  [result.owner]       - 仓库所属空间
   * @param {string}  [result.repo]        - 仓库名称
   * @param {number}  [result.prNumber]    - PR 序号
   * @returns {object|null}
   */
  updateResult(id, result) {
    const stmt = this._db.prepare(`
      UPDATE pr_check_records
      SET status        = @status,
          totalCount    = @totalCount,
          resolvedCount = @resolvedCount,
          failedCount   = @failedCount,
          errorMessage  = @errorMessage,
          details       = @details,
          reviewApproved = @reviewApproved,
          owner         = @owner,
          repo          = @repo,
          prNumber      = @prNumber,
          updatedAt     = datetime('now')
      WHERE id = @id
    `);

    stmt.run({
      id,
      status:        result.status        || STATUS.PENDING,
      totalCount:    result.totalCount    ?? 0,
      resolvedCount: result.resolvedCount ?? 0,
      failedCount:   result.failedCount   ?? 0,
      errorMessage:  result.errorMessage   || '',
      details:        result.details        || '[]',
      reviewApproved: result.reviewApproved   ?? 0,
      owner:         result.owner         || '',
      repo:          result.repo          || '',
      prNumber:      result.prNumber      || 0,
    });

    return this.getById(id);
  }

  /**
   * 删除一条记录
   * @param {number} id
   * @returns {boolean} 是否删除成功
   */
  deleteById(id) {
    const info = this._db.prepare('DELETE FROM pr_check_records WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 获取记录总数
   * @returns {number}
   */
  getCount() {
    const row = this._db.prepare('SELECT COUNT(*) AS cnt FROM pr_check_records').get();
    return row.cnt;
  }
}

module.exports = { PrCheckDB, STATUS };
