#!/usr/bin/env node
/**
 * Resolve / persist usage-docs local path.
 * Usage:
 *   node resolve-usage-docs.js --print
 *   node resolve-usage-docs.js --set /path/to/usage-docs
 */
const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(SKILL_DIR, 'config.json');
const DEFAULT_REMOTE = 'https://gitcode.com/CPF-RN/usage-docs';

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      usageDocsPath: null,
      remoteUsageDocs: DEFAULT_REMOTE,
      remoteDefaultBranch: 'master',
    };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

const args = process.argv.slice(2);
const setIdx = args.indexOf('--set');
const doPrint = args.includes('--print') || setIdx < 0;

let cfg = readConfig();

if (setIdx >= 0) {
  const p = args[setIdx + 1];
  if (!p) {
    console.error('Missing path after --set');
    process.exit(1);
  }
  const abs = path.resolve(p);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    console.error(`Not a directory: ${abs}`);
    process.exit(1);
  }
  cfg.usageDocsPath = abs;
  if (!cfg.remoteUsageDocs) cfg.remoteUsageDocs = DEFAULT_REMOTE;
  if (!cfg.remoteDefaultBranch) cfg.remoteDefaultBranch = 'master';
  writeConfig(cfg);
  console.error(`[resolve-usage-docs] Saved usageDocsPath=${abs}`);
}

const local = cfg.usageDocsPath && fs.existsSync(cfg.usageDocsPath) ? cfg.usageDocsPath : null;
const result = {
  configPath: CONFIG_PATH,
  usageDocsPath: local,
  hasLocal: Boolean(local),
  remoteUsageDocs: cfg.remoteUsageDocs || DEFAULT_REMOTE,
  remoteDefaultBranch: cfg.remoteDefaultBranch || 'master',
  rawZhBase: `${(cfg.remoteUsageDocs || DEFAULT_REMOTE).replace(/\/$/, '')}/raw/${cfg.remoteDefaultBranch || 'master'}/zh-cn`,
  rawEnBase: `${(cfg.remoteUsageDocs || DEFAULT_REMOTE).replace(/\/$/, '')}/raw/${cfg.remoteDefaultBranch || 'master'}/en`,
};

if (doPrint || setIdx >= 0) {
  console.log(JSON.stringify(result, null, 2));
}
