/**
 * ServiceHost —— 6 个微服务的边界、路由与通用宿主（Phase 4）
 *
 * ## 为什么先定义"边界"再写代码
 *
 * 服务拆分的失败模式几乎总是同一个：**拆完之后服务之间互相直接读对方的表**
 * （共享数据库反模式），于是"微服务"只带来了网络开销，没有带来任何独立性。
 * 因此本模块把每个服务的**职责边界、拥有状态、对外接口**写成声明式数据：
 *
 * | 服务 | 拥有状态（只有它能写） | 对外接口 |
 * |---|---|---|
 * | `gateway-svc` | 租户/成员/配额 | 认证、鉴权、路由、审计入口 |
 * | `orchestrator-svc` | 任务与步骤状态机、租约 | 任务生命周期、DAG 调度 |
 * | `agent-runtime-svc` | 会话生命周期 | 角色会话执行、SKILL 加载 |
 * | `artifact-svc` | 产物对象与元数据 | 产物读写、检索 |
 * | `knowledge-svc` | 经验/规则/已知问题 | 检索、写入、去重 |
 * | `notify-svc` | 无（无状态扇出） | SSE 订阅、跨实例扇出 |
 *
 * 边界规则（本模块以 `owns` / `forbiddenDirectAccess` 显式记录，可被测试断言）：
 *   - 任何服务**不得**直接读写其他服务的状态；只能通过 HTTP/消息。
 *   - `notify-svc` 刻意无状态：有状态的推送服务会变成单点。
 *
 * ## 通用宿主做了什么
 *
 * 一个极简 HTTP 宿主，但把四件跨服务必须一致的事固化成中间件：
 *   1. **链路传播**：解析 `traceparent` → 建子跨度；响应头回写（便于前端/网关串联）。
 *   2. **租户解析**：从 `x-tenant-id` 解析租户并注入上下文；缺失即 400。
 *   3. **鉴权**：按 `权限` 声明校验（路由表里写清所需权限，而不是在 handler 里散落判断）。
 *   4. **审计**：写操作自动留痕（含 actor、租户、资源、结果）。
 *
 * 这四件事**分散在各服务里手写**是分布式系统的经典退化路径：每个服务各写一套，
 * 于是"某服务忘了校验租户"这类漏洞必然出现且无法系统性排查。
 */

import http from 'node:http';

import { nowCST } from '../../../core/cstTime.js';
import { Tracer } from './Trace.js';
import { runWithTenant, TenantScope } from './Tenant.js';

/** 服务名常量（供其它模块引用，避免字符串散落） */
export const SERVICES = Object.freeze({
    GATEWAY: 'gateway-svc',
    ORCHESTRATOR: 'orchestrator-svc',
    AGENT_RUNTIME: 'agent-runtime-svc',
    ARTIFACT: 'artifact-svc',
    KNOWLEDGE: 'knowledge-svc',
    NOTIFY: 'notify-svc'
});

/**
 * 6 个服务的声明式边界定义。
 *
 * `owns` 是"拥有状态"——只有该服务能写；`routes` 是"对外接口"——
 * 每条路由声明所需权限，宿主中间件据此统一鉴权。
 */
