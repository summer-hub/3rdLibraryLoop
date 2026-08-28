/**
 * TestCheck —— 任务准出校验引擎
 *
 * 职责：
 *   - 在 Orchestrator 所有步骤执行完成后，对最终产物进行验收审核
 *   - 通过 Agent 选择合适的 SKILL，执行准出检查
 *   - 对比 Brain 生成的任务级验收标准，判断是否满足准出条件
 *   - 产出结构化的审核结论（通过/未通过 + 逐条标准评估 + 改进建议）
 *   - 支持审核结果持久化，供 LoopEngine 决定是否触发大循环
 *
 * 架构角色（Loop Engineering 大循环）：
 *   Brain（拆解/重规划）→ Orchestrator（编排）→ FlexRunner（执行）→ TestCheck（准出审核）
 *                                                                           │
 *                                                          未通过 ──→ 回到 Brain 重新生成目标
 *
 * 设计原则：
 *   - 高内聚：所有准出审核逻辑集中于此，不感知 HTTP 层和编排细节
 *   - 低耦合：依赖注入 LLMClient / SkillSelector / CLIController / Storage
 *   - 可扩展：审核策略通过 Skill 调用实现，新增审核能力只需新增 Skill
 *   - 复用 FlexRunner 的执行模式（matchSkill → invokeSkill → checkResult）
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

import { LLMClient } from '../Agent/SkillSelector/llm/llmClient.js';
import { nowCST } from '../library/cstTime.js';
import { createStorage } from '../DbUse/index.js';

// 惰性加载 FlexRunner 的依赖（CLIController / SkillSelectorAgent），
// 与 FlexRunner 同样的惰性加载策略，避免测试时拉入重依赖。
let _CLIController = null;
let _SkillSelectorAgent = null;

async function _loadCLIController() {
    if (!_CLIController) {
        const mod = await import('../CLI/cli.js');
        _CLIController = mod.CLIController;
    }
    return _CLIController;
}

async function _loadSkillSelectorAgent() {
    if (!_SkillSelectorAgent) {
        const mod = await import('../Agent/SkillSelector/index.js');
        _SkillSelectorAgent = mod.Agent;
    }
    return _SkillSelectorAgent;
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** TestCheck 审核状态 */
export const CheckStatus = Object.freeze({
    IDLE: 'idle',
    MATCHING: 'matching',       // 正在匹配审核 Skill
    EXECUTING: 'executing',     // 正在执行审核
    EVALUATING: 'evaluating',   // 正在评估准出条件
    PASSED: 'passed',           // 准出通过
    FAILED: 'failed',           // 准出未通过
    ERROR: 'error'              // 审核过程出错
});

/** SSE 事件类型 */
const SSE_EVENT = Object.freeze({
    CHECK_START: 'testcheck:start',
    CHECK_MATCH: 'testcheck:match',
    CHECK_EXECUTE: 'testcheck:execute',
    CHECK_EVALUATE: 'testcheck:evaluate',
    CHECK_RESULT: 'testcheck:result',
    CHECK_ERROR: 'testcheck:error'
});

/** 轮询间隔（ms），等待审核 Skill 执行完成 */
const POLL_INTERVAL_MS = 3000;

/** 轮询超时（ms），审核最多等待 30 分钟 */
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

// ─── TestCheck 类 ────────────────────────────────────────────────────────────

/**
 * TestCheck —— 准出审核引擎
 */
class TestCheck {
    /**
     * @param {object} [deps] - 依赖注入
     * @param {LLMClient} [deps.llm]            - LLM 客户端（复用 SkillSelector 的 LLMClient）
     * @param {object}   [deps.storage]         - 存储门面（createStorage() 返回值）
     * @param {object}   [deps.sseHub]          - SseHub 实例（可选，用于推送审核进度）
     * @param {object}   [deps.cli]             - CLIController 实例（可选，用于执行 Skill）
     * @param {object}   [deps.skillSelector]   - SkillSelectorAgent 实例（可选，用于匹配 Skill）
     * @param {string}   [deps.skillDirectory]  - SKILL 目录路径（默认 Server/Skills）
     */
    constructor(deps = {}) {
        this.llm = deps.llm || new LLMClient();
        this.storage = deps.storage || createStorage();
        this.sseHub = deps.sseHub || null;
        this.cli = deps.cli || null;
        this.skillSelector = deps.skillSelector || null;

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        this.skillDirectory = deps.skillDirectory ||
            path.resolve(__dirname, '..', 'Skills');

        /** @type {CheckStatus} */
        this._status = CheckStatus.IDLE;
    }

