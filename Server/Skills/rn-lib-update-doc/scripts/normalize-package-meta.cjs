#!/usr/bin/env node
/**
 * Normalize package.json and harmony oh-package.json5 metadata for CPF-RN libs.
 *
 * Usage:
 *   node normalize-package-meta.js --lib-path <lib-root> [--write] [--skip-verify]
 */
const fs = require('fs');
const path = require('path');
const {
  resolveVerifiedLibRepoBase,
  verifyUrls,
  summarizeVerification,
} = require('./link-verify');

const REQUIRED_KEYWORDS = ['rnoh', 'harmonyos', 'openharmony', 'ohos'];
const DEFAULT_PUBLISH_CONFIG = {
  registry: 'https://registry.npmjs.org/',
  access: 'public',
};

function parseArgs(argv) {
  const out = { write: false, skipVerify: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lib-path') out.libPath = argv[++i];
    else if (arg === '--write') out.write = true;
    else if (arg === '--skip-verify') out.skipVerify = true;
  }
  return out;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readRegistry() {
  const p = path.resolve(__dirname, '..', 'references', 'link-registry.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function normalizeGitcodeUrl(url, registry) {
  if (!url) return url;
  return url
    .replace(/openharmony-sig/gi, registry.defaultLibOrg)
    .replace(/OpenHarmony-sig/gi, registry.defaultLibOrg);
}

function packageUrlsToVerify(pkg, libRepoBase) {
  const urls = [libRepoBase, `${libRepoBase}/issues`, `${libRepoBase}/blob/master/LICENSE`];
  if (pkg.homepage) urls.push(pkg.homepage);
  if (pkg.bugs?.url) urls.push(pkg.bugs.url);
  return [...new Set(urls)];
}

function mergeKeywords(existing = []) {
  const merged = [...existing];
  for (const kw of REQUIRED_KEYWORDS) {
    if (!merged.includes(kw)) merged.push(kw);
  }
  return merged;
}

function findOhPackageFiles(libRoot) {
  const results = [];
  const harmonyRoot = path.join(libRoot, 'harmony');
  if (!fs.existsSync(harmonyRoot)) return results;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'build', 'oh_modules', '.cxx'].includes(entry.name)) continue;
        walk(full);
      } else if (entry.name === 'oh-package.json5') {
        results.push(full);
      }
    }
  }
  walk(harmonyRoot);
  return results;
}

