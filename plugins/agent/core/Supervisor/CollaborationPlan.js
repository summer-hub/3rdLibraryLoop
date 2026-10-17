/**
 * CollaborationPlan —— 步骤内的角色子图定义（Phase 2）
 *
 * 一个 `StepNode` 在 Phase 1 里对应「一个会话」。Phase 2 把它展开成一张
 * **角色子图**：哪些角色参与、按什么顺序、谁是评审门、驳回后回到哪一步、
 * 最多几次重做。
 *
 * 为什么把"子图"做成**声明式数据**而不是硬编码在 Supervisor 里：
 *   1. 不同任务需要的协作强度差别很大——一次「仓库克隆」不需要规划和评审，
 *      一次「鸿蒙化可行性分析」则需要规划 + 检索 + 实现 + 评审 + 验证；
 *   2. 声明式计划可以被**测试直接断言**（"驳回后回到 code 阶段且最多 2 次"），
 *      而写在控制流里只能靠跑一遍才知道；
 *   3. Phase 3/4 要把子图分发到多进程/多服务（见 ROADMAP），届时"子图定义"
 *      将作为调度输入被序列化传递——先把它变成数据，后面才不用重写。
 *
 * ## 阶段（Stage）字段
 *
 * | 字段 | 说明 |
 * |---|---|
 * | `id` | 阶段标识（同一计划内唯一） |
 * | `role` | 执行该阶段的角色 id（须在 `RoleRegistry` 中） |
 * | `consumes` | 需要从黑板读取的键（会渲染进角色 prompt） |
 * | `produces` | 产出后写入黑板的键 |
 * | `reviews` | 本阶段为**评审门**，评审的阶段 id；`approved=false` 时回到该阶段 |
 * | `optional` | true 时该阶段失败/超时不阻断整条链（只记录） |
 * | `required` | true 时该阶段的结论必须为通过，否则整步失败 |
 * | `assign` | 派发任务时附加给该角色的职责描述 |
 *
 * `reviews` 与 `consumes` 的区别：`consumes` 只是"让它看到"，
 * `reviews` 是"它有否决权"。把两者混为一谈会导致任何读取产物的阶段都能驳回，
 * 协作会退化成"谁都能打回"，修订轮次被无意义地消耗掉。
 */

import { RoleKind } from '../Roles/AgentRole.js';

/** 默认最大修订次数（评审驳回后重做原阶段的次数上限） */
export const DEFAULT_MAX_REVISIONS = 2;

/** 默认单步骤内允许的角色会话总数上限（兜底，防跑飞） */
export const DEFAULT_MAX_ROLE_RUNS = 14;

/**
 * 协作计划。
 */
export class CollaborationPlan {
    /**
     * @param {object} def
     * @param {string} def.id
     * @param {string} [def.name]
     * @param {object[]} def.stages
     * @param {number} [def.maxRevisions]
     * @param {number} [def.maxRoleRuns]
     * @param {string} [def.primaryStage]      - 产出"步骤交付物"的阶段（决定返回给 Orchestrator 的 resultPath）
     * @param {boolean} [def.allowSpecifiedSkillRedirect]
     * @param {string} [def.onSpecifiedSkill]  - 'collapse'（默认）| 'keep'
     */
    constructor(def) {
        if (!def?.id) throw new Error('CollaborationPlan: id 为必填项');
        if (!Array.isArray(def.stages) || def.stages.length === 0) {
            throw new Error(`CollaborationPlan(${def.id}): stages 必须是非空数组`);
        }

        const ids = new Set();
        this.stages = def.stages.map((s, i) => {
            if (!s?.id) throw new Error(`CollaborationPlan(${def.id}): 第 ${i + 1} 个阶段缺少 id`);
            if (!s.role) throw new Error(`CollaborationPlan(${def.id}): 阶段 ${s.id} 缺少 role`);
            if (ids.has(s.id)) throw new Error(`CollaborationPlan(${def.id}): 阶段 id 重复 —— ${s.id}`);
            ids.add(s.id);
            return Object.freeze({
                id: s.id,
                role: s.role,
                consumes: Object.freeze([...(s.consumes || [])]),
                produces: s.produces || null,
                reviews: s.reviews || null,
                optional: s.optional === true,
                required: s.required === true,
                assign: s.assign || '',
                // 覆盖角色默认超时（如"验证阶段允许跑更久"）
                timeoutMs: Number.isFinite(s.timeoutMs) && s.timeoutMs > 0 ? s.timeoutMs : null
            });
        });

        // 引用完整性：reviews 必须指向本计划内存在的阶段
        for (const s of this.stages) {
            if (s.reviews && !ids.has(s.reviews)) {
                throw new Error(
                    `CollaborationPlan(${def.id}): 阶段 ${s.id} 的 reviews=${s.reviews} 指向不存在的阶段`
                );
            }
            // 自审是无效协作：评审者与被评审者是同一阶段时，"驳回"会让它无限重做自己
            if (s.reviews === s.id) {
                throw new Error(`CollaborationPlan(${def.id}): 阶段 ${s.id} 不能评审自己`);
            }
        }

        this.id = def.id;
        this.name = def.name || def.id;
        this.maxRevisions = Number.isInteger(def.maxRevisions) && def.maxRevisions >= 0
            ? def.maxRevisions
            : DEFAULT_MAX_REVISIONS;
        this.maxRoleRuns = Number.isInteger(def.maxRoleRuns) && def.maxRoleRuns > 0
            ? def.maxRoleRuns
            : DEFAULT_MAX_ROLE_RUNS;
        this.allowSpecifiedSkillRedirect = def.allowSpecifiedSkillRedirect !== false;
        this.onSpecifiedSkill = def.onSpecifiedSkill === 'keep' ? 'keep' : 'collapse';

        // primaryStage：缺省取"被评审的阶段"（code），否则取第一个非评审阶段，再否则取第一个
        const reviewed = this.stages.find((s) => s.reviews);
        this.primaryStage = def.primaryStage
            || reviewed?.reviews
            || this.stages.find((s) => !s.reviews)?.id
            || this.stages[0].id;

        if (!ids.has(this.primaryStage)) {
            throw new Error(`CollaborationPlan(${def.id}): primaryStage=${this.primaryStage} 不存在`);
        }

        Object.freeze(this);
    }

