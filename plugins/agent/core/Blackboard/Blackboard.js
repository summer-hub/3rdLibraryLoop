/**
 * Blackboard —— 任务级共享工作区（Phase 2）
 *
 * 定位：
 *   多 Agent 协作时，「谁把什么结论交给了别人」必须有一个**所有角色都能读写、
 *   且可审计**的地方。文件系统本身能做这件事，但它缺少三样东西：
 *     1. **索引**——文件列表表达不了"这个 `metrics.json` 是哪个角色、
 *        哪一轮、为什么产出的"；
 *     2. **版本**——同一路径被覆盖就丢了上一次的内容（审核驳回重做时特别致命：
 *        你无法对比"改前 / 改后"）；
 *     3. **作用域**——没有边界检查时，AI 给出的相对路径可以直接写到任务目录之外。
 *
 *   本模块把「任务目录」升级为一块**带索引与版本的黑板**：
 *     - 条目（entry）：`key → {value, author, role, round, artifacts, tags, revision, createdAt}`
 *     - 产物（artifact）：落在 `taskDir` 内的实际文件，条目通过 `artifacts` 引用它
 *     - 历史（history）：同一 key 的历次写入（有界保留），支撑"改前/改后"对比
 *
 * 目录布局（**复用**现有约定，不新造一套）：
 * ```
 * db/task/{taskId}/
 * ├── blackboard.json                                   # 索引（原子写 + 防抖刷盘）
 * ├── stepId2_loop0_result_0.md                         # FlexRunner 既有产物（不冲突）
 * └── board/                                           # Phase 2 黑板产物（按 key 归档）
 *     └── 审查意见.md / review-2.md ...
 * ```
 * 黑板产物放在 `board/` 子目录而非任务目录根：既有 FlexRunner 的产物命名规则
 * （`stepId{N}_loop{L}_result_{M}.md`）在根目录做 glob，混入黑板文件会污染
 * `_collectHistoryDocs` 的结果集。
 *
 * 安全边界（必须有的，因为路径来自 LLM 输出）：
 *   `writeArtifact(relPath)` / `readArtifact(relPath)` 拒绝绝对路径、
 *   拒绝 `..` 逃逸、拒绝盘符与 UNC，并在 `path.resolve` 之后再做**真实前缀校验**
 *   （`resolved === base || resolved.startsWith(base + path.sep)`）。
 *   仅检查字符串里有没有 `..` 是不够的（`a/../../x`、符号链接、Windows 短名都能绕过）。
 *
 * @example
 * const board = new Blackboard({ taskId: 'task-1', taskDir: '/db/task/task-1' });
 * await board.init();
 * await board.put({ key: '计划', value: { steps: [...] }, author: 'planner', round: 0 });
 * const plan = board.get('计划');
 * await board.writeArtifact('board/审查意见.md', '# 审查意见\n...');
 */

import path from 'node:path';
import fs from 'node:fs/promises';

import { nowCST } from '../../../../core/cstTime.js';
import { readJson, writeJsonAtomic, withSerializedLock } from '../lib/AtomicJsonFile.js';

/** 黑板索引文件名 */
export const BLACKBOARD_FILE = 'blackboard.json';

/** 黑板产物子目录 */
export const BOARD_SUBDIR = 'board';

/** 每个 key 保留的历史版本数 */
export const DEFAULT_KEY_HISTORY = 5;

/** 索引条目总数上限（超出后按最后访问时间淘汰最旧的） */
export const DEFAULT_MAX_ENTRIES = 500;

/** 刷盘防抖（ms）。0 表示每次写入立即落盘（测试用）。 */
export const DEFAULT_FLUSH_DEBOUNCE_MS = 250;

/**
 * 共享工作区。
 */
export class Blackboard {
    /** @type {Map<string, object>} key → 当前条目 */
    #entries = new Map();

    /** @type {Map<string, object[]>} key → 历史版本（不含当前版本） */
    #history = new Map();

    /** @type {Promise<void>|null} 在途刷盘 */
    #flushChain = null;

    /** @type {any} */
    #flushTimer = null;

    #dirty = false;

    #stats = { puts: 0, artifactsWritten: 0, artifactsRead: 0, flushes: 0, rejectedPaths: 0, loadErrors: 0 };

