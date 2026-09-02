#!/usr/bin/env node
/**
 * @tool gitcode-api
 * @description ohos-lib-pr-push SKILL 的 GitCode API 辅助脚本：封装用户/仓库查询、Issue 创建、PR 创建（含跨仓库参数）、PR 评论。所有写请求使用 form-urlencoded + UTF-8，避免中文乱码。
 * @param token: string - GitCode API Token（也可用环境变量 GIT_TOKEN）
 * @param owner: string - 仓库所属空间（owner/组织）
 * @param repo: string - 仓库名
 * 子命令:
 *   get-user                                  获取 Token 用户信息
 *   get-repo --owner x --repo y               获取仓库信息（id、default_branch；fork 仓库含 parent 源仓库）
 *   get-branch --owner x --repo y --branch b  探测分支是否存在（用于 PR base 同名分支探测）
 *   get-issue-templates --owner x --repo y    探测 Issue 模板（仓库级 .gitcode/.github → 组织级 {owner}/.gitcode），
 *                                             返回各模板 yml 原文（source: repo|org|none）
 *   list-prs --owner x --repo y [--state open] [--head b] [--base m] [--limit n]
 *                                             列出 PR（默认 open），用于幂等检测：fork 分支是否已有指向源仓库的 open PR
 *   create-issue --title t --body-file f [--labels a,b]  创建 Issue，返回 number
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
/**
 * @param opts.allow404 boolean - 404 时返回 null（不 die），用于探测类调用（分支存在性 / Issue 模板探测）
 */
