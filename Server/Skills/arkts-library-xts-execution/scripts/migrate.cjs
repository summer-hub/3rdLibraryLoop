/**
 * migrate.cjs — 鸿蒙历史工程手动迁移脚本（API 9 + API 10+）。
 *
 * 依据华为官方 Manual Migration 流程，原地修改工程文件，完成一体化迁移：
 *   1. 删除工程级 build-profile.json5 的 compileSdkVersion（OpenHarmony 工程跳过）
 *   2. [API 9] 迁移 compatibleSdkVersion/targetSdkVersion 到 product，强制 runtimeOS=HarmonyOS
 *   3. [API 9] 清理各模块级 build-profile.json5 中 targets[].runtimeOS
 *   4. 强制所有 product compatibleSdkVersion/targetSdkVersion（由参数指定）+ runtimeOS=HarmonyOS
 *   5. 删除 hvigorw / hvigorw.bat / hvigor/hvigor-wrapper.js
 *   6. hvigor/hvigor-config.json5：新增 modelVersion（由参数指定），删除 hvigorVersion + dependencies 中 @ohos/hvigor-ohos-plugin/rollup
 *   7. 工程级 oh-package.json5：新增 modelVersion（由参数指定）
 *   8. local.properties：删除 HarmonyOS SDK 配置（OpenHarmony 工程跳过）
 *
 * 用法:
 *   node migrate.cjs --source <工程根路径> [--compatible-api <N>] [--target-api <N>] [--openharmony]
 *
 * 参数说明:
 *   --compatible-api <N>  设备 API 版本（如 23），用于 compatibleSdkVersion。
 *                         不传则 = target-api（向后兼容）。
 *   --target-api <N>      已安装 SDK API 版本（如 24），用于 targetSdkVersion 和 modelVersion。
 *                         不传则自动探测已安装 SDK（探测失败默认 24）。
 *
 * 参考:
 *   https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V13/ide-integrated-project-migration-V13
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── 常量 ────────────────────────────────────────────────────
const RUNTIME_OS = 'HarmonyOS';

// API → 平台版本映射表（来源：HarmonyOS 版本说明 overview-allversion）
const API_VERSION_MAP = {
  12: '5.0.0', 13: '5.0.1', 14: '5.0.2', 15: '5.0.3',
  16: '5.0.4', 17: '5.0.5', 18: '5.1.0', 19: '5.1.1',
  20: '6.0.0', 21: '6.0.1', 22: '6.0.2', 23: '6.1.0', 24: '6.1.1',
};

// 默认值，在 parseArgs() 后由 --compatible-api / --target-api 参数覆盖
let MODEL_VERSION = '6.1.1';
let COMPATIBLE_SDK_VERSION = '6.1.1(24)';
let TARGET_SDK_VERSION = '6.1.1(24)';

// ── SDK 版本自动探测 ────────────────────────────────────────

/**
 * 自动探测已安装 SDK 的 API 版本。
 * 通过 where.exe hdc 反推 DevEco 目录，读取 oh-uni-package.json。
 * @returns {{api: number, version: string}|null}
 */
function detectInstalledSdkApi() {
  try {
    const hdcPath = execSync('where.exe hdc', { encoding: 'utf-8' })
      .trim().split(/\r?\n/)[0].trim();
    const idx = hdcPath.indexOf('\\sdk');
    if (idx <= 0) return null;
    const devEcoDir = hdcPath.substring(0, idx);
    const ohUniPath = path.join(devEcoDir, 'sdk', 'default',
      'openharmony', 'ets', 'oh-uni-package.json');
    if (!fs.existsSync(ohUniPath)) return null;
    const content = JSON.parse(fs.readFileSync(ohUniPath, 'utf-8'));
    return { api: parseInt(content.apiVersion), version: content.version };
  } catch {
    return null;
  }
}

// ── 参数解析 ────────────────────────────────────────────────

/**
 * 解析 --key value 形式的命令行参数；--flag 形式的布尔参数值为 true。
 * @returns {Record<string, string|true>}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        parsed[key] = args[i + 1];
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

// ── JSON5 文本操作工具 ──────────────────────────────────────

/**
 * JSON5 兼容的文本操作工具集。所有方法均基于正则 + 文本替换，
 * 不引入 json5 npm 依赖（与项目零原生依赖风格一致）。
 *
 * 设计约束：
 * - 不破坏 JSON5 注释（// 或 /* *\/）
 * - 处理尾逗号，避免遗留语法错误
 * - 仅在明确锚点位置插入，不重排已有字段
 */

