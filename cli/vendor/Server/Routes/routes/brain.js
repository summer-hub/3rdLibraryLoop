import { Router } from '../router/Router.js';
import BrainController from '../controllers/BrainController.js';

/**
 * Brain 路由注册
 *
 * 挂载点：/api/brain/*
 *
 * 路由列表：
 *  POST   /plan              — 提交自然语言任务，返回拆解后的任务 JSON
 *  POST   /plan-and-execute  — 拆解并直接提交 Orchestrator 执行
 *  GET    /plans             — 列出所有拆解计划
 *  GET    /plan              — 获取指定计划详情
 *  GET    /status            — 获取 Brain 当前状态
 *
 * @param {object} dependencies - 共享依赖
 * @param {object} [dependencies.sseHub]
 * @param {object} [dependencies.storage]
 * @param {object} [dependencies.orchestratorController]
 * @param {BrainController} [dependencies.brainController] - 已有实例
 * @returns {Router}
 */
export function createBrainRouter(dependencies) {
    const controller =
        dependencies.brainController ||
        new BrainController({
            sseHub: dependencies.sseHub,
            storage: dependencies.storage,
            orchestratorController: dependencies.orchestratorController,
            skillDirectory: dependencies.skillDirectory
        });

    const router = new Router();

    // ── 任务拆解 ──
    router.post('/plan',             controller.plan.bind(controller));
    router.post('/plan-and-execute', controller.planAndExecute.bind(controller));

    // ── 查询 ──
    router.get('/plans',             controller.plans.bind(controller));
    router.get('/plan',              controller.planDetail.bind(controller));
    router.get('/status',            controller.status.bind(controller));

    return router;
}

export default createBrainRouter;
