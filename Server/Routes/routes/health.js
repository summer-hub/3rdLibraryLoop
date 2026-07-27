import { Router } from '../router/Router.js';
import HealthController from '../controllers/HealthController.js';

/**
 * 健康检查路由注册
 *
 * 挂载点：/api/health/*
 *
 * 路由列表：
 *  GET /api/health         — 大模型 CLI 健康检查
 *  GET /api/health/ping    — 后端轻量探活
 *  GET /api/health/check   — 健康检查（语义化别名）
 *
 * @param {object} dependencies - 共享依赖
 * @returns {Router}
 */
export function createHealthRouter(dependencies) {
    const { cli } = dependencies;
    const controller = new HealthController(cli);

    const router = new Router();
    router.get('',        controller.check.bind(controller));
    router.get('/ping',   controller.ping.bind(controller));
    router.get('/check',  controller.check.bind(controller));
    return router;
}

export default createHealthRouter;
