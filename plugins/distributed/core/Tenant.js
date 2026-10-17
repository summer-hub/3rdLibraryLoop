/**
 * Tenant —— 多租户隔离、配额与 RBAC（Phase 4）
 *
 * ## 为什么"加个 tenantId 字段"不叫多租户
 *
 * 多租户最容易犯的错误是只在数据上加 `tenantId`，而**忘记在读取路径上强制过滤**。
 * 结果是一条查询漏写 `WHERE tenant_id = ?` 就把别人的数据返回了。
 * 因此本模块把隔离做成**结构性保证**而不是纪律：
 *
 *   1. **命名空间化键**：所有键都由 `TenantScope` **构造**，业务代码拿不到"裸键"。
 *      这样"忘记过滤"在类型层面就不可能发生——你只能通过 scope 拿到键。
 *   2. **租户上下文注入**：`AsyncLocalStorage` 承载当前租户，
 *      存储层从上下文取租户而不是从参数取（参数会被漏传，上下文不会）。
 *   3. **越权访问返回"不存在"而不是"禁止"**：跨租户读取返回 404 语义，
 *      避免通过错误码差异探测其他租户是否存在（信息泄露）。
 *
 * ## RBAC：权限集合而不是角色层级
 *
 * 角色 → 权限集合（`Set<string>`），权限用 `资源:动作` 形式（`task:write`）。
 * 不做角色继承（继承链会让"某角色到底有什么权限"变得需要推理），
 * 而是要求把权限**显式列全**。多写几行换来审计时一眼可读。
 *
 * ## 配额
 *
 * 三类可独立限额：并发会话数、每日任务数、每日 LLM token 数。
 * 配额**跨实例**才有意义（单实例配额在多实例下会被放大 N 倍），
 * 因此配额状态设计成可注入后端（Redis 计数器 / 数据库表），
 * 本模块提供内存参考实现用于验证语义。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { nowCST } from '../../../core/cstTime.js';

/** 内置角色 → 权限集合 */
export const BUILTIN_RBAC = Object.freeze({
    /** 只读观察者：能看进度与产物，不能改任何东西 */
    viewer: Object.freeze(['task:read', 'artifact:read', 'knowledge:read', 'stats:read']),
    /** 操作员：能启动/终止任务，仍不能改系统配置 */
    operator: Object.freeze(['task:read', 'task:write', 'task:control', 'artifact:read', 'artifact:write', 'knowledge:read', 'stats:read']),
    /** 知识管理员：能写知识库（规则/经验直接影响后续任务质量，因此独立授权） */
    knowledgeAdmin: Object.freeze(['knowledge:read', 'knowledge:write', 'stats:read', 'task:read']),
    /** 租户管理员：租户内的全部权限 + 成员管理 */
    tenantAdmin: Object.freeze([
        'task:read', 'task:write', 'task:control', 'artifact:read', 'artifact:write',
        'knowledge:read', 'knowledge:write', 'stats:read', 'tenant:manage', 'audit:read'
    ]),
    /** 平台管理员：跨租户（仅平台运维使用，必须走审计） */
    platformAdmin: Object.freeze(['*'])
});

/** 默认配额 */
export const DEFAULT_QUOTA = Object.freeze({
    maxConcurrentSessions: 8,
    maxTasksPerDay: 200,
    maxTokensPerDay: 5_000_000
});

/**
 * 已知配额维度。未知 kind 属调用方 bug，必须**显式失败**：
 * 原先 `_limitFor` 的 default 返回 0，而 0 被当作"不限流"，
 * 于是拼错维度名会静默关掉配额（安全边界无声消失）。
 */
export const QUOTA_KINDS = Object.freeze(['concurrentSessions', 'tasksPerDay', 'tokensPerDay']);

/** 租户上下文（AsyncLocalStorage） */
const tenantStore = new AsyncLocalStorage();

/**
 * 租户作用域：**唯一**能构造出带租户前缀的键的入口。
 *
 * 这是隔离的结构性保证：业务代码不持有"裸键"的构造能力，
 * 因此不可能绕过租户维度访问数据。
 */
