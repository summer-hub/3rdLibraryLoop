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
  let block = null; // 块标量收集状态：{ key, indicator, lines, indent }

  for (const line of lines) {
    // 块标量收集模式：累积缩进比指示符更深的行（含空行），遇到非块内容行则先落地块
    if (block) {
      if (_isBlockContentLine(line, block.indent)) {
        block.lines.push(line);
        continue;
      }
      result[block.key] = parseBlockScalar(block.indicator, block.lines);
      block = null;
      currentKey = null;
    }

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
    } else if (/^[|>](?:[-+])?$/.test(rest)) {
      // 块标量指示符（| / |- / |+ 字面块，> / >- / >+ 折叠块）：
      // 记录 currentKey 与指示符，后续更深的缩进行累积为该 key 的值
      currentKey = key;
      result[key] = '';
      block = { key, indicator: rest, lines: [], indent: _lineIndent(line) };
    } else {
      currentKey = key;
      result[key] = _stripQuotes(rest);
    }
  }

  // 到文件结尾仍未闭合的块标量
  if (block) {
    result[block.key] = parseBlockScalar(block.indicator, block.lines);
  }

  return result;
}

/**
 * 解析 YAML 块标量内容（纯函数，便于单测）
 *
 * @param {string} indicator - 块标量指示符，如 '|'、'|-'、'|+'、'>'、'>-'、'>+'
 * @param {string[]} lines - 块内容行（含块内空行，不含指示符行本身）
 * @returns {string}
 */
export function parseBlockScalar(indicator, lines) {
  const literal = indicator[0] === '|'; // '|' 字面块：保留换行；'>' 折叠块：行间折叠为空
  // 块为空（无任何内容行）时按 YAML 语义返回空字符串
  if (!lines.length) return '';
  // 判断块内是否存在至少一行非空内容；全是空行也按空字符串处理
  const hasContent = lines.some((l) => l.trim() !== '');

  let out;
  if (literal) {
    // 字面块：剔除公共缩进后按行保留 \n（首尾空行剔除）
    const trimmed = _trimEmptyEdgeLines(lines);
    const minIndent = _minContentIndent(trimmed);
    const dedented = trimmed.map((l) => (l.trim() ? l.slice(minIndent) : ''));
    out = dedented.join('\n');
  } else {
    // 折叠块：段内行折叠为空格连接，空行作为段落分隔保留为单个 \n
    out = '';
    for (const line of lines) {
      const text = line.trim();
      if (!text) {
        if (out && !out.endsWith('\n')) out += '\n';
        continue;
      }
      if (out && !out.endsWith('\n')) out += ' ';
      out += text;
    }
  }

  if (!hasContent && !out.trim()) return '';

  // chomping：'-' 去除全部尾换行，'+' 保留尾换行，默认 clip 保留单个尾换行
  const chomping = indicator.slice(1);
  if (chomping === '-') {
    out = out.replace(/\n+$/, '');
  } else if (out && !out.endsWith('\n')) {
    out += '\n';
  }
  return out;
}

/**
 * 判断该行是否属于当前块标量的内容行：空行永远属于块；否则缩进必须深于指示符行
 * @param {string} line
 * @param {number} blockIndent - 块标量指示符行自身的缩进
 * @returns {boolean}
 */
function _isBlockContentLine(line, blockIndent) {
  if (!line.trim()) return true; // 空行：段落分隔或尾部空行，均属于块
  return _lineIndent(line) > blockIndent;
}

/**
 * 计算行首空格缩进数（非空格开头视为 0）
 * @param {string} line
 * @returns {number}
 */
function _lineIndent(line) {
  const m = line.match(/^ +/);
  return m ? m[0].length : 0;
}

/**
 * 剔除字面块内容的首尾空行（保留中间空行）
 * @param {string[]} lines
 * @returns {string[]}
 */
function _trimEmptyEdgeLines(lines) {
  let start = 0;
  let end = lines.length - 1;
  while (start <= end && !lines[start].trim()) start++;
  while (end >= start && !lines[end].trim()) end--;
  return lines.slice(start, end + 1);
}

