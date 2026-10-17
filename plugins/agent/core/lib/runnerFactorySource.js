/**
 * plugins/agent/core/lib/runnerFactorySource.js —— 默认「会话适配器工厂」的唯一解析入口
 *
 * 为什么需要这一层：迁移前 `Runtime/AgentRuntime.js` 的 `_resolveAdapterFactory()` 里写着
 *
 *     const mod = await import('../../FlexRunner/FlexRunner.js');
 *
 * 也就是**默认会话适配器 = `Server/FlexRunner` 的 `FlexRunner`**。这条相对路径搬进
 * `plugins/agent/core/` 之后直接违反架构守卫 R2（插件不得引用 `Server/`）。
 *
 * 解析顺序（与 `llm/llmClient.js`、`plugins/engines/brain/lib/cliSource.js` 同形）：
 *
 *   1. **调用方显式注入** —— `new AgentRuntime({ runnerFactory })`
 *      （`Supervisor` 从 `MultiAgentRunner` 的 `opts.runnerFactory` 透传），由
 *      `Runtime/AgentRuntime.js` 在调用点判断，本文件不参与；
 *   2. **门面登记的无宿主兜底** —— `Server/Agent/**` 门面在 import 期调用
 *      `setRunnerFactoryFallback(async () => (await import('../FlexRunner/FlexRunner.js')).FlexRunner)`。
 *      登记**加载器**，保持迁移前"第一次真正要开会话才加载 FlexRunner（连带
 *      `@opencode-ai/sdk` / `openai`）"的时机；
 *   3. **都没有 → fail closed**，文案点名缺哪条来源、在哪登记、以及显式注入写法。
 *
 * 为什么没有"宿主接缝"这一档：`FlexRunner` 目前**没有接缝**（`seams/` 里没有它的契约），
 * `plugins/engines/orchestrator` 对它的用法也不是接线式的协作方。为它立一条接缝要连带
 * 插件清单、拓扑依赖与加载失败路径，而它接下来本来就要整体插件化 —— 那时再接缝化，
 * 第 2 档直接换成 `resolveSeamProvider('...')` 即可（本文件只有 `resolveDefaultFlexRunner`
 * 一个出口，换档不外溢）。
 *
 * 与 `llm/llmClient.js` 的一处差别：那里第 2 档能先问宿主（`createLlmFromHost`），
 * 这里不能 —— 没有接缝可问。所以本文件的第 2 档就是终档。
 */

/** 无宿主兜底：`() => FlexRunner | Promise<FlexRunner>`；由 Server 侧门面登记 */
let _fallbackLoader = null;

/**
 * 登记无宿主兜底（幂等取先登记的那一个，重复登记不覆盖）。
 *
 * 取「先登记先赢」而不是「后登记覆盖」：多个门面都会登记，正常部署下它们指向
 * **同一批模块实例**，重复登记无副作用；若允许覆盖，宿主类形态切换时会出现
 * "最后被 import 的门面决定实现"这种不可诊断的时序依赖。
 *
 * @param {() => (Function | Promise<Function>)} loader - 返回 FlexRunner 类的加载器
 * @throws {TypeError} loader 不是函数时
 */
export function setRunnerFactoryFallback(loader) {
    if (typeof loader !== 'function') {
        throw new TypeError('setRunnerFactoryFallback(loader)：loader 必须是函数');
    }
    _fallbackLoader ??= loader;
}

/** 清空兜底登记（仅测试/热替换用；正常部署不应调用）。 */
export function resetRunnerFactoryFallback() {
    _fallbackLoader = null;
}

/** @returns {boolean} 是否已登记无宿主兜底（不触发加载） */
export function hasRunnerFactoryFallback() {
    return typeof _fallbackLoader === 'function';
}

/**
 * 解析默认的会话适配器工厂（`() => Promise<adapter>`）。
 *
 * 返回的是一个**工厂**而不是实例：`AgentRuntime` 每个角色会话要一份新的适配器，
 * 与迁移前 `this._runnerFactory = async () => new mod.FlexRunner()` 的形状逐字一致。
 *
 * @returns {Promise<() => Promise<object>>}
 * @throws {Error} 未登记无宿主兜底时
 */
export async function resolveDefaultRunnerFactory() {
    if (typeof _fallbackLoader === 'function') {
        const FlexRunner = await _fallbackLoader();
        if (typeof FlexRunner === 'function') {
            return async () => new FlexRunner();
        }
    }

    throw new Error(
        'plugins/agent/core（agent-multi-agent-runner）：无法解析默认会话适配器工厂 —— '
            + '既没有显式注入的 runnerFactory，也没有登记无宿主兜底。请三选一：'
            + '从门面 Server/Agent/Runtime/AgentRuntime.js 链上的任一 Server/Agent 门面导入'
            + '（它在 import 期登记内置 FlexRunner），'
            + '或手工 setRunnerFactoryFallback(() => FlexRunner)，'
            + '或按构造入参显式注入 new AgentRuntime({ runnerFactory })'
    );
}
