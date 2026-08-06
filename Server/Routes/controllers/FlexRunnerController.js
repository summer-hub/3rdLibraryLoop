import { FlexRunner, ControlType } from '../../FlexRunner/FlexRunner.js';
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
     * @returns {Promise<{sessionId:string, messages:Array, meta:object|null}|null>}
     */
    async _readSessionArchiveFromStep(taskId, stepId) {
        if (!this._orchestratorController || !this._storage) return null;

        const stepInfo = this._orchestratorController.getStepInfo(taskId, stepId);
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
     * GET /api/flexrunner/live-messages?taskId=xxx&stepId=yyy
     * 获取当前会话的实时对话消息
     */
    async liveMessages(req, res) {
        const taskId = req.query.taskId;
        const stepId = Number(req.query.stepId);

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
     * Body: { taskId, stepId, message }
     */
    async injectPrompt(req, res) {
        const body = req.body || {};
        const taskId = body.taskId;
        const stepId = Number(body.stepId);
        const { message } = body;

        if (!message || typeof message !== 'string') {
            return res.error(400, 'message 为必填项且必须为字符串');
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
     * Body: { taskId, stepId, message }
     */
    async sendAndWaitMessage(req, res) {
        const body = req.body || {};
        const taskId = body.taskId;
        const stepId = Number(body.stepId);
        const { message } = body;

        if (!message || typeof message !== 'string') {
            return res.error(400, 'message 为必填项且必须为字符串');
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
     * GET /api/flexrunner/session?taskId=xxx&stepId=yyy
     * 获取当前会话的完整归档内容
     */
    async session(req, res) {
        const taskId = req.query.taskId;
        const stepId = Number(req.query.stepId);

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
     * GET /api/flexrunner/steps?taskId=xxx
     * 列出任务目录下的步骤记录文件
     */
    async steps(req, res) {
        const { taskId } = req.query;

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

        // 同时扫描任务目录下的 .md 文件
        const taskDir = stepList[0]?.taskDir
            ? path.dirname(stepList[0].taskDir)
            : null;

        let files = [];
        if (taskDir) {
            try {
                const stepDirs = await fs.readdir(taskDir);
                for (const dir of stepDirs) {
                    const dirPath = path.join(taskDir, dir);
                    const stat = await fs.stat(dirPath);
                    if (stat.isDirectory()) {
                        const mdFiles = await fs.readdir(dirPath);
                        for (const f of mdFiles) {
                            if (f.endsWith('.md')) {
                                const fp = path.join(dirPath, f);
                                const fstat = await fs.stat(fp);
                                files.push({
                                    stepId: dir,
                                    filename: f,
                                    path: fp,
                                    size: fstat.size,
                                });
                            }
                        }
                    }
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
