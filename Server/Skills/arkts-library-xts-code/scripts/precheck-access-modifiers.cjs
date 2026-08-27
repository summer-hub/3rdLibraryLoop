#!/usr/bin/env node
/**
 * precheck-access-modifiers.cjs — 库源码 private/protected 成员扫描脚本
 *
 * 背景：
 *   接口规格文档（interface-spec.md）列出所有类的方法和属性，但不包含访问修饰符
 *   （private/protected/public）。代码生成时若直接调用 private/protected 成员，
 *   ArkTS 编译会报 "Property 'X' is private and only accessible within class" 错误。
 *   本脚本在代码生成之前扫描库源码，提取 private/protected 成员列表，供生成阶段
 *   预先排除直接调用，跳过这些成员的用例。
 *
 * 用法:
 *   node precheck-access-modifiers.cjs --source <工程根> [--libDir <库源码相对路径>]
 *
 *   示例:
 *     node precheck-access-modifiers.cjs --source D:/proj/ohos_dataorm
 *     node precheck-access-modifiers.cjs --source D:/proj/ohos_dataorm --libDir library/src/main/ets
 *
 * 输出:
 *   1. stdout: JSON 格式的 private/protected 成员列表
 *   2. 文件: <工程根>/precheck-access-modifiers.json
 *
 * 退出码:
 *   0 — 扫描成功
 *   1 — 参数错误或源码目录不存在
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── 参数解析 ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { source: '', libDir: 'library/src/main/ets' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      opts.source = args[i + 1];
      i++;
    } else if (args[i] === '--libDir' && args[i + 1]) {
      opts.libDir = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node precheck-access-modifiers.cjs --source <工程根> [--libDir <库源码相对路径>]');
      process.exit(0);
    }
  }
  if (!opts.source) {
    console.error('[precheck] 错误: --source 参数必填');
    process.exit(1);
  }
  return opts;
}

// ── 递归扫描 .ts/.ets 文件 ────────────────────────────────────

function scanFiles(dir, exts, results) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过 node_modules、oh_modules、build 等目录
      if (['node_modules', 'oh_modules', 'build', '.git', 'test'].includes(entry.name)) continue;
      scanFiles(fullPath, exts, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (exts.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
}

// ── 解析单个文件的 private/protected 成员 ─────────────────────

function parseAccessModifiers(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const members = [];
  let currentClass = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 匹配 class 声明
    const classMatch = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      currentClass = classMatch[1];
      continue;
    }

    // 匹配 private/protected 属性
    // 格式: private static readonly X: type = value;
    // 格式: protected config: DaoConfig;
    const propMatch = trimmed.match(/^(private|protected)\s+(?:static\s+)?(?:readonly\s+)?(\w+)\s*(?:[:?]|=)/);
    if (propMatch && currentClass) {
      members.push({
        class: currentClass,
        member: propMatch[2],
        modifier: propMatch[1],
        kind: 'property',
        file: path.basename(filePath),
        line: i + 1
      });
      continue;
    }

    // 匹配 private/protected 方法
    // 格式: private async executeInsert(...): Promise<...> {
    // 格式: protected loadUnique(cursor: any): T {
    const methodMatch = trimmed.match(/^(private|protected)\s+(?:async\s+)?(?:static\s+)?(\w+)\s*\(/);
    if (methodMatch && currentClass) {
      members.push({
        class: currentClass,
        member: methodMatch[2],
        modifier: methodMatch[1],
        kind: 'method',
        file: path.basename(filePath),
        line: i + 1
      });
      continue;
    }

    // 匹配 private/protected constructor
    const ctorMatch = trimmed.match(/^(private|protected)\s+constructor\s*\(/);
    if (ctorMatch && currentClass) {
      members.push({
        class: currentClass,
        member: 'constructor',
        modifier: ctorMatch[1],
        kind: 'constructor',
        file: path.basename(filePath),
        line: i + 1
      });
      continue;
    }
  }

  return members;
}

// ── 主流程 ────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();
  const libRoot = path.resolve(opts.source, opts.libDir);

  if (!fs.existsSync(libRoot)) {
    console.error(`[precheck] 错误: 库源码目录不存在: ${libRoot}`);
    process.exit(1);
  }

  console.log(`[precheck] 扫描库源码: ${libRoot}`);

  // 递归扫描所有 .ts 和 .ets 文件
  const files = [];
  scanFiles(libRoot, ['.ts', '.ets'], files);

  console.log(`[precheck] 扫描 ${files.length} 个源文件`);

  // 解析每个文件的 private/protected 成员
  const allMembers = [];
  for (const file of files) {
    const members = parseAccessModifiers(file);
    allMembers.push(...members);
  }

  // 按类分组
  const byClass = {};
  for (const m of allMembers) {
    if (!byClass[m.class]) {
      byClass[m.class] = { properties: [], methods: [] };
    }
    if (m.kind === 'property') {
      byClass[m.class].properties.push(m);
    } else {
      byClass[m.class].methods.push(m);
    }
  }

  // 输出统计
  const totalProps = allMembers.filter(m => m.kind === 'property').length;
  const totalMethods = allMembers.filter(m => m.kind === 'method').length;
  const classCount = Object.keys(byClass).length;

  console.log(`[precheck] 发现 ${classCount} 个类，${totalProps} 个 private/protected 属性，${totalMethods} 个 private/protected 方法`);

  // 输出每个类的成员列表
  for (const [cls, members] of Object.entries(byClass)) {
    console.log(`[precheck]   ${cls}: ${members.properties.length} 属性, ${members.methods.length} 方法`);
  }

  // 生成输出 JSON
  const output = {
    scanTime: new Date().toISOString(),
    sourcePath: opts.source,
    libDir: opts.libDir,
    fileCount: files.length,
    classCount,
    totalPrivateProtected: allMembers.length,
    summary: {
      properties: totalProps,
      methods: totalMethods,
      constructors: allMembers.filter(m => m.kind === 'constructor').length
    },
    classes: byClass
  };

  // 写入 JSON 文件
  const outputPath = path.join(opts.source, 'precheck-access-modifiers.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[precheck] 报告已写入: ${outputPath}`);

  // stdout 输出 JSON 供调用方读取
  console.log('\n' + JSON.stringify(output, null, 2));
}

main();
