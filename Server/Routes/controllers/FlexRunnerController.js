import { FlexRunner, ControlType } from '../../FlexRunner/FlexRunner.js';
import { OrchestratorStatus } from '../../Orchestrator/Orchestrator.js';
import { nowCST } from '../../library/cstTime.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * FlexRunnerController —— FlexRunner 执行控制器
 *
 * 职责：封装 FlexRunner 的 HTTP 接口，供前端测试和操作。
 * 不感知 HTTP 层细节，只接收 RequestContext / ResponseContext。
 *
 * 管理多个 FlexRunner 实例（按 taskId + stepId 区分），支持：
 *   - 初始化任务
 *   - 执行单步（executeStart）
 *   - 查询状态
 *   - 控制执行（暂停/继续/终止）
 *   - 获取实时消息
 *   - 获取会话内容
 *   - 检查结果文件
 *   - 列出任务步骤记录
 */
class FlexRunnerController {
    /**
     * @param {object} [deps] - 共享依赖
     * @param {object} [deps.orchestratorController] - OrchestratorController 实例（用于从编排器中查找 FlexRunner）
     * @param {object} [deps.storage] - Storage 实例（用于在没有活跃 runner 时直接读取 session 归档）
     */
    constructor(deps = {}) {
        /** @type {Map<string, FlexRunner>} key = `${taskId}::${stepId}` */
        this._runners = new Map();
        /** @type {Map<string, {logs:string[], status:string}>} key = taskId */
        this._taskLogs = new Map();
        /** @type {object|null} OrchestratorController 实例 */
        this._orchestratorController = deps.orchestratorController || null;
        /** @type {object|null} Storage 实例 */
        this._storage = deps.storage || null;
    }

    // ─── 辅助方法 ──────────────────────────────────────────────────────

    /**
     * 生成实例缓存 key。
     */
    _key(taskId, stepId) {
        return `${taskId}::${stepId}`;
    }

    /**
     * 获取已有实例，不存在则报错。
     *
     * 查找顺序：
     *   1. 本地 _runners Map（通过 /init 注册的实例）
     *   2. OrchestratorController 中编排器步骤节点的 _runner（编排执行时创建的实例）
     */
    _getRunner(taskId, stepId) {
        // 1. 本地 Map
        const key = this._key(taskId, stepId);
        const localRunner = this._runners.get(key);
        if (localRunner) return localRunner;

        // 2. 从 OrchestratorController 的编排器实例中查找
        if (this._orchestratorController) {
            const runner = this._orchestratorController.getStepRunner(taskId, stepId);
            if (runner) return runner;
        }

        throw new Error(`未找到任务实例: taskId=${taskId}, stepId=${stepId}，请先初始化或执行编排`);
    }

    /**
     * 在没有活跃 FlexRunner 实例时，从编排器步骤元信息中提取 sessionId，
     * 然后直接读取本地 session 归档返回消息列表。
     *
     * 用于服务重启后（runner 不在内存中）仍能查看已完成步骤的对话记录。
     *
     * @param {string} taskId
     * @param {number} stepId
     * @param {number} [loop] - 大循环轮次（0-based）。指定时从磁盘 orchestration_loop{N}.json 读取历史轮次步骤信息
     * @returns {Promise<{sessionId:string, messages:Array, meta:object|null}|null>}
     */
    async _readSessionArchiveFromStep(taskId, stepId, loop) {
        if (!this._orchestratorController || !this._storage) return null;

        // 指定轮次：从磁盘读取历史轮次的步骤信息
        let stepInfo;
        if (loop != null) {
            stepInfo = await this._orchestratorController.getStepInfoByLoop(taskId, stepId, loop);
        } else {
            stepInfo = this._orchestratorController.getStepInfo(taskId, stepId);
        }
        if (!stepInfo || !stepInfo.sessionId) return null;

        const sessionId = stepInfo.sessionId;
        const sessionStore = this._storage.sessionStore();

        const [meta, messages] = await Promise.all([
            sessionStore.readMeta(sessionId).catch(() => null),
            sessionStore.readMessages(sessionId).catch(() => [])
        ]);

        return { sessionId, messages, meta };
    }

