/**
 * runner.js —— 核心引擎装配与执行
 *
 * 职责：
 *   - 参照 Server/Routes/server.js 组装共享依赖（不启动 HTTP）
 *   - 提供 run / submit / abort / wait / progress / result / list 的执行能力
 *   - 注入自定义 flexRunnerFactory，使每个 FlexRunner 复用同一 CLIController 与
 *     同一存储门面（确保 Session 存档写入用户数据目录，而非 vendor/db）
 *
 * 依赖注入链（对照 server.js）：
 *   CLIController ─┐
 *   createStorage ─┼→ OrchestratorController →(flexRunnerFactory)→ FlexRunner(cli+storage)
 *   BrainController ─(Brain{cli})→ SkillExecutor{cli}
 *   TestCheck{storage}
 *   LoopEngine{brainController, orchestratorController, testCheck, storage}
 *
 * 数据目录（A3）：createStorage({ rootDir }) 注入用户隔离目录。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveCliType } from './config.js';

// ─── vendor 路径解析 ─────────────────────────────────────────────────────────
// 优先用 vendor/Server 下的副本（发布态）；开发期允许回退到仓库 Server/ 源码。
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const CLI_ROOT = path.resolve(moduleDir, '..');

let _serverModuleRoot = null;
function resolveVendorServer(cliRoot) {
    if (_serverModuleRoot) return _serverModuleRoot;

    const vendorServer = path.join(cliRoot, 'vendor', 'Server');
    if (fs.existsSync(vendorServer)) {
        _serverModuleRoot = vendorServer;
        return vendorServer;
    }
    // 回退：直接引用仓库 Server/（开发期 npm link 场景）
    const repoServer = path.resolve(cliRoot, '..', 'Server');
    if (fs.existsSync(repoServer)) {
        _serverModuleRoot = repoServer;
        return repoServer;
    }
    throw new Error(
        `无法定位核心引擎目录：期望 cli/vendor/Server 或仓库 Server/。` +
        `请先运行 npm run prepack（或 clone 仓库到 cli/ 的上一级）`
    );
}

// 动态导入核心引擎模块
let _modules = null;
async function _loadCore(cliRoot) {
    if (_modules) return _modules;
    const serverRoot = resolveVendorServer(cliRoot);

    // 使用绝对 file URL 导入，避免 Windows 下路径格式问题
    async function imp(p) {
        const u = new URL(`file://${path.join(serverRoot, p).replace(/\\/g, '/')}`);
        return import(u.href);
    }

    const [dbUse, loopEngine, brainMod, orchestratorMod, testCheckMod, cliMod, flexRunnerMod, knowledgeMod] = await Promise.all([
        imp('DbUse/index.js'),
        imp('LoopEngine/index.js'),
        imp('Brain/index.js'),
        imp('Orchestrator/index.js'),
        imp('TestCheck/index.js'),
        imp('CLI/cli.js'),
        imp('FlexRunner/index.js'),
        imp('Knowledge/index.js'),
    ]);

    _modules = {
        createStorage: dbUse.createStorage,
        LoopEngine: loopEngine.LoopEngine,
        LoopStatus: loopEngine.LoopStatus,
        Brain: brainMod.Brain,
        Orchestrator: orchestratorMod.Orchestrator,
        OrchestratorStatus: orchestratorMod.OrchestratorStatus,
        TestCheck: testCheckMod.TestCheck,
        CheckStatus: testCheckMod.CheckStatus,
        CLIController: cliMod.CLIController,
        FlexRunner: flexRunnerMod.FlexRunner || flexRunnerMod.default,
        KnowledgeManager: knowledgeMod.KnowledgeManager || knowledgeMod.default,
        serverRoot,
    };
    return _modules;
}

/**
 * 运行时上下文：一次 CLI 命令调用期间持有的引擎实例。
 *
 * 同一个 taskId 的 run/wait/abort/progress 应复用同一批控制器实例，
 * 避免重复创建 CLIController（opencode 连接）与 storage（SQLite 连接）。
 */
class RunContext {
    /**
     * @param {object} opts
     * @param {string} opts.projectRoot
     * @param {string} opts.dataDir
     * @param {string} opts.skillDir
     * @param {string} [opts.cliType] - CLI 类型，缺省时按 CLI_TYPE 解析（默认 deveco-code）
     * @param {boolean} opts.verbose
     */
    constructor(opts = {}) {
        this.projectRoot = opts.projectRoot || process.cwd();
        this.dataDir = opts.dataDir || '';
        this.skillDir = opts.skillDir || '';
        // CLI 类型解析：显式参数 > CLI_TYPE（env/.env 链）> deveco-code（默认），
        // 与 Server/Routes/server.js 的 createServer 默认行为一致。
        this.cliType = resolveCliType(opts.cliType);
        this.verbose = !!opts.verbose;
        this._ready = false;
        this.cliRoot = opts.cliRoot || CLI_ROOT;
    }

