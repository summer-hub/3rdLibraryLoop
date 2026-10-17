/**
 * Server/Agent/SkillSelector/core/Agent.js —— 转发门面（实现已迁入 `plugins/agent/core/SkillSelector/core/`）
 *
 * 为什么留这一层：深层路径可能被套件直接 import（迁移前 `Agent.js` 就在这个位置），
 * 而 `SkillSelector/index.js` 门面也逐名转发自这里。保持路径可用是插件化的硬约束。
 *
 * **必须 `export ... from` 转发，不能重新实现**：门面导出的 `Agent` 与插件实现、
 * 与 `inject('agent-skill-selector')` 拿到的类是**同一个**——这是「接缝优先于门面兜底」
 * 可以被机器断言（`inject(...) === facade.Agent`）的前提；也是
 * `plugins/engines/testcheck/lib/skillSelectorSource.js` 第 3 档能拿到同一个类的前提。
 *
 * 本文件同时是**另一个必经登记点**（与 `../llm/llmClient.js` 同形、幂等）：
 *   - `setLlmFallback(() => LLMClient)`：无宿主时插件侧 `Agent` 的第一次 `selectSkill()`
 *     能解析到内置 LLM 类。登记加载器（不是类）保持"要用时才取"的时机。
 *   - `setLoggerImpl((options) => createLogger(options.tag))`：`Agent` 的 `log.debug()` 走
 *     `app-logger` 接缝；无宿主时由这里接线到 `Server/Routes/library/logger.js`
 *     （它是 `plugins/util/logger` 的转发门面，同一个模块实例、同一个写入流）。
 * 两处都"先接线先赢 / 幂等"，与 `Server/Agent/index.js`、`../llm/llmClient.js` 的登记
 * 指向同一批模块实例，重复登记无副作用。
 *
 * 导出面与迁移前逐名一致：`export *` 覆盖全部具名导出，外加迁移前就有的 `default`（= `Agent`）。
 */

import { setLlmFallback } from '../../../../plugins/agent/core/SkillSelector/llm/llmClient.js';
import { setLoggerImpl } from '../../../../plugins/agent/core/lib/logger.js';
import { LLMClient } from '../llm/llmClient.js';
import createLogger from '../../../Routes/library/logger.js';

setLlmFallback(() => LLMClient);
setLoggerImpl((options) => createLogger(options.tag));

export * from '../../../../plugins/agent/core/SkillSelector/core/Agent.js';
export { default } from '../../../../plugins/agent/core/SkillSelector/core/Agent.js';
