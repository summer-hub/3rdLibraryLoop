/**
 * SkillExecutor —— opencode CLI SKILL 执行引擎
 *
 * 职责：
 *   - 惰性加载 CLIController（避免测试时加载重依赖）
 *   - 通过 opencode CLI 创建 Session、发送 prompt、轮询完成
 *   - 读取 SKILL 结果文件，解析 JSON
 *
 * 设计原则：
 *   - 无状态工具类，不持有 Brain 的业务状态
 *   - 所有方法接收参数而非访问实例属性（除 _cli 缓存外）
 *   - 可独立单元测试
 */

import path from 'node:path';
import fs from 'node:fs';

// CLIController 为惰性加载：测试中通过 deps 注入 mock 时不需要加载重依赖（@opencode-ai/sdk 等）。
let _CLIController = null;

async function _loadCLIController() {
    if (!_CLIController) {
        const mod = await import('../CLI/cli.js');
        _CLIController = mod.CLIController;
    }
    return _CLIController;
}

/** 轮询间隔（ms） */
const POLL_INTERVAL_MS = 3000;
/** 轮询超时（ms），单次 SKILL 执行最多等待 10 分钟 */
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export { POLL_INTERVAL_MS, POLL_TIMEOUT_MS };

export class SkillExecutor {
    /**
     * @param {object} [deps]
     * @param {object} [deps.cli] - CLIController 实例（可选，不传则惰性加载）
     */
    constructor(deps = {}) {
        this._cli = deps.cli || null;
    }

    /**
     * 获取 CLIController 实例（惰性加载）。
     *
     * @returns {Promise<object>} CLIController 实例
     */
    async getCLI() {
        if (!this._cli) {
            const CLIController = await _loadCLIController();
            this._cli = new CLIController('opencode');
        }
        return this._cli;
    }

    /**
     * 通过 opencode CLI 执行 SKILL。
     *
     * 流程：
     *   1. 健康检查
     *   2. 构建 prompt（含任务描述、SKILL 目录、输出路径、上下文信息）
     *   3. 创建 Session（指定 cwd = workDir）并发送 prompt
     *   4. 轮询等待 Session 完成
     *   5. 读取结果文件，解析 JSON
     *
     * @param {string} skillDir        - SKILL 目录绝对路径
     * @param {string} workDir         - 工作目录（Session 的 cwd）
     * @param {string} resultFilePath  - 结果文件输出路径
     * @param {string} title           - Session 标题
     * @param {Array<string>} contextSections - prompt 中的上下文段落列表
     * @returns {Promise<{success: boolean, json: object|null, raw: string}>}
     */
    async invokeSkill(skillDir, workDir, resultFilePath, title, contextSections) {
        const cli = await this.getCLI();

        // ── 1. 健康检查 ──
        const health = await cli.checkHealth();
        if (health.status !== 'ok') {
            throw new Error(`opencode 服务不可用: ${health.message || 'health check failed'}`);
        }

        // ── 1b. 确保工作目录存在 ──
        // opencode 在 promptAsync 时会 realPath 检查 session 的 directory，
        // 如果目录不存在会静默失败（返回 204 但不处理，tokens=0+0）。
        // 必须在创建 session 之前创建工作目录。
        if (workDir) {
            fs.mkdirSync(workDir, { recursive: true });
        }
        // 确保结果文件的父目录也存在
        if (resultFilePath) {
            const resultDir = path.dirname(resultFilePath);
            fs.mkdirSync(resultDir, { recursive: true });
        }

        // ── 2. 构建 prompt ──
        const prompt = this.buildSkillPrompt(skillDir, workDir, resultFilePath, contextSections);

        // ── 3. 创建 Session 并发送 prompt ──
        const { sessionId } = await cli.startSession(title, prompt, { cwd: workDir });

        // ── 4. 轮询等待完成 ──
        const completed = await this.pollSession(cli, sessionId);
        if (!completed) {
            throw new Error(`SKILL 执行超时（Session ${sessionId} 未在 ${POLL_TIMEOUT_MS / 1000}s 内完成）`);
        }

        // ── 5. 读取结果文件 ──
        return await this.readSkillResult(resultFilePath);
    }

    /**
     * 构建 SKILL 执行 prompt。
     *
     * @param {string} skillDir        - SKILL 目录路径
     * @param {string} workDir         - 工作目录
     * @param {string} resultFilePath  - 结果文件输出路径
     * @param {Array<string>} contextSections - 上下文段落
     * @returns {string}
     */
    buildSkillPrompt(skillDir, workDir, resultFilePath, contextSections) {
        const parts = [];

        // SKILL 目录（告诉 opencode 读取并遵循该 SKILL 的指令）
        parts.push(`## SKILL 目录\n${skillDir}`);
        parts.push('请读取上述 SKILL 目录中的 SKILL.md 文件，并严格按照其中的指令执行任务。');

        // 工作目录
        if (workDir) {
            parts.push(`## 工作目录\n${workDir}\n\n所有文件操作请在此目录下执行。`);
        }

        // 结果文件输出路径
        parts.push(`## 结果文件输出路径\n${resultFilePath}`);
        parts.push('执行完成后，请将结果写入上述路径。结果文件为纯 JSON 格式，不要追加任何额外内容。');

        // 上下文段落
        for (const section of contextSections) {
            if (section) parts.push(section);
        }

        parts.push('请按照 SKILL 中的指令执行，确保输出结果格式正确、字段完整。');

        return parts.join('\n\n');
    }

    /**
     * 轮询 opencode Session 状态，直到完成或超时。
     *
     * @param {object} cli       - CLIController 实例
     * @param {string} sessionId - Session ID
     * @returns {Promise<boolean>} 是否完成
     */
    async pollSession(cli, sessionId) {
        const deadline = Date.now() + POLL_TIMEOUT_MS;

        while (Date.now() < deadline) {
            await this.sleep(POLL_INTERVAL_MS);

            try {
                const { status } = await cli.checkSessionStatus(sessionId);
                if (status === 'completed') return true;
                if (status === 'error') return false;
            } catch (err) {
                console.warn(`[SkillExecutor] 轮询 Session 状态失败: ${err.message}`);
            }
        }
        return false;
    }

    /**
     * 读取 SKILL 执行结果文件，解析 JSON。
     *
     * 结果文件格式：纯 JSON（不含 markdown 代码块标记或执行状态字段）。
     *
     * @param {string} resultFilePath - 结果文件路径
     * @returns {Promise<{success: boolean, json: object|null, raw: string}>}
     */
    async readSkillResult(resultFilePath) {
        const raw = await fs.readFileSync(resultFilePath, 'utf-8');

        // 提取 JSON 部分（首个 { 到末个 }）
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        let json = null;

        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            const jsonStr = raw.substring(jsonStart, jsonEnd + 1);
            json = JSON.parse(jsonStr);
        }

        // JSON 解析成功即视为执行成功
        const success = json !== null;

        return { success, json, raw };
    }

    /**
     * Promise 版 sleep。
     * @param {number} ms
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export default SkillExecutor;
