/**
 * LoopEngine 路由注册
 *
 * 挂载点：/api/loopengine/*
 *
 * 路由列表：
 *  POST   /start          — 启动大循环（Brain → Orchestrator → TestCheck 闭环）
 *  GET    /progress       — 查询大循环进度
 *  GET    /list           — 列出所有大循环任务
 *  POST   /abort          — 终止大循环
 *  POST   /restore        — 从持久化恢复大循环状态
 *  GET    /status         — 获取 LoopEngineController 状态
 *  GET    /check-session  — 获取指定轮次 TestCheck 的 session 对话归档
 */

import { Router } from '../router/Router.js';
import LoopEngineController from '../controllers/LoopEngineController.js';

/**
 * @param {object} dependencies - 共享依赖
 * @param {object} [dependencies.sseHub]
 * @param {object} [dependencies.storage]
 * @param {object} [dependencies.brainController]        - BrainController 实例
 * @param {object} [dependencies.orchestratorController] - OrchestratorController 实例
 * @param {object} [dependencies.testCheck]              - TestCheck 实例
 * @param {LoopEngineController} [dependencies.loopEngineController] - 已有实例
 * @param {string} [dependencies.skillDirectory]
 * @returns {Router}
 */
export function createLoopEngineRouter(dependencies) {
    const controller =
        dependencies.loopEngineController ||
        new LoopEngineController({
            sseHub: dependencies.sseHub,
            storage: dependencies.storage,
            brainController: dependencies.brainController,
            orchestratorController: dependencies.orchestratorController,
            testCheck: dependencies.testCheck,
            skillDirectory: dependencies.skillDirectory
        });

    const router = new Router();

    // ── 大循环控制 ──
    router.post('/start',    controller.start.bind(controller));
    router.post('/abort',    controller.abort.bind(controller));
    router.post('/restore',  controller.restore.bind(controller));

    // ── 查询 ──
    router.get('/progress',      controller.progress.bind(controller));
    router.get('/list',          controller.list.bind(controller));
    router.get('/status',        controller.status.bind(controller));
    router.get('/check-session', controller.checkSession.bind(controller));

    return router;
}

export default createLoopEngineRouter;