    /**
     * 将 FlexRunner 实例的状态序列化为 JSON。
     */
    _runnerToJSON(runner) {
        return {
            taskId: runner.taskId,
            stepId: runner.stepId,
            dependId: runner.dependId,
            nextStepId: runner.nextStepId,
            taskDescription: runner.taskDescription,
            taskDir: runner.taskDir,
            skillDirectory: runner.skillDirectory,
            inputReport: runner.inputReport,
            maxRetries: runner.maxRetries,
            executeStep: runner.executeStep,
            retryTimes: runner.retryTimes,
            sessionId: runner.sessionId,
            startTime: runner.startTime,
            endTime: runner.endTime,
            resultPath: runner.resultPath,
            initialized: runner.initialized,
            canRetry: runner.canRetry(),
        };
    }

    // ─── HTTP Handlers ─────────────────────────────────────────────────

    /**
     * POST /api/flexrunner/init
     * 初始化一个 FlexRunner 实例
     *
     * Body: {
     *   taskId, stepId, dependId, nextStepId, failStepId, taskDescription,
     *   skillDirectory, taskDir, inputReport, maxRetries
     * }
     */
    async init(req, res) {
        const body = req.body || {};
        const { taskId } = body;

        if (!taskId) {
            return res.error(400, 'taskId 为必填项');
        }

        const stepId = Number(body.stepId);
        if (!Number.isInteger(stepId) || stepId <= 0) {
            return res.error(400, 'stepId 必须为正整数');
        }

        // 如果同 key 实例已存在，覆盖（重新初始化）
        const runner = new FlexRunner();
        await runner.initContext({
            taskId,
            stepId,
            dependId: Number(body.dependId) || 0,
            nextStepId: Number(body.nextStepId) || 0,
            failStepId: Number(body.failStepId) || 0,
            taskDescription: body.taskDescription || '',
            skillDirectory: body.skillDirectory || '',
            taskDir: body.taskDir || '',
            inputReport: body.inputReport || '',
            maxRetries: typeof body.maxRetries === 'number' ? body.maxRetries : undefined,
        });

        const key = this._key(taskId, stepId);
        this._runners.set(key, runner);

        res.json({
            status: 'ok',
            message: `FlexRunner 已初始化: taskId=${taskId}, stepId=${stepId}`,
            runner: this._runnerToJSON(runner),
        });
    }

    /**
     * POST /api/flexrunner/execute
     * 执行单次 executeStart（不内部循环，由调用方决定是否重试）
     *
     * Body: { taskId, stepId }
     */
    async execute(req, res) {
        const body = req.body || {};
        const taskId = body.taskId;
        const stepId = Number(body.stepId);

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            return res.error(404, err.message);
        }

        if (!runner.canRetry()) {
            return res.error(409, `已达最大重试次数或已终止，无法继续执行`);
        }

        const result = await runner.executeStart();

