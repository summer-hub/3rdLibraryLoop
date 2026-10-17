/**
 * bootstrap.js —— 服务启动入口（Phase 4）
 *
 * 用法：
 *   node Server/Distributed/bootstrap.js <service-name> [--port 8080]
 *   node Server/Distributed/bootstrap.js --list
 *
 * K8s / docker-compose 清单里的 `command` 指向本文件——**由一致性用例守护**：
 * 清单引用的入口与端口必须与 `SERVICE_DEFINITIONS` 对得上，
 * 否则会出现"Pod 起不来但清单看起来没问题"这类只能在集群里发现的错误。
 *
 * ## 后端的选取策略
 *
 * 由 `DISTRIBUTED_*` 环境变量决定（默认全部 memory）：
 *   - `memory`：进程内参考实现。**单实例可用**，多实例会各自为政（每个实例都有自己的
 *     租约表/令牌桶），因此仅用于本地开发与测试；
 *   - `postgres` / `redis` / `redis-streams`：真实后端，需要相应环境变量（URL）。
 *
 * 启动时会**显式打印当前后端**并在 `memory` 且声明了 `POD_NAME`（即运行在集群里）时
 * 打警告——"单实例语义在集群里静默运行"是最危险的状态：任务可能被两个实例同时执行，
 * 而日志里没有任何异常迹象。
 */

import http from 'node:http';

import { nowCST } from '../../../core/cstTime.js';
import { LeaseStore, PostgresLeaseBackend } from './Lease.js';
import { MessageQueue, RedisStreamsBackend } from './Queue.js';
import { DistributedSemaphore, RedisTokenBackend } from './Semaphore.js';
import { Tracer } from './Trace.js';
import { TenantRegistry } from './Tenant.js';
import { CostMeter, AuditLog } from './Governance.js';
import { NotifyFanout, MemoryPubSubBackend } from './Notify.js';
import { ServiceHost, SERVICE_DEFINITIONS, SERVICES, validateServiceBoundaries } from './ServiceHost.js';

/**
 * 构建一个服务的运行环境（依赖注入）。
 *
 * 抽成独立函数是为了让测试可以**直接构造运行时并调用 `host.handle()`**，
 * 不需要真的监听端口——否则每个服务语义的测试都要占用端口、互相干扰。
 *
 * @param {object} opts
 * @param {string} opts.serviceName
 * @param {string} [opts.instanceId]
 * @param {object} [opts.backends] - 覆盖后端（测试注入）
 * @param {(channel: string, eventType: string, data: object) => void} [opts.localSink]
 * @param {(level: string, msg: string) => void} [opts.logger]
 * @returns {Promise<{host: ServiceHost, deps: object, warnings: string[]}>}
 */