    /** 惰性初始化并返回核心模块引用 */
    async _init() {
        if (this._ready) return;
        const core = await _loadCore(this.cliRoot);
        this.core = core;

        // ── storage：注入用户数据目录 ──
        this.storage = core.createStorage({ rootDir: this.dataDir });

        // ── CLIController：共享实例，archive 指向本 storage 的 SessionStore ──
        this.cli = new core.CLIController(this.cliType, {
            archive: this.storage.messageArchive(),
        });

        // ── controllers：与 server.js 对齐 ──
        this.orchestratorController = new (await this._importOrchestratorController())({
            storage: this.storage,
            flexRunnerFactory: null,
        });

        // 注入共享 cli：Brain/TestCheck 若不注入，会各自惰性 new CLIController()
        // （其默认取 env CLI_TYPE，但 MessageArchive 基于 vendor/Server 相对路径上溯
        //   → 落到 cli/db/Session，数据错位）。注入后会话归档统一写用户数据目录。
        this.brainController = new (await this._importBrainController())({
            storage: this.storage,
            skillDirectory: this.skillDir,
            orchestratorController: this.orchestratorController,
            cli: this.cli,
        });

        this.testCheck = new core.TestCheck({
            storage: this.storage,
            skillDirectory: this.skillDir,
            cli: this.cli,  // 注入共享 cli，避免审核会话落到 cli/db/Session
        });

        this.loopEngineController = new (await this._importLoopEngineController())({
            storage: this.storage,
            brainController: this.brainController,
            orchestratorController: this.orchestratorController,
            testCheck: this.testCheck,
            skillDirectory: this.skillDir,
        });

        // ── 注入自定义 flexRunnerFactory，让每个 FlexRunner 复用 cli/storage ──
        // 复刻 Orchestrator._createFlexRunner 的 initContext 参数并注入 cli/storage，
        // 避免 OpenCodeCLI 内部 new MessageArchive() 落到 vendor/db。
        // 注意：此处必须用普通 function（非箭头），因为 Orchestrator 以
        //   this.flexRunnerFactory(node, inputReport) 调用，this 即 Orchestrator 实例，
        //   可访问 _taskId / _loopCount。
        this.orchestratorController.flexRunnerFactory = createOrchestratorFlexRunnerFactory(this);
        this._ready = true;
    }

    /** 动态导入 OrchestratorController（在 Routes 下，单独 import） */
    async _importOrchestratorController() {
        const serverRoot = resolveVendorServer(this.cliRoot);
        const url = `file://${path.join(serverRoot, 'Routes', 'controllers', 'OrchestratorController.js').replace(/\\/g, '/')}`;
        const mod = await import(url);
        return mod.default;
    }
    async _importBrainController() {
        const serverRoot = resolveVendorServer(this.cliRoot);
        const url = `file://${path.join(serverRoot, 'Routes', 'controllers', 'BrainController.js').replace(/\\/g, '/')}`;
        const mod = await import(url);
        return mod.default;
    }
    async _importLoopEngineController() {
        const serverRoot = resolveVendorServer(this.cliRoot);
        const url = `file://${path.join(serverRoot, 'Routes', 'controllers', 'LoopEngineController.js').replace(/\\/g, '/')}`;
        const mod = await import(url);
        return mod.default;
    }

    /**
     * 创建 LoopEngine 实例（组装完整闭环）。
     * @returns {import('../vendor/Server/LoopEngine/index.js').LoopEngine}
     */
    createLoopEngine() {
        return new this.core.LoopEngine({
            storage: this.storage,
            brainController: this.brainController,
            orchestratorController: this.orchestratorController,
            testCheck: this.testCheck,
            skillDirectory: this.skillDir,
        });
    }

    /**
     * 关闭所有存储连接（SQLite 等）。
     */
    async close() {
        if (this.storage && typeof this.storage.close === 'function') {
            await this.storage.close();
        }
    }
}

/**
 * 创建一个 RunContext 实例（便捷工厂）。
 * @param {object} opts
 * @returns {RunContext}
 */
export function createRunContext(opts = {}) {
    const ctx = new RunContext(opts);
    return ctx;
}

