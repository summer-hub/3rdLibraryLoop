import { createHealthRouter } from './health.js';
import { createStreamRouter } from './stream.js';
// 新增模块时在此 import，例如：
// import { createTaskRouter } from './task.js';

/**
 * 路由组装器 — 将各业务域路由组合到主路由器
 *
 * 设计参考：每域一个注册文件（routes/xxx.js），此文件只做组装。
 * 新增业务模块时：
 *   1. 创建 routes/xxx.js，导出 createXxxRouter(dependencies)
 *   2. 在此 import 并追加 router.use()
 *
 * 各域路由文件职责：实例化 Controller、定义路径 → handler 映射。
 * Controller 职责：封装业务逻辑，不感知 HTTP 层。
 *
 * @param {Router} router       - 主路由器
 * @param {object} dependencies - 共享依赖（CLIController / TaskStepStore / SseHub）
 */
export function registerRoutes(router, dependencies) {
    // ─── 健康检查 ──────────────────────────────────────────────────────
    router.use('/api/health', createHealthRouter(dependencies));

    // ─── 任务管理（未来）──────────────────────────────────────────────
    // router.use('/api/tasks', createTaskRouter(dependencies));

    // ─── SSE 实时推送 ──────────────────────────────────────────────────
    router.use('/stream', createStreamRouter(dependencies));
}

export default registerRoutes;
