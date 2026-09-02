# SkillSelector — SKILL 选择器 ReAct Agent

根据一个具体事项（任务）和 SKILL 筛选目录，自动选出最适合的 SKILL。

采用 **ReAct（Reason + Act）** 设计模式，通过 LLM 推理 + 双通道 BM25 模糊匹配的三步编排完成选择。

## 职责

在给定 SKILL 筛选目录下，根据一个具体事项（任务），选出最适合的 SKILL。

采用 **ReAct（Reason + Act）** 设计模式，分三步完成：

1. **Reason #1 — 任务拆解**：LLM（百炼 / glm-5.2）分析任务，产出 `keywords / intent / constraints / techStack / whenToUse`，作为模糊匹配的输入。prompt 强制保留"准出审核/验收测试"等动作类型词，避免被技术细节淹没。
2. **Act — 模糊匹配**：本地模糊匹配工具根据上一步输出，采用**双通道多路召回融合**（动作通道 + 领域通道 + 原文兜底通道），在候选 SKILL 池中召回最匹配的 topK。SKILL 文档索引 = metadata×3 + 正文前 2500 字符 + useWhen。
3. **Reason #2 — 排序筛选**：LLM 对 topK 候选 SKILL 评分排序，选出最佳 SKILL。

## 架构

```mermaid
flowchart TD
    Input["输入: task + skillDirectory"]
    Input --> Scan["skillScanner 扫描目录"]
    Scan -->|SkillMeta[]| R1

    subgraph R1["Reason #1 — 任务拆解"]
        R1a["llmClient 调用 glm-5.2"]
        R1b["输出 TaskAnalysis: keywords / intent / constraints / techStack / whenToUse"]
        R1a --> R1b
    end

    R1 --> Act["Act — fuzzyMatch 双通道多路召回融合"]
    Scan --> Act
    Act -->|"动作路 + 领域路 + 原文路融合"| TopK["topK 候选 SKILL"]
    TopK --> R2

    subgraph R2["Reason #2 — 排序筛选"]
        R2a["llmClient 调用 glm-5.2"]
        R2b["输出 ranked: 每项含 score + reason"]
        R2a --> R2b
    end

    R2 --> Output["返回 SkillSelection: best + ranked + analysis + trace"]
```

## 目录结构

```
SkillSelector/
├── index.js              # 模块统一导出
├── types.js              # 数据结构 JSDoc 契约（本地保留，不提交远端，已加入 .gitignore）
├── core/
│   └── Agent.js          # 对外导出的 Agent 类，selectSkill(task, skillDirectory) 主入口
├── llm/
│   ├── llmClient.js      # LLM 客户端（百炼 OpenAI 兼容，glm-5.2），提供 chat() / chatJSON()
│   ├── prompts.js        # prompt 模板 + renderTemplate（TASK_ANALYSIS_PROMPT 含动作词/领域词约束）
│   └── reactSteps.js     # 两个 Reason 步骤封装（analyzeTask / rankSkills）
├── matcher/
│   └── fuzzyMatcher.js   # 模糊匹配工具（分词器 + 纯 JS BM25 + 双通道多路召回融合）
│                          # 动作通道加权 + 领域通道 + 原文兜底 + legacy fallback
├── utils/
│   └── actionWords.js    # 动作词表 + 领域词表（ACTION_WORDS / DOMAIN_WORDS / isActionWord / isDomainWord）
│                          # 供 fuzzyMatcher.js 加权、prompts.js 示例共用
├── scanner/
│   └── skillScanner.js   # SKILL 目录扫描 + frontmatter 解析 → SkillMeta[]
│                          # searchableText = metadata×3 + 正文前 2500 字符 + useWhen
└── __tests__/
    ├── run-sample.js      # 端到端自测脚本
    └── test-pure-logic.js # 纯逻辑单测（不依赖 LLM/网络）
```

## 模块组成

