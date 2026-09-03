#!/usr/bin/env node
/**
 * @tool gitcode-fork
 * @description gitcode-repo-fork SKILL 的 GitCode Fork 辅助脚本：Token 用户查询、仓库信息（含权限与 parent 源仓库）、Fork 存在性探测、创建 Fork（内置幂等回查与就绪轮询）、分支存在性探测。所有请求统一使用 Authorization: Bearer 头认证（POST 写操作必须，GET 一致处理），避免 form body 内 token 被拒（401）。
 * @param token: string - GitCode API Token（也可用环境变量 GIT_TOKEN 或 Server/.env 的 GIT_TOKEN）
 * @param owner: string - 仓库所属空间（owner/组织）
 * @param repo: string - 仓库名
 * 子命令:
 *   get-user                                    获取 Token 用户信息（fork 目标 namespace）
 *   get-repo --owner x --repo y [--allow-missing]
 *                                              获取仓库信息（id/default_branch/parent/permissions）；
 *                                              --allow-missing 时 404 返回 {exists:false} 而非报错
 *   get-branch --owner x --repo y --branch b    探测分支是否存在（200 存在 / 404 不存在）
 *   create-fork --owner x --repo y [--name n] [--fork-owner me] [--timeout s]
 *                                              创建 Fork 到 Token 用户名下（POST /repos/{owner}/{repo}/forks，
 *                                              仅 fork 源仓库本身）；失败时自动回查已有 Fork（reused:true）；
 *                                              创建后自动轮询就绪（Fork 为异步操作）。
 *                                              --fork-owner：Token 无 read_user scope（GET /user 403）时
 *                                              必传，用于指定 Fork 目标用户名（跳过 /user 查询）
 *   wait-fork --owner x --repo y [--timeout s] [--interval s]
 *                                              轮询 Fork 仓库可访问（刚创建的 Fork 可能短暂 404）
 * 用法示例:
 *   node gitcode-fork.cjs get-user --token "$GIT_TOKEN"
 *   node gitcode-fork.cjs create-fork --token "$GIT_TOKEN" --owner CPF-RN --repo rntpc_lib --timeout 60
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');

const BASE = 'https://gitcode.com/api/v5';

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function die(msg, code = 1) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(code);
}

function requireParam(args, names) {
  for (const n of names) {
    if (!args[n] || args[n] === true) die(`缺少必填参数 --${n.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
  }
}

// ---------- HTTP ----------
/**
 * 统一 Bearer 头认证（POST 写操作必须：token 放 form body 会被拒 401 token not found，
 * 见 references/GITCODE_FORK_API.md 踩坑记录）。
 * @param opts.allow404 boolean - 404 时返回 null（不 die），用于探测类调用
 */
async function api(method, endpoint, params, token, opts = {}) {
  const url = new URL(BASE + endpoint);
  const headers = { Authorization: `Bearer ${token}` };
  let body = null;
  if (method === 'GET') {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) search.set(k, String(v));
    url.search = search.toString();
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) form.set(k, String(v));
    body = form.toString();
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    if (opts.allow404 && res.status === 404) return null;
    const err = new Error(`GitCode API ${method} ${endpoint} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---------- Token 加载 ----------
function resolveToken(args) {
  if (args.token && args.token !== true) return args.token;
  if (process.env.GIT_TOKEN) return process.env.GIT_TOKEN;
  // 从 SKILL 目录向上回溯读取 Server/.env 的 GIT_TOKEN
  // 本脚本位于 Server/Skills/gitcode-repo-fork/scripts/ → .env 在 ../../../.env
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      const m = fs.readFileSync(envPath, 'utf8').match(/^GIT_TOKEN=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    dir = path.dirname(dir);
  }
  return null;
}

// ---------- 结果提取 ----------
function pickRepo(r, owner, repo) {
  const parent = (r.parent && (r.parent.path_with_namespace || r.parent.full_path)) || null;
  const perms = r.permissions && typeof r.permissions === 'object'
    ? {
        pull: !!r.permissions.pull,
        push: !!r.permissions.push,
        admin: !!r.permissions.admin,
      }
    : null;
  return {
    exists: true,
    id: r.id,
    owner: (r.namespace && (r.namespace.path || r.namespace.name)) || (r.owner && (r.owner.login || r.owner.name)) || owner,
    repo: r.path || repo,
    pathWithNamespace: r.full_path || r.path_with_namespace || `${owner}/${repo}`,
    defaultBranch: r.default_branch || 'master',
    fork: !!(r.fork || parent),
    parent, // fork 仓库的直接源仓库（上游推断依据，ohos-lib-pr-push Phase 1.1 d 复用）
    permissions: perms,
    url: `https://gitcode.com/${(r.full_path || r.path_with_namespace || `${owner}/${repo}`).replace(/^\//, '')}`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- 子命令 ----------
async function cmdGetUser(token) {
  const u = await api('GET', '/user', {}, token);
  console.log(JSON.stringify({
    ok: true,
    username: u.login || u.username, // 登录名 = fork 目标 namespace
    name: u.name,
    email: u.email,
    id: u.id,
  }, null, 2));
}

async function cmdGetRepo(args, token) {
  requireParam(args, ['owner', 'repo']);
  const allowMissing = args.allowMissing === true;
  const r = await api('GET', `/repos/${args.owner}/${args.repo}`, {}, token, { allow404: allowMissing });
  if (!r) {
    console.log(JSON.stringify({ ok: true, exists: false, owner: args.owner, repo: args.repo }, null, 2));
    return;
  }
  console.log(JSON.stringify({ ok: true, ...pickRepo(r, args.owner, args.repo) }, null, 2));
}

async function cmdGetBranch(args, token) {
  requireParam(args, ['owner', 'repo', 'branch']);
  const b = await api('GET', `/repos/${args.owner}/${args.repo}/branches/${encodeURIComponent(args.branch)}`, {}, token, { allow404: true });
  console.log(JSON.stringify({ ok: true, exists: !!b, branch: (b && b.name) || args.branch }, null, 2));
}

async function waitForFork(token, owner, repo, timeoutSec, intervalSec) {
  const start = Date.now();
  const timeoutMs = timeoutSec * 1000;
  const intervalMs = intervalSec * 1000;
  // Fork 为异步操作：POST 成功后仓库可能短暂 404，轮询直到可访问
  for (;;) {
    const r = await api('GET', `/repos/${owner}/${repo}`, {}, token, { allow404: true });
    if (r) {
      return { waitedMs: Date.now() - start, repo: pickRepo(r, owner, repo) };
    }
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`等待 Fork 就绪超时（${timeoutSec}s）：${owner}/${repo} 仍不可访问。Fork 可能仍在后台创建，请稍后用 wait-fork 重试`);
    }
    await sleep(intervalMs);
  }
}

