/**
 * lib/BoundedRegistry.js —— 有界内存注册表（插件内副本 #2）
 *
 * 来源：`Server/library/BoundedRegistry.js`（实现体逐字节同源，仅本文件头不同）。
 * 现状：全仓库第 2 份（Server/library 一份、本插件一份）。
 *
 * 为什么是副本而不是接缝或跨插件 import：R2 禁止插件引用 `Server/`；`BoundedRegistry`
 * 是零依赖的通用容器（LRU + TTL + 淘汰保护），没有可替换的"提供方"语义，做成接缝等于
 * 为 288 行纯类引入插件目录 + 清单 + 拓扑依赖。它的**状态是每实例的**（`_map`/`_order`
 * 按实例隔离，不像 `AtomicJsonFile` 的 `_chains` 或 logger 的 `_stream` 那样指向共享
 * 资源），所以"两份副本"不会互踩，风险只剩代码静默分叉。
 *
 * 守卫：`test/m8-plugin-kernel/f50-util-copies.test.mjs` 目前未登记这一对路径（新增副本
 * 不会让它变红）；收口方向是把它也归一到 `core/`（`nowCST` 已按这条路进内核
 * `core/cstTime.js`）或做成 util 小插件，需要 `test/` 或 `Server/library/**` 的边界，
 * 不在本片范围内。改一份请同步另一份。
 *
/**
 * BoundedRegistry —— 有界内存注册表（LRU + TTL + 淘汰保护）
 *
 * 解决的问题：进程内以 `Map` 缓存的对象（编排器实例、拆解计划、FlexRunner 实例）
 * 只增不减——每个新任务都 `set` 一条，而"任务结束"的路径往往只释放重型引用、
 * 不删条目。长生命周期服务（Web 进程常驻数周）下内存随"历史任务总数"单调增长，
 * 且没有任何上限。本类为这类缓存提供统一的有界容器。
 *
 * 语义（有意保持简单，不做无关抽象）：
 *   - **上限**：`max` 条。超出后淘汰最久未使用的条目；上限不可突破。
 *   - **LRU**：`get` / `has`（命中时）刷新最后使用时间；`peek` 只看不刷新。
 *   - **淘汰保护**：`isProtected(key, value)` 返回 true 的条目不会被上限淘汰。
 *     用于"绝不能踢掉正在运行的实例"这类语义——宁可暂时超过上限，也不能
 *     把一个 RUNNING 对象从注册表里踢掉（那会让调用方拿不到它、也无法终止它）。
 *   - **TTL**：可选的惰性过期（在读路径上清理），不启动后台定时器
 *     （定时器既难测试，又会在进程退出时留下悬挂引用）。
 *   - **淘汰回调**：`onEvict(key, value)`，让持有者可在此处释放资源/记录日志。
 *
 * 关键取舍：淘汰按"最久未使用"顺序尝试，遇到受保护条目就跳过并继续看下一条；
 * 若所有条目都受保护，则放弃淘汰（上限被暂时突破）而不是错误地驱逐活跃对象。
 *
 * @example
 * const registry = new BoundedRegistry({
 *     max: 50,
 *     onEvict: (key, value) => value.dispose(),
 *     isProtected: (_key, value) => value.status === 'running',
 * });
 * registry.set('t1', orch);
 * registry.get('t1');   // 刷新 LRU
 * registry.stats();     // { size, max, ttlMs, evicted, skipped, protected }
 */
export class BoundedRegistry {
    /**
     * @param {object} [opts]
     * @param {number} [opts.max=100]                  - 上限条数（≤0 视为 1）
     * @param {number} [opts.ttlMs=0]                  - 条目存活时长（ms）；0 = 不过期
     * @param {((key: string, value: any) => void)|null} [opts.onEvict=null]
     *        - 淘汰/清空回调（上限淘汰、TTL 过期、clear 触发；显式 delete 不触发）
     * @param {((key: string, value: any) => boolean)|null} [opts.isProtected=null]
     *        - 淘汰保护判定；返回 true 表示该条目不得被上限淘汰
     */
    constructor({ max = 100, ttlMs = 0, onEvict = null, isProtected = null } = {}) {
        /** @type {Map<string, any>} key → value */
        this._map = new Map();
        /** @type {Map<string, number>} key → 最后使用时间戳（Epoch ms），供 LRU/TTL 判定 */
        this._touchedAt = new Map();
        /** @type {number} 上限条数 */
        this._max = Math.max(1, Number(max) || 1);
        /** @type {number} TTL（ms），0 = 不过期 */
        this._ttlMs = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : 0;
        this._onEvict = typeof onEvict === 'function' ? onEvict : null;
        this._isProtected = typeof isProtected === 'function' ? isProtected : null;
        /** @type {number} 累计淘汰数（含 TTL 过期） */
        this._evicted = 0;
        /** @type {number} 因"全部受保护"而放弃淘汰的次数（可观测：说明上限偏紧） */
        this._skipped = 0;
    }

    /** 当前条目数 @returns {number} */
    get size() { return this._map.size; }
    /** 上限条数 @returns {number} */
    get max() { return this._max; }

    /**
     * 写入并（必要时）执行淘汰。
     *
     * 注意：先写入再 `_sweep()`，因此 `isProtected` 能看到刚落库的最新对象状态
     * （如 `status` 刚被置为终态），判定结果与调用方意图一致。
     *
     * @param {string} key
     * @param {any} value
     * @returns {this}
     */
    set(key, value) {
        const k = String(key);
        this._map.delete(k);            // 先删后写：Map 的插入顺序即 LRU 顺序（末尾最新）
        this._map.set(k, value);
        this._touchedAt.set(k, Date.now());
        this._sweep();
        return this;
    }

    /**
     * 读取并刷新 LRU 顺序。
     * @param {string} key
     * @returns {any} 条目值；不存在返回 undefined
     */
    get(key) {
        const k = String(key);
        if (!this._map.has(k)) return undefined;
        const value = this._map.get(k);
        this._markUsed(k);
        return value;
    }

    /**
     * 读取但不刷新 LRU 顺序（用于"仅探测"场景，避免查看动作影响淘汰顺序）。
     * @param {string} key
     * @returns {any}
     */
    peek(key) {
        return this._map.get(String(key));
    }

    /**
     * 是否存在；命中时刷新 LRU（与 get 保持一致，避免"刚检查过却仍被淘汰"的意外）。
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        const k = String(key);
        if (!this._map.has(k)) return false;
        this._markUsed(k);
        return true;
    }

    /**
     * 显式删除（不触发 onEvict，因为调用方已自己负责收尾）。
     * @param {string} key
     * @returns {boolean} 是否确实删除了条目
     */
    delete(key) {
        const k = String(key);
        const existed = this._map.delete(k);
        this._touchedAt.delete(k);
        return existed;
    }

    /**
     * 清空（逐条触发 onEvict，保证持有者能释放资源）。
     * @returns {void}
     */
    clear() {
        for (const [key, value] of Array.from(this._map.entries())) {
            this._evict(key, value);
        }
        this._map.clear();
        this._touchedAt.clear();
    }

    /**
     * 迭代条目（不刷新 LRU，避免遍历本身就是一次"使用"）。
     * @returns {IterableIterator<[string, any]>}
     */
    entries() {
        return this._map.entries();
    }

    /** @returns {IterableIterator<string>} */
    keys() { return this._map.keys(); }

    /** @returns {IterableIterator<any>} */
    values() { return this._map.values(); }

    /** 支持 `for (const [key, value] of registry)` 直接遍历 */
    [Symbol.iterator]() {
        return this._map[Symbol.iterator]();
    }

    /**
     * 清理已过 TTL 的条目（set 路径会自动顺带清理；此处供显式/定期调用）。
     * @returns {number} 本次清理条数
     */
    pruneExpired() {
        const now = Date.now();
        let removed = 0;
        for (const key of Array.from(this._map.keys())) {
            if (!this._isExpired(key, now)) continue;
            this._evict(key, this._map.get(key));
            removed++;
        }
        return removed;
    }

    /**
     * 当前状态快照（供 HTTP 统计接口 / 测试观测）。
     * @returns {{size: number, max: number, ttlMs: number, evicted: number, skipped: number, protected: number}}
     */
    stats() {
        let protectedCount = 0;
        if (this._isProtected) {
            for (const [key, value] of this._map) {
                if (this._isProtected(key, value)) protectedCount++;
            }
        }
        return {
            size: this._map.size,
            max: this._max,
            ttlMs: this._ttlMs,
            evicted: this._evicted,
            skipped: this._skipped,
            protected: protectedCount,
        };
    }

    // ─── 内部 ────────────────────────────────────────────────────────────

    /**
     * 执行一轮淘汰：先清 TTL 过期，再按 LRU（最后使用时间最早者优先）淘汰至不超过上限。
     * @private
     */
    _sweep() {
        this.pruneExpired();

        // 最多淘汰到本次写入前的条目数：每次成功淘汰才递减，
        // 确保循环次数有界且绝不多淘汰一个（guard 只在 _evict 之后自减）。
        let guard = this._map.size;
        while (this._map.size > this._max && guard > 0) {
            const target = this._pickLruVictim();
            if (target === null) {
                // 全部条目都受保护：宁可比上限多留一会儿，也不能踢掉活跃对象
                this._skipped++;
                return;
            }
            this._evict(target, this._map.get(target));
            guard--;
        }
    }

    /**
     * 选出最久未使用且未受保护的 key。
     *
     * LRU 顺序由 Map 的插入顺序承载（末尾 = 最近使用，见 _markUsed），
     * 因此"第一个未被保护的条目"就是最久未使用的那一个。
     *
     * 必须在**每次淘汰之后**重新调用（而不是一次挑出多个候选）：淘汰会改变
     * 剩余条目集合与保护状态，一次挑多个会把刚写入的新条目当成旧条目误删。
     * 用时间戳比较做不到这一点——同一毫秒内写入的条目时间戳相同，
     * 无法区分先后（这正是本类曾出现"新条目被当成 LRU 受害者淘汰"的原因）。
     *
     * @returns {string|null} 可淘汰的 key；全部受保护时返回 null
     * @private
     */
    _pickLruVictim() {
        for (const [key, value] of this._map) {
            if (this._isProtected && this._isProtected(key, value)) continue;
            return key;
        }
        return null;
    }

    /**
     * 把 key 标记为"最近使用"（移到 Map 末尾）。
     * @param {string} key
     * @private
     */
    _markUsed(key) {
        const value = this._map.get(key);
        if (value === undefined) return;
        this._map.delete(key);
        this._map.set(key, value);
        this._touchedAt.set(key, Date.now());   // TTL 以"最后使用"为起点续期
    }

    /**
     * 删除条目并触发 onEvict。回调异常不能中断淘汰流程（否则注册表会卡在超限状态）。
     * @param {string} key
     * @param {any} value
     * @private
     */
    _evict(key, value) {
        this._map.delete(key);
        this._touchedAt.delete(key);
        this._evicted++;
        if (this._onEvict) {
            try {
                this._onEvict(key, value);
            } catch {
                // 淘汰回调失败不应影响注册表自身的一致性
            }
        }
    }

    /**
     * 判断条目是否已过 TTL。
     * @param {string} key
     * @param {number} now
     * @returns {boolean}
     * @private
     */
    _isExpired(key, now) {
        if (this._ttlMs <= 0) return false;
        const at = this._touchedAt.get(key);
        return at != null && now - at >= this._ttlMs;
    }
}

export default BoundedRegistry;
