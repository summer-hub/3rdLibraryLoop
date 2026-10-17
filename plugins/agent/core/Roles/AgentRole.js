/**
 * AgentRole —— 多 Agent 协作中的角色定义（Phase 2）
 *
 * 一个「角色」= 一组**能力边界 + 行为约定 + 通信契约**：
 *
 * | 维度 | 字段 | 作用 |
 * |---|---|---|
 * | 身份 | `id` / `displayName` / `kind` | 总线地址与前端拓扑图节点名 |
 * | 行为 | `systemPrompt` | 注入会话的角色指令（"你是评审员，只判定不修改"） |
 * | 能力 | `skillPolicy` | **可用 SKILL 子集**——这是角色隔离的核心手段 |
 * | 通信 | `subscribesIntents` / `PRODUCES` | 该角色监听/发出的意图集合 |
 * | 数据 | `producesKeys` / `consumesKeys` | 黑板键的读写约定（谁产出、谁消费） |
 * | 预算 | `timeoutMs` / `maxTurns` | 单角色执行的**有界**保证 |

 * ## 为什么用 `skillPolicy` 而不是给每个角色写死 SKILL 列表
 *
 * 仓库有 **56 个 SKILL**（`Server/Skills/`），散落在 arkts / rn / flutter / rnoh / 通用
 * 五条产品线。若把 SKILL 名单硬编码进角色定义：
 *   - 新增一个 SKILL 必须改角色定义，否则新能力对任何角色都不可见；
 *   - 角色与产品线耦合（评审员要么写 56 条，要么漏掉 flutter 那条）。
 *
 * 因此改用**模式策略**（`skillPolicy.patterns`，支持 `前缀*` 通配）：
 *   - `reviewer` 用 `['acceptance-check', '*-consistency-check', '*-code-check', '*-documentation-quality-check']`
 *     一次性覆盖五条产品线的评审类 SKILL；
 *   - 新增 `arkts-library-xyz-review` 这类 SKILL 时只需模式命中即自动可用。
 *
 * ## 为什么必须有 `subscribesIntents`
 *
 * 总线是**广播 + 点对点**混合的：`ARTIFACT_PUBLISHED` 会广播给所有人。
 * 若角色不过滤意图，"Coder 收到审核结论" 会被当成"收到任务分配"处理，
 * 表现为角色在错误的时机启动会话（Phase 3 的高并发下会直接放大成会话风暴）。
 * 总线层已实现按 intent 过滤（`MessageBus.register(id, h, {intents})`）。
 *
 * @example
 * const role = AgentRole.get('reviewer');
 * role.matchesSkill('flutter-library-consistency-check'); // true
 * role.matchesSkill('rnoh-lib-demo-create');              // false（评审员不做实现）
 */

import { MessageIntent } from '../Messaging/AgentMessage.js';

/** 内置角色 kind（`id` 可自定义，`kind` 决定行为基线） */
export const RoleKind = Object.freeze({
    PLANNER: 'planner',
    RETRIEVER: 'retriever',
    CODER: 'coder',
    REVIEWER: 'reviewer',
    VERIFIER: 'verifier'
});

/**
 * SKILL 策略模式匹配。
 *
 * 支持三种写法：`exact`、`prefix*`、`*substring*`。
 * 刻意不引入 glob 依赖，也不需要——SKILL 命名的实际形态只有"精确"和"前缀同类"两种。
 *
 * @param {string} pattern
 * @param {string} name
 * @returns {boolean}
 */
export function matchSkillPattern(pattern, name) {
    if (typeof pattern !== 'string' || pattern === '') return false;
    if (!pattern.includes('*')) return pattern === name;
    const re = new RegExp(
        `^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`
    );
    return re.test(name);
}

/**
 * 角色定义（不可变）。
 */
