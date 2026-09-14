/**
 * Trace —— 跨服务链路追踪（Phase 4）
 *
 * ## 目标：从"任务 ID"下钻到"具体哪次 LLM 调用"
 *
 * Phase 1/2 的日志是**扁平的**：`FlexRunner` 有 taskId 前缀、Orchestrator 有步骤号，
 * 但一次 LLM 调用属于哪个步骤、哪个角色的第几次重做，只能靠人工拼日志时间线。
 * 本模块给出真正的**父子跨度树**：
 *
 * ```
 * task:t1                                   (orchestrator-svc)
 * ├── step:2                                 (orchestrator-svc)
 * │   ├── role:coder#0                       (agent-runtime-svc)
 * │   │   └── llm:chatJSON x5               (llmClient)
 * │   └── role:reviewer#0                    (agent-runtime-svc)
 * │       └── llm:chatJSON x2
 * ```
 *
 * ## 为什么用 W3C traceparent 而不是自定义头
 *
 * 跨服务传播如果自定义（例如 `X-Trace-Id: xxx`），就必须自己处理
 * "父跨度 id 怎么传、采样位怎么传、畸形头怎么降级"。W3C `traceparent`
 * 是标准格式且被主流网关/OpenTelemetry 生态直接识别——这意味着
 * **接入真实 OTel 后端时不需要改任何传播代码**，只需换 exporter。
 *
 * 格式：`{version}-{traceId(32hex)}-{parentId(16hex)}-{flags}`
 *
 * ## 采样
 *
 * 高频 LLM 调用会让追踪数据本身成为成本。因此支持**头部采样**（在任务入口决定
 * 是否记录整条链）而不是尾部采样——头部采样保证"要么整条链都记，要么都不记"，
 * 不会出现"父跨度有、子跨度丢"的断链。采样位随 traceparent 向下传播，
 * 因此跨服务也不会各自为政地决定采不采。
 */

import { randomBytes } from 'node:crypto';

/** 采样标志位（W3C：bit 0 = sampled） */
export const TRACE_FLAG_SAMPLED = 0x01;

/** traceparent 正则（严格按 W3C 规范：版本/32hex/16hex/2hex） */
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * 解析 traceparent 头。
 *
 * 严格拒绝畸形输入（返回 null 而不是抛错，也不做"猜测式修复"）：
 * 追踪数据宁可缺一条，也不要把两个不相关的请求接到同一棵树上——
 * 后者会把人引向完全错误的排查方向。
 *
 * @param {string} header
 * @returns {{version: string, traceId: string, parentId: string, flags: number, sampled: boolean}|null}
 */
export function parseTraceparent(header) {
    if (typeof header !== 'string') return null;
    const m = TRACEPARENT_RE.exec(header.trim().toLowerCase());
    if (!m) return null;
    const [, version, traceId, parentId, flags] = m;
    // 全零是显式非法值（规范要求拒绝）
    if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) return null;
    const f = parseInt(flags, 16);
    return { version, traceId, parentId, flags: f, sampled: (f & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED };
}

/**
 * 生成 traceparent 头。
 * @param {{traceId: string, spanId: string, sampled: boolean}} p
 * @returns {string}
 */