/**
 * 提交任务并启动大循环。
 *
 * 与 HTTP 模式不同，这里直接调 LoopEngine.startLoop()，同步等待大循环结束
 * （因为 CLI 进程不能像 Server 一样 fire-and-forget 后退出）。
 *
 * @param {object} params
 * @param {RunContext} params.ctx
 * @param {string} params.taskDescription
 * @param {string} [params.taskId]
 * @param {number} [params.maxLoops]
 * @param {string} [params.acceptanceCriteria]
 * @param {function} [params.onProgress] - 进度回调（每轮轮询触发）
 * @returns {Promise<object>} LoopResult
 */
export async function submitAndRun(params = {}) {
    const { ctx, taskDescription } = params;
    await ctx._init();

    if (!taskDescription) throw new Error('taskDescription 为必填项');

    const engine = ctx.createLoopEngine();

    const result = await engine.startLoop({
        taskDescription,
        taskId: params.taskId,
        maxLoops: params.maxLoops || 3,
        acceptanceCriteria: params.acceptanceCriteria,
        skillDirectory: ctx.skillDir,
    });

    // 清理：终止后释放 orchestrator 重型引用（与 controller .finally 对齐）
    try {
        ctx.orchestratorController.disposeOrchestrator(result.taskId);
    } catch { /* 忽略 */ }

    return result;
}

/**
 * 清理已存在的同 taskId 旧实例（中断恢复语义 v1）。
 * 归档旧 loop.json 后允许重建新任务。
 */
export async function archiveTaskIfExists(ctx, taskId) {
    await ctx._init();
    const taskDir = path.join(ctx.dataDir, 'task', taskId);
    const loopFile = path.join(taskDir, 'loop.json');
    if (fs.existsSync(loopFile)) {
        const archiveFile = `${loopFile}.archived_${Date.now()}`;
        fs.renameSync(loopFile, archiveFile);
    }
}

/**
 * 查询任务进度（磁盘直读 loop.json，不依赖内存实例）。
 * @returns {Promise<object|null>}
 */
export async function readTaskProgress(ctx, taskId) {
    await ctx._init();
    try {
        const json = ctx.storage.json('task');
        const state = await json.read(`${taskId}/loop`);
        return state || null;
    } catch {
        return null;
    }
}

/**
 * 中止任务。
 *
 * 由于嵌入式模式任务在 CLI 进程内执行，abort 时先从内存恢复 LoopEngine 实例
 * 调用 abortLoop，再 fallback 修改磁盘状态（若任务已不在内存）。
 *
 * @param {RunContext} ctx
 * @param {string} taskId
 * @returns {Promise<boolean>}
 */
export async function abortTask(ctx, taskId) {
    // 确保 storage/controller 已初始化（abort 命令的 ctx 可能是全新的）
    await ctx._init();

    // 1. 尝试内存实例 abort（嵌入式下任务在进程内）
    if (ctx.loopEngineController) {
        try {
            const engine = ctx.loopEngineController._getEngine ? ctx.loopEngineController._getEngine(taskId) : null;
            if (engine) {
                const ok = await engine.abortLoop(taskId);
                if (ok) {
                    try {
                        ctx.orchestratorController.disposeOrchestrator(taskId);
                    } catch { /* 忽略 */ }
                    return true;
                }
            }
        } catch { /* 未找到，继续 fallback */ }
    }

    // 2. Fallback：修改磁盘状态标记为 aborted
    const state = readTaskProgressSync(ctx, taskId);
    if (!state) {
        // 未找到任务
        return false;
    }
    if (TERMINAL_STATES.includes(state.status)) {
        return false; // 已终态，无需中止
    }
    try {
        const json = ctx.storage.json('task');
        state.status = 'aborted';
        state.aborted = true;
        state.endTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        state.error = '由 CLI abort 命令终止';
        await json.write(`${taskId}/loop`, state);
        return true;
    } catch (err) {
        return false;
    }
}

// 终态集合（避免引入循环依赖）
const TERMINAL_STATES = ['passed', 'failed', 'aborted', 'error'];

