/**
 * AgentMessage —— 多 Agent 协作的结构化消息（Phase 2）
 *
 * 背景（为什么需要它）：
 *   Phase 1 中「一个步骤 = 一个 opencode 会话」，步骤之间**唯一**的通信手段是
 *   文件系统：前置步骤把结论写进 `stepIdN_loopL_result_M.md`，Orchestrator 的
 *   `_resolveInputReport()` 把该**路径**交给后继步骤，后继步骤自己去读。
 *
 *   这套机制能跑通，但一旦一步要由「一组有角色的 Agent」协作完成，它就暴露三个问题：
 *     1. **无法表达"谁对谁说了什么"**——路径数组表达不了 A 请求 B 审核、B 驳回、
 *        A 重做这种带方向的交互；
 *     2. **无法做请求-响应配对**——文件没有 correlationId，跨步/跨角色的问答
 *        只能靠约定文件名，改名即断；
 *     3. **无法审计与回放**——一次协作结束后，除了散落的 md 文件，没有
 *        可重建的因果链。
 *
 *   本模块把「通信」从文件提升为一等对象，文件降级为 artifact 的**落盘形式**。
 *
 * 设计要点：
 *   - **不可变**：构造即 `Object.freeze`，`payload`/`artifacts` 做浅冻结副本。
 *     这样 `MessageBus` 的回放日志事后无法被任何调用方篡改——
 *     「协作过程 100% 可由回放日志重建」才是可验证的承诺，而不是口号。
 *   - **确定性 id**：默认 id 由 `MessageBus` 注入的单调序号生成（`msg-000001`），
 *     而非 `Date.now()`/随机数。因此同一段协作脚本跑两次，回放日志除了时间戳
 *     以外逐字段可比对，测试可以断言"消息序列完全相同"。
 *   - **correlationId**：请求与应答共享同一个 correlationId；`reply()` 自动携带，
 *     调用方不需要手工传递。
 *   - **payload 必须是纯对象**：拒绝把 Promise/函数/循环引用塞进消息，
 *     避免"消息在总线上排队时偷偷经历状态变化"这类难以复现的问题。
 *
 * @example
 * const msg = AgentMessage.create({
 *   from: 'coder', to: 'reviewer', intent: MessageIntent.REQUEST_REVIEW,
 *   payload: { stepId: 2, artifact: 'stepId2_loop0_result_0.md' }
 * });
 * const reply = msg.reply({ from: 'reviewer', intent: MessageIntent.REVIEW_RESULT,
 *   payload: { approved: false, reasons: ['缺少错误分支'] } });
 * reply.correlationId === msg.correlationId;  // true
 */

/**
 * 消息意图 —— 协作语义的封闭集合。
 *
 * 使用封闭集合（而非自由字符串）的理由：MessageBus 的订阅、Supervisor 的
 * 状态机、前端拓扑图都按 intent 分类，自由字符串会让这三处各自维护一份
 * 隐式约定，很快就会漂移。新增意图必须同时更新这里与 `INTENT_DIRECTION`。
 */
export const MessageIntent = Object.freeze({
    /** 派发任务给某角色 */
    TASK_ASSIGN: 'task.assign',
    /** 角色汇报执行进展（非终态） */
    PROGRESS: 'task.progress',
    /** 请求审核（Coder → Reviewer） */
    REQUEST_REVIEW: 'review.request',
    /** 审核结论（Reviewer → 请求方） */
    REVIEW_RESULT: 'review.result',
    /** 驳回并要求重做（Reviewer → Coder），带 reasons */
    REVISION_REQUEST: 'revision.request',
    /** 产物发布公告（广播，Blackboard 已更新） */
    ARTIFACT_PUBLISHED: 'artifact.published',
    /** 查询（如 Verifier 追问 Coder 某个实现细节） */
    QUERY: 'query',
    /** 查询应答 */
    QUERY_RESULT: 'query.result',
    /** 终局报告（任意角色 → supervisor） */
    FINAL_REPORT: 'task.final_report'
});

/** 全部合法 intent 值（构造时校验用） */
export const ALL_INTENTS = Object.freeze(Object.values(MessageIntent));

