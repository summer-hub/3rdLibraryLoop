/**
 * core/hostBridge —— 「当前活跃插件宿主」的进程级桥（内核模块）
 *
 * 为什么它属于内核（core/），而不是留在装配层（Server/composition/）：
 *   它承载的是**宿主模型的运行时状态**——「现在哪个宿主是活跃的」——与业务无关：
 *   没有路由、没有数据库、没有 CLI，只有一份进程级引用加一次 AsyncLocalStorage 查找。
 *   而插件必须能解析宿主的接缝：插件拿到 `ctx` 之外，若想读「当前宿主注册了什么」
 *   （或按宿主身份决定自己的行为），只能靠这层状态。架构守卫 R2 明令插件**不得引用
 *   `Server/`**——插件只允许 `node:` 内置、npm 包、仓库内 `core/` 与 `seams/`、以及
 *   自身插件目录。于是这层状态只剩两个合法归宿：留在 `Server/` 里（插件永远看不见），
 *   或者进内核。它本来就是宿主模型的一部分，依赖图又干净（本文件只 import
 *   `node:async_hooks`，满足 R1「内核只允许 `node:` 与同目录 `./`」），所以它属于内核。
 *   `Server/composition/hostBridge.js` 保留为**转发门面**（`export * from
 *   '../../core/hostBridge.js'`）：既有消费者零改动，且两边解析到**同一个模块实例**
 *   ——同一份状态，不存在「两份 setActiveHost 各存一份」的裂缝。
 *
 * 为什么需要它：
 *   Agent / Brain / TestCheck 都在构造函数深处自行 `new LLMClient()`，从
 *   buildApp() 往下没有传 LLM 的构造注入通道（加参数会波及 Routes、CLI 装配
 *   以及大量按老签名构造的测试）。要让插件内核（core/）里 `llm` 接缝的提供方
 *   真正被消费者用上，又不改那些调用点，最小侵入的方式就是让消费者在「没有显式
 *   注入」时问一句「现在有宿主吗」：有就用宿主提供的类，没有就沿用内置实现。
 *
 * ── 三态模型：作用域宿主（ALS） > 默认宿主（模块级） > 无宿主 ────────────────
 *   getActiveHost() 的判定顺序就是消费者唯一需要知道的语义：
 *
 *   1. **作用域宿主**（AsyncLocalStorage 的 store）—— 由 runInHostScope(host, fn)
 *      设置。只对 `fn` 这条调用链可见（含它 `await` 之后恢复的续体），对同进程里并发
 *      运行的其它链**完全不可见**。嵌套 runInHostScope 时内层覆盖外层，退出即恢复。
 *   2. **默认宿主**（模块级变量）—— 由 setActiveHost(host) 设置。整进程共享，
 *      所有不在作用域内的代码都看它。由覆盖守卫保护：已有一个**不同**实例时再 set 会
 *      抛错（见 setActiveHost），因为「悄悄换掉别人的默认宿主」是不可诊断的状态串味。
 *   3. **无宿主** —— 两者都没有。默认部署形态，所有 resolve* 走回落路径，
 *      消费者行为与引入插件宿主之前逐字节等价。
 *
 *   为什么生产保留默认宿主：一个进程只跑一个应用，入口把宿主设成默认值一次，深处那些
 *   「构造函数里自建」的消费者（Agent / Brain / TestCheck / DbUse 门面）就都能看见，
 *   不必给每一层加参数——这正是本桥存在的理由，别急着删。
 *   为什么测试必须用作用域：并发运行的测试共享同一个模块实例，默认宿主是进程级单例，
 *   两个测试各自 setActiveHost 就会「后 set 覆盖先 set」，await 之后读到的是别人的宿主
 *   （串味）。runInHostScope 把宿主挂在这条调用链上，每个 await 之后读到的仍是自己那份。
 *
 * 设计约束：
 *   - 纯模块状态 + 纯函数，import 本模块零副作用（不加载宿主、不读环境变量、
 *     不注册任何监听；AsyncLocalStorage 实例本身也不注册任何监听）；
 *   - clearActiveHost() 之后（且不在任何作用域内）所有解析行为与「从未 setActiveHost
 *     过」完全一致（getActiveHost() 回到 null）；
 *   - resolve* 系列（resolveSeamProvider / resolveStorageFactory /
 *     resolveMessageArchiveFactory）解析不到就返回 null，绝不抛错：没有宿主 /
 *     宿主没 load / 宿主没该接缝都走回落路径——桥本身不能变成新的故障点；
 *     抛错只发生在**回落也缺失**的那一步（见下方 createLlmFromHost），以及
 *     setActiveHost 的覆盖守卫（那是调用方用错了 API，不是运行时缺能力）。
 *
 * 未来方向：
 *   宿主解析结果应当在装配层（buildApp / createAppHost）显式注入 Agent / Brain /
 *   TestCheck，然后删掉本文件的活跃宿主状态。
 *
 * 现在它同时承载 `storage` / `message-archive` / `ai-cli` / `stats` 四条接缝的解析（见文件后半段）：
 * 持久化层的消费者同样是「构造函数深处自建」（16 处 `createStorage()`、CLI 适配器里的
 * `new MessageArchive()`），没有构造注入通道。`Server/DbUse/index.js` 的 createStorage
 * 门面因此经 createStorageFromHost() 取宿主提供方、无宿主时回落到内置实现；
 * 无宿主时（默认部署形态）行为与迁移前逐字节等价。
 *
 * 为什么 LLM 的兜底必须由调用方注入（不在本文件 import 具体实现）：
 *   本文件是**桥**，它的依赖图会被所有 import 它的模块继承。若在这里静态
 *   `import { LLMClient }`，则 `Server/DbUse/index.js` → 本文件 → llm 门面 →
 *   `plugins/llm/dashscope/llmClient.js` → `openai` 一路被连带加载：任何只是想要
 *   存储能力的模块 —— 包括 DbUse 门面本身，它的依赖图里就有本模块 —— 以及每个
 *   按需加载那扇门面的命令，都会白背一个三方包，也让「拔掉 llm 插件就不再依赖
 *   llm 的东西」这个承诺失效。
 *   所以兜底实现由调用方（Agent / Brain / TestCheck，它们本来就要用 LLM）注入：
 *   `createLlmFromHost(LLMClient)`。桥只认「函数」，不认「哪个类」。
 *   同理，本文件在 `core/` 里也**不得**反向引用任何实现模块：内核只认 `node:`，否则
 *   内核就从「可替换一切的宿主」退化成对某个实现的硬依赖（arch-guard R1）。
 *
 * 兜底缺失即抛错（fail closed）：宿主没提供 `llm` 且调用方也没注入 → 明确报错，
 *   不再静默返回 undefined（后者会在 `new undefined()` 处以毫无信息量的方式炸掉）。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** 默认宿主（三态模型的第 2 态）；null = 没有默认宿主 */
