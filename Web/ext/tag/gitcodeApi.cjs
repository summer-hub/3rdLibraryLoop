/**
 * GitCode API — GitCode 平台 TAG 操作客户端
 *
 * 职责：
 *  1. 调用 GitCode REST API 创建 TAG
 *  2. 解析仓库地址，提取 owner/repo
 *  3. 不存储 Token，每次操作由调用方传入
 *
 * GitCode API 文档参考：
 *  - 创建 TAG：POST /api/v5/repos/{owner}/{repo}/tags
 *  - 请求参数：access_token, tag_name, refs (分支名或 commit SHA), tag_message
 */

'use strict';

const https = require('node:https');
const http  = require('node:http');

/** GitCode API 基础 URL */
const GITCODE_API_BASE = 'https://gitcode.com/api/v5';

/** 重试配置 */
const MAX_RETRIES    = 2;
const RETRY_DELAY_MS = 500;

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

/**
 * 解析 GitCode 仓库地址，提取 owner 和 repo
 *
 * 支持格式：
 *  - https://gitcode.com/owner/repo
 *  - https://gitcode.com/owner/repo.git
 *  - https://gitcode.com/owner/repo/tree/branch
 *  - https://gitcode.com/owner/repo/blob/branch/path
 *
 * @param {string} repoUrl - 仓库地址
 * @returns {{ owner: string, repo: string }} 解析结果
 * @throws {Error} 地址格式无效或非 GitCode 域名
 */
function parseRepoUrl(repoUrl) {
  try {
    const url = new URL(repoUrl);
    if (!url.hostname.includes('gitcode.com')) {
      throw new Error('仅支持 gitcode.com 仓库地址');
    }

    // 去掉开头的 /，按 / 分段
    const parts = url.pathname.replace(/^\/+/, '').split('/');

    if (parts.length < 2) {
      throw new Error('仓库地址格式无效，需包含 owner/repo');
    }

    const owner = parts[0];
    let repo = parts[1];

    // 去掉 .git 后缀
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }

    if (!owner || !repo) {
      throw new Error('仓库地址格式无效，owner 或 repo 为空');
    }

    return { owner, repo };
  } catch (err) {
    if (err.message.includes('仅支持') || err.message.includes('格式无效') || err.message.includes('为空')) {
      throw err;
    }
    throw new Error(`仓库地址解析失败：${err.message}`);
  }
}

/**
 * 通用 HTTP 请求函数
 * @param {string} method - HTTP 方法
 * @param {string} urlStr - 完整 URL
 * @param {object} [body] - 请求体
 * @param {number} [timeoutMs=15000] - 超时时间
 * @returns {Promise<{ status: number, data: object|string }>}
 */
function httpRequest(method, urlStr, body, timeoutMs = 15000, jsonMode = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

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
 * @param {Error|object} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  const status = err.status || 0;
  return status === 429 || (status >= 500 && status < 600) ||
    (err.message && err.message.includes('超时'));
}

/**
 * 在 GitCode 上创建 TAG（带重试）
 *
 * @param {object} params
 * @param {string} params.repoUrl   - 仓库地址
 * @param {string} params.ref       - Commit ID 或分支名称
 * @param {string} params.tagName   - TAG 名称
 * @param {string} params.tagDesc   - TAG 描述
 * @param {string} params.token     - GitCode Access Token
 * @returns {Promise<{ success: boolean, tagUrl?: string, errorMessage?: string }>}
 */
async function createTag({ repoUrl, ref, tagName, tagDesc, token }) {
  // 参数校验
  if (!repoUrl)   return { success: false, errorMessage: '仓库地址不能为空' };
  if (!ref)       return { success: false, errorMessage: 'Commit ID 或分支名称不能为空' };
  if (!tagName)   return { success: false, errorMessage: 'TAG 名称不能为空' };
  if (!token)     return { success: false, errorMessage: 'GitCode Token 不能为空' };

  // 解析仓库地址
  let owner, repo;
  try {
    ({ owner, repo } = parseRepoUrl(repoUrl));
  } catch (err) {
    return { success: false, errorMessage: err.message };
  }

  // 调用 GitCode API
  const apiUrl = `${GITCODE_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags`;

  const requestBody = {
    access_token: token,
    tag_name:     tagName,
    refs:         ref,
  };

  // TAG 描述是可选的
  if (tagDesc) {
    requestBody.tag_message = tagDesc;
  }

  try {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { status, data } = await httpRequest('POST', apiUrl, requestBody);

        // 成功：HTTP 201 Created
        if (status === 201 && data) {
          const tagUrl = data.web_url || `${repoUrl}/tree/${tagName}`;
          return { success: true, tagUrl };
        }

        // TAG 已存在：HTTP 409（不重试）
        if (status === 409) {
          return {
            success: false,
            errorMessage: `TAG "${tagName}" 已存在`,
          };
        }

        // 4xx 客户端错误（不含 429）不重试
        if (status >= 400 && status < 500 && status !== 429) {
          const errMsg = typeof data === 'object'
            ? (data.error_message || data.message || data.error || JSON.stringify(data))
            : String(data);
          return {
            success: false,
            errorMessage: `GitCode API 返回 ${status}：${errMsg}`,
          };
        }

        // 429 / 5xx：可重试
        const errMsg = typeof data === 'object'
          ? (data.error_message || data.message || data.error || JSON.stringify(data))
          : String(data);
        lastError = Object.assign(
          new Error(`GitCode API 返回 ${status}：${errMsg}`),
          { status }
        );

        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
      } catch (err) {
        // 网络异常：超时等可重试
        lastError = err;
        if (attempt < MAX_RETRIES && isRetryableError(err)) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        // 非可重试的网络错误，直接返回
        return {
          success: false,
          errorMessage: `打 TAG 请求失败：${err.message}`,
        };
      }
    }

    // 重试耗尽
    return {
      success: false,
      errorMessage: lastError ? lastError.message : '未知错误',
    };
  } catch (err) {
    return {
      success: false,
      errorMessage: `打 TAG 请求失败：${err.message}`,
    };
  }
}

module.exports = { createTag, parseRepoUrl };
