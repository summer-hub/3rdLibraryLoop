/**
 * KnowledgeImporter —— 知识导入执行引擎
 *
 * 职责：
 *   1. 接收知识条目信息，构建导入 prompt
 *   2. 通过 CLIController 创建 opencode Session 执行 knowledge-import SKILL
 *   3. 轮询等待执行完成
 *   4. 读取结果文件，判断导入成功/失败
 *   5. 维护异步导入任务状态
 *
 * 设计原则：
 *   - 高内聚：所有知识导入的执行逻辑集中在本模块。
 *   - 低耦合：不感知 HTTP 层细节，通过 execute() 方法被控制器调用。
 *   - 与 FlexRunner 模式一致：CLI 惰性加载、prompt 构建、Session 轮询。
 *
 * 依赖：
 *   - CLIController (opencode)     用于创建/轮询 Session
 *   - KnowledgeManager             用于查询知识条目
 *   - McpToolGuide                 用于生成 MCP 工具引导
 *
 * @example
 * import { KnowledgeImporter } from '../Knowledge/index.js';
 *
 * const importer = new KnowledgeImporter({
 *   cli: cliInstance,
 *   storage,
 *   skillDirectory: '/workspace/Server/Skills',
 *   knowledgeManager
 * });
 *
 * const result = await importer.execute({
 *   importId: 'ki_xxx',
 *   knowledgeInfo: { id: 'kn_xxx', docPath: '/path/to/Summary.md', ... },
 *   workDir: '/workspace/task/task-001',
 *   resultFilePath: '/workspace/task/task-001/knowledge_import_ki_xxx.md'
 * });
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { McpToolGuide } from './lib/McpToolGuide.js';
import { nowCST } from '../../../core/cstTime.js';

// KnowledgeManager 惰性加载（避免未使用时加载存储链）
let _KnowledgeManager = null;

async function _loadKnowledgeManager() {
    if (!_KnowledgeManager) {
        const mod = await import('./KnowledgeManager.js');
        _KnowledgeManager = mod.default;
    }
    return _KnowledgeManager;
}

/**
 * 仓库 / 发布树根目录。
 *
 * 迁移前本文件在 Server/Knowledge/，用 here/../.. 得到根；迁入 plugins/engines/knowledge/ 后
 * 深了 3 层，故为 here/../../..。发布态 prepack 把 Server/、plugins/、MCP/ 平级复制进
 * vendor/（见 cli/scripts/prepack.mjs），层数关系不变，开发态与安装态解析到同一处。
 *
 * @returns {string} 根目录绝对路径
 */
function _repoRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 轮询超时时间（30分钟，与 FlexRunner 一致） */
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

/** 轮询间隔 */
const POLL_INTERVAL_MS = 3000;

class KnowledgeImporter {
    /**
     * @param {object} [deps] - 共享依赖
     * @param {object} [deps.cli]               - CLIController 实例
     * @param {object} [deps.storage]           - 存储门面（用于推导工作目录）
     * @param {string} [deps.skillDirectory]    - SKILL 根目录路径
     * @param {object} [deps.knowledgeManager]  - KnowledgeManager 实例
     */
    constructor(deps = {}) {
        this._cli = deps.cli || null;
        this._storage = deps.storage || null;
        this._skillDirectory = deps.skillDirectory || null;
        this._knowledgeManager = deps.knowledgeManager || null;

        /** knowledge-import SKILL 目录路径（延迟计算） */
        this._skillDir = null;

        /** 正在执行的导入任务 Map（key = importId） */
        this._imports = new Map();
    }

    // ─── 懒初始化 ──────────────────────────────────────────────────────

    /**
     * 取 CLI 控制器 —— 必须由调用方注入，插件不自建。
     *
     * 迁移前这里会惰性 import Server/CLI/cli.js 并兜底 new 一个 CLIController；
     * 迁入插件后该路径不再合法（架构守卫 R2 禁止插件引用 Server/），且它不是一条
     * 真实路径：装配点 Server/composition/buildApp.js 一直把共享 CLI 注入
     * KnowledgeImportController，后者再透传给本类。故这里 fail closed 而不是再造
     * 一条隐式依赖——少了 CLI 就该在构造点报错，而不是在插件内部偷偷自建一份。
     *
     * @returns {Promise<object>}
     * @throws {Error} 未注入 deps.cli 时
     */
    async _getCLI() {
        if (!this._cli) {
            throw new Error(
                'KnowledgeImporter：缺少 cli（CLI 控制器）。请经 deps.cli 注入——' +
                    '插件不得引用 Server/CLI 自行构造 CLIController'
            );
        }
        return this._cli;
    }

