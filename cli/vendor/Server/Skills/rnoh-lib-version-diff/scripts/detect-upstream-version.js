#!/usr/bin/env node
/**
 * detect-upstream-version.js
 *
 * 从 RN 鸿蒙三方库 git 仓库链接中，分析出鸿蒙化仓库是基于上游的哪个版本进行的鸿蒙化，
 * 同时查询 npm registry 获取该上游包的最新发布版本。
 *
 * 原理:
 *   鸿蒙化仓库的 package.json 中通常包含:
 *     - "name": "@react-native-ohos/<pkg-name>"  (鸿蒙化后的包名)
 *     - "harmony": { "alias": "<upstream-pkg-name>" }  (上游 npm 包名别名)
 *     - "dependencies" / "devDependencies" 中有 "<upstream-pkg-name>": "<version>"
 *   本脚本从仓库 URL 中推断 npm 包名，然后在 package.json 的依赖列表中
 *   找到同名的依赖项，输出其版本号。之后通过 npm registry API 查询该包的
 *   dist-tags.latest，获取当前最新版本。
 *
 * 用法:
 *   node detect-upstream-version.js <git-repo-url>
 *
 * 示例:
 *   node detect-upstream-version.js https://gitcode.com/CPF-RN/rntpc_lottie-turbo-react-native/blob/br_rnoh0.77
 *   # 输出: 鸿蒙化版本 7.2.2 + npm 最新版本
 *
 *   node detect-upstream-version.js https://gitcode.com/CPF-RN/rntpc_lottie-turbo-react-native
 *   # 输出: 鸿蒙化版本 7.2.2 + npm 最新版本
 *
 *   node detect-upstream-version.js https://gitcode.com/CPF-RN/rntpc_lottie-turbo-react-native/tree/br_rnoh0.77
 *   # 输出: 鸿蒙化版本 7.2.2 + npm 最新版本
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ── 颜色输出 ─────────────────────────────────────────────
const COLORS = {
  RED: '\x1b[0;31m',
  GREEN: '\x1b[0;32m',
  YELLOW: '\x1b[1;33m',
  BLUE: '\x1b[0;34m',
  CYAN: '\x1b[0;36m',
  NC: '\x1b[0m',
};

function info(msg)  { console.log(`${COLORS.BLUE}[INFO]${COLORS.NC} ${msg}`); }
function ok(msg)    { console.log(`${COLORS.GREEN}[OK]${COLORS.NC} ${msg}`); }
function warn(msg)  { console.log(`${COLORS.YELLOW}[WARN]${COLORS.NC} ${msg}`); }
function error(msg) { console.error(`${COLORS.RED}[ERROR]${COLORS.NC} ${msg}`); }

// ── URL 解析 ─────────────────────────────────────────────

/**
 * 从 git 仓库 URL 中解析出平台、owner、repo、分支和路径格式。
 *
 * 支持的 URL 格式:
 *   https://gitcode.com/<owner>/<repo>
 *   https://gitcode.com/<owner>/<repo>/blob/<branch>
 *   https://gitcode.com/<owner>/<repo>/tree/<branch>
 *   https://gitcode.com/<owner>/<repo>/blob/<branch>/<path>
 *   https://gitcode.com/<owner>/<repo>/tree/<branch>/<path>
 *   https://github.com/<owner>/<repo>
 *   https://github.com/<owner>/<repo>/tree/<branch>
 *   https://github.com/<owner>/<repo>/blob/<branch>/<path>
 *   https://github.com/<owner>/<repo>.git
 *   git@gitcode.com:<owner>/<repo>.git
 *
 * @param {string} rawUrl 原始 URL
 * @returns {{platform: string, owner: string, repo: string, branch: string, host: string}}
 */