    /**
     * 本计划涉及的角色 id 列表（去重，保持出现顺序）。
     * @returns {string[]}
     */
    roleIds() {
        const out = [];
        for (const s of this.stages) if (!out.includes(s.role)) out.push(s.role);
        return out;
    }

    /**
     * 按 id 取阶段。
     * @param {string} id
     * @returns {object|undefined}
     */
    stage(id) {
        return this.stages.find((s) => s.id === id);
    }

    /**
     * 取评审门阶段列表。
     * @returns {object[]}
     */
    gates() {
        return this.stages.filter((s) => s.reviews);
    }

    /**
     * 是否为协作计划（多于一个角色时才有协作发生）。
     * @returns {boolean}
     */
    get isCollaborative() {
        return this.roleIds().length > 1;
    }

    /**
     * 把计划收窄为**单个阶段**（当步骤显式指定了 SKILL 时使用，见 `onSpecifiedSkill`）。
     *
     * @param {string} stageId
     * @param {string} [reason]
     * @returns {CollaborationPlan}
     */
    collapseTo(stageId, reason = '') {
        const s = this.stage(stageId);
        if (!s) throw new Error(`CollaborationPlan.collapseTo: 阶段 ${stageId} 不存在`);
        return new CollaborationPlan({
            id: `${this.id}:single(${stageId})`,
            name: `${this.name} → 单阶段${reason ? `（${reason}）` : ''}`,
            stages: [{ ...s, reviews: null, produces: s.produces }],
            maxRevisions: 0,
            maxRoleRuns: Math.max(1, Math.min(this.maxRoleRuns, 2)),
            primaryStage: s.id,
            onSpecifiedSkill: 'keep'
        });
    }

    /**
     * 摘要（日志 / SSE）。
     * @returns {object}
     */
    brief() {
        return {
            id: this.id,
            name: this.name,
            primaryStage: this.primaryStage,
            maxRevisions: this.maxRevisions,
            maxRoleRuns: this.maxRoleRuns,
            stages: this.stages.map((s) => ({
                id: s.id, role: s.role, reviews: s.reviews,
                optional: s.optional, required: s.required
            }))
        };
    }
}

/**
 * 内置协作计划。
 *
 * `thorough`（默认）：检索 → 规划 → 实现 → 评审 → 验证。
 *   为什么检索在规划之前：本项目的核心成本在"找出这个库的已知坑"，
 *   先检索能让规划阶段直接利用既有结论，避免规划出一个已经被踩过的坑。
 *
 * `standard`：实现 → 评审。适合目标明确的步骤（产物已被 SKILL 规定清楚）。
 *
 * `review-only`：实现 → 评审（与 standard 相同但无验证门）。
 *
 * `verify-only`：实现 → 验证。适合"跑测试/覆盖率"这类步骤。
 *
 * `single`：单角色（等价于 Phase 1 行为），用于"该步骤不需要协作"的显式声明。
 */
