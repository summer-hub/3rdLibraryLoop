/**
 * KnowledgeImportController —— 知识导入 HTTP 接口控制器（薄层）
 *
 * 职责：封装知识导入功能的 HTTP 接口，委托 KnowledgeImporter 执行核心逻辑。
 * 不感知业务实现细节，只负责请求参数解析和响应封装。
 *
 * 路由列表：
 *   POST   /import            — 同步导入知识经验（等待完成）
 *   POST   /import-async      — 异步导入知识经验（立即返回，通过 /import-status 查询）
 *   GET    /import-status      — 查询异步导入任务状态
 *   GET    /list               — 列出所有知识经验
 *   GET    /experience         — 获取单条知识经验详情
 *   GET    /doc                — 读取经验文档（.md）原文内容
 *
 * 不感知 HTTP 层细节，只接收 RequestContext / ResponseContext。
 */

import path from 'node:path';
import fs from 'node:fs/promises';

import { KnowledgeImporter, KnowledgeManager } from '../../Knowledge/index.js';

class KnowledgeImportController {
    /**
     * @param {object} [deps] - 共享依赖
     * @param {object} [deps.cli]               - CLIController 实例
     * @param {object} [deps.storage]           - 存储门面
     * @param {string} [deps.skillDirectory]    - SKILL 根目录路径
     * @param {object} [deps.knowledgeManager]  - KnowledgeManager 实例
     * @param {object} [deps.knowledgeImporter] - KnowledgeImporter 实例（优先于自动创建）
     * @param {object} [deps.sseHub]            - SseHub 实例
     */
    constructor(deps = {}) {
        this._knowledgeManager = deps.knowledgeManager || null;
        this._knowledgeImporter =
            deps.knowledgeImporter ||
            new KnowledgeImporter({
                cli: deps.cli,
                storage: deps.storage,
                skillDirectory: deps.skillDirectory,
                knowledgeManager: deps.knowledgeManager,
            });
    }

    // ─── 懒初始化 ──────────────────────────────────────────────────────

    /**
     * 懒初始化 KnowledgeManager（仅 list/experience 查询接口需要）。
     * @returns {Promise<KnowledgeManager>}
     * @private
     */
    async _getKnowledgeManager() {
        if (!this._knowledgeManager) {
            this._knowledgeManager = new KnowledgeManager();
            await this._knowledgeManager.init();
        }
        return this._knowledgeManager;
    }

    // ─── HTTP Handlers ─────────────────────────────────────────────────

    /**
     * POST /api/knowledge/import
     * 导入一条知识经验到知识库和SKILL体系
     *
     * Body: {
     *   knowledgeId: string,    // 必填，知识条目ID（kn_xxx）
     *   workDir?: string,       // 可选，工作目录（默认基于 taskId 推导）
     *   userPrompt?: string,    // 可选，用户额外输入的提示文字，追加到执行 prompt 中
     * }
     *
     * 或直接传入知识信息（跳过 KnowledgeManager 查询）：
     * Body: {
     *   docPath: string,        // 必填，经验文档路径
     *   skillDir?: string,      // 可选，关联SKILL目录
     *   taskDescription?: string, // 可选，任务描述
     *   taskId?: string,        // 可选，来源任务ID
     *   workDir?: string,       // 可选，工作目录
     *   userPrompt?: string,    // 可选，用户额外输入的提示文字，追加到执行 prompt 中
     * }
     */
    async importKnowledge(req, res) {
        const body = req.body || {};
        const importer = this._knowledgeImporter;

        try {
            // ── 解析知识条目信息 ──
            const knowledgeInfo = await importer.resolveKnowledgeInfo(body);
            if (!knowledgeInfo) {
                return res.error(400, 'knowledgeId 或 docPath 为必填项');
            }

            // ── 验证经验文档存在 ──
            const docExists = await importer.validateDocPath(knowledgeInfo.docPath);
            if (!docExists) {
                return res.error(404, `经验文档不存在: ${knowledgeInfo.docPath}`);
            }

            // ── 确定工作目录 ──
            const workDir = importer.deriveWorkDir(knowledgeInfo.taskId, body.workDir);
            await fs.mkdir(workDir, { recursive: true });

            // ── 确定结果文件路径 ──
            const importId = `ki_${Date.now().toString(36)}`;
            const resultFilePath = path.join(workDir, `knowledge_import_${importId}.md`);

            // ── 执行导入（同步等待） ──
            const result = await importer.execute({
                importId,
                knowledgeInfo,
                workDir,
                resultFilePath,
                userPrompt: body.userPrompt,
            });

            res.json({
                status: 'ok',
                importId,
                message: result.success
                    ? '知识导入完成'
                    : '知识导入执行完成但可能未完全成功，请查看结果文件',
                result,
                resultFilePath,
            });
        } catch (err) {
            res.error(500, `知识导入失败: ${err.message}`);
        }
    }

