/**
 * seams/ai-cli.js — AI 编程助手 CLI 提供方契约（能力接缝）
 *
 * 接缝三角（对应 DSH 的 Service Definition / Provider / Consumer）：
 *   - Service Definition：本文件（契约：服务名 + 工厂形状 + 方法清单）；
 *   - Provider：`plugins/cli/opencode`、`plugins/cli/deveco-code`（未来可插
 *     claude-code / gemini-cli / 任意 OpenAI 兼容 serve）；
 *   - Consumer：CLIController 门面（`Server/CLI/cli.js`）→ Brain / TestCheck /
 *     FlexRunner / KnowledgeImporter（只依赖裸名 `ai-cli`，不感知具体提供方）。
 *
 * 提供方注册的服务是**工厂函数**（而非单例、不是类）：
 *     ctx.provide('ai-cli', (options) => new OpenCodeCLI(options));
 * 因为不同调用方需要不同的连接配置（端口 / 存档 / 取消信号），单例化会重新引入耦合。
 * 消费者拿到工厂自己调用：`host.inject('ai-cli')(options)`；无宿主时门面回落到
 * 内置适配器（`Server/CLI/cli.js` 的 legacyCreate），行为与插件化之前逐字节等价。
 *
 * ── 同族适配器的基类：`ai-cli-impl@<插件名>`（**约定，不是强制**）────────────────
 * 一条接缝可以有多个提供方，而某些提供方之间是「同族」关系：DevEco Code 由 OpenCode
 * 扩展而来，HTTP API 完全一致，它的适配器只是 `extends OpenCodeCLI` + 覆盖连接配置。
 * 这类基类**不作为接缝对外暴露**（消费者不该看见「哪个类」），而是按下面的约定，
 * 由提供方把实现类再注册一份**限定名**服务供同族插件继承：
 *
 *     // plugins/cli/opencode/index.js
 *     ctx.provide('ai-cli', factory);            // 接缝：工厂（消费者用这个）
 *     ctx.provide('ai-cli-impl', OpenCodeCLI);   // 约定：基类注入点（同族插件用这个）
 *
 *     // plugins/cli/deveco-code/index.js
 *     const Base = ctx.inject('ai-cli-impl@cli/opencode');   // 限定名 → 指定提供方
 *     class DevEcoCodeCLI extends Base { ... }
 *
 * 为什么是「插件依赖 + 限定名注入」而不是跨插件 import：
 *   1. arch-guard R2 禁止跨插件相对引用——两个插件互相牵手时，摘掉任一插件整个系统
 *      就起不来，那正是插件化要消灭的耦合；`plugin.json` 的 `dependencies` 才是合法通道。
 *   2. 用限定名 `ai-cli-impl@cli/opencode` 而不是裸名 `ai-cli-impl`：裸名会随注册顺序
 *      被别的提供方覆盖（Context.provide 的「后注册者生效」），同族继承必须精确指定
 *      自己依赖的那个插件，而不是「现在谁顶着」。
 *   3. 它是约定而非契约：不写进 `methods` / `factoryOptions`，消费者**不得**依赖它。
 *      没有同族关系的提供方（如独立的 claude-code 适配器）完全不注册这个服务，
 *      照样满足本契约。
 *
 * 为什么 `factoryOptions` 里有 `archive`：
 *   提供方自己不允许认识归档实现（那是 `message-archive` 接缝的事），所以适配器**要求**
 *   `options.archive` 被注入；两个插件都在注册的工厂里做
 *   `archive: options.archive ?? inject('message-archive')(options)`。
 *   直接把 `new MessageArchive()` 写进适配器的日子结束了（那会让 cli 插件伸手进 storage 插件）。
 *   不走工厂、**直接 `new` 适配器类**的用法（`Server/CLI/opencode.js` 这类快捷导出）由适配器类上的
 *   静态钩子 `defaultArchiveFactory` 兜底：插件 setup 把同一条接缝的工厂挂上去，无宿主时由
 *   Server 侧门面挂内置实现。钩子是可选的，但"注册了工厂"就必须让同一个类的直接构造也能工作
 *   （否则同一个类会出现"插件内能用、单独用就抛"的两套行为）。
 *
 * ── 契约 v2（本次清算）：适配器方法 ≠ 门面方法 ────────────────────────────────
 * v1 的 `methods` 里列了 `getType`，但**没有任何适配器实现它**——它一直是门面
 * `CLIController`（`Server/CLI/cli.js`）的方法，适配器根本没有这个概念
 * （适配器只知道自己的 `cliType` 静态字段）。这是迁移之前就存在的声明/实现偏差，
 * 因为当时没有任何测试把"契约声明"与"提供方实现"对起来，所以只能靠人肉发现。
 *
 * 判定依据（以真实实现为准，不是愿望清单）：
 *   - `plugins/cli/opencode/adapter.js` 的公开方法定义（去掉 `_` 前缀的内部方法）共 17 个：
 *     checkHealth / listSessions / getSession / deleteSession / abortSession / sendMessage /
 *     sendAndWaitMessage / injectPrompt / startSession / checkSessionStatus / getSessionMessages /
 *     getLiveMessages / exportSession / getArchivedMessages / getArchiveMeta /
 *     setAbortSignal / abortInFlight —— **没有 getType**；
 *   - `plugins/cli/deveco-code/index.js` 的 `DevEcoCodeCLI` 只覆盖 `checkHealth`，其余继承
 *     基类 `OpenCodeCLI`，同样没有 `getType`。
 *
 * 因此 v2 把两类方法显式分开（与 `seams/storage.js` v2 同一个思路：契约只写提供方
 * 真的必须给出的东西，其余归到门面自己的账上）：
 *   - `methods`（17 条）= **适配器（工厂产物）必须实现**的方法；
 *   - `facade.own` = **门面自有**方法：只存在于 `CLIController`，适配器不得被要求实现
 *     （`getType` 就在这里；`listArchivedSessions` 同样归门面——它读的是注入属性
 *     `adapter.archive`，不是适配器契约方法）；
 *   - `facade.forwarded` = 门面转发、同时也属于适配器能力面的两项
 *     （`setAbortSignal` / `abortInFlight`：门面先 `typeof` 检查再委派，适配器缺了会静默降级；
 *     现有两个提供方都实现，故仍留在 `methods` 里）。
 *
 * 机器可检验：`test/m9-contract-conformance/` 用真宿主 + 真门面类逐条对照本文件，
 * 任何与实现不符的声明（多写、少写、把门面方法当适配器方法）都会让该套件报红，
 * 并逐条打印缺失项。
 */

export const AI_CLI_SEAM = Object.freeze({
    name: 'ai-cli',
    version: 2,
    factory: true,
    description: 'AI 编程助手 CLI 提供方：统一 Session 管理接口（健康检查/会话/消息/取消）',
    /**
     * 工厂入参（提供方必须全部支持，未知项忽略）——逐条对齐 `new OpenCodeCLI(options)`：
     *   host / port / baseUrl / requestTimeoutMs / archive(MessageArchive) / stallThresholdMs
     *
     * `archive` 是**必填语义**（提供方的工厂负责补齐，见文件头），其余全部可选：
     *   - `host` / `port` / `baseUrl`：连接配置（baseUrl 优先于 host+port）；
     *   - `requestTimeoutMs`：单请求超时（0 = 不超时）；
     *   - `stallThresholdMs`：卡死/busy 停滞判定阈值（ms）。不传时适配器读归档契约的
     *     `stallThresholdMs` 属性（见 seams/message-archive.js），两者都没有则 5 分钟。
     *     v1 只在说明里提它、没列进本数组，m9 因此无法断言工厂接受它——v2 补进来。
     */
    factoryOptions: Object.freeze([
        'host',
        'port',
        'baseUrl',
        'requestTimeoutMs',
        'archive',
        'stallThresholdMs',
    ]),
    /**
     * 工厂产物（适配器实例）必须实现的方法：17 条，逐条对齐
     * `plugins/cli/opencode/adapter.js` 的公开方法定义（`_` 前缀的内部方法不算契约）。
     * 门面自有方法**不在**这里——见下面的 `facade` 区块。
     */
    methods: Object.freeze([
        'checkHealth',
        'listSessions',
        'getSession',
        'deleteSession',
        'abortSession',
        'sendMessage',
        'sendAndWaitMessage',
        'injectPrompt',
        'startSession',
        'checkSessionStatus',
        'getSessionMessages',
        'getArchivedMessages',
        'getLiveMessages',
        'exportSession',
        'getArchiveMeta',
        'setAbortSignal',
        'abortInFlight',
    ]),
    /**
     * 门面（`CLIController`，`Server/CLI/cli.js`）自己的账：**不是适配器契约**。
     * 为什么单独记：v1 把 `getType` 混进 `methods`，等于要求每个适配器实现一个它
     * 无权知道的东西（适配器只认自己的 cliType）。分开之后，"门面能做什么"与
     * "提供方必须给什么"可以各自演进，m9 也能分别断言（门面方法在门面上、
     * 不在适配器契约里）。
     */
    facade: Object.freeze({
        /** 门面自有：只存在于 CLIController，**不得**出现在 `methods` 里 */
        own: Object.freeze(['getType', 'getAdapter', 'listArchivedSessions']),
        /** 门面转发：门面逐方法委派给适配器，因此它们同时也是适配器能力面（见 `methods`） */
        forwarded: Object.freeze(['setAbortSignal', 'abortInFlight']),
        /** 逐条说明（消费者/维护者看的人类可读部分，不含机器判定） */
        notes: Object.freeze({
            getType: '门面自有：返回构造 CLIController 时的 type（opencode / deveco-code）。适配器没有这个概念 —— v1 误列为适配器方法，v2 移出。',
            getAdapter: '门面自有：返回底层适配器实例（高级用途），适配器无需求。',
            listArchivedSessions:
                '门面自有：它读的是注入属性 `adapter.archive`（该属性由适配器从 message-archive 接缝拿到），不是适配器的契约方法。',
            setAbortSignal:
                '门面转发：`if (typeof adapter.setAbortSignal === "function") adapter.setAbortSignal(signal)`——适配器可以没有，门面静默降级；现有两个提供方都实现，故仍列为必需。',
            abortInFlight:
                '门面转发：语义同 setAbortSignal（`typeof` 检查后委派，缺了静默降级）；现有两个提供方都实现，故仍列为必需。',
        }),
    }),
});

export default AI_CLI_SEAM;
