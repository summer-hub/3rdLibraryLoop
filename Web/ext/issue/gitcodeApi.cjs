/**
 * GitCode API — Issue 查询客户端
 *
 * 职责：
 *  1. 调用 GitCode REST API 获取组织下所有仓库的打开状态 Issue
 *  2. 判断每个 Issue 是否已有评论回复
 *  3. Token 由服务端环境变量 GITCODE_TOKEN 统一配置，调用方传入
 *
 * GitCode API 端点：
 *  - 组织仓库列表：GET /api/v5/orgs/{org}/repos
 *  - 仓库 Issue 列表：GET /api/v5/repos/{owner}/{repo}/issues?state=open
 *  - Issue 评论列表：GET /api/v5/repos/{owner}/{repo}/issues/{number}/comments
 */

'use strict';

const https = require('node:https');
const http  = require('node:http');

/** GitCode API 基础 URL */
const GITCODE_API_BASE = 'https://gitcode.com/api/v5';

/** 每页记录数（GitCode API 最大 100） */
const PER_PAGE = 100;

/** 单次请求超时（ms） */
const REQUEST_TIMEOUT_MS = 15000;

/** 重试配置 */
const MAX_RETRIES    = 2;
const RETRY_DELAY_MS = 500;

/** 限流保护配置（GitCode 阈值 250 次/分钟） */
const RATE_WINDOW_MS         = 60_000;
const RATE_MAX_PER_WINDOW    = 220;     // 留 30 次安全余量
const RATE_LIMIT_MAX_RETRIES = 10;      // 429 最多重试 10 次
const RATE_LIMIT_WAIT_MS     = 62_000;  // 等待略超 1 分钟

/** 支持查询的组织列表 */
const ORGANIZATIONS = Object.freeze([
  'CPF-ApplicationTPC',
  'CPF-flutter',
  'CPF-rn',
  'CPF-KMP-CMP',
]);

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

/**
 * 通用 HTTP GET 请求函数（带查询参数）
 *
 * @param {string} urlStr    - 完整 URL（含查询参数）
 * @param {number} [timeoutMs=15000] - 超时时间
 * @returns {Promise<{ status: number, data: object|string }>}
 */
function httpGet(urlStr, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'GET',
      headers:  { 'Accept': 'application/json' },
      agent:    isHttps ? httpsAgent : httpAgent,
    };

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
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('error', (err) => reject(new Error(`网络请求失败：${err.message}`)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`请求超时（${timeoutMs / 1000}s）`));
    });

    req.end();
  });
}

/**
 * 延迟指定毫秒
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 全局限流保护（GitCode 限流 250 次/分钟，滑动窗口算法） ───────────────────
const _rateTimestamps = [];

/**
 * 获取限流令牌（滑动窗口）
 *
 * 维护一个 60 秒滑动窗口，当窗口内请求数达到上限时自动阻塞等待。
 * 所有 HTTP 请求（含重试）都经过此函数，确保不超 250 次/分钟。
 */
async function acquireRateSlot() {
  while (true) {
    const now = Date.now();
    // 清理已滑出窗口的时间戳
    while (_rateTimestamps.length > 0 && _rateTimestamps[0] <= now - RATE_WINDOW_MS) {
      _rateTimestamps.shift();
    }

    if (_rateTimestamps.length < RATE_MAX_PER_WINDOW) {
      _rateTimestamps.push(now);
      return;
    }

    // 窗口已满，等待最早请求滑出窗口后再继续
    const waitMs = _rateTimestamps[0] + RATE_WINDOW_MS - now + 200;
    await sleep(waitMs);
  }
}

/**
 * 判断错误是否可重试
 * @param {{ status?: number, message?: string }} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  const status = err.status || 0;
  return status === 429 || (status >= 500 && status < 600) ||
    (err.message && err.message.includes('超时'));
}

/**
 * 带重试的 GET 请求
 *
 * 重试策略：
 *  - 429 限流：读取 Retry-After 头或默认等待 62 秒，最多重试 10 次
 *  - 5xx 服务端错误：短延迟重试，最多 2 次
 *  - 其他 4xx：不重试，直接抛出
 *  - 网络超时：短延迟重试，最多 2 次
 *
 * 每次请求（含重试）都经过全局限流器 acquireRateSlot()，
 * 确保 60 秒窗口内不超过 220 次请求，从源头避免触发 429。
 *
 * @param {string} urlStr - 请求 URL
 * @param {number} [timeoutMs] - 超时时间
 * @returns {Promise<{ status: number, data: object|string }>}
 * @throws {Error} 重试耗尽后抛出最后一个错误
 */
