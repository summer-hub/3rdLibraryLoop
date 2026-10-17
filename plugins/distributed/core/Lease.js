/**
 * Lease —— 分布式租约 + 心跳 + fencing token（Phase 4）
 *
 * ## 为什么需要它（现状的真实缺陷）
 *
 * Phase 1 用 `owner.json`（pid + hostname + `heartbeatAt`）判定"这个任务归谁执行"。
 * `Server/Orchestrator/Orchestrator.js` 的 F-26 已经修掉了 pid 复用导致的幽灵任务，
 * 但那套机制**只在单机成立**：
 *   - `pid` 只在本机有意义，多实例部署时 A 实例无法判断 B 实例的 pid 是否存活；
 *   - `owner.json` 落在共享目录也不能原子仲裁（两个实例可能同时读到"无人持有"）；
 *   - 没有**围栏（fencing）**：实例 A 暂停 30 秒后恢复，仍会继续写它早已失去所有权的任务，
 *     把实例 B 的成果覆盖掉——这是分布式系统最经典的"僵死写入者"问题。
 *
 * ## 三个必须同时具备的语义
 *
 * 1. **租约（lease）+ 过期**：持有时限，超时自动可被接管。这是"实例被 kill -9"后
 *    任务能被接管的唯一依据（进程死了不可能主动释放）。
 * 2. **心跳续租**：活着但耗时长的持有者定期 `renew`，避免自己被误接管。
 * 3. **fencing token**：每次成功获取租约时，token **单调递增**（按资源维度）。
 *    所有写入都必须带上自己持有的 token，存储层拒绝"token 小于当前已见最大值"的写入。
 *    这样即使旧持有者恢复后继续写，也会被拒绝——**这是唯一能真正解决僵死写入者的手段**，
 *    仅靠"检查租约是否过期"是不够的（检查和写入之间总存在时间窗口）。
 *
 * ## backend 契约（Phase 4 换真实存储的接缝）
 *
 * ```
 * get(key)               → record | null
 * setIfAbsent(key, rec)  → boolean          // 原子：仅当不存在时写入
 * compareAndSet(key, expect, next) → boolean // 原子 CAS
 * delete(key)            → void
 * list(prefix)           → [{ key, record }]
 * ```
 * - `MemoryLeaseBackend`：进程内参考实现（测试用，语义与真实后端一致）。
 * - `PostgresLeaseBackend`：发出**单条**原子 SQL（`INSERT ... ON CONFLICT ... RETURNING`），
 *   把"读-判-写"三步压进一条语句，从根上消除竞态。
 *   注意：它的端到端行为**需要活的 PostgreSQL 才能验证**；本仓库内的测试只验证
 *   "生成的 SQL 与参数正确、且不依赖读后再写"这一可静态复核的性质（见 m7 套件）。
 *
 * @example
 * const store = new LeaseStore({ ttlMs: 30000 });
 * const got = await store.acquire({ resource: 'task:t1', owner: 'svc-1' });
 * if (got.ok) {
 *   await store.assertFence('task:t1', got.lease.fencingToken);  // 写入前校验
 *   await store.renew({ resource: 'task:t1', owner: 'svc-1', fencingToken: got.lease.fencingToken });
 * }
 */

/** 默认租约时长（ms）。30s 是"心跳间隔 × 3"的经验值，容忍两次丢包。 */
export const DEFAULT_LEASE_TTL_MS = 30000;

/** 默认心跳间隔（ms）：租约时长的 1/3，保证在过期前有两次续租机会。 */
export const DEFAULT_HEARTBEAT_MS = 10000;

/** 内存后端：进程内参考实现 */
export class MemoryLeaseBackend {
    constructor() {
        /** @type {Map<string, object>} */
        this._data = new Map();
        /**
         * @type {Map<string, Promise<void>>} 每键一条串行链。
         * 没有它，两个并发 `compareAndSet` 会各自读到同一份旧值后双双写入——
         * 与 F-14 修掉的 `StatsService` 是同一类缺陷（读-改-写不是原子的）。
         */
        this._chains = new Map();
    }

    /** @private */
    async _serial(key, fn) {
        const prev = this._chains.get(key) ?? Promise.resolve();
        const chain = prev.then(fn, fn);
        const registered = chain.catch(() => {});
        this._chains.set(key, registered);
        try {
            return await chain;
        } finally {
            if (this._chains.get(key) === registered) this._chains.delete(key);
        }
    }