let defaultHost = null;

/**
 * 作用域宿主存储（三态模型的第 1 态）。
 *
 * 只用来存宿主引用：ALS 会在整条 async 调用链上传播 store，因此 `await` 回来的续体
 * 读到的仍是进入作用域时那份宿主。空 store（未进入作用域）在 getStore() 里是
 * undefined，用 `??` 把它和「显式存了 null」一起当作无作用域处理。
 */
const hostScope = new AsyncLocalStorage();

/**
 * 在宿主作用域内执行 fn（并发隔离的唯一正确入口）。
 *
 * 语义：
 *   - 作用域内（含 fn 内部所有 `await` 之后的续体、以及它调用的函数）`getActiveHost()`
 *     优先返回 `host`；对同进程里并发运行的其它调用链不可见；
 *   - 返回 fn 的返回值：同步 fn 得到同步值，`async` fn 得到它的 Promise；
 *   - `host` 为 null / undefined 时不进入作用域，但仍执行 fn（即"没有作用域宿主"这一
 *     档），此时可见的是外层作用域宿主或默认宿主；
 *   - 嵌套调用时内层覆盖外层，内层退出后外层恢复（ALS 天然如此，不需要栈维护）；
 *   - 不负责 dispose：宿主生命周期归调用方（应用级见 appHost.withAppHost）。
 *
 * @template T
 * @param {object|null|undefined} host - 作用域内可见的宿主（鸭子类型即可）
 * @param {() => T} fn - 要在作用域内执行的函数
 * @returns {T} fn 的返回值
 * @throws {TypeError} fn 不是函数
 */