export async function createRuntime(opts) {
    const definition = SERVICE_DEFINITIONS[opts.serviceName];
    if (!definition) {
        throw new Error(
            `未知服务 "${opts.serviceName}"；可用：${Object.keys(SERVICE_DEFINITIONS).join(', ')}`
        );
    }
    const warnings = [];
    const be = opts.backends || {};
    const instanceId = opts.instanceId || process.env.POD_NAME || `local-${process.pid}`;

    // ── 后端装配 ──
    // 真实后端是**异步**加载的（动态 import 可选客户端，见 loadOptionalModule）：
    // 客户端缺失时抛错让服务启动失败，而不是静默退回内存语义。
    const leaseBackend = be.lease
        || (be.leaseBackendName === 'postgres' || process.env.DISTRIBUTED_LEASE === 'postgres'
            ? await createPostgresBackend()
            : undefined);

    const leases = new LeaseStore({
        backend: leaseBackend,
        ttlMs: Number.isFinite(opts.leaseTtlMs) && opts.leaseTtlMs > 0 ? opts.leaseTtlMs : undefined,
        logger: opts.logger ?? null
    });

    const queueBackend = be.queue
        || (be.queueBackendName === 'redis-streams' || process.env.DISTRIBUTED_QUEUE === 'redis-streams'
            ? await createRedisStreamsBackend()
            : undefined);

    const queue = new MessageQueue({ backend: queueBackend, logger: opts.logger ?? null });

    const tokenBackend = be.token
        || (be.tokenBackendName === 'redis' || process.env.DISTRIBUTED_TOKEN === 'redis'
            ? await createRedisTokenBackend()
            : undefined);

    const tokens = new DistributedSemaphore({
        backend: tokenBackend,
        limit: Number(process.env.MAX_CONCURRENT_SESSIONS) || 0,
        logger: opts.logger ?? null
    });

    const tenants = new TenantRegistry({ logger: opts.logger ?? null });
    const cost = new CostMeter({ logger: opts.logger ?? null });
    const audit = new AuditLog();
    const tracer = new Tracer({
        service: opts.serviceName,
        sampleRate: Number(process.env.TRACE_SAMPLE_RATE ?? 1)
    });
    const pubsub = be.pubsub || new MemoryPubSubBackend();
    const notify = new NotifyFanout({
        instanceId,
        backend: pubsub,
        localSink: opts.localSink,
        logger: opts.logger ?? null
    });

    // ── 后端一致性告警（避免"集群里跑着单实例语义"）──
    const inCluster = !!process.env.POD_NAME || !!process.env.KUBERNETES_SERVICE_HOST;
    if (inCluster && !leaseBackend) {
        warnings.push(
            '运行在集群中但租约后端是 memory：**每个实例都有独立的租约表**，' +
            '同一任务可能被两个实例同时执行。请设置 DISTRIBUTED_LEASE=postgres。'
        );
    }
    if (inCluster && !tokenBackend) {
        warnings.push(
            '运行在集群中但令牌后端是 memory：全局并发上限会被放大 N 倍。' +
            '请设置 DISTRIBUTED_TOKEN=redis。'
        );
    }
    if (inCluster && !queueBackend) {
        warnings.push(
            '运行在集群中但队列后端是 memory：跨实例消息无法送达，' +
            'notify-svc 的跨实例扇出会失效。请设置 DISTRIBUTED_QUEUE=redis-streams。'
        );
    }

    const deps = { leases, queue, tokens, tenants, cost, audit, tracer, notify, pubsub, instanceId };

    const handlerInfo = buildHandlers(opts.serviceName, deps);
    const host = new ServiceHost({
        definition,
        instanceId,
        tenants,
        audit,
        tracer,
        handlers: handlerInfo.handlers,
        logger: opts.logger ?? null
    });
    handlerInfo.attach?.(host);
    if (handlerInfo.warnings) warnings.push(...handlerInfo.warnings);
    host._pubsub = pubsub;
    host._deps = deps;
    /**
     * 服务级资源清理（如租约心跳定时器）。由宿主在停机时调用——
     * 不接上的话心跳会一直续租到进程退出为止（并在释放后继续空转告警）。
     */
    host._closeExtras = typeof handlerInfo.close === 'function' ? handlerInfo.close : null;

    return { host, deps, warnings };
}

/**
 * 各服务的路由实现。
 *
 * 注意这里**没有**实现全部业务逻辑（那需要接入 Phase 1~3 的既有模块与真实基础设施）。
 * 实现的是"服务能否被正确编排起来"所必需的部分：健康检查、租约查询、任务登记等。
 * 其余路由返回 501（`ServiceHost` 的默认行为）——**显式未实现好过假装可用**。
 *
 * @param {string} serviceName
 * @param {object} deps
 * @returns {{handlers: object, attach?: Function, warnings?: string[]}}
 */