    /**
     * POST /api/knowledge/import-async
     * 异步导入（不等待完成，立即返回 importId，通过 /import-status 查询进度）
     *
     * Body 同 /import
     */
    async importKnowledgeAsync(req, res) {
        const body = req.body || {};
        const importer = this._knowledgeImporter;

        try {
            // ── 解析知识条目信息 ──
            const knowledgeInfo = await importer.resolveKnowledgeInfo(body);
            if (!knowledgeInfo) {
                return res.error(400, 'knowledgeId 或 docPath 为必填项');
            }

            // ── 验证经验文档存在 ──
            const docExists = await importer.validateDocPath(knowledgeInfo.docPath);
            if (!docExists) {
                return res.error(404, `经验文档不存在: ${knowledgeInfo.docPath}`);
            }

            // ── 确定工作目录 ──
            const workDir = importer.deriveWorkDir(knowledgeInfo.taskId, body.workDir);
            await fs.mkdir(workDir, { recursive: true });

            // ── 确定结果文件路径 ──
            const importId = `ki_${Date.now().toString(36)}`;
            const resultFilePath = path.join(workDir, `knowledge_import_${importId}.md`);

            // ── 异步执行（立即返回） ──
            importer.executeAsync({
                importId,
                knowledgeInfo,
                workDir,
                resultFilePath,
                userPrompt: body.userPrompt,
            });

            res.json({
                status: 'ok',
                importId,
                message: '知识导入已异步启动，通过 GET /api/knowledge/import-status 查询进度',
                resultFilePath,
            });
        } catch (err) {
            res.error(500, `知识导入启动失败: ${err.message}`);
        }
    }

    /**
     * GET /api/knowledge/import-status
     * 查询异步导入任务状态
     *
     * Query: { importId: string }
     */
    async importStatus(req, res) {
        const importId = req.query.importId;
        if (!importId) {
            return res.error(400, 'importId 为必填项');
        }

        const status = this._knowledgeImporter.getImportStatus(importId);
        if (!status) {
            return res.error(404, `导入任务不存在: ${importId}`);
        }

        res.json({ status: 'ok', import: status });
    }

    /**
     * GET /api/knowledge/list
     * 列出所有知识经验
     *
     * Query: { taskId?: string, taskDescription?: string }
     */
    async listExperiences(req, res) {
        try {
            const km = await this._getKnowledgeManager();
            const filter = {};
            if (req.query.taskId) filter.taskId = req.query.taskId;
            if (req.query.taskDescription) filter.taskDescription = req.query.taskDescription;

            const list = await km.listExperiences(filter);
            res.json({ status: 'ok', count: list.length, experiences: list });
        } catch (err) {
            res.error(500, `查询知识列表失败: ${err.message}`);
        }
    }

    /**
     * GET /api/knowledge/experience
     * 获取单条知识经验详情
     *
     * Query: { id: string }
     */
    async getExperience(req, res) {
        const id = req.query.id;
        if (!id) {
            return res.error(400, 'id 为必填项');
        }

        try {
            const km = await this._getKnowledgeManager();
            const record = await km.getExperience(id);
            if (!record) {
                return res.error(404, `知识条目不存在: ${id}`);
            }
            res.json({ status: 'ok', experience: record });
        } catch (err) {
            res.error(500, `查询知识详情失败: ${err.message}`);
        }
    }

    /**
     * GET /api/knowledge/doc
     * 读取经验文档（.md）原文内容。
     *
     * Query: { id: string }
     *
     * 根据知识条目 ID 查找记录，读取 docPath 指向的 .md 文件并返回纯文本内容。
     */
    async getDocContent(req, res) {
        const id = req.query.id;
        if (!id) {
            return res.error(400, 'id 为必填项');
        }

        try {
            const km = await this._getKnowledgeManager();
            const record = await km.getExperience(id);
            if (!record) {
                return res.error(404, `知识条目不存在: ${id}`);
            }

            const docPath = record.docPath;
            if (!docPath) {
                return res.error(404, '该知识条目未关联经验文档路径');
            }

            // 安全校验：仅允许读取 .md 文件
            if (path.extname(docPath).toLowerCase() !== '.md') {
                return res.error(400, `经验文档必须为 .md 文件，当前: ${path.extname(docPath)}`);
            }

            let content;
            try {
                content = await fs.readFile(docPath, 'utf-8');
            } catch (readErr) {
                return res.error(404, `经验文档文件不存在或不可读: ${docPath}`);
            }

            res.json({
                status: 'ok',
                id,
                docPath,
                content,
            });
        } catch (err) {
            res.error(500, `读取经验文档失败: ${err.message}`);
        }
    }
}

export { KnowledgeImportController };
export default KnowledgeImportController;