export const BUILTIN_PLANS = Object.freeze({
    thorough: Object.freeze({
        id: 'thorough',
        name: '检索 → 规划 → 实现 → 评审 → 验证',
        stages: [
            { id: 'retrieve', role: 'retriever', produces: '历史经验', optional: true,
              assign: '检索与本步骤相关的历史经验与已知问题，逐条给出出处。' },
            { id: 'plan', role: 'planner', consumes: ['历史经验'], produces: '计划', optional: true,
              assign: '把步骤目标拆成 2~5 个有序子任务，写明产出与验证方式。' },
            { id: 'code', role: 'coder', consumes: ['计划', '历史经验'], produces: '实现',
              assign: '按计划完成实际工作，所有结论必须落到文件。' },
            { id: 'review', role: 'reviewer', consumes: ['计划', '实现'], produces: '评审结论', reviews: 'code',
              assign: '逐条对照计划检查实现产物的真实性、完整性与正确性，给出 approved 结论。' },
            { id: 'verify', role: 'verifier', consumes: ['实现', '评审结论'], produces: '验证结论',
              optional: true, required: true,
              assign: '用可执行方式独立验证产物（构建/测试/覆盖率/接口比对），给出 verdict 与证据。' }
        ],
        maxRevisions: 2
    }),

    standard: Object.freeze({
        id: 'standard',
        name: '实现 → 评审',
        stages: [
            { id: 'code', role: 'coder', produces: '实现',
              assign: '完成步骤要求的工作，所有结论必须落到文件。' },
            { id: 'review', role: 'reviewer', consumes: ['实现'], produces: '评审结论', reviews: 'code',
              assign: '判定实现产物是否满足验收口径，给出 approved 结论与可行动理由。' }
        ],
        maxRevisions: 2
    }),

    'verify-only': Object.freeze({
        id: 'verify-only',
        name: '实现 → 验证',
        stages: [
            { id: 'code', role: 'coder', produces: '实现', assign: '完成步骤要求的工作。' },
            { id: 'verify', role: 'verifier', consumes: ['实现'], produces: '验证结论',
              required: true, assign: '独立验证产物，给出 verdict 与可复现证据。' }
        ],
        maxRevisions: 1
    }),

    single: Object.freeze({
        id: 'single',
        name: '单角色（Phase 1 等价）',
        stages: [
            { id: 'code', role: 'coder', produces: '实现', assign: '' }
        ],
        maxRevisions: 0,
        maxRoleRuns: 1
    })
});

/**
 * 按名称取内置计划（返回新实例，可安全改造）。
 * @param {string} name
 * @returns {CollaborationPlan}
 */
export function getBuiltinPlan(name) {
    const def = BUILTIN_PLANS[name];
    if (!def) {
        throw new Error(
            `未知协作计划 "${name}"；可用：${Object.keys(BUILTIN_PLANS).join('、')}`
        );
    }
    return new CollaborationPlan({ ...def, stages: def.stages.map((s) => ({ ...s })) });
}

/**
 * 从步骤配置解析协作计划。
 *
 * 支持三种写法（`step.collaboration`）：
 *   - 缺省 / `false`        → 使用 `defaultName`（由环境变量 `MULTI_AGENT_PLAN` 决定）
 *   - 字符串                → 内置计划名
 *   - 对象 `{plan, stages, maxRevisions, ...}` → 内置计划为基线，对象字段覆盖
 *
 * @param {*} collaboration - `step.collaboration`
 * @param {string} [defaultName='standard']
 * @returns {CollaborationPlan}
 */
export function resolvePlan(collaboration, defaultName = 'standard') {
    // 已是计划实例：直接复用（不可变对象，可安全共享）
    if (collaboration instanceof CollaborationPlan) return collaboration;
    if (collaboration === undefined || collaboration === null || collaboration === false) {
        return getBuiltinPlan(defaultName);
    }
    if (typeof collaboration === 'string') {
        return getBuiltinPlan(collaboration);
    }
    if (typeof collaboration !== 'object') {
        throw new Error(`step.collaboration 类型非法：${typeof collaboration}`);
    }

    const baseName = collaboration.plan || defaultName;
    const base = BUILTIN_PLANS[baseName];
    if (!base) {
        throw new Error(`step.collaboration.plan 未知："${baseName}"；可用：${Object.keys(BUILTIN_PLANS).join('、')}`);
    }

    return new CollaborationPlan({
        id: collaboration.id || base.id,
        name: collaboration.name || base.name,
        stages: collaboration.stages
            ? collaboration.stages.map((s) => ({ ...s }))
            : base.stages.map((s) => ({ ...s })),
        maxRevisions: collaboration.maxRevisions ?? base.maxRevisions,
        maxRoleRuns: collaboration.maxRoleRuns ?? base.maxRoleRuns,
        primaryStage: collaboration.primaryStage,
        onSpecifiedSkill: collaboration.onSpecifiedSkill ?? base.onSpecifiedSkill,
        allowSpecifiedSkillRedirect: collaboration.allowSpecifiedSkillRedirect
            ?? base.allowSpecifiedSkillRedirect
    });
}

/** 需要「规划能力」的角色 kind 集合（用于校验计划里是否声明了必需的阶段） */
export const PLANNING_KINDS = Object.freeze([RoleKind.PLANNER]);

export default CollaborationPlan;