function buildHandlers(serviceName, deps) {
    const warnings = [];
    const base = {
        'GET /health': async () => ({
            status: 200,
            body: {
                ok: true,
                service: serviceName,
                at: nowCST(),
                distributed: {
                    lease: deps.leases.backend.constructor.name,
                    token: deps.tokens.backend.constructor.name,
                    queue: deps.queue.backend.constructor.name
                }
            }
        })
    };

    switch (serviceName) {
        case SERVICES.ORCHESTRATOR: {
            /**
             * 租约心跳台账：resource → 续租定时器。
             *
             * 为什么必须有：`POST /tasks` 取的租约 TTL 只有 30s，而任务动辄跑几十分钟。
             * 没有心跳时租约会在 30s 后过期，另一个实例的 `POST /tasks` 就能把它接管走
             * → **同一任务被两个实例同时执行**。这正是模块头部宣称的"心跳续租"语义，
             * 此前只有 `renew()` 实现、无人调用。
             * @type {Map<string, {timer: any, owner: string, fencingToken: number, ttlMs: number}>}
             */
            const heartbeats = new Map();

            const stopHeartbeat = (resource) => {
                const h = heartbeats.get(resource);
                if (!h) return false;
                clearInterval(h.timer);
                heartbeats.delete(resource);
                return true;
            };

            const startHeartbeat = (resource, owner, fencingToken, ttlMs) => {
                stopHeartbeat(resource);
                // 续租间隔 = TTL 的 1/3（容忍两次丢包），并有下限避免低 TTL 下打爆后端
                const intervalMs = Math.max(50, Math.floor(ttlMs / 3));
                const timer = setInterval(() => {
                    deps.leases.renew({ resource, owner, fencingToken, ttlMs }).then((r) => {
                        if (r.ok) return;
                        // 续租失败 = 本实例已失去所有权（被接管/已过期/后端不可用）。
                        // 必须停表并显式告警：继续"以为还持有"就是僵死写入者的教科书场景。
                        stopHeartbeat(resource);
                        console.warn(
                            `[${serviceName}] 租约续租失败，已停止心跳: ${resource} (${r.reason || 'unknown'})`
                        );
                    }).catch((err) => {
                        // 单次异常不致命：下个周期会重试（只有明确失败才停表）
                        console.warn(`[${serviceName}] 租约续租异常: ${resource} ${err.message}`);
                    });
                }, intervalMs);
                // 不阻止进程退出（服务空闲时不该因为一个心跳定时器而挂着）
                timer.unref?.();
                heartbeats.set(resource, { timer, owner, fencingToken, ttlMs });
                return intervalMs;
            };

            return {
                warnings,
                /** 停机时清掉所有心跳定时器（由 bootstrap 的 shutdown 与测试调用） */
                close: () => {
                    for (const [resource] of heartbeats) stopHeartbeat(resource);
                },
                handlers: {
                    ...base,
                    'GET /leases': async (ctx) => ({
                        status: 200,
                        body: {
                            // 按租户可见性过滤：跨租户的租约不返回
                            leases: (await deps.leases.list()).filter((l) =>
                                ctx.tenantId ? l.resource.startsWith(`task:${ctx.tenantId}:`) : true),
                            stats: deps.leases.getStats(),
                            // 本实例正在续租的资源（运维视角：一眼看出"心跳还在不在"）
                            heartbeats: [...heartbeats.keys()]
                        }
                    }),
                    'POST /tasks': async (ctx) => {
                        const taskId = ctx.body?.taskId || `task-${Date.now().toString(36)}`;
                        // 租户隔离的键：业务代码无法构造"裸键"
                        const resource = `task:${ctx.tenantId}:${taskId}`;
                        // 配额：并发会话 + 每日任务数
                        const q1 = await deps.tenants.consumeQuota({
                            tenantId: ctx.tenantId, kind: 'tasksPerDay'
                        });
                        if (!q1.allowed) {
                            return { status: 429, body: { error: 'QUOTA_EXCEEDED', ...q1 } };
                        }
                        const got = await deps.leases.acquire({ resource, owner: ctx.instanceId });
                        if (!got.ok) {
                            return { status: 409, body: { error: 'TASK_LOCKED', reason: got.reason } };
                        }
                        // 取到租约后**立刻起心跳**，否则 TTL 一到就会被其他实例接管
                        const heartbeatMs = startHeartbeat(
                            resource, ctx.instanceId, got.lease.fencingToken, deps.leases.ttlMs
                        );
                        return {
                            status: 201,
                            body: {
                                taskId,
                                resource,
                                fencingToken: got.lease.fencingToken,
                                expiresAt: got.lease.expiresAt,
                                heartbeatMs
                            }
                        };
                    },
                    'GET /tasks/:taskId': async (ctx) => {
                        const lease = await deps.leases.peek(`task:${ctx.tenantId}:${ctx.params.taskId}`);
                        if (!lease) return { status: 404, body: { error: 'NOT_FOUND' } };
                        return { status: 200, body: { taskId: ctx.params.taskId, lease } };
                    },
                    'POST /tasks/:taskId/abort': async (ctx) => {
                        const resource = `task:${ctx.tenantId}:${ctx.params.taskId}`;
                        const lease = await deps.leases.peek(resource);
                        if (!lease) return { status: 404, body: { error: 'NOT_FOUND' } };
                        // 只有能提供正确围栏令牌的调用方才能释放（防止旧持有者/越权释放）
                        const token = Number(ctx.body?.fencingToken);
                        const released = await deps.leases.release({
                            resource, owner: ctx.body?.owner || lease.owner, fencingToken: token
                        });
                        if (!released) {
                            return { status: 409, body: { error: 'FENCE_MISMATCH', current: lease.fencingToken } };
                        }
                        // 释放成功 → 必须同时停心跳，否则续租会对着已删除的租约空转
                        const heartbeatStopped = stopHeartbeat(resource);
                        return {
                            status: 200,
                            body: { aborted: true, taskId: ctx.params.taskId, heartbeatStopped }
                        };
                    }
                }
            };
        }

        case SERVICES.NOTIFY:
            return {
                warnings,
                handlers: {
                    ...base,
                    'GET /stream/:channel': async (ctx) => {
                        // 订阅该频道并返回当前实例的连接信息。
                        // 真实 SSE 需要在 HTTP 层保持连接（见 Server/Routes/sse/SseHub.js），
                        // 这里的 handler 只负责"订阅频道"这一步，便于无网络测试。
                        await deps.notify.subscribeChannel(ctx.params.channel);
                        return {
                            status: 200,
                            body: {
                                subscribed: true,
                                channel: ctx.params.channel,
                                instanceId: deps.instanceId,
                                subscribers: deps.notify.getStats().channels
                            }
                        };
                    },
                    'POST /publish': async (ctx) => {
                        const r = await deps.notify.publish({
                            channel: ctx.body?.channel,
                            eventType: ctx.body?.eventType || 'message',
                            data: ctx.body?.data || {},
                            tenantId: ctx.tenantId,
                            traceparent: ctx.traceparent
                        });
                        return { status: 200, body: r };
                    }
                }
            };

        case SERVICES.GATEWAY:
            return {
                warnings,
                handlers: {
                    ...base,
                    'POST /auth/token': async (ctx) => {
                        const tenantId = ctx.body?.tenantId;
                        const userId = ctx.body?.userId;
                        if (!tenantId || !userId) {
                            return { status: 400, body: { error: 'BAD_REQUEST', message: 'tenantId 与 userId 必填' } };
                        }
                        const t = deps.tenants.get(tenantId);
                        if (!t) return { status: 404, body: { error: 'UNKNOWN_TENANT' } };
                        // 令牌本身由真实鉴权服务签发；这里返回"该身份具备哪些权限"，
                        // 使下游服务可以本地校验而无需回查（权限是幂等的、可缓存）
                        return {
                            status: 200,
                            body: {
                                tenantId,
                                userId,
                                permissions: [...deps.tenants.permissionsOf(tenantId, userId)],
                                issuedAt: nowCST()
                            }
                        };
                    },
                    'GET /tenants': async () => ({
                        status: 200,
                        body: { tenants: deps.tenants.list(), stats: deps.tenants.getStats() }
                    }),
                    'POST /tenants': async (ctx) => {
                        const t = deps.tenants.createTenant({
                            tenantId: ctx.body?.tenantId,
                            name: ctx.body?.name,
                            quota: ctx.body?.quota
                        });
                        return { status: 201, body: t };
                    },
                    'GET /audit': async (ctx) => ({
                        status: 200,
                        body: {
                            entries: deps.audit.query({ tenantId: ctx.tenantId, limit: Number(ctx.query.limit) || 50 }),
                            // 审计读取时**连带返回链校验结果**：审计日志本身是否可信，
                            // 是读取方最关心的事，不该要求他们另发一次请求
                            integrity: deps.audit.verify(),
                            head: deps.audit.getChainHead()
                        }
                    }),
                    'GET /quota': async (ctx) => ({
                        status: 200,
                        body: {
                            tenantId: ctx.tenantId,
                            concurrentSessions: await deps.tenants.checkQuota({
                                tenantId: ctx.tenantId, kind: 'concurrentSessions'
                            }),
                            tasksPerDay: await deps.tenants.checkQuota({
                                tenantId: ctx.tenantId, kind: 'tasksPerDay'
                            }),
                            tokensPerDay: await deps.tenants.checkQuota({
                                tenantId: ctx.tenantId, kind: 'tokensPerDay'
                            }),
                            cost: deps.cost.report({ tenantId: ctx.tenantId, by: 'purpose' })
                        }
                    })
                }
            };

        case SERVICES.AGENT_RUNTIME: {
            /**
             * 会话台账：sessionId → 已占用的令牌与配额。
             *
             * 这是"借了必须还"的唯一凭据来源：没有它，令牌只能等 15 分钟 TTL 自然过期，
             * 而租户的 concurrentSessions 配额**没有过期机制**——一旦开满就永久 429
             *（只有重启进程才能恢复）。因此 `POST /sessions/:id/abort` 必须能查到
             * 对应记录并显式归还两者。
             * @type {Map<string, {lease: object, tenantId: string, role: string, startedAt: number}>}
             */
            const sessions = new Map();

            /** 会话台账的兜底 TTL：客户端从不调用 abort 时也不能永久占额（默认 90 分钟，与单步会话上限一致） */
            const sessionTtlMs = (() => {
                const n = Number(process.env.SESSION_RECORD_TTL_MS);
                return Number.isFinite(n) && n > 0 ? n : 90 * 60 * 1000;
            })();

            /** 惰性清扫：只顺带释放"确实没被归还"的陈旧记录，避免台账无界增长 */
            const sweepStaleSessions = async () => {
                const now = Date.now();
                for (const [sid, rec] of [...sessions]) {
                    if (now - rec.startedAt <= sessionTtlMs) continue;
                    sessions.delete(sid);
                    try { await rec.lease.release(); } catch { /* 已过期/已被回收 */ }
                    try {
                        await deps.tenants.releaseQuota({ tenantId: rec.tenantId, kind: 'concurrentSessions' });
                    } catch { /* 配额后端异常不应阻断清扫 */ }
                    console.warn(`[${serviceName}] 会话台账超期回收: sessionId=${sid}（超过 ${sessionTtlMs}ms 未归还）`);
                }
            };

            return {
                warnings,
                handlers: {
                    ...base,
                    'GET /skills': async () => ({
                        status: 200,
                        body: { note: 'SKILL 清单由 Server/Skills 提供，需挂载只读卷', count: null }
                    }),
                    'POST /sessions': async (ctx) => {
                        await sweepStaleSessions();

                        // 分布式令牌：全局并发上限在**跨实例**层面生效
                        const lease = await deps.tokens.acquire({
                            dimension: `role:${ctx.body?.role || 'coder'}`,
                            timeoutMs: Number(ctx.body?.timeoutMs) || 5000
                        });
                        if (!lease.ok) {
                            return { status: 429, body: { error: 'CONCURRENCY_LIMIT', waitedMs: lease.waitedMs } };
                        }
                        const q = await deps.tenants.consumeQuota({
                            tenantId: ctx.tenantId, kind: 'concurrentSessions'
                        });
                        if (!q.allowed) {
                            await lease.release();
                            return { status: 429, body: { error: 'QUOTA_EXCEEDED', ...q } };
                        }

                        // 会话 id 必须唯一：只用时间戳会在同毫秒并发下碰撞，
                        // 而台账按 id 索引——碰撞会让一次 abort 释放掉别人的令牌。
                        const sessionId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                        sessions.set(sessionId, {
                            lease,
                            tenantId: ctx.tenantId,
                            role: ctx.body?.role || 'coder',
                            startedAt: Date.now()
                        });

                        return {
                            status: 201,
                            body: {
                                sessionId,
                                role: ctx.body?.role || 'coder',
                                tokenId: lease.tokenId,
                                waitedMs: lease.waitedMs,
                                releaseHint: 'POST /sessions/:id/abort 会释放令牌与并发配额'
                            }
                        };
                    },
                    'POST /sessions/:sessionId/abort': async (ctx) => {
                        const sid = ctx.params.sessionId;
                        const rec = sessions.get(sid);
                        if (!rec) {
                            // 已归还 / 从未登记 / 已被超期清扫：显式区分于"释放成功"，
                            // 避免调用方把"什么都没释放"当成成功。
                            return {
                                status: 404,
                                body: { error: 'SESSION_NOT_FOUND', message: '会话不存在或已归还', sessionId: sid }
                            };
                        }
                        sessions.delete(sid);

                        let tokenReleased = false;
                        try {
                            tokenReleased = (await rec.lease.release()) !== false;
                        } catch (err) {
                            console.warn(`[${serviceName}] 释放令牌失败: sessionId=${sid} ${err.message}`);
                        }
                        let quotaReleased = false;
                        try {
                            await deps.tenants.releaseQuota({
                                tenantId: rec.tenantId, kind: 'concurrentSessions'
                            });
                            quotaReleased = true;
                        } catch (err) {
                            console.warn(`[${serviceName}] 释放并发配额失败: sessionId=${sid} ${err.message}`);
                        }

                        return {
                            status: 200,
                            body: {
                                aborted: true,
                                sessionId: sid,
                                tokenReleased,
                                quotaReleased,
                                concurrentSessions: await deps.tenants.checkQuota({
                                    tenantId: rec.tenantId, kind: 'concurrentSessions'
                                })
                            }
                        };
                    }
                }
            };
        }

        case SERVICES.ARTIFACT:
            return {
                warnings,
                handlers: {
                    ...base,
                    'GET /artifacts': async () => ({
                        status: 200,
                        body: { note: '对象存储列表需接入 S3/MinIO；本机未配置时返回空', artifacts: [] }
                    })
                }
            };

        case SERVICES.KNOWLEDGE:
            return {
                warnings,
                handlers: {
                    ...base,
                    'GET /search': async () => ({
                        status: 200,
                        body: { note: '知识检索复用 KnowledgeManager.searchExperiences', hits: [] }
                    })
                }
            };

        default:
            return { handlers: base, warnings };
    }
}

