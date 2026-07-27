/**
 * run-sample.js — SkillSelector 自测脚本
 *
 * 用法（在 Server/ 目录下）：
 *   node Agent/SkillSelector/__tests__/run-sample.js
 *
 * 需先在 Server/.env 配置 DASHSCOPE_API_KEY。
 * 默认使用 D:\\code\\AIWeb\\Server\\Skills 作为 SKILL 筛选目录（可改）。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Agent } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 测试参数 ──────────────────────────────────────────────────────────────
// const TASK = '分析 libcurl 这个 C++ 开源库能否移植到鸿蒙平台，输出鸿蒙化可行性报告';
// const TASK = '分析imageknife这个Flutter开源库能否移植到鸿蒙平台，输出鸿蒙化可行性报告';
const TASK = '分析gitserver这个Go开源库能否移植到鸿蒙平台，输出鸿蒙化可行性报告';
const SKILL_DIRECTORY = 'D:\\code\\AIWeb\\Server\\Skills';

async function main() {
  console.log('=== SkillSelector 自测 ===');
  console.log('任务：', TASK);
  console.log('SKILL 目录：', SKILL_DIRECTORY);
  console.log();

  const agent = new Agent();

  try {
    const result = await agent.selectSkill(TASK, SKILL_DIRECTORY);

    console.log('✅ 选择完成\n');
    // ─── 检索命中结果 ───
    console.log('=== 检索结果 ===');
    console.log(`  hit      : ${result.hit}`);
    console.log(`  topScore : ${result.topScore}`);
    console.log(`  skillPath: ${result.skillPath}`);
    console.log();

    if (result.best) {
      console.log('最佳 SKILL：');
      console.log('  dirName    :', result.best.dirName);
      console.log('  name       :', result.best.name);
      console.log('  description:', result.best.description);
      console.log('  category  :', result.best.category);
      console.log('  language  :', result.best.language);
      console.log();
    } else {
      console.log('（未命中阈值，best 为 null，ranked 仅供参考）\n');
    }

    console.log('排序结果（top5）：');
    result.ranked.forEach((r, i) => {
      const dims = r.dimensions || {};
      const dimsStr = Object.keys(dims).length
        ? ` [意图${dims.intent}/技术${dims.techStack}/约束${dims.constraint}/词${dims.keyword}]`
        : '';
      console.log(`  ${i + 1}. [${r.score}]${dimsStr} ${r.skill.dirName} — ${r.reason}`);
    });
    console.log();

    console.log('任务拆解：', JSON.stringify(result.analysis, null, 2));
    console.log();

    console.log('ReAct 留痕：');
    result.trace.forEach((t) => {
      console.log(`  - ${t.step}`, t.output ? JSON.stringify(t.output) : '');
    });
    console.log();
  } catch (err) {
    console.error('❌ 自测失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