| 文件 | 职责 |
|------|------|
| [core/Agent.js](core/Agent.js) | 对外导出的 `Agent` 类，`selectSkill(task, skillDirectory)` 主入口，编排 ReAct 流程 |
| [index.js](index.js) | 模块统一导出 |
| [llm/llmClient.js](llm/llmClient.js) | LLM 客户端（百炼 OpenAI 兼容，glm-5.2），提供 `chat()` / `chatJSON()` |
| [scanner/skillScanner.js](scanner/skillScanner.js) | 扫描 SKILL 目录，解析 `SKILL.md` frontmatter，产出 `SkillMeta[]` |
| [matcher/fuzzyMatcher.js](matcher/fuzzyMatcher.js) | 模糊匹配工具（合并模块）：分词器 + 纯 JS BM25 + 双通道多路召回融合 + legacy fallback |
| [utils/actionWords.js](utils/actionWords.js) | 动作词表 + 领域词表（`ACTION_WORDS` / `DOMAIN_WORDS`），供 fuzzyMatcher 加权与 prompts 示例共用 |
| [llm/reactSteps.js](llm/reactSteps.js) | 两个 Reason 步骤封装：`analyzeTask` / `rankSkills` |
| [llm/prompts.js](llm/prompts.js) | prompt 模板 + `renderTemplate` 占位符替换（`TASK_ANALYSIS_PROMPT` 含动作词/领域词提取约束） |
| [types.js](types.js) | 数据结构 JSDoc 契约（`SkillMeta` / `TaskAnalysis` / `SkillSelection`；本地保留，不提交远端） |
| [__tests__/](__tests__/) | 自测脚本 |

## 工作流

### 步骤 0：扫描 SKILL 目录

`skillScanner.scanSkills(skillDirectory)` 遍历目录下每个子目录，读取 `SKILL.md`，解析 YAML frontmatter（`name` / `description` / `metadata` 含 `version` / `category` / `language` 等），产出 `SkillMeta[]`。每个 `SkillMeta` 含 `searchableText`（= name + description + category + language 等 metadata 字段×3 + 正文前 2500 字符 + useWhen 拼成的小写串），供 BM25 打分用。metadata 权重放大保证 frontmatter 匹配占主导，正文纳入覆盖 description 未提及的语义，useWhen 让"什么场景下调用"这一语义信号进入召回。

### Reason #1：LLM 拆解任务

`reactSteps.analyzeTask(llm, task)` 调用 glm-5.2，将具体事项拆解为结构化的 `TaskAnalysis`。`TASK_ANALYSIS_PROMPT` 通过规则化约束 + few-shot 示例，强制 LLM 保留**动作类型词**（如"准出审核/验收测试/可行性分析/代码生成"）与**领域/产出物特征词**（如"接口规格/接口签名/方法签名/导出链"），并让 `intent` 以动词开头点明动作类型：

```json
{
  "intent": "扫描源码提取方法级接口规格并输出文档",
  "keywords": ["接口规格", "接口签名", "方法签名", "方法级接口", "扫描", "文档生成", "arkts", "fastble"],
  "constraints": ["C++ 开源库", "鸿蒙平台", "输出可行性报告"],
  "techStack": ["ArkTS"],
  "whenToUse": "从源码提取方法级接口规格时"
}
```

### Act：模糊匹配召回（双通道多路融合）

`fuzzyMatcher.fuzzyMatch(analysis, skills, { topK, task, weights })` 采用**双通道 + 多路召回融合**，对每个 SKILL 的 `searchableText` 做 BM25 打分，按分数降序取 topK 候选。

三路召回：

- **动作通道（路 A）**：仅用 `keywords + intent` 中的**动作类 token** 做 BM25 打分。动作词加权只对真动作词生效，避免领域词混入动作词表稀释信号。
- **领域通道（路 B）**：用 `keywords` 中的**领域/产出物特征词** + `whenToUse` 分词做 BM25 打分，直接匹配文档侧已索引的 `useWhen` 与 searchableText 中的领域词。这是召回稳定性的关键信号。
- **原文兜底通道（路 C）**：用**原始任务描述 task 全文**分词做 BM25 打分，覆盖 keywords 提取偏差导致的语义漂移。