    // ─── 属性访问 ──────────────────────────────────────────────────────

    /** @returns {CheckStatus} */
    get status() {
        return this._status;
    }

    // ─── SSE 推送辅助 ──────────────────────────────────────────────────

    /**
     * 推送审核进度事件。
     * @param {string} channel   - SSE 频道（通常为 taskId）
     * @param {string} eventType - 事件类型
     * @param {object} data      - 事件数据
     * @private
     */
    _emit(channel, eventType, data) {
        if (this.sseHub) {
            this.sseHub.emit(channel, eventType, data);
        }
    }

    // ─── 惰性加载依赖 ──────────────────────────────────────────────────

    /**
     * 获取 CLIController 实例（懒加载）。
     * @returns {Promise<object>}
     * @private
     */
    async _getCli() {
        if (!this.cli) {
            const CLIController = await _loadCLIController();
            this.cli = new CLIController('opencode', {});
        }
        return this.cli;
    }

    /**
     * 获取 SkillSelectorAgent 实例（懒加载）。
     * @returns {Promise<object>}
     * @private
     */
    async _getSkillSelector() {
        if (!this.skillSelector) {
            const SkillSelectorAgent = await _loadSkillSelectorAgent();
            this.skillSelector = new SkillSelectorAgent();
        }
        return this.skillSelector;
    }

    // ─── 核心方法 ──────────────────────────────────────────────────────

