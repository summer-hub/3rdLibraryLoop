# 输出示例

> TaskDecompositionSkill 输出的完整 JSON 示例，供 LLM 参考格式。

---

## 示例 1：库移植分析（线性 + 回退）

```json
{
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "对 libcurl 源码进行鸿蒙化可行性分析：git clone 源码仓库到工作目录，扫描源码结构、第三方依赖、平台相关代码（#ifdef 平台宏）及构建系统（CMake/Makefile），输出标准化分析报告（analysis-report.md）",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac1_1",
          "criterion": "分析报告文件 analysis-report.md 已生成且非空（≥1KB）",
          "type": "output",
          "verification": "检查 ${taskDir}/analysis-report.md 文件是否存在且文件大小 > 1024",
          "taskACIds": ["ac1"]
        },
        {
          "id": "ac1_2",
          "criterion": "报告包含源码结构、依赖列表、平台相关代码分析三个章节",
          "type": "quality",
          "verification": "读取 analysis-report.md，检查包含'源码结构'、'依赖列表'、'平台相关代码'三个标题",
          "taskACIds": ["ac1", "ac2"]
        }
      ]
    },
    {
      "stepId": 2,
      "taskDescription": "对 libcurl 进行接口分析：扫描导出 API、头文件暴露接口、回调注册机制，输出接口清单（interface-list.md），标注鸿蒙化需适配的接口",
      "dependId": 1,
      "nextStepId": 3,
      "failStepId": 4,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac2_1",
          "criterion": "接口清单文件 interface-list.md 已生成且非空",
          "type": "output",
          "verification": "检查 ${taskDir}/interface-list.md 文件是否存在且文件大小 > 0",
          "taskACIds": ["ac2"]
        },
        {
          "id": "ac2_2",
          "criterion": "清单中每个接口标注了鸿蒙化适配状态（需适配/可直接使用/不适用）",
          "type": "quality",
          "verification": "读取 interface-list.md，检查每个接口条目包含适配状态标注",
          "taskACIds": ["ac2", "ac3"]
        }
      ]
    },
    {
      "stepId": 3,
      "taskDescription": "对 libcurl 进行鸿蒙化编译验证：使用鸿蒙 NDK 编译源码，记录编译错误和警告，输出编译日志（compile-log.txt）和编译结果摘要（compile-result.md）",
      "dependId": 2,
      "nextStepId": 5,
      "failStepId": 4,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac3_1",
          "criterion": "编译结果摘要文件 compile-result.md 已生成",
          "type": "output",
          "verification": "检查 ${taskDir}/compile-result.md 文件是否存在",
          "taskACIds": ["ac3"]
        },
        {
          "id": "ac3_2",
          "criterion": "编译无 error 级别错误，或所有 error 已记录并分析",
          "type": "compliance",
          "verification": "读取 compile-log.txt，检查 error 行数；若存在 error，确认 compile-result.md 中有对应分析",
          "taskACIds": ["ac3", "ac4"]
        }
      ]
    },
    {
      "stepId": 4,
      "taskDescription": "对编译失败的问题进行修复：分析编译错误原因，修改源码或构建配置，输出修复记录（fix-record.md），记录每个问题的修复方案",
      "dependId": 3,
      "nextStepId": 3,
      "failStepId": 5,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac4_1",
          "criterion": "修复记录文件 fix-record.md 已生成且包含至少一个问题的修复方案",
          "type": "output",
          "verification": "检查 ${taskDir}/fix-record.md 文件存在且内容包含'问题'和'修复方案'关键词",
          "taskACIds": ["ac4"]
        }
      ]
    },
    {
      "stepId": 5,
      "taskDescription": "生成鸿蒙化可行性总结报告：汇总分析报告、接口清单、编译结果和修复记录，输出最终报告（final-report.md），包含可行性结论和建议",
      "dependId": 3,
      "nextStepId": 0,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac5_1",
          "criterion": "最终报告文件 final-report.md 已生成且非空（≥2KB）",
          "type": "output",
          "verification": "检查 ${taskDir}/final-report.md 文件是否存在且文件大小 > 2048",
          "taskACIds": ["ac1", "ac4"]
        },
        {
          "id": "ac5_2",
          "criterion": "报告包含明确的可行性结论（可行/有条件可行/不可行）",
          "type": "quality",
          "verification": "读取 final-report.md，检查包含'可行'或'不可行'关键词",
          "taskACIds": ["ac4"]
        }
      ]
    }
  ]
}
```

---

## 示例 2：代码质量检查（并行）