/**
 * 动态加载"可选后端客户端"。
 *
 * 本仓库**不**把 `pg` / `ioredis` 作为硬依赖：单机开发与全部单元测试都不需要它们。
 * 但一旦 `DISTRIBUTED_*` 指向真实后端，就**不允许静默退回内存语义**（那等于
 * "以为在跑分布式、实际是单实例语义"，是本模块最危险的失效模式）。
 * 因此这里：客户端缺失 → 抛出可执行的安装指引，让服务启动失败。
 *
 * @param {string} name - 模块名（如 'pg' / 'ioredis'）
 * @param {string} purpose - 用途描述（用于错误信息）
 * @returns {Promise<any>}
 * @private
 */
async function loadOptionalModule(name, purpose) {
    try {
        return await import(name);
    } catch (err) {
        throw new Error(
            `${purpose} 需要可选依赖 "${name}"，但当前环境未安装：${err.message}。` +
            `安装方式：npm i ${name}（生产镜像已在 deploy/Dockerfile 中预装）；` +
            `或改用内存后端（不设置 DISTRIBUTED_LEASE / DISTRIBUTED_QUEUE / DISTRIBUTED_TOKEN）。`
        );
    }
}

/** @private */
async function createPostgresBackend() {
    const url = process.env.POSTGRES_URL;
    if (!url) {
        throw new Error('DISTRIBUTED_LEASE=postgres 需要 POSTGRES_URL 环境变量');
    }

    const mod = await loadOptionalModule('pg', 'PostgreSQL 租约后端');
    const Pool = mod.Pool || mod.default?.Pool;
    if (typeof Pool !== 'function') {
        throw new Error('pg 模块未导出 Pool —— 请确认安装的是 node-postgres（npm i pg）');
    }

    // 连接池：租约语句都是短查询，5 条连接足够；连接串来自环境变量/Secret
    const pool = new Pool({ connectionString: url, max: 5 });
    return new PostgresLeaseBackend({
        query: (sql, params) => pool.query(sql, params)
    });
}

