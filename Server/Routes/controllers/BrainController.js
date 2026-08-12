/**
 * BrainController —— Brain 任务拆解 HTTP 接口控制器
 *
 * 职责：封装 Brain 的 HTTP 接口，供前端提交自然语言任务并查看拆解结果。
 * 不感知 HTTP 层细节，只接收 RequestContext / ResponseContext。
 *
 * 管理多个 Brain 实例（按 planId 区分），支持：
 *   - 提交自然语言任务，获取拆解后的任务 JSON
 *   - 拆解并直接提交 Orchestrator 执行
 *   - 查询拆解历史
 *   - 查看拆解详情
 */

import { Brain, BrainStatus } from '../../Brain/index.js';

/**
 * BrainController
 */
class BrainController {
    /**
     * @param {object} [deps] - 共享依赖
     * @param {object} [deps.sseHub]               - SseHub 实例
     * @param {object} [deps.storage]              - 存储门面
     * @param {object} [deps.orchestratorController] - OrchestratorController（用于 planAndExecute）
     * @param {string} [deps.skillDirectory]       - SKILL 目录路径
     */
    constructor(deps = {}) {
        this.sseHub = deps.sseHub || null;
        this.storage = deps.storage || null;
        this.orchestratorController = deps.orchestratorController || null;
        this.skillDirectory = deps.skillDirectory || null;

        // Brain 实例（单例，复用 LLM 连接）
        this._brain = null;
    }

    /**
     * 懒初始化 Brain 实例
     * @returns {Brain}
     */
    _getBrain() {
        if (!this._brain) {
            this._brain = new Brain({
                sseHub: this.sseHub,
                storage: this.storage,
                skillDirectory: this.skillDirectory
            });
        }
        return this._brain;
    }

    // ─── HTTP Handlers ─────────────────────────────────────────────────

    /**
     * POST /api/brain/plan
     * 提交自然语言任务，返回拆解后的任务 JSON
     *
     * Body: {
     *   taskDescription: string,      // 必填
     *   taskId?: string,              // 可选，指定 taskId
     *   taskDir?: string,             // 可选，指定工作目录
     *   skillDirectory?: string,      // 可选，覆盖 SKILL 目录
     *   planId?: string,              // 可选，指定 planId
     *   acceptanceCriteria?: string   // 可选，验收标准（自然语言）
     * }
     */
    async plan(req, res) {
        const body = req.body || {};
        const { taskDescription } = body;

        if (!taskDescription) {
            return res.error(400, 'taskDescription 为必填项');
        }

        try {
            const brain = this._getBrain();
            const plan = await brain.planTask(taskDescription, {
                taskId: body.taskId,
                taskDir: body.taskDir,
                skillDirectory: body.skillDirectory,
                planId: body.planId,
                acceptanceCriteria: body.acceptanceCriteria
            });

            res.json({
                status: 'ok',
                message: `任务已拆解: planId=${plan.planId}, 步骤数=${plan.taskDef.steps.length}`,
                plan
            });
        } catch (err) {
            res.error(500, `任务拆解失败: ${err.message}`);
        }
    }

    /**
     * POST /api/brain/plan-and-execute
     * 拆解任务并直接提交 Orchestrator 执行
     *
     * Body: {
     *   taskDescription: string,      // 必填
     *   taskId?: string,
     *   taskDir?: string,
     *   skillDirectory?: string,
     *   acceptanceCriteria?: string   // 可选，验收标准（自然语言）
     * }
     */
    async planAndExecute(req, res) {
        const body = req.body || {};
        const { taskDescription } = body;

        if (!taskDescription) {
            return res.error(400, 'taskDescription 为必填项');
        }

        if (!this.orchestratorController) {
            return res.error(503, 'OrchestratorController 未注入，无法执行');
        }

        try {
            const brain = this._getBrain();
            const result = await brain.planAndExecute(
                taskDescription,
                this.orchestratorController,
                {
                    taskId: body.taskId,
                    taskDir: body.taskDir,
                    skillDirectory: body.skillDirectory,
                    acceptanceCriteria: body.acceptanceCriteria
                }
            );

            res.json({
                status: 'ok',
                message: `任务已拆解并提交执行: taskId=${result.plan.taskDef.taskId}`,
                plan: result.plan,
                loadResult: result.loadResult
            });
        } catch (err) {
            res.error(500, `拆解并执行失败: ${err.message}`);
        }
    }

    /**
     * GET /api/brain/plans
     * 列出所有拆解计划
     */
    async plans(req, res) {
        try {
            const brain = this._getBrain();
            const plans = await brain.listPlans();
            res.json({
                status: 'ok',
                count: plans.length,
                plans: plans.map(p => ({
                    planId: p.planId,
                    taskId: p.taskId,
                    taskDescription: p.taskDescription,
                    status: p.status,
                    createdAt: p.createdAt,
                    stepCount: p.taskDef?.steps?.length || 0,
                    valid: p.validation?.valid || false
                }))
            });
        } catch (err) {
            res.error(500, err.message);
        }
    }

    /**
     * GET /api/brain/plan?planId=xxx 或 GET /api/brain/plan?taskId=xxx
     * 获取指定拆解计划的详情
     *
     * 支持两种查询方式：
     *   - planId: 按计划 ID 查找（遍历 db/task/ 子目录）
     *   - taskId: 按任务 ID 查找（直接读取 db/task/{taskId}/brain.json，更快）
     *   - taskId + loop: 按任务 ID + 轮次查找（读取 brain_loop{N}.json）
     */
    async planDetail(req, res) {
        const { planId, taskId } = req.query;
        const loopParam = req.query.loop;

        if (!planId && !taskId) {
            return res.error(400, 'planId 或 taskId 为必填项');
        }

        try {
            const brain = this._getBrain();

            // 指定轮次：按 taskId + loopCount 加载
            if (taskId && loopParam != null && loopParam !== '') {
                const loopNum = Number(loopParam);
                const plan = await brain.loadPlan('', { taskId, loopCount: loopNum });
                if (plan) {
                    return res.json({ status: 'ok', plan });
                }
                return res.error(404, `未找到第 ${loopNum} 轮 Brain 计划: taskId=${taskId}`);
            }

            // 优先按 taskId 快速加载最新计划
            if (taskId) {
                const plans = await brain.listPlans();
                const plan = plans.find(p => p.taskId === taskId);
                if (plan) {
                    return res.json({ status: 'ok', plan });
                }
            }

            // 回退到按 planId 加载
            const plan = await brain.loadPlan(planId || '', taskId ? { taskId } : {});

            if (!plan) {
                return res.error(404, `未找到计划: ${planId ? 'planId=' + planId : 'taskId=' + taskId}`);
            }

            res.json({
                status: 'ok',
                plan
            });
        } catch (err) {
            res.error(500, err.message);
        }
    }

    /**
     * GET /api/brain/status
     * 获取 Brain 当前状态
     */
    async status(req, res) {
        const brain = this._getBrain();
        res.json({
            status: 'ok',
            brain: {
                status: brain.status,
                skillDirectory: brain.skillDirectory,
                plansCount: brain.getPlans().length
            }
        });
    }
}

export default BrainController;