async function getWithRetry(urlStr, timeoutMs) {
  let retries429 = 0;
  let retries5xx = 0;

  while (true) {
    // 全局限流：确保 60 秒窗口内不超过 220 次请求
    await acquireRateSlot();

    let status, data, headers;
    try {
      ({ status, data, headers } = await httpGet(urlStr, timeoutMs));
    } catch (err) {
      // 网络错误 / 超时 — 短延迟重试
      if (retries5xx >= MAX_RETRIES) {
        throw err;
      }
      retries5xx++;
      await sleep(RETRY_DELAY_MS * retries5xx);
      continue;
    }

    if (status >= 200 && status < 300) {
      return { status, data };
    }

    const errMsg = typeof data === 'object'
      ? (data.error_message || data.message || data.error || JSON.stringify(data))
      : String(data);

    if (status === 429) {
      // 限流 — 等待 Retry-After 或默认 62 秒后重试
      retries429++;
      if (retries429 > RATE_LIMIT_MAX_RETRIES) {
        throw Object.assign(
          new Error(`GitCode API 返回 ${status}：${errMsg}（已重试 ${retries429 - 1} 次仍被限流）`),
          { status }
        );
      }
      const retryAfter = headers?.['retry-after'];
      const waitMs = retryAfter
        ? Math.min(parseInt(retryAfter, 10) * 1000, 120_000)
        : RATE_LIMIT_WAIT_MS;
      await sleep(waitMs);
      continue;
    }

    if (status >= 500 && status < 600) {
      // 服务端错误 — 短延迟重试
      retries5xx++;
      if (retries5xx > MAX_RETRIES) {
        throw Object.assign(
          new Error(`GitCode API 返回 ${status}：${errMsg}`),
          { status }
        );
      }
      await sleep(RETRY_DELAY_MS * retries5xx);
      continue;
    }

    // 其他 4xx — 不重试
    throw Object.assign(
      new Error(`GitCode API 返回 ${status}：${errMsg}`),
      { status }
    );
  }
}

/**
 * 拼接 URL 查询参数
 *
 * @param {string} baseUrl - 基础 URL
 * @param {Record<string, string|number>} params - 查询参数
 * @returns {string} 完整 URL
 */
function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// ──────────────────────────────────────────────────────────────────────────────
//  组织仓库列表获取
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 获取组织下所有仓库列表（分页获取全部）
 *
 * @param {object} params
 * @param {string} params.org    - 组织名
 * @param {string} params.token  - GitCode Access Token
 * @returns {Promise<Array<{ name: string, full_name: string, html_url: string }>>}
 */
async function getOrgRepos({ org, token }) {
  if (!org)   throw new Error('组织名不能为空');
  if (!token) throw new Error('GitCode Token 不能为空');

  const repos = [];
  let page = 1;

  while (true) {
    const url = buildUrl(`${GITCODE_API_BASE}/orgs/${encodeURIComponent(org)}/repos`, {
      access_token: token,
      page,
      per_page:     PER_PAGE,
    });

    const { data } = await getWithRetry(url);

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const repo of data) {
      repos.push({
        name:     repo.name || '',
        fullName: repo.full_name || `${org}/${repo.name}`,
        htmlUrl:  repo.html_url || '',
      });
    }

    if (data.length < PER_PAGE) {
      break;
    }

    page++;
  }

  return repos;
}

// ──────────────────────────────────────────────────────────────────────────────
//  仓库 Issue 列表获取
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 获取仓库中所有打开状态的 Issue（分页获取全部）
 *
 * @param {object} params
 * @param {string} params.owner  - 仓库所有者（组织名）
 * @param {string} params.repo   - 仓库名
 * @param {string} params.token  - GitCode Access Token
 * @returns {Promise<Array<object>>} 原始 Issue 对象列表
 */
