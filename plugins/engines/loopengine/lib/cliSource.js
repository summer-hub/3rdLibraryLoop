/**
 * cliSource —— 本插件解析 `CLIController`（_abortSessions 唯一的 CLI 协作方）的唯一入口
 *
 * 为什么需要这一层：迁移前 `_abortSessions()` 里直接
 * `const mod = await import('../CLI/cli.js'); cli = new mod.CLIController()`。插件不得引用
 * `Server/`（架构守卫 R2），这条运行时自建必须换成解析器。解析顺序（照抄 brain 的裁决）：
 *
 *     1. `Server/LoopEngine/LoopEngine.js` 门面在 import 期登记的内置兜底
 *        （`async () => (await import('../CLI/cli.js')).CLIController`，登记**加载器**
 *        而不是类）——无宿主时仍保持迁移前"第一次真正要中止 session 才加载"的时机，
 *        也不会把 `@opencode-ai/sdk` 拖进"只想 new 一个 LoopEngine"的模块图。
 *        注意：`CLIController` 自己就会按 `resolveAiCliFactory(type)` 解析 `ai-cli` 接缝，
 *        所以**有宿主时这条路径照样走接缝**，并且保留了门面独有的两件事：
 *        非法 type 的原文案校验、以及 `startSession` 的 `stats` 旁路计数；
 *     2. 有宿主但门面没被 import 过：直接 `resolveAiCliFactory(type)` 取工厂并构造适配器。
 *        这条路径拿到的是**适配器**而不是 `CLIController` 门面——适配器没有 `getType()`、
 *        也不记 `stats`。仅用于"纯宿主、完全不 import `Server/`"的嵌入场景（本插件只用到
 *        `abortSession`，两档都能满足）；
 *     3. 两档都没有 → fail closed，错误信息点名缺哪条接缝 / 哪个登记函数。
 *
 * 与 brain 的 cliSource 差一档：本插件**没有** `deps.cli` 显式注入通道——迁移前
 * `_abortSessions()` 每次都 `new CLIController()`，没有任何注入点，凭空加一个没人用的
 * 构造入参只会让契约凭空多一个键（YAGNI）。要注入请改 `_abortSessions` 的调用点。
 */

import { resolveAiCliFactory } from '../../../../core/hostBridge.js';

/** `CLIController` 支持的类型闭集（与 `Server/CLI/cli.js` 的 SUPPORTED_TYPES 一致） */
const SUPPORTED_TYPES = Object.freeze(['opencode', 'deveco-code']);

/**
 * 非法类型的错误（文案与 `Server/CLI/cli.js` 的 `unsupportedType()` 逐字一致）。
 * 只在第 2 档（不经门面）出现；第 1 档由 `CLIController` 自己抛同一文案。
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
 * 登记加载器而不是类：无宿主时仍然"第一次真正要中止 session 才加载 `Server/CLI/cli.js`"，
 * 与迁移前的动态 import 时机一致。
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
 * 解析一个可用的 CLI 协作方（`CLIController` 门面，或第 2 档的适配器）。
 *
 * @returns {Promise<object>} 具备 abortSession 的对象
 * @throws {Error} 两档都解析不到时（含非法 CLI_TYPE）
 */
export async function resolveCli() {
    if (typeof _fallbackLoader === 'function') {
        const CLIController = await _fallbackLoader();
        if (typeof CLIController === 'function') return new CLIController();
    }

    // 第 2 档：宿主 ai-cli 接缝。类型闭集校验前移，避免非法 type 被裸名 ai-cli 兜住而放行
    const type = process.env.CLI_TYPE || 'deveco-code';
    if (!SUPPORTED_TYPES.includes(type)) throw unsupportedType(type);

    const factory = resolveAiCliFactory(type);
    if (typeof factory === 'function') return factory({});

    throw new Error(
        "engines/loopengine：无法解析 CLI 客户端 —— 既没有活跃插件宿主的 'ai-cli' 接缝，" +
            '也没有登记无宿主兜底。请三选一：加载提供 ai-cli 接缝的插件（plugins/cli/*），' +
            '或从门面 Server/LoopEngine/index.js 导入（它会在 import 期登记内置实现），' +
            '或改调用点显式传入一个具备 abortSession 的 CLI 协作方'
    );
}
