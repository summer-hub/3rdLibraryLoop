/**
 * PrCheck 路由 — PR 检视意见批量解决系统 API 层（3rdloop web 扩展版）
 *
 * 移植自 AIWeb/PrCheck/router.js，适配 3rdloop web 扩展协议：
 *   - 工厂函数经 createExtRouter(deps) 暴露，由 cli/lib/web-ext.js 挂载到 /prcheck
 *   - deps.express  为轻量 express 兼容 shim（Router/get/post）
 *   - deps.Database 为 better-sqlite3（由宿主解析注入）
 *   - deps.dbDir    为扩展数据目录（<dataDir>/web-ext/prcheck）
 *
 * API 列表：
 *  GET    /prcheck/list       - 获取所有 PR 检视记录
 *  POST   /prcheck/create     - 创建 PR 检视记录（仅入库）
 *  POST   /prcheck/preview    - 预览 PR 检视意见
 *  POST   /prcheck/execute    - 执行批量解决检视意见
 */

'use strict';

const { PrCheckDB, STATUS } = require('./database.cjs');
const { parsePrUrl, previewComments, resolveComments } = require('./gitcodeApi.cjs');
const path = require('node:path');

// ── 数据库单例（延迟初始化；目录由宿主注入，默认值仅兜底） ────────────────

const DB_DIR = path.resolve(__dirname, '../../db/PrCheck');
let db = null;

/**
 * 创建 PrCheck 路由器
 * @param {object} deps - 依赖项（由 3rdloop web 宿主注入）
 * @param {object}   deps.express   - express 兼容 shim
 * @param {Function} deps.Database  - better-sqlite3 的 Database 类
 * @param {string}   [deps.dbDir]   - 扩展数据目录
 * @returns {object} Router 实例
 */
