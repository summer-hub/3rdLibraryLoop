/**
 * cliSource —— 本插件解析 `CLIController`（审核 Skill 唯一的 CLI 协作方）的唯一入口
 *
 * 为什么需要这一层：迁移前 `TestCheck._loadCLIController()` 直接
 * `await import('../CLI/cli.js')` 取 `CLIController` 再 `new`。插件不得引用 `Server/`（R2），
 * 这条运行时自建必须换成解析器。解析顺序（与 `plugins/engines/brain/lib/cliSource.js` 同源）：
 *
 *     1. 调用方显式注入（`new TestCheck({ cli })`）—— 永远最优先；
 *     2. `Server/TestCheck/TestCheck.js` 门面在 import 期登记的内置兜底
 *        （`async () => (await import('../CLI/cli.js')).CLIController`，登记**加载器**而不是类）。
 *        注意：`CLIController` 自己就会按 `resolveAiCliFactory(type)` 解析 `ai-cli` 接缝，
 *        所以**有宿主时这条路径照样走接缝**，并且保留了门面独有的两件事：
 *        非法 type 的原文案校验、以及 `startSession` 的 `stats` 旁路计数；
 *     3. 有宿主但门面没被 import 过：直接 `resolveAiCliFactory(type)` 取工厂并构造适配器。
 *        这条路径拿到的是**适配器**而不是 `CLIController` 门面——适配器没有 `getType()`、
 *        也不记 `stats`（计数是门面的事）。仅用于"纯宿主、完全不 import `Server/`"的嵌入场景；
 *        适配器自身类型校验仍在解析工厂**之前**做，文案与 `Server/CLI/cli.js` 逐字一致；
 *     4. 三档都没有 → fail closed，错误信息点名缺哪条接缝 / 哪个登记函数。
 *
 * 为什么把"门面兜底"排在"宿主接缝"之前（与 storageSource 顺序不同）：
 *   `ai-cli` 接缝提供方是**适配器工厂**，而 TestCheck 的既有协作方是 `CLIController` 门面。
 *   门面能做的两件事（type 闭集校验、`startSession` 记一次 Session 调用统计）适配器都不做，
 *   直接取接缝会静默丢掉 `stats` 计数。因此只要门面在（正常部署形态：任何 `Server/**`
 *   消费者都 import 过 `Server/TestCheck/index.js`），就走门面 + 接缝的组合；
 *   第 3 档只是"宿主在、门面不在"时的可用性兜底。
 */

import { resolveAiCliFactory } from '../../../../core/hostBridge.js';

/** `CLIController` 支持的类型闭集（与 `Server/CLI/cli.js` 的 SUPPORTED_TYPES 一致） */
const SUPPORTED_TYPES = Object.freeze(['opencode', 'deveco-code']);

/**
 * 非法类型的错误（文案与 `Server/CLI/cli.js` 的 `unsupportedType()` 逐字一致）。
 * 只在第 3 档（不经门面）出现；第 2 档由 `CLIController` 自己抛同一文案。
 * @param {string} type
 * @returns {Error}
 */
function unsupportedType(type) {
    return new Error(`不支持的 CLI 类型: "${type}"，可选值为 'opencode'、'deveco-code'`);
}

/** 无宿主兜底：`() => CLIController | Promise<CLIController>`；由 Server 侧门面登记 */
let _fallbackLoader = null;

/**
 * 登记无宿主兜底（幂等取先登记的那一个，重复登记不覆盖）。
 *
 * 登记加载器而不是类：无宿主时仍然"第一次真正调用 CLI 才加载 `Server/CLI/cli.js`"，
 * 与迁移前的惰性时机一致，也不会把 `@opencode-ai/sdk` 拖进"只想 new 一个 TestCheck"的路径。
 *
 * @param {() => (Function | Promise<Function>)} loader - 返回内置 CLIController 的加载器
 */
export function setCliFallback(loader) {
    if (typeof loader !== 'function') {
        throw new TypeError('setCliFallback(loader)：loader 必须是函数');
    }
    _fallbackLoader ??= loader;
}

/** 清空兜底登记（仅测试/热替换用；正常部署不应调用）。 */
export function resetCliFallback() {
    _fallbackLoader = null;
}

/**
 * 解析一个可用的 CLI 协作方（`CLIController` 门面，或第 3 档的适配器）。
 *
 * @param {object|null} [explicit=null] - 显式注入的实例（`deps.cli`）
 * @returns {Promise<object>} 具备 checkHealth/startSession/checkSessionStatus/abortSession 的对象
 * @throws {Error} 三档都解析不到时（含非法 CLI_TYPE）
 */
export async function resolveCli(explicit = null) {
    if (explicit) return explicit;

    if (typeof _fallbackLoader === 'function') {
        const CLIController = await _fallbackLoader();
        if (typeof CLIController === 'function') return new CLIController();
    }

    // 第 3 档：宿主 ai-cli 接缝。类型闭集校验前移，避免非法 type 被裸名 ai-cli 兜住而放行
    const type = process.env.CLI_TYPE || 'deveco-code';
    if (!SUPPORTED_TYPES.includes(type)) throw unsupportedType(type);

    const factory = resolveAiCliFactory(type);
    if (typeof factory === 'function') return factory({});

    throw new Error(
        "engines/testcheck：无法解析 CLI 客户端 —— 既没有活跃插件宿主的 'ai-cli' 接缝，" +
            '也没有登记无宿主兜底。请二选一：加载提供 ai-cli 接缝的插件（plugins/cli/*），' +
            '或从门面 Server/TestCheck/TestCheck.js 导入（它会在 import 期登记内置实现），' +
            '或显式注入 new TestCheck({ cli })'
    );
}
