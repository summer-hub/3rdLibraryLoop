/**
 * sqlite-schema.js — SQLite FTS5 DDL
 *
 * 定义 documents / segments / segments_fts 虚拟表及同步触发器。
 * 通过外部内容表模式（content='segments'）保持 FTS 与段表一致。
 */

export const SCHEMA_SQL = `
-- 文档表: 记录文档元信息
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY,
  document_id   TEXT NOT NULL UNIQUE,
  catalog_id    INTEGER NOT NULL,
  doc_title     TEXT NOT NULL,
  metadata      TEXT DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 段表: 文档拆分后的索引单元
CREATE TABLE IF NOT EXISTS segments (
  id                 INTEGER PRIMARY KEY,
  doc_id             INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_title      TEXT NOT NULL DEFAULT '',
  lead_text          TEXT NOT NULL DEFAULT '',
  search_text        TEXT NOT NULL,
  excerpt_truncated  INTEGER NOT NULL DEFAULT 0
);

-- FTS5 全文索引虚拟表（外部内容表模式）
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  search_text,
  content='segments',
  content_rowid='id',
  tokenize='unicode61'
);

-- 同步触发器: segments 增删改自动同步 FTS
CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, search_text) VALUES (new.id, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, search_text)
    VALUES ('delete', old.id, old.search_text);
END;

CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, search_text)
    VALUES ('delete', old.id, old.search_text);
  INSERT INTO segments_fts(rowid, search_text)
    VALUES (new.id, new.search_text);
END;

-- 辅助索引
CREATE INDEX IF NOT EXISTS segments_doc_id_idx ON segments(doc_id);
CREATE INDEX IF NOT EXISTS documents_catalog_idx ON documents(catalog_id);

-- 索引元数据表
CREATE TABLE IF NOT EXISTS index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
