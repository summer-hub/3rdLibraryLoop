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
// 场景 A（预期 hit=true）：C++ 库可行性分析

const TASK = '对 rntpc_async-storage 进行版本差异分析，对比 br_rnoh0.82 基线版本与 0.84 目标框架版本的差异以及库版本升级到 3.1.1 的差异，检查 br_rnoh0.84 分支是否存在，输出版本分析报告。';

// 场景 B（预期 hit=false）：Go 库可行性分析（语言否决）
// const TASK = '分析gitserver这个Go开源库能否移植到鸿蒙平台，输出鸿蒙化可行性报告';
// 场景 C（预期 hit=false）：汇总报告（动作类型否决；分差已不参与命中判定）
// const TASK = '汇总规范合规性检视结果（compliance-review.json）和业务逻辑检视结果（logic-review.json），生成完整的代码检视报告文档（code-review-report.md）。报告需覆盖仓库内所有核心 ArkTS 源码文件，所有问题需按严重程度分级（Blocker/Critical/Major/Minor），并给出具体的修改建议或代码示例';
const SKILL_DIRECTORY = 'Skills';

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
    console.log(`  scoreGap : ${result.scoreGap}`);
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
      // act:fuzzyMatch 额外打印每路分数明细（动作/领域/原文）
      if (t.step === 'act:fuzzyMatch' && t.output?.routes) {
        t.output.routes.forEach((r, i) => {
          if (!r) return;
          console.log(`      [${i}] 动作=${r.action.toFixed(3)} 领域=${r.domain.toFixed(3)} 原文=${r.raw.toFixed(3)}`);
        });
      }
    });
    console.log();
  } catch (err) {
    console.error('❌ 自测失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