/**
 * 广播地址。`to` 取该值时消息送达所有已注册角色。
 * 用常量而非字面量 `'*'`，避免各处手写导致拼写错误静默变成"发给一个叫 * 的角色"。
 */
export const BROADCAST = '*';

/** 编排者（Supervisor 自身）的地址。角色向它汇报终局。 */
export const SUPERVISOR_ID = 'supervisor';

/** id 序号补零宽度，使回放日志按字典序 == 时间序 */
const SEQ_PAD = 6;

/**
 * 判断一个值是否为「可安全放进消息的纯数据」。
 *
 * 拒绝：函数、Promise/thenable、Symbol 值、class 实例（含 Map/Set/Date）、循环引用。
 * 允许：null、string、number（含 ±Infinity 之外的所有值）、boolean、Array、plain object。
 *
 * @param {*} value
 * @param {Set<object>} [seen] - 用于循环引用检测
 * @param {string} [path]
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function isPureData(value, seen = new Set(), path = '$') {
    if (value === null) return { ok: true };

    const t = typeof value;
    if (t === 'string' || t === 'boolean') return { ok: true };
    if (t === 'number') {
        return Number.isFinite(value)
            ? { ok: true }
            : { ok: false, reason: `${path} 是 ${String(value)}（NaN/Infinity 无法 JSON 往返）` };
    }
    if (t === 'undefined') return { ok: false, reason: `${path} 是 undefined（JSON 往返会丢键）` };
    if (t === 'function') return { ok: false, reason: `${path} 是函数` };
    if (t === 'symbol' || t === 'bigint') return { ok: false, reason: `${path} 是 ${t}` };

    // t === 'object'
    if (typeof value.then === 'function') {
        return { ok: false, reason: `${path} 是 thenable/Promise（消息必须携带已完成的数据）` };
    }
    if (seen.has(value)) return { ok: false, reason: `${path} 存在循环引用` };
    seen.add(value);

    try {
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const r = isPureData(value[i], seen, `${path}[${i}]`);
                if (!r.ok) return r;
            }
            return { ok: true };
        }

        // 只接受 plain object（原型是 Object.prototype 或 null）
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
            const name = value?.constructor?.name || 'unknown';
            return { ok: false, reason: `${path} 是 ${name} 实例（只接受纯对象，请先展开为字段）` };
        }

        for (const key of Object.keys(value)) {
            const r = isPureData(value[key], seen, `${path}.${key}`);
            if (!r.ok) return r;
        }
        return { ok: true };
    } finally {
        seen.delete(value);
    }
}

/**
 * 深冻结（对已经过 `isPureData` 校验的数据安全）。
 * @param {*} value
 * @returns {*}
 */
function deepFreeze(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Object.isFrozen(value)) return value;
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return Object.freeze(value);
}

/**
 * 结构化协作消息。
 *
 * 字段：
 * | 字段 | 类型 | 说明 |
 * |---|---|---|
 * | `id` | string | 消息唯一 id（`msg-000123`），由总线序号生成 |
 * | `correlationId` | string | 请求-响应配对键；一次交互的所有消息共享 |
 * | `from` | string | 发送方角色 id |
 * | `to` | string \| string[] | 接收方角色 id / 数组 / `BROADCAST` |
 * | `intent` | string | `MessageIntent` 之一 |
 * | `payload` | object | 业务载荷（纯数据） |
 * | `artifacts` | string[] | 关联产物路径（相对 taskDir），文件只是 artifact 的落盘形式 |
 * | `stepId` | number \| null | 所属编排步骤（Supervisor 注入，便于回放定位） |
 * | `round` | number | 协作轮次（审核-重做循环的轮次号） |
 * | `createdAt` | string | CST 时间戳（唯一非确定字段，测试中可注入） |
 * | `inReplyTo` | string \| null | 本消息应答的原消息 id |
 */
