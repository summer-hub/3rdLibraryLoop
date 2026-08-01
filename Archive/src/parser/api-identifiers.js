/**
 * api-identifiers.js — API 符号提取与匹配
 *
 * 从文本和代码块中提取 API 符号，用于索引阶段增强检索召回。
 * 规则：
 *   1. 模块路径：@ohos.camera → camera, @ohos.camera
 *   2. camelCase：cameraManager → cameraManager, cameramanager
 *   3. PascalCase：CameraManager（过滤太通用的词）
 *   4. 装饰器：@Component, @Builder
 *
 * 提取后去除被包含的子串（如 "camera" 被 "cameraManager" 包含时去掉）。
 */

/** 太通用的 PascalCase 词，过滤掉 */
const GENERIC = new Set([
  'API', 'Type', 'Value', 'Error', 'Action', 'Method', 'Class',
  'Object', 'String', 'Number', 'Boolean', 'Array', 'Function',
  'Param', 'Params', 'Config', 'Options', 'Result', 'Data', 'Info',
]);

/** 缩写词保留 */
const ACRONYMS = new Set([
  'HTTP', 'URL', 'JSON', 'XML', 'HTML', 'CSS', 'SQL', 'API',
  'UI', 'UX', 'ID', 'UUID', 'URI', 'SSL', 'TLS', 'DNS', 'TCP',
  'UDP', 'RPC', 'SDK', 'WASM', 'FTS', 'GIL',
]);

/**
 * 判断 PascalCase 符号是否有价值（非通用词、足够长）。
 * @param {string} symbol
 * @returns {boolean}
 */
function isValuable(symbol) {
  if (GENERIC.has(symbol)) return false;
  if (ACRONYMS.has(symbol)) return true;
  if (symbol.length <= 3) return false;
  return /^[A-Z]/.test(symbol);
}

/**
 * 为符号添加大小写变体。
 * @param {Set<string>} set
 * @param {string} symbol
 */
function appendVariants(set, symbol) {
  if (!symbol) return;
  set.add(symbol);
  // camelCase → 全小写
  if (/^[a-z]/.test(symbol)) {
    set.add(symbol.toLowerCase());
  }
}

/**
 * 去除被其他符号包含的子串。
 * 例如 "camera" 被 "cameraManager" 包含时去掉 "camera"。
 * @param {string[]} symbols
 * @returns {string[]}
 */
function filterSubsumed(symbols) {
  /** @type {string[]} */
  const result = [];
  const sorted = [...symbols].sort((a, b) => b.length - a.length);
  for (const sym of sorted) {
    const lower = sym.toLowerCase();
    if (result.some((r) => r.toLowerCase().includes(lower) && r.toLowerCase() !== lower)) {
      continue;
    }
    result.push(sym);
  }
  return result;
}

/**
 * 从文本和代码块中提取 API 符号。
 * @param {string} text
 * @param {string[]} codeBlocks
 * @returns {string[]}
 */
export function extractApiSymbols(text, codeBlocks) {
  /** @type {Set<string>} */
  const symbols = new Set();

  for (const source of [text, ...codeBlocks]) {
    if (!source) continue;

    // 1. 模块路径: @ohos.camera
    for (const mod of source.matchAll(/@[a-z]+\.[a-z][a-zA-Z0-9.]+/gi)) {
      appendVariants(symbols, mod[0]);
    }

    // 2. camelCase: cameraManager
    for (const camel of source.matchAll(/\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]+\b/g)) {
      appendVariants(symbols, camel[0]);
    }

    // 3. PascalCase: CameraManager
    for (const pascal of source.matchAll(/[A-Z][a-zA-Z0-9]{2,}/g)) {
      if (isValuable(pascal[0])) symbols.add(pascal[0]);
    }

    // 4. 装饰器: @Component, @Builder
    for (const deco of source.matchAll(/@[A-Z][a-zA-Z]+/g)) {
      symbols.add(deco[0]);
    }
  }

  return filterSubsumed([...symbols]);
}

/**
 * 判断查询 token 是否匹配文档的 API 符号集合。
 * @param {string} token
 * @param {string[]} apiSymbols
 * @returns {boolean}
 */
export function matchApiSymbol(token, apiSymbols) {
  if (!token || apiSymbols.length === 0) return false;
  const lower = token.toLowerCase();
  return apiSymbols.some((sym) => sym.toLowerCase() === lower);
}
