#!/usr/bin/env node
/**
 * Read RN third-party library metadata from package.json.
 * Used by rnoh-lib-rnt-search to generate candidate search names for rnt demo lookup.
 *
 * Usage: node read-lib-meta.cjs <lib-root>
 *
 * Output: JSON with library metadata including searchNames for demo scanning.
 * Exit codes: 0 = success, 1 = error (missing package.json or invalid args)
 */
const fs = require('fs');
const path = require('path');

const libRoot = process.argv[2];
if (!libRoot) {
  console.error('Usage: node read-lib-meta.cjs <lib-root>');
  process.exit(1);
}

const pkgPath = path.join(libRoot, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error(`package.json not found: ${pkgPath}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const packageName = pkg.name || '';
const scoped = packageName.includes('/') ? packageName.split('/').pop() : packageName;
const alias = pkg.harmony?.alias || scoped;
const autolinking = pkg.harmony?.autolinking || null;
const dirBase = path.basename(libRoot);

const searchNames = [...new Set([alias, scoped, dirBase, packageName].filter(Boolean))];

/**
 * HAR source module dir (harmony/{module}/), for manual CMake only — NOT package.json mainHarPath.
 * Used by downstream rn-lib-add-example for shell adaptation.
 */
function inferSourceModulePath(root) {
  const harmonyDir = path.join(root, 'harmony');
  if (!fs.existsSync(harmonyDir)) {
    return null;
  }
  const dirs = fs
    .readdirSync(harmonyDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'react_native_openharmony')
    .map((d) => d.name);
  const withOhPackage = dirs.filter((name) =>
    fs.existsSync(path.join(harmonyDir, name, 'oh-package.json5')),
  );
  if (withOhPackage.length === 1) {
    return `harmony/${withOhPackage[0]}`;
  }
  return null;
}

function findHarFilesUnder(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findHarFilesUnder(full));
    } else if (entry.name.endsWith('.har')) {
      out.push(full);
    }
  }
  return out;
}

function warnIfMisconfiguredMainHarPath(root, linking, sourceModulePath) {
  if (!linking || linking === true || !linking.mainHarPath) {
    return null;
  }
  const configured = linking.mainHarPath;
  const scanDir = path.join(root, configured);
  const harsInConfigured = findHarFilesUnder(scanDir);
  if (harsInConfigured.length === 0) {
    return (
      `package.json harmony.autolinking.mainHarPath="${configured}" 目录内无 .har 文件，` +
      'RNOH CLI autolinking 会静默跳过该库。删除 mainHarPath（.har 在 harmony/ 根时默认即可），' +
      'example CMake 请用 autolinkingResolved.sourceModulePath，勿写入 package.json。'
    );
  }
  if (sourceModulePath && configured === sourceModulePath) {
    return (
      `mainHarPath 与源码模块路径相同 (${configured})，通常表示误配：` +
      'CLI 的 mainHarPath 是 .har 扫描目录，不是 harmony/{module}/ 源码目录。'
    );
  }
  return null;
}

function resolveAutolinkingFields(root, linking) {
  if (!linking || linking === true) {
    return {};
  }
  const ohPackageName = linking.ohPackageName || packageName;
  const sourceModulePath = inferSourceModulePath(root);
  const cppDir = sourceModulePath
    ? path.join(root, sourceModulePath, 'src/main/cpp')
    : null;
  const hasCpp = cppDir ? fs.existsSync(cppDir) : false;
  const target = linking.cmakeLibraryTargetName || '';
  const cmakeShortName = target.startsWith('rnoh_')
    ? target.slice('rnoh_'.length)
    : target.replace(/_/g, '-');
  const mainHarPathWarning = warnIfMisconfiguredMainHarPath(root, linking, sourceModulePath);
  const harmonyModuleName = sourceModulePath
    ? path.basename(sourceModulePath)
    : null;

  return {
    ohPackageName,
    sourceModulePath,
    harmonyModuleName,
    hasCpp,
    cmakeCppPath: hasCpp
      ? `\${NODE_MODULES}/${ohPackageName}/${sourceModulePath}/src/main/cpp`
      : null,
    cmakeShortName: cmakeShortName || alias.replace(/-/g, '_'),
    etsPackageClassName: linking.etsPackageClassName || null,
    cppPackageClassName: linking.cppPackageClassName || null,
    cmakeLibraryTargetName: target || null,
    mainHarPathWarning,
  };
}

const autolinkingResolved = resolveAutolinkingFields(libRoot, autolinking);

const result = {
  packageName,
  version: pkg.version || '',
  alias,
  scoped,
  dirBase,
  searchNames,
  autolinking,
  autolinkingResolved,
  codegenConfig: pkg.codegenConfig || null,
};

console.log(JSON.stringify(result, null, 2));

if (autolinkingResolved.mainHarPathWarning) {
  console.error(`\n[WARN] ${autolinkingResolved.mainHarPathWarning}`);
  process.exitCode = 1;
}
