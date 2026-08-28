#!/usr/bin/env node
/**
 * @tool create-example
 * @description 从 RN3rdTemplate 模板仓库浅拷贝对应 RNOH 框架版本的 example 模板到目标三方库，修改 app 名称与工程标识，并清理安全残留（.npmrc）与模板残留（querySchemes）。跨平台（Windows/macOS/Linux），仅需 Node.js + git。
 * @param libPath: string - 目标库根目录（绝对路径，含 package.json）
 * @param version: string - RNOH 框架版本（0.77/0.82/0.84），缺省从库 package.json 自动推断
 * @param appName: string - 应用显示名（缺省从库名派生，如 SqliteStorageExample）
 * @param bundleName: string - 鸿蒙应用包名（缺省派生为 com.rnoh.{lib_name}）
 * @param templateUrl: string - 模板仓库地址（默认 https://gitcode.com/lalhanOrz/RN3rdTemplate.git）
 * @param force: boolean - example/ 已存在时是否删除重建
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_TEMPLATE_URL = 'https://gitcode.com/lalhanOrz/RN3rdTemplate.git';
const KNOWN_VERSIONS = ['0.77', '0.82', '0.84'];
const EXCLUDED_ENTRIES = new Set(['.git', '.DS_Store', '.npmrc']);

function info(msg) { console.log(`[INFO] ${msg}`); }
function warn(msg) { console.log(`[WARN] ${msg}`); }
function fail(msg) { console.error(`[ERROR] ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') { args.force = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) { args[key] = true; continue; }
      args[key] = val;
      i++;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function detectVersion(libPkg) {
  const sections = ['dependencies', 'devDependencies', 'peerDependencies'];
  const keys = ['@react-native-oh/react-native-harmony', 'react-native-harmony', 'react-native'];
  for (const section of sections) {
    const deps = libPkg[section] || {};
    for (const key of keys) {
      if (deps[key]) {
        const m = String(deps[key]).match(/(\d+)\.(\d+)/);
        if (m) return `${m[1]}.${m[2]}`;
      }
    }
  }
  return null;
}

function deriveNames(libName, explicitAppName, explicitBundleName) {
  const unscoped = libName.startsWith('@') ? libName.split('/').pop() : libName;
  const short = (unscoped.replace(/^react-native-/, '') || unscoped);
  const pascalBase = short
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  return {
    appName: explicitAppName || `${pascalBase}Example`,
    bundleName: explicitBundleName || `com.rnoh.${short.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    rnAppName: `${short.replace(/[^a-zA-Z0-9]/g, '_')}_example`,
    pkgName: `${unscoped}-example`,
  };
}

function copyDirFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDED_ENTRIES.has(entry.name)) {
      if (entry.name === '.npmrc') {
        warn(`已排除含潜在凭据的文件: ${path.join(dest, entry.name)}（严禁带入交付物）`);
      }
      continue;
    }
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirFiltered(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function setStringValue(json, name, value) {
  const item = (json.string || []).find((s) => s.name === name);
  if (item) item.value = value;
  return Boolean(item);
}

function renameApp(exampleDir, names) {
  const changes = [];

  const appJsonPath = path.join(exampleDir, 'app.json');
  if (fs.existsSync(appJsonPath)) {
    const appJson = readJson(appJsonPath);
    appJson.name = names.rnAppName;
    appJson.displayName = names.appName;
    writeJson(appJsonPath, appJson);
    changes.push(`app.json: name=${names.rnAppName}, displayName=${names.appName}`);
  } else {
    warn('未找到 app.json，跳过 RN 应用名修改');
  }

  const pkgPath = path.join(exampleDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    pkg.name = names.pkgName;
    writeJson(pkgPath, pkg);
    changes.push(`package.json: name=${names.pkgName}`);
  }

  const appJson5Path = path.join(exampleDir, 'harmony', 'AppScope', 'app.json5');
  if (fs.existsSync(appJson5Path)) {
    let content = fs.readFileSync(appJson5Path, 'utf8');
    const updated = content.replace(
      /("bundleName"\s*:\s*")[^"]*(")/,
      `$1${names.bundleName}$2`
    );
    if (updated !== content) {
      fs.writeFileSync(appJson5Path, updated);
      changes.push(`harmony/AppScope/app.json5: bundleName=${names.bundleName}`);
    }
  } else {
    warn('未找到 harmony/AppScope/app.json5，跳过 bundleName 修改');
  }

  const scopeStrPath = path.join(
    exampleDir, 'harmony', 'AppScope', 'resources', 'base', 'element', 'string.json'
  );
  if (fs.existsSync(scopeStrPath)) {
    const scopeStr = readJson(scopeStrPath);
    if (setStringValue(scopeStr, 'app_name', names.appName)) {
      writeJson(scopeStrPath, scopeStr);
      changes.push(`harmony/AppScope/.../string.json: app_name=${names.appName}`);
    }
  }

  const entryStrPath = path.join(
    exampleDir, 'harmony', 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json'
  );
  if (fs.existsSync(entryStrPath)) {
    const entryStr = readJson(entryStrPath);
    if (setStringValue(entryStr, 'EntryAbility_label', names.appName)) {
      writeJson(entryStrPath, entryStr);
      changes.push(`harmony/entry/.../string.json: EntryAbility_label=${names.appName}`);
    }
  }

  const moduleJson5Path = path.join(exampleDir, 'harmony', 'entry', 'src', 'main', 'module.json5');
  if (fs.existsSync(moduleJson5Path)) {
    let content = fs.readFileSync(moduleJson5Path, 'utf8');
    const updated = content.replace(
      /[ \t]*"querySchemes"\s*:\s*\[[\s\S]*?\][ \t]*,?\s*\r?\n/,
      ''
    );
    if (updated !== content) {
      fs.writeFileSync(moduleJson5Path, updated);
      changes.push('harmony/entry/src/main/module.json5: 已移除模板残留 querySchemes（库需要时请重新添加）');
    }
  }

  return changes;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const libPath = path.resolve(args.libPath || args._[0] || '');
  if (!args.libPath && args._.length === 0) {
    fail('缺少参数：--lib-path <目标库根目录>');
  }
  if (!fs.existsSync(libPath)) fail(`库目录不存在: ${libPath}`);
  const libPkgPath = path.join(libPath, 'package.json');
  if (!fs.existsSync(libPkgPath)) fail(`未找到库 package.json: ${libPkgPath}`);
  const libPkg = readJson(libPkgPath);

  const exampleDir = path.join(libPath, 'example');
  if (fs.existsSync(exampleDir)) {
    if (!args.force) {
      fail(`example/ 已存在: ${exampleDir}。如需重建请加 --force（将删除现有目录后重建）`);
    }
    warn('--force 生效：删除已有 example/ 目录');
    fs.rmSync(exampleDir, { recursive: true, force: true });
  }

  const version = args.version || detectVersion(libPkg);
  if (!version) {
    fail(`无法从库 package.json 推断 RNOH 框架版本，请显式指定 --version（可选：${KNOWN_VERSIONS.join(' / ')}）`);
  }
  if (!KNOWN_VERSIONS.includes(version)) {
    fail(`不支持的版本 ${version}，模板仓库可选版本：${KNOWN_VERSIONS.join(' / ')}`);
  }

  const templateUrl = args.templateUrl || DEFAULT_TEMPLATE_URL;
  const names = deriveNames(libPkg.name || 'rn-lib', args.appName, args.bundleName);

  info(`目标库: ${libPath}（${libPkg.name}@${libPkg.version || 'unknown'}）`);
  info(`框架版本: ${version} → 模板 ${templateUrl}#${version}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn3rd-template-'));
  try {
    info(`浅拷贝模板仓库（git clone --depth 1）...`);
    try {
      execFileSync('git', ['clone', '--depth', '1', templateUrl, tmpDir], { stdio: 'inherit' });
    } catch (e) {
      fail(`git clone 失败: ${e.message}`);
    }
    const versionDir = path.join(tmpDir, version);
    if (!fs.existsSync(versionDir)) {
      fail(`模板仓库中不存在版本目录 ${version}/（可选：${KNOWN_VERSIONS.join(' / ')}）`);
    }
    info(`复制模板 ${version}/ → ${exampleDir}`);
    copyDirFiltered(versionDir, exampleDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  info('修改 app 名称与工程标识...');
  const changes = renameApp(exampleDir, names);
  for (const c of changes) info(`  - ${c}`);

  console.log('');
  console.log('=== example 工程创建完成 ===');
  console.log(`  目录:       ${exampleDir}`);
  console.log(`  应用名:     ${names.appName}`);
  console.log(`  RN 注册名:  ${names.rnAppName}`);
  console.log(`  鸿蒙包名:   ${names.bundleName}`);
  console.log(`  npm 包名:   ${names.pkgName}`);
  console.log('');
  console.log('后续步骤:');
  console.log(`  1. cd "${libPath}" && npm pack（先确认 .npmignore 已排除 example）`);
  console.log(`  2. 修改 ${path.join('example', 'package.json')} 依赖为 file:../{tgz文件名}（禁止 file:../ 目录）`);
  console.log('  3. 预置 example/src/RNTesterList.ts（模式 A）注册入口');
  console.log('  4. cd example && npm install --legacy-peer-deps && npm run dev');
  console.log('  5. cd harmony && ohpm install --all && hvigorw assembleHap --no-daemon');
}

main();
