/**
 * plugins/agent/core/lib/AtomicJsonFile.js —— AtomicJsonFile 的**第 4 份副本**（实现体逐字节同源）
 *
 * 来源与守卫：
 *   源实现 `plugins/storage/core/lib/AtomicJsonFile.js`；本文件 = 本说明头 + **与源文件
 *   逐字节相同的实现体**（sha 可核对）。这是 m8 `f50-util-copies` E 组既有的处置方式
 *   （`AtomicJsonFile` 已有 3 份：storage/core、stats/core、engines/knowledge），
 *   本片把 `Server/Agent/Blackboard` 迁进插件后需要第 4 份。
 *
 * 为什么是「副本 + 字节守卫」而不是接缝或跨插件 import：
 *   架构守卫 R2 只允许插件引用 `node:` / npm 包 / `core/` / `seams/` / 自身插件目录，
 *   跨插件 import 被明令禁止。而它没有"可替换的提供方"语义（不是能力，是写文件的工具），
 *   为它立一条接缝要连带插件清单、拓扑依赖与加载失败路径 —— 对 200 行纯工具过重。
 *   判据与既有副本一致：`_chains`（按路径的 promise 链）是**每路径**状态，Blackboard 只锁
 *   自己的 `board/blackboard.json`，不与 storage/stats/knowledge 的路径重叠，因此
 *   "两份实例各排各的队"不会互踩；真正的风险只剩「改一份忘另一份」的静默分叉，
 *   由「实现体逐字节相同」这条守卫压掉。
 *
 * 消费者：`Blackboard/Blackboard.js`（`readJson` / `writeJsonAtomic` / `withSerializedLock`）。
 * `Blackboard` 的 `Board` 写入路径与其它三方全部不同，故本副本不会把并发语义改坏。
 */

/**
 * AtomicJsonFile —— 原子写 + 进程内串行化的 JSON 文件工具
 *
 * 为什么需要它（F-14 / F-15）：
 *   项目里多处用「读整个 JSON → 改一个字段 → 写回整个 JSON」的模式维护**单文件
 *   登记表**（统计数据 `db/web/visit-stats.json`、知识索引 `db/Knowledge/index.json`）。
 *   这种 read-modify-write 在并发下有两个独立缺陷：
 *     1. **丢更新**：A 与 B 同时读到同一份快照，各自 +1 后写回，最终只 +1。
 *        并行 FlexRunner（并发上限默认 50）登记经验时会真实触发。
 *     2. **文件损坏**：`fs.writeFile` 是「O_TRUNC 后写」，两个写入交错会让读者
 *        看到被截断的内容；解析失败后调用方通常静默降级，表现为"数据莫名清零"。
 *
 * 本模块提供两个保证：
 *   - `writeJsonAtomic`：先写临时文件再 `rename` 覆盖。`rename` 在同一文件系统内
 *     是原子的，读端要么看到旧文件、要么看到完整新文件（与 JsonAdapter 的做法
 *     一致——此前只有 JsonAdapter 这么做，其他写入点没有统一）。
 *   - `updateJson`：按文件路径串行化的 read-modify-write。同一路径的多次调用会
 *     排队执行，且**在锁内重新读取最新快照**，因此不会丢更新。
 *
 * 注意：串行化是**进程内**的（promise 链）。跨进程并发写同一文件仍会互相覆盖，
 * 那属于 Phase 4 的分布式协调范畴（见 docs/ROADMAP.md），此处不假装解决。
 */

import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

/** @type {Map<string, Promise<any>>} 每个键一条串行链（文件路径或业务锁名） */
const _chains = new Map();

/**
 * 可重试的 rename 错误码。
 *
 * Windows 上 `rename` 覆盖一个正被其它句柄打开的目标文件会失败
 * （EPERM/EBUSY/EACCES），而读取方（另一个 await、另一个进程、杀毒扫描）
 * 完全可能恰好持有句柄。实测在"并发写 + 并发读同一 JSON"时稳定复现，
 * 表现为偶发丢更新。POSIX 下 rename 是原子的且不会这样失败，
 * 因此这是**只在 Windows 出现、但会静默丢数据**的问题。
 * 处理方式：短退避重试；重试次数用尽才向上抛。
 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

/**
 * 带退避重试的 rename（见 RENAME_RETRY_CODES 说明）。
 *
 * 导出供其它需要"原子替换"的模块复用（如 DbUse/adapters/JsonAdapter）。
 *
 * @param {string} tmp
 * @param {string} dest
 * @param {number} [attempts=12]
 */
