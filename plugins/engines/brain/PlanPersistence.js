/**
 * PlanPersistence —— 拆解计划持久化与历史加载
 *
 * 职责：
 *   - 持久化 BrainPlan 到文件系统（按轮次独立保存 + 最新快照）
 *   - 按 planId / taskId / taskId+loopCount 加载计划
 *   - 加载某个 Task 下所有轮次的历史计划
 *   - 列出所有历史计划（去重）
 *
 * 设计原则：
 *   - 持有 storage 引用，不持有 Brain 的业务状态
 *   - 无状态工具类，所有操作基于 storage 文件系统
 */

export class PlanPersistence {
    /**
     * @param {object} deps
     * @param {object} deps.storage - 存储门面（createStorage() 返回值）
     */
    constructor({ storage }) {
        this.storage = storage;
    }

    /**
     * 持久化拆解计划到文件系统。
     *
     * 多轮循环持久化策略：
     *   - brain_loop{n}.json — 每轮独立保存，完整保留历史
     *   - brain.json — 最新快照，方便快速加载最新计划
     *
     * 目录结构：
     *   db/task/{taskId}/
     *     ├── brain_loop0.json         ← 第 0 轮初始拆解
     *     ├── brain_loop1.json         ← 第 1 轮重规划
     *     ├── brain.json               ← 最新计划快照（= 最后一轮的 brain_loop{n}）
     *     ├── testcheck_loop0.json     ← 第 0 轮审核结果（TestCheck 写入）
     *     ├── testcheck_loop1.json     ← 第 1 轮审核结果
     *     ├── stepid_1_loop0.json      ← 第 0 轮步骤执行记录（FlexRunner 写入）
     *     ├── stepid_1_loop1.json      ← 第 1 轮步骤执行记录
     *     └── ...
     *
     * @param {BrainPlan} plan
     */
    async persistPlan(plan) {
        try {
            const json = this.storage.json('task');
            const loopCount = plan.loopCount ?? 0;

            // 按轮次独立保存（完整保留历史）
            await json.write(`${plan.taskId}/brain_loop${loopCount}`, plan);

            // 同时写入最新快照（兼容已有 loadPlan / listPlans 逻辑）
            await json.write(`${plan.taskId}/brain`, plan);
        } catch (err) {
            console.warn(`[Brain] 持久化计划失败: ${err.message}`);
        }
    }

    /**
     * 从文件系统加载历史计划。
     *
     * 支持三种加载方式：
     *   - 按 planId 遍历查找（回退路径，兼容旧调用）
     *   - 按 taskId 加载最新计划（options.taskId，读取 brain.json 快照）
     *   - 按 taskId + loopCount 加载指定轮次计划（options.taskId + options.loopCount）
     *
     * @param {string} planId
     * @param {object} [options]
     * @param {string} [options.taskId]     - 直接按 taskId 加载，避免遍历
     * @param {number} [options.loopCount]  - 指定轮次（0=首轮, 1+=重规划轮）
     * @param {Map<string, BrainPlan>} [plansCache] - Brain 内存缓存（可选）
     * @returns {Promise<BrainPlan|null>}
     */
    async loadPlan(planId, options = {}, plansCache = null) {
        // 先从内存查找
        if (plansCache) {
            const cached = plansCache.get(planId);
            if (cached) return cached;
        }

        try {
            const json = this.storage.json('task');

            // 快速路径：直接按 taskId 读取
            if (options.taskId) {
                let plan;
                if (options.loopCount != null) {
                    // 加载指定轮次
                    plan = await json.read(`${options.taskId}/brain_loop${options.loopCount}`);
                } else {
                    // 加载最新快照
                    plan = await json.read(`${options.taskId}/brain`);
                }
                if (plan && plansCache) {
                    plansCache.set(plan.planId, plan);
                }
                return plan;
            }

            // 回退路径：遍历 db/task/ 子目录查找匹配 planId 的计划
            // 同时检查 brain.json（快照）和 brain_loop{n}.json（历史轮次）
            // 必须显式 recursive：不带参数的 list() 只列 db/task/ 这一层的文件（计划都在
            // db/task/{taskId}/ 子目录里），恒返回空。
            const entries = await json.list(undefined, { recursive: true });
            for (const entry of entries) {
                const isBrainFile = entry.key.endsWith('/brain') ||
                    /\/brain_loop\d+$/.test(entry.key);
                if (isBrainFile && entry.data?.planId === planId) {
                    if (plansCache) {
                        plansCache.set(planId, entry.data);
                    }
                    return entry.data;
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * 加载某个 Task 下所有轮次的拆解计划（按轮次排序）。
     *
     * 扫描 db/task/{taskId}/brain_loop{n}.json 文件，返回按 loopCount 升序排列的计划数组。
     *
     * @param {string} taskId
     * @returns {Promise<Array<BrainPlan>>}
     */
    async loadPlanHistory(taskId) {
        try {
            const json = this.storage.json('task');
            const entries = await json.list(undefined, { recursive: true });
            const plans = entries
                .filter(e => {
                    if (!e.key.startsWith(`${taskId}/brain_loop`) || !e.data) return false;
                    return /^brain_loop\d+$/.test(e.key.slice(taskId.length + 1));
                })
                .map(e => {
                    const match = e.key.match(/brain_loop(\d+)$/);
                    return { loop: match ? parseInt(match[1], 10) : 0, plan: e.data };
                })
                .sort((a, b) => a.loop - b.loop);
            return plans.map(p => p.plan);
        } catch {
            return [];
        }
    }

    /**
     * 列出所有历史计划。
     *
     * 遍历 db/task/ 下所有子目录的 brain.json 和 brain_loop{n}.json 文件，
     * 按 planId 去重（brain.json 与 brain_loop{n}.json 内容相同时只保留一份）。
     *
     * @param {Map<string, BrainPlan>} [plansCache] - Brain 内存缓存（可选，合并未落盘的计划）
     * @returns {Promise<Array>}
     */
    async listPlans(plansCache = null) {
        try {
            const json = this.storage.json('task');
            const entries = await json.list(undefined, { recursive: true });
            const rawPlans = entries
                .filter(e => {
                    if (!e.data) return false;
                    return e.key.endsWith('/brain') ||
                        /\/brain_loop\d+$/.test(e.key);
                })
                .map(e => e.data);

            // 按 planId 去重（brain.json 快照与 brain_loop{n}.json 内容相同）
            const seen = new Set();
            const plans = [];
            for (const plan of rawPlans) {
                if (plan.planId && !seen.has(plan.planId)) {
                    seen.add(plan.planId);
                    plans.push(plan);
                }
            }

            // 合并内存中的计划（可能尚未落盘）
            if (plansCache) {
                for (const [id, plan] of plansCache) {
                    if (!seen.has(id)) {
                        seen.add(id);
                        plans.push(plan);
                    }
                }
            }
            return plans.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            );
        } catch {
            return plansCache ? Array.from(plansCache.values()) : [];
        }
    }
}

export default PlanPersistence;