function parseGitUrl(rawUrl) {
  let urlStr = rawUrl.trim();

  // 处理 SSH 格式: git@host:owner/repo.git
  if (urlStr.startsWith('git@')) {
    const match = urlStr.match(/^git@([^:]+):(.+)$/);
    if (match) {
      const host = match[1];
      const path = match[2].replace(/\.git$/, '');
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return {
          platform: detectPlatform(host),
          host: host,
          owner: parts[0],
          repo: parts[1],
          branch: '',
        };
      }
    }
    throw new Error(`无法解析 SSH URL: ${rawUrl}`);
  }

  // 去除查询参数
  const queryIdx = urlStr.indexOf('?');
  if (queryIdx >= 0) {
    urlStr = urlStr.substring(0, queryIdx);
  }

  // 去除锚点
  const hashIdx = urlStr.indexOf('#');
  if (hashIdx >= 0) {
    urlStr = urlStr.substring(0, hashIdx);
  }

  const parsed = new URL(urlStr);
  const host = parsed.hostname;
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  if (pathParts.length < 2) {
    throw new Error(`URL 路径不完整，无法提取 owner/repo: ${rawUrl}`);
  }

  const owner = pathParts[0];
  let repo = pathParts[1];

  // 去除 .git 后缀
  repo = repo.replace(/\.git$/, '');

  // 解析分支: /blob/<branch> 或 /tree/<branch>
  let branch = '';
  if (pathParts.length >= 4 && (pathParts[2] === 'blob' || pathParts[2] === 'tree')) {
    branch = pathParts[3];
  } else if (pathParts.length >= 3 && (pathParts[2] === 'blob' || pathParts[2] === 'tree')) {
    branch = pathParts[3] || '';
  }

  return {
    platform: detectPlatform(host),
    host: host,
    owner: owner,
    repo: repo,
    branch: branch,
  };
}

/**
 * 根据主机名检测平台类型。
 * @param {string} host
 * @returns {string} 'gitcode' | 'github' | 'gitee' | 'other'
 */
function detectPlatform(host) {
  if (host.includes('gitcode.com')) return 'gitcode';
  if (host.includes('github.com')) return 'github';
  if (host.includes('gitee.com')) return 'gitee';
  return 'other';
}

// ── 仓库名 → npm 包名推断 ───────────────────────────────

/**
 * 从仓库名中推断上游 npm 包名。
 *
 * 鸿蒙化仓库名通常遵循以下模式:
 *   rntpc_<upstream-pkg-name>          → rntpc_lottie-turbo-react-native → lottie-turbo-react-native
 *   rntpc_<upstream-pkg-name>-turbo    → (特殊处理)
 *   react-native-ohos-<name>           → react-native-<name>
 *   <upstream-pkg-name>                → 直接使用
 *
 * 推断策略:
 *   1. 去除前缀 "rntpc_"
 *   2. 去除前缀 "react-native-ohos-"
 *   3. 如果结果以 "-turbo" 结尾且去掉后仍合理，尝试去掉
 *   4. 其他情况直接使用仓库名
 *
 * @param {string} repoName 仓库名
 * @returns {string} 推断的上游 npm 包名
 */
function inferPackageName(repoName) {
  let name = repoName;

  // 去除常见前缀
  if (name.startsWith('rntpc_')) {
    name = name.substring('rntpc_'.length);
  } else if (name.startsWith('react-native-ohos-')) {
    name = name.substring('react-native-ohos-'.length);
    name = 'react-native-' + name;
  }

  return name;
}

// ── HTTP 请求 ────────────────────────────────────────────

/**
 * 发送 HTTP/HTTPS 请求并返回响应体 (字符串)。
 * @param {string} url 请求 URL
 * @param {number} maxRedirects 最大重定向次数
 * @returns {Promise<string>} 响应体
 */
