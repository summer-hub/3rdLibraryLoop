#!/usr/bin/env node
/**
 * Normalize Gitcode org + usage-docs links; verify targets are reachable after changes.
 *
 * Usage:
 *   node normalize-readme-links.js --lib-path <lib-root> [--write] [--skip-verify]
 *   node normalize-readme-links.js --lib-path <lib-root> [--files README.md,README_EN.md]
 */
const fs = require('fs');
const path = require('path');
const {
  verifyUrlSync,
  extractHttpUrls,
  verifyUrls,
  summarizeVerification,
  resolveVerifiedLibRepoBase,
  migrateGitcodeOrgUrlIfVerified,
} = require('./link-verify');

function parseArgs(argv) {
  const out = { write: false, skipVerify: false, files: ['README.md', 'README_EN.md'] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lib-path') out.libPath = argv[++i];
    else if (arg === '--write') out.write = true;
    else if (arg === '--skip-verify') out.skipVerify = true;
    else if (arg === '--files') out.files = argv[++i].split(',').map((s) => s.trim());
  }
  return out;
}

function readRegistry() {
  const p = path.resolve(__dirname, '..', 'references', 'link-registry.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function migrateDeprecatedGitcodeUrls(content, registry, verifyOptions) {
  const urls = extractHttpUrls(content).filter((u) =>
    registry.deprecatedOrgPatterns.some((p) =>
      new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(u),
    ),
  );

  let out = content;
  const migrations = [];

  for (const original of urls) {
    const result = migrateGitcodeOrgUrlIfVerified(original, registry, verifyOptions);
    if (result.migrated && result.url !== original) {
      out = out.split(original).join(result.url);
      migrations.push({ from: original, to: result.url, status: result.verified.status });
    } else if (result.keepOriginal) {
      migrations.push({
        from: original,
        attempted: result.attempted,
        error: result.error,
        status: result.verified.status,
        keptOriginal: true,
      });
    }
  }

  return { text: out, migrations };
}

function normalizeContent(content, ctx) {
  const { registry, libRepoBase, libRepoVerified, verifyOptions } = ctx;
  const changes = [];
  let out = content;

  const deprecatedMigrate = migrateDeprecatedGitcodeUrls(out, registry, verifyOptions);
  out = deprecatedMigrate.text;
  for (const m of deprecatedMigrate.migrations) {
    if (m.keptOriginal) {
      changes.push({
        type: 'unverified-org-migration',
        from: m.from,
        attempted: m.attempted,
        status: m.status,
        note: 'CPF-RN target not reachable; kept original URL — fix repo name or org manually',
      });
    } else {
      changes.push({ type: 'org-migration-verified', from: m.from, to: m.to, status: m.status });
    }
  }

  const linkSource = registry.usageDocs.linkSourceCodeZh;
  out = out.replace(
    /https?:\/\/gitcode\.com\/CPF-RN\/ohos_react_native\/blob\/[^)\s]*link-source-code\.md/gi,
    linkSource,
  );
  const usageBase = `${registry.usageDocs.base}/blob/${registry.usageDocs.branch}`;

  const relativeReplacements = [
    {
      pattern: /\]\(\/zh-cn\/link-source-code\.md\)/g,
      to: `](${linkSource})`,
      note: 'usage-docs relative -> usage-docs absolute (link-source-code)',
    },
    {
      pattern: /\]\(\/en\/link-source-code\.md\)/g,
      to: `](${registry.usageDocs.linkSourceCodeEn})`,
      note: 'usage-docs relative -> usage-docs absolute (link-source-code en)',
    },
    {
      pattern: /\]\(\.\/link-source-code\.md\)/g,
      to: `](${linkSource})`,
      note: 'usage-docs sibling relative -> usage-docs absolute',
    },
    {
      pattern: /\]\(\/zh-cn\/([^)]+)\)/g,
      to: (_, file) => `](${usageBase}/zh-cn/${file})`,
      note: 'usage-docs zh-cn relative -> absolute',
    },
    {
      pattern: /\]\(\/en\/([^)]+)\)/g,
      to: (_, file) => `](${usageBase}/en/${file})`,
      note: 'usage-docs en relative -> absolute',
    },
  ];

  for (const rule of relativeReplacements) {
    const before = out;
    out = out.replace(rule.pattern, rule.to);
    if (out !== before) changes.push({ type: 'relative-path', note: rule.note });
  }

  if (/openharmony-sig/i.test(out)) {
    changes.push({
      type: 'residual-deprecated-org',
      note: 'still contains openharmony-sig (migration skipped or partial — verify repo exists under CPF-RN)',
    });
  }

  if (libRepoVerified) {
    const issuePrPatterns = [
      {
        pattern: /https?:\/\/gitcode\.com\/openharmony-sig\/[^/]+\/(issues|pulls)/gi,
        to: (_match, kind) => `${libRepoBase}/${kind}`,
        note: 'issue/pr link -> verified CPF-RN lib repo',
      },
      {
        pattern: /https?:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/LICENSE/gi,
        to: () => `${libRepoBase}/blob/master/LICENSE`,
        note: 'license link -> verified CPF-RN LICENSE file',
      },
    ];
    for (const rule of issuePrPatterns) {
      const before = out;
      out = out.replace(rule.pattern, rule.to);
      if (out !== before) changes.push({ type: 'repo-link', note: rule.note });
    }
  } else {
    changes.push({
      type: 'repo-base-unverified',
      libRepoBase,
      note: 'skipped issue/pr/license auto-rewrite — lib repo base URL not verified reachable',
    });
  }

  const relativeLinkRe = /\]\((\.\.?\/[^)]+)\)/g;
  let m;
  while ((m = relativeLinkRe.exec(out)) !== null) {
    const target = m[1];
    const allowed = registry.allowedRelativeTargetsInLibReadme.some(
      (a) => target === a || target.endsWith(a.replace(/^\.\//, '')),
    );
    const abs = path.resolve(path.dirname(ctx.filePath), target);
    if (!allowed && !fs.existsSync(abs)) {
      changes.push({ type: 'broken-relative', target, file: ctx.filePath });
    }
  }

  return { text: out, changes, modified: out !== content };
}

function verifyPackageUrls(pkg, libRepoBase, verifyOptions) {
  const urls = [];
  if (pkg.homepage) urls.push(pkg.homepage);
  if (pkg.bugs?.url) urls.push(pkg.bugs.url);
  if (pkg.repository?.url) {
    const repoWeb = pkg.repository.url
      .replace(/^git\+/, '')
      .replace(/^git@gitcode\.com:/, 'https://gitcode.com/')
      .replace(/\.git$/, '');
    urls.push(repoWeb);
  }
  urls.push(`${libRepoBase}/issues`, `${libRepoBase}/pulls`, `${libRepoBase}/blob/master/LICENSE`);
  return verifyUrls([...new Set(urls)], verifyOptions);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.libPath) {
    console.error(
      'Usage: node normalize-readme-links.js --lib-path <lib-root> [--write] [--skip-verify]',
    );
    process.exit(1);
  }

  const libRoot = path.resolve(args.libPath);
  const registry = readRegistry();
  const verifyOptions = { skipVerify: args.skipVerify };

  const repoResolve = resolveVerifiedLibRepoBase(libRoot, registry, verifyOptions);
  const libRepoBase = repoResolve.libRepoBase;
  const libRepoVerified = repoResolve.verified || args.skipVerify;

  const report = {
    libRoot,
    libRepoBase,
    libRepoVerified,
    libRepoCandidates: repoResolve.tried,
    skipVerify: args.skipVerify,
    files: [],
    linkVerification: null,
    ok: true,
  };

  if (!libRepoVerified && !args.skipVerify) {
    report.ok = false;
    report.repoResolveError =
      'Could not verify CPF-RN repository URL; check git remote / repo name under CPF-RN';
  }

  const allUrlsToVerify = [];

  for (const rel of args.files) {
    const filePath = path.join(libRoot, rel);
    if (!fs.existsSync(filePath)) {
      report.files.push({ file: rel, skipped: true, reason: 'not found' });
      continue;
    }
    const original = fs.readFileSync(filePath, 'utf8');
    const { text, changes, modified } = normalizeContent(original, {
      registry,
      libRepoBase,
      libRepoVerified,
      verifyOptions,
      filePath,
    });

    const badChanges = changes.filter((c) =>
      ['broken-relative', 'residual-deprecated-org', 'unverified-org-migration', 'repo-base-unverified'].includes(
        c.type,
      ),
    );
    if (badChanges.length) report.ok = false;

    if (modified && args.write) fs.writeFileSync(filePath, text);
    allUrlsToVerify.push(...extractHttpUrls(modified ? text : original));
    report.files.push({ file: rel, modified, changes, written: modified && args.write });
  }

  const pkgPath = path.join(libRoot, 'package.json');
  const pkg = readJson(pkgPath);
  if (pkg && libRepoVerified) {
    const expectedHomepage = libRepoBase;
    const expectedBugs = `${libRepoBase}/issues`;
    const expectedRepo = `${libRepoBase}.git`;
    const proposed = JSON.parse(JSON.stringify(pkg));
    const pkgUpdates = [];

    const maybeSet = (field, setter, from, to) => {
      if (from === to) return;
      pkgUpdates.push({ field, from, to });
      setter(to);
    };

    if (
      proposed.repository?.url &&
      (/openharmony-sig/i.test(proposed.repository.url) || !/CPF-RN\//i.test(proposed.repository.url))
    ) {
      maybeSet(
        'repository.url',
        (v) => {
          proposed.repository.url = v;
        },
        proposed.repository.url,
        expectedRepo,
      );
    }
    if (
      proposed.homepage &&
      (/openharmony-sig/i.test(proposed.homepage) || !/CPF-RN\//i.test(proposed.homepage))
    ) {
      maybeSet('homepage', (v) => {
        proposed.homepage = v;
      }, proposed.homepage, expectedHomepage);
    }
    if (proposed.bugs?.url && (/openharmony-sig/i.test(proposed.bugs.url) || !/CPF-RN\//i.test(proposed.bugs.url))) {
      maybeSet(
        'bugs.url',
        (v) => {
          proposed.bugs.url = v;
        },
        proposed.bugs.url,
        expectedBugs,
      );
    }

    if (pkgUpdates.length) {
      const pkgVerify = verifyPackageUrls(proposed, libRepoBase, verifyOptions);
      const verifySummary = summarizeVerification(pkgVerify);
      report.packageJson = {
        modified: true,
        changes: pkgUpdates,
        verification: verifySummary,
        written: false,
      };
      allUrlsToVerify.push(...pkgVerify.map((r) => r.url));
      if (!verifySummary.ok && !args.skipVerify) report.ok = false;
      if (args.write && (verifySummary.ok || args.skipVerify)) {
        Object.assign(pkg, proposed);
        fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
        report.packageJson.written = true;
      }
    }
  } else if (pkg && !libRepoVerified) {
    report.packageJson = {
      skipped: true,
      reason: 'lib repo base not verified — package.json URLs not auto-updated',
    };
  }

  if (!args.skipVerify && allUrlsToVerify.length) {
    const verification = summarizeVerification(verifyUrls([...new Set(allUrlsToVerify)], verifyOptions));
    report.linkVerification = verification;
    if (!verification.ok) report.ok = false;
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main();