    /**
     * 懒初始化 KnowledgeManager。
     * @returns {Promise<object>}
     */
    async _getKnowledgeManager() {
        if (!this._knowledgeManager) {
            const KM = await _loadKnowledgeManager();
            this._knowledgeManager = new KM();
            await this._knowledgeManager.init();
        }
        return this._knowledgeManager;
    }

    /**
     * 获取 knowledge-import SKILL 目录路径。
     * @returns {string}
     */
    getSkillDir() {
        if (this._skillDir) return this._skillDir;

        if (!this._skillDirectory) {
            // plugins/engines/knowledge/ → 仓库根（迁移前从 Server/Knowledge/ 上溯 2 层，
            // 迁入插件后是 3 层；发布态 vendor/{Server,plugins,MCP} 同构平级，仍解析到同一处）
            this._skillDirectory = path.resolve(_repoRoot(), 'Server', 'Skills');
        }
        this._skillDir = path.resolve(this._skillDirectory, 'knowledge-import');
        return this._skillDir;
    }

    // ─── 公开 API ─────────────────────────────────────────────────────

    /**
     * 解析知识条目信息。
     *
     * 支持两种模式：
     *   1. 通过 knowledgeId 从 KnowledgeManager 查询
     *   2. 直接传入知识信息（docPath 等）
     *
     * @param {object} params
     * @param {string} [params.knowledgeId]       - 知识条目ID
     * @param {string} [params.docPath]           - 经验文档路径（直接传入模式）
     * @param {string} [params.skillDir]          - 关联SKILL目录
     * @param {string} [params.taskDescription]   - 任务描述
     * @param {string} [params.taskId]            - 来源任务ID
     * @returns {Promise<object|null>} 知识条目信息对象，不存在时返回 null
     */
    async resolveKnowledgeInfo({ knowledgeId, docPath, skillDir, taskDescription, taskId } = {}) {
        if (knowledgeId) {
            const km = await this._getKnowledgeManager();
            const record = await km.getExperience(knowledgeId);
            return record || null;
        }

        if (docPath) {
            return {
                id: knowledgeId || `manual_${Date.now().toString(36)}`,
                docPath,
                skillDir: skillDir || null,
                taskDescription: taskDescription || '',
                taskId: taskId || '',
            };
        }

        return null;
    }

