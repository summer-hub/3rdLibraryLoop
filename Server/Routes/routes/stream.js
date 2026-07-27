import { Router } from '../router/Router.js';
import StreamController from '../controllers/StreamController.js';

/**
 * SSE 实时推送路由
 *
 * 挂载点：/stream/*
 *
 * 路由列表：
 *  GET /stream/tasks/:taskId - 订阅指定任务的实时事件流（SSE）
 *  GET /stream/stats         - SSE Hub 全局统计（REST）
 *
 * 前端订阅示例：
 *   const es = new EventSource('/stream/tasks/task-xxx');
 *   es.addEventListener('step:status', (e) => console.log(JSON.parse(e.data)));
 *
 * @param {object} dependencies - 共享依赖
 * @returns {Router}
 */
export function createStreamRouter(dependencies) {
    const { sseHub } = dependencies;
    const controller = new StreamController(sseHub);

    const router = new Router();
    router.get('/tasks/:taskId', controller.subscribeTask.bind(controller));
    router.get('/stats',         controller.stats.bind(controller));
    return router;
}

export default createStreamRouter;