export class AgentMessage {
    /**
     * @param {object} fields
     * @param {string} fields.id
     * @param {string} fields.from
     * @param {string|string[]} fields.to
     * @param {string} fields.intent
     * @param {object} [fields.payload]
     * @param {string[]} [fields.artifacts]
     * @param {string|null} [fields.correlationId]
     * @param {string|null} [fields.inReplyTo]
     * @param {number|null} [fields.stepId]
     * @param {number} [fields.round]
     * @param {string} fields.createdAt
     */
    constructor(fields) {
        this.id = fields.id;
        this.correlationId = fields.correlationId;
        this.from = fields.from;
        this.to = fields.to;
        this.intent = fields.intent;
        this.payload = fields.payload;
        this.artifacts = fields.artifacts;
        this.stepId = fields.stepId;
        this.round = fields.round;
        this.createdAt = fields.createdAt;
        this.inReplyTo = fields.inReplyTo;
        Object.freeze(this);
    }

    /**
     * 创建一条消息（做完整校验 + 冻结）。
     *
     * @param {object} input
     * @param {string} input.from                  - 发送方角色 id（必填、非空）
     * @param {string|string[]} input.to           - 接收方（必填；数组元素非空）
     * @param {string} input.intent                 - 必须是 MessageIntent 中的值
     * @param {object} [input.payload={}]           - 纯数据载荷
     * @param {string[]} [input.artifacts=[]]       - 关联产物路径
     * @param {string} [input.correlationId]        - 缺省时新建（= 本消息 id，即"请求方自己作为根"）
     * @param {string} [input.inReplyTo]            - 应答的原消息 id
     * @param {number} [input.stepId]
     * @param {number} [input.round=0]
     * @param {string} [input.id]                   - 显式 id（测试用；缺省需 seq/clock）
     * @param {string} [input.createdAt]            - 显式时间戳（测试用）
     * @param {{seq: number, clock: () => string}} [ctx] - 由 MessageBus 注入的序号与时钟
     * @returns {AgentMessage}
     */
    static create(input, ctx = {}) {
        if (!input || typeof input !== 'object') {
            throw new Error('AgentMessage.create: 入参必须是一个对象');
        }

        const { from, to, intent } = input;

        if (typeof from !== 'string' || from.trim() === '') {
            throw new Error('AgentMessage.create: from 必须是非空字符串');
        }

        // to：单地址 / 广播 / 地址数组；数组不得为空
        let toNorm;
        if (Array.isArray(to)) {
            if (to.length === 0) {
                throw new Error('AgentMessage.create: to 数组不能为空（广播请使用 BROADCAST）');
            }
            for (const t of to) {
                if (typeof t !== 'string' || t.trim() === '') {
                    throw new Error(`AgentMessage.create: to 数组含非法地址 ${JSON.stringify(t)}`);
                }
            }
            toNorm = Object.freeze([...to]);
        } else if (typeof to === 'string' && to.trim() !== '') {
            toNorm = to;
        } else {
            throw new Error('AgentMessage.create: to 必须是非空字符串或非空字符串数组');
        }

        if (!ALL_INTENTS.includes(intent)) {
            throw new Error(
                `AgentMessage.create: 未知 intent ${JSON.stringify(intent)}；` +
                `合法值：${ALL_INTENTS.join(', ')}`
            );
        }

        const payload = input.payload === undefined ? {} : input.payload;
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('AgentMessage.create: payload 必须是对象（可为空对象）');
        }
        const pv = isPureData(payload, new Set(), 'payload');
        if (!pv.ok) {
            throw new Error(`AgentMessage.create: payload 含不可序列化数据 —— ${pv.reason}`);
        }

        const artifacts = input.artifacts === undefined ? [] : input.artifacts;
        if (!Array.isArray(artifacts)) {
            throw new Error('AgentMessage.create: artifacts 必须是字符串数组');
        }
        for (const a of artifacts) {
            if (typeof a !== 'string' || a.trim() === '') {
                throw new Error(`AgentMessage.create: artifacts 含非法路径 ${JSON.stringify(a)}`);
            }
        }

        const id = input.id || AgentMessage._nextId(ctx);
        const createdAt = input.createdAt || (typeof ctx.clock === 'function' ? ctx.clock() : new Date().toISOString());
        const round = Number.isInteger(input.round) ? input.round : 0;
        const stepId = Number.isInteger(input.stepId) ? input.stepId : null;