/** @private */
async function loadRedisClient(purpose) {
    const url = process.env.REDIS_URL;
    if (!url) {
        throw new Error('DISTRIBUTED_QUEUE/DISTRIBUTED_TOKEN=redis* 需要 REDIS_URL 环境变量');
    }
    const mod = await loadOptionalModule('ioredis', purpose);
    const Redis = mod.default || mod.Redis;
    if (typeof Redis !== 'function') {
        throw new Error('ioredis 模块未导出 Redis 构造函数 —— 请确认安装的是 ioredis（npm i ioredis）');
    }
    return new Redis(url, {
        // 队列/令牌都必须打到主节点（Lua 脚本与 Stream 语义依赖单实例）
        maxRetriesPerRequest: null,
        enableOfflineQueue: true
    });
}

/** @private */
async function createRedisStreamsBackend() {
    const redis = await loadRedisClient('Redis Streams 消息队列');
    // 门面契约：call(cmd, args[])（见 RedisStreamsBackend 的构造函数）
    return new RedisStreamsBackend({ call: (cmd, args) => redis.call(cmd, ...args) });
}

/** @private */
async function createRedisTokenBackend() {
    const redis = await loadRedisClient('Redis 全局令牌（分布式信号量）');
    // 门面契约：evalScript(script, keys[], args[])（见 RedisTokenBackend 的构造函数）
    return new RedisTokenBackend({
        evalScript: (script, keys, args) => redis.eval(script, keys.length, ...keys, ...args)
    });
}

