import { Router } from '../router/Router.js';
import OrchestratorController from '../controllers/OrchestratorController.js';

/**
 * Orchestrator 路由注册
 *
 * 挂载点：/api/orchestrator/*
 *
 * 路由列表：
 *  POST   /load          — 加载任务定义，创建编排器
 *  POST   /start         — 启动编排执行
 *  POST   /pause         — 暂停编排
 *  POST   /resume        — 恢复编排
 *  POST   /abort         — 终止编排
 *  GET    /progress      — 查询编排进度
 *  GET    /step-detail   — 查询步骤执行细节
 *  POST   /update-step   — 修改未执行步骤配置
 *  GET    /tasks         — 列出所有编排任务
 *  DELETE /task          — 移除编排任务
 *
 * @param {object} dependencies - 共享依赖
 * @param {object} [dependencies.sseHub]              - SseHub 实例
 * @param {object} [dependencies.storage]             - 存储门面
 * @param {function} [dependencies.flexRunnerFactory]  - FlexRunner 工厂
 * @param {OrchestratorController} [dependencies.orchestratorController] - 已有实例
 * @returns {Router}
 */
export function createOrchestratorRouter(dependencies) {
    const controller =
        dependencies.orchestratorController ||
        new OrchestratorController({
            sseHub: dependencies.sseHub,
            storage: dependencies.storage,
            flexRunnerFactory: dependencies.flexRunnerFactory
        });

    const router = new Router();

    // ── 任务加载与执行 ──
    router.post('/load',        controller.load.bind(controller));
    router.post('/start',       controller.start.bind(controller));
    router.post('/pause',       controller.pause.bind(controller));
    router.post('/resume',      controller.resume.bind(controller));
    router.post('/abort',       controller.abort.bind(controller));

    // ── 查询 ──
    router.get('/progress',     controller.progress.bind(controller));
    router.get('/step-detail',  controller.stepDetail.bind(controller));
    router.get('/tasks',        controller.tasks.bind(controller));

    // ── 步骤配置修改 ──
    router.post('/update-step', controller.updateStep.bind(controller));

    // ── 任务管理 ──
    router.delete('/task',      controller.removeTask.bind(controller));

    return router;
}

export default createOrchestratorRouter;