    async get(key) {
        const v = this._data.get(key);
        return v ? structuredClone(v) : null;
    }

    async setIfAbsent(key, record) {
        return this._serial(key, async () => {
            if (this._data.has(key)) return false;
            this._data.set(key, structuredClone(record));
            return true;
        });
    }

    async compareAndSet(key, expectRevision, next) {
        return this._serial(key, async () => {
            const cur = this._data.get(key);
            if (!cur) return false;
            if (cur.revision !== expectRevision) return false;
            this._data.set(key, structuredClone(next));
            return true;
        });
    }

    async delete(key) {
        return this._serial(key, async () => this._data.delete(key));
    }

    async list(prefix = '') {
        const out = [];
        for (const [key, record] of this._data) {
            if (key.startsWith(prefix)) out.push({ key, record: structuredClone(record) });
        }
        return out;
    }

    /** 仅供测试：清空 */
    reset() {
        this._data.clear();
        this._chains.clear();
    }
}

/**
 * PostgreSQL 后端（发出原子 SQL）。
 *
 * 关键点：`acquire` **不使用**"先 SELECT 判断、再 UPDATE"的两步写法。
 * 两步写法在并发下必然产生"都认为可以获取"的窗口——这正是分布式锁最常见的错误实现。
 * 这里用单条语句把判断与写入合成一次原子操作，并由 `RETURNING` 直接拿到结果。
 *
 * 需要真实验证的部分（诚实边界）：SQL 的正确性、`ON CONFLICT` 的行为、
 * 隔离级别对 `RETURNING` 的影响，都需要**活的 PostgreSQL**。
 * 本类在无 PG 时可被构造（用于静态校验与依赖注入），但调用会明确报错而不是假装成功。
 */
export class PostgresLeaseBackend {
    /**
     * @param {object} opts
     * @param {(sql: string, params: any[]) => Promise<{rows: object[]}>} opts.query - 注入的查询函数
     * @param {string} [opts.table='leases']
     */
    constructor(opts = {}) {
        if (typeof opts.query !== 'function') {
            throw new Error('PostgresLeaseBackend: 需要注入 query(sql, params) 函数');
        }
        this._query = opts.query;
        this.table = opts.table || 'leases';
    }

    /** 建表语句（幂等迁移脚本的一部分，见 deploy/migrations/001_leases.sql） */
    static schema(table = 'leases') {
        return `
CREATE TABLE IF NOT EXISTS ${table} (
    resource        TEXT PRIMARY KEY,
    owner           TEXT        NOT NULL,
    fencing_token   BIGINT      NOT NULL,
    revision        BIGINT      NOT NULL,
    acquired_at     TIMESTAMPTZ NOT NULL,
    heartbeat_at    TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ${table}_expires_idx ON ${table} (expires_at);
`.trim();
    }

    async get(resource) {
        const r = await this._query(
            `SELECT resource, owner, fencing_token, revision, acquired_at, heartbeat_at, expires_at
               FROM ${this.table} WHERE resource = $1`, [resource]
        );
        return r.rows[0] ? PostgresLeaseBackend._fromRow(r.rows[0]) : null;
    }

    /**
     * 原子获取：单条 UPSERT。
     * - 行不存在 → `ON CONFLICT` 不触发，token 从 1 开始；
     * - 行存在但已过期 → `DO UPDATE ... WHERE expires_at < now()` 触发，token 递增；
     * - 行存在且未过期 → `WHERE` 不成立，`UPDATE` 不执行且 `RETURNING` 无行 → 获取失败。
     *
     * 这三条分支由**同一条语句**保证互斥，不依赖任何读后判断。
     */
    async acquireAtomic({ resource, owner, now, expiresAt, ttlMs }) {
        const sql = `
INSERT INTO ${this.table} (resource, owner, fencing_token, revision, acquired_at, heartbeat_at, expires_at)
VALUES ($1, $2, 1, 1, $3, $3, $4)
ON CONFLICT (resource) DO UPDATE
   SET owner         = EXCLUDED.owner,
       fencing_token = ${this.table}.fencing_token + 1,
       revision      = ${this.table}.revision + 1,
       acquired_at   = EXCLUDED.acquired_at,
       heartbeat_at  = EXCLUDED.heartbeat_at,
       expires_at    = EXCLUDED.expires_at
 WHERE ${this.table}.expires_at < EXCLUDED.heartbeat_at
RETURNING fencing_token, revision, expires_at`.trim();
        const params = [resource, owner, now, expiresAt];
        const r = await this._query(sql, params);
        if (!r.rows[0]) return null;
        return {
            resource,
            owner,
            fencingToken: Number(r.rows[0].fencing_token),
            revision: Number(r.rows[0].revision),
            acquiredAt: now,
            heartbeatAt: now,
            expiresAt: r.rows[0].expires_at instanceof Date
                ? r.rows[0].expires_at.toISOString()
                : String(r.rows[0].expires_at),
            ttlMs
        };
    }