融合公式：`score = wA·bm25A + wB·bm25B + wC·bm25C`（归一化后加权，默认 `wA=0.4, wB=0.4, wC=0.2`）。

关键打分策略：

- **分数归一化**：raw 分 ÷ max(3, 单路实际参与 token 数)，使分数跨查询可比、阈值判定稳定，且避免多路融合/动作词展开导致分母虚高。
- **name 精确匹配 bonus**：query keywords 中任一词与 skill.name 精确匹配时 score ×1.15。
- **动作词加权**：query 侧的动作类型词（`utils/actionWords.js` 的 `ACTION_WORDS`，如"准出审核/验收测试"）会被重复 `ACTION_WORD_WEIGHT`（默认 3）次，等价于打分时权重×3，使意向词主导排名。

融合后全零分（无任何 token 重叠）时，回退到 legacy 子串匹配，保证不返回空。

### Reason #2：LLM 排序筛选

`reactSteps.rankSkills(llm, task, analysis, candidates)` 把 topK 候选的简表（id / name / description / category / language / useWhen）发给 glm-5.2，让 LLM 按规则化评分（意图 40 / 技术栈 30 / 约束 20 / 关键词 10 + 硬否决规则）打分排序，选出最佳 SKILL。`Agent` 会对返回结果做稳定降序排序，确保 `topScore` 判定不依赖 LLM 的返回顺序。

### 返回结果

```js
{
  best: SkillMeta|null,        // 最佳 SKILL（未命中阈值/分差过小时为 null）
  skillPath: string|null,      // best 的绝对目录路径（未命中为 null）
  hit: boolean,                // 检索是否命中（top1>=阈值 且 top1-top2 分差>=10）
  topScore: number,            // top1 分数
  scoreGap: number,            // top1-top2 分差（<10 时判定不确定，hit=false）
  ranked: [{ skill, score, dimensions, reason }],  // topK 排序结果
  analysis: TaskAnalysis,       // 任务拆解
  trace: [...]                 // ReAct 每步留痕（含 act:fuzzyMatch 每路分数明细）
}
```

> `act:fuzzyMatch` 的 trace 会记录每路分数明细（`routes: { action, domain, raw }`），便于定位偶发未命中。

## 快速开始

### 1. 配置环境变量

在 `Server/.env` 中配置：

```env
DASHSCOPE_API_KEY=your_api_key_here
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=glm-5.2
```

### 2. 安装依赖

```bash
cd Server
npm install
```

### 3. 使用

```js
import { Agent } from './Agent/SkillSelector/index.js';

const agent = new Agent();
const result = await agent.selectSkill(
  '分析 libcurl 这个 C++ 开源库能否移植到鸿蒙平台',
  'D:/code/AIWeb/Server/Skills'
);

console.log(result.best.dirName);   // 'CPPAnalysisSkill'
console.log(result.best.name);      // 'cpp-porting-analysis'
console.log(result.ranked);        // 5 项排序，每项 { skill, score, reason }
console.log(result.analysis);      // 任务拆解
console.log(result.trace);         // ReAct 每步留痕
```

### 4. 运行自测

```bash
# 纯逻辑自测（不调用 LLM，不依赖网络）
node Agent/SkillSelector/__tests__/test-pure-logic.js

# 完整 ReAct 自测（调用真实 LLM，需配置 API Key）
node Agent/SkillSelector/__tests__/run-sample.js
```

## 对外接口

### `Agent` 类