function fetchText(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/plain, application/json, text/html, */*',
        'Accept-Encoding': 'identity',
      },
      timeout: 30000,
    };

    const req = lib.request(options, (res) => {
      // 处理重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error('重定向次数超限'));
          return;
        }
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        fetchText(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }

      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });

    req.end();
  });
}

// ── Raw 文件 URL 构造 ───────────────────────────────────

/**
 * 构造获取 package.json 原始内容的 URL。
 *
 * 不同平台的 raw 文件 URL 格式:
 *   - gitcode: https://raw.gitcode.com/<owner>/<repo>/raw/<branch>/package.json
 *   - github:  https://raw.githubusercontent.com/<owner>/<repo>/<branch>/package.json
 *   - gitee:   https://gitee.com/<owner>/<repo>/raw/<branch>/package.json
 *
 * @param {{platform: string, host: string, owner: string, repo: string, branch: string}} repoInfo
 * @returns {string} raw package.json URL
 */
function buildRawPackageJsonUrl(repoInfo) {
  const { platform, owner, repo, branch } = repoInfo;
  const br = branch || 'master';

  switch (platform) {
    case 'github':
      return `https://raw.githubusercontent.com/${owner}/${repo}/${br}/package.json`;
    case 'gitcode':
      return `https://raw.gitcode.com/${owner}/${repo}/raw/${br}/package.json`;
    case 'gitee':
      return `https://gitee.com/${owner}/${repo}/raw/${br}/package.json`;
    default:
      // 通用格式: 尝试 gitcode 风格
      return `https://${repoInfo.host}/${owner}/${repo}/raw/${br}/package.json`;
  }
}

/**
 * 获取 package.json 内容。
 * 先尝试 raw URL，失败后尝试 API。
 *
 * @param {{platform: string, host: string, owner: string, repo: string, branch: string}} repoInfo
 * @returns {Promise<object>} 解析后的 package.json 对象
 */
async function fetchPackageJson(repoInfo) {
  const rawUrl = buildRawPackageJsonUrl(repoInfo);
  info(`正在获取 package.json: ${rawUrl}`);

  try {
    const content = await fetchText(rawUrl);
    const pkg = JSON.parse(content);
    ok('成功获取并解析 package.json');
    return pkg;
  } catch (err) {
    warn(`Raw URL 获取失败: ${err.message}`);
  }

  // 回退: gitcode API v5 (返回 base64 编码的文件内容)
  if (repoInfo.platform === 'gitcode') {
    const apiUrl = `https://gitcode.com/api/v5/repos/${repoInfo.owner}/${repoInfo.repo}/contents/package.json?ref=${repoInfo.branch || 'master'}`;
    info(`尝试从 gitcode API 获取: ${apiUrl}`);
    try {
      const content = await fetchText(apiUrl);
      const data = JSON.parse(content);
      if (data.content) {
        const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
        const pkg = JSON.parse(decoded);
        ok('从 gitcode API 成功获取 package.json');
        return pkg;
      }
    } catch (err) {
      warn(`gitcode API 获取失败: ${err.message}`);
    }
  }

  // 回退: GitHub API
  if (repoInfo.platform === 'github') {
    const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/package.json?ref=${repoInfo.branch || 'master'}`;
    info(`尝试从 GitHub API 获取: ${apiUrl}`);
    try {
      const content = await fetchText(apiUrl);
      const data = JSON.parse(content);
      if (data.content && data.encoding === 'base64') {
        const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
        const pkg = JSON.parse(decoded);
        ok('从 GitHub API 成功获取 package.json');
        return pkg;
      }
    } catch (err) {
      warn(`GitHub API 获取失败: ${err.message}`);
    }
  }

  // 回退: Gitee API
  if (repoInfo.platform === 'gitee') {
    const apiUrl = `https://gitee.com/api/v5/repos/${repoInfo.owner}/${repoInfo.repo}/contents/package.json?ref=${repoInfo.branch || 'master'}`;
    info(`尝试从 Gitee API 获取: ${apiUrl}`);
    try {
      const content = await fetchText(apiUrl);
      const data = JSON.parse(content);
      if (data.content) {
        const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
        const pkg = JSON.parse(decoded);
        ok('从 Gitee API 成功获取 package.json');
        return pkg;
      }
    } catch (err) {
      warn(`Gitee API 获取失败: ${err.message}`);
    }
  }

  // 最终回退: git clone --depth=1
  info('尝试通过 git clone 获取...');
  try {
    const pkg = await fetchPackageJsonViaClone(repoInfo);
    if (pkg) {
      ok('通过 git clone 成功获取 package.json');
      return pkg;
    }
  } catch (err) {
    warn(`git clone 获取失败: ${err.message}`);
  }

  throw new Error('无法获取 package.json，请检查仓库地址和分支是否正确');
}

/**
 * 通过 git clone --depth=1 获取 package.json。
 * 这是最可靠但最慢的回退方案。
 *
 * @param {{platform: string, host: string, owner: string, repo: string, branch: string}} repoInfo
 * @returns {Promise<object|null>} 解析后的 package.json 对象
 */
async function fetchPackageJsonViaClone(repoInfo) {
  const cloneUrl = `https://${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}.git`;
  const branch = repoInfo.branch || 'master';
  const tmpDir = path.join(os.tmpdir(), `detect-upstream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  return new Promise((resolve, reject) => {
    try {
      execFileSync('git', [
        'clone', '--depth=1',
        '--branch', branch,
        cloneUrl,
        tmpDir,
      ], {
        timeout: 60000,
        stdio: 'pipe',
      });

      const pkgPath = path.join(tmpDir, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resolve(null);
        return;
      }

      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);

      // 清理临时目录
      fs.rmSync(tmpDir, { recursive: true, force: true });
      resolve(pkg);
    } catch (err) {
      // 清理临时目录
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
      reject(err);
    }
  });
}

// ── 版本号匹配 ───────────────────────────────────────────

/**
 * 在 package.json 中查找与仓库名匹配的上游依赖版本号。
 *
 * 匹配策略 (按优先级):
 *   1. 使用 harmony.alias 字段的值作为包名，在 dependencies 中查找
 *   2. 使用从仓库名推断的包名，在 dependencies 中查找
 *   3. 使用 harmony.alias 在 devDependencies 中查找
 *   4. 使用推断的包名在 devDependencies 中查找
 *   5. 使用 package.json 的 name 字段去掉 @react-native-ohos/ 前缀后在依赖中查找
 *
 * @param {object} pkg package.json 对象
 * @param {string} repoName 仓库名
 * @returns {{version: string, matchedField: string, matchedSection: string, packageName: string}}
 */
function findUpstreamVersion(pkg, repoName) {
  const inferredPkgName = inferPackageName(repoName);
  const harmonyAlias = pkg.harmony && pkg.harmony.alias ? pkg.harmony.alias : '';
  const pkgName = pkg.name || '';

  // 从 @react-native-ohos/xxx 中提取 xxx
  const ohosPkgName = pkgName.startsWith('@react-native-ohos/')
    ? pkgName.substring('@react-native-ohos/'.length)
    : pkgName;

  // 候选包名列表 (按优先级排序，去重)
  const candidateNames = [];
  const addCandidate = (name) => {
    if (name && !candidateNames.includes(name)) {
      candidateNames.push(name);
    }
  };
  addCandidate(harmonyAlias);
  addCandidate(inferredPkgName);
  addCandidate(ohosPkgName);

  // 搜索的依赖区域 (按优先级排序)
  const sections = [
    { key: 'dependencies', label: 'dependencies' },
    { key: 'devDependencies', label: 'devDependencies' },
    { key: 'peerDependencies', label: 'peerDependencies' },
  ];

  // 遍历候选包名 × 依赖区域
  for (const candidateName of candidateNames) {
    for (const section of sections) {
      const deps = pkg[section.key];
      if (!deps || typeof deps !== 'object') continue;

      // 精确匹配
      if (deps.hasOwnProperty(candidateName)) {
        return {
          version: deps[candidateName],
          matchedField: candidateName,
          matchedSection: section.label,
          packageName: candidateName,
        };
      }
    }
  }

  // 模糊匹配: 如果候选名包含某些关键词，尝试在依赖中反向查找
  // 例如仓库名 rntpc_lottie-turbo-react-native 推断出 lottie-turbo-react-native
  // 但实际依赖名可能是 lottie-react-native
  for (const section of sections) {
    const deps = pkg[section.key];
    if (!deps || typeof deps !== 'object') continue;

    for (const depName of Object.keys(deps)) {
      // 跳过 @react-native-ohos/ 前缀的包 (那是鸿蒙化包自身)
      if (depName.startsWith('@react-native-ohos/')) continue;
      // 跳过 react/react-native 核心包
      if (['react', 'react-native', 'react-native-windows'].includes(depName)) continue;

      // 检查候选名是否与依赖名有足够相似度
      for (const candidateName of candidateNames) {
        if (isPackageMatch(candidateName, depName)) {
          return {
            version: deps[depName],
            matchedField: depName,
            matchedSection: section.label,
            packageName: depName,
          };
        }
      }
    }
  }

  return null;
}

/**
 * 判断两个包名是否匹配 (模糊匹配)。
 *
 * 规则:
 *   1. 精确匹配
 *   2. 一个包含另一个 (如 lottie-turbo-react-native 包含 lottie-react-native)
 *   3. 去除 turbo 后缀后匹配
 *   4. 共享相同的关键词组合 (如都包含 lottie 和 react-native)
 *
 * @param {string} candidate 候选包名
 * @param {string} depName 依赖中的包名
 * @returns {boolean}
 */
function isPackageMatch(candidate, depName) {
  if (candidate === depName) return true;
  if (!candidate || !depName) return false;

  // 去除 turbo 后缀
  const normalize = (s) => s.replace(/-turbo$/i, '').replace(/turbo-/gi, '');
  if (normalize(candidate) === normalize(depName)) return true;

  // 一个包含另一个
  if (candidate.includes(depName) || depName.includes(candidate)) return true;

  // 提取关键词 (以 - 分割)，检查交集
  const candidateKeywords = candidate.split('-').filter(k => k.length > 2);
  const depKeywords = depName.split('-').filter(k => k.length > 2);
  const intersection = candidateKeywords.filter(k => depKeywords.includes(k));

  // 如果有足够的关键词交集 (至少2个且覆盖了依赖名的大部分关键词)
  if (intersection.length >= 2 && intersection.length >= depKeywords.length - 1) {
    return true;
  }

  return false;
}

// ── npm Registry 查询 ───────────────────────────────────

/**
 * 从 npm registry 查询包的最新版本号。
 *
 * 使用 npm registry API:
 *   GET https://registry.npmjs.org/<package-name>
 *   返回的 JSON 中 dist-tags.latest 包含最新版本号。
 *
 * 对于 scoped 包 (@scope/pkg)，需要将 / 编码为 %2F。
 *
 * 查询策略 (按优先级):
 *   1. npm registry packument API (dist-tags.latest)
 *   2. npm registry /latest 端点
 *   3. npm view 命令 (尊重用户本地 npm 配置)
 *
 * @param {string} packageName npm 包名
 * @returns {Promise<{latest: string, allTags: object, recentVersions: string[]} | null>} 版本信息
 */
async function fetchLatestNpmVersion(packageName) {
  // 对 scoped 包名进行编码: @scope/pkg → @scope%2Fpkg
  const encodedName = packageName.replace('/', '%2F');

  // 策略 1: packument API
  const registryUrl = `https://registry.npmjs.org/${encodedName}`;
  info(`正在查询 npm registry: ${registryUrl}`);

  try {
    const content = await fetchText(registryUrl);
    const data = JSON.parse(content);

    const distTags = data['dist-tags'] || data.distTags;
    if (distTags && distTags.latest) {
      // 从 versions 字段提取所有版本号，排序后取最近 10 个
      const allVersions = data.versions ? Object.keys(data.versions) : [];
      const recentVersions = sortVersionsDesc(allVersions).slice(0, 10);
      ok(`npm 最新版本: ${distTags.latest}`);
      if (recentVersions.length > 0) {
        info(`最近 ${recentVersions.length} 个版本: ${recentVersions.join(', ')}`);
      }
      return {
        latest: distTags.latest,
        allTags: distTags,
        recentVersions: recentVersions,
      };
    }

    // 某些简化的响应可能直接包含 version 字段
    if (data.version) {
      ok(`npm 最新版本: ${data.version}`);
      return {
        latest: data.version,
        allTags: {},
        recentVersions: [],
      };
    }

    warn('npm registry 响应中未找到 dist-tags.latest');
  } catch (err) {
    warn(`npm registry 查询失败: ${err.message}`);
  }

  // 策略 2: /latest 端点
  const latestUrl = `https://registry.npmjs.org/${encodedName}/latest`;
  info(`尝试从 /latest 端点获取: ${latestUrl}`);
  try {
    const content = await fetchText(latestUrl);
    const data = JSON.parse(content);
    if (data.version) {
      ok(`npm 最新版本 (via /latest): ${data.version}`);
      return {
        latest: data.version,
        allTags: {},
        recentVersions: [],
      };
    }
  } catch (err) {
    warn(`/latest 端点查询失败: ${err.message}`);
  }

  // 策略 3: npm view 命令 (尊重用户本地 .npmrc 配置，如镜像源)
  const npmResult = await fetchLatestViaNpmCommand(packageName);
  if (npmResult) {
    return npmResult;
  }

  return null;
}

/**
 * 通过 npm view 命令获取最新版本号和最近版本列表。
 *
 * 此方式会读取用户本地的 .npmrc 配置，
 * 因此能正确处理使用了镜像源 (如 npmmirror.com) 的场景。
 *
 * @param {string} packageName npm 包名
 * @returns {Promise<{latest: string, allTags: object, recentVersions: string[]} | null>}
 */
async function fetchLatestViaNpmCommand(packageName) {
  info('尝试通过 npm view 命令获取...');
  try {
    // 获取最新版本
    const versionOutput = execFileSync('npm', [
      'view', packageName, 'version',
    ], {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    // 获取所有版本列表
    let recentVersions = [];
    try {
      const versionsOutput = execFileSync('npm', [
        'view', packageName, 'versions', '--json',
      ], {
        timeout: 30000,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      const allVersions = JSON.parse(versionsOutput);
      if (Array.isArray(allVersions)) {
        recentVersions = sortVersionsDesc(allVersions).slice(0, 10);
      }
    } catch (e) {
      // versions 获取失败不影响主流程
    }

    if (versionOutput) {
      // npm view 可能返回多行 (废弃包警告等)，取最后一行作为版本号
      const lines = versionOutput.split('\n').filter(l => l.trim());
      const version = lines[lines.length - 1].trim();
      ok(`npm 最新版本 (via npm view): ${version}`);
      if (recentVersions.length > 0) {
        info(`最近 ${recentVersions.length} 个版本: ${recentVersions.join(', ')}`);
      }
      return {
        latest: version,
        allTags: {},
        recentVersions: recentVersions,
      };
    }
  } catch (err) {
    warn(`npm view 命令失败: ${err.message}`);
  }

  return null;
}

/**
 * 解析语义化版本号为结构化对象。
 *
 * @param {string} version 版本号 (可能含 ^ ~ 等前缀)
 * @returns {{major: number, minor: number, patch: number, prerelease: string}}
 */
function parseSemver(version) {
  const clean = version.replace(/^[\^~>=<\s]+/, '');
  const [mainPart, prePart] = clean.split('-');
  const parts = mainPart.split('.');
  return {
    major: parseInt(parts[0] || '0', 10),
    minor: parseInt(parts[1] || '0', 10),
    patch: parseInt(parts[2] || '0', 10),
    prerelease: prePart || '',
  };
}

/**
 * 比较两个语义化版本号的大小 (含 prerelease 优先级)。
 *
 * 遵循 semver 规范:
 *   - major.minor.patch 数值比较
 *   - 无 prerelease > 有 prerelease (如 7.4.0 > 7.4.0-rc1)
 *   - prerelease 部分按标识符逐段比较 (数字用数值，字母用 ASCII)
 *
 * @param {string} v1 版本号1
 * @param {string} v2 版本号2
 * @returns {number} -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)
 */
function compareSemver(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);

  if (p1.major !== p2.major) return p1.major < p2.major ? -1 : 1;
  if (p1.minor !== p2.minor) return p1.minor < p2.minor ? -1 : 1;
  if (p1.patch !== p2.patch) return p1.patch < p2.patch ? -1 : 1;

  // 无 prerelease > 有 prerelease
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && !p2.prerelease) return 0;

  // 两者都有 prerelease，逐段比较
  const pre1Parts = p1.prerelease.split('.');
  const pre2Parts = p2.prerelease.split('.');
  const maxLen = Math.max(pre1Parts.length, pre2Parts.length);
  for (let i = 0; i < maxLen; i++) {
    const a = pre1Parts[i];
    const b = pre2Parts[i];
    if (!a) return -1;
    if (!b) return 1;
    const aNum = parseInt(a, 10);
    const bNum = parseInt(b, 10);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum < bNum ? -1 : 1;
    } else {
      if (a !== b) return a < b ? -1 : 1;
    }
  }
  return 0;
}

/**
 * 将版本号数组按语义化版本降序排序 (最新在前)。
 *
 * @param {string[]} versions 版本号数组
 * @returns {string[]} 排序后的数组 (新数组，不修改原数组)
 */
function sortVersionsDesc(versions) {
  return [...versions].sort((a, b) => compareSemver(b, a));
}

/**
 * 比较两个语义化版本号的大小。
 *
 * 兼容包装: 使用 compareSemver 进行完整比较。
 *
 * @param {string} v1 版本号1 (可能含 ^ ~ 等前缀)
 * @param {string} v2 版本号2
 * @returns {number} -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)
 */
function compareVersions(v1, v2) {
  return compareSemver(v1, v2);
}

/**
 * 根据版本比较结果生成状态描述。
 *
 * @param {string} currentVersion 当前鸿蒙化使用的版本
 * @param {string} latestVersion npm 最新版本
 * @returns {{status: string, color: string, detail: string}}
 */
function getVersionStatus(currentVersion, latestVersion) {
  const cmp = compareVersions(currentVersion, latestVersion);
  const cleanCurrent = currentVersion.replace(/^[\^~>=<\s]+/, '');

  if (cmp === 0) {
    return {
      status: '最新',
      color: COLORS.GREEN,
      detail: `鸿蒙化版本与 npm 最新版本一致 (${cleanCurrent})`,
    };
  } else if (cmp < 0) {
    // 计算落后的大版本差距
    const curParts = cleanCurrent.split('.').map(n => parseInt(n, 10));
    const latParts = latestVersion.split('.').map(n => parseInt(n, 10));
    const majorDiff = (latParts[0] || 0) - (curParts[0] || 0);
    const minorDiff = (latParts[1] || 0) - (curParts[1] || 0);
    const patchDiff = (latParts[2] || 0) - (curParts[2] || 0);

    let gapDesc;
    if (majorDiff > 0) {
      gapDesc = `落后 ${majorDiff} 个大版本`;
    } else if (minorDiff > 0) {
      gapDesc = `落后 ${minorDiff} 个小版本`;
    } else {
      gapDesc = `落后 ${patchDiff} 个补丁版本`;
    }

    return {
      status: '落后',
      color: COLORS.YELLOW,
      detail: `鸿蒙化版本落后于 npm 最新版本 (${gapDesc})`,
    };
  } else {
    return {
      status: '超前',
      color: COLORS.CYAN,
      detail: `鸿蒙化版本高于 npm 最新版本 (可能使用了 beta/next 等预发布版本)`,
    };
  }
}

// ── 主流程 ───────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(`
detect-upstream-version.js
从 RN 鸿蒙三方库 git 仓库链接中分析上游版本号

用法:
  node detect-upstream-version.js <git-repo-url>

示例:
  node detect-upstream-version.js https://gitcode.com/CPF-RN/rntpc_lottie-turbo-react-native/blob/br_rnoh0.77
  node detect-upstream-version.js https://gitcode.com/CPF-RN/rntpc_lottie-turbo-react-native
  node detect-upstream-version.js https://github.com/react-native-oh-library/lottie-react-native/tree/main

输出说明 (普通模式):
  鸿蒙化版本 - 鸿蒙化仓库 package.json 中记录的上游依赖版本
  npm最新版本 - 通过 npm registry API 查询到的 dist-tags.latest 版本
  最近版本   - npm registry 中按语义化版本排序的最近 10 个版本号
  版本状态   - up-to-date/behind/ahead，表示鸿蒙化版本相对最新版本的状态

输出说明 (quiet 模式):
  格式: <鸿蒙化版本> <npm最新版本> <状态> <最近10个版本(逗号分隔)>
  状态: up-to-date | behind | ahead | unknown
  示例: 7.2.2 7.4.0 behind 7.4.0,7.3.1,7.2.2,7.2.1,...

选项:
  -h, --help     显示帮助信息
  -v, --verbose  显示详细输出
  -q, --quiet    只输出关键信息 (适合脚本调用)
`);
    process.exit(0);
  }

  const verbose = args.includes('-v') || args.includes('--verbose');
  const quiet = args.includes('-q') || args.includes('--quiet');
  const urlArg = args.find(a => !a.startsWith('-'));

  if (!urlArg) {
    error('请提供 git 仓库 URL');
    process.exit(1);
  }

  try {
    // 1. 解析 URL
    const repoInfo = parseGitUrl(urlArg);
    if (verbose) {
      info(`平台: ${repoInfo.platform}`);
      info(`Owner: ${repoInfo.owner}`);
      info(`仓库: ${repoInfo.repo}`);
      info(`分支: ${repoInfo.branch || '(默认)'}`);
    }

    // 2. 获取 package.json
    const pkg = await fetchPackageJson(repoInfo);

    if (verbose) {
      info(`包名: ${pkg.name || '(无)'}`);
      if (pkg.harmony && pkg.harmony.alias) {
        info(`Harmony alias: ${pkg.harmony.alias}`);
      }
    }

    // 3. 查找上游版本号
    const result = findUpstreamVersion(pkg, repoInfo.repo);

    if (result) {
      const cleanVersion = result.version.replace(/^[\^~>=<\s]+/, '');

      // 4. 查询 npm registry 获取最新版本和最近版本列表
      const npmInfo = await fetchLatestNpmVersion(result.matchedField);

      if (quiet) {
        // 只输出关键信息: 当前版本 最新版本 状态 最近10个版本
        if (npmInfo) {
          const cmp = compareVersions(cleanVersion, npmInfo.latest);
          const status = cmp === 0 ? 'up-to-date' : (cmp < 0 ? 'behind' : 'ahead');
          const recentStr = npmInfo.recentVersions && npmInfo.recentVersions.length > 0
            ? npmInfo.recentVersions.join(',')
            : 'N/A';
          console.log(`${cleanVersion} ${npmInfo.latest} ${status} ${recentStr}`);
        } else {
          console.log(`${cleanVersion} UNKNOWN unknown N/A`);
        }
      } else {
        ok(`找到上游版本:`);
        console.log(`  仓库名:       ${repoInfo.repo}`);
        console.log(`  匹配包名:     ${result.matchedField}`);
        console.log(`  匹配区域:     ${result.matchedSection}`);
        console.log(`  鸿蒙化版本:   ${result.version}`);
        console.log(`  纯版本号:     ${cleanVersion}`);

        if (npmInfo) {
          console.log(`  npm最新版本:  ${npmInfo.latest}`);

          // 显示其他 dist-tags (如果有)
          if (npmInfo.allTags && Object.keys(npmInfo.allTags).length > 1) {
            const otherTags = Object.entries(npmInfo.allTags)
              .filter(([k]) => k !== 'latest')
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            if (otherTags) {
              console.log(`  其他标签:     ${otherTags}`);
            }
          }

          // 显示最近 10 个版本
          if (npmInfo.recentVersions && npmInfo.recentVersions.length > 0) {
            console.log(`  最近版本:     ${npmInfo.recentVersions.join(', ')}`);
          }

          // 版本状态分析
          const versionStatus = getVersionStatus(cleanVersion, npmInfo.latest);
          console.log(`  版本状态:     ${versionStatus.color}${versionStatus.status}${COLORS.NC} - ${versionStatus.detail}`);
        } else {
          console.log(`  npm最新版本:  ${COLORS.YELLOW}查询失败${COLORS.NC}`);
        }
      }
    } else {
      if (quiet) {
        console.error('UNKNOWN');
      } else {
        warn('未找到匹配的上游版本号');
        if (verbose && pkg.dependencies) {
          info('dependencies 中的依赖:');
          for (const [name, version] of Object.entries(pkg.dependencies)) {
            console.log(`    ${name}: ${version}`);
          }
        }
      }
      process.exit(2);
    }
  } catch (err) {
    error(err.message);
    process.exit(1);
  }
}

main();