/**
 * 删除对象中的指定顶层字段（形如 `"field": value,` 或 `field: value,`）。
 * 同时清理删除后遗留的多余逗号/空行。
 * @param {string} content 原始文本
 * @param {string} field 字段名
 * @returns {string} 处理后的文本
 */
function removeField(content, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 匹配 "field": value, 或 field: value,（value 不含未转义的 , 或 }）
  // 允许键带引号或不带引号；值允许含字符串、数字、布尔、数组、嵌套对象之外的简单值
  const patterns = [
    // 带引号键，值含字符串/数字/布尔/null
    new RegExp(`^[ \\t]*"${escaped}"\\s*:\\s*[^,}\\n]+,?[ \\t]*\\r?\\n`, 'gm'),
    // 不带引号键
    new RegExp(`^[ \\t]*${escaped}\\s*:\\s*[^,}\\n]+,?[ \\t]*\\r?\\n`, 'gm'),
  ];
  let result = content;
  for (const p of patterns) {
    result = result.replace(p, '');
  }
  return result;
}

/**
 * 删除对象中指定字段（值可能含逗号，如嵌套对象/数组）。采用括号配对算法删除整段。
 * 用于删除 dependencies 中的 `@ohos/hvigor-ohos-plugin` 等含特殊字符的键。
 * @param {string} content 原始文本
 * @param {string} field 字段名（原样匹配，需含引号则传入含引号形式）
 * @returns {string}
 */
function removeFieldWithBrackets(content, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(\\s*)${escaped}\\s*:\\s*`, 'm');
  const match = re.exec(content);
  if (!match) return content;

  const start = match.index + match[1].length;
  const valueStart = match.index + match[0].length;
  // 从值开始配对括号，找出字段结束位置
  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let i = valueStart;
  for (; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quoteChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quoteChar = ch; continue; }
    if (ch === '{' || ch === '[') { depth++; continue; }
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth < 0) break; // 越过本字段，遇到外层闭合
      continue;
    }
    if (depth === 0 && ch === ',') { i++; break; }
    if (depth === 0 && (ch === '\n' || ch === '}')) break;
  }
  // i 现在指向字段结束后的位置（逗号后或换行/闭合前）
  // 回溯 start 之前找行首
  let lineStart = start;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') lineStart--;
  // 前进 i 到行尾
  let lineEnd = i;
  while (lineEnd < content.length && content[lineEnd] !== '\n') lineEnd++;
  if (lineEnd < content.length) lineEnd++; // 含换行
  return content.slice(0, lineStart) + content.slice(lineEnd);
}

/**
 * 在指定父对象闭合 `}` 前插入新字段。
 * @param {string} content 原始文本
 * @param {string} parentAnchor 父对象的开始锚点（正则字符串，匹配父对象首行如 `"app"\s*:\s*\{`）
 * @param {string} fieldText 要插入的字段文本（如 `    "modelVersion": "5.0.4",\n`）
 * @returns {string}
 */
function insertFieldBeforeClose(content, parentAnchor, fieldText) {
  // 定位父对象开始
  const startRe = new RegExp(parentAnchor);
  const startMatch = startRe.exec(content);
  if (!startMatch) return content;

  // 从父对象开始处配对括号找闭合 }
  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let closeIdx = -1;
  for (let i = startMatch.index + startMatch[0].length - 1; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quoteChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quoteChar = ch; continue; }
    if (ch === '{' || ch === '[') { depth++; continue; }
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
      continue;
    }
  }
  if (closeIdx === -1) return content;

  // 找到闭合 } 前的最后一个非空字符位置，判断是否需要补逗号
  let insertPos = closeIdx;
  while (insertPos > 0 && /\s/.test(content[insertPos - 1])) insertPos--;
  // 检查前一个非空字符是否为 { 或 ,（决定是否补逗号）
  const prefix = content[insertPos - 1];
  const needsComma = prefix !== '{' && prefix !== ',';

  // 字段缩进 = 闭合 } 所在行缩进 + 一级缩进（2 空格）
  const lineStart = (() => {
    let p = closeIdx;
    while (p > 0 && content[p - 1] !== '\n') p--;
    return p;
  })();
  const closeIndent = content.slice(lineStart, closeIdx).match(/^\s*/)[0];
  const fieldIndent = closeIndent + '  ';
  // 插入内容不含末尾 \n：content.slice(insertPos) 已以 \n + closeIndent 开头
  // fieldText 使用 trimStart() 去前导空白（保留尾部逗号）
  const insertion = (needsComma ? ',' : '') + '\n' + fieldIndent + fieldText.trimStart();
  return content.slice(0, insertPos) + insertion + content.slice(insertPos);
}

/**
 * 提取字段的值（字符串/数字/布尔/null）。仅处理简单值，不处理嵌套。
 * @param {string} content
 * @param {string} field
 * @returns {string|null} 值文本，未找到返回 null
 */
function getFieldValue(content, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`"${escaped}"\\s*:\\s*("([^"\\\\]|\\\\.)*"|\\d+|true|false|null)`),
    new RegExp(`\\b${escaped}\\s*:\\s*("([^"\\\\]|\\\\.)*"|\\d+|true|false|null)`),
  ];
  for (const p of patterns) {
    const m = p.exec(content);
    if (m) return m[1];
  }
  return null;
}