    /**
     * 验证经验文档是否存在。
     * @param {string} docPath
     * @returns {Promise<boolean>}
     */
    async validateDocPath(docPath) {
        try {
            await fs.access(docPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 推导工作目录。
     *
     * 优先使用 taskId 对应的任务目录，fallback 到 /tmp/knowledge-import。
     *
     * @param {string} [taskId]
     * @param {string} [explicitWorkDir] - 显式指定的工作目录（优先级最高）
     * @returns {string}
     */
    deriveWorkDir(taskId, explicitWorkDir) {
        if (explicitWorkDir) return explicitWorkDir;

        if (taskId) {
            const rootDir = this._storage?.manager?.rootDir;
            if (rootDir) {
                return path.resolve(rootDir, 'task', taskId);
            }
        }

        return path.resolve('/tmp', 'knowledge-import');
    }

    /**
     * 执行知识导入（同步，等待完成）。
     *
     * 核心流程：
     *   1. 构建 prompt（含知识信息 + SKILL 目录 + 工作目录 + MCP工具引导）
     *   2. 通过 CLI 创建 opencode Session
     *   3. 轮询等待执行完成
     *   4. 读取结果文件，判断成功/失败
     *
     * @param {object} params
     * @param {string} params.importId       - 导入任务ID
     * @param {object} params.knowledgeInfo  - 知识条目信息
     * @param {string} params.workDir        - 工作目录
     * @param {string} params.resultFilePath - 结果文件输出路径
     * @returns {Promise<{success: boolean, sessionId: string, resultContent: string, message: string}>}
     */
    async execute({ importId, knowledgeInfo, workDir, resultFilePath, userPrompt }) {
        this._log(importId, 'info', `知识导入开始 — knowledgeId: ${knowledgeInfo.id}`);

        // ── 1. 获取 CLI 并健康检查 ──
        const cli = await this._getCLI();
        const health = await cli.checkHealth();
        if (health.status !== 'ok') {
            throw new Error(`CLI 服务不可用: ${health.message}`);
        }

        // ── 2. 构建 prompt ──
        const skillDir = this.getSkillDir();
        const prompt = this._buildPrompt(knowledgeInfo, skillDir, workDir, resultFilePath, userPrompt);

        // ── 3. 创建 Session ──
        const title = `knowledge-import|${importId}|${knowledgeInfo.id}`;
        const { sessionId } = await cli.startSession(title, prompt);

        // 更新异步任务状态
        const entry = this._imports.get(importId);
        if (entry) entry.sessionId = sessionId;

        this._log(importId, 'info', `Session 已创建: ${sessionId}`);

        // ── 4. 轮询等待完成 ──
        const completed = await this._pollSession(cli, sessionId, importId);
        if (!completed) {
            this._log(importId, 'warn', `Session ${sessionId} 未在超时时间内完成`);
            return {
                success: false,
                sessionId,
                resultContent: '',
                message: '执行超时，未在规定时间内完成',
            };
        }

        // ── 5. 读取结果文件 ──
        let resultContent = '';
        try {
            resultContent = await fs.readFile(resultFilePath, 'utf-8');
            if (resultContent.charCodeAt(0) === 0xFEFF) resultContent = resultContent.slice(1);
        } catch {
            this._log(importId, 'warn', `结果文件不存在: ${resultFilePath}`);
        }

        const success = this._checkResult(resultContent);
        this._log(importId, 'info', `知识导入完成 — success: ${success}`);

        return {
            success,
            sessionId,
            resultContent,
            message: success ? '知识导入成功' : '知识导入可能未完全成功，请查看结果文件',
        };
    }

    /**
     * 异步执行知识导入（立即返回，通过 getImportStatus 查询进度）。
     *
     * @param {object} params - 同 execute()
     * @returns {string} importId
     */
    executeAsync({ importId, knowledgeInfo, workDir, resultFilePath, userPrompt }) {
        const importEntry = {
            importId,
            knowledgeInfo,
            workDir,
            resultFilePath,
            userPrompt: userPrompt || null,
            status: 'running',
            startTime: nowCST(),
            sessionId: null,
            result: null,
            error: null,
        };
        this._imports.set(importId, importEntry);

        // 异步触发，不 await
        this.execute({ importId, knowledgeInfo, workDir, resultFilePath, userPrompt })
            .then(async result => {
                const entry = this._imports.get(importId);
                if (entry) {
                    entry.status = result.success ? 'completed' : 'failed';
                    entry.result = result;
                    entry.endTime = nowCST();
                    // 进入终态后释放大对象引用（knowledgeInfo / result），
                    // 防止 _imports Map 随导入次数累积重型数据导致内存泄露。
                    // 保留轻量状态字段（importId/status/sessionId/时间戳），供前端 import-status 查询。
                    entry.knowledgeInfo = null;
                    entry.workDir = null;
                    entry.resultFilePath = null;
                    entry.result = result.success ? { success: true, message: result.message, sessionId: result.sessionId } : null;
                }

                // ── 导入成功后自动删除原知识条目（硬删除：物理删除 JSON 文件并从索引移除） ──
                if (result.success && knowledgeInfo.id) {
                    try {
                        const km = await this._getKnowledgeManager();
                        const removed = await km.removeExperience(knowledgeInfo.id);
                        if (removed) {
                            result.message += '；原知识条目已自动删除';
                            this._log(importId, 'info', `导入成功，原知识条目 ${knowledgeInfo.id} 已自动删除`);
                        }
                    } catch (delErr) {
                        this._log(importId, 'warn', `自动删除原知识条目失败: ${delErr.message}`);
                        result.message += `；自动删除原知识条目失败: ${delErr.message}`;
                    }
                }
            })
            .catch(err => {
                const entry = this._imports.get(importId);
                if (entry) {
                    entry.status = 'error';
                    entry.error = err.message;
                    entry.endTime = nowCST();
                    // 释放大对象引用，仅保留轻量状态
                    entry.knowledgeInfo = null;
                    entry.workDir = null;
                    entry.resultFilePath = null;
                    entry.result = null;
                }
            });

        return importId;
    }

    /**
     * 查询异步导入任务状态。
     * @param {string} importId
     * @returns {object|null}
     */
    getImportStatus(importId) {
        const entry = this._imports.get(importId);
        if (!entry) return null;

        return {
            importId: entry.importId,
            status: entry.status,
            startTime: entry.startTime,
            endTime: entry.endTime || null,
            sessionId: entry.sessionId,
            result: entry.result,
            error: entry.error,
            knowledgeId: entry.knowledgeInfo?.id,
            docPath: entry.knowledgeInfo?.docPath,
        };
    }

    // ─── 内部方法 ──────────────────────────────────────────────────────

    /**
     * 构建发送给 opencode 的 prompt。
     *
     * @param {object} knowledgeInfo  - 知识条目信息
     * @param {string} skillDir       - knowledge-import SKILL 目录路径
     * @param {string} workDir        - 工作目录
     * @param {string} resultFilePath - 结果文件输出路径
     * @param {string} [userPrompt]   - 用户额外输入的提示文字（可选）
     * @returns {string}
     * @private
     */
    _buildPrompt(knowledgeInfo, skillDir, workDir, resultFilePath, userPrompt) {
        const parts = [];

        // ── 任务描述 ──
        parts.push(
            `## 任务描述\n将以下知识经验导入到知识库系统和SKILL体系中，实现系统的自我迭代。\n\n` +
            `知识条目ID: ${knowledgeInfo.id}\n` +
            `经验文档路径: ${knowledgeInfo.docPath}\n` +
            (knowledgeInfo.skillDir ? `关联SKILL目录: ${knowledgeInfo.skillDir}\n` : '关联SKILL目录: 无（需要从经验内容推断）\n') +
            (knowledgeInfo.taskDescription ? `来源任务描述: ${knowledgeInfo.taskDescription}\n` : '')
        );

        // ── 工作目录 ──
        parts.push(`## 工作目录\n${workDir}\n\n所有文件操作请在此目录下执行。`);

        // ── SKILL 目录 ──
        parts.push(`## SKILL 目录\n${skillDir}`);

        // ── 结果文件输出路径 ──
        parts.push(`## 结果文件输出路径\n${resultFilePath}`);

        // ── 用户额外输入的提示 ──
        if (userPrompt && userPrompt.trim()) {
            parts.push(`## 用户附加指令\n${userPrompt.trim()}`);
        }

        // ── 执行指令 ──
        parts.push(
            '请按照 SKILL 中的指令执行知识导入任务。',
            '执行步骤：',
            '1. 读取经验文档（路径见上方"经验文档路径"）',
            '2. 分析经验内容，分类为知识类和SKILL类',
            '3. 知识类内容：调用 MCP 工具 kb_add_document 导入知识库',
            '4. SKILL类内容：定位关联SKILL，优化修改对应的 SKILL.md 文件',
            '5. 将导入结果写入上述"结果文件输出路径"',
            '',
            '结果文件需包含 `## 执行状态` 字段（值为 `成功` 或 `失败`），用于判断执行结果。',
            '结果文件需包含 `## 导入摘要` 段落，记录知识库导入和SKILL优化的摘要信息。'
        );

        // ── MCP 工具引导 ──
        try {
            const mcpConfigPath = path.resolve(_repoRoot(), 'MCP', 'config.json');
            const guide = new McpToolGuide(mcpConfigPath);
            const toolGuide = guide.buildToolGuide();
            if (toolGuide) {
                parts.push(toolGuide);
            }
        } catch {
            // MCP 工具引导生成失败不影响主流程
        }

        return parts.join('\n\n');
    }

    /**
     * 轮询 opencode Session 状态，直到完成或超时。
     *
     * @param {object} cli       - CLIController 实例
     * @param {string} sessionId - Session ID
     * @param {string} importId  - 导入任务ID（用于日志）
     * @returns {Promise<boolean>}
     * @private
     */
    async _pollSession(cli, sessionId, importId) {
        const deadline = Date.now() + POLL_TIMEOUT_MS;

        while (Date.now() < deadline) {
            await this._sleep(POLL_INTERVAL_MS);

            try {
                const { status } = await cli.checkSessionStatus(sessionId);
                if (status === 'completed') {
                    return true;
                }
            } catch (err) {
                this._log(importId, 'warn', `轮询 Session 状态失败: ${err.message}`);
            }
        }

        return false;
    }

    /**
     * 检查结果文件中的执行状态。
     *
     * @param {string} content - 结果文件内容
     * @returns {boolean}
     * @private
     */
    _checkResult(content) {
        if (!content) return false;
        const match = content.match(/##\s*执行状态\s*\n*\s*(成功|失败)/);
        return match ? match[1] === '成功' : false;
    }

    /**
     * Promise 版 sleep。
     * @param {number} ms
     * @returns {Promise<void>}
     * @private
     */
    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 统一日志输出。
     * @param {string} importId
     * @param {'info'|'warn'|'error'|'debug'} level
     * @param {string} message
     * @private
     */
    _log(importId, level, message) {
        const prefix = `[KnowledgeImporter:${importId}]`;
        const ts = nowCST();
        switch (level) {
            case 'error':
                console.error(`${ts} ${prefix} ❌ ${message}`);
                break;
            case 'warn':
                console.warn(`${ts} ${prefix} ⚠  ${message}`);
                break;
            case 'debug':
                console.debug(`${ts} ${prefix} 🔍 ${message}`);
                break;
            default:
                console.info(`${ts} ${prefix} ℹ  ${message}`);
        }
    }
}

export { KnowledgeImporter };
export default KnowledgeImporter;
