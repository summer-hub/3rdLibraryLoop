/**
 * Context.js — 插件上下文：服务注册/消费 + 类型化事件 + 可逆作用域
 *
 * 这是「一切皆插件」的操作核心，对应 Cordis 的 Context：
 *
 *   1. **服务（provide / inject）**：插件向上下文注册服务，其他插件按名消费。
 *      服务名即"能力接缝"（seam）。同一接缝可有多个提供方：
 *        - 裸名 `ai-cli`        → 当前生效的提供方（后注册者生效，重复注册会告警）；
 *        - 限定名 `ai-cli@cli/opencode` → 指定提供方，永远可达。
 *      消费者只依赖裸名，因此**替换提供方不需要改消费者**。
 *
 *   2. **类型化事件（on / emit）**：扩展点以事件暴露，两种处理模式：
 *        - serial（默认）：各监听者按注册顺序收到同一 payload，结果汇总为数组；
 *        - waterfall：后一个监听者收到前一个的返回值（用于管道式改写）。
 *
 *   3. **可逆效果（addDisposer / dispose）**：setup 内登记的一切（服务、监听、
 *      临时资源）都能被逆序回收——插件禁用/热替换后不残留状态。
 */

/** 事件处理模式 */
export const EventMode = Object.freeze({
    SERIAL: 'serial',
    WATERFALL: 'waterfall',
});

export class PluginContext {
    /**
     * @param {object} opts
     * @param {string} opts.name        - 上下文所属（插件名，根上下文为 'root'）
     * @param {PluginContext|null} [opts.parent] - 父上下文（插件上下文指向宿主根上下文）
     * @param {boolean} [opts.scoped]   - 是否为 `scope()` 创建的作用域上下文（服务写私有表）
     * @param {object} [opts.config]    - 已合并 profile/env 的插件配置
     * @param {Map<string, {service: *, provider: string}>} [opts.services] - 服务注册表（根持有，子共享）
     * @param {Map<string, Array<{handler: Function, mode: string, owner: string}>>} [opts.listeners] - 事件监听表（根持有）
     * @param {(msg: string) => void} [opts.logger]
     */
    constructor({ name, parent = null, scoped = false, config = {}, services = null, listeners = null, logger = null }) {
        this._name = name;
        this._parent = parent;
        // 是否作用域上下文：只有 scope() 会置 true。**不能用 parent 是否存在来推断**——
        // 宿主给每个插件上下文都设了 parent，那样会让插件互相看不见。
        this._scoped = scoped === true;
        this.config = Object.freeze({ ...config });
        // 服务与监听表由根上下文持有、全树共享（对应 Cordis 的共享 context）；
        // 插件私有作用域用 scope() 创建（服务写 _scopedServices 隔离）。
        this._services = services ?? new Map();
        this._listeners = listeners ?? new Map();
        this._scopedServices = new Map();
        this._disposers = [];
        this._disposed = false;
        this._log = logger ?? (() => {});
    }

    get name() { return this._name; }
    get parent() { return this._parent; }
    get disposed() { return this._disposed; }

    // ─── 服务 ────────────────────────────────────────────────────────────────

    /**
     * 注册服务（能力接缝的实现）。
     * @param {string} serviceName - 接缝名（如 `ai-cli`）
     * @param {*} service          - 服务本体（对象/类/工厂函数均可，由消费者约定）
     */
    provide(serviceName, service) {
        this._assertLive();
        if (typeof serviceName !== 'string' || serviceName.length === 0) {
            throw new TypeError('provide(serviceName, service)：serviceName 必须为非空字符串');
        }
        if (service === undefined) {
            throw new TypeError(`provide('${serviceName}')：service 不能为 undefined`);
        }
        // 作用域上下文（scope() 创建）写私有表 —— "不想暴露成公共接缝"的内部协作；
        // 普通插件上下文写全树共享表 —— 跨插件 inject 的基础。
        const table = this._scoped ? this._scopedServices : this._services;
        const namespaced = `${serviceName}@${this._name}`;
        table.set(namespaced, { service, provider: this._name });
        if (table.has(serviceName)) {
            const prev = table.get(serviceName);
            if (prev.provider !== this._name) {
                this._log(`[plugin:${this._name}] 接缝 '${serviceName}' 原提供方 ${prev.provider} 被覆盖`);
            }
        }
        table.set(serviceName, { service, provider: this._name });
        this.addDisposer(() => {
            // 逆序回收：先删限定名；裸名仅当仍指向本插件时才删，
            // 避免误删后来者（同插件重复 provide 或热替换场景）。
            // 必须删**注册时那张表**，删错表会留下幽灵服务或误伤父作用域的接缝。
            table.delete(namespaced);
            const cur = table.get(serviceName);
            if (cur && cur.provider === this._name) table.delete(serviceName);
        });
    }

    /**
     * 消费服务。
     * @param {string} serviceName - 接缝名或限定名 `seam@plugin`
     * @returns {*} 服务本体
     * @throws 服务不存在时抛出带可用清单的错误（fail closed，不返回 undefined）
     */
    inject(serviceName) {
        const hit = this._services.get(serviceName) ?? this._scopedServices.get(serviceName);
        if (!hit) {
            const available = [...this._services.keys()].sort().join(', ') || '（无）';
            throw new Error(
                `服务 '${serviceName}' 不存在（消费者: ${this._name}）。已注册: ${available}`
            );
        }
        return hit.service;
    }

    /** 判断服务是否存在（不抛错） */
    has(serviceName) {
        return this._services.has(serviceName) || this._scopedServices.has(serviceName);
    }

    /** 列出当前已注册的服务名（供 `plugin list` / 调试） */
    listServices() {
        return [...this._services.keys()].sort();
    }

    // ─── 类型化事件 ──────────────────────────────────────────────────────────

    /**
     * 监听类型化事件。
     * @param {string} eventName
     * @param {Function} handler - serial: `(payload) => any`；waterfall: `(prev) => next`
     * @param {{ mode?: 'serial'|'waterfall' }} [opts]
     */
    on(eventName, handler, { mode = EventMode.SERIAL } = {}) {
        this._assertLive();
        if (typeof eventName !== 'string' || !eventName) {
            throw new TypeError('on(eventName, handler)：eventName 必须为非空字符串');
        }
        if (typeof handler !== 'function') {
            throw new TypeError(`on('${eventName}')：handler 必须为函数`);
        }
        if (mode !== EventMode.SERIAL && mode !== EventMode.WATERFALL) {
            throw new Error(`on('${eventName}')：mode 仅支持 serial / waterfall，收到 ${mode}`);
        }
        const entry = { handler, mode, owner: this._name };
        const list = this._listeners.get(eventName) ?? [];
        list.push(entry);
        this._listeners.set(eventName, list);
        this.addDisposer(() => {
            const cur = this._listeners.get(eventName);
            if (!cur) return;
            const idx = cur.indexOf(entry);
            if (idx >= 0) cur.splice(idx, 1);
            if (cur.length === 0) this._listeners.delete(eventName);
        });
    }

    /**
     * 发射类型化事件。
     * @param {string} eventName
     * @param {*} [payload]
     * @param {{ mode?: 'serial'|'waterfall' }} [opts] - 缺省时按各监听者登记的模式处理
     * @returns {Promise<any[]>|Promise<any>} serial: 结果数组；waterfall: 最终值
     */
    async emit(eventName, payload, { mode = null } = {}) {
        const list = this._listeners.get(eventName);
        if (!list || list.length === 0) return mode === EventMode.WATERFALL ? payload : [];
        if (mode === EventMode.WATERFALL || (mode === null && list.every((e) => e.mode === EventMode.WATERFALL))) {
            let acc = payload;
            for (const entry of list) acc = await entry.handler(acc);
            return acc;
        }
        const out = [];
        for (const entry of list) out.push(await entry.handler(payload));
        return out;
    }

    // ─── 作用域与生命周期 ────────────────────────────────────────────────────

    /**
     * 创建插件私有作用域（子上下文）。
     * 私有服务只在子作用域内可见，用于"不想暴露成公共接缝"的内部协作。
     */
    scope(subName = 'scope') {
        const child = new PluginContext({
            name: `${this._name}:${subName}`,
            parent: this,
            scoped: true,
            services: this._services,
            listeners: this._listeners,
            logger: this._log,
        });
        this.addDisposer(() => child._dispose());
        return child;
    }

    /** 登记回收钩子（插件禁用/热替换时逆序执行） */
    addDisposer(fn) {
        this._assertLive();
        if (typeof fn !== 'function') {
            throw new TypeError('addDisposer(fn)：fn 必须为函数');
        }
        this._disposers.push(fn);
    }

    /**
     * 回收本上下文登记的一切（逆序）。
     * 单个 disposer 抛错不中断其余回收，最终汇总抛出（避免半死状态）。
     */
    async _dispose() {
        if (this._disposed) return;
        this._disposed = true;
        const errors = [];
        for (const fn of this._disposers.reverse()) {
            try {
                await fn();
            } catch (err) {
                errors.push(err);
            }
        }
        this._disposers = [];
        this._scopedServices.clear();
        if (errors.length > 0) {
            throw new Error(
                `上下文 ${this._name} 回收时 ${errors.length} 个 disposer 失败: ` +
                errors.map((e) => e.message).join('; ')
            );
        }
    }

    _assertLive() {
        if (this._disposed) {
            throw new Error(`上下文 ${this._name} 已回收，不能再注册/监听（可逆效果只允许一次生命周期）`);
        }
    }
}

export default PluginContext;