// ─── CLI 入口 ────────────────────────────────────────────────────────────

const isMain = process.argv[1] && /bootstrap\.js$/.test(process.argv[1].replace(/\\/g, '/'));

if (isMain) {
    const args = process.argv.slice(2);
    if (args.includes('--list') || args.length === 0) {
        const check = validateServiceBoundaries();
        console.log('可用服务：');
        for (const def of Object.values(SERVICE_DEFINITIONS)) {
            console.log(`  ${def.name.padEnd(20)} :${def.defaultPort}  ${def.summary}`);
        }
        console.log(`\n边界校验：${check.ok ? '通过' : '失败'}`);
        for (const w of check.warnings) console.log(`  ⚠ ${w}`);
        for (const e of check.errors) console.log(`  ❌ ${e}`);
        process.exit(check.ok ? 0 : 1);
    }

    const serviceName = args.find((a) => !a.startsWith('--'));
    const portArg = args.indexOf('--port');
    if (portArg >= 0 && args[portArg + 1]) {
        process.env[SERVICE_DEFINITIONS[serviceName]?.portEnv || 'PORT'] = args[portArg + 1];
    }

    try {
        const { host, warnings } = await createRuntime({ serviceName });
        for (const w of warnings) console.warn(`⚠ ${w}`);
        const info = await host.listen();
        console.log(`[${host.name}] 已启动 ${info.url}（instance=${host.instanceId}）`);

        const shutdown = async (sig) => {
            console.log(`[${host.name}] 收到 ${sig}，开始优雅停机…`);
            // 先停止接单（close 会停止接受新连接并等已有请求结束）
            await host.close();
            // 服务级清理：停掉租约心跳等定时器（否则会续租到进程退出为止）
            try {
                host._closeExtras?.();
            } catch (err) {
                console.warn(`[${host.name}] 服务级清理失败：${err.message}`);
            }
            await host._deps.notify.close();
            console.log(`[${host.name}] 已停机`);
            process.exit(0);
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (err) {
        console.error(`[bootstrap] 启动失败：${err.message}`);
        process.exit(1);
    }
}

export { http };
export default createRuntime;
