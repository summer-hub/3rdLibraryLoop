/**
 * catalog-routing.js — 目录权重路由
 *
 * 根据查询特征（API 符号、中文/英文混合、"如何/步骤"等）
 * 动态计算各目录的搜索 boost 倍数。
 */

/**
 * @typedef {Object} CatalogBoostResult
 * @property {number} catalogId
 * @property {number} boost
 */

/**
 * 计算目录 boost。
 * 规则：
 *   - @ohos. 查询 → references ×1.5
 *   - "如何/步骤" 查询 → guides ×1.45
 *   - 中文+英文API混合 → guides ×1.45 + references ×1.35
 *
 * @param {string} query         规范化后的查询
 * @param {string[]} tokens      分词后的 token
 * @param {Map<string, {id:string,title:string,searchBoost?:number,tailInGlobalSearch?:boolean}>} catalogMap
 * @param {function(string):number} catalogToId 将 catalog id 转为数字 ID
 * @returns {Map<number, number>} catalogId → boost 倍数
 */
export function computeCatalogBoosts(query, tokens, catalogMap, catalogToId) {
  /** @type {Map<number, number>} */
  const boosts = new Map();

  // 初始化：所有目录使用配置的 searchBoost（默认 1.0）
  for (const config of catalogMap.values()) {
    boosts.set(catalogToId(config.id), config.searchBoost ?? 1.0);
  }

  const hasOhosModule = /@[a-z]+\.[a-z]/i.test(query);
  const hasHowTo = /如何|怎么|步骤|教程|入门|guide/i.test(query);
  const hasChinese = /[\u4e00-\u9fa5]/.test(query);
  const hasEnglishApi = tokens.some((t) => /^[A-Z][a-zA-Z0-9]+|@[a-z]+\.[a-z]/i.test(t));

  if (hasOhosModule) {
    applyBoost(boosts, catalogMap, catalogToId, 'references', 1.5);
  }

  if (hasHowTo) {
    applyBoost(boosts, catalogMap, catalogToId, 'guides', 1.45);
  }

  if (hasChinese && hasEnglishApi) {
    applyBoost(boosts, catalogMap, catalogToId, 'guides', 1.45);
    applyBoost(boosts, catalogMap, catalogToId, 'references', 1.35);
  }

  return boosts;
}

/**
 * 应用 boost（取较大值，不覆盖更高的已有 boost）。
 * @param {Map<number, number>} boosts
 * @param {Map<string, any>} catalogMap
 * @param {function(string):number} catalogToId
 * @param {string} catalogId
 * @param {number} value
 */
function applyBoost(boosts, catalogMap, catalogToId, catalogId, value) {
  if (!catalogMap.has(catalogId)) return;
  const numId = catalogToId(catalogId);
  const current = boosts.get(numId) ?? 1.0;
  boosts.set(numId, Math.max(current, value));
}

/**
 * 获取全局搜索时排到尾部的目录 ID 集合。
 * @param {Map<string, any>} catalogMap
 * @param {function(string):number} catalogToId
 * @returns {Set<number>}
 */
export function getTailCatalogIds(catalogMap, catalogToId) {
  /** @type {Set<number>} */
  const tail = new Set();
  for (const config of catalogMap.values()) {
    if (config.tailInGlobalSearch) {
      tail.add(catalogToId(config.id));
    }
  }
  return tail;
}
