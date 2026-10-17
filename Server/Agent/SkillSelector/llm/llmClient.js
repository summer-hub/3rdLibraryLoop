/**
 * Server/Agent/SkillSelector/llm/llmClient.js —— 转发门面 + **`llm` 无宿主兜底登记点**
 *
 * 实现已迁入两条插件：
 *   - LLM 客户端本体 → `plugins/llm/dashscope/`（`llm` 接缝的提供方）；
 *   - LLM **类解析链** → `plugins/agent/core/SkillSelector/llm/llmClient.js`
 *     （注入 → 宿主 `llm` 接缝 → 本文件登记的内置兜底 → fail closed）。
 *
 * 为什么留这一层：`Server/TestCheck/TestCheck.js`、`Server/Brain/Brain.js`、
 * `SkillSelector/index.js`、`test/m3/f21-llm-resilience.test.mjs`、
 * `SkillSelector/__tests__/test-pure-logic.js` 都按这个历史路径 import；
 * 而架构守卫只禁止「插件 → Server」方向，「Server → plugins」是允许的。
 *
 * 导出面与迁移前**逐名一致**（含 default = LLMClient）：CircuitBreaker / LLMClient /
 * LlmRateLimiter / retryDelay / isTransientError / _globalBreaker / _globalRateLimiter / default。
 * 额外多出 4 个名字 —— 插件解析链的入口（setLlmFallback / resetLlmFallback /
 * hasLlmFallback / resolveLlmClient）：它们是"从插件取 LLM"的公开写法，放在本文件是唯一
 * 合理位置（本文件就是 LLM 的门面）。原有的 8 个名字全部保持 `===` 同一对象。
 *
 * **这里是 `llm` 兜底加载器的登记点（必经文件）**：无宿主形态下，插件侧的解析链第 3 档
 * 需要拿到内置类。登记**加载器**（`() => LLMClient`）而不是类，语义是"要用时才取"；
 * 由于本文件本来就要静态再导出 dashscope 模块，这个加载器是同步的、零额外成本，
 * 于是插件侧 `new Agent()` 之后第一次 `selectSkill()` 在无宿主时也能解析到 LLM。
 *
 * 为什么登记点选这里而不是 `Server/Agent/index.js`：真正的消费者都会走深层路径
 * （`TestCheck` / `Brain` / `FlexRunner` 都直接 import 本文件或
 * `SkillSelector/index.js`），根 barrel 反而**没有**任何 import 者。在必经文件登记，
 * 才能保证"只要有人能拿到 Agent，LLM 兜底就一定登记过"。
 *
 * 路径深度是刻意的：仓库内 `Server/Agent/SkillSelector/llm/` 上溯 4 层 = 仓库根；
 * 发布态 `cli/vendor/Server/Agent/SkillSelector/llm/` 上溯 4 层 = `cli/vendor/`。
 * 因此 prepack 必须把仓库根 `plugins/` 复制成 `cli/vendor/plugins/`，两种模式才同构。
 */

import { setLlmFallback } from '../../../../plugins/agent/core/SkillSelector/llm/llmClient.js';
import { LLMClient } from '../../../../plugins/llm/dashscope/index.js';

// 先登记先赢（插件侧 `??=`）；重复 import 本模块不会再登记一次（ESM 模块缓存）。
setLlmFallback(() => LLMClient);

export * from '../../../../plugins/llm/dashscope/index.js';
export { LLMClient as default } from '../../../../plugins/llm/dashscope/index.js';

// 插件侧 LLM 类解析链的公开入口（注入 → 宿主 llm 接缝 → 本文件登记的兜底 → fail closed）
export {
    setLlmFallback,
    resetLlmFallback,
    hasLlmFallback,
    resolveLlmClient,
} from '../../../../plugins/agent/core/SkillSelector/llm/llmClient.js';
