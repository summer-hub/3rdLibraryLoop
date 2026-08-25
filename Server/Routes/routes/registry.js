/**
 * 任务注册表通用路由
 *
 * 挂载点：/api/registry/*
 *
 * 提供统一的"历史任务列表"分页查询接口。
 * 后端所有模块（LoopEngine、Orchestrator、FlexRunner 等）在创建任务时，
 * 通过 TaskRegistryStore 注册摘要；前端通过此路由统一查询。
 *
 * 路由列表：
 *  GET /api/registry/tasks  — 分页查询所有任务
 *  GET /api/registry/tasks/:taskId — 查询单个任务摘要
 *
 * 响应格式：
 *   GET /api/registry/tasks?page=1&pageSize=20&status=running&taskType=loop
 *   → { status: 'ok', tasks: [...], total, page, pageSize, totalPages }
 */

import { Router } from '../router/Router.js';

/**
 * @param {object} dependencies - 共享依赖
 * @param {object} [dependencies.storage] - 存储门面
 * @returns {Router}
 */
export function createRegistryRouter(dependencies) {
    const { storage } = dependencies;

    const router = new Router();

    /**
     * GET /api/registry/tasks
     * 分页查询所有任务摘要。
     *
     * Query 参数：
     *   page     - 页码，从 1 开始（默认 1）
     *   pageSize - 每页条数（默认 20，最大 100）
     *   status   - 可选，按状态过滤（running / completed / failed / ...）
     *   taskType - 可选，按任务类型过滤（loop / orchestrator / ...）
     */
    router.get('/tasks', async (req, res) => {
        try {
            if (!storage) {
                return res.error(500, 'storage 未初始化');
            }

            const registry = storage.taskRegistryStore();
            const query = req.query || {};
            const page = Math.max(1, parseInt(query.page, 10) || 1);
            const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));

            const result = await registry.listPage({
                page,
                pageSize,
                status: query.status || null,
                taskType: query.taskType || null
            });

            res.json({
                status: 'ok',
                ...result
            });
        } catch (err) {
            res.error(500, `查询任务列表失败: ${err.message}`);
        }
    });

    /**
     * GET /api/registry/tasks/:taskId
     * 查询单个任务摘要。
     */
    router.get('/tasks/:taskId', async (req, res) => {
        try {
            if (!storage) {
                return res.error(500, 'storage 未初始化');
            }

            const registry = storage.taskRegistryStore();
            const { taskId } = req.params;
            const entry = await registry.get(taskId);

            if (!entry) {
                return res.json({ status: 'ok', task: null });
            }

            res.json({
                status: 'ok',
                task: entry
            });
        } catch (err) {
            res.error(500, `查询任务详情失败: ${err.message}`);
        }
    });

    return router;
}

export default createRegistryRouter;