export class AgentRole {
    /**
     * @param {object} def
     * @param {string} def.id
     * @param {string} def.kind
     * @param {string} def.displayName
     * @param {string} [def.description]
     * @param {string} def.systemPrompt
     * @param {string[]} [def.subscribesIntents]  - 接受的意图；缺省接受全部
     * @param {object} [def.skillPolicy]
     * @param {string} [def.skillPolicy.mode]     - 'inherit' | 'restricted' | 'none'
     * @param {string[]} [def.skillPolicy.patterns]
     * @param {string[]} [def.skillPolicy.exclude]
     * @param {string[]} [def.producesKeys]
     * @param {string[]} [def.consumesKeys]
     * @param {number} [def.timeoutMs]
     * @param {number} [def.maxTurns]
     * @param {boolean} [def.writesArtifacts]
     */
    constructor(def) {
        if (!def?.id || typeof def.id !== 'string') {
            throw new Error('AgentRole: id 必须是非空字符串');
        }
        if (!def.systemPrompt || typeof def.systemPrompt !== 'string') {
            throw new Error(`AgentRole(${def.id}): systemPrompt 必须是非空字符串`);
        }

        this.id = def.id;
        this.kind = def.kind || def.id;
        this.displayName = def.displayName || def.id;
        this.description = def.description || '';
        this.systemPrompt = def.systemPrompt;
        this.subscribesIntents = Object.freeze([...(def.subscribesIntents || [])]);
        this.skillPolicy = Object.freeze({
            mode: def.skillPolicy?.mode || 'inherit',
            patterns: Object.freeze([...(def.skillPolicy?.patterns || [])]),
            exclude: Object.freeze([...(def.skillPolicy?.exclude || [])])
        });
        this.producesKeys = Object.freeze([...(def.producesKeys || [])]);
        this.consumesKeys = Object.freeze([...(def.consumesKeys || [])]);
        this.timeoutMs = Number.isFinite(def.timeoutMs) && def.timeoutMs > 0 ? def.timeoutMs : 30 * 60 * 1000;
        this.maxTurns = Number.isInteger(def.maxTurns) && def.maxTurns > 0 ? def.maxTurns : 1;
        this.writesArtifacts = def.writesArtifacts !== false;

        Object.freeze(this);
    }

    /**
     * 该角色是否可使用某个 SKILL。
     *
     * - `mode='inherit'`：不限制（沿用 Phase 1 的自动匹配行为）
     * - `mode='none'`：禁止使用 SKILL（如 Planner 只做语言层面的拆解）
     * - `mode='restricted'`：必须命中 `patterns` 之一，且不在 `exclude` 中
     *
     * @param {string} skillName
     * @returns {boolean}
     */
    matchesSkill(skillName) {
        if (this.skillPolicy.mode === 'inherit') return true;
        if (this.skillPolicy.mode === 'none') return false;
        if (this.skillPolicy.exclude.some((p) => matchSkillPattern(p, skillName))) return false;
        return this.skillPolicy.patterns.some((p) => matchSkillPattern(p, skillName));
    }

    /**
     * 从候选 SKILL 列表里筛出本角色可用的。
     * @param {string[]} names
     * @returns {string[]}
     */
    filterSkills(names) {
        return (names || []).filter((n) => this.matchesSkill(n));
    }

    /**
     * 该角色是否接收某个意图。
     * @param {string} intent
     * @returns {boolean}
     */
    accepts(intent) {
        return this.subscribesIntents.length === 0 || this.subscribesIntents.includes(intent);
    }

    /**
     * 组装最终 system prompt。
     *
     * 结构固定为「角色规则 → 可用 SKILL → 黑板现状 → 额外上下文 → 输出契约」。
     * 顺序刻意如此：角色规则在最前（决定行为基线），输出契约在最后且**永远存在**
     * （越靠近生成位置越不容易被长上下文淹没——这是让"角色必须按规定格式产出"
     * 真正生效的工程细节，只写在文档里的格式约定经常被忽略）。
     *
     * @param {object} [ctx]
     * @param {string} [ctx.blackboard]  - 黑板现状（`Blackboard.snapshotForPrompt().text`）
     * @param {string} [ctx.role]        - 本角色在本次协作中的具体身份描述（如"你负责审核 stepId=3"）
     * @param {string} [ctx.artifacts]   - 需要关注的产物列表
     * @param {string} [ctx.feedback]    - 上一轮被驳回的原因（重做时注入）
     * @param {number} [ctx.round]
     * @param {string} [ctx.outputContract] - 覆盖默认输出契约
     * @returns {string}
     */
    buildSystemPrompt(ctx = {}) {
        const parts = [this.systemPrompt];

        if (this.skillPolicy.mode === 'restricted' && this.skillPolicy.patterns.length) {
            parts.push(
                `## 可用 SKILL 范围\n` +
                `本次协作中你只能使用以下模式的 SKILL：${this.skillPolicy.patterns.join('、')}` +
                (this.skillPolicy.exclude.length ? `\n禁止使用：${this.skillPolicy.exclude.join('、')}` : '')
            );
        } else if (this.skillPolicy.mode === 'none') {
            parts.push('## 可用 SKILL 范围\n本次协作中你**不使用任何 SKILL**，仅依据自身知识与上下文推理。');
        }

        if (ctx.role) parts.push(`## 本次职责\n${ctx.role}`);

        if (ctx.blackboard) {
            parts.push(
                `## 黑板现状（其他角色的产出，可直接引用，不要重复劳动）\n${ctx.blackboard}`
            );
        }

        if (ctx.artifacts) {
            parts.push(`## 需要关注的产物\n${ctx.artifacts}`);
        }

        if (ctx.feedback) {
            parts.push(
                `## 上一轮被驳回的原因（必须逐条解决，不要只做表面修改）\n${ctx.feedback}`
            );
        }

        parts.push(`## 输出契约\n${ctx.outputContract || this.defaultOutputContract()}`);

        return parts.join('\n\n');
    }

