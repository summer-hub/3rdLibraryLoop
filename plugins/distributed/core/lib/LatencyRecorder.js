/**
 * plugins/distributed/core/lib/LatencyRecorder.js —— LatencyRecorder 的**插件内副本**（实现体逐字节同源）
 *
 * 来源：`Server/library/LatencyRecorder.js`。本文件 = 本说明头 + **与源文件逐字节相同的实现体**，
 * 沿用 m8 `f50-util-copies` G 组既有的处置判据（副本 = 说明头 + indexOf(源文件全量) 命中）。
 *
 * 为什么是副本、不是接缝、也不是归一进 `core/`：
 *   - 有**每实例状态**：每个实例持有自己的环形缓冲（`_buf`/`_size`/`_next`/`_count`/`_sum`…），
 *     不能像 `nowCST`（16 行无状态纯函数）那样归一进内核 `core/cstTime.js`；
 *   - 状态作用域不重叠：`DistributedSemaphore` 每个实例各持一个 `waitRecorder`，没有跨实例
 *     共享资源（不同于 logger 的 `_stream` 指向同一文件），两份实例不会互相干扰；
 *   - 没有"第二家提供方"语义：不会有人拿别的分位数实现替换它，立接缝只增加加载失败路径。
 *
 * 这是全仓库第 3 份副本（`plugins/agent/core/lib/LatencyRecorder.js` 是第 2 份）。迁移后
 * `Server/library/LatencyRecorder.js` 在本仓库已**没有消费者**（唯一消费者是本插件的
 * `Semaphore.js`），但本次边界不得改 `Server/library/`，故保留并在此记录，见交付说明。
 *
 * 消费者：`Semaphore.js`（`waitRecorder`，令牌等待时延采样）。
 */

/**
 * LatencyRecorder —— 有界延迟采样与分位数（Phase 3）
 *
 * 为什么需要一个专门的采样器，而不是"只记平均耗时"：
 *   并发系统的问题几乎从不体现在平均值上。**平均等待 120ms、P95 等待 14 分钟**
 *   是完全正常的组合——前者掩盖了"1/20 的会话在饿死"这个真实故障。
 *   因此 Phase 3 的所有并发指标（排队等待、槽位持有）都必须以 P95/P99 呈现。
 *
 * 设计要点：
 *   - **内存有界**：固定容量环形缓冲（默认 2048 个样本）。压测 500 并发步骤时
 *     每次会话都会产生样本，无界数组会直接把内存吃光——这正是它要防的那类问题。
 *   - **不落盘、不聚合**：只保留最近 N 个样本，`percentile()` 在样本上直接计算。
 *     对"最近是否有劣化"足够敏感，且实现可验证（不依赖近似算法）。
 *   - **零依赖**：分位数用最邻近秩（nearest-rank），与常用监控口径一致且无歧义。
 *
 * 注意（诚实边界）：环形缓冲意味着分位数是**近期窗口**的统计，不是全历史。
 * 需要全历史时应接真实监控系统（Phase 4 的 OTel），而不是把这个类做成数据库。
 */

/** 默认样本容量 */
export const DEFAULT_CAPACITY = 2048;

export class LatencyRecorder {
    /**
     * @param {object} [opts]
     * @param {number} [opts.capacity=2048]
     * @param {string} [opts.name='latency']
     */
    constructor(opts = {}) {
        this.capacity = Number.isInteger(opts.capacity) && opts.capacity > 0
            ? opts.capacity
            : DEFAULT_CAPACITY;
        this.name = opts.name || 'latency';
        /** @type {number[]} 环形缓冲 */
        this._buf = new Array(this.capacity);
        this._size = 0;
        this._next = 0;
        /** 累计统计（不受环形缓冲容量影响，用于总量核对） */
        this._count = 0;
        this._sum = 0;
        this._min = Infinity;
        this._max = -Infinity;
    }

    /**
     * 记录一个样本（ms）。
     * @param {number} ms
     */
    record(ms) {
        if (!Number.isFinite(ms) || ms < 0) return;
        this._buf[this._next] = ms;
        this._next = (this._next + 1) % this.capacity;
        if (this._size < this.capacity) this._size++;
        this._count++;
        this._sum += ms;
        if (ms < this._min) this._min = ms;
        if (ms > this._max) this._max = ms;
    }

    /**
     * 取分位数（nearest-rank）。
     *
     * @param {number} p - 0~1，如 0.95
     * @returns {number} 无样本时返回 0
     */
    percentile(p) {
        if (this._size === 0) return 0;
        const sorted = this._samples().sort((a, b) => a - b);
        const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
        return sorted[rank];
    }

    /** @returns {number[]} 当前窗口内的样本（副本） */
    _samples() {
        if (this._size === 0) return [];
        if (this._size < this.capacity) return this._buf.slice(0, this._size);
        // 环形缓冲已满：按时间顺序还原
        return [...this._buf.slice(this._next), ...this._buf.slice(0, this._next)];
    }

    /**
     * 统计快照。
     * @returns {{name: string, count: number, windowSize: number, capacity: number,
     *   avg: number, min: number, max: number, p50: number, p95: number, p99: number}}
     */
    stats() {
        return {
            name: this.name,
            count: this._count,
            windowSize: this._size,
            capacity: this.capacity,
            avg: this._count ? Math.round(this._sum / this._count) : 0,
            min: this._count ? this._min : 0,
            max: this._count ? this._max : 0,
            p50: this.percentile(0.5),
            p95: this.percentile(0.95),
            p99: this.percentile(0.99)
        };
    }

    /** 是否**从未**有样本 */
    get empty() {
        return this._count === 0;
    }

    /** 清空（测试用；生产不建议调用，否则会丢掉劣化的证据） */
    reset() {
        this._buf = new Array(this.capacity);
        this._size = 0;
        this._next = 0;
        this._count = 0;
        this._sum = 0;
        this._min = Infinity;
        this._max = -Infinity;
    }
}

export default LatencyRecorder;
