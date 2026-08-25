# 经验总结：task-analysis SKILL 规范化重生成

## 背景

对已有的 task-analysis SKILL 进行 skill-generator 规范化重生成。原 SKILL 仅有单文件 SKILL.md，无 references/assets/scripts，未采用渐进式披露结构。

## 关键发现

### 1. 目录命名与 frontmatter name 不一致是设计如此

- Brain 模块硬编码 `path.join(skillDir, 'task-analysis')` 定位 SKILL
- frontmatter `name: task-analysis` 是 SkillSelector 体系下的逻辑标识
- 两者现在保持一致，物理目录名与逻辑标识同名

### 2. SKILL 执行通过 opencode CLI 间接调用

- SkillExecutor 不是直接执行 SKILL 代码，而是创建 opencode Session
- opencode 读取 SKILL.md 后按指令执行
- SKILL.md 实际上是给 LLM 看的指令文档，不是可执行脚本
- prompt 中注入的上下文段落是 SKILL 的实际输入

### 3. 结果输出有容错机制但仍应输出纯 JSON

- `readSkillResult` 用 `indexOf('{')`/`lastIndexOf('}')` 容错提取
- 即使被 markdown 包裹也能解析
- 但 SKILL 应输出纯 JSON，不依赖容错

### 4. normalizeAnalysis 提供字段兜底

- 所有字段有兜底值（intent='', domain='general', complexity='medium' 等）
- 空描述的验收标准会被 `.filter(c => c.criterion)` 过滤
- SKILL 应尽量输出完整字段，避免依赖兜底

### 5. 重规划上下文通过 prompt 段落注入

- 不是通过参数传递，而是通过 `## 重规划上下文` 等 markdown 段落
- SKILL 需要从 prompt 文本中解析这些段落
- 6 条"重分析要求"是固定文本，由调用方注入

## 最佳实践

- SKILL.md body 保持在 200 行以内，详细内容拆分到 references/
- 输出 JSON 的 Schema 文档独立为 references/ANALYSIS_SCHEMA.md
- 验收标准编写指南独立为 references/ACCEPTANCE_CRITERIA_GUIDE.md
- 提供完整的输出示例（assets/OUTPUT_EXAMPLES.md）供 LLM 参考格式
- 提供校验脚本（scripts/）用于自动化验证输出合规性
- 在 SKILL.md 中明确标注调用方式与下游消费方，便于理解集成关系

## 注意事项

- 不要重命名 task-analysis 物理目录（如需重命名须同步修改 Brain 的 AnalysisStrategies.js）
- 不要修改输出 JSON 的字段名（下游 normalizeAnalysis 依赖固定字段名）
- `acceptanceCriteria[].id` 必须从 `ac1` 递增（下游格式化依赖）
- `failureAnalysis`/`adjustmentStrategy` 仅重规划场景必填
- complexity 必须是 `low`/`medium`/`high` 之一（兜底为 medium 但应显式输出）
