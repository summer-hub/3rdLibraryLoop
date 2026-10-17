/**
 * Server/TestCheck/TestCheck.js —— 转发门面（实现已迁入 `plugins/engines/testcheck/`）
 *
 * 为什么留这一层：`Server/**` 侧 2 处消费者与既有测试都按老路径 import
 * （`Server/composition/buildApp.js` 的 `new TestCheck({ sseHub, storage, skillDirectory, cli })`、
 * `Server/LoopEngine/LoopEngine.js` 的 `new TestCheck({ storage, sseHub, skillDirectory })`、
 * 以及 m3/m5 套件）。插件化不该顺手改掉它们的 import。架构守卫只禁止「插件 → Server」方向，
 * 「Server → 插件」是允许的（与 `Server/Brain/Brain.js`、`Server/Knowledge/**` 同一形状）。
 *
 * 导出面前后逐名一致：具名 `TestCheck` / `CheckStatus` + `default`，且**就是插件里那两个
 * 绑定**（`===`），不存在第二份实现——否则 `CheckStatus.PASSED` 常量会分属两个对象，
 * LoopEngine 里 `checkResult.status === CheckStatus.PASSED` 这类比较全部失效。
 *
 * 本文件不止转发，还登记**四条无宿主兜底**（见 `plugins/engines/testcheck/lib/*Source.js`）——
 * 迁移前这四条都是 `TestCheck.js` 里的静态 import / 运行时自建，插件不能引用 `Server/`（R2），
 * 于是统一改成"门面登记加载器 → 插件首次使用时调用"：
 *
 *   - LLM：迁移前静态 `import { LLMClient } from '../Agent/SkillSelector/llm/llmClient.js'`，
 *     这里保留同一条静态 import 并把它登记为兜底**类**（`() => LLMClient`）——
 *     模块图与加载时机与迁移前完全一致，插件侧拿到的是同一个类；
 *   - storage：迁移前 `import { createStorage } from '../DbUse/index.js'`，这里登记
 *     **惰性加载器**（第一次真正需要存储时才 import）；
 *   - cli：迁移前 `await import('../CLI/cli.js')` 取 `CLIController` 再 `new`，这里登记
 *     **惰性加载器**——保证无宿主时仍然"第一次真正调用 CLI 才加载"，也不会把
 *     `@opencode-ai/sdk` 拖进"只想 new 一个 TestCheck"的路径；
 *   - skillSelector：迁移前 `await import('../Agent/SkillSelector/index.js')` 取 `Agent` 再 `new`，
 *     这里登记**惰性加载器**（SkillSelector 尚未插件化，故没有接缝可走，见 AGENTS.md 待办）。
 *
 * 有宿主时四条兜底都排在接缝之后（宿主 `llm`/`storage`/`ai-cli` 提供方优先；
 * skillSelector 无接缝），所以"有宿主生效、无宿主等价"这两条性质同时成立。
 */

import { LLMClient } from '../Agent/SkillSelector/llm/llmClient.js';
import { setCliFallback } from '../../plugins/engines/testcheck/lib/cliSource.js';
import { setLlmFallback } from '../../plugins/engines/testcheck/lib/llmSource.js';
import { setSkillSelectorFallback } from '../../plugins/engines/testcheck/lib/skillSelectorSource.js';
import { setStorageFallback } from '../../plugins/engines/testcheck/lib/storageSource.js';

setLlmFallback(() => LLMClient);
setStorageFallback(async () => (await import('../DbUse/index.js')).createStorage);
setCliFallback(async () => (await import('../CLI/cli.js')).CLIController);
setSkillSelectorFallback(async () => (await import('../Agent/SkillSelector/index.js')).Agent);

export { TestCheck, CheckStatus } from '../../plugins/engines/testcheck/TestCheck.js';
export { default } from '../../plugins/engines/testcheck/TestCheck.js';
