/**
 * GitCode API — PR 检视意见批量解决客户端
 *
 * 职责：
 *  1. 调用 GitCode REST API 获取 PR 评论列表并批量解决
 *  2. 解析 PR 地址，提取 owner/repo/prNumber
 *  3. 不存储 Token，每次操作由调用方传入
 *
 * GitCode API 文档参考：
 *  - 获取评论：GET  /api/v5/repos/{owner}/{repo}/pulls/{number}/comments
 *  - 解决评论：PUT  /api/v5/repos/{owner}/{repo}/pulls/{number}/comments/{discussion_id}
 */

'use strict';

const https = require('node:https');
const http  = require('node:http');

/** GitCode API 基础 URL */
const GITCODE_API_BASE = 'https://gitcode.com/api/v5';

/** 速率限制：批量请求间隔（ms） */
const BATCH_DELAY_MS = 50;

/** 并发请求数上限 */
const CONCURRENCY = 3;

/** 重试配置 */
const MAX_RETRIES    = 2;
const RETRY_DELAY_MS = 400;

/** 单次请求超时（ms） */
const REQUEST_TIMEOUT_MS = 15000;

// ── HTTP 连接复用（keepAlive 避免每次请求重新 TLS 握手） ─────────────────────
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  keepAliveMsecs: 30000,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
  keepAliveMsecs: 30000,
});

// ── URL 解析 ────────────────────────────────────────────────────────────────

/**
 * 解析 GitCode PR 地址，提取 owner、repo 和 prNumber
 *
 * 支持格式：
 *  - https://gitcode.com/owner/repo/pull/123
 *  - https://gitcode.com/owner/repo          （需额外提供 prNumber）
 *  - https://gitcode.com/owner/repo.git
 *  - https://gitcode.com/owner/repo/tree/branch
 *  - https://gitcode.com/owner/repo/blob/branch/path
 *
 * @param {string} prUrl - PR 完整地址
 * @returns {{ owner: string, repo: string, prNumber: number|null }} 解析结果
 * @throws {Error} 地址格式无效或非 GitCode 域名
 */
function parsePrUrl(prUrl) {
  try {
    const url = new URL(prUrl);

    if (!url.hostname.includes('gitcode.com')) {
      throw new Error('仅支持 gitcode.com 仓库地址');
    }

    const parts = url.pathname.replace(/^\/+/, '').split('/');

    if (parts.length < 2) {
      throw new Error('仓库地址格式无效，需包含 owner/repo');
    }

    const owner = parts[0];
    let repo    = parts[1];

    // 去掉 .git 后缀
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }

    if (!owner || !repo) {
      throw new Error('仓库地址格式无效，owner 或 repo 为空');
    }

    // 尝试从 /pull/{number} 路径提取 PR 号
    let prNumber = null;
    const pullIdx = parts.indexOf('pull');
    if (pullIdx !== -1 && parts[pullIdx + 1]) {
      prNumber = parseInt(parts[pullIdx + 1], 10);
      if (isNaN(prNumber) || prNumber <= 0) {
        throw new Error('PR 序号无效，必须为正整数');
      }
    }

    return { owner, repo, prNumber };
  } catch (err) {
    if (err.message.includes('仅支持') || err.message.includes('格式无效') ||
        err.message.includes('为空') || err.message.includes('无效')) {
      throw err;
    }
    throw new Error(`PR 地址解析失败：${err.message}`);
  }
}

// ── HTTP 请求 ───────────────────────────────────────────────────────────────

/**
 * 通用 HTTP 请求函数
 * @param {string}  method    - HTTP 方法
 * @param {string}  urlStr    - 完整 URL
 * @param {object}  [body]    - 请求体
 * @param {object}  [options] - 可选配置
 * @param {number}  [options.timeoutMs=15000]    - 超时时间
 * @param {boolean} [options.jsonMode=false]     - 是否以 JSON 发送请求体
 * @param {object}  [options.extraHeaders={}]    - 额外请求头
 * @returns {Promise<{ status: number, data: object|string }>}
 */
