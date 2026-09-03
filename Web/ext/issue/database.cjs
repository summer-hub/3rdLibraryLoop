/**
 * Issue 数据存储层 — JSON 文件持久化
 *
 * 职责：
 *  1. 将 issue 数据以 JSON 文件形式保存到 db/Issue/ 目录
 *  2. 文件命名规则：{组织名}_{时间戳}.json（如 CPF-ApplicationTPC_20260819143000.json）
 *  3. 提供按组织读取最新数据文件的功能
 *  4. 不使用 SQLite，纯 JSON 文件存储
 *
 * 数据结构（单个 JSON 文件）：
 *  {
 *    org:        string,     // 组织名
 *    timestamp:  string,     // 生成时间戳（用于文件名和排序）
 *    fetchedAt:  string,     // ISO 格式的获取时间
 *    total:      number,     // issue 总数
 *    issues:     IssueRecord[]
 *  }
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

/** 数据存储目录 */
const DB_DIR = path.resolve(__dirname, '../../db/Issue');

/**
 * Issue 记录结构
 * @typedef {Object} IssueRecord
 * @property {string}  issueUrl  - Issue 地址
 * @property {string}  repoName  - 仓库名称
 * @property {boolean} hasReply  - 是否已有回复
 * @property {string}  createdAt - 提出时间（ISO 格式）
 * @property {string}  updatedAt - 最后更新时间（ISO 格式）
 * @property {string}  title     - Issue 标题
 * @property {number}  number    - Issue 编号
 * @property {string}  org       - 所属组织
 * @property {string}  username  - Issue 提交者用户名（API 原生字段）
 * @property {string}  [userType]- 用户身份（internal/external，刷新时根据名单识别）
 * @property {string}  [note]    - 手动批注（用户自定义字段，刷新时自动保留）
 * @property {string}  [assignee]- 负责人（用户自定义字段）
 * @property {string}  [label]   - 分类标签（bug/feature/question，AI 或手动分类）
 */

/**
 * API 原生字段集合 — 这些字段由 GitCode API 拉取，刷新时始终以新数据为准
 * 不在此集合中的字段视为自定义字段（批注），刷新时从旧快照回填
 */
const API_FIELDS = new Set([
  'issueUrl', 'repoName', 'hasReply', 'createdAt',
  'updatedAt', 'title', 'number', 'org', 'username',
]);

/**
 * 标识字段集合 — 批注更新时不允许被覆盖的字段
 * 这些字段用于唯一定位 Issue，覆盖会导致数据错乱
 */
const PROTECTED_FIELDS = new Set(['issueUrl', 'number', 'org']);

/**
 * 内部开发人员名单文件路径
 *
 * 文件格式：每行一个用户名（# 开头为注释，空行忽略），不区分大小写。
 * 文件不存在时视为空名单（所有用户均为"外部开发人员"）。
 */
const INTERNAL_DEVELOPERS_FILE = path.join(__dirname, 'internal_developers.txt');

/**
 * 从文件加载内部开发人员名单
 *
 * @returns {Set<string>} 小写用户名集合
 */
function loadInternalDevelopers() {
  const set = new Set();
  try {
    if (!fs.existsSync(INTERNAL_DEVELOPERS_FILE)) return set;
    const raw = fs.readFileSync(INTERNAL_DEVELOPERS_FILE, 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const name = line.trim();
      if (!name || name.startsWith('#')) continue;
      set.add(name.toLowerCase());
    }
    console.log(`[IssueDB] 已加载 ${set.size} 名内部开发人员`);
  } catch (err) {
    console.error(`[IssueDB] 加载内部开发人员名单失败：${err.message}`);
  }
  return set;
}

/** @type {Set<string>|null} 懒加载缓存 */
let _internalDevelopersCache = null;

/**
 * 获取内部开发人员名单（懒加载，首次调用时从文件读取并缓存）
 *
 * @returns {Set<string>}
 */
function getInternalDevelopers() {
  if (_internalDevelopersCache === null) {
    _internalDevelopersCache = loadInternalDevelopers();
  }
  return _internalDevelopersCache;
}

/**
 * 重新加载内部开发人员名单（清除缓存，下次调用时重新读取文件）
 */
