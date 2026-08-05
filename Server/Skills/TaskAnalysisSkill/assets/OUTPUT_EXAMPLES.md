# 任务分析输出示例

> 完整的分析结果 JSON 示例，供 SKILL 执行时参考格式。

---

## 1. 首轮分析输出示例

以"鸿蒙 ArkTS 三方库内存泄漏检测"任务为例：

```json
{
  "intent": "分析鸿蒙 ArkTS 三方库的内存泄漏问题，生成结构化检测报告",
  "domain": "harmonyos-porting",
  "keywords": ["ArkTS", "内存泄漏", "生命周期", "OpenHarmony", "leak-detection"],
  "constraints": [
    "必须兼容 ArkTS 编译规则",
    "分析结果输出为纯 JSON 格式",
    "覆盖目标库所有源文件"
  ],
  "techStack": ["ArkTS", "OpenHarmony", "鸿蒙 SDK"],
  "complexity": "medium",
  "estimatedSteps": 5,
  "acceptanceCriteria": [
    {
      "id": "ac1",
      "criterion": "内存泄漏分析报告 JSON 文件已生成且可解析",
      "type": "output",
      "verification": "检查 {workDir}/leak-analysis.json 存在，JSON.parse 成功"
    },
    {
      "id": "ac2",
      "criterion": "报告包含 intent、domain、keywords、techStack 字段且均非空",
      "type": "quality",
      "verification": "读取 JSON，逐字段检查存在性和非空"
    },
    {
      "id": "ac3",
      "criterion": "扫描覆盖目标库所有源文件（覆盖率 100%）",
      "type": "performance",
      "verification": "对比源文件列表与扫描结果，确认无遗漏"
    },
    {
      "id": "ac4",
      "criterion": "每个疑似泄漏点包含位置、类型、严重等级信息",
      "type": "quality",
      "verification": "读取报告中 leakPoints 数组，每条含 file/line/level 字段"
    },
    {
      "id": "ac5",
      "criterion": "分析结果符合 JSON 输出规范（纯 JSON、字段完整）",
      "type": "compliance",
      "verification": "运行 validate-output.sh 校验脚本，检查通过"
    }
  ]
}
```

---

## 2. 重规划分析输出示例

第 1 轮重规划（loopCount=1），上一轮 ac3/ac4 未通过：

```json
{
  "intent": "分析鸿蒙 ArkTS 三方库的内存泄漏问题，生成结构化检测报告",
  "domain": "harmonyos-porting",
  "keywords": ["ArkTS", "内存泄漏", "生命周期", "OpenHarmony", "leak-detection", "utils-scan"],
  "constraints": [
    "必须兼容 ArkTS 编译规则",
    "分析结果输出为纯 JSON 格式",
    "覆盖目标库所有源文件"
  ],
  "techStack": ["ArkTS", "OpenHarmony", "鸿蒙 SDK"],
  "complexity": "high",
  "estimatedSteps": 7,
  "acceptanceCriteria": [
    {
      "id": "ac1",
      "criterion": "内存泄漏分析报告 JSON 文件已生成且可解析",
      "type": "output",
      "verification": "检查 {workDir}/leak-analysis.json 存在，JSON.parse 成功"
    },
    {
      "id": "ac2",
      "criterion": "报告包含 intent、domain、keywords、techStack 字段且均非空",
      "type": "quality",
      "verification": "读取 JSON，逐字段检查存在性和非空"
    },
    {
      "id": "ac3",
      "criterion": "扫描覆盖目标库所有源文件含 utils/ 目录（覆盖率 100%）",
      "type": "performance",
      "verification": "执行 find {srcDir} -name '*.ets' | wc -l 对比扫描结果条数，确认无遗漏"
    },
    {
      "id": "ac4",
      "criterion": "每个疑似泄漏点包含位置、类型、严重等级、修复建议信息",
      "type": "quality",
      "verification": "读取报告中 leakPoints 数组，每条含 file/line/level/suggestion 字段"
    },
    {
      "id": "ac5",
      "criterion": "分析结果符合 JSON 输出规范（纯 JSON、字段完整）",
      "type": "compliance",
      "verification": "运行 validate-output.sh 校验脚本，检查通过"
    },
    {
      "id": "ac6",
      "criterion": "utils/ 目录单独扫描且结果纳入主报告",
      "type": "output",
      "verification": "检查报告中 leakPoints 含 utils/ 路径下的条目"
    }
  ],
  "failureAnalysis": "上一轮共 2 条标准未通过：ac3 失败原因：扫描未覆盖 utils/ 目录，estimatedSteps=3 过低未包含该目录扫描步骤 → 执行问题（步骤遗漏）；ac4 失败原因：泄漏点缺少 suggestion 字段 → 标准问题（验证方式不够明确）。根因：首轮 estimatedSteps 过低，未覆盖全部源目录。",
  "adjustmentStrategy": "1. ac3 重写 verification 为具体 find 命令对比；2. ac4 补充 suggestion 字段要求；3. estimatedSteps 从 3 调整为 7；4. 新增 ac6 覆盖 utils/ 目录扫描；5. keywords 补充 'utils-scan'；6. complexity 从 medium 提升为 high。"
}
```

---

## 3. 简单任务输出示例

以"更新 README 文档"任务为例：

```json
{
  "intent": "更新项目 README 文档，补充安装说明和使用示例",
  "domain": "documentation",
  "keywords": ["README", "documentation", "markdown"],
  "constraints": [
    "保持原有文档结构",
    "使用中文"
  ],
  "techStack": ["Markdown"],
  "complexity": "low",
  "estimatedSteps": 2,
  "acceptanceCriteria": [
    {
      "id": "ac1",
      "criterion": "README.md 文件已更新且包含安装说明章节",
      "type": "output",
      "verification": "检查 README.md 中存在 ## 安装 或 ## Installation 标题"
    },
    {
      "id": "ac2",
      "criterion": "README.md 包含至少 2 个使用示例",
      "type": "quality",
      "verification": "统计 README.md 中代码块数量 ≥ 2"
    },
    {
      "id": "ac3",
      "criterion": "文档使用中文编写",
      "type": "compliance",
      "verification": "检查 README.md 正文为中文"
    }
  ]
}
```