    /**
     * @param {object} opts
     * @param {string} opts.taskId                      - 任务 ID（必填）
     * @param {string} [opts.taskDir]                   - 任务目录；缺省 `cwd/db/task/{taskId}`
     * @param {number} [opts.maxKeyHistory]             - 每个 key 的历史版本数
     * @param {number} [opts.maxEntries]                - 条目总数上限
     * @param {number} [opts.flushDebounceMs]           - 刷盘防抖
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        if (!opts.taskId) throw new Error('Blackboard: taskId 为必填项');
        this.taskId = String(opts.taskId);
        this.taskDir = path.resolve(
            opts.taskDir || path.resolve(process.cwd(), 'db', 'task', this.taskId)
        );
        this.maxKeyHistory = Number.isInteger(opts.maxKeyHistory) && opts.maxKeyHistory >= 0
            ? opts.maxKeyHistory
            : DEFAULT_KEY_HISTORY;
        this.maxEntries = Number.isInteger(opts.maxEntries) && opts.maxEntries > 0
            ? opts.maxEntries
            : DEFAULT_MAX_ENTRIES;
        this.flushDebounceMs = Number.isInteger(opts.flushDebounceMs) && opts.flushDebounceMs >= 0
            ? opts.flushDebounceMs
            : DEFAULT_FLUSH_DEBOUNCE_MS;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        /** 供 taskDir 边界校验（phase 2 唯一允许写入的根） */
        this._boardDir = path.join(this.taskDir, BOARD_SUBDIR);
        this._initialized = false;
    }

    /** @returns {string} 索引文件绝对路径 */
    get indexPath() {
        return path.join(this.taskDir, BLACKBOARD_FILE);
    }

    // ─── 生命周期 ─────────────────────────────────────────────────────────────

    /**
     * 初始化：创建目录并加载既有索引。
     *
     * 索引缺失或损坏时**不抛错**（沿用 `readJson` 的降级语义）：
     * 黑板是协作的辅助设施，一次损坏不应让整个任务无法启动；
     * 但会记 `loadErrors` 与 warn 日志，避免"悄无声息地从空黑板开始"。
     *
     * @returns {Promise<{loaded: number, corrupted: boolean}>}
     */
    async init() {
        await fs.mkdir(this._boardDir, { recursive: true });
        let corrupted = false;

        const data = await readJson(this.indexPath, null, {
            onCorrupt: (msg) => {
                corrupted = true;
                this.#stats.loadErrors++;
                this._log('warn', `黑板索引损坏，已降级为空黑板：${msg}`);
            }
        });

        if (data && typeof data === 'object' && data.entries && typeof data.entries === 'object') {
            for (const [key, entry] of Object.entries(data.entries)) {
                if (entry && typeof entry === 'object' && entry.key) {
                    this.#entries.set(key, entry);
                }
            }
            if (data.history && typeof data.history === 'object') {
                for (const [key, list] of Object.entries(data.history)) {
                    if (Array.isArray(list)) this.#history.set(key, list);
                }
            }
        }

        this._initialized = true;
        return { loaded: this.#entries.size, corrupted };
    }

    /** @private */
    _assertInitialized() {
        if (!this._initialized) {
            throw new Error('Blackboard: 请先 await init()');
        }
    }

    // ─── 条目读写 ─────────────────────────────────────────────────────────────

    /**
     * 写入一个条目（同 key 覆盖，旧值进历史）。
     *
     * @param {object} input
     * @param {string} input.key            - 条目键（必填、非空）
     * @param {*} input.value               - 条目值（任意可 JSON 化数据）
     * @param {string} input.author         - 写入者角色 id（必填，用于审计）
     * @param {string} [input.role]         - 角色类型（可与 author 相同）
     * @param {number} [input.stepId]
     * @param {number} [input.round=0]
     * @param {string[]} [input.artifacts]  - 关联产物相对路径
     * @param {string[]} [input.tags]
     * @returns {Promise<object>} 写入后的条目（深拷贝）
     */
    async put(input) {
        this._assertInitialized();
        if (!input || typeof input !== 'object') throw new Error('Blackboard.put: 入参必须是对象');
        const { key, value, author } = input;
        if (typeof key !== 'string' || key.trim() === '') {
            throw new Error('Blackboard.put: key 必须是非空字符串');
        }
        if (typeof author !== 'string' || author.trim() === '') {
            throw new Error('Blackboard.put: author 必须是非空字符串（协作条目必须可追溯）');
        }
        if (value === undefined) {
            throw new Error('Blackboard.put: value 不能为 undefined（请用 null 表达"空值"）');
        }

        const prev = this.#entries.get(key) || null;
        const entry = {
            key,
            value,
            author,
            role: input.role || author,
            stepId: Number.isInteger(input.stepId) ? input.stepId : prev?.stepId ?? null,
            round: Number.isInteger(input.round) ? input.round : prev?.round ?? 0,
            artifacts: Array.isArray(input.artifacts) ? [...input.artifacts] : prev?.artifacts ?? [],
            tags: Array.isArray(input.tags) ? [...input.tags] : prev?.tags ?? [],
            revision: (prev?.revision || 0) + 1,
            createdAt: nowCST(),
            updatedAt: nowCST()
        };

        if (prev) this.#pushHistory(key, prev);
        this.#entries.set(key, entry);
        this.#stats.puts++;
        this.#evictIfNeeded();
        this._markDirty();

        return structuredClone(entry);
    }

    /**
     * 读取条目。
     * @param {string} key
     * @param {*} [fallback=null]
     * @returns {*} 条目的 value（非条目对象）
     */
    get(key, fallback = null) {
        const e = this.#entries.get(key);
        return e ? structuredClone(e.value) : fallback;
    }

    /**
     * 读取完整条目（含作者/轮次/版本等审计字段）。
     * @param {string} key
     * @returns {object|null}
     */
    getEntry(key) {
        const e = this.#entries.get(key);
        return e ? structuredClone(e) : null;
    }

    /**
     * 列出条目（可按标签/作者/步骤过滤），按更新时间倒序。
     *
     * @param {object} [filter]
     * @param {string[]} [filter.tags]  - 命中任一标签即返回
     * @param {string} [filter.author]
     * @param {string} [filter.role]
     * @param {number} [filter.stepId]
     * @param {string} [filter.keyPrefix]
     * @returns {object[]}
     */
    list(filter = {}) {
        let items = [...this.#entries.values()];
        if (Array.isArray(filter.tags) && filter.tags.length) {
            items = items.filter((e) => e.tags.some((t) => filter.tags.includes(t)));
        }
        if (filter.author) items = items.filter((e) => e.author === filter.author);
        if (filter.role) items = items.filter((e) => e.role === filter.role);
        if (Number.isInteger(filter.stepId)) items = items.filter((e) => e.stepId === filter.stepId);
        if (filter.keyPrefix) items = items.filter((e) => e.key.startsWith(filter.keyPrefix));
        return items
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
            .map((e) => structuredClone(e));
    }

    /**
     * 取某个 key 的历史版本（不含当前），最近一次在前。
     * @param {string} key
     * @returns {object[]}
     */
    getHistory(key) {
        return (this.#history.get(key) || []).map((e) => structuredClone(e));
    }

    /**
     * 删除条目（连同历史）。
     * @param {string} key
     * @returns {boolean}
     */
    remove(key) {
        this.#history.delete(key);
        const ok = this.#entries.delete(key);
        if (ok) this._markDirty();
        return ok;
    }

    /** @returns {number} */
    get size() {
        return this.#entries.size;
    }

    // ─── 产物读写 ─────────────────────────────────────────────────────────────

    /**
     * 把相对路径解析为**黑板目录内**的绝对路径。
     *
     * 拒绝：空串、绝对路径、盘符、UNC（`\\`、`//`）、`..` 逃逸、逃逸到 `board/` 之外。
     * 校验在 `path.resolve` **之后**用真实前缀比较，而不是只查字符串里有没有 `..`。
     *
     * @param {string} relPath - 相对 `board/` 的路径，如 `审查意见.md`
     * @returns {string} 绝对路径
     * @throws {Error} 路径非法或越界
     */
    resolveArtifact(relPath) {
        if (typeof relPath !== 'string' || relPath.trim() === '') {
            this.#stats.rejectedPaths++;
            throw new Error('Blackboard.resolveArtifact: 路径必须是非空字符串');
        }
        const raw = relPath.trim().replace(/\\/g, '/');
        if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.startsWith('//')) {
            this.#stats.rejectedPaths++;
            throw new Error(`Blackboard.resolveArtifact: 拒绝绝对路径 ${relPath}`);
        }
        // 归一化后判 `..`：`a/../..` 这类写法在归一化前看不出逃逸
        const normalized = path.posix.normalize(raw);
        if (normalized === '..' || normalized.startsWith('../')) {
            this.#stats.rejectedPaths++;
            throw new Error(`Blackboard.resolveArtifact: 路径越界 ${relPath}`);
        }

        const base = this._boardDir;
        const resolved = path.resolve(base, normalized);
        if (resolved !== base && !resolved.startsWith(base + path.sep)) {
            this.#stats.rejectedPaths++;
            throw new Error(`Blackboard.resolveArtifact: 解析后越界 ${relPath} → ${resolved}`);
        }
        return resolved;
    }

    /**
     * 写产物到黑板（自动建父目录）。
     * @param {string} relPath
     * @param {string|Buffer} content
     * @returns {Promise<string>} 绝对路径
     */
    async writeArtifact(relPath, content) {
        this._assertInitialized();
        const abs = this.resolveArtifact(relPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
        this.#stats.artifactsWritten++;
        return abs;
    }

    /**
     * 读产物。
     * @param {string} relPath
     * @param {string} [fallback=null] - 不存在时的返回值（不存在不抛错，便于"可选产物"语义）
     * @returns {Promise<string|null>}
     */
    async readArtifact(relPath, fallback = null) {
        this._assertInitialized();
        const abs = this.resolveArtifact(relPath);
        try {
            const content = await fs.readFile(abs, 'utf8');
            this.#stats.artifactsRead++;
            return content;
        } catch (err) {
            if (err.code === 'ENOENT') return fallback;
            throw err;
        }
    }

    /**
     * 列出黑板产物（相对 `board/` 的 POSIX 风格路径），按名称排序。
     * @returns {Promise<string[]>}
     */
    async listArtifacts() {
        this._assertInitialized();
        const out = [];
        const walk = async (dir, prefix) => {
            let items;
            try {
                items = await fs.readdir(dir, { withFileTypes: true });
            } catch (err) {
                if (err.code === 'ENOENT') return;
                throw err;
            }
            for (const it of items) {
                const rel = prefix ? `${prefix}/${it.name}` : it.name;
                if (it.isDirectory()) {
                    await walk(path.join(dir, it.name), rel);
                } else {
                    out.push(rel);
                }
            }
        };
        await walk(this._boardDir, '');
        return out.sort();
    }

    // ─── Prompt 注入 ──────────────────────────────────────────────────────────

    /**
     * 生成「黑板现状」的 Markdown 摘要，供角色 prompt 注入。
     *
     * 预算控制与 F-25 的知识注入一致：条数上限 + 单条字符上限 + 总字符上限。
     * 无条目时返回空串（调用方据此决定是否插入小节，避免 prompt 里出现空标题）。
     *
     * @param {object} [opts]
     * @param {number} [opts.maxEntries=8]
     * @param {number} [opts.maxEntryChars=400]
     * @param {number} [opts.maxTotalChars=3000]
     * @param {string[]} [opts.excludeKeys] - 不注入的键（如即将被本角色覆盖的键）
     * @returns {{text: string, entries: number, truncated: boolean, chars: number}}
     */
    snapshotForPrompt(opts = {}) {
        const maxEntries = Number.isInteger(opts.maxEntries) && opts.maxEntries > 0 ? opts.maxEntries : 8;
        const maxEntryChars = Number.isInteger(opts.maxEntryChars) && opts.maxEntryChars > 0 ? opts.maxEntryChars : 400;
        const maxTotalChars = Number.isInteger(opts.maxTotalChars) && opts.maxTotalChars > 0 ? opts.maxTotalChars : 3000;
        const exclude = new Set(Array.isArray(opts.excludeKeys) ? opts.excludeKeys : []);

        const items = this.list().filter((e) => !exclude.has(e.key));
        if (items.length === 0) return { text: '', entries: 0, truncated: false, chars: 0 };

        const lines = [];
        let chars = 0;
        let truncated = false;
        let used = 0;

        for (const e of items) {
            if (used >= maxEntries) { truncated = true; break; }
            const rendered = Blackboard._renderValue(e.value);
            const body = rendered.length > maxEntryChars
                ? `${rendered.slice(0, maxEntryChars)}…（已截断，原文 ${rendered.length} 字符）`
                : rendered;
            const line = `- **${e.key}**（作者 ${e.author}，第 ${e.round} 轮，rev${e.revision}）：${body}`;
            if (chars + line.length > maxTotalChars) { truncated = true; break; }
            lines.push(line);
            chars += line.length;
            used++;
        }

        return {
            text: lines.join('\n'),
            entries: used,
            truncated,
            chars
        };
    }

    /**
     * 把任意值渲染为单段可读文本（用于 prompt 注入）。
     * @param {*} value
     * @returns {string}
     * @private
     */
    static _renderValue(value) {
        if (value === null || value === undefined) return '（空）';
        if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
        if (typeof value !== 'object') return String(value);
        try {
            return JSON.stringify(value).replace(/\s+/g, ' ');
        } catch {
            return '[不可序列化]';
        }
    }

    // ─── 持久化 ───────────────────────────────────────────────────────────────

    /** @private */
    _markDirty() {
        this.#dirty = true;
        if (this.flushDebounceMs === 0) return; // 立即落盘由 flush() 显式触发
        if (this.#flushTimer) return;
        this.#flushTimer = setTimeout(() => {
            this.#flushTimer = null;
            this.flush().catch((err) => this._log('warn', `黑板刷盘失败：${err.message}`));
        }, this.flushDebounceMs);
        // 刷盘定时器不应阻止进程退出（与 Orchestrator 的持久化窗口同理）
        this.#flushTimer.unref?.();
    }

    /**
     * 立即刷盘（合并并发调用，保证串行）。
     *
     * 用 `withSerializedLock` 保护：黑板的 read-modify-write 是"整份索引覆盖"，
     * 若两个 flush 交错会互相覆盖（与 F-14 修复的 StatsService 是同一类缺陷）。
     *
     * @returns {Promise<boolean>} 是否真的写入了（无脏数据时返回 false）
     */
    async flush() {
        if (this.#flushTimer) {
            clearTimeout(this.#flushTimer);
            this.#flushTimer = null;
        }
        if (!this.#dirty) return false;
        if (this.#flushChain) return this.#flushChain.then(() => this._doFlush());

        this.#flushChain = this._doFlush().finally(() => { this.#flushChain = null; });
        return this.#flushChain;
    }

    /** @private */
    async _doFlush() {
        if (!this.#dirty) return false;
        // 先清标记再写：写入期间新产生的修改会再次置脏，从而触发下一轮刷盘，
        // 不会出现"写入过程中丢失更新"。
        this.#dirty = false;

        const snapshot = {
            version: 1,
            taskId: this.taskId,
            savedAt: nowCST(),
            entries: Object.fromEntries([...this.#entries.entries()].map(([k, v]) => [k, structuredClone(v)])),
            history: Object.fromEntries([...this.#history.entries()].map(([k, v]) => [k, structuredClone(v)]))
        };

        try {
            await withSerializedLock(`blackboard:${this.taskDir}`, async () => {
                await writeJsonAtomic(this.indexPath, snapshot);
            });
        } catch (err) {
            // 写失败必须把脏标记**放回去**：否则 `flush()` 下次会因 `!#dirty` 直接返回 false，
            // 这次更新将永远不落盘（直到别的 put() 再次置脏）——一次瞬时 EPERM/ENOSPC
            // 就静默丢掉整份协作记录。
            this.#dirty = true;
            throw err;
        }
        this.#stats.flushes++;
        return true;
    }

    /**
     * @param {string} key
     * @param {object} entry
     * @private
     */
    #pushHistory(key, entry) {
        if (this.maxKeyHistory === 0) return;
        const list = this.#history.get(key) || [];
        list.unshift(structuredClone(entry));
        if (list.length > this.maxKeyHistory) list.length = this.maxKeyHistory;
        this.#history.set(key, list);
    }

    /**
     * 条目数超限时淘汰最旧的（按 updatedAt）。
     * @private
     */
    #evictIfNeeded() {
        if (this.#entries.size <= this.maxEntries) return;
        const sorted = [...this.#entries.values()].sort((a, b) =>
            String(a.updatedAt).localeCompare(String(b.updatedAt)));
        const drop = this.#entries.size - this.maxEntries;
        for (let i = 0; i < drop; i++) {
            const e = sorted[i];
            this.#entries.delete(e.key);
            this.#history.delete(e.key);
        }
    }

    /**
     * @param {string} level
     * @param {string} msg
     * @private
     */
    _log(level, msg) {
        if (this._logger) this._logger(level, msg);
    }

    /**
     * 统计快照。
     * @returns {object}
     */
    getStats() {
        return {
            taskId: this.taskId,
            taskDir: this.taskDir,
            entries: this.#entries.size,
            historyKeys: this.#history.size,
            dirty: this.#dirty,
            ...this.#stats
        };
    }

    /**
     * 序列化快照（供测试断言与 SSE 推送）。
     * @returns {object}
     */
    toJSON() {
        return {
            taskId: this.taskId,
            entries: [...this.#entries.values()].map((e) => structuredClone(e))
        };
    }
}

export default Blackboard;
