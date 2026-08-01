/**
 * api-suffixes.js — API 命名后缀规则
 *
 * 用于 API 符号提取与查询匹配，识别 HarmonyOS / ArkTS 常见的
 * API 命名后缀（Manager, Controller, Service 等）。
 */

/** API 类名常见后缀（用于判断符号是否为 API 类） */
export const API_SUFFIXES = [
  'Manager',
  'Controller',
  'Service',
  'Provider',
  'Helper',
  'Factory',
  'Builder',
  'Observer',
  'Listener',
  'Callback',
  'Interface',
  'Adapter',
  'Wrapper',
  'Handler',
];

/** API 后缀集合（O(1) 判断） */
const API_SUFFIX_SET = new Set(API_SUFFIXES);

/**
 * 判断符号是否以已知 API 后缀结尾。
 * @param {string} symbol
 * @returns {boolean}
 */
export function hasApiSuffix(symbol) {
  for (const suffix of API_SUFFIXES) {
    if (symbol.endsWith(suffix) && symbol.length > suffix.length) return true;
  }
  return false;
}

/**
 * 判断符号是否为 Manager 类 API（用于 rerank 强 boost）。
 * @param {string} symbol
 * @returns {boolean}
 */
export function isManagerApi(symbol) {
  return symbol.endsWith('Manager') && symbol.length > 'Manager'.length;
}
