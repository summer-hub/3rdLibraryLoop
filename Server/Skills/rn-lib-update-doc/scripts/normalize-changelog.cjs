#!/usr/bin/env node
/**
 * Check CHANGELOG.md against Keep a Changelog conventions.
 *
 * Usage:
 *   node normalize-changelog.js --lib-path <lib-root>
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--lib-path') out.libPath = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.libPath) {
    console.error('Usage: node normalize-changelog.js --lib-path <lib-root>');
    process.exit(1);
  }

  const filePath = path.join(path.resolve(args.libPath), 'CHANGELOG.md');
  const report = { file: 'CHANGELOG.md', exists: fs.existsSync(filePath), ok: true, issues: [] };

  if (!report.exists) {
    report.ok = false;
    report.issues.push('CHANGELOG.md missing');
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  if (!/Keep a Changelog/i.test(content)) {
    report.issues.push('missing Keep a Changelog reference in header');
    report.ok = false;
  }
  if (!/^## \[Unreleased\]/m.test(content)) {
    report.issues.push('missing ## [Unreleased] section');
    report.ok = false;
  }
  if (!/^## \[\d/m.test(content)) {
    report.issues.push('missing version sections like ## [x.y.z]');
    report.ok = false;
  }

  const versionBlocks = content.split(/^## \[/m).slice(1);
  for (const block of versionBlocks) {
    const header = block.split('\n')[0];
    if (/^Unreleased\]/i.test(header)) continue;
    const body = block.slice(header.length);
    const hasCategory = /### (Added|Changed|Fixed|Deprecated|Removed|Security)/.test(body);
    if (!hasCategory) {
      report.issues.push(`version [${header.replace(/\].*$/, '')}] missing Added/Changed/Fixed/Deprecated categories`);
      report.ok = false;
    }
  }

  if (/^## 鸿蒙化Log|^### v\d|^## ReleaseLog/m.test(content)) {
    report.issues.push('legacy headings detected (鸿蒙化Log / ReleaseLog / vX.Y.Z without brackets)');
    report.ok = false;
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main();
