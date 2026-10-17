/**
 * Server/Brain/SkillExecutor.js —— 转发门面（实现已迁入 `plugins/engines/brain/`）
 *
 * 导出面前后逐名一致：具名 `SkillExecutor` / `SKILL_ABORTED_ERROR` /
 * `POLL_INTERVAL_MS` / `POLL_TIMEOUT_MS` + `default`，且都是插件里那几个**同一个绑定**。
 *
 * 与 Brain 门面一样，本文件多做一件事：登记 CLI 协作方的无宿主兜底
 * （见 `plugins/engines/brain/lib/cliSource.js`）。迁移前 SkillExecutor 在模块内
 * `await import('../CLI/cli.js')` 自建 `CLIController`；插件不能引用 `Server/`（R2），
 * 于是那条自建改成"门面登记**加载器** → 插件首次 `getCLI()` 时调用"。
 * 登记加载器而不是类，保证无宿主时仍然"第一次真正调用 CLI 才加载 `Server/CLI/cli.js`"
 * ——与迁移前的惰性时机一致，也不会把 `@opencode-ai/sdk` 拖进"只想 new 一个 Brain"的路径。
 *
 * 这条兜底拿到的是 `CLIController` 门面（不是适配器），因此 type 闭集校验与
 * `startSession` 的 Session 调用计数（`stats`）都与迁移前一致；
 * `CLIController` 自身再按 `resolveAiCliFactory(type)` 决定用宿主的 `ai-cli` 接缝还是内置适配器。
 */

import { setCliFallback } from '../../plugins/engines/brain/lib/cliSource.js';

setCliFallback(async () => (await import('../CLI/cli.js')).CLIController);

export {
    SkillExecutor,
    SKILL_ABORTED_ERROR,
    POLL_INTERVAL_MS,
    POLL_TIMEOUT_MS,
} from '../../plugins/engines/brain/SkillExecutor.js';
export { default } from '../../plugins/engines/brain/SkillExecutor.js';
