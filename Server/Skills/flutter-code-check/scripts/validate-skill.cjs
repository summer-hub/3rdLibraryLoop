#!/usr/bin/env node
/**
 * @tool validate-skill
 * @description 校验 SKILL 目录是否符合 Agent Skills 规范，检查 frontmatter、结构、渐进式披露。跨平台（Windows/macOS/Linux），仅需 Node.js。
 * @param skillDir: string - SKILL 目录绝对路径
 * @hidden
 * validate-skill.cjs
 *
 * 用法:
 *   # CLI 模式
 *   node validate-skill.cjs /path/to/skill
 *
 *   # MCP Gateway 模式（第一个参数为 JSON 字符串）
 *   node validate-skill.cjs '{"skillDir":"/path/to/skill"}'
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ── 参数解析（兼容 MCP Gateway JSON 模式与 CLI 模式） ──────

function parseArgs(argv) {
  if (argv.length === 0) return {};
  const first = argv[0];
  if (typeof first === 'string' && first.startsWith('{')) {
    try { return JSON.parse(first); } catch (e) { return {}; }
  }
  return { skillDir: first };
}

// ── 输出统计 ─────────────────────────────────────────────

let PASS = 0;
let FAIL = 0;
let WARNINGS = 0;

function checkPass(msg) { console.log(`  ✅ ${msg}`); PASS += 1; }
function checkFail(msg) { console.log(`  ❌ ${msg}`); FAIL += 1; }
function checkWarn(msg) { console.log(`  ⚠️  ${msg}`); WARNINGS += 1; }

// ── Frontmatter 解析 ─────────────────────────────────────

/**
 * 解析 SKILL.md 的 frontmatter 与 body。
 * 返回 { frontmatter: object|null, bodyLines: string[] }
 */
function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (!lines[0] || lines[0].trim() !== '---') {
    return { frontmatter: null, bodyLines: lines };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) {
    return { frontmatter: null, bodyLines: lines };
  }
  const fmLines = lines.slice(1, end);
  const fm = {};
  let currentKey = null;
  for (const line of fmLines) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (m) {
      currentKey = m[1];
      fm[currentKey] = m[2].trim();
    } else if (currentKey && /^\s+\S/.test(line)) {
      fm[currentKey] += '\n' + line.trim();
    }
  }
  return { frontmatter: fm, bodyLines: lines.slice(end + 1) };
}