    /**
     * 执行准出审核 — 对任务最终产物进行验收检查。
     *
     * 流程：
     *   1. MATCHING    — 基于"准出审核"语义匹配最佳审核 Skill
     *   2. EXECUTING   — 通过 CLI 执行审核 Skill，生成审核报告文件
     *   3. EVALUATING  — LLM 评估审核报告，逐条判断验收标准是否满足
     *   4. 产出 CheckResult（通过/未通过 + 逐条评估 + 改进建议）
     *
     * @param {object} params - 审核参数
     * @param {string} params.taskId            - 任务 ID（必填）
     * @param {string} params.taskDir           - 工作目录
     * @param {string} [params.taskDescription] - 原始任务描述
     * @param {Array}  [params.acceptanceCriteria] - 任务级验收标准（Brain 生成）
     * @param {object} [params.orchestratorResult] - Orchestrator 执行结果摘要
     * @param {number} [params.loopCount=0]    - 当前大循环次数
     * @param {string} [params.skillDirectory] - 覆盖 SKILL 目录
     * @param {() => boolean} [params.isAborted] - 终止信号回调（返回 true 时审核轮询抛终止退出）
     * @param {(sessionId: string) => void} [params.onSessionCreated] - Session 创建回调（供上层登记远程中止）
     * @returns {Promise<CheckResult>}
     */
    async runCheck(params = {}) {
        const {
            taskId,
            taskDir,
            taskDescription = '',
            acceptanceCriteria = [],
            orchestratorResult = null,
            loopCount = 0,
            isAborted = null,
            onSessionCreated = null
        } = params;

        // 终止信号：审核过程中各环节检查，置位时抛终止退出
        const abortSignal = {
            isAborted: typeof isAborted === 'function' ? isAborted : null,
            onSessionCreated: typeof onSessionCreated === 'function' ? onSessionCreated : null
        };

        if (!taskId) {
            throw new Error('TestCheck.runCheck: taskId 为必填项');
        }

        const skillDir = params.skillDirectory || this.skillDirectory;
        const workDir = taskDir || path.resolve(this.storage.manager.rootDir, 'task', taskId);

        const channel = taskId;
        const checkId = _generateCheckId(taskId, loopCount);
        const startTime = nowCST();

        this._status = CheckStatus.MATCHING;
        this._emit(channel, SSE_EVENT.CHECK_START, {
            checkId, taskId, loopCount, startTime,
            acceptanceCriteriaCount: acceptanceCriteria.length
        });

        /** @type {CheckResult} */
        const result = {
            checkId,
            taskId,
            loopCount,
            taskDescription,
            acceptanceCriteria,
            orchestratorResult,
            startTime,
            endTime: null,
            status: CheckStatus.IDLE,
            passed: false,
            matchedSkillDir: '',
            checkReportPath: '',
            sessionId: '',
            criteriaResults: [],
            summary: '',
            improvementSuggestions: [],
            error: null
        };

        try {
            // ─── 步骤 1：匹配审核 Skill ───
            const checkTaskDescription = this._buildCheckTaskDescription(
                taskDescription, acceptanceCriteria, orchestratorResult
            );

            this._status = CheckStatus.MATCHING;
            const matchedSkillDir = await this._matchSkill(checkTaskDescription, skillDir);
            result.matchedSkillDir = matchedSkillDir;
            this._emit(channel, SSE_EVENT.CHECK_MATCH, { checkId, matchedSkillDir });

            // ─── 步骤 2：执行审核 Skill ───
            this._status = CheckStatus.EXECUTING;
            const reportPath = path.join(workDir, `testcheck_loop${loopCount}_result.md`);
            const summaryPath = path.join(workDir, `testcheck_loop${loopCount}_Summary.md`);

            const { sessionId, executed } = await this._invokeSkill({
                taskDescription: checkTaskDescription,
                skillDir: matchedSkillDir,
                reportPath,
                summaryPath,
                workDir,
                loopCount,
                abortSignal
            });

            result.sessionId = sessionId;
            result.checkReportPath = reportPath;
            this._emit(channel, SSE_EVENT.CHECK_EXECUTE, { checkId, sessionId, reportPath, executed });

            if (!executed) {
                throw new Error('审核 Skill 执行失败，未生成审核报告');
            }

            // ─── 步骤 3：评估准出条件 ───
            this._status = CheckStatus.EVALUATING;
            const evaluation = await this._evaluateAcceptance({
                reportPath,
                acceptanceCriteria,
                taskDescription,
                orchestratorResult,
                loopCount
            });

            result.criteriaResults = evaluation.criteriaResults;
            result.passed = evaluation.passed;
            result.summary = evaluation.summary;
            result.improvementSuggestions = evaluation.improvementSuggestions;
            result.status = evaluation.passed ? CheckStatus.PASSED : CheckStatus.FAILED;

            this._emit(channel, SSE_EVENT.CHECK_EVALUATE, {
                checkId,
                passed: result.passed,
                criteriaResults: result.criteriaResults
            });

        } catch (err) {
            result.status = CheckStatus.ERROR;
            result.error = err.message;
            this._status = CheckStatus.ERROR;
            this._emit(channel, SSE_EVENT.CHECK_ERROR, { checkId, error: err.message });
            this._log('error', `审核异常: ${err.message}`);
        }

        result.endTime = nowCST();
        this._status = result.status;

        // ─── 持久化审核结果 ───
        await this._persistCheckResult(taskId, result);

        this._emit(channel, SSE_EVENT.CHECK_RESULT, {
            checkId,
            passed: result.passed,
            status: result.status,
            summary: result.summary
        });

        this._log('info', `── 准出审核结束: passed=${result.passed}, loop=${loopCount} ──`);
        return result;
    }

    // ─── 内部：Skill 匹配 ──────────────────────────────────────────────

