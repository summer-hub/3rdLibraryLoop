#!/usr/bin/env node
/**
 * @tool verify-arkts
 * @description 验证 ArkTS(.ets) 代码无语法错误。工程模式：对目标鸿蒙工程执行 devecocli build 并解析错误；独立模式：自动脚手架临时鸿蒙工程（devecocli create）、将待验证文件接入构建图（side-effect import）后编译验证，错误按 规则(文件:行:列) 映射回源文件输出。跨平台，需本机已安装 devecocli 与 DevEco Studio SDK。
 * @param files: string[] - 独立模式：待验证的 .ets 文件绝对路径列表（与 project 二选一）
 * @param project: string - 工程模式：目标鸿蒙工程路径（与 files 二选一）
 * @param workDir: string - 独立模式：临时工程所在目录（默认系统临时目录；指定后工程保留可复用）
 * @param keep: boolean - 独立模式：验证后保留临时工程（默认删除自动创建的临时目录）
 * @param apiLevel: number - 脚手架 API Level（可选，传入 devecocli create）
 * @param timeout: number - 构建超时毫秒数（默认 600000）
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_NAME = 'ArkTSVerify';
const APP_NAME = 'ArkTSVerify';
const DEFAULT_BUILD_TIMEOUT_MS = 600000;
const CREATE_TIMEOUT_MS = 300000;

// ── 参数解析（兼容 MCP Gateway JSON 模式与 CLI 模式） ──────────

function parseArgs(argv) {
  if (argv.length === 1 && typeof argv[0] === 'string' && argv[0].startsWith('{')) {
    try {
      return JSON.parse(argv[0]);
    } catch (e) {
      usageAndExit('Invalid JSON argument');
    }
  }
  const args = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' && i + 1 < argv.length) {
      args.project = argv[++i];
    } else if (a === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.files.push(argv[++i]);
      }
    } else if (a === '--work-dir' && i + 1 < argv.length) {
      args.workDir = argv[++i];
    } else if (a === '--keep') {
      args.keep = true;
    } else if (a === '--api-level' && i + 1 < argv.length) {
      args.apiLevel = Number(argv[++i]);
    } else if (a === '--timeout' && i + 1 < argv.length) {
      args.timeout = Number(argv[++i]);
    } else {
      usageAndExit(`Unknown or incomplete argument: ${a}`);
    }
  }
  return args;
}

function usageAndExit(message) {
  if (message) {
    console.error(`Error: ${message}`);
  }
  console.log('Usage:');
  console.log('  node verify-arkts.cjs --project <工程目录>');
  console.log('  node verify-arkts.cjs --files <a.ets> [b.ets ...] [--work-dir <目录>] [--keep] [--api-level <n>] [--timeout <ms>]');
  console.log('MCP mode:');
  console.log(`  node verify-arkts.cjs '{"files":["/abs/a.ets"],"workDir":"/tmp/x","keep":false}'`);
  process.exit(2);
}

// ── 通用工具 ─────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** 跨平台执行 CLI 命令（Windows 下走 shell 解析 .cmd） */
function runCli(cmd, args, options) {
  const isWin = process.platform === 'win32';
  const finalArgs = isWin ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  return spawnSync(cmd, finalArgs, {
    cwd: options.cwd,
    encoding: 'utf-8',
    timeout: options.timeout,
    shell: isWin,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function checkDevecocli() {
  const res = runCli('devecocli', ['-V'], { cwd: process.cwd(), timeout: 30000 });
  if (res.error || res.status !== 0) {
    console.error('Error: devecocli not available. Install deveco-cli and ensure DevEco Studio + SDK are installed.');
    process.exit(2);
  }
}

/** 计算一组绝对路径的最长公共父目录 */
function commonAncestor(files) {
  if (files.length === 1) {
    return path.dirname(files[0]);
  }
  let parts = toPosix(path.resolve(files[0])).split('/');
  for (let i = 1; i < files.length; i++) {
    const cur = toPosix(path.resolve(files[i])).split('/');
    let j = 0;
    while (j < parts.length && j < cur.length && parts[j] === cur[j]) {
      j += 1;
    }
    parts = parts.slice(0, j);
  }
  return parts.join('/') || '/';
}

function copyRecursive(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function rmRecursive(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 构建输出解析 ──────────────────────────────────────────

/**
 * 解析 devecocli build 输出。识别三类错误格式：
 * 1. ArkTS 规则错误：Error Message: <msg> (arkts-规则名) At File: <路径>:<行>:<列>
 * 2. 模块解析错误：Error Message: Cannot find module '...' ... At File: <路径>:<行>:<列>
 * 3. Rollup/通用错误：ERROR: <错误码> <名称> Error + Error Message: <msg>. At file: <路径>（无行列）
 * 返回 { successful: boolean, failed: boolean, errors: [{rule, file, line, col, message}], rawTail: string }
 */
function parseBuildOutput(rawOutput) {
  const output = stripAnsi(rawOutput || '');
  const errors = [];
  const seen = new Set();

  // 按 "ERROR: <错误码>" 头切分错误块
  const blocks = output.split(/(?=ERROR: \d+)/);
  for (const block of blocks) {
    const headMatch = block.match(/^ERROR:\s*(\d+)\s+(.+?)\s*Error\s*$/m);
    const msgMatch = block.match(/Error Message:\s*([^\r\n]+)/);
    if (!msgMatch) {
      continue;
    }
    const full = msgMatch[1].trim();
    if (seen.has(full)) {
      continue;
    }
    seen.add(full);

    const code = headMatch ? `${headMatch[1]} ${headMatch[2]}` : 'build-error';

    // 格式1：带规则名（arkts-*）与行列
    let m = full.match(/^(.*)\s*\(([\w-]+)\)\s*At File:\s*(.+):(\d+):(\d+)$/);
    if (m) {
      errors.push({
        message: m[1].trim(),
        rule: m[2],
        file: m[3].trim(),
        line: Number(m[4]),
        col: Number(m[5]),
      });
      continue;
    }
    // 格式2：无规则名，但带 At File + 行列（Cannot find module 等）
    m = full.match(/^(.+?)\.?\s*At File:\s*(.+):(\d+):(\d+)$/);
    if (m) {
      errors.push({
        message: m[1].trim(),
        rule: code,
        file: m[2].trim(),
        line: Number(m[3]),
        col: Number(m[4]),
      });
      continue;
    }
    // 格式3：Rollup 等（At file: 小写，无行列）
    m = full.match(/At file:\s*(.+?)\s*\.?$/);
    errors.push({
      message: full.replace(/\s*At file:.*$/, '').replace(/\.$/, ''),
      rule: code,
      file: m ? m[1].trim() : '',
      line: 0,
      col: 0,
    });
  }

  const successful = /BUILD SUCCESSFUL/.test(output) || /Build completed successfully/.test(output);
  const failed = /BUILD FAILED/.test(output) || /COMPILE RESULT:FAIL/.test(output);
  const tailLines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rawTail = tailLines.slice(-40).join('\n');
  return { successful, failed, errors, rawTail };
}

// ── 工程模式 ─────────────────────────────────────────────

function verifyProject(projectDir, timeoutMs) {
  const profile = path.join(projectDir, 'build-profile.json5');
  if (!fs.existsSync(profile)) {
    console.error(`Error: not a valid HarmonyOS project (build-profile.json5 not found): ${projectDir}`);
    process.exit(2);
  }
  console.log('=== ArkTS 编译验证（工程模式） ===');
  console.log(`工程: ${projectDir}`);
  console.log('');
  const res = runCli('devecocli', ['build'], { cwd: projectDir, timeout: timeoutMs });
  if (res.error && res.error.code === 'ETIMEDOUT') {
    console.error(`Error: build timed out after ${timeoutMs}ms`);
    process.exit(2);
  }
  const parsed = parseBuildOutput(`${res.stdout || ''}\n${res.stderr || ''}`);
  reportResult(parsed, null);
}

// ── 独立模式 ─────────────────────────────────────────────

function scaffoldProject(projectPath, apiLevel) {
  const createArgs = ['create', '--app-name', APP_NAME, '--project-path', projectPath];
  if (Number.isFinite(apiLevel) && apiLevel > 0) {
    createArgs.push('--api-level', String(apiLevel));
  }
  const res = runCli('devecocli', createArgs, { cwd: process.cwd(), timeout: CREATE_TIMEOUT_MS });
  const ok = fs.existsSync(path.join(projectPath, 'build-profile.json5'));
  if (!ok) {
    console.error('Error: devecocli create failed to scaffold verification project.');
    const out = stripAnsi(`${res.stdout || ''}\n${res.stderr || ''}`);
    if (out.trim().length > 0) {
      console.error('---- create output ----');
      console.error(out.split(/\r?\n/).slice(-20).join('\n'));
    }
    process.exit(2);
  }
}

function verifyStandalone(files, options) {
  const timeoutMs = options.timeout || DEFAULT_BUILD_TIMEOUT_MS;

  // 1. 校验输入文件
  const absFiles = [];
  for (const f of files) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      console.error(`Error: file not found: ${f}`);
      process.exit(2);
    }
    if (!abs.toLowerCase().endsWith('.ets')) {
      console.error(`Error: not an .ets file: ${f}`);
      process.exit(2);
    }
    absFiles.push(abs);
  }

  // 2. 准备工作目录与临时工程
  const userProvidedWorkDir = Boolean(options.workDir);
  let workDir = userProvidedWorkDir ? path.resolve(options.workDir) : '';
  if (!userProvidedWorkDir) {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-verify-'));
  } else {
    fs.mkdirSync(workDir, { recursive: true });
  }
  const projectPath = path.join(workDir, PROJECT_NAME);

  let scaffolded = false;
  if (!fs.existsSync(path.join(projectPath, 'build-profile.json5'))) {
    if (fs.existsSync(projectPath)) {
      rmRecursive(projectPath); // 清理不完整工程
    }
    console.log('>>> 脚手架临时验证工程（首次约 10-60s）...');
    scaffoldProject(projectPath, options.apiLevel);
    scaffolded = true;
  }

  const verifyDir = path.join(projectPath, 'entry', 'src', 'main', 'ets', 'verify');
  rmRecursive(verifyDir);
  fs.mkdirSync(verifyDir, { recursive: true });

  // 3. 复制文件（保留相对目录结构，支持文件间相对导入）
  const ancestor = commonAncestor(absFiles);
  const copiedMap = []; // { dest: 绝对路径, src: 原文件, rel: posix 相对路径 }
  for (const src of absFiles) {
    const rel = toPosix(path.relative(ancestor, src));
    const dest = path.join(verifyDir, ...rel.split('/'));
    copyRecursive(src, dest);
    copiedMap.push({ dest, src, rel });
  }

  // 4. 生成入口页，side-effect import 接入构建图
  const importLines = copiedMap
    .map((c) => `import '../verify/${c.rel.slice(0, -'.ets'.length)}';`)
    .join('\n');
  const indexContent = [
    '// Auto-generated by verify-arkts.cjs — syntax verification entry. Do not edit.',
    importLines,
    '',
    '@Entry',
    '@Component',
    'struct Index {',
    '  build() {',
    '    Column() {',
    "      Text('verify')",
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  const pagesDir = path.join(projectPath, 'entry', 'src', 'main', 'ets', 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, 'Index.ets'), indexContent, 'utf-8');

  console.log('=== ArkTS 编译验证（独立模式） ===');
  console.log(`文件: ${absFiles.length} 个`);
  console.log(`临时工程: ${projectPath}${scaffolded ? '' : '（复用）'}`);
  console.log('');

  // 5. 构建
  const res = runCli('devecocli', ['build'], { cwd: projectPath, timeout: timeoutMs });
  if (res.error && res.error.code === 'ETIMEDOUT') {
    cleanup(workDir, userProvidedWorkDir, options.keep);
    console.error(`Error: build timed out after ${timeoutMs}ms`);
    process.exit(2);
  }
  const parsed = parseBuildOutput(`${res.stdout || ''}\n${res.stderr || ''}`);

  // 6. 错误文件路径与消息中的临时工程路径映射回源文件
  //    兼容：绝对路径、工程相对路径、编译器拼接的异常路径（temp工程路径+源文件路径）
  for (const err of parsed.errors) {
    const errPath = toPosix(err.file);
    let mapped = false;
    for (const c of copiedMap) {
      const marker = `entry/src/main/ets/verify/${c.rel}`;
      const srcPosix = toPosix(c.src);
      if (errPath === marker || errPath.endsWith(`/${marker}`)
        || errPath === srcPosix || errPath.endsWith(`/${srcPosix}`)) {
        err.file = c.src;
        mapped = true;
      }
      // 消息内嵌的临时路径替换为源文件路径
      err.message = err.message.split(marker).join(c.src);
      err.message = err.message.split(toPosix(c.dest)).join(c.src);
    }
    if (!mapped && err.file.length > 0) {
      // 非被验证文件内部的错误（如生成入口页/依赖），原样展示
      err.file = err.file.replace(projectPath + path.sep, '');
    }
  }

  cleanup(workDir, userProvidedWorkDir, options.keep);
  reportResult(parsed, { userProvidedWorkDir, workDir, keep: options.keep });
}

function cleanup(workDir, userProvidedWorkDir, keep) {
  if (userProvidedWorkDir) {
    return; // 用户指定目录：保留工程供复用
  }
  if (!keep) {
    rmRecursive(workDir);
  }
}

// ── 结果输出 ─────────────────────────────────────────────

function reportResult(parsed, standaloneInfo) {
  if (parsed.successful && parsed.errors.length === 0) {
    console.log('✅ 验证通过：BUILD SUCCESSFUL，无 ArkTS 编译错误');
    if (standaloneInfo && !standaloneInfo.userProvidedWorkDir && standaloneInfo.keep) {
      console.log(`临时工程已保留: ${standaloneInfo.workDir}`);
    }
    process.exit(0);
  }

  const errorCount = parsed.errors.length;
  console.log(`❌ 验证失败：${errorCount > 0 ? `${errorCount} 个编译错误` : '构建失败'}`);
  if (errorCount > 0) {
    console.log('');
    const grouped = new Map();
    for (const e of parsed.errors) {
      const loc = e.line > 0 ? `${e.file}:${e.line}:${e.col}` : (e.file.length > 0 ? e.file : '(位置未知)');
      const key = `[${e.rule}] ${loc}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(e);
    }
    for (const [key, errs] of grouped) {
      for (const e of errs) {
        console.log(`  ${key}`);
        console.log(`    ${e.message}`);
      }
    }
  } else if (parsed.rawTail.trim().length > 0) {
    console.log('');
    console.log('---- 构建输出（末尾） ----');
    console.log(parsed.rawTail);
  }
  process.exit(1);
}

// ── 主流程 ───────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  const hasFiles = Array.isArray(args.files) && args.files.length > 0;
  const hasProject = typeof args.project === 'string' && args.project.trim().length > 0;

  if (hasProject && hasFiles) {
    usageAndExit('--project and --files are mutually exclusive');
  }
  if (!hasProject && !hasFiles) {
    usageAndExit('provide --project <dir> or --files <a.ets> [...]');
  }

  checkDevecocli();

  if (hasProject) {
    verifyProject(path.resolve(args.project), args.timeout || DEFAULT_BUILD_TIMEOUT_MS);
  } else {
    verifyStandalone(args.files, args);
  }
}

main();