export function runInHostScope(host, fn) {
    if (typeof fn !== 'function') throw new TypeError('runInHostScope(host, fn): fn 必须是函数');
    if (host === null || host === undefined) return fn();
    return hostScope.run(host, fn);
}

/**
 * 设置**默认宿主**（整进程共享；不改动任何作用域宿主）。
 *
 * 覆盖守卫：已经有一个**不同**的默认宿主时抛错。理由：默认宿主是进程级单例，静默覆盖
 * 会让先设置者的消费者在下一个 await 之后突然用上别人的实现——这类串味没有栈可查，
 * 是最难诊断的一类问题。要替换就先 clearActiveHost()，要并存就用 runInHostScope。
 *
 * 幂等：`setActiveHost(null)`（等价于 clear）与「同一实例重复 set」都不抛错。
 * 错误信息只含说明文字，不插值宿主对象（不向调用方泄露实例内部、也不会因为宿主
 * 实现了奇怪的 toString 而二次炸掉）。
 *
 * @param {object|null} host - PluginHost 实例（或其鸭子类型：只需要 has/inject）
 * @throws {Error} 已存在另一个不同的默认宿主时
 */
export function setActiveHost(host) {
    const next = host ?? null;
    if (next !== null && defaultHost !== null && defaultHost !== next) {
        throw new Error(
            'hostBridge.setActiveHost：进程内已存在另一个默认宿主，拒绝覆盖。' +
                '一个进程只应有一个默认宿主；多宿主请用 runInHostScope(host, fn) 做作用域隔离；' +
                '确实要替换请先 clearActiveHost()。'
        );
    }
    defaultHost = next;
}

/** 清除默认宿主，回到「没有默认宿主」（作用域宿主不受影响）。 */
export function clearActiveHost() {
    defaultHost = null;
}

/**
 * 当前活跃宿主：作用域宿主优先，其次默认宿主，都没有则 null。
 * @returns {object|null} 当前活跃宿主（可能未 load）
 */
export function getActiveHost() {
    return hostScope.getStore() ?? defaultHost;
}

/** @returns {boolean} 当前是否存在活跃宿主（作用域或默认） */
export function hasActiveHost() {
    return getActiveHost() !== null;
}

/**
 * 解析能力接缝的提供方（按「作用域 > 默认 > 无宿主」取宿主）。
 * @param {string} seamName - 接缝名（如 'llm'）
 * @returns {unknown|null} 宿主注册的提供方；无宿主/无该接缝时返回 null
 */
export function resolveSeamProvider(seamName) {
    const host = getActiveHost();
    if (!host || !seamName) return null;
    return host.has(seamName) ? host.inject(seamName) : null;
}

/**
 * 「缺兜底」的明确错误：宿主没提供 `llm`，调用方也没注入。
 * @param {string} apiName - 触发方（resolveLlmClass / createLlmFromHost）
 * @returns {Error}
 */
function _missingLlmFallback(apiName) {
    return new Error(
        `${apiName}：宿主未提供 'llm' 接缝，且调用方未传入内置回落实现。` +
            '兜底必须由调用方注入，例如 createLlmFromHost(LLMClient)；' +
            '桥不静态依赖任何具体 LLM 实现，否则每个 import 本模块的模块都会被连带加载该实现的依赖'
    );
}

/**
 * 解析 `llm` 接缝提供的类。
 * @param {Function} fallback - 无宿主时的内置实现（由调用方注入，必填；缺失即抛错）
 * @returns {Function} 提供方类（宿主若注册了实例，也原样返回实例）
 * @throws {Error} 宿主未提供 `llm` 且未传入 fallback 时抛错
 */
export function resolveLlmClass(fallback) {
    const provider = resolveSeamProvider('llm');
    if (provider !== null && provider !== undefined) return provider;
    if (typeof fallback !== 'function') throw _missingLlmFallback('resolveLlmClass');
    return fallback;
}

