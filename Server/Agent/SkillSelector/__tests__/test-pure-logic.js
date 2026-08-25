/**
 * test-pure-logic.js — 纯逻辑自测（不调用 LLM，不依赖网络）
 *
 * 验证：
 *   1. tokenizer.tokenize / normalizeList 分词正确
 *   2. bm25.BM25 打分：相关文档分数 > 不相关文档
 *   3. fuzzyMatcher.fuzzyMatch 单路 BM25 召回正确
 *   4. fuzzyMatcher legacy fallback：BM25 全零时回退子串匹配
 *   5. skillScanner.parseFrontmatter frontmatter 解析
 *   6. skillScanner.scanSkills 真实目录扫描
 *   7. prompts.renderTemplate 模板替换
 *   8. llmClient.isTransientError / retryDelay 错误恢复逻辑
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { tokenize, normalizeList, BM25, bm25Scores, fuzzyMatch } from '../matcher/fuzzyMatcher.js';
import { parseFrontmatter, scanSkills } from '../scanner/skillScanner.js';
import { isTransientError, retryDelay } from '../llm/llmClient.js';
import { renderTemplate } from '../llm/prompts.js';

const SKILL_DIRECTORY = path.resolve(__dirname, '..', '..', '..', 'Skills');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

async function main() {
  console.log('=== 纯逻辑自测（不依赖 LLM）===\n');

  // ─── 测试 1：tokenizer ─────────────────────────────────────────────────────
  console.log('[1] tokenizer');
  const tokens = tokenize('分析 libcurl 的鸿蒙化 feasibility');
  assert(tokens.includes('libcurl'), `分词包含 libcurl：${tokens.join(',')}`);
  assert(tokens.includes('鸿蒙化'), `分词包含中文 鸿蒙化`);
  assert(!tokens.includes('of'), '停用词 of 被过滤');
  const nl = normalizeList(['C++', ' 鸿蒙 ', 'C++']);
  assert(nl.length === 3 && nl[0] === 'c++', `normalizeList 规整正确：${nl.join(',')}`);
  console.log();

  // ─── 测试 2：BM25 打分 ─────────────────────────────────────────────────────
  console.log('[2] BM25 打分');
  const docs = [
    'cpp porting analysis c++ harmonyos 鸿蒙化可行性分析',
    'flutter code check 代码检视 dart',
    'react native rn code check 代码检视',
    'cpp compile 编译 c++',
    'library interface analyzer 接口分析',
  ];
  const scores = bm25Scores('cpp harmonyos 鸿蒙化', docs);
  assert(scores[0] > scores[1], `相关文档分数 > 不相关文档：${scores[0].toFixed(2)} > ${scores[1].toFixed(2)}`);
  assert(scores[0] > scores[3], `top1 是 C++ 分析（非 C++ 编译）：${scores[0].toFixed(2)} > ${scores[3].toFixed(2)}`);
  assert(scores[0] > 0, `top1 分数 > 0：${scores[0].toFixed(2)}`);

  // BM25 类复用
  const bm25 = new BM25(docs);
  const s1 = bm25.scores('cpp');
  const s2 = bm25.scores('flutter dart');
  assert(s1[0] > 0, `单次查询 cpp 命中 C++ 文档：${s1[0].toFixed(2)}`);
  assert(s2[1] > s2[0], `flutter 查询命中 Flutter 文档：${s2[1].toFixed(2)} > ${s2[0].toFixed(2)}`);
  console.log();

  // ─── 测试 3：fuzzyMatch 单路 BM25 召回 ────────────────────────────────────
  console.log('[3] fuzzyMatch 单路 BM25 召回');
  const mockSkills = [
    { dirName: 'CPPAnalysisSkill', name: 'cpp-porting-analysis', description: 'C++ 鸿蒙化分析 可行性', category: 'harmonyos-porting', language: 'C/C++', searchableText: 'cpp porting analysis c++ 鸿蒙化分析可行性 harmonyos porting'.toLowerCase() },
    { dirName: 'flutter-code-check', name: 'flutter-code-check', description: 'Flutter 代码检视', category: 'code-check', language: 'Dart', searchableText: 'flutter code check 代码检视 dart'.toLowerCase() },
    { dirName: 'CPPCompileSkill', name: 'cpp-compile', description: 'C++ 编译', category: 'compile', language: 'C/C++', searchableText: 'cpp compile 编译 c++'.toLowerCase() },
    { dirName: 'CPPPortingSkill', name: 'cpp-porting', description: 'C++ 移植', category: 'porting', language: 'C/C++', searchableText: 'cpp porting 移植 c++'.toLowerCase() },
    { dirName: 'LibraryInterface', name: 'library-interface-analyzer', description: '接口分析', category: 'interface', language: 'JS/TS', searchableText: 'library interface analyzer 接口分析'.toLowerCase() },
    { dirName: 'RNCodeCheck', name: 'rn-code-check', description: 'React Native 代码检视', category: 'code-check', language: 'JS/RN', searchableText: 'react native code check 代码检视'.toLowerCase() },
  ];

  const analysis = {
    intent: '分析 libcurl 这个 C++ 开源库能否移植到鸿蒙平台',
    keywords: ['cpp', 'harmonyos', '鸿蒙', '移植', '分析', 'porting', 'c++'],
    constraints: ['C++ 开源库', '鸿蒙平台'],
    techStack: ['c++', 'harmonyos'],
  };

  const matched = await fuzzyMatch(analysis, mockSkills, { topK: 5 });
  assert(matched.length === 5, `召回数量为 5（实际 ${matched.length}）`);
  assert(matched.length > 0 && matched[0].score > 0, `top1 有分数：${matched[0]?.score?.toFixed(2)}`);
  const topDirNames = matched.map((m) => m.skill.dirName);
  console.log(`  召回排序：${topDirNames.map((n, i) => `${i + 1}.${n}(${matched[i].score.toFixed(1)})`).join(' > ')}`);
  // C++ 相关的 SKILL 应该排在前面
  const top2 = topDirNames.slice(0, 2);
  assert(top2.includes('CPPAnalysisSkill'), 'CPPAnalysisSkill 进入 top2');
  assert(top2.every((n) => n.toLowerCase().includes('cpp')), 'top2 全是 C++ 相关 SKILL');
  console.log();

  // ─── 测试 4：legacy fallback（BM25 全零时回退）────────────────────────────────
  console.log('[4] legacy fallback');
  const noOverlapAnalysis = {
    intent: 'aaaa bbbb',
    keywords: ['xxxx', 'yyyy'],
    constraints: [],
    techStack: ['zzzz'],
  };
  const fallbackMatched = await fuzzyMatch(noOverlapAnalysis, mockSkills, { topK: 3 });
  // BM25 全零 → 回退到 legacy 子串匹配；但这里 keywords 也无重叠，所以可能全零
  // 验证：不抛异常，返回结果（可能全零分但长度 ≤ 3）
  assert(Array.isArray(fallbackMatched), 'fallback 返回数组');
  assert(fallbackMatched.length <= 3, `fallback 返回数量 ≤ 3：${fallbackMatched.length}`);
  console.log();

  // ─── 测试 5：parseFrontmatter ──────────────────────────────────────────────
  console.log('[5] parseFrontmatter');
  const sampleMd = `---
name: cpp-porting-analysis
description: 对 C++ 开源库进行鸿蒙化可行性分析。
license: MIT
metadata:
  author: lalhan
  version: "2.2.0"
  category: harmonyos-porting
  language: C/C++
compatibility: 适用于任意托管在 Git 仓库的 C/C++ 开源库。
---

# 正文标题`;
  const fm = parseFrontmatter(sampleMd);
  assert(fm.name === 'cpp-porting-analysis', `name 解析正确：${fm.name}`);
  assert(fm.license === 'MIT', 'license 解析正确');
  assert(fm.metadata && fm.metadata.version === '2.2.0', `metadata.version 去引号：${fm.metadata?.version}`);
  assert(fm.metadata && fm.metadata.category === 'harmonyos-porting', 'metadata.category 正确');
  assert(fm.metadata && fm.metadata.language === 'C/C++', `metadata.language 正确：${fm.metadata?.language}`);

  // 块标量：折叠块（>-）多行拼装为单行（行间补一个空格）
  const foldedMd = `---
name: folded-skill
description: >-
  第一行折叠内容。
  第二行与第一行拼接。
  第三行单独成句。
metadata:
  author: test
  version: "1.0"
---`;
  const foldedFm = parseFrontmatter(foldedMd);
  assert(
    foldedFm.description === '第一行折叠内容。 第二行与第一行拼接。 第三行单独成句。',
    `折叠块标量（>-）解析为空格拼接：${JSON.stringify(foldedFm.description)}`
  );
  assert(foldedFm.metadata && foldedFm.metadata.author === 'test', '块标量后 metadata 嵌套字段不被块吞并');
  assert(foldedFm.metadata && foldedFm.metadata.version === '1.0', '块标量后 metadata.version 解析正确');

  // 块标量：字面块（|）保留换行
  const literalMd = `---
name: literal-skill
description: |
  第一行保留。
  第二行另起一行。
---`;
  const literalFm = parseFrontmatter(literalMd);
  assert(
    literalFm.description === '第一行保留。\n第二行另起一行。\n',
    `字面块标量（|）保留换行（clip 尾换行）：${JSON.stringify(literalFm.description)}`
  );

  // 块标量：折叠块 + 块内空行作段落分隔（保留单个换行）
  const foldedPargraphMd = `---
name: folded-paragraph
description: >-
  段落一第一行。
  段落一第二行。

  段落二第一行。
---`;
  const foldedParagraphFm = parseFrontmatter(foldedPargraphMd);
  assert(
    foldedParagraphFm.description === '段落一第一行。 段落一第二行。\n段落二第一行。',
    `折叠块标量空行作段落分隔：${JSON.stringify(foldedParagraphFm.description)}`
  );
  console.log();

  // ─── 测试 6：scanSkills 真实目录 ───────────────────────────────────────────
  console.log('[6] scanSkills 真实目录');
  let skills;
  try {
    skills = await scanSkills(SKILL_DIRECTORY);
  } catch (err) {
    console.log(`  ⚠️ 跳过（目录不可访问）：${err.message}`);
    skills = [];
  }
  if (skills.length > 0) {
    assert(skills.length > 0, `扫描到 ${skills.length} 个 SKILL`);
    const cpp = skills.find((s) => s.dirName === 'CPPAnalysisSkill');
    if (cpp) {
      assert(cpp.name === 'cpp-porting-analysis', `CPPAnalysisSkill.name 正确`);
      assert(cpp.category === 'harmonyos-porting', `CPPAnalysisSkill.category 正确`);
    }
    // 用真实 SKILL 跑一次 fuzzyMatch
    const realMatched = await fuzzyMatch(analysis, skills, { topK: 5 });
    assert(realMatched.length === 5, `真实目录召回 5 个：${realMatched.length}`);
    assert(realMatched[0].score > 0, `真实目录 top1 有分数：${realMatched[0].score.toFixed(2)}`);
    console.log(`  真实召回 top3：${realMatched.slice(0, 3).map((m) => `${m.skill.dirName}(${m.score.toFixed(1)})`).join(' > ')}`);
  } else {
    console.log('  ⚠️ 真实目录不可访问，跳过');
  }
  console.log();

  // ─── 测试 7：renderTemplate ─────────────────────────────────────────────────
  console.log('[7] renderTemplate');
  const rendered = renderTemplate('任务：{{TASK}}，目录：{{DIR}}', { TASK: '测试', DIR: '/tmp' });
  assert(rendered === '任务：测试，目录：/tmp', `模板替换正确：${rendered}`);
  console.log();

  // ─── 测试 8：isTransientError / retryDelay 错误恢复 ──────────────────────────
  console.log('[8] isTransientError 错误分类');

  // 429 限流：通过 status 属性识别
  const err429 = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
  let info = isTransientError(err429);
  assert(info !== null && info.type === '429' && info.is529 === false, '429 status 识别为限流');

  // 429 限流：通过错误名识别（RateLimitError）
  const errRate = Object.assign(new Error('rate limited'), {});
  Object.defineProperty(errRate, 'constructor', { value: { name: 'RateLimitError' } });
  info = isTransientError(errRate);
  assert(info !== null && info.type === '429', 'RateLimitError 类名识别为 429');

  // 529 过载：通过 status 属性识别
  const err529 = Object.assign(new Error('529 Overloaded'), { status: 529 });
  info = isTransientError(err529);
  assert(info !== null && info.type === '529' && info.is529 === true, '529 status 识别为过载');

  // 529 过载：通过消息识别
  const errOverloaded = new Error('Service overloaded');
  info = isTransientError(errOverloaded);
  assert(info !== null && info.type === '529' && info.is529 === true, 'overloaded 消息识别为 529');

  // 网络抖动：通过类名识别
  const errConn = new Error('ECONNRESET');
  Object.defineProperty(errConn, 'constructor', { value: { name: 'APIConnectionError' } });
  info = isTransientError(errConn);
  assert(info !== null && info.type === 'network' && info.is529 === false, 'APIConnectionError 识别为网络错误');

  // 非瞬态错误：400 Bad Request
  const err400 = Object.assign(new Error('400 Bad Request'), { status: 400 });
  info = isTransientError(err400);
  assert(info === null, '400 识别为非瞬态错误（不重试）');

  // 非瞬态错误：401 Unauthorized
  const err401 = Object.assign(new Error('401 Unauthorized'), { status: 401 });
  info = isTransientError(err401);
  assert(info === null, '401 识别为非瞬态错误（不重试）');
  console.log();

  // ─── 测试 9：retryDelay 指数退避 + 抖动 ──────────────────────────────────────
  console.log('[9] retryDelay 指数退避');
  // 第 0 次：base=500，加抖动后范围 [500, 625)
  const d0 = retryDelay(0);
  assert(d0 >= 500 && d0 < 625, `第 0 次退避 [500,625)：${d0.toFixed(0)}ms`);
  // 第 1 次：base=1000，加抖动后范围 [1000, 1250)
  const d1 = retryDelay(1);
  assert(d1 >= 1000 && d1 < 1250, `第 1 次退避 [1000,1250)：${d1.toFixed(0)}ms`);
  // 第 2 次：base=2000，加抖动后范围 [2000, 2500)
  const d2 = retryDelay(2);
  assert(d2 >= 2000 && d2 < 2500, `第 2 次退避 [2000,2500)：${d2.toFixed(0)}ms`);
  // 第 7 次：base 封顶 32000，加抖动后范围 [32000, 40000)
  const d7 = retryDelay(7);
  assert(d7 >= 32000 && d7 < 40000, `第 7 次退避封顶 [32000,40000)：${d7.toFixed(0)}ms`);
  // Retry-After 优先
  const dRetryAfter = retryDelay(0, 5000);
  assert(dRetryAfter === 5000, `Retry-After 优先：${dRetryAfter}ms`);
  console.log();

  // ─── 结果汇总 ──────────────────────────────────────────────────────────────
  console.log('=== 自测结果 ===');
  console.log(`通过：${passed}，失败：${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('自测异常：', err);
  process.exit(1);
});
