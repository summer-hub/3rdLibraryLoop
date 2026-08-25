# 输出示例

> task-decomposition SKILL 输出的完整 JSON 示例，供 LLM 参考格式。

---

## 示例 1：库移植分析（线性 + 回退）

```json
{
  "keyParameters": {
    "versionNumbers": ["7.88.0"],
    "branchNames": [],
    "repoUrls": ["https://github.com/curl/curl.git"],
    "libraryNames": ["libcurl"]
  },
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
  "keyParameters": {
    "versionNumbers": [],
    "branchNames": ["main"],
    "repoUrls": [],
    "libraryNames": ["libexample"]
  },
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
  "keyParameters": {
    "versionNumbers": [],
    "branchNames": ["feature/fix-123"],
    "repoUrls": [],
    "libraryNames": []
  },
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

---

> **keyParameters 字段说明**：所有示例均在 `steps` 之前包含 `keyParameters` 字段，由 Phase 1.4 从任务描述中提取版本号、分支名、仓库 URL、库名。步骤描述中引用这些参数时必须与 `keyParameters` 中的值逐字一致，由 `validate-param-consistency.cjs` 强制校验。若任务描述中不含某类参数（如无版本号），对应数组留空 `[]` 即可。

---

## 示例 4：RN 三方库框架升级适配（含推荐 SKILL 标注）

> 该示例展示「RN 三方库框架升级适配」领域模板的标准 6 步拆解。**有推荐 SKILL 的步骤（2/3/4/6）`taskDescription` 只描述任务目标与关键参数，技术细节由 SKILL 承载；无推荐 SKILL 的步骤（1/5）仍写明具体操作。**

```json
{
  "keyParameters": {
    "versionNumbers": ["0.82", "0.84", "19.2"],
    "branchNames": ["br_rnoh0.82", "br_rnoh0.84"],
    "repoUrls": [
      "https://gitcode.com/CPF-RN/rntpc_react-native-netinfo/tree/br_rnoh0.82",
      "https://gitcode.com/CPF-RN/rntpc_react-native-netinfo"
    ],
    "libraryNames": ["rntpc_react-native-netinfo", "react-native-netinfo"]
  },
  "steps": [
    {
      "stepId": 1,
      "taskDescription": "从 https://gitcode.com/CPF-RN/rntpc_react-native-netinfo/tree/br_rnoh0.82 克隆 br_rnoh0.82 分支到工作目录；克隆后执行 git branch --show-current 确认当前分支为 br_rnoh0.82；执行 ls 确认目录结构包含 package.json、src/、harmony/ 三部分；输出克隆与结构验证记录。",
      "dependId": 0,
      "nextStepId": 2,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac1_1",
          "criterion": "仓库已克隆到工作目录，当前分支为 br_rnoh0.82",
          "type": "output",
          "verification": "在工作目录执行 git branch --show-current，输出为 br_rnoh0.82",
          "taskACIds": ["ac1"]
        }
      ]
    },
    {
      "stepId": 2,
      "taskDescription": "对 rntpc_react-native-netinfo 进行版本差异分析，对比 br_rnoh0.82 基线版本与 0.84 目标版本的差异，检查 br_rnoh0.84 分支是否存在，输出版本分析报告。推荐使用 rnoh-lib-version-diff SKILL 执行。",
      "dependId": 1,
      "nextStepId": 3,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac2_1",
          "criterion": "版本分析报告已生成且 JSON.parse 成功",
          "type": "output",
          "verification": "检查版本分析报告文件存在且可被 JSON.parse 解析",
          "taskACIds": ["ac2"]
        }
      ]
    },
    {
      "stepId": 3,
      "taskDescription": "对 rntpc_react-native-netinfo 进行 0.82→0.84 框架升级代码适配与编译验证，输出适配变更清单。推荐使用 rnoh-lib-code-adapt SKILL 执行.",
      "dependId": 2,
      "nextStepId": 4,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac3_1",
          "criterion": "package.json 中框架依赖版本已升级到目标版本",
          "type": "compliance",
          "verification": "读取 package.json 检查 react/react-native/@react-native-oh/react-native-harmony 版本号匹配",
          "taskACIds": ["ac3"]
        }
      ]
    },
    {
      "stepId": 4,
      "taskDescription": "对 rntpc_react-native-netinfo 移植上游测试 demo 并执行测试验证，补充缺失测试用例，输出测试结果。推荐使用 rnoh-lib-test-align SKILL 执行.",
      "dependId": 3,
      "nextStepId": 5,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac4_1",
          "criterion": "jest 测试已执行并输出通过率与覆盖率数据",
          "type": "quality",
          "verification": "执行 jest 测试，检查输出含通过率与覆盖率数据",
          "taskACIds": ["ac8"]
        }
      ]
    },
    {
      "stepId": 5,
      "taskDescription": "确保 build-profile.json5 中 signingConfigs 已配置且非空；构建产出 entry-default-signed.hap（已签名），确认 size > 0；部署到设备获取 UI 树 JSON grep 搜索 netinfo 关键词命中；获取 hilog 按 level=F/E 过滤确认无崩溃；输出设备验证记录。",
      "dependId": 4,
      "nextStepId": 6,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac5_1",
          "criterion": "entry-default-signed.hap 签名构建产物已生成且 size > 0",
          "type": "output",
          "verification": "检查构建产物路径下 entry-default-signed.hap 存在，ls -l 显示 size > 0",
          "taskACIds": ["ac6"]
        }
      ]
    },
    {
      "stepId": 6,
      "taskDescription": "基于适配变更清单与设备验证记录，对 rntpc_react-native-netinfo 生成功能测试 checklist 与 fix-summary.json，标注高风险场景。推荐使用 rnoh-lib-func-test SKILL 执行.",
      "dependId": 5,
      "nextStepId": 0,
      "failStepId": 0,
      "maxRetries": 3,
      "acceptanceCriteria": [
        {
          "id": "ac6_1",
          "criterion": "fix-summary.json 独立文件已生成且 JSON.parse 成功",
          "type": "output",
          "verification": "检查 fix-summary.json 独立存在，对其执行 JSON.parse 成功",
          "taskACIds": ["ac8"]
        }
      ]
    }
  ]
}
```