export class TenantScope {
    /**
     * @param {string} tenantId
     */
    constructor(tenantId) {
        if (!tenantId || typeof tenantId !== 'string') {
            throw new Error('TenantScope: tenantId 必须是非空字符串');
        }
        this.tenantId = tenantId;
        Object.freeze(this);
    }

    /**
     * 构造租户隔离的键。
     * @param {string} kind - 资源类别，如 `task` / `artifact` / `knowledge`
     * @param {string} id
     * @returns {string}
     */
    key(kind, id = '') {
        if (!kind || typeof kind !== 'string') throw new Error('TenantScope.key: kind 必填');
        const suffix = id === undefined || id === null || id === '' ? '' : `:${id}`;
        return `t:${this.tenantId}:${kind}${suffix}`;
    }

    /**
     * 前缀（用于列表/扫描）。
     * @param {string} kind
     * @returns {string}
     */
    prefix(kind) {
        return `t:${this.tenantId}:${kind}:`;
    }

    /**
     * 判断一个键是否属于本租户。
     * @param {string} key
     * @returns {boolean}
     */
    owns(key) {
        return typeof key === 'string' && key.startsWith(`t:${this.tenantId}:`);
    }
}

/**
 * 租户注册表与配额。
 */
export class TenantRegistry {
    /**
     * @param {object} [opts]
     * @param {object} [opts.quotaBackend] - 配额计数后端（跨实例）；缺省内存
     * @param {() => number} [opts.clock]
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        /** @type {Map<string, object>} */
        this._tenants = new Map();
        /** @type {Map<string, object>} */
        this._members = new Map();   // `${tenantId}\u0000${userId}` → { roles: [] }
        this._quota = opts.quotaBackend || new MemoryQuotaBackend({ clock: opts.clock });
        this._clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        this._stats = { created: 0, quotaDenied: 0, rbacDenied: 0, crossTenantDenied: 0 };
    }

    /**
     * 注册租户。
     *
     * @param {object} p
     * @param {string} p.tenantId
     * @param {string} [p.name]
     * @param {object} [p.quota]
     * @param {object} [p.secrets] - 租户密钥（仅存引用/指纹，不存明文）
     * @returns {object}
     */
    createTenant({ tenantId, name, quota, secrets }) {
        if (!tenantId || typeof tenantId !== 'string') {
            throw new Error('TenantRegistry.createTenant: tenantId 必须是非空字符串');
        }
        if (this._tenants.has(tenantId)) throw new Error(`TenantRegistry: 租户已存在 ${tenantId}`);
        const rec = {
            tenantId,
            name: name || tenantId,
            quota: { ...DEFAULT_QUOTA, ...(quota || {}) },
            secrets: secrets ? { ...secrets } : {},
            createdAt: nowCST(),
            enabled: true
        };
        this._tenants.set(tenantId, rec);
        this._stats.created++;
        return { ...rec };
    }

    /**
     * 取租户作用域（构造隔离键的唯一入口）。
     * @param {string} tenantId
     * @returns {TenantScope}
     */
    scope(tenantId) {
        if (!this._tenants.has(tenantId)) throw new Error(`TenantRegistry: 未知租户 ${tenantId}`);
        return new TenantScope(tenantId);
    }

    /** @param {string} tenantId @returns {object|null} */
    get(tenantId) {
        const t = this._tenants.get(tenantId);
        return t ? { ...t } : null;
    }

    /** @returns {string[]} */
    list() {
        return [...this._tenants.keys()].sort();
    }

    /** @param {string} tenantId @returns {boolean} */
    disable(tenantId) {
        const t = this._tenants.get(tenantId);
        if (!t) return false;
        t.enabled = false;
        return true;
    }

    /**
     * 授予成员角色。
     * @param {string} tenantId
     * @param {string} userId
     * @param {string[]} roles
     */
    grant(tenantId, userId, roles) {
        if (!this._tenants.has(tenantId)) throw new Error(`TenantRegistry: 未知租户 ${tenantId}`);
        const unknown = roles.filter((r) => !BUILTIN_RBAC[r]);
        if (unknown.length) throw new Error(`TenantRegistry: 未知角色 ${unknown.join(', ')}`);
        this._members.set(`${tenantId}\u0000${userId}`, { tenantId, userId, roles: [...roles] });
        return this._members.get(`${tenantId}\u0000${userId}`);
    }

    /**
     * 计算成员的有效权限集合。
     * @param {string} tenantId
     * @param {string} userId
     * @returns {Set<string>}
     */
    permissionsOf(tenantId, userId) {
        const m = this._members.get(`${tenantId}\u0000${userId}`);
        const perms = new Set();
        for (const r of m?.roles || []) {
            for (const p of BUILTIN_RBAC[r] || []) perms.add(p);
        }
        return perms;
    }

    /**
     * 鉴权。
     *
     * @param {object} p
     * @param {string} p.tenantId
     * @param {string} p.userId
     * @param {string} p.permission - 如 `task:write`
     * @returns {{allowed: boolean, reason?: string, permission: string}}
     */
    authorize({ tenantId, userId, permission }) {
        const t = this._tenants.get(tenantId);
        if (!t) return { allowed: false, reason: 'unknown-tenant', permission };
        if (!t.enabled) return { allowed: false, reason: 'tenant-disabled', permission };
        const perms = this.permissionsOf(tenantId, userId);
        const allowed = perms.has('*') || perms.has(permission);
        if (!allowed) this._stats.rbacDenied++;
        return { allowed, reason: allowed ? undefined : 'forbidden', permission };
    }

    /**
     * 跨租户访问检查：**返回"不存在"语义**（不区分"无权限"与"不存在"）。
     *
     * @param {object} p
     * @param {string} p.requesterTenant
     * @param {string} p.targetTenant
     * @returns {{ok: boolean, code?: number, message?: string}}
     */
    checkCrossTenant({ requesterTenant, targetTenant }) {
        if (requesterTenant === targetTenant) return { ok: true };
        this._stats.crossTenantDenied++;
        // 刻意用 404 语义：不泄露"该资源存在但不属于你"
        return { ok: false, code: 404, message: '资源不存在' };
    }

    /**
     * 配额检查（不消费）。
     * @param {object} p
     * @param {string} p.tenantId
     * @param {string} p.kind - `concurrentSessions` | `tasksPerDay` | `tokensPerDay`
     * @returns {Promise<{allowed: boolean, used: number, limit: number, reason?: string}>}
     */
    async checkQuota({ tenantId, kind }) {
        // 未知配额维度必须显式失败：原先 `_limitFor` 的 default 返回 0，
        // 而 `limit <= 0` 被当作"不限流"——于是拼错 kind（如 'tasksPerday'）
        // 会**静默关闭**该维度的配额，而不是报错。
        if (!QUOTA_KINDS.includes(kind)) {
            throw new Error(
                `TenantRegistry.checkQuota: 未知配额维度 "${kind}"；` +
                `可用：${QUOTA_KINDS.join(' | ')}`
            );
        }
        const t = this._tenants.get(tenantId);
        if (!t) return { allowed: false, used: 0, limit: 0, reason: 'unknown-tenant' };
        const limit = TenantRegistry._limitFor(t.quota, kind);
        const used = await this._quota.used(tenantId, kind);
        const allowed = limit <= 0 || used < limit;
        if (!allowed) this._stats.quotaDenied++;
        return { allowed, used, limit, reason: allowed ? undefined : 'quota-exceeded' };
    }

    /**
     * 消费配额（如新任务 +1、LLM 调用累计 token）。
     * @param {object} p
     * @param {string} p.tenantId
     * @param {string} p.kind
     * @param {number} [p.amount=1]
     * @returns {Promise<{allowed: boolean, used: number, limit: number, reason?: string}>}
     */
    async consumeQuota({ tenantId, kind, amount = 1 }) {
        const chk = await this.checkQuota({ tenantId, kind });
        if (!chk.allowed) return chk;
        const used = await this._quota.incr(tenantId, kind, amount);
        const limit = chk.limit;
        if (limit > 0 && used > limit) {
            // 超限时**回滚**，避免"被拒绝的请求也计入用量"（会让租户永久无法恢复）
            await this._quota.incr(tenantId, kind, -amount);
            this._stats.quotaDenied++;
            return { allowed: false, used: used - amount, limit, reason: 'quota-exceeded' };
        }
        return { allowed: true, used, limit };
    }

    /**
     * 释放并发类配额（会话结束）。
     * @param {object} p
     * @returns {Promise<void>}
     */
    async releaseQuota({ tenantId, kind, amount = 1 }) {
        await this._quota.incr(tenantId, kind, -amount);
    }

    /** @private */
    static _limitFor(quota, kind) {
        switch (kind) {
            case 'concurrentSessions': return quota.maxConcurrentSessions ?? 0;
            case 'tasksPerDay': return quota.maxTasksPerDay ?? 0;
            case 'tokensPerDay': return quota.maxTokensPerDay ?? 0;
            default: return 0;
        }
    }

    /** @returns {object} */
    getStats() {
        return { tenants: this._tenants.size, members: this._members.size, ...this._stats };
    }
}