async function cmdCreateFork(args, token) {
  requireParam(args, ['owner', 'repo']);
  const timeoutSec = parseInt(args.timeout, 10) || 60;
  const forkName = (typeof args.name === 'string' && args.name) || args.repo;

  // Fork 目标 namespace = Token 用户名下。
  // 实测：Token 可能无 read_user scope（GET /user -> 403 no scopes:read_user），
  // 此时必须由 --fork-owner 显式指定，否则给出可操作的错误提示。
  let forkOwner;
  if (typeof args.forkOwner === 'string' && args.forkOwner) {
    forkOwner = args.forkOwner;
  } else {
    let user;
    try {
      user = await api('GET', '/user', {}, token);
    } catch (e) {
      if (e.status === 403) {
        die(`获取 Token 用户失败（${e.message.slice(0, 200)}）。请传 --fork-owner 指定 Fork 目标用户名，或为 Token 增加 read_user scope 后重试`);
      }
      throw e;
    }
    forkOwner = user.login || user.username;
  }

  // 先探测幂等：已有 Fork 直接复用（避免依赖平台的"已存在"错误语义）
  const existing = await api('GET', `/repos/${forkOwner}/${forkName}`, {}, token, { allow404: true });
  if (existing) {
    console.log(JSON.stringify({
      ok: true, reused: true, note: 'Fork 已存在，直接复用（请校验 parent 是否指向目标源仓库）',
      ...pickRepo(existing, forkOwner, forkName),
    }, null, 2));
    return;
  }

  // 创建 Fork（POST 必须 Bearer 头认证，token 不进 form body）
  const params = {};
  if (typeof args.name === 'string' && args.name) params.name = args.name;
  let created;
  try {
    created = await api('POST', `/repos/${args.owner}/${args.repo}/forks`, params, token);
  } catch (e) {
    // 幂等回查：创建失败但仓库已出现（并发/平台异步语义）→ 复用；否则透出原始错误
    const retry = await api('GET', `/repos/${forkOwner}/${forkName}`, {}, token, { allow404: true });
    if (retry) {
      console.log(JSON.stringify({
        ok: true, reused: true, note: `create-fork 报错但 Fork 已存在，自动复用（原始错误：${e.message.slice(0, 200)}）`,
        ...pickRepo(retry, forkOwner, forkName),
      }, null, 2));
      return;
    }
    die(e.message);
  }

  // 响应可能是 fork 仓库对象，也可能只是消息对象；统一以轮询结果为准
  const wait = await waitForFork(token, forkOwner, forkName, timeoutSec, 3);
  console.log(JSON.stringify({
    ok: true,
    reused: false,
    forkOwner,
    forkRepo: forkName,
    forkUrl: `https://gitcode.com/${forkOwner}/${forkName}`,
    ready: true,
    waitedMs: wait.waitedMs,
    ...wait.repo,
  }, null, 2));
}

async function cmdWaitFork(args, token) {
  requireParam(args, ['owner', 'repo']);
  const timeoutSec = parseInt(args.timeout, 10) || 60;
  const intervalSec = parseInt(args.interval, 10) || 3;
  const wait = await waitForFork(token, args.owner, args.repo, timeoutSec, intervalSec);
  console.log(JSON.stringify({
    ok: true, ready: true, waitedMs: wait.waitedMs, ...wait.repo,
  }, null, 2));
}

// ---------- 主流程 ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (args.help || !cmd) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  const token = resolveToken(args);
  if (!token) die('未找到 Token：请传 --token，或设置环境变量 GIT_TOKEN，或确保 Server/.env 中存在 GIT_TOKEN');

  switch (cmd) {
    case 'get-user': await cmdGetUser(token); break;
    case 'get-repo': await cmdGetRepo(args, token); break;
    case 'get-branch': await cmdGetBranch(args, token); break;
    case 'create-fork': await cmdCreateFork(args, token); break;
    case 'wait-fork': await cmdWaitFork(args, token); break;
    default:
      die(`未知子命令: ${cmd}（可用: get-user | get-repo | get-branch | create-fork | wait-fork）`);
  }
}

main().catch((e) => die(e.message));
