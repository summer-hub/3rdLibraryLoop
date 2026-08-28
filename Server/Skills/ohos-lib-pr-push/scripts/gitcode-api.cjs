#!/usr/bin/env node
/**
 * @tool gitcode-api
 * @description ohos-lib-pr-push SKILL 的 GitCode API 辅助脚本：封装用户/仓库查询、Issue 创建、PR 创建（含跨仓库参数）、PR 评论。所有写请求使用 form-urlencoded + UTF-8，避免中文乱码。
 * @param token: string - GitCode API Token（也可用环境变量 GIT_TOKEN）
 * @param owner: string - 仓库所属空间（owner/组织）
 * @param repo: string - 仓库名
 * 子命令:
 *   get-user                                  获取 Token 用户信息
 *   get-repo --owner x --repo y               获取仓库信息（id、default_branch）
 *   create-issue --title t --body-file f      创建 Issue，返回 number
 *   create-pr --head b --base m --title t --body-file f
 *            [--fork-repo o/r --target-project-id id]  创建 PR（跨仓库时传后两项）
 *   comment-pr --pr n --body "Start build"    在 PR 评论（CI 触发）
 * 用法示例:
 *   node gitcode-api.cjs get-user --token "$GIT_TOKEN"
 *   node gitcode-api.cjs create-pr --token "$GIT_TOKEN" --owner me --repo lib \
 *     --head fix-Branch --base master --title "fix" --body-file /tmp/pr.md \
 *     --fork-repo CPF-RN/lib --target-project-id 12345
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

// ---------- HTTP ----------
async function api(method, endpoint, params, token) {
  const url = new URL(BASE + endpoint);
  const search = new URLSearchParams();
  if (token) search.set('access_token', token);
  let body = null;
  const headers = {};
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params || {})) search.set(k, String(v));
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams();
    if (token) body.set('access_token', token);
    for (const [k, v] of Object.entries(params || {})) body.set(k, String(v));
    body = body.toString();
  }
  url.search = search.toString();
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    die(`GitCode API ${method} ${endpoint} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

// ---------- Token 加载 ----------
function resolveToken(args) {
  if (args.token && args.token !== true) return args.token;
  if (process.env.GIT_TOKEN) return process.env.GIT_TOKEN;
  // 从 SKILL 目录向上回溯读取 Server/.env 的 GIT_TOKEN
  // 本脚本位于 Server/Skills/ohos-lib-pr-push/scripts/ → .env 在 ../../../.env
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

function readBody(args) {
  if (args.bodyFile && args.bodyFile !== true) {
    return fs.readFileSync(path.resolve(args.bodyFile), 'utf8');
  }
  if (typeof args.body === 'string') return args.body;
  return '';
}

// ---------- 子命令 ----------
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
    case 'get-user': {
      const u = await api('GET', '/user', {}, token);
      console.log(JSON.stringify({ ok: true, username: u.login, name: u.name, email: u.email, id: u.id }, null, 2));
      break;
    }
    case 'get-repo': {
      requireParam(args, ['owner', 'repo']);
      const r = await api('GET', `/repos/${args.owner}/${args.repo}`, {}, token);
      console.log(JSON.stringify({
        ok: true,
        id: r.id,
        pathWithNamespace: r.full_path || r.path_with_namespace || `${args.owner}/${args.repo}`,
        defaultBranch: r.default_branch || 'master',
      }, null, 2));
      break;
    }
    case 'create-issue': {
      requireParam(args, ['owner', 'repo', 'title']);
      const iss = await api('POST', `/repos/${args.owner}/${args.repo}/issues`, {
        title: args.title,
        body: readBody(args),
      }, token);
      console.log(JSON.stringify({ ok: true, number: iss.number, url: `https://gitcode.com/${args.owner}/${args.repo}/issues/${iss.number}` }, null, 2));
      break;
    }
    case 'create-pr': {
      requireParam(args, ['owner', 'repo', 'head', 'base', 'title']);
      const params = {
        title: args.title,
        head: args.head,
        base: args.base,
        body: readBody(args),
      };
      // 跨仓库 PR：必须同时传 fork_repo（原仓库）与 target_project_id（原仓库 id），
      // 否则 PR 会变成 fork 仓库内部 PR，原仓库不可见。见 references/GITCODE_API.md。
      if (args.forkRepo && args.targetProjectId) {
        params.fork_repo = args.forkRepo;
        params.target_project_id = args.targetProjectId;
      } else if (args.forkRepo || args.targetProjectId) {
        die('跨仓库 PR 需要同时提供 --fork-repo 与 --target-project-id');
      }
      const pr = await api('POST', `/repos/${args.owner}/${args.repo}/pulls`, params, token);
      const targetPath = (pr.target_project && (pr.target_project.path_with_namespace || pr.target_project.full_path)) || '';
      const result = {
        ok: true,
        number: pr.number,
        url: `https://gitcode.com/${args.owner}/${args.repo}/merge_requests/${pr.number}`,
        targetProject: targetPath,
      };
      // 跨仓库场景自动校验 PR 目标是否指向原仓库
      if (args.forkRepo && targetPath && targetPath !== args.forkRepo) {
        result.warning = `PR 目标仓库(${targetPath})与原仓库(${args.forkRepo})不一致，请人工核对`;
      }
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'comment-pr': {
      requireParam(args, ['owner', 'repo', 'pr', 'body']);
      const c = await api('POST', `/repos/${args.owner}/${args.repo}/pulls/${args.pr}/comments`, {
        body: args.body,
      }, token);
      console.log(JSON.stringify({ ok: true, commentId: c.id || null, body: c.body || args.body }, null, 2));
      break;
    }
    default:
      die(`未知子命令: ${cmd}（可用: get-user | get-repo | create-issue | create-pr | comment-pr）`);
  }
}

function requireParam(args, names) {
  for (const n of names) {
    if (!args[n] || args[n] === true) die(`缺少必填参数 --${n.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
  }
}

main().catch((e) => die(e.message));