/**
 * 内存配额后端（跨实例时应替换为 Redis 计数器 / 数据库行）。
 *
 * 本实现按"自然日"分桶：`tasksPerDay` / `tokensPerDay` 在跨日时自动归零，
 * 不需要定时清理任务（惰性分桶，避免"忘了跑清理脚本导致配额永不重置"）。
 */
export class MemoryQuotaBackend {
    /** @param {object} [opts] */
    constructor(opts = {}) {
        this._clock = typeof opts.clock === 'function' ? opts.clock : Date.now;
        /** @type {Map<string, number>} */
        this._counters = new Map();
        /** @type {Map<string, string>} `${tenant}\u0000${kind}` → 所属日 */
        this._bucket = new Map();
    }

    /** @private */
    _dayKey() {
        return new Date(this._clock()).toISOString().slice(0, 10);
    }

    /** @private */
    _isDaily(kind) {
        return kind === 'tasksPerDay' || kind === 'tokensPerDay';
    }

    /** @private */
    _key(tenantId, kind) {
        const k = `${tenantId}\u0000${kind}`;
        if (this._isDaily(kind)) {
            const day = this._dayKey();
            if (this._bucket.get(k) !== day) {
                this._bucket.set(k, day);
                this._counters.set(k, 0);   // 跨日归零
            }
        }
        return k;
    }

