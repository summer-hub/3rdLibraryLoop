/**
 * Server/Brain/Brain.js —— 转发门面（实现已迁入 `plugins/engines/brain/`）
 *
 * 为什么留这一层：`Server/**` 侧 3 处消费者与既有测试都按老路径 import
 * （`Server/Routes/controllers/BrainController.js`、`Server/LoopEngine/LoopEngine.js`、
 * `cli/lib/runner.js` 经 buildApp、以及 `test/m2/f12`），插件化不该顺手改掉它们的 import。
 * 架构守卫只禁止「插件 → Server」方向，「Server → 插件」是允许的
 * （与 `Server/Knowledge/KnowledgeManager.js`、`Server/DbUse/index.js` 同一形状）。
 *
 * 导出面前后逐名一致：具名 `Brain` / `BrainStatus` + `default`，且**就是插件里那两个
 * 绑定**（`===`），不存在第二份实现——否则 m2/f12 里 `brain._plans` 与
 * `BrainStatus` 会分属两个类，状态常量比较全部失效。
 *
 * 本文件不止转发，还登记**两条无宿主兜底**（见 `plugins/engines/brain/lib/{llm,storage}Source.js`）：
 *
 *   - LLM：迁移前 Brain 静态 `import { LLMClient } from '../Agent/SkillSelector/llm/llmClient.js'`，
 *     这里保留同一条静态 import 并把它登记为兜底**类**（`() => LLMClient`）——
 *     模块图与加载时机与迁移前完全一致，插件侧拿到的是同一个类；
 *   - storage：迁移前 `import { createStorage } from '../DbUse/index.js'`，这里登记
 *     **惰性加载器**（第一次真正需要存储时才 import），与 knowledge 那片同一写法。
 *
 * 有宿主时两条兜底都排在接缝之后（宿主 `llm` / `storage` 提供方优先），
 * 所以"有宿主生效、无宿主等价"这两条性质同时成立。
 */

import { LLMClient } from '../Agent/SkillSelector/llm/llmClient.js';
import { setLlmFallback } from '../../plugins/engines/brain/lib/llmSource.js';
import { setStorageFallback } from '../../plugins/engines/brain/lib/storageSource.js';

setLlmFallback(() => LLMClient);
setStorageFallback(async () => (await import('../DbUse/index.js')).createStorage);

export { Brain, BrainStatus } from '../../plugins/engines/brain/Brain.js';
export { default } from '../../plugins/engines/brain/Brain.js';
