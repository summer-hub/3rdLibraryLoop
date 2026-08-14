#!/usr/bin/env node
/**
 * code-linter.cjs — ArkTS Code Linter 静态代码检查脚本。
 *
 * 背景：`db/task/task_msrk7qzjwmvl/stepId7_loop0_Summary_0.md` 沉淀的 Lint 校验经验：
 *   - 项目缺失 `code-linter.json5` 时 `devecocli check lint` 报
 *     `--config-path does not exist`，需先在工程根创建推荐规则集；
 *   - `devecocli check lint` 仅接受 **1 个路径参数**（文件或目录），不支持多文件并列；
 *   - `--format json --output-path <file>` 输出结构为 `{ "issues": [{ file, line, column, severity, rule, message }] }`；
 *   - `arkts-no-any-unknown` 是 ArkTS **编译器规则**（CompileArkTS 强制），**不是** Code Linter 规则，
 *     `.ets` 的 any/unknown 检查依赖 `devecocli build` 编译验证；Linter 中对应规则
 *     `@typescript-eslint/no-explicit-any` 仅对 `.js/.ts` 生效；
 *   - `001_` 数字前缀文件名会触发 `@hw-stylistic/file-naming-convention` **Warning**（不阻塞编译）。
 *
 * 本脚本在编译验证**之前**执行静态检查，把能静态发现的问题前置到编译循环之外：
 *   1. 探测 devecocli 环境
 *   2. 检测/创建工程根 `code-linter.json5`（推荐规则集）
 *   3. 对目标路径执行 `devecocli check lint <target> --format json --output-path <raw>`
 *   4. 解析 `{ issues }`，按 severity 统计并标注关键规则
 *   5. 输出 `code-linter-report.json`（供 SKILL 报告引用）
 *
 * 设计原则：
 *   - 零第三方依赖；纯 Node.js + 子进程执行
 *   - Windows PowerShell 与跨平台兼容（devecocli 调用经 shell，支持 exe/.cmd/.bat）
 *   - lint 不经过 hvigor daemon，无 build.ps1 阻塞问题，但仍设超时兜底
 *   - 只写工程根下的 `code-linter.json5`（仅当缺失）、`code-linter-raw.json`（lint JSON 原始输出）、
 *     `code-linter-report.json`（解析后的稳定报告）
 *
 * 用法:
 *   node code-linter.cjs --source <工程根> [--target <相对目录|文件>] [--dry-run] [--help]
 *
 *   示例:
 *     node code-linter.cjs --source D:/proj/ohos_ijkplayer --target entry/src/main/ets/pages
 *     node code-linter.cjs --source D:/proj/ohos_ijkplayer --target entry/src/ohosTest/ets/test
 *     node code-linter.cjs --source D:/proj/ohos_ijkplayer --dry-run
 *
 * 退出码:
 *   0  捕捉成功且无 Error 级 issue（可进入编译验证）
 *   2  存在 Error 级 issue（需修复后重跑）
 *   1  参数/环境错误（devecocli 不可用、--source 无效、lint 执行失败）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── 日志（统一 [code-linter] 前缀） ──────────────────────────
const PREFIX = '[code-linter]';

function info(msg) {
  console.log(`${PREFIX} ${msg}`);
}

function ok(msg) {
  console.log(`${PREFIX} [OK] ${msg}`);
}

function warn(msg) {
  console.log(`${PREFIX} [WARN] ${msg}`);
}

function error(msg) {
  console.error(`${PREFIX} [ERROR] ${msg}`);
}

// ── 工具函数 ────────────────────────────────────────────────

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
 * 探测 devecocli 是否可用。Windows 下经 shell 以兼容 devecocli.cmd/devecocli.bat。
 * @returns {string|null} devecocli 版本字符串；不可用返回 null
 */
function checkDevecoCli() {
  try {
    const out = execFileSync('devecocli', ['--version'], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
      timeout: 30000,
    });
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.length > 0 ? lines[lines.length - 1] : 'unknown';
  } catch {
    return null;
  }
}

