/**
 * Server/FlexRunner/FlexRunner.js —— 转发门面（实现已迁入 `plugins/engines/orchestrator/`）
 *
 * 为什么留这一层：既有消费者与测试按老路径 import 这个文件
 * （`cli/lib/runner.js` 经 buildApp 拿到 `FlexRunner` 注入 `flexRunnerFactory`、
 * m1/f03、m2/f06-f08、m3/f17+f25、m5/f35、m6/f42）。插件化不该顺手改掉它们的 import。
 *
 * ⚠️ FlexRunner **不是独立插件**：它与 Orchestrator 是一个内部组合件，同住
 * `plugins/engines/orchestrator/`（理由见该插件 index.js 头注释）。本文件仍然把
 * `FlexRunner` / `ControlType` / `StepStatus` / `__getSharedKnowledgeManagerForTest` +
 * `default` 逐名转发出去，且就是插件里那几个绑定（`===`），因此既有用法零改动。
 *
 * ── 本文件不只是转发：它登记五条无宿主兜底 ─────────────────────────────────
 * 迁移前 `FlexRunner` 有 5 处「运行时自建 + 动态 import `Server/`」；插件不得引用
 * `Server/`（架构守卫 R2），因此每条换成解析链，而「无宿主时用哪份实现」只能由
 * 装配层在这里登记（见 `plugins/engines/orchestrator/lib/fallbacks.js`）：
 *
 *   cli-controller     ← `Server/CLI/cli.js` 的 `CLIController`（门面，**排在 ai-cli
 *                        接缝之前**：门面独有的 type 闭集校验与 Session 调用计数，
 *                        适配器不做；照抄 Brain 的裁决）
 *   skill-selector     ← `Server/Agent/SkillSelector/index.js` 的 `Agent`（未插件化，无接缝）
 *   create-storage     ← `Server/DbUse/index.js` 的 `createStorage`（有 `storage` 接缝；
 *                        插件侧**接缝在前**，本档只服务无宿主场景）
 *   knowledge-manager  ← `Server/Knowledge/index.js` 的 `KnowledgeManager`（有
 *                        `engine-knowledge` 接缝；接缝在前，同上）
 *   mcp-tool-guide     ← `Server/library/McpToolGuide.js` 的 `McpToolGuide`（未插件化，无接缝）
 *
 * 全部登记成**惰性加载器**（`async () => (await import(...)).X`）：无宿主时仍保持
 * 迁移前"第一次真正用到才 import"的时机，不会把 `@opencode-ai/sdk`、`better-sqlite3`、
 * SkillSelector 的 5499 行拖进"只想 new 一个 FlexRunner"的模块图。
 */

import { registerFallback } from '../../plugins/engines/orchestrator/lib/fallbacks.js';

registerFallback('cli-controller', async () => (await import('../CLI/cli.js')).CLIController);
registerFallback(
    'skill-selector',
    async () => (await import('../Agent/SkillSelector/index.js')).Agent
);
registerFallback('create-storage', async () => (await import('../DbUse/index.js')).createStorage);
registerFallback(
    'knowledge-manager',
    async () => (await import('../Knowledge/index.js')).KnowledgeManager
);
registerFallback(
    'mcp-tool-guide',
    async () => (await import('../library/McpToolGuide.js')).McpToolGuide
);

export {
    FlexRunner,
    ControlType,
    StepStatus,
    __getSharedKnowledgeManagerForTest,
} from '../../plugins/engines/orchestrator/FlexRunner.js';
export { default } from '../../plugins/engines/orchestrator/FlexRunner.js';
