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
    constructor() {
        /** @type {Map<string, FlexRunner>} key = `${taskId}::${stepId}` */
        this._runners = new Map();
        /** @type {Map<string, {logs:string[], status:string}>} key = taskId */
        this._taskLogs = new Map();
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
     */
    _getRunner(taskId, stepId) {
        const key = this._key(taskId, stepId);
        const runner = this._runners.get(key);
        if (!runner) {
            throw new Error(`未找到任务实例: taskId=${taskId}, stepId=${stepId}，请先初始化`);
        }
        return runner;
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
     *   taskId, stepId, dependId, nextStepId, taskDescription,
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
     */
    async status(req, res) {
        const taskId = req.query.taskId;
        const stepId = Number(req.query.stepId);

        let runner;
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            return res.error(404, err.message);
        }

        res.json({
            status: 'ok',
            runner: this._runnerToJSON(runner),
        });
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
            return res.error(404, err.message);
        }

        const messages = await runner.getLiveMessages();

        res.json({
            status: 'ok',
            sessionId: runner.sessionId,
            count: messages.length,
            messages,
        });
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
            return res.error(404, err.message);
        }

        const jsonStr = await runner.getSessionContent();
        const data = JSON.parse(jsonStr);

        res.json({
            status: 'ok',
            sessionId: runner.sessionId,
            ...data,
        });
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
        try {
            runner = this._getRunner(taskId, stepId);
        } catch (err) {
            return res.error(404, err.message);
        }

        const filePath = resultFilePath || runner.resultPath;
        if (!filePath) {
            return res.error(400, 'resultFilePath 为空且实例无记录的 resultPath');
        }

        const success = await runner.checkResult(filePath);

        // 尝试读取文件内容
        let content = null;
        try {
            content = await fs.readFile(filePath, 'utf-8');
        } catch { /* 文件可能不存在 */ }

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
        for (const [key, runner] of this._runners) {
            if (runner.taskId === taskId) {
                stepList.push(this._runnerToJSON(runner));
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