```js
import { Agent } from './Agent/SkillSelector/index.js';

const agent = new Agent();
// task: 具体事项；skillDirectory: SKILL 筛选目录绝对路径
const result = await agent.selectSkill('分析 libcurl 的鸿蒙化可行性', 'D:/code/AIWeb/Server/Skills');

console.log(result.best.name);       // 最佳 SKILL 名称（未命中时 best 为 null）
console.log(result.best.dirName);     // 最佳 SKILL 目录名
console.log(result.hit);            // 检索是否命中（top1>=阈值 且 top1-top2 分差>=10）
console.log(result.skillPath);       // best 的绝对目录路径
console.log(result.topScore);        // top1 分数
console.log(result.scoreGap);        // top1-top2 分差（<10 时判定不确定）
console.log(result.ranked);          // 排序列表 [{ skill, score, dimensions, reason }]
console.log(result.analysis);        // 任务拆解
console.log(result.trace);           // ReAct 每步留痕
```

### `Agent` 构造选项（可选，用于测试 / 自定义）

```js
new Agent({
  llm: new LLMClient({ model: 'glm-5.2' }),  // 注入自定义 LLM 客户端
  matcher: customMatcher,                      // 注入自定义模糊匹配实现
  topK: 5,                                     // 召回候选数量
  hitThreshold: 60,                            // 命中阈值
  weights: { action: 0.4, domain: 0.4, raw: 0.2 },  // 多路召回融合权重
});
```

## SKILL 目录格式

参考 `D:\code\AIWeb\Server\Skills`，每个 SKILL 是一个目录：

```
<skillDirectory>/
├── SomeSkill/
│   ├── SKILL.md          # 必须存在，含 YAML frontmatter
│   ├── references/        # 可选
│   └── scripts/           # 可选
└── AnotherSkill/
    └── SKILL.md
```

`SKILL.md` 的 frontmatter 示例：

```yaml
---
name: cpp-porting-analysis
description: 对 C++ 开源库进行鸿蒙化可行性分析...
license: MIT
metadata:
  author: lalhan
  version: "2.2.0"
  category: harmonyos-porting
  language: C/C++
  useWhen: 从鸿蒙原生库源码提取方法级接口规格时   # 可选，领域通道匹配的关键信号
compatibility: 适用于任意托管在 Git 仓库的 C/C++ 开源库。
---
```

## 高级用法

### 注入自定义 LLM 客户端

```js
import { Agent, LLMClient } from './Agent/SkillSelector/index.js';

const customLLM = new LLMClient({
  model: 'glm-5.2',
  temperature: 0.1,
});
const agent = new Agent({ llm: customLLM });
```

### 注入自定义模糊匹配算法

`fuzzyMatch` 默认用 BM25，可通过构造函数注入自定义实现（如向量检索）：

```js
const agent = new Agent({
  matcher: async (analysis, skills, options) => {
    // 自定义匹配逻辑，返回 [{ skill, score }]
    return myVectorSearch(analysis, skills, options.topK);
  },
});
```

### 调整召回数量

```js
const agent = new Agent({ topK: 10 });  // 召回 10 个候选
```

或在 `.env` 中配置：

```env
SELECTOR_TOP_K=10
```

## 配置项

