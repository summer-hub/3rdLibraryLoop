/**
 * Issue 路由 — GitCode Issue 查询系统 API 层（3rdloop web 扩展版）
 *
 * 移植自 AIWeb/Issue/router.js，适配 3rdloop web 扩展协议：
 *   - 工厂函数经 createExtRouter(deps) 暴露，由 cli/lib/web-ext.js 挂载到 /issue
 *   - deps.express    为轻量 express 兼容 shim（Router/get/post/patch）
 *   - deps.dbDir      为扩展数据目录（<dataDir>/web-ext/issue）
 *   - deps.serverRoot 为核心引擎 Server 根目录（供 issueClassifier 解析
 *     CLIController；AI 分类依赖 opencode serve）
 *
 * 与 AIWeb 原版差异：
 *   - GitCode Token 仅从环境变量 GITCODE_TOKEN 读取（不内置兜底值）
 *   - 数据目录由宿主注入，不再写死仓库相对路径
 *
 * API 列表：
 *  GET  /issue/list              - 获取指定组织的最新 issue 数据（支持 label 筛选）
 *  GET  /issue/orgs              - 获取支持的组织列表
 *  POST /issue/refresh           - 刷新指定组织的 issue 数据（需要密码，自动合并批注）
 *  GET  /issue/history           - 获取指定组织的历史数据文件列表
 *  GET  /issue/export            - 导出指定组织的 issue 数据为 Excel
 *  PATCH /issue/annotate         - 更新单条 Issue 的批注字段（note/assignee/label 等）
 *  PATCH /issue/batch-annotate   - 批量更新批注字段（需要密码）
 *  POST /issue/classify          - 对未分类 Issue 执行 AI 自动分类（通过 CLI 调用 AI 服务）
 */

'use strict';

const { IssueDB, reloadInternalDevelopers, reloadFrameworkRepos } = require('./database.cjs');
const { fetchOrgIssues, ORGANIZATIONS } = require('./gitcodeApi.cjs');
const { classifyByAI, setServerCliPath, LABELS, LABEL_KEYS } = require('./issueClassifier.cjs');
const path = require('node:path');

// ── 数据库单例（延迟初始化；目录由宿主注入，默认值仅兜底） ──────────────────

const DB_DIR = path.resolve(__dirname, '../../db/Issue');
let db = null;

/**
 * 刷新操作的管理密码（可通过环境变量覆盖）
 * 默认值仅用于本地开发，生产环境务必通过 ISSUE_ADMIN_PASSWORD 环境变量设置
 */
const ADMIN_PASSWORD = process.env.ISSUE_ADMIN_PASSWORD || 'admin123';

// ── Excel 导出（CSV 格式，兼容 Excel 打开） ────────────────────────────────────
// 不引入第三方依赖，使用 CSV + BOM 方式，Excel 可正确识别中文

/** CSV 列定义 */
const CSV_COLUMNS = Object.freeze([
  { key: 'issueUrl',  header: 'Issue地址' },
  { key: 'repoName',  header: '仓库名称' },
  { key: 'hasReply',  header: '是否已有回复' },
  { key: 'createdAt', header: '提出时间' },
  { key: 'updatedAt', header: '最后更新时间' },
  { key: 'duration',  header: '未回复时长', compute: true },
  { key: 'title',     header: 'Issue标题' },
  { key: 'number',    header: 'Issue编号' },
  { key: 'username',  header: '用户名' },
  { key: 'userType',  header: '用户身份' },
  { key: 'note',      header: '备注' },
  { key: 'assignee',  header: '负责人' },
  { key: 'label',     header: '分类标签' },
]);

/**
 * CSV 字段转义：包含逗号、引号、换行的字段需用双引号包裹，内部引号转义为两个双引号
 *
 * @param {string} value - 原始字段值
 * @returns {string} 转义后的字段
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 计算从某个时间点到现在的时长描述
 * 返回如 "3天5小时"、"2小时10分钟"、"5分钟" 等
 *
 * @param {string} iso - ISO 时间字符串
 * @returns {string} 人类可读的时长描述
 */
function formatDuration(iso) {
  if (!iso) return '--';
  const from = new Date(iso);
  if (isNaN(from.getTime())) return '--';

  const diffMs = Date.now() - from.getTime();
  if (diffMs < 0) return '刚刚';

  const totalMin = Math.floor(diffMs / 60000);
  const days  = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins  = totalMin % 60;

  if (days > 0)  return `${days}天${hours}小时`;
  if (hours > 0)  return `${hours}小时${mins}分钟`;
  if (mins > 0)  return `${mins}分钟`;
  return '刚刚';
}