export const SERVICE_DEFINITIONS = Object.freeze({
    [SERVICES.GATEWAY]: Object.freeze({
        name: SERVICES.GATEWAY,
        summary: '认证、鉴权、租户路由、配额、审计入口',
        owns: ['tenant', 'membership', 'quota', 'audit'],
        forbiddenDirectAccess: ['task', 'session', 'artifact', 'knowledge'],
        portEnv: 'GATEWAY_PORT',
        defaultPort: 8080,
        routes: Object.freeze([
            { method: 'GET', path: '/health', permission: null },
            { method: 'POST', path: '/auth/token', permission: null },
            { method: 'GET', path: '/tenants', permission: 'tenant:manage' },
            { method: 'POST', path: '/tenants', permission: 'tenant:manage' },
            { method: 'GET', path: '/audit', permission: 'audit:read' },
            { method: 'GET', path: '/quota', permission: 'stats:read' }
        ])
    }),
    [SERVICES.ORCHESTRATOR]: Object.freeze({
        name: SERVICES.ORCHESTRATOR,
        summary: '任务生命周期、DAG 调度、状态机、租约持有',
        owns: ['task', 'step', 'lease'],
        forbiddenDirectAccess: ['tenant', 'artifact-content', 'knowledge'],
        portEnv: 'ORCHESTRATOR_PORT',
        defaultPort: 8081,
        routes: Object.freeze([
            { method: 'GET', path: '/health', permission: null },
            { method: 'POST', path: '/tasks', permission: 'task:write' },
            { method: 'GET', path: '/tasks/:taskId', permission: 'task:read' },
            { method: 'POST', path: '/tasks/:taskId/abort', permission: 'task:control' },
            { method: 'GET', path: '/tasks/:taskId/progress', permission: 'task:read' },
            { method: 'GET', path: '/leases', permission: 'task:read' }
        ])
    }),
    [SERVICES.AGENT_RUNTIME]: Object.freeze({
        name: SERVICES.AGENT_RUNTIME,
        summary: 'Agent 角色会话执行、session 生命周期、SKILL 加载',
        owns: ['session'],
        forbiddenDirectAccess: ['task-state', 'tenant', 'artifact-content'],
        portEnv: 'AGENT_RUNTIME_PORT',
        defaultPort: 8082,
        routes: Object.freeze([
            { method: 'GET', path: '/health', permission: null },
            { method: 'POST', path: '/sessions', permission: 'task:write' },
            { method: 'GET', path: '/sessions/:sessionId', permission: 'task:read' },
            { method: 'POST', path: '/sessions/:sessionId/abort', permission: 'task:control' },
            { method: 'GET', path: '/skills', permission: 'task:read' }
        ])
    }),
    [SERVICES.ARTIFACT]: Object.freeze({
        name: SERVICES.ARTIFACT,
        summary: '产物存储（对象存储）与元数据检索',
        owns: ['artifact', 'artifact-meta'],
        forbiddenDirectAccess: ['task-state', 'tenant', 'session'],
        portEnv: 'ARTIFACT_PORT',
        defaultPort: 8083,
        routes: Object.freeze([
            { method: 'GET', path: '/health', permission: null },
            { method: 'PUT', path: '/artifacts/:key', permission: 'artifact:write' },
            { method: 'GET', path: '/artifacts/:key', permission: 'artifact:read' },
            { method: 'GET', path: '/artifacts', permission: 'artifact:read' }
        ])
    }),
    [SERVICES.KNOWLEDGE]: Object.freeze({
        name: SERVICES.KNOWLEDGE,
        summary: '经验/规则/已知问题知识库、检索与去重',
        owns: ['knowledge', 'badcase'],
        forbiddenDirectAccess: ['task-state', 'session', 'tenant'],
        portEnv: 'KNOWLEDGE_PORT',
        defaultPort: 8084,
        routes: Object.freeze([
            { method: 'GET', path: '/health', permission: null },
            { method: 'GET', path: '/search', permission: 'knowledge:read' },
            { method: 'POST', path: '/experiences', permission: 'knowledge:write' },
            { method: 'GET', path: '/rules', permission: 'knowledge:read' }
        ])
    }),
    [SERVICES.NOTIFY]: Object.freeze({
        name: SERVICES.NOTIFY,
        summary: 'SSE / WebSocket 推送（跨实例扇出）——刻意无状态',
        owns: [],
        forbiddenDirectAccess: ['task-state', 'session', 'artifact-content', 'knowledge', 'tenant-write'],
        portEnv: 'NOTIFY_PORT',
        defaultPort: 8085,
        routes: Object.freeze([
            { method: 'GET', path: '/health', permission: null },
            { method: 'GET', path: '/stream/:channel', permission: 'task:read' },
            { method: 'POST', path: '/publish', permission: 'task:control' }
        ])
    })
});

/**
 * 校验服务边界定义的自洽性。
 *
 * 这几条检查看似"形式主义"，但每一条都对应一个真实的架构退化：
 *   - 同一状态被两个服务 `owns` → 迟早出现双写冲突；
 *   - 某服务 `forbiddenDirectAccess` 里出现自己 `owns` 的东西 → 定义自相矛盾；
 *   - `owns` 与 `forbiddenDirectAccess` 完全无关 → 边界没想清楚（有状态却谁也不禁止）。
 *
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateServiceBoundaries() {
    const errors = [];
    const warnings = [];
    const owners = new Map();

    for (const def of Object.values(SERVICE_DEFINITIONS)) {
        for (const s of def.owns) {
            if (!owners.has(s)) owners.set(s, []);
            owners.get(s).push(def.name);
        }
    }
    for (const [state, list] of owners) {
        if (list.length > 1) {
            errors.push(`状态 "${state}" 被多个服务声明拥有：${list.join(', ')}`);
        }
    }
    for (const def of Object.values(SERVICE_DEFINITIONS)) {
        const overlap = def.owns.filter((s) => def.forbiddenDirectAccess.includes(s));
        if (overlap.length) {
            errors.push(`${def.name} 同时 owns 与 forbiddenDirectAccess 了 ${overlap.join(', ')}`);
        }
        if (def.owns.length === 0 && !def.name.endsWith('notify-svc')) {
            warnings.push(`${def.name} 不拥有任何状态——请确认它确实是无状态服务`);
        }
        if (def.owns.length > 0 && def.forbiddenDirectAccess.length === 0) {
            warnings.push(`${def.name} 有状态但未声明任何"禁止直接访问"——边界未闭合`);
        }
        for (const r of def.routes) {
            if (r.path.startsWith('/health') && r.permission !== null) {
                errors.push(`${def.name} 的 /health 不应要求权限（否则编排器的健康检查会失败）`);
            }
        }
    }
    return { ok: errors.length === 0, errors, warnings };
}

/**
 * 简单的路径匹配（支持 `:param`）。
 * @param {string} pattern
 * @param {string} path
 * @returns {object|null} 匹配则返回参数表
 */