        res.json({
            status: 'ok',
            result,
            runner: this._runnerToJSON(runner),
        });
    }

    /**
     * POST /api/flexrunner/execute-loop
     * 自动循环执行直到成功或不可重试
     *
     * Body: { taskId, stepId }
     */
    async executeLoop(req, res) {
        const body = req.body || {};
        const taskId = body.taskId;
        const stepId = Number(body.stepId);

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            return res.error(404, err.message);
        }

        const results = [];
        let lastResult;

        while (runner.canRetry()) {
            lastResult = await runner.executeStart();
            results.push({
                attempt: runner.executeStep,
                success: lastResult.success,
                nextStepId: lastResult.nextStepId,
                resultPath: lastResult.resultPath,
            });

            if (lastResult.success) break;
        }

        res.json({
            status: lastResult?.success ? 'ok' : 'error',
            totalAttempts: results.length,
            results,
            finalResult: lastResult,
            runner: this._runnerToJSON(runner),
        });
    }

    /**
     * GET /api/flexrunner/status?taskId=xxx&stepId=yyy
     * 查询 FlexRunner 实例状态
     *
     * 如果本地无实例，尝试从编排器恢复步骤状态后返回。
     */
    async status(req, res) {
        const taskId = req.query.taskId;
        const stepId = Number(req.query.stepId);

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
            res.json({
                status: 'ok',
                runner: this._runnerToJSON(runner),
            });
        } catch (err) {
            // 编排器中存在该任务但步骤已结束（runner 未存活），返回步骤元信息
            if (this._orchestratorController) {
                const stepInfo = this._orchestratorController.getStepInfo(taskId, stepId);
                if (stepInfo) {
                    return res.json({
                        status: 'ok',
                        runner: { ...stepInfo, initialized: false },
                    });
                }
            }
            return res.error(404, err.message);
        }
    }

    /**
     * GET /api/flexrunner/live-messages?taskId=xxx&stepId=yyy[&loop=N]
     * 获取当前会话的实时对话消息
     *
     * - 不传 loop：从内存编排器实例查找（最新轮次）
     * - 传 loop=N：从磁盘 orchestration_loop{N}.json 读取历史轮次步骤的 sessionId，再读取本地归档
     */
    async liveMessages(req, res) {
        const taskId = req.query.taskId;
        const stepId = Number(req.query.stepId);
        const loop = req.query.loop != null && req.query.loop !== '' ? Number(req.query.loop) : undefined;

        // 指定历史轮次：直接从磁盘读取该轮次的步骤归档（不查内存最新实例）
        if (loop != null) {
            const archive = await this._readSessionArchiveFromStep(taskId, stepId, loop);
            if (archive) {
                return res.json({
                    status: 'ok',
                    sessionId: archive.sessionId,
                    count: archive.messages.length,
                    messages: archive.messages,
                });
            }
            return res.error(404, `未找到第 ${loop} 轮步骤归档: taskId=${taskId}, stepId=${stepId}`);
        }

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            // 没有活跃 runner（如服务重启后从磁盘恢复的任务），
            // 尝试从编排器步骤元信息中获取 sessionId 并读取本地归档
            const archive = await this._readSessionArchiveFromStep(taskId, stepId);
            if (archive) {
                return res.json({
                    status: 'ok',
                    sessionId: archive.sessionId,
                    count: archive.messages.length,
                    messages: archive.messages,
                });
            }
            return res.error(404, err.message);
        }

        // 有活跃 runner，优先从远端拉取实时消息
        try {
            const messages = await runner.getLiveMessages();
            return res.json({
                status: 'ok',
                sessionId: runner.sessionId,
                count: messages.length,
                messages,
            });
        } catch (liveErr) {
            // 远端不可用（opencode 服务关闭/session 过期），回退到本地归档
            const sessionId = runner.sessionId;
            if (sessionId && this._storage) {
                const sessionStore = this._storage.sessionStore();
                const messages = await sessionStore.readMessages(sessionId).catch(() => []);
                return res.json({
                    status: 'ok',
                    sessionId,
                    count: messages.length,
                    messages,
                    warning: '远端不可用，已回退到本地归档',
                });
            }
            return res.error(500, `获取实时消息失败: ${liveErr.message}`);
        }
    }

    /**
     * POST /api/flexrunner/inject-prompt
     * 向当前会话注入提示词/上下文（不触发 AI 回复）
     *
     * Body: { taskId, stepId, message, [loop] }
     */
    async injectPrompt(req, res) {
        const body = req.body || {};
        const taskId = body.taskId;
        const stepId = Number(body.stepId);
        const { message } = body;
        const loop = body.loop != null ? Number(body.loop) : undefined;

        if (!message || typeof message !== 'string') {
            return res.error(400, 'message 为必填项且必须为字符串');
        }

        // 指定历史轮次：历史会话已结束，无法注入（仅支持查看归档）
        if (loop != null) {
            return res.error(409, `历史轮次(${loop})的会话已结束，不支持注入提示词`);
        }

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            return res.error(404, err.message);
        }

        const result = await runner.injectPrompt(message);

        res.json({
            status: result.success ? 'ok' : 'error',
            sessionId: runner.sessionId,
            success: result.success,
            message: result.success
                ? '提示词已注入'
                : '注入失败（可能无活跃会话或 CLI 不支持）',
        });
    }

    /**
     * POST /api/flexrunner/send-and-wait
     * 向当前会话发送消息并同步等待 AI 回复完成
     *
     * Body: { taskId, stepId, message, [loop] }
     */
    async sendAndWaitMessage(req, res) {
        const body = req.body || {};
        const taskId = body.taskId;
        const stepId = Number(body.stepId);
        const { message } = body;
        const loop = body.loop != null ? Number(body.loop) : undefined;

        if (!message || typeof message !== 'string') {
            return res.error(400, 'message 为必填项且必须为字符串');
        }

        // 指定历史轮次：历史会话已结束，无法发送消息
        if (loop != null) {
            return res.error(409, `历史轮次(${loop})的会话已结束，不支持发送消息`);
        }

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            return res.error(404, err.message);
        }

        const result = await runner.sendAndWaitMessage(message);

        res.json({
            status: result.success ? 'ok' : 'error',
            sessionId: runner.sessionId,
            success: result.success,
            response: result.response,
            content: result.content,
            message: result.success
                ? '已收到 AI 回复'
                : '发送失败（可能无活跃会话或 CLI 不支持）',
        });
    }

    /**
     * GET /api/flexrunner/session?taskId=xxx&stepId=yyy[&loop=N]
     * 获取当前会话的完整归档内容
     *
     * - 不传 loop：从内存编排器实例查找（最新轮次）
     * - 传 loop=N：从磁盘 orchestration_loop{N}.json 读取历史轮次步骤的 sessionId，再读取本地归档
     */
    async session(req, res) {
        const taskId = req.query.taskId;
        const stepId = Number(req.query.stepId);
        const loop = req.query.loop != null && req.query.loop !== '' ? Number(req.query.loop) : undefined;

        // 指定历史轮次：直接从磁盘读取该轮次的步骤归档
        if (loop != null) {
            const archive = await this._readSessionArchiveFromStep(taskId, stepId, loop);
            if (archive) {
                return res.json({
                    status: 'ok',
                    sessionId: archive.sessionId,
                    meta: archive.meta,
                    messages: archive.messages,
                });
            }
            return res.error(404, `未找到第 ${loop} 轮步骤归档: taskId=${taskId}, stepId=${stepId}`);
        }

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            // 没有活跃 runner，从编排器步骤元信息获取 sessionId 并读取本地归档
            const archive = await this._readSessionArchiveFromStep(taskId, stepId);
            if (archive) {
                return res.json({
                    status: 'ok',
                    sessionId: archive.sessionId,
                    meta: archive.meta,
                    messages: archive.messages,
                });
            }
            return res.error(404, err.message);
        }

        try {
            const jsonStr = await runner.getSessionContent();
            const data = JSON.parse(jsonStr);

            res.json({
                status: 'ok',
                sessionId: runner.sessionId,
                ...data,
            });
        } catch (err) {
            // runner 存在但读取失败，尝试直接从本地归档恢复
            const sessionId = runner.sessionId;
            if (sessionId && this._storage) {
                const sessionStore = this._storage.sessionStore();
                const [meta, messages] = await Promise.all([
                    sessionStore.readMeta(sessionId).catch(() => null),
                    sessionStore.readMessages(sessionId).catch(() => [])
                ]);
                return res.json({
                    status: 'ok',
                    sessionId,
                    meta,
                    messages,
                    warning: '已回退到本地归档',
                });
            }
            return res.error(500, `获取会话内容失败: ${err.message}`);
        }
    }

    /**
     * POST /api/flexrunner/control
     * 控制执行（暂停/继续/终止）
     *
     * Body: { taskId, stepId, type: 'pause'|'resume'|'abort' }
     */
    async control(req, res) {
        const body = req.body || {};
        const taskId = body.taskId;
        const stepId = Number(body.stepId);
        const { type } = body;

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            return res.error(404, err.message);
        }

        const validTypes = ['pause', 'resume', 'abort'];
        if (!validTypes.includes(type)) {
            return res.error(400, `type 必须为: ${validTypes.join(', ')}`);
        }

        const ok = await runner.controlExecution(type);

        res.json({
            status: ok ? 'ok' : 'error',
            message: `控制指令 "${type}" 已${ok ? '执行' : '失败'}`,
            runner: this._runnerToJSON(runner),
        });
    }

    /**
     * POST /api/flexrunner/check-result
     * 检查结果文件的成功/失败状态
     *
     * Body: { taskId, stepId, resultFilePath }
     */
    async checkResult(req, res) {
        const body = req.body || {};
        const taskId = body.taskId;
        const stepId = Number(body.stepId);
        const { resultFilePath } = body;

        let runner;
        let filePath = resultFilePath || null;

        try {
            runner = this._getRunner(taskId, stepId);
            if (!filePath) filePath = runner.resultPath;
        } catch (err) {
            // 没有活跃 runner（磁盘恢复的任务），从编排器步骤元信息获取 resultPath
            if (this._orchestratorController) {
                const stepInfo = this._orchestratorController.getStepInfo(taskId, stepId);
                if (stepInfo && stepInfo.resultPath) {
                    filePath = stepInfo.resultPath;
                }
            }
            if (!filePath) {
                return res.error(404, err.message);
            }
        }

        if (!filePath) {
            return res.error(400, 'resultFilePath 为空且实例无记录的 resultPath');
        }

        // 读取文件内容并解析执行状态
        let content = null;
        let success = false;
        try {
            content = await fs.readFile(filePath, 'utf-8');
            const match = content.match(/##\s*执行状态\s*\n\s*(成功|失败)/i);
            success = match ? match[1] === '成功' : false;
        } catch {
            /* 文件可能不存在 */
        }

        res.json({
            status: 'ok',
            success,
            resultFilePath: filePath,
            content,
        });
    }

    /**
     * GET /api/flexrunner/steps?taskId=xxx[&stepId=yyy][&loop=N]
     * 列出任务目录下的步骤记录文件
     *
     * - 可选 stepId：只返回该步骤的文件
     * - 可选 loop：只返回该大循环轮次的文件（匹配文件名中的 _loop{N}_ 段）
     */
    async steps(req, res) {
        const { taskId } = req.query;
        const filterStepId = req.query.stepId != null && req.query.stepId !== '' ? String(req.query.stepId) : null;
        const filterLoop = req.query.loop != null && req.query.loop !== '' ? Number(req.query.loop) : null;

        if (!taskId) {
            return res.error(400, 'taskId 为必填项');
        }

        // 从已注册的实例中查找该 taskId 的所有 step
        const stepList = [];
        const seenStepKeys = new Set();
        for (const [key, runner] of this._runners) {
            if (runner.taskId === taskId) {
                stepList.push(this._runnerToJSON(runner));
                seenStepKeys.add(this._key(runner.taskId, runner.stepId));
            }
        }

        // 从 OrchestratorController 补充编排器管理的步骤（覆盖编排执行创建的实例）
        if (this._orchestratorController) {
            const orchSteps = this._orchestratorController.getTaskSteps(taskId);
            for (const s of orchSteps) {
                const k = this._key(taskId, s.stepId);
                if (!seenStepKeys.has(k)) {
                    stepList.push(s);
                    seenStepKeys.add(k);
                }
            }
        }

        // 扫描该 task 自己的目录下的 .md 文件
        // taskDir 直接就是 db/task/{taskId}，文件直接放在该目录下（不在子目录中）
        let files = [];
        const taskDir = stepList[0]?.taskDir || null;
        if (taskDir) {
            try {
                const allFiles = await fs.readdir(taskDir);
                for (const f of allFiles) {
                    if (!f.endsWith('.md')) continue;
                    const fp = path.join(taskDir, f);
                    const fstat = await fs.stat(fp);
                    if (!fstat.isFile()) continue;

                    // 从文件名中解析 stepId 和 loop
                    // 文件命名格式: stepId{N}_loop{L}_result_{R}.md 或 stepId{N}_loop{L}_Summary_{R}.md
                    const stepIdMatch = f.match(/^stepId(\d+)/);
                    const loopMatch = f.match(/_loop(\d+)_/);
                    const fileStepId = stepIdMatch ? stepIdMatch[1] : null;
                    const fileLoop = loopMatch != null ? Number(loopMatch[1]) : null;

                    // 按 stepId 筛选
                    if (filterStepId && fileStepId !== filterStepId) continue;
                    // 按 loop 筛选
                    if (filterLoop != null && fileLoop !== filterLoop) continue;

                    files.push({
                        stepId: fileStepId || f,
                        loop: fileLoop,
                        filename: f,
                        path: fp,
                        size: fstat.size,
                    });
                }
            } catch { /* 目录不存在 */ }
        }

        res.json({
            status: 'ok',
            taskId,
            steps: stepList,
            files,
        });
    }

    /**
     * GET /api/flexrunner/file?path=xxx
     * 读取指定文件的内容（用于查看 result/summary .md）
     */
    async file(req, res) {
        const filePath = req.query.path;
        if (!filePath) {
            return res.error(400, 'path 为必填项');
        }

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            res.json({
                status: 'ok',
                path: filePath,
                content,
            });
        } catch (err) {
            res.error(404, `文件读取失败: ${err.message}`);
        }
    }

    /**
     * GET /api/flexrunner/runners
     * 列出所有已注册的 FlexRunner 实例
     */
    async runners(req, res) {
        const list = [];
        for (const runner of this._runners.values()) {
            list.push(this._runnerToJSON(runner));
        }
        res.json({
            status: 'ok',
            count: list.length,
            runners: list,
        });
    }

    // ─── 单次执行 ─────────────────────────────────────────────────────

    /**
     * POST /api/flexrunner/start-single
     * 启动单次执行 — 创建一个只含单步骤的编排任务，不走 Brain 拆解和 LoopEngine 循环。
     *
     * 内部流程：
     *   1. 生成 taskId（如果未指定）
     *   2. 构造单步骤 taskDef（stepId=1, dependId=0, nextStepId=0, failStepId=0）
     *   3. 委托 OrchestratorController.load() 加载任务 → 写 orchestration.json
     *   4. 委托 OrchestratorController.start() 异步启动编排
     *   5. 写精简版 loop.json（isSingleExecution=true）使任务列表可见
     *   6. 编排结束后更新 loop.json 终态 + 释放重型引用
     *
     * Body: {
     *   taskDescription: string,       // 必填
     *   skillDirectory?: string,       // 可选
     *   specifiedSkill?: string,       // 可选，指定 SKILL（name 或目录名），跳过自动匹配
     *   taskDir?: string,              // 可选
     *   inputReport?: string,          // 可选
     *   maxRetries?: number,           // 可选，默认 3
     *   taskId?: string                // 可选
     * }
     *
     * 响应：异步启动，立即返回 taskId 和 stepId。
     */
    async startSingle(req, res) {
        const body = req.body || {};
        const { taskDescription } = body;

        if (!taskDescription) {
            return res.error(400, 'taskDescription 为必填项');
        }
        if (!this._orchestratorController) {
            return res.error(500, 'orchestratorController 未初始化');
        }

        try {
            // ── 1. 生成 taskId ──
            const taskId = body.taskId ||
                `single_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;

            // 幂等保护：同一 taskId 若已有编排在运行，直接返回
            let existingOrch;
            try {
                existingOrch = this._orchestratorController._getOrchestrator(taskId);
            } catch { /* 不存在，正常 */ }
            if (existingOrch && existingOrch.status === OrchestratorStatus.RUNNING) {
                return res.json({
                    status: 'ok',
                    message: `单次执行已在运行中: taskId=${taskId}`,
                    taskId,
                    stepId: 1,
                    progress: existingOrch.getProgress()
                });
            }

            // 若已存在同 taskId 的旧编排（已结束），先终止并移除
            if (existingOrch) {
                try { await existingOrch.abort(); } catch { /* 已结束 */ }
                this._orchestratorController.disposeOrchestrator(taskId, { removeInstance: true });
            }

            // ── 2. 构造单步骤 taskDef ──
            const maxRetries = typeof body.maxRetries === 'number' && body.maxRetries > 0
                ? body.maxRetries
                : 3;
            const skillDirectory = body.skillDirectory || '';

            // taskDir 默认推导（Orchestrator.loadTask 内部也会推导，但 loop.json 需要提前知道）
            const rootDir = this._storage?.manager?.rootDir;
            const taskDir = body.taskDir ||
                (rootDir
                    ? path.resolve(rootDir, 'task', taskId)
                    : path.resolve(process.cwd(), 'db', 'task', taskId));

            // 确保 taskDir 存在（opencode session 需要工作目录存在）
            await fs.mkdir(taskDir, { recursive: true });

            const taskDef = {
                taskId,
                taskDir,
                skillDirectory,
                loopCount: 0,  // 单次执行固定为第 0 轮
                steps: [{
                    stepId: 1,
                    taskDescription,
                    dependId: 0,       // 入口步骤
                    nextStepId: 0,     // 无后续
                    failStepId: 0,     // 失败即终止
                    maxRetries,
                    skillDirectory,
                    specifiedSkill: body.specifiedSkill || '',
                    taskDir,
                    inputReport: body.inputReport || ''
                }]
            };

            // ── 3. 委托 OrchestratorController 加载任务 ──
            const loadReq = { body: taskDef };
            const loadRes = this._createMockResponse();
            await this._orchestratorController.load(loadReq, loadRes);

            if (loadRes._status >= 400) {
                return res.error(loadRes._status, loadRes._data?.error || loadRes._data?.message || '编排任务加载失败');
            }

            // ── 4. 启动编排（直接调用 orch.start()，便于跟踪完成） ──
            const orch = this._orchestratorController._getOrchestrator(taskId);

            // ── 5. 写精简版 loop.json（使任务列表可见） ──
            await this._writeSingleLoopJson(taskId, taskDescription, taskDir, skillDirectory, 'executing', null, null);

            // ── 6. 异步启动编排，完成后更新 loop.json 终态 + 释放重型引用 ──
            orch.start()
                .catch(err => {
                    console.error(`[FlexRunnerController] 单次执行异常: taskId=${taskId}, ${err.message}`);
                })
                .finally(() => {
                    this._onSingleExecutionComplete(taskId, orch).catch(err => {
                        console.warn(`[FlexRunnerController] 单次执行收尾失败: taskId=${taskId}, ${err.message}`);
                    });
                });

            res.json({
                status: 'ok',
                message: `单次执行已启动: taskId=${taskId}`,
                taskId,
                stepId: 1,
                progress: orch.getProgress()
            });

        } catch (err) {
            res.error(400, err.message);
        }
    }

    /**
     * 创建模拟 Response 对象（供调用 OrchestratorController 的 load/start）。
     * @private
     */
    _createMockResponse() {
        const mock = {
            _status: 200,
            _data: null,
            statusCode: 200,
            headersSent: false,
            writableEnded: false,
            json(data) {
                this._data = data;
                this.writableEnded = true;
            },
            error(code, message) {
                this._status = code;
                this._data = { status: 'error', error: message };
                this.writableEnded = true;
            }
        };
        return mock;
    }

    /**
     * 写精简版 loop.json（单次执行任务专用）。
     *
     * 格式与 LoopEngine._persistLoopState 兼容，附加 isSingleExecution 标记。
     *
     * @param {string} taskId
     * @param {string} taskDescription
     * @param {string} taskDir
     * @param {string} skillDirectory
     * @param {string} status - executing | completed | failed | aborted
     * @param {string|null} startTime
     * @param {string|null} endTime
     * @private
     */
    async _writeSingleLoopJson(taskId, taskDescription, taskDir, skillDirectory, status, startTime, endTime) {
        if (!this._storage) return;
        try {
            // 映射 loop 状态到 orchestrator 状态（用于前端 rounds 渲染）
            var orchStatus;
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
                startTime: startTime || nowCST(),
                endTime,
                error: null,
                aborted: status === 'aborted',
                isSingleExecution: true,
                rounds: [{
                    loop: 0,
                    startTime: startTime || nowCST(),
                    endTime,
                    passed: status === 'passed',
                    error: null,
                    planningIsReplan: false,
                    planningStepCount: 1,
                    orchestratorStatus: orchStatus
                }],
                persistedAt: nowCST()
            };
            await this._storage.json('task').write(`${taskId}/loop`, state);
        } catch (err) {
            console.warn(`[FlexRunnerController] 写 loop.json 失败: taskId=${taskId}, ${err.message}`);
        }
    }

    /**
     * 单次执行编排完成后的收尾处理。
     *
     * 1. 更新 loop.json 的终态状态
     * 2. 释放 Orchestrator 重型引用（FlexRunner/CLI/LLM 等）
     *
     * @param {string} taskId
     * @param {object} orch - Orchestrator 实例
     * @private
     */
    async _onSingleExecutionComplete(taskId, orch) {
        const status = orch.status;

        // 映射编排终态到 loop.json 状态
        let loopStatus;
        if (status === OrchestratorStatus.COMPLETED) {
            loopStatus = 'passed';
        } else if (status === OrchestratorStatus.ABORTED) {
            loopStatus = 'aborted';
        } else {
            loopStatus = 'failed';
        }

        const startTime = orch.startTime;
        const endTime = orch.endTime;

        // 读取 taskDescription（从编排器获取）
        const progress = orch.getProgress();
        const step = progress.steps && progress.steps[0];
        const taskDescription = step ? step.taskDescription : '';
        const taskDir = orch._taskDir || '';
        const skillDirectory = orch._skillDirectory || '';

        // 更新 loop.json
        await this._writeSingleLoopJson(
            taskId, taskDescription, taskDir, skillDirectory,
            loopStatus, startTime, endTime
        );

        // 释放重型引用
        if (this._orchestratorController) {
            try {
                this._orchestratorController.disposeOrchestrator(taskId, { removeInstance: true });
            } catch (err) {
                console.warn(`[FlexRunnerController] 释放 Orchestrator 失败: taskId=${taskId}, ${err.message}`);
            }
        }
    }

    /**
     * DELETE /api/flexrunner/runner?taskId=xxx&stepId=yyy
     * 移除一个已注册的 FlexRunner 实例
     */
    async removeRunner(req, res) {
        const taskId = req.query.taskId;
        const stepId = Number(req.query.stepId);
        const key = this._key(taskId, stepId);
        const existed = this._runners.delete(key);
        res.json({
            status: 'ok',
            removed: existed,
            message: existed ? '实例已移除' : '实例不存在',
        });
    }
}

export default FlexRunnerController;
