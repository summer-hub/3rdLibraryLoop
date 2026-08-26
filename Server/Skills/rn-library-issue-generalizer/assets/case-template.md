<!-- 案例条目模板：生成 cases/KI-{XXX}-{库名现象}.md 独立文件 -->
<!-- 案例编号 KI-XXX 全局唯一，三位数字递增 -->
<!-- 格式二（代码证据式）：错误/正确代码对照是 few-shot 判断的核心依据，必须从实际 PR diff 提取 -->

# KI-{XXX} {库名}：{问题现象简述}

- **元数据**: `rule: {R-XX[, R-XX]}` · `verified: {diff|description-only}` · `source: {dtse|community-issue|self-check}` · `severity: {high|medium|low}` · `status: {draft|active}`
- **PR**: {修复 PR 完整链接}（{状态}，{核心变更文件数}）
- **diff 材料**: [../pr-info/{repo}-{number}.md](../pr-info/{repo}-{number}.md)

## 现象

{原始 issue 描述，保留具体信息}

## 根因

{该案例的机制层根因，与所属规则的"问题本质"呼应}

## 错误代码（修复前{，注明文件与关键缺陷点}）

```{语言}
{从 PR diff 的删除行/上下文提取，只保留命中判定的关键行，≤15 行；
 无法获取 diff 时省略本字段并在元数据标记 verified: description-only}
```

## 正确代码（修复后{，注明关键修复点}）

```{语言}
{从 PR diff 的新增行提取，只保留体现修复模式的关键行，≤15 行；
 可用注释标注 ①②③ 分步说明修复链路}
```

## 修复方式

{从 PR diff 提炼的可迁移修复模式}

<!--
字段说明：
- rule: 所属规则编号（一案例可挂多条规则，逗号分隔；每条规则文件中放索引行，案例文件只存一份）
- verified: diff=基于实际 patch 验证（有错误/正确代码）；description-only=仅基于描述（无代码字段）
- source: dtse=DTSE代提；community-issue=社区 issue；self-check=内部自检发现
- severity: 该案例的严重级别（可能与规则默认级别不同）
- status: draft=泛化产出待审核；active=人工审核通过（检视 SKILL 只消费 active）
- 错误/正确代码约束：每段 ≤15 行；只留命中判定关键行；语言标注正确（typescript/cpp 等）
-->