export function formatTraceparent({ traceId, spanId, sampled }) {
    return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

/** @returns {string} 32 位十六进制 traceId */
export function newTraceId() {
    return randomBytes(16).toString('hex');
}

/** @returns {string} 16 位十六进制 spanId */
export function newSpanId() {
    return randomBytes(8).toString('hex');
}

/**
 * 一个跨度。
 */
export class Span {
    /**
     * @param {object} p
     * @param {string} p.traceId
     * @param {string} p.spanId
     * @param {string|null} p.parentSpanId
     * @param {string} p.name
     * @param {string} [p.service]
     * @param {boolean} p.sampled
     * @param {number} p.startTimeMs
     * @param {object} [p.attributes]
     */
    constructor(p) {
        this.traceId = p.traceId;
        this.spanId = p.spanId;
        this.parentSpanId = p.parentSpanId;
        this.name = p.name;
        this.service = p.service || 'unknown';
        this.sampled = p.sampled;
        this.startTimeMs = p.startTimeMs;
        this.endTimeMs = null;
        /** @type {object} */
        this.attributes = { ...(p.attributes || {}) };
        /** @type {object[]} */
        this.events = [];
        /** @type {Error|null} */
        this.error = null;
        this.status = 'unset';
        Object.seal(this);
    }

    /** @returns {number} 时长（ms）；未结束返回 0 */
    get durationMs() {
        return this.endTimeMs === null ? 0 : this.endTimeMs - this.startTimeMs;
    }

    /**
     * 记录事件（如"重试"、"驳回"）。
     * @param {string} name
     * @param {object} [attrs]
     * @returns {this}
     */
    addEvent(name, attrs = {}) {
        this.events.push({ name, at: Date.now(), ...attrs });
        return this;
    }

    /**
     * 设置属性。
     * @param {string} key
     * @param {*} value
     * @returns {this}
     */
    setAttribute(key, value) {
        this.attributes[key] = value;
        return this;
    }

    /**
     * 标记失败。
     * @param {Error|string} err
     * @returns {this}
     */
    setError(err) {
        this.error = err instanceof Error ? { message: err.message, name: err.name } : { message: String(err) };
        this.status = 'error';
        return this;
    }

    /** @returns {object} 可 JSON 化的快照 */
    toJSON() {
        return {
            traceId: this.traceId,
            spanId: this.spanId,
            parentSpanId: this.parentSpanId,
            name: this.name,
            service: this.service,
            sampled: this.sampled,
            startTimeMs: this.startTimeMs,
            endTimeMs: this.endTimeMs,
            durationMs: this.durationMs,
            attributes: this.attributes,
            events: this.events,
            error: this.error,
            status: this.status
        };
    }
}

/**
 * 进程内 exporter（把完成的跨度交给可注入的 sink）。
 *
 * 换 OTel 只需实现同形状的 `export(span, ctx)`——跨度结构与
 * OTel Span 的字段一一对应（traceId/spanId/parentSpanId/name/timestamps/attributes/events/status）。
 */
export class InMemoryExporter {
    /**
     * @param {object} [opts]
     * @param {number} [opts.capacity=5000]
     */
    constructor(opts = {}) {
        this.capacity = Number.isInteger(opts.capacity) && opts.capacity > 0 ? opts.capacity : 5000;
        /** @type {object[]} */
        this.spans = [];
        this.dropped = 0;
    }

    export(span) {
        if (this.spans.length >= this.capacity) {
            this.spans.shift();
            this.dropped++;
        }
        this.spans.push(span.toJSON ? span.toJSON() : span);
    }

    /** @returns {object[]} */
    all() {
        return this.spans.map((s) => structuredClone(s));
    }

    /** @param {string} traceId @returns {object[]} */
    byTrace(traceId) {
        return this.all().filter((s) => s.traceId === traceId);
    }

    /**
     * 把跨度集合还原成**父子树**（前端/排查的核心视图）。
     *
     * @param {string} traceId
     * @returns {{roots: object[], orphans: object[], total: number}}
     */
    tree(traceId) {
        const spans = this.byTrace(traceId);
        const byId = new Map(spans.map((s) => [s.spanId, { ...s, children: [] }]));
        const roots = [];
        const orphans = [];
        for (const s of byId.values()) {
            if (!s.parentSpanId) { roots.push(s); continue; }
            const parent = byId.get(s.parentSpanId);
            if (parent) parent.children.push(s);
            // 父跨度缺失（采样边界/进程重启）→ 归入 orphans，显式暴露而不是静默丢
            else orphans.push(s);
        }
        const sortRec = (nodes) => {
            nodes.sort((a, b) => a.startTimeMs - b.startTimeMs);
            for (const n of nodes) sortRec(n.children);
        };
        sortRec(roots);
        return { roots, orphans, total: spans.length };
    }

    /** 清空（测试用） */
    reset() {
        this.spans = [];
        this.dropped = 0;
    }
}

/**
 * 追踪器。
 *
 * @example
 * const tracer = new Tracer({ service: 'orchestrator-svc', sampleRate: 1 });
 * await tracer.withSpan({ name: 'task:t1' }, async (taskSpan) => {
 *   await tracer.withSpan({ name: 'step:2' }, async () => {
 *     await tracer.withSpan({ name: 'role:coder' }, async () => { /* … *\/ });
 *   });
 * });
 * tracer.exporter.tree(taskSpan.traceId);   // → 树
 */
export class Tracer {
    /**
     * @param {object} [opts]
     * @param {string} [opts.service='unknown']
     * @param {number} [opts.sampleRate=1]     - 0~1
     * @param {object} [opts.exporter]
     * @param {() => string} [opts.idFactory]  - 供测试注入确定性 id
     */
    constructor(opts = {}) {
        this.service = opts.service || 'unknown';
        this.sampleRate = Number.isFinite(opts.sampleRate) ? Math.min(1, Math.max(0, opts.sampleRate)) : 1;
        this.exporter = opts.exporter || new InMemoryExporter();
        this._idFactory = opts.idFactory || null;
        /** @type {Span[]} 当前活跃跨度的栈（每个 async 上下文一条链） */
        this._stack = [];
        this._stats = { started: 0, ended: 0, sampledIn: 0, sampledOut: 0, errors: 0 };
    }

    /** @private */
    _newId(kind) {
        if (this._idFactory) return this._idFactory(kind);
        return kind === 'trace' ? newTraceId() : newSpanId();
    }

    /**
     * 开始一个跨度（需自行 end，或用 `withSpan`）。
     *
     * @param {object} p
     * @param {string} p.name
     * @param {object} [p.attributes]
     * @param {string} [p.traceparent]      - 上游传入的 W3C 头（跨服务续接）
     * @param {string} [p.traceId]          - 显式 traceId（同进程内共享）
     * @param {string} [p.parentSpanId]
     * @param {boolean} [p.sampled]         - 显式采样决定（覆盖本地采样）
     * @param {string} [p.service]
     * @returns {Span}
     */
    startSpan(p) {
        let traceId = p.traceId;
        let parentSpanId = p.parentSpanId ?? null;
        let sampled = p.sampled;

        // 上游 traceparent 优先：保证跨服务属于同一棵树，且采样决定一致
        const tp = p.traceparent ? parseTraceparent(p.traceparent) : null;
        if (tp) {
            traceId = tp.traceId;
            parentSpanId = tp.parentId;
            sampled = tp.sampled;
        }

        if (!traceId) {
            traceId = this._newId('trace');
            if (sampled === undefined) {
                const keep = Math.random() < this.sampleRate;
                sampled = keep;
                if (keep) this._stats.sampledIn++; else this._stats.sampledOut++;
            }
        }
        if (sampled === undefined) sampled = true;

        const span = new Span({
            traceId,
            spanId: this._newId('span'),
            parentSpanId,
            name: p.name,
            service: p.service || this.service,
            sampled,
            startTimeMs: Date.now(),
            attributes: p.attributes
        });
        this._stats.started++;
        this._stack.push(span);
        return span;
    }

    /**
     * 结束一个跨度（从栈中弹出并导出）。
     * @param {Span} span
     * @param {Error} [err]
     * @returns {Span}
     */
    endSpan(span, err) {
        if (span.endTimeMs === null) span.endTimeMs = Date.now();
        if (err) { span.setError(err); this._stats.errors++; }
        const i = this._stack.lastIndexOf(span);
        if (i >= 0) this._stack.splice(i, 1);
        this._stats.ended++;
        if (span.sampled) this.exporter.export(span);
        return span;
    }

    /**
     * 包裹一个异步操作为子跨度（自动处理异常与结束）。
     *
     * @template T
     * @param {object} p - 同 `startSpan`
     * @param {(span: Span) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async withSpan(p, fn) {
        const span = this.startSpan(p);
        try {
            const r = await fn(span);
            this.endSpan(span);
            return r;
        } catch (err) {
            this.endSpan(span, err);
            throw err;
        }
    }

    /** @returns {Span|null} 当前活跃跨度 */
    get currentSpan() {
        return this._stack.length ? this._stack[this._stack.length - 1] : null;
    }

    /**
     * 生成向下游传播的 traceparent 头。
     *
     * @param {Span} [span] - 缺省用当前活跃跨度
     * @returns {string|null}
     */
    inject(span) {
        const s = span || this.currentSpan;
        if (!s) return null;
        return formatTraceparent({ traceId: s.traceId, spanId: s.spanId, sampled: s.sampled });
    }

    /**
     * 从上游头提取上下文（供下游服务建子跨度）。
     * @param {string} header
     * @returns {object|null}
     */
    extract(header) {
        return parseTraceparent(header);
    }

    /** @returns {object} */
    getStats() {
        return { service: this.service, sampleRate: this.sampleRate, active: this._stack.length, ...this._stats };
    }
}

export default Tracer;