    /**
     * 默认输出契约。
     *
     * 与 Phase 1 的产物约定**完全兼容**：仍要求 `## 执行状态` 段，
     * 使 `FlexRunner.checkResult()` / `Orchestrator._resolveInputReport()`
     * 不需要为新角色产物写第二套解析逻辑。
     *
     * @returns {string}
     */
    defaultOutputContract() {
        return [
            '在你的回复**最后**必须包含一个独立小节，格式严格如下（缺少则该次执行视为失败）：',
            '',
            '## 执行状态',
            '成功',
            '',
            '随后可附「## 结论」「## 风险」「## 依据」等小节说明细节。',
            '若你认为本角色无法完成，写「失败」并在下一行给出**具体**阻塞原因（不要写"环境问题"这类无法行动的描述）。'
        ].join('\n');
    }

    /**
     * 摘要（前端拓扑图 / 日志）。
     * @returns {object}
     */
    brief() {
        return {
            id: this.id,
            kind: this.kind,
            displayName: this.displayName,
            skillPolicy: this.skillPolicy.mode,
            accepts: this.subscribesIntents,
            producesKeys: this.producesKeys,
            consumesKeys: this.consumesKeys,
            timeoutMs: this.timeoutMs
        };
    }

    /**
     * 从 JSON 构造自定义角色（任务定义里可覆盖/新增角色）。
     * @param {object} json
     * @returns {AgentRole}
     */
    static fromJSON(json) {
        return new AgentRole(json);
    }
}

/**
 * 角色注册表（进程级默认注册表 + 可实例化独立注册表）。
 *
 * 提供实例级注册表是为了让 Supervisor 能按任务注入自定义角色而不污染全局——
 * 与 F-12 的 `BoundedRegistry` 思路一致：**可变全局状态**在多任务并发下是事故来源。
 */
export class RoleRegistry {
    /** @type {Map<string, AgentRole>} */
    #roles = new Map();

    /**
     * @param {AgentRole[]} [roles]
     */
    constructor(roles = []) {
        for (const r of roles) this.register(r);
    }

    /**
     * @param {AgentRole|object} role
     * @returns {AgentRole}
     */
    register(role) {
        const r = role instanceof AgentRole ? role : AgentRole.fromJSON(role);
        this.#roles.set(r.id, r);
        return r;
    }

    /**
     * @param {string} id
     * @returns {AgentRole|undefined}
     */
    get(id) {
        return this.#roles.get(id);
    }

    /** @param {string} id */
    has(id) {
        return this.#roles.has(id);
    }