/**
 * 将 issue 数据转换为 CSV 字符串
 *
 * @param {Array<object>} issues - Issue 列表
 * @returns {string} CSV 文本
 */
function issuesToCsv(issues) {
  const header = CSV_COLUMNS.map((col) => escapeCsvField(col.header)).join(',');
  const rows = issues.map((issue) => {
    return CSV_COLUMNS.map((col) => {
      let val;

      // 动态计算列
      if (col.compute && col.key === 'duration') {
        val = formatDuration(issue.updatedAt || issue.createdAt);
      } else {
        val = issue[col.key];
      }

      // hasReply 转为中文展示
      if (col.key === 'hasReply') {
        val = val ? '是' : '否';
      }
      // userType 转为中文展示
      if (col.key === 'userType') {
        if (val === 'internal') val = '内部开发人员';
        else if (val === 'external') val = '外部开发人员';
      }
      return escapeCsvField(val);
    }).join(',');
  });
  return [header, ...rows].join('\r\n');
}

/**
 * 去除仓库名称中的组织前缀，仅保留具体仓库名
 *
 * 历史快照中 repoName 存储的是 GitCode API 返回的完整路径，
 * 分隔符两侧可能带空格（如 "CPF-ApplicationTPC / openssl"）。
 * 页面表格与 CSV 导出的"仓库名称"列只需展示具体仓库名：
 * 取最后一个 "/" 之后的片段并去除首尾空格；不含 "/" 时原样返回（幂等），
 * 兼容新拉取的纯仓库名与历史完整路径两种快照格式。
 *
 * @param {string} repoName - 仓库名称（可能为 "org / repo" 完整路径或纯仓库名）
 * @returns {string} 去除组织前缀后的仓库名
 */
function stripOrgPrefix(repoName) {
  if (!repoName) return '';
  const idx = repoName.lastIndexOf('/');
  if (idx < 0) return repoName.trim();
  return repoName.slice(idx + 1).trim();
}

/**
 * 批量剥离 Issue 列表中仓库名称的组织前缀（返回浅拷贝，不改动快照数据）
 *
 * @param {Array<object>} issues - Issue 列表
 * @returns {Array<object>} repoName 已剥离前缀的新 Issue 列表
 */
function issuesWithShortRepoName(issues) {
  return issues.map((issue) => ({
    ...issue,
    repoName: stripOrgPrefix(issue.repoName),
  }));
}

/**
 * 格式化文件名中的时间戳
 * @param {string} timestamp - yyyyMMddHHmmss 格式
 * @returns {string} yyyy-MM-dd_HH-mm-ss 格式
 */