// ── 主流程 ───────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillDir = args.skillDir || '';

  if (!skillDir) {
    console.log('Usage: node validate-skill.cjs <skillDir>');
    console.log('Error: skillDir parameter is required');
    process.exit(1);
  }

  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    console.log(`Error: Directory does not exist: ${skillDir}`);
    process.exit(1);
  }

  console.log('=== SKILL 规范校验 ===');
  console.log(`目录: ${skillDir}`);
  console.log('');

  // ─── 1. SKILL.md 存在性 ───
  console.log('--- 1. 文件结构检查 ---');
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
    checkPass('SKILL.md 存在');
  } else {
    checkFail('SKILL.md 不存在');
    console.log('无法继续校验，SKILL.md 是必需文件');
    process.exit(1);
  }

  const content = fs.readFileSync(skillFile, 'utf-8');
  const { frontmatter, bodyLines } = parseFrontmatter(content);

  // ─── 2. Frontmatter 检查 ───
  console.log('');
  console.log('--- 2. Frontmatter 检查 ---');

  if (frontmatter) {
    checkPass('YAML frontmatter 存在');
  } else {
    checkFail('缺少 YAML frontmatter（文件应以 --- 开头并以 --- 结束头部）');
  }

  const nameField = frontmatter ? String(frontmatter.name || '') : '';
  if (nameField) {
    checkPass(`name 字段存在: ${nameField}`);

    // name 字符集校验
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(nameField)) {
      checkPass('name 字符集合规（仅小写字母/数字/连字符）');
    } else {
      checkFail('name 字符集不合规：应仅含 a-z/0-9/-，不能首尾连字符或连续连字符');
    }

    // name 长度校验
    const nameLen = nameField.length;
    if (nameLen >= 1 && nameLen <= 64) {
      checkPass(`name 长度合规 (${nameLen} 字符)`);
    } else {
      checkFail(`name 长度不合规：应在 1-64 字符之间（当前 ${nameLen}）`);
    }

    // name 匹配目录名
    const dirName = path.basename(path.resolve(skillDir));
    if (nameField === dirName) {
      checkPass(`name 匹配父目录名 (${dirName})`);
    } else {
      checkFail(`name 不匹配父目录名：name='${nameField}' vs 目录='${dirName}'`);
    }
  } else {
    checkFail('name 字段缺失');
  }

  const descField = frontmatter ? String(frontmatter.description || '') : '';
  if (descField) {
    const descLen = descField.length;
    if (descLen <= 1024) {
      checkPass(`description 长度合规 (${descLen} 字符)`);
    } else {
      checkFail(`description 过长：应 ≤1024 字符（当前 ${descLen}）`);
    }
  } else {
    checkFail('description 字段缺失或为空');
  }

  if (frontmatter && frontmatter.license) {
    checkPass('license 字段存在');
  } else {
    checkWarn('license 字段缺失（推荐添加）');
  }

  if (frontmatter && frontmatter.metadata) {
    checkPass('metadata 字段存在');
  } else {
    checkWarn('metadata 字段缺失（推荐添加 author/version）');
  }

  // ─── 3. Body 检查 ───
  console.log('');
  console.log('--- 3. Body 内容检查 ---');

  const bodyLineCount = bodyLines.length;
  if (bodyLineCount <= 500) {
    checkPass(`body 行数合规 (${bodyLineCount} 行, ≤500)`);
  } else {
    checkWarn(`body 行数较多 (${bodyLineCount} 行，推荐 < 500，考虑拆分到 references/)`);
  }

  if (/任务参数|## .*参数|\|\s*参数/.test(content)) {
    checkPass('包含任务参数说明');
  } else {
    checkWarn('未找到任务参数表（推荐添加）');
  }

  if (/工作流程|Phase|## Phase/.test(content)) {
    checkPass('包含工作流程概览');
  } else {
    checkWarn('未找到工作流程概览（推荐添加）');
  }

  // ─── 4. 渐进式披露检查 ───
  console.log('');
  console.log('--- 4. 渐进式披露检查 ---');

  const refsDir = path.join(skillDir, 'references');
  if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
    const refFiles = fs.readdirSync(refsDir)
      .filter((f) => f.endsWith('.md') && fs.statSync(path.join(refsDir, f)).isFile());
    checkPass(`references/ 目录存在 (${refFiles.length} 个文档)`);

    // 检查引用深度（一层）
    const nestedDirs = fs.readdirSync(refsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).length;
    if (nestedDirs === 0) {
      checkPass('references 保持一层深度');
    } else {
      checkFail(`references 存在嵌套子目录 (${nestedDirs} 个)，应保持一层深度`);
    }
  } else {
    checkWarn('无 references/ 目录（详细内容建议拆分到此目录）');
  }

  const assetsDir = path.join(skillDir, 'assets');
  if (fs.existsSync(assetsDir) && fs.statSync(assetsDir).isDirectory()) {
    checkPass('assets/ 目录存在');
  } else {
    checkWarn('无 assets/ 目录（如需模板/资源可添加）');
  }

  const scriptsDir = path.join(skillDir, 'scripts');
  if (fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory()) {
    checkPass('scripts/ 目录存在');
  } else {
    checkWarn('无 scripts/ 目录（如需可执行脚本可添加）');
  }

  // 检查文件引用使用相对路径
  const absRefs = (content.match(/\]\(\/[^)]+\)/g) || []).length;
  if (absRefs === 0) {
    checkPass('文件引用使用相对路径');
  } else {
    checkFail(`发现 ${absRefs} 个绝对路径引用，应使用相对路径`);
  }

  // ─── 5. 总结 ───
  console.log('');
  console.log('=== 校验总结 ===');
  console.log(`  ✅ 通过: ${PASS}`);
  console.log(`  ❌ 失败: ${FAIL}`);
  console.log(`  ⚠️  警告: ${WARNINGS}`);
  console.log('');

  if (FAIL === 0) {
    console.log('ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log(`VALIDATION FAILED: ${FAIL} 个必须修复的问题`);
    process.exit(1);
  }
}

main();