    async used(tenantId, kind) {
        return this._counters.get(this._key(tenantId, kind)) || 0;
    }

    async incr(tenantId, kind, amount) {
        const k = this._key(tenantId, kind);
        const next = Math.max(0, (this._counters.get(k) || 0) + amount);
        this._counters.set(k, next);
        return next;
    }
}

/**
 * 在租户上下文中执行（AsyncLocalStorage 传播）。
 *
 * 存储层从 `currentTenant()` 取租户，而不是从每个 API 的参数里取——
 * 参数会在某一条调用链上被漏传，上下文不会。
 *
 * @template T
 * @param {TenantScope} scope
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithTenant(scope, fn) {
    if (!(scope instanceof TenantScope)) {
        throw new Error('runWithTenant: 需要 TenantScope 实例');
    }
    return tenantStore.run(scope, fn);
}

/** @returns {TenantScope|undefined} 当前租户作用域 */
export function currentTenant() {
    return tenantStore.getStore();
}

/**
 * 断言当前存在租户上下文（存储层入口应调用）。
 * @returns {TenantScope}
 * @throws {Error} 无上下文时抛错（`code='ENO_TENANT'`）
 */
export function requireTenant() {
    const s = tenantStore.getStore();
    if (!s) {
        const err = new Error('缺少租户上下文：所有数据访问必须在 runWithTenant 内进行');
        err.code = 'ENO_TENANT';
        throw err;
    }
    return s;
}

export default TenantRegistry;