export function matchRoute(pattern, path) {
    const p = pattern.split('/');
    const q = path.split('/');
    if (p.length !== q.length) return null;
    const params = {};
    for (let i = 0; i < p.length; i++) {
        if (p[i].startsWith(':')) {
            if (!q[i]) return null;
            params[p[i].slice(1)] = decodeURIComponent(q[i]);
        } else if (p[i] !== q[i]) {
            return null;
        }
    }
    return params;
}

/**
 * 通用服务宿主。
 *
 * 只实现"所有服务都必须一致的四件事"（链路/租户/鉴权/审计），
 * 业务 handler 由各服务注入。刻意**不**做 ORM、不做服务发现、不做重试框架——
 * 那些是真实部署里更该交给基础设施（sidecar / ingress）的部分。
 */
export class ServiceHost {
    /**
     * @param {object} opts
     * @param {object} opts.definition   - `SERVICE_DEFINITIONS` 之一
     * @param {string} [opts.instanceId]
     * @param {object} [opts.tenants]    - `TenantRegistry`
     * @param {object} [opts.audit]      - `AuditLog`
     * @param {object} [opts.tracer]     - `Tracer`
     * @param {object} [opts.handlers]   - `{ 'GET /health': fn }`
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        if (!opts.definition) throw new Error('ServiceHost: definition 为必填');
        this.definition = opts.definition;
        this.instanceId = opts.instanceId || `${opts.definition.name}#${process.pid}`;
        this.tenants = opts.tenants || null;
        this.audit = opts.audit || null;
        this.tracer = opts.tracer || new Tracer({ service: opts.definition.name });
        this.handlers = opts.handlers || {};
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        this._server = null;
        /** @type {Map<string, number>} 指标：路由 → 调用次数 */
        this._metrics = new Map();
        this._stats = { requests: 0, errors: 0, denied403: 0, denied400: 0, notFound: 0 };
    }

    /** @returns {string} */
    get name() {
        return this.definition.name;
    }

    /** @returns {number} */
    get port() {
        const fromEnv = Number(process.env[this.definition.portEnv]);
        return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : this.definition.defaultPort;
    }

    /**
     * 处理一个请求（**不依赖网络**，因此可被单元测试直接调用）。
     *
     * @param {object} req - `{method, path, headers, body}`
     * @returns {Promise<{status: number, headers: object, body: any}>}
     */
    async handle(req) {
        const t0 = Date.now();
        this._stats.requests++;
        const method = String(req.method || 'GET').toUpperCase();
        const path = String(req.path || '/');
        const headers = req.headers || {};

        // 链路：解析上游 traceparent，建本服务子跨度
        const traceparent = headers.traceparent || headers.traceParent || null;
        const span = this.tracer.startSpan({
            name: `${method} ${path}`,
            traceparent,
            attributes: { service: this.name, instance: this.instanceId }
        });
        const respHeaders = {};

        try {
            // 路由匹配
            let matched = null;
            for (const r of this.definition.routes) {
                if (r.method !== method) continue;
                const params = matchRoute(r.path, path);
                if (params) { matched = { route: r, params }; break; }
            }
            if (!matched) {
                this._stats.notFound++;
                span.setAttribute('outcome', 'not-found');
                return this._respond(404, { error: 'NOT_FOUND', message: `未知路由 ${method} ${path}` }, respHeaders, span, t0);
            }

            // /health 免鉴权与免租户（否则编排器的探活会被鉴权拦下）
            const isPublic = matched.route.permission === null;

            let scope = null;
            if (!isPublic) {
                const tenantId = headers['x-tenant-id'] || headers['X-Tenant-Id'];
                if (!tenantId) {
                    this._stats.denied400++;
                    span.setAttribute('outcome', 'missing-tenant');
                    return this._respond(400, { error: 'TENANT_REQUIRED', message: '缺少 x-tenant-id' }, respHeaders, span, t0);
                }
                if (this.tenants) {
                    try {
                        scope = new TenantScope(tenantId);
                    } catch (err) {
                        this._stats.denied400++;
                        return this._respond(400, { error: 'BAD_TENANT', message: err.message }, respHeaders, span, t0);
                    }
                    const userId = headers['x-user-id'] || 'anonymous';
                    const auth = this.tenants.authorize({
                        tenantId, userId, permission: matched.route.permission
                    });
                    if (!auth.allowed) {
                        this._stats.denied403++;
                        span.setAttribute('outcome', 'forbidden');
                        // 审计：鉴权失败必须留痕（这是安全事件，不是普通错误）
                        this.audit?.append({
                            actor: userId, tenantId, action: 'rbac.deny',
                            resource: `${method} ${path}`, outcome: 'denied',
                            detail: { permission: matched.route.permission, reason: auth.reason }
                        });
                        return this._respond(403, {
                            error: 'FORBIDDEN',
                            message: `缺少权限 ${matched.route.permission}`
                        }, respHeaders, span, t0);
                    }
                }
            }

            // 执行（在租户上下文中，使存储层能从上下文取租户）
            const key = `${method} ${matched.route.path}`;
            this._metrics.set(key, (this._metrics.get(key) || 0) + 1);
            const handler = this.handlers[key] || this.handlers[`${method} ${path}`];
            const ctx = {
                params: matched.params,
                tenantId: headers['x-tenant-id'] || null,
                userId: headers['x-user-id'] || 'anonymous',
                traceId: span.traceId,
                spanId: span.spanId,
                traceparent: this.tracer.inject(span),
                instanceId: this.instanceId,
                body: req.body ?? null,
                query: req.query || {}
            };

            let out;
            if (typeof handler === 'function') {
                out = scope ? await runWithTenant(scope, () => handler(ctx)) : await handler(ctx);
            } else {
                // 未实现的路由：显式 501，而不是假装成功——避免"接口看起来通了"
                out = { status: 501, body: { error: 'NOT_IMPLEMENTED', message: `${key} 未接入实现` } };
            }

            const status = out?.status ?? 200;

            // 审计：写操作自动留痕（读操作量大，由各服务按需自行记录）
            if (this.audit && method !== 'GET' && !isPublic) {
                this.audit.append({
                    actor: ctx.userId,
                    tenantId: ctx.tenantId || 'unknown',
                    action: `${this.name}.${method.toLowerCase()}`,
                    resource: path,
                    outcome: status < 400 ? 'ok' : 'error',
                    detail: { status, traceId: span.traceId, permission: matched.route.permission }
                });
            }

            span.setAttribute('outcome', status < 400 ? 'ok' : 'error');
            span.setAttribute('http.status', status);
            if (status >= 400) this._stats.errors++;
            return this._respond(status, out?.body ?? out ?? {}, respHeaders, span, t0);
        } catch (err) {
            this._stats.errors++;
            span.setError(err);
            return this._respond(500, { error: 'INTERNAL', message: err.message }, respHeaders, span, t0);
        }
    }

    /**
     * 组装响应并结束跨度。
     * @private
     */
    _respond(status, body, headers, span, t0) {
        // 链路回写：便于网关/前端把整条链拼起来
        headers['traceparent'] = this.tracer.inject(span);
        headers['x-service'] = this.name;
        headers['x-instance'] = this.instanceId;
        this.tracer.endSpan(span);
        return {
            status,
            headers,
            body: { ...body, traceId: span.traceId, durationMs: Date.now() - t0 }
        };
    }

    /**
     * 启动真实 HTTP 服务（部署时使用；测试走 `handle()` 不启端口）。
     *
     * @returns {Promise<{port: number, url: string, close: () => Promise<void>}>}
     */
    async listen() {
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', async () => {
                let body = null;
                const raw = Buffer.concat(chunks).toString('utf8');
                if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
                const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
                const out = await this.handle({
                    method: req.method,
                    path: url.pathname,
                    headers: req.headers,
                    body,
                    query: Object.fromEntries(url.searchParams)
                });
                res.writeHead(out.status, { 'content-type': 'application/json', ...out.headers });
                res.end(JSON.stringify(out.body));
            });
        });
        this._server = server;
        await new Promise((resolve) => server.listen(this.port, '127.0.0.1', resolve));
        const addr = server.address();
        return {
            port: addr.port,
            url: `http://127.0.0.1:${addr.port}`,
            close: () => new Promise((resolve) => server.close(() => resolve()))
        };
    }

    /** @returns {Promise<void>} */
    async close() {
        if (this._server) {
            await new Promise((resolve) => this._server.close(() => resolve()));
            this._server = null;
        }
    }

    /** @returns {object} */
    getStats() {
        return {
            service: this.name,
            instanceId: this.instanceId,
            startedAt: nowCST(),
            ...this._stats,
            routes: this.definition.routes.length,
            metrics: Object.fromEntries(this._metrics),
            trace: this.tracer.getStats()
        };
    }

    /** @private */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[${this.name}] ${msg}`);
    }
}

export default ServiceHost;
