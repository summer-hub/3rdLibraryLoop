#!/usr/bin/env node
/**
 * Detect RNOH framework version from a given path.
 *
 * Priority:
 *   1. Git branch name (e.g., br_rnoh0.82 -> 0.82)
 *   2. example/package.json react-native-harmony version
 *   3. harmony subdirs oh-package.json5 (RNOH deps)
 *   4. package.json peerDependencies react-native version
 *
 * Usage: node detect-rnoh-version.cjs <path> [--list-branches]
 *
 * Output (without --list-branches):
 *   JSON { path, version, source, branch?, raw }
 *
 * Output (with --list-branches):
 *   JSON { path, branches: [{ branch, version }] }
 *
 * Exit codes: 0 = version detected, 1 = cannot determine or error
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const targetPath = args.find((a) => !a.startsWith('--'));
const listBranches = args.includes('--list-branches');

if (!targetPath) {
  console.error('Usage: node detect-rnoh-version.cjs <path> [--list-branches]');
  process.exit(1);
}

if (!fs.existsSync(targetPath)) {
  console.error(`Path not found: ${targetPath}`);
  process.exit(1);
}

const resolved = path.resolve(targetPath);

function parseVersionFromBranch(branch) {
  if (!branch || branch === 'HEAD') return null;
  const match =
    branch.match(/rnoh?[\-_]?0?(\d+\.\d+)/i) ||
    branch.match(/0?(\d+\.\d+)/);
  return match ? match[1] : null;
}

function detectFromGitBranch(dir) {
  try {
    const branch = execSync(`git -C "${dir}" rev-parse --abbrev-ref HEAD 2>/dev/null`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    const version = parseVersionFromBranch(branch);
    return { version, source: 'git-branch', branch: branch || null, raw: branch || '' };
  } catch {
    return null;
  }
}

function listGitBranches(dir) {
  try {
    const out = execSync(`git -C "${dir}" branch -a 2>/dev/null`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    return out
      .split('\n')
      .map((b) => b.replace(/^\*\s*/, '').trim())
      .filter(Boolean)
      .filter((b) => !b.includes('->'))
      .map((b) => b.replace(/^remotes\/origin\//, ''));
  } catch {
    return [];
  }
}

function detectFromExamplePackageJson(dir) {
  const pkgPath = path.join(dir, 'example', 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const rnh = deps['react-native-harmony'];
    if (rnh) {
      const m = rnh.match(/(\d+\.\d+)\.\d+/);
      if (m) return { version: m[1], source: 'example/package.json (react-native-harmony)', raw: rnh };
    }
    const rn = deps['react-native'];
    if (rn) {
      const m = rn.match(/^(\d+\.\d+)/);
      if (m) return { version: m[1], source: 'example/package.json (react-native)', raw: rn };
    }
  } catch {}
  return null;
}

function detectFromOhPackage(dir) {
  const harmonyDir = path.join(dir, 'harmony');
  if (!fs.existsSync(harmonyDir)) return null;
  try {
    for (const sub of fs.readdirSync(harmonyDir, { withFileTypes: true })) {
      if (!sub.isDirectory() || sub.name === 'react_native_openharmony') continue;
      const ohPkgPath = path.join(harmonyDir, sub.name, 'oh-package.json5');
      if (!fs.existsSync(ohPkgPath)) continue;
      const content = fs.readFileSync(ohPkgPath, 'utf8');
      const clean = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([}\]])/g, '$1');
      const pkg = JSON.parse(clean);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [name, ver] of Object.entries(deps)) {
        if (name.includes('react-native-harmony') || name.includes('react-native-openharmony')) {
          const m = String(ver).match(/(\d+\.\d+)\.\d+/);
          if (m) return { version: m[1], source: `harmony/${sub.name}/oh-package.json5`, raw: `${name}@${ver}` };
        }
      }
    }
  } catch {}
  return null;
}

function detectFromRootPackageJson(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const peer = pkg.peerDependencies || {};
    const rn = peer['react-native'];
    if (rn) {
      const m = rn.match(/(\d+\.\d+)/);
      if (m) return { version: m[1], source: 'package.json (peerDependencies react-native)', raw: rn };
    }
  } catch {}
  return null;
}

if (listBranches) {
  const branches = listGitBranches(resolved);
  const branchInfo = branches.map((b) => ({
    branch: b,
    version: parseVersionFromBranch(b),
  }));
  console.log(JSON.stringify({ path: resolved, branches: branchInfo }, null, 2));
  process.exit(0);
}

const detected =
  detectFromGitBranch(resolved) ||
  detectFromExamplePackageJson(resolved) ||
  detectFromOhPackage(resolved) ||
  detectFromRootPackageJson(resolved);

if (!detected || !detected.version) {
  console.log(
    JSON.stringify(
      {
        path: resolved,
        version: null,
        source: detected ? detected.source : null,
        branch: detected ? detected.branch : null,
        message:
          'Cannot determine RNOH version from git branch, package.json, or oh-package.json5',
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(JSON.stringify({ path: resolved, ...detected }, null, 2));
