# SkillSelector — SKILL 选择器 ReAct Agent

## 职责

在给定 SKILL 筛选目录下，根据一个具体事项（任务），选出最适合的 SKILL。

采用 **ReAct（Reason + Act）** 设计模式，分三步完成：

1. **Reason #1 — 任务拆解**：LLM（百炼 / glm-5-1）分析任务，产出 `keywords / intent / constraints / techStack`，作为模糊匹配的输入。
2. **Act — 模糊匹配**：本地模糊匹配工具根据上一步输出，在候选 SKILL 池中召回最匹配的 top5。
3. **Reason #2 — 排序筛选**：LLM 对 5 个候选 SKILL 评分排序，选出最佳 SKILL。

## 目录结构

```
SkillSelector/
├── index.js              # 模块统一导出
├── types.js              # 数据结构 JSDoc 契约（本地保留，不提交远端，已加入 .gitignore）
├── core/
│   └── Agent.js          # 对外导出的 Agent 类，selectSkill(task, skillDirectory) 主入口
├── llm/
│   ├── llmClient.js      # LLM 客户端（百炼 OpenAI 兼容，glm-5-1）
│   ├── prompts.js        # prompt 模板 + renderTemplate
│   └── reactSteps.js     # 两个 Reason 步骤封装（analyzeTask / rankSkills）
├── matcher/
│   └── fuzzyMatcher.js   # 模糊匹配工具（分词器 + BM25 + 召回编排，合并模块）
├── scanner/
│   └── skillScanner.js   # SKILL 目录扫描 + frontmatter 解析 → SkillMeta[]
└── __tests__/
    ├── run-sample.js      # 端到端自测脚本
    └── test-pure-logic.js # 纯逻辑单测（不依赖 LLM/网络）
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
console.log(result.hit);            // 检索是否命中阈值
console.log(result.skillPath);       // best 的绝对目录路径
console.log(result.ranked);          // 排序列表 [{ skill, score, dimensions, reason }]
console.log(result.analysis);        // 任务拆解
console.log(result.trace);           // ReAct 每步留痕
```

### `Agent` 构造选项（可选，用于测试 / 自定义）

```js
new Agent({
  llm: new LLMClient({ model: 'glm-5-1' }),  // 注入自定义 LLM 客户端
  matcher: customMatcher,                      // 注入自定义模糊匹配实现
  topK: 5,                                     // 召回候选数量
});
```

## SKILL 目录格式

参考 `D:\code\AIWeb\Server\Skills`：

```
<skillDirectory>/
├── SomeSkill/
│   ├── SKILL.md          # 必须存在，含 YAML frontmatter
│   │   （frontmatter 字段：name / description / license / metadata(含 version/category/language 等) / compatibility）
│   ├── references/        # 可选
│   └── scripts/           # 可选
└── AnotherSkill/
    └── SKILL.md
```

## 配置

`Server/.env`：

| 变量 | 说明 | 默认 |
|------|------|------|
| `DASHSCOPE_API_KEY` | 百炼平台 API Key（必填） | - |
| `LLM_BASE_URL` | OpenAI 兼容端点 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | 模型名 | `glm-5-1` |
| `LLM_TEMPERATURE` | 采样温度 | `0.2` |
| `LLM_MAX_TOKENS` | 最大 token | `1024` |
| `LLM_ENABLE_THINKING` | 是否开启 GLM 思考模式 | `false` |
| `SELECTOR_TOP_K` | 模糊匹配召回数量 | `5` |
| `SELECTOR_HIT_THRESHOLD` | 命中阈值（top1 >= 此值才算命中） | `60` |
| `FALLBACK_MODEL` | 连续 3 次 529 过载时切换的备用模型 | - |

## 设计原则

- **高内聚**：每个文件单一职责（扫描 / 匹配 / LLM / prompt / 编排 / 类型）
- **低耦合**：模块间仅通过明确接口通信，`core/Agent.js` 只做编排，不写 prompt 细节、不碰 fs、不碰 HTTP
- **可替换**：模糊匹配支持通过 `createFuzzyMatcher` / 构造函数注入自定义算法（向量检索 / BM25 / LLM 打分）
- **可测试**：`LLMClient` / `matcher` 均支持注入 mock