        return new AgentMessage({
            id,
            // 无显式 correlationId 时，本消息即一次交互的根（请求方自己作为根）
            correlationId: input.correlationId || id,
            from,
            to: toNorm,
            intent,
            payload: deepFreeze({ ...payload }),
            artifacts: Object.freeze([...artifacts]),
            stepId,
            round,
            createdAt,
            inReplyTo: input.inReplyTo || null
        });
    }

    /**
     * 生成确定性消息 id。
     *
     * 有 `ctx.seq` 时用补零序号（`msg-000001`）——同一段协作脚本重放时 id 完全一致，
     * 测试可以直接断言消息序列；无 ctx 时退化为随机 id（仅用于脱离总线的手工构造）。
     *
     * @param {{seq?: number}} ctx
     * @returns {string}
     * @private
     */
    static _nextId(ctx) {
        if (Number.isInteger(ctx?.seq) && ctx.seq >= 0) {
            return `msg-${String(ctx.seq).padStart(SEQ_PAD, '0')}`;
        }
        return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * 构造一条应答消息：自动继承 `correlationId`、反向 `from`/`to`、`inReplyTo`。
     *
     * 这是「请求-响应」模式的唯一入口——调用方不需要手工搬运三个字段，
     * 因此也不会出现"忘了带 correlationId 导致应答永远匹配不上"的挂起。
     *
     * @param {object} input
     * @param {string} input.from   - 应答方（通常等于原消息的 to）
     * @param {string} [input.intent]
     * @param {object} [input.payload]
     * @param {string[]} [input.artifacts]
     * @param {string} [input.to]   - 缺省回到原消息的 from
     * @param {{seq?: number, clock?: () => string}} [ctx]
     * @returns {AgentMessage}
     */
    reply(input = {}, ctx = {}) {
        return AgentMessage.create({
            from: input.from,
            // 应答默认回到原发送方；无论原消息是点对点、数组还是广播，
            // 应答方向都是"回给发信人"，因此直接取 this.from。
            to: input.to || this.from,
            intent: input.intent || this.intent,
            payload: input.payload,
            artifacts: input.artifacts,
            correlationId: this.correlationId,
            inReplyTo: this.id,
            stepId: input.stepId !== undefined ? input.stepId : this.stepId,
            round: input.round !== undefined ? input.round : this.round,
            id: input.id,
            createdAt: input.createdAt
        }, ctx);
    }

    /**
     * 消息是否投递给 `agentId`。
     *
     * 广播消息对**除发送方以外**的所有人可见——发送方不应收到自己广播的消息，
     * 否则 Planner 广播「计划已就绪」会触发自己的处理分支（自环）。
     *
     * @param {string} agentId
     * @returns {boolean}
     */
    matches(agentId) {
        if (this.to === BROADCAST) return agentId !== this.from;
        if (Array.isArray(this.to)) return this.to.includes(agentId);
        return this.to === agentId;
    }

    /**
     * 是否为应答消息。
     * @returns {boolean}
     */
    get isReply() {
        return this.inReplyTo !== null;
    }

    /**
     * 转为可 JSON 序列化的纯对象（回放日志的存储形态）。
     * @returns {object}
     */
    toJSON() {
        return {
            id: this.id,
            correlationId: this.correlationId,
            from: this.from,
            to: this.to,
            intent: this.intent,
            payload: this.payload,
            artifacts: this.artifacts,
            stepId: this.stepId,
            round: this.round,
            createdAt: this.createdAt,
            inReplyTo: this.inReplyTo
        };
    }

    /**
     * 从 JSON 还原（回放用）。**走与 create 相同的校验**，
     * 因此日志被手工编辑坏掉时会在回放时报错，而不是悄悄产出半截消息。
     *
     * @param {object} json
     * @returns {AgentMessage}
     */
    static fromJSON(json) {
        return AgentMessage.create(json);
    }

    /**
     * 单行摘要（日志/前端拓扑图用）。
     * @returns {string}
     */
    brief() {
        const to = Array.isArray(this.to) ? `[${this.to.join(',')}]` : this.to;
        const art = this.artifacts.length ? ` artifacts=${this.artifacts.length}` : '';
        return `${this.from}→${to} ${this.intent} (${this.id}${art})`;
    }
}

export default AgentMessage;
