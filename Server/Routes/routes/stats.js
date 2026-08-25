import { Router } from '../router/Router.js';
import StatsController from '../controllers/StatsController.js';

/**
 * 统计路由注册
 *
 * 挂载点：/api/stats/*
 *
 * 路由列表：
 *  GET /api/stats/visit          — 页面访问计数（自增）
 *  GET /api/stats/session/count  — Session 调用计数（只读）
 */
export function createStatsRouter(dependencies) {
    const controller = new StatsController();
    const router = new Router();
    router.get('/visit',          controller.visit.bind(controller));
    router.get('/session/count',  controller.sessionCount.bind(controller));
    return router;
}

export default createStatsRouter;
