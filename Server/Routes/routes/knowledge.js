import { Router } from '../router/Router.js';
import KnowledgeImportController from '../controllers/KnowledgeImportController.js';

/**
 * Knowledge 路由注册
 *
 * 挂载点：/api/knowledge/*
 *
 * 路由列表：
 *  POST   /import            — 同步导入知识经验（等待完成）
 *  POST   /import-async      — 异步导入知识经验（立即返回，通过 /import-status 查询）
 *  GET    /import-status      — 查询异步导入任务状态
 *  GET    /list               — 列出所有知识经验
 *  GET    /experience         — 获取单条知识经验详情
 *  GET    /doc                — 读取经验文档（.md）原文内容
 *
 * @param {object} dependencies - 共享依赖
 * @param {object} [dependencies.cli]               - CLIController 实例
 * @param {object} [dependencies.storage]           - 存储门面
 * @param {string} [dependencies.skillDirectory]    - SKILL 根目录路径
 * @param {object} [dependencies.knowledgeManager]  - KnowledgeManager 实例
 * @param {object} [dependencies.sseHub]            - SseHub 实例
 * @returns {Router}
 */
export function createKnowledgeRouter(dependencies) {
    const controller =
        dependencies.knowledgeImportController ||
        new KnowledgeImportController({
            cli: dependencies.cli,
            storage: dependencies.storage,
            skillDirectory: dependencies.skillDirectory,
            knowledgeManager: dependencies.knowledgeManager,
            sseHub: dependencies.sseHub,
        });

    const router = new Router();

    // ── 知识导入 ──
    router.post('/import',         controller.importKnowledge.bind(controller));
    router.post('/import-async',   controller.importKnowledgeAsync.bind(controller));
    router.get('/import-status',   controller.importStatus.bind(controller));

    // ── 知识查询 ──
    router.get('/list',            controller.listExperiences.bind(controller));
    router.get('/experience',      controller.getExperience.bind(controller));
    router.get('/doc',             controller.getDocContent.bind(controller));

    return router;
}

export default createKnowledgeRouter;
