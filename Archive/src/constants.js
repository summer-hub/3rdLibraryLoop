/**
 * constants.js — 全局常量与阈值
 *
 * 集中管理索引数据库限制、查询参数、文档拆分规则、搜索文本预算、
 * 摘要长度、Rerank 系数和默认目录配置，避免魔术数字散落各处。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 默认数据目录（知识库持久化路径）。
 * 指向 Archive/data，可 git 提交到仓库，重复执行不会覆盖。
 */
const _srcDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = path.resolve(_srcDir, '..', 'data');

/** 索引版本号（变更后需要全量重建） */
export const INDEX_VERSION = '1.0.0';

/** 索引数据库大小上限（字节） */
export const INDEX_DB_MAX_BYTES = 48 * 1024 * 1024;

/** Git 提交警告阈值（字节），超过此值在 getStatus 中提醒 */
export const GIT_WARN_BYTES = 8 * 1024 * 1024;

/* ── 查询限制 ── */
/** 原始查询字符串最大长度 */
export const QUERY_MAX_RAW_CHARS = 200;
/** FTS5 MATCH 表达式最大 token 数 */
export const QUERY_MAX_FTS_TOKENS = 12;
/** AND 匹配策略允许的最大 token 数（超出则退化为 OR） */
export const QUERY_AND_MAX_TOKENS = 4;
/** 同义词扩展后的最大词条数 */
export const SYNONYM_EXPAND_MAX_PARTS = 8;

/* ── 文档拆分 ── */
/** 单文档最大段（segment）数 */
export const MAX_SECTIONS_PER_DOC = 28;
/** 分块最小行数（用于大段切分判断） */
export const CHUNK_MIN_LINES = 280;
/** 分块最小 H4 段数 */
export const CHUNK_MIN_H4_SECTIONS = 6;

/* ── 搜索文本预算（文档级） ── */
export const SEARCH_TEXT_MAX_CHARS = 1320;
export const BUDGET_TITLE = 120;
export const BUDGET_API_SYMBOLS = 450;
export const BUDGET_HEADINGS = 250;
export const BUDGET_BODY = 500;

/* ── 搜索文本预算（段级） ── */
export const SECTION_SEARCH_TEXT_MAX_CHARS = 480;
export const SECTION_BUDGET_TITLE = 80;
export const SECTION_BUDGET_API_SYMBOLS = 200;
export const SECTION_BUDGET_HEADINGS = 60;
export const SECTION_BUDGET_BODY = 200;

/* ── 摘要 ── */
export const SNIPPET_MAX_CHARS = 200;
export const SNIPPET_CONTEXT_CHARS = 40;
export const LEAD_TEXT_CHARS = 200;

/* ── Rerank ── */
/** 结果池放大系数：实际获取 limit × 此数再 rerank */
export const RERANK_POOL_FACTOR = 6;

/* ── 批量插入 ── */
export const INSERT_BATCH_SIZE = 500;

/* ── 默认目录配置 ── */
export const DEFAULT_CATALOGS = [
  { id: 'guides', title: '开发指南', searchBoost: 1.0 },
  { id: 'references', title: 'API参考', searchBoost: 1.0 },
  { id: 'best-practices', title: '最佳实践', searchBoost: 1.0 },
  { id: 'faqs', title: '常见问题', searchBoost: 1.0 },
  { id: 'releases', title: '版本说明', searchBoost: 1.0, tailInGlobalSearch: true },
  { id: 'roadmap', title: '变更预告', searchBoost: 1.0, tailInGlobalSearch: true },
];

/* ── 文件锁 ── */
/** 锁文件 stale 时间（毫秒），超过自动释放防死锁 */
export const LOCK_STALE_MS = 30 * 60 * 1000;