function httpRequest(method, urlStr, body, { timeoutMs = REQUEST_TIMEOUT_MS, jsonMode = false, extraHeaders = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url    = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib    = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers:  {},
      agent:    isHttps ? httpsAgent : httpAgent,
    };

    let postData = null;
    if (body) {
      if (jsonMode) {
        postData = JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
      } else {
        postData = new URLSearchParams(body).toString();
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    // 附加额外请求头
    Object.entries(extraHeaders).forEach(([key, value]) => {
      options.headers[key] = value;
    });

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', (err) => reject(new Error(`网络请求失败：${err.message}`)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`请求超时（${timeoutMs / 1000}s）`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// ── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 延迟指定毫秒
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断错误是否可重试
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  const status = err.status || 0;
  return status === 429 || (status >= 500 && status < 600) || err.message.includes('超时');
}

// ── API 操作 ────────────────────────────────────────────────────────────────

/**
 * 获取 PR 评论列表（自动分页获取全部）
 *
 * @param {object} params
 * @param {string} params.owner    - 仓库所属空间
 * @param {string} params.repo     - 仓库名称
 * @param {number} params.prNumber - PR 序号
 * @param {string} params.token    - Access Token
 * @returns {Promise<Array>} 评论列表
 */
async function listPrComments({ owner, repo, prNumber, token }) {
  let page       = 1;
  const perPage  = 100;
  let allComments = [];

  while (true) {
    const url = `${GITCODE_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/comments`
      + `?access_token=${encodeURIComponent(token)}&per_page=${perPage}&page=${page}`;

    const { status, data } = await httpRequest('GET', url);

    if (status !== 200) {
      const errMsg = typeof data === 'object'
        ? (data.message || data.error_message || JSON.stringify(data))
        : String(data);
      throw Object.assign(
        new Error(`获取评论失败: HTTP ${status} — ${errMsg}`),
        { status }
      );
    }

    if (!Array.isArray(data)) {
      break;
    }

    allComments = allComments.concat(data);

    // 不足一页说明已到末尾
    if (data.length < perPage) break;
    page++;
  }

  return allComments;
}

/**
 * 预览 PR 检视意见（按 resolved 字段分类）
 *
 * @param {string} prUrl - PR 完整地址
 * @param {string} token - Access Token
 * @returns {Promise<{ owner: string, repo: string, prNumber: number, total: number, unresolved: Array, resolved: Array }>}
 */
async function previewComments(prUrl, token) {
  const { owner, repo, prNumber } = parsePrUrl(prUrl);

  if (!prNumber) {
    throw new Error('PR 地址中缺少 PR 序号，请使用 /pull/{number} 格式');
  }

  const comments = await listPrComments({ owner, repo, prNumber, token });

  // 只有 diff_comment（代码行级检视意见）才能被 resolve
  // pr_comment（普通评论）不支持 resolve 操作
  const reviewableComments = comments.filter((c) => c.comment_type === 'diff_comment');
  const prComments        = comments.filter((c) => c.comment_type !== 'diff_comment');

  const unresolved = reviewableComments.filter((c) => !c.resolved);
  const resolved   = reviewableComments.filter((c) => c.resolved);

  return {
    owner,
    repo,
    prNumber,
    total:     comments.length,
    reviewable: reviewableComments.length,
    prCommentsCount: prComments.length,
    unresolved,
    resolved,
  };
}

/**
 * 解决单条检视意见
 *
 * @param {object} params
 * @param {string} params.owner       - 仓库所属空间
 * @param {string} params.repo        - 仓库名称
 * @param {number} params.prNumber    - PR 序号
 * @param {string} params.discussionId - 讨论 ID
 * @param {string} params.token       - Access Token
 * @returns {Promise<{ success: boolean, discussionId: string, errorMessage?: string }>}
 */
async function resolveComment({ owner, repo, prNumber, discussionId, token }) {
  const apiUrl = `${GITCODE_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/comments/${encodeURIComponent(discussionId)}`
    + `?access_token=${encodeURIComponent(token)}`;

  try {
    const { status, data } = await httpRequest('PUT', apiUrl, { resolved: true }, { jsonMode: true });

    if (status === 200 || status === 201) {
      return { success: true, discussionId };
    }

    const errMsg = typeof data === 'object'
      ? (data.message || data.error_message || JSON.stringify(data))
      : String(data);

    return {
      success:       false,
      discussionId,
      errorMessage: `HTTP ${status} — ${errMsg}`,
    };
  } catch (err) {
    return {
      success:       false,
      discussionId,
      errorMessage: err.message,
    };
  }
}

/**
 * 带重试的解决单条检视意见
 *
 * @param {object} params     - 同 resolveComment
 * @param {number} [retryCount=0] - 当前重试次数
 * @returns {Promise<{ success: boolean, discussionId: string, errorMessage?: string }>}
 */
async function resolveCommentWithRetry(params, retryCount = 0) {
  try {
    return await resolveComment(params);
  } catch (err) {
    if (retryCount < MAX_RETRIES && isRetryableError(err)) {
      await sleep(RETRY_DELAY_MS * (retryCount + 1));
      return resolveCommentWithRetry(params, retryCount + 1);
    }
    return {
      success:       false,
      discussionId:  params.discussionId,
      errorMessage:  err.message,
    };
  }
}

// ── PR 审批（通过审查）──────────────────────────────────────────────────

/**
 * 通过 PR 审查（Approve Review）
 *
 * GitCode API: POST /api/v5/repos/{owner}/{repo}/pulls/{number}/review
 * 注意：不使用强制合入（force），仅普通审批
 *
 * @param {object} params
 * @param {string} params.owner    - 仓库所属空间
 * @param {string} params.repo     - 仓库名称
 * @param {number} params.prNumber - PR 序号
 * @param {string} params.token    - Access Token
 * @returns {Promise<{ success: boolean, errorMessage?: string }>}
 */
async function approveReview({ owner, repo, prNumber, token }) {
  // 使用 gitcode.com 域名（与 resolve comment API 一致，兼容 access_token 认证）
  const apiUrl = `${GITCODE_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/review`
    + `?access_token=${encodeURIComponent(token)}`;

  try {
    const { status, data } = await httpRequest('POST', apiUrl, {}, {
      jsonMode: true,
      extraHeaders: { 'private-token': token },
    });

    // 安全日志：仅记录状态码，不记录可能含 token 的响应体
    console.log(`[PrCheck] approveReview: HTTP ${status}`);

    // 2xx 均视为成功（GitCode 审批通过返回 204 No Content）
    if (status >= 200 && status < 300) {
      return { success: true };
    }

    const errMsg = typeof data === 'object'
      ? (data.message || data.error_message || '未知错误')
      : String(data).substring(0, 200);

    return {
      success:      false,
      errorMessage: `审批失败: HTTP ${status} — ${errMsg}`,
    };
  } catch (err) {
    return {
      success:      false,
      errorMessage: `审批请求异常: ${err.message}`,
    };
  }
}

// ── 批量解决 ────────────────────────────────────────────────────────────────

/**
 * 批量解决检视意见，并在解决后自动审批通过审查
 *
 * @param {string}   prUrl         - PR 完整地址
 * @param {string}   token         - Access Token
 * @param {string[]} [discussionIds] - 指定解决的 discussion_id 列表，为空则解决所有未解决意见
 * @returns {Promise<{ total: number, resolved: number, failed: number, details: Array, reviewApproved: boolean|null, reviewError: string }>}
 */
async function resolveComments(prUrl, token, discussionIds) {
  const parsed = parsePrUrl(prUrl);

  if (!parsed.prNumber) {
    throw new Error('PR 地址中缺少 PR 序号，请使用 /pull/{number} 格式');
  }

  const { owner, repo, prNumber } = parsed;

  // 获取当前评论列表
  const comments = await listPrComments({ owner, repo, prNumber, token });

  // 确定待解决列表（仅 diff_comment 类型可被 resolve）
  const reviewableComments = comments.filter((c) => c.comment_type === 'diff_comment');

  let unresolvedList;
  if (discussionIds && discussionIds.length > 0) {
    // 用户指定了 discussion_id，从中筛选出未解决的 diff_comment
    const idSet = new Set(discussionIds);
    unresolvedList = reviewableComments.filter((c) => idSet.has(c.discussion_id) && !c.resolved);
  } else {
    // 未指定则解决所有未解决的 diff_comment
    unresolvedList = reviewableComments.filter((c) => !c.resolved);
  }

  const details = [];
  let resolvedCount = 0;
  let failedCount   = 0;

  if (unresolvedList.length === 0) {
    // 无待解决意见，直接审批
    const reviewResult = await approveReview({ owner, repo, prNumber, token });
    return {
      total:    0,
      resolved: 0,
      failed:   0,
      details:  [],
      reviewApproved: reviewResult.success,
      reviewError:    reviewResult.success ? '' : reviewResult.errorMessage,
    };
  }

  // ── 并发 worker 池：限制同时请求数，避免 429 ──────────────────────────
  let reviewPromise = null;

  await new Promise((poolDone) => {
    let idx = 0;
    let running = 0;

    function next() {
      // 所有任务已入队且全部完成 → 释放池
      if (idx >= unresolvedList.length && running === 0) {
        poolDone();
        return;
      }

      // 填充至并发上限
      while (running < CONCURRENCY && idx < unresolvedList.length) {
        const item = unresolvedList[idx++];
        running++;

        // 最后一批启动时，同步发起审批请求（与 resolve 并行）
        if (idx >= unresolvedList.length && !reviewPromise) {
          reviewPromise = approveReview({ owner, repo, prNumber, token });
        }

        resolveCommentWithRetry({
          owner,
          repo,
          prNumber,
          discussionId: item.discussion_id,
          token,
        })
          .then((result) => {
            details.push(result);
            if (result.success) resolvedCount++; else failedCount++;
          })
          .catch((err) => {
            details.push({ success: false, discussionId: item.discussion_id, errorMessage: err.message });
            failedCount++;
          })
          .finally(() => {
            running--;
            // 批次间短暂间隔，仅当还有后续任务时
            if (idx < unresolvedList.length) {
              setTimeout(next, BATCH_DELAY_MS);
            } else {
              next();
            }
          });
      }
    }

    next();
  });

  // 若池中未触发审批（仅 1 条或并发刚好没走到分支），在此补充
  if (!reviewPromise && (resolvedCount > 0 || unresolvedList.length === 0)) {
    reviewPromise = approveReview({ owner, repo, prNumber, token });
  }

  const reviewResult = reviewPromise ? await reviewPromise : null;

  return {
    total:    unresolvedList.length,
    resolved: resolvedCount,
    failed:   failedCount,
    details,
    reviewApproved: reviewResult ? reviewResult.success : null,
    reviewError:    reviewResult && !reviewResult.success ? reviewResult.errorMessage : '',
  };
}

module.exports = {
  parsePrUrl,
  listPrComments,
  previewComments,
  resolveComment,
  resolveComments,
  approveReview,
};
