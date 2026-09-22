/**
 * FlexRunner —— 通用执行模块
 *
 * 接收一个具体事项，将其拆解为多个步骤，并对每个步骤进行执行和追踪。
 *
 * 核心职责：
 *   1. initContext     — 初始化任务上下文（工作目录、报告路径等）
 *   2. matchSkill      — 基于语义拆解与重排序机制匹配最佳 Skill
 *   3. invokeSkill     — 通过 opencode cli 执行选定的 Skill
 *   4. executeStart    — 驱动完整执行流程（匹配 → 执行 → 检查 → 持久化）
 *   5. controlExecution — 控制执行步骤（暂停 / 继续 / 终止）
 *   6. persistKnowledge — 将有效经验存入任务
 *   7. getSessionContent / checkResult — 辅助查询
 *
 * 依赖：
 *   - CLIController (opencode)  用于执行 Skill
 *   - SkillSelector Agent       用于语义匹配 Skill
 *   - TaskStepStore (SQLite)    用于步骤持久化
 *
 * @example
 * import { FlexRunner } from './FlexRunner/FlexRunner.js';
 *
 * const runner = new FlexRunner();
 * await runner.initContext({
 *   taskId: 'task-001',
 *   taskDir: '/workspace/tasks/task-001',
 *   skillDirectory: '/workspace/Server/Skills',
 *   taskDescription: '分析 libcurl 的鸿蒙化可行性',
 *   maxRetries: 3
 * });
 * const ok = await runner.executeStart();
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

import { nowCST } from '../library/cstTime.js';
import { createLogger } from '../Routes/library/logger.js';
// Phase 3：会话完成等待（事件驱动为主、轮询兜底）
import { SessionWaiter, DEFAULT_SAFETY_POLL_MS } from '../library/SessionWaiter.js';

// dotenv 为可选依赖：生产环境加载 .env，未安装时跳过（如纯 mock 测试场景）
try {
    const dotenv = (await import('dotenv')).default;
    dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });
} catch {
    // dotenv 未安装，跳过 .env 加载
}

// CLIController / SkillSelectorAgent / createStorage 为惰性加载：
// 测试中通过 initContext 注入 mock 时不需要加载这些模块及其重依赖（@opencode-ai/sdk、openai 等）。
// 仅在未注入对应实例时才动态 import。
let _CLIController = null;
let _SkillSelectorAgent = null;
let _createStorage = null;
let _KnowledgeManager = null;
let _McpToolGuide = null;

async function _loadCLIController() {
    if (!_CLIController) {
        const mod = await import('../CLI/cli.js');
        _CLIController = mod.CLIController;
    }
    return _CLIController;
}

async function _loadSkillSelectorAgent() {
    if (!_SkillSelectorAgent) {
        const mod = await import('../Agent/SkillSelector/index.js');
        _SkillSelectorAgent = mod.Agent;
    }
    return _SkillSelectorAgent;
}

async function _loadCreateStorage() {
    if (!_createStorage) {
        const mod = await import('../DbUse/index.js');
        _createStorage = mod.createStorage;
    }
    return _createStorage;
}

async function _loadKnowledgeManager() {
    if (!_KnowledgeManager) {
        const mod = await import('../Knowledge/index.js');
        _KnowledgeManager = mod.KnowledgeManager;
    }
    return _KnowledgeManager;
}

/** @type {Promise<object>|null} 进程级共享的 KnowledgeManager 实例（F-17） */
let _sharedKnowledgeManagerPromise = null;

/**
 * 取得进程级共享的 KnowledgeManager（F-17）。
 *
 * 并发安全：用「promise 单例」而非「实例单例」——多个 FlexRunner 可能在同一
 * 事件循环轮次内同时触发首次初始化，若先判断再 await 初始化再赋值，
 * 会并发构造出多个实例（正是要避免的情况）。缓存 promise 可保证只初始化一次。
 *
 * @returns {Promise<object>}
 */
async function _getSharedKnowledgeManager() {
    if (!_sharedKnowledgeManagerPromise) {
        _sharedKnowledgeManagerPromise = (async () => {
            const KnowledgeManager = await _loadKnowledgeManager();
            const km = new KnowledgeManager();
            await km.init();
            return km;
        })().catch((err) => {
            // 初始化失败不缓存失败结果，允许后续调用重试
            _sharedKnowledgeManagerPromise = null;
            throw err;
        });
    }
    return _sharedKnowledgeManagerPromise;
}

