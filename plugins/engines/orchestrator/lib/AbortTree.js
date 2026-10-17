/**
 * ⚠️ 插件内副本：实现体逐字节来自 `Server/library/AbortTree.js`（**请同步维护两份**）。
 *
 * 为什么复制而不是接缝：它是**每实例状态**的纯数据结构（`Orchestrator` 的
 * `deps.abortTree || new AbortTree()`，见 `plugins/engines/orchestrator/Orchestrator.js`
 * 构造器），状态作用域按编排器隔离，两份副本不会互踩；而它没有任何"可替换的提供方"
 * 语义（不像 storage / llm 那样存在第二家实现），为它立接缝等于给一个内部容器
 * 造公开契约。同一判据见 `test/m8-plugin-kernel/f50-util-copies.test.mjs`
 * 对 `BoundedRegistry` 的处置（每实例状态 → 副本 + 漂移守卫）。
 * 本副本目前**没有**字节守卫覆盖（f50 的 F 组只比对 BoundedRegistry），
 * 债务已记在交付说明里。
 *
 * 文件零 import（只用内建 Promise/Object），因此复制不涉及路径换算。
 */

/**
 * AbortTree —— 可级联的取消树（Phase 3）
 *
 * 为什么需要它（Phase 1/2 的取消能力不够用）：
 *   Phase 1 的取消是"**平铺**"的：`Orchestrator.abort()` 遍历所有 RUNNING 节点，
 *   逐个调 `runner.controlExecution('abort')`。这有三个问题：
 *     1. **没有父子语义**：想只终止某一个步骤的子树（例如它的下游已经注定失败），
 *        做不到；只能全有或全无。
 *     2. **竞态**：遍历发生在某个时刻，此后的新增步骤不在遍历范围内——
 *        abort 之后仍会启动新步骤（Phase 1 只在若干检查点复查 `_aborted` 标志，
 *        而 `_aborted` 是编排器自身状态，不是步骤级状态）。
 *     3. **Phase 2 引入多 Agent 后放大**：一个步骤内有 5 个角色会话，
 *        来源（task → step → role → HTTP 请求）必须逐层可达，否则
 *        "终止任务"会留下 4 个孤儿会话继续烧 token。
 *
 *   本模块提供一棵**真正的树**：父节点被取消时，所有后代**同步**进入 aborted 状态
 *   （而不是等下一次轮询/检查点），且此后再派生的子节点会**立即**是 aborted 的。
 *
 * ## 语义保证（都有对应断言）
 *
 * | 保证 | 说明 |
 * |---|---|
 * | **向下传播** | `parent.abort()` → 全部后代 aborted（含多层） |
 * | **不向上传播** | 取消一个兄弟不影响其它兄弟，也不影响父 |
 * | **取消后新派生即死** | 父已 aborted 时 `createChild(parent)` 返回的节点 `aborted === true` |
 * | **幂等** | 重复 `abort()` 不重复触发回调 |
 * | **无监听器泄漏** | 节点可 `dispose()`，与父解绑；否则长生命周期父节点会累积监听器
 *   （Node 默认上限 10，超过会 warn——这正是本模块要避免的） |
 * | **原因可追溯** | 每个节点的 `reason` 记录"为什么被取消"（父级原因会向下透传） |
 *
 * @example
 * const tree = new AbortTree();
 * const task = tree.createRoot();
 * const step = tree.createChild(task);
 * const role = tree.createChild(step);
 * task.abort('用户终止任务');
 * role.signal.aborted === true;         // 同步为真，无需等待
 * role.reason === '用户终止任务';        // 原因向下透传
 */

/**
 * 取消树节点。
 */
export class AbortNode {
    /**
     * @param {object} opts
     * @param {AbortNode|null} opts.parent
     * @param {string} opts.label
     * @param {AbortTree} opts.tree
     * @param {string} [opts.reason]
     */
    constructor({ parent, label, tree, reason }) {
        /** @type {AbortController} 可直接交给 fetch / 会话适配器 */
        this.controller = new AbortController();
        /** @type {AbortNode|null} */
        this.parent = parent;
        /** @type {AbortNode[]} */
        this.children = new Set();
        this.label = label || 'node';
        this.tree = tree;

        /** @type {string|null} 取消原因（父级原因会向下透传） */
        this.reason = reason || null;
        /** @type {boolean} */
        this.aborted = false;
        /** @type {number} 创建时刻（ms） */
        this.createdAt = Date.now();
        /** @type {number|null} 取消时刻 */
        this.abortedAt = null;

        /** @type {((reason: string) => void)[]} 本节点的取消回调 */
        this._listeners = new Set();

        if (parent) {
            parent.children.add(this);
            // 父已取消 → 立即同步为取消态（"取消后新派生即死"）
            if (parent.aborted) {
                this.abort(parent.reason || '父节点已取消');
            }
        }
    }

    /** @returns {AbortSignal} 便捷访问 */
    get signal() {
        return this.controller.signal;
    }

    /**
     * 取消本节点及其全部后代。
     *
     * 向下传播**只经由 `children` 遍历**，不使用"父节点注册子回调"的间接方式。
     * 这条约束是被一个真实缺陷逼出来的：早先同时存在两条传播路径——
     * `parent._listeners` 里的子回调 + 这里的 `children` 循环——
     * 结果是父节点 abort 时子节点已被回调提前置为 aborted，
     * 随后的 `children` 循环对每个子节点都返回 0，**级联取消计数恒为 1**，
     * 而节点确实全被取消了。计数错会让可观测面板显示"只取消了 1 个节点"，
     * 掩盖真实的取消规模。单一传播路径同时消除了这类"两条路径语义漂移"的风险。
     *
     * @param {string} [reason] - 取消原因；缺省沿用已有原因或 '未说明'
     * @returns {number} 本次**新增**取消的节点数（含自身），幂等调用返回 0
     */
    abort(reason) {
        if (this.aborted) return 0;
        this.aborted = true;
        this.abortedAt = Date.now();
        this.reason = reason || this.reason || '未说明';

        // 先用 AbortController 广播（fetch 等原生消费者会立刻中断）
        try {
            this.controller.abort(this.reason);
        } catch { /* 已 abort 过 */ }

        let count = 1;
        // 本节点的用户回调（同层监听者）
        for (const fn of this._listeners) {
            try { fn(this.reason); } catch { /* 回调异常不外溢，避免一个坏监听者阻断整棵树 */ }
        }
        this._listeners.clear();

        // 向下级联（递归，深度即 task→step→role→request，实际不超过 5 层）
        for (const child of this.children) {
            count += child.abort(this.reason);
        }
        return count;
    }

    /**
     * 监听本节点的取消。
     * @param {(reason: string) => void} fn
     * @returns {() => void} 取消监听
     */
    onAbort(fn) {
        if (this.aborted) {
            try { fn(this.reason); } catch { /* 同上 */ }
            return () => {};
        }
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    /**
     * 从树上摘除本节点（**不取消**）。
     *
     * 必须调用的场景：长生命周期的父节点（如整个进程的 root）下反复派生子节点时，
     * 若从不摘除，`children` 会无界增长——这是比监听器泄漏更严重的内存问题。
     *
     * 注意根节点（无父）同样会被从登记表中移除：否则 `getStats().orphans`
     * 在任务结束后恒 ≥ 1，"孤儿数"这个泄漏指标就永远不为零、失去分辨力。
     *
     * @returns {boolean} 是否确实摘除了
     */
    dispose() {
        if (this.parent) {
            this.parent.children.delete(this);
            this.parent = null;
        }
        this.tree._live.delete(this);
        return true;
    }

    /**
     * 是否可继续工作（等价于 `!aborted`，语义更清楚）。
     * @returns {boolean}
     */
    get alive() {
        return !this.aborted;
    }

    /**
     * 摘要（可观测性 / 测试断言）。
     * @returns {object}
     */
    brief() {
        return {
            label: this.label,
            aborted: this.aborted,
            reason: this.reason,
            children: this.children.size,
            listeners: this._listeners.size,
            ageMs: (this.abortedAt || Date.now()) - this.createdAt
        };
    }
}

/**
 * 取消树管理器。
 *
 * 除了建树，它还负责**登记活跃节点**，使"是否存在孤儿会话"这类问题可被直接观测：
 * `getStats().live`、`getOrphans()`。
 */
export class AbortTree {
    constructor() {
        /** @type {AbortNode|null} */
        this.root = null;
        /** @type {Set<AbortNode>} 当前仍挂在树上的节点（不含已 dispose 的） */
        this._live = new Set();
        /** @type {number} 累计创建的节点数 */
        this._created = 0;
    }

    /**
     * 创建根节点（幂等：已有根且未被取消时直接返回）。
     * @param {string} [label]
     * @returns {AbortNode}
     */
    createRoot(label = 'root') {
        if (this.root && !this.root.aborted) return this.root;
        this.root = new AbortNode({ parent: null, label, tree: this });
        this._live.add(this.root);
        this._created++;
        return this.root;
    }

    /**
     * 创建子节点。
     *
     * @param {AbortNode} parent - 父节点（必填；没有父就用 `createRoot`）
     * @param {string} [label]
     * @returns {AbortNode}
     * @throws {Error} parent 非法
     */
    createChild(parent, label = 'child') {
        if (!(parent instanceof AbortNode)) {
            throw new Error('AbortTree.createChild: parent 必须是 AbortNode（无父节点请用 createRoot）');
        }
        const node = new AbortNode({ parent, label, tree: this });
        this._live.add(node);
        this._created++;
        return node;
    }

    /**
     * 取消整棵树。
     * @param {string} [reason]
     * @returns {number} 新增取消的节点数
     */
    abort(reason = '取消整棵树') {
        return this.root ? this.root.abort(reason) : 0;
    }

    /** @returns {boolean} */
    get aborted() {
        return !!(this.root && this.root.aborted);
    }

    /**
     * 仍未取消的节点（等价于"仍在途的工作单元"）。
     * @returns {AbortNode[]}
     */
    getLiveNodes() {
        return [...this._live].filter((n) => n.alive);
    }

    /**
     * 已取消但**尚未 dispose** 的节点。
     *
     * 这就是"孤儿"的定义：父级已放弃这部分工作，但持有者还没把它从树上摘掉。
     * 数量持续不降到 0 意味着有代码路径忘了 `dispose()`（内存与监听器都会漏）。
     *
     * @returns {AbortNode[]}
     */
    getOrphans() {
        return [...this._live].filter((n) => n.aborted);
    }

    /**
     * 统计快照。
     * @returns {object}
     */
    getStats() {
        const live = this.getLiveNodes();
        const orphans = this.getOrphans();
        const byLabel = {};
        for (const n of this._live) {
            byLabel[n.label] = (byLabel[n.label] || 0) + 1;
        }
        return {
            created: this._created,
            tracked: this._live.size,
            live: live.length,
            /** 孤儿会话候选：已取消但未从树上摘除 */
            orphans: orphans.length,
            orphanLabels: orphans.slice(0, 10).map((n) => n.label),
            byLabel,
            rootAborted: this.aborted
        };
    }

    /**
     * 清空登记（不取消）。
     *
     * 仅用于测试收尾与进程级重建；生产路径应让持有者 dispose，
     * 否则会掩盖真实的孤儿。
     */
    reset() {
        this._live.clear();
        this.root = null;
    }
}

export default AbortTree;