async function api(method, endpoint, params, token, opts = {}) {
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
    if (opts.allow404 && res.status === 404) return null;
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
      const parent = r.parent && (r.parent.path_with_namespace || r.parent.full_path) || null;
      console.log(JSON.stringify({
        ok: true,
        id: r.id,
        pathWithNamespace: r.full_path || r.path_with_namespace || `${args.owner}/${args.repo}`,
        defaultBranch: r.default_branch || 'master',
        parent: parent, // fork 仓库的源仓库（上游），用于 upstream 推断
      }, null, 2));
      break;
    }
    case 'get-branch': {
      requireParam(args, ['owner', 'repo', 'branch']);
      // 探测分支是否存在：200 存在 / 404 不存在（allow404 返回 null，不作为错误退出）
      const b = await api('GET', `/repos/${args.owner}/${args.repo}/branches/${encodeURIComponent(args.branch)}`, {}, token, { allow404: true });
      console.log(JSON.stringify({ ok: true, exists: !!b, branch: (b && b.name) || args.branch }, null, 2));
      break;
    }
    case 'get-issue-templates': {
      requireParam(args, ['owner', 'repo']);
      // 探测顺序：仓库级 .gitcode/ISSUE_TEMPLATE → 仓库级 .github/ISSUE_TEMPLATE → 组织级 {owner}/.gitcode 仓库
      // 实测（CPF-ApplicationTPC/lottie_turbo）：仓库自身无模板目录，模板在组织仓库 {org}/.gitcode 的
      // .gitcode/ISSUE_TEMPLATE/ 下（GitHub Issue Forms YAML：name/title/labels/type/body[]）。
      const candidates = [
        { source: 'repo', owner: args.owner, repo: args.repo, path: '.gitcode/ISSUE_TEMPLATE' },
        { source: 'repo', owner: args.owner, repo: args.repo, path: '.github/ISSUE_TEMPLATE' },
        { source: 'org', owner: args.owner, repo: '.gitcode', path: '.gitcode/ISSUE_TEMPLATE' },
      ];
      let found = null;
      for (const c of candidates) {
        const list = await api('GET', `/repos/${c.owner}/${c.repo}/contents/${c.path}`, {}, token, { allow404: true });
        if (Array.isArray(list) && list.some((f) => f && f.type === 'file' && /\.ya?ml$/i.test(f.name || ''))) {
          found = { ...c, list };
          break;
        }
      }
      if (!found) {
        console.log(JSON.stringify({ ok: true, source: 'none', templates: [] }, null, 2));
        break;
      }
      let blankIssuesEnabled = true; // 无 config.yml 时默认允许空白 issue
      const templates = [];
      for (const f of found.list) {
        if (!f || f.type !== 'file' || !/\.ya?ml$/i.test(f.name || '')) continue;
        const meta = await api('GET', `/repos/${found.owner}/${found.repo}/contents/${found.path}/${encodeURIComponent(f.name)}`, {}, token, { allow404: true });
        if (!meta) continue;
        let yaml = '';
        if (typeof meta.content === 'string' && meta.content) {
          yaml = Buffer.from(meta.content.replace(/\s/g, ''), 'base64').toString('utf8');
        } else if (meta.download_url) {
          const raw = await fetch(meta.download_url);
          yaml = await raw.text();
        } else {
          continue;
        }
        if (/^config\.ya?ml$/i.test(f.name)) {
          blankIssuesEnabled = /blank_issues_enabled:\s*true/i.test(yaml);
          continue;
        }
        const strip = (v) => String(v || '').trim().replace(/^["']|["']$/g, '');
        const labelsMatch = yaml.match(/^labels:\s*(.+)$/m);
        let labels = [];
        if (labelsMatch) {
          const lv = labelsMatch[1].trim();
          if (lv.startsWith('[')) {
            try { labels = JSON.parse(lv.replace(/'/g, '"')); } catch { labels = []; }
          } else {
            labels = [strip(lv)];
          }
        }
        templates.push({
          file: f.name,
          name: strip((yaml.match(/^name:\s*(.+)$/m) || [])[1]) || f.name,
          title: strip((yaml.match(/^title:\s*(.+)$/m) || [])[1]),
          labels,
          type: strip((yaml.match(/^type:\s*(.+)$/m) || [])[1]),
          yaml,
        });
      }
      console.log(JSON.stringify({
        ok: true,
        source: found.source, // repo=仓库自身模板 | org=组织级 .gitcode 仓库模板
        templateRepo: `${found.owner}/${found.repo}`,
        templatePath: found.path,
        blankIssuesEnabled,
        count: templates.length,
        templates,
      }, null, 2));
      break;
    }
    case 'list-prs': {
      requireParam(args, ['owner', 'repo']);
      // 列出 PR：state=open|closed|all（默认 open）；head/base 按分支名过滤（实测支持）
      // 幂等检测用途：查源仓库 open PR 中是否已有 head 分支来自当前 fork 用户的 PR
      const params = { state: typeof args.state === 'string' && args.state ? args.state : 'open', per_page: 20 };
      if (typeof args.head === 'string' && args.head) params.head = args.head;
      if (typeof args.base === 'string' && args.base) params.base = args.base;
      if (args.limit && args.limit !== true) params.per_page = parseInt(args.limit, 10) || 20;
      const list = await api('GET', `/repos/${args.owner}/${args.repo}/pulls`, params, token);
      const prs = (Array.isArray(list) ? list : []).map((p) => ({
        number: p.number,
        iid: p.iid || p.number,
        state: p.state,
        title: p.title,
        head: (p.head && (p.head.ref || p.head.label)) || '',
        headUser: (p.head && p.head.user && (p.head.user.login || p.head.user.name)) || '',
        base: (p.base && (p.base.ref || p.base.label)) || '',
        url: p.html_url || `https://gitcode.com/${args.owner}/${args.repo}/merge_requests/${p.number}`,
      }));
      console.log(JSON.stringify({ ok: true, count: prs.length, prs }, null, 2));
      break;
    }
    case 'create-issue': {
      requireParam(args, ['owner', 'repo', 'title']);
      const params = {
        title: args.title,
        body: readBody(args),
      };
      // 可选 labels：有模板时传模板声明的 labels（GitCode 不支持或报错时去掉重试）
      if (typeof args.labels === 'string' && args.labels.trim()) {
        params.labels = args.labels.split(',').map((s) => s.trim()).filter(Boolean).join(',');
      }
      let iss;
      try {
        iss = await api('POST', `/repos/${args.owner}/${args.repo}/issues`, params, token);
      } catch (e) {
        if (params.labels && /HTTP 4\d\d/.test(e.message)) {
          delete params.labels; // labels 不被接受时降级重试（标题/body 不受影响）
          iss = await api('POST', `/repos/${args.owner}/${args.repo}/issues`, params, token);
        } else {
          throw e;
        }
      }
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
      die(`未知子命令: ${cmd}（可用: get-user | get-repo | get-branch | get-issue-templates | list-prs | create-issue | create-pr | comment-pr）`);
  }
}

function requireParam(args, names) {
  for (const n of names) {
    if (!args[n] || args[n] === true) die(`缺少必填参数 --${n.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
  }
}

main().catch((e) => die(e.message));
