/**
 * HTTP link verification for rn-lib-update-doc.
 * Replaces must be validated — do not assume org rename alone makes URLs work.
 */
const { execSync } = require('child_process');

const DEFAULT_TIMEOUT_SEC = 15;
const STRICT_HOSTS = [/gitcode\.com/i];
const SOFT_PASS_HOSTS = [/npmjs\.com/i, /registry\.npmjs\.org/i];

function isStrictUrl(url) {
  return STRICT_HOSTS.some((re) => re.test(url));
}

function isSoftPassHost(url) {
  return SOFT_PASS_HOSTS.some((re) => re.test(url));
}

function verifyUrlSync(url, options = {}) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { url, ok: false, status: 0, error: 'invalid-url', strict: false };
  }
  if (options.skipVerify) {
    return { url, ok: true, status: null, skipped: true, strict: isStrictUrl(url) };
  }

  const timeout = options.timeoutSec || DEFAULT_TIMEOUT_SEC;
  const escaped = url.replace(/'/g, "'\\''");
  const ua = 'Mozilla/5.0 (compatible; rn-lib-update-doc/1.0)';

  try {
    const code = execSync(
      `curl -s -o /dev/null -w '%{http_code}' -L --max-time ${timeout} -A '${ua}' '${escaped}'`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    const status = parseInt(code, 10);
    let ok = !Number.isNaN(status) && status >= 200 && status < 400;
    const strict = isStrictUrl(url);

    if (!ok && isSoftPassHost(url) && (status === 403 || status === 401)) {
      return {
        url,
        ok: true,
        status,
        softPass: true,
        strict: false,
        note: 'external-registry-bot-blocked',
      };
    }

    return {
      url,
      ok,
      status,
      strict,
      error: ok ? undefined : `http-${status}`,
    };
  } catch (err) {
    return { url, ok: false, status: 0, strict: isStrictUrl(url), error: String(err.message || err) };
  }
}

/** Extract http(s) URLs from markdown / plain text. */
function extractHttpUrls(text) {
  if (!text) return [];
  const re = /https?:\/\/[^\s)<>"']+/g;
  const found = text.match(re) || [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?)]+$/, '')))];
}

function normalizeRepoWebUrl(url) {
  if (!url) return null;
  return url
    .replace(/^git\+/, '')
    .replace(/^git@gitcode\.com:/, 'https://gitcode.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function verifyUrls(urls, options = {}) {
  const results = [];
  const seen = new Set();
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push(verifyUrlSync(url, options));
  }
  return results;
}

function summarizeVerification(results) {
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const strictFailed = failed.filter((r) => r.strict !== false);
  const softPassed = results.filter((r) => r.softPass);
  return {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    strictFailed: strictFailed.length,
    softPassed: softPassed.length,
    failures: failed,
    strictFailures: strictFailed,
    ok: strictFailed.length === 0,
  };
}

/**
 * Try multiple repo base candidates; return first that responds HTTP 2xx/3xx.
 */
function resolveVerifiedLibRepoBase(libRoot, registry, options = {}) {
  const { execSync: exec } = require('child_process');
  const readJson = (p) => {
    try {
      return JSON.parse(require('fs').readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  };

  const pkg = readJson(require('path').join(libRoot, 'package.json'));
  const candidates = [];

  if (pkg?.repository?.url) {
    const u = normalizeRepoWebUrl(
      pkg.repository.url.replace(/openharmony-sig/gi, registry.defaultLibOrg),
    );
    if (u) candidates.push(u);
  }

  try {
    const remote = exec('git remote get-url origin', {
      cwd: libRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const u = normalizeRepoWebUrl(
      remote.replace(/openharmony-sig/gi, registry.defaultLibOrg),
    );
    if (u) candidates.push(u);
  } catch {
    /* no remote */
  }

  const base = require('path').basename(libRoot);
  const aliasNames = new Set();
  if (pkg?.harmony?.alias) {
    const a = pkg.harmony.alias;
    aliasNames.add(a.includes('/') ? a.split('/').pop() : a);
  }
  if (pkg?.name) aliasNames.add(pkg.name.includes('/') ? pkg.name.split('/').pop() : pkg.name);
  aliasNames.add(base);
  if (base.startsWith('rntpc_')) aliasNames.add(base.slice('rntpc_'.length));

  for (const alias of aliasNames) {
    const repoName = registry.libRepoNamePattern.replace('{alias}', alias);
    candidates.push(`https://gitcode.com/${registry.defaultLibOrg}/${repoName}`);
    if (base.startsWith('rntpc_')) {
      candidates.push(`https://gitcode.com/${registry.defaultLibOrg}/${base}`);
    }
  }

  const unique = [...new Set(candidates.filter(Boolean))];
  const tried = [];

  for (const candidate of unique) {
    const check = verifyUrlSync(candidate, options);
    tried.push({ candidate, ...check });
    if (check.ok) {
      return { libRepoBase: candidate, verified: true, tried };
    }
  }

  return {
    libRepoBase: unique[0] || `https://gitcode.com/${registry.defaultLibOrg}/${base}`,
    verified: false,
    tried,
  };
}

/**
 * Migrate openharmony-sig GitCode URL to CPF-RN only when target URL is reachable.
 */
function migrateGitcodeOrgUrlIfVerified(url, registry, options = {}) {
  const deprecated = registry.deprecatedOrgPatterns.find((p) =>
    new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(url),
  );
  if (!deprecated) return { url, migrated: false, verified: verifyUrlSync(url, options) };

  const target = url.replace(/openharmony-sig/gi, registry.defaultLibOrg);
  const check = verifyUrlSync(target, options);
  if (check.ok) {
    return { url: target, migrated: true, from: url, verified: check };
  }
  return {
    url,
    migrated: false,
    from: url,
    attempted: target,
    verified: check,
    keepOriginal: true,
    error: 'target-not-reachable',
  };
}

module.exports = {
  verifyUrlSync,
  extractHttpUrls,
  verifyUrls,
  summarizeVerification,
  resolveVerifiedLibRepoBase,
  migrateGitcodeOrgUrlIfVerified,
  normalizeRepoWebUrl,
};