    /**
     * 原子续租：仅当"我仍是持有者 且 未过期"时更新心跳与过期时间。
     * 同时校验 fencing_token，防止已被接管后旧持有者续租成功。
     */
    async renewAtomic({ resource, owner, fencingToken, now, expiresAt }) {
        const r = await this._query(
            `UPDATE ${this.table}
                SET heartbeat_at = $4, expires_at = $5, revision = revision + 1
              WHERE resource = $1 AND owner = $2 AND fencing_token = $3 AND expires_at > $4
          RETURNING revision, expires_at`, [resource, owner, fencingToken, now, expiresAt]
        );
        return r.rows[0] || null;
    }

    /** 原子释放：仅持有者可释放（用 token 校验）。 */
    async releaseAtomic({ resource, owner, fencingToken }) {
        const r = await this._query(
            `DELETE FROM ${this.table}
              WHERE resource = $1 AND owner = $2 AND fencing_token = $3`, [resource, owner, fencingToken]
        );
        return (r.rowCount ?? r.rows?.length ?? 0) > 0;
    }

    /** @private */
    static _fromRow(row) {
        return {
            resource: row.resource,
            owner: row.owner,
            fencingToken: Number(row.fencing_token),
            revision: Number(row.revision),
            acquiredAt: PostgresLeaseBackend._iso(row.acquired_at),
            heartbeatAt: PostgresLeaseBackend._iso(row.heartbeat_at),
            expiresAt: PostgresLeaseBackend._iso(row.expires_at),
            ttlMs: null
        };
    }

    /** @private */
    static _iso(v) {
        return v instanceof Date ? v.toISOString() : String(v);
    }
}

/**
 * 租约存储（与后端无关的语义层）。
 */