/**
 * 设置/覆盖字段的值（简单值）。若字段不存在则插入到指定锚点对象闭合前。
 * @param {string} content
 * @param {string} field 字段名（不带引号）
 * @param {string} valueText 值文本（如 `"HarmonyOS"`、`"5.0.4"`、`16`）
 * @param {string} parentAnchor 插入锚点（父对象开始正则）
 * @param {string} indent 缩进
 * @returns {string}
 */
function setFieldValue(content, field, valueText, parentAnchor, indent) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 检测字段键是否已存在（带引号或不带引号）。依据存在性决定替换或插入，
  // 而非"替换后文本是否变化"——因为值恰好与目标值相同时替换无变化，
  // 若据此误判为不存在会重复插入同一字段。
  const existsRe = new RegExp(`^[ \\t]*("?${escaped}"?\\s*:)`, 'gm');
  const existsMatch = existsRe.exec(content);
  if (existsMatch) {
    // 已存在：仅替换该行值（保留引号键/无引号键原样）
    const replaceRe = new RegExp(`(^[ \\t]*"?${escaped}"?\\s*:\\s*)[^,}\\n]+`, 'gm');
    return content.replace(replaceRe, `$1${valueText}`);
  }
  // 不存在 → 插入到指定父对象闭合前
  return insertFieldBeforeClose(content, parentAnchor, `${indent}"${field}": ${valueText},`);
}

// ── 工程检测 ────────────────────────────────────────────────

/**
 * 读取文件文本，文件不存在返回 null。
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 检测工程类型与 API 版本。
 * @param {string} projectRoot
 * @param {boolean} openHarmonyFlag
 * @returns {{apiLevel: '9'|'10+', isOpenHarmony: boolean, hasLocalProperties: boolean}}
 */
