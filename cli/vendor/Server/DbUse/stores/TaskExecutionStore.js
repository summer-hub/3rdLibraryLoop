import { nowCST } from '../../library/cstTime.js';

/**
 * TaskExecutionStore —— 任务步骤执行记录持久化（JSON 文件）
 *
 * 用途：在任务执行过程中，将每个步骤的执行状态、时间、会话 ID 等关键信息
 * 以 JSON 文件形式持久化到 db/task/{taskId}/ 目录下，方便后续追踪和分析。
 *
 * 文件布局：
 *   db/
 *     └── task/
 *         └── {taskId}/
 *             ├── stepid_{stepId}.json    ← 单个步骤的执行记录
 *             └── stepid_{stepId}.json
 *
 * 单个步骤记录字段：
 *   {
 *     taskId, stepId, dependId, nextStepId,
 *     taskDescription, skillDirectory, inputReport,
 *     matchedSkillDir, sessionId,
 *     status, retryTimes, maxRetries,
 *     startTime, endTime, updatedAt,
 *     error
 *   }
 *
 * 依赖 JsonAdapter（subDir='task'），整文件读写，幂等覆盖。
 *
 * 分层关系：与 SessionStore / TaskStepStore 平级，只依赖适配器接口。
 */
class TaskExecutionStore {
    /**
     * @param {object} options
     * @param {import('../adapters/JsonAdapter.js').default} options.json - JSON 适配器（subDir='task'）
     */
    constructor(options = {}) {
        this.json = options.json;
        if (!this.json) {
            throw new Error('TaskExecutionStore 需要 json 适配器');
        }
    }

    // ─── 路径约定 ──────────────────────────────────────────────────────────────

    /**
     * 生成步骤记录的存储 key。
     * JsonAdapter 会在 key 后追加 .json，最终文件为：
     *   - 有 loopCount: {rootDir}/{taskId}/stepid_{stepId}_loop{L}.json
     *   - 无 loopCount: {rootDir}/{taskId}/stepid_{stepId}.json（向后兼容）
     *
     * @param {string} taskId
     * @param {string} stepId
     * @param {number} [loopCount] - 大循环索引（可选）
     * @returns {string} storage key
     * @private
     */
    _key(taskId, stepId, loopCount) {
        const base = `${taskId}/stepid_${stepId}`;
        if (loopCount != null && Number.isFinite(Number(loopCount))) {
            return `${base}_loop${loopCount}`;
        }
        return base;
    }

    // ─── 读写 ──────────────────────────────────────────────────────────────────

    /**
     * 写入（覆盖）步骤执行记录。
     * @param {string} taskId
     * @param {string} stepId
     * @param {object} data - 步骤记录
     * @param {number} [loopCount] - 大循环索引（可选，传入时按轮次独立存储）
     * @returns {Promise<object>} 写入的数据
     */
    async writeStep(taskId, stepId, data, loopCount) {
        return this.json.write(this._key(taskId, stepId, loopCount), {
            ...data,
            taskId,
            stepId,
            updatedAt: nowCST()
        });
    }

    /**
     * 读取步骤执行记录。
     * @param {string} taskId
     * @param {string} stepId
     * @param {number} [loopCount] - 大循环索引（可选）
     * @returns {Promise<object|null>} 步骤记录，不存在时返回 null
     */
    async readStep(taskId, stepId, loopCount) {
        return this.json.read(this._key(taskId, stepId, loopCount));
    }

    /**
     * 增量更新步骤记录（合并已有字段）。
     * 不存在时以 patch 为初始数据创建。
     *
     * @param {string} taskId
     * @param {string} stepId
     * @param {object} patch - 要合并的字段
     * @param {number} [loopCount] - 大循环索引（可选，传入时按轮次独立存储）
     * @returns {Promise<object>} 合并后的完整记录
     */
    async patchStep(taskId, stepId, patch, loopCount) {
        const existing = await this.readStep(taskId, stepId, loopCount) ?? {};
        const next = { ...existing, ...patch };
        return this.writeStep(taskId, stepId, next, loopCount);
    }

    /**
     * 列出某个 Task 下所有步骤记录。
     * 依赖 JsonAdapter.list() 按目录前缀过滤。
     *
     * @param {string} taskId
     * @returns {Promise<object[]>} 步骤记录数组（按 startTime 排序）
     */
    async listSteps(taskId) {
        const pattern = `${taskId}/stepid_`;
        const entries = await this.json.list(pattern).catch(() => []);
        // JsonAdapter.list() 返回 [{ key, data }] 格式
        const results = entries
            .map(e => (e != null && typeof e === 'object' ? (e.data ?? e) : null))
            .filter(Boolean);
        results.sort((a, b) => {
            const ta = a.startTime || '';
            const tb = b.startTime || '';
            return ta.localeCompare(tb);
        });
        return results;
    }
}

export default TaskExecutionStore;
