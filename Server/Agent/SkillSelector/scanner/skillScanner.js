/**
 * skillScanner.js — SKILL 目录扫描器
 *
 * 职责：
 *   扫描给定 SKILL 筛选目录，解析每个子目录下的 SKILL.md frontmatter，
 *   产出结构化的 SkillMeta[]，供模糊匹配与排序使用。
 *
 * 设计原则：
 *   - 高内聚：所有"目录 → SkillMeta[]"的逻辑集中于此
 *   - 低耦合：只依赖 node:fs/path，不依赖 LLM、不依赖 Agent
 *   - 容错：单个 SKILL.md 解析失败不影响其余 SKILL，仅记录并跳过
 *
 * SKILL 目录格式（参考 D:\\code\\AIWeb\\Server\\Skills）：
 *   <skillDirectory>/
 *     ├── SomeSkill/
 *     │   ├── SKILL.md          # 必须存在，含 YAML frontmatter
 *     │   ├── references/        # 可选
 *     │   └── scripts/          # 可选
 *     └── AnotherSkill/
 *         └── SKILL.md
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 解析 SKILL.md 的 YAML frontmatter（轻量级实现，不引入 yaml 依赖）
 *
 * frontmatter 形如：
 *   ---
 *   name: cpp-porting-analysis
 *   description: 对 C++ 开源库进行鸿蒙化可行性分析...
 *   license: MIT
 *   metadata:
 *     author: lalhan
 *     version: "2.2.0"
 *     category: harmonyos-porting
 *     language: C/C++
 *   compatibility: 适用于任意托管在 Git 仓库的 C/C++ 开源库...
 *   ---
 *
 * @param {string} md - SKILL.md 全文
 * @returns {object} 解析出的元数据对象
 */
export function parseFrontmatter(md) {
  const result = {};
  if (!md) return result;

  // 切出首尾 --- 之间的内容（容错：允许 frontmatter 前有 BOM/空白）
  const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return result;

  const lines = fmMatch[1].split(/\r?\n/);
  let currentKey = null; // 当前所属的顶层 key（用于二级缩进归入 metadata 等嵌套对象）

  for (const line of lines) {
    if (!line.trim()) continue;

    // 二级缩进行：归属到上一个顶层 key 的子字段（仅处理 metadata 这类对象）
    if (/^\s+/.test(line) && currentKey) {
      const sub = line.trim();
      const colonIdx = sub.indexOf(':');
      if (colonIdx > 0) {
        const k = sub.slice(0, colonIdx).trim();
        const v = _stripQuotes(sub.slice(colonIdx + 1).trim());
        if (!result[currentKey] || typeof result[currentKey] !== 'object') {
          result[currentKey] = {};
        }
        result[currentKey][k] = v;
      }
      continue;
    }

    // 顶层 key: value
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();

    if (rest === '') {
      // 形如 "metadata:"，后续缩进行归入此 key
      currentKey = key;
      result[currentKey] = {};
    } else {
      currentKey = key;
      result[key] = _stripQuotes(rest);
    }
  }

  return result;
}

/**
 * 去除值两端的引号（单/双引号）
 * @param {string} v
 * @returns {string}
 */
function _stripQuotes(v) {
  if (!v) return v;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * 判断目录是否为合法 SKILL 目录（含 SKILL.md）
 * @param {string} dirPath
 * @returns {Promise<boolean>}
 */
async function _isSkillDir(dirPath) {
  try {
    const stat = await fs.stat(path.join(dirPath, 'SKILL.md'));
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * 扫描 skillDirectory，产出 SkillMeta[]
 *
 * @param {string} skillDirectory - SKILL 筛选目录绝对路径
 * @returns {Promise<import('./types.js').SkillMeta[]>}
 */
export async function scanSkills(skillDirectory) {
  if (!skillDirectory) {
    throw new Error('skillScanner: skillDirectory 不能为空');
  }

  // 确保目录存在
  let entries;
  try {
    entries = await fs.readdir(skillDirectory, { withFileTypes: true });
  } catch (err) {
    throw new Error(`skillScanner: 无法读取 SKILL 目录 ${skillDirectory}：${err.message}`);
  }

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // 跳过隐藏目录（如 .git）
    if (entry.name.startsWith('.')) continue;

    const dirPath = path.join(skillDirectory, entry.name);
    if (!(await _isSkillDir(dirPath))) continue;

    const skillMdPath = path.join(dirPath, 'SKILL.md');
    let md;
    try {
      md = await fs.readFile(skillMdPath, 'utf-8');
    } catch (err) {
      // 读取失败则跳过，不中断整体扫描
      console.warn(`[skillScanner] 读取 SKILL.md 失败，跳过：${skillMdPath}（${err.message}）`);
      continue;
    }

    const fm = parseFrontmatter(md);
    const meta = _buildSkillMeta(entry.name, dirPath, skillMdPath, fm, md);
    skills.push(meta);
  }

  return skills;
}

/**
 * 根据 frontmatter + 文件信息构建 SkillMeta
 * @private
 */
function _buildSkillMeta(dirName, dirPath, skillMdPath, fm, md) {
  const metadata = (fm.metadata && typeof fm.metadata === 'object') ? fm.metadata : {};
  // 计算正文长度（frontmatter 之后的内容），用于评估 SKILL 复杂度
  const bodyLength = md.replace(/^---[\s\S]*?---/, '').length;

  return {
    dirName,
    skillPath: dirPath,
    skillMdPath,
    name: fm.name || dirName,
    description: fm.description || '',
    license: fm.license || '',
    compatibility: fm.compatibility || '',
    version: metadata.version || '',
    author: metadata.author || '',
    category: metadata.category || '',
    // 兼容两种字段命名：language 或 language-support
    language: metadata.language || metadata['language-support'] || '',
    // 候选关键词：name + description + category + language 拼成小写串，便于模糊匹配打分
    searchableText: _buildSearchableText(fm.name, fm.description, metadata),
    bodyLength,
    hasReferences: false, // 在 scanSkills 后置检测，见下
    hasScripts: false,
  };
}

/**
 * 构建用于模糊匹配的可搜索文本（小写）
 * @private
 */
function _buildSearchableText(name, description, metadata) {
  const parts = [
    name,
    description,
    metadata.category,
    metadata.language || metadata['language-support'],
    metadata['harmonyos-support'],
  ].filter(Boolean);
  return parts.join(' ').toLowerCase();
}

export default { scanSkills, parseFrontmatter };