function reloadInternalDevelopers() {
  _internalDevelopersCache = null;
}

/**
 * 三方框架名单文件路径
 *
 * 文件格式：每行一个仓库名（# 开头为注释，空行忽略），不区分大小写。
 * 文件不存在时视为空名单（所有仓库均识别为"三方库"）。
 */
const FRAMEWORK_REPOS_FILE = path.join(__dirname, 'framework_repos.txt');

/**
 * 从文件加载三方框架名单
 *
 * @returns {Set<string>} 小写仓库名集合
 */
function loadFrameworkRepos() {
  const set = new Set();
  try {
    if (!fs.existsSync(FRAMEWORK_REPOS_FILE)) return set;
    const raw = fs.readFileSync(FRAMEWORK_REPOS_FILE, 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const name = line.trim();
      if (!name || name.startsWith('#')) continue;
      set.add(name.toLowerCase());
    }
    console.log(`[IssueDB] 已加载 ${set.size} 个三方框架仓库`);
  } catch (err) {
    console.error(`[IssueDB] 加载三方框架名单失败：${err.message}`);
  }
  return set;
}

/** @type {Set<string>|null} 懒加载缓存 */
let _frameworkReposCache = null;

/**
 * 获取三方框架名单（懒加载，首次调用时从文件读取并缓存）
 *
 * @returns {Set<string>}
 */
function getFrameworkRepos() {
  if (_frameworkReposCache === null) {
    _frameworkReposCache = loadFrameworkRepos();
  }
  return _frameworkReposCache;
}

/**
 * 重新加载三方框架名单（清除缓存，下次调用时重新读取文件）
 */
function reloadFrameworkRepos() {
  _frameworkReposCache = null;
}

/**
 * Issue 数据存储类
 *
 * 负责 JSON 文件的读写管理，不依赖任何外部数据库模块。
 */
class IssueDB {
  /**
   * @param {string} dbDir - 数据存储目录
   */
  constructor(dbDir = DB_DIR) {
    this.dbDir = dbDir;
  }