function detectProject(projectRoot, openHarmonyFlag) {
  const bpPath = path.join(projectRoot, 'build-profile.json5');
  const content = readFileSafe(bpPath) || '';
  const localProps = readFileSafe(path.join(projectRoot, 'local.properties')) || '';

  // OpenHarmony 检测
  let isOpenHarmony = !!openHarmonyFlag;
  if (!isOpenHarmony) {
    // local.properties 中含 HarmonyOS SDK 配置 → 非 OpenHarmony
    const hasHarmonySdk = /HarmonyOS\s+SDK/i.test(localProps);
    isOpenHarmony = !hasHarmonySdk && localProps.length > 0 && !hasHarmonySdk;
    // 若 local.properties 不存在或无 HarmonyOS SDK 配置，视为 OpenHarmony
    // 但若用户未传 --openharmony 且文件无 SDK 配置，保守判定为 OpenHarmony
    if (localProps.length === 0) isOpenHarmony = false; // 无文件不判定
    else isOpenHarmony = !hasHarmonySdk;
  }

  // API 9 检测
  const appCompat = getFieldValue(content, 'compatibleSdkVersion');
  const appTarget = getFieldValue(content, 'targetSdkVersion');
  const appCompile = getFieldValue(content, 'compileSdkVersion');
  const productCompat = content.match(/"compatibleSdkVersion"\s*:\s*("([^"\\]|\\.)*"|\d+)/g);

  let apiLevel = '10+';
  // API 9 判定：app 顶层 compatibleSdkVersion 为 9，或 product 中无 compatibleSdkVersion
  const isAppCompat9 =
    (appCompat === '9') || (appCompat === '"9"') ||
    (appCompile === '9') || (appCompile === '"9"');
  if (isAppCompat9 || (!productCompat && appCompat)) {
    apiLevel = '9';
  }
  // 若 compileSdkVersion >= 10 且 product 中已有 compatibleSdkVersion，视为 10+
  if (appCompile && parseInt(String(appCompile).replace(/["']/g, ''), 10) >= 10) {
    apiLevel = '10+';
  }

  return {
    apiLevel,
    isOpenHarmony,
    hasLocalProperties: localProps.length > 0,
  };
}

// ── 迁移步骤实现 ────────────────────────────────────────────

/**
 * 收集所有模块级 build-profile.json5 路径。
 * 模块定义在工程级 build-profile.json5 的 modules[] 中，但简单遍历子目录更稳健。
 * @param {string} projectRoot
 * @returns {string[]} 模块级 build-profile.json5 绝对路径列表
 */
function findModuleBuildProfiles(projectRoot) {
  const results = [];
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const moduleBp = path.join(projectRoot, entry.name, 'build-profile.json5');
    if (fs.existsSync(moduleBp)) {
      results.push(moduleBp);
    }
  }
  return results;
}

/**
 * 步骤：[API 9] 迁移 app 顶层 compatibleSdkVersion/targetSdkVersion 到每个 product，
 * 值改为参数指定的版本，并强制 runtimeOS="HarmonyOS"。
 * @param {string} bpPath
 * @returns {string[]} 操作日志列表
 */
function migrateApi9BuildProfile(bpPath) {
  const logs = [];
  let content = fs.readFileSync(bpPath, 'utf-8');
  const rel = path.basename(path.dirname(bpPath));

  // 删除 app 顶层 compatibleSdkVersion 与 targetSdkVersion
  const before = content;
  content = removeField(content, 'compatibleSdkVersion');
  content = removeField(content, 'targetSdkVersion');
  if (content !== before) {
    logs.push(`  ✅ ${rel}/build-profile.json5: 删除 app 顶层 compatibleSdkVersion/targetSdkVersion`);
  }

  // 对每个 product 强制 compatibleSdkVersion/targetSdkVersion/runtimeOS
  // 锚点：app.products 数组的每个 { 开始处
  // 简化处理：定位 "products" 数组，在每个 `{` 后插入字段
  // 采用逐 product 处理：用正则匹配 product 项的 `{ ... }` 段
  const productsAnchor = /"app"\s*:\s*\{[\s\S]*?"products"\s*:\s*\[/;
  const productsMatch = productsAnchor.exec(content);
  if (!productsMatch) {
    logs.push(`  ⚠️ ${rel}/build-profile.json5: 未找到 app.products 数组，跳过 product 配置`);
    return { content: before, logs };
  }

  // 找到 products 数组闭合 ]
  const arrayStart = productsMatch.index + productsMatch[0].length - 1; // 指向 [
  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let arrayEnd = -1;
  for (let i = arrayStart; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quoteChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quoteChar = ch; continue; }
    if (ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && content[i] === ']') { arrayEnd = i; break; }
      continue;
    }
  }
  if (arrayEnd === -1) {
    logs.push(`  ⚠️ ${rel}/build-profile.json5: products 数组闭合 ] 未找到`);
    return { content: before, logs };
  }

  // 在 products 数组文本内，对每个 product 项强制字段
  const beforeProducts = content.slice(0, arrayStart);
  const productsText = content.slice(arrayStart, arrayEnd + 1);
  const afterProducts = content.slice(arrayEnd + 1);

  // 对 productsText 中的每个 product（以 { 开始的对象）强制设置字段
  // 用 insertFieldBeforeClose 逐个处理：找到每个 product 的闭合 }
  // 简化：直接在 products 文本中对 "name" 锚点的每个对象插入字段
  let newProducts = productsText;
  // 强制每个 product 的 compatibleSdkVersion/targetSdkVersion/runtimeOS
  // 通过正则定位每个 product 对象的开始 {
  const productObjs = [];
  let pdepth = 0;
  let pinString = false;
  let pquote = '';
  let pObjStart = -1;
  for (let i = 0; i < newProducts.length; i++) {
    const ch = newProducts[i];
    if (pinString) {
      if (ch === '\\') { i++; continue; }
      if (ch === pquote) pinString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { pinString = true; pquote = ch; continue; }
    if (ch === '{') {
      if (pdepth === 0) pObjStart = i;
      pdepth++;
      continue;
    }
    if (ch === '}') {
      pdepth--;
      if (pdepth === 0) {
        productObjs.push({ start: pObjStart, end: i });
      }
      continue;
    }
  }

  // 从后往前处理（避免索引偏移）
  let productCount = 0;
  for (let idx = productObjs.length - 1; idx >= 0; idx--) {
    const { start, end } = productObjs[idx];
    const objText = newProducts.slice(start, end + 1);
    let newObj = objText;
    // 清理 product 内残留的 compileSdkVersion（HarmonyOS 新 SDK 中该字段非必须，
    // 旧工程/AI 可能预置数字或字符串，导致同一对象出现重复键）
    newObj = removeField(newObj, 'compileSdkVersion');
    // 强制 compatibleSdkVersion
    newObj = setFieldValue(newObj, 'compatibleSdkVersion', `"${COMPATIBLE_SDK_VERSION}"`, '^\\{', '  ');
    // 强制 targetSdkVersion
    newObj = setFieldValue(newObj, 'targetSdkVersion', `"${TARGET_SDK_VERSION}"`, '^\\{', '  ');
    // 强制 runtimeOS
    newObj = setFieldValue(newObj, 'runtimeOS', `"${RUNTIME_OS}"`, '^\\{', '  ');
    newProducts = newProducts.slice(0, start) + newObj + newProducts.slice(end + 1);
    productCount++;
  }
  logs.push(`  ✅ ${rel}/build-profile.json5: ${productCount} 个 product 迁移 compatibleSdkVersion=${COMPATIBLE_SDK_VERSION} + runtimeOS=HarmonyOS`);

  content = beforeProducts + newProducts + afterProducts;
  return { content, logs };
}

/**
 * 步骤：[API 9] 清理各模块级 build-profile.json5 中 targets[].runtimeOS。
 * @param {string[]} moduleBpPaths
 * @returns {string[]} 操作日志
 */
function cleanModuleTargetsRuntimeOS(moduleBpPaths) {
  const logs = [];
  for (const bpPath of moduleBpPaths) {
    const content = fs.readFileSync(bpPath, 'utf-8');
    const rel = path.relative(path.dirname(path.dirname(bpPath)), bpPath);
    // 删除 targets 内的 runtimeOS 字段
    // 简化：直接在整个文件中删除 "runtimeOS" 字段（模块级文件中 runtimeOS 只应出现在 targets 内）
    const before = content;
    const after = removeField(content, 'runtimeOS');
    if (before !== after) {
      fs.writeFileSync(bpPath, after, 'utf-8');
      logs.push(`  ✅ ${rel}: 清理 targets[].runtimeOS`);
    } else {
      logs.push(`  ⏭️ ${rel}: 无 runtimeOS 字段，跳过`);
    }
  }
  return logs;
}

/**
 * 步骤：删除工程级 compileSdkVersion。
 * @param {string} bpPath
 * @returns {string[]} 操作日志
 */
function removeCompileSdkVersion(bpPath) {
  const logs = [];
  let content = fs.readFileSync(bpPath, 'utf-8');
  const before = content;
  content = removeField(content, 'compileSdkVersion');
  if (content !== before) {
    fs.writeFileSync(bpPath, content, 'utf-8');
    logs.push(`  ✅ ${path.basename(path.dirname(bpPath))}/build-profile.json5: 删除 compileSdkVersion`);
  } else {
    logs.push(`  ⏭️ ${path.basename(path.dirname(bpPath))}/build-profile.json5: 无 compileSdkVersion，跳过`);
  }
  return logs;
}

/**
 * 步骤：强制所有 product 的 compatibleSdkVersion/targetSdkVersion/runtimeOS。
 *   - compatibleSdkVersion = 参数指定的版本（满足 M.S.F(X) 规则的字符串）
 *   - targetSdkVersion = 参数指定的版本
 *   - runtimeOS = "HarmonyOS"
 * 不论原值是数字、字符串、缺失还是其他，统一覆盖。
 * @param {string} bpPath
 * @returns {string[]} 操作日志
 */
function forceProductSdkConfig(bpPath) {
  const logs = [];
  let content = fs.readFileSync(bpPath, 'utf-8');
  const rel = `${path.basename(path.dirname(bpPath))}/build-profile.json5`;

  // 定位 products 数组
  const productsAnchor = /"app"\s*:\s*\{[\s\S]*?"products"\s*:\s*\[/;
  const productsMatch = productsAnchor.exec(content);
  if (!productsMatch) {
    logs.push(`  ⚠️ ${rel}: 未找到 app.products 数组，跳过 SDK 配置强制设置`);
    return logs;
  }

  const arrayStart = productsMatch.index + productsMatch[0].length - 1;
  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let arrayEnd = -1;
  for (let i = arrayStart; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quoteChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quoteChar = ch; continue; }
    if (ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && content[i] === ']') { arrayEnd = i; break; }
      continue;
    }
  }
  if (arrayEnd === -1) {
    logs.push(`  ⚠️ ${rel}: products 数组闭合 ] 未找到`);
    return logs;
  }

  const beforeProducts = content.slice(0, arrayStart);
  let productsText = content.slice(arrayStart, arrayEnd + 1);
  const afterProducts = content.slice(arrayEnd + 1);

  // 对每个 product 对象强制 compatibleSdkVersion/targetSdkVersion/runtimeOS
  const productObjs = [];
  let pdepth = 0;
  let pinString = false;
  let pquote = '';
  let pObjStart = -1;
  for (let i = 0; i < productsText.length; i++) {
    const ch = productsText[i];
    if (pinString) {
      if (ch === '\\') { i++; continue; }
      if (ch === pquote) pinString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { pinString = true; pquote = ch; continue; }
    if (ch === '{') {
      if (pdepth === 0) pObjStart = i;
      pdepth++;
      continue;
    }
    if (ch === '}') {
      pdepth--;
      if (pdepth === 0) productObjs.push({ start: pObjStart, end: i });
      continue;
    }
  }

  let count = 0;
  for (let idx = productObjs.length - 1; idx >= 0; idx--) {
    const { start, end } = productObjs[idx];
    const objText = productsText.slice(start, end + 1);
    let newObj = objText;
    // 清理 product 内残留的 compileSdkVersion，避免同一对象出现数字+字符串重复键
    newObj = removeField(newObj, 'compileSdkVersion');
    newObj = setFieldValue(newObj, 'compatibleSdkVersion', `"${COMPATIBLE_SDK_VERSION}"`, '^\\{', '  ');
    newObj = setFieldValue(newObj, 'targetSdkVersion', `"${TARGET_SDK_VERSION}"`, '^\\{', '  ');
    newObj = setFieldValue(newObj, 'runtimeOS', `"${RUNTIME_OS}"`, '^\\{', '  ');
    productsText = productsText.slice(0, start) + newObj + productsText.slice(end + 1);
    count++;
  }
  content = beforeProducts + productsText + afterProducts;
  fs.writeFileSync(bpPath, content, 'utf-8');
  logs.push(`  ✅ ${rel}: 强制 ${count} 个 product compatibleSdkVersion=${COMPATIBLE_SDK_VERSION}/targetSdkVersion=${TARGET_SDK_VERSION} + runtimeOS=${RUNTIME_OS}`);
  return logs;
}

/**
 * 步骤：删除 hvigor 相关文件。
 * @param {string} projectRoot
 * @returns {string[]} 操作日志
 */
function removeHvigorFiles(projectRoot) {
  const logs = [];
  const targets = [
    path.join(projectRoot, 'hvigorw'),
    path.join(projectRoot, 'hvigorw.bat'),
    path.join(projectRoot, 'hvigor', 'hvigor-wrapper.js'),
  ];
  for (const t of targets) {
    const rel = path.relative(projectRoot, t);
    if (fs.existsSync(t)) {
      fs.rmSync(t, { force: true });
      logs.push(`  ✅ 删除 ${rel}`);
    } else {
      logs.push(`  ⏭️ ${rel} 不存在，跳过`);
    }
  }
  return logs;
}

/**
 * 步骤：修改 hvigor/hvigor-config.json5。
 * 新增 modelVersion（由参数指定）；删除 hvigorVersion；删除 dependencies 中 @ohos/hvigor-ohos-plugin 与 rollup。
 * @param {string} projectRoot
 * @returns {string[]} 操作日志
 */
function patchHvigorConfig(projectRoot) {
  const logs = [];
  const cfgPath = path.join(projectRoot, 'hvigor', 'hvigor-config.json5');
  if (!fs.existsSync(cfgPath)) {
    logs.push(`  ⚠️ hvigor/hvigor-config.json5 不存在，跳过`);
    return logs;
  }
  let content = fs.readFileSync(cfgPath, 'utf-8');
  const before = content;

  // 新增/覆盖 modelVersion
  content = setFieldValue(content, 'modelVersion', `"${MODEL_VERSION}"`, '^\\{', '');
  if (content !== before) {
    logs.push(`  ✅ hvigor/hvigor-config.json5: 新增/覆盖 modelVersion=${MODEL_VERSION}`);
  }

  // 删除 hvigorVersion
  const beforeHv = content;
  content = removeField(content, 'hvigorVersion');
  if (content !== beforeHv) {
    logs.push(`  ✅ hvigor/hvigor-config.json5: 删除 hvigorVersion`);
  } else {
    logs.push(`  ⏭️ hvigor/hvigor-config.json5: 无 hvigorVersion，跳过`);
  }

  // 删除 dependencies 中 @ohos/hvigor-ohos-plugin 与 rollup
  const depKeys = ['"@ohos/hvigor-ohos-plugin"', "'@ohos/hvigor-ohos-plugin'", '"rollup"', "'rollup'"];
  for (const key of depKeys) {
    const beforeDep = content;
    content = removeFieldWithBrackets(content, key);
    if (content !== beforeDep) {
      logs.push(`  ✅ hvigor/hvigor-config.json5: 删除 dependencies.${key}`);
    }
  }

  if (content !== before) {
    fs.writeFileSync(cfgPath, content, 'utf-8');
  }
  return logs;
}

/**
 * 步骤：工程级 oh-package.json5 新增 modelVersion（由参数指定）。
 * @param {string} projectRoot
 * @returns {string[]}
 */
function patchOhPackage(projectRoot) {
  const logs = [];
  const pkgPath = path.join(projectRoot, 'oh-package.json5');
  if (!fs.existsSync(pkgPath)) {
    logs.push(`  ⚠️ oh-package.json5 不存在，跳过`);
    return logs;
  }
  let content = fs.readFileSync(pkgPath, 'utf-8');
  const before = content;
  content = setFieldValue(content, 'modelVersion', `"${MODEL_VERSION}"`, '^\\{', '');
  if (content !== before) {
    fs.writeFileSync(pkgPath, content, 'utf-8');
    logs.push(`  ✅ oh-package.json5: 新增/覆盖 modelVersion=${MODEL_VERSION}`);
  } else {
    logs.push(`  ⏭️ oh-package.json5: modelVersion 已为 ${MODEL_VERSION}，跳过`);
  }
  return logs;
}

/**
 * 步骤：清理 local.properties 中 HarmonyOS SDK 配置行。
 * @param {string} projectRoot
 * @returns {string[]}
 */
function cleanLocalProperties(projectRoot) {
  const logs = [];
  const lpPath = path.join(projectRoot, 'local.properties');
  if (!fs.existsSync(lpPath)) {
    logs.push(`  ⏭️ local.properties 不存在，跳过`);
    return logs;
  }
  const content = fs.readFileSync(lpPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  // 删除含 HarmonyOS SDK 或 sdk.dir/harmonyos.sdk 等配置行
  const filtered = lines.filter((line) => {
    return !/HarmonyOS\s+SDK/i.test(line) &&
           !/^sdk\.dir/i.test(line) &&
           !/^harmonyos\.sdk/i.test(line);
  });
  if (filtered.length !== lines.length) {
    fs.writeFileSync(lpPath, filtered.join('\n'), 'utf-8');
    logs.push(`  ✅ local.properties: 清理 ${lines.length - filtered.length} 行 HarmonyOS SDK 配置`);
  } else {
    logs.push(`  ⏭️ local.properties: 无 HarmonyOS SDK 配置，跳过`);
  }
  return logs;
}

// ── 主流程 ──────────────────────────────────────────────────

/**
 * 主迁移流程。
 * @param {string} projectRoot
 * @param {boolean} isOpenHarmony
 * @param {'9'|'10+'} apiLevel
 * @returns {string[]} 全部操作日志
 */
function runMigration(projectRoot, isOpenHarmony, apiLevel) {
  const allLogs = [];
  const bpPath = path.join(projectRoot, 'build-profile.json5');

  allLogs.push(`[migrate] 开始迁移工程: ${projectRoot}`);
  allLogs.push(`[migrate] 检测: API ${apiLevel} 工程, ${isOpenHarmony ? 'OpenHarmony' : 'HarmonyOS'}`);

  // [API 9] 迁移 build-profile.json5
  if (apiLevel === '9') {
    const { content, logs } = migrateApi9BuildProfile(bpPath);
    allLogs.push(...logs);
    fs.writeFileSync(bpPath, content, 'utf-8');

    // 清理模块级 targets[].runtimeOS
    const moduleBps = findModuleBuildProfiles(projectRoot);
    allLogs.push(...cleanModuleTargetsRuntimeOS(moduleBps));
  }

  // [非 OpenHarmony] 删除工程级 compileSdkVersion
  if (!isOpenHarmony) {
    allLogs.push(...removeCompileSdkVersion(bpPath));
  } else {
    allLogs.push(`  ⏭️ build-profile.json5: OpenHarmony 工程，跳过 compileSdkVersion 删除`);
  }

  // 强制所有 product 的 compatibleSdkVersion/targetSdkVersion + runtimeOS=HarmonyOS
  allLogs.push(...forceProductSdkConfig(bpPath));

  // 删除 hvigor 文件
  allLogs.push(...removeHvigorFiles(projectRoot));

  // 修改 hvigor-config.json5
  allLogs.push(...patchHvigorConfig(projectRoot));

  // 修改 oh-package.json5
  allLogs.push(...patchOhPackage(projectRoot));

  // [非 OpenHarmony] 清理 local.properties
  if (!isOpenHarmony) {
    allLogs.push(...cleanLocalProperties(projectRoot));
  } else {
    allLogs.push(`  ⏭️ local.properties: OpenHarmony 工程，跳过 HarmonyOS SDK 清理`);
  }

  allLogs.push(`[migrate] SDK版本: compatibleSdkVersion=${COMPATIBLE_SDK_VERSION}, targetSdkVersion=${TARGET_SDK_VERSION}, runtimeOS=${RUNTIME_OS}`);
  allLogs.push(`[migrate] 迁移完成。请在 DevEco Studio 中执行 Sync now 验证。`);
  return allLogs;
}

// ── 入口 ────────────────────────────────────────────────────

const args = parseArgs();

// --- SDK 版本参数化 ---
// target-api: 优先用参数，否则自动探测已安装 SDK，探测失败默认 24
const sdkInfo = detectInstalledSdkApi();
const targetApi = args['target-api'] ? parseInt(String(args['target-api'])) : (sdkInfo ? sdkInfo.api : 24);
// compatible-api: 优先用参数，否则 = target-api（向后兼容）
const compatibleApi = args['compatible-api'] ? parseInt(String(args['compatible-api'])) : targetApi;

const _targetVer = API_VERSION_MAP[targetApi];
const _compatibleVer = API_VERSION_MAP[compatibleApi];
if (!_targetVer) {
  console.error(`错误: 未知 target-api 版本 ${targetApi}，API_VERSION_MAP 中无对应平台版本`);
  process.exit(1);
}
if (!_compatibleVer) {
  console.error(`错误: 未知 compatible-api 版本 ${compatibleApi}，API_VERSION_MAP 中无对应平台版本`);
  process.exit(1);
}
MODEL_VERSION = _targetVer;
COMPATIBLE_SDK_VERSION = `${_compatibleVer}(${compatibleApi})`;
TARGET_SDK_VERSION = `${_targetVer}(${targetApi})`;
// --- SDK 版本参数化结束 ---

if (!args.source || args.source === true) {
  console.error('用法: node migrate.cjs --source <工程根路径> [--compatible-api <N>] [--target-api <N>] [--openharmony]');
  process.exit(1);
}

const projectRoot = path.resolve(String(args.source));

if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
  console.error(`错误: --source 路径不存在或非目录: ${projectRoot}`);
  process.exit(1);
}

const bpPath = path.join(projectRoot, 'build-profile.json5');
if (!fs.existsSync(bpPath)) {
  console.error(`错误: 未找到工程级 build-profile.json5: ${bpPath}`);
  process.exit(1);
}

const { apiLevel, isOpenHarmony } = detectProject(projectRoot, args.openharmony === true);

const logs = runMigration(projectRoot, isOpenHarmony, apiLevel);
for (const line of logs) {
  console.log(line);
}