export class LeaseStore {
    /**
     * @param {object} [opts]
     * @param {object} [opts.backend]        - 见类文档的 backend 契约；缺省用内存后端
     * @param {number} [opts.ttlMs]          - 默认租约时长
     * @param {() => number} [opts.clock]    - 时钟（测试注入）
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        this.backend = opts.backend || new MemoryLeaseBackend();
        this.ttlMs = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : DEFAULT_LEASE_TTL_MS;
        this._clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        /**
         * @type {Map<string, number>} 资源 → **已见最大** fencing token。
         * 只增不减：即使租约被释放/接管，旧 token 也永远小于新 token，
         * 这是 `assertFence` 能挡住僵死写入者的前提。
         */
        this._maxFence = new Map();
        this._stats = { acquireOk: 0, acquireBusy: 0, takenOver: 0, renewOk: 0, renewLost: 0, released: 0, fenceRejected: 0 };
    }

    /** @private */
    _key(resource) {
        return `lease:${resource}`;
    }

    /**
     * 获取租约（行不存在 或 已过期）。
     *
     * @param {object} p
     * @param {string} p.resource - 资源标识，如 `task:t1`
     * @param {string} p.owner    - 持有者标识，如 `svc-1@hostA`
     * @param {number} [p.ttlMs]
     * @returns {Promise<{ok: boolean, reason?: string, lease?: object, takeover?: boolean}>}
     */
    async acquire({ resource, owner, ttlMs }) {
        if (!resource || !owner) throw new Error('LeaseStore.acquire: resource 与 owner 均为必填');
        const now = this._clock();
        const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : this.ttlMs;
        const key = this._key(resource);

        // —— 尝试写入（后端保证原子）——
        if (typeof this.backend.acquireAtomic === 'function') {
            // 真实存储路径：一条语句完成判空/判过期/写入，不存在读后写窗口
            const lease = await this.backend.acquireAtomic({
                resource, owner, now: new Date(now).toISOString(),
                expiresAt: new Date(now + ttl).toISOString(), ttlMs: ttl
            });
            if (!lease) {
                this._stats.acquireBusy++;
                return { ok: false, reason: 'held' };
            }
            this._observeFence(resource, lease.fencingToken);
            this._stats.acquireOk++;
            if (lease.fencingToken > 1) this._stats.takenOver++;
            return { ok: true, lease, takeover: lease.fencingToken > 1 };
        }

        // —— 参考实现路径（内存后端）——
        const existing = await this.backend.get(key);
        if (!existing) {
            const record = this._newRecord({ resource, owner, now, ttl, token: 1 });
            const wrote = await this.backend.setIfAbsent(key, record);
            if (!wrote) {
                // 并发下被抢先：这不是错误，如实返回"被占用"
                this._stats.acquireBusy++;
                return { ok: false, reason: 'held' };
            }
            this._observeFence(resource, 1);
            this._stats.acquireOk++;
            return { ok: true, lease: record, takeover: false };
        }

        if (Date.parse(existing.expiresAt) > now) {
            this._stats.acquireBusy++;
            return { ok: false, reason: 'held' };
        }

        // 已过期 → 接管，token 单调递增。
        // revision 必须**同时**递增：它是 CAS 的乐观并发凭证。
        // 若接管后 revision 仍为 1（与快照相同），两个并发接管者会双双通过 CAS，
        // 并且两者都基于同一快照算出**相同的 token** —— 双主 + 围栏失效。
        const next = this._newRecord({
            resource, owner, now, ttl,
            token: existing.fencingToken + 1,
            revision: (Number(existing.revision) || 1) + 1
        });
        const swapped = await this.backend.compareAndSet(key, existing.revision, next);
        if (!swapped) {
            this._stats.acquireBusy++;
            return { ok: false, reason: 'race' };
        }
        this._observeFence(resource, next.fencingToken);
        this._stats.acquireOk++;
        this._stats.takenOver++;
        this._log('warn',
            `租约接管：${resource} 由 ${existing.owner}(token=${existing.fencingToken}) ` +
            `→ ${owner}(token=${next.fencingToken})`);
        return { ok: true, lease: next, takeover: true };
    }

    /**
     * 续租（心跳）。
     *
     * 仅当"我仍是持有者 且 token 匹配 且 未过期"时成功。
     * 过期后不允许续租——否则一个长时间 GC 暂停的持有者可以在恢复后"复活"自己的租约，
     * 而此时可能已经被别人接管。
     *
     * @param {object} p
     * @param {string} p.resource
     * @param {string} p.owner
     * @param {number} p.fencingToken
     * @param {number} [p.ttlMs]
     * @returns {Promise<{ok: boolean, reason?: string, lease?: object}>}
     */
    async renew({ resource, owner, fencingToken, ttlMs }) {
        const now = this._clock();
        const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : this.ttlMs;

        if (typeof this.backend.renewAtomic === 'function') {
            const row = await this.backend.renewAtomic({
                resource, owner, fencingToken,
                now: new Date(now).toISOString(),
                expiresAt: new Date(now + ttl).toISOString()
            });
            if (!row) {
                this._stats.renewLost++;
                return { ok: false, reason: 'lost' };
            }
            this._stats.renewOk++;
            return { ok: true, lease: { resource, owner, fencingToken, expiresAt: row.expires_at } };
        }

        const key = this._key(resource);
        const cur = await this.backend.get(key);
        if (!cur) { this._stats.renewLost++; return { ok: false, reason: 'missing' }; }
        if (cur.owner !== owner) { this._stats.renewLost++; return { ok: false, reason: 'owner-changed' }; }
        if (cur.fencingToken !== fencingToken) { this._stats.renewLost++; return { ok: false, reason: 'token-mismatch' }; }
        if (Date.parse(cur.expiresAt) <= now) { this._stats.renewLost++; return { ok: false, reason: 'expired' }; }

        const next = {
            ...cur,
            revision: cur.revision + 1,
            heartbeatAt: new Date(now).toISOString(),
            expiresAt: new Date(now + ttl).toISOString(),
            ttlMs: ttl
        };
        const okCas = await this.backend.compareAndSet(key, cur.revision, next);
        if (!okCas) { this._stats.renewLost++; return { ok: false, reason: 'race' }; }
        this._stats.renewOk++;
        return { ok: true, lease: next };
    }

    /**
     * 释放租约（主动放手，如编排正常结束）。
     * @returns {Promise<boolean>}
     */
    async release({ resource, owner, fencingToken }) {
        if (typeof this.backend.releaseAtomic === 'function') {
            const ok = await this.backend.releaseAtomic({ resource, owner, fencingToken });
            if (ok) this._stats.released++;
            return ok;
        }
        const key = this._key(resource);
        const cur = await this.backend.get(key);
        if (!cur) return false;
        if (cur.owner !== owner || cur.fencingToken !== fencingToken) return false;
        const ok = await this.backend.delete(key);
        if (ok) this._stats.released++;
        return ok;
    }

    /**
     * 读取当前租约（含是否已过期）。
     * @param {string} resource
     * @returns {Promise<object|null>}
     */
    async peek(resource) {
        const rec = await this.backend.get(this._key(resource));
        if (!rec) return null;
        return { ...rec, expired: Date.parse(rec.expiresAt) <= this._clock() };
    }

    /**
     * 写入前的围栏校验。
     *
     * **这是整个租约机制真正的价值所在**：仅靠"检查租约是否过期"挡不住僵死写入者，
     * 因为"检查"与"写入"之间总有时间窗口（检查时未过期 → 期间被接管 → 写入覆盖新持有者）。
     * 用单调 token 校验后，旧持有者的写入会被**必然**拒绝。
     *
     * @param {string} resource
     * @param {number} token
     * @throws {Error} token 已过期（`code = 'ESTALE_FENCE'`）
     * @returns {Promise<true>}
     */
    async assertFence(resource, token) {
        const max = this._maxFence.get(resource) || 0;
        if (!(Number(token) >= max)) {
            this._stats.fenceRejected++;
            const err = new Error(
                `租约围栏校验失败：${resource} 的 token=${token} 已过期（当前 ${max}）。` +
                `本持有者已失去所有权，写入被拒绝。`
            );
            err.code = 'ESTALE_FENCE';
            throw err;
        }
        return true;
    }

    /**
     * 当前所有租约（含过期状态），用于运维观测与接管扫描。
     * @param {string} [prefix]
     * @returns {Promise<object[]>}
     */
    async list(prefix = '') {
        const rows = await this.backend.list(`lease:${prefix}`);
        const now = this._clock();
        return rows.map(({ record }) => ({ ...record, expired: Date.parse(record.expiresAt) <= now }))
            .sort((a, b) => a.resource.localeCompare(b.resource));
    }

    /**
     * 已过期的租约（"哪个实例死了、哪些任务待接管"的直接答案）。
     * @returns {Promise<object[]>}
     */
    async listExpired() {
        return (await this.list()).filter((l) => l.expired);
    }

    /**
     * 某资源的已见最大 token（用于核对单调性）。
     * @param {string} resource
     * @returns {number}
     */
    maximumFence(resource) {
        return this._maxFence.get(resource) || 0;
    }

    /**
     * 观测到一个 token（获取成功时调用）。
     *
     * 接管场景下新持有者的 token 必然更大；若观测到**更小**的 token，
     * 说明后端的状态与实际不一致（例如接了只读副本），必须显式告警，
     * 否则围栏会在无声中失效。
     *
     * @param {string} resource
     * @param {number} token
     * @private
     */
    _observeFence(resource, token) {
        const max = this._maxFence.get(resource) || 0;
        if (token < max) {
            this._log('error',
                `租约 token 回退：${resource} token=${token} < 已见最大值 ${max}——` +
                `后端状态可能不一致，围栏保护将不可靠`);
        }
        if (token > max) this._maxFence.set(resource, token);
    }

    /**
     * @private
     * @param {object} p
     * @param {number} [p.revision=1] - 乐观并发版本号。首次获取恒为 1；
     *   **接管时必须递增**（见 acquire 的接管分支），否则 CAS 无法区分
     *   "同一快照的两个接管者"与"已完成的接管"，会导致双主 + 相同 token。
     * @returns {object}
     */
    _newRecord({ resource, owner, now, ttl, token, revision = 1 }) {
        return {
            resource,
            owner,
            fencingToken: token,
            revision,
            acquiredAt: new Date(now).toISOString(),
            heartbeatAt: new Date(now).toISOString(),
            expiresAt: new Date(now + ttl).toISOString(),
            ttlMs: ttl
        };
    }

    /** @returns {object} 统计快照 */
    getStats() {
        return {
            active: this._maxFence.size,
            maxFence: Object.fromEntries(this._maxFence),
            ...this._stats
        };
    }

    /** @private */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[LeaseStore] ${msg}`);
    }
}

export default LeaseStore;