async function _loadMcpToolGuide() {
    if (!_McpToolGuide) {
        const mod = await import('../library/McpToolGuide.js');
        _McpToolGuide = mod.McpToolGuide;
    }
    return _McpToolGuide;
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 执行控制类型 */
const ControlType = Object.freeze({
    PAUSE: 'pause',
    RESUME: 'resume',
    ABORT: 'abort'
});

/** 步骤状态 */
const StepStatus = Object.freeze({
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    ERROR: 'error',
    SKIPPED: 'skipped'
});

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 3;

/** 经验总结环节等待文件生成超时（ms），默认 5 分钟 */
const SUMMARY_TIMEOUT_MS = 5 * 60 * 1000;

/** 轮询间隔（ms），用于等待 opencode session 执行完成 */
const POLL_INTERVAL_MS = 5000;

/** 轮询超时（ms），单个步骤最多等待 1.5 小时 */
const POLL_TIMEOUT_MS = 90 * 60 * 1000;

/**
 * F-07：经验总结因取不到并发槽位而被跳过的哨兵返回值。
 * 用独立 Symbol 而非 null，避免与「CLI 返回 null」混淆。
 */
const SKIPPED_DUE_TO_SLOT = Symbol('skipped-due-to-slot');

/** 经验总结等待并发槽位的超时（ms），可由 SEMAPHORE_ACQUIRE_TIMEOUT_MS 覆盖 */
const SUMMARY_SLOT_TIMEOUT_MS = 5 * 60 * 1000;

// ─── F-25：跨任务经验注入的预算 ──────────────────────────────────────────────
/** 最多注入的经验条数（KNOWLEDGE_TOP_K 可覆盖） */
const DEFAULT_KNOWLEDGE_TOP_K = 3;
/** 最低相关性得分，过滤弱相关噪声（KNOWLEDGE_MIN_SCORE 可覆盖） */
const DEFAULT_KNOWLEDGE_MIN_SCORE = 2;
/** 单条经验正文最大字符数 */
const DEFAULT_KNOWLEDGE_MAX_CHARS = 1500;
/** 所有经验正文合计字符预算（防止经验库膨胀后撑爆 prompt） */
const DEFAULT_KNOWLEDGE_TOTAL_CHARS = 4000;

// ─── FlexRunner 类 ──────────────────────────────────────────────────────────

class FlexRunner {
    // ─── 私有变量（通过 # 前缀约定，配合 getter 暴露只读访问） ──────────────────

    /** @type {string} 任务 ID */
    #taskId = '';

    /** @type {string} 工作目录 */
    #taskDir = '';

    /** @type {number} 最大重试次数 */
    #maxRetries = DEFAULT_MAX_RETRIES;

    /** @type {number} 已循环次数 */
    #retryTimes = 0;

    /** @type {string|null} 执行开始时间 */
    #startTime = null;

    /** @type {string|null} 执行结束时间 */
    #endTime = null;

    /** @type {string} 输入报告路径 */
    #inputReport = '';

    /** @type {string} SKILL 目录路径 */
    #skillDirectory = '';

    /** @type {string} 指定 SKILL（name 或目录名）；非空时跳过自动匹配直接使用 */
    #specifiedSkill = '';

    /** @type {string} 任务描述 */
    #taskDescription = '';

    /** @type {number} 当前步骤 ID（正整数） */
    #stepId = 0;

    /** @type {number} 依赖步骤 ID（0 = 无依赖） */
    #dependId = 0;

    /** @type {number} 下一步骤 ID（0 = 无下一步） */
    #nextStepId = 0;

    /** @type {number} 失败跳转步骤 ID（0 = 失败即终止） */
    #failStepId = 0;

    /** @type {number} 大循环索引（0=首轮），由 LoopEngine 传递 */
    #bigLoopIndex = 0;

    /** @type {number} 当前已执行到的步骤序号（单步内重试计数） */
    #executeStep = 0;

    /** @type {string} 最新结果文件路径 */
    #resultPath = '';

    /** @type {string} 会话 ID */
    #sessionId = '';

    // ─── 内部依赖（注入或懒加载） ──────────────────────────────────────────────

    /** @type {CLIController|null} */
    #cli = null;

    /** @type {SkillSelectorAgent|null} */
    #skillSelector = null;

    /** @type {ReturnType<createStorage>|null} */
    #storage = null;

    /** @type {import('../Knowledge/KnowledgeManager.js').default|null} */
    #knowledgeManager = null;

    /** @type {import('../library/McpToolGuide.js').default|null} */
    #mcpToolGuide = null;

    /** @type {boolean} 是否已初始化 */
    #initialized = false;

    /** @type {boolean} 是否暂停 */
    #paused = false;

    /** @type {boolean} 是否已终止 */
    #aborted = false;

    /** @type {string|null} 匹配到的最佳 SKILL 目录 */
    #matchedSkillDir = null;

    /**
     * @type {string} 执行本次步骤的 Agent 角色 id（Phase 2）。
     * 为空串表示单角色模式（Phase 1 行为）。仅用于会话标题与可观测性，
     * 不改变执行语义。
     */
    #roleId = '';

    /**
     * @type {string} 角色指令（Phase 2）。非空时作为 prompt 的**首节**注入，
     * 使同一份任务描述在不同角色下产生不同的行为基线（评审员只判定、执行者只实现）。
     */
    #rolePrompt = '';

    /**
     * @type {string[]|null} SKILL 准入名单（Phase 2）。
     *
     * 为 null 时不限制（Phase 1 行为）。非 null 时，匹配到的 SKILL 必须在名单内，
     * 否则**降级为无 SKILL 模式**并 warn——刻意不做候选池预过滤：
     * 预过滤需要改 SkillSelector 的 LLM 提示词，风险面大且会改变选优质量；
     * 事后准入校验的语义更简单也更可测：「越权 SKILL 绝不被静默使用」。
     */
    #skillAllowList = null;

    /**
     * @type {string} 本角色实际使用的 SKILL 名（Phase 2，供协作层归因）。
     * 空串 = 无 SKILL 模式。
     */
    #usedSkillName = '';

    /** @type {object|null} 本次执行收割的结构化指标（来自 meta .json 旁车文件，通用键值对） */
    #metrics = null;

    /** @type {((sessionId: string) => void)|null} Session 创建后的回调（用于实时同步 sessionId 到编排层） */
    #onSessionCreated = null;

    /** @type {number} 轮询间隔（ms） */
    #pollIntervalMs = POLL_INTERVAL_MS;

    /**
     * @type {number} Phase 3：事件模式下的兜底轮询间隔（ms）。
     * 事件是主路径，轮询只负责「事件丢失时不至于永久挂住」，因此间隔远大于普通轮询。
     */
    #safetyPollMs = DEFAULT_SAFETY_POLL_MS;

    /**
     * @type {object|null} Phase 3：opencode 会话事件源。
     * 需实现 `subscribe(sessionId, onEvent) => unsubscribe`；
     * 未注入时退化为纯轮询（但已是"先查后睡"版本）。
     */
    #sessionEvents = null;

    /** @type {object|null} 最近一次会话等待的统计（事件/轮询各自胜出次数），供可观测性读取 */
    #lastWaitStats = null;

    /**
     * @type {boolean} 是否已完成会话收尾（abort/删除）。
     * F-03：同一次执行可能同时走「失败路径的任务尾部收尾」与「后台经验总结的 finally 收尾」，
     * 用此标志保证 abortSession / deleteSession 各只调用一次。
     */
    #sessionFinalized = false;

    /**
     * @type {boolean} 是否保留远端会话（跳过 deleteSession）。
     * 默认 false（回收）；置 true 便于排障时保留 opencode 侧会话现场。
     * 来源：initContext({ keepSessions }) 或环境变量 3LIB_KEEP_SESSIONS=1。
     */
    #keepSessions = false;

    /**
     * @type {boolean} 是否已把会话收尾交给后台经验总结（F-03）。
     * 成功路径下 executeStart 不再重复收尾，避免与 _summarizeAndPersist 的 finally 冲突。
     */
    #summarizeDispatched = false;

    /** @type {boolean} 远端会话是否已被中止（F-03：避免收尾时重复 abortSession） */
    #remoteAborted = false;

    /**
     * @type {object|null} F-07：进程级 Session 并发信号量（由 Orchestrator 注入）。
     * 用于把「经验总结复用同一 session」的占用也计入并发上限——
     * 该路径发生在 executeStart 返回、槽位释放之后，若不单独取槽位，
     * 真实并发会话数可达上限的 2 倍。
     */
    #sessionSemaphore = null;

    /**
     * @type {AbortController|null} F-06：本次执行的取消源。
     * 注入 CLI 后，abort 会立即中断在途 HTTP 请求，而不是等下一个轮询周期。
     */
    #abortController = null;

    /**
     * @type {Set<Promise<void>>} 在途后台任务（F-04：经验总结 + 会话回收）。
     * 这些任务不阻塞 executeStart 返回，但优雅停机时必须排空——
     * 否则进程退出会中断会话回收，在 opencode 侧留下未归档的孤儿会话。
     */
    #backgroundTasks = new Set();

    /**
     * 构造函数 — 创建 FlexRunner 实例。
     *
     * 支持两种使用方式：
     *   1. 无参构造 + 后续调用 initContext()
     *   2. 构造时传入配置对象，自动完成初始化
     *
     * @param {object} [config] - 可选的初始化配置（同 initContext 入参）
     */
    constructor(config) {
        if (config && typeof config === 'object') {
            // 延迟到 initContext 中处理，避免构造函数中执行异步逻辑
            this._pendingConfig = config;
        }
    }

    // ─── 只读 getter ───────────────────────────────────────────────────────────

    /** @returns {string} */
    get taskId() { return this.#taskId; }
    /** @returns {string} */
    get taskDir() { return this.#taskDir; }
    /** @returns {number} */
    get maxRetries() { return this.#maxRetries; }
    /** @returns {number} */
    get retryTimes() { return this.#retryTimes; }
    /** @returns {string|null} */
    get startTime() { return this.#startTime; }
    /** @returns {string|null} */
    get endTime() { return this.#endTime; }
    /** @returns {string} */
    get inputReport() { return this.#inputReport; }
    /** @returns {string} */
    get skillDirectory() { return this.#skillDirectory; }
    /** @returns {string} 指定 SKILL（name 或目录名），未指定时为空串 */
    get specifiedSkill() { return this.#specifiedSkill; }
    /** @returns {string} */
    get taskDescription() { return this.#taskDescription; }
    /** @returns {number} */
    get stepId() { return this.#stepId; }
    /** @returns {number} */
    get dependId() { return this.#dependId; }
    /** @returns {number} */
    get nextStepId() { return this.#nextStepId; }
    /** @returns {number} */
    get failStepId() { return this.#failStepId; }
    /** @returns {number} 大循环索引（0=首轮） */
    get bigLoopIndex() { return this.#bigLoopIndex; }
    /** @returns {number} */
    get executeStep() { return this.#executeStep; }
    /** @returns {string} */
    get resultPath() { return this.#resultPath; }
    /** @returns {string} */
    get sessionId() { return this.#sessionId; }
    /** @returns {boolean} */
    get initialized() { return this.#initialized; }
    /** @returns {object|null} 本次执行收割的结构化指标（无则 null） */
    get metrics() { return this.#metrics; }
    /** @returns {string} 执行本次步骤的 Agent 角色 id（Phase 2；单角色模式为空串） */
    get roleId() { return this.#roleId; }
    /** @returns {string} 本角色实际使用的 SKILL 名（空串 = 无 SKILL 模式） */
    get usedSkillName() { return this.#usedSkillName; }
    /** @returns {string[]|null} SKILL 准入名单（null = 不限制） */
    get skillAllowList() { return this.#skillAllowList; }
    /** @returns {object|null} 最近一次会话等待的统计（mode/waitedMs/polls/events） */
    get lastWaitStats() { return this.#lastWaitStats; }

    /**
     * 设置 Session 创建后的回调（可在 initContext 之后注入）。
     * @param {((sessionId: string) => void|Promise<void>)|null} fn
     */
    set onSessionCreated(fn) {
        this.#onSessionCreated = typeof fn === 'function' ? fn : null;
    }

    // ─── 公开方法 ─────────────────────────────────────────────────────────────

    /**
     * initContext — 初始化任务上下文。
     *
     * 解析入参 JSON 对象，设置任务 ID、工作目录、SKILL 目录、任务描述等，
     * 并懒初始化 CLI 控制器、Skill 选择器、存储层等内部依赖。
     *
     * @param {object} params - 初始化参数
     * @param {string} params.taskId          - 任务 ID（必填）
     * @param {string} [params.taskDir]       - 工作目录（默认基于 taskId 推导）
     * @param {string} [params.skillDirectory] - SKILL 目录路径
     * @param {string} [params.specifiedSkill] - 指定 SKILL（name 或目录名）；
     *                                           非空时跳过 matchSkill 自动匹配，直接解析并使用该 SKILL
     * @param {string} [params.taskDescription] - 任务描述
     * @param {string} [params.inputReport]   - 输入报告路径
     * @param {number} [params.maxRetries]    - 最大重试次数（默认 3）
     * @param {number} [params.stepId]        - 当前步骤 ID（正整数，必填）
     * @param {number} [params.dependId]      - 依赖步骤 ID（0 = 无依赖）
     * @param {number} [params.nextStepId]    - 下一步骤 ID（0 = 无下一步）
     * @param {number} [params.failStepId]    - 失败跳转步骤 ID（0 = 失败即终止）
     * @param {CLIController} [params.cli]    - 注入自定义 CLI 控制器（测试用）
     * @param {SkillSelectorAgent} [params.skillSelector] - 注入自定义 Skill 选择器
     * @param {ReturnType<createStorage>} [params.storage] - 注入自定义存储层
     * @param {number} [params.pollIntervalMs] - 轮询间隔 ms（默认 3000）
     * @param {string} [params.mcpConfigPath] - MCP config.json 路径（默认自动推导）
     * @param {((sessionId: string) => void|Promise<void>)} [params.onSessionCreated] - Session 创建后的回调
     * @returns {Promise<void>}
     */
    async initContext(params = {}) {
        if (!params || typeof params !== 'object') {
            throw new Error('FlexRunner.initContext: 入参必须是一个 JSON 对象');
        }

        const {
            taskId,
            taskDir,
            skillDirectory,
            specifiedSkill,
            taskDescription,
            inputReport,
            maxRetries,
            stepId,
            dependId,
            nextStepId,
            failStepId,
            bigLoopIndex,
            cli,
            skillSelector,
            storage,
            knowledgeManager,
            pollIntervalMs,
            mcpConfigPath,
            onSessionCreated,
            keepSessions,
            sessionSemaphore,
            // ── Phase 2：多 Agent 角色化执行（缺省不影响 Phase 1 行为） ──
            roleId,
            rolePrompt,
            skillAllowList,
            initialExecuteStep,
            // ── Phase 3：并发与可观测 ──
            sessionEvents,
            safetyPollMs
        } = params;

        if (!taskId) {
            throw new Error('FlexRunner.initContext: taskId 为必填项');
        }

        // stepId 必须为正整数
        const numStepId = Number(stepId);
        if (!Number.isInteger(numStepId) || numStepId <= 0) {
            throw new Error(`FlexRunner.initContext: stepId 必须为正整数，当前值: ${stepId}`);
        }

        // ── 初始化内部依赖（支持注入，便于测试；未注入时惰性加载） ──
        // 先初始化 storage，因为 taskDir 的 fallback 需要用到 storage.manager.rootDir
        if (storage) {
            this.#storage = storage;
        } else {
            const createStorage = await _loadCreateStorage();
            this.#storage = createStorage();
        }

        // ── 设置私有变量 ──
        this.#taskId = String(taskId);
        // taskDir 默认为 db/task/{taskId}（与 storage.json('task') 同目录）
        const _rootDir = this.#storage?.manager?.rootDir;
        this.#taskDir = taskDir ||
            (_rootDir
                ? path.resolve(_rootDir, 'task', this.#taskId)
                : path.resolve(process.cwd(), 'db', 'task', this.#taskId));
        this.#skillDirectory = skillDirectory || '';
        this.#specifiedSkill = String(specifiedSkill || '').trim();
        this.#taskDescription = taskDescription || '';
        this.#inputReport = inputReport || '';
        this.#maxRetries = typeof maxRetries === 'number' ? maxRetries : DEFAULT_MAX_RETRIES;
        this.#stepId = numStepId;
        // dependId 支持数组（fan-in 聚合），此处仅取第一个作为回退锚点语义
        this.#dependId = Number(Array.isArray(dependId) ? dependId[0] : dependId) || 0;
        this.#nextStepId = Number(nextStepId) || 0;
        this.#failStepId = Number(failStepId) || 0;
        this.#bigLoopIndex = Number(bigLoopIndex) || 0;
        // Phase 2：允许调用方指定初始执行序号（产物文件名中的 loopCount）。
        // 多 Agent 协作中每个角色会话是一个**独立的新 FlexRunner 实例**，
        // 若不允许指定，各实例的 loopCount 都从 0 开始，同一角色的多次重做会
        // 覆盖同一份 `..._result_0_{role}.md`，评审者就无法对比"改前/改后"。
        this.#executeStep = Number.isInteger(initialExecuteStep) && initialExecuteStep >= 0
            ? initialExecuteStep
            : 0;
        this.#retryTimes = 0;
        this.#startTime = null;
        this.#endTime = null;
        this.#resultPath = '';
        this.#sessionId = '';
        this.#paused = false;
        this.#aborted = false;
        this.#matchedSkillDir = null;
        this.#onSessionCreated = typeof onSessionCreated === 'function' ? onSessionCreated : null;
        // F-03：会话回收策略。keepSessions=true 时保留远端会话（仅排障用）
        this.#keepSessions = keepSessions === true
            || process.env['3LIB_KEEP_SESSIONS'] === '1';
        this.#sessionFinalized = false;
        // F-07：共享信号量（未注入则不额外限流，行为与修改前一致）
        this.#sessionSemaphore = sessionSemaphore || null;
        // Phase 2：角色化执行参数。三者缺省时与 Phase 1 完全等价。
        this.#roleId = typeof roleId === 'string' ? roleId : '';
        this.#rolePrompt = typeof rolePrompt === 'string' ? rolePrompt : '';
        if (Array.isArray(skillAllowList)) {
            this.#skillAllowList = skillAllowList.map((s) => String(s));
        } else {
            this.#skillAllowList = null;
        }
        this.#usedSkillName = '';
        this.#pollIntervalMs = typeof pollIntervalMs === 'number' && pollIntervalMs > 0
            ? pollIntervalMs
            : POLL_INTERVAL_MS;
        // Phase 3：会话事件源与兜底轮询间隔（缺省时行为与 Phase 1 等价）
        this.#sessionEvents = sessionEvents || null;
        this.#safetyPollMs = typeof safetyPollMs === 'number' && safetyPollMs > 0
            ? safetyPollMs
            : DEFAULT_SAFETY_POLL_MS;
        this.#lastWaitStats = null;

        // ── 初始化其他内部依赖（支持注入，便于测试；未注入时惰性加载） ──
        if (cli) {
            this.#cli = cli;
        } else {
            const CLIController = await _loadCLIController();
            this.#cli = new CLIController();
        }

        // F-06：为本次执行建立取消源并注入 CLI，使 abort 能中断在途 HTTP。
        // 适配器不支持时静默降级（信号量超时仍能兜住僵死，只是要等超时）。
        this.#abortController = new AbortController();
        if (typeof this.#cli.setAbortSignal === 'function') {
            try {
                this.#cli.setAbortSignal(this.#abortController.signal);
            } catch (err) {
                this._log('warn', `注入取消源失败（降级为仅轮询检查）: ${err.message}`);
            }
        }

        if (skillSelector) {
            this.#skillSelector = skillSelector;
        } else {
            const SkillSelectorAgent = await _loadSkillSelectorAgent();
            this.#skillSelector = new SkillSelectorAgent();
        }

        // 知识沉淀管理器（支持注入，便于测试；未注入时用进程级共享实例）
        // F-17：改为进程级共享。原实现每个 FlexRunner 都 new 一个 KnowledgeManager
        // 并 init()——而 init() 内部会 createStorage()，于是每个并发步骤都额外
        // 持有一个 StorageManager 与 SQLite 连接，同时知识索引的读改写也会
        // 在多实例之间互相覆盖（后者的正确性由 F-15 的串行锁兜住，但连接数是纯浪费）。
        if (knowledgeManager) {
            this.#knowledgeManager = knowledgeManager;
        } else {
            this.#knowledgeManager = await _getSharedKnowledgeManager();
        }

        // MCP 工具引导（支持注入；未注入时惰性加载，用 mcpConfigPath 或默认路径）
        const McpToolGuide = await _loadMcpToolGuide();
        this.#mcpToolGuide = new McpToolGuide(mcpConfigPath);

        this.#initialized = true;
    }

    /**
     * executeStart — 驱动单次执行流程（6 步）。
     *
     * 本方法为**单次执行**，不内部循环。外部执行机构根据返回值决定是否
     * 再次调用本方法进行重试。每次调用 #executeStep 递增，生成的文件
     * 以 loopCount 区分。
     *
     * 流程：
     *   1. matchSkill          → 匹配最佳 Skill（未匹配到时返回 null，降级为无 SKILL 模式）
     *   2. invokeSkill         → 通过 opencode 执行 Skill，生成 result .md 文件
     *      （skillDir 为 null 时，基于任务描述本身直接执行，不使用 SKILL）
     *      （第 N 次执行时，自动收集历史 result/summary .md 作为上下文）
     *      （初始 prompt 仅负责执行任务 + 生成 result .md，不包含经验总结指令）
     *   3. checkResult         → 读取 result .md，判断成功/失败
     *   4. 返回 { resultPath, success, nextStepId }
     *   5.（后台异步）_summarizeAndPersist → 仅在成功后，向同一 Session 追加经验总结 prompt
     *      （通过 sendAndWaitMessage 等待 AI 生成 Summary .md，再 persistKnowledge）
     *      （fire-and-forget：不阻塞 executeStart 返回，不影响步骤流转）
     *      （失败/超时降级：不影响步骤成功状态，仅记录 warn 日志）
     *
     * 文件命名（按大循环轮次 + 步骤内重试次数区分）：
     *   - 结果文件: stepId{actualStepId}_loop{bigLoopIndex}_result_{retryCount}.md
     *   - 经验文件: stepId{actualStepId}_loop{bigLoopIndex}_Summary_{retryCount}.md
     *   - 指标文件: stepId{actualStepId}_loop{bigLoopIndex}_meta_{retryCount}.json（可选，SKILL 约定的结构化结论）
     *
     * 控制信号（pause/resume/abort）在步骤边界检查，非实时。
     *
     * @returns {Promise<{resultPath: string, success: boolean, nextStepId: number}>}}
     */
    async executeStart() {
        this._ensureInitialized();
        if (this.#aborted) {
            throw new Error('FlexRunner.executeStart: 任务已被终止，无法启动');
        }

        const loopCount = this.#executeStep;
        this.#startTime = nowCST();
        let resultPath = '';
        let success = false;

        this._log('info', `── 第 ${loopCount + 1} 次执行（loopCount=${loopCount}）──`);

        // 写入初始步骤记录
        await this._persistStep({
            status: StepStatus.RUNNING,
            startTime: this.#startTime,
            executeStep: loopCount
        });

        try {
            // ── 步骤 1：matchSkill ──
            // 指定 SKILL（specifiedSkill 非空）时跳过自动匹配，直接解析使用
            await this._waitIfPaused();
            if (this.#aborted) {
                this._log('warn', `任务在 matchSkill 前被终止`);
            } else if (this.#specifiedSkill) {
                this.#matchedSkillDir = await this._resolveSpecifiedSkill(
                    this.#specifiedSkill,
                    this.#skillDirectory
                );
                await this._persistStep({
                    matchedSkillDir: this.#matchedSkillDir,
                    executeStep: loopCount
                });
            } else {
                this.#matchedSkillDir = await this.matchSkill(
                    this.#taskDescription,
                    this.#skillDirectory
                );
                await this._persistStep({
                    matchedSkillDir: this.#matchedSkillDir,
                    executeStep: loopCount
                });
            }

            // ── 构建文件路径（按大循环轮次区分，避免跨轮覆盖） ──
            // Phase 2：角色化执行时追加 `_{roleId}` 区分同一步骤内不同角色的产物。
            // 不追加会让 Planner/Coder/Reviewer 在同一个 stepId+loop+retry 上互相覆盖产物，
            // 而"Reviewer 判定 Coder 的产物"正是协作的语义基础。
            resultPath = this.#artifactPath('result', loopCount);
            const summaryFilePath = this.#artifactPath('Summary', loopCount);
            const metaFilePath = this.#artifactPath('meta', loopCount, 'json');

            // ── 收集历史执行文档（第 N 次执行时传入之前的结果/经验） ──
            const historyDocs = await this._collectHistoryDocs(loopCount);

            // ── F-25：取回跨任务历史经验，注入 prompt 让模型复用（闭环的关键一环）──
            const knowledgeDocs = await this._collectKnowledgeDocs(
                this.#taskDescription,
                this.#matchedSkillDir
            );

            // ── 步骤 2：invokeSkill（生成 result .md） ──
            await this._waitIfPaused();
            if (!this.#aborted) {
                const invoked = await this.invokeSkill(
                    this.#taskDescription,
                    this.#matchedSkillDir,
                    this.#inputReport || undefined,
                    { resultFilePath: resultPath, metaFilePath, historyDocs, knowledgeDocs }
                );

                if (!invoked) {
                    throw new Error('invokeSkill 返回 false，执行失败');
                }

                if (this.#sessionId) {
                    await this._persistStep({
                        sessionId: this.#sessionId,
                        executeStep: loopCount
                    });
                }

                // ── 步骤 3：checkResult（读取 result .md 判断成功/失败） ──
                await this._waitIfPaused();
                const ok = await this.checkResult(resultPath);

                if (ok) {
                    success = true;
                    // ── 收割结构化指标（meta .json 旁车文件，通用键值对，后端不解释语义） ──
                    this.#metrics = await this._harvestMetrics(metaFilePath);
                    this._log('info', '✅ 执行成功，经验总结将在后台异步进行');
                    // ── 后台异步：经验总结 + 知识持久化（不阻塞 executeStart 返回） ──
                    // capture sessionId 防止实例复用时被覆盖
                    const sid = this.#sessionId;
                    const skillDir = this.#matchedSkillDir;
                    // F-03：标记「会话收尾已交给后台总结」，使 executeStart 尾部不重复收尾
                    this.#summarizeDispatched = true;
                    // F-04：登记在途后台任务，供优雅停机排空（producer 在 finally 中自注销）
                    const bg = this._summarizeAndPersist(summaryFilePath, skillDir, sid).catch((err) => {
                        this._log('warn', `后台经验总结/持久化异常: ${err.message}`);
                    });
                    this.#backgroundTasks.add(bg);
                    bg.finally(() => this.#backgroundTasks.delete(bg));
                } else {
                    this._log('warn', `checkResult 未通过（loopCount=${loopCount}）`);
                }
            }
        } catch (err) {
            this._log('error', `执行异常: ${err.message}`);
        }

        this.#endTime = nowCST();
        this.#resultPath = resultPath;

        // 更新步骤记录：成功 / 失败 / 终止
        const finalStatus = this.#aborted
            ? StepStatus.SKIPPED
            : (success ? StepStatus.COMPLETED : StepStatus.ERROR);
        await this._persistStep({
            status: finalStatus,
            endTime: this.#endTime,
            executeStep: loopCount,
            resultPath,
            retryTimes: loopCount,
            metrics: this.#metrics
        });

        // 递增执行计数，供下一次调用使用
        this.#executeStep++;

        // ── F-03：会话收尾 ──
        // 成功路径由后台经验总结的 finally 收尾（它还要复用同一 session 追加总结 prompt）；
        // 其余路径（失败 / 终止 / 未派发总结的成功）在此立即收尾。
        const summarizeOwnsCleanup =
            finalStatus === StepStatus.COMPLETED && this.#summarizeDispatched;
        if (!summarizeOwnsCleanup) {
            await this._finalizeSession(
                this.#aborted ? 'aborted' : (success ? 'success' : 'failed')
            );
        }

        // 成功 → nextStepId；失败 → failStepId（与 Orchestrator 的失败流转语义对齐）
        const nextStepId = success ? this.#nextStepId : this.#failStepId;

        return { resultPath, success, nextStepId, metrics: this.#metrics };
    }

    /**
     * canRetry — 判断当前步骤是否还可以继续重试。
     *
     * 供外部执行机构在调用 executeStart() 前检查：
     *   - 若返回 false，表示已达最大重试次数，不应再次调用。
     *   - 若返回 true，可以继续调用 executeStart() 进行重试。
     *
     * @returns {boolean} 是否还能重试
     */
    canRetry() {
        return this.#executeStep <= this.#maxRetries && !this.#aborted;
    }

    /**
     * matchSkill — 基于语义拆解与重排序机制匹配最佳 Skill。
     *
     * 委托 SkillSelector Agent（ReAct 模式）：
     *   Reason #1: LLM 拆解任务 → 生成关键词/意图/技术栈
     *   Act:       模糊匹配召回 topK 候选
     *   Reason #2: LLM 评分排序 → 选出最佳
     *
     * 匹配失败时的策略：
     *   - SKILL 目录为空或未找到任何 SKILL → 返回 null（降级为无 SKILL 执行）
     *   - 模糊匹配未召回任何候选 → 返回 null
     *   - top1 分数低于命中阈值 → 返回 null
     *   - 匹配结果缺少目录路径 → 返回 null
     *   调用方（executeStart）收到 null 后将以无 SKILL 模式继续向下执行。
     *
     * @param {string} taskDescription - 任务描述字符串
     * @param {string} skillDirectory - SKILL 目录路径
     * @returns {Promise<string|null>} 最适合的 SKILL 目录绝对路径；未匹配到时返回 null
     */
    async matchSkill(taskDescription, skillDirectory) {
        this._ensureInitialized();

        if (!taskDescription) {
            throw new Error('FlexRunner.matchSkill: taskDescription 不能为空');
        }
        if (!skillDirectory) {
            this._log('warn', 'matchSkill: skillDirectory 为空，将以无 SKILL 模式执行');
            return null;
        }

        this._log('info', `matchSkill 开始 — task: "${taskDescription.slice(0, 80)}…"`);

        let selection;
        try {
            selection = await this.#skillSelector.selectSkill(taskDescription, skillDirectory);
        } catch (err) {
            this._log('warn', `matchSkill: SkillSelector 执行异常 — ${err.message}，将以无 SKILL 模式执行`);
            return null;
        }

        if (!selection || !selection.best) {
            this._log('warn', `matchSkill: 未匹配到任何合适的 Skill（topScore=${selection?.topScore ?? 0}），将以无 SKILL 模式执行`);
            return null;
        }

        // 优先使用 SkillSelection.skillPath，回退到 SkillMeta.skillPath
        const bestDir = selection.skillPath || selection.best.skillPath;
        if (!bestDir) {
            this._log('warn', 'matchSkill: 匹配结果缺少 Skill 目录路径，将以无 SKILL 模式执行');
            return null;
        }

        // ── Phase 2：角色 SKILL 准入校验 ──
        // 匹配结果超出角色能力边界时不静默使用，而是降级为无 SKILL 模式并明确告警。
        // 上层（Supervisor）据此把"角色越权"归因为计划问题，而不是编码能力问题。
        const skillName = selection.best.name || path.basename(bestDir);
        if (this.#skillAllowList && !this.#skillAllowList.includes(skillName)) {
            this._log('warn',
                `matchSkill: 匹配到 SKILL "${skillName}"，但不在角色 ${this.#roleId || '(未命名)'} 的可用范围内，` +
                `降级为无 SKILL 模式（可用：${this.#skillAllowList.slice(0, 8).join('、')}` +
                `${this.#skillAllowList.length > 8 ? ` 等 ${this.#skillAllowList.length} 个` : ''}）`);
            return null;
        }

        this.#usedSkillName = skillName;
        this._log('info', `matchSkill 完成 — 最佳 Skill: ${skillName} (${bestDir})`);
        return bestDir;
    }

    /**
     * _resolveSpecifiedSkill — 解析用户指定的 SKILL（跳过自动匹配）。
     *
     * 解析顺序（在 skillDirectory 下）：
     *   1. 目录名精确匹配   → {skillDirectory}/{specifiedSkill}
     *   2. SKILL name 匹配  → 扫描所有 SKILL.md frontmatter 的 name 字段
     *
     * 解析失败时的策略：
     *   - skillDirectory 为空 / 目录不存在 / 未找到匹配 SKILL → 返回 null（降级为无 SKILL 模式）
     *   - 仅记录 warn 日志，不抛异常，保证执行流程不中断
     *
     * @param {string} specifiedSkill  - 指定的 SKILL name 或目录名
     * @param {string} skillDirectory  - SKILL 根目录路径
     * @returns {Promise<string|null>} SKILL 目录绝对路径；解析失败时返回 null
     */
    async _resolveSpecifiedSkill(specifiedSkill, skillDirectory) {
        this._ensureInitialized();

        if (!specifiedSkill) {
            return null;
        }
        if (!skillDirectory) {
            this._log('warn', `specifiedSkill: skillDirectory 为空，无法解析指定 SKILL "${specifiedSkill}"，将以无 SKILL 模式执行`);
            return null;
        }

        this._log('debug', `specifiedSkill 开始 — 指定 Skill: "${specifiedSkill}"`);

        // ── Phase 2：角色 SKILL 准入校验（前置，避免白跑一遍目录扫描） ──
        // 指定 SKILL 越权时直接拒绝并降级，理由与 matchSkill 中的准入校验一致。
        if (this.#skillAllowList && !this.#skillAllowList.includes(String(specifiedSkill).trim())) {
            this._log('warn',
                `specifiedSkill: 指定 SKILL "${specifiedSkill}" 不在角色 ${this.#roleId || '(未命名)'} 的可用范围内，` +
                `降级为无 SKILL 模式`);
            return null;
        }

        try {
            // ── 1. 目录名精确匹配 ──
            const directDir = path.resolve(skillDirectory, specifiedSkill);
            const directSkillMd = path.join(directDir, 'SKILL.md');
            try {
                const stat = await fs.stat(directSkillMd);
                if (stat.isFile()) {
                    this._log('debug', `specifiedSkill 完成 — 目录名匹配: ${directDir}`);
                    this.#usedSkillName = path.basename(directDir);
                    return directDir;
                }
            } catch {
                // 直接路径不存在 SKILL.md，继续尝试 name 匹配
            }

            // ── 2. 扫描 SKILL name 匹配（frontmatter 的 name 字段） ──
            let entries;
            try {
                entries = await fs.readdir(skillDirectory, { withFileTypes: true });
            } catch (err) {
                this._log('warn', `specifiedSkill: 无法读取 SKILL 目录 ${skillDirectory} — ${err.message}，将以无 SKILL 模式执行`);
                return null;
            }

            const target = specifiedSkill.toLowerCase();
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
                const dirPath = path.join(skillDirectory, entry.name);
                const skillMdPath = path.join(dirPath, 'SKILL.md');
                try {
                    const md = await fs.readFile(skillMdPath, 'utf-8');
                    // 解析 frontmatter 中的 name 字段（--- 包围的 YAML 头）
                    const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                    if (fmMatch) {
                        const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
                        if (nameMatch) {
                            const name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
                            if (name.toLowerCase() === target) {
                                this._log('info', `specifiedSkill 完成 — name 匹配: ${name} (${dirPath})`);
                                this.#usedSkillName = name;
                                return dirPath;
                            }
                        }
                    }
                } catch {
                    // 读取失败跳过该目录
                }
            }

            this._log('warn', `specifiedSkill: 在 ${skillDirectory} 下未找到名为 "${specifiedSkill}" 的 SKILL（目录名/name 均未命中），将以无 SKILL 模式执行`);
            return null;
        } catch (err) {
            this._log('warn', `specifiedSkill: 解析异常 — ${err.message}，将以无 SKILL 模式执行`);
            return null;
        }
    }

    /**
     * _harvestMetrics — 收割结构化指标（meta .json 旁车文件）。
     *
     * 通用契约：初始 prompt 中下发 meta 文件路径，SKILL 若定义了结构化结论指标
     * （如 code-check 的 mergeLevel、仓库检查的 score），由 AI 以 JSON 对象写入该路径。
     * 后端不解释键的语义，仅校验 JSON 合法性后原样透传（键名由各 SKILL 自行约定）。
     *
     * 降级策略（均不影响执行状态）：
     *   - 文件不存在 → 返回 null（SKILL 未约定指标，正常情况）
     *   - JSON 解析失败 / 非对象 → 返回 null，记录 warn
     *
     * @param {string} metaFilePath - 指标文件路径
     * @returns {Promise<object|null>} 结构化指标对象；无/非法时返回 null
     */
    async _harvestMetrics(metaFilePath) {
        if (!metaFilePath) return null;
        try {
            let raw = await fs.readFile(metaFilePath, 'utf-8');
            if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                this._log('info', `metrics 已收割 — ${Object.keys(parsed).join(', ')}`);
                return parsed;
            }
            this._log('warn', 'metrics: meta 文件内容非 JSON 对象，忽略');
            return null;
        } catch (err) {
            if (err.code === 'ENOENT') {
                // SKILL 未约定指标文件，正常情况，不打日志
                return null;
            }
            this._log('warn', `metrics: 读取/解析 meta 文件失败 — ${err.message}，忽略`);
            return null;
        }
    }

    /**
     * invokeSkill — 通过 opencode cli 执行选定的 Skill（或无 SKILL 直接执行）。
     *
     * 流程：
     *   1. 创建 opencode Session（标题=taskId+stepId+loopCount）
     *   2. 发送初始 prompt（任务描述 + SKILL 目录 + 报告路径 + 结果文件路径）
     *      — skillDir 为 null 时，prompt 不包含 SKILL 目录，改为基于任务描述直接执行
     *      — 初始 prompt 仅负责执行任务 + 生成 result .md，**不包含经验总结指令**
     *      — 经验总结在 checkResult 成功后由 _summarizeExperience 独立追加
     *   3. 轮询 Session 状态直到完成或超时
     *   4. 记录 sessionId
     *
     * opencode 执行过程中会固定生成：
     *   - resultFilePath:  stepId{actualStepId}_loop{bigLoopIndex}_result_{retryCount}.md
     *
     * @param {string} taskDescription   - 任务描述字符串
     * @param {string|null} skillDir     - 选定的 SKILL 目录路径；null 表示无 SKILL 模式
     * @param {string} [reportPath]      - 输入报告路径（可选）
     * @param {object} [filePaths]       - 文件路径
     * @param {string} [filePaths.resultFilePath]  - 结果文件输出路径
     * @returns {Promise<boolean>} 是否成功
     */
    async invokeSkill(taskDescription, skillDir, reportPath, filePaths = {}) {
        this._ensureInitialized();

        if (!taskDescription) {
            throw new Error('FlexRunner.invokeSkill: taskDescription 不能为空');
        }
        // skillDir 允许为 null：未匹配到 SKILL 时以无 SKILL 模式执行

        const modeLabel = skillDir ? 'SKILL 模式' : '无 SKILL 模式';
        this._log('debug', `invokeSkill 开始 — ${modeLabel}${skillDir ? `: ${skillDir}` : ''}`);

        try {
            // ── 1. 健康检查 ──
            const health = await this.#cli.checkHealth();
            if (health.status !== 'ok') {
                this._log('error', `CLI(${this.#cli.getType()}) 服务不可用: ${health.message}`);
                return false;
            }

            // ── 2. 构建 prompt（含历史执行文档） ──
            const title = `task=${this.#taskId}|step=${this.#stepId}|bigLoop=${this.#bigLoopIndex}|retry=${this.#executeStep}` +
                (this.#roleId ? `|role=${this.#roleId}` : '');
            const prompt = this._buildPrompt(taskDescription, skillDir, reportPath, filePaths);

            // ── 3. 创建 Session 并发送初始 prompt ──
            // 指定工作目录为 taskDir，确保 opencode session 的文件操作（git clone 等）在 db/task/{taskId}/ 下执行
            // const { sessionId } = await this.#cli.startSession(title, prompt, { cwd: this.#taskDir });
            const { sessionId } = await this.#cli.startSession(title, prompt);
            this.#sessionId = sessionId;
            this._log('debug', `Session 已创建: ${sessionId}`);

            // F-03：startSession 本身是异步的，期间可能已收到终止请求。此窗口内若不立即
            // 回收，会留下一个仍在运行（并持续消耗 token）的远端会话。
            if (this.#aborted) {
                this._log('warn', `Session ${sessionId} 创建后发现已终止，立即回收`);
                await this._finalizeSession('aborted');
                return false;
            }

            // 实时通知编排层（静默失败，不影响主流程）
            if (this.#onSessionCreated) {
                try {
                    await this.#onSessionCreated(sessionId);
                } catch (err) {
                    this._log('warn', `onSessionCreated 回调异常: ${err.message}`);
                }
            }

            // ── 4. 轮询等待执行完成 ──
            const completed = await this._pollSession(sessionId);
            if (!completed) {
                this._log('warn', `Session ${sessionId} 未在超时时间内完成`);
                return false;
            }

            this._log('debug', `invokeSkill 完成 — sessionId: ${sessionId}`);
            return true;
        } catch (err) {
            this._log('error', `invokeSkill 异常: ${err.message}`);
            return false;
        }
    }

    /**
     * drainBackgroundTasks — 排空在途后台任务（F-04 优雅停机用）。
     *
     * 等待经验总结（含会话归档与远端回收）完成。超时后返回，不阻塞停机流程——
     * 调用方（Orchestrator）有更上层的整体超时兜底。
     *
     * @param {number} [timeoutMs=15000] - 最长等待时间
     * @returns {Promise<{drained: boolean, pending: number}>}
     */
    async drainBackgroundTasks(timeoutMs = 15000) {
        const deadline = Date.now() + Math.max(0, timeoutMs);
        while (this.#backgroundTasks.size > 0 && Date.now() < deadline) {
            await Promise.allSettled([...this.#backgroundTasks]);
            if (this.#backgroundTasks.size > 0) {
                // 任务已 settle 但 finally 注销尚未执行完毕，让出一拍
                await this._sleep(20);
            }
        }
        return { drained: this.#backgroundTasks.size === 0, pending: this.#backgroundTasks.size };
    }

    /** 是否仍有在途后台任务（优雅停机判定用） */
    get hasBackgroundTasks() {
        return this.#backgroundTasks.size > 0;
    }

    /**
     * #withSessionSlot — 在持有 Session 并发槽位的前提下执行 fn（F-07）。
     *
     * 经验总结复用同一 session 调 sendAndWaitMessage，属真实的"活跃会话"占用，
     * 但它发生在 executeStart 返回、步骤槽位释放之后。若不单独取槽位，
     * 真实并发会话数可达全局上限的 2 倍（步骤 + 总结）。
     *
     * 未注入信号量时直接执行（不改变既有行为，便于单测与独立使用）。
     * 取不到槽位（超时）时**跳过总结并返回哨兵**——经验总结是可选的旁路，
     * 绝不能因为它而拖住或影响步骤结果与流转。
     *
     * @param {(why: string) => void} onSkip - 跳过时的日志回调
     * @param {() => Promise<any>} fn
     * @returns {Promise<any|typeof SKIPPED_DUE_TO_SLOT>}
     */
    async #withSessionSlot(onSkip, fn) {
        if (!this.#sessionSemaphore || typeof this.#sessionSemaphore.acquire !== 'function') {
            return fn();
        }
        const envTimeout = Number(process.env.SEMAPHORE_ACQUIRE_TIMEOUT_MS);
        const timeoutMs = Number.isFinite(envTimeout) && envTimeout >= 0 ? envTimeout : SUMMARY_SLOT_TIMEOUT_MS;
        let lease;
        try {
            lease = await this.#sessionSemaphore.acquire({ timeoutMs, key: this.#taskId });
        } catch (err) {
            onSkip(`获取并发槽位异常（${err.message}）`);
            return SKIPPED_DUE_TO_SLOT;
        }
        if (!lease.ok) {
            onSkip(`等待并发槽位超时（${lease.waitedMs}ms，并发已满）`);
            return SKIPPED_DUE_TO_SLOT;
        }
        try {
            return await fn();
        } finally {
            lease.release();
        }
    }

    /**
     * _finalizeSession — 会话收尾（F-03）：归档 → 中断 → 删除。
     *
     * 为什么必须做：修改前 deleteSession 在整个生产代码中**没有调用方**，每个步骤
     * 每次尝试都会在 opencode serve 上留下一个永不回收的会话；N 步 × M 重试 × K 轮
     * 大循环会让单进程 opencode 线性累积会话直至被拖垮。
     *
     * 关键顺序与取舍：
     *   1. **先归档再删除**。checkSessionStatus 只在检测到 completed/error 时才
     *      `_autoArchive`，超时/终止路径不会归档。若直接删除远端会话，对话记录
     *      将永久丢失。故此处先 `getSessionMessages()` 全量拉取落本地
     *      `db/Session/<id>.jsonl`（增量去重，幂等）。
     *   2. **归档失败则跳过删除**。宁可有界泄漏一个远端会话，也不丢审计记录；
     *      异常会以 warn 明确暴露，便于人工清理。
     *   3. 非成功路径先 `abortSession`，立刻停止远端继续消耗 token。
     *   4. 全程 best-effort：任何异常只记日志，绝不影响步骤结果与失败链流转。
     *
     * 幂等由 `#sessionFinalized` 保证：同一次执行可能同时经过「executeStart 尾部
     * 收尾」与「后台经验总结 finally 收尾」，两者只会真正执行一次。
     *
     * 本地归档始终保留（deleteSession 只作用于远端），故前端的历史回看
     * （getSessionContent 读本地 jsonl）不受影响。
     *
     * @param {'success'|'failed'|'aborted'|'timeout'} reason - 收尾原因（决定是否 abort）
     * @returns {Promise<void>}
     * @private
     */
    async _finalizeSession(reason) {
        if (this.#sessionFinalized) return;
        const sessionId = this.#sessionId;
        this.#sessionFinalized = true;
        if (!sessionId) return;

        // 1. 非成功路径：先中断远端会话（已在 controlExecution('abort') 中中止过则跳过）
        if (reason !== 'success' && !this.#remoteAborted) {
            try {
                await this.#cli.abortSession(sessionId);
                this.#remoteAborted = true;
            } catch (err) {
                this._log('warn', `会话收尾: abortSession 失败（忽略）id=${sessionId}: ${err.message}`);
            }
        }

        if (this.#keepSessions) {
            this._log('info', `会话收尾: keepSessions=true，保留远端会话 id=${sessionId}（reason=${reason}）`);
            return;
        }

        // 2. 删除前确保对话已归档到本地
        let archived = false;
        try {
            await this.#cli.getSessionMessages(sessionId);
            archived = true;
        } catch (err) {
            this._log('warn',
                `会话收尾: 归档失败，跳过删除以保全对话记录 id=${sessionId}: ${err.message}`);
        }
        if (!archived) return;

        // 3. 删除远端会话（本地归档保留）
        try {
            await this.#cli.deleteSession(sessionId);
            this._log('info', `会话收尾完成(${reason}): 已归档并回收远端会话 id=${sessionId}`);
        } catch (err) {
            this._log('warn', `会话收尾: deleteSession 失败（忽略）id=${sessionId}: ${err.message}`);
        }
    }

    /**
     * persistKnowledge — 读取经验文件，将有效经验存入任务。
     *
     * 读取 Summary .md 文件内容，将其作为经验知识记录到 TaskStepStore，
     * 并登记到知识沉淀系统（KnowledgeManager）。
     *
     * 调用时序（由 executeStart 驱动）：
     *   1. invokeSkill 执行任务（生成 result .md）
     *   2. checkResult 判断成功
     *   3. _summarizeExperience 追加经验总结 prompt（AI 生成 Summary .md）
     *   4. persistKnowledge（本方法）读取 Summary .md 并持久化
     *
     * 判断逻辑：
     *   - _summarizeExperience 成功后，Summary .md 通常已生成。
     *   - AI 可能判断无有价值经验而不生成文件（沉淀类型 = 无），此时跳过登记。
     *   - 文件不存在时静默跳过，返回 false。
     *
     * 流程：
     *   1. 检查 summaryFilePath 对应的文件是否存在（不存在 → 跳过，返回 false）
     *   2. 读取文件内容，持久化到步骤记录（knowledgeSummary 字段）
     *   3. 调用 KnowledgeManager.addExperience() 登记到知识沉淀系统
     *
     * 静默失败：持久化失败不影响主流程。
     *
     * @param {string} summaryFilePath - 经验文件路径
     * @returns {Promise<boolean>} 是否成功
     */
    async persistKnowledge(summaryFilePath) {
        this._ensureInitialized();

        if (!summaryFilePath) {
            this._log('warn', 'persistKnowledge: summaryFilePath 为空');
            return false;
        }

        // ── 检查经验文档是否存在 ──
        // 无 SKILL 模式下，AI 可能判断无有价值经验而不生成 Summary 文件，
        // 此时跳过知识沉淀登记。
        let exists = false;
        try {
            await fs.access(summaryFilePath);
            exists = true;
        } catch {
            exists = false;
        }

        if (!exists) {
            this._log('info', `persistKnowledge: 经验文档不存在，跳过知识沉淀登记 — ${summaryFilePath}`);
            return false;
        }

        try {
            const content = await fs.readFile(summaryFilePath, 'utf-8');
            this._log('debug', `persistKnowledge: 已读取经验文件 (${content.length} 字符)`);

            // 1. 将经验内容持久化到步骤记录
            await this._persistStep({ knowledgeSummary: content });
            this._log('debug', 'persistKnowledge: 经验已持久化到步骤记录');

            // 2. 登记到知识沉淀系统
            if (this.#knowledgeManager) {
                // 避免重复登记：先检查是否已存在
                const existing = await this.#knowledgeManager.findByDocPath(summaryFilePath);
                if (existing) {
                    this._log('debug', `persistKnowledge: 经验已登记过，跳重复登记 — id: ${existing.id}`);
                } else {
                    const record = await this.#knowledgeManager.addExperience({
                        docPath: summaryFilePath,
                        taskId: this.#taskId,
                        stepId: this.#stepId,
                        bigLoopIndex: this.#bigLoopIndex,
                        retryCount: this.#executeStep,
                        skillDir: this.#matchedSkillDir,
                        taskDescription: this.#taskDescription
                    });
                    this._log('debug', `persistKnowledge: 经验已登记到知识沉淀系统 — id: ${record.id}`);
                }
            } else {
                this._log('warn', 'persistKnowledge: KnowledgeManager 未初始化，跳过知识沉淀登记');
            }

            return true;
        } catch (err) {
            this._log('warn', `persistKnowledge: 处理经验文件失败: ${summaryFilePath} — ${err.message}`);
            return false;
        }
    }

    /**
     * controlExecution — 控制执行步骤。
     *
     * @param {string} type - 控制类型：'pause' | 'resume' | 'abort'
     * @returns {Promise<boolean>} 是否成功
     */
    async controlExecution(type) {
        this._ensureInitialized();

        switch (type) {
            case ControlType.PAUSE:
                this.#paused = true;
                this._log('info', '⏸  执行已暂停');
                await this._persistStep({ status: 'paused' });
                return true;

            case ControlType.RESUME:
                this.#paused = false;
                this._log('info', '▶  执行已继续');
                await this._persistStep({ status: StepStatus.RUNNING });
                return true;

            case ControlType.ABORT:
                this.#aborted = true;
                this.#paused = false;
                this._log('warn', '⏹  执行已终止');
                // F-06：先中断在途 HTTP，让卡在请求里的 await 立即失败并退出，
                // 而不是等下一个轮询周期（最长一个 pollInterval）才被感知。
                try {
                    if (typeof this.#cli.abortInFlight === 'function') {
                        this.#cli.abortInFlight('执行已终止');
                    }
                    this.#abortController?.abort(new Error('执行已终止'));
                } catch (err) {
                    this._log('warn', `中断在途请求失败: ${err.message}`);
                }
                // 若有活跃 session，立即中止远端（不等轮询周期）；
                // F-03：置 #remoteAborted，避免收尾阶段重复 abort
                if (this.#sessionId) {
                    try {
                        await this.#cli.abortSession(this.#sessionId);
                        this.#remoteAborted = true;
                        this._log('info', `已中止 Session: ${this.#sessionId}`);
                    } catch (err) {
                        this._log('warn', `中止 Session 失败: ${err.message}`);
                    }
                }
                await this._persistStep({
                    status: StepStatus.SKIPPED,
                    endTime: nowCST()
                });
                return true;

            default:
                this._log('warn', `未知的控制类型: "${type}"，支持: pause | resume | abort`);
                return false;
        }
    }

    /**
     * 注入外部取消源（AbortSignal）—— Phase 2/3 的取消闭环。
     *
     * `AgentRuntime` 会把「运行器级信号 ∪ 取消树信号」合并后下发
     * （见 `AgentRuntime._runWithAdapter`）。FlexRunner 此前**没有**这个公开方法，
     * 于是合并后的信号被静默丢弃，只剩 `controlExecution('abort')` 这一条路径；
     * 而那条路径在"角色还在排队等槽位"时打不到（此时还没有 adapter），
     * 结果是取消后仍会新建会话。这里把外部信号接到本实例的取消流程上。
     *
     * @param {AbortSignal} signal
     * @returns {void}
     */
    setAbortSignal(signal) {
        if (!signal || typeof signal.addEventListener !== 'function') return;

        const forward = () => {
            // 幂等：已终止过就不再走一遍（避免重复 abortSession / 重复落盘）
            if (this.#aborted) return;
            this.controlExecution(ControlType.ABORT).catch((err) => {
                this._log('warn', `外部取消源触发终止失败: ${err.message}`);
            });
        };

        if (signal.aborted) {
            forward();
            return;
        }
        signal.addEventListener('abort', forward, { once: true });
    }

    /**
     * getSessionContent — 获取当前会话的内容。
     *
     * 通过读取 db/Session/ 目录下的归档文件获取会话内容：
     *   - <sessionId>.jsonl       — 消息流（每行一条消息）
     *   - <sessionId>.meta.json   — 会话元信息
     *
     * 返回合并后的 JSON 文本字符串，结构为：
     *   { "meta": {...}, "messages": [{...}, ...] }
     *
     * @returns {Promise<string>} JSON 文本（包含 meta 和 messages）
     */
    async getSessionContent() {
        this._ensureInitialized();

        if (!this.#sessionId) {
            this._log('warn', 'getSessionContent: 当前无活跃会话');
            return JSON.stringify({ meta: null, messages: [] });
        }

        try {
            const sessionStore = this.#storage.sessionStore();

            // 并行读取元信息与消息流
            const [meta, messages] = await Promise.all([
                sessionStore.readMeta(this.#sessionId).catch(() => null),
                sessionStore.readMessages(this.#sessionId).catch(() => [])
            ]);

            this._log(
                'info',
                `getSessionContent: 读取 session ${this.#sessionId}，共 ${messages.length} 条消息`
            );

            return JSON.stringify({ meta, messages }, null, 2);
        } catch (err) {
            this._log('error', `getSessionContent: 读取失败: ${err.message}`);
            return JSON.stringify({ meta: null, messages: [], error: err.message });
        }
    }

    /**
     * checkResult — 读取结果文件，判断执行是否成功。
     *
     * 兼容 SKILL 产物中多种执行状态标记格式（按优先级匹配）：
     *   1. 标题下独立行：`## 执行状态` 下一行为 `成功` / `失败`
     *   2. 标题内联：`## 执行状态: 成功` / `## 执行状态：失败`
     *   3. 末尾 `状态:` 行：文件末尾附近 `状态: 成功` / `状态: 失败`
     *      （如 ArkTsLibraryInterfaceSpecSkill 的 count-report.cjs 写回格式）
     *
     * 状态值归一化：`成功` 判 true；`失败` 判 false；
     * 已知中间态（`部分通过` / `源库构建问题` / `环境不可用` / `设备不可用`）
     * 视为成功（产物已完成，非失败），记录 warn 日志；
     * 其他未知状态值视为无法解析 → false。
     *
     * @param {string} resultFilePath - 结果文件路径
     * @returns {Promise<boolean>} 执行是否成功
     */
    async checkResult(resultFilePath) {
        this._ensureInitialized();

        if (!resultFilePath) {
            this._log('warn', 'checkResult: resultFilePath 为空');
            return false;
        }

        try {
            let content = await fs.readFile(resultFilePath, 'utf-8');
            if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

            // 1. 标题下独立行：`## 执行状态` 下一行为状态值（可能带 - / * / > 列表前缀）
            let match = content.match(/^#{1,6}\s*执行状态\s*$\n\s*(.+)$/m);
            if (match) {
                return this._parseStatusValue(match[1].trim(), resultFilePath);
            }

            // 2. 标题内联：`## 执行状态: 成功` / `## 执行状态：失败`
            match = content.match(/^#{1,6}\s*执行状态\s*[:：]\s*([^\n]+)/m);
            if (match) {
                return this._parseStatusValue(match[1].trim(), resultFilePath);
            }

            // 3. 末尾 `状态:` 行：仅取文件最后 10 行，避免正文中误出现"状态:"字样
            const tailLines = content.split('\n').slice(-10);
            for (const line of tailLines) {
                const tailMatch = line.match(/^\s*状态\s*[:：]\s*(.+)$/);
                if (tailMatch) {
                    return this._parseStatusValue(tailMatch[1].trim(), resultFilePath);
                }
            }

            this._log('warn', `checkResult: 结果文件中未找到有效的执行状态字段: ${resultFilePath}`);
            return false;
        } catch (err) {
            this._log('warn', `checkResult: 读取结果文件失败: ${resultFilePath} — ${err.message}`);
            return false;
        }
    }

    /**
     * 解析结果文件中的状态值。
     *
     * 状态判定规则：
     *   - `成功` → true
     *   - `失败` → false
     *   - 已知中间态（`部分通过` / `源库构建问题` / `环境不可用` / `设备不可用`）
     *     视为成功（产物已完成，非失败），记录 warn 日志
     *   - 其他未知状态值 → false（视为无法解析，避免误判成功）
     *
     * @param {string} raw - 状态值原始文本
     * @param {string} resultFilePath - 结果文件路径（仅用于日志）
     * @returns {boolean} 执行是否成功
     * @private
     */
    _parseStatusValue(raw, resultFilePath) {
        if (!raw) {
            this._log('warn', `checkResult: 执行状态值解析为空: ${resultFilePath}`);
            return false;
        }

        const value = raw.replace(/^[#>*\-\s]+/, '').trim();

        if (value === '成功') {
            this._log('debug', `checkResult: 执行状态 = 成功 (${resultFilePath})`);
            return true;
        }

        if (value === '失败') {
            this._log('error', `checkResult: 执行状态 = 失败 (${resultFilePath})`);
            return false;
        }

        // 已知中间态：产物已完成但非完全成功，视为成功（记录 warn 提示）
        const KNOWN_MIDDLE_STATES = ['部分通过', '源库构建问题', '环境不可用', '设备不可用'];
        if (KNOWN_MIDDLE_STATES.includes(value)) {
            this._log('warn', `checkResult: 识别到中间态状态「${value}」，视为成功 (${resultFilePath})`);
            return true;
        }

        this._log('warn', `checkResult: 无法识别的执行状态「${value}」，视为失败 (${resultFilePath})`);
        return false;
    }

    /**
     * getLiveMessages — 获取当前会话的实时对话消息。
     *
     * 委托 CLI 的 getLiveMessages，从远端拉取当前已有消息并返回精简格式。
     * 运行中安全调用，不写入本地存档，不影响后续归档去重。
     *
     * 如果当前无活跃会话，返回空数组。
     *
     * @returns {Promise<Array<{id,role,content,finish,timestamp}>>}
     */
    async getLiveMessages() {
        this._ensureInitialized();

        if (!this.#sessionId) {
            this._log('warn', 'getLiveMessages: 当前无活跃会话');
            return [];
        }

        if (typeof this.#cli.getLiveMessages !== 'function') {
            this._log('warn', `getLiveMessages: CLI 不支持 getLiveMessages 方法`);
            return [];
        }

        return this.#cli.getLiveMessages(this.#sessionId);
    }

    /**
     * injectPrompt — 向当前会话注入提示词/上下文（不触发 AI 回复）。
     *
     * 利用 CLI 的 injectPrompt 能力，将文本注入对话历史但不触发 AI 生成回复。
     * 适用于对话过程中动态补充上下文、规则、指令。
     *
     * 如果当前无活跃会话，返回失败。
     *
     * @param {string} message - 要注入的提示词/上下文
     * @returns {Promise<{ success: boolean }>}
     */
    async injectPrompt(message) {
        this._ensureInitialized();

        if (!message || typeof message !== 'string') {
            throw new Error('injectPrompt: message 为必填项且必须为字符串');
        }

        if (!this.#sessionId) {
            this._log('warn', 'injectPrompt: 当前无活跃会话');
            return { success: false };
        }

        if (typeof this.#cli.injectPrompt !== 'function') {
            this._log('warn', `injectPrompt: CLI 不支持 injectPrompt 方法`);
            return { success: false };
        }

        try {
            const result = await this.#cli.injectPrompt(this.#sessionId, message);
            this._log(
                'info',
                `injectPrompt: 已向 session ${this.#sessionId} 注入 ${message.length} 字符提示词`
            );
            return result;
        } catch (err) {
            this._log('error', `injectPrompt: 注入失败: ${err.message}`);
            return { success: false };
        }
    }

    /**
     * sendAndWaitMessage — 向当前会话发送消息并同步等待 AI 回复完成。
     *
     * 发送消息后阻塞等待 AI 生成完整回复，然后返回回复内容。
     * 与普通的 fire-and-forget 发送不同，此方法会等到 AI 回复完成才返回。
     *
     * 如果当前无活跃会话，返回失败。
     *
     * @param {string} message - 要发送的消息
     * @returns {Promise<{ success: boolean, response: object|string, content: string }>}
     */
    async sendAndWaitMessage(message) {
        this._ensureInitialized();

        if (!message || typeof message !== 'string') {
            throw new Error('sendAndWaitMessage: message 为必填项且必须为字符串');
        }

        if (!this.#sessionId) {
            this._log('warn', 'sendAndWaitMessage: 当前无活跃会话');
            return { success: false, response: '', content: '' };
        }

        if (typeof this.#cli.sendAndWaitMessage !== 'function') {
            this._log('warn', `sendAndWaitMessage: CLI 不支持 sendAndWaitMessage 方法`);
            return { success: false, response: '', content: '' };
        }

        try {
            const result = await this.#cli.sendAndWaitMessage(this.#sessionId, message);
            this._log(
                'info',
                `sendAndWaitMessage: session ${this.#sessionId} 已收到回复，` +
                `content 长度 ${result?.content?.length || 0}`
            );
            return result;
        } catch (err) {
            this._log('error', `sendAndWaitMessage: 发送并等待失败: ${err.message}`);
            return { success: false, response: '', content: '' };
        }
    }

    // ─── 私有方法 ─────────────────────────────────────────────────────────────

    /**
     * 确保已调用 initContext 完成初始化。
     * @private
     */
    _ensureInitialized() {
        if (!this.#initialized) {
            throw new Error('FlexRunner 尚未初始化，请先调用 initContext()');
        }
    }

    /**
     * 将当前步骤的执行状态持久化到 db/task/{taskId}/stepid_{stepId}_loop{L}.json。
     *
     * 在执行过程的关键节点（开始、匹配后、会话创建后、结束、终止）被调用，
     * 增量更新记录文件，方便外部追踪任务执行进度。
     * 按大循环轮次独立存储，避免跨轮覆盖。
     *
     * 静默失败：持久化不影响主流程，仅记录 warn 日志。
     *
     * @param {object} patch - 要合并的字段
     * @private
     */
    async _persistStep(patch) {
        try {
            if (!this.#taskId || this.#stepId <= 0) return;
            const store = this.#storage.taskExecStore();
            await store.patchStep(this.#taskId, this.#stepId, {
                taskId: this.#taskId,
                stepId: this.#stepId,
                dependId: this.#dependId,
                nextStepId: this.#nextStepId,
                failStepId: this.#failStepId,
                bigLoopIndex: this.#bigLoopIndex,
                taskDescription: this.#taskDescription,
                skillDirectory: this.#skillDirectory,
                specifiedSkill: this.#specifiedSkill,
                inputReport: this.#inputReport,
                matchedSkillDir: this.#matchedSkillDir,
                sessionId: this.#sessionId,
                executeStep: this.#executeStep,
                retryTimes: this.#retryTimes,
                maxRetries: this.#maxRetries,
                startTime: this.#startTime,
                endTime: this.#endTime,
                ...patch
            }, this.#bigLoopIndex);
        } catch (err) {
            this._log('warn', `_persistStep: 步骤记录持久化失败: ${err.message}`);
        }
    }

    /**
     * 构建 opencode 初始执行 prompt。
     *
     * 仅负责任务执行 + 生成 result .md，**不包含经验总结指令**。
     * 经验总结在 checkResult 成功后由 _buildSummaryPrompt 独立构建。
     *
     * @param {string} taskDescription - 任务描述
     * @param {string|null} skillDir   - SKILL 目录（null 表示无 SKILL 模式）
     * @param {string} [reportPath]    - 输入报告路径
     * @param {object} [filePaths]     - 文件路径
     * @param {string} [filePaths.resultFilePath]  - 结果文件输出路径
     * @param {string} [filePaths.metaFilePath]    - 结构化指标文件输出路径（可选）
     * @returns {string} 拼接后的 prompt 文本
     * @private
     */
    /**
     * _collectKnowledgeDocs — 取回与本次步骤相关的**跨任务历史经验**（F-25）。
     *
     * 背景：经验原本只被写入（persistKnowledge），检索入口只有 HTTP 路由，
     * Agent 主链路从不消费，所谓"跨任务复用"实际靠人工导入。这里把检索接回执行链路。
     *
     * 预算控制：条数与总字符数都设上限，避免经验库膨胀后把 prompt 撑爆
     * （步长内已有 DB 级 SKILL 上下文，不能无限叠加）。
     *
     * 失败降级：任何异常都只 warn 并返回空数组——经验是"锦上添花"，
     * 绝不能因为它取不到而让步骤失败。
     *
     * @param {string} taskDescription
     * @param {string|null} skillDir
     * @returns {Promise<Array<{taskDescription: string, docPath: string, score: number, content: string}>>}
     * @private
     */
    async _collectKnowledgeDocs(taskDescription, skillDir) {
        if (!this.#knowledgeManager || typeof this.#knowledgeManager.searchExperiences !== 'function') {
            return [];
        }
        try {
            const topK = Number(process.env.KNOWLEDGE_TOP_K) > 0
                ? Number(process.env.KNOWLEDGE_TOP_K)
                : DEFAULT_KNOWLEDGE_TOP_K;
            const hits = await this.#knowledgeManager.searchExperiences({
                query: taskDescription,
                skillDir,
                limit: topK,
                minScore: DEFAULT_KNOWLEDGE_MIN_SCORE,
                withContent: true,
                maxContentChars: DEFAULT_KNOWLEDGE_MAX_CHARS,
            });
            if (!Array.isArray(hits) || hits.length === 0) return [];

            // 总预算裁剪：逐条累加，超预算即停止（保留高分条目）
            const out = [];
            let budget = DEFAULT_KNOWLEDGE_TOTAL_CHARS;
            for (const h of hits) {
                const body = String(h.content || '').trim();
                if (!body) continue;
                if (body.length > budget) break;
                budget -= body.length;
                out.push({
                    taskDescription: h.taskDescription || '',
                    docPath: h.docPath || '',
                    score: h.score,
                    content: body,
                });
            }
            if (out.length > 0) {
                this._log('info',
                    `已注入 ${out.length} 条历史经验（源自跨任务知识库，用于避免重复踩坑）`);
            }
            return out;
        } catch (err) {
            this._log('warn', `取回历史经验失败（忽略，不影响执行）: ${err.message}`);
            return [];
        }
    }

    _buildPrompt(taskDescription, skillDir, reportPath, filePaths = {}) {
        const parts = [];

        // Phase 2：角色指令作为**首节**注入。
        // 顺序刻意放在"任务描述"之前：角色决定行为基线（评审员只判定、执行者只实现、
        // 验证者只报告证据），而任务描述决定本次做什么；先立规矩再派活，
        // 否则同一份任务描述会在不同角色下产生同样的行为（角色化失效）。
        // 未设置 rolePrompt 时（Phase 1 路径）本分支不生效，prompt 逐字节不变。
        if (this.#rolePrompt) {
            const roleTag = this.#roleId ? `（角色：${this.#roleId}）` : '';
            parts.push(`## 你的角色${roleTag}\n${this.#rolePrompt}`);
        }

        parts.push(`## 任务描述\n${taskDescription}`);

        // 工作目录：告知 AI 当前工作目录路径，所有文件操作（git clone、读写文件等）均在此目录下执行
        if (this.#taskDir) {
            parts.push(`## 工作目录\n${this.#taskDir}\n\n所有文件操作（git clone、读写文件等）请在此目录下执行。`);
        }

        // F-25：注入跨任务历史经验（有 SKILL / 无 SKILL 两种模式都适用）。
        // 放在最前部的"任务描述/工作目录"之后、SKILL 指令之前，让模型先看到前人踩过的坑，
        // 再读 SKILL 的具体步骤。内容已在 _collectKnowledgeDocs 里做过条数与字符预算裁剪。
        if (Array.isArray(filePaths.knowledgeDocs) && filePaths.knowledgeDocs.length > 0) {
            const blocks = filePaths.knowledgeDocs.map((doc, i) => {
                const head = `### 经验 ${i + 1}（相似度得分 ${doc.score}）`;
                const src = doc.taskDescription ? `\n来源任务：${doc.taskDescription}` : '';
                return `${head}${src}\n${doc.content}`;
            });
            parts.push(
                `## 历史经验（来自既往同类任务，请优先参考以避免重复踩坑）\n\n` +
                `${blocks.join('\n\n')}\n\n` +
                `⚠️ 以上经验来自**其它任务**，请结合当前任务实际情况判断适用性；` +
                `如与当前任务描述或 SKILL 指令冲突，以当前任务与 SKILL 为准。`
            );
        }

        if (skillDir) {
            // ── 有 SKILL：按照 SKILL 指令执行 ──
            parts.push(`## SKILL 目录\n${skillDir}`);
            if (reportPath) {
                parts.push(`## 输入报告路径\n${reportPath}`);
            }
            if (filePaths.resultFilePath) {
                parts.push(`## 结果文件输出路径\n${filePaths.resultFilePath}`);
            }
            // 结构化指标文件路径（通用契约：SKILL 约定了结构化结论指标时写入）
            if (filePaths.metaFilePath) {
                parts.push(`## 结构化指标文件输出路径\n${filePaths.metaFilePath}`);
            }
            // 历史结果文档路径（第 N 次执行时传入之前的 result .md 路径，不传内容）
            if (filePaths.historyDocs && filePaths.historyDocs.length > 0) {
                const historyLines = filePaths.historyDocs.map(
                    (doc) => `- 本轮重试结果 (retry=${doc.loop}): ${doc.path}`
                );
                parts.push(
                    `## 历史执行文档路径\n\n以下为本轮大循环中之前重试的结果文件路径，请自行读取参考：\n${historyLines.join('\n')}`
                );
            }
            parts.push(
                '请按照 SKILL 中的指令执行任务。',
                '执行完成后，请将结果写入上述"结果文件输出路径"。',
                '结果文件需包含 `## 执行状态` 字段（值为 `成功` 或 `失败`），用于判断执行结果。'
            );
            if (filePaths.metaFilePath) {
                parts.push(
                    '若本次使用的 SKILL 中定义了结构化结论指标（如合入等级、评分等），请在执行完成后，',
                    `将指标以 JSON 对象形式写入上述"结构化指标文件输出路径"（键名按 SKILL 约定，如 {"mergeLevel":"PASS"}）。`,
                    '若 SKILL 未定义结构化指标，则无需创建该文件。'
                );
            }
        } else {
            // ── 无 SKILL：基于任务描述本身直接执行 ──
            if (reportPath) {
                parts.push(`## 输入报告路径\n${reportPath}`);
            }
            if (filePaths.resultFilePath) {
                parts.push(`## 结果文件输出路径\n${filePaths.resultFilePath}`);
            }
            if (filePaths.metaFilePath) {
                parts.push(`## 结构化指标文件输出路径\n${filePaths.metaFilePath}`);
            }
            // 历史结果文档路径（第 N 次执行时传入之前的 result .md 路径，不传内容）
            if (filePaths.historyDocs && filePaths.historyDocs.length > 0) {
                const historyLines = filePaths.historyDocs.map(
                    (doc) => `- 本轮重试结果 (retry=${doc.loop}): ${doc.path}`
                );
                parts.push(
                    `## 历史执行文档路径\n\n以下为本轮大循环中之前重试的结果文件路径，请自行读取参考：\n${historyLines.join('\n')}`
                );
            }
            parts.push(
                '本次任务未匹配到专用 SKILL，请直接基于上述任务描述执行任务。',
                '执行完成后，请将结果写入上述"结果文件输出路径"。',
                '结果文件需包含 `## 执行状态` 字段（值为 `成功` 或 `失败`），用于判断执行结果。'
            );
        }

        // ── MCP 工具引导：提醒 AI 主动使用 MCP Gateway 提供的工具 ──
        if (this.#mcpToolGuide) {
            const toolGuide = this.#mcpToolGuide.buildToolGuide();
            if (toolGuide) {
                parts.push(toolGuide);
            }
        }

        return parts.join('\n\n');
    }

    /**
     * _buildSummaryPrompt — 构建经验总结专用 prompt。
     *
     * 此 prompt 在 checkResult 成功后，通过 sendAndWaitMessage 向同一 Session
     * 追加发送，要求 AI 基于已有的执行上下文生成 Summary .md 经验总结文件。
     *
     * 与初始执行 prompt 分离的原因：
     *   - 确保经验总结仅在执行成功后触发
     *   - AI 在总结时已有完整的执行上下文（同一 Session），总结质量更高
     *   - 初始 prompt 更简洁，AI 专注执行任务
     *
     * @param {string} summaryFilePath - 经验文件输出路径
     * @param {string|null} skillDir   - SKILL 目录路径（null 表示无 SKILL 模式）
     * @returns {string} 拼接后的经验总结 prompt 文本
     * @private
     */
    _buildSummaryPrompt(summaryFilePath, skillDir) {
        const parts = [
            '## 任务已执行成功，请进行经验总结',
            '',
            '以上任务已执行成功。请基于本次执行过程中的实际情况，评估是否产生了**有价值的、可复用的经验总结**。',
            '',
            '## 判断标准',
            '- 本次执行中发现了关键的踩坑点、解决方案、最佳实践或可复用的模式',
            '- 这些经验对未来类似的任务有明确的参考价值',
            '- 不是简单的执行流水账或重复的通用知识',
            '',
            '## 处理方式',
            '如果存在有价值的经验，请将经验总结写入以下路径：',
            `经验文件输出路径：${summaryFilePath}`,
            '',
            '经验文件应包含：关键发现、踩坑记录、解决方案、可复用建议等。',
            '',
            '## 经验分类（必须在经验文件末尾输出）',
            '在经验文件末尾附上以下经验分类块，用于标记本次经验的归属类型：',
            '```',
            '## 经验分类',
            '- 沉淀类型: skill优化 | 知识库 | 无'
        ];

        if (skillDir) {
            parts.push(
                `- 适用SKILL: ${skillDir}`,
                '- 优化建议: <对当前SKILL的具体修改/新增点，skill优化类必填>'
            );
        } else {
            parts.push(
                '- 适用SKILL: <无，本次未匹配到SKILL>',
                '- 优化建议: <skill优化类必填，但本次无SKILL，通常填"无">'
            );
        }

        parts.push(
            '```',
            '',
            '字段说明：',
            '- 沉淀类型：三选一。'
        );

        if (skillDir) {
            parts.push(
                '  - skill优化 = 当前SKILL有可改进之处（检查项缺失/规则错误/可复用模式未被覆盖）；',
                '  - 知识库 = 通用领域经验，与具体SKILL逻辑无关；'
            );
        } else {
            parts.push(
                '  - skill优化 = 需为某个SKILL沉淀优化建议；',
                '  - 知识库 = 通用领域经验，与具体SKILL逻辑无关；'
            );
        }

        parts.push(
            '  - 无 = 无有价值经验，此时不生成经验文件。'
        );

        if (skillDir) {
            parts.push(
                '- 适用SKILL：仅 skill优化 类必填，填上面注入的当前 step 调用 SKILL 的路径，原样保留不要改动。',
                '- 优化建议：仅 skill优化 类必填，描述对当前SKILL的具体修改/新增点（如"新增 XX 检查项"、"修正 YY 规则"）。'
            );
        } else {
            parts.push(
                '- 适用SKILL：本次未匹配到 SKILL，此处标记"无"。若沉淀类型为 skill优化，请在优化建议中注明建议沉淀到哪个 SKILL（如期望新增或修改的 SKILL 名称）。',
                '- 优化建议：仅 skill优化 类必填，描述建议新建或修改的 SKILL 的具体点。'
            );
        }

        parts.push(
            '',
            '如果没有有价值的经验可沉淀（如任务过于简单、未发现新的经验），则**不需要生成经验文件**。',
            '请勿创建空文件或无实质内容的经验文件。',
            '',
            '请现在进行经验总结。'
        );

        return parts.join('\n');
    }

    /**
     * _summarizeAndPersist — 后台异步执行经验总结 + 知识持久化。
     *
     * 此方法为 fire-and-forget 入口，由 executeStart 在成功后以 `.catch()` 方式调用，
     * **不阻塞 executeStart 返回**，不影响 Orchestrator 步骤流转。
     *
     * 内部流程：
     *   1. _summarizeExperience → 向指定 Session 追加经验总结 prompt，等待 AI 回复 + 文件生成
     *   2. persistKnowledge     → 读取 Summary .md，持久化到步骤记录 + 知识沉淀系统
     *
     * 所有异常在方法内部 catch，仅记录日志，不向上抛出。
     *
     * @param {string} summaryFilePath - 经验文件输出路径
     * @param {string|null} skillDir   - SKILL 目录路径（null 表示无 SKILL 模式）
     * @param {string} sessionId       - 执行任务的 Session ID（显式传入，避免实例复用后被覆盖）
     * @returns {Promise<void>}
     * @private
     */
    async _summarizeAndPersist(summaryFilePath, skillDir, sessionId) {
        try {
            // 终止已请求 → 不再向 session 追加经验总结 prompt（避免终止后又触发新的 AI 生成）
            if (this.#aborted) {
                this._log('info', '_summarizeAndPersist: 已终止，跳过后台经验总结');
                return;
            }
            const summarized = await this._summarizeExperience(summaryFilePath, skillDir, sessionId);
            if (!summarized) {
                this._log('warn', '后台经验总结未生成（超时/失败），跳过知识持久化');
                return;
            }
            await this.persistKnowledge(summaryFilePath);
            this._log('info', '✅ 后台经验总结完成，知识已持久化');
        } catch (err) {
            this._log('warn', `_summarizeAndPersist 异常: ${err.message}`);
        } finally {
            // F-03：成功路径的会话收尾放在这里。经验总结仍要复用同一个 session
            // （sendAndWaitMessage 追加总结 prompt），必须等总结结束才能回收；
            // 失败/终止路径由 executeStart 尾部收尾。#sessionFinalized 保证幂等。
            await this._finalizeSession(this.#aborted ? 'aborted' : 'success')
                .catch((err) => this._log('warn', `会话收尾异常: ${err.message}`));
        }
    }

    /**
     * _summarizeExperience — 向指定 Session 追加经验总结 prompt 并等待文件生成。
     *
     * 通过 CLI 的 sendAndWaitMessage 向指定 Session 发送经验总结 prompt，
     * 同步等待 AI 回复完成，然后验证 Summary .md 文件是否已生成。
     *
     * 降级策略（不影响步骤成功状态）：
     *   - 无效 sessionId → 返回 false
     *   - sendAndWaitMessage 失败 → 返回 false
     *   - AI 回复完成但未生成 Summary .md → 等待超时后返回 false
     *   - 任何异常 → 返回 false
     *
     * @param {string} summaryFilePath - 经验文件输出路径
     * @param {string|null} skillDir   - SKILL 目录路径（null 表示无 SKILL 模式）
     * @param {string} sessionId       - 执行任务的 Session ID
     * @returns {Promise<boolean>} 经验总结是否成功生成 Summary .md
     * @private
     */
    async _summarizeExperience(summaryFilePath, skillDir, sessionId) {
        if (!summaryFilePath) {
            this._log('warn', '_summarizeExperience: summaryFilePath 为空');
            return false;
        }

        if (!sessionId) {
            this._log('warn', '_summarizeExperience: sessionId 为空，无法追加经验总结');
            return false;
        }

        this._log('info', `经验总结开始 — session: ${sessionId}`);

        try {
            // 终止检查：总结开始前已终止 → 跳过（不再向 session 发送新 prompt）
            if (this.#aborted) {
                this._log('info', '_summarizeExperience: 已终止，跳过经验总结');
                return false;
            }

            // 构建经验总结 prompt
            const summaryPrompt = this._buildSummaryPrompt(summaryFilePath, skillDir);

            // 直接调用 CLI 的 sendAndWaitMessage，显式传入 sessionId
            // （不经过 this.sendAndWaitMessage 包装，避免读取 this.#sessionId 被实例复用覆盖）
            if (typeof this.#cli.sendAndWaitMessage !== 'function') {
                this._log('warn', '_summarizeExperience: CLI 不支持 sendAndWaitMessage 方法');
                return false;
            }

            const result = await this.#withSessionSlot(
                (why) => this._log('warn', `_summarizeExperience: ${why}，跳过经验总结（不影响步骤结果）`),
                () => this.#cli.sendAndWaitMessage(sessionId, summaryPrompt)
            );
            if (result === SKIPPED_DUE_TO_SLOT) return false;

            // 等待 AI 回复期间收到终止请求 → 不再等待文件生成（session 已被远程中止）
            if (this.#aborted) {
                this._log('warn', '_summarizeExperience: 等待回复期间被终止，放弃经验总结');
                return false;
            }

            if (!result || !result.success) {
                this._log('warn', '_summarizeExperience: sendAndWaitMessage 返回失败，经验总结未完成');
                return false;
            }

            this._log('debug',
                `_summarizeExperience: AI 回复完成，content 长度 ${result.content?.length || 0}，` +
                `等待 Summary 文件生成…`
            );

            // AI 回复完成，但文件写入可能有延迟，轮询等待文件出现
            const fileReady = await this._waitForFile(summaryFilePath, SUMMARY_TIMEOUT_MS);
            if (!fileReady) {
                this._log('warn',
                    `_summarizeExperience: 等待 Summary 文件超时（${SUMMARY_TIMEOUT_MS / 1000}s）— ${summaryFilePath}`
                );
                return false;
            }

            this._log('debug', `经验总结完成 — Summary 文件已生成: ${summaryFilePath}`);
            return true;
        } catch (err) {
            this._log('error', `_summarizeExperience 异常: ${err.message}`);
            return false;
        }
    }

    /**
     * _waitForFile — 轮询等待文件出现。
     *
     * AI 回复完成后，文件写入可能有延迟（如工具调用尚未 flush），
     * 此方法按固定间隔轮询文件是否存在，直到超时。
     *
     * @param {string} filePath  - 等待的文件路径
     * @param {number} timeoutMs - 超时时间（ms）
     * @returns {Promise<boolean>} 文件是否在超时前出现
     * @private
     */
    async _waitForFile(filePath, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        const interval = 3000; // 3s 轮询间隔

        while (Date.now() < deadline) {
            if (this.#aborted) return false;

            try {
                await fs.access(filePath);
                return true;
            } catch {
                // 文件尚未出现，继续等待
            }

            await this._sleep(interval);
        }

        return false;
    }

    /**
     * 计算本次执行的产物路径（Phase 2 抽出，供 executeStart 与 _collectHistoryDocs 共用）。
     *
     * 命名规则（**单角色模式下与 Phase 1 逐字节一致**）：
     *   - 单角色：`stepId{N}_loop{L}_{kind}_{R}.{ext}`
     *   - 角色化：`stepId{N}_loop{L}_{kind}_{R}_{roleId}.{ext}`
     *
     * 复用同一函数而不是各写一份模板，是因为"产物路径"有两个消费者
     * （产出方 executeStart、收集历史方 _collectHistoryDocs）；一旦两处模板漂移，
     * 表现为"历史结果文档路径永远收集不到"这种静默失效。
     *
     * @param {string} kind - 'result' | 'Summary' | 'meta'
     * @param {number} loopCount - 步骤内重试次数
     * @param {string} [ext='md'] - 扩展名
     * @returns {string} 绝对路径
     * @private
     */
    #artifactPath(kind, loopCount, ext = 'md') {
        const suffix = this.#roleId ? `_${this.#roleId}` : '';
        return path.join(
            this.#taskDir,
            `stepId${this.#stepId}_loop${this.#bigLoopIndex}_${kind}_${loopCount}${suffix}.${ext}`
        );
    }

    /**
     * 收集当前大循环内的历史结果文档路径，供 _buildPrompt 使用。
     *
     * 收集范围：仅当前大循环轮次内，本次执行之前的重试结果（retry < loopCount）
     *   文件名: stepId{n}_loop{L}_result_{R}.md（R < loopCount）
     *
     * 注意：不再收集上一轮大循环的结果，且只收集文件路径不读取内容。
     *
     * 静默失败：文件不存在时跳过，不影响主流程。
     *
     * @param {number} loopCount - 当前步骤内重试次数（收集 R < loopCount 的文件）
     * @returns {Promise<Array<{type: string, loop: number, path: string}>>}
     * @private
     */
    async _collectHistoryDocs(loopCount) {
        const docs = [];

        // ── 收集当前大循环内的重试历史（仅路径，不读取内容） ──
        // Phase 2：用 #artifactPath 复用与 executeStart 完全相同的命名规则，
        // 否则角色化执行时这里会永远找不到文件（历史文档静默失效）。
        for (let n = 0; n < loopCount; n++) {
            const resultPath = this.#artifactPath('result', n);
            try {
                await fs.access(resultPath);
                docs.push({ type: 'result', loop: n, path: resultPath });
            } catch {
                // 文件不存在，跳过
            }
        }

        if (docs.length > 0) {
            this._log('info', `_collectHistoryDocs: 收集到 ${docs.length} 份历史结果文档路径`);
        }

        return docs;
    }

    /**
     * 轮询 opencode Session 状态，直到完成或超时。
     *
     * Phase 3 改动（**行为可见的改进，有断言守护**）：
     *   - 交给 `SessionWaiter` 统一处理，语义从 `sleep → check` 改为 `check → sleep`。
     *     原实现对**已经完成**的会话仍要等满一个轮询间隔（默认 5s）才发现，
     *     这是"单步完成感知延迟 ~5s"的直接来源；改成先查后睡后，
     *     已完成会话的感知延迟降到一次 RTT。
     *   - 注入了会话事件源（`sessionEvents.subscribe`）时走**事件驱动**：
     *     完成事件到达即返回，不再等轮询间隔；同时保留更大间隔的兜底轮询，
     *     防止事件丢失导致步骤挂到超时。
     *   - 中止检查不再受轮询间隔约束（专门的中止监听立即返回）。
     *
     * 未注入事件源时行为与 Phase 1 等价（只是不再有初始的整间隔盲区）。
     *
     * @param {string} sessionId
     * @returns {Promise<boolean>} 是否完成
     * @private
     */
    async _pollSession(sessionId) {
        const waiter = new SessionWaiter({
            poll: (sid) => this.#cli.checkSessionStatus(sid),
            subscribe: this.#sessionEvents?.subscribe
                ? (sid, onEvent) => this.#sessionEvents.subscribe(sid, onEvent)
                : null,
            pollIntervalMs: this.#pollIntervalMs,
            safetyPollMs: this.#safetyPollMs,
            // 保留 Phase 1 的单步轮询超时语义（90 分钟）——改成"无限等待"会是
            // 一次静默的行为回退：僵死会话将永远不会被放弃。
            timeoutMs: POLL_TIMEOUT_MS,
            logger: (level, msg) => this._log(level, `_pollSession: ${msg}`)
        });

        const r = await waiter.wait(sessionId, { isAborted: () => this.#aborted });
        this.#lastWaitStats = waiter.getStats();
        if (!r.completed) {
            this._log('warn',
                `Session ${sessionId} 未在超时时间内完成（reason=${r.reason} mode=${r.mode} ` +
                `waited=${r.waitedMs}ms polls=${r.polls} events=${r.events}）`);
        } else {
            this._log('debug',
                `Session ${sessionId} 完成（mode=${r.mode} waited=${r.waitedMs}ms polls=${r.polls} events=${r.events}）`);
        }
        return r.completed;
    }

    /**
     * 若处于暂停状态则等待，直到被 resume。
     * @private
     */
    async _waitIfPaused() {
        while (this.#paused && !this.#aborted) {
            await this._sleep(500);
        }
    }

    /**
     * Promise 版 sleep。
     * @param {number} ms
     * @returns {Promise<void>}
     * @private
     */
    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 统一日志输出。
     * @param {'info'|'warn'|'error'|'debug'} level
     * @param {string} message
     * @private
     */
    _log(level, message) {
        const tag = `FlexRunner:${this.#taskId || 'uninit'}`;
        const logger = createLogger(tag);
        switch (level) {
            case 'error':
                logger.error(`❌ ${message}`);
                break;
            case 'warn':
                logger.warn(`⚠  ${message}`);
                break;
            case 'debug':
                logger.debug(`🔍 ${message}`);
                break;
            default:
                logger.info(`ℹ  ${message}`);
        }
    }
}

export { FlexRunner, ControlType, StepStatus };
// 仅供测试：验证"进程级共享 KnowledgeManager"单例语义（F-17）。
// 生产代码不应直接调用——请通过 initContext({ knowledgeManager }) 注入。
export { _getSharedKnowledgeManager as __getSharedKnowledgeManagerForTest };
export default FlexRunner;