/**
 * devecocli 引擎目录探测（用于 build.ps1 之外的独立引擎时定位）。
 * 本脚本直接用 PATH 中的 devecocli，无需定位 IDE 目录。
 * @param {string} devecoCliVersion
 * @returns {string|null}
 */
function lookupIdeDir(devecoCliVersion) {
  void devecoCliVersion;
  return null;
}

// ── 推荐 code-linter.json5 配置 ──────────────────────────────
// 来源: db/task/task_msrk7qzjwmvl/stepId7_loop0_Summary_0.md §3
const RECOMMENDED_LINTER_CONFIG = `{
  "files": ["**/*.ets", "**/*.ts"],
  "ignore": ["**/node_modules/**/*", "**/oh_modules/**/*", "**/build/**/*"],
  "ruleSet": [
    "plugin:@typescript-eslint/recommended",
    "plugin:@performance/recommended",
    "plugin:@correctness/recommended",
    "plugin:@security/recommended",
    "plugin:@hw-stylistic/recommended",
    "plugin:@cross-device-app-dev/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error"
  }
}
`;

/**
 * 检测工程根是否已有 code-linter.json5；缺失则写入推荐规则集。
 * @param {string} projectRoot
 * @returns {{created: boolean, existed: boolean, configPath: string}}
 */
function ensureLinterConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'code-linter.json5');
  const existed = fs.existsSync(configPath);
  if (!existed) {
    fs.writeFileSync(configPath, RECOMMENDED_LINTER_CONFIG, 'utf-8');
    return { created: true, existed: false, configPath };
  }
  return { created: false, existed: true, configPath };
}

// ── lint 执行与解析 ──────────────────────────────────────────

/**
 * 执行 devecocli check lint（仅传 1 个路径，满足命令路径参数限制）。
 * 不走 hvigor daemon，无 build.ps1 阻塞问题，但仍设超时兜底。
 * @param {string} projectRoot
 * @param {string} targetAbs 目标目录或文件（绝对路径）
 * @param {string} rawOutPath JSON 原始输出文件
 * @returns {{ok: boolean, message: string}}
 */
function runLint(projectRoot, targetAbs, rawOutPath) {
  try {
    execFileSync(
      'devecocli',
      ['check', 'lint', targetAbs, '--format', 'json', '--output-path', rawOutPath],
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        shell: process.platform === 'win32',
        timeout: 300000,
        stdio: 'inherit',
      }
    );
    return { ok: true, message: '' };
  } catch (e) {
    // devecocli check lint 对存在 Error 时会返回非 0，但 JSON 输出仍会写入文件
    const msg = String((e && (e.stderr || e.message)) || '').trim().slice(0, 300);
    if (fs.existsSync(rawOutPath)) {
      return { ok: true, message: `lint 命令退出码非 0（可能含 Error 级 issue），已读取 JSON 输出: ${msg}` };
    }
    return { ok: false, message: msg || '未知错误' };
  }
}

/**
 * 解析 lint JSON 原始输出，按严重级别与规则统计。
 * @param {string} rawContent
 * @returns {{issues: Array<Record<string, any>>, errorCount: number, warningCount: number, infoCount: number, fileCount: number}}
 */
function parseLintResult(rawContent) {
  let data;
  try {
    data = JSON.parse(rawContent);
  } catch {
    data = { issues: [] };
  }
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const errorCount = issues.filter((i) => i.severity === 'Error' || i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'Warning' || i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'Information' || i.severity === 'info').length;
  const fileSet = new Set();
  for (const i of issues) {
    if (i && i.file) fileSet.add(i.file);
  }
  return {
    issues,
    errorCount,
    warningCount,
    infoCount,
    fileCount: fileSet.size,
  };
}

/**
 * 供报告读取的目标路径摘要（相对 source 或以 source 前缀开头）。
 * @param {string} projectRoot
 * @param {string} targetAbs
 * @returns {string}
 */