/** 同步读取 loop.json（供 abortTask fallback） */
function readTaskProgressSync(ctx, taskId) {
    try {
        const taskDir = path.join(ctx.dataDir, 'task', taskId);
        const loopFile = path.join(taskDir, 'loop.json');
        if (fs.existsSync(loopFile)) {
            return JSON.parse(fs.readFileSync(loopFile, 'utf8'));
        }
        const orchFile = path.join(taskDir, 'orchestration.json');
        if (fs.existsSync(orchFile)) {
            return JSON.parse(fs.readFileSync(orchFile, 'utf8'));
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * 列出所有任务（扫描 loop.json / orchestration.json）。
 * @returns {Promise<object[]>}
 */
export async function listTasks(ctx, opts = {}) {
    await ctx._init();
    const taskRoot = path.join(ctx.dataDir, 'task');
    if (!fs.existsSync(taskRoot)) return [];

    const entries = fs.readdirSync(taskRoot, { withFileTypes: true });
    const tasks = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const taskId = entry.name;
        // 优先 loop.json，其次 orchestration.json
        let data = null;
        try {
            data = JSON.parse(fs.readFileSync(path.join(taskRoot, taskId, 'loop.json'), 'utf8'));
        } catch {
            try {
                data = JSON.parse(fs.readFileSync(path.join(taskRoot, taskId, 'orchestration.json'), 'utf8'));
            } catch { /* 跳过损坏任务 */ }
        }
        if (!data) continue;

        tasks.push({
            taskId,
            status: data.status || 'idle',
            currentLoop: data.currentLoop ?? data.loopCount ?? 0,
            maxLoops: data.maxLoops ?? 3,
            startTime: data.startTime || null,
            endTime: data.endTime || null,
            passed: data.status === 'passed',
            error: data.error || null,
        });
    }

    // 按开始时间降序
    tasks.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
    return tasks;
}

// ═══ 单步执行（FlexRunner 直连，不经过 Brain/Orchestrator/LoopEngine） ═══════

let _activeStandaloneRunner = null;

/**
 * 创建"独立单步" FlexRunner 实例并注入共享依赖。
 *
 * 复刻 RunContext._init() 中 flexRunnerFactory 的注入逻辑（cli/storage/knowledgeManager），
 * 避免 opencode 会话归档/知识沉淀落到 vendor 相对路径。与编排版差异：
 *   - 参数从 CLI 显式传入，而非 Orchestrator node 对象
 *   - 不注入 onSessionCreated（无 SSE），sessionId 由返回结果带出
 *
 * @param {RunContext} ctx
 * @param {object} params
 * @param {string} params.taskId
 * @param {number} params.stepId
 * @param {string} params.taskDescription
 * @param {string} [params.skillDirectory]
 * @param {string} [params.specifiedSkill] - 指定的 SKILL name 或目录名（跳过 SkillSelector 匹配）
 * @param {string} [params.taskDir]
 * @param {string} [params.inputReport]
 * @param {number} [params.maxRetries]
 * @param {number} [params.bigLoopIndex]
 * @returns {Promise<import('../vendor/Server/FlexRunner/index.js').FlexRunner>}
 */
export async function createStandaloneFlexRunner(ctx, params) {
    const FlexRunnerCtor = ctx.core.FlexRunner;
    const runner = new FlexRunnerCtor();

    // 知识沉淀：注入指向正确数据目录的 KnowledgeManager
    let knowledgeManager = null;
    const KnowledgeManagerCtor = ctx.core.KnowledgeManager || null;
    if (KnowledgeManagerCtor && ctx.storage && typeof ctx.storage.json === 'function') {
        try {
            const km = new KnowledgeManagerCtor({ jsonAdapter: ctx.storage.json('Knowledge') });
            await km.init();
            knowledgeManager = km;
        } catch { /* 注入失败则跳过（内部会惰性加载） */ }
    }

    await runner.initContext({
        taskId: params.taskId,
        stepId: Number(params.stepId) || 1,
        dependId: 0,
        nextStepId: 0,
        failStepId: 0,
        taskDescription: params.taskDescription,
        skillDirectory: params.skillDirectory || ctx.skillDir || '',
        specifiedSkill: params.specifiedSkill || '',
        taskDir: params.taskDir,
        inputReport: params.inputReport || '',
        maxRetries: params.maxRetries ?? 3,
        bigLoopIndex: params.bigLoopIndex || 0,
        cli: ctx.cli,
        storage: ctx.storage,
        knowledgeManager,
    });
    return runner;
}

/**
 * 运行单个步骤（阻塞直到成功或重试耗尽）。
 *
 * 流程：createStandaloneFlexRunner → while(canRetry()) executeStart()。
 * 结束后写精简 loop.json（isSingleExecution:true），供 3rdloop list/progress/result 可见。
 *
 * @param {RunContext} ctx
 * @param {object} params
 * @param {string} params.taskId
 * @param {number} params.stepId
 * @param {string} params.taskDescription
 * @param {string} [params.skillDirectory]
 * @param {string} [params.specifiedSkill] - 指定的 SKILL name 或目录名（跳过 SkillSelector 匹配）
 * @param {string} [params.taskDir]
 * @param {string} [params.inputReport]
 * @param {number} [params.maxRetries]
 * @param {number} [params.bigLoopIndex]
 * @returns {Promise<{ taskId: string, stepId: number, success: boolean, resultPath: string|null, nextStepId: number, error: string|null, executeStep: number }>}
 */
export async function runStandaloneStep(ctx, params) {
    await ctx._init();

    if (!params.taskDescription) throw new Error('taskDescription 为必填项');
    if (!params.taskId) throw new Error('taskId 为必填项');

    // 保证 taskDir 存在（opencode session 需要工作目录）
    const taskId = params.taskId;
    const taskDir = params.taskDir || path.join(ctx.dataDir, 'task', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    params = { ...params, taskDir };

    const startTime = _nowLocal();

    // 写初始 loop.json（executing，使任务立即可见）
    await _writeStandaloneLoopJson(ctx, {
        taskId,
        taskDescription: params.taskDescription,
        taskDir,
        skillDirectory: params.skillDirectory || ctx.skillDir || '',
        status: 'executing',
        startTime,
        endTime: null,
    });

    const runner = await createStandaloneFlexRunner(ctx, params);
    _activeStandaloneRunner = runner;

    try {
        let result = null;
        let lastError = null;
        while (runner.canRetry()) {
            try {
                result = await runner.executeStart();
                if (result.success) break;
                lastError = null;
            } catch (err) {
                lastError = err.message;
            }
            if (result?.success) break;
        }

        const success = !!(result && result.success);
        const finalState = {
            taskId,
            taskDescription: params.taskDescription,
            taskDir,
            skillDirectory: params.skillDirectory || ctx.skillDir || '',
            status: success ? 'passed' : 'failed',
            startTime,
            endTime: _nowLocal(),
        };
        await _writeStandaloneLoopJson(ctx, finalState);

        return {
            taskId,
            stepId: Number(params.stepId) || 1,
            success,
            resultPath: result?.resultPath || null,
            nextStepId: result?.nextStepId || 0,
            error: lastError || (success ? null : '执行失败，重试耗尽'),
            executeStep: runner.retryTimes ?? 0,
        };
    } finally {
        _activeStandaloneRunner = null;
    }
}

/**
 * 中止独立单步执行（由信号处理调用）。
 * @param {RunContext} ctx
 * @param {string} taskId
 * @param {number} [stepId]
 * @returns {Promise<boolean>}
 */
export async function abortStandaloneStep(ctx, taskId, stepId = 1) {
    if (_activeStandaloneRunner) {
        try {
            await _activeStandaloneRunner.controlExecution('abort');
        } catch { /* 忽略 */ }
        return true;
    }
    // Fallback：磁盘标记 aborted
    try {
        const taskDir = path.join(ctx.dataDir, 'task', taskId);
        const loopFile = path.join(taskDir, 'loop.json');
        if (fs.existsSync(loopFile)) {
            const state = JSON.parse(fs.readFileSync(loopFile, 'utf8'));
            state.status = 'aborted';
            state.aborted = true;
            state.endTime = _nowLocal();
            state.error = '由 CLI abort 命令终止';
            await ctx.storage.json('task').write(`${taskId}/loop`, state);
            return true;
        }
    } catch { /* 忽略 */ }
    return false;
}

/** 写精简版 loop.json（单步执行任务，格式与 FlexRunnerController._writeSingleLoopJson 对齐）。 */
async function _writeStandaloneLoopJson(ctx, { taskId, taskDescription, taskDir, skillDirectory, status, startTime, endTime, error = null }) {
    try {
        // 映射 loop 状态到 orchestrator 状态（用于前端 rounds 渲染）
        let orchStatus;
        if (status === 'executing') orchStatus = 'running';
        else if (status === 'passed') orchStatus = 'completed';
        else if (status === 'aborted') orchStatus = 'aborted';
        else orchStatus = 'failed';

        const state = {
            taskId,
            taskDescription,
            userAcceptanceCriteria: '',
            taskDir,
            skillDirectory,
            maxLoops: 1,
            currentLoop: 1,
            status,
            startTime: startTime || _nowLocal(),
            endTime,
            error,
            aborted: status === 'aborted',
            isSingleExecution: true,
            rounds: [{
                loop: 0,
                startTime: startTime || _nowLocal(),
                endTime,
                passed: status === 'passed',
                error,
                planningIsReplan: false,
                planningStepCount: 1,
                orchestratorStatus: orchStatus,
            }],
            persistedAt: _nowLocal(),
        };
        await ctx.storage.json('task').write(`${taskId}/loop`, state);
    } catch { /* 写 loop.json 失败不影响主流程 */ }
}

/** 本地时间字符串（+08:00 CST，与 nowCST() 对齐的简化实现）。 */
function _nowLocal() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`;
}

// ═══ 任务注册表（SQLite，db/TaskRegistry/registry.db） ═══
// 与 OrchestratorController._registerTask / _patchRegistryFinalState 语义对齐：
// 前端历史列表（如 PR 检视页 taskIdPrefix=codecheck_）从注册表分页查询，
// CLI 提交的编排任务若不入表，前端将看不到。写入失败只警告、不阻断主流程。

/**
 * 注册任务摘要到注册表（对齐 OrchestratorController._registerTask）。
 * @param {import('./runner.js').RunContext} ctx
 * @param {object} entry - { taskId, taskType, status, title, description, createdAt, metadata }
 * @private
 */
async function _registryUpsert(ctx, entry) {
    try {
        const registry = ctx.storage.taskRegistryStore();
        if (!registry) return;
        await registry.upsert(entry);
    } catch (err) {
        console.warn(`[runner] 注册任务摘要失败: ${err.message}`);
    }
}

/**
 * 任务终态时回写注册表 status + 结构化指标（对齐 _patchRegistryFinalState）。
 * 多步骤时合并各步骤 metrics（后完成的覆盖同名字段）。
 * @param {import('./runner.js').RunContext} ctx
 * @param {string} taskId
 * @param {object} progress - orch.getProgress() 返回的快照
 * @private
 */
async function _registryPatchFinalState(ctx, taskId, progress) {
    try {
        const registry = ctx.storage.taskRegistryStore();
        if (!registry) return;

        let metrics = null;
        for (const s of (progress.steps || [])) {
            if (s.metrics && typeof s.metrics === 'object') {
                metrics = { ...(metrics || {}), ...s.metrics };
            }
        }

        const patch = { status: progress.status || 'completed' };
        if (metrics) {
            const existing = await registry.get(taskId);
            const existingMeta = existing && existing.metadata && typeof existing.metadata === 'object'
                ? existing.metadata
                : {};
            patch.metadata = { ...existingMeta, ...metrics };
        }
        await registry.patch(taskId, patch);
    } catch (err) {
        console.warn(`[runner] 回写编排终态注册表失败: ${err.message}`);
    }
}

// ═══ 编排（Orchestrator 多步骤依赖，对应 POST /api/orchestrator/load|start） ═══

/**
 * 创建编排版 flexRunnerFactory（与 RunContext._init 中注入的完全一致）。
 *
 * 提取为独立函数供两类使用方复用：
 *   - RunContext._init 注入 orchestratorController（大循环 LoopEngine 编排）
 *   - 3rdloop orch run/start 创建独立 Orchestrator 实例
 *
 * 注入共享 cli/storage/knowledgeManager，避免 FlexRunner 内部默认实例
 * 落到 vendor/Server 相对路径（cli/db 数据错位教训）。
 *
 * @param {RunContext} ctx
 * @returns {Function} async (node, inputReport) => FlexRunner
 */
export function createOrchestratorFlexRunnerFactory(ctx) {
    const sharedCli = ctx.cli;
    const sharedStorage = ctx.storage;
    const FlexRunnerCtor = ctx.core.FlexRunner;
    const KnowledgeManagerCtor = ctx.core.KnowledgeManager || null;

    // 必须用普通 function（非箭头）：Orchestrator 以 this.flexRunnerFactory(node, inputReport)
    // 调用，this 即 Orchestrator 实例，可访问 _taskId / _loopCount。
    return async function (node, inputReport) {
        const runner = new FlexRunnerCtor();

        // 知识沉淀：注入指向正确数据目录的 KnowledgeManager，
        // 避免 FlexRunner 内部 new KnowledgeManager() 用默认 createStorage()
        // 落到 vendor/Server 相对路径 → cli/db/Knowledge（数据错位）。
        let knowledgeManager = null;
        if (KnowledgeManagerCtor && sharedStorage && typeof sharedStorage.json === 'function') {
            try {
                const km = new KnowledgeManagerCtor({ jsonAdapter: sharedStorage.json('Knowledge') });
                await km.init();
                knowledgeManager = km;
            } catch { /* 注入失败则跳过（内部会惰性加载，仅位置不理想） */ }
        }

        await runner.initContext({
            taskId: this._taskId,
            stepId: Number(node.stepId) || 0,
            dependId: Number(node.dependencies[0]) || 0,
            nextStepId: Number(node.nextStepId) || 0,
            failStepId: Number(node.failStepId) || 0,
            taskDescription: node.taskDescription,
            skillDirectory: node.skillDirectory,
            specifiedSkill: node.specifiedSkill || '',
            taskDir: node.taskDir,
            inputReport,
            maxRetries: node.maxRetries,
            bigLoopIndex: this._loopCount || 0,
            onSessionCreated: (sessionId) => {
                node.sessionId = sessionId || '';
            },
            // ── 复用共享实例（避免重复创建 opencode / SQLite 连接）──
            cli: sharedCli,
            storage: sharedStorage,
            knowledgeManager,  // 注入共享 KnowledgeManager（正确数据目录）
        });
        return runner;
    };
}

/** 当前进程内最近一次启动的 Orchestrator（供 abort 控制）。 */
let _activeOrchestrator = null;

/**
 * 创建指定任务的 Orchestrator 实例。
 *
 * 注意：任务定义会覆盖同 taskId 的磁盘旧状态（loadTask 内部 _persistState 会重写）。
 *
 * @param {RunContext} ctx
 * @param {object} taskDef - 与 Orchestrator.loadTask 对齐的任务定义
 * @param {function} [onProgress] - 可选进度回调（每步执行后触发）
 * @returns {Promise<object>} getProgress() 快照
 */
export async function orchLoad(ctx, taskDef) {
    await ctx._init();
    if (!taskDef || !taskDef.taskId) throw new Error('taskId 为必填项');
    if (!Array.isArray(taskDef.steps) || taskDef.steps.length === 0) {
        throw new Error('steps 为必填项且不能为空');
    }

    const core = ctx.core;
    const orch = new core.Orchestrator({
        storage: ctx.storage,
        flexRunnerFactory: createOrchestratorFlexRunnerFactory(ctx),
    });
    await orch.loadTask({
        ...taskDef,
        skillDirectory: taskDef.skillDirectory || ctx.skillDir || '',
    });

    // 注册任务摘要到注册表（与 OrchestratorController.load 对齐，供前端历史列表查询）
    const firstStep = taskDef.steps[0] || {};
    await _registryUpsert(ctx, {
        taskId: taskDef.taskId,
        taskType: 'orchestrator',
        status: 'loaded',
        title: (firstStep.taskDescription || taskDef.title || '').slice(0, 200),
        description: taskDef.title || firstStep.taskDescription || '',
        createdAt: new Date().toISOString(),
        metadata: { stepCount: taskDef.steps.length }
    });

    orch.dispose();

    return { status: orch.status, progress: orch.getProgress() };
}

/**
 * 编排启动（从磁盘恢复 → 校验 LOADED → start() 阻塞到终态）。
 *
 * @param {RunContext} ctx
 * @param {string} taskId
 * @param {function} [onProgress] - 进度回调（每步执行后触发）
 * @returns {Promise<object>} { status, progress, passed, error, resultPath }
 */
export async function orchStart(ctx, taskId) {
    await ctx._init();
    if (!taskId) throw new Error('taskId 为必填项');

    // 1. 从磁盘读 orchestration.json
    const taskDir = path.join(ctx.dataDir, 'task', taskId);
    const orchFile = path.join(taskDir, 'orchestration.json');
    if (!fs.existsSync(orchFile)) {
        throw new Error(`未找到编排任务: taskId=${taskId}，请先执行 3rdloop orch load`);
    }
    let state;
    try {
        state = JSON.parse(fs.readFileSync(orchFile, 'utf8'));
    } catch {
        throw new Error(`编排状态文件损坏: ${orchFile}`);
    }

    // 2. 恢复内存实例
    const core = ctx.core;
    const orch = new core.Orchestrator({
        storage: ctx.storage,
        flexRunnerFactory: createOrchestratorFlexRunnerFactory(ctx),
    });
    await orch.restoreState(state);

    // 3. 校验状态
    if (orch.status !== core.OrchestratorStatus.LOADED) {
        throw new Error(`编排任务当前状态为 ${orch.status}，仅 LOADED 状态可启动（已加载未执行）`);
    }

    // 4. 阻塞执行
    _activeOrchestrator = orch;
    try {
        const result = await orch.start();
        const progress = orch.getProgress();
        const status = result.status;

        // 写精简 loop.json，使 3rdloop list/progress/result 可见
        await _writeOrchestrationLoopJson(ctx, {
            taskId,
            taskDescription: state.taskDescription || '',
            taskDir: progress.taskDir || taskDir,
            status: _orchStatusToLoopStatus(status),
            startTime: progress.startTime || _nowLocal(),
            endTime: progress.endTime || _nowLocal(),
            error: progress.error || null,
            orchestratorStatus: status,
            stats: progress.stats,
        });

        // 回写注册表终态（status + 结构化指标，与 OrchestratorController 终态回写对齐）
        await _registryPatchFinalState(ctx, taskId, progress);

        // 汇总各步产物路径
        const resultPaths = (progress.steps || [])
            .filter(s => s.resultPath)
            .map(s => ({ stepId: s.stepId, resultPath: s.resultPath }));

        return {
            taskId,
            status,
            passed: status === core.OrchestratorStatus.COMPLETED,
            progress,
            error: progress.error || null,
            resultPaths,
        };
    } finally {
        _activeOrchestrator = null;
        try { orch.dispose(); } catch { /* 忽略 */ }
    }
}

/**
 * 编排控制：abort / pause / resume。
 *
 * 嵌入式模式下任务在发起方进程内运行，控制命令先尝试命中当前进程内
 * 正在运行的 _activeOrchestrator；否则从磁盘恢复实例调用对应控制方法。
 * 跨进程无法中断另一进程的运行中任务（v1 与 3rdloop run 语义一致，接受现状）。
 *
 * @param {RunContext} ctx
 * @param {string} taskId
 * @param {'abort'|'pause'|'resume'} action
 * @returns {Promise<{ok: boolean, status: string|null, error: string|null}>}
 */
export async function orchControl(ctx, taskId, action) {
    await ctx._init();

    let orch = null;
    if (_activeOrchestrator && _activeOrchestrator.taskId === taskId) {
        orch = _activeOrchestrator; // 当前进程内存实例
    } else if (ctx.orchestratorController?._orchestrators?.has(taskId)) {
        orch = ctx.orchestratorController._orchestrators.get(taskId); // 大循环上下文
    } else {
        // 磁盘恢复（尽力而为，主要覆盖 LOADED/已终态任务的 pause/resume 语义）
        const taskDir = path.join(ctx.dataDir, 'task', taskId);
        const orchFile = path.join(taskDir, 'orchestration.json');
        if (fs.existsSync(orchFile)) {
            try {
                const state = JSON.parse(fs.readFileSync(orchFile, 'utf8'));
                const core = ctx.core;
                orch = new core.Orchestrator({
                    storage: ctx.storage,
                    flexRunnerFactory: createOrchestratorFlexRunnerFactory(ctx),
                });
                await orch.restoreState(state);
                // 控制操作只能在正确的状态下生效，交给各自方法自校验
            } catch { orch = null; }
        }
    }

    if (!orch) return { ok: false, status: null, error: `未找到编排任务: taskId=${taskId}` };

    let ok = false;
    try {
        if (action === 'abort') ok = await orch.abort();
        else if (action === 'pause') ok = await orch.pause();
        else ok = await orch.resume();
    } catch (err) {
        return { ok: false, status: orch.status || null, error: err.message };
    }

    const status = orch.status || null;
    // 磁盘恢复实例控制后弃置（避免泄漏连接）
    if (orch !== _activeOrchestrator && orch !== ctx.orchestratorController?._orchestrators?.get(taskId)) {
        try { orch.dispose(); } catch { /* 忽略 */ }
    }
    return { ok, status, error: null };
}

/** 编排终态集合（OrchestratorStatus 中不可继续执行的态）。 */
export const ORCH_TERMINAL_STATUSES = [
    'completed', 'failed', 'aborted', 'deadlocked'
];

/** 映射 OrchestratorStatus → loop.json 的 status 字段。 */
function _orchStatusToLoopStatus(status) {
    if (status === 'completed') return 'passed';
    if (status === 'aborted') return 'aborted';
    return 'failed';
}

/** 写精简版 loop.json（编排任务，isOrchestration:true）。 */
async function _writeOrchestrationLoopJson(ctx, { taskId, taskDescription, taskDir, status, startTime, endTime, error, orchestratorStatus, stats }) {
    try {
        const stepCount = stats && typeof stats.total === 'number' ? stats.total : 0;
        const state = {
            taskId,
            taskDescription,
            userAcceptanceCriteria: '',
            taskDir,
            skillDirectory: ctx.skillDir || '',
            maxLoops: 1,
            currentLoop: 1,
            status,
            startTime: startTime || _nowLocal(),
            endTime,
            error,
            aborted: status === 'aborted',
            isOrchestration: true,
            rounds: [{
                loop: 0,
                startTime: startTime || _nowLocal(),
                endTime,
                passed: status === 'passed',
                error,
                planningIsReplan: false,
                planningStepCount: stepCount,
                orchestratorStatus,
            }],
            stats: stats || null,
            persistedAt: _nowLocal(),
        };
        await ctx.storage.json('task').write(`${taskId}/loop`, state);
    } catch { /* 写 loop.json 失败不影响主流程 */ }
}