function formatTimestampForFile(timestamp) {
  if (!timestamp || timestamp.length !== 14) return timestamp || '';
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}_${timestamp.slice(8, 10)}-${timestamp.slice(10, 12)}-${timestamp.slice(12, 14)}`;
}


/**
 * 创建 Issue 路由器
 *
 * @param {object} deps - 依赖项（由 3rdloop web 宿主注入）
 * @param {object}   deps.express    - express 兼容 shim
 * @param {string}   [deps.dbDir]    - 扩展数据目录
 * @param {string}   [deps.serverRoot] - 核心引擎 Server 根目录（AI 分类用）
 * @returns {object} Router 实例
 */
function createIssueRouter({ express, dbDir, serverRoot }) {
  // AI 分类的 CLIController 由核心引擎提供：注入 Server/cli/cli.js 路径
  if (serverRoot) {
    setServerCliPath(path.join(serverRoot, 'cli', 'cli.js'));
  }

  if (!db) {
    db = new IssueDB(dbDir || DB_DIR);
    db.initialize();
  }

  const router = express.Router();

  /**
   * GET /issue/orgs
   * 获取支持的组织列表
   */
  router.get('/orgs', (_req, res) => {
    res.json({
      success: true,
      data:    ORGANIZATIONS,
    });
  });

  /**
   * GET /issue/list
   * 获取指定组织的最新 issue 数据
   *
   * 查询参数：
   *  org      - 组织名（可选，默认第一个组织）
   *  label    - 分类标签筛选（可选，值为 bug/feature/question）
   *            传入后仅返回匹配该标签的 Issue；传入 'unlabeled' 返回未分类的 Issue
   *  userType - 用户身份筛选（可选，值为 internal/external）
   *            传入后仅返回匹配该身份的 Issue
   */
  router.get('/list', (req, res) => {
    try {
      let org = (req.query.org || '').trim();
      const label = (req.query.label || '').trim();
      const userType = (req.query.userType || '').trim();

      // 默认使用第一个组织
      if (!org) {
        org = ORGANIZATIONS[0];
      }

      if (!ORGANIZATIONS.includes(org)) {
        return res.status(400).json({
          success: false,
          message: `不支持的组织：${org}`,
        });
      }

      // 校验 label 参数
      if (label && label !== 'unlabeled' && !LABEL_KEYS.includes(label)) {
        return res.status(400).json({
          success: false,
          message: `无效的标签：${label}，可选值：${[...LABEL_KEYS, 'unlabeled'].join(', ')}`,
        });
      }

      // 校验 userType 参数
      if (userType && !['internal', 'external'].includes(userType)) {
        return res.status(400).json({
          success: false,
          message: `无效的用户身份：${userType}，可选值：internal, external`,
        });
      }

      // 每次加载列表时根据最新用户名单重新识别用户身份
      // （名单文件修改后点击"刷新列表"即可生效，无需调用 GitCode API）
      const { data } = db.reidentifyUserTypes(org);

      if (data && data.issues) {
        // 仓库名称列仅展示具体仓库名（剥离历史快照中的 "组织 /" 前缀），
        // 并根据 framework_repos.txt 名单为每条 Issue 运行时派生 repoType 字段
        // （'framework'=三方框架 / 'library'=三方库，不写入快照文件，
        //   名单文件修改后点击"刷新列表"即可生效，无需重启服务）
        reloadFrameworkRepos();
        const issues = issuesWithShortRepoName(data.issues).map((issue) => ({
          ...issue,
          repoType: db.identifyRepoType(issue.repoName),
        }));

        let filtered = issues;

        // 按 label 筛选
        if (label) {
          filtered = filtered.filter((issue) => {
            if (label === 'unlabeled') return !issue.label;
            return issue.label === label;
          });
        }

        // 按 userType 筛选
        if (userType) {
          filtered = filtered.filter((issue) => issue.userType === userType);
        }

        if (label || userType) {
          res.json({
            success: true,
            data: { ...data, issues: filtered, total: filtered.length },
            org,
            label,
            userType,
          });
        } else {
          res.json({
            success: true,
            data: { ...data, issues },
            org,
          });
        }
      } else {
        res.json({
          success: true,
          data,
          org,
        });
      }
    } catch (err) {
      console.error('[Issue] 获取列表失败：', err.message);
      res.status(500).json({ success: false, message: '获取 Issue 列表失败' });
    }
  });

  /**
   * GET /issue/history
   * 获取指定组织的历史数据文件列表
   *
   * 查询参数：
   *  org  - 组织名
   */
  router.get('/history', (req, res) => {
    try {
      const org = (req.query.org || '').trim();

      if (!org || !ORGANIZATIONS.includes(org)) {
        return res.status(400).json({
          success: false,
          message: '请指定有效的组织名',
        });
      }

      const history = db.getOrgHistory(org);

      res.json({
        success: true,
        data: history,
      });
    } catch (err) {
      console.error('[Issue] 获取历史记录失败：', err.message);
      res.status(500).json({ success: false, message: '获取历史记录失败' });
    }
  });

  /**
   * POST /issue/refresh
   * 刷新指定组织的 issue 数据（调用 GitCode API）
   *
   * 请求体：
   *  org    - 组织名
   *  password - 管理密码
   *
   * 刷新流程：
   *  1. 从 GitCode API 拉取最新 Issue 数据（仅含 API 字段）
   *  2. 读取上一次快照，将旧数据中的自定义批注字段合并到新数据
   *  3. 保存合并后的数据为新快照文件
   *  4. 清理旧版本快照文件（保留最近 5 个），异常不影响主流程
   *  5. 对未分类 Issue 执行关键词自动分类（非阻塞，异常不影响主流程）
   *
   * Token 由服务端环境变量 GITCODE_TOKEN 统一配置，前端无需传入。
   */
  router.post('/refresh', async (req, res) => {
    try {
      const { org, password } = req.body || {};

      // 密码校验
      if (!password || password !== ADMIN_PASSWORD) {
        return res.status(403).json({
          success: false,
          message: '密码错误，无权执行刷新操作',
        });
      }

      // 参数校验
      if (!org || !ORGANIZATIONS.includes(org)) {
        return res.status(400).json({
          success: false,
          message: `请指定有效的组织名，支持：${ORGANIZATIONS.join(', ')}`,
        });
      }

      // Token 由环境变量统一配置（3rdloop web 下经 .env 链加载，无内置兜底值）
      const token = process.env.GITCODE_TOKEN || '';
      if (!token) {
        return res.status(500).json({
          success: false,
          message: '服务端未配置 GITCODE_TOKEN 环境变量',
        });
      }

      // Step 1: 调用 GitCode API 获取 issue 数据
      const issues = await fetchOrgIssues({
        org,
        token,
        onProgress: (msg) => {
          console.log(`[Issue] [${org}] ${msg}`);
        },
      });

      // Step 1.5: 根据用户名识别用户身份（内部/外部开发人员）
      // 每次刷新时重新加载名单文件，使名单变更无需重启服务即可生效
      reloadInternalDevelopers();
      for (const issue of issues) {
        issue.userType = db.identifyUserType(issue.username);
      }

      // Step 2: 读取上一次快照，合并自定义批注字段（note/assignee 等）
      const oldData = db.getLatestByOrg(org);
      const mergedIssues = db.mergeCustomFields(issues, oldData);

      // Step 3: 保存合并后的数据到新 JSON 快照文件
      const result = db.saveIssues({ org, issues: mergedIssues });

      // Step 4: 清理旧版本快照文件（保留最近 5 个，异常不影响主流程）
      const cleanup = db.cleanupOldFiles(org, 5);

      res.json({
        success: true,
        data: {
          org,
          timestamp:  result.timestamp,
          fileName:   result.fileName,
          total:      result.total,
          fetchedAt:  new Date().toISOString(),
          cleanup,   // 清理结果：{ retained, deleted, deletedFiles, skipped }
        },
        message: `刷新成功，共获取 ${result.total} 条 issue` +
                 (cleanup.deleted > 0 ? `，已清理 ${cleanup.deleted} 个旧快照` : ''),
      });
    } catch (err) {
      console.error('[Issue] 刷新失败：', err.message);
      res.status(500).json({
        success: false,
        message: `刷新失败：${err.message}`,
      });
    }
  });

  /**
   * PATCH /issue/annotate
   * 更新单条 Issue 的批注字段
   *
   * 请求体：
   *  org       - 组织名
   *  issueUrl  - 目标 Issue 的 URL
   *  fields    - 要更新/新增的批注字段键值对（如 { note: "备注", assignee: "张三" }）
   *
   * 支持的字段：note（备注）、assignee（负责人）、label（分类标签）等自定义字段。
   * 标识字段（issueUrl/number/org）受保护，不允许覆盖。
   * 批注会持久化到当前最新快照文件，刷新数据时自动保留。
   */
  router.patch('/annotate', (req, res) => {
    try {
      const { org, issueUrl, fields } = req.body || {};

      // 参数校验
      if (!org || !ORGANIZATIONS.includes(org)) {
        return res.status(400).json({
          success: false,
          message: `请指定有效的组织名，支持：${ORGANIZATIONS.join(', ')}`,
        });
      }

      if (!issueUrl || typeof issueUrl !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'issueUrl 为必填参数',
        });
      }

      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return res.status(400).json({
          success: false,
          message: 'fields 必须是键值对对象',
        });
      }

      // 调用 DB 层更新批注
      const result = db.updateIssueFields(org, issueUrl, fields);

      if (!result.success) {
        return res.status(404).json({
          success: false,
          message: result.message,
        });
      }

      res.json({
        success: true,
        message: result.message,
        data:    result.issue,
      });
    } catch (err) {
      console.error('[Issue] 批注更新失败：', err.message);
      res.status(500).json({
        success: false,
        message: `批注更新失败：${err.message}`,
      });
    }
  });

  /**
   * PATCH /issue/batch-annotate
   * 批量更新多条 Issue 的批注字段（基于筛选范围）
   *
   * 请求体：
   *  org       - 组织名（必填）
   *  issueUrls - 目标 Issue 的 URL 数组（必填）
   *  password  - 管理密码（必填）
   *  fields    - 要更新的批注字段键值对（如 { note: "备注", assignee: "张三" }）
   *
   * 支持的字段：note（备注）、assignee（负责人）、label（分类标签）等自定义字段。
   * 标识字段（issueUrl/number/org）受保护，不允许覆盖。
   * 对每个匹配的 Issue 应用相同的字段值，修改后一次性写回快照文件。
   */
  router.patch('/batch-annotate', (req, res) => {
    try {
      const { org, issueUrls, password, fields } = req.body || {};

      // 密码校验
      if (!password || password !== ADMIN_PASSWORD) {
        return res.status(403).json({
          success: false,
          message: '密码错误，无权执行批量编辑操作',
        });
      }

      // 参数校验
      if (!org || !ORGANIZATIONS.includes(org)) {
        return res.status(400).json({
          success: false,
          message: `请指定有效的组织名，支持：${ORGANIZATIONS.join(', ')}`,
        });
      }

      if (!Array.isArray(issueUrls) || issueUrls.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'issueUrls 为必填参数，且至少包含一个 URL',
        });
      }

      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return res.status(400).json({
          success: false,
          message: 'fields 必须是键值对对象',
        });
      }

      // 过滤掉空字符串值的字段，避免写入空值覆盖原有数据
      const effectiveFields = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== '' && value !== null && value !== undefined) {
          effectiveFields[key] = value;
        }
      }

      if (Object.keys(effectiveFields).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'fields 至少需要一个非空字段',
        });
      }

      // 调用 DB 层批量更新
      const result = db.batchUpdateIssueFields(org, issueUrls, effectiveFields);

      res.json({
        success: true,
        message: result.message,
        data:    { updated: result.updated, notFound: result.notFound },
      });
    } catch (err) {
      console.error('[Issue] 批量批注更新失败：', err.message);
      res.status(500).json({
        success: false,
        message: `批量批注更新失败：${err.message}`,
      });
    }
  });

  /**
   * POST /issue/classify
   * 对指定组织中未分类的 Issue 执行 AI 自动分类
   *
   * 通过 CLI 适配器调用 AI 服务，分析 Issue 标题内容，
   * 自动判断分类（bug/feature/question）并写入快照文件。
   *
   * 请求体：
   *  org       - 组织名（必填）
   *  password  - 管理密码（必填，与刷新操作一致）
   *  cliType   - CLI 类型（'opencode' | 'copilot'，默认 'opencode'）
   *
   * 返回：
   *  success, data: { total, classified, notClassified, details }
   */
  router.post('/classify', async (req, res) => {
    try {
      const { org, password, cliType } = req.body || {};

      // 密码校验
      if (!password || password !== ADMIN_PASSWORD) {
        return res.status(403).json({
          success: false,
          message: '密码错误，无权执行分类操作',
        });
      }

      // 参数校验
      if (!org || !ORGANIZATIONS.includes(org)) {
        return res.status(400).json({
          success: false,
          message: `请指定有效的组织名，支持：${ORGANIZATIONS.join(', ')}`,
        });
      }

      // 查找未分类 Issue
      const unlabeled = db.findUnlabeledIssues(org);

      if (unlabeled.length === 0) {
        return res.json({
          success: true,
          data: { total: 0, classified: 0, notClassified: 0 },
          message: '所有 Issue 已分类，无需处理',
        });
      }

      console.log(`[Issue] [${org}] 开始 AI 分类 ${unlabeled.length} 条未分类 Issue`);

      // 执行 AI 分类（含兜底，确保每条 Issue 都获得标签）
      const results = await classifyByAI(unlabeled, { type: cliType || 'opencode' }, (msg) => {
        console.log(`[Issue] [${org}] ${msg}`);
      });

      // 写入分类结果
      const updateResult = db.batchUpdateLabels(org, results);

      const aiCount = results.length;

      res.json({
        success: true,
        data: {
          total:         unlabeled.length,
          classified:    updateResult.updated,
          notClassified: unlabeled.length - aiCount,
          notFound:      updateResult.notFound,
          source:        'ai',
          aiClassified:  aiCount,
        },
        message: `分类完成：共 ${unlabeled.length} 条，` +
                 `AI 分类 ${aiCount} 条` +
                 (unlabeled.length - aiCount > 0 ? `，未分类 ${unlabeled.length - aiCount} 条` : ''),
      });
    } catch (err) {
      console.error('[Issue] 分类失败：', err.message);
      res.status(500).json({
        success: false,
        message: `分类失败：${err.message}`,
      });
    }
  });

  /**
   * GET /issue/export
   * 导出指定组织的 issue 数据为 Excel（CSV 格式带 BOM）
   *
   * 查询参数：
   *  org       - 组织名
   *  label     - 分类标签筛选（可选，值为 bug/feature/question/unlabeled）
   *  userType  - 用户身份筛选（可选，值为 internal/external）
   *  repoType  - 仓库分类筛选（可选，值为 framework/library）
   *  reply     - 回复状态筛选（可选，值为 all/replied/unreplied）
   *  repoName  - 仓库名称模糊搜索（可选，不区分大小写）
   *  assignee  - 负责人模糊搜索（可选，不区分大小写）
   *
   * 支持的所有筛选条件均与页面列表筛选一致，只有筛选后的数据才会被导出。
   */
  router.get('/export', (req, res) => {
    try {
      let org = (req.query.org || '').trim();

      if (!org) {
        org = ORGANIZATIONS[0];
      }

      if (!ORGANIZATIONS.includes(org)) {
        return res.status(400).json({
          success: false,
          message: `不支持的组织：${org}`,
        });
      }

      const data = db.getLatestByOrg(org);

      if (!data || !data.issues || data.issues.length === 0) {
        return res.status(404).json({
          success: false,
          message: '当前组织暂无 issue 数据，请先刷新',
        });
      }

      // 仓库名称列仅导出具体仓库名（剥离历史快照中的 "组织 /" 前缀，与页面展示一致）
      reloadFrameworkRepos();
      let issues = issuesWithShortRepoName(data.issues).map((issue) => ({
        ...issue,
        repoType: db.identifyRepoType(issue.repoName),
      }));

      // ── 应用筛选条件（与 /list 接口保持一致） ──

      // 分类标签筛选
      const label = (req.query.label || '').trim();
      if (label) {
        if (label !== 'unlabeled' && !LABEL_KEYS.includes(label)) {
          return res.status(400).json({
            success: false,
            message: `无效的标签：${label}，可选值：${[...LABEL_KEYS, 'unlabeled'].join(', ')}`,
          });
        }
        issues = issues.filter((issue) => {
          if (label === 'unlabeled') return !issue.label;
          return issue.label === label;
        });
      }

      // 用户身份筛选
      const userType = (req.query.userType || '').trim();
      if (userType) {
        if (!['internal', 'external'].includes(userType)) {
          return res.status(400).json({
            success: false,
            message: `无效的用户身份：${userType}，可选值：internal, external`,
          });
        }
        issues = issues.filter((issue) => issue.userType === userType);
      }

      // 仓库分类筛选
      const repoType = (req.query.repoType || '').trim();
      if (repoType) {
        if (!['framework', 'library'].includes(repoType)) {
          return res.status(400).json({
            success: false,
            message: `无效的仓库分类：${repoType}，可选值：framework, library`,
          });
        }
        issues = issues.filter((issue) => issue.repoType === repoType);
      }

      // 回复状态筛选
      const reply = (req.query.reply || '').trim();
      if (reply) {
        if (!['replied', 'unreplied'].includes(reply)) {
          return res.status(400).json({
            success: false,
            message: `无效的回复状态：${reply}，可选值：replied, unreplied`,
          });
        }
        issues = issues.filter((issue) => {
          if (reply === 'replied') return !!issue.hasReply;
          return !issue.hasReply;
        });
      }

      // 仓库名称模糊搜索
      const repoName = (req.query.repoName || '').trim();
      if (repoName) {
        const keyword = repoName.toLowerCase();
        issues = issues.filter((issue) => (issue.repoName || '').toLowerCase().includes(keyword));
      }

      // 负责人模糊搜索
      const assignee = (req.query.assignee || '').trim();
      if (assignee) {
        const keyword = assignee.toLowerCase();
        issues = issues.filter((issue) => (issue.assignee || '').toLowerCase().includes(keyword));
      }

      if (issues.length === 0) {
        return res.status(404).json({
          success: false,
          message: '没有符合筛选条件的 Issue 可导出',
        });
      }

      // 生成 CSV（带 UTF-8 BOM，确保 Excel 正确识别中文编码）
      const BOM = '\uFEFF';
      const csv = BOM + issuesToCsv(issues);

      // 生成文件名（含筛选标识，避免同时下载多个文件时覆盖）
      const tsFormatted = formatTimestampForFile(data.timestamp);
      let fileName = `${org}_${tsFormatted}`;
      if (label) fileName += `_${label}`;
      if (userType) fileName += `_${userType}`;
      fileName += '.csv';

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.send(csv);
    } catch (err) {
      console.error('[Issue] 导出失败：', err.message);
      res.status(500).json({ success: false, message: '导出失败' });
    }
  });

  return router;
}

// 3rdloop web 扩展协议入口 + 兼容原 AIWeb 工厂名
module.exports = { createExtRouter: createIssueRouter, createIssueRouter };