async function getRepoIssues({ owner, repo, token }) {
  if (!owner) throw new Error('owner 不能为空');
  if (!repo)  throw new Error('repo 不能为空');
  if (!token) throw new Error('Token 不能为空');

  const issues = [];
  let page = 1;

  while (true) {
    const url = buildUrl(
      `${GITCODE_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      {
        access_token: token,
        state:    'open',
        page,
        per_page: PER_PAGE,
      }
    );

    const { data } = await getWithRetry(url);

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    issues.push(...data);

    if (data.length < PER_PAGE) {
      break;
    }

    page++;
  }

  return issues;
}

/**
 * 获取 Issue 的评论列表（分页获取全部）
 *
 * @param {object} params
 * @param {string} params.owner   - 仓库所有者
 * @param {string} params.repo    - 仓库名
 * @param {number} params.number  - Issue 编号
 * @param {string} params.token   - GitCode Access Token
 * @returns {Promise<Array<object>>} 评论列表
 */
async function getIssueComments({ owner, repo, number, token }) {
  if (!owner)  throw new Error('owner 不能为空');
  if (!repo)   throw new Error('repo 不能为空');
  if (!number) throw new Error('issue number 不能为空');
  if (!token)  throw new Error('Token 不能为空');

  const comments = [];
  let page = 1;

  while (true) {
    const url = buildUrl(
      `${GITCODE_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`,
      {
        access_token: token,
        page,
        per_page: PER_PAGE,
      }
    );

    const { data } = await getWithRetry(url);

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    comments.push(...data);

    if (data.length < PER_PAGE) {
      break;
    }

    page++;
  }

  return comments;
}

/**
 * 判断 Issue 是否已有回复
 *
 * 判断逻辑：
 *  GitCode API 的 issue 对象中有 comments_count 字段，>0 即已有回复。
 *  如果 comments_count 不存在或为 0，再通过评论接口确认。
 *
 * @param {object} issue - 原始 Issue 对象
 * @returns {boolean}
 */
function hasReply(issue) {
  const count = issue.comments_count ?? issue.comments ?? 0;
  return count > 0;
}

// ──────────────────────────────────────────────────────────────────────────────
//  组织 Issue 汇总
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 获取组织下所有仓库的 Issue 汇总数据
 *
 * 流程：
 *  1. 获取组织所有仓库列表
 *  2. 并行获取每个仓库的 open issue 列表
 *  3. 汇总为标准格式
 *
 * @param {object} params
 * @param {string} params.org    - 组织名
 * @param {string} params.token  - GitCode Access Token
 * @param {(progress: string) => void} [onProgress] - 进度回调
 * @returns {Promise<Array<IssueRecord>>}
 */
async function fetchOrgIssues({ org, token, onProgress }) {
  if (!ORGANIZATIONS.includes(org)) {
    throw new Error(`不支持的组织：${org}，支持的组织：${ORGANIZATIONS.join(', ')}`);
  }

  const report = (msg) => {
    if (typeof onProgress === 'function') onProgress(msg);
  };

  report(`正在获取组织 ${org} 的仓库列表…`);

  // Step 1: 获取仓库列表
  const repos = await getOrgRepos({ org, token });
  report(`组织 ${org} 共有 ${repos.length} 个仓库`);

  // Step 2: 并行获取每个仓库的 issue（控制并发数 + 全局限流）
  const CONCURRENCY = 3;
  const allIssues = [];
  const failedRepos = [];  // 记录失败的仓库，后续二次重试

  /**
   * 获取单个仓库的 issue 并追加到 allIssues
   * @param {{ name: string, fullName: string, htmlUrl: string }} repo
   * @returns {Promise<boolean>} true=成功, false=失败
   */
  async function processRepo(repo) {
    try {
      const issues = await getRepoIssues({
        owner: org,
        repo:  repo.name,
        token,
      });
      for (const issue of issues) {
        // 过滤 PR（GitCode API 的 issues 接口可能返回 PR，通过 pull_request 字段区分）
        if (issue.pull_request) continue;

        allIssues.push({
          issueUrl:  issue.html_url || '',
          // 仓库名称仅存具体仓库名（不含 "组织/" 前缀，组织信息由 org 字段单独承载）
          repoName:  repo.name || repo.fullName || '',
          hasReply:  hasReply(issue),
          createdAt: issue.created_at || '',
          updatedAt: issue.updated_at || issue.created_at || '',
          title:     issue.title || '',
          number:    issue.number || 0,
          org:       org,
          username:  issue.user?.login || issue.user?.name || '',
        });
      }
      return true;
    } catch (err) {
      console.error(`[Issue] 获取仓库 ${repo.fullName} 的 issue 失败：${err.message}`);
      return false;
    }
  }

  for (let i = 0; i < repos.length; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map((repo) => processRepo(repo))
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'rejected' || results[j].value === false) {
        failedRepos.push(batch[j]);
      }
    }

    report(`已处理 ${Math.min(i + CONCURRENCY, repos.length)}/${repos.length} 个仓库，累计 ${allIssues.length} 条 issue${failedRepos.length > 0 ? `，失败 ${failedRepos.length} 个` : ''}`);
  }

  // Step 3: 二次重试失败的仓库（逐个串行，此时限流窗口通常已恢复）
  if (failedRepos.length > 0) {
    report(`开始重试 ${failedRepos.length} 个失败的仓库…`);
    const stillFailed = [];

    for (let i = 0; i < failedRepos.length; i++) {
      const repo = failedRepos[i];
      const ok = await processRepo(repo);
      if (!ok) {
        stillFailed.push(repo);
      }
      report(`重试进度 ${i + 1}/${failedRepos.length}${stillFailed.length > 0 ? `，仍失败 ${stillFailed.length} 个` : ''}`);
    }

    if (stillFailed.length > 0) {
      report(`仍有 ${stillFailed.length} 个仓库获取失败：${stillFailed.map((r) => r.fullName).join(', ')}`);
    }
  }

  // 按提出时间降序排列（最新优先）
  allIssues.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  report(`组织 ${org} 共获取 ${allIssues.length} 条 issue`);

  return allIssues;
}

module.exports = {
  fetchOrgIssues,
  getOrgRepos,
  getRepoIssues,
  getIssueComments,
  hasReply,
  ORGANIZATIONS,
  GITCODE_API_BASE,
};
