/**
 * MessageBus —— 进程内 Agent 协作总线（Phase 2）
 *
 * 职责：
 *   - **点对点**：`send({from,to,...})` → 只有 `to` 指定的角色收到
 *   - **广播**：`broadcast({from,...})` → 除发送方外所有已注册角色收到
 *   - **请求-响应**：`request({...}, {acceptIntents})` → 按 `correlationId` 配对，
 *     带超时；超时抛 `MessageBusTimeoutError`（不静默返回 undefined）
 *   - **回放日志**：所有经过总线的消息按序留存（有界），`getReplayLog()` 返回
 *     可直接 JSON 化的数组；`deriveTrace(correlationId)` 重建单次交互的因果链
 *   - **在途排空**：`drain()` 等待所有 handler 的异步执行结束（对齐 F-04 的
 *     优雅停机语义——进程退出不能把处理到一半的协作消息丢掉）
 *
 * 为什么用「进程内 EventEmitter 式总线」而不是直接互相调用：
 *   多 Agent 协作的**核心难点不是"能调用"，而是"谁跟谁说了什么、可不可追溯"**。
 *   直接函数调用会把协作关系编进代码里，无法画出拓扑、无法回放、无法在
 *   Phase 4 换成真实 MQ。因此这里刻意引入一层总线边界：角色之间只认地址与
 *   消息，不认对方是对象还是远程服务。
 *
 * **Phase 4 的替换契约**（同一接口换真实 MQ）：
 *   上层只依赖这三个方法 + 消息形状，不依赖"进程内"这一事实——
 *     `register(agentId, handler)` / `publish(message)` / `request(message, opts)`
 *   Phase 4 只需提供一个实现了同三个方法的 `MessageBusTransport`
 *   （Kafka/RabbitMQ/NATS 之上），并把它注入 `AgentRuntime`/`Supervisor` 的构造参数。
 *   本类即「进程内参考实现」（in-process reference implementation）。
 *
 * 可靠性设计（对应高并发要求）：
 *   - **无接收者不等于静默丢弃**：`publish` 返回 `{delivered, skipped}`，
 *     且 `getStats().undelivered` 计数 + `getUndelivered()` 保留最近 N 条，
 *     避免"角色名拼错 → 消息凭空消失 → 协作卡住但日志干净"这种最难查的故障。
 *   - **单个 handler 抛错不影响其他接收者**：逐个调用并隔离异常，
 *     记入 `handlerErrors` 并回调 `onError`（默认 warn 日志）。
 *   - **回放日志有界**：`maxLogSize` 默认 5000，超出后从头部丢弃并累加
 *     `logDropped`——长任务不会因为协作消息把内存吃光。
 *   - **pending request 有界**：`maxPendingRequests` 默认 1000，超出直接抛错
 *     （宁可显式失败，也不要无界堆积 setTimeout）。
 *
 * @example
 * const bus = new MessageBus();
 * bus.register('reviewer', async (msg) => {
 *   return msg.reply({ from: 'reviewer', intent: MessageIntent.REVIEW_RESULT,
 *                      payload: { approved: true } });
 * });
 * const reply = await bus.request({
 *   from: 'coder', to: 'reviewer', intent: MessageIntent.REQUEST_REVIEW
 * }, { acceptIntents: [MessageIntent.REVIEW_RESULT] });
 * reply.payload.approved === true;
 */

import { nowCST } from '../../../../core/cstTime.js';
import { AgentMessage, BROADCAST, MessageIntent, SUPERVISOR_ID } from './AgentMessage.js';

/** 默认回放日志容量 */
export const DEFAULT_MAX_LOG_SIZE = 5000;

/** 默认请求超时（ms）。协作消息是本地内存投递，30s 已极宽松。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/** 默认 pending request 上限 */
export const DEFAULT_MAX_PENDING = 1000;

/** 未投递消息的留存条数 */
const UNDELIVERED_KEEP = 50;

/**
 * 请求-响应超时错误。
 *
 * 刻意做成**异常**而非返回 `undefined`：协作语境下"应答没来"必须让调用方
 * 显式决定是重试、降级还是判定角色失败；返回 undefined 会被 `if (!reply)`
 * 悄悄吞掉，最后表现为"审核通过了"这种错误结论。
 */
export class MessageBusTimeoutError extends Error {
    /**
     * @param {string} correlationId
     * @param {number} timeoutMs
     * @param {string} description
     */
    constructor(correlationId, timeoutMs, description) {
        super(`MessageBus.request 超时（${timeoutMs}ms，correlationId=${correlationId}）：${description}`);
        this.name = 'MessageBusTimeoutError';
        this.correlationId = correlationId;
        this.timeoutMs = timeoutMs;
    }
}

/**
 * 进程内协作总线。
 */
export class MessageBus {
    /** @type {Map<string, {handler: Function, intents: Set<string>|null, agentId: string}>} */
    #subscribers = new Map();

    /** @type {object[]} 回放日志（已序列化的 AgentMessage 形状） */
    #log = [];

    /** @type {Map<string, {resolve: Function, reject: Function, timer: any, acceptIntents: Set<string>|null, description: string}>} */
    #pending = new Map();

    /** @type {Set<Promise<void>>} 在途 handler 任务 */
    #inflight = new Set();

    /** @type {number} */
    #seq = 0;

    /** @type {object[]} */
    #undelivered = [];

    #stats = {
        published: 0,
        delivered: 0,
        skipped: 0,
        undelivered: 0,
        handlerErrors: 0,
        requestsOpened: 0,
        requestsResolved: 0,
        requestsTimedOut: 0,
        logDropped: 0
    };

    /**
     * @param {object} [options]
     * @param {number} [options.maxLogSize]        - 回放日志容量（默认 5000）
     * @param {number} [options.maxPendingRequests]- 并发请求上限（默认 1000）
     * @param {() => string} [options.clock]       - 时间戳函数（测试注入固定时钟）
     * @param {(err: Error, msg: object) => void} [options.onError] - handler 异常回调
     * @param {(level: string, message: string) => void} [options.logger] - 日志回调
     */
    constructor(options = {}) {
        this.maxLogSize = Number.isInteger(options.maxLogSize) && options.maxLogSize > 0
            ? options.maxLogSize
            : DEFAULT_MAX_LOG_SIZE;
        this.maxPendingRequests = Number.isInteger(options.maxPendingRequests) && options.maxPendingRequests > 0
            ? options.maxPendingRequests
            : DEFAULT_MAX_PENDING;
        this._clock = typeof options.clock === 'function' ? options.clock : nowCST;
        this._onError = typeof options.onError === 'function' ? options.onError : null;
        this._logger = typeof options.logger === 'function' ? options.logger : null;
        /** 关闭后拒绝新消息（drain 之后的收尾保护） */
        this._closed = false;
    }

    // ─── 订阅管理 ──────────────────────────────────────────────────────────────

    /**
     * 注册一个角色处理器。
     *
     * 同一 agentId **重复注册会覆盖**（而不是叠加）：一个角色在同一时刻只有
     * 一个处理逻辑，叠加会导致同一条消息被处理 N 次——这在「Coder 收到
     * revision_request 就重做」的场景下会直接放大成 N 次重做。
     *
     * @param {string} agentId                       - 角色地址
     * @param {(msg: AgentMessage) => (AgentMessage|AgentMessage[]|object|object[]|void|Promise<any>)} handler
     *        可以 return 一条应答消息 / 应答数组 / 什么都不返回（只消费不回复）
     * @param {object} [opts]
     * @param {string[]} [opts.intents]              - 只订阅这些 intent；缺省订阅全部
     * @returns {() => boolean} 取消订阅函数（幂等）
     */
    register(agentId, handler, opts = {}) {
        if (typeof agentId !== 'string' || agentId.trim() === '') {
            throw new Error('MessageBus.register: agentId 必须是非空字符串');
        }
        if (typeof handler !== 'function') {
            throw new Error('MessageBus.register: handler 必须是函数');
        }

        let intents = null;
        if (opts.intents !== undefined) {
            if (!Array.isArray(opts.intents) || opts.intents.length === 0) {
                throw new Error('MessageBus.register: intents 必须是非空数组');
            }
            intents = new Set(opts.intents);
        }

        const entry = { handler, intents, agentId };
        this.#subscribers.set(agentId, entry);

        let active = true;
        return () => {
            if (!active) return false;
            active = false;
            // 仅当当前登记项仍是自己时才删除（避免把后来者的注册误删）
            if (this.#subscribers.get(agentId) === entry) {
                this.#subscribers.delete(agentId);
                return true;
            }
            return false;
        };
    }

    /**
     * 注销角色。
     * @param {string} agentId
     * @returns {boolean} 是否确实删除了登记项
     */
    unregister(agentId) {
        return this.#subscribers.delete(agentId);
    }

    /** @param {string} agentId */
    has(agentId) {
        return this.#subscribers.has(agentId);
    }

    /** @returns {string[]} 已注册角色地址（按注册顺序） */
    subscribers() {
        return [...this.#subscribers.keys()];
    }

    // ─── 投递 ─────────────────────────────────────────────────────────────────

    /**
     * 构造并投递一条消息（`send`/`broadcast` 的统一实现）。
     *
     * @param {object} input - 见 `AgentMessage.create`
     * @returns {Promise<{message: AgentMessage, delivered: number, skipped: number, errors: number}>}
     */
    async send(input) {
        const message = AgentMessage.create(input, { seq: this.#seq++, clock: this._clock });
        const r = await this.publish(message);
        return { message, ...r };
    }

    /**
     * 广播（`to` 强制为 `BROADCAST`）。
     *
     * @param {object} input - 同 `send`，其中 `to` 被忽略
     * @returns {Promise<{message: AgentMessage, delivered: number, skipped: number, errors: number}>}
     */
    async broadcast(input) {
        if (!input || typeof input !== 'object') {
            throw new Error('MessageBus.broadcast: 入参必须是一个对象');
        }
        return this.send({ ...input, to: BROADCAST });
    }

    /**
     * 投递一条已构造的消息。
     *
     * 行为保证：
     *   1. 消息先入回放日志，**再**投递——保证"处理过程中抛错"也能在日志里看到该消息。
     *   2. 逐个 handler 隔离调用；handler 返回的消息会被**继续投递**（可链式应答）。
     *   3. 无接收者时记入 `undelivered` 与统计，不静默。
     *
     * handler 的返回值约定：
     *   - `AgentMessage` / `AgentMessage[]` → 作为新消息继续投递
     *   - plain object（含 `from`/`to`/`intent`）→ 构造为消息继续投递（便于 mock 返回字面量）
     *   - 其他值（含 undefined）→ 忽略
     *
     * @param {AgentMessage} message
     * @returns {Promise<{delivered: number, skipped: number, errors: number}>}
     */
    async publish(message) {
        if (this._closed) {
            throw new Error('MessageBus.publish: 总线已关闭');
        }
        if (!(message instanceof AgentMessage)) {
            throw new Error('MessageBus.publish: 入参必须是 AgentMessage 实例');
        }

        this.#appendLog(message);
        this.#stats.published++;

        const targets = [...this.#subscribers.values()].filter((s) => message.matches(s.agentId));

        if (targets.length === 0) {
            this.#stats.undelivered++;
            this.#recordUndelivered(message, '无可匹配的订阅者');
            return { delivered: 0, skipped: 0, errors: 0 };
        }

        let delivered = 0;
        let skipped = 0;
        let errors = 0;

        for (const sub of targets) {
            // intent 级过滤：注册了白名单但本条不匹配 → 跳过（对发送方视为已投递但未处理）
            if (sub.intents && !sub.intents.has(message.intent)) {
                skipped++;
                continue;
            }
            delivered++;
            this.#stats.delivered++;
            this.#recordReplyFromHandler(message, sub, (err) => {
                errors++;
                this.#stats.handlerErrors++;
                if (this._onError) {
                    try { this._onError(err, message); } catch { /* 回调自身异常不外溢 */ }
                } else if (this._logger) {
                    this._logger('warn', `MessageBus: 角色 ${sub.agentId} 处理 ${message.id} 抛出 ${err?.message}`);
                }
            });
        }

        if (delivered === 0 && skipped > 0) {
            // 有订阅者但都因 intent 白名单跳过——这是配置问题，必须可见
            this.#stats.undelivered++;
            this.#recordUndelivered(message, `订阅者存在但 intent 白名单均不匹配（skipped=${skipped}）`);
        }

        return { delivered, skipped, errors };
    }

    /**
     * 调用单个订阅者并处理其返回值（异常隔离 + 在途追踪）。
     *
     * 刻意**不 await** 每个 handler：协作消息的语义是"通知已送达"，
     * 同步阻塞会让一个慢角色阻塞整个总线（Phase 3 的高并发下就是灾难）。
     * 需要等待结果的场景请用 `request()`。
     *
     * @param {AgentMessage} message
     * @param {{handler: Function, agentId: string}} sub
     * @param {(err: Error) => void} onError
     * @private
     */
    #recordReplyFromHandler(message, sub, onError) {
        let ret;
        try {
            ret = sub.handler(message);
        } catch (err) {
            onError(err);
            return;
        }

        if (ret && typeof ret.then === 'function') {
            const task = Promise.resolve(ret)
                .then((value) => { this.#dispatchHandlerReturn(value); })
                .catch((err) => { onError(err); })
                .finally(() => { this.#inflight.delete(task); });
            this.#inflight.add(task);
            return;
        }

        this.#dispatchHandlerReturn(ret);
    }

    /**
     * handler 返回值的统一分发：消息 → 继续投递；其他 → 忽略。
     * @param {*} value
     * @private
     */
    #dispatchHandlerReturn(value) {
        if (value === undefined || value === null) return;

        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
            if (item instanceof AgentMessage) {
                // fire-and-forget：应答消息的投递不应把调用方拖住（异常已在 publish 内隔离）
                this.publish(item).catch((err) => {
                    if (this._logger) this._logger('warn', `MessageBus: 转发 handler 应答失败 ${err?.message}`);
                });
            } else if (item && typeof item === 'object' && typeof item.intent === 'string') {
                this.send(item).catch((err) => {
                    if (this._logger) this._logger('warn', `MessageBus: 转发 handler 字面量应答失败 ${err?.message}`);
                });
            }
        }
    }

    // ─── 请求-响应 ─────────────────────────────────────────────────────────────

    /**
     * 发送请求并等待应答。
     *
     * 配对规则：应答消息的 `correlationId` 等于请求的 `correlationId`
     * （`AgentMessage.reply()` 会自动继承），且被 `acceptIntents` 接受。
     *
     * 先把 pending 登记好**再**发布消息——否则处理器足够快时应答会在登记前
     * 到达，请求方永远等不到（这是消息总线最经典的竞态，必须靠顺序消除）。
     *
     * @param {object} input - 同 `AgentMessage.create`
     * @param {object} [opts]
     * @param {string[]} [opts.acceptIntents] - 接受的应答 intent；缺省接受任意应答
     * @param {number} [opts.timeoutMs]       - 超时（默认 30000）
     * @param {string} [opts.description]     - 超时错误里的可读描述
     * @returns {Promise<AgentMessage>} 应答消息
     * @throws {Error} 入参非法 / pending 已满 / 总线关闭
     * @throws {MessageBusTimeoutError} 超时
     */
    async request(input, opts = {}) {
        if (this._closed) {
            throw new Error('MessageBus.request: 总线已关闭');
        }
        if (this.#pending.size >= this.maxPendingRequests) {
            throw new Error(
                `MessageBus.request: 在途请求已达上限 ${this.maxPendingRequests}，拒绝新的请求` +
                `（说明存在大量无人应答的 correlationId，请检查角色订阅是否缺失）`
            );
        }

        const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
            ? opts.timeoutMs
            : DEFAULT_REQUEST_TIMEOUT_MS;

        let acceptIntents = null;
        if (opts.acceptIntents !== undefined) {
            if (!Array.isArray(opts.acceptIntents) || opts.acceptIntents.length === 0) {
                throw new Error('MessageBus.request: acceptIntents 必须是非空数组');
            }
            acceptIntents = new Set(opts.acceptIntents);
        }

        const message = AgentMessage.create(input, { seq: this.#seq++, clock: this._clock });
        const correlationId = message.correlationId;
        const description = opts.description || message.brief();

        /** @type {Promise<AgentMessage>} */
        const promise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const pending = this.#pending.get(correlationId);
                if (!pending) return; // 已被 resolve 抢先处理
                this.#pending.delete(correlationId);
                this.#stats.requestsTimedOut++;
                reject(new MessageBusTimeoutError(correlationId, timeoutMs, description));
            }, timeoutMs);

            // Node 中不 unref：请求超时必须能真正触发，否则进程可能因为
            // 只剩这一个 timer 而提前退出（表现为"测试偶发挂住"）。
            this.#pending.set(correlationId, { resolve, reject, timer, acceptIntents, description });
        });

        this.#stats.requestsOpened++;

        try {
            await this.publish(message);
        } catch (err) {
            // 发布失败（如总线被关闭）：立刻释放 pending，不留悬挂的 timer
            const pending = this.#pending.get(correlationId);
            if (pending) {
                clearTimeout(pending.timer);
                this.#pending.delete(correlationId);
            }
            throw err;
        }

        return promise;
    }

    /**
     * 分派一条进来的消息给等待中的请求方（若有）。
     * @param {AgentMessage} message
     * @returns {boolean} 是否被某个 pending 请求消费
     * @private
     */
    #tryResolvePending(message) {
        if (!message.isReply) return false;

        const pending = this.#pending.get(message.correlationId);
        if (!pending) return false;
        if (pending.acceptIntents && !pending.acceptIntents.has(message.intent)) return false;

        clearTimeout(pending.timer);
        this.#pending.delete(message.correlationId);
        this.#stats.requestsResolved++;
        pending.resolve(message);
        return true;
    }

    // ─── 回放与可观测 ─────────────────────────────────────────────────────────

    /**
     * 追加到回放日志（有界）。
     *
     * 同时尝试满足等待中的请求——**日志先行**保证了"应答已被消费"也能在日志里看到；
     * 反之若先 resolve 再记日志，请求方拿到应答后立刻读日志会发现缺一条，
     * 回放就不可信了。
     *
     * @param {AgentMessage} message
     * @private
     */
    #appendLog(message) {
        this.#log.push(message.toJSON());
        if (this.#log.length > this.maxLogSize) {
            const overflow = this.#log.length - this.maxLogSize;
            this.#log.splice(0, overflow);
            this.#stats.logDropped += overflow;
        }
        this.#tryResolvePending(message);
    }

    /**
     * 记录未投递消息（有界环形保留）。
     * @param {AgentMessage} message
     * @param {string} reason
     * @private
     */
    #recordUndelivered(message, reason) {
        this.#undelivered.push({ id: message.id, from: message.from, to: message.to, intent: message.intent, reason });
        if (this.#undelivered.length > UNDELIVERED_KEEP) {
            this.#undelivered.splice(0, this.#undelivered.length - UNDELIVERED_KEEP);
        }
    }

    /**
     * 回放日志（按投递顺序，可直接 JSON 化）。
     *
     * 返回的是**深拷贝的纯对象数组**：调用方（如前端拓扑图接口）修改它
     * 不应该影响总线内部状态，否则"回放日志是可信事实源"这个前提就不成立了。
     *
     * @param {object} [opts]
     * @param {number} [opts.limit] - 只取最后 N 条
     * @returns {object[]}
     */
    getReplayLog(opts = {}) {
        const snapshot = this.#log.map((m) => structuredClone(m));
        if (Number.isInteger(opts.limit) && opts.limit > 0) {
            return snapshot.slice(-opts.limit);
        }
        return snapshot;
    }

    /**
     * 重建一次交互（同一 correlationId）的完整因果链。
     *
     * 这是"协作过程可 100% 由回放日志重建"的落地入口：
     * 给定任一 correlationId，返回按时间排序的全部相关消息。
     *
     * @param {string} correlationId
     * @returns {object[]}
     */
    deriveTrace(correlationId) {
        if (!correlationId) return [];
        return this.#log.filter((m) => m.correlationId === correlationId).map((m) => structuredClone(m));
    }

    /**
     * 从日志重建「谁跟谁说了什么」的有向边集合（前端 Agent 拓扑图的数据源）。
     *
     * **广播不展开成 N 条边**：`ARTIFACT_PUBLISHED` / `FINAL_REPORT` 这类广播是
     * 「公告」，不是与每个角色的定向交互。若把它展开成"发送方 → 每个已知角色"，
     * 拓扑图上会出现大量并不存在的交互边（5 个角色时一条广播就产生 4 条假边），
     * 让"谁跟谁真的有来往"这个关键信息被噪声淹没。
     * 因此广播单独统计在 `broadcasts` 里，不进入 `edges`。
     *
     * 数组 `to`（定向多人）**会**展开为多条边——那是调用方刻意的定向交互。
     *
     * @param {object} [opts]
     * @returns {{edges: Array<{from: string, to: string, count: number, intents: object}>,
     *            broadcasts: Array<{from: string, intent: string, count: number}>,
     *            nodes: string[]}}
     */
    deriveTopology(opts = {}) {
        const nodes = new Set();
        const edges = new Map();
        const bcasts = new Map();
        const seeds = Array.isArray(opts.agents) ? opts.agents : [];

        const addEdge = (from, to, intent) => {
            nodes.add(from);
            nodes.add(to);
            const key = `${from}\u0000${to}`;
            let e = edges.get(key);
            if (!e) {
                e = { from, to, count: 0, intents: {} };
                edges.set(key, e);
            }
            e.count++;
            e.intents[intent] = (e.intents[intent] || 0) + 1;
        };

        for (const a of seeds) nodes.add(a);

        for (const m of this.#log) {
            if (m.to === BROADCAST) {
                nodes.add(m.from);
                const key = `${m.from}\u0000${m.intent}`;
                const b = bcasts.get(key) || { from: m.from, intent: m.intent, count: 0 };
                b.count++;
                bcasts.set(key, b);
                continue;
            }
            const targets = Array.isArray(m.to) ? m.to : [m.to];
            for (const t of targets) addEdge(m.from, t, m.intent);
        }

        return {
            nodes: [...nodes],
            edges: [...edges.values()],
            broadcasts: [...bcasts.values()]
        };
    }

    /**
     * 未投递消息（最近 50 条）。
     * @returns {object[]}
     */
    getUndelivered() {
        return this.#undelivered.map((u) => ({ ...u }));
    }

    /**
     * 统计快照。
     * @returns {object}
     */
    getStats() {
        return {
            ...this.#stats,
            subscribers: this.#subscribers.size,
            subscriberIds: this.subscribers(),
            logSize: this.#log.length,
            maxLogSize: this.maxLogSize,
            pendingRequests: this.#pending.size,
            maxPendingRequests: this.maxPendingRequests,
            inflight: this.#inflight.size,
            closed: this._closed
        };
    }

    // ─── 生命周期 ─────────────────────────────────────────────────────────────

    /**
     * 等待在途 handler 任务结束。
     *
     * 对齐 F-04 的停机语义：编排被终止时，可能仍有角色正在处理消息
     * （例如 Coder 正在把修订结果写回黑板）。直接退出会丢掉这部分副作用。
     *
     * 实现为"轮询 + 超时"而非单纯 `Promise.allSettled([...#inflight])`：
     * handler 在其执行过程中可能**继续产生**新的在途任务，一次性快照会漏掉它们。
     *
     * @param {object} [opts]
     * @param {number} [opts.timeoutMs=10000] - 排空上限；到点即返回（`drained:false`）
     * @param {number} [opts.pollMs=20]
     * @returns {Promise<{drained: boolean, waitedMs: number, inflight: number}>}
     */
    async drain(opts = {}) {
        const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0 ? opts.timeoutMs : 10000;
        const pollMs = Number.isFinite(opts.pollMs) && opts.pollMs > 0 ? opts.pollMs : 20;
        const started = Date.now();

        while (this.#inflight.size > 0) {
            if (Date.now() - started >= timeoutMs) {
                return { drained: false, waitedMs: Date.now() - started, inflight: this.#inflight.size };
            }
            const batch = [...this.#inflight];
            await Promise.race([
                Promise.allSettled(batch),
                new Promise((r) => setTimeout(r, pollMs))
            ]);
        }

        return { drained: true, waitedMs: Date.now() - started, inflight: 0 };
    }

    /**
     * 关闭总线：拒绝新消息，清理所有 pending 请求（以错误 reject，不悬挂）。
     *
     * @param {object} [opts]
     * @param {number} [opts.timeoutMs] - 先排空在途任务
     * @returns {Promise<{drained: boolean, cancelledRequests: number}>}
     */
    async close(opts = {}) {
        const drained = await this.drain({ timeoutMs: opts.timeoutMs ?? 10000 });
        this._closed = true;

        let cancelled = 0;
        for (const [correlationId, pending] of this.#pending) {
            clearTimeout(pending.timer);
            this.#pending.delete(correlationId);
            const err = new Error(`MessageBus 关闭：请求未获应答（correlationId=${correlationId}）`);
            err.name = 'MessageBusClosedError';
            err.correlationId = correlationId;
            pending.reject(err);
            cancelled++;
        }

        return { drained: drained.drained, cancelledRequests: cancelled };
    }
}

export { MessageIntent, BROADCAST, SUPERVISOR_ID };
export default MessageBus;