    /** @returns<string[]> */
    ids() {
        return [...this.#roles.keys()];
    }

    /** @returns {AgentRole[]} */
    list() {
        return [...this.#roles.values()];
    }

    /** @returns {RoleRegistry} 浅拷贝（用于按任务派生） */
    clone() {
        return new RoleRegistry(this.list());
    }
}

/**
 * 五个内置角色。
 *
 * 设计取舍：**Planner/Coder/Reviewer/Verifier** 是经典的四段式，
 * 这里额外加一个 **Retriever**，原因与本项目的领域强相关——
 * 三方库检视任务的前置成本主要在「找出这个库的已知坑」（`BadCase` 知识库
 * 已积累 19 条规则），把它独立成角色可以让：
 *   1. 检索结果**先写黑板**，Coder/Reviewer/Verifier 共享，避免每个角色各查一遍；
 *   2. 检索失败（超时/无命中）与"实现失败"在归因上分开——
 *      否则「知识库没命中」会被误判成「编码能力不足」。
 */
export const BUILTIN_ROLES = Object.freeze([
    Object.freeze({
        id: 'planner',
        kind: RoleKind.PLANNER,
        displayName: '规划者',
        description: '把步骤目标细化为可执行的子任务顺序，产出明确的验收口径',
        systemPrompt: [
            '你是一个**任务规划者**。你的产出是**计划**，不是实现。',
            '',
            '职责：',
            '1. 读懂步骤目标与可用上下文，判断"要做到什么程度才算完成"；',
            '2. 把目标拆成 2~5 个**有序子任务**，每个子任务必须写明：做什么、产出什么文件、如何验证；',
            '3. 指出**风险与前置条件**（例如"需要先确认依赖版本"），但不要替执行者做决定；',
            '4. 明确**不要做什么**（防止执行者过度扩张范围导致超时）。',
            '',
            '纪律：',
            '- 不要输出代码实现；',
            '- 不要臆造仓库里不存在的信息，不确定就写"待确认"并给出确认方法；',
            '- 子任务数量必须收敛，超过 5 个说明你还没想清楚，请合并。'
        ].join('\n'),
        subscribesIntents: [MessageIntent.TASK_ASSIGN, MessageIntent.QUERY],
        skillPolicy: { mode: 'restricted', patterns: ['task-analysis', 'task-decomposition', '*-known-issue-check'] },
        producesKeys: ['计划'],
        consumesKeys: [],
        timeoutMs: 10 * 60 * 1000,
        maxTurns: 1,
        writesArtifacts: false
    }),
    Object.freeze({
        id: 'retriever',
        kind: RoleKind.RETRIEVER,
        displayName: '检索者',
        description: '检索的历史经验与已知问题，写入黑板供其他角色共享',
        systemPrompt: [
            '你是一个**上下文检索者**。你的产出是**可引用的既有事实**，不是推测。',
            '',
            '职责：',
            '1. 从已给出的历史经验、已知问题清单、仓库文件中找出与本步骤**直接相关**的条目；',
            '2. 每条结论必须给出**出处**（文件路径 / 经验标题 / 规则编号），没有出处的一律不要写；',
            '3. 明确区分「已确认事实」与「相似但未确认」两类，后者单独成节并标注置信度；',
            '4. 如果**什么都没有命中**，就明确写"无相关历史经验"——这是有价值的信息，',
            '   绝不要为了显得有用而编造。',
            '',
            '纪律：不要提出方案、不要下结论、不要评价好坏；你只负责把事实摆到台面上。'
        ].join('\n'),
        subscribesIntents: [MessageIntent.TASK_ASSIGN, MessageIntent.QUERY],
        skillPolicy: { mode: 'restricted', patterns: ['rn-library-known-issue-check', 'rnoh-lib-rnt-search', 'knowledge-import'] },
        producesKeys: ['历史经验'],
        consumesKeys: [],
        timeoutMs: 10 * 60 * 1000,
        maxTurns: 1,
        writesArtifacts: false
    }),
    Object.freeze({
        id: 'coder',
        kind: RoleKind.CODER,
        displayName: '执行者',
        description: '按计划与检索结果完成实际工作，产出可验证的成果文件',
        systemPrompt: [
            '你是一个**执行者**。你的产出是**实际成果**（代码、报告、分析文件），不是说明。',
            '',
            '职责：',
            '1. 严格按计划执行，不擅自扩大范围；计划明显有误时可以调整，但必须在结论中说明**为什么调整**；',
            '2. 所有结论必须落到**文件**里，并给出文件路径——口头结论视为未完成；',
            '3. 执行过程中遇到错误，先自行排查再报告；报告时必须给出**原始错误信息**，不要只写"执行失败"；',
            '4. 如果被要求修订，逐条回应上一轮的驳回原因，并说明**改了什么**。',
            '',
            '纪律：',
            '- 不要假装完成：无法完成的子任务必须明确标注并说明原因；',
            '- 不要删除或覆盖他人产物——需要新版就写新文件名。'
        ].join('\n'),
        subscribesIntents: [
            MessageIntent.TASK_ASSIGN,
            MessageIntent.REVISION_REQUEST,
            MessageIntent.QUERY
        ],
        // 唯一拥有实现类 SKILL 的角色：其余角色拿到这些 SKILL 会因为"越过角色边界"而破坏评审独立性
        skillPolicy: {
            mode: 'restricted',
            patterns: [
                'arkts-*', 'rn-*', 'rnoh-*', 'flutter-*', 'tpc-*', 'ohos-*', 'gitcode-*',
                'task-analysis', 'task-decomposition', 'knowledge-import', 'skill-generator'
            ],
            // 评审/验证类 SKILL 不交给执行者——否则会出现"自己给自己打分"
            exclude: ['acceptance-check', '*-consistency-check', '*-documentation-quality-check', '*-stability-check', '*-memory-leak-check', '*-test-coverage-check', '*-xts-coverage']
        },
        producesKeys: ['实现'],
        consumesKeys: ['计划', '历史经验'],
        timeoutMs: 90 * 60 * 1000,
        maxTurns: 2
    }),
    Object.freeze({
        id: 'reviewer',
        kind: RoleKind.REVIEWER,
        displayName: '评审者',
        description: '按验收口径判定执行结果，可驳回要求重做（有界）',
        systemPrompt: [
            '你是一个**评审者**。你的产出是**判定 + 理由**，你**不修改**别人的成果。',
            '',
            '职责：',
            '1. 逐条对照计划/验收口径检查执行者的产出，每条给出「通过 / 不通过」；',
            '2. 不通过必须给出**可行动的**驳回理由：指出具体文件、具体位置、具体缺失内容；',
            '   写"质量不够好"这类无法行动的理由会被视为评审失败；',
            '3. 判断产出是否**真实存在**（文件是否生成、内容是否与声称一致），',
            '   发现"声称完成但产物缺失/为空"必须直接驳回；',
            '4. 区分「必须改」与「建议改」两类，后者不得作为驳回理由。',
            '',
            '纪律：',
            '- 宁可放过小瑕疵，也不要用模糊理由无限驳回——重做次数有严格上限；',
            '- 你的判定会被记录进协作日志并接受审计，不要为了推进流程而虚假通过。'
        ].join('\n'),
        subscribesIntents: [MessageIntent.REQUEST_REVIEW, MessageIntent.QUERY, MessageIntent.TASK_ASSIGN],
        skillPolicy: {
            mode: 'restricted',
            patterns: [
                'acceptance-check',
                '*-consistency-check',
                '*-code-check',
                '*-documentation-quality-check',
                '*-known-issue-check'
            ]
        },
        producesKeys: ['评审结论'],
        consumesKeys: ['计划', '实现', '历史经验'],
        timeoutMs: 30 * 60 * 1000,
        maxTurns: 1,
        writesArtifacts: false
    }),
    Object.freeze({
        id: 'verifier',
        kind: RoleKind.VERIFIER,
        displayName: '验证者',
        description: '以可复现的证据校验最终产物（覆盖率/稳定性/构建/接口一致性）',
        systemPrompt: [
            '你是一个**验证者**。你的产出是**可复现的证据**，不是意见。',
            '',
            '职责：',
            '1. 用可执行的方式验证产物：跑构建、跑测试、跑覆盖率、比对接口签名；',
            '2. 每一条结论必须附带**原始输出片段**与**执行命令**，没有命令的结论无效；',
            '3. 对"无法验证"的情况，明确说明**为什么不能验证**以及需要什么条件，',
            '   不要把"没跑"写成"通过"；',
            '4. 给出一个总体判定：`通过` / `不通过` / `无法验证`（三者互斥，必须选一个）。',
            '',
            '纪律：',
            '- 只报告你**确实观察到**的现象；',
            '- 引用他人结论时必须标注"引用（未独立验证）"。'
        ].join('\n'),
        subscribesIntents: [MessageIntent.TASK_ASSIGN, MessageIntent.QUERY],
        skillPolicy: {
            mode: 'restricted',
            patterns: [
                '*-test-coverage-check',
                '*-xts-coverage',
                '*-xts-execution',
                '*-stability-check',
                '*-memory-leak-check',
                '*-compile-validate',
                '*-interface-*',
                'rnoh-cptf-*',
                'acceptance-check'
            ]
        },
        producesKeys: ['验证结论'],
        consumesKeys: ['实现', '评审结论'],
        timeoutMs: 60 * 60 * 1000,
        maxTurns: 1
    })
]);

/** 进程级默认注册表（只读用途；按任务定制请用 `registry.clone()`） */
export const defaultRoleRegistry = new RoleRegistry(BUILTIN_ROLES.map((r) => new AgentRole(r)));

export default AgentRole;