/**
 * 计算非空内容行的最小缩进（作为字面块的公共缩进基准）
 * @param {string[]} lines
 * @returns {number}
 */
function _minContentIndent(lines) {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim()) min = Math.min(min, _lineIndent(line));
  }
  return min === Infinity ? 0 : min;
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
  // 提取 frontmatter 之后的正文，截取前 2500 字符参与模糊匹配
  const bodyText = md.replace(/^---[\s\S]*?---/, '').trim().slice(0, 2500);
  // 计算正文长度（frontmatter 之后的内容），用于评估 SKILL 复杂度
  const bodyLength = md.replace(/^---[\s\S]*?---/, '').length;

  // 触发场景声明：优先取 frontmatter 的 metadata.useWhen，否则从 description 的 "use when/当...时" 段解析
  const useWhen = metadata.useWhen || _extractUseWhen(fm.description || '');

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
    useWhen,
    // 可搜索文本：metadata×3 权重放大 + 正文前 2500 字符 + useWhen 触发场景
    searchableText: _buildSearchableText(fm.name, fm.description, metadata, bodyText, useWhen),
    bodyText,
    bodyLength,
    hasReferences: false, // 在 scanSkills 后置检测，见下
    hasScripts: false,
  };
}

/**
 * 从 description 中解析 "use when..." 触发场景段
 *
 * 规范格式（见 skill-generator）：description = {做什么}. Use when {什么时候用}. {关键词}.
 * 兼容多种写法：
 *   - "Use when 需要评估...覆盖率。"          → "需要评估...覆盖率"
 *   - "use when auditing README/API docs..." → "auditing README/API docs"
 *   - "USE FOR: 鸿蒙三方库接口提取..."         → "鸿蒙三方库接口提取..."
 * 解析失败（无 use when 段）返回空字符串，不阻塞。
 *
 * @param {string} description
 * @returns {string}
 * @private
 */
function _extractUseWhen(description) {
  if (!description) return '';
  // 优先匹配 "use when" / "use for" 之后的内容，取到句子结束（句号/分号/换行）
  const m = description.match(/(?:use\s+when|use\s+for)\s*[：:，,]?\s*(.+?)(?:[。；;]|$)/i);
  if (m && m[1]) {
    return m[1].trim();
  }
  // 兼容中文散文式："当...时调用" / "当...时使用"
  const cn = description.match(/当(.+?)(?:时调用|时使用)/);
  if (cn && cn[1]) {
    return cn[1].trim();
  }
  return '';
}

/**
 * 构建用于模糊匹配的可搜索文本（小写）
 *
 * 策略（参考 BearCode 的 BM25 lite）：
 *   - metadata 字段（name+description+category+language+harmonyos-support+compatibility）
 *     权重放大 3 倍，确保 frontmatter 匹配占主导
 *   - 正文前 2500 字符参与索引，覆盖 description 未提及的语义
 *   - useWhen 触发场景参与索引，让"什么场景下调用"这一语义信号进入召回
 *
 * @param {string} name
 * @param {string} description
 * @param {object} metadata
 * @param {string} [bodyText=''] - SKILL.md 正文前 2500 字符
 * @param {string} [useWhen=''] - 从 frontmatter/description 解析的触发场景
 * @returns {string} 小写拼接文本
 * @private
 */
function _buildSearchableText(name, description, metadata, bodyText = '', useWhen = '') {
  const metaParts = [
    name,
    description,
    metadata.category,
    metadata.language || metadata['language-support'],
    metadata['harmonyos-support'],
    metadata.compatibility || '',
    useWhen,
  ].filter(Boolean).join(' ');

  // metadata 权重放大 3 倍，正文权重 1 倍
  const metaWeighted = [metaParts, metaParts, metaParts].join(' ');
  return (metaWeighted + ' ' + bodyText).toLowerCase();
}

export default { scanSkills, parseFrontmatter };