  /**
   * 初始化存储目录（如不存在则创建）
   */
  initialize() {
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }
  }

  /**
   * 生成时间戳字符串（格式：yyyyMMddHHmmss）
   * @returns {string}
   */
  generateTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
      now.getFullYear().toString() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds())
    );
  }

  /**
   * 生成 JSON 文件名
   * @param {string} org       - 组织名
   * @param {string} timestamp - 时间戳
   * @returns {string} 文件名（如 CPF-ApplicationTPC_20260819143000.json）
   */
  generateFileName(org, timestamp) {
    return `${org}_${timestamp}.json`;
  }

  /**
   * 保存 issue 数据到 JSON 文件
   *
   * @param {object} params
   * @param {string} params.org    - 组织名
   * @param {Array<IssueRecord>} params.issues - Issue 列表
   * @returns {{ fileName: string, filePath: string, timestamp: string, total: number }} 保存结果
   */
  saveIssues({ org, issues }) {
    this.initialize();

    const timestamp = this.generateTimestamp();
    const fileName  = this.generateFileName(org, timestamp);
    const filePath  = path.join(this.dbDir, fileName);

    const data = {
      org,
      timestamp,
      fetchedAt: new Date().toISOString(),
      total:     issues.length,
      issues,
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

    return {
      fileName,
      filePath,
      timestamp,
      total: issues.length,
    };
  }

  /**
   * 获取指定组织的所有数据文件列表（按时间戳降序排列）
   *
   * @param {string} org - 组织名
   * @returns {Array<{ fileName: string, timestamp: string, filePath: string }>}
   */
  getOrgFiles(org) {
    this.initialize();

    const prefix = `${org}_`;
    const suffix = '.json';

    let files = [];
    try {
      files = fs.readdirSync(this.dbDir);
    } catch {
      return [];
    }

    const orgFiles = files
      .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
      .map((f) => {
        // 从文件名提取时间戳：{org}_{timestamp}.json
        const timestamp = f.slice(prefix.length, -suffix.length);
        return {
          fileName:  f,
          timestamp,
          filePath:  path.join(this.dbDir, f),
        };
      })
      // 过滤无效时间戳（14位数字）
      .filter((f) => /^\d{14}$/.test(f.timestamp))
      // 按时间戳降序排列（最新优先）
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return orgFiles;
  }

  /**
   * 获取指定组织的最新数据文件内容
   *
   * @param {string} org - 组织名
   * @returns {object|null} JSON 数据对象，不存在则返回 null
   */
  getLatestByOrg(org) {
    const files = this.getOrgFiles(org);
    if (files.length === 0) {
      return null;
    }

    const latest = files[0];
    try {
      const raw = fs.readFileSync(latest.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[IssueDB] 读取文件 ${latest.fileName} 失败：${err.message}`);
      return null;
    }
  }

  /**
   * 根据最新用户名单重新识别指定组织所有 issue 的用户身份
   *
   * 重新加载名单文件（Issue/internal_developers.txt），
   * 对最新快照中每条 issue 的 username 重新计算 userType，
   * 若有变更则原位写回快照文件。
   *
   * @param {string} org - 组织名
   * @returns {{ data: object|null, updated: number }} 更新后的数据与变更条数
   */
  reidentifyUserTypes(org) {
    const data = this.getLatestByOrg(org);
    if (!data || !Array.isArray(data.issues)) {
      return { data, updated: 0 };
    }

    // 重新加载名单，使文件修改无需重启服务即可生效
    reloadInternalDevelopers();

    let updated = 0;
    for (const issue of data.issues) {
      const newType = this.identifyUserType(issue.username);
      if (issue.userType !== newType) {
        issue.userType = newType;
        updated++;
      }
    }

    // 有变更时原位写回最新快照文件
    if (updated > 0) {
      const files = this.getOrgFiles(org);
      if (files.length > 0) {
        try {
          fs.writeFileSync(files[0].filePath, JSON.stringify(data, null, 2), 'utf-8');
          console.log(`[IssueDB] 用户身份重新识别完成：${org} 共 ${updated} 条更新`);
        } catch (err) {
          console.error(`[IssueDB] 写回快照文件失败：${err.message}`);
        }
      }
    }

    return { data, updated };
  }

  /**
   * 获取指定组织的所有历史数据文件摘要（不含 issue 详情）
   *
   * @param {string} org - 组织名
   * @returns {Array<{ fileName: string, timestamp: string, fetchedAt: string, total: number }>}
   */
  getOrgHistory(org) {
    const files = this.getOrgFiles(org);

    return files.map((f) => {
      try {
        const raw = fs.readFileSync(f.filePath, 'utf-8');
        const data = JSON.parse(raw);
        return {
          fileName:   f.fileName,
          timestamp:  f.timestamp,
          fetchedAt:  data.fetchedAt || '',
          total:      data.total || 0,
        };
      } catch {
        return {
          fileName:  f.fileName,
          timestamp: f.timestamp,
          fetchedAt: '',
          total:     0,
        };
      }
    });
  }

  /**
   * 将旧快照中的自定义字段（批注）合并到新拉取的 Issue 列表
   *
   * 刷新数据时调用：GitCode API 返回的 Issue 只含 API 字段，
   * 用户之前手动添加的批注（如 note、assignee）会丢失。
   * 本方法按 issueUrl 匹配，将旧快照中的非 API 字段回填到新数据中。
   *
   * 合并规则：
   *  - API 字段（issueUrl/repoName/hasReply/createdAt/updatedAt/title/number/org）
   *    始终以新拉取数据为准
   *  - 非 API 字段（自定义批注）仅当新数据中不存在该字段时，才从旧快照回填
   *  - 新 Issue（旧快照中不存在的）只有 API 字段
   *  - 已关闭 Issue（新数据中不存在的）自然丢弃
   *
   * @param {Array<IssueRecord>} newIssues - 从 GitCode API 新拉取的 Issue 列表
   * @param {object|null} oldData - 上一次快照的完整数据（含 issues 数组）
   * @returns {Array<IssueRecord>} 合并后的 Issue 列表
   */
  mergeCustomFields(newIssues, oldData) {
    if (!oldData || !oldData.issues || oldData.issues.length === 0) {
      return newIssues;
    }

    // 以 issueUrl 为 key 建立旧数据索引，实现 O(1) 查找
    const oldMap = new Map();
    for (const old of oldData.issues) {
      if (old.issueUrl) oldMap.set(old.issueUrl, old);
    }

    return newIssues.map((newIssue) => {
      const old = oldMap.get(newIssue.issueUrl);
      if (!old) return newIssue; // 新 Issue，无旧数据可合并

      // 以新数据为基础，叠加旧数据中的非 API 字段
      const merged = { ...newIssue };
      for (const [key, value] of Object.entries(old)) {
        if (!API_FIELDS.has(key) && !(key in merged)) {
          merged[key] = value; // 回填自定义字段
        }
      }
      return merged;
    });
  }

  /**
   * 根据用户名识别用户身份（内部/外部开发人员）
   *
   * 名单匹配规则：不区分大小写，用户名在 INTERNAL_DEVELOPERS 集合中即为内部。
   *
   * @param {string} username - GitCode 用户名
   * @returns {string} 'internal'（内部开发人员）或 'external'（外部开发人员）
   */
  identifyUserType(username) {
    if (!username) return 'external';
    return getInternalDevelopers().has(username.toLowerCase()) ? 'internal' : 'external';
  }

  /**
   * 判断仓库是否属于三方框架
   *
   * 依据 framework_repos.txt 名单（懒加载缓存 + reload 失效机制）。
   * 名单中列出的仓库 → 'framework'（三方框架）；
   * 未列出的仓库     → 'library'（三方库，默认值）。
   *
   * @param {string} repoName - 仓库名（不含组织前缀，大小写不敏感）
   * @returns {string} 'framework' 或 'library'
   */
  identifyRepoType(repoName) {
    if (!repoName) return 'library';
    return getFrameworkRepos().has(repoName.toLowerCase()) ? 'framework' : 'library';
  }

  /**
   * 更新单条 Issue 的批注字段
   *
   * 在当前最新快照中查找指定 Issue，合并用户提交的批注字段。
   * 支持创建新批注（字段不存在时添加）和更新现有批注（字段已存在时覆盖）。
   * 修改后立即写回快照文件，持久化保存。
   *
   * @param {string} org       - 组织名
   * @param {string} issueUrl  - 目标 Issue 的 URL（用于唯一定位）
   * @param {object} fields    - 要更新/新增的批注字段键值对
   * @returns {{ success: boolean, message: string, issue?: object }} 更新结果
   */
  updateIssueFields(org, issueUrl, fields) {
    if (!org || !issueUrl || !fields || typeof fields !== 'object') {
      return { success: false, message: '参数不合法（org/issueUrl/fields 必填）' };
    }

    const data = this.getLatestByOrg(org);
    if (!data || !data.issues || data.issues.length === 0) {
      return { success: false, message: '无可用数据，请先刷新' };
    }

    // 按 issueUrl 精确定位目标 Issue
    const issue = data.issues.find((i) => i.issueUrl === issueUrl);
    if (!issue) {
      return { success: false, message: `未找到 Issue: ${issueUrl}` };
    }

    // 合并字段：标识字段（issueUrl/number/org）受保护，不允许覆盖
    for (const [key, value] of Object.entries(fields)) {
      if (!PROTECTED_FIELDS.has(key)) {
        issue[key] = value;
      }
    }

    // 写回当前最新快照文件
    const latestFile = this.getOrgFiles(org)[0];
    if (latestFile) {
      try {
        fs.writeFileSync(latestFile.filePath, JSON.stringify(data, null, 2), 'utf-8');
      } catch (err) {
        return { success: false, message: `写入文件失败：${err.message}` };
      }
    } else {
      return { success: false, message: '未找到快照文件' };
    }

    return { success: true, message: '更新成功', issue };
  }

  /**
   * 批量更新多条 Issue 的批注字段
   *
   * 对指定 issueUrl 列表中的每条 Issue 应用相同的字段更新。
   * 与 updateIssueFields 一致：标识字段（issueUrl/number/org）受保护，不允许覆盖。
   * 修改后一次性写回最新快照文件。
   *
   * @param {string} org       - 组织名
   * @param {string[]} issueUrls - 目标 Issue 的 URL 列表
   * @param {object} fields    - 要更新/新增的批注字段键值对
   * @returns {{ success: boolean, message: string, updated: number, notFound: number }}
   *          更新结果：updated=成功更新条数，notFound=未匹配到的条数
   */
  batchUpdateIssueFields(org, issueUrls, fields) {
    if (!org || !Array.isArray(issueUrls) || issueUrls.length === 0) {
      return { success: false, message: '参数不合法（org/issueUrls 必填）', updated: 0, notFound: 0 };
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return { success: false, message: 'fields 必须是键值对对象', updated: 0, notFound: 0 };
    }

    const data = this.getLatestByOrg(org);
    if (!data || !data.issues || data.issues.length === 0) {
      return { success: false, message: '无可用数据，请先刷新', updated: 0, notFound: 0 };
    }

    // 构建 issueUrl 集合，实现 O(1) 查找
    const targetSet = new Set(issueUrls);

    let updated = 0;
    for (const issue of data.issues) {
      if (!targetSet.has(issue.issueUrl)) continue;

      // 合并字段：标识字段受保护，不允许覆盖
      for (const [key, value] of Object.entries(fields)) {
        if (!PROTECTED_FIELDS.has(key)) {
          issue[key] = value;
        }
      }
      updated++;
    }

    const notFound = targetSet.size - updated;

    // 写回当前最新快照文件
    if (updated > 0) {
      const latestFile = this.getOrgFiles(org)[0];
      if (latestFile) {
        try {
          fs.writeFileSync(latestFile.filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
          return { success: false, message: `写入文件失败：${err.message}`, updated: 0, notFound };
        }
      } else {
        return { success: false, message: '未找到快照文件', updated: 0, notFound };
      }
    }

    return {
      success: true,
      message: `批量更新成功：共 ${updated} 条` + (notFound > 0 ? `，${notFound} 条未找到` : ''),
      updated,
      notFound,
    };
  }

  /**
   * 清理指定组织的旧版本 JSON 快照文件
   *
   * 保留策略：每个组织仅保留最近 maxRetain 个版本，超出的旧文件自动删除。
   * 文件按时间戳（文件名中的 yyyyMMddHHmmss）降序排列，最新的在前。
   *
   * 安全措施：
   *  - 只清理以 `{org}_` 开头且以 `.json` 结尾的文件（复用 getOrgFiles 过滤逻辑）
   *  - 只清理时间戳格式合法的文件（14 位数字）
   *  - 保留最新文件，仅删除超出保留数量的旧版本
   *  - 删除单个文件失败不影响其他文件的清理
   *  - 整个清理过程被 try-catch 包裹，异常不会中断主流程
   *
   * @param {string} org      - 组织名
   * @param {number} maxRetain - 保留的文件数量上限（默认 5）
   * @returns {{ retained: number, deleted: number, deletedFiles: string[], skipped: number }}
   *          清理结果：retained=保留数量，deleted=删除数量，deletedFiles=已删文件名，skipped=跳过（删除失败）数量
   */
  cleanupOldFiles(org, maxRetain = 5) {
    this.initialize();

    const result = { retained: 0, deleted: 0, deletedFiles: [], skipped: 0 };

    try {
      // getOrgFiles 已按时间戳降序排列（最新优先），且仅返回 {org}_*.json 格式的合法文件
      const files = this.getOrgFiles(org);

      if (files.length <= maxRetain) {
        // 文件数量未超过保留上限，无需清理
        result.retained = files.length;
        return result;
      }

      // 保留前 maxRetain 个（最新的），删除其余旧版本
      result.retained = maxRetain;
      const toDelete = files.slice(maxRetain);

      for (const file of toDelete) {
        try {
          fs.unlinkSync(file.filePath);
          result.deleted++;
          result.deletedFiles.push(file.fileName);
        } catch (err) {
          // 单个文件删除失败不中断整体清理流程
          result.skipped++;
          console.error(`[IssueDB] 删除旧快照文件 ${file.fileName} 失败：${err.message}`);
        }
      }

      console.log(
        `[IssueDB] 清理完成 [${org}]：保留 ${result.retained} 个，` +
        `删除 ${result.deleted} 个，跳过 ${result.skipped} 个`
      );
    } catch (err) {
      // 清理过程出错不应影响主流程（拉取数据已保存成功）
      console.error(`[IssueDB] 清理旧文件失败 [${org}]：${err.message}`);
    }

    return result;
  }

  /**
   * 查找指定组织中未分类（无 label 字段）的 Issue 列表
   *
   * 用于批量分类时筛选目标 Issue，避免对已分类的 Issue 重复处理。
   *
   * @param {string} org - 组织名
   * @returns {Array<{ issueUrl: string, title: string }>} 未分类 Issue 列表
   */
  findUnlabeledIssues(org) {
    this.initialize();

    const data = this.getLatestByOrg(org);
    if (!data || !data.issues || data.issues.length === 0) {
      return [];
    }

    return data.issues
      .filter((issue) => !issue.label)
      .map((issue) => ({
        issueUrl: issue.issueUrl,
        title:    issue.title,
      }));
  }

  /**
   * 批量更新 Issue 的分类标签
   *
   * 将分类结果写入最新快照文件中的对应 Issue。
   * 以 issueUrl 为匹配键，更新 label 字段。
   * 标识字段（issueUrl/number/org）受保护，不会被覆盖。
   *
   * @param {string} org    - 组织名
   * @param {Array<{ issueUrl: string, label: string }>} labels - 分类结果列表
   * @returns {{ updated: number, notFound: number, total: number }} 更新统计
   */
  batchUpdateLabels(org, labels) {
    this.initialize();

    const result = { updated: 0, notFound: 0, total: 0 };

    if (!org || !Array.isArray(labels) || labels.length === 0) {
      return result;
    }

    const data = this.getLatestByOrg(org);
    if (!data || !data.issues || data.issues.length === 0) {
      return result;
    }

    // 构建 issueUrl → label 映射，实现 O(1) 查找
    const labelMap = new Map();
    for (const item of labels) {
      if (item.issueUrl && item.label) {
        labelMap.set(item.issueUrl, item.label);
      }
    }

    result.total = labelMap.size;

    // 遍历 Issue 列表，更新匹配项的 label 字段
    for (const issue of data.issues) {
      const label = labelMap.get(issue.issueUrl);
      if (label !== undefined) {
        issue.label = label;
        result.updated++;
        labelMap.delete(issue.issueUrl);
      }
    }

    // 未匹配到的 Issue（可能在旧快照中已被关闭）
    result.notFound = labelMap.size;

    // 写回最新快照文件
    if (result.updated > 0) {
      const latestFile = this.getOrgFiles(org)[0];
      if (latestFile) {
        try {
          fs.writeFileSync(
            latestFile.filePath,
            JSON.stringify(data, null, 2),
            'utf-8'
          );
          console.log(
            `[IssueDB] 批量更新标签 [${org}]：` +
            `更新 ${result.updated} 条，未找到 ${result.notFound} 条`
          );
        } catch (err) {
          console.error(`[IssueDB] 批量写入标签失败 [${org}]：${err.message}`);
          result.updated = 0;
        }
      }
    }

    return result;
  }

  /**
   * 获取所有组织的最新数据
   *
   * @returns {Record<string, object|null>} 以组织名为 key 的最新数据映射
   */
  getAllLatest() {
    const result = {};
    // 组织列表由 router 传入，此处仅处理已有数据
    const orgs = this._discoverOrgs();
    for (const org of orgs) {
      result[org] = this.getLatestByOrg(org);
    }
    return result;
  }

  /**
   * 从数据文件中发现所有组织名
   * @returns {string[]}
   * @private
   */
  _discoverOrgs() {
    this.initialize();
    let files = [];
    try {
      files = fs.readdirSync(this.dbDir);
    } catch {
      return [];
    }

    const orgs = new Set();
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const idx = f.lastIndexOf('_');
      if (idx > 0) {
        orgs.add(f.slice(0, idx));
      }
    }
    return Array.from(orgs);
  }

  /**
   * 根据文件名读取指定数据文件
   *
   * @param {string} fileName - 文件名
   * @returns {object|null}
   */
  getByFileName(fileName) {
    const filePath = path.join(this.dbDir, fileName);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[IssueDB] 读取文件 ${fileName} 失败：${err.message}`);
      return null;
    }
  }
}

module.exports = { IssueDB, DB_DIR, reloadInternalDevelopers, reloadFrameworkRepos };