function patchOhPackageJson5(content, description) {
  let out = content;
  const changes = [];

  if (!/"license"\s*:\s*"MIT"/i.test(out)) {
    if (/"license"\s*:/.test(out)) {
      out = out.replace(/"license"\s*:\s*"[^"]*"/, '"license": "MIT"');
      changes.push('license->MIT');
    } else {
      out = out.replace(/(\{[^\n]*\n)/, '$1  "license": "MIT",\n');
      changes.push('add-license-MIT');
    }
  }

  const desc = description || 'React Native OpenHarmony module';
  if (/"description"\s*:/.test(out)) {
    if (!/"description"\s*:\s*"[^"]{3,}"/.test(out)) {
      out = out.replace(/"description"\s*:\s*"[^"]*"/, `"description": "${desc}"`);
      changes.push('description-updated');
    }
  } else {
    out = out.replace(/(\{[^\n]*\n)/, `$1  "description": "${desc}",\n`);
    changes.push('add-description');
  }

  return { text: out, changes, modified: out !== content };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.libPath) {
    console.error('Usage: node normalize-package-meta.js --lib-path <lib-root> [--write]');
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
    ok: true,
    packageJson: null,
    ohPackages: [],
    linkVerification: null,
  };

  if (!libRepoVerified && !args.skipVerify) {
    report.ok = false;
    report.repoResolveError =
      'Could not verify CPF-RN repository URL; refusing to rewrite package.json links blindly';
  }

  const pkgPath = path.join(libRoot, 'package.json');
  const pkg = readJson(pkgPath);
  if (!pkg) {
    console.error('package.json not found');
    process.exit(1);
  }

  const pkgChanges = [];
  const nextPkg = { ...pkg };

  const expectedRepo = `${libRepoBase}.git`;
  const expectedHomepage = libRepoBase;
  const expectedBugs = `${libRepoBase}/issues`;

  if (libRepoVerified) {
    if (!nextPkg.repository) nextPkg.repository = { type: 'git', url: expectedRepo };
    else {
      const normalized = normalizeGitcodeUrl(nextPkg.repository.url, registry);
      if (normalized !== nextPkg.repository.url) {
        pkgChanges.push({ field: 'repository.url', from: nextPkg.repository.url, to: normalized });
        nextPkg.repository.url = normalized;
      }
      if (!/CPF-RN\//i.test(nextPkg.repository.url) || !nextPkg.repository.url.endsWith('.git')) {
        pkgChanges.push({ field: 'repository.url', from: nextPkg.repository.url, to: expectedRepo });
        nextPkg.repository.url = expectedRepo;
      }
    }

    const homepage = normalizeGitcodeUrl(nextPkg.homepage, registry);
    if (homepage !== nextPkg.homepage || !/CPF-RN\//i.test(nextPkg.homepage || '')) {
      pkgChanges.push({ field: 'homepage', from: nextPkg.homepage, to: expectedHomepage });
      nextPkg.homepage = expectedHomepage;
    }

    if (!nextPkg.bugs) nextPkg.bugs = { url: expectedBugs };
    else {
      const bugsUrl = normalizeGitcodeUrl(nextPkg.bugs.url, registry);
      if (bugsUrl !== nextPkg.bugs.url || !/CPF-RN\//i.test(nextPkg.bugs.url || '')) {
        pkgChanges.push({ field: 'bugs.url', from: nextPkg.bugs.url, to: expectedBugs });
        nextPkg.bugs.url = expectedBugs;
      }
    }
  }

  if (nextPkg.license !== 'MIT') {
    pkgChanges.push({ field: 'license', from: nextPkg.license, to: 'MIT' });
    nextPkg.license = 'MIT';
  }

  if (!nextPkg.publishConfig) {
    pkgChanges.push({ field: 'publishConfig', to: DEFAULT_PUBLISH_CONFIG });
    nextPkg.publishConfig = { ...DEFAULT_PUBLISH_CONFIG };
  } else {
    const pc = { ...nextPkg.publishConfig };
    let pcChanged = false;
    if (pc.registry !== DEFAULT_PUBLISH_CONFIG.registry) {
      pc.registry = DEFAULT_PUBLISH_CONFIG.registry;
      pcChanged = true;
    }
    if (pc.access !== DEFAULT_PUBLISH_CONFIG.access) {
      pc.access = DEFAULT_PUBLISH_CONFIG.access;
      pcChanged = true;
    }
    if (pcChanged) {
      pkgChanges.push({ field: 'publishConfig', to: pc });
      nextPkg.publishConfig = pc;
    }
  }

  const mergedKeywords = mergeKeywords(nextPkg.keywords || []);
  if (JSON.stringify(mergedKeywords) !== JSON.stringify(nextPkg.keywords || [])) {
    pkgChanges.push({ field: 'keywords', from: nextPkg.keywords, to: mergedKeywords });
    nextPkg.keywords = mergedKeywords;
  }

  if (pkgChanges.length > 0) report.ok = false;

  if (libRepoVerified && pkgChanges.some((c) => ['repository.url', 'homepage', 'bugs.url'].includes(c.field))) {
    const verification = summarizeVerification(
      verifyUrls(packageUrlsToVerify(nextPkg, libRepoBase), verifyOptions),
    );
    report.linkVerification = verification;
    if (!verification.ok && !args.skipVerify) {
      report.ok = false;
      report.linkVerificationBlockedWrite = true;
    }
  }

  report.packageJson = {
    modified: pkgChanges.length > 0,
    changes: pkgChanges,
    written: false,
  };

  if (args.write && pkgChanges.length > 0 && (!report.linkVerificationBlockedWrite || args.skipVerify)) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(nextPkg, null, 2)}\n`);
    report.packageJson.written = true;
  }

  const description = nextPkg.description || pkg.description || 'React Native OpenHarmony module';
  for (const ohPath of findOhPackageFiles(libRoot)) {
    const rel = path.relative(libRoot, ohPath);
    const original = fs.readFileSync(ohPath, 'utf8');
    const { text, changes, modified } = patchOhPackageJson5(original, description);
    if (modified) report.ok = false;
    if (modified && args.write) fs.writeFileSync(ohPath, text);
    report.ohPackages.push({ file: rel, modified, changes, written: modified && args.write });
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main();