/**
 * 消费者专用：有宿主用宿主提供的 LLM 类实例化，否则用调用方注入的实现。
 * 无宿主时与改造前的 `new LLMClient()` 完全等价（同一个类、同样无参、同样时机）。
 * @param {Function} fallback - 内置实现（由调用方注入，必填）
 * @returns {object} LLM 客户端实例
 * @throws {Error} 宿主未提供 `llm` 且未传入 fallback 时抛错
 */
export function createLlmFromHost(fallback) {
    const Provider = resolveLlmClass(fallback);
    // 接缝契约要求注册的是类；容忍已实例化的提供方，避免在深层构造函数里硬崩。
    return typeof Provider === 'function' ? new Provider() : Provider;
}

// ─── storage 接缝（契约见 seams/storage.js）─────────────────────────────────

/**
 * 解析 `storage` 接缝提供的工厂（`createStorage` 门面）。
 * @param {Function|null} [fallback=null] - 无宿主时的内置实现
 * @returns {Function|null} 工厂函数；无宿主且未给回落时返回 null
 */
export function resolveStorageFactory(fallback = null) {
    return resolveSeamProvider('storage') ?? fallback;
}

/**
 * 消费者专用：有宿主且宿主注册了 `storage` → 用宿主提供的工厂造门面，
 * 否则回落到内置实现（`Server/DbUse/index.js` 传入自己的实现）。
 *
 * 无宿主时与改造前的 `createStorage(options)` 完全等价：同一个函数、同样的
 * options、同一时机（同步返回，不引入 await）。
 *
 * 注意：宿主提供的提供方若不是函数（接缝契约要求是工厂），按回落处理而不是抛错
 * ——桥不能变成新的故障点，与 createLlmFromHost 的容忍策略一致。
 *
 * @param {object} [options={}] - createStorage 的入参（rootDir / stallThresholdMs …）
 * @param {Function|null} [fallback=null] - 内置实现（必填，缺失则抛错）
 * @returns {object} 存储门面
 */
export function createStorageFromHost(options = {}, fallback = null) {
    const factory = resolveSeamProvider('storage');
    if (typeof factory === 'function') return factory(options);
    if (typeof fallback !== 'function') {
        throw new Error(
            'createStorageFromHost：宿主未提供 storage 接缝，且未传入内置回落实现'
        );
    }
    return fallback(options);
}

// ─── message-archive 接缝（契约见 seams/message-archive.js）─────────────────

/**
 * 解析 `message-archive` 接缝提供的工厂（`(options) => new MessageArchive(options)`）。
 *
 * 消费者：`Server/CLI/cli.js`（AI CLI 门面）——遗留兜底路径里若调用方没给
 * `options.archive`，就先问宿主要这条接缝的工厂，没有宿主才退回内置 `MessageArchive`。
 * 适配器侧的接线在插件里（`plugins/cli/*` 的 `ai-cli` 工厂直接
 * `ctx.inject('message-archive')`，连这层桥都不经过）。
 *
 * @param {Function|null} [fallback=null] - 无宿主时的内置实现
 * @returns {Function|null} 工厂函数；无宿主且未给回落时返回 null
 */
export function resolveMessageArchiveFactory(fallback = null) {
    return resolveSeamProvider('message-archive') ?? fallback;
}

// ─── ai-cli 接缝（契约见 seams/ai-cli.js）────────────────────────────────────

