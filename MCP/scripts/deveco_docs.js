#!/usr/bin/env node
/**
 * @tool deveco_docs
 * @description 检索 HarmonyOS 官方 API 文档（devecocli docs 封装）。用于编写 ArkTS 代码时查证系统 API：方法签名、参数/返回值、import 路径（@kit.* / @ohos.*）、枚举成员、权限、系统能力、错误码。action=search 按关键词检索；action=read 按 documentId 读取文档（支持 section 精确定位小节）。
 * @param action: string - 操作类型 (search|read)
 * @param keywords: string - search 模式：检索关键词，多个用空格分隔（如 "ImageFit" 或 "AudioRenderer createAudioRenderer"）
 * @param catalog: string - search 模式：文档类别，默认 harmonyos-references（API 参考）
 * @param limit: number - search 模式：返回条数上限，默认 10
 * @param documentId: string - read 模式：文档 ID（来自 search 结果的 documentId 字段）
 * @param section: string - read 模式：可选，按小节名精确定位（如 "ImageFit"），返回该小节内容而非全文
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 第一个参数是 JSON 字符串（MCP Gateway ScriptExecutor 约定）
const argsJson = process.argv[2] || '{}';
let args = {};
try {
  args = JSON.parse(argsJson);
} catch (e) {
  console.error(`[deveco_docs] 参数解析失败: ${e.message}`);
  process.exit(1);
}

// ─── devecocli 定位 ───
// 优先 DEVECO_CLI_PATH。Windows 下 devecocli 是 .cmd，经 cmd 转手会破坏 UTF-8 中文 documentId，
// 因此 Windows 下直接定位 node_modules/@deveco/deveco-cli/dist/cli.js 并用 node 直接运行（已验证 UTF-8 正常）。
function resolveCliJs() {
  // 1. 环境变量明确指定
  const envCli = process.env.DEVECO_CLI_PATH;
  if (envCli) return envCli;

  // 2. 从 PATH 中解析 devecocli 所在目录（node 安装目录）
  if (process.platform === 'win32') {
    const pathDirs = (process.env.Path || process.env.PATH || '').split(';');
    for (const dir of pathDirs) {
      if (!dir.trim()) continue;
      const candidate = path.join(dir, 'node_modules', '@deveco', 'deveco-cli', 'dist', 'cli.js');
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch { /* 忽略 */ }
    }
  }

  // 3. 回退：通过 devecocli 命令定位（非 Windows 或无 cli.js 时）
  return null;
}

const CLI_JS = resolveCliJs();

function buildDevecoCommand() {
  if (CLI_JS) {
    // node 直接运行 cli.js，UTF-8 保留中文 documentId
    return { cmd: process.execPath, args: [CLI_JS] };
  }
  if (process.platform === 'win32') {
    return { cmd: 'cmd.exe', args: ['/c', 'devecocli'] };
  }
  return { cmd: 'devecocli', args: [] };
}

const DEVECO = buildDevecoCommand();

/**
 * 执行 devecocli 命令。
 * @param {string[]} args - 命令参数（不含 devecocli 本身）
 * @returns {{ stdout: string, stderr: string, status: number }}
 */
function runDeveco(...args) {
  const shellArgs = [...DEVECO.args, ...args];
  const res = spawnSync(DEVECO.cmd, shellArgs, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true
  });
  return {
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    status: res.status
  };
}

/**
 * search 降噪：对 title/sectionTitle 做关键词相关性排序。
 * 命中 title 的排在命中 sectionTitle 之前，多个关键词全命中优先。
 * @param {Array} results
 * @param {string[]} keywords
 */
function rankResults(results, keywords) {
  return results
    .map((r) => {
      const title = r.title || '';
      const section = r.sectionTitle || '';
      const titleHits = keywords.filter((k) => title.toLowerCase().includes(k.toLowerCase()));
      const sectionHits = keywords.filter((k) => section.toLowerCase().includes(k.toLowerCase()));
      let score = 0;
      if (titleHits.length > 0) score += 100;
      if (sectionHits.length > 0) score += 50;
      score += titleHits.length * 10;
      score += sectionHits.length * 5;
      score += (r.matchType === 'filename' ? 20 : 0);
      return { ...r, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...rest }) => rest);
}