    /**
     * 匹配审核 Skill — 基于准出审核语义选择最佳 Skill。
     *
     * @param {string} checkTaskDescription - 审核任务描述
     * @param {string} skillDirectory       - SKILL 目录
     * @returns {Promise<string>} 匹配到的 SKILL 目录绝对路径
     * @private
     */
    async _matchSkill(checkTaskDescription, skillDirectory) {
        if (!checkTaskDescription) {
            throw new Error('TestCheck._matchSkill: 审核任务描述不能为空');
        }
        if (!skillDirectory) {
            throw new Error('TestCheck._matchSkill: skillDirectory 不能为空');
        }

        this._log('info', `matchSkill 开始 — 审核任务: "${checkTaskDescription.slice(0, 80)}…"`);

        const selector = await this._getSkillSelector();
        const selection = await selector.selectSkill(checkTaskDescription, skillDirectory);

        if (!selection || !selection.best) {
            throw new Error('TestCheck._matchSkill: 未匹配到任何合适的审核 Skill');
        }

        const bestDir = selection.skillPath || selection.best.skillPath;
        if (!bestDir) {
            throw new Error('TestCheck._matchSkill: 匹配结果缺少 Skill 目录路径');
        }

        this._log('info', `matchSkill 完成 — 最佳审核 Skill: ${selection.best.name} (${bestDir})`);
        return bestDir;
    }

    /**
     * 构建准出审核的任务描述 — 供 Skill 匹配器使用。
     *
     * @param {string} taskDescription    - 原始任务描述
     * @param {Array}  acceptanceCriteria - 验收标准
     * @param {object} orchestratorResult - 编排结果
     * @returns {string}
     * @private
     */
    _buildCheckTaskDescription(taskDescription, acceptanceCriteria, orchestratorResult) {
        const parts = [
            '对任务执行结果进行准出审核（验收测试）',
            `原始任务: ${taskDescription}`
        ];

        if (acceptanceCriteria && acceptanceCriteria.length > 0) {
            const criteriaText = acceptanceCriteria
                .map(c => `- [${c.id}] (${c.type}) ${c.criterion}`)
                .join('\n');
            parts.push(`验收标准:\n${criteriaText}`);
        }

        if (orchestratorResult) {
            parts.push(`编排状态: ${orchestratorResult.status || 'unknown'}`);
            if (orchestratorResult.stats) {
                parts.push(`步骤统计: ${JSON.stringify(orchestratorResult.stats)}`);
            }
        }

        parts.push('检查任务产物是否满足所有验收标准，生成准出审核报告');
        return parts.join('\n');
    }

    // ─── 内部：Skill 执行 ──────────────────────────────────────────────

    /**
     * 调用 CLI 执行审核 Skill。
     *
     * 流程：
     *   1. 健康检查
     *   2. 构建 prompt（任务描述 + 验收标准 + 产物路径 + 报告路径）
     *   3. 创建 Session 并发送 prompt
     *   4. 轮询等待完成
     *
     * @param {object} opts
     * @param {string} opts.taskDescription
     * @param {string} opts.skillDir
     * @param {string} opts.reportPath
     * @param {string} opts.summaryPath
     * @param {string} opts.workDir
     * @param {number} opts.loopCount
     * @param {object} [opts.abortSignal] - 终止信号 { isAborted, onSessionCreated }（LoopEngine 注入）
     * @returns {Promise<{sessionId: string, executed: boolean}>}
     * @private
     */
    async _invokeSkill({ taskDescription, skillDir, reportPath, summaryPath, workDir, loopCount, abortSignal }) {
        const cli = await this._getCli();

        this._log('info', `invokeSkill 开始 — skillDir: ${skillDir}`);

        // 健康检查
        const health = await cli.checkHealth();
        if (health.status !== 'ok') {
            this._log('error', `opencode 服务不可用: ${health.message}`);
            return { sessionId: '', executed: false };
        }

        // 构建 prompt
        const title = `testcheck|task=${workDir.split('/').pop()}|loop=${loopCount}`;
        const prompt = this._buildPrompt(taskDescription, skillDir, reportPath, summaryPath, workDir);

        // 创建 Session（指定工作目录为 workDir，确保 opencode session 的文件操作在任务目录下执行）
        // const { sessionId } = await cli.startSession(title, prompt, { cwd: workDir });
        const { sessionId } = await cli.startSession(title, prompt);
        this._log('info', `审核 Session 已创建: ${sessionId}`);

        // 通知上层登记 sessionId（abortLoop 可据此远程中止）
        if (abortSignal && typeof abortSignal.onSessionCreated === 'function') {
            try {
                abortSignal.onSessionCreated(sessionId);
            } catch { /* 回调异常不影响主流程 */ }
        }

        // Session 创建后终止标志已置位 → 立即中止并退出
        if (abortSignal && typeof abortSignal.isAborted === 'function' && abortSignal.isAborted()) {
            try {
                await cli.abortSession(sessionId);
            } catch { /* 已自然结束 */ }
            throw new Error('审核被终止（Session 创建后即中止）');
        }

        // 轮询等待完成
        const completed = await this._pollSession(cli, sessionId, abortSignal);
        if (!completed) {
            this._log('warn', `审核 Session ${sessionId} 未在超时时间内完成`);
        }

        this._log('info', `invokeSkill 完成 — sessionId: ${sessionId}, completed: ${completed}`);
        return { sessionId, executed: completed };
    }