```json
{
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "准备代码质量检查环境：克隆仓库到工作目录，安装依赖，确认项目可正常加载",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac1_1",
          "criterion": "仓库已克隆到工作目录且依赖已安装",
          "type": "output",
          "verification": "检查 ${taskDir} 目录存在 node_modules 或 oh_modules 子目录",
          "taskACIds": ["ac1"]
        }
      ]
    },
    {
      "stepId": 2,
      "taskDescription": "执行代码质量检查：运行 ArkTS 编码规范检查工具，扫描所有 .ets/.ts 文件，输出检查报告（code-quality-report.md）",
      "dependId": 1,
      "nextStepId": 4,
      "failStepId": 5,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac2_1",
          "criterion": "代码质量检查报告 code-quality-report.md 已生成",
          "type": "output",
          "verification": "检查 ${taskDir}/code-quality-report.md 文件存在",
          "taskACIds": ["ac2"]
        },
        {
          "id": "ac2_2",
          "criterion": "报告无 arkts-no-any、arkts-no-unknown 严重违规",
          "type": "compliance",
          "verification": "读取报告，检查无 arkts-no-any 和 arkts-no-unknown 标记",
          "taskACIds": ["ac2", "ac3"]
        }
      ]
    },
    {
      "stepId": 3,
      "taskDescription": "执行文档质量检查：扫描 README、API 文档、注释覆盖率，输出文档质量报告（doc-quality-report.md）",
      "dependId": 1,
      "nextStepId": 4,
      "failStepId": 5,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac3_1",
          "criterion": "文档质量报告 doc-quality-report.md 已生成",
          "type": "output",
          "verification": "检查 ${taskDir}/doc-quality-report.md 文件存在",
          "taskACIds": ["ac3"]
        },
        {
          "id": "ac3_2",
          "criterion": "公共 API 文档覆盖率 ≥ 80%",
          "type": "performance",
          "verification": "读取报告，解析 API 文档覆盖率数值 ≥ 80",
          "taskACIds": ["ac3"]
        }
      ]
    },
    {
      "stepId": 4,
      "taskDescription": "汇总代码质量与文档质量检查结果，生成综合质量报告（quality-summary.md）",
      "dependId": 2,
      "nextStepId": 0,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac4_1",
          "criterion": "综合质量报告 quality-summary.md 已生成且包含代码质量和文档质量两部分",
          "type": "quality",
          "verification": "读取 quality-summary.md，检查包含'代码质量'和'文档质量'章节",
          "taskACIds": ["ac2", "ac3", "ac4"]
        }
      ]
    },
    {
      "stepId": 5,
      "taskDescription": "对检查发现的问题进行修复：根据质量报告中的问题清单，逐项修复代码或文档问题，输出修复记录（fix-record.md）",
      "dependId": 2,
      "nextStepId": 2,
      "failStepId": 4,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac5_1",
          "criterion": "修复记录 fix-record.md 已生成且记录了修复方案",
          "type": "output",
          "verification": "检查 ${taskDir}/fix-record.md 文件存在且非空",
          "taskACIds": ["ac4"]
        }
      ]
    }
  ]
}
```

> **注意**：步骤2和步骤3的 `dependId` 都指向步骤1，Orchestrator 会在步骤1成功后并行执行步骤2和步骤3。

---

## 示例 3：最简线性流程

```json
{
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "获取 PR 信息并克隆仓库：通过 git clone 获取目标仓库指定分支代码，记录 PR 变更文件列表",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac1_1",
          "criterion": "仓库已克隆且变更文件列表已记录",
          "type": "output",
          "verification": "检查 ${taskDir} 下仓库目录存在，且 changed-files.txt 文件存在且非空",
          "taskACIds": ["ac1"]
        }
      ]
    },
    {
      "stepId": 2,
      "taskDescription": "分析变更文件：逐个审查变更文件的代码质量、安全风险、逻辑正确性，输出分析报告（review-report.md）",
      "dependId": 1,
      "nextStepId": 3,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac2_1",
          "criterion": "检视报告 review-report.md 已生成且覆盖所有变更文件",
          "type": "quality",
          "verification": "读取 review-report.md，对比 changed-files.txt 确认所有文件均已审查",
          "taskACIds": ["ac2"]
        }
      ]
    },
    {
      "stepId": 3,
      "taskDescription": "生成 PR 检视总结：汇总分析结果，给出批准/修改建议，输出最终检视意见（pr-review.md）",
      "dependId": 2,
      "nextStepId": 0,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac3_1",
          "criterion": "检视意见 pr-review.md 已生成且包含明确结论（批准/需修改/拒绝）",
          "type": "output",
          "verification": "读取 pr-review.md，检查包含'批准'或'需修改'或'拒绝'关键词",
          "taskACIds": ["ac3"]
        }
      ]
    }
  ]
}
```