/**
 * read 模式：按小节名精确定位文档内容。
 * 从文档中查找 `#### <section>` 或 `## <section>` 标题，返回该小节到下一个同级/上级标题的内容。
 * @param {string} content - 文档全文
 * @param {string} section - 小节名
 * @returns {string|null}
 */
function extractSection(content, section) {
  const lines = content.split(/\r?\n/);
  const target = section.trim();
  // 优先匹配精确的 <h4> 小节；若无则匹配 <h3> 或 <h2>
  const levels = [4, 3, 2];
  let startIdx = -1;
  let startLevel = 0;
  for (const level of levels) {
    const prefix = '#'.repeat(level) + ' ';
    startIdx = lines.findIndex((l) => l.trim().startsWith(prefix) && l.trim().slice(level + 1).trim() === target);
    if (startIdx >= 0) {
      startLevel = level;
      break;
    }
  }
  // 也支持模糊匹配（小节名包含目标，如 "ImageFit" 匹配 "#### ImageFit"）
  if (startIdx < 0) {
    for (const level of levels) {
      const prefix = '#'.repeat(level) + ' ';
      startIdx = lines.findIndex((l) => l.trim().startsWith(prefix) && l.trim().slice(level + 1).trim().includes(target));
      if (startIdx >= 0) {
        startLevel = level;
        break;
      }
    }
  }
  if (startIdx < 0) {
    return null;
  }
  // 截取到下一个同级或更上级标题
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#{1,4} /.test(l)) {
      const level = l.match(/^(#+)/)[1].length;
      if (level <= startLevel) {
        endIdx = i;
        break;
      }
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

// ─── 主逻辑 ────────────────────────────────────────────────────────────────
const action = args.action || 'search';

if (action === 'search') {
  const keywords = String(args.keywords || '').trim();
  if (!keywords) {
    console.error('[deveco_docs] search 模式需要 keywords 参数');
    process.exit(1);
  }
  const catalog = String(args.catalog || 'harmonyos-references');
  const limit = Number(args.limit) || 10;

  const res = runDeveco('docs', 'search', ...keywords.split(/\s+/), '--catalog', catalog, '--format', 'json', '--limit', String(limit));

  if (res.status !== 0) {
    console.error(`[deveco_docs] devecocli docs search 失败 (exit=${res.status}): ${res.stderr || res.stdout}`);
    process.exit(1);
  }

  let results = [];
  try {
    results = JSON.parse(res.stdout);
  } catch (e) {
    // 非 JSON 输出（可能是 devecocli 版本差异），直接原样返回
    console.log(res.stdout || '(空结果)');
    process.exit(0);
  }

  if (results.length === 0) {
    console.log('未找到相关文档。该 API 可能不是 HarmonyOS 系统 API（如测试框架 hypium、第三方库自身 API），或关键词不准确。');
    process.exit(0);
  }

  const ranked = rankResults(results, keywords.split(/\s+/));
  const output = {
    tool: 'deveco_docs',
    action: 'search',
    query: keywords,
    total: ranked.length,
    results: ranked.map((r) => ({
      title: r.title,
      documentId: r.documentId,
      sectionTitle: r.sectionTitle || '',
      snippet: r.snippet || ''
    }))
  };
  console.log(JSON.stringify(output, null, 2));
} else if (action === 'read') {
  const documentId = String(args.documentId || '').trim();
  if (!documentId) {
    console.error('[deveco_docs] read 模式需要 documentId 参数（来自 search 结果）');
    process.exit(1);
  }

  const res = runDeveco('docs', 'read', documentId);

  if (res.status !== 0) {
    console.error(`[deveco_docs] devecocli docs read 失败 (exit=${res.status}): ${res.stderr || res.stdout}`);
    process.exit(1);
  }

  const content = res.stdout;
  let body = content;
  let sectionName = null;

  // 按小节精确定位
  if (args.section) {
    const extracted = extractSection(content, String(args.section));
    if (extracted) {
      body = extracted;
      sectionName = String(args.section);
    }
  }

  const output = {
    tool: 'deveco_docs',
    action: 'read',
    documentId,
    section: sectionName,
    contentLength: body.length,
    content: body.slice(0, 20000) // 防超大文档，截断保护
  };
  console.log(JSON.stringify(output, null, 2));
} else {
  console.error(`[deveco_docs] 未知 action: ${action}，支持 search|read`);
  process.exit(1);
}