function summarizeTarget(projectRoot, targetAbs) {
  const rel = path.relative(projectRoot, targetAbs);
  return rel && !rel.startsWith('..') ? rel : targetAbs;
}

// ── 主流程 ──────────────────────────────────────────────────

/**
 * 打印用法。
 */
function usage() {
  console.log(`
用法:
  node code-linter.cjs --source <工程根> [--target <相对目录|文件>] [--dry-run] [--help]

选项:
  --source <路径>   目标鸿蒙工程根目录（必填）
  --target <路径>   要检查的目录或文件（相对 --source 解析；缺省 entry/src/main/ets）
  --dry-run         只检测 devecocli 与 code-linter.json5 配置，预览 check lint 命令，不执行不落盘
  --help            显示本帮助

退出码: 0=无 Error 可进入编译  2=存在 Error 需修复  1=环境/参数错误
`);
}

/**
 * 主流程。
 */
function main() {
  const args = parseArgs();

  if (args.help === true) {
    usage();
    process.exit(0);
  }

  if (!args.source || args.source === true) {
    error('缺少 --source 参数。用法: node code-linter.cjs --source <工程根> [--target <相对目录|文件>]');
    usage();
    process.exit(1);
  }

  const projectRoot = path.resolve(String(args.source));
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    error(`--source 路径不存在或非目录: ${projectRoot}`);
    process.exit(1);
  }

  const dryRun = args['dry-run'] === true;

  // 目标路径解析：相对路径基于 --source
  let targetAbs;
  if (args.target && args.target !== true) {
    targetAbs = path.isAbsolute(String(args.target))
      ? path.resolve(String(args.target))
      : path.resolve(projectRoot, String(args.target));
  } else {
    targetAbs = path.join(projectRoot, 'entry', 'src', 'main', 'ets');
  }
  if (!fs.existsSync(targetAbs)) {
    error(`目标路径不存在: ${targetAbs}`);
    error('请用 --target 指定存在的目录或文件（如 entry/src/main/ets/pages，或 entry/src/ohosTest/ets/test）。');
    process.exit(1);
  }

  info(`开始 Code Linter 静态检查: ${projectRoot}`);
  info(`检查目标: ${summarizeTarget(projectRoot, targetAbs)}`);
  info(`模式: ${dryRun ? 'DRY-RUN（仅检测配置，不执行 lint、不落盘）' : '执行 lint 并输出报告'}`);

  // 0. devecocli 环境探测
  const devecoCliVersion = checkDevecoCli();
  if (!devecoCliVersion) {
    error('devecocli 不可用（devecocli --version 执行失败）。');
    error('请确保 DevEco Studio 命令行工具在 PATH 中（详见 XTSExecutionSkill 步骤 2 第一层构建环境检查）。');
    process.exit(1);
  }
  ok(`devecocli 可用，版本: ${devecoCliVersion}`);

  // 1. config 检测（dry-run 时仅检测不创建）
  const configPath = path.join(projectRoot, 'code-linter.json5');
  const configExists = fs.existsSync(configPath);
  if (dryRun) {
    if (!configExists) {
      warn(`工程根缺少 code-linter.json5（非 dry-run 时将被创建并写入推荐规则集，否则 devecocli check lint 会报 --config-path does not exist）: ${configPath}`);
    } else {
      ok(`code-linter.json5 已存在: ${configPath}`);
    }
  } else {
    const cfg = ensureLinterConfig(projectRoot);
    if (cfg.created) {
      warn(`工程根缺少 code-linter.json5，已创建推荐规则集: ${cfg.configPath}`);
      warn('（原因为项目无该文件时 devecocli check lint 会报 --config-path does not exist）');
    } else {
      ok(`code-linter.json5 已存在: ${cfg.configPath}`);
    }
  }

  // 2. 预览命令（dry-run 结束）
  const rawOutPath = path.join(projectRoot, 'code-linter-raw.json');
  if (dryRun) {
    info('=== DRY-RUN 计划执行（未运行 lint、未写入任何文件） ===');
    info(`  devecocli check lint "${summarizeTarget(projectRoot, targetAbs)}" --format json --output-path code-linter-raw.json`);
    info('  → 将解析 issues 并按 severity 统计，输出 code-linter-report.json');
    process.exit(0);
  }

  // 3. 执行 lint
  info('执行 devecocli check lint ...');
  const run = runLint(projectRoot, targetAbs, rawOutPath);
  if (!run.ok) {
    error('devecocli check lint 执行失败。');
    error(`  ${run.message}`);
    process.exit(1);
  }
  if (run.message) {
    warn(run.message);
  }

  // 4. 解析 JSON 并统计
  const rawContent = readFileSafe(rawOutPath) || '{"issues":[]}';
  const result = parseLintResult(rawContent);

  info(`=== Code Linter 统计 ===`);
  info(`  Error:        ${result.errorCount}`);
  info(`  Warning:      ${result.warningCount}`);
  info(`  Information:  ${result.infoCount}`);
  info(`  涉及文件数:    ${result.fileCount}`);

  // 5. 关键规则标注
  const errorIssues = result.issues.filter((i) => i.severity === 'Error' || i.severity === 'error');
  for (const i of errorIssues) {
    error(`  ${i.file}:${i.line}:${i.column} [${i.rule}] ${i.message}`);
  }
  const anyUnknown = errorIssues.filter((i) => /any|unknown/i.test(String(i.rule || '')));
  if (anyUnknown.length > 0) {
    warn('命中 any/unknown 相关 rule（如 @typescript-eslint/no-explicit-any）。');
    warn('注意: 该 rule 仅对 .js/.ts 生效；.ets 的 any/unknown 由 ArkTS 编译器强制（arkts-no-any-unknown），需 devecocli build 验证确认。');
  }
  const fileNamingWarnings = result.issues.filter(
    (i) => /@hw-stylistic\/file-naming-convention/i.test(String(i.rule || ''))
  );
  for (const i of fileNamingWarnings) {
    warn(`  [Warning] ${i.file}:${i.line} [@hw-stylistic/file-naming-convention] ${i.message}`);
  }
  if (fileNamingWarnings.length > 0) {
    warn('检测到 @hw-stylistic/file-naming-convention Warning（常见于 001_ 等数字前缀文件名，要求大驼峰命名）。');
    warn('该警告不阻塞编译；若需零警告可改为纯大驼峰文件名，但不属于编译阻断项。');
  }

  // 6. 输出解析后的稳定报告
  const report = {
    tool: 'code-linter',
    timestamp: new Date().toISOString(),
    sourcePath: projectRoot,
    target: summarizeTarget(projectRoot, targetAbs),
    devecoCliVersion,
    config: {
      existed: configExists,
      created: !configExists,
      configPath,
    },
    summary: {
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      infoCount: result.infoCount,
      fileCount: result.fileCount,
    },
    errors: errorIssues.map((i) => ({
      file: String(i.file || ''),
      line: i.line != null ? String(i.line) : '',
      column: i.column != null ? String(i.column) : '',
      rule: String(i.rule || ''),
      message: String(i.message || ''),
    })),
    warnings: result.issues
      .filter((i) => i.severity === 'Warning' || i.severity === 'warning')
      .map((i) => ({
        file: String(i.file || ''),
        line: i.line != null ? String(i.line) : '',
        column: i.column != null ? String(i.column) : '',
        rule: String(i.rule || ''),
        message: String(i.message || ''),
      })),
  };
  const reportPath = path.join(projectRoot, 'code-linter-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  ok(`检查报告已写入: ${reportPath}`);

  // 7. 结果判定
  if (result.errorCount > 0) {
    error(`存在 ${result.errorCount} 个 Error 级 issue，需修复后重跑本脚本；修复方法参考对应 SKILL 的编译修复循环与自查清单。`);
    process.exit(2);
  }
  ok('Code Linter 静态检查通过（0 Error）。可以进入编译验证。');
  process.exit(0);
}

main();