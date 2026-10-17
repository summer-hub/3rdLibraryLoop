/**
 * buildApp —— 依赖装配唯一入口（Composition Root）
 *
 * 为什么单独抽出：HTTP 模式（Server/Routes/server.js）与嵌入式 CLI 模式
 * （cli/lib/runner.js）装的是同一套引擎（CLIController / storage / 四个 Controller /
 * Knowledge），过去两处各写一遍手工装配，任何构造参数调整都要同步改两处，且已经出现
 * 事实漂移（cli archive 指向、skillDirectory 兜底值、是否注入共享 cli）。现在两端都只
 * 调这里，差异收敛成显式选项，装配只存在一处。
 *
 * 为什么放在 Server/ 而不是仓库根：发布态 CLI 用 cli/vendor/Server 下的引擎副本
 * （cli/scripts/prepack.mjs 只复制 Server/ 内的模块），装配点必须随引擎一起走；
 * runner.js 侧用 resolveVendorServer() + file:// 动态 import 加载，开发态/发布态同构。
 *
 * 返回对象的键集合＝server.js 历史 dependencies 的 11 个键 + 第 12 个键 `host`
 * （插件宿主引用，未传 `host` 时为 null）+ 第 13 个键 `engineClasses`（本次装配实际使用的
 * 引擎类，无宿主时五项全 null），供 registerRoutes(router, dependencies) 直接使用。
 *
 * 插件宿主（`options.host`，可选）：传了就已 load 的宿主＝「能力由插件提供」，
 * 装配层改从接缝取（storage / stats / **五个引擎**）；不传＝旧装配路径，逐字节不变。
 * 本函数**不改变进程级活跃宿主**——「激活宿主」由入口负责
 * （`Server/composition/appHost.js` 的 `activateAppHost()`），原因见函数体内注释。
 * 这条分支的失败一律 fail closed（抛错 + 可诊断信息），不静默回落。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerEnv } from './envBootstrap.js';
import { CLIController } from '../CLI/cli.js';
import SseHub from '../Routes/sse/SseHub.js';
import FlexRunnerController from '../Routes/controllers/FlexRunnerController.js';
import OrchestratorController from '../Routes/controllers/OrchestratorController.js';
import BrainController from '../Routes/controllers/BrainController.js';
import LoopEngineController from '../Routes/controllers/LoopEngineController.js';
import KnowledgeImportController from '../Routes/controllers/KnowledgeImportController.js';
import { TestCheck } from '../TestCheck/index.js';
import { createStorage } from '../DbUse/index.js';
import { KnowledgeManager } from '../Knowledge/index.js';

// 默认 SKILL 根目录：<Server>/Skills。本文件在 Server/composition/ 下，上溯一级即 Server/，
// 与 server.js 原先在 Server/Routes/ 下 `path.resolve(__dirname, '..', 'Skills')` 等价。
const DEFAULT_SKILL_DIRECTORY = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'Skills'
);

/**
 * 装配共享依赖（所有 Controller 复用同一批单例）。
 *
 * @param {object} [options]
 * @param {string} [options.cliType]                - CLI 类型，默认取环境变量 CLI_TYPE，仍未设置则 'deveco-code'
 * @param {object} [options.cliOptions={}]          - 传给 CLIController 的配置
 * @param {object} [options.cli=null]               - 预置 CLIController 实例（优先于 cliType/cliOptions）
 * @param {object} [options.storageOptions]         - 透传给 createStorage；不传＝createStorage()（默认工作区根）
 * @param {string} [options.skillDirectory]         - SKILL 根目录，默认 <Server>/Skills
 * @param {string|null} [options.orchestratorSkillDirectory] - OrchestratorController 的兜底 SKILL 目录；
 *        不传＝同 skillDirectory，传 null＝不注入（控制器回落 ''）
 * @param {object|null} [options.sseHub]            - SseHub 三态：不传＝自建；null＝不创建；实例＝复用
 * @param {object|null} [options.knowledgeManager]  - KnowledgeManager 三态：不传＝自建并 init；null＝不创建；实例＝复用
 * @param {boolean} [options.shareCliWithControllers=false] - 把装配出的共享 CLI 注入 BrainController/TestCheck
 * @param {boolean} [options.attachCliArchive=false]        - 把 storage.messageArchive() 作为 CLI 的 archive 注入
 * @param {object|null} [options.host]              - 已 load 的插件宿主。三态：
 *        不传/null＝旧装配路径（内置实现，逐字节不变）；
 *        实例＝从接缝取能力（storage/stats/engine-*），并把宿主原样回传到 dependencies.host。
 *        **不改动进程活跃宿主**：需要让深处消费者看见它，先调 appHost.activateAppHost()
 * @param {'require'|'allow-builtin'} [options.engineSeams] - 引擎接缝两态（只在传了 `host` 时生效）：
 *        `'require'`（默认）＝五条 `engine-*` 接缝缺任何一条就抛错（fail closed），绝不静默回落门面类；
 *        `'allow-builtin'`＝缺失的接缝回落门面类（等价于改造前行为），**只给测试/过渡期当逃生阀**。
 * @returns {Promise<object>} dependencies（13 个键：历史 11 个 + `host` + `engineClasses`）
 */
export async function buildApp(options = {}) {
    // 环境引导放在装配点最前面：CLI_TYPE / OPENCODE_HOST 等配置的读取者遍布下面每个
    // Controller，而装配是唯一共同的入口。幂等，CLI 门面里的遗留引导（见 cli.js）重复调用无害。
    await loadServerEnv();

    const {
        cliType = process.env.CLI_TYPE || 'deveco-code',
        cliOptions = {},
        cli = null,
        storageOptions,
        skillDirectory,
        orchestratorSkillDirectory,
        sseHub,
        knowledgeManager,
        shareCliWithControllers = false,
        attachCliArchive = false,
        host = undefined,
        engineSeams
    } = options;

    const resolvedSkillDirectory = skillDirectory ?? DEFAULT_SKILL_DIRECTORY;

    // ─── 插件宿主分支 ─────────────────────────────────────────────────────────
    // 未传 host：下面每个 `createStorage()` / 自建实例都是旧路径，逐字节不变。
    // 传了 host：能力改由插件提供。
    //
    // 本函数**只读地使用**传入的宿主，**不改变**进程级活跃宿主（不调 setActiveHost）：
    // 装配点会被反复调用（每个 RunContext、每个测试、甚至每个请求），而默认宿主的语义是
    // 「一进程一个应用」。在这里 set 一次就等于把 hostBridge 的覆盖守卫变成随机抛错源。
    // 「让消费者看见宿主」是入口的职责：Server/Routes/server.js 与 cli/lib/runner.js 都先
    // 调 appHost.activateAppHost() 再调本函数，因此 CLIController（构造期解析 ai-cli）与
    // Agent/Brain/TestCheck（构造深处解析 llm）能解析到它；直接调用本函数而不激活宿主时，
    // storage / stats 仍走传入的宿主接缝，而 ai-cli / llm 解析会回落到内置实现。
    const activeHost = host ?? null;
    let storage;
    let hostStats;
    // 引擎类（五个）：无宿主时全 null＝下面每个 `new` 都用门面导入的类（旧路径）。
    // 有宿主时先解析（可能 fail closed），再装配——顺序上放在 storage 之前只是为了
    // 让「能力由插件提供」这条判据尽早成立，避免先建出资源再抛错。
    const engineClasses = resolveEngineClasses(activeHost, engineSeams);
    if (activeHost) {
        storage = createStorageFromSeam(activeHost, storageOptions);
        hostStats = activeHost.has('stats') ? activeHost.inject('stats') : undefined;
    } else {
        storage = storageOptions === undefined
            ? createStorage()
            : createStorage(storageOptions);
    }

    // 显式注入优先于全局桥：调用方传进来的 cliOptions.stats 覆盖宿主接缝提供的类
    // （与 CLIController 的「显式 > 活跃宿主 > 内置」优先级链一致）。
    const hostCliOptions = hostStats === undefined
        ? cliOptions
        : { stats: hostStats, ...cliOptions };

    // CLI 嵌入式模式的会话归档必须指向本次装配的 storage（用户数据目录），
    // 否则 CLIController 内部默认 MessageArchive 会落到引擎副本相对路径。
    const resolvedCliOptions = attachCliArchive
        ? { ...hostCliOptions, archive: storage.messageArchive() }
        : hostCliOptions;
    const cliInstance = cli || new CLIController(cliType, resolvedCliOptions);

    // SseHub 构造函数会起心跳 + 清理两个 setInterval：CLI 常驻进程一旦持有它就无法自然退出，
    // 所以除「实例」外必须能表达「不要创建」。
    const hub = sseHub === undefined ? new SseHub() : sseHub;

    // OrchestratorController：有状态（管理多个编排器实例），需单例。
    // skillDirectory 仅用于 HTTP load 的 taskDef 兜底，故允许不注入（嵌入式模式不需要）。
    const orchestratorController = new OrchestratorController({
        sseHub: hub,
        storage,
        flexRunnerFactory: null,
        // 引擎类走接缝（`engine-orchestrator` 注册的就是门面转发的那同一个类对象）；
        // null＝无宿主/逃生阀，控制器回落自己的门面导入。
        OrchestratorClass: engineClasses.orchestrator,
        skillDirectory: orchestratorSkillDirectory === undefined
            ? resolvedSkillDirectory
            : (orchestratorSkillDirectory || undefined)
    });

    // FlexRunnerController：有状态（管理多个 FlexRunner 实例），需单例。
    // 注入 orchestratorController 使其能查找编排器创建的实例；
    // 注入 storage 使其在没有活跃 runner 时能直接读取 session 归档。
    const flexRunnerController = new FlexRunnerController({ orchestratorController, storage });

    // BrainController / TestCheck：管理 Brain 拆解与准出审核实例（单例，复用 LLM 连接）。
    // shareCliWithControllers 让二者复用共享 CLI——若不注入，它们会各自惰性 new CLIController()，
    // 会话归档落到引擎副本相对路径（CLI 侧 cli/db 数据错位教训）。
    const sharedCli = shareCliWithControllers ? cliInstance : null;
    const brainController = new BrainController({
        sseHub: hub,
        storage,
        orchestratorController,
        BrainClass: engineClasses.brain,
        skillDirectory: resolvedSkillDirectory,
        cli: sharedCli
    });

    const TestCheckClass = engineClasses.testCheck ?? TestCheck;
    const testCheck = new TestCheckClass({
        sseHub: hub,
        storage,
        skillDirectory: resolvedSkillDirectory,
        cli: sharedCli
    });

    // LoopEngineController：管理大循环实例（单例，依赖 Brain + Orchestrator + TestCheck）
    const loopEngineController = new LoopEngineController({
        sseHub: hub,
        storage,
        brainController,
        orchestratorController,
        testCheck,
        LoopEngineClass: engineClasses.loop,
        skillDirectory: resolvedSkillDirectory
    });

    // KnowledgeManager：知识沉淀单例。init() 会落盘知识库索引，嵌入式模式不希望每个命令
    // 都额外初始化一份存储根，故除「实例」外必须能表达「不要创建」。
    let resolvedKnowledgeManager;
    if (knowledgeManager === undefined) {
        const KnowledgeManagerClass = engineClasses.knowledge ?? KnowledgeManager;
        resolvedKnowledgeManager = new KnowledgeManagerClass();
        await resolvedKnowledgeManager.init();
    } else {
        resolvedKnowledgeManager = knowledgeManager;
    }

    // KnowledgeImportController：知识导入控制器（复用 CLI + KnowledgeManager）
    const knowledgeImportController = new KnowledgeImportController({
        cli: cliInstance,
        storage,
        skillDirectory: resolvedSkillDirectory,
        knowledgeManager: resolvedKnowledgeManager,
        sseHub: hub
    });

    return {
        cli: cliInstance,
        sseHub: hub,
        storage,
        flexRunnerController,
        orchestratorController,
        brainController,
        testCheck,
        loopEngineController,
        knowledgeManager: resolvedKnowledgeManager,
        knowledgeImportController,
        skillDirectory: resolvedSkillDirectory,
        // 第 12 个键：回传宿主引用（未传 host 时为 null）。入口侧据此在停机时释放它，
        // 测试也可据此断言「装配确实用了这个宿主」。
        host: activeHost,
        // 第 13 个键：本次装配**实际使用**的引擎类（{ brain, testCheck, orchestrator, loop, knowledge }）。
        // 无宿主时五项全 null（＝用门面导入的类）；有宿主时是接缝注入的类，测试据此断言
        // 「装配确实从接缝取引擎」，而不是碰巧门面相同。
        engineClasses
    };
}

// 引擎接缝表：seam 名 → engineClasses 键 + profile 里提供它的插件。
// 五个引擎各自一个接缝（注册的都是**类**，见 seams/engine-*.js），因此装配层是
// 「取类 → 交给控制器自己 new」，不做单例托管。
const ENGINE_SEAMS = [
    { seam: 'engine-brain', key: 'brain', plugin: 'engines/brain', consumer: 'BrainController' },
    { seam: 'engine-testcheck', key: 'testCheck', plugin: 'engines/testcheck', consumer: 'TestCheck' },
    { seam: 'engine-orchestrator', key: 'orchestrator', plugin: 'engines/orchestrator', consumer: 'OrchestratorController' },
    { seam: 'engine-loop', key: 'loop', plugin: 'engines/loopengine', consumer: 'LoopEngineController' },
    { seam: 'engine-knowledge', key: 'knowledge', plugin: 'engines/knowledge', consumer: 'KnowledgeManager' }
];

/**
 * 从宿主解析五个引擎接缝提供的类。
 *
 * 无宿主：五项全 null（装配走门面导入的类，与改造前逐字节一致）。
 * 有宿主 + `'require'`（默认）：缺任何一条接缝就抛错（fail closed）。
 *   静默回落门面类会让「装配看起来成功、实际一半引擎来自内置实现」，而这正是本次改造
 *   要消灭的形态——插件没启用就必须在启动时炸掉，而不是跑出一个混合体。
 * 有宿主 + `'allow-builtin'`：缺失项留 null，由调用点的 `?? 门面类` 回落。
 *   **只给测试与过渡期当逃生阀用，不是默认值。**
 *
 * @param {object|null} host - 已 load 的宿主（鸭子类型：has/inject/listServices）
 * @param {'require'|'allow-builtin'} [mode] - 缺接缝时的策略
 * @returns {{brain: Function|null, testCheck: Function|null, orchestrator: Function|null, loop: Function|null, knowledge: Function|null}}
 * @throws {Error} `'require'` 模式下接缝缺失、或接缝注册值不是类
 */
function resolveEngineClasses(host, mode) {
    const engineClasses = {
        brain: null,
        testCheck: null,
        orchestrator: null,
        loop: null,
        knowledge: null
    };
    if (!host) return engineClasses;

    if (mode !== undefined && mode !== 'require' && mode !== 'allow-builtin') {
        throw new Error(
            `buildApp({ host })：engineSeams 只能是 'require'（默认）或 'allow-builtin'，` +
            `收到的是 ${JSON.stringify(mode)}`
        );
    }

    const missing = [];
    for (const { seam, key } of ENGINE_SEAMS) {
        const provider = host.has(seam) ? host.inject(seam) : undefined;
        if (typeof provider === 'function') {
            engineClasses[key] = provider;
            continue;
        }
        missing.push(
            provider === undefined
                ? seam
                : `${seam}（注册值不是类，typeof=${typeof provider}）`
        );
    }
    if (missing.length === 0 || mode === 'allow-builtin') return engineClasses;

    const fixes = ENGINE_SEAMS
        .filter(({ key }) => engineClasses[key] === null)
        .map(({ seam, plugin, consumer }) => `${seam} → 启用插件 ${plugin}（供 ${consumer} 使用）`);
    throw new Error(
        `buildApp({ host })：宿主缺少必需的引擎接缝，且不允许回落内置实现（fail closed）。\n` +
        `缺失接缝: ${missing.join(', ')}\n` +
        `已注册接缝: ${listSeamNames(host)}\n` +
        `修法一（推荐）：在 profile 里启用对应插件 ——\n  ${fixes.join('\n  ')}\n` +
        `修法二（逃生阀，仅测试/过渡期）：显式传 engineSeams: 'allow-builtin'，让缺失的接缝回落门面类。`
    );
}

/**
 * 从宿主的 `storage` 接缝取存储门面。
 *
 * 有宿主时**不允许回落**内置实现（fail closed）：宿主存在就代表「能力由插件提供」，
 * 静默回落会让装配看起来成功、实际有两套存储并存（数据错位是最难排查的一类故障）。
 * 因此缺接缝 / 接缝不是工厂 / 工厂返回空值 三种情况都抛错，并给出可用接缝清单。
 *
 * @param {object} host - 已 load 的宿主（鸭子类型：has/inject/listServices）
 * @param {object} [storageOptions] - 透传给接缝工厂（{rootDir} 或 undefined）
 * @returns {object} 存储门面
 * @throws {Error} 接缝缺失或不可用时
 */
function createStorageFromSeam(host, storageOptions) {
    if (!host.has('storage')) {
        throw new Error(
            `buildApp({ host })：宿主缺少必需的 'storage' 接缝，且不允许回落内置实现（fail closed）。` +
            `可用接缝: ${listSeamNames(host)}。请检查 profile 是否启用了 storage/core`
        );
    }
    const factory = host.inject('storage');
    if (typeof factory !== 'function') {
        throw new Error(
            `buildApp({ host })：宿主注册的 'storage' 接缝不是工厂函数（typeof=${typeof factory}），` +
            `无法装配存储门面（fail closed）。可用接缝: ${listSeamNames(host)}`
        );
    }
    const storage = factory(storageOptions);
    if (!storage || typeof storage !== 'object') {
        throw new Error(
            `buildApp({ host })：'storage' 接缝工厂返回了空值（${String(storage)}），` +
            `无法装配存储门面（fail closed）`
        );
    }
    return storage;
}

/**
 * 列出宿主可用的接缝名（错误信息用）。宿主是鸭子类型时用 `listServices()`；
 * 拿不到就明确说「未提供清单」，而不是缩成空字符串让人误以为一个都没装。
 * @param {object} host
 * @returns {string} 逗号分隔的接缝名，或「（宿主未提供 listServices）」
 */
function listSeamNames(host) {
    if (typeof host.listServices !== 'function') return '（宿主未提供 listServices）';
    let names;
    try {
        names = host.listServices().map((s) => s?.service).filter(Boolean).sort();
    } catch {
        return '（读取 listServices 失败）';
    }
    return names.length > 0 ? names.join(', ') : '（无）';
}

export default buildApp;
