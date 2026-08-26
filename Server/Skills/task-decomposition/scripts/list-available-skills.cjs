#!/usr/bin/env node
/**
 * @tool list-available-skills
 * @description 扫描 SKILL 根目录，读取各 SKILL.md frontmatter 的 name/description，按黑名单过滤后输出可用执行 SKILL 列表。供 task-decomposition 拆解时进行步骤与 SKILL 的匹配（specifiedSkill 标注），是可用 SKILL 清单的唯一事实源。
 * @param root: string - SKILL 根目录路径（可选，默认为脚本所在 SKILL 的上级目录）
 * @param format: string - 输出格式：list | names | json（可选，默认 list）
 * @param exclude: string - 额外黑名单，逗号分隔的 SKILL name/目录名（可选，与 skill-blacklist.json 合并）
 *
 * list-available-skills.cjs
 *
 * 用法（两种调用方式兼容）:
 *   node list-available-skills.cjs                              # 默认根目录，list 格式
 *   node list-available-skills.cjs --root /path/to/Skills       # 指定 SKILL 根目录
 *   node list-available-skills.cjs --format json                # JSON 格式输出
 *   node list-available-skills.cjs --exclude a,b,c              # 追加黑名单
 *   node list-available-skills.cjs '{"root":"/path/to/Skills","format":"json"}'
 *
 * 黑名单来源（三者合并生效，匹配 name 或目录名，大小写不敏感）:
 *   1. 脚本同目录 skill-blacklist.json（纯数组 或 {"exclude": [...]} 两种格式）
 *   2. --exclude 参数（逗号分隔）
 *   3. 环境变量 SKILL_BLACKLIST（逗号分隔）
 *
 * 输出格式:
 *   list  （默认）每行: - {name}（{目录名}）: {description}    —— 适合注入 prompt
 *   names 每行一个 name                                     —— 适合快速检索
 *   json  [{name, dir, description}]（pretty JSON）          —— 适合程序消费
 *
 * 依赖：仅 Node 内置 fs/path，无第三方依赖。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 默认 SKILL 根目录：本脚本位于 {root}/task-decomposition/scripts/ 下 */
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');

/** 黑名单配置文件（与本脚本同目录） */
const BLACKLIST_FILE = path.join(__dirname, 'skill-blacklist.json');

// ── frontmatter 解析 ──────────────────────────────────────────

/**
 * 从 SKILL.md 内容中解析 frontmatter 的指定字段（单行值）。
 *
 * @param {string} md   - SKILL.md 文件内容
 * @param {string} field - 字段名（如 name / description）
 * @returns {string|null} 字段值（去引号/去首尾空白）；无 frontmatter 或无该字段时 null
 */