`Server/.env` 支持的环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DASHSCOPE_API_KEY` | 百炼平台 API Key（必填） | — |
| `LLM_BASE_URL` | OpenAI 兼容端点 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | 模型名 | `glm-5.2` |
| `LLM_TEMPERATURE` | 采样温度 | `0.2` |
| `LLM_MAX_TOKENS` | 最大 token 数 | `2048` |
| `LLM_ENABLE_THINKING` | 是否开启 GLM 思考模式 | `false` |
| `SELECTOR_TOP_K` | 模糊匹配召回数量 | `5` |
| `SELECTOR_HIT_THRESHOLD` | 命中阈值（top1>=此值且分差>=10 才命中） | `60` |
| `SELECTOR_WEIGHT_ACTION` | 动作通道融合权重 | `0.4` |
| `SELECTOR_WEIGHT_DOMAIN` | 领域通道融合权重 | `0.4` |
| `SELECTOR_WEIGHT_RAW` | 原文兜底通道融合权重 | `0.2` |
| `FALLBACK_MODEL` | 连续 3 次 529 过载时切换的备用模型 | — |

## 设计原则

- **高内聚低耦合**：每个文件单一职责，`core/Agent.js` 只做编排，prompt / fs / LLM / 匹配各自独立
- **可替换**：`LLMClient` 和 `matcher` 均支持注入 mock / 自定义实现
- **可测试**：纯逻辑自测不依赖 LLM 和网络，完整自测验证端到端流程
- **零原生依赖**：BM25 用纯 JS 实现，不依赖 SQLite / 原生编译模块
- **动作/领域词分离管理**：动作类型词与领域/产出物词分别在 `utils/actionWords.js` 的 `ACTION_WORDS` / `DOMAIN_WORDS`，prompt 示例与 BM25 加权共用同一来源，避免词表漂移

## 匹配质量优化（演进记录）

SKILL 召回经历了以下演进，共同保证验收测试、接口规格等动作/领域匹配类 SKILL 能被精准召回：

1. **提示词保留动作词**（`TASK_ANALYSIS_PROMPT`）：强制 LLM 拆解时保留"准出审核/验收测试"等意向关键词，解决任务描述冗长时丢词问题。
2. **searchableText 文档侧加权**（`skillScanner._buildSearchableText`）：索引 = metadata 字段×3 + 正文前 2500 字符 + useWhen，提升 SKILL 文档匹配质量。
3. **BM25 分数归一化 + name bonus**（`fuzzyMatcher`）：raw 分 ÷ max(3, 原始 query token 数) 使跨查询可比、阈值判定稳定；query 关键词与 skill.name 精确匹配时 ×1.15。
4. **BM25 query 侧动作词加权**（`fuzzyMatcher`）：动作类型词权重×3，解决动作词被高频技术词淹没、目标 SKILL 被挤出 TopK 的问题。
5. **动作/领域词表纯净化**（`utils/actionWords.js`）：将语义非动作的产出物/领域词（接口规格/接口签名/方法签名/导出链/覆盖率等）从 `ACTION_WORDS` 移入独立的 `DOMAIN_WORDS`，避免"堆词"式打补丁稀释真正的动作信号。
6. **双通道多路召回融合**（`fuzzyMatcher`）：动作通道 + 领域通道 + 原文兜底通道，弱化对 LLM keywords 提取的单点依赖，目标 SKILL 即使 keywords 有偏差也能稳定进入 topK，解决偶现未命中问题。
7. **ranked 稳定降序排序**（`core/Agent.js`）：LLM 返回结果做稳定降序排序，确保 `topScore` 判定不依赖 LLM 的返回顺序。

## 匹配质量优化注意点

- **提示词保留动作词**：`TASK_ANALYSIS_PROMPT` 强制 LLM 拆解时保留"准出审核/验收测试"等意向关键词，避免冗长任务描述导致丢词。
- **searchableText 文档侧加权**：`skillScanner._buildSearchableText` 构建索引 = metadata 字段×3 + 正文前 2500 字符 + useWhen，保证 frontmatter 匹配主导，正文补充语义。
- **BM25 分数归一化 + name bonus**：`fuzzyMatcher` raw 分 ÷ max(3, 单路实际参与 token 数)，跨查询可比、阈值判定稳定；query 关键词与 skill.name 精确匹配时 ×1.15。
- **BM25 动作词加权**：`fuzzyMatcher` query 侧对动作词重复 `ACTION_WORD_WEIGHT` 次（默认 3），归一化分母用展开前原始 token 数，使动作词主导排名，避免被高频技术词挤出 TopK。
- **新增动作词**：匹配新动作类型时，把词加入 `utils/actionWords.js` 的 `ACTION_WORDS`，并同步 `TASK_ANALYSIS_PROMPT` 的动作词示例，确保 LLM 产出能被 `isActionWord` 识别。
- **新增领域词**：新增产出物/领域特征词时，把词加入 `utils/actionWords.js` 的 `DOMAIN_WORDS`（同步 `TASK_ANALYSIS_PROMPT` 的领域词示例），确保 LLM 产出能被 `isDomainWord` 识别，供领域通道召回。