export async function renameWithRetry(tmp, dest, attempts = 12) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
        try {
            await fs.rename(tmp, dest);
            return;
        } catch (err) {
            lastErr = err;
            if (!RENAME_RETRY_CODES.has(err.code)) throw err;
            // 线性退避：5ms, 10ms, 15ms … 累计约 400ms
            await new Promise((r) => setTimeout(r, 5 * (i + 1)));
        }
    }
    throw lastErr;
}

/**
 * 原子写 JSON：临时文件 + rename 覆盖。
 *
 * @param {string} filePath - 目标文件绝对路径
 * @param {any} data - 任意可 JSON 序列化的值
 * @param {object} [opts]
 * @param {number} [opts.indent=2] - 缩进（0 表示紧凑输出）
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(filePath, data, opts = {}) {
    const indent = opts.indent === undefined ? 2 : opts.indent;
    const json = indent ? JSON.stringify(data, null, indent) : JSON.stringify(data);
    await fs.mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    try {
        await fs.writeFile(tmp, json, 'utf8');
        await renameWithRetry(tmp, filePath);
    } catch (err) {
        // 清理残留临时文件，避免堆积
        await fs.unlink(tmp).catch(() => {});
        throw err;
    }
}

/**
 * 读取 JSON；文件不存在或内容损坏时返回 fallback。
 *
 * 损坏时返回 fallback 而非抛错是刻意的：调用方（统计/索引）不应因一次损坏就
 * 炸掉业务流程，但会通过 onCorrupt 回调留下痕迹便于发现。
 *
 * @param {string} filePath
 * @param {any} [fallback=null]
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.onCorrupt] - 内容损坏时的回调（ENOENT 不触发）
 * @returns {Promise<any>}
 */
export async function readJson(filePath, fallback = null, opts = {}) {
    let raw;
    try {
        raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw err;
    }
    if (!raw.trim()) return fallback;
    try {
        return JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (err) {
        opts.onCorrupt?.(`JSON 解析失败 ${filePath}: ${err.message}`);
        return fallback;
    }
}

/**
 * 在指定键上串行执行 fn（FIFO）。前一次无论成功或失败，后一次都会继续排队
 * ——否则一次失败会永久打断该键的所有后续操作。
 *
 * @template T
 * @param {string} key - 锁标识（文件路径或业务锁名）
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function _serialized(key, fn) {
    const fullKey = resolve(key);
    const prev = _chains.get(fullKey) ?? Promise.resolve();
    const chain = prev.then(fn, fn);
    // 登记的是「吞掉异常」的包装：它只用于排队，不替调用方处理错误
    const registered = chain.catch(() => {});
    _chains.set(fullKey, registered);
    try {
        return await chain;
    } finally {
        // 仅当没有新的排队者接替登记项时才清理，避免 Map 无界增长
        if (_chains.get(fullKey) === registered) _chains.delete(fullKey);
    }
}

/**
 * 串行化的 read-modify-write。
 *
 * `mutator` 在锁内被调用，入参是**当前磁盘上的最新值**（每次都在锁内重新读取），
 * 返回下一个要写入的值；返回 `undefined` 表示放弃本次写入（不落盘）。
 *
 * @template T
 * @param {string} filePath
 * @param {(current: T) => T|Promise<T|undefined>} mutator
 * @param {object} [opts]
 * @param {T} [opts.fallback] - 文件不存在时的初始值
 * @param {number} [opts.indent=2]
 * @returns {Promise<T>} 写入后的值（放弃写入时返回当前值）
 */
export async function updateJson(filePath, mutator, opts = {}) {
    return _serialized(filePath, async () => {
        const current = await readJson(filePath, opts.fallback, { onCorrupt: opts.onCorrupt });
        const next = await mutator(current);
        if (next === undefined) return current;
        await writeJsonAtomic(filePath, next, { indent: opts.indent });
        return next;
    });
}

/**
 * 串行执行一个「跨多个文件」的临界区（如"先写经验详情、再更新索引"）。
 *
 * 单文件锁不足以覆盖多文件事务：A 写详情 → B 写详情 → B 改索引 → A 改索引
 * 会让索引与详情不一致。本函数提供一把按业务键的串行锁。
 *
 * @template T
 * @param {string} key - 锁标识
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withSerializedLock(key, fn) {
    return _serialized(`lock:${key}`, fn);
}

/** 仅供测试：清空所有串行链（生产代码不应调用） */
export function _resetChains() {
    _chains.clear();
}

export default { writeJsonAtomic, readJson, updateJson, withSerializedLock };