/**
 * 解析 `ai-cli` 接缝提供的工厂（`(options) => adapter`）。
 *
 * 顺序（**两档都必须与 type 对得上**）：
 *   1. 限定名 `ai-cli@cli/<type>` —— 类型专属提供方（正常路径：profile 里的
 *      cli/opencode / cli/deveco-code 各自注册自己那份，消费者按 type 精确命中，
 *      与提供方的注册顺序无关）；
 *   2. 裸名 `ai-cli`，但**只有当它的提供方插件名恰好是 `cli/<type>`** 时才采用。
 *      裸名是「当前生效的提供方」，用 `host.listServices()` 能读出 provider；
 *      提供方不是 `cli/<type>` 就当作解析不到；
 *   3. 否则 → `null`，交给门面走遗留兜底（不抛错——桥不能变成新的故障点）。
 *
 * 为什么第 2 档要绑定提供方身份（而不是"谁顶上就用谁"）：
 *   `CLIController.getType()` 会一直返回入参 type，而它被 `cli/lib/opencode.js` 的
 *   `CliServeManager` 用来决定**拉起哪个 serve、哪个端口**。若允许"裸名随便顶替"，
 *   只装 cli/opencode 却构造 `new CLIController('deveco-code')` 就会得到一个
 *   `getType()==='deveco-code'` 但实现是 OpenCodeCLI（`meta.cliType` 写 'opencode'）
 *   的**说谎适配器**——那是真实 bug 温床，不是"可接受的语义代价"。
 *   因此规则收紧为：**能顶上某个 type 的提供方，必须是该 type 的插件**。
 *   要引入全新 CLI（如 cli/claude-code），把类型名写进 `Server/CLI/cli.js` 的
 *   `SUPPORTED_TYPES`，插件名与该类型对应即可；单纯换个插件名注册裸名 `ai-cli`
 *   不再能顶替现有类型（那只会让 type 与实现不一致）。
 *
 * 查不到提供方（宿主是鸭子类型、没有 listServices）时同样按"解析不到"处理：
 * 宁可回落已知实现，也不交给一个身份不明的提供方。
 *
 * @param {string} type - CLI 类型（'opencode' | 'deveco-code'）
 * @returns {Function|null} 工厂函数；无宿主 / 宿主没有**该类型**的提供方 / 提供方不是函数时返回 null
 */
export function resolveAiCliFactory(type) {
    const host = getActiveHost();
    if (!host || !type) return null;

    const qualified = `ai-cli@cli/${type}`;
    if (host.has(qualified)) {
        const provider = host.inject(qualified);
        return typeof provider === 'function' ? provider : null;
    }

    if (!host.has('ai-cli')) return null;
    // 裸名只在"提供方就是这个类型的插件"时才算数（见上面为什么）
    if (_bareAiCliProvider(host) !== `cli/${type}`) return null;
    const provider = host.inject('ai-cli');
    // 契约要求工厂；宿主给了别的东西时按「解析不到」处理（回落，而不是炸在调用点）
    return typeof provider === 'function' ? provider : null;
}

/**
 * 裸名 `ai-cli` 当前由哪个插件提供（`host.listServices()` 的公开信息）。
 * @param {object} host - 本次解析使用的宿主（作用域优先，由调用方传入）
 * @returns {string|null} 提供方插件名；宿主没实现 listServices / 没有该服务时 null
 */
function _bareAiCliProvider(host) {
    if (typeof host?.listServices !== 'function') return null;
    const hit = host.listServices().find((s) => s && s.service === 'ai-cli');
    return hit?.provider ?? null;
}

// ─── stats 接缝（契约见 seams/stats.js）─────────────────────────────────────

/**
 * 解析 `stats` 接缝的提供方（统计计数类）。
 *
 * 消费者：`Server/CLI/cli.js` 的 `startSession()`——统计是"CLI 门面顺手记一笔"的
 * 旁路能力，不是 CLI 适配能力，所以它不在 `ai-cli` 工厂里，而是走这条独立接缝。
 *
 * 语义（与 resolveSeamProvider 一致，但显式点名，便于在调用点读出意图）：
 *   - 有宿主且宿主注册了 `stats` → 返回提供方（`plugins/stats/core` 注册的是类，
 *     消费者的调用形状 `stats.incrementSessionCount()` 直接可用）；
 *   - 无宿主 / 宿主没 load / 宿主没有该服务 → 返回 `null`，**不抛错**：
 *     调用点写 `resolveStats() ?? StatsService` 回落到门面里的同一实现，
 *     无宿主时与迁移前逐字节等价（同一个类、同样的静态方法、同样的时机）。
 *
 * @returns {unknown|null} 提供方；解析不到时 null
 */
export function resolveStats() {
    return resolveSeamProvider('stats');
}
