#!/usr/bin/env node
/**
 * Detect README documentation template format.
 * Usage: node detect-readme-format.js <lib-root> [--expect 0.4.2] [--file README.md]
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const libRoot = args.find((a) => !a.startsWith('--'));
const expectIdx = args.indexOf('--expect');
const expect = expectIdx >= 0 ? String(args[expectIdx + 1]).replace(/^v/, '') : '0.4.2';
const fileIdx = args.indexOf('--file');
const fileName = fileIdx >= 0 ? args[fileIdx + 1] : 'README.md';

if (!libRoot) {
  console.error('Usage: node detect-readme-format.js <lib-root> [--expect 0.4.2] [--file README.md]');
  process.exit(1);
}

const readmePath = path.join(libRoot, fileName);
if (!fs.existsSync(readmePath)) {
  console.log(JSON.stringify({
    path: readmePath,
    exists: false,
    kind: 'missing',
    matchesExpect: false,
    expect,
    needsUsageDocsMigration: true,
    isV041: false,
    isExternalLink: false,
  }, null, 2));
  process.exit(0);
}

const text = fs.readFileSync(readmePath, 'utf8');
const head = text.slice(0, 2500);
const firstLine = (text.split(/\r?\n/).find((l) => l.trim()) || '').trim();

const versionMatch =
  firstLine.match(/文档模板\s*[：:]\s*v?(\d+\.\d+\.\d+)/i) ||
  firstLine.match(/模板版本\s*[：:]\s*v?(\d+\.\d+\.\d+)/i) ||
  firstLine.match(/Template version\s*[：:]\s*v?(\d+\.\d+\.\d+)/i) ||
  firstLine.match(/Document template\s*[：:]\s*v?(\d+\.\d+\.\d+)/i);

const declaredVersion = versionMatch ? versionMatch[1] : null;

const hasNpmAddressCol = /\|[^|\n]*npm地址[^|\n]*\|/i.test(head) || /\|\s*npm Address\s*\|/i.test(head);
const hasVersionNpmCol = /三方库版本（npm地址）/.test(head) || /Version\s*\(npm/i.test(head);
const hasSourceCol = /源码地址/.test(head) || /\|\s*Source\s*\|/i.test(head) || /源码地址/.test(head);
const hasDocUrlSection = /##\s*Documentation URL/i.test(text) || /Documentation URL/.test(head);
const linkHeavy =
  hasDocUrlSection &&
  !/##\s*简介/.test(text) &&
  !/##\s*下载安装/.test(text) &&
  !/##\s*1\.\s*安装/.test(text) &&
  (text.match(/https?:\/\//g) || []).length <= 8 &&
  text.length < 1500;

const hasIntro = /##\s*简介/.test(text) || /##\s*Introduction/i.test(text);
const hasInstall = /##\s*下载安装/.test(text) || /##\s*Installation/i.test(text);
const hasUsageGuide = /##\s*使用说明/.test(text) || /##\s*Usage Guide/i.test(text);
const numberedInstall = /##\s*1\.\s*(安装|Installation)/i.test(text);

let kind = 'unknown';
if (linkHeavy || (hasDocUrlSection && !hasIntro && !numberedInstall)) {
  kind = 'external_link';
} else if (declaredVersion === '0.4.2' || (hasVersionNpmCol && hasSourceCol && hasUsageGuide)) {
  kind = 'v0.4.2';
} else if (declaredVersion === '0.4.1' || (hasIntro && hasInstall && hasNpmAddressCol && !hasVersionNpmCol)) {
  kind = 'v0.4.1';
} else if (declaredVersion === '0.4.0' || numberedInstall) {
  kind = 'v0.4.0';
} else if (declaredVersion) {
  kind = `v${declaredVersion}`;
}

const matchesExpect = kind === `v${expect}`;
const isV041 = kind === 'v0.4.1';
const isExternalLink = kind === 'external_link';
const needsUsageDocsMigration = !matchesExpect && !isV041;

const result = {
  path: readmePath,
  exists: true,
  kind,
  declaredVersion,
  matchesExpect,
  expect,
  isV041,
  isExternalLink,
  needsUsageDocsMigration,
  signals: {
    hasVersionNpmCol,
    hasNpmAddressCol,
    hasSourceCol,
    hasIntro,
    hasInstall,
    hasUsageGuide,
    numberedInstall,
    hasDocUrlSection,
  },
};

console.log(JSON.stringify(result, null, 2));
