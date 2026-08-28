#!/usr/bin/env node
/**
 * Locate zh/en docs for a library inside usage-docs (local or remote URLs).
 * Usage: node find-usage-doc.js --lib-path <lib-root> [--usage-docs <path>]
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lib-path') out.libPath = argv[++i];
    else if (argv[i] === '--usage-docs') out.usageDocs = argv[++i];
  }
  return out;
}

function readConfig() {
  const cfgPath = path.resolve(__dirname, '..', 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
}

function candidateNames(libRoot) {
  const names = [];
  const pkgPath = path.join(libRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.harmony && pkg.harmony.alias) names.push(pkg.harmony.alias);
    if (pkg.name) {
      names.push(pkg.name.includes('/') ? pkg.name.split('/').pop() : pkg.name);
    }
  }
  const base = path.basename(libRoot);
  names.push(base);
  if (base.startsWith('rntpc_')) names.push(base.slice('rntpc_'.length));
  return [...new Set(names.filter(Boolean))];
}

const args = parseArgs(process.argv.slice(2));
if (!args.libPath) {
  console.error('Usage: node find-usage-doc.js --lib-path <lib-root> [--usage-docs <path>]');
  process.exit(1);
}

const cfg = readConfig();
const usageDocs =
  args.usageDocs ||
  (cfg.usageDocsPath && fs.existsSync(cfg.usageDocsPath) ? cfg.usageDocsPath : null);
const remote = cfg.remoteUsageDocs || 'https://gitcode.com/CPF-RN/usage-docs';
const branch = cfg.remoteDefaultBranch || 'master';
const candidates = candidateNames(path.resolve(args.libPath));

const hits = [];
if (usageDocs) {
  for (const name of candidates) {
    const zh = path.join(usageDocs, 'zh-cn', `${name}.md`);
    const en = path.join(usageDocs, 'en', `${name}.md`);
    if (fs.existsSync(zh) || fs.existsSync(en)) {
      hits.push({
        name,
        zh: fs.existsSync(zh) ? zh : null,
        en: fs.existsSync(en) ? en : null,
      });
    }
  }
}

const remoteUrls = candidates.map((name) => ({
  name,
  zh: `${remote.replace(/\/$/, '')}/raw/${branch}/zh-cn/${name}.md`,
  en: `${remote.replace(/\/$/, '')}/raw/${branch}/en/${name}.md`,
}));

const result = {
  libPath: path.resolve(args.libPath),
  usageDocsPath: usageDocs,
  hasLocal: Boolean(usageDocs),
  candidates,
  localHits: hits,
  preferredLocal: hits[0] || null,
  remoteUrls,
  preferredRemote: remoteUrls[0] || null,
};

console.log(JSON.stringify(result, null, 2));
if (usageDocs && hits.length === 0) {
  console.error('[find-usage-doc] No local doc matched candidates; try remoteUrls or check alias.');
  process.exitCode = 2;
}