function parseFrontmatterField(md, field) {
    const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return null;
    const fieldMatch = fmMatch[1].match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
    if (!fieldMatch) return null;
    return fieldMatch[1].trim().replace(/^['"]|['"]$/g, '');
}

/**
 * 解析单个 SKILL 目录的元信息。
 *
 * @param {string} skillDir - SKILL 目录路径
 * @returns {{name: string, dir: string, description: string}|null} 元信息；无 SKILL.md 或 name/description 均缺失时 null
 */
function parseSkillMeta(skillDir) {
    const mdPath = path.join(skillDir, 'SKILL.md');
    let md;
    try {
        md = fs.readFileSync(mdPath, 'utf-8');
    } catch {
        return null; // 无 SKILL.md，不是合法 SKILL 目录
    }
    const dir = path.basename(skillDir);
    const name = parseFrontmatterField(md, 'name') || dir;
    const description = parseFrontmatterField(md, 'description') || '';
    return { name, dir, description };
}

// ── 黑名单 ────────────────────────────────────────────────────

/**
 * 读取黑名单配置文件（skill-blacklist.json）。
 * 支持两种格式：纯数组 ["a","b"] 或 {"exclude": ["a","b"]}。
 * 文件不存在或格式非法时返回空数组（静默降级，不影响扫描）。
 *
 * @returns {string[]}
 */
function loadBlacklistFile() {
    try {
        const raw = fs.readFileSync(BLACKLIST_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.exclude) ? parsed.exclude : []);
        return list.filter(x => typeof x === 'string' && x.trim());
    } catch {
        return [];
    }
}

/**
 * 规整黑名单条目：去空白、转小写、去重、剔除空项。
 *
 * @param {string[]} list
 * @returns {string[]}
 */
function normalizeExcludeList(list) {
    const set = new Set();
    for (const item of list) {
        if (typeof item !== 'string') continue;
        const v = item.trim().toLowerCase();
        if (v) set.add(v);
    }
    return [...set];
}

/**
 * 汇总全部黑名单来源：配置文件 + --exclude 参数 + 环境变量 SKILL_BLACKLIST。
 *
 * @param {string[]} extraExclude - 额外黑名单条目
 * @returns {Set<string>} 小写黑名单集合
 */
function buildBlacklist(extraExclude = []) {
    const envList = (process.env.SKILL_BLACKLIST || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    return new Set(normalizeExcludeList([...loadBlacklistFile(), ...extraExclude, ...envList]));
}

// ── 扫描 ──────────────────────────────────────────────────────

/**
 * 扫描 SKILL 根目录，返回过滤黑名单后的可用 SKILL 列表（按 name 排序）。
 *
 * 规则：
 *   - 只扫描根目录下一级子目录（跳过隐藏目录）
 *   - 子目录必须包含 SKILL.md 且 frontmatter/目录名可提供 name
 *   - 黑名单按 name 或目录名匹配（大小写不敏感）
 *
 * @param {string} root          - SKILL 根目录路径
 * @param {string[]} extraExclude - 额外黑名单条目（name 或目录名）
 * @returns {{name: string, dir: string, description: string}[]} 可用 SKILL 列表
 */
function scanSkills(root, extraExclude = []) {
    const blacklist = buildBlacklist(extraExclude);

    let entries;
    try {
        entries = fs.readdirSync(root || DEFAULT_ROOT, { withFileTypes: true });
    } catch (err) {
        console.error(`Error: 无法读取 SKILL 根目录 ${root || DEFAULT_ROOT}: ${err.message}`);
        process.exit(1);
    }

    const skills = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const meta = parseSkillMeta(path.join(root || DEFAULT_ROOT, entry.name));
        if (!meta) continue;
        if (blacklist.has(meta.name.toLowerCase()) || blacklist.has(meta.dir.toLowerCase())) continue;
        skills.push(meta);
    }

    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
}

// ── 输出格式化 ────────────────────────────────────────────────

/**
 * 按指定格式输出 SKILL 列表文本。
 *
 * @param {{name: string, dir: string, description: string}[]} skills
 * @param {string} format - list | names | json
 * @returns {string}
 */
function formatSkills(skills, format) {
    switch (format) {
        case 'json':
            return JSON.stringify(skills, null, 2);
        case 'names':
            return skills.map(s => s.name).join('\n');
        case 'list':
        default:
            return skills.map(s => `- ${s.name}（${s.dir}）: ${s.description}`).join('\n');
    }
}

// ── CLI 入口 ──────────────────────────────────────────────────

/**
 * 解析 CLI 参数（兼容 flag 形式与 JSON 字符串形式）。
 *
 * @param {string[]} argv
 * @returns {{root: string, format: string, exclude: string[]}}
 */
function parseArgs(argv) {
    const args = { root: '', format: 'list', exclude: [] };

    // JSON 字符串形式：{"root": "...", "format": "json", "exclude": ["a","b"]}
    if (argv.length > 0 && typeof argv[0] === 'string' && argv[0].startsWith('{')) {
        try {
            const parsed = JSON.parse(argv[0]);
            if (parsed.root) args.root = String(parsed.root);
            if (parsed.format) args.format = String(parsed.format);
            if (Array.isArray(parsed.exclude)) args.exclude = parsed.exclude.map(String);
            return args;
        } catch {
            // 解析失败则按 flag 形式继续
        }
    }

    // flag 形式：--root <path> | --format <list|names|json> | --exclude a,b,c
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--root' && argv[i + 1]) {
            args.root = argv[i + 1];
            i++;
        } else if (arg === '--format' && argv[i + 1]) {
            args.format = argv[i + 1];
            i++;
        } else if (arg === '--exclude' && argv[i + 1]) {
            args.exclude.push(...argv[i + 1].split(',').map(s => s.trim()).filter(Boolean));
            i++;
        }
    }
    return args;
}

function main() {
    const { root, format, exclude } = parseArgs(process.argv.slice(2));

    if (!['list', 'names', 'json'].includes(format)) {
        console.error(`Error: 未知 format "${format}"（支持: list | names | json）`);
        process.exit(1);
    }

    const skills = scanSkills(root || DEFAULT_ROOT, exclude);
    const output = formatSkills(skills, format);
    if (output) console.log(output);
}

// 作为脚本直接执行时运行 CLI；被 require 时仅导出函数（供 validate-specified-skills.cjs 复用）
if (require.main === module) {
    main();
}

module.exports = { scanSkills, parseSkillMeta, loadBlacklistFile, buildBlacklist, formatSkills, DEFAULT_ROOT };