    /**
     * 构建审核 prompt。
     *
     * @param {string} taskDescription
     * @param {string} skillDir
     * @param {string} reportPath
     * @param {string} summaryPath
     * @param {string} workDir
     * @returns {string}
     * @private
     */
    _buildPrompt(taskDescription, skillDir, reportPath, summaryPath, workDir) {
        const parts = [
            `## 审核任务描述\n${taskDescription}`,
            `## SKILL 目录\n${skillDir}`,
            `## 工作目录\n${workDir}`,
            `## 审核报告输出路径\n${reportPath}`,
            `## 审核摘要输出路径\n${summaryPath}`,
            '请按照 SKILL 中的指令执行准出审核任务。',
            '审核完成后，请将审核结果写入上述"审核报告输出路径"，并在"审核摘要输出路径"写入摘要。',
            '审核报告需包含 `## 准出结论` 字段（值为 `通过` 或 `未通过`），用于判断审核结果。',
            '审核报告需逐条列出每个验收标准的评估结论（满足/未满足）及证据。'
        ];
        return parts.join('\n\n');
    }

    /**
     * 轮询 Session 状态直到完成或超时。
     *
     * @param {object} cli       - CLIController 实例
     * @param {string} sessionId - 会话 ID
     * @param {object} [abortSignal] - 终止信号 { isAborted: () => boolean }；
     *                                  置位时在下一轮询周期远程中止 session 并抛终止退出
     * @returns {Promise<boolean>}
     * @private
     */
    async _pollSession(cli, sessionId, abortSignal = null) {
        const deadline = Date.now() + POLL_TIMEOUT_MS;

        while (Date.now() < deadline) {
            // 终止检查：比超时检查优先，确保终止请求即时生效
            if (abortSignal && typeof abortSignal.isAborted === 'function' && abortSignal.isAborted()) {
                try {
                    await cli.abortSession(sessionId);
                } catch { /* 已自然结束 */ }
                this._log('warn', `审核 Session ${sessionId} 被终止`);
                throw new Error('审核被终止');
            }

            await this._sleep(POLL_INTERVAL_MS);
            try {
                const { status } = await cli.checkSessionStatus(sessionId);
                if (status === 'completed') {
                    return true;
                }
            } catch (err) {
                this._log('warn', `轮询审核 Session 状态失败: ${err.message}`);
            }
        }
        return false;
    }

    // ─── 内部：准出评估 ────────────────────────────────────────────────