function createPrCheckRouter({ express, Database, dbDir }) {
  if (!db) {
    db = new PrCheckDB(dbDir || DB_DIR, Database);
    db.initialize();
  }

  const router = express.Router();

  // ── GET /prcheck/list ────────────────────────────────────────────────────

  /**
   * 获取所有 PR 检视记录
   */
  router.get('/list', (_req, res) => {
    try {
      const records = db.getAll();
      res.json({ success: true, data: records, total: records.length });
    } catch (err) {
      console.error('[PrCheck] 获取列表失败：', err.message);
      res.status(500).json({ success: false, message: '获取 PR 检视列表失败' });
    }
  });

  // ── POST /prcheck/create ─────────────────────────────────────────────────

  /**
   * 创建一条 PR 检视记录（仅入库，不执行操作）
   *
   * 请求体：{ repoUrl, description? }
   * - repoUrl:     PR 完整地址（支持 /pull/{number} 格式）
   * - description: 可选，问题描述说明
   */
  router.post('/create', (req, res) => {
    try {
      const { repoUrl, description } = req.body || {};

      // 参数校验
      if (!repoUrl || typeof repoUrl !== 'string' || !repoUrl.trim()) {
        return res.status(400).json({ success: false, message: 'PR 地址不能为空' });
      }

      const trimmedUrl = repoUrl.trim();

      // 尝试解析 PR 地址（允许不含 PR 号，后续可补充）
      let owner = '';
      let repo  = '';
      let prNumber = 0;

      try {
        const parsed = parsePrUrl(trimmedUrl);
        owner    = parsed.owner;
        repo     = parsed.repo;
        prNumber = parsed.prNumber || 0;
      } catch {
        // 解析失败不阻断创建，用户可能后续补充
      }

      const record = db.create({
        repoUrl:     trimmedUrl,
        description: (typeof description === 'string' ? description.trim() : ''),
        owner,
        repo,
        prNumber,
      });

      res.json({ success: true, data: record });
    } catch (err) {
      console.error('[PrCheck] 创建记录失败：', err.message);
      res.status(500).json({ success: false, message: '创建 PR 检视记录失败' });
    }
  });

  // ── POST /prcheck/preview ────────────────────────────────────────────────

  /**
   * 预览 PR 检视意见
   *
   * 请求体：{ repoUrl, token }
   * - repoUrl: PR 完整地址
   * - token:   GitCode Access Token（不存储）
   */
  router.post('/preview', async (req, res) => {
    try {
      const { repoUrl, token } = req.body || {};

      if (!repoUrl || typeof repoUrl !== 'string' || !repoUrl.trim()) {
        return res.status(400).json({ success: false, message: 'PR 地址不能为空' });
      }
      if (!token || typeof token !== 'string' || !token.trim()) {
        return res.status(400).json({ success: false, message: 'GitCode Token 不能为空' });
      }

      const result = await previewComments(repoUrl.trim(), token.trim());

      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[PrCheck] 预览失败：', err.message);

      if (err.message.includes('格式无效') || err.message.includes('仅支持') ||
          err.message.includes('缺少') || err.message.includes('无效')) {
        return res.status(400).json({ success: false, message: err.message });
      }

      res.status(500).json({ success: false, message: `预览失败：${err.message}` });
    }
  });

  // ── POST /prcheck/execute ────────────────────────────────────────────────

  /**
   * 执行批量解决检视意见
   *
   * 请求体：{ id, token, discussionIds? }
   * - id:            记录 ID
   * - token:         GitCode Access Token（不存储）
   * - discussionIds: 可选，指定解决的 discussion_id 列表；为空则解决所有未解决意见
   */
  router.post('/execute', async (req, res) => {
    try {
      const { id, token, discussionIds } = req.body || {};

      // 参数校验
      if (!id) {
        return res.status(400).json({ success: false, message: '记录 ID 不能为空' });
      }
      if (!token || typeof token !== 'string' || !token.trim()) {
        return res.status(400).json({ success: false, message: 'GitCode Token 不能为空' });
      }

      // 查询记录
      const record = db.getById(id);
      if (!record) {
        return res.status(404).json({ success: false, message: 'PR 检视记录不存在' });
      }

      // 幂等性：已成功的不重复执行
      if (record.status === STATUS.SUCCESS) {
        return res.json({
          success: true,
          data:    record,
          message: '该 PR 检视意见已全部解决，无需重复执行',
        });
      }

      // 调用 GitCode API 批量解决
      const result = await resolveComments(
        record.repoUrl,
        token.trim(),
        discussionIds || []
      );

      // 确定最终状态
      let finalStatus;
      if (result.total === 0) {
        finalStatus = STATUS.SUCCESS; // 无待解决意见
      } else if (result.failed === 0) {
        finalStatus = STATUS.SUCCESS;
      } else if (result.resolved > 0) {
        finalStatus = STATUS.PARTIAL;
      } else {
        finalStatus = STATUS.FAILED;
      }

      // 构建错误信息（包含审批失败信息）
      const failedDetails = result.details.filter((d) => !d.success);
      let errorMessage  = failedDetails.length > 0
        ? failedDetails.map((d) => `${d.discussionId}: ${d.errorMessage}`).join('; ')
        : '';
      if (result.reviewError) {
        errorMessage += (errorMessage ? '; ' : '') + `审批: ${result.reviewError}`;
      }

      // 存储完整执行明细 JSON
      const detailsJson = JSON.stringify(result.details);

      // 审批结果：0=未审批, 1=通过, -1=失败
      let reviewApproved = 0;
      if (result.reviewApproved === true) {
        reviewApproved = 1;
      } else if (result.reviewApproved === false) {
        reviewApproved = -1;
      }

      // 解析地址以更新 owner/repo/prNumber
      let owner    = record.owner;
      let repo     = record.repo;
      let prNumber = record.prNumber;

      try {
        const parsed = parsePrUrl(record.repoUrl);
        if (!owner && parsed.owner) owner = parsed.owner;
        if (!repo && parsed.repo)   repo  = parsed.repo;
        if (!prNumber && parsed.prNumber) prNumber = parsed.prNumber;
      } catch {
        // 解析失败不阻断
      }

      // 更新数据库
      const updatedRecord = db.updateResult(id, {
        status:        finalStatus,
        totalCount:    result.total,
        resolvedCount: result.resolved,
        failedCount:   result.failed,
        errorMessage,
        details:       detailsJson,
        reviewApproved,
        owner,
        repo,
        prNumber,
      });

      // 构建提示信息
      const reviewMsg = reviewApproved === 1
        ? '，审查已通过'
        : reviewApproved === -1
          ? `，审查未通过: ${result.reviewError}`
          : '';

      res.json({
        success: finalStatus !== STATUS.FAILED,
        data:    updatedRecord,
        message: finalStatus === STATUS.SUCCESS
          ? `成功解决 ${result.resolved} 条检视意见${reviewMsg}`
          : finalStatus === STATUS.PARTIAL
            ? `部分成功：${result.resolved}/${result.total}，失败 ${result.failed} 条${reviewMsg}`
            : `全部失败：${errorMessage}${reviewMsg}`,
      });
    } catch (err) {
      console.error('[PrCheck] 执行失败：', err.message);

      // 如果有记录 ID，更新为失败状态
      if (req.body?.id) {
        try {
          db.updateResult(req.body.id, {
            status:       STATUS.FAILED,
            errorMessage: err.message,
          });
        } catch {
          // 更新失败不影响错误返回
        }
      }

      res.status(500).json({ success: false, message: `执行失败：${err.message}` });
    }
  });

  return router;
}

// 3rdloop web 扩展协议入口 + 兼容原 AIWeb 工厂名
module.exports = { createExtRouter: createPrCheckRouter, createPrCheckRouter };
