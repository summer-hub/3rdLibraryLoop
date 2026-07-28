# SkillSelector — SKILL 选择器 ReAct Agent

根据一个具体事项（任务）和 SKILL 筛选目录，自动选出最适合的 SKILL。

采用 **ReAct（Reason + Act）** 设计模式，通过 LLM 推理 + BM25 模糊匹配的三步编排完成选择。

## 架构

```mermaid
flowchart TD
    Input["输入: task + skillDirectory"]
    Input --> Scan["skillScanner 扫描目录"]
    Scan -->|SkillMeta[]| R1

    subgraph R1["Reason #1 — 任务拆解"]
        R1a["llmClient 调用 glm-5.1"]
        R1b["输出 TaskAnalysis: keywords / intent / constraints / techStack"]
        R1a --> R1b
    end

    R1 --> Act["Act — fuzzyMatch 模糊匹配"]
    Scan --> Act
    Act -->|BM25 单路打分| TopK["top5 候选 SKILL"]
    TopK --> R2

    subgraph R2["Reason #2 — 排序筛选"]
        R2a["llmClient 调用 glm-5.1"]
        R2b["输出 ranked: 每项含 score + reason"]
        R2a --> R2b
    end

    R2 --> Output["返回 SkillSelection: best + ranked + analysis + trace"]
```

### 模块组成

| 文件 | 职责 |
|------|------|
| [core/Agent.js](core/Agent.js) | 对外导出的 `Agent` 类，`selectSkill(task, skillDirectory)` 主入口，编排 ReAct 流程 |
| [index.js](index.js) | 模块统一导出 |
| [llm/llmClient.js](llm/llmClient.js) | LLM 客户端（百炼 OpenAI 兼容，glm-5.1），提供 `chat()` / `chatJSON()` |
| [scanner/skillScanner.js](scanner/skillScanner.js) | 扫描 SKILL 目录，解析 `SKILL.md` frontmatter，产出 `SkillMeta[]` |
| [matcher/fuzzyMatcher.js](matcher/fuzzyMatcher.js) | 模糊匹配工具（合并模块）：分词器 + 纯 JS BM25 + 单路召回编排 + legacy fallback |
| [llm/reactSteps.js](llm/reactSteps.js) | 两个 Reason 步骤封装：`analyzeTask` / `rankSkills` |
| [llm/prompts.js](llm/prompts.js) | prompt 模板 + `renderTemplate` 占位符替换 |
| [types.js](types.js) | 数据结构 JSDoc 契约（`SkillMeta` / `TaskAnalysis` / `SkillSelection`） |
| [__tests__/](__tests__/) | 自测脚本 |

## 工作流

### 步骤 0：扫描 SKILL 目录

`skillScanner.scanSkills(skillDirectory)` 遍历目录下每个子目录，读取 `SKILL.md`，解析 YAML frontmatter（`name` / `description` / `metadata` 含 `version` / `category` / `language` 等），产出 `SkillMeta[]`。每个 `SkillMeta` 含 `searchableText`（name + description + category + language 拼成的小写串），供 BM25 打分用。

### Reason #1：LLM 拆解任务

`reactSteps.analyzeTask(llm, task)` 调用 glm-5.1，将具体事项拆解为结构化的 `TaskAnalysis`：

```json
{
  "intent": "分析 libcurl 移植到鸿蒙平台的可行性并输出报告",
  "keywords": ["libcurl", "c++", "开源库", "移植", "鸿蒙", "harmonyos", "可行性报告"],
  "constraints": ["C++ 开源库", "鸿蒙平台", "输出可行性报告"],
  "techStack": ["C++", "HarmonyOS"]
}
```

### Act：模糊匹配召回

`fuzzyMatcher.fuzzyMatch(analysis, skills, { topK })` 用 `keywords` + `intent` 分词后作为查询，对每个 SKILL 的 `searchableText` 做 BM25 打分，按分数降序取 topK 候选。

BM25 全零分（无任何 token 重叠）时，回退到 legacy 子串匹配，保证不返回空。

### Reason #2：LLM 排序筛选

`reactSteps.rankSkills(llm, task, analysis, candidates)` 把 topK 候选的简表（id / name / description / category / language）发给 glm-5.1，让 LLM 对每个候选评分（0-100）并排序，选出最佳 SKILL。

### 返回结果

```js
{
  best: SkillMeta|null,        // 最佳 SKILL（未命中阈值时为 null）
  skillPath: string|null,      // best 的绝对目录路径（未命中为 null）
  hit: boolean,                // 检索是否命中阈值
  topScore: number,            // top1 分数
  ranked: [{ skill, score, dimensions, reason }],  // top5 排序结果
  analysis: TaskAnalysis,       // 任务拆解
  trace: [...]                 // ReAct 每步留痕
}
```

## 快速开始

### 1. 配置环境变量

在 `Server/.env` 中配置：

```env
DASHSCOPE_API_KEY=your_api_key_here
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=glm-5.1
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
compatibility: 适用于任意托管在 Git 仓库的 C/C++ 开源库。
---
```

## 高级用法

### 注入自定义 LLM 客户端

```js
import { Agent, LLMClient } from './Agent/SkillSelector/index.js';

const customLLM = new LLMClient({
  model: 'glm-5.1',
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
| `LLM_MODEL` | 模型名 | `glm-5-1` |
| `LLM_TEMPERATURE` | 采样温度 | `0.2` |
| `LLM_MAX_TOKENS` | 最大 token 数 | `2048` |
| `LLM_ENABLE_THINKING` | 是否开启 GLM 思考模式 | `false` |
| `SELECTOR_TOP_K` | 模糊匹配召回数量 | `5` |
| `SELECTOR_HIT_THRESHOLD` | 命中阈值（top1 >= 此值才算命中） | `60` |
| `FALLBACK_MODEL` | 连续 529 过载时切换的备用模型 | — |

## 设计原则

- **高内聚低耦合**：每个文件单一职责，`core/Agent.js` 只做编排，prompt / fs / LLM / 匹配各自独立
- **可替换**：`LLMClient` 和 `matcher` 均支持注入 mock / 自定义实现
- **可测试**：纯逻辑自测不依赖 LLM 和网络，完整自测验证端到端流程
- **零原生依赖**：BM25 用纯 JS 实现，不依赖 SQLite / 原生编译模块