    /**
     * 评估准出条件 — LLM 审核报告对照验收标准逐条判断。
     *
     * 读取审核报告文件，调用 LLM 对照任务级验收标准进行结构化评估：
     *   - 逐条判断每个验收标准是否满足
     *   - 汇总结论（全部满足=通过，任一未满足=未通过）
     *   - 生成改进建议（未通过时）
     *
     * @param {object} opts
     * @param {string} opts.reportPath         - 审核报告文件路径
     * @param {Array}  opts.acceptanceCriteria - 任务级验收标准
     * @param {string} opts.taskDescription    - 原始任务描述
     * @param {object} opts.orchestratorResult - 编排结果
     * @param {number} opts.loopCount          - 当前循环次数
     * @returns {Promise<{passed: boolean, criteriaResults: Array, summary: string, improvementSuggestions: Array}>}
     * @private
     */
    async _evaluateAcceptance({ reportPath, acceptanceCriteria, taskDescription, loopCount }) {
        // 读取审核报告
        let reportContent = '';
        try {
            reportContent = await fs.readFile(reportPath, 'utf-8');
        } catch (err) {
            this._log('warn', `读取审核报告失败: ${reportPath} — ${err.message}`);
            // 报告不存在时，仍尝试基于验收标准做基本评估
        }

        // 快速检查：报告中是否包含明确的准出结论
        const quickMatch = reportContent.match(/##\s*准出结论\s*\n\s*(通过|未通过)/i);
        if (quickMatch) {
            const quickPassed = quickMatch[1] === '通过';
            this._log('info', `快速判断准出结论: ${quickMatch[1]}`);
            // 仍调用 LLM 做详细评估，但快速结论作为 fallback
            const fallback = {
                passed: quickPassed,
                criteriaResults: acceptanceCriteria.map(c => ({
                    id: c.id,
                    criterion: c.criterion,
                    satisfied: quickPassed,
                    evidence: '基于审核报告准出结论',
                    note: quickPassed ? '满足' : '未满足'
                })),
                summary: quickPassed ? '所有验收标准已满足' : '存在未满足的验收标准',
                improvementSuggestions: quickPassed ? [] : ['请根据审核报告中的问题进行修复']
            };

            // 尝试 LLM 详细评估，失败则用 fallback
            try {
                return await this._llmEvaluate(reportContent, acceptanceCriteria, taskDescription, loopCount);
            } catch (err) {
                this._log('warn', `LLM 评估失败，使用快速判断 fallback: ${err.message}`);
                return fallback;
            }
        }

        // 无快速结论时，直接调用 LLM 评估
        return await this._llmEvaluate(reportContent, acceptanceCriteria, taskDescription, loopCount);
    }

    /**
     * 调用 LLM 进行结构化准出评估。
     *
     * @param {string} reportContent      - 审核报告内容
     * @param {Array}  acceptanceCriteria - 验收标准
     * @param {string} taskDescription    - 任务描述
     * @param {number} loopCount          - 循环次数
     * @returns {Promise<{passed: boolean, criteriaResults: Array, summary: string, improvementSuggestions: Array}>}
     * @private
     */
    async _llmEvaluate(reportContent, acceptanceCriteria, taskDescription, loopCount) {
        const criteriaText = (acceptanceCriteria || [])
            .map(c => `- [${c.id}] (${c.type}) ${c.criterion}\n  验证方式: ${c.verification}`)
            .join('\n');

        const prompt = `你是一个准出审核专家。请根据审核报告内容，逐条评估任务级验收标准是否满足。

## 原始任务描述
${taskDescription || '（未提供）'}

## 任务级验收标准
${criteriaText || '（未提供验收标准，请根据审核报告整体判断）'}

## 审核报告内容
${reportContent || '（审核报告为空，无法判断）'}

## 当前循环次数
第 ${loopCount + 1} 次循环

## 输出要求
请以 JSON 格式返回，包含以下字段：
{
  "passed": true/false,
  "criteriaResults": [
    {
      "id": "ac1",
      "criterion": "验收标准描述",
      "satisfied": true/false,
      "evidence": "审核报告中支持该结论的证据或分析",
      "note": "补充说明"
    }
  ],
  "summary": "整体审核结论摘要（一段话）",
  "improvementSuggestions": [
    "针对未满足标准的改进建议（仅在未通过时提供）"
  ]
}

### 评估规则
1. 如果审核报告为空或无法获取有效信息，passed 应为 false
2. criteriaResults 必须覆盖所有任务级验收标准
3. 每条标准的 satisfied 字段必须基于审核报告中的证据
4. 如果所有标准都 satisfied=true，则 passed=true
5. 如果任一标准 satisfied=false，则 passed=false
6. improvementSuggestions 仅在 passed=false 时提供，针对未满足的标准给出具体改进建议
7. summary 应概括整体审核结论，包括通过/未通过的原因

注意：只返回 JSON，不要包含其他文字。`;

        const result = await this.llm.chatJSON(prompt, { maxTokens: 4096 });

        return {
            passed: Boolean(result.passed),
            criteriaResults: Array.isArray(result.criteriaResults)
                ? result.criteriaResults.map((c, idx) => ({
                    id: c.id || (acceptanceCriteria[idx] ? acceptanceCriteria[idx].id : `ac${idx + 1}`),
                    criterion: c.criterion || (acceptanceCriteria[idx] ? acceptanceCriteria[idx].criterion : ''),
                    satisfied: Boolean(c.satisfied),
                    evidence: c.evidence || '',
                    note: c.note || ''
                }))
                : [],
            summary: result.summary || (result.passed ? '审核通过' : '审核未通过'),
            improvementSuggestions: Array.isArray(result.improvementSuggestions)
                ? result.improvementSuggestions
                : []
        };
    }

    // ─── 内部：持久化 ──────────────────────────────────────────────────

    /**
     * 持久化审核结果到文件系统。
     *
     * 文件路径：db/task/{taskId}/testcheck_loop{loopCount}.json
     *
     * 与 Brain / Orchestrator 的持久化目录结构保持一致：
     *   db/task/{taskId}/
     *     ├── brain.json                    ← Brain 拆解计划（最新快照）
     *     ├── brain_loop0.json               ← 各轮 Brain 计划
     *     ├── orchestration.json             ← Orchestrator 编排状态（最新快照）
     *     ├── orchestration_loop0.json       ← 各轮编排状态
     *     ├── stepid_1_loop0.json            ← 各轮步骤执行记录
     *     ├── testcheck_loop0.json          ← 第 0 次循环准出审核（本方法写入）
     *     ├── testcheck_loop1.json          ← 第 1 次循环准出审核
     *     └── ...
     *
     * @param {string} taskId
     * @param {CheckResult} result
     * @private
     */
    async _persistCheckResult(taskId, result) {
        try {
            const json = this.storage.json('task');
            await json.write(`${taskId}/testcheck_loop${result.loopCount}`, result);
            this._log('info', `审核结果已持久化: db/task/${taskId}/testcheck_loop${result.loopCount}.json`);
        } catch (err) {
            this._log('warn', `持久化审核结果失败: ${err.message}`);
        }
    }

    /**
     * 从文件系统加载历史审核结果。
     *
     * @param {string} taskId
     * @param {number} loopCount
     * @returns {Promise<CheckResult|null>}
     */
    async loadCheckResult(taskId, loopCount) {
        try {
            const json = this.storage.json('task');
            return await json.read(`${taskId}/testcheck_loop${loopCount}`);
        } catch {
            return null;
        }
    }

    /**
     * 列出某个 Task 下所有审核结果。
     *
     * @param {string} taskId
     * @returns {Promise<Array>}
     */
    async listCheckResults(taskId) {
        try {
            const json = this.storage.json('task');
            const entries = await json.list(`${taskId}/testcheck_loop`);
            return entries
                .filter(e => e && e.data)
                .map(e => e.data)
                .sort((a, b) => (a.loopCount || 0) - (b.loopCount || 0));
        } catch {
            return [];
        }
    }

    // ─── 内部工具 ──────────────────────────────────────────────────────

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
     * @param {'info'|'warn'|'error'} level
     * @param {string} message
     * @private
     */
    _log(level, message) {
        const prefix = '[TestCheck]';
        const ts = nowCST();
        switch (level) {
            case 'error':
                console.error(`${ts} ${prefix} ❌ ${message}`);
                break;
            case 'warn':
                console.warn(`${ts} ${prefix} ⚠  ${message}`);
                break;
            default:
                console.info(`${ts} ${prefix} ℹ  ${message}`);
        }
    }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/**
 * 生成 checkId。
 * @param {string} taskId
 * @param {number} loopCount
 * @returns {string}
 */
function _generateCheckId(taskId, loopCount) {
    const ts = Date.now().toString(36);
    return `check_${taskId}_loop${loopCount}_${ts}`;
}

export { TestCheck };
export default TestCheck;
