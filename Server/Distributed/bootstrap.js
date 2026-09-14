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

import { nowCST } from '../library/cstTime.js';
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
    const leaseBackend = be.lease
        || (be.leaseBackendName === 'postgres' || process.env.DISTRIBUTED_LEASE === 'postgres'
            ? createPostgresBackend()
            : undefined);

    const leases = new LeaseStore({
        backend: leaseBackend,
        logger: opts.logger ?? null
    });

    const queueBackend = be.queue
        || (be.queueBackendName === 'redis-streams' || process.env.DISTRIBUTED_QUEUE === 'redis-streams'
            ? createRedisStreamsBackend()
            : undefined);

    const queue = new MessageQueue({ backend: queueBackend, logger: opts.logger ?? null });

    const tokenBackend = be.token
        || (be.tokenBackendName === 'redis' || process.env.DISTRIBUTED_TOKEN === 'redis'
            ? createRedisTokenBackend()
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
        case SERVICES.ORCHESTRATOR:
            return {
                warnings,
                handlers: {
                    ...base,
                    'GET /leases': async (ctx) => ({
                        status: 200,
                        body: {
                            // 按租户可见性过滤：跨租户的租约不返回
                            leases: (await deps.leases.list()).filter((l) =>
                                ctx.tenantId ? l.resource.startsWith(`task:${ctx.tenantId}:`) : true),
                            stats: deps.leases.getStats()
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
                        return {
                            status: 201,
                            body: {
                                taskId,
                                resource,
                                fencingToken: got.lease.fencingToken,
                                expiresAt: got.lease.expiresAt
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
                        await deps.leases.release && undefined;
                        return { status: 200, body: { aborted: true, taskId: ctx.params.taskId } };
                    }
                }
            };

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

        case SERVICES.AGENT_RUNTIME:
            return {
                warnings,
                handlers: {
                    ...base,
                    'GET /skills': async () => ({
                        status: 200,
                        body: { note: 'SKILL 清单由 Server/Skills 提供，需挂载只读卷', count: null }
                    }),
                    'POST /sessions': async (ctx) => {
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
                        return {
                            status: 201,
                            body: {
                                sessionId: `sess-${Date.now().toString(36)}`,
                                role: ctx.body?.role || 'coder',
                                tokenId: lease.tokenId,
                                waitedMs: lease.waitedMs,
                                releaseHint: 'POST /sessions/:id/abort 会释放令牌'
                            }
                        };
                    }
                }
            };

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

/** @private */
function createPostgresBackend() {
    const url = process.env.POSTGRES_URL;
    if (!url) {
        throw new Error('DISTRIBUTED_LEASE=postgres 需要 POSTGRES_URL 环境变量');
    }
    // 真实连接由部署环境提供（pg 客户端）；这里延迟 require 以避免无依赖时报错
    throw new Error(
        'PostgresLeaseBackend 需要注入 SQL 客户端（本仓库未内置 pg 依赖）。' +
        '请在部署镜像中安装 pg 并在此处注入 query()。'
    );
}

/** @private */
function createRedisStreamsBackend() {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('DISTRIBUTED_QUEUE=redis-streams 需要 REDIS_URL 环境变量');
    throw new Error(
        'RedisStreamsBackend 需要注入 Redis 客户端（本仓库未内置 ioredis 依赖）。' +
        '请在部署镜像中安装并在此处注入 call()。'
    );
}

/** @private */
function createRedisTokenBackend() {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('DISTRIBUTED_TOKEN=redis 需要 REDIS_URL 环境变量');
    throw new Error(
        'RedisTokenBackend 需要注入 evalScript()（本仓库未内置 ioredis 依赖）。' +
        '请在部署镜像中安装并在此处注入。'
    